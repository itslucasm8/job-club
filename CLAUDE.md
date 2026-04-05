# Job Club by MLF

Job Club is a paid job board for French backpackers on Working Holiday Visas (WHV) in Australia. It's part of the MLF (My Little France) product suite. Subscribers pay $39.99 AUD/month or ~$400 AUD/year to access curated job listings — especially farm work and 88-day qualifying jobs.

We are migrating ~230 subscribers off Podia (where jobs were manually posted into community groups) onto this self-hosted app. **Phase 1 goal: go live and complete the Podia migration.**

## Who You're Working With

Lucas is the founder, not a developer — he's learning as he goes and getting more comfortable with the terminal. **Explain decisions briefly as you go** (the "why", not just the "what"). Claude Code is the sole AI assistant for this project — handling app code, ops guidance, and planning.

The admin team (Lucas + 1-2 others) manually posts 20-30 jobs/day from Gumtree, Seek, and Facebook groups.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL 16 (Docker) |
| ORM | Prisma 5 |
| Auth | NextAuth v4 (JWT, email/password) |
| Payments | Stripe (subscriptions) |
| Email | Resend (transactional, all in French) |
| Styling | Tailwind CSS 3 |
| Validation | Zod 4 |
| Logging | Custom JSON logger (src/lib/logger.ts) |
| Deploy | Docker Compose on VPS |
| Domain | jobclub.mlfrance.dev (Cloudflare Tunnel) |

## Getting Started (Local Dev)

```bash
# First-time setup
cp .env.example .env             # Create local env (fill in values)
npm install                      # Install deps (auto-runs prisma generate via postinstall)
npx prisma db push               # Create/update DB tables
npm run db:seed                   # Seed demo data

# Day-to-day
npm run dev                      # Start dev server (http://localhost:3000)
npm run build                    # Production build
npm start                        # Run production build locally
```

Requires a local PostgreSQL instance. Easiest: run `docker compose up db -d` to start just the database container, then use `npm run dev` for the app.

## Key Commands

```bash
# Database
npx prisma db push       # Apply schema changes
npx prisma studio        # Visual DB browser (http://localhost:5555)
npm run db:seed          # Seed demo data
npm run db:reset         # Reset DB + reseed (destructive!)

# Production (on VPS at /data/job-club/)
docker compose up -d --build    # Build and deploy
docker compose logs -f app      # Tail app logs
docker compose exec app npx prisma db push   # Apply schema in prod
```

## Project Structure

```
src/
├── app/
│   ├── (app)/           # Protected routes (feed, admin, saved, settings, guide, notifications, etc.)
│   ├── (auth)/          # Public auth routes (login, register, reset-password)
│   ├── api/             # 17 API routes
│   └── layout.tsx       # Root layout
├── components/          # TopBar, Sidebar, BottomTabs, JobCard, JobModal, JobCardSkeleton, Toast, SessionProvider
├── lib/                 # Core modules:
│   ├── auth.ts          # NextAuth config (CredentialsProvider, JWT callbacks)
│   ├── prisma.ts        # Prisma singleton
│   ├── stripe.ts        # Stripe singleton
│   ├── email.ts         # Resend email templates (French, branded)
│   ├── notifications.ts # Job → subscriber matching + notification creation
│   ├── validation.ts    # Zod schemas (register, job, query, extract)
│   ├── rate-limit.ts    # In-memory rate limiter
│   ├── logger.ts        # Structured JSON logging
│   └── utils.ts         # States, categories, French labels, helpers
├── types/               # TypeScript declarations
└── middleware.ts         # Auth + subscription wall + admin protection
prisma/
├── schema.prisma        # 5 models: User, Job, SavedJob, Notification, PasswordReset
└── seed.ts              # Demo data
```

## Database Models

- **User** — email/password auth, Stripe subscription fields, preferred states/categories, email alerts toggle
- **Job** — title, company, state, location, category, type, pay, description, sourceUrl, active flag, expiresAt (30-day auto-expiry)
- **SavedJob** — many-to-many user↔job
- **Notification** — in-app notifications (new_job type), linked to user and optionally job
- **PasswordReset** — token-based password reset with expiry

## Important Conventions

### All UI is in French
Every user-facing string — labels, buttons, emails, notifications, error messages — must be in French. Internal code (variable names, comments, logs) stays in English.

### Mobile-First
Almost all users are on their phones. Every UI change must look good on mobile first, then desktop.

