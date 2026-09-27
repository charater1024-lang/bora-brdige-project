#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deployment-paths.sh"
PROJECT_ROOT="$(bora_project_root "${BASH_SOURCE[0]}")"
RUNTIME_ROOT="${BORA_LOCAL_LLM_RUNTIME_ROOT:-${HOME:?HOME required}/.local/share/bora-bridge}"
VENV_ROOT="${RUNTIME_ROOT}/local-llm-venv"
USER_CONFIG_HOME="$(bora_config_home)"
USER_UNIT_ROOT="${USER_CONFIG_HOME}/systemd/user"
STAGED_VENV="${RUNTIME_ROOT}/.local-llm-venv-stage-$$"

log() {
  printf '[bora-local-llm] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

[[ "$(id -u)" -ne 0 ]] || fail "Run this installer as the service user, not root."
[[ -f "${PROJECT_ROOT}/local-llm-server/app.py" ]] || fail "Local LLM gateway source is missing."
[[ -f "${PROJECT_ROOT}/local-llm-server/.env" ]] || fail "Local LLM gateway environment file is missing."
[[ -x /usr/local/bin/ollama ]] || fail "Ollama is not installed at /usr/local/bin/ollama."
RUNTIME_ROOT="$(realpath -m -- "${RUNTIME_ROOT}")"
case "${RUNTIME_ROOT}" in
  "${HOME}/.local/share/bora-bridge"|"${HOME}/.local/share/bora-bridge/"*) ;;
  *) fail "The Local LLM runtime must stay below the dedicated user data directory." ;;
esac
VENV_ROOT="${RUNTIME_ROOT}/local-llm-venv"
STAGED_VENV="${RUNTIME_ROOT}/.local-llm-venv-stage-$$"

mkdir -p "${RUNTIME_ROOT}" "${USER_UNIT_ROOT}"
chmod 0700 "${RUNTIME_ROOT}" "${USER_UNIT_ROOT}"

if [[ ! -x "${VENV_ROOT}/bin/python" ]]; then
  PYTHON_RUNTIME="$(bora_tool_path BORA_LOCAL_LLM_PYTHON python3)"
  [[ -n "${PYTHON_RUNTIME}" && -x "${PYTHON_RUNTIME}" ]] || fail "A Python 3 runtime is required."
  [[ ! -e "${STAGED_VENV}" ]] || fail "Unexpected pre-existing staging directory."
  "${PYTHON_RUNTIME}" -m venv --system-site-packages "${STAGED_VENV}"
  "${STAGED_VENV}/bin/python" -c 'import fastapi, httpx, pydantic, uvicorn'
  chmod -R go-rwx "${STAGED_VENV}"
  if [[ -e "${VENV_ROOT}" ]]; then
    mv "${VENV_ROOT}" "${RUNTIME_ROOT}/local-llm-venv-incomplete-$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  mv "${STAGED_VENV}" "${VENV_ROOT}"
fi

"${VENV_ROOT}/bin/python" -c 'import fastapi, httpx, pydantic, uvicorn'
export BORA_LOCAL_LLM_RUNTIME_ROOT="${RUNTIME_ROOT}"
BORA_PROJECT_ROOT="${PROJECT_ROOT}" /usr/bin/bash "${PROJECT_ROOT}/deploy/install-user-units.sh" \
  bora-ollama.service bora-local-llm.service

[[ "$(loginctl show-user "$(id -un)" --property=Linger --value)" == yes ]] \
  || fail "User lingering is disabled; an administrator must enable it before reboot-independent user services can be claimed."
systemctl --user daemon-reload
systemctl --user enable bora-ollama.service bora-local-llm.service
systemctl --user is-enabled --quiet bora-ollama.service
systemctl --user is-enabled --quiet bora-local-llm.service
systemctl --user restart bora-ollama.service
systemctl --user restart bora-local-llm.service

for _ in $(seq 1 90); do
  if curl --fail --silent --show-error --max-time 3 --max-filesize 65536 \
    http://127.0.0.1:11435/health \
    | "${VENV_ROOT}/bin/python" -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if value.get("status") == "ok" and value.get("model_state") == "ready" and isinstance(value.get("selected_model"), str) and value["selected_model"] else 1)'
  then
    log "Ollama and the Local LLM gateway are ready and enabled for boot."
    exit 0
  fi
  sleep 1
done

fail "The Local LLM gateway did not become healthy."
