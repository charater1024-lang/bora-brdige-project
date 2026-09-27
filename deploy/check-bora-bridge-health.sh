#!/usr/bin/env bash
set -euo pipefail

readonly health_url="http://127.0.0.1:3000/api/health"
readonly expected_body='{"status":"ok"}'
readonly attempts=3

for attempt in $(seq 1 "${attempts}"); do
  body="$(/usr/bin/curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    --header 'Host: borabridge.com' \
    --header 'X-Forwarded-Host: borabridge.com' \
    --header 'X-Forwarded-Proto: https' \
    --header 'Origin: https://borabridge.com' \
    "${health_url}" 2>/dev/null || true)"

  if [[ "${body}" == "${expected_body}" ]]; then
    exit 0
  fi

  if [[ "${attempt}" -lt "${attempts}" ]]; then
    /usr/bin/sleep 3
  fi
done

printf '{"event":"bora_healthcheck_failed","attempts":%s,"path":"/api/health"}\n' \
  "${attempts}" >&2
exit 1
