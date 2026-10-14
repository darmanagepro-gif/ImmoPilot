# ImmoPilot : mise en ligne stable et sécurisée, puis publication sur Google Play

Ce guide complète `GUIDE_3_MODES.md`. Il comporte deux parties :

- **Partie A** : rendre ImmoPilot stable et sûr en ligne, en particulier pour les **pièces d'identité (CIN, passeport)** ;
- **Partie B** : publier l'application Android sur **Google Play**, étape par étape.

> Google Play n'accepte plus de fichier **APK** pour une nouvelle application : il faut un fichier **AAB** (Android App Bundle). Les deux sont produits en même temps (étape B1). L'**APK** sert à installer l'application **sans** passer par le Play Store (étape B9).

---

# PARTIE A — En ligne, stable et sécurisé

## A1. Ce qui protège déjà les pièces d'identité dans ImmoPilot

| Protection | Comment elle fonctionne |
|---|---|
| Stockage privé | Les copies de CIN et de passeport sont rangées dans votre Drive privé, **jamais** partagées par lien. Elles ne transitent que par le serveur, après vérification des droits. |
| Accès limité | Seules les personnes ayant le droit « pièces d'identité » **sur le séjour concerné** peuvent les ouvrir. Par défaut, ce sont le propriétaire, l'administrateur d'agence et les agences autorisées à « gérer les réservations » sur ce bien. |
| Numéro masqué | Le numéro complet n'est pas conservé par défaut, seul un numéro masqué est enregistré (paramètre `guests.storeIdReference` = Non). |
| Suppression automatique | Les copies sont effacées **30 jours après le départ** du voyageur (paramètre `retention.sensitiveDocDays`), par la tâche quotidienne. |
| Traçabilité | Chaque dépôt et chaque consultation est inscrit dans le **Journal d'audit**. Les consultations répétées sont limitées (anti-aspiration). |
| Contrôle du fichier | Le serveur vérifie le vrai contenu du fichier (JPEG, PNG, WebP ou PDF), et la taille est limitée à 4 Mo. |
| Transport chiffré | Tout passe en HTTPS : Google et GitHub Pages. |
| Chiffrement au repos | Assuré par Google pour Drive et Sheets. ImmoPilot n'ajoute **pas** de chiffrement supplémentaire, car Apps Script ne le permet pas de façon fiable. |

## A2. Choisir le bon compte Google (le point le plus important)

Le compte qui déploie ImmoPilot **possède toutes les données de tous vos clients**.

1. **Utilisez un compte dédié à ImmoPilot**, jamais votre compte personnel.
2. **Recommandé pour un usage professionnel : Google Workspace** (abonnement mensuel par utilisateur, consultez le tarif en vigueur). Par rapport à un compte Gmail gratuit, vous obtenez :
   - des quotas plus élevés : environ 1 500 destinataires d'e-mails par jour au lieu d'environ 100, et plus de temps d'exécution pour les tâches planifiées ;
   - **pas de bandeau** « créée par un utilisateur de Google Apps Script » ;
   - une console d'administration : validation en deux étapes imposée, alertes de sécurité, journal des accès.
3. Un compte Gmail gratuit fonctionne pour démarrer et pour une petite activité.

## A3. Verrouiller ce compte (30 minutes, une fois)

Sur **myaccount.google.com** › **Sécurité** :

1. **Validation en deux étapes** : activez-la, avec une **clé de sécurité** ou l'application Google Authenticator plutôt que le SMS.
2. **Options de récupération** : un téléphone et une adresse de secours **qui vous appartiennent**.
3. **Applications tierces ayant accès au compte** : retirez tout ce que vous ne reconnaissez pas.
4. Facultatif, pour une protection maximale : le **Programme Protection Avancée** de Google.
5. Gardez la base `ImmoPilot_DB`, le dossier `ImmoPilot_PRIVATE_FILES_DO_NOT_SHARE` et le projet Apps Script **sans aucun partage**. Vérifiez-le : clic droit › Partager › « Accès limité » et aucune autre personne.
6. N'installez pas d'extensions de navigateur inconnues sur l'ordinateur qui sert à administrer ImmoPilot.

## A4. Réglages ImmoPilot pour les données sensibles

Dans **Administration › Paramètres** (pour toute la plateforme) ou **Paramètres** (par organisation) :

| Paramètre | Valeur conseillée | Pourquoi |
|---|---|---|
| `guests.storeIdReference` | **Non** | Ne pas conserver le numéro complet des pièces |
| `retention.sensitiveDocDays` | **30**, voire **7** | Garder les copies le moins longtemps possible |
| `retention.logDays` | 730 | Deux ans de traces en cas de litige |

Points d'attention :

