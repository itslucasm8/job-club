// Per-source playbook learning module.
//
// Each source carries a playbook describing how to extract jobs from its
// pages — where each field lives, what to ignore, known errors. Two layers:
//
//   - Site playbook (SitePlaybook table): DOM-level rules shared across every
//     source on the same website. A fix learned on seek_fruit_picking
//     instantly benefits seek_kitchenhand, seek_cleaner, etc.
//   - Source playbook (JobSource.profile.playbook): per-source overrides
//     and search-specific rules.
//
// The runner consults the merged playbook before extracting. If the playbook
// produces all required fields → no LLM call (free). Otherwise the runner
// falls back to today's full Claude extraction. After every run, hit/miss
// counts update and recurring failures trigger an LLM-authored proposal.

import { createHash, randomBytes } from 'crypto'
import * as cheerio from 'cheerio'
import { prisma } from '@/lib/prisma'
import { proxyProposePlaybook, proxyFetchHtml, proxyExtract, proxyReassessEligibility } from './claude-proxy'
import type { ExtractionResult } from './extractor'
import { proxyResultToRaw } from './extractor'

// ─── Types ─────────────────────────────────────────────────────────────────

export type RuleKind = 'css_selector' | 'regex'
export type RuleStatus = 'candidate' | 'active'
export type RuleScope = 'site' | 'source'

export type Rule = {
  id: string
  kind: RuleKind
  expression: string
  successCount: number
  failureCount: number
  status: RuleStatus
  source: 'observed' | 'llm_proposed'
  scope: RuleScope
  createdAt: string
  promotedAt?: string
  lastFiredAt?: string
}

export type FieldName = 'title' | 'company' | 'pay' | 'location' | 'description'

export type FieldRules = Partial<Record<FieldName, Rule[]>>

export type KnownError = {
  pattern: string
  diagnosis: string
  action: 'skip' | 'flag_for_review'
}

export type LayoutFingerprint = { hash: string; capturedAt: string }

export type SitePlaybookData = {
  slug: string
  label: string
  version: number
  fieldRules: FieldRules
  ignorePatterns: string[]
  knownErrors: KnownError[]
  layoutFingerprint: LayoutFingerprint | null
}

export type SourcePlaybookData = {
  version: number
  updatedAt: string
  siteSlug?: string
  fieldRules: FieldRules
  ignorePatterns: string[]
  knownErrors: KnownError[]
}

export type EffectivePlaybook = {
  sourceSlug: string
  site: SitePlaybookData | null
  source: SourcePlaybookData
  // Merged rule lists: source rules first (more specific), then site rules.
  mergedFieldRules: FieldRules
  mergedIgnorePatterns: string[]
  mergedKnownErrors: KnownError[]
}

// What tryExtract returns to the runner.
export type TryExtractResult = {
  fields: Record<string, any>           // CandidateRaw-shaped subset
  missing: FieldName[]                  // required fields that didn't land
  rulesFired: RuleFiring[]              // for hit/miss accounting
}

export type RuleFiring = {
  field: FieldName
  ruleId: string
  scope: RuleScope
  hit: boolean                          // true = produced a non-empty value
  hitValue?: string                     // first 100 chars, for debug only
}

// REQUIRED fields a playbook must produce to claim success. If any is
// missing, the runner falls back to LLM. Mirrors ingest.ts validation.
const REQUIRED_FIELDS: FieldName[] = ['title', 'company', 'description']

// ─── Loading ───────────────────────────────────────────────────────────────

