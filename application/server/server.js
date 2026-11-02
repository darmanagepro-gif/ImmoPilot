/**
 * ImmoPilot — serveur web pour serveur dédié (VPS).
 * Sert l'application (même interface et même code serveur que la version Google Apps Script), exécute les appels,
 * envoie les e-mails en SMTP et lance les tâches planifiées. À placer derrière Caddy (HTTPS automatique), qui écoute
 * sur Internet ; ce serveur n'écoute que sur 127.0.0.1.
 *
 * Démarrage : node server.js  (réglages dans le fichier .env, voir .env.example)
 */
"use strict";
process.removeAllListeners("warning"); // avertissement « SQLite expérimental » de Node 22
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { loadEnv, config, loadDataKey } = require("./config");
loadEnv();
const C = config();
const { createRuntime } = require("./gas-runtime");

let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (e) { nodemailer = null; }

const rt = createRuntime({ dataKey: loadDataKey(C.dataKeyFile), dataDir: C.dataDir, bundleDir: C.bundleDir, publicUrl: C.publicUrl, adminEmail: C.adminEmail, chromium: C.chromium, mailDailyQuota: C.mailDailyQuota,
  appName: "ImmoPilot", timezone: "UTC", onMail: function () { setTimeout(mailTick, 200); } });
const TZ = rt.ctx.IMMO_CONFIG.TIMEZONE, EDITION = rt.ctx.IMMO_EDITION_;

// Réglages initiaux (une seule fois) : adresse publique et premier super administrateur.
(function initProps() {
  const P = rt.ctx.PropertiesService.getScriptProperties();
  if (!P.getProperty("IMMO_APP_URL")) P.setProperty("IMMO_APP_URL", C.publicUrl);
  // Secrets lus dans l'environnement du serveur (jamais dans la base ni le navigateur) : SMS de signature via l'API Brevo.
  rt.ctx.IMMO_SECRETS_ = Object.freeze({ brevoApiKey: C.brevoApiKey });
  if (!P.getProperty("IMMO_ADMIN_EMAILS") && C.adminEmail) P.setProperty("IMMO_ADMIN_EMAILS", C.adminEmail);
  rt.commit();
})();

/* ----------------------------- En-têtes de sécurité ----------------------------- */
function securityHeaders(res, frameAncestors) {
  res.setHeader("Content-Security-Policy", ["default-src 'self'", "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://gateway.sumup.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://*.sumup.com", "font-src 'self' data: https://fonts.gstatic.com https://*.sumup.com",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.sumup.com", "connect-src 'self' https://*.sumup.com", "frame-src https:", "object-src 'none'", "base-uri 'self'", "form-action 'self' https:",
    "frame-ancestors " + (frameAncestors && frameAncestors.length ? frameAncestors.join(" ") : "'none'")].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (!frameAncestors || !frameAncestors.length) res.setHeader("X-Frame-Options", "DENY");
}
function send(res, code, type, body, extra) {
  res.writeHead(code, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra || {}));
  res.end(body);
}

/* ----------------------------- Limitation de débit (par adresse IP) ----------------------------- */
const buckets = new Map();
function clientIp(req) {
  const direct = req.socket.remoteAddress || "";
  if (C.trustProxy && /^(127\.|::1|::ffff:127\.)/.test(direct)) { const f = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(); if (f) return f; }
  return direct;
}
function allowed(ip) {
  const now = Date.now(), b = buckets.get(ip) || { t: now, n: C.rateBurst };
  b.n = Math.min(C.rateBurst, b.n + (now - b.t) / 1000 * C.ratePerSec); b.t = now;
  if (b.n < 1) { buckets.set(ip, b); return false; }
  b.n -= 1; buckets.set(ip, b); return true;
}
setInterval(function () { const old = Date.now() - 600000; buckets.forEach(function (b, k) { if (b.t < old) buckets.delete(k); }); }, 300000).unref();

