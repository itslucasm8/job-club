# Mobile Responsiveness Polish — Design Spec

**Date:** 2026-04-08
**Status:** Approved

## Summary

Fix all Critical and High severity mobile responsiveness issues across the app. Covers viewport configuration, safe-area handling for notched phones, touch target sizing, font readability, missing bottom padding, and scroll affordance. No visual redesign — same look, better mobile experience.

## Problem

The app is built mobile-first but has systemic gaps:
- No viewport meta tag → safe-area CSS doesn't activate on notched phones
- JobModal and Toast don't account for notch/home indicator → content hidden
- Touch targets (buttons, icons) are 24-36px instead of the 44px minimum → hard to tap
- Some font sizes are 10-11px → hard to read
- 5 pages missing bottom padding → content hidden behind mobile tab bar
- Feed filter chips scroll horizontally with no visual hint

## Approach

File-by-file sweep. Fix all issues in each file at once, then move to the next. Grouped into 7 logical sections. Padding-only approach for touch targets (visual size stays the same, tap area grows).

## Changes

### Section 1: Foundation

**Files:** `src/app/layout.tsx`, `src/app/globals.css`

#### layout.tsx — Add viewport export

Add Next.js viewport metadata export:

```typescript
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}
```

`viewportFit: 'cover'` is required for `env(safe-area-inset-*)` values to be non-zero on notched phones. Without this, all safe-area padding added in other sections would have no effect.

Import `Viewport` from `next`.

#### globals.css — Browser normalization

Add to the base styles:

```css
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
```

`-webkit-text-size-adjust` prevents Safari iOS from auto-enlarging text when the viewport changes orientation. The `prefers-reduced-motion` rule respects OS-level motion preferences.

### Section 2: Safe Areas

**Files:** `src/components/JobModal.tsx`, `src/components/Toast.tsx`

#### JobModal.tsx

The modal slides up from the bottom on mobile (`flex items-end`). The action buttons at the bottom can be hidden behind the home indicator bar on notched phones.

Changes:
- Add `pb-[env(safe-area-inset-bottom)]` to the modal's inner content wrapper so action buttons clear the home indicator
- Add `overflow-x-hidden` to prevent any horizontal scroll within the modal

#### Toast.tsx

Toast is positioned `fixed bottom-20 lg:bottom-6`. On notched phones, the home indicator can obscure the toast.

Changes:
- Update mobile bottom positioning to account for safe area: `bottom-[calc(5rem+env(safe-area-inset-bottom))]`
- Add `max-w-sm` to individual toast messages to prevent full-width expansion on narrow screens

### Section 3: Touch Targets

**Files:** `src/components/TopBar.tsx`, `src/components/JobCard.tsx`, `src/app/(app)/notifications/page.tsx`, `src/app/(app)/settings/page.tsx`

All changes increase padding only — the visual size of icons and text stays the same. The tappable area grows to meet the 44px minimum.

#### TopBar.tsx

| Element | Current | Target | Change |
|---------|---------|--------|--------|
| Notification bell button | `p-1.5` (34px) | 44px | `p-2.5` |
| Profile avatar button | `w-8 h-8` (32px) | 44px | Add `p-1.5` wrapper or `w-10 h-10` with `p-1` |
| Language toggle | `px-2 py-1` (36px tall) | 44px | `py-2` |

#### JobCard.tsx

| Element | Current | Target | Change |
|---------|---------|--------|--------|
| Heart/save button | `p-1.5` (26px) | 44px | `p-2.5` |

Adjust the absolute positioning offset to account for the larger padding so the heart icon stays visually in the same spot.

#### notifications/page.tsx

| Element | Current | Target | Change |
|---------|---------|--------|--------|
| Load more button | `py-2.5` (~28px) | 44px | `py-3.5` |

#### settings/page.tsx

| Element | Current | Target | Change |
|---------|---------|--------|--------|
| Save buttons | `py-2.5` (~28px) | 44px | `py-3` |

### Section 4: Font Sizes

**Files:** `src/components/BottomTabs.tsx`, `src/components/JobCard.tsx`, `src/components/JobModal.tsx`, `src/app/(app)/notifications/page.tsx`

All changes are minimal bumps to ensure readability. No layout-breaking size changes.

