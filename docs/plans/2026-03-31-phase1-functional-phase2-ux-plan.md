# Job Club Phase 1 + Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close functional gaps (email alerts, notifications page, email opt-out) then polish UX/UI for a world-class feel on both mobile and desktop.

**Architecture:** Extend existing Next.js App Router patterns. Email alerts piggyback on existing `createJobNotifications()` in `src/lib/notifications.ts`. New notifications page follows existing page patterns in `src/app/(app)/`. UX polish is incremental CSS/component changes.

**Tech Stack:** Next.js 14, React 18, Prisma/PostgreSQL, Resend (email), TailwindCSS 3, Zod 4

**Important context:**
- Admin job editing/deactivation is ALREADY implemented (`/api/jobs/[id]` has GET/PUT/DELETE/PATCH, edit page exists at `admin/jobs/[id]/edit`, jobs list at `admin/jobs`)
- All UI is in French
- Existing email template helper: `getEmailTemplate(subject, content)` in `src/lib/email.ts`
- Existing notification system: `createJobNotifications(job)` in `src/lib/notifications.ts` creates DB records, called fire-and-forget from POST `/api/jobs`

---

## Phase 1: Functional Gaps

### Task 1: Add `emailAlerts` field to User model

**Files:**
- Modify: `prisma/schema.prisma:10-25` (User model)

**Step 1: Add the field to schema**

In `prisma/schema.prisma`, add to the User model after `preferredCategories`:

```prisma
emailAlerts          Boolean   @default(true)
```

**Step 2: Push schema change**

Run: `npx prisma db push`
Expected: Schema synced, no data loss (new column with default value)

