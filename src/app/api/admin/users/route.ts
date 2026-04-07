import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(users)
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const body = await req.json()

  // Reset password for a user
  if (body.userId && body.newPassword) {
    if (body.newPassword.length < 6) {
      return NextResponse.json({ error: 'Mot de passe trop court (min 6 caractères)' }, { status: 400 })
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
}
