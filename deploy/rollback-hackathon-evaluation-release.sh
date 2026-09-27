#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
GIT_BIN="$(bora_tool_path BORA_GIT_BIN git)" || exit 2
readonly GIT_BIN
SQLITE_BIN="$(bora_tool_path BORA_SQLITE_BIN sqlite3)" || exit 2
readonly SQLITE_BIN
D1_FILE="$(bora_d1_file "${PROJECT_ROOT}")" || exit 2
readonly D1_FILE
readonly LOCK_FILE="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bora-hackathon-evaluation-release.lock"
readonly BACKUP_DIR="${1:-}"
readonly DB_MODE="${2:-keep-additive-schema}"
readonly DB_ACK="${3:-}"
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly APP_SERVICE="bora-bridge.service"
readonly TIMERS=(
  bora-bridge-healthcheck.timer
  bora-public-data-refresh.timer
  bora-seoul-commercial-import.timer
)
readonly WRITER_SERVICES=(
  bora-bridge-healthcheck.service
  bora-bridge-recover.service
  bora-public-data-refresh.service
  bora-seoul-commercial-import.service
)

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

dist_manifest() {
  local root="$1"
  (
    cd "${root}"
    LC_ALL=C /usr/bin/find . -type f -print0 \
      | LC_ALL=C /usr/bin/sort -z \
      | /usr/bin/xargs -0 -r /usr/bin/sha256sum
  )
}

[[ "${BACKUP_DIR}" == "${PROJECT_ROOT}/.deploy-backups/hackathon-evaluation-"* ]] || fail "Backup must be a hackathon-evaluation backup below the project."
[[ -d "${BACKUP_DIR}" && ! -L "${BACKUP_DIR}" ]] || fail "Backup directory is missing or symbolic."
[[ "$(readlink -f "${BACKUP_DIR}")" == "${BACKUP_DIR}" ]] || fail "Backup path must be canonical."
[[ -d "${BACKUP_DIR}/dist-before" && ! -L "${BACKUP_DIR}/dist-before" ]] || fail "Previous dist backup is missing or symbolic."
[[ "$(readlink -f "${BACKUP_DIR}/dist-before")" == "${BACKUP_DIR}/dist-before" ]] || fail "Previous dist backup is not canonical."
[[ -f "${BACKUP_DIR}/dist-before/server/index.js" \
  && -f "${BACKUP_DIR}/dist-before/server/wrangler.json" \
  && -d "${BACKUP_DIR}/dist-before/client" ]] || fail "Previous dist backup is incomplete."
[[ -f "${BACKUP_DIR}/old-commit" && -f "${BACKUP_DIR}/release-commit" ]] || fail "Release metadata is missing."
[[ -f "${BACKUP_DIR}/previous-bundle.sha256" \
  && -f "${BACKUP_DIR}/deployed-bundle.sha256" ]] || fail "Bundle integrity metadata is missing."
readonly OLD_COMMIT="$(<"${BACKUP_DIR}/old-commit")"
readonly OLD_BRANCH="$(<"${BACKUP_DIR}/old-branch")"
readonly RELEASE_COMMIT="$(<"${BACKUP_DIR}/release-commit")"
[[ "${OLD_COMMIT}" =~ ^[0-9a-f]{40}$ && "${RELEASE_COMMIT}" =~ ^[0-9a-f]{40}$ ]] || fail "Release metadata is invalid."
if [[ "${DB_MODE}" == "restore-database" ]]; then
  [[ "${DB_ACK}" == "I_ACCEPT_LOSS_OF_WRITES_AFTER_BACKUP" ]] || fail "Database restore requires the explicit data-loss acknowledgement."
  [[ -f "${BACKUP_DIR}/d1-before.sqlite" && -f "${BACKUP_DIR}/d1-before.sqlite.sha256" ]] || fail "D1 backup or hash is missing."
elif [[ "${DB_MODE}" != "keep-additive-schema" ]]; then
  fail "Use keep-additive-schema (default) or restore-database with acknowledgement."
