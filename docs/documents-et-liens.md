# Documents et liens

[← Retour au README](../README.md)

Chaque objet a une section **« Documents et liens »** sur sa fiche.

## Documents

### Ajouter

1. Choisir le **type des documents à ajouter** : Facture, Garantie, Mode d'emploi, Guide de démarrage, Devis, Contrat, Plan, Certificat, Photo, Autre… (« Autre » par défaut). La liste se complète dans [Types](types.md).
2. Cliquer sur **« Ajouter des documents »** et choisir un ou plusieurs fichiers.

Formats acceptés (25 Mo au plus par fichier) :

| Famille | Extensions |
|---|---|
| PDF | `.pdf` |
| Images | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.heic` |
| Texte | `.txt`, `.log`, `.md`, `.json`, `.csv` |
| Word | `.docx`, `.doc` |
| Excel | `.xlsx`, `.xls` |
| PowerPoint | `.pptx`, `.ppt` |
| OpenDocument | `.odt`, `.ods` |
| Archive | `.zip` |

Les autres formats sont refusés avec un message, notamment les pages HTML et les scripts. Comme les photos, les fichiers vont directement dans le **stockage privé**.

### Liste

Les documents sont **regroupés par type**. Chaque ligne affiche le nom, la taille, la date et l'auteur, et propose :

- un **sélecteur de type**, pour reclasser le document ;
- **Télécharger** ;
- **Supprimer**, avec confirmation ; le fichier est effacé du stockage.

Un clic sur le nom ouvre la **visionneuse**.

### Visionneuse (`/documents/[id]`)

La page affiche un fil d'Ariane vers l'objet, le type, le format, la taille et la date, ainsi que les boutons **Ouvrir à part** et **Télécharger**. L'aperçu dépend du format :

| Format | Aperçu |
|---|---|
| PDF | toutes les pages rendues avec pdf.js, ce qui fonctionne aussi sur téléphone, où les PDF intégrés ne s'affichent pas |
| Images | image en grand ; un clic l'ouvre seule. HEIC : affichée par Safari, sinon proposition de téléchargement |
| Texte, Markdown, log | texte brut |
| JSON | texte indenté |
| CSV | tableau ; séparateur `,`, `;` ou tabulation détecté automatiquement ; guillemets gérés |
| Word `.docx` | document mis en forme (titres, listes, tableaux, images), converti par mammoth |
| Excel `.xlsx` | tableau, avec un onglet par feuille |
| OpenDocument `.odt` | titres et paragraphes |
| OpenDocument `.ods` | tableau, avec un onglet par feuille |
| PowerPoint `.pptx` | texte de chaque diapositive, sans mise en page ni images |
| ZIP | liste des fichiers contenus, avec leur taille |
| `.doc`, `.xls`, `.ppt` (anciens formats binaires) | pas d'aperçu : bouton Télécharger |

Les tableaux affichent les 500 premières lignes et les textes les 2 premiers millions de caractères. Au-delà, un message invite à télécharger le fichier.

Tous les aperçus sont calculés **dans le navigateur**, à partir du fichier servi par `/api/documents/[id]`. Les bibliothèques (pdf.js, mammoth, read-excel-file, JSZip) ne sont chargées que pour le format concerné.

### Sécurité

- `/api/documents/[id]` exige une session. Il sert les PDF, images et textes en `inline`, et tout le reste en pièce jointe ; `?telecharger=1` force le téléchargement.
- Les réponses portent `X-Content-Type-Options: nosniff` et une `Content-Security-Policy: sandbox` : un fichier ouvert seul ne peut pas exécuter de script.
- Le HTML produit à partir d'un `.docx` est nettoyé : pas de script, pas d'attribut `on…`, liens limités à http, https, mailto et aux ancres, images en `data:` uniquement.

## Liens

On peut ajouter des **liens web** à un objet : fiche produit, notice en ligne, page du fabricant…

- Saisir l'adresse ; `https://` est ajouté si on l'omet.
- Le titre est facultatif. Sans titre, c'est l'adresse qui s'affiche.
- Seules les adresses **http et https** sont acceptées (`javascript:` et les autres schémas sont refusés).
- Les liens s'ouvrent dans un nouvel onglet.
- **Supprimer** demande une confirmation.

Supprimer un objet supprime ses documents (fichiers compris) et ses liens.
