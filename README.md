# Carnet

Gestion de tâches rattachées à des objets, eux-mêmes classés en arborescences
(propriété › bâtiment › pièce, véhicule › moteur, projet…).

## Stack

- Next.js (App Router, Server Actions) en TypeScript, Tailwind
- PostgreSQL via Drizzle ORM (Neon sur Vercel, ou n'importe quel Postgres)
- Auth.js : connexion Google, accès limité aux adresses autorisées

## Environnements

| | Dev | Prod |
|---|---|---|
| Branche | `develop` | `main` |
| Base | branche Neon `dev` | branche Neon `main` |
| Connexion de test | oui (`DEV_LOGIN_SECRET`) | non |

Les migrations (`drizzle/`) sont appliquées automatiquement au début de chaque build,
sur la base de l'environnement concerné.

## Développement local

```bash
cp .env.example .env.local   # puis renseigner les valeurs
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

## Tests

```bash
npm test                     # logique d'arbre et requêtes (Postgres en mémoire)
E2E_BASE_URL=https://… E2E_SECRET=… npx playwright test   # parcours de bout en bout
```

## Modèle

- `objects` : arbre de profondeur illimitée (`parent_id`), plusieurs racines possibles.
  Déplacement d'un sous-arbre en transaction, avec refus des boucles.
- `todos` : rattachée à un objet ; estimé / réalisé en heures et en €, priorité, statut,
  échéance, récurrence (occurrence suivante créée à la clôture), responsable, catégorie, tags.
- `users` : adresses autorisées, rôle, heures disponibles par semaine (pour le futur planning).
