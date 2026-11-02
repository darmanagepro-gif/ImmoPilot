/**
 * Pages légales affichées dans l'application (lien en bas de l'écran de connexion et dans les paramètres) :
 * mentions légales, conditions générales, confidentialité, cookies et, pour la France, accord de sous-traitance (art. 28 RGPD).
 * Les informations propres à l'éditeur (raison sociale, SIRET, hébergeur…) se règlent dans Paramètres › Plateforme (clés legal.*) :
 * tant qu'une valeur manque, elle apparaît surlignée « À compléter ».
 * Ces textes sont des modèles : ils doivent être relus par un professionnel du droit avant la mise en service. ImmoPilot ne garantit pas leur conformité.
 */
/** Date de la version en vigueur des documents juridiques (conservée comme preuve à chaque acceptation ou signature). */
var LEGAL_VERSION_ = "2026-11-02";
var LEGAL_FIELDS_ = {
  publisherName: "Nom ou raison sociale de l'éditeur", legalForm: "Forme juridique et capital social", address: "Adresse du siège",
  registration: "Immatriculation (RCS / SIREN ou RC / ICE)", vatNumber: "N° de TVA intracommunautaire", director: "Directeur ou directrice de la publication",
  contactEmail: "E-mail de contact", phone: "Téléphone", hostName: "Hébergeur", hostAddress: "Adresse de l'hébergeur", hostPhone: "Téléphone de l'hébergeur",
  mediator: "Médiateur de la consommation (nom et site)", platformInsurance: "Assurance RC professionnelle de l'éditeur (assureur et n° de police)", dataAuthorityRef: "Référence de déclaration à l'autorité de protection des données", dpoEmail: "E-mail du délégué à la protection des données (facultatif)"
};

/** Valeurs légales : paramètres de la plateforme, puis valeurs par défaut selon l'hébergement (Google ou serveur dédié). */
function legalValues_() {
  const v = {};
  Object.keys(LEGAL_FIELDS_).forEach(function (k) { const x = getSetting_("legal." + k); v[k] = x === undefined || x === null ? "" : String(x); });
  const vps = typeof IMMO_RUNTIME_ !== "undefined" && IMMO_RUNTIME_ === "vps";
  if (!vps && !v.hostName) {
    if (edition_().code === "FR") { v.hostName = "Google Ireland Limited (Google Apps Script, Google Sheets et Google Drive)"; v.hostAddress = v.hostAddress || "Gordon House, Barrow Street, Dublin 4, Irlande"; }
    else { v.hostName = "Google LLC (Google Apps Script, Google Sheets et Google Drive)"; v.hostAddress = v.hostAddress || "1600 Amphitheatre Parkway, Mountain View, CA 94043, États-Unis"; }
  }
  v.runtime = vps ? "vps" : "google";
  return v;
}
function legalFill_(text, v) {
  return String(text).replace(/\{\{(\w+)\}\}/g, function (m, k) { return v[k] ? v[k] : "[[À compléter : " + (LEGAL_FIELDS_[k] || k) + "]]"; });
}

/* Rôle de l'éditeur : commun aux deux éditions. L'éditeur fournit un LOGICIEL ; il n'exerce aucune activité immobilière. */
function legalRoleSection_() {
  return { h: "Rôle de l'éditeur : un logiciel de gestion, pas un gestionnaire", ul: [
    "ImmoPilot est un logiciel en ligne (SaaS) mis à disposition du client pour l'aider à organiser lui-même la gestion de ses biens. L'éditeur fournit uniquement l'outil.",
    "L'éditeur n'est ni agent immobilier, ni administrateur de biens, ni syndic, ni conciergerie, ni mandataire du client. Il n'effectue aucune transaction, ne loue aucun bien, ne détient aucune carte professionnelle immobilière et n'intervient dans aucune négociation.",
    "L'éditeur n'est pas partie aux contrats conclus par le client avec des tiers (baux, réservations, contrats de ménage ou de travaux, contrats avec des agences ou des artisans). Il ne garantit ni leur exécution, ni la solvabilité des locataires ou voyageurs, ni la qualité des prestations des tiers.",
    "L'éditeur ne détient pas et ne gère pas les fonds du client ni ceux de ses locataires ou voyageurs : loyers, cautions et paiements des séjours sont encaissés directement par le client, en dehors de l'application. L'éditeur perçoit uniquement le prix de l'abonnement et, lorsque le client fait appel à un prestataire référencé, la commission de mise en relation prévue à l'article « Mise en relation ».",
    "L'éditeur ne contrôle pas les informations saisies par le client et ses utilisateurs, et n'en vérifie ni l'exactitude ni la licéité.",
    "Les modèles de documents (baux, états des lieux, quittances, appels de loyer, devis, factures, fiches de police) et les brouillons rédigés par l'assistant IA sont des aides à la rédaction. Ils ne constituent pas un conseil juridique, fiscal ou comptable. Le client doit les relire, les adapter à sa situation et reste seul responsable de leur contenu et de leur utilisation.",
    "Les automatisations (appels de loyer, relances, quittances, notifications) sont paramétrées et déclenchées sous le contrôle du client. Il lui appartient de vérifier leur paramétrage et les documents envoyés en son nom."] };
}
function legalClientDutiesSection_(law) {
  return { h: "Obligations du client", ul: [
    "Fournir des informations exactes, garder ses identifiants confidentiels et répondre de l'utilisation de son compte et de ceux qu'il crée ou dont il invite les utilisateurs (agences, gardiens, équipes de ménage, artisans, locataires), ainsi que des droits qu'il leur accorde.",
    "Utiliser le service conformément à la loi et respecter lui-même toutes les obligations liées à son activité : réglementation des locations et des meublés de tourisme, déclaration des voyageurs aux autorités, fiscalité, baux, quittances, factures, assurances.",
    "En tant que responsable du traitement des données de ses locataires, voyageurs et prestataires, respecter " + law + " : informer les personnes, ne collecter que les données nécessaires, accomplir ses propres formalités auprès de l'autorité de protection des données.",
    "Ne pas porter atteinte à la sécurité ou au fonctionnement du service, ne pas tenter d'accéder aux données d'autres clients, ne pas revendre ni sous-licencier l'accès."] };
}

