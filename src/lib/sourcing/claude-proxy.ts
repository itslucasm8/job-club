// HTTP client for the Job Club Claude proxy (services/claude-proxy/).
// The proxy shells out to the `claude` CLI on the VPS host, which is
// OAuth-authenticated against Lucas's Claude Max subscription.

const PROXY_URL = process.env.CLAUDE_PROXY_URL || 'http://host.docker.internal:8090'
const PROXY_SECRET = process.env.CLAUDE_PROXY_SECRET || ''
const REQUEST_TIMEOUT_MS = 120_000

export function isProxyConfigured(): boolean {
  return !!PROXY_SECRET
}

async function fetchProxy<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  if (!PROXY_SECRET) {
    throw new Error('CLAUDE_PROXY_SECRET not configured')
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PROXY_SECRET}`,
      },
      signal: controller.signal,
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    const res = await fetch(`${PROXY_URL}${path}`, init)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Claude proxy ${path} -> HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timeoutId)
  }
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  return fetchProxy<T>('POST', path, body)
}

export type ProxyExtractResult = {
  extraction_failed: boolean
  failure_reason: string
  title: string
  company: string
  state: string | null
  location: string
  category: string | null
  type: string
  pay: string
  description: string
  applyUrl: string
  eligible88Days: boolean
  // Deterministic verdict fields (added by eligibility.py post-pass — optional
  // because old proxies may not return them yet).
  eligible88Days_llm?: boolean
  eligibility_88_days?: boolean | null
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

export type ProxyClassifyResult = {
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

export async function proxyExtract(url: string, pageText: string): Promise<ProxyExtractResult> {
  return postJSON<ProxyExtractResult>('/extract', { url, page_text: pageText })
}

export async function proxyExtractFromUrl(url: string): Promise<ProxyExtractResult & { fetch_status?: number }> {
  return postJSON<ProxyExtractResult & { fetch_status?: number }>('/extract-from-url', { url })
}

export async function proxyClassify(raw: Record<string, unknown>): Promise<ProxyClassifyResult> {
  return postJSON<ProxyClassifyResult>('/classify', { raw })
}

export async function proxyReassessEligibility(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  return postJSON<Record<string, unknown>>('/reassess-eligibility', { raw })
}

export type ProxyFetchHtmlResult = {
  ok: boolean
  status: number
  html: string
  text: string
  error?: string
}

export async function proxyFetchHtml(url: string, timeoutMs = 60_000): Promise<ProxyFetchHtmlResult> {
  return fetchProxy<ProxyFetchHtmlResult>('POST', '/fetch-html', { url }, timeoutMs)
}

// Reference-data endpoints (one-off seeding from pasted regulator pages).

export type ProxyParseReferenceResult = {
  parse_failed: boolean
  failure_reason?: string
  // remaining fields depend on `kind` — caller validates shape
  [k: string]: unknown
}

export async function proxyParseReference(
  kind: 'postcodes' | 'award',
  pageText: string,
  industry?: string,
): Promise<ProxyParseReferenceResult> {
  // Sonnet on 80K of text can take 90+ s — give it more headroom than the default.
  return fetchProxy<ProxyParseReferenceResult>('POST', '/parse-reference', { kind, page_text: pageText, industry }, 180_000)
}

export async function proxySaveReferenceData(args: {
  filename: string
  mode: 'replace' | 'upsert'
  data: unknown
  key?: string
}): Promise<{ ok: boolean; filename: string; mode: string; bytes: number }> {
  return postJSON('/save-reference-data', args)
}

export async function proxyListReferenceData(): Promise<Record<string, { exists: boolean; bytes?: number; mtime?: number; data?: unknown; error?: string }>> {
  return fetchProxy('GET', '/list-reference-data')
}

export type ProxyAllPostcodesResult = {
  agriculture: any
  construction: any
  tourism: any
}

export async function proxyParseAllPostcodes(pageText: string): Promise<ProxyAllPostcodesResult> {
  // Same long-timeout headroom as single-section parsing.
  return fetchProxy<ProxyAllPostcodesResult>('POST', '/parse-all-postcodes', { page_text: pageText }, 240_000)
}

export async function proxySaveAllPostcodes(payload: Partial<ProxyAllPostcodesResult>): Promise<{
  any_written: boolean
  results: Record<string, { ok?: boolean; bytes?: number; error?: string; skipped?: boolean; reason?: string }>
}> {
  return postJSON('/save-all-postcodes', payload)
}
