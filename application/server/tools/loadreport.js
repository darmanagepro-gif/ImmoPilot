#!/usr/bin/env node
/**
 * Rapport du test de charge (résultats de loadtest.js) envoyé par e-mail via l'API Brevo.
 *   node loadreport.js --in /var/tmp/lt-res.json [--to adresse] [--no-mail]
 * Clé Brevo, expéditeur et destinataire par défaut : /etc/immopilot/immopilot.env (jamais affichés).
 */
"use strict";
const fs = require("fs"), https = require("https");
const A = {}; process.argv.slice(2).forEach(function (x, i, arr) { if (x.indexOf("--") === 0) A[x.slice(2)] = arr[i + 1] && arr[i + 1].indexOf("--") !== 0 ? arr[i + 1] : true; });
const R = JSON.parse(fs.readFileSync(A.in || "/var/tmp/lt-res.json", "utf8"));
const env = {}; try { fs.readFileSync(A.env || "/etc/immopilot/immopilot.env", "utf8").split("\n").forEach(function (l) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; }); } catch (e) { /* */ }
const esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
const fmt = function (n) { return Number(n).toLocaleString("fr-FR"); };
const THINK_S = 10; // un utilisateur actif envoie en moyenne une requête toutes les 10 s (lecture, clic, navigation)

const good = R.steps.filter(function (s) { return s.errorRate < 1 && s.p95 < 1000 && !s.processDied; });
const best = good.reduce(function (a, s) { return !a || s.rps > a.rps ? s : a; }, null);
const comfy = R.steps.filter(function (s) { return s.errorRate < 1 && s.p95 < 300; }).reduce(function (a, s) { return !a || s.rps > a.rps ? s : a; }, null);
const worst = R.steps[R.steps.length - 1];
const soak = R.soak || [];
const soakDrift = soak.length > 1 ? { p95a: soak[0].p95, p95b: soak[soak.length - 1].p95, rssA: soak[0].rssMB, rssB: soak[soak.length - 1].rssMB,
  err: soak.reduce(function (n, s) { return n + s.errors; }, 0), req: soak.reduce(function (n, s) { return n + s.requests; }, 0) } : null;
const stable = soakDrift && soakDrift.err === 0 && soakDrift.p95b <= Math.max(50, soakDrift.p95a * 1.5) && soakDrift.rssB <= soakDrift.rssA * 1.3;
const capUsers = best ? Math.floor(best.rps * THINK_S) : 0, comfyUsers = comfy ? Math.floor(comfy.rps * THINK_S) : 0;

const card = function (t, v, s, ok) { return "<td style='width:33%;padding:12px;background:" + (ok === false ? "#fee2e2" : "#f1f5f9") + ";border-radius:10px;vertical-align:top'><div style='font-size:12px;color:#64748b'>" + t + "</div><div style='font-size:22px;font-weight:bold;margin:4px 0'>" + v + "</div><div style='font-size:12px;color:#475569'>" + s + "</div></td>"; };
const th = "padding:6px;border-bottom:2px solid #e2e8f0;text-align:right;font-size:12px;color:#475569";
const td = function (v, bad) { return "<td style='padding:6px;border-bottom:1px solid #eef2f7;text-align:right;" + (bad ? "color:#dc2626;font-weight:bold" : "") + "'>" + v + "</td>"; };
let rows = "";
R.steps.forEach(function (s) {
  rows += "<tr><td style='padding:6px;border-bottom:1px solid #eef2f7'>" + s.users + "</td>" + td(fmt(s.rps)) + td(s.p50 + " ms") + td(s.p95 + " ms", s.p95 >= 1000) + td(s.p99 + " ms", s.p99 >= 2000) +
    td(s.errorRate + " %", s.errorRate >= 1) + td(s.cpuPct == null ? "–" : s.cpuPct + " %") + td(s.rssMB + " Mo") + "</tr>";
});
let srows = "";
soak.forEach(function (s, i) { srows += "<tr><td style='padding:6px;border-bottom:1px solid #eef2f7'>Tranche " + (i + 1) + " (" + s.seconds + " s)</td>" + td(fmt(s.requests)) + td(fmt(s.rps)) + td(s.p95 + " ms") + td(s.errors, s.errors > 0) + td(s.rssMB + " Mo") + "</tr>"; });
const L = R.login || {};