/* Mise en relation : commune aux deux éditions (complète le rôle de l'éditeur). */
function legalMarketplaceSection_(v) {
  const R = commissionRates_(), fr = edition_().code === "FR";
  return { h: "Mise en relation avec des prestataires référencés", ul: [
    "En plus du logiciel, ImmoPilot propose un annuaire d'artisans et de prestataires (ménage, plomberie, électricité, climatisation…) référencés par l'éditeur. Le client y choisit librement un prestataire par métier et par zone ; l'éditeur ne choisit pas à sa place.",
    "Les devis, interventions et factures sont établis par le prestataire, en son nom, et conclus directement entre le client et le prestataire. L'éditeur n'est pas partie à ces contrats et ne garantit ni leur exécution, ni leur qualité, ni leurs délais.",
    "Commission de mise en relation : pour chaque mission réalisée par un prestataire référencé et réglée, le client (commanditaire) doit à l'éditeur une commission de " + R.client + " % du montant hors taxes de la facture du prestataire (TVA en sus au taux de " + R.vat + " %). Elle rémunère le service de mise en relation (sélection et contrôle des prestataires, outils de demande de devis, de suivi et de facturation). Les commissions d'un mois sont réunies dans un récapitulatif envoyé au début du mois suivant et prélevées sur la carte enregistrée pour l'abonnement, ou réglées par lien de paiement.",
    "Règlement du prestataire : le client règle la facture du prestataire soit directement (virement, chèque, espèces), soit en ligne par la plateforme" + (fr ? " : dans ce cas le paiement est traité par Stripe Payments Europe, établissement de paiement agréé, qui verse le prestataire et retient la commission due par celui-ci ; l'éditeur ne détient jamais les fonds." : " lorsque ce mode est proposé.") + " Le client indique dans l'application que la facture est réglée dès qu'il l'a payée directement.",
    "Avant le référencement, l'éditeur contrôle l'immatriculation du prestataire, son identité et les attestations exigées par la réglementation du pays (assurances notamment). Ce contrôle porte sur la présence et la validité apparente des pièces à la date du contrôle : il ne vaut pas garantie de la compétence ou de la solvabilité du prestataire.",
    "Aucun prestataire ne paie pour être mieux classé. Les critères de référencement et de déréférencement figurent dans les conditions de référencement des prestataires, consultables dans l'application."]
    .concat(v && v.platformInsurance ? ["Assurance de l'éditeur : la responsabilité civile professionnelle de l'éditeur pour son activité de mise en relation et de plateforme est assurée auprès de {{platformInsurance}}. Elle ne se substitue pas aux assurances des prestataires (responsabilité civile professionnelle, décennale) pour les travaux qu'ils réalisent."] : []) };
}
/* Conditions de référencement des prestataires (artisans inscrits en ligne). */
function legalProviderDoc_(fr) {
  return { id: "referencement", title: "Conditions de référencement des prestataires", sections: [
    { h: "1. Objet", p: ["Les présentes conditions s'appliquent aux artisans et prestataires (« le prestataire ») qui demandent leur référencement dans l'annuaire ImmoPilot édité par {{publisherName}} (« l'éditeur »). Elles sont acceptées en ligne lors de l'inscription. Le référencement est gratuit."] },
    { h: "2. Rôle de l'éditeur", p: ["L'éditeur met à disposition un logiciel et un annuaire permettant aux propriétaires et agences abonnés de trouver un prestataire et de lui adresser des demandes de devis et d'intervention. L'éditeur n'est ni employeur, ni donneur d'ordre, ni mandataire du prestataire ou du client ; il n'est pas partie aux contrats de prestation, ne fixe pas les prix et n'encaisse pas les paiements."] },
    { h: "3. Conditions et pièces exigées", ul: fr ? [
      "Être immatriculé : SIRET actif (auto-entrepreneur) ou société immatriculée au RCS.",
      "Pièces : pièce d'identité du dirigeant ; avis de situation SIRENE ou extrait RNE (auto-entrepreneur), ou extrait Kbis de moins de 3 mois (société) ; attestation de vigilance URSSAF de moins de 6 mois (art. L. 8222-1 et D. 8222-5 du Code du travail) ; RIB.",
      "Assurances : attestation de responsabilité civile professionnelle si le prestataire en déclare une ; attestation d'assurance décennale en cours de validité pour les travaux de construction et de rénovation (art. L. 241-1 du Code des assurances).",
      "Le prestataire certifie l'exactitude des informations et l'authenticité des pièces ; il s'engage à les tenir à jour."] : [
      "Être inscrit au Registre national de l'auto-entrepreneur, ou disposer d'une société immatriculée au registre de commerce (ICE et identifiant fiscal).",
      "Pièces : carte nationale d'identité (CIN) du dirigeant ; attestation d'inscription au registre de l'auto-entrepreneur, ou extrait du registre de commerce (modèle J) de moins de 3 mois et attestation d'affiliation à la CNSS (société) ; RIB.",
      "Assurance : attestation de responsabilité civile professionnelle si le prestataire en déclare une.",
      "Le prestataire certifie l'exactitude des informations et l'authenticité des pièces ; il s'engage à les tenir à jour."] },
    { h: "4. Contrôle et référencement", p: ["L'éditeur contrôle chaque pièce (lisibilité, concordance avec les informations déclarées, validité) et peut demander des compléments. Le prestataire est référencé lorsque toutes les pièces exigées sont validées ; il en est informé par e-mail. Les prestataires apparaissent par métier et par zone d'intervention, sans classement payant."] },
    { h: "5. Déréférencement", p: ["Le référencement est suspendu, après information du prestataire par e-mail, en cas d'expiration d'une attestation obligatoire, d'information inexacte, de pièce falsifiée, de plaintes répétées et fondées de clients ou de manquement grave à la loi. Il est rétabli dès la régularisation, sauf fraude. Le prestataire peut demander son déréférencement à tout moment en écrivant à {{contactEmail}}."] },
    { h: "6. Obligations du prestataire", p: ["Le prestataire exerce en toute indépendance et sous sa seule responsabilité : il établit ses devis et factures conformément à la loi, respecte les règles de son métier, la réglementation sociale et fiscale, et répond de ses prestations envers le client."] },
    { h: "7. Commission de mise en relation", p: ["Pour chaque mission obtenue par la plateforme, réalisée et réglée par le client, le prestataire doit à l'éditeur une commission de " + commissionRates_().artisan + " % du montant hors taxes de sa facture (TVA en sus au taux de " + commissionRates_().vat + " %), en rémunération du service de mise en relation. Le client doit de son côté sa propre commission, prévue par les conditions générales.",
      "Si le client paie en ligne par la plateforme" + (fr ? " (Stripe Connect)" : "") + ", la commission est retenue automatiquement sur le paiement et le prestataire reçoit le solde sur son compte de paiement. Si le client paie directement (virement, chèque ou espèces), le prestataire reçoit la totalité et la commission devient exigible dès que le client a indiqué la facture comme réglée : un lien de paiement en ligne lui est alors envoyé, à régler sous 7 jours. Après trois rappels restés sans effet, le référencement peut être suspendu jusqu'au règlement.",
      "Le prestataire s'interdit de détourner la relation pour éviter la commission (facturation hors plateforme d'une mission obtenue par elle)."] },
    { h: "8. Données personnelles", p: ["Les informations et pièces du prestataire sont traitées par l'éditeur pour le contrôle du référencement et la gestion de l'annuaire, et conservées pendant la durée du référencement puis 3 ans après sa fin (sauf obligation légale). Les pièces d'identité et le RIB ne sont jamais montrés aux clients. Droits d'accès, de rectification et d'effacement : {{contactEmail}}."] }
  ] };
}

