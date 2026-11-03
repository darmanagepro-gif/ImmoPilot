/**
 * AGENT DE RÉDACTION (location longue durée) : contrat de bail, états des lieux d'entrée et de sortie, courriers au locataire.
 *
 * Deux moteurs, même résultat (un brouillon modifiable, puis un PDF définitif) :
 *  - IA : si l'assistant IA est configuré (IMMO_AI_PROVIDER + IMMO_AI_API_KEY ; modèle facultatif IMMO_AI_DOC_MODEL), le serveur
 *    demande la rédaction au service d'IA. AUCUNE donnée d'identité n'est transmise : ni nom, ni e-mail, ni téléphone, ni adresse,
 *    ni pièce d'identité. L'IA écrit avec des marqueurs ([BAILLEUR], [LOCATAIRE], [ADRESSE_DU_BIEN], [VILLE]) que le serveur
 *    remplace ensuite par les vraies valeurs.
 *  - MODÈLE INTÉGRÉ : sans IA (ou en cas d'erreur), un modèle rédigé à l'avance pour l'édition (Maroc : loi 67-12 ;
 *    France : loi 89-462) est rempli avec les données du bail. L'application fonctionne donc toujours.
 * Règles :
 *  - Rien n'est envoyé au locataire sans action explicite du bailleur (« Valider », puis « Envoyer au locataire »).
 *  - Les avertissements juridiques calculés par le serveur (révision du loyer, dépôt de garantie, durée) s'ajoutent à ceux de l'IA.
 *  - Les documents sont des modèles : ils doivent être relus par un professionnel ; DarPilot ne garantit pas leur conformité.
 */
var LA_CONDITIONS_ = ["NEW", "GOOD", "WORN", "BAD", "NA"];
var LA_CONDITION_LABELS_ = { NEW: "Neuf", GOOD: "Bon état", WORN: "État d'usage", BAD: "Mauvais état", NA: "Sans objet" };
var LA_CONDITION_RANK_ = { NEW: 0, GOOD: 1, WORN: 2, BAD: 3 };
var LA_CLAUSES_ = ["INSURANCE_REQUIRED", "SUBLET_FORBIDDEN", "PETS_ALLOWED", "PETS_FORBIDDEN", "NO_SMOKING", "GUARANTOR", "WORKS_AUTH_REQUIRED"];
var LA_LETTER_TYPES_ = ["RENEWAL", "RENT_REVISION", "DEPOSIT_RETURN", "FREE"];
var LA_LIMITS_ = { perOrgDay: 60, contractTokens: 6000, inspectionTokens: 4000, letterTokens: 1500 };
var AI_DOC_MODEL_PROPERTY_ = "IMMO_AI_DOC_MODEL";

/* ------------------------------ Outils communs ------------------------------ */
function laCtx_(p, leaseId, cap) {
  const x = leaseLoad_(p, leaseId, cap || "lease.manage");
  const c = rentCtx_(x.l);
  c.self = x.self;
  return c;
}
function laFacts_(c) {
  const ed = edition_(), l = c.l, prop = c.prop;
  return { pays: ed.countryName, droitApplicable: ed.leaseLaw, devise: cur_(), ville: prop.city || ed.city, typeDeBien: prop.propertyType || "", surfaceM2: num_(prop.surfaceM2) || null,
    chambres: num_(prop.bedrooms) || null, sallesDeBain: num_(prop.bathrooms) || null, pieces: parseJson_(prop.roomsJson, []), equipements: parseJson_(prop.equipmentJson, []),
    debut: l.startDate, fin: l.endDate || null, dureeMois: num_(l.durationMonths) || null, loyerMensuel: num_(l.monthlyRent), chargesMensuelles: num_(l.charges), depotDeGarantie: num_(l.deposit),
    jourEcheance: num_(l.dueDay) || 5, indexationAnnuellePct: num_(l.indexationRate), conditionsParticulieres: l.terms || "" };
}
/** Remplace les marqueurs par les vraies valeurs (après la réponse de l'IA : les identités ne lui sont jamais transmises). */
function laFill_(text, c) {
  const map = { "[BAILLEUR]": c.org.name || "le bailleur", "[LOCATAIRE]": c.t.fullName || "le locataire", "[ADRESSE_DU_BIEN]": rentAddress_(c.prop) || c.prop.name || "", "[VILLE]": c.prop.city || edition_().city, "[BIEN]": c.prop.name || "", "[DESCRIPTION_DU_BIEN]": safeText_(c.prop.description || "", 1500) };
  return String(text || "").replace(/\[(BAILLEUR|LOCATAIRE|ADRESSE_DU_BIEN|VILLE|BIEN|DESCRIPTION_DU_BIEN)\]/g, function (m) { return map[m]; });
}
function laMoney_(v) { return fmtAmount_(v, cur_()); }
function laParas_(text) { return String(text || "").split(/\n{2,}|\r\n\r\n/).map(function (pg) { return "<p>" + escapeHtml_(pg.trim()).replace(/\n/g, "<br>") + "</p>"; }).join(""); }
function laAiCfg_() {
  const cfg = aiConfig_(); if (!cfg) return null;
  let model = ""; try { model = String(PropertiesService.getScriptProperties().getProperty(AI_DOC_MODEL_PROPERTY_) || "").trim(); } catch (e) { model = ""; }
  return model ? Object.assign({}, cfg, { model: model }) : cfg;
}
/** Appel IA attendant un objet JSON. Retourne null si l'IA n'est pas configurée ; lève une erreur si la réponse est inexploitable. */
function laAiJson_(orgId, system, payload, maxTokens) {
  const cfg = laAiCfg_(); if (!cfg) return null;
  rateLimit_("ai-doc:" + orgId, LA_LIMITS_.perOrgDay, 86400); rateLimit_("ai-platform", AI_LIMITS_.platformDay, 86400);
  const text = aiCall_(cfg, system, [{ role: "user", content: JSON.stringify(payload) }], maxTokens);
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error("réponse sans JSON");
  const data = JSON.parse(text.slice(i, j + 1));
  return { data: data, engine: "IA · " + cfg.provider + " · " + cfg.model };
}
function laSections_(raw, c) {
  assert_(Array.isArray(raw) && raw.length >= 1 && raw.length <= 40, "Le document doit contenir entre 1 et 40 parties.");
  let total = 0;
  const out = raw.map(function (x) {
    const title = safeText_(laFill_(x && x.title, c), 200), body = String(laFill_(x && x.body, c) || "").replace(/\r/g, "").slice(0, 8000).trim();
    total += title.length + body.length;
    return { title: title, body: body };
  }).filter(function (x) { return x.title || x.body; });
  assert_(out.length && total <= 80000, "Document vide ou trop long.");
  return out;
}
function laWarnings_(arr) { return (Array.isArray(arr) ? arr : []).map(function (w) { return safeText_(w, 400); }).filter(Boolean).filter(function (w, i, a) { return a.indexOf(w) === i; }).slice(0, 12); }
function leaseFurnished_(l, prop) {
  const d = dbAll_("LeaseDocs").filter(function (x) { return String(x.leaseId) === String(l.leaseId) && x.docType === "LEASE_CONTRACT" && x.status !== "CANCELLED"; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })[0];
  if (d) return !!(parseJson_(d.inputsJson, {}) || {}).furnished;
  return parseJson_((prop || {}).equipmentJson, []).length >= 5;
}

