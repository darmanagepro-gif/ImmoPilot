/**
 * ImmoPilot — SQUELETTE côté serveur pour les paiements SumUp (Google Apps Script).
 *
 * ⚠ Code de référence NON TESTÉ contre un compte SumUp réel. Il est à copier dans le projet Apps Script de l'application,
 *   à adapter aux feuilles existantes (abonnements, factures de missions), puis à tester en mode « sandbox » SumUp.
 *   Vérifier chaque appel dans la documentation SumUp : https://developer.sumup.com
 *
 * Configuration (Paramètres du projet › Propriétés du script) :
 *   SUMUP_API_KEY       clé API SumUp (secrète — jamais dans GitHub)
 *   SUMUP_MERCHANT_CODE code marchand SumUp
 *   SUMUP_CURRENCY      devise du compte SumUp (EUR)
 *   DEVISE_PRIX         devise des prix et des commissions (MAD)
 *   TAUX_CONVERSION     obligatoire si DEVISE_PRIX ≠ SUMUP_CURRENCY : montant en SUMUP_CURRENCY pour 1 unité de DEVISE_PRIX
 *                       (à fixer, à indiquer dans les contrats et à faire valider). Sans lui, le script refuse de créer un paiement.
 *   PRIX_ABONNEMENT     prix mensuel (ex. 29.00)
 *   SITE_URL            https://darmanagepro-gif.github.io/ImmoPilot
 *
 * Branchement dans doGet(e) de l'application existante :
 *   var a = e.parameter.action;
 *   if (a === "sumup_checkout_abonnement") return json_(abonnementCreerCheckout_(e.parameter));
 *   if (a === "sumup_finaliser_abonnement") return json_(abonnementFinaliser_(e.parameter.checkoutId));
 *   if (a === "contrat_accepte")            return json_(contratAccepte_(e.parameter));
 * et un doPost(e) qui appelle webhookSumUp_(e) (URL à déclarer comme return_url / webhook côté SumUp).
 *
 * Déclencheur horaire à créer : prelevementsMensuels (une fois par jour).
 */

var SUMUP_API = "https://api.sumup.com/v0.1";

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/**
 * Les prix et commissions sont en DEVISE_PRIX (MAD) ; SumUp débite dans la devise de votre compte (SUMUP_CURRENCY, EUR).
 * Garde-fou : on ne laisse jamais partir un montant en MAD tel quel vers un compte en EUR (le client paierait ~10 fois trop).
 */
function versDevisePaiement_(montant) {
  var devPrix = prop_("DEVISE_PRIX") || "MAD", devSumUp = prop_("SUMUP_CURRENCY");
  if (devPrix === devSumUp) return Number(montant);
  var taux = Number(prop_("TAUX_CONVERSION"));
  if (!(taux > 0)) throw new Error("Devise des prix (" + devPrix + ") différente de celle de SumUp (" + devSumUp + ") : définir TAUX_CONVERSION");
  return Math.round(Number(montant) * taux * 100) / 100;
}

function sumup_(methode, chemin, corps) {
  var r = UrlFetchApp.fetch(SUMUP_API + chemin, {
    method: methode, contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + prop_("SUMUP_API_KEY") },
    payload: corps ? JSON.stringify(corps) : undefined
  });
  var code = r.getResponseCode(), txt = r.getContentText(), j;
  try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
  if (code >= 300) throw new Error("SumUp " + code + " " + chemin + " : " + txt);
  return j;
}

/* ---------- Feuille « Abonnements » : à adapter à votre classeur ---------- */
var COLS_ABO = ["customer_id", "email", "nom", "checkout_ref", "token", "statut", "prochain_prelevement", "contrat_signe_le", "paiement_ref"];
function feuilleAbo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), f = ss.getSheetByName("Abonnements");
  if (!f) { f = ss.insertSheet("Abonnements"); f.appendRow(COLS_ABO); }
  return f;
}
function trouverAbo_(col, valeur) {
  var f = feuilleAbo_(), d = f.getDataRange().getValues(), c = COLS_ABO.indexOf(col);
  for (var i = 1; i < d.length; i++) if (String(d[i][c]) === String(valeur)) return { ligne: i + 1, abo: lireLigne_(d[i]) };
  return null;
}
function lireLigne_(l) { var o = {}; COLS_ABO.forEach(function (k, i) { o[k] = l[i]; }); return o; }
function majAbo_(ligne, champs) {
  var f = feuilleAbo_();
  Object.keys(champs).forEach(function (k) { f.getRange(ligne, COLS_ABO.indexOf(k) + 1).setValue(champs[k]); });
}

