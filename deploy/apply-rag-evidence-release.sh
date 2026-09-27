#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Usage: bash apply-rag-evidence-release.sh [--check] BUILD_DIR MANIFEST_JSON BASELINE_SHA
# --check is read-only. Only listed source files and dist are installed; no git mutation.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
NODE_BIN="$(bora_tool_path BORA_NODE_BIN node)" || exit 2
readonly NODE_BIN
SQLITE_BIN="$(bora_tool_path BORA_SQLITE_BIN sqlite3)" || exit 2
readonly SQLITE_BIN
GIT_BIN="$(bora_tool_path BORA_GIT_BIN git)" || exit 2
readonly GIT_BIN
readonly D1_ROOT="${PROJECT_ROOT}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
D1_FILE="$(bora_d1_file "${PROJECT_ROOT}")" || exit 2
readonly D1_FILE
readonly BACKUP_ROOT="${PROJECT_ROOT}/.deploy-backups"
readonly APP_SERVICE="bora-bridge.service"
readonly TIMERS=(bora-bridge-healthcheck.timer bora-bridge-memory-watchdog.timer bora-public-data-refresh.timer bora-seoul-commercial-import.timer)
readonly WRITERS=(bora-bridge-healthcheck.service bora-bridge-memory-watchdog.service bora-bridge-recover.service bora-public-data-refresh.service bora-seoul-commercial-import.service)
check_only=0
if [[ "${1:-}" == --check ]]; then check_only=1; shift; fi
readonly BUILD_DIR="${1:-}" MANIFEST="${2:-}" BASELINE="${3:-}"
[[ $# == 3 ]] || { printf 'Expected BUILD_DIR MANIFEST_JSON BASELINE_SHA.\n' >&2; exit 2; }
fail() { printf 'bora-rag-release: %s\n' "$1" >&2; exit 2; }
canonical_dir() { [[ -d "$1" && ! -L "$1" && "$(/usr/bin/readlink -f -- "$1")" == "$1" ]]; }
safe_source_parent() {
  local parent="$1" ancestor="$1"
  [[ "${parent}" == "${PROJECT_ROOT}/"* || "${parent}" == "${PROJECT_ROOT}" ]] || return 1
  # Preserve existing permissions, especially the protected 0700 project root.
  if canonical_dir "${parent}"; then return 0; fi
  while [[ ! -e "${ancestor}" ]]; do
    [[ ! -L "${ancestor}" ]] || return 1
    ancestor="$(/usr/bin/dirname -- "${ancestor}")"
  done
  canonical_dir "${ancestor}" || return 1
  /usr/bin/install -d -m 0755 -- "${parent}" || return 1
  canonical_dir "${parent}"
}
canonical_health_once() {
  local body
  body="$(/usr/bin/curl --fail --silent --connect-timeout 2 --max-time 4 \
    --header 'Host: borabridge.com' --header 'X-Forwarded-Host: borabridge.com' \
    --header 'X-Forwarded-Proto: https' --header 'Origin: https://borabridge.com' \
    'http://127.0.0.1:3000/api/health' 2>/dev/null || true)"
  [[ "${body}" == '{"status":"ok"}' ]]
}
wait_for_health() {
  local attempt
  for ((attempt=0; attempt<20; attempt++)); do
    if canonical_health_once; then return 0; fi
    /usr/bin/sleep 1
  done
  return 1
}
baseline_matches() {
  [[ "$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse HEAD)" == "${BASELINE}" ]] || return 1
  local baseline_status=0 production_status status_hash
  production_status="$("${GIT_BIN}" -C "${PROJECT_ROOT}" status --porcelain --untracked-files=all)" || return 1
  status_hash="$(printf '%s' "${production_status}" | /usr/bin/sha256sum)"
  status_hash="${status_hash%% *}"
  "${NODE_BIN}" "${VALIDATOR}" --baseline "${BUILD_DIR}" "${MANIFEST}" "${PROJECT_ROOT}" "${status_hash}" || baseline_status=$?
  if (( baseline_status == 0 )); then return 0; fi
  if (( baseline_status != 3 )); then return 1; fi
  [[ -z "$("${GIT_BIN}" -C "${PROJECT_ROOT}" status --porcelain --untracked-files=no)" ]]
}
dist_hashes() {
  (cd "$1" && /usr/bin/find . -type f -print0 | LC_ALL=C /usr/bin/sort -z | /usr/bin/xargs -0 -r /usr/bin/sha256sum)
}
readonly VALIDATOR="${BUILD_DIR}/scripts/validate-rag-release.mjs"
[[ "${BUILD_DIR}" == "${PROJECT_ROOT}-build-rag-"* \
  && "${BUILD_DIR#"${PROJECT_ROOT}-build-rag-"}" =~ ^[A-Za-z0-9_-]+$ ]] || fail "Unexpected build directory."
[[ "${BASELINE}" =~ ^[a-f0-9]{40}$ ]] || fail "A full baseline commit is required."
canonical_dir "${PROJECT_ROOT}" && canonical_dir "${BUILD_DIR}" && canonical_dir "${D1_ROOT}" || fail "A required root is not canonical."
for binary in "${NODE_BIN}" "${SQLITE_BIN}" "${GIT_BIN}" /usr/bin/flock /usr/bin/systemctl /usr/bin/curl; do
  [[ -x "${binary}" ]] || fail "A required executable is unavailable."
done
[[ -f "${VALIDATOR}" && ! -L "${VALIDATOR}" && "$(/usr/bin/readlink -f -- "${VALIDATOR}")" == "${VALIDATOR}" ]] || fail "Unsafe validator."
validated_paths="$("${NODE_BIN}" "${VALIDATOR}" "${BUILD_DIR}" "${MANIFEST}" "${PROJECT_ROOT}")" || fail "Release preflight failed."
mapfile -t SOURCE_FILES <<<"${validated_paths}"
release_plan="$("${NODE_BIN}" "${VALIDATOR}" --plan "${BUILD_DIR}" "${MANIFEST}" "${PROJECT_ROOT}")" || fail "Invalid release plan."
mapfile -t MIGRATION_FILES < <("${NODE_BIN}" -e 'for (const file of JSON.parse(process.argv[1]).migrations) console.log(file)' "${release_plan}")
repair_youth_dates="$("${NODE_BIN}" -e 'console.log(JSON.parse(process.argv[1]).repairYouthDates ? 1 : 0)' "${release_plan}")"
[[ -f "${D1_FILE}" && ! -L "${D1_FILE}" && "$(/usr/bin/readlink -f -- "${D1_FILE}")" == "${D1_FILE}" ]] || fail "Unsafe production database."
[[ "$(/usr/bin/find "${D1_ROOT}" -maxdepth 1 -type f -name '*.sqlite' ! -name metadata.sqlite | /usr/bin/wc -l)" == 1 ]] || fail "Expected exactly one production database."
[[ "$("${SQLITE_BIN}" -readonly "${D1_FILE}" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('auth_sessions','oauth_users','public_data_catalog_chunks');")" == 3 ]] || fail "Unexpected database schema."
"${NODE_BIN}" --input-type=module -e 'const m = await import(process.argv[1]); m.validateDist(process.argv[2], {protectedProjectRoot: process.argv[3]});' \
  "file://${VALIDATOR}" "${PROJECT_ROOT}/dist" "${PROJECT_ROOT}" || fail "Unsafe current dist."
baseline_matches || fail "Production baseline differs or tracked files are dirty."
/usr/bin/systemctl --user is-active --quiet "${APP_SERVICE}" || fail "Application is not active."
canonical_health_once || fail "Pre-deployment canonical health failed."
if (( check_only == 1 )); then printf 'RAG release read-only preflight passed.\n'; exit 0; fi

runtime_root="/run/user/$(/usr/bin/id -u)"
canonical_dir "${runtime_root}" || fail "Unsafe runtime lock directory."
readonly LOCK_FILE="${runtime_root}/bora-rag-evidence-release.lock"
readonly RUNTIME_STABILITY_LOCK_FILE="${runtime_root}/bora-runtime-stability-release.lock"
[[ "${XDG_RUNTIME_DIR:-${runtime_root}}" == "${runtime_root}" ]] || fail "Runtime directory differs from the shared deployment lock root."
for lock in "${LOCK_FILE}" "${RUNTIME_STABILITY_LOCK_FILE}"; do
  [[ ! -L "${lock}" && ( ! -e "${lock}" || -f "${lock}" ) ]] || fail "Unsafe deployment lock."
done
exec 9>"${LOCK_FILE}"
/usr/bin/flock -n 9 || fail "Another RAG release holds the deployment lock."
exec 8>"${RUNTIME_STABILITY_LOCK_FILE}"
/usr/bin/flock -n 8 || fail "A runtime stability release holds the shared deployment lock."
baseline_matches || fail "Production baseline changed while checking."
[[ ! -L "${BACKUP_ROOT}" ]] || fail "Unsafe backup root."
/usr/bin/install -d -m 0700 -- "${BACKUP_ROOT}"
canonical_dir "${BACKUP_ROOT}" || fail "Backup root is not canonical."
BACKUP_DIR="$(/usr/bin/mktemp -d --tmpdir="${BACKUP_ROOT}" rag-evidence.XXXXXXXX)"
readonly BACKUP_DIR
canonical_dir "${BACKUP_DIR}" && [[ "${BACKUP_DIR}" == "${BACKUP_ROOT}/rag-evidence."* ]] || fail "Unsafe backup directory."
readonly WORK_STAGE="${BACKUP_DIR}/validated-release"
/usr/bin/install -d -m 0700 -- "${WORK_STAGE}" "${BACKUP_DIR}/previous-source" "${BACKUP_DIR}/failed-source"
/usr/bin/install -m 0600 -- "${MANIFEST}" "${BACKUP_DIR}/manifest.json"
for relative in "${SOURCE_FILES[@]}"; do
  /usr/bin/install -d -m 0700 -- "$(/usr/bin/dirname -- "${WORK_STAGE}/${relative}")" "$(/usr/bin/dirname -- "${BACKUP_DIR}/previous-source/${relative}")"
  /usr/bin/cp -p -- "${BUILD_DIR}/${relative}" "${WORK_STAGE}/${relative}"
  if [[ -e "${PROJECT_ROOT}/${relative}" ]]; then
    /usr/bin/cp -p -- "${PROJECT_ROOT}/${relative}" "${BACKUP_DIR}/previous-source/${relative}"
  fi
done
dist_hashes "${BUILD_DIR}/dist" >"${BACKUP_DIR}/expected-dist.sha256"
/usr/bin/cp -a --reflink=auto -- "${BUILD_DIR}/dist" "${WORK_STAGE}/dist"
dist_hashes "${WORK_STAGE}/dist" | /usr/bin/cmp --silent - "${BACKUP_DIR}/expected-dist.sha256" || fail "Dist copy mismatch."
"${NODE_BIN}" "${VALIDATOR}" "${WORK_STAGE}" "${BACKUP_DIR}/manifest.json" "${PROJECT_ROOT}" >/dev/null || fail "Protected stage validation failed."
"${NODE_BIN}" --check "${WORK_STAGE}/scripts/apply-local-sqlite-migrations.mjs"

declare -A TIMER_ACTIVE TIMER_ENABLED
for timer in "${TIMERS[@]}"; do
  TIMER_ACTIVE["${timer}"]="$(/usr/bin/systemctl --user is-active "${timer}" 2>/dev/null || true)"
  TIMER_ENABLED["${timer}"]="$(/usr/bin/systemctl --user is-enabled "${timer}" 2>/dev/null || true)"
  case "${TIMER_ACTIVE[${timer}]}" in active|inactive|failed|unknown) ;; *) fail "Unsupported timer activity state." ;; esac
  case "${TIMER_ENABLED[${timer}]}" in enabled|enabled-runtime|disabled|static|masked|not-found) ;; *) fail "Unsupported timer enablement state." ;; esac
  printf '%s %s %s\n' "${timer}" "${TIMER_ACTIVE[${timer}]}" "${TIMER_ENABLED[${timer}]}" >>"${BACKUP_DIR}/timer-state-before"
