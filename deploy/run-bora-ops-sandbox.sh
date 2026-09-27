#!/usr/bin/env bash
set -euo pipefail
umask 077

# Use the same direct Bubblewrap boundary as the web service. Nested systemd
# user-manager namespaces are not available on every supported Ubuntu host.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "${script_dir}/deployment-paths.sh"
project_root="$(bora_project_root "${BASH_SOURCE[0]}")"
[[ "${project_root}" == "$(cd -- "${script_dir}/.." && pwd -P)" ]] || exit 2
readonly project_root
readonly ops_mode="${1:-}"
[[ $# == 1 && ( "${ops_mode}" == backup || "${ops_mode}" == readiness ) ]] || {
  printf '{"status":"failed","code":"invalid_ops_sandbox_mode"}\n' >&2; exit 2;
}

fail() { printf '{"status":"failed","code":"%s"}\n' "$1" >&2; exit 2; }
readonly account_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
[[ "${account_home}" == /* && "${account_home}" != / \
  && "$(readlink -f -- "${account_home}")" == "${account_home}" ]] || fail invalid_service_home
readonly data_root="${account_home}/.local/share/bora-bridge"
readonly database="${BORA_DATABASE_PATH:-}"
readonly backup_dir="${BORA_BACKUP_DIR:-}"
readonly status_dir="${BORA_OPS_STATUS_DIR:-${data_root}/ops}"
readonly public_key="${BORA_BACKUP_PUBLIC_KEY:-${account_home}/.config/bora-bridge/backup-public.pem}"
readonly public_url="${BORA_PUBLIC_URL:-}"
readonly bwrap_bin=/usr/bin/bwrap
readonly python_bin=/usr/bin/python3

[[ -x "${bwrap_bin}" && -x "${python_bin}" ]] || fail sandbox_runtime_missing
[[ "${database%/*}" == "${project_root}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject" \
  && "${database}" == *.sqlite && "${database##*/}" != metadata.sqlite \
  && -f "${database}" && -r "${database}" \
  && "$(readlink -f -- "${database}")" == "${database}" ]] || fail unsafe_database_path
[[ "${backup_dir}" == "${data_root}/encrypted-backups" || "${backup_dir}" == "${data_root}/backups" ]] \
  || fail unsafe_backup_directory
[[ "${status_dir}" == "${data_root}/ops" ]] || fail unsafe_status_directory

private_directory() {
  local candidate="$1" owner mode
  [[ -d "${candidate}" && ! -L "${candidate}" \
    && "$(readlink -f -- "${candidate}")" == "${candidate}" ]] || fail private_directory_missing_or_symbolic
  read -r owner mode < <(stat --format='%u %a' -- "${candidate}")
  [[ "${owner}" == "$(id -u)" && "${mode}" == 700 ]] || fail private_directory_permissions
}
private_directory "${backup_dir}"
[[ "${ops_mode}" != readiness ]] || private_directory "${status_dir}"
if [[ "${ops_mode}" == backup ]]; then
  # Scheduled/off-server backups must never silently fall back to plaintext.
  [[ "${public_key}" == "${account_home}/.config/bora-bridge/backup-public.pem" \
    && -f "${public_key}" && -r "${public_key}" \
    && "$(readlink -f -- "${public_key}")" == "${public_key}" ]] || fail backup_public_key_required
fi
[[ -z "${public_url}" || "${public_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
  || fail invalid_public_probe_origin

args=(
  --die-with-parent --new-session --unshare-user-try --unshare-ipc
  --unshare-pid --unshare-uts --unshare-cgroup-try --cap-drop ALL
  --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp
  --chdir "${project_root}" --hostname bora-ops --clearenv
  --setenv HOME "${account_home}" --setenv PATH /usr/bin:/bin
  --setenv LANG C.UTF-8 --setenv TMPDIR /tmp
  --setenv BORA_DATABASE_PATH "${database}"
  --setenv BORA_BACKUP_DIR "${backup_dir}"
)

mask_directory() {
  [[ ! -d "$1" ]] || args+=(--tmpfs "$1")
}
mask_file() {
  [[ ! -e "$1" ]] || args+=(--ro-bind /dev/null "$1")
}
for directory in \
  "${account_home}/.ssh" "${account_home}/.gnupg" "${account_home}/.cloudflared" \
  "${account_home}/.aws" "${account_home}/.azure" "${account_home}/.kube" \
  "${account_home}/.docker" "${account_home}/.config" "${account_home}/.cache" \
  "${account_home}/.vscode-server" "${account_home}/.cursor-server" \
  "${account_home}/.codex" "${account_home}/.claude" \
  "${account_home}/.local/share/keyrings" "${data_root}" \
  "${project_root}/.git" "${project_root}/.deploy-backups" "${project_root}/.wrangler"
do
  mask_directory "${directory}"
done
for file in \
  "${account_home}/.gitconfig" "${account_home}/.git-credentials" "${account_home}/.netrc" \
  "${account_home}/.npmrc" "${account_home}/.pypirc" \
  "${project_root}/.env.local" "${project_root}/.env.scheduler" \
  "${project_root}/.env.public-api-proxy" "${project_root}/local-llm-server/.env" \
  "${project_root}/dist/server/wrangler.runtime.json"
do
  mask_file "${file}"
done
for file in "${project_root}"/*.zip; do [[ ! -f "${file}" ]] || mask_file "${file}"; done

# Re-expose exactly the read-only DB and existing journal companions after
# masking all state. SQLite's online backup must see the live WAL, never an
# immutable=1 connection that would silently ignore recent committed writes.
args+=(--dir "${database%/*}")
for file in "${database}" "${database}-wal" "${database}-shm" "${database}-journal"; do
  if [[ -e "${file}" ]]; then
    [[ -f "${file}" && "$(readlink -f -- "${file}")" == "${file}" ]] || fail unsafe_database_companion
    args+=(--ro-bind "${file}" "${file}")
  fi
done

if [[ "${ops_mode}" == backup ]]; then
  args+=(--unshare-net --bind "${backup_dir}" "${backup_dir}"
    --ro-bind "${public_key}" "${public_key}"
    --setenv BORA_BACKUP_PUBLIC_KEY "${public_key}")
  entry="${project_root}/deploy/backup-bora-sqlite.py"
else
  args+=(--ro-bind "${backup_dir}" "${backup_dir}"
    --bind "${status_dir}" "${status_dir}"
    --setenv BORA_OPS_STATUS_DIR "${status_dir}"
    --setenv BORA_PUBLIC_URL "${public_url}")
  entry="${project_root}/deploy/check-bora-deep-readiness.py"
fi
[[ -f "${entry}" && ! -L "${entry}" ]] || fail ops_entry_missing
# -I ignores inherited PYTHONPATH/user-site customizations; -B avoids writing
# bytecode into the read-only checkout. Only /tmp and the selected output are RW.
exec "${bwrap_bin}" "${args[@]}" "${python_bin}" -I -B "${entry}"