| Element | File | Current | New |
|---------|------|---------|-----|
| Tab labels | BottomTabs.tsx | `text-[10px]` | `text-[11px]` |
| Admin mode switch labels | BottomTabs.tsx | `text-[10px]` | `text-[11px]` |
| Job tags | JobCard.tsx | `text-[11px]` | `text-xs` (12px) |
| "NEW" badge | JobCard.tsx | `text-[10px]` | `text-[11px]` |
| Detail labels (mobile) | JobModal.tsx | `text-[12px]` | Keep (12px is minimum acceptable) |
| Notification timestamps | notifications/page.tsx | `text-[11px]` | `text-xs` (12px) |

### Section 5: Missing Bottom Padding

**Files:** 5 pages

These pages are missing `pb-24 lg:pb-10` to account for the fixed bottom tab bar on mobile. Content at the bottom of these pages is currently hidden behind the tabs.

| Page | File |
|------|------|
| Login | `src/app/(auth)/login/page.tsx` |
| Register | `src/app/(auth)/register/page.tsx` |
| Reset Password | `src/app/(auth)/reset-password/page.tsx` |
| Subscribe | `src/app/subscribe/page.tsx` |
| Admin Publish | `src/app/(app)/admin/publish/page.tsx` |

Add `pb-24 lg:pb-10` to the outermost container div of each page.

### Section 6: Scroll Affordance + Admin Grid

**Files:** `src/app/(app)/admin/page.tsx`

The feed page filter chips already have a right-side gradient fade (`w-8 bg-gradient-to-l from-warm-bg to-transparent`) — this is adequate scroll affordance. No changes needed there.

Admin dashboard state buttons grid:
- Current: `grid-cols-4` on all screen sizes → only 80px per button on 320px phones
- Change: `grid-cols-3 sm:grid-cols-4` → 3 columns on mobile (106px each), 4 on sm+

### Section 7: Landing Page 320px Fix

**File:** `src/app/page.tsx`

The tagline paragraph has `max-w-[340px]` which exceeds the 320px screen width (minus padding).

Change: `max-w-[340px]` → `max-w-xs` (Tailwind's 320px max-width) or `max-w-[min(340px,100%)]`

This ensures the text container never exceeds the available width on any screen.

## Files Modified

| File | Changes |
|------|---------|
| `src/app/layout.tsx` | Add viewport export |
| `src/app/globals.css` | Text-size-adjust, prefers-reduced-motion |
| `src/components/JobModal.tsx` | Safe-area padding, overflow-x-hidden |
| `src/components/Toast.tsx` | Safe-area positioning, max-width |
| `src/components/TopBar.tsx` | Touch target padding (bell, avatar, language) |
| `src/components/JobCard.tsx` | Touch target padding (heart), font bumps (tags, badge) |
| `src/components/BottomTabs.tsx` | Font size bump (tab labels, mode switch) |
| `src/app/(app)/notifications/page.tsx` | Touch target (load more), font bump (timestamps) |
| `src/app/(app)/settings/page.tsx` | Touch target (save buttons) |
| `src/app/(app)/admin/page.tsx` | State buttons grid responsive |
| `src/app/page.tsx` | Landing page max-width fix |
| `src/app/(auth)/login/page.tsx` | Add pb-24 |
| `src/app/(auth)/register/page.tsx` | Add pb-24 |
| `src/app/(auth)/reset-password/page.tsx` | Add pb-24 |
| `src/app/subscribe/page.tsx` | Add pb-24 |
| `src/app/(app)/admin/publish/page.tsx` | Add pb-24 |

**16 files modified. 0 new files. 0 new dependencies.**

## What Doesn't Change

- No visual redesign — same colors, same layout, same visual hierarchy
- No new components or abstractions
- No backend changes
- No JavaScript logic changes — all fixes are CSS/Tailwind classes
- Desktop experience unchanged (all changes use mobile-first or `lg:` breakpoints)

## Testing

Manual testing on:
1. iPhone SE (375px) — smallest common iPhone
2. iPhone 14 Pro (393px) — notched phone with Dynamic Island
3. Android Chrome (360px) — common Android width
4. 320px viewport — smallest supported width
5. Desktop (1440px) — verify nothing broke

Key checks per page:
- Can you tap every button easily?
- Is all text readable without squinting?
- Is any content hidden behind the tab bar?
- Does the modal clear the home indicator?
- Do toasts appear above the tab bar?