/* ------------------------------ Contrat de bail ------------------------------ */
function laContractInputs_(a) {
  const clauses = (Array.isArray(a.clauses) ? a.clauses : String(a.clauses || "").split(",")).map(function (x) { return String(x).trim(); }).filter(function (x) { return LA_CLAUSES_.indexOf(x) >= 0; });
  return { furnished: bool_(a.furnished), usage: oneOf_(a.usage || "HABITATION", ["HABITATION", "MIXED"], "Usage"), clauses: clauses.filter(function (x, i, arr) { return arr.indexOf(x) === i; }),
    instructions: safeText_(a.instructions, 1500) };
}
/** Avertissements juridiques calculés (indépendants de l'IA). */
function laContractWarnings_(c, inp) {
  const w = ["Modèle généré automatiquement : faites-le relire par un professionnel (avocat, notaire ou adoul selon le cas) avant signature. DarPilot ne garantit pas sa conformité juridique."];
  const l = c.l, rent = num_(l.monthlyRent), dep = num_(l.deposit), months = l.endDate ? diffDays_(l.startDate, addDaysStr_(l.endDate, 1)) / 30.44 : null;
  if (IMMO_EDITION_ === "MA") {
    if (num_(l.indexationRate) > 0) w.push("Le bail prévoit une indexation annuelle de " + num_(l.indexationRate) + " % : au Maroc, la loi n° 67-12 (articles 31 à 38) ne permet de réviser le loyer qu'au plus tôt tous les trois ans, dans la limite de " + (inp.usage === "MIXED" ? "8 % (habitation) et 10 % (autres locaux)" : "8 % pour l'habitation") + ". Le contrat reprend la règle légale ; ajustez l'indexation du bail dans DarPilot.");
    w.push("Faites signer le contrat en deux exemplaires et légaliser les signatures pour lui donner date certaine.");
  } else {
    const maxDep = inp.furnished ? 2 : 1;
    if (rent > 0 && dep > rent * maxDep + 0.01) w.push("Dépôt de garantie de " + laMoney_(dep) + " : la loi limite le dépôt à " + maxDep + " mois de loyer hors charges pour un logement " + (inp.furnished ? "meublé" : "vide") + ".");
    if (months !== null && months < (inp.furnished ? 11.9 : 35.9)) w.push("Durée de " + Math.round(months) + " mois : la durée minimale est de " + (inp.furnished ? "1 an pour un meublé (9 mois pour un étudiant)" : "3 ans pour un logement vide loué par un particulier (6 ans par une société)") + ".");
    w.push("Annexez les diagnostics obligatoires (dossier de diagnostic technique) et la notice d'information prévue par l'arrêté du 29 mai 2015.");
  }
  if (!c.t.email) w.push("Le locataire n'a pas d'adresse e-mail : l'envoi par e-mail du contrat et des quittances sera impossible.");
  return w;
}
function laClauseText_(code, inp, ma) {
  return {
    INSURANCE_REQUIRED: "Le locataire est tenu de s'assurer contre les risques dont il doit répondre en sa qualité de locataire (notamment incendie, dégâts des eaux, explosion) et d'en justifier à la remise des clés puis à chaque demande du bailleur.",
    SUBLET_FORBIDDEN: "Le locataire ne peut ni sous-louer tout ou partie du logement, ni céder le présent bail, sans l'accord écrit et préalable du bailleur.",
    PETS_ALLOWED: "La détention d'animaux domestiques est autorisée, sous réserve qu'ils ne causent ni dégât ni trouble de voisinage.",
    PETS_FORBIDDEN: ma ? "La détention d'animaux est interdite dans le logement, sauf accord écrit du bailleur." : "La détention d'animaux domestiques est autorisée dans les limites prévues par la loi ; elle ne doit causer ni dégât ni trouble de voisinage.",
    NO_SMOKING: "Il est convenu que le logement est non-fumeur : le locataire s'engage à ne pas fumer à l'intérieur des locaux.",
    GUARANTOR: "Les obligations du locataire sont garanties par une caution solidaire, qui s'engage par un acte de cautionnement distinct, annexé au présent contrat.",
    WORKS_AUTH_REQUIRED: "Le locataire ne peut effectuer aucune transformation des lieux, des équipements ou de la distribution des pièces sans l'accord écrit du bailleur ; les simples aménagements restent permis."
  }[code] || "";
}
/** Désignation détaillée du logement (texte), commune au contrat intégré et au bloc [bien] des modèles. */
function laPropertyLines_(prop, furnished, ma, markers) {
  const rooms = parseJson_(prop.roomsJson, []), equip = parseJson_(prop.equipmentJson, []), L = [];
  if (prop.propertyType) L.push("Nature du bien : " + st_label_(prop.propertyType) + ".");
  // markers : trame transmise à l'IA → l'adresse et la description restent des marqueurs, remplacés après (laFill_).
  L.push("Adresse : " + (markers ? "[ADRESSE_DU_BIEN]" : (rentAddress_(prop) || prop.name || "____________________")) + ".");
  const pos = [!markers && prop.building ? "bâtiment / résidence " + prop.building : "", prop.floor !== "" && prop.floor != null ? "étage " + prop.floor : "", !markers && prop.doorNumber ? "porte " + prop.doorNumber : ""].filter(String);
  if (pos.length) L.push("Situation dans l'immeuble : " + pos.join(", ") + ".");
  L.push("Surface " + (ma ? "approximative" : "habitable") + " : " + (num_(prop.surfaceM2) ? num_(prop.surfaceM2) + " m²" : "______ m²") + ".");
  const comp = [num_(prop.bedrooms) ? num_(prop.bedrooms) + " chambre(s)" : "", num_(prop.bathrooms) ? num_(prop.bathrooms) + " salle(s) d'eau / de bain" : ""].filter(String);
  if (comp.length || rooms.length) L.push("Composition : " + comp.concat(rooms.map(function (r) { return typeof r === "object" ? (r.name || r.label || "") : String(r); }).filter(String)).join(", ") + ".");
  L.push("Destination : logement " + (furnished ? "meublé" : "non meublé (vide)") + (ma ? ", à usage d'habitation." : ", à usage d'habitation principale du locataire."));
  if (equip.length) L.push((furnished ? "Mobilier et équipements fournis" : "Équipements") + " : " + equip.join(", ") + (furnished ? " (détail et état dans l'inventaire annexé)." : "."));
  if (prop.description) L.push("Description : " + (markers ? "[DESCRIPTION_DU_BIEN]" : safeText_(prop.description, 1500)));
  return L;
}
/** Contrat rédigé par le modèle intégré (édition Maroc ou France), meublé ou vide. */
function laContractTemplate_(c, inp) {
  const l = c.l, prop = c.prop, ma = IMMO_EDITION_ === "MA", fu = !!inp.furnished, rent = num_(l.monthlyRent), ch = num_(l.charges), dep = num_(l.deposit);
  const usage = inp.usage === "MIXED" ? "à usage mixte d'habitation et professionnel" : "à usage d'habitation";
  const S = [];
  const add = function (t, b) { S.push({ title: "Article " + (S.length + 1) + " — " + t, body: b }); };
  const months = l.endDate ? Math.max(1, Math.round(diffDays_(l.startDate, addDaysStr_(l.endDate, 1)) / 30.44)) : 0;
  add("Objet et régime juridique", "Le bailleur, [BAILLEUR], donne en location au locataire, [LOCATAIRE], qui accepte, le logement désigné à l'article 2, " + usage + ", " + (fu ? "meublé" : "non meublé (vide)") + ".\n\n" +
    (ma ? "Le présent contrat est régi par la loi n° 67-12 régissant les rapports contractuels entre les bailleurs et les locataires des locaux à usage d'habitation ou à usage professionnel (dahir n° 1-13-111 du 19 novembre 2013) et, pour ce qu'elle ne prévoit pas, par le Dahir formant Code des obligations et des contrats. Conformément à cette loi, il est établi par écrit et revêt date certaine (signatures légalisées)."
      : "Le présent contrat est régi par la loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs" + (fu ? ", notamment son titre Ier bis relatif aux logements meublés loués à titre de résidence principale" : "") + ", et établi selon le contrat type défini par le décret n° 2015-587 du 29 mai 2015."));
  add("Désignation du logement", laPropertyLines_(prop, fu, ma, true).join("\n") + "\n\nLe locataire déclare bien connaître les lieux pour les avoir visités. " +
    (ma ? "Un état des lieux écrit, daté et détaillé est établi contradictoirement à l'entrée et à la sortie du locataire ; il est annexé au présent contrat."
      : "Un état des lieux contradictoire est établi lors de la remise des clés et lors de leur restitution" + (fu ? ", ainsi qu'un inventaire et un état détaillé du mobilier ; le logement comporte au minimum les éléments de mobilier prévus par le décret n° 2015-981 du 31 juillet 2015" : "") + "."));
  if (ma) add("Durée", "Le présent bail prend effet le " + pdfDate_(l.startDate) + (months ? " pour une durée de " + months + " mois, soit jusqu'au " + pdfDate_(l.endDate) + "." : " pour une durée indéterminée.") +
    "\n\nConformément à la loi n° 67-12, le bail ne prend fin que par un congé donné et, le cas échéant, validé dans les conditions prévues par la loi (voir l'article « Congé, préavis et formes de notification »).");
  else add("Durée", "Le présent bail prend effet le " + pdfDate_(l.startDate) + (months ? " pour une durée de " + months + " mois, soit jusqu'au " + pdfDate_(l.endDate) + "." : ".") + "\n\n" +
    (fu ? "La durée d'un bail meublé est d'au moins un an (neuf mois, non reconductibles, lorsque le locataire est étudiant). À défaut de congé, il est reconduit tacitement pour un an."
      : "La durée d'un bail vide est d'au moins trois ans lorsque le bailleur est une personne physique (ou une société civile familiale) et de six ans lorsqu'il est une personne morale. À défaut de congé, il est reconduit tacitement pour la même durée."));
  add("Loyer et paiement", "Le loyer mensuel est fixé à " + laMoney_(rent) + (ch > 0 ? " hors charges" : "") + ".\n\nIl est payable d'avance, au plus tard le " + (num_(l.dueDay) || 5) + " de chaque mois, par virement, carte bancaire ou tout autre moyen convenu. " +
    "Un appel de loyer est adressé au locataire avant chaque échéance ; le bailleur lui remet gratuitement une quittance détaillant le loyer et les charges pour chaque paiement intégral" + (ma ? " (article 11 de la loi n° 67-12)." : "."));
  add("Charges et consommations", (ch > 0 ? "En sus du loyer, le locataire verse chaque mois une provision pour charges de " + laMoney_(ch) +
      (ma ? ", destinée aux charges communes prévues au présent contrat (entretien des parties communes, gardiennage, ascenseur le cas échéant)." : fu ? ", sous forme de provision régularisée chaque année sur justificatifs (ou de forfait si les parties l'ont expressément convenu)." : " ; elle fait l'objet d'une régularisation annuelle sur justificatifs, les pièces étant tenues à la disposition du locataire.") + "\n\n" : "") +
    "Les consommations individuelles (eau, électricité, gaz, téléphone, internet) sont à la charge du locataire, qui souscrit les abonnements correspondants, sauf accord contraire écrit.");
  add("Révision du loyer", ma ? "Conformément aux articles 31 à 38 de la loi n° 67-12, le loyer ne peut être révisé qu'au terme d'une période d'au moins trois ans à compter de sa dernière fixation, et l'augmentation ne peut excéder 8 % pour un local à usage d'habitation" + (inp.usage === "MIXED" ? " (10 % pour la partie à usage professionnel)" : "") + ". À défaut d'accord entre les parties, la révision est fixée par le tribunal compétent."
    : (num_(l.indexationRate) > 0 ? "Le loyer est révisé chaque année à la date anniversaire du bail selon la variation de l'indice de référence des loyers (IRL) publié par l'INSEE, l'indice de référence étant celui du dernier trimestre connu à la date de signature du bail. La révision n'est pas rétroactive : le bailleur dispose d'un an pour la demander."
      : "Le présent bail ne comporte pas de clause de révision annuelle : le loyer n'est pas révisé en cours de bail."));
  add("Dépôt de garantie", (dep > 0 ? "Un dépôt de garantie de " + laMoney_(dep) + (rent > 0 ? " (soit " + Math.round(dep / rent * 10) / 10 + " mois de loyer)" : "") + " est versé à la signature. " : "Aucun dépôt de garantie n'est demandé. ") +
    (ma ? "Conformément à l'article 20 de la loi n° 67-12, son montant ne peut excéder deux mois de loyer. Il est restitué au locataire dans un délai d'un mois à compter de la remise des clés, déduction faite des sommes dont il serait redevable et dûment justifiées."
      : "Son montant ne peut excéder " + (fu ? "deux mois" : "un mois") + " de loyer hors charges. Il n'est pas productif d'intérêts et ne peut être imputé sur le dernier loyer. Il est restitué dans un délai d'un mois à compter de la remise des clés si l'état des lieux de sortie est conforme à celui d'entrée, de deux mois dans le cas contraire, déduction faite des sommes restant dues et justifiées ; à défaut, le solde est majoré de 10 % du loyer mensuel hors charges pour chaque mois de retard commencé."));
  add("Obligations des parties", "Le bailleur délivre un logement décent, en bon état d'usage et de réparation, avec les équipements prévus en bon état de fonctionnement ; il assure au locataire la jouissance paisible des lieux, les garantit contre les vices et défauts qui en empêchent l'usage, et effectue les réparations autres que locatives.\n\n" +
    "Le locataire paie le loyer et les charges aux termes convenus ; use paisiblement des lieux suivant leur destination ; répond des dégradations survenues pendant le bail, sauf vétusté, malfaçon, vice de construction, cas fortuit ou force majeure ; prend à sa charge l'entretien courant et les réparations locatives ; " +
    "ne transforme pas les lieux sans l'accord écrit du bailleur ; et laisse exécuter les travaux nécessaires." + (ma ? "" : " Il s'assure contre les risques locatifs et en justifie chaque année."));
  // Congé : délais légaux et formes de notification (cœur de la demande).
  if (ma) add("Congé, préavis et formes de notification",
    "Congé donné par le locataire : le locataire peut mettre fin au bail à tout moment en respectant un préavis d'un (1) mois. Le loyer et les charges restent dus jusqu'à l'expiration du préavis.\n\n" +
    "Congé donné par le bailleur : conformément aux articles 44 à 52 de la loi n° 67-12, le bailleur ne peut donner congé que pour l'un des motifs prévus par la loi (notamment la reprise du logement pour y habiter lui-même ou y loger un proche dans les conditions légales, la démolition ou des travaux importants nécessitant l'évacuation des lieux, ou un manquement grave du locataire). " +
    "Le congé est écrit, motivé, porte sur la totalité des lieux et accorde au locataire un délai d'au moins deux (2) mois à compter de sa notification. Il ouvre droit, le cas échéant, aux indemnités prévues par la loi et, à défaut d'exécution, doit être validé par le tribunal.\n\n" +
    "Forme : tout congé est notifié par écrit avec date certaine — par l'intermédiaire d'un commissaire judiciaire (huissier de justice) conformément aux articles 37 à 39 du Code de procédure civile, par lettre recommandée avec accusé de réception, ou par remise en main propre contre décharge datée et signée. Le délai court à compter de la réception.");
  else add("Congé, préavis et formes de notification",
    "Congé donné par le locataire : le locataire peut donner congé à tout moment. Le préavis est " + (fu ? "d'un (1) mois." : "de trois (3) mois ; il est réduit à un (1) mois lorsque le logement est situé en zone tendue, ou en cas d'obtention d'un premier emploi, de mutation, de perte d'emploi ou de nouvel emploi consécutif à une perte d'emploi, d'état de santé justifiant un changement de domicile, pour le bénéficiaire du RSA ou de l'AAH, ou en cas d'attribution d'un logement social ; le locataire précise alors le motif et le justifie lors de l'envoi du congé.") +
    " Le loyer et les charges restent dus pendant le préavis, sauf si le logement est reloué plus tôt avec l'accord du bailleur.\n\n" +
    "Congé donné par le bailleur : le bailleur ne peut donner congé que pour le terme du bail, avec un préavis de " + (fu ? "trois (3) mois" : "six (6) mois") + ", et uniquement pour reprendre le logement afin d'y habiter ou d'y loger un proche dans les conditions légales, pour le vendre" + (fu ? "" : " (le locataire bénéficiant alors d'un droit de préemption)") + ", ou pour un motif légitime et sérieux, notamment l'inexécution par le locataire de l'une de ses obligations. Le congé indique son motif." +
    (fu ? "" : " Le locataire âgé de plus de 65 ans et aux ressources modestes bénéficie de la protection prévue par l'article 15 III de la loi.") + "\n\n" +
    "Forme : le congé est notifié par lettre recommandée avec demande d'avis de réception, par acte de commissaire de justice, ou par remise en main propre contre récépissé ou émargement. Le délai de préavis court à compter du jour de la réception de la lettre, de la signification de l'acte ou de la remise en main propre.");
  inp.clauses.forEach(function (k) { const tx = laClauseText_(k, inp, ma); if (tx) add({ INSURANCE_REQUIRED: "Assurance", SUBLET_FORBIDDEN: "Sous-location et cession", PETS_ALLOWED: "Animaux", PETS_FORBIDDEN: "Animaux", NO_SMOKING: "Logement non-fumeur", GUARANTOR: "Cautionnement", WORKS_AUTH_REQUIRED: "Travaux et transformations" }[k], tx); });
  if (inp.clauses.indexOf("SUBLET_FORBIDDEN") < 0) add("Sous-location et cession", ma ? "Conformément à l'article 39 de la loi n° 67-12, toute sous-location ou cession du bail est interdite, sauf accord écrit du bailleur établi par acte à date certaine." : "Toute sous-location ou cession du bail est interdite sans l'accord écrit du bailleur, y compris sur le prix du loyer.");
  if (!ma && inp.clauses.indexOf("INSURANCE_REQUIRED") < 0) add("Assurance", laClauseText_("INSURANCE_REQUIRED", inp, ma));
  add("Défaut de paiement et clause résolutoire", ma ? "En cas de non-paiement du loyer ou des charges à leur échéance, le bailleur adresse au locataire une mise en demeure de payer lui accordant un délai qui ne peut être inférieur à quinze (15) jours. À défaut de paiement dans ce délai, le bailleur peut engager les procédures prévues par la loi n° 67-12 pour obtenir le paiement des sommes dues et, le cas échéant, la résiliation du bail et l'expulsion."
    : "À défaut de paiement du loyer ou des charges aux termes convenus, ou de versement du dépôt de garantie, le bail est résilié de plein droit six (6) semaines après un commandement de payer demeuré infructueux, dans les conditions de l'article 24 de la loi du 6 juillet 1989. Il en est de même à défaut d'assurance des risques locatifs, un mois après un commandement demeuré infructueux.");
  const special = [l.terms, inp.instructions].filter(function (x) { return String(x || "").trim(); }).join("\n\n");
  if (special) add("Conditions particulières", special);
  add(ma ? "Élection de domicile et litiges" : "Élection de domicile", ma ? "Pour l'exécution des présentes, le bailleur élit domicile à son adresse et le locataire dans les lieux loués. Tout litige relatif au présent contrat relève du tribunal compétent du lieu de situation du logement."
    : "Pour l'exécution des présentes, le bailleur élit domicile à son adresse et le locataire dans les lieux loués.");
  add("Annexes", "Sont annexés au présent contrat : l'état des lieux d'entrée" + (fu ? ", l'inventaire et l'état détaillé du mobilier" : "") + (inp.clauses.indexOf("GUARANTOR") >= 0 ? ", l'acte de cautionnement" : "") +
    (ma ? " et une copie des pièces d'identité des parties." : ", la notice d'information prévue par l'arrêté du 29 mai 2015, le dossier de diagnostic technique (diagnostic de performance énergétique, état des risques, et selon le cas constat de risque d'exposition au plomb, diagnostics électricité, gaz et amiante) et, le cas échéant, les extraits du règlement de copropriété."));
  return { title: fu ? "Contrat de location meublée" : "Contrat de location non meublée (logement vide)", sections: S };
}
function st_label_(code) { return ({ APARTMENT: "appartement", VILLA: "villa", RIAD: "riad", STUDIO: "studio", HOUSE: "maison", DUPLEX: "duplex", ROOM: "chambre", OFFICE: "bureau" })[String(code || "").toUpperCase()] || String(code || "").toLowerCase(); }

