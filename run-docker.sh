#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_HOST_PORT="${DB_HOST_PORT:-9110}"
FRONTEND_URL="http://localhost:4173"
BACKEND_HEALTH_URL="http://localhost:8000/api/health"

cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

compose() {
  DB_HOST_PORT="$DB_HOST_PORT" docker compose "$@"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"
  local delay="${4:-2}"

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$label is ready."
      return 0
    fi
    sleep "$delay"
  done

  echo "$label did not become ready in time." >&2
  compose ps >&2 || true
  echo "Run './run-docker.sh logs' for service logs." >&2
  exit 1
}

wait_for_database() {
  local attempts="${1:-60}"
  local delay="${2:-2}"

  for ((i = 1; i <= attempts; i++)); do
    if compose exec -T db pg_isready -U postgres -d bitime >/dev/null 2>&1; then
      echo "Database is ready."
      return 0
    fi
    sleep "$delay"
  done

  echo "Database did not become ready in time." >&2
  compose ps >&2 || true
  exit 1
}

print_status() {
  echo
  compose ps
  echo
  echo "Frontend: $FRONTEND_URL"
  echo "Backend:  $BACKEND_HEALTH_URL"
  echo "Database: localhost:$DB_HOST_PORT"
}

require_command docker
require_command curl

case "${1:-up}" in
  up | start)
    echo "Starting Docker containers..."
    compose up --build -d
    wait_for_database
    wait_for_http "$BACKEND_HEALTH_URL" "Backend"
    wait_for_http "$FRONTEND_URL" "Frontend"
    print_status
    ;;
  down | stop)
    echo "Stopping Docker containers..."
    compose down
    ;;
  restart)
    echo "Restarting Docker containers..."
    compose down
    compose up --build -d
    wait_for_database
    wait_for_http "$BACKEND_HEALTH_URL" "Backend"
    wait_for_http "$FRONTEND_URL" "Frontend"
    print_status
    ;;
  logs)
    compose logs -f "${@:2}"
    ;;
  ps | status)
    print_status
    ;;
  *)
    echo "Usage: $0 [up|start|down|stop|restart|logs|ps|status]" >&2
    exit 1
    ;;
esac
