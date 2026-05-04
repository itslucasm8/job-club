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
// badges.
const NOT_SUITABLE_AUTOREJECT_CONFIDENCE = 0.8

// WHV casual labour pay tops out around $35-40/hr (~$70k/yr if FT). Annual
// salaries at or above this threshold are a structural disqualifier — these
// are professional/skilled-trade career roles, not WHV work. Independent of
// LLM reasoning.
const ANNUAL_SALARY_FLOOR = 50000

// Soft-loophole keywords. Originally added to spare borderline farm/hospo
// roles where "experience preferred" was the only LLM concern (Costa farm-
// hands case). But the loophole only applies when reasoning is ONLY about
// experience — if reasoning ALSO cites annual salary or other structural
// red flags, those override.
const EXPERIENCE_KEYWORD_RE = /\bexperience\b|\byears?[ -]of\b|\bprior[ -]experience\b|\bqualifi/i

// Annual-salary signals in the reasoning text. If any of these appear, the
// experience-loophole does NOT apply — the role is structurally a career
// position regardless of whether experience is also mentioned.
const ANNUAL_SALARY_REASON_RE = /annual\s+salary|per\s+annum|\bp\.?a\.?\b|\$5\d[,k]|\$[6-9]\d[,k]|\$\d{3}[,k]|salary\s+package/i

/** Parse `raw.pay` and return true if it contains an annual figure at or
 *  above ANNUAL_SALARY_FLOOR. Handles "$80,000", "$80k", "$70-85k", "$76,515",
 *  with optional "per annum"/"p.a." suffix. Hourly figures (e.g. "$28/hr")
 *  return false because the $ matches don't reach the band. */
export function payHasAnnualSalaryAtOrAboveFloor(raw: any): boolean {
  const pay = String(raw?.pay || '')
  if (!pay) return false
  // Capture either "$NN,NNN" / "$NNN,NNN" or "$NNk".
  const re = /\$\s*(\d{2,3})(?:,(\d{3})|\.(\d{3}))?\s*([kK])?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pay)) !== null) {
    const lead = parseInt(m[1], 10)
    const trail = m[2] ?? m[3]
    const isK = !!m[4]
    let value: number
    if (isK) {
      value = lead * 1000
    } else if (trail) {
      value = lead * 1000 + parseInt(trail, 10)
    } else {
      // Bare $NN with no thousands → probably hourly, skip.
      continue
    }
    if (Number.isFinite(value) && value >= ANNUAL_SALARY_FLOOR) return true
  }
  return false
}

/** Pure decision function for whether to auto-reject. Exported so the
 *  bulk-reclassify script can apply the same rules to historical candidates
 *  without re-calling Claude. */
export function decideAutoReject(
  score: ClassifierScore,
  raw: any
): { reject: boolean; reason?: string } {
  // Always kill clear scam signals.
  if (score.has_scam_red_flags === true) {
    return {
      reject: true,
      reason: `Auto: scam (${(score.scam_reasons || []).slice(0, 2).join(', ')})`,
    }
  }
  // Structural override: a full-time role with an annual salary at or above
  // the WHV band is not WHV-suitable, regardless of how the LLM hedged.
  if (raw?.type === 'full_time' && payHasAnnualSalaryAtOrAboveFloor(raw)) {
    return {
      reject: true,
      reason: `Auto: full-time annual salary above WHV band (>=$${ANNUAL_SALARY_FLOOR / 1000}k/yr)`,
    }
  }
  // LLM said not suitable, with high confidence.
  if (
    score.is_backpacker_suitable === false &&
    typeof score.confidence === 'number' &&
    score.confidence >= NOT_SUITABLE_AUTOREJECT_CONFIDENCE
  ) {
    const reasoning = score.reasoning || ''
    const mentionsAnnualSalary =
      ANNUAL_SALARY_REASON_RE.test(reasoning) || payHasAnnualSalaryAtOrAboveFloor(raw)
    const isExperienceOnly =
      EXPERIENCE_KEYWORD_RE.test(reasoning) && !mentionsAnnualSalary
    if (!isExperienceOnly) {
      return { reject: true, reason: `Auto: ${reasoning.slice(0, 120)}` }
    }
  }
  return { reject: false }
}

export async function classifyAndPersist(candidateId: string): Promise<ClassifierScore | null> {
  const candidate = await prisma.jobCandidate.findUnique({ where: { id: candidateId } })
  if (!candidate) return null

  const score = await classifyCandidate(candidate.rawData as any)
  if (!score) return null

  const decision = decideAutoReject(score, candidate.rawData)

  await prisma.jobCandidate.update({
    where: { id: candidate.id },
    data: {
      classifierScore: score as any,
      ...(decision.reject && candidate.status === 'pending'
        ? { status: 'auto_rejected', rejectReason: decision.reason! }
        : {}),
    },
  })

  return score
}
