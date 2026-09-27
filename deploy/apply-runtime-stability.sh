#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
USER_CONFIG_PARENT="$(bora_config_home)" || exit 2
readonly USER_CONFIG_PARENT
readonly USER_UNIT_ROOT="${USER_CONFIG_PARENT}/systemd/user"
readonly USER_CONFIG_ROOT="${USER_CONFIG_PARENT}/bora-bridge"
SQLITE_BIN="$(bora_tool_path BORA_SQLITE_BIN sqlite3)" || exit 2
readonly SQLITE_BIN
NODE_BIN="$(bora_tool_path BORA_NODE_BIN node)" || exit 2
readonly NODE_BIN
readonly D1_ROOT="${PROJECT_ROOT}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
D1_FILE="$(bora_d1_file "${PROJECT_ROOT}")" || exit 2
readonly D1_FILE
readonly INPUT_STAGE="${1:-}"
readonly FORCED_FAILPOINT="${BORA_RUNTIME_STABILITY_FAILPOINT:-}"
readonly BACKUP_ROOT="${PROJECT_ROOT}/.deploy-backups"
readonly APP_SERVICE="bora-bridge.service"
readonly HEALTH_TIMER="bora-bridge-healthcheck.timer"
readonly WATCHDOG_TIMER="bora-bridge-memory-watchdog.timer"

RUNTIME_UID="$(/usr/bin/id -u)" \
  || { printf 'Unable to resolve the deployment uid.\n' >&2; exit 2; }
DEPLOY_USER="$(/usr/bin/id -un)" \
  || { printf 'Unable to resolve the deployment user.\n' >&2; exit 2; }
STAMP="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)" \
  || { printf 'Unable to create a deployment timestamp.\n' >&2; exit 2; }
[[ "${RUNTIME_UID}" =~ ^[0-9]+$ && "${STAMP}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] \
  || { printf 'Deployment identity or timestamp validation failed.\n' >&2; exit 2; }
RUNTIME_ROOT="${XDG_RUNTIME_DIR:-/run/user/${RUNTIME_UID}}"
LOCK_FILE="${RUNTIME_ROOT}/bora-runtime-stability-release.lock"
BACKUP_DIR=""
readonly RUNTIME_UID DEPLOY_USER STAMP RUNTIME_ROOT LOCK_FILE
config_root_created=0

readonly SOURCE_FILES=(
  "deploy/deployment-paths.sh"
  "deploy/install-user-units.sh"
  "scripts/build-local-runtime-config.mjs"
  "scripts/start-local-worker.mjs"
  "deploy/run-bora-sandbox.sh"
  "deploy/stop-local-worker.sh"
  "deploy/bora-bridge.service"
  "deploy/check-bora-bridge-health.sh"
  "deploy/check-runtime-autostart.sh"
  "deploy/bora-bridge-healthcheck.service"
  "deploy/bora-bridge-healthcheck.timer"
  "deploy/restart-bora-bridge.sh"
  "deploy/restart.env.example"
  "deploy/bora-bridge-recover.service"
  "deploy/check-bora-bridge-memory.sh"
  "deploy/bora-bridge-memory-watchdog.service"
  "deploy/bora-bridge-memory-watchdog.timer"
  "deploy/memory-watchdog.env.example"
  "deploy/install-bora-bridge-memory-watchdog.sh"
  "deploy/apply-runtime-stability.sh"
)
readonly SHELL_FILES=(
  "deploy/deployment-paths.sh"
  "deploy/install-user-units.sh"
  "deploy/run-bora-sandbox.sh"
  "deploy/stop-local-worker.sh"
  "deploy/check-bora-bridge-health.sh"
  "deploy/check-runtime-autostart.sh"
  "deploy/restart-bora-bridge.sh"
  "deploy/check-bora-bridge-memory.sh"
  "deploy/install-bora-bridge-memory-watchdog.sh"
  "deploy/apply-runtime-stability.sh"
)
readonly NODE_FILES=(
  "scripts/build-local-runtime-config.mjs"
  "scripts/start-local-worker.mjs"
)
readonly UNIT_FILES=(
  "bora-bridge.service"
  "bora-bridge-healthcheck.service"
  "bora-bridge-healthcheck.timer"
  "bora-bridge-recover.service"
  "bora-bridge-memory-watchdog.service"
  "bora-bridge-memory-watchdog.timer"
)

fail() {
  printf 'bora-runtime-stability: %s\n' "$*" >&2
  exit 2
}

source_mode() {
  case "$1" in
    *.sh|scripts/start-local-worker.mjs) printf '0700\n' ;;
    *) printf '0644\n' ;;
  esac
}

