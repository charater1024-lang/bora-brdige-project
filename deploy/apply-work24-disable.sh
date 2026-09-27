#!/usr/bin/env bash
set -euo pipefail

umask 077

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
readonly SQL_FILE="${1:-}"
readonly BACKUP_DIR="${2:-}"
NODE_BIN="$(bora_tool_path BORA_NODE_BIN node)" || exit 2
readonly NODE_BIN
readonly WRANGLER_JS="${PROJECT_ROOT}/node_modules/wrangler/bin/wrangler.js"
readonly RUNTIME_CONFIG="/run/user/1000/bora-bridge/wrangler.runtime.json"
D1_FILE="$(bora_d1_file "${PROJECT_ROOT}")" || exit 2
readonly D1_FILE
readonly EXEC_CONFIG="${SQL_FILE}.runtime.json"

if [[ "${SQL_FILE}" != /tmp/bora-data-*/disable-work24.sql || ! -f "${SQL_FILE}" ]]; then
  printf 'A staged disable-work24.sql file is required.\n' >&2
  exit 2
fi
if [[ "${BACKUP_DIR}" != "${PROJECT_ROOT}/.deploy-backups/"* || ! -d "${BACKUP_DIR}" ]]; then
  printf 'A prepared backup below .deploy-backups is required.\n' >&2
  exit 2
fi

restart_services() {
  trap - EXIT
  /usr/bin/rm -f -- "${EXEC_CONFIG}"
  /usr/bin/systemctl --user start bora-bridge.service
  for _ in $(seq 1 15); do
    if /usr/bin/bash "${PROJECT_ROOT}/deploy/check-bora-bridge-health.sh"; then
      break
    fi
    /usr/bin/sleep 2
  done
  /usr/bin/systemctl --user start bora-public-data-refresh.timer
  /usr/bin/systemctl --user start bora-bridge-healthcheck.timer
}
trap restart_services EXIT

[[ -r "${RUNTIME_CONFIG}" ]]
[[ ! -e "${EXEC_CONFIG}" ]]
/usr/bin/cp -- "${RUNTIME_CONFIG}" "${EXEC_CONFIG}"
/usr/bin/chmod 0600 "${EXEC_CONFIG}"

/usr/bin/systemctl --user stop bora-public-data-refresh.timer
/usr/bin/systemctl --user stop bora-bridge-healthcheck.timer
/usr/bin/systemctl --user stop bora-bridge.service

[[ -f "${D1_FILE}" ]]
[[ ! -e "${BACKUP_DIR}/d1-pre-work24-disable.sqlite" ]]
/usr/bin/cp --reflink=auto --sparse=always "${D1_FILE}" "${BACKUP_DIR}/d1-pre-work24-disable.sqlite"
/usr/bin/chmod 0600 "${BACKUP_DIR}/d1-pre-work24-disable.sqlite"

cd "${PROJECT_ROOT}"
"${NODE_BIN}" "${WRANGLER_JS}" d1 execute DB \
  --local \
  --persist-to "${PROJECT_ROOT}/.wrangler/state" \
  --config "${EXEC_CONFIG}" \
  --file "${SQL_FILE}"

restart_services
printf 'Work24 external collection disabled; stored credential retained.\n'
