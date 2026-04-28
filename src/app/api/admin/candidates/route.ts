import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'
    const source = searchParams.get('source')
    const q = searchParams.get('q')?.trim()
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = 50

    const where: any = { status }
    if (source) where.source = source

    const [candidates, total, counts] = await Promise.all([
      prisma.jobCandidate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.jobCandidate.count({ where }),
      prisma.jobCandidate.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ])

    let filtered = candidates
    if (q) {
      const lower = q.toLowerCase()
      filtered = candidates.filter(c => {
        const raw = (c.rawData as any) || {}
        return (
          (raw.title || '').toLowerCase().includes(lower) ||
          (raw.company || '').toLowerCase().includes(lower) ||
          (raw.location || '').toLowerCase().includes(lower)
        )
      })
    }

    const statusCounts = Object.fromEntries(counts.map(c => [c.status, c._count._all]))

    return NextResponse.json({
      candidates: filtered,
      total,
      page,
      pages: Math.ceil(total / limit),
      statusCounts,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
