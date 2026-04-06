# Product Analytics

> **For Claude:** This is a feature plan. Use `feature-dev` to implement the analytics integration.

**Goal:** Understand how users interact with Job Club — which jobs they view, how often they visit, where they drop off — so Lucas can make informed product decisions.

**Why this matters:** Without analytics, every product decision is a guess. With 230 subscribers paying $40/month, knowing "80% of users never scroll past the first 10 jobs" or "nobody uses the saved jobs feature" changes priorities completely.

---

## Prerequisites

- [ ] Decision: which analytics tool (see recommendations below)
- [ ] Account created on chosen platform

---

## Tool Recommendation

| Tool | Cost | Privacy | Self-host? | Recommendation |
|------|------|---------|-----------|----------------|
| **Plausible** | $9/mo or self-host (free) | Privacy-first, no cookies | Yes (Docker) | Best fit — lightweight, GDPR-friendly, self-hostable |
| **PostHog** | Free tier (1M events/mo) | Configurable | Yes (Docker) | Best if you want feature flags + session replays later |
| **Google Analytics** | Free | Cookie consent needed | No | Overkill, privacy concerns for EU users |
| **Umami** | Self-host (free) | Privacy-first, no cookies | Yes (Docker) | Simpler than Plausible, good alternative |

**Recommendation:** Start with **Plausible** (self-hosted alongside the app) or **PostHog** (cloud free tier). Both are privacy-friendly — important since users are French and GDPR applies.

---

## Steps (using Plausible self-hosted as example)

### Step 1: Add Plausible to Docker Compose

> **For Claude:** Use `feature-dev`

Add Plausible services to `docker-compose.yml`:

```yaml
  plausible:
    image: ghcr.io/plausible/community-edition:v2
    restart: unless-stopped
    ports:
      - '8000:8000'
    environment:
      - BASE_URL=https://analytics.mlfrance.dev
      - SECRET_KEY_BASE=<generate-with-openssl-rand-base64-64>
      - DATABASE_URL=postgres://jobclub:${POSTGRES_PASSWORD}@db:5432/plausible
    depends_on:
      - db
```

Or use Plausible Cloud ($9/mo) to avoid self-hosting complexity.

### Step 2: Add the tracking script

> **For Claude:** Use `feature-dev`

In `src/app/layout.tsx`, add the Plausible script in `<head>`:

```tsx
<script
  defer
  data-domain="jobclub.mlfrance.dev"
  src="https://analytics.mlfrance.dev/js/script.js"
/>
```

**Important:** This is a no-cookie, privacy-respecting script. No consent banner needed.

### Step 3: Track custom events

> **For Claude:** Use `feature-dev`

Add event tracking for key user actions:

```typescript
// Helper function
function trackEvent(name: string, props?: Record<string, string>) {
  if (typeof window !== 'undefined' && (window as any).plausible) {
    (window as any).plausible(name, { props })
  }
}

// Track in components:
trackEvent('Job Viewed', { category: job.category, state: job.state })
trackEvent('Job Saved', { jobId: job.id })
trackEvent('Filter Applied', { type: 'state', value: 'QLD' })
trackEvent('Search Performed', { query: searchTerm })
```

Key events to track:
- **Job Viewed** (modal opened) — which jobs get attention?
- **Job Saved** — which jobs are most interesting?
- **Filter Applied** — which states/categories are popular?
- **Search Performed** — what are users looking for?
- **Subscribe Clicked** — conversion funnel
- **Settings Changed** — feature adoption

### Step 4: Set up a Cloudflare Tunnel for analytics (if self-hosted)

Add `analytics.mlfrance.dev` as another public hostname in Cloudflare Tunnel, pointing to `http://plausible:8000`.

### Step 5: Create a goals/conversions dashboard

**Where:** Plausible Dashboard

Set up goals:
1. **Subscription** — track visits to `/subscribe` → Stripe checkout
2. **Job Engagement** — track `Job Viewed` custom events
3. **Retention proxy** — track unique visitors per week

---

## Verification

- [ ] Analytics dashboard loads at chosen URL
- [ ] Page views are tracked (visit the app, check dashboard)
- [ ] Custom events fire (open a job modal, check dashboard for `Job Viewed` event)
- [ ] No cookies are set (verify in browser DevTools → Application → Cookies)
- [ ] Dashboard shows real-time visitors

---

## Key Metrics to Monitor Post-Launch

| Metric | Why it matters |
|--------|---------------|
| Daily active users | Are subscribers actually using the product? |
| Jobs viewed per session | Are users engaging with listings? |
| Save rate | Are jobs relevant enough to save? |
| Filter usage by state | Which states need more job coverage? |
| Bounce rate on feed | Is the feed experience good? |
| Subscription conversion | How many visitors convert to paid? |
