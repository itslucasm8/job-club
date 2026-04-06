# Category Redesign + 88 Days Eligibility Flag

**Date:** 2026-04-07
**Status:** Approved
**Context:** After importing 889 real jobs from Podia, the existing category list didn't cover all job types well. Additionally, "88 days eligible" is the most sought-after attribute for WHV backpackers and needs first-class support.

---

## 1. Category Changes

### Old categories
`farm, hospitality, construction, trade, retail, cleaning, other`

### New categories
`farm, hospitality, construction, retail, cleaning, events, animals, transport, other`

| Key | French label | Tag color | What it covers |
|-----|-------------|-----------|----------------|
| farm | Agriculture | green (bg-green-100 text-green-800) | Fruit picking, harvesting, planting, crop care, livestock, dairy, poultry, vineyard, horticulture |
| hospitality | Hôtellerie | blue (bg-blue-100 text-blue-800) | Bars, restaurants, cafes, hotels, resorts, catering, food service, baking, food trucks |
| construction | Construction | amber (bg-amber-100 text-amber-800) | Building, demolition, labouring, trades (electrician, plumber, carpenter, painter, fencing, roofing). Absorbs old "trade" category |
| retail | Commerce | pink (bg-pink-100 text-pink-800) | Shops, warehouses, stores, customer service, packing, dispatch |
| cleaning | Nettoyage | indigo (bg-indigo-100 text-indigo-800) | Cleaning, housekeeping, janitorial |
| events | Événements | violet (bg-violet-100 text-violet-800) | Festivals, events, conferences, production crews, ticketing, event setup/teardown |
| animals | Animaux | teal (bg-teal-100 text-teal-800) | Animal care, stables, kennels, wildlife sanctuaries, veterinary, equestrian |
| transport | Transport | sky (bg-sky-100 text-sky-800) | Drivers, delivery, forklift operators, truck drivers |
| other | Autre | stone (bg-stone-100 text-stone-600) | Anything that doesn't fit above |

### Migration rules
- `trade` → `construction` (2 existing jobs)
- Re-categorize all "other" jobs by reading their descriptions with smarter keyword matching
- Re-scan ALL jobs with improved detection that reads descriptions, not just titles

---

## 2. 88 Days Eligibility Flag

### Schema
Add `eligible88Days Boolean @default(false)` to the Job model with an index for fast filtering.

### Auto-detection
When a job is created or imported, scan title + description for keywords:
- `88 days`, `88 jours`, `88-day`
- `second year visa`, `2nd year visa`
- `subclass 417`, `specified work`
- `visa extension`, `WHV eligible`

If any match → `eligible88Days = true`. This is a best-effort text match for now.

**Phase 2 (not in this spec):** Cross-check against the Australian government's official list of eligible postcodes and industries for specified subclass 417 work.

### Admin UI
- Add a checkbox on the job creation and edit forms: "Éligible 88 jours" (default unchecked)
- Admins can manually toggle this regardless of auto-detection

### Feed filter
- A toggle button in the feed filter area, visually distinct from the category pills
- When active, only shows jobs where `eligible88Days = true`
- Can be combined with state and category filters

### Job card badge
- A small tag on qualifying job cards: "88 jours"
- Distinctive color (yellow/gold: `bg-yellow-100 text-yellow-800`) to stand out from category tags
- Appears in the tags row next to category, state, and type tags

### Job modal
- Same badge displayed in the modal header area

---

## 3. Approach

Keep `category` as a plain string in the database (current pattern). Validation is enforced at the API layer via Zod schemas in `validation.ts`. This is consistent with how `state` and `type` are handled — no Prisma enums, just validated strings.

Single category per job (no multi-category support). Edge cases (11 jobs with overlapping keywords) get the best-fit category.

---

## 4. Files to Modify

### Schema & validation
- `prisma/schema.prisma` — Add `eligible88Days` field + index
- `src/lib/validation.ts` — Update `VALID_CATEGORIES`, `QUERY_CATEGORIES`, add `eligible88Days` to job schemas

### Labels & colors
- `src/lib/utils.ts` — Update `CATEGORIES` array, `catLabel()` function
- `src/components/JobCard.tsx` — Add `tagColor` entries + 88 days badge rendering
- `src/components/JobModal.tsx` — Add 88 days badge rendering

### Feed & filters
- `src/app/(app)/feed/page.tsx` — Add 88 days filter toggle
- `src/app/api/jobs/route.ts` — Support `eligible88Days` query parameter

### Admin
- `src/app/(app)/admin/jobs/page.tsx` — New categories in dropdown + eligible88Days checkbox
- `src/app/(app)/admin/jobs/[id]/edit/page.tsx` — Same for edit form

### Data migration script
- New script or update `scripts/import-podia-jobs.ts` — Re-categorize existing 889 jobs + set eligible88Days flags

### No changes needed
- `src/app/(app)/settings/page.tsx` — Preferences render from `CATEGORIES` dynamically
- `src/lib/notifications.ts` — Matches against string values, works with any category
- `src/app/api/user/settings/route.ts` — Stores as comma-separated string, category-agnostic
- `src/lib/email.ts` — Uses `catLabel()` which will be updated

---

## 5. Data migration for existing 889 jobs

### Re-categorization
Run a migration script that:
1. Changes all `trade` → `construction`
2. Re-scans every job's title + description with improved keyword detection
3. Assigns new categories (`events`, `animals`, `transport`) where appropriate
4. Falls back to existing category if no better match is found — only upgrade to a new category (`events`, `animals`, `transport`) or fix mismatches, never overwrite a correct existing categorization with a worse one

### 88 days detection
Scan all 889 jobs for 88-day keywords and set the flag. Expected: ~67 jobs will be flagged based on our earlier analysis.

---

## 6. What's NOT in scope

- Multi-category support (each job has exactly one category)
- Government postcode/industry verification for 88 days (Phase 2)
- Image support for job posts (Phase 2)
- Filtering old/expired Podia jobs (separate task)
- Production deployment of these changes (separate task)
