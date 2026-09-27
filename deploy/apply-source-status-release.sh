#!/usr/bin/env bash
set -euo pipefail

umask 077

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
readonly STAGE_DIR="${1:-}"
readonly BUILD_DIR="${2:-}"
readonly BACKUP_DIR="${3:-}"
readonly NEXT_DIST="${PROJECT_ROOT}/dist.source-status-next"

if [[ "${STAGE_DIR}" != /tmp/bora-status-* || ! -d "${STAGE_DIR}" ]]; then
  printf 'A validated /tmp/bora-status-* stage directory is required.\n' >&2
  exit 2
fi
if [[ "${BUILD_DIR}" != "${PROJECT_ROOT}-build-"* \
  || ! -d "${BUILD_DIR}/dist" ]]; then
  printf 'A validated isolated build is required.\n' >&2
  exit 2
fi
if [[ "${BACKUP_DIR}" != "${PROJECT_ROOT}/.deploy-backups/"* || ! -d "${BACKUP_DIR}" ]]; then
  printf 'A prepared backup below .deploy-backups is required.\n' >&2
  exit 2
fi

for relative in \
  lib/public-data/operations-view.ts \
  lib/public-data/service.ts \
  tests/public-dashboard-access.test.mjs
do
  [[ -f "${STAGE_DIR}/${relative}" ]] || {
    printf 'Missing staged file: %s\n' "${relative}" >&2
    exit 2
  }
done

[[ -f "${BUILD_DIR}/dist/server/index.js" ]]
[[ -f "${BUILD_DIR}/dist/server/wrangler.json" ]]
[[ ! -e "${NEXT_DIST}" ]]
[[ ! -e "${BACKUP_DIR}/dist-pre-source-status" ]]
/usr/bin/cp -a --reflink=auto "${BUILD_DIR}/dist" "${NEXT_DIST}"

source_installed=0
dist_swapped=0
rollback() {
  local status=$?
  trap - ERR
  if (( source_installed == 1 )); then
    printf 'Source-status release failed readiness; restoring source and build.\n' >&2
    /usr/bin/install -m 0644 "${BACKUP_DIR}/operations-view.ts" \
      "${PROJECT_ROOT}/lib/public-data/operations-view.ts"
    /usr/bin/install -m 0644 "${BACKUP_DIR}/service.ts" \
      "${PROJECT_ROOT}/lib/public-data/service.ts"
    /usr/bin/install -m 0644 "${BACKUP_DIR}/public-dashboard-access.test.mjs" \
      "${PROJECT_ROOT}/tests/public-dashboard-access.test.mjs"
  fi
  if (( dist_swapped == 1 )); then
    /usr/bin/mv "${PROJECT_ROOT}/dist" "${STAGE_DIR}/dist-failed"
    /usr/bin/mv "${BACKUP_DIR}/dist-pre-source-status" "${PROJECT_ROOT}/dist"
  fi
  /usr/bin/systemctl --user restart bora-bridge.service
  /usr/bin/systemctl --user start bora-bridge-healthcheck.timer
  exit "${status}"
}
trap rollback ERR

/usr/bin/systemctl --user stop bora-bridge-healthcheck.timer
/usr/bin/systemctl --user stop bora-bridge.service

/usr/bin/install -m 0644 "${STAGE_DIR}/lib/public-data/operations-view.ts" \
  "${PROJECT_ROOT}/lib/public-data/operations-view.ts"
/usr/bin/install -m 0644 "${STAGE_DIR}/lib/public-data/service.ts" \
  "${PROJECT_ROOT}/lib/public-data/service.ts"
/usr/bin/install -m 0644 "${STAGE_DIR}/tests/public-dashboard-access.test.mjs" \
  "${PROJECT_ROOT}/tests/public-dashboard-access.test.mjs"
source_installed=1

/usr/bin/mv "${PROJECT_ROOT}/dist" "${BACKUP_DIR}/dist-pre-source-status"
/usr/bin/mv "${NEXT_DIST}" "${PROJECT_ROOT}/dist"
dist_swapped=1

/usr/bin/systemctl --user start bora-bridge.service
ready=0
for _ in $(seq 1 15); do
  if /usr/bin/bash "${PROJECT_ROOT}/deploy/check-bora-bridge-health.sh"; then
    ready=1
    break
  fi
  /usr/bin/sleep 2
done
if (( ready != 1 )); then
  printf 'BORA Bridge did not become ready after the source-status release.\n' >&2
  false
fi

/usr/bin/systemctl --user start bora-bridge-healthcheck.timer
trap - ERR
printf 'BORA Bridge inactive-source display release applied and verified.\n'
