#!/usr/bin/env bash
set -euo pipefail

readonly project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly watchdog="${project_root}/deploy/check-bora-bridge-memory.sh"
readonly restart_helper="${project_root}/deploy/restart-bora-bridge.sh"
readonly test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

readonly fake_bin="${test_root}/bin"
readonly fake_cgroup_root="${test_root}/cgroup"
readonly fake_cgroup="${fake_cgroup_root}/test.slice/bora-bridge.service"
readonly fake_home="${test_root}/home"
readonly state_root="${test_root}/state"
readonly restart_log="${test_root}/restarts"
readonly main_pid_file="${test_root}/main-pid"
readonly date_epoch_file="${test_root}/date-epoch"

mkdir -p -- "${fake_bin}" "${fake_cgroup}" "${fake_home}" "${state_root}"
printf '400\n' >"${fake_cgroup}/memory.current"
printf '10\n' >"${fake_cgroup}/memory.swap.current"
printf 'low 0\nhigh 3\nmax 0\noom 0\noom_kill 0\n' >"${fake_cgroup}/memory.events"
printf 'some avg10=1.25 avg60=0.20 avg300=0.10 total=10\nfull avg10=0.05 avg60=0.01 avg300=0.00 total=1\n' \
  >"${fake_cgroup}/memory.pressure"
printf '100\n' >"${main_pid_file}"
printf '1000000\n' >"${date_epoch_file}"

cat >"${fake_bin}/systemctl" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${*}" == *" show "* || "\${2:-}" == show ]]; then
  cat <<PROPERTIES
MemoryCurrent=390
MemoryPeak=500
ControlGroup=/test.slice/bora-bridge.service
ActiveState=active
SubState=running
MainPID=\$(<"${main_pid_file}")
NRestarts=0
PROPERTIES
  exit 0
fi
if [[ "\${*}" == *" restart "* ]]; then
  printf 'restart\n' >>"${restart_log}"
  exit 0
fi
exit 1
EOF

cat >"${fake_bin}/health" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${fake_bin}/date" <<EOF
#!/usr/bin/env bash
cat "${date_epoch_file}"
EOF

cat >"${fake_bin}/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${fake_bin}/install" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
after_separator=0
for argument in "$@"; do
  if (( after_separator == 1 )); then
    mkdir -p -- "${argument}"
  elif [[ "${argument}" == -- ]]; then
    after_separator=1
  fi
done
EOF

chmod 0700 \
  "${fake_bin}/systemctl" \
  "${fake_bin}/health" \
  "${fake_bin}/date" \
  "${fake_bin}/flock" \
  "${fake_bin}/install"

run_watchdog() {
  local selected_state_root="${1:-${state_root}}"
  local selected_dry_run="${2:-0}"
  local selected_restart_limit="${3:-1}"
  local selected_warning_bytes="${4:-200}"
  local selected_restart_bytes="${5:-300}"
  local selected_emergency_bytes="${6:-450}"
  HOME="${fake_home}" \
  BORA_MEMORY_WATCHDOG_WARNING_BYTES="${selected_warning_bytes}" \
  BORA_MEMORY_WATCHDOG_RESTART_BYTES="${selected_restart_bytes}" \
  BORA_MEMORY_WATCHDOG_EMERGENCY_BYTES="${selected_emergency_bytes}" \
  BORA_MEMORY_WATCHDOG_REQUIRED_SAMPLES=2 \
  BORA_MEMORY_WATCHDOG_COOLDOWN_SECONDS=300 \
  BORA_MEMORY_WATCHDOG_BUDGET_WINDOW_SECONDS=3600 \
  BORA_MEMORY_WATCHDOG_MAX_RESTARTS_PER_WINDOW="${selected_restart_limit}" \
  BORA_MEMORY_WATCHDOG_DRY_RUN="${selected_dry_run}" \
  BORA_MEMORY_WATCHDOG_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
  BORA_MEMORY_WATCHDOG_FLOCK_BIN="${fake_bin}/flock" \
  BORA_MEMORY_WATCHDOG_INSTALL_BIN="${fake_bin}/install" \
  BORA_MEMORY_WATCHDOG_DATE_BIN="${fake_bin}/date" \
  BORA_MEMORY_WATCHDOG_CGROUP_ROOT="${fake_cgroup_root}" \
  BORA_MEMORY_WATCHDOG_STATE_ROOT="${selected_state_root}" \
  BORA_MEMORY_WATCHDOG_RESTART_HELPER="${restart_helper}" \
  BORA_RESTART_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
  BORA_RESTART_FLOCK_BIN="${fake_bin}/flock" \
  BORA_RESTART_HEALTH_SCRIPT="${fake_bin}/health" \
  BORA_RESTART_HEALTH_ATTEMPTS=1 \
  BORA_RESTART_HEALTH_INTERVAL_SECONDS=1 \
  BORA_RESTART_RUNTIME_ROOT="${test_root}" \
  /usr/bin/bash "${watchdog}"
}

