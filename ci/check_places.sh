#!/usr/bin/env bash
set -euo pipefail

URL="https://ors-proxy.miyata-connect-jp.workers.dev/v1/health"

code="$(curl -sS -o /dev/null -w '%{http_code}' "$URL")" || {
  echo "NG: request failed"
  exit 1
}

if [ "$code" = "200" ]; then
  echo "OK"
  exit 0
else
  echo "NG: status=$code"
  exit 1
fi