export async function loadEffectivePlaybook(sourceSlug: string): Promise<EffectivePlaybook> {
  const sourceRow = await prisma.jobSource.findUnique({
    where: { slug: sourceSlug },
    select: { siteSlug: true, profile: true },
  })

  const profile: any = (sourceRow?.profile && typeof sourceRow.profile === 'object') ? sourceRow.profile : {}
  const sourcePb: SourcePlaybookData = profile.playbook ?? {
    version: 0,
    updatedAt: new Date().toISOString(),
    fieldRules: {},
    ignorePatterns: [],
    knownErrors: [],
  }

  let site: SitePlaybookData | null = null
  if (sourceRow?.siteSlug) {
    const siteRow = await prisma.sitePlaybook.findUnique({ where: { slug: sourceRow.siteSlug } })
    if (siteRow) {
      site = {
        slug: siteRow.slug,
        label: siteRow.label,
        version: siteRow.version,
        fieldRules: (siteRow.fieldRules as any) ?? {},
        ignorePatterns: (siteRow.ignorePatterns as any) ?? [],
        knownErrors: (siteRow.knownErrors as any) ?? [],
        layoutFingerprint: (siteRow.layoutFingerprint as any) ?? null,
      }
    }
  }

  const mergedFieldRules: FieldRules = {}
  for (const f of ['title', 'company', 'pay', 'location', 'description'] as FieldName[]) {
    const fromSource = sourcePb.fieldRules?.[f] ?? []
    const fromSite = site?.fieldRules?.[f] ?? []
    // Source first (more specific), then site. Within each layer, active
    // before candidate, and within active, higher hit count first.
    const all = [...fromSource, ...fromSite]
    mergedFieldRules[f] = all.sort(rankRules)
  }

  return {
    sourceSlug,
    site,
    source: sourcePb,
    mergedFieldRules,
    mergedIgnorePatterns: [...sourcePb.ignorePatterns, ...(site?.ignorePatterns ?? [])],
    mergedKnownErrors: [...sourcePb.knownErrors, ...(site?.knownErrors ?? [])],
  }
}

function rankRules(a: Rule, b: Rule): number {
  const aActive = a.status === 'active' ? 1 : 0
  const bActive = b.status === 'active' ? 1 : 0
  if (aActive !== bActive) return bActive - aActive
  // Within same status, prefer rules with higher net hit count.
  const aNet = a.successCount - a.failureCount
  const bNet = b.successCount - b.failureCount
  return bNet - aNet
}

// ─── Extraction ────────────────────────────────────────────────────────────

export function tryExtract(merged: EffectivePlaybook, html: string, _url: string): TryExtractResult {
  const $ = cheerio.load(html)

  // Strip ignored regions before running rules.
  for (const sel of merged.mergedIgnorePatterns) {
    try { $(sel).remove() } catch {/* invalid selector — skip */}
  }

  // Cache the page's plain text once for regex rules.
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()

  const fields: Record<string, any> = {}
  const rulesFired: RuleFiring[] = []
  const missing: FieldName[] = []

  for (const field of ['title', 'company', 'pay', 'location', 'description'] as FieldName[]) {
    const rules = merged.mergedFieldRules[field] ?? []
    if (rules.length === 0) {
      if (REQUIRED_FIELDS.includes(field)) missing.push(field)
      continue
    }

    let landed = false
    for (const rule of rules) {
      const value = applyRule(rule, $, bodyText)
      const hit = !!value && value.length > 0
      rulesFired.push({
        field,
        ruleId: rule.id,
        scope: rule.scope,
        hit,
        hitValue: hit ? value!.slice(0, 100) : undefined,
      })
      if (hit && !landed) {
        fields[field] = value
        landed = true
        // Don't break — we want to record hit/miss for ALL rules in this run
        // so we have data to deprecate stale rules. But only the first hit
        // wins for the actual extracted value.
      }
    }
    if (!landed && REQUIRED_FIELDS.includes(field)) missing.push(field)
  }

  return { fields, missing, rulesFired }
}

function applyRule(rule: Rule, $: cheerio.CheerioAPI, bodyText: string): string | null {
  try {
    if (rule.kind === 'css_selector') {
      const el = $(rule.expression).first()
      if (el.length === 0) return null
      const text = el.text().replace(/\s+/g, ' ').trim()
      return text || null
    }
    if (rule.kind === 'regex') {
      const re = parseRegex(rule.expression)
      if (!re) return null
      const m = re.exec(bodyText)
      if (!m) return null
      return (m[1] ?? m[0]).trim() || null
    }
  } catch {
    return null
  }
  return null
}

function parseRegex(expression: string): RegExp | null {
  try {
    if (expression.startsWith('/') && expression.lastIndexOf('/') > 0) {
      const last = expression.lastIndexOf('/')
      return new RegExp(expression.slice(1, last), expression.slice(last + 1))
    }
    return new RegExp(expression)
  } catch {
    return null
  }
}

// ─── Layout fingerprint ───────────────────────────────────────────────────

