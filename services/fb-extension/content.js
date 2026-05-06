// Content script — runs on facebook.com/groups/* pages. Receives a 'scrape'
// message from the background service worker, runs an incremental
// scroll-and-capture loop on the live feed, expands "See more" on each post,
// and returns the captured posts.
//
// Selector strategy validated against current FB markup (May 2026): the
// canonical [role="article"][aria-posinset] selector returns ZERO matches
// on group feeds today. FB's Comet renderer now anchors posts as direct
// children of [role="feed"], with content marked by data-ad-rendering-role
// attributes. The data-ad- prefix is misleading internal naming — these
// markers identify ALL feed items (organic posts, not just ads).
//
// Source of truth: the validated FB scraping spec (Sections 1-8) — see
// commit message and project memory for the full document.

console.log('[fb-ext content] loaded on', location.href)

// ─── Selectors (validated 2026-05-06 against live FB feed) ───────────────

const POST_CONTAINER_SELECTOR = '[role="feed"] > div'

// Inner-piece markers. data-ad-rendering-role values discovered empirically.
const MARKER_STORY = '[data-ad-rendering-role="story_message"]'
const MARKER_AUTHOR = '[data-ad-rendering-role="profile_name"]'
const MARKER_TITLE = '[data-ad-rendering-role="title"]'
const MARKER_DESC = '[data-ad-rendering-role="description"]'
const MARKER_META = '[data-ad-rendering-role="meta"]'

// Anti-scrape obfuscation: FB injects random alphanumeric strings into
// meta and (sometimes) description fields. Two forms observed in the wild:
//   - Short with .com suffix: "1KkWEX.com", "H0n7TQNd0T.com"
//   - Long pure alphanumeric (30+ chars): "yaJ0wdqvVle4F1fY5c3XjmwIQheem..."
// Real description text contains spaces, hyphens, punctuation — a continuous
// 30+-char alphanumeric run is essentially never legitimate at this layer.
const OBFUSCATION_RE = /^[A-Za-z0-9]+\.com$|^[A-Za-z0-9]{30,}$/

// Diagnostic selectors — reported when no posts are captured, so we can see
// what FB's actual DOM shape is at the time of a failed run.
const DIAGNOSTIC_SELECTORS = [
  '[role="feed"]',
  '[role="feed"] > div',
  '[data-ad-rendering-role="story_message"]',
  '[data-ad-rendering-role="profile_name"]',
  '[role="article"]',
  '[aria-posinset]',
  '[data-virtualized="false"]',
  '[data-pagelet]',
]

/** Return only the [role="feed"] direct children that are actual posts.
 *  The :has(story_message) content gate cleanly excludes:
 *  - "Suggested groups" cards (no story_message)
 *  - "You've reached the end" markers (no story_message)
 *  - Skeleton loaders (no story_message)
 *  - Sponsored-but-unstructured slots (no story_message)
 *  Validated: in a 26-direct-children feed, this returned exactly the 4
 *  actual posts. Zero false positives. */
function findPosts() {
  const all = Array.from(document.querySelectorAll(POST_CONTAINER_SELECTOR))
  const posts = all.filter(el => el.querySelector(MARKER_STORY))
  return { selector: `${POST_CONTAINER_SELECTOR} :has(${MARKER_STORY})`, elements: posts }
}

// ─── See-more expansion ──────────────────────────────────────────────────
// Synthetic clicks WORK on this layout (verified empirically: 487→774 chars
// and 379→1007 chars expansions both succeeded). No chrome.debugger needed.
// Key: target the LEAF [role="button"] node, not a wrapper that contains
// the See-more text via innerText bubbling.

const SEE_MORE_RE = /^(See more|Voir plus|En savoir plus|Lire la suite|Mehr anzeigen|Ver más|Mostra altro)$/i

function reactSafeClick(el) {
  const rect = el.getBoundingClientRect()
  const opts = {
    bubbles: true, cancelable: true, view: window, button: 0,
    clientX: rect.x + 4, clientY: rect.y + 4,
  }
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.dispatchEvent(new MouseEvent('click', opts))
    return true
  } catch {
    try { el.click(); return true } catch { return false }
  }
}

