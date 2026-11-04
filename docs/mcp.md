# Accès des assistants IA (serveur MCP)

[← Retour au README](../README.md)

Carnet expose un **serveur MCP** (Model Context Protocol) qui permet à un assistant IA compatible de **lire** les objets et les tâches — et, si tu l'autorises, de les **modifier** : Claude (claude.ai, Desktop, Code), ChatGPT, Cursor, VS Code / Copilot, Windsurf, etc.

Chaque accès a l'un de ces trois niveaux de droits (chacun inclut le précédent) :

- **lecture seule** (par défaut) : uniquement les outils de lecture, y compris voir les photos et lire les documents ;
- **lecture et écriture** : en plus, créer et modifier des tâches et des sous-tâches, créer, modifier et déplacer des objets, ajouter des liens, des photos et des documents (avec leur description), créer des types ;
- **lecture, écriture et suppression** : en plus, supprimer des tâches, des sous-tâches, des objets vides, des photos, des documents et des liens. Une suppression est **définitive** ; ne l'accorde qu'aux accès qui en ont besoin.

| | |
|---|---|
| Adresse | `https://todo.jaume-eric.com/api/mcp` |
| Transport | Streamable HTTP (sans session) |
| Authentification | OAuth 2.1 (connecteurs) **ou** jeton personnel (`Authorization: Bearer …`) |
| Page de gestion | **Connexion IA** (`/connexion-ia`, lien en haut de chaque page) |

Le même jeu d'outils sert aussi à la page **Assistant** de Carnet (chat intégré) : voir [assistant.md](assistant.md).

## Se connecter

### 1. Connecteur avec connexion OAuth (claude.ai, ChatGPT…)

1. Dans l'assistant, ajoute un **connecteur personnalisé** avec l'adresse `https://todo.jaume-eric.com/api/mcp`.
   - claude.ai / Claude Desktop : Paramètres → Connecteurs → Ajouter un connecteur personnalisé.
   - ChatGPT : Paramètres → Applications et connecteurs → Créer (mode développeur si demandé).
2. L'assistant ouvre une page Carnet. Connecte-toi avec Google si besoin.
3. La page **« Autoriser « nom de l'application » ? »** rappelle ce qui sera accessible. Coche **Autoriser aussi les modifications** pour donner le droit d'écriture, et **Autoriser aussi les suppressions** pour le droit de suppression (cette case inclut les modifications). Chaque case est cochée d'office si l'application demande ce droit, décochée sinon. Clique ensuite sur **Autoriser** (ou **Refuser**).

Pour changer les droits d'une application déjà connectée : *Retirer l'accès*, puis reconnecter le connecteur.

L'application apparaît ensuite dans *Connexion IA › Applications autorisées*, avec la date de dernière utilisation ; **Retirer l'accès** la déconnecte immédiatement.

### 2. Jeton personnel (Claude Code, Cursor, VS Code, scripts…)

1. *Connexion IA › Jeton personnel* : donne un nom (ex. « Cursor sur le PC »), choisis **Lecture seule**, **Lecture et écriture** ou **Lecture, écriture et suppression**, puis **Créer un jeton**.
2. Copie le jeton `carnet_pat_…` : **il n'est affiché qu'une fois** (seule son empreinte est conservée).
3. Configure l'outil ; la page fournit les exemples prêts à copier :

```bash
# Claude Code
claude mcp add --transport http carnet https://todo.jaume-eric.com/api/mcp --header "Authorization: Bearer carnet_pat_…"
```

```json
// Cursor / Windsurf (mcp.json)
{ "mcpServers": { "carnet": { "url": "https://todo.jaume-eric.com/api/mcp",
  "headers": { "Authorization": "Bearer carnet_pat_…" } } } }
```

Les droits de chaque accès sont affichés dans *Connexion IA*. Un jeton personnel n'expire pas ; **Retirer l'accès** le révoque immédiatement. Traite-le comme un mot de passe.

## Outils de lecture (tous les accès)

