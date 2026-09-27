#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Render the selected checkout and Node path before activating health checks.
source "${script_dir}/deployment-paths.sh"
project_root="$(bora_project_root "${BASH_SOURCE[0]}")"

BORA_PROJECT_ROOT="${project_root}" /usr/bin/bash "${script_dir}/install-user-units.sh" \
  bora-bridge-healthcheck.service bora-bridge-recover.service bora-bridge-healthcheck.timer

/usr/bin/systemctl --user daemon-reload
/usr/bin/systemctl --user enable --now bora-bridge-healthcheck.timer
/usr/bin/systemctl --user start bora-bridge-healthcheck.service
/usr/bin/systemctl --user is-active --quiet bora-bridge-healthcheck.timer
