#!/usr/bin/env node
/**
 * Contrôle quotidien de l'état des services DarPilot (installé : /usr/local/sbin/immopilot-health, lancé par cron en root).
 * Chaque point est noté OK (vert) ou NOK (rouge) ; le rapport est envoyé par e-mail via l'API Brevo
 * (clé et destinataire lus dans /etc/immopilot/immopilot.env, jamais affichés) et ajouté à /var/log/immopilot-health.log.
 *
 *   immopilot-health            → n'envoie qu'à 6 h (heure de Paris) : cron le lance à 4 h et 5 h UTC (été / hiver)
 *   immopilot-health --now      → contrôle et envoi immédiats
 *   immopilot-health --no-mail  → contrôle seul (affichage)
 */
"use strict";
const fs = require("fs"), cp = require("child_process"), https = require("https"), tls = require("tls"), path = require("path");
const ARGS = process.argv.slice(2), NOW = ARGS.indexOf("--now") >= 0, NOMAIL = ARGS.indexOf("--no-mail") >= 0;
const ENV_MAIN = process.env.ENV_FILE || "/etc/immopilot/immopilot.env";
const DOMAIN = process.env.HEALTH_DOMAIN || "darpilot.fr", OLD_DOMAIN = process.env.HEALTH_OLD_DOMAIN || "immopilotapp.fr";
const INSTANCES = [
  { name: "France", unit: "immopilot", env: "/etc/immopilot/immopilot.env", host: "fr." + DOMAIN },
  { name: "Maroc", unit: "immopilot-ma", env: "/etc/immopilot/ma.env", host: "ma." + DOMAIN },
  { name: "Démo France", unit: "immopilot-demo-fr", env: "/etc/immopilot/demo-fr.env", host: "demo-fr." + DOMAIN, demo: true },
  { name: "Démo Maroc", unit: "immopilot-demo-ma", env: "/etc/immopilot/demo-ma.env", host: "demo-ma." + DOMAIN, demo: true }
];

// cron fournit un PATH minimal : sans /usr/sbin, des outils comme ufw seraient introuvables.
process.env.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** Heure à Paris (0-23), lue champ par champ : le format français affiche « 06 h », illisible comme nombre. */
function parisHour(d) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).formatToParts(d || new Date()).find(function (x) { return x.type === "hour"; });
  return p ? Number(p.value) : -1;
}
if (ARGS.indexOf("--self-test") >= 0) {
  // Contrôle de la règle d'envoi : 6 h à Paris, en hiver (UTC+1) comme en été (UTC+2).
  const cases = [["2026-11-05T05:00:00Z", 6], ["2026-11-05T04:00:00Z", 5], ["2026-07-05T04:00:00Z", 6], ["2026-07-05T05:00:00Z", 7]];
  const bad = cases.filter(function (c) { return parisHour(new Date(c[0])) !== c[1]; });
  console.log(bad.length ? "ECHEC : " + JSON.stringify(bad) : "OK : envoi à 6 h (heure de Paris) en hiver et en été");
  process.exit(bad.length ? 1 : 0);
}
if (!NOW && !NOMAIL && parisHour() !== 6) process.exit(0); // l'autre déclenchement (heure d'été / d'hiver) ne fait rien

