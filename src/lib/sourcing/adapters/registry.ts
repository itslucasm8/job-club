import { prisma } from '@/lib/prisma'
import type { SourceAdapter, GenericCareerPageConfig } from './types'
import { workforceAustraliaAdapter } from './workforce-australia'
import { harvestTrailAdapter } from './harvest-trail'
import { buildGenericCareerPageAdapter } from './generic-career-page'

/** Static (code-defined) adapters. These have specific-site logic and live
 *  in their own files. Adding a new specific adapter = new file + entry here. */
const STATIC_ADAPTERS: Record<string, SourceAdapter> = {
  [workforceAustraliaAdapter.slug]: workforceAustraliaAdapter,
  [harvestTrailAdapter.slug]: harvestTrailAdapter,
}

/** Look up an adapter by slug. Returns null if unknown. Generic adapters are
 *  built dynamically from JobSource.config — that requires a DB hit, so the
 *  sync version only sees the static ones. Use getAdapterAsync when iterating
 *  over JobSource rows. */
export function getAdapter(slug: string): SourceAdapter | null {
  return STATIC_ADAPTERS[slug] ?? null
}

/** Resolve a slug to its adapter, including generic ones built from
 *  JobSource.config. Throws if unknown. */
export async function getAdapterAsync(slug: string): Promise<SourceAdapter> {
  const stat = STATIC_ADAPTERS[slug]
  if (stat) return stat
  const row = await prisma.jobSource.findUnique({ where: { slug } })
  if (!row) throw new Error(`Unknown source: ${slug}`)
  if (row.adapter === 'generic_career_page') {
    const config = (row.config as unknown as GenericCareerPageConfig) || ({} as GenericCareerPageConfig)
    return buildGenericCareerPageAdapter(slug, row.label, config)
  }
  throw new Error(`Source ${slug} has no runnable adapter (adapter=${row.adapter ?? 'null'})`)
}

/** Resolve a list of slugs to adapters, in order. Drops unknown slugs silently
 *  rather than failing the whole run. */
export function listAdaptersForSlugs(slugs: string[]): SourceAdapter[] {
  // Static-only sync version. Async resolution happens in executeRun via DB
  // calls when we need generic adapters.
  return slugs.map(s => STATIC_ADAPTERS[s]).filter((a): a is SourceAdapter => !!a)
}

/** Sync helper that ALSO resolves generic adapters by hitting the DB once. */
export async function listAdaptersForSlugsAsync(slugs: string[]): Promise<SourceAdapter[]> {
  const out: SourceAdapter[] = []
  for (const slug of slugs) {
    try {
      out.push(await getAdapterAsync(slug))
    } catch {
      // skip unknown
    }
  }
  return out
}
