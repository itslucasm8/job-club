import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const url = new URL(req.url)
  const source = url.searchParams.get('source') || undefined
  const status = url.searchParams.get('status') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200)

  const captures = await prisma.extensionCapture.findMany({
    where: {
      ...(source ? { source } : {}),
      ...(status ? { ingestStatus: status } : {}),
    },
    orderBy: { scrapedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      source: true,
      sourceJobId: true,
      sourceUrl: true,
      html: true,
      postedAt: true,
      authorName: true,
      scrapedAt: true,
      ingestStatus: true,
      failureReason: true,
      extractionMode: true,
      extractionResult: true,
    },
  })

  return NextResponse.json({ captures })
}
