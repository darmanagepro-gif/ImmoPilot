# ImmoPilot en 3 modes : logiciel en ligne, Android, iPhone

**Un seul ImmoPilot, trois portes d'entrée.** Le site web, l'application Android et l'application iPhone affichent tous la **même application Google Apps Script**, avec **la même base de données Google Sheet**. Un compte, une réservation, une photo ou un paiement saisi sur l'un apparaît immédiatement sur les deux autres : il n'y a rien à synchroniser, car il n'y a qu'**une seule source de données**. Aucune fonctionnalité n'est modifiée.

```
 Navigateur (PC, Mac)  ─┐
 Application Android   ─┼──>  votre site  https://VOTRE-NOM.github.io  ──>  Application Apps Script (/exec)  ──>  Google Sheet + Drive
 Application iPhone    ─┘          (coquille : icône, écran de démarrage)        (toute la logique, les droits)          (toutes les données)
```

## Coûts, en résumé

| Mode | Gratuit ? | Ce qui est payant (facultatif) |
|---|---|---|
| Logiciel en ligne | **Oui** (GitHub Pages) | Un nom de domaine personnalisé (ex. immopilot.ma), environ 10 à 20 € par an |
| Android | **Oui** : installation depuis Chrome, ou fichier APK partagé | Publication sur **Google Play** : compte développeur 25 $ (une seule fois), et pour un compte personnel récent, un **test fermé avec au moins 12 testeurs pendant 14 jours** avant la mise en production |
| iPhone | **Oui** : installation depuis Safari (« Sur l'écran d'accueil ») | Publication sur l'**App Store** : programme Apple Developer 99 $ par an, un **Mac avec Xcode** (ou un service Mac en ligne), et la validation d'Apple n'est pas garantie (voir mode 3) |

Les montants sont ceux publiés par Google et Apple à ce jour : vérifiez-les au moment de vous inscrire.

## Préparation commune (une seule fois, 10 minutes)

Contenu du dossier `deploiement-web-mobile/` :

| Dossier / fichier | Rôle |
|---|---|
| `web/` | Le site (coquille installable) à mettre en ligne. **Seul `web/config.js` est à modifier.** |
| `web/.well-known/assetlinks.json` | Lien de confiance entre votre site et l'application Android (mode 2, Google Play) |
| `mobile-capacitor/` | Projet des applications natives Android et iPhone (modes 2 et 3), icônes et écrans de démarrage déjà générés |
| `web/icons/icon-1024-store.png` | Icône 1024 × 1024 pour les fiches des stores |

---

## MODE 1 — Logiciel en ligne (gratuit)

### 1.1 Créer le site sur GitHub Pages
1. Créez un compte gratuit sur **github.com** (choisissez bien votre nom d'utilisateur : il apparaîtra dans l'adresse, par exemple `immopilot-maroc`).
2. Cliquez sur **New repository**. Nom du dépôt : **exactement** `VOTRE-NOM.github.io` (par exemple `immopilot-maroc.github.io`). Visibilité : **Public**. Cochez « Add a README ». Cliquez sur **Create repository**.
   *Le nom exact est important : il place le site à la racine de l'adresse, ce qui est indispensable pour l'application Android du mode 2.*
3. Dans le dépôt : **Add file › Upload files**. Glissez **tout le contenu** du dossier `web/` (pas le dossier lui-même) : `index.html`, `config.js`, `manifest.webmanifest`, `sw.js`, `offline.html`, `.nojekyll`, le dossier `icons` et le dossier `.well-known`.
   *Sous Windows, les fichiers commençant par un point (`.nojekyll`, `.well-known`) peuvent être masqués : activez « Affichage › Éléments masqués » dans l'explorateur.*
4. Cliquez sur **Commit changes**.
5. **Settings › Pages** : « Source » = *Deploy from a branch*, branche `main`, dossier `/ (root)`, puis **Save**. Après une à deux minutes, l'adresse `https://VOTRE-NOM.github.io` est affichée.

