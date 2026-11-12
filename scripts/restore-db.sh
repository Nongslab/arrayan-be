#!/usr/bin/env sh
# Pulihkan database production dari file backup (.sql.gz) — MENIMPA isi database.
#
#   ./scripts/restore-db.sh backups/arrayan_20261112_020000.sql.gz
#
# Variabel opsional sama dengan backup-db.sh (ENV_FILE, COMPOSE_FILE, COMPOSE_PROJECT).
# Langkah aman: API dihentikan dulu, schema public dikosongkan, dump dipulihkan,
# lalu API dijalankan lagi (migrasi berjalan otomatis bila dump lebih lama dari kode).
set -eu

BACKUP_FILE="${1:?Pakai: ./scripts/restore-db.sh <file.sql.gz>}"
[ -f "$BACKUP_FILE" ] || { echo "File tidak ditemukan: $BACKUP_FILE" >&2; exit 1; }

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
set -- --env-file "$ENV_FILE" -f "$COMPOSE_FILE"
if [ -n "${COMPOSE_PROJECT:-}" ]; then
  set -- -p "$COMPOSE_PROJECT" "$@"
fi

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  printf 'Restore akan MENIMPA seluruh data database. Ketik "yes" untuk lanjut: '
  read -r answer
  [ "$answer" = "yes" ] || { echo "Dibatalkan."; exit 1; }
fi

echo "[restore] Menghentikan API..."
docker compose "$@" stop api

echo "[restore] Mengosongkan schema public..."
docker compose "$@" exec -T db sh -c \
  'PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

echo "[restore] Memulihkan $BACKUP_FILE ..."
gunzip -c "$BACKUP_FILE" | docker compose "$@" exec -T db sh -c \
  'PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null'

echo "[restore] Menjalankan API..."
docker compose "$@" start api
echo "[restore] Selesai."
