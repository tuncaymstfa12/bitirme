#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run-logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PORT="${BACKEND_PORT:-8100}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
APP_URL="http://localhost:${FRONTEND_PORT}/#admin-import"
DB_NAME="bitime"
DB_HOST_PORT="${DB_HOST_PORT:-9110}"
DB_USER="postgres"
DB_PASSWORD="Tuncay1903"

mkdir -p "$LOG_DIR"

backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    kill "${frontend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill "${backend_pid}" 2>/dev/null || true
  fi
}

on_exit() {
  cleanup
}

trap on_exit EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"
  local delay="${4:-1}"

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$label is ready."
      return 0
    fi
    sleep "$delay"
  done

  echo "$label did not become ready in time." >&2
  echo "Backend log: $BACKEND_LOG" >&2
  echo "Frontend log: $FRONTEND_LOG" >&2
  exit 1
}

wait_for_db() {
  local attempts="${1:-60}"
  local delay="${2:-1}"

  for ((i = 1; i <= attempts; i++)); do
    if DB_HOST_PORT="$DB_HOST_PORT" docker compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      echo "Database is ready."
      return 0
    fi
    sleep "$delay"
  done

  echo "Database did not become ready in time." >&2
  exit 1
}

ensure_port_free() {
  local port="$1"
  local label="$2"
  if ss -ltn "( sport = :$port )" | grep -q ":$port"; then
    echo "$label port $port is already in use. Stop the existing process first." >&2
    exit 1
  fi
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
    return
  fi

  if command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 || true
  fi
}

require_command docker
require_command curl
require_command node
require_command npm
require_command ss

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "node_modules is missing. Run npm install first." >&2
  exit 1
fi

if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "Python virtualenv is missing at .venv. Recreate it before running the MVP." >&2
  exit 1
fi

ensure_port_free "$BACKEND_PORT" "Backend"
ensure_port_free "$FRONTEND_PORT" "Frontend"

cd "$ROOT_DIR"

echo "Starting PostgreSQL container..."
DB_HOST_PORT="$DB_HOST_PORT" docker compose up -d db >/dev/null
wait_for_db

echo "Starting backend..."
AUTH_API_PORT="$BACKEND_PORT" \
DATABASE_HOST=127.0.0.1 \
DATABASE_PORT="$DB_HOST_PORT" \
DATABASE_NAME="$DB_NAME" \
DATABASE_USER="$DB_USER" \
DATABASE_PASSWORD="$DB_PASSWORD" \
node server/server.js >"$BACKEND_LOG" 2>&1 &
backend_pid="$!"

echo "Starting frontend..."
BACKEND_PORT="$BACKEND_PORT" FRONTEND_PORT="$FRONTEND_PORT" npm run dev >"$FRONTEND_LOG" 2>&1 &
frontend_pid="$!"

wait_for_http "http://localhost:${BACKEND_PORT}/api/health" "Backend"
wait_for_http "http://localhost:${FRONTEND_PORT}" "Frontend"

echo "Opening $APP_URL"
open_browser

echo
echo "MVP is running."
echo "Frontend: http://localhost:${FRONTEND_PORT}/#admin-import"
echo "Backend:  http://localhost:${BACKEND_PORT}/api/health"
echo "Database: localhost:${DB_HOST_PORT}"
echo "Logs:"
echo "  $FRONTEND_LOG"
echo "  $BACKEND_LOG"
echo
echo "Press Ctrl+C to stop the frontend and backend. The database container stays running."

wait
