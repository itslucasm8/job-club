import { proxyExtractFromUrl, isProxyConfigured, type ProxyExtractResult } from './claude-proxy'
import type { CandidateRaw } from './ingest'

export type ExtractionResult = {
  extraction_failed: boolean
  failure_reason: string
  raw: CandidateRaw
  /** Original page text the extractor saw (when the proxy returns it). */
  sourceText?: string
}

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
type ValidState = typeof VALID_STATES[number]

function asValidState(value: unknown): ValidState | undefined {
  return typeof value === 'string' && (VALID_STATES as readonly string[]).includes(value)
    ? value as ValidState
    : undefined
}

/** Convert a proxy /extract or /extract-from-url response into a CandidateRaw.
 *  Centralised so the URL-fetch path, paste-text path, and extension path
 *  all carry the same set of fields (esp. the deterministic eligibility
 *  verdict added by eligibility.py). */
export function proxyResultToRaw(data: ProxyExtractResult): CandidateRaw {
  return {
    title: data.title || '',
    company: data.company || '',
    state: asValidState(data.state),
    location: data.location || '',
    category: data.category || undefined,
    type: data.type || 'casual',
    pay: data.pay || undefined,
    description: data.description || '',
    applyUrl: data.applyUrl || undefined,
    eligible88Days: !!data.eligible88Days,
    eligible88Days_llm: data.eligible88Days_llm,
    eligibility_reason: data.eligibility_reason,
    eligibility_confidence: data.eligibility_confidence,
    postcode: data.postcode ?? null,
    industry: data.industry ?? null,
    award_id: data.award_id ?? null,
    award_name: data.award_name ?? null,
    award_min_hourly: data.award_min_hourly ?? null,
    award_min_casual_hourly: data.award_min_casual_hourly ?? null,
    award_effective_from: data.award_effective_from ?? null,
    pay_parsed_hourly: data.pay_parsed_hourly ?? null,
    pay_kind: data.pay_kind,
    pay_status: data.pay_status,
    pay_gap: data.pay_gap ?? null,
    pay_gap_pct: data.pay_gap_pct ?? null,
    extraction_notes: data.extraction_notes,
  }
}

export async function extractFromUrl(url: string): Promise<ExtractionResult> {
  if (!isProxyConfigured()) {
    return {
      extraction_failed: true,
      failure_reason: 'CLAUDE_PROXY_SECRET not configured',
      raw: { title: '', company: '', description: '' },
    }
  }

  try {
    const data = await proxyExtractFromUrl(url)
    if (data.extraction_failed) {
      return {
        extraction_failed: true,
        failure_reason: data.failure_reason || 'unspecified',
        raw: { title: '', company: '', description: '' },
      }
    }
    return {
      extraction_failed: false,
      failure_reason: '',
      raw: proxyResultToRaw(data),
      sourceText: (data as any).page_text,
    }
  } catch (e: any) {
    return {
      extraction_failed: true,
      failure_reason: `Proxy error: ${e?.message || String(e)}`,
      raw: { title: '', company: '', description: '' },
    }
  }
}
