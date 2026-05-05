// Content script — runs on facebook.com/groups/* pages. Receives a 'scrape'
// message from the background service worker, auto-scrolls the feed at
// human pace, expands collapsed posts ("See more"), captures top-level
// posts (filtering out nested comments), and returns captured post data.
//
// Strategy (2026-05-05): we always run on www.facebook.com — mbasic has been
// effectively retired by FB (any modern UA gets redirected away with
// ?__mmr=1&_rdr). Capture-everything: the LLM in the backend decides which
// captures are jobs and which to discard. The only client-side filtering is
// "top-level post, not a nested comment" which is a structural disambiguation,
// not a content judgement.

console.log('[fb-ext content] loaded on', location.href)

// ─── Selectors ────────────────────────────────────────────────────────────
// FB rotates class names but role-based attributes are stable across rotations.

const IS_MOBILE = location.hostname === 'm.facebook.com'

// Mobile FB (m.facebook.com) uses plain <article> tags with explicit data-ft.
// We rarely land here in 2026 (FB serves www to most UAs) but the path is
// kept as a fallback in case the office machine ever gets routed to m.
const MOBILE_SELECTORS = [
  'article[data-ft]',
  '[data-tracking-duration-id] article',
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

// Design principle: capture everything that looks like a top-level feed
// post — let the backend LLM decide which are jobs. The only client-side
// filtering is "top-level vs nested": on www, comments inside expanded
// posts also have role="article", so a naive `[role="feed"] [role="article"]`
// selector returns posts AND their comments. We need the post wrapper, not
// each comment, otherwise the LLM ends up classifying comment text and
// the real post body never gets captured.

/** True if `el` is a top-level feed post (its nearest [role="article"]
 *  ancestor is the feed container itself, not another article = comment). */
function isTopLevelPost(el) {
  let p = el.parentElement
  while (p && p !== document.body) {
    if (p.getAttribute && p.getAttribute('role') === 'feed') return true
    if (p !== el && p.getAttribute && p.getAttribute('role') === 'article') return false
    p = p.parentElement
  }
  // No [role="feed"] ancestor — keep it (mobile pages don't always wrap in
  // a feed role, and we'd rather have a false positive the LLM rejects than
  // a missed job).
  return true
}

function findPosts() {
  // m.facebook.com fallback path (rare in 2026).
  if (IS_MOBILE) {
    for (const sel of MOBILE_SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel))
      if (els.length >= 2) return { selector: sel, elements: els }
    }
  }

  // www path: every [role="article"] inside the feed, FILTERED to top-level
  // (excludes comments rendered inside expanded posts).
  const allInFeed = Array.from(document.querySelectorAll('[role="feed"] [role="article"]'))
  const topLevel = allInFeed.filter(isTopLevelPost)
  if (topLevel.length >= 1) {
    return { selector: '[role="feed"] [role="article"] (top-level)', elements: topLevel }
  }

  // No [role="feed"] container — try articles with aria-posinset (canonical
  // top-level discriminator that sidesteps the nested-comment problem).
  const posInset = Array.from(document.querySelectorAll('[role="article"][aria-posinset]'))
  if (posInset.length >= 1) {
    return { selector: '[role="article"][aria-posinset]', elements: posInset }
  }

  // Last resort: walk for permalink anchors and climb up.
  return findPostsByPermalink()
}

/** Find and click any "See more" / "Voir plus" expand buttons inside a post
 *  to reveal the collapsed body. Returns true if a click happened so the
 *  caller can wait briefly for the expansion to render. */
function expandSeeMore(postEl) {
  // FB renders the expand control as a clickable div/span with role=button.
  // Match by visible text — class names rotate, text doesn't. We're locale-
  // aware because Lucas's office machine session is in French; users on the
  // FB account language will see English/French/etc. Cover the common ones.
  const buttons = postEl.querySelectorAll('div[role="button"], span[role="button"], [tabindex="0"]')
  let clicked = false
  for (const b of buttons) {
    const text = (b.innerText || b.textContent || '').trim().toLowerCase()
    if (!text || text.length > 30) continue
    if (
      text === 'see more' ||
      text === 'voir plus' ||
      text === 'show more' ||
      text === 'plus' ||
      text === 'leer más' ||
      text === 'mostra altro' ||
      text === 'mehr anzeigen'
    ) {
      try { b.click(); clicked = true } catch {/* swallow */}
    }
  }
  return clicked
}

// ─── Auto-scroll helper (used in Day 3 — skeleton here for review) ────────

function jitter(min, max) {
  return min + Math.random() * (max - min)
}

// (mbasic.facebook.com strategy removed 2026-05-05 — FB redirects mbasic to
// www for any modern UA, the two-pass code never actually fired in production
// and was masking the real problem on www.)

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

