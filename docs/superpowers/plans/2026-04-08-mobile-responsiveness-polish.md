# Mobile Responsiveness Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Critical and High severity mobile responsiveness issues so the app works well on all phones and browsers.

**Architecture:** File-by-file CSS/Tailwind-only changes. No JavaScript logic changes, no new components, no new dependencies. Padding-only approach for touch targets (visual size unchanged, tap area grows).

**Tech Stack:** Tailwind CSS, Next.js viewport metadata API

**Note:** This project has no test suite (no Jest, Vitest, or Playwright configured). Verification is done via manual testing with `npm run dev`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/layout.tsx` | Modify (lines 1-14) | Add viewport export for safe-area support |
| `src/app/globals.css` | Modify (lines 1-4) | Add text-size-adjust and prefers-reduced-motion |
| `src/components/JobModal.tsx` | Modify (lines 48, 66) | Add safe-area padding and overflow-x-hidden |
| `src/components/Toast.tsx` | Modify (lines 38, 42) | Safe-area positioning, max-width on messages |
| `src/components/TopBar.tsx` | Modify (lines 106-111, 115-116, 177-178) | Increase touch target padding on bell, avatar, language toggle |
| `src/components/JobCard.tsx` | Modify (lines 35-43, 55-57, 79-85) | Increase heart button padding, bump tag/badge font sizes |
| `src/components/BottomTabs.tsx` | Modify (lines 41, 50, 54, 63, 81) | Bump tab label and mode switch font sizes |
| `src/app/(app)/notifications/page.tsx` | Modify (lines 146, 157-159) | Bump timestamp font, increase load-more button padding |
| `src/app/(app)/settings/page.tsx` | Modify (line 241) | Increase save button padding |
| `src/app/(app)/admin/page.tsx` | Modify (line 264) | Fix state buttons grid for 320px screens |
| `src/app/page.tsx` | Modify (line 39) | Fix tagline max-width for 320px screens |

No new files. No new dependencies.

---

### Task 1: Foundation — viewport meta and CSS normalization

**Files:**
- Modify: `src/app/layout.tsx:1-14`
- Modify: `src/app/globals.css:1-4`

- [ ] **Step 1: Add viewport export to layout.tsx**

Add a `Viewport` import and export above the existing `metadata` export. In `src/app/layout.tsx`, change the imports and add the viewport:

```typescript
import type { Viewport } from 'next'
import './globals.css'
import { Inter } from 'next/font/google'
import PostHogProvider from '@/components/PostHogProvider'
import { LanguageProvider } from '@/components/LanguageContext'

// Force all pages to render dynamically (no stale pre-rendered HTML)
export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin'] })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata = {
  title: 'Job Club — Jobs for Backpackers in Australia',
  description: 'Find your next job in Australia. Hundreds of backpacker-friendly job listings updated weekly.',
}
```

The key addition is `viewportFit: 'cover'` — this tells the browser to render into the full screen including behind the notch. Without it, `env(safe-area-inset-*)` CSS values are always `0`, so all safe-area padding in other tasks would have no effect.

- [ ] **Step 2: Add CSS normalization to globals.css**

In `src/app/globals.css`, add these rules immediately after the `@tailwind` directives (before the `:root` block):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  -webkit-text-size-adjust: 100%;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

:root {
  --purple: #6b21a8;
```

`-webkit-text-size-adjust: 100%` prevents Safari iOS from auto-enlarging text on orientation change. The `prefers-reduced-motion` rule respects users who have enabled "reduce motion" in their OS settings.

- [ ] **Step 3: Verify the app compiles and loads**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`
Expected: App loads normally. Inspect the `<meta name="viewport">` tag in browser DevTools — it should now include `viewport-fit=cover`.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "fix: add viewport meta and CSS normalization for mobile"
```

---

### Task 2: Safe areas — JobModal and Toast

**Files:**
- Modify: `src/components/JobModal.tsx:48, 66`
- Modify: `src/components/Toast.tsx:38, 42`

- [ ] **Step 1: Add safe-area padding to JobModal**

In `src/components/JobModal.tsx`, make two changes:

**Change 1 (line 48):** Add `overflow-x-hidden` to the modal container to prevent any horizontal scroll:

