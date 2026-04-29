import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const VALID_CATEGORIES = ['government', 'aggregator', 'ats_rss', 'competitor', 'manual', 'direct'] as const
const VALID_ADAPTERS = [
  'workforce_australia', 'harvest_trail',
  'generic_career_page',
  'greenhouse_api', 'workable_api', 'lever_api',
  'manual', 'extension',
] as const
const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const VALID_JOB_CATS = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const
const VALID_SHEET_TABS = ['seek', 'gumtree', 'facebook', 'packhouse', 'station', 'website', 'mine_agency', 'job_agency', 'government', 'manual'] as const
// Extensible by design — add new strategies as new ingestion methods are
// uncovered (rss_feed, sitemap_xml, email_inbound, api_partner, etc.).
// Each new value just needs its own adapter implementation; no schema migration.
const VALID_INGESTION_STRATEGIES = [
  'structured_api',   // ATS APIs (Greenhouse, Workable, Workday) — Flow A
  'structured_html',  // custom-selector scrapers — Flow A
  'rss_feed',         // RSS/Atom feeds — Flow A (future)
  'sitemap_xml',      // sitemap.xml crawling — Flow A (future)
  'generic_web',      // Playwright + Claude — Flow B
  'extension',        // browser extension — Flow C
  'keyword_search',   // search-keyword inventory — Flow C
  'email_inbound',    // employer-emailed listings — future
  'api_partner',      // formal partnership feed — future
  'manual',
] as const

const SLUG_RE = /^[a-z0-9_-]+$/

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const sources = await prisma.jobSource.findMany({
      orderBy: [{ enabled: 'desc' }, { totalApproved: 'desc' }, { slug: 'asc' }],
    })
    return NextResponse.json(sources)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-sources' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

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

  const { slug, label, category, sheetTab, ingestionStrategy, adapter, enabled, config, profile } = body || {}

  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'Slug requis (a-z, 0-9, _, -)' }, { status: 400 })
  }
  if (typeof label !== 'string' || !label.trim()) {
    return NextResponse.json({ error: 'Label requis' }, { status: 400 })
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Catégorie invalide. Valeurs: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  if (adapter != null && !VALID_ADAPTERS.includes(adapter)) {
    return NextResponse.json({ error: `Adapter invalide. Valeurs: ${VALID_ADAPTERS.join(', ')}` }, { status: 400 })
  }
  if (sheetTab != null && !VALID_SHEET_TABS.includes(sheetTab)) {
    return NextResponse.json({ error: `Onglet invalide. Valeurs: ${VALID_SHEET_TABS.join(', ')}` }, { status: 400 })
  }
  if (ingestionStrategy != null && !VALID_INGESTION_STRATEGIES.includes(ingestionStrategy)) {
    return NextResponse.json({ error: `Stratégie invalide. Valeurs: ${VALID_INGESTION_STRATEGIES.join(', ')}` }, { status: 400 })
  }

  // Generic adapter requires a URL in config — otherwise the runner can't discover anything.
  if (adapter === 'generic_career_page') {
    if (!config || typeof config.url !== 'string' || !config.url.trim()) {
      return NextResponse.json({ error: 'generic_career_page nécessite config.url' }, { status: 400 })
    }
    if (config.defaultState && !VALID_STATES.includes(config.defaultState)) {
      return NextResponse.json({ error: 'config.defaultState invalide' }, { status: 400 })
    }
    if (config.defaultCategory && !VALID_JOB_CATS.includes(config.defaultCategory)) {
      return NextResponse.json({ error: 'config.defaultCategory invalide' }, { status: 400 })
    }
  }
  // ATS API adapters require a board slug.
  if (adapter === 'greenhouse_api' || adapter === 'workable_api' || adapter === 'lever_api') {
    if (!config || typeof config.boardSlug !== 'string' || !config.boardSlug.trim()) {
      return NextResponse.json({ error: `${adapter} nécessite config.boardSlug` }, { status: 400 })
    }
  }

  try {
    const created = await prisma.jobSource.create({
      data: {
        slug,
        label: label.trim(),
        category,
        sheetTab: sheetTab ?? null,
        ingestionStrategy: ingestionStrategy ?? null,
        adapter: adapter ?? null,
        enabled: enabled !== false,
        config: config ?? null,
        profile: profile ?? null,
      },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: `Slug "${slug}" existe déjà` }, { status: 409 })
    }
    Sentry.captureException(e, { tags: { route: 'admin-sources-create' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
