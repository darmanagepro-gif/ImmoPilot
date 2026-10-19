/**
 * Vérification de l'environnement serveur : exécute TOUTE la suite de tests métier d'ImmoPilot (Tests.gs, incluse dans
 * ImmoPilot.gs) dans l'environnement VPS, sur un dossier de données temporaire (jamais sur vos données réelles).
 * Usage : node smoke-test.js [dossier du paquet, par défaut ../dist-fr]
 */
"use strict";
process.removeAllListeners("warning");
const fs = require("fs"), os = require("os"), path = require("path");
const { createRuntime } = require("./gas-runtime");
const { config } = require("./config");
const bundle = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist-fr"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immopilot-test-"));
const t0 = Date.now();
const rt = createRuntime({ dataDir: dir, bundleDir: bundle, publicUrl: "https://immopilot.test/", adminEmail: "owner@example.test", chromium: config().chromium, mailDailyQuota: 1000, timezone: "UTC", pdfStub: true });
rt.state.logs = [];
let r;
let persisted = "";
try {
  r = rt.call("runAllTests", [], true);
  // Persistance : mêmes données après fermeture et réouverture de la base (lignes ajoutées, modifiées et supprimées par la suite de tests).
  const before = rt.snapshot(); rt.close();
  const again = createRuntime({ dataDir: dir, bundleDir: bundle, publicUrl: "https://immopilot.test/", adminEmail: "owner@example.test", chromium: config().chromium, mailDailyQuota: 1000, timezone: "UTC", pdfStub: true });
  const after = again.snapshot(); again.close();
  persisted = JSON.stringify(before) === JSON.stringify(after) ? "OK " + JSON.stringify(after) : "ÉCHEC avant " + JSON.stringify(before) + " après " + JSON.stringify(after);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log("Paquet : " + bundle);
console.log("Persistance après redémarrage : " + persisted);
console.log("Résultat : " + JSON.stringify(r.summary) + " en " + Math.round((Date.now() - t0) / 1000) + " s");
r.results.filter(function (x) { return x.status !== "PASS"; }).forEach(function (x) { console.log("  " + x.status + " — " + x.group + " / " + x.name + " : " + x.detail); });
// PDF réel : une impression Chromium (le reste de la suite contrôle le contenu HTML des documents)
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "immopilot-pdf-"));
const rt2 = createRuntime({ dataDir: dir2, bundleDir: bundle, publicUrl: "https://immopilot.test/", adminEmail: "owner@example.test", chromium: config().chromium, mailDailyQuota: 10, timezone: "UTC" });
let pdfOk = false, pdfMsg = "";
try { const b = rt2.ctx.Utilities.newBlob("<html><head></head><body><h1>Test é €</h1></body></html>", "text/html", "t.html").getAs("application/pdf"); const bytes = Buffer.from(b.getBytes().map(function (x) { return (x + 256) % 256; })); pdfOk = bytes.slice(0, 5).toString() === "%PDF-" && bytes.length > 1000; pdfMsg = bytes.length + " octets"; }
catch (e) { pdfMsg = e.message; } finally { rt2.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
console.log("PDF réel (Chromium " + config().chromium + ") : " + (pdfOk ? "OK, " : "ÉCHEC, ") + pdfMsg);
process.exitCode = r.summary.failed || !pdfOk || persisted.indexOf("OK") !== 0 ? 1 : 0;