// Hash of the page's structural skeleton — element-tree shape at depth ≤ 3.
// Stable across content changes (different jobs use the same template) but
// changes when the site redesigns. Used by the drift detector to decide
// when to ask Claude for a playbook refresh.
export function computeLayoutFingerprint(html: string): string {
  try {
    const $ = cheerio.load(html)
    const skeleton: string[] = []
    function walk(el: any, depth: number) {
      if (depth > 3) return
      const $el = $(el)
      const tag = el?.tagName
      if (!tag || tag === 'script' || tag === 'style') return
      // Capture tag + key data-attributes that identify template regions.
      const dataAuto = $el.attr('data-automation') || ''
      const role = $el.attr('role') || ''
      skeleton.push(`${'  '.repeat(depth)}${tag}${dataAuto ? `[da=${dataAuto}]` : ''}${role ? `[role=${role}]` : ''}`)
      $el.children().each((_: any, child: any) => walk(child, depth + 1))
    }
    $('body').children().each((_: any, el: any) => walk(el, 0))
    return createHash('sha256').update(skeleton.join('\n')).digest('hex').slice(0, 16)
  } catch {
    return 'fingerprint_error'
  }
}

// ─── Outcome accounting ───────────────────────────────────────────────────

export type ListingOutcome = {
  rulesFired: RuleFiring[]
  fingerprint?: string
}

export type RunOutcome = {
  sourceSlug: string
  listings: ListingOutcome[]
}

// Apply a run's outcomes back to the right playbook layer (site vs source)
// based on each rule's scope. Promotes candidates → active when they cross
// the threshold (successCount ≥ 5, no failures yet).
const PROMOTE_THRESHOLD = 5

export async function updateFromOutcome(outcome: RunOutcome): Promise<{
  siteRulesPromoted: number
  sourceRulesPromoted: number
}> {
  const playbook = await loadEffectivePlaybook(outcome.sourceSlug)
  const now = new Date().toISOString()

  // Aggregate hit/miss per rule id.
  const tallies = new Map<string, { hits: number; misses: number; scope: RuleScope }>()
  for (const listing of outcome.listings) {
    for (const fired of listing.rulesFired) {
      const cur = tallies.get(fired.ruleId) ?? { hits: 0, misses: 0, scope: fired.scope }
      if (fired.hit) cur.hits += 1
      else cur.misses += 1
      tallies.set(fired.ruleId, cur)
    }
  }

  let siteRulesPromoted = 0
  let sourceRulesPromoted = 0

  // Update source-level rules in place inside profile.playbook.
  const sourceUpdated = applyTalliesToFieldRules(playbook.source.fieldRules, tallies, 'source', now)
  sourceRulesPromoted = sourceUpdated.promoted

  // Update site-level rules in place inside SitePlaybook.fieldRules.
  let siteUpdated: { promoted: number; rules: FieldRules } | null = null
  if (playbook.site) {
    siteUpdated = applyTalliesToFieldRules(playbook.site.fieldRules, tallies, 'site', now)
    siteRulesPromoted = siteUpdated.promoted
  }

  // Persist updates.
  await prisma.jobSource.update({
    where: { slug: outcome.sourceSlug },
    data: {
      profile: {
        ...((await prisma.jobSource.findUnique({ where: { slug: outcome.sourceSlug }, select: { profile: true } }))?.profile as any || {}),
        playbook: { ...playbook.source, fieldRules: sourceUpdated.rules, version: playbook.source.version + (sourceRulesPromoted > 0 ? 1 : 0), updatedAt: now },
      },
    },
  })

  if (playbook.site && siteUpdated) {
    await prisma.sitePlaybook.update({
      where: { slug: playbook.site.slug },
      data: {
        fieldRules: siteUpdated.rules as any,
        version: playbook.site.version + (siteRulesPromoted > 0 ? 1 : 0),
      },
    })
  }

  return { siteRulesPromoted, sourceRulesPromoted }
}

function applyTalliesToFieldRules(
  rules: FieldRules,
  tallies: Map<string, { hits: number; misses: number; scope: RuleScope }>,
  expectedScope: RuleScope,
  now: string,
): { promoted: number; rules: FieldRules } {
  const out: FieldRules = {}
  let promoted = 0
  for (const field of Object.keys(rules) as FieldName[]) {
    const list = rules[field] ?? []
    out[field] = list.map(r => {
      const tally = tallies.get(r.id)
      if (!tally || tally.scope !== expectedScope) return r
      const next: Rule = {
        ...r,
        successCount: r.successCount + tally.hits,
        failureCount: r.failureCount + tally.misses,
        lastFiredAt: now,
      }
      if (next.status === 'candidate' && next.successCount >= PROMOTE_THRESHOLD && next.failureCount === 0) {
        next.status = 'active'
        next.promotedAt = now
        promoted += 1
      }
      return next
    })
  }
  return { promoted, rules: out }
}

