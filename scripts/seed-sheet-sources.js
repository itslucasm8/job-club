#!/usr/bin/env node
/**
 * Seeds JobSource rows from Lucas's curated sheet. Adds well-known agencies +
 * pastoral co's + big farm employers I'm confident the URL is right. Skips:
 *  - Facebook groups (extension territory)
 *  - Seek/Gumtree search prompts (not URLs, just keywords)
 *  - Obscure single-farm names where the URL would be a guess
 *  - Existing slugs (uses upsert so re-runs are no-ops)
 *
 * All entries are inserted with enabled=false so Lucas can review and enable
 * selectively before they get scanned. Each is generic_career_page so the
 * runner can hit them once enabled.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const ENTRIES = [
  // ─── Job/labour-hire agencies ────────────────────────────────────
  { slug: 'staff360', label: 'Staff 360', category: 'aggregator', url: 'https://www.staff360.com.au/latest-jobs/' },
  { slug: 'programmed', label: 'Programmed', category: 'aggregator', url: 'https://www.programmed.com.au/job-search' },
  { slug: 'madec_harvest', label: 'MADEC Harvest Labour Service', category: 'aggregator', url: 'https://www.madec.edu.au/employment-services/national-harvest-labour-information-service/', defaultCategory: 'farm' },
  { slug: 'awx_bundaberg', label: 'AWX Bundaberg', category: 'aggregator', url: 'https://www.awx.com.au/jobs/', defaultState: 'QLD' },
  { slug: 'labour_solutions_australia', label: 'Labour Solutions Australia', category: 'aggregator', url: 'https://www.labour-solutions.com.au/job-board/' },
  { slug: 'agri_labour', label: 'Agri Labour Australia', category: 'aggregator', url: 'https://agrilabour.com.au/jobs/', defaultCategory: 'farm' },
  { slug: 'connect_staff', label: 'Connect Staff', category: 'aggregator', url: 'https://www.connectstaff.com.au/' },
  { slug: 'skillforce', label: 'Skillforce Recruitment', category: 'aggregator', url: 'https://www.skillforce.com.au/jobs/' },
  { slug: 'extra_staff', label: 'Extra Staff', category: 'aggregator', url: 'https://extrastaff.com.au/' },

  // ─── Mining / FIFO catering contractors ──────────────────────────
  { slug: 'civeo_au', label: 'Civeo Australia', category: 'direct', url: 'https://www.civeo.com/careers/' },
  { slug: 'sodexo_au', label: 'Sodexo Australia', category: 'direct', url: 'https://au.sodexo.com/careers.html' },
  { slug: 'compass_au', label: 'Compass Group Australia', category: 'direct', url: 'https://www.compass-group.com.au/careers' },
  { slug: 'ess_compass', label: 'ESS (Compass Group)', category: 'direct', url: 'https://www.essresources.com.au/careers/' },

  // ─── Cattle / pastoral stations ──────────────────────────────────
  { slug: 'aaco', label: 'AACO (Australian Agricultural Co.)', category: 'direct', url: 'https://aaco.com.au/careers' },
  { slug: 'consolidated_pastoral', label: 'Consolidated Pastoral Co.', category: 'direct', url: 'https://cpcompany.com.au/careers/' },
  { slug: 'stanbroke', label: 'Stanbroke', category: 'direct', url: 'https://www.stanbroke.com.au/work-with-us' },
  { slug: 'north_star_pastoral', label: 'North Star Pastoral', category: 'direct', url: 'https://northstarpastoral.com.au/' },
  { slug: 's_kidman_co', label: 'S. Kidman & Co', category: 'direct', url: 'https://www.kidman.com.au/' },
  { slug: 'heytesbury_cattle', label: 'Heytesbury Cattle Co.', category: 'direct', url: 'https://www.heytesburycattleco.com.au/' },
  { slug: 'outback_stores', label: 'Outback Stores', category: 'direct', url: 'https://www.outbackstores.com.au/careers/' },

  // ─── Fruit / produce / farms ─────────────────────────────────────
  { slug: 'pinata_farms', label: 'Piñata Farms', category: 'direct', url: 'https://www.pinata.com.au/careers/', defaultCategory: 'farm' },
  { slug: 'jbs_meatworks', label: 'JBS Australia (Meatworks)', category: 'direct', url: 'https://jbssa.com.au/careers/' },
  { slug: 'mulgowie_farming', label: 'Mulgowie Farming', category: 'direct', url: 'https://mulgowie.com.au/', defaultCategory: 'farm' },
  { slug: 'macadamias_australia', label: 'Macadamias Australia', category: 'direct', url: 'https://www.macadamiasaustralia.com.au/', defaultCategory: 'farm' },
  { slug: 'manbulloo_mango', label: 'Manbulloo (Mangoes)', category: 'direct', url: 'https://www.manbulloo.com.au/', defaultCategory: 'farm' },
  { slug: 'lamattina', label: 'Lamattina', category: 'direct', url: 'https://www.lamattina.com.au/', defaultCategory: 'farm' },
  { slug: 'reid_fruits', label: 'Reid Fruits', category: 'direct', url: 'https://www.reidfruits.com/', defaultCategory: 'farm', defaultState: 'TAS' },
  { slug: 'simpson_farms', label: 'Simpson Farms (Avocados)', category: 'direct', url: 'https://www.simpsonfarms.com/', defaultCategory: 'farm' },
  { slug: 'rugby_farms', label: 'Rugby Farms', category: 'direct', url: 'https://www.rugbyfarm.com.au/', defaultCategory: 'farm' },
  { slug: 'kalfresh', label: 'Kalfresh', category: 'direct', url: 'https://www.kalfresh.com.au/', defaultCategory: 'farm' },
  { slug: 'montague', label: 'Montague', category: 'direct', url: 'https://montague.com.au/careers/', defaultCategory: 'farm' },
  { slug: 'pro_ten', label: 'Pro-Ten', category: 'direct', url: 'https://www.proten.com.au/', defaultCategory: 'farm' },

  // ─── Transport / island operators ────────────────────────────────
  { slug: 'sealink', label: 'SeaLink', category: 'direct', url: 'https://www.sealink.com.au/careers/' },

  // ─── Misc / specialist ───────────────────────────────────────────
  { slug: 'bfvg_seasonal', label: 'BFVG (Bundaberg Fruit & Vegetable Growers) — Seasonal', category: 'direct', url: 'https://www.bfvg.com.au/seasonal-work/', defaultCategory: 'farm', defaultState: 'QLD' },
]

async function main() {
  let inserted = 0
  let skipped = 0
  for (const e of ENTRIES) {
    const config = { url: e.url }
    if (e.defaultCategory) config.defaultCategory = e.defaultCategory
    if (e.defaultState) config.defaultState = e.defaultState
    const existing = await prisma.jobSource.findUnique({ where: { slug: e.slug } })
    if (existing) {
      console.log(`= skip ${e.slug} (exists)`)
      skipped++
      continue
    }
    await prisma.jobSource.create({
      data: {
        slug: e.slug,
        label: e.label,
        category: e.category,
        adapter: 'generic_career_page',
        enabled: false,
        config,
      },
    })
    console.log(`+ ${e.slug}`)
    inserted++
  }
  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already existed).`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
