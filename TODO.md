# Job Club — Outstanding Workstreams

> **Status:** Phase 1 — Go-live & Podia migration. Target: mid-April to mid-May 2026.
>
> Almost everything is done. **One blocker remains: Podia user migration.**

---

## Last Blocker Before Go-Live

| # | Workstream | Plan | Type | Status |
|---|-----------|------|------|--------|
| 5 | **Podia User Migration** | [plan](docs/plans/podia-user-migration.md) | Script + Ops | Not started — needs Podia CSV export + subscription strategy decision |

---

## Should Do (Important, not blocking)

All completed on 2026-04-08. Moved to Completed section below.

---

## Nice to Have (After launch)

| # | Item | Effort | Status |
|---|------|--------|--------|
| 23 | PWA manifest (install on home screen) | 15 min | Not started |
| 24 | Loading skeletons (loading.tsx files) | 20 min | Not started |
| 25 | JSON-LD JobPosting schema (Google job search) | 30 min | Not started |
| 26 | Renewal reminder email (before auto-charge) | 30 min | Not started |
| 27 | Subscription status sync cron (safety net for missed webhooks) | 1 hr | Not started |
| 28 | Rate limit on /api/extract endpoint | 15 min | Not started |

---

## Completed

### Critical Path

| # | Workstream | Status |
|---|-----------|--------|
| 0 | Local Dev Environment Setup | **Done** |
| 1 | Stripe Production Setup | **Done** — Live keys, price IDs, webhook on VPS. Shared Stripe account with MLF. |
| 2 | Resend Email Setup | **Done** — Sending from `noreply@thejobclub.com.au`, delivered to inbox. |
| 3 | Production Database Hardening | **Done** — Backups, security, PostgreSQL 16. |
| 4 | DNS & Domain | **Done** — `thejobclub.com.au` via Cloudflare Tunnel. Old `mlfrance.dev` route removed. |
| 6 | Seed Real Jobs | **Done** — 905 jobs live on production across all 8 states. |

### Features

| # | Workstream | Status |
|---|-----------|--------|
| 7 | Observability (Sentry) | **Done** — SDK, source maps, alerts, MCP connected. Dev errors disabled. |
| 8 | Product Analytics (PostHog) | **Done** — SDK, pageviews, user identification, 7 custom events. |
| 9 | Category Redesign + 88 Days Flag | **Done** — 9 categories, 88-day badge + filter + notification preference. |
| 10 | i18n / Language Support | **Done** — Full EN/FR translations, bilingual emails, API error codes. |
| 11 | Admin Redesign | **Done** — Dashboard, mode switch, create-admin flow. |
| 12 | Landing Page | **Done** — Split-screen layout with both pricing plans. |

### Hardening (2026-04-08)

| # | Item | Status |
|---|------|--------|
| 13 | Sentry error capture on all API routes (19/20) | **Done** |
| 14 | Sentry environment tagging | **Done** |
| 15 | PostHog user identification (`posthog.identify`) | **Done** |
| 16 | Sentry user context (`Sentry.setUser`) | **Done** |
| 17 | PostHog events: register, login, subscribe, search, filter | **Done** |

### Production Fixes (2026-04-08)

| # | Item | Status |
|---|------|--------|
| — | Security headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) | **Done** |
| — | Favicon (SVG, brand colors) | **Done** |
| — | Privacy policy + Terms of service (bilingual) | **Done** |
| — | Stripe webhook returns 500 on critical failures (enables retry) | **Done** |
| — | `past_due` subscription grace period + warning banner | **Done** |
| — | Bcrypt rounds standardized to 12 everywhere | **Done** |
| — | OG meta tags + dynamic opengraph image for social sharing | **Done** |
| — | robots.txt + dynamic sitemap.xml | **Done** |
| — | Subscription cancellation confirmation email | **Done** |
| — | Cookie consent banner (GDPR, PostHog opt-out) | **Done** |
| — | Legal footer links on landing + subscribe pages | **Done** |

### Cleanup (Earlier)

| # | Item | Status |
|---|------|--------|
| — | Sentry DSN + source maps + alerts in production | **Done** |
| — | Remove old Cloudflare tunnel route | **Done** |
| — | Resend domain verification (email deliverability) | **Done** |
| — | Translate hardcoded French API errors | **Done** |
| — | 88-day preference toggle in notification settings | **Done** |

---

## Reference Plans

Older plans with completed context:

- [`docs/plans/stripe-production-setup.md`](docs/plans/stripe-production-setup.md) — Stripe config (completed)
- [`docs/plans/resend-email-setup.md`](docs/plans/resend-email-setup.md) — Email setup (completed)
- [`docs/plans/production-database.md`](docs/plans/production-database.md) — DB hardening (completed)
- [`docs/plans/dns-domain.md`](docs/plans/dns-domain.md) — Domain setup (completed)
- [`docs/plans/observability-sentry.md`](docs/plans/observability-sentry.md) — Sentry (completed)
- [`docs/plans/product-analytics.md`](docs/plans/product-analytics.md) — PostHog (completed)
- [`docs/plans/seed-real-jobs.md`](docs/plans/seed-real-jobs.md) — Job seeding (completed)
- [`docs/plans/observability-analytics-completion.md`](docs/plans/observability-analytics-completion.md) — Analytics hardening (completed)
- [`docs/plans/podia-user-migration.md`](docs/plans/podia-user-migration.md) — **Next up**

---

*Last updated: 2026-04-08*