done
readonly D1_BACKUP="${BACKUP_DIR}/d1-online-before.sqlite"
"${SQLITE_BIN}" -cmd '.timeout 30000' "${D1_FILE}" ".backup '${D1_BACKUP}'"
/usr/bin/chmod 0600 -- "${D1_BACKUP}"
[[ -s "${D1_BACKUP}" && "$("${SQLITE_BIN}" -readonly "${D1_BACKUP}" 'PRAGMA quick_check;')" == ok ]] || fail "Database backup verification failed."
[[ -z "$("${SQLITE_BIN}" -readonly "${D1_BACKUP}" 'PRAGMA foreign_key_check;')" ]] || fail "Database backup has foreign-key violations."
/usr/bin/sha256sum "${D1_BACKUP}" >"${D1_BACKUP}.sha256"
printf '%s\n' "${BASELINE}" >"${BACKUP_DIR}/baseline-commit"

restore_timers() {
  local timer failed=0 enabled
  # Enablement is never changed; verify it and restore only previous activity.
  for timer in "${TIMERS[@]}"; do
    enabled="$(/usr/bin/systemctl --user is-enabled "${timer}" 2>/dev/null || true)"
    [[ "${enabled}" == "${TIMER_ENABLED[${timer}]}" ]] || failed=1
    if [[ "${TIMER_ACTIVE[${timer}]}" == active ]]; then
      /usr/bin/systemctl --user start "${timer}" >/dev/null 2>&1 || failed=1
    elif [[ "${TIMER_ENABLED[${timer}]}" != not-found ]]; then
      /usr/bin/systemctl --user stop "${timer}" >/dev/null 2>&1 || failed=1
    fi
  done
  return "${failed}"
}
stop_writers() {
  local unit state
  for unit in "${TIMERS[@]}" "${WRITERS[@]}"; do
    state="$(/usr/bin/systemctl --user show "${unit}" --property=LoadState --value 2>/dev/null || true)"
    if [[ "${state}" == not-found ]]; then continue; fi
    [[ -n "${state}" ]] || return 1
    /usr/bin/systemctl --user stop "${unit}" >/dev/null 2>&1 || return 1
    state="$(/usr/bin/systemctl --user is-active "${unit}" 2>/dev/null || true)"
    case "${state}" in inactive|failed|unknown) ;; *) return 1 ;; esac
  done
}
app_stopped() {
  [[ "$(/usr/bin/systemctl --user show "${APP_SERVICE}" --property=ActiveState --value)" == inactive \
    && "$(/usr/bin/systemctl --user show "${APP_SERVICE}" --property=MainPID --value)" == 0 ]]
}
applied=0; success=0; old_dist_moved=0; installed_files=()
rollback_on_exit() {
  local status=$? recovery_failed=0 relative target
  trap - EXIT HUP INT TERM
  set +e
  if (( applied == 1 && success == 0 )); then
    printf 'RAG release failed; recovering code and dist from private backup.\n' >&2
    stop_writers || recovery_failed=1
    /usr/bin/systemctl --user stop "${APP_SERVICE}" >/dev/null 2>&1
    if app_stopped; then
      for relative in "${installed_files[@]}"; do
        target="${PROJECT_ROOT}/${relative}"
        canonical_dir "$(/usr/bin/dirname -- "${target}")" || { recovery_failed=1; continue; }
        [[ ! -L "${target}" ]] || { recovery_failed=1; continue; }
        /usr/bin/install -d -m 0700 -- "$(/usr/bin/dirname -- "${BACKUP_DIR}/failed-source/${relative}")"
        if [[ -e "${target}" ]]; then
          /usr/bin/mv -T -- "${target}" "${BACKUP_DIR}/failed-source/${relative}" || { recovery_failed=1; continue; }
        fi
        if [[ -f "${BACKUP_DIR}/previous-source/${relative}" ]]; then
          /usr/bin/cp -p -- "${BACKUP_DIR}/previous-source/${relative}" "${target}" || recovery_failed=1
        fi
      done
      if (( old_dist_moved == 1 )) || [[ -d "${BACKUP_DIR}/previous-dist" ]]; then
        canonical_dir "${BACKUP_DIR}/previous-dist" || recovery_failed=1
        if [[ -e "${PROJECT_ROOT}/dist" ]]; then
          canonical_dir "${PROJECT_ROOT}/dist" && /usr/bin/mv -T -- "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/failed-dist" || recovery_failed=1
        fi
        [[ ! -e "${PROJECT_ROOT}/dist" && ! -L "${PROJECT_ROOT}/dist" ]] \
          && /usr/bin/mv -T -- "${BACKUP_DIR}/previous-dist" "${PROJECT_ROOT}/dist" || recovery_failed=1
      fi
      if (( recovery_failed == 0 )); then
        /usr/bin/systemctl --user start "${APP_SERVICE}" && wait_for_health || recovery_failed=1
      fi
    else recovery_failed=1; fi
    # NEVER restore the D1 backup: new user writes may have arrived after start.
    # Public search projections and date repairs remain backward-compatible;
    # leave their tables, indexes, view and triggers in place.
    if (( recovery_failed == 0 )); then
      restore_timers || recovery_failed=1
    else
      printf 'Monitors remain stopped because application recovery could not be verified.\n' >&2
    fi
  fi
  if (( recovery_failed != 0 )); then
    printf 'Automatic rollback incomplete; private backup: %s\n' "${BACKUP_DIR}" >&2
    exit 70
  fi
  (( success == 1 || status != 0 )) || status=1
  exit "${status}"
}
trap rollback_on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