fi

exec 9>"${LOCK_FILE}"
/usr/bin/flock -n 9 || fail "Another BORA Bridge release is already running."
[[ "$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse HEAD)" == "${RELEASE_COMMIT}" ]] || fail "Current source is not the release recorded by this backup."
[[ -d "${PROJECT_ROOT}/dist" && ! -L "${PROJECT_ROOT}/dist" ]] || fail "Current dist is missing or symbolic."
[[ -z "$(/usr/bin/find "${BACKUP_DIR}/dist-before" -type l -print -quit)" \
  && -z "$(/usr/bin/find "${PROJECT_ROOT}/dist" -type l -print -quit)" ]] || fail "A rollback bundle contains a symbolic link."
dist_manifest "${BACKUP_DIR}/dist-before" | /usr/bin/cmp - "${BACKUP_DIR}/previous-bundle.sha256" || fail "Previous bundle hash does not match its manifest."
dist_manifest "${PROJECT_ROOT}/dist" | /usr/bin/cmp - "${BACKUP_DIR}/deployed-bundle.sha256" || fail "Current bundle does not match the recorded release."
if [[ "${DB_MODE}" == "restore-database" ]]; then
  [[ "$(/usr/bin/sha256sum "${BACKUP_DIR}/d1-before.sqlite" | /usr/bin/cut -d ' ' -f 1)" \
    == "$(<"${BACKUP_DIR}/d1-before.sqlite.sha256")" ]] || fail "D1 backup hash does not match."
  [[ "$("${SQLITE_BIN}" -readonly "${BACKUP_DIR}/d1-before.sqlite" "PRAGMA quick_check;")" == "ok" ]] || fail "D1 backup failed preflight quick_check."
  [[ -z "$("${SQLITE_BIN}" -readonly "${BACKUP_DIR}/d1-before.sqlite" "PRAGMA foreign_key_check;")" ]] || fail "D1 backup failed preflight foreign_key_check."
fi
[[ -z "$("${GIT_BIN}" -C "${PROJECT_ROOT}" status --porcelain --untracked-files=no)" ]] || fail "Production tracked files are not clean."
readonly CURRENT_COMMIT="$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse HEAD)"
CURRENT_BRANCH="$("${GIT_BIN}" -C "${PROJECT_ROOT}" symbolic-ref --quiet --short HEAD || true)"
readonly CURRENT_BRANCH

dist_swapped=0
source_swapped=0
db_swapped=0
success=0
writers_stopped=0

stop_writers() {
  local failed=0
  for timer in "${TIMERS[@]}"; do
    /usr/bin/systemctl --user stop "${timer}" || failed=1
  done
  for service in "${WRITER_SERVICES[@]}"; do
    /usr/bin/systemctl --user stop "${service}" || failed=1
  done
  /usr/bin/systemctl --user stop "${APP_SERVICE}" || failed=1
  for unit in "${APP_SERVICE}" "${TIMERS[@]}" "${WRITER_SERVICES[@]}"; do
    if /usr/bin/systemctl --user is-active --quiet "${unit}"; then failed=1; fi
  done
  if (( failed == 0 )); then writers_stopped=1; else writers_stopped=0; fi
  return "${failed}"
}

start_timers() {
  for timer in "${TIMERS[@]}"; do
    /usr/bin/systemctl --user start "${timer}"
  done
}

restore_current_source() {
  if [[ -n "${CURRENT_BRANCH}" \
    && "$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse "refs/heads/${CURRENT_BRANCH}")" == "${CURRENT_COMMIT}" ]]; then
    "${GIT_BIN}" -C "${PROJECT_ROOT}" switch "${CURRENT_BRANCH}"
  else
    "${GIT_BIN}" -C "${PROJECT_ROOT}" switch --detach "${CURRENT_COMMIT}"
  fi
}

