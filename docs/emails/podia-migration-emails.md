# Podia Migration — Email Templates (French)

> **For Claude:** These are the three migration emails for the 37 French Podia subscribers. Cohort is 100% French — no EN variants needed. Tone is casual peer-to-peer ("tu"), matching the backpacker audience. Placeholders in `{{ ... }}` get substituted at send time by the scripts.
>
> **Review checklist before going live:**
> - [ ] Lucas confirms the support email address (`support@thejobclub.com.au` placeholder — may be `contact@` or something else)
> - [ ] Lucas confirms his personal sign-off is OK (or changes to "L'équipe Job Club" without the first name)
> - [ ] Lucas picks a cutover date and the pre-cutover email substitutes it in
> - [ ] Subject lines tested for spam-filter score (Resend has a deliverability preview — run it)
> - [ ] Every `{{reset_link}}` resolves to a real 7-day token in scripts

---

## 1. Pre-cutover announcement

**Send:** 5–7 days before cutover
**Recipients:** all 37 active Podia subscribers
**Trigger:** manual (run once, from `scripts/send-pre-cutover-announcement.ts`)
**Goal:** reduce surprise, reduce spam-filter risk for the welcome email, pre-address common "what about my subscription?" questions

**Subject:** `Job Club déménage — voici ce qui change (et ce qui ne change pas)`

**From:** `Job Club <noreply@thejobclub.com.au>` (or Lucas personal address if preferred for warmth)

**Body (HTML/plain):**

```
Salut{{ prenom ? ' ' + prenom : '' }},

Petite annonce importante : on déménage Job Club vers notre propre plateforme, thejobclub.com.au, dans quelques jours (prévu pour le {{ cutover_date }}).

Pas de stress — on t'explique tout en 30 secondes.

── CE QUI CHANGE ──

• Nouvelle adresse : thejobclub.com.au
• Nouveau look, pensé pour ton mobile
• Plus de filtres (état, type de job, 88 jours, rémunération…)
• Sauvegarde d'offres, alertes email, profil perso

── CE QUI NE CHANGE PAS ──

• Ton abonnement continue comme avant
• Même carte, même montant, même date de renouvellement
• Rien à refaire, aucune info de paiement à ressaisir
• Le prix reste identique ({{ plan_price }})

── CE QUE TU DOIS FAIRE ──

Rien pour l'instant. Le jour du déménagement, tu recevras un email avec un lien pour créer ton mot de passe sur la nouvelle plateforme.

Si tu ne reçois rien dans les 24h qui suivent, vérifie tes spams puis contacte-nous à support@thejobclub.com.au.

Des questions en attendant ? Réponds simplement à cet email, on te répond.

À très vite sur thejobclub.com.au,

Lucas & l'équipe Job Club
```

**Placeholder notes:**
- `{{ prenom }}` → `user.name` split on first space, or empty if null
- `{{ cutover_date }}` → French-formatted date (e.g., `15 mai 2026`)
- `{{ plan_price }}` → either `39,99 $/mois` or `149 $/an` based on the subscriber's plan

---

## 2. Welcome email (at cutover)

**Send:** immediately after `scripts/sync-podia-customers.ts` completes successfully for each user
**Recipients:** each migrated user, one at a time
**Trigger:** `scripts/send-migration-emails.ts --live`
**Goal:** unlock their Job Club account via password-setup link

**Subject:** `Ton compte Job Club est prêt — crée ton mot de passe`

**From:** `Job Club <noreply@thejobclub.com.au>`

**Body:**

```
Salut{{ prenom ? ' ' + prenom : '' }},

Ça y est, on a déménagé. Job Club est maintenant sur thejobclub.com.au, et ton compte est déjà prêt — il te suffit de créer ton mot de passe.

👉 Crée ton mot de passe : {{ reset_link }}

(Le lien est valable 7 jours.)

── TON ABONNEMENT CONTINUE SANS COUPURE ──

• Même carte, même montant, même date de renouvellement
• Aucune action côté paiement
• Toutes tes infos sont déjà transférées

── CE QUI T'ATTEND UNE FOIS CONNECTÉ ──

• Un flux d'offres plus clair, trié par état
• Des filtres pour trouver plus vite (88 jours, type de job, rémunération…)
• La possibilité de sauvegarder des offres et d'activer des alertes email
• Une expérience bien plus fluide sur mobile

Un problème ? Écris-nous à support@thejobclub.com.au.

Bienvenue à bord,

Lucas & l'équipe Job Club
```

