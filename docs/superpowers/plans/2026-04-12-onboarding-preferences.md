# Onboarding Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-payment onboarding page where new subscribers pick their preferences, change notification behavior so no preferences = no notifications, and create welcome notifications on onboarding completion.

**Architecture:** New `/onboarding` page inserted between Stripe payment and the feed. Middleware enforces the onboarding gate for active subscribers who haven't completed it. The existing settings API handles preferences save + welcome notification creation. A new `onboardingCompleted` flag on User and `linkUrl` on Notification are the only schema changes.

**Tech Stack:** Next.js 14 (App Router), Prisma, NextAuth JWT, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-12-onboarding-preferences-design.md`

---

### Task 1: Schema changes + migration

**Files:**
- Modify: `prisma/schema.prisma:11-30` (User model), `prisma/schema.prisma:65-77` (Notification model)

- [ ] **Step 1: Add `onboardingCompleted` to User model**

In `prisma/schema.prisma`, add after line 25 (`preferredLanguage`):

```prisma
  onboardingCompleted  Boolean   @default(false)
```

- [ ] **Step 2: Add `linkUrl` to Notification model**

In `prisma/schema.prisma`, add after line 71 (`jobId`):

```prisma
  linkUrl   String?
```

- [ ] **Step 3: Push schema to local DB**

Run: `npx prisma db push`

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 4: Set existing users as onboarded**

Run in a local psql or Prisma Studio:

```bash
npx prisma db execute --stdin <<< 'UPDATE "User" SET "onboardingCompleted" = true WHERE "onboardingCompleted" = false;'
```

This prevents existing users from being forced through onboarding.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add onboardingCompleted to User and linkUrl to Notification"
```

---

### Task 2: Add onboarding translations

**Files:**
- Modify: `src/lib/translations.ts:152` (FR notificationHelp), `src/lib/translations.ts:570` (before closing `}` of `fr`), `src/lib/translations.ts:712` (EN notificationHelp), `src/lib/translations.ts:1110` (before closing `}` of `en`)

- [ ] **Step 1: Update FR `notificationHelp` text**

In `src/lib/translations.ts`, replace line 152:

```typescript
    notificationHelp: 'Tu recevras des notifications pour les nouvelles offres correspondant à tes préférences. Si aucune sélection, tu ne recevras aucune notification d\'offre.',
```

- [ ] **Step 2: Add FR `onboarding` section**

In `src/lib/translations.ts`, insert before the closing `}` of the `fr` object (before the `legal` section, around line 525). Add after the `modeSwitch` section closing brace:

```typescript
  onboarding: {
    title: 'Bienvenue !',
    subtitle: 'Choisis tes préférences pour recevoir les offres qui te correspondent.',
    statesLabel: 'Dans quels états cherches-tu ?',
    statesRequired: 'Sélectionne au moins un état',
    categoriesLabel: 'Quel type de travail ?',
    categoriesRequired: 'Sélectionne au moins une catégorie',
    only88Days: 'Uniquement les offres 88 jours',
    only88DaysHelp: 'Ne recevoir que les offres éligibles aux 88 jours',
    submit: 'C\'est parti !',
    saving: 'Enregistrement...',
    error: 'Erreur lors de l\'enregistrement. Réessaie.',
  },
```

- [ ] **Step 3: Update EN `notificationHelp` text**

In `src/lib/translations.ts`, replace line 712:

```typescript
    notificationHelp: "You'll receive notifications for new jobs matching your preferences. If none selected, you won't receive any job notifications.",
```

- [ ] **Step 4: Add EN `onboarding` section**

In `src/lib/translations.ts`, insert in the `en` object at the same position (after `modeSwitch`):

```typescript
  onboarding: {
    title: 'Welcome!',
    subtitle: 'Choose your preferences to receive jobs that match what you\'re looking for.',
    statesLabel: 'Which states are you looking in?',
    statesRequired: 'Select at least one state',
    categoriesLabel: 'What type of work?',
    categoriesRequired: 'Select at least one category',
    only88Days: '88-day eligible jobs only',
    only88DaysHelp: 'Only receive notifications for 88-day qualifying jobs',
    submit: 'Let\'s go!',
    saving: 'Saving...',
    error: 'Error saving preferences. Please try again.',
  },
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/translations.ts
git commit -m "feat: add onboarding translations and update notification help text"
```

