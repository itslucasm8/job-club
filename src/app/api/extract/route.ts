import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { extractSchema, getFirstValidationError } from '@/lib/validation'
import { extractLimiter, getClientIP } from '@/lib/rate-limit'

// Australian states mapping
const AU_STATES: Record<string, string> = {
  'queensland': 'QLD',
  'qld': 'QLD',
  'new south wales': 'NSW',
  'nsw': 'NSW',
  'victoria': 'VIC',
  'vic': 'VIC',
  'south australia': 'SA',
  'sa': 'SA',
  'western australia': 'WA',
  'wa': 'WA',
  'tasmania': 'TAS',
  'tas': 'TAS',
  'northern territory': 'NT',
  'nt': 'NT',
  'australian capital territory': 'ACT',
  'act': 'ACT',
}

// Category keywords
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  farm: ['farm', 'farmer', 'agriculture', 'crop', 'harvest', 'orchard', 'vineyard', 'picker', 'packer', 'fruit'],
  hospitality: ['restaurant', 'cafe', 'bar', 'hotel', 'waiter', 'barista', 'chef', 'cook', 'hospitality', 'kitchen', 'server'],
  construction: ['construction', 'builder', 'carpenter', 'plumber', 'electrician', 'concrete', 'site', 'apprentice', 'labourer'],
  trade: ['trade', 'apprentice', 'mechanic', 'hvac', 'welding', 'electrical', 'plumbing', 'carpentry'],
  retail: ['retail', 'shop', 'store', 'sales', 'cashier', 'customer service', 'checkout', 'boutique'],
  cleaning: ['cleaning', 'cleaner', 'housekeeping', 'janitorial', 'maid', 'laundry', 'sanitation'],
}

function detectState(text: string): string {
  const lowerText = text.toLowerCase()
  for (const [key, code] of Object.entries(AU_STATES)) {
    if (lowerText.includes(key)) return code
  }
  return ''
}

function detectCategory(text: string): string {
  const lowerText = text.toLowerCase()
  let maxMatches = 0
  let bestCategory = ''

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matches = keywords.filter(kw => lowerText.includes(kw)).length
    if (matches > maxMatches) {
      maxMatches = matches
      bestCategory = category
    }
  }

  return bestCategory || ''
}

function extractCompany(html: string): string {
  // Try organization schema
  const schemaMatch = html.match(/"name":\s*"([^"]+)"|<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i)
  if (schemaMatch) return schemaMatch[1] || schemaMatch[2] || ''

  // Try common company patterns
  const companyPatterns = [
    /posted\s+by:\s*([^<\n]+)/i,
    /company:\s*([^<\n]+)/i,
    /employer:\s*([^<\n]+)/i,
  ]

  for (const pattern of companyPatterns) {
    const match = html.match(pattern)
    if (match) return match[1].trim()
  }

  return ''
}

function extractLocation(text: string): string {
  // Look for city, state patterns
  const statePattern = Object.keys(AU_STATES).join('|')
  const locationMatch = text.match(new RegExp(`([A-Z][a-z]+),?\\s+(${statePattern})`, 'i'))
  if (locationMatch) return locationMatch[1].trim()

  // Try to extract first significant location-like phrase
  const locationWords = text.match(/(?:based in|located in|at|in)\s+([A-Z][a-zA-Z\s]+?)(?:[,;.]|$)/i)
  if (locationWords) return locationWords[1].trim()

  return ''
}

function extractPay(text: string): string {
  // Match various salary patterns
  const payPatterns = [
    /\$?\d+(?:\.\d{2})?(?:\s*-\s*\$?\d+(?:\.\d{2})?)?(?:\s*\/\s*(?:hour|hr|h|per hour))?/i,
    /\$?\d+(?:\.\d{2})?\s*(?:per hour|\/hr|\/h)/i,
    /\$?\d+(?:\.\d{2})?\s*(?:p\.?w\.?|per week)/i,
    /\$?\d+(?:\.\d{2})?\s*(?:p\.?a\.?|per annum)/i,
    /piece\s*rate/i,
  ]

  for (const pattern of payPatterns) {
    const match = text.match(pattern)
    if (match) return match[0].trim()
  }

  return ''
}

function extractDescription(html: string, bodyText: string): string {
  // Try to find description in article, main, or job-description tags
  const articleMatch = html.match(/<(?:article|main|div[^>]*class="[^"]*(?:description|job-description|content)[^"]*")[^>]*>[\s\S]*?<\/(?:article|main|div)>/i)
  if (articleMatch) {
    const cleaned = articleMatch[0]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned.length > 100) return cleaned.substring(0, 1500)
  }

  // Fallback to body text (already cleaned)
  return bodyText.substring(0, 1500)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const ip = getClientIP(req)
  if (!extractLimiter.check(ip)) {
    return NextResponse.json({ error: 'Trop de requêtes, réessayez plus tard' }, { status: 429 })
  }

  const body = await req.json()

  // Validate with Zod
  const result = extractSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: getFirstValidationError(result.error) }, { status: 400 })
  }

  const { url } = result.data

  try {
    // Create AbortController for 10-second timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const html = await res.text()

    // Extract title
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = h1Match?.[1]?.trim() || ogTitleMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || ''

    // Clean HTML for text analysis
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Extract structured data
    const company = extractCompany(html)
    const location = extractLocation(bodyText)
    const state = detectState(bodyText)
    const category = detectCategory(bodyText)
    const pay = extractPay(bodyText)
    const description = extractDescription(html, bodyText)

    return NextResponse.json({
      title: title || '',
      company: company || '',
      state: state || '',
      location: location || '',
      category: category || '',
      type: 'casual',
      pay: pay || '',
      description: description || '',
      sourceUrl: url,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return NextResponse.json({ error: 'Délai d\'attente dépassé' }, { status: 500 })
    }
    Sentry.captureException(e, { tags: { route: 'extract' } })
    return NextResponse.json({ error: "Impossible de lire cette URL" }, { status: 500 })
  }
}
