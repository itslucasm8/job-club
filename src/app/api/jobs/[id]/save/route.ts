import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    const userId = (session.user as any).id

    const existing = await prisma.savedJob.findUnique({
      where: { userId_jobId: { userId, jobId: params.id } },
    })

    if (existing) {
      await prisma.savedJob.delete({ where: { id: existing.id } })
      return NextResponse.json({ saved: false })
    } else {
      await prisma.savedJob.create({ data: { userId, jobId: params.id } })
      return NextResponse.json({ saved: true })
    }
  } catch (e) {
    console.error('POST /api/jobs/[id]/save error:', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
