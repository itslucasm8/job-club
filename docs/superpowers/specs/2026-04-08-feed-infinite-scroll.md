# Feed Infinite Scroll — Design Spec

**Date:** 2026-04-08
**Status:** Approved

## Summary

Add infinite scroll to the job feed so users can browse all jobs without manual pagination. Uses the browser's `IntersectionObserver` API — no new dependencies or files. The existing `/api/jobs` endpoint already supports pagination (`page`, `pages`, `total`).

## Problem

The feed currently fetches page 1 (20 jobs) and stops. With 900+ jobs in the database, users only see a fraction of available listings with no way to see more.

## Approach

**IntersectionObserver sentinel pattern.** A hidden `<div>` at the bottom of the job grid is observed by an `IntersectionObserver`. When it enters the viewport (with 200px root margin for pre-fetching), the next page is fetched and appended.

Chosen over scroll event listeners (performance cost on mobile) and third-party libraries (unnecessary dependency for ~20 lines of logic).

## Changes

### File: `src/app/(app)/feed/page.tsx`

This is the only file with significant changes.

#### New state

| State | Type | Purpose |
|-------|------|---------|
| `page` | `number` | Current page number (starts at 1) |
| `pages` | `number` | Total pages from API |
| `total` | `number` | Total job count from API |
| `loadingMore` | `boolean` | True while fetching page 2+ |

#### Initial load

On mount or filter change:
1. Reset `jobs=[]`, `page=1`, `total=0`, `pages=0`
2. Scroll to top (`window.scrollTo(0, 0)`)
3. Show 6 `JobCardSkeleton` placeholders (existing behavior)
4. Fetch `/api/jobs?page=1&...filters`
5. Store `jobs`, `total`, `pages` from response

#### Infinite scroll trigger

```
sentinel <div ref={sentinelRef}> below the job grid

useEffect:
  observer = new IntersectionObserver(callback, { rootMargin: '200px' })
  observe(sentinelRef.current)

  callback: if isIntersecting && page < pages && !loadingMore
    → set loadingMore=true
    → fetch /api/jobs?page={page+1}&...filters
    → append new jobs to existing jobs array
    → increment page
    → set loadingMore=false

  cleanup: observer.disconnect()
```

#### Loading states

| State | UI |
|-------|-----|
| Initial load | 6 `JobCardSkeleton` (existing) |
| Loading more pages | 3 `JobCardSkeleton` appended below existing cards |
| All pages loaded | Subtle text: "Toutes les offres sont affichees" / "All jobs displayed" |
| No results | Existing empty state (unchanged) |

#### Total count display

A line between the filter bar and the job grid showing the total count:
- Unfiltered: `"905 offres"` / `"905 jobs"`
- Filtered: `"32 offres"` / `"32 jobs"`

Updates dynamically when filters change or initial fetch completes. Hidden during initial loading.

#### Filter reset behavior

When any filter changes (state, category, search query, 88-day toggle):
1. Reset `jobs` to `[]`, `page` to `1`
2. `window.scrollTo(0, 0)`
3. Show initial loading skeletons
4. Fetch fresh page 1

### Translations

New strings in the translation objects:

| Key | French | English |
|-----|--------|---------|
| `feed.jobCount` | `"{count} offre(s)"` | `"{count} job(s)"` |
| `feed.allLoaded` | `"Toutes les offres sont affichees"` | `"All jobs displayed"` |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Fast scrolling | `loadingMore` flag prevents duplicate fetches |
| Slow connection | Skeleton cards show at bottom while loading |
| 0 results | Existing empty state, no sentinel rendered |
| < 20 results (single page) | Sentinel doesn't trigger — `page >= pages` |
| Save/unsave during load | `savedIds` state is independent, no conflict |
| Network error on page 2+ | Silent fail, user can scroll again to retry (observer re-fires) |

## What doesn't change

- `/api/jobs` endpoint — already supports pagination, no modifications needed
- `JobCard` component — unchanged
- `JobCardSkeleton` component — unchanged, reused for "loading more" state
- `JobModal` — unchanged
- Save/unsave logic — unchanged
- Search debounce — unchanged
- Stats strip — unchanged
