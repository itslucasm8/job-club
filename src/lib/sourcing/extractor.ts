import { proxyExtract, isProxyConfigured } from './claude-proxy'
import type { CandidateRaw } from './ingest'

export type ExtractionResult = {
  extraction_failed: boolean
  failure_reason: string
  raw: CandidateRaw
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

  let html: string
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JobClubBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      return {
        extraction_failed: true,
        failure_reason: `HTTP ${res.status} fetching URL`,
        raw: { title: '', company: '', description: '' },
      }
    }
    html = await res.text()
  } catch (e: any) {
    return {
      extraction_failed: true,
      failure_reason: `Fetch error: ${e?.message || String(e)}`,
      raw: { title: '', company: '', description: '' },
    }
  }

  const text = htmlToText(html).slice(0, 25000)

  try {
    const data = await proxyExtract(url, text)
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
