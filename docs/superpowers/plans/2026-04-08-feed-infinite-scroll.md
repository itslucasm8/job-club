# Feed Infinite Scroll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add infinite scroll to the job feed so users can browse all 900+ jobs seamlessly on mobile.

**Architecture:** IntersectionObserver sentinel pattern. A hidden div at the bottom of the job grid triggers the next page fetch when it scrolls into view. The existing `/api/jobs` endpoint already returns paginated data (`{ jobs, total, page, pages }` with 20 per page) — no backend changes needed.

**Tech Stack:** React (useEffect, useRef, useCallback), IntersectionObserver API, existing Tailwind CSS

**Note:** This project has no test suite (no Jest, Vitest, or Playwright configured). Verification is done via manual testing with `npm run dev`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/translations.ts` | Modify (lines 83-93, 587-597) | Add `jobCount` and `allLoaded` translation strings |
| `src/app/(app)/feed/page.tsx` | Modify (entire file) | Add pagination state, IntersectionObserver, append logic, total count display |

No new files. No new dependencies.

---

### Task 1: Add translation strings

**Files:**
- Modify: `src/lib/translations.ts:83-93` (French feed section)
- Modify: `src/lib/translations.ts:587-597` (English feed section)

- [ ] **Step 1: Add French translation strings**

In `src/lib/translations.ts`, find the French `feed` object (line 83) and add two new keys after `days88`:

```typescript
  // Feed page
  feed: {
    newToday: "Nouvelles aujourd'hui",
    savedJobs: 'Offres sauvegardées',
    preferredState: 'Mon état préféré',
    searchPlaceholder: 'Rechercher un job...',
    noResults: "Aucune offre trouvée. Essaie d'autres filtres.",
    saveError: 'Erreur lors de la sauvegarde',
    jobSaved: 'Offre sauvegardée',
    jobRemoved: 'Offre retirée',
    days88: '88 jours',
    jobCount: (count: number) => `${count} offre${count !== 1 ? 's' : ''}`,
    allLoaded: 'Toutes les offres sont affichées',
  },
```

- [ ] **Step 2: Add English translation strings**

Find the English `feed` object (line 587) and add the same two keys:

```typescript
  feed: {
    newToday: 'New today',
    savedJobs: 'Saved jobs',
    preferredState: 'My preferred state',
    searchPlaceholder: 'Search for a job...',
    noResults: 'No jobs found. Try different filters.',
    saveError: 'Error saving job',
    jobSaved: 'Job saved',
    jobRemoved: 'Job removed',
    days88: '88 days',
    jobCount: (count: number) => `${count} job${count !== 1 ? 's' : ''}`,
    allLoaded: 'All jobs displayed',
  },
```

- [ ] **Step 3: Verify the app compiles**

Run: `npm run dev`
Expected: App starts without TypeScript errors. Visit `http://localhost:3000/feed` — page should load as before (no visible changes yet).

- [ ] **Step 4: Commit**

```bash
git add src/lib/translations.ts
git commit -m "feat: add infinite scroll translation strings (jobCount, allLoaded)"
```

---

### Task 2: Add pagination state and refactor fetchJobs

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Add new state variables**

In the `FeedContent` component, after the existing state declarations (around line 35-41), add:

```typescript
const [page, setPage] = useState(1)
const [pages, setPages] = useState(0)
const [total, setTotal] = useState(0)
const [loadingMore, setLoadingMore] = useState(false)
```

- [ ] **Step 2: Add a `useRef` import and sentinel ref**

Update the import line (line 2) to include `useRef`:

```typescript
import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
```

Add the ref after the state declarations:

```typescript
const sentinelRef = useRef<HTMLDivElement>(null)
```

- [ ] **Step 3: Refactor fetchJobs to support append mode**

Replace the existing `fetchJobs` function (lines 59-75) with a version that accepts a page number and can append:

```typescript
const fetchJobs = useCallback(async (pageNum: number, append = false) => {
  if (pageNum === 1) setLoading(true)
  else setLoadingMore(true)

  try {
    const params = new URLSearchParams()
    if (state !== 'all') params.set('state', state)
    if (category !== 'all') params.set('category', category)
    if (query) params.set('q', query)
    if (only88Days) params.set('eligible88Days', 'true')
    params.set('page', String(pageNum))

    const res = await fetch(`/api/jobs?${params}`)
    if (!res.ok) throw new Error('Fetch failed')
    const data = await res.json()

    if (append) {
      setJobs(prev => [...prev, ...(data.jobs || [])])
    } else {
      setJobs(data.jobs || [])
    }
    setPage(data.page || pageNum)
    setPages(data.pages || 0)
    setTotal(data.total || 0)
  } catch {
    if (!append) setJobs([])
  }

  setLoading(false)
  setLoadingMore(false)
}, [state, category, query, only88Days])
```

- [ ] **Step 4: Update the filter-change effect to reset and scroll to top**

Replace the existing `useEffect` that calls `fetchJobs` (line 77) with:

```typescript
useEffect(() => {
  setJobs([])
  setPage(1)
  setPages(0)
  setTotal(0)
  window.scrollTo(0, 0)
  fetchJobs(1, false)
}, [fetchJobs])
```

- [ ] **Step 5: Verify the app compiles and page 1 still loads**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`
Expected: First 20 jobs load as before. Filters work. No errors in console.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/feed/page.tsx
git commit -m "feat: refactor feed state for pagination support"
```

