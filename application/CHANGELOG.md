# Journal des modifications

## 2.0.3 — 15 octobre 2026 — vitesse

- Cache partagé côté serveur (CacheService) : les tables sont gardées compressées en mémoire Google ; un écran lit en moyenne 0,5 feuille au lieu de 11 (mesuré sur le parcours complet de l'interface, 223 appels). Invalidation immédiate à chaque écriture, lectures sous verrou toujours faites sur la feuille, validation (flush) avant de rendre le verrou.
- Session : vérification du jeton servie par le cache (10 min, effacée dès déconnexion ou révocation).
- Navigateur : une page déjà vue se réaffiche instantanément pendant 60 s, requêtes identiques regroupées, mémoire vidée à chaque action ; un nouveau clic sur la page en cours force l'actualisation.
- Graphiques et carte chargés sans bloquer l'affichage (carte seulement à l'ouverture) ; contrôle d'installation mémorisé à l'ouverture de l'application.
- Nouvelles fonctions d'éditeur : viderCache() ; installTriggers ajoute surModificationBase (cache vidé après une saisie manuelle dans le classeur). mesurerPerformance() compare lecture feuille / cache.

## 2.0.2 — 15 octobre 2026

- Super administrateur : page « Comptes clients » (Propriétaires, Agences, Prestataires, Gardiens, Locataires) avec bouton « Entrer » qui ouvre l'espace de la personne tel qu'elle le voit. Tout y est possible ; chaque action est journalisée au nom du super administrateur (avec le compte concerné), bandeau rouge permanent, session limitée à 2 heures, retour en un clic. Mot de passe, déconnexion des appareils et demande de suppression restent réservés au titulaire.
- Trois nouvelles langues d'interface : espagnol, italien, néerlandais (1 169 textes et 367 libellés traduits). Les e-mails et PDF restent en français.

## 2.0.1 — 15 octobre 2026

- Bouton jour / nuit (☀️ / 🌙) dans la barre du haut et sur l'écran de connexion : thème clair ou sombre, mémorisé par appareil, réglage de l'appareil suivi par défaut. Graphiques, assistant Rubban et calendrier adaptés.

## 2.0.0 — 13 octobre 2026

Refonte complète en SaaS multi-organisations à partir de la phase 4, avec migration non destructive des données (voir MIGRATION.md et AUDIT.md).

### Ajouté

