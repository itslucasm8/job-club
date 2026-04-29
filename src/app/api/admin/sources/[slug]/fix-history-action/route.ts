import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Apply or dismiss an entry in JobSource.profile.fixHistory.
 *
 *  Body: { index: number, action: 'apply' | 'dismiss' }
 *
 *  apply:
 *    - if entry.proposedAction === 'update_config': merges proposedConfig into config
 *    - if entry.proposedAction === 'change_url': sets config.url = proposedUrl
 *    - if entry.proposedAction === 'disable': sets enabled = false
 *    - if entry.proposedAction === 'no_change': just marks status='applied' (no edit)
 *    Marks entry.status='applied' with reviewer + timestamp.
 *
 *  dismiss:
 *    Marks entry.status='dismissed'. No config change.
 */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { index, action } = body as { index?: number; action?: 'apply' | 'dismiss' }
  if (typeof index !== 'number' || (action !== 'apply' && action !== 'dismiss')) {
    return NextResponse.json({ error: 'index (number) et action (apply|dismiss) requis' }, { status: 400 })
  }

  const slug = params.slug
  const source = await prisma.jobSource.findUnique({
    where: { slug },
    select: { config: true, profile: true, enabled: true },
  })
  if (!source) return NextResponse.json({ error: 'Source introuvable' }, { status: 404 })

  const profile: any = (source.profile && typeof source.profile === 'object') ? source.profile : {}
  const history: any[] = Array.isArray(profile.fixHistory) ? [...profile.fixHistory] : []
  if (index < 0 || index >= history.length) {
    return NextResponse.json({ error: "Entrée d'historique introuvable" }, { status: 404 })
  }
  const entry = history[index]
  if (!entry) return NextResponse.json({ error: 'Entrée nulle' }, { status: 404 })
  if (entry.status && entry.status !== 'open') {
    return NextResponse.json({ error: `Entrée déjà ${entry.status}` }, { status: 409 })
  }

  const userEmail = (session.user as any)?.email || 'admin'
  const updates: any = {}

  if (action === 'apply' && entry.kind === 'ai_suggestion') {
    const currentConfig: any = (source.config && typeof source.config === 'object') ? source.config : {}
    if (entry.proposedAction === 'update_config' && entry.proposedConfig && typeof entry.proposedConfig === 'object') {
      updates.config = { ...currentConfig, ...entry.proposedConfig }
    } else if (entry.proposedAction === 'change_url' && entry.proposedUrl) {
      updates.config = { ...currentConfig, url: entry.proposedUrl }
    } else if (entry.proposedAction === 'disable') {
      updates.enabled = false
      updates.healthStatus = 'broken'
    }
    // 'no_change' → no updates
  }

  history[index] = {
    ...entry,
    status: action === 'apply' ? 'applied' : 'dismissed',
    reviewedBy: userEmail,
    reviewedAt: new Date().toISOString(),
  }

  await prisma.jobSource.update({
    where: { slug },
    data: { ...updates, profile: { ...profile, fixHistory: history } },
  })

  return NextResponse.json({ ok: true, entry: history[index], appliedUpdates: updates })
}
