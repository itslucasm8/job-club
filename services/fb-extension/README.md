# Job Club — FB Group Scraper Extension

Chrome extension that scrapes posts from configured Facebook groups and ships them to Job Club's source pipeline. Runs on the office machine logged into a spare FB account; triggered manually (popup) or on schedule (Windows Task Scheduler invoking `run.html`).

See `docs/plans/fb-group-extension.md` for the full design.

## File layout

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 declaration |
| `background.js` | Service worker — orchestrates a run across all configured groups |
| `content.js` | Injected into `facebook.com/groups/*` pages — auto-scroll + DOM scrape |
| `popup.html` / `popup.js` | Click-the-icon popup — status + manual "Run now" |
| `options.html` / `options.js` | Token + backend URL config |
| `run.html` | Page that Task Scheduler opens to trigger a scheduled run |

## Sideload (one-time, ~5 minutes)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`services/fb-extension`)
4. Note the **Extension ID** shown (a 32-char hex string) — used in Task Scheduler
5. The Job Club icon appears in the toolbar; click it to open the popup

## Configure (one-time after sideload)

1. Right-click the icon → **Options** (or click the ⚙ Options link in the popup)
2. **Backend URL**: leave as `https://thejobclub.com.au` for production
3. **Token**: generate from `https://thejobclub.com.au/admin/extensions` → click "Générer un token", copy it, paste here
4. Click **Sauvegarder**, then **Tester la connexion** — should report "OK — N groupes configurés"

## Smoke test (Day 2)

After sideloading + configuring, before any FB groups are configured:

- Click the icon → popup shows: FB connecté ✓, Token 🔒 configuré, Dernier run —
- Click **▶ Run now** → service worker logs "Aucun groupe configuré" (expected — no groups in DB yet). Heartbeat fires; check `/admin/extensions` to see the run row appear.

After 1 FB group is configured at `/admin/sources` with `siteSlug='facebook_groups'`, `adapter='extension'`, and `config={ groupUrl, groupId, groupName }`:

- Click **▶ Run now** → background opens the group URL in a tab, content script finds posts (Day 2 returns stubbed data; Day 3 returns real post HTML), batch POSTs to ingest, tab closes. Candidates appear in `/admin/candidates`.

## Day 3 will add

Currently the content script (`content.js`) returns *stubbed* post data — Day 2 only validates the orchestration loop end-to-end. Day 3 fills in:
- Real post-element identification (multiple selectors for resilience to FB DOM rotation)
- `postId` extraction from DOM data attributes
- `postUrl` extraction from permalink anchors
- `postedAt` parsing from FB's `<abbr title="...">` absolute time
- `authorName` extraction
- Full `outerHTML` capture (truncated to 50KB per post)

## Day 4 will add

- Office machine setup runbook (Chrome install, FB login, sideload)
- Windows Task Scheduler entries for 8 AM and 5 PM runs
- Bulk-import of FB groups from Lucas's Google Sheet → JobSource rows

## Manual scheduling (Windows Task Scheduler)

After Day 4. The Task Scheduler entry runs:

```
chrome.exe --app=chrome-extension://<EXTENSION-ID>/run.html
```

The `run.html` page sends a `runNow` message to the service worker and closes itself when the run completes (so Chrome can exit cleanly after the run).

## Permissions explained

- `*://*.facebook.com/*` — host permission so the content script can run on group pages
- `https://thejobclub.com.au/*` and `http://localhost:3000/*` — to call the API
- `storage` — persist token + backend URL (sync) and run summary (local)
- `scripting` — required for `chrome.tabs.sendMessage` to content scripts
- `alarms` — for future scheduled runs (not used in Day 2; kept for forward compat)
- `tabs` — open group pages in tabs from the service worker