function legalDocsFR_(v) {
  const google = v.runtime === "google";
  const hosting = google ? "Google (Google Apps Script, Google Sheets, Google Drive), qui agit comme sous-traitant ; les données peuvent être traitées hors de l'Union européenne, dans le cadre des clauses contractuelles types et des engagements de Google."
    : "un serveur dédié situé en France (Paris), loué auprès de {{hostName}} ({{hostAddress}}). Les données sensibles (base de données, pièces d'identité, documents) y sont chiffrées au repos (AES-256).";
  return [
    { id: "mentions", title: "Mentions légales", sections: [
      { h: "Éditeur", p: ["Le logiciel ImmoPilot et le présent site sont édités par {{publisherName}}, {{legalForm}}, dont le siège est situé {{address}}, {{registration}}, n° de TVA intracommunautaire {{vatNumber}}.",
        "Contact : {{contactEmail}} — {{phone}}.", "Directeur ou directrice de la publication : {{director}}."] },
      { h: "Hébergeur", p: ["{{hostName}}, {{hostAddress}}" + (google ? "." : " — serveur situé en France (Paris).")] },
      { h: "Propriété intellectuelle", p: ["Le logiciel, la marque ImmoPilot, son logo et ses contenus sont protégés. Toute reproduction ou réutilisation non autorisée est interdite. Les données saisies par les clients restent leur propriété."] },
      { h: "Signalement", p: ["Pour signaler un contenu illicite ou exercer vos droits, écrivez à {{contactEmail}}."] }
    ] },
    { id: "cgv", title: "Conditions générales d'abonnement et d'utilisation", sections: [
      { h: "1. Objet et acceptation", p: ["Les présentes conditions régissent l'abonnement au logiciel en ligne ImmoPilot (gestion de locations courte et longue durée : biens, réservations, voyageurs, ménage, maintenance, baux, finances) fourni par {{publisherName}} (« l'éditeur ») à ses clients (« le client »), professionnels ou particuliers. Elles sont acceptées en ligne lors de la création du compte ou de la souscription ; la version en vigueur reste consultable à tout moment dans l'application."] },
      legalRoleSection_(),
      legalMarketplaceSection_(v),
      { h: "3. Comptes et accès", p: ["L'accès se fait par des comptes personnels protégés par mot de passe. Toute utilisation anormale doit être signalée sans délai à l'éditeur."] },
      { h: "4. Forfaits et prix", p: ["Le service est fourni selon le forfait choisi (fonctionnalités, nombre de biens, d'utilisateurs et stockage indiqués dans l'application). Les prix sont indiqués en euros : toutes taxes comprises pour les consommateurs, hors taxes (TVA en sus au taux en vigueur) pour les professionnels. Une période d'essai gratuite peut être proposée ; aucun prélèvement n'a lieu avant sa fin.",
        "L'éditeur peut modifier ses prix en informant le client au moins 30 jours avant leur application, par e-mail ou dans l'application ; le client qui refuse peut résilier sans frais avant la date d'effet."] },
      { h: "5. Paiement par prélèvement automatique sur carte", p: ["L'abonnement est payable d'avance, pour chaque période (mensuelle sauf mention contraire). Le client enregistre sa carte bancaire une seule fois dans le formulaire sécurisé du prestataire de paiement SumUp (authentification forte 3D Secure) ; l'éditeur ne reçoit ni ne conserve les numéros de carte. Une vérification d'un petit montant, remboursée aussitôt, peut apparaître sur le relevé.",
        "En enregistrant sa carte, le client autorise le débit automatique du prix de chaque période à son échéance, jusqu'à la résiliation ou au retrait de la carte (possible à tout moment dans Abonnements ; le règlement se fait alors par virement). Chaque règlement est enregistré dans l'historique de facturation de l'application.",
        "En cas de refus de paiement, un nouvel essai est fait les jours suivants et le client est prévenu. Faute de règlement 15 jours après l'échéance, le compte passe en lecture seule (consultation et export restent possibles) jusqu'à la régularisation. Pour un client professionnel, tout retard entraîne de plein droit des pénalités au taux d'intérêt de la BCE majoré de 10 points et une indemnité forfaitaire pour frais de recouvrement de 40 € (art. L. 441-10 du Code de commerce)."] },
      { h: "6. Durée et résiliation", p: ["L'abonnement est sans engagement : il se renouvelle de période en période jusqu'à résiliation. Le client résilie à tout moment, sans motif ni frais, directement depuis son espace (Abonnements › « Résilier en fin de période ») ou par e-mail à {{contactEmail}}. La résiliation prend effet à la fin de la période déjà payée ; aucun nouveau prélèvement n'a lieu et la période entamée n'est pas remboursée au prorata.",
        "L'éditeur peut résilier, après mise en demeure restée sans effet 8 jours, en cas de manquement grave du client (impayé persistant, usage illicite, atteinte à la sécurité du service).",
        "Réversibilité : le client exporte ses données (fichiers CSV et documents) à tout moment et jusqu'à 30 jours après la fin de l'abonnement ; elles sont ensuite supprimées, à l'exception de celles que la loi impose de conserver."] },
      { h: "7. Droit de rétractation (clients consommateurs)", p: ["Le client consommateur dispose de 14 jours à compter de la souscription pour se rétracter sans motif (art. L. 221-18 du Code de la consommation), par e-mail à {{contactEmail}} ou au moyen du formulaire type de rétractation. Il est remboursé dans les 14 jours par le même moyen de paiement.",
        "S'il demande expressément l'accès au service avant la fin de ce délai, il paie, en cas de rétractation, le montant correspondant au service fourni jusqu'à la communication de sa décision (art. L. 221-25)."] },
      legalClientDutiesSection_("le RGPD et la loi Informatique et Libertés"),
      { h: "9. Disponibilité et support", p: ["L'éditeur met en œuvre les moyens raisonnables pour assurer la disponibilité, la sécurité et la sauvegarde du service (obligation de moyens). Des interruptions peuvent survenir pour maintenance, mise à jour, ou en cas d'incident chez l'hébergeur ou un prestataire tiers ; l'éditeur s'efforce de les limiter et de prévenir les clients des interventions programmées. Assistance par e-mail à {{contactEmail}}."] },
      { h: "10. Responsabilité", p: [
        "Compte tenu de son rôle d'éditeur de logiciel (article 2), l'éditeur ne répond pas : des décisions de gestion prises par le client ; des relations, litiges et impayés entre le client et ses locataires, voyageurs, agences, artisans ou autres tiers ; du contenu des données et documents saisis, générés ou envoyés par le client ou en son nom ; du respect par le client de ses propres obligations légales, fiscales et déclaratives ; des services de tiers (prestataire de paiement, banques, messageries, plateformes de réservation, fournisseurs d'IA) ; des conséquences d'une utilisation non conforme ou d'identifiants divulgués par le client.",
        "Envers un client professionnel, la responsabilité de l'éditeur est limitée aux dommages directs résultant d'une faute prouvée et plafonnée au montant payé par le client au titre de l'abonnement au cours des 12 mois précédant le fait générateur ; les dommages indirects (perte d'exploitation, de chiffre d'affaires, de clientèle, de données non exportées) sont exclus.",
        "Envers un client consommateur, l'éditeur répond des dommages résultant d'un manquement prouvé à ses obligations, dans les conditions du droit commun, et les garanties légales de conformité des contenus et services numériques s'appliquent (art. L. 224-25-12 et suivants du Code de la consommation).",
        "Aucune limitation ne s'applique en cas de faute lourde ou intentionnelle de l'éditeur, ni dans les cas où la loi l'interdit. Aucune partie n'est responsable d'un manquement dû à un cas de force majeure (art. 1218 du Code civil)."] },
      { h: "11. Données personnelles", p: ["Pour les données de ses locataires, voyageurs et collaborateurs, le client est responsable de traitement et l'éditeur agit comme sous-traitant, selon l'accord de sous-traitance (art. 28 du RGPD) qui fait partie des présentes conditions. Pour les comptes et l'abonnement, l'éditeur est responsable de traitement (voir la politique de confidentialité)."] },
      { h: "12. Propriété intellectuelle", p: ["Le client reçoit un droit d'utilisation personnel, non exclusif et non transmissible du logiciel pendant la durée de l'abonnement. Le logiciel reste la propriété de l'éditeur ; les données du client restent sa propriété."] },
      { h: "13. Modification des conditions", p: ["L'éditeur peut faire évoluer les présentes conditions pour des raisons légales, techniques ou commerciales ; toute modification substantielle est notifiée au moins 30 jours avant son entrée en vigueur. Le client qui la refuse peut résilier sans frais avant cette date."] },
      { h: "14. Réclamations, médiation et droit applicable", p: ["Toute réclamation est adressée à {{contactEmail}} ; réponse sous 15 jours.",
        "Le client consommateur peut recourir gratuitement au médiateur de la consommation : {{mediator}} (art. L. 612-1 du Code de la consommation).",
        "Les présentes conditions sont soumises au droit français. Le consommateur peut saisir la juridiction de son domicile ou celle du lieu d'exécution ; entre professionnels, les tribunaux du ressort du siège de l'éditeur sont seuls compétents après tentative de règlement amiable."] }
    ] },
    legalProviderDoc_(true),
    { id: "confidentialite", title: "Politique de confidentialité", sections: [
      { h: "Responsable de traitement", p: ["{{publisherName}}, {{address}}, contact : {{contactEmail}}" + (v.dpoEmail ? " — délégué à la protection des données : {{dpoEmail}}" : "") + ", pour les comptes des utilisateurs, l'abonnement, la facturation et la sécurité du service.",
        "Pour les données que les clients enregistrent sur leurs voyageurs, locataires et prestataires, chaque client est responsable de traitement et l'éditeur est son sous-traitant."] },
      { h: "Données traitées et finalités", ul: [
        "Comptes : nom, e-mail, téléphone, rôle, journal de connexion — création et sécurité des comptes (exécution du contrat).",
        "Abonnement et facturation : organisation, forfait, règlements, référence de la carte enregistrée chez SumUp (jeton, sans numéro de carte) — gestion commerciale et obligations comptables (obligation légale : 10 ans pour les pièces comptables).",
        "Voyageurs : identité, coordonnées, nationalité, type et numéro de pièce (masqué par défaut), et pour les voyageurs étrangers date et lieu de naissance et domicile — gestion du séjour et fiche individuelle de police (obligation légale de l'hébergeur).",
        "Locataires : identité, coordonnées, pièce d'identité, bail, échéances et paiements — gestion de la location.",
        "Photos, signatures et documents (états des lieux, ménage, incidents) — preuve de l'exécution des prestations.",
        "Journal d'audit — sécurité et preuve des actions (intérêt légitime)."] },
      { h: "Destinataires et hébergement", p: ["Les données sont accessibles aux seules personnes habilitées pour le bien concerné (propriétaire, agence autorisée, prestataire missionné), dans la limite de leurs droits, et sont hébergées sur " + hosting,
        "Paiements de l'abonnement : SumUp (prestataire de paiement agréé). Envoi des e-mails de service : " + (google ? "Google (Gmail)." : "Brevo (Sendinblue SAS, France).") +
        " Si l'assistant IA est activé, la question posée et la page affichée sont transmises au fournisseur d'IA choisi (Anthropic ou Google), sans aucune donnée de biens, réservations, clients ou paiements.",
        "Les données ne sont ni vendues ni utilisées à des fins publicitaires."] },
      { h: "Durées de conservation", ul: [
        "Copies de pièces d'identité et données d'identité des voyageurs : supprimées automatiquement 30 jours après le départ (durée réglable par le client).",
        "Fiches individuelles de police : 6 mois après le départ du voyageur.",
        "Comptes : pendant l'abonnement, puis suppression sur demande ou 30 jours après la fin de l'abonnement ; journaux de sécurité : 2 ans.",
        "Pièces comptables (abonnements, règlements) : 10 ans."] },
      { h: "Sécurité", p: ["Connexions chiffrées (HTTPS), mots de passe protégés par hachage PBKDF2, données sensibles chiffrées au repos (AES-256), cloisonnement strict des données par organisation, fichiers privés jamais accessibles par lien public, journalisation des accès aux documents sensibles, sauvegardes chiffrées quotidiennes."] },
      { h: "Vos droits", p: ["Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, ainsi que du droit de définir des directives sur le sort de vos données après votre décès. Écrivez à {{contactEmail}} ; réponse sous un mois.",
        "La suppression de votre compte peut être demandée depuis Paramètres › Mon profil. Vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr)."] }
    ] },
    { id: "cookies", title: "Cookies et stockage local", sections: [
      { h: "Ce que nous utilisons", p: ["ImmoPilot n'utilise ni cookie publicitaire ni outil de mesure d'audience. Le navigateur conserve seulement des éléments strictement nécessaires au fonctionnement : le jeton de session (pendant la visite), la langue et le thème clair/sombre choisis. Le formulaire de paiement SumUp peut déposer ses propres traceurs techniques, nécessaires à la sécurité du paiement.",
        "Ces éléments sont exemptés de consentement (article 82 de la loi Informatique et Libertés et lignes directrices de la CNIL). Vous pouvez les effacer depuis les réglages de votre navigateur ; vous serez alors déconnecté."] }
    ] },
    { id: "dpa", title: "Accord de sous-traitance (article 28 du RGPD)", sections: [
      { h: "Parties et objet", p: ["Le client (responsable de traitement) confie à {{publisherName}} (sous-traitant) le traitement des données personnelles qu'il enregistre dans ImmoPilot, pour la seule fourniture du service et pendant la durée de l'abonnement."] },
      { h: "Données et personnes concernées", p: ["Voyageurs, locataires, propriétaires, collaborateurs et prestataires du client : identité, coordonnées, données de séjour ou de location, pièces d'identité, données de naissance et domicile des voyageurs étrangers, paiements, photos et documents."] },
      { h: "Engagements du sous-traitant", ul: [
        "Ne traiter les données que sur instruction documentée du client (le paramétrage et l'utilisation du service valent instructions).",
        "Garantir la confidentialité des personnes autorisées à y accéder ; l'équipe ImmoPilot n'accède aux données du client qu'avec un accès d'assistance accordé par le client, limité dans le temps et journalisé.",
        "Mettre en œuvre les mesures de sécurité décrites dans la politique de confidentialité.",
        "Aider le client à répondre aux demandes d'exercice des droits et à réaliser ses analyses d'impact le cas échéant.",
        "Notifier au client toute violation de données dans les meilleurs délais et au plus tard 48 heures après en avoir eu connaissance.",
        "À la fin du contrat, permettre l'export des données puis les supprimer, sauf obligation légale de conservation.",
        "Mettre à disposition les informations nécessaires pour démontrer le respect de ces obligations."] },
      { h: "Sous-traitants ultérieurs", p: ["Hébergement : " + (google ? "Google Ireland Limited." : "{{hostName}} (serveur en France).") + " Envoi des e-mails : " + (google ? "Google." : "Brevo (France).") +
        " Assistant IA (facultatif) : Anthropic ou Google. Le client est informé de tout changement et peut s'y opposer en résiliant son abonnement."] }
    ] }
  ];
}

