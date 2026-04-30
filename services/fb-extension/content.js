// Content script — runs on facebook.com/groups/* pages. Receives a 'scrape'
// message from the background service worker, auto-scrolls the feed at
// human pace, and returns captured post data.
//
// Day 2 = scaffold + smoke test. Day 3 fills in the actual scraping logic.
// For now this script: detects the feed container, responds with a count
// of post-like elements visible, no actual data extraction yet.

console.log('[fb-ext content] loaded on', location.href)

// ─── Selectors ────────────────────────────────────────────────────────────
// FB rotates class names but role-based attributes are stable across rotations.
// Multiple selectors with graceful degradation — first non-empty wins.

const POST_SELECTORS = [
  '[role="feed"] [role="article"]',
  '[data-pagelet^="GroupFeed"] [role="article"]',
  '[role="article"]',
]

function findPosts() {
  for (const sel of POST_SELECTORS) {
    const els = Array.from(document.querySelectorAll(sel))
    if (els.length > 0) return { selector: sel, elements: els }
  }
  return { selector: null, elements: [] }
}

// ─── Auto-scroll helper (used in Day 3 — skeleton here for review) ────────

function jitter(min, max) {
  return min + Math.random() * (max - min)
}

async function autoScroll({ maxScrollSeconds = 60, maxPostsPerRun = 100, staleStopAfter = 3 }) {
  const start = Date.now()
  let staleScrolls = 0
  let lastSeenCount = 0
  while (true) {
    const elapsed = (Date.now() - start) / 1000
    if (elapsed >= maxScrollSeconds) return { stopReason: 'time', seconds: elapsed }
    const { elements } = findPosts()
    if (elements.length >= maxPostsPerRun) return { stopReason: 'count', seconds: elapsed }
    if (elements.length === lastSeenCount) {
      staleScrolls += 1
      if (staleScrolls >= staleStopAfter) return { stopReason: 'stale', seconds: elapsed }
    } else {
      staleScrolls = 0
      lastSeenCount = elements.length
    }
    window.scrollBy(0, window.innerHeight * 0.8)
    await new Promise(r => setTimeout(r, jitter(1500, 3500)))
  }
}

// ─── Day 2 stub: capture minimal post info, no full extraction yet ───────

function capturePostsStub(elements) {
  // Day 2: return a placeholder. Day 3 replaces this with real DOM mining
  // (postId, postUrl, postedAt, authorName, outerHTML).
  return elements.slice(0, 10).map((el, i) => ({
    postId: `stub-${i}-${Date.now()}`,
    postUrl: location.href,
    postedAt: null,
    authorName: null,
    html: el.outerHTML.slice(0, 5000),
  }))
}

// ─── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'scrape') {
    (async () => {
      try {
        const scrollResult = await autoScroll({
          maxScrollSeconds: msg.maxScrollSeconds || 60,
          maxPostsPerRun: msg.maxPostsPerRun || 100,
        })
        const { elements, selector } = findPosts()
        const posts = capturePostsStub(elements.slice(0, msg.maxPostsPerRun || 100))
        sendResponse({
          ok: true,
          posts,
          selector,
          stopReason: scrollResult.stopReason,
          scrollSeconds: scrollResult.seconds,
        })
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e), posts: [] })
      }
    })()
    return true
  }
  if (msg?.type === 'ping') {
    sendResponse({ ok: true, url: location.href, posts: findPosts().elements.length })
    return true
  }
})
