import { NextResponse } from 'next/server'

/** Verify cron bearer token. Returns null on success, NextResponse on failure.
 *
 *  Requires CRON_SECRET to be set explicitly — no NEXTAUTH_SECRET fallback.
 *  The session-signing key must never double as an HTTP token: leaking it via
 *  cron logs (which contain the curl command line) would let an attacker
 *  forge any user's JWT session. CRON_SECRET is rotated independently. */
export function verifyCronAuth(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    // Fail loudly — server misconfiguration. Returning 500 (not 401) makes
    // the alarm visible: the cron caller will see "internal error" instead
    // of "unauthorized" and know it's not their fault.
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 500 }
    )
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
