/**
 * Single source of truth for candidate-rejection reasons.
 *
 * Both the admin UI dropdown and the reject API validator import from here,
 * so adding/removing/renaming a reason is one edit instead of two
 * (previously the list lived in admin/candidates/page.tsx with no server
 * validation — admin could send any free-text "reason" string up to 200
 * chars and the server would store it verbatim).
 *
 * Labels stay English: rejectReason is only displayed in admin contexts
 * (the admin candidates list and the per-source analytics drilldown).
 * Subscribers never see it, so French translation isn't needed today.
 */

export const REJECT_REASONS = [
  'Locals only',
  'Not WHV-friendly',
  'Suspected scam',
  'Not enough info',
  'Duplicate',
  'Out of geo',
  'Wrong category',
  'Other',
] as const

export type RejectReason = typeof REJECT_REASONS[number]

const REJECT_SET: Set<string> = new Set(REJECT_REASONS)

/** Returns the input if it's a known reason, else null. Free-text reasons
 *  used to flow through; we now require the canonical enum so analytics
 *  on rejection patterns aren't muddied by typos. */
export function normalizeRejectReason(value: unknown): RejectReason | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return REJECT_SET.has(trimmed) ? (trimmed as RejectReason) : null
}
