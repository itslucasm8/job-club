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

const IS_MOBILE = location.hostname === 'm.facebook.com' || location.hostname === 'mbasic.facebook.com'

// Mobile FB uses plain <article> tags with real <a href> permalinks.
// data-ft is FB's instrumentation attribute that ONLY appears on top-level
// feed posts, not on comments or sub-elements. Requiring it eliminates the
// "captured a comment as a post" failure mode we saw on the first run.
const MOBILE_SELECTORS = [
  'article[data-ft]',
  '[data-tracking-duration-id] article',             // newer mobile rollout
]

// Desktop FB virtualizes everything. The reliable discriminator is the
// COMBO of [role=feed] ancestor + [role=article] + [aria-posinset]. Sidebar
// "Suggested Groups" cards have role=article but no aria-posinset and no
// [role=feed] ancestor — so requiring all three eliminates them.
const DESKTOP_FEED_SELECTORS = [
  '[role="article"][aria-posinset]',                 // canonical feed-post discriminator
  '[role="article"][aria-describedby]',              // fallback shape
  '[role="article"]',                                // last resort within [role=feed]
]

// Used by the diagnostic probe. Helps identify which selector flavor is live
// when none of FEED_SELECTORS match — every value is reported in the response.
const DIAGNOSTIC_SELECTORS = [
  '[role="feed"]',
  '[role="main"]',
  '[role="article"]',
  '[aria-posinset]',
  '[data-pagelet]',
  '[data-pagelet^="GroupFeed"]',
  '[data-pagelet*="Feed"]',
  '[data-ad-rendering-role]',
  '[data-virtualized]',
  'div[data-ft]',                                    // legacy FB instrumentation
]

/** Anchor selector for "this looks like a post permalink". Used by both
 *  postIdFromHref-based filtering and by findPostsByPermalink. */
const PERMALINK_ANCHOR_SELECTOR = 'a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid="], a[href*="/share/p/"], a[href*="/share/v/"], a[href*="/share/r/"], a[href*="pfbid"]'

const POST_CONTAINER_MIN_TEXT = 100   // climb until ancestor has at least this much text

/** Find posts by walking the page for permalink anchors and climbing up to
 *  each anchor's enclosing post container. Far more robust than structural
 *  selectors because FB cannot rotate permalink URL shapes (the share/embed
 *  ecosystem depends on them) — they're the most stable post signal.
 *
 *  Returns deduped containers. Walking up stops at the smallest ancestor
 *  with at least POST_CONTAINER_MIN_TEXT characters of innerText, which
 *  is the post wrapper (header + body + footer). */
function findPostsByPermalink() {
  const anchors = document.querySelectorAll(PERMALINK_ANCHOR_SELECTOR)
  const seen = new Set()
  const elements = []
  for (const a of anchors) {
    const href = a.getAttribute('href') || ''
    if (!postIdFromHref(href)) continue
    let el = a
    let hops = 0
    while (el && el !== document.body && hops < 12) {
      const text = (el.innerText || '').trim()
      if (text.length >= POST_CONTAINER_MIN_TEXT) break
      el = el.parentElement
      hops++
    }
    if (!el || el === document.body || seen.has(el)) continue
    seen.add(el)
    elements.push(el)
  }
  return { selector: 'permalink-walk', elements }
}

function findPosts() {
  // Mobile FB (m.facebook.com): plain <article> tags. Try first since this
  // is the primary path now — the extension rewrites group URLs to mobile.
  if (IS_MOBILE) {
    for (const sel of MOBILE_SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel))
      if (els.length >= 2) return { selector: sel, elements: els }
    }
    // Fall through if mobile selectors found nothing (shouldn't happen on
    // a real m.facebook.com group page — but be safe).
  }

  // Desktop fallback. Strategy 1: find posts by their canonical
  // [role=feed] + [role=article] + [aria-posinset] discriminator. The
  // combo eliminates sidebar cards which have role=article but no
  // aria-posinset and no [role=feed] ancestor.
  for (const sel of DESKTOP_FEED_SELECTORS) {
    const els = Array.from(document.querySelectorAll(`[role="feed"] ${sel}`))
    if (els.length >= 2) return { selector: `[role="feed"] ${sel}`, elements: els }
  }

  // Strategy 2: permalink-anchor walk. Useful when DOM has posts but no
  // role attributes (some FB rollouts).
  const byPermalink = findPostsByPermalink()
  if (byPermalink.elements.length >= 2) return byPermalink

  // Last resort: whatever the permalink walk found, even if just 1, or empty.
  return byPermalink
}

// ─── Auto-scroll helper (used in Day 3 — skeleton here for review) ────────

function jitter(min, max) {
  return min + Math.random() * (max - min)
}

/** Mobile FB doesn't always lazy-load — sometimes it uses a "See more
 *  posts" / "Voir plus de publications" link at the bottom that needs to
 *  be clicked to reveal the next page. Click any such link found at the
 *  bottom of the document. */
