/**
 * Fix "Employer (see description)" company names
 *
 * Only applies HIGH-CONFIDENCE fixes. Leaves the rest as a cleaner fallback.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/fix-company-names.ts --dry-run
 *   DATABASE_URL="..." npx tsx scripts/fix-company-names.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function extractCompany(title: string, description: string): string | null {
  const lines = description.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const firstChunk = `${title}\n${description}`.substring(0, 1000)

  // Pattern 1: "[Company] is looking/hiring/seeking/on the hunt"
  // Most reliable — the company explicitly names itself
  const lookingMatch = firstChunk.match(/^([A-Z][A-Za-z0-9\s&''-]{2,55}?)\s+(?:is|are)\s+(?:looking|hiring|seeking|on the hunt|currently looking|currently hiring|currently seeking)/im)
  if (lookingMatch) {
    const company = lookingMatch[1].trim()
    if (!/^(we|our|the company|the team|the business|this|it|they)/i.test(company) && company.length > 3) {
      return company
    }
  }

  // Pattern 2: Lines with company suffixes — very reliable
  for (const line of lines.slice(0, 10)) {
    const suffixMatch = line.match(/([A-Z][A-Za-z0-9\s&''-]*(?:Pty Ltd|Ltd|Pty|Club|Resort|Hotel|Motel|Tavern|Cafe|Café|Restaurant|Centre|Center|Brewery|Winery|Estate|Retreat|Sanctuary|Stables|Racing|Equipment|Solutions|Services)\b[A-Za-z\s.]*)/m)
    if (suffixMatch && suffixMatch[1].length > 5 && suffixMatch[1].length < 80) {
      // Clean trailing junk
      let name = suffixMatch[1].replace(/\s+(is|are|we|has|have|was)\s.*$/i, '').trim()
      if (name.length > 5) return name
    }
  }

  // Pattern 3: "Join [the] [team at] Company" — reliable
  const joinMatch = firstChunk.match(/join\s+(?:the\s+)?(?:team\s+at\s+)?([A-Z][A-Za-z0-9\s&''-]{3,50}?)(?:\s+team|\s*[!✨🌟])/im)
  if (joinMatch && joinMatch[1].length > 3) {
    const company = joinMatch[1].trim()
    if (!/^(our|a |the )/i.test(company)) return company
  }

  // Pattern 4: "at [Company]" with clear context
  const atMatch = firstChunk.match(/(?:position|role|work|based|job)\s+at\s+([A-Z][A-Za-z0-9\s&''-]{3,50}?)(?:\s*[.!,\n])/m)
  if (atMatch && atMatch[1].length > 3) {
    const company = atMatch[1].trim()
    if (!/\b(our|a |the |this|here|home)\b/i.test(company)) return company
  }

  return null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const jobs = await prisma.job.findMany({
    where: { company: 'Employer (see description)' },
    select: { id: true, title: true, description: true },
  })

  console.log(`Found ${jobs.length} jobs with fallback company name\n`)

  let fixed = 0
  let renamed = 0
  const fixes: Array<{ title: string; newCompany: string }> = []

  for (const job of jobs) {
    const newCompany = extractCompany(job.title, job.description)

    if (newCompany && newCompany.length > 3
      && !newCompany.includes('\n')
      && newCompany.length < 60
      && !/\b(we |we$|hi |hey |hello|the role|about|duties|description|cleaning of|manage |position|immediate|flexible|must |location|role|summary|open positions)/i.test(newCompany)
      && !/^(farm hand|stable hand|kitchen|warehouse|labour|cleaner|housekeeper|wait staff|event staff|dairy|milking|egg farm|cafe |looking|stonemason|olive|grain|cotton|tractor|orchard|fruit|nursery|foh|bar and|crew|boarding|outback|supermarket|takeaway|workers|couple|casual|part time|full time)/i.test(newCompany)
    ) {
      fixes.push({ title: job.title, newCompany })
      if (!dryRun) {
        await prisma.job.update({ where: { id: job.id }, data: { company: newCompany } })
      }
      fixed++
    } else {
      // Rename the ugly fallback to something cleaner
      if (!dryRun) {
        await prisma.job.update({ where: { id: job.id }, data: { company: 'See description' } })
      }
      renamed++
    }
  }

  console.log(`Company name extracted: ${fixed}`)
  console.log(`Renamed to "See description": ${renamed}`)

  if (dryRun && fixes.length > 0) {
    console.log(`\nExtracted company names:`)
    for (const c of fixes) {
      console.log(`  "${c.title.substring(0, 50).padEnd(50)}" → ${c.newCompany}`)
    }
    console.log('\nRun without --dry-run to apply.')
  }
}

main()
  .catch(e => { console.error('Failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
