/**
 * Category & 88-Days Migration Script
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/migrate-categories.ts --dry-run
 *   DATABASE_URL="..." npx tsx scripts/migrate-categories.ts
 *
 * What it does:
 *   1. Merges trade → construction
 *   2. Re-categorizes "other" jobs using keyword detection on title + description
 *   3. Upgrades jobs in existing categories to events/animals/transport if the title strongly matches
 *   4. Sets eligible88Days = true for jobs mentioning 88-day or second-year visa keywords
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Keyword patterns (priority order — first match wins)
// ---------------------------------------------------------------------------

const CATEGORY_RULES: Array<{ category: string; titleOnly?: boolean; test: (text: string) => boolean }> = [
  {
    category: 'events',
    test: (text) => {
      if (!/\b(festival|event[\s$]|event$|fringe|ticketing|conference|exhibition|production crew|event crew)\b/i.test(text)) return false
      // Exclude "farm production", "production labourer", "production worker"
      if (/\b(farm production|production labourer|production laborer|production worker)\b/i.test(text)) return false
      return true
    },
  },
  {
    category: 'animals',
    test: (text) =>
      /\b(stable\s|horse|koala|kennel|boarding kennel|animal care|wildlife|sanctuary|veterinar|equestrian|rider\b|pet resort)\b/i.test(text),
  },
  {
    category: 'transport',
    test: (text) => {
      if (!/\b(driver\b|delivery driver|forklift|truck driver|motorhome|courier\b|bus driver)\b/i.test(text)) return false
      // Exclude "screwdriver"
      if (/\bscrewdriver\b/i.test(text)) return false
      return true
    },
  },
  {
    category: 'hospitality',
    test: (text) =>
      /\b(bar\b|bartend|restaurant|kitchen|cafe|café|chef|barista|bistro|hotel|motel|housekeep|waiter|waitress|front.?of.?house|food.?service|cook\b|culinary|tavern|pub\b|resort|hospitality|gaming.?attend|catering|baker|bakery|pastry|pizza|kebab|winemaker|venue manager|food truck)\b/i.test(text),
  },
  {
    category: 'farm',
    test: (text) =>
      /\b(farm|harvest|picker|fruit|vegetable|planting|irrigation|poultry|vineyard|grape|crop|orchard|pruning|weeding|livestock|cattle|dairy|milker|aquaculture|nursery|tractor|horticulture|mushroom|turf|truffle)\b/i.test(text),
  },
  {
    category: 'construction',
    test: (text) =>
      /\b(labourer|laborer|demolition|concrete|fencing|white.?card|carpent|builder|scaffold|roofing|plaster|excavat|retaining.?wall|construction|bricklayer|electrician|plumber|mechanic|welder|render)\b/i.test(text),
  },
  {
    category: 'cleaning',
    test: (text) =>
      /\b(clean(er|ing)|housekeeper|housekeeping|janitor|car.?wash|detailer|maid)\b/i.test(text),
  },
  {
    category: 'retail',
    test: (text) =>
      /\b(warehouse|store\s|shop\s|retail|packing|dispatch|cashier|customer.?service|letterbox)\b/i.test(text),
  },
]

// Only events, animals, transport are "new" categories that can upgrade an existing categorized job
const NEW_CATEGORIES = new Set(['events', 'animals', 'transport'])

const ELIGIBLE_88_PATTERN =
  /88[\s-]?days|88[\s-]?jours|second[\s-]?year[\s-]?visa|2nd[\s-]?year[\s-]?visa|subclass[\s-]?417|specified[\s-]?work|visa[\s-]?extension|whv[\s-]?eligible/i

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectCategory(title: string, description: string): string | null {
  const fullText = `${title} ${description}`.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.test(fullText)) return rule.category
  }
  return null
}

function detectCategoryFromTitle(title: string): string | null {
  const text = title.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.test(text)) return rule.category
  }
  return null
}

function matches88Days(title: string, description: string): boolean {
  return ELIGIBLE_88_PATTERN.test(`${title} ${description}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  if (dryRun) {
    console.log('[DRY RUN] No changes will be written to the database.\n')
  }

  const jobs = await prisma.job.findMany({
    select: { id: true, title: true, description: true, category: true, eligible88Days: true },
  })

  console.log(`Loaded ${jobs.length} jobs from database.\n`)

  // Counters
  let tradeMigrations = 0
  let otherRecategorized: Record<string, number> = {}
  let existingUpgraded = 0
  let eligible88Set = 0
  let unchanged = 0

  type Change = { id: string; newCategory?: string; newEligible88Days?: boolean }
  const changes: Change[] = []

  for (const job of jobs) {
    const change: Change = { id: job.id }

    let currentCategory = job.category

    // Step 1: trade → construction
    if (currentCategory === 'trade') {
      change.newCategory = 'construction'
      currentCategory = 'construction'
      tradeMigrations++
    }

    // Step 2 & 3: re-categorize
    if (change.newCategory === undefined) {
      if (currentCategory === 'other') {
        // Always apply first matching rule to "other" jobs
        const detected = detectCategory(job.title, job.description)
        if (detected) {
          change.newCategory = detected
          otherRecategorized[detected] = (otherRecategorized[detected] || 0) + 1
        }
      } else {
        // Existing category: only upgrade to a new category if title strongly matches
        // BUT don't upgrade if the title also matches the current category's keywords
        // (e.g. "Koala Tavern" matches both animals + hospitality via "tavern" — keep hospitality)
        const titleMatch = detectCategoryFromTitle(job.title)
        if (titleMatch && NEW_CATEGORIES.has(titleMatch) && titleMatch !== currentCategory) {
          const currentRuleMatchesTitle = CATEGORY_RULES.find(r => r.category === currentCategory)?.test(job.title.toLowerCase()) ?? false
          if (!currentRuleMatchesTitle) {
            change.newCategory = titleMatch
            existingUpgraded++
          }
        }
      }
    }

    // Step 4: eligible88Days
    if (!job.eligible88Days && matches88Days(job.title, job.description)) {
      change.newEligible88Days = true
      eligible88Set++
    }

    if (change.newCategory !== undefined || change.newEligible88Days !== undefined) {
      changes.push(change)
    } else {
      unchanged++
    }
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log('=== Migration Summary ===\n')
  console.log(`  trade → construction:          ${tradeMigrations} jobs`)

  if (Object.keys(otherRecategorized).length > 0) {
    console.log(`  "other" jobs re-categorized:   ${Object.values(otherRecategorized).reduce((a, b) => a + b, 0)} jobs`)
    for (const [cat, count] of Object.entries(otherRecategorized).sort((a, b) => b[1] - a[1])) {
      console.log(`    → ${cat.padEnd(14)} ${count}`)
    }
  } else {
    console.log(`  "other" jobs re-categorized:   0 jobs`)
  }

  console.log(`  existing upgraded (new cat):   ${existingUpgraded} jobs`)
  console.log(`  eligible88Days flags to set:   ${eligible88Set} jobs`)
  console.log(`  jobs unchanged:                ${unchanged}`)
  console.log(`  total changes:                 ${changes.length}`)
  console.log()

  if (dryRun) {
    // Show a sample of what would change (first 30)
    const sample = changes.slice(0, 30)
    if (sample.length > 0) {
      console.log('Sample of proposed changes (up to 30):')
      for (const c of sample) {
        const job = jobs.find(j => j.id === c.id)!
        const parts: string[] = []
        if (c.newCategory) parts.push(`category: ${job.category} → ${c.newCategory}`)
        if (c.newEligible88Days) parts.push('eligible88Days: false → true')
        console.log(`  [${job.category.padEnd(13)}] "${job.title.slice(0, 60)}" — ${parts.join(', ')}`)
      }
      if (changes.length > 30) {
        console.log(`  ... and ${changes.length - 30} more`)
      }
    }
    console.log('\nRun without --dry-run to apply changes.')
    return
  }

  // ---------------------------------------------------------------------------
  // Apply changes
  // ---------------------------------------------------------------------------

  if (changes.length === 0) {
    console.log('Nothing to do.')
    return
  }

  console.log(`Applying ${changes.length} updates...`)

  let applied = 0
  for (const change of changes) {
    const data: { category?: string; eligible88Days?: boolean } = {}
    if (change.newCategory !== undefined) data.category = change.newCategory
    if (change.newEligible88Days !== undefined) data.eligible88Days = change.newEligible88Days

    await prisma.job.update({ where: { id: change.id }, data })
    applied++

    if (applied % 100 === 0) {
      console.log(`  ${applied}/${changes.length} done...`)
    }
  }

  console.log(`\nDone. ${applied} jobs updated successfully.`)
}

main()
  .catch((e) => {
    console.error('Migration failed:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
