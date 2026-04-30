# Source Playbook (per-source self-learning)

> **For Claude:** This is a code plan you execute end-to-end. Lucas approves the first generated playbook for each source before it goes autonomous; otherwise everything else is automatic.

## Goal

Each source carries a **playbook** — a small notes document about how to extract jobs from its pages. The playbook says where each field lives on the page, what to ignore, and how to recover from known errors. Every run reads the playbook before extracting, falls back to a full Claude call when the playbook can't handle a page, and updates the playbook after the run based on what worked and what failed.

The playbook splits into two layers:

- **Site playbook** — shared across every source on the same website. DOM-level things: field selectors, ignore patterns, known errors, layout fingerprint. When `seek_fruit_picking` learns that the title sits in a particular spot, every other `seek_*` source picks it up automatically.
- **Source playbook** — per-source overrides and search-specific details. Search URL handling, default category, source-specific exceptions to a site rule.

Each source gets more surgical over time, uses fewer tokens, stays in sync when the page layout changes, and self-fixes recurring errors. Discoveries propagate across same-site siblings. Sources with no siblings (a one-off direct-employer site) just have an empty site layer.

That's the whole system. Nothing else.

## The loop, in five steps

1. **Before extracting a listing:** read the source's playbook. Try the field selectors / patterns it lists.
2. **If all required fields land:** use the result. No Claude call. Free extraction.
3. **If the playbook can't extract everything:** fall back to today's full-page Claude call.
4. **After every listing:** record which playbook entries hit and which missed.
5. **After the run:**
   - Update hit/miss counts on existing entries.
   - If a known error pattern repeated (≥3 listings failed the same way) OR the page layout fingerprint diverged from what the playbook expects: ask Claude to propose new playbook entries based on the current playbook + the failing pages + recent successful extractions. New entries land as `candidate`; they're only trusted after they hit successfully on the next run.

## What lives in the playbook

Two storage locations:

**Site playbook** — new small table `SitePlaybook` keyed by site slug (`seek_au`, `gumtree_au`, etc.). Stores DOM-level rules shared by every source on that website.

```ts
type SitePlaybook = {
  slug: string                                // 'seek_au' | 'gumtree_au' | ...
  version: number
  updatedAt: string

  fieldRules: {
    title:       Rule[]
    company:     Rule[]
    pay:         Rule[]
    location:    Rule[]
    description: Rule[]
  }

  ignorePatterns: string[]

  knownErrors: {
    pattern: string                          // "title selector returns null AND page contains 'Sign in'"
    diagnosis: string
    action: 'skip' | 'flag_for_review'
  }[]

  layoutFingerprint?: {
    hash: string
    capturedAt: string
  }
}
```

**Source playbook** — per-source overrides, stored at `JobSource.profile.playbook` (no schema migration; goes in the existing JSON column).

```ts
type SourcePlaybook = {
  version: number
  updatedAt: string

  // Which site playbook this source draws from. Null = standalone site.
  siteSlug?: string                          // 'seek_au' for all seek_* sources

  // Per-source rules layered on top of (or overriding) the site playbook.
  // Most sources will have an empty fieldRules — site rules cover them.
  fieldRules: {
    title?:       Rule[]
    company?:     Rule[]
    pay?:         Rule[]
    location?:    Rule[]
    description?: Rule[]
  }

  ignorePatterns: string[]                   // additional patterns specific to this source
  knownErrors: { pattern: string; diagnosis: string; action: 'skip' | 'flag_for_review' }[]
}

type Rule = {
  id: string
  kind: 'css_selector' | 'regex'             // start with 2 kinds; add more only if needed
  expression: string
  successCount: number
  failureCount: number
  status: 'candidate' | 'active'
  source: 'observed' | 'llm_proposed'
  scope: 'site' | 'source'                   // which layer Claude tagged this for
}
```

Adding a new column on `JobSource`: `siteSlug` (nullable string, FK-style reference to `SitePlaybook.slug`).

### Merge semantics

When extracting a listing, the runner builds an effective rule set per field by combining both layers:

