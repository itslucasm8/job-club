# Facebook Group Scraper — Browser Extension

> **For Claude:** This is a code plan you execute end-to-end. Lucas approves the architecture before the first commit lands; otherwise everything else is automatic.

## Goal

A Chrome extension that, while running on the office machine logged into a spare FB account, harvests posts from configured WHV-related Facebook groups and ships them through Job Club's existing source pipeline. Each post becomes a `JobCandidate` like any other source — same playbook learning, same classifier, same review queue.

The extension uses Lucas's real authenticated FB session (no headless scraping, no anti-bot dance) and runs on a schedule via Windows Task Scheduler. Each daily run yields ~50-200 fresh post candidates pre-filtered by the existing classifier; admin reviews the cream.

## Why this design

Three shape decisions that fall out of constraints already established:

1. **Scrape from inside a real browser, not a server.** FB is hostile to headless browsers but indifferent to a logged-in real user reading their feed. The office machine — always-on, real residential IP, real hardware fingerprint, never used by anyone — is a perfect host for this.
2. **Send raw post HTML to the backend, not pre-parsed JSON.** Reusing the playbook system from `2eee84a` means we don't bake parsing logic into the extension. When FB rotates their DOM, the proposer relearns; admins never reinstall.
3. **One JobSource per group.** Each group gets its own row with `adapter='extension'`, `siteSlug='facebook_groups'`. The shared SitePlaybook learns FB's DOM once; every group benefits.

## Non-goals

- ❌ Mobile / FB-app scraping (out of scope; desktop only)
- ❌ Reading personal feed, friends, DMs (extension only operates on configured group URLs)
- ❌ Automated commenting, reacting, posting (read-only)
- ❌ Multi-account management (one FB session per office machine; if one breaks, swap manually)
- ❌ Cross-platform desktop apps (Chrome on Windows only — covers the office machine)
- ❌ Self-update / Chrome Web Store distribution (sideload-as-zip; one machine to maintain)

## Architecture

```
                         Office machine (Windows, always on)
                         ─────────────────────────────────────
                         Chrome (logged into spare FB account)
                         ↓
                         FB-Scraper extension
                            ├── Service worker: scheduling + state
                            ├── Content script: auto-scroll + DOM scrape
                            └── Options page: token, group list config
                         ↓ POST batches
       ────────────────────────────────────────────────────────────
       Job Club backend (Next.js on VPS)
       ↓
       /api/extension/* endpoints
         ├── GET  /api/extension/groups       (list of groups to scrape, with state)
         ├── POST /api/extension/ingest-batch (accept post batches)
         └── POST /api/extension/heartbeat    (extension reports run completion + stats)
       ↓
       Existing pipeline:
         playbook extraction → classifier → JobCandidate → /admin/candidates
```

## Backend changes

### 1. Schema additions (minimal — JobSource already supports `adapter='extension'`)

**No new tables.** The new fields needed already exist:
- `JobSource.adapter` = `'extension'` (existing)
- `JobSource.siteSlug` = `'facebook_groups'` (existing field, new value)
- `JobSource.config` = `{ groupId, groupUrl, groupName, lastScrapedPostId }` (existing JSON field)

One small addition for tracking when the extension last successfully ran each group, so it can avoid re-scraping the same posts:
- `JobSource.lastScrapedAt` — already covered by `lastRunAt`, no new column

**Add one row to seed**: `SitePlaybook` with `slug='facebook_groups'`, label `'Facebook Groups'`, empty rules. The playbook will fill in over the first 1-2 weeks of runs.

### 2. URL canonicalization (`src/lib/sourcing/url-canonical.ts`)

Add an `fb_groups` profile to `SITE_PROFILES`:

```ts
fb_groups: {
  stripParams: ['fbclid', '__cft__', '__tn__', 'comment_id', 'reply_comment_id', 'notif_id'],
  stripFragment: true,
}
```

Plus update the function to accept `siteSlug` lookup correctly (already does).

### 3. New API routes

#### `GET /api/extension/groups`
Returns the list of FB group sources the extension should scrape. Bearer-token auth (token issued from admin settings, more on auth below).

```ts
Response: [
  {
    slug: 'fb_group_backpackers_in_australia',
    groupUrl: 'https://www.facebook.com/groups/backpackersinaustralia',
    groupName: 'Backpackers in Australia',
    lastRunAt: '2026-04-30T08:00:00Z',
    maxPostsPerRun: 100,
    maxScrollSeconds: 60,
    enabled: true,
  },
  ...
]
```

