# Déploiement d'ImmoPilot 2.0.0

Cette procédure installe ImmoPilot **à partir de rien**, dans un compte Google vierge : aucun fichier n'est à préparer. Le script crée lui-même sa base de données (Google Sheet), son dossier Drive privé et le premier compte super administrateur. Aucune étape ne supprime ni ne vide de fichier existant.

## 1. Comprendre le modèle d'exécution (à lire avant d'installer)

### « Exécuter en tant que » : moi (le propriétaire du script)

Le manifeste déclare `executeAs: USER_DEPLOYING`. Toutes les lectures et écritures (Sheet, Drive, Docs, envoi d'e-mails) sont faites **avec le compte Google qui déploie**. Conséquences :

- Les clients n'ont **aucun accès direct** au Google Sheet ni au dossier Drive : ils ne voient que ce que le serveur leur renvoie après contrôle des droits. C'est ce qui permet le cloisonnement multi-organisations.
- Les quotas consommés (e-mails, temps d'exécution, Drive) sont ceux **du compte déployeur**.
- Le compte déployeur est, de fait, détenteur de toutes les données de tous les clients : utilisez un compte dédié (idéalement Google Workspace), protégé par la validation en deux étapes, et non un compte personnel partagé.

Le mode inverse (« exécuter en tant qu'utilisateur accédant ») est **déconseillé** : il faudrait partager le Sheet de base avec chaque client, ce qui exposerait les données de toutes les organisations à chacun.

### « Qui a accès » : tout le monde (y compris anonyme)

Le manifeste déclare `access: ANYONE_ANONYMOUS`. C'est nécessaire parce que vos clients (propriétaires, gardiens, artisans, locataires, voyageurs) n'ont pas forcément de compte Google, ou pas dans votre domaine.

### Identité disponible

Avec ce couple de réglages, `Session.getActiveUser().getEmail()` renvoie une **chaîne vide** pour les utilisateurs extérieurs à votre domaine : Google ne communique pas leur identité au script. ImmoPilot n'utilise donc **jamais** cette valeur pour authentifier un utilisateur de l'application. L'identité vient de comptes applicatifs :

- activation par lien à usage unique (invitation, ou lien d'activation du super administrateur) ;
- mot de passe haché côté serveur (PBKDF2-HMAC-SHA256, sel aléatoire) ;
- session : jeton aléatoire de 256 bits conservé dans le `sessionStorage` du navigateur, dont seule l'empreinte SHA-256 est stockée dans la table `Sessions` ; durée 12 h par défaut (`session.hours`).

`Session.getActiveUser()` sert uniquement à vérifier, pour les fonctions d'installation, qu'elles sont lancées **depuis l'éditeur par le propriétaire du script** (`assertEditor_`).

### Permissions Drive

Le dossier racine `ImmoPilot_PRIVATE_FILES_DO_NOT_SHARE` et tous les fichiers créés sont mis en partage **privé** (`Access.PRIVATE`). Les documents sont servis par le serveur (contenu base64) après vérification des droits ; aucun lien Drive n'est communiqué au navigateur. Ne partagez jamais ce dossier, ni « à toute personne disposant du lien ».

### Utilisateurs externes

Aucune configuration Google n'est requise côté client : ils ouvrent l'URL `/exec`, se connectent avec leur e-mail et leur mot de passe ImmoPilot. Les voyageurs n'ont pas de compte : ils reçoivent un lien de portail à jeton (révocable, limité à leur réservation).

### Quotas Google à connaître

Les valeurs exactes dépendent du type de compte et évoluent ; consultez la page officielle « Quotas for Google Services » et vérifiez votre compte. Ordres de grandeur publiés par Google à ce jour :

| Ressource | Compte gratuit | Google Workspace |
|---|---|---|
| Destinataires d'e-mails par jour (MailApp) | ~100 | ~1 500 |
| Durée maximale d'une exécution | 6 min | 6 min |
| Temps cumulé des déclencheurs par jour | ~90 min | ~6 h |
| Cellules par Google Sheet | 10 millions | 10 millions |

ImmoPilot vérifie le quota restant (`MailApp.getRemainingDailyQuota()`) avant chaque envoi et enregistre l'échec (statut `EMAIL_FAILED`, notification interne) au lieu de perdre l'information. Les tâches planifiées s'arrêtent proprement après 4 min 30 et reprennent au passage suivant. `healthCheck()` affiche le nombre de cellules utilisées.

## 2. Paramètres (propriétés du script)

**Pour une installation à partir de rien, vous n'avez aucune propriété à créer avant de commencer.** `setupProject()` crée lui-même la base Google Sheet `ImmoPilot_DB` et le dossier Drive privé, et enregistre leurs identifiants. Elle désigne aussi votre propre adresse (celle du compte qui lance le script) comme premier super administrateur. Seule `IMMO_APP_URL` est à renseigner, après le déploiement (étape 12).

Les propriétés sont visibles dans l'éditeur Apps Script › ⚙️ Paramètres du projet › Propriétés du script :

| Propriété | Qui la renseigne | Valeur |
|---|---|---|
| `IMMO_DATABASE_SPREADSHEET_ID` | `setupProject()`, automatiquement | Identifiant de la base créée. Ne la modifiez que pour pointer vers une autre base (restauration). Une base déjà indiquée n'est jamais recréée ni remplacée. |
| `IMMO_PRIVATE_ROOT_FOLDER_ID` | `setupProject()`, automatiquement | Dossier Drive privé `ImmoPilot_PRIVATE_FILES_DO_NOT_SHARE`. |
| `IMMO_ADMIN_EMAILS` | `setupProject()` (votre adresse) ; vous pouvez en ajouter | Adresse(s) des super administrateurs, séparées par des virgules. Lue **uniquement** par `setupProject()` / `createFirstSuperAdmin()` lancées depuis l'éditeur ; une adresse ajoutée ici ne donne aucun droit tant que le compte n'est pas activé par son lien à usage unique. |
| `IMMO_APP_URL` | vous, à l'étape 12 | URL `/exec` du déploiement, utilisée dans les liens envoyés par e-mail. |
| `IMMO_EMBED_ORIGINS` | facultatif | Sites autorisés à afficher ImmoPilot (votre site web et vos applications mobiles), ex. `https://monnom.github.io`. Vide = intégration interdite. Voir `deploiement-web-mobile/GUIDE_3_MODES.md`. |
| `IMMO_PBKDF_ITERATIONS` | facultatif | Itérations PBKDF2 (défaut 2000, minimum 1000). Voir SECURITE.md avant de modifier. |
| `IMMO_AI_PROVIDER` | facultatif | Mode IA de l'assistant Rubban : `anthropic` (Claude) ou `gemini` (Google). Vide = mode Guide uniquement (gratuit, toujours disponible). |
| `IMMO_AI_API_KEY` | facultatif | Clé d'API du fournisseur choisi. Lue **uniquement par le serveur**, jamais envoyée au navigateur. |
| `IMMO_AI_MODEL` | facultatif | Modèle (défaut : `claude-haiku-5-5` ou `gemini-3.5-flash-lite`). |

Aucune clé secrète n'est nécessaire au fonctionnement ; la seule clé facultative (`IMMO_AI_API_KEY`) reste dans les propriétés du script et n'est jamais placée dans le code client.

Les réglages métier (horaires d'arrivée/départ, battement entre séjours, politique d'annulation, taux de commission, TVA, délais d'alerte, durées de conservation, modèles Google Docs, listes de catégories…) se règlent dans l'application : **Paramètres** (par organisation) et **Administration › Paramètres plateforme**. Liste complète : `DEFAULT_SETTINGS` dans `Config.gs`.

## 3. Installation pas à pas, à partir de rien (20 étapes)

Il vous faut seulement un compte Google (idéalement Google Workspace, dédié à ImmoPilot, avec la validation en deux étapes) et le contenu du ZIP décompressé sur votre ordinateur.

1. **Connectez-vous** au compte Google qui hébergera ImmoPilot. Si votre navigateur est connecté à plusieurs comptes Google, utilisez une fenêtre de navigation privée pour éviter que Google ouvre le projet avec un autre compte.
2. **Créez le projet** : allez sur script.google.com › « Nouveau projet ». Renommez-le `ImmoPilot` (clic sur « Projet sans titre »).
3. **Fuseau horaire et manifeste** : ⚙️ Paramètres du projet › choisissez le fuseau `(GMT+01:00) Casablanca` et cochez « Afficher le fichier manifeste "appsscript.json" dans l'éditeur ».
4. **Manifeste** : revenez à l'éditeur (`< >`), ouvrez `appsscript.json` et remplacez tout son contenu par celui du fichier `appsscript.json` fourni.
5. **Fichier `Code.gs`** : le projet neuf contient déjà un fichier `Code.gs` avec une fonction `myFunction`. Remplacez **tout** son contenu par celui du `Code.gs` fourni.
6. **Les 30 autres fichiers `.gs`** : pour chacun (Config, Auth, Permissions, Database, Migrations, Utils, Admin, Compat, Triggers, Tests et les 20 fichiers `…Service`), cliquez sur ＋ › « Script », tapez le nom **sans** `.gs` (par exemple `Config`), puis collez le contenu du fichier.
7. **Les 8 fichiers `.html`** : ＋ › « HTML », nom exact sans `.html` : `Index`, `Styles`, `Scripts`, `Components`, `Login`, `Dashboard`, `Pages`, `I18n`. Collez le contenu (remplacez le squelette HTML proposé par l'éditeur). Attention aux majuscules : `I18n`, pas `i18n`.
8. **Enregistrez** (Ctrl+S ou 💾). Vérifiez que vous avez bien 31 fichiers `.gs` et 8 fichiers `.html`, et qu'aucune erreur de syntaxe n'est signalée.
9. **Lancez `setupProject()`** : choisissez `setupProject` dans la liste des fonctions en haut de l'éditeur › « Exécuter ». Google demande une autorisation : « Examiner les autorisations » › votre compte › (si « Google n'a pas validé cette application » s'affiche : « Paramètres avancés » › « Accéder à ImmoPilot ») › « Autoriser ». Les accès demandés (Sheets, Drive, Docs, envoi d'e-mails, déclencheurs, adresse e-mail) servent uniquement à votre compte. Relancez `setupProject()` si la première exécution s'est arrêtée à l'autorisation.
10. **Lisez le journal d'exécution.** `setupProject()` a créé : le dossier Drive privé `ImmoPilot_PRIVATE_FILES_DO_NOT_SHARE` avec ses sous-dossiers (`Modeles`, `Sauvegardes`, `Exports`, `Organisations`), la base `ImmoPilot_DB` rangée dans ce dossier (48 onglets et un onglet `Accueil`), les forfaits Essentiel / Pro / Business, et votre compte super administrateur. Attendu : `databaseCreated: true`, `driveRootPrivate.ok: true`. Le message « déployez l'application web puis relancez createFirstSuperAdmin() » est normal à ce stade : l'URL de l'application n'existe pas encore.
11. **Déployez l'application web** : bouton « Déployer » › « Nouveau déploiement » › ⚙️ « Sélectionner le type » › « Application Web ». Description : `ImmoPilot 2.0.0`. Exécuter en tant que : **Moi**. Qui a accès : **Tout le monde**. « Déployer », puis copiez l'« URL de l'application Web » (elle se termine par `/exec`).
12. **Renseignez `IMMO_APP_URL`** : ⚙️ Paramètres du projet › Propriétés du script › « Ajouter une propriété du script » : nom `IMMO_APP_URL`, valeur = l'URL `/exec` copiée (pas l'URL `/dev`). « Enregistrer ».
13. **Lancez `createFirstSuperAdmin()`.** Un lien d'activation à usage unique, valable 72 h, est envoyé à votre adresse **et** écrit dans le journal d'exécution. Ce lien est confidentiel.
14. **Activez votre compte** : ouvrez le lien, choisissez un mot de passe (10 caractères minimum, avec lettres et chiffres), puis connectez-vous sur l'URL `/exec` avec votre e-mail et ce mot de passe.
15. **Installez les tâches planifiées : `installTriggers()`.** Crée `jobFrequent` (toutes les 15 min : expiration des missions de ménage non acceptées sous 2 h et réattribution, alertes d'arrivée non enregistrée et de départ dépassé) et `jobDaily` (vers 6 h : échéances de loyer, retards et fins de bail, abonnements, devis expirés, incidents anciens ou coûteux, purge des pièces sensibles expirées, arrivées du lendemain, expiration des liens voyageurs, sauvegarde quotidienne). Relancer la fonction ne crée pas de doublon.
16. **Vérifiez l'installation : `healthCheck()`.** Attendu : `ok: true`, `missingSheets: []`, `triggersOk: true`, `appUrlConfigured: true`, `driveRoot.ok: true`, `integrity.ok: true`.
17. **Lancez la suite de tests : `runAllTests()`.** Elle s'exécute dans un Google Sheet et un dossier **temporaires** (mis à la corbeille à la fin), sans toucher à votre base ni envoyer d'e-mail réel. Durée : quelques minutes. Résultat attendu : `failed: 0`. Quelques tests sont marqués `SKIP` dans Google (voir TESTS.md) : ils se valident à la main.
18. **Créez vos clients.** Dans l'application : Administration › Organisations › « Nouvelle » (une organisation par propriétaire ou par agence), Abonnements › attribuer un forfait, puis Utilisateurs › « Inviter » le propriétaire ou l'administrateur d'agence (invitation à usage unique, 7 jours). Ensuite, chaque propriétaire ajoute ses biens et invite lui-même son agence, ses gardiens, son personnel de ménage, ses artisans et ses locataires.
19. **Modèles Google Docs (facultatif).** Sans modèle, ImmoPilot produit des PDF intégrés (indicatifs). Pour utiliser vos propres modèles : avec le compte qui héberge ImmoPilot, ouvrez dans Google Drive le dossier `ImmoPilot_PRIVATE_FILES_DO_NOT_SHARE` › `Modeles`, créez-y un Google Docs (Nouveau › Google Docs) contenant les balises `{{…}}` ci-dessous, puis copiez son identifiant (la partie de l'URL entre `/d/` et `/edit`) dans Paramètres › ligne `template.leaseDocId` (ou `receiptDocId`, `reservationDocId`) › Modifier. Pour des raisons de sécurité, **seuls les Google Docs rangés dans ce dossier `Modeles` sont acceptés** (un autre identifiant est refusé). Les modèles de ce dossier sont communs à la plateforme : chaque organisation choisit celui qu'elle utilise ; un client qui veut son propre modèle vous l'envoie et vous le déposez dans `Modeles`. Balises disponibles :
    - Bail (`template.leaseDocId`) : `{{bailleur}} {{locataire}} {{locataire_email}} {{bien}} {{adresse}} {{surface}} {{debut}} {{fin}} {{loyer}} {{charges}} {{caution}} {{jour_echeance}} {{indexation}} {{conditions}} {{date}}`
    - Quittance (`template.receiptDocId`) : `{{bailleur}} {{locataire}} {{bien}} {{adresse}} {{periode}} {{loyer}} {{charges}} {{total}} {{date_paiement}} {{date}}`
    - Fiche de réservation (`template.reservationDocId`) : `{{reference}} {{bien}} {{adresse}} {{voyageur}} {{voyageurs}} {{arrivee}} {{depart}} {{nuits}} {{prix}} {{frais}} {{taxes}} {{total}} {{paye}} {{solde}} {{caution}} {{statut}} {{devise}}`
20. **Première sauvegarde manuelle : `backupNow()`.** Une copie privée de la base est créée dans `Sauvegardes` (ensuite, une sauvegarde est faite chaque jour et les 14 plus récentes sont conservées). Déroulez enfin la liste « avant production » de SECURITE.md.

> Vous partez d'une ancienne version d'ImmoPilot (phase 4) avec des données ? Suivez plutôt MIGRATION.md : à l'étape 9, renseignez d'abord `IMMO_DATABASE_SPREADSHEET_ID` avec votre base existante, qui sera complétée sans rien supprimer.

## 4. Mettre à jour une version déployée

Remplacez les fichiers, enregistrez, relancez `setupProject()` (idempotent : seules les migrations non encore appliquées s'exécutent), puis Déployer › Gérer les déploiements › ✏️ › Version : « Nouvelle version ». L'URL `/exec` ne change pas. Ne créez pas un nouveau déploiement à chaque mise à jour, sinon l'URL change et les liens déjà envoyés deviennent invalides.

## 5. Fonctions disponibles dans l'éditeur

Toutes refusent de s'exécuter si elles ne sont pas lancées depuis l'éditeur par le propriétaire du script.

| Fonction | Rôle |
|---|---|
| `setupProject()` | Installation à partir de rien (crée la base, le dossier privé, le premier super administrateur) ou mise à jour non destructive |
| `createFirstSuperAdmin()` | (Re)crée les super administrateurs de `IMMO_ADMIN_EMAILS` et envoie le lien d'activation |
| `installTriggers()` / `uninstallTriggers()` | Tâches planifiées |
| `verifierInstallation()` | Liste les fichiers `.gs` et `.html` manquants ou mal nommés (ne lit aucune donnée) |
| `healthCheck()` | Diagnostic (onglets, colonnes, migrations, déclencheurs, quota e-mail, intégrité) |
| `backupNow()` | Sauvegarde immédiate |
| `restoreFromBackup("ID")` | Restauration non destructive : sauvegarde de sécurité, puis une **copie** de la sauvegarde devient la base active ; l'ancienne base reste intacte (retour arrière : remettre son identifiant dans `IMMO_DATABASE_SPREADSHEET_ID`) |
| `runAllTests()` | Suite de 62 tests dans un environnement temporaire |
| `testerAssistantIA()` | Vérifie la configuration du mode IA de l'assistant Rubban (envoie une question test au fournisseur) |
| `creerEnvironnementDemo()` / `creerHistoriqueDemo()` | Environnement de démonstration et 6 mois d'historique fictif (organisations marquées « démo », exclues des statistiques de la plateforme) |
| `mettreDemoEnVeille()` / `reveillerDemo()` | Suspend ou réactive la démo, sans rien supprimer |

`jobFrequent` et `jobDaily` sont appelées par les déclencheurs ; elles ne renvoient qu'un résumé (`ok`, `skipped`, nombre d'erreurs) et sont protégées contre les exécutions rapprochées.

## 5 bis. Assistant Rubban (رُبّان)

La bulle en bas à droite ouvre **Rubban**, l'assistant d'aide, sur toutes les pages (et sur l'écran de connexion pour l'activation et le mot de passe oublié).

- **Mode Guide** (par défaut, gratuit, 24 h/24) : réponses pas à pas tirées de la base de connaissances `ASSISTANT_KB_` (`Assistant.gs`), filtrées selon le rôle, avec un bouton « Ouvrir la page ».
- **Mode IA** (facultatif) : renseignez `IMMO_AI_PROVIDER` et `IMMO_AI_API_KEY`, ajoutez la portée `https://www.googleapis.com/auth/script.external_request` au manifeste `appsscript.json` (déjà présente dans le fichier fourni), exécutez `testerAssistantIA()` pour autoriser et vérifier, puis créez une nouvelle version du déploiement.
  - Le serveur transmet au fournisseur la question, les derniers échanges, la page affichée, le rôle et la documentation ; **aucune donnée de la base** (biens, clients, montants) n'est envoyée.
  - Limites : 30 questions par heure et par utilisateur, 1 500 par jour pour la plateforme ; au-delà, ou en cas de panne, retour automatique au mode Guide.
  - Coût : facturé par le fournisseur selon l'usage. L'offre gratuite de Gemini peut utiliser les échanges pour améliorer les services de Google : préférez une offre payante pour des données professionnelles et mentionnez le service dans votre politique de confidentialité.

## 6. Points d'attention

- **« Impossible de trouver le fichier HTML nommé … »** ou page « installation incomplète » : un fichier d'interface manque ou a été créé comme Script au lieu de HTML. Lancez `verifierInstallation()` dans l'éditeur : le journal liste les fichiers à créer ou renommer. Après correction, enregistrez puis Déployer › Gérer les déploiements › ✏️ › Version : **Nouvelle version** › Déployer : un déploiement ne voit pas les modifications faites après lui.

- **Polices et bibliothèques** : l'interface charge IBM Plex (Google Fonts), Chart.js et Leaflet depuis cdnjs. Si ces ressources sont bloquées par un réseau d'entreprise, l'application reste utilisable (police système, graphiques et carte non affichés).
- **Cadre Google** : l'application est servie par Google dans un cadre isolé ; le bandeau « Cette application a été créée par un utilisateur de Google Apps Script » s'affiche pour les comptes gratuits. Un nom de domaine personnalisé n'est pas possible directement.
- **Téléchargements** : les PDF et CSV sont envoyés au navigateur en base64 puis enregistrés via un lien de téléchargement. Testez-le sur les navigateurs mobiles de vos utilisateurs (voir TESTS.md, M-11).
- **Comptes multiples Google** : si un utilisateur est connecté à plusieurs comptes Google dans le même navigateur, Google peut afficher une erreur d'accès sur les URL `script.google.com`. Une fenêtre de navigation privée règle le problème ; cela ne concerne pas l'authentification ImmoPilot.
