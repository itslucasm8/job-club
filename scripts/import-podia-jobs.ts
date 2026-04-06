/**
 * Import parsed Podia jobs directly into the database
 *
 * Usage:
 *   npx tsx scripts/import-podia-jobs.ts --dry-run    (preview only)
 *   npx tsx scripts/import-podia-jobs.ts               (import for real)
 *
 * Input: scripts/podia-raw-posts.json (from browser scraper)
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'trade', 'retail', 'cleaning', 'other']

// Category detection keywords
const CATEGORY_RULES: { category: string; keywords: RegExp }[] = [
  { category: 'farm', keywords: /\b(farm|picker|harvest|fruit|vegetable|planting|irrigation|poultry|vineyard|grape|strawberr|blueberr|mango|banana|cattle|livestock|agriculture|horticulture|tractor|crop|orchard|pruning|weeding|88.?days?|second.?year.?visa)\b/i },
  { category: 'hospitality', keywords: /\b(bar\s|bartend|restaurant|kitchen|cafe|café|chef|barista|bistro|hotel|motel|housekeep|waitr|waiter|waitress|front.?of.?house|food.?service|cook|culinary|tavern|pub\b|resort|hospitality|gaming.?attend|event staff|catering)\b/i },
  { category: 'construction', keywords: /\b(labourer|laborer|demolition|concrete|fencing|white.?card|carpent|builder|scaffold|roofing|plaster|excavat|retaining.?wall|construction|bricklayer|site.?work)\b/i },
  { category: 'cleaning', keywords: /\b(clean(er|ing)|housekeeper|housekeeping|janitor|sanit|maid|spotless|sparkle|mop|vacuum)\b/i },
  { category: 'retail', keywords: /\b(retail|shop\s|store\s|sales.?assist|cashier|customer.?service|warehouse|storeperson|packing|dispatch)\b/i },
  { category: 'trade', keywords: /\b(electrician|plumber|mechanic|apprentice|welder|fitter|boilermaker|hvac|aircon|refrigeration|automotive)\b/i },
]

const CITIES: Record<string, RegExp> = {
  QLD: /\b(Brisbane|Gold Coast|Cairns|Townsville|Toowoomba|Bundaberg|Mackay|Rockhampton|Sunshine Coast|Hervey Bay|Gladstone|Ipswich|Logan|Redlands?|Moreton Bay|Noosa|Caloundra|Maroochydore|Nambour|Gympie|Maryborough|Childers|Bowen|Ayr|Innisfail|Tully|Mission Beach|Stanthorpe|Warwick|Dalby|Emerald|Mount Isa|Gayndah|Mundubbera|Caboolture|Dakabin|Beerburrum|Wakerley|Fortitude Valley|Stafford|Hamilton|Redland Bay|New Farm|Bundamba|Morayfield)\b/i,
  NSW: /\b(Sydney|Newcastle|Wollongong|Central Coast|Coffs Harbour|Byron Bay|Lismore|Dubbo|Orange|Bathurst|Wagga Wagga|Tamworth|Armidale|Port Macquarie|Grafton|Griffith|Broken Hill|Albury|Penrith|Parramatta|Blacktown|Liverpool|Campbelltown|Bondi|Manly|Pemulwuy|Moorebank|Kemps Creek|Minto|Eastern Creek)\b/i,
  VIC: /\b(Melbourne|Geelong|Ballarat|Bendigo|Shepparton|Mildura|Warrnambool|Traralgon|Wonthaggi|Mornington|Frankston|Dandenong|Sunbury|Heywood)\b/i,
  WA: /\b(Perth|Fremantle|Bunbury|Geraldton|Kalgoorlie|Broome|Karratha|Port Hedland|Albany|Esperance|Mandurah|Rockingham|Joondalup|Carnarvon|Margaret River|Donnybrook|Pemberton|Manjimup|Busselton)\b/i,
  SA: /\b(Adelaide|Mount Gambier|Whyalla|Murray Bridge|Port Augusta|Port Lincoln|Barossa|Renmark|Berri|Loxton|Waikerie)\b/i,
  TAS: /\b(Hobart|Launceston|Devonport|Burnie|Huon Valley|Tasman|Cygnet)\b/i,
  NT: /\b(Darwin|Alice Springs|Katherine|Tennant Creek|Nhulunbuy)\b/i,
  ACT: /\b(Canberra|Belconnen|Woden|Tuggeranong|Gungahlin)\b/i,
}

function detectCategory(text: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) return rule.category
  }
  return 'other'
}

function detectType(text: string): string {
  if (/\b(full[- ]?time|permanent)\b/i.test(text)) return 'full_time'
  if (/\b(part[- ]?time)\b/i.test(text)) return 'part_time'
  if (/\b(contract|fixed[- ]?term)\b/i.test(text)) return 'contract'
  return 'casual'
}

function extractLocation(text: string, state: string): string {
  const statePattern = CITIES[state]
  if (statePattern) {
    const match = text.match(statePattern)
    if (match) return match[1]
  }
  for (const [, pattern] of Object.entries(CITIES)) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return state
}

function extractPay(text: string): string | null {
  const patterns = [
    /\$[\d,.]+\s*[-–]\s*\$?[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:hr|hour|h)/i,
    /\$[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:hr|hour|h)/i,
    /\$[\d,.]+\s*[-–]\s*\$?[\d,.]+\s*(?:p\.?h|ph)/i,
    /\$[\d,.]+\s*(?:\/|\s*per\s*)\s*(?:week|day|shift)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0].trim()
  }
  return null
}

function extractCompany(title: string, body: string): string {
  const fullText = `${title}\n${body}`

  const isLookingMatch = fullText.match(/^(.+?)\s+(?:is|are)\s+(?:looking|hiring|seeking|currently seeking)/im)
  if (isLookingMatch) {
    let company = isLookingMatch[1].trim().replace(/^(Hi[! ]*|Hello[! ]*|Hey[! ]*)/i, '').trim()
    if (company.length > 3 && company.length < 60 && !company.toLowerCase().startsWith('we')) {
      return company
    }
  }

  const joinMatch = fullText.match(/join\s+(?:the\s+)?(?:team\s+at\s+)?([A-Z][A-Za-z0-9\s&''-]+?)(?:\s+team|\s*[!✨🌟])/i)
  if (joinMatch && joinMatch[1].length > 3 && joinMatch[1].length < 60) return joinMatch[1].trim()

  const atMatch = fullText.match(/(?:work\s+)?at\s+([A-Z][A-Za-z0-9\s&''-]+?)(?:\s*[.!,\n])/m)
  if (atMatch && atMatch[1].length > 3 && atMatch[1].length < 60) return atMatch[1].trim()

  const suffixMatch = fullText.match(/([A-Z][A-Za-z0-9\s&''-]*(?:Pty|Ltd|Inc|Club|Resort|Hotel|Motel|Farm|Tavern|Cafe|Restaurant|Centre|Center|Group|Services)[\w\s.]*)/m)
  if (suffixMatch && suffixMatch[1].length > 3 && suffixMatch[1].length < 80) return suffixMatch[1].trim()

  return 'Employer (see description)'
}

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
  pay: string | null
  description: string
  sourceUrl: string | null
}

function parseRawPosts(rawPosts: RawPost[]): ParsedJob[] {
  const jobs: ParsedJob[] = []
  let skipped = 0

  for (const post of rawPosts) {
    const desc = post.description.trim()

    // Skip junk entries
    if (desc.length < 50) { skipped++; continue }
    if (desc.includes("S'abonner") && desc.includes('Seul le créateur')) { skipped++; continue }
    if (desc.startsWith('Accueil')) { skipped++; continue }

    const lines = desc.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    let title = ''
    let bodyStart = 0

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i]

      // Skip date lines like "4 j", "30 mars"
      if (/^\d{1,2}\s*(j\b|jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)/i.test(line)) continue
      // Skip section names
      if (/^(Queensland|New South Wales|Victoria|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory)/i.test(line)) continue

      if (!title && line.length > 2 && line.length < 200) {
        title = line
        bodyStart = i + 1
        break
      }
    }

    if (!title) { skipped++; continue }

    let body = lines.slice(bodyStart).join('\n')
      .replace(/\d+\s*commentaires?/gi, '')
      .replace(/Ajouter un commentaire/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (body.length < 20) { skipped++; continue }

    const fullText = `${title}\n${body}`
    const urlMatch = body.match(/(https?:\/\/[^\s)]+)/i)

    jobs.push({
      title: title.substring(0, 200),
      company: extractCompany(title, body),
      state: post.state,
      location: extractLocation(fullText, post.state),
      category: detectCategory(fullText),
      type: detectType(fullText),
      pay: extractPay(fullText),
      description: body,
      sourceUrl: urlMatch ? urlMatch[1] : null,
    })
  }

  console.log(`Parsed: ${jobs.length} jobs, skipped: ${skipped} junk entries`)
  return jobs
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const inputIdx = process.argv.indexOf('--input')
  const inputFile = inputIdx !== -1 && process.argv[inputIdx + 1]
    ? process.argv[inputIdx + 1]
    : 'podia-raw-posts.json'
  const inputPath = resolve(__dirname, inputFile)

  console.log(`Reading: ${inputPath}`)
  const rawPosts: RawPost[] = JSON.parse(readFileSync(inputPath, 'utf-8'))
  console.log(`Total raw entries: ${rawPosts.length}`)

  const jobs = parseRawPosts(rawPosts)

  // Validate
  const invalid: string[] = []
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]
    if (!VALID_STATES.includes(j.state)) invalid.push(`Job ${i}: invalid state "${j.state}"`)
    if (!VALID_CATEGORIES.includes(j.category)) invalid.push(`Job ${i}: invalid category "${j.category}"`)
    if (!j.title) invalid.push(`Job ${i}: missing title`)
  }

  if (invalid.length > 0) {
    console.error(`\n${invalid.length} validation errors:`)
    invalid.forEach(e => console.error(`  ✗ ${e}`))
    process.exit(1)
  }

  // Summary
  const cats: Record<string, number> = {}
  const states: Record<string, number> = {}
  for (const j of jobs) {
    cats[j.category] = (cats[j.category] || 0) + 1
    states[j.state] = (states[j.state] || 0) + 1
  }

  console.log('\nBy category:')
  for (const [c, n] of Object.entries(cats).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`)
  console.log('\nBy state:')
  for (const [s, n] of Object.entries(states).sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`)

  if (dryRun) {
    console.log(`\n[DRY RUN] Would import ${jobs.length} jobs. First 5:`)
    for (const j of jobs.slice(0, 5)) {
      console.log(`  "${j.title}" — ${j.company} (${j.state}/${j.location}, ${j.category})`)
    }
    console.log(`\nRun without --dry-run to import.`)
    return
  }

  // Import
  const prisma = new PrismaClient()
  try {
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    const data = jobs.map(j => ({
      title: j.title,
      company: j.company,
      state: j.state,
      location: j.location,
      category: j.category,
      type: j.type,
      pay: j.pay,
      description: j.description,
      sourceUrl: j.sourceUrl,
      active: true,
      expiresAt: thirtyDaysFromNow,
    }))

    const result = await prisma.job.createMany({ data })
    console.log(`\n✓ Imported ${result.count} jobs successfully!`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error('Import failed:', e.message)
  process.exit(1)
})
