// Service worker — orchestrates a run across all configured FB groups.
//
// Lifecycle:
//   1. Trigger arrives (popup "Run now" click, or run.html invoked by Task
//      Scheduler, or chrome.alarms in future).
//   2. Fetch /api/extension/groups using the saved bearer token.
//   3. For each group, open a tab, wait for content.js to be ready, send
//      a "scrape" message, collect posts, close the tab.
//   4. POST batch to /api/extension/ingest-batch.
//   5. POST run summary to /api/extension/heartbeat.
//
// State stored in chrome.storage.local under key 'lastRun': summary of the
// most recent run, used by the popup to show status.

const STATE_KEYS = {
  TOKEN: 'extensionToken',
  BACKEND: 'backendUrl',
  LAST_RUN: 'lastRun',
  RUN_BUSY: 'runBusy',
  // Live progress state, written continuously during a run, read by every
  // overlay instance via chrome.storage.onChanged for push-style updates.
  RUN_PROGRESS: 'runProgress',
  // Rolling window of the last N captured-post snippets across all runs,
  // for the overlay's "Recent captures" pane. Persists between runs so the
  // user can scroll back and see what's been gathered recently.
  RECENT_CAPTURES: 'recentCaptures',
}

const RECENT_CAPTURES_MAX = 50

const DEFAULT_BACKEND = 'https://thejobclub.com.au'

// MV3 service workers can be force-killed mid-run (idle eviction, browser
// restart). When that happens we never reach the finally{} that clears
// runBusy, so the lock would be permanently stuck. Clear any stale lock on
// service-worker startup — there is no in-progress run if the worker just
// booted.
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ runBusy: false }).catch(() => {})
})
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ runBusy: false }).catch(() => {})
})

// ─── Storage helpers ──────────────────────────────────────────────────────

async function getConfig() {
  const { [STATE_KEYS.TOKEN]: token, [STATE_KEYS.BACKEND]: backend } = await chrome.storage.sync.get([STATE_KEYS.TOKEN, STATE_KEYS.BACKEND])
  return {
    token: token || '',
    backend: backend || DEFAULT_BACKEND,
  }
}

async function setRunBusy(busy) {
  await chrome.storage.local.set({
    [STATE_KEYS.RUN_BUSY]: !!busy,
    runBusySince: busy ? Date.now() : null,
  })
}

// A run that started more than this long ago is presumed dead (service
// worker eviction, network hang, or browser crash) — clear the lock so a
// new run can start.
const STALE_LOCK_MS = 5 * 60 * 1000

async function clearStaleLock() {
  const { runBusy, runBusySince } = await chrome.storage.local.get(['runBusy', 'runBusySince'])
  if (runBusy && runBusySince && Date.now() - runBusySince > STALE_LOCK_MS) {
    console.warn('[fb-ext] clearing stale runBusy lock from', new Date(runBusySince).toISOString())
    await chrome.storage.local.set({ runBusy: false, runBusySince: null })
  }
}

async function setLastRun(summary) {
  await chrome.storage.local.set({ [STATE_KEYS.LAST_RUN]: summary })
}

// ─── Live run progress (the run dashboard's data source) ─────────────────
// Updated at every meaningful transition: opening tab, scraping, ingesting,
// done/error. Plus continuously during scrape via scrapeProgress messages
// from content.js. Written to chrome.storage.local; overlays subscribe via
// chrome.storage.onChanged so updates are push, not poll.

async function getProgress() {
  const r = await chrome.storage.local.get(STATE_KEYS.RUN_PROGRESS)
  return r[STATE_KEYS.RUN_PROGRESS] || null
}

async function setProgress(progress) {
  await chrome.storage.local.set({ [STATE_KEYS.RUN_PROGRESS]: progress })
}

/** Mutate a single group's row in runProgress. updater is a function that
 *  receives the existing group object and returns the partial fields to
 *  merge in. No-op if the slug isn't found in the current run. */
async function patchGroup(slug, updater) {
  const curr = await getProgress()
  if (!curr || !Array.isArray(curr.groups)) return
  let changed = false
  let totalCaptured = 0
  let totalIngested = 0
  const groups = curr.groups.map(g => {
    let next = g
    if (g.slug === slug) {
      const patch = updater(g) || {}
      next = { ...g, ...patch }
      changed = true
    }
    totalCaptured += next.captured || 0
    totalIngested += next.ingested || 0
    return next
  })
  if (!changed) return
  await setProgress({ ...curr, groups, totalCaptured, totalIngested })
}

