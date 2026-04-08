# Observability & Analytics Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Sentry (error monitoring) and PostHog (product analytics) integrations so every API error is captured and every key user action is tracked.

**Architecture:** Three workstreams: (1) PostHog user identification + event tracking, (2) Sentry error capture on all API routes, (3) Sentry environment tagging + user context. A single `UserIdentifier` client component handles both PostHog `identify()` and Sentry `setUser()`, rendered inside the `(app)` layout where both `SessionProvider` and `PostHogProvider` are available.

**Tech Stack:** Next.js 14, `@sentry/nextjs`, `posthog-js`, NextAuth v4

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/components/UserIdentifier.tsx` | Client component: calls `posthog.identify()` + `Sentry.setUser()` when session is available |
| Modify | `src/app/(app)/layout.tsx` | Render `UserIdentifier` inside the authenticated layout |
| Modify | `sentry.server.config.ts` | Add `environment` tag |
| Modify | `sentry.edge.config.ts` | Add `environment` tag |
| Modify | `src/instrumentation-client.ts` | Add `environment` tag |
| Modify | `src/app/(auth)/register/page.tsx` | Fire `user_registered` PostHog event on successful signup |
| Modify | `src/app/(auth)/login/page.tsx` | Fire `user_logged_in` PostHog event on successful login |
| Modify | `src/app/(app)/feed/page.tsx` | Fire `subscription_started` event when `?subscribed=true`, and `search_performed` / `filter_applied` events |
| Modify | `src/app/api/stripe/checkout/route.ts` | Wrap in try-catch + `Sentry.captureException` |
| Modify | `src/app/api/stripe/portal/route.ts` | Wrap in try-catch + `Sentry.captureException` |
| Modify | `src/app/api/admin/dashboard/route.ts` | Wrap in try-catch + `Sentry.captureException` |
| Modify | `src/app/api/admin/jobs/route.ts` | Replace `console.error` with `Sentry.captureException` |
| Modify | `src/app/api/admin/users/route.ts` | Wrap in try-catch + `Sentry.captureException` |
| Modify | `src/app/api/auth/check/route.ts` | Wrap in try-catch + `Sentry.captureException` |
| Modify | `src/app/api/auth/reset-password/route.ts` | Replace `console.error` with `Sentry.captureException` |
| Modify | `src/app/api/auth/reset-password/confirm/route.ts` | Replace `console.error` with `Sentry.captureException` |
| Modify | `src/app/api/notifications/route.ts` | Add `Sentry.captureException` alongside logger |
| Modify | `src/app/api/cron/expire-jobs/route.ts` | Add `Sentry.captureException` alongside logger |
| Modify | `src/app/api/jobs/[id]/route.ts` | Add `Sentry.captureException` alongside logger |
| Modify | `src/app/api/jobs/[id]/save/route.ts` | Replace `console.error` with `Sentry.captureException` |
| Modify | `src/app/api/jobs/saved/route.ts` | Wrap in try-catch + `Sentry.captureException` |
| Modify | `src/app/api/extract/route.ts` | Add `Sentry.captureException` to catch block |
| Modify | `src/app/api/user/settings/route.ts` | Replace `console.error` with `Sentry.captureException` |
| Modify | `src/app/api/feed/stats/route.ts` | Add `Sentry.captureException` alongside logger |

---

## Task 1: Sentry Environment Tagging

Add `environment` to all three Sentry init configs so errors are tagged as `production`, `development`, etc.

**Files:**
- Modify: `sentry.server.config.ts`
- Modify: `sentry.edge.config.ts`
- Modify: `src/instrumentation-client.ts`

- [ ] **Step 1: Add environment to server config**

In `sentry.server.config.ts`, add the `environment` field:

```ts
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.NODE_ENV || "development",

  sendDefaultPii: true,
  tracesSampleRate: 0.1,

  // Attach local variable values to stack frames for easier debugging
  includeLocalVariables: true,
})
```

- [ ] **Step 2: Add environment to edge config**

In `sentry.edge.config.ts`, add the `environment` field:

```ts
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.NODE_ENV || "development",

  sendDefaultPii: true,
  tracesSampleRate: 0.1,
})
```

- [ ] **Step 3: Add environment to client config**

In `src/instrumentation-client.ts`, add the `environment` field:

```ts
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.NODE_ENV || "development",

  sendDefaultPii: true,
  tracesSampleRate: 0.1,

  // Session Replay: skip baseline recording, but capture 100% of error sessions
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
})

