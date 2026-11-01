/**
 * Modèles de documents intégrés : quittance, bail, fiche de réservation.
 * Ils remplacent les modèles Google Docs (indisponibles sur le serveur dédié). Chaque organisation peut écrire son
 * propre texte avec des balises {{cle}} ; laissé vide, le gabarit intégré d'ImmoPilot est utilisé.
 *
 * Mise en forme simple (le texte est toujours échappé, aucun HTML n'est accepté) :
 *   # Titre de section      → intertitre
 *   **texte**               → gras
 *   ---                     → trait de séparation
 *   [signatures]            → cadres de signature (bailleur / locataire, ou loueur / voyageur)
 *   ligne vide              → nouveau paragraphe
 */
var DOC_TEMPLATES_ = {
  receipt: { key: "template.receipt", title: "Quittance de loyer", signers: ["Le bailleur", "Le locataire"],
    tags: { bailleur: "Nom du bailleur", bailleur_adresse: "Adresse du bailleur", locataire: "Nom du locataire", bien: "Nom du bien", adresse: "Adresse du logement",
      periode: "Période (ex. mars 2026)", loyer: "Loyer", charges: "Charges", total: "Total réglé", date_paiement: "Date(s) de paiement", mode_paiement: "Mode(s) de paiement",
      reference: "Référence de l'échéance", date: "Date du jour", ville: "Ville du bien" },
    sample: { bailleur: "SCI Exemple", bailleur_adresse: "12 rue des Lilas", locataire: "Jean Martin", bien: "Appartement T2", adresse: "5 avenue de la Gare, 3e étage",
      periode: "mars 2026", loyer: "750,00", charges: "50,00", total: "800,00", date_paiement: "03/03/2026", mode_paiement: "Virement", reference: "LOY-202603-A1B2C3", date: "05/03/2026", ville: "Toulouse" } },
  lease: { key: "template.lease", title: "Contrat de location", signers: ["Le bailleur", "Le locataire"],
    tags: { bailleur: "Nom du bailleur", bailleur_adresse: "Adresse du bailleur", locataire: "Nom du locataire", locataire_email: "E-mail du locataire", bien: "Nom du bien",
      adresse: "Adresse du logement", surface: "Surface (m²)", debut: "Date de début", fin: "Date de fin", loyer: "Loyer mensuel", charges: "Charges mensuelles",
      caution: "Dépôt de garantie", jour_echeance: "Jour d'échéance", indexation: "Taux d'indexation (%)", conditions: "Conditions particulières", date: "Date du jour", ville: "Ville du bien" },
    sample: { bailleur: "SCI Exemple", bailleur_adresse: "12 rue des Lilas", locataire: "Jean Martin", locataire_email: "jean.martin@example.com", bien: "Appartement T2",
      adresse: "5 avenue de la Gare, 3e étage", surface: "48", debut: "01/04/2026", fin: "31/03/2029", loyer: "750,00", charges: "50,00", caution: "750,00", jour_echeance: "5",
      indexation: "2", conditions: "Animaux non autorisés.", date: "15/03/2026", ville: "Toulouse" } },
  reservation: { key: "template.reservation", title: "Fiche de réservation", signers: ["Le loueur", "Le voyageur"],
    tags: { reference: "Référence de la réservation", loueur: "Nom du loueur", bien: "Nom du bien", adresse: "Adresse du bien", voyageur: "Nom du voyageur", voyageurs: "Nombre de voyageurs",
      arrivee: "Date d'arrivée", depart: "Date de départ", heure_arrivee: "Heure d'arrivée", heure_depart: "Heure de départ", nuits: "Nombre de nuits", prix: "Prix du séjour",
      frais: "Frais", taxes: "Taxes", total: "Total dû", paye: "Déjà payé", solde: "Solde", caution: "Caution", devise: "Devise", statut: "Statut", date: "Date du jour" },
    sample: { reference: "res_0001", loueur: "Conciergerie Exemple", bien: "Studio Centre", adresse: "8 place du Marché", voyageur: "Claire Dubois", voyageurs: "2",
      arrivee: "10/07/2026", depart: "14/07/2026", heure_arrivee: "16:00", heure_depart: "11:00", nuits: "4", prix: "360,00", frais: "40,00", taxes: "8,80", total: "408,80",
      paye: "100,00", solde: "308,80", caution: "300,00", devise: "EUR", statut: "Confirmée", date: "01/07/2026" } }
};
var DOC_TEMPLATE_MAX_ = 20000;

