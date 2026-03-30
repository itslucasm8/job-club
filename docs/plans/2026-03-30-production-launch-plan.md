# Job Club — Production Launch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Job Club demo into a production-ready paid job board that replaces Podia for French backpackers in Australia.

**Architecture:** Next.js 14 App Router with Prisma ORM, PostgreSQL, NextAuth JWT sessions, Stripe subscriptions, and Resend transactional emails. Deployed via Docker + Cloudflare Tunnel on Lucas's VPS.

**Tech Stack:** Next.js 14, React 18, TypeScript, Prisma 5, PostgreSQL, NextAuth v4, Stripe, Resend, Tailwind CSS 3, Zod, Docker

**Design doc:** `docs/plans/2026-03-30-production-launch-design.md`

---

## Phase 1: Foundation Hardening

---

### Task 1: PostgreSQL Migration

**Files:**
- Modify: `prisma/schema.prisma` (change datasource)
- Modify: `docker-compose.yml` (add postgres service)
- Modify: `.env.example` (update DATABASE_URL format)
- Modify: `Dockerfile` (no SQLite data dir needed)

**Step 1: Update Prisma schema datasource**

In `prisma/schema.prisma`, change:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Step 2: Update docker-compose.yml with Postgres service**

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: jobclub
      POSTGRES_USER: jobclub
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
    ports:
      - '5432:5432'

  app:
    build: .
    restart: unless-stopped
    ports:
      - '3000:3000'
    depends_on:
      - db
    environment:
      - DATABASE_URL=postgresql://jobclub:${POSTGRES_PASSWORD}@db:5432/jobclub
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - NEXTAUTH_URL=${NEXTAUTH_URL}
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - STRIPE_PRICE_ID=${STRIPE_PRICE_ID}
    env_file:
      - .env.production

volumes:
  pg-data:
```

**Step 3: Update .env.example**

```
DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub"
```

**Step 4: Update Dockerfile — remove SQLite data directory creation**

Remove the line `RUN mkdir -p /app/data && chown nextjs:nodejs /app/data` and the `db-data` volume reference.

**Step 5: Update local .env for development**

For local dev, use: `DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub"`
Run Postgres locally via Docker: `docker run -d --name jobclub-pg -e POSTGRES_DB=jobclub -e POSTGRES_USER=jobclub -e POSTGRES_PASSWORD=changeme -p 5432:5432 postgres:16-alpine`

**Step 6: Run Prisma migration**

```bash
npx prisma db push
npx tsx prisma/seed.ts
```

**Step 7: Verify the app runs against Postgres**

```bash
npm run dev
# Navigate to http://localhost:3000, login, verify jobs load
```

**Step 8: Commit**

```bash
git add prisma/schema.prisma docker-compose.yml .env.example Dockerfile
git commit -m "feat: migrate from SQLite to PostgreSQL"
```

---

### Task 2: Install Zod + Add Input Validation

**Files:**
- Create: `src/lib/validation.ts`
- Modify: `src/app/api/register/route.ts`
- Modify: `src/app/api/jobs/route.ts`
- Modify: `src/app/api/extract/route.ts`
- Modify: `package.json` (add zod dependency)

**Step 1: Install Zod**

```bash
npm install zod
```

**Step 2: Create validation schemas**

Create `src/lib/validation.ts`:

```typescript
import { z } from 'zod'

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'trade', 'retail', 'cleaning', 'other'] as const
const VALID_TYPES = ['casual', 'full_time', 'part_time', 'contract'] as const

export const registerSchema = z.object({
  name: z.string().min(1, 'Le prénom est requis').max(100),
  email: z.string().email('Email invalide'),
  password: z.string().min(6, 'Mot de passe: 6 caractères minimum').max(100),
})

export const createJobSchema = z.object({
  title: z.string().min(1, 'Titre requis').max(200),
  company: z.string().min(1, 'Entreprise requise').max(200),
  state: z.enum(VALID_STATES, { message: 'State invalide' }),
  location: z.string().max(200).default(''),
  category: z.enum(VALID_CATEGORIES, { message: 'Catégorie invalide' }),
  type: z.enum(VALID_TYPES).default('casual'),
  pay: z.string().max(100).optional(),
  description: z.string().min(1, 'Description requise').max(10000),
  applyUrl: z.string().url().optional().or(z.literal('')),
  sourceUrl: z.string().url().optional().or(z.literal('')),
})

export const extractSchema = z.object({
  url: z.string().url('URL invalide'),
})

export const jobQuerySchema = z.object({
  state: z.enum([...VALID_STATES, 'all']).default('all'),
  category: z.enum([...VALID_CATEGORIES, 'all']).default('all'),
  q: z.string().max(200).default(''),
  page: z.coerce.number().int().min(1).default(1),
})
```

