import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { registerSchema, getFirstValidationError } from '@/lib/validation'
import { sendWelcomeEmail } from '@/lib/email'
import { normalizeLanguage } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { registerLimiter, getClientIP } from '@/lib/rate-limit'

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req)
    if (!registerLimiter.check(ip)) {
      logger.warn('Rate limit exceeded on register', { route: '/api/register', ip })
      return NextResponse.json({ error: 'RATE_LIMIT' }, { status: 429 })
    }

    const body = await req.json()

    // Validate with Zod
    const result = registerSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: getFirstValidationError(result.error) }, { status: 400 })
    }

    const { email, password, name } = result.data
    const lang = normalizeLanguage(body.preferredLanguage)

    // Check if email is already in use
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'EMAIL_EXISTS' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { email, passwordHash, name, preferredLanguage: lang },
    })

    // Send welcome email (fire and forget)
    sendWelcomeEmail(user.email, user.name || '', lang).catch(console.error)

    return NextResponse.json({ id: user.id, email: user.email }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e)
    logger.error('POST /api/register failed', { route: '/api/register', error: String(e) })
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
