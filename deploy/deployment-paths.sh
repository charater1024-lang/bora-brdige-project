#!/usr/bin/env bash
# Shared path discovery. Sourcing this file does not run tools or change state.

bora_project_root() {
  local caller="$1" candidate resolved
  candidate="${BORA_PROJECT_ROOT:-$(cd -- "$(dirname -- "${caller}")/.." && pwd -P)}" || return 1
  [[ "${candidate}" =~ ^/[A-Za-z0-9._/-]+$ && "${candidate}" != / ]] || {
    printf 'BORA_PROJECT_ROOT must be an absolute ASCII path without whitespace or metacharacters.\n' >&2; return 1;
  }
  resolved="$(readlink -f -- "${candidate}")" || return 1
  [[ "${resolved}" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
  [[ -d "${resolved}/deploy" && -f "${resolved}/package.json" ]] || {
    printf 'BORA_PROJECT_ROOT is not a BORA checkout.\n' >&2; return 1;
  }
  printf '%s\n' "${resolved}"
}

bora_tool_path() {
  local variable="$1" command_name="$2" candidate resolved
  candidate="${!variable:-}"
  [[ -n "${candidate}" ]] || candidate="$(command -v -- "${command_name}")" || {
    printf 'Set %s to the absolute %s executable path.\n' "${variable}" "${command_name}" >&2; return 1;
  }
  [[ "${candidate}" == /* && -f "${candidate}" && -x "${candidate}" ]] || {
    printf '%s must identify an absolute executable file.\n' "${variable}" >&2; return 1;
  }
  resolved="$(readlink -f -- "${candidate}")" || return 1
  printf '%s\n' "${resolved}"
}

# Resolve the same private configuration root for writers and unit readers.
# -m permits first installation, but existing symlink parents are rejected.
bora_config_home() {
  local candidate="${XDG_CONFIG_HOME:-${HOME:?HOME required}/.config}" resolved
  [[ "${candidate}" =~ ^/[A-Za-z0-9._/-]+$ && "${candidate}" != / ]] || {
    printf 'The user configuration root must be a safe absolute ASCII path.\n' >&2; return 1;
  }
  resolved="$(readlink -m -- "${candidate}")" || return 1
  [[ "${resolved}" == "${candidate}" ]] || {
    printf 'The user configuration root must be canonical and non-symbolic.\n' >&2; return 1;
  }
  printf '%s\n' "${resolved}"
}

bora_d1_file() {
  local root="$1/.wrangler/state/v3/d1/miniflare-D1DatabaseObject" candidate resolved
  local -a candidates=()
  [[ -d "${root}" && "$(readlink -f -- "${root}")" == "${root}" ]] || {
    printf 'The project D1 directory is missing or noncanonical.\n' >&2; return 1;
  }
  if [[ -n "${BORA_D1_FILE:-}" ]]; then
    candidate="${BORA_D1_FILE}"
  else
    while IFS= read -r -d '' candidate; do candidates+=("${candidate}"); done \
      < <(find "${root}" -maxdepth 1 -type f -name '*.sqlite' ! -name 'metadata.sqlite' -print0)
    (( ${#candidates[@]} == 1 )) || {
      printf 'Expected exactly one D1 database; set BORA_D1_FILE explicitly.\n' >&2; return 1;
    }
    candidate="${candidates[0]}"
  fi
  resolved="$(readlink -f -- "${candidate}")" || return 1
  [[ -f "${candidate}" && ! -L "${candidate}" && "${resolved}" == "${candidate}" \
    && "${candidate%/*}" == "${root}" && "${candidate}" == *.sqlite \
    && "${candidate##*/}" != metadata.sqlite ]] || {
    printf 'BORA_D1_FILE must be a regular database directly in the project D1 directory.\n' >&2; return 1;
  }
  printf '%s\n' "${candidate}"
}

# Templates use portable systemd %h defaults. Rendering pins the chosen
# checkout and Node executable. Reject metacharacters rather than guessing
# systemd escaping or interpolating shell text into ExecStart.
bora_render_unit() {
  local source="$1" root="$2" line node_path='' runtime_root config_home
  [[ -f "${source}" && ! -L "${source}" ]] || return 1
  [[ "${root}" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    printf 'Unit deployment requires an ASCII path without whitespace or systemd metacharacters.\n' >&2; return 1;
  }
  if /usr/bin/grep -q '/usr/bin/env node\|Environment=PATH=' "${source}"; then
    node_path="$(bora_tool_path BORA_NODE_BIN node)" || return 1
    [[ "${node_path}" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
  fi
  runtime_root="${BORA_LOCAL_LLM_RUNTIME_ROOT:-%h/.local/share/bora-bridge}"
  [[ "${runtime_root}" == '%h/.local/share/bora-bridge' \
    || "${runtime_root}" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
  config_home="$(bora_config_home)" || return 1
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line//%h\/Project\/BORA-Bridge-Finance-AI/${root}}"
    line="${line//%h\/.local\/share\/bora-bridge/${runtime_root}}"
    line="${line//%h\/.config\/bora-bridge/${config_home}\/bora-bridge}"
    if [[ -n "${node_path}" ]]; then
      line="${line//\/usr\/bin\/env node/${node_path}}"
      if [[ "${line}" == 'Environment=PATH='* ]]; then
        line="Environment=PATH=${node_path%/*}:/usr/local/bin:/usr/bin:/bin"
      fi
    fi
    printf '%s\n' "${line}"
    if [[ "${line}" == '[Service]' && -n "${node_path}" ]]; then
      printf 'Environment=BORA_NODE_BIN=%s\n' "${node_path}"
    fi
  done <"${source}"
}

bora_install_unit() {
  local source="$1" destination="$2" root="$3" temporary
  [[ -d "${destination%/*}" && ! -L "${destination}" ]] || return 1
  temporary="$(mktemp "${destination}.XXXXXX")" || return 1
  if ! bora_render_unit "${source}" "${root}" >"${temporary}"; then
    rm -f -- "${temporary}"; return 1
  fi
  if ! chmod 0600 "${temporary}" || ! mv -fT -- "${temporary}" "${destination}"; then
    rm -f -- "${temporary}"
    return 1
  fi
}