validate_private_optional_config() {
  local target="$1"

  if [[ -e "${target}" || -L "${target}" ]]; then
    [[ -f "${target}" && ! -L "${target}" ]] \
      || fail "Private configuration is not a regular file: ${target}"
    [[ "$(/usr/bin/stat -c '%U' -- "${target}")" == "${DEPLOY_USER}" ]] \
      || fail "Private configuration has the wrong owner: ${target}"
    [[ "$(/usr/bin/stat -c '%a' -- "${target}")" == '600' ]] \
      || fail "Private configuration must have mode 0600: ${target}"
  fi
}

trigger_failpoint() {
  local point="$1"
  if [[ "${FORCED_FAILPOINT}" == "${point}" ]]; then
    fail "Forced validation failure at ${point}."
  fi
}

canonical_health_once() {
  local body
  body="$(/usr/bin/curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    --header 'Host: borabridge.com' \
    --header 'X-Forwarded-Host: borabridge.com' \
    --header 'X-Forwarded-Proto: https' \
    --header 'Origin: https://borabridge.com' \
    'http://127.0.0.1:3000/api/health' 2>/dev/null || true)"
  [[ "${body}" == '{"status":"ok"}' ]]
}

wait_for_canonical_health() {
  local attempt
  for attempt in $(/usr/bin/seq 1 30); do
    if canonical_health_once; then
      return 0
    fi
    /usr/bin/sleep 2
  done
  return 1
}

capture_file() {
  local target="$1"
  local label="$2"
  local destination="${BACKUP_DIR}/files/${label}"

  if [[ -L "${target}" ]]; then
    fail "Refusing to back up a symbolic link: ${target}"
  fi
  if [[ -e "${target}" ]]; then
    [[ -f "${target}" ]] || fail "Expected a regular file: ${target}"
    /usr/bin/install -d -m 0700 -- "$(/usr/bin/dirname -- "${destination}")"
    /usr/bin/cp -a --reflink=auto -- "${target}" "${destination}"
    printf 'present\n' >"${destination}.state"
  else
    /usr/bin/install -d -m 0700 -- "$(/usr/bin/dirname -- "${destination}")"
    printf 'missing\n' >"${destination}.state"
  fi
}

restore_file() {
  local target="$1"
  local label="$2"
  local source="${BACKUP_DIR}/files/${label}"
  local state_file="${source}.state"
  local state
  local target_directory
  local target_name
  local temporary

  [[ -f "${state_file}" && ! -L "${state_file}" ]] || return 1
  state="$(<"${state_file}")"
  target_directory="$(/usr/bin/dirname -- "${target}")" || return 1
  target_name="$(/usr/bin/basename -- "${target}")" || return 1
  [[ -d "${target_directory}" && ! -L "${target_directory}" \
    && "$(/usr/bin/readlink -f -- "${target_directory}")" == "${target_directory}" ]] \
    || return 1
  case "${state}" in
    present)
      [[ -f "${source}" && ! -L "${source}" ]] || return 1
      temporary="$(/usr/bin/mktemp \
        --tmpdir="${target_directory}" \
        ".${target_name}.bora-rollback.XXXXXX")" || return 1
      if ! /usr/bin/cp -a --reflink=auto -- "${source}" "${temporary}" \
        || ! /usr/bin/mv -fT -- "${temporary}" "${target}"; then
        /usr/bin/rm -f -- "${temporary}"
        return 1
      fi
      /usr/bin/cmp --silent -- "${source}" "${target}" || return 1
      ;;
    missing)
      /usr/bin/rm -f -- "${target}" || return 1
      [[ ! -e "${target}" && ! -L "${target}" ]] || return 1
      ;;
    *) return 1 ;;
  esac
}

atomic_install() {
  local source="$1"
  local target="$2"
  local mode="$3"
  local target_directory
  local target_name
  local temporary

  target_directory="$(/usr/bin/dirname -- "${target}")" || return 1
  target_name="$(/usr/bin/basename -- "${target}")" || return 1
  [[ -d "${target_directory}" && ! -L "${target_directory}" \
    && "$(/usr/bin/readlink -f -- "${target_directory}")" == "${target_directory}" ]] \
    || return 1
  temporary="$(/usr/bin/mktemp \
    --tmpdir="${target_directory}" \
    ".${target_name}.bora-install.XXXXXX")" || return 1
  if ! /usr/bin/install -m "${mode}" -- "${source}" "${temporary}" \
    || ! /usr/bin/mv -fT -- "${temporary}" "${target}"; then
    /usr/bin/rm -f -- "${temporary}"
    return 1
  fi
}

restore_timer_state() {
  local timer="$1"
  local enabled_state="$2"
  local active_state="$3"
  local failed=0

  case "${enabled_state}" in
    enabled)
      /usr/bin/systemctl --user enable "${timer}" >/dev/null || failed=1
      ;;
    enabled-runtime)
      /usr/bin/systemctl --user enable --runtime "${timer}" >/dev/null || failed=1
      ;;
    disabled|not-found)
      /usr/bin/systemctl --user disable "${timer}" >/dev/null 2>&1 || true
      ;;
    *) failed=1 ;;
  esac
  case "${active_state}" in
    active)
      /usr/bin/systemctl --user start "${timer}" || failed=1
      ;;
    inactive|failed|unknown)
      /usr/bin/systemctl --user stop "${timer}" >/dev/null 2>&1 || true
      ;;
    *) failed=1 ;;
  esac
  return "${failed}"
}

