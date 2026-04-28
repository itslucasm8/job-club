import { getAnthropic, EXTRACTOR_MODEL } from './anthropic'
import type { CandidateRaw } from './ingest'

const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const
const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const

const SYSTEM_PROMPT = `You extract structured job listing fields from raw HTML / text scraped from a careers page or classified ad.

Target audience: WHV backpackers in Australia. Job Club's existing schema:
- 9 categories: farm, hospitality, construction, retail, cleaning, events, animals, transport, other
- 8 states: QLD, NSW, VIC, SA, WA, TAS, NT, ACT
- type: casual | full_time | part_time | contract

Rules:
- Preserve the original wording of the description, but strip nav menus, footer boilerplate, cookie banners, "apply now" buttons
- Keep contact info (email, phone, application instructions) in the description verbatim — backpackers reach out directly
- If multiple jobs are on the page, return the FIRST clearly-defined job
- If you cannot find a clear job listing, set extraction_failed=true and explain in failure_reason
- For state, infer from location/postcode if not explicit
- For category, pick the closest fit; "other" only as last resort
- For type, default to "casual" if unclear
- pay: capture amount + period if shown ("$28/hr", "piece rate", "$25-30/hr"); empty string if not stated
- applyUrl: direct apply link if present, else empty string

Output JSON matching the schema exactly.`

const SCHEMA = {
  type: 'object',
  properties: {
    extraction_failed: { type: 'boolean' },
    failure_reason: { type: 'string' },
    title: { type: 'string' },
    company: { type: 'string' },
    state: { type: ['string', 'null'], enum: [...VALID_STATES, null] },
    location: { type: 'string' },
    category: { type: ['string', 'null'], enum: [...VALID_CATEGORIES, null] },
    type: { type: 'string', enum: ['casual', 'full_time', 'part_time', 'contract'] },
    pay: { type: 'string' },
    description: { type: 'string' },
    applyUrl: { type: 'string' },
    eligible88Days: { type: 'boolean' },
  },
  required: [
    'extraction_failed', 'failure_reason', 'title', 'company',
    'state', 'location', 'category', 'type', 'pay', 'description', 'applyUrl', 'eligible88Days',
  ],
  additionalProperties: false,
} as const

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

export async function extractFromUrl(url: string): Promise<ExtractionResult> {
  const client = getAnthropic()
  if (!client) {
    return {
      extraction_failed: true,
      failure_reason: 'ANTHROPIC_API_KEY not configured',
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
    const response = await client.messages.create({
      model: EXTRACTOR_MODEL,
      max_tokens: 4096,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{
        role: 'user',
        content: `URL: ${url}\n\nPage content (cleaned):\n${text}`,
      }],
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA as any },
      } as any,
    } as any)

    for (const block of response.content) {
      if ((block as any).type === 'text') {
        try {
          const parsed = JSON.parse((block as any).text)
          if (parsed.extraction_failed) {
            return {
              extraction_failed: true,
              failure_reason: parsed.failure_reason || 'unspecified',
              raw: { title: '', company: '', description: '' },
            }
          }
          return {
            extraction_failed: false,
            failure_reason: '',
            raw: {
              title: parsed.title || '',
              company: parsed.company || '',
              state: parsed.state || undefined,
              location: parsed.location || '',
              category: parsed.category || undefined,
              type: parsed.type || 'casual',
              pay: parsed.pay || undefined,
              description: parsed.description || '',
              applyUrl: parsed.applyUrl || undefined,
              eligible88Days: !!parsed.eligible88Days,
            },
          }
        } catch (e) {
          // Try next block
        }
      }
    }
    return {
      extraction_failed: true,
      failure_reason: 'LLM returned no parseable JSON',
      raw: { title: '', company: '', description: '' },
    }
  } catch (e: any) {
    return {
      extraction_failed: true,
      failure_reason: `LLM error: ${e?.message || String(e)}`,
      raw: { title: '', company: '', description: '' },
    }
  }
}
