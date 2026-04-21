# Podia User Migration

> **Status (2026-04-21):** Prep is ~70% done. Waiting on Lucas to pick a cutover date. Scripts for the sync and email steps still to be written. Everything is deliberately idempotent — re-runs are safe.

---

## At a glance — where we are

| # | Item | Status |
|---|------|--------|
| 1 | Plan rewritten to data-sync + env-swap approach (no Stripe subscription edits) | ✅ Done |
| 2 | Pricing locked — $39.99/mo + $149/yr (keep Podia prices) | ✅ Done |
| 3 | Three French email templates drafted (`docs/emails/podia-migration-emails.md`) | ✅ Done |
| 4 | `scripts/inventory-podia.ts` written + run against live Stripe | ✅ Done |
| 5 | Cohort verified: **37 active** (26 monthly + 11 yearly), 0 past_due, 0 missing emails | ✅ Done |
| 6 | Podia data backup (manual export from Podia dashboard) | ⏸ Optional — do before Day-14 decommission |
| 7 | Pick cutover date | ⏳ Waiting on Lucas |
| 8 | Write `scripts/sync-podia-customers.ts` | ⏳ Queued — will write when Lucas says GO |
| 9 | Write `scripts/send-migration-emails.ts` (welcome emails) | ⏳ Queued |
| 10 | Write `scripts/followup-migration-emails.ts` (Day-7 reminder) | ⏳ Queued |
| 11 | Cutover runbook | ✅ Done — see `docs/plans/podia-cutover-runbook.md` |
| 12 | Execute cutover day | ⏳ On chosen date |

**When Lucas says GO:** scripts 8–10 can be written in a single ~2-hour session, then the runbook takes over.

---

## The plan in one paragraph

Keep the 37 existing Podia-created Stripe subscriptions exactly as they are. Swap `.env.production` to point at the Podia Price IDs so new signups also land on those prices. Upsert a `User` row in our Postgres for each Podia subscriber, keyed by `stripeCustomerId`. Email each user a password-setup link so they can log in. Run a Day-7 follow-up for anyone who hasn't activated. Decommission Podia after Day 14 if activation >95%. No `stripe.subscriptions.update()` calls on anyone — which means zero billing-side blast radius.

---

## Core insight (verified 2026-04-19 via Stripe MCP)

Podia stores its products and Prices inside **Lucas's own Stripe account**. Those Prices ARE the production Prices — there is no separate "Job Club product" we need to move subscribers toward. The earlier plan assumed the opposite, leading to an unnecessarily complex "seamless transfer" design.

**Active cohort (verified 2026-04-19, counted from `out/podia-cohort.json`):**
- **37 active subscriptions** — 26 monthly + 11 yearly.
- 0 `past_due`, 0 `trialing`, 0 missing emails, 100+ historic `canceled`.

**The two live Prices:**
| Plan | Price ID | Product | Amount |
|------|----------|---------|--------|
| Monthly | `monthly-monthly-20230426090915-996d` | `prod_Nmdc5X7To0kuWC` | $39.99 AUD/mo |
| Yearly | `rejoignez-le-job-club-et-assurez-vous-un-acces-exclusif-a-des-opportunites-de-travail-tout-au-long-de-votre-annee-en-australie-annual-20240523062135-f036` | `prod_Q9ofD6y3OUQOAk` | $149 AUD/yr |

Both Prices carry `metadata: { managed_by: "Podia", id: "<podia-internal>" }`. That metadata is the reliable cohort filter — don't rely on the slug-style Price IDs.

**Accidental duplicate:** `prod_UFpN16niWDMgQI` ("Job Club by MLF", created 2026-03-27) was set up by Lucas thinking new products were needed. It has zero subscriptions attached. Safe to archive.

**Eleven dead Podia products** also exist in the account (EUR test Prices, abandoned tiers, expired promos). All have zero active subscriptions. Left alone — archiving them is cosmetic, not migration-critical.

---

