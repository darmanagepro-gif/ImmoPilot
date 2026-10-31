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
// Éditions : ma (Maroc), fr (France) et leurs démonstrations publiques ma-demo, fr-demo (paquets construits par tests/build-bundle.js).
const BUNDLES = { "ma": "dist", "fr": "dist-fr", "ma-demo": "dist-demo", "fr-demo": "dist-fr-demo" };
function config() {
  const E = process.env, edition = String(E.IMMO_EDITION || "fr").toLowerCase();
  if (!BUNDLES[edition]) throw new Error("IMMO_EDITION inconnue : " + edition + " (attendu : " + Object.keys(BUNDLES).join(", ") + ")");
  const root = path.resolve(__dirname, "..");
  const publicUrl = String(E.PUBLIC_URL || "http://localhost:" + (E.PORT || 8080) + "/").replace(/\/?$/, "/");
  return {
    edition: edition, publicUrl: publicUrl,
    bundleDir: E.BUNDLE_DIR ? path.resolve(E.BUNDLE_DIR) : path.join(root, BUNDLES[edition]), demo: /-demo$/.test(edition),
    signupOpen: E.SIGNUP_OPEN === undefined ? null : /^(1|true|yes|oui)$/i.test(E.SIGNUP_OPEN), signupTrialDays: E.SIGNUP_TRIAL_DAYS === undefined ? null : String(parseInt(E.SIGNUP_TRIAL_DAYS, 10) || 0),
    portalUrl: E.PORTAL_URL || "",
    editionsDir: path.join(root, "editions"),
    dataDir: path.resolve(E.DATA_DIR || "/var/lib/immopilot"),
    host: E.HOST || "127.0.0.1", port: Number(E.PORT || 8080),
    adminEmail: String(E.ADMIN_EMAIL || "").trim().toLowerCase(), adminToken: E.ADMIN_TOKEN || "",
    smtpHost: E.SMTP_HOST || "", smtpPort: Number(E.SMTP_PORT || 587), smtpSecure: /^(1|true|yes)$/i.test(E.SMTP_SECURE || ""), smtpUser: E.SMTP_USER || "", smtpPass: E.SMTP_PASS || "",
    mailFrom: E.MAIL_FROM || E.SMTP_USER || "no-reply@localhost", mailDailyQuota: Number(E.MAIL_DAILY_QUOTA || 2000),
    chromium: findChromium(), trustProxy: !/^(0|false|no)$/i.test(E.TRUST_PROXY || "1"),
    maxBody: Number(E.MAX_BODY_MB || 12) * 1024 * 1024, ratePerSec: Number(E.RATE_PER_SEC || 15), rateBurst: Number(E.RATE_BURST || 60)
  };
}
module.exports = { loadEnv: loadEnv, config: config };