/** Find the leaf [role="button"] inside the post matching See-more text.
 *  Tie-break by smallest descendant count so we always hit the actual
 *  button, not a wrapper paragraph that contains its text. */
function findSeeMoreLeaf(postEl) {
  const buttons = Array.from(postEl.querySelectorAll('[role="button"]'))
    .filter(b => SEE_MORE_RE.test((b.innerText || '').trim()))
  if (!buttons.length) return null
  buttons.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
  return buttons[0]
}

/** Click See-more if present. Returns true if a click was attempted. */
function expandSeeMore(postEl) {
  const btn = findSeeMoreLeaf(postEl)
  if (!btn) return false
  try { btn.scrollIntoView({ block: 'nearest', behavior: 'instant' }) } catch {}
  return reactSafeClick(btn)
}

// ─── Field extraction (per spec Section 5) ───────────────────────────────

const MAX_HTML_BYTES = 50_000

function isObfuscation(s) {
  if (!s) return false
  return OBFUSCATION_RE.test(s.trim())
}

function isDescendantOf(el, ancestor) {
  let p = el.parentElement
  while (p) {
    if (p === ancestor) return true
    p = p.parentElement
  }
  return false
}

/** djb2 hash → base36 string. Used to build a stable dedupe key from
 *  author + body[:200] when FB doesn't expose a permalink. */
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

/** Extract one post into the wire format consumed by /api/extension/ingest-batch.
 *  Returns null for posts to skip (malformed, deleted/private shared). */
function extractPost(postEl) {
  // AUTHOR — use 'a' descendant to skip "Follow" button text + bullet separator.
  const authorEl = postEl.querySelector(`${MARKER_AUTHOR} a`)
  if (!authorEl) return null
  const author = (authorEl.textContent || '').trim()
  if (!author) return null

  // BODY
  const storyEl = postEl.querySelector(MARKER_STORY)
  let body = storyEl ? (storyEl.innerText || '').replace(/\xa0/g, ' ').trim() : ''

  // TITLE / DESCRIPTION — link card or photo card text.
  const titleText = (postEl.querySelector(MARKER_TITLE)?.innerText || '').trim()
  let descText = (postEl.querySelector(MARKER_DESC)?.innerText || '').trim()

  // SKIP deleted/private shared posts.
  if (titleText === "This content isn't available right now") return null

  // PHOTO DETECTION (filter out tiny icons + profile pic).
  const profileEl = postEl.querySelector(MARKER_AUTHOR)
  const contentImgs = Array.from(postEl.querySelectorAll('img')).filter(img => {
    if (profileEl && isDescendantOf(img, profileEl)) return false
    const w = parseInt(img.getAttribute('width') || '0', 10)
    if (w && w < 40) return false
    return true
  })
  const hasPhoto = contentImgs.length > 0

  // PHOTO CAPTION MERGE — when FB splits long captions across story_message
  // (truncated) and description (rest), prefer the description.
  if (hasPhoto && body.length < 30 && descText && !isObfuscation(descText)) {
    body = descText
  }
  if (isObfuscation(descText)) descText = ''

  // PERMALINK — only sometimes present (FB lazy-loads on hover).
  let permalink = null
  const permalinkEl = postEl.querySelector('a[href*="/posts/"], a[href*="/permalink/"]')
  if (permalinkEl) {
    const href = permalinkEl.getAttribute('href') || ''
    permalink = absoluteHref(href.split('?')[0])
  }

  // DEDUPE KEY — no stable post ID exists in DOM. author + body[:200] hash
  // is stable across reruns of the same content.
  const dedupeSource = `${author}::${body.slice(0, 200)}`
  const dedupeHash = hashString(dedupeSource)
  const postId = permalink ? `pl-${hashString(permalink)}` : `dk-${dedupeHash}`
  const postUrl = permalink || `${location.href.split('?')[0].split('#')[0]}#${postId}`

  // Cleaned HTML for the LLM. Strip scripts/styles defensively. The post
  // container itself is a clean unit — no nested-articles to worry about
  // since comments live in [role="article"], not as feed children.
  const clone = postEl.cloneNode(true)
  for (const s of clone.querySelectorAll('script, style, noscript')) s.remove()
  let html = clone.outerHTML || ''
  if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES)
  if (html.length < 200) return null

  return {
    postId,
    postUrl,
    postedAt: null, // not in current FB DOM — see spec Section 8
    authorName: author,
    html,
    // Diagnostic-only fields; backend ignores them.
    _body: body,
    _hasPhoto: hasPhoto,
    _hasLinkCard: !!(titleText || descText),
  }
}

