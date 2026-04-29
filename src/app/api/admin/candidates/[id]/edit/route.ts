import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { proxyReassessEligibility, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

const EDITABLE_KEYS = [
  'title',
  'company',
  'state',
  'location',
  'category',
  'type',
  'pay',
  'description',
  'applyUrl',
  'eligible88Days',
] as const

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other']
const VALID_TYPES = ['casual', 'full_time', 'part_time', 'contract']

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const candidate = await prisma.jobCandidate.findUnique({ where: { id: params.id } })
    if (!candidate) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const raw = (candidate.rawData as Record<string, unknown>) || {}
    const merged: Record<string, unknown> = { ...raw }

    for (const k of EDITABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        merged[k] = body[k]
      }
    }

    if (merged.state && !VALID_STATES.includes(merged.state as string)) {
      return NextResponse.json({ error: `state invalide (doit être l'un de ${VALID_STATES.join(', ')})` }, { status: 400 })
    }
    if (merged.category && !VALID_CATEGORIES.includes(merged.category as string)) {
      return NextResponse.json({ error: `catégorie invalide` }, { status: 400 })
    }
    if (merged.type && !VALID_TYPES.includes(merged.type as string)) {
      return NextResponse.json({ error: `type invalide` }, { status: 400 })
    }

    let final = merged
    if (isProxyConfigured()) {
      try {
        final = await proxyReassessEligibility(merged)
      } catch (e) {
        Sentry.captureException(e, { tags: { route: 'admin-candidates-edit', step: 'reassess' } })
        // Fall through with the un-reassessed merge so the edit still saves —
        // admin can re-trigger reassess explicitly if needed.
      }
    }

    const updated = await prisma.jobCandidate.update({
      where: { id: candidate.id },
      data: { rawData: final as object },
    })

    return NextResponse.json({ candidate: updated })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-edit' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
