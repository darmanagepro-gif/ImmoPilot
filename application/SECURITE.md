# Sécurité d'ImmoPilot 2.0.0

Ce document décrit le modèle de menace, les contrôles en place, leurs limites connues et la liste de vérification à dérouler avant d'ouvrir l'application à des clients. Il ne remplace pas un audit de sécurité indépendant ni une analyse juridique (loi 09-08, déclarations ou autorisations CNDP).

## Actifs à protéger

1. Données personnelles : voyageurs (identité, téléphone, pièce d'identité éventuelle), locataires, personnel, artisans.
2. Données financières : réservations, paiements, loyers, factures, commissions.
3. Documents : pièces d'identité, états des lieux, photos, contrats, factures (Drive).
4. Comptes : mots de passe, sessions, liens d'invitation et de réinitialisation.
5. Cloisonnement : aucune organisation ne doit voir les données d'une autre.

## Surface d'exposition

L'application web est déployée « exécuter en tant que moi » et accessible à « tout le monde, y compris anonyme ». Toute personne connaissant l'URL peut donc :

- charger la page de connexion ;
- appeler `apiPublic` (connexion, mot de passe oublié, réinitialisation, informations et acceptation d'invitation, portail voyageur) ;
- appeler `api` avec un jeton quelconque ;
- appeler n'importe quelle **fonction globale** du projet via `google.script.run`.

D'où les règles appliquées dans le code : toutes les fonctions internes se terminent par `_` (Apps Script les rend inaccessibles depuis le navigateur) ; les fonctions globales restantes sont soit les deux points d'entrée contrôlés, soit des fonctions d'éditeur qui vérifient que l'utilisateur actif est le propriétaire du script (`assertEditor_` — l'utilisateur actif est vide pour un visiteur), soit les tâches planifiées qui sont protégées contre les appels rapprochés et ne renvoient qu'un résumé.

## Modèle de menace et contrôles

| Menace | Contrôle | Test |
|---|---|---|
| Usurpation d'identité (e-mail fourni par le navigateur) | Le serveur ne fait jamais confiance à un e-mail venant du client : l'identité découle du jeton de session vérifié côté serveur | T « jeton forgé » |
| Vol ou devinette de mot de passe | PBKDF2-HMAC-SHA256 avec sel aléatoire ; verrouillage 15 min après 5 échecs ; limitation à 10 tentatives / 10 min par e-mail ; message identique pour e-mail inconnu et mot de passe faux (seul un compte existant pas encore activé reçoit un message qui l'oriente vers l'activation) | T « verrouillage », « vecteurs RFC » |
| Vol de jeton de session | Jeton aléatoire 256 bits ; seule son empreinte SHA-256 est stockée ; expiration 12 h ; conservation dans `sessionStorage` (effacé à la fermeture de l'onglet) ; révocation à la suspension, des autres sessions au changement de mot de passe, « déconnecter toutes les sessions » | T « utilisateur suspendu » |
| Réutilisation d'un lien d'invitation / de réinitialisation | Jeton à usage unique, haché, expirant (invitation 7 j, activation 72 h, réinitialisation 1 h), révocable ; l'invitation n'accorde que le rôle prévu, dans l'organisation prévue | T « expirée », « déjà utilisée », « révoquée » |
| Élévation de privilèges | Rôles invitables limités par rôle invitant (`INVITABLE_ROLES`) ; les droits fins ne peuvent que **retirer** des capacités ; un utilisateur ne modifie pas ses propres rôles ; super administrateur créé seulement depuis l'éditeur | T « élévation impossible » |
| Accès direct à un objet d'autrui (IDOR) | Chaque route recharge l'objet par son identifiant et vérifie l'accès au bien / à l'organisation ; réponse identique « introuvable ou accès refusé » pour un objet inexistant ou interdit | T « IDOR », matrice d'accès 8 rôles (test d'interface) |
| Fuite entre agences | Droits d'agence par bien (consultation, réservations, opérations, finance), révocables ; une agence ne voit pas les biens confiés à une autre | T « cloisonnement entre agences » |
| Super administrateur trop puissant | Choix de l'exploitant (octobre 2026) : le super administrateur peut **entrer dans l'espace** d'un compte client (page « Comptes clients ») et y agir. Garde-fous : session distincte de 2 h au plus, invalidée dès qu'il perd son rôle ; impossible vers un autre super administrateur ; bandeau permanent ; chaque action journalisée à **son** nom avec le compte concerné (`asUser`) ; entrée et sortie journalisées ; mot de passe, déconnexion des appareils et demande de suppression réservés au titulaire. L'accès d'**assistance** (lecture seule, approuvé par l'organisation) reste disponible. À mentionner dans vos conditions d'utilisation et votre déclaration CNDP. | T « Comptes classés par espace, entrer dans l'espace d'un client… » |
| Double réservation par requêtes concurrentes | Contrôle de chevauchement refait sous `LockService` au moment de l'écriture ; clés d'idempotence ; contrôle de version sur les modifications | T « requêtes concurrentes » (simulé), M-05 |
| Injection de formules (Sheets, CSV) | Toute valeur texte est écrite en texte forcé ; les cellules CSV commençant par `= + - @` (et tabulation, retour chariot) sont préfixées | T « injection de formule » |
| Injection HTML / script dans l'interface | Construction du DOM par `textContent` / attributs (`h()`), pas d'`innerHTML` sur des données ; HTML des PDF échappé côté serveur | Revue de code |
| Téléversement malveillant | Types autorisés : JPEG, PNG, WebP, PDF (l'import de biens CSV est lu comme texte, jamais stocké tel quel), vérification des octets magiques, 4 Mo maximum, nom de fichier assaini, quota de stockage du forfait | T « contenu ≠ type annoncé » |
| Copie d'un fichier quelconque via un « modèle » | Un identifiant de modèle n'est accepté que s'il désigne un Google Docs rangé dans le dossier privé `Modeles` ; contrôle refait à chaque génération | T « modèle de document » |
| Exposition de documents Drive | Dossiers et fichiers en partage **privé** ; aucun identifiant ou lien Drive transmis au navigateur ; téléchargement uniquement via `doc.get` après contrôle d'accès | T « document privé refusé sans droit », M-07 |
| Fuite d'informations techniques | Erreurs internes remplacées par une référence `ERR-xxxx` | T « erreur d'écriture » |
| Abus d'envoi d'e-mails | Limitation des demandes de réinitialisation (3 / h / adresse) ; déduplication des notifications par clé d'événement ; contrôle du quota | T « quota épuisé », « sans doublon » |
| Perte ou corruption de données | Aucune suppression automatique de données de production ; migrations additives avec sauvegarde préalable ; sauvegarde quotidienne ; restauration non destructive | T « migration », « sauvegarde » |
| Fuite via l'assistant IA | Clé d'API dans les propriétés du script, appel fait par le serveur ; seuls la question, les derniers échanges, la page et le rôle sont transmis (aucune donnée de la base) ; route réservée aux utilisateurs connectés ; limites par utilisateur et par jour ; repli sur le mode Guide en cas d'erreur | T « Assistant » |
| Mise en cadre (clickjacking) | Par défaut `XFrameOptionsMode.DEFAULT` (aucune intégration). Si `IMMO_EMBED_ORIGINS` est renseignée (site web / applications mobiles), Google n'offrant pas de restriction par origine, l'intégration est techniquement ouverte et l'interface vérifie elle-même ses cadres parents (`location.ancestorOrigins`) : elle refuse de s'afficher dans un site non listé. Firefox ne fournit pas cette information : la vérification n'y est pas possible. | Test navigateur (site non autorisé refusé) |

Toute action sensible (connexion, échec, refus d'accès, changement de rôle, paiement, annulation, approbation de facture, accès d'assistance, purge, export) est inscrite dans `ActivityLogs` avec l'auteur, l'organisation et le résultat.

## Données personnelles : minimisation et conservation

- Pièces d'identité des voyageurs : le numéro n'est **pas** conservé par défaut (`guests.storeIdReference = false`) ; les scans sont marqués « sensibles » et purgés automatiquement `retention.sensitiveDocDays` (30) jours après le départ. Un voyageur peut être anonymisé à la demande (`guest.purge`).
- Journaux : `retention.logDays` (730 jours).
- Portail voyageur : jeton propre à une réservation, haché, expirant le lendemain du départ, révocable, sans accès aux autres données.
- Les durées de conservation et la base légale (consentement, obligation de déclaration des voyageurs, etc.) doivent être validées par vos soins au regard de la loi 09-08 et des exigences de la CNDP et des autorités locales.

## Limites connues (à connaître avant production)

1. **Itérations PBKDF2** : 10 000 par défaut (calcul en JavaScript pur, vérifié contre les vecteurs RFC et la bibliothèque Node.js). Les mots de passe hachés avec moins d'itérations sont re-hachés automatiquement à la connexion suivante. C'est encore en deçà des recommandations les plus strictes (plusieurs centaines de milliers d'itérations) : protégez le compte déployeur, exigez des mots de passe longs, et augmentez `IMMO_PBKDF_ITERATIONS` si le temps de connexion le permet.
2. **Détenteur unique** : le compte déployeur et toute personne ayant accès au Google Sheet ou au projet Apps Script voient toutes les données. Limitez l'accès au projet et au classeur à ce seul compte.
3. **Verrou global** : `LockService` sérialise les écritures. Le contrôle de double réservation sous verrou a été vérifié en simulation ; il doit être vérifié dans Google avec deux navigateurs (M-05).
4. **Pas de jeton anti-CSRF dédié** : les appels passent par `google.script.run` (pas de formulaire ni d'URL rejouable) et exigent le jeton de session conservé dans le `sessionStorage` du domaine Google ; un site tiers ne peut pas le lire.
5. **Ressources externes** : polices (Google Fonts), Chart.js et Leaflet (cdnjs), tuiles OpenStreetMap. Les versions sont figées ; elles s'exécutent dans le cadre isolé d'HtmlService. Si votre politique l'exige, copiez ces bibliothèques dans des fichiers HTML du projet.
6. **Courriels** : envoyés depuis l'adresse du compte déployeur ; pas de signature DKIM propre à ImmoPilot. Vérifiez la délivrabilité (M-06).
7. **Contrats et quittances** : modèles indicatifs, non validés juridiquement.

## Liste de vérification avant production

- [ ] Compte déployeur dédié, validation en deux étapes, accès au projet Apps Script et au Google Sheet limité à ce compte.
- [ ] `runAllTests()` exécuté dans Google : `failed: 0`.
- [ ] `healthCheck()` : `ok: true`, `driveRoot.ok: true`, `triggersOk: true`.
- [ ] Partage du dossier Drive racine vérifié manuellement (« Accès limité »), y compris après des téléversements (M-07).
- [ ] Double réservation testée avec deux navigateurs simultanés (M-05).
- [ ] Matrice d'accès vérifiée avec de vrais comptes : propriétaire A ne voit rien de B, agence non autorisée refusée, gardien limité à ses réservations, locataire limité à son bail (M-03).
- [ ] Réception réelle des e-mails d'invitation, d'activation et de réinitialisation, liens pointant vers l'URL `/exec` (M-06).
- [ ] Temps de connexion mesuré ; `IMMO_PBKDF_ITERATIONS` ajusté (M-10).
- [ ] Restauration testée sur une copie (M-09).
- [ ] Modèles de bail / quittance validés par un professionnel ; durées de conservation validées.
- [ ] Paramètres de l'organisation revus : horaires, battement, politique d'annulation, commission, TVA.
- [ ] Première sauvegarde manuelle (`backupNow()`) et emplacement des sauvegardes connu.
