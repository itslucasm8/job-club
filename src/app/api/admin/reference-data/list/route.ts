import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { proxyListReferenceData, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }
  if (!isProxyConfigured()) {
    return NextResponse.json({ error: 'Claude proxy non configuré' }, { status: 503 })
  }
  try {
    const out = await proxyListReferenceData()
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur serveur' }, { status: 500 })
  }
}
