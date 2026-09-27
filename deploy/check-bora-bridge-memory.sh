#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly service_name="${BORA_MEMORY_WATCHDOG_SERVICE:-bora-bridge.service}"
readonly warning_bytes="${BORA_MEMORY_WATCHDOG_WARNING_BYTES:-2684354560}"
readonly restart_bytes="${BORA_MEMORY_WATCHDOG_RESTART_BYTES:-3758096384}"
readonly emergency_bytes="${BORA_MEMORY_WATCHDOG_EMERGENCY_BYTES:-4026531840}"
readonly required_samples="${BORA_MEMORY_WATCHDOG_REQUIRED_SAMPLES:-2}"
readonly cooldown_seconds="${BORA_MEMORY_WATCHDOG_COOLDOWN_SECONDS:-21600}"
readonly budget_window_seconds="${BORA_MEMORY_WATCHDOG_BUDGET_WINDOW_SECONDS:-86400}"
readonly max_restarts_per_window="${BORA_MEMORY_WATCHDOG_MAX_RESTARTS_PER_WINDOW:-2}"
readonly observation_interval_seconds="${BORA_MEMORY_WATCHDOG_OBSERVATION_INTERVAL_SECONDS:-3600}"
readonly dry_run="${BORA_MEMORY_WATCHDOG_DRY_RUN:-1}"

readonly systemctl_bin="${BORA_MEMORY_WATCHDOG_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
readonly flock_bin="${BORA_MEMORY_WATCHDOG_FLOCK_BIN:-/usr/bin/flock}"
readonly realpath_bin="${BORA_MEMORY_WATCHDOG_REALPATH_BIN:-/usr/bin/realpath}"
readonly install_bin="${BORA_MEMORY_WATCHDOG_INSTALL_BIN:-/usr/bin/install}"
readonly mktemp_bin="${BORA_MEMORY_WATCHDOG_MKTEMP_BIN:-/usr/bin/mktemp}"
readonly mv_bin="${BORA_MEMORY_WATCHDOG_MV_BIN:-/usr/bin/mv}"
readonly date_bin="${BORA_MEMORY_WATCHDOG_DATE_BIN:-/usr/bin/date}"
readonly deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly restart_helper="${BORA_MEMORY_WATCHDOG_RESTART_HELPER:-${deploy_dir}/restart-bora-bridge.sh}"

readonly cgroup_root="${BORA_MEMORY_WATCHDOG_CGROUP_ROOT:-/sys/fs/cgroup}"
readonly state_root="${BORA_MEMORY_WATCHDOG_STATE_ROOT:-${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}}"
readonly state_dir="${BORA_MEMORY_WATCHDOG_STATE_DIR:-${state_root}/bora-bridge-memory-watchdog}"
readonly state_file="${state_dir}/state"
readonly lock_file="${state_dir}/watchdog.lock"

die() {
  printf '{"event":"bora_memory_watchdog_error","reason":"configuration_or_runtime_error"}\n' >&2
  printf 'bora-memory-watchdog: %s\n' "$*" >&2
  exit 2
}

is_uint() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

require_uint() {
  local name="$1"
  local value="$2"
  is_uint "${value}" || die "${name} must be an unsigned integer."
}

