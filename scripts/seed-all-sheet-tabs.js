#!/usr/bin/env node
/**
 * Imports every entry from Lucas's source sheet into JobSource, organised by
 * the sheet's tabs (Seek / Gumtree / Facebook / Packhouses / Stations /
 * Websites / Mine Agencies / Job Agencies).
 *
 * Strategy:
 *  - Existing rows get their sheetTab backfilled.
 *  - New rows are inserted with adapter=null, enabled=false, no config —
 *    they're inventory placeholders. Lucas links URLs and picks an adapter
 *    via the /admin/sources edit form.
 *  - Slug = lowercased label with non-alphanum collapsed to '_'. Idempotent
 *    via findUnique guard.
 *
 * Skipped categorisation: Seek/Gumtree are keyword prompts (not URLs);
 * Facebook is extension territory. They live in the table for tracking,
 * not for the runner.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[\\/&,()'"]/g, ' ')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)
}

// ─── Existing slug → sheetTab backfill ──────────────────────────────────
const EXISTING_TAGS = {
  // Pre-existing
  workforce_australia: 'government',
  harvest_trail: 'government',
  manual: 'manual',
  extension: 'manual',
  costa_group_careers: 'website',
  driscolls_careers: 'website',
  perfection_fresh_careers: 'website',
  // Added in earlier batch
  staff360: 'job_agency',
  programmed: 'job_agency',
  madec_harvest: 'job_agency',
  awx_bundaberg: 'job_agency',
  labour_solutions_australia: 'job_agency',
  agri_labour: 'job_agency',
  connect_staff: 'job_agency',
  skillforce: 'job_agency',
  extra_staff: 'job_agency',
  civeo_au: 'mine_agency',
  sodexo_au: 'mine_agency',
  compass_au: 'mine_agency',
  ess_compass: 'mine_agency',
  aaco: 'station',
  consolidated_pastoral: 'station',
  stanbroke: 'station',
  north_star_pastoral: 'station',
  s_kidman_co: 'station',
  heytesbury_cattle: 'station',
  outback_stores: 'website',
  pinata_farms: 'website',
  jbs_meatworks: 'website',
  mulgowie_farming: 'website',
  macadamias_australia: 'website',
  manbulloo_mango: 'website',
  lamattina: 'website',
  reid_fruits: 'website',
  simpson_farms: 'website',
  rugby_farms: 'website',
  kalfresh: 'website',
  montague: 'packhouse',
  pro_ten: 'packhouse',
  sealink: 'website',
  bfvg_seasonal: 'website',
}

// ─── New entries from the sheet ─────────────────────────────────────────
// Keywords (Seek/Gumtree) and FB groups carry adapter=null since they need
// the extension or manual handling. Packhouses/Stations/Websites/etc. are
// flagged as future generic_career_page candidates but with no URL yet.
const ENTRIES = [
  // ─── Seek search prompts ───────────────────────────────
  ...['Farm', 'Meatworks', 'Casual', 'General hand', 'Warehouse', 'Solar farm', 'Factory operator', 'Factory hand', 'Function', 'Event staff', 'Event labour', 'Casual ACT Farming', 'Cold Storage', 'Wait / Dishwash / section waiter', 'Cellar Hand', 'Labour', 'Cleaner / Laundry', 'Mine site cleaners'].map(label => ({
    label, sheetTab: 'seek', category: 'aggregator', slugPrefix: 'seek_'
  })),

  // ─── Gumtree search prompts ─────────────────────────────
  ...['Farm / Farm hand / farm labour', 'Labour / hand / labour hand / yard hand / yard worker', 'Fencing', 'Nanny', 'Au Pair', 'Shed / packing shed', 'Planting', 'Picking', 'Packing', 'Casual Hand', 'Processing / process worker / process labour', 'Warehouse / warehouse labourer', 'Factory', 'Meat / meatworks', 'Visa', '88 days', 'Resort / hotel / porter', 'Island', 'Fishing / Oyster / Pearl', 'Deck hands / boat / boat cleaner', 'Housekeeper / room attendant / laundry', 'Cleaner', 'Car Wash / detailer', 'Solar Farm / wind farm', 'Outback', 'Seasonal worker', 'Harvest', 'Recycling', 'Line Sorter', 'Mining Jobs / Peggy / Fifo utility / Mine site cleaner', 'Festival Staff / Event / Event Labour', 'Furniture removalist', 'Horse / Stable / Groom / Rider', 'Container', 'Traffic control', 'Waiter / Wait Staff / Front of house / barista', 'Kitchen hand / dishwasher / Bartender / Bar staff', 'Roadhouse', 'Tomorrow / asap', 'Chicken / Egg', 'Dairy worker / labourer', 'Tourist season / snow season / ski season', 'Seasonal staff', 'No experience'].map(label => ({
    label, sheetTab: 'gumtree', category: 'aggregator', slugPrefix: 'gumtree_'
  })),

  // ─── Facebook Groups ───────────────────────────────────
  ...['Biloela jobs', 'Armidale Jobs', 'Tweed Ballina region', 'Mount Gambier jobs', 'Newcastle jobs', 'Tamworth jobs', 'Cloncurry jobs', 'Miles jobs', 'Emerald jobs', 'Jobs in Sydney', 'Dandenong jobs', 'Frankston jobs', 'Ballarat jobs', 'Port Augusta Jobs', 'Coober Pedy jobs', 'Jobs Shepparton', 'Jobs Echuca', 'Jobs Albury Wodonga', 'Melbourne jobs', 'WA jobs', 'Jobs Rockhampton', 'Chinchilla employment', 'Jobs in Weipa', 'Dalby job vacancies', 'Bowen jobs', 'Mareeba and Surrounds jobs', 'Whitsundays and Bowen jobs', 'Stations northern Australia', 'Station jobs WA', 'Station jobs NT', 'Station farm outback jobs WA', 'Outback Australia jobs', 'Outback QLD jobs', 'Yougawalla and Bulka Stations', 'The Stable Hub', 'Jobs Mount Isa', 'Jobs in Alice Springs', 'Jobs in Adelaide', 'Jobs in Noosa', 'Jobs Bendigo', 'Jobs Kangaroo Island', 'Jobs Port Lincoln', 'Jobs Wagga Wagga', 'Jobs Bathurst', 'Jobs in Orange', 'Broken Hill Jobs', 'Mining jobs FIFO', 'Bundaberg job vacancies', 'Byron Bay jobs', 'Exmouth Busselton jobs', 'Innisfail jobs', 'Jobs Manjimup', 'Cooktown jobs', 'Jobs in Dubbo', 'Jobs North Burnett', 'Jobs in Logan', 'Jobs Fraser Coast', 'Positions vacant Roma', 'Station Farming Jobs Australia', 'Penrith Blue Mountains jobs', 'Cairns jobs', 'Darwin jobs', 'Margaret River jobs', 'Margaret River employment', 'Governess and Nanny positions', 'Governess Cattle Stations', 'Jobs in Gatton', 'Brisbane Hospitality Staff', 'Job vacancies Toowoomba', 'Tamborine Mountain job', 'Bribie Island job', 'Jimboomba jobs', 'Jobs Tweed Region', 'Charters Towers central jobs', 'Queensland pub jobs', 'The Scenic Rim jobs', 'Lockyer Valley jobs', 'Jobs in Redland', 'Jobs regional QLD', 'Jobs on Straddie', 'Wynnum Manly jobs'].map(label => ({
    label, sheetTab: 'facebook', category: 'competitor', slugPrefix: 'fb_'
  })),

  // ─── Packhouses ────────────────────────────────────────
  ...['Sunnyspot Packhouse', 'Tropical Bananas', 'Sunraysia Facility', 'Duns Fort Packing', 'Dairyjobs.com.au', 'Parker Point Packhouse', 'Green Mountain Meatworks'].map(label => ({
    label, sheetTab: 'packhouse', category: 'direct', slugPrefix: ''
  })),

  // ─── Station Jobs (the ones not yet added) ─────────────
  ...['Mutooroo Pastoral Company', 'Jumbuck Rawlinna'].map(label => ({
    label, sheetTab: 'station', category: 'direct', slugPrefix: ''
  })),

  // ─── Websites (long tail of employer career pages) ─────
  ...['Moora Citrus', 'Carter and Spencer Queensland', 'Sim Fresh', 'North Australian Pastoral Company job board', 'Koala Farms', 'Wuslipsvc', 'Green Pigeon Orchard', 'Red Valley', 'Blue Hills Berries and Cherries', 'HV McNab and Son', 'Plunkett Orchard', 'Glenbourn Orchard', 'Handasyde Strawberries', 'Ceres Careers', 'Vineyard and Margaret River Tree Planting', 'Bauers Organic Farm', 'Blue Cow Citrus', 'Wadda Banana Plantation', 'Cherrymore', 'Somercotes Cherry Farm', 'Coalvalley Orchard', 'Main Range Cherry Orchard', 'Super Seasons Pty Ltd vacancies', 'Jenkos Mangoes', 'Lavavalley Produce', 'Templetons', 'Papa Organics', 'Nolan Meats Gympie', 'Abbotsleigh Citrus', 'Sweet Strawberry Runners', 'Taylor Family Farm', 'Hibbens Plantation', 'Hillside Meat Processing', 'Gingin Citrus', 'Moonrocks', 'Cislett Farms', 'Hermes Strawberry', 'Dicky Bill Australia', 'Tough Yakka Brisbane Container Loading', 'Fruitco', 'Karingal Gardens Pomegranates', 'Peats Ridge Family Fresh Farm', 'Jobs Hub Central Queensland Highlands', 'Redlands Coast Job Board', 'Mack Australia Koo Wee Rup', 'Willowzen Farm', 'Maragi Farm', 'Bauer Farm', 'DA Hall', 'Heath Hills Farms', 'Pullman Brisbane Hotel', 'Ibis Brisbane', 'The Westin Brisbane', 'Emporium Hotel Brisbane', 'Hotel X Brisbane', 'Mercure Brisbane', 'Treasury Hotel Brisbane'].map(label => ({
    label, sheetTab: 'website', category: 'direct', slugPrefix: ''
  })),

  // ─── Mine Agencies (only QITE not yet added) ───────────
  { label: 'QITE', sheetTab: 'mine_agency', category: 'aggregator', slugPrefix: '' },

  // ─── Job Agencies (the ones not yet added) ─────────────
  ...['Austcorp', 'Napco', 'Costa Group', 'CPC', 'HM Origins', 'The Lucas Group', 'Agri Labour Australia (alt)', 'Proctech', 'Celotti Workforce', 'AG Jobs Australia'].map(label => ({
    label, sheetTab: 'job_agency', category: 'aggregator', slugPrefix: ''
  })),
]

async function main() {
  // Backfill sheetTab on existing rows
  let backfilled = 0
  for (const [slug, tab] of Object.entries(EXISTING_TAGS)) {
    try {
      await prisma.jobSource.update({
        where: { slug },
        data: { sheetTab: tab },
      })
      backfilled++
    } catch (e) {
      if (e.code === 'P2025') {
        console.warn(`= existing slug "${slug}" not found, skipping`)
      } else {
        throw e
      }
    }
  }
  console.log(`Backfilled sheetTab on ${backfilled} existing rows.\n`)

  // Insert new entries
  let inserted = 0
  let skipped = 0
  for (const e of ENTRIES) {
    const slug = (e.slugPrefix || '') + slugify(e.label)
    if (!slug) continue
    const existing = await prisma.jobSource.findUnique({ where: { slug } })
    if (existing) {
      // Just backfill the tab if missing
      if (!existing.sheetTab) {
        await prisma.jobSource.update({ where: { slug }, data: { sheetTab: e.sheetTab } })
      }
      skipped++
      continue
    }
    await prisma.jobSource.create({
      data: {
        slug,
        label: e.label,
        category: e.category,
        sheetTab: e.sheetTab,
        adapter: null,
        enabled: false,
        config: null,
      },
    })
    inserted++
  }
  console.log(`Inserted ${inserted} new entries, skipped ${skipped} (already existed).`)

  // Final tally per tab
  const counts = await prisma.jobSource.groupBy({
    by: ['sheetTab'],
    _count: { _all: true },
    orderBy: { sheetTab: 'asc' },
  })
  console.log('\nFinal counts by tab:')
  for (const c of counts) {
    console.log(`  ${c.sheetTab || '(unassigned)'}: ${c._count._all}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