- **Field rules:** source rules tried first (more specific wins), then site rules. If neither layer has any active rule for a required field, the playbook is incomplete for that listing → fall back to full Claude call.
- **Ignore patterns:** union of both lists.
- **Known errors:** union of both lists.
- **Layout fingerprint:** site-level only (same site = same layout, modulo A/B tests).

### Scope tagging

When Claude proposes a new rule, it tags `scope: 'site' | 'source'`. Defaults:

- DOM selectors for required fields → `site` (these are properties of the website, not the search term)
- Ignore patterns and known errors involving the page structure → `site`
- Source-specific exceptions ("for `seek_fruit_picking` only, ignore the partner-job widget") → `source`
- URL/discovery rules and category overrides → always `source`

When in doubt, Claude is instructed to default to `site` — if a rule turns out to be source-specific, validation will catch it (it'll only successCount on one source's pages).

## Code changes (three things)

### 1. New module: `src/lib/sourcing/playbook.ts`

Exposes:
- `loadEffectivePlaybook(sourceSlug): { site, source, merged }` — fetches both layers and computes the merged rule set used for extraction.
- `tryExtract(merged, html, url): { fields, missing[], rulesFired[] }` — runs the merged active rules against the page; tracks which rule (and which scope) produced each field.
- `updateFromOutcome(outcome)` — splits hit/miss updates back to the right layer based on `rule.scope`. Increments hit/miss counts on `SitePlaybook` rows for `scope: 'site'` rules, on `JobSource.profile.playbook` for `scope: 'source'` rules. Promotes `candidate → active` after successCount ≥ 5.
- `proposeUpdates({ sitePlaybook, sourcePlaybook, recentRuns, failingPages, successfulPages }): { siteUpdates, sourceUpdates }` — calls Claude via the existing proxy and returns proposed updates split by scope. New rules come back as `candidate`.

### 2. Runner integration: `src/lib/sourcing/runner.ts`

Inside `runOneSource`, replace the unconditional `extractFromUrl(listing.url)` call with:

```
1. Load effective playbook (site + source merged)
2. Fetch page HTML (via proxy)
3. Compute layout fingerprint
4. result = tryExtract(merged, html, url)
5. If result has all required fields → use it (no LLM call)
6. Otherwise → fall back to today's extractFromUrl()
7. Record outcome: which rules fired (with their scope), fingerprint, mode used
```

Track per-listing outcomes in memory during the run. End-of-run:
- Apply `updateFromOutcome` for each listing — hit/miss updates flow back to the right layer (site or source) based on each rule's scope.
- If conditions met (recurring error OR fingerprint drift) → call `proposeUpdates`. Site-scoped proposals merge into the `SitePlaybook` row (and instantly become available to all sibling sources). Source-scoped proposals merge into `JobSource.profile.playbook`. All new entries land as `candidate`.

### 3. Admin UI: playbook views