# A healthy live-mode probe is read-only: the 10-second timer must not create
# and replace a state file thousands of times per day.
healthy_state_root="${test_root}/healthy-state"
mkdir -p "${healthy_state_root}"
printf '100\n' >"${fake_cgroup}/memory.current"
healthy_output="$(run_watchdog "${healthy_state_root}" 0 1 600 700 800)"
[[ -z "${healthy_output}" ]]
[[ ! -e "${healthy_state_root}/bora-bridge-memory-watchdog/state" ]]

# Warning telemetry is rate-limited to the observation cadence. A pending
# high-memory sample is still reset durably as soon as usage becomes safe.
warning_state_root="${test_root}/warning-state"
mkdir -p "${warning_state_root}"
printf '250\n' >"${fake_cgroup}/memory.current"
warning_first="$(run_watchdog "${warning_state_root}" 0 1 200 500 600)"
warning_second="$(run_watchdog "${warning_state_root}" 0 1 200 500 600)"
[[ "${warning_first}" == *'"event":"bora_memory_watchdog_warning"'* ]]
[[ -z "${warning_second}" ]]

printf '400\n' >"${fake_cgroup}/memory.current"

first_output="$(run_watchdog)"
[[ "${first_output}" == *'"action":"await_consecutive_sample"'* ]]
[[ ! -e "${restart_log}" ]]

