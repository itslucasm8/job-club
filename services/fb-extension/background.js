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

// ─── Storage helpers ──────────────────────────────────────────────────────

async function getConfig() {
  const { [STATE_KEYS.TOKEN]: token, [STATE_KEYS.BACKEND]: backend } = await chrome.storage.sync.get([STATE_KEYS.TOKEN, STATE_KEYS.BACKEND])
  return {
    token: token || '',
    backend: backend || DEFAULT_BACKEND,
  }
}

async function setRunBusy(busy) {
  await chrome.storage.local.set({ [STATE_KEYS.RUN_BUSY]: !!busy })
}

async function setLastRun(summary) {
  await chrome.storage.local.set({ [STATE_KEYS.LAST_RUN]: summary })
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const { token, backend } = await getConfig()
  if (!token) throw new Error('Token non configuré (ouvrir les options)')
  const res = await fetch(`${backend}${path}`, {
    ...opts,
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
  const tab = await chrome.tabs.create({ url: group.groupUrl, active: true })
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
      summary.groupRuns.push({
        sourceSlug: groupResult.sourceSlug,
        postsCaptured: groupResult.postsCaptured,
        scrollDuration: groupResult.scrollDuration,
        ...(groupResult.error ? { error: groupResult.error } : {}),
      })
      summary.totalPosts += groupResult.postsCaptured
      if (groupResult.error) summary.totalErrors += 1

      // Ship the batch even if it's small — keeps state moving.
      if (groupResult.posts.length > 0) {
        try {
          await apiFetch('/api/extension/ingest-batch', {
            method: 'POST',
            body: JSON.stringify({
              sourceSlug: groupResult.sourceSlug,
              posts: groupResult.posts,
              scrapedAt: new Date().toISOString(),
              scrollDuration: groupResult.scrollDuration,
            }),
          })
        } catch (e) {
          console.warn('[fb-ext] ingest-batch failed for', groupResult.sourceSlug, e)
          // Don't bail — try the next group.
          summary.totalErrors += 1
        }
      }
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
