/**
 * Test du chiffrement au repos (dossier de données TEMPORAIRE, jamais vos données réelles).
 * Usage : node crypto-test.js [dossier du paquet, par défaut ../dist-fr]
 * Vérifie : migration d'un ancien dossier en clair, absence de clair sur le disque, relecture, mauvaise clé, absence de clé,
 * donnée altérée ou déplacée, nouvelles écritures chiffrées, e-mails en file.
 */
"use strict";
process.removeAllListeners("warning");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), assert = require("assert");
const { createRuntime } = require("./gas-runtime");
const bundle = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist-fr"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immopilot-crypto-"));
const KEY = crypto.randomBytes(32), KEY2 = crypto.randomBytes(32);
const M = { cin: "CIN-AB123456-SECRET", scan: "SCAN-PASSEPORT-12AB34567", api: "sk-CLE-API-SECRETE", mail: "LIEN-RESET-SECRET-TOKEN", nom: "Nom-Locataire-Confidentiel" };
const open = function (key) { return createRuntime({ dataKey: key, dataDir: dir, bundleDir: bundle, publicUrl: "https://immopilot.test/", adminEmail: "owner@example.test", chromium: "chromium", mailDailyQuota: 100, timezone: "UTC" }); };
const diskHas = function (needle) { // cherche une chaîne dans la base (+ WAL) et dans tous les fichiers
  const buf = Buffer.from(needle, "utf8"); let found = false;
  const walk = function (d) { fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (fs.readFileSync(p).includes(buf)) found = true; }); };
  walk(dir); return found;
};
let n = 0; const ok = function (name, cond) { n++; if (!cond) throw new Error("ÉCHEC : " + name); console.log("  OK  " + name); };
const throws = function (name, fn, re) { n++; try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("ÉCHEC : " + name + " (message inattendu : " + e.message + ")"); console.log("  OK  " + name); return; } throw new Error("ÉCHEC : " + name + " (aucune erreur)"); };

