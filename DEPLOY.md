# Job Club — Deployment Guide

## Prerequisites

- Docker and Docker Compose installed on the VPS
- Cloudflare Tunnel configured and running for `thejobclub.com.au`
- Stripe account with production keys
- Resend account with API key configured

## Environment Setup

1. **Copy .env.example to .env.production:**
   ```bash
   cp .env.example .env.production
   ```

2. **Fill in all values** (see comments in `.env.example` for guidance):
   ```bash
   # Database
   DATABASE_URL="postgresql://jobclub:SECURE_PASSWORD@localhost:5432/jobclub"
   POSTGRES_PASSWORD="SECURE_PASSWORD"

   # Auth
   NEXTAUTH_SECRET="$(openssl rand -base64 32)"
   NEXTAUTH_URL="https://thejobclub.com.au"

   # Stripe (from your dashboard)
   STRIPE_SECRET_KEY="sk_live_..."
   STRIPE_PUBLISHABLE_KEY="pk_live_..."
   STRIPE_WEBHOOK_SECRET="whsec_..."
   STRIPE_PRICE_ID="price_..."

   # Email
   RESEND_API_KEY="re_..."
   EMAIL_FROM="Job Club <noreply@mlfrance.dev>"

   NODE_ENV="production"
   ```

3. **Verify all required variables are set:**
   - Database connection works
   - NEXTAUTH_SECRET is securely generated and unique
   - Stripe keys are production keys (not test keys)
   - Resend API key is valid

## Deploy

1. **Pull latest code:**
   ```bash
   git pull origin main
   ```

2. **Build and start services:**
   ```bash
   docker compose up -d --build
   ```

3. **Initialize database schema:**
   ```bash
   docker compose exec app npx prisma db push
   ```

4. **Seed database (creates admin user only in production):**
   ```bash
   docker compose exec app npx tsx prisma/seed.ts
   ```

5. **Verify services are running:**
   ```bash
   docker compose ps
   ```

6. **Check application logs:**
   ```bash
   docker compose logs -f app
   ```

## Backup

Set up automated daily backups of the PostgreSQL database:

1. **Ensure backup directory exists on host:**
   ```bash
   mkdir -p /opt/backups/jobclub
   chmod 755 /opt/backups/jobclub
   ```

2. **Make backup script executable:**
   ```bash
   chmod +x /opt/job-club/scripts/backup.sh
   ```

3. **Add daily backup to crontab:**
   ```bash
   # Run as the user who owns Docker (typically root or your deploy user)
   0 3 * * * /opt/job-club/scripts/backup.sh
   ```

   This runs the backup every day at 3 AM. Backups are kept for 30 days automatically.

4. **Test backup manually:**
   ```bash
   /opt/job-club/scripts/backup.sh
   ls -lh /opt/backups/jobclub/
   ```

## Stripe Configuration

1. **Create the product in Stripe Dashboard:**
   - Go to Products > Add Product
   - Name: "Job Club — Abonnement mensuel"
   - Pricing: $39.99 AUD
   - Billing period: Monthly
   - Copy the **Price ID** (format: `price_...`)

2. **Set STRIPE_PRICE_ID:**
   ```bash
   # In .env.production
   STRIPE_PRICE_ID="price_xxxxxxxxxxxxx"
   ```

3. **Configure webhook endpoint:**
   - Go to Developers > Webhooks > Add endpoint
   - Endpoint URL: `https://thejobclub.com.au/api/stripe/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Copy the **Signing secret** to `STRIPE_WEBHOOK_SECRET`

4. **Test webhook:**
   ```bash
   docker compose logs app | grep "stripe"
   ```

## Logs

View real-time application logs:

```bash
# All logs
docker compose logs -f app

# Follow only errors
docker compose logs app | grep '"level":"error"'

# Search by route
docker compose logs app | grep "/api/jobs"
```

Logs are output as structured JSON for easy parsing:

```json
{
  "timestamp": "2026-03-30T15:45:23.456Z",
  "level": "error",
  "message": "POST /api/jobs failed",
  "route": "/api/jobs",
  "error": "Error details..."
}
```

## Health Check

1. **Check database connection:**
   ```bash
   docker compose exec db psql -U jobclub -d jobclub -c "SELECT 1"
   ```

2. **Check application is responsive:**
   ```bash
   curl https://thejobclub.com.au/
   ```

3. **Verify admin user can login:**
   - Go to https://thejobclub.com.au/login
   - Use admin credentials from database

## Rollback

If something goes wrong:

1. **Stop containers:**
   ```bash
   docker compose down
   ```

2. **Revert code to previous version:**
   ```bash
   git checkout <previous-commit-hash>
   ```

3. **Restart:**
   ```bash
   docker compose up -d --build
   ```

4. **Restore database from backup (if needed):**
   ```bash
   # List available backups
   ls -lh /opt/backups/jobclub/

   # Restore from a specific backup
   docker compose down
   zcat /opt/backups/jobclub/jobclub-20260330-030000.sql.gz | docker compose exec -T db psql -U jobclub jobclub
   docker compose up -d
   ```

## Monitoring

Monitor key metrics:

- **Application performance:** Check response times in logs
- **Database size:** `docker compose exec db du -sh /var/lib/postgresql/data`
- **Disk space:** `df -h /opt/backups/jobclub/`
- **Memory usage:** `docker stats`

## Security

- Keep `.env.production` secure and never commit it
- Rotate NEXTAUTH_SECRET periodically
- Monitor Stripe webhook logs for failures
- Check application logs for errors and suspicious activity
- Keep Docker images updated: `docker compose pull && docker compose up -d --build`

## Support

For issues:

1. Check application logs: `docker compose logs app`
2. Check database logs: `docker compose logs db`
3. Verify environment variables: `docker compose exec app env | grep -E "DATABASE|STRIPE|NEXTAUTH"`
4. Check Stripe dashboard for webhook failures
