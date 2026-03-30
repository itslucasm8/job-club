# Job Club — Production Launch Design

**Date:** 2026-03-30
**Approach:** C — Harden and Extend
**Goal:** Replace Podia ASAP. Migrate existing paying users to jobclub.mlfrance.dev.

---

## Context

Job Club is a paid job board ($39.99/month) for French backpackers in Australia, currently running on Podia's community platform. The MLF team manually posts 20-30 jobs/day by copy-pasting from Gumtree, Seek, and Facebook. The self-hosted replacement (Next.js 14, Prisma, Tailwind) is deployed at jobclub.mlfrance.dev as a working demo with seed data. This design covers the path from demo to production.

## Key Decisions

- **Apply flow:** No Postuler button. Contact info lives in the job description — users read it and reach out themselves (email, phone, Gumtree link). This matches how it works on Podia and reduces friction.
- **Job expiry:** Manual removal by admin only. No auto-expiry.
- **Admin team:** 2-3 people need admin access. Role system already exists, just needs multi-admin support.
- **Database:** Migrate from SQLite to PostgreSQL for production (concurrent writes, proper backups, industry standard).
- **Email notifications:** Transactional emails (welcome, password reset, subscription) at launch. Daily digest / job alerts as a fast-follow in v1.1.

---

## Phase 1: Foundation Hardening

Before any new features, make the existing codebase production-worthy.

### 1.1 PostgreSQL Migration
- Replace SQLite with Postgres running in Docker alongside the app
- Update Prisma schema datasource from `sqlite` to `postgresql`
- Update docker-compose.yml with a postgres service and volume
- Update connection string in env vars

### 1.2 Remove Postuler Button
- Remove the Postuler button from JobCard.tsx and JobModal.tsx
- Remove applyUrl field from the admin posting form (keep sourceUrl for reference)
- Contact info stays in the job description text

### 1.3 Login Error Feedback
- Show "Email ou mot de passe incorrect" when login fails
- Currently the page silently stays on /login with no feedback

### 1.4 Stagger Seed Data Timestamps
- Update seed.ts to create jobs with staggered createdAt dates (spread over 2 weeks)
- Jobs should look naturally posted, not all "Il y a 17min"

### 1.5 Input Validation (Zod)
- Add Zod schemas for all API route inputs
- Validate job creation fields (title length, description length, valid state/category values)
- Validate registration (email format, password strength)
- Return structured error messages

### 1.6 Multiple Admin Support
- Admin can promote other users to admin role via a simple UI or API
- All 2-3 team members get admin access

### 1.7 Fix Sign-Out Page
- Replace NextAuth default dark-themed sign-out with branded purple/orange design
- Match the login page styling

---

## Phase 2: Production Features

### 2.1 Real Stripe Integration
- Create $39.99/month subscription product in Stripe dashboard
- Wire up checkout flow with live keys
- Handle subscription lifecycle: active, past_due, canceled
- Subscription wall: unpaid users see the subscribe page
- Cancel subscription from profile page

### 2.2 Saved Jobs View
- "Mes offres sauvegardées" page accessible from profile
- Backend already works (SavedJob model, toggle endpoint)
- Build the UI to list saved jobs with remove option

### 2.3 Improved Admin Posting (URL Extract + AI)
- Paste a Gumtree/Seek/Facebook URL into the admin form
- AI extracts: title, company, location, description, pay, category
- Fields pre-populate, admin reviews/tweaks and publishes
- Add timeout and error handling to the extract API
- This is the speed multiplier for 20-30 posts/day

### 2.4 Admin Job Management Dashboard
- List all posted jobs with status, date, state
- Edit existing jobs
- Delete jobs (soft delete, sets active: false)
- Filter/search within admin view

### 2.5 Transactional Emails
- Email service: Resend (simple, cheap, good DX)
- Welcome email on registration
- Password reset email
- Subscription confirmation / payment failed notifications

### 2.6 Password Reset Flow
- "Mot de passe oublié?" link on login page
- Sends reset email with time-limited token
- Reset page to set new password

---

## Phase 3: Launch Readiness

### 3.1 Domain
- Confirm final URL (jobclub.mlfrance.dev or custom domain)
- SSL already handled by Cloudflare Tunnel

### 3.2 Stripe Production Mode
- Switch from test keys to live keys
- Set up webhook endpoint in Stripe dashboard
- Test a real transaction end-to-end

### 3.3 User Migration Plan
- Decide how existing Podia subscribers transition
- Options: manual account creation, invite codes, free trial period
- Communicate the switch to existing users

### 3.4 Seed Data Cleanup
- Remove demo/fake seed data before launch
- Either start fresh or have team pre-populate with real current jobs

### 3.5 Backup Strategy
- Automated Postgres backups (pg_dump on cron)
- Store backups on VPS or external storage

### 3.6 Error Monitoring
- Basic server-side logging
- Consider Sentry or similar for error tracking

---

## Architecture

```
User Browser
    |
    v
Cloudflare Tunnel (SSL)
    |
    v
Next.js 14 (standalone, port 3000)
    |--- NextAuth (JWT sessions)
    |--- Prisma ORM
    |       |
    |       v
    |   PostgreSQL (Docker, port 5432)
    |
    |--- Stripe API (subscriptions)
    |--- Resend API (transactional emails)
```

## Tech Stack (Final)

- Next.js 14 (App Router, React 18, TypeScript)
- Prisma 5 with PostgreSQL
- NextAuth v4 (credentials provider, JWT)
- Stripe (subscriptions)
- Resend (transactional emails)
- Tailwind CSS 3
- Zod (input validation)
- Docker + Cloudflare Tunnel (deployment)