/** Texte de départ proposé dans l'éditeur (adapté à l'édition France ou Maroc). */
function docTemplateDefault_(kind) {
  const law = edition_().leaseLaw;
  if (kind === "receipt") return [
    "Je soussigné(e), **{{bailleur}}**, bailleur du logement situé {{adresse}} ({{bien}}), déclare avoir reçu de **{{locataire}}** la somme de **{{total}}** au titre du loyer et des charges de la période **{{periode}}**, et lui en donne quittance, sous réserve de tous mes droits.",
    "", "# Détail", "Loyer : {{loyer}}", "Charges : {{charges}}", "**Total réglé : {{total}}**", "", "Paiement reçu le {{date_paiement}} ({{mode_paiement}}). Référence : {{reference}}.",
    "", "Cette quittance annule tous les reçus partiels qui auraient pu être donnés pour la même période.", "", "Fait à {{ville}}, le {{date}}.", "", "[signatures]"].join("\n");
  if (kind === "lease") return [
    "Entre les soussignés :", "", "**{{bailleur}}**, {{bailleur_adresse}}, ci-après « le bailleur »,", "", "et **{{locataire}}** ({{locataire_email}}), ci-après « le locataire ».", "",
    "# 1. Objet", "Le bailleur loue au locataire le logement « {{bien}} » situé {{adresse}}, d'une surface de {{surface}} m², à usage d'habitation principale.", "",
    "# 2. Durée", "Le bail prend effet le {{debut}} et se termine le {{fin}}.", "",
    "# 3. Loyer et charges", "Loyer mensuel : **{{loyer}}**, charges : **{{charges}}**, payables d'avance le {{jour_echeance}} de chaque mois. Indexation annuelle : {{indexation}} %.", "",
    "# 4. Dépôt de garantie", "Un dépôt de garantie de **{{caution}}** est versé à la signature et restitué selon les règles en vigueur.", "",
    "# 5. Conditions particulières", "{{conditions}}", "", "---",
    "Modèle indicatif à adapter et à faire valider par un professionnel du " + law + " avant signature.", "", "Fait à {{ville}}, le {{date}}, en deux exemplaires.", "", "[signatures]"].join("\n");
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
    if (line.trim().toLowerCase() === "[signatures]") { flush(); out.push("<table class='sign' style='margin-top:14px'><tr><td><b>" + escapeHtml_(def.signers[0]) + "</b><br><span class='muted'>Lu et approuvé</span></td><td><b>" +
      escapeHtml_(def.signers[1]) + "</b><br><span class='muted'>Lu et approuvé</span></td></tr></table>"); return; }
    para.push(inline(line));
  });
  flush();
  return out.join("");
}

/** Modèle de l'organisation pour ce type de document ("" = gabarit intégré). */
function docTemplateOf_(kind, orgId) { return String(getSetting_(DOC_TEMPLATES_[kind].key, orgId) || "").trim(); }

/** PDF depuis le modèle texte. opts : { name, subtitle, issuer, footer }. */
function docTemplatePdf_(kind, text, map, opts) {
  opts = opts || {};
  return htmlToPdf_(pdfShell_(DOC_TEMPLATES_[kind].title, docTemplateHtml_(kind, text, map), { subtitle: opts.subtitle, issuer: opts.issuer, footer: opts.footer }), opts.name || kind);
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
    tags: Object.keys(d.tags).map(function (k) { return { tag: "{{" + k + "}}", label: d.tags[k] }; }) };
}

/** Aperçu PDF avec des données d'exemple (rien n'est enregistré). */
function templatePreview_(p, a) {
  const orgId = safeText_(a.organizationId, 120), kind = oneOf_(a.kind, Object.keys(DOC_TEMPLATES_), "Type de modèle");
  assertTemplateOrg_(p, orgId);
  const text = validateDocTemplate_(a.text) || docTemplateDefault_(kind);
  const org = dbGet_("Organizations", orgId) || {};
  const map = JSON.parse(JSON.stringify(DOC_TEMPLATES_[kind].sample));
  if (org.name) { if (map.bailleur !== undefined) map.bailleur = org.name; if (map.loueur !== undefined) map.loueur = org.name; }
  const blob = docTemplatePdf_(kind, text, map, { name: "Apercu_" + kind, subtitle: "APERÇU — données d'exemple" });
  return { fileName: blob.getName(), mimeType: "application/pdf", base64: Utilities.base64Encode(blob.getBytes()) };
}
