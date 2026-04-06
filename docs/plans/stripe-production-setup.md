# Stripe Production Setup

> **For Claude:** This is an ops/config plan. Guide Lucas through each step interactively. Some steps require Stripe Dashboard access.

**Goal:** Switch from Stripe test mode to live mode so real payments work on launch day.

**Why this matters:** Without live Stripe keys, no one can subscribe. This is the #1 blocker for revenue.

---

## Prerequisites

- [ ] Stripe account created (https://dashboard.stripe.com)
- [ ] Business details verified in Stripe (address, bank account for payouts)
- [ ] Access to the VPS at `/data/job-club/.env.production`

---

## Steps

### Step 1: Create the live Product and Prices

**Where:** Stripe Dashboard → Products

1. Toggle off "Test mode" (top-right switch)
2. Create a new Product:
   - **Name:** `Job Club — Abonnement`
   - **Description:** `Accès illimité aux offres d'emploi pour backpackers en Australie`
3. Add two Prices:
   - **Monthly:** $39.99 AUD / month, recurring
   - **Yearly:** ~$400 AUD / year, recurring (exact price TBD)
4. Copy both `price_xxx` IDs

**Output needed:** `STRIPE_PRICE_ID` (monthly) and `STRIPE_PRICE_ID_YEARLY` (yearly)

### Step 2: Get live API keys

**Where:** Stripe Dashboard → Developers → API keys

1. Copy the **Publishable key** (`pk_live_...`)
2. Copy the **Secret key** (`sk_live_...`) — show once, save immediately

**Output needed:** `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY`

### Step 3: Set up the Webhook endpoint

**Where:** Stripe Dashboard → Developers → Webhooks

1. Click "Add endpoint"
2. **Endpoint URL:** `https://jobclub.mlfrance.dev/api/stripe/webhook`
   - (Update this URL once DNS/domain is finalized — see `dns-domain.md`)
3. **Events to listen for:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`)

**Output needed:** `STRIPE_WEBHOOK_SECRET`

### Step 4: Configure Customer Portal

**Where:** Stripe Dashboard → Settings → Billing → Customer portal

1. Enable: Cancel subscription, Update payment method, View invoices
2. Set branding (logo, colors) to match Job Club
3. Set redirect URL: `https://jobclub.mlfrance.dev/settings`

### Step 5: Update production environment

**Where:** VPS at `/data/job-club/.env.production`

```bash
# SSH into VPS, then:
nano /data/job-club/.env.production

# Update these values:
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...          # monthly
STRIPE_PRICE_ID_YEARLY=price_...   # yearly
```

### Step 6: Redeploy and verify

```bash
cd /data/job-club
docker compose up -d --build
docker compose logs -f app  # Watch for Stripe errors
```

---

## Verification

- [ ] Visit `/subscribe` — checkout button redirects to Stripe with correct price
- [ ] Complete a test purchase with a real card (refund after)
- [ ] Webhook fires: check `docker compose logs -f app` for `checkout.session.completed`
- [ ] User gets `subscriptionStatus: 'active'` in the database
- [ ] Customer Portal works from `/settings` → "Gérer mon abonnement"
- [ ] Cancel subscription via portal → webhook fires → user loses access

---

## Rollback

If something goes wrong, revert `.env.production` to test keys and redeploy. Test mode and live mode are fully independent in Stripe.