#### `POST /api/extension/ingest-batch`
Accepts a batch of post HTML chunks for one group. Each post becomes a JobCandidate via the existing pipeline.

```ts
Request: {
  sourceSlug: 'fb_group_backpackers_in_australia',
  posts: [
    {
      postId: '1234567890',                    // FB's stable post ID, used as sourceJobId
      postUrl: 'https://www.facebook.com/groups/.../posts/1234567890/',
      postedAt: '2026-04-30T07:42:00Z',         // ISO; extension parses from FB's relative time
      authorName: 'Marie Dubois',
      html: '<div class="...">Mango pickers wanted in Bundaberg...</div>',  // post container
    },
    ...
  ],
  scrapedAt: '2026-04-30T08:01:00Z',
  scrollDuration: 47.3,                        // seconds; for telemetry
}

Response: { ok: true, ingested: 23, duplicates: 12, errors: 0 }
```

Internally, this endpoint does for each post:
1. Canonicalize `postUrl` via `url-canonical`
2. Check dedupe via `(source, sourceJobId=postId)` — if exists, skip
3. Run `extractWithPlaybook(facebookGroupsPlaybook, postHtml)` — playbook tries first
4. If playbook misses, fall back to `proxyExtract` against the post HTML (same Claude extraction we already use)
5. Run `classifyCandidate` as normal
6. Insert `JobCandidate` row

#### `POST /api/extension/heartbeat`
Optional: extension reports run completion. Records `lastRunAt`, success/failure, post count. Used by admin UI to see "extension last ran 4 hours ago, scraped 87 posts across 8 groups."

```ts
Request: {
  runId: 'ext-20260430-080000',
  groupRuns: [
    { sourceSlug, postsCaptured, scrollDuration, error?: string },
    ...
  ],
}
```

### 4. Auth: bearer token system

The extension lives on a machine outside Lucas's normal admin session, so cookie-based NextAuth won't work. Use a long-lived bearer token specifically scoped to extension use.

**Schema**: one new column on `User`: `extensionToken: String?` (nullable, unique).

