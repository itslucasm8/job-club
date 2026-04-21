# Job Club — Outstanding Workstreams

> **Status:** Phase 1 — Go-live & Podia migration. Target: mid-April to mid-May 2026.
>
> Almost everything is done. **One blocker remains: Podia user migration.**

---

## Last Blocker Before Go-Live — Podia User Migration

> [Plan](docs/plans/podia-user-migration.md) — rewritten to "data sync + env swap" approach (NOT the original "seamless Stripe subscription transfer"). Existing Podia subs stay as-is; we don't call `stripe.subscriptions.update()` on anyone.

**Cohort (verified 2026-04-19 via live Stripe run):** 37 active — 26 monthly + 11 yearly. All have valid emails. Zero `past_due`, zero `trialing`.

**Pricing locked:** $39.99/mo and $149/yr (keep Podia's prices — monthly LTV analysis showed $149 already captures ~2× monthly revenue/customer).

**Docs to read:**
- [`docs/plans/podia-user-migration.md`](docs/plans/podia-user-migration.md) — the full plan + reasoning (start here)
- [`docs/plans/podia-cutover-runbook.md`](docs/plans/podia-cutover-runbook.md) — the tick-the-boxes checklist for cutover day
- [`docs/emails/podia-migration-emails.md`](docs/emails/podia-migration-emails.md) — three French email templates

### Done

| Item | Where |
|------|-------|
| Plan rewritten to data-sync approach | `docs/plans/podia-user-migration.md` |
| Cutover runbook written | `docs/plans/podia-cutover-runbook.md` |
| Pricing decision locked ($39.99/$149) | Memory + plan doc |
| Three French email templates drafted (pre-cutover, welcome, Day-7 follow-up) | `docs/emails/podia-migration-emails.md` |
| `scripts/inventory-podia.ts` — reads live Stripe, writes `out/podia-cohort.json` | Committed; ran successfully, 37 rows produced |

### To do (in order)

| # | Item | Type | Effort |
|---|------|------|--------|
| 1 | **Decide cutover date** | Decision | — |
| 2 | `scripts/sync-podia-customers.ts` — upsert Users + generate `PasswordReset` tokens. Dry-run default, `--live` flag to write | Code | ~1 hr |
| 3 | `scripts/send-migration-emails.ts` — send welcome email via Resend using template §2 | Code | ~45 min |
| 4 | `scripts/followup-migration-emails.ts` — Day-7 reminder for non-activators | Code | ~30 min |
| 5 | Send pre-cutover email (T-5, via Resend dashboard) | Ops (manual) | 10 min |
| 6 | Podia data backup (optional, before Day-14 decommission) | Ops (manual) | 15 min |
| 7 | Execute cutover per runbook — env swap, sync `--live`, welcome emails, monitor 48-72h | Ops | ~2 hr + 48-72h |
| 8 | Day 7: run follow-up script | Ops | 15 min |
| 9 | Day 14 (if activation ≥95%): decommission Podia plan | Ops | 15 min |

### Key IDs for cutover (don't look these up again)

- **Monthly Price ID:** `monthly-monthly-20230426090915-996d`
- **Yearly Price ID:** `rejoignez-le-job-club-et-assurez-vous-un-acces-exclusif-a-des-opportunites-de-travail-tout-au-long-de-votre-annee-en-australie-annual-20240523062135-f036`
- **Duplicate product to archive later** (leave alone for now): `prod_UFpN16niWDMgQI`

### How to run scripts against live Stripe

Local `.env` has a placeholder key. Use the restricted read-only key from `~/.claude.json`:

```bash
STRIPE_SECRET_KEY=$(grep -oE 'rk_live_[a-zA-Z0-9]+' ~/.claude.json | head -1) npx tsx scripts/inventory-podia.ts
```

The restricted key is read-only — fine for inventory and for any script that only reads Stripe. If the sync script's optional Stripe-metadata write needs to succeed, a full `sk_live_` key may be needed (check the restricted key's permissions first).

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

## Post-Launch Hardening (from Comprehensive Critique — 2026-04-10)

> Work through these after Podia migration is complete and the app is live.

### High Priority

| # | Item | Effort | Status |
|---|------|--------|--------|
| 1 | Fix 47+ `as any` type casts (extend NextAuth types, type Stripe events) | Medium | Not started |
| 2 | Add tests — Stripe webhook handler, auth flows | Large | Not started |
| 3 | Email verification on registration | Medium | Not started |

### Medium Priority

| # | Item | Effort | Status |
|---|------|--------|--------|
| 4 | Standardize API error format (consistent shape + HTTP status codes) | Medium | Not started |
| 5 | Admin audit log (who changed what) | Medium | Not started |
| 6 | Basic caching layer for feed queries | Medium | Not started |
| 7 | Accessibility fixes (focus trap, ARIA live regions, skip-to-content, button labels) | Medium | Not started |

### Lower Priority

| # | Item | Effort | Status |
|---|------|--------|--------|
| 8 | Migrate preferences from CSV strings to JSON arrays | Small | Not started |
| 9 | Soft deletes on jobs | Small | Not started |
| 10 | Full-text search (replace LIKE queries) | Large | Not started |
| 11 | Break up large components (admin dashboard 412 lines, feed page) | Medium | Not started |

### Security Hardening

| # | Item | Effort | Status |
|---|------|--------|--------|
| 12 | Remove dev-mode auth bypass in middleware | Small | Not started |
| 13 | Validate trusted proxies for rate limiter (x-forwarded-for spoofing) | Small | Not started |
| 14 | Cron secret — fail explicitly instead of fallback to NEXTAUTH_SECRET | Small | Not started |
| 15 | URL validation on /api/extract (SSRF prevention) | Small | Not started |

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

*Last updated: 2026-04-21*