/** Initialize a fresh runProgress row before a run starts. */
async function initProgress(runId, triggeredBy, groupConfigs) {
  const progress = {
    runId,
    triggeredBy,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    totalCaptured: 0,
    totalIngested: 0,
    groups: groupConfigs.map(g => ({
      slug: g.slug,
      groupName: g.groupName || g.slug,
      groupUrl: g.groupUrl || null,
      status: 'pending',          // pending | opening_tab | scraping | ingesting | done | error
      captured: 0,
      ingested: null,
      duplicates: null,
      extractionErrors: null,
      latestPosts: [],            // last 3 captured-post snippets, [{ postId, snippet }]
      stopReason: null,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  }
  await setProgress(progress)
  return progress
}

async function finalizeProgress(error = null) {
  const curr = await getProgress()
  if (!curr) return
  await setProgress({ ...curr, completedAt: new Date().toISOString(), error })
}

/** Append new captures to the rolling-50 window. Dedupes by postId so a
 *  re-scrape that re-captures the same post doesn't push duplicates. */
async function appendRecentCaptures(sourceSlug, groupName, captures) {
  if (!Array.isArray(captures) || captures.length === 0) return
  const r = await chrome.storage.local.get(STATE_KEYS.RECENT_CAPTURES)
  const existing = Array.isArray(r[STATE_KEYS.RECENT_CAPTURES]) ? r[STATE_KEYS.RECENT_CAPTURES] : []
  const seen = new Set(existing.map(c => c.postId))
  const additions = []
  const now = Date.now()
  for (const c of captures) {
    if (!c?.postId || seen.has(c.postId)) continue
    seen.add(c.postId)
    additions.push({
      postId: c.postId,
      postUrl: c.postUrl || null,
      snippet: (c.snippet || '').slice(0, 160),
      sourceSlug,
      groupName: groupName || sourceSlug,
      capturedAt: now,
    })
  }
  if (additions.length === 0) return
  // Newest first, capped at MAX. Newer captures push older ones off the end.
  const next = [...additions, ...existing].slice(0, RECENT_CAPTURES_MAX)
  await chrome.storage.local.set({ [STATE_KEYS.RECENT_CAPTURES]: next })
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────

// Per-request timeout. Ingest can be slow (LLM extraction runs server-side
// inline), but a hung connection should not pin the service worker forever —
// the runBusy lock would orphan and block all future runs.
const API_TIMEOUT_MS = 120_000

async function apiFetch(path, opts = {}) {
  const { token, backend } = await getConfig()
  if (!token) throw new Error('Token non configuré (ouvrir les options)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${backend}${path}`, {
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`Timeout après ${API_TIMEOUT_MS / 1000}s sur ${path}`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ─── Tab orchestration helpers ────────────────────────────────────────────

function waitForTabReady(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    function tick() {
      if (Date.now() - t0 > timeoutMs) return reject(new Error('Tab load timeout'))
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return reject(new Error('Tab gone'))
        if (tab.status === 'complete') return resolve(tab)
        setTimeout(tick, 500)
      })
    }
    tick()
  })
}

async function sendMessageWithRetry(tabId, msg, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg)
      return res
    } catch (e) {
      if (i === retries - 1) throw e
      // Content script may not have loaded yet — back off and retry
      await new Promise(r => setTimeout(r, 1500))
    }
  }
}

// ─── The run ──────────────────────────────────────────────────────────────

async function runOneGroup(group) {
  const start = Date.now()
  // active: true is REQUIRED — FB throttles SPA hydration (IntersectionObserver,
  // requestIdleCallback) on background tabs, so the feed never renders any
  // [role="article"] elements. The tradeoff is the tab visibly pops open during
  // a run; on the office machine that's fine and the tab closes when done.
  // We open www directly — mbasic was retired by FB for modern UAs (any
  // mbasic.facebook.com URL redirects to www with ?__mmr=1&_rdr).
  await patchGroup(group.slug, () => ({ status: 'opening_tab', startedAt: new Date().toISOString() }))
  // active: true is required for reliable FB rendering. We tested both
  // background tabs (active:false) and unfocused popup windows
  // (chrome.windows.create + focused:false) — both produced empty article
  // shells (textLen:0) because FB's React gates content hydration on
  // document.visibilityState === 'visible' AND apparently on the window
  // being a "real" foreground window. Only an active tab in the user's
  // main Brave window reliably renders posts. Trade-off: scrape tabs
  // briefly steal focus during a multi-group run.
  const tab = await chrome.tabs.create({ url: group.groupUrl, active: true })
  try {
    await waitForTabReady(tab.id)
    // Give the FB feed time to hydrate + render initial posts before scraping.
    await new Promise(r => setTimeout(r, 5000))
    await patchGroup(group.slug, () => ({ status: 'scraping' }))
    const result = await sendMessageWithRetry(tab.id, {
      type: 'scrape',
      sourceSlug: group.slug,
      maxScrollSeconds: group.maxScrollSeconds || 60,
      maxPostsPerRun: group.maxPostsPerRun || 100,
    })
    const posts = result?.posts || []
    await patchGroup(group.slug, () => ({
      captured: posts.length,
      stopReason: result?.stopReason,
    }))
    return {
      sourceSlug: group.slug,
      groupName: group.groupName,
      postsCaptured: posts.length,
      scrollDuration: (Date.now() - start) / 1000,
      stopReason: result?.stopReason,
      diagnostic: result?.diagnostic,
      posts,
    }
  } catch (e) {
    await patchGroup(group.slug, () => ({ status: 'error', error: e?.message || String(e), completedAt: new Date().toISOString() }))
    return {
      sourceSlug: group.slug,
      groupName: group.groupName,
      postsCaptured: 0,
      scrollDuration: (Date.now() - start) / 1000,
      error: e?.message || String(e),
      posts: [],
    }
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch {/* swallow */}
  }
}

