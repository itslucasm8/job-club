# Resend Email Setup

> **For Claude:** This is an ops/config plan. Guide Lucas through each step interactively. Requires Resend Dashboard and DNS access.

**Goal:** Verify a sending domain in Resend so transactional emails (welcome, password reset, job alerts) actually arrive in inboxes instead of spam.

**Why this matters:** Without domain verification, emails send from a shared domain and often land in spam. With 230 subscribers getting job alerts, deliverability is critical.

---

## Prerequisites

- [ ] Resend account created (https://resend.com)
- [ ] DNS access (Cloudflare or wherever `mlfrance.dev` is managed)
- [ ] Domain decision finalized (see `dns-domain.md`) — sending domain must match

---

## Steps

### Step 1: Add sending domain in Resend

**Where:** Resend Dashboard → Domains

1. Click "Add Domain"
2. Enter: `mlfrance.dev` (or the chosen subdomain like `mail.mlfrance.dev`)
3. Resend will show DNS records to add (DKIM, SPF, DMARC)

**Output needed:** List of DNS records (3-4 TXT/CNAME records)

### Step 2: Add DNS records

**Where:** Cloudflare Dashboard → DNS for `mlfrance.dev`

Add each record Resend provides. Typical records:
- **DKIM:** CNAME record (`resend._domainkey.mlfrance.dev` → Resend value)
- **SPF:** TXT record (usually `v=spf1 include:amazonses.com ~all` or Resend-specific)
- **DMARC:** TXT record (`v=DMARC1; p=none;`)

Wait for DNS propagation (usually 5-15 minutes, up to 48 hours).

### Step 3: Verify domain in Resend

**Where:** Resend Dashboard → Domains

1. Click "Verify" next to the domain
2. Resend checks DNS records
3. Status should change to "Verified"

If verification fails, double-check DNS records for typos.

### Step 4: Create API key

**Where:** Resend Dashboard → API Keys

1. Click "Create API Key"
2. **Name:** `job-club-production`
3. **Permission:** "Sending access" (not full access)
4. **Domain:** restrict to your verified domain
5. Copy the key (`re_...`)

**Output needed:** `RESEND_API_KEY`

### Step 5: Set the FROM address

Decide the sender identity:
- **Recommended:** `Job Club <noreply@mlfrance.dev>`
- **Alternative:** `Job Club <hello@mlfrance.dev>`

### Step 6: Update production environment

```bash
# SSH into VPS:
nano /data/job-club/.env.production

# Update:
RESEND_API_KEY=re_...
EMAIL_FROM="Job Club <noreply@mlfrance.dev>"
```

### Step 7: Redeploy and test

```bash
cd /data/job-club
docker compose up -d --build
```

---

## Verification

- [ ] Domain shows "Verified" in Resend Dashboard
- [ ] Register a test user → welcome email arrives (check inbox AND spam)
- [ ] Request password reset → reset email arrives with working link
- [ ] Post a job as admin → job alert emails send to matching subscribers
- [ ] Check email headers: DKIM and SPF both pass (open email → "Show original" in Gmail)

---

## Email Templates to Verify

All templates are in `src/lib/email.ts`. Each should render correctly:
1. **Welcome email** — `sendWelcomeEmail()` — sent on registration
2. **Password reset** — `sendPasswordResetEmail()` — sent on forgot password
3. **Subscription confirmation** — `sendSubscriptionConfirmation()` — sent after Stripe checkout
4. **Job alert** — `sendJobAlertEmail()` — sent when matching job is posted
