import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { id: (session.user as any).id } })
  if (!user?.stripeCustomerId) {
    return NextResponse.json({ error: 'Pas d\'abonnement trouvé' }, { status: 400 })
  }

  const stripe = getStripe()
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.NEXTAUTH_URL}/profile`,
  })

  return NextResponse.json({ url: portalSession.url })
}