---

### Task 3: Update auth to carry `onboardingCompleted` in JWT

**Files:**
- Modify: `src/lib/auth.ts:25` (authorize return), `src/lib/auth.ts:33-34` (jwt callback user block), `src/lib/auth.ts:38` (jwt callback DB select), `src/lib/auth.ts:41` (jwt callback DB assignment), `src/lib/auth.ts:49-51` (session callback)

- [ ] **Step 1: Add `onboardingCompleted` to authorize return**

In `src/lib/auth.ts`, line 25, update the return object:

```typescript
        return { id: user.id, email: user.email, name: user.name, role: user.role, subscriptionStatus: user.subscriptionStatus, currentPeriodEnd: user.currentPeriodEnd, onboardingCompleted: user.onboardingCompleted }
```

- [ ] **Step 2: Add `onboardingCompleted` to JWT callback (user block)**

In `src/lib/auth.ts`, inside the `if (user)` block (after line 35), add:

```typescript
        token.onboardingCompleted = (user as any).onboardingCompleted
```

- [ ] **Step 3: Add `onboardingCompleted` to JWT callback (DB refresh)**

In `src/lib/auth.ts`, update the `select` on line 38 to include `onboardingCompleted`:

```typescript
        const dbUser = await prisma.user.findUnique({ where: { id: token.sub }, select: { subscriptionStatus: true, role: true, currentPeriodEnd: true, onboardingCompleted: true } })
```

And add after line 42 (inside the `if (dbUser)` block):

```typescript
          token.onboardingCompleted = dbUser.onboardingCompleted
```

- [ ] **Step 4: Add `onboardingCompleted` to session callback**

In `src/lib/auth.ts`, inside the session callback (after line 51), add:

```typescript
        ;(session.user as any).onboardingCompleted = token.onboardingCompleted
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: add onboardingCompleted to JWT token and session"
```

---

### Task 4: Update middleware for onboarding gate

**Files:**
- Modify: `src/middleware.ts:10-28` (prodMiddleware), `src/middleware.ts:33` (matcher)

- [ ] **Step 1: Add onboarding redirect logic**

In `src/middleware.ts`, replace the `prodMiddleware` function (lines 10-28) with:

```typescript
const prodMiddleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    logger.info('request', { route: path, user: token?.email as string })

    if (path.startsWith('/admin') && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/feed', req.url))
    }

    if (token?.subscriptionStatus !== 'active' && token?.subscriptionStatus !== 'past_due' && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/subscribe', req.url))
    }

    // Onboarding gate: active subscribers who haven't completed onboarding
    if (token?.role !== 'admin' && !token?.onboardingCompleted) {
      if (path !== '/onboarding') {
        return NextResponse.redirect(new URL('/onboarding', req.url))
      }
    }

    // Already onboarded users visiting /onboarding get sent to feed
    if (path === '/onboarding' && token?.onboardingCompleted) {
      return NextResponse.redirect(new URL('/feed', req.url))
    }

    return NextResponse.next()
  },
  { callbacks: { authorized: ({ token }) => !!token } }
)
```

- [ ] **Step 2: Add `/onboarding` to matcher**

In `src/middleware.ts`, update the matcher (line 33) to include `/onboarding`:

```typescript
  matcher: ['/feed/:path*', '/states/:path*', '/job/:path*', '/profile/:path*', '/admin/:path*', '/saved/:path*', '/settings/:path*', '/guide/:path*', '/notifications/:path*', '/privacy', '/terms', '/onboarding'],
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add onboarding gate to middleware"
```

---

### Task 5: Update subscribe page redirect

**Files:**
- Modify: `src/app/subscribe/page.tsx:33`

- [ ] **Step 1: Change post-payment redirect**

In `src/app/subscribe/page.tsx`, replace line 33:

```typescript
        router.push('/onboarding')
```

(Was `router.push('/feed')`)

- [ ] **Step 2: Commit**

```bash
git add "src/app/subscribe/page.tsx"
git commit -m "feat: redirect to onboarding after successful payment"
```

---

### Task 6: Update notification behavior

**Files:**
- Modify: `src/lib/notifications.ts:50`

- [ ] **Step 1: Change default notification behavior**

In `src/lib/notifications.ts`, replace line 50:

```typescript
      if (!hasStatePreference && !hasCategoryPreference) {
        shouldNotify = false
      } else if (hasStatePreference && !hasCategoryPreference) {
```

