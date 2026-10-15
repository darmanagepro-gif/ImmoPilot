/**
 * RUBBAN (رُبّان, « le pilote ») — assistant d'aide intégré à ImmoPilot, disponible 24 h/24, 7 j/7.
 *
 * Deux modes :
 *  - GUIDE (toujours disponible, gratuit) : recherche dans la base de connaissances ASSISTANT_KB_ ci-dessous,
 *    exécutée dans le navigateur ; réponses pas à pas avec un bouton pour ouvrir la bonne page.
 *  - IA (facultatif) : si les propriétés du script IMMO_AI_PROVIDER (« anthropic » ou « gemini ») et IMMO_AI_API_KEY
 *    sont renseignées, la question est transmise par le SERVEUR au service d'IA choisi, avec la base de connaissances
 *    comme référence. La clé ne quitte jamais le serveur. Aucune donnée de la base (biens, clients, montants…) n'est envoyée :
 *    seulement la question, les derniers échanges de la conversation, la page affichée et le rôle de l'utilisateur.
 *  En cas d'erreur, de quota ou de service indisponible, l'assistant revient automatiquement au mode GUIDE.
 */
var ASSISTANT_NAME_ = "Rubban";
var AI_PROVIDER_PROPERTY_ = "IMMO_AI_PROVIDER", AI_KEY_PROPERTY_ = "IMMO_AI_API_KEY", AI_MODEL_PROPERTY_ = "IMMO_AI_MODEL";
var AI_DEFAULT_MODELS_ = { anthropic: "claude-haiku-5-5", gemini: "gemini-3.5-flash-lite" };
var AI_LIMITS_ = { perUserHour: 30, platformDay: 1500, maxQuestion: 600, maxHistory: 6, maxTokens: 700 };

/**
 * Base de connaissances. r : rôles concernés (« * » = tous ; SUPER = super administrateur). go : page à ouvrir.
 * k : mots-clés supplémentaires (synonymes, anglais, arabe) pour la recherche.
 */
