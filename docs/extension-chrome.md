# Extension Chrome

[← Retour au README](../README.md)

L'extension **Carnet** ajoute, depuis le navigateur, à une **tâche** ou à un **objet** :

- **un lien** : l'adresse de l'onglet courant, avec son titre (modifiable) ;
- **une photo** : capture de la page, image d'une page (clic droit), image collée ou glissée, ou fichier ;
- **un document** : fichier (PDF, Word, Excel…), page ouverte dans l'onglet (un PDF, par exemple) ou lien d'une page (clic droit).

Les trois peuvent recevoir une **description** (champ *Description (facultative)* sous la carte).

## Utilisation

### Choisir la cible (tâche ou objet)

- **Rechercher** : le texte est cherché dans les tâches (titre et description, ouvertes ou toutes avec *Inclure les tâches faites*) et dans les objets (nom et description). Sans recherche, les **tâches et objets utilisés récemment** sont proposés.
- **Arborescence** : un clic sur le nom d'un objet le **choisit** et le déplie ; la flèche déplie sans choisir. Chaque objet affiche ses tâches ouvertes ; le nombre à droite est celui des tâches ouvertes de la branche. Les branches dépliées et le dernier onglet utilisé sont mémorisés.

La cible choisie est rappelée en bas (« Tâche … » ou « Objet … » avec son chemin). **Ajouter**, un double-clic sur la cible, ou `Entrée` deux fois dans la recherche, envoie. Après un ajout, on peut choisir une autre cible (ou changer la description) pour y envoyer le même lien, la même photo ou le même document.

### Description

Le champ **Description (facultative)**, sous la carte du lien, de la photo ou du document, est envoyé avec l'élément : description du lien, légende de la photo, description du document. Texte simple, 2 000 caractères au plus ; il reste rempli d'un ajout à l'autre. Elle se modifie ensuite sur la fiche, dans Carnet.

### Lien

Mode **Lien** (par défaut) : la page courante, titre modifiable. Seules les adresses `http` et `https` sont acceptées ; sur une autre page (`chrome://…`, fichier local…), l'extension s'ouvre en mode Photo.

### Photo

Mode **Photo**, l'image vient de :

| Source | Comment |
|---|---|
| Capture de la page | bouton **Capturer la page** : la partie visible de l'onglet |
| Presse-papiers | `Ctrl+V` dans la fenêtre (ex. après `Win+Maj+S`) — bascule automatiquement en mode Photo |
| Glisser-déposer | un fichier depuis l'explorateur, ou une image depuis une page web |
| Fichier | bouton **Fichier…** |
| Image d'une page | **clic droit sur l'image › Ajouter cette image à Carnet** : la fenêtre s'ouvre avec l'image |

Pour une image d'un autre site, Chrome peut demander l'**accès à ce site** (bouton *Autoriser ce site*) : l'autorisation est demandée site par site, au moment voulu, et se retire dans `chrome://extensions` › Carnet › Détails › Accès aux sites.

L'image est réduite dans le navigateur à **1600 px** (JPEG), la taille que Carnet conserve de toute façon : l'envoi reste rapide et sous la limite de taille des requêtes de Vercel (4,5 Mo). Les formats lisibles par Chrome sont acceptés (JPEG, PNG, WebP, GIF, AVIF…) ; un HEIC d'iPhone est à convertir d'abord.

### Document

Mode **Document**, le fichier vient de :

| Source | Comment |
|---|---|
| Fichier | bouton **Fichier…** |
| Glisser-déposer | un fichier depuis l'explorateur (en mode Document, une image devient aussi un document ; hors de ce mode, un fichier qui n'est pas une image bascule en mode Document) |
| Presse-papiers | `Ctrl+V` d'un fichier copié dans l'explorateur |
| Page courante | bouton **Page courante** : l'adresse de l'onglet. Un onglet qui affiche un PDF, un `.docx`… ouvre directement l'extension en mode Document |
| Lien d'une page | **clic droit sur un lien › Ajouter ce document à Carnet** |

Le **Type** (Facture, Garantie, Mode d'emploi…) se choisit dans la liste des types de documents de Carnet ; « Autre » par défaut.

- Formats : ceux de Carnet (PDF, Word, Excel, PowerPoint, ODT, ODS, images, texte, Markdown, CSV, JSON, ZIP).
- **Fichier local** : envoyé par l'extension, **3 Mo au plus** (la requête est limitée à 4,5 Mo par Vercel, et le contenu grossit d'un tiers en base64). Au-delà, l'ajouter depuis la fiche dans Carnet (25 Mo).
- **Adresse** (page courante, lien) : c'est **Carnet qui télécharge** le fichier (25 Mo au plus, `https` uniquement). L'adresse doit être publique : un fichier derrière une connexion (intranet, espace client…) est refusé ; l'enregistrer puis passer par **Fichier…**.

