# Assistant (chat)

[← Retour au README](../README.md)

L'**assistant** se discute avec Claude ou ChatGPT **directement dans Carnet**, depuis n'importe quelle page :

- **bulle 💬 en bas à droite** de chaque page : elle ouvre une fenêtre flottante (plein écran sur téléphone) ; `Échap` ou × la ferme, la conversation reste ;
- bouton **plein écran** (⤢) : la page `/assistant`, avec la même conversation.

L'assistant sait **quelle page est affichée** : sur la fiche d'une tâche ou d'un objet, « cette tâche », « cet objet » ou « ici » la désignent. Après une modification faite par l'assistant, la page affichée se met à jour. L'assistant utilise les **mêmes outils que le serveur MCP** ([mcp.md](mcp.md)) : il cherche, lit et modifie objets et tâches pour répondre.

## Utilisation

- Écrire la demande, puis `Entrée` (`Maj+Entrée` pour aller à la ligne). Exemples proposés sur une conversation vide : tâches en retard, avancement d'un projet, création de tâche, tâches bloquées.
- Au-dessus de chaque réponse, les **outils utilisés** s'affichent en pastilles : vert = lecture, ocre = écriture, rouge = erreur. Le survol montre les paramètres et le résultat.
- Les tâches et objets cités sont des **liens** vers leur page.
- **Modèle** : choix entre les fournisseurs configurés (Claude, ChatGPT), avec le modèle réglé dans *Accès › Assistants IA*.
- **Arrêter** interrompt une réponse en cours. **Nouvelle conversation** efface l'historique.
- La conversation est gardée **dans ce navigateur** (60 derniers messages), pas sur le serveur ; elle suit d'une page à l'autre. Dans la fenêtre flottante, *Réglages* affiche le choix du modèle, l'autorisation des suppressions et *Nouvelle conversation*.

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
- Durée maximale de la route : 300 s.
