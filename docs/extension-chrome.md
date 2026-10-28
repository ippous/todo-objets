# Extension Chrome

[← Retour au README](../README.md)

L'extension **Carnet — ajouter la page** ajoute l'adresse de l'onglet courant comme **lien sur une tâche**. La tâche se choisit :

- **par son nom** (onglet *Rechercher*) : recherche dans le titre et la description des tâches ouvertes, ou de toutes les tâches avec *Inclure les tâches faites* ; sans recherche, les tâches **utilisées récemment** sont proposées ;
- **dans l'arborescence** (onglet *Arborescence*) : on déplie les objets, chacun affiche ses tâches ouvertes ; le nombre à droite d'un objet est celui des tâches ouvertes de sa branche. Les branches dépliées et le dernier onglet utilisé sont mémorisés.

Le titre du lien est celui de la page, modifiable avant l'ajout. Un clic sélectionne la tâche, **Ajouter** (ou un double-clic, ou `Entrée` deux fois dans la recherche) crée le lien ; le message de confirmation donne un lien vers la tâche.

Raccourci : `Alt` + `Maj` + `K` (modifiable dans `chrome://extensions/shortcuts`).

## Installation

L'extension n'est pas publiée sur le Chrome Web Store : elle se charge depuis le dossier [`extension/`](../extension) du dépôt.

1. Ouvrir `chrome://extensions` et activer le **Mode développeur** (en haut à droite).
2. **Charger l'extension non empaquetée** → choisir le dossier `extension/`.
3. Épingler l'icône Carnet dans la barre d'outils (pièce de puzzle → punaise).
4. Dans Carnet, *Connexion IA › Jeton personnel* : créer un jeton **Lecture et écriture** (ex. « Extension Chrome — PC bureau »).
5. Clic droit sur l'icône → **Options** : coller le jeton, puis **Enregistrer et tester**. Le message indique l'utilisateur connecté et les droits du jeton.

Après une mise à jour du dossier (`git pull`), cliquer sur ↻ dans `chrome://extensions`.

Fonctionne aussi dans Edge, Brave et les autres navigateurs Chromium.

## Fonctionnement technique

- **Manifest V3**, JavaScript sans étape de construction : `manifest.json`, `popup.html/js`, `options.html/js`, `carnet.js` (client), `style.css` (palette de l'application, thème clair et sombre).
- L'extension parle au **serveur MCP existant** (`/api/mcp`, voir [mcp.md](mcp.md)) : chaque action est un `tools/call` JSON-RPC autonome (transport sans session), authentifié par le jeton personnel dans `Authorization: Bearer …`. Aucune route dédiée côté serveur.
  - arborescence : `lister_objets` (`limite: 1000`), puis `rechercher_taches` avec `objet_id` à l'ouverture d'un objet, filtré sur les tâches directes de l'objet ;
  - recherche : `rechercher_taches` avec `recherche` ;
  - ajout : `ajouter_lien` avec `tache_id`, `url`, `titre` ;
  - test des réglages : `vue_ensemble` (utilisateur et droits).
- **Permissions** : `activeTab` (lire l'adresse et le titre de l'onglet au moment du clic, sans accès à l'historique ni aux autres onglets), `storage` (réglages, tâches récentes, branches dépliées), et l'hôte `https://todo.jaume-eric.com`.
- Le jeton est stocké dans `chrome.storage.local` (ce navigateur seulement, non synchronisé). Le révoquer dans *Connexion IA* coupe immédiatement l'accès.
- Seules les adresses `http` et `https` sont acceptées (les pages `chrome://`, fichiers locaux, etc. sont refusées dans la fenêtre).
- Un jeton en lecture seule permet de parcourir et chercher, mais l'ajout est refusé avec un message explicite.
