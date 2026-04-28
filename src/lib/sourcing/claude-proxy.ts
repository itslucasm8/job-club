// HTTP client for the Job Club Claude proxy (services/claude-proxy/).
// The proxy shells out to the `claude` CLI on the VPS host, which is
// OAuth-authenticated against Lucas's Claude Max subscription.

const PROXY_URL = process.env.CLAUDE_PROXY_URL || 'http://host.docker.internal:8090'
const PROXY_SECRET = process.env.CLAUDE_PROXY_SECRET || ''
const REQUEST_TIMEOUT_MS = 120_000

export function isProxyConfigured(): boolean {
  return !!PROXY_SECRET
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  if (!PROXY_SECRET) {
    throw new Error('CLAUDE_PROXY_SECRET not configured')
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${PROXY_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PROXY_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Claude proxy ${path} -> HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timeoutId)
  }
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

export async function proxyClassify(raw: Record<string, unknown>): Promise<ProxyClassifyResult> {
  return postJSON<ProxyClassifyResult>('/classify', { raw })
}
