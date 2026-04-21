# Podia Cutover — Runbook

> **Use this on the day.** It's the tick-the-boxes checklist. The full reasoning lives in [`podia-user-migration.md`](podia-user-migration.md).
>
> **Total active time:** ~2 hours of hands-on, then 48–72h of passive monitoring.
> **Cutover window:** pick a weekday morning (Tuesday–Thursday). Avoid weekends (support response slow) and Mondays (Monday-morning Stripe webhook backlog).

---

## T-7 days — Prep

- [ ] **Pick a cutover date.** Write it here: `____________`
- [ ] **Confirm scripts are written.** The three scripts below must exist before T-5:
  - [ ] `scripts/sync-podia-customers.ts`
  - [ ] `scripts/send-migration-emails.ts`
  - [ ] `scripts/followup-migration-emails.ts`
- [ ] **Confirm email templates.** `docs/emails/podia-migration-emails.md` — final wording, support address, sign-off all confirmed.
- [ ] **Test sync script in dry-run** against the local DB: `npx tsx scripts/sync-podia-customers.ts` — no `--live` flag. Review output.
- [ ] **Send a test welcome email** to Lucas's own email address to check rendering in Gmail + Outlook + Apple Mail.

---

## T-5 days — Pre-cutover announcement

- [ ] **Refresh cohort inventory** (optional but recommended):
  ```bash
  STRIPE_SECRET_KEY=$(grep -oE 'rk_live_[a-zA-Z0-9]+' ~/.claude.json | head -1) npx tsx scripts/inventory-podia.ts
  ```
  Expect ~37. Small variance (±2) is fine — it's just churn.
- [ ] **Send pre-cutover announcement email** to all 37 addresses. Paste template (`docs/emails/podia-migration-emails.md` §1) into Resend dashboard, substitute `{{ cutover_date }}`, send.
- [ ] **Verify delivery.** Check a few inboxes. Watch Resend for bounces — any bounce = flag for manual follow-up.

---

## T-1 day — Final prep

- [ ] **Check VPS health:** `ssh root@72.61.120.170`, then `docker compose ps` — app + db should both be `Up`.
- [ ] **Fresh DB backup on VPS:** `/data/job-club/scripts/backup.sh` (runs the daily pg_dump).
- [ ] **Check Stripe dashboard** — webhook endpoint is healthy, no failures in the last 24h.
- [ ] **Check Sentry + PostHog** — both ingesting events, no active alerts.
- [ ] **Block 2 hours in the calendar** for cutover day. Ideally with a second person available for sanity-checks.

---

## Cutover Day — Execute

### Phase 1 — Env swap on VPS (~15 min)

- [ ] SSH in: `ssh root@72.61.120.170`
- [ ] `cd /data/job-club`
- [ ] `git pull` — make sure VPS has latest main.
- [ ] Back up current `.env.production`: `cp .env.production .env.production.bak-$(date +%Y%m%d)`
- [ ] Edit `.env.production`, set:
  ```
  STRIPE_PRICE_ID="monthly-monthly-20230426090915-996d"
  STRIPE_PRICE_ID_YEARLY="rejoignez-le-job-club-et-assurez-vous-un-acces-exclusif-a-des-opportunites-de-travail-tout-au-long-de-votre-annee-en-australie-annual-20240523062135-f036"
  ```
- [ ] Redeploy: `docker compose up -d --build app`
- [ ] Tail logs for 1 minute: `docker compose logs -f app` — no errors during startup.
- [ ] Open `https://thejobclub.com.au/subscribe` in an incognito window → start a checkout → confirm Stripe page shows **$39.99 AUD/mo** and **$149 AUD/yr**. Close the tab without paying.

### Phase 2 — Archive duplicate Stripe product (~5 min)

- [ ] Stripe Dashboard → Products → search `prod_UFpN16niWDMgQI` ("Job Club by MLF", created 2026-03-27)
- [ ] Archive the product.
- [ ] Archive its two Prices: `price_1THJiOAX1FfAZ93bJZ1xqz7D` and `price_1THJljAX1FfAZ93b21AR4jYe`.

### Phase 3 — Refresh inventory + dry-run sync (~10 min)

From your local machine:
- [ ] ```bash
  STRIPE_SECRET_KEY=$(grep -oE 'rk_live_[a-zA-Z0-9]+' ~/.claude.json | head -1) npx tsx scripts/inventory-podia.ts
  ```
  Output: `out/podia-cohort.json`. Check summary matches expected (~37).
- [ ] **Dry-run the sync:**
  ```bash
  DATABASE_URL="postgresql://<prod-url>" npx tsx scripts/sync-podia-customers.ts
  ```
  Expect: all 37 rows planned for creation, 0 skips, 0 warnings. Review any warnings before proceeding.