Find:
```
className="w-full max-w-xl lg:max-w-2xl max-h-[88vh] lg:max-h-[85vh] bg-white rounded-t-2xl lg:rounded-2xl overflow-y-auto animate-slide-up-modal lg:animate-fade-in relative"
```

Replace with:
```
className="w-full max-w-xl lg:max-w-2xl max-h-[88vh] lg:max-h-[85vh] bg-white rounded-t-2xl lg:rounded-2xl overflow-y-auto overflow-x-hidden animate-slide-up-modal lg:animate-fade-in relative"
```

**Change 2 (line 66):** Add safe-area-inset-bottom padding to the content wrapper so action buttons aren't hidden behind the home indicator:

Find:
```
<div className="px-5 sm:px-6 lg:px-8 pb-8 lg:pt-6">
```

Replace with:
```
<div className="px-5 sm:px-6 lg:px-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-8 lg:pt-6">
```

On mobile, this gives `2rem` (32px) base padding plus the safe-area-inset (e.g., 34px on iPhone). On desktop (`lg:`), it stays at `pb-8` (32px) since there's no home indicator.

- [ ] **Step 2: Fix Toast safe-area positioning and max-width**

In `src/components/Toast.tsx`, make two changes:

**Change 1 (line 38):** Update the container positioning to account for safe area on mobile:

Find:
```
<div className="fixed bottom-20 lg:bottom-6 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
```

Replace with:
```
<div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
```

`5rem` (80px) is the existing `bottom-20` value. Adding `env(safe-area-inset-bottom)` ensures the toast clears the home indicator on notched phones.

**Change 2 (line 42):** Add `max-w-sm` to individual toast messages to prevent full-width expansion:

Find:
```
className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up ${
```

