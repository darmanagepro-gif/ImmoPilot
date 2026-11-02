/**
 * Test de l'envoi des e-mails par l'API Brevo et du webhook de livraison, avec un faux service Brevo local
 * (aucun e-mail réel, aucune clé réelle). Usage : node brevo-test.js
 */
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const got = { sends: [], hooks: [] }; let fail = 0;
const ok = function (c, m) { console.log((c ? "OK  " : "ÉCHEC ") + m); if (!c) fail++; };
const mock = http.createServer(function (req, res) {
  let b = ""; req.on("data", function (c) { b += c; }); req.on("end", function () {
    if (req.headers["api-key"] !== "cle-test") { res.writeHead(401); return res.end("{}"); }
    if (req.method === "POST" && req.url === "/smtp/email") { const j = JSON.parse(b); got.sends.push(j); const bad = j.to[0].email === "refus@example.test";
      res.writeHead(bad ? 400 : 201, { "content-type": "application/json" }); return res.end(JSON.stringify(bad ? { message: "invalid email" } : { messageId: "<m" + got.sends.length + "@brevo.test>" })); }
    if (req.method === "GET" && req.url.indexOf("/webhooks") === 0) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ webhooks: [] })); }
    if (req.method === "POST" && req.url === "/webhooks") { got.hooks.push(JSON.parse(b)); res.writeHead(201); return res.end("{}"); }
    res.writeHead(404); res.end("{}");
  });
}).listen(9911, "127.0.0.1", start);
function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immopilot-brevo-")), TOKEN = "jeton-webhook-de-test-1234567890";
  const srv = cp.spawn(process.execPath, [path.join(__dirname, "server.js")], { env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: "8899", PUBLIC_URL: "http://localhost:8899/", IMMO_EDITION: "fr",
    BREVO_API_KEY: "cle-test", BREVO_WEBHOOK_TOKEN: TOKEN, BREVO_API_URL: "http://127.0.0.1:9911", MAIL_TICK_MS: "1500", MAIL_FROM: "contact@immopilotapp.fr" }), stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", function (d) { log += d; }); srv.stderr.on("data", function (d) { log += d; });
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  (async function () {
    for (let i = 0; i < 40 && !/à l'écoute/.test(log); i++) await wait(250);
    const db = new DatabaseSync(path.join(dir, "immopilot.db"));
    const ins = db.prepare("INSERT INTO outbox (created, recipient, subject, body, html, sender, status, attachments, ref) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)");
    const att = JSON.stringify([{ name: "Appel_loyer.pdf", type: "application/pdf", base64: Buffer.from("%PDF-1.4 test").toString("base64") }]);
    ins.run(new Date().toISOString(), "locataire@example.test", "Appel de loyer", "Bonjour", "<p>Bonjour</p>", "SCI Exemple", att, "rentmail:abc:1");
    ins.run(new Date().toISOString(), "refus@example.test", "Test refus", "x", "", "ImmoPilot", null, "evt-refus");
    db.close();
    for (let i = 0; i < 60 && (got.sends.length < 2 || !got.hooks.length); i++) await wait(250);
    await wait(500);
    const s0 = got.sends.find(function (j) { return j.to[0].email === "locataire@example.test"; });
    ok(s0 && s0.sender.email === "contact@immopilotapp.fr" && s0.sender.name === "SCI Exemple", "envoi par l'API Brevo (expéditeur, nom du bailleur)");
    ok(s0 && s0.attachment && s0.attachment[0].name === "Appel_loyer.pdf" && Buffer.from(s0.attachment[0].content, "base64").toString().indexOf("%PDF") === 0, "PDF joint transmis");
    ok(s0 && s0.headers && s0.headers["X-Mailin-custom"] === "rentmail:abc:1" && s0.htmlContent === "<p>Bonjour</p>", "référence de suivi et HTML transmis");
    ok(got.hooks.length === 1 && got.hooks[0].url === "http://localhost:8899/hooks/brevo/" + TOKEN && got.hooks[0].events.indexOf("hardBounce") >= 0, "webhook de livraison déclaré auprès de Brevo");
    const db2 = new DatabaseSync(path.join(dir, "immopilot.db"));
    const r1 = db2.prepare("SELECT * FROM outbox WHERE recipient = 'locataire@example.test'").get(), r2 = db2.prepare("SELECT * FROM outbox WHERE recipient = 'refus@example.test'").get();
    ok(r1.status === "SENT" && r1.provider_id === "<m1@brevo.test>", "file d'envoi : envoyé, identifiant Brevo conservé");
    ok(r2.status === "FAILED" && /400/.test(r2.error) && r2.tries === 1, "erreur définitive : pas de nouvel essai inutile");
    const post = function (p, body) { return new Promise(function (res) { const rq = http.request({ host: "127.0.0.1", port: 8899, path: p, method: "POST", headers: { "content-type": "application/json" } }, function (r) { let t = ""; r.on("data", function (c) { t += c; }); r.on("end", function () { res({ code: r.statusCode, body: t }); }); }); rq.end(JSON.stringify(body)); }); };
    const bad = await post("/hooks/brevo/mauvais-jeton-0000000000000000", { event: "delivered" });
    ok(bad.code === 404, "webhook : jeton invalide refusé");
    const good = await post("/hooks/brevo/" + TOKEN, { event: "delivered", email: "locataire@example.test", "message-id": "<m1@brevo.test>", date: "2026-11-02 09:00:00", "X-Mailin-custom": "rentmail:abc:1" });
    ok(good.code === 200, "webhook : événement accepté");
    const r1b = db2.prepare("SELECT * FROM outbox WHERE recipient = 'locataire@example.test'").get();
    ok(r1b.delivery === "delivered" && /^2026-11-02T09:00:00/.test(r1b.delivery_at), "statut de livraison enregistré");
    db2.close();
    srv.kill(); mock.close(); fs.rmSync(dir, { recursive: true, force: true });
    console.log(fail ? fail + " échec(s)" : "API Brevo et webhook : tous les contrôles réussis.");
    if (fail) console.log(log.slice(-2000));
    process.exitCode = fail ? 1 : 0;
  })().catch(function (e) { console.error(e); srv.kill(); mock.close(); process.exitCode = 1; });
}