**Step 3: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: Client regenerated with `emailAlerts` field

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add emailAlerts field to User model"
```

---

### Task 2: Add `sendJobAlertEmail` function

**Files:**
- Modify: `src/lib/email.ts` (add new export)

**Step 1: Add the email function**

Add after `sendSubscriptionConfirmation` in `src/lib/email.ts`:

```typescript
export async function sendJobAlertEmail(
  to: string,
  name: string,
  job: { title: string; company: string; state: string; category: string }
) {
  const resend = getResend()
  const baseUrl = process.env.NEXTAUTH_URL || 'https://jobclub.fr'

  const categoryLabels: Record<string, string> = {
    farm: 'Agriculture',
    hospitality: 'Hôtellerie',
    construction: 'Construction',
    trade: 'Métiers',
    retail: 'Commerce',
    cleaning: 'Nettoyage',
    other: 'Autre',
  }

  const content = `
    <div class="content">
      <p>Salut ${name || 'ami'},</p>
      <p>Une nouvelle offre correspond à tes critères !</p>
      <div style="background-color: #f3e8ff; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #1c1917;">${job.title}</p>
        <p style="margin: 0 0 4px 0; font-size: 14px; color: #57534e;">${job.company} — ${job.state}</p>
        <p style="margin: 0; font-size: 13px; color: #78716c;">${categoryLabels[job.category] || job.category}</p>
      </div>
      <div style="text-align: center;">
        <a href="${baseUrl}/feed" class="button">Voir l'offre</a>
      </div>
      <div class="divider"></div>
      <p style="font-size: 12px; color: #6b7280;">Tu peux désactiver les alertes email dans tes <a href="${baseUrl}/settings" style="color: #6b21a8;">paramètres</a>.</p>
    </div>
  `

  return resend.emails.send({
    from: FROM,
    to,
    subject: `Nouvelle offre : ${job.title}`,
    html: getEmailTemplate('Nouvelle offre', content),
  })
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add sendJobAlertEmail email template"
```

---

### Task 3: Wire email sending into notification system

**Files:**
- Modify: `src/lib/notifications.ts`

**Step 1: Update createJobNotifications to also send emails**

Replace the entire `src/lib/notifications.ts` with:

```typescript
import { prisma } from './prisma'
import { logger } from './logger'
import { sendJobAlertEmail } from './email'

export interface JobData {
  id: string
  title: string
  company: string
  state: string
  category: string
}

export async function createJobNotifications(job: JobData): Promise<void> {
  try {
    // Get all users with active subscriptions
    const users = await prisma.user.findMany({
      where: {
        subscriptionStatus: 'active',
      },
      select: {
        id: true,
        name: true,
        email: true,
        emailAlerts: true,
        preferredStates: true,
        preferredCategories: true,
      },
    })

    const notificationsToCreate = []
    const emailsToSend: { to: string; name: string }[] = []

    for (const user of users) {
      // Parse preferences
      const preferredStates = user.preferredStates
        ? user.preferredStates.split(',').map((s) => s.trim())
        : []
      const preferredCategories = user.preferredCategories
        ? user.preferredCategories.split(',').map((c) => c.trim())
        : []

      // Determine if user should be notified
      const hasStatePreference = preferredStates.length > 0
      const hasCategoryPreference = preferredCategories.length > 0

      let shouldNotify = false

      if (!hasStatePreference && !hasCategoryPreference) {
        shouldNotify = true
      } else if (hasStatePreference && !hasCategoryPreference) {
        shouldNotify = preferredStates.includes(job.state)
      } else if (!hasStatePreference && hasCategoryPreference) {
        shouldNotify = preferredCategories.includes(job.category)
      } else {
        const stateMatches = preferredStates.includes(job.state)
        const categoryMatches = preferredCategories.includes(job.category)
        shouldNotify = stateMatches && categoryMatches
      }

      if (shouldNotify) {
        notificationsToCreate.push({
          userId: user.id,
          type: 'new_job',
          title: `Nouvelle offre: ${job.title}`,
          message: `${job.company} — ${job.state}`,
          jobId: job.id,
        })

        // Queue email if user has email alerts enabled
        if (user.emailAlerts) {
          emailsToSend.push({ to: user.email, name: user.name || '' })
        }
      }
    }

    // Bulk create in-app notifications
    if (notificationsToCreate.length > 0) {
      await prisma.notification.createMany({
        data: notificationsToCreate,
      })
      logger.info('Job notifications created', {
        jobId: job.id,
        count: notificationsToCreate.length,
      })
    }

    // Send emails (fire-and-forget each one)
    if (emailsToSend.length > 0) {
      const emailPromises = emailsToSend.map(({ to, name }) =>
        sendJobAlertEmail(to, name, job).catch((err) => {
          logger.error('Failed to send job alert email', {
            jobId: job.id,
            to,
            error: String(err),
          })
        })
      )
      await Promise.allSettled(emailPromises)
      logger.info('Job alert emails sent', {
        jobId: job.id,
        attempted: emailsToSend.length,
      })
    }
  } catch (error) {
    logger.error('Failed to create job notifications', {
      jobId: job.id,
      error: String(error),
    })
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat: send email alerts when new jobs are published"
```

---

### Task 4: Add email alerts toggle to Settings page

**Files:**
- Modify: `src/app/api/user/settings/route.ts` (GET + PATCH to include emailAlerts)
- Modify: `src/app/(app)/settings/page.tsx` (add toggle UI)

**Step 1: Update the GET handler in `/api/user/settings`**

In `src/app/api/user/settings/route.ts`, add `emailAlerts: true` to the `select` object in the GET handler (line ~22), and include it in the response:

```typescript
// In GET handler select:
select: {
  id: true,
  name: true,
  email: true,
  emailAlerts: true,
  preferredStates: true,
  preferredCategories: true,
},
```

And in the GET response object, add:

```typescript
emailAlerts: user.emailAlerts,
```

**Step 2: Update the PATCH handler**

In the PATCH handler, add `emailAlerts` to the destructured body (line ~52):

```typescript
const {
  name,
  email,
  currentPassword,
  newPassword,
  preferredStates,
  preferredCategories,
  emailAlerts,
} = body
```

And add handling for it before the update (after the preferredCategories block, around line ~133):

```typescript
// Handle emailAlerts toggle
if (emailAlerts !== undefined) {
  updateData.emailAlerts = Boolean(emailAlerts)
}
```

And include it in the response:

```typescript
emailAlerts: updatedUser.emailAlerts,
```

Also add `emailAlerts: true` to the select in the update call.

**Step 3: Add toggle to Settings page**

In `src/app/(app)/settings/page.tsx`:

Add state variable after the preferences state block (~line 28):

```typescript
const [emailAlerts, setEmailAlerts] = useState(true)
```

In `fetchPreferences()`, add:

```typescript
setEmailAlerts(data.emailAlerts !== false)
```

In `handleSavePreferences()`, include emailAlerts in the body:

```typescript
body: JSON.stringify({ preferredStates, preferredCategories, emailAlerts }),
```

In the Preferences section JSX, add this toggle BEFORE the states checkboxes (after the italic `<p>` explanation text):

```tsx
{/* Email alerts toggle */}
<div className="flex items-center justify-between py-3 mb-4 border-b border-stone-100">
  <div>
    <div className="text-sm font-semibold text-stone-900">Alertes par email</div>
    <div className="text-xs text-stone-500">Recevoir un email à chaque nouvelle offre correspondante</div>
  </div>
  <button
    type="button"
    onClick={() => setEmailAlerts(!emailAlerts)}
    className={`relative w-11 h-6 rounded-full transition-colors ${
      emailAlerts ? 'bg-purple-600' : 'bg-stone-300'
    }`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
      emailAlerts ? 'translate-x-5' : 'translate-x-0'
    }`} />
  </button>
</div>
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/app/api/user/settings/route.ts src/app/(app)/settings/page.tsx
git commit -m "feat: add email alerts opt-out toggle to settings"
```

---

### Task 5: Create Notifications page

**Files:**
- Create: `src/app/(app)/notifications/page.tsx`
- Modify: `src/middleware.ts` (add route to matcher)
- Modify: `src/components/TopBar.tsx` (add "Voir tout" link)

**Step 1: Update notifications API to support pagination**

In `src/app/api/notifications/route.ts`, update the GET handler to accept `skip` and `take` query params:

Replace lines 22-29 (the findMany call) with:

```typescript
const { searchParams } = new URL(req.url)
const take = Math.min(parseInt(searchParams.get('take') || '20'), 50)
const skip = parseInt(searchParams.get('skip') || '0')

const [notifications, total] = await Promise.all([
  prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  }),
  prisma.notification.count({ where: { userId } }),
])
```

And update the job title fetching to work with `notifications` (same loop), then return:

```typescript
return NextResponse.json({ notifications: notificationsWithJobs, total })
```

**Step 2: Create the notifications page**

Create `src/app/(app)/notifications/page.tsx`:

```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  jobId: string | null
  read: boolean
  createdAt: string
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetchNotifications(0)
  }, [])

  async function fetchNotifications(skip: number) {
    try {
      const res = await fetch(`/api/notifications?skip=${skip}&take=20`)
      if (res.ok) {
        const data = await res.json()
        if (skip === 0) {
          setNotifications(data.notifications)
        } else {
          setNotifications(prev => [...prev, ...data.notifications])
        }
        setTotal(data.total)
      }
    } catch {
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function markAllRead() {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    } catch {}
  }

  async function handleClick(notif: Notification) {
    if (!notif.read) {
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [notif.id] }),
        })
        setNotifications(prev =>
          prev.map(n => (n.id === notif.id ? { ...n, read: true } : n))
        )
      } catch {}
    }
    if (notif.jobId) {
      router.push('/feed')
    }
  }

  function loadMore() {
    setLoadingMore(true)
    fetchNotifications(notifications.length)
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}j`
    return `${Math.floor(days / 7)}sem`
  }

  const unreadCount = notifications.filter(n => !n.read).length
  const hasMore = notifications.length < total

  if (loading) {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-2xl">
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-white border border-stone-200 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-stone-500 mt-1">{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-purple-600 font-medium hover:text-purple-800 transition"
          >
            Tout marquer lu
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-stone-400">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
          </div>
          <p className="text-stone-500 text-sm mb-2">Aucune notification pour le moment</p>
          <p className="text-stone-400 text-xs">Configure tes préférences dans les <button onClick={() => router.push('/settings')} className="text-purple-600 hover:underline">paramètres</button> pour recevoir des alertes.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notif => (
            <button
              key={notif.id}
              onClick={() => handleClick(notif)}
              className={`w-full text-left px-4 py-3.5 rounded-xl border transition hover:shadow-sm ${
                !notif.read
                  ? 'bg-purple-50/60 border-purple-200 hover:bg-purple-50'
                  : 'bg-white border-stone-200 hover:bg-stone-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                  !notif.read ? 'bg-purple-500' : 'bg-transparent'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-stone-900">{notif.title}</div>
                    <div className="text-[11px] text-stone-400 flex-shrink-0">{timeAgo(notif.createdAt)}</div>
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">{notif.message}</div>
                </div>
              </div>
            </button>
          ))}

          {hasMore && (
            <div className="text-center pt-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 rounded-lg text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 transition disabled:opacity-50"
              >
                {loadingMore ? 'Chargement...' : 'Voir plus'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

**Step 3: Add route to middleware matcher**

In `src/middleware.ts`, add `/notifications/:path*` to the matcher array:

```typescript
export const config = {
  matcher: ['/feed/:path*', '/states/:path*', '/job/:path*', '/profile/:path*', '/admin/:path*', '/saved/:path*', '/settings/:path*', '/guide/:path*', '/notifications/:path*'],
}
```

**Step 4: Add "Voir tout" link to TopBar dropdown**

In `src/components/TopBar.tsx`, add after the notifications map loop (after the closing of the `.map()` block, before the closing `</div>` of `max-h-80`):

```tsx
{notifications.length > 0 && (
  <button
    onClick={() => { setShowDropdown(false); router.push('/notifications') }}
    className="w-full text-center py-2.5 text-xs font-medium text-purple-600 hover:bg-stone-50 transition border-t border-stone-100"
  >
    Voir tout
  </button>
)}
```

**Step 5: Update TopBar to handle new API response shape**

The notifications API now returns `{ notifications, total }` instead of a flat array. Update `fetchNotifications` in TopBar.tsx:

```typescript
async function fetchNotifications() {
  try {
    const res = await fetch('/api/notifications?take=20')
    if (res.ok) {
      const data = await res.json()
      setNotifications(data.notifications || data)
    }
  } catch {}
}
```

The `|| data` fallback ensures backward compatibility during development.

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 7: Commit**

```bash
git add src/app/(app)/notifications/page.tsx src/middleware.ts src/components/TopBar.tsx src/app/api/notifications/route.ts
git commit -m "feat: add notifications page with pagination and 'see all' link"
```

---

## Phase 2: UX/UI Polish

### Task 6: Global toast notification system

**Files:**
- Create: `src/components/Toast.tsx`
- Modify: `src/app/(app)/layout.tsx` (add toast provider)

**Step 1: Create Toast component with context**

Create `src/components/Toast.tsx`:

```tsx
'use client'
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up ${
              t.type === 'success' ? 'bg-green-600 text-white' :
              t.type === 'error' ? 'bg-red-600 text-white' :
              'bg-stone-800 text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
```

**Step 2: Add slide-up animation to globals.css**

In `src/app/globals.css`, add:

```css
@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-slide-up {
  animation: slide-up 0.2s ease-out;
}
```

**Step 3: Wrap app layout with ToastProvider**

In `src/app/(app)/layout.tsx`, import and wrap children with `<ToastProvider>`:

```tsx
import { ToastProvider } from '@/components/Toast'
```

Wrap the content area with `<ToastProvider>{children}</ToastProvider>`.

**Step 4: Commit**

```bash
git add src/components/Toast.tsx src/app/globals.css src/app/(app)/layout.tsx
git commit -m "feat: add global toast notification system"
```

---

### Task 7: Add toast feedback to save/unsave actions

**Files:**
- Modify: `src/components/JobCard.tsx` (add useToast)
- Modify: `src/components/JobModal.tsx` (add useToast)

**Step 1: Update JobCard to show toast on save/unsave**

Import `useToast` and call `toast('success', 'Offre sauvegardée')` or `toast('success', 'Offre retirée')` after successful toggle. On failure, call `toast('error', 'Erreur lors de la sauvegarde')`.

**Step 2: Do the same in JobModal if it has a save action**

**Step 3: Commit**

```bash
git add src/components/JobCard.tsx src/components/JobModal.tsx
git commit -m "feat: add toast feedback for save/unsave job actions"
```

---

### Task 8: Smooth animations for modal and notification dropdown

**Files:**
- Modify: `src/components/JobModal.tsx` (add entrance/exit animation)
- Modify: `src/components/TopBar.tsx` (add dropdown animation)
- Modify: `src/app/globals.css` (add animation keyframes)

**Step 1: Add keyframes to globals.css**

```css
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide-up-modal {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dropdown-enter {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.animate-fade-in { animation: fade-in 0.15s ease-out; }
.animate-slide-up-modal { animation: slide-up-modal 0.25s ease-out; }
.animate-dropdown-enter { animation: dropdown-enter 0.15s ease-out; }
```

**Step 2: Apply animations**

In `JobModal.tsx`: Add `animate-fade-in` to the overlay backdrop div, and `animate-slide-up-modal` to the modal content div.

In `TopBar.tsx`: Add `animate-dropdown-enter` to the dropdown container div.

**Step 3: Commit**

```bash
git add src/components/JobModal.tsx src/components/TopBar.tsx src/app/globals.css
git commit -m "feat: add smooth entrance animations to modal and dropdown"
```

---

### Task 9: Responsive improvements — Desktop

**Files:**
- Modify: `src/components/Sidebar.tsx` (collapsible states, refined spacing)
- Modify: `src/components/JobModal.tsx` (wider on desktop)
- Modify: `src/app/(app)/settings/page.tsx` (centered card on wide screens)

**Step 1: Widen modal on desktop**

In `JobModal.tsx`, change the modal container max-width class from `max-w-xl` to `max-w-xl lg:max-w-2xl`.

**Step 2: Center settings on desktop**

In `src/app/(app)/settings/page.tsx`, change the outer div from `max-w-lg` to `max-w-lg mx-auto`.

**Step 3: Make sidebar states collapsible**

In `Sidebar.tsx`, add a `showStates` toggle state. Wrap the states list in a collapsible section with a clickable header that shows/hides the list. Use a chevron icon that rotates.

**Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/components/JobModal.tsx src/app/(app)/settings/page.tsx
git commit -m "feat: desktop responsive improvements — wider modal, centered settings, collapsible sidebar states"
```

---

### Task 10: Responsive improvements — Mobile

**Files:**
- Modify: `src/components/TopBar.tsx` (full-width dropdown on mobile)
- Modify: `src/app/(app)/feed/page.tsx` (fade gradient on filter scroll edges)

**Step 1: Make notification dropdown full-width on mobile**

In `TopBar.tsx`, change the dropdown div class from `w-80` to `w-80 sm:w-80` and add mobile override: `max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:w-auto`.

**Step 2: Add fade gradient on filter chip scroll containers**

In `feed/page.tsx`, wrap each scrollable chip row in a container div with relative positioning and add pseudo-element fade gradients using Tailwind:

```tsx
<div className="relative">
  <div className="overflow-x-auto scrollbar-none flex gap-2 px-4 sm:px-5 lg:px-7">
    {/* chips */}
  </div>
  <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-stone-100 to-transparent pointer-events-none" />
</div>
```

**Step 3: Commit**

```bash
git add src/components/TopBar.tsx src/app/(app)/feed/page.tsx
git commit -m "feat: mobile responsive — full-width notifications, fade scroll indicators"
```

---

### Task 11: Structured skeleton loaders

**Files:**
- Create: `src/components/JobCardSkeleton.tsx`
- Modify: `src/app/(app)/feed/page.tsx` (use new skeleton)
- Modify: `src/app/(app)/saved/page.tsx` (use new skeleton)

**Step 1: Create skeleton component**

Create `src/components/JobCardSkeleton.tsx`:

```tsx
export default function JobCardSkeleton() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden animate-pulse">
      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="h-4 bg-stone-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-stone-100 rounded w-1/2" />
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-stone-100">
        <div className="flex gap-2">
          <div className="h-6 bg-stone-100 rounded-full w-16" />
          <div className="h-6 bg-stone-100 rounded-full w-20" />
          <div className="h-6 bg-stone-100 rounded-full w-14" />
        </div>
      </div>
      <div className="px-4 py-2.5 bg-stone-50/50 border-t border-stone-100">
        <div className="h-3 bg-stone-100 rounded w-24" />
      </div>
    </div>
  )
}
```

**Step 2: Replace skeleton placeholders in feed and saved pages**

Import `JobCardSkeleton` and replace the `h-52 rounded-xl bg-white border animate-pulse` divs with `<JobCardSkeleton />`.

**Step 3: Commit**

```bash
git add src/components/JobCardSkeleton.tsx src/app/(app)/feed/page.tsx src/app/(app)/saved/page.tsx
git commit -m "feat: structured skeleton loaders for job cards"
```

---

### Task 12: Password show/hide toggle and consistent polish

**Files:**
- Modify: `src/app/(app)/settings/page.tsx` (add show/hide toggle to password fields)
- Modify: `src/app/(auth)/login/page.tsx` (add show/hide toggle)
- Modify: `src/app/(auth)/register/page.tsx` (add show/hide toggle)

**Step 1: Add toggle to all password fields**

For each password input, wrap it in a relative div and add an eye icon button:

```tsx
<div className="relative">
  <input
    type={showPassword ? 'text' : 'password'}
    // ... existing props
  />
  <button
    type="button"
    onClick={() => setShowPassword(!showPassword)}
    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition"
  >
    {showPassword ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )}
  </button>
</div>
```

Add state: `const [showPassword, setShowPassword] = useState(false)` (one per distinct password field group).

**Step 2: Commit**

```bash
git add src/app/(app)/settings/page.tsx src/app/(auth)/login/page.tsx src/app/(auth)/register/page.tsx
git commit -m "feat: add password show/hide toggle to all password fields"
```

---

### Task 13: Build verification

**Step 1: Run full build**

Run: `npx next build`
Expected: Build succeeds with no errors

**Step 2: Fix any build errors**

Address any TypeScript or build errors that arise.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: fix any build issues from phase 1+2 implementation"
```
