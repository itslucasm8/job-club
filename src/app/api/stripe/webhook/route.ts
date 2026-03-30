import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { sendSubscriptionConfirmation } from '@/lib/email'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  const stripe = getStripe()

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Webhook signature invalide' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      try {
        const s = event.data.object as any
        await prisma.user.updateMany({
          where: { stripeCustomerId: s.customer as string },
          data: { subscriptionStatus: 'active', subscriptionId: s.subscription as string },
        })
        // Send confirmation email
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: s.customer as string } })
        if (user) {
          sendSubscriptionConfirmation(user.email, user.name).catch(console.error)
        }
      } catch (e) {
        console.error('checkout.session.completed error:', e)
      }
      break
    }
    case 'customer.subscription.updated': {
      try {
        const sub = event.data.object as any
        const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'inactive'
        await prisma.user.updateMany({ where: { subscriptionId: sub.id }, data: { subscriptionStatus: status } })
      } catch (e) {
        console.error('customer.subscription.updated error:', e)
      }
      break
    }
    case 'customer.subscription.deleted': {
      try {
        const sub = event.data.object as any
        await prisma.user.updateMany({ where: { subscriptionId: sub.id }, data: { subscriptionStatus: 'canceled', subscriptionId: null } })
      } catch (e) {
        console.error('customer.subscription.deleted error:', e)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
