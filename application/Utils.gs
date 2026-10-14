/** Utilitaires partagés. Toutes les fonctions se terminant par "_" sont privées (non appelables depuis le navigateur). */
/**
 * Points d'injection réservés à la suite de tests (Tests.gs). Ce sont des variables d'exécution : elles ne peuvent être
 * modifiées que par du code serveur dans la même exécution (jamais par le navigateur) et reviennent à null à chaque requête.
 */
var TEST_HOOKS_ = { driveRoot: null, mailSink: null, appUrl: null, pbkdfIters: null, mailQuota: null, aiConfig: null, aiFetch: null };
class AppError extends Error {
  constructor(code, message) { super(message); this.name = "AppError"; this.code = code; }
}
function assert_(condition, message, code) { if (!condition) throw new AppError(code || "VALIDATION", message || "Validation échouée."); }
function forbid_(message) { throw new AppError("FORBIDDEN", message || "Accès refusé."); }
function notFound_(what) { throw new AppError("NOT_FOUND", (what || "Ressource") + " introuvable."); }

function nowIso_() { return new Date().toISOString(); }
function newId_(prefix) { return prefix + "_" + Utilities.getUuid().replace(/-/g, ""); }
function normalizeEmail_(email) { return String(email || "").trim().toLowerCase(); }
function validateEmail_(email) {
  const v = normalizeEmail_(email);
  assert_(v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Adresse e-mail invalide.");
  return v;
}
function safeText_(value, maxLength) {
  const t = String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  assert_(t.length <= (maxLength || 250), "Texte trop long (maximum " + (maxLength || 250) + " caractères).");
  return t;
}
function reqText_(value, label, min, max) {
  const t = safeText_(value, max || 250);
  assert_(t.length >= (min || 1), label + " obligatoire.");
  return t;
}
function num_(v, def) { if (v === "" || v == null) return def === undefined ? 0 : def; const n = Number(v); return isFinite(n) ? n : (def === undefined ? 0 : def); }
function round2_(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function money_(v, label, opts) {
  opts = opts || {};
  if ((v === "" || v == null) && opts.optional) return "";
  const n = Number(v);
  assert_(isFinite(n), label + " invalide.");
  assert_(n >= (opts.min === undefined ? 0 : opts.min) && n <= (opts.max || 1e9), label + " hors limites.");
  return round2_(n);
}
function rate_(v, label) { const n = Number(v); assert_(isFinite(n) && n >= 0 && n <= 100, label + " doit être entre 0 et 100."); return round2_(n); }
function bool_(v) { return v === true || /^true$/i.test(String(v)); }
function parseJson_(s, fallback) { if (s === "" || s == null) return fallback; if (typeof s === "object") return s; try { return JSON.parse(s); } catch (e) { return fallback; } }
function jsonSafe_(v) { try { return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ serializationError: true }); } }
function oneOf_(v, list, label) { assert_(list.indexOf(v) >= 0, (label || "Valeur") + " invalide."); return v; }
function escapeHtml_(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

function bytesToHex_(bytes) { return bytes.map(function (b) { const v = (b + 256) % 256; return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }
function sha256Hex_(s) { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function randomToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""); }
function safeEq_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/* ---------- Dates : les dates métier sont AAAA-MM-JJ (locales), les instants sont ISO UTC ---------- */
function tz_() { return IMMO_CONFIG.TIMEZONE; }
function localToDate_(dateStr, timeStr, tz) { return Utilities.parseDate(dateStr + " " + (timeStr || "00:00"), tz || tz_(), "yyyy-MM-dd HH:mm"); }
function dateStr_(d, tz) { return Utilities.formatDate(d, tz || tz_(), "yyyy-MM-dd"); }
function todayStr_(tz) { return dateStr_(new Date(), tz); }
function parseTs_(s) {
  if (!s) return null;
  if (isDateObj_(s)) return new Date(s.getTime());
  s = String(s);
  if (/[zZ]$/.test(s) || /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}:?\d{2}$/.test(s)) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  return m ? localToDate_(m[1], m[2] || "00:00") : null;
}
function isDateStr_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function dateOnly_(value, label) { const s = safeText_(value, 40).slice(0, 10); assert_(isDateStr_(s), label + " doit être au format AAAA-MM-JJ."); return s; }
function addDaysStr_(s, n) { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function addMonthsStr_(s, n) {
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)) - 1 + n, day = Number(s.slice(8, 10));
  const first = new Date(Date.UTC(y, m, 1)), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}
