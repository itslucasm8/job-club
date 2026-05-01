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

  // Raw SQL — production Prisma client doesn't include the ExtensionCapture
  // model (see ingest-batch route comment).
  const captures = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, source, "sourceJobId", "sourceUrl", html, "postedAt",
            "authorName", "scrapedAt", "ingestStatus", "failureReason",
            "extractionMode", "extractionResult"
     FROM "ExtensionCapture"
     WHERE 1=1
       ${source ? 'AND source = $1' : ''}
       ${source && status ? 'AND "ingestStatus" = $2' : status ? 'AND "ingestStatus" = $1' : ''}
     ORDER BY "scrapedAt" DESC
     LIMIT ${limit}`,
    ...[source, status].filter((x): x is string => !!x)
  )

  return NextResponse.json({ captures })
}
