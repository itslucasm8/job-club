import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export type ExtensionAuthResult =
  | { ok: true; userId: string; userEmail: string; via: 'session' | 'token' }
  | { ok: false; status: number; error: string }

/** Auth gate for the /api/extension/* endpoints. Accepts either a logged-in
 *  admin session (so you can curl with a cookie or hit it from the admin UI)
 *  OR a `Authorization: Bearer <token>` header that matches a User's
 *  extensionToken. The bearer path is what the Chrome extension uses from
 *  outside the normal session — a long-lived token issued from /admin/extensions.
 */
export async function authorizeExtensionRequest(req: Request): Promise<ExtensionAuthResult> {
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (!token || token.length < 32) {
      return { ok: false, status: 401, error: 'Token invalide' }
    }
    const user = await prisma.user.findUnique({
      where: { extensionToken: token },
      select: { id: true, email: true, role: true },
    })
    if (!user) return { ok: false, status: 401, error: 'Token inconnu' }
    if (user.role !== 'admin') return { ok: false, status: 403, error: 'Token non-admin' }
    return { ok: true, userId: user.id, userEmail: user.email, via: 'token' }
  }

  const session = await getServerSession(authOptions)
  if (session && (session.user as any).role === 'admin') {
    return {
      ok: true,
      userId: (session.user as any).id,
      userEmail: session.user!.email!,
      via: 'session',
    }
  }
  return { ok: false, status: 401, error: 'Authentification requise (session admin ou token)' }
}
