import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Generate / regenerate / revoke the extension bearer token for the
 *  current admin user. The token is stored on User.extensionToken and
 *  authenticates the FB-group browser extension.
 *
 *  POST   → generate a new token (replaces any existing)
 *  DELETE → revoke (set to null)
 *  GET    → return whether a token exists (NEVER returns the token itself
 *           — only the POST response shows it once at generation time)
 */

async function adminUser(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') return null
  return { id: (session.user as any).id, email: session.user!.email! }
}

export async function GET() {
  const user = await adminUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { extensionToken: true },
  })
  return NextResponse.json({ hasToken: !!row?.extensionToken })
}

export async function POST() {
  const user = await adminUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  // 48 random bytes → 64 hex chars. Plenty of entropy; stored as-is.
  const token = randomBytes(48).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: { extensionToken: token },
  })
  // Return the token ONCE — admin must copy now, we don't surface it again.
  return NextResponse.json({ token, message: "Copiez ce token maintenant — il ne sera plus affiché." })
}

export async function DELETE() {
  const user = await adminUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  await prisma.user.update({
    where: { id: user.id },
    data: { extensionToken: null },
  })
  return NextResponse.json({ ok: true })
}
