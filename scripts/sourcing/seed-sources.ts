import { prisma } from '../../src/lib/prisma'
import { SOURCES } from '../../src/lib/sourcing/sources'

async function main() {
  for (const src of SOURCES) {
    await prisma.jobSource.upsert({
      where: { slug: src.slug },
      create: {
        slug: src.slug,
        label: src.label,
        category: src.category,
        enabled: src.enabled,
      },
      update: {
        label: src.label,
        category: src.category,
      },
    })
    console.log(`[seed-sources] upserted ${src.slug}`)
  }
  console.log(`[seed-sources] done. ${SOURCES.length} sources.`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
