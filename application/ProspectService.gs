/**
 * Espace Prospects (super administrateur uniquement) : suivi commercial de DarPilot.
 *
 *  - Prospects : agences, conciergeries, syndics, propriétaires (avec consentement) et artisans à référencer, en France et au Maroc.
 *  - Journal par prospect : brouillons préparés, e-mails envoyés, réponses, relances, notes, changements de statut.
 *  - Import : listes Excel / CSV (lues dans le navigateur) ou PDF / photos (lues par l'IA Claude via server.js, /prospects/extract).
 *  - Synchronisation avec l'équipe d'agents commerciaux (tâches planifiées Claude, hors serveur) :
 *      agents → DarPilot : e-mail à l'adresse secrète <IMMO_PROSPECT_INBOX>@<domaine de réception>, reçu par Brevo (inbound parsing)
 *                          puis transmis à server.js (/hooks/brevo-inbound/…) → prospectInboundHook_ ;
 *      DarPilot → agents : chaque jour (jobDaily) ou à la demande, e-mail « [DarPilot-Consignes] » à l'adresse des agents avec les
 *                          prospects importés ou modifiés ici (statut, « ne plus contacter »…) et l'adresse de synchronisation.
 *  Les deux échanges utilisent un bloc JSON encadré par des repères (PROSPECT_SYNC_BEGIN_ / PROSPECT_SYNC_END_).
 *  Aucune clé ni donnée de prospect n'est transmise au navigateur en dehors des routes réservées au super administrateur.
 */

// PROSPECT_TARGETS_, PROSPECT_STATUSES_, PROSPECT_EVENT_KINDS_ : déclarés dans Config.gs (utilisés par le schéma des tables).
/** Statuts qui interdisent tout nouveau contact : une décision prise dans DarPilot n'est jamais écrasée par les agents. */
var PROSPECT_STOP_STATUSES_ = ["desinscrit", "perdu", "refuse"];
/** Étapes du tunnel (tableau de bord). */
var PROSPECT_FUNNEL_ = [["À contacter", ["a_qualifier", "qualifie", "a_envoyer", "a_contacter"]], ["Contactés", ["contacte", "en_pause"]], ["En discussion", ["en_discussion", "interesse"]],
  ["RDV / démo", ["rdv_pris", "demo_faite"]], ["Devis / dossier", ["devis_envoye", "dossier_en_cours", "dossier_complet"]], ["Découverte 2 mois", ["decouverte_2_mois"]],
  ["Clients / artisans actifs", ["client_payant", "verifie", "actif"]], ["Perdus / désinscrits", ["perdu", "desinscrit", "refuse", "suspendu", "froid"]]];
var PROSPECT_SYNC_BEGIN_ = "-----DARPILOT-SYNC-BEGIN-----", PROSPECT_SYNC_END_ = "-----DARPILOT-SYNC-END-----";
var PROSPECT_FIELDS_ = ["country", "territory", "city", "target", "company", "contactName", "role", "email", "phone", "address", "website", "trade", "sourceUrl", "legalBasis", "consent",
  "score", "angle", "status", "nextAction", "nextActionDate", "followUps", "plan", "notes"];
var PROSPECT_LIMITS_ = { importRows: 2000, inboundBytes: 1500000, aiPerHour: 60 };

