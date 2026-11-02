/** Lecture du fichier .env (sans dépendance) et réglages du serveur. */
"use strict";
const fs = require("fs"), path = require("path");

function loadEnv(file) {
  const p = file || process.env.IMMO_ENV_FILE || path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, "utf8").split(/\r?\n/).forEach(function (line) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().charAt(0) === "#") return;
    let v = m[2]; if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cands = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return cands.find(function (c) { return fs.existsSync(c); }) || "chromium";
}
function config() {
  const E = process.env, edition = String(E.IMMO_EDITION || "fr").toLowerCase();
  const root = path.resolve(__dirname, "..");
  const publicUrl = String(E.PUBLIC_URL || "http://localhost:" + (E.PORT || 8080) + "/").replace(/\/?$/, "/");
  return {
    edition: edition, publicUrl: publicUrl,
    bundleDir: E.BUNDLE_DIR ? path.resolve(E.BUNDLE_DIR) : path.join(root, edition === "ma" ? "dist" : "dist-" + edition),
    editionsDir: path.join(root, "editions"),
    dataDir: path.resolve(E.DATA_DIR || "/var/lib/immopilot"),
    dataKeyFile: E.DATA_KEY_FILE ? path.resolve(E.DATA_KEY_FILE) : "", // chiffrement au repos (facultatif) : fichier contenant 32 octets en base64 ou en hexadécimal
    host: E.HOST || "127.0.0.1", port: Number(E.PORT || 8080),
    adminEmail: String(E.ADMIN_EMAIL || "").trim().toLowerCase(), adminToken: E.ADMIN_TOKEN || "",
    brevoApiKey: (E.BREVO_API_KEY || "").trim(), brevoWebhookToken: (E.BREVO_WEBHOOK_TOKEN || "").trim(),
    smtpHost: E.SMTP_HOST || "", smtpPort: Number(E.SMTP_PORT || 587), smtpSecure: /^(1|true|yes)$/i.test(E.SMTP_SECURE || ""), smtpUser: E.SMTP_USER || "", smtpPass: E.SMTP_PASS || "",
    mailFrom: E.MAIL_FROM || E.SMTP_USER || "no-reply@localhost", mailDailyQuota: Number(E.MAIL_DAILY_QUOTA || 2000),
    chromium: findChromium(), trustProxy: !/^(0|false|no)$/i.test(E.TRUST_PROXY || "1"),
    maxBody: Number(E.MAX_BODY_MB || 12) * 1024 * 1024, ratePerSec: Number(E.RATE_PER_SEC || 15), rateBurst: Number(E.RATE_BURST || 60)
  };
}
/** Lit la clé de chiffrement au repos. Fichier indiqué mais illisible ou invalide = arrêt (jamais de repli silencieux vers le clair). */
function loadDataKey(file) {
  if (!file) return null;
  let raw; try { raw = fs.readFileSync(file, "utf8").trim(); } catch (e) { throw new Error("DATA_KEY_FILE illisible (" + file + ") : " + e.message); }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_KEY_FILE : la clé doit faire 32 octets (44 caractères en base64 ou 64 en hexadécimal).");
  try { if (fs.statSync(file).mode & 0o007) console.warn("Attention : " + file + " est lisible par tout le monde (chmod 0640 root:immopilot recommandé)."); } catch (e) { /* sans importance */ }
  return key;
}
module.exports = { loadEnv: loadEnv, config: config, loadDataKey: loadDataKey };
