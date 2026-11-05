/**
 * Test de bout en bout de l'espace Prospects sur le vrai serveur (dossier de données temporaire, faux service Claude local) :
 * lecture IA d'un PDF (/prospects/extract), import, réception Brevo des e-mails des agents (/hooks/brevo-inbound/…), tableau de bord.
 * Usage : node prospects-test.js   (depuis application/server ; aucune donnée réelle n'est touchée)
 */
"use strict";
process.removeAllListeners("warning");
const http = require("http"), cp = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const APP = path.resolve(__dirname, ".."), PORT = Number(process.env.E2E_PORT || 18080), BASE = "http://127.0.0.1:" + PORT;
const ADMIN_TOKEN = "a".repeat(32), HOOK = "h".repeat(32);
const ok = (c, m) => { if (!c) { console.error("ÉCHEC : " + m); process.exitCode = 1; throw new Error(m); } console.log("✔ " + m); };
let aiCalls = [];
const mock = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { const j = JSON.parse(b); aiCalls.push(j);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ content: [{ type: "text", text: "```json\n[{\"company\":\"Conciergerie Atlas\",\"contactName\":\"Yassine\",\"email\":\"contact@atlas.ma\",\"phone\":\"06 61 00 11 22\",\"city\":\"Marrakech\",\"target\":\"CONCIERGERIE\"},{\"company\":\"Plomberie Rapide\",\"phone\":\"0612345678\",\"trade\":\"plombier\",\"city\":\"Agadir\"}]\n```" }] })); }); }).listen(18090);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-e2e-"));
const env = Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(PORT), HOST: "127.0.0.1", PUBLIC_URL: BASE, ADMIN_EMAIL: "boss@example.test", ADMIN_TOKEN: ADMIN_TOKEN,
  BREVO_WEBHOOK_TOKEN: HOOK, BUNDLE_DIR: path.join(APP, "dist-fr"), IMMO_EDITION: "fr", ANTHROPIC_API_URL: "http://127.0.0.1:18090/v1/messages", MAIL_TICK_MS: "3600000" });
const srv = cp.spawn(process.execPath, [path.join(APP, "server/server.js")], { env: env, cwd: path.join(APP, "server"), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
const post = (p, body, headers) => fetch(BASE + p, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, headers || {}), body: JSON.stringify(body) });
const rpc = (fn, args) => post("/rpc", { fn: fn, args: args }, { "X-ImmoPilot": "1" }).then(r => r.json());
const admin = (fn, extra) => post("/admin/run", Object.assign({ fn: fn }, extra || {}), { "x-admin-token": ADMIN_TOKEN }).then(r => r.json());
(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/healthz")).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    ok((await admin("setupProject")).ok, "installation");
    await admin("setProperty", { key: "IMMO_APP_URL", value: "https://app.example.test/" }); const fa = await admin("createFirstSuperAdmin"); ok(fa.ok, "super administrateur créé");
    await admin("setProperty", { key: "IMMO_AI_PROVIDER", value: "anthropic" }); await admin("setProperty", { key: "IMMO_AI_API_KEY", value: "sk-test-e2e" });
    const tok = (JSON.stringify(fa).match(/token=([a-f0-9]{64})/) || [])[1]; ok(tok, "lien d'activation reçu");
    const pw = "Prospects-2026!";
    const rs = await rpc("apiPublic", ["auth.resetPassword", { token: tok, password: pw }]); ok(rs.ok, "mot de passe défini");
    const lg = await rpc("apiPublic", ["auth.login", { email: "boss@example.test", password: pw }]); ok(lg.ok && lg.data.token, "connexion");
    const T = lg.data.token, api = (route, a) => rpc("api", [T, route, a || {}]);
    ok((await post("/prospects/extract", { token: T })).status === 403, "lecture IA : refus sans en-tête de l'application");
    const bad = await (await post("/prospects/extract", { token: "0".repeat(64), mimeType: "image/png", base64: "iVBORw0KGgo=" }, { "X-ImmoPilot": "1" })).json();
    ok(!bad.ok && bad.error.code === "AUTH", "lecture IA : session invalide refusée");
    const ex = await (await post("/prospects/extract", { token: T, fileName: "liste.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 test").toString("base64"), defaults: { country: "MA" } }, { "X-ImmoPilot": "1" })).json();
    ok(ex.ok && ex.data.candidates.length === 2, "lecture IA : 2 fiches extraites");
    ok(ex.data.candidates[0].data.phone === "+212661001122" && ex.data.candidates[1].data.target === "ARTISAN", "numéro marocain normalisé, plombier → artisan");
    ok(aiCalls[0].messages[0].content[0].type === "document" && aiCalls.length === 1, "PDF transmis à Claude comme document");
    const cm = await api("prospect.importCommit", { candidates: ex.data.candidates.map(c => c.data), fileName: "liste.pdf", defaults: { country: "MA" } });
    ok(cm.ok && cm.data.created === 2, "import enregistré");
    ok((await post("/hooks/brevo-inbound/" + "x".repeat(32), {})).status === 404, "réception Brevo : mauvais secret refusé");
    await api("prospect.agentsSettings", { domain: "crm.example.test", agentAddresses: "agents@gmail.test", enabled: true });
    const info = (await api("prospect.agents")).data;
    const block = "-----DARPILOT-SYNC-BEGIN-----\n" + JSON.stringify({ runId: "e2e-1", prospects: [{ key: "contact@atlas.ma", email: "contact@atlas.ma", company: "Conciergerie Atlas", status: "a_envoyer" }, { company: "Agence Toubkal", email: "contact@toubkal.ma", target: "AGENCE", country: "MA", city: "Marrakech" }],
      events: [{ key: "contact@atlas.ma", kind: "DRAFT", summary: "1er e-mail préparé" }], summary: { text: "Marrakech : 2 brouillons" } }) + "\n-----DARPILOT-SYNC-END-----";
    const hk = await (await post("/hooks/brevo-inbound/" + HOOK, { items: [{ Uuid: "u1", From: { Address: "agents@gmail.test" }, To: [{ Address: info.inbox }], RawTextBody: block }] })).json();
    ok(hk.ok && hk.results[0].created === 1 && hk.results[0].updated === 1, "réception Brevo : 1 créé, 1 mis à jour (rapproché de l'import)");
    const ls = (await api("prospect.list", { pageSize: 50 })).data;
    ok(ls.total === 3, "3 prospects dans l'espace");
    const atlas = ls.items.find(x => x.email === "contact@atlas.ma");
    ok(atlas && atlas.status === "a_envoyer", "statut posé par les agents");
    const d = (await api("prospect.dashboard")).data;
    ok(d.lastAgentSync && /2 brouillons/.test(d.lastAgentSync.summary), "rapport des agents visible au tableau de bord");
    const page = await (await fetch(BASE + "/")).text(); ok(page.indexOf("PAGES.prospects") >= 0, "page Prospects servie");
  } catch (e) { console.error(e.message); process.exitCode = 1; console.error(log.slice(-3000)); }
  finally { srv.kill(); mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})();