function laContractAi_(c, inp, base) {
  const ma = IMMO_EDITION_ === "MA";
  const system = "Tu es l'agent de rédaction juridique d'DarPilot, logiciel de gestion locative (" + edition_().countryName + "). Tu rédiges en français un contrat de location " +
    (inp.furnished ? "meublée" : "vide") + " conforme au " + edition_().leaseLaw + ".\nRègles impératives :\n" +
    "- Pars de la TRAME fournie (déjà conforme) et améliore-la : clarté, articles complets, consignes de l'utilisateur intégrées. Garde tous les articles utiles de la trame.\n" +
    "- Utilise UNIQUEMENT les faits fournis. N'invente aucun montant, aucune date, aucun nom, aucune adresse.\n" +
    "- Pour les identités et l'adresse, écris exactement les marqueurs [BAILLEUR], [LOCATAIRE], [ADRESSE_DU_BIEN], [VILLE].\n" +
    "- Ne cite un numéro d'article de loi que si tu es certain qu'il existe et qu'il est pertinent ; sinon renvoie à « la loi ».\n" +
    (ma ? "- Maroc : la loi n° 67-12 (articles 31 à 38) limite la révision du loyer d'habitation à une fois tous les 3 ans au plus tôt et à 8 % au maximum (10 % pour les autres locaux). N'écris jamais d'indexation annuelle.\n" : "- France : respecte les durées minimales, le plafond du dépôt de garantie (1 mois vide, 2 mois meublé, hors charges) et la révision annuelle selon l'IRL.\n") +
    "- Si une consigne de l'utilisateur est contraire à la loi ou abusive, ne l'applique pas et explique-le dans « warnings ».\n" +
    "- Pas de Markdown. Paragraphes séparés par une ligne vide. Titres sous la forme « Article N — Intitulé ».\n" +
    "Réponds UNIQUEMENT par un objet JSON : {\"title\": string, \"sections\": [{\"title\": string, \"body\": string}], \"warnings\": [string]}.";
  const payload = { faits: laFacts_(c), options: { meuble: inp.furnished, usage: inp.usage === "MIXED" ? "mixte habitation et professionnel" : "habitation", clauses: inp.clauses },
    consignesUtilisateur: inp.instructions || "", trame: base.sections };
  delete payload.faits.conditionsParticulieres;
  payload.conditionsParticulieresDuBail = c.l.terms || "";
  return laAiJson_(c.l.organizationId, system, payload, LA_LIMITS_.contractTokens);
}

