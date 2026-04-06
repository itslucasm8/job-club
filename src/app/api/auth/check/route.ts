import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authLimiter } from '@/lib/rate-limit'

export async function POST(req: Request) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Remplis tous les champs' }, { status: 400 })
  }

  if (!authLimiter.check(email)) {
    return NextResponse.json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' }, { status: 429 })
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    return NextResponse.json({ error: 'Aucun compte trouvé avec cet email' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