`src/app/(app)/admin/sources/[slug]/page.tsx` gets a "Playbook" panel showing the **merged** view (site + source) so the admin sees what rules are actually being used, with each rule labelled by scope so it's clear what's inherited from the site vs source-specific:
- Active rules per field with hit rate, scope badge, and last-fired date
- Candidate rules waiting for validation
- Known errors (combined list)
- Last layout-fingerprint update (from site)
- Button: "Approve playbook" (required only on the very first generated playbook per source — after that it's autonomous)

A separate `src/app/(app)/admin/sites/[slug]/page.tsx` page lists all `SitePlaybook` rows with their member sources, so when a Seek site rule changes you can see at a glance which sources benefit. Read-only initially; site rules are managed indirectly through the per-source flow and Claude's proposals.

## How errors get fixed automatically

The error-fix loop, in concrete terms:
- During the run, a listing fails extraction. The failure tag is recorded (`title_missing`, `description_missing`, `parse_no_anchor`, etc.).
- End of run: if ≥3 listings failed the same tag, that's a "recurring error."
- `proposeUpdates` is called with: current playbook, the 3+ failing page samples, and 3 recent successful page samples for contrast.
- Claude's job: read the failing pages, compare to the working pages, output either a new rule (CSS selector / regex) for the missing field, or a `knownErrors` entry that tells the runner to skip these pages, or an `ignorePatterns` update.
- The proposed entry goes into the playbook as `candidate`.
- Next run, candidates are tried alongside active rules. If a candidate hits 5+ times with high success, it auto-promotes to `active`. If it fails, it's dropped.

## How layout-change adaptation works

The runner stores a `layoutFingerprint` (hash of stable structural markers) on every successful extraction. The playbook records the fingerprint that was current when its active rules were last validated.

- If a run's pages have fingerprints that match the playbook's → do nothing special.
- If fingerprints diverge significantly on multiple pages → trigger `proposeUpdates` even without a clear error pattern, because "page changed but our rules still happen to hit" is a silent-failure risk we want to catch.

## Explicit non-goals

To prevent scope drift, these are NOT in this plan:

- ❌ Cross-**website** sharing (a Seek rule does NOT propagate to Gumtree). Cross-source sharing within the same website (all `seek_*` sources sharing one site playbook) IS in scope and is the whole point of the two-layer model.
- ❌ Multiple LLM execution modes (just two: playbook hits, or fall back to today's full call)
- ❌ Lifecycle states (`bootstrapping`/`learning`/`mature`) — a rule is `candidate` or `active`, that's it
- ❌ Versioned rollback history beyond `version: number` bump
- ❌ Budget / cost dashboards
- ❌ Shadow validation (running playbook + LLM in parallel to compare)
- ❌ Semantic drift detection (monitoring pay-distribution shifts, etc.)
- ❌ Auto-applied URL changes or source disabling — proposer can suggest them, but they always require human Apply

## Execution checklist

- [ ] 1. Schema: add `SitePlaybook` table (slug, version, updatedAt, fieldRules JSON, ignorePatterns JSON, knownErrors JSON, layoutFingerprint JSON). Add `JobSource.siteSlug` (nullable string). Add `JobCandidate.extractionMode` (`'playbook'` | `'full'` | `'failed'`) and `JobCandidate.layoutFingerprint`. `prisma db push`.
- [ ] 2. Backfill: set `siteSlug = 'seek_au'` on every `seek_*` source. Other sources start with `null` (standalone).
- [ ] 3. Build `src/lib/sourcing/playbook.ts` with `loadEffectivePlaybook`, `tryExtract`, `updateFromOutcome` (scope-aware), `proposeUpdates` (scope-tagged output).
- [ ] 4. Wire runner: load effective playbook, try playbook → fall back to `extractFromUrl`. Record outcomes with rule scope.
- [ ] 5. End-of-run hook: apply outcomes (route to right layer), detect recurring errors / fingerprint drift, call `proposeUpdates` when needed; merge site updates into `SitePlaybook`, source updates into `JobSource.profile.playbook`.
- [ ] 6. Admin UI: per-source playbook panel (merged view, scope badges); read-only sites listing page.
- [ ] 7. Run on `seek_fruit_picking` for 1 week. Confirm: site playbook generates, propagates to siblings on next sibling run, candidates promote, token cost drops.

## Success looks like

After 2 weeks running on Seek fruit picking:
- ≥50% of listings across all `seek_*` sources extracted via playbook (no LLM call) — the site playbook learned on `seek_fruit_picking` automatically benefits `seek_hospitality`, `seek_kitchenhand`, `seek_cleaner`, `seek_farm`.
- The Seek `?origin=` dedupe bug is gone (canonical URL handling lands as part of step 1).
- When a Seek selector is manually broken in a test, the next run on any `seek_*` source records the failure, proposes a new site-level rule, and after one validation run all five Seek sources recover.
- Lucas hasn't had to touch any Seek source manually since approving the first playbook.

## Rollback

- Per-source rollback: delete `JobSource.profile.playbook` and clear `siteSlug`. Runner falls back to today's behaviour with no playbook.
- Site-level rollback: delete the `SitePlaybook` row. Sibling sources fall back to whatever's in their own `JobSource.profile.playbook` (likely empty), then to today's full Claude call.
- Schema rollback: all new columns are nullable; new table is droppable. Nothing else breaks.