second_output="$(run_watchdog)"
[[ "${second_output}" == *'"action":"health_verified"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 1 ]]

cat >"${fake_bin}/flock-busy" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod 0700 "${fake_bin}/flock-busy"
lock_output="$(
  BORA_RESTART_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
  BORA_RESTART_FLOCK_BIN="${fake_bin}/flock-busy" \
  BORA_RESTART_HEALTH_SCRIPT="${fake_bin}/health" \
  BORA_RESTART_RUNTIME_ROOT="${test_root}" \
  /usr/bin/bash "${restart_helper}" --reason memory
)"
[[ "${lock_output}" == *'"action":"lock_busy"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 1 ]]

already_healthy_output="$(
  BORA_RESTART_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
  BORA_RESTART_FLOCK_BIN="${fake_bin}/flock" \
  BORA_RESTART_HEALTH_SCRIPT="${fake_bin}/health" \
  BORA_RESTART_RUNTIME_ROOT="${test_root}" \
  /usr/bin/bash "${restart_helper}" --reason health
)"
[[ "${already_healthy_output}" == *'"action":"already_healthy"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 1 ]]

third_output="$(run_watchdog)"
[[ "${third_output}" == *'"action":"await_consecutive_sample"'* ]]
fourth_output="$(run_watchdog)"
[[ "${fourth_output}" == *'"action":"cooldown"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 1 ]]

emergency_state_root="${test_root}/emergency-state"
mkdir -p "${emergency_state_root}"
printf '500\n' >"${fake_cgroup}/memory.current"
emergency_output="$(run_watchdog "${emergency_state_root}" 1)"
[[ "${emergency_output}" == *'"event":"bora_memory_watchdog_dry_run"'* ]]
[[ "${emergency_output}" == *'"trigger":"emergency"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 1 ]]

# A process generation change between samples invalidates the first sample.
generation_state_root="${test_root}/generation-state"
mkdir -p "${generation_state_root}"
rm -f -- "${restart_log}"
printf '400\n' >"${fake_cgroup}/memory.current"
printf '1000000\n' >"${date_epoch_file}"
printf '100\n' >"${main_pid_file}"
generation_first="$(run_watchdog "${generation_state_root}" 0 2)"
[[ "${generation_first}" == *'"action":"await_consecutive_sample"'* ]]
printf '200\n' >"${main_pid_file}"
generation_second="$(run_watchdog "${generation_state_root}" 0 2)"
[[ "${generation_second}" == *'"action":"await_consecutive_sample"'* ]]
[[ ! -e "${restart_log}" ]]
generation_third="$(run_watchdog "${generation_state_root}" 0 2)"
[[ "${generation_third}" == *'"action":"health_verified"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 1 ]]

# A corrupt state is quarantined and conservatively leaves only one rolling
# restart slot instead of disabling the watchdog forever or resetting budget.
corrupt_state_root="${test_root}/corrupt-state"
mkdir -p "${corrupt_state_root}/bora-bridge-memory-watchdog"
printf 'consecutive_samples=1\n' \
  >"${corrupt_state_root}/bora-bridge-memory-watchdog/state"
corrupt_output="$(run_watchdog "${corrupt_state_root}" 1 2 2>&1)"
[[ "${corrupt_output}" == *'"event":"bora_memory_watchdog_state_recovered"'* ]]
[[ "${corrupt_output}" == *'"action":"await_consecutive_sample"'* ]]
[[ -f "${corrupt_state_root}/bora-bridge-memory-watchdog/state.corrupt.1000000" ]]

# The restart budget is a rolling window: two restarts just before a fixed
# bucket boundary still suppress a third restart immediately after it.
rolling_state_root="${test_root}/rolling-state"
mkdir -p "${rolling_state_root}"
rm -f -- "${restart_log}"
printf '300\n' >"${main_pid_file}"
printf '1003000\n' >"${date_epoch_file}"
run_watchdog "${rolling_state_root}" 0 2 >/dev/null
run_watchdog "${rolling_state_root}" 0 2 >/dev/null
printf '1003300\n' >"${date_epoch_file}"
run_watchdog "${rolling_state_root}" 0 2 >/dev/null
run_watchdog "${rolling_state_root}" 0 2 >/dev/null
[[ "$(wc -l <"${restart_log}")" -eq 2 ]]
printf '1003601\n' >"${date_epoch_file}"
run_watchdog "${rolling_state_root}" 0 2 >/dev/null
rolling_suppressed="$(run_watchdog "${rolling_state_root}" 0 2)"
[[ "${rolling_suppressed}" == *'"action":"budget_exhausted"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 2 ]]

# Moving wall time backwards cannot bypass the latest restart cooldown.
printf '1003200\n' >"${date_epoch_file}"
run_watchdog "${rolling_state_root}" 0 2 >/dev/null
clock_rollback="$(run_watchdog "${rolling_state_root}" 0 2)"
[[ "${clock_rollback}" == *'"action":"cooldown"'* ]]
[[ "$(wc -l <"${restart_log}")" -eq 2 ]]

# Exercise the real flock implementation on Linux CI when available. Whether
# health or memory wins the lock, at most one restart may occur.
if command -v flock >/dev/null 2>&1; then
  rm -f -- "${restart_log}"
  BORA_RESTART_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
  BORA_RESTART_FLOCK_BIN="$(command -v flock)" \
  BORA_RESTART_HEALTH_SCRIPT="${fake_bin}/health" \
  BORA_RESTART_RUNTIME_ROOT="${test_root}" \
  /usr/bin/bash "${restart_helper}" --reason memory >/dev/null &
  memory_restart_pid=$!
  BORA_RESTART_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
  BORA_RESTART_FLOCK_BIN="$(command -v flock)" \
  BORA_RESTART_HEALTH_SCRIPT="${fake_bin}/health" \
  BORA_RESTART_RUNTIME_ROOT="${test_root}" \
  /usr/bin/bash "${restart_helper}" --reason health >/dev/null &
  health_restart_pid=$!
  wait "${memory_restart_pid}" "${health_restart_pid}"
  [[ "$(wc -l <"${restart_log}")" -eq 1 ]]
fi

[[ ! -e "${project_root}/0700" ]]

printf 'memory watchdog integration test passed\n'
