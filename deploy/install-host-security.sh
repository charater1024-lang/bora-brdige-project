#!/usr/bin/env bash
#
# Safely harden the BORA Bridge Ubuntu host without exposing the web origin.
#
# The apply flow deliberately uses two phases:
#   1. Apply the SSH/UFW policy and arm an automatic rollback timer.
#   2. Verify a NEW key-only SSH/VS Code Remote session, then confirm the change.
#
# Run with bash because a checkout copied from Windows might not retain +x:
#   sudo --preserve-env=SSH_CONNECTION bash deploy/install-host-security.sh \
#     --apply --admin-user <admin-user> --lan-cidr <lan-cidr> \
#     --confirm-key-login --reset-ufw
#
# After testing a new session, run the exact --confirm command printed at the end.

set -Eeuo pipefail
umask 077
export LC_ALL=C

readonly INSTALLER_VERSION="1.0.2"
readonly BACKUP_ROOT="/var/backups/bora-host-security"
readonly SSH_DROP_IN="/etc/ssh/sshd_config.d/00-bora-host-security.conf"

MODE=""
ADMIN_USER="${SUDO_USER:-}"
LAN_CIDR=""
ROLLBACK_DELAY=600
CONFIRM_KEY_LOGIN=0
RESET_UFW=0
CONFIRM_BACKUP=""
MUTATION_STARTED=0
BACKUP_DIR=""
ROLLBACK_COPY=""

log() {
  printf '[bora-host-security] %s\n' "$*"
}

warn() {
  printf '[bora-host-security] WARNING: %s\n' "$*" >&2
}

die() {
  printf '[bora-host-security] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    "BORA Bridge Ubuntu host hardening ${INSTALLER_VERSION}" \
    "" \
    "Apply (automatic rollback remains armed):" \
    "  sudo --preserve-env=SSH_CONNECTION bash deploy/install-host-security.sh --apply \\" \
    "    --admin-user <admin-user> --lan-cidr <lan-cidr> \\" \
    "    --confirm-key-login --reset-ufw [--rollback-delay 600]" \
    "" \
    "Confirm, but only from a newly opened key-only SSH session:" \
    "  sudo --preserve-env=SSH_CONNECTION bash deploy/install-host-security.sh --confirm BACKUP_DIRECTORY" \
    "" \
    "Show the separate service-account migration plan:" \
    "  bash deploy/install-host-security.sh --print-service-account-plan" \
    "" \
    "Safety notes:" \
    "  * --confirm-key-login asserts that a second SSH login using only a key" \
    "    was successfully tested before applying." \
    "  * --reset-ufw acknowledges replacement of existing inbound UFW rules." \
    "  * Until --confirm is run, an automatic rollback restores SSH and UFW." \
    "  * TCP forwarding remains enabled for VS Code Remote SSH and local ports."
}

service_account_plan() {
  printf '%s\n' \
    "BORA Bridge service-account isolation plan (planning only; no changes made)" \
    "" \
    "1. Keep administration under 'hou', but run the app as a locked system user:" \
    "     bora-bridge, home /var/lib/bora-bridge, shell /usr/sbin/nologin" \
    "2. Install versioned, root-owned releases below /opt/bora-bridge/releases/." \
    "   The service account must not be able to alter executable application code." \
    "3. Put secrets in /etc/bora-bridge/bora-bridge.env as root:bora-bridge 0640." \
    "   Put SQLite/runtime state in /var/lib/bora-bridge as bora-bridge 0700." \
    "4. Convert the current user service to a system service with User=bora-bridge," \
    "   Group=bora-bridge, NoNewPrivileges=true, PrivateTmp=true," \
    "   ProtectSystem=strict, ProtectHome=true, ProtectKernelTunables=true," \
    "   ProtectControlGroups=true, RestrictSUIDSGID=true and explicit ReadWritePaths." \
    "5. Run cloudflared as a different locked account (bora-tunnel), with only its" \
    "   tunnel credential readable. It should reach the app solely on loopback." \
    "6. Migrate a copied database, start the isolated service on a test port, run" \
    "   health/OAuth checks, stop the old user service, then switch the tunnel." \
    "7. Retain a root-owned rollback release and database backup until acceptance." \
    "" \
    "A Python virtual environment does not isolate this Node/Next.js application." \
    "Unix identities, filesystem ownership and systemd sandboxing provide the" \
    "relevant isolation. Migration should be a separate maintenance-window change."
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run this operation through sudo."
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"
}