case "${INPUT_STAGE}" in
  /tmp/bora-runtime-stability-*|/tmp/bora-stability-*) ;;
  *) fail "A stage below /tmp/bora-runtime-stability-* is required." ;;
esac
case "${FORCED_FAILPOINT}" in
  ''|after-source-install|after-app-start) ;;
  *) fail "Unsupported BORA_RUNTIME_STABILITY_FAILPOINT value." ;;
esac
[[ -d "${INPUT_STAGE}" && ! -L "${INPUT_STAGE}" ]] \
  || fail "The stage directory is missing or symbolic."
[[ "$(/usr/bin/readlink -f -- "${INPUT_STAGE}")" == "${INPUT_STAGE}" ]] \
  || fail "The stage path must be canonical."
[[ "$(/usr/bin/stat -c '%U' -- "${INPUT_STAGE}")" == "${DEPLOY_USER}" ]] \
  || fail "The stage directory must be owned by the deploying user."
stage_mode="$(/usr/bin/stat -c '%a' -- "${INPUT_STAGE}")"
(( (8#${stage_mode} & 8#022) == 0 )) \
  || fail "The stage directory must not be group- or world-writable."

for required_directory in \
  "${PROJECT_ROOT}" \
  "${USER_CONFIG_PARENT}" \
  "${USER_UNIT_ROOT}" \
  "${RUNTIME_ROOT}"
do
  [[ -d "${required_directory}" && ! -L "${required_directory}" ]] \
    || fail "Required directory is missing or symbolic: ${required_directory}"
  [[ "$(/usr/bin/readlink -f -- "${required_directory}")" == "${required_directory}" ]] \
    || fail "Required directory is not canonical: ${required_directory}"
done
for required_binary in \
  /usr/bin/bash \
  /usr/bin/curl \
  /usr/bin/cmp \
  /usr/bin/find \
  /usr/bin/flock \
  /usr/bin/systemctl \
  /usr/bin/systemd-analyze \
  /usr/bin/sha256sum \
  "${NODE_BIN}" \
  "${SQLITE_BIN}"
do
  [[ -x "${required_binary}" ]] || fail "Required executable is unavailable: ${required_binary}"
done
[[ -f "${D1_FILE}" && ! -L "${D1_FILE}" ]] \
  || fail "The production D1 database is missing or symbolic."
[[ -d "${D1_ROOT}" && ! -L "${D1_ROOT}" \
  && "$(/usr/bin/readlink -f -- "${D1_ROOT}")" == "${D1_ROOT}" ]] \
  || fail "The production D1 root is unsafe."
if [[ -e "${D1_ROOT}/metadata.sqlite" ]]; then
  [[ -f "${D1_ROOT}/metadata.sqlite" && ! -L "${D1_ROOT}/metadata.sqlite" ]] \
    || fail "The Miniflare metadata database is unsafe."
fi
mapfile -d '' d1_candidates < <(
  /usr/bin/find "${D1_ROOT}" -maxdepth 1 -type f -name '*.sqlite' \
    ! -name 'metadata.sqlite' -print0
)
(( ${#d1_candidates[@]} == 1 )) \
  || fail "The production D1 root must contain exactly one database."
[[ "$(/usr/bin/readlink -f -- "${d1_candidates[0]}")" == "${D1_FILE}" ]] \
  || fail "The expected D1 file is not the sole production database."
d1_sentinel_count="$("${SQLITE_BIN}" -readonly "${D1_FILE}" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('auth_sessions','oauth_users','public_api_source_state');")"
[[ "${d1_sentinel_count}" == '3' ]] \
  || fail "The expected D1 file does not contain the production schema."

exec 9>"${LOCK_FILE}"
/usr/bin/flock -n 9 || fail "Another runtime stability deployment is already running."

WORK_STAGE="$(/usr/bin/mktemp -d \
  --tmpdir="${RUNTIME_ROOT}" \
  bora-runtime-stability-stage.XXXXXX)" \
  || fail "Unable to create a protected validation stage."
readonly WORK_STAGE
[[ "$(/usr/bin/readlink -f -- "${WORK_STAGE}")" == "${RUNTIME_ROOT}/bora-runtime-stability-stage."* ]] \
  || fail "The protected validation stage escaped its runtime root."
cleanup_work_stage() {
  if [[ -d "${WORK_STAGE}" \
    && ! -L "${WORK_STAGE}" \
    && "$(/usr/bin/readlink -f -- "${WORK_STAGE}")" == "${RUNTIME_ROOT}/bora-runtime-stability-stage."* ]]; then
    /usr/bin/rm -rf -- "${WORK_STAGE}"
  fi
  if (( config_root_created == 1 )) \
    && [[ -d "${USER_CONFIG_ROOT}" && ! -L "${USER_CONFIG_ROOT}" ]] \
    && [[ "$(/usr/bin/readlink -f -- "${USER_CONFIG_ROOT}")" == "${USER_CONFIG_ROOT}" ]]; then
    /usr/bin/rmdir -- "${USER_CONFIG_ROOT}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_work_stage EXIT

for staged_directory in scripts deploy; do
  staged_path="${INPUT_STAGE}/${staged_directory}"
  [[ -d "${staged_path}" && ! -L "${staged_path}" ]] \
    || fail "Missing or unsafe staged directory: ${staged_directory}"
  [[ "$(/usr/bin/readlink -f -- "${staged_path}")" == "${staged_path}" ]] \
    || fail "Staged directory is not canonical: ${staged_directory}"
  [[ "$(/usr/bin/stat -c '%U' -- "${staged_path}")" == "${DEPLOY_USER}" ]] \
    || fail "Staged directory has the wrong owner: ${staged_directory}"
  staged_mode="$(/usr/bin/stat -c '%a' -- "${staged_path}")"
  (( (8#${staged_mode} & 8#022) == 0 )) \
    || fail "Staged directory is group- or world-writable: ${staged_directory}"
done

for relative in "${SOURCE_FILES[@]}"; do
  source_path="${INPUT_STAGE}/${relative}"
  destination_path="${WORK_STAGE}/${relative}"
  [[ -f "${source_path}" && ! -L "${source_path}" ]] \
    || fail "Missing or unsafe staged artifact: ${relative}"
  case "$(/usr/bin/readlink -f -- "${source_path}")" in
    "${INPUT_STAGE}/"*) ;;
    *) fail "Staged artifact escaped the stage directory: ${relative}" ;;
  esac
  [[ "$(/usr/bin/stat -c '%U' -- "${source_path}")" == "${DEPLOY_USER}" ]] \
    || fail "Staged artifact has the wrong owner: ${relative}"
  source_path_mode="$(/usr/bin/stat -c '%a' -- "${source_path}")"
  (( (8#${source_path_mode} & 8#022) == 0 )) \
    || fail "Staged artifact is group- or world-writable: ${relative}"
  /usr/bin/install -d -m 0700 -- "$(/usr/bin/dirname -- "${destination_path}")"
  /usr/bin/install -m "$(source_mode "${relative}")" -- "${source_path}" "${destination_path}"
done

for relative in "${SHELL_FILES[@]}"; do
  /usr/bin/bash -n "${WORK_STAGE}/${relative}"
done
for relative in "${NODE_FILES[@]}"; do
  "${NODE_BIN}" --check "${WORK_STAGE}/${relative}"
done
# Keep source templates byte-identical for rollback/manifests, and validate
# exactly the rendered units that will be installed for this checkout.
/usr/bin/install -d -m 0700 "${WORK_STAGE}/rendered-units"
for unit in "${UNIT_FILES[@]}"; do
  bora_render_unit "${WORK_STAGE}/deploy/${unit}" "${PROJECT_ROOT}" \
    >"${WORK_STAGE}/rendered-units/${unit}"
done
/usr/bin/systemd-analyze --user verify "${WORK_STAGE}/rendered-units/"*

/usr/bin/grep -Fq 'inspector: false' \
  "${WORK_STAGE}/scripts/start-local-worker.mjs" \
  || fail "The staged local worker runner does not disable the inspector."
/usr/bin/grep -Fq 'CANARY_RUNTIME_CONFIG=' \
  "${WORK_STAGE}/deploy/run-bora-sandbox.sh" \
  || fail "The staged sandbox wrapper is missing the bounded canary config."
/usr/bin/grep -Fq 'scripts/start-local-worker.mjs' \
  "${WORK_STAGE}/deploy/run-bora-sandbox.sh" \
  || fail "The staged sandbox wrapper does not use the inspectorless runner."
/usr/bin/grep -Fxq 'ExecStop=/usr/bin/bash deploy/stop-local-worker.sh' \
  "${WORK_STAGE}/deploy/bora-bridge.service" \
  || fail "The application unit is missing the bounded graceful-stop helper."
for policy in 'MemoryHigh=3750M' 'MemoryMax=4G' 'MemorySwapMax=256M' 'OOMPolicy=stop'; do
  /usr/bin/grep -Fxq "${policy}" "${WORK_STAGE}/deploy/bora-bridge.service" \
    || fail "The staged application unit is missing policy: ${policy}"
done
/usr/bin/grep -Fxq 'BORA_MEMORY_WATCHDOG_DRY_RUN=0' \
  "${WORK_STAGE}/deploy/memory-watchdog.env.example" \
  || fail "The watchdog must be deployed with bounded live recovery enabled."
if /usr/bin/grep -Eq '^BORA_MEMORY_WATCHDOG_DRY_RUN=(1|true|yes)$' \
  "${WORK_STAGE}/deploy/memory-watchdog.env.example"; then
  fail "The staged watchdog environment disables controlled recovery."
fi
/usr/bin/grep -Eq '^SuccessExitStatus=.*(143|SIGTERM)' \
  "${WORK_STAGE}/deploy/bora-bridge.service" \
  || fail "The application unit does not accept an orderly runner shutdown."

readonly VALIDATION_DIR="${WORK_STAGE}/generator-validation"
/usr/bin/install -d -m 0700 -- "${VALIDATION_DIR}"
printf 'APP_BASE_URL=https://borabridge.com\nVALIDATION_SECRET=not-for-logs\n' \
  >"${VALIDATION_DIR}/environment"
printf '{"name":"bora-validation","main":"index.js","assets":{"directory":"../client"},"dev":{"ip":"127.0.0.1"}}\n' \
  >"${VALIDATION_DIR}/wrangler.json"
generator_output="$(cd "${VALIDATION_DIR}" && "${NODE_BIN}" \
  "${WORK_STAGE}/scripts/build-local-runtime-config.mjs" \
  environment wrangler.json runtime.json)"
[[ "${generator_output}" != *'not-for-logs'* ]] \
  || fail "The staged runtime generator logged a binding value."
"${NODE_BIN}" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value?.vars?.VALIDATION_SECRET !== "not-for-logs") process.exit(1);
  if (!require("node:path").isAbsolute(value?.main ?? "")) process.exit(1);
' "${VALIDATION_DIR}/runtime.json" \
  || fail "The staged runtime generator failed its inspector-safe smoke test."

[[ ! -L "${BACKUP_ROOT}" ]] || fail "The deployment backup root is symbolic."
/usr/bin/install -d -m 0700 -- "${BACKUP_ROOT}"
[[ "$(/usr/bin/readlink -f -- "${BACKUP_ROOT}")" == "${BACKUP_ROOT}" ]] \
  || fail "The deployment backup root is not canonical."
BACKUP_DIR="$(/usr/bin/mktemp -d \
  --tmpdir="${BACKUP_ROOT}" \
  "runtime-stability-${STAMP}.XXXXXX")" \
  || fail "Unable to create a private deployment backup."
readonly BACKUP_DIR
[[ "$(/usr/bin/readlink -f -- "${BACKUP_DIR}")" == "${BACKUP_ROOT}/runtime-stability-${STAMP}."* ]] \
  || fail "The deployment backup escaped its root."
/usr/bin/install -d -m 0700 -- "${BACKUP_DIR}/files"
(
  cd "${WORK_STAGE}"
  printf '%s\0' "${SOURCE_FILES[@]}" \
    | LC_ALL=C /usr/bin/sort -z \
    | /usr/bin/xargs -0 /usr/bin/sha256sum
) >"${BACKUP_DIR}/staged-files.sha256"

if [[ -e "${USER_CONFIG_ROOT}" || -L "${USER_CONFIG_ROOT}" ]]; then
  [[ -d "${USER_CONFIG_ROOT}" && ! -L "${USER_CONFIG_ROOT}" ]] \
    || fail "The private configuration root is not a regular directory."
  [[ "$(/usr/bin/readlink -f -- "${USER_CONFIG_ROOT}")" == "${USER_CONFIG_ROOT}" ]] \
    || fail "The private configuration root is not canonical."
  [[ "$(/usr/bin/stat -c '%U' -- "${USER_CONFIG_ROOT}")" == "${DEPLOY_USER}" ]] \
    || fail "The private configuration root has the wrong owner."
  [[ "$(/usr/bin/stat -c '%a' -- "${USER_CONFIG_ROOT}")" == '700' ]] \
    || fail "The private configuration root must have mode 0700."
else
  /usr/bin/install -d -m 0700 -- "${USER_CONFIG_ROOT}"
  config_root_created=1
fi

validate_private_optional_config "${USER_CONFIG_ROOT}/memory-watchdog.env"
validate_private_optional_config "${USER_CONFIG_ROOT}/restart.env"
for relative in "${SOURCE_FILES[@]}"; do
  capture_file "${PROJECT_ROOT}/${relative}" "project/${relative}"
done
for unit in "${UNIT_FILES[@]}"; do
  capture_file "${USER_UNIT_ROOT}/${unit}" "user-units/${unit}"
done
capture_file "${USER_CONFIG_ROOT}/memory-watchdog.env" \
  "user-config/memory-watchdog.env"
capture_file "${USER_CONFIG_ROOT}/restart.env" "user-config/restart.env"

app_active_state="$(/usr/bin/systemctl --user is-active "${APP_SERVICE}" 2>/dev/null || true)"
app_enabled_state="$(/usr/bin/systemctl --user is-enabled "${APP_SERVICE}" 2>/dev/null || true)"
health_timer_active_state="$(/usr/bin/systemctl --user is-active "${HEALTH_TIMER}" 2>/dev/null || true)"
health_timer_enabled_state="$(/usr/bin/systemctl --user is-enabled "${HEALTH_TIMER}" 2>/dev/null || true)"
watchdog_timer_active_state="$(/usr/bin/systemctl --user is-active "${WATCHDOG_TIMER}" 2>/dev/null || true)"
watchdog_timer_enabled_state="$(/usr/bin/systemctl --user is-enabled "${WATCHDOG_TIMER}" 2>/dev/null || true)"
[[ -n "${health_timer_active_state}" ]] || health_timer_active_state=unknown
[[ -n "${health_timer_enabled_state}" ]] || health_timer_enabled_state=not-found
[[ -n "${watchdog_timer_active_state}" ]] || watchdog_timer_active_state=unknown
[[ -n "${watchdog_timer_enabled_state}" ]] || watchdog_timer_enabled_state=not-found
case "${health_timer_enabled_state}" in
  enabled|enabled-runtime|disabled) ;;
  *) fail "Unsupported pre-deployment health timer enablement state." ;;
esac
case "${app_enabled_state}" in enabled|enabled-runtime|disabled) ;; *) fail "Unsupported pre-deployment app enablement state." ;; esac
case "${watchdog_timer_enabled_state}" in
  enabled|enabled-runtime|disabled|not-found) ;;
  *) fail "Unsupported pre-deployment watchdog timer enablement state." ;;
esac
case "${health_timer_active_state}" in active|inactive|failed|unknown) ;; *) fail "Unsupported health timer active state." ;; esac
case "${watchdog_timer_active_state}" in active|inactive|failed|unknown) ;; *) fail "Unsupported watchdog timer active state." ;; esac
[[ "${app_active_state}" == 'active' ]] || fail "The application must be active before deployment."
[[ "$(/usr/bin/loginctl show-user "${DEPLOY_USER}" --property=Linger --value)" == yes ]] \
  || fail "User lingering must be enabled before a reboot-independent release can be claimed."