const html = "<div style='font-family:Arial,sans-serif;max-width:780px;margin:0 auto;color:#1d2b3a;line-height:1.45'>" +
  "<h2 style='margin:0'>Dar<span style='color:#c69e63'>Pilot</span> — rapport de stabilité et de charge</h2>" +
  "<div style='color:#64748b;margin:4px 0 16px'>" + esc(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" }).format(new Date(R.startedAt))) +
  " · serveur Hostinger KVM 2 (" + R.cpus + " cœurs, " + fmt(Math.round(R.memTotalMB / 1024)) + " Go) · instance de test copiée de la démo France</div>" +
  "<table style='width:100%;border-spacing:8px;margin:0 -8px'><tr>" +
  card("Utilisateurs actifs simultanés (confortable)", comfy ? "≈ " + fmt(comfyUsers) : "–", "réponses en moins de 0,3 s pour 95 % des requêtes (" + (comfy ? fmt(comfy.rps) + " req/s" : "") + ")") +
  card("Limite par instance", best ? "≈ " + fmt(capUsers) : "–", "réponses &lt; 1 s, moins de 1 % d'erreurs (" + (best ? fmt(best.rps) + " req/s" : "") + ")") +
  card("Connexions par seconde", L.loginsPerSec ? fmt(L.loginsPerSec) : "–", "vérification du mot de passe renforcé : " + (L.p50 || "–") + " ms en moyenne") +
  "</tr><tr>" +
  card("Stabilité (endurance " + Math.round(soak.reduce(function (n, s) { return n + s.seconds; }, 0) / 60) + " min)", stable ? "Stable" : "À surveiller", soakDrift ? fmt(soakDrift.req) + " requêtes, " + soakDrift.err + " erreur(s), mémoire " + soakDrift.rssA + " → " + soakDrift.rssB + " Mo" : "non mesurée", stable) +
  card("Pire palier testé", worst.users + " utilisateurs", "sans pause : p95 " + worst.p95 + " ms, " + worst.errorRate + " % d'erreurs", worst.errorRate < 5) +
  card("Plantage", R.steps.some(function (s) { return s.processDied; }) ? "OUI" : "Aucun", R.stoppedEarly || "le service est resté en ligne pendant tout le test", !R.steps.some(function (s) { return s.processDied; })) +
  "</tr></table>" +
  "<h3>Comment lire ces chiffres</h3><p>Le test envoie des requêtes <b>sans aucune pause</b> (tableau de bord, biens, réservations, baux, factures, notifications…), chaque utilisateur virtuel ayant sa propre adresse. " +
  "Une vraie personne clique en moyenne une fois toutes les " + THINK_S + " secondes : <b>1 requête/seconde soutenue ≈ " + THINK_S + " personnes actives en même temps</b>. Les comptes inscrits peuvent être bien plus nombreux : seuls ceux qui utilisent l'application au même instant comptent.</p>" +
  "<h3>Montée en charge (20 s par palier, sans pause)</h3><table style='width:100%;border-collapse:collapse;font-size:13px'><tr><th style='" + th + ";text-align:left'>Utilisateurs</th><th style='" + th + "'>Req/s</th><th style='" + th + "'>Médiane</th><th style='" + th + "'>95 %</th><th style='" + th + "'>99 %</th><th style='" + th + "'>Erreurs</th><th style='" + th + "'>Processeur</th><th style='" + th + "'>Mémoire</th></tr>" + rows + "</table>" +
  "<h3>Connexions</h3><p>" + (L.users || 0) + " connexions en parallèle pendant " + (L.seconds || 0) + " s : <b>" + fmt(L.logins || 0) + " connexions traitées</b> (" + fmt(L.loginsPerSec || 0) + "/s), médiane " + (L.p50 || 0) + " ms, 95 % sous " + (L.p95 || 0) + " ms, " + (L.unexpected || 0) + " anomalie(s). " +
  "Chaque connexion vérifie le mot de passe avec 600 000 itérations (niveau OWASP) : c'est volontairement coûteux pour un pirate, et c'est l'opération la plus lourde du serveur.</p>" +
  "<h3>Endurance</h3><table style='width:100%;border-collapse:collapse;font-size:13px'><tr><th style='" + th + ";text-align:left'>Période</th><th style='" + th + "'>Requêtes</th><th style='" + th + "'>Req/s</th><th style='" + th + "'>95 %</th><th style='" + th + "'>Erreurs</th><th style='" + th + "'>Mémoire</th></tr>" + srows + "</table>" +
  "<h3>Limites identifiées</h3><ul>" +
  "<li><b>Un seul cœur par instance</b> : chaque version (France, Maroc, chaque démo) traite les requêtes une par une sur un cœur. Le serveur a " + R.cpus + " cœurs partagés entre les 4 instances, Caddy et le système.</li>" +
  "<li><b>Connexions</b> : environ " + fmt(L.loginsPerSec || 0) + " connexions par seconde et par instance, au-delà elles font la queue (quelques secondes d'attente lors d'un pic, sans erreur).</li>" +
  "<li><b>Protection anti-abus</b> : une même adresse IP est limitée à 15 requêtes/s en continu (pointes de 60). Un bureau d'agence entier derrière une seule box reste largement en dessous ; seul un robot est freiné.</li>" +
  "<li><b>Fichiers</b> : 4 Mo maximum par document envoyé ; les PDF (baux, quittances, factures) sont produits un par un par instance.</li></ul>" +
  "<h3>Recommandations</h3><ul>" +
  "<li>" + (comfyUsers >= 200 ? "Pour le lancement, la capacité est largement suffisante : le seuil confortable correspond à environ " + fmt(comfyUsers) + " personnes actives au même instant sur une même version (France ou Maroc)."
    : "La capacité confortable (≈ " + fmt(comfyUsers) + " personnes actives) est à surveiller dès le lancement.") + "</li>" +
  "<li>Quand le tableau de bord quotidien montrera une charge processeur durable au-dessus de 1,5, passer au VPS supérieur (KVM 4, 4 cœurs) : aucune modification du logiciel n'est nécessaire.</li>" +
  "<li>Le contrôle quotidien de 6 h surveille désormais services, sites, certificats, bases, e-mails, sauvegardes, disque, mémoire, charge et sécurité.</li></ul>" +
  "<p style='color:#94a3b8;font-size:12px'>Test réalisé sur le serveur de production, contre une instance temporaire (copie de la démo France, données fictives, aucun e-mail envoyé), supprimée après le test. Les sites clients n'ont pas été sollicités.</p></div>";

const subject = "DarPilot – rapport de stabilité et de charge : " + (best ? "≈ " + fmt(capUsers) + " utilisateurs actifs par instance" : "voir détails") + (stable ? ", stable" : "");
const text = subject + "\n\n" + R.steps.map(function (s) { return s.users + " utilisateurs : " + s.rps + " req/s, p95 " + s.p95 + " ms, erreurs " + s.errorRate + " %"; }).join("\n") +
  "\nConnexions : " + (L.loginsPerSec || 0) + "/s\nEndurance : " + (soakDrift ? soakDrift.req + " requêtes, " + soakDrift.err + " erreurs" : "–");
fs.writeFileSync((A.in || "/var/tmp/lt-res.json").replace(/\.json$/, ".html"), html);
if (A["no-mail"]) { console.log(text); process.exit(0); }
const to = A.to || env.ADMIN_EMAIL;
const payload = JSON.stringify({ sender: { email: env.MAIL_FROM || "no-reply@darpilot.fr", name: "DarPilot" }, to: [{ email: to }], subject: subject, htmlContent: html, textContent: text });
const req = https.request({ host: "api.brevo.com", path: "/v3/smtp/email", method: "POST", headers: { "api-key": env.BREVO_API_KEY || "", "content-type": "application/json", accept: "application/json", "Content-Length": Buffer.byteLength(payload) } }, function (res) {
  res.resume(); res.on("end", function () { console.log(text + "\n\nE-mail " + (res.statusCode === 201 ? "envoyé à " + to : "NON envoyé (HTTP " + res.statusCode + ")")); process.exit(res.statusCode === 201 ? 0 : 3); });
});
req.on("error", function (e) { console.error("Envoi impossible : " + e.message); process.exit(3); });
req.end(payload);
