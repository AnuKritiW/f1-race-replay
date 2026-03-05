#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
RACE_ID="singapore-2023-p1"
SESSION_KEY="9158"

echo "Waiting for backend at $BACKEND_URL/health ..."
until curl -sf "$BACKEND_URL/health" > /dev/null; do
  sleep 2
done
echo "Backend is up."

echo "Ingesting $RACE_ID (session $SESSION_KEY) ..."
curl -sf -X POST "$BACKEND_URL/admin/races/$RACE_ID/ingest?session_key=$SESSION_KEY" | python3 -m json.tool
echo "Done."