### 1.2 Brancher le site sur votre application
1. Dans GitHub, ouvrez `config.js` › ✏️ (Edit) et remplacez `COLLEZ_ICI_VOTRE_URL_EXEC` par l'URL `/exec` de votre application Apps Script (Déployer › Gérer les déploiements). Puis **Commit changes**.
2. Dans l'éditeur Apps Script › ⚙️ **Propriétés du script** :
   - **ajoutez** `IMMO_EMBED_ORIGINS` = `https://VOTRE-NOM.github.io`. C'est la liste des sites autorisés à afficher ImmoPilot ; sans elle, l'affichage est refusé, par sécurité ;
   - **modifiez** `IMMO_APP_URL` = `https://VOTRE-NOM.github.io/`. Les liens des e-mails (invitations, mots de passe, portail voyageur) ouvriront alors votre site, et donc l'application sur les téléphones.
3. Remplacez `ImmoPilot.gs` et `Index.html` par les nouvelles versions, enregistrez, puis **Déployer › Gérer les déploiements › ✏️ › Nouvelle version**.
4. Ouvrez `https://VOTRE-NOM.github.io` : ImmoPilot s'affiche avec votre icône. Connectez-vous normalement.

### 1.3 Installer sur l'ordinateur comme un logiciel (facultatif)
Dans **Chrome** ou **Edge**, sur votre site : icône d'installation dans la barre d'adresse (ou menu ⋮ › « Installer ImmoPilot »). ImmoPilot obtient alors sa propre fenêtre, son icône sur le bureau et dans le menu Démarrer.

### 1.4 Nom de domaine personnalisé (facultatif, payant)
Achetez un domaine (ex. `immopilot.ma`) chez un registraire, puis dans GitHub **Settings › Pages › Custom domain**, suivez les indications DNS de GitHub. Ensuite, ajoutez ce domaine dans `IMMO_EMBED_ORIGINS` (séparé par une virgule) et mettez-le dans `IMMO_APP_URL`.

---

## MODE 2 — Application Android

### 2.A Gratuit et immédiat : installation depuis Chrome (recommandé pour commencer)
Sur le téléphone : ouvrez `https://VOTRE-NOM.github.io` dans **Chrome** › menu ⋮ › **« Installer l'application »** (ou « Ajouter à l'écran d'accueil »). L'icône ImmoPilot apparaît avec les autres applications ; elle s'ouvre en plein écran, sans barre d'adresse. Envoyez simplement ce lien et cette consigne à vos propriétaires, agences, gardiens et équipes de ménage.

### 2.B Gratuit : fichier APK à partager (sans Google Play)
1. Allez sur **www.pwabuilder.com** (outil gratuit de Microsoft), saisissez `https://VOTRE-NOM.github.io` puis **Start**. L'outil analyse le site (manifeste, icônes, service worker) ; les éléments nécessaires sont fournis dans `web/`.
2. **Package for stores › Android › Generate Package**. Options : *Package ID* `ma.immopilot.app`, *App name* `ImmoPilot`, couleurs `#13233d`.
3. Téléchargez le ZIP produit. Il contient en général :
   - un fichier **`.apk`** ;
   - un fichier **`.aab`** (pour Google Play) ;
   - un fichier **`assetlinks.json`** ;
   - la **clé de signature** et son mot de passe : **conservez-les précieusement**, ils sont indispensables pour toutes les mises à jour.
4. Remplacez `web/.well-known/assetlinks.json` sur GitHub par celui fourni par PWABuilder. Sans lui, l'application affiche une barre d'adresse en haut.
5. Envoyez le fichier `.apk` à vos utilisateurs. À l'installation, Android leur demande d'autoriser « l'installation depuis cette source ».

### 2.C Google Play (payant)
1. Créez un compte sur **play.google.com/console** : 25 $, une seule fois, avec vérification d'identité.
2. **Créer une application** › nom « ImmoPilot », langue par défaut français, application gratuite.
3. Fiche du Play Store : description, icône `icon-1024-store.png` (réduite à 512 × 512), captures d'écran du téléphone, et **URL de politique de confidentialité**. Elle est obligatoire : publiez une page de politique sur votre site.
4. Questionnaires obligatoires : accès à l'application (donnez un **compte de démonstration** aux examinateurs), sécurité des données, classification du contenu.
5. **Test fermé** : importez le fichier **`.aab`** de PWABuilder (étape 2.B), puis invitez au moins **12 testeurs** (par e-mail). Ils doivent rester inscrits **14 jours consécutifs**. Cette règle s'applique aux comptes personnels créés après le 13 novembre 2023.
6. Ensuite, demandez l'accès à la **production** depuis le tableau de bord, puis publiez.

