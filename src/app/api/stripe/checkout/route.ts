import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { id: (session.user as any).id } })
  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Determine which plan was selected (monthly or yearly)
  let plan = 'monthly'
  try {
    const body = await req.json()
    if (body.plan === 'yearly') plan = 'yearly'
  } catch {
    // Default to monthly if no body provided
  }

  const priceId = plan === 'yearly'
    ? process.env.STRIPE_PRICE_ID_YEARLY!
    : process.env.STRIPE_PRICE_ID!

  const stripe = getStripe()

  let customerId = user.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })
    customerId = customer.id
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } })
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/feed?subscribed=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/subscribe?canceled=true`,
  })

  return NextResponse.json({ url: checkoutSession.url })
}
