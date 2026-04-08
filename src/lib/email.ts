import { Resend } from 'resend'
import { catLabel, type Language } from './utils'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY is not set')
    _resend = new Resend(key)
  }
  return _resend
}

const FROM = process.env.EMAIL_FROM || 'Job Club <noreply@thejobclub.com.au>'

function getEmailTemplate(subject: string, content: string, lang: Language = 'fr'): string {
  const footerText = lang === 'en'
    ? '© 2026 Job Club. All rights reserved.'
    : '© 2026 Job Club. Tous droits réservés.'
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          background-color: #f9fafb;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #ffffff;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #6b21a8;
          padding-bottom: 20px;
        }
        .logo {
          display: inline-block;
          width: 40px;
          height: 40px;
          margin-bottom: 10px;
        }
        .header h1 {
          margin: 0;
          color: #6b21a8;
          font-size: 24px;
          font-weight: 700;
        }
        .content {
          margin: 30px 0;
          color: #374151;
          font-size: 14px;
        }
        .button {
          display: inline-block;
          padding: 12px 32px;
          margin: 20px 0;
          background-color: #f59e0b;
          color: #ffffff;
          text-decoration: none;
          border-radius: 6px;
          font-weight: 600;
          text-align: center;
          transition: background-color 0.3s;
        }
        .button:hover {
          background-color: #d97706;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          font-size: 12px;
          color: #6b7280;
        }
        .divider {
          height: 1px;
          background-color: #e5e7eb;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <svg viewBox="0 0 40 40" fill="none" class="logo">
            <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M29 8L32 4 31 12" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h1>Job Club</h1>
        </div>
        ${content}
        <div class="footer">
          <p>${footerText}</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export async function sendWelcomeEmail(to: string, name: string, lang: Language = 'fr') {
  const resend = getResend()
  const baseUrl = process.env.NEXTAUTH_URL || 'https://thejobclub.com.au'
  const greeting = name || (lang === 'en' ? 'friend' : 'ami')

  const content = lang === 'en'
    ? `<div class="content">
        <p>Welcome to <strong>Job Club</strong>, ${greeting}! 🎉</p>
        <p>Your account has been created successfully. You can now access dozens of exclusive job listings in Australia.</p>
        <p>Explore jobs that match your profile and start your adventure now!</p>
        <div style="text-align: center;">
          <a href="${baseUrl}/feed" class="button">View job listings</a>
        </div>
        <p style="margin-top: 20px; font-size: 13px;">If you have any questions, don't hesitate to contact us.</p>
      </div>`
    : `<div class="content">
        <p>Bienvenue sur <strong>Job Club</strong>, ${greeting} ! 🎉</p>
        <p>Ton compte a été créé avec succès. Tu peux maintenant accéder à des dizaines d'offres d'emploi exclusives en Australie.</p>
        <p>Explore les jobs qui te correspondent et commence ton aventure dès maintenant !</p>
        <div style="text-align: center;">
          <a href="${baseUrl}/feed" class="button">Voir les offres d'emploi</a>
        </div>
        <p style="margin-top: 20px; font-size: 13px;">Si tu as des questions, n'hésite pas à nous contacter.</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? 'Welcome to Job Club!' : 'Bienvenue sur Job Club !',
    html: getEmailTemplate('Bienvenue', content, lang),
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, lang: Language = 'fr') {
  const resend = getResend()

  const content = lang === 'en'
    ? `<div class="content">
        <p>Hi,</p>
        <p>You requested to reset your Job Club password. Click the button below to create a new password.</p>
        <div style="text-align: center;">
          <a href="${resetUrl}" class="button">Reset my password</a>
        </div>
        <p style="font-size: 13px; color: #6b7280;">This link expires in 1 hour.</p>
        <p style="font-size: 13px;">If you didn't request this reset, you can ignore this email.</p>
      </div>`
    : `<div class="content">
        <p>Salut,</p>
        <p>Tu as demandé à réinitialiser ton mot de passe Job Club. Clique sur le bouton ci-dessous pour créer un nouveau mot de passe.</p>
        <div style="text-align: center;">
          <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
        </div>
        <p style="font-size: 13px; color: #6b7280;">Ce lien expire dans 1 heure.</p>
        <p style="font-size: 13px;">Si tu n'as pas demandé cette réinitialisation, tu peux ignorer cet email.</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? 'Reset your Job Club password' : 'Réinitialise ton mot de passe Job Club',
    html: getEmailTemplate('Réinitialisation', content, lang),
  })
}

