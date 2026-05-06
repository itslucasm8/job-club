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

// ─── Timestamp hover (forces FB to materialize permalink + absolute date) ─
// Why this matters: in modern FB Comet, post-timestamp anchors initially
// render with href="#" and no absolute-date metadata. The /posts/<id>
// permalink AND the title="Wednesday, May 6, 2026 at 2:30 PM" tooltip date
// only get populated AFTER the user's mouse hovers the timestamp — that
// hover triggers a prefetch which mutates the DOM. Without this step ~70%
// of captures lose both pieces of metadata, so "Source ↗" links go to the
// group homepage instead of the actual post, and we never know how old a
// post is. Synthetic pointer events are enough to fire FB's listeners; we
// don't need a real cursor.

const MONTHS_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|janv|févr|avr|juil|sept|déc)\b/i

/** Heuristic: does this anchor's text look like a post-timestamp string?
 *  Recognized formats (English + French):
 *    "5h", "2 h", "3d", "1w", "12s"
 *    "5 hrs", "2 days ago", "1 minute ago"
 *    "Just now", "Yesterday", "Today"
 *    "À l'instant", "Hier", "Aujourd'hui", "Il y a 3 h"
 *    "May 4", "May 4 at 2:30 PM", "4 May", "4 mai" */
function isLikelyTimestampAnchor(a) {
  const text = (a.textContent || '').trim()
  if (!text || text.length > 40) return false
  return /^\d+\s*[smhdwy]$/i.test(text)
      || /^\d+\s*(sec|min|h(?:r|our)?|d(?:ay)?|w(?:k|eek)?|mo(?:nth)?|y(?:r|ear)?)s?(\s*ago)?$/i.test(text)
      || /^(Just\s*now|Yesterday|Today)\b/i.test(text)
      || /^(À\s*l'instant|Hier|Aujourd'hui|Il\s+y\s+a)/i.test(text)
      || /^[A-Za-zÀ-ÿ]{3,9}\s+\d{1,2}/.test(text)         // "May 4" / "mai 4"
      || /^\d{1,2}\s+[A-Za-zÀ-ÿ]{3,9}/.test(text)         // "4 May" / "4 mai"
}

/** Find the timestamp anchor inside a post. Prefer the meta region (where
 *  FB normally puts it) but fall back to scanning all link-role anchors. */
function findTimestampAnchor(postEl) {
  const meta = postEl.querySelector(MARKER_META)
  if (meta) {
    for (const a of meta.querySelectorAll('a[role="link"], a[href]')) {
      if (isLikelyTimestampAnchor(a)) return a
    }
  }
  for (const a of postEl.querySelectorAll('a[role="link"], a[href]')) {
    if (isLikelyTimestampAnchor(a)) return a
  }
  return null
}

function dispatchPointerSequence(el, types) {
  const rect = el.getBoundingClientRect()
  const cx = rect.x + Math.max(rect.width / 2, 1)
  const cy = rect.y + Math.max(rect.height / 2, 1)
  const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }
  for (const type of types) {
    try {
      // Most React libraries listen on the Mouse* class; some FB internals
      // bind to Pointer*. Fire both for max compatibility.
      if (type.startsWith('pointer')) el.dispatchEvent(new PointerEvent(type, opts))
      else el.dispatchEvent(new MouseEvent(type, opts))
    } catch {/* swallow — element may have been removed mid-iteration */}
  }
}

function hoverElement(el) {
  dispatchPointerSequence(el, ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'mousemove'])
}

function unhoverElement(el) {
  dispatchPointerSequence(el, ['pointerout', 'mouseout', 'pointerleave', 'mouseleave'])
}

/** Hover every visible post's timestamp anchor to force FB to materialize
 *  the canonical permalink + absolute-date title. Skips posts that already
 *  expose a /posts/ link, so the cost is paid once per post (not per
 *  scroll iteration). Returns the count of posts we actually hovered. */
async function hoverTimestamps(postElements, settleMs = 500) {
  const hovered = []
  for (const post of postElements) {
    if (post.querySelector('a[href*="/posts/"], a[href*="/permalink/"]')) continue
    const anchor = findTimestampAnchor(post)
    if (anchor) {
      hoverElement(anchor)
      hovered.push(anchor)
    }
  }
  if (hovered.length === 0) return 0
  await new Promise(r => setTimeout(r, settleMs))
  // Move the synthetic pointer away so FB doesn't keep tooltips open over
  // posts we're about to extract or click See-more on.
  for (const a of hovered) unhoverElement(a)
  return hovered.length
}

/** Extract the post's absolute date from the title="..." attribute that FB
 *  populates after a hover. Returns the raw FB-formatted string (e.g.
 *  "Wednesday, May 6, 2026 at 2:30 PM") — backend handles parsing. */
