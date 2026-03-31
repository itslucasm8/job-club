# Job Club — Phase 1 (Functional Gaps) + Phase 2 (UX/UI Polish) Design

**Date:** 2026-03-31
**Approach:** Feature-by-feature, end-to-end (Approach A)
**Order:** Phase 1 functional first, then Phase 2 UX polish

---

## Phase 1: Functional Gaps

### Feature 1: Email Alerts for New Jobs

**Goal:** When an admin publishes a job, matching subscribers receive an email immediately.

**How it works:**

- Add `sendJobAlertEmail(to, name, job)` in `src/lib/email.ts` using the existing Resend setup and email template pattern.
- Email content: job title, company, state, category, and a CTA button linking to `/feed`.
- In `src/lib/notifications.ts`, after the bulk `createMany` for in-app notifications, fetch matched users' email + name and send emails. Stays fire-and-forget — if an email fails, log it and continue.
- Add an `emailAlerts` Boolean field to the `User` model in Prisma (default `true`) so users can opt out.
- Add the opt-out toggle to the Settings page under preferences.
- Only send to users where `emailAlerts === true`.

**No-ops:**
- No digest mode — immediate only.
- No re-notification on job edits.

---

### Feature 2: Notifications Page

**Goal:** Full-page notification history beyond the 20-item TopBar dropdown.

**What exists:** TopBar dropdown with bell icon, unread badge, mark-as-read, mark-all-read. API at `/api/notifications` (GET + PATCH).

**What we add:**

- New page at `(app)/notifications/page.tsx` — full-page list of all notifications with pagination (load-more button or infinite scroll).
- Each notification is clickable → navigates to the job on the feed.
- "Tout marquer lu" (Mark all as read) button at the top.
- Unread notifications: purple dot + light purple background (same as dropdown).
- "Voir tout" link at the bottom of the existing TopBar dropdown → links to `/notifications`.
- Add `/notifications` to middleware's protected routes list.
- Update API to accept `skip`/`take` query params for pagination.
- Empty state: friendly message encouraging users to set preferences in Settings.

**No-ops:**
- The dropdown stays as-is for quick glances — the page is for full history.

---

### Feature 3: Admin Job Editing & Deactivation

**Goal:** Admins can edit existing jobs and deactivate/reactivate them.

**API additions:**

- `GET /api/admin/jobs/[id]` — fetch a single job's full data for the edit form.
- `PATCH /api/admin/jobs/[id]` — update a job (same Zod validation as creation, admin-only).
- `DELETE /api/admin/jobs/[id]` — soft-delete: sets `active: false` rather than hard-deleting.

**UI additions:**

- Wire up the existing edit page stub at `(app)/admin/jobs/[id]/edit` with the same form layout as creation, pre-filled with existing data.
- On the admin jobs list, each job gets an "Éditer" button linking to the edit page.
- Edit page includes a "Désactiver" / "Réactiver" toggle button at the bottom.
- Deactivated jobs disappear from the user-facing feed but stay in DB.
- Users who saved a deactivated job see an "Offre expirée" indicator.
- On the admin list, inactive jobs show a visual indicator (grayed out or badge).

**No-ops:**
- No re-notification on edit.
- No hard-delete — soft-delete only.
- No bulk operations.

---

## Phase 2: UX/UI Polish

**Design direction:** Clean & minimal (Linear/Notion vibe). Lots of whitespace, subtle animations, effortless feel.

### Global Feedback & Micro-interactions

- **Global toast system:** Save/unsave a job, admin publishes a job, network errors — all get a subtle toast. Currently only Settings has toasts.
- **Smooth entrance animations:** Notification dropdown and job modal get fade + slide transitions.
- **Save button animation:** Brief heart animation on toggle.

### Loading & Empty States

- **Structured skeleton loaders:** Replace raw `animate-pulse` blocks with skeletons that mirror the actual card layout (title bar, tag placeholders, etc.).
- **Async action spinners:** Small spinner for extraction, publish, and save actions instead of just disabling the button.
- **Better empty states:** Subtle icon or illustration instead of emoji + plain text.

### Responsive Design Pass

**Desktop-specific:**
- Sidebar: refine spacing, add hover transitions, make the states list collapsible.
- Job cards on 3-column grid (xl): ensure titles don't truncate too aggressively, enough breathing room.
- Job modal: widen to `max-w-2xl` on desktop so it doesn't feel like a phone modal on a big screen.
- Admin form: better visual grouping with section dividers.
- Settings page: centered card layout that feels intentional on wide screens rather than a narrow column with wasted space.

**Mobile-specific:**
- Larger tap targets on notification bell, save buttons, filter chips.
- Notification dropdown: full-width on mobile instead of fixed `w-80`.
- Bottom tabs: verify comfortable spacing on 320px screens.
- Filter chip rows: subtle fade gradient at scroll edges to indicate overflow.

### Consistency & Polish

- Consistent border-radius, shadow, and spacing tokens across all cards and containers.
- Password show/hide toggle on all password fields.
- Proper `aria` attributes on notification dropdown, job modal (`aria-modal`, `role="dialog"`, `aria-expanded`).
- Consistent hover/focus states across all interactive elements.

### Out of Scope

- PWA / service worker
- WebSocket real-time updates
- Dark mode
- Full accessibility audit
- Internationalization beyond French