function readEnv(f) { const o = {}; try { fs.readFileSync(f, "utf8").split("\n").forEach(function (l) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch (e) { /* absent */ } return o; }
function sh(cmd) { try { return cp.execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 }).trim(); } catch (e) { return (e.stdout || "").toString().trim(); } }
function get(url, opts) {
  return new Promise(function (resolve) {
    const t0 = Date.now(), u = new URL(url);
    const req = https.request({ host: u.hostname, path: u.pathname + u.search, method: (opts && opts.method) || "GET", timeout: 15000, headers: (opts && opts.headers) || {} }, function (res) {
      let b = ""; res.on("data", function (c) { if (b.length < 200000) b += c; }); res.on("end", function () { resolve({ status: res.statusCode, ms: Date.now() - t0, body: b, headers: res.headers }); });
    });
    req.on("timeout", function () { req.destroy(new Error("délai dépassé")); });
    req.on("error", function (e) { resolve({ status: 0, ms: Date.now() - t0, error: e.message }); });
    req.end(opts && opts.body);
  });
}
function certDays(host) {
  return new Promise(function (resolve) {
    const s = tls.connect({ host: host, port: 443, servername: host, timeout: 10000 }, function () {
      const c = s.getPeerCertificate(); s.end();
      resolve(c && c.valid_to ? Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400000) : -1);
    });
    s.on("error", function () { resolve(-1); }); s.on("timeout", function () { s.destroy(); resolve(-1); });
  });
}
function sqliteRun(file, sql) {
  const { DatabaseSync } = require("node:sqlite");
  const d = new DatabaseSync(file, { readOnly: true });
  try { return d.prepare(sql).all(); } finally { d.close(); }
}

const results = [];
function add(group, name, ok, detail) { results.push({ group: group, name: name, ok: !!ok, detail: String(detail || "") }); }

