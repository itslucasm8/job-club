import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: (session.user as any).id },
      select: {
        id: true,
        name: true,
        email: true,
        preferredStates: true,
        preferredCategories: true,
        only88Days: true,
        preferredLanguage: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur non trouvé' }, { status: 404 })
    }

    return NextResponse.json({
      name: user.name,
      email: user.email,
      preferredStates: user.preferredStates ? user.preferredStates.split(',') : [],
      preferredCategories: user.preferredCategories ? user.preferredCategories.split(',') : [],
      only88Days: user.only88Days,
      preferredLanguage: user.preferredLanguage,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'user-settings', method: 'GET' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const body = await req.json()

    const {
      name,
      email,
      currentPassword,
      newPassword,
      preferredStates,
      preferredCategories,
      only88Days,
      onboardingCompleted,
    } = body

    // Get current user from DB
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!currentUser) {
      return NextResponse.json({ error: 'Utilisateur non trouvé' }, { status: 404 })
    }

    const updateData: any = {}

    // Handle name update
    if (name !== undefined) {
      updateData.name = name
    }

    // Handle email update
    if (email !== undefined) {
      // Check if email is already taken
      if (email !== currentUser.email) {
        const existingUser = await prisma.user.findUnique({
          where: { email },
        })
        if (existingUser) {
          return NextResponse.json(
            { error: 'Cet e-mail est déjà utilisé' },
            { status: 400 }
          )
        }
      }
      updateData.email = email
    }

    // Handle password change
    if (currentPassword !== undefined || newPassword !== undefined) {
      if (!currentPassword || !newPassword) {
        return NextResponse.json(
          { error: 'Le mot de passe actuel et le nouveau mot de passe sont obligatoires' },
          { status: 400 }
        )
      }

      if (typeof newPassword !== 'string' || newPassword.length < 8) {
        return NextResponse.json(
          { error: 'PASSWORD_TOO_SHORT' },
          { status: 400 }
        )
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(
        currentPassword,
        currentUser.passwordHash
      )
      if (!isValidPassword) {
        return NextResponse.json(
          { error: 'Le mot de passe actuel est incorrect' },
          { status: 400 }
        )
      }

      // Hash and set new password
      const hashedPassword = await bcrypt.hash(newPassword, 12)
      updateData.passwordHash = hashedPassword
    }

    // Handle preferences
    if (preferredStates !== undefined) {
      if (Array.isArray(preferredStates)) {
        updateData.preferredStates =
          preferredStates.length > 0 ? preferredStates.join(',') : null
      }
    }

    if (preferredCategories !== undefined) {
      if (Array.isArray(preferredCategories)) {
        updateData.preferredCategories =
          preferredCategories.length > 0 ? preferredCategories.join(',') : null
      }
    }

    // Handle only88Days toggle
    if (only88Days !== undefined) {
      updateData.only88Days = Boolean(only88Days)
    }

    // Handle language preference
    if (body.preferredLanguage !== undefined) {
      if (body.preferredLanguage === 'fr' || body.preferredLanguage === 'en') {
        updateData.preferredLanguage = body.preferredLanguage
      }
    }

    // Handle onboarding completion
    if (onboardingCompleted === true && !currentUser.onboardingCompleted) {
      updateData.onboardingCompleted = true

      // Create welcome notifications
      const lang = currentUser.preferredLanguage === 'en' ? 'en' : 'fr'
      const welcomeNotifications = lang === 'fr'
        ? [
            {
              userId,
              type: 'welcome',
              title: 'Bienvenue sur Job Club !',
              message: 'Merci pour ton abonnement ! Tu recevras des notifications pour les offres correspondant à tes préférences.',
              linkUrl: '/feed',
            },
            {
              userId,
              type: 'welcome',
              title: 'Personnalise tes alertes',
              message: 'Tu peux modifier tes préférences d\'état et de catégorie à tout moment dans les réglages.',
              linkUrl: '/settings',
            },
          ]
        : [
            {
              userId,
              type: 'welcome',
              title: 'Welcome to Job Club!',
              message: "Thanks for subscribing! You'll receive notifications for jobs matching your preferences.",
              linkUrl: '/feed',
            },
            {
              userId,
              type: 'welcome',
              title: 'Customize your alerts',
              message: 'You can change your state and category preferences anytime in settings.',
              linkUrl: '/settings',
            },
          ]

      await prisma.notification.createMany({ data: welcomeNotifications })
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        preferredStates: true,
        preferredCategories: true,
        only88Days: true,
        preferredLanguage: true,
      },
    })

    return NextResponse.json({
      name: updatedUser.name,
      email: updatedUser.email,
      preferredStates: updatedUser.preferredStates
        ? updatedUser.preferredStates.split(',')
        : [],
      preferredCategories: updatedUser.preferredCategories
        ? updatedUser.preferredCategories.split(',')
        : [],
      only88Days: updatedUser.only88Days,
      preferredLanguage: updatedUser.preferredLanguage,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'user-settings', method: 'PATCH' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
