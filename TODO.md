# Job Club — Outstanding Workstreams

> **Status:** Phase 1 — Go-live & Podia migration. Target: mid-April to mid-May 2026.
>
> Almost everything is done. **One blocker remains: Podia user migration.**

---

## Last Blocker Before Go-Live

| # | Workstream | Plan | Type | Status |
|---|-----------|------|------|--------|
| 1 | **Podia User Migration** | [plan](docs/plans/podia-user-migration.md) | Script + Ops | Not started — needs Podia CSV export + subscription strategy decision |

---

## Remaining Items

| # | Item | Effort | Type | Status |
|---|------|--------|------|--------|
| 2 | **Enable `invoice.created` in Stripe webhook** | 1 min | Ops (manual) | Not started — do in [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) |
| 3 | **Uptime monitoring** — get alerted if VPS/app goes down | 15 min | Ops (manual) | Not started — set up a free external monitor (e.g. UptimeRobot) |
| 4 | Rate limit on /api/extract endpoint | 15 min | Code | **Done** — 30 req/15min per IP |

---

## Completed

### Critical Path

| # | Workstream | Status |
|---|-----------|--------|
| 0 | Local Dev Environment Setup | **Done** |
| 1 | Stripe Production Setup | **Done** — Live keys, price IDs, webhook on VPS. |
| 2 | Resend Email Setup | **Done** — Sending from `noreply@thejobclub.com.au`, delivered to inbox. |
| 3 | Production Database Hardening | **Done** — Backups, security, PostgreSQL 16. |
| 4 | DNS & Domain | **Done** — `thejobclub.com.au` via Cloudflare Tunnel. |
| 6 | Seed Real Jobs | **Done** — 905 jobs live on production across all 8 states. |

### Features

| # | Workstream | Status |
|---|-----------|--------|
| 7 | Observability (Sentry) | **Done** — SDK, source maps, alerts, MCP, env tagging, user context. |
| 8 | Product Analytics (PostHog) | **Done** — SDK, pageviews, user identification, 7 custom events. |
| 9 | Category Redesign + 88 Days Flag | **Done** — 9 categories, 88-day badge + filter + notification preference. |
| 10 | i18n / Language Support | **Done** — Full EN/FR translations, bilingual emails, API error codes. |
| 11 | Admin Redesign | **Done** — Dashboard, mode switch, create-admin flow. |
| 12 | Landing Page | **Done** — Split-screen layout with both pricing plans. |

### Observability & Analytics Hardening (2026-04-08)

| Item | Status |
|------|--------|
| Sentry error capture on all API routes (19/20) | **Done** |
| Sentry environment tagging (production/development) | **Done** |
| PostHog user identification (`posthog.identify`) | **Done** |
| Sentry user context (`Sentry.setUser`) | **Done** |
| PostHog events: register, login, subscribe, search, filter | **Done** |

### Security & Production Hardening (2026-04-08)

| Item | Status |
|------|--------|
| Security headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) | **Done** |
| Favicon (SVG, brand colors) | **Done** |
| Privacy policy + Terms of service (bilingual) | **Done** |
| Stripe webhook returns 500 on critical failures (enables retry) | **Done** |
| `past_due` subscription grace period + warning banner | **Done** |
| Bcrypt rounds standardized to 12 everywhere | **Done** |
| Expired/inactive jobs return 404 on direct access | **Done** |

### SEO & Social (2026-04-08)

| Item | Status |
|------|--------|
| OG meta tags + dynamic opengraph image | **Done** |
| robots.txt + dynamic sitemap.xml | **Done** |
| Cookie consent banner (GDPR, PostHog opt-out) | **Done** |
| Legal footer links on landing + subscribe pages | **Done** |

### Email (2026-04-08)

| Item | Status |
|------|--------|
| Subscription cancellation confirmation email | **Done** |
| Renewal reminder email (on `invoice.created` webhook) | **Done** |

### UX & Performance (2026-04-08/09)

| Item | Status |
|------|--------|
| PWA manifest (home screen installation) | **Done** |
| Loading skeletons (feed, saved, notifications, settings) | **Done** |
| N+1 notification query → single batch query | **Done** |
| Support contact email on profile page | **Done** |

### Ops & Reliability (2026-04-08/09)

| Item | Status |
|------|--------|
| Health check endpoint (`/api/health`) + Docker healthcheck | **Done** |
| Subscription status sync cron (daily 4:30 AM) | **Done** |
| Expire-jobs cron configured on VPS (daily 4:00 AM) | **Done** |
| Password reset token cleanup in daily cron | **Done** |

### Earlier Cleanup

| Item | Status |
|------|--------|
| Sentry DSN + source maps + alerts in production | **Done** |
| Remove old Cloudflare tunnel route | **Done** |
| Resend domain verification (email deliverability) | **Done** |
| Translate hardcoded French API errors | **Done** |
| 88-day preference toggle in notification settings | **Done** |

---

## Decided Against

| Item | Reason |
|------|--------|
| JSON-LD JobPosting schema | Don't want jobs appearing in Google search results |

---

## Reference Plans

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

*Last updated: 2026-04-09*
