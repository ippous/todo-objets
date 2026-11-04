# Assistant (chat)

[← Retour au README](../README.md)

L'**assistant** se discute avec Claude ou ChatGPT **directement dans Carnet**, depuis n'importe quelle page :

- **bulle 💬 en bas à droite** de chaque page : elle ouvre une fenêtre flottante (plein écran sur téléphone) ; `Échap` ou × la ferme, la conversation reste ;
- bouton **plein écran** (⤢) : la page `/assistant`, avec la même conversation.

L'assistant sait **quelle page est affichée** : sur la fiche d'une tâche ou d'un objet, « cette tâche », « cet objet » ou « ici » la désignent. Après une modification faite par l'assistant, la page affichée se met à jour. L'assistant utilise les **mêmes outils que le serveur MCP** ([mcp.md](mcp.md)) : il cherche, lit et modifie objets et tâches pour répondre.

## Utilisation

- Écrire la demande, puis `Entrée` (`Maj+Entrée` pour aller à la ligne). Exemples proposés sur une conversation vide : tâches en retard, avancement d'un projet, création de tâche, tâches bloquées.
- Au-dessus de chaque réponse, les **outils utilisés** s'affichent en pastilles : vert = lecture, ocre = écriture, rouge = erreur. Le survol montre les paramètres et le résultat.
- Les tâches et objets cités sont des **liens** vers leur page ; les suivre garde la conversation ouverte (sauf sur téléphone, où la fenêtre se ferme pour montrer la page).
- **Ouvrir une page** : « ouvre la tâche Chaudière », « montre-moi le Gantt de la grange », « va sur le journal ». L'assistant trouve la page (outil `ouvrir_page`) et l'affiche **à la fin de sa réponse** : fiche de tâche ou d'objet, arbre, liste des tâches avec filtres (vue tableau ou Gantt, sous-arbre d'un objet, recherche, statut, priorité, échéance…), nouvelle tâche ou nouvel objet pré-rattaché, journal, rappels, types, commandes. Seules les pages de Carnet sont acceptées (ni autre site, ni API). Depuis la page Assistant en plein écran, la conversation continue dans la fenêtre flottante (sur ordinateur).
- **Modèle** : choix entre les fournisseurs configurés (Claude, ChatGPT), avec le modèle réglé dans *Accès › Assistants IA*.
- **Arrêter** interrompt une réponse en cours. **Nouvelle conversation** efface l'historique.
- La conversation est gardée **dans ce navigateur** (60 derniers messages), pas sur le serveur ; elle suit d'une page à l'autre. Dans la fenêtre flottante, *Réglages* affiche le choix du modèle, l'autorisation des suppressions et *Nouvelle conversation*.

## Images et documents

- **Joindre** (trombone 📎) : parcourir les fichiers de l'appareil (sur téléphone : photothèque, appareil photo ou fichiers), plusieurs à la fois ; **coller** (`Ctrl+V`) une capture d'écran ou un fichier copié ; ou **glisser-déposer** sur la zone de saisie.
- 6 pièces au plus par message, **4 Mo** chacune ; les photos sont réduites à 1600 px avant l'envoi. Formats : ceux des documents de Carnet (images, PDF, Word, Excel, PowerPoint, ODT, ODS, texte, CSV, JSON, ZIP).
- L'assistant **voit** les images et les PDF, et lit le texte des fichiers texte, CSV, Word et Excel ; pour les autres formats, il n'a que le nom.
- Il peut les **ranger dans Carnet** : « ajoute cette facture à la tâche Chaudière » → l'outil `joindre_piece` en fait une **photo** (image) ou un **document** (autre fichier, ou image demandée en document), avec description et type de document.
- Les pièces sont gardées **7 jours** (ménage lors du passage de la tâche planifiée des rappels), visibles seulement par la personne qui les a envoyées ; leur contenu n'est renvoyé au modèle que pour les 2 derniers messages qui en ont (coût), les plus anciennes restant rangeables par leur identifiant.
- Sur téléphone, suivre un lien depuis le chat ferme la fenêtre pour afficher la page.

## Droits

- L'assistant agit **avec les droits de l'utilisateur connecté** : lecture et écriture (tâches, sous-tâches, objets, liens, photos, documents, types).
- **Suppressions** : seulement si *Autoriser les suppressions* est coché pour la demande ; il doit de toute façon demander confirmation avant de supprimer.
- Il est invité à résumer et demander confirmation avant une modification importante ou en lot.
- Chaque action est inscrite au **journal**, origine *MCP*, application *Chat Carnet*.

## Configuration et coût

Il faut au moins une clé d'API (Claude ou ChatGPT) dans *Accès › Assistants IA* (administrateurs) ; sans clé, la page l'indique. L'usage est facturé par le fournisseur sur ce compte : une demande enchaîne souvent plusieurs appels (un par étape d'outils, **12 au plus** par demande).

## Fonctionnement technique

- `src/components/chat-widget.tsx` (bulle et fenêtre, dans la mise en page commune) et `src/components/chat-panel.tsx` (conversation, partagée avec la page `/assistant`).
- `POST /api/assistant` (session obligatoire) reçoit l'historique (`{ role, text }`), le fournisseur, l'autorisation de supprimer et la page affichée (`page`, décrite au modèle par `describePage`) ; la réponse est un flux **NDJSON** : `tool` (appel d'outil), `tool_result` (résumé), `text`, `error`, `done`.
- `src/lib/chat.ts` construit le serveur MCP de Carnet **en mémoire** (`buildMcpServer` + `InMemoryTransport`, client « Chat Carnet »), passe la liste de ses outils au modèle (outils Anthropic ou fonctions OpenAI), exécute les appels demandés et renvoie les résultats, jusqu'à la réponse finale.
- Les images renvoyées par `voir_photo` sont transmises au modèle (bloc image pour Claude ; message utilisateur `image_url` pour ChatGPT, dont les messages d'outil n'acceptent que du texte). Le texte d'un résultat est limité à 40 000 caractères.
- Les adresses d'API suivent `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` (faux serveur des tests e2e).
- Pièces jointes : `POST /api/assistant/pieces` (fichier, 4 Mo au plus), lecture `GET /api/assistant/pieces/[id]` (propriétaire seulement), table `chat_attachments`, fichiers sous `<env>/assistant/<utilisateur>/…` ; `src/lib/chat-pieces.ts` prépare le contenu pour le modèle (bloc image / document PDF pour Claude, `image_url` / `file` pour ChatGPT, texte extrait sinon).
- Durée maximale de la route : 300 s.