function diffDays_(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
/** Nuits d'un séjour [ci, co) comprises dans la période [pFrom, pToExcl). */
function overlapNights_(ci, co, pFrom, pToExcl) { const s = ci > pFrom ? ci : pFrom, e = co < pToExcl ? co : pToExcl; return e > s ? diffDays_(s, e) : 0; }
function monthKey_(dateString) { return String(dateString || "").slice(0, 7); }
function periodFromFilters_(f) {
  f = f || {};
  const today = todayStr_();
  const from = f.from ? dateOnly_(f.from, "Début de période") : today.slice(0, 8) + "01";
  const to = f.to ? dateOnly_(f.to, "Fin de période") : addDaysStr_(addMonthsStr_(from, 1), -1);
  assert_(from <= to, "La période est inversée.");
  assert_(diffDays_(from, to) <= 1100, "Période trop longue (maximum 3 ans).");
  return { from: from, to: to, toExcl: addDaysStr_(to, 1), days: diffDays_(from, to) + 1 };
}
function previousPeriod_(p) { const len = p.days; const to = addDaysStr_(p.from, -1); const from = addDaysStr_(to, -(len - 1)); return { from: from, to: to, toExcl: p.from, days: len }; }

/* ---------- Collections ---------- */
function groupBy_(arr, keyFn) { const o = {}; arr.forEach(function (x) { const k = keyFn(x); (o[k] = o[k] || []).push(x); }); return o; }
function sumBy_(arr, fn) { return round2_(arr.reduce(function (a, x) { return a + (Number(fn(x)) || 0); }, 0)); }
function pct_(a, b) { return b > 0 ? round2_((a / b) * 100) : 0; }
function indexBy_(arr, key) { const o = {}; arr.forEach(function (x) { o[String(x[key])] = x; }); return o; }
function pageOf_(arr, input) {
  const size = Math.min(Math.max(parseInt(input && input.pageSize, 10) || 25, 1), IMMO_CONFIG.MAX_PAGE_SIZE);
  const page = Math.max(parseInt(input && input.page, 10) || 1, 1);
  return { items: arr.slice((page - 1) * size, page * size), total: arr.length, page: page, pageSize: size };
}
function matchesQuery_(q, values) { q = String(q || "").trim().toLowerCase(); if (!q) return true; return values.some(function (v) { return String(v == null ? "" : v).toLowerCase().indexOf(q) >= 0; }); }

/* ---------- CSV (protection contre l'injection de formules) ---------- */
function csvCell_(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv_(headers, rows) { return [headers.map(csvCell_).join(",")].concat(rows.map(function (r) { return r.map(csvCell_).join(","); })).join("\n"); }
function parseCsv_(text, maxRows) {
  const rows = []; let row = [], cur = "", inQ = false; text = String(text || "").replace(/^\ufeff/, "");
  const delim = (text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(function (x) { return x !== ""; })) rows.push(row); row = []; if (rows.length > (maxRows || 1001)) break; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some(function (x) { return x !== ""; })) rows.push(row); }
  return rows;
}

/** Exécute fn sous verrou global (section critique) ; relit les données fraîches. Réentrant au sein d'une même exécution. */
var LOCK_DEPTH_ = 0;
function withLock_(fn, waitMs) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 15000)) throw new AppError("BUSY", "Le système est occupé. Réessayez dans quelques secondes.");
  LOCK_DEPTH_++;
  try { dbReset_(); return fn(); } finally { LOCK_DEPTH_--; lock.releaseLock(); }
}
/** Vrai pour un objet Date, y compris issu d'un autre contexte d'exécution (valeurs renvoyées par Sheets). */
function isDateObj_(v) { return Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime()); }
