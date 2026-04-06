import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { sendSubscriptionConfirmation, sendPaymentFailedEmail } from '@/lib/email'
import { normalizeLanguage } from '@/lib/utils'
import { logger } from '@/lib/logger'

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
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: s.customer as string },
          select: { email: true, name: true, preferredLanguage: true },
        })
        if (user) {
          const lang = normalizeLanguage(user.preferredLanguage)
          sendSubscriptionConfirmation(user.email, user.name ?? "", lang).catch(console.error)
        }
      } catch (e) {
        Sentry.captureException(e, { tags: { webhook: 'checkout.session.completed' } })
        logger.error('checkout.session.completed event failed', { route: '/api/stripe/webhook', error: String(e) })
      }
      break
    }
    case 'customer.subscription.updated': {
      try {
        const sub = event.data.object as any
        const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'inactive'
        await prisma.user.updateMany({ where: { subscriptionId: sub.id }, data: { subscriptionStatus: status } })
      } catch (e) {
        Sentry.captureException(e, { tags: { webhook: 'customer.subscription.updated' } })
        logger.error('customer.subscription.updated event failed', { route: '/api/stripe/webhook', error: String(e) })
      }
      break
    }
    case 'customer.subscription.deleted': {
      try {
        const sub = event.data.object as any
        await prisma.user.updateMany({ where: { subscriptionId: sub.id }, data: { subscriptionStatus: 'canceled', subscriptionId: null } })
      } catch (e) {
        Sentry.captureException(e, { tags: { webhook: 'customer.subscription.deleted' } })
        logger.error('customer.subscription.deleted event failed', { route: '/api/stripe/webhook', error: String(e) })
      }
      break
    }
    case 'invoice.payment_failed': {
      try {
        const invoice = event.data.object as any
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer as string },
          select: { email: true, name: true, preferredLanguage: true },
        })
        if (user) {
          const lang = normalizeLanguage(user.preferredLanguage)
          sendPaymentFailedEmail(user.email, user.name ?? "", lang).catch(console.error)
          logger.error('Payment failed for user', { route: '/api/stripe/webhook', email: user.email, invoiceId: invoice.id })
        }
      } catch (e) {
        Sentry.captureException(e, { tags: { webhook: 'invoice.payment_failed' } })
        logger.error('invoice.payment_failed event failed', { route: '/api/stripe/webhook', error: String(e) })
      }
      break
    }
    case 'invoice.paid': {
      try {
        const invoice = event.data.object as any
        // Ensure subscription stays active on successful renewal payments
        if (invoice.subscription) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: invoice.customer as string },
            data: { subscriptionStatus: 'active' },
          })
        }
        logger.info('Invoice paid successfully', { route: '/api/stripe/webhook', invoiceId: invoice.id, amount: invoice.amount_paid })
      } catch (e) {
        Sentry.captureException(e, { tags: { webhook: 'invoice.paid' } })
        logger.error('invoice.paid event failed', { route: '/api/stripe/webhook', error: String(e) })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
