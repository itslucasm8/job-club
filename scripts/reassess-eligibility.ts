/**
 * Bulk re-run deterministic 88-day + award assessment on every JobCandidate.
 *
 * Use case: after correcting reference data (postcodes, award rates), historical
 * rows still hold the OLD verdict in their rawData JSON. This script re-applies
 * eligibility.assess() to each row via the proxy's /reassess-eligibility endpoint
 * and writes the merged result back. No LLM calls.
 *
 * Run on the VPS (where CLAUDE_PROXY_URL points at host.docker.internal:8090):
 *   docker compose exec app npx tsx scripts/reassess-eligibility.ts
 *
 * Or with --dry-run to see what would change:
 *   docker compose exec app npx tsx scripts/reassess-eligibility.ts --dry-run
 *
 * Or limit to one candidate by id:
 *   docker compose exec app npx tsx scripts/reassess-eligibility.ts --id=cmoiv0y5v0002ffc05fvlyi34
 */
import { prisma } from '@/lib/prisma'
import { proxyReassessEligibility, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

type Args = { dryRun: boolean; onlyId: string | null }

function parseArgs(): Args {
  const dryRun = process.argv.includes('--dry-run')
  const idArg = process.argv.find((a) => a.startsWith('--id='))
  return { dryRun, onlyId: idArg ? idArg.slice('--id='.length) : null }
}

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
] as const

function diffSummary(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const changes: string[] = []
  for (const k of TRACKED_KEYS) {
    const a = JSON.stringify(before?.[k])
    const b = JSON.stringify(after?.[k])
    if (a !== b) changes.push(`${k}: ${a} -> ${b}`)
  }
  return changes
}

async function main() {
  const { dryRun, onlyId } = parseArgs()
  if (!isProxyConfigured()) {
    console.error('CLAUDE_PROXY_SECRET not set — cannot reach proxy.')
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
    const raw = c.rawData as Record<string, unknown>
    if (!raw || typeof raw !== 'object') {
      console.log(`[skip] ${c.id} — rawData missing/invalid`)
      continue
    }
    let merged: Record<string, unknown>
    try {
      merged = await proxyReassessEligibility(raw)
    } catch (e) {
      errorCount++
      console.error(`[error] ${c.id} — ${(e as Error).message}`)
      continue
    }
    const changes = diffSummary(raw, merged)
    const titlePreview = String(raw.title || '').slice(0, 50)
    if (changes.length === 0) {
      unchangedCount++
      console.log(`[unchanged] ${c.id} — ${titlePreview}`)
      continue
    }
    changedCount++
    console.log(`[changed] ${c.id} — ${titlePreview}`)
    for (const chg of changes) console.log(`   ${chg}`)
    if (!dryRun) {
      await prisma.jobCandidate.update({
        where: { id: c.id },
        data: { rawData: merged as object },
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