(Was `shouldNotify = true`)

- [ ] **Step 2: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "fix: no preferences means no job notifications instead of all"
```

---

### Task 7: Update notifications page to handle `linkUrl`

**Files:**
- Modify: `src/app/(app)/notifications/page.tsx:8` (interface), `src/app/(app)/notifications/page.tsx:59-74` (handleClick)

- [ ] **Step 1: Add `linkUrl` to the Notification interface**

In `src/app/(app)/notifications/page.tsx`, update the interface (line 7-15):

```typescript
interface Notification {
  id: string
  type: string
  title: string
  message: string
  jobId: string | null
  linkUrl: string | null
  read: boolean
  createdAt: string
}
```

- [ ] **Step 2: Update `handleClick` to use `linkUrl`**

In `src/app/(app)/notifications/page.tsx`, replace the navigation logic in `handleClick` (lines 72-74):

```typescript
    if (notif.linkUrl) {
      router.push(notif.linkUrl)
    } else if (notif.jobId) {
      router.push('/feed')
    }
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/notifications/page.tsx"
git commit -m "feat: support linkUrl navigation in notifications"
```

---

### Task 8: Update settings API to handle `onboardingCompleted` and welcome notifications

**Files:**
- Modify: `src/app/api/user/settings/route.ts:56-64` (destructure), `src/app/api/user/settings/route.ts:148-157` (after only88Days handling)

- [ ] **Step 1: Add `onboardingCompleted` to destructured body**

In `src/app/api/user/settings/route.ts`, update the destructuring (lines 56-64):

```typescript
    const {
      name,
      email,
      currentPassword,
      newPassword,
      preferredStates,
      preferredCategories,
      only88Days,
      onboardingCompleted,
    } = body