wait_for_local_health() {
  local ready=0
  for _ in $(seq 1 30); do
    if /usr/bin/curl --silent --show-error --fail --max-time 5 \
      --header 'Host: borabridge.com' \
      --header 'X-Forwarded-Host: borabridge.com' \
      --header 'X-Forwarded-Proto: https' \
      --header 'Origin: https://borabridge.com' \
      http://127.0.0.1:3000/api/health | /usr/bin/grep -q '"status":"ok"'; then
      ready=1
      break
    fi
    /usr/bin/sleep 2
  done
  (( ready == 1 ))
}

rollback_failed_rollback() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  local recovery_failed=0
  if (( success == 0 )); then
    printf 'Rollback failed; attempting to restore the release that was active before rollback.\n' >&2
    stop_writers || recovery_failed=1
    if (( writers_stopped == 1 && db_swapped == 1 )) \
      && [[ -f "${BACKUP_DIR}/d1-after-${STAMP}.sqlite" ]]; then
      local db_restore_ready=1
      if [[ -f "${D1_FILE}-wal" ]]; then
        /usr/bin/mv "${D1_FILE}-wal" "${BACKUP_DIR}/d1-rollback-failed-${STAMP}.sqlite-wal" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if [[ -f "${D1_FILE}-shm" ]]; then
        /usr/bin/mv "${D1_FILE}-shm" "${BACKUP_DIR}/d1-rollback-failed-${STAMP}.sqlite-shm" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if (( db_restore_ready == 1 )); then
        /usr/bin/cp -a --reflink=auto "${D1_FILE}" "${BACKUP_DIR}/d1-rollback-failed-${STAMP}.sqlite" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if (( db_restore_ready == 1 )); then
        /usr/bin/cp -a --reflink=auto "${BACKUP_DIR}/d1-after-${STAMP}.sqlite" "${PROJECT_ROOT}/.d1-rollforward-${STAMP}.sqlite" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if (( db_restore_ready == 1 )); then
        /usr/bin/mv -f "${PROJECT_ROOT}/.d1-rollforward-${STAMP}.sqlite" "${D1_FILE}" || recovery_failed=1
        [[ "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA quick_check;")" == "ok" ]] || recovery_failed=1
        [[ -z "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA foreign_key_check;")" ]] || recovery_failed=1
      fi
    fi
    if (( writers_stopped == 1 && dist_swapped == 1 )) && [[ -d "${BACKUP_DIR}/dist-after-${STAMP}" ]]; then
      local dist_restore_ready=1
      if [[ -d "${PROJECT_ROOT}/dist" ]]; then
        /usr/bin/mv -T "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/dist-rollback-failed-${STAMP}" \
          || { recovery_failed=1; dist_restore_ready=0; }
      fi
      if (( dist_restore_ready == 1 )); then
        /usr/bin/cp -a --reflink=auto "${BACKUP_DIR}/dist-after-${STAMP}" "${PROJECT_ROOT}/.rollforward-dist-${STAMP}" \
          || { recovery_failed=1; dist_restore_ready=0; }
      fi
      if (( dist_restore_ready == 1 )); then
        /usr/bin/mv -T "${PROJECT_ROOT}/.rollforward-dist-${STAMP}" "${PROJECT_ROOT}/dist" || recovery_failed=1
        dist_manifest "${PROJECT_ROOT}/dist" | /usr/bin/cmp - "${BACKUP_DIR}/deployed-bundle.sha256" \
          || recovery_failed=1
      fi
    fi
    if (( writers_stopped == 1 && source_swapped == 1 )); then
      restore_current_source || recovery_failed=1
    fi
    /usr/bin/systemctl --user start "${APP_SERVICE}" || recovery_failed=1
    wait_for_local_health || recovery_failed=1
    start_timers || recovery_failed=1
    /usr/bin/systemctl --user is-active --quiet "${APP_SERVICE}" || recovery_failed=1
    for timer in "${TIMERS[@]}"; do
      /usr/bin/systemctl --user is-active --quiet "${timer}" || recovery_failed=1
    done
  fi
  if (( status == 0 )); then status=1; fi
  if (( recovery_failed != 0 )); then
    printf 'Rollback recovery was incomplete; inspect %s and the user journal immediately.\n' "${BACKUP_DIR}" >&2
    status=70
  fi
  exit "${status}"
}
trap rollback_failed_rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

stop_writers

/usr/bin/cp -a --reflink=auto "${BACKUP_DIR}/dist-before" "${PROJECT_ROOT}/.rollback-dist-${STAMP}"
dist_swapped=1
/usr/bin/mv "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/dist-after-${STAMP}"
/usr/bin/mv "${PROJECT_ROOT}/.rollback-dist-${STAMP}" "${PROJECT_ROOT}/dist"

source_swapped=1
if [[ -n "${OLD_BRANCH}" \
  && "$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse "refs/heads/${OLD_BRANCH}")" == "${OLD_COMMIT}" ]]; then
  "${GIT_BIN}" -C "${PROJECT_ROOT}" switch "${OLD_BRANCH}"
else
  "${GIT_BIN}" -C "${PROJECT_ROOT}" switch --detach "${OLD_COMMIT}"
fi

if [[ "${DB_MODE}" == "restore-database" ]]; then
  checkpoint_result="$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA wal_checkpoint(TRUNCATE);")"
  [[ "${checkpoint_result%%|*}" == "0" ]] || fail "Current D1 checkpoint remained busy before optional restore."
  [[ ! -s "${D1_FILE}-wal" ]] || fail "Current D1 WAL was not fully checkpointed before optional restore."
  [[ "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA quick_check;")" == "ok" ]] || fail "Current D1 failed quick_check before optional restore."
  [[ -z "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA foreign_key_check;")" ]] || fail "Current D1 failed foreign_key_check before optional restore."
  "${SQLITE_BIN}" "${D1_FILE}" ".backup '${BACKUP_DIR}/d1-after-${STAMP}.sqlite'"
  [[ "$("${SQLITE_BIN}" -readonly "${BACKUP_DIR}/d1-after-${STAMP}.sqlite" "PRAGMA quick_check;")" == "ok" ]] || fail "Current D1 rollback backup failed quick_check."
  [[ -z "$("${SQLITE_BIN}" -readonly "${BACKUP_DIR}/d1-after-${STAMP}.sqlite" "PRAGMA foreign_key_check;")" ]] || fail "Current D1 rollback backup failed foreign_key_check."
  db_swapped=1
  [[ -f "${D1_FILE}-wal" ]] && /usr/bin/mv "${D1_FILE}-wal" "${BACKUP_DIR}/d1-after-${STAMP}.sqlite-wal"
  [[ -f "${D1_FILE}-shm" ]] && /usr/bin/mv "${D1_FILE}-shm" "${BACKUP_DIR}/d1-after-${STAMP}.sqlite-shm"
  /usr/bin/cp -a --reflink=auto "${BACKUP_DIR}/d1-before.sqlite" "${PROJECT_ROOT}/.d1-rollback-${STAMP}.sqlite"
  /usr/bin/mv -f "${PROJECT_ROOT}/.d1-rollback-${STAMP}.sqlite" "${D1_FILE}"
  [[ "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA quick_check;")" == "ok" ]] || fail "Restored D1 failed quick_check."
  [[ -z "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA foreign_key_check;")" ]] || fail "Restored D1 failed foreign_key_check."
fi

/usr/bin/systemctl --user start "${APP_SERVICE}"
wait_for_local_health || fail "Rolled-back application did not become healthy."
start_timers

printf '%s\n' "${STAMP}" >"${BACKUP_DIR}/rolled-back-at-utc"
success=1
trap - EXIT HUP INT TERM
printf 'Rolled back from %s to %s. Database mode: %s\n' "${RELEASE_COMMIT}" "${OLD_COMMIT}" "${DB_MODE}"