---

### Task 3: Add IntersectionObserver and sentinel element

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Add the IntersectionObserver effect**

After the filter-change effect (from Task 2 Step 4), add a new `useEffect` for the observer:

```typescript
// Infinite scroll: observe sentinel to load next page
useEffect(() => {
  const sentinel = sentinelRef.current
  if (!sentinel) return

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && page < pages && !loadingMore) {
        fetchJobs(page + 1, true)
      }
    },
    { rootMargin: '200px' }
  )

  observer.observe(sentinel)
  return () => observer.disconnect()
}, [page, pages, loadingMore, fetchJobs])
```

- [ ] **Step 2: Add sentinel div and loading-more skeletons to the JSX**

In the return JSX, after the closing `</div>` of the job grid (the div with `className="px-4 sm:px-5 lg:px-7 py-4 pb-24 ..."`), and before the `<JobModal>`, add:

```tsx
{/* Infinite scroll sentinel + loading more indicator */}
{!loading && jobs.length > 0 && (
  <>
    {loadingMore && (
      <div className="px-4 sm:px-5 lg:px-7 pb-4 grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <JobCardSkeleton key={`more-${i}`} />
        ))}
      </div>
    )}
    {page >= pages && !loadingMore && (
      <div className="text-center py-6 pb-24 lg:pb-10">
        <p className="text-sm text-stone-400">{t.feed.allLoaded}</p>
      </div>
    )}
    <div ref={sentinelRef} className="h-1" />
  </>
)}
```

- [ ] **Step 3: Verify infinite scroll works**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`

Test cases:
1. Scroll down — when you approach the bottom, 3 skeleton cards should appear and then new jobs load
2. Keep scrolling — more pages load automatically
3. Scroll to the very end — "Toutes les offres sont affichées" message appears
4. Change a filter (e.g. click QLD) — feed resets to top, loads fresh results
5. Search for something with few results (e.g. a specific company name) — should show results without triggering infinite load if all fit on one page

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/feed/page.tsx
git commit -m "feat: add infinite scroll with IntersectionObserver sentinel"
```

---

### Task 4: Add total job count display

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Add the count line between filters and job grid**

In the JSX, find the closing `</div>` of the sticky filter bar (the div with `className="sticky top-[60px] z-30 ..."`). Immediately after it, before the job grid div, add:

```tsx
{/* Total count */}
{!loading && total > 0 && (
  <div className="px-4 sm:px-5 lg:px-7 pt-3 pb-1">
    <p className="text-xs font-medium text-stone-400">{t.feed.jobCount(total)}</p>
  </div>
)}
```

- [ ] **Step 2: Verify the count displays correctly**

Run: `npm run dev`
Visit: `http://localhost:3000/feed`

Test cases:
1. Unfiltered: should show something like "905 offres" (or current total)
2. Filter by QLD: count should update to show QLD-only total
3. Search with 0 results: count should not appear (existing empty state shows instead)
4. Search with 1 result: should show "1 offre" (singular)
5. Switch language to English: should show "905 jobs" etc.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/feed/page.tsx
git commit -m "feat: show total job count above feed results"
```

---

### Task 5: Adjust bottom padding and final polish

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Remove hardcoded bottom padding from job grid**

The job grid div currently has `pb-24 lg:pb-10` to account for mobile bottom tabs. Now that the "all loaded" message and sentinel sit below, update the grid's className to remove the extra bottom padding:

Change:
```
className="px-4 sm:px-5 lg:px-7 py-4 pb-24 lg:pb-10 grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
```

To:
```
className="px-4 sm:px-5 lg:px-7 py-4 grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
```

The `pb-24 lg:pb-10` is now on the "all loaded" message (already added in Task 3).

- [ ] **Step 2: Full end-to-end verification**

Run: `npm run dev`

Complete test walkthrough:
1. **Initial load:** Feed shows 20 jobs with skeletons during load, then job count appears (e.g. "905 offres")
2. **Scroll down:** New jobs auto-load as you approach the bottom, 3 skeleton placeholders show while loading
3. **Keep scrolling:** Multiple pages load seamlessly
4. **Reach the end:** "Toutes les offres sont affichées" message appears
5. **Filter by state:** Feed resets, scrolls to top, count updates
6. **Filter by category:** Same reset behavior
7. **Search:** Debounced search resets feed, count updates
8. **88-day toggle:** Feed resets and filters correctly
9. **Combined filters:** State + category + search + 88-day all work together
10. **Save a job while scrolling:** Heart toggle works, no scroll jump
11. **Open job modal:** Modal opens correctly for any loaded job
12. **Mobile viewport:** Test at 375px width — everything fits, no horizontal overflow
13. **Language toggle:** Switch to English — "jobs" label, "All jobs displayed" message
14. **Empty results:** Search for gibberish — shows existing empty state, no count shown

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/feed/page.tsx
git commit -m "feat: polish infinite scroll padding and layout"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Translation strings | `translations.ts` |
| 2 | Pagination state + fetchJobs refactor | `feed/page.tsx` |
| 3 | IntersectionObserver + sentinel + loading UI | `feed/page.tsx` |
| 4 | Total job count display | `feed/page.tsx` |
| 5 | Padding polish + full verification | `feed/page.tsx` |

Total: 2 files modified, 0 new files, 0 new dependencies, 5 commits.
