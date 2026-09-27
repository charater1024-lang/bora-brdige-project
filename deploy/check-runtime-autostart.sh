#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly systemctl_bin="${BORA_AUTOSTART_SYSTEMCTL:-/usr/bin/systemctl}"
readonly loginctl_bin="${BORA_AUTOSTART_LOGINCTL:-/usr/bin/loginctl}"
readonly curl_bin="${BORA_AUTOSTART_CURL:-/usr/bin/curl}"
readonly date_bin="${BORA_AUTOSTART_DATE:-/usr/bin/date}"
readonly install_bin="${BORA_AUTOSTART_INSTALL:-/usr/bin/install}"
readonly mktemp_bin="${BORA_AUTOSTART_MKTEMP:-/usr/bin/mktemp}"
readonly mv_bin="${BORA_AUTOSTART_MV:-/usr/bin/mv}"
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
node_bin="${BORA_AUTOSTART_NODE:-$(bora_tool_path BORA_NODE_BIN node)}" || exit 2
readonly node_bin
readonly boot_id_file="${BORA_AUTOSTART_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}"
readonly state_root="${BORA_AUTOSTART_STATE_ROOT:-${XDG_STATE_HOME:-${HOME:?HOME required}/.local/state}/bora-bridge-runtime}"
readonly state_file="${state_root}/autostart-canary.state"
readonly units=(bora-ollama.service bora-local-llm.service bora-public-api-proxy.service bora-bridge.service bora-cloudflared.service bora-bridge-healthcheck.timer bora-bridge-memory-watchdog.timer bora-public-data-refresh.timer)

