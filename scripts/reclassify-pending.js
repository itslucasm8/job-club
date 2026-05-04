// Walks all pending JobCandidate rows and re-applies the auto-reject rules
// from src/lib/sourcing/classifier.ts WITHOUT calling Claude (uses the
// classifierScore already on the row plus structural checks on rawData).
//
// Use after tightening the auto-reject logic to clean out historical pending
// rows that the new rules would have caught.
//
// Run inside the app container:
//   docker cp scripts/reclassify-pending.js $(docker compose ps -q app):/app/
//   docker compose exec app node /app/reclassify-pending.js [--dry-run]

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const ANNUAL_SALARY_FLOOR = 50000
const NOT_SUITABLE_AUTOREJECT_CONFIDENCE = 0.8
const EXPERIENCE_KEYWORD_RE = /\bexperience\b|\byears?[ -]of\b|\bprior[ -]experience\b|\bqualifi/i
const ANNUAL_SALARY_REASON_RE = /annual\s+salary|per\s+annum|\bp\.?a\.?\b|\$5\d[,k]|\$[6-9]\d[,k]|\$\d{3}[,k]|salary\s+package|skilled\s+migration|full[\s-]?time\s+permanent|permanent\s+full[\s-]?time|AQF\s+(?:certificate|cert)|cert(?:ificate)?\s+(?:III|IV)\s+(?:required|qualification)|degree\s+required|bachelor['’]?s?\s+(?:required|degree)|professional\s+(?:registration|career|management)/i

function payHasAnnualSalaryAtOrAboveFloor(raw) {
  const pay = String(raw?.pay || '')
  if (!pay) return false
  const re = /\$\s*(\d{2,3})(?:,(\d{3})|\.(\d{3}))?\s*([kK])?/g
  let m
  while ((m = re.exec(pay)) !== null) {
    const lead = parseInt(m[1], 10)
    const trail = m[2] ?? m[3]
    const isK = !!m[4]
    let value
    if (isK) {
      value = lead * 1000
    } else if (trail) {
      value = lead * 1000 + parseInt(trail, 10)
    } else {
      continue
    }
    if (Number.isFinite(value) && value >= ANNUAL_SALARY_FLOOR) return true
  }
  return false
}

function decideAutoReject(score, raw) {
  if (score?.has_scam_red_flags === true) {
    return {
      reject: true,
      reason: `Auto: scam (${(score.scam_reasons || []).slice(0, 2).join(', ')})`,
    }
  }
  if (raw?.type === 'full_time' && payHasAnnualSalaryAtOrAboveFloor(raw)) {
    return {
      reject: true,
      reason: `Auto: full-time annual salary above WHV band (>=$${ANNUAL_SALARY_FLOOR / 1000}k/yr)`,
    }
  }
  if (
    score?.is_backpacker_suitable === false &&
    typeof score?.confidence === 'number' &&
    score.confidence >= NOT_SUITABLE_AUTOREJECT_CONFIDENCE
  ) {
    const reasoning = score.reasoning || ''
    const mentionsAnnualSalary =
      ANNUAL_SALARY_REASON_RE.test(reasoning) || payHasAnnualSalaryAtOrAboveFloor(raw)
    const isExperienceOnly =
      EXPERIENCE_KEYWORD_RE.test(reasoning) && !mentionsAnnualSalary
    if (!isExperienceOnly) {
      return { reject: true, reason: `Auto: ${reasoning.slice(0, 120)}` }
    }
  }
  return { reject: false }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const pending = await prisma.jobCandidate.findMany({
    where: { status: 'pending' },
    select: { id: true, rawData: true, classifierScore: true },
  })

  let rejected = 0
  let kept = 0
  let skipped = 0

  for (const c of pending) {
    if (!c.classifierScore) {
      skipped++
      continue
    }
    const decision = decideAutoReject(c.classifierScore, c.rawData)
    if (decision.reject) {
      const title = c.rawData?.title?.slice(0, 60) || '(no title)'
      console.log(`✗ ${title.padEnd(62)} — ${decision.reason.slice(0, 100)}`)
      if (!dryRun) {
        await prisma.jobCandidate.update({
          where: { id: c.id },
          data: { status: 'auto_rejected', rejectReason: decision.reason },
        })
      }
      rejected++
    } else {
      kept++
    }
  }

  console.log('---')
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Rejected ${rejected} / Kept ${kept} / Skipped (no score) ${skipped} of ${pending.length} pending`)
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
