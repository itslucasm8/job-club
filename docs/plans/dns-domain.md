# DNS & Domain Setup

> **For Claude:** This is an ops plan. Guide Lucas through the decision and DNS configuration. Requires Cloudflare Dashboard access.

**Goal:** Finalize the production domain and configure DNS + Cloudflare Tunnel so the app is reachable at its final URL.

**Why this matters:** The domain appears in every email, every Stripe redirect, every browser tab. Changing it after launch means updating Stripe webhooks, Resend settings, NextAuth config, and all email templates. Decide once, decide right.

---

## Prerequisites

- [ ] Cloudflare account with `mlfrance.dev` zone
- [ ] Cloudflare Zero Trust tunnel already configured (currently pointing to `jobclub.mlfrance.dev`)
- [ ] VPS running the app on port 3000

---

## Decision: Which domain?

Current setup: `jobclub.mlfrance.dev`

Options to consider:

| Option | Pros | Cons |
|--------|------|------|
| `jobclub.mlfrance.dev` | Already configured, keeps everything under MLF brand | Long subdomain, less "premium" feel |
| `jobclub.fr` (or similar) | Short, memorable, professional | Costs money, separate DNS zone to manage |
| `jobs.mlfrance.dev` | Shorter, still under MLF | Minor change |

**Recommendation:** Start with `jobclub.mlfrance.dev` for launch — it works today. Buy a custom domain later if the product grows. Changing later is work but not catastrophic.

---

## Steps

### Step 1: Confirm the domain choice

Decide between the options above. Everything below assumes `jobclub.mlfrance.dev` (update if different).

### Step 2: Verify Cloudflare Tunnel config

**Where:** Cloudflare Zero Trust → Tunnels

1. Find the tunnel serving Job Club
2. Verify the public hostname: `jobclub.mlfrance.dev`
3. Verify it routes to: `http://localhost:3000` (or `http://app:3000` if Docker network)
4. Ensure SSL/TLS is set to "Full (strict)" in Cloudflare

### Step 3: Update all references to the domain

These environment variables and configs must match the final domain:

```bash
# .env.production
NEXTAUTH_URL=https://jobclub.mlfrance.dev

# Stripe Dashboard
# - Webhook endpoint URL
# - Customer Portal redirect URL

# Resend
# - Sending domain must be verified (see resend-email-setup.md)
```

### Step 4: Verify HTTPS works

```bash
curl -I https://jobclub.mlfrance.dev
# Should return HTTP/2 200 with valid SSL
```

### Step 5: Test full auth flow with the production URL

1. Visit `https://jobclub.mlfrance.dev`
2. Register → Login → access feed
3. Check that NextAuth cookies are set for the correct domain
4. Check that Stripe redirects back to the correct URL after checkout

---

## Verification

- [ ] `https://jobclub.mlfrance.dev` loads the app with valid SSL
- [ ] `NEXTAUTH_URL` matches the domain exactly
- [ ] Stripe webhook URL matches the domain
- [ ] Resend sending domain is verified for this domain
- [ ] Auth flow works end-to-end (register, login, logout, password reset)
- [ ] No mixed-content warnings in browser console

---

## If Switching to a Custom Domain Later

1. Buy the domain
2. Add it to Cloudflare
3. Create a new Tunnel public hostname (or CNAME to the existing tunnel)
4. Update `NEXTAUTH_URL`, Stripe webhook, Resend domain
5. Set up a redirect from old domain → new domain (Cloudflare Page Rule)
6. Redeploy
