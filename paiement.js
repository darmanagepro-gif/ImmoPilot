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

  window.ImmoPay = { cfg: cfg, pay: pay, lienSumUpValide: lienSumUpValide, param: param, texte: texte, aller: aller, enregistrerAcceptation: enregistrerAcceptation };
})();
