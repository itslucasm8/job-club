'use client'

export default function GuidePage() {
  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-2xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-stone-900 mb-2">Guide d'utilisation</h1>
        <p className="text-stone-600">Tout ce que tu dois savoir pour trouver les meilleures offres d'emploi en Australie</p>
      </div>

      {/* Bienvenue sur Job Club */}
      <div className="mb-6 p-6 bg-white rounded-lg border border-stone-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
          </svg>
          <h2 className="text-xl font-bold text-stone-900">Bienvenue sur Job Club</h2>
        </div>
        <p className="text-stone-700 leading-relaxed">
          Job Club est ta plateforme de recherche d'emploi spécialement conçue pour les backpackers en Australie. Nous te proposons les meilleures offres d'emploi provenant des plus grands sites australiens, directement dans une interface simple et intuitive. Avec ton abonnement, accède à des centaines d'offres dans tout le pays et trouve l'opportunité idéale pour ton séjour.
        </p>
      </div>

      {/* Parcourir les offres */}
      <div className="mb-6 p-6 bg-white rounded-lg border border-stone-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <h2 className="text-xl font-bold text-stone-900">Parcourir les offres</h2>
        </div>
        <div className="space-y-3 text-stone-700">
          <p>
            <strong>La page Flux (Feed)</strong> affiche toutes les offres d'emploi disponibles. Tu peux :
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><strong>Filtrer par état :</strong> Clique sur "États" pour voir les offres dans une région spécifique (NSW, VIC, QLD, etc.)</li>
            <li><strong>Filtrer par catégorie :</strong> Trouve rapidement les offres par domaine (Hospitality, Farming, Construction, etc.)</li>
            <li><strong>Rechercher :</strong> Utilise la barre de recherche pour trouver une offre ou un type d'emploi en particulier</li>
            <li><strong>Combiner les filtres :</strong> Tu peux appliquer plusieurs filtres en même temps pour affiner ta recherche</li>
          </ul>
          <p className="mt-3">
            Les offres les plus récentes apparaissent en premier. Chaque fiche affiche le titre du poste, le lieu, le salaire et l'employeur.
          </p>
        </div>
      </div>

      {/* Sauvegarder des offres */}
      <div className="mb-6 p-6 bg-white rounded-lg border border-stone-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 19V5z" />
          </svg>
          <h2 className="text-xl font-bold text-stone-900">Sauvegarder des offres</h2>
        </div>
        <div className="space-y-3 text-stone-700">
          <p>
            Une offre te plaît ? Sauvegarde-la facilement :
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>Clique sur l'icône cœur sur une fiche d'offre pour la sauvegarder</li>
            <li>Les offres sauvegardées restent dans ton compte et tu peux les consulter à tout moment</li>
            <li>Accède à toutes tes offres sauvegardées en allant dans la section <strong>"Mes sauvegardes"</strong></li>
            <li>Tu peux aussi cliquer sur une offre pour voir tous les détails et la sauvegarder depuis la vue complète</li>
          </ul>
          <p className="mt-3">
            Utilise ta liste de sauvegardes pour faire une sélection avant de postuler !
          </p>
        </div>
      </div>

      {/* Notifications */}
      <div className="mb-6 p-6 bg-white rounded-lg border border-stone-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          <h2 className="text-xl font-bold text-stone-900">Notifications</h2>
        </div>
        <div className="space-y-3 text-stone-700">
          <p>
            Reçois des notifications pour les nouvelles offres qui correspondent à tes critères :
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>Va dans <strong>Paramètres du compte</strong> depuis ton profil</li>
            <li>Configure tes préférences de notification (états, catégories d'emploi)</li>
            <li>Active les notifications pour ne jamais rater une bonne offre</li>
            <li>Tu recevras des alertes pour les nouvelles offres correspondant à tes choix</li>
          </ul>
          <p className="mt-3">
            C'est le moyen le plus rapide de trouver ta prochaine opportunité !
          </p>
        </div>
      </div>

      {/* Gérer ton abonnement */}
      <div className="mb-6 p-6 bg-white rounded-lg border border-stone-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M3 10h18M7 15h10M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h2 className="text-xl font-bold text-stone-900">Gérer ton abonnement</h2>
        </div>
        <div className="space-y-3 text-stone-700">
          <p>
            Ton abonnement Job Club coûte <strong>39,99 $ par mois</strong>. Voici comment le gérer :
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>Va dans ton <strong>Profil</strong> (onglet en bas à droite)</li>
            <li>Clique sur <strong>"Gérer mon abonnement"</strong></li>
            <li>Tu seras redirigé vers le portail Stripe où tu peux :</li>
            <ul className="list-circle list-inside ml-4 mt-2 space-y-1">
              <li>Mettre à jour tes informations de paiement</li>
              <li>Modifier ton plan ou l'annuler</li>
              <li>Voir l'historique de tes paiements</li>
            </ul>
          </ul>
          <p className="mt-3 text-sm">
            L'accès à Job Club peut être interrompu si ton paiement est non payé. Assure-toi que tes informations de paiement sont à jour.
          </p>
        </div>
      </div>

      {/* Besoin d'aide ? */}
      <div className="mb-6 p-6 bg-white rounded-lg border border-stone-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-xl font-bold text-stone-900">Besoin d'aide ?</h2>
        </div>
        <div className="space-y-3 text-stone-700">
          <p>
            Si tu as des questions, des problèmes ou simplement besoin d'aide :
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>Envoie un email à <a href="mailto:support@jobclub.com.au" className="text-purple-700 font-medium hover:underline">support@jobclub.com.au</a></li>
            <li>Réponds rapidement à tes demandes (normalement sous 24 heures)</li>
            <li>N'hésite pas à nous contacter pour des suggestions ou des retours</li>
          </ul>
          <p className="mt-3">
            Ton avis est important pour nous aider à améliorer Job Club !
          </p>
        </div>
      </div>

      {/* Bonus Tips */}
      <div className="mb-6 p-6 bg-purple-50 rounded-lg border border-purple-200">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-purple-700 flex-shrink-0">
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <h2 className="text-xl font-bold text-purple-900">Conseils pour réussir ta recherche</h2>
        </div>
        <ul className="space-y-2 text-purple-900">
          <li className="flex gap-2">
            <span>•</span>
            <span><strong>Affine tes critères :</strong> Plus tes filtres sont précis, plus tu trouveras rapidement l'offre idéale</span>
          </li>
          <li className="flex gap-2">
            <span>•</span>
            <span><strong>Active les notifications :</strong> Les meilleures offres partent vite, ne rate pas ta chance</span>
          </li>
          <li className="flex gap-2">
            <span>•</span>
            <span><strong>Sauvegarde régulièrement :</strong> Crée une liste de tes offres préférées avant de postuler</span>
          </li>
          <li className="flex gap-2">
            <span>•</span>
            <span><strong>Consulte régulièrement :</strong> De nouvelles offres sont ajoutées tous les jours !</span>
          </li>
        </ul>
      </div>

      {/* Closing CTA */}
      <div className="text-center p-6 bg-stone-50 rounded-lg border border-stone-200">
        <p className="text-stone-700 mb-4">
          Prêt à trouver ton prochain emploi en Australie ?
        </p>
        <a href="/feed" className="inline-block px-8 py-3 bg-purple-700 text-white font-bold rounded-lg hover:bg-purple-800 transition">
          Retourner aux offres
        </a>
      </div>
    </div>
  )
}
