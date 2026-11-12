#!/usr/bin/env sh
# Backup database production (pg_dump terkompresi) + hapus backup lama.
#
#   ./scripts/backup-db.sh
#
# Variabel opsional:
#   ENV_FILE          file env compose          (default .env.production)
#   COMPOSE_FILE      file compose              (default docker-compose.prod.yml)
#   COMPOSE_PROJECT   nama project compose      (default: dari file compose)
#   BACKUP_DIR        folder tujuan             (default ./backups)
#   BACKUP_KEEP_DAYS  simpan berapa hari        (default 14)
#
# Jadwal harian (cron di VPS, jam 02:00):
#   0 2 * * * cd /opt/arrayan-be && ./scripts/backup-db.sh >> backups/backup.log 2>&1
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

set -- --env-file "$ENV_FILE" -f "$COMPOSE_FILE"
if [ -n "${COMPOSE_PROJECT:-}" ]; then
  set -- -p "$COMPOSE_PROJECT" "$@"
fi

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/arrayan_$(date +%Y%m%d_%H%M%S).sql.gz"
TMP="$FILE.partial"

# Dump format SQL biasa agar bisa dipulihkan dengan psql; tulis ke file sementara
# lalu rename, sehingga backup gagal tidak meninggalkan file .sql.gz yang rusak.
docker compose "$@" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  | gzip > "$TMP"
mv "$TMP" "$FILE"

find "$BACKUP_DIR" -name 'arrayan_*.sql.gz' -type f -mtime +"$BACKUP_KEEP_DAYS" -exec rm -f {} \;

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') OK → $FILE ($(du -h "$FILE" | cut -f1))"
