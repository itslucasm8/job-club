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
  // Deterministic eligibility verdict fields (populated by the proxy's
  // eligibility.py module). Optional — older candidates lack them.
  eligible88Days_llm?: boolean
  eligibility_reason?: string
  eligibility_confidence?: 'high' | 'medium' | 'low'
  postcode?: number | null
  industry?: string | null
  award_id?: string | null
  award_name?: string | null
  award_min_hourly?: number | null
  award_min_casual_hourly?: number | null
  award_effective_from?: string | null
  pay_parsed_hourly?: number | null
  pay_kind?: string
  pay_status?: 'above' | 'at' | 'below' | 'piece_rate' | 'unknown'
  pay_gap?: number | null
  pay_gap_pct?: number | null
  extraction_notes?: string[]
}

export type IngestInput = {
  source: string
  sourceUrl: string
  sourceJobId?: string
  raw: CandidateRaw
  /** Original page text the extractor saw. Stored as `_source_text` on rawData
   *  (truncated to 8000 chars) so admin can audit what Claude dropped or kept. */
  sourceText?: string
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
  const { source, sourceUrl, sourceJobId, raw, sourceText } = input
  const rawWithSource: CandidateRaw & { _source_text?: string } = sourceText
    ? { ...raw, _source_text: sourceText.slice(0, 8000) }
    : raw

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
        rawData: rawWithSource as any,
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