# These units are installed by their dedicated bootstrap flows. This release
# does not mutate them, but refuses to proceed unless their enablement is
# durable. The app and its two monitoring timers are enabled below.
for dependency_unit in bora-ollama.service bora-local-llm.service \
  bora-public-api-proxy.service bora-cloudflared.service bora-public-data-refresh.timer; do
  [[ "$(/usr/bin/systemctl --user is-enabled "${dependency_unit}" 2>/dev/null || true)" == enabled ]] \
    || fail "Required dependency is not durably enabled: ${dependency_unit}"
done
canonical_health_once || fail "The pre-deployment canonical health check failed."
printf 'app_active=%s\napp_enabled=%s\nhealth_timer_active=%s\nhealth_timer_enabled=%s\nwatchdog_timer_active=%s\nwatchdog_timer_enabled=%s\n' \
  "${app_active_state}" \
  "${app_enabled_state}" \
  "${health_timer_active_state}" \
  "${health_timer_enabled_state}" \
  "${watchdog_timer_active_state}" \
  "${watchdog_timer_enabled_state}" \
  >"${BACKUP_DIR}/unit-state-before"

readonly D1_BACKUP="${BACKUP_DIR}/d1-online-before.sqlite"
"${SQLITE_BIN}" -cmd '.timeout 30000' "${D1_FILE}" ".backup '${D1_BACKUP}'"
/usr/bin/chmod 0600 -- "${D1_BACKUP}"
[[ -s "${D1_BACKUP}" ]] || fail "The online D1 backup is empty."
[[ "$("${SQLITE_BIN}" -readonly "${D1_BACKUP}" 'PRAGMA quick_check;')" == 'ok' ]] \
  || fail "The online D1 backup failed quick_check."