/** Compact title-like snippet for the live run dashboard. */
function extractSnippet(post) {
  const text = (post?._body || '').trim()
  return text.slice(0, 80)
}

// ─── Auto-scroll (virtualization-aware incremental capture) ──────────────
// FB recycles DOM nodes as you scroll — posts that scroll out of viewport
// are removed and replaced with stubs. A naive "scroll-then-read" approach
// returns only the last 3-7 posts (those in DOM at extraction time).
// Required pattern: snapshot every iteration, dedupe across iterations,
// terminate on stale-iteration count (NOT scrollHeight, which is constant
// under virtualization).

function jitter(min, max) {
  return min + Math.random() * (max - min)
}

async function autoScroll({
  maxScrollSeconds = 120,
  maxPostsPerRun = 50,
  staleStopAfter = 3,        // per spec: 3 stale iterations is reliable end-of-feed
  scrollDistance = 1200,     // per spec: 1000-1500px; 2000+ skips posts
  settleMs = 1500,           // per spec: 1500ms minimum after each scroll
  warmupSeconds = 15,
  sourceSlug = null,
  verbose = false,
} = {}) {
  window.__jcVerbose = !!verbose
  const log = verbose ? (...args) => console.log('[JC-DEBUG]', ...args) : () => {}
  log('autoScroll start', { maxScrollSeconds, maxPostsPerRun, staleStopAfter, scrollDistance, settleMs, sourceSlug })

  const start = Date.now()
  const captured = new Map()  // postId → post
  let stale = 0
  let lastSentAt = 0
  let iter = 0

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
  const sendProgress = () => {
    if (!sourceSlug) return
    const now = Date.now()
    if (now - lastSentAt < 2500) return
    lastSentAt = now
    const all = Array.from(captured.values()).map(p => ({
      postId: p.postId,
      postUrl: p.postUrl,
      snippet: extractSnippet(p),
    }))
    try {
      chrome.runtime.sendMessage({
        type: 'scrapeProgress',
        sourceSlug,
        captured: captured.size,
        latestPosts: all.slice(-3),
        allCaptures: all,
      })
    } catch {/* swallow — SW may not respond */}
  }
  tickProgress()

  while (true) {
    iter += 1
    const elapsed = (Date.now() - start) / 1000
    if (elapsed >= maxScrollSeconds) break

    const { selector, elements } = findPosts()
    log(`iter ${iter} t=${elapsed.toFixed(1)}s — ${selector} found=${elements.length} captured=${captured.size}`)

    // Step 1 — expand See-more on every visible post (spec Section 7,
    // strategy 1: expand before snapshotting). Cheap if no See-more present.
    let didExpand = false
    for (const el of elements) {
      if (expandSeeMore(el)) didExpand = true
    }
    if (didExpand) await new Promise(r => setTimeout(r, 500))

    // Step 2 — extract every visible post. The Map keys by postId so re-
    // captures of the same post (across scroll iterations) overwrite, which
    // means a post captured pre-expansion gets upgraded to its expanded form
    // on a later iteration if it stayed in viewport.
    let added = 0
    for (const el of elements) {
      const post = extractPost(el)
      if (!post) continue
      const existing = captured.get(post.postId)
      const grew = existing && (post.html?.length || 0) > (existing.html?.length || 0)
      if (!existing || grew) {
        captured.set(post.postId, post)
        if (!existing) added += 1
        if (verbose) {
          log(`  ${existing ? 'GROW' : 'NEW'} ${post.postId} bytes=${post.html.length} text="${extractSnippet(post)}"`)
        }
      }
    }

    tickProgress({ visibleNow: elements.length })
    sendProgress()

    if (captured.size >= maxPostsPerRun) {
      try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
      log(`autoScroll DONE — captured=${captured.size} elapsed=${elapsed.toFixed(1)}s stopReason=count`)
      return { stopReason: 'count', seconds: elapsed, captured }
    }

    // Stale-iteration termination. During warmup (early seconds with 0
    // posts), don't count stale — virtualizer just hasn't rendered yet.
    const inWarmup = elapsed < warmupSeconds && captured.size === 0
    if (added === 0 && !inWarmup) {
      stale += 1
      if (stale >= staleStopAfter) {
        try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
        log(`autoScroll DONE — captured=${captured.size} elapsed=${elapsed.toFixed(1)}s stopReason=stale`)
        return { stopReason: 'stale', seconds: elapsed, captured }
      }
    } else if (added > 0) {
      stale = 0
    }

    // Scroll: window.scrollBy is sufficient (verified by spec; FB feed responds
    // to actual scroll position changes, not WheelEvent). Per-iteration
    // distance + settle as per spec.
    try { window.scrollBy({ top: scrollDistance, behavior: 'instant' }) } catch {}
    await new Promise(r => setTimeout(r, settleMs + jitter(0, 500)))
  }

  try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
  log(`autoScroll DONE — captured=${captured.size} stopReason=time`)
  return { stopReason: 'time', seconds: (Date.now() - start) / 1000, captured }
}

