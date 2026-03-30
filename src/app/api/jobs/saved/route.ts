import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const savedJobs = await prisma.savedJob.findMany({
    where: { userId: (session.user as any).id },
    include: { job: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(savedJobs.map(s => s.job))
}