var ASSISTANT_KB_ = [
  // ---------- Compte et connexion ----------
  { id: "login", t: "Se connecter à ImmoPilot", r: ["*"], go: "", k: "connexion login connecter identifiant se connecter sign in دخول",
    s: ["Ouvrez l'adresse d'ImmoPilot (site ou application).", "Saisissez votre e-mail et votre mot de passe, puis « Se connecter ».", "Après 5 essais erronés, le compte est bloqué 15 minutes : attendez puis réessayez, ou utilisez « Mot de passe oublié »."] },
  { id: "theme", t: "Passer en mode sombre ou clair (jour / nuit)", r: ["*"], go: "", k: "thème theme sombre clair nuit jour dark light mode nocturne couleur écran الوضع الليلي داكن فاتح",
    s: ["Cliquez sur le bouton 🌙 en haut de l'écran (à gauche du choix de langue), ou sur l'écran de connexion.", "L'application passe en mode sombre ; le bouton devient ☀️ pour revenir en mode clair.", "Votre choix est mémorisé sur cet appareil. Sans choix, ImmoPilot suit le réglage clair/sombre de votre appareil."] },
  { id: "activate", t: "Activer mon compte (lien reçu par e-mail)", r: ["*"], go: "", k: "activation activer invitation lien email premier mot de passe accepter invitation تفعيل",
    s: ["Ouvrez l'e-mail « Invitation à rejoindre ImmoPilot » ou « Activez votre compte ImmoPilot ».", "Cliquez sur le bouton « Ouvrir ImmoPilot » (lien personnel, à usage unique).", "Choisissez votre mot de passe (10 caractères minimum, avec lettres et chiffres) puis validez.", "Le lien d'invitation est valable 7 jours, le lien d'activation 72 h. Expiré ? Demandez à votre administrateur de le renvoyer."] },
  { id: "forgot", t: "Mot de passe oublié", r: ["*"], go: "", k: "oublié oublie reset réinitialiser mot de passe mdp password forgot نسيت كلمة السر",
    s: ["Sur l'écran de connexion, cliquez sur « Mot de passe oublié ».", "Saisissez votre e-mail : vous recevez un lien valable 1 heure.", "Ouvrez le lien et choisissez un nouveau mot de passe. Vos autres sessions sont déconnectées."] },
  { id: "password", t: "Changer mon mot de passe ou ma langue", r: ["*"], go: "settings", k: "changer mot de passe profil langue nom téléphone préférences notifications email arabe anglais",
    s: ["Ouvrez « Paramètres » › « Mon profil ».", "Modifiez votre nom, téléphone, langue (FR, EN, ع) ou vos préférences de notifications.", "« Changer le mot de passe » demande l'ancien mot de passe. « Déconnecter mes autres appareils » ferme les sessions ouvertes ailleurs."] },
  { id: "delete-account", t: "Supprimer mon compte", r: ["*"], go: "settings", k: "supprimer compte suppression rgpd données personnelles delete account حذف الحساب",
    s: ["Ouvrez « Paramètres » › « Mon profil » › « Supprimer mon compte ».", "Indiquez le motif : la demande est transmise à l'administrateur ImmoPilot.", "Votre identité est effacée ; les données comptables obligatoires sont conservées sans votre nom."] },
  { id: "install-phone", t: "Installer ImmoPilot sur mon téléphone", r: ["*"], go: "", k: "téléphone mobile android iphone application installer écran d'accueil app store play store",
    s: ["Android : ouvrez le site ImmoPilot dans Chrome, menu ⋮ › « Installer l'application » (ou installez-la depuis Google Play quand elle y est publiée).", "iPhone : ouvrez le site dans Safari, bouton Partager › « Sur l'écran d'accueil ».", "Les données sont les mêmes sur le web, Android et iPhone, en temps réel."] },
  { id: "notifications", t: "Notifications et e-mails", r: ["*"], go: "notifications", k: "notification cloche alerte email rappel message whatsapp",
    s: ["La cloche en haut à droite affiche les notifications non lues ; « Notifications » les liste toutes.", "Réglez les e-mails dans « Paramètres » › « Mon profil » › « Modifier mes préférences ».", "Les boutons WhatsApp ouvrent une conversation pré-remplie : l'envoi reste manuel."] },
  // ---------- Biens ----------
  { id: "property-create", t: "Ajouter un bien", r: ["OWNER", "SUPER"], go: "properties", k: "ajouter créer nouveau bien logement appartement villa riad duplex studio propriété property عقار",
    s: ["Ouvrez « Biens » › « + Ajouter un bien ».", "Renseignez le nom, la ville, le type, le mode de location (courte durée, longue durée ou mixte), les chambres, la capacité et le prix par nuit ou le loyer.", "Enregistrez : la fiche du bien s'ouvre (onglets Fiche, Photos, Documents, Agences et équipes, Historique)."] },
  { id: "property-edit", t: "Modifier un bien, ses photos ou ses documents", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "properties", k: "modifier fiche bien photo photos image ajouter photo documents pièces horaires arrivée départ consignes accès archiver",
    s: ["Ouvrez « Biens » puis le bien concerné.", "« Modifier la fiche » : adresse, pièces, horaires d'arrivée/départ, consignes d'accès, tarifs.", "Onglets « Photos » et « Documents » : « Ajouter des photos » / « Ajouter un document » (JPEG, PNG, WEBP ou PDF, 4 Mo max)."] },
  { id: "agency-create", t: "Créer une agence et lui confier mon bien (propriétaire)", r: ["OWNER"], go: "properties", k: "créer agence confier bien agence immobilière gestionnaire mandat accès agence وكالة",
    s: ["Ouvrez « Biens », puis votre bien › onglet « Agences et équipes ».", "Cliquez sur « Créer une agence » : nom de l'agence, e-mail et nom de son responsable.", "Cochez les droits : consultation, réservations, opérations (ménage, incidents, interventions), finances.", "Le responsable reçoit une invitation par e-mail ; l'agence voit le bien dès son activation.", "Agence déjà existante ? Utilisez « Attribuer une agence existante »."] },
  { id: "agency-manage", t: "Gérer mes agences : droits, retrait, modification, suppression", r: ["OWNER"], go: "agencies", k: "mes agences gérer droits retirer accès supprimer agence modifier fiche agence révoquer email responsable changer adresse mail lien activation renvoyer",
    s: ["Ouvrez « Mes agences » : chaque agence avec ses biens et ses droits.", "« Modifier les droits » ou « Retirer » pour un bien ; « Retirer tous les accès » pour tout couper d'un coup.", "« Modifier la fiche » (agences que vous avez créées) : nom, adresse, ville, téléphone, e-mail de contact, nom et e-mail du responsable. Si vous changez l'e-mail du responsable, l'ancien perd l'accès et un nouveau lien d'activation part à la nouvelle adresse.",
      "« Renvoyer le lien d'activation » si le responsable n'a pas encore activé son compte (lien perdu ou expiré).",
      "« Supprimer l'agence » : rien n'est effacé, l'agence est désactivée et ses accès révoqués.",
      "Les agences que vous créez n'ont pas d'abonnement propre : elles sont facturées en option sur votre abonnement.", "Une agence qui gère aussi les biens d'autres propriétaires ne peut pas être supprimée : seuls vos accès sont retirés."] },
  { id: "staff", t: "Affecter un gardien, une équipe de ménage ou un locataire à un bien", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "properties", k: "gardien concierge affecter personnel équipe inviter personne bien rôle guard",
    s: ["Ouvrez le bien › onglet « Agences et équipes ».", "« Inviter une personne » : e-mail, rôle (gardien, ménage, artisan, locataire) ; l'invitation est liée au bien.", "Si la personne a déjà un compte avec ce rôle : « Affecter une personne ». Un gardien peut aussi être limité à une seule réservation."] },
  // ---------- Réservations ----------
  { id: "resv-create", t: "Créer une réservation", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "reservations", k: "réservation resa booking créer nouvelle séjour voyageur airbnb booking.com dates حجز",
    s: ["Ouvrez « Réservations » › « + Nouvelle réservation » (ou cliquez sur une date du « Calendrier »).", "Choisissez le bien, les dates d'arrivée et de départ, le voyageur et le nombre de personnes.", "Prix : laissez vide pour nuits × prix du bien, ou saisissez votre prix (tarif libre pour l'agence).", "ImmoPilot refuse automatiquement les chevauchements, y compris entre agences, en respectant le temps de ménage entre deux séjours."] },
  { id: "resv-pay", t: "Enregistrer un paiement ou un acompte de réservation", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "reservations", k: "paiement acompte solde caution encaisser payé impayé règlement virement espèces",
    s: ["Ouvrez la réservation › « Enregistrer un paiement » : montant, date, mode (virement, espèces, carte, plateforme…) et référence.", "Le statut passe à « Partiel » ou « Payé » automatiquement.", "Aucun paiement en ligne n'est effectué par l'application : enregistrez les règlements réellement reçus."] },
  { id: "resv-cancel", t: "Annuler une réservation ou déclarer un no-show", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "reservations", k: "annuler annulation no-show absent pas venu jamais arrivé client venu remboursement pénalité motif",
    s: ["Ouvrez la réservation › « Annuler » : choisissez le motif ; la pénalité de la politique d'annulation est calculée.", "Voyageur jamais arrivé : « No-show ».", "Les motifs d'annulation alimentent l'analyse de Pareto « Motifs d'annulation »."] },
  { id: "calendar", t: "Calendrier et blocage de dates", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "GUARD", "SUPER"], go: "calendar", k: "calendrier planning disponibilité bloquer période indisponible travaux propriétaire",
    s: ["Ouvrez « Calendrier » : réservations et blocages par bien.", "« Bloquer une période » rend des dates indisponibles (travaux, séjour du propriétaire)."] },
  { id: "resv-docs", t: "Fiche de réservation PDF, confirmation et lien voyageur", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "reservations", k: "fiche pdf confirmation email voyageur lien voyageur portail pièce d'identité passeport cin",
    s: ["Dans la réservation : « Fiche PDF », « Envoyer la confirmation » (si l'e-mail du voyageur est renseigné).", "« Lien voyageur » crée un portail personnel où le voyageur complète ses informations et peut joindre sa pièce d'identité.", "Les pièces d'identité sont privées et supprimées automatiquement 30 jours après le départ ; « Effacer les données d'identité » le fait immédiatement."] },
  // ---------- Arrivées / départs ----------
  { id: "checkin", t: "Faire un check-in ou un check-out (gardien)", r: ["GUARD", "OWNER", "AGENCY_ADMIN", "AGENCY_USER"], go: "checkin", k: "check-in check-out arrivée départ gardien clés état des lieux signature photos retard",
    s: ["Ouvrez « Arrivées et départs » : les arrivées et départs du jour.", "« Effectuer le check-in » : cochez la liste, relevez les compteurs, ajoutez photos et signature, signalez une anomalie si besoin.", "« Effectuer le check-out » au départ : la mission de ménage est créée automatiquement.", "Les retards sont enregistrés et alimentent l'analyse « Retards et non-conformités »."] },
  // ---------- Ménage ----------
  { id: "cleaning-create", t: "Créer et attribuer une mission de ménage", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "cleaning", k: "ménage menage nettoyage mission créer attribuer entreprise de ménage femme de ménage cleaning تنظيف",
    s: ["Après chaque check-out, une mission est créée automatiquement ; vous pouvez aussi la créer dans « Ménage » › « Mission ».", "« Attribuer » : choisissez d'abord le type de prestation « Ménage », puis l'entreprise dans la liste de l'annuaire ImmoPilot.", "Indiquez le tarif convenu : il deviendra une dépense du propriétaire à la validation.", "L'entreprise a 2 heures pour accepter ; sinon vous êtes alerté et pouvez réattribuer."] },
  { id: "cleaning-do", t: "Réaliser une mission de ménage (entreprise de ménage)", r: ["CLEANER"], go: "cleaning", k: "accepter mission démarrer terminer photos avant après pièce checklist anomalie",
    s: ["Ouvrez « Ménage » : « Accepter » ou « Refuser » la mission dans le délai affiché.", "Sur place : « Démarrer », puis pour chaque pièce cochez les tâches et ajoutez les photos AVANT et APRÈS.", "« Signaler » une anomalie (objet manquant, casse, saleté) ; « Terminer la mission » à la fin."] },
  { id: "cleaning-validate", t: "Valider un ménage, rapport et ordre de mission PDF", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "CLEANER", "SUPER"], go: "cleaning", k: "valider ménage payer paie coût tarif prix facture ménage qui paie note qualité rapport de ménage pdf ordre de mission photos avant après reprendre",
    s: ["Ouvrez la mission terminée › « Valider » : note de qualité et coût final (dépense imputée au propriétaire du bien).", "« À reprendre » renvoie la mission au prestataire avec un motif.", "« Rapport de ménage (PDF) » : horaires, tâches par pièce, photos avant/après, anomalies. « Ordre de mission (PDF) » : document de commande avec les engagements."] },
  // ---------- Incidents et maintenance ----------
  { id: "incident", t: "Déclarer et suivre un incident", r: ["*"], go: "incidents", k: "incident panne fuite problème casse déclarer signaler climatisation plomberie électricité maintenance عطل",
    s: ["Ouvrez « Incidents » › « Déclarer un incident » (ou « Signaler un incident » depuis le bien ou un check-in).", "Choisissez la catégorie, la gravité, décrivez et ajoutez des photos.", "Le gestionnaire qualifie l'incident, demande un devis ou crée directement une intervention."] },
  { id: "quote", t: "Demander, établir et accepter un devis", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "ARTISAN", "SUPER"], go: "quotes", k: "devis demander devis accepter refuser chiffrage prix artisan bon pour accord quote عرض سعر",
    s: ["Dans l'incident : « Demander un devis » et choisissez le type de prestation puis l'artisan de la liste.", "L'artisan ouvre « Devis » › « Saisir le devis » : lignes, TVA, validité, délai.", "Le propriétaire (ou l'agence selon son plafond) « Accepte » ou « Refuse ». « Devis PDF » télécharge le devis au nom du prestataire."] },
  { id: "workorder", t: "Créer et suivre une intervention (hors ménage)", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "ARTISAN", "SUPER"], go: "workorders", k: "intervention ordre de travail bon d'intervention réparation planifier artisan travaux",
    s: ["Après acceptation du devis (ou directement en urgence) : « Créer une intervention ».", "L'artisan accepte, « Planifier », « Démarrer », puis « Terminer » avec compte rendu et photos.", "Le gestionnaire contrôle : « Contrôle OK ». « Bon d'intervention PDF » imprime l'ordre de mission."] },
  { id: "invoice", t: "Transmettre, approuver et payer une facture d'artisan", r: ["OWNER", "AGENCY_ADMIN", "ARTISAN", "SUPER"], go: "invoices", k: "facture transmettre approuver payer commission net prestataire facture pdf فاتورة",
    s: ["L'artisan : intervention terminée › « Transmettre la facture » (numéro, montants, justificatif PDF).", "Le gestionnaire : « Factures » › la facture › « Approuver » : la commission est calculée une seule fois et figée.", "« Enregistrer un paiement » pour le versement au prestataire. « Facture PDF » produit la facture au nom du prestataire."] },
  { id: "providers", t: "Choisir un prestataire (ménage, plombier, électricien…)", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "contractors", k: "prestataire artisan plombier électricien climatisation peintre serrurier jardinier piscine annuaire liste",
    s: ["Les prestataires sont intégrés par l'équipe ImmoPilot dans un annuaire vérifié.", "Lors d'une attribution, choisissez d'abord le type de prestation, puis le prestataire dans la liste.", "« Prestataires » affiche leurs fiches et leurs statistiques, calculées uniquement sur vos biens."] },
  { id: "providers-admin", t: "Ajouter un prestataire à l'annuaire (super administrateur)", r: ["SUPER"], go: "contractors", k: "ajouter prestataire annuaire intégrer artisan entreprise ménage super admin",
    s: ["Ouvrez « Prestataires » › « + Prestataire » : nom, e-mail, téléphone, types de prestation, zones, mentions légales et coordonnées de paiement.", "Le compte du prestataire est invité automatiquement (rôle ménage et/ou artisan).", "Les propriétaires et agences le choisissent ensuite dans la liste selon le type de prestation."] },
  // ---------- Location longue durée ----------
  { id: "lease", t: "Créer un bail et générer le contrat", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "leases", k: "bail location longue durée louer année annuel mensuel locataire contrat loyer charges caution indexation créer bail إيجار",
    s: ["Créez d'abord le locataire dans « Locataires ».", "« Locations longue durée » › « Nouveau bail » : bien, locataire, dates, loyer, charges, caution, jour d'échéance.", "« Activer le bail » génère l'échéancier des loyers ; « Encaisser la caution » enregistre le dépôt de garantie. « Générer le contrat » produit un modèle indicatif à faire valider."] },
  { id: "rent", t: "Encaisser un loyer, quittance et retards", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "leases", k: "loyer encaisser quittance retard impayé échéance relance locataire",
    s: ["Ouvrez le bail › échéancier › « Payer » sur l'échéance : montant, date, mode.", "« Quittance » produit la quittance PDF d'une échéance payée.", "Les retards apparaissent dans le tableau de bord et l'analyse « Impayés »."] },
  { id: "lease-end", t: "Préavis, renouvellement, fin de bail et caution", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "leases", k: "préavis renouveler fin de bail restitution caution résiliation",
    s: ["Dans le bail : « Préavis », « Renouveler » ou « Terminer le bail ».", "« Restituer la caution » : montant rendu et retenues éventuelles."] },
  { id: "tenant-space", t: "Espace locataire", r: ["TENANT"], go: "mylease", k: "locataire mon bail payer loyer quittance justificatif incident",
    s: ["« Mon bail » : votre contrat, vos échéances et vos quittances.", "« Transmettre un justificatif de paiement » envoie la preuve de votre virement au bailleur.", "« Signaler un incident » pour une panne dans le logement."] },
  // ---------- Finances, analyses, rapports ----------
  { id: "finance", t: "Suivre les finances (revenus, dépenses, impayés)", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "finance", k: "finances revenus chiffre d'affaires dépenses rentabilité occupation adr revpar impayés encaissé résultat",
    s: ["Ouvrez « Finances » et choisissez la période et le bien.", "Vous voyez : prévu, facturé, encaissé, restant dû, dépenses, résultat, taux d'occupation, ADR, RevPAR.", "« Dépense » et « Revenu divers » ajoutent des écritures ; « Exporter rentabilité (CSV) » pour Excel."] },
  { id: "pareto", t: "Comprendre les analyses de Pareto", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "pareto", k: "pareto 80/20 analyse causes coûts incidents retards annulations",
    s: ["Ouvrez « Analyses Pareto » et choisissez l'analyse et la période.", "Les éléments marqués « prioritaires » expliquent environ 80 % du total : traitez-les en premier.", "Comparez avec la période précédente ; « PDF » ou « CSV » pour exporter."] },
  { id: "reports", t: "Rapports et exports", r: ["OWNER", "AGENCY_ADMIN", "AGENCY_USER", "SUPER"], go: "reports", k: "rapport export csv pdf excel télécharger",
    s: ["Ouvrez « Rapports », choisissez le rapport, la période et les filtres.", "« Exporter (CSV) » pour Excel ou « PDF » pour imprimer."] },
  { id: "dashboard", t: "Tableau de bord", r: ["*"], go: "dashboard", k: "tableau de bord accueil indicateurs kpi statistiques",
    s: ["« Tableau de bord » affiche les indicateurs de votre rôle, calculés en temps réel sur votre seul périmètre.", "Changez la période en haut de page."] },
  // ---------- Utilisateurs, abonnement, paramètres ----------
  { id: "invite", t: "Inviter un utilisateur", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "users", k: "inviter utilisateur collaborateur employé compte ajouter personne équipe accès",
    s: ["Ouvrez « Utilisateurs » › « + Inviter » : e-mail, nom, organisation et rôle.", "La personne reçoit un lien valable 7 jours. « Renvoyer » ou « Révoquer » depuis l'onglet « Invitations ».", "« Droits » permet de retirer certaines capacités à un compte."] },
  { id: "subscription", t: "Mon abonnement, contrat et factures d'abonnement", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "subscriptions", k: "abonnement forfait essentiel pro business prix facture contrat changer de forfait résilier",
    s: ["Ouvrez « Abonnements » : forfait, statut, échéance, utilisation et historique des règlements.", "« Contrat et historique (PDF) » télécharge votre contrat.", "Les agences que vous avez créées apparaissent en « Option agences » (prix par agence) : elles n'ont pas d'abonnement séparé.", "« Demander un changement de forfait » ou « Résilier en fin de période » ; vos données restent conservées."] },
  { id: "settings-org", t: "Paramètres de l'organisation (horaires, annulation, commission…)", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "settings", k: "paramètres horaires arrivée départ battement ménage politique d'annulation commission tva modèles",
    s: ["Ouvrez « Paramètres » › « Paramètres de l'organisation ».", "Réglez : heures d'arrivée/départ, temps de ménage entre séjours, politique d'annulation, commission, TVA, délais d'alerte, modèles de documents."] },
  { id: "support-access", t: "Accès d'assistance pour l'équipe ImmoPilot", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "settings", k: "assistance support aide équipe immopilot accès autoriser",
    s: ["L'équipe ImmoPilot n'accède jamais à vos données sans votre accord.", "Une demande d'accès apparaît dans « Paramètres » › « Accès d'assistance » : « Accorder » (1 à 24 h, lecture seule, journalisé) ou refuser."] },
  { id: "audit", t: "Journal d'audit (qui a fait quoi)", r: ["OWNER", "AGENCY_ADMIN", "SUPER"], go: "audit", k: "journal audit historique traçabilité qui a modifié sécurité",
    s: ["« Journal d'audit » liste les actions sensibles : connexions, paiements, annulations, droits, documents…"] },
  // ---------- Super administrateur ----------
  { id: "admin-org", t: "Créer une organisation cliente (super administrateur)", r: ["SUPER"], go: "admin", k: "créer organisation client super admin propriétaire agence onboarding",
    s: ["« Administration globale » › « Organisations » › « + Organisation » : nom, type (propriétaire, agence, prestataire), ville, forfait d'essai.", "Sur la ligne : « Inviter » son responsable, « Forfait », « Suspendre » ou « Assistance »."] },
  { id: "admin-sub", t: "Attribuer un forfait et enregistrer un paiement d'abonnement", r: ["SUPER"], go: "subscriptions", k: "forfait abonnement paiement client facturation plateforme super admin",
    s: ["« Abonnements » › « + Attribuer un forfait » (avec ou sans essai).", "Sur la ligne : « Paiement » pour enregistrer un règlement réellement reçu ; « Contrat (PDF) » pour le contrat.", "La case « Inclure la démo » affiche aussi les organisations de démonstration."] },
  { id: "admin-diag", t: "Diagnostic, erreurs, sauvegardes (super administrateur)", r: ["SUPER"], go: "admin", k: "diagnostic erreur technique err- sauvegarde restauration tâches planifiées santé",
    s: ["« Administration globale » : onglets « Diagnostic », « Erreurs techniques » (références ERR-…), « Tâches planifiées » et « Sauvegardes ».", "« Créer une sauvegarde maintenant » copie la base dans le dossier privé « Sauvegardes »."] },
  { id: "error", t: "J'ai un message d'erreur", r: ["*"], go: "", k: "erreur bug ne marche pas bloqué page blanche err- problème accès refusé",
    s: ["Notez la référence affichée (ERR-…) et l'heure.", "« Accès refusé » : votre rôle ou les droits accordés sur ce bien ne permettent pas l'action ; demandez au propriétaire ou à votre administrateur.", "« Abonnement suspendu » : le compte est en lecture seule jusqu'au règlement.", "Sinon, transmettez la référence à votre administrateur ImmoPilot."] }
];

