import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const VALID_CATEGORIES = ['government', 'aggregator', 'ats_rss', 'competitor', 'manual', 'direct'] as const
const VALID_ADAPTERS = ['workforce_australia', 'harvest_trail', 'generic_career_page', 'manual', 'extension'] as const
const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const VALID_JOB_CATS = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const
const VALID_SHEET_TABS = ['seek', 'gumtree', 'facebook', 'packhouse', 'station', 'website', 'mine_agency', 'job_agency', 'government', 'manual'] as const
const VALID_INGESTION_STRATEGIES = [
  'structured_api', 'structured_html', 'rss_feed', 'sitemap_xml',
  'generic_web', 'extension', 'keyword_search',
  'email_inbound', 'api_partner', 'manual',
] as const

export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
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

  const data: Record<string, any> = {}

  if ('label' in body) {
    if (typeof body.label !== 'string' || !body.label.trim()) {
      return NextResponse.json({ error: 'Label invalide' }, { status: 400 })
    }
    data.label = body.label.trim()
  }
  if ('category' in body) {
    if (!VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: `Catégorie invalide` }, { status: 400 })
    }
    data.category = body.category
  }
  if ('sheetTab' in body) {
    if (body.sheetTab != null && !VALID_SHEET_TABS.includes(body.sheetTab)) {
      return NextResponse.json({ error: `Onglet invalide` }, { status: 400 })
    }
    data.sheetTab = body.sheetTab ?? null
  }
  if ('ingestionStrategy' in body) {
    if (body.ingestionStrategy != null && !VALID_INGESTION_STRATEGIES.includes(body.ingestionStrategy)) {
      return NextResponse.json({ error: `Stratégie invalide` }, { status: 400 })
    }
    data.ingestionStrategy = body.ingestionStrategy ?? null
  }
  if ('adapter' in body) {
    if (body.adapter != null && !VALID_ADAPTERS.includes(body.adapter)) {
      return NextResponse.json({ error: `Adapter invalide` }, { status: 400 })
    }
    data.adapter = body.adapter ?? null
  }
  if ('enabled' in body) {
    data.enabled = !!body.enabled
  }
  if ('config' in body) {
    const cfg = body.config
    // Validate generic adapter config if either the new adapter or the existing one is generic.
    const targetAdapter = 'adapter' in body ? body.adapter : (await prisma.jobSource.findUnique({ where: { slug: params.slug }, select: { adapter: true } }))?.adapter
    if (targetAdapter === 'generic_career_page') {
      if (!cfg || typeof cfg.url !== 'string' || !cfg.url.trim()) {
        return NextResponse.json({ error: 'generic_career_page nécessite config.url' }, { status: 400 })
      }
      if (cfg.defaultState && !VALID_STATES.includes(cfg.defaultState)) {
        return NextResponse.json({ error: 'config.defaultState invalide' }, { status: 400 })
      }
      if (cfg.defaultCategory && !VALID_JOB_CATS.includes(cfg.defaultCategory)) {
        return NextResponse.json({ error: 'config.defaultCategory invalide' }, { status: 400 })
      }
    }
    data.config = cfg ?? null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
  }

  try {
    const updated = await prisma.jobSource.update({
      where: { slug: params.slug },
      data,
    })
    return NextResponse.json(updated)
  } catch (e: any) {
    if (e?.code === 'P2025') {
      return NextResponse.json({ error: `Source "${params.slug}" introuvable` }, { status: 404 })
    }
    Sentry.captureException(e, { tags: { route: 'admin-sources-update' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  // JobCandidate.source is a plain string (not FK) so deletion doesn't cascade.
  // Historical candidates retain their source slug — they just won't resolve to
  // an adapter on future runs (which is fine; runner skips unknown).
  try {
    await prisma.jobSource.delete({ where: { slug: params.slug } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e?.code === 'P2025') {
      return NextResponse.json({ error: `Source "${params.slug}" introuvable` }, { status: 404 })
    }
    Sentry.captureException(e, { tags: { route: 'admin-sources-delete' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
