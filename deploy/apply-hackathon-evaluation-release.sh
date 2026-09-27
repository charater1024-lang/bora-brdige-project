#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
GIT_BIN="$(bora_tool_path BORA_GIT_BIN git)" || exit 2
readonly GIT_BIN
NODE_BIN="$(bora_tool_path BORA_NODE_BIN node)" || exit 2
readonly NODE_BIN
SQLITE_BIN="$(bora_tool_path BORA_SQLITE_BIN sqlite3)" || exit 2
readonly SQLITE_BIN
D1_FILE="$(bora_d1_file "${PROJECT_ROOT}")" || exit 2
readonly D1_FILE
readonly LOCK_FILE="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bora-hackathon-evaluation-release.lock"
readonly STAGE_DIR="${1:-}"
readonly RELEASE_SHA="${2:-}"
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly BACKUP_DIR="${PROJECT_ROOT}/.deploy-backups/hackathon-evaluation-${STAMP}"
readonly RELEASE_STAGE="${PROJECT_ROOT}/.deploy-stage-hackathon-${STAMP}"
readonly MIGRATIONS=(
  "drizzle/0020_wet_sphinx.sql"
  "drizzle/0021_messy_shocker.sql"
  "drizzle/0022_modern_bromley.sql"
)
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

[[ "${STAGE_DIR}" == /tmp/bora-hackathon-* ]] || fail "Stage must be below /tmp/bora-hackathon-*"
[[ -d "${STAGE_DIR}" && ! -L "${STAGE_DIR}" ]] || fail "Stage directory is missing or symbolic."
[[ "$(readlink -f "${STAGE_DIR}")" == "${STAGE_DIR}" ]] || fail "Stage path must be canonical."
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || fail "A full 40-character release commit is required."
[[ "$(readlink -f "${PROJECT_ROOT}")" == "${PROJECT_ROOT}" ]] || fail "Project root is not canonical."
[[ -x "${GIT_BIN}" && -x "${NODE_BIN}" && -x "${SQLITE_BIN}" ]] || fail "Required server tools are unavailable."
[[ -f "${D1_FILE}" && ! -L "${D1_FILE}" ]] || fail "The production D1 file is missing or symbolic."
[[ -f "${STAGE_DIR}/dist/server/index.js" ]] || fail "The staged server bundle is missing."
[[ -f "${STAGE_DIR}/dist/server/wrangler.json" ]] || fail "The staged Wrangler manifest is missing."
[[ -d "${STAGE_DIR}/dist/client" ]] || fail "The staged client bundle is missing."
[[ -z "$(/usr/bin/find "${STAGE_DIR}/dist" -type l -print -quit)" ]] || fail "The staged bundle contains a symbolic link."
for migration in "${MIGRATIONS[@]}"; do
  [[ -f "${STAGE_DIR}/${migration}" ]] || fail "A required release migration is missing: ${migration}"
done
[[ -f "${STAGE_DIR}/scripts/apply-local-sqlite-migrations.mjs" ]] || fail "The migration runner is missing."

exec 9>"${LOCK_FILE}"
/usr/bin/flock -n 9 || fail "Another BORA Bridge release is already running."

[[ -f "${PROJECT_ROOT}/dist/server/index.js" \
  && -f "${PROJECT_ROOT}/dist/server/wrangler.json" \
  && -d "${PROJECT_ROOT}/dist/client" \
  && ! -L "${PROJECT_ROOT}/dist" ]] || fail "The current production bundle is missing, incomplete, or symbolic."
[[ -z "$(/usr/bin/find "${PROJECT_ROOT}/dist" -type l -print -quit)" ]] || fail "The current production bundle contains a symbolic link."
[[ "$("${GIT_BIN}" -C "${STAGE_DIR}" rev-parse HEAD)" == "${RELEASE_SHA}" ]] || fail "Stage commit does not match the requested release."
"${GIT_BIN}" -C "${PROJECT_ROOT}" cat-file -e "${RELEASE_SHA}^{commit}"
[[ -z "$("${GIT_BIN}" -C "${PROJECT_ROOT}" status --porcelain --untracked-files=no)" ]] || fail "Production tracked files are not clean."
/usr/bin/systemctl --user is-active --quiet "${APP_SERVICE}" || fail "The application service is not active before deployment."
for timer in "${TIMERS[@]}"; do
  /usr/bin/systemctl --user is-active --quiet "${timer}" || fail "Required timer is not active: ${timer}"