/* ----------------------------- Page de l'application ----------------------------- */
// Remplace google.script.run (Apps Script) par des appels HTTPS au serveur ; en-tête personnalisé contre les requêtes intersites.
const SHIM = "<script>(function(){function mk(){var r={};r.withSuccessHandler=function(f){r._s=f;return r};r.withFailureHandler=function(f){r._f=f;return r};r.withUserObject=function(){return r};" +
  "[\"api\",\"apiPublic\"].forEach(function(fn){r[fn]=function(){var a=[].slice.call(arguments);fetch(\"/rpc\",{method:\"POST\",credentials:\"same-origin\",headers:{\"Content-Type\":\"application/json\",\"X-ImmoPilot\":\"1\"},body:JSON.stringify({fn:fn,args:a})})" +
  ".then(function(x){if(!x.ok)throw new Error(x.status===429?\"Trop de requêtes, patientez quelques secondes.\":\"Erreur du serveur (HTTP \"+x.status+\").\");return x.json()}).then(function(d){r._s&&r._s(d)}).catch(function(e){r._f&&r._f(e)})}});return r}" +
  "window.google={script:{get run(){return mk()}}};})();</script>";
function renderPage(query) {
  const parameter = {}; query.forEach(function (v, k) { parameter[k] = v; });
  const out = rt.call("doGet", [{ parameter: parameter, parameters: {} }]);
  let html = out.getContent();
  const head = SHIM + "<link rel=\"manifest\" href=\"/manifest.webmanifest\"><link rel=\"icon\" type=\"image/png\" href=\"/icons/favicon-32.png\"><link rel=\"apple-touch-icon\" href=\"/icons/apple-touch-icon.png\">" +
    "<meta name=\"theme-color\" content=\"#13233d\">" + (out.metas || []).map(function (m) { return "<meta name=\"" + m[0] + "\" content=\"" + String(m[1]).replace(/"/g, "&quot;") + "\">"; }).join("");
  html = html.replace(/<head>/i, "<head>" + head);
  if (out.title) html = html.replace(/<title>[^<]*<\/title>/i, "<title>" + out.title.replace(/</g, "&lt;") + "</title>");
  let ancestors = [];
  if (out.xfo === "ALLOWALL") { try { ancestors = rt.ctx.embedOrigins_(); } catch (e) { ancestors = []; } }
  return { html: html, ancestors: ancestors };
}

/* ----------------------------- Fichiers publics ----------------------------- */
const ICON_DIR = path.join(C.editionsDir, String(EDITION).toLowerCase(), "icons");
function manifest() {
  return JSON.stringify({ name: "ImmoPilot", short_name: "ImmoPilot", description: "Gestion locative : réservations, ménage, maintenance, baux et finances.", lang: "fr", start_url: "/", scope: "/",
    display: "standalone", background_color: "#13233d", theme_color: "#13233d",
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] });
}
const LEGAL_PATHS = { "/mentions-legales": "mentions", "/cgv": "cgv", "/cgu": "cgv", "/confidentialite": "confidentialite", "/cookies": "cookies", "/sous-traitance": "dpa" };

