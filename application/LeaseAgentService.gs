/**
 * AGENT DE RÉDACTION (location longue durée) : contrat de bail, états des lieux d'entrée et de sortie, courriers au locataire.
 *
 * Deux moteurs, même résultat (un brouillon modifiable, puis un PDF définitif) :
 *  - IA : si l'assistant IA est configuré (IMMO_AI_PROVIDER + IMMO_AI_API_KEY ; modèle facultatif IMMO_AI_DOC_MODEL), le serveur
 *    demande la rédaction au service d'IA. AUCUNE donnée d'identité n'est transmise : ni nom, ni e-mail, ni téléphone, ni adresse,
 *    ni pièce d'identité. L'IA écrit avec des marqueurs ([BAILLEUR], [LOCATAIRE], [ADRESSE_DU_BIEN], [VILLE]) que le serveur
 *    remplace ensuite par les vraies valeurs.
 *  - MODÈLE INTÉGRÉ : sans IA (ou en cas d'erreur), un modèle rédigé à l'avance pour l'édition (Maroc : loi 67-12, loi 07-03 ;
 *    France : loi 89-462) est rempli avec les données du bail. L'application fonctionne donc toujours.
 * Règles :
 *  - Rien n'est envoyé au locataire sans action explicite du bailleur (« Valider », puis « Envoyer au locataire »).
 *  - Les avertissements juridiques calculés par le serveur (révision du loyer, dépôt de garantie, durée) s'ajoutent à ceux de l'IA.
 *  - Les documents sont des modèles : ils doivent être relus par un professionnel ; ImmoPilot ne garantit pas leur conformité.
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
  const map = { "[BAILLEUR]": c.org.name || "le bailleur", "[LOCATAIRE]": c.t.fullName || "le locataire", "[ADRESSE_DU_BIEN]": rentAddress_(c.prop) || c.prop.name || "", "[VILLE]": c.prop.city || edition_().city, "[BIEN]": c.prop.name || "" };
  return String(text || "").replace(/\[(BAILLEUR|LOCATAIRE|ADRESSE_DU_BIEN|VILLE|BIEN)\]/g, function (m) { return map[m]; });
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
  const w = ["Modèle généré automatiquement : faites-le relire par un professionnel (avocat, notaire ou adoul selon le cas) avant signature. ImmoPilot ne garantit pas sa conformité juridique."];
  const l = c.l, rent = num_(l.monthlyRent), dep = num_(l.deposit), months = l.endDate ? diffDays_(l.startDate, addDaysStr_(l.endDate, 1)) / 30.44 : null;
  if (IMMO_EDITION_ === "MA") {
    if (num_(l.indexationRate) > 0) w.push("Le bail prévoit une indexation annuelle de " + num_(l.indexationRate) + " % : au Maroc, la loi n° 07-03 ne permet de réviser le loyer qu'au plus tôt tous les trois ans, dans la limite de " + (inp.usage === "MIXED" ? "8 % (habitation) et 10 % (autres locaux)" : "8 % pour l'habitation") + ". Le contrat reprend la règle légale ; ajustez l'indexation du bail dans ImmoPilot.");
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
/** Contrat rédigé par le modèle intégré (édition Maroc ou France). */
function laContractTemplate_(c, inp) {
  const l = c.l, prop = c.prop, ma = IMMO_EDITION_ === "MA", rent = num_(l.monthlyRent), ch = num_(l.charges), dep = num_(l.deposit);
  const rooms = parseJson_(prop.roomsJson, []), equip = parseJson_(prop.equipmentJson, []);
  const usage = inp.usage === "MIXED" ? "à usage mixte d'habitation et professionnel" : "à usage d'habitation";
  const nature = inp.furnished ? "meublé" : "non meublé (vide)";
  const S = [];
  const add = function (t, b) { S.push({ title: "Article " + (S.length + 1) + " — " + t, body: b }); };
  add("Objet", "Le bailleur, [BAILLEUR], donne en location au locataire, [LOCATAIRE], qui accepte, le logement désigné à l'article 2, " + usage + ", " + nature + ".\n\n" +
    (ma ? "Le présent contrat est régi par la loi n° 67-12 régissant les rapports contractuels entre les bailleurs et les locataires des locaux à usage d'habitation ou à usage professionnel, par la loi n° 07-03 relative à la révision du montant du loyer et, pour ce qu'elles ne prévoient pas, par le Dahir des obligations et contrats."
      : "Le présent contrat est régi par la loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs" + (inp.furnished ? ", notamment son titre Ier bis relatif aux logements meublés" : "") + "."));
  add("Désignation du logement", (prop.propertyType ? "Type de bien : " + st_label_(prop.propertyType) + ".\n" : "") + "Adresse : [ADRESSE_DU_BIEN].\n" +
    (num_(prop.surfaceM2) ? "Surface " + (ma ? "approximative" : "habitable") + " : " + num_(prop.surfaceM2) + " m².\n" : "") +
    (rooms.length ? "Composition : " + rooms.join(", ") + ".\n" : "") + (inp.furnished && equip.length ? "Équipements et mobilier fournis : " + equip.join(", ") + " (détail dans l'inventaire annexé).\n" : "") +
    "\nLe locataire déclare bien connaître les lieux pour les avoir visités. Un état des lieux contradictoire est établi lors de la remise des clés" + (inp.furnished ? ", accompagné d'un inventaire du mobilier" : "") + ".");
  if (l.endDate) add("Durée", "Le présent bail prend effet le " + pdfDate_(l.startDate) + " pour une durée de " + Math.max(1, Math.round(diffDays_(l.startDate, addDaysStr_(l.endDate, 1)) / 30.44)) + " mois, soit jusqu'au " + pdfDate_(l.endDate) + ".\n\n" +
    (ma ? "À son terme, il pourra être renouvelé d'un commun accord ; à défaut de congé délivré dans les formes et délais prévus par la loi, il se poursuit dans les conditions prévues par la loi n° 67-12."
      : "À défaut de congé donné dans les conditions prévues par la loi, il est reconduit tacitement pour une durée de " + (inp.furnished ? "un an." : "trois ans (six ans si le bailleur est une personne morale).")));
  else add("Durée", "Le présent bail prend effet le " + pdfDate_(l.startDate) + " pour une durée indéterminée. Il prend fin par congé donné dans les formes et délais prévus par la loi.");
  add("Loyer", "Le loyer mensuel est fixé à " + laMoney_(rent) + " (" + (ch > 0 ? "hors charges" : "charges comprises, sauf consommations individuelles") + ").\n\n" +
    "Il est payable d'avance, au plus tard le " + (num_(l.dueDay) || 5) + " de chaque mois, par virement ou par tout autre moyen convenu entre les parties. Un avis d'échéance est adressé au locataire avant chaque échéance ; une quittance lui est remise gratuitement pour chaque échéance intégralement réglée.");
  if (ch > 0) add("Charges", "En sus du loyer, le locataire verse chaque mois une provision pour charges de " + laMoney_(ch) + (ma ? ", destinée aux charges communes (entretien des parties communes, gardiennage, ascenseur le cas échéant)." : ", qui fait l'objet d'une régularisation annuelle sur justificatifs.") +
    "\n\nLes consommations individuelles (eau, électricité, gaz, téléphone, internet) sont à la charge du locataire, qui souscrit les abonnements correspondants, sauf accord contraire écrit.");
  else add("Charges et consommations", "Les consommations individuelles (eau, électricité, gaz, téléphone, internet) sont à la charge du locataire, qui souscrit les abonnements correspondants, sauf accord contraire écrit.");
  add("Révision du loyer", ma ? "Le loyer ne peut être révisé que dans les conditions et limites prévues par la loi n° 07-03 relative à la révision du montant du loyer : la révision ne peut intervenir qu'au terme d'une période d'au moins trois ans, et l'augmentation ne peut excéder " + (inp.usage === "MIXED" ? "8 % pour les locaux à usage d'habitation et 10 % pour les autres locaux." : "8 % pour les locaux à usage d'habitation.")
    : (num_(l.indexationRate) > 0 ? "Le loyer est révisé chaque année à la date anniversaire du bail, selon la variation de l'indice de référence des loyers (IRL) publié par l'INSEE, l'indice de référence étant celui du dernier trimestre connu à la date de signature du bail."
      : "Le présent bail ne comporte pas de clause de révision annuelle : le loyer n'est pas révisé en cours de bail."));
  add("Dépôt de garantie", dep > 0 ? "Un dépôt de garantie de " + laMoney_(dep) + (rent > 0 ? " (soit " + Math.round(dep / rent * 10) / 10 + " mois de loyer)" : "") + " est versé à la signature. Il n'est pas productif d'intérêts et ne peut être imputé par le locataire sur le dernier loyer.\n\n" +
      (ma ? "Il est restitué en fin de bail, après remise des clés et état des lieux de sortie, déduction faite des sommes restant dues au bailleur et dûment justifiées." : "Il est restitué dans un délai d'un mois à compter de la remise des clés si l'état des lieux de sortie est conforme à l'état des lieux d'entrée, et de deux mois dans le cas contraire, déduction faite des sommes restant dues au bailleur et dûment justifiées.")
    : "Aucun dépôt de garantie n'est demandé.");
  add("Obligations du bailleur", "Le bailleur est tenu de délivrer au locataire un logement en bon état d'usage et de réparation, avec des équipements en bon état de fonctionnement ; d'assurer au locataire la jouissance paisible du logement ; d'entretenir les locaux et d'y faire les réparations autres que locatives, notamment les grosses réparations ; de remettre gratuitement une quittance au locataire qui en fait la demande ou après chaque paiement intégral.");
  add("Obligations du locataire", "Le locataire est tenu de payer le loyer et les charges aux termes convenus ; d'user paisiblement des lieux suivant leur destination ; de répondre des dégradations et pertes survenues pendant la durée du bail, sauf si elles résultent de la vétusté, d'une malfaçon, d'un vice de construction, d'un cas fortuit ou de force majeure ; de prendre à sa charge l'entretien courant du logement et les menues réparations ; de laisser exécuter les travaux nécessaires au maintien en état du logement ; de restituer les lieux en fin de bail dans l'état constaté à l'entrée, compte tenu de l'usure normale.");
  inp.clauses.forEach(function (k) { const tx = laClauseText_(k, inp, ma); if (tx) add({ INSURANCE_REQUIRED: "Assurance", SUBLET_FORBIDDEN: "Sous-location et cession", PETS_ALLOWED: "Animaux", PETS_FORBIDDEN: "Animaux", NO_SMOKING: "Logement non-fumeur", GUARANTOR: "Cautionnement", WORKS_AUTH_REQUIRED: "Travaux et transformations" }[k], tx); });
  if (inp.clauses.indexOf("SUBLET_FORBIDDEN") < 0) add("Sous-location et cession", "Toute sous-location ou cession du bail est soumise à l'accord écrit et préalable du bailleur.");
  if (!ma && inp.clauses.indexOf("INSURANCE_REQUIRED") < 0) add("Assurance", laClauseText_("INSURANCE_REQUIRED", inp, ma));
  add("Congé et fin du bail", ma ? "Le locataire peut mettre fin au bail en donnant congé par écrit au bailleur, dans le respect du délai de préavis prévu par la loi. Le bailleur ne peut donner congé que dans les cas et conditions prévus par la loi n° 67-12. Tout congé est notifié dans les formes prévues par la loi."
    : "Le locataire peut donner congé à tout moment, par lettre recommandée avec avis de réception, acte de commissaire de justice ou remise en main propre contre émargement, avec un préavis de " + (inp.furnished ? "un mois." : "trois mois (un mois dans les cas prévus par la loi, notamment en zone tendue).") +
      " Le bailleur ne peut donner congé que pour le terme du bail, avec un préavis de " + (inp.furnished ? "trois mois" : "six mois") + ", pour reprendre le logement, le vendre ou pour un motif légitime et sérieux.");
  add("Défaut de paiement", ma ? "En cas de non-paiement du loyer ou des charges à leur échéance, le bailleur peut, après une mise en demeure restée sans effet, engager les procédures prévues par la loi pour obtenir le paiement des sommes dues et, le cas échéant, la résiliation du bail et l'expulsion."
    : "À défaut de paiement du loyer ou des charges aux termes convenus, ou de versement du dépôt de garantie, le bail sera résilié de plein droit dans les conditions et délais prévus à l'article 24 de la loi du 6 juillet 1989, après un commandement de payer demeuré infructueux. Il en va de même à défaut d'assurance des risques locatifs, un mois après un commandement demeuré infructueux.");
  const special = [l.terms, inp.instructions].filter(function (x) { return String(x || "").trim(); }).join("\n\n");
  if (special) add("Conditions particulières", special);
  add(ma ? "Élection de domicile et litiges" : "Élection de domicile", ma ? "Pour l'exécution des présentes, les parties élisent domicile, le bailleur à son adresse et le locataire dans les lieux loués. Tout litige relatif au présent contrat relève du tribunal compétent du lieu de situation du logement."
    : "Pour l'exécution des présentes, le bailleur fait élection de domicile à son adresse et le locataire dans les lieux loués.");
  add("Annexes", "Sont annexés au présent contrat : l'état des lieux d'entrée" + (inp.furnished ? ", l'inventaire du mobilier" : "") + (inp.clauses.indexOf("GUARANTOR") >= 0 ? ", l'acte de cautionnement" : "") +
    (ma ? "." : ", le dossier de diagnostic technique, la notice d'information et, le cas échéant, les extraits du règlement de copropriété."));
  return { title: "Contrat de location — logement " + (inp.furnished ? "meublé" : "vide"), sections: S };
}
function st_label_(code) { return ({ APARTMENT: "appartement", VILLA: "villa", RIAD: "riad", STUDIO: "studio", HOUSE: "maison", DUPLEX: "duplex", ROOM: "chambre", OFFICE: "bureau" })[String(code || "").toUpperCase()] || String(code || "").toLowerCase(); }