async function autoScroll({ maxScrollSeconds = 60, maxPostsPerRun = 100, staleStopAfter = 6, warmupSeconds = 25, sourceSlug = null }) {
  const start = Date.now()
  let staleScrolls = 0
  const captured = new Map()
  // Track which post elements we've already expanded so we don't keep
  // clicking "See more" on the same one every iteration.
  const expanded = new WeakSet()
  let lastSeenSize = 0
  let lastProgressSent = 0
  // Expose live progress for overlay.js on the SAME tab (same isolated
  // world — direct read via window.__jcScrapeStatus).
  const tickProgress = (extra = {}) => {
    try {
      window.__jcScrapeStatus = {
        active: true,
        captured: captured.size,
        elapsedSeconds: (Date.now() - start) / 1000,
        ...extra,
      }
    } catch {/* swallow */}
  }
  // Send progress to background → chrome.storage so overlays on OTHER tabs
  // (e.g. the FB home tab the user clicked Scrape-all from) see updates too.
  // Throttled — every 2.5s.
  const sendProgress = () => {
    if (!sourceSlug) return
    const now = Date.now()
    if (now - lastProgressSent < 2500) return
    lastProgressSent = now
    const all = Array.from(captured.values()).map(p => ({
      postId: p.postId,
      postUrl: p.postUrl,
      snippet: extractSnippet(p),
    }))
    // Last 3 for the live dashboard's per-group "latest posts" mini-list.
    const recent = all.slice(-3)
    try {
      chrome.runtime.sendMessage({
        type: 'scrapeProgress',
        sourceSlug,
        captured: captured.size,
        latestPosts: recent,
        // All captures (deduped server-side) for the overlay's persistent
        // Recent Captures pane.
        allCaptures: all,
      })
    } catch {/* swallow — SW may not respond, that's fine */}
  }
  tickProgress()
  // Mobile gets faster scroll cadence — markup is lighter and renders quickly.
  // www requires patience: React virtualization renders posts in batches as
  // they enter the viewport, and "See more" expansion needs ~300ms to settle.
  const scrollMin = IS_MOBILE ? 800 : 3000
  const scrollMax = IS_MOBILE ? 1800 : 4500
  while (true) {
    const elapsed = (Date.now() - start) / 1000
    if (elapsed >= maxScrollSeconds) break
    const { elements } = findPosts()
    // Step 1 — expand collapsed posts before reading their bodies. Without
    // this, captured HTML is the truncated preview ("We have a position
    // going in loganholme."), the LLM can't extract, and we lose real jobs.
    let didExpand = false
    for (const el of elements) {
      if (expanded.has(el)) continue
      if (expandSeeMore(el)) {
        expanded.add(el)
        didExpand = true
      } else {
        // Even posts without "See more" — mark as visited so we don't probe
        // them again. extractPost is cheap so this is purely an optimization.
        expanded.add(el)
      }
    }
    // Give FB ~400ms to expand the bodies before we read the DOM.
    if (didExpand) {
      await new Promise(r => setTimeout(r, 400))
    }
    // Step 2 — extract from the (now-expanded) DOM.
    for (const el of elements) {
      const post = extractPost(el)
      if (post && !captured.has(post.postId)) {
        captured.set(post.postId, post)
      }
    }
    tickProgress({ visibleNow: elements.length })
    sendProgress()
    if (captured.size >= maxPostsPerRun) {
      try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
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
        try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
        return { stopReason: 'stale', seconds: elapsed, captured }
      }
    } else if (captured.size !== lastSeenSize) {
      staleScrolls = 0
      lastSeenSize = captured.size
    }
    window.scrollBy(0, window.innerHeight * 0.8)
    await new Promise(r => setTimeout(r, jitter(scrollMin, scrollMax)))
  }
  try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
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
// Mobile FB renders inline comments as <article> too — even with the
// top-level filter, very short articles are usually fragment cards or
// "X liked Y's comment" notifications. Real job posts are at least a few
// sentences. Desktop keeps a lower threshold since posts there have less
// rendered chrome.
const MIN_POST_TEXT_CHARS = IS_MOBILE ? 80 : 30

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

/** Compact title-like snippet from a captured post — first 80 visible chars
 *  of the cleaned HTML, trimmed of surrounding whitespace. Used by the live
 *  run dashboard so the user can see the actual posts streaming in. */
function extractSnippet(post) {
  if (!post?.html) return ''
  // Parse the captured HTML in a detached doc so innerText works without
  // re-rendering. innerText preserves the visible-text shape better than
  // textContent (skips hidden / display:none chrome).
  try {
    const doc = new DOMParser().parseFromString(post.html, 'text/html')
    const body = doc.body || doc.documentElement
    const text = (body?.innerText || body?.textContent || '').replace(/\s+/g, ' ').trim()
    // Skip the author's name + timestamp prefix. Heuristic: posts often start
    // with the author name (already in post.authorName) — strip it if present.
    let s = text
    if (post.authorName && s.startsWith(post.authorName)) {
      s = s.slice(post.authorName.length).trim()
    }
    return s.slice(0, 80)
  } catch {
    return ''
  }
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
        const result = await autoScroll({
          maxScrollSeconds: msg.maxScrollSeconds || 60,
          maxPostsPerRun: msg.maxPostsPerRun || 100,
          sourceSlug: msg.sourceSlug || null,
        })
        const posts = Array.from(result.captured.values()).slice(0, msg.maxPostsPerRun || 100)
        const { selector, elements } = findPosts()
        const diagnostic = posts.length === 0 ? diagnoseDom() : undefined
        sendResponse({
          ok: true,
          diagnostic,
          posts,
          selector,
          mode: 'scroll',
          totalElements: elements.length,
          extractedCount: posts.length,
          stopReason: result.stopReason,
          scrollSeconds: result.seconds,
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
