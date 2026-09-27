#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly unit_name="${BORA_STOP_UNIT:-bora-bridge.service}"
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
project_root="${BORA_STOP_PROJECT_ROOT:-$(bora_project_root "${BASH_SOURCE[0]}")}" || exit 2
readonly project_root
node_bin="${BORA_STOP_NODE_BIN:-$(bora_tool_path BORA_NODE_BIN node)}" || exit 2
readonly node_bin
readonly runner_path="${BORA_STOP_RUNNER_PATH:-${project_root}/scripts/start-local-worker.mjs}"
readonly runtime_root="${BORA_STOP_RUNTIME_ROOT:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bora-bridge}"
readonly runtime_config="${BORA_STOP_RUNTIME_CONFIG:-${runtime_root}/wrangler.runtime.json}"
readonly persistence_path="${BORA_STOP_PERSISTENCE_PATH:-${project_root}/.wrangler/state}"
readonly listen_host="${BORA_STOP_HOST:-127.0.0.1}"
readonly listen_port="${BORA_STOP_PORT:-3000}"
readonly proc_root="${BORA_STOP_PROC_ROOT:-/proc}"
readonly cgroup_root="${BORA_STOP_CGROUP_ROOT:-/sys/fs/cgroup}"
readonly configured_systemctl_bin="${BORA_STOP_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
readonly configured_kill_bin="${BORA_STOP_KILL_BIN:-/usr/bin/kill}"
readonly configured_sleep_bin="${BORA_STOP_SLEEP_BIN:-/usr/bin/sleep}"
readonly trusted_executable_uid="${BORA_STOP_TRUSTED_EXECUTABLE_UID:-0}"
readonly timeout_seconds="${BORA_STOP_TIMEOUT_SECONDS:-15}"

fail() {
  printf '[bora-local-worker-stop] ERROR: %s\n' "$*" >&2
  exit 1
}

case "${unit_name}" in
  *[!A-Za-z0-9_.@:-]*|'') fail "Invalid unit name." ;;