/** Rôles de l'utilisateur sous forme de libellés (pour filtrer les articles). */
function assistantRoles_(p) {
  const s = {}; (p.roles || []).forEach(function (r) { s[r.role] = true; }); if (p.isSuper) s.SUPER = true;
  return Object.keys(s);
}
function aiConfig_() {
  if (TEST_HOOKS_.aiConfig === false) return null;
  if (TEST_HOOKS_.aiConfig) return TEST_HOOKS_.aiConfig;
  const props = PropertiesService.getScriptProperties();
  const provider = String(props.getProperty(AI_PROVIDER_PROPERTY_) || "").trim().toLowerCase(), key = String(props.getProperty(AI_KEY_PROPERTY_) || "").trim();
  if (!key || !AI_DEFAULT_MODELS_[provider]) return null;
  return { provider: provider, key: key, model: String(props.getProperty(AI_MODEL_PROPERTY_) || "").trim() || AI_DEFAULT_MODELS_[provider] };
}

/** Base de connaissances (publique : aucune donnée client). aiEnabled n'indique que la présence d'une configuration. */
function assistantKbPublic_() { return { name: ASSISTANT_NAME_, articles: ASSISTANT_KB_, aiEnabled: false }; }
function assistantKb_(p) { return { name: ASSISTANT_NAME_, articles: ASSISTANT_KB_, aiEnabled: !!aiConfig_(), roles: assistantRoles_(p) }; }