/* ------------------------------ Courriers ------------------------------ */
function laLetterInputs_(a) {
  const o = { subtype: oneOf_(a.subtype || "FREE", LA_LETTER_TYPES_, "Type de courrier"), subject: safeText_(a.subject, 150), instructions: safeText_(a.instructions, 1500) };
  if (a.newRent !== undefined && a.newRent !== "") o.newRent = money_(a.newRent, "Nouveau loyer", { min: 1 });
  if (a.effectiveDate) o.effectiveDate = dateOnly_(a.effectiveDate, "Date d'effet");
  if (a.newEndDate) o.newEndDate = dateOnly_(a.newEndDate, "Nouvelle date de fin");
  if (a.deductions !== undefined && a.deductions !== "") o.deductions = money_(a.deductions, "Retenues");
  if (a.deductionReason) o.deductionReason = safeText_(a.deductionReason, 600);
  if (o.subtype === "FREE") assert_(o.subject || o.instructions, "Indiquez l'objet ou le contenu souhaité du courrier.");
  return o;
}
function laLetterWarnings_(c, inp) {
  const w = [], l = c.l, rent = num_(l.monthlyRent);
  if (inp.subtype === "RENT_REVISION" && inp.newRent && IMMO_EDITION_ === "MA") {
    if (inp.newRent > rent * 1.08 + 0.01) w.push("Hausse de " + Math.round((inp.newRent / rent - 1) * 1000) / 10 + " % : la loi n° 67-12 la limite à 8 % pour un logement d'habitation.");
    const since = inp.effectiveDate || todayStr_();
    if (diffDays_(l.startDate, since) < 3 * 365) w.push("Moins de trois ans depuis le début du bail : la loi n° 67-12 ne permet pas encore de réviser le loyer (sauf décision de justice).");
  }
  if (!c.t.email) w.push("Le locataire n'a pas d'adresse e-mail : le courrier devra lui être remis en main propre ou envoyé par voie postale.");
  return w;
}
function laLetterTemplate_(c, inp) {
  const l = c.l, held = leaseDepositHeld_(l.leaseId), today = todayStr_(), ma = IMMO_EDITION_ === "MA";
  const S = [], add = function (t, b) { S.push({ title: t, body: b }); };
  if (inp.subtype === "RENEWAL") {
    const start = l.endDate ? addDaysStr_(l.endDate, 1) : today, end = inp.newEndDate || addDaysStr_(addMonthsStr_(start, 12), -1);
    add("Objet : proposition de renouvellement du bail", "Madame, Monsieur,\n\nLe bail du logement situé [ADRESSE_DU_BIEN] arrive à échéance le " + pdfDate_(l.endDate || today) + ". Nous avons le plaisir de vous proposer son renouvellement du " +
      pdfDate_(start) + " au " + pdfDate_(end) + ", pour un loyer mensuel de " + laMoney_(inp.newRent || l.monthlyRent) + (num_(l.charges) ? " et une provision pour charges de " + laMoney_(l.charges) : "") + ", les autres conditions du bail restant inchangées.\n\n" +
      "Nous vous remercions de nous faire part de votre réponse avant le " + pdfDate_(addDaysStr_(today, 30)) + "." + (inp.instructions ? "\n\n" + inp.instructions : ""));
  } else if (inp.subtype === "RENT_REVISION") {
    add("Objet : révision du loyer", "Madame, Monsieur,\n\nConformément aux dispositions du bail et " + (ma ? "des articles 31 à 38 de la loi n° 67-12 relatifs à la révision du loyer" : "de l'article 17-1 de la loi du 6 juillet 1989 (indice de référence des loyers)") +
      ", nous vous informons que le loyer mensuel du logement situé [ADRESSE_DU_BIEN] est porté de " + laMoney_(l.monthlyRent) + " à " + laMoney_(inp.newRent || l.monthlyRent) + " à compter du " + pdfDate_(inp.effectiveDate || addMonthsStr_(today, 1)) + ".\n\n" +
      "Les autres conditions du bail demeurent inchangées." + (inp.instructions ? "\n\n" + inp.instructions : ""));
  } else if (inp.subtype === "DEPOSIT_RETURN") {
    const ded = num_(inp.deductions), ret = Math.max(0, round2_(held - ded));
    add("Objet : décompte et restitution du dépôt de garantie", "Madame, Monsieur,\n\nÀ la suite de la fin du bail et de l'état des lieux de sortie du logement situé [ADRESSE_DU_BIEN], voici le décompte de votre dépôt de garantie :\n\n" +
      "Dépôt de garantie détenu : " + laMoney_(held) + "\nRetenues : " + laMoney_(ded) + (inp.deductionReason ? " (" + inp.deductionReason + ")" : "") + "\nMontant restitué : " + laMoney_(ret) + "\n\n" +
      (ded > 0 ? "Les retenues sont justifiées par les pièces jointes (devis, factures ou état des lieux), compte tenu de l'usure normale du logement.\n\n" : "") + "La somme restituée vous est versée par virement." + (inp.instructions ? "\n\n" + inp.instructions : ""));
  } else {
    add("Objet : " + (inp.subject || "information concernant votre location"), "Madame, Monsieur,\n\n" + (inp.instructions || "") );
  }
  add("", "Nous restons à votre disposition pour toute question.\n\nVeuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.\n\n[BAILLEUR]");
  return { title: { RENEWAL: "Proposition de renouvellement du bail", RENT_REVISION: "Notification de révision du loyer", DEPOSIT_RETURN: "Restitution du dépôt de garantie", FREE: inp.subject || "Courrier au locataire" }[inp.subtype], sections: S };
}
function laLetterAi_(c, inp, base) {
  const system = "Tu es l'agent de rédaction d'DarPilot (" + edition_().countryName + ", " + edition_().leaseLaw + "). Rédige en français un courrier du bailleur au locataire, courtois, précis et bref.\n" +
    "- Utilise uniquement les faits fournis ; n'invente aucun montant, date ni nom ; marqueurs [BAILLEUR], [LOCATAIRE], [ADRESSE_DU_BIEN], [VILLE] pour les identités et l'adresse.\n" +
    "- Si la demande est contraire à la loi, n'applique pas la partie concernée et explique-le dans « warnings ».\n" +
    "- Pas de Markdown. Réponds UNIQUEMENT en JSON : {\"title\": string, \"sections\": [{\"title\": string, \"body\": string}], \"warnings\": [string]} (1 à 3 sections, la première commence par « Objet : »).";
  const facts = laFacts_(c); delete facts.equipements; delete facts.pieces;
  return laAiJson_(c.l.organizationId, system, { typeDeCourrier: inp.subtype, faits: facts, depotDetenu: leaseDepositHeld_(c.l.leaseId), donnees: { nouveauLoyer: inp.newRent || null, dateEffet: inp.effectiveDate || null,
    nouvelleFin: inp.newEndDate || null, retenues: inp.deductions || null, motifRetenues: inp.deductionReason || null, objet: inp.subject || null }, consignesUtilisateur: inp.instructions || "", trame: base.sections }, LA_LIMITS_.letterTokens);
}

