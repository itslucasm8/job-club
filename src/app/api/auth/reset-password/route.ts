import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'
import { passwordResetLimiter, getClientIP } from '@/lib/rate-limit'
import crypto from 'crypto'

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req)
    if (!passwordResetLimiter.check(ip)) {
      return NextResponse.json(
        { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
        { status: 429 }
      )
    }

    const body = await req.json()
    const { email } = body

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Email valide requis' },
        { status: 400 }
      )
    }

    // Generate random token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Store token
    await prisma.passwordReset.create({
      data: {
        email,
        token,
        expiresAt,
      },
    })

    // Send email
    const resetUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/reset-password?token=${token}`
    sendPasswordResetEmail(email, resetUrl).catch(console.error)

    // Always return success to prevent email enumeration
    return NextResponse.json(
      { message: 'Un email a été envoyé si ce compte existe' },
      { status: 200 }
    )
  } catch (e) {
    console.error('POST /api/auth/reset-password error:', e)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}
