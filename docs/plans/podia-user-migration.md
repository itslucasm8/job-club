# Podia User Migration

> **For Claude:** This is a script + ops plan. The old plan assumed a "cold" CSV migration. This version takes advantage of Stripe already being Lucas's own account (connected to Podia), which enables a **seamless subscription transfer** — no payment interruption, no re-entering cards.

**Goal:** Migrate ~230 paying Podia subscribers into Job Club so that:
1. Every subscriber can log in to `thejobclub.com.au` on day one.
2. Their existing Stripe subscription continues on the same card, same billing cycle, just re-pointed at Job Club's new Price IDs.
3. Podia can be safely decommissioned after a short parallel-run window.

**Why this matters:** These are paying customers. A botched migration means lost revenue, confused users, and support headaches. The seamless approach minimizes churn risk by removing *any* action required from the user to keep their subscription alive.

---

## Core insight

Podia uses Stripe Connect to manage billing inside **your own Stripe account**. That means:

- The ~230 active subscriptions already exist in `dashboard.stripe.com` under your login.
- Each one references a **Podia-created Price ID** (e.g. `price_1AbCd...` tied to Podia's Product).
- You should have full API access to update, cancel, or re-price those subscriptions — **but this needs to be verified empirically before we touch the cohort** (see Step 0).

The migration is therefore **not** a payment migration — cards stay charged. It's a data + ownership re-assignment.

---

## Prerequisites

- [x] Stripe production setup complete (`STRIPE_PRICE_ID` monthly + `STRIPE_PRICE_ID_YEARLY` live in prod env).
- [x] Resend email setup complete.
- [x] DNS/domain finalized (`thejobclub.com.au`).
- [ ] **Identify the Podia Price IDs** in Stripe — the "old" prices currently attached to the 230 subscriptions. We'll filter by these to find the migration cohort.
- [ ] **Decide the cutover window** — ideally a ~2-hour low-activity window; the migration itself will be fast but we want a clean before/after.
- [ ] **Draft two emails** (French + English): a *pre-cutover announcement* (Step 0.5) and a *welcome email at cutover* (Step 4).
- [ ] **Backup of current Podia data** — export subscribers, course content, anything else Podia holds. Cheap insurance before we decommission.

---

## Strategy: Seamless Subscription Transfer

For every active Podia subscription:

1. **Update the subscription** via `stripe.subscriptions.update()` to swap the old Podia Price ID → new Job Club Price ID (monthly or yearly, matching their current plan).
2. **Preserve the billing cycle** (`proration_behavior: 'none'`, `billing_cycle_anchor: 'unchanged'`) so their next charge date doesn't shift.
3. **Tag the subscription** with `metadata: { migrated_from_podia: 'true', migrated_at: <ISO date> }` for audit + idempotency.
4. **Create a User record** in Job Club DB linked by `stripeCustomerId`.
5. **Send a welcome email** with a one-time password-setup link (reuses existing `PasswordReset` flow).

Users wake up the next morning with:
- An email: "You can now log in at thejobclub.com.au, your subscription carries over, click here to set your password."
- A live subscription on the new platform.
- No payment action required.

### Idempotency by design

The script must be **safely re-runnable**. In practice we'll run it 3–5 times: dry-run, real-run-that-errors, re-run-after-fix, final-cleanup. Design for this from the start.

Every row checks two independent "have we done this?" signals before acting:
- **Stripe:** `subscription.metadata.migrated_from_podia === 'true'` → skip.
- **DB:** `User.findUnique({ email })` returns a user with `stripeCustomerId` set → skip.

### Ordering: Stripe first, DB second

This encodes a deliberate belief: **billing correctness > DB correctness**. A charged-but-can't-login user is fixable (reset their password, they get in). A logged-in-but-not-charged user is a revenue leak. Stripe is the side that matters for the business, so it goes first.

---

## Steps

### Step 0 — Diagnostic: verify one subscription before touching the rest

> **For Claude:** Write `scripts/diagnose-podia.ts`. Read-only + one no-op write. Takes a single `--subscription-id` argument.

The whole plan rests on two assumptions: **(a)** we have write access to Podia-created subscriptions under Stripe Connect, and **(b)** the old Price and the new target Price have matching amounts and currency. If either is wrong, the plan fails on row 1 and we need a different approach.

This script takes one live subscription ID from Stripe Dashboard (pick any active Podia subscriber) and checks:

1. **Retrieve** the subscription with your live keys — should succeed. Log `application` field (if present, it points to Podia's Connect platform — informational).
2. **Inspect the Price** — log `unit_amount`, `currency`, and `recurring.interval`. Compare against `STRIPE_PRICE_ID` (monthly) or `STRIPE_PRICE_ID_YEARLY` (yearly) in env. If amounts or currency differ, **halt and flag for human review** — migrating to a different amount is a material change to the customer's subscription terms.
3. **No-op update** — try setting `metadata: { migration_check: '<timestamp>' }` on the subscription. If this fails with a permission error, we don't have write access via Stripe Connect and the seamless transfer approach isn't viable. Fall back to the cold-migration path (see "Fallback plan" at bottom).

Only after all three checks pass do we proceed to Step 1.

### Step 0.5 — Pre-cutover announcement (5–7 days before)

230 paying customers getting an unexpected "set your password" email from a domain they don't recognize is a spam-filter disaster and a support-ticket bomb. Warn them first.

Send a bilingual email (or post to the Podia community, whichever reaches them better) that explains:
- We're moving to a new platform at `thejobclub.com.au` on `<date>`.
- Your subscription carries over automatically — same card, same billing cycle, no action required.
- After the move, you'll get an email with a link to set your password and log in.
- If the email doesn't arrive, contact `<support address>`.

No action required from the user — this is a heads-up, not a CTA.

### Step 1 — Inventory the Podia cohort in Stripe

> **For Claude:** Write `scripts/inventory-podia.ts`. Runs read-only against Stripe.

Pull all active subscriptions, expand the customer, and group by the Price ID. The Podia prices will be the ones that are *not* your new Job Club `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`.

For each row, record:
- `{ customerId, email, name, subscriptionId, currentPriceId, currentPriceAmount, currentPriceCurrency, nextBillingDate, status, planType }` where `planType` = "monthly" or "yearly" (inferred from the Price's `recurring.interval`).
- **Target Price lookup:** match `planType` → `STRIPE_PRICE_ID` or `STRIPE_PRICE_ID_YEARLY`.
- **Pricing-match check:** compare `currentPriceAmount` + `currentPriceCurrency` to the target Price. Record a `pricingMismatch: true/false` flag.

Output:
- `out/podia-cohort.json` — full array with the fields above.
- `out/pricing-mismatches.csv` — any row where `pricingMismatch === true`. **If this file is non-empty, halt** and review with Lucas before proceeding. Options: (a) update one side to match, (b) exclude mismatched rows from automated migration and handle manually, (c) accept the change and notify affected customers explicitly.
- Stdout summary: total count, breakdown by plan, breakdown by status (`active`, `past_due`, `canceled`, `trialing`), count of pricing mismatches.

Sanity-check: does the count roughly match your expected ~230?

### Step 2 — Dry-run the migration

> **For Claude:** Write `scripts/migrate-podia.ts --dry-run`.

For each row in `podia-cohort.json`:
- **Stripe-side idempotency check:** fetch the subscription; if `metadata.migrated_from_podia === 'true'`, **skip**.
- **DB-side idempotency check:** `User.findUnique({ email })`:
  - Exists with `stripeCustomerId` set → **skip** (already migrated or self-signed-up).
  - Exists without `stripeCustomerId` → **warn** (Lucas to review manually — likely a test/admin account sharing the email).
  - Does not exist → plan to **create**.
- Verify the target Price ID maps cleanly to the planType.
- Log the planned action per row; **do not write** to Stripe or DB in dry-run mode.

Review the dry-run output carefully before going live.

### Step 3 — Run the real migration

> **For Claude:** Same script, without `--dry-run`.

Per row, **Stripe first, DB second**, with idempotency checks at each step:

1. **Stripe:** Update the subscription (skip if already tagged as migrated):
   ```ts
   await stripe.subscriptions.update(subscriptionId, {
     items: [{ id: subscription.items.data[0].id, price: TARGET_PRICE_ID }],
     proration_behavior: 'none',
     billing_cycle_anchor: 'unchanged',
     metadata: { migrated_from_podia: 'true', migrated_at: isoNow },
   })
   ```
   The metadata write is the "transactional flag" — once set, re-runs skip this row on the Stripe side.

2. **DB:** Upsert `User` record (skip if already exists with `stripeCustomerId`):
   ```ts
   {
     email,
     name,
     passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12), // unusable — user will reset
     role: 'user',
     stripeCustomerId: customerId,
     subscriptionId: subscriptionId,
     subscriptionStatus: 'active',
     currentPeriodEnd: new Date(subscription.current_period_end * 1000),
     preferredLanguage: 'fr',
     onboardingCompleted: false,
   }
   ```
   If this step fails (e.g. DB connection blip), the Stripe side is already updated — re-running the script picks up where it left off because the Stripe check will skip but the DB check will still find the missing user and create it.

3. **Audit log:** Append to `out/migration-results.csv` — `email, customerId, subscriptionId, oldPriceId, newPriceId, stripeUpdateStatus (ok|skipped|failed), dbUpsertStatus (ok|skipped|failed), error`.

Rate-limit to ~5 req/sec to stay well under Stripe's limits. Errors → log, continue, review at end.

### Step 4 — Send migration welcome emails

> **For Claude:** Write `scripts/send-migration-emails.ts`.

For each row in `migration-results.csv` where both `stripeUpdateStatus` and `dbUpsertStatus` are `ok` or `skipped`:

1. Generate a `PasswordReset` token (reuse the existing model — 7-day expiry is fine for migration).
2. Send a bilingual email via Resend:
   - **Subject (FR):** `Bienvenue sur Job Club !` / **(EN):** `Welcome to Job Club!`
   - **Body:** Explains the platform switch, reassures that their subscription carries over, gives the password-setup link, points to support contact.
3. Rate-limit to ~2 emails/sec (Resend throttle buffer).

Log each send to `out/email-results.csv`.

### Step 5 — Parallel-run window (48–72 hours)

During this period:
- **Podia state:** ideally replace Podia course content with a "We've moved to thejobclub.com.au" landing page so users who log in out of habit get a clear signal. Verify in the Podia admin what you can actually do — if you can't replace content, at minimum post a banner in the community or course.
- **Monitor:**
  - Failed logins (Sentry).
  - Password-reset request volume (expected to spike).
  - Stripe webhook events for the migrated subscriptions (`invoice.paid`, `customer.subscription.updated`).
  - Support inbox + any WhatsApp/FB messages from subscribers.

### Step 6 — Follow-up email to non-logged-in users (~Day 7)

> **For Claude:** Write `scripts/followup-migration-emails.ts`.

Query for migrated users where `PasswordReset.used === false` AND `updatedAt` hasn't changed since migration (proxy for "never logged in"). Send a reminder email: "You haven't set up your password yet — here's a fresh link." Fresh 7-day token.

This catches spam-filter losses and genuinely disengaged subscribers before we decommission Podia.

### Step 7 — Decommission Podia

Once you're confident (>95% of users have logged in or at least opened the welcome email):
1. Confirm you have a fresh backup of Podia data (from Prerequisites).
2. Cancel the Podia subscription/plan.
3. Remove any redirects from Podia → Job Club.

---

## Edge Cases

| Case | Handling |
|------|---------|
| `past_due` subscription | Migrate as-is; the new Price takes effect, Stripe retries per dunning schedule. User gets welcome email; existing `past_due` banner shows on Job Club. |
| `canceled` but still in current period | Migrate user record but set `subscriptionStatus: 'canceled'`; don't update the subscription in Stripe. They can access until `currentPeriodEnd`. |
| `trialing` | Unlikely but possible. Default: skip, flag for manual review in Step 1 output. |
| Pricing mismatch (old Price amount ≠ new) | Halt migration; see Step 1 "Options." Never silently change a customer's billing amount. |
| Duplicate emails (same customer, two subs) | Log, skip automated handling, Lucas resolves manually. |
| Customer has no email on Stripe record | Skip; log for manual follow-up. |
| User already exists with `stripeCustomerId` set | Skip — already on Job Club via self-signup. |
| User already exists without `stripeCustomerId` | Warn, do not auto-merge. Likely admin/test account. |

---

## Verification

- [ ] **Step 0 diagnostic passes** on a single real subscription (write access + pricing match + metadata update).
- [ ] **Step 1 pricing-mismatch file is empty** (or all mismatches have been explicitly resolved).
- [ ] Inventory count matches expected ~230 (± expected churn since last check).
- [ ] Dry-run completes with zero unexpected errors.
- [ ] Real migration results CSV: every row is `ok` or `skipped`, any `failed` rows understood.
- [ ] Spot-check 5 migrated subscriptions in Stripe Dashboard: each references the new Price ID, has `migrated_from_podia: true` metadata, `current_period_end` unchanged from pre-migration.
- [ ] Spot-check: log in as 2–3 migrated users (after password reset) — feed loads, subscription banner shows "active," no paywall redirect.
- [ ] Welcome emails delivered (Resend dashboard + check a few real inboxes).
- [ ] No regression in Stripe webhook handler — `invoice.paid` on a migrated subscription correctly updates the user's `currentPeriodEnd`.
- [ ] Re-run the migration script: everything skips cleanly, no duplicate writes, no errors (proves idempotency).

---

## Risks & Rollback

### Primary risk: broken Stripe subscription state

If a subscription update fails mid-script and leaves DB + Stripe out of sync:
- `migration-results.csv` is the single source of truth for what happened.
- **Rollback per row**: re-point the Stripe subscription back to the original Podia Price ID using the `oldPriceId` column:
  ```ts
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: oldPriceId }],
    proration_behavior: 'none',
    billing_cycle_anchor: 'unchanged',
    metadata: { migrated_from_podia: null }, // clear the flag
  })
  ```
- Delete the User record if no meaningful data has been written (no saved jobs, no notifications).

### Secondary risk: Podia reacts badly to external subscription edits

Podia may detect that "their" subscription was changed and flag the account or cancel service. **Mitigation**: run the cutover close to when you plan to decommission Podia anyway — narrows the reaction window.

### Fallback plan: Cold migration

If Step 0 reveals we don't actually have write access (Stripe Connect restrictions) or pricing mismatches block the transfer approach, fall back to:
- Create users with `subscriptionStatus: 'active'` + 30-day grace period via `currentPeriodEnd`.
- Users re-subscribe through Stripe Checkout during the grace window.
- Cancel the Podia subscriptions in bulk at the end of the grace period.

Less elegant, more friction, higher churn — but always works. Keep it in your back pocket.

---

## File outputs

All scripts write to a gitignored `out/` directory:
- `out/podia-cohort.json` — inventory from Step 1.
- `out/pricing-mismatches.csv` — pricing-mismatch flags from Step 1 (should be empty to proceed).
- `out/migration-results.csv` — per-row migration outcomes from Step 3.
- `out/email-results.csv` — per-row welcome-email outcomes from Step 4.
- `out/followup-results.csv` — per-row follow-up email outcomes from Step 6.

Keep these files. They're your audit trail.
