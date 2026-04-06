/**
 * Bulk Job Import Script
 *
 * Usage:
 *   npx tsx scripts/import-jobs.ts --input jobs.csv
 *   npx tsx scripts/import-jobs.ts --input jobs.csv --dry-run
 *
 * CSV format (first row = headers):
 *   title,company,state,location,category,type,pay,description,sourceUrl
 *
 * Required columns: title, company, state, location, category, description
 * Optional columns: type (defaults to "casual"), pay, sourceUrl
 *
 * Valid states: QLD, NSW, VIC, SA, WA, TAS, NT, ACT
 * Valid categories: farm, hospitality, construction, trade, retail, cleaning, other
 * Valid types: casual, full_time, part_time, contract
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'trade', 'retail', 'cleaning', 'other']
const VALID_TYPES = ['casual', 'full_time', 'part_time', 'contract']

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n')
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row')

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = []
    let current = ''
    let inQuotes = false

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())

    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })
    rows.push(row)
  }

  return rows
}

function validateRow(row: Record<string, string>, index: number): string | null {
  if (!row.title) return `Row ${index}: missing title`
  if (!row.company) return `Row ${index}: missing company`
  if (!row.state || !VALID_STATES.includes(row.state.toUpperCase())) {
    return `Row ${index}: invalid state "${row.state}" — must be one of: ${VALID_STATES.join(', ')}`
  }
  if (!row.category || !VALID_CATEGORIES.includes(row.category.toLowerCase())) {
    return `Row ${index}: invalid category "${row.category}" — must be one of: ${VALID_CATEGORIES.join(', ')}`
  }
  if (row.type && !VALID_TYPES.includes(row.type.toLowerCase())) {
    return `Row ${index}: invalid type "${row.type}" — must be one of: ${VALID_TYPES.join(', ')}`
  }
  if (!row.description) return `Row ${index}: missing description`
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const inputIdx = args.indexOf('--input')
  const dryRun = args.includes('--dry-run')

  if (inputIdx === -1 || !args[inputIdx + 1]) {
    console.error('Usage: npx tsx scripts/import-jobs.ts --input jobs.csv [--dry-run]')
    process.exit(1)
  }

  const inputPath = resolve(args[inputIdx + 1])
  console.log(`Reading: ${inputPath}`)

  const content = readFileSync(inputPath, 'utf-8')
  const rows = parseCSV(content)
  console.log(`Found ${rows.length} jobs in CSV`)

  // Validate all rows first
  const errors: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const err = validateRow(rows[i], i + 2) // +2 because row 1 is headers, data starts at row 2
    if (err) errors.push(err)
  }

  if (errors.length > 0) {
    console.error('\nValidation errors:')
    errors.forEach(e => console.error(`  ✗ ${e}`))
    process.exit(1)
  }

  console.log('All rows valid ✓')

  if (dryRun) {
    console.log('\n[DRY RUN] Would import:')
    rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.title} — ${row.company} (${row.state}, ${row.category})`)
    })
    console.log(`\nRun without --dry-run to import.`)
    return
  }

  const prisma = new PrismaClient()

  try {
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    const jobs = rows.map(row => ({
      title: row.title,
      company: row.company,
      state: row.state.toUpperCase(),
      location: row.location || '',
      category: row.category.toLowerCase(),
      type: row.type?.toLowerCase() || 'casual',
      pay: row.pay || null,
      description: row.description,
      sourceUrl: row.sourceUrl || null,
      active: true,
      expiresAt: thirtyDaysFromNow,
    }))

    const result = await prisma.job.createMany({ data: jobs })
    console.log(`\n✓ Imported ${result.count} jobs successfully!`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error('Import failed:', e.message)
  process.exit(1)
})