- **Accès des agences aux pièces d'identité.** Cocher « Peut gérer les réservations et arrivées » pour une agence lui donne accès aux pièces d'identité des voyageurs **de ce bien**. Ne cochez cette case que pour les agences qui gèrent réellement les arrivées.
- **Coût du mot de passe** (propriété `IMMO_PBKDF_ITERATIONS`). Le réglage par défaut est 2 000. Mesurez le temps de connexion, puis montez la valeur, par exemple à 5 000 puis 10 000, tant que la connexion reste sous 3 secondes environ. Les mots de passe existants restent valables.
- **Propriété `IMMO_EMBED_ORIGINS`** : n'y mettez **que** votre adresse (`https://VOTRE-NOM.github.io`).
- **GitHub Pages** : dans Settings › Pages, cochez **Enforce HTTPS**.

## A5. Stabilité au quotidien

1. **Déploiements.** Publiez toujours une **Nouvelle version** du déploiement existant. N'utilisez jamais l'URL `/dev`. En cas de problème après une mise à jour : Déployer › Gérer les déploiements › ✏️, choisissez la **version précédente**, puis Déployer. Le retour arrière est immédiat, et l'adresse ne change pas.
2. **Tâches planifiées.** Lancez `installTriggers()` une fois, puis vérifiez qu'elles tournent dans Administration › onglet Tâches planifiées.
3. **Sauvegardes**, sur deux niveaux :
   - **automatique** : la sauvegarde quotidienne garde les 14 dernières copies dans votre Drive privé ;
   - **hors Google, une fois par mois** : ouvrez `ImmoPilot_DB` › Fichier › Télécharger › **Microsoft Excel**. Rangez ce fichier dans une archive **chiffrée** (par exemple 7-Zip avec mot de passe AES-256) sur un support qui vous appartient. Ce fichier contient des données personnelles : ne l'envoyez jamais par e-mail.
4. **Contrôle hebdomadaire** : `healthCheck()` dans l'éditeur doit afficher `ok: true`. Consultez aussi Administration › Erreurs techniques.
5. **Limites de Google Sheets.** ImmoPilot convient à plusieurs dizaines de biens et quelques milliers de réservations par an. Au-delà, prévoyez le passage à une base SQL (voir `ARCHITECTURE.md`).

## A6. Obligations au Maroc (loi 09-08)

*Ceci n'est pas un conseil juridique : faites valider ces points par un juriste.*

1. **Déclaration à la CNDP.** Les traitements de données personnelles doivent être déclarés à la Commission nationale (www.cndp.ma). Les pièces d'identité sont des données particulièrement sensibles.
2. **Transfert hors du Maroc.** Les données sont hébergées chez Google, potentiellement hors du Maroc. Un transfert à l'étranger peut nécessiter une **autorisation de la CNDP**.
3. **Information des personnes.** Publiez la politique de confidentialité fournie (`web/politique-confidentialite.html`), une fois complétée et validée.
4. **Contrats.** Avec chaque propriétaire et chaque agence cliente, prévoyez une clause de sous-traitance des données : qui est responsable, durée de conservation, mesures de sécurité.

## A7. Routine mensuelle (15 minutes)

- [ ] **Journal d'audit** : vérifiez les téléchargements de documents sensibles (`DOCUMENT_DOWNLOADED`, sensible = oui). Un volume inhabituel doit alerter.
- [ ] **Utilisateurs** : suspendez ou supprimez les comptes des personnes qui ne travaillent plus avec vous.
- [ ] **Demandes de suppression de compte** (notifications) : traitez-les sous 30 jours avec « Supprimer le compte ».
- [ ] **Sauvegarde hors Google** (A5.3).
- [ ] **`healthCheck()`**.

---

# PARTIE B — Publier sur Google Play

## B0. Prérequis (à faire avant tout)

1. **Site en ligne à la racine** : `https://VOTRE-NOM.github.io` (dépôt nommé `VOTRE-NOM.github.io`, voir `GUIDE_3_MODES.md`, mode 1).
2. **Nouvelle version de l'application** déployée, avec les fichiers fournis. Elle contient le bouton **« Supprimer mon compte »**, **obligatoire** pour Google Play : toute application avec des comptes doit permettre d'en demander la suppression depuis l'application **et** depuis une page web.
3. **Pages publiques en ligne**, complétées : remplacez les passages surlignés en jaune dans `web/politique-confidentialite.html` et `web/suppression-compte.html`, puis déposez-les sur GitHub.
4. **Compte de démonstration** pour les examinateurs de Google :
   - créez une organisation « Démo » avec 2 ou 3 biens et quelques réservations **fictives** ;
   - invitez une adresse dédiée, par exemple `demo.immopilot@…`, avec le rôle Propriétaire, puis activez-la.
