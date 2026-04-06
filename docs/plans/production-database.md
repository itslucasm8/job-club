# Production Database Hardening

> **For Claude:** This is an ops plan. Guide Lucas through VPS commands. Some steps require SSH access.

**Goal:** Ensure the production PostgreSQL database is secure, backed up automatically, and recoverable.

**Why this matters:** This is a paid product with subscriber data and payment records. Losing the database means losing users, subscription state, and trust. A daily backup with tested restores is non-negotiable.

---

## Prerequisites

- [ ] VPS access via SSH
- [ ] Docker Compose running at `/data/job-club/`
- [ ] PostgreSQL 16 container (`db` service) already running

---

## Steps

### Step 1: Secure the Postgres password

**Where:** VPS

1. Generate a strong password:
   ```bash
   openssl rand -base64 32
   ```
2. Update `/data/job-club/.env.production`:
   ```
   POSTGRES_PASSWORD=<generated-password>
   DATABASE_URL=postgresql://jobclub:<generated-password>@db:5432/jobclub
   ```
3. Recreate the database container:
   ```bash
   cd /data/job-club
   docker compose down
   docker compose up -d
   ```

> **Note:** If the database volume already exists with the old password, you may need to change it inside Postgres first: `ALTER USER jobclub PASSWORD 'new-password';`

### Step 2: Restrict Postgres to internal network only

**Where:** `docker-compose.yml` on VPS

Ensure the `db` service does NOT expose port 5432 to the host in production. The `app` container connects via Docker's internal network.

```yaml
services:
  db:
    # Remove or comment out:
    # ports:
    #   - '5432:5432'
```

The `app` service reaches Postgres via `db:5432` (Docker DNS). No external access needed.

### Step 3: Set up automated daily backups

**Where:** VPS

1. Ensure the backup script exists at `/data/job-club/scripts/backup.sh`:
   ```bash
   #!/bin/bash
   BACKUP_DIR="/opt/backups/jobclub"
   mkdir -p "$BACKUP_DIR"
   
   # Dump the database
   docker compose -f /data/job-club/docker-compose.yml exec -T db \
     pg_dump -U jobclub jobclub | gzip > "$BACKUP_DIR/jobclub-$(date +%Y%m%d-%H%M%S).sql.gz"
   
   # Keep last 30 days
   find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
   
   echo "[$(date)] Backup completed"
   ```
2. Make it executable:
   ```bash
   chmod +x /data/job-club/scripts/backup.sh
   ```
3. Test it manually:
   ```bash
   /data/job-club/scripts/backup.sh
   ls -la /opt/backups/jobclub/
   ```

### Step 4: Schedule the backup cron

**Where:** VPS

```bash
crontab -e
```

Add:
```
# Daily Job Club database backup at 3 AM
0 3 * * * /data/job-club/scripts/backup.sh >> /var/log/jobclub-backup.log 2>&1
```

### Step 5: Test a restore

This is critical — a backup you can't restore is not a backup.

```bash
# Create a test database from the backup
gunzip -c /opt/backups/jobclub/jobclub-LATEST.sql.gz | \
  docker compose -f /data/job-club/docker-compose.yml exec -T db \
  psql -U jobclub -d postgres -c "CREATE DATABASE jobclub_test;" && \
gunzip -c /opt/backups/jobclub/jobclub-LATEST.sql.gz | \
  docker compose -f /data/job-club/docker-compose.yml exec -T db \
  psql -U jobclub jobclub_test

# Verify data exists
docker compose -f /data/job-club/docker-compose.yml exec db \
  psql -U jobclub jobclub_test -c "SELECT count(*) FROM \"User\";"

# Clean up test database
docker compose -f /data/job-club/docker-compose.yml exec db \
  psql -U jobclub -d postgres -c "DROP DATABASE jobclub_test;"
```

### Step 6: Set up Postgres connection pooling (optional)

For 230 users, connection pooling isn't critical yet, but Prisma's built-in connection pool (`connection_limit` in DATABASE_URL) should be tuned:

```
DATABASE_URL=postgresql://jobclub:password@db:5432/jobclub?connection_limit=10
```

---

## Verification

- [ ] Postgres password is strong (not `changeme`)
- [ ] Port 5432 is NOT exposed to the host in production `docker-compose.yml`
- [ ] Backup script runs successfully: `ls /opt/backups/jobclub/` shows `.sql.gz` files
- [ ] Cron is scheduled: `crontab -l` shows the backup job
- [ ] Restore test passes: data is intact after restoring from backup
- [ ] App connects and works after password change
