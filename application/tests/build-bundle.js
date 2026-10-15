/**
 * Construit la version d'installation « 2 fichiers » dans dist/ :
 *  - ImmoPilot.gs : les 31 fichiers serveur concaténés (aucune déclaration en double possible) ;
 *  - Index.html   : l'interface complète (les 7 fichiers inclus sont intégrés).
 * Usage : node tests/build-bundle.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "dist");
fs.mkdirSync(OUT, { recursive: true });
const gs = fs.readdirSync(ROOT).filter(function (f) { return /\.gs$/.test(f); }).sort();
const version = (fs.readFileSync(path.join(ROOT, "Config.gs"), "utf8").match(/VERSION: "([^"]+)"/) || [])[1] || "";
let server = "/**\n * ImmoPilot " + version + " — CODE SERVEUR COMPLET EN UN SEUL FICHIER (IMMOPILOT_BUNDLE).\n" +
  " * Contient les " + gs.length + " fichiers : " + gs.join(", ") + ".\n" +
  " * À coller seul dans le projet Apps Script (aucun autre fichier .gs ne doit rester dans le projet).\n */\n";
gs.forEach(function (f) { server += "\n/* ======================================================================\n * " + f + "\n * ====================================================================== */\n" + fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\s+$/, "") + "\n"; });
const build = require("crypto").createHash("sha1").update(server).update(fs.readFileSync(path.join(ROOT, "Index.html"))).digest("hex").slice(0, 12);
server = server.replace('var IMMO_BUILD_ = "dev";', 'var IMMO_BUILD_ = "' + build + '";');
server += "\n/* FIN DU FICHIER ImmoPilot.gs — si cette ligne manque, le copier-coller est incomplet. */\n";
fs.writeFileSync(path.join(OUT, "ImmoPilot.gs"), server);
let html = fs.readFileSync(path.join(ROOT, "Index.html"), "utf8");
html = html.replace(/<\?!=\s*include\("(\w+)"\);\s*\?>/g, function (m, n) {
  const c = fs.readFileSync(path.join(ROOT, n + ".html"), "utf8");
  if (c.indexOf("<?") >= 0) throw new Error(n + ".html contient « <? » : intégration impossible dans un modèle.");
  return "<!-- ===== " + n + ".html ===== -->\n" + c;
});
html = html.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n<!-- IMMOPILOT_BUNDLE : interface complète en un seul fichier (Index). -->");
html = html.replace(/<\/html>\s*$/, "</html>\n<!-- FIN DU FICHIER Index.html — si cette ligne manque, le copier-coller est incomplet. -->\n");
fs.writeFileSync(path.join(OUT, "Index.html"), html);
fs.copyFileSync(path.join(ROOT, "appsscript.json"), path.join(OUT, "appsscript.json"));
console.log("dist/ImmoPilot.gs : " + server.split("\n").length + " lignes, " + Buffer.byteLength(server) + " octets");
console.log("dist/Index.html   : " + html.split("\n").length + " lignes, " + Buffer.byteLength(html) + " octets");
