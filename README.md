# Carnet

Carnet est une application web personnelle, multi-utilisateurs, pour gérer des **tâches rattachées à des objets**. Les objets sont classés en **arborescences** sans limite de profondeur : propriété › bâtiment › pièce, véhicule › moteur, projet… Elle s'utilise au téléphone comme sur PC.

| Environnement | Adresse | Branche |
|---|---|---|
| Production | https://todo.jaume-eric.com | `main` |
| Dev | https://dev.todo.jaume-eric.com (protégé par Vercel) | `develop` |

## Fonctionnalités en bref

| Domaine | Ce qu'on peut faire | Détail |
|---|---|---|
| Arbre des objets | plusieurs racines, profondeur illimitée, déplacer (menu ou glisser-déposer), supprimer, cumuls par branche | [docs/arbre-et-objets.md](docs/arbre-et-objets.md) |
| Tâches | valeur (€) et durée (h) estimées/réalisées, ratio €/h, priorité, statut, échéance, récurrence, responsable, catégorie, tags ; vue arbre et liste filtrable | [docs/taches.md](docs/taches.md) |
| Ajout en lot | créer n objets ou n tâches d'un coup, avec réglages communs | [docs/ajout-en-lot.md](docs/ajout-en-lot.md) |
| Photos | photos sur les objets et les tâches, une vignette par élément | [docs/photos.md](docs/photos.md) |
| Documents et liens | factures, garanties, modes d'emploi… classés par type, avec visionneuse intégrée ; liens web | [docs/documents-et-liens.md](docs/documents-et-liens.md) |
| Types | listes modifiables des types d'objets et de documents, suppression bloquée tant qu'ils sont utilisés | [docs/types.md](docs/types.md) |
| Assistants IA (MCP) | serveur MCP pour Claude, ChatGPT, Cursor… : lecture de l'arbre, des objets et des tâches, et sur autorisation création / modification de tâches et d'objets, liens et photos (sans suppression) ; connexion OAuth ou jeton personnel | [docs/mcp.md](docs/mcp.md) |
| Extension Chrome | ajouter à une tâche ou un objet (trouvé par son nom ou dans l'arborescence) la page courante en lien, ou une photo : capture, clic droit sur une image, coller, glisser, fichier | [docs/extension-chrome.md](docs/extension-chrome.md) |
| Utilisateurs et accès | connexion Google, liste d'adresses autorisées, rôles | [docs/utilisateurs-et-acces.md](docs/utilisateurs-et-acces.md) |

## Pour les développeurs

- [docs/architecture.md](docs/architecture.md) : stack, modèle de données, organisation du code, sécurité.
- [docs/environnements-et-deploiement.md](docs/environnements-et-deploiement.md) : Vercel, Neon, Blob, domaines, variables, Google OAuth, migrations.
- [docs/tests.md](docs/tests.md) : tests unitaires, e2e, nettoyage des données de test.

```bash
cp .env.example .env.local   # puis renseigner les valeurs
npm install
npm run db:migrate           # migrations + arbre de départ si la base est vide
npm run dev
```