ssh_client_ip() {
  local connection="${SSH_CONNECTION-}"
  local client_ip

  [[ -n "${connection}" ]] ||
    die "SSH_CONNECTION was removed by sudo. Re-run with: sudo --preserve-env=SSH_CONNECTION bash ..."
  client_ip="${connection%% *}"
  [[ -n "${client_ip}" && "${client_ip}" != "${connection}" ]] ||
    die "SSH_CONNECTION has an invalid format."
  printf '%s\n' "${client_ip}"
}

canonical_backup_path() {
  local requested="$1"
  local root_real backup_real
  root_real="$(realpath -e "${BACKUP_ROOT}")"
  backup_real="$(realpath -e "${requested}")"
  case "${backup_real}/" in
    "${root_real}/"*) printf '%s\n' "${backup_real}" ;;
    *) die "Backup must be below ${BACKUP_ROOT}: ${requested}" ;;
  esac
}

load_metadata() {
  local backup="$1"
  local metadata="${backup}/metadata.env"
  [[ -f "${metadata}" && ! -L "${metadata}" ]] ||
    die "Protected backup metadata was not found: ${metadata}"
  # The directory and file are created root-owned with mode 0700/0600.
  # shellcheck disable=SC1090
  source "${metadata}"
}

confirm_applied_policy() {
  local requested="$1"
  local backup rollback_unit client_ip

  require_root
  for command_name in flock grep install python3 realpath sshd systemctl ufw; do
    need_command "${command_name}"
  done
  install -d -m 0700 -o root -g root "${BACKUP_ROOT}"
  exec 9>"/run/lock/bora-host-security.lock"
  flock 9
  backup="$(canonical_backup_path "${requested}")"
  load_metadata "${backup}"

  [[ ! -e "${backup}/rolled-back" ]] ||
    die "This change was already rolled back; it cannot be confirmed."
  [[ ! -e "${backup}/confirmed" ]] ||
    die "This change was already confirmed."

  rollback_unit="${ROLLBACK_UNIT:?Missing ROLLBACK_UNIT metadata}"
  client_ip="$(ssh_client_ip)"
  if ! python3 - "${client_ip}" "${LAN_CIDR_SAVED:?Missing LAN_CIDR_SAVED metadata}" <<'PY'
import ipaddress
import sys

address = ipaddress.ip_address(sys.argv[1])
network = ipaddress.ip_network(sys.argv[2], strict=False)
raise SystemExit(0 if address in network else 1)
PY
  then
    die "The confirming SSH client ${client_ip} is outside ${LAN_CIDR_SAVED}."
  fi

  sshd -t
  local effective
  effective="$(sshd -T -C "user=${ADMIN_USER_SAVED},host=localhost,addr=${client_ip}")"
  grep -qx 'authenticationmethods publickey' <<<"${effective}" ||
    die "Effective SSH authentication is not key-only."
  grep -qx 'passwordauthentication no' <<<"${effective}" ||
    die "Effective SSH password authentication is still enabled."
  grep -qx 'kbdinteractiveauthentication no' <<<"${effective}" ||
    die "Effective SSH keyboard-interactive authentication is still enabled."
  grep -qx 'allowtcpforwarding local' <<<"${effective}" ||
    die "Local TCP forwarding is not enabled; VS Code Remote SSH could be impaired."
  local ufw_status allow_count expected_count ssh_port
  local -a confirmed_ports=()
  ufw_status="$(ufw status)"
  grep -q '^Status: active' <<<"${ufw_status}" ||
    die "UFW is not active; refusing to confirm an incomplete policy."
  read -r -a confirmed_ports <<<"${SSH_PORTS_SAVED:?Missing SSH_PORTS_SAVED metadata}"
  for ssh_port in "${confirmed_ports[@]}"; do
    grep -Eq "^${ssh_port}/tcp[[:space:]]+ALLOW[[:space:]]+.*${LAN_CIDR_SAVED//./[.]}" \
      <<<"${ufw_status}" ||
      die "The expected LAN-only UFW rule for SSH port ${ssh_port} is missing."
  done
  allow_count="$(
    awk '$2 == "ALLOW" {count++} END {print count + 0}' <<<"${ufw_status}"
  )"
  expected_count="${#confirmed_ports[@]}"
  [[ "${allow_count}" -eq "${expected_count}" ]] ||
    die "Unexpected inbound UFW allow rules were found (${allow_count}, expected ${expected_count})."

  install -m 0600 -o root -g root /dev/null "${backup}/confirmed"
  systemctl stop "${rollback_unit}.timer" 2>/dev/null || true
  systemctl reset-failed "${rollback_unit}.timer" "${rollback_unit}.service" \
    2>/dev/null || true
  log "Policy confirmed. Automatic rollback timer ${rollback_unit}.timer is cancelled."
  log "Protected rollback backup retained at ${backup}"
}