// Track App Router page navigations
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds with no new errors.

- [ ] **Step 5: Commit**

```bash
git add sentry.server.config.ts sentry.edge.config.ts src/instrumentation-client.ts
git commit -m "feat: add environment tagging to all Sentry configs"
```

---

## Task 2: PostHog User Identification + Sentry User Context

Create a `UserIdentifier` component that reads the NextAuth session and calls both `posthog.identify()` and `Sentry.setUser()`. This component renders inside `(app)/layout.tsx` where both `SessionProvider` and `PostHogProvider` are ancestors.

**Files:**
- Create: `src/components/UserIdentifier.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Create UserIdentifier component**

Create `src/components/UserIdentifier.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { usePostHog } from 'posthog-js/react'
import * as Sentry from '@sentry/nextjs'

export default function UserIdentifier() {
  const { data: session } = useSession()
  const posthog = usePostHog()

  useEffect(() => {
    const user = session?.user as any
    if (!user?.id) {
      // User logged out — reset both
      posthog?.reset()
      Sentry.setUser(null)
      return
    }

    // Identify in PostHog
    if (posthog) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.name,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus,
      })
    }

    // Set user context in Sentry
    Sentry.setUser({
      id: user.id,
      email: user.email ?? undefined,
      username: user.name ?? undefined,
    })
  }, [session, posthog])

  return null
}
```

- [ ] **Step 2: Add UserIdentifier to (app) layout**

In `src/app/(app)/layout.tsx`, import and render the component inside `SessionProvider`:

```tsx
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/SessionProvider'
import UserIdentifier from '@/components/UserIdentifier'
import { ToastProvider } from '@/components/Toast'
import { AdminViewProvider } from '@/components/AdminViewContext'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import BottomTabs from '@/components/BottomTabs'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  return (
    <SessionProvider session={session}>
      <UserIdentifier />
      <AdminViewProvider>
        <ToastProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 min-w-0 flex flex-col">
              <TopBar />
              <main className="flex-1">{children}</main>
            </div>
          </div>
          <BottomTabs />
        </ToastProvider>
      </AdminViewProvider>
    </SessionProvider>
  )
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Manual test**

1. Start dev server (`npm run dev`)
2. Log in as any user
3. Open browser console, type `posthog.get_distinct_id()` — should return the user's ID, not an anonymous UUID
4. Check that no console errors appear

- [ ] **Step 5: Commit**

```bash
git add src/components/UserIdentifier.tsx src/app/\(app\)/layout.tsx
git commit -m "feat: add PostHog identify + Sentry user context on login"
```

---

## Task 3: PostHog Event — User Registration

Fire a `user_registered` event when a user successfully signs up.

**Files:**
- Modify: `src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Add PostHog import and capture event**

In `src/app/(auth)/register/page.tsx`, add the import at the top:

```tsx
import posthog from 'posthog-js'
```

Then inside `handleSubmit`, after the successful API response and before the `signIn` call (after line 35, before line 38), add:

```tsx
    // Track registration
    posthog.capture('user_registered')
```

The full `handleSubmit` becomes:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, preferredLanguage: language }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(translateApiError(data.error, t) || t.register.signupError)
      setLoading(false)
      return
    }

    // Track registration
    posthog.capture('user_registered')

    // Auto sign in
    const signInRes = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (signInRes?.error) {
      setError(t.register.autoLoginError)
    } else {
      router.push('/subscribe')
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(auth\)/register/page.tsx
git commit -m "feat: track user_registered event in PostHog"
```

---

## Task 4: PostHog Event — User Login

Fire a `user_logged_in` event when a user successfully logs in.

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Add PostHog import and capture event**

In `src/app/(auth)/login/page.tsx`, add the import at the top:

```tsx
import posthog from 'posthog-js'
```

Then inside `handleSubmit`, after the successful `signIn` and before the `router.push` (line 41), add the capture:

```tsx
    // Credentials valid — sign in via NextAuth
    const res = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (res?.error) {
      setError(t.login.connectionError)
    } else {
      posthog.capture('user_logged_in')
      router.push('/feed')
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(auth\)/login/page.tsx
git commit -m "feat: track user_logged_in event in PostHog"
```

