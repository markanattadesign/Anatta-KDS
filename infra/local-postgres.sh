#!/usr/bin/env bash
# Local Postgres without Docker. Usage: bash infra/local-postgres.sh up|down|status
# Needs Postgres server binaries (e.g. `apt-get install postgresql`, or `brew install postgresql`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.pgdata"
PORT="${PGPORT:-5432}"
LOG="$DATA/server.log"

BIN="$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | sort -V | tail -1 || true)")"
if [[ ! -x "$BIN/pg_ctl" ]]; then
  echo "Postgres binaries not found. Install postgresql or use infra/docker-compose.yml." >&2
  exit 1
fi

# initdb/postgres refuse to run as root; drop to the postgres user when needed.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    id postgres >/dev/null 2>&1 || useradd -r -m postgres
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

running() { as_pg "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

case "${1:-up}" in
  up)
    if [[ ! -f "$DATA/PG_VERSION" ]]; then
      mkdir -p "$DATA"
      [[ "$(id -u)" == "0" ]] && chown postgres "$DATA"
      as_pg "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
      echo "initialized cluster in $DATA"
    fi
    if running; then
      echo "postgres already running on :$PORT"
    else
      as_pg "$BIN/pg_ctl" -D "$DATA" -l "$LOG" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -w start >/dev/null
      echo "postgres started on :$PORT"
    fi
    PSQL=("$BIN/psql" -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -qtA)
    if [[ "$("${PSQL[@]}" -c "select 1 from pg_roles where rolname='kds'")" != "1" ]]; then
      "${PSQL[@]}" -c "create role kds login password 'kds' createdb"
    fi
    for db in kds kds_test; do
      if [[ "$("${PSQL[@]}" -c "select 1 from pg_database where datname='$db'")" != "1" ]]; then
        "${PSQL[@]}" -c "create database $db owner kds"
        echo "created database $db"
      fi
    done
    ;;
  down)
    running && as_pg "$BIN/pg_ctl" -D "$DATA" -m fast stop || echo "postgres not running"
    ;;
  status)
    running && echo "running" || echo "stopped"
    ;;
  *) echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