### Phase 4 — Live sync + welcome emails (~15 min)

- [ ] **Live sync:**
  ```bash
  DATABASE_URL="postgresql://<prod-url>" STRIPE_SECRET_KEY="sk_live_..." npx tsx scripts/sync-podia-customers.ts --live
  ```
  Check `out/migration-results.csv` — every row should be `ok` or `skipped`. Any `failed` → investigate before continuing.
- [ ] **Spot-check DB state:** pick 3 random migrated users in `migration-results.csv`. For each:
  ```bash
  ssh root@72.61.120.170
  docker compose exec db psql -U postgres -d jobclub -c "SELECT email, \"stripeCustomerId\", \"subscriptionId\", \"currentPeriodEnd\" FROM \"User\" WHERE email='...';"
  ```
  Match what Stripe shows for that customer. All three should line up.
- [ ] **Send welcome emails:**
  ```bash
  RESEND_API_KEY="re_..." npx tsx scripts/send-migration-emails.ts --live
  ```
  Rate-limited to ~2/sec → ~20 seconds for 37 emails. Check `out/email-results.csv` — all should say `sent`.
- [ ] **Spot-check a real inbox** (your own test account in the cohort, or ask one user in advance to confirm).

### Phase 5 — Monitor for 2 hours actively (~0 hands-on, just eyes open)

- [ ] **Sentry:** watch for any spikes in `/api/auth/*` errors or 500s.
- [ ] **PostHog:** watch the `/reset-password` pageview count climb — every migrated user passing through proves the token is valid and the page is loading.
- [ ] **Stripe webhooks:** next time one of the migrated customers has any event (`invoice.paid`, `customer.subscription.updated`), confirm our handler updates `currentPeriodEnd` correctly. Doesn't have to happen on cutover day — just confirm eventually.
- [ ] **Support inbox:** any emails from confused users? Reply fast — these are paying customers.

---

## Day 1–3 — Parallel run

- [ ] **Every morning:** check support inbox, Sentry, PostHog.
- [ ] **Post a banner on Podia** community: "We've moved to thejobclub.com.au — check your email for login instructions."

---

## Day 7 — Follow-up

- [ ] **Run follow-up script:**
  ```bash
  DATABASE_URL="..." RESEND_API_KEY="..." npx tsx scripts/followup-migration-emails.ts --live
  ```
  Queries users where `PasswordReset.used === false` — i.e., never activated. Sends French reminder with fresh 7-day token.
- [ ] Check `out/followup-results.csv`.

---

## Day 14 — Decommission

If activation ≥95% (i.e., ≤2 of 37 haven't logged in):

- [ ] **Fresh Podia data export** (even if you don't want to keep any of it — one-time snapshot in case).
- [ ] **Cancel Podia plan** in Podia dashboard.
- [ ] **Remove any Podia → Job Club redirects**.
- [ ] **Update `TODO.md`** → mark Podia migration as complete. 🎉

---

## Abort / rollback

Only worth considering during Phase 1–4 on cutover day. After emails go out, rollback is a communications problem, not a technical one.

### Abort during Phase 1 (env swap just done, no sync yet)

Trivial:
```bash
# On VPS
cp .env.production.bak-YYYYMMDD .env.production
docker compose up -d --build app
```
Un-archive the duplicate Stripe product in Dashboard. Done.

### Abort during Phase 3 (inventory/dry-run)

Nothing to roll back — no writes yet.

### Abort during Phase 4 (after live sync, before emails)

Delete the newly-created User rows:
```sql
DELETE FROM "User" WHERE "stripeCustomerId" IN (
  -- paste customerIds from migration-results.csv where dbUpsertStatus=ok
);
```
Safe because no dependent data yet (saved jobs, notifications only after login).

### Abort after emails sent

Too late to "undo." Options:
- Leave everything in place, send a follow-up email explaining "ignore the earlier email, we're delaying by X days." Not great UX but recoverable.
- If a severe bug surfaces: the env swap can still be reverted (subscriptions keep working on Podia prices regardless).

---

## Known IDs (don't look these up again)

- **Monthly Price ID:** `monthly-monthly-20230426090915-996d`
- **Yearly Price ID:** `rejoignez-le-job-club-et-assurez-vous-un-acces-exclusif-a-des-opportunites-de-travail-tout-au-long-de-votre-annee-en-australie-annual-20240523062135-f036`
- **Duplicate product to archive:** `prod_UFpN16niWDMgQI`
- **VPS SSH:** `ssh root@72.61.120.170`
- **VPS app path:** `/data/job-club/`
- **Read-only Stripe key location:** `~/.claude.json` (grep for `rk_live_`)
