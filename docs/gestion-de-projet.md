# Gestion de projet : enchaînement, Gantt, avancement

[← Retour au README](../README.md)

Carnet n'a pas d'objet « projet » à part : **un objet et son sous-arbre font office de projet** (la grange, une pâture, « Formalités »…). Trois ajouts légers suffisent à le suivre dans le temps.

## Enchaîner des tâches

Sur une tâche, le champ **« Attend (tâches à terminer avant) »** liste les tâches qui doivent être faites avant elle (lien *fin → début*, le seul géré).

- On cherche une tâche par son titre ou son objet, puis on la choisit ; × la retire. N'importe quelle tâche ouverte de Carnet peut être attendue, même d'un autre objet.
- Tant qu'une tâche attendue n'est pas faite, la tâche est **« Bloquée »** : étiquette dans la liste, le tableau, le Gantt, et en haut de sa fiche (« Bloquée : attend « … » »). Quand toutes sont faites, la fiche indique **« Prête »**.
- La fiche d'une tâche attendue montre ce qu'elle **débloque**.
- **Boucles refusées** : si B attend A, A ne peut pas attendre B (ni C qui attend B…). Le message nomme la tâche en cause et rien n'est enregistré.
- Quand la dernière tâche attendue passe à « fait » (fiche, liste, tableau ou assistant IA), le responsable de la tâche débloquée (ou, à défaut, son créateur) reçoit une notification **« Prête · … »**, sur les canaux choisis dans *Rappels* (notification, e-mail).
- Supprimer une tâche retire ses liens d'enchaînement. L'occurrence suivante d'une tâche récurrente ne reprend pas ces liens.
- Rien n'est obligatoire : une tâche sans « Attend » se comporte comme avant.

Les dates ne sont **jamais déplacées automatiquement** : un enchaînement incohérent (la suite commence avant la fin de ce qu'elle attend) est seulement **signalé** dans le Gantt.

## Date de début

Champ **« Début (facultatif) »**, à côté de l'échéance. Il doit précéder (ou égaler) l'échéance. Pour une tâche récurrente, l'occurrence suivante garde le même écart entre début et échéance.

## Vue Gantt (`/taches?vue=gantt`)

Troisième affichage de la liste des tâches, après *Liste* et *Tableau* ; tous les filtres s'appliquent. Le filtre **« Dans l'objet »** choisit le projet ; le statut *Toutes* montre aussi ce qui est fait.

| Élément | Signification |
|---|---|
| Barre | du début à l'échéance (inclus) ; titre dans la barre quand elle est assez large |
| Losange | une seule date (échéance, ou début sans échéance) |
| Couleurs | à faire (ocre clair), en cours (vert), fait (vert pâle), en retard (rouge) ; hachures = bloquée |
| Flèche | enchaînement ; **rouge en pointillé** si la tâche suivante commence avant la fin de celle qu'elle attend, avec le nombre de conflits au-dessus |
| Trait rouge vertical | aujourd'hui (la frise s'ouvre dessus) |
| Groupes | une bande par objet, dans l'ordre chronologique |

- **Échelle** : *Jours* (week-ends grisés), *Semaines*, *Mois* ; choisie automatiquement selon l'étendue (≤ 45 jours, ≤ 8 mois, au-delà), puis mémorisée dans le navigateur. Les projets longs (saison, année) se lisent en *Mois*.
- Les tâches sans aucune date sont listées sous la frise (*Sans date*).
- Un clic sur une barre ou un titre ouvre la tâche.
- **Sur téléphone**, la frise est remplacée par une liste chronologique : *En retard*, *Cette semaine*, *Ce mois-ci*, *Plus tard*, *Sans date*, *Faites*.
- Lecture seule : les barres ne se déplacent pas à la souris.

## Avancement sur la fiche d'un objet

Dès que l'objet ou ses sous-objets ont des tâches, une carte **Avancement** s'affiche au-dessus du bilan :

- barre et nombre de **tâches faites** (sur tout le sous-arbre) ;
- **heures prévues faites** (durées estimées des tâches faites ÷ total), quand des durées sont saisies ;
- **fin prévue** : l'échéance la plus tardive des tâches encore ouvertes ;
- nombre de tâches **en retard** et **bloquées** ;
- lien **Voir le Gantt →** (Gantt du sous-arbre, tâches faites comprises).

## Assistants IA (MCP)

- `creer_tache` : `date_debut`, `dependances` (identifiants des tâches attendues).
- `modifier_tache` : `date_debut` (`null` = effacer), `dependances` (remplace la liste, `[]` la vide). Une boucle est refusée avec un message.
- `obtenir_tache` : `date_debut`, `bloquee`, `attend` et `debloque` (titre, statut, échéance, lien).
- `rechercher_taches` : `date_debut` et `bloquee` pour chaque tâche.

Un assistant peut ainsi monter un planning complet d'après une description (« rénovation de la grange en 6 étapes »).

## Côté base

| Table / colonne | Rôle |
|---|---|
| `todos.start_date` | début prévu ; contrainte `todos_start_before_due` (début ≤ échéance) |
| `todo_dependencies` | `todo_id` attend `depends_on_id` ; clé primaire sur le couple, suppression en cascade avec l'une ou l'autre tâche, contrainte « pas soi-même » |

L'absence de boucle est vérifiée par une requête récursive, après un verrou sur `todo_dependencies` (deux modifications simultanées ne peuvent pas en créer une à elles deux). Le calcul du Gantt et de l'avancement est dans `src/lib/gantt.ts` (logique pure, testée), les règles d'enchaînement dans `src/lib/dependencies.ts`.
