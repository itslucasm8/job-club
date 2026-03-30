# Job Club — Guide de Déploiement

## Prérequis

- VPS avec Docker et Docker Compose installés
- Nom de domaine pointant vers le VPS
- Compte Stripe avec clés API

## 1. Configuration Stripe

1. Créer un compte sur [stripe.com](https://stripe.com)
2. Dans le dashboard Stripe, créer un **Product** :
   - Nom : "Job Club — Abonnement mensuel"
   - Prix : $39.99/mois (recurring)
   - Copier le `price_id` (commence par `price_`)
3. Dans Developers > API Keys, copier :
   - `Publishable key` (pk_live_...)
   - `Secret key` (sk_live_...)
4. Dans Developers > Webhooks :
   - Ajouter un endpoint : `https://votredomaine.com/api/stripe/webhook`
   - Événements : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copier le `Webhook signing secret` (whsec_...)

## 2. Configuration serveur

```bash
# Cloner le projet sur le VPS
git clone <votre-repo> /opt/job-club
cd /opt/job-club

# Créer le fichier .env.production
cat > .env.production << 'EOF'
DATABASE_URL="file:/app/data/jobclub.db"
NEXTAUTH_SECRET="GÉNÉRER_AVEC_openssl_rand_-base64_32"
NEXTAUTH_URL="https://votredomaine.com"
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_PUBLISHABLE_KEY="pk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_ID="price_..."
EOF
```

## 3. Lancement

```bash
# Construire et lancer
docker compose up -d --build

# Initialiser la base de données
docker compose exec app npx prisma db push
docker compose exec app npx tsx prisma/seed.ts
```

## 4. Nginx + SSL

```bash
# Installer Nginx et Certbot
sudo apt install nginx certbot python3-certbot-nginx

# Copier la config Nginx
sudo cp nginx.conf /etc/nginx/sites-available/jobclub
sudo ln -s /etc/nginx/sites-available/jobclub /etc/nginx/sites-enabled/
# Modifier "jobclub.yourdomain.com" avec votre domaine

# Obtenir le certificat SSL
sudo certbot --nginx -d votredomaine.com

# Redémarrer Nginx
sudo systemctl restart nginx
```

## 5. Développement local

```bash
# Installer les dépendances
npm install

# Initialiser la base de données
npx prisma db push
npx tsx prisma/seed.ts

# Lancer en mode développement
npm run dev
# -> http://localhost:3000
```

### Comptes de test

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Admin | lucas.terpreau3@gmail.com | admin123 |
| Utilisateur | demo@jobclub.com.au | demo123 |

## Commandes utiles

```bash
# Voir les logs
docker compose logs -f app

# Redémarrer
docker compose restart

# Mettre à jour
git pull && docker compose up -d --build

# Sauvegarder la base de données
docker compose exec app cp /app/data/jobclub.db /app/data/backup-$(date +%F).db
```
