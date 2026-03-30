#!/bin/bash
# Job Club Database Backup Script
# Backs up PostgreSQL database to gzip-compressed SQL files
# Keeps backups for 30 days, then deletes old ones

BACKUP_DIR="/opt/backups/jobclub"
mkdir -p $BACKUP_DIR

# Create timestamped backup
BACKUP_FILE="$BACKUP_DIR/jobclub-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "Starting backup to: $BACKUP_FILE"

# Export database using docker compose
docker compose exec -T db pg_dump -U jobclub jobclub | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "Backup successful: $BACKUP_FILE"

  # Clean up backups older than 30 days
  find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
  echo "Cleaned up backups older than 30 days"
else
  echo "Backup failed!"
  exit 1
fi
