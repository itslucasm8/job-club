import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeExtensionRequest } from '@/lib/extension-auth'

/** GET /api/extension/groups
 *  Returns the list of FB-group sources the extension should scrape this run.
 *  Filtered to enabled rows with adapter='extension' and siteSlug='facebook_groups'.
 *  The extension uses this to know which group URLs to visit.
 */
export async function GET(req: Request) {
  const auth = await authorizeExtensionRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const sources = await prisma.jobSource.findMany({
    where: {
      enabled: true,
      adapter: 'extension',
      siteSlug: 'facebook_groups',
    },
    select: {
      slug: true,
      label: true,
      config: true,
      lastRunAt: true,
      profile: true,
    },
    orderBy: { slug: 'asc' },
  })

  const groups = sources.map(s => {
    const config: any = (s.config && typeof s.config === 'object') ? s.config : {}
    const profile: any = (s.profile && typeof s.profile === 'object') ? s.profile : {}
    return {
      slug: s.slug,
      groupName: config.groupName || s.label,
      groupUrl: config.groupUrl || null,
      groupId: config.groupId || null,
      maxPostsPerRun: profile.maxPostsPerRun ?? 100,
      maxScrollSeconds: profile.maxScrollSeconds ?? 60,
      lastRunAt: s.lastRunAt,
    }
  }).filter(g => !!g.groupUrl)

  return NextResponse.json({ groups })
}