export async function sendSubscriptionConfirmation(to: string, name: string, lang: Language = 'fr') {
  const resend = getResend()
  const greeting = name || (lang === 'en' ? 'friend' : 'ami')

  const content = lang === 'en'
    ? `<div class="content">
        <p>Hi ${greeting},</p>
        <p style="font-size: 16px; font-weight: 600; color: #6b21a8; text-align: center;">Your Job Club subscription is now active! 🎊</p>
        <p>You now have access to:</p>
        <ul style="margin: 15px 0; padding-left: 20px;">
          <li>All job listings in Australia</li>
          <li>Saved jobs and personalized alerts</li>
          <li>Priority support</li>
        </ul>
        <div class="divider"></div>
        <p>Thank you for trusting us. Good luck with your job search!</p>
      </div>`
    : `<div class="content">
        <p>Salut ${greeting},</p>
        <p style="font-size: 16px; font-weight: 600; color: #6b21a8; text-align: center;">Ton abonnement Job Club est maintenant actif ! 🎊</p>
        <p>Tu as accès à :</p>
        <ul style="margin: 15px 0; padding-left: 20px;">
          <li>Toutes les offres d'emploi en Australie</li>
          <li>Sauvegarde et alertes personnalisées</li>
          <li>Support prioritaire</li>
        </ul>
        <div class="divider"></div>
        <p>Merci de nous faire confiance. Bonne chance dans ta recherche d'emploi !</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? 'Your Job Club subscription is active' : 'Ton abonnement Job Club est actif',
    html: getEmailTemplate('Abonnement confirmé', content, lang),
  })
}

export async function sendPaymentFailedEmail(to: string, name: string, lang: Language = 'fr') {
  const resend = getResend()
  const baseUrl = process.env.NEXTAUTH_URL || 'https://thejobclub.com.au'
  const greeting = name || (lang === 'en' ? 'friend' : 'ami')

  const content = lang === 'en'
    ? `<div class="content">
        <p>Hi ${greeting},</p>
        <p>We were unable to process your last payment for your Job Club subscription.</p>
        <p>To continue accessing job listings, please update your payment information.</p>
        <div style="text-align: center;">
          <a href="${baseUrl}/profile" class="button">Update my payment</a>
        </div>
        <p style="font-size: 13px; color: #6b7280;">If you think this is an error, don't hesitate to contact us.</p>
      </div>`
    : `<div class="content">
        <p>Salut ${greeting},</p>
        <p>Nous n'avons pas pu traiter ton dernier paiement pour ton abonnement Job Club.</p>
        <p>Pour continuer à accéder aux offres d'emploi, merci de mettre à jour tes informations de paiement.</p>
        <div style="text-align: center;">
          <a href="${baseUrl}/profile" class="button">Mettre à jour mon paiement</a>
        </div>
        <p style="font-size: 13px; color: #6b7280;">Si tu penses qu'il s'agit d'une erreur, n'hésite pas à nous contacter.</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? 'Payment issue — Job Club' : 'Problème de paiement — Job Club',
    html: getEmailTemplate('Paiement échoué', content, lang),
  })
}

