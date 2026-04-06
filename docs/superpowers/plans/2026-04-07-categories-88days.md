# Category Redesign + 88 Days Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand job categories (add events, animals, transport; merge trade into construction), add an 88-day visa eligibility flag with badge + filter, and re-categorize all 889 existing jobs.

**Architecture:** Categories remain as validated strings (no Prisma enum). A new `eligible88Days` boolean column is added to the Job model. The feed gets a filter toggle and job cards get a badge. A migration script re-categorizes existing data.

**Tech Stack:** Next.js 14 (App Router), Prisma, TypeScript, Tailwind CSS, Zod

**Spec:** `docs/superpowers/specs/2026-04-07-categories-88days-design.md`

**No test framework** — use `npm run build` for type-checking and manual browser verification.

---

### Task 1: Schema — Add eligible88Days to Job model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the field and index**

In `prisma/schema.prisma`, update the `Job` model:

```prisma
model Job {
  id             String    @id @default(cuid())
  title          String
  company        String
  state          String
  location       String
  category       String
  type           String    @default("casual")
  pay            String?
  description    String
  applyUrl       String?
  sourceUrl      String?
  active         Boolean   @default(true)
  eligible88Days Boolean   @default(false)
  expiresAt      DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  savedBy        SavedJob[]
  @@index([active, expiresAt])
  @@index([eligible88Days])
}
```

- [ ] **Step 2: Push schema to local DB**

```bash
DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub" npx prisma db push
```

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add eligible88Days field to Job model"
```

---

### Task 2: Update validation — New categories + eligible88Days

**Files:**
- Modify: `src/lib/validation.ts`

- [ ] **Step 1: Update category arrays and job schemas**

Replace the `VALID_CATEGORIES` and `QUERY_CATEGORIES` constants and update `createJobSchema`:

```typescript
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const
```

```typescript
const QUERY_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other', 'all'] as const
```

In `createJobSchema`, add after the `sourceUrl` field:

```typescript
  eligible88Days: z.boolean().default(false),
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds (or shows errors in files we haven't updated yet — that's fine, we'll fix in subsequent tasks).

- [ ] **Step 3: Commit**

```bash
git add src/lib/validation.ts
git commit -m "feat: update validation with new categories and eligible88Days"
```

---

### Task 3: Update utils — French labels + catLabel

**Files:**
- Modify: `src/lib/utils.ts`

- [ ] **Step 1: Update CATEGORIES array and catLabel function**

Replace the `CATEGORIES` array:

```typescript
export const CATEGORIES = [
  { key: 'all', label: 'Tout' },
  { key: 'farm', label: 'Agriculture' },
  { key: 'hospitality', label: 'Hôtellerie' },
  { key: 'construction', label: 'Construction' },
  { key: 'retail', label: 'Commerce' },
  { key: 'cleaning', label: 'Nettoyage' },
  { key: 'events', label: 'Événements' },
  { key: 'animals', label: 'Animaux' },
  { key: 'transport', label: 'Transport' },
  { key: 'other', label: 'Autre' },
] as const
```

Replace the `catLabel` function:

```typescript
export function catLabel(key: string) {
  const map: Record<string, string> = {
    farm: 'Agriculture', hospitality: 'Hôtellerie', construction: 'Construction',
    retail: 'Commerce', cleaning: 'Nettoyage', events: 'Événements',
    animals: 'Animaux', transport: 'Transport', other: 'Autre',
  }
  return map[key] || key
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/utils.ts
git commit -m "feat: add French labels for new categories"
```

---

### Task 4: Update JobCard — New tag colors + 88 days badge

**Files:**
- Modify: `src/components/JobCard.tsx`

- [ ] **Step 1: Update tagColor map**

Replace the `tagColor` constant:

```typescript
const tagColor: Record<string, string> = {
  farm: 'bg-green-100 text-green-800',
  hospitality: 'bg-blue-100 text-blue-800',
  construction: 'bg-amber-100 text-amber-800',
  retail: 'bg-pink-100 text-pink-800',
  cleaning: 'bg-indigo-100 text-indigo-800',
  events: 'bg-violet-100 text-violet-800',
  animals: 'bg-teal-100 text-teal-800',
  transport: 'bg-sky-100 text-sky-800',
  other: 'bg-stone-100 text-stone-600',
}
```

- [ ] **Step 2: Add eligible88Days to Job interface**

Update the `Job` interface to include:

```typescript
interface Job {
  id: string; title: string; company: string; state: string; location: string;
  category: string; type: string; pay: string | null; description: string;
  createdAt: string; eligible88Days?: boolean;
}
```

- [ ] **Step 3: Add 88 days badge in tags row**

In the tags row JSX, add the badge before the category tag:

```tsx
{job.eligible88Days && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800">88 jours</span>}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/JobCard.tsx
git commit -m "feat: add new category colors and 88 days badge to JobCard"
```

---

### Task 5: Update JobModal — 88 days badge

**Files:**
- Modify: `src/components/JobModal.tsx`

- [ ] **Step 1: Add eligible88Days to the modal's job type/interface**

Find the job type definition in JobModal.tsx and add `eligible88Days?: boolean`.

- [ ] **Step 2: Add the badge in the modal header tags area**

Add the same badge as JobCard, near where category/state/type tags are rendered:

```tsx
{job.eligible88Days && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800">88 jours</span>}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/JobModal.tsx
git commit -m "feat: add 88 days badge to JobModal"
```

---

### Task 6: Update jobs API — Support eligible88Days filter

**Files:**
- Modify: `src/app/api/jobs/route.ts`

- [ ] **Step 1: Add eligible88Days to the query handling in GET**

In the GET handler, after parsing query params, add support for an `eligible88Days` filter. When the query parameter `eligible88Days=true` is present, add `eligible88Days: true` to the Prisma `where` clause.

- [ ] **Step 2: Add eligible88Days to the job select/return fields**

Make sure `eligible88Days` is included in the Prisma select or that it's returned in the response (if using `findMany` without explicit select, it's automatic).