async function runAll(triggeredBy = 'manual') {
  // Manual clicks always win — clear any leftover lock. Scheduled triggers
  // respect the 5-min stale threshold to avoid clobbering a slow legitimate
  // run.
  if (triggeredBy === 'manual') {
    await chrome.storage.local.set({ runBusy: false, runBusySince: null })
  } else {
    await clearStaleLock()
  }
  const runId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await setRunBusy(true)

  // Heartbeat: run starting (so the admin UI can show in-progress state).
  try {
    await apiFetch('/api/extension/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runId, triggeredBy, completed: false, groupRuns: [] }),
    })
  } catch (e) {
    console.warn('[fb-ext] heartbeat start failed:', e)
  }

  const summary = {
    runId,
    triggeredBy,
    startedAt: new Date().toISOString(),
    completedAt: null,
    totalPosts: 0,
    totalErrors: 0,
    groupRuns: [],
    error: null,
  }

  try {
    const { groups } = await apiFetch('/api/extension/groups')
    if (!Array.isArray(groups) || groups.length === 0) {
      summary.error = 'Aucun groupe configuré'
      throw new Error(summary.error)
    }

    await initProgress(runId, triggeredBy, groups)

    for (const group of groups) {
      const groupResult = await runOneGroup(group)
      const groupSummary = {
        sourceSlug: groupResult.sourceSlug,
        postsCaptured: groupResult.postsCaptured,
        scrollDuration: groupResult.scrollDuration,
        stopReason: groupResult.stopReason,
        ...(groupResult.diagnostic ? { diagnostic: groupResult.diagnostic } : {}),
        ...(groupResult.error ? { error: groupResult.error } : {}),
      }
      summary.totalPosts += groupResult.postsCaptured
      if (groupResult.error) summary.totalErrors += 1

      if (groupResult.posts.length > 0) {
        await patchGroup(group.slug, () => ({ status: 'ingesting' }))
        try {
          const ingestResp = await apiFetch('/api/extension/ingest-batch', {
            method: 'POST',
            body: JSON.stringify({
              sourceSlug: groupResult.sourceSlug,
              posts: groupResult.posts,
              scrapedAt: new Date().toISOString(),
              scrollDuration: groupResult.scrollDuration,
            }),
          })
          groupSummary.ingested = ingestResp?.ingested ?? 0
          groupSummary.duplicates = ingestResp?.duplicates ?? 0
          groupSummary.extractionErrors = ingestResp?.errors ?? 0
          if (ingestResp?.errors > 0) summary.totalErrors += ingestResp.errors
          if (Array.isArray(ingestResp?.errorDetails) && ingestResp.errorDetails.length > 0) {
            groupSummary.errorSamples = ingestResp.errorDetails.slice(0, 3)
          }
          await patchGroup(group.slug, () => ({
            status: 'done',
            ingested: groupSummary.ingested,
            duplicates: groupSummary.duplicates,
            extractionErrors: groupSummary.extractionErrors,
            completedAt: new Date().toISOString(),
          }))
        } catch (e) {
          console.warn('[fb-ext] ingest-batch failed for', groupResult.sourceSlug, e)
          groupSummary.error = (groupSummary.error || '') + ' / ingest: ' + (e?.message || String(e))
          summary.totalErrors += 1
          await patchGroup(group.slug, () => ({ status: 'error', error: groupSummary.error, completedAt: new Date().toISOString() }))
        }
      } else {
        // No posts to ingest — mark done with whatever stopReason came back.
        await patchGroup(group.slug, () => ({
          status: groupResult.error ? 'error' : 'done',
          completedAt: new Date().toISOString(),
          error: groupResult.error || null,
        }))
      }
      summary.groupRuns.push(groupSummary)
    }

    summary.completedAt = new Date().toISOString()
    await finalizeProgress(null)
  } catch (e) {
    summary.error = e?.message || String(e)
    summary.completedAt = new Date().toISOString()
    await finalizeProgress(summary.error)
  } finally {
    await setRunBusy(false)
    await setLastRun(summary)
    // Final heartbeat with full summary.
    try {
      await apiFetch('/api/extension/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          runId,
          triggeredBy,
          completed: true,
          groupRuns: summary.groupRuns,
          errorMessage: summary.error,
        }),
      })
    } catch (e) {
      console.warn('[fb-ext] heartbeat end failed:', e)
    }
  }
  return summary
}

