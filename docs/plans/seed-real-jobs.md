# Seed Real Jobs

> **For Claude:** This is a script + ops plan. Guide Lucas through the process. Some steps are manual (posting real jobs).

**Goal:** Replace demo/seed data with real job listings so the app has real content on launch day.

**Why this matters:** Migrated users will log in and immediately check the feed. If they see "Fruit Picking at Smith Farm" demo data, they'll think the product isn't real. The feed needs 20-30 genuine, current listings.

---

## Prerequisites

- [ ] Production database running (see `production-database.md`)
- [ ] Admin account created on production
- [ ] App deployed and accessible

---

## Steps

### Step 1: Clear demo data from production

**Where:** VPS

```bash
cd /data/job-club
docker compose exec db psql -U jobclub jobclub
```

```sql
-- Clear all demo data (keep users if any real ones exist)
DELETE FROM "Notification";
DELETE FROM "SavedJob";
DELETE FROM "Job";

-- Verify
SELECT count(*) FROM "Job";  -- Should be 0
```

> **Warning:** Do NOT run `npm run db:reset` in production — it drops ALL tables including users.

### Step 2: Post real jobs via admin UI

**Where:** `https://jobclub.mlfrance.dev/admin`

The admin team should post 20-30 real jobs from:
- **Gumtree** — search for farm work, hospitality, cleaning in each state
- **Seek** — search for casual/WHV-friendly roles
- **Facebook groups** — French backpacker job boards

Aim for variety:
- At least 3-4 jobs per major state (QLD, NSW, VIC, WA)
- Mix of categories (farm, hospitality, cleaning, construction)
- Mix of job types (casual, full-time, contract)

### Step 3: Verify the feed looks good

1. Log in as a regular user
2. Check the feed — jobs should appear with real titles, companies, locations
3. Test filters — each state and category should return results
4. Check that timestamps look natural (all jobs will be "just posted" initially — that's fine for launch)

### Step 4: Optional — bulk import script

If manual posting is too slow for the initial batch, Claude can write a bulk import script:

```bash
# Format: CSV with columns matching the Job model
npx tsx scripts/import-jobs.ts --input real-jobs.csv
```

This is a nice-to-have. Manual posting via the admin UI is fine for 20-30 jobs.

---

## Verification

- [ ] Production database has 0 demo jobs
- [ ] At least 20 real jobs are posted
- [ ] Jobs span multiple states and categories
- [ ] Feed loads correctly for a regular user
- [ ] Filters work (state, category, search)
- [ ] No demo data artifacts remain (check job descriptions for lorem ipsum, fake companies)

---

## Ongoing

After launch, the admin team posts 20-30 new jobs daily. The existing admin UI supports this workflow. Future improvements (scraper automation, AI extraction) are Phase 2.
