import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createJobNotifications } from '@/lib/notifications'
import { logger } from '@/lib/logger'

// Legacy fallback only — `raw.eligibility_88_days` from the eligibility module
// is the deterministic source of truth and used first below.
function detect88DaysFallback(title: string, description: string): boolean {
  const text = `${title} ${description}`
  return /88[\s-]?days|88[\s-]?jours|second[\s-]?year[\s-]?visa|2nd[\s-]?year[\s-]?visa|subclass[\s-]?417|specified[\s-]?work|visa[\s-]?extension|whv[\s-]?eligible/i.test(text)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const overrides = await req.json().catch(() => ({}))
    const candidate = await prisma.jobCandidate.findUnique({ where: { id: params.id } })
    if (!candidate) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const raw = (candidate.rawData as any) || {}
    const title = overrides.title ?? raw.title
    const company = overrides.company ?? raw.company
    const state = overrides.state ?? raw.state ?? null
    const location = overrides.location ?? raw.location ?? ''
    const category = overrides.category ?? raw.category ?? 'other'
    const type = overrides.type ?? raw.type ?? 'casual'
    const pay = overrides.pay ?? raw.pay ?? null
    const description = overrides.description ?? raw.description
    const applyUrl = overrides.applyUrl ?? raw.applyUrl ?? null
    const sourceUrl = overrides.sourceUrl ?? candidate.sourceUrl
    // C-9: prefer the deterministic verdict from the eligibility module over
    // the brittle regex. Fallback regex only fires when the verdict is absent.
    const eligible88Days =
      overrides.eligible88Days ??
      (raw.eligibility_88_days === true ? true :
        raw.eligibility_88_days === false ? false :
          raw.eligible88Days ?? detect88DaysFallback(title, description))

    if (!title || !company || !description) {
      return NextResponse.json({ error: 'Champs manquants (title/company/description)' }, { status: 400 })
    }
    if (!state) {
      return NextResponse.json({ error: 'State manquant — édite la candidature pour préciser un state avant d\'approuver' }, { status: 400 })
    }

    const eligibilityData = {
      eligibility_88_days: raw.eligibility_88_days ?? null,
      eligibility_reason: raw.eligibility_reason ?? null,
      eligibility_confidence: raw.eligibility_confidence ?? null,
      industry: raw.industry ?? null,
      postcode: raw.postcode ?? null,
      award_id: raw.award_id ?? null,
      award_name: raw.award_name ?? null,
      award_min_hourly: raw.award_min_hourly ?? null,
      award_min_casual_hourly: raw.award_min_casual_hourly ?? null,
      pay_parsed_hourly: raw.pay_parsed_hourly ?? null,
      pay_kind: raw.pay_kind ?? null,
      pay_status: raw.pay_status ?? null,
      pay_gap: raw.pay_gap ?? null,
      pay_gap_pct: raw.pay_gap_pct ?? null,
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const reviewedBy = (session.user as any).id || (session.user as any).email

    // C-1 + C-2 + C-3: atomic approve. The status check, Job insert, candidate
    // update, and source counter bump all run inside one transaction so a
    // partial failure can't leave a public Job orphaned with a pending
    // candidate (which the previous code did → next click created a duplicate
    // Job). Two parallel approve clicks now race inside the DB instead of in
    // application code: the second one re-reads the row, sees status='approved'
    // and the unique sourceUrl constraint, and bails cleanly.
    let job
    try {
      job = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction so the status check sees what's
        // actually in the DB at the moment of write, not what was true when the
        // request started (TOCTOU-safe).
        const fresh = await tx.jobCandidate.findUnique({ where: { id: params.id } })
        if (!fresh) {
          throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' })
        }
        if (fresh.status === 'approved' && fresh.promotedJobId) {
          throw Object.assign(new Error('already_approved'), {
            code: 'ALREADY_APPROVED',
            jobId: fresh.promotedJobId,
          })
        }

        const created = await tx.job.create({
          data: {
            title, company, state, location, category, type,
            pay: pay || null,
            description,
            applyUrl: applyUrl || null,
            sourceUrl: sourceUrl || null,
            eligible88Days,
            eligibilityData,
            expiresAt,
          },
        })

        await tx.jobCandidate.update({
          where: { id: fresh.id },
          data: {
            status: 'approved',
            promotedJobId: created.id,
            reviewedAt: new Date(),
            reviewedBy,
          },
        })

        await tx.jobSource.update({
          where: { slug: fresh.source },
          data: { totalApproved: { increment: 1 } },
        }).catch(() => {/* source row may not exist for legacy 'manual' candidates */})

        return created
      })
    } catch (e: any) {
      if (e?.code === 'ALREADY_APPROVED') {
        return NextResponse.json({ error: 'Déjà approuvée', jobId: e.jobId }, { status: 409 })
      }
      if (e?.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
      }
      // P2002 = unique constraint violation. Triggered by the new
      // Job_sourceUrl_unique partial index when the same URL was approved
      // from a different candidate (e.g. extension + scraper for the same
      // listing). Tell the admin so they can mark the duplicate candidate
      // rejected instead of creating a second Job row.
      if (e?.code === 'P2002') {
        return NextResponse.json({
          error: 'Cette annonce existe déjà dans le feed (même sourceUrl). Marque cette candidature comme doublon.',
        }, { status: 409 })
      }
      throw e
    }

    // Notification fan-out runs OUTSIDE the transaction — it's slow (Resend
    // + per-subscriber DB writes) and we don't want to hold the transaction
    // open. The retry cron picks up Job rows where notificationsSent=false
    // if this initial attempt crashes or the process dies before completion.
    fanoutNotifications(job.id).catch((error) => {
      logger.error('Failed to trigger job notifications from candidate approve', {
        jobId: job.id,
        candidateId: params.id,
        error: String(error),
      })
      // Don't await — the cron will retry. Sentry capture happens inside
      // fanoutNotifications on the per-call exception path.
    })

    return NextResponse.json({ job, candidateId: params.id }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-approve' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/** Mark + send notifications for a Job. Idempotent: setting
 *  notificationsAttemptedAt up-front means a concurrent fan-out (e.g. retry
 *  cron firing while approve's fan-out is still in flight) won't double-send.
 *  The retry cron's WHERE clause excludes rows attempted in the last 5 minutes.
 */
async function fanoutNotifications(jobId: string): Promise<void> {
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { notificationsAttemptedAt: new Date() },
  })
  try {
    await createJobNotifications(job)
    await prisma.job.update({
      where: { id: jobId },
      data: { notificationsSent: true },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { route: 'admin-candidates-approve', step: 'fanoutNotifications' },
      extra: { jobId },
    })
    throw error
  }
}
