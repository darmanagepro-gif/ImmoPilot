# ImmoPilot France — procédures complètes

Même logiciel que la version Maroc, en **édition France** : euro, fuseau Europe/Paris, carte nationale d'identité, fiches de police des voyageurs étrangers, n° d'enregistrement des meublés de tourisme, mentions légales françaises et logo tour Eiffel.

Deux façons de le mettre en ligne, indépendantes l'une de l'autre :

| | A. Google Apps Script | B. Serveur dédié (VPS) |
|---|---|---|
| Hébergement | Votre compte Google (Sheets, Drive, Gmail) | Votre serveur, votre nom de domaine |
| Coût | Gratuit (quotas Google) | Location du serveur (environ 5 à 20 € par mois) + service d'e-mail |
| Vitesse | 0,5 à 1 s par action | Quasi instantané |
| Adresse | `https://script.google.com/macros/s/…/exec` | `https://app.votre-domaine.fr` |
| Mise à jour | Automatique depuis GitHub | `sudo immopilot-update` |

Fichiers (dépôt GitHub `darmanagepro-gif/ImmoPilot`, dossier `application/`) :
- `dist-fr/` : paquet Google Apps Script France (`ImmoPilot.gs`, `Index.html`, `appsscript.json`) ;
- `server/` : version serveur dédié (et `server/deploy/` : installation, service, HTTPS, sauvegardes) ;
- `editions/fr/` : logo (SVG) et icônes ;
- `france/apps-script.json` : adresses du projet Google France (créé automatiquement).

---

## A. Version Google Apps Script (France)

Le projet **« ImmoPilot France »** est créé dans votre Google Drive et déployé par GitHub (action « Déployer ImmoPilot France »), avec la même connexion Google que la version Maroc. Le projet Maroc n'est jamais modifié par cette action.

Une fois le projet créé, à faire **une seule fois** :

1. Ouvrez l'éditeur du projet (lien `editorUrl` dans `application/france/apps-script.json`, ou script.google.com › « ImmoPilot France »).
2. En haut, choisissez la fonction **setupProject** puis **Exécuter**, et acceptez les autorisations (compte Google propriétaire). Cela crée la base Google Sheet privée et le dossier Drive privé, et fait de vous le super administrateur. Le lien d'activation arrive par e-mail ; il est aussi visible dans le journal d'exécution.
3. **Paramètres du projet** (roue dentée) › **Propriétés du script** : ajoutez `IMMO_APP_URL` avec l'adresse `webAppUrl` de `apps-script.json`.
4. Exécutez **installTriggers** : tâches automatiques (missions de ménage expirées, retards, rappels de loyers, sauvegardes, purge des pièces d'identité).
5. Ouvrez l'adresse `/exec` et activez votre compte avec le lien reçu.
6. Dans l'application : **Paramètres › Paramètres de la plateforme**, renseignez les clés `legal.*` (raison sociale, forme juridique et capital, adresse, RCS ou SIREN, n° de TVA, directeur de la publication, médiateur de la consommation). Elles alimentent les pages légales ; tant qu'elles manquent, elles apparaissent surlignées « À compléter ».
7. **Abonnements › Forfaits** : vérifiez les prix (29 / 59 / 149 € HT par mois par défaut) et le prix de l'« Option agences ».
8. Facultatif, démonstration : exécutez **creerEnvironnementDemo**, puis **creerHistoriqueDemo**. Vous obtenez des biens à Paris, des prix en euros, des voyageurs avec leurs pièces et les données des fiches de police. La démonstration est exclue des statistiques.

Mises à jour : automatiques. Chaque nouvelle version poussée sur GitHub met à jour la même adresse `/exec`. En cas de besoin, l'installation manuelle reste possible : copier `dist-fr/ImmoPilot.gs` et `dist-fr/Index.html` dans le projet, puis Déployer › Gérer les déploiements › Nouvelle version.

---

## B. Site SaaS sur serveur dédié (VPS)

### B1. Prérequis
- Un serveur **Ubuntu 24.04** (ou 22.04, ou Debian 12), architecture **x86_64**, avec 2 processeurs, 4 Go de mémoire et 40 Go de disque. Pour les données de vos clients, choisissez de préférence un hébergeur **situé dans l'Union européenne** (OVHcloud, Scaleway, Hetzner, IONOS…).
- Un **nom de domaine**, par exemple `app.mondomaine.fr`, avec un enregistrement DNS **A** pointant vers l'adresse IP du serveur (et **AAAA** pour l'IPv6, le cas échéant).
- Un **service d'envoi d'e-mails (SMTP)** : Brevo, Mailjet, OVH, Google Workspace… Configurez SPF et DKIM pour votre domaine, afin que les invitations n'arrivent pas en spam.

### B2. Installation (environ 10 minutes)
Connectez-vous en SSH au serveur, puis :

```bash
curl -fsSL https://raw.githubusercontent.com/darmanagepro-gif/ImmoPilot/main/application/server/deploy/install.sh -o install.sh
sudo bash install.sh app.mondomaine.fr vous@mondomaine.fr fr
```

