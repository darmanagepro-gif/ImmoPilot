/**
 * Modèles de documents intégrés : quittance, bail, fiche de réservation.
 * Ils remplacent les modèles Google Docs (indisponibles sur le serveur dédié). Chaque organisation peut écrire son
 * propre texte avec des balises {{cle}} ; laissé vide, le gabarit intégré d'DarPilot est utilisé.
 *
 * Mise en forme simple (le texte est toujours échappé, aucun HTML n'est accepté) :
 *   # Titre de section      → intertitre
 *   **texte**               → gras
 *   ---                     → trait de séparation
 *   [signatures]            → cadres de signature (bailleur / locataire, ou loueur / voyageur)
 *   [entete]                → bailleur en haut à gauche, locataire en haut à droite
 *   [bien]                  → encadré du logement (désignation, adresse, type, surface)
 *   [tableau]               → tableau des sommes (loyer, charges, total)
 *   [coupon]                → coupon de paiement détachable (période, référence, montant, date, mode)
 *   [clauses]               → (bail) tous les articles légaux du contrat, meublé ou vide, conformes à la loi du pays
 *   ligne vide              → nouveau paragraphe
 */
var DOC_TEMPLATES_ = {
  receipt: { key: "template.receipt", title: "Quittance de loyer", signers: ["Le bailleur", "Le locataire"],
    tags: { bailleur: "Nom du bailleur", bailleur_adresse: "Adresse du bailleur", locataire: "Nom du locataire", bien: "Nom du bien", adresse: "Adresse du logement",
      type: "Type de logement", surface: "Surface (m²)", periode: "Période (ex. mars 2026)", du: "Début de la période", au: "Fin de la période", echeance: "Date d'échéance",
      loyer: "Loyer", charges: "Charges", total: "Total réglé", date_paiement: "Date(s) de paiement", mode_paiement: "Mode(s) de paiement",
      reference: "Référence de l'échéance", date: "Date du jour", ville: "Ville du bien" }, blocks: ["[entete]", "[bien]", "[tableau]", "[coupon]", "[signatures]"],
    sample: { bailleur: "SCI Exemple", bailleur_adresse: "12 rue des Lilas, 31000 Toulouse", locataire: "Jean Martin", bien: "Appartement T2", adresse: "5 avenue de la Gare, 3e étage, 31000 Toulouse",
      type: "Appartement", surface: "48", periode: "mars 2026", du: "01/03/2026", au: "31/03/2026", echeance: "05/03/2026", loyer: "750,00", charges: "50,00", total: "800,00", date_paiement: "03/03/2026", mode_paiement: "Virement", reference: "LOY-202603-A1B2C3", date: "05/03/2026", ville: "Toulouse" } },
  lease: { key: "template.lease", title: "Contrat de location", signers: ["Le bailleur", "Le locataire"],
    tags: { bailleur: "Nom du bailleur", bailleur_adresse: "Adresse du bailleur", locataire: "Nom du locataire", locataire_email: "E-mail du locataire", bien: "Nom du bien",
      adresse: "Adresse du logement", type: "Type de logement", surface: "Surface (m²)", debut: "Date de début", fin: "Date de fin", loyer: "Loyer mensuel", charges: "Charges mensuelles",
      caution: "Dépôt de garantie", jour_echeance: "Jour d'échéance", indexation: "Taux d'indexation (%)", conditions: "Conditions particulières", date: "Date du jour", ville: "Ville du bien" },
    blocks: ["[entete]", "[bien]", "[clauses]", "[signatures]"],
    sample: { bailleur: "SCI Exemple", bailleur_adresse: "12 rue des Lilas", locataire: "Jean Martin", locataire_email: "jean.martin@example.com", bien: "Appartement T2",
      adresse: "5 avenue de la Gare, 3e étage", type: "Appartement", surface: "48", debut: "01/04/2026", fin: "31/03/2029", loyer: "750,00", charges: "50,00", caution: "750,00", jour_echeance: "5",
      indexation: "2", conditions: "Animaux non autorisés.", date: "15/03/2026", ville: "Toulouse" } },
  reservation: { key: "template.reservation", title: "Fiche de réservation", signers: ["Le loueur", "Le voyageur"],
    tags: { reference: "Référence de la réservation", loueur: "Nom du loueur", bien: "Nom du bien", adresse: "Adresse du bien", voyageur: "Nom du voyageur", voyageurs: "Nombre de voyageurs",
      arrivee: "Date d'arrivée", depart: "Date de départ", heure_arrivee: "Heure d'arrivée", heure_depart: "Heure de départ", nuits: "Nombre de nuits", prix: "Prix du séjour",
      frais: "Frais", taxes: "Taxes", total: "Total dû", paye: "Déjà payé", solde: "Solde", caution: "Caution", devise: "Devise", statut: "Statut", date: "Date du jour" },
    sample: { reference: "res_0001", loueur: "Conciergerie Exemple", bien: "Studio Centre", adresse: "8 place du Marché", voyageur: "Claire Dubois", voyageurs: "2",
      arrivee: "10/07/2026", depart: "14/07/2026", heure_arrivee: "16:00", heure_depart: "11:00", nuits: "4", prix: "360,00", frais: "40,00", taxes: "8,80", total: "408,80",
      paye: "100,00", solde: "308,80", caution: "300,00", devise: "EUR", statut: "Confirmée", date: "01/07/2026" }, blocks: ["[signatures]"] }
};
var DOC_TEMPLATE_MAX_ = 20000;