function clickLoadMore() {
  if (!IS_MOBILE) return false
  const candidates = document.querySelectorAll('a, button, div[role="button"]')
  for (const el of candidates) {
    const text = (el.innerText || el.textContent || '').trim().toLowerCase()
    if (!text) continue
    if (
      text.includes('see more posts') ||
      text.includes('voir plus de publications') ||
      text.includes('plus de publications') ||
      text.includes('show more') ||
      text === 'see more' ||
      text === 'voir plus'
    ) {
      try { el.click(); return true } catch {}
    }
  }
  return false
}

async function autoScroll({ maxScrollSeconds = 60, maxPostsPerRun = 100, staleStopAfter = 4, warmupSeconds = 15 }) {
  const start = Date.now()
  let staleScrolls = 0
  const captured = new Map()
  let lastSeenSize = 0
  // Mobile gets faster scroll cadence — markup is lighter and renders quickly.
  // Desktop keeps the slower cadence due to React virtualization hydration.
  const scrollMin = IS_MOBILE ? 800 : 2500
  const scrollMax = IS_MOBILE ? 1800 : 4500
  while (true) {
    const elapsed = (Date.now() - start) / 1000
    if (elapsed >= maxScrollSeconds) break
    const { elements } = findPosts()
    for (const el of elements) {
      const post = extractPost(el)
      if (post && !captured.has(post.postId)) {
        captured.set(post.postId, post)
      }
    }
    if (captured.size >= maxPostsPerRun) {
      return { stopReason: 'count', seconds: elapsed, captured }
    }
    const inWarmup = elapsed < warmupSeconds && captured.size === 0
    if (captured.size === lastSeenSize && !inWarmup) {
      staleScrolls += 1
      // On stale, try clicking a "See more posts" link before giving up —
      // mobile FB uses pagination instead of pure infinite scroll.
      if (staleScrolls >= 2) {
        if (clickLoadMore()) {
          staleScrolls = 0  // give the new content a chance to render
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
      }
      if (staleScrolls >= staleStopAfter) {
        return { stopReason: 'stale', seconds: elapsed, captured }
      }
    } else if (captured.size !== lastSeenSize) {
      staleScrolls = 0
      lastSeenSize = captured.size
    }
    window.scrollBy(0, window.innerHeight * 0.8)
    await new Promise(r => setTimeout(r, jitter(scrollMin, scrollMax)))
  }
  return { stopReason: 'time', seconds: (Date.now() - start) / 1000, captured }
}

// ─── Real DOM mining (Day 3) ──────────────────────────────────────────────

const MAX_HTML_BYTES = 50_000

// FB has many permalink shapes across rollouts. New mid-2026 rollouts use
// /share/p/{shortcode}/ and pfbid-prefixed post ids. Older shapes still
// appear on legacy groups. We try every pattern and accept the first match.
const PERMALINK_PATTERNS = [
  /\/groups\/(?:\d+|[\w.-]+)\/(?:permalink|posts)\/(pfbid[\w]+|\d+)/,
  /\/groups\/[\w.-]+\/posts\/([\w-]+)/,
  /\/permalink\.php\?(?:[^"'#]*&)?story_fbid=(pfbid[\w]+|\d+)/,
  /\/share\/p\/([\w-]+)/,
  /\/share\/v\/([\w-]+)/,
  /\/share\/r\/([\w-]+)/,
  /\/story\.php\?(?:[^"'#]*&)?story_fbid=(pfbid[\w]+|\d+)/,
  /\/posts\/(pfbid[\w]+)/,                     // pfbid anywhere in /posts/
]

function postIdFromHref(href) {
  if (!href) return null
  for (const re of PERMALINK_PATTERNS) {
    const m = re.exec(href)
    if (!m) continue
    return m[m.length - 1]
  }
  return null
}

/** Find the permalink anchor inside a post element. FB renders the post's
 *  timestamp as a link to the post permalink — that's the most stable target.
 *  We try a wide selector net since FB's anchor markup varies by rollout. */
function findPermalinkAnchor(postEl) {
  const candidates = postEl.querySelectorAll(
    'a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid="], a[href*="/share/p/"], a[href*="/share/v/"], a[href*="/share/r/"], a[href*="pfbid"]'
  )
  for (const a of candidates) {
    const href = a.getAttribute('href') || ''
    if (postIdFromHref(href)) return a
  }
  return null
}

/** Stable 32-bit hash of a string. Used to synthesize a postId when we
 *  can't find a permalink — paired with the group URL it gives us a
 *  deterministic dedupe key across re-runs of the same content. */
function hashString(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
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

// A post needs at least this much visible body text to be worth submitting.
// Threshold deliberately low — short job posts ("Hiring kitchen hand $30/hr,
// DM me") are common and valuable. Backend filters non-jobs after extraction.
const MIN_POST_TEXT_CHARS = 30

/** Extract one post into the wire format consumed by /api/extension/ingest-batch.
 *  Always tries to produce a post if there is *any* meaningful content.
 *  Falls back to synthetic IDs when FB doesn't expose a permalink. */
function extractPost(postEl) {
  const visibleText = (postEl.innerText || '').trim()
  if (visibleText.length < MIN_POST_TEXT_CHARS) return null

  const anchor = findPermalinkAnchor(postEl)
  let postId = null
  let postUrl = null
  if (anchor) {
    const href = anchor.getAttribute('href')
    postId = postIdFromHref(href)
    postUrl = absoluteHref(href)
  }
  // Fallback: if no permalink found, synthesize a deterministic postId from
  // the visible text. Same content on a re-run yields the same id, so dedupe
  // still works at the source layer (sourceJobId column in JobCandidate).
  // Pair with the group URL as a stable but non-unique sourceUrl.
  if (!postId) {
    postId = `synth-${hashString(visibleText.slice(0, 500))}`
  }
  if (!postUrl) {
    postUrl = location.href.split('?')[0].split('#')[0]
  }

  const postedAt = extractPostedAt(postEl, anchor)
  const authorName = extractAuthorName(postEl)
  const html = cleanPostHtml(postEl)
  if (!html || html.length < 200) return null
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

/** Inspect a candidate post element to see why extractPost() rejected it.
 *  Returns a compact reason + samples of the data we did/didn't find, so we
 *  can adjust selectors without needing console access. */
function inspectCandidate(el) {
  const visibleText = (el.innerText || '').trim()
  const allLinks = Array.from(el.querySelectorAll('a[href]')).slice(0, 8)
  const hrefSamples = allLinks.map(a => (a.getAttribute('href') || '').slice(0, 120))
  const permalinkAnchor = findPermalinkAnchor(el)
  const headerAnchor = el.querySelector('h2 a, h3 a, h4 a')
  return {
    textLen: visibleText.length,
    textSample: visibleText.slice(0, 100),
    hasPermalinkAnchor: !!permalinkAnchor,
    permalinkHref: permalinkAnchor?.getAttribute('href')?.slice(0, 200) || null,
    hasHeaderAnchor: !!headerAnchor,
    linkCount: el.querySelectorAll('a[href]').length,
    hrefSamples,
    htmlLen: (el.outerHTML || '').length,
    // Why it would fail extractPost(). After the permissive rewrite, no
    // permalink is OK (we synth an id); the only rejects are short text
    // and tiny cleaned HTML.
    rejectReason: visibleText.length < MIN_POST_TEXT_CHARS
      ? `text_too_short(${visibleText.length})`
      : null,
  }
}

/** Run all diagnostic selectors and report element counts. Used when the
 *  scrape returns 0 posts — gives us a snapshot of FB's actual DOM shape
 *  to figure out which selector to add next. */
function diagnoseDom() {
  const probes = {}
  for (const sel of DIAGNOSTIC_SELECTORS) {
    try {
      probes[sel] = document.querySelectorAll(sel).length
    } catch (e) {
      probes[sel] = -1
    }
  }
  // Sample of distinct data-pagelet values currently rendered — narrows down
  // which feed/page surface FB picked for this rollout.
  const pagelets = new Set()
  for (const el of document.querySelectorAll('[data-pagelet]')) {
    const v = el.getAttribute('data-pagelet')
    if (v) pagelets.add(v)
    if (pagelets.size >= 20) break
  }
  // Compare global vs feed-scoped element counts so we can see whether
  // [aria-posinset] is contaminated by sidebar cards.
  const feedScoped = {}
  const feedEl = document.querySelector('[role="feed"]')
  if (feedEl) {
    feedScoped['[role="feed"] [aria-posinset]'] = feedEl.querySelectorAll('[aria-posinset]').length
    feedScoped['[role="feed"] [role="article"]'] = feedEl.querySelectorAll('[role="article"]').length
    feedScoped['[role="feed"] > *'] = feedEl.children.length
  }
  // Inspect the first 3 elements from the winning selector so we can see
  // why extractPost() rejected them.
  const { selector: winner, elements: candidates } = findPosts()
  const candidateInspections = candidates.slice(0, 3).map(inspectCandidate)
  return {
    probes,
    feedScoped,
    pageletsSeen: Array.from(pagelets),
    bodyTextLength: (document.body?.innerText || '').length,
    title: document.title,
    url: location.href,
    winningSelector: winner,
    candidateCount: candidates.length,
    candidateInspections,
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'scrape') {
    (async () => {
      try {
        const scrollResult = await autoScroll({
          maxScrollSeconds: msg.maxScrollSeconds || 60,
          maxPostsPerRun: msg.maxPostsPerRun || 100,
        })
        // Posts were captured incrementally during scroll (because FB's
        // virtualized feed recycles DOM nodes — by the time scroll stops,
        // most posts have already left the DOM). Use the accumulated map.
        const posts = Array.from(scrollResult.captured.values()).slice(0, msg.maxPostsPerRun || 100)
        const { selector, elements } = findPosts()
        const diagnostic = posts.length === 0 ? diagnoseDom() : undefined
        sendResponse({
          ok: true,
          diagnostic,
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
