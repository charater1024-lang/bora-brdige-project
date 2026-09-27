#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export LC_ALL=C

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
USER_CONFIG_HOME="$(bora_config_home)" || exit 2
readonly USER_CONFIG_HOME
readonly USER_UNIT_ROOT="${USER_CONFIG_HOME}/systemd/user"
NODE_BIN="$(bora_tool_path BORA_NODE_BIN node)" || exit 2
readonly NODE_BIN
readonly NODE_PATH="${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin"
readonly STAGED_NODE_MODULES="${PROJECT_ROOT}/.node_modules-security-new-019f844e"
readonly HEALTH_URL="http://127.0.0.1:3000/api/health"

export PATH="${NODE_PATH}"

BACKUP_REQUEST=""
EXPECTED_PATCH_SHA=""
BACKUP_DIR=""
MUTATION_STARTED=0
DEPLOY_SUCCEEDED=0

log() {
  printf '[bora-user-security] %s\n' "$*"
}

die() {
  printf '[bora-user-security] ERROR: %s\n' "$*" >&2
  exit 1
}

restore_previous_release() {
  local failed_modules recovery_failed=0
  log "Restoring the previous application release."
  systemctl --user stop bora-cloudflared.service bora-bridge.service \
    bora-public-api-proxy.service || {
      log "Unable to stop all services; refusing to replace a running release."
      return 1
    }
  for service_name in bora-cloudflared bora-bridge bora-public-api-proxy; do
    if systemctl --user is-active --quiet "${service_name}.service"; then
      log "A service is still active; refusing to replace its release."
      return 1
    fi
  done

  if [[ -d "${BACKUP_DIR}/node_modules-before" ]]; then
    failed_modules="${BACKUP_DIR}/node_modules-failed"
    if [[ -e "${failed_modules}" ]]; then
      failed_modules="${BACKUP_DIR}/node_modules-failed-$(date -u +%H%M%S)"
    fi
    if [[ -d "${PROJECT_ROOT}/node_modules" ]]; then
      mv "${PROJECT_ROOT}/node_modules" "${failed_modules}" || return 1
    fi
    mv "${BACKUP_DIR}/node_modules-before" "${PROJECT_ROOT}/node_modules" || return 1
  fi

  tar -xzf "${BACKUP_DIR}/source-before.tar.gz" -C "${PROJECT_ROOT}" || recovery_failed=1
  install -m 0644 "${BACKUP_DIR}/build-local-runtime-config.mjs" \
    "${PROJECT_ROOT}/scripts/build-local-runtime-config.mjs" || recovery_failed=1
  install -m 0600 "${BACKUP_DIR}/bora-bridge.service" \
    "${USER_UNIT_ROOT}/bora-bridge.service" || recovery_failed=1
  install -m 0600 "${BACKUP_DIR}/bora-cloudflared.service" \
    "${USER_UNIT_ROOT}/bora-cloudflared.service" || recovery_failed=1
  install -m 0600 "${BACKUP_DIR}/bora-public-api-proxy.service" \
    "${USER_UNIT_ROOT}/bora-public-api-proxy.service" || recovery_failed=1
  (( recovery_failed == 0 )) || return 1

  (
    cd "${PROJECT_ROOT}" || exit 1
    PATH="${NODE_PATH}" npm run build
  ) || return 1
  systemctl --user daemon-reload || return 1
  systemctl --user restart bora-public-api-proxy.service || return 1
  systemctl --user restart bora-bridge.service || return 1
  wait_for_application_health || return 1
  systemctl --user restart bora-cloudflared.service || return 1
  for service_name in bora-public-api-proxy bora-bridge bora-cloudflared; do
    systemctl --user is-active --quiet "${service_name}.service" || return 1
  done
  install -m 0600 /dev/null "${BACKUP_DIR}/rolled-back" || return 1
  log "Previous release restored. Inspect ${BACKUP_DIR} before another attempt."
}

wait_for_application_health() {
  local attempt body
  for attempt in $(seq 1 45); do
    body="$(curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
      --header 'Host: borabridge.com' \
      --header 'X-Forwarded-Host: borabridge.com' \
      --header 'X-Forwarded-Proto: https' \
      "${HEALTH_URL}" 2>/dev/null)" || body=''
    [[ "${body}" == '{"status":"ok"}' ]] && return 0
    sleep 1
  done
  return 1
}

on_exit() {
  local status=$?
  trap - EXIT
  # Once restoration starts, a second signal must not interrupt or repeat it.
  trap '' HUP INT TERM
  set +e
  if (( MUTATION_STARTED == 1 && DEPLOY_SUCCEEDED == 0 )); then
    (( status != 0 )) || status=1
    if ! restore_previous_release; then
      printf '[bora-user-security] ERROR: Automatic rollback incomplete (original exit %s); inspect %s immediately.\n' \
        "${status}" "${BACKUP_DIR}" >&2
      status=70
    fi
  fi
  exit "${status}"
}

