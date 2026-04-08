import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { token, password } = body

    if (!token || !password) {
      return NextResponse.json(
        { error: 'TOKEN_PASSWORD_REQUIRED' },
        { status: 400 }
      )
    }

    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'PASSWORD_TOO_SHORT' },
        { status: 400 }
      )
    }

    // Find reset token
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token },
    })

    if (!resetRecord) {
      return NextResponse.json(
        { error: 'INVALID_LINK' },
        { status: 400 }
      )
    }

    if (resetRecord.used) {
      return NextResponse.json(
        { error: 'LINK_ALREADY_USED' },
        { status: 400 }
      )
    }

    if (new Date() > resetRecord.expiresAt) {
      return NextResponse.json(
        { error: 'LINK_EXPIRED' },
        { status: 400 }
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Update user password
    await prisma.user.update({
      where: { email: resetRecord.email },
      data: { passwordHash },
    })

    // Mark token as used
    await prisma.passwordReset.update({
      where: { token },
      data: { used: true },
    })

    return NextResponse.json(
      { message: 'OK' },
      { status: 200 }
    )
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'reset-password-confirm' } })
    return NextResponse.json(
      { error: 'SERVER_ERROR' },
      { status: 500 }
    )
  }
}
