import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY is not set')
    _resend = new Resend(key)
  }
  return _resend
}

const FROM = process.env.EMAIL_FROM || 'Job Club <noreply@mlfrance.dev>'

function getEmailTemplate(subject: string, content: string): string {
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
          <p>© 2026 Job Club. Tous droits réservés.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export async function sendWelcomeEmail(to: string, name: string) {
  const resend = getResend()
  const content = `
    <div class="content">
      <p>Bienvenue sur <strong>Job Club</strong>, ${name || 'ami'} ! 🎉</p>
      <p>Ton compte a été créé avec succès. Tu peux maintenant accéder à des dizaines d'offres d'emploi exclusives en Australie.</p>
      <p>Explore les jobs qui te correspondent et commence ton aventure dès maintenant !</p>
      <div style="text-align: center;">
        <a href="${process.env.NEXTAUTH_URL || 'https://jobclub.mlfrance.dev'}/feed" class="button">Voir les offres d'emploi</a>
      </div>
      <p style="margin-top: 20px; font-size: 13px;">Si tu as des questions, n'hésite pas à nous contacter.</p>
    </div>
  `

  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Bienvenue sur Job Club !',
    html: getEmailTemplate('Bienvenue', content),
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = getResend()
  const content = `
    <div class="content">
      <p>Salut,</p>
      <p>Tu as demandé à réinitialiser ton mot de passe Job Club. Clique sur le bouton ci-dessous pour créer un nouveau mot de passe.</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
      </div>
      <p style="font-size: 13px; color: #6b7280;">Ce lien expire dans 1 heure.</p>
      <p style="font-size: 13px;">Si tu n'as pas demandé cette réinitialisation, tu peux ignorer cet email.</p>
    </div>
  `

  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Réinitialise ton mot de passe Job Club',
    html: getEmailTemplate('Réinitialisation', content),
  })
}

export async function sendSubscriptionConfirmation(to: string, name: string) {
  const resend = getResend()
  const content = `
    <div class="content">
      <p>Salut ${name || 'ami'},</p>
      <p style="font-size: 16px; font-weight: 600; color: #6b21a8; text-align: center;">Ton abonnement Job Club est maintenant actif ! 🎊</p>
      <p>Tu as accès à :</p>
      <ul style="margin: 15px 0; padding-left: 20px;">
        <li>Toutes les offres d'emploi en Australie</li>
        <li>Sauvegarde et alertes personnalisées</li>
        <li>Support prioritaire</li>
      </ul>
      <div class="divider"></div>
      <p>Merci de nous faire confiance. Bonne chance dans ta recherche d'emploi !</p>
    </div>
  `

  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Ton abonnement Job Club est actif',
    html: getEmailTemplate('Abonnement confirmé', content),
  })
}

export async function sendJobAlertEmail(
  to: string,
  name: string,
  job: { title: string; company: string; state: string; category: string }
) {
  const resend = getResend()
  const baseUrl = process.env.NEXTAUTH_URL || 'https://jobclub.mlfrance.dev'

  const categoryLabels: Record<string, string> = {
    farm: 'Agriculture',
    hospitality: 'Hôtellerie',
    construction: 'Construction',
    trade: 'Métiers',
    retail: 'Commerce',
    cleaning: 'Nettoyage',
    other: 'Autre',
  }

  const content = `
    <div class="content">
      <p>Salut ${name || 'ami'},</p>
      <p>Une nouvelle offre correspond à tes critères !</p>
      <div style="background-color: #f3e8ff; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #1c1917;">${job.title}</p>
        <p style="margin: 0 0 4px 0; font-size: 14px; color: #57534e;">${job.company} — ${job.state}</p>
        <p style="margin: 0; font-size: 13px; color: #78716c;">${categoryLabels[job.category] || job.category}</p>
      </div>
      <div style="text-align: center;">
        <a href="${baseUrl}/feed" class="button">Voir l'offre</a>
      </div>
      <div class="divider"></div>
      <p style="font-size: 12px; color: #6b7280;">Tu peux désactiver les alertes email dans tes <a href="${baseUrl}/settings" style="color: #6b21a8;">paramètres</a>.</p>
    </div>
  `

  return resend.emails.send({
    from: FROM,
    to,
    subject: `Nouvelle offre : ${job.title}`,
    html: getEmailTemplate('Nouvelle offre', content),
  })
}
