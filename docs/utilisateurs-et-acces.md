# Utilisateurs et accès

[← Retour au README](../README.md)

## Connexion

- **Production** : uniquement « Se connecter avec Google ».
- **Dev** : Google, plus une **connexion de test** (adresse autorisée + code `DEV_LOGIN_SECRET`) qui sert aux tests automatiques. Elle est désactivée par le code dès que `VERCEL_ENV=production`, même si la variable est définie.

## Qui peut entrer

L'accès est fermé par défaut. Un compte Google n'entre que si son adresse figure dans la table `users` et que l'utilisateur est **actif**.

- Les adresses de `ADMIN_EMAILS` sont créées comme **administrateurs** à la première connexion.
- Les autres adresses sont ajoutées par un administrateur dans **Accès** (`/utilisateurs`).

Une adresse non autorisée est refusée à la connexion. La session est revérifiée en base **à chaque requête** : désactiver un utilisateur ou changer son rôle prend donc effet immédiatement, sans attendre l'expiration de la session.

## Page Accès (`/utilisateurs`, administrateurs uniquement)

| Champ | Usage |
|---|---|
| E-mail | adresse Google autorisée |
| Nom | affiché comme responsable et auteur |
| Rôle | `admin` (gère les accès) ou `membre` |
| Heures disponibles par semaine | prévu pour un futur planning |
| Compétences | liste libre, prévue pour l'affectation automatique |
| Actif | décocher bloque l'accès sans perdre l'historique |

Il doit toujours rester **au moins un administrateur actif** : la dernière modification qui le retirerait est refusée.

## Ce qui est réservé aux connectés

Tout le site, sauf `/connexion`, y compris les fichiers : les photos et les documents ne sont servis que par des routes qui vérifient la session. Les pages de **dev** sont en plus protégées par l'authentification Vercel.
