#!/usr/bin/env bash
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "${script_dir}/deployment-paths.sh"
project_root="$(bora_project_root "${BASH_SOURCE[0]}")"
config_home="$(bora_config_home)"
unit_root="${config_home}/systemd/user"
mode=install
if [[ "${1:-}" == --print ]]; then mode=print; shift; fi
(( $# > 0 )) || { printf 'Usage: %s [--print] UNIT [UNIT ...]\n' "$0" >&2; exit 2; }

# Explicit selection prevents a refresh from enabling unrelated services.
# --print is completely read-only. Validate all renders before any replacement.
declare -A selected=()
for unit in "$@"; do
  [[ "${unit}" =~ ^bora-[a-z0-9-]+\.(service|timer)$ \
    && -f "${script_dir}/${unit}" && ! -L "${script_dir}/${unit}" ]] || {
    printf 'Unknown unit: %s\n' "${unit}" >&2; exit 2;
  }
  [[ -z "${selected[${unit}]:-}" ]] || { printf 'Duplicate unit: %s\n' "${unit}" >&2; exit 2; }
  selected["${unit}"]=1
  bora_render_unit "${script_dir}/${unit}" "${project_root}" >/dev/null
done
if [[ "${mode}" == print ]]; then
  for unit in "$@"; do
    bora_render_unit "${script_dir}/${unit}" "${project_root}"
  done
  exit 0
fi

[[ "$(readlink -m -- "${unit_root}")" == "${unit_root}" ]] || {
  printf 'Refusing a noncanonical or symbolic unit directory.\n' >&2; exit 2;
}
# Check the entire destination set before touching the first unit.
for unit in "$@"; do
  [[ ! -L "${unit_root}/${unit}" ]] || { printf 'Refusing a symbolic unit: %s\n' "${unit}" >&2; exit 2; }
  [[ ! -e "${unit_root}/${unit}" || -f "${unit_root}/${unit}" ]] || {
    printf 'Unit destination is not a regular file: %s\n' "${unit}" >&2; exit 2;
  }
done
install -d -m 0700 "${unit_root}"
stage="$(mktemp -d "${unit_root}/.bora-unit-stage.XXXXXX")"
declare -a replaced=()
declare -A existed=()
success=0
finish_install() {
  local status=$? unit recovery_failed=0
  trap - EXIT
  trap '' HUP INT TERM
  set +e
  if (( success == 0 )); then
    (( status != 0 )) || status=1
    for unit in "${replaced[@]}"; do
      if [[ "${existed[${unit}]}" == 1 ]]; then
        mv -fT -- "${stage}/${unit}.before" "${unit_root}/${unit}" || recovery_failed=1
      else
        rm -f -- "${unit_root}/${unit}" || recovery_failed=1
      fi
    done
  fi
  if (( recovery_failed != 0 )); then
    printf 'Unit-file rollback incomplete; backups retained at %s. No daemon reload was performed.\n' "${stage}" >&2
    exit 70
  fi
  for unit in "${!selected[@]}"; do
    rm -f -- "${stage}/${unit}.before" "${stage}/${unit}.next"
  done
  rmdir -- "${stage}" || { printf 'Unable to remove staging directory: %s\n' "${stage}" >&2; status=70; }
  exit "${status}"
}
trap finish_install EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# Stage every render and backup before replacing anything. Atomic rename
# protects each file; the EXIT handler restores earlier files if a later
# replacement fails. Service manager state is never touched by this helper.
for unit in "$@"; do
  bora_render_unit "${script_dir}/${unit}" "${project_root}" >"${stage}/${unit}.next"
  chmod 0600 "${stage}/${unit}.next"
  existed["${unit}"]=0
  if [[ -f "${unit_root}/${unit}" ]]; then
    cp -p -- "${unit_root}/${unit}" "${stage}/${unit}.before"
    existed["${unit}"]=1
  fi
done
for unit in "$@"; do
  replaced+=("${unit}")
  mv -fT -- "${stage}/${unit}.next" "${unit_root}/${unit}"
done
success=1
printf 'Selected units installed. No service was enabled, reloaded, or restarted.\n'