Replace with:
```
className={`pointer-events-auto max-w-sm px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up ${
```

- [ ] **Step 3: Verify safe areas work**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`

Test:
1. Open a job modal — the action buttons at the bottom should have extra space below them
2. Save a job — the toast should appear above the bottom tab bar
3. On desktop, verify the modal and toast look unchanged

- [ ] **Step 4: Commit**

```bash
git add src/components/JobModal.tsx src/components/Toast.tsx
git commit -m "fix: add safe-area handling for JobModal and Toast on notched phones"
```

---

### Task 3: Touch targets — TopBar

**Files:**
- Modify: `src/components/TopBar.tsx:106-111, 115-116, 177-178`

- [ ] **Step 1: Increase language toggle touch target**

In `src/components/TopBar.tsx`, find the language toggle button (line 106-111):

Find:
```
          className="px-2 py-1 rounded-lg text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-600 transition"
```

Replace with:
```
          className="px-2.5 py-2 rounded-lg text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-600 transition"
```

Changes: `py-1` → `py-2` (8px → 16px vertical padding, bringing height to ~44px). `px-2` → `px-2.5` (slightly wider tap area).

- [ ] **Step 2: Increase notification bell touch target**

Find the bell button (line 115-116):

Find:
```
            className="relative p-1.5"
```

Replace with:
```
            className="relative p-2.5"
```

Changes: `p-1.5` → `p-2.5` (6px → 10px padding, bringing total size from 34px to ~44px).

- [ ] **Step 3: Increase profile avatar touch target**

Find the profile button (line 177-178):

Find:
```
        <button onClick={() => router.push('/profile')}
          className="w-8 h-8 rounded-full bg-purple-50 border-2 border-purple-300 flex items-center justify-center text-xs font-bold text-purple-700">
```

Replace with:
```
        <button onClick={() => router.push('/profile')}
          className="w-10 h-10 rounded-full bg-purple-50 border-2 border-purple-300 flex items-center justify-center text-xs font-bold text-purple-700">
```

Changes: `w-8 h-8` → `w-10 h-10` (32px → 40px). Combined with the border, this reaches ~44px. The avatar letter stays centered.

- [ ] **Step 4: Verify TopBar touch targets**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`

Test on mobile viewport (375px width in DevTools):
1. Language toggle — should be easy to tap, visually slightly taller
2. Notification bell — should be easy to tap, slightly more space around the icon
3. Profile avatar — should be slightly larger but same visual style

- [ ] **Step 5: Commit**

```bash
git add src/components/TopBar.tsx
git commit -m "fix: increase TopBar touch targets to 44px minimum"
```

---

### Task 4: Touch targets and fonts — JobCard

**Files:**
- Modify: `src/components/JobCard.tsx:35-43, 55-57, 79-85`

- [ ] **Step 1: Increase heart button touch target**

In `src/components/JobCard.tsx`, find the heart/save button. The button is absolutely positioned in the top-right corner. We need to increase its padding while adjusting the position to keep the icon visually in the same spot.

Find:
```
      <button onClick={e => { e.stopPropagation(); onSave() }}
        className="absolute top-3 right-3 p-1.5 rounded-full transition-all group/heart"
```

Replace with:
```
      <button onClick={e => { e.stopPropagation(); onSave() }}
        className="absolute top-2 right-2 p-2.5 rounded-full transition-all group/heart"
```

Changes: `p-1.5` → `p-2.5` (6px → 10px padding), `top-3 right-3` → `top-2 right-2` (compensate for larger padding so the icon stays visually in the same spot).

- [ ] **Step 2: Bump "NEW" badge font size**

Find the NEW badge (around line 55-57):

Find:
```
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-sm">
```

Replace with:
```
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-sm">
```

Change: `text-[10px]` → `text-[11px]`.

- [ ] **Step 3: Bump tag font sizes**

Find the tags section (around line 79-85). The tags use `text-[11px]`:

Find:
```
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {job.eligible88Days && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800">{t.jobCard.days88}</span>}
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${tagColor[job.category] || tagColor.other}`}>{catLabel(job.category, language)}</span>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{typeLabel(job.type, language)}</span>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">{job.state}</span>
```

Replace with:
```
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {job.eligible88Days && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800">{t.jobCard.days88}</span>}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tagColor[job.category] || tagColor.other}`}>{catLabel(job.category, language)}</span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{typeLabel(job.type, language)}</span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">{job.state}</span>
```

Change: `text-[11px]` → `text-xs` (12px) on all four tag spans.

- [ ] **Step 4: Verify JobCard changes**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`

Test:
1. Heart button — tap it on mobile viewport, should be much easier to hit
2. Tags — should be slightly more readable (11px → 12px), no layout overflow
3. NEW badge — slightly larger text, still fits in the badge

- [ ] **Step 5: Commit**

```bash
git add src/components/JobCard.tsx
git commit -m "fix: increase JobCard heart touch target and bump tag font sizes"
```

---

### Task 5: Font sizes — BottomTabs

**Files:**
- Modify: `src/components/BottomTabs.tsx:41, 50, 54, 63, 81`

- [ ] **Step 1: Bump tab label font size**

In `src/components/BottomTabs.tsx`, find the tab label (line 81):

Find:
```
              <span className="text-[10px] font-semibold">{tab.label}</span>
```

Replace with:
```
              <span className="text-[11px] font-semibold">{tab.label}</span>
```

- [ ] **Step 2: Bump admin mode switch font sizes**

Find the admin mode switch button (line 41):

Find:
```
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                !inUserMode
                  ? 'bg-purple-700 text-white shadow-sm'
                  : 'text-stone-500'
              }`}
```

Replace with:
```
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                !inUserMode
                  ? 'bg-purple-700 text-white shadow-sm'
                  : 'text-stone-500'
              }`}
```

Find the user mode switch button (line 54):

Find:
```
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                inUserMode
                  ? 'bg-amber-400 text-stone-900 shadow-sm'
                  : 'text-stone-500'
              }`}
```

Replace with:
```
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                inUserMode
                  ? 'bg-amber-400 text-stone-900 shadow-sm'
                  : 'text-stone-500'
              }`}
```

- [ ] **Step 3: Verify BottomTabs readability**

Run: `npm run dev`
Visit: `http://localhost:3000/feed` on mobile viewport

Test:
1. Tab labels ("Accueil", "States", "Favoris", "Profil") — slightly more readable
2. Admin mode switch (if admin) — labels slightly more readable
3. No layout overflow or wrapping issues

- [ ] **Step 4: Commit**

```bash
git add src/components/BottomTabs.tsx
git commit -m "fix: bump BottomTabs font sizes for mobile readability"
```

---

### Task 6: Touch targets and fonts — Notifications and Settings

**Files:**
- Modify: `src/app/(app)/notifications/page.tsx:146, 157-159`
- Modify: `src/app/(app)/settings/page.tsx:241`

- [ ] **Step 1: Bump notification timestamp font size**

