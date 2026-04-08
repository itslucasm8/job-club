'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { usePostHog } from 'posthog-js/react'
import * as Sentry from '@sentry/nextjs'

export default function UserIdentifier() {
  const { data: session } = useSession()
  const posthog = usePostHog()

  useEffect(() => {
    const user = session?.user as any
    if (!user?.id) {
      // User logged out — reset both
      posthog?.reset()
      Sentry.setUser(null)
      return
    }

    // Identify in PostHog
    if (posthog) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.name,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus,
      })
    }

    // Set user context in Sentry
    Sentry.setUser({
      id: user.id,
      email: user.email ?? undefined,
      username: user.name ?? undefined,
    })
  }, [session, posthog])

  return null
}