function extractPostedAt(postEl) {
  for (const el of postEl.querySelectorAll('[title]')) {
    const v = (el.getAttribute('title') || '').trim()
    if (!v || v.length > 80) continue
    // Date-like signal: must contain a 4-digit year AND a month name.
    if (/\b(19|20)\d{2}\b/.test(v) && MONTHS_RE.test(v)) return v
  }
  return null
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

// ─── Login / CAPTCHA wall detection ───────────────────────────────────────
// FB occasionally challenges accounts with a login wall, a "Confirm it's
// you" checkpoint, or a CAPTCHA. Without an explicit detection step the
// scrape just returns 0 posts and the team thinks the group is empty —
// the worst kind of silent failure. Detect common signals up front and
// surface a clear stopReason so the overlay can prompt re-login.

const LOGIN_WALL_SELECTORS = [
  'form[action*="/login/"]',
  'input[name="email"][type="text"]',
  'input[name="pass"]',
  '#login_form',
  '#loginbutton',
  'div[data-testid="royal_login_form"]',
]

const CHECKPOINT_PATH_RE = /\/(login|checkpoint|recover|two_step_verification|security)\b/i

function detectLoginWall() {
  // URL-based: any redirect off the group page is a fast signal.
  if (CHECKPOINT_PATH_RE.test(location.pathname)) {
    return { blocked: true, reason: `Redirected to ${location.pathname} — FB account needs re-login or security check` }
  }
  // DOM-based: login form rendered inline (happens when session expires while
  // the tab is open and FB swaps the body for a login prompt).
  for (const sel of LOGIN_WALL_SELECTORS) {
    if (document.querySelector(sel)) {
      return { blocked: true, reason: `Login wall detected (${sel}) — FB account session expired` }
    }
  }
  // Body-text heuristic: catch checkpoint pages without our specific selectors.
  const bodyText = (document.body?.innerText || '').slice(0, 800)
  if (/please log in|connectez-vous|verify (your|it's) you|confirm your identity|security check/i.test(bodyText)
      && !document.querySelector('[role="feed"]')) {
    return { blocked: true, reason: 'Body text indicates FB security challenge and no feed is present' }
  }
  return { blocked: false }
}

// ─── Field extraction (per spec Section 5) ───────────────────────────────

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

/** HTML-escape user-supplied text for safe insertion into our synthesized payload. */
function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

/** Build a minimal, signal-dense HTML payload from extracted markers.
 *  Replaces FB's bloated outerHTML — see anti-scrape note in extractPost. */
function buildCleanHtml({ author, body, titleText, descText, hasPhoto, photoAlts, permalink }) {
  const parts = ['<article>']
  parts.push(`<h2 class="author">${htmlEscape(author)}</h2>`)
  if (body) {
    const bodyEsc = htmlEscape(body).replace(/\n/g, '<br>')
    parts.push(`<div class="body">${bodyEsc}</div>`)
  }
  if (titleText) parts.push(`<h3 class="card-title">${htmlEscape(titleText)}</h3>`)
  if (descText) parts.push(`<p class="card-desc">${htmlEscape(descText)}</p>`)
  if (hasPhoto) parts.push('<meta name="has-photo" content="true">')
  // Image alt-text — many farm-job posts put the contact phone/email in the
  // image, captured here as a figcaption so the LLM can read it as text. We
  // skip alts that match the FB anti-scrape obfuscation pattern, and cap at
  // 2 unique non-empty alts to stay under the signal-density budget.
  if (Array.isArray(photoAlts)) {
    for (const alt of photoAlts) {
      parts.push(`<figcaption>${htmlEscape(alt)}</figcaption>`)
    }
  }
  if (permalink) parts.push(`<link rel="canonical" href="${htmlEscape(permalink)}">`)
  parts.push('</article>')
  return parts.join('\n')
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
  // Collect up to 2 unique, non-obfuscated alt texts. FB's accessibility
  // alt-text often contains "May be an image of text that says: [post text]"
  // — that's exactly the OCR-style content we want for image-only job posts.
  const photoAlts = []
  const seenAlts = new Set()
  for (const img of contentImgs) {
    const alt = (img.getAttribute('alt') || '').trim()
    if (!alt || alt.length < 8 || alt.length > 500) continue
    if (isObfuscation(alt)) continue
    if (seenAlts.has(alt)) continue
    seenAlts.add(alt)
    photoAlts.push(alt)
    if (photoAlts.length >= 2) break
  }

  // PHOTO CAPTION MERGE — when FB splits long captions across story_message
  // (truncated) and description (rest), prefer the description.
  if (hasPhoto && body.length < 30 && descText && !isObfuscation(descText)) {
    body = descText
  }
  if (isObfuscation(descText)) descText = ''

  // PERMALINK — only sometimes present (FB lazy-loads on hover). Look for
  // /posts/ or /permalink/ in group context only — FB also has /photo links
  // inside posts which we explicitly DON'T want as the source URL.
  let permalink = null
  for (const a of postEl.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || ''
    if (/\/groups\/[\w.-]+\/(posts|permalink)\//.test(href)) {
      permalink = absoluteHref(href.split('?')[0])
      break
    }
  }

  // DEDUPE KEY — no stable post ID exists in DOM. author + body[:200] hash
  // is stable across reruns of the same content.
  const dedupeSource = `${author}::${body.slice(0, 200)}`
  const dedupeHash = hashString(dedupeSource)
  const postId = permalink ? `pl-${hashString(permalink)}` : `dk-${dedupeHash}`
  const groupPathBase = `https://www.facebook.com${location.pathname.replace(/\/+$/, '')}`
  const postUrl = permalink || `${groupPathBase}#${postId}`

  // SYNTHESIZED HTML — do NOT send FB's outerHTML. FB injects anti-scrape
  // obfuscation: <blockquote class="html-blockquote"><span>Facebook</span>
  // </blockquote> repeated dozens of times per photo carousel, plus data-0
  // through data-19 attributes, plus image alt-text repetition. The cleaned
  // text gets dominated by "Facebook Facebook Facebook..." and the LLM can't
  // find the actual job ad. Build a minimal clean payload from the markers
  // we already extracted. The backend's text-extraction sees only the real
  // content. ~10x size reduction; ~100x signal density.
  const html = buildCleanHtml({ author, body, titleText, descText, hasPhoto, photoAlts, permalink })
  if (html.length < 100) return null

  return {
    postId,
    postUrl,
    // Populated when the timestamp was successfully hovered earlier this
    // iteration; null if FB hadn't materialized it yet (older posts, or
    // first-iteration posts that scrolled out before hover-settle).
    postedAt: extractPostedAt(postEl),
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

    // Step 1 — hover timestamps on any post that doesn't yet expose a
    // /posts/ permalink in its DOM. Forces FB to materialize the canonical
    // permalink href + the absolute-date title attribute. No-op if every
    // visible post is already permalinked.
    const hoveredCount = await hoverTimestamps(elements, 500)
    if (verbose) log(`  hovered ${hoveredCount} timestamps to materialize permalinks`)

    // Step 2 — expand See-more on every visible post (spec Section 7,
    // strategy 1: expand before snapshotting). Cheap if no See-more present.
    let didExpand = false
    for (const el of elements) {
      if (expandSeeMore(el)) didExpand = true
    }
    if (didExpand) await new Promise(r => setTimeout(r, 500))

    // Step 3 — extract every visible post. The Map keys by postId so re-
    // captures of the same post (across scroll iterations) overwrite — a
    // post captured pre-expansion gets upgraded to its expanded form on a
    // later iteration if it stayed in viewport. We also upgrade when a
    // later capture has metadata the first one missed (permalink, postedAt)
    // — useful when the first hover landed too late to materialize either.
    let added = 0
    for (const el of elements) {
      const post = extractPost(el)
      if (!post) continue
      const existing = captured.get(post.postId)
      const grew = existing && (post.html?.length || 0) > (existing.html?.length || 0)
      const gainedPostedAt = existing && !existing.postedAt && post.postedAt
      const gainedPermalink = existing
        && !/\/posts\/|\/permalink\//.test(existing.postUrl || '')
        && /\/posts\/|\/permalink\//.test(post.postUrl || '')
      if (!existing || grew || gainedPostedAt || gainedPermalink) {
        // Merge — never lose metadata we already had if the new capture
        // happened to drop it (e.g. FB rotated the DOM mid-scrape).
        const merged = existing
          ? {
              ...post,
              postUrl: gainedPermalink ? post.postUrl : (existing.postUrl || post.postUrl),
              postedAt: post.postedAt || existing.postedAt,
              html: (post.html?.length || 0) >= (existing.html?.length || 0) ? post.html : existing.html,
            }
          : post
        captured.set(post.postId, merged)
        if (!existing) added += 1
        if (verbose) {
          const reason = !existing ? 'NEW' : grew ? 'GROW' : gainedPermalink ? 'PERMALINK' : 'POSTEDAT'
          log(`  ${reason} ${post.postId} bytes=${merged.html.length} url=${merged.postUrl} postedAt=${merged.postedAt || '—'} text="${extractSnippet(merged)}"`)
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
        // Bail fast if FB is showing a login wall or security check. Without
        // this we'd return 0 posts and the team would assume the group is
        // empty rather than realizing the FB account needs re-login.
        const wall = detectLoginWall()
        if (wall.blocked) {
          sendResponse({
            ok: true,
            posts: [],
            stopReason: 'login_required',
            error: wall.reason,
            scrollSeconds: 0,
          })
          return
        }
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