In `src/app/(app)/notifications/page.tsx`, find the timestamp (line 146):

Find:
```
                    <div className="text-[11px] text-stone-400 flex-shrink-0">{language === 'fr' ? `Il y a ${timeAgo(new Date(notif.createdAt), language)}` : `${timeAgo(new Date(notif.createdAt), language)} ago`}</div>
```

Replace with:
```
                    <div className="text-xs text-stone-400 flex-shrink-0">{language === 'fr' ? `Il y a ${timeAgo(new Date(notif.createdAt), language)}` : `${timeAgo(new Date(notif.createdAt), language)} ago`}</div>
```

Change: `text-[11px]` → `text-xs` (12px).

- [ ] **Step 2: Increase load-more button touch target**

Find the load-more button (line 157-159):

Find:
```
                className="px-6 py-2.5 rounded-lg text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 transition disabled:opacity-50"
```

Replace with:
```
                className="px-6 py-3.5 rounded-lg text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 transition disabled:opacity-50"
```

Change: `py-2.5` → `py-3.5` (~28px → ~44px height).

- [ ] **Step 3: Increase settings save button touch target**

In `src/app/(app)/settings/page.tsx`, find the personal info save button (line 241):

Find:
```
            className="w-full py-2.5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
```

Replace with:
```
            className="w-full py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
```

Change: `py-2.5` → `py-3` (~28px → ~36px). Not quite 44px, but full-width buttons have a large horizontal hit area that compensates.

- [ ] **Step 4: Verify notifications and settings**

Run: `npm run dev`

Test notifications (`/notifications`):
1. Timestamps should be slightly more readable
2. "Load more" button should be taller and easier to tap

Test settings (`/settings`):
1. Save button should be slightly taller

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/notifications/page.tsx" "src/app/(app)/settings/page.tsx"
git commit -m "fix: improve touch targets and font sizes on notifications and settings"
```

---

### Task 7: Admin grid and landing page fixes

**Files:**
- Modify: `src/app/(app)/admin/page.tsx:264`
- Modify: `src/app/page.tsx:39`

- [ ] **Step 1: Fix admin state buttons grid for small screens**

In `src/app/(app)/admin/page.tsx`, find the state buttons grid (line 264):

Find:
```
          <div className="p-4 grid grid-cols-4 gap-2">
```

Replace with:
```
          <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
```

Change: `grid-cols-4` → `grid-cols-3 sm:grid-cols-4`. On phones under 640px, 3 columns (~106px each) instead of 4 (~80px each). On sm+ screens, back to 4 columns.

- [ ] **Step 2: Fix landing page tagline max-width**

In `src/app/page.tsx`, find the tagline paragraph (line 39):

Find:
```
          <p className="text-[15px] text-purple-300 leading-relaxed max-w-[340px] mb-8">
```

Replace with:
```
          <p className="text-[15px] text-purple-300 leading-relaxed max-w-xs sm:max-w-[340px] mb-8">
```

Change: `max-w-[340px]` → `max-w-xs sm:max-w-[340px]`. `max-w-xs` is Tailwind's 320px, which fits on the smallest phones. On sm+ (640px), it goes back to 340px.

- [ ] **Step 3: Verify both fixes**

Run: `npm run dev`

Test admin (`/admin`) at 320px viewport:
1. State buttons grid should show 3 columns, comfortably sized

Test landing page (`/`) at 320px viewport:
1. Tagline text should not overflow horizontally

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/page.tsx" src/app/page.tsx
git commit -m "fix: responsive grid and max-width for small mobile screens"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Viewport meta + CSS normalization | `layout.tsx`, `globals.css` |
| 2 | Safe-area handling for modal + toast | `JobModal.tsx`, `Toast.tsx` |
| 3 | TopBar touch targets (bell, avatar, language) | `TopBar.tsx` |
| 4 | JobCard touch target (heart) + font bumps (tags, badge) | `JobCard.tsx` |
| 5 | BottomTabs font size bumps | `BottomTabs.tsx` |
| 6 | Notifications + Settings touch targets and fonts | `notifications/page.tsx`, `settings/page.tsx` |
| 7 | Admin grid + landing page 320px fixes | `admin/page.tsx`, `page.tsx` |

Total: 11 files modified, 0 new files, 0 new dependencies, 7 commits.
