import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeExtensionRequest } from '@/lib/extension-auth'

/** POST /api/extension/heartbeat
 *  Body: {
 *    runId?: string                                  // extension's local id; we use cuid otherwise
 *    triggeredBy?: 'scheduled' | 'manual' | string
 *    completed: boolean                              // false = run started; true = run finished
 *    groupRuns?: [{ sourceSlug, postsCaptured, scrollDuration, error? }]
 *    errorMessage?: string
 *  }
 *
 *  Records a row in ExtensionRun so /admin/extensions can show "last ran X
 *  minutes ago, scraped Y posts across Z groups". The endpoint is idempotent
 *  on runId — sending the same runId twice updates the existing row rather
 *  than creating a new one.
 */
export async function POST(req: Request) {
  const auth = await authorizeExtensionRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const completed = !!body?.completed
  const triggeredBy = String(body?.triggeredBy || (auth.via === 'session' ? auth.userEmail : 'scheduled'))
  const groupRuns = Array.isArray(body?.groupRuns) ? body.groupRuns : []
  const errorMessage = body?.errorMessage ? String(body.errorMessage).slice(0, 500) : null

  const totalPosts = groupRuns.reduce((acc: number, g: any) => acc + (Number(g?.postsCaptured) || 0), 0)
  const totalErrors = groupRuns.reduce((acc: number, g: any) => acc + (g?.error ? 1 : 0), 0)

  const runId = String(body?.runId || '').trim()
  if (runId) {
    const existing = await prisma.extensionRun.findUnique({ where: { id: runId } }).catch(() => null)
    if (existing) {
      const updated = await prisma.extensionRun.update({
        where: { id: runId },
        data: {
          completedAt: completed ? new Date() : null,
          totalPosts,
          totalErrors,
          groupRuns: groupRuns as any,
          errorMessage,
        },
      })
      return NextResponse.json({ ok: true, run: updated })
    }
  }

  const created = await prisma.extensionRun.create({
    data: {
      ...(runId ? { id: runId } : {}),
      completedAt: completed ? new Date() : null,
      totalPosts,
      totalErrors,
      groupRuns: groupRuns as any,
      triggeredBy,
      errorMessage,
    },
  })
  return NextResponse.json({ ok: true, run: created })
}
