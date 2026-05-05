// In-page overlay UI for FB group tabs.
//
// Why this exists: scraping FB tabs from a popup was fragile — the popup
// closes the moment you click off it, and MV3 service workers get evicted
// when no UI tab is focused, so longer runs failed silently with no
// completion heartbeat. Living inside the scraped tab keeps the SW alive
// and the user can see exactly what's happening.
//
// Architecture:
//  - Shadow DOM for total style isolation from FB's CSS
//  - Collapsed state: small floating pill in bottom-right
//  - Expanded state: panel with status, source registration,
//    "Scrape this tab" / "Scrape all" buttons, live progress
//  - Polls background for run status; reads window.__jcScrapeStatus that
//    content.js exposes during an active scrape (same isolated world)

(() => {
  // Bail if FB is showing the modal post viewer or another fragment-only
  // surface where the overlay has no value.
  if (window.top !== window.self) return  // skip iframes
  if (document.getElementById('jc-fb-overlay-host')) return  // already mounted

  const HOST_ID = 'jc-fb-overlay-host'
  const BACKEND_DEFAULT = 'https://thejobclub.com.au'

  // ─── State ──────────────────────────────────────────────────────────────
  let expanded = false
  let groups = []           // matched against location.href to find a slug
  let cachedStatus = null   // last response from getStatus
  let pollHandle = null
  let scrapeStartTs = null

  // ─── Mount ──────────────────────────────────────────────────────────────
  const host = document.createElement('div')
  host.id = HOST_ID
  // Anchor to documentElement so we don't fight FB's body restructuring.
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;'
  document.documentElement.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .anchor {
        position: fixed;
        bottom: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #1c1917;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: #1c1917;
        color: white;
        border-radius: 999px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        transition: transform 0.12s ease, background 0.12s ease;
        user-select: none;
      }
      .pill:hover { background: #292524; transform: translateY(-1px); }
      .pill .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #84cc16;
      }
      .pill .dot.running {
        background: #f59e0b;
        animation: pulse 1.2s infinite;
      }
      .pill .dot.error { background: #ef4444; }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      .panel {
        width: 320px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.25);
        overflow: hidden;
        font-size: 12px;
        animation: slideUp 0.18s ease-out;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .header {
        background: linear-gradient(135deg, #6b21a8 0%, #f59e0b 110%);
        color: white;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .header-title { font-weight: 800; font-size: 13px; letter-spacing: 0.2px; }
      .header-close {
        background: rgba(255,255,255,0.15);
        border: none;
        color: white;
        width: 24px; height: 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .header-close:hover { background: rgba(255,255,255,0.3); }
      .body { padding: 12px 14px; }
      .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        border-bottom: 1px solid #f5f5f4;
        font-size: 12px;
      }
      .row:last-child { border-bottom: none; }
      .label { color: #57534e; font-weight: 500; }
      .value { font-weight: 700; }
      .ok { color: #15803d; }
      .err { color: #b91c1c; }
      .warn { color: #b45309; }
      .muted { color: #78716c; }
      .actions { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
      button.btn {
        width: 100%;
        padding: 9px 10px;
        border: none;
        border-radius: 8px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .btn-primary {
        background: #1c1917;
        color: white;
      }
      .btn-primary:hover:not(:disabled) { background: #292524; }
      .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-secondary {
        background: #f5f5f4;
        color: #1c1917;
      }
      .btn-secondary:hover:not(:disabled) { background: #e7e5e4; }
      .btn-amber {
        background: #f59e0b;
        color: #1c1917;
      }
      .btn-amber:hover:not(:disabled) { background: #d97706; color: white; }
      .links {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 11px;
      }
      .links a {
        color: #6b21a8;
        text-decoration: none;
        font-weight: 600;
      }
      .links a:hover { text-decoration: underline; }
      .progress {
        margin-top: 10px;
        padding: 8px 10px;
        background: #fef3c7;
        border: 1px solid #fde68a;
        border-radius: 8px;
        font-size: 11px;
      }
      .progress-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2px;
      }
      .progress-line:last-child { margin-bottom: 0; }
      .stat-num { font-weight: 800; color: #92400e; }
      .source-banner {
        margin-top: 10px;
        padding: 8px 10px;
        background: #f3e8ff;
        border: 1px solid #e9d5ff;
        border-radius: 8px;
        font-size: 11px;
        color: #581c87;
      }
      .source-banner.warn {
        background: #fef3c7;
        border-color: #fde68a;
        color: #92400e;
      }
      .footer-note {
        margin-top: 10px;
        font-size: 10px;
        color: #a8a29e;
        text-align: center;
      }
    </style>
    <div class="anchor" id="anchor">
      <div class="pill" id="pill">
        <span class="dot" id="dot"></span>
        <span id="pill-label">Job Club</span>
      </div>
    </div>
  `

  const $ = (id) => root.getElementById(id)

  $('pill').addEventListener('click', () => toggle())

  function toggle() {
    expanded = !expanded
    render()
    if (expanded) {
      refresh()
      pollHandle = setInterval(refresh, 1500)
    } else if (pollHandle) {
      clearInterval(pollHandle)
      pollHandle = null
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  function timeAgo(iso) {
    if (!iso) return '—'
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "à l'instant"
    if (mins < 60) return `${mins} min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} h`
    return `${Math.floor(hours / 24)} j`
  }

  function fmtElapsed(secs) {
    if (!secs && secs !== 0) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  /** Match this tab's URL against the configured groups list. Returns the
   *  matching group or null. We compare by groupId (stable across www/m/etc),
   *  not full URL, since we may be redirected (mbasic→www) but the path
   *  always contains /groups/<id>. */
  function findCurrentGroup() {
    const m = /\/groups\/([A-Za-z0-9._-]+)/.exec(location.pathname)
    if (!m) return null
    const id = m[1]
    return groups.find(g => {
      const gm = /\/groups\/([A-Za-z0-9._-]+)/.exec(g.groupUrl || '')
      return gm && gm[1] === id
    }) || null
  }

  // ─── Data ───────────────────────────────────────────────────────────────
  async function loadGroups() {
    try {
      const cfg = await chrome.storage.sync.get(['extensionToken', 'backendUrl'])
      const token = cfg.extensionToken
      const backend = cfg.backendUrl || BACKEND_DEFAULT
      if (!token) { groups = []; return }
      const res = await fetch(`${backend}/api/extension/groups`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) { groups = []; return }
      const data = await res.json()
      groups = Array.isArray(data?.groups) ? data.groups : []
    } catch {
      groups = []
    }
  }

  async function refresh() {
    if (!expanded) return
    // Status from background (running, lastRun, etc.)
    chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return
      cachedStatus = resp
      render()
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  function render() {
    const dot = $('dot')
    const pillLabel = $('pill-label')
    const live = window.__jcScrapeStatus  // exposed by content.js during scrape

    // Pill state — collapsed view
    const running = !!cachedStatus?.running || !!live?.active
    if (running) {
      dot.className = 'dot running'
      const captured = live?.captured ?? cachedStatus?.lastRun?.totalPosts
      pillLabel.textContent = captured != null ? `Scraping… ${captured}` : 'Scraping…'
    } else {
      dot.className = 'dot'
      pillLabel.textContent = 'Job Club'
    }

    // Panel state — expanded view
    let panel = $('panel')
    if (!expanded) {
      if (panel) panel.remove()
      return
    }

    if (!panel) {
      panel = document.createElement('div')
      panel.id = 'panel'
      panel.className = 'panel'
      $('anchor').insertBefore(panel, $('pill').parentNode === $('anchor') ? $('pill') : null)
    }

    const currentGroup = findCurrentGroup()
    const lr = cachedStatus?.lastRun
    const tokenOk = cachedStatus !== null
      ? !!cachedStatus.tokenConfigured
      : null

    let progressBlock = ''
    if (running && live?.active) {
      const elapsed = fmtElapsed((Date.now() - (scrapeStartTs || Date.now())) / 1000)
      progressBlock = `
        <div class="progress">
          <div class="progress-line"><span>Posts captured</span><span class="stat-num">${live.captured ?? 0}</span></div>
          <div class="progress-line"><span>Posts visible right now</span><span class="stat-num">${live.visibleNow ?? '—'}</span></div>
          <div class="progress-line"><span>Elapsed</span><span class="stat-num">${elapsed}</span></div>
        </div>
      `
    }

    let sourceBanner = ''
    if (currentGroup) {
      sourceBanner = `
        <div class="source-banner">
          ✓ On registered group <b>${escapeHtml(currentGroup.slug)}</b> — "Scrape this tab" will use it.
        </div>
      `
    } else {
      const m = /\/groups\/([A-Za-z0-9._-]+)/.exec(location.pathname)
      if (m) {
        sourceBanner = `
          <div class="source-banner warn">
            This group isn't registered yet. <a href="#" id="register-link">+ Register it</a> before scraping just this one.
          </div>
        `
      } else {
        sourceBanner = `
          <div class="source-banner">
            Not on a group page. Use <b>Scrape all configured groups</b> below, or open a group to scrape it directly.
          </div>
        `
      }
    }

    panel.innerHTML = `
      <div class="header">
        <span class="header-title">Job Club Scraper</span>
        <button class="header-close" id="close-btn" aria-label="Close">×</button>
      </div>
      <div class="body">
        <div class="row"><span class="label">Token</span><span class="value ${tokenOk ? 'ok' : 'err'}">${tokenOk ? '🔒 configured' : '⚠ missing'}</span></div>
        <div class="row"><span class="label">Last run</span><span class="value">${timeAgo(lr?.completedAt || lr?.startedAt)}</span></div>
        <div class="row"><span class="label">Last yield</span><span class="value">${lr ? `${lr.totalPosts} posts, ${lr.totalErrors} err` : '—'}</span></div>

        ${sourceBanner}
        ${progressBlock}

        <div class="actions">
          <button class="btn btn-primary" id="run-tab-btn" ${running || !currentGroup ? 'disabled' : ''}>
            ${running ? '⌛ Running…' : '▶ Scrape this tab'}
          </button>
          <button class="btn btn-secondary" id="run-all-btn" ${running ? 'disabled' : ''}>
            ▶ Scrape all configured groups
          </button>
        </div>

        <div class="links">
          <a href="#" id="link-candidates">Candidates →</a>
          <a href="#" id="link-captures">Captures →</a>
          <a href="#" id="link-sources">Sources →</a>
          <a href="#" id="link-options">Options ⚙</a>
        </div>

        <div class="footer-note">v0.2 · scrapes the tab you're on</div>
      </div>
    `

    // Event wiring (always re-bind since we re-rendered the panel)
    $('close-btn').addEventListener('click', () => toggle())

    if (currentGroup && !running) {
      $('run-tab-btn').addEventListener('click', () => runOnTab(currentGroup.slug))
    }
    if (!running) {
      $('run-all-btn').addEventListener('click', () => runAllGroups())
    }

    const reg = $('register-link')
    if (reg) reg.addEventListener('click', (e) => { e.preventDefault(); registerThisGroup() })

    // Quick links
    bindLink('link-candidates', '/admin/candidates')
    bindLink('link-captures', '/admin/extensions')
    bindLink('link-sources', '/admin/sources')
    $('link-options').addEventListener('click', (e) => {
      e.preventDefault()
      chrome.runtime.sendMessage({ type: 'openOptions' })
    })
  }

  async function bindLink(id, path) {
    const el = $(id)
    if (!el) return
    el.addEventListener('click', async (e) => {
      e.preventDefault()
      const cfg = await chrome.storage.sync.get(['backendUrl'])
      const backend = cfg.backendUrl || BACKEND_DEFAULT
      window.open(`${backend}${path}`, '_blank', 'noopener')
    })
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c])
  }

  // ─── Actions ────────────────────────────────────────────────────────────
  async function runOnTab(sourceSlug) {
    scrapeStartTs = Date.now()
    chrome.runtime.sendMessage({ type: 'runOnTab', sourceSlug }, (resp) => {
      scrapeStartTs = null
      if (chrome.runtime.lastError) {
        alert('Erreur: ' + chrome.runtime.lastError.message)
      } else if (resp?.error) {
        alert('Erreur: ' + resp.error)
      }
      refresh()
    })
    // Tick faster while a scrape is live so the live counter feels real-time.
    if (pollHandle) clearInterval(pollHandle)
    pollHandle = setInterval(refresh, 600)
  }

  async function runAllGroups() {
    chrome.runtime.sendMessage({ type: 'runNow', triggeredBy: 'manual' }, (resp) => {
      if (chrome.runtime.lastError) {
        alert('Erreur: ' + chrome.runtime.lastError.message)
      }
      refresh()
    })
  }

  async function registerThisGroup() {
    const cfg = await chrome.storage.sync.get(['extensionToken', 'backendUrl'])
    const backend = cfg.backendUrl || BACKEND_DEFAULT
    // Use the existing admin bulk endpoint (NOT the extension token — bulk-fb
    // is admin-cookie-authed). Open the sources page with a hint instead so
    // the user can paste the URL into the modal — saves us juggling two auth
    // schemes from inside a content script.
    const url = `${backend}/admin/sources`
    if (confirm("To register this group, the admin /admin/sources page will open. Click '+ Bulk FB groups' there and paste:\n\n" + location.href)) {
      window.open(url, '_blank', 'noopener')
    }
  }

  // Listen for explicit expand from the toolbar icon click.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'expandOverlay') {
      if (!expanded) toggle()
      else {
        // Already expanded — flash the header so the user notices the click
        // landed (they might have clicked the icon while the panel was off-
        // screen on a long FB feed).
        const header = root.querySelector('.header')
        if (header) {
          header.style.transition = 'background 0.4s'
          const orig = header.style.background
          header.style.background = '#fbbf24'
          setTimeout(() => { header.style.background = orig }, 350)
        }
      }
      sendResponse({ ok: true })
    }
  })

  // ─── Boot ───────────────────────────────────────────────────────────────
  loadGroups().then(render)
  // Refresh group list every 30s in case the user adds a new source elsewhere.
  setInterval(loadGroups, 30000)
})()