/* ------------------------------ Routes : documents rédigés ------------------------------ */
function leaseDocOut_(d, full) {
  const o = { leaseDocId: d.leaseDocId, leaseId: d.leaseId, docType: d.docType, subtype: d.subtype, status: d.status, title: d.title, engine: d.engine, documentId: d.documentId,
    createdAt: d.createdAt, updatedAt: d.updatedAt, finalizedAt: d.finalizedAt, sentAt: d.sentAt, sentTo: d.sentTo };
  if (full) { o.sections = parseJson_(d.sectionsJson, []); o.warnings = parseJson_(d.warningsJson, []); o.inputs = parseJson_(d.inputsJson, {}); }
  return o;
}
function leaseDocsOf_(leaseId, finalOnly) {
  return dbAll_("LeaseDocs").filter(function (d) { return String(d.leaseId) === String(leaseId) && d.status !== "CANCELLED" && (!finalOnly || d.status === "FINAL"); })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).map(function (d) { return leaseDocOut_(d, false); });
}
function leaseDocLoad_(p, id, cap) {
  const d = dbGet_("LeaseDocs", safeText_(id, 120)); if (!d || d.status === "CANCELLED") notFound_("Document");
  const c = laCtx_(p, d.leaseId, cap);
  if (c.self) assert_(d.status === "FINAL", "Document non disponible.", "FORBIDDEN");
  return { d: d, c: c };
}
/** Rédaction d'un brouillon : IA si configurée, sinon modèle intégré. */
function leaseDocDraft_(p, a) {
  const c = laCtx_(p, a.leaseId, "lease.manage"), docType = oneOf_(a.docType || "LEASE_CONTRACT", ["LEASE_CONTRACT", "LETTER"], "Type de document");
  const inp = docType === "LEASE_CONTRACT" ? laContractInputs_(a) : laLetterInputs_(a);
  const base = docType === "LEASE_CONTRACT" ? laContractTemplate_(c, inp) : laLetterTemplate_(c, inp);
  let title = base.title, sections = laSections_(base.sections, c), warnings = docType === "LEASE_CONTRACT" ? laContractWarnings_(c, inp) : laLetterWarnings_(c, inp), engine = "MODELE";
  if (a.useAi !== false) {
    try {
      const r = docType === "LEASE_CONTRACT" ? laContractAi_(c, inp, base) : laLetterAi_(c, inp, base);
      if (r) { sections = laSections_(r.data.sections, c); title = safeText_(laFill_(r.data.title, c), 200) || title; warnings = warnings.concat(laWarnings_(r.data.warnings)); engine = r.engine; }
    } catch (e) {
      console.error("Agent IA (" + docType + ") : " + e.message);
      warnings.push("L'agent IA n'a pas pu rédiger ce document (" + String(e.message).slice(0, 120) + ") : le modèle intégré a été utilisé.");
    }
  }
  const d = dbInsert_("LeaseDocs", { organizationId: c.l.organizationId, propertyId: c.l.propertyId, leaseId: c.l.leaseId, docType: docType, subtype: inp.subtype || "", status: "DRAFT", title: title,
    inputsJson: inp, sectionsJson: sections, warningsJson: laWarnings_(warnings), engine: engine, createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("LEASE_DOC_DRAFTED", "Lease", c.l.leaseId, c.l.organizationId, { leaseDocId: d.leaseDocId, docType: docType, engine: engine });
  return leaseDocOut_(dbGet_("LeaseDocs", d.leaseDocId), true);
}
function leaseDocGet_(p, a) { const x = leaseDocLoad_(p, a.leaseDocId, "lease.view"); return leaseDocOut_(x.d, true); }
function leaseDocUpdate_(p, a) {
  const x = leaseDocLoad_(p, a.leaseDocId, "lease.manage");
  assert_(x.d.status === "DRAFT", "Document validé : créez une nouvelle version pour le modifier.");
  const patch = { updatedAt: nowIso_(), updatedBy: p.email };
  if (a.title !== undefined) patch.title = reqText_(a.title, "Titre", 2, 200);
  if (a.sections !== undefined) patch.sectionsJson = laSections_(a.sections, x.c);
  dbUpdate_("LeaseDocs", x.d.leaseDocId, patch);
  return leaseDocOut_(dbGet_("LeaseDocs", x.d.leaseDocId), true);
}
function leaseDocHtml_(c, d) {
  const sections = parseJson_(d.sectionsJson, []), draft = d.status !== "FINAL", ma = IMMO_EDITION_ === "MA", t = c.t, org = c.org, prop = c.prop;
  let inner = draft ? "<div class='box' style='border-color:#e9b341;background:#fff8e6'><b>PROJET — document non validé, à relire avant signature.</b></div>" : "";
  if (d.docType === "LEASE_CONTRACT") {
    inner += "<h2>Entre les soussignés</h2><table><tr><th style='width:50%'>Le bailleur</th><th>Le locataire</th></tr><tr><td><b>" + escapeHtml_(org.name || "") + "</b><br>" +
      escapeHtml_([org.address, org.city].filter(String).join(", ") || "Adresse : ____________________") + "<br>" + escapeHtml_(org.phone ? "Tél. " + org.phone : "") + "</td><td><b>" + escapeHtml_(t.fullName || "") + "</b><br>" +
      (t.nationality ? "Nationalité : " + escapeHtml_(t.nationality) + "<br>" : "") + "Pièce d'identité : " + escapeHtml_(t.idType ? ({ CIN: "CIN", CNI: "CNI", PASSPORT: "Passeport", RESIDENCE_PERMIT: "Titre de séjour", DRIVING_LICENSE: "Permis de conduire" }[t.idType] || t.idType) : "____") +
      " n° " + (t.idNumber ? "<b>" + escapeHtml_(t.idNumber) + "</b>" + (t.idExpiry ? " (valable jusqu'au " + pdfDate_(t.idExpiry) + ")" : "") : "____________________") + "<br>" +
      (t.birthDate ? "Né(e) le " + pdfDate_(t.birthDate) + (t.birthPlace ? " à " + escapeHtml_(t.birthPlace) : "") + "<br>" : "") + (t.address ? "Domicile actuel : " + escapeHtml_(t.address) + "<br>" : "") +
      escapeHtml_([t.email, t.phone].filter(String).join(" · ")) + "</td></tr></table><p>Logement : <b>" + escapeHtml_(prop.name || "") + "</b> — " + escapeHtml_(rentAddress_(prop)) + "</p>";
  }
  sections.forEach(function (s) { inner += (s.title ? "<h2>" + escapeHtml_(s.title) + "</h2>" : "") + laParas_(s.body); });
  if (d.docType === "LEASE_CONTRACT") inner += "<p style='margin-top:16px'>Fait à " + escapeHtml_(prop.city || edition_().city) + ", le " + (draft ? "____________" : pdfDate_(String(d.finalizedAt || todayStr_()).slice(0, 10))) + ", en deux exemplaires originaux" + (ma ? "." : ", dont un remis à chaque partie.") + "</p>" +
    "<table class='sign'><tr><td><b>Le bailleur</b><br><span class='muted'>« Lu et approuvé », signature</span></td><td><b>Le locataire</b><br><span class='muted'>« Lu et approuvé », signature</span></td></tr></table>";
  else inner += "<p style='margin-top:16px'>Fait à " + escapeHtml_(prop.city || edition_().city) + ", le " + pdfDate_(todayStr_()) + ".</p>";
  return pdfShell_(d.title || "Document", inner, { subtitle: (prop.name || "") + (d.docType === "LETTER" ? " · à l'attention de " + (t.fullName || "") : ""), issuer: rentIssuer_(org), ref: (d.docType === "LEASE_CONTRACT" ? "BAIL-" : "COUR-") + String(d.leaseDocId || d.leaseId || "").slice(-8).toUpperCase(),
    footer: draft ? "PROJET — document établi via " + IMMO_CONFIG.APP_NAME + (d.engine && d.engine !== "MODELE" ? " (rédaction assistée par IA)" : "") + ". Modèle à faire relire par un professionnel ; DarPilot ne garantit pas sa conformité juridique."
      : d.docType === "LEASE_CONTRACT" ? "Paraphe du bailleur : __________          Paraphe du locataire : __________" : " " });
}
function leaseDocFileName_(d) { return (d.docType === "LEASE_CONTRACT" ? "Bail_" : "Courrier_") + String(d.leaseId).slice(-6) + "_" + todayStr_(); }
/** Aperçu PDF (brouillon marqué « PROJET ») ou PDF définitif déjà enregistré. */
function leaseDocPdf_(p, a) {
  const x = leaseDocLoad_(p, a.leaseDocId, "lease.view");
  if (x.d.status === "FINAL" && x.d.documentId) return docGet_(p, { documentId: x.d.documentId });
  const blob = htmlToPdf_(leaseDocHtml_(x.c, x.d), leaseDocFileName_(x.d) + "_projet");
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
/** Validation : PDF définitif enregistré dans les documents du bail ; le contrat devient le document du bail. */
function leaseDocFinalize_(p, a) {
  const x = leaseDocLoad_(p, a.leaseDocId, "lease.manage");
  assert_(x.d.status === "DRAFT", "Document déjà validé.");
  const d = Object.assign({}, x.d, { status: "FINAL", finalizedAt: nowIso_() });
  const blob = htmlToPdf_(leaseDocHtml_(x.c, d), leaseDocFileName_(d));
  const out = storeGeneratedPdf_(p, blob, { propertyId: x.c.l.propertyId, organizationId: x.c.l.organizationId }, "LEASE", x.c.l.leaseId, d.docType === "LEASE_CONTRACT" ? "CONTRACT" : "LETTER");
  dbUpdate_("LeaseDocs", d.leaseDocId, { status: "FINAL", finalizedAt: d.finalizedAt, finalizedBy: p.email, documentId: out.documentId, updatedAt: nowIso_(), updatedBy: p.email });
  if (d.docType === "LEASE_CONTRACT") dbUpdate_("Leases", x.c.l.leaseId, { documentId: out.documentId, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("LEASE_DOC_FINALIZED", "Lease", x.c.l.leaseId, x.c.l.organizationId, { leaseDocId: d.leaseDocId, docType: d.docType });
  return out;
}
function leaseDocCancel_(p, a) {
  const x = leaseDocLoad_(p, a.leaseDocId, "lease.manage");
  dbUpdate_("LeaseDocs", x.d.leaseDocId, { status: "CANCELLED", updatedAt: nowIso_(), updatedBy: p.email });
  audit_("LEASE_DOC_CANCELLED", "Lease", x.c.l.leaseId, x.c.l.organizationId, { leaseDocId: x.d.leaseDocId });
  return { ok: true };
}
/** Envoi par e-mail au locataire d'un document validé (PDF joint). */
function laSendStored_(p, c, documentId, subject, message, ownerKey) {
  const doc = dbGet_("Documents", documentId); assert_(doc && doc.status === "ACTIVE", "PDF introuvable : validez à nouveau le document.");
  rateLimit_("rentmail:" + p.userId, 60, 3600);
  const r = rentDeliver_({ c: c, kind: "DOCUMENT", trigger: "MANUAL", actor: p.email, documentId: documentId, uniqueKey: "",
    build: function () { const b = DriveApp.getFileById(doc.fileId).getBlob(); b.setName(doc.fileName); return b; },
    mail: function () { return rentMailText_(c, "DOCUMENT", { subject: subject, message: message }); }, category: "LETTER" });
  return rentDeliverResult_(r);
}
function leaseDocSend_(p, a) {
  const x = leaseDocLoad_(p, a.leaseDocId, "lease.manage");
  assert_(x.d.status === "FINAL" && x.d.documentId, "Validez d'abord le document.");
  const contract = x.d.docType === "LEASE_CONTRACT";
  const msg = safeText_(a.message, 2000) || (contract ? "Veuillez trouver ci-joint votre contrat de location pour le logement « " + (x.c.prop.name || "") + " ». Merci de le relire ; nous conviendrons ensemble de la date de signature." :
    "Veuillez trouver ci-joint notre courrier : « " + (x.d.title || "") + " ».");
  const out = laSendStored_(p, x.c, x.d.documentId, (contract ? "Votre contrat de location — " : "") + (x.d.title || "Document") + " — " + (x.c.prop.name || ""), msg);
  dbUpdate_("LeaseDocs", x.d.leaseDocId, { sentAt: nowIso_(), sentTo: out.sentTo });
  return out;
}

/* ------------------------------ États des lieux ------------------------------ */
function laRoomItems_(room, furnished) {
  const n = String(room || "").toLowerCase(), base = ["Sols", "Murs", "Plafond", "Portes", "Fenêtres et volets", "Éclairage et prises électriques"];
  let extra = [];
  if (/cuisine|kitchen/.test(n)) extra = ["Évier et robinetterie", "Plan de travail", "Placards", "Plaques de cuisson et four", "Réfrigérateur", "Hotte"];
  else if (/bain|douche|sdb|bathroom/.test(n)) extra = ["Lavabo et robinetterie", "Douche ou baignoire", "Carrelage et joints", "Miroir", "Ventilation", "Chauffe-eau"];
  else if (/wc|toilette/.test(n)) extra = ["Cuvette et chasse d'eau", "Lave-mains"];
  else if (/chambre|bedroom/.test(n)) extra = ["Placards et rangements"].concat(furnished ? ["Lit et literie", "Rideaux"] : []);
  else if (/séjour|sejour|salon|living/.test(n)) extra = ["Climatisation ou chauffage"].concat(furnished ? ["Canapé", "Table et chaises", "Rideaux"] : []);
  else if (/entr[ée]e|hall/.test(n)) extra = ["Porte d'entrée et serrure", "Interphone"];
  if (/terrasse|balcon|jardin|patio|piscine|ext[ée]rieur/.test(n)) return ["Sol", "Garde-corps", "Plantations", "Éclairage extérieur"].concat(/piscine/.test(n) ? ["Bassin et équipements"] : []);
  return base.concat(extra);
}
function laDefaultRooms_(prop, furnished) {
  let rooms = parseJson_(prop.roomsJson, []).filter(String);
  if (!rooms.length) rooms = ["Entrée", "Séjour", "Cuisine", "Chambre", "Salle de bain", "WC"];
  const out = rooms.slice(0, 30).map(function (r) { return { name: String(r).slice(0, 80), items: laRoomItems_(r, furnished).map(function (i) { return { name: i, condition: "", note: "" }; }), note: "", photoDocIds: [] }; });
  const equip = parseJson_(prop.equipmentJson, []);
  if (furnished && equip.length) out.push({ name: "Inventaire du mobilier et des équipements", items: equip.slice(0, 40).map(function (e) { return { name: String(e).slice(0, 80), condition: "", note: "" }; }), note: "", photoDocIds: [] });
  return out;
}
function laDefaultKeys_() { return [{ label: "Clés de la porte d'entrée", count: "" }, { label: "Clés de la boîte aux lettres", count: "" }, { label: "Badges ou télécommandes", count: "" }]; }
function inspectionOut_(r, full) {
  const o = { inspectionId: r.inspectionId, leaseId: r.leaseId, type: r.type, inspectionDate: r.inspectionDate, status: r.status, engine: r.engine, documentId: r.documentId,
    createdAt: r.createdAt, updatedAt: r.updatedAt, finalizedAt: r.finalizedAt, sentAt: r.sentAt, sentTo: r.sentTo };
  if (full) { o.rooms = parseJson_(r.roomsJson, []); o.meters = parseJson_(r.metersJson, {}); o.keys = parseJson_(r.keysJson, []); o.generalNote = r.generalNote; o.attendees = r.attendees; o.summary = parseJson_(r.summaryJson, null);
    o.tenantNewAddress = r.tenantNewAddress || ""; o.entryDate = r.entryDate || ""; o.metersEntry = parseJson_(r.metersEntryJson, {});
    o.signatures = { landlord: r.landlordSignDocId ? { name: r.landlordSignName, at: r.landlordSignedAt, documentId: r.landlordSignDocId } : null,
      tenant: r.tenantSignDocId ? { name: r.tenantSignName, at: r.tenantSignedAt, documentId: r.tenantSignDocId } : null }; }
  return o;
}
function inspectionsOf_(leaseId, finalOnly) {
  return dbAll_("LeaseInspections").filter(function (r) { return String(r.leaseId) === String(leaseId) && r.status !== "CANCELLED" && (!finalOnly || r.status === "FINAL"); })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).map(function (r) { return inspectionOut_(r, false); });
}
function inspectionLoad_(p, id, cap) {
  const r = dbGet_("LeaseInspections", safeText_(id, 120)); if (!r || r.status === "CANCELLED") notFound_("État des lieux");
  const c = laCtx_(p, r.leaseId, cap);
  if (c.self) assert_(r.status === "FINAL", "État des lieux non disponible.", "FORBIDDEN");
  return { r: r, c: c };
}
function inspectionEntryOf_(leaseId) {
  return dbAll_("LeaseInspections").filter(function (r) { return String(r.leaseId) === String(leaseId) && r.type === "ENTRY" && r.status === "FINAL"; })
    .sort(function (a, b) { return String(b.finalizedAt).localeCompare(String(a.finalizedAt)); })[0] || null;
}
function inspectionCreate_(p, a) {
  const c = laCtx_(p, a.leaseId, "inspection.manage"), type = oneOf_(a.type || "ENTRY", ["ENTRY", "EXIT"], "Type d'état des lieux");
  assert_(!dbAll_("LeaseInspections").some(function (r) { return String(r.leaseId) === String(c.l.leaseId) && r.type === type && r.status === "DRAFT"; }), "Un état des lieux de ce type est déjà en cours : ouvrez-le pour le compléter.", "CONFLICT");
  const furnished = leaseFurnished_(c.l, c.prop);
  let rooms = laDefaultRooms_(c.prop, furnished), keys = laDefaultKeys_();
  if (type === "EXIT") {
    const entry = inspectionEntryOf_(c.l.leaseId);
    if (entry) {
      rooms = parseJson_(entry.roomsJson, []).map(function (r) { return { name: r.name, items: (r.items || []).map(function (i) { return { name: i.name, condition: "", note: "", entry: i.condition || "", entryNote: i.note || "", entryPhotoDocIds: (i.photoDocIds || []).slice(0, 3) }; }), note: "", photoDocIds: [] }; });
      keys = parseJson_(entry.keysJson, []).map(function (k) { return { label: k.label, count: "", entry: k.count }; });
    }
  }
  const ent = type === "EXIT" ? inspectionEntryOf_(c.l.leaseId) : null;
  const r = dbInsert_("LeaseInspections", { organizationId: c.l.organizationId, propertyId: c.l.propertyId, leaseId: c.l.leaseId, type: type, inspectionDate: a.inspectionDate ? dateOnly_(a.inspectionDate, "Date") : todayStr_(),
    status: "DRAFT", roomsJson: rooms, metersJson: {}, keysJson: keys, generalNote: "", attendees: "", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email,
    entryDate: ent ? ent.inspectionDate : "", metersEntryJson: ent ? parseJson_(ent.metersJson, {}) : {} });
  audit_("INSPECTION_CREATED", "Lease", c.l.leaseId, c.l.organizationId, { inspectionId: r.inspectionId, type: type });
  return inspectionOut_(dbGet_("LeaseInspections", r.inspectionId), true);
}
function inspectionGet_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.view"), o = inspectionOut_(x.r, true);
  o.propertyName = x.c.prop.name; o.tenantName = x.c.t.fullName; o.canManage = canProp_(p, x.c.prop, "inspection.manage"); o.canLetter = canProp_(p, x.c.prop, "lease.manage"); o.ai = !!aiConfig_(); o.deposit = num_(x.c.l.deposit);
  return o;
}
function laCond_(v) { v = String(v || ""); return LA_CONDITIONS_.indexOf(v) >= 0 ? v : ""; }
function inspectionSave_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "inspection.manage");
  assert_(x.r.status === "DRAFT", "État des lieux validé : il ne peut plus être modifié.");
  const patch = { updatedAt: nowIso_(), updatedBy: p.email };
  if (a.inspectionDate) patch.inspectionDate = dateOnly_(a.inspectionDate, "Date");
  if (a.rooms !== undefined) {
    assert_(Array.isArray(a.rooms) && a.rooms.length <= 30, "30 pièces au maximum.");
    patch.roomsJson = a.rooms.map(function (r) {
      const items = (Array.isArray(r.items) ? r.items : []).slice(0, 40).map(function (i) { const o = { name: safeText_(i && i.name, 80), condition: laCond_(i && i.condition), note: safeText_(i && i.note, 500),
          photoDocIds: assertDocsOf_((i && i.photoDocIds) || [], "LEASE", x.r.leaseId).slice(0, 3) };
        if (i && i.entry !== undefined) { o.entry = laCond_(i.entry); o.entryNote = safeText_(i.entryNote, 500); o.entryPhotoDocIds = Array.isArray(i.entryPhotoDocIds) ? i.entryPhotoDocIds.slice(0, 3).map(function (d) { return safeText_(d, 80); }) : []; }
        if (x.r.type === "EXIT") { // retenue sur le dépôt : coût de remise en état × (1 − vétusté)
          const cost = i && i.repairCost !== "" && i.repairCost != null ? Number(i.repairCost) : 0, wear = i && i.wearPct !== "" && i.wearPct != null ? Number(i.wearPct) : 0;
          if (cost > 0) { assert_(isFinite(cost) && cost <= 1e6, "Coût de remise en état invalide."); assert_(isFinite(wear) && wear >= 0 && wear <= 100, "Vétusté : de 0 à 100 %."); o.repairCost = round2_(cost); o.wearPct = Math.round(wear); }
        }
        return o; }).filter(function (i) { return i.name; });
      return { name: reqText_(r && r.name, "Nom de la pièce", 1, 80), items: items, note: safeText_(r && r.note, 1000), photoDocIds: assertDocsOf_((r && r.photoDocIds) || [], "LEASE", x.r.leaseId).slice(0, 12) };
    });
  }
  if (a.meters !== undefined) { const m = a.meters || {}; patch.metersJson = { electricity: safeText_(m.electricity, 40), water: safeText_(m.water, 40), gas: safeText_(m.gas, 40), other: safeText_(m.other, 120) }; }
  if (a.keys !== undefined) patch.keysJson = (Array.isArray(a.keys) ? a.keys : []).slice(0, 12).map(function (k) { const o = { label: safeText_(k && k.label, 80), count: k && k.count !== "" && k.count != null ? Math.max(0, Math.min(99, parseInt(k.count, 10) || 0)) : "" };
    if (k && k.entry !== undefined) o.entry = k.entry; return o; }).filter(function (k) { return k.label; });
  if (a.generalNote !== undefined) patch.generalNote = safeText_(a.generalNote, 3000);
  if (a.attendees !== undefined) patch.attendees = safeText_(a.attendees, 300);
  if (a.tenantNewAddress !== undefined) patch.tenantNewAddress = safeText_(a.tenantNewAddress, 300);
  if (a.summary !== undefined) patch.summaryJson = laSummaryClean_(a.summary, x.c);
  // Toute modification après signature annule les signatures (elles doivent porter sur la version définitive).
  if (x.r.landlordSignDocId || x.r.tenantSignDocId) {
    const before = JSON.stringify([parseJson_(x.r.roomsJson, []), parseJson_(x.r.metersJson, {}), parseJson_(x.r.keysJson, []), x.r.generalNote || "", x.r.attendees || "", x.r.tenantNewAddress || "", String(x.r.inspectionDate || "")]);
    const after = JSON.stringify([patch.roomsJson || parseJson_(x.r.roomsJson, []), patch.metersJson || parseJson_(x.r.metersJson, {}), patch.keysJson || parseJson_(x.r.keysJson, []),
      patch.generalNote !== undefined ? patch.generalNote : x.r.generalNote || "", patch.attendees !== undefined ? patch.attendees : x.r.attendees || "",
      patch.tenantNewAddress !== undefined ? patch.tenantNewAddress : x.r.tenantNewAddress || "", String(patch.inspectionDate || x.r.inspectionDate || "")]);
    if (before !== after) Object.assign(patch, { landlordSignDocId: "", landlordSignName: "", landlordSignedAt: "", tenantSignDocId: "", tenantSignName: "", tenantSignedAt: "" });
  }
  dbUpdate_("LeaseInspections", x.r.inspectionId, patch);
  return inspectionOut_(dbGet_("LeaseInspections", x.r.inspectionId), true);
}
function laSummaryClean_(s, c) {
  if (!s) return "";
  return { intro: safeText_(laFill_(s.intro, c), 3000), conclusion: safeText_(laFill_(s.conclusion, c), 3000),
    rooms: (Array.isArray(s.rooms) ? s.rooms : []).slice(0, 40).map(function (r) { return { name: safeText_(r && r.name, 80), text: safeText_(laFill_(r && r.text, c), 3000) }; }).filter(function (r) { return r.name; }),
    differences: (Array.isArray(s.differences) ? s.differences : []).slice(0, 80).map(function (d) { return { room: safeText_(d && d.room, 80), item: safeText_(d && d.item, 80), entry: safeText_(d && d.entry, 40), exit: safeText_(d && d.exit, 40), comment: safeText_(laFill_(d && d.comment, c), 600) }; }) };
}
/** Écarts entre l'entrée et la sortie (état plus dégradé à la sortie). */
function laDifferences_(rooms) {
  const out = [];
  rooms.forEach(function (r) { (r.items || []).forEach(function (i) {
    if (i.entry && i.condition && LA_CONDITION_RANK_[i.condition] !== undefined && LA_CONDITION_RANK_[i.entry] !== undefined && LA_CONDITION_RANK_[i.condition] > LA_CONDITION_RANK_[i.entry])
      out.push({ room: r.name, item: i.name, entry: LA_CONDITION_LABELS_[i.entry], exit: LA_CONDITION_LABELS_[i.condition], comment: i.note || "" });
  }); });
  return out;
}
function laInspectionTemplate_(r) {
  const rooms = parseJson_(r.roomsJson, []), exit = r.type === "EXIT";
  const roomText = function (room) {
    const groups = {};
    (room.items || []).forEach(function (i) { if (!i.condition || i.condition === "NA") return; (groups[i.condition] = groups[i.condition] || []).push(i.name.toLowerCase() + (i.note ? " (" + i.note + ")" : "")); });
    const parts = ["NEW", "GOOD", "WORN", "BAD"].filter(function (k) { return groups[k]; }).map(function (k) { return LA_CONDITION_LABELS_[k] + " : " + groups[k].join(", ") + "."; });
    const missing = (room.items || []).filter(function (i) { return !i.condition; }).length;
    return (parts.join(" ") || "Aucun élément renseigné.") + (missing ? " " + missing + " élément(s) non renseigné(s)." : "") + (room.note ? " Observations : " + room.note : "") + ((room.photoDocIds || []).length ? " " + room.photoDocIds.length + " photo(s) jointe(s)." : "");
  };
  const diffs = exit ? laDifferences_(rooms) : [];
  return { intro: (exit ? "État des lieux de sortie" : "État des lieux d'entrée") + " du logement [BIEN], situé [ADRESSE_DU_BIEN], établi contradictoirement le " + pdfDate_(r.inspectionDate) + " entre [BAILLEUR] et [LOCATAIRE]." +
      (r.attendees ? " Personnes présentes : " + r.attendees + "." : ""),
    rooms: rooms.map(function (room) { return { name: room.name, text: roomText(room) }; }),
    conclusion: exit ? (diffs.length ? diffs.length + " élément(s) présentent un état plus dégradé qu'à l'entrée (voir le tableau des écarts). Toute retenue sur le dépôt de garantie doit être justifiée (devis, facture) et tenir compte de l'usure normale liée à la durée d'occupation."
        : "Aucune dégradation par rapport à l'état des lieux d'entrée n'a été relevée.") : "Le locataire reconnaît avoir reçu le logement dans l'état décrit ci-dessus. Les défauts non signalés pourront être ajoutés par écrit dans les jours suivant la remise des clés, selon les règles applicables.",
    differences: diffs.map(function (d) { return Object.assign(d, { comment: d.comment || "À apprécier en tenant compte de la vétusté." }); }) };
}
function laInspectionAi_(c, r) {
  const exit = r.type === "EXIT", rooms = parseJson_(r.roomsJson, []);
  const system = "Tu es l'agent de rédaction d'DarPilot (" + edition_().countryName + "). Rédige en français le compte rendu d'un état des lieux " + (exit ? "de SORTIE" : "d'ENTRÉE") + " d'un logement loué, à partir des relevés fournis.\n" +
    "- Décris UNIQUEMENT ce qui est relevé (états et observations). N'invente aucun défaut, aucun équipement, aucun nom.\n" +
    "- Style factuel et précis, phrases courtes, vocabulaire d'état des lieux. Une description par pièce (2 à 5 phrases).\n" +
    (exit ? "- Compare avec l'état à l'entrée (champ « entree ») ; liste dans « differences » les éléments plus dégradés à la sortie, en distinguant l'usure normale des dégradations. Ne chiffre aucune retenue.\n" : "- Les éléments sans état sont « non renseignés » : signale-les sans les décrire.\n") +
    "- Marqueurs pour les identités et l'adresse : [BAILLEUR], [LOCATAIRE], [ADRESSE_DU_BIEN], [BIEN].\n" +
    "Réponds UNIQUEMENT en JSON : {\"intro\": string, \"rooms\": [{\"name\": string, \"text\": string}], \"conclusion\": string, \"differences\": [{\"room\": string, \"item\": string, \"entry\": string, \"exit\": string, \"comment\": string}]}.";
  const payload = { type: exit ? "sortie" : "entrée", date: r.inspectionDate, meuble: leaseFurnished_(c.l, c.prop), pieces: rooms.map(function (room) {
    return { nom: room.name, observations: room.note || "", photos: (room.photoDocIds || []).length, elements: (room.items || []).map(function (i) {
      const o = { element: i.name, etat: LA_CONDITION_LABELS_[i.condition] || "non renseigné", observation: i.note || "" }; if (exit) { o.entree = LA_CONDITION_LABELS_[i.entry] || "non renseigné"; o.observationEntree = i.entryNote || ""; } return o; }) };
  }), compteurs: parseJson_(r.metersJson, {}), cles: parseJson_(r.keysJson, []), remarquesGenerales: r.generalNote || "" };
  return laAiJson_(c.l.organizationId, system, payload, LA_LIMITS_.inspectionTokens);
}
/** Rédaction du compte rendu par l'agent (IA ou modèle intégré), enregistrée dans le brouillon. */
function inspectionWrite_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "inspection.manage");
  assert_(x.r.status === "DRAFT", "État des lieux déjà validé.");
  let summary = laInspectionTemplate_(x.r), engine = "MODELE", warning = "";
  if (a.useAi !== false) {
    try { const res = laInspectionAi_(x.c, x.r); if (res) { summary = res.data; engine = res.engine; } }
    catch (e) { console.error("Agent IA (état des lieux) : " + e.message); warning = "L'agent IA n'a pas pu rédiger le compte rendu : le modèle intégré a été utilisé."; }
  }
  const clean = laSummaryClean_(summary, x.c);
  if (x.r.type === "EXIT" && !clean.differences.length) clean.differences = laDifferences_(parseJson_(x.r.roomsJson, [])).map(function (d) { return Object.assign(d, { comment: d.comment || "À apprécier en tenant compte de la vétusté." }); });
  dbUpdate_("LeaseInspections", x.r.inspectionId, { summaryJson: clean, engine: engine, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("INSPECTION_WRITTEN", "Lease", x.c.l.leaseId, x.c.l.organizationId, { inspectionId: x.r.inspectionId, engine: engine });
  const o = inspectionOut_(dbGet_("LeaseInspections", x.r.inspectionId), true); o.warning = warning; return o;
}
function inspectionHtml_(c, r, withPhotos) {
  const rooms = parseJson_(r.roomsJson, []), meters = parseJson_(r.metersJson, {}), keys = parseJson_(r.keysJson, []), sum = parseJson_(r.summaryJson, null) || laSummaryClean_(laInspectionTemplate_(r), c);
  const exit = r.type === "EXIT", draft = r.status !== "FINAL", ma = IMMO_EDITION_ === "MA", byRoom = {}, cur = cur_();
  (sum.rooms || []).forEach(function (x) { byRoom[x.name] = x.text; });
  const furnished = leaseFurnished_(c.l, c.prop);
  // En-tête des parties (même présentation que la quittance) et logement
  const vals = { bailleur: c.org.name || "", bailleur_adresse: [c.org.address, c.org.city].filter(String).join(", ") || "Domicile : ____________________", locataire: c.t.fullName || "",
    adresse: exit ? (r.tenantNewAddress ? "Nouveau domicile : " + r.tenantNewAddress : "Nouveau domicile : ____________________") : rentAddress_(c.prop) };
  const val = function (k) { const v = vals[k]; return v === undefined ? "{{" + k + "}}" : String(v || "—"); };
  let inner = draft ? "<div class='box' style='border-color:#e9b341;background:#fff8e6'><b>PROJET — état des lieux non validé.</b></div>" : "";
  inner += docTemplateBlock_("[entete]", val);
  inner += "<table style='margin:0 0 12px'><tr><th>Logement</th><th>État des lieux</th></tr><tr><td>" + laPropertyLines_(c.prop, furnished, ma).slice(0, 5).map(escapeHtml_).join("<br>") + "</td><td>" +
    (exit ? "Sortie" : "Entrée") + " — réalisé le <b>" + pdfDate_(r.inspectionDate) + "</b>" + (exit && r.entryDate ? "<br>État des lieux d'entrée du " + pdfDate_(r.entryDate) : "") +
    "<br>Bail du " + pdfDate_(c.l.startDate) + (c.l.endDate ? " au " + pdfDate_(c.l.endDate) : "") + "<br>Logement " + (furnished ? "meublé" : "non meublé") + (r.attendees ? "<br>Présents : " + escapeHtml_(r.attendees) : "") + "</td></tr></table>";
  inner += laParas_(laFill_(sum.intro, c));
  const mrow = function (lbl, k) { return exit ? [lbl, parseJson_(r.metersEntryJson, {})[k] || "—", meters[k] || "—"] : [lbl, meters[k] || "—"]; };
  inner += "<h2>Relevés des compteurs</h2>" + htmlTable_(exit ? ["Compteur", "À l'entrée", "À la sortie"] : ["Compteur", "Relevé"], [mrow("Électricité", "electricity"), mrow("Eau", "water"), mrow("Gaz", "gas"), mrow("Autre (chauffage, eau chaude…)", "other")]);
  if (keys.length) inner += "<h2>Clés et accès remis</h2>" + htmlTable_(exit ? ["Désignation", "Remis à l'entrée", "Restitués"] : ["Désignation", "Nombre"], keys.map(function (k) { return exit ? [k.label, k.entry === "" || k.entry == null ? "—" : String(k.entry), k.count === "" ? "—" : String(k.count)] : [k.label, k.count === "" ? "—" : String(k.count)]; }));
  inner += "<p class='muted' style='font-size:9px'>États : Neuf · Bon état · État d'usage (usure normale) · Mauvais état · Sans objet.</p>";
  rooms.forEach(function (room) {
    inner += "<h2>" + escapeHtml_(room.name) + "</h2>" + htmlTable_(exit ? ["Élément", "État à l'entrée", "État à la sortie", "Observations"] : ["Élément", "État", "Observations"], (room.items || []).map(function (i) {
      const note = (i.note || "") + ((i.photoDocIds || []).length ? (i.note ? " " : "") + "(photo" + (i.photoDocIds.length > 1 ? "s" : "") + " ci-dessous)" : "");
      return exit ? [i.name, LA_CONDITION_LABELS_[i.entry] || "—", LA_CONDITION_LABELS_[i.condition] || "—", note] : [i.name, LA_CONDITION_LABELS_[i.condition] || "—", note]; }));
    if (byRoom[room.name]) inner += laParas_(laFill_(byRoom[room.name], c));
    if (withPhotos) {
      const pics = [];
      (room.items || []).forEach(function (i) { (i.photoDocIds || []).slice(0, 3).forEach(function (d) { pics.push({ src: pdfImageData_(d), cap: i.name }); }); });
      (room.photoDocIds || []).slice(0, 6).forEach(function (d) { pics.push({ src: pdfImageData_(d), cap: "Vue de la pièce" }); });
      const ok = pics.filter(function (x) { return x.src; });
      for (let k = 0; k < ok.length; k += 3) inner += "<table class='photos'><tr>" + [0, 1, 2].map(function (j) { const x = ok[k + j]; return "<td style='width:33%'>" + (x ? "<img src='" + x.src + "'><div class='muted' style='font-size:8px'>" + escapeHtml_(x.cap) + "</div>" : "") + "</td>"; }).join("") + "</tr></table>";
    }
    if (room.note) inner += "<p><b>Observations :</b> " + escapeHtml_(room.note) + "</p>";
  });
  if (exit && (sum.differences || []).length) inner += "<h2>Écarts constatés par rapport à l'entrée</h2>" + htmlTable_(["Pièce", "Élément", "Entrée", "Sortie", "Commentaire"], sum.differences.map(function (d) { return [d.room, d.item, d.entry, d.exit, d.comment]; }));
  if (exit) {
    const dep = laDeposit_(c, rooms);
    inner += "<h2>Dépôt de garantie</h2>";
    if (dep.lines.length) inner += htmlTable_(["Pièce", "Élément", "Coût de remise en état", "Vétusté", "Retenue"], dep.lines.map(function (l) { return [l.room, l.item, fmtAmount_(l.cost, cur), l.wear + " %", fmtAmount_(l.retained, cur)]; }));
    inner += htmlTable_(["Dépôt de garantie versé", "Total des retenues", "Montant à restituer"], [[fmtAmount_(dep.held, cur), fmtAmount_(dep.total, cur), fmtAmount_(dep.refund, cur)]]) +
      "<p class='muted'>" + (ma ? "Conformément à l'article 20 de la loi n° 67-12, le dépôt est restitué dans un délai d'un mois à compter de la remise des clés, déduction faite des sommes dues et justifiées."
        : "Le dépôt est restitué dans un délai d'un mois à compter de la remise des clés si l'état des lieux de sortie est conforme à celui d'entrée, de deux mois dans le cas contraire ; les retenues doivent être justifiées (devis, factures) et tiennent compte de la vétusté.") + "</p>";
  }
  if (r.generalNote) inner += "<h2>Observations générales</h2>" + laParas_(r.generalNote);
  inner += "<h2>Conclusion</h2>" + laParas_(laFill_(sum.conclusion, c));
  inner += "<div class='box' style='font-size:9.5px'>" + (ma ? "État des lieux établi par écrit, daté et détaillé, contradictoirement entre les parties, et annexé au contrat de location conformément aux articles 7 et 8 de la loi n° 67-12."
    : "État des lieux établi contradictoirement conformément à l'article 3-2 de la loi n° 89-462 du 6 juillet 1989 et au décret n° 2016-382 du 30 mars 2016." + (exit ? "" : " Le locataire peut demander au bailleur de compléter cet état des lieux d'entrée dans un délai de dix jours à compter de son établissement (dans le premier mois de la période de chauffe pour les éléments de chauffage).") +
      " Il est remis à chaque partie qui en conserve un exemplaire.") + "</div>";
  const sig = function (who, id, name, at) {
    const src = id ? pdfImageData_(id) : "";
    return "<td><b>" + who + "</b><br>" + (src ? "<img src='" + src + "' style='height:60px;max-width:100%'><br><span class='muted'>" + escapeHtml_(name || "") + " — signé électroniquement le " +
      escapeHtml_(Utilities.formatDate(new Date(at), tz_(), "dd/MM/yyyy à HH:mm")) + "</span>" : "<span class='muted'>Nom, « lu et approuvé », signature</span>") + "</td>";
  };
  inner += "<p style='margin-top:14px'>Fait à " + escapeHtml_(c.prop.city || edition_().city) + ", le " + pdfDate_(r.inspectionDate) + ", en deux exemplaires.</p><table class='sign'><tr>" +
    sig("Le bailleur ou son représentant", r.landlordSignDocId, r.landlordSignName, r.landlordSignedAt) + sig("Le locataire", r.tenantSignDocId, r.tenantSignName, r.tenantSignedAt) + "</tr></table>";
  return pdfShell_(exit ? "État des lieux de sortie" : "État des lieux d'entrée", inner, { noHead: true, subtitle: (c.prop.name || "") + " · " + pdfDate_(r.inspectionDate), ref: "EDL" + (exit ? "S" : "E") + "-" + String(r.inspectionId || "").slice(-8).toUpperCase(),
    footer: draft ? "PROJET — état des lieux non validé." : "Paraphe du bailleur : __________          Paraphe du locataire : __________" });
}
function inspectionPdf_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.view");
  if (x.r.status === "FINAL" && x.r.documentId) return docGet_(p, { documentId: x.r.documentId });
  const blob = htmlToPdf_(inspectionHtml_(x.c, x.r, true), "Etat_des_lieux_" + (x.r.type === "EXIT" ? "sortie" : "entree") + "_projet");
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
function inspectionFinalize_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "inspection.manage");
  assert_(x.r.status === "DRAFT", "État des lieux déjà validé.");
  const rooms = parseJson_(x.r.roomsJson, []);
  const blank = rooms.reduce(function (n, room) { return n + (room.items || []).filter(function (i) { return !i.condition; }).length; }, 0);
  assert_(!blank || a.allowIncomplete === true, blank + " élément(s) sans état : complétez-les (ou choisissez « Sans objet ») avant de valider.");
  const r = Object.assign({}, x.r, { status: "FINAL", finalizedAt: nowIso_() });
  if (!parseJson_(r.summaryJson, null)) r.summaryJson = laSummaryClean_(laInspectionTemplate_(r), x.c);
  const blob = htmlToPdf_(inspectionHtml_(x.c, r, true), "Etat_des_lieux_" + (r.type === "EXIT" ? "sortie" : "entree") + "_" + r.inspectionDate);
  const out = storeGeneratedPdf_(p, blob, { propertyId: x.c.l.propertyId, organizationId: x.c.l.organizationId }, "LEASE", x.c.l.leaseId, "INSPECTION");
  dbUpdate_("LeaseInspections", r.inspectionId, { status: "FINAL", finalizedAt: r.finalizedAt, finalizedBy: p.email, documentId: out.documentId, summaryJson: r.summaryJson, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("INSPECTION_FINALIZED", "Lease", x.c.l.leaseId, x.c.l.organizationId, { inspectionId: r.inspectionId, type: r.type });
  // Signé sur l'écran par les deux parties : copie envoyée aussitôt au locataire.
  if (x.r.landlordSignDocId && x.r.tenantSignDocId && x.c.t.email) { try { out.sentTo = inspectionSend_(p, { inspectionId: r.inspectionId }).sentTo; } catch (e) { out.sendError = e.message; } }
  return out;
}
function inspectionSend_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "inspection.manage");
  assert_(x.r.status === "FINAL" && x.r.documentId, "Validez d'abord l'état des lieux.");
  const label = x.r.type === "EXIT" ? "État des lieux de sortie" : "État des lieux d'entrée";
  const out = laSendStored_(p, x.c, x.r.documentId, label + " — " + (x.c.prop.name || ""), safeText_(a.message, 2000) || "Veuillez trouver ci-joint l'" + label.charAt(0).toLowerCase() + label.slice(1) +
    " du logement « " + (x.c.prop.name || "") + " », établi le " + pdfDate_(x.r.inspectionDate) + ". Conservez-le avec votre contrat de location.");
  dbUpdate_("LeaseInspections", x.r.inspectionId, { sentAt: nowIso_(), sentTo: out.sentTo });
  return out;
}
function inspectionCancel_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "inspection.manage");
  assert_(x.r.status === "DRAFT", "Un état des lieux validé ne peut pas être supprimé.");
  dbUpdate_("LeaseInspections", x.r.inspectionId, { status: "CANCELLED", updatedAt: nowIso_(), updatedBy: p.email });
  return { ok: true };
}