*Alternative pour développeur :* le dossier `mobile-capacitor/android` peut être ouvert dans **Android Studio** (gratuit) : `npm install`, puis `npx cap sync`, puis `npx cap open android`, puis Build › Generate Signed App Bundle.

---

## MODE 3 — Application iPhone

### 3.A Gratuit et immédiat : installation depuis Safari (recommandé pour commencer)
Sur l'iPhone : ouvrez `https://VOTRE-NOM.github.io` dans **Safari**, puis bouton **Partager** (carré avec flèche) › **« Sur l'écran d'accueil »** › **Ajouter**. L'icône ImmoPilot apparaît sur l'écran d'accueil et s'ouvre en plein écran.
*Il faut obligatoirement passer par Safari : Chrome sur iPhone ne propose pas toujours cette option.*

### 3.B App Store (payant, Mac nécessaire)
**À savoir avant de payer.** Apple refuse régulièrement les applications qui se contentent d'afficher un site web (règle 4.2, « fonctionnalité minimale »). ImmoPilot est un vrai logiciel métier avec comptes, photos, signatures et workflows, ce qui joue en sa faveur, mais **l'acceptation n'est pas garantie**. Commencez par 3.A ; passez à l'App Store seulement si vous en avez besoin.

Prérequis :
- un compte **Apple Developer** (99 $ par an) ;
- un **Mac** récent avec **Xcode** (gratuit sur le Mac App Store), ou un Mac loué en ligne ;
- **Node.js 22** ou plus récent installé sur le Mac.

1. Copiez le dossier `mobile-capacitor` sur le Mac.
2. Ouvrez `capacitor.config.json` et remplacez **les deux** `VOTRE-NOM.github.io` par votre adresse.
3. Dans le Terminal, depuis ce dossier :
   ```
   npm install
   npx cap sync
   npx cap open ios
   ```
4. Dans Xcode :
   - **App › Signing & Capabilities** : choisissez votre équipe (Team). Bundle Identifier : `ma.immopilot.app`.
   - Les icônes et écrans de démarrage sont **déjà** en place.
5. Testez sur votre iPhone, branché en USB, avec le bouton ▶.
6. **Product › Archive** › **Distribute App** › **App Store Connect** › **Upload**.
7. Sur **appstoreconnect.apple.com** › **Mes apps** › **+** › créez « ImmoPilot » :
   - captures d'écran iPhone ;
   - description ;
   - **URL de politique de confidentialité** ;
   - catégorie Business ;
   - **compte de démonstration** pour l'examinateur, avec des données de démonstration ;
   - « Confidentialité de l'app » : déclarez les données collectées (e-mail, nom, photos téléversées).
8. Choisissez le build envoyé à l'étape 6 et cliquez sur **Soumettre pour vérification**.

*Le même projet produit aussi l'application Android* : `npx cap open android`, voir 2.C.

---

## Mises à jour

| Ce qui change | Que faire |
|---|---|
| Fonctionnalités d'ImmoPilot (nouveaux `ImmoPilot.gs` / `Index.html`) | Uniquement dans Apps Script : coller les fichiers, puis **Nouvelle version**. Le web, Android et iPhone sont à jour **immédiatement**, sans republier d'application. |
| Icône, nom ou couleurs | Republier le site (GitHub) ; pour les stores, générer et envoyer une nouvelle version de l'application. |

## Sécurité et limites (à connaître)

- **Intégration autorisée seulement pour vos sites.** ImmoPilot ne s'affiche dans un autre site que si son adresse figure dans `IMMO_EMBED_ORIGINS`. Sinon, il affiche « Affichage refusé ». C'est une protection contre les sites qui piégeraient vos utilisateurs (« clickjacking »).
- **Connexion internet obligatoire.** Les données ne sont **jamais** stockées sur le téléphone. Sans réseau, un écran « Pas de connexion » s'affiche.
- **Session.** Comme sur le web, la session dure jusqu'à la fermeture de l'application, ou 12 h au plus. Il faut donc se reconnecter de temps en temps : c'est voulu, pour protéger les données.
- **Bandeau Google.** Avec un compte Google gratuit, Google peut afficher un bandeau « Cette application a été créée par un utilisateur de Google Apps Script ». Ce bandeau n'apparaît pas avec un compte Google Workspace.
- **À tester sur vos téléphones avant de diffuser :** prise de photo, signature, téléchargement des PDF et CSV, bouton WhatsApp, liens reçus par e-mail.
