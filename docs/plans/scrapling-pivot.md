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

### Phase 1 — Service skeleton
- `services/scrapling-scraper/` directory with Dockerfile, requirements.txt, app.py
- `/scrape` and `/health` endpoints
- `docker-compose.yml` integration
- Smoke test: fetch any public page

### Phase 2 — First adapter: Gumtree
- Port `src/lib/sourcing/adapters/gumtree-html.ts` to Python
- Use Scrapling's `Fetcher` (HTTP tier — Gumtree doesn't need stealth)
- Validate output format matches `ingestCandidate` expectations
- A/B against existing TS adapter on the same URLs

### Phase 3 — Wire into runner
- Add `JobSource.adapter = 'scrapling'` value
- Runner branches: when adapter is `scrapling`, POST to scraper service and feed result into `ingestCandidate`
- Migrate Gumtree sources from `gumtree-html` → `scrapling`
- Keep old TS adapter dormant for 1 week as fallback

### Phase 4 — Seek revival
- Currently dead. Port to Scrapling using `StealthyFetcher` if it triggers bot detection.
- Real value-add for cohort — restoring a major source.

### Phase 5 — Deploy + observe
- VPS deploy via existing pattern (git pull + docker compose up -d --build)
- 48h observation window
- Tune throttling, retry, error handling
- Document the "add a new Scrapling adapter" recipe

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
