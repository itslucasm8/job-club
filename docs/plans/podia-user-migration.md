# Podia User Migration

> **For Claude:** This is a script + ops plan. It supersedes two prior versions: the original "cold CSV migration" and the later "seamless Stripe subscription transfer" (commit `450795f`). Both were over-engineered because they assumed Podia's Prices needed to be replaced. They don't — Podia's Prices ARE the real production Prices in Lucas's own Stripe account. The migration is therefore **data sync + env swap + comms**, not a subscription rewrite.

**Goal:** Migrate all active Podia subscribers into Job Club so that:
1. Every subscriber can log in to `thejobclub.com.au` on day one.
2. Their existing Stripe subscription stays exactly as-is — same Price, same card, same billing cycle, same next-charge date.
3. Podia's frontend/community layer can be decommissioned after a short parallel-run window.

**Why this matters:** These are paying customers. A botched migration means lost revenue, confused users, and support headaches. The approach here minimizes risk by not touching Stripe subscriptions at all — they stay exactly as Podia left them.

---

## Core insight (verified empirically 2026-04-19 via Stripe MCP)

Podia stores its products and Prices inside Lucas's own Stripe account. Those Prices ARE the production Prices — there is no separate "Job Club product" we need to move subscribers toward. The earlier plan assumed the opposite, leading to an unnecessarily complex "seamless transfer" design.

**Active cohort (as of 2026-04-19):**
- **37 active subscriptions** (23 monthly + 14 yearly). Prior memory said "~230" — that number counted all-time subscribers including churn.
- **0 `past_due`, 0 `trialing`**, 100+ historic `canceled`.

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

## Prerequisites

- [x] Stripe production setup complete.
- [x] Resend email setup complete.
- [x] DNS/domain finalized (`thejobclub.com.au`).
- [x] Pricing decision made (keep Podia prices).
- [ ] Draft three French emails: pre-cutover announcement + welcome email + ~Day 7 follow-up. (The cohort is 100% French; no need for bilingual copy even though the app supports EN.)
- [ ] Backup of current Podia data — export subscribers list, course content. Cheap insurance.
- [ ] Decide cutover window — ~2 hours is enough since no subscription edits happen.

---

## Strategy

Four mechanical moves, in order:

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

## Steps

### Step 1 — Env swap + archive the duplicate product

> **For Claude:** This is the one-line ops change that makes everything else work. No code change needed in the app — only one file (`src/app/api/stripe/checkout/route.ts`) reads these env vars.

Update `.env.production` and `.env.example`:
```
STRIPE_PRICE_ID="monthly-monthly-20230426090915-996d"
STRIPE_PRICE_ID_YEARLY="rejoignez-le-job-club-et-assurez-vous-un-acces-exclusif-a-des-opportunites-de-travail-tout-au-long-de-votre-annee-en-australie-annual-20240523062135-f036"
```

Redeploy on the VPS. Verify by opening Stripe Checkout from the live app and confirming the displayed amounts are $39.99 AUD (monthly) and $149 AUD (yearly).

In Stripe Dashboard:
- Archive product `prod_UFpN16niWDMgQI` ("Job Club by MLF") — non-destructive, hides it from Checkout.
- Archive its two Prices: `price_1THJiOAX1FfAZ93bJZ1xqz7D` and `price_1THJljAX1FfAZ93b21AR4jYe`.

### Step 2 — Pre-cutover announcement (5–7 days before user-facing switch)

A heads-up email **in French only** (or Podia community post) that explains:
- We're moving to a new platform at `thejobclub.com.au` on `<date>`.
- Your subscription carries over automatically — same card, same price, same billing cycle, no action required.
- After the move, you'll get an email with a password-setup link.
- If the email doesn't arrive within 24 hours of `<date>`, contact `<support address>`.

No CTA. Just reduces the surprise and spam-filter risk when the welcome email lands.

