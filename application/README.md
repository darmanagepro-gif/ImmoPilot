# ImmoPilot 2.0.0 — SaaS de gestion immobilière multi-organisations (Maroc)

ImmoPilot gère des biens en location courte et longue durée à Marrakech et au Maroc : réservations sans double occupation, check-in / check-out mobiles, ménage avec acceptation sous 2 h, incidents, devis, interventions et factures d'artisans (commission configurable, 15 % par défaut), baux et loyers, finance (prévu / facturé / encaissé / payé / restant dû), abonnements, tableaux de bord par rôle, 10 analyses de Pareto, rapports CSV/PDF et notifications (e-mail, interne, liens WhatsApp `wa.me`).

Pile technique : Google Apps Script (V8) · Google Sheets (base de données) · Google Drive (documents privés) · Google Docs (modèles) · Gmail (MailApp) · HTML/CSS/JS (application monopage) · Chart.js 4.4.1 · Leaflet 1.9.4. Langues : français (par défaut), anglais, arabe (affichage de droite à gauche). Devise : MAD. Fuseau : Africa/Casablanca.

## Installation la plus simple : 2 fichiers (recommandée)

Le dossier **`dist/`** contient toute l'application en **2 fichiers** à coller dans Apps Script, au lieu de 39 :

- `dist/ImmoPilot.gs` : tout le code serveur (≈ 6 500 lignes) ;
- `dist/Index.html` : toute l'interface (≈ 2 100 lignes) ;
- `dist/appsscript.json` : le manifeste.

Dans le projet Apps Script, il ne doit rester **que** ces fichiers : `ImmoPilot.gs`, `Index.html` et `appsscript.json`. Chaque fichier se termine par une ligne « FIN DU FICHIER » : si elle manque après le collage, le copier-coller est incomplet. Le reste de la procédure (setupProject, déploiement, etc.) est identique. Les fichiers séparés à la racine restent fournis pour la lecture et la maintenance du code.

## Démarrage rapide (installation à partir de rien)

Aucun fichier à préparer : il suffit d'un compte Google. Le script crée lui-même sa base de données (Google Sheet `ImmoPilot_DB`), son dossier Drive privé et votre compte de super administrateur.

1. Sur script.google.com, créez un nouveau projet `ImmoPilot` et collez-y les 31 fichiers `.gs`, les 8 fichiers `.html` et `appsscript.json` (liste ci-dessous).
2. Dans l'éditeur, exécutez `setupProject()` et acceptez les autorisations. **Aucune propriété à renseigner avant.**
3. Déployez en « Application Web » (exécuter en tant que **Moi**, accès **Tout le monde**), puis ajoutez la propriété du script `IMMO_APP_URL` = l'URL `/exec`.
4. Exécutez `createFirstSuperAdmin()` : ouvrez le lien d'activation reçu par e-mail (aussi écrit dans le journal d'exécution), choisissez votre mot de passe, connectez-vous.
5. Exécutez `installTriggers()`, `healthCheck()`, `runAllTests()` puis `backupNow()`.

La procédure détaillée en 20 étapes est dans **DEPLOIEMENT.md**. Lisez **SECURITE.md** avant d'ouvrir l'application à des clients.

## Documentation

| Fichier | Contenu |
|---|---|
| DEPLOIEMENT.md | Installation pas à pas, paramètres, premier super administrateur, déploiement, identité et quotas Google |
| MIGRATION.md | Uniquement si vous possédez déjà une base ImmoPilot phase 4 à reprendre (sinon, ignorez ce fichier) |
| AUDIT.md | Audit du code phase 4 fourni : ce qui a été conservé, corrigé, remplacé |
| ARCHITECTURE.md | Modules, routeur, règles métier (dates, finance, commission, Pareto), limites et évolution vers SQL |
| SCHEMA_DONNEES.md | Les 48 tables : colonnes, types, clés, relations, champs obligatoires, organisation propriétaire |
| SECURITE.md | Modèle de menace, contrôles en place, limites connues, liste de vérification avant production |
| TESTS.md | Tests réellement exécutés et leurs résultats, tests restant à exécuter dans Google |
| CHANGELOG.md | Nouveautés 2.0.0 et correspondance anciennes fonctions → nouvelles routes |

## Fichiers à copier dans Apps Script

Serveur (`.gs`) : Code, Config, Auth, Permissions, Database, Migrations, Utils, Admin, OrganizationService, UserService, PropertyService, ReservationService, GuestService, CheckInOutService, CleaningService, IncidentService, ContractorService, WorkOrderService, InvoiceService, FinanceService, LeaseService, SubscriptionService, DashboardService, ParetoService, ReportsService, NotificationService, DriveService, AuditService, Triggers, Tests, Compat.

Interface (`.html`, à créer comme « Fichier HTML » en conservant exactement le nom sans extension) : Index, Styles, Scripts, Components, Login, Dashboard, Pages, I18n.

Manifeste : `appsscript.json` (Paramètres du projet › cocher « Afficher le fichier manifeste appsscript.json »).

Le dossier `tests/` **ne se copie pas** dans Apps Script : c'est l'outillage hors Google (simulateur Node, test d'interface jsdom, serveur de prévisualisation, générateur des traductions) qui a servi à exécuter les tests décrits dans TESTS.md.

## Ce qu'ImmoPilot ne fait pas (volontairement)

- Aucun paiement n'est simulé ni encaissé automatiquement : chaque encaissement est saisi manuellement, avec rapprochement manuel. Le module d'abonnement prévoit un adaptateur de prestataire (`PAYMENT_PROVIDERS_`) dont seul le mode manuel est actif.
- Aucun envoi WhatsApp automatique : l'application génère des liens `wa.me` que l'utilisateur ouvre et envoie lui-même.
- Aucune intégration bancaire.
- Les modèles de bail, quittance et fiche de réservation sont **indicatifs** : leur conformité juridique (loi 67-12, loi 09-08 / CNDP pour les pièces d'identité) doit être validée par un professionnel avant usage.