**Step 3: Update API routes to use Zod schemas**

Update `src/app/api/register/route.ts` — replace manual validation with `registerSchema.safeParse(body)`.

Update `src/app/api/jobs/route.ts` — use `createJobSchema` for POST, `jobQuerySchema` for GET query params.

Update `src/app/api/extract/route.ts` — use `extractSchema` for POST body, add 10-second fetch timeout.

**Step 4: Verify all routes return proper validation errors**

Test with bad inputs (empty title, invalid state, password too short) and confirm structured JSON error responses.

**Step 5: Commit**

```bash
git add src/lib/validation.ts src/app/api/ package.json package-lock.json
git commit -m "feat: add Zod input validation to all API routes"
```

---

### Task 3: Remove Postuler Button

**Files:**
- Modify: `src/components/JobCard.tsx` (remove Postuler button)
- Modify: `src/components/JobModal.tsx` (remove Postuler button)
- Modify: `src/app/(app)/admin/page.tsx` (remove applyUrl field from form)

**Step 1: Update JobCard.tsx**

Remove the Postuler button entirely. The card footer should show only the Sauvegarder (save) heart icon.

**Step 2: Update JobModal.tsx**

Remove the Postuler button from the bottom of the modal. The modal still shows the full description (which contains contact info inline).

**Step 3: Update admin form**

Remove the "URL de candidature" (applyUrl) input field from the admin posting form. Keep sourceUrl as an internal reference for where the job was found.

**Step 4: Verify visually**

Run the app, check that cards and modals no longer show Postuler, admin form no longer has applyUrl field.

**Step 5: Commit**

```bash
git add src/components/JobCard.tsx src/components/JobModal.tsx src/app/\(app\)/admin/page.tsx
git commit -m "feat: remove Postuler button — contact info lives in description"
```

---

### Task 4: Login Error Feedback

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

**Step 1: Update login page to show error message**

The login page uses NextAuth's `signIn('credentials', ...)`. When it fails, NextAuth redirects to `/login?error=CredentialsSignin`. Parse the URL query param and display:

```tsx
// At top of component, read searchParams
const error = searchParams?.error

// In the JSX, above the form:
{error && (
  <p className="text-red-500 text-sm text-center bg-red-50 rounded-lg p-3">
    Email ou mot de passe incorrect
  </p>
)}
```

**Step 2: Verify**

Try logging in with wrong password, confirm error message appears.

**Step 3: Commit**

```bash
git add src/app/\(auth\)/login/page.tsx
git commit -m "fix: show error message on failed login"
```

---

### Task 5: Fix Sign-Out Page

**Files:**
- Create: `src/app/api/auth/signout/page.tsx` (custom sign-out page)
- Modify: `src/app/(app)/profile/page.tsx` (use custom signout flow)

**Step 1: Create custom sign-out flow**

Instead of routing to NextAuth's default `/api/auth/signout`, handle sign-out client-side using `signOut({ callbackUrl: '/' })` from next-auth/react. The "Se déconnecter" button on the profile page should call this directly, which signs out and redirects to the landing page without showing the ugly default page.

**Step 2: Verify**

Click "Se déconnecter" from profile page, confirm it signs out and redirects to landing page without showing the NextAuth default page.

**Step 3: Commit**

```bash
git add src/app/\(app\)/profile/page.tsx
git commit -m "fix: branded sign-out flow — skip NextAuth default page"
```

---

### Task 6: Stagger Seed Data Timestamps

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Update seed.ts**

Add staggered `createdAt` dates to each job. Spread jobs over the past 14 days so the feed looks natural:

```typescript
// Helper: date N days ago
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(Math.floor(Math.random() * 12) + 7) // 7am-7pm
  d.setMinutes(Math.floor(Math.random() * 60))
  return d
}

// Use in each job object:
{ ...jobData, createdAt: daysAgo(0) }   // today
{ ...jobData, createdAt: daysAgo(1) }   // yesterday
{ ...jobData, createdAt: daysAgo(3) }   // 3 days ago
// etc.
```