## Pricing decision (locked 2026-04-19)

**Keep Podia pricing unchanged:** $39.99 AUD/mo, $149 AUD/yr.

**Why:** Analysis of 15 canceled monthly subscriptions shows median tenure = 2 months (distribution: 40% at 1mo, 47% at 2mo, 13% at 3-4mo). That gives monthly LTV ≈ $76/customer. Yearly at $149 already captures ~2× monthly LTV — it is NOT "cannibalizing" monthly, it's capturing commitment-priced value from an audience whose visa aligns with a yearly cycle. See `memory/project_pricing_decision.md` for the reasoning in full. Revisit 60+ days post-launch when PostHog conversion data is available.

---

## Strategy — four mechanical moves

1. **Env swap + duplicate archive** — point `.env.production` at the Podia Price IDs; archive `prod_UFpN16niWDMgQI`.
2. **Customer data sync** — create one `User` record per active Podia subscriber in the Job Club DB, keyed by `stripeCustomerId` and `subscriptionId`.
3. **Welcome emails** — each migrated user gets a password-setup link (7-day `PasswordReset` token).
4. **Decommission Podia** — cancel Podia plan, remove redirects, once >95% have logged in.

**What we are NOT doing:**
- Not calling `stripe.subscriptions.update()` on anyone. Subscriptions stay exactly as they are.
- Not creating new Stripe Prices or Products.
- Not changing billing cycles, proration, or payment methods.
- Not asking customers to re-enter cards or re-subscribe.

### Idempotency by design

Every script must be safely re-runnable. The DB is the single source of truth for idempotency:
- `User.findUnique({ email })` with `stripeCustomerId` set → already synced, skip.
- Otherwise → plan to create.

**Optional Stripe audit marker:** write `metadata: { migrated_from_podia: 'true', migrated_at: <ISO> }` to each migrated subscription. This is a nice-to-have audit trail, not load-bearing for idempotency. If the write fails, log it and continue — the DB state determines whether a user is "migrated."

---

## Step reference (detailed)

> The cutover runbook at `docs/plans/podia-cutover-runbook.md` is the "tick the boxes on the day" version. This section is the underlying reasoning and spec for each script.

### Step 1 — Env swap + archive the duplicate product

One-line ops change that makes everything else work. No code change needed in the app — only one file (`src/app/api/stripe/checkout/route.ts`) reads these env vars.

Update `.env.production` on the VPS:
```
STRIPE_PRICE_ID="monthly-monthly-20230426090915-996d"
STRIPE_PRICE_ID_YEARLY="rejoignez-le-job-club-et-assurez-vous-un-acces-exclusif-a-des-opportunites-de-travail-tout-au-long-de-votre-annee-en-australie-annual-20240523062135-f036"
```

Redeploy (`docker compose up -d --build`). Verify by opening Stripe Checkout from the live app and confirming the amounts display as $39.99 AUD (monthly) and $149 AUD (yearly).

In Stripe Dashboard:
- Archive product `prod_UFpN16niWDMgQI` ("Job Club by MLF") — non-destructive, hides it from Checkout.
- Archive its two Prices: `price_1THJiOAX1FfAZ93bJZ1xqz7D` and `price_1THJljAX1FfAZ93b21AR4jYe`.

### Step 2 — Pre-cutover announcement (5–7 days before user-facing switch)

Email in French only to all 37 active subscribers. Template lives in `docs/emails/podia-migration-emails.md` (§1). Tells them:
- We're moving to `thejobclub.com.au` on `<date>`.
- Subscription carries over automatically — same card, same price, same billing cycle, no action required.
- After the move they'll get a password-setup email.

No CTA. Just reduces surprise and spam-filter risk when the welcome email lands. Can be sent by pasting into Resend dashboard manually — no script strictly required.

### Step 3 — Inventory the cohort ✅ DONE

