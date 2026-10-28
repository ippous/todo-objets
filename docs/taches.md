# Tâches

[← Retour au README](../README.md)

Une **tâche** est toujours rattachée à **un objet**. Elle apparaît sur la fiche de cet objet et sur celles de tous ses ancêtres, et elle compte dans leurs cumuls.

## Champs

| Champ | Valeurs | Remarque |
|---|---|---|
| Titre | texte | obligatoire |
| Objet | un objet de l'arbre | obligatoire, modifiable : la tâche change alors d'objet |
| Description | texte enrichi | facultatif, éditeur WYSIWYG (voir [arbre-et-objets.md](arbre-et-objets.md#description-en-texte-enrichi)) |
| Durée estimée / réalisée | heures, décimales acceptées (`2,5`) | |
| Valeur estimée / réalisée | euros | coût ou gain, au choix de l'utilisateur |
| Priorité | haute, moyenne, basse | moyenne par défaut |
| Statut | à faire, en cours, fait | |
| Échéance | date | facultative ; une tâche ouverte dont l'échéance est passée est marquée « En retard » |
| Récurrence | aucune, mensuelle, saisonnière (3 mois), annuelle | voir plus bas |
| Responsable | un utilisateur autorisé | ou personne |
| Catégorie | entretien, travaux, administratif | |
| Tags | liste libre | séparés par des virgules |

**Ratio €/h** : valeur estimée ÷ durée estimée. Il s'affiche sur chaque tâche et sert de critère de tri pour repérer les tâches les plus rentables.

## Sous-tâches

En haut de la fiche d'une tâche, une **liste ordonnée de sous-tâches** : chacune n'est qu'un texte (300 caractères au plus) et une case à cocher. Le compteur « 2 sur 5 faites » résume l'avancement.

- **Ajouter** : champ en bas de la liste, puis Entrée ou « Ajouter ». La nouvelle sous-tâche se place en dernier.
- **Cocher / décocher** : enregistré aussitôt.
- **Réordonner** : glisser une ligne (souris) au-dessus ou au-dessous d'une autre, ou utiliser les flèches ↑ ↓ de la ligne (tactile, clavier).
- **Modifier** le texte, ou **Supprimer** la sous-tâche.

Les sous-tâches disparaissent avec leur tâche. L'occurrence suivante d'une tâche récurrente les reprend, toutes décochées. Côté base : table `subtasks` (`todo_id`, `title`, `done`, `position`) ; un réordonnancement n'est accepté qu'avec la liste complète des sous-tâches de la tâche.

## Statut rapide

Sur chaque ligne de tâche, un sélecteur change le statut sans ouvrir la fiche.

## Récurrence

Quand une tâche récurrente passe à **« fait »**, l'occurrence suivante est créée automatiquement :

- même titre, objet, réglages, tags et sous-tâches (décochées) ;
- statut « à faire », valeurs réalisées vides ;
- échéance décalée d'1, 3 ou 12 mois à partir de l'échéance précédente (ou de la date du jour sans échéance).

Une seule occurrence suivante est créée, même si l'on repasse plusieurs fois la tâche à « fait » : un index unique sur `previous_occurrence_id` le garantit.

## Liste des tâches (`/taches`)

C'est la vue « à plat » de toutes les tâches, avec leur vignette quand elles ont une photo.

| Filtre | Effet |
|---|---|
| Recherche | dans le titre et le texte de la description (pas dans la mise en forme) |
| Statut | ouvertes (par défaut), à faire, en cours, faites, toutes |
| Responsable | tout le monde, moi, personne, ou un utilisateur |
| Catégorie, Priorité, Tag | |
| Dans l'objet | l'objet choisi **et tout son sous-arbre** |
| Échéance avant le | date limite |

Tris possibles : **échéance**, **priorité**, **ratio €/h**, **plus récentes**. Les filtres sont dans l'URL, qu'on peut donc mettre en favori ou partager.

## Tableau (`/taches?vue=tableau`)

Le bouton **Affichage : Liste / Tableau** en haut de la liste bascule vers une vue « kanban » : une colonne par statut (**à faire**, **en cours**, **fait**). Les autres filtres et le tri s'appliquent ; le filtre de statut est masqué puisque les trois statuts sont affichés.

| Regrouper | Effet |
|---|---|
| Sans regroupement | toutes les tâches dans les trois colonnes |
| Par objet racine | un couloir horizontal par racine de l'arbre (dans l'ordre de l'arbre), qui réunit les tâches de tout son sous-arbre |

Pour changer le statut d'une tâche, on **glisse sa carte** dans une autre colonne (souris), ou on utilise les flèches de la carte (tactile, clavier). Le changement est enregistré aussitôt. Une tâche passée à « fait » de cette façon reprend sa durée et sa valeur estimées comme réalisées (si rien n'était saisi), et une tâche récurrente crée son occurrence suivante comme d'habitude.

## Fiche d'une tâche (`/taches/[id]`)

De haut en bas : les [photos](photos.md), les [documents et liens](documents-et-liens.md) de la tâche, puis le formulaire *Détails de la tâche* pour modifier tous les champs, et la suppression (avec confirmation), qui efface aussi les photos, documents et liens de la tâche.

## Créer des tâches

- **« + Ajouter une tâche »** dans la navigation ;
- **« Ajouter une tâche »** sur la fiche d'un objet, qui pré-remplit l'objet ;
- **ajout en lot** depuis le menu « … » de l'arbre ou la fiche d'un objet (voir [ajout-en-lot.md](ajout-en-lot.md)).