- **Connexion plus rapide** : mot de passe vérifié en JavaScript pur (au lieu de 4 000 appels au service Google), application affichée en un seul aller-retour après la connexion ou au rechargement, session retrouvée sans relire toute la table, tableau de bord super admin limité aux journaux de la période ; fonction `mesurerPerformance()`. Itérations PBKDF2 portées à 10 000 avec re-hachage transparent à la connexion.
- **Démo — voyageurs complets** : chaque occupant des réservations courte durée est enregistré (nom, prénom, nationalité, CIN ou passeport avec numéro au format du pays, e-mail et téléphone fictifs du voyageur principal), avec copies de pièce « SPÉCIMEN » sur les séjours récents et à venir ; procédure complète dans `PROCEDURE_COMPLETE.md`.
- **Mes agences** : fiche complète modifiable par le propriétaire (nom, adresse, ville, téléphone, e-mail de contact, nom et e-mail du responsable) ; changement d'e-mail du responsable = ancien accès retiré et nouveau lien d'activation envoyé ; bouton « Renvoyer le lien d'activation ».
- **Option agences** : les agences créées par un propriétaire n'ont plus d'abonnement propre ; elles sont facturées en option sur l'abonnement du propriétaire (prix par agence réglable dans chaque forfait) et suivent son statut. Ajout automatique des nouvelles colonnes au premier lancement.
- **Assistant Rubban (رُبّان, « le pilote »)** : bulle d'aide en bas à droite sur toutes les pages, disponible 24 h/24. Mode Guide gratuit (44 fiches pas à pas filtrées selon le rôle, bouton « Ouvrir la page ») et mode IA facultatif (Claude ou Gemini) appelé uniquement par le serveur, sans transmettre de données de la base, avec limites d'usage et repli automatique.
- **Démo isolée de l'activité réelle** : organisations marquées « démo » exclues par défaut du tableau de bord du super administrateur (organisations, comptes, biens, réservations, revenus de la plateforme) et de la liste des abonnements (case « Inclure la démo »), sans e-mails automatiques ; `mettreDemoEnVeille()` / `reveillerDemo()` suspendent ou réactivent la démo sans rien supprimer.
- **Documents PDF avec logo ImmoPilot** (tous les PDF) ; nouveaux documents : **ordre de mission de ménage**, **rapport de ménage avec photos avant / après** (fiche mission) et **contrat d'abonnement avec historique des abonnements et des règlements** (page Abonnements), **devis** et **facture** au nom du prestataire (sans la marque ImmoPilot, commission interne non affichée) et **bon d'intervention** enrichi (parties, travaux du devis, consignes, signatures). L'historique de démonstration ajoute abonnements Pro, listes de tâches par pièce et photos d'illustration.
- **Environnement de démonstration** : fonction d'éditeur `creerEnvironnementDemo()` (fichier `Demo.gs`) qui crée, sans rien supprimer ni dupliquer, un propriétaire et ses 3 biens, une agence et ses droits, un gardien par bien, un prestataire de l'annuaire et un second super administrateur, avec envoi des liens d'activation ; `creerHistoriqueDemo()` ajoute 6 mois d'activité fictive (réservations, arrivées et départs, ménages, incidents, devis, interventions, factures, dépenses, bail et loyers) pour alimenter tableaux de bord, finances et analyses de Pareto.
- **Suppression de compte** (exigée par Google Play et la loi 09-08) : « Supprimer mon compte » dans Paramètres › Mon profil (demande transmise aux super administrateurs) et « Supprimer le compte » pour le super administrateur (anonymisation irréversible ; données comptables conservées sans identité). Pages publiques `politique-confidentialite.html` et `suppression-compte.html`, visuels et textes de la fiche Google Play, guide `GUIDE_EN_LIGNE_SECURISE_ET_PLAY_STORE.md`.
- **3 modes d'accès** (dossier `deploiement-web-mobile/`, guide `GUIDE_3_MODES.md`) : site installable (PWA) hébergé gratuitement sur GitHub Pages, application Android (installation Chrome, APK ou Google Play) et iPhone (installation Safari ou App Store via le projet Capacitor fourni). Les trois affichent la même application et la même base : données identiques et instantanées partout. Intégration contrôlée par la propriété `IMMO_EMBED_ORIGINS` (désactivée par défaut) et vérification des sites parents côté interface.
- **« Mes agences » (propriétaire)** : liste de ses agences avec leurs droits bien par bien ; confier un bien, modifier les droits, retirer un accès ou tous les accès ; modifier la fiche et supprimer (de façon non destructive) une agence qu'il a créée. Une agence qui gère aussi les biens d'autres propriétaires ne peut pas être supprimée par l'un d'eux (seuls ses accès sont retirés).
- **Annuaire des prestataires géré par le super administrateur** : entreprises de ménage et artisans, avec leurs types de prestation (ménage, plomberie, électricité, climatisation, peinture, serrurerie, menuiserie, électroménager, jardinage, piscine, autre). Invitation automatique du compte (rôle ménage et/ou artisan). Les propriétaires et agences choisissent le type de prestation puis le prestataire dans la liste (devis, interventions, missions de ménage) ; ils ne créent plus de prestataires (paramètre plateforme `contractors.platformOnly`). Chaque client ne voit que l'activité et les montants réalisés chez lui.
- **Le propriétaire crée ses agences** : fiche du bien › Agences et équipes › « Créer une agence » (organisation agence + invitation de son responsable + attribution du bien avec les droits choisis, en une seule opération ; route `property.agencyCreate`, limitée au rôle propriétaire du bien).
- **Installation en 2 fichiers** (`dist/ImmoPilot.gs` et `dist/Index.html`, générés par `tests/build-bundle.js`) : beaucoup moins de copier-coller, aucun risque de fichier collé au mauvais endroit.
- **Vérification de l'installation** : si un fichier manque ou est mal nommé dans le projet Apps Script, l'application affiche la liste exacte des fichiers à corriger au lieu d'une erreur technique ; fonction d'éditeur `verifierInstallation()`.
- **Installation à partir de rien** : `setupProject()` crée la base Google Sheet privée, le dossier Drive privé et désigne le propriétaire du script comme premier super administrateur ; aucune propriété à renseigner avant la première exécution.
- **Comptes applicatifs** pour les utilisateurs externes : invitations à usage unique, activation, mot de passe PBKDF2, sessions révocables, mot de passe oublié, verrouillage, limitation de débit.
- **Permissions par capacités** : 8 rôles, droits fins (retrait de capacités), droits d'agence par bien, affectation du personnel par bien ou par réservation, assistance du super administrateur avec accord du client.
- **Réservations** : règle horaire avec battement de ménage, contrôle sous verrou entre agences, idempotence, contrôle de version, politique d'annulation, paiements partiels et remboursements, blocages, calendrier, fiche PDF.
- **Voyageurs** : minimisation des données, purge, portail voyageur à jeton.
- **Check-in / check-out mobiles** : checklist, photos, signature, état des lieux, retards.
- **Ménage** : création automatique au départ, acceptation sous 2 h, réattribution, photos avant/après, pièces, anomalies, validation, dépense unique.
- **Incidents**, **prestataires**, **devis**, **ordres d'intervention**, **factures** avec commission configurable (15 % par défaut) calculée une seule fois.
- **Location longue durée** : locataires, baux, échéancier, indexation, retards, quittances, préavis, renouvellement, restitution de caution, espace locataire.
- **Finances** : prévu / facturé / encaissé / payé / restant dû, rapprochement manuel, dépenses, revenus divers, occupation, ADR, RevPAR.
- **Abonnements** Essentiel / Pro / Business : essai, échéances, suspension en lecture seule, paiements manuels, quotas.
- **Tableaux de bord par rôle**, **10 analyses de Pareto**, **rapports** CSV / PDF.
- **Notifications** internes et e-mail avec préférences et déduplication ; liens WhatsApp `wa.me` (ouverture manuelle).
- **Interface** monopage de 30 écrans (plus 4 écrans publics : connexion, invitation, réinitialisation, portail voyageur), mobile, FR / EN / AR (droite-gauche), carte des biens, graphiques.
- **Exploitation** : manifeste, migrations versionnées, sauvegarde quotidienne, restauration non destructive, diagnostic de santé et d'intégrité (doublons, orphelins, chevauchements hérités), tâches planifiées, journal d'audit, 61 tests automatisés et un scénario d'installation complète sur un compte Google vierge.

