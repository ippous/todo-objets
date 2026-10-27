# Accès des assistants IA (serveur MCP)

[← Retour au README](../README.md)

Carnet expose un **serveur MCP** (Model Context Protocol) qui permet à un assistant IA compatible de **lire** les objets et les tâches — et, si tu l'autorises, de les **modifier** : Claude (claude.ai, Desktop, Code), ChatGPT, Cursor, VS Code / Copilot, Windsurf, etc.

Chaque accès a l'un de ces deux niveaux de droits :

- **lecture seule** (par défaut) : uniquement les outils de lecture ;
- **lecture et écriture** : en plus, créer et modifier des tâches, créer, modifier et déplacer des objets, ajouter des liens. **Aucune suppression** n'est possible par le MCP, ni l'ajout de photos ou de documents : cela reste dans l'application.

| | |
|---|---|
| Adresse | `https://todo.jaume-eric.com/api/mcp` |
| Transport | Streamable HTTP (sans session) |
| Authentification | OAuth 2.1 (connecteurs) **ou** jeton personnel (`Authorization: Bearer …`) |
| Page de gestion | **Connexion IA** (`/connexion-ia`, lien en haut de chaque page) |

## Se connecter

### 1. Connecteur avec connexion OAuth (claude.ai, ChatGPT…)

1. Dans l'assistant, ajoute un **connecteur personnalisé** avec l'adresse `https://todo.jaume-eric.com/api/mcp`.
   - claude.ai / Claude Desktop : Paramètres → Connecteurs → Ajouter un connecteur personnalisé.
   - ChatGPT : Paramètres → Applications et connecteurs → Créer (mode développeur si demandé).
2. L'assistant ouvre une page Carnet. Connecte-toi avec Google si besoin.
3. La page **« Autoriser « nom de l'application » ? »** rappelle ce qui sera accessible. Coche **Autoriser aussi les modifications** pour donner le droit d'écriture (case cochée d'office si l'application le demande, décochée sinon), puis clique sur **Autoriser** (ou **Refuser**).

Pour changer les droits d'une application déjà connectée : *Retirer l'accès*, puis reconnecter le connecteur.

L'application apparaît ensuite dans *Connexion IA › Applications autorisées*, avec la date de dernière utilisation ; **Retirer l'accès** la déconnecte immédiatement.

### 2. Jeton personnel (Claude Code, Cursor, VS Code, scripts…)

1. *Connexion IA › Jeton personnel* : donne un nom (ex. « Cursor sur le PC »), choisis **Lecture seule** ou **Lecture et écriture**, puis **Créer un jeton**.
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
| `obtenir_objet` | `id`, `inclure_taches_faites` | fiche complète : chemin, description (texte), emplacement, tags, sous-objets, bilan, tâches de la branche, documents (lien vers la visionneuse), liens, nombre de photos |
| `rechercher_taches` | `recherche`, `statut` (ouvertes·a_faire·en_cours·fait·toutes), `objet_id` (+ sous-arbre), `responsable` (nom, e-mail, « moi », « personne »), `categorie`, `priorite`, `tag`, `echeance_avant`, `en_retard`, `tri` (echeance·priorite·ratio·recent), `limite` | tâches avec objet et chemin, statut, priorité, échéance, retard, valeurs estimées/réalisées, €/h, responsable |
| `obtenir_tache` | `id` | fiche complète : description (texte), objet et chemin, valeurs, dates, responsable, créateur, documents, liens, nombre de photos |

Les descriptions (texte enrichi) sont converties en texte lisible : titres `##`, listes `-`, gras `**…**`, liens `texte (adresse)`. Le contenu des fichiers (documents, photos) n'est pas transmis : l'assistant reçoit leur nom, leur type et l'adresse de la visionneuse.

## Outils d'écriture (accès « lecture et écriture »)

Ils n'apparaissent que si le jeton a le droit d'écriture. Seuls les champs fournis changent ; `null` efface un champ facultatif. Les descriptions s'envoient en **Markdown simple** (`##` titres, `-` / `1.` listes, `**gras**`, `*italique*`, `[lien](https://…)`, `>` citation, `---`) et sont converties en texte enrichi nettoyé, comme celui de l'éditeur. Les erreurs (objet introuvable, boucle, responsable ou type inconnu, adresse invalide) sont renvoyées en clair à l'assistant.

