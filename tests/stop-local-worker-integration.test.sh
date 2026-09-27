#!/usr/bin/env bash
set -euo pipefail

readonly project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly stop_script="${project_root}/deploy/stop-local-worker.sh"
readonly test_root="$(mktemp -d "${TMPDIR:-/tmp}/bora-stop-local-worker.XXXXXXXX")"

cleanup() {
  case "${test_root}" in
    "${TMPDIR:-/tmp}"/bora-stop-local-worker.*)
      rm -rf -- "${test_root}"
      ;;
    *)
      printf 'Refusing unsafe test cleanup: %s\n' "${test_root}" >&2
      ;;
  esac
}
trap cleanup EXIT

fail_test() {
  printf 'stop-local-worker integration failure: %s\n' "$*" >&2
  exit 1
}

new_case() {
  local name="$1"
  case_root="${test_root}/${name}"
  fake_bin="${case_root}/bin"
  fake_proc="${case_root}/proc"
  fake_cgroup_root="${case_root}/cgroup"
  fake_cgroup="${fake_cgroup_root}/test.slice/bora-bridge.service"
  main_pid_file="${case_root}/main-pid"
  control_group_file="${case_root}/control-group"
  kill_log="${case_root}/kill.log"
  remove_on_term_file="${case_root}/remove-on-term"
  mkdir -p "${fake_bin}" "${fake_proc}" "${fake_cgroup}"
  printf '101\n' >"${main_pid_file}"
  printf '/test.slice/bora-bridge.service\n' >"${control_group_file}"
  : >"${fake_cgroup}/cgroup.procs"
  : >"${kill_log}"
  printf '1\n' >"${remove_on_term_file}"

  cat >"${fake_bin}/systemctl" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
printf 'MainPID=%s\\n' "\$(<"${main_pid_file}")"
printf 'ControlGroup=%s\\n' "\$(<"${control_group_file}")"
SCRIPT
  cat >"${fake_bin}/kill" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\$*" >>"${kill_log}"
pid="\${3:-}"
if [[ "\$(<"${remove_on_term_file}")" == 1 && "\${pid}" =~ ^[0-9]+\$ ]]; then
  rm -f -- "${fake_proc}/\${pid}/cmdline" "${fake_proc}/\${pid}/cgroup"
  rmdir -- "${fake_proc}/\${pid}" 2>/dev/null || true
fi
SCRIPT
  cat >"${fake_bin}/sleep" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
  chmod 0700 "${fake_bin}/systemctl" "${fake_bin}/kill" "${fake_bin}/sleep"
}

write_process() {
  local pid="$1"
  shift
  mkdir -p "${fake_proc}/${pid}"
  printf '0::/test.slice/bora-bridge.service\n' >"${fake_proc}/${pid}/cgroup"
  printf '%s\0' "$@" >"${fake_proc}/${pid}/cmdline"
}

expected_runner_argv() {
  runner_argv=(
    /opt/bora/node
    /srv/bora/scripts/start-local-worker.mjs
    --config /run/user/1000/bora-bridge/wrangler.runtime.json
    --persist-to /srv/bora/.wrangler/state
    --host 127.0.0.1
    --port 3000
  )
}

run_helper() {
  env \
    BORA_STOP_PROJECT_ROOT=/srv/bora \
    BORA_STOP_NODE_BIN=/opt/bora/node \
    BORA_STOP_RUNNER_PATH=/srv/bora/scripts/start-local-worker.mjs \
    BORA_STOP_RUNTIME_ROOT=/run/user/1000/bora-bridge \
    BORA_STOP_RUNTIME_CONFIG=/run/user/1000/bora-bridge/wrangler.runtime.json \
    BORA_STOP_PERSISTENCE_PATH=/srv/bora/.wrangler/state \
    BORA_STOP_PROC_ROOT="${fake_proc}" \
    BORA_STOP_CGROUP_ROOT="${fake_cgroup_root}" \
    BORA_STOP_SYSTEMCTL_BIN="${fake_bin}/systemctl" \
    BORA_STOP_KILL_BIN="${fake_bin}/kill" \
    BORA_STOP_SLEEP_BIN="${fake_bin}/sleep" \
    BORA_STOP_TRUSTED_EXECUTABLE_UID="$(id -u)" \
    BORA_STOP_TIMEOUT_SECONDS="${BORA_TEST_TIMEOUT_SECONDS:-2}" \
    bash "${stop_script}"
}