### Modifié

- Suppression de `<base target="_top">` dans `Index.html` : c'est cette balise qui faisait ouvrir les liens du menu comme une nouvelle page (page blanche).
- Déclarations globales en `var` : un fichier collé deux fois n'empêche plus le projet de démarrer, et `verifierInstallation()` peut signaler le fichier fautif.
- Routeur : les routes désignent leur fonction par son nom ; un fichier `.gs` absent ou collé partiellement ne bloque plus toute l'application (message clair sur les seules routes concernées). `verifierInstallation()` détecte aussi les fichiers collés incomplètement.
- `IMMO_APP_URL` tolère une saisie incomplète (identifiant de déploiement seul, guillemets, URL `/dev`) : les liens envoyés sont toujours des adresses complètes `https://…/exec`.
- Les e-mails sont envoyés avec une version HTML : bouton « Ouvrir ImmoPilot » et lien cliquable (la version texte reste jointe).
- Les modèles Google Docs ne sont acceptés que s'ils sont rangés dans le dossier privé `Modeles` (empêche la copie d'un fichier quelconque du compte déployeur).
- Lecture des tables par nom de colonne ; écriture des cellules en texte forcé (pas de formule, pas de conversion automatique).
- `IncidentsV4` devient l'unique table d'incidents (les incidents de l'onglet `Incidents` y sont copiés).
- Les fichiers Drive sont enregistrés dans `Documents` et servis uniquement via le serveur.

### Supprimé

- Identification par `Session.getActiveUser()` pour les utilisateurs de l'application.
- Console de test JSON dans l'interface.
- `Phase4Operations.gs` (fonctions réparties dans les nouveaux services).

### Correspondance des anciennes fonctions

Les anciennes fonctions globales appelées par l'interface sont remplacées par des routes de `api(jeton, route, arguments)`.

| Phase 4 | 2.0.0 |
|---|---|
| `getAppBootstrap` | `me.get`, `meta.get` |
| `getDashboardData` | `dash.get` |
| `adminCreateOrganization`, `adminListOrganizations` | `org.create`, `org.list` |
| `adminCreateUser`, `adminCreateInvitation` | `invite.create` (plus de création de compte sans invitation) |
| `adminListInvitations`, `adminRevokeInvitation` | `invite.list`, `invite.revoke` |
| `acceptInvitation` | `invite.info`, `invite.accept` (publiques, avec définition du mot de passe) |
| `listProperties`, `createProperty`, `updateProperty` | `property.list`, `property.create`, `property.update` |
| `listPropertyOrganizations` | `property.orgChoices` |
| `createResidence`, `listResidences` | `residence.create`, `residence.list` |
| `setAgencyPropertyPermission`, `listAssignableAgencyOrganizations` | `property.agencySet`, `property.agencyChoices` |
| `assignUserToProperty`, `revokeUserPropertyAssignment`, `listPropertyAccessManagement` | `property.staffAssign`, `property.staffRevoke`, `property.access` |
| `getAvailability` | `resv.availability` |
| `createReservation`, `listReservations`, `cancelReservation` | `resv.create`, `resv.list`, `resv.cancel` |
| `createAvailabilityBlock` | `block.create` |
| `p4Event`, `p4ListEvents` | `ops.checkIn`, `ops.checkOut`, `ops.history` |
| `p4CreateCleaningMission`, `p4RespondCleaningMission`, `p4SubmitCleaningReport` | `clean.create`, `clean.respond`, `clean.room` / `clean.complete` |
| `p4ExpireCleaningMissions` | `jobFrequent` (nom conservé dans `Compat.gs`) |
| `p4CreateIncident`, `p4UpdateIncident` | `inc.create`, `inc.update` |
| `p4CreateArtisan` | `ctr.create` |
| `p4CreateQuote`, `p4DecideQuote` | `quote.create`, `quote.decide` |
| `p4CreateWorkOrder`, `p4CompleteWorkOrder` | `wo.create`, `wo.complete` |
| `p4GetPrivateFile` | `doc.get` |
| `p4SendEmail`, `p4WhatsAppLink` | `notif.email`, `notif.whatsapp` |
| `installPhase4Triggers` | `installTriggers` (nom conservé dans `Compat.gs`) |
| `setupProject`, `healthCheck` | identiques, réservées à l'éditeur |
| `runUnitTests`, `runIntegrationHealthTests`, `runPhase3LogicTests`, `runPhase4SchemaTests` | `runAllTests` |