5. Préparez :
   - un compte Google pour la Play Console (de préférence le compte dédié) ;
   - une carte bancaire ;
   - une pièce d'identité (vérification par Google) ;
   - la liste de **12 testeurs au moins** : adresses Gmail de collègues, de clients, de proches.

## B1. Fabriquer l'application avec PWABuilder (gratuit, sans programmer)

1. Allez sur **www.pwabuilder.com**, collez `https://VOTRE-NOM.github.io`, puis **Start**.
2. Une fois l'analyse terminée : **Package For Stores** › **Android** › **Generate Package**.
3. Dans **All Settings**, renseignez :

| Option | Valeur |
|---|---|
| Package ID | `ma.immopilot.app`. **Définitif** : il ne pourra plus jamais changer. |
| App name | `ImmoPilot – Gestion locative` |
| Launcher name | `ImmoPilot` |
| App version | `2.0.0` |
| App version code | `1`. À augmenter de 1 à chaque nouvelle publication. |
| Host | `VOTRE-NOM.github.io` |
| Start URL | `/` |
| Theme color / Background color | `#13233d` |
| Display mode | Standalone |
| Signing key | **Create new** : renseignez votre nom, votre organisation et le pays MA |

4. Téléchargez le ZIP. Il contient en général :
   - `*.aab` : pour Google Play ;
   - `*.apk` : pour l'installation directe ;
   - `assetlinks.json` ;
   - `signing.keystore` et `signing-key-info.txt`.
5. **Sauvegardez immédiatement `signing.keystore` et `signing-key-info.txt`** à **deux** endroits sûrs, par exemple une clé USB et un coffre de mots de passe. **Sans eux, plus aucune mise à jour de l'application n'est possible.**
6. Sur GitHub, remplacez `.well-known/assetlinks.json` par celui du ZIP. Vérifiez ensuite que `https://VOTRE-NOM.github.io/.well-known/assetlinks.json` s'affiche bien dans le navigateur.

## B2. Tester sur votre téléphone

1. Envoyez-vous le fichier `.apk` et ouvrez-le sur un téléphone Android. Autorisez « installer des applications de cette source ».
2. Ouvrez ImmoPilot et vérifiez :
   - **aucune barre d'adresse** en haut. Si une barre apparaît, `assetlinks.json` ne correspond pas : refaites B1.6 ;
   - connexion, menus, photo, signature, téléchargement d'un PDF ;
   - un lien d'invitation reçu par e-mail ouvre bien l'application.

## B3. Ouvrir le compte développeur Google Play

