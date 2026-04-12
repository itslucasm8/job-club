# Onboarding Preferences + Welcome Notifications

**Date:** 2026-04-12
**Status:** Approved
**Summary:** Add a post-payment onboarding page where new subscribers pick their preferred states, categories, and 88-day toggle. Change notification behavior so users with no preferences get zero notifications instead of all. Create two welcome notifications on onboarding completion.

---

## Problem

New subscribers currently have no preferences set. The notification system treats this as "notify about everything" — flooding them with 20-30 notifications per day for every state and category. There's no onboarding step to guide them, and no way to discover the settings page organically.

## Solution

### 1. Post-Payment Onboarding Page

A new page at `/onboarding` shown once after successful Stripe payment. Single page with:

- Welcome heading (bilingual: FR/EN based on user's `preferredLanguage`)
- States selection — tappable chips or checkboxes for QLD, NSW, VIC, SA, WA, TAS, NT, ACT. At least 1 required.
- Categories selection — tappable chips or checkboxes for all 9 categories (farm, hospitality, construction, retail, cleaning, events, animals, transport, other). At least 1 required.
- 88-day toggle — "Only 88-day eligible jobs"
- "C'est parti!" / "Let's go!" button — saves preferences, sets `onboardingCompleted = true`, creates welcome notifications, redirects to `/feed`

The page follows existing app styling (brand purple, warm background, mobile-first).

### 2. Updated Payment Flow

```
Register → /subscribe → Stripe Payment → /subscribe?subscribed=true (2s buffer) → /onboarding → /feed
```

**Current flow:**
1. User pays on Stripe
2. Stripe redirects to `/subscribe?subscribed=true`
3. Subscribe page shows success message, waits 2 seconds
4. Redirects to `/feed?subscribed=true`

**New flow:**
1. User pays on Stripe (unchanged)
2. Stripe redirects to `/subscribe?subscribed=true` (unchanged)
3. Subscribe page shows success message, waits 2 seconds (unchanged — this buffers the webhook timing)
4. Redirects to `/onboarding` (changed from `/feed`)

**Why keep `/subscribe` as the buffer:** The Stripe `success_url` redirect and the `checkout.session.completed` webhook arrive in parallel. The webhook sets `subscriptionStatus: 'active'` in the DB but may arrive seconds after the browser redirect. The subscribe page's 2-second delay absorbs this race condition. By the time the user reaches `/onboarding`, the DB is updated and the JWT reflects the active subscription.

### 3. Notification Behavior Change

**Before:** No preferences = get ALL job notifications
**After:** No preferences = get ZERO job notifications

In `notifications.ts`, the fallback when `!hasStatePreference && !hasCategoryPreference` changes from `shouldNotify = true` to `shouldNotify = false`.

The settings page help text updates:
- FR: "Si aucune sélection, tu ne recevras aucune notification d'offre."
- EN: "If none selected, you won't receive any job notifications."

### 4. Welcome Notifications

Two in-app notifications created when the user completes the onboarding page:

| # | Type | Title (FR) | Title (EN) | Message (FR) | Message (EN) | Links to |
|---|------|-----------|-----------|-------------|-------------|----------|
| 1 | `welcome` | Bienvenue sur Job Club! | Welcome to Job Club! | Merci pour ton abonnement! Tu recevras des notifications pour les offres correspondant a tes preferences. | Thanks for subscribing! You'll receive notifications for jobs matching your preferences. | `/feed` |
| 2 | `welcome` | Personnalise tes alertes | Customize your alerts | Tu peux modifier tes preferences d'etat et de categorie a tout moment dans les reglages. | You can change your state and category preferences anytime in settings. | `/settings` |

These use a new notification type `welcome` (distinct from `new_job`) so they can be identified in the DB.

**Navigation fix:** The current Notification model only has `jobId` for linking — the notifications page navigates to `/feed` only when `jobId` is set. Welcome notifications have no job. A new optional `linkUrl` field is added to the Notification model so any notification can link to an arbitrary page. The notifications page checks `linkUrl` first, then falls back to `jobId`-based navigation.

### 5. Middleware Changes

The `onboardingCompleted` flag is added to the JWT token (same pattern as `subscriptionStatus`). Middleware logic:

- `/onboarding` is added to the matcher
- Active subscribers with `onboardingCompleted === false` are redirected to `/onboarding` when they try to access any protected route
- `/onboarding` itself is only accessible to active subscribers who haven't completed onboarding
- Users who have completed onboarding and try to visit `/onboarding` are redirected to `/feed`
- Admins bypass onboarding (same as paywall bypass)

### 6. Existing Users

All existing users (including Podia migration subscribers) need `onboardingCompleted` set to `true` so they aren't forced through the onboarding flow. This is done via a one-time migration:

```sql
UPDATE "User" SET "onboardingCompleted" = true WHERE "onboardingCompleted" = false;
```

Run after `prisma db push` applies the schema change.

---

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `onboardingCompleted Boolean @default(false)` to User model; add `linkUrl String?` to Notification model |
| `src/lib/auth.ts` | Add `onboardingCompleted` to JWT token callbacks + session |
| `src/middleware.ts` | Add `/onboarding` to matcher; redirect non-onboarded active users to `/onboarding` |
| `src/app/(app)/onboarding/page.tsx` | **New** — single-page preferences picker |
| `src/app/subscribe/page.tsx` | Change post-payment redirect from `/feed` to `/onboarding` |
| `src/lib/notifications.ts` | Line 50: change `shouldNotify = true` to `shouldNotify = false` |
| `src/lib/translations.ts` | Add onboarding page strings; update `notificationHelp` text |
| `src/app/api/user/settings/route.ts` | Handle `onboardingCompleted` flag; create welcome notifications on onboarding save |
| `src/app/(app)/settings/page.tsx` | Update help text display |
| `src/app/(app)/notifications/page.tsx` | Handle `linkUrl` navigation (check `linkUrl` first, fall back to `jobId`) |

## Edge Cases

- **User closes browser during onboarding:** `onboardingCompleted` is still `false`. Next time they log in and access any route, middleware redirects them back to `/onboarding`. Preferences from any partial save via the settings API are preserved.
- **User resubscribes after cancellation:** `onboardingCompleted` stays `true` from their first onboarding — they go straight to the feed. Their preferences are still saved.
- **Admin users:** Bypass onboarding redirect entirely (same as paywall bypass).
- **Webhook arrives late:** The `/subscribe` page 2-second buffer handles this. If the webhook is extremely delayed (>2s), the middleware would redirect to `/subscribe` since `subscriptionStatus` isn't `active` yet — same behavior as today.

## Out of Scope

- Multi-step wizard (decided: single page)
- Preferences during registration (decided: after payment)
- Sample/limited notifications for new users (decided: no notifications until preferences set)
- Guide/tips notification (decided: not included)
- Save feature tip notification (decided: not included)