try {
  // 1. Ancien dossier en clair (sans clé)
  let rt = open(null);
  const D = rt.ctx.DriveApp, ss = rt.ctx.SpreadsheetApp.create("Locataires");
  ss.getSheets()[0].getRange(1, 1, 2, 2).setValues([["Nom", "Pièce"], [M.nom, M.cin]]);
  const f = D.getRootFolder().createFile(rt.ctx.Utilities.newBlob(M.scan, "text/plain", "scan.txt")); const fid = f.getId();
  rt.ctx.PropertiesService.getScriptProperties().setProperty("IMMO_AI_API_KEY", M.api);
  rt.ctx.MailApp.sendEmail({ to: "a@example.test", subject: "Réinitialisation", body: M.mail });
  rt.commit(); rt.close();
  console.log("1. Dossier en clair créé");
  ok("le clair est bien sur le disque avant migration (le test voit les marqueurs)", diskHas(M.cin) && diskHas(M.scan) && diskHas(M.api) && diskHas(M.mail));

  // 2. Réouverture AVEC clé : l'ancien clair reste lisible, la vérification signale le clair, la migration le chiffre
  rt = open(KEY);
  const v0 = rt.verifyData(); console.log("2. Avant migration : " + JSON.stringify(v0));
  ok("avant migration : du clair est signalé", v0.ok === false && v0.lignes.en_clair > 0 && v0.fichiers.en_clair > 0);
  ok("le clair reste lisible avec la clé", rt.ctx.SpreadsheetApp.openById(ss.getId()).getSheets()[0].getRange(2, 2).getValue() === M.cin && Buffer.from(rt.ctx.DriveApp.getFileById(fid).getBlob().getBytes().map(function (b) { return (b + 256) % 256; })).toString() === M.scan);
  const mig = rt.encryptAll(); console.log("   Migration : " + JSON.stringify(mig));
  ok("migration : lignes, propriétés, fichiers et e-mails traités", mig.lignes > 0 && mig.proprietes > 0 && mig.fichiers === 1 && mig.emails === 1);
  const v1 = rt.verifyData(); console.log("   Après migration : " + JSON.stringify(v1));
  ok("après migration : plus de clair, aucune erreur", v1.ok === true && v1.erreurs.length === 0);
  ok("migration relançable (rien de plus à chiffrer)", rt.encryptAll().fichiers === 0 && rt.encryptAll().emails === 0);
  rt.close();
  ok("disque : plus aucune trace en clair (base, WAL, fichiers)", !diskHas(M.cin) && !diskHas(M.scan) && !diskHas(M.api) && !diskHas(M.mail) && !diskHas(M.nom));

  // 3. Relecture correcte avec la bonne clé ; nouvelles écritures chiffrées
  rt = open(KEY);
  ok("relecture : ligne", rt.ctx.SpreadsheetApp.openById(ss.getId()).getSheets()[0].getRange(2, 2).getValue() === M.cin);
  ok("relecture : fichier", Buffer.from(rt.ctx.DriveApp.getFileById(fid).getBlob().getBytes().map(function (b) { return (b + 256) % 256; })).toString() === M.scan);
  ok("relecture : propriété", rt.ctx.PropertiesService.getScriptProperties().getProperty("IMMO_AI_API_KEY") === M.api);
  const mail = rt.db.prepare("SELECT body FROM outbox").get(); ok("e-mail en file chiffré puis relisible", mail.body.startsWith("enc1:") && rt.vault.untext(mail.body, "mail:body") === M.mail);
  const f2 = rt.ctx.DriveApp.getRootFolder().createFile(rt.ctx.Utilities.newBlob("NOUVEAU-SCAN-CIN-77", "text/plain", "n.txt")); ss.getSheets()[0].getRange(3, 1, 1, 2).setValues([["Nouveau-Nom-88", "NOUVELLE-PIECE-99"]]);
  rt.ctx.PropertiesService.getScriptProperties().setProperty("NOUVEAU", "VALEUR-PROP-55"); rt.commit(); rt.close();
  ok("nouvelles écritures : aucun clair sur le disque", !diskHas("NOUVEAU-SCAN-CIN-77") && !diskHas("NOUVELLE-PIECE-99") && !diskHas("VALEUR-PROP-55") && !diskHas("Nouveau-Nom-88"));
  rt = open(KEY); const v2 = rt.verifyData(); ok("vérification finale propre", v2.ok === true); rt.close();

  // 4. Sans clé / mauvaise clé : erreur franche, jamais de lecture vide
  throws("sans clé : ouverture refusée", function () { open(null); }, /clé de chiffrement manquante/);
  throws("mauvaise clé : ouverture refusée", function () { open(KEY2); }, /Déchiffrement impossible/);

  // 5. Altération et déplacement
  const fp = path.join(dir, "files", fid.slice(-2), fid); const raw = fs.readFileSync(fp); const bad = Buffer.from(raw); bad[bad.length - 1] ^= 1; fs.writeFileSync(fp, bad);
  rt = open(KEY); throws("fichier altéré détecté", function () { rt.ctx.DriveApp.getFileById(fid).getBlob(); }, /Déchiffrement impossible/); rt.close(); fs.writeFileSync(fp, raw);
  const dbw = new (require("node:sqlite").DatabaseSync)(path.join(dir, "immopilot.db"));
  const rowsAll = dbw.prepare("SELECT uid, n, data FROM rows ORDER BY n").all(); const a = rowsAll.find(function (r) { return r.n === 1; }), b = rowsAll.find(function (r) { return r.n === 2 && r.uid === a.uid; });
  dbw.prepare("UPDATE rows SET data = ? WHERE uid = ? AND n = 1").run(b.data, a.uid); dbw.close(); // ligne 2 recopiée en ligne 1
  throws("ligne déplacée détectée", function () { open(KEY); }, /Déchiffrement impossible/);
  console.log("\nChiffrement au repos : " + n + " contrôles réussis.");
} catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
finally { fs.rmSync(dir, { recursive: true, force: true }); }
