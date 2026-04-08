import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe'
import { logger } from '@/lib/logger'

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, stripeCustomerId: true, subscriptionId: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    }

    // Verify password for confirmation
    const body = await req.json().catch(() => ({}))
    if (!body.password) {
      return NextResponse.json({ error: 'PASSWORD_REQUIRED' }, { status: 400 })
    }

    const fullUser = await prisma.user.findUnique({ where: { id: userId } })
    if (!fullUser) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    }

    const bcrypt = await import('bcryptjs')
    const valid = await bcrypt.compare(body.password, fullUser.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'WRONG_PASSWORD' }, { status: 401 })
    }

    // Cancel Stripe subscription if active
    if (user.subscriptionId) {
      try {
        const stripe = getStripe()
        await stripe.subscriptions.cancel(user.subscriptionId)
      } catch (e) {
        // Log but don't block deletion — subscription may already be canceled
        logger.error('Failed to cancel Stripe subscription during account deletion', {
          route: '/api/user/delete',
          userId: user.id,
          error: String(e),
        })
      }
    }

    // Clean up password reset tokens (linked by email, not FK)
    await prisma.passwordReset.deleteMany({ where: { email: user.email } })

    // Delete user (cascades to SavedJob + Notification via schema)
    await prisma.user.delete({ where: { id: userId } })

    logger.info('User account deleted', {
      route: '/api/user/delete',
      userId: user.id,
      email: user.email,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'user-delete' } })
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