**Step 2: Reseed and verify**

```bash
npm run db:reset
npm run dev
# Check that feed shows varied timestamps: "2min", "5h", "1j", "3j", "1sem"
```

**Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "fix: stagger seed data timestamps over 14 days"
```

---

### Task 7: Multiple Admin Support

**Files:**
- Create: `src/app/api/admin/users/route.ts` (list users, promote/demote)
- Modify: `src/app/(app)/admin/page.tsx` (add user management tab)

**Step 1: Create admin users API**

`GET /api/admin/users` — returns list of all users (admin only)
`PATCH /api/admin/users` — body: `{ userId, role: 'admin' | 'user' }` — promote/demote user (admin only)

Both endpoints check `token.role === 'admin'` and return 403 if not.

**Step 2: Add user management section to admin page**

Add a tab or section below the job posting form that shows all registered users with a toggle to grant/revoke admin access. Only visible to existing admins.

**Step 3: Verify**

Login as admin, promote demo user to admin, login as demo user, confirm admin features appear.

**Step 4: Commit**

```bash
git add src/app/api/admin/users/route.ts src/app/\(app\)/admin/page.tsx
git commit -m "feat: admin user management — promote/demote users"
```

---

## Phase 2: Production Features

---

### Task 8: Saved Jobs View

**Files:**
- Create: `src/app/(app)/saved/page.tsx`
- Modify: `src/app/(app)/profile/page.tsx` (link to saved jobs page)
- Modify: `src/components/Sidebar.tsx` (add nav link)
- Modify: `src/app/(app)/layout.tsx` (if needed for routing)

**Step 1: Create saved jobs API endpoint**

`GET /api/jobs/saved` — returns jobs saved by the current user, with full job details.

```typescript
const savedJobs = await prisma.savedJob.findMany({
  where: { userId: session.user.id },
  include: { job: true },
  orderBy: { createdAt: 'desc' },
})
```

**Step 2: Create saved jobs page**

`src/app/(app)/saved/page.tsx` — fetches saved jobs and displays them in the same card grid as the feed. Shows an empty state ("Tu n'as pas encore sauvegardé d'offres") if none.

**Step 3: Wire up navigation**

- Profile page: "Mes offres sauvegardées" links to `/saved`
- Sidebar: add "Mes sauvegardes" nav item (heart icon)

**Step 4: Update profile stats**

Profile page currently shows hardcoded "0" for saved count. Fetch real count from API.

**Step 5: Verify**

Login, save a few jobs from feed, navigate to saved jobs page, confirm they appear. Unsave one, confirm it disappears.

**Step 6: Commit**

```bash
git add src/app/\(app\)/saved/ src/app/api/jobs/saved/ src/components/Sidebar.tsx src/app/\(app\)/profile/page.tsx
git commit -m "feat: saved jobs view — Mes offres sauvegardées"
```

---

### Task 9: Admin Job Management Dashboard

**Files:**
- Create: `src/app/(app)/admin/jobs/page.tsx`
- Create: `src/app/(app)/admin/jobs/[id]/edit/page.tsx`
- Create: `src/app/api/jobs/[id]/route.ts` (add PUT handler for edit)
- Modify: `src/components/Sidebar.tsx` (add admin nav links)

**Step 1: Create admin jobs list page**

`/admin/jobs` — table/list of all jobs (active and inactive), showing title, company, state, category, date, status. Includes search/filter and pagination.

**Step 2: Add edit job page**

`/admin/jobs/[id]/edit` — pre-populated form (same fields as create), saves via `PUT /api/jobs/[id]`.

**Step 3: Add PUT handler to jobs API**

`PUT /api/jobs/[id]` — admin only, updates job fields. Uses `createJobSchema.partial()` for validation.

**Step 4: Add delete (soft) button**

Each job row has a delete button that calls `DELETE /api/jobs/[id]` (already exists, sets `active: false`). Add a visual indicator for inactive jobs and option to reactivate.

**Step 5: Wire up navigation**

Admin sidebar shows "Publier une offre" and "Gérer les offres" links.

**Step 6: Verify**

Post a new job, see it in the list, edit it, verify changes persist, soft-delete it, verify it disappears from the public feed but remains in admin view.

**Step 7: Commit**

```bash
git add src/app/\(app\)/admin/jobs/ src/app/api/jobs/\[id\]/route.ts src/components/Sidebar.tsx
git commit -m "feat: admin job management — list, edit, delete"
```

---

### Task 10: Improved URL Extract (AI-Powered)

**Files:**
- Modify: `src/app/api/extract/route.ts` (add AI extraction, timeout, error handling)
- Modify: `src/app/(app)/admin/page.tsx` (improve extract UX)

**Step 1: Improve extract API**

The current extract endpoint fetches a URL and does basic HTML parsing. Enhance it:
- Add 10-second fetch timeout using AbortController
- Parse the raw HTML content
- Use structured extraction to identify: title, company name, location, pay/salary, job description, category
- Return structured JSON with all extracted fields
- Handle errors gracefully (timeout, invalid URL, parsing failure)

**Step 2: Improve admin form UX**

When "Extraire" is clicked:
- Show loading spinner
- On success, pre-populate all form fields with extracted data
- Highlight pre-filled fields so admin knows what was auto-detected
- Admin reviews, tweaks, and submits

**Step 3: Add source URL tracking**

The `sourceUrl` field auto-fills with the extracted URL for reference.

**Step 4: Verify**

Test with a real Gumtree job URL, a Seek URL, and a Facebook Jobs URL. Confirm fields are reasonably pre-populated.

**Step 5: Commit**

```bash
git add src/app/api/extract/route.ts src/app/\(app\)/admin/page.tsx
git commit -m "feat: AI-powered URL extraction for admin job posting"
```

---

### Task 11: Transactional Emails with Resend

**Files:**
- Create: `src/lib/email.ts` (Resend client + email templates)
- Create: `src/app/api/auth/reset-password/route.ts`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Modify: `src/app/api/register/route.ts` (send welcome email)
- Modify: `src/app/(auth)/login/page.tsx` (add "Mot de passe oublié?" link)
- Modify: `prisma/schema.prisma` (add PasswordReset model)
- Modify: `package.json` (add resend dependency)

**Step 1: Install Resend**

```bash
npm install resend
```

**Step 2: Create email utility**

`src/lib/email.ts`:
```typescript
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendWelcomeEmail(to: string, name: string) { ... }
export async function sendPasswordResetEmail(to: string, resetUrl: string) { ... }
export async function sendSubscriptionConfirmation(to: string, name: string) { ... }
```

All emails are in French, branded with Job Club purple/orange.

**Step 3: Add PasswordReset model to Prisma schema**

```prisma
model PasswordReset {
  id        String   @id @default(cuid())
  email     String
  token     String   @unique
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

**Step 4: Create password reset API**

`POST /api/auth/reset-password` — body: `{ email }` — generates token, stores in DB, sends reset email.
`POST /api/auth/reset-password/confirm` — body: `{ token, password }` — validates token, updates password.

**Step 5: Create password reset page**

`/reset-password` — form to enter email (request step) and form to enter new password (confirm step, with token from URL).

**Step 6: Wire up login page**

Add "Mot de passe oublié?" link below the login form pointing to `/reset-password`.

**Step 7: Send welcome email on registration**

In `src/app/api/register/route.ts`, after creating the user, call `sendWelcomeEmail(user.email, user.name)`.

**Step 8: Update .env.example**

Add `RESEND_API_KEY` and `EMAIL_FROM` vars.

**Step 9: Verify**

Register a new user, confirm welcome email received. Request password reset, confirm email received with valid link. Reset password and login with new password.

**Step 10: Commit**

```bash
git add src/lib/email.ts src/app/api/auth/reset-password/ src/app/\(auth\)/reset-password/ prisma/schema.prisma src/app/api/register/route.ts src/app/\(auth\)/login/page.tsx .env.example package.json package-lock.json
git commit -m "feat: transactional emails (welcome, password reset) via Resend"
```

---

### Task 12: Real Stripe Integration

**Files:**
- Modify: `src/app/subscribe/page.tsx` (improve subscribe page)
- Modify: `src/app/api/stripe/checkout/route.ts` (verify works with real keys)
- Modify: `src/app/api/stripe/webhook/route.ts` (add error handling per event)
- Modify: `src/app/(app)/profile/page.tsx` (add subscription management)
- Create: `src/app/api/stripe/portal/route.ts` (Stripe Customer Portal)

**Step 1: Set up Stripe product**

In Stripe dashboard:
1. Create Product "Job Club — Abonnement mensuel"
2. Set price to $39.99 AUD/month recurring
3. Copy price_id
4. Set up Customer Portal in Stripe settings (allow cancel, update payment)

**Step 2: Wire up Stripe Customer Portal**

Create `POST /api/stripe/portal` — creates a Stripe Billing Portal session so users can manage their subscription (cancel, update payment method, view invoices).

**Step 3: Update profile page subscription section**

"Gérer mon abonnement" on the profile page links to the Stripe Customer Portal. Show subscription status (active, past_due, canceled) with appropriate messaging.

**Step 4: Improve subscribe page**

Show clear value proposition, pricing, and a prominent checkout button. Handle the `?subscribed=true` and `?canceled=true` query params after Stripe redirect.

**Step 5: Add error handling to webhook**

Each webhook event case (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) gets try-catch with logging.

**Step 6: Send subscription confirmation email**

After `checkout.session.completed`, send a confirmation email to the user.

**Step 7: Verify with Stripe test mode**

Test full flow: register → subscribe → checkout → webhook fires → subscription active → manage → cancel → webhook fires → subscription canceled.

**Step 8: Commit**

```bash
git add src/app/api/stripe/ src/app/subscribe/page.tsx src/app/\(app\)/profile/page.tsx .env.example
git commit -m "feat: full Stripe subscription lifecycle with Customer Portal"
```

---

## Phase 3: Launch Readiness

---

### Task 13: Seed Data Cleanup + Production Env

**Files:**
- Modify: `prisma/seed.ts` (production-aware seeding)
- Modify: `.env.example` (all required vars documented)
- Create: `scripts/backup.sh` (Postgres backup script)

**Step 1: Make seed script production-aware**

Add a flag or env check: in production, seed only creates the admin user(s) — no demo jobs. In development, seed creates the full demo dataset.

**Step 2: Document all env vars**

Update `.env.example` with every required variable, commented with descriptions:

```
# Database
DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub"
POSTGRES_PASSWORD="changeme"

# Auth
NEXTAUTH_SECRET="openssl rand -base64 32"
NEXTAUTH_URL="https://jobclub.mlfrance.dev"

# Stripe
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_PUBLISHABLE_KEY="pk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_ID="price_..."

# Email (Resend)
RESEND_API_KEY="re_..."
EMAIL_FROM="Job Club <noreply@mlfrance.dev>"
```

**Step 3: Create backup script**

`scripts/backup.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/jobclub"
mkdir -p $BACKUP_DIR
docker compose exec -T db pg_dump -U jobclub jobclub | gzip > "$BACKUP_DIR/jobclub-$(date +%Y%m%d-%H%M%S).sql.gz"
# Keep last 30 days of backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
```

**Step 4: Commit**

```bash
git add prisma/seed.ts .env.example scripts/backup.sh
git commit -m "chore: production seed script, env docs, backup script"
```

---

### Task 14: Error Monitoring + Final Polish

**Files:**
- Create: `src/lib/logger.ts` (structured logging utility)
- Modify: all API routes (add logging for errors)
- Modify: `src/middleware.ts` (add request logging)

**Step 1: Create simple logger**

`src/lib/logger.ts` — structured JSON logging to stdout (Docker picks this up). Logs timestamp, level, message, and context.

**Step 2: Add error logging to all API routes**

Every catch block logs the error with context (route, user, input).

**Step 3: Add request logging to middleware**

Log each authenticated request: path, user email, timestamp.

**Step 4: Update DEPLOY.md**

Update deployment guide with:
- Postgres setup instructions
- Backup cron setup: `0 3 * * * /opt/job-club/scripts/backup.sh`
- Resend API key setup
- Stripe live mode switch instructions
- How to view logs: `docker compose logs -f app`

**Step 5: Commit**

```bash
git add src/lib/logger.ts src/middleware.ts DEPLOY.md
git commit -m "chore: structured logging, updated deployment guide"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| **Phase 1** | Tasks 1-7 | Solid foundation: Postgres, validation, auth fixes, admin roles |
| **Phase 2** | Tasks 8-12 | Full feature set: saved jobs, admin dashboard, AI extract, Stripe, emails |
| **Phase 3** | Tasks 13-14 | Production readiness: backups, logging, deployment docs |

**Total tasks:** 14
**Dependencies:** Tasks are mostly sequential within phases, but some Phase 2 tasks can run in parallel (e.g., Task 8 + Task 9 are independent).