`scripts/inventory-podia.ts` is written and was run on 2026-04-19. It queries `subscriptions.list({ status: 'active' | 'past_due' })`, filters on `price.metadata.managed_by === 'Podia'`, and writes `out/podia-cohort.json`. Re-run any time before cutover to refresh — it's a pure read.

Run it again the morning of cutover to capture any churn between now and then:
```bash
STRIPE_SECRET_KEY=$(grep -oE 'rk_live_[a-zA-Z0-9]+' ~/.claude.json | head -1) npx tsx scripts/inventory-podia.ts
```

### Step 4 — Dry-run the sync (script TBD)

Future `scripts/sync-podia-customers.ts` will default to `--dry-run`. For each row in `out/podia-cohort.json`:
- `User.findUnique({ email })`:
  - Exists with `stripeCustomerId` set → **skip** (already migrated or self-signup).
  - Exists without `stripeCustomerId` → **warn** (Lucas reviews — likely test/admin account).
  - Does not exist → **plan to create**.
- Log the planned action. Write nothing to DB or Stripe in dry-run mode.

Review dry-run output with Lucas before going live.

### Step 5 — Real sync run (script TBD)

Same script, with `--live`. Per row:

1. **DB upsert:**
   ```ts
   {
     email,
     name,
     passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12), // unusable; user resets
     role: 'user',
     stripeCustomerId: customerId,
     subscriptionId,
     subscriptionStatus: status,    // usually 'active'
     currentPeriodEnd: new Date(currentPeriodEnd * 1000),
     preferredLanguage: 'fr',
     onboardingCompleted: false,
   }
   ```
2. **Optional Stripe audit marker** — tag the subscription with metadata:
   ```ts
   await stripe.subscriptions.update(subscriptionId, {
     metadata: { migrated_from_podia: 'true', migrated_at: new Date().toISOString() }
   })
   ```
   Non-load-bearing — if it fails (rate limit, transient error), log and continue. Rate-limit to ~5 req/sec.

3. **Audit log:** append to `out/migration-results.csv`: `email, customerId, subscriptionId, dbUpsertStatus (ok|skipped|failed), stripeMetadataStatus (ok|skipped|failed), error`.

Errors → log, continue, review at end.

### Step 6 — Send welcome emails (script TBD)

Future `scripts/send-migration-emails.ts`. For each row in `migration-results.csv` where `dbUpsertStatus ∈ {ok, skipped}`:

1. Generate a `PasswordReset` token (7-day expiry — reuse existing model).
2. Send French email via Resend using template from `docs/emails/podia-migration-emails.md` §2.
3. Rate-limit to ~2 emails/sec.

Log each send to `out/email-results.csv`.

### Step 7 — Parallel-run window (48–72 hours)

- **Podia side:** replace course content with a "We've moved to thejobclub.com.au" landing page if possible. At minimum post a banner in the community.
- **Monitor:**
  - Sentry for failed logins.
  - PostHog for password-reset page traffic and feed engagement.
  - Stripe webhook events for migrated subscriptions (`invoice.paid`, `customer.subscription.updated`) — confirm the Job Club handler updates `currentPeriodEnd` correctly.
  - Support inbox + WhatsApp/FB DMs.

### Step 8 — Follow-up email to non-activators (~Day 7) (script TBD)

Future `scripts/followup-migration-emails.ts`. Query for migrated users where the corresponding `PasswordReset.used === false` AND `updatedAt` unchanged since sync (proxy for "never logged in"). Send reminder using template from `docs/emails/podia-migration-emails.md` §3, with a fresh 7-day token.

Catches spam-filter losses and disengaged subscribers before decommission.

### Step 9 — Decommission Podia

Once >95% have logged in or at least opened the welcome email:
1. Confirm Podia data backup is fresh.
2. Cancel the Podia plan / subscription.
3. Remove any Podia → Job Club redirects.

---

## Edge cases