while (($#)); do
  case "$1" in
    --apply)
      [[ -z "${MODE}" ]] || die "Choose exactly one operation."
      MODE="apply"
      shift
      ;;
    --confirm)
      [[ -z "${MODE}" ]] || die "Choose exactly one operation."
      MODE="confirm"
      [[ $# -ge 2 ]] || die "--confirm requires a backup directory."
      CONFIRM_BACKUP="$2"
      shift 2
      ;;
    --print-service-account-plan)
      [[ -z "${MODE}" ]] || die "Choose exactly one operation."
      MODE="plan"
      shift
      ;;
    --admin-user)
      [[ $# -ge 2 ]] || die "--admin-user requires a value."
      ADMIN_USER="$2"
      shift 2
      ;;
    --lan-cidr)
      [[ $# -ge 2 ]] || die "--lan-cidr requires a value."
      LAN_CIDR="$2"
      shift 2
      ;;
    --rollback-delay)
      [[ $# -ge 2 ]] || die "--rollback-delay requires seconds."
      ROLLBACK_DELAY="$2"
      shift 2
      ;;
    --confirm-key-login)
      CONFIRM_KEY_LOGIN=1
      shift
      ;;
    --reset-ufw)
      RESET_UFW=1
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

case "${MODE}" in
  plan)
    service_account_plan
    exit 0
    ;;
  confirm)
    confirm_applied_policy "${CONFIRM_BACKUP}"
    exit 0
    ;;
  apply) ;;
  *)
    usage
    exit 1
    ;;
esac

require_root
[[ -n "${LAN_CIDR}" ]] ||
  die "--lan-cidr is required for --apply."
[[ "${CONFIRM_KEY_LOGIN}" -eq 1 ]] ||
  die "First test a second key-only SSH login, then pass --confirm-key-login."
[[ "${RESET_UFW}" -eq 1 ]] ||
  die "Review current inbound services, then explicitly pass --reset-ufw."
[[ "${ROLLBACK_DELAY}" =~ ^[0-9]+$ ]] ||
  die "--rollback-delay must be a whole number of seconds."
((ROLLBACK_DELAY >= 180 && ROLLBACK_DELAY <= 3600)) ||
  die "--rollback-delay must be between 180 and 3600 seconds."
[[ "${ADMIN_USER}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] ||
  die "Invalid --admin-user value."
[[ "${ADMIN_USER}" != "root" ]] ||
  die "Root must not be the SSH administration identity."

for command_name in \
  awk cp flock getent grep install ln mv python3 realpath sshd \
  stat systemctl systemd-run tar ufw
do
  need_command "${command_name}"
done

exec 9>"/run/lock/bora-host-security.lock"
flock -n 9 || die "Another host-security operation is already running."

[[ -r /etc/os-release ]] || die "/etc/os-release is unavailable."
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "26.04" ]] ||
  die "This script is intentionally limited to Ubuntu 26.04 (found ${ID:-unknown} ${VERSION_ID:-unknown})."
[[ -d /etc/ssh/sshd_config.d ]] ||
  die "OpenSSH drop-in directory is missing: /etc/ssh/sshd_config.d"
[[ -d /etc/ufw && -f /etc/default/ufw ]] ||
  die "UFW configuration is incomplete; install the Ubuntu ufw package first."

getent passwd "${ADMIN_USER}" >/dev/null ||
  die "Administrative user does not exist: ${ADMIN_USER}"
ADMIN_HOME="$(getent passwd "${ADMIN_USER}" | awk -F: '{print $6}')"
ADMIN_SHELL="$(getent passwd "${ADMIN_USER}" | awk -F: '{print $7}')"
ADMIN_GROUP="$(id -gn "${ADMIN_USER}")"
[[ -d "${ADMIN_HOME}" && "${ADMIN_HOME}" != "/" ]] ||
  die "Unsafe or missing home directory for ${ADMIN_USER}: ${ADMIN_HOME}"
