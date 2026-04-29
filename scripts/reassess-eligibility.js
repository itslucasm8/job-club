/**
 * Bulk re-run deterministic 88-day + award assessment on every JobCandidate.
 *
 * Plain Node JS (no TS) so it can run inside the standalone Next.js Docker
 * container without tsx. Designed to be docker-cp'd into /app/ and executed:
 *
 *   docker cp scripts/reassess-eligibility.js jobclub-app-1:/app/
 *   docker compose exec app node /app/reassess-eligibility.js
 *   docker compose exec app node /app/reassess-eligibility.js --dry-run
 *   docker compose exec app node /app/reassess-eligibility.js --id=<cuid>
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const PROXY_URL = process.env.CLAUDE_PROXY_URL || 'http://host.docker.internal:8090'
const PROXY_SECRET = process.env.CLAUDE_PROXY_SECRET || ''

const TRACKED_KEYS = [
  'eligible88Days',
  'eligibility_88_days',
  'eligibility_reason',
  'eligibility_confidence',
  'industry',
  'postcode',
  'award_id',
  'award_min_hourly',
  'award_min_casual_hourly',
  'pay_parsed_hourly',
  'pay_kind',
  'pay_status',
  'pay_gap',
]

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run')
  const idArg = process.argv.find((a) => a.startsWith('--id='))
  return { dryRun, onlyId: idArg ? idArg.slice('--id='.length) : null }
}

async function reassess(raw) {
  const res = await fetch(`${PROXY_URL}/reassess-eligibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROXY_SECRET}` },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }
  return res.json()
}

function diffSummary(before, after) {
  const changes = []
  for (const k of TRACKED_KEYS) {
    const a = JSON.stringify(before?.[k])
    const b = JSON.stringify(after?.[k])
    if (a !== b) changes.push(`${k}: ${a} -> ${b}`)
  }
  return changes
}

async function main() {
  const { dryRun, onlyId } = parseArgs()
  if (!PROXY_SECRET) {
    console.error('CLAUDE_PROXY_SECRET not set in app environment.')
    process.exit(1)
  }

  const where = onlyId ? { id: onlyId } : {}
  const candidates = await prisma.jobCandidate.findMany({
    where,
    select: { id: true, source: true, sourceUrl: true, status: true, rawData: true },
    orderBy: { createdAt: 'desc' },
  })

  console.log(`Found ${candidates.length} candidate(s)${dryRun ? ' (DRY RUN)' : ''}`)

  let changedCount = 0
  let unchangedCount = 0
  let errorCount = 0

  for (const c of candidates) {
    const raw = c.rawData
    if (!raw || typeof raw !== 'object') {
      console.log(`[skip] ${c.id} - rawData missing/invalid`)
      continue
    }
    let merged
    try {
      merged = await reassess(raw)
    } catch (e) {
      errorCount++
      console.error(`[error] ${c.id} - ${e.message}`)
      continue
    }
    const changes = diffSummary(raw, merged)
    const titlePreview = String(raw.title || '').slice(0, 50)
    if (changes.length === 0) {
      unchangedCount++
      console.log(`[unchanged] ${c.id} - ${titlePreview}`)
      continue
    }
    changedCount++
    console.log(`[changed] ${c.id} - ${titlePreview}`)
    for (const chg of changes) console.log(`   ${chg}`)
    if (!dryRun) {
      await prisma.jobCandidate.update({
        where: { id: c.id },
        data: { rawData: merged },
      })
    }
  }

  console.log(`\n${changedCount} changed, ${unchangedCount} unchanged, ${errorCount} error(s)${dryRun ? ' (no writes)' : ''}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
