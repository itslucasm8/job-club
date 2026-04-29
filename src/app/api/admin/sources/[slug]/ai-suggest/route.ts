import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { proxySuggestSourceFix, proxyFetchHtml, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

/** Tier 2 self-healing trigger. Reads the latest open `high_error_rate`
 *  fixHistory entry, fetches a sample of the configured page HTML, calls
 *  Claude via the proxy for a fix proposal, then appends the proposal as
 *  a new fixHistory entry of kind 'ai_suggestion' (status='open') so the
 *  admin can Apply or Dismiss it from the source detail page.
 */
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }
  if (!isProxyConfigured()) {
    return NextResponse.json({ error: 'Proxy Claude non configuré' }, { status: 500 })
  }

  const slug = params.slug
  const source = await prisma.jobSource.findUnique({
    where: { slug },
    select: { slug: true, label: true, config: true, profile: true },
  })
  if (!source) return NextResponse.json({ error: 'Source introuvable' }, { status: 404 })

  const profile: any = (source.profile && typeof source.profile === 'object') ? source.profile : {}
  const history: any[] = Array.isArray(profile.fixHistory) ? profile.fixHistory : []
  const latestDiagnostic = [...history].reverse().find(
    e => e?.kind === 'high_error_rate' && (e.status === 'open' || !e.status),
  )
  if (!latestDiagnostic) {
    return NextResponse.json({
      error: "Aucun diagnostic ouvert à analyser. La source n'a pas encore enregistré d'échec récent.",
    }, { status: 400 })
  }

  const config: any = (source.config && typeof source.config === 'object') ? source.config : {}
  const configUrl = config.url as string | undefined

  // Fetch a sample of the listings-page HTML so the LLM can see the link
  // structure and pattern shape directly. Best-effort: failures degrade to
  // "no html" — the suggester still has the failed URLs to reason from.
  let sampleHtml = ''
  if (configUrl) {
    try {
      const res = await proxyFetchHtml(configUrl, 30_000)
      if (res.ok && res.html) sampleHtml = res.html.slice(0, 12_000)
    } catch {/* swallow — degrade gracefully */}
  }

  const sampleFailedUrls: string[] = (latestDiagnostic.sampleFailures || [])
    .map((f: any) => f?.url).filter(Boolean).slice(0, 8)

  let suggestion
  try {
    suggestion = await proxySuggestSourceFix({
      sourceLabel: source.label,
      sourceSlug: source.slug,
      currentConfig: config,
      sampleFailedUrls,
      sampleHtml,
      errorRate: Number(latestDiagnostic.errorRate || 0),
    })
  } catch (e: any) {
    Sentry.captureException(e, { tags: { route: 'admin-sources-ai-suggest', slug } })
    return NextResponse.json({ error: e?.message || 'Erreur proxy Claude' }, { status: 502 })
  }

  // Append the suggestion to fixHistory and link it to the diagnostic that
  // triggered it. Cap at 20 entries to keep the JSON column bounded.
  const entry = {
    date: new Date().toISOString(),
    kind: 'ai_suggestion',
    status: 'open',
    triggeredBy: { kind: 'high_error_rate', date: latestDiagnostic.date },
    ...suggestion,
  }
  const next = [...history, entry]
  const trimmed = next.length > 20 ? next.slice(-20) : next
  await prisma.jobSource.update({
    where: { slug },
    data: { profile: { ...profile, fixHistory: trimmed } },
  })

  return NextResponse.json({ ok: true, suggestion: entry, index: trimmed.length - 1 })
}