[[ -z "$("${SQLITE_BIN}" -readonly "${D1_BACKUP}" 'PRAGMA foreign_key_check;')" ]] \
  || fail "The online D1 backup has foreign-key violations."
/usr/bin/sha256sum "${D1_BACKUP}" >"${D1_BACKUP}.sha256"
(
  cd "${BACKUP_DIR}"
  /usr/bin/sha256sum --check --status "$(/usr/bin/basename -- "${D1_BACKUP}.sha256")"
) || fail "The online D1 backup hash verification failed."

applied=0
success=0
rollback_on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  local recovery_failed=0

  if (( success == 0 && applied == 1 )); then
    printf 'Runtime stability deployment failed; restoring configuration from %s\n' \
      "${BACKUP_DIR}" >&2
    failed_main_pid="$(/usr/bin/systemctl --user show "${APP_SERVICE}" \
      --property=MainPID --value 2>/dev/null || true)"
    failed_enter_time="$(/usr/bin/systemctl --user show "${APP_SERVICE}" \
      --property=ActiveEnterTimestampMonotonic --value 2>/dev/null || true)"
    /usr/bin/systemctl --user stop "${WATCHDOG_TIMER}" >/dev/null 2>&1 || true
    /usr/bin/systemctl --user stop bora-bridge-memory-watchdog.service >/dev/null 2>&1 || true
    /usr/bin/systemctl --user stop "${HEALTH_TIMER}" >/dev/null 2>&1 || true
    /usr/bin/systemctl --user stop bora-bridge-healthcheck.service >/dev/null 2>&1 || true
    /usr/bin/systemctl --user stop bora-bridge-recover.service >/dev/null 2>&1 || true
    rollback_app_stopped=0
    if /usr/bin/systemctl --user stop "${APP_SERVICE}" >/dev/null 2>&1 \
      && ! /usr/bin/systemctl --user is-active --quiet "${APP_SERVICE}"; then
      rollback_app_stopped=1
    else
      recovery_failed=1
    fi
    /usr/bin/systemctl --user disable "${HEALTH_TIMER}" "${WATCHDOG_TIMER}" \
      >/dev/null 2>&1 || true

    if (( rollback_app_stopped == 1 )); then
      for relative in "${SOURCE_FILES[@]}"; do
        restore_file "${PROJECT_ROOT}/${relative}" "project/${relative}" \
          || recovery_failed=1
      done
      for unit in "${UNIT_FILES[@]}"; do
        restore_file "${USER_UNIT_ROOT}/${unit}" "user-units/${unit}" \
          || recovery_failed=1
      done
      restore_file "${USER_CONFIG_ROOT}/memory-watchdog.env" \
        "user-config/memory-watchdog.env" || recovery_failed=1
      restore_file "${USER_CONFIG_ROOT}/restart.env" \
        "user-config/restart.env" || recovery_failed=1

      /usr/bin/systemctl --user daemon-reload || recovery_failed=1
      case "${app_enabled_state}" in
        enabled) /usr/bin/systemctl --user enable "${APP_SERVICE}" >/dev/null || recovery_failed=1 ;;
        enabled-runtime) /usr/bin/systemctl --user enable --runtime "${APP_SERVICE}" >/dev/null || recovery_failed=1 ;;
        disabled) /usr/bin/systemctl --user disable "${APP_SERVICE}" >/dev/null 2>&1 || true ;;
      esac
      if [[ "${app_active_state}" == 'active' ]]; then
        /usr/bin/systemctl --user restart "${APP_SERVICE}" || recovery_failed=1
        wait_for_canonical_health || recovery_failed=1
        restored_main_pid="$(/usr/bin/systemctl --user show "${APP_SERVICE}" \
          --property=MainPID --value 2>/dev/null || true)"
        restored_enter_time="$(/usr/bin/systemctl --user show "${APP_SERVICE}" \
          --property=ActiveEnterTimestampMonotonic --value 2>/dev/null || true)"
        [[ "${restored_main_pid}" =~ ^[1-9][0-9]*$ \
          && "${restored_main_pid}" != "${failed_main_pid}" ]] \
          || recovery_failed=1
        [[ -n "${restored_enter_time}" \
          && "${restored_enter_time}" != "${failed_enter_time}" ]] \
          || recovery_failed=1
      fi
      # Timers are restored only after the old application is ready. Starting
      # a monitor first could race the deliberate recovery restart.
      restore_timer_state "${HEALTH_TIMER}" \
        "${health_timer_enabled_state}" "${health_timer_active_state}" \
        || recovery_failed=1
      restore_timer_state "${WATCHDOG_TIMER}" \
        "${watchdog_timer_enabled_state}" "${watchdog_timer_active_state}" \
        || recovery_failed=1
    fi
    # The D1 file is deliberately never restored: this release changes only
    # runtime configuration and unit files, while rollback may happen after
    # the restarted application has accepted new user writes.
  fi

  cleanup_work_stage
  if (( success == 0 && status == 0 )); then status=1; fi
  if (( recovery_failed != 0 )); then
    printf 'Automatic runtime rollback was incomplete; inspect %s immediately.\n' \
      "${BACKUP_DIR}" >&2
    status=70
  fi
  exit "${status}"
}
trap rollback_on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

