# Types d'objets et de documents

[← Retour au README](../README.md)

La page **Types** (`/types`, lien « Types » dans la navigation) gère deux listes :

| Liste | Utilisée par | Valeurs de départ |
|---|---|---|
| Types d'objets | champ *Type* des objets, réglage commun de l'ajout en lot d'objets | propriété, bâtiment, pièce, terrain, véhicule, machine, équipement, projet |
| Types de documents | classement des documents d'un objet | Facture, Garantie, Mode d'emploi, Guide de démarrage, Devis, Contrat, Plan, Certificat, Photo, Autre |

Tout utilisateur connecté peut gérer ces listes.

## Ajouter

Saisir le nom dans **« Nouveau type »**, puis cliquer sur *Ajouter*. Les espaces superflus sont retirés. Un nom identique à un type existant, **sans tenir compte des majuscules**, est refusé (« Le type « Serre » existe déjà »). La règle est garantie en base par un index unique sur `lower(name)`.

## Renommer

**Renommer** ouvre le nom en édition. Le nouveau nom s'applique immédiatement à **tous les objets ou documents** de ce type, puisqu'ils référencent le type et non son nom.

## Supprimer

Chaque ligne indique combien d'objets ou de documents utilisent le type (« 3 objets », « inutilisé »).

- **Un type utilisé ne peut pas être supprimé.** Le bouton est désactivé, et le serveur refuse aussi : « Impossible de supprimer « terrain » : 3 objets l'utilisent ». La base le garantit en plus par une clé étrangère `ON DELETE RESTRICT`.
- Pour supprimer un type utilisé, on change d'abord le type des objets concernés (fiche › Modifier) ou des documents (sélecteur de type sur la ligne du document).
- Un type inutilisé se supprime après confirmation.

## Règles particulières

- Un **objet** peut être « Sans type ».
- Un **document** a toujours un type ; « Autre » est proposé par défaut à l'envoi.
- La migration `0003_types` a converti les anciens types d'objets, auparavant saisis en texte libre, en entrées de la liste. Les valeurs déjà saisies ont été conservées.