while (($#)); do
  case "$1" in
    --backup)
      [[ $# -ge 2 ]] || die "--backup requires a directory."
      BACKUP_REQUEST="$2"
      shift 2
      ;;
    --patch-sha256)
      [[ $# -ge 2 ]] || die "--patch-sha256 requires a digest."
      EXPECTED_PATCH_SHA="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ -n "${BACKUP_REQUEST}" ]] || die "--backup is required."
[[ "${EXPECTED_PATCH_SHA}" =~ ^[a-f0-9]{64}$ ]] ||
  die "--patch-sha256 must be a lowercase SHA-256 digest."
[[ "$(id -u)" -ne 0 ]] || die "Run this deployment as the application user, not root."

for command_name in awk curl id install mv npm readlink seq sha256sum sleep systemctl tar; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    die "Required command is missing: ${command_name}"
done

PROJECT_REAL="$(readlink -f "${PROJECT_ROOT}")"
BACKUP_DIR="$(readlink -f "${BACKUP_REQUEST}")"
case "${BACKUP_DIR}/" in
  "${PROJECT_REAL}/.deploy-backups/"*) ;;
  *) die "Backup directory escaped ${PROJECT_ROOT}/.deploy-backups." ;;
esac

for required_file in \
  "${BACKUP_DIR}/source-before.tar.gz" \
  "${BACKUP_DIR}/security-patch.tar" \
  "${BACKUP_DIR}/build-local-runtime-config.mjs" \
  "${BACKUP_DIR}/bora-bridge.service" \
  "${BACKUP_DIR}/bora-cloudflared.service" \
  "${BACKUP_DIR}/bora-public-api-proxy.service"
do
  [[ -f "${required_file}" && ! -L "${required_file}" ]] ||
    die "Required rollback or patch file is missing: ${required_file}"
done
[[ -d "${PROJECT_ROOT}/node_modules" && ! -L "${PROJECT_ROOT}/node_modules" ]] ||
  die "Current node_modules is missing or unsafe."
[[ -d "${STAGED_NODE_MODULES}" && ! -L "${STAGED_NODE_MODULES}" ]] ||
  die "Validated staged node_modules is missing or unsafe."
[[ ! -e "${BACKUP_DIR}/node_modules-before" ]] ||
  die "The rollback node_modules path already exists."

ACTUAL_PATCH_SHA="$(sha256sum "${BACKUP_DIR}/security-patch.tar" | awk '{print $1}')"
[[ "${ACTUAL_PATCH_SHA}" == "${EXPECTED_PATCH_SHA}" ]] ||
  die "Patch archive digest mismatch."

while IFS= read -r archive_path; do
  case "${archive_path}" in
    /*|../*|*/../*|*/..) die "Unsafe patch archive entry: ${archive_path}" ;;
  esac
done < <(tar -tf "${BACKUP_DIR}/security-patch.tar")

for service_name in bora-bridge bora-cloudflared bora-public-api-proxy; do
  systemctl --user is-active --quiet "${service_name}.service" ||
    die "Service is not active before deployment: ${service_name}"
done

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
MUTATION_STARTED=1

log "Stopping the request-serving process for an atomic dependency swap."
systemctl --user stop bora-bridge.service
mv "${PROJECT_ROOT}/node_modules" "${BACKUP_DIR}/node_modules-before"
mv "${STAGED_NODE_MODULES}" "${PROJECT_ROOT}/node_modules"
tar -xf "${BACKUP_DIR}/security-patch.tar" -C "${PROJECT_ROOT}"
chmod 0700 \
  "${PROJECT_ROOT}/deploy/run-bora-sandbox.sh" \
  "${PROJECT_ROOT}/deploy/apply-user-security.sh" \
  "${PROJECT_ROOT}/deploy/install-host-security.sh" \
  "${PROJECT_ROOT}/deploy/rollback-host-security.sh"

log "Building the patched application with the validated dependency tree."
(
  cd "${PROJECT_ROOT}"
  PATH="${NODE_PATH}" npm run build
)

for unit in bora-bridge.service bora-cloudflared.service bora-public-api-proxy.service; do
  bora_install_unit "${PROJECT_ROOT}/deploy/${unit}" "${USER_UNIT_ROOT}/${unit}" "${PROJECT_ROOT}"
done
systemctl --user daemon-reload

log "Restarting hardened user services."
systemctl --user restart bora-public-api-proxy.service
systemctl --user restart bora-bridge.service

wait_for_application_health || die "Hardened application health check failed."

systemctl --user restart bora-cloudflared.service
for service_name in bora-public-api-proxy bora-bridge bora-cloudflared; do
  systemctl --user is-active --quiet "${service_name}.service" ||
    die "Service failed after deployment: ${service_name}"
done

install -m 0600 /dev/null "${BACKUP_DIR}/user-security-applied"
DEPLOY_SUCCEEDED=1
MUTATION_STARTED=0
trap - EXIT HUP INT TERM
log "Application dependency, runtime, and user-service hardening applied."
log "Rollback material remains at ${BACKUP_DIR}."
