#!/usr/bin/env node
/**
 * Backfills ingestionStrategy on existing JobSource rows based on adapter +
 * sheetTab. Idempotent; only sets the field where currently null.
 *
 * Mapping rules (lowest → highest priority):
 *   adapter = workforce_australia | harvest_trail   → structured_html
 *   adapter = generic_career_page                   → generic_web
 *   adapter = extension                             → manual
 *   adapter = manual                                → manual
 *   sheetTab = facebook                             → extension
 *   sheetTab = seek | gumtree                       → keyword_search
 *   else                                            → null (unclassified)
 *
 * Adapter wins over sheetTab — if a Facebook row somehow has a generic_web
 * adapter set, it stays generic_web. The sheetTab default is just for the
 * inventory rows that have no adapter yet.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function strategyFor(row) {
  if (row.adapter === 'workforce_australia' || row.adapter === 'harvest_trail') return 'structured_html'
  if (row.adapter === 'generic_career_page') return 'generic_web'
  if (row.adapter === 'manual' || row.adapter === 'extension') return 'manual'
  if (row.sheetTab === 'facebook') return 'extension'
  if (row.sheetTab === 'seek' || row.sheetTab === 'gumtree') return 'keyword_search'
  return null
}

async function main() {
  const rows = await prisma.jobSource.findMany({
    where: { ingestionStrategy: null },
    select: { slug: true, adapter: true, sheetTab: true },
  })

  let updated = 0
  let stillNull = 0
  for (const r of rows) {
    const strat = strategyFor(r)
    if (!strat) { stillNull++; continue }
    await prisma.jobSource.update({
      where: { slug: r.slug },
      data: { ingestionStrategy: strat },
    })
    updated++
  }
  console.log(`Backfilled ${updated} rows; ${stillNull} left unclassified (no adapter + no covered sheetTab).`)

  const counts = await prisma.jobSource.groupBy({
    by: ['ingestionStrategy'],
    _count: { _all: true },
    orderBy: { ingestionStrategy: 'asc' },
  })
  console.log('\nFinal counts by ingestionStrategy:')
  for (const c of counts) {
    console.log(`  ${c.ingestionStrategy || '(null)'}: ${c._count._all}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
