import { getAnthropic, CLASSIFIER_MODEL } from './anthropic'
import { prisma } from '@/lib/prisma'
import type { CandidateRaw } from './ingest'

const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const
const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const

export type ClassifierScore = {
  is_backpacker_suitable: boolean
  has_88_day_signal: boolean
  has_locals_only_red_flag: boolean
  has_clear_pay: boolean
  has_scam_red_flags: boolean
  scam_reasons: string[]
  suggested_category: typeof VALID_CATEGORIES[number] | null
  suggested_state: typeof VALID_STATES[number] | null
  confidence: number
  reasoning: string
}

const SYSTEM_PROMPT = `You are the curation gatekeeper for Job Club, a paid job board for French backpackers on Working Holiday Visas (WHV) in Australia.

Your job: classify a scraped/extracted job listing across multiple signals so the admin team can review only high-quality candidates.

## Audience
- French (and other) backpackers on 417 / 462 WHV in Australia, ages 18-35
- Looking for casual / seasonal work, often farm/88-day eligible
- Mobile-first, alert-driven, expecting contact info inline in the description

## Categories (must use one of these slugs)
- farm: agriculture, picking, packing, harvest, dairy, cattle station, livestock, vineyard, orchard
- hospitality: bar, restaurant, cafe, hotel, hostel, kitchen, waiter, barista, housekeeping for accommodation
- construction: building sites, labourer (construction context), trades, carpenter, plumber, electrician, scaffold
- retail: shop, store, sales floor, cashier, customer service in retail
- cleaning: domestic cleaning, commercial cleaning, laundry (non-hospitality), janitorial
- events: festivals, event staff, function, conference, weddings, concerts
- animals: stable hand, groom, pet care, dog walker, vet assistant, kennels
- transport: driver (where licence allows), removalist, courier, warehouse drivers
- other: anything that doesn't fit (use sparingly)

## Australian states (must use one of these codes)
QLD, NSW, VIC, SA, WA, TAS, NT, ACT

## 88-day signals (set has_88_day_signal=true if ANY of these are present)
- Mentions "88 days", "88 jours", "specified work", "regional work"
- Mentions "second year visa", "2nd year visa", "visa extension", "subclass 417"
- Job is in eligible postcodes / regional Australia + agriculture/farm/fishing/forestry/mining/construction
- "WHV friendly", "backpackers welcome", "visa eligible"

## Locals-only red flags (set has_locals_only_red_flag=true if any apply)
- "Locals only", "Australian residents only", "permanent residents only"
- "Must have own car / current state licence" (auto-disqualifies most travellers)
- "Long-term commitment required", "min 12 months", "permanent role only"
- "Police check required" (often signals a non-backpacker role)
- Salary structures clearly aimed at career professionals

## Scam red flags (set has_scam_red_flags=true with reasons)
- Asks for payment, fee, deposit, "training cost", "uniform deposit"
- Promises "guaranteed income" or unrealistic earnings
- Requires a passport/visa scan upfront, before interview
- No company name, only a phone number / email
- Vague description, "call for details" only
- Generic "free accommodation" with no employer detail (often human trafficking risk)

## Backpacker-suitability (is_backpacker_suitable)
true if:
- Casual or short-term role
- WHV/visa-eligible (no Australian residency requirement)
- Real employer, real location, identifiable contact path
- Pay is at or above legal minimum (or unstated but plausibly legal)
- Category fits one of the 9 above

false if:
- Locals-only red flag present
- Scam red flags
- Career professional role (e.g. accountant, software engineer, registered nurse, qualified electrician requiring AU licence)
- Long-term contract / permanent only
- Requires AU citizenship/residency

## Output
Return JSON matching the schema exactly. Be terse in reasoning (1-2 sentences). When unclear, lean conservative on is_backpacker_suitable=false.`

const SCHEMA = {
  type: 'object',
  properties: {
    is_backpacker_suitable: { type: 'boolean' },
    has_88_day_signal: { type: 'boolean' },
    has_locals_only_red_flag: { type: 'boolean' },
    has_clear_pay: { type: 'boolean' },
    has_scam_red_flags: { type: 'boolean' },
    scam_reasons: { type: 'array', items: { type: 'string' } },
    suggested_category: { type: ['string', 'null'], enum: [...VALID_CATEGORIES, null] },
    suggested_state: { type: ['string', 'null'], enum: [...VALID_STATES, null] },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: [
    'is_backpacker_suitable', 'has_88_day_signal', 'has_locals_only_red_flag',
    'has_clear_pay', 'has_scam_red_flags', 'scam_reasons',
    'suggested_category', 'suggested_state', 'confidence', 'reasoning',
  ],
  additionalProperties: false,
} as const

export async function classifyCandidate(raw: CandidateRaw): Promise<ClassifierScore | null> {
  const client = getAnthropic()
  if (!client) return null

  const userText = [
    `Title: ${raw.title}`,
    `Company: ${raw.company}`,
    raw.location ? `Location: ${raw.location}` : null,
    raw.state ? `State: ${raw.state}` : null,
    raw.category ? `Category (extracted): ${raw.category}` : null,
    raw.type ? `Type: ${raw.type}` : null,
    raw.pay ? `Pay: ${raw.pay}` : null,
    raw.applyUrl ? `Apply URL: ${raw.applyUrl}` : null,
    '',
    'Description:',
    (raw.description || '').slice(0, 6000),
  ].filter(Boolean).join('\n')

  try {
    const response = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA as any },
      } as any,
    } as any)

    for (const block of response.content) {
      if ((block as any).type === 'text') {
        try {
          return JSON.parse((block as any).text) as ClassifierScore
        } catch {
          // Fall through
        }
      }
    }
    return null
  } catch (e) {
    console.error('[classifier] error', e)
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
