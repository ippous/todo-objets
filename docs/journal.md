# Journal des actions

[← Retour au README](../README.md)

Carnet garde une trace de chaque action faite sur les **objets** et les **tâches** (et sur ce qui y est rattaché) : **qui** l'a faite, **quand**, **par quel canal**, et **ce qui a changé**.

## Où le consulter

| Endroit | Contenu |
|---|---|
| Fiche d'un objet, bloc **Historique de l'objet et de ses tâches** (replié, en bas) | les 30 dernières actions sur l'objet et sur ses tâches (y compris celles supprimées depuis), lien vers la suite |
| Fiche d'une tâche, bloc **Historique de la tâche** | les 100 dernières actions sur la tâche |
| Page **Journal** (`/journal`, lien en haut de chaque page) | toutes les actions, filtrables par origine et par auteur, 100 par page (« Actions plus anciennes ») ; `?objet=<id>` ou `?tache=<id>` pour un seul élément |
| Outil MCP `consulter_historique` | le même journal pour un assistant IA (voir [mcp.md](mcp.md)) |

## Origine des actions

| Origine | Quand |
|---|---|
| **Interface** | une action faite dans l'application (formulaires, arbre, tableau, sous-tâches, photos…) |
| **MCP** | une action faite par un assistant IA ou par l'**extension Chrome** via `/api/mcp`. Le nom de l'application OAuth (ex. « Claude ») ou du jeton personnel (ex. « Extension Chrome ») est noté à côté |
| **API** | réservé aux futurs points d'entrée HTTP d'écriture (il n'y en a pas d'autre que le MCP aujourd'hui) |
| **Système** | réservé aux traitements automatiques |

L'auteur est toujours l'utilisateur connecté (ou le propriétaire du jeton). Son nom est copié dans l'entrée : il reste lisible même si l'utilisateur est supprimé.

## Actions enregistrées

| Élément | Actions |
|---|---|
| Objet | création (seul ou en lot, avec le parent), modification (champs changés avec ancienne et nouvelle valeur), déplacement (ancien et nouveau parent), suppression |
| Tâche | création (seule, en lot, ou occurrence suivante d'une tâche récurrente), modification (titre, objet, priorité, responsable, échéance, valeurs…), changement de statut (avec le réalisé saisi), suppression |
| Photos, documents, liens (d'un objet ou d'une tâche) | ajout, suppression, choix de la vignette, changement de type de document |
| Sous-tâches | ajout, case cochée ou décochée, texte modifié, suppression, nouvel ordre |

Pour une description, le journal indique « Description modifiée » ; l'ancien et le nouveau texte sont conservés en base (`details`). Enregistrer un formulaire sans rien changer n'ajoute pas d'entrée.

Ne sont pas tracés : les types, les utilisateurs et les accès IA (ils ont leurs propres pages), ni les lectures.

## Fonctionnement

- Table `audit_log` (migration `0007_journal`) : date, origine, application, auteur (id et nom), élément (`objet` ou `tache`, id, nom au moment de l'action), objet concerné (l'objet lui-même ou celui de la tâche), action, détails en JSON.
- Pas de clé étrangère vers l'élément : l'entrée **survit à la suppression** de l'objet ou de la tâche.
- L'enregistrement se fait dans `lib/repo.ts` : chaque fonction d'écriture reçoit un `Actor` facultatif (`lib/audit.ts`), et écrit l'entrée dans la même transaction quand il y en a une. Les Server Actions passent `actorOf(user, "interface")`, le serveur MCP `actorOf(user, "mcp", nomDuJeton)`. Sans auteur (scripts, migrations, tests), rien n'est écrit.
- La purge des données de test (`/api/test/purge`) efface aussi leurs entrées du journal.