---

## Task 5: PostHog Event — Subscription Started + Search/Filter Tracking

Track three events in the feed page:
- `subscription_started` — when user arrives with `?subscribed=true` (Stripe checkout success redirect)
- `search_performed` — when user searches for jobs
- `filter_applied` — when user changes state/category/88-day filters

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Add PostHog import**

In `src/app/(app)/feed/page.tsx`, add at the top with the other imports:

```tsx
import { usePostHog } from 'posthog-js/react'
```

- [ ] **Step 2: Add PostHog hook and subscription event**

Inside `FeedContent()`, after the existing state declarations (around line 47), add:

```tsx
  const posthog = usePostHog()
```

Then add a `useEffect` to capture the subscription event (after the stats fetch `useEffect`, around line 63):

```tsx
  // Track successful subscription from Stripe redirect
  useEffect(() => {
    if (searchParams.get('subscribed') === 'true' && posthog) {
      posthog.capture('subscription_started')
    }
  }, [searchParams, posthog])
```

- [ ] **Step 3: Add search tracking**

Find the search submission handler in the feed page. The search query is applied when `fetchJobs` is called with filters. Add a PostHog capture inside the `fetchJobs` callback, right after the fetch succeeds (after `const data = await res.json()`):

```tsx
      // Track search/filter usage
      if (posthog) {
        if (query) posthog.capture('search_performed', { query })
        if (state !== 'all' || category !== 'all' || only88Days) {
          posthog.capture('filter_applied', {
            state: state !== 'all' ? state : undefined,
            category: category !== 'all' ? category : undefined,
            only88Days: only88Days || undefined,
          })
        }
      }
```

Note: Only add the tracking call inside the `if (pageNum === 1)` branch to avoid double-counting on pagination. Check the exact structure of the fetchJobs callback to place this correctly — it should fire on fresh searches, not on "load more" scrolls.

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/feed/page.tsx
git commit -m "feat: track subscription, search, and filter events in PostHog"
```

---

## Task 6: Sentry Error Capture — Stripe Routes (Critical)

These handle payments. Errors here lose money silently.

**Files:**
- Modify: `src/app/api/stripe/checkout/route.ts`
- Modify: `src/app/api/stripe/portal/route.ts`

- [ ] **Step 1: Add Sentry to checkout route**

Replace the entire `src/app/api/stripe/checkout/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const user = await prisma.user.findUnique({ where: { id: (session.user as any).id } })
    if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    // Determine which plan was selected (monthly or yearly)
    let plan = 'monthly'
    try {
      const body = await req.json()
      if (body.plan === 'yearly') plan = 'yearly'
    } catch {
      // Default to monthly if no body provided
    }

    const priceId = plan === 'yearly'
      ? process.env.STRIPE_PRICE_ID_YEARLY!
      : process.env.STRIPE_PRICE_ID!

    const stripe = getStripe()

    let customerId = user.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })
      customerId = customer.id
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } })
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL}/feed?subscribed=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/subscribe?canceled=true`,
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'stripe-checkout' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Add Sentry to portal route**

Replace the entire `src/app/api/stripe/portal/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const user = await prisma.user.findUnique({ where: { id: (session.user as any).id } })
    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: 'Pas d\'abonnement trouvé' }, { status: 400 })
    }

    const stripe = getStripe()
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.NEXTAUTH_URL}/profile`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'stripe-portal' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/stripe/checkout/route.ts src/app/api/stripe/portal/route.ts
git commit -m "feat: add Sentry error capture to Stripe checkout and portal routes"
```

---

## Task 7: Sentry Error Capture — Admin Routes

**Files:**
- Modify: `src/app/api/admin/dashboard/route.ts`
- Modify: `src/app/api/admin/jobs/route.ts`
- Modify: `src/app/api/admin/users/route.ts`

- [ ] **Step 1: Add Sentry to admin dashboard**

In `src/app/api/admin/dashboard/route.ts`, add import at top:

```ts
import * as Sentry from '@sentry/nextjs'
```

