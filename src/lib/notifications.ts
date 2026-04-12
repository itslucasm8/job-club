import { prisma } from './prisma'
import { logger } from './logger'

export interface JobData {
  id: string
  title: string
  company: string
  state: string
  category: string
  eligible88Days?: boolean
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
        only88Days: true,
        preferredStates: true,
        preferredCategories: true,
      },
    })

    const notificationsToCreate = []

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

      // Skip if user only wants 88-day jobs and this job isn't one
      if (user.only88Days && !job.eligible88Days) {
        continue
      }

      let shouldNotify = false

      if (!hasStatePreference && !hasCategoryPreference) {
        shouldNotify = false
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

  } catch (error) {
    logger.error('Failed to create job notifications', {
      jobId: job.id,
      error: String(error),
    })
  }
}
