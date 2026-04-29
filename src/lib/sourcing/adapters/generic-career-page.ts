import * as cheerio from 'cheerio'
import { proxyFetchHtml } from '../claude-proxy'
import type { SourceAdapter, ListingStub, GenericCareerPageConfig } from './types'

/** Generic adapter for "this employer's careers page" type sources.
 *  Drives every behaviour from the JobSource.config row so admin can add a
 *  new source via UI without touching code.
 *
 *  Strategy:
 *    1. Render the page in headless Chromium (so JS-driven career sites work).
 *    2. Find anchors matching either:
 *       - jobLinkSelector (CSS), if provided
 *       - jobLinkPattern (substring or regex on href), if provided
 *       - falls back to a heuristic that matches /careers/ /jobs/ /position/ /role/ paths
 *    3. Normalise to absolute URLs; de-dupe by URL.
 *
 *  The point: cover the long tail of small employer / hostel / packhouse
 *  pages with one adapter + per-source config, instead of writing 70 files. */

const HEURISTIC_RE = /\/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b/i

function toAbsolute(base: string, href: string): string | null {
  if (!href) return null
  if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function matchesPattern(href: string, pattern: string): boolean {
  // Try regex first (admin can pass /\/careers\/job-\d+/i style)
  try {
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      const last = pattern.lastIndexOf('/')
      const body = pattern.slice(1, last)
      const flags = pattern.slice(last + 1)
      return new RegExp(body, flags).test(href)
    }
  } catch {
    // fall through to substring
  }
  return href.includes(pattern)
}

export function buildGenericCareerPageAdapter(slug: string, label: string, config: GenericCareerPageConfig): SourceAdapter {
  return {
    slug,
    label,
    defaultCategory: config.defaultCategory,
    defaultState: config.defaultState,
    maxListings: config.maxListings ?? 30,

    async discover(): Promise<ListingStub[]> {
      if (!config.url) throw new Error(`Source ${slug} has no url configured`)
      const fetched = await proxyFetchHtml(config.url, 90_000)
      if (!fetched.ok || !fetched.html) {
        throw new Error(fetched.error || `fetch failed (HTTP ${fetched.status})`)
      }
      const $ = cheerio.load(fetched.html)
      const seen = new Set<string>()
      const out: ListingStub[] = []
      // Build the set of <a> we'll consider.
      const anchors = config.jobLinkSelector
        ? $(config.jobLinkSelector)
        : $('a[href]')
      anchors.each((_, el) => {
        const href = $(el).attr('href') || ''
        const absolute = toAbsolute(config.url, href)
        if (!absolute) return
        // Pattern filter (if configured) OR heuristic (fallback).
        if (config.jobLinkPattern) {
          if (!matchesPattern(absolute, config.jobLinkPattern)) return
        } else if (!config.jobLinkSelector) {
          // No explicit selector + no explicit pattern → use the heuristic so
          // we don't import every nav link on the page.
          if (!HEURISTIC_RE.test(absolute)) return
        }
        if (seen.has(absolute)) return
        seen.add(absolute)
        const title = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 140) || undefined
        out.push({ url: absolute, title })
      })
      return out
    },
  }
}
