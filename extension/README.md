# Job Club — Importer (browser extension)

A small Chrome/Brave extension that captures the page you're currently viewing and ships its text to the Job Club backend, where it lands as a `JobCandidate` after LLM extraction + classification.

Built specifically to bypass anti-bot WAFs like **Peakhour** (Gumtree) that 403 the VPS's datacenter IP regardless of how realistic the headless browser is. The extension runs in your real browser with your real session cookies — those WAFs see a normal user, not a bot.

## How it works

```
You're on a Gumtree (or anywhere) ad page
  │
  │  click extension toolbar icon
  ▼
Popup grabs document.body.innerText (skipping <script>/<style>)
  │
  │  POST {url, page_text, page_title}
  │  Authorization: Bearer <EXTENSION_SECRET>
  ▼
https://thejobclub.com.au/api/extension/import-candidate
  │
  │  calls Claude proxy /extract on the VPS
  ▼
JobCandidate inserted, classifier runs async, lands in /admin/candidates
```

Same downstream behaviour as the URL-paste flow on `/admin/candidates` — same dedupe, same classifier, same auto-rejection.

## Install (Chrome / Brave / Edge)

1. Open `chrome://extensions/`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**, select the `extension/` directory in this repo
4. Click the puzzle icon in the toolbar → pin "Job Club — Importer"
5. Right-click the icon → **Options** → fill in:
   - **URL du backend:** `https://thejobclub.com.au`
   - **Secret:** the value of `EXTENSION_SECRET` from `/data/job-club/.env.production` on the VPS

That's it. To use: open any job ad in your browser, click the extension icon, click **Envoyer à Job Club**.

## Updating

Pull the latest, then on `chrome://extensions/` click the circular refresh arrow on the Job Club card. No reinstall needed unless `manifest.json` changed.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 declaration; declares `host_permissions` for thejobclub.com.au |
| `popup.html`/`popup.js` | UI shown when clicking the toolbar icon; captures page text + posts |
| `options.html` | Stores `apiUrl` and `secret` in `chrome.storage.sync` |
| `background.js` | Service worker stub (reserved for future shortcuts/menus) |

## Notes on what gets captured

- `document.body.innerText` after removing `<script>`, `<style>`, `<noscript>` — the visible textual content of the page
- Trimmed to 100,000 characters (server clips to 25,000 anyway)
- The page URL and document title are sent alongside

The server-side LLM extractor handles the noise — no need to do clever scraping in the extension. Less code, less to break.

## Security

- Bearer token in `Authorization` header. The token is stored in `chrome.storage.sync` (encrypted at rest by Chrome, synced via your Google account if signed in).
- The API endpoint validates the token in constant time before doing anything.
- Compromise scenario: if someone exfiltrates your token, they can post arbitrary candidate text to your queue. They cannot publish them as live jobs (admin approval is still required at `/admin/candidates`). To rotate: change `EXTENSION_SECRET` in `.env.production`, restart the app, update the extension options.
