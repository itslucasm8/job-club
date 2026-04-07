# Admin UI Redesign — Design Spec

**Date:** 2026-04-07
**Status:** Approved (mockup reviewed at `docs/admin-ui-redesign-mockup.html`)

## Summary

Restructure the admin experience with a sidebar mode switch (Admin/Client), a new admin dashboard, and cleaned-up profile/settings pages.

## Changes

### 1. Sidebar Mode Switch
- Replace the hidden "view as user" toggle (was on /admin page only) with a prominent **Admin / Client** pill toggle at the top of the sidebar
- Purple = Admin mode, Amber = Client mode
- Admin mode nav: Tableau de bord, Publier une annonce, Gestion des annonces
- Client mode nav: Accueil, Tous les etats, Sauvegardes
- Non-admin users: mode switch doesn't render, only client nav shown
- Persisted in localStorage (existing behavior)

### 2. Mobile Mode Switch + Bottom Tabs
- Mode switch bar renders below the topbar on mobile (same pill toggle)
- Admin tabs (4): Dashboard, Publish, Manage Jobs, Profile
- Client tabs (4): Home, States, Saved, Profile
- Tabs swap entirely when mode is toggled

### 3. Admin Dashboard (new page at /admin)
- Stats: active jobs, users, active subscribers, 88-day jobs
- Recent activity: latest published jobs, new registrations, expired jobs
- Jobs by state: count per state
- Users preview: last 3 users with role badges, link to full user management
- Data fetched from new API endpoint `/api/admin/dashboard`

### 4. Publish Form (moved to /admin/publish)
- Exact same form, just at a new URL
- No longer shares the page with user management

### 5. Remove AdminViewBanner
- The amber top banner is replaced by the mode switch — no longer needed

### 6. Profile Cleanup
- Remove "Viewed: 0" stat (placeholder, never tracked)
- Remove "Days left: infinity" stat (placeholder, not real)
- Keep only "Saved" count (real data)
- Show subscription renewal date in the subscription card

### 7. Settings Cleanup
- Email field becomes read-only with explanation text
- Add language selector (FR/EN toggle buttons)
- Keep 3 separate save buttons (one per section)
- Specific button labels: "Enregistrer", "Changer le mot de passe", "Enregistrer les preferences"

## Routes

| Route | Before | After |
|-------|--------|-------|
| `/admin` | Publish form + user table | Dashboard |
| `/admin/publish` | (didn't exist) | Publish form |
| `/admin/jobs` | Manage jobs | Manage jobs (unchanged) |
| `/profile` | Profile with fake stats | Profile cleaned up |
| `/settings` | Settings with editable email | Settings with read-only email + language |

## Files to modify

- `src/components/Sidebar.tsx` — mode switch, dual nav
- `src/components/BottomTabs.tsx` — mode switch, dual tabs
- `src/components/TopBar.tsx` — remove viewAsUser top offset
- `src/components/AdminViewBanner.tsx` — delete
- `src/app/(app)/layout.tsx` — remove AdminViewBanner import
- `src/app/(app)/admin/page.tsx` — convert to dashboard
- `src/app/(app)/admin/publish/page.tsx` — new file (moved form)
- `src/app/(app)/profile/page.tsx` — remove fake stats
- `src/app/(app)/settings/page.tsx` — read-only email, language picker
- `src/lib/translations.ts` — new keys for dashboard, nav changes
- `src/middleware.ts` — allow /admin/publish
- `src/api/admin/dashboard/route.ts` — new API for dashboard stats