| Case | Handling |
|------|---------|
| `past_due` subscription | Migrate as-is. Stripe dunning retries continue. User gets welcome email; `past_due` banner shown on Job Club until paid. |
| `canceled` but still in current period | Skip — they won't renew and won't generate revenue. Not worth the migration effort. |
| `trialing` | Unlikely but possible. Flag in inventory output for manual review. |
| Duplicate emails (one customer, two active subs) | Log, skip, Lucas resolves manually. Unusual. |
| Customer has no email on Stripe record | Skip, log for manual follow-up. Verified 0 cases in current cohort. |
| User already exists with `stripeCustomerId` set | Skip — already on Job Club. |
| User already exists without `stripeCustomerId` | Warn, do not auto-merge. Likely admin/test account sharing the email. |

---

## Verification

- [ ] After Step 1: Checkout on `thejobclub.com.au` shows $39.99 AUD (monthly) and $149 AUD (yearly). Duplicate product `prod_UFpN16niWDMgQI` archived in Stripe Dashboard.
- [ ] Inventory count matches expected ~37 (± small churn since 2026-04-19).
- [ ] Dry-run completes with zero unexpected errors.
- [ ] Real sync `migration-results.csv`: every row is `ok` or `skipped`; any `failed` rows understood.
- [ ] Spot-check 3 migrated users: the `stripeCustomerId`, `subscriptionId`, and `currentPeriodEnd` in the DB match what Stripe shows.
- [ ] Spot-check: log in as 2–3 migrated users (after password reset) — feed loads, no paywall redirect, saved-jobs works.
- [ ] Welcome emails delivered (Resend dashboard + a few real inboxes).
- [ ] Webhook handler regression check: trigger a test `invoice.paid` event for a migrated subscription → user's `currentPeriodEnd` updates correctly.
- [ ] Re-run `sync-podia-customers.ts`: everything skips cleanly, no duplicate writes (proves idempotency).

---

## Risks & rollback

### Primary risk: DB state diverges from Stripe

If the sync script errors mid-run, some users are in the DB and others aren't. `migration-results.csv` is the source of truth. Re-run the script — idempotency check skips already-synced rows. No data loss, no billing disruption because subscriptions were never touched.

### Secondary risk: Stripe webhook doesn't fire for Podia-created subs

Low-probability but worth verifying. Podia's Prices are normal Stripe objects, and our webhook listens on the account level — it should receive all events for all subscriptions. But trigger a manual test event for one migrated sub post-launch to confirm the handler updates `currentPeriodEnd` correctly.

### Tertiary risk: Podia reacts to the decommission

Podia's system may still be "listening" for activity on its products until their plan is canceled. Shouldn't matter — we're not modifying anything Podia cares about. But if anything weird happens (unexpected cancellation emails from Podia to customers, etc.), the parallel-run window's monitoring will surface it.

### Rollback

Because no subscriptions are modified, rollback is trivial:
- **Undo Step 1:** revert env var swap, un-archive the duplicate product.
- **Undo Step 5:** delete User rows created during the sync. Safe because no dependent data yet (saved jobs, notifications happen only after the user logs in).
- **Welcome emails:** can't un-send, but sending again isn't harmful (users get a fresh password-reset link).

---

## File outputs

All scripts write to a gitignored `out/` directory:
- `out/podia-cohort.json` — inventory from Step 3 (✅ exists).
- `out/migration-results.csv` — per-row sync outcomes from Step 5.
- `out/email-results.csv` — per-row welcome-email outcomes from Step 6.
- `out/followup-results.csv` — per-row follow-up outcomes from Step 8.

Keep them. Audit trail.

---

## Related docs

- **Runbook:** [`podia-cutover-runbook.md`](podia-cutover-runbook.md) — the minute-by-minute command sequence for cutover day.
- **Email templates:** [`../emails/podia-migration-emails.md`](../emails/podia-migration-emails.md) — the three French emails (pre-cutover, welcome, follow-up).
- **Pricing memory:** `memory/project_pricing_decision.md` — the LTV analysis behind the $39.99/$149 decision.