/* ----------------------------- Appels (RPC) ----------------------------- */
function stripeSignatureOk(raw, header, secret, nowSec) {
  if (!secret || !header) return false;
  const parts = {}; header.split(",").forEach(function (kv) { const i = kv.indexOf("="); if (i > 0) (parts[kv.slice(0, i).trim()] = parts[kv.slice(0, i).trim()] || []).push(kv.slice(i + 1).trim()); });
  const t = Number((parts.t || [])[0]); if (!t || Math.abs((nowSec || Date.now() / 1000) - t) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(t + "." + raw, "utf8").digest("hex");
  return (parts.v1 || []).some(function (sig) { return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)); });
}
function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on("data", function (c) { size += c.length; if (size > limit) { reject(Object.assign(new Error("Requête trop volumineuse."), { status: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === new URL(C.publicUrl).host || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o); } catch (e) { return false; }
}
const ADMIN_FUNCTIONS = ["setupProject", "createFirstSuperAdmin", "verifierInstallation", "healthCheck", "mesurerPerformance", "viderCache", "creerEnvironnementDemo", "creerHistoriqueDemo",
  "mettreDemoEnVeille", "reveillerDemo", "testerAssistantIA", "testerSumUp", "actualiserTauxSumUp", "backupNow", "restoreFromBackup", "jobFrequent", "jobDaily"];
const ADMIN_PROPS = ["IMMO_ADMIN_EMAILS", "IMMO_APP_URL", "IMMO_AI_PROVIDER", "IMMO_AI_API_KEY", "IMMO_AI_MODEL", "IMMO_EMBED_ORIGINS", "IMMO_PBKDF_ITERATIONS", "SUMUP_API_KEY", "SUMUP_MERCHANT_CODE", "SUMUP_CURRENCY", "SUMUP_RATE", "SUMUP_RATE_MODE", "BREVO_API_KEY", "SMS_SENDER", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
function adminOk(req) {
  const local = /^(127\.|::1|::ffff:127\.)/.test(req.socket.remoteAddress || "");
  const tok = String(req.headers["x-admin-token"] || ""), want = String(C.adminToken || "");
  return local && want.length >= 24 && tok.length === want.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want));
}

/* ----------------------------- Serveur HTTP ----------------------------- */
const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://localhost"), ip = clientIp(req);
  try {
    if (url.pathname === "/healthz") return send(res, 200, "text/plain; charset=utf-8", "ok");
    if (!allowed(ip)) return send(res, 429, "text/plain; charset=utf-8", "Trop de requêtes.");
    const hook = /^\/hooks\/brevo\/([A-Za-z0-9_-]{24,128})$/.exec(url.pathname);
    if (req.method === "POST" && hook) {
      const ok = C.brevoWebhookToken && hook[1].length === C.brevoWebhookToken.length && crypto.timingSafeEqual(Buffer.from(hook[1]), Buffer.from(C.brevoWebhookToken));
      if (!ok) return send(res, 404, "text/plain; charset=utf-8", "Introuvable.");
      let body; try { body = JSON.parse(await readBody(req, 2e6)); } catch (e) { return send(res, 400, "text/plain; charset=utf-8", "JSON invalide."); }
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, updated: brevoEvents(body) }));
    }
    // Stripe Connect : paiements de factures par la plateforme. Signature HMAC vérifiée (horodatage de moins de 5 minutes).
    if (req.method === "POST" && url.pathname === "/hooks/stripe") {
      const raw = await readBody(req, 1e6);
      const secret = String(rt.ctx.PropertiesService.getScriptProperties().getProperty("STRIPE_WEBHOOK_SECRET") || "");
      if (!stripeSignatureOk(raw, String(req.headers["stripe-signature"] || ""), secret)) return send(res, 400, "text/plain; charset=utf-8", "Signature invalide.");
      let ev; try { ev = JSON.parse(raw); } catch (e) { return send(res, 400, "text/plain; charset=utf-8", "JSON invalide."); }
      let out; try { out = rt.call("stripeWebhook", [ev]); } catch (e) { console.error("Webhook Stripe : " + e.message); return send(res, 500, "text/plain; charset=utf-8", "Erreur."); }
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(out || { ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/rpc") {
      if (req.headers["x-immopilot"] !== "1" || !/application\/json/.test(String(req.headers["content-type"] || "")) || !sameOrigin(req)) return send(res, 403, "text/plain; charset=utf-8", "Refusé.");
      const body = JSON.parse(await readBody(req, C.maxBody));
      if (["api", "apiPublic"].indexOf(body.fn) < 0 || !Array.isArray(body.args)) return send(res, 400, "text/plain; charset=utf-8", "Appel invalide.");
      // IP et navigateur de la requête : preuves de la signature électronique du contrat (SignatureService.gs).
      rt.ctx.REQUEST_META_ = { ip: ip, userAgent: String(req.headers["user-agent"] || "").slice(0, 300) };
      let out;
      try { out = rt.call(body.fn, body.args); } finally { rt.ctx.REQUEST_META_ = null; }
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(out === undefined ? null : out));
    }
    if (req.method === "POST" && url.pathname === "/admin/run") {
      if (!adminOk(req)) return send(res, 403, "text/plain; charset=utf-8", "Refusé.");
      const body = JSON.parse(await readBody(req, 1e6));
      rt.state.logs = [];
      try {
        if (body.fn === "setProperty") {
          if (ADMIN_PROPS.indexOf(body.key) < 0) return send(res, 400, "text/plain; charset=utf-8", "Propriété non autorisée.");
          const P = rt.ctx.PropertiesService.getScriptProperties();
          if (body.value === "" || body.value === null) P.deleteProperty(body.key); else P.setProperty(body.key, String(body.value));
          rt.commit();
          return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, key: body.key }));
        }
        if (body.fn === "encryptData" || body.fn === "verifyData") { // chiffrement au repos (voir DEPLOIEMENT / deploy/encrypt-at-rest.sh)
          const r = body.fn === "encryptData" ? rt.encryptAll() : rt.verifyData();
          return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, result: r, logs: [] }));
        }
        if (ADMIN_FUNCTIONS.indexOf(body.fn) < 0) return send(res, 400, "text/plain; charset=utf-8", "Fonction non autorisée.");
        const out = rt.call(body.fn, body.args || [], true);
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, result: out === undefined ? null : out, logs: rt.state.logs }));
      } catch (e) {
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e), logs: rt.state.logs }));
      } finally { rt.state.logs = null; }
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain; charset=utf-8", "Méthode non autorisée.");
    if (LEGAL_PATHS[url.pathname]) return send(res, 302, "text/plain; charset=utf-8", "", { Location: "/?action=legal&doc=" + LEGAL_PATHS[url.pathname] });
    if (url.pathname === "/manifest.webmanifest") return send(res, 200, "application/manifest+json; charset=utf-8", manifest(), { "Cache-Control": "public, max-age=3600" });
    if (url.pathname === "/robots.txt") return send(res, 200, "text/plain; charset=utf-8", "User-agent: *\nAllow: /$\nDisallow: /rpc\n");
    const icon = /^\/icons\/([a-z0-9-]+\.png)$/.exec(url.pathname);
    if (icon) {
      const p = path.join(ICON_DIR, icon[1]);
      if (!fs.existsSync(p)) return send(res, 404, "text/plain; charset=utf-8", "Introuvable.");
      return send(res, 200, "image/png", fs.readFileSync(p), { "Cache-Control": "public, max-age=86400" });
    }
    if (url.pathname === "/" || url.pathname === "/exec") {
      const page = renderPage(url.searchParams);
      securityHeaders(res, page.ancestors);
      return send(res, 200, "text/html; charset=utf-8", req.method === "HEAD" ? "" : page.html);
    }
    return send(res, 404, "text/plain; charset=utf-8", "Page introuvable.");
  } catch (e) {
    console.error(new Date().toISOString() + " " + req.method + " " + url.pathname + " : " + (e.stack || e.message));
    if (!res.headersSent) send(res, e.status || 500, "text/plain; charset=utf-8", e.status === 413 ? "Requête trop volumineuse." : "Erreur du serveur.");
  }
});