case "${ADMIN_SHELL}" in
  */nologin|*/false) die "${ADMIN_USER} does not have an interactive login shell." ;;
esac

SSH_DIR="${ADMIN_HOME}/.ssh"
AUTHORIZED_KEYS="${SSH_DIR}/authorized_keys"
[[ -d "${SSH_DIR}" && ! -L "${SSH_DIR}" ]] ||
  die "${SSH_DIR} must be a real directory."
[[ -f "${AUTHORIZED_KEYS}" && ! -L "${AUTHORIZED_KEYS}" ]] ||
  die "${AUTHORIZED_KEYS} must be a real file."
grep -Eq \
  '(^|[[:space:]])(ssh-(ed25519|rsa)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519(@openssh[.]com)?|sk-ecdsa-sha2-nistp256(@openssh[.]com)?)[[:space:]]+[A-Za-z0-9+/=]+' \
  "${AUTHORIZED_KEYS}" ||
  die "No recognizable public key was found in ${AUTHORIZED_KEYS}."

CLIENT_IP="$(ssh_client_ip)"
if ! python3 - "${CLIENT_IP}" "${LAN_CIDR}" <<'PY'
import ipaddress
import sys

try:
    address = ipaddress.ip_address(sys.argv[1])
    network = ipaddress.ip_network(sys.argv[2], strict=False)
except ValueError as error:
    print(f"Invalid address/network: {error}", file=sys.stderr)
    raise SystemExit(2)
raise SystemExit(0 if address in network else 1)
PY
then
  die "Current SSH client ${CLIENT_IP} is outside the allowed LAN ${LAN_CIDR}."
fi

sshd -t
SSH_EFFECTIVE_BEFORE="$(sshd -T -C "user=${ADMIN_USER},host=localhost,addr=${CLIENT_IP}")"
AUTHORIZED_KEYS_SETTING="$(
  awk '$1 == "authorizedkeysfile" {sub(/^authorizedkeysfile /, ""); print; exit}' \
    <<<"${SSH_EFFECTIVE_BEFORE}"
)"
grep -qE '(^|[[:space:]])(%h/)?[.]ssh/authorized_keys($|[[:space:]])' \
  <<<"${AUTHORIZED_KEYS_SETTING}" ||
  die "Effective sshd AuthorizedKeysFile does not include .ssh/authorized_keys."

