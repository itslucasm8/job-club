# Job Club — Outstanding Workstreams

> **Status:** Phase 1 — Go-live & Podia migration. Target: mid-April to mid-May 2026.
>
> Each workstream below has a dedicated plan in `docs/plans/`. Plans are executable — tell Claude to run them with `feature-dev` (for feature work) or follow the ops steps directly.

---

## Immediate (do first)

| # | Workstream | Plan | Type | Status |
|---|-----------|------|------|--------|
| 0 | **Local Dev Environment Setup** | See [Getting Started](CLAUDE.md#getting-started-local-dev) | Setup | **Done** |

> Lucas: set up your local dev environment so you can test changes before they go to production. See CLAUDE.md for instructions (Docker, `.env`, `npm install`, `prisma db push`, `db:seed`).

## Critical Path (must complete before go-live)

| # | Workstream | Plan | Type | Status |
|---|-----------|------|------|--------|
| 1 | **Stripe Production Setup** | [plan](docs/plans/stripe-production-setup.md) | Ops + Config | **Done** — Live keys, price IDs, webhook configured on VPS. Shared Stripe account with MLF. |
| 2 | **Resend Email Setup** | [plan](docs/plans/resend-email-setup.md) | Ops + Config | **Done** — API key configured, sending from `noreply@thejobclub.com.au`. Verify DKIM/SPF/DMARC if email deliverability issues arise. |
| 3 | **Production Database Hardening** | [plan](docs/plans/production-database.md) | Ops | **Done** |
| 4 | **DNS & Domain** | [plan](docs/plans/dns-domain.md) | Ops | **Done** — `thejobclub.com.au` live via Cloudflare Tunnel. Nameservers pointed from VentraIP. |
| 5 | **Podia User Migration** | [plan](docs/plans/podia-user-migration.md) | Script + Ops | Not started — needs Podia CSV export + subscription strategy decision |
| 6 | **Seed Real Jobs** | [plan](docs/plans/seed-real-jobs.md) | Script + Ops | **Partially done** — 889 jobs scraped from Podia & imported locally. Need to import on production. |

## Important (should complete before or shortly after go-live)

| # | Workstream | Plan | Type | Status |
|---|-----------|------|------|--------|
| 7 | **Observability (Sentry)** | [plan](docs/plans/observability-sentry.md) | Feature | **Done** |
| 8 | **Product Analytics** | [plan](docs/plans/product-analytics.md) | Feature | **Done** |
| 9 | **Category Redesign + 88 Days Flag** | [spec](docs/superpowers/specs/2026-04-07-categories-88days-design.md) | Feature | **Done** — PR #1 merged. 9 categories, 88-day badge + filter. |

## Cleanup / Small Items

| # | Item | Status |
|---|------|--------|
| 10 | **Sentry DSN in production** — DSN configured and active in running container. | **Done** |
| 13 | **Sentry source maps** — Currently disabled in `next.config.js`. Need a Sentry auth token to upload source maps during build. Without this, error stack traces show minified JS instead of your TypeScript code. | Not started |
| 14 | **Sentry alerts** — High-priority issue alerts + new bug alerts configured and actively firing. | **Done** |
| 11 | **Remove old Cloudflare tunnel route** — `jobclub.mlfrance.dev` route still exists in Cloudflare Zero Trust. Should be removed to avoid confusion. | Not started |
| 12 | **Resend domain verification check** — Confirm DKIM/SPF/DMARC records pass for `thejobclub.com.au`. Send a test email and check headers in Gmail ("Show original"). | Not verified |

## Already Planned (existing detailed plans)

These older plans cover work that's partially done. Refer to them for completed context:

- [`2026-03-30-production-launch-plan.md`](docs/plans/2026-03-30-production-launch-plan.md) — Foundation hardening (PostgreSQL, Zod, auth fixes, admin roles, saved jobs, Stripe, emails, backups, logging). Many tasks here are **already completed**.
- [`2026-03-31-phase1-functional-phase2-ux-plan.md`](docs/plans/2026-03-31-phase1-functional-phase2-ux-plan.md) — Email alerts, notifications page, toast system, animations, responsive polish. Many tasks here are **already completed**.

---

## How to Execute a Plan

1. Open the plan doc (e.g., `docs/plans/stripe-production-setup.md`)
2. For **feature-related plans** (Observability, Analytics): tell Claude to use `feature-dev`
3. For **ops plans** (Stripe, Resend, DNS, Database): follow the steps — some require manual actions (dashboard logins, DNS changes) that Claude will guide you through
4. For **script plans** (Migration, Seeding): Claude writes and runs the scripts

---

*Last updated: 2026-04-07*
