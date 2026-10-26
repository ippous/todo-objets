# Architecture

[← Retour au README](../README.md)

## Stack

| Couche | Choix |
|---|---|
| Application | Next.js 16 (App Router, Server Components, Server Actions), TypeScript, Tailwind CSS 4 |
| Base | PostgreSQL : Neon en dev et en prod, Postgres local ou PGlite en test |
| Accès aux données | Drizzle ORM ; migrations SQL versionnées dans `drizzle/` |
| Authentification | Auth.js v5 (Google, plus une connexion de test hors prod) |
| Fichiers | Vercel Blob en mode **privé** ; dossier `.uploads/` en local |
| Aperçus de documents | pdf.js, mammoth, read-excel-file, JSZip, chargés à la demande côté navigateur |
| Hébergement | Vercel (région `fra1`), domaines chez Hostinger |

## Organisation du code

```
src/
  app/
    (app)/                 pages protégées (layout = session obligatoire)
      page.tsx             arbre
      objets/              fiche, création, modification
      taches/              liste, fiche, création
      documents/[id]/      visionneuse
      types/               gestion des types
      utilisateurs/        accès (admin)
    connexion/             page de connexion
    actions.ts             toutes les Server Actions (contrôle de session + validation)
    api/
      auth/                Auth.js
      photos/              lecture, autorisation d'envoi, envoi local
      documents/           lecture, autorisation d'envoi
      test/purge/          purge des données de test (hors prod)
  components/              composants d'interface (client ou serveur)
  db/schema.ts             schéma Drizzle
  lib/
    repo.ts                requêtes (chaque fonction reçoit la base : testable sur PGlite)
    tree.ts                logique d'arbre pure (forêt, cumuls, chemins, récurrence)
    storage.ts             Blob / local, chemins, suppression
    document-types.ts      formats acceptés, visionneuses
    session.ts, forms.ts, seed.ts…
scripts/migrate.ts         migrations + arbre de départ (lancé au build)
drizzle/                   migrations SQL et instantanés
tests/                     tests unitaires (Vitest + PGlite)
e2e/                       tests de bout en bout (Playwright)
docs/                      cette documentation
```

## Modèle de données

```
users ──< todos (assignee_id, created_by_id)
object_types ──< objects ──< objects (parent_id, arbre)
                    │  ├──< todos ──< photos (todo_id)
                    │  ├──< photos (object_id)
                    │  ├──< documents >── document_types
                    │  └──< links
```

| Table | Points clés |
|---|---|
| `objects` | `parent_id` auto-référencé (`RESTRICT`), contrainte « pas son propre parent », `type_id` → `object_types` (`RESTRICT`), `position` pour l'ordre |
| `todos` | `object_id` (`RESTRICT`), valeurs numériques estimées/réalisées, enums priorité/statut/catégorie/récurrence, `previous_occurrence_id` unique (une seule occurrence suivante) |
| `photos` | rattachée à un objet **ou** à une tâche (contrainte), `is_cover`, chemins de la photo et de la vignette |
| `documents` | `type_id` → `document_types` (`RESTRICT`), nom d'origine, type MIME, taille, chemin |
| `links` | URL http(s) normalisée, titre facultatif |
| `object_types`, `document_types` | `name` unique sans tenir compte de la casse (index sur `lower(name)`) |
| `users` | e-mail unique, rôle, actif, heures/semaine, compétences |

### Règles garanties côté serveur

- **Déplacement** : `LOCK TABLE objects` puis requête récursive qui refuse la destination si elle appartient au sous-arbre déplacé.
- **Suppression d'objet** : refusée s'il reste des sous-objets ou des tâches. Les photos, documents et liens partent en cascade, et les fichiers sont effacés ensuite.
- **Types** : suppression refusée s'ils sont utilisés (message clair, plus la clé étrangère `RESTRICT`).
- **Cumuls** : calculés à partir des statistiques par objet, remontées dans l'arbre (`lib/tree.ts`).

## Sécurité

- Chaque page de `(app)` et chaque Server Action appelle `requireUser()` (ou `requireAdmin()`), qui relit l'utilisateur en base à chaque requête.
- Fichiers privés : lecture uniquement via `/api/photos/[id]` et `/api/documents/[id]`, après contrôle de session.
- Envois directs vers Blob : le serveur n'émet un jeton que pour un chemin valide (`<env>/objets|taches|documents/<id>/…`), un type autorisé et une taille limitée.
- Documents servis avec `nosniff` et `CSP: sandbox`. Le HTML issu d'un `.docx` est nettoyé avant affichage.
- Liens : uniquement des URL http et https.
- Connexion de test : comparaison à temps constant, désactivée en production.

## Fichiers et environnements

Les chemins de stockage commencent par l'environnement Vercel (`production/…`, `preview/…`, `local/…`), ce qui permet au dev et à la prod de partager le même store sans se mélanger.
