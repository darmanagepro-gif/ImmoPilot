/*
 * Outils communs aux pages de paiement et de contrats d'ImmoPilot.
 * Aucune donnée de carte ne passe par ce site : le paiement se fait chez SumUp.
 */
(function () {
  "use strict";
  var cfg = window.IMMOPILOT_CONFIG || {};
  var pay = cfg.paiement || {};

  // Accepte uniquement une adresse https dont le domaine figure dans la liste autorisée (évite les redirections malveillantes).
  function lienSumUpValide(u) {
    try {
      var x = new URL(String(u));
      if (x.protocol !== "https:") return false;
      var h = x.hostname.toLowerCase();
      return (pay.hotesAutorises || []).some(function (a) { return h === a || h.slice(-(a.length + 1)) === "." + a; });
    } catch (e) { return false; }
  }

  // Lit un paramètre d'URL et le valide par une expression régulière ; renvoie "" s'il est absent ou invalide.
  function param(nom, re) {
    var v = new URLSearchParams(location.search).get(nom);
    return v && re.test(v) ? v : "";
  }

  function texte(id, valeur) { var e = document.getElementById(id); if (e && valeur) e.textContent = valeur; }

  function aller(url) {
    if (!lienSumUpValide(url)) return false;
    location.href = url;
    return true;
  }

  // Trace d'acceptation (horodatée) conservée sur l'appareil ; envoi facultatif à l'application si activé dans config.js.
  function enregistrerAcceptation(type, details) {
    var trace = { type: type, version: "v1.0-2026-10-14", date: new Date().toISOString(), details: details || {} };
    try { localStorage.setItem("immopilot-acceptation-" + type, JSON.stringify(trace)); } catch (e) { /* facultatif */ }
    if (pay.enregistrerAcceptation && cfg.appUrl) {
      try {
        var q = new URLSearchParams({ action: "contrat_accepte", type: type, version: trace.version, date: trace.date });
        Object.keys(trace.details).forEach(function (k) { q.set(k, String(trace.details[k]).slice(0, 200)); });
        fetch(cfg.appUrl + "?" + q.toString(), { mode: "no-cors" });
      } catch (e) { /* facultatif */ }
    }
    return trace;
  }

  // Taux de commission (en %), 6 et 15 par défaut.
  function taux() {
    var c = pay.commissions || {};
    return { commanditaire: Number(c.commanditaire) >= 0 ? Number(c.commanditaire) : 6, artisan: Number(c.artisan) >= 0 ? Number(c.artisan) : 15 };
  }

  // Calcul en centimes, arrondi au centime le plus proche. « ttcTexte » = montant TTC de la facture finale ("450.50" ou "450,50").
  //  commanditaire : commission payée en plus de la facture ; total : ce que paie le commanditaire ;
  //  artisan : commission retenue ; net : ce que reçoit l'artisan.
  function commissions(ttcTexte) {
    var ttc = Math.round(parseFloat(String(ttcTexte).replace(",", ".")) * 100);
    if (!isFinite(ttc) || ttc <= 0) return null;
    var t = taux(), cm = Math.round(ttc * t.commanditaire / 100), ca = Math.round(ttc * t.artisan / 100);
    return { ttc: ttc, commanditaire: cm, total: ttc + cm, artisan: ca, net: ttc - ca, taux: t };
  }

  function montantTexte(centimes) {
    return (centimes / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  window.ImmoPay = { cfg: cfg, pay: pay, lienSumUpValide: lienSumUpValide, param: param, texte: texte, aller: aller, enregistrerAcceptation: enregistrerAcceptation, taux: taux, commissions: commissions, montantTexte: montantTexte };
})();
