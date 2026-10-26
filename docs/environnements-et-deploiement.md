# Environnements et déploiement

[← Retour au README](../README.md)

## Vue d'ensemble

| | Dev | Production |
|---|---|---|
| Adresse | https://dev.todo.jaume-eric.com | https://todo.jaume-eric.com |
| Branche Git | `develop` | `main` |
| Environnement Vercel | Preview | Production |
| Base Neon | branche de dev (créée par l'intégration Neon) | branche principale |
| Protection | authentification Vercel + connexion à l'app | connexion à l'app |
| Connexion de test | oui (`DEV_LOGIN_SECRET`) | non |
| Préfixe des fichiers Blob | `preview/` | `production/` |

## Cycle de travail

1. Développer et tester en local (voir [tests.md](tests.md)).
2. Pousser sur `develop` : Vercel construit et déploie le dev (migrations appliquées sur la base de dev).
3. Lancer les e2e sur le dev.
4. Fusionner `develop` dans `main` : Vercel déploie la prod, et les migrations s'appliquent à la base de prod.

## Build et migrations

`npm run build` = `tsx scripts/migrate.ts && next build`. Le script :

- se connecte avec `DATABASE_URL_UNPOOLED` (ou `DATABASE_URL`) ;
- applique les migrations de `drizzle/` qui manquent ;
- crée l'arbre de départ si la table `objects` est vide.

Pour créer une migration : modifier `src/db/schema.ts`, puis lancer `npm run db:generate`. Pour une migration avec transformation de données, écrire le SQL à la main (`drizzle-kit generate --custom`), comme `0003_types.sql`.

## Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable | Prod | Dev | Rôle |
|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | ✓ | ✓ | posées par l'intégration Neon |
| `AUTH_SECRET` | ✓ | ✓ (valeur différente) | signature des sessions |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | ✓ | ✓ | connexion Google |
| `ADMIN_EMAILS` | ✓ | ✓ | administrateurs créés à la première connexion |
| `DEV_LOGIN_SECRET` | ✗ | ✓ (branche `develop`) | connexion de test et route de purge |
| `BLOB_READ_WRITE_TOKEN` | ✓ | ✓ | store Blob privé `carnet-photos` |

Une variable modifiée n'est prise en compte qu'au **déploiement suivant** (Redeploy ou nouveau commit).

## Domaines (Hostinger)

Dans la zone DNS de `jaume-eric.com`, deux enregistrements CNAME :

| Nom | Cible |
|---|---|
| `todo` | valeur indiquée par Vercel (Settings → Domains), du type `xxxx.vercel-dns-017.com` |
| `dev.todo` | idem |

Dans Vercel, `todo.jaume-eric.com` est rattaché à la production et `dev.todo.jaume-eric.com` à la branche `develop`. Le certificat HTTPS est émis automatiquement.

## Connexion Google (Google Cloud, projet « TaskManager »)

1. **API et services → Écran de consentement OAuth** (Google Auth Platform) : application *Externe*, nom et e-mail d'assistance ; puis **Audience → Publier l'application** (sinon, seuls les utilisateurs test peuvent se connecter).
2. **Clients → Créer un client** de type *Application Web*, avec :
   - origines JavaScript autorisées : `https://todo.jaume-eric.com`, `https://dev.todo.jaume-eric.com` ;
   - URI de redirection autorisés : `https://todo.jaume-eric.com/api/auth/callback/google`, `https://dev.todo.jaume-eric.com/api/auth/callback/google`.
3. Copier l'ID client et le code secret dans `AUTH_GOOGLE_ID` et `AUTH_GOOGLE_SECRET` (Production + Preview), puis redéployer.

Les adresses de déploiement Vercel du type `todo-objets-xxxx.vercel.app` ne sont pas déclarées chez Google. La connexion Google ne fonctionne donc que sur les deux domaines ci-dessus.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Page de connexion sans bouton Google | `AUTH_GOOGLE_ID` ou `AUTH_GOOGLE_SECRET` absent, ou pas de redéploiement depuis leur ajout |
| Google : `redirect_uri_mismatch` | URI de redirection non déclarée (voir plus haut) |
| Google : « accès bloqué », application en test | écran de consentement non publié |
| « Adresse non autorisée » | adresse absente de `users` et de `ADMIN_EMAILS`, ou utilisateur inactif |
| Build en échec sur `migrate` | base injoignable ou migration invalide : voir les journaux du build |
| Photos ou documents en erreur | `BLOB_READ_WRITE_TOKEN` absent dans l'environnement |