/* ---------- 1. Abonnement : client + checkout de mise en carte (tokenisation) ---------- */
function abonnementCreerCheckout_(p) {
  var email = String(p.email || "").trim().slice(0, 200), nom = String(p.nom || "").trim().slice(0, 100);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email) || nom.length < 2) return { erreur: "donnees" };
  var customerId = "abo-" + Utilities.getUuid();
  sumup_("post", "/customers", { customer_id: customerId, personal_details: { email: email, first_name: nom } });
  var ref = "ABO-SETUP-" + Utilities.getUuid();
  var co = sumup_("post", "/checkouts", {
    checkout_reference: ref, amount: 1, currency: prop_("SUMUP_CURRENCY"), merchant_code: prop_("SUMUP_MERCHANT_CODE"),
    description: "ImmoPilot — enregistrement de la carte", customer_id: customerId, purpose: "SETUP_RECURRING_PAYMENT"
  });
  feuilleAbo_().appendRow([customerId, email, nom, co.id, "", "EN_ATTENTE", "", "", ""]);
  return { checkoutId: co.id };
}

/* ---------- 2. Après saisie de la carte : débit du 1er mois, activation, signature du contrat ---------- */
function abonnementFinaliser_(checkoutId) {
  var t = trouverAbo_("checkout_ref", checkoutId);
  if (!t) return { ok: false };
  // On ne fait jamais confiance au navigateur : on relit le checkout chez SumUp.
  var setup = sumup_("get", "/checkouts/" + encodeURIComponent(checkoutId));
  var token = setup.payment_instrument && setup.payment_instrument.token;
  if (!token) return { ok: false };

  var ref = "ABO-" + Utilities.getUuid();
  var co = sumup_("post", "/checkouts", {
    checkout_reference: ref, amount: versDevisePaiement_(prop_("PRIX_ABONNEMENT")), currency: prop_("SUMUP_CURRENCY"),
    merchant_code: prop_("SUMUP_MERCHANT_CODE"), description: "ImmoPilot — abonnement, 1er mois", customer_id: t.abo.customer_id
  });
  var res = sumup_("put", "/checkouts/" + co.id, { payment_type: "card", token: token, customer_id: t.abo.customer_id });
  if (res.status !== "PAID") return { ok: false };

  var maintenant = new Date(), suivant = new Date(maintenant); suivant.setMonth(suivant.getMonth() + 1);
  majAbo_(t.ligne, { token: token, statut: "ACTIF", prochain_prelevement: suivant, contrat_signe_le: maintenant, paiement_ref: ref });
  // Contrat signé = acceptation (cases cochées, enregistrée par contratAccepte_) + 1er paiement confirmé ici.
  // TODO : envoyer au client le contrat (page contrat-abonnement.html, version v1.0) et le reçu par e-mail (MailApp).
  return { ok: true };
}

/* ---------- 3. Prélèvements mensuels (déclencheur quotidien) ---------- */
function prelevementsMensuels() {
  var f = feuilleAbo_(), d = f.getDataRange().getValues(), auj = new Date();
  for (var i = 1; i < d.length; i++) {
    var a = lireLigne_(d[i]);
    if (a.statut !== "ACTIF" || !a.token || !a.prochain_prelevement || new Date(a.prochain_prelevement) > auj) continue;
    try {
      var ref = "ABO-" + Utilities.getUuid();
      var co = sumup_("post", "/checkouts", {
        checkout_reference: ref, amount: versDevisePaiement_(prop_("PRIX_ABONNEMENT")), currency: prop_("SUMUP_CURRENCY"),
        merchant_code: prop_("SUMUP_MERCHANT_CODE"), description: "ImmoPilot — abonnement mensuel", customer_id: a.customer_id
      });
      var res = sumup_("put", "/checkouts/" + co.id, { payment_type: "card", token: a.token, customer_id: a.customer_id });
      if (res.status === "PAID") {
        var s = new Date(a.prochain_prelevement); s.setMonth(s.getMonth() + 1);
        majAbo_(i + 1, { prochain_prelevement: s, paiement_ref: ref });
      } else { majAbo_(i + 1, { statut: "IMPAYE" }); } // TODO : relance par e-mail, suspension après le délai du contrat
    } catch (e) { majAbo_(i + 1, { statut: "IMPAYE" }); }
  }
}