/* ------------------------- Signature sur l'écran ------------------------- */
/** Signature du bailleur (ou de son représentant) ou du locataire, tracée sur l'écran pendant la visite. */
function inspectionSign_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "inspection.manage");
  assert_(x.r.status === "DRAFT", "État des lieux déjà validé.");
  const role = oneOf_(a.role, ["LANDLORD", "TENANT"], "Signataire"), name = reqText_(a.name, "Nom du signataire", 2, 120);
  const img = String(a.image || "").replace(/^data:image\/png;base64,/, "");
  assert_(img.length > 200 && img.length < 700000, "Signature vide ou trop lourde : signez à nouveau.");
  const d = storeFile_({ propertyId: x.c.l.propertyId, organizationId: x.c.l.organizationId }, "LEASE", x.c.l.leaseId, "SIGNATURE",
    { mimeType: "image/png", fileName: "Signature_" + (role === "TENANT" ? "locataire" : "bailleur") + "_" + x.r.inspectionId, base64: img }, p.email);
  const k = role === "TENANT" ? "tenant" : "landlord", meta = requestMeta_(), patch = { signIp: meta.ip, updatedAt: nowIso_(), updatedBy: p.email };
  patch[k + "SignDocId"] = d.documentId; patch[k + "SignName"] = name; patch[k + "SignedAt"] = nowIso_();
  dbUpdate_("LeaseInspections", x.r.inspectionId, patch);
  audit_("INSPECTION_SIGNED", "Lease", x.c.l.leaseId, x.c.l.organizationId, { inspectionId: x.r.inspectionId, role: role });
  return inspectionOut_(dbGet_("LeaseInspections", x.r.inspectionId), true);
}