// ─── Proposing updates via Claude ─────────────────────────────────────────

export type ProposalInput = {
  sourceSlug: string
  failureSamples: { url: string; failureTag: string; pageText: string }[]
  successSamples: { url: string; pageText: string; extracted: Record<string, any> }[]
}

export type Proposal = {
  diagnosis: string
  reasoning: string
  confidence: 'low' | 'medium' | 'high'
  siteUpdates?: {
    addRules?: Partial<Record<FieldName, Omit<Rule, 'id' | 'createdAt' | 'successCount' | 'failureCount' | 'status' | 'scope' | 'source'>[]>>
    addIgnorePatterns?: string[]
    addKnownErrors?: KnownError[]
  }
  sourceUpdates?: {
    addRules?: Partial<Record<FieldName, Omit<Rule, 'id' | 'createdAt' | 'successCount' | 'failureCount' | 'status' | 'scope' | 'source'>[]>>
    addIgnorePatterns?: string[]
    addKnownErrors?: KnownError[]
  }
}

export async function proposeUpdates(input: ProposalInput): Promise<Proposal | null> {
  const pb = await loadEffectivePlaybook(input.sourceSlug)
  try {
    return await proxyProposePlaybook({
      sourceSlug: input.sourceSlug,
      siteSlug: pb.site?.slug ?? null,
      currentSite: pb.site,
      currentSource: pb.source,
      failureSamples: input.failureSamples,
      successSamples: input.successSamples,
    })
  } catch (e) {
    console.error('[playbook] proposeUpdates failed', e)
    return null
  }
}

// Merge a proposal into the playbook. New rules land as 'candidate' and
// must accumulate successes before being promoted. Site updates write to
// SitePlaybook; source updates write to JobSource.profile.playbook.
export async function applyProposal(sourceSlug: string, proposal: Proposal): Promise<void> {
  const pb = await loadEffectivePlaybook(sourceSlug)
  const now = new Date().toISOString()

  if (proposal.sourceUpdates) {
    const merged = mergeUpdatesIntoPlaybook(pb.source, proposal.sourceUpdates, 'source', 'llm_proposed', now)
    const profile = ((await prisma.jobSource.findUnique({ where: { slug: sourceSlug }, select: { profile: true } }))?.profile as any) || {}
    await prisma.jobSource.update({
      where: { slug: sourceSlug },
      data: { profile: { ...profile, playbook: { ...merged, updatedAt: now } } },
    })
  }

  if (proposal.siteUpdates && pb.site) {
    const merged = mergeUpdatesIntoPlaybook(
      { version: pb.site.version, updatedAt: now, fieldRules: pb.site.fieldRules, ignorePatterns: pb.site.ignorePatterns, knownErrors: pb.site.knownErrors } as any,
      proposal.siteUpdates,
      'site',
      'llm_proposed',
      now,
    )
    await prisma.sitePlaybook.update({
      where: { slug: pb.site.slug },
      data: {
        fieldRules: merged.fieldRules as any,
        ignorePatterns: merged.ignorePatterns as any,
        knownErrors: merged.knownErrors as any,
      },
    })
  }
}

function mergeUpdatesIntoPlaybook(
  current: SourcePlaybookData,
  updates: NonNullable<Proposal['sourceUpdates']>,
  scope: RuleScope,
  source: 'observed' | 'llm_proposed',
  now: string,
): SourcePlaybookData {
  const fieldRules: FieldRules = { ...current.fieldRules }
  if (updates.addRules) {
    for (const [field, rules] of Object.entries(updates.addRules)) {
      if (!rules) continue
      const existing = fieldRules[field as FieldName] ?? []
      const additions: Rule[] = rules.map(r => ({
        id: 'r_' + randomBytes(6).toString('hex'),
        kind: r.kind,
        expression: r.expression,
        successCount: 0,
        failureCount: 0,
        status: 'candidate',
        source,
        scope,
        createdAt: now,
      }))
      fieldRules[field as FieldName] = [...existing, ...additions]
    }
  }
  return {
    ...current,
    fieldRules,
    ignorePatterns: dedupeStrings([...current.ignorePatterns, ...(updates.addIgnorePatterns ?? [])]),
    knownErrors: [...current.knownErrors, ...(updates.addKnownErrors ?? [])],
  }
}