export async function sendJobAlertEmail(
  to: string,
  name: string,
  job: { title: string; company: string; state: string; category: string },
  lang: Language = 'fr'
) {
  const resend = getResend()
  const baseUrl = process.env.NEXTAUTH_URL || 'https://thejobclub.com.au'
  const greeting = name || (lang === 'en' ? 'friend' : 'ami')

  const categoryLabel = catLabel(job.category, lang)

  const content = lang === 'en'
    ? `<div class="content">
        <p>Hi ${greeting},</p>
        <p>A new job matches your criteria!</p>
        <div style="background-color: #f3e8ff; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #1c1917;">${job.title}</p>
          <p style="margin: 0 0 4px 0; font-size: 14px; color: #57534e;">${job.company} — ${job.state}</p>
          <p style="margin: 0; font-size: 13px; color: #78716c;">${categoryLabel}</p>
        </div>
        <div style="text-align: center;">
          <a href="${baseUrl}/feed" class="button">View job</a>
        </div>
        <div class="divider"></div>
        <p style="font-size: 12px; color: #6b7280;">You can disable email alerts in your <a href="${baseUrl}/settings" style="color: #6b21a8;">settings</a>.</p>
      </div>`
    : `<div class="content">
        <p>Salut ${greeting},</p>
        <p>Une nouvelle offre correspond à tes critères !</p>
        <div style="background-color: #f3e8ff; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #1c1917;">${job.title}</p>
          <p style="margin: 0 0 4px 0; font-size: 14px; color: #57534e;">${job.company} — ${job.state}</p>
          <p style="margin: 0; font-size: 13px; color: #78716c;">${categoryLabel}</p>
        </div>
        <div style="text-align: center;">
          <a href="${baseUrl}/feed" class="button">Voir l'offre</a>
        </div>
        <div class="divider"></div>
        <p style="font-size: 12px; color: #6b7280;">Tu peux désactiver les alertes email dans tes <a href="${baseUrl}/settings" style="color: #6b21a8;">paramètres</a>.</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? `New job: ${job.title}` : `Nouvelle offre : ${job.title}`,
    html: getEmailTemplate('Nouvelle offre', content, lang),
  })
}

export async function sendRenewalReminderEmail(to: string, name: string, lang: Language = 'fr') {
  const resend = getResend()
  const baseUrl = process.env.NEXTAUTH_URL || 'https://thejobclub.com.au'
  const greeting = name || (lang === 'en' ? 'friend' : 'ami')

  const content = lang === 'en'
    ? `<div class="content">
        <p>Hi ${greeting},</p>
        <p>Just a heads up — your Job Club subscription will renew soon.</p>
        <p>No action needed if you'd like to keep your access. If you want to manage your subscription or update your payment method, you can do so anytime.</p>
        <div style="text-align: center;">
          <a href="${baseUrl}/profile" class="button">Manage my subscription</a>
        </div>
        <p style="font-size: 13px; color: #6b7280;">Thanks for being part of Job Club!</p>
      </div>`
    : `<div class="content">
        <p>Salut ${greeting},</p>
        <p>Petit rappel — ton abonnement Job Club sera renouvelé prochainement.</p>
        <p>Aucune action nécessaire si tu souhaites garder ton accès. Si tu veux gérer ton abonnement ou mettre à jour ton moyen de paiement, tu peux le faire à tout moment.</p>
        <div style="text-align: center;">
          <a href="${baseUrl}/profile" class="button">Gérer mon abonnement</a>
        </div>
        <p style="font-size: 13px; color: #6b7280;">Merci de faire partie de Job Club !</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? 'Your Job Club subscription renews soon' : 'Ton abonnement Job Club sera renouvelé bientôt',
    html: getEmailTemplate(lang === 'en' ? 'Renewal reminder' : 'Rappel de renouvellement', content, lang),
  })
}

export async function sendSubscriptionCancellationEmail(to: string, name: string, lang: Language = 'fr') {
  const resend = getResend()
  const greeting = name || (lang === 'en' ? 'friend' : 'ami')

  const content = lang === 'en'
    ? `<div class="content">
        <p>Hi ${greeting},</p>
        <p>Your Job Club subscription has been cancelled.</p>
        <p>You will no longer have access to job listings. If you change your mind, you can resubscribe at any time.</p>
        <p>We hope Job Club helped you in your Australian adventure. Good luck!</p>
        <p style="font-size: 13px; color: #6b7280;">If you didn't cancel your subscription, please contact us immediately.</p>
      </div>`
    : `<div class="content">
        <p>Salut ${greeting},</p>
        <p>Ton abonnement Job Club a bien été annulé.</p>
        <p>Tu n'auras plus accès aux offres d'emploi. Si tu changes d'avis, tu peux te réabonner à tout moment.</p>
        <p>On espère que Job Club t'a aidé dans ton aventure australienne. Bonne chance !</p>
        <p style="font-size: 13px; color: #6b7280;">Si tu n'as pas annulé ton abonnement, contacte-nous immédiatement.</p>
      </div>`

  return resend.emails.send({
    from: FROM,
    to,
    subject: lang === 'en' ? 'Your Job Club subscription has been cancelled' : 'Ton abonnement Job Club a été annulé',
    html: getEmailTemplate(lang === 'en' ? 'Subscription cancelled' : 'Abonnement annulé', content, lang),
  })
}