// ─── Diagnostic ──────────────────────────────────────────────────────────

function inspectCandidate(el) {
  const visibleText = (el.innerText || '').trim()
  return {
    textLen: visibleText.length,
    textSample: visibleText.slice(0, 100),
    hasStoryMessage: !!el.querySelector(MARKER_STORY),
    hasProfileName: !!el.querySelector(MARKER_AUTHOR),
    hasTitle: !!el.querySelector(MARKER_TITLE),
    hasDescription: !!el.querySelector(MARKER_DESC),
    hasPermalink: !!el.querySelector('a[href*="/posts/"], a[href*="/permalink/"]'),
    hasSeeMore: !!findSeeMoreLeaf(el),
    htmlLen: (el.outerHTML || '').length,
  }
}

function diagnoseDom() {
  const probes = {}
  for (const sel of DIAGNOSTIC_SELECTORS) {
    try { probes[sel] = document.querySelectorAll(sel).length } catch { probes[sel] = -1 }
  }
  const feedEl = document.querySelector('[role="feed"]')
  const feedScoped = {}
  if (feedEl) {
    feedScoped['[role="feed"] children'] = feedEl.children.length
    feedScoped['[role="feed"] > div with story_message'] =
      Array.from(feedEl.children).filter(c => c.querySelector?.(MARKER_STORY)).length
  }
  const { selector, elements } = findPosts()
  return {
    probes,
    feedScoped,
    title: document.title,
    url: location.href,
    bodyTextLength: (document.body?.innerText || '').length,
    winningSelector: selector,
    candidateCount: elements.length,
    candidateInspections: elements.slice(0, 3).map(inspectCandidate),
  }
}

// ─── Debug helper for DevTools ───────────────────────────────────────────
try {
  window.__jobClubScrape = () => {
    const { elements, selector } = findPosts()
    const posts = elements.map(extractPost).filter(Boolean)
    console.log('[fb-ext] selector:', selector, 'elements:', elements.length, 'extracted:', posts.length)
    console.table(posts.map(p => ({
      postId: p.postId,
      author: p.authorName,
      bytes: p.html.length,
      hasPhoto: p._hasPhoto,
      hasLinkCard: p._hasLinkCard,
      snippet: extractSnippet(p),
    })))
    return posts
  }
} catch {/* window may not be writable */}

// ─── Message handler ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'scrape') {
    (async () => {
      try {
        const result = await autoScroll({
          maxScrollSeconds: msg.maxScrollSeconds || 90,
          maxPostsPerRun: msg.maxPostsPerRun || 50,
          sourceSlug: msg.sourceSlug || null,
          verbose: !!msg.verbose,
        })
        // Strip diagnostic-only fields before sending to backend.
        const posts = Array.from(result.captured.values())
          .slice(0, msg.maxPostsPerRun || 50)
          .map(({ _body, _hasPhoto, _hasLinkCard, ...wire }) => wire)
        const { selector, elements } = findPosts()
        const diagnostic = posts.length === 0 ? diagnoseDom() : undefined
        sendResponse({
          ok: true,
          diagnostic,
          posts,
          selector,
          mode: 'feed',
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