// ─── Run on a single existing tab ────────────────────────────────────────
// Used by the in-page overlay's "Scrape this tab" button. Skips tab creation
// — the tab already exists, the user navigated to it, and the SW stays alive
// because that tab is focused. Same ingest path as runAll() — a single
// group goes through ingest-batch + heartbeat just like the multi-tab flow.

async function runOnTab(tabId, sourceSlug) {
  await chrome.storage.local.set({ runBusy: false, runBusySince: null })
  const runId = `ext-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await setRunBusy(true)

  // Heartbeat start
  try {
    await apiFetch('/api/extension/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runId, triggeredBy: 'overlay', completed: false, groupRuns: [] }),
    })
  } catch (e) {
    console.warn('[fb-ext] runOnTab heartbeat start failed:', e)
  }

  const summary = {
    runId, triggeredBy: 'overlay',
    startedAt: new Date().toISOString(), completedAt: null,
    totalPosts: 0, totalErrors: 0, groupRuns: [], error: null,
  }

  try {
    const start = Date.now()
    // Look up the group config (maxPostsPerRun, maxScrollSeconds) — fall back
    // to defaults if /api/extension/groups doesn't return it.
    let group = { slug: sourceSlug, groupName: sourceSlug, maxPostsPerRun: 100, maxScrollSeconds: 90 }
    try {
      const { groups } = await apiFetch('/api/extension/groups')
      const match = (groups || []).find(g => g.slug === sourceSlug)
      if (match) group = match
    } catch {/* swallow — we still know the slug */}

    await initProgress(runId, 'overlay', [group])
    await patchGroup(sourceSlug, () => ({ status: 'scraping', startedAt: new Date().toISOString() }))

    const result = await sendMessageWithRetry(tabId, {
      type: 'scrape',
      sourceSlug,
      maxScrollSeconds: group.maxScrollSeconds || 90,
      maxPostsPerRun: group.maxPostsPerRun || 100,
    })
    const posts = result?.posts || []
    await patchGroup(sourceSlug, () => ({
      captured: posts.length,
      stopReason: result?.stopReason,
    }))
    const groupSummary = {
      sourceSlug, postsCaptured: posts.length,
      scrollDuration: (Date.now() - start) / 1000,
      stopReason: result?.stopReason,
      ...(result?.diagnostic ? { diagnostic: result.diagnostic } : {}),
    }
    summary.totalPosts += posts.length

    if (posts.length > 0) {
      await patchGroup(sourceSlug, () => ({ status: 'ingesting' }))
      try {
        const ingestResp = await apiFetch('/api/extension/ingest-batch', {
          method: 'POST',
          body: JSON.stringify({
            sourceSlug, posts,
            scrapedAt: new Date().toISOString(),
            scrollDuration: groupSummary.scrollDuration,
          }),
        })
        groupSummary.ingested = ingestResp?.ingested ?? 0
        groupSummary.duplicates = ingestResp?.duplicates ?? 0
        groupSummary.extractionErrors = ingestResp?.errors ?? 0
        if (ingestResp?.errors > 0) summary.totalErrors += ingestResp.errors
        if (Array.isArray(ingestResp?.errorDetails) && ingestResp.errorDetails.length > 0) {
          groupSummary.errorSamples = ingestResp.errorDetails.slice(0, 3)
        }
        await patchGroup(sourceSlug, () => ({
          status: 'done',
          ingested: groupSummary.ingested,
          duplicates: groupSummary.duplicates,
          extractionErrors: groupSummary.extractionErrors,
          completedAt: new Date().toISOString(),
        }))
      } catch (e) {
        groupSummary.error = 'ingest: ' + (e?.message || String(e))
        summary.totalErrors += 1
        await patchGroup(sourceSlug, () => ({ status: 'error', error: groupSummary.error, completedAt: new Date().toISOString() }))
      }
    } else {
      await patchGroup(sourceSlug, () => ({ status: 'done', completedAt: new Date().toISOString() }))
    }
    summary.groupRuns.push(groupSummary)
    summary.completedAt = new Date().toISOString()
    await finalizeProgress(null)
  } catch (e) {
    summary.error = e?.message || String(e)
    summary.completedAt = new Date().toISOString()
    await finalizeProgress(summary.error)
  } finally {
    await setRunBusy(false)
    await setLastRun(summary)
    try {
      await apiFetch('/api/extension/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          runId, triggeredBy: 'overlay', completed: true,
          groupRuns: summary.groupRuns, errorMessage: summary.error,
        }),
      })
    } catch (e) {
      console.warn('[fb-ext] runOnTab heartbeat end failed:', e)
    }
  }
  return summary
}

// ─── Toolbar icon click ───────────────────────────────────────────────────
// With no default_popup set in manifest, clicking the icon fires this handler
// directly. Behavior: if the active tab is already on facebook.com, just
// expand the overlay there. Otherwise open FB home as a fresh tab so the
// user can navigate to whichever group they want from inside the overlay.

chrome.action.onClicked.addListener(async (tab) => {
  const isOnFb = tab?.url && /^https?:\/\/[^/]*facebook\.com\//.test(tab.url)
  if (isOnFb) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'expandOverlay' })
    } catch {/* content script may not be ready yet — overlay will still mount */}
    return
  }
  // Not on FB at all — focus an existing FB tab if there is one, else open
  // FB home. We don't auto-navigate into a group; the user picks where to go.
  const fbTabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' })
  if (fbTabs.length > 0) {
    await chrome.tabs.update(fbTabs[0].id, { active: true })
    if (fbTabs[0].windowId) await chrome.windows.update(fbTabs[0].windowId, { focused: true })
    try { await chrome.tabs.sendMessage(fbTabs[0].id, { type: 'expandOverlay' }) } catch {}
    return
  }
  await chrome.tabs.create({ url: 'https://www.facebook.com/', active: true })
})

// ─── Message routing ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'runNow') {
    runAll(msg.triggeredBy || 'manual')
      .then(s => sendResponse({ ok: true, summary: s }))
      .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
    return true
  }
  if (msg?.type === 'runOnTab') {
    const tabId = sender?.tab?.id
    if (!tabId) {
      sendResponse({ error: 'No sender tab — runOnTab must be called from a content script' })
      return false
    }
    if (!msg.sourceSlug) {
      sendResponse({ error: 'sourceSlug required' })
      return false
    }
    runOnTab(tabId, msg.sourceSlug)
      .then(s => sendResponse({ ok: true, summary: s }))
      .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
    return true
  }
  if (msg?.type === 'getStatus') {
    chrome.storage.local.get([STATE_KEYS.LAST_RUN, STATE_KEYS.RUN_BUSY], async (r) => {
      const cfg = await chrome.storage.sync.get([STATE_KEYS.TOKEN])
      sendResponse({
        lastRun: r[STATE_KEYS.LAST_RUN] || null,
        running: !!r[STATE_KEYS.RUN_BUSY],
        tokenConfigured: !!cfg[STATE_KEYS.TOKEN],
      })
    })
    return true
  }
  if (msg?.type === 'openOptions') {
    chrome.runtime.openOptionsPage()
    sendResponse({ ok: true })
    return false
  }
  if (msg?.type === 'scrapeProgress') {
    // Forwarded by content.js every few iterations during a scrape. Updates
    // the current group's captured count + latest 3 post snippets so the
    // overlay's run dashboard can render them live. ALSO appends new captures
    // to the rolling RecentCaptures window for the overlay's history pane.
    if (msg.sourceSlug) {
      patchGroup(msg.sourceSlug, () => ({
        captured: msg.captured ?? 0,
        latestPosts: Array.isArray(msg.latestPosts) ? msg.latestPosts.slice(0, 3) : [],
      })).catch(() => {/* swallow */})
      if (Array.isArray(msg.allCaptures) && msg.allCaptures.length > 0) {
        // Look up groupName from runProgress for nicer display in the pane.
        getProgress().then(p => {
          const g = p?.groups?.find(g => g.slug === msg.sourceSlug)
          appendRecentCaptures(msg.sourceSlug, g?.groupName, msg.allCaptures)
            .catch(() => {/* swallow */})
        }).catch(() => {/* swallow */})
      }
    }
    return false
  }
})