1. Allez sur **play.google.com/console** › créez un compte développeur.
2. Choisissez le type de compte :
   - **Personnel** : le plus simple. Exige le test fermé de B6 : **12 testeurs pendant 14 jours**.
   - **Organisation** : exige un numéro **D-U-N-S** pour votre société (gratuit, mais plusieurs jours d'attente).
3. Payez les frais d'inscription (**25 $**, une seule fois), puis effectuez la vérification d'identité. Comptez quelques jours.

## B4. Créer l'application et sa fiche

1. **Créer une application** :
   - nom : `ImmoPilot – Gestion locative` ;
   - langue : français (France) ;
   - type : application ;
   - gratuite ;
   - cochez les déclarations.
2. **Fiche Play Store principale** : copiez les textes de `play-store/fiche-play-store.md`, puis téléversez :
   - l'icône `play-store/icone-512.png` ;
   - l'image de présentation `play-store/banniere-1024x500.png` ;
   - les captures `play-store/capture-*.png`.
3. Ajoutez la catégorie (Professionnel) et l'e-mail de contact.

## B5. Remplir « Contenu de l'application » (obligatoire)

Menu **Règles › Contenu de l'application** :

| Rubrique | Réponse |
|---|---|
| Règles de confidentialité | `https://VOTRE-NOM.github.io/politique-confidentialite.html` |
| Accès à l'application | « Certaines fonctionnalités sont limitées » › ajoutez les **identifiants du compte de démonstration** (B0.4) et une phrase d'explication |
| Annonces | Non, pas de publicité |
| Classification du contenu | Questionnaire : catégorie « Utilitaires / productivité », aucune violence, aucun contenu sexuel, pas d'achats in-app |
| Public cible | **18 ans et plus** |
| Application gouvernementale, fonctionnalités financières, santé, actualités | Non |
| Sécurité des données | Voir le tableau ci-dessous |

**Sécurité des données**, réponses à adapter à votre usage réel :

| Question | Réponse |
|---|---|
| Collectez-vous des données ? | Oui |
| Chiffrées en transit ? | Oui |
| Les utilisateurs peuvent-ils demander leur suppression ? | Oui. Lien : `https://VOTRE-NOM.github.io/suppression-compte.html` |
| Informations personnelles | Nom, adresse e-mail, téléphone, « autres informations » (nationalité et type de pièce d'identité des voyageurs). Finalités : fonctionnement de l'application, gestion du compte. Collecte obligatoire. |
| Photos et vidéos | Photos (états des lieux, ménage, incidents, pièces d'identité). Finalité : fonctionnement de l'application. |
| Fichiers et documents | Oui (contrats, factures, pièces d'identité) |
| Informations financières | « Autres informations financières » : paiements enregistrés manuellement |
| Partage avec des tiers | Non. Selon les définitions de Google, l'hébergeur qui traite les données pour votre compte (un prestataire) n'est pas un partage. Vérifiez ce point dans l'aide de la Play Console. |

## B6. Test fermé (12 testeurs, 14 jours)

1. **Tester et publier › Tests › Test fermé** › **Créer un canal** (par exemple « Testeurs »).
2. **Pays** : Maroc, plus les autres pays de vos testeurs.
3. **Testeurs** : créez une liste avec **au moins 12 adresses Gmail**.
4. **Créer une version** :
   - acceptez la **signature des applications par Google Play** ;
   - importez le fichier **`.aab`** ;
   - notes de version : « Première version » ;
   - **Examiner la version** › **Déployer**.
5. **Point essentiel :**
   - allez dans **Tester et publier › Configuration › Intégrité de l'application** › onglet « Signature de l'application » ;
   - copiez l'empreinte **SHA-256 du certificat de la clé de signature** ;
   - ajoutez-la **en plus** de celle déjà présente dans `.well-known/assetlinks.json` sur GitHub.

   Google re-signe l'application téléchargée depuis le Play Store. Sans cette seconde empreinte, l'application installée depuis le Play Store affiche une barre d'adresse.

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": { "namespace": "android_app", "package_name": "ma.immopilot.app",
       "sha256_cert_fingerprints": ["EMPREINTE_DE_PWABUILDER", "EMPREINTE_DE_GOOGLE_PLAY"] }
   }]
   ```

6. Envoyez aux testeurs le **lien d'inscription** (page du canal de test). Chacun doit cliquer sur « Devenir testeur », installer l'application depuis le Play Store, puis **rester inscrit 14 jours d'affilée**.
7. Pendant ces 14 jours, demandez aux testeurs de vraiment utiliser l'application. Google peut vous interroger sur leurs retours.

## B7. Passer en production

1. Après 14 jours, ouvrez le **Tableau de bord** › **Demander l'accès à la production**. Répondez au questionnaire : comment vous avez testé, quels retours, ce que vous avez corrigé.
2. Une fois l'accès accordé : **Production** › **Créer une version** › reprenez le même `.aab`, ou une nouvelle version avec un **version code** plus élevé.
3. Pays : Maroc, et éventuellement d'autres pays.
4. **Déployer**. L'examen de Google prend en général quelques jours, parfois plus.

## B8. Mises à jour

| Ce qui change | Que faire |
|---|---|
| Fonctionnalités d'ImmoPilot | **Uniquement** dans Apps Script : nouveaux fichiers, puis Nouvelle version. L'application Android est à jour immédiatement, **sans republier** sur le Play Store. |
| Nom, icône ou couleurs | PWABuilder avec **la même clé** : « Use mine », en fournissant `signing.keystore` et les mots de passe. Mettez **version code + 1**, puis importez le nouveau `.aab` dans la Play Console. |

## B9. Distribuer l'APK sans Google Play (gratuit)

Envoyez le fichier `.apk` (étape B1) à vos utilisateurs par e-mail, WhatsApp ou téléchargement depuis votre site. À l'installation, Android demande d'autoriser la source.

Cette voie a des limites :
- pas de mise à jour automatique de l'application elle-même. Ce n'est pas gênant, puisque les fonctionnalités se mettent à jour côté serveur ;
- certains téléphones affichent des avertissements de sécurité.

---

## Ce qui reste de votre ressort (récapitulatif honnête)

- **Vérifié dans mes tests :**
  - tout le code (59 tests, interface et navigation) ;
  - l'affichage dans la coquille au format téléphone ;
  - le refus des sites non autorisés ;
  - la demande de suppression de compte et l'anonymisation.
- **Non vérifié par moi** (impossible depuis mon environnement) :
  - la compilation PWABuilder ;
  - l'installation sur un vrai téléphone ;
  - la Play Console ;
  - l'examen de Google.
- **À faire valider par un professionnel :**
  - la politique de confidentialité ;
  - la déclaration CNDP ;
  - les durées de conservation ;
  - les modèles de contrats.