applied=1
/usr/bin/systemctl --user stop "${WATCHDOG_TIMER}" >/dev/null 2>&1 || true
/usr/bin/systemctl --user stop bora-bridge-memory-watchdog.service >/dev/null 2>&1 || true
/usr/bin/systemctl --user stop "${HEALTH_TIMER}"
/usr/bin/systemctl --user stop bora-bridge-healthcheck.service >/dev/null 2>&1 || true
/usr/bin/systemctl --user stop bora-bridge-recover.service >/dev/null 2>&1 || true
/usr/bin/systemctl --user stop "${APP_SERVICE}"
/usr/bin/systemctl --user is-active --quiet "${APP_SERVICE}" \
  && fail "The application did not stop cleanly."

for relative in "${SOURCE_FILES[@]}"; do
  atomic_install \
    "${WORK_STAGE}/${relative}" \
    "${PROJECT_ROOT}/${relative}" \
    "$(source_mode "${relative}")"
done
for unit in "${UNIT_FILES[@]}"; do
  atomic_install \
    "${WORK_STAGE}/rendered-units/${unit}" \
    "${USER_UNIT_ROOT}/${unit}" \
    0644
done
(
  cd "${PROJECT_ROOT}"
  printf '%s\0' "${SOURCE_FILES[@]}" \
    | LC_ALL=C /usr/bin/sort -z \
    | /usr/bin/xargs -0 /usr/bin/sha256sum
) | /usr/bin/cmp --silent - "${BACKUP_DIR}/staged-files.sha256" \
  || fail "Installed runtime source does not match the validated stage."
