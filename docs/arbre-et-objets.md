# Arbre et objets

[← Retour au README](../README.md)

Un **objet** désigne tout ce à quoi on peut rattacher des tâches : une propriété, un bâtiment, une pièce, un terrain, un véhicule, une machine, un projet… Les objets forment des **arbres** :

- **plusieurs racines** sont possibles, car un objet ne fait pas forcément partie d'une propriété (un véhicule, un projet) ;
- la **profondeur est illimitée** (Moulin › Bâtiment principal › Cave › Tonneau…).

## Page « Arbre » (`/`)

L'arbre complet est affiché, dépliable branche par branche. Pour chaque objet, on voit :

- sa **vignette** (photo choisie comme vignette), s'il en a une ;
- son **type** ;
- les **cumuls de la branche** : nombre de tâches ouvertes, heures et euros estimés de l'objet **et de tous ses descendants**.

Le bouton **« Nouvel objet racine »** crée un arbre indépendant.

### Menu « … » d'un objet

| Action | Effet |
|---|---|
| Ajouter un sous-objet | ouvre le formulaire de création avec cet objet comme parent |
| Ajouter plusieurs sous-objets… | ouvre la boîte d'[ajout en lot](ajout-en-lot.md) |
| Ajouter plusieurs tâches… | idem, pour des tâches rattachées à cet objet |
| Déplacer | passe en mode Déplacer (voir ci-dessous) |
| Supprimer… | demande confirmation (voir ci-dessous) |

### Déplacer un objet

Le sous-arbre entier part avec l'objet : sous-objets, tâches, photos, documents et liens.

- **Mode « Déplacer »** (souris, tactile ou clavier) : choisir *Déplacer* dans le menu, puis cliquer sur la destination ou sur « Mettre à la racine ». *Échap* annule.
- **Glisser-déposer** (souris) : faire glisser la ligne sur l'objet de destination, ou sur la zone « Déposer ici pour mettre à la racine ».

Un objet **ne peut pas être placé sous lui-même ni sous l'un de ses descendants**. Le serveur le refuse dans une transaction verrouillée, ce qui évite toute boucle même si deux personnes déplacent en même temps.

### Supprimer un objet

La suppression demande une **confirmation**. Elle n'est possible **que si l'objet n'a ni sous-objet ni tâche**. Sinon, un message indique ce qu'il faut d'abord déplacer ou supprimer. Les photos, documents et liens de l'objet sont supprimés avec lui, fichiers compris.

## Fiche d'un objet (`/objets/[id]`)

De haut en bas :

1. **Fil d'Ariane** jusqu'à la racine.
2. **En-tête** : vignette, nom, type, description, emplacement, tags ; boutons *Ajouter une tâche*, *Ajouter un sous-objet*, *Modifier ou déplacer*, *Photos* (va à la section Photos), *Plusieurs tâches*, *Plusieurs sous-objets*.
3. **Photos** : ajout de photos et choix de la vignette (voir [photos.md](photos.md)).
4. **Bilan** de l'objet et de tous ses descendants : tâches ouvertes, heures et € estimés, heures et € réalisés (tâches faites).
5. **Sous-objets** directs.
6. **Tâches** de l'objet et de ses descendants, regroupées par sous-objet ; un lien permet d'afficher aussi les tâches faites.
7. **Documents et liens** (voir [documents-et-liens.md](documents-et-liens.md)).

## Champs d'un objet

| Champ | Obligatoire | Remarque |
|---|---|---|
| Nom | oui | |
| Type | non | liste gérée dans [Types](types.md), avec un choix « Sans type » |
| Parent | non | vide = racine |
| Description | non | texte libre, retours à la ligne conservés |
| Emplacement | non | texte libre |
| Tags | non | séparés par des virgules |

## Arbre de départ

Si la base est vide au premier déploiement, un arbre d'exemple est créé : *Le Moulin FRat*, avec ses bâtiments, pièces et terrains. On peut le renommer, le déplacer ou le supprimer comme n'importe quel objet.
