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

// Confidence floor for the "not WHV-suitable" auto-reject. Below this,
// candidates fall back to pending-review with the red flags surfaced as
// badges. Set 0.8 because QA (2026-05-04) caught the classifier wrongly
// killing Costa farm-hands and a uni kitchen-hand role — both flagged
// "not suitable" but with low confidence. Scam flags still auto-reject
// regardless of confidence — those are unambiguous garbage signals.
const NOT_SUITABLE_AUTOREJECT_CONFIDENCE = 0.8

// Reject reasons that hint at "experience required" — a known-weak signal.
// QA showed the LLM weights this too heavily; backpackers do get hired into
// roles that say "experience preferred". Don't auto-reject for these even
// with high confidence — keep them pending for human judgement.
const EXPERIENCE_KEYWORD_RE = /\bexperience\b|\byears?[ -]of\b|\bprior[ -]experience\b|\bqualifi/i

export async function classifyAndPersist(candidateId: string): Promise<ClassifierScore | null> {
  const candidate = await prisma.jobCandidate.findUnique({ where: { id: candidateId } })
  if (!candidate) return null

  const score = await classifyCandidate(candidate.rawData as any)
  if (!score) return null

  const reasoning = score.reasoning || ''
  const isExperienceCall = EXPERIENCE_KEYWORD_RE.test(reasoning)
  const isHighConfidence = typeof score.confidence === 'number' && score.confidence >= NOT_SUITABLE_AUTOREJECT_CONFIDENCE
  const suitabilityAutoReject =
    score.is_backpacker_suitable === false &&
    isHighConfidence &&
    !isExperienceCall
  const autoReject = score.has_scam_red_flags === true || suitabilityAutoReject

  await prisma.jobCandidate.update({
    where: { id: candidate.id },
    data: {
      classifierScore: score as any,
      ...(autoReject && candidate.status === 'pending' ? {
        status: 'auto_rejected',
        rejectReason: score.has_scam_red_flags
          ? `Auto: scam (${score.scam_reasons.slice(0, 2).join(', ')})`
          : `Auto: ${reasoning.slice(0, 120)}`,
      } : {}),
    },
  })

  return score
}