atomic_install \
  "${WORK_STAGE}/deploy/memory-watchdog.env.example" \
  "${USER_CONFIG_ROOT}/memory-watchdog.env" \
  0600
if [[ ! -e "${USER_CONFIG_ROOT}/restart.env" ]]; then
  atomic_install \
    "${WORK_STAGE}/deploy/restart.env.example" \
    "${USER_CONFIG_ROOT}/restart.env" \
    0600
fi
/usr/bin/grep -Fxq 'BORA_MEMORY_WATCHDOG_DRY_RUN=0' \
  "${USER_CONFIG_ROOT}/memory-watchdog.env" \
  || fail "The installed watchdog environment does not enable controlled recovery."
validate_private_optional_config "${USER_CONFIG_ROOT}/memory-watchdog.env"
validate_private_optional_config "${USER_CONFIG_ROOT}/restart.env"
printf 'Watchdog activation mode: BORA_MEMORY_WATCHDOG_DRY_RUN=0 (bounded recovery enabled).\n'
trigger_failpoint after-source-install

/usr/bin/systemctl --user daemon-reload
/usr/bin/systemctl --user enable "${APP_SERVICE}"
/usr/bin/systemctl --user start "${APP_SERVICE}"
wait_for_canonical_health \
  || fail "The application failed its canonical post-deployment health check."