**Placeholder notes:**
- `{{ prenom }}` → same as above
- `{{ reset_link }}` → `https://thejobclub.com.au/reset-password?token=<token>` where token is a fresh `PasswordReset` row with 7-day expiry

---

## 3. Follow-up email (~Day 7)

**Send:** 7 days after cutover
**Recipients:** migrated users whose `PasswordReset.used === false` (i.e., never logged in)
**Trigger:** `scripts/followup-migration-emails.ts --live`
**Goal:** catch spam-filter losses and nudge the disengaged before we decommission Podia

**Subject:** `Tu n'as pas encore activé ton compte Job Club ?`

**From:** `Job Club <noreply@thejobclub.com.au>`

**Body:**

```
Salut{{ prenom ? ' ' + prenom : '' }},

On a remarqué que tu n'avais pas encore activé ton compte Job Club. Pas de stress — peut-être que notre premier email a filé dans tes spams.

Voici un nouveau lien pour créer ton mot de passe :

👉 Crée ton mot de passe : {{ reset_link }}

(Valable 7 jours.)

── RAPPEL RAPIDE ──

• Ton abonnement est toujours actif (on continue à trouver des jobs pour toi)
• Rien à refaire côté paiement
• Tu as juste à créer ton mot de passe pour te connecter

Si tu avais prévu de résilier ton abonnement, ou si tu rencontres un souci technique, écris-nous simplement à support@thejobclub.com.au. On t'aide.

On t'attend sur thejobclub.com.au,

Lucas & l'équipe Job Club
```

**Placeholder notes:**
- `{{ reset_link }}` → fresh token, 7-day expiry (old token may have expired by now)

---

## Drafting notes / decisions

**Why "tu" everywhere?**
WHV backpackers are typically 18–30. Using "vous" in casual product comms feels cold and corporate, which clashes with the community feel Job Club is trying to project. "Tu" is consistent with what Podia customers saw on that platform and matches every other French consumer product aimed at this audience (BlaBlaCar, Le Slip Français, Back Market…).

**Why no emojis in subject lines?**
Emojis in subjects measurably hurt deliverability for new-domain senders. `thejobclub.com.au` is a new domain — we need to protect the sender reputation during migration. Save emojis for 3+ months in once the domain has a track record.

**Why a personal sign-off ("Lucas & l'équipe")?**
Migration emails feel less corporate and more trustworthy when they come from a person. It also makes "just reply to this email" a legitimate support channel in the pre-cutover message — reduces support-ticket friction.

**Why reference the price in the pre-cutover email?**
Subscribers who took the $149/yr plan *years* ago may have forgotten what they pay. Reminding them of the exact amount heads off "wait, what am I paying for?" anxiety and reduces the risk of knee-jerk cancellations triggered by unfamiliarity with the new platform.

**What we're NOT saying:**
- We don't say "we're leaving Podia" — subscribers may not know they were on Podia in the first place. The framing is "we're moving to our own platform" which is truthful and cleaner.
- We don't ask them to confirm anything — the subscription is a fait accompli, asking for confirmation creates opportunities for churn.
- We don't show the new yearly price ($149) as a "great deal" — that invites comparison with the monthly and may prompt monthly subscribers to question their plan choice.

---

## Next steps

After Lucas reviews these three drafts:
1. Lucas confirms the support email, cutover date, and sign-off.
2. Lucas tweaks tone/wording as needed — his voice, his customers.
3. Once finalized, these templates feed into `scripts/send-migration-emails.ts` and `scripts/followup-migration-emails.ts`. The pre-cutover can be sent manually from Resend's dashboard or via a simple one-shot script.
