#!/usr/bin/env bash
# Nightly Postgres dump. Install as a cron job for the `bbb` user (see
# deploy/README.md's "Backups" step):
#   0 3 * * * /opt/bricksbybid/deploy/scripts/backup-db.sh
#
# Keeps 14 days of dumps under /var/backups/bricksbybid - for anything
# more durable (surviving the instance itself being lost, not just a bad
# deploy), copy these off-box periodically (e.g. `aws s3 sync`), which
# this script deliberately doesn't do itself since it would need AWS
# credentials configured on the box.
set -euo pipefail

BACKUP_DIR=/var/backups/bricksbybid
DB_NAME=bricks_by_bid_prod
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"
pg_dump -U bbb_app -h localhost "$DB_NAME" | gzip > "$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

# Prune anything older than 14 days.
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime +14 -delete

echo "Backed up $DB_NAME to $BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"