(async function main() {
  const main = readEnv(ENV_MAIN);

  /* 1. Services */
  for (const i of INSTANCES) {
    const st = sh("systemctl is-active " + i.unit);
    const since = sh("systemctl show -p ActiveEnterTimestamp --value " + i.unit);
    const restarts = sh("systemctl show -p NRestarts --value " + i.unit);
    add("Services", "Service " + i.name, st === "active", st + (since ? " depuis " + since : "") + (Number(restarts) ? " — " + restarts + " redémarrage(s) automatique(s)" : ""));
  }
  add("Services", "Serveur web (Caddy)", sh("systemctl is-active caddy") === "active", sh("systemctl is-active caddy"));
  add("Services", "Planificateur (cron)", sh("systemctl is-active cron") === "active", sh("systemctl is-active cron"));

  /* 2. Sites et API (de l'extérieur, en HTTPS) */
  const home = await get("https://" + DOMAIN + "/");
  add("Sites et API", "Page d'accueil " + DOMAIN, home.status === 200 && /DarPilot/.test(home.body), "HTTP " + home.status + " en " + home.ms + " ms" + (home.error ? " — " + home.error : ""));
  for (const i of INSTANCES) {
    const p = await get("https://" + i.host + "/");
    add("Sites et API", "Site " + i.name + " (" + i.host + ")", p.status === 200 && p.ms < 3000, "HTTP " + p.status + " en " + p.ms + " ms" + (p.error ? " — " + p.error : ""));
    const body = JSON.stringify({ fn: "apiPublic", args: ["signup.info", {}] });
    const r = await get("https://" + i.host + "/rpc", { method: "POST", body: body, headers: { "Content-Type": "application/json", "X-ImmoPilot": "1", "Origin": "https://" + i.host, "Content-Length": Buffer.byteLength(body) } });
    let ok = false; try { ok = JSON.parse(r.body).ok === true; } catch (e) { ok = false; }
    add("Sites et API", "API " + i.name, ok && r.ms < 3000, "réponse en " + r.ms + " ms" + (ok ? "" : " — HTTP " + r.status + " " + String(r.body || r.error || "").slice(0, 80)));
  }
  const red = await get("https://" + OLD_DOMAIN + "/");
  add("Sites et API", "Redirection " + OLD_DOMAIN + " → " + DOMAIN, (red.status === 301 || red.status === 308) && String(red.headers && red.headers.location || "").indexOf(DOMAIN) >= 0, "HTTP " + red.status + " → " + (red.headers && red.headers.location || "?"));
  const hook = await get("https://fr." + DOMAIN + "/hooks/stripe", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  add("Sites et API", "Webhook Stripe (refuse les messages non signés)", hook.status === 400, "HTTP " + hook.status);

  /* 3. Certificats HTTPS */
  for (const h of [DOMAIN].concat(INSTANCES.map(function (i) { return i.host; }))) {
    const d = await certDays(h);
    add("Certificats HTTPS", h, d >= 14, d < 0 ? "certificat illisible" : "valable encore " + d + " jours (renouvellement automatique)");
  }

  /* 4. Données, e-mails et erreurs par instance */
  for (const i of INSTANCES) {
    const env = readEnv(i.env), dir = env.DATA_DIR || "/var/lib/immopilot", db = path.join(dir, "immopilot.db");
    if (!fs.existsSync(db)) { add("Données", "Base " + i.name, false, "fichier introuvable : " + db); continue; }
    try {
      const q = sqliteRun(db, "PRAGMA quick_check")[0]; const qv = q && Object.values(q)[0];
      add("Données", "Base " + i.name + " intacte", qv === "ok", qv === "ok" ? "contrôle d'intégrité OK (" + Math.round(fs.statSync(db).size / 1048576 * 10) / 10 + " Mo)" : String(qv));
    } catch (e) { add("Données", "Base " + i.name + " intacte", false, e.message); }
    if (!i.demo) {
      try {
        const since = new Date(Date.now() - 86400000).toISOString(), late = new Date(Date.now() - 3600000).toISOString();
        const failed = sqliteRun(db, "SELECT COUNT(*) AS n FROM outbox WHERE status = 'FAILED' AND created >= '" + since + "'")[0].n;
        const stuck = sqliteRun(db, "SELECT COUNT(*) AS n FROM outbox WHERE status = 'QUEUED' AND created < '" + late + "'")[0].n;
        const sent = sqliteRun(db, "SELECT COUNT(*) AS n FROM outbox WHERE status = 'SENT' AND created >= '" + since + "'")[0].n;
        add("E-mails", "Envoi des e-mails " + i.name, failed === 0 && stuck === 0, sent + " envoyé(s) en 24 h, " + failed + " en échec, " + stuck + " bloqué(s) depuis plus d'1 h");
      } catch (e) { add("E-mails", "Envoi des e-mails " + i.name, false, e.message); }
    }
    const errs = Number(sh("journalctl -u " + i.unit + " --since '-24 hours' --no-pager -o cat 2>/dev/null | grep -c 'ERR-'")) || 0;
    add("Erreurs applicatives", "Erreurs internes " + i.name + " (24 h)", errs === 0, errs + " erreur(s) interne(s) journalisée(s)");
  }
  if (main.BREVO_API_KEY) {
    const b = await get("https://api.brevo.com/v3/account", { headers: { "api-key": main.BREVO_API_KEY, accept: "application/json" } });
    add("E-mails", "Compte Brevo (clé valide)", b.status === 200, "HTTP " + b.status + " en " + b.ms + " ms");
  } else add("E-mails", "Compte Brevo (clé valide)", false, "clé absente du fichier d'environnement");

  /* 5. Sauvegardes */
  for (const n of ["immopilot", "immopilot-ma"]) {
    const dir = "/var/backups/" + n;
    let newest = null; try { fs.readdirSync(dir).filter(function (f) { return /^immopilot-.*\.db$/.test(f); }).forEach(function (f) { const t = fs.statSync(path.join(dir, f)).mtimeMs; if (!newest || t > newest) newest = t; }); } catch (e) { /* vide */ }
    const h = newest ? Math.round((Date.now() - newest) / 3600000) : null;
    add("Sauvegardes", "Sauvegarde de nuit " + (n === "immopilot" ? "France" : "Maroc"), h !== null && h <= 26, h === null ? "aucune sauvegarde trouvée" : "dernière il y a " + h + " h");
  }
  const bc = cp.spawnSync("/usr/local/sbin/immopilot-backup-check", [], { encoding: "utf8", env: Object.assign({}, process.env, { NO_ALERT: "1" }), timeout: 300000 });
  const bcLast = sh("tail -1 /var/log/immopilot-backup.log").replace(/^\S+\s/, "");
  add("Sauvegardes", "Archive chiffrée pour le PC (déchiffrement + intégrité)", bc.status === 0, bcLast.slice(0, 200));

  /* 6. Système */
  const df = sh("df -P / | tail -1").split(/\s+/), usedPct = Number(String(df[4] || "").replace("%", ""));
  add("Système", "Espace disque", usedPct > 0 && usedPct < 80, usedPct + " % utilisé (" + Math.round(Number(df[3]) / 1048576) + " Go libres)");
  const mi = fs.readFileSync("/proc/meminfo", "utf8"), tot = Number(/MemTotal:\s+(\d+)/.exec(mi)[1]), av = Number(/MemAvailable:\s+(\d+)/.exec(mi)[1]);
  add("Système", "Mémoire", av / tot > 0.15, Math.round(av / 1024) + " Mo disponibles sur " + Math.round(tot / 1024) + " Mo");
  const load = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[2]), cpus = require("os").cpus().length;
  add("Système", "Charge processeur (15 min)", load < cpus * 1.5, load + " pour " + cpus + " cœurs");
  add("Système", "Horloge synchronisée", sh("timedatectl show -p NTPSynchronized --value") === "yes", sh("timedatectl show -p NTPSynchronized --value") === "yes" ? "oui" : "non");
  add("Système", "Disponibilité", true, "serveur allumé depuis " + sh("uptime -p").replace(/^up /, ""));

  /* 7. Sécurité */
  let uu = null; try { uu = Math.round((Date.now() - fs.statSync("/var/log/unattended-upgrades/unattended-upgrades.log").mtimeMs) / 3600000); } catch (e) { uu = null; }
  add("Sécurité", "Mises à jour de sécurité automatiques", uu !== null && uu <= 48, uu === null ? "aucune trace d'exécution" : "dernier passage il y a " + uu + " h");
  const pend = Number(sh("apt-get -s upgrade 2>/dev/null | grep '^Inst' | grep -ci security")) || 0;
  add("Sécurité", "Correctifs de sécurité en attente", pend === 0, pend + " paquet(s)");
  const ports = sh("ss -H -ltn").split("\n").map(function (l) { return (l.trim().split(/\s+/)[3] || ""); })
    .filter(function (a) { return a && !/^(127\.|\[::1\]|\[::ffff:127\.)/.test(a) && !/%lo:/.test(a); })
    .map(function (a) { return a.replace(/^.*:/, ""); }).filter(function (v, k, arr) { return arr.indexOf(v) === k; });
  const unexpected = ports.filter(function (p) { return ["22", "80", "443"].indexOf(p) < 0; });
  add("Sécurité", "Ports ouverts sur Internet", unexpected.length === 0, "ouverts : " + ports.sort().join(", ") + (unexpected.length ? " — inattendu(s) : " + unexpected.join(", ") : ""));
  const fw = sh("ufw status 2>/dev/null | head -1");
  add("Sécurité", "Pare-feu", /active/i.test(fw) && !/inactive/i.test(fw), fw || "ufw absent");
  const sec = await get("https://fr." + DOMAIN + "/");
  const hsts = String(sec.headers && sec.headers["strict-transport-security"] || ""), csp = String(sec.headers && sec.headers["content-security-policy"] || "");
  add("Sécurité", "En-têtes de sécurité (HSTS, CSP, anti-iframe)", /max-age=\d{7,}/.test(hsts) && /default-src/.test(csp) && /DENY/i.test(String(sec.headers && sec.headers["x-frame-options"] || "")), hsts ? "HSTS " + hsts.slice(0, 40) : "HSTS absent");

  /* Rapport */
  const nok = results.filter(function (r) { return !r.ok; });
  const when = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" }).format(new Date());
  const subject = nok.length ? "DarPilot – état des services : " + nok.length + " point(s) NOK ❌" : "DarPilot – état des services : tout est OK ✅";
  const esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  let rows = "", lastGroup = "";
  results.forEach(function (r) {
    if (r.group !== lastGroup) { rows += "<tr><td colspan='3' style='padding:14px 8px 6px;font-weight:bold;color:#1d2b3a;border-bottom:2px solid #e2e8f0'>" + esc(r.group) + "</td></tr>"; lastGroup = r.group; }
    rows += "<tr><td style='padding:6px 8px;border-bottom:1px solid #eef2f7'>" + esc(r.name) + "</td>" +
      "<td style='padding:6px 8px;border-bottom:1px solid #eef2f7;text-align:center'><span style='display:inline-block;min-width:44px;padding:3px 8px;border-radius:12px;font-weight:bold;color:#fff;background:" + (r.ok ? "#16a34a" : "#dc2626") + "'>" + (r.ok ? "OK" : "NOK") + "</span></td>" +
      "<td style='padding:6px 8px;border-bottom:1px solid #eef2f7;color:#475569;font-size:13px'>" + esc(r.detail) + "</td></tr>";
  });
  const banner = nok.length
    ? "<div style='background:#fee2e2;color:#991b1b;padding:14px 16px;border-radius:10px;font-weight:bold'>" + nok.length + " point(s) NOK sur " + results.length + " : " + esc(nok.map(function (r) { return r.name; }).join(", ")) + "</div>"
    : "<div style='background:#dcfce7;color:#166534;padding:14px 16px;border-radius:10px;font-weight:bold'>Tous les services sont OK (" + results.length + " points contrôlés).</div>";
  const html = "<div style='font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1d2b3a'><h2 style='margin:0 0 4px'>Dar<span style='color:#c69e63'>Pilot</span> — état des services</h2>" +
    "<div style='color:#64748b;margin-bottom:14px'>" + esc(when) + " · serveur " + esc(sh("hostname")) + "</div>" + banner +
    "<table style='width:100%;border-collapse:collapse;margin-top:10px;font-size:14px'>" + rows + "</table>" +
    "<p style='color:#94a3b8;font-size:12px;margin-top:18px'>Contrôle automatique quotidien (6 h, heure de Paris). Lancer à la main sur le serveur : immopilot-health --now</p></div>";
  const text = subject + "\n" + when + "\n\n" + results.map(function (r) { return (r.ok ? "OK  " : "NOK ") + " [" + r.group + "] " + r.name + " — " + r.detail; }).join("\n");
  try { fs.appendFileSync("/var/log/immopilot-health.log", new Date().toISOString() + " " + (nok.length ? nok.length + " NOK" : "OK") + "\n" + text + "\n\n"); } catch (e) { /* facultatif */ }
  if (NOMAIL) { console.log(text); return; }
  const to = process.env.REPORT_EMAIL || main.ADMIN_EMAIL;
  if (!main.BREVO_API_KEY || !to) { console.log(text); console.error("Envoi impossible : clé Brevo ou destinataire absent."); process.exit(2); }
  const payload = JSON.stringify({ sender: { email: main.MAIL_FROM || "no-reply@" + DOMAIN, name: "DarPilot" }, to: [{ email: to }], subject: subject, htmlContent: html, textContent: text });
  const s = await get("https://api.brevo.com/v3/smtp/email", { method: "POST", body: payload, headers: { "api-key": main.BREVO_API_KEY, "content-type": "application/json", accept: "application/json", "Content-Length": Buffer.byteLength(payload) } });
  console.log(subject + " — e-mail " + (s.status === 201 ? "envoyé à " + to : "NON envoyé (HTTP " + s.status + ")"));
  if (s.status !== 201) process.exit(3);
})().catch(function (e) { console.error("Contrôle interrompu : " + e.message); process.exit(1); });