function laContractAi_(c, inp, base) {
  const ma = IMMO_EDITION_ === "MA";
  const system = "Tu es l'agent de rédaction juridique d'ImmoPilot, logiciel de gestion locative (" + edition_().countryName + "). Tu rédiges en français un contrat de location " +
    (inp.furnished ? "meublée" : "vide") + " conforme au " + edition_().leaseLaw + ".\nRègles impératives :\n" +
    "- Pars de la TRAME fournie (déjà conforme) et améliore-la : clarté, articles complets, consignes de l'utilisateur intégrées. Garde tous les articles utiles de la trame.\n" +
    "- Utilise UNIQUEMENT les faits fournis. N'invente aucun montant, aucune date, aucun nom, aucune adresse.\n" +
    "- Pour les identités et l'adresse, écris exactement les marqueurs [BAILLEUR], [LOCATAIRE], [ADRESSE_DU_BIEN], [VILLE].\n" +
    "- Ne cite un numéro d'article de loi que si tu es certain qu'il existe et qu'il est pertinent ; sinon renvoie à « la loi ».\n" +
    (ma ? "- Maroc : la loi n° 07-03 limite la révision du loyer d'habitation à une fois tous les 3 ans au plus tôt et à 8 % au maximum (10 % pour les autres locaux). N'écris jamais d'indexation annuelle.\n" : "- France : respecte les durées minimales, le plafond du dépôt de garantie (1 mois vide, 2 mois meublé, hors charges) et la révision annuelle selon l'IRL.\n") +
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
    if (inp.newRent > rent * 1.08 + 0.01) w.push("Hausse de " + Math.round((inp.newRent / rent - 1) * 1000) / 10 + " % : la loi n° 07-03 la limite à 8 % pour un logement d'habitation.");
    const since = inp.effectiveDate || todayStr_();
    if (diffDays_(l.startDate, since) < 3 * 365) w.push("Moins de trois ans depuis le début du bail : la loi n° 07-03 ne permet pas encore de réviser le loyer (sauf décision de justice).");
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
    add("Objet : révision du loyer", "Madame, Monsieur,\n\nConformément aux dispositions du bail et " + (ma ? "de la loi n° 07-03 relative à la révision du montant du loyer" : "de l'article 17-1 de la loi du 6 juillet 1989 (indice de référence des loyers)") +
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
  const system = "Tu es l'agent de rédaction d'ImmoPilot (" + edition_().countryName + ", " + edition_().leaseLaw + "). Rédige en français un courrier du bailleur au locataire, courtois, précis et bref.\n" +
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
      " n° ____________________<br>" + escapeHtml_([t.email, t.phone].filter(String).join(" · ")) + "</td></tr></table><p>Logement : <b>" + escapeHtml_(prop.name || "") + "</b> — " + escapeHtml_(rentAddress_(prop)) + "</p>";
  }
  sections.forEach(function (s) { inner += (s.title ? "<h2>" + escapeHtml_(s.title) + "</h2>" : "") + laParas_(s.body); });
  if (d.docType === "LEASE_CONTRACT") inner += "<p style='margin-top:16px'>Fait à " + escapeHtml_(prop.city || edition_().city) + ", le " + (draft ? "____________" : pdfDate_(String(d.finalizedAt || todayStr_()).slice(0, 10))) + ", en deux exemplaires originaux" + (ma ? "." : ", dont un remis à chaque partie.") + "</p>" +
    "<table class='sign'><tr><td><b>Le bailleur</b><br><span class='muted'>« Lu et approuvé », signature</span></td><td><b>Le locataire</b><br><span class='muted'>« Lu et approuvé », signature</span></td></tr></table>";
  else inner += "<p style='margin-top:16px'>Fait à " + escapeHtml_(prop.city || edition_().city) + ", le " + pdfDate_(todayStr_()) + ".</p>";
  return pdfShell_(d.title || "Document", inner, { subtitle: (prop.name || "") + (d.docType === "LETTER" ? " · à l'attention de " + (t.fullName || "") : ""), issuer: rentIssuer_(org),
    footer: (draft ? "PROJET — " : "") + "Document établi via " + IMMO_CONFIG.APP_NAME + (d.engine && d.engine !== "MODELE" ? " (rédaction assistée par IA)" : "") + ". Modèle à faire relire par un professionnel ; ImmoPilot ne garantit pas sa conformité juridique." });
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
  if (full) { o.rooms = parseJson_(r.roomsJson, []); o.meters = parseJson_(r.metersJson, {}); o.keys = parseJson_(r.keysJson, []); o.generalNote = r.generalNote; o.attendees = r.attendees; o.summary = parseJson_(r.summaryJson, null); }
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
  const c = laCtx_(p, a.leaseId, "lease.manage"), type = oneOf_(a.type || "ENTRY", ["ENTRY", "EXIT"], "Type d'état des lieux");
  assert_(!dbAll_("LeaseInspections").some(function (r) { return String(r.leaseId) === String(c.l.leaseId) && r.type === type && r.status === "DRAFT"; }), "Un état des lieux de ce type est déjà en cours : ouvrez-le pour le compléter.", "CONFLICT");
  const furnished = leaseFurnished_(c.l, c.prop);
  let rooms = laDefaultRooms_(c.prop, furnished), keys = laDefaultKeys_();
  if (type === "EXIT") {
    const entry = inspectionEntryOf_(c.l.leaseId);
    if (entry) {
      rooms = parseJson_(entry.roomsJson, []).map(function (r) { return { name: r.name, items: (r.items || []).map(function (i) { return { name: i.name, condition: "", note: "", entry: i.condition || "", entryNote: i.note || "" }; }), note: "", photoDocIds: [] }; });
      keys = parseJson_(entry.keysJson, []).map(function (k) { return { label: k.label, count: "", entry: k.count }; });
    }
  }
  const r = dbInsert_("LeaseInspections", { organizationId: c.l.organizationId, propertyId: c.l.propertyId, leaseId: c.l.leaseId, type: type, inspectionDate: a.inspectionDate ? dateOnly_(a.inspectionDate, "Date") : todayStr_(),
    status: "DRAFT", roomsJson: rooms, metersJson: {}, keysJson: keys, generalNote: "", attendees: "", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email });
  audit_("INSPECTION_CREATED", "Lease", c.l.leaseId, c.l.organizationId, { inspectionId: r.inspectionId, type: type });
  return inspectionOut_(dbGet_("LeaseInspections", r.inspectionId), true);
}
function inspectionGet_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.view"), o = inspectionOut_(x.r, true);
  o.propertyName = x.c.prop.name; o.tenantName = x.c.t.fullName; o.canManage = canProp_(p, x.c.prop, "lease.manage"); o.ai = !!aiConfig_();
  return o;
}
function laCond_(v) { v = String(v || ""); return LA_CONDITIONS_.indexOf(v) >= 0 ? v : ""; }
function inspectionSave_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.manage");
  assert_(x.r.status === "DRAFT", "État des lieux validé : il ne peut plus être modifié.");
  const patch = { updatedAt: nowIso_(), updatedBy: p.email };
  if (a.inspectionDate) patch.inspectionDate = dateOnly_(a.inspectionDate, "Date");
  if (a.rooms !== undefined) {
    assert_(Array.isArray(a.rooms) && a.rooms.length <= 30, "30 pièces au maximum.");
    patch.roomsJson = a.rooms.map(function (r) {
      const items = (Array.isArray(r.items) ? r.items : []).slice(0, 40).map(function (i) { const o = { name: safeText_(i && i.name, 80), condition: laCond_(i && i.condition), note: safeText_(i && i.note, 500) };
        if (i && i.entry !== undefined) { o.entry = laCond_(i.entry); o.entryNote = safeText_(i.entryNote, 500); } return o; }).filter(function (i) { return i.name; });
      return { name: reqText_(r && r.name, "Nom de la pièce", 1, 80), items: items, note: safeText_(r && r.note, 1000), photoDocIds: assertDocsOf_((r && r.photoDocIds) || [], "LEASE", x.r.leaseId).slice(0, 12) };
    });
  }
  if (a.meters !== undefined) { const m = a.meters || {}; patch.metersJson = { electricity: safeText_(m.electricity, 40), water: safeText_(m.water, 40), gas: safeText_(m.gas, 40), other: safeText_(m.other, 120) }; }
  if (a.keys !== undefined) patch.keysJson = (Array.isArray(a.keys) ? a.keys : []).slice(0, 12).map(function (k) { const o = { label: safeText_(k && k.label, 80), count: k && k.count !== "" && k.count != null ? Math.max(0, Math.min(99, parseInt(k.count, 10) || 0)) : "" };
    if (k && k.entry !== undefined) o.entry = k.entry; return o; }).filter(function (k) { return k.label; });
  if (a.generalNote !== undefined) patch.generalNote = safeText_(a.generalNote, 3000);
  if (a.attendees !== undefined) patch.attendees = safeText_(a.attendees, 300);
  if (a.summary !== undefined) patch.summaryJson = laSummaryClean_(a.summary, x.c);
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
  const system = "Tu es l'agent de rédaction d'ImmoPilot (" + edition_().countryName + "). Rédige en français le compte rendu d'un état des lieux " + (exit ? "de SORTIE" : "d'ENTRÉE") + " d'un logement loué, à partir des relevés fournis.\n" +
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
  const x = inspectionLoad_(p, a.inspectionId, "lease.manage");
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
  const exit = r.type === "EXIT", draft = r.status !== "FINAL", byRoom = {};
  (sum.rooms || []).forEach(function (x) { byRoom[x.name] = x.text; });
  let inner = draft ? "<div class='box' style='border-color:#e9b341;background:#fff8e6'><b>PROJET — état des lieux non validé.</b></div>" : "";
  inner += rentParties_(c) + laParas_(laFill_(sum.intro, c));
  inner += "<h2>Compteurs</h2>" + htmlTable_(["Électricité", "Eau", "Gaz", "Autre"], [[meters.electricity || "—", meters.water || "—", meters.gas || "—", meters.other || "—"]]);
  if (keys.length) inner += "<h2>Clés et accès remis</h2>" + htmlTable_(exit ? ["Désignation", "Nombre à l'entrée", "Nombre restitué"] : ["Désignation", "Nombre"], keys.map(function (k) { return exit ? [k.label, k.entry === "" || k.entry == null ? "—" : String(k.entry), k.count === "" ? "—" : String(k.count)] : [k.label, k.count === "" ? "—" : String(k.count)]; }));
  rooms.forEach(function (room) {
    inner += "<h2>" + escapeHtml_(room.name) + "</h2>" + htmlTable_(exit ? ["Élément", "État à l'entrée", "État à la sortie", "Observations"] : ["Élément", "État", "Observations"], (room.items || []).map(function (i) {
      return exit ? [i.name, LA_CONDITION_LABELS_[i.entry] || "—", LA_CONDITION_LABELS_[i.condition] || "—", i.note || ""] : [i.name, LA_CONDITION_LABELS_[i.condition] || "—", i.note || ""]; }));
    if (byRoom[room.name]) inner += laParas_(laFill_(byRoom[room.name], c));
    if (withPhotos && (room.photoDocIds || []).length) {
      const imgs = room.photoDocIds.slice(0, 6).map(pdfImageData_).filter(String);
      for (let i = 0; i < imgs.length; i += 2) inner += "<table class='photos'><tr><td><img src='" + imgs[i] + "'></td><td>" + (imgs[i + 1] ? "<img src='" + imgs[i + 1] + "'>" : "") + "</td></tr></table>";
    }
  });
  if (exit && (sum.differences || []).length) inner += "<h2>Écarts constatés par rapport à l'entrée</h2>" + htmlTable_(["Pièce", "Élément", "Entrée", "Sortie", "Commentaire"], sum.differences.map(function (d) { return [d.room, d.item, d.entry, d.exit, d.comment]; }));
  if (r.generalNote) inner += "<h2>Observations générales</h2>" + laParas_(r.generalNote);
  inner += "<h2>Conclusion</h2>" + laParas_(laFill_(sum.conclusion, c));
  inner += "<p style='margin-top:14px'>Fait à " + escapeHtml_(c.prop.city || edition_().city) + ", le " + pdfDate_(r.inspectionDate) + ", en deux exemplaires.</p><table class='sign'><tr><td><b>Le bailleur ou son représentant</b><br><span class='muted'>signature</span></td><td><b>Le locataire</b><br><span class='muted'>signature</span></td></tr></table>";
  return pdfShell_(exit ? "État des lieux de sortie" : "État des lieux d'entrée", inner, { subtitle: (c.prop.name || "") + " · " + pdfDate_(r.inspectionDate), issuer: rentIssuer_(c.org),
    footer: (draft ? "PROJET — " : "") + "État des lieux établi via " + IMMO_CONFIG.APP_NAME + (r.engine && r.engine !== "MODELE" ? " (rédaction assistée par IA, relevés saisis par le bailleur)" : "") + "." });
}
function inspectionPdf_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.view");
  if (x.r.status === "FINAL" && x.r.documentId) return docGet_(p, { documentId: x.r.documentId });
  const blob = htmlToPdf_(inspectionHtml_(x.c, x.r, true), "Etat_des_lieux_" + (x.r.type === "EXIT" ? "sortie" : "entree") + "_projet");
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
function inspectionFinalize_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.manage");
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
  return out;
}
function inspectionSend_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.manage");
  assert_(x.r.status === "FINAL" && x.r.documentId, "Validez d'abord l'état des lieux.");
  const label = x.r.type === "EXIT" ? "État des lieux de sortie" : "État des lieux d'entrée";
  const out = laSendStored_(p, x.c, x.r.documentId, label + " — " + (x.c.prop.name || ""), safeText_(a.message, 2000) || "Veuillez trouver ci-joint l'" + label.charAt(0).toLowerCase() + label.slice(1) +
    " du logement « " + (x.c.prop.name || "") + " », établi le " + pdfDate_(x.r.inspectionDate) + ". Conservez-le avec votre contrat de location.");
  dbUpdate_("LeaseInspections", x.r.inspectionId, { sentAt: nowIso_(), sentTo: out.sentTo });
  return out;
}
function inspectionCancel_(p, a) {
  const x = inspectionLoad_(p, a.inspectionId, "lease.manage");
  assert_(x.r.status === "DRAFT", "Un état des lieux validé ne peut pas être supprimé.");
  dbUpdate_("LeaseInspections", x.r.inspectionId, { status: "CANCELLED", updatedAt: nowIso_(), updatedBy: p.email });
  return { ok: true };
}
