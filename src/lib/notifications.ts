import { prisma } from './prisma'
import { logger } from './logger'
import { sendJobAlertEmail } from './email'

export interface JobData {
  id: string
  title: string
  company: string
  state: string
  category: string
}

export async function createJobNotifications(job: JobData): Promise<void> {
  try {
    // Get all users with active subscriptions
    const users = await prisma.user.findMany({
      where: {
        subscriptionStatus: 'active',
      },
      select: {
        id: true,
        name: true,
        email: true,
        emailAlerts: true,
        preferredStates: true,
        preferredCategories: true,
      },
    })

    const notificationsToCreate = []
    const emailsToSend: { to: string; name: string }[] = []

    for (const user of users) {
      // Parse preferences
      const preferredStates = user.preferredStates
        ? user.preferredStates.split(',').map((s) => s.trim())
        : []
      const preferredCategories = user.preferredCategories
        ? user.preferredCategories.split(',').map((c) => c.trim())
        : []

      // Determine if user should be notified
      const hasStatePreference = preferredStates.length > 0
      const hasCategoryPreference = preferredCategories.length > 0

      let shouldNotify = false

      if (!hasStatePreference && !hasCategoryPreference) {
        shouldNotify = true
      } else if (hasStatePreference && !hasCategoryPreference) {
        shouldNotify = preferredStates.includes(job.state)
      } else if (!hasStatePreference && hasCategoryPreference) {
        shouldNotify = preferredCategories.includes(job.category)
      } else {
        const stateMatches = preferredStates.includes(job.state)
        const categoryMatches = preferredCategories.includes(job.category)
        shouldNotify = stateMatches && categoryMatches
      }

      if (shouldNotify) {
        notificationsToCreate.push({
          userId: user.id,
          type: 'new_job',
          title: `Nouvelle offre: ${job.title}`,
          message: `${job.company} — ${job.state}`,
          jobId: job.id,
        })

        // Queue email if user has email alerts enabled
        if (user.emailAlerts) {
          emailsToSend.push({ to: user.email, name: user.name || '' })
        }
      }
    }

    // Bulk create in-app notifications
    if (notificationsToCreate.length > 0) {
      await prisma.notification.createMany({
        data: notificationsToCreate,
      })
      logger.info('Job notifications created', {
        jobId: job.id,
        count: notificationsToCreate.length,
      })
    }

    // Send emails (fire-and-forget each one)
    if (emailsToSend.length > 0) {
      const emailPromises = emailsToSend.map(({ to, name }) =>
        sendJobAlertEmail(to, name, job).catch((err) => {
          logger.error('Failed to send job alert email', {
            jobId: job.id,
            to,
            error: String(err),
          })
        })
      )
      await Promise.allSettled(emailPromises)
      logger.info('Job alert emails sent', {
        jobId: job.id,
        attempted: emailsToSend.length,
      })
    }
  } catch (error) {
    logger.error('Failed to create job notifications', {
      jobId: job.id,
      error: String(error),
    })
  }
}