- [ ] **Step 3: In the POST handler (job creation), handle eligible88Days**

When creating a job, accept `eligible88Days` from the request body. Also auto-detect it if not explicitly set: scan title + description for 88-day keywords.

Add this helper at the top of the file:

```typescript
function detect88Days(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase()
  return /88[\s-]?days|88[\s-]?jours|second[\s-]?year[\s-]?visa|2nd[\s-]?year[\s-]?visa|subclass[\s-]?417|specified[\s-]?work|visa[\s-]?extension|whv[\s-]?eligible/i.test(text)
}
```

In the POST handler, after validation:

```typescript
const eligible88Days = body.eligible88Days || detect88Days(body.title, body.description)
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat: support eligible88Days filter and auto-detection in jobs API"
```

---

### Task 7: Update feed page — 88 days filter toggle

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Add eligible88Days filter state**

Add a state variable:

```typescript
const [only88Days, setOnly88Days] = useState(false)
```

- [ ] **Step 2: Pass the filter to the API call**

In the `fetchJobs` function, add to the params:

```typescript
if (only88Days) params.set('eligible88Days', 'true')
```

Add `only88Days` to the `useCallback` dependency array.

- [ ] **Step 3: Add the toggle button in the filter area**

Add a toggle button before or after the category pills. It should be visually distinct — use yellow/gold styling to match the badge:

```tsx
<button
  onClick={() => setOnly88Days(!only88Days)}
  className={`flex-shrink-0 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition whitespace-nowrap ${only88Days ? 'bg-yellow-400 text-stone-900 border-yellow-400' : 'bg-white text-stone-500 border-stone-200 hover:border-yellow-300'}`}
>
  88 jours
</button>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/feed/page.tsx
git commit -m "feat: add 88 days filter toggle to feed"
```

---

### Task 8: Update admin job creation — New categories + eligible88Days checkbox

**Files:**
- Modify: `src/app/(app)/admin/jobs/page.tsx`

- [ ] **Step 1: Update the category dropdown options**

Find the `<select>` for category and ensure it renders from `CATEGORIES` (imported from utils). If it's hardcoded, switch it to use the `CATEGORIES` constant (filtering out `key: 'all'`).

- [ ] **Step 2: Add eligible88Days checkbox**

Add a checkbox field to the job creation form:

```tsx
<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="checkbox"
    checked={form.eligible88Days || false}
    onChange={e => setForm({ ...form, eligible88Days: e.target.checked })}
    className="w-4 h-4 rounded border-stone-300 text-yellow-500 focus:ring-yellow-400"
  />
  <span className="text-sm font-medium text-stone-700">Éligible 88 jours</span>
</label>
```

- [ ] **Step 3: Include eligible88Days in the form submission**

Make sure `eligible88Days` is sent in the POST body when creating a job.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/admin/jobs/page.tsx
git commit -m "feat: add new categories and eligible88Days to admin job creation"
```

---

### Task 9: Update admin job edit — New categories + eligible88Days checkbox

**Files:**
- Modify: `src/app/(app)/admin/jobs/[id]/edit/page.tsx`

- [ ] **Step 1: Same changes as Task 8 but for the edit form**

- Update category dropdown to use `CATEGORIES` from utils (filtering out `key: 'all'`).
- Add the `eligible88Days` checkbox.
- Load the existing value from the job data and include it in the PATCH submission.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/admin/jobs/[id]/edit/page.tsx
git commit -m "feat: add new categories and eligible88Days to admin job edit"
```