/usr/bin/bash "${PROJECT_ROOT}/deploy/check-bora-bridge-health.sh" \
  || fail "The installed health checker rejected the application."
trigger_failpoint after-app-start

readonly RUNTIME_CONFIG="${RUNTIME_ROOT}/bora-bridge/wrangler.runtime.json"
"${NODE_BIN}" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(1);
' "${RUNTIME_CONFIG}" \
  || fail "The running service did not generate a valid private runtime config."
[[ "$((8#$(/usr/bin/stat -c '%a' -- "${RUNTIME_CONFIG}") & 8#077))" == 0 ]] \
  || fail "The generated runtime config is not private."

control_group="$(/usr/bin/systemctl --user show "${APP_SERVICE}" \
  --property=ControlGroup --value)"
[[ "${control_group}" == /* && "${control_group}" != *..* ]] \
  || fail "The application control group is invalid."
if [[ -r "/sys/fs/cgroup${control_group}/cgroup.procs" ]]; then
  while IFS= read -r process_id; do
    [[ "${process_id}" =~ ^[0-9]+$ && -r "/proc/${process_id}/cmdline" ]] || continue
    process_command="$(/usr/bin/tr '\0' ' ' <"/proc/${process_id}/cmdline")"
    if [[ "${process_command}" == *'--inspector-addr'* \
      || "${process_command}" == *'--debug-port'* ]]; then
      fail "An inspector-enabled child process remains in the application cgroup."
    fi
  done <"/sys/fs/cgroup${control_group}/cgroup.procs"
fi

/usr/bin/systemctl --user enable --now "${HEALTH_TIMER}"
/usr/bin/systemctl --user enable --now "${WATCHDOG_TIMER}"
/usr/bin/systemctl --user start bora-bridge-memory-watchdog.service
/usr/bin/systemctl --user is-active --quiet "${APP_SERVICE}"
/usr/bin/systemctl --user is-enabled --quiet "${APP_SERVICE}"
/usr/bin/systemctl --user is-active --quiet "${HEALTH_TIMER}"
/usr/bin/systemctl --user is-active --quiet "${WATCHDOG_TIMER}"
canonical_health_once || fail "Final canonical health verification failed."
/usr/bin/bash "${PROJECT_ROOT}/deploy/check-runtime-autostart.sh" \
  || fail "The complete durable-autostart and readiness contract failed."

printf '%s\n' "${STAMP}" >"${BACKUP_DIR}/applied-at-utc"
success=1
trap - EXIT HUP INT TERM
cleanup_work_stage
printf 'BORA Bridge runtime stability release applied with bounded watchdog recovery. Backup: %s\n' \
  "${BACKUP_DIR}"