Wrap the body of `GET()` in a try-catch. Keep the auth check outside the try-catch (it doesn't need error capture). After the auth check (line 10), wrap everything from `const now = new Date()` through the `return NextResponse.json(...)` in:

```ts
  try {
    // ... existing code from line 12 to line 84 ...
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-dashboard' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
```

- [ ] **Step 2: Add Sentry to admin jobs**

In `src/app/api/admin/jobs/route.ts`, add import:

```ts
import * as Sentry from '@sentry/nextjs'
```

Replace `console.error('GET /api/admin/jobs error:', e)` on line 18 with:

```ts
    Sentry.captureException(e, { tags: { route: 'admin-jobs' } })
```

- [ ] **Step 3: Add Sentry to admin users**

In `src/app/api/admin/users/route.ts`, add import:

```ts
import * as Sentry from '@sentry/nextjs'
```

Wrap the body of `GET()` (lines 13-18), `POST()` (lines 27-55), and `PATCH()` (lines 64-108) each in try-catch blocks:

For `GET()`:
```ts
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(users)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-users', method: 'GET' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

For `POST()`:
```ts
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const { email, password, name } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Mot de passe trop court (min 6 caractères)' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Un compte avec cet email existe déjà' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
        role: 'admin',
        subscriptionStatus: 'active',
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    })

    return NextResponse.json(user)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-users', method: 'POST' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

For `PATCH()`:
```ts
export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const body = await req.json()

    // Reset password for a user
    if (body.userId && body.newPassword) {
      if (body.newPassword.length < 6) {
        return NextResponse.json({ error: 'Mot de passe trop court (min 6 caractères)' }, { status: 400 })
      }
      const passwordHash = await bcrypt.hash(body.newPassword, 12)
      await prisma.user.update({
        where: { id: body.userId },
        data: { passwordHash },
      })
      return NextResponse.json({ success: true })
    }

    // Promote user to admin by email
    if (body.email && body.promoteToAdmin) {
      const user = await prisma.user.findUnique({ where: { email: body.email } })
      if (!user) {
        return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
      }
      if (user.role === 'admin') {
        return NextResponse.json({ error: 'Déjà administrateur' }, { status: 400 })
      }
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'admin' },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      })
      return NextResponse.json(updated)
    }

    // Change role
    const { userId, role } = body
    if (!userId || !['admin', 'user'].includes(role)) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, name: true, role: true },
    })

    return NextResponse.json(updated)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-users', method: 'PATCH' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/dashboard/route.ts src/app/api/admin/jobs/route.ts src/app/api/admin/users/route.ts
git commit -m "feat: add Sentry error capture to all admin API routes"
```

---

## Task 8: Sentry Error Capture — Auth Routes

**Files:**
- Modify: `src/app/api/auth/check/route.ts`
- Modify: `src/app/api/auth/reset-password/route.ts`
- Modify: `src/app/api/auth/reset-password/confirm/route.ts`

- [ ] **Step 1: Add Sentry to auth check**

Replace `src/app/api/auth/check/route.ts`:

```ts
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authLimiter } from '@/lib/rate-limit'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'FIELDS_REQUIRED' }, { status: 400 })
    }

    if (!authLimiter.check(email)) {
      return NextResponse.json({ error: 'RATE_LIMIT' }, { status: 429 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'EMAIL_NOT_FOUND' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'WRONG_PASSWORD' }, { status: 401 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'auth-check' } })
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Add Sentry to reset-password**

In `src/app/api/auth/reset-password/route.ts`, add import:

```ts
import * as Sentry from '@sentry/nextjs'
```

Replace `console.error('POST /api/auth/reset-password error:', e)` on line 57 with:

```ts
    Sentry.captureException(e, { tags: { route: 'reset-password' } })
