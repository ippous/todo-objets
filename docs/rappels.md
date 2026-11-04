# Échéances et rappels

[← Retour au README](../README.md)

## Échéance au jour ou à l'heure

Une tâche peut avoir une **date** d'échéance et, en plus, une **heure** (heure de Paris). L'heure n'est saisissable qu'avec une date ; effacer la date efface l'heure.

- Sans heure, la tâche est « En retard » le lendemain de l'échéance ; avec une heure, dès l'heure passée.
- Les listes, le tableau et l'assistant IA affichent « 20 nov. 2026 à 14:30 ».
- L'occurrence suivante d'une tâche récurrente garde l'heure et le schéma de rappel.

## Schémas de rappel

Un **schéma** est une suite de rappels avant l'échéance :

| Notation | Signification |
|---|---|
| `J-n` | n jours avant (`J-0` = le jour même) |
| `H-n` | n heures avant |
| `M-n` | n minutes avant |

Exemples livrés : **Standard** `J-10 / J-5 / J-2 / J-1` (proposé par défaut) et **Rendez-vous** `J-10 / J-1 / H-3 / M-10`.

Les **administrateurs** les gèrent dans *Accès › Schémas de rappel* (`/utilisateurs/rappels`) : créer, modifier, choisir celui proposé par défaut, supprimer (les tâches qui l'utilisaient n'ont alors plus de rappel). La saisie est souple : `j10, h3 m-10` est compris et remis dans l'ordre.

Sur chaque tâche, le champ **Rappels** (sous l'échéance) choisit le schéma, ou *Aucun*. Une nouvelle tâche reprend le schéma par défaut.

### Quand partent les rappels

| Échéance | `J-n` | `H-n`, `M-n` |
|---|---|---|
| avec heure (20/11 à 14:30) | n jours avant, à la même heure (J-1 = 19/11 à 14:30) | échéance moins n heures / minutes |
| sans heure (20/11) | le jour J-n à **8 h** | ignorés |

- Rien n'est envoyé après l'échéance, ni pour une tâche faite.
- Si plusieurs rappels sont en retard (serveur arrêté, par exemple), seul le plus récent part ; les autres sont marqués « sautés ».
- Un rappel dont l'instant précède la dernière modification de la tâche n'est pas envoyé : une tâche créée la veille de son échéance ne reçoit pas de « J-10 ».
- Changer l'échéance réarme les rappels.
- La fiche de la tâche indique le prochain rappel et le dernier envoi.

## Qui est prévenu, et comment

Le rappel va au **responsable** de la tâche, ou à défaut à la personne qui l'a **créée** (si elle est active).

Chacun règle ses canaux dans **Rappels** (`/rappels`, lien en haut de page) :

- **E-mail** à l'adresse de connexion (Google) ;
- **Notification** sur chaque appareil activé (bouton « Activer sur cet appareil ») : Android (Chrome, Edge, Firefox), PC, Mac ; sur **iPhone**, il faut d'abord ajouter Carnet à l'écran d'accueil (iOS 16.4 ou plus) et l'ouvrir depuis l'icône.
- **M'envoyer un rappel d'essai** vérifie les deux.

Les notifications utilisent le standard Web Push : pas de numéro de téléphone ni de service payant. Un appareil désinstallé ou expiré est retiré automatiquement.

## Envoi : une route appelée chaque minute

`GET` ou `POST /api/rappels/envoyer`, avec l'en-tête `Authorization: Bearer <CRON_SECRET>`. Elle traite les rappels arrivés à échéance et répond un résumé JSON (envoyés, sautés, sans canal, échecs). Elle est idempotente : deux appels simultanés n'envoient pas deux fois le même rappel (index unique sur tâche + rappel + échéance, table `reminder_deliveries`).

Deux déclencheurs :

1. **Vercel Cron** (`vercel.json`), une fois par jour vers 8 h (7 h 05 UTC ; le plan Hobby ne permet pas plus et l'heure exacte varie dans l'heure). Il suffit aux rappels J des tâches sans heure. Vercel envoie lui-même `Authorization: Bearer <CRON_SECRET>`, et seulement en production.
2. **Cron du VPS Hostinger**, chaque minute, pour les rappels H et M et les échéances à l'heure :

```cron
* * * * * curl -fsS -m 50 -H "Authorization: Bearer <CRON_SECRET>" https://todo.jaume-eric.com/api/rappels/envoyer > /dev/null
```

Pour le **dev** (protégé par l'authentification Vercel), ajouter l'en-tête `x-vercel-protection-bypass: <jeton>` (Vercel › Settings › Deployment Protection › Protection Bypass for Automation) et utiliser le `CRON_SECRET` du dev.

Sur un plan Vercel Pro, il suffirait de passer le `schedule` de `vercel.json` à `* * * * *`.

## Configuration (variables d'environnement)

| Variable | Rôle |
|---|---|
| `CRON_SECRET` | secret de la route d'envoi (16 caractères au moins ; sans lui la route répond 401) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | serveur d'envoi des e-mails ; port 465 (SSL) par défaut. Chez Hostinger : `smtp.hostinger.com`, 465, une boîte du domaine (ex. `carnet@jaume-eric.com`) |
| `MAIL_FROM` | expéditeur affiché, ex. `Carnet <carnet@jaume-eric.com>` (par défaut `SMTP_USER`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | clés des notifications, générées une fois : `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | contact pour les services de notification, ex. `mailto:ippous@gmail.com` |
| `APP_URL` | facultative : adresse utilisée dans les liens des rappels (par défaut, celle qui a appelé la route) |

Sans SMTP, ou sans clés VAPID, le canal correspondant est simplement indisponible (la page *Rappels* le signale). Garder les **mêmes clés VAPID** ensuite : les changer oblige chaque appareil à se réabonner.

## Assistants IA (MCP)

`creer_tache` et `modifier_tache` acceptent `heure_echeance` (`HH:MM`) et `rappels` (nom d'un schéma, ou « aucun » ; à la création, le schéma par défaut s'il y a une échéance). `vue_ensemble` liste les schémas, `obtenir_tache` et `rechercher_taches` renvoient l'heure et le retard qui en tient compte.

## Côté base

| Table / colonne | Rôle |
|---|---|
| `todos.due_time`, `todos.reminder_scheme_id` | heure d'échéance (contrainte : pas d'heure sans date), schéma choisi (`SET NULL` à la suppression du schéma) |
| `reminder_schemes` | nom unique sans tenir compte de la casse, décalages en JSON (`[{"n":10,"unit":"j"}…]`), un seul par défaut |
| `users.notify_email`, `users.notify_push` | canaux choisis |
| `push_subscriptions` | appareils abonnés (endpoint unique, clés, libellé « Chrome sur Android ») |
| `reminder_deliveries` | rappels traités : envoyé, sauté, aucun canal, aucun destinataire, échec (avec l'erreur) |
