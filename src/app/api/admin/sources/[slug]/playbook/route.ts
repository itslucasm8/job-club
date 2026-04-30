import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadEffectivePlaybook } from '@/lib/sourcing/playbook'

/** Returns the source's effective playbook — merged site + source layers
 *  with each rule labelled by scope so the admin UI can show what's
 *  inherited from the website vs source-specific. Read-only.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }
  try {
    const pb = await loadEffectivePlaybook(params.slug)
    return NextResponse.json(pb)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}