```

- [ ] **Step 3: Add Sentry to reset-password confirm**

In `src/app/api/auth/reset-password/confirm/route.ts`, add import:

```ts
import * as Sentry from '@sentry/nextjs'
```

Replace `console.error('POST /api/auth/reset-password/confirm error:', e)` on line 70 with:

```ts
    Sentry.captureException(e, { tags: { route: 'reset-password-confirm' } })
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/check/route.ts src/app/api/auth/reset-password/route.ts src/app/api/auth/reset-password/confirm/route.ts
git commit -m "feat: add Sentry error capture to all auth API routes"
```

---

## Task 9: Sentry Error Capture — Remaining Routes

Add `Sentry.captureException` to all remaining API routes that have try-catch with logger/console.error but no Sentry.

**Files:**
- Modify: `src/app/api/notifications/route.ts`
- Modify: `src/app/api/cron/expire-jobs/route.ts`
- Modify: `src/app/api/jobs/[id]/route.ts`
- Modify: `src/app/api/jobs/[id]/save/route.ts`
- Modify: `src/app/api/jobs/saved/route.ts`
- Modify: `src/app/api/extract/route.ts`
- Modify: `src/app/api/user/settings/route.ts`
- Modify: `src/app/api/feed/stats/route.ts`

- [ ] **Step 1: notifications/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

Add `Sentry.captureException(e)` in both catch blocks (lines 55 and 121), right before the `logger.error` calls:

In GET catch (line 55):
```ts
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'notifications', method: 'GET' } })
    logger.error('GET /api/notifications failed', {
```

In PATCH catch (line 121):
```ts
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'notifications', method: 'PATCH' } })
    logger.error('PATCH /api/notifications failed', {
```

- [ ] **Step 2: cron/expire-jobs/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

Add `Sentry.captureException(e)` in the catch block (line 41):

```ts
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron-expire-jobs' } })
    logger.error('Cron expire-jobs failed', {
```

- [ ] **Step 3: jobs/[id]/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

Add `Sentry.captureException(e)` in all four catch blocks (GET, DELETE, PUT, PATCH), right before each `logger.error` call:

```ts
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'jobs-id' } })
    logger.error(...)
```

- [ ] **Step 4: jobs/[id]/save/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

Replace `console.error('POST /api/jobs/[id]/save error:', e)` on line 24 with:

```ts
    Sentry.captureException(e, { tags: { route: 'jobs-save' } })
```

- [ ] **Step 5: jobs/saved/route.ts**

Add import and wrap in try-catch. Replace entire file:

```ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const savedJobs = await prisma.savedJob.findMany({
      where: { userId: (session.user as any).id },
      include: { job: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(savedJobs.map(s => s.job))
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'jobs-saved' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

- [ ] **Step 6: extract/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

In the catch block at line 190, add Sentry capture before the existing error handling:

```ts
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return NextResponse.json({ error: 'Délai d\'attente dépassé' }, { status: 500 })
    }
    Sentry.captureException(e, { tags: { route: 'extract' } })
    return NextResponse.json({ error: "Impossible de lire cette URL" }, { status: 500 })
  }
```

- [ ] **Step 7: user/settings/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

Replace `console.error('GET /api/user/settings failed', e)` on line 42 with:
```ts
    Sentry.captureException(e, { tags: { route: 'user-settings', method: 'GET' } })
```

Replace `console.error('PATCH /api/user/settings failed', e)` on line 189 with:
```ts
    Sentry.captureException(e, { tags: { route: 'user-settings', method: 'PATCH' } })
```

- [ ] **Step 8: feed/stats/route.ts**

Add import: `import * as Sentry from '@sentry/nextjs'`

Add `Sentry.captureException(e)` in the catch block (line 52):

```ts
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'feed-stats' } })
    logger.error('GET /api/feed/stats failed', { route: '/api/feed/stats', error: String(e) })
```

- [ ] **Step 9: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds with no new errors.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/notifications/route.ts src/app/api/cron/expire-jobs/route.ts src/app/api/jobs/\[id\]/route.ts src/app/api/jobs/\[id\]/save/route.ts src/app/api/jobs/saved/route.ts src/app/api/extract/route.ts src/app/api/user/settings/route.ts src/app/api/feed/stats/route.ts
git commit -m "feat: add Sentry error capture to all remaining API routes"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `npm run build` succeeds
- [ ] All 20 API route files import `@sentry/nextjs` and call `Sentry.captureException` in catch blocks
- [ ] All three Sentry configs have `environment` field
- [ ] `UserIdentifier` component is rendered in `(app)/layout.tsx`
- [ ] PostHog events fire: `user_registered`, `user_logged_in`, `subscription_started`, `search_performed`, `filter_applied`
- [ ] No `console.error` calls remain in API routes (all replaced with Sentry)

## Coverage Summary

| Metric | Before | After |
|--------|--------|-------|
| API routes with Sentry | 3/20 | 20/20 |
| Sentry environment tagging | No | Yes |
| Sentry user context | No | Yes |
| PostHog user identification | No | Yes |
| PostHog custom events | 2 | 7 |
| `console.error` in routes | 6 | 0 |