| Outil | Paramètres | Effet |
|---|---|---|
| `creer_tache` | `objet_id`, `titre` (obligatoires), `description`, `statut`, `priorite`, `categorie`, `echeance`, `recurrence`, `responsable` (nom, e-mail, « moi », « personne »), `heures_estimees`, `valeur_estimee_eur`, `tags` | crée la tâche ; créateur = l'utilisateur du jeton |
| `modifier_tache` | `id` + n'importe quel champ ci-dessus, `objet_id` (changer d'objet), `heures_realisees`, `valeur_realisee_eur` | modifie ; `statut: "fait"` enregistre la fin et, si la tâche est récurrente, crée l'occurrence suivante (renvoyée dans `occurrence_suivante`) |
| `creer_objet` | `nom`, `parent_id` (absent = nouvel arbre), `type` (type existant), `description`, `emplacement`, `tags` | crée l'objet |
| `modifier_objet` | `id`, `nom`, `type`, `description`, `emplacement`, `tags` | modifie (le parent ne change pas) |
| `deplacer_objet` | `id`, `nouveau_parent_id` (ou `null` = racine) | déplace l'objet avec son sous-arbre ; les boucles sont refusées |
| `ajouter_lien` | `objet_id` **ou** `tache_id`, `url`, `titre` | ajoute un lien `http(s)` |

Annotations MCP : `readOnlyHint: false` ; création et ajout `destructiveHint: false` ; modification et déplacement `destructiveHint: true`, `idempotentHint: true` — les assistants demandent en général confirmation avant ces derniers.

## Exemples de questions

- « Quelles tâches sont en retard au Moulin ? »
- « Donne-moi les 5 tâches les plus rentables (€/h) à faire ce mois-ci. »
- « Qu'y a-t-il comme documents sur la chaudière ? »
- « Combien d'heures de travail restent prévues sur les pâtures ? »
- *(écriture)* « Ajoute une tâche “Changer le filtre à gasoil” sur le Valtra, échéance fin novembre, 1 h. »
- *(écriture)* « Marque la vidange du Renault comme faite, j'y ai passé 2 h. »
- *(écriture)* « Crée l'objet “Serre” sous Le Moulin Frat › Jardin et déplace-y les châssis. »

## Fonctionnement technique

- **Route** : `src/app/api/mcp/route.ts` — un `McpServer` (SDK officiel `@modelcontextprotocol/sdk`) est créé à chaque requête avec le transport `WebStandardStreamableHTTPServerTransport` en mode sans session et réponse JSON. Les outils de lecture sont dans `src/lib/mcp-server.ts`, ceux d'écriture dans `src/lib/mcp-write-tools.ts` (enregistrés seulement si le jeton porte la portée `ecriture`) ; tous réutilisent les requêtes de l'application (`src/lib/repo.ts`).
- **Sans jeton valide** : réponse `401` avec `WWW-Authenticate: Bearer … resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`, ce qui déclenche la découverte OAuth chez le client.
- **OAuth 2.1** (`src/lib/oauth.ts`, `src/lib/oauth-http.ts`) :
  - métadonnées : `/.well-known/oauth-protected-resource` (RFC 9728) et `/.well-known/oauth-authorization-server` (RFC 8414) ;
  - enregistrement dynamique des clients : `POST /api/oauth/register` (RFC 7591) — clients publics, adresses de retour `https`, `http://localhost` / `127.0.0.1`, ou schéma d'application (`cursor://…`) ;
  - autorisation : `/oauth/autoriser` — connexion Google, puis consentement ; **PKCE S256 obligatoire** ; portées : `lecture` (toujours) et `ecriture` (si la case est cochée ; la portée accordée est renvoyée dans `scope` et conservée au rafraîchissement) ;
  - jetons : `POST /api/oauth/token` — code d'autorisation (usage unique, 10 min) et `refresh_token` ; jeton d'accès valable **1 h**, jeton de rafraîchissement **30 jours** avec **rotation** (réutiliser un ancien jeton révoque toute l'autorisation) ;
  - révocation : `POST /api/oauth/revoke` (RFC 7009) ou bouton *Retirer l'accès*.
- **Stockage** (migration `0005_acces_mcp`) : tables `oauth_clients`, `oauth_codes`, `api_tokens`. Seules les **empreintes SHA-256** des codes et jetons sont stockées. Un utilisateur désactivé perd immédiatement l'accès, quel que soit le jeton.
- **CORS** ouvert sur ces routes (les jetons ne transitent que par l'en-tête `Authorization`, jamais par cookie).
- **Dev** : `https://dev.todo.jaume-eric.com/api/mcp` existe aussi, mais il est derrière la protection Vercel ; les assistants doivent utiliser la **production**.
