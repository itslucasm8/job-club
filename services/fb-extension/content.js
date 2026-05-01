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

// ─── Real DOM mining (Day 3) ──────────────────────────────────────────────

const MAX_HTML_BYTES = 50_000   // per post — Claude has a 25K char input limit anyway
const PERMALINK_PATTERNS = [
  /\/groups\/(\d+|[\w.-]+)\/(?:permalink|posts)\/([\w-]+)/,
  /\/permalink\.php\?(?:[^"'#]*&)?story_fbid=([\w-]+)/,
  /\/groups\/[\w.-]+\/posts\/(\d+)/,
]

/** Extract a stable post id from a permalink href. FB has multiple permalink
 *  shapes — try each. Returns null if no pattern matches. */
function postIdFromHref(href) {
  if (!href) return null
  for (const re of PERMALINK_PATTERNS) {
    const m = re.exec(href)
    if (!m) continue
    // The post id is the LAST captured group across these patterns.
    return m[m.length - 1]
  }
  return null
}

/** Find the permalink anchor inside a post element. FB renders the post's
 *  timestamp as a link to the post permalink — that's the most stable target. */
function findPermalinkAnchor(postEl) {
  const candidates = postEl.querySelectorAll('a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid="]')
  for (const a of candidates) {
    const href = a.getAttribute('href') || ''
    if (postIdFromHref(href)) return a
  }
  return null
}

function absoluteHref(href) {
  if (!href) return null
  try { return new URL(href, location.origin).toString() }
  catch { return null }
}

/** FB renders relative time ("2h", "Yesterday") but the absolute timestamp
 *  is usually embedded in an aria-label or abbr title or hover tooltip. */
function extractPostedAt(postEl, permalinkAnchor) {
  // Strategy 1: <abbr title="...">  (older FB markup)
  const abbr = postEl.querySelector('abbr[title], abbr[data-utime]')
  if (abbr) {
    const utime = abbr.getAttribute('data-utime')
    if (utime && /^\d+$/.test(utime)) {
      const ms = Number(utime) * 1000
      if (ms > 0) return new Date(ms).toISOString()
    }
    const title = abbr.getAttribute('title')
    if (title) {
      const parsed = Date.parse(title)
      if (!isNaN(parsed)) return new Date(parsed).toISOString()
    }
  }
  // Strategy 2: parent of the time anchor has an aria-label
  if (permalinkAnchor) {
    let cur = permalinkAnchor
    for (let i = 0; i < 4 && cur; i++) {
      const aria = cur.getAttribute && cur.getAttribute('aria-label')
      if (aria && /\d/.test(aria) && /20\d{2}|today|yesterday|ago|min|hour|day|week|month|year|hier|aujourd|min\.|h |jour|semaine|mois|an/i.test(aria)) {
        // Try to parse — Date.parse handles common formats like "Saturday, May 1, 2026 at 3:42 PM"
        const parsed = Date.parse(aria)
        if (!isNaN(parsed)) return new Date(parsed).toISOString()
        // Otherwise return the raw label — server-side can decide.
        return aria
      }
      cur = cur.parentElement
    }
  }
  return null
}

/** First strong-looking author link inside the post header. */
function extractAuthorName(postEl) {
  // Headers are usually h2/h3/h4 wrapping a single anchor with the author name.
  const headerAnchor = postEl.querySelector('h2 a, h3 a, h4 a')
  if (headerAnchor) {
    const txt = (headerAnchor.textContent || '').trim()
    if (txt && txt.length < 200) return txt
  }
  // Fallback: first profile-like anchor in the article.
  const profileAnchor = postEl.querySelector('a[href*="/user/"], a[role="link"][tabindex="0"]')
  if (profileAnchor) {
    const txt = (profileAnchor.textContent || '').trim()
    if (txt && txt.length < 200) return txt
  }
  return null
}

/** Strip noise from the post HTML before sending. Keep header + body, drop
 *  nested articles (= comments), reaction buttons, share/comment buttons. */
function cleanPostHtml(postEl) {
  const clone = postEl.cloneNode(true)
  // Drop nested articles — these are comments on expanded posts, never the
  // body. Hugely reduces noise that would otherwise confuse the classifier
  // (a comment saying "I'll pay $30/hr" being mistaken for the job's pay).
  for (const nested of clone.querySelectorAll('[role="article"]')) {
    if (nested !== clone) nested.remove()
  }
  // Drop reaction / comment / share button rows — pure UI noise.
  for (const ui of clone.querySelectorAll('[role="toolbar"], [aria-label*="React"], [aria-label*="Comment"], [aria-label*="Share"], [aria-label*="commentaire"], [aria-label*="partager"]')) {
    ui.remove()
  }
  // Drop scripts / styles defensively.
  for (const s of clone.querySelectorAll('script, style, noscript')) s.remove()
  let html = clone.outerHTML || ''
  if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES)
  return html
}

/** Extract one post into the wire format consumed by /api/extension/ingest-batch.
 *  Returns null if the post can't be identified (no permalink → can't dedupe). */
function extractPost(postEl) {
  const anchor = findPermalinkAnchor(postEl)
  if (!anchor) return null
  const href = anchor.getAttribute('href')
  const postUrl = absoluteHref(href)
  const postId = postIdFromHref(href)
  if (!postId || !postUrl) return null
  const postedAt = extractPostedAt(postEl, anchor)
  const authorName = extractAuthorName(postEl)
  const html = cleanPostHtml(postEl)
  return { postId, postUrl, postedAt, authorName, html }
}

/** Iterate post elements, extract each, dedupe by postId. Returns the
 *  most recent N (top of feed = newest). */
function capturePosts(elements, max) {
  const seen = new Set()
  const out = []
  for (const el of elements) {
    if (out.length >= max) break
    const post = extractPost(el)
    if (!post) continue
    if (seen.has(post.postId)) continue
    seen.add(post.postId)
    out.push(post)
  }
  return out
}

// ─── Message handler ──────────────────────────────────────────────────────

// Expose a debug helper on window so you can test extraction from DevTools
// without invoking the full run. Call window.__jobClubScrape() in the console
// on an FB group page to see what posts the content script would capture.
//
// NOTE: window-attached helpers in Manifest V3 content scripts run in an
// isolated world, so this won't actually be visible from the page console
// unless you target the extension's content script realm. Easier path for
// debugging is the chrome://extensions → "Inspect views: content_script" link.
try {
  window.__jobClubScrape = () => {
    const { elements, selector } = findPosts()
    const posts = capturePosts(elements, 100)
    console.log('[fb-ext] selector:', selector, 'elements:', elements.length, 'extracted:', posts.length)
    console.table(posts.map(p => ({ postId: p.postId, author: p.authorName, postedAt: p.postedAt, htmlBytes: p.html.length, url: p.postUrl })))
    return posts
  }
} catch {/* swallow — window may not be writable in some contexts */}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'scrape') {
    (async () => {
      try {
        const scrollResult = await autoScroll({
          maxScrollSeconds: msg.maxScrollSeconds || 60,
          maxPostsPerRun: msg.maxPostsPerRun || 100,
        })
        const { elements, selector } = findPosts()
        const posts = capturePosts(elements, msg.maxPostsPerRun || 100)
        sendResponse({
          ok: true,
          posts,
          selector,
          totalElements: elements.length,
          extractedCount: posts.length,
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
