/**
 * Parse raw Podia posts into structured CSV for import
 *
 * Usage:
 *   npx tsx scripts/parse-podia-posts.ts
 *   npx tsx scripts/parse-podia-posts.ts --preview   (show first 10 parsed posts)
 *
 * Input:  scripts/podia-raw-posts.json (from browser scraper)
 * Output: scripts/podia-jobs.csv (for import-jobs.ts)
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

interface RawPost {
  title: string
  description: string
  date: string
  state: string
}

interface ParsedJob {
  title: string
  company: string
  state: string
  location: string
  category: string
  type: string
  pay: string
  description: string
  sourceUrl: string
}

// Category detection keywords
const CATEGORY_RULES: { category: string; keywords: RegExp }[] = [
  {
    category: 'farm',
    keywords: /\b(farm|picker|harvest|fruit|vegetable|planting|irrigation|poultry|vineyard|grape|strawberr|blueberr|mango|banana|cattle|livestock|agriculture|horticulture|tractor|crop|orchard|pruning|weeding|88.?days?|second.?year.?visa)\b/i,
  },
  {
    category: 'hospitality',
    keywords: /\b(bar\s|bartend|restaurant|kitchen|cafe|café|chef|barista|bistro|hotel|motel|housekeep|waitr|waiter|waitress|front.?of.?house|food.?service|cook|culinary|tavern|pub\b|resort|hospitality|gaming.?attend|event staff|catering)\b/i,
  },
  {
    category: 'construction',
    keywords: /\b(labourer|laborer|demolition|concrete|fencing|white.?card|carpent|builder|scaffold|roofing|plaster|excavat|retaining.?wall|construction|bricklayer|site.?work)\b/i,
  },
  {
    category: 'cleaning',
    keywords: /\b(clean(er|ing)|housekeeper|housekeeping|janitor|sanit|maid|spotless|sparkle|mop|vacuum)\b/i,
  },
  {
    category: 'retail',
    keywords: /\b(retail|shop\s|store\s|sales.?assist|cashier|customer.?service|warehouse|storeperson|packing|dispatch)\b/i,
  },
  {
    category: 'trade',
    keywords: /\b(electrician|plumber|mechanic|apprentice|welder|fitter|boilermaker|hvac|aircon|refrigeration|automotive)\b/i,
  },
]

// Try to extract pay from text
function extractPay(text: string): string {
  // Match patterns like "$28/hr", "$25-28/hr", "$33 per hour", "$31.25-50/hour"
  const patterns = [
    /\$[\d,.]+\s*[-–]\s*\$?[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:hr|hour|h)/i,
    /\$[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:hr|hour|h)/i,
    /\$[\d,.]+\s*[-–]\s*\$?[\d,.]+\s*(?:p\.?h|ph)/i,
    /\$[\d,.]+\s*(?:p\.?h|ph)/i,
    /\$[\d,.]+\s*[-–]\s*\$?[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:week|day|shift)/i,
    /\$[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:week|day|shift)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0].trim()
  }
  return ''
}

// Try to extract a company name from the text
function extractCompany(title: string, description: string): string {
  const fullText = `${title}\n${description}`

  // Pattern: "Company Name is looking/hiring/seeking"
  const isLookingMatch = fullText.match(/^(.+?)\s+(?:is|are)\s+(?:looking|hiring|seeking|currently seeking)/im)
  if (isLookingMatch) {
    let company = isLookingMatch[1].trim()
    // Remove leading junk
    company = company.replace(/^(Hi[! ]*|Hello[! ]*|Hey[! ]*)/i, '').trim()
    if (company.length > 3 && company.length < 60 && !company.toLowerCase().startsWith('we')) {
      return company
    }
  }

  // Pattern: "Join [the] Company Name [team]"
  const joinMatch = fullText.match(/join\s+(?:the\s+)?(?:team\s+at\s+)?([A-Z][A-Za-z0-9\s&''-]+?)(?:\s+team|\s*[!✨🌟])/i)
  if (joinMatch && joinMatch[1].length > 3 && joinMatch[1].length < 60) {
    return joinMatch[1].trim()
  }

  // Pattern: "at Company Name" (capitalized)
  const atMatch = fullText.match(/(?:work\s+)?at\s+([A-Z][A-Za-z0-9\s&''-]+?)(?:\s*[.!,\n])/m)
  if (atMatch && atMatch[1].length > 3 && atMatch[1].length < 60) {
    return atMatch[1].trim()
  }

  // Pattern: line ending with known company suffixes
  const suffixMatch = fullText.match(/([A-Z][A-Za-z0-9\s&''-]*(?:Pty|Ltd|Inc|Club|Resort|Hotel|Motel|Farm|Tavern|Cafe|Restaurant|Centre|Center|Group|Services)[\w\s.]*)/m)
  if (suffixMatch && suffixMatch[1].length > 3 && suffixMatch[1].length < 80) {
    return suffixMatch[1].trim()
  }

  return 'Employer (see description)'
}

// Try to extract location/city from text
function extractLocation(text: string, state: string): string {
  // Common Australian cities/towns by state
  const CITIES: Record<string, RegExp> = {
    QLD: /\b(Brisbane|Gold Coast|Cairns|Townsville|Toowoomba|Bundaberg|Mackay|Rockhampton|Sunshine Coast|Hervey Bay|Gladstone|Ipswich|Logan|Redlands?|Moreton Bay|Noosa|Caloundra|Maroochydore|Nambour|Gympie|Maryborough|Childers|Bowen|Ayr|Innisfail|Tully|Mission Beach|Stanthorpe|Warwick|Dalby|Emerald|Mount Isa|Gayndah|Mundubbera|Caboolture|Dakabin|Beerburrum|Wakerley|Fortitude Valley|Stafford|Hamilton|Redland Bay|New Farm|Margaret River|Bundamba|Morayfield)\b/i,
    NSW: /\b(Sydney|Newcastle|Wollongong|Central Coast|Coffs Harbour|Byron Bay|Lismore|Dubbo|Orange|Bathurst|Wagga Wagga|Tamworth|Armidale|Port Macquarie|Grafton|Griffith|Broken Hill|Albury|Mildura|Penrith|Parramatta|Blacktown|Liverpool|Campbelltown|Bondi|Manly|Pemulwuy|Moorebank|Kemps Creek|Minto|Eastern Creek)\b/i,
    VIC: /\b(Melbourne|Geelong|Ballarat|Bendigo|Shepparton|Mildura|Warrnambool|Traralgon|Wonthaggi|Mornington|Frankston|Dandenong|Sunbury|Heywood)\b/i,
    WA: /\b(Perth|Fremantle|Bunbury|Geraldton|Kalgoorlie|Broome|Karratha|Port Hedland|Albany|Esperance|Mandurah|Rockingham|Joondalup|Carnarvon|Margaret River|Donnybrook|Pemberton|Manjimup|Busselton)\b/i,
    SA: /\b(Adelaide|Mount Gambier|Whyalla|Murray Bridge|Port Augusta|Port Lincoln|Barossa|Renmark|Berri|Loxton|Waikerie)\b/i,
    TAS: /\b(Hobart|Launceston|Devonport|Burnie|Huon Valley|Tasman|Cygnet)\b/i,
    NT: /\b(Darwin|Alice Springs|Katherine|Tennant Creek|Nhulunbuy)\b/i,
    ACT: /\b(Canberra|Belconnen|Woden|Tuggeranong|Gungahlin)\b/i,
  }

  const statePattern = CITIES[state]
  if (statePattern) {
    const match = text.match(statePattern)
    if (match) return match[1]
  }

  // Try all states as fallback
  for (const [, pattern] of Object.entries(CITIES)) {
    const match = text.match(pattern)
    if (match) return match[1]
  }

  return state // Default to state code
}

// Detect job type
function detectType(text: string): string {
  if (/\b(full[- ]?time|permanent)\b/i.test(text)) return 'full_time'
  if (/\b(part[- ]?time)\b/i.test(text)) return 'part_time'
  if (/\b(contract|fixed[- ]?term)\b/i.test(text)) return 'contract'
  return 'casual' // Default for WHV jobs
}

// Detect category
function detectCategory(text: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) return rule.category
  }
  return 'other'
}

// Escape CSV field
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

// Parse a relative date like "4 j" or "30 mars" into an approximate date
function parseRelativeDate(dateStr: string): string {
  const now = new Date()

  // "X j" = X days ago
  const daysMatch = dateStr.match(/^(\d+)\s*j/)
  if (daysMatch) {
    const daysAgo = parseInt(daysMatch[1])
    const date = new Date(now.getTime() - daysAgo * 86400000)
    return date.toISOString().split('T')[0]
  }

  // French month names
  const months: Record<string, number> = {
    'jan': 0, 'fév': 1, 'mar': 2, 'avr': 3, 'mai': 4, 'juin': 5,
    'juil': 6, 'aoû': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'déc': 11,
  }

  const monthMatch = dateStr.match(/(\d{1,2})\s+(jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)/i)
  if (monthMatch) {
    const day = parseInt(monthMatch[1])
    const monthKey = monthMatch[2].toLowerCase().substring(0, 3)
    const month = months[monthKey]
    if (month !== undefined) {
      const year = now.getFullYear()
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  return ''
}

function main() {
  const preview = process.argv.includes('--preview')
  const inputPath = resolve(__dirname, 'podia-raw-posts.json')
  const outputPath = resolve(__dirname, 'podia-jobs.csv')

  console.log(`Reading: ${inputPath}`)
  const rawPosts: RawPost[] = JSON.parse(readFileSync(inputPath, 'utf-8'))
  console.log(`Total raw entries: ${rawPosts.length}`)

  const jobs: ParsedJob[] = []
  let skipped = 0

  for (const post of rawPosts) {
    const desc = post.description.trim()

    // Skip junk entries (sidebar text, headers, empty posts)
    if (desc.length < 50) { skipped++; continue }
    if (desc.includes("S'abonner") && desc.includes('Seul le créateur')) { skipped++; continue }
    if (desc.startsWith('Accueil\nMembres')) { skipped++; continue }
    if (desc.startsWith('Accueil')) { skipped++; continue }

    // Parse the description: first line is date, second is title, rest is body
    const lines = desc.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    let title = ''
    let date = ''
    let bodyStart = 0

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i]

      // Date line: "4 j", "30 mars", etc.
      if (/^\d{1,2}\s*(j\b|jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)/i.test(line)) {
        date = line
        continue
      }

      // Skip residual section names
      if (/^(Queensland|New South Wales|Victoria|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory)/i.test(line)) {
        continue
      }

      // First real content line = title
      if (!title && line.length > 2 && line.length < 200) {
        title = line
        bodyStart = i + 1
        break
      }
    }

    if (!title) { skipped++; continue }

    // Build description from remaining lines
    let body = lines.slice(bodyStart).join('\n').trim()

    // Clean up description
    body = body
      .replace(/\d+\s*commentaires?/gi, '')
      .replace(/Ajouter un commentaire/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (body.length < 20) { skipped++; continue }

    const fullText = `${title}\n${body}`
    const parsedDate = parseRelativeDate(date)

    const job: ParsedJob = {
      title: title.substring(0, 200), // Trim overly long titles
      company: extractCompany(title, body),
      state: post.state,
      location: extractLocation(fullText, post.state),
      category: detectCategory(fullText),
      type: detectType(fullText),
      pay: extractPay(fullText),
      description: body,
      sourceUrl: '',
    }

    // Try to extract source URL from description
    const urlMatch = body.match(/(https?:\/\/[^\s)]+)/i)
    if (urlMatch) {
      job.sourceUrl = urlMatch[1]
    }

    jobs.push(job)
  }

  console.log(`\nParsed: ${jobs.length} jobs`)
  console.log(`Skipped: ${skipped} junk entries`)

  // Category summary
  const categories: Record<string, number> = {}
  for (const job of jobs) categories[job.category] = (categories[job.category] || 0) + 1
  console.log('\nCategories:')
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`)
  }

  // State summary
  const states: Record<string, number> = {}
  for (const job of jobs) states[job.state] = (states[job.state] || 0) + 1
  console.log('\nStates:')
  for (const [state, count] of Object.entries(states).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`)
  }

  if (preview) {
    console.log('\n===== PREVIEW (first 10 jobs) =====\n')
    for (const job of jobs.slice(0, 10)) {
      console.log(`Title:    ${job.title}`)
      console.log(`Company:  ${job.company}`)
      console.log(`State:    ${job.state}`)
      console.log(`Location: ${job.location}`)
      console.log(`Category: ${job.category}`)
      console.log(`Type:     ${job.type}`)
      console.log(`Pay:      ${job.pay || '(not specified)'}`)
      console.log(`Desc:     ${job.description.substring(0, 150)}...`)
      console.log('---')
    }
    return
  }

  // Write CSV
  const headers = 'title,company,state,location,category,type,pay,description,sourceUrl'
  const rows = jobs.map(job =>
    [
      job.title, job.company, job.state, job.location,
      job.category, job.type, job.pay, job.description, job.sourceUrl,
    ].map(csvEscape).join(',')
  )

  const csv = [headers, ...rows].join('\n')
  writeFileSync(outputPath, csv, 'utf-8')
  console.log(`\nCSV written to: ${outputPath}`)
  console.log(`Ready to import: npx tsx scripts/import-jobs.ts --input scripts/podia-jobs.csv --dry-run`)
}

main()
