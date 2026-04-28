import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export type CandidateRaw = {
  title: string
  company: string
  state?: string
  location?: string
  category?: string
  type?: string
  pay?: string
  description: string
  applyUrl?: string
  postedAt?: string
  eligible88Days?: boolean
}

export type IngestInput = {
  source: string
  sourceUrl: string
  sourceJobId?: string
  raw: CandidateRaw
}

export type IngestResult =
  | { status: 'inserted'; id: string }
  | { status: 'duplicate'; reason: 'source_id' | 'dedupe_hash' }
  | { status: 'error'; error: string }

const DEDUPE_WINDOW_DAYS = 30

export function computeDedupeHash(raw: CandidateRaw): string {
  const company = (raw.company || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const location = (raw.location || raw.state || '').trim().toLowerCase()
  const descSlice = (raw.description || '').slice(0, 200).trim().toLowerCase().replace(/\s+/g, ' ')
  return createHash('sha256').update(`${company}|${location}|${descSlice}`).digest('hex')
}

export async function ingestCandidate(input: IngestInput): Promise<IngestResult> {
  const { source, sourceUrl, sourceJobId, raw } = input

  if (!raw.title || !raw.company || !raw.description) {
    return { status: 'error', error: 'missing required fields (title/company/description)' }
  }

  const dedupeHash = computeDedupeHash(raw)

  try {
    if (sourceJobId) {
      const existing = await prisma.jobCandidate.findUnique({
        where: { source_sourceJobId: { source, sourceJobId } },
        select: { id: true },
      })
      if (existing) return { status: 'duplicate', reason: 'source_id' }
    }

    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const sameContent = await prisma.jobCandidate.findFirst({
      where: { dedupeHash, createdAt: { gt: cutoff } },
      select: { id: true },
    })
    if (sameContent) return { status: 'duplicate', reason: 'dedupe_hash' }

    const created = await prisma.jobCandidate.create({
      data: {
        source,
        sourceUrl,
        sourceJobId: sourceJobId ?? null,
        rawData: raw as any,
        dedupeHash,
        status: 'pending',
      },
      select: { id: true },
    })

    await prisma.jobSource.update({
      where: { slug: source },
      data: { totalSeen: { increment: 1 } },
    }).catch(() => {})

    if (process.env.CLAUDE_PROXY_SECRET) {
      import('./classifier').then(m => m.classifyAndPersist(created.id)).catch(() => {})
    }

    return { status: 'inserted', id: created.id }
  } catch (e: any) {
    return { status: 'error', error: e?.message ?? String(e) }
  }
}

export async function markSourceRun(slug: string, status: 'ok' | 'error' | 'skipped', error?: string) {
  await prisma.jobSource.update({
    where: { slug },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: status,
      lastRunError: error ?? null,
    },
  }).catch(() => {})
}
