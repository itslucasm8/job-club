import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Webhook signature invalide' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as any
      await prisma.user.updateMany({
        where: { stripeCustomerId: s.customer as string },
        data: { subscriptionStatus: 'active', subscriptionId: s.subscription as string },
      })
      break
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as any
      const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'inactive'
      await prisma.user.updateMany({ where: { subscriptionId: sub.id }, data: { subscriptionStatus: status } })
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as any
      await prisma.user.updateMany({ where: { subscriptionId: sub.id }, data: { subscriptionStatus: 'canceled', subscriptionId: null } })
      break
    }
  }

  return NextResponse.json({ received: true })
}