fail() { printf '{"event":"bora_autostart_canary","status":"failed","reason":"%s"}\n' "$1" >&2; exit 1; }
for binary in "${systemctl_bin}" "${loginctl_bin}" "${curl_bin}" "${date_bin}" "${install_bin}" "${mktemp_bin}" "${mv_bin}" "${node_bin}"; do
  [[ "${binary}" == /* && -f "${binary}" && -x "${binary}" ]] || fail invalid_command;
done
[[ "${state_root}" == /* && "${state_root}" != / && ! -L "${state_root}" ]] || fail unsafe_state_root
[[ "${boot_id_file}" == /* && -f "${boot_id_file}" && ! -L "${boot_id_file}" && -r "${boot_id_file}" ]] || fail invalid_boot_id_file
boot_id="$(/usr/bin/tr -d '\r\n' <"${boot_id_file}")"
[[ "${boot_id}" =~ ^[0-9a-fA-F-]{36}$ ]] || fail invalid_boot_id
"${install_bin}" -d -m 0700 -- "${state_root}"
[[ ! -L "${state_file}" ]] || fail unsafe_state_file

[[ "$("${loginctl_bin}" show-user "$(/usr/bin/id -un)" --property=Linger --value)" == yes ]] || fail linger_disabled
restart_total=0
for unit in "${units[@]}"; do
  [[ "$("${systemctl_bin}" --user show "${unit}" --property=UnitFileState --value)" == enabled ]] || fail unit_not_enabled
  [[ "$("${systemctl_bin}" --user show "${unit}" --property=ActiveState --value)" == active ]] || fail unit_not_active
  value="$("${systemctl_bin}" --user show "${unit}" --property=NRestarts --value)"
  [[ "${value}" =~ ^[0-9]*$ ]] || fail invalid_restart_count
  restart_total=$((restart_total + ${value:-0}))
done

# Service state alone is not readiness. These are bounded, anonymous loopback
# probes. Cloudflared is checked for durable/active process state only; this
# canary does not claim end-to-end public tunnel availability.
[[ "$("${curl_bin}" --fail --silent --connect-timeout 2 --max-time 5 \
  --header 'Host: borabridge.com' --header 'X-Forwarded-Host: borabridge.com' \
  --header 'X-Forwarded-Proto: https' --header 'Origin: https://borabridge.com' \
  http://127.0.0.1:3000/api/health)" == '{"status":"ok"}' ]] || fail web_not_ready
gateway_health="$("${curl_bin}" --fail --silent --connect-timeout 2 --max-time 5 --max-filesize 65536 \
  http://127.0.0.1:11435/health)" || fail local_model_gateway_not_ready
"${node_bin}" -e 'let value;try{value=JSON.parse(process.argv[1])}catch{process.exit(1)};process.exit(value?.status==="ok"&&value?.model_state==="ready"&&typeof value?.selected_model==="string"&&value.selected_model?0:1)' \
  "${gateway_health}" || fail local_model_gateway_not_ready

now="$("${date_bin}" +%s)"; [[ "${now}" =~ ^[0-9]+$ ]] || fail invalid_clock
previous_successes=0; previous_restart_total="${restart_total}"; previous_boot_id="${boot_id}"
previous_reboots_observed=0; previous_last_reboot_epoch=0
seen_successes=0; seen_restarts=0; seen_epoch=0; seen_boot_id=0; seen_reboots=0; seen_last_reboot=0
if [[ -f "${state_file}" ]]; then
  while IFS='=' read -r key value; do
    case "${key}" in
      successes) [[ "${value}" =~ ^[0-9]+$ ]] || fail corrupt_state; ((seen_successes == 0)) || fail corrupt_state; seen_successes=1; previous_successes="${value}" ;;
      restart_total) [[ "${value}" =~ ^[0-9]+$ ]] || fail corrupt_state; ((seen_restarts == 0)) || fail corrupt_state; seen_restarts=1; previous_restart_total="${value}" ;;
      last_success_epoch) [[ "${value}" =~ ^[0-9]+$ ]] || fail corrupt_state; ((seen_epoch == 0)) || fail corrupt_state; seen_epoch=1 ;;
      boot_id) [[ "${value}" =~ ^[0-9a-fA-F-]{36}$ ]] || fail corrupt_state; ((seen_boot_id == 0)) || fail corrupt_state; seen_boot_id=1; previous_boot_id="${value}" ;;
      reboots_observed) [[ "${value}" =~ ^[0-9]+$ ]] || fail corrupt_state; ((seen_reboots == 0)) || fail corrupt_state; seen_reboots=1; previous_reboots_observed="${value}" ;;
      last_reboot_epoch) [[ "${value}" =~ ^[0-9]+$ ]] || fail corrupt_state; ((seen_last_reboot == 0)) || fail corrupt_state; seen_last_reboot=1; previous_last_reboot_epoch="${value}" ;;
      *) fail corrupt_state ;;
    esac
  done <"${state_file}"
  # Existing installations did not record boot_id. Accept that state once and
  # establish a baseline without falsely claiming that a reboot was observed.
  ((seen_successes == 1 && seen_restarts == 1 && seen_epoch == 1)) || fail corrupt_state
  ((seen_reboots == seen_last_reboot)) || fail corrupt_state
fi
successes=$((previous_successes + 1)); restart_delta=0; reboot_observed=false
reboots_observed="${previous_reboots_observed}"; last_reboot_epoch="${previous_last_reboot_epoch}"
(( restart_total >= previous_restart_total )) && restart_delta=$((restart_total - previous_restart_total))
if (( seen_boot_id == 1 )) && [[ "${previous_boot_id}" != "${boot_id}" ]]; then
  reboot_observed=true
  reboots_observed=$((previous_reboots_observed + 1))
  last_reboot_epoch="${now}"
fi
reboot_tested=false; (( reboots_observed > 0 )) && reboot_tested=true
temporary="$("${mktemp_bin}" "${state_root}/autostart-canary.XXXXXX")"
printf 'successes=%s\nrestart_total=%s\nlast_success_epoch=%s\nboot_id=%s\nreboots_observed=%s\nlast_reboot_epoch=%s\n' \
  "${successes}" "${restart_total}" "${now}" "${boot_id}" "${reboots_observed}" "${last_reboot_epoch}" >"${temporary}"
/usr/bin/chmod 0600 "${temporary}"; "${mv_bin}" -f -- "${temporary}" "${state_file}"
printf '{"event":"bora_autostart_canary","status":"ready","successful_observations":%s,"restart_delta":%s,"reboot_tested":%s,"reboot_observed_this_run":%s,"reboots_observed":%s,"last_reboot_epoch":%s,"session_flow_tested":false}\n' \
  "${successes}" "${restart_delta}" "${reboot_tested}" "${reboot_observed}" "${reboots_observed}" "${last_reboot_epoch}"