/* ------------------------------ normalisation ------------------------------ */
function prospectEmail_(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/^mailto:/, "").replace(/[<>()\s]/g, "");
  return s.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/.test(s) ? s : "";
}
/** Téléphone au format international quand le pays est connu (FR +33, MA +212) ; sinon chiffres conservés. */
function prospectPhone_(v, country) {
  let s = String(v == null ? "" : v).replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.indexOf("00") === 0) s = "+" + s.slice(2);
  if (s.charAt(0) !== "+" && /^0\d{9}$/.test(s)) s = (country === "MA" ? "+212" : country === "FR" ? "+33" : "") + (country ? s.slice(1) : s);
  return s.slice(0, 20);
}
function prospectCountry_(v) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  if (!s) return "";
  if (/^(FR|FRA|FRANCE)$/.test(s)) return "FR";
  if (/^(MA|MAR|MAROC|MOROCCO|المغرب)$/.test(s)) return "MA";
  return "";
}
function prospectTarget_(v) {
  const s = String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  if (!s) return "";
  if (PROSPECT_TARGETS_.indexOf(s) >= 0) return s;
  if (/AGENC|IMMOBIL/.test(s)) return "AGENCE";
  if (/CONCIERG|AIRBNB|COURTE|SAISONN/.test(s)) return "CONCIERGERIE";
  if (/SYNDIC|COPRO/.test(s)) return "SYNDIC";
  if (/PROPRI|BAILLEUR|OWNER/.test(s)) return "PROPRIETAIRE";
  if (/ARTISAN|PLOMB|ELECTRI|CLIM|SERRUR|MENAGE|PEINT|PISCIN|JARDIN|MENUIS|VITR|TRAVAUX|BTP|PRESTAT/.test(s)) return "ARTISAN";
  return "AUTRE";
}
function prospectStatus_(v, fallback) {
  const s = String(v == null ? "" : v).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s-]+/g, "_");
  return PROSPECT_STATUSES_.indexOf(s) >= 0 ? s : (fallback || "");
}
function prospectDate_(v) {
  const s = String(v == null ? "" : v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s); if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return "";
}
function prospectUrl_(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const u = /^https?:\/\//i.test(s) ? s : (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s) ? "https://" + s : "");
  return u.slice(0, 500);
}
/** Fiche propre à partir d'un enregistrement quelconque (import, agents, saisie). Les champs absents restent absents. */
function prospectClean_(r, defaults) {
  r = r || {}; defaults = defaults || {};
  const pick = function (k) { return r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== "" ? r[k] : defaults[k]; };
  const country = prospectCountry_(pick("country")), out = {};
  const txt = { territory: 80, city: 80, company: 160, contactName: 120, role: 80, address: 300, trade: 120, legalBasis: 60, consent: 20, angle: 300, nextAction: 300, plan: 60, notes: 2000 };
  Object.keys(txt).forEach(function (k) { const v = pick(k); if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = safeText_(v, txt[k]); });
  if (country) out.country = country;
  const tg = prospectTarget_(pick("target")) || (out.trade ? prospectTarget_(out.trade) : ""); if (tg) out.target = tg;
  const em = prospectEmail_(pick("email")); if (em) out.email = em;
  const ph = prospectPhone_(pick("phone"), country); if (ph) out.phone = ph;
  const web = prospectUrl_(pick("website")); if (web) out.website = web;
  const src = prospectUrl_(pick("sourceUrl")); if (src) out.sourceUrl = src;
  const stt = prospectStatus_(pick("status")); if (stt) out.status = stt;
  const nd = prospectDate_(pick("nextActionDate")); if (nd) out.nextActionDate = nd;
  if (pick("score") !== undefined && String(pick("score")).trim() !== "" && !isNaN(Number(pick("score")))) out.score = Math.max(0, Math.min(100, Math.round(Number(pick("score")))));
  if (pick("followUps") !== undefined && String(pick("followUps")).trim() !== "" && !isNaN(Number(pick("followUps")))) out.followUps = Math.max(0, Math.min(20, Math.round(Number(pick("followUps")))));
  return out;
}
/** Clés de rapprochement (doublons) : e-mail, téléphone, puis nom de structure + ville. */
function prospectKeys_(p) {
  const k = [];
  if (p.externalKey) k.push("x:" + String(p.externalKey).toLowerCase());
  if (p.email) k.push("e:" + p.email);
  if (p.phone && String(p.phone).replace(/\D/g, "").length >= 8) k.push("t:" + String(p.phone).replace(/\D/g, "").slice(-9));
  const name = String(p.company || p.contactName || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (name.length >= 3) k.push("n:" + name + "|" + String(p.city || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim());
  return k;
}
function prospectIndex_() {
  const idx = {};
  dbAll_("Prospects").forEach(function (p) { prospectKeys_(p).forEach(function (k) { if (!idx[k]) idx[k] = p; }); });
  return idx;
}
function prospectFind_(idx, c) { const ks = prospectKeys_(c); for (let i = 0; i < ks.length; i++) if (idx[ks[i]]) return idx[ks[i]]; return null; }

function prospectEvent_(prospectId, kind, summary, source, extra) {
  extra = extra || {};
  return dbInsert_("ProspectEvents", { prospectId: prospectId, kind: oneOf_(kind, PROSPECT_EVENT_KINDS_, "Type d'événement"), at: extra.at || nowIso_(), source: source || "APP",
    summary: safeText_(summary, 1500), channel: safeText_(extra.channel || "", 30), detailsJson: extra.details || {}, actorEmail: extra.actor || "" });
}
function prospectOut_(p) {
  const o = {};
  ["prospectId", "status", "createdAt", "createdBy", "sourceType", "sourceFile", "lastContactAt", "lastReplyAt", "updatedAt", "updatedBy", "updatedSource", "externalKey"].concat(PROSPECT_FIELDS_).forEach(function (k) { if (p[k] !== undefined && p[k] !== "") o[k] = p[k]; });
  o.doNotContact = bool_(p.doNotContact); o.agentPending = bool_(p.agentPending);
  o.due = !!(p.nextActionDate && p.nextActionDate <= todayStr_() && PROSPECT_STOP_STATUSES_.indexOf(p.status) < 0 && !bool_(p.doNotContact));
  o.awaitingReply = !!(p.lastReplyAt && (!p.lastContactAt || String(p.lastReplyAt) > String(p.lastContactAt)));
  return o;
}
function prospectRequire_(id) { const p = dbGet_("Prospects", safeText_(id, 80)); if (!p) throw new AppError("NOT_FOUND", "Prospect introuvable."); return p; }

/* ------------------------------ routes (super administrateur) ------------------------------ */
function prospectDashboard_(p, a) {
  requireSuper_(p);
  const all = dbAll_("Prospects"), today = todayStr_(), weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const count = function (f) { return all.filter(f).length; };
  const funnel = PROSPECT_FUNNEL_.map(function (s) { return { label: s[0], count: count(function (x) { return s[1].indexOf(x.status) >= 0; }) }; });
  const by = function (key, list) { const o = {}; all.forEach(function (x) { const k = x[key] || "—"; o[k] = (o[k] || 0) + 1; }); return (list || Object.keys(o)).map(function (k) { return { key: k, count: o[k] || 0 }; }).filter(function (r) { return r.count; }); };
  const terr = {};
  all.forEach(function (x) {
    const k = (x.country || "?") + "|" + (x.territory || x.city || "—");
    const t = terr[k] || (terr[k] = { country: x.country || "", territory: x.territory || x.city || "—", total: 0, contacted: 0, talking: 0, won: 0, artisans: 0 });
    t.total++; if (x.lastContactAt || ["contacte", "en_pause"].indexOf(x.status) >= 0) t.contacted++;
    if (["en_discussion", "interesse", "rdv_pris", "demo_faite", "devis_envoye", "dossier_en_cours", "dossier_complet"].indexOf(x.status) >= 0) t.talking++;
    if (["client_payant", "decouverte_2_mois", "verifie", "actif"].indexOf(x.status) >= 0) t.won++;
    if (x.target === "ARTISAN") t.artisans++;
  });
  const ev = dbAll_("ProspectEvents").filter(function (e) { return String(e.at) >= weekAgo; });
  const syncs = dbAll_("ProspectSyncs").sort(function (x, y) { return String(y.at).localeCompare(String(x.at)); });
  const lastIn = syncs.find(function (s) { return s.direction === "IN" && s.status !== "REJECTED"; });
  return {
    total: all.length,
    clients: count(function (x) { return x.target !== "ARTISAN"; }), artisans: count(function (x) { return x.target === "ARTISAN"; }),
    toSend: count(function (x) { return x.status === "a_envoyer"; }),
    due: count(function (x) { return x.nextActionDate && x.nextActionDate <= today && PROSPECT_STOP_STATUSES_.indexOf(x.status) < 0 && !bool_(x.doNotContact); }),
    awaitingReply: count(function (x) { return x.lastReplyAt && (!x.lastContactAt || String(x.lastReplyAt) > String(x.lastContactAt)) && PROSPECT_STOP_STATUSES_.indexOf(x.status) < 0; }),
    won: count(function (x) { return x.status === "client_payant"; }), trials: count(function (x) { return x.status === "decouverte_2_mois"; }),
    artisansVerified: count(function (x) { return x.target === "ARTISAN" && ["verifie", "actif"].indexOf(x.status) >= 0; }),
    week: { drafts: ev.filter(function (e) { return e.kind === "DRAFT"; }).length, sent: ev.filter(function (e) { return e.kind === "SENT" || e.kind === "FOLLOWUP"; }).length,
      replies: ev.filter(function (e) { return e.kind === "REPLY"; }).length, added: count(function (x) { return String(x.createdAt) >= weekAgo; }) },
    funnel: funnel, byCountry: by("country", ["FR", "MA"]), byTarget: by("target", PROSPECT_TARGETS_),
    territories: Object.keys(terr).map(function (k) { return terr[k]; }).sort(function (x, y) { return y.total - x.total; }).slice(0, 60),
    lastAgentSync: lastIn ? { at: lastIn.at, summary: parseJson_(lastIn.detailsJson, {}).summary || "", created: lastIn.created, updated: lastIn.updated } : null,
    pendingForAgents: count(function (x) { return bool_(x.agentPending); })
  };
}

function prospectFilter_(a) {
  const q = String(a.q || "").toLowerCase().trim(), today = todayStr_();
  return dbAll_("Prospects").filter(function (x) {
    if (a.status && x.status !== a.status) return false;
    if (a.target && x.target !== a.target) return false;
    if (a.targetGroup === "CLIENTS" && x.target === "ARTISAN") return false;
    if (a.country && x.country !== a.country) return false;
    if (a.territory && String(x.territory || "").toLowerCase() !== String(a.territory).toLowerCase()) return false;
    if (a.source && x.sourceType !== a.source) return false;
    if (bool_(a.due) && !(x.nextActionDate && x.nextActionDate <= today && PROSPECT_STOP_STATUSES_.indexOf(x.status) < 0 && !bool_(x.doNotContact))) return false;
    if (bool_(a.replies) && !(x.lastReplyAt && (!x.lastContactAt || String(x.lastReplyAt) > String(x.lastContactAt)))) return false;
    if (q && [x.company, x.contactName, x.email, x.phone, x.city, x.territory, x.trade, x.notes].join(" ").toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}
function prospectList_(p, a) {
  requireSuper_(p);
  const rows = prospectFilter_(a);
  rows.sort(function (x, y) { return String(y.updatedAt || y.createdAt).localeCompare(String(x.updatedAt || x.createdAt)); });
  const pageSize = Math.min(Math.max(parseInt(a.pageSize, 10) || 25, 5), 200), page = Math.max(parseInt(a.page, 10) || 1, 1);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(prospectOut_), total: rows.length, page: page, pageSize: pageSize };
}

function prospectGet_(p, a) {
  requireSuper_(p);
  const x = prospectRequire_(a.prospectId), id = String(x.prospectId);
  const events = dbAll_("ProspectEvents").filter(function (e) { return String(e.prospectId) === id; }).sort(function (u, v) { return String(v.at).localeCompare(String(u.at)); }).slice(0, 300)
    .map(function (e) { return { eventId: e.eventId, kind: e.kind, at: e.at, source: e.source, summary: e.summary, channel: e.channel, actorEmail: e.actorEmail }; });
  return Object.assign(prospectOut_(x), { events: events });
}

/** Création ou modification manuelle. Création : refus si doublon probable (sauf force). */
function prospectSave_(p, a) {
  requireSuper_(p);
  const c = prospectClean_(a);
  if (a.prospectId) {
    const x = prospectRequire_(a.prospectId);
    const patch = Object.assign({}, c, { updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP", agentPending: true });
    PROSPECT_FIELDS_.forEach(function (k) { if (a[k] !== undefined && String(a[k]).trim() === "" && k !== "status" && k !== "target") patch[k] = ""; });
    if (c.status && c.status !== x.status) prospectEvent_(x.prospectId, "STATUS", (x.status || "—") + " → " + c.status, "APP", { actor: p.email });
    dbUpdate_("Prospects", x.prospectId, patch);
    prospectEvent_(x.prospectId, "EDIT", "Fiche modifiée", "APP", { actor: p.email });
    return { ok: true, prospectId: x.prospectId };
  }
  assert_(c.company || c.contactName, "Indiquez au moins le nom de la structure ou du contact.");
  assert_(c.target, "Choisissez la cible (agence, conciergerie, syndic, propriétaire, artisan).");
  if (!bool_(a.force)) { const dup = prospectFind_(prospectIndex_(), c); if (dup) throw new AppError("VALIDATION", "Doublon probable : " + (dup.company || dup.contactName || dup.email) + ". Ouvrez sa fiche ou confirmez la création."); }
  const row = dbInsert_("Prospects", Object.assign({ status: c.status || (c.target === "ARTISAN" ? "a_contacter" : "a_qualifier"), sourceType: "MANUAL", createdAt: nowIso_(), createdBy: p.email,
    updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP", agentPending: true, legalBasis: c.legalBasis || (c.target === "PROPRIETAIRE" ? "consentement" : "interet_legitime_b2b") }, c));
  prospectEvent_(row.prospectId, "NOTE", "Prospect ajouté manuellement", "APP", { actor: p.email });
  audit_("PROSPECT_CREATED", "Prospect", row.prospectId, "", { target: row.target, country: row.country || "" });
  return { ok: true, prospectId: row.prospectId };
}

function prospectSetStatus_(p, a) {
  requireSuper_(p);
  const x = prospectRequire_(a.prospectId), status = prospectStatus_(a.status);
  assert_(status, "Statut invalide.");
  const patch = { status: status, updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP", agentPending: true };
  if (a.nextAction !== undefined) patch.nextAction = safeText_(a.nextAction, 300);
  if (a.nextActionDate !== undefined) patch.nextActionDate = prospectDate_(a.nextActionDate);
  if (status === "desinscrit") patch.doNotContact = true;
  dbUpdate_("Prospects", x.prospectId, patch);
  prospectEvent_(x.prospectId, "STATUS", (x.status || "—") + " → " + status + (a.note ? " — " + safeText_(a.note, 500) : ""), "APP", { actor: p.email });
  return { ok: true };
}

function prospectNote_(p, a) {
  requireSuper_(p);
  const x = prospectRequire_(a.prospectId), kind = oneOf_(a.kind || "NOTE", ["NOTE", "CALL", "MEETING"], "Type");
  prospectEvent_(x.prospectId, kind, reqText_(a.text, "Texte", 2, 1500), "APP", { actor: p.email });
  const patch = { updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP" };
  if (kind !== "NOTE") patch.lastContactAt = nowIso_();
  dbUpdate_("Prospects", x.prospectId, patch);
  return { ok: true };
}

function prospectDoNotContact_(p, a) {
  requireSuper_(p);
  const x = prospectRequire_(a.prospectId), on = bool_(a.on);
  dbUpdate_("Prospects", x.prospectId, { doNotContact: on, status: on ? "desinscrit" : (x.status === "desinscrit" ? "a_qualifier" : x.status), updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP", agentPending: true });
  prospectEvent_(x.prospectId, "STATUS", on ? "Ne plus contacter (désinscrit)" : "Contact de nouveau autorisé", "APP", { actor: p.email });
  return { ok: true };
}

function prospectExport_(p, a) {
  requireSuper_(p);
  const rows = prospectFilter_(a);
  const cols = ["prospectId", "country", "territory", "city", "target", "company", "contactName", "role", "email", "phone", "address", "website", "trade", "status", "score", "nextAction", "nextActionDate",
    "followUps", "lastContactAt", "lastReplyAt", "sourceType", "sourceUrl", "legalBasis", "consent", "doNotContact", "notes", "createdAt"];
  // Une cellule qui commence par = ou @ (ou + / - suivi d'autre chose qu'un chiffre) serait lue comme une formule par Excel : neutralisée.
  const esc = function (v) { let s = String(v == null ? "" : v); if (/^[=@\t\r]|^[+-][^\d\s]/.test(s)) s = "'" + s; return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(";")].concat(rows.slice(0, IMMO_CONFIG.MAX_EXPORT_ROWS).map(function (r) { return cols.map(function (c) { return esc(c === "doNotContact" ? (bool_(r[c]) ? "oui" : "") : r[c]); }).join(";"); })).join("\n");
  audit_("PROSPECT_EXPORT", "Prospect", "", "", { rows: rows.length });
  return { fileName: "prospects-darpilot-" + todayStr_() + ".csv", mimeType: "text/csv", content: csv };
}

/* ------------------------------ import (Excel / CSV / PDF / photos) ------------------------------ */
/** En-têtes reconnus (minuscules, sans accents). */
var PROSPECT_HEADERS_ = [
  ["email", /(^|\b)(e-?mail|courriel|mail|adresse mail|adresse e mail)(\b|$)/], ["phone", /(tel|telephone|phone|portable|mobile|gsm|whatsapp|fixe|numero)/],
  ["company", /(societe|entreprise|raison sociale|structure|agence|organisation|company|enseigne|cabinet|nom commercial)/], ["contactName", /(contact|nom|prenom|name|interlocuteur|gerant|dirigeant)/],
  ["role", /(fonction|poste|role|titre)/], ["address", /(adresse|address|rue)/], ["city", /(ville|city|commune|localite)/], ["territory", /(departement|region|province|prefecture|territoire|dept)/],
  ["country", /(pays|country)/], ["website", /(site|web|url|internet)/], ["trade", /(metier|activite|specialite|corps d.etat|secteur)/], ["target", /(cible|type|categorie)/],
  ["notes", /(note|commentaire|remarque|observation)/], ["sourceUrl", /(source)/]
];
function prospectMapHeaders_(header) {
  const used = {}, map = [];
  header.forEach(function (hd, i) {
    const s = String(hd == null ? "" : hd).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    let field = "";
    for (let j = 0; j < PROSPECT_HEADERS_.length; j++) { const f = PROSPECT_HEADERS_[j]; if (!used[f[0]] && f[1].test(s)) { field = f[0]; break; } }
    if (field) used[field] = true;
    map.push(field);
  });
  return map;
}
/** Ligne d'en-tête : la première ligne qui contient au moins deux en-têtes reconnus (sinon détection par le contenu). */
function prospectRowsToRecords_(rows) {
  rows = (rows || []).filter(function (r) { return Array.isArray(r) && r.some(function (c) { return String(c == null ? "" : c).trim() !== ""; }); }).slice(0, PROSPECT_LIMITS_.importRows + 10);
  if (!rows.length) return { records: [], mapping: [] };
  let hi = -1, map = [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) { const m = prospectMapHeaders_(rows[i]); if (m.filter(Boolean).length >= 2) { hi = i; map = m; break; } }
  const data = hi >= 0 ? rows.slice(hi + 1) : rows;
  const records = data.map(function (r) {
    const o = {}, extra = [];
    r.forEach(function (cell, i) {
      const v = String(cell == null ? "" : cell).trim(); if (!v) return;
      const f = map[i];
      if (f && !o[f]) { o[f] = v; return; }
      if (!o.email && prospectEmail_(v)) { o.email = v; return; }
      if (!o.phone && /^[+\d][\d\s.()-]{7,}$/.test(v) && v.replace(/\D/g, "").length >= 9) { o.phone = v; return; }
      if (!o.website && /^(https?:\/\/|www\.)/i.test(v)) { o.website = v; return; }
      if (!o.company && hi < 0) { o.company = v; return; }
      extra.push(v);
    });
    if (extra.length) o.notes = (o.notes ? o.notes + " — " : "") + extra.join(" · ");
    return o;
  });
  return { records: records, mapping: hi >= 0 ? rows[hi].map(function (h, i) { return { header: String(h == null ? "" : h), field: map[i] || "" }; }) : [] };
}
/** Prépare l'aperçu : fiches nettoyées, doublons signalés (dans la base et dans le fichier), anomalies. */
function prospectPreviewFrom_(records, defaults) {
  const idx = prospectIndex_(), seen = {};
  const candidates = (records || []).slice(0, PROSPECT_LIMITS_.importRows).map(function (r, i) {
    const c = prospectClean_(r, defaults), issues = [];
    if (!c.target) c.target = "AUTRE";
    if (!c.company && !c.contactName) issues.push("nom manquant");
    if (!c.email && !c.phone) issues.push("ni e-mail ni téléphone");
    if (r.email && !c.email) issues.push("e-mail illisible");
    if (c.target === "PROPRIETAIRE") issues.push("particulier : contact seulement avec consentement");
    const dup = prospectFind_(idx, c), ks = prospectKeys_(c), dupFile = ks.some(function (k) { return seen[k] !== undefined; });
    ks.forEach(function (k) { if (seen[k] === undefined) seen[k] = i; });
    return { row: i + 1, data: c, duplicateOf: dup ? { prospectId: dup.prospectId, label: dup.company || dup.contactName || dup.email || "" } : null, duplicateInFile: dupFile, issues: issues,
      selected: !dup && !dupFile && !!(c.company || c.contactName) && !!(c.email || c.phone) };
  });
  return { candidates: candidates, stats: { rows: candidates.length, selected: candidates.filter(function (c) { return c.selected; }).length,
    duplicates: candidates.filter(function (c) { return c.duplicateOf || c.duplicateInFile; }).length } };
}
function prospectDefaults_(d) {
  d = d || {};
  return { country: prospectCountry_(d.country), target: prospectTarget_(d.target), territory: safeText_(d.territory || "", 80), city: safeText_(d.city || "", 80) };
}
/** Aperçu d'un tableau (Excel / CSV lu dans le navigateur) : { rows: [[...], ...] } ou { records: [{...}] }. */
function prospectImportPreview_(p, a) {
  requireSuper_(p);
  const defaults = prospectDefaults_(a.defaults);
  let mapping = [], records;
  if (Array.isArray(a.rows)) { const r = prospectRowsToRecords_(a.rows); records = r.records; mapping = r.mapping; }
  else records = Array.isArray(a.records) ? a.records.filter(function (x) { return x && typeof x === "object"; }) : [];
  assert_(records.length, "Aucune ligne exploitable dans ce fichier.");
  return Object.assign(prospectPreviewFrom_(records, defaults), { mapping: mapping, fileName: safeText_(a.fileName || "", 160) });
}
/** Enregistre les lignes cochées. Les doublons de la base sont complétés (champs vides seulement) si merge=true. */
function prospectImportCommit_(p, a) {
  requireSuper_(p);
  const defaults = prospectDefaults_(a.defaults), list = (Array.isArray(a.candidates) ? a.candidates : []).slice(0, PROSPECT_LIMITS_.importRows);
  assert_(list.length, "Aucune ligne sélectionnée.");
  const importId = newId_("imp"), file = safeText_(a.fileName || "", 160), idx = prospectIndex_();
  let created = 0, merged = 0, skipped = 0;
  return withLock_(function () {
    list.forEach(function (raw) {
      const c = prospectClean_(raw && raw.data ? raw.data : raw, defaults);
      if (!c.target) c.target = "AUTRE";
      if (!(c.company || c.contactName) || !(c.email || c.phone)) { skipped++; return; }
      const dup = prospectFind_(idx, c);
      if (dup) {
        if (!bool_(a.merge)) { skipped++; return; }
        const patch = {}; Object.keys(c).forEach(function (k) { if (k !== "status" && (dup[k] === undefined || dup[k] === "")) patch[k] = c[k]; });
        if (Object.keys(patch).length) { dbUpdate_("Prospects", dup.prospectId, Object.assign(patch, { updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP", agentPending: true })); prospectEvent_(dup.prospectId, "IMPORT", "Complété par l'import « " + file + " »", "APP", { actor: p.email }); merged++; }
        else skipped++;
        return;
      }
      const row = dbInsert_("Prospects", Object.assign({ status: c.target === "ARTISAN" ? "a_contacter" : "a_qualifier", sourceType: "IMPORT", sourceFile: file, importId: importId,
        legalBasis: c.target === "PROPRIETAIRE" ? "consentement" : "interet_legitime_b2b", createdAt: nowIso_(), createdBy: p.email, updatedAt: nowIso_(), updatedBy: p.email, updatedSource: "APP", agentPending: true }, c));
      prospectKeys_(row).forEach(function (k) { if (!idx[k]) idx[k] = row; });
      prospectEvent_(row.prospectId, "IMPORT", "Importé depuis « " + file + " »", "APP", { actor: p.email });
      created++;
    });
    audit_("PROSPECT_IMPORT", "Prospect", importId, "", { file: file, created: created, merged: merged, skipped: skipped });
    return { ok: true, importId: importId, created: created, merged: merged, skipped: skipped };
  });
}

/* --- lecture IA (PDF / photos) : appelée par server.js hors du routeur, la clé d'IA ne quitte jamais le serveur --- */
function prospectServerRun_(token, fn) {
  ctxReset_(); dbReset_(); LOCK_DEPTH_ = 0; dbcBegin_("request");
  try {
    ensureSchemaCurrent_();
    const p = principalFromToken_(token); CTX_.principal = p; requireSuper_(p);
    return { ok: true, data: fn(p) };
  } catch (e) { return errorResponse_(e, "prospect.extract"); } finally { dbcCommit_(); }
}
var PROSPECT_AI_SYSTEM_ = "Tu extrais des fiches de contacts professionnels à partir d'un document (liste, annuaire, tableau, carte de visite, capture d'écran). " +
  "Réponds UNIQUEMENT par un tableau JSON, sans texte autour. Chaque élément : {\"company\":\"\",\"contactName\":\"\",\"role\":\"\",\"email\":\"\",\"phone\":\"\",\"address\":\"\",\"city\":\"\"," +
  "\"territory\":\"\",\"country\":\"FR|MA|\",\"website\":\"\",\"trade\":\"\",\"target\":\"AGENCE|CONCIERGERIE|SYNDIC|PROPRIETAIRE|ARTISAN|AUTRE\",\"notes\":\"\"}. " +
  "Recopie exactement ce qui est écrit (n'invente ni ne complète aucune donnée ; champ vide si absent). Une entrée par personne ou structure. " +
  "territory = département (France) ou région/province (Maroc) seulement s'il est écrit ou évident d'après le code postal. " +
  "target : agence immobilière → AGENCE ; conciergerie / gestion Airbnb ou courte durée → CONCIERGERIE ; syndic de copropriété → SYNDIC ; propriétaire particulier → PROPRIETAIRE ; " +
  "plombier, électricien, ménage, climatisation, serrurier, peintre, jardinier, piscine, menuisier, travaux… → ARTISAN (métier dans trade) ; sinon AUTRE.";
/** Contrôle d'accès + configuration IA (retour réservé à server.js). */
function prospectExtractGate_(token) {
  return prospectServerRun_(token, function (p) {
    rateLimit_("prospect-ai:" + p.userId, PROSPECT_LIMITS_.aiPerHour, 3600);
    const cfg = aiConfig_();
    if (!cfg || cfg.provider !== "anthropic") throw new AppError("CONFIG", "Lecture des PDF et photos : renseignez la clé de l'IA Claude (IMMO_AI_PROVIDER = anthropic et IMMO_AI_API_KEY) dans la configuration du serveur. Les fichiers Excel et CSV fonctionnent sans IA.");
    let model = ""; try { model = String(PropertiesService.getScriptProperties().getProperty("IMMO_AI_DOC_MODEL") || "").trim(); } catch (e) { model = ""; }
    return { key: cfg.key, model: model || cfg.model, system: PROSPECT_AI_SYSTEM_ };
  });
}
/** Résultat de la lecture IA → aperçu (mêmes contrôles que l'import Excel). */
function prospectExtractFinish_(token, records, meta) {
  return prospectServerRun_(token, function (p) {
    meta = meta || {};
    audit_("PROSPECT_AI_EXTRACT", "Prospect", "", "", { file: safeText_(meta.fileName || "", 160), rows: (records || []).length });
    return Object.assign(prospectPreviewFrom_(Array.isArray(records) ? records.filter(function (x) { return x && typeof x === "object"; }) : [], prospectDefaults_(meta.defaults)),
      { mapping: [], fileName: safeText_(meta.fileName || "", 160), ai: true });
  });
}

/* ------------------------------ synchronisation avec les agents ------------------------------ */
function prospectProps_() { return PropertiesService.getScriptProperties(); }
/** Domaine de réception (Brevo inbound) : propriété IMMO_PROSPECT_DOMAIN, sinon crm.<domaine de l'application>. */
function prospectInboundDomain_() {
  const d = String(prospectProps_().getProperty("IMMO_PROSPECT_DOMAIN") || "").trim().toLowerCase();
  if (d) return d;
  let host = ""; try { host = String(prospectProps_().getProperty("IMMO_APP_URL") || "").replace(/^https?:\/\//, "").split(/[\/:]/)[0].toLowerCase(); } catch (e) { host = ""; }
  const parts = host.split(".").filter(Boolean);
  return parts.length >= 2 && !/^(localhost|\d+)$/.test(parts[parts.length - 1]) ? "crm." + parts.slice(-2).join(".") : "";
}
/** Adresse secrète de réception (générée une fois). Elle n'est transmise qu'au super administrateur et dans les consignes envoyées aux agents. */
function prospectInboxAddress_() {
  const P = prospectProps_();
  let local = String(P.getProperty("IMMO_PROSPECT_INBOX") || "");
  if (!/^agents-[a-f0-9]{24}$/.test(local)) { local = "agents-" + sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + Date.now()).slice(0, 24); P.setProperty("IMMO_PROSPECT_INBOX", local); }
  const dom = prospectInboundDomain_();
  return dom ? local + "@" + dom : "";
}
/** Adresses autorisées à envoyer des synchronisations (et destinataire des consignes) : IMMO_PROSPECT_AGENT_FROM, sinon les super administrateurs. */
function prospectAgentAddresses_() {
  const raw = String(prospectProps_().getProperty("IMMO_PROSPECT_AGENT_FROM") || prospectProps_().getProperty("IMMO_ADMIN_EMAILS") || "");
  return raw.split(/[,;\s]+/).map(prospectEmail_).filter(Boolean);
}
function prospectAgentsInfo_(p, a) {
  requireSuper_(p);
  const syncs = dbAll_("ProspectSyncs").sort(function (x, y) { return String(y.at).localeCompare(String(x.at)); }).slice(0, 40)
    .map(function (s) { return { syncId: s.syncId, direction: s.direction, at: s.at, status: s.status, items: s.items, created: s.created, updated: s.updated, events: s.events, error: s.error, summary: parseJson_(s.detailsJson, {}).summary || "" }; });
  let ai = false; try { const c = aiConfig_(); ai = !!(c && c.provider === "anthropic"); } catch (e) { ai = false; }
  return { inbox: prospectInboxAddress_(), domain: prospectInboundDomain_(), enabled: prospectProps_().getProperty("IMMO_PROSPECT_SYNC") === "1", agentAddresses: prospectAgentAddresses_(), webhook: String(prospectProps_().getProperty("IMMO_PROSPECT_WEBHOOK") || ""),
    aiEnabled: ai, pendingForAgents: dbAll_("Prospects").filter(function (x) { return bool_(x.agentPending); }).length, syncs: syncs,
    mx: [{ priority: 10, value: "inbound1.sendinblue.com." }, { priority: 20, value: "inbound2.sendinblue.com." }] };
}
function prospectAgentsSettings_(p, a) {
  requireSuper_(p);
  const P = prospectProps_();
  if (a.domain !== undefined) { const d = String(a.domain || "").trim().toLowerCase(); assert_(!d || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d), "Domaine invalide (ex. crm.darpilot.fr)."); if (d) P.setProperty("IMMO_PROSPECT_DOMAIN", d); else P.deleteProperty("IMMO_PROSPECT_DOMAIN"); }
  if (a.agentAddresses !== undefined) { const l = String(a.agentAddresses || "").split(/[,;\s]+/).map(prospectEmail_).filter(Boolean); if (l.length) P.setProperty("IMMO_PROSPECT_AGENT_FROM", l.join(",")); else P.deleteProperty("IMMO_PROSPECT_AGENT_FROM"); }
  if (a.enabled !== undefined) P.setProperty("IMMO_PROSPECT_SYNC", bool_(a.enabled) ? "1" : "0");
  if (bool_(a.rotate)) P.deleteProperty("IMMO_PROSPECT_INBOX");
  audit_("PROSPECT_SYNC_SETTINGS", "Prospect", "", "", { domain: prospectInboundDomain_(), enabled: P.getProperty("IMMO_PROSPECT_SYNC") === "1", rotate: bool_(a.rotate) });
  return prospectAgentsInfo_(p, {});
}

/** Bloc JSON encadré par les repères dans un texte d'e-mail. */
function prospectSyncBlock_(text) {
  const s = String(text || ""), i = s.indexOf(PROSPECT_SYNC_BEGIN_), j = s.indexOf(PROSPECT_SYNC_END_);
  if (i < 0 || j < i) return null;
  let raw = s.slice(i + PROSPECT_SYNC_BEGIN_.length, j).replace(/^\s*```(json)?/i, "").replace(/```\s*$/, "").trim();
  raw = raw.replace(/^>\s?/gm, ""); // e-mail cité
  try { return JSON.parse(raw); } catch (e) { return null; }
}
/**
 * Webhook Brevo (inbound parsing) relayé par server.js. Chaque e-mail doit être adressé à l'adresse secrète et venir d'une adresse
 * d'agents autorisée ; sinon il est ignoré (journalisé). Idempotent : un même runId n'est appliqué qu'une fois.
 */
function prospectInboundHook_(body) {
  ctxReset_(); dbReset_(); LOCK_DEPTH_ = 0; dbcBegin_("request");
  try { ensureSchemaCurrent_(); return prospectInboundRun_(body); }
  catch (e) { console.error("Synchronisation agents : " + e.message); return { ok: false, error: String(e.message || e) }; }
  finally { dbcCommit_(); }
}
function prospectInboundRun_(body) {
  const items = (body && Array.isArray(body.items) ? body.items : Array.isArray(body) ? body : [body]).slice(0, 20), out = [];
  const enabled = prospectProps_().getProperty("IMMO_PROSPECT_SYNC") === "1", inbox = prospectInboxAddress_().toLowerCase(), allowed = prospectAgentAddresses_();
  items.forEach(function (it) {
    if (!it || typeof it !== "object") return;
    const to = [].concat(it.To || [], it.Cc || []).map(function (x) { return prospectEmail_(x && (x.Address || x.address || x)); });
    const from = prospectEmail_(it.From && (it.From.Address || it.From.address || it.From));
    const text = String(it.RawTextBody || it.ExtractedMarkdownMessage || "").slice(0, PROSPECT_LIMITS_.inboundBytes);
    const reject = function (why) { dbInsert_("ProspectSyncs", { direction: "IN", at: nowIso_(), status: "REJECTED", error: why, ref: safeText_(it.MessageId || it.Uuid || "", 200), detailsJson: { from: from } }); out.push({ ok: false, error: why }); };
    if (!enabled) return reject("Synchronisation désactivée");
    if (!inbox || to.indexOf(inbox) < 0) return reject("Adresse de réception inconnue");
    if (allowed.indexOf(from) < 0) return reject("Expéditeur non autorisé : " + from);
    const payload = prospectSyncBlock_(text);
    if (!payload) return reject("Bloc de synchronisation absent ou illisible");
    const ref = safeText_(payload.runId || it.MessageId || it.Uuid || "", 200);
    if (ref && dbAll_("ProspectSyncs").some(function (s) { return s.direction === "IN" && s.ref === ref && (s.status === "OK" || s.status === "PARTIAL"); })) { out.push({ ok: true, duplicate: true }); return; }
    out.push(withLock_(function () { return prospectApplyAgents_(payload, ref, from); }));
  });
  return { ok: true, results: out };
}
/** Applique un paquet des agents : fiches (création ou mise à jour) puis événements. Les décisions prises dans DarPilot priment. */
function prospectApplyAgents_(payload, ref, from) {
  const idx = prospectIndex_(), byKey = {}, errors = [];
  let created = 0, updated = 0, events = 0;
  (Array.isArray(payload.prospects) ? payload.prospects : []).slice(0, 1000).forEach(function (r) {
    try {
      if (!r || typeof r !== "object") return;
      const c = prospectClean_(r), key = safeText_(r.key || r.id || c.email || "", 200);
      if (key) c.externalKey = key.toLowerCase();
      let x = prospectFind_(idx, c);
      if (!x) {
        if (!(c.company || c.contactName) || !(c.email || c.phone)) return;
        x = dbInsert_("Prospects", Object.assign({ target: c.target || "AUTRE", status: c.status || (c.target === "ARTISAN" ? "a_contacter" : "a_qualifier"), sourceType: "AGENTS",
          legalBasis: c.legalBasis || "interet_legitime_b2b", createdAt: nowIso_(), createdBy: "agents", updatedAt: nowIso_(), updatedBy: from, updatedSource: "AGENTS" }, c));
        prospectKeys_(x).forEach(function (k) { if (!idx[k]) idx[k] = x; });
        created++;
      } else {
        const locked = bool_(x.doNotContact) || PROSPECT_STOP_STATUSES_.indexOf(x.status) >= 0;
        const patch = { updatedAt: nowIso_(), updatedBy: from, updatedSource: "AGENTS" };
        Object.keys(c).forEach(function (k) {
          if (k === "status") { if (!locked && c.status !== x.status) patch.status = c.status; return; }
          if (k === "notes") return; // les notes des agents vont dans le journal
          if (c[k] !== "" && c[k] !== undefined && String(c[k]) !== String(x[k] == null ? "" : x[k])) patch[k] = c[k];
        });
        if (c.status === "desinscrit") { patch.status = "desinscrit"; patch.doNotContact = true; }
        if (patch.status && patch.status !== x.status) prospectEvent_(x.prospectId, "STATUS", (x.status || "—") + " → " + patch.status, "AGENTS");
        dbUpdate_("Prospects", x.prospectId, patch);
        updated++;
      }
      if (c.notes) prospectEvent_(x.prospectId, "NOTE", c.notes, "AGENTS");
      [key, c.email].filter(Boolean).forEach(function (k) { byKey[String(k).toLowerCase()] = x; });
    } catch (e) { if (errors.length < 20) errors.push(String(e.message || e).slice(0, 200)); }
  });
  (Array.isArray(payload.events) ? payload.events : []).slice(0, 3000).forEach(function (e) {
    try {
      if (!e || typeof e !== "object") return;
      const k = String(e.key || e.email || "").toLowerCase(), kind = String(e.kind || "").toUpperCase();
      let x = byKey[k] || (k ? prospectFind_(idx, { externalKey: k, email: prospectEmail_(k) }) : null);
      if (!x || PROSPECT_EVENT_KINDS_.indexOf(kind) < 0) return;
      const at = /^\d{4}-\d{2}-\d{2}/.test(String(e.at || "")) ? new Date(e.at).toISOString() : nowIso_();
      prospectEvent_(x.prospectId, kind, e.summary || kind, "AGENTS", { at: at, channel: e.channel || "email" });
      const fresh = dbGet_("Prospects", x.prospectId), patch = {};
      if ((kind === "SENT" || kind === "FOLLOWUP") && (!fresh.lastContactAt || at > String(fresh.lastContactAt))) { patch.lastContactAt = at; if (kind === "FOLLOWUP") patch.followUps = num_(fresh.followUps) + 1; }
      if (kind === "REPLY" && (!fresh.lastReplyAt || at > String(fresh.lastReplyAt))) patch.lastReplyAt = at;
      if (Object.keys(patch).length) dbUpdate_("Prospects", x.prospectId, patch);
      events++;
    } catch (err) { if (errors.length < 20) errors.push(String(err.message || err).slice(0, 200)); }
  });
  const summary = payload.summary && typeof payload.summary === "object" ? safeText_(payload.summary.text || "", 3000) : safeText_(payload.summary || "", 3000);
  const status = errors.length ? "PARTIAL" : "OK";
  dbInsert_("ProspectSyncs", { direction: "IN", at: nowIso_(), status: status, items: (payload.prospects || []).length, created: created, updated: updated, events: events, ref: ref,
    error: errors.join(" | ").slice(0, 1000), detailsJson: { from: from, summary: summary, territories: (payload.summary && payload.summary.territories) || [] } });
  return { ok: true, status: status, created: created, updated: updated, events: events, errors: errors.length };
}

/** Consignes DarPilot → agents : fiches à traiter (importées / modifiées ici) et adresse de synchronisation. */
function prospectInstructionsPayload_() {
  const pending = dbAll_("Prospects").filter(function (x) { return bool_(x.agentPending); }).slice(0, 1500);
  return { pending: pending, payload: { version: 1, kind: "consignes", generatedAt: nowIso_(), syncAddress: prospectInboxAddress_(),
    prospects: pending.map(function (x) {
      const o = { key: x.externalKey || x.email || x.prospectId, prospectId: x.prospectId };
      ["country", "territory", "city", "target", "company", "contactName", "role", "email", "phone", "address", "website", "trade", "status", "nextAction", "nextActionDate", "legalBasis", "consent", "sourceType"].forEach(function (k) { if (x[k] !== undefined && x[k] !== "") o[k] = x[k]; });
      o.doNotContact = bool_(x.doNotContact);
      return o;
    }) } };
}
function prospectSendInstructions_(force) {
  const P = prospectProps_();
  if (P.getProperty("IMMO_PROSPECT_SYNC") !== "1") return { skipped: "synchronisation désactivée" };
  const to = prospectAgentAddresses_()[0], addr = prospectInboxAddress_();
  if (!to || !addr) return { skipped: "adresse manquante" };
  const built = prospectInstructionsPayload_();
  if (!built.pending.length && !force && P.getProperty("IMMO_PROSPECT_ADDR_SENT") === addr) return { skipped: "rien à transmettre" };
  const body = "Consignes DarPilot pour l'équipe commerciale automatique (" + built.pending.length + " fiche(s) à prendre en compte).\n" +
    "Adresse de synchronisation à utiliser pour renvoyer votre travail : " + addr + "\n\n" + PROSPECT_SYNC_BEGIN_ + "\n" + JSON.stringify(built.payload) + "\n" + PROSPECT_SYNC_END_ + "\n";
  const r = sendMailSafe_(to, "[DarPilot-Consignes] " + todayStr_() + " — " + built.pending.length + " fiche(s)", body, "prospect-consignes:" + nowIso_(), "", { plain: true });
  if (!r.ok) { dbInsert_("ProspectSyncs", { direction: "OUT", at: nowIso_(), status: "FAILED", items: built.pending.length, error: safeText_(r.error, 500) }); return { ok: false, error: r.error }; }
  built.pending.forEach(function (x) { dbUpdate_("Prospects", x.prospectId, { agentPending: false }); });
  P.setProperty("IMMO_PROSPECT_ADDR_SENT", addr);
  dbInsert_("ProspectSyncs", { direction: "OUT", at: nowIso_(), status: "OK", items: built.pending.length, detailsJson: { to: to } });
  return { ok: true, sent: built.pending.length };
}
function prospectSendNow_(p, a) { requireSuper_(p); return withLock_(function () { return prospectSendInstructions_(true); }); }
/** Tâche quotidienne (jobDaily) : consignes aux agents s'il y a du nouveau. */
function prospectDailyJob_() { return prospectSendInstructions_(false); }