**Generation**: admin clicks "Generate extension token" on `/admin/settings`. Server creates a random 64-char token, stores in DB, displays once (admin copies into the extension's options page). Revocation = clear the column.

**Middleware**: `/api/extension/*` routes accept either the standard NextAuth admin session OR a `Authorization: Bearer <token>` header that matches a `User.extensionToken`. Same role check (admin only).

### 5. Admin UI additions

Two small pieces:

#### `/admin/settings` (or wherever existing admin settings live)
- "Extension token" section with a "Generate / Regenerate" button
- Displays token once after generation (copy to clipboard, then masks it)
- Shows when token was last used (from heartbeat)

#### `/admin/sources` — new "facebook_group" sheetTab
Reuses the existing source CRUD UI — just a new sheetTab for FB groups. The existing Create flow handles it: admin picks adapter='extension', sheetTab='facebook_group', siteSlug='facebook_groups', and pastes the group URL. Done.

### 6. Schema additions summary

- `User.extensionToken: String?` (nullable, unique)
- One seed `SitePlaybook` row for `facebook_groups`
- `JobSource.config` schema for FB group rows: `{ groupId, groupUrl, groupName, maxPostsPerRun?, maxScrollSeconds? }`

That's it for backend.

## Extension architecture

Manifest V3 Chrome extension. Three components.

### `manifest.json`
Permissions kept minimal:
- `host_permissions: ["*://*.facebook.com/*", "https://thejobclub.com.au/*"]` — narrowly scoped
- `permissions: ["storage", "scripting", "alarms"]`
- No `tabs` permission (uses `chrome.tabs` only via what `scripting` allows)
- No remote code execution

### Service worker (`background.js`)
- Holds state: token, group list cache, current run status
- Listens for `chrome.alarms` (used as the trigger from Task Scheduler — see below)
- Coordinates the run: fetches `/api/extension/groups`, opens each group URL in a tab, sends a "start scrape" message to the content script, collects results, posts batch to `/api/extension/ingest-batch`, closes tab, moves to next group
- Per-run telemetry posted via `/api/extension/heartbeat`

### Content script (`content.js`)
Injected into FB group pages. On message from background:
1. Find the post container (multiple selectors for resilience: `[role="feed"] [role="article"]`, etc.)
2. Auto-scroll with jitter:
   - Initial scroll-to-top
   - Loop: scroll down by `window.innerHeight * 0.8`, wait `1500-3500ms` (random)
   - Track posts seen (by data-id attribute)
   - Stop when:
     - Total elapsed ≥ `maxScrollSeconds` (configurable per group, default 60s)
     - OR: total unique posts captured ≥ `maxPostsPerRun` (default 100)
     - OR: 3 consecutive scrolls add no new posts (reached end of fresh content)
3. For each captured post element:
   - Extract `postId` from a data attribute or the post URL
   - Extract `postUrl` (the post's permalink)
   - Extract `postedAt` (FB shows relative time "2h ago" → use the `<abbr>` element's title attribute which has absolute time, or hover-tooltip data)
   - Extract `authorName`
   - Capture the post container's `outerHTML`
4. Return to background script: `{ posts: [...] }`

### Options page (`options.html`)
Tiny static page:
- Input: bearer token
- Input: backend URL (defaults to `https://thejobclub.com.au`)
- Status: last run time, last error
- Button: "Run now" (manual trigger for testing)
- Button: "Save"

Stored via `chrome.storage.sync` — encrypted at rest by Chrome.

### Popup (`popup.html`)
Minimal popup shown when extension icon clicked. Status only:
- Logged in: yes/no (does FB cookie exist)
- Token: configured/missing
- Last run: <time>
- Next scheduled run: <time> (if alarm set)
- "Run now" button

## Auto-scroll details

Per the conversation, the user wants both an N-seconds cap AND an X-posts cap (whichever first), with reasonable defaults:

| Setting | Default | Per-group override |
|---|---|---|
| `maxScrollSeconds` | 60 | Yes (config field) |
| `maxPostsPerRun` | 100 | Yes (config field) |
| Min scroll interval | 1500ms | No |
| Max scroll interval | 3500ms | No |
| Stop after N stale scrolls | 3 | No |

The "stop after 3 stale scrolls" is the most important one — it prevents wasting time scrolling through old content the extension has already processed. The dedupe in the backend handles the rest.

## Office machine setup

One-time setup, expected to take ~30 minutes:

1. **Install Chrome on the office machine.** If already installed, ensure it's recent enough for Manifest V3.
2. **Log into Lucas's spare FB account** in this Chrome instance. Stay logged in indefinitely.
3. **Sideload the extension** (no Chrome Web Store):
   - Build the extension into a folder
   - Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the folder
   - Note the extension ID (some long hex string) — used in scheduler URL
4. **Configure the extension**:
   - Open the options page
   - Paste the bearer token generated from `/admin/settings`
   - Save
5. **Configure FB group sources** in `/admin/sources` — one row per group the extension should scrape. The extension auto-fetches this list on each run.
6. **Disable sleep / screen lock** on the office machine: Power Settings → Never sleep, never lock display.
7. **Set up Windows Task Scheduler**:
   - Trigger: Daily at 8:00 AM and 5:00 PM
   - Action: Start a program → `chrome.exe` with arg `--app=chrome-extension://<id>/run.html`
   - The `run.html` page in the extension just calls `chrome.runtime.sendMessage({ type: 'run-now' })` and closes itself
8. **Smoke test**: trigger the scheduled task manually, verify candidates appear in `/admin/candidates`.

## Build order

Roughly 3-4 working days of focused work.

### Day 1 — Backend (~6 hours)
- ✅ Add `User.extensionToken` column + Prisma migration
- ✅ Generate-token UI on `/admin/settings`
- ✅ Add `fb_groups` profile to `url-canonical.ts`
- ✅ Seed `SitePlaybook` row for `facebook_groups`
- ✅ `GET /api/extension/groups` endpoint with bearer auth
- ✅ `POST /api/extension/ingest-batch` endpoint (the meat — wraps existing playbook + classifier pipeline)
- ✅ `POST /api/extension/heartbeat` endpoint

### Day 2 — Extension scaffold (~6 hours)
- ✅ Manifest V3 + folder structure
- ✅ Options page (token + backend URL)
- ✅ Popup (status display + manual run button)
- ✅ Service worker: fetch group list, basic message routing
- ✅ Content script: stub that finds the FB feed container, no scraping yet
- ✅ End-to-end smoke: extension can fetch group list and open a group URL

### Day 3 — Scraping logic (~6 hours)
- ✅ Auto-scroll with jitter + stale-scroll detection
- ✅ Post element identification (multiple selectors for resilience)
- ✅ Per-post extraction (postId, postUrl, postedAt, authorName, HTML chunk)
- ✅ Batch POST to ingest-batch with retry on transient failures
- ✅ Heartbeat post-run

### Day 4 — Polish + office machine deploy (~4 hours)
- ✅ Office machine: install Chrome, log into spare FB, sideload extension
- ✅ Task Scheduler entries for 8 AM and 5 PM runs
- ✅ Verify end-to-end: scheduled task fires → extension runs → candidates appear in admin
- ✅ Document the runbook in `docs/runbooks/fb-extension.md` (so future-you can reproduce setup)

## Test plan

1. **Backend isolation**: hit `/api/extension/ingest-batch` with hand-crafted curl + a fake post HTML. Confirm candidate lands. (~15 min)
2. **Extension dev mode**: load on a personal Chrome with FB logged in. Manually trigger via popup. Watch DevTools console for the scrape sequence. Verify post HTML is captured. (~30 min)
3. **End-to-end on personal machine**: extension scrapes 1 small group, batch POSTs, candidates land in admin. (~30 min)
4. **Production transplant**: same extension code on the office machine. Trigger via Task Scheduler. (~15 min)
5. **First playbook seed**: after 5-10 successful runs, the proposer should fire and seed initial selectors in `facebook_groups` SitePlaybook. Verify `extractionMode='playbook'` starts appearing on candidates. (Calendar: 3-7 days post-launch.)

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| FB rotates DOM, content-script selectors break | Medium | Multi-selector approach with graceful fallback; playbook system relearns automatically; new extension version only needed if all selectors break |
| Spare FB account flagged for "scraping" | Low (with the limits) | Throttle to 2 runs/day; auto-scroll at human pace with jitter; cap posts/run; don't scrape across all groups in <5 min |
| Office machine Chrome update auto-disables extension | Low | Sideloaded extensions persist across updates; Lucas can re-enable in chrome://extensions if Chrome ever auto-disables them |
| Office machine reboots and Chrome doesn't auto-launch | Medium | Task Scheduler can include "if Chrome not running, start it" pre-step |
| Bearer token leak | Low | Token rotation via `/admin/settings`; revocation = clear DB column = extension stops working until new token issued |
| FB feed structure differs across groups (private vs public, large vs small) | Medium | Multi-selector content script; first 1-2 weeks of runs surface any cases the playbook can't handle; proposer fixes them |

## Success looks like

After 2 weeks running:

- ≥10 FB groups configured as JobSource rows
- Extension runs twice daily without manual intervention
- 60-150 candidates per day from FB groups arrive in `/admin/candidates`
- Post-classifier yield ≥30% (real WHV-suitable jobs) — comparable to BPJB which yields ~67%
- ≥30% of FB candidates extracted via playbook (no Claude call) by week 2 — proves the learning loop works
- Lucas spends <15 min/day reviewing FB candidates (fast because classifier filters most aggressively)

## Rollback

- **Extension misbehaves**: disable in `chrome://extensions`. Office machine stops scraping. No backend rollback needed.
- **Backend endpoints malformed**: revoke extension token via `/admin/settings`. Extension can no longer ingest. Existing JobSources untouched.
- **Schema change problem**: `User.extensionToken` is nullable; can be dropped without breaking anything else.
- **Whole feature**: delete the FB group JobSource rows + drop `User.extensionToken` + uninstall extension. Other sources untouched.

## What I'll need from you (Lucas)

In order:

1. **Approve this plan** (or call out anything to change before I start).
2. **Spare FB account credentials** (later, when we get to office-machine setup — not before).
3. **List of 5-10 FB groups** to start with. Slugs/URLs you already know yield jobs.
4. **Office machine access** — either RDP / TeamViewer / AnyDesk so I can walk through the install with you, or you handle the click-through with my written runbook.

Items 2-4 don't block me starting. I can build everything in days 1-3 without any of that, then the office machine deploy in day 4 is when you'd hand over.

## Next step

Once you approve, I start with Day 1 backend work — additive only, no risk to existing sources. After Day 1 ships, you'll be able to test the ingest endpoint manually before the extension code even exists, which is a nice halfway-point validation.
