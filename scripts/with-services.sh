#!/usr/bin/env bash
# PostgreSQL va Redis ishlab turgan bo'lsa — buyruqni shunchaki bajaradi.
# Aks holda (Docker yo'q muhitlar uchun) DEVTOOLS_DIR dagi lokal binarilarni vaqtincha ishga tushiradi.
#
# Ishlatish: bash scripts/with-services.sh <buyruq...>
# Odatiy holatda: docker compose up -d   (keyin bu skript hech narsa ishga tushirmaydi)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVTOOLS_DIR="${DEVTOOLS_DIR:-$ROOT/../.devtools}"
PG_PORT="${PG_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres@127.0.0.1:${PG_PORT}/mafia_test}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:${REDIS_PORT}}"
export NODE_ENV="${NODE_ENV:-test}"

port_open() { (echo >"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

if ! port_open "$PG_PORT"; then
  if [ -x "$DEVTOOLS_DIR/pg/bin/postgres" ]; then
    rm -f "$DEVTOOLS_DIR/pgdata/postmaster.pid"
    RUNAS=()
    if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u nobody --); fi
    "${RUNAS[@]}" "$DEVTOOLS_DIR/pg/bin/postgres" -D "$DEVTOOLS_DIR/pgdata" -p "$PG_PORT" \
      -k "$DEVTOOLS_DIR/pgdata" -c listen_addresses=127.0.0.1 >"$DEVTOOLS_DIR/pg.log" 2>&1 &
    PIDS+=($!)
  else
    echo "PostgreSQL topilmadi: 'docker compose up -d' ni ishga tushiring" >&2
    exit 1
  fi
fi

if ! port_open "$REDIS_PORT"; then
  if [ -x "$DEVTOOLS_DIR/redis-stable/src/redis-server" ]; then
    "$DEVTOOLS_DIR/redis-stable/src/redis-server" --port "$REDIS_PORT" --save "" --appendonly no \
      --bind 127.0.0.1 >"$DEVTOOLS_DIR/redis.log" 2>&1 &
    PIDS+=($!)
  else
    echo "Redis topilmadi: 'docker compose up -d' ni ishga tushiring" >&2
    exit 1
  fi
fi

for _ in $(seq 1 50); do
  if port_open "$PG_PORT" && port_open "$REDIS_PORT"; then break; fi
  sleep 0.2
done

# Test bazasini yaratish va migratsiyalarni qo'llash
node -e "
const { Client } = require('pg');
const url = new URL(process.env.DATABASE_URL);
const db = url.pathname.slice(1);
url.pathname = '/postgres';
(async () => {
  for (let i = 0; ; i++) {
    const c = new Client({ connectionString: url.toString() });
    try {
      await c.connect();
      const r = await c.query('SELECT 1 FROM pg_database WHERE datname = \$1', [db]);
      if (r.rowCount === 0) await c.query('CREATE DATABASE \"' + db + '\"');
      await c.end();
      return;
    } catch (e) {
      await c.end().catch(() => {});
      if (i > 40) { console.error(e.message); process.exit(1); }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
})();
"
(cd "$ROOT/packages/database" && npx prisma migrate deploy >/dev/null)

"$@"
