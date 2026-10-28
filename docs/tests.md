# Tests

[← Retour au README](../README.md)

## Tests unitaires (Vitest + PGlite)

```bash
npm test
```

Ils s'exécutent sur un **Postgres en mémoire** (PGlite), avec les vraies migrations, sans service externe. Chaque test repart d'une base neuve, initialisée avec l'arbre de départ.

| Fichier | Couvre |
|---|---|
| `tests/tree.test.ts` | forêt, cumuls par branche, chemins, regroupement par racine, prochaine échéance |
| `tests/repo.test.ts` | objets, déplacement anti-boucle, suppression, tâches, filtres, tris, récurrence, ajout en lot |
| `tests/photos.test.ts` | vignette automatique, changement de vignette, suppression |
| `tests/documents.test.ts` | documents et liens des objets et des tâches, normalisation des URL |
| `tests/types.test.ts` | création, renommage, doublons insensibles à la casse, suppression bloquée si utilisé |
| `tests/rich-text.test.ts` | nettoyage du HTML des descriptions, conversion de l'ancien texte brut |
| `tests/oauth.test.ts` | jetons personnels, adresses de retour, code + PKCE à usage unique, rotation des jetons de rafraîchissement, révocations, droits lecture / écriture |
| `tests/mcp-write.test.ts` | outils MCP selon les droits, création / modification / déplacement d'objets, tâches (récurrence, responsable), liens, photos (redimensionnement, vignette, refus du non-image) |
| `tests/purge.test.ts` | purge des données de test (sous-arbres, fichiers, types, jokers) |

## Tests de bout en bout (Playwright)

Ils tournent sur deux profils : **mobile** (Pixel 7) et **desktop**.

| Fichier | Parcours |
|---|---|
| `e2e/parcours.spec.ts` | connexion, refus d'une adresse inconnue, objets, sous-objets, tâches, cumuls, déplacement, récurrence |
| `e2e/arbre-photos.spec.ts` | mode Déplacer, glisser-déposer, suppression, photos et vignettes, ajout en lot, documents et liens, accès anonyme refusé |
| `e2e/types.spec.ts` | gestion des types, suppression bloquée tant qu'un objet utilise le type |
| `e2e/description.spec.ts` | éditeur WYSIWYG des descriptions : gras, liste, lien, modification, tâche, recherche dans le texte |
| `e2e/taches-documents.spec.ts` | documents et liens d'une tâche, visionneuse, suppression de la tâche avec ses fichiers |
| `e2e/coller-photo.spec.ts` | photo collée (Ctrl+V) sur un objet et une tâche, collage ignoré dans un champ de saisie, bouton « Coller une image » |
| `e2e/mcp.spec.ts` | serveur MCP avec le client MCP officiel : 401 et métadonnées, jeton personnel (outils, révocation), parcours OAuth complet (enregistrement, connexion, consentement, PKCE, rafraîchissement, révocation, refus, droit d'écriture), jeton en écriture (objets, tâches, récurrence, liens, photo, vérifiés dans l'appli) |
| `e2e/camera.spec.ts` | prise de vue : appareil photo natif sur mobile, webcam simulée par Chromium sur PC (plusieurs prises, retrait, annulation) |
| `e2e/tableau.spec.ts` | vue tableau : trois colonnes, couloirs par objet racine, statut changé par les flèches et par glisser-déposer, persistance, réalisé repris des estimations |
| `e2e/visionneuses.spec.ts` | aperçu PDF, Word, ODT, Excel, ODS, PowerPoint, CSV, texte, ZIP ; visionneuse refusée sans connexion |

Les fichiers d'exemple sont dans `e2e/fixtures/`.

### En local

```bash
npm run build && npm start          # avec .env.local (Postgres local, DEV_LOGIN_SECRET)
E2E_BASE_URL=http://localhost:3000 E2E_SECRET=<DEV_LOGIN_SECRET> npx playwright test
```

### Sur le dev déployé

Le dev est protégé par Vercel. Il faut un **lien de partage** (Vercel → Deployment → Share) :

```bash
E2E_BASE_URL=https://dev.todo.jaume-eric.com \
E2E_VERCEL_SHARE=<jeton _vercel_share> \
E2E_SECRET=<DEV_LOGIN_SECRET> npx playwright test
```

Les tests ne tournent jamais contre la production : la connexion de test et la route de purge y sont désactivées.

## Nettoyage des données de test

**Tout ce qu'un test crée est supprimé**, que le test réussisse ou échoue :

- Chaque test utilise un **marqueur** propre et stable, `e2e-<profil>-<empreinte du test>` (voir `e2e/helpers.ts`). Il figure dans le nom de chaque objet, tâche ou type créé.
- Avant le test (restes d'un essai interrompu) et après (`afterEach`), `purge()` appelle `POST /api/test/purge` avec ce marqueur.
- La route supprime les objets dont le nom contient le marqueur, avec tout leur sous-arbre, leurs tâches, photos, documents et liens. Elle supprime aussi les tâches dont le titre le contient, les types inutilisés, les jetons personnels et les applications OAuth qui le contiennent, puis efface les fichiers correspondants du stockage.

La route `/api/test/purge` :

- répond **404 en production**, et partout où `DEV_LOGIN_SECRET` n'est pas défini ;
- exige une session ;
- refuse un marqueur de moins de 4 caractères ; `%` et `_` sont pris littéralement ;
- accepte `{"dryRun": true}` pour lister ce qui serait supprimé sans rien effacer.
