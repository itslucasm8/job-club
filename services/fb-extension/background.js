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
}

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

/** Rewrite www.facebook.com / facebook.com group URLs to m.facebook.com.
 *  Mobile FB uses plain <article> tags with real <a href> permalinks instead
 *  of desktop's heavily-virtualized React tree, so extraction is far more
 *  reliable. Cookies share across the .facebook.com domain so the same
 *  spare-account login works on m. as on www. */
function toMobileFbUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'www.facebook.com' || u.hostname === 'facebook.com') {
      u.hostname = 'm.facebook.com'
      return u.toString()
    }
    return url
  } catch { return url }
}

async function runOneGroup(group) {
  const start = Date.now()
  // active: true is REQUIRED — FB throttles SPA hydration (IntersectionObserver,
  // requestIdleCallback) on background tabs, so the feed never renders any
  // [role="article"] elements. The tradeoff is the tab visibly pops open during
  // a run; on the office machine that's fine and the tab closes when done.
  const mobileUrl = toMobileFbUrl(group.groupUrl)
  const tab = await chrome.tabs.create({ url: mobileUrl, active: true })
  try {
    await waitForTabReady(tab.id)
    // Give the FB feed time to hydrate + render initial posts before scraping.
    // 5s is conservative; FB's first-paint is usually 2-3s on broadband.
    await new Promise(r => setTimeout(r, 5000))
    const result = await sendMessageWithRetry(tab.id, {
      type: 'scrape',
      maxScrollSeconds: group.maxScrollSeconds || 60,
      maxPostsPerRun: group.maxPostsPerRun || 100,
    })
    const posts = result?.posts || []
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

    for (const group of groups) {
      const groupResult = await runOneGroup(group)
      const groupSummary = {
        sourceSlug: groupResult.sourceSlug,
        postsCaptured: groupResult.postsCaptured,
        scrollDuration: groupResult.scrollDuration,
        stopReason: groupResult.stopReason,
        // Carry the DOM probe through to the heartbeat so we can debug from
        // the admin UI when 0 posts captured.
        ...(groupResult.diagnostic ? { diagnostic: groupResult.diagnostic } : {}),
        ...(groupResult.error ? { error: groupResult.error } : {}),
      }
      summary.totalPosts += groupResult.postsCaptured
      if (groupResult.error) summary.totalErrors += 1

      // Ship the batch even if it's small — keeps state moving.
      if (groupResult.posts.length > 0) {
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
          // Roll the ingest outcome up into the group summary so the popup +
          // admin UI can show useful counters without a second round-trip.
          groupSummary.ingested = ingestResp?.ingested ?? 0
          groupSummary.duplicates = ingestResp?.duplicates ?? 0
          groupSummary.extractionErrors = ingestResp?.errors ?? 0
          if (ingestResp?.errors > 0) summary.totalErrors += ingestResp.errors
          if (Array.isArray(ingestResp?.errorDetails) && ingestResp.errorDetails.length > 0) {
            groupSummary.errorSamples = ingestResp.errorDetails.slice(0, 3)
          }
        } catch (e) {
          console.warn('[fb-ext] ingest-batch failed for', groupResult.sourceSlug, e)
          groupSummary.error = (groupSummary.error || '') + ' / ingest: ' + (e?.message || String(e))
          summary.totalErrors += 1
        }
      }
      summary.groupRuns.push(groupSummary)
    }

    summary.completedAt = new Date().toISOString()
  } catch (e) {
    summary.error = e?.message || String(e)
    summary.completedAt = new Date().toISOString()
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

// ─── Message routing ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'runNow') {
    runAll(msg.triggeredBy || 'manual')
      .then(s => sendResponse({ ok: true, summary: s }))
      .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
    return true   // keep channel open for async response
  }
  if (msg?.type === 'getStatus') {
    chrome.storage.local.get([STATE_KEYS.LAST_RUN, STATE_KEYS.RUN_BUSY], (r) => {
      sendResponse({
        lastRun: r[STATE_KEYS.LAST_RUN] || null,
        running: !!r[STATE_KEYS.RUN_BUSY],
      })
    })
    return true
  }
})