### Step 3 — Inventory the cohort

> **For Claude:** Write `scripts/inventory-podia.ts`. Read-only against Stripe.

Query `subscriptions.list({ status: 'active', expand: ['data.customer', 'data.items.data.price'] })`. Filter to rows where `subscription.items.data[0].price.metadata.managed_by === 'Podia'`.

For each matching row, record:
```ts
{
  customerId: string,
  email: string,
  name: string | null,
  subscriptionId: string,
  priceId: string,
  status: string,              // 'active' expected
  currentPeriodEnd: number,    // unix ts
  planType: 'monthly' | 'yearly',
}
```

Also run with `status: 'past_due'` (currently 0, but this may change between prep and cutover).

Output:
- `out/podia-cohort.json` — the full array.
- stdout summary: counts by `planType` and `status`.

Sanity-check against expected 37 (± small churn).

### Step 4 — Dry-run the sync

> **For Claude:** Write `scripts/sync-podia-customers.ts --dry-run` (default on).

For each row in `out/podia-cohort.json`:
- `User.findUnique({ email })`:
  - Exists with `stripeCustomerId` set → **skip** (already migrated or self-signup).
  - Exists without `stripeCustomerId` → **warn** (Lucas reviews — likely test/admin account).
  - Does not exist → **plan to create**.
- Log the planned action. Write nothing to DB or Stripe in dry-run mode.

Review with Lucas before going live.

### Step 5 — Real sync run

> **For Claude:** Same script, without `--dry-run`.

Per row:

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

### Step 6 — Send welcome emails

> **For Claude:** Write `scripts/send-migration-emails.ts`.

For each row in `migration-results.csv` where `dbUpsertStatus ∈ {ok, skipped}`:

1. Generate a `PasswordReset` token (7-day expiry — reuse existing model).
2. Send **French-only** email via Resend:
   - **Subject:** `Bienvenue sur Job Club !`
   - **Body:** Explains the platform switch, reassures subscription carries over at same price and same billing cycle, gives password-setup link, support contact.
3. Rate-limit to ~2 emails/sec.

Log each send to `out/email-results.csv`.

### Step 7 — Parallel-run window (48–72 hours)

- **Podia side:** if possible, replace course content with a "We've moved to thejobclub.com.au" landing page. At minimum post a banner in the community.
- **Monitor:**
  - Sentry for failed logins.
  - PostHog for password-reset page traffic and feed engagement.
  - Stripe webhook events for migrated subscriptions (`invoice.paid`, `customer.subscription.updated`) — confirm the Job Club handler updates `currentPeriodEnd` correctly.
  - Support inbox + WhatsApp/FB DMs.

### Step 8 — Follow-up email to non-logged-in users (~Day 7)

> **For Claude:** Write `scripts/followup-migration-emails.ts`.

Query for migrated users where the corresponding `PasswordReset.used === false` AND `updatedAt` unchanged since sync (proxy for "never logged in"). Send a reminder with a fresh 7-day token.

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
| Customer has no email on Stripe record | Skip, log for manual follow-up. |
| User already exists with `stripeCustomerId` set | Skip — already on Job Club. |
| User already exists without `stripeCustomerId` | Warn, do not auto-merge. Likely admin/test account sharing the email. |

---

## Verification

- [ ] After Step 1: Checkout on `thejobclub.com.au` shows $39.99 AUD (monthly) and $149 AUD (yearly). Duplicate product `prod_UFpN16niWDMgQI` archived in Stripe Dashboard.
- [ ] Inventory count matches expected ~37 (± expected churn since 2026-04-19).
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
- `out/podia-cohort.json` — inventory from Step 3.
- `out/migration-results.csv` — per-row sync outcomes from Step 5.
- `out/email-results.csv` — per-row welcome-email outcomes from Step 6.
- `out/followup-results.csv` — per-row follow-up outcomes from Step 8.

Keep them. Audit trail.