expected_runner_argv

# Ubuntu can package core utilities behind symlinks. The helper must resolve
# the target and execute the canonical regular file instead of rejecting an
# otherwise valid graceful-stop dependency.
new_case symlinked-sleep
mv -- "${fake_bin}/sleep" "${fake_bin}/sleep-real"
ln -s -- sleep-real "${fake_bin}/sleep"
write_process 91 "${runner_argv[@]}"
printf '91\n' >"${main_pid_file}"
printf '91\n' >"${fake_cgroup}/cgroup.procs"
run_helper >/dev/null
[[ "$(<"${kill_log}")" == '-TERM -- 91' ]] \
  || fail_test "a valid symlinked sleep executable prevented graceful shutdown"

# Resolving a symlink must not turn into a blanket trust bypass. A target that
# the service user (or another unprivileged user) can rewrite is rejected before
# any production process is signalled.
new_case writable-sleep-target
chmod 0777 "${fake_bin}/sleep"
sleep_mode="$(stat --format='%a' "${fake_bin}/sleep")"
if (( (8#${sleep_mode} & 8#022) != 0 )); then
  write_process 92 "${runner_argv[@]}"
  printf '92\n' >"${main_pid_file}"
  printf '92\n' >"${fake_cgroup}/cgroup.procs"
  if run_helper >/dev/null 2>&1; then
    fail_test "a group/other-writable executable target was accepted"
  fi
  [[ ! -s "${kill_log}" ]] \
    || fail_test "an unsafe executable target led to a signal"
fi

# Bubblewrap is commonly MainPID; the helper must find the one exact Node
# runner in cgroup.procs and terminate only it.
new_case one-runner
write_process 101 /usr/bin/bwrap --new-session
write_process 202 "${runner_argv[@]}"
printf '101\n202\n' >"${fake_cgroup}/cgroup.procs"
run_helper >/dev/null
[[ "$(<"${kill_log}")" == '-TERM -- 202' ]] \
  || fail_test "the exact cgroup runner was not the sole signal target"

# A validated Node MainPID follows the same exact-argv path.
new_case main-pid-runner
printf '303\n' >"${main_pid_file}"
write_process 303 "${runner_argv[@]}"
printf '303\n' >"${fake_cgroup}/cgroup.procs"
run_helper >/dev/null
[[ "$(<"${kill_log}")" == '-TERM -- 303' ]] \
  || fail_test "the validated MainPID was not terminated"

# Multiple exact matches are an unsafe state: signal nobody and fail.
new_case multiple-runners
write_process 401 "${runner_argv[@]}"
write_process 402 "${runner_argv[@]}"
printf '401\n402\n' >"${fake_cgroup}/cgroup.procs"
if run_helper >/dev/null 2>&1; then
  fail_test "multiple matching runners were accepted"
fi
[[ ! -s "${kill_log}" ]] || fail_test "a runner was signalled in an ambiguous cgroup"

# Similar Node processes with any argv difference are not production targets.
new_case near-match
near_argv=("${runner_argv[@]}")
near_argv[9]=3001
write_process 501 "${near_argv[@]}"
printf '501\n' >"${fake_cgroup}/cgroup.procs"
run_helper >/dev/null
[[ ! -s "${kill_log}" ]] || fail_test "a near-match process was signalled"

# A stuck exact runner receives one SIGTERM, never SIGKILL, and times out.
new_case timeout
printf '0\n' >"${remove_on_term_file}"
write_process 601 "${runner_argv[@]}"
printf '601\n' >"${fake_cgroup}/cgroup.procs"
if BORA_TEST_TIMEOUT_SECONDS=1 run_helper >/dev/null 2>&1; then
  fail_test "a stuck runner reported a successful stop"
fi
[[ "$(<"${kill_log}")" == '-TERM -- 601' ]] \
  || fail_test "the stuck runner did not receive exactly one SIGTERM"

# Malformed systemd cgroup metadata is rejected before any process inspection.
new_case unsafe-cgroup
printf '/../bora-bridge.service\n' >"${control_group_file}"
if run_helper >/dev/null 2>&1; then
  fail_test "unsafe control-group metadata was accepted"
fi
[[ ! -s "${kill_log}" ]] || fail_test "unsafe metadata led to a signal"

printf 'stop-local-worker integration tests passed\n'
