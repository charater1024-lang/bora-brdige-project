#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" \
  || { printf 'Unable to resolve the deployment directory.\n' >&2; exit 2; }
source "${script_dir}/deployment-paths.sh"
project_root="$(bora_project_root "${BASH_SOURCE[0]}")" \
  || { printf 'Unable to resolve the project root.\n' >&2; exit 2; }
readonly script_dir project_root

[[ "${project_root}" == "$(cd -- "${script_dir}/.." && pwd -P)" ]] \
  || { printf 'Run this installer from the configured production checkout.\n' >&2; exit 2; }

readonly source_files=(
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

stage_dir="$(/usr/bin/mktemp -d \
  --tmpdir=/tmp \
  bora-runtime-stability-installer.XXXXXX)" \
  || { printf 'Unable to create the private deployment stage.\n' >&2; exit 2; }
readonly stage_dir
[[ -d "${stage_dir}" \
  && ! -L "${stage_dir}" \
  && "$(/usr/bin/readlink -f -- "${stage_dir}")" == /tmp/bora-runtime-stability-installer.* ]] \
  || { printf 'The private deployment stage is unsafe.\n' >&2; exit 2; }

cleanup() {
  if [[ -d "${stage_dir}" \
    && ! -L "${stage_dir}" \
    && "$(/usr/bin/readlink -f -- "${stage_dir}")" == /tmp/bora-runtime-stability-installer.* ]]; then
    /usr/bin/rm -rf -- "${stage_dir}"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for relative in "${source_files[@]}"; do
  source_path="${project_root}/${relative}"
  destination_path="${stage_dir}/${relative}"
  [[ -f "${source_path}" && ! -L "${source_path}" ]] \
    || { printf 'Missing or unsafe runtime artifact: %s\n' "${relative}" >&2; exit 2; }
  /usr/bin/install -d -m 0700 -- "$(/usr/bin/dirname -- "${destination_path}")"
  /usr/bin/install -m 0600 -- "${source_path}" "${destination_path}"
done

# All installation, database backup, health verification, dry-run activation,
# and byte-identical rollback behavior belongs to one transactional helper.
BORA_PROJECT_ROOT="${project_root}" /usr/bin/bash "${stage_dir}/deploy/apply-runtime-stability.sh" "${stage_dir}"

trap - EXIT HUP INT TERM
cleanup