/** Texte de départ proposé dans l'éditeur (adapté à l'édition France ou Maroc). */
function docTemplateDefault_(kind) {
  if (kind === "receipt") return [
    "[entete]", "[bien]",
    "Je soussigné(e), **{{bailleur}}**, bailleur du logement désigné ci-dessus, déclare avoir reçu de **{{locataire}}** la somme de **{{total}}** au titre du loyer et des charges de la période du {{du}} au {{au}} (**{{periode}}**), et lui en donne quittance, sous réserve de tous mes droits.",
    "", "[tableau]", "Paiement reçu le {{date_paiement}} ({{mode_paiement}}).", "",
    "Cette quittance annule tous les reçus partiels qui auraient pu être donnés pour la même période.", "", "Fait à {{ville}}, le {{date}}.", "", "[signatures]", "[coupon]"].join("\n");
  if (kind === "lease") return ["[entete]", "[clauses]", "", "Fait à {{ville}}, le {{date}}, en deux exemplaires originaux, dont un remis à chaque partie.", "", "[signatures]"].join("\n");
  return [
    "# Réservation {{reference}}", "Loueur : **{{loueur}}**", "Bien : **{{bien}}**, {{adresse}}", "Voyageur : **{{voyageur}}** ({{voyageurs}} personne(s))", "",
    "# Séjour", "Arrivée le {{arrivee}} à partir de {{heure_arrivee}}, départ le {{depart}} avant {{heure_depart}} ({{nuits}} nuit(s)).", "",
    "# Montants ({{devise}})", "Séjour : {{prix}}", "Frais : {{frais}}", "Taxes : {{taxes}}", "**Total : {{total}}**", "Déjà payé : {{paye}} · **Solde : {{solde}}**", "Caution : {{caution}}", "",
    "Statut : {{statut}}. Fiche établie le {{date}}.", "", "[signatures]"].join("\n");
}

/** Texte → HTML sûr (tout est échappé) avec les balises remplacées. */
function docTemplateHtml_(kind, text, map) {
  const def = DOC_TEMPLATES_[kind];
  const val = function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? String(map[k] == null || map[k] === "" ? "—" : map[k]) : "{{" + k + "}}"; };
  const inline = function (line) {
    return escapeHtml_(String(line).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, function (m, k) { return "\u0001" + k + "\u0002"; }))
      .replace(/\u0001([a-z_]+)\u0002/g, function (m, k) { return escapeHtml_(val(k)); })
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  };
  const out = [], para = [];
  const flush = function () { if (para.length) { out.push("<p>" + para.join("<br>") + "</p>"); para.length = 0; } };
  String(text || "").split(/\r?\n/).forEach(function (raw) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) return flush();
    if (/^#\s+/.test(line)) { flush(); out.push("<h2>" + inline(line.replace(/^#\s+/, "")) + "</h2>"); return; }
    if (/^-{3,}$/.test(line.trim())) { flush(); out.push("<hr style='border:0;border-top:1px solid #c9d3df;margin:12px 0'>"); return; }
    const blk = line.trim().toLowerCase();
    if (blk === "[clauses]") { flush(); out.push(String(map.__clausesHtml || "")); return; }
    if (blk === "[entete]" || blk === "[bien]" || blk === "[tableau]" || blk === "[coupon]") { flush(); out.push(docTemplateBlock_(blk, val)); return; }
    if (line.trim().toLowerCase() === "[signatures]") { flush(); out.push("<table class='sign' style='margin-top:14px'><tr><td><b>" + escapeHtml_(def.signers[0]) + "</b><br><span class='muted'>Lu et approuvé</span></td><td><b>" +
      escapeHtml_(def.signers[1]) + "</b><br><span class='muted'>Lu et approuvé</span></td></tr></table>"); return; }
    para.push(inline(line));
  });
  flush();
  return out.join("");
}