function dedupeStrings(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

// ─── Runner helper: extract with playbook fallback ───────────────────────

export type PlaybookExtractionResult = {
  extraction: ExtractionResult
  outcome: ListingOutcome
  mode: 'playbook' | 'full' | 'failed'
}

// One-shot extraction that tries the playbook first and falls back to the
// full Claude pipeline on misses. Reuses the cached HTML for the fallback
// so we never pay for two fetches per listing.
export async function extractWithPlaybook(
  playbook: EffectivePlaybook,
  url: string,
): Promise<PlaybookExtractionResult> {
  let fetched
  try {
    fetched = await proxyFetchHtml(url, 60_000)
  } catch (e: any) {
    return {
      mode: 'failed',
      outcome: { rulesFired: [] },
      extraction: {
        extraction_failed: true,
        failure_reason: `fetch error: ${e?.message || String(e)}`,
        raw: { title: '', company: '', description: '' },
      },
    }
  }
  if (!fetched.ok || !fetched.html) {
    return {
      mode: 'failed',
      outcome: { rulesFired: [] },
      extraction: {
        extraction_failed: true,
        failure_reason: fetched.error || `fetch HTTP ${fetched.status}`,
        raw: { title: '', company: '', description: '' },
      },
    }
  }

  const html = fetched.html
  const text = fetched.text || ''
  const fingerprint = computeLayoutFingerprint(html)

  // Check known-error patterns first — if a "skip" rule fires, drop early.
  for (const ke of playbook.mergedKnownErrors) {
    if (ke.action === 'skip' && matchesKnownError(ke.pattern, text)) {
      return {
        mode: 'failed',
        outcome: { rulesFired: [], fingerprint },
        extraction: {
          extraction_failed: true,
          failure_reason: `known: ${ke.diagnosis}`,
          raw: { title: '', company: '', description: '' },
        },
      }
    }
  }

  // Try playbook-driven extraction.
  const tryResult = tryExtract(playbook, html, url)
  if (tryResult.missing.length === 0) {
    // Enrich with deterministic eligibility verdict (no LLM call). If the
    // proxy isn't reachable, fall back to using the bare playbook fields —
    // eligibility will be missing but extraction still succeeds.
    let raw: any = { ...tryResult.fields }
    try {
      const enriched = await proxyReassessEligibility(raw)
      raw = enriched
    } catch {/* swallow — degrade gracefully */}
    return {
      mode: 'playbook',
      outcome: { rulesFired: tryResult.rulesFired, fingerprint },
      extraction: {
        extraction_failed: false,
        failure_reason: '',
        raw,
        sourceText: text,
      },
    }
  }

  // Fall back to LLM, but reuse the cached page text.
  try {
    const data = await proxyExtract(url, text)
    if (data.extraction_failed) {
      return {
        mode: 'failed',
        outcome: { rulesFired: tryResult.rulesFired, fingerprint },
        extraction: {
          extraction_failed: true,
          failure_reason: data.failure_reason || 'unspecified',
          raw: { title: '', company: '', description: '' },
        },
      }
    }
    return {
      mode: 'full',
      outcome: { rulesFired: tryResult.rulesFired, fingerprint },
      extraction: {
        extraction_failed: false,
        failure_reason: '',
        raw: proxyResultToRaw(data),
        sourceText: text,
      },
    }
  } catch (e: any) {
    return {
      mode: 'failed',
      outcome: { rulesFired: tryResult.rulesFired, fingerprint },
      extraction: {
        extraction_failed: true,
        failure_reason: `Proxy error: ${e?.message || String(e)}`,
        raw: { title: '', company: '', description: '' },
      },
    }
  }
}

function matchesKnownError(pattern: string, text: string): boolean {
  try {
    const re = parseRegex(pattern)
    if (re) return re.test(text)
    return text.includes(pattern)
  } catch {
    return false
  }
}

// ─── Drift detection helper ───────────────────────────────────────────────

// Returns true if observed fingerprints diverge enough from the playbook's
// expected fingerprint that we should ask Claude to re-examine the layout.
export function isLayoutDrifting(playbook: EffectivePlaybook, observed: string[]): boolean {
  const expected = playbook.site?.layoutFingerprint?.hash
  if (!expected) return false
  if (observed.length < 3) return false
  const matching = observed.filter(h => h === expected).length
  return matching / observed.length < 0.5
}
