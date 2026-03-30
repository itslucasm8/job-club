import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createJobSchema, getFirstValidationError } from '@/lib/validation'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUnique({ where: { id: params.id } })
  if (!job) return NextResponse.json({ error: 'Offre introuvable' }, { status: 404 })
  return NextResponse.json(job)
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }
  await prisma.job.update({ where: { id: params.id }, data: { active: false } })
  return NextResponse.json({ ok: true })
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const data = await req.json()
  const result = createJobSchema.partial().safeParse(data)

  if (!result.success) {
    return NextResponse.json(
      { error: getFirstValidationError(result.error) },
      { status: 400 }
    )
  }

  const job = await prisma.job.update({
    where: { id: params.id },
    data: result.data,
  })
  return NextResponse.json(job)
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const job = await prisma.job.update({
    where: { id: params.id },
    data: { active: true },
  })
  return NextResponse.json(job)
}
