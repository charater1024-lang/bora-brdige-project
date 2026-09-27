#!/usr/bin/env bash
set -euo pipefail

umask 077

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")" || exit 2
readonly PROJECT_ROOT
# An environment override must never move this sandbox's writable whitelist
# to a different checkout. Staged deployment helpers may configure a root,
# but the serving wrapper always belongs to that exact installed checkout.
[[ "${PROJECT_ROOT}" == "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)" ]] \
  || { printf 'Sandbox project root must match its own checkout.\n' >&2; exit 2; }
readonly DEPLOY_HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
[[ "${DEPLOY_HOME}" == /* && "${DEPLOY_HOME}" != / \
  && "$(readlink -f -- "${DEPLOY_HOME}")" == "${DEPLOY_HOME}" ]] \
  || { printf 'Unable to resolve the service account home.\n' >&2; exit 2; }
NODE_BIN="$(bora_tool_path BORA_NODE_BIN node)" || exit 2
readonly NODE_BIN
readonly RUNNER_JS="${PROJECT_ROOT}/scripts/start-local-worker.mjs"
readonly USER_RUNTIME_ROOT="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
readonly RUNTIME_DIR="${USER_RUNTIME_ROOT}/bora-bridge"
readonly DEFAULT_RUNTIME_CONFIG="${RUNTIME_DIR}/wrangler.runtime.json"
readonly CANARY_RUNTIME_CONFIG="${RUNTIME_DIR}/canary-wrangler.runtime.json"
readonly RUNTIME_CONFIG="${BORA_RUNTIME_CONFIG:-${DEFAULT_RUNTIME_CONFIG}}"
readonly LISTEN_PORT="${BORA_LISTEN_PORT:-3000}"
readonly STATE_DIR="${BORA_STATE_DIR:-${PROJECT_ROOT}/.wrangler}"
readonly MF_CACHE_DIR="${RUNTIME_DIR}/miniflare-cache"
readonly BWRAP_BIN="/usr/bin/bwrap"

if [[ ! "${LISTEN_PORT}" =~ ^[0-9]{4,5}$ ]] \
  || (( 10#${LISTEN_PORT} < 1024 || 10#${LISTEN_PORT} > 65535 )); then
  printf 'BORA_LISTEN_PORT must be an integer from 1024 through 65535.\n' >&2
  exit 1
fi

# Production uses the project-local state. A canary may use exactly one
# ephemeral state directory managed under this service's runtime directory.
if [[ "${STATE_DIR}" != "${PROJECT_ROOT}/.wrangler" \
  && "${STATE_DIR}" != "${USER_RUNTIME_ROOT}/bora-bridge/probe-state" ]]; then
  printf 'BORA_STATE_DIR is outside the approved persistent or probe path.\n' >&2
  exit 1
fi

for required_path in \
  "${BWRAP_BIN}" \
  "${NODE_BIN}" \
  "${RUNNER_JS}" \
  "${RUNTIME_CONFIG}"
do
  if [[ ! -r "${required_path}" ]]; then
    printf 'Required runtime path is not readable: %s\n' "${required_path}" >&2
    exit 1
  fi
done

if [[ -L "${RUNTIME_DIR}" \
  || -L "${STATE_DIR}" \
  || -L "${STATE_DIR}/state" \
  || -L "${MF_CACHE_DIR}" ]]; then
  printf 'Refusing a symbolic link in a runtime or persistent state path.\n' >&2
  exit 1
fi
install -d -m 0700 \
  "${RUNTIME_DIR}" \
  "${STATE_DIR}" \
  "${STATE_DIR}/state" \
  "${MF_CACHE_DIR}"
chmod 0700 \
  "${RUNTIME_DIR}" \
  "${STATE_DIR}" \
  "${STATE_DIR}/state" \
  "${MF_CACHE_DIR}"
if [[ "$(readlink -f "${RUNTIME_DIR}")" != "${RUNTIME_DIR}" ]]; then
  printf 'Runtime path escaped the user runtime directory.\n' >&2
  exit 1
fi
if [[ "$(readlink -f "${STATE_DIR}")" != "${STATE_DIR}" \
  || "$(readlink -f "${STATE_DIR}/state")" != "${STATE_DIR}/state" ]]; then
  printf 'Persistent state path escaped the project directory.\n' >&2
  exit 1
fi

if [[ "${RUNTIME_CONFIG}" != "${DEFAULT_RUNTIME_CONFIG}" \
  && "${RUNTIME_CONFIG}" != "${CANARY_RUNTIME_CONFIG}" ]]; then
  printf 'BORA_RUNTIME_CONFIG is outside the approved runtime paths.\n' >&2
  exit 1
fi
if [[ "$(readlink -f "${MF_CACHE_DIR}")" != "${MF_CACHE_DIR}" ]]; then
  printf 'Miniflare cache path escaped its approved directory.\n' >&2
  exit 1
fi

sandbox_args=(
  --die-with-parent
  --new-session
  --unshare-user-try
  --unshare-ipc
  --unshare-pid
  --unshare-uts
  --unshare-cgroup-try
  --cap-drop ALL
  --ro-bind / /
  --dev /dev
  --proc /proc
  --tmpfs /tmp
  --bind "${RUNTIME_DIR}" "${RUNTIME_DIR}"
  --bind "${STATE_DIR}" "${STATE_DIR}"
  --chdir "${PROJECT_ROOT}"
  --hostname bora-bridge
  --clearenv
  --setenv HOME "${DEPLOY_HOME}"
  --setenv PATH "${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin"
  --setenv LANG C.UTF-8
  --setenv NODE_ENV production
  --setenv TMPDIR /tmp
  --setenv CI true
  # Keep Miniflare's Request.cf metadata cache inside the already isolated,
  # writable runtime directory. The project and dependency tree stay read-only.
  --setenv MINIFLARE_CACHE_DIR "${MF_CACHE_DIR}"
  --setenv WRANGLER_SEND_METRICS false
  --setenv NO_UPDATE_NOTIFIER 1
)

mask_directory() {
  local path="$1"
  if [[ -d "${path}" ]]; then
    if [[ "${NODE_BIN}" == "${path}/"* || "${RUNNER_JS}" == "${path}/"* ]]; then
      printf 'Runtime executable or checkout is inside a masked private directory: %s\n' "${path}" >&2
      printf 'Choose an installation outside credential/cache directories; do not weaken masking.\n' >&2
      exit 2
    fi
    sandbox_args+=(--tmpfs "${path}")
  fi
}

mask_file() {
  local path="$1"
  if [[ -e "${path}" ]]; then
    sandbox_args+=(--ro-bind /dev/null "${path}")
  fi
}

# The web runtime must never inherit credentials used to administer the host.
for sensitive_directory in \
  "${DEPLOY_HOME}/.ssh" \
  "${DEPLOY_HOME}/.gnupg" \
  "${DEPLOY_HOME}/.cloudflared" \
  "${DEPLOY_HOME}/.aws" \
  "${DEPLOY_HOME}/.azure" \
  "${DEPLOY_HOME}/.kube" \
  "${DEPLOY_HOME}/.docker" \
  "${DEPLOY_HOME}/.config" \
  "${DEPLOY_HOME}/.cache" \
  "${DEPLOY_HOME}/.vscode-server" \
  "${DEPLOY_HOME}/.cursor-server" \
  "${DEPLOY_HOME}/.codex" \
  "${DEPLOY_HOME}/.claude" \
  "${DEPLOY_HOME}/.local/share/keyrings" \
  "${DEPLOY_HOME}/.local/share/bora-bridge/backups" \
  "${DEPLOY_HOME}/.local/share/bora-bridge/encrypted-backups" \
  "${DEPLOY_HOME}/.local/share/bora-bridge/ops" \
  "${DEPLOY_HOME}/.local/share/bora-bridge/ops-tools" \
  "${PROJECT_ROOT}/.git" \
  "${PROJECT_ROOT}/.deploy-backups"
do
  mask_directory "${sensitive_directory}"
done

for sensitive_file in \
  "${DEPLOY_HOME}/.gitconfig" \
  "${DEPLOY_HOME}/.git-credentials" \
  "${DEPLOY_HOME}/.netrc" \
  "${DEPLOY_HOME}/.npmrc" \
  "${DEPLOY_HOME}/.pypirc" \
  "${PROJECT_ROOT}/.env.local" \
  "${PROJECT_ROOT}/.env.scheduler" \
  "${PROJECT_ROOT}/.env.public-api-proxy" \
  "${PROJECT_ROOT}/local-llm-server/.env" \
  "${PROJECT_ROOT}/dist/server/wrangler.runtime.json"
do
  mask_file "${sensitive_file}"
done

# Old source bundles can contain historic environment files, so they are not
# exposed to the request-serving process.
for source_bundle in "${PROJECT_ROOT}"/*.zip; do
  if [[ -f "${source_bundle}" ]]; then
    mask_file "${source_bundle}"
  fi
done

exec "${BWRAP_BIN}" "${sandbox_args[@]}" \
  "${NODE_BIN}" "${RUNNER_JS}" \
  --config "${RUNTIME_CONFIG}" \
  --persist-to "${STATE_DIR}/state" \
  --host 127.0.0.1 \
  --port "${LISTEN_PORT}"