```

- [ ] **Step 2: Add onboarding handling logic**

In `src/app/api/user/settings/route.ts`, add after the language preference block (after line 157):

```typescript
    // Handle onboarding completion
    if (onboardingCompleted === true && !currentUser.onboardingCompleted) {
      updateData.onboardingCompleted = true

      // Create welcome notifications
      const lang = currentUser.preferredLanguage === 'en' ? 'en' : 'fr'
      const welcomeNotifications = lang === 'fr'
        ? [
            {
              userId,
              type: 'welcome',
              title: 'Bienvenue sur Job Club !',
              message: 'Merci pour ton abonnement ! Tu recevras des notifications pour les offres correspondant à tes préférences.',
              linkUrl: '/feed',
            },
            {
              userId,
              type: 'welcome',
              title: 'Personnalise tes alertes',
              message: 'Tu peux modifier tes préférences d\'état et de catégorie à tout moment dans les réglages.',
              linkUrl: '/settings',
            },
          ]
        : [
            {
              userId,
              type: 'welcome',
              title: 'Welcome to Job Club!',
              message: "Thanks for subscribing! You'll receive notifications for jobs matching your preferences.",
              linkUrl: '/feed',
            },
            {
              userId,
              type: 'welcome',
              title: 'Customize your alerts',
              message: 'You can change your state and category preferences anytime in settings.',
              linkUrl: '/settings',
            },
          ]

      await prisma.notification.createMany({ data: welcomeNotifications })
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/user/settings/route.ts
git commit -m "feat: handle onboardingCompleted flag and create welcome notifications"
```

---

### Task 9: Create the onboarding page

**Files:**
- Create: `src/app/(app)/onboarding/page.tsx`

- [ ] **Step 1: Create the onboarding page**

Create `src/app/(app)/onboarding/page.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { STATES, getCategories } from '@/lib/utils'
import { useTranslation } from '@/components/LanguageContext'

export default function OnboardingPage() {
  const router = useRouter()
  const { t, language } = useTranslation()
  const categories = getCategories(language)

  const [selectedStates, setSelectedStates] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [only88Days, setOnly88Days] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleState(code: string) {
    setSelectedStates(prev =>
      prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code]
    )
  }

  function toggleCategory(key: string) {
    setSelectedCategories(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    )
  }

  async function handleSubmit() {
    if (selectedStates.length === 0) {
      setError(t.onboarding.statesRequired)
      return
    }
    if (selectedCategories.length === 0) {
      setError(t.onboarding.categoriesRequired)
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredStates: selectedStates,
          preferredCategories: selectedCategories,
          only88Days,
          onboardingCompleted: true,
        }),
      })

      if (!res.ok) {
        setError(t.onboarding.error)
        setSaving(false)
        return
      }

      router.push('/feed')
    } catch {
      setError(t.onboarding.error)
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm-bg px-4 py-8 pb-24 lg:pb-10">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-purple-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7 text-purple-700">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-stone-900">{t.onboarding.title}</h1>
          <p className="text-sm text-stone-500 mt-2">{t.onboarding.subtitle}</p>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-sm">
          {/* States */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-stone-900 mb-3">{t.onboarding.statesLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {STATES.map(s => (
                <button
                  key={s.code}
                  onClick={() => toggleState(s.code)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                    selectedStates.includes(s.code)
                      ? 'bg-purple-700 text-white border-purple-700'
                      : 'bg-white text-stone-500 border-stone-200 hover:border-purple-300'
                  }`}
                >
                  {s.code}
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-stone-900 mb-3">{t.onboarding.categoriesLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {categories.filter(c => c.key !== 'all').map(c => (
                <button
                  key={c.key}
                  onClick={() => toggleCategory(c.key)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                    selectedCategories.includes(c.key)
                      ? 'bg-amber-400 text-stone-900 border-amber-400'
                      : 'bg-white text-stone-500 border-stone-200 hover:border-amber-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* 88 days toggle */}
          <div className="flex items-center justify-between py-3 mb-6 border-t border-stone-100">
            <div>
              <div className="text-sm font-semibold text-stone-900">{t.onboarding.only88Days}</div>
              <div className="text-xs text-stone-500">{t.onboarding.only88DaysHelp}</div>
            </div>
            <button
              type="button"
              onClick={() => setOnly88Days(!only88Days)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                only88Days ? 'bg-purple-600' : 'bg-stone-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                only88Days ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-3.5 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-800 transition disabled:opacity-50 disabled:cursor-not-allowed text-base"
          >
            {saving ? t.onboarding.saving : t.onboarding.submit}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/onboarding/page.tsx"
git commit -m "feat: add post-payment onboarding preferences page"
```

---

### Task 10: Update settings page help text

**Files:**
- Modify: `src/app/(app)/settings/page.tsx:434` (notificationHelp display)

- [ ] **Step 1: Verify help text renders correctly**

The settings page already uses `{t.settings.notificationHelp}` on line 435. Since we updated the translation string in Task 2, no code change is needed here. The updated text ("Si aucune sélection, tu ne recevras aucune notification d'offre") will render automatically.

No commit needed for this task — it was handled by the translation change in Task 2.

---

### Task 11: Verify notifications API returns `linkUrl`

**Files:**
- No changes needed: `src/app/api/notifications/route.ts`

The notifications API (`src/app/api/notifications/route.ts:28-33`) uses `prisma.notification.findMany()` with no explicit `select` — Prisma returns all fields by default. The `linkUrl` field will be included automatically after the schema change in Task 1. The spread on line 48 (`...notif`) passes it through to the response. No code changes required.

---

### Task 12: Manual testing + production deployment

- [ ] **Step 1: Test locally**

Start the dev server and DB:

```bash
docker compose up db -d
npm run dev
```

Test the full flow:
1. Register a new account
2. Go through subscribe (use Stripe test card)
3. Verify redirect lands on `/onboarding`
4. Pick states and categories, submit
5. Verify redirect to `/feed`
6. Check notifications bell — should see 2 welcome notifications
7. Tap each notification — verify they link to `/feed` and `/settings`
8. Visit `/onboarding` directly — should redirect to `/feed`
9. Go to Settings — verify updated help text
10. Create a new user with no preferences — verify they get zero job notifications

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Production deployment**

```bash
git push origin main
ssh root@72.61.120.170 "cd /data/job-club && git pull && docker compose up -d --build"
```

- [ ] **Step 4: Run migration on production DB**

```bash
ssh root@72.61.120.170 "cd /data/job-club && docker compose exec app npx prisma db push"
ssh root@72.61.120.170 "cd /data/job-club && docker compose exec db psql -U postgres -d jobclub -c 'UPDATE \"User\" SET \"onboardingCompleted\" = true WHERE \"onboardingCompleted\" = false;'"
```

This sets all existing users as onboarded so they go straight to the feed.
