import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const state = searchParams.get('state')
    const category = searchParams.get('category')
    const q = searchParams.get('q')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = 20

    const where: any = { active: true }
    if (state && state !== 'all') where.state = state
    if (category && category !== 'all') where.category = category
    if (q && q.length <= 200) {
      where.OR = [
        { title: { contains: q } },
        { company: { contains: q } },
        { description: { contains: q } },
        { location: { contains: q } },
      ]
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.job.count({ where }),
    ])

    return NextResponse.json({ jobs, total, page, pages: Math.ceil(total / limit) })
  } catch (e) {
    console.error('GET /api/jobs error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }
    const data = await req.json()

    // Validate required fields
    if (!data.title || !data.company || !data.state || !data.category || !data.description) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
    }

    const job = await prisma.job.create({
      data: {
        title: data.title,
        company: data.company,
        state: data.state,
        location: data.location || '',
        category: data.category,
        type: data.type || 'casual',
        pay: data.pay || null,
        description: data.description,
        applyUrl: data.applyUrl || null,
        sourceUrl: data.sourceUrl || null,
      },
    })
    return NextResponse.json(job, { status: 201 })
  } catch (e) {
    console.error('POST /api/jobs error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
