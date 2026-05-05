# Scrapling Pivot — Unified Non-FB Scraper

**Decided:** 2026-05-06
**Path:** A (non-FB only). FB extension keeps running as-is. Revisit FB once Scrapling is battle-tested in prod for ~1 week.

## Why

Our hand-rolled HTML adapters are fragile (Seek already broke once from a redesign, Gumtree could too) and adding a new source means designing a new adapter file from scratch. Scrapling gives us:
- One unified scraping framework with TLS fingerprint impersonation, stealth Playwright, and adaptive selectors
- A consistent shape for adding new sources
- Real trusted-event clicks (relevant later when we revisit FB)

We deliberately scope this to non-FB to **de-risk the FB account ban question** — server-side scraping of FB with our cookies is bannable. We use this pivot to learn the framework on safer surfaces first.

## Architecture

New sidecar service `services/scrapling-scraper/` (sibling of `services/claude-proxy/`):
- Python 3.11 + FastAPI + Scrapling
- `POST /scrape` — body `{adapter, url, params}` → returns `{ok, candidates, errors, debug}`
- `GET /health`
- Deployed via docker-compose alongside existing services
- Next.js calls it via HTTP from `src/lib/sourcing/runner.ts`

## Phases

### Phase 1 — Service skeleton ✅ shipped (commit 18008b9)
- `services/scrapling-scraper/` with Dockerfile, FastAPI app, /health + /scrape
- Wired into docker-compose as `scraper` service
- Bearer auth via SCRAPER_SECRET

### Phase 2 — First adapters ✅ shipped (commit 11aa591)
- Pivoted: Gumtree didn't exist as an automated source. Ported workforce_australia
  + harvest_trail instead — both share the same backend, only keywords differ.
- One Python implementation registered against both names.

### Phase 3 — Wire into runner ✅ shipped (commit 11aa591)
- Approach: kept existing TS adapter slugs/registry. Swapped the `discover()`
  implementation to call `scraplingDiscover()` instead of `proxyFetchHtml + cheerio`.
- Same JobSource rows; rollback is `git revert`.
- Added `src/lib/sourcing/scrapling-client.ts` as the thin TS→sidecar HTTP client.

### Phase 4 — Generic HTML adapter ✅ shipped
- Pivoted: Seek isn't dead (5 slices ok in prod with totalSeen 40-118 each).
- Higher-leverage move: built a `generic_html` Scrapling adapter that mirrors
  generic_career_page.ts's contract (selector + pattern + heuristic).
- One Python file now backs all 21 generic_career_page-shaped sources, including
  Seek slices, small employer career pages, and any future addition via UI.
- generic-career-page.ts now delegates to `scraplingDiscover('generic_html', ...)`.

### Phase 5 — Deploy + observe (awaiting VPS deploy)
- One-time setup: add SCRAPER_SECRET + SCRAPER_URL to .env.production
- `git pull && docker compose up -d --build` (Playwright image ~1.5GB; 5-10 min first build)
- 48h observation: ingestion rates per source, no regressions vs pre-pivot baseline
- Smoke test path: `docker compose exec app wget -qO- http://scraper:8091/health`

## Bonus shipped alongside (commit ef17b37)

The validated FB DOM spec from a sister-project debugging session was applied
to `services/fb-extension/content.js` — replacing the dead
`[role="article"][aria-posinset]` selector with `[role="feed"] > div`
gated on `[data-ad-rendering-role="story_message"]`, plus virtualization-
aware incremental capture. content.js shrunk from 850 → 330 lines.
This is independent from the Scrapling pivot but lands in the same deploy.

## Out of scope (explicitly)

- Anything FB. Extension keeps running.
- Indeed migration — current adapter works fine; defer.
- Lever/Workable/Greenhouse — these are API-based, not HTML-scraped, no benefit from Scrapling.
- LLM extraction changes — drafter.py stays as-is.

## Success criteria

1. Gumtree migrated to Scrapling, running in prod, ingestion rate ≥ current baseline
2. Seek revived, contributing candidates
3. Pattern documented: a new admin can add a new HTML source in <1 day
4. Zero impact on FB extension flow during the migration

## Open follow-ups (post-Phase 5)

- Decide FB future: stay on extension, or pivot to Scrapling stealth + residential proxy
- Consider adding Backpacker Job Board (competitor reference; if their listings are publicly scrapable, mirror the strategically interesting ones)