/* ----------------------------- E-mails (API Brevo, sinon SMTP) ----------------------------- */
// La clé Brevo reste sur le serveur (variable d'environnement BREVO_API_KEY) : jamais transmise au navigateur.
const BREVO_API = process.env.BREVO_API_URL || "https://api.brevo.com/v3"; // BREVO_API_URL : tests uniquement
let transport = null, mailBusy = false, mailWarned = false;
if (!C.brevoApiKey && nodemailer && C.smtpHost) transport = nodemailer.createTransport({ host: C.smtpHost, port: C.smtpPort, secure: C.smtpSecure, auth: C.smtpUser ? { user: C.smtpUser, pass: C.smtpPass } : undefined });
function permanentError(msg) { const e = new Error(msg); e.permanent = true; return e; }
async function brevoSend(m, attachments) {
  const payload = { sender: { name: m.sender || "ImmoPilot", email: C.mailFrom }, to: [{ email: m.recipient }], subject: m.subject, textContent: m.body || " ",
    tags: ["immopilot"], headers: m.ref ? { "X-Mailin-custom": String(m.ref).slice(0, 250) } : undefined };
  if (m.html) payload.htmlContent = m.html;
  if (m.bcc) payload.bcc = [{ email: m.bcc }];
  if (m.replyto) payload.replyTo = { email: m.replyto };
  if (attachments && attachments.length) payload.attachment = attachments.map(function (a) { return { name: a.name, content: a.base64 }; });
  const res = await fetch(BREVO_API + "/smtp/email", { method: "POST", headers: { "api-key": C.brevoApiKey, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  const txt = await res.text(); let body = {}; try { body = JSON.parse(txt); } catch (e) { body = {}; }
  if (res.ok) return body.messageId || (Array.isArray(body.messageIds) ? body.messageIds[0] : "") || "";
  const msg = "Brevo " + res.status + " : " + String(body.message || txt).slice(0, 200);
  // Erreurs définitives (adresse ou contenu refusé) : inutile de réessayer. 401/403 (clé) et 429/5xx : nouvel essai plus tard.
  if (res.status === 400 || res.status === 404 || res.status === 413) throw permanentError(msg);
  throw new Error(msg);
}
async function mailTick() {
  if (mailBusy) return; mailBusy = true;
  try {
    if (!C.brevoApiKey && !transport) { if (!mailWarned) { console.warn("Ni BREVO_API_KEY ni SMTP configurés : les e-mails restent en file d'attente (table outbox)."); mailWarned = true; } return; }
    const now = new Date().toISOString();
    const rows = rt.db.prepare("SELECT * FROM outbox WHERE status = 'QUEUED' AND (next IS NULL OR next <= ?) ORDER BY id LIMIT 20").all(now);
    for (const m of rows) {
      try {
        m.body = rt.vault.untext(m.body, "mail:body"); m.html = rt.vault.untext(m.html, "mail:html"); m.attachments = rt.vault.untext(m.attachments, "mail:att");
        let att; try { att = m.attachments ? JSON.parse(m.attachments) : []; } catch (e) { att = []; }
        let providerId = "";
        if (C.brevoApiKey) providerId = await brevoSend(m, att);
        else {
          const info = await transport.sendMail({ from: { name: m.sender || "ImmoPilot", address: C.mailFrom }, to: m.recipient, bcc: m.bcc || undefined, replyTo: m.replyto || undefined,
            subject: m.subject, text: m.body, html: m.html || undefined, headers: m.ref ? { "X-Mailin-custom": String(m.ref).slice(0, 250) } : undefined,
            attachments: att.map(function (a) { return { filename: a.name, contentType: a.type, content: Buffer.from(a.base64, "base64") }; }) });
          providerId = (info && info.messageId) || "";
        }
        rt.db.prepare("UPDATE outbox SET status = 'SENT', sent = ?, error = NULL, provider_id = ?, delivery = COALESCE(delivery, 'SENT') WHERE id = ?").run(new Date().toISOString(), String(providerId || ""), m.id);
      } catch (e) {
        const tries = (m.tries || 0) + 1, dead = e.permanent || tries >= 6;
        rt.db.prepare("UPDATE outbox SET tries = ?, error = ?, status = ?, next = ? WHERE id = ?").run(tries, String(e.message).slice(0, 300), dead ? "FAILED" : "QUEUED", new Date(Date.now() + tries * tries * 60000).toISOString(), m.id);
        console.error("E-mail vers " + m.recipient + " : " + e.message);
        if (dead && m.ref) { try { rt.call("mailDeliveryUpdate", [m.ref, m.recipient, "error", new Date().toISOString(), String(e.message).slice(0, 200), ""]); } catch (e2) { console.error(e2.message); } }
      }
    }
    rt.db.prepare("DELETE FROM outbox WHERE status = 'SENT' AND sent < ?").run(new Date(Date.now() - 30 * 86400000).toISOString()); // corps des e-mails : 30 jours
    rt.db.prepare("UPDATE outbox SET attachments = NULL WHERE status = 'SENT' AND attachments IS NOT NULL").run(); // les PDF restent dans les documents de l'application
  } finally { mailBusy = false; }
}
/** Événements de livraison envoyés par Brevo (webhook) : délivré, ouvert, rejeté, bloqué, indésirable… */
function brevoEvents(body) {
  const list = Array.isArray(body) ? body : [body];
  let n = 0;
  list.slice(0, 500).forEach(function (ev) {
    if (!ev || typeof ev !== "object") return;
    const pid = String(ev["message-id"] || ev.messageId || ""), email = String(ev.email || "").toLowerCase();
    let ref = String(ev["X-Mailin-custom"] || "");
    const row = pid ? rt.db.prepare("SELECT id, ref FROM outbox WHERE provider_id = ?").get(pid) : null;
    if (!ref && row) ref = row.ref || "";
    const at = ev.date ? new Date(String(ev.date).replace(" ", "T") + (/[Z+]/.test(String(ev.date)) ? "" : "Z")).toISOString() : new Date().toISOString();
    if (row) rt.db.prepare("UPDATE outbox SET delivery = ?, delivery_at = ?, delivery_reason = ? WHERE id = ?").run(String(ev.event || ""), at, String(ev.reason || "").slice(0, 300), row.id);
    if (ref) { try { rt.call("mailDeliveryUpdate", [ref, email, String(ev.event || ""), at, String(ev.reason || ""), pid]); n++; } catch (e) { console.error("Webhook Brevo : " + e.message); } }
  });
  return n;
}
/** Au démarrage : déclare (une seule fois) l'adresse du webhook de cette instance auprès de Brevo. */
async function brevoWebhookEnsure() {
  if (!C.brevoApiKey || !C.brevoWebhookToken || !C.publicUrl) return;
  const url = C.publicUrl.replace(/\/+$/, "") + "/hooks/brevo/" + C.brevoWebhookToken;
  try {
    const h = { "api-key": C.brevoApiKey, accept: "application/json", "content-type": "application/json" };
    const list = await (await fetch(BREVO_API + "/webhooks?type=transactional", { headers: h, signal: AbortSignal.timeout(20000) })).json();
    if ((list.webhooks || []).some(function (w) { return w.url === url; })) return;
    const r = await fetch(BREVO_API + "/webhooks", { method: "POST", headers: h, signal: AbortSignal.timeout(20000), body: JSON.stringify({ url: url, description: "ImmoPilot " + C.publicUrl, type: "transactional",
      events: ["delivered", "hardBounce", "softBounce", "blocked", "spam", "invalid", "deferred", "opened", "click", "uniqueOpened"] }) });
    console.log("Webhook Brevo : " + (r.ok ? "déclaré" : "refus " + r.status + " " + (await r.text()).slice(0, 200)));
  } catch (e) { console.error("Webhook Brevo : " + e.message); }
}
setTimeout(brevoWebhookEnsure, 5000).unref();
setInterval(mailTick, Number(process.env.MAIL_TICK_MS || 30000)).unref();

/* ----------------------------- Tâches planifiées ----------------------------- */
function localNow() {
  const p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
  return { day: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour) % 24 };
}
let lastFrequent = 0;
function schedulerTick() {
  try {
    if (Date.now() - lastFrequent >= 15 * 60000) { lastFrequent = Date.now(); rt.call("jobFrequent", []); }
    const n = localNow(), P = rt.ctx.PropertiesService.getScriptProperties();
    if (n.hour >= 6 && P.getProperty("VPS_LAST_DAILY") !== n.day) { P.setProperty("VPS_LAST_DAILY", n.day); rt.commit(); rt.call("jobDaily", []); }
  } catch (e) { console.error("Tâche planifiée : " + (e.stack || e.message)); }
}
setInterval(schedulerTick, 60000).unref();
setTimeout(schedulerTick, 20000).unref();

/* ----------------------------- Démarrage / arrêt ----------------------------- */
server.headersTimeout = 30000; server.requestTimeout = 120000;
server.listen(C.port, C.host, function () {
  console.log("ImmoPilot (édition " + EDITION + ", fuseau " + TZ + ") à l'écoute sur http://" + C.host + ":" + C.port + " — adresse publique " + C.publicUrl + " — données " + C.dataDir);
});
function stop() { console.log("Arrêt : enregistrement des données…"); server.close(); try { rt.close(); } catch (e) { console.error(e.message); } process.exit(0); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
