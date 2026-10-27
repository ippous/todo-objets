# Photos

[← Retour au README](../README.md)

On peut ajouter des photos aux **objets** et aux **tâches**. Sur la fiche d'un objet, la section Photos est juste sous l'en-tête (bouton *Photos* pour y aller directement).

## Ajouter

Plusieurs façons :

- **« Ajouter des photos »** : choisir une ou plusieurs images déjà enregistrées.
- **« Prendre une photo »**, quand l'appareil a une caméra :
  - **téléphone ou tablette** (écran tactile) : ouvre directement l'appareil photo du système, caméra arrière ;
  - **PC avec webcam** : ouvre une fenêtre de prise de vue. *Déclencher* prend une photo, et on peut en prendre plusieurs à la suite. Les miniatures s'affichent ; **×** en retire une. Si plusieurs caméras sont branchées, une liste permet d'en changer. *Ajouter les photos* envoie le tout, *Annuler* ne garde rien.

  À la première utilisation, le navigateur demande l'autorisation d'utiliser la caméra. En cas de refus, un message explique comment la réactiver (icône à gauche de l'adresse). Le bouton n'apparaît pas si le navigateur n'a pas accès à une caméra.
- **Coller une image** :
  - **Ctrl+V** (Cmd+V sur Mac) n'importe où sur la fiche de l'objet ou de la tâche : l'image copiée (capture d'écran, image copiée depuis une page web ou un logiciel, fichier image copié dans l'explorateur) est ajoutée aux photos. Plusieurs images copiées ensemble sont toutes ajoutées. Un collage *dans* un champ de saisie (nom, description…) reste un collage normal de texte.
  - bouton **« Coller une image »** (pratique sur téléphone et tablette, sans clavier) : lit le presse-papiers ; le navigateur peut demander l'autorisation. Le bouton n'apparaît que si le navigateur le permet. Si le presse-papiers ne contient pas d'image, un message le signale.

Avant l'envoi, le navigateur :

- redimensionne la photo à **1600 px** au plus (JPEG, qualité 82 %) ;
- crée une **vignette de 400 px** ;
- corrige l'orientation (photos prises en portrait).

Les fichiers partent **directement du navigateur vers le stockage privé** (Vercel Blob), sans passer par le serveur de l'application. Ce dernier vérifie la session et le chemin avant d'autoriser l'envoi, puis enregistre la photo en base.

## Vignette

- La **première photo** d'un objet ou d'une tâche devient automatiquement sa vignette.
- **« Utiliser comme vignette »** sur une autre photo la remplace ; la vignette porte la mention « Vignette ».
- Si l'on supprime la vignette, la photo suivante prend sa place.

Les vignettes s'affichent dans l'arbre, dans l'en-tête de la fiche d'un objet et dans la liste des tâches.

## Afficher et supprimer

- Un clic sur une photo l'ouvre en grand.
- **Supprimer** demande une confirmation et efface les deux fichiers (photo et vignette).
- Supprimer un objet ou une tâche supprime aussi ses photos.

## Confidentialité

Le stockage est **privé** : les images ne sont accessibles que par `/api/photos/[id]`, et seulement pour un utilisateur connecté et autorisé. Une adresse d'image copiée ne fonctionne pas sans connexion.
