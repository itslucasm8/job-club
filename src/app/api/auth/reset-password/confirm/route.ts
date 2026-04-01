import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { token, password } = body

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token et mot de passe requis' },
        { status: 400 }
      )
    }

    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Le mot de passe doit contenir au moins 8 caractères' },
        { status: 400 }
      )
    }

    // Find reset token
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token },
    })

    if (!resetRecord) {
      return NextResponse.json(
        { error: 'Lien de réinitialisation invalide' },
        { status: 400 }
      )
    }

    if (resetRecord.used) {
      return NextResponse.json(
        { error: 'Ce lien a déjà été utilisé' },
        { status: 400 }
      )
    }

    if (new Date() > resetRecord.expiresAt) {
      return NextResponse.json(
        { error: 'Ce lien a expiré' },
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
      { message: 'Mot de passe réinitialisé avec succès' },
      { status: 200 }
    )
  } catch (e) {
    console.error('POST /api/auth/reset-password/confirm error:', e)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}
