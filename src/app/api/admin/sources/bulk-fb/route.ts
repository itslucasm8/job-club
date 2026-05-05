import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type LineResult =
  | { url: string; status: 'created'; slug: string }
  | { url: string; status: 'duplicate'; slug: string }
  | { url: string; status: 'invalid'; reason: string }
  | { url: string; status: 'error'; reason: string }

const FB_GROUP_RE = /facebook\.com\/groups\/([A-Za-z0-9._-]+)/i

const DEFAULT_CONFIG = {
  maxPostsPerRun: 100,
  maxScrollSeconds: 90,
}

/** POST /api/admin/sources/bulk-fb
 *  Body: { urls: string[], maxPostsPerRun?: number, maxScrollSeconds?: number }
 *  Creates a JobSource per FB group URL with siteSlug='facebook_groups',
 *  adapter='extension'. Skips duplicates by slug. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }

  const urlsRaw: unknown = body?.urls
  if (!Array.isArray(urlsRaw) || urlsRaw.length === 0) {
    return NextResponse.json({ error: 'urls (array) requis' }, { status: 400 })
  }
  if (urlsRaw.length > 100) {
    return NextResponse.json({ error: 'Max 100 URLs par batch' }, { status: 400 })
  }

  const maxPostsPerRun = Number.isFinite(Number(body?.maxPostsPerRun)) ? Math.max(10, Math.min(500, Number(body.maxPostsPerRun))) : DEFAULT_CONFIG.maxPostsPerRun
  const maxScrollSeconds = Number.isFinite(Number(body?.maxScrollSeconds)) ? Math.max(15, Math.min(300, Number(body.maxScrollSeconds))) : DEFAULT_CONFIG.maxScrollSeconds

  const results: LineResult[] = []
  const counts = { created: 0, duplicate: 0, invalid: 0, error: 0 }

  for (const raw of urlsRaw as unknown[]) {
    const original = String(raw || '').trim()
    if (!original) continue

    const m = FB_GROUP_RE.exec(original)
    if (!m) {
      results.push({ url: original, status: 'invalid', reason: 'URL ne contient pas /groups/X' })
      counts.invalid++
      continue
    }
    const groupId = m[1]
    const slug = `fb_group_${groupId.toLowerCase()}`
    // Always store the canonical www form in config — the extension rewrites
    // to mbasic at fetch time. www is the URL admins will recognize and click.
    const groupUrl = `https://www.facebook.com/groups/${groupId}`
    const groupName = `FB Group — ${groupId}`

    try {
      const existing = await prisma.jobSource.findUnique({ where: { slug }, select: { slug: true } })
      if (existing) {
        results.push({ url: original, status: 'duplicate', slug })
        counts.duplicate++
        continue
      }
      await prisma.jobSource.create({
        data: {
          slug,
          label: groupName,
          category: 'aggregator',
          adapter: 'extension',
          siteSlug: 'facebook_groups',
          ingestionStrategy: 'extension',
          enabled: true,
          config: {
            groupId,
            groupUrl,
            groupName,
            maxPostsPerRun,
            maxScrollSeconds,
          },
        },
      })
      results.push({ url: original, status: 'created', slug })
      counts.created++
    } catch (e: any) {
      Sentry.captureException(e, { tags: { route: 'admin-sources-bulk-fb', slug } })
      results.push({ url: original, status: 'error', reason: e?.message || String(e) })
      counts.error++
    }
  }

  return NextResponse.json({ ok: true, counts, results })
}