Raccourci : `Alt` + `Maj` + `K` (modifiable dans `chrome://extensions/shortcuts`).

## Installation

L'extension n'est pas publiée sur le Chrome Web Store : elle se charge depuis le dossier [`extension/`](../extension) du dépôt.

1. Ouvrir `chrome://extensions` et activer le **Mode développeur** (en haut à droite).
2. **Charger l'extension non empaquetée** → choisir le dossier `extension/` (celui qui contient `manifest.json`).
3. Épingler l'icône Carnet dans la barre d'outils (pièce de puzzle → punaise).
4. Dans Carnet, *Connexion IA › Jeton personnel* : créer un jeton **Lecture et écriture** (ex. « Extension Chrome — PC bureau »).
5. Clic droit sur l'icône → **Options** : coller le jeton, puis **Enregistrer et tester**. Le message indique l'utilisateur connecté et les droits du jeton.

Après une mise à jour du dossier (`git pull`), cliquer sur ↻ dans `chrome://extensions` (version actuelle : **0.3.0**, avec le mode Document et les descriptions ; le nouveau menu « Ajouter ce document à Carnet » n'apparaît qu'après ce rechargement). Fonctionne aussi dans Edge, Brave et les autres navigateurs Chromium.

## Fonctionnement technique

- **Manifest V3**, JavaScript sans étape de construction :

  | Fichier | Rôle |
  |---|---|
  | `manifest.json` | déclaration, permissions, raccourci |
  | `background.js` | menus contextuels des images et des liens ; ouvre la fenêtre (`action.openPopup`, ou une petite fenêtre `popup.html?fenetre=1` si Chrome le refuse) en passant l'image ou le lien par `chrome.storage.session` |
  | `popup.html/js` | fenêtre : mode Lien/Photo/Document, description, recherche, arbre, envoi |
  | `image.js` | téléchargement et réduction des images (`createImageBitmap` + `OffscreenCanvas`, JPEG 0,9, fond blanc pour la transparence) |
  | `document.js` | formats acceptés (les mêmes que `src/lib/document-types.ts`), limite de 3 Mo, lecture en base64 |
  | `carnet.js` | client MCP |
  | `options.html/js` | réglages et test du jeton |
  | `style.css` | palette de l'application, thème clair et sombre |

- L'extension parle au **serveur MCP existant** (`/api/mcp`, voir [mcp.md](mcp.md)) : chaque action est un `tools/call` JSON-RPC autonome (transport sans session), authentifié par le jeton personnel dans `Authorization: Bearer …`. Aucune route dédiée côté serveur.
  - recherche : `rechercher_taches` (`recherche`) et `lister_objets` (`recherche`, 8 au plus), en parallèle ;
  - arborescence : `lister_objets` (`limite: 1000`), puis `rechercher_taches` avec `objet_id` à l'ouverture d'un objet, filtré sur ses tâches directes ;
  - ajout : `ajouter_lien` (`tache_id` ou `objet_id`, `url`, `titre`, `description`), `ajouter_photo` (`image_base64` en `data:image/jpeg;base64,…`, `tache_ids` ou `objet_ids`, `description`) et `ajouter_document` (`tache_id` ou `objet_id`, `nom_fichier` + `fichier_base64` + `format`, ou `url_source` ; `type_document`, `description`) ;
  - types de documents et test des réglages : `vue_ensemble` (types, utilisateur et droits).
- **Permissions** :
  - `activeTab` : adresse, titre et capture de l'onglet, seulement au moment où l'on ouvre l'extension (ou après le clic droit) ; pas d'accès à l'historique ni aux autres onglets ;
  - `storage` : réglages, cibles récentes, branches dépliées, image en attente ;
  - `contextMenus` : les entrées du clic droit sur les images et sur les liens ;
  - hôte `https://todo.jaume-eric.com` ; **facultatif** `<all_urls>`, demandé **site par site** seulement pour lire une image d'un site qui ne l'autorise pas d'office (CORS).
- Le jeton est stocké dans `chrome.storage.local` (ce navigateur seulement, non synchronisé). Le révoquer dans *Connexion IA* coupe immédiatement l'accès.
- Un jeton en lecture seule permet de parcourir et chercher, mais l'ajout est refusé avec un message explicite.
