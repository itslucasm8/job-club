import { prisma } from '@/lib/prisma'
import { proxyClassify, isProxyConfigured } from './claude-proxy'
import type { CandidateRaw } from './ingest'

export type ClassifierScore = {
  is_backpacker_suitable: boolean
  has_88_day_signal: boolean
  has_locals_only_red_flag: boolean
  has_clear_pay: boolean
  has_scam_red_flags: boolean
  scam_reasons: string[]
  suggested_category: string | null
  suggested_state: string | null
  confidence: number
  reasoning: string
}

export async function classifyCandidate(raw: CandidateRaw): Promise<ClassifierScore | null> {
  if (!isProxyConfigured()) return null
  try {
    const result = await proxyClassify(raw as any)
    return result
  } catch (e) {
    console.error('[classifier] proxy error', e)
    return null
  }
}

export async function classifyAndPersist(candidateId: string): Promise<ClassifierScore | null> {
  const candidate = await prisma.jobCandidate.findUnique({ where: { id: candidateId } })
  if (!candidate) return null

  const score = await classifyCandidate(candidate.rawData as any)
  if (!score) return null

  const autoReject = score.is_backpacker_suitable === false || score.has_scam_red_flags === true
  await prisma.jobCandidate.update({
    where: { id: candidate.id },
    data: {
      classifierScore: score as any,
      ...(autoReject && candidate.status === 'pending' ? {
        status: 'auto_rejected',
        rejectReason: score.has_scam_red_flags
          ? `Auto: scam (${score.scam_reasons.slice(0, 2).join(', ')})`
          : `Auto: ${score.reasoning.slice(0, 120)}`,
      } : {}),
    },
  })

  return score
}