mapfile -t SSH_PORTS < <(
  awk '$1 == "port" && $2 ~ /^[0-9]+$/ {print $2}' <<<"${SSH_EFFECTIVE_BEFORE}" |
    sort -un
)
((${#SSH_PORTS[@]} > 0)) || die "Could not determine the effective SSH port."

SSH_SERVICE=""
for candidate in ssh.service sshd.service; do
  if systemctl is-active --quiet "${candidate}"; then
    SSH_SERVICE="${candidate}"
    break
  fi
done
[[ -n "${SSH_SERVICE}" ]] || die "No active OpenSSH systemd service was found."

ROLLBACK_SCRIPT_SOURCE="$(realpath "$(dirname "$0")/rollback-host-security.sh")"
[[ -f "${ROLLBACK_SCRIPT_SOURCE}" && ! -L "${ROLLBACK_SCRIPT_SOURCE}" ]] ||
  die "Rollback companion script is missing: ${ROLLBACK_SCRIPT_SOURCE}"

install -d -m 0700 -o root -g root "${BACKUP_ROOT}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
[[ ! -e "${BACKUP_DIR}" ]] || die "Backup directory already exists: ${BACKUP_DIR}"
install -d -m 0700 -o root -g root "${BACKUP_DIR}"

log "Creating a protected rollback backup at ${BACKUP_DIR}"
tar --acls --xattrs -cpf "${BACKUP_DIR}/etc-ssh.tar" -C / etc/ssh
tar --acls --xattrs -cpf "${BACKUP_DIR}/ufw-config.tar" \
  -C / etc/ufw etc/default/ufw
ufw status verbose >"${BACKUP_DIR}/ufw-status-before.txt" 2>&1 || true
ufw show added >"${BACKUP_DIR}/ufw-rules-before.txt" 2>&1 || true
sshd -T -C "user=${ADMIN_USER},host=localhost,addr=${CLIENT_IP}" \
  >"${BACKUP_DIR}/sshd-effective-before.txt"

DROP_IN_EXISTED=0
if [[ -e "${SSH_DROP_IN}" ]]; then
  [[ -f "${SSH_DROP_IN}" && ! -L "${SSH_DROP_IN}" ]] ||
    die "Refusing to replace non-regular SSH drop-in: ${SSH_DROP_IN}"
  DROP_IN_EXISTED=1
  cp -a "${SSH_DROP_IN}" "${BACKUP_DIR}/ssh-drop-in.before"
fi

SSH_DIR_MODE="$(stat -c '%a' "${SSH_DIR}")"
SSH_DIR_UID="$(stat -c '%u' "${SSH_DIR}")"
SSH_DIR_GID="$(stat -c '%g' "${SSH_DIR}")"
AUTHORIZED_KEYS_MODE="$(stat -c '%a' "${AUTHORIZED_KEYS}")"
AUTHORIZED_KEYS_UID="$(stat -c '%u' "${AUTHORIZED_KEYS}")"
AUTHORIZED_KEYS_GID="$(stat -c '%g' "${AUTHORIZED_KEYS}")"
if ufw status | grep -q '^Status: active'; then
  UFW_WAS_ACTIVE=1
else
  UFW_WAS_ACTIVE=0
fi

ROLLBACK_UNIT="bora-host-security-rollback-${TIMESTAMP,,}"
ROLLBACK_UNIT="${ROLLBACK_UNIT//[^a-z0-9_.@-]/-}"
{
  printf 'SCRIPT_VERSION=%q\n' "${INSTALLER_VERSION}"
  printf 'CREATED_AT=%q\n' "${TIMESTAMP}"
  printf 'ADMIN_USER_SAVED=%q\n' "${ADMIN_USER}"
  printf 'ADMIN_HOME_SAVED=%q\n' "${ADMIN_HOME}"
  printf 'LAN_CIDR_SAVED=%q\n' "${LAN_CIDR}"
  printf 'CLIENT_IP_SAVED=%q\n' "${CLIENT_IP}"
  printf 'SSH_PORTS_SAVED=%q\n' "${SSH_PORTS[*]}"
  printf 'SSH_SERVICE_SAVED=%q\n' "${SSH_SERVICE}"
  printf 'SSH_DROP_IN_SAVED=%q\n' "${SSH_DROP_IN}"
  printf 'DROP_IN_EXISTED=%q\n' "${DROP_IN_EXISTED}"
  printf 'SSH_DIR_SAVED=%q\n' "${SSH_DIR}"
  printf 'SSH_DIR_MODE=%q\n' "${SSH_DIR_MODE}"
  printf 'SSH_DIR_UID=%q\n' "${SSH_DIR_UID}"
  printf 'SSH_DIR_GID=%q\n' "${SSH_DIR_GID}"
  printf 'AUTHORIZED_KEYS_SAVED=%q\n' "${AUTHORIZED_KEYS}"
  printf 'AUTHORIZED_KEYS_MODE=%q\n' "${AUTHORIZED_KEYS_MODE}"
  printf 'AUTHORIZED_KEYS_UID=%q\n' "${AUTHORIZED_KEYS_UID}"
  printf 'AUTHORIZED_KEYS_GID=%q\n' "${AUTHORIZED_KEYS_GID}"
  printf 'UFW_WAS_ACTIVE=%q\n' "${UFW_WAS_ACTIVE}"
  printf 'ROLLBACK_UNIT=%q\n' "${ROLLBACK_UNIT}"
} >"${BACKUP_DIR}/metadata.env"
chmod 0600 "${BACKUP_DIR}/metadata.env" "${BACKUP_DIR}"/*.txt \
  "${BACKUP_DIR}"/*.tar

ROLLBACK_COPY="${BACKUP_DIR}/rollback-host-security.sh"
install -m 0700 -o root -g root "${ROLLBACK_SCRIPT_SOURCE}" "${ROLLBACK_COPY}"
ln -sfn "${BACKUP_DIR}" "${BACKUP_ROOT}/latest"

systemd-run \
  --quiet \
  --unit="${ROLLBACK_UNIT}" \
  --on-active="${ROLLBACK_DELAY}s" \
  --timer-property=AccuracySec=1s \
  --property=Type=oneshot \
  "${ROLLBACK_COPY}" --backup "${BACKUP_DIR}" --auto
MUTATION_STARTED=1

rollback_on_failure() {
  local status=$?
  trap - EXIT
  if [[ "${status}" -ne 0 && "${MUTATION_STARTED}" -eq 1 ]]; then
    warn "Apply failed; restoring the protected backup immediately."
    flock -u 9 || true
    "${ROLLBACK_COPY}" --backup "${BACKUP_DIR}" --auto || \
      warn "Automatic restore also reported an error. Keep this SSH session open and inspect ${BACKUP_DIR}."
  fi
  exit "${status}"
}
trap rollback_on_failure EXIT

SSH_DROP_IN_TMP="${SSH_DROP_IN}.tmp.$$"
{
  printf '%s\n' \
    "# Managed by BORA Bridge deploy/install-host-security.sh" \
    "# Public-key authentication only; TCP forwarding is retained for VS Code." \
    "AuthenticationMethods publickey" \
    "PubkeyAuthentication yes" \
    "PasswordAuthentication no" \
    "KbdInteractiveAuthentication no" \
    "ChallengeResponseAuthentication no" \
    "PermitRootLogin no" \
    "PermitEmptyPasswords no" \
    "GSSAPIAuthentication no" \
    "HostbasedAuthentication no" \
    "AllowTcpForwarding local" \
    "AllowAgentForwarding no" \
    "GatewayPorts no" \
    "X11Forwarding no" \
    "PermitTunnel no" \
    "MaxAuthTries 4" \
    "LoginGraceTime 30"
} >"${SSH_DROP_IN_TMP}"
chown root:root "${SSH_DROP_IN_TMP}"
chmod 0644 "${SSH_DROP_IN_TMP}"
mv -f "${SSH_DROP_IN_TMP}" "${SSH_DROP_IN}"

chown "${ADMIN_USER}:${ADMIN_GROUP}" "${SSH_DIR}" "${AUTHORIZED_KEYS}"
chmod 0700 "${SSH_DIR}"
chmod 0600 "${AUTHORIZED_KEYS}"

sshd -t
SSH_EFFECTIVE_AFTER="$(sshd -T -C "user=${ADMIN_USER},host=localhost,addr=${CLIENT_IP}")"
for expected in \
  'authenticationmethods publickey' \
  'pubkeyauthentication yes' \
  'passwordauthentication no' \
  'kbdinteractiveauthentication no' \
  'permitrootlogin no' \
  'allowtcpforwarding local' \
  'allowagentforwarding no' \
  'gatewayports no'
do
  grep -qx "${expected}" <<<"${SSH_EFFECTIVE_AFTER}" ||
    die "Effective sshd policy did not contain: ${expected}"
done
systemctl reload "${SSH_SERVICE}"

log "Replacing inbound UFW rules with LAN-only SSH access."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw logging low
for ssh_port in "${SSH_PORTS[@]}"; do
  ufw allow from "${LAN_CIDR}" to any port "${ssh_port}" proto tcp \
    comment 'BORA LAN SSH'
done
ufw --force enable
ufw status | grep -q '^Status: active' ||
  die "UFW did not become active."
for ssh_port in "${SSH_PORTS[@]}"; do
  ufw status | grep -Eq "^${ssh_port}/tcp[[:space:]]+ALLOW[[:space:]]+.*${LAN_CIDR//./[.]}" ||
    die "UFW LAN rule for SSH port ${ssh_port} could not be verified."
done

MUTATION_STARTED=0
trap - EXIT

log "Host policy applied; the current SSH session was intentionally left open."
log "Automatic rollback remains armed for ${ROLLBACK_DELAY} seconds."
printf '%s\n' \
  "" \
  "REQUIRED VALIDATION (open a NEW terminal before the timer expires):" \
  "  ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no ${ADMIN_USER}@$(hostname -I | awk '{print $1}')" \
  "" \
  "Also validate VS Code Remote SSH or a local forward, for example:" \
  "  ssh -N -L 13000:127.0.0.1:3000 ${ADMIN_USER}@$(hostname -I | awk '{print $1}')" \
  "" \
  "Only from that NEW successful session, cancel automatic rollback:" \
  "  sudo --preserve-env=SSH_CONNECTION bash $(realpath "$0") --confirm ${BACKUP_DIR}" \
  "" \
  "If validation fails, do nothing: ${ROLLBACK_UNIT}.timer will restore the" \
  "previous SSH/UFW policy automatically. Manual rollback is also available:" \
  "  sudo bash ${ROLLBACK_COPY} --backup ${BACKUP_DIR}"