/** Blocs de mise en page (en-tête des parties, logement, tableau des sommes, coupon de paiement). */
function docTemplateBlock_(blk, val) {
  const e = function (k) { return escapeHtml_(val(k)); };
  const has = function (k) { const v = val(k); return v && v !== "—" && v.indexOf("{{") < 0; };
  if (blk === "[entete]") return "<table style='margin:0 0 12px;border:0'><tr>" +
    "<td style='width:50%;border:0;padding:0 12px 0 0;vertical-align:top'><div class='muted' style='font-size:9px;text-transform:uppercase;letter-spacing:.5px'>Bailleur</div><b style='font-size:13px'>" + e("bailleur") + "</b>" +
      (has("bailleur_adresse") ? "<br>" + e("bailleur_adresse") : "") + "</td>" +
    "<td style='width:50%;border:0;padding:0;vertical-align:top;text-align:right'><div class='muted' style='font-size:9px;text-transform:uppercase;letter-spacing:.5px'>Locataire</div><b style='font-size:13px'>" + e("locataire") + "</b>" +
      (has("adresse") ? "<br>" + e("adresse") : "") + "</td></tr></table>";
  if (blk === "[bien]" && val("__bienHtml") && val("__bienHtml").indexOf("{{") < 0) return "<table style='margin:0 0 12px'><tr><th>Désignation du logement loué</th></tr><tr><td>" + val("__bienHtml") + "</td></tr></table>";
  if (blk === "[bien]") return "<table style='width:55%;margin:0 0 12px'><tr><th colspan='2'>Logement loué</th></tr>" +
    [["Désignation", "bien"], ["Adresse", "adresse"], ["Type", "type"], ["Surface", "surface"]].filter(function (r) { return has(r[1]); })
      .map(function (r) { return "<tr><td style='width:32%' class='muted'>" + r[0] + "</td><td>" + e(r[1]) + (r[1] === "surface" ? " m²" : "") + "</td></tr>"; }).join("") + "</table>";
  if (blk === "[tableau]") return "<table style='margin:6px 0 10px'><tr><th>Désignation</th><th>Période</th><th class='right'>Montant</th></tr>" +
    "<tr><td>Loyer (hors charges)</td><td>" + e("periode") + "</td><td class='right'>" + e("loyer") + "</td></tr>" +
    "<tr><td>Provision pour charges</td><td>" + e("periode") + "</td><td class='right'>" + e("charges") + "</td></tr>" +
    "<tr><td colspan='2'><b>Total réglé</b></td><td class='right'><b>" + e("total") + "</b></td></tr></table>";
  if (blk === "[coupon]") return "<div style='margin-top:22px;border-top:1px dashed #94a3b8;padding-top:4px'><div class='muted' style='font-size:9px'>✂ — Coupon de paiement à conserver par le locataire</div>" +
    "<table style='margin-top:6px'><tr><th>Locataire</th><th>Période</th><th>Référence</th><th>Date de paiement</th><th>Mode</th><th class='right'>Montant réglé</th></tr>" +
    "<tr><td>" + e("locataire") + "</td><td>" + e("periode") + "</td><td>" + e("reference") + "</td><td>" + e("date_paiement") + "</td><td>" + e("mode_paiement") + "</td><td class='right'><b>" + e("total") + "</b></td></tr></table>" +
    "<p class='muted' style='margin:4px 0 0;font-size:9px'>Bailleur : " + e("bailleur") + " — logement : " + e("bien") + "</p></div>";
  return "";
}

/** Modèle de l'organisation pour ce type de document ("" = gabarit intégré). */
function docTemplateOf_(kind, orgId) { return String(getSetting_(DOC_TEMPLATES_[kind].key, orgId) || "").trim(); }

/** PDF depuis le modèle texte. opts : { name, subtitle, issuer, footer }. */
function docTemplatePdf_(kind, text, map, opts) {
  opts = opts || {};
  const own = /^\s*\[entete\]\s*$/im.test(String(text || ""));
  return htmlToPdf_(pdfShell_(opts.title || DOC_TEMPLATES_[kind].title, docTemplateHtml_(kind, text, map), { subtitle: opts.subtitle, issuer: own ? null : opts.issuer, noHead: own, footer: opts.footer, ref: opts.ref }), opts.name || kind);
}

function validateDocTemplate_(v) {
  const s = safeText_(v, DOC_TEMPLATE_MAX_);
  const unknown = [];
  s.replace(/\{\{\s*([^}]*?)\s*\}\}/g, function (m, k) { if (!/^[a-z_]+$/.test(k)) unknown.push(k); return m; });
  assert_(!unknown.length, "Balise invalide : {{" + unknown[0] + "}}. Utilisez uniquement les balises proposées (lettres minuscules et _).");
  return s;
}