function assistantSystemPrompt_(p, lang, page) {
  const kb = ASSISTANT_KB_.map(function (a) { return "## " + a.t + " [page: " + (a.go || "connexion") + " ; rôles: " + a.r.join(",") + "]\n" + a.s.map(function (x, i) { return (i + 1) + ". " + x; }).join("\n"); }).join("\n\n");
  const L = { fr: "français", en: "English", ar: "العربية" }[lang] || "français";
  return "Tu es " + ASSISTANT_NAME_ + " (رُبّان, « le pilote »), l'assistant d'aide intégré au logiciel de gestion immobilière ImmoPilot (Maroc : propriétaires, agences, gardiens, ménage, artisans, locataires).\n" +
    "Règles :\n- Réponds en " + L + ", de façon courte et concrète : étapes numérotées avec les noms exacts des menus et boutons.\n" +
    "- Appuie-toi UNIQUEMENT sur la documentation ci-dessous. Si une fonction n'y figure pas, dis franchement qu'ImmoPilot ne la propose pas ou que tu n'es pas sûr, et propose de contacter l'administrateur ImmoPilot.\n" +
    "- Tu n'as accès à aucune donnée du compte (biens, réservations, montants) : n'invente jamais de chiffres ni de noms.\n" +
    "- Ne demande jamais de mot de passe, numéro de pièce d'identité ou coordonnées bancaires.\n" +
    "- Pour les questions juridiques, fiscales ou comptables, donne des repères généraux et recommande un professionnel.\n" +
    "- Hors sujet (sans lien avec ImmoPilot ou la gestion locative) : réponds poliment que tu es dédié à ImmoPilot.\n" +
    "Contexte : rôles de l'utilisateur = " + assistantRoles_(p).join(", ") + " ; page affichée = " + (page || "inconnue") + ".\n\n# Documentation ImmoPilot\n" + kb;
}

