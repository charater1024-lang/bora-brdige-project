#!/usr/bin/env bash
set -euo pipefail

umask 077

reason=""
while (($# > 0)); do
  case "$1" in
    --reason)
      (($# >= 2)) || { printf 'Missing --reason value.\n' >&2; exit 2; }
      reason="$2"
      shift 2
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

[[ "${reason}" == health || "${reason}" == memory ]] \
  || { printf 'Reason must be health or memory.\n' >&2; exit 2; }

readonly service_name="${BORA_RESTART_SERVICE:-bora-bridge.service}"
readonly systemctl_bin="${BORA_RESTART_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
readonly flock_bin="${BORA_RESTART_FLOCK_BIN:-/usr/bin/flock}"
readonly sleep_bin="${BORA_RESTART_SLEEP_BIN:-/usr/bin/sleep}"
readonly realpath_bin="${BORA_RESTART_REALPATH_BIN:-/usr/bin/realpath}"
readonly deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly health_script="${BORA_RESTART_HEALTH_SCRIPT:-${deploy_dir}/check-bora-bridge-health.sh}"
readonly health_attempts="${BORA_RESTART_HEALTH_ATTEMPTS:-5}"
readonly health_interval_seconds="${BORA_RESTART_HEALTH_INTERVAL_SECONDS:-5}"
readonly runtime_root="${BORA_RESTART_RUNTIME_ROOT:-${XDG_RUNTIME_DIR:-/run/user/$(/usr/bin/id -u)}}"
readonly restart_lock="${runtime_root}/bora-bridge-restart.lock"

fail_configuration() {
  printf '{"event":"bora_bridge_restart_error","reason":"configuration_or_runtime_error"}\n' >&2
  printf 'bora-bridge-restart: %s\n' "$*" >&2
  exit 2
}

[[ "${service_name}" =~ ^[A-Za-z0-9_.@:-]+[.]service$ ]] \
  || fail_configuration "The service name is invalid."
[[ "${health_attempts}" =~ ^[0-9]+$ && "${health_interval_seconds}" =~ ^[0-9]+$ ]] \
  || fail_configuration "Health timing settings must be unsigned integers."
(( health_attempts >= 1 && health_attempts <= 20 )) \
  || fail_configuration "Health attempts must be between one and 20."
(( health_interval_seconds >= 1 && health_interval_seconds <= 30 )) \
  || fail_configuration "Health interval must be between one and 30."

for command_setting in \
  "systemctl:${systemctl_bin}" \
  "flock:${flock_bin}" \
  "sleep:${sleep_bin}" \
  "realpath:${realpath_bin}"
do
  command_name="${command_setting%%:*}"
  command_path="${command_setting#*:}"
  [[ "${command_path}" == /* && -f "${command_path}" && -x "${command_path}" ]] \
    || fail_configuration "${command_name} must be an absolute executable path."
done

[[ "${health_script}" == /* && -f "${health_script}" && ! -L "${health_script}" ]] \
  || fail_configuration "The canonical health script is unavailable or unsafe."
[[ "${runtime_root}" == /* && "${runtime_root}" != / && -d "${runtime_root}" ]] \
  || fail_configuration "The runtime root is unavailable or unsafe."
[[ ! -L "${runtime_root}" ]] || fail_configuration "Refusing a symbolic-link runtime root."
readonly resolved_runtime_root="$("${realpath_bin}" -e -- "${runtime_root}")"
[[ "${resolved_runtime_root}" == /* && "${resolved_runtime_root}" != / ]] \
  || fail_configuration "The resolved runtime root is unsafe."
[[ ! -L "${restart_lock}" ]] || fail_configuration "Refusing a symbolic-link restart lock."

# Avoid letting an already-healthy recovery request briefly take the shared
# restart lock away from a concurrent memory recovery. The health check is
# deliberately repeated after locking below so a stale failure cannot cause a
# sequential restart once another recovery has restored readiness.
if [[ "${reason}" == health ]] && /usr/bin/bash "${health_script}"; then
  printf '{"event":"bora_bridge_restart_skipped","reason":"health","service":"%s","action":"already_healthy"}\n' \
    "${service_name}"
  exit 0
fi

exec 9>"${restart_lock}"
if ! "${flock_bin}" --nonblock 9; then
  printf '{"event":"bora_bridge_restart_skipped","reason":"%s","service":"%s","action":"lock_busy"}\n' \
    "${reason}" "${service_name}"
  exit 0
fi

# A health-check failure can be queued while another recovery is already
# restarting the app. Revalidate under the lock to avoid a second sequential
# restart if the canonical readiness contract became healthy in the meantime.
if [[ "${reason}" == health ]] && /usr/bin/bash "${health_script}"; then
  printf '{"event":"bora_bridge_restart_skipped","reason":"health","service":"%s","action":"already_healthy"}\n' \
    "${service_name}"
  exit 0
fi

printf '{"event":"bora_bridge_restart_started","reason":"%s","service":"%s"}\n' \
  "${reason}" "${service_name}"
if ! "${systemctl_bin}" --user restart "${service_name}"; then
  printf '{"event":"bora_bridge_restart_failed","reason":"%s","service":"%s","action":"systemctl_failed"}\n' \
    "${reason}" "${service_name}" >&2
  exit 1
fi

for ((attempt = 1; attempt <= health_attempts; attempt += 1)); do
  if /usr/bin/bash "${health_script}"; then
    printf '{"event":"bora_bridge_restart_succeeded","reason":"%s","service":"%s","health_attempt":%s}\n' \
      "${reason}" "${service_name}" "${attempt}"
    exit 0
  fi
  if (( attempt < health_attempts )); then
    "${sleep_bin}" "${health_interval_seconds}"
  fi
done

printf '{"event":"bora_bridge_restart_failed","reason":"%s","service":"%s","action":"health_check_failed","health_attempts":%s}\n' \
  "${reason}" "${service_name}" "${health_attempts}" >&2
exit 1
