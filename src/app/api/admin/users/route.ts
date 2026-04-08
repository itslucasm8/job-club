import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import * as Sentry from '@sentry/nextjs'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(users)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-users', method: 'GET' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const { email, password, name } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe trop court (min 8 caractères)' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Un compte avec cet email existe déjà' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
        role: 'admin',
        subscriptionStatus: 'active',
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    })

    return NextResponse.json(user)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-users', method: 'POST' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const body = await req.json()

    // Reset password for a user
    if (body.userId && body.newPassword) {
      if (body.newPassword.length < 8) {
        return NextResponse.json({ error: 'Mot de passe trop court (min 8 caractères)' }, { status: 400 })
      }
      const passwordHash = await bcrypt.hash(body.newPassword, 12)
      await prisma.user.update({
        where: { id: body.userId },
        data: { passwordHash },
      })
      return NextResponse.json({ success: true })
    }

    // Promote user to admin by email
    if (body.email && body.promoteToAdmin) {
      const user = await prisma.user.findUnique({ where: { email: body.email } })
      if (!user) {
        return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
      }
      if (user.role === 'admin') {
        return NextResponse.json({ error: 'Déjà administrateur' }, { status: 400 })
      }
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'admin' },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      })
      return NextResponse.json(updated)
    }

    // Change role
    const { userId, role } = body
    if (!userId || !['admin', 'user'].includes(role)) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, name: true, role: true },
    })

    return NextResponse.json(updated)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-users', method: 'PATCH' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
