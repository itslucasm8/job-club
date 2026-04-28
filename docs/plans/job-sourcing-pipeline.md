# Job Sourcing Pipeline

> **For Claude:** This is a code + automation plan you execute end-to-end. Lucas handles the marketing/ops items called out as **OUT OF SCOPE** — do not start those yourself.

**Goal:** Move from 100% manual copy-paste sourcing (admin team working through an 8-tab Google Sheet) to an instrumented, partly-automated ingestion pipeline. Cut admin review time, surface higher-quality listings, and eliminate "Locals only" pollution before a human ever sees it.

**Why this matters:** Inventory cost scales linearly with admin hours today. As subscriber count grows past Phase 1 (37 Podia migrants), the manual model breaks. Curation is also Job Club's product differentiation against BPJB — the more we can show "we filtered out X scams / Y locals-only roles this week," the stronger the value prop.

---

## Out of scope (Lucas handles)

- Free employer post form on the marketing site
- Outbound campaigns to packhouses, hostel chains, tourism operators
- Adding Tier A manual sources (Workforce Australia, Indeed, Jora, WWOOF, HelpX, Workaway) to the admin team's daily routine
- MLF community channel (#tu-as-vu-un-job) for member-sourced job tips
- Hiring community insiders to forward FB group posts
- Decisions about which sources from the existing sheet to retire

---

## Current state (2026-04-28)

- 905 jobs live on production
- All inventory comes from manual review of the [sourcing sheet](https://docs.google.com/spreadsheets/d/1I1AdaKLOBjMBMgvmbsFsVUg0MQq3-uve3-msadM5w60)
- Admin posts 20-30 jobs/day via `/admin` UI
- No `JobCandidate` table, no scrapers, no LLM pipeline — green field

---

## Architecture

```
sources ──► scrapers/extractors ──► job_candidates table ──► LLM classifier ──► admin review UI ──► Job (live)
                                          │                       │
                                          │                       └─► auto-reject obvious garbage
                                          └─► dedupe + yield tracking
```

The `JobCandidate` table is the spine. Every automation lands rows there. Admin UI lists them with classifier scores and one-click approve → creates a `Job`.

---

## Phase 1 — Foundation (boring + deterministic)

> Everything later depends on this. Ship in order.

### 1.1 Schema: `JobCandidate`

**File:** `prisma/schema.prisma`

Add a new model:

```prisma
model JobCandidate {
  id              String   @id @default(cuid())
  source          String                    // "workforce_australia" | "harvest_trail" | "rss:bauerorganic" | etc.
  sourceUrl       String
  sourceJobId     String?                   // platform-native ID for idempotency
  rawHtml         String?  @db.Text         // optional snapshot for debugging
  rawData         Json                      // structured payload from extractor
  dedupeHash      String                    // hash(employer + location + first 200 chars desc)
  status          String   @default("pending") // pending | approved | rejected | duplicate | auto_rejected
  rejectReason    String?
  classifierScore Json?                     // LLM output (see Phase 2)
  promotedJobId   String?                   // FK to Job once approved
  createdAt       DateTime @default(now())
  reviewedAt      DateTime?
  reviewedBy      String?

  @@index([status, createdAt])
  @@index([dedupeHash])
  @@unique([source, sourceJobId])
}
```

Add a `JobSource` table for yield tracking:

```prisma
model JobSource {
  id              String   @id @default(cuid())
  slug            String   @unique          // "workforce_australia"
  label           String                    // "Workforce Australia"
  category        String                    // "government" | "aggregator" | "ats_rss" | "competitor" | "manual"
  enabled         Boolean  @default(true)
  lastRunAt       DateTime?
  lastRunStatus   String?                   // "ok" | "error" | "skipped"
  lastRunError    String?
  totalSeen       Int      @default(0)      // candidates ingested
  totalApproved   Int      @default(0)      // promoted to Job
  totalRejected   Int      @default(0)
  createdAt       DateTime @default(now())
}
```

Run `npx prisma db push` locally + add to deployment runbook.

**Success check:** Tables exist, can insert/select via Prisma Studio.

### 1.2 Ingestion library

**File:** `src/lib/sourcing/ingest.ts`

Single entry point any scraper calls:

```ts
ingestCandidate({
  source: "workforce_australia",
  sourceJobId: "...",
  sourceUrl: "...",
  raw: { title, employer, location, state, description, payRate, postedAt, ... }
})
```

Responsibilities:
- Compute `dedupeHash`
- Skip if existing row with same `(source, sourceJobId)` or same `dedupeHash` in last 30 days
- Insert with `status="pending"`
- Increment `JobSource.totalSeen`
- Update `lastRunAt`

**Success check:** Unit-style smoke test from a Node script that calls `ingestCandidate` twice with same input and confirms the second is marked duplicate.

### 1.3 Source registry

**File:** `src/lib/sourcing/sources.ts`

Single export listing every source slug + metadata. Seeded into `JobSource` on first run via a script: `npm run sourcing:seed-sources`.

**File:** `scripts/sourcing/seed-sources.ts`

Idempotent upsert.

### 1.4 Workforce Australia scraper

**File:** `src/lib/sourcing/scrapers/workforce-australia.ts`

- Investigate whether `jobsearch.gov.au` exposes a search API or feed
- If yes: fetch + parse JSON
- If no: Playwright → render → extract structured fields
- Filter to states + casual/seasonal categories that match Job Club's audience
- Call `ingestCandidate` per row

**File:** `scripts/sourcing/run-workforce-australia.ts` — runnable via `npm run sourcing:workforce`

**Success check:** Run script locally, see new rows in `JobCandidate` with `source="workforce_australia"`, `status="pending"`.

### 1.5 Harvest Trail scraper

**File:** `src/lib/sourcing/scrapers/harvest-trail.ts`

Same pattern. National Harvest Labour Information Service is the highest-yield government source for Job Club's farm/88-day audience.

**Success check:** Same shape — fresh rows.

### 1.6 RSS / ATS aggregator

**File:** `src/lib/sourcing/scrapers/rss-aggregator.ts`

Many employer sites in the sheet's "Websites" tab use Workable, Lever, Greenhouse, or SmartRecruiters. All expose JSON or RSS. Build a single aggregator that:
- Reads feed URLs from a config file (`src/lib/sourcing/rss-feeds.ts`)
- Parses each
- Calls `ingestCandidate`

Initial config: investigate which of the 70 employer websites have ATS-backed careers pages, populate the list. Even 10-15 wins is a meaningful chunk of the long tail.

**Success check:** Aggregator runs, fresh rows from at least 5 distinct employers.

### 1.7 Admin review UI

**File:** `src/app/(app)/admin/candidates/page.tsx`

Internal page for the admin team:
- Lists pending candidates, newest first, paginated
- Each row: source, employer, title, location, posted age, classifier badges (Phase 2 fills these)
- Buttons: **Approve** (creates `Job`, marks candidate `approved`, increments `totalApproved`) / **Reject** (with reason picker) / **Open source URL**
- Filter by source, status, date range
- Search by employer/title

**Files:** `src/app/api/admin/candidates/route.ts` (GET list), `src/app/api/admin/candidates/[id]/approve/route.ts`, `src/app/api/admin/candidates/[id]/reject/route.ts`

Approve flow: copies relevant fields from `JobCandidate.rawData` into a new `Job`, sets `promotedJobId` on the candidate, runs the existing `notifications.ts` matching to alert subscribed users.

**Success check:** Admin can see a candidate, click Approve, see the new live Job in the public feed.

### 1.8 Cron orchestration

**File:** `scripts/sourcing/run-all.ts` — runs every enabled scraper sequentially, logs to `JobSource.lastRunAt/Status`.

**File:** `docker-compose.yml` — add an optional cron sidecar OR document a host-level cron entry that hits the script nightly.

**Success check:** One full nightly run executes, all enabled sources update their `lastRunAt`.

### 1.9 Yield dashboard

**File:** `src/app/(app)/admin/sources/page.tsx`

Read-only table:
- Source / category / enabled / last run / last status / total seen / total approved / approval rate (%) / total rejected

This is what tells Lucas which sources are worth keeping.

**Success check:** Page renders with at least one source row showing real numbers after a Phase 1 run.

---

## Phase 2 — LLM layer on top of structured data

> Only ship after Phase 1 is producing structured candidates reliably.

### 2.1 Classifier

**File:** `src/lib/sourcing/classifier.ts`

Uses Anthropic SDK + Claude Haiku. Inputs: candidate raw fields. Output JSON:

```ts
{
  is_backpacker_suitable: boolean,      // primary auto-reject signal
  has_88_day_signal: boolean,
  has_locals_only_red_flag: boolean,
  has_clear_pay: boolean,
  has_scam_red_flags: boolean,
  scam_reasons: string[],
  suggested_category: "farm" | "hospitality" | ...,
  suggested_state: "QLD" | "NSW" | ...,
  has_88_day_eligible_postcode: boolean,
  confidence: number,
  reasoning: string
}
```

Prompt-cache the system prompt (long, includes Job Club's curation criteria + the 9 categories + state codes + 88-day rules).

**Auto-reject rule:** if `is_backpacker_suitable === false` OR `has_scam_red_flags === true`, set candidate `status="auto_rejected"` with the classifier reason.

Wire into `ingestCandidate`: after insert, enqueue classification (synchronous for v1; can move to a queue later).

**Success check:** A locals-only listing gets auto_rejected. A real farm listing gets through with a populated `classifierScore` for the admin to see.

### 2.2 Generic web extractor

**File:** `src/lib/sourcing/scrapers/generic-extractor.ts`

For employer websites without ATS feeds:
- Playwright fetches the careers page
- Send rendered HTML to Claude Haiku with a structured-output schema
- Returns array of {title, location, description, payRate, applyContact, postedAt?}
- Each becomes a `JobCandidate`

**File:** `src/lib/sourcing/generic-targets.ts` — config of `{slug, url, employerName}` for each long-tail site.

**Success check:** Run against 3 sites from the sheet's "Websites" tab. Get usable candidates. (Some will fail — that's fine, log and skip.)

### 2.3 Classifier review UI integration

Update `admin/candidates/page.tsx` to surface classifier badges visually:
- Green: looks great
- Yellow: missing pay / unclear category
- Red flags: scam signals (still shown, not auto-rejected unless `is_backpacker_suitable=false`)

Add filters: "auto-rejected" view, "scam flagged" view.

**Success check:** Admin's effective review queue shrinks measurably; auto-rejected pile is browsable for QA.

---

## Phase 3 — Inbound channels (defer until Phase 1+2 stable)

### 3.1 Email-to-candidate ingestion

**Files:** Resend inbound webhook handler at `src/app/api/sourcing/email-inbound/route.ts`. Parse with Claude. Land in `JobCandidate` as `source="email:<sender_domain>"`.

**Setup:** `jobs@thejobclub.com.au` configured to forward to webhook. Subscribe address to relevant employer/agency newsletters.

### 3.2 Bookmarklet / browser extension for admins

**Out of scope for now.** Manual paste into the existing admin "post job" form covers this until volume requires it.

### 3.3 AI source discovery

**File:** `scripts/sourcing/discover-sources.ts` — weekly cron. Uses Claude with web search tool to find new packhouses, harvest seasons, festival staffing drives. Outputs to a `SourceCandidate` review queue (separate from `JobCandidate` — these are *new sources*, not new jobs).

---

## Phase 4 — Facebook (deferred indefinitely; legally fragile)

Document only:
- Realistic path is a logged-in browser extension that captures visible posts as the admin scrolls, not a server-side scraper.
- Cheaper alternative: pay 5-10 community insiders $50/month to forward posts to the email inbox (Phase 3.1 covers this).

No code work in this phase.

---

## Execution checklist

Phase 1:
- [ ] 1.1 `JobCandidate` + `JobSource` schema, `prisma db push`
- [ ] 1.2 `ingestCandidate()` library
- [ ] 1.3 Source registry + seed script
- [ ] 1.4 Workforce Australia scraper
- [ ] 1.5 Harvest Trail scraper
- [ ] 1.6 RSS aggregator (initial 5+ feeds)
- [ ] 1.7 Admin review UI (list + approve/reject)
- [ ] 1.8 Cron orchestration script
- [ ] 1.9 Yield dashboard page

Phase 2:
- [ ] 2.1 Classifier + auto-reject rule
- [ ] 2.2 Generic web extractor (3+ sites)
- [ ] 2.3 Classifier badges in admin UI

Phase 3:
- [ ] 3.1 Email inbound webhook
- [ ] 3.3 AI source discovery cron

---

## Environment variables to add

```
ANTHROPIC_API_KEY=          # For classifier + generic extractor (Phase 2)
SOURCING_CRON_TOKEN=        # Auth token for the run-all script if exposed via HTTP
```

---

## Rollback notes

- All new tables are additive; safe to drop with `DROP TABLE "JobCandidate", "JobSource"`.
- No existing `Job` rows are touched. Approving a candidate creates a new `Job` exactly like the manual admin form would.
- Auto-reject is recoverable: candidates aren't deleted, just marked. An admin can re-promote any auto-rejected row from the QA view.
