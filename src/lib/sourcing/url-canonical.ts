// Canonicalize listing URLs so dedupe sees the same URL across runs even
// when the source decorates the link with tracking params or fragments.
//
// Motivation: Seek's search results inject ?origin=, ?ref=, &type=, #sol=...
// onto otherwise-identical /job/<id> URLs. Without canonicalization, the
// same job appears as 2-4 candidate rows per run (observed live on
// 2026-04-30 for /job/91588026 and /job/91741939).

const TRACKING_PARAMS_GENERIC = new Set<string>([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'mc_eid', 'mc_cid', 'msclkid', 'twclid',
  '_hsenc', '_hsmi', 'igshid',
])

type SiteProfile = {
  stripParams: string[]
  stripFragment: boolean
}

// Per-site overrides. Anything not listed here gets the generic tracking-param
// strip only. Add a profile when a site is found leaking dupes via querystrings.
const SITE_PROFILES: Record<string, SiteProfile> = {
  seek_au: {
    stripParams: ['type', 'ref', 'origin', 'sol', 'savedjob', 'searchrequesttoken'],
    stripFragment: true,
  },
  // FB injects __cft__ / __tn__ / fbclid into post permalinks for tracking;
  // strip so the same /groups/<gid>/posts/<pid> URL doesn't dedupe-leak.
  facebook_groups: {
    stripParams: ['fbclid', '__cft__', '__tn__', 'comment_id', 'reply_comment_id', 'notif_id', 'notif_t'],
    stripFragment: true,
  },
}

export function canonicalizeUrl(rawUrl: string, siteSlug?: string | null): string {
  try {
    const u = new URL(rawUrl)
    const profile = siteSlug ? SITE_PROFILES[siteSlug] : undefined
    const paramsToStrip = new Set<string>(TRACKING_PARAMS_GENERIC)
    if (profile) {
      for (const p of profile.stripParams) paramsToStrip.add(p)
    }
    const kept: [string, string][] = []
    for (const [k, v] of u.searchParams.entries()) {
      if (!paramsToStrip.has(k)) kept.push([k, v])
    }
    u.search = ''
    for (const [k, v] of kept) u.searchParams.append(k, v)
    if (profile?.stripFragment) u.hash = ''
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.toString()
  } catch {
    return rawUrl
  }
}
