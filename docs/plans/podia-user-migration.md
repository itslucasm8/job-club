# Podia User Migration

> **For Claude:** This is a script + ops plan. Claude writes the migration script; Lucas provides the Podia export data. Use `feature-dev` for the script development.

**Goal:** Migrate ~230 paying Podia subscribers into Job Club with working accounts and active subscriptions.

**Why this matters:** These are paying customers. A botched migration means lost revenue, confused users, and support headaches. Every user must be able to log in on day one.

---

## Prerequisites

- [ ] Stripe production setup complete (see `stripe-production-setup.md`)
- [ ] Resend email setup complete (see `resend-email-setup.md`)
- [ ] DNS/domain finalized (see `dns-domain.md`)
- [ ] Podia subscriber export (CSV or JSON) — Lucas to provide
- [ ] Decision: grandfather existing subscriptions or require fresh Stripe signup?

---

## Key Decision: Subscription Strategy

**Option A — Grandfather existing subs:**
- Create users with `subscriptionStatus: 'active'` and a future `subscriptionEnd` date
- Users get free access until their Podia billing cycle ends
- They re-subscribe via Stripe when their grandfathered period expires
- **Pro:** Smoothest UX, no one pays twice
- **Con:** Need to track grandfathered end dates, more complex

**Option B — Fresh Stripe signup:**
- Create users with `subscriptionStatus: null`
- Send migration email with login link + instruction to subscribe via Stripe
- **Pro:** Clean slate, every user is on Stripe from day 1
- **Con:** Some users might churn during the transition

**Recommendation:** Option A with a 30-day grace period. Gives users time to set up Stripe billing naturally.

---

## Steps

### Step 1: Get the Podia export

**Lucas action:** Export subscriber list from Podia. Need at minimum:
- Email address
- Name (first name at least)
- Subscription plan (monthly/yearly)
- Subscription start date / next billing date
- Payment status (active, past due, etc.)

### Step 2: Write the migration script

> **For Claude:** Use `feature-dev` to build `scripts/migrate-podia.ts`

The script should:
1. Read the Podia export (CSV/JSON)
2. For each subscriber:
   - Check if user already exists (by email) — skip if so
   - Create a User record with:
     - `email`, `name` from export
     - `password`: generate a random temporary password (or skip — users will reset)
     - `role`: `'user'`
     - `subscriptionStatus`: `'active'`
     - `subscriptionEnd`: calculated from grace period (e.g., 30 days from migration date)
   - Log success/failure for each user
3. Output a summary: total processed, created, skipped, errors
4. Generate a CSV of `email, temporaryPassword` for the welcome email batch

```bash
# Usage:
npx tsx scripts/migrate-podia.ts --input podia-export.csv --grace-days 30 --dry-run
npx tsx scripts/migrate-podia.ts --input podia-export.csv --grace-days 30
```

### Step 3: Dry-run the migration

Run with `--dry-run` first:
```bash
npx tsx scripts/migrate-podia.ts --input podia-export.csv --grace-days 30 --dry-run
```

Review the output. Check for:
- Email parsing issues
- Duplicate detection
- Edge cases (missing names, weird email formats)

### Step 4: Run the real migration

```bash
npx tsx scripts/migrate-podia.ts --input podia-export.csv --grace-days 30
```

### Step 5: Send migration welcome emails

> **For Claude:** Use `feature-dev` to build the email batch sender

Write a script that sends a personalized email to each migrated user:
- Subject: `Bienvenue sur Job Club !`
- Content: explains the migration, provides login link, password reset link, and how to set up Stripe billing
- Rate-limit: ~2 emails/second to avoid Resend throttling

```bash
npx tsx scripts/send-migration-emails.ts --input migration-results.csv
```

### Step 6: Monitor the first 48 hours

Watch for:
- Failed logins (users can't get in)
- Password reset volume (expected to be high)
- Stripe subscription signups
- Support emails/messages

---

## Verification

- [ ] Dry-run completes without errors
- [ ] User count matches Podia export count (minus any duplicates)
- [ ] Random spot-check: pick 5 users, verify they can log in and see the feed
- [ ] Grandfathered users have correct `subscriptionEnd` dates
- [ ] Migration welcome emails are delivered (check a few inboxes)
- [ ] Password reset flow works for migrated users

---

## Rollback

If the migration goes badly:
```sql
-- Delete all migrated users (those created by the migration script)
-- The script should tag migrated users so they're identifiable
DELETE FROM "User" WHERE "createdAt" > '2026-04-XX' AND role = 'user';
```

Re-run after fixing the issue.