Tous sont marqués *lecture seule* (`readOnlyHint`). Les résultats sont en JSON (montants en €, durées en heures, dates `AAAA-MM-JJ`, fuseau Europe/Paris) et contiennent une `url` vers la page Carnet.

| Outil | Paramètres | Renvoie |
|---|---|---|
| `vue_ensemble` | — | nombres d'objets et de tâches (ouvertes, en retard, faites), arbres racines et leurs cumuls, types d'objets et de documents, utilisateurs, valeurs possibles des champs, date du jour |
| `lister_objets` | `racine_id`, `profondeur_max`, `type`, `recherche`, `limite` | objets dans l'ordre de l'arbre : chemin, type, profondeur, nombre de sous-objets, cumuls de la branche (tâches ouvertes, heures, €) |
| `obtenir_objet` | `id`, `inclure_taches_faites` | fiche complète : chemin, description (texte), emplacement, tags, sous-objets, bilan, tâches de la branche, documents (identifiant, nom, description, type, format, taille, date, lien vers la visionneuse), liens (identifiant), photos (identifiant, description, vignette, dimensions, date) |
| `rechercher_taches` | `recherche`, `statut` (ouvertes·a_faire·en_cours·fait·toutes), `objet_id` (+ sous-arbre), `responsable` (nom, e-mail, « moi », « personne »), `categorie`, `priorite`, `tag`, `echeance_avant`, `en_retard`, `tri` (echeance·priorite·ratio·recent), `limite` | tâches avec objet et chemin, statut, priorité, début, échéance, retard, bloquée, valeurs estimées/réalisées, €/h, responsable |
| `obtenir_tache` | `id` | fiche complète : description (texte), sous-tâches (identifiant, texte, faite, durées), objet et chemin, valeurs, dates (début, échéance), enchaînement (`bloquee`, `attend`, `debloque`), responsable, créateur, documents, liens et photos (comme `obtenir_objet`) |
| `voir_photo` | `id`, `taille` (vignette·complete) | l'image elle-même (JPEG, 400 ou 1600 px) et sa description : l'assistant peut la regarder |
| `lire_document` | `id` | le contenu du document (10 Mo au plus) et sa description : texte pour TXT, Markdown, CSV, JSON et Word (.docx), image pour les images, fichier joint pour les PDF et les autres formats |
| `consulter_historique` | `objet_id` ou `tache_id`, `origine`, `apres`, `limite` | journal des actions, les plus récentes d'abord : date, origine (interface, mcp…), application, auteur, action, élément, détails lisibles ; `suite` pour la page suivante (voir [journal.md](journal.md)) |

Les descriptions (texte enrichi) sont converties en texte lisible : titres `##`, listes `-`, gras `**…**`, liens `texte (adresse)`. Les fiches listent les photos et les documents avec leurs métadonnées ; leur contenu se lit à la demande avec `voir_photo` et `lire_document`.

## Outils d'écriture (accès « lecture et écriture »)

Ils n'apparaissent que si l'accès a le droit d'écriture. Seuls les champs fournis changent ; `null` efface un champ facultatif. Les descriptions s'envoient en **Markdown simple** (`##` titres, `-` / `1.` listes, `**gras**`, `*italique*`, `[lien](https://…)`, `>` citation, `---`) et sont converties en texte enrichi nettoyé, comme celui de l'éditeur. Les erreurs (objet introuvable, boucle, responsable ou type inconnu, adresse invalide, format refusé) sont renvoyées en clair à l'assistant.