/** Appel du service d'IA (serveur uniquement). Retourne le texte de la réponse ou lève une erreur. */
function aiCall_(cfg, system, messages) {
  let req;
  if (cfg.provider === "anthropic") {
    req = { url: "https://api.anthropic.com/v1/messages", method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: cfg.model, max_tokens: AI_LIMITS_.maxTokens, system: system, messages: messages }) };
  } else {
    req = { url: "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(cfg.model) + ":generateContent", method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { "x-goog-api-key": cfg.key },
      payload: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, generationConfig: { maxOutputTokens: AI_LIMITS_.maxTokens, temperature: 0.2 },
        contents: messages.map(function (m) { return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }; }) }) };
  }
  const res = TEST_HOOKS_.aiFetch ? TEST_HOOKS_.aiFetch(req) : UrlFetchApp.fetch(req.url, req), code = res.getResponseCode();
  let body = {}; try { body = JSON.parse(res.getContentText() || "{}"); } catch (e) { body = {}; }
  if (code < 200 || code >= 300) throw new Error("Service d'IA : HTTP " + code + (body.error && body.error.message ? " — " + String(body.error.message).slice(0, 200) : ""));
  const text = cfg.provider === "anthropic"
    ? (body.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join("\n")
    : (((body.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (x) { return x.text || ""; }).join("\n");
  if (!String(text).trim()) throw new Error("Service d'IA : réponse vide.");
  return String(text).trim();
}

/** Route assistant.ask : réponse IA si configurée, sinon { mode: "guide" } (le navigateur répond avec la base de connaissances). */
function assistantAsk_(p, a) {
  const question = reqText_(a.question, "Question", 2, AI_LIMITS_.maxQuestion);
  const cfg = aiConfig_();
  if (!cfg) return { mode: "guide" };
  try { rateLimit_("ai-user:" + p.userId, AI_LIMITS_.perUserHour, 3600); rateLimit_("ai-platform", AI_LIMITS_.platformDay, 86400); }
  catch (e) { return { mode: "guide", notice: "Limite de questions à l'assistant IA atteinte pour le moment : voici les réponses du guide." }; }
  const lang = ["fr", "en", "ar"].indexOf(a.lang) >= 0 ? a.lang : "fr", page = safeText_(a.page || "", 60);
  const history = (Array.isArray(a.history) ? a.history : []).slice(-AI_LIMITS_.maxHistory).map(function (m) {
    return { role: m && m.role === "assistant" ? "assistant" : "user", content: safeText_(m && m.content, 1200) };
  }).filter(function (m) { return m.content; });
  while (history.length && history[0].role !== "user") history.shift();
  const messages = history.concat([{ role: "user", content: question }]);
  for (let i = messages.length - 1; i > 0; i--) if (messages[i].role === messages[i - 1].role) messages.splice(i - 1, 1);
  try {
    const answer = aiCall_(cfg, assistantSystemPrompt_(p, lang, page), messages);
    audit_("ASSISTANT_AI_ANSWER", "Assistant", ASSISTANT_NAME_, "", { provider: cfg.provider, chars: question.length });
    return { mode: "ai", answer: answer.slice(0, 6000), provider: cfg.provider };
  } catch (e) {
    console.error("Assistant IA : " + e.message);
    return { mode: "guide", notice: "L'assistant IA est momentanément indisponible : voici les réponses du guide." };
  }
}

/** Fonction d'éditeur : vérifie la configuration de l'assistant IA (sans rien enregistrer). */
function testerAssistantIA() {
  assertEditor_();
  const cfg = aiConfig_();
  if (!cfg) return { ok: false, mode: "guide", message: "Mode IA non configuré : renseignez IMMO_AI_PROVIDER (anthropic ou gemini) et IMMO_AI_API_KEY dans les propriétés du script. Le mode Guide fonctionne sans configuration." };
  try { const t = aiCall_(cfg, "Réponds en une phrase.", [{ role: "user", content: "Dis bonjour aux utilisateurs d'ImmoPilot." }]); return { ok: true, provider: cfg.provider, model: cfg.model, sample: t.slice(0, 200) }; }
  catch (e) { return { ok: false, provider: cfg.provider, model: cfg.model, error: e.message }; }
}