Le script installe Node.js 22, Chrome ou Chromium (pour les PDF), Caddy (HTTPS automatique Let's Encrypt), le pare-feu (ports 22, 80 et 443 uniquement) et le service `immopilot` (utilisateur dédié, système en lecture seule). Il programme aussi une sauvegarde quotidienne, crée la base de données et fait de vous le super administrateur.

### B3. Réglages après installation
1. **E-mails** : `sudo nano /etc/immopilot/immopilot.env`. Remplissez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `MAIL_FROM`, puis `sudo systemctl restart immopilot`.
2. **Lien d'activation** : il est envoyé par e-mail dès que le SMTP fonctionne, et noté dans `/root/immopilot-setup.txt`. Pour en générer un nouveau : `sudo immopilot run createFirstSuperAdmin`.
3. Ouvrez `https://app.mondomaine.fr`, activez votre compte, puis complétez les clés `legal.*` (comme en A.6). Sur le serveur dédié, l'hébergeur à indiquer est votre loueur de serveur (nom, adresse, téléphone).
4. Facultatif : `sudo immopilot run creerEnvironnementDemo`, puis `sudo immopilot run creerHistoriqueDemo`.
5. Facultatif, assistant IA :
   - `sudo immopilot set IMMO_AI_PROVIDER anthropic` ;
   - `sudo immopilot set IMMO_AI_API_KEY <votre clé>` ;
   - vérification : `sudo immopilot run testerAssistantIA`.

### B4. Exploitation
| Besoin | Commande |
|---|---|
| État du service | `systemctl status immopilot` |
| Journal | `journalctl -u immopilot -f` |
| File d'envoi des e-mails | `sudo immopilot mails` |
| Mise à jour depuis GitHub (avec sauvegarde avant) | `sudo immopilot-update` |
| Sauvegarde immédiate | `sudo immopilot-backup` (copies dans `/var/backups/immopilot`, conservées 14 jours) |
| Mesure de vitesse | `sudo immopilot run mesurerPerformance` |
| Diagnostic | `sudo immopilot run healthCheck` |

**Copiez les sauvegardes hors du serveur** (rclone vers un stockage objet, un NAS…) : une sauvegarde restée sur la même machine ne protège pas d'une panne du serveur.

**Restauration** :
1. `sudo systemctl stop immopilot` ;
2. copiez la sauvegarde choisie vers `/var/lib/immopilot/immopilot.db`, puis supprimez les fichiers `immopilot.db-wal` et `immopilot.db-shm` ;
3. décompressez `fichiers-…tar.gz` dans `/var/lib/immopilot` ;
4. `sudo chown -R immopilot:immopilot /var/lib/immopilot` ;
5. `sudo systemctl start immopilot`.

### B5. Sécurité, ce qui est en place
- **HTTPS obligatoire** (HSTS), en-têtes de sécurité stricts, application non intégrable dans un autre site.
- **Appels protégés** : seuls les appels de l'application sont acceptés, avec une limite de débit par adresse IP.
- **Administration** réservée au serveur lui-même (adresse locale et jeton secret).
- **Données et fichiers privés** dans `/var/lib/immopilot` (droits 700), jamais servis publiquement. Les pièces d'identité et fiches de police ne sont visibles que des personnes habilitées et sont supprimées automatiquement.
- **Mots de passe hachés** (PBKDF2), mêmes droits et mêmes contrôles que la version Google : le code métier est identique. Les 68 tests métier passent sur le serveur, et les données sont identiques après redémarrage.
- **Mises à jour de sécurité** du système automatiques (unattended-upgrades).

---

## C. Logo
`editions/fr/logo.svg` : tour Eiffel, monogramme « IP » et bande tricolore, sur le fond bleu nuit d'ImmoPilot. Icônes 32, 180, 192, 512 et 1024 px et version « maskable » pour Android dans `editions/fr/icons/`. Le logo figure aussi sur les PDF générés par ImmoPilot (contrats, rapports, fiches de police). Les devis et factures restent au nom du prestataire.

---

## D. Obligations françaises : liste de contrôle
L'application fournit les outils et les modèles, mais **ne garantit pas la conformité juridique**. Faites relire les pages légales et les modèles par un avocat ou un juriste.

- [ ] Mentions légales (LCEN) : éditeur, directeur de la publication, hébergeur.
- [ ] CGV / CGU du service, médiateur de la consommation si vous avez des clients particuliers.
- [ ] RGPD :
  - [ ] registre des traitements ;
  - [ ] politique de confidentialité ;
  - [ ] accord de sous-traitance (art. 28) avec vos clients, proposé dans l'application ;
  - [ ] contrats avec vos propres sous-traitants (hébergeur, e-mail, IA si activée) ;
  - [ ] information des voyageurs par vos clients.
- [ ] Clients loueurs en meublé de tourisme :
  - [ ] déclaration en mairie et n° d'enregistrement (champ prévu sur chaque bien) ;
  - [ ] taxe de séjour (champ par nuit et par personne) ;
  - [ ] fiches individuelles de police pour les voyageurs étrangers, conservées 6 mois (PDF généré).
- [ ] Factures : mentions obligatoires (SIRET, TVA ou mention d'exonération, pénalités de retard, indemnité forfaitaire de 40 € entre professionnels). Les prestataires complètent leur fiche (raison sociale, SIRET).
- [ ] Baux d'habitation : loi du 6 juillet 1989 et contrat type (décret 2015-587). Le modèle généré est indicatif.
- [ ] Encaissements : l'application n'encaisse rien en ligne. Elle enregistre les règlements réellement reçus.