---

### Task 10: Write data migration script

**Files:**
- Create: `scripts/migrate-categories.ts`

- [ ] **Step 1: Write the migration script**

The script should:

1. **Merge trade → construction:** Update all jobs with `category: 'trade'` to `category: 'construction'`.

2. **Re-categorize "other" jobs** by reading their descriptions with keyword detection. Priority order (first match wins):
   - `events`: festival, event, crew, fringe, ticketing, conference, production (but not "farm production")
   - `animals`: stable, horse, koala, kennel, boarding, animal, wildlife, sanctuary, veterinary, equestrian, rider
   - `transport`: driver (standalone, not "screwdriver"), delivery, forklift, truck, motorhome, courier
   - `hospitality`: bar, restaurant, kitchen, cafe, chef, barista, bistro, hotel, motel, cook, culinary, tavern, pub, resort, food truck, baker, bakery, pastry, pizza, kebab, winemaker, venue manager
   - `farm`: farm, harvest, picker, crop, vineyard, orchard, irrigation, planting, pruning, poultry, chicken, livestock, cattle, dairy, milker, aquaculture, nursery (plant), mustering
   - `construction`: labourer, demolition, concrete, fencing, carpenter, builder, scaffold, roofing, plaster, excavat, render, electrician, plumber, mechanic, welder
   - `cleaning`: clean, housekeeper, housekeeping, car wash, detailer, janitor
   - `retail`: warehouse, store, shop, retail, packing, dispatch, letterbox

3. **Also scan non-"other" jobs** for `events`, `animals`, `transport` matches — but only upgrade if the match is strong (title contains the keyword, not just description).

4. **Set eligible88Days** for all jobs by scanning title + description for: `88 days`, `88 jours`, `second year visa`, `2nd year visa`, `subclass 417`, `specified work`, `visa extension`, `WHV eligible`.

5. **Dry-run mode** (`--dry-run`) shows proposed changes without applying.

```typescript
// Usage:
//   DATABASE_URL="..." npx tsx scripts/migrate-categories.ts --dry-run
//   DATABASE_URL="..." npx tsx scripts/migrate-categories.ts
```

The script should output:
- Count of trade → construction migrations
- Count of "other" jobs re-categorized (grouped by new category)
- Count of non-"other" jobs upgraded to new categories
- Count of eligible88Days flags set
- Total jobs unchanged

- [ ] **Step 2: Dry-run the migration**

```bash
DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub" npx tsx scripts/migrate-categories.ts --dry-run
```

Review the output. Verify the re-categorizations look correct.

- [ ] **Step 3: Run the real migration**

```bash
DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub" npx tsx scripts/migrate-categories.ts
```

- [ ] **Step 4: Verify results**

```bash
DATABASE_URL="postgresql://jobclub:changeme@localhost:5432/jobclub" node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.job.groupBy({ by: ['category'], _count: true, orderBy: { _count: { category: 'desc' } } })
  .then(r => { console.log('Categories:'); r.forEach(c => console.log('  ' + c.category + ': ' + c._count)); return p.job.count({ where: { eligible88Days: true } }); })
  .then(n => { console.log('88 days eligible:', n); p.\$disconnect(); });
"
```

Expected: No jobs with `trade` category. New categories `events`, `animals`, `transport` have counts. ~67 jobs flagged as 88-day eligible.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-categories.ts
git commit -m "feat: add category migration script with 88 days detection"
```

---

### Task 11: Build verification + manual test

- [ ] **Step 1: Full build check**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Start dev server and manual test**

```bash
npm run dev
```

Verify in browser at http://localhost:3000:

1. **Feed page:** Category filter pills show all 9 categories (Agriculture, Hôtellerie, Construction, Commerce, Nettoyage, Événements, Animaux, Transport, Autre). The "88 jours" toggle button is visible.
2. **Job cards:** New category colors appear correctly (violet for events, teal for animals, sky for transport). Jobs with `eligible88Days` show a yellow "88 jours" badge.
3. **88 days filter:** Clicking the "88 jours" toggle filters to only eligible jobs.
4. **Admin job creation:** Category dropdown has all 9 options. "Éligible 88 jours" checkbox is present.
5. **Settings:** Preferred categories section shows all 9 categories.

- [ ] **Step 3: Commit any fixes**

If any issues found during manual testing, fix and commit.
