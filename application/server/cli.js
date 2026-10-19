#!/usr/bin/env node
/**
 * Commandes d'administration du serveur ImmoPilot (à lancer SUR le serveur, le service étant démarré).
 * Les commandes passent par le service en cours (adresse locale + jeton ADMIN_TOKEN) : jamais deux programmes sur les mêmes données.
 *
 *   node cli.js setup                       installation / mise à jour non destructive + premier super administrateur
 *   node cli.js run <fonction> [args…]      ex. creerEnvironnementDemo, creerHistoriqueDemo, mesurerPerformance, healthCheck,
 *                                           viderCache, backupNow, mettreDemoEnVeille, reveillerDemo, testerAssistantIA
 *   node cli.js set <PROPRIETE> <valeur>    ex. IMMO_AI_PROVIDER anthropic | IMMO_AI_API_KEY … | IMMO_ADMIN_EMAILS a@b.fr
 *   node cli.js mails                       état de la file d'envoi des e-mails
 */
"use strict";
const http = require("http");
const { loadEnv, config } = require("./config");
loadEnv();
const C = config();

function call(payload) {
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(payload);
    const req = http.request({ host: "127.0.0.1", port: C.port, path: "/admin/run", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "X-Admin-Token": C.adminToken } }, function (res) {
      let b = ""; res.on("data", function (c) { b += c; }); res.on("end", function () {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " : " + b));
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b)); }
      });
    });
    req.on("error", function (e) { reject(new Error("Service injoignable (" + e.message + "). Démarrez-le : sudo systemctl start immopilot")); });
    req.end(data);
  });
}
function print(r) {
  (r.logs || []).forEach(function (l) { console.log("[journal] " + l); });
  if (r.ok) console.log(JSON.stringify(r.result === undefined ? r : r.result, null, 2)); else { console.error("ÉCHEC : " + r.error); process.exitCode = 1; }
}
(async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "setup") return print(await call({ fn: "setupProject", args: [] }));
    if (cmd === "run" && rest[0]) return print(await call({ fn: rest[0], args: rest.slice(1) }));
    if (cmd === "set" && rest[0]) return print(await call({ fn: "setProperty", key: rest[0], value: rest.slice(1).join(" ") }));
    if (cmd === "mails") {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(require("path").join(C.dataDir, "immopilot.db"), { readOnly: true });
      console.table(db.prepare("SELECT status, COUNT(*) AS nombre, MAX(created) AS dernier FROM outbox GROUP BY status").all());
      console.table(db.prepare("SELECT id, created, recipient, subject, tries, error FROM outbox WHERE status <> 'SENT' ORDER BY id DESC LIMIT 10").all());
      return;
    }
    console.log(require("fs").readFileSync(__filename, "utf8").split("\n").slice(2, 13).join("\n").replace(/^ \* ?/gm, ""));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
})();
