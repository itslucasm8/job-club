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

  // PRIMARY: [role="article"][aria-posinset] — FB's canonical "this is feed
  // post #N" attribute. Comments, suggested-groups cards, ads, and
  // engagement widgets all have role="article" but ONLY top-level feed
  // posts get aria-posinset. This sidesteps the comment-leak problem
  // structurally rather than relying on isTopLevelPost's ancestor walk.
  const posInset = Array.from(document.querySelectorAll('[role="article"][aria-posinset]'))
  if (posInset.length >= 1) {
    return { selector: '[role="article"][aria-posinset]', elements: posInset }
  }

  // FALLBACK 1: top-level [role="article"] inside [role="feed"]. Used when
  // FB rolls out a layout that omits aria-posinset (rare but happens).
  const allInFeed = Array.from(document.querySelectorAll('[role="feed"] [role="article"]'))
  const topLevel = allInFeed.filter(isTopLevelPost)
  if (topLevel.length >= 1) {
    return { selector: '[role="feed"] [role="article"] (top-level)', elements: topLevel }
  }

  // FALLBACK 2: walk for permalink anchors and climb up.
  return findPostsByPermalink()
}

// Track per-post expansion attempts. WeakMap auto-cleans when FB virtualizes
// the element away. Allows up to 3 retries: first click sometimes lands too
// early (before FB hydrates the button), or doesn't trigger React's handler.
const expansionState = new WeakMap()  // Element → { attempts, expanded }
const MAX_EXPAND_ATTEMPTS = 3

/** Trigger a click that React's event delegation will actually catch. Plain
 *  `el.click()` fails on a lot of React-rendered controls because React
 *  listens via synthetic events keyed on pointer/mouse events, not the
 *  programmatic `click()` shortcut. Dispatch the full sequence. */
function reactSafeClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window, button: 0 }
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

/** Heuristic match for the "See more" expand button. FB renders this in many
 *  shapes: <div role="button">See more</div>, <span tabindex="0">… See more</span>,
 *  with leading "..." or zero-width-space prefixes. We use `.includes()` with
 *  a length cap so we don't match unrelated buttons like "Click here to see
 *  more results from this group". Also catches aria-expanded="false" elements
 *  which is React's structured way of marking a collapsible.
 *  IMPORTANT: skip "See more posts" (the page-level pagination link, not the
 *  per-post expand) — clicking that triggers feed pagination, not body expand. */
function isSeeMoreButton(el) {
  const text = (el.innerText || el.textContent || '').trim().toLowerCase()
  if (text === 'see more posts' || text === 'voir plus de publications') return false
  if (!text || text.length > 25) {
    // Even with no/long text, an aria-expanded="false" element is a strong
    // signal it's a collapsible we should click to expand.
    if (el.getAttribute && el.getAttribute('aria-expanded') === 'false' && text.length <= 60) {
      return true
    }
    return false
  }
  return (
    text.includes('see more') ||
    text.includes('voir plus') ||
    text.includes('show more') ||
    text.includes('lire la suite') ||
    text.includes('continue reading') ||
    text.includes('ver más') ||
    text === 'plus' ||
    text === 'more' ||
    text === 'mehr' ||
    text === 'mehr anzeigen' ||
    text === 'leer más' ||
    text === 'mostra altro' ||
    text === '…more' ||
    text === '...more'
  )
}

/** Returns true if there's still a See-more button visible inside the post,
 *  meaning the body is still collapsed. Used as the success check after a
 *  click — if the button is gone, expansion worked. */
function isStillCollapsed(postEl) {
  const candidates = postEl.querySelectorAll('div[role="button"], span[role="button"], [tabindex="0"], [aria-expanded="false"], a[role="button"]')
  for (const el of candidates) {
    if (isSeeMoreButton(el)) return true
  }
  return false
}

/** Find and click any "See more" / "Voir plus" expand buttons inside a post.
 *  Returns true if at least one click was attempted. Per-element retry state
 *  is tracked so the autoScroll loop comes back to a post on subsequent
 *  iterations if the first click didn't expand it. */