/* Résiliation : à appeler depuis l'application. Plus aucun prélèvement ; l'accès reste ouvert jusqu'à « prochain_prelevement ». */
function abonnementResilier_(email) {
  var t = trouverAbo_("email", email);
  if (t) majAbo_(t.ligne, { statut: "RESILIE" });
}

/* ---------- 4. Mission : lien de paiement SumUp créé pour UNE facture validée ---------- */
/**
 * Commissions d'une mission, calculées sur le montant TTC de la facture finale (en centimes, arrondi au plus proche) :
 *   - commanditaire (propriétaire ou agence) : 6 %, payée EN PLUS du prix de la facture ;
 *   - artisan : 15 %, retenue sur ce qui lui est reversé.
 * Les taux doivent rester identiques à ceux de config.js (paiement.commissions) et du contrat.
 */
var TAUX_COMMANDITAIRE = 6, TAUX_ARTISAN = 15;
function commissionsMission_(ttc) {
  var c = Math.round(Number(ttc) * 100);
  if (!(c > 0)) throw new Error("Montant TTC invalide");
  var cm = Math.round(c * TAUX_COMMANDITAIRE / 100), ca = Math.round(c * TAUX_ARTISAN / 100);
  return { ttc: c / 100, commissionCommanditaire: cm / 100, totalAPayer: (c + cm) / 100, commissionArtisan: ca / 100, netArtisan: (c - ca) / 100 };
}

function missionCreerLienPaiement_(factureId, montantTtc, description) {
  var m = commissionsMission_(montantTtc); // le commanditaire paie la facture TTC + sa commission, en un seul paiement
  var co = sumup_("post", "/checkouts", {
    checkout_reference: "MISSION-" + factureId, amount: versDevisePaiement_(m.totalAPayer), currency: prop_("SUMUP_CURRENCY"),
    merchant_code: prop_("SUMUP_MERCHANT_CODE"), description: String(description || "Mission ImmoPilot").slice(0, 200),
    redirect_url: prop_("SITE_URL") + "/payer-mission.html?retour=1&ref=" + encodeURIComponent(factureId),
    hosted_checkout: { enabled: true } // à vérifier dans la doc SumUp (page de paiement hébergée)
  });
  return co.hosted_checkout_url; // à placer dans le paramètre « lien » de payer-mission.html
}

/* ---------- 5. Webhook SumUp : confirmation fiable du paiement ---------- */
function webhookSumUp_(e) {
  var corps = JSON.parse(e.postData.contents || "{}");
  var id = corps.id || (corps.payload && corps.payload.checkout_id);
  if (!id) return json_({ ok: false });
  // On ne croit pas le contenu reçu : on relit le checkout chez SumUp.
  var co = sumup_("get", "/checkouts/" + encodeURIComponent(id));
  if (co.status === "PAID" && String(co.checkout_reference).indexOf("MISSION-") === 0) {
    // TODO : marquer la facture « payée » ; retrouver le TTC de la facture (feuille des factures) et appeler commissionsMission_(ttc) :
    //        reverser m.netArtisan à l'artisan (TTC − 15 %), conserver m.commissionCommanditaire + m.commissionArtisan ;
    //        activer la couverture d'assurance et éditer le contrat (contrat-mission.html?mode=ligne&…).
  }
  return json_({ ok: true });
}

/* ---------- 6. Trace d'acceptation des contrats (envoyée par paiement.js si enregistrerAcceptation = true) ---------- */
function contratAccepte_(p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), f = ss.getSheetByName("Acceptations") || ss.insertSheet("Acceptations");
  f.appendRow([new Date(), p.type, p.version, p.date, p.nom || "", p.email || "", p.ref || "", p.montant || ""]);
  return { ok: true };
}