| Outil | Paramètres | Effet |
|---|---|---|
| `creer_tache` | `objet_id`, `titre` (obligatoires), `description`, `statut`, `priorite`, `categorie`, `date_debut`, `echeance`, `heure_echeance` (HH:MM), `dependances` (tâches attendues), `rappels` (schéma, ou « aucun »), `recurrence`, `responsable` (nom, e-mail, « moi », « personne »), `heures_estimees`, `valeur_estimee_eur`, `tags` | crée la tâche ; créateur = l'utilisateur du jeton |
| `modifier_tache` | `id` + n'importe quel champ ci-dessus, `objet_id` (changer d'objet), `heures_realisees`, `valeur_realisee_eur` | modifie ; `statut: "fait"` enregistre la fin et, si la tâche est récurrente, crée l'occurrence suivante (renvoyée dans `occurrence_suivante`) ; `dependances` remplace la liste des tâches attendues (`[]` la vide, boucle refusée) |
| `creer_objet` | `nom`, `parent_id` (absent = nouvel arbre), `type` (type existant), `description`, `emplacement`, `tags` | crée l'objet |
| `modifier_objet` | `id`, `nom`, `type`, `description`, `emplacement`, `tags` | modifie (le parent ne change pas) |
| `deplacer_objet` | `id`, `nouveau_parent_id` (ou `null` = racine) | déplace l'objet avec son sous-arbre ; les boucles sont refusées |
| `ajouter_lien` | `objet_id` **ou** `tache_id`, `url`, `titre`, `description` | ajoute un lien `http(s)` |
| `modifier_lien` | `id`, `description` (`null` = effacer) | change la description d'un lien |
| `ajouter_photo` | `image_base64` (ou `data:image/…;base64,…`, 10 Mo max), `tache_ids` et/ou `objet_ids` (50 au plus), `description` | ajoute la **même photo** (et la même légende) à chaque élément : redimensionnée côté serveur (1600 px, JPEG) avec vignette 400 px, comme depuis l'appli ; la première photo d'un élément devient sa vignette ; les identifiants introuvables sont listés dans `erreurs` |
| `modifier_photo` | `id`, `description` (`null` = effacer) | change la légende d'une photo |
| `ajouter_document` | `objet_id` **ou** `tache_id` ; `fichier_base64` + `nom_fichier` **ou** `url_source` (adresse `https` téléchargée par Carnet) ; `format` (type MIME, sinon déduit de l'extension), `type_document` (« Autre » par défaut), `description` | ajoute un document (formats acceptés dans l'appli, 25 Mo au plus) ; en base64, l'hébergeur limite la requête à environ 4 Mo : `url_source` pour les gros fichiers |
| `modifier_document` | `id`, `type_document`, `description` (`null` = effacer) | change le type et / ou la description |
| `ajouter_sous_taches` | `tache_id`, `sous_taches` (1 à 50 : `texte`, `heures_estimees`, `heures_realisees`, `faite`) | ajoute les sous-tâches en fin de liste |
| `modifier_sous_tache` | `id`, `texte`, `faite`, `heures_estimees`, `heures_realisees` | modifie (coche / décoche) une sous-tâche |
| `creer_type` | `categorie` (objet·document·tache), `nom`, `icone` (tâche seulement) | crée un type d'objet, de document ou de tâche (nom unique sans tenir compte des majuscules) |

## Outils de suppression (accès « lecture, écriture et suppression »)

Ils n'apparaissent que si l'accès a le droit de suppression. Ils sont marqués `destructiveHint: true` et leur description demande à l'assistant de faire confirmer chaque suppression. Les identifiants viennent de `obtenir_objet` / `obtenir_tache`. Chaque suppression est inscrite au journal (origine MCP).

| Outil | Paramètres | Effet |
|---|---|---|
| `supprimer_tache` | `id` | supprime la tâche avec ses sous-tâches, photos, documents et liens (fichiers effacés) |
| `supprimer_objet` | `id` | supprime un objet **sans sous-objet ni tâche** (sinon refus avec un message clair), avec ses photos, documents et liens |
| `supprimer_sous_tache` | `id` | supprime une sous-tâche |
| `supprimer_photo` | `id` | supprime une photo ; si c'était la vignette, la plus ancienne restante prend le relais (les images insérées dans une description sont refusées) |
| `supprimer_document` | `id` | supprime le document et son fichier |
| `supprimer_lien` | `id` | supprime un lien |

