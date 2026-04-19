/**
 * Inventory Podia subscribers
 *
 * Queries live Stripe for all active + past_due subscriptions tagged
 * as Podia-managed, and writes the cohort to out/podia-cohort.json.
 *
 * Safe to run anytime — pure read, no writes to Stripe or DB.
 *
 * Usage:
 *   STRIPE_SECRET_KEY="sk_live_..." npx tsx scripts/inventory-podia.ts
 *
 * Output:
 *   out/podia-cohort.json — array of { customerId, email, name, subscriptionId,
 *                                       priceId, status, currentPeriodEnd, planType }
 *
 * Expected count on 2026-04-19: 37 (23 monthly + 14 yearly).
 */

import Stripe from 'stripe'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const stripeKey = process.env.STRIPE_SECRET_KEY
if (!stripeKey) {
  console.error('✗ STRIPE_SECRET_KEY is not set. Run with: STRIPE_SECRET_KEY="sk_live_..." npx tsx scripts/inventory-podia.ts')
  process.exit(1)
}

const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' as any })

type CohortRow = {
  customerId: string
  email: string | null
  name: string | null
  subscriptionId: string
  priceId: string
  status: string
  currentPeriodEnd: number
  planType: 'monthly' | 'yearly' | 'unknown'
}

async function fetchByStatus(status: 'active' | 'past_due'): Promise<CohortRow[]> {
  const rows: CohortRow[] = []

  for await (const sub of stripe.subscriptions.list({
    status,
    limit: 100,
    expand: ['data.customer', 'data.items.data.price'],
  })) {
    const item = sub.items.data[0]
    if (!item) continue

    const price = item.price
    if (price.metadata?.managed_by !== 'Podia') continue

    const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer
    const customerId = typeof sub.customer === 'string' ? sub.customer : customer.id
    const email = 'email' in customer ? customer.email : null
    const name = 'name' in customer ? customer.name : null

    const interval = price.recurring?.interval
    const planType: CohortRow['planType'] =
      interval === 'month' ? 'monthly' : interval === 'year' ? 'yearly' : 'unknown'

    rows.push({
      customerId,
      email,
      name,
      subscriptionId: sub.id,
      priceId: price.id,
      status: sub.status,
      currentPeriodEnd: (item as any).current_period_end,
      planType,
    })
  }

  return rows
}

async function main() {
  console.log('Fetching Podia subscribers from Stripe...\n')

  const active = await fetchByStatus('active')
  const pastDue = await fetchByStatus('past_due')
  const all = [...active, ...pastDue]

  const outDir = path.join(process.cwd(), 'out')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'podia-cohort.json')
  writeFileSync(outPath, JSON.stringify(all, null, 2))

  const monthly = all.filter((r) => r.planType === 'monthly')
  const yearly = all.filter((r) => r.planType === 'yearly')
  const missingEmail = all.filter((r) => !r.email)
  const unknownPlan = all.filter((r) => r.planType === 'unknown')

  console.log('── Summary ──')
  console.log(`Total Podia subscribers:  ${all.length}`)
  console.log(`  Monthly:                ${monthly.length}`)
  console.log(`  Yearly:                 ${yearly.length}`)
  if (unknownPlan.length > 0) console.log(`  Unknown interval:       ${unknownPlan.length}  (flagged)`)
  console.log(`  status=active:          ${active.length}`)
  console.log(`  status=past_due:        ${pastDue.length}`)

  if (missingEmail.length > 0) {
    console.log(`\n⚠ Missing email on ${missingEmail.length} customer(s) — manual review needed:`)
    for (const row of missingEmail) {
      console.log(`  - ${row.customerId} (sub ${row.subscriptionId})`)
    }
  }

  console.log(`\n✓ Written to: ${outPath}`)
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message || err)
  process.exit(1)
})