require_absolute_executable() {
  local name="$1"
  local value="$2"
  [[ "${value}" == /* && -f "${value}" && -x "${value}" ]] \
    || die "${name} must be an absolute executable path."
}

json_number_or_null() {
  local value="$1"
  if [[ "${value}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    printf '%s' "${value}"
  else
    printf 'null'
  fi
}

emit_event() {
  local event="$1"
  local action="$2"
  printf '{"event":"%s","service":"%s","action":"%s","trigger":"%s","memory_current_bytes":%s,"memory_peak_bytes":%s,"memory_swap_current_bytes":%s,"warning_bytes":%s,"restart_bytes":%s,"emergency_bytes":%s,"consecutive_samples":%s,"required_samples":%s,"psi_some_avg10":%s,"psi_full_avg10":%s,"cgroup_high_events":%s,"cgroup_max_events":%s,"cgroup_oom_events":%s,"cgroup_oom_kill_events":%s,"systemd_restarts":%s,"restart_count_in_window":%s,"max_restarts_per_window":%s,"cooldown_seconds":%s,"dry_run":%s}\n' \
    "${event}" \
    "${service_name}" \
    "${action}" \
    "${trigger_kind}" \
    "${memory_current}" \
    "${memory_peak}" \
    "${memory_swap_current}" \
    "${warning_bytes}" \
    "${restart_bytes}" \
    "${emergency_bytes}" \
    "${consecutive_samples}" \
    "${required_samples}" \
    "$(json_number_or_null "${psi_some_avg10}")" \
    "$(json_number_or_null "${psi_full_avg10}")" \
    "${cgroup_high_events}" \
    "${cgroup_max_events}" \
    "${cgroup_oom_events}" \
    "${cgroup_oom_kill_events}" \
    "${n_restarts}" \
    "${restart_count_in_window}" \
    "${max_restarts_per_window}" \
    "${cooldown_seconds}" \
    "${dry_run}"
}

write_state() {
  local temporary
  temporary="$("${mktemp_bin}" "${state_dir}/state.XXXXXX")"
  printf 'consecutive_samples=%s\nrestart_epoch_newest=%s\nrestart_epoch_previous=%s\nlast_memory_bytes=%s\n' \
    "${consecutive_samples}" \
    "${restart_epoch_newest}" \
    "${restart_epoch_previous}" \
    "${memory_current}" >"${temporary}"
  printf 'last_observation_epoch=%s\nlast_main_pid=%s\n' \
    "${last_observation_epoch}" \
    "${last_main_pid}" >>"${temporary}"
  /usr/bin/chmod 0600 "${temporary}"
  "${mv_bin}" -f -- "${temporary}" "${state_file}"
}

read_state() {
  local key value
  local parsed_consecutive=0
  local parsed_newest=0
  local parsed_previous=0
  local parsed_memory=0
  local parsed_observation=0
  local parsed_main_pid=0
  local seen_consecutive=0
  local seen_newest=0
  local seen_previous=0
  local seen_memory=0
  local seen_observation=0
  local seen_main_pid=0
  [[ -f "${state_file}" ]] || return 0
  [[ ! -L "${state_file}" ]] || return 1

  while IFS='=' read -r key value; do
    is_uint "${value}" || return 1
    case "${key}" in
      consecutive_samples)
        (( seen_consecutive == 0 )) || return 1
        seen_consecutive=1
        parsed_consecutive="${value}"
        ;;
      restart_epoch_newest)
        (( seen_newest == 0 )) || return 1
        seen_newest=1
        parsed_newest="${value}"
        ;;
      restart_epoch_previous)
        (( seen_previous == 0 )) || return 1
        seen_previous=1
        parsed_previous="${value}"
        ;;
      last_memory_bytes)
        (( seen_memory == 0 )) || return 1
        seen_memory=1
        parsed_memory="${value}"
        ;;
      last_observation_epoch)
        (( seen_observation == 0 )) || return 1
        seen_observation=1
        parsed_observation="${value}"
        ;;
      last_main_pid)
        (( seen_main_pid == 0 )) || return 1
        seen_main_pid=1
        parsed_main_pid="${value}"
        ;;
      *) return 1 ;;
    esac
  done <"${state_file}"

  (( seen_consecutive == 1 && seen_newest == 1 && seen_previous == 1 \
    && seen_memory == 1 && seen_observation == 1 && seen_main_pid == 1 )) \
    || return 1
  (( parsed_newest >= parsed_previous )) || return 1

  consecutive_samples="${parsed_consecutive}"
  restart_epoch_newest="${parsed_newest}"
  restart_epoch_previous="${parsed_previous}"
  last_memory_bytes="${parsed_memory}"
  last_observation_epoch="${parsed_observation}"
  last_main_pid="${parsed_main_pid}"
}

read_memory_events() {
  local key value
  while read -r key value; do
    is_uint "${value}" || continue
    case "${key}" in
      high) cgroup_high_events="${value}" ;;
      max) cgroup_max_events="${value}" ;;
      oom) cgroup_oom_events="${value}" ;;
      oom_kill) cgroup_oom_kill_events="${value}" ;;
    esac
  done <"$1"
}

read_memory_pressure() {
  local category token
  while read -r category tokens; do
    for token in ${tokens}; do
      case "${category}:${token}" in
        some:avg10=*) psi_some_avg10="${token#avg10=}" ;;
        full:avg10=*) psi_full_avg10="${token#avg10=}" ;;
      esac
    done
  done <"$1"
}

[[ "${service_name}" =~ ^[A-Za-z0-9_.@:-]+[.]service$ ]] \
  || die "The service name is invalid."

for numeric_setting in \
  "warning_bytes:${warning_bytes}" \
  "restart_bytes:${restart_bytes}" \
  "emergency_bytes:${emergency_bytes}" \
  "required_samples:${required_samples}" \
  "cooldown_seconds:${cooldown_seconds}" \
  "budget_window_seconds:${budget_window_seconds}" \
  "max_restarts_per_window:${max_restarts_per_window}" \
  "observation_interval_seconds:${observation_interval_seconds}"
do
  require_uint "${numeric_setting%%:*}" "${numeric_setting#*:}"
done

(( warning_bytes > 0 )) || die "warning_bytes must be greater than zero."
(( restart_bytes > warning_bytes )) || die "restart_bytes must exceed warning_bytes."
(( emergency_bytes > restart_bytes )) || die "emergency_bytes must exceed restart_bytes."
(( required_samples >= 2 )) || die "required_samples must be at least two."
(( cooldown_seconds >= 300 )) || die "cooldown_seconds must be at least 300."
(( budget_window_seconds >= cooldown_seconds )) \
  || die "budget_window_seconds must not be shorter than cooldown_seconds."
(( max_restarts_per_window >= 1 && max_restarts_per_window <= 2 )) \
  || die "max_restarts_per_window must be one or two."
(( observation_interval_seconds >= 60 )) \
  || die "observation_interval_seconds must be at least 60."
[[ "${dry_run}" == 0 || "${dry_run}" == 1 ]] || die "dry_run must be zero or one."

for command_setting in \
  "systemctl:${systemctl_bin}" \
  "flock:${flock_bin}" \
  "realpath:${realpath_bin}" \
  "install:${install_bin}" \
  "mktemp:${mktemp_bin}" \
  "mv:${mv_bin}" \
  "date:${date_bin}"
do
  require_absolute_executable "${command_setting%%:*}" "${command_setting#*:}"
done

[[ "${restart_helper}" == /* && -f "${restart_helper}" && ! -L "${restart_helper}" ]] \
  || die "The shared restart helper is unavailable or unsafe."

[[ "${state_root}" == /* && "${state_root}" != / ]] || die "The state root is unsafe."
[[ "${state_dir}" == "${state_root}/"* && "${state_dir}" != "${state_root}/" ]] \
  || die "The state directory must be below the state root."
[[ "${cgroup_root}" == /* && "${cgroup_root}" != / ]] || die "The cgroup root is unsafe."

[[ ! -L "${state_root}" ]] || die "Refusing a symbolic-link state root."
"${install_bin}" -d -m 0700 -- "${state_root}" "${state_dir}"
[[ ! -L "${state_root}" ]] || die "Refusing a symbolic-link state root."
[[ ! -L "${state_dir}" ]] || die "Refusing a symbolic-link state directory."
readonly resolved_state_root="$("${realpath_bin}" -e -- "${state_root}")"
readonly resolved_state_dir="$("${realpath_bin}" -e -- "${state_dir}")"
case "${resolved_state_dir}" in
  "${resolved_state_root}/"*) ;;
  *) die "The resolved state directory escaped its root." ;;
esac

[[ ! -L "${lock_file}" ]] || die "Refusing a symbolic-link lock file."
exec 9>"${lock_file}"
if ! "${flock_bin}" --nonblock 9; then
  printf '{"event":"bora_memory_watchdog_skipped","reason":"lock_busy","service":"%s"}\n' \
    "${service_name}"
  exit 0
fi

service_properties=""
if ! service_properties="$("${systemctl_bin}" --user show "${service_name}" \
  --property=MemoryCurrent \
  --property=MemoryPeak \
  --property=ControlGroup \
  --property=ActiveState \
  --property=SubState \
  --property=MainPID \
  --property=NRestarts)"; then
  die "Unable to read service telemetry."
fi

memory_current=0
memory_peak=0
control_group=""
active_state=""
sub_state=""
main_pid=0
n_restarts=0

while IFS='=' read -r key value; do
  case "${key}" in
    MemoryCurrent) memory_current="${value}" ;;
    MemoryPeak) memory_peak="${value}" ;;
    ControlGroup) control_group="${value}" ;;
    ActiveState) active_state="${value}" ;;
    SubState) sub_state="${value}" ;;
    MainPID) main_pid="${value}" ;;
    NRestarts) n_restarts="${value}" ;;
  esac
done <<<"${service_properties}"

is_uint "${memory_current}" || memory_current=0
is_uint "${memory_peak}" || memory_peak=0
is_uint "${main_pid}" || main_pid=0
is_uint "${n_restarts}" || n_restarts=0

consecutive_samples=0
last_restart_epoch=0
restart_epoch_newest=0
restart_epoch_previous=0
restart_count_in_window=0
last_memory_bytes=0
last_observation_epoch=0
last_main_pid=0
cgroup_high_events=0
cgroup_max_events=0
cgroup_oom_events=0
cgroup_oom_kill_events=0
memory_swap_current=0
psi_some_avg10=""
psi_full_avg10=""
trigger_kind="none"
readonly now_epoch="$("${date_bin}" +%s)"
require_uint "current epoch" "${now_epoch}"

if ! read_state; then
  corrupt_state="${state_dir}/state.corrupt.${now_epoch}"
  [[ ! -e "${corrupt_state}" ]] || die "A corrupt-state quarantine path already exists."
  "${mv_bin}" -- "${state_file}" "${corrupt_state}"
  consecutive_samples=0
  restart_epoch_newest=$((now_epoch > cooldown_seconds ? now_epoch - cooldown_seconds : 0))
  restart_epoch_previous=0
  last_memory_bytes=0
  last_observation_epoch=0
  last_main_pid="${main_pid}"
  printf '{"event":"bora_memory_watchdog_state_recovered","service":"%s","restart_budget_preserved":true}\n' \
    "${service_name}" >&2
fi

# Keep the previous persisted sample count so a return to safe memory can be
# written exactly once. Healthy 10-second probes otherwise do not need to
# replace the state file on every run.
readonly persisted_consecutive_samples="${consecutive_samples}"

if (( last_main_pid != 0 && last_main_pid != main_pid )); then
  consecutive_samples=0
fi
last_main_pid="${main_pid}"

if [[ "${active_state}" != active || "${sub_state}" != running || main_pid == 0 ]]; then
  consecutive_samples=0
  write_state
  printf '{"event":"bora_memory_watchdog_skipped","reason":"service_not_running","service":"%s","active_state":"%s","sub_state":"%s"}\n' \
    "${service_name}" "${active_state}" "${sub_state}"
  exit 0
fi

[[ "${control_group}" == /* && "${control_group}" != *..* ]] \
  || die "The service control group is invalid."
readonly cgroup_path="${cgroup_root}${control_group}"
readonly resolved_cgroup_root="$("${realpath_bin}" -e -- "${cgroup_root}")"
readonly resolved_cgroup_path="$("${realpath_bin}" -e -- "${cgroup_path}")"
case "${resolved_cgroup_path}" in
  "${resolved_cgroup_root}/"*) ;;
  *) die "The resolved cgroup path escaped its root." ;;
esac

[[ -r "${resolved_cgroup_path}/memory.current" ]] \
  || die "The service cgroup memory.current file is unavailable."
cgroup_memory_current="$(<"${resolved_cgroup_path}/memory.current")"
require_uint "cgroup memory.current" "${cgroup_memory_current}"
if (( cgroup_memory_current > memory_current )); then
  memory_current="${cgroup_memory_current}"
fi

if [[ -r "${resolved_cgroup_path}/memory.events" ]]; then
  read_memory_events "${resolved_cgroup_path}/memory.events"
fi
if [[ -r "${resolved_cgroup_path}/memory.swap.current" ]]; then
  memory_swap_current="$(<"${resolved_cgroup_path}/memory.swap.current")"
  is_uint "${memory_swap_current}" || memory_swap_current=0
fi
if [[ -r "${resolved_cgroup_path}/memory.pressure" ]]; then
  read_memory_pressure "${resolved_cgroup_path}/memory.pressure"
fi

# Enforce a rolling window rather than a resettable fixed bucket. A backward
# wall-clock adjustment keeps future-looking timestamps active and therefore
# cannot bypass the restart budget or cooldown.
if (( restart_epoch_newest > 0 && now_epoch >= restart_epoch_newest \
  && now_epoch - restart_epoch_newest >= budget_window_seconds )); then
  restart_epoch_newest=0
  restart_epoch_previous=0
elif (( restart_epoch_previous > 0 && now_epoch >= restart_epoch_previous \
  && now_epoch - restart_epoch_previous >= budget_window_seconds )); then
  restart_epoch_previous=0
fi
restart_count_in_window=0
(( restart_epoch_newest > 0 )) && restart_count_in_window=$((restart_count_in_window + 1))
(( restart_epoch_previous > 0 )) && restart_count_in_window=$((restart_count_in_window + 1))
last_restart_epoch="${restart_epoch_newest}"

if (( memory_current >= emergency_bytes )); then
  consecutive_samples="${required_samples}"
  trigger_kind="emergency"
elif (( memory_current >= restart_bytes )); then
  consecutive_samples=$((consecutive_samples + 1))
  trigger_kind="sustained"
elif (( memory_current >= warning_bytes )); then
  consecutive_samples=0
  # Long-lived memory above the warning threshold used to emit and atomically
  # rewrite state every ten seconds. Reuse the observation cadence to retain
  # useful telemetry without journal and filesystem churn.
  if (( persisted_consecutive_samples > 0 \
    || last_observation_epoch == 0 \
    || now_epoch < last_observation_epoch \
    || now_epoch - last_observation_epoch >= observation_interval_seconds )); then
    last_observation_epoch="${now_epoch}"
    write_state
    emit_event "bora_memory_watchdog_warning" "observe"
  fi
  exit 0
else
  consecutive_samples=0
  if (( dry_run == 1 && (last_observation_epoch == 0 \
    || now_epoch < last_observation_epoch \
    || now_epoch - last_observation_epoch >= observation_interval_seconds) )); then
    last_observation_epoch="${now_epoch}"
    write_state
    emit_event "bora_memory_watchdog_canary" "observe"
    exit 0
  fi
  # Persist only the transition away from a pending high-memory sample. All
  # restart-budget fields are already durable, and last_memory_bytes is
  # diagnostic-only, so an unchanged healthy probe requires no disk write.
  if (( persisted_consecutive_samples > 0 )); then
    write_state
  fi
  exit 0
fi

write_state
if (( consecutive_samples < required_samples )); then
  emit_event "bora_memory_watchdog_warning" "await_consecutive_sample"
  exit 0
fi

if (( last_restart_epoch > 0 && (now_epoch < last_restart_epoch \
  || now_epoch - last_restart_epoch < cooldown_seconds) )); then
  consecutive_samples=0
  write_state
  emit_event "bora_memory_watchdog_restart_suppressed" "cooldown"
  exit 0
fi

if (( restart_count_in_window >= max_restarts_per_window )); then
  consecutive_samples=0
  write_state
  emit_event "bora_memory_watchdog_restart_suppressed" "budget_exhausted"
  exit 0
fi

if (( dry_run == 1 )); then
  consecutive_samples=0
  write_state
  emit_event "bora_memory_watchdog_dry_run" "would_restart"
  exit 0
fi

# Persist the attempt before touching the service. A script crash or failed restart
# therefore cannot bypass the cooldown and restart budget.
previous_restart_epoch_newest="${restart_epoch_newest}"
previous_restart_epoch_previous="${restart_epoch_previous}"
restart_epoch_previous="${restart_epoch_newest}"
restart_epoch_newest="${now_epoch}"
last_restart_epoch="${now_epoch}"
restart_count_in_window=$((restart_count_in_window + 1))
consecutive_samples=0
write_state
emit_event "bora_memory_watchdog_restart_started" "restart"

helper_output=""
helper_status=0
if helper_output="$(/usr/bin/bash "${restart_helper}" --reason memory 2>&1)"; then
  helper_status=0
else
  helper_status=$?
fi
[[ -z "${helper_output}" ]] || printf '%s\n' "${helper_output}"

if [[ "${helper_output}" == *'"event":"bora_bridge_restart_skipped"'* \
  && "${helper_output}" == *'"action":"lock_busy"'* ]]; then
  restart_epoch_newest="${previous_restart_epoch_newest}"
  restart_epoch_previous="${previous_restart_epoch_previous}"
  last_restart_epoch="${restart_epoch_newest}"
  restart_count_in_window=0
  (( restart_epoch_newest > 0 )) && restart_count_in_window=$((restart_count_in_window + 1))
  (( restart_epoch_previous > 0 )) && restart_count_in_window=$((restart_count_in_window + 1))
  write_state
  emit_event "bora_memory_watchdog_restart_suppressed" "shared_restart_lock"
  exit 0
fi

if (( helper_status != 0 )); then
  emit_event "bora_memory_watchdog_restart_failed" "shared_helper_failed"
  exit "${helper_status}"
fi

if [[ "${helper_output}" != *'"event":"bora_bridge_restart_succeeded"'* ]]; then
  emit_event "bora_memory_watchdog_restart_failed" "unexpected_helper_result"
  exit 1
fi

memory_current=0
last_main_pid=0
write_state
emit_event "bora_memory_watchdog_restart_succeeded" "health_verified"