function assertTemplateOrg_(p, orgId) {
  assert_(orgId, "Organisation requise.");
  if (!p.isSuper) assertOrgCap_(p, orgId, "settings.manage");
}

/** Éditeur : balises disponibles, texte actuel et texte de départ. */
function templateInfo_(p, a) {
  const orgId = safeText_(a.organizationId, 120), kind = oneOf_(a.kind, Object.keys(DOC_TEMPLATES_), "Type de modèle");
  assertTemplateOrg_(p, orgId);
  const d = DOC_TEMPLATES_[kind];
  return { kind: kind, key: d.key, title: d.title, current: docTemplateOf_(kind, orgId), defaultText: docTemplateDefault_(kind),
    tags: Object.keys(d.tags).map(function (k) { return { tag: "{{" + k + "}}", label: d.tags[k] }; }), blocks: d.blocks || [] };
}

/** Données d'exemple d'un aperçu (et, pour le bail, articles légaux d'un bail d'exemple meublé ou vide). */
function templateSample_(kind, orgName, furnished) {
  const map = JSON.parse(JSON.stringify(DOC_TEMPLATES_[kind].sample));
  if (orgName) { if (map.bailleur !== undefined) map.bailleur = orgName; if (map.loueur !== undefined) map.loueur = orgName; }
  let title = "";
  const ecity = edition_().city;
  if (map.ville !== undefined) map.ville = ecity;
  if (map.adresse !== undefined) map.adresse = String(map.adresse).replace(/, 31000 Toulouse$/, "") + ", " + ecity;
  if (map.bailleur_adresse !== undefined) map.bailleur_adresse = "12 rue des Lilas, " + ecity;
  if (map.devise !== undefined) map.devise = cur_();
  if (kind === "lease") { // articles légaux du contrat, sur un bail d'exemple (meublé ou vide)
    const city = edition_().city;
    const c = { l: { leaseId: "lea_exemple", startDate: "2026-04-01", endDate: furnished ? "2027-03-31" : "2029-03-31", monthlyRent: 750, charges: 50, deposit: furnished ? 1500 : 750, dueDay: 5, indexationRate: IMMO_EDITION_ === "MA" ? 0 : 2, terms: "" },
      prop: { name: "Appartement T2", address: "5 avenue de la Gare", city: city, propertyType: "APARTMENT", surfaceM2: 48, bedrooms: 1, bathrooms: 1, floor: 3, doorNumber: "12",
        roomsJson: JSON.stringify(["Séjour", "Cuisine", "Salle d'eau"]), equipmentJson: JSON.stringify(furnished ? ["Plaques de cuisson", "Four", "Réfrigérateur avec freezer", "Vaisselle", "Lit double avec couette", "Rideaux occultants", "Table et chaises", "Rangements"] : ["Plaques de cuisson", "Hotte"]) },
      t: { fullName: map.locataire }, org: { name: map.bailleur } };
    const base = laContractTemplate_(c, { furnished: furnished, usage: "HABITATION", clauses: ["INSURANCE_REQUIRED", "SUBLET_FORBIDDEN"], instructions: "" });
    title = base.title; map.ville = city; map.adresse = "5 avenue de la Gare, " + city;
    map.__bienHtml = laPropertyLines_(c.prop, furnished, IMMO_EDITION_ === "MA").map(escapeHtml_).join("<br>");
    map.__clausesHtml = base.sections.map(function (sc) { return "<h2>" + escapeHtml_(laFill_(sc.title, c)) + "</h2>" + laParas_(laFill_(sc.body, c)); }).join("");
  }
  return { map: map, title: title };
}
/** Aperçu PDF avec des données d'exemple (rien n'est enregistré). */
function templatePreview_(p, a) {
  const orgId = safeText_(a.organizationId, 120), kind = oneOf_(a.kind, Object.keys(DOC_TEMPLATES_), "Type de modèle");
  assertTemplateOrg_(p, orgId);
  const text = validateDocTemplate_(a.text) || docTemplateDefault_(kind);
  const org = dbGet_("Organizations", orgId) || {};
  const smp = templateSample_(kind, org.name, bool_(a.furnished)), map = smp.map, title = smp.title;
  const blob = docTemplatePdf_(kind, text, map, { name: "Apercu_" + kind, subtitle: "APERÇU — données d'exemple", title: title, issuer: { name: org.name || "Votre organisation", lines: [] } });
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