function expandSeeMore(postEl) {
  const state = expansionState.get(postEl) || { attempts: 0, expanded: false }
  if (state.expanded) return false
  if (state.attempts >= MAX_EXPAND_ATTEMPTS) return false
  // Confirm the post is actually collapsed before doing work — short posts
  // don't render "See more" and we'd waste cycles trying to find one.
  if (state.attempts > 0 && !isStillCollapsed(postEl)) {
    expansionState.set(postEl, { ...state, expanded: true })
    return false
  }
  const candidates = postEl.querySelectorAll('div[role="button"], span[role="button"], [tabindex="0"], [aria-expanded="false"], a[role="button"]')
  let clicked = false
  for (const el of candidates) {
    if (!isSeeMoreButton(el)) continue
    // Scroll the button into view first — FB's IntersectionObserver may
    // refuse to render the expanded body unless the button is visible.
    try { el.scrollIntoView({ block: 'nearest', behavior: 'instant' }) } catch {}
    if (reactSafeClick(el)) clicked = true
  }
  expansionState.set(postEl, {
    attempts: state.attempts + 1,
    expanded: clicked,  // optimistic; the next iteration verifies via isStillCollapsed
  })
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

/** Drive the page's scroll position the way a human does — real WheelEvent
 *  on the document, plus a Page Down keypress, plus a fallback scrollBy.
 *  Why: modern FB gates lazy-load on user-input events. Plain
 *  window.scrollBy(0, N) changes the scroll number but doesn't fire `wheel`
 *  or `keydown`, so FB's React doesn't know to fetch more posts and the
 *  feed stays frozen at the top 5–7. We dispatch the inputs FB is listening
 *  for, then fall back to scrollBy in case some rollouts ignore wheel events.
 */
function userScroll(deltaY) {
  // 1. WheelEvent on document — bubbles to React handlers on body / feed.
  try {
    const evt = new WheelEvent('wheel', {
      deltaY, deltaMode: 0, bubbles: true, cancelable: true, view: window,
    })
    document.dispatchEvent(evt)
  } catch {/* swallow */}
  // 2. WheelEvent on the feed container too, in case React listens there.
  try {
    const feed = document.querySelector('[role="feed"]') || document.scrollingElement
    if (feed && feed !== document) {
      feed.dispatchEvent(new WheelEvent('wheel', {
        deltaY, deltaMode: 0, bubbles: true, cancelable: true, view: window,
      }))
    }
  } catch {/* swallow */}
  // 3. Page Down keydown — some FB layouts respond to keyboard scroll.
  try {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true,
    }))
  } catch {/* swallow */}
  // 4. Belt-and-braces — actually move the scroll position.
  try { window.scrollBy(0, deltaY) } catch {/* swallow */}
}

