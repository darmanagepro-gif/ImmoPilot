/**
 * Pages légales affichées dans l'application (lien en bas de l'écran de connexion et dans les paramètres) :
 * mentions légales, conditions générales, confidentialité, cookies et, pour la France, accord de sous-traitance (art. 28 RGPD).
 * Les informations propres à l'éditeur (raison sociale, SIRET, hébergeur…) se règlent dans Paramètres › Plateforme (clés legal.*) :
 * tant qu'une valeur manque, elle apparaît surlignée « À compléter ».
 * Ces textes sont des modèles : ils doivent être relus par un professionnel du droit avant la mise en service. ImmoPilot ne garantit pas leur conformité.
 */
var LEGAL_FIELDS_ = {
  publisherName: "Nom ou raison sociale de l'éditeur", legalForm: "Forme juridique et capital social", address: "Adresse du siège",
  registration: "Immatriculation (RCS / SIREN ou RC / ICE)", vatNumber: "N° de TVA intracommunautaire", director: "Directeur ou directrice de la publication",
  contactEmail: "E-mail de contact", phone: "Téléphone", hostName: "Hébergeur", hostAddress: "Adresse de l'hébergeur", hostPhone: "Téléphone de l'hébergeur",
  mediator: "Médiateur de la consommation (nom et site)", dataAuthorityRef: "Référence de déclaration à l'autorité de protection des données", dpoEmail: "E-mail du délégué à la protection des données (facultatif)"
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

function legalDocsFR_(v) {
  const google = v.runtime === "google";
  const hosting = google ? "Google (Google Apps Script, Google Sheets, Google Drive), qui agit comme sous-traitant ; les données peuvent être traitées hors de l'Union européenne, dans le cadre des clauses contractuelles types et des engagements de Google (Data Processing Addendum)."
    : "le serveur dédié de l'éditeur, loué auprès de {{hostName}} ({{hostAddress}}). Choisissez de préférence un hébergement situé dans l'Union européenne.";
  return [
    { id: "mentions", title: "Mentions légales", sections: [
      { h: "Éditeur", p: ["Le logiciel ImmoPilot et le présent site sont édités par {{publisherName}}, {{legalForm}}, dont le siège est situé {{address}}, immatriculée sous le numéro {{registration}}, n° de TVA intracommunautaire {{vatNumber}}.",
        "Contact : {{contactEmail}} — {{phone}}.", "Directeur ou directrice de la publication : {{director}}."] },
      { h: "Hébergeur", p: ["{{hostName}}, {{hostAddress}}" + (google ? "." : ", téléphone : {{hostPhone}}.")] },
      { h: "Propriété intellectuelle", p: ["Le logiciel, sa marque, son logo et ses contenus sont protégés. Toute reproduction ou réutilisation non autorisée est interdite. Les données saisies par les clients restent leur propriété."] },
      { h: "Signalement", p: ["Pour signaler un contenu illicite ou exercer vos droits, écrivez à {{contactEmail}}."] }
    ] },
    { id: "cgv", title: "Conditions générales d'utilisation et de vente", sections: [
      { h: "1. Objet", p: ["Les présentes conditions régissent l'accès au logiciel en ligne ImmoPilot (gestion de locations courte et longue durée : biens, réservations, voyageurs, ménage, maintenance, baux, finances) fourni par {{publisherName}} (« l'éditeur ») à ses clients (« le client »). Créer un compte ou utiliser le service vaut acceptation."] },
      { h: "2. Comptes et accès", p: ["Le client est responsable des comptes qu'il crée ou dont il invite les utilisateurs (agences, gardiens, équipes de ménage, artisans, locataires) et des droits qu'il leur accorde. Les identifiants sont personnels ; toute utilisation anormale doit être signalée sans délai."] },
      { h: "3. Abonnement, prix et paiement", p: ["Le service est fourni sur abonnement selon le forfait choisi ; les prix sont indiqués en euros hors taxes, TVA en sus au taux en vigueur. Une période d'essai peut être proposée.",
        "Le règlement s'effectue d'avance pour chaque période, par virement ou tout autre moyen indiqué par l'éditeur ; l'application n'effectue aucun paiement en ligne. En cas de retard de paiement d'un client professionnel : pénalités au taux d'intérêt de la BCE majoré de 10 points et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L. 441-10 du Code de commerce). Après le délai de grâce, le compte passe en lecture seule jusqu'au règlement."] },
      { h: "4. Durée, résiliation et réversibilité", p: ["L'abonnement se renouvelle par périodes successives. Le client peut le résilier à tout moment depuis son espace ; la résiliation prend effet à la fin de la période payée.",
        "Le client peut exporter ses données (fichiers CSV et documents) à tout moment et jusqu'à 30 jours après la fin de l'abonnement ; elles sont ensuite supprimées, à l'exception de celles que la loi impose de conserver."] },
      { h: "5. Clients consommateurs", p: ["Le client qui agit en tant que consommateur dispose d'un délai de rétractation de 14 jours à compter de la souscription (art. L. 221-18 du Code de la consommation). S'il demande l'accès immédiat au service, il paie la part correspondant à la période utilisée.",
        "En cas de litige, il peut recourir gratuitement au médiateur de la consommation : {{mediator}}, ou à la plateforme européenne de règlement en ligne des litiges."] },
      { h: "6. Obligations du client", p: ["Le client utilise le service conformément à la loi. Il reste seul responsable des informations qu'il saisit et de ses obligations propres : déclaration et numéro d'enregistrement des meublés de tourisme, taxe de séjour, fiches individuelles de police des voyageurs étrangers, baux et quittances, factures et obligations fiscales.",
        "Les modèles de documents (contrats, fiches, devis, factures) sont fournis à titre indicatif et doivent être vérifiés par le client ; l'éditeur ne garantit pas leur conformité à sa situation."] },
      { h: "7. Disponibilité et responsabilité", p: ["L'éditeur met en œuvre les moyens raisonnables pour assurer la disponibilité et la sécurité du service (obligation de moyens), notamment des sauvegardes régulières. Des interruptions peuvent survenir pour maintenance ou en cas d'incident chez l'hébergeur.",
        "La responsabilité de l'éditeur envers un client professionnel est limitée aux dommages directs et plafonnée au montant payé par le client au cours des 12 derniers mois."] },
      { h: "8. Données personnelles", p: ["Pour les données de ses voyageurs, locataires et collaborateurs, le client est responsable de traitement et l'éditeur agit comme sous-traitant, selon l'accord de sous-traitance (art. 28 du RGPD) qui fait partie des présentes conditions. Voir aussi la politique de confidentialité."] },
      { h: "9. Droit applicable", p: ["Les présentes conditions sont soumises au droit français. Entre professionnels, tout litige relève des tribunaux compétents du ressort du siège de l'éditeur, après une tentative de règlement amiable."] }
    ] },
    { id: "confidentialite", title: "Politique de confidentialité", sections: [
      { h: "Responsable de traitement", p: ["{{publisherName}}, {{address}}, contact : {{contactEmail}}" + (v.dpoEmail ? " — délégué à la protection des données : {{dpoEmail}}" : "") + ", pour les comptes des utilisateurs, l'abonnement et la sécurité du service.",
        "Pour les données que les clients enregistrent sur leurs voyageurs, locataires et prestataires, chaque client est responsable de traitement et l'éditeur est son sous-traitant."] },
      { h: "Données traitées et finalités", ul: [
        "Comptes : nom, e-mail, téléphone, rôle, journal de connexion — création et sécurité des comptes (exécution du contrat).",
        "Abonnement et facturation : organisation, forfait, règlements — gestion commerciale et obligations comptables (obligation légale : 10 ans pour les pièces comptables).",
        "Voyageurs : identité, coordonnées, nationalité, type et numéro de pièce (masqué par défaut), et pour les voyageurs étrangers date et lieu de naissance et domicile — gestion du séjour et fiche individuelle de police (obligation légale de l'hébergeur).",
        "Locataires : identité, coordonnées, bail, échéances et paiements — gestion de la location.",
        "Photos, signatures et documents (états des lieux, ménage, incidents) — preuve de l'exécution des prestations.",
        "Journal d'audit — sécurité et preuve des actions (intérêt légitime)."] },
      { h: "Destinataires et hébergement", p: ["Les données sont accessibles aux seules personnes habilitées pour le bien concerné (propriétaire, agence autorisée, prestataire missionné), dans la limite de leurs droits, et sont hébergées par " + hosting,
        "Les e-mails de service (invitations, liens de connexion, notifications) sont envoyés par " + (google ? "Google (Gmail)." : "le service d'envoi configuré par l'éditeur.") +
        " Si l'assistant d'aide en mode IA est activé, la question posée et la page affichée sont transmises au fournisseur d'IA choisi (Anthropic ou Google), sans aucune donnée de biens, réservations, clients ou paiements.",
        "Les données ne sont ni vendues ni utilisées à des fins publicitaires."] },
      { h: "Durées de conservation", ul: [
        "Copies de pièces d'identité et données d'identité des voyageurs : supprimées automatiquement 30 jours après le départ (durée réglable par le client).",
        "Fiches individuelles de police : 6 mois après le départ du voyageur.",
        "Comptes : pendant l'abonnement, puis suppression sur demande ou 30 jours après la fin de l'abonnement ; journaux de sécurité : 2 ans.",
        "Pièces comptables (abonnements, factures) : 10 ans."] },
      { h: "Sécurité", p: ["Connexions chiffrées (HTTPS), mots de passe protégés par hachage PBKDF2, cloisonnement strict des données par organisation, fichiers privés jamais accessibles par lien public, journalisation des accès aux documents sensibles, sauvegardes régulières."] },
      { h: "Vos droits", p: ["Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, ainsi que du droit de définir des directives sur le sort de vos données après votre décès. Écrivez à {{contactEmail}} ; réponse sous un mois.",
        "La suppression de votre compte peut être demandée depuis Paramètres › Mon profil. Vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr)."] }
    ] },
    { id: "cookies", title: "Cookies et stockage local", sections: [
      { h: "Ce que nous utilisons", p: ["ImmoPilot n'utilise ni cookie publicitaire ni outil de mesure d'audience. Le navigateur conserve seulement des éléments strictement nécessaires au fonctionnement : le jeton de session (pendant la visite), la langue et le thème clair/sombre choisis.",
        "Ces éléments sont exemptés de consentement (article 82 de la loi Informatique et Libertés et lignes directrices de la CNIL). Vous pouvez les effacer à tout moment depuis les réglages de votre navigateur ; vous serez alors déconnecté."] }
    ] },
    { id: "dpa", title: "Accord de sous-traitance (article 28 du RGPD)", sections: [
      { h: "Parties et objet", p: ["Le client (responsable de traitement) confie à {{publisherName}} (sous-traitant) le traitement des données personnelles qu'il enregistre dans ImmoPilot, pour la seule fourniture du service et pendant la durée de l'abonnement."] },
      { h: "Données et personnes concernées", p: ["Voyageurs, locataires, propriétaires, collaborateurs et prestataires du client : identité, coordonnées, données de séjour ou de location, pièces d'identité, données de naissance et domicile des voyageurs étrangers, paiements, photos et documents."] },
      { h: "Engagements du sous-traitant", ul: [
        "Ne traiter les données que sur instruction documentée du client (le paramétrage et l'utilisation du service valent instructions).",
        "Garantir la confidentialité des personnes autorisées à y accéder ; l'équipe ImmoPilot n'accède aux données du client qu'à des fins de support, de façon journalisée.",
        "Mettre en œuvre les mesures de sécurité décrites dans la politique de confidentialité.",
        "Aider le client à répondre aux demandes d'exercice des droits et à réaliser ses analyses d'impact le cas échéant.",
        "Notifier au client toute violation de données dans les meilleurs délais et au plus tard 48 heures après en avoir eu connaissance.",
        "À la fin du contrat, permettre l'export des données puis les supprimer, sauf obligation légale de conservation.",
        "Mettre à disposition les informations nécessaires pour démontrer le respect de ces obligations."] },
      { h: "Sous-traitants ultérieurs", p: ["Hébergement : " + (google ? "Google Ireland Limited (Google Cloud / Google Workspace)." : "{{hostName}}.") + " Envoi des e-mails : " + (google ? "Google." : "prestataire d'envoi configuré par l'éditeur.") +
        " Assistant IA (facultatif) : Anthropic ou Google. Le client est informé de tout changement et peut s'y opposer en résiliant son abonnement."] }
    ] }
  ];
}

function legalDocsMA_(v) {
  return [
    { id: "mentions", title: "Mentions légales", sections: [
      { h: "Éditeur", p: ["ImmoPilot est édité par {{publisherName}}, {{address}}, {{registration}}. Contact : {{contactEmail}}. Directeur ou directrice de la publication : {{director}}."] },
      { h: "Hébergeur", p: ["{{hostName}}, {{hostAddress}}."] }
    ] },
    { id: "cgv", title: "Conditions générales d'utilisation", sections: [
      { h: "Service", p: ["ImmoPilot est un logiciel en ligne de gestion locative fourni sur abonnement. Les prix sont indiqués en dirhams ; l'application n'effectue aucun paiement en ligne.",
        "Le client reste responsable des données qu'il saisit et de ses obligations (déclaration des voyageurs, fiscalité, baux). Les modèles de documents sont indicatifs."] },
      { h: "Résiliation", p: ["La résiliation prend effet à la fin de la période payée ; les données restent exportables."] }
    ] },
    { id: "confidentialite", title: "Politique de confidentialité", sections: [
      { h: "Responsable et autorité", p: ["{{publisherName}} — {{contactEmail}}. Déclaration ou autorisation CNDP : {{dataAuthorityRef}}. Traitements conformes à la loi 09-08."] },
      { h: "Données et conservation", p: ["Comptes, voyageurs (numéro de pièce masqué par défaut, copies supprimées 30 jours après le départ), locataires, photos et documents d'exécution des prestations. Les données sont hébergées par Google et ne sont jamais vendues."] },
      { h: "Vos droits", p: ["Droits d'accès, de rectification et d'opposition : écrivez à {{contactEmail}}. Suppression du compte : Paramètres › Mon profil."] }
    ] },
    { id: "cookies", title: "Cookies et stockage local", sections: [
      { h: "Stockage", p: ["Seuls le jeton de session, la langue et le thème sont conservés dans le navigateur, pour le fonctionnement de l'application. Aucun cookie publicitaire ni de mesure d'audience."] }
    ] }
  ];
}

/** Route publique : pages légales de l'édition (aucune donnée privée). */
function legalGet_(a) {
  const v = legalValues_();
  const docs = (edition_().code === "FR" ? legalDocsFR_(v) : legalDocsMA_(v)).map(function (d) {
    return { id: d.id, title: d.title, sections: d.sections.map(function (s) { return { h: s.h, p: (s.p || []).map(function (x) { return legalFill_(x, v); }), ul: (s.ul || []).map(function (x) { return legalFill_(x, v); }) }; }) };
  });
  const missing = Object.keys(LEGAL_FIELDS_).filter(function (k) { return !v[k] && ["vatNumber", "phone", "hostPhone", "dpoEmail", "dataAuthorityRef", "mediator"].indexOf(k) < 0; });
  return { edition: edition_().code, updatedAt: "2026-10-19", docs: a && a.id ? docs.filter(function (d) { return d.id === a.id; }) : docs, missing: missing.map(function (k) { return LEGAL_FIELDS_[k]; }),
    notice: "Modèles à faire relire par un professionnel du droit avant mise en service. ImmoPilot ne garantit pas leur conformité." };
}