baseline_matches || fail "Production baseline changed before installation."
applied=1
stop_writers || fail "Could not stop refresh/monitor writers."
/usr/bin/systemctl --user stop "${APP_SERVICE}"
app_stopped || fail "Application did not stop cleanly."
absolute_migrations=()
# Legacy release: drizzle/0023_public_rag_index.sql. New patches add only
# explicitly hashed migration files from their validated release manifest.
for relative in "${MIGRATION_FILES[@]}"; do absolute_migrations+=("${WORK_STAGE}/${relative}"); done
"${NODE_BIN}" --experimental-sqlite "${WORK_STAGE}/scripts/apply-local-sqlite-migrations.mjs" \
  "${D1_FILE}" "${absolute_migrations[@]}" >"${BACKUP_DIR}/migration.log" 2>&1 \
  || fail "Additive migration failed; see private migration log."
if [[ "${repair_youth_dates}" == 1 ]]; then
  "${NODE_BIN}" --experimental-strip-types "${WORK_STAGE}/scripts/repair-youth-policy-dates.mjs" \
    --apply "${D1_FILE}" --backup "${BACKUP_DIR}/d1-before-date-repair.sqlite" >"${BACKUP_DIR}/date-repair.log" 2>&1 \
    || fail "Public date repair failed; see private repair log."
