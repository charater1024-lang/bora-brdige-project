#!/usr/bin/env bash
#
# Restore an install-host-security.sh backup.
#
# Example:
#   sudo bash deploy/rollback-host-security.sh \
#     --backup /var/backups/bora-host-security/20260731T010000Z

set -Eeuo pipefail
umask 077
export LC_ALL=C

readonly BACKUP_ROOT="/var/backups/bora-host-security"

BACKUP_REQUEST=""
AUTOMATIC=0

log() {
  printf '[bora-host-security-rollback] %s\n' "$*"
}

warn() {
  printf '[bora-host-security-rollback] WARNING: %s\n' "$*" >&2
}

die() {
  printf '[bora-host-security-rollback] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    "Usage:" \
    "  sudo bash deploy/rollback-host-security.sh --backup BACKUP_DIRECTORY" \
    "" \
    "--auto is reserved for the automatic systemd rollback timer."
}

while (($#)); do
  case "$1" in
    --backup)
      [[ $# -ge 2 ]] || die "--backup requires a directory."
      BACKUP_REQUEST="$2"
      shift 2
      ;;
    --auto)
      AUTOMATIC=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || die "Run rollback through sudo."
[[ -n "${BACKUP_REQUEST}" ]] || die "--backup is required."

for command_name in flock install realpath sshd systemctl tar ufw; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    die "Required command is missing: ${command_name}"
done

install -d -m 0700 -o root -g root "${BACKUP_ROOT}"
ROOT_REAL="$(realpath -e "${BACKUP_ROOT}")"
BACKUP_DIR="$(realpath -e "${BACKUP_REQUEST}")"
case "${BACKUP_DIR}/" in
  "${ROOT_REAL}/"*) ;;
  *) die "Backup must be below ${BACKUP_ROOT}: ${BACKUP_REQUEST}" ;;
esac

METADATA="${BACKUP_DIR}/metadata.env"
[[ -f "${METADATA}" && ! -L "${METADATA}" ]] ||
  die "Backup metadata was not found: ${METADATA}"
[[ -f "${BACKUP_DIR}/etc-ssh.tar" ]] ||
  die "SSH backup archive is missing."
[[ -f "${BACKUP_DIR}/ufw-config.tar" ]] ||
  die "UFW backup archive is missing."

# The directory and metadata are created root-owned with mode 0700/0600.
# shellcheck disable=SC1090
source "${METADATA}"

if [[ -e "${BACKUP_DIR}/confirmed" ]]; then
  if [[ "${AUTOMATIC}" -eq 1 ]]; then
    log "Policy was confirmed; automatic rollback is no longer applicable."
    exit 0
  fi
  warn "Rolling back a previously confirmed policy at operator request."
fi
if [[ -e "${BACKUP_DIR}/rolled-back" ]]; then
  log "This backup was already restored; no further changes are needed."
  exit 0
fi

exec 9>"/run/lock/bora-host-security.lock"
flock 9

PRE_ROLLBACK="${BACKUP_ROOT}/pre-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 -o root -g root "${PRE_ROLLBACK}"
tar --acls --xattrs -cpf "${PRE_ROLLBACK}/etc-ssh.current.tar" -C / etc/ssh
tar --acls --xattrs -cpf "${PRE_ROLLBACK}/ufw-config.current.tar" \
  -C / etc/ufw etc/default/ufw
chmod 0600 "${PRE_ROLLBACK}"/*.tar

CURRENT_DROP_IN="${PRE_ROLLBACK}/ssh-drop-in.current"
CURRENT_DROP_IN_EXISTED=0
if [[ -e "${SSH_DROP_IN_SAVED}" ]]; then
  [[ -f "${SSH_DROP_IN_SAVED}" && ! -L "${SSH_DROP_IN_SAVED}" ]] ||
    die "Current SSH drop-in is not a regular file: ${SSH_DROP_IN_SAVED}"
  cp -a "${SSH_DROP_IN_SAVED}" "${CURRENT_DROP_IN}"
  CURRENT_DROP_IN_EXISTED=1
fi

restore_current_drop_in() {
  if [[ "${CURRENT_DROP_IN_EXISTED}" -eq 1 ]]; then
    cp -a "${CURRENT_DROP_IN}" "${SSH_DROP_IN_SAVED}"
  else
    rm -f -- "${SSH_DROP_IN_SAVED}"
  fi
}

log "Restoring SSH configuration and original authorized_keys permissions."
if [[ "${DROP_IN_EXISTED:?Missing DROP_IN_EXISTED metadata}" -eq 1 ]]; then
  [[ -f "${BACKUP_DIR}/ssh-drop-in.before" ]] ||
    die "Original SSH drop-in backup is missing."
  cp -a "${BACKUP_DIR}/ssh-drop-in.before" "${SSH_DROP_IN_SAVED}"
else
  rm -f -- "${SSH_DROP_IN_SAVED}"
fi

chown "${SSH_DIR_UID}:${SSH_DIR_GID}" "${SSH_DIR_SAVED}"
chmod "${SSH_DIR_MODE}" "${SSH_DIR_SAVED}"
chown "${AUTHORIZED_KEYS_UID}:${AUTHORIZED_KEYS_GID}" "${AUTHORIZED_KEYS_SAVED}"
chmod "${AUTHORIZED_KEYS_MODE}" "${AUTHORIZED_KEYS_SAVED}"

if ! sshd -t; then
  warn "Saved SSH configuration failed validation; retaining the current hardened drop-in."
  restore_current_drop_in
  sshd -t ||
    die "Both saved and current SSH configurations failed validation. Existing SSH sessions were not restarted."
  die "Rollback stopped before reloading sshd."
fi

if ! systemctl reload "${SSH_SERVICE_SAVED}"; then
  warn "systemd reload failed; attempting a HUP without terminating sessions."
  systemctl kill --kill-who=main --signal=HUP "${SSH_SERVICE_SAVED}"
fi

log "Restoring the previous UFW configuration."
ufw --force disable >/dev/null 2>&1 || true
tar --acls --xattrs -xpf "${BACKUP_DIR}/ufw-config.tar" -C /
if [[ "${UFW_WAS_ACTIVE:?Missing UFW_WAS_ACTIVE metadata}" -eq 1 ]]; then
  ufw --force enable
else
  ufw --force disable >/dev/null 2>&1 || true
fi

install -m 0600 -o root -g root /dev/null "${BACKUP_DIR}/rolled-back"
systemctl stop "${ROLLBACK_UNIT}.timer" 2>/dev/null || true

log "Previous SSH and UFW policy restored from ${BACKUP_DIR}"
log "Pre-rollback safety copy retained at ${PRE_ROLLBACK}"
if [[ "${AUTOMATIC}" -eq 1 ]]; then
  warn "Automatic rollback ran because the applied policy was not confirmed in time."
fi
