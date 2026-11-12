#!/bin/sh
# Jalankan migrasi database sebelum aplikasi start (idempoten — aman diulang).
# Lewati dengan SKIP_MIGRATIONS=true (mis. saat menjalankan perintah one-off).
set -e

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "[entrypoint] prisma migrate deploy..."
  ./node_modules/.bin/prisma migrate deploy
fi

exec "$@"
