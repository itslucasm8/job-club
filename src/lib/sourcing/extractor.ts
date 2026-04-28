import { proxyExtractFromUrl, isProxyConfigured } from './claude-proxy'
import type { CandidateRaw } from './ingest'

export type ExtractionResult = {
  extraction_failed: boolean
  failure_reason: string
  raw: CandidateRaw
}

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
type ValidState = typeof VALID_STATES[number]

function asValidState(value: unknown): ValidState | undefined {
  return typeof value === 'string' && (VALID_STATES as readonly string[]).includes(value)
    ? value as ValidState
    : undefined
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
      raw: {
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
      },
    }
  } catch (e: any) {
    return {
      extraction_failed: true,
      failure_reason: `Proxy error: ${e?.message || String(e)}`,
      raw: { title: '', company: '', description: '' },
    }
  }
}
