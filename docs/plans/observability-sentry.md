# Observability — Sentry Integration

> **For Claude:** This is a feature plan. Use `feature-dev` to implement the Sentry SDK integration.

**Goal:** Integrate Sentry for error tracking so production bugs are caught and reported automatically instead of silently failing.

**Why this matters:** Moving from Podia (managed) to self-hosted means the team is now responsible for knowing when things break. With 230 paying subscribers, a silent 500 error on the feed page means lost trust and potential churn. Sentry catches these before users report them.

---

## Prerequisites

- [ ] Sentry account created (https://sentry.io — free tier covers this)
- [ ] Sentry project created for Next.js
- [ ] Sentry DSN obtained

---

## Steps

### Step 1: Create Sentry project

**Where:** Sentry Dashboard

1. Create a new project
2. **Platform:** Next.js
3. **Team:** Create or select team
4. Copy the **DSN** (`https://xxx@yyy.ingest.sentry.io/zzz`)

### Step 2: Install Sentry SDK

> **For Claude:** Use `feature-dev`

```bash
npx @sentry/wizard@latest -i nextjs
```

This wizard will:
- Install `@sentry/nextjs`
- Create `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Update `next.config.js` with Sentry webpack plugin
- Create `.sentryclirc` (add to `.gitignore`)

If the wizard doesn't work cleanly, install manually:
```bash
npm install @sentry/nextjs
```

### Step 3: Configure Sentry

**Files to create/modify:**

`sentry.client.config.ts`:
```typescript
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,  // 10% of transactions for performance monitoring
  replaysSessionSampleRate: 0,  // No session replays (saves quota)
  replaysOnErrorSampleRate: 1.0,  // Replay on errors
  environment: process.env.NODE_ENV,
})
```

`sentry.server.config.ts`:
```typescript
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
})
```

### Step 4: Add error boundary

> **For Claude:** Use `feature-dev`

Create `src/app/global-error.tsx` (Next.js App Router error boundary):
```typescript
'use client'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Une erreur est survenue</h2>
          <button onClick={reset}>Réessayer</button>
        </div>
      </body>
    </html>
  )
}
```

### Step 5: Add Sentry to API error handling

In key API routes, wrap catch blocks with `Sentry.captureException(error)`:
- `src/app/api/stripe/webhook/route.ts` — payment failures are critical
- `src/app/api/jobs/route.ts` — feed errors affect all users
- `src/app/api/register/route.ts` — registration failures lose users

### Step 6: Update environment variables

```bash
# .env.example
NEXT_PUBLIC_SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz
SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz

# .env.production (on VPS)
NEXT_PUBLIC_SENTRY_DSN=...
SENTRY_DSN=...
```

### Step 7: Set up Sentry alerts

**Where:** Sentry Dashboard → Alerts

Create alerts for:
- **New issues** → Email notification to Lucas
- **High-frequency errors** (>10 events in 1 hour) → Email notification
- **Stripe webhook errors** → Immediate email (tag these with `category: payment`)

### Step 8: Deploy and verify

```bash
cd /data/job-club
docker compose up -d --build
```

---

## Verification

- [ ] Sentry SDK loads without console errors
- [ ] Trigger a test error: visit a broken page → error appears in Sentry Dashboard
- [ ] Server-side errors (API routes) are captured
- [ ] Client-side errors (React components) are captured
- [ ] Source maps are uploaded (stack traces show original TypeScript, not minified JS)
- [ ] Alert emails are received when errors occur
- [ ] Performance traces appear in Sentry (sample of requests)

---

## Future Improvements (Post-Launch)

- **Uptime monitoring:** Use Sentry's uptime checks or a free service like UptimeRobot
- **Performance budgets:** Set alerts for slow API responses
- **Release tracking:** Tag deploys so errors are associated with specific releases