fi
for relative in "${SOURCE_FILES[@]}"; do
  target="${PROJECT_ROOT}/${relative}"
  safe_source_parent "$(/usr/bin/dirname -- "${target}")" && [[ ! -L "${target}" ]] || fail "Unsafe install target."
  installed_files+=("${relative}")
  /usr/bin/cp -p -- "${WORK_STAGE}/${relative}" "${target}"
done
canonical_dir "${PROJECT_ROOT}/dist" && canonical_dir "${WORK_STAGE}/dist" || fail "Unsafe dist swap."
/usr/bin/mv -T -- "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/previous-dist"
old_dist_moved=1
/usr/bin/mv -T -- "${WORK_STAGE}/dist" "${PROJECT_ROOT}/dist"
"${NODE_BIN}" "${VALIDATOR}" --dist "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/manifest.json" "${PROJECT_ROOT}" >/dev/null \
  || fail "Installed dist provenance verification failed."
/usr/bin/systemctl --user start "${APP_SERVICE}"
wait_for_health || fail "Canonical post-deployment health failed."
"${NODE_BIN}" "${PROJECT_ROOT}/scripts/verify-catalog-ux-release.mjs" "${D1_FILE}" \
  >"${BACKUP_DIR}/post-deploy-public-verification.json" \
  2>"${BACKUP_DIR}/post-deploy-public-verification.err" \
  || fail "Post-deployment public catalogue verification failed; see private verification log."
restore_timers || fail "Timer state restoration failed."
canonical_health_once || fail "Final canonical health failed."
success=1
printf 'RAG release applied; private backup: %s\n' "${BACKUP_DIR}"