done

readonly OLD_COMMIT="$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse HEAD)"
OLD_BRANCH="$("${GIT_BIN}" -C "${PROJECT_ROOT}" symbolic-ref --quiet --short HEAD || true)"
readonly OLD_BRANCH

/usr/bin/install -d -m 0700 "${BACKUP_DIR}" "${RELEASE_STAGE}"
/usr/bin/install -d -m 0700 "${RELEASE_STAGE}/dist"
/usr/bin/cp -a --reflink=auto "${STAGE_DIR}/dist/." "${RELEASE_STAGE}/dist/"
[[ -f "${RELEASE_STAGE}/dist/server/index.js" ]] || fail "Release copy validation failed."

printf '%s\n' "${OLD_COMMIT}" >"${BACKUP_DIR}/old-commit"
printf '%s\n' "${OLD_BRANCH}" >"${BACKUP_DIR}/old-branch"
printf '%s\n' "${RELEASE_SHA}" >"${BACKUP_DIR}/release-commit"
dist_manifest "${RELEASE_STAGE}/dist" >"${BACKUP_DIR}/release-bundle.sha256"
dist_manifest "${PROJECT_ROOT}/dist" >"${BACKUP_DIR}/previous-bundle.sha256"
for unit in "${APP_SERVICE}" "${TIMERS[@]}" "${WRITER_SERVICES[@]}"; do
  /usr/bin/systemctl --user cat "${unit}" >"${BACKUP_DIR}/${unit}.unit.txt" 2>/dev/null || true
done
/usr/bin/stat -c '%a %U %G %n' "${PROJECT_ROOT}/.env.local" >"${BACKUP_DIR}/environment-permissions.txt"

dist_swapped=0
source_swapped=0
migration_started=0
app_started=0
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

restore_source() {
  if [[ -n "${OLD_BRANCH}" \
    && "$("${GIT_BIN}" -C "${PROJECT_ROOT}" rev-parse "refs/heads/${OLD_BRANCH}")" == "${OLD_COMMIT}" ]]; then
    "${GIT_BIN}" -C "${PROJECT_ROOT}" switch "${OLD_BRANCH}"
  else
    "${GIT_BIN}" -C "${PROJECT_ROOT}" switch --detach "${OLD_COMMIT}"
  fi
}