Annotations MCP : `readOnlyHint: false` ; création et ajout `destructiveHint: false` ; modification, déplacement et suppression `destructiveHint: true`, `idempotentHint: true` — les assistants demandent en général confirmation avant ces derniers.

## Exemples de questions

- « Quelles tâches sont en retard au Moulin ? »
- « Donne-moi les 5 tâches les plus rentables (€/h) à faire ce mois-ci. »
- « Qu'y a-t-il comme documents sur la chaudière ? »
- « Combien d'heures de travail restent prévues sur les pâtures ? »
- *(écriture)* « Ajoute une tâche “Changer le filtre à gasoil” sur le Valtra, échéance fin novembre, 1 h. »
- *(écriture)* « Marque la vidange du Renault comme faite, j'y ai passé 2 h. »
- *(écriture)* « Crée l'objet “Serre” sous Le Moulin Frat › Jardin et déplace-y les châssis. »
- *(écriture)* « Ajoute la notice https://…/notice.pdf à la pompe, type Mode d'emploi, avec la description “modèle 2019”. »
- *(écriture)* « Découpe la révision du Valtra en sous-tâches : vidange, filtres, graissage. »
- *(lecture)* « Regarde les photos de la grange et dis-moi ce qui a été fait. »
- *(suppression)* « Supprime le lien mort sur la chaudière. »

## Fonctionnement technique

- **Route** : `src/app/api/mcp/route.ts` — un `McpServer` (SDK officiel `@modelcontextprotocol/sdk`) est créé à chaque requête avec le transport `WebStandardStreamableHTTPServerTransport` en mode sans session et réponse JSON. Les outils de lecture sont dans `src/lib/mcp-server.ts`, ceux d'écriture dans `src/lib/mcp-write-tools.ts` (enregistrés seulement si le jeton porte la portée `ecriture`) et ceux de suppression dans `src/lib/mcp-delete-tools.ts` (portée `suppression`) ; tous réutilisent les requêtes de l'application (`src/lib/repo.ts`).
- **Sans jeton valide** : réponse `401` avec `WWW-Authenticate: Bearer … resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`, ce qui déclenche la découverte OAuth chez le client.
- **OAuth 2.1** (`src/lib/oauth.ts`, `src/lib/oauth-http.ts`) :
  - métadonnées : `/.well-known/oauth-protected-resource` (RFC 9728) et `/.well-known/oauth-authorization-server` (RFC 8414) ;
  - enregistrement dynamique des clients : `POST /api/oauth/register` (RFC 7591) — clients publics, adresses de retour `https`, `http://localhost` / `127.0.0.1`, ou schéma d'application (`cursor://…`) ;
  - autorisation : `/oauth/autoriser` — connexion Google, puis consentement ; **PKCE S256 obligatoire** ; portées : `lecture` (toujours), `ecriture` et `suppression` (si les cases sont cochées ; `suppression` inclut `ecriture` ; la portée accordée est renvoyée dans `scope` et conservée au rafraîchissement) ;
  - jetons : `POST /api/oauth/token` — code d'autorisation (usage unique, 10 min) et `refresh_token` ; jeton d'accès valable **1 h**, jeton de rafraîchissement **30 jours** avec **rotation** (réutiliser un ancien jeton révoque toute l'autorisation) ;
  - révocation : `POST /api/oauth/revoke` (RFC 7009) ou bouton *Retirer l'accès*.
- **Stockage** (migration `0005_acces_mcp`) : tables `oauth_clients`, `oauth_codes`, `api_tokens`. Seules les **empreintes SHA-256** des codes et jetons sont stockées. Un utilisateur désactivé perd immédiatement l'accès, quel que soit le jeton.
- **CORS** ouvert sur ces routes (les jetons ne transitent que par l'en-tête `Authorization`, jamais par cookie).
- **Dev** : `https://dev.todo.jaume-eric.com/api/mcp` existe aussi, mais il est derrière la protection Vercel ; les assistants doivent utiliser la **production**.
