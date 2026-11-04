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
| `tests/repo.test.ts` | objets, déplacement anti-boucle, suppression, tâches, filtres, tris, récurrence, ajout en lot, recherche d'objets |
| `tests/photos.test.ts` | vignette automatique, changement de vignette, suppression |
| `tests/documents.test.ts` | documents et liens des objets et des tâches, normalisation des URL, description des liens |
| `tests/types.test.ts` | création, renommage, doublons insensibles à la casse, suppression bloquée si utilisé |
| `tests/rich-text.test.ts` | nettoyage du HTML des descriptions, conversion de l'ancien texte brut |
| `tests/oauth.test.ts` | jetons personnels, adresses de retour, code + PKCE à usage unique, rotation des jetons de rafraîchissement, révocations, droits lecture / écriture |
| `tests/mcp-write.test.ts` | outils MCP selon les droits, création / modification / déplacement d'objets, tâches (récurrence, responsable), liens, photos (redimensionnement, vignette, refus du non-image) |
| `tests/subtasks.test.ts` | sous-tâches : ajout en fin de liste, case à cocher, texte, suppression, réordonnancement (liste complète exigée), reprise par la récurrence, suppression avec la tâche, durées prévue / réalisée et leur somme reprise par la tâche sans durée propre |
| `tests/audit.test.ts` | journal des actions : cycle de vie d'un objet et d'une tâche, différences lisibles, survie à la suppression, pas d'entrée sans auteur, pagination, purge, origine MCP et outil `consulter_historique` |
| `tests/ai.test.ts` | types de tâche (reprise des catégories, icône, suppression bloquée), réglages IA (chiffrement des clés, fournisseur par défaut), appels Claude / ChatGPT simulés, compléter la description, propositions de sous-tâches sans doublon |
| `tests/commands.test.ts` | commandes de saisie : date et heure fournies, création, nom invalide ou en double, modification, suppression, `span[data-commande]` conservé et nettoyé, code écrit par l'IA (appel simulé) |
| `tests/reminders.test.ts` | décalages J / H / M (lecture, tri), heure de Paris été / hiver, instants des rappels avec et sans heure, schémas (nom unique, défaut, suppression), envoi une seule fois par e-mail et notification, rattrapage du seul dernier rappel, réarmement quand l'échéance change, préférences, créateur sans responsable, appareil expiré, récurrence |
| `tests/contact-links.test.ts` | commandes intégrées `$$tel`, `$$mail`, `$$what`, `$$contact` : saisie repérée, alias, numéros (international pour WhatsApp), adresses, fiche vCard, liens conservés par le nettoyage du HTML |
| `tests/dependencies.test.ts` | enchaînement : attend / débloque, bloquée puis prête, boucles directes et indirectes refusées, suppression, journal, date de début (contrainte, récurrence) |
| `tests/gantt.test.ts` | barres et jalons, retard, échelle automatique, groupes par objet, conflits d'enchaînement, graduations, liste chronologique mobile, avancement |
| `tests/chat.test.ts` | chat avec un faux fournisseur : Claude (outil de Carnet puis réponse, outils et schémas transmis, résultat renvoyé), ChatGPT (fonctions, création de tâche journalisée « MCP · Chat Carnet »), suppressions selon l'autorisation, erreur d'outil, clé refusée, description de la page affichée, pièces jointes (image, PDF, texte transmis ; joindre_piece en photo et en document ; pièces d'un autre utilisateur invisibles ; ménage à 7 jours ; parties image/file pour ChatGPT), ouvrir_page (chemins de Carnet seulement, autre site, `//`, `javascript:` et `/api` refusés ; évènement navigate) |
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
| `e2e/sous-taches.spec.ts` | sous-tâches d'une tâche : ajout, case à cocher, ordre par flèches et par glisser-déposer, modification, durées sur la ligne et total, suppression, persistance |
| `e2e/ia.spec.ts` | type de tâche avec icône (choix, changement), clé d'API Claude, icône du type dans la liste, compléter la description, proposer des sous-tâches et une tâche voisine. Avec un faux serveur IA : lancer Carnet avec `ANTHROPIC_BASE_URL=http://127.0.0.1:3199` et les tests avec `E2E_FAKE_AI=1` (sinon seule la partie types est jouée) |
| `e2e/commandes.spec.ts` | commande créée et testée (erreur, boucle arrêtée, réseau coupé), code écrit par l'IA (faux serveur, comme `ia.spec.ts`), `@@` recalculé dans une description d'objet, `$$` inséré dans une tâche, commande inconnue, suppression |
| `e2e/description-objet.spec.ts` | description modifiée sur la fiche d'un objet : cases à cocher, image insérée (hors galerie), mise à niveau du texte et tâches proposées par l'IA (faux serveur, comme `ia.spec.ts`) |
| `e2e/recherche-objets.spec.ts` | recherche d'objets dans l'arbre : sans accents ni majuscules, chemin affiché, clavier, clic, aucun résultat |
| `e2e/journal.spec.ts` | historique sur la fiche d'un objet après création et modification d'une tâche, page Journal filtrée par origine |
| `e2e/rappels.spec.ts` | schéma créé par un admin (saisie souple, erreur), tâche avec date, heure et schéma, heure affichée dans la liste, prochain rappel sur la fiche, préférences de la page Rappels, route d'envoi refusée sans secret |
| `e2e/liens-contact.spec.ts` | `$$tel` choisi dans la liste, `$$mail`, `$$WHAT`, `$$contact` transformés en liens, adresse invalide signalée, liens enregistrés, fiche vCard servie (et refusée sans connexion) |
| `e2e/gestion-projet.spec.ts` | projet (objet), deux tâches avec début et échéance, « Attend » choisi par recherche, « Bloquée » dans la liste et sur la fiche, « Débloque », boucle refusée, carte Avancement, Gantt (conflit signalé, échelle) ou liste mobile, tâche « Prête » une fois l'autre faite |
| `e2e/assistant.spec.ts` | avec un faux serveur Claude (comme `ia.spec.ts`) : bulle ouverte depuis la fiche d'une tâche (page transmise au modèle), outil « Recherche de tâches · 1 tâche », réponse avec lien et gras, Échap, conversation qui suit d'une page à l'autre et en plein écran, puis effacée ; pièces jointes (PDF par le trombone, capture collée) transmises au modèle et affichées dans le message ; ouvrir_page affiche le journal depuis la bulle (fermée sur téléphone) et depuis la page Assistant (conversation reprise dans la bulle) ; sans clé, invitation à configurer |
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
