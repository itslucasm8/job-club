import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { proxyFetchHtml } from '@/lib/sourcing/claude-proxy'

/** Sniffs a careers-page URL for embedded ATS markers and proposes the
 *  matching Flow A adapter + boardSlug. Used by the "Détecter ATS" button on
 *  the source edit form so admin can convert a generic_career_page row into a
 *  free-and-fast structured_api row in one click.
 *
 *  Returns one of:
 *    { adapter: "greenhouse_api"|"workable_api"|"lever_api", boardSlug, evidence }
 *    { adapter: null, reason: "no ATS markers found", checked: [...] }
 */

type DetectMatch = {
  adapter: 'greenhouse_api' | 'workable_api' | 'lever_api'
  boardSlug: string
  evidence: string
}

// Patterns that capture the board slug from common ATS embed strings. Order
// within each adapter family: most specific first so iframe-srcs win over
// vague links.
const PATTERNS: Array<{ adapter: DetectMatch['adapter'], re: RegExp, label: string }> = [
  // Greenhouse
  { adapter: 'greenhouse_api', re: /boards\.greenhouse\.io\/embed\/jobs\?for=([a-z0-9_-]+)/i, label: 'Greenhouse iframe embed' },
  { adapter: 'greenhouse_api', re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)\//i, label: 'Greenhouse API URL' },
  { adapter: 'greenhouse_api', re: /boards\.greenhouse\.io\/([a-z0-9_-]+)(?:\/|"|')/i, label: 'Greenhouse public board link' },
  // Workable
  { adapter: 'workable_api',   re: /apply\.workable\.com\/api\/v3\/accounts\/([a-z0-9_-]+)\//i, label: 'Workable API URL' },
  { adapter: 'workable_api',   re: /apply\.workable\.com\/([a-z0-9_-]+)(?:\/|"|')/i, label: 'Workable public board link' },
  { adapter: 'workable_api',   re: /whr-embed[^"']*\/([a-z0-9_-]+)/i, label: 'Workable WHR embed' },
  // Lever
  { adapter: 'lever_api',      re: /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/i, label: 'Lever API URL' },
  { adapter: 'lever_api',      re: /jobs\.lever\.co\/([a-z0-9_-]+)(?:\/|"|')/i, label: 'Lever public board link' },
]

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 })
  }
  const url = String(body?.url || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'url requis (http/https)' }, { status: 400 })
  }

  try {
    const fetched = await proxyFetchHtml(url, 30_000)
    if (!fetched.ok || !fetched.html) {
      return NextResponse.json({
        adapter: null,
        reason: `Page non récupérée (HTTP ${fetched.status})`,
        url,
      })
    }
    const html = fetched.html

    // Try patterns in order; return first match. We dedupe captured slugs to
    // avoid surfacing fragments like "embed" matched as a slug.
    for (const { adapter, re, label } of PATTERNS) {
      const m = re.exec(html)
      if (!m) continue
      const slug = m[1]
      if (!slug || slug === 'embed' || slug === 'jobs' || slug === 'careers') continue
      return NextResponse.json({
        adapter,
        boardSlug: slug,
        evidence: label,
        url,
      } satisfies DetectMatch & { url: string })
    }

    return NextResponse.json({
      adapter: null,
      reason: 'Aucun ATS connu détecté (Greenhouse / Workable / Lever)',
      hint: 'Cette source utilise probablement un système custom — garder generic_career_page.',
      url,
    })
  } catch (e: any) {
    Sentry.captureException(e, { tags: { route: 'admin-sources-detect-ats' } })
    return NextResponse.json({
      error: e?.message || 'Erreur fetch',
    }, { status: 500 })
  }
}