function legalDocsMA_(v) {
  const google = v.runtime === "google";
  const hosting = google ? "Google (Google Apps Script, Google Sheets, Google Drive)" : "un serveur dédié situé en France (Paris), loué auprès de {{hostName}} ({{hostAddress}}), avec chiffrement au repos (AES-256) des données sensibles";
  return [
    { id: "mentions", title: "Mentions légales", sections: [
      { h: "Éditeur", p: ["La plateforme ImmoPilot est éditée par {{publisherName}}, {{legalForm}}, société de droit français dont le siège est situé {{address}}, {{registration}}, n° de TVA intracommunautaire {{vatNumber}}.",
        "Contact : {{contactEmail}} — {{phone}}.", "Directeur ou directrice de la publication : {{director}}."] },
      { h: "Hébergeur", p: ["{{hostName}}, {{hostAddress}}" + (google ? "." : " — serveur situé en France (Paris).")] },
      { h: "Propriété intellectuelle", p: ["Le logiciel, la marque ImmoPilot, son logo et ses contenus sont protégés. Toute reproduction non autorisée est interdite. Les données saisies par les clients restent leur propriété."] }
    ] },
    { id: "cgv", title: "Conditions générales d'abonnement et d'utilisation", sections: [
      { h: "1. Objet et acceptation", p: ["Les présentes conditions régissent l'abonnement à la plateforme en ligne ImmoPilot (gestion de locations courte et longue durée) fournie par {{publisherName}} (« l'éditeur ») à ses clients au Maroc (« le client »), professionnels ou particuliers. Elles sont acceptées en ligne, par un clic de confirmation, lors de la création du compte ou de la souscription ; cette acceptation électronique a la même valeur qu'une signature (loi n° 53-05 relative à l'échange électronique de données juridiques). La version en vigueur reste consultable à tout moment dans l'application."] },
      legalRoleSection_(),
      legalMarketplaceSection_(v),
      { h: "3. Forfaits et prix", p: ["Le service est fourni selon le forfait choisi (fonctionnalités, nombre de biens, d'utilisateurs et stockage indiqués dans l'application). Les prix sont indiqués en dirhams marocains (MAD), toutes taxes comprises lorsque le client est un consommateur. Une période d'essai gratuite peut être proposée ; aucun prélèvement n'a lieu avant sa fin.",
        "L'éditeur peut modifier ses prix en informant le client au moins 30 jours avant leur application ; le client qui refuse peut résilier sans frais avant la date d'effet."] },
      { h: "4. Paiement par carte, en euros au cours du jour", p: ["L'abonnement est payable d'avance pour chaque période (mensuelle sauf mention contraire), par prélèvement automatique sur la carte bancaire que le client enregistre une seule fois dans le formulaire sécurisé du prestataire de paiement SumUp (authentification forte 3D Secure). L'éditeur ne reçoit ni ne conserve les numéros de carte.",
        "Le prix est fixé en dirhams, mais le compte de paiement de l'éditeur encaisse en euros : chaque prélèvement est débité en euros (EUR), au cours de change MAD/EUR du jour du prélèvement (source publique de cours de change, mise à jour quotidienne ; à défaut, dernier cours connu). Le montant débité en euros peut donc varier légèrement d'une période à l'autre. Le montant estimé est affiché avant l'enregistrement de la carte et le cours appliqué figure dans l'historique des règlements. Les frais de change ou bancaires éventuellement facturés par la banque du client restent à sa charge.",
        "En enregistrant sa carte, le client autorise ces débits à chaque échéance jusqu'à la résiliation ou au retrait de la carte (possible à tout moment dans Abonnements ; le règlement se fait alors par virement). En cas de refus de paiement, un nouvel essai est fait les jours suivants et le client est prévenu ; faute de règlement 15 jours après l'échéance, le compte passe en lecture seule (consultation et export restent possibles) jusqu'à la régularisation."] },
      { h: "5. Durée et résiliation", p: ["L'abonnement est sans engagement et se renouvelle de période en période. Le client résilie à tout moment, sans motif ni frais, depuis son espace (Abonnements › « Résilier en fin de période ») ou par e-mail à {{contactEmail}}. La résiliation prend effet à la fin de la période déjà payée ; aucun nouveau prélèvement n'a lieu et la période entamée n'est pas remboursée au prorata.",
        "L'éditeur peut résilier, après mise en demeure restée sans effet 8 jours, en cas de manquement grave du client (impayé persistant, usage illicite, atteinte à la sécurité du service).",
        "Le client exporte ses données à tout moment et jusqu'à 30 jours après la fin de l'abonnement ; elles sont ensuite supprimées, sauf obligation légale de conservation."] },
      { h: "6. Droit de rétractation (clients consommateurs)", p: ["Le client consommateur, au sens de la loi n° 31-08 édictant des mesures de protection du consommateur, dispose d'un délai de 7 jours à compter de la souscription pour se rétracter sans motif ni pénalité (article 36 de la loi n° 31-08), par e-mail à {{contactEmail}}. Les sommes versées lui sont remboursées dans les 15 jours.",
        "S'il demande expressément à utiliser le service pendant ce délai, la rétractation reste possible ; seule la part du service effectivement fournie peut lui être facturée, dans la mesure permise par la loi."] },
      legalClientDutiesSection_("la loi n° 09-08 relative à la protection des personnes physiques à l'égard du traitement des données à caractère personnel"),
      { h: "8. Disponibilité et support", p: ["L'éditeur met en œuvre les moyens raisonnables pour assurer la disponibilité, la sécurité et la sauvegarde du service (obligation de moyens). Des interruptions peuvent survenir pour maintenance ou en cas d'incident chez l'hébergeur ou un prestataire tiers. Assistance par e-mail à {{contactEmail}}."] },
      { h: "9. Responsabilité", p: [
        "Compte tenu de son rôle d'éditeur de logiciel (article 2), l'éditeur ne répond pas : des décisions de gestion prises par le client ; des relations, litiges et impayés entre le client et ses locataires, voyageurs, agences, artisans ou autres tiers ; du contenu des données et documents saisis, générés ou envoyés par le client ou en son nom ; du respect par le client de ses propres obligations légales, fiscales et déclaratives (notamment déclaration des voyageurs aux autorités et formalités auprès de la CNDP) ; des services de tiers (prestataire de paiement, banques, messageries, plateformes de réservation, fournisseurs d'IA) ; des conséquences d'une utilisation non conforme ou d'identifiants divulgués par le client.",
        "Envers un client professionnel, la responsabilité de l'éditeur est limitée aux dommages directs résultant d'une faute prouvée et plafonnée au montant payé par le client au titre de l'abonnement au cours des 12 mois précédant le fait générateur ; les dommages indirects (perte d'exploitation, de chiffre d'affaires, de clientèle, de données non exportées) sont exclus.",
        "Envers un client consommateur, aucune clause des présentes ne peut supprimer ou réduire son droit à réparation en cas de manquement de l'éditeur à ses obligations (article 18 de la loi n° 31-08).",
        "Aucune limitation ne s'applique en cas de dol ou de faute lourde de l'éditeur. Aucune partie n'est responsable d'un manquement dû à un cas de force majeure (articles 268 et 269 du Dahir des obligations et contrats)."] },
      { h: "10. Données personnelles", p: ["Pour les données de ses locataires, voyageurs et collaborateurs, le client est responsable du traitement et l'éditeur agit comme sous-traitant, en ne traitant ces données que pour fournir le service. Les données sont hébergées en France, pays reconnu par la CNDP comme assurant un niveau de protection suffisant. Voir la politique de confidentialité."] },
      { h: "11. Propriété intellectuelle", p: ["Le client reçoit un droit d'utilisation personnel, non exclusif et non transmissible de la plateforme pendant la durée de l'abonnement. La plateforme reste la propriété de l'éditeur ; les données du client restent sa propriété."] },
      { h: "12. Modification des conditions", p: ["L'éditeur peut faire évoluer les présentes conditions ; toute modification substantielle est notifiée au moins 30 jours avant son entrée en vigueur. Le client qui la refuse peut résilier sans frais avant cette date."] },
      { h: "13. Réclamations et droit applicable", p: ["Toute réclamation est adressée à {{contactEmail}} ; réponse sous 15 jours. Les parties recherchent d'abord une solution amiable.",
        "Les présentes conditions sont soumises au droit marocain. Le client consommateur peut saisir le tribunal de son domicile ou du lieu du fait dommageable (article 202 de la loi n° 31-08) ; entre professionnels, les tribunaux de commerce de Marrakech sont compétents."] }
    ] },
    legalProviderDoc_(false),
    { id: "confidentialite", title: "Politique de confidentialité", sections: [
      { h: "Responsable du traitement", p: ["{{publisherName}}, {{address}} — {{contactEmail}}, pour les comptes des utilisateurs, l'abonnement, la facturation et la sécurité. Pour les données que les clients enregistrent sur leurs locataires, voyageurs et prestataires, chaque client est responsable du traitement et l'éditeur est son sous-traitant.",
        "Traitements conformes à la loi n° 09-08. Référence CNDP : {{dataAuthorityRef}}."] },
      { h: "Données et finalités", ul: [
        "Comptes : nom, e-mail, téléphone, rôle, journal de connexion — création et sécurité des comptes.",
        "Abonnement : organisation, forfait, règlements, référence de la carte chez SumUp (jeton, sans numéro de carte) — gestion commerciale et comptable.",
        "Voyageurs et locataires saisis par le client : identité, coordonnées, pièce d'identité (CIN, passeport ; numéro masqué par défaut), séjours, baux et paiements — gestion locative et déclarations légales du client.",
        "Photos et documents d'exécution des prestations ; journal d'audit (sécurité)."] },
      { h: "Hébergement, transfert et destinataires", p: ["Les données sont hébergées sur " + hosting + ". La France figure parmi les pays assurant un niveau de protection suffisant au sens de la loi n° 09-08. Destinataires : les seules personnes habilitées pour le bien concerné, SumUp pour les paiements de l'abonnement, Brevo pour l'envoi des e-mails de service. Aucune donnée n'est vendue ni utilisée à des fins publicitaires."] },
      { h: "Conservation et sécurité", p: ["Copies de pièces d'identité des voyageurs supprimées 30 jours après le départ (réglable) ; comptes supprimés sur demande ou 30 jours après la fin de l'abonnement ; pièces comptables 10 ans. Connexions HTTPS, mots de passe hachés, chiffrement au repos, cloisonnement par organisation, sauvegardes chiffrées."] },
      { h: "Vos droits", p: ["Droits d'information, d'accès, de rectification et d'opposition (articles 5 à 9 de la loi n° 09-08) : écrivez à {{contactEmail}}. Suppression du compte : Paramètres › Mon profil. Vous pouvez saisir la CNDP (www.cndp.ma)."] }
    ] },
    { id: "cookies", title: "Cookies et stockage local", sections: [
      { h: "Stockage", p: ["Seuls le jeton de session, la langue et le thème sont conservés dans le navigateur, pour le fonctionnement de l'application ; le formulaire de paiement SumUp peut déposer ses propres traceurs techniques de sécurité. Aucun cookie publicitaire ni de mesure d'audience."] }
    ] }
  ];
}

/** Route publique : pages légales de l'édition (aucune donnée privée). */
function legalGet_(a) {
  const v = legalValues_();
  const docs = (edition_().code === "FR" ? legalDocsFR_(v) : legalDocsMA_(v)).map(function (d) {
    return { id: d.id, title: d.title, sections: d.sections.map(function (s) { return { h: s.h, p: (s.p || []).map(function (x) { return legalFill_(x, v); }), ul: (s.ul || []).map(function (x) { return legalFill_(x, v); }) }; }) };
  });
  const missing = Object.keys(LEGAL_FIELDS_).filter(function (k) { return !v[k] && ["vatNumber", "phone", "hostPhone", "dpoEmail", "dataAuthorityRef", "mediator", "platformInsurance"].indexOf(k) < 0; });
  return { edition: edition_().code, updatedAt: LEGAL_VERSION_, docs: a && a.id ? docs.filter(function (d) { return d.id === a.id; }) : docs, missing: missing.map(function (k) { return LEGAL_FIELDS_[k]; }),
    notice: "Modèles à faire relire par un professionnel du droit avant mise en service. ImmoPilot ne garantit pas leur conformité." };
}