rollback_on_error() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  local recovery_failed=0
  if (( success == 0 )); then
    printf 'Release failed; restoring the previous application bundle. Backup: %s\n' "${BACKUP_DIR}" >&2
    stop_writers || recovery_failed=1
    if (( writers_stopped == 1 && dist_swapped == 1 )) && [[ -d "${BACKUP_DIR}/dist-before" ]]; then
      local dist_restore_ready=1
      if [[ -d "${PROJECT_ROOT}/dist" ]]; then
        /usr/bin/mv -T "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/dist-failed" \
          || { recovery_failed=1; dist_restore_ready=0; }
      fi
      if (( dist_restore_ready == 1 )); then
        /usr/bin/cp -a --reflink=auto "${BACKUP_DIR}/dist-before" "${PROJECT_ROOT}/.rollback-dist-${STAMP}" \
          || { recovery_failed=1; dist_restore_ready=0; }
      fi
      if (( dist_restore_ready == 1 )); then
        /usr/bin/mv -T "${PROJECT_ROOT}/.rollback-dist-${STAMP}" "${PROJECT_ROOT}/dist" || recovery_failed=1
        dist_manifest "${PROJECT_ROOT}/dist" | /usr/bin/cmp - "${BACKUP_DIR}/previous-bundle.sha256" \
          || recovery_failed=1
      fi
    fi
    if (( writers_stopped == 1 && source_swapped == 1 )); then
      restore_source || recovery_failed=1
    fi
    # Migration 0020 is additive. Once the new app has accepted traffic, leave
    # the unused table in place instead of risking loss of newer user writes.
    if (( writers_stopped == 1 && migration_started == 1 && app_started == 0 )) \
      && [[ -f "${BACKUP_DIR}/d1-before.sqlite" ]]; then
      local db_restore_ready=1
      if [[ -f "${D1_FILE}-wal" ]]; then
        /usr/bin/mv "${D1_FILE}-wal" "${BACKUP_DIR}/d1-failed.sqlite-wal" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if [[ -f "${D1_FILE}-shm" ]]; then
        /usr/bin/mv "${D1_FILE}-shm" "${BACKUP_DIR}/d1-failed.sqlite-shm" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if (( db_restore_ready == 1 )); then
        /usr/bin/cp -a --reflink=auto "${D1_FILE}" "${BACKUP_DIR}/d1-failed.sqlite" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if (( db_restore_ready == 1 )); then
        /usr/bin/cp -a --reflink=auto "${BACKUP_DIR}/d1-before.sqlite" "${PROJECT_ROOT}/.d1-restore-${STAMP}.sqlite" \
          || { recovery_failed=1; db_restore_ready=0; }
      fi
      if (( db_restore_ready == 1 )); then
        /usr/bin/mv -f "${PROJECT_ROOT}/.d1-restore-${STAMP}.sqlite" "${D1_FILE}" || recovery_failed=1
        [[ "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA quick_check;")" == "ok" ]] || recovery_failed=1
        [[ -z "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA foreign_key_check;")" ]] || recovery_failed=1
      fi
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
    printf 'Automatic recovery was incomplete; inspect %s and the user journal immediately.\n' "${BACKUP_DIR}" >&2
    status=70
  fi
  exit "${status}"
}
trap rollback_on_error EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

stop_writers

checkpoint_result="$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA wal_checkpoint(TRUNCATE);")"
[[ "${checkpoint_result%%|*}" == "0" ]] || fail "Production D1 checkpoint remained busy."
[[ ! -s "${D1_FILE}-wal" ]] || fail "Production D1 WAL was not fully checkpointed."
[[ "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA quick_check;")" == "ok" ]] || fail "Production D1 failed quick_check before backup."
[[ -z "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA foreign_key_check;")" ]] || fail "Production D1 has foreign-key violations before backup."
"${SQLITE_BIN}" "${D1_FILE}" ".backup '${BACKUP_DIR}/d1-before.sqlite'"
/usr/bin/chmod 0600 "${BACKUP_DIR}/d1-before.sqlite"
[[ "$("${SQLITE_BIN}" -readonly "${BACKUP_DIR}/d1-before.sqlite" "PRAGMA quick_check;")" == "ok" ]] || fail "D1 backup failed quick_check."
[[ -z "$("${SQLITE_BIN}" -readonly "${BACKUP_DIR}/d1-before.sqlite" "PRAGMA foreign_key_check;")" ]] || fail "D1 backup failed foreign_key_check."
/usr/bin/sha256sum "${BACKUP_DIR}/d1-before.sqlite" | /usr/bin/cut -d ' ' -f 1 >"${BACKUP_DIR}/d1-before.sqlite.sha256"
/usr/bin/cp -a --reflink=auto --sparse=always "${BACKUP_DIR}/d1-before.sqlite" "${BACKUP_DIR}/d1-migration-dry-run.sqlite"

"${NODE_BIN}" --experimental-sqlite \
  "${STAGE_DIR}/scripts/apply-local-sqlite-migrations.mjs" \
  "${BACKUP_DIR}/d1-migration-dry-run.sqlite" \
  "${STAGE_DIR}/${MIGRATIONS[0]}" \
  "${STAGE_DIR}/${MIGRATIONS[1]}" \
  "${STAGE_DIR}/${MIGRATIONS[2]}"
[[ "$("${SQLITE_BIN}" "${BACKUP_DIR}/d1-migration-dry-run.sqlite" "PRAGMA quick_check;")" == "ok" ]] || fail "Migration dry-run failed quick_check."
[[ "$("${SQLITE_BIN}" "${BACKUP_DIR}/d1-migration-dry-run.sqlite" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='judge_evaluation_sessions';")" == "1" ]] || fail "Migration dry-run did not create the judge-session table."
[[ "$("${SQLITE_BIN}" "${BACKUP_DIR}/d1-migration-dry-run.sqlite" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='phishing_reputation_lookup_quotas';")" == "1" ]] || fail "Migration dry-run did not create the phishing reputation quota table."
[[ "$("${SQLITE_BIN}" "${BACKUP_DIR}/d1-migration-dry-run.sqlite" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='phishing_reputation_lookup_quotas_updated_idx';")" == "1" ]] || fail "Migration dry-run did not create the phishing reputation quota index."
[[ "$("${SQLITE_BIN}" "${BACKUP_DIR}/d1-migration-dry-run.sqlite" "SELECT COUNT(*) FROM bora_local_schema_migrations WHERE migration_name IN ('0020_wet_sphinx.sql','0021_messy_shocker.sql','0022_modern_bromley.sql');")" == "3" ]] || fail "Migration dry-run ledger is incomplete."

dist_swapped=1
/usr/bin/mv "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/dist-before"
/usr/bin/mv "${RELEASE_STAGE}/dist" "${PROJECT_ROOT}/dist"
/usr/bin/rmdir "${RELEASE_STAGE}"

source_swapped=1
"${GIT_BIN}" -C "${PROJECT_ROOT}" switch --detach "${RELEASE_SHA}"

migration_started=1
"${NODE_BIN}" --experimental-sqlite \
  "${PROJECT_ROOT}/scripts/apply-local-sqlite-migrations.mjs" \
  "${D1_FILE}" \
  "${PROJECT_ROOT}/${MIGRATIONS[0]}" \
  "${PROJECT_ROOT}/${MIGRATIONS[1]}" \
  "${PROJECT_ROOT}/${MIGRATIONS[2]}"
[[ "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA quick_check;")" == "ok" ]] || fail "Production D1 failed quick_check after migration."
[[ -z "$("${SQLITE_BIN}" "${D1_FILE}" "PRAGMA foreign_key_check;")" ]] || fail "Production D1 failed foreign_key_check after migration."
[[ "$("${SQLITE_BIN}" "${D1_FILE}" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='phishing_reputation_lookup_quotas';")" == "1" ]] || fail "Production D1 is missing the phishing reputation quota table."
[[ "$("${SQLITE_BIN}" "${D1_FILE}" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='phishing_reputation_lookup_quotas_updated_idx';")" == "1" ]] || fail "Production D1 is missing the phishing reputation quota index."
[[ "$("${SQLITE_BIN}" "${D1_FILE}" "SELECT COUNT(*) FROM bora_local_schema_migrations WHERE migration_name IN ('0020_wet_sphinx.sql','0021_messy_shocker.sql','0022_modern_bromley.sql');")" == "3" ]] || fail "Production migration ledger is incomplete."

app_started=1
/usr/bin/systemctl --user start "${APP_SERVICE}"
wait_for_local_health

local_challenge_html="$(/usr/bin/curl --silent --show-error --fail --max-time 15 \
  --header 'Host: borabridge.com' \
  --header 'X-Forwarded-Host: borabridge.com' \
  --header 'X-Forwarded-Proto: https' \
  --header 'Origin: https://borabridge.com' \
  "http://127.0.0.1:3000/challenge?release=${RELEASE_SHA}")"
/usr/bin/grep -q 'bora-challenge-2026-v1' <<<"${local_challenge_html}" || fail "Local challenge marker is missing."
local_evaluation_html="$(/usr/bin/curl --silent --show-error --fail --max-time 15 \
  --header 'Host: borabridge.com' \
  --header 'X-Forwarded-Host: borabridge.com' \
  --header 'X-Forwarded-Proto: https' \
  --header 'Origin: https://borabridge.com' \
  "http://127.0.0.1:3000/developer/evaluation?release=${RELEASE_SHA}")"
/usr/bin/grep -q 'bora-developer-evaluation-v1' <<<"${local_evaluation_html}" || fail "Local evaluation marker is missing."
local_safety_html="$(/usr/bin/curl --silent --show-error --fail --max-time 15 \
  --header 'Host: borabridge.com' \
  --header 'X-Forwarded-Host: borabridge.com' \
  --header 'X-Forwarded-Proto: https' \
  --header 'Origin: https://borabridge.com' \
  "http://127.0.0.1:3000/safety?release=${RELEASE_SHA}")"
/usr/bin/grep -q 'BORA SHIELD' <<<"${local_safety_html}" || fail "Local safety marker is missing."
local_phishing_response="$(/usr/bin/curl --silent --show-error --fail --max-time 15 \
  --request POST \
  --header 'Host: borabridge.com' \
  --header 'X-Forwarded-Host: borabridge.com' \
  --header 'X-Forwarded-Proto: https' \
  --header 'Origin: https://borabridge.com' \
  --header 'Content-Type: application/json' \
  --data '{"locale":"en","text":"Send your OTP verification code to me now.","reputationConsent":false}' \
  'http://127.0.0.1:3000/api/phishing')"
/usr/bin/grep -q '"riskLevel":"high"' <<<"${local_phishing_response}" || fail "Local phishing hard-stop smoke failed."
/usr/bin/grep -q '"ruleSetVersion":"bora-phishing-rules/2.0"' <<<"${local_phishing_response}" || fail "Local phishing ruleset marker is missing."
/usr/bin/grep -q '"status":"not-requested"' <<<"${local_phishing_response}" || fail "Local phishing smoke unexpectedly attempted URL reputation."
local_auth_response="$(/usr/bin/curl --silent --show-error --write-out $'\n%{http_code}' --max-time 10 \
  --header 'Host: borabridge.com' \
  --header 'X-Forwarded-Host: borabridge.com' \
  --header 'X-Forwarded-Proto: https' \
  --header 'Origin: https://borabridge.com' \
  http://127.0.0.1:3000/api/developer/judge-sessions)"
local_auth_status="${local_auth_response##*$'\n'}"
[[ "${local_auth_status}" == "401" || "${local_auth_status}" == "403" ]] || fail "Anonymous judge API was not denied locally."
/usr/bin/grep -Eq '"error":"(authentication_required|developer_access_denied)"' <<<"${local_auth_response}" || fail "Local judge API denial body is unexpected."

public_challenge_html="$(/usr/bin/curl --silent --show-error --fail --max-time 20 \
  "https://borabridge.com/challenge?release=${RELEASE_SHA}")"
/usr/bin/grep -q 'bora-challenge-2026-v1' <<<"${public_challenge_html}" || fail "Public challenge marker is missing."
public_evaluation_html="$(/usr/bin/curl --silent --show-error --fail --max-time 20 \
  "https://borabridge.com/developer/evaluation?release=${RELEASE_SHA}")"
/usr/bin/grep -qi 'noindex' <<<"${public_evaluation_html}" || fail "Developer evaluation page is missing noindex."
/usr/bin/grep -q 'bora-developer-evaluation-v1' <<<"${public_evaluation_html}" || fail "Public evaluation marker is missing."
public_safety_html="$(/usr/bin/curl --silent --show-error --fail --max-time 20 \
  "https://borabridge.com/safety?release=${RELEASE_SHA}")"
/usr/bin/grep -q 'BORA SHIELD' <<<"${public_safety_html}" || fail "Public safety marker is missing."
public_phishing_response="$(/usr/bin/curl --silent --show-error --fail --max-time 20 \
  --request POST \
  --header 'Origin: https://borabridge.com' \
  --header 'Content-Type: application/json' \
  --data '{"locale":"en","text":"Send your OTP verification code to me now.","reputationConsent":false}' \
  'https://borabridge.com/api/phishing')"
/usr/bin/grep -q '"riskLevel":"high"' <<<"${public_phishing_response}" || fail "Public phishing hard-stop smoke failed."
/usr/bin/grep -q '"ruleSetVersion":"bora-phishing-rules/2.0"' <<<"${public_phishing_response}" || fail "Public phishing ruleset marker is missing."
/usr/bin/grep -q '"status":"not-requested"' <<<"${public_phishing_response}" || fail "Public phishing smoke unexpectedly attempted URL reputation."
public_auth_response="$(/usr/bin/curl --silent --show-error --write-out $'\n%{http_code}' --max-time 15 \
  https://borabridge.com/api/developer/judge-sessions)"
public_auth_status="${public_auth_response##*$'\n'}"
[[ "${public_auth_status}" == "401" || "${public_auth_status}" == "403" ]] || fail "Anonymous judge API was not denied publicly."
/usr/bin/grep -Eq '"error":"(authentication_required|developer_access_denied)"' <<<"${public_auth_response}" || fail "Public judge API denial body is unexpected."

start_timers
for timer in "${TIMERS[@]}"; do
  /usr/bin/systemctl --user is-active --quiet "${timer}"
done

dist_manifest "${PROJECT_ROOT}/dist" >"${BACKUP_DIR}/deployed-bundle.sha256"
/usr/bin/cmp "${BACKUP_DIR}/release-bundle.sha256" "${BACKUP_DIR}/deployed-bundle.sha256"
printf '%s\n' "${STAMP}" >"${BACKUP_DIR}/applied-at-utc"
success=1
trap - EXIT HUP INT TERM
printf 'Hackathon evaluation release %s applied. Rollback backup: %s\n' "${RELEASE_SHA}" "${BACKUP_DIR}"