esac
[[ "${node_bin}" == /* && "${runner_path}" == /* \
  && "${runtime_config}" == /* && "${persistence_path}" == /* ]] \
  || fail "Expected runtime paths must be absolute."
[[ "${listen_host}" == "127.0.0.1" ]] || fail "Only the production loopback host is allowed."
[[ "${listen_port}" == "3000" ]] || fail "Only the production listener port is allowed."
[[ "${timeout_seconds}" =~ ^[0-9]+$ ]] \
  && (( 10#${timeout_seconds} >= 1 && 10#${timeout_seconds} <= 15 )) \
  || fail "Stop timeout must be an integer from 1 through 15 seconds."
[[ "${trusted_executable_uid}" =~ ^[0-9]+$ ]] \
  || fail "Trusted executable UID must be an unsigned integer."

# Ubuntu packages may expose otherwise trusted utilities through symlinks.
# Resolve each configured executable once and invoke the canonical regular file
# below. This accepts a legitimate symlink such as /usr/bin/sleep while still
# rejecting relative paths, dangling links, writable targets and unexpected
# default-package destinations.
resolve_executable() {
  local command_name="$1"
  local executable="$2"
  local resolved
  local ownership
  local owner_uid
  local mode_text

  [[ "${executable}" == /* && -x "${executable}" ]] \
    || fail "Required executable must be an absolute executable path: ${executable}"
  resolved="$(/usr/bin/readlink -f -- "${executable}")" \
    || fail "Unable to resolve required executable: ${executable}"
  [[ "${resolved}" == /* && -f "${resolved}" && -x "${resolved}" && ! -L "${resolved}" ]] \
    || fail "Required executable did not resolve to a regular executable: ${executable}"

  ownership="$(/usr/bin/stat --format='%u:%a' -- "${resolved}")" \
    || fail "Unable to inspect required executable ownership: ${executable}"
  IFS=: read -r owner_uid mode_text <<<"${ownership}"
  [[ "${owner_uid}" == "${trusted_executable_uid}" \
    && "${mode_text}" =~ ^[0-7]{3,4}$ \
    && $((8#${mode_text} & 8#022)) -eq 0 ]] \
    || fail "Required executable has unsafe ownership or mode: ${executable}"

  # Environment overrides are retained for isolated integration testing. The
  # production defaults, however, may only resolve to known OS package paths.
  if [[ "${executable}" == "/usr/bin/${command_name}" ]]; then
    case "${command_name}:${resolved}" in
      systemctl:/usr/bin/systemctl|systemctl:/bin/systemctl) ;;
      kill:/usr/bin/kill|kill:/bin/kill|kill:/usr/lib/cargo/bin/coreutils/kill) ;;
      sleep:/usr/bin/sleep|sleep:/bin/sleep|sleep:/usr/lib/cargo/bin/coreutils/sleep) ;;
      *) fail "Default executable resolved outside its trusted package paths: ${executable} -> ${resolved}" ;;
    esac
  fi
  printf '%s\n' "${resolved}"
}

systemctl_bin="$(resolve_executable systemctl "${configured_systemctl_bin}")"
kill_bin="$(resolve_executable kill "${configured_kill_bin}")"
sleep_bin="$(resolve_executable sleep "${configured_sleep_bin}")"
readonly systemctl_bin kill_bin sleep_bin
[[ -d "${proc_root}" && ! -L "${proc_root}" ]] || fail "Unsafe proc root."
[[ -d "${cgroup_root}" && ! -L "${cgroup_root}" ]] || fail "Unsafe cgroup root."

readonly expected_argv=(
  "${node_bin}"
  "${runner_path}"
  --config "${runtime_config}"
  --persist-to "${persistence_path}"
  --host "${listen_host}"
  --port "${listen_port}"
)

metadata="$("${systemctl_bin}" --user show "${unit_name}" \
  --property=MainPID --property=ControlGroup --no-pager)" \
  || fail "Unable to inspect ${unit_name}."

main_pid=""
control_group=""
while IFS='=' read -r key value; do
  case "${key}" in
    MainPID)
      [[ -z "${main_pid}" ]] || fail "Duplicate MainPID metadata."
      main_pid="${value}"
      ;;
    ControlGroup)
      [[ -z "${control_group}" ]] || fail "Duplicate ControlGroup metadata."
      control_group="${value}"
      ;;
    '') ;;
    *) fail "Unexpected service metadata." ;;
  esac
done <<<"${metadata}"

[[ "${main_pid}" =~ ^[0-9]+$ ]] || fail "Invalid MainPID metadata."
[[ "${control_group}" == /* \
  && "${control_group}" != *'..'* \
  && "${control_group}" != *'//'*
  && "${control_group##*/}" == "${unit_name}" ]] \
  || fail "Invalid service control group."

cgroup_root_real="$(readlink -f -- "${cgroup_root}")" \
  || fail "Unable to resolve cgroup root."
cgroup_procs="${cgroup_root_real}${control_group}/cgroup.procs"
[[ -f "${cgroup_procs}" && ! -L "${cgroup_procs}" ]] \
  || fail "The service cgroup process list is unavailable."
cgroup_procs_real="$(readlink -f -- "${cgroup_procs}")" \
  || fail "Unable to resolve the service cgroup."
case "${cgroup_procs_real}" in
  "${cgroup_root_real}"/*) ;;
  *) fail "The service cgroup escaped its root." ;;
esac

process_is_expected() {
  local pid="$1"
  local cgroup_file="${proc_root}/${pid}/cgroup"
  local cmdline_file="${proc_root}/${pid}/cmdline"
  local -a actual_argv=()
  local index

  [[ "${pid}" =~ ^[0-9]+$ ]] && (( 10#${pid} > 1 )) || return 1
  [[ -r "${cgroup_file}" && -r "${cmdline_file}" ]] || return 1
  /usr/bin/grep -Fxq -- "0::${control_group}" "${cgroup_file}" || return 1
  mapfile -d '' -t actual_argv <"${cmdline_file}" || true
  (( ${#actual_argv[@]} == ${#expected_argv[@]} )) || return 1
  for ((index = 0; index < ${#expected_argv[@]}; index += 1)); do
    [[ "${actual_argv[index]}" == "${expected_argv[index]}" ]] || return 1
  done
}

declare -A seen_pids=()
declare -a candidates=()

consider_pid() {
  local pid="$1"
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 0
  [[ -z "${seen_pids[${pid}]:-}" ]] || return 0
  seen_pids["${pid}"]=1
  if process_is_expected "${pid}"; then
    candidates+=("${pid}")
  fi
}

# Prefer the service manager's PID when it is the runner itself, but always
# scan the exact unit cgroup as Bubblewrap is normally the service MainPID.
consider_pid "${main_pid}"
while IFS= read -r pid; do
  consider_pid "${pid}"
done <"${cgroup_procs_real}"

if (( ${#candidates[@]} == 0 )); then
  printf '[bora-local-worker-stop] No matching production runner remains.\n'
  exit 0
fi
if (( ${#candidates[@]} != 1 )); then
  fail "Refusing to signal ${#candidates[@]} matching production runners."
fi

readonly target_pid="${candidates[0]}"
# Close the discovery-to-signal race as far as procfs permits. If the PID was
# reused, changed argv, or left the service cgroup, do not signal it.
process_is_expected "${target_pid}" \
  || fail "The selected runner changed before it could be signalled."
"${kill_bin}" -TERM -- "${target_pid}" \
  || fail "Unable to signal the production runner."
printf '[bora-local-worker-stop] Sent SIGTERM to the validated production runner.\n'

for ((remaining = 10#${timeout_seconds}; remaining > 0; remaining -= 1)); do
  if ! process_is_expected "${target_pid}"; then
    printf '[bora-local-worker-stop] Production runner stopped gracefully.\n'
    exit 0
  fi
  "${sleep_bin}" 1
done

if ! process_is_expected "${target_pid}"; then
  printf '[bora-local-worker-stop] Production runner stopped gracefully.\n'
  exit 0
fi
fail "Production runner did not stop within ${timeout_seconds} seconds."