/* ------------------------- Retenues sur le dépôt ------------------------- */
function laDeposit_(c, rooms) {
  const lines = [];
  rooms.forEach(function (r) { (r.items || []).forEach(function (i) {
    if (num_(i.repairCost) > 0) lines.push({ room: r.name, item: i.name, cost: num_(i.repairCost), wear: num_(i.wearPct), retained: round2_(num_(i.repairCost) * (1 - num_(i.wearPct) / 100)) });
  }); });
  const held = num_(c.l.deposit), total = round2_(sumBy_(lines, function (l) { return l.retained; }));
  return { lines: lines, held: held, total: total, refund: Math.max(0, round2_(held - total)) };
}
/** Prépare la lettre de restitution du dépôt de garantie à partir des retenues de l'état des lieux de sortie. */
function inspectionDepositLetter_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.manage");
  assert_(x.r.type === "EXIT", "Uniquement pour un état des lieux de sortie.");
  const dep = laDeposit_(x.c, parseJson_(x.r.roomsJson, []));
  return leaseDocDraft_(p, { leaseId: x.c.l.leaseId, docType: "LETTER", subtype: "DEPOSIT_RETURN", useAi: false, deductions: dep.total,
    deductionReason: dep.lines.length ? dep.lines.map(function (l) { return l.room + " — " + l.item + " : " + fmtAmount_(l.retained, cur_()); }).join(" ; ").slice(0, 600) : "" });
}