async function autoScroll({ maxScrollSeconds = 120, maxPostsPerRun = 100, staleStopAfter = 10, warmupSeconds = 25, sourceSlug = null, verbose = false }) {
  // Stash the verbose flag on window so the chatter filter + extractPost
  // can also log without us threading the param everywhere.
  window.__jcVerbose = !!verbose
  const log = verbose
    ? (...args) => console.log('[JC-DEBUG]', ...args)
    : () => {}
  log('autoScroll start', { maxScrollSeconds, maxPostsPerRun, staleStopAfter, warmupSeconds, sourceSlug })
  const start = Date.now()
  let staleScrolls = 0
  const captured = new Map()
  // Per-post expansion state lives in the module-level expansionState
  // WeakMap (set by expandSeeMore). We don't track "already extracted"
  // here because the captured Map already keys by postId — re-extraction
  // on later iterations is cheap and lets us catch expanded bodies that
  // weren't ready the first time around.
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
  let iterCount = 0
  while (true) {
    iterCount += 1
    const elapsed = (Date.now() - start) / 1000
    if (elapsed >= maxScrollSeconds) break
    const { selector, elements } = findPosts()
    log(`iter ${iterCount} t=${elapsed.toFixed(1)}s — selector="${selector}" found=${elements.length} captured=${captured.size}`)
    // Step 1 — expand collapsed posts before reading their bodies. Without
    // this, captured HTML is the truncated preview ("We have a position
    // going in loganholme."), the LLM can't extract, and we lose real jobs.
    // expandSeeMore tracks per-post retry state internally so a post that
    // didn't expand on the first click gets another shot next iteration.
    let didExpand = false
    for (const el of elements) {
      if (expandSeeMore(el)) didExpand = true
    }
    if (verbose && didExpand) log(`  expanded see-more on at least one post`)
    // Give FB ~800ms to render the expanded bodies before we read the DOM.
    // Bumped from 400ms — a few rollouts hydrate slowly enough that 400ms
    // captured the still-truncated body even after a successful click.
    if (didExpand) {
      await new Promise(r => setTimeout(r, 800))
    }
    // Step 2 — extract from the (now-expanded) DOM. We re-extract on every
    // iteration even for posts already in `captured`: a post's expanded body
    // may not have been ready on its first capture pass, and overwriting
    // the Map entry with the fresh fuller version is what we want.
    for (const el of elements) {
      const post = extractPost(el)
      if (!post) continue
      const existing = captured.get(post.postId)
      const isNew = !existing
      const grew = existing && (post.html?.length || 0) > (existing.html?.length || 0)
      if (isNew || grew) {
        captured.set(post.postId, post)
        if (verbose) {
          const snippet = extractSnippet(post)
          log(`  ${isNew ? 'NEW' : 'GROW'} post ${post.postId} bytes=${post.html.length} text="${snippet.slice(0, 60)}…"`)
        }
      }
    }
    tickProgress({ visibleNow: elements.length })
    sendProgress()
    if (captured.size >= maxPostsPerRun) {
      try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
      log(`autoScroll DONE — captured=${captured.size} elapsed=${elapsed.toFixed(1)}s stopReason=count`)
      if (verbose) console.table(Array.from(captured.values()).map(p => ({ postId: p.postId, bytes: p.html.length, snippet: extractSnippet(p).slice(0, 80) })))
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
        log(`autoScroll DONE — captured=${captured.size} elapsed=${elapsed.toFixed(1)}s stopReason=stale (no growth for ${staleStopAfter} iter)`)
        if (verbose) console.table(Array.from(captured.values()).map(p => ({ postId: p.postId, bytes: p.html.length, snippet: extractSnippet(p).slice(0, 80) })))
        return { stopReason: 'stale', seconds: elapsed, captured }
      }
    } else if (captured.size !== lastSeenSize) {
      staleScrolls = 0
      lastSeenSize = captured.size
    }
    // Drive scroll via real input events so FB's lazy-load fires. Plus
    // scroll the LAST captured/visible article into view: forces FB's
    // IntersectionObserver to register that we've moved past the top
    // and need more posts loaded below.
    const stride = Math.max(window.innerHeight * 0.85, 600)
    userScroll(stride)
    if (elements.length > 0) {
      try { elements[elements.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' }) } catch {}
    }
    if (verbose) log(`  scrolled by ${stride.toFixed(0)}px (window.scrollY=${window.scrollY.toFixed(0)})`)
    await new Promise(r => setTimeout(r, jitter(scrollMin, scrollMax)))
  }
  try { window.__jcScrapeStatus = { ...window.__jcScrapeStatus, active: false } } catch {}
  log(`autoScroll DONE — captured=${captured.size} elapsed=${((Date.now() - start) / 1000).toFixed(1)}s stopReason=time`)
  if (verbose) {
    const snapshot = Array.from(captured.values()).map(p => ({
      postId: p.postId,
      bytes: p.html.length,
      snippet: extractSnippet(p).slice(0, 80),
    }))
    console.table(snapshot)
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
// Mobile FB renders inline comments as <article> too — even with the
// top-level filter, very short articles are usually fragment cards or
// "X liked Y's comment" notifications. Real job posts are at least a few
// sentences.
const MIN_POST_TEXT_CHARS = IS_MOBILE ? 80 : 30

/** Hiring-signal regex — ANY match keeps the post in. Built from the actual
 *  vocabulary of real FB job ads we've seen + canonical wage/contact patterns.
 *  Real ads ("Hiring – Front of House", "Position going in Loganholme",
 *  "Traffic controller needed $38/hr 0426...") all match at least one of
 *  these. Self-intros / questions / engagement comments don't. */
const HIRING_SIGNAL_RE = /\b(hiring|hire|looking\s+for|seeking|wanted|need(ed)?|position|positions|vacanc(y|ies)|opening|opportunity|opportunities|join\s+(our|the)\s+team|we'?re\s+(hiring|looking)|now\s+hiring|chasing|chef|cook|barista|waiter|bartender|labourer|picker|cleaner|driver|controller|crew|staff)\b|\$\s*\d|\b\d+\s*\/\s*hr\b|\b\d+\s*per\s+hour\b|\bp\/h\b|\b(award\s+wages?|hourly\s+rate|piece\s+rate)\b|\b(email|dm|pm|whatsapp|call|contact|resume|cv)\s/i

const PHONE_RE = /\b04\d{2}\s*\d{3}\s*\d{3}\b|\b\(\d{2}\)\s*\d{4}\s*\d{4}\b/   // AU mobile / landline
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/

/** Returns true if the visible text looks like community chatter rather than
 *  a job ad — short + no hiring signals + no contact info. We skip these
 *  client-side so they never reach the backend (no LLM call, no
 *  ExtensionCapture row, no overlay noise). Real job ads — even brief ones
 *  with just contact info — pass because they hit at least one signal. */
function looksLikeChatter(visibleText) {
  const t = (visibleText || '').trim()
  if (t.length === 0) return true
  // Anything with a clear hiring signal, phone number, or email gets in,
  // regardless of length — these are the strongest "this is an ad" markers.
  if (HIRING_SIGNAL_RE.test(t)) return false
  if (PHONE_RE.test(t)) return false
  if (EMAIL_RE.test(t)) return false
  // No signals at all — needs to be substantial enough that we trust it
  // might still be a job ad written in oblique prose. Anything under 200
  // chars without any of the above is almost always chatter.
  if (t.length < 200) return true
  return false
}

/** Extract one post into the wire format consumed by /api/extension/ingest-batch.
 *  Always tries to produce a post if there is *any* meaningful content.
 *  Falls back to synthetic IDs when FB doesn't expose a permalink. */
function extractPost(postEl) {
  const visibleText = (postEl.innerText || '').trim()
  if (visibleText.length < MIN_POST_TEXT_CHARS) return null
  // Skip community chatter — short posts with no hiring signals or contact
  // info. These are top-level posts in FB's structure (have aria-posinset)
  // but read like comments because they're members chatting / asking
  // questions / sharing self-intros. Pre-filtering here saves an LLM call
  // per chatter post and keeps the Recent Captures pane focused on real
  // job ads. See looksLikeChatter for the rules.
  if (looksLikeChatter(visibleText)) {
    if (window.__jcVerbose) console.log('[JC-DEBUG] skipping chatter (no hiring signal):', visibleText.slice(0, 80))
    return null
  }

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
          verbose: !!msg.verbose,
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