### Brand Colors
- Purple: `brand-purple` (#6b21a8), `brand-purple-light` (#9333ea), `brand-purple-dark` (#581c87)
- Orange: `brand-orange` (#f59e0b), `brand-orange-dark` (#d97706), `brand-orange-light` (#fbbf24)
- Defined in tailwind.config.ts under `theme.extend.colors.brand`

### No "Apply" Button
Jobs don't have a separate apply URL/button. Contact info (email, phone, link) is embedded in the job description. Users reach out directly. Note: the `applyUrl` field exists in the Job schema (legacy/optional) but is not surfaced in the UI.

### Subscription Wall
Non-subscribers are redirected to `/subscribe`. Only admins bypass the paywall. This is enforced in `src/middleware.ts`.

### Australian States
Valid states: QLD, NSW, VIC, SA, WA, TAS, NT, ACT. Defined in `src/lib/validation.ts` and `src/lib/utils.ts`.

### Job Categories
farm, hospitality, construction, trade, retail, cleaning, other. French labels in `src/lib/utils.ts`.

### Rate Limiting
Auth (10/15min), registration (5/hr), password reset (3/15min). Defined in `src/lib/rate-limit.ts`.

## Git & PR Workflow

### Commit Often
Make small, frequent commits as you work — after each meaningful change (a feature, a fix, a refactor step). Don't batch up large amounts of work into a single commit. This keeps the history clean and makes it easy to revert if something breaks.

### Suggest PRs
After completing a logical chunk of work (a feature, a bug fix, a set of related changes), suggest to Lucas to create a PR on GitHub. This gives him a chance to review changes before they land on `main`.

### Simplify Before PRs
When creating a PR, always run `/simplify` first to clean up the code for clarity, consistency, and maintainability before the PR is opened.

### Code Review for Complex PRs
For larger or more complex PRs (multiple files changed, new features, refactors), suggest running a code review using the code-reviewer agent. Always ask Lucas for confirmation first (via AskUserQuestion) before launching the review — don't run it automatically.

## Environment Variables

See `.env.example` for the full list. Key groups:
- `DATABASE_URL`, `POSTGRES_PASSWORD` — PostgreSQL connection
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL` — Auth config
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_PRICE_ID_YEARLY` — Payments
- `RESEND_API_KEY`, `EMAIL_FROM` — Transactional email
- `NODE_ENV` — Environment flag

## Production Deployment

- **VPS path:** `/data/job-club/`
- **Docker services:** `app` (port 3000) + `db` (PostgreSQL 16)
- **Tunnel:** Cloudflare Zero Trust → `jobclub.mlfrance.dev`
- **Env file:** `/data/job-club/.env.production`
- **Backups:** `scripts/backup.sh` — daily pg_dump to `/opt/backups/jobclub/`, 30-day retention
- **Repo:** `itslucasm8/job-club` on GitHub, `main` branch

## Gotchas

- **`postinstall` runs `prisma generate`** — after `npm install`, the Prisma client is auto-generated. If you see "PrismaClient is not generated" errors, run `npx prisma generate` manually.
- **In-memory rate limiter resets on restart** — rate limit counters live in memory, not Redis. App restart clears all counters. Fine for now, but be aware during load testing.
- **`.env` is gitignored** — copy `.env.example` for local dev. Production uses `.env.production` on the VPS.
- **No linter or formatter configured** — no ESLint, Prettier, or type-check scripts. Code style is maintained manually.
- **No test suite** — no Jest, Playwright, or any testing framework. Manual testing only for now.
- **Job `applyUrl` is legacy** — field exists in schema but isn't displayed in the UI. Don't add UI for it.
- **Path alias** — `@/*` maps to `./src/*` (defined in tsconfig.json). Use `@/lib/prisma` not `../../lib/prisma`.

## Planning Docs

Implementation plans and design docs are in `docs/plans/`. Check there for Phase 1 roadmap and UX decisions. Phase 1 status is also tracked in Claude's memory system.

## What's NOT Done Yet (Phase 1 Critical)

1. Stripe production setup (live keys, webhook endpoint, price IDs)
2. Resend email domain verification + API key
3. Podia subscriber migration (~230 users)
4. Seed real jobs (clear demo data)
5. DNS/domain decision
6. Observability (Sentry for errors — not yet integrated)
7. Automated backup cron not yet scheduled on VPS
