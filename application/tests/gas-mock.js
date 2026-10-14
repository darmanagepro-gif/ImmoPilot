/**
 * Simulateur minimal des services Google Apps Script utilisés par ImmoPilot, pour exécuter Tests.gs hors Google.
 * Il reproduit volontairement les pièges de Google Sheets : conversion automatique des chaînes en nombres,
 * booléens et dates, interprétation des formules (=…), apostrophe de forçage en texte, limites de colonnes.
 * Ce n'est PAS Google : quotas, latence, permissions réelles et concurrence multi-processus ne sont pas simulés.
 */
"use strict";
const crypto = require("crypto");

function toSigned(buf) { return Array.from(buf, function (b) { return b > 127 ? b - 256 : b; }); }
function toBuf(v) { if (typeof v === "string") return Buffer.from(v, "utf8"); return Buffer.from(v.map(function (b) { return (b + 256) % 256; })); }

function createMock() {
  const M = { session: { active: "owner@example.test", effective: "owner@example.test" }, onInsert: null, failWrites: null, outbox: [], logs: [], held: false, triggers: [], props: {}, cache: {} };
  M.lockHeld = function () { return M.held; };
  const files = {}, folders = {}, sheetsById = {};
  let seq = 0;
  const nid = function (p) { seq++; return p + crypto.randomBytes(12).toString("hex") + seq; };

  /* ---------------- Sheets ---------------- */
  function coerce(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "object") return String(v);
    const s = String(v);
    if (s.charAt(0) === "'") return s.slice(1);
    if (s.charAt(0) === "=") return "#FORMULA_EXECUTED";
    if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) { const p = s.split(":"); return new Date(Date.UTC(1899, 11, 30, +p[0], +p[1])); }
    if (/^-?\d+(\.\d+)?%$/.test(s)) return Number(s.slice(0, -1)) / 100;
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return new Date(s.length === 10 ? s + "T00:00:00Z" : s.replace(" ", "T") + "Z");
    return s;
  }
  function Sheet(name) { this.name = name; this.rows = []; this.maxCols = 26; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.setName = function (n) { this.name = String(n); return this; };
  Sheet.prototype.getLastRow = function () { for (let r = this.rows.length - 1; r >= 0; r--) if (this.rows[r].some(function (c) { return c !== ""; })) return r + 1; return 0; };
  Sheet.prototype.getLastColumn = function () { let m = 0; this.rows.forEach(function (row) { for (let c = row.length - 1; c >= 0; c--) if (row[c] !== "") { m = Math.max(m, c + 1); break; } }); return m; };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.rows.length); };
  Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
  Sheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols += n; };
  Sheet.prototype.setFrozenRows = function () { return this; };
  Sheet.prototype.checkWrite = function () { if (M.failWrites && M.failWrites === this.name) throw new Error("Service Spreadsheets failed while accessing document"); };
  Sheet.prototype.cell = function (r, c) { const row = this.rows[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ""; };
  Sheet.prototype.put = function (r, c, v) {
    if (c > this.maxCols) throw new Error("Les coordonnées de la plage sont en dehors des dimensions de la feuille.");
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1]; while (row.length < c) row.push("");
    row[c - 1] = coerce(v);
  };
  Sheet.prototype.appendRow = function (arr) {
    this.checkWrite();
    if (arr.length > this.maxCols) this.maxCols = arr.length;
    const r = this.getLastRow() + 1, self = this;
    arr.forEach(function (v, i) { self.put(r, i + 1, v); });
    if (M.onInsert) M.onInsert(this.name);
    return this;
  };
  Sheet.prototype.deleteRow = function (r) { this.checkWrite(); this.rows.splice(r - 1, 1); };
  Sheet.prototype.getRange = function (row, col, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error("Plage invalide (" + row + "," + col + "," + nr + "," + nc + ")");
    const sh = this;
    return {
      getValues: function () { const out = []; for (let r = 0; r < nr; r++) { const line = []; for (let c = 0; c < nc; c++) { const v = sh.cell(row + r, col + c); line.push(v instanceof Date ? new Date(v.getTime()) : v); } out.push(line); } return out; },
      getValue: function () { return sh.cell(row, col); },
      setValues: function (vals) {
        sh.checkWrite();
        if (vals.length !== nr || vals.some(function (l) { return l.length !== nc; })) throw new Error("Les dimensions des données ne correspondent pas à la plage.");
        vals.forEach(function (l, r) { l.forEach(function (v, c) { sh.put(row + r, col + c, v); }); });
        if (M.onInsert && row > 1) M.onInsert(sh.name);
        return this;
      },
      setValue: function (v) { sh.checkWrite(); sh.put(row, col, v); return this; },
      setFontWeight: function () { return this; },
      createTextFinder: function (text) {
        let entire = false;
        const tf = { matchEntireCell: function (b) { entire = !!b; return tf; }, matchCase: function () { return tf; },
          findNext: function () {
            for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) { const v = String(sh.cell(row + r, col + c)); if (entire ? v === String(text) : v.indexOf(String(text)) >= 0) { const rr = row + r; return { getRow: function () { return rr; } }; } }
            return null;
          } };
        return tf;
      }
    };
  };
  Sheet.prototype.getDataRange = function () { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); };
  function Spreadsheet(name) { this.id = nid("ss_"); this.name = name; this.sheets = []; sheetsById[this.id] = this; registerFile(this.id, name, "application/vnd.google-apps.spreadsheet", [], null, this); }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getName = function () { return this.name; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.find(function (s) { return s.name === n; }) || null; };
  Spreadsheet.prototype.insertSheet = function (n) { if (this.getSheetByName(n)) throw new Error("Feuille existante : " + n); const s = new Sheet(n); this.sheets.push(s); return s; };
  function cloneSpreadsheet(src, name) {
    const c = new Spreadsheet(name);
    src.sheets.forEach(function (s) { const n = c.insertSheet(s.name); n.maxCols = s.maxCols; n.rows = s.rows.map(function (r) { return r.map(function (v) { return v instanceof Date ? new Date(v.getTime()) : v; }); }); });
    return c;
  }
  Spreadsheet.prototype.setSpreadsheetTimeZone = function (tz) { this.tz = tz; return this; };
  Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return this.tz || "Etc/GMT"; };
  const SpreadsheetApp = {
    // Comme dans Google : un classeur neuf contient une feuille vide par défaut, à la racine du Drive.
    create: function (n) { const ss = new Spreadsheet(n); ss.sheets.push(new Sheet("Feuille 1")); return ss; },
    openById: function (id) { const s = sheetsById[id]; if (!s || files[id].trashed) throw new Error("Document introuvable : " + id); return s; }
  };

  /* ---------------- Drive ---------------- */
  function registerFile(id, name, mime, bytes, parent, ss) { files[id] = { id: id, name: name, mime: mime, bytes: bytes || [], parent: parent, sharing: "PRIVATE", trashed: false, created: new Date(), ss: ss || null }; return files[id]; }
  function FileObj(f) { this.f = f; }
  FileObj.prototype.getId = function () { return this.f.id; };
  FileObj.prototype.getName = function () { return this.f.name; };
  FileObj.prototype.getMimeType = function () { return this.f.mime; };
  FileObj.prototype.getBlob = function () { return newBlob(this.f.bytes, this.f.mime, this.f.name); };
  FileObj.prototype.getAs = function (mime) { const b = newBlob(this.f.bytes, this.f.mime, this.f.name); return b.getAs(mime); };
  FileObj.prototype.setSharing = function (a) { this.f.sharing = a; return this; };
  FileObj.prototype.getSharingAccess = function () { return this.f.sharing; };
  FileObj.prototype.setTrashed = function (t) { this.f.trashed = !!t; return this; };
  FileObj.prototype.getDateCreated = function () { return this.f.created; };
  FileObj.prototype.getSize = function () { return this.f.bytes.length; };
  FileObj.prototype.moveTo = function (folder) { this.f.parent = folder.getId(); return this; };
  FileObj.prototype.getParents = function () { const pid = this.f.parent; return iter(pid && folders[pid] ? [new FolderObj(folders[pid])] : []); };
  FileObj.prototype.getParentId_ = function () { return this.f.parent; };
  FileObj.prototype.makeCopy = function (name, folder) {
    if (this.f.ss) { const c = cloneSpreadsheet(this.f.ss, name); files[c.id].parent = folder ? folder.getId() : null; return new FileObj(files[c.id]); }
    const id = nid("file_"); registerFile(id, name, this.f.mime, this.f.bytes.slice(), folder ? folder.getId() : null); return new FileObj(files[id]);
  };
  function FolderObj(d) { this.d = d; }
  FolderObj.prototype.getId = function () { return this.d.id; };
  FolderObj.prototype.getName = function () { return this.d.name; };
  FolderObj.prototype.createFolder = function (n) { const id = nid("fld_"); folders[id] = { id: id, name: n, parent: this.d.id, sharing: "PRIVATE", trashed: false }; return new FolderObj(folders[id]); };
  FolderObj.prototype.getFoldersByName = function (n) { const self = this; const list = Object.keys(folders).map(function (k) { return folders[k]; }).filter(function (x) { return x.parent === self.d.id && x.name === n && !x.trashed; }); return iter(list.map(function (x) { return new FolderObj(x); })); };
  FolderObj.prototype.getFiles = function () { const self = this; return iter(Object.keys(files).map(function (k) { return files[k]; }).filter(function (x) { return x.parent === self.d.id && !x.trashed; }).map(function (x) { return new FileObj(x); })); };
  FolderObj.prototype.createFile = function (blob) { const id = nid("file_"); registerFile(id, blob.getName(), blob.getContentType(), blob.getBytes(), this.d.id); files[id].sharing = this.d.sharing; return new FileObj(files[id]); };
  FolderObj.prototype.setSharing = function (a) { this.d.sharing = a; return this; };
  FolderObj.prototype.getSharingAccess = function () { return this.d.sharing; };
  FolderObj.prototype.setTrashed = function (t) { this.d.trashed = !!t; return this; };
  function iter(list) { let i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; }
  const DriveApp = {
    Access: { PRIVATE: "PRIVATE", ANYONE_WITH_LINK: "ANYONE_WITH_LINK", ANYONE: "ANYONE", DOMAIN: "DOMAIN" }, Permission: { NONE: "NONE", VIEW: "VIEW", EDIT: "EDIT" },
    createFolder: function (n) { const id = nid("fld_"); folders[id] = { id: id, name: n, parent: null, sharing: "PRIVATE", trashed: false }; return new FolderObj(folders[id]); },
    getFolderById: function (id) { if (!folders[id] || folders[id].trashed) throw new Error("Dossier introuvable"); return new FolderObj(folders[id]); },
    getFileById: function (id) { if (!files[id]) throw new Error("Fichier introuvable : " + id); return new FileObj(files[id]); }
  };

  /* ---------------- Utilities ---------------- */
  function newBlob(data, type, name) {
    let bytes = typeof data === "string" ? toSigned(Buffer.from(data, "utf8")) : (data || []).slice();
    const b = { bytes: bytes, type: type || "application/octet-stream", name: name || "blob" };
    return {
      getBytes: function () { return b.bytes.slice(); }, getDataAsString: function () { return toBuf(b.bytes).toString("utf8"); },
      getContentType: function () { return b.type; }, getName: function () { return b.name; }, setName: function (n) { b.name = n; return this; },
      getAs: function (mime) { if (mime === "application/pdf") return newBlob(toSigned(Buffer.concat([Buffer.from("%PDF-1.4\n% simulateur\n"), toBuf(b.bytes)])), "application/pdf", b.name.replace(/\.[^.]+$/, "") + ".pdf"); return newBlob(b.bytes, mime, b.name); }
    };
  }
  function tzParts(date, tz) {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const o = {}; f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; }); if (o.hour === "24") o.hour = "00"; return o;
  }
  function formatDate(date, tz, fmt) {
    const p = tzParts(date, tz || "UTC");
    let out = "", i = 0;
    while (i < fmt.length) {
      if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j); i = j + 1; continue; }
      const t = ["yyyy", "MM", "dd", "HH", "mm", "ss"].find(function (k) { return fmt.substr(i, k.length) === k; });
      if (t) { out += { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second }[t]; i += t.length; } else { out += fmt[i]; i++; }
    }
    return out;
  }
  function parseDate(str, tz, fmt) {
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m || fmt !== "yyyy-MM-dd HH:mm") throw new Error("parseDate simulé : format non pris en charge");
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let guess = wall;
    for (let k = 0; k < 2; k++) { const p = tzParts(new Date(guess), tz); const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); guess = guess - (asUtc - wall); }
    return new Date(guess);
  }
  const Utilities = {
    DigestAlgorithm: { SHA_256: "sha256", MD5: "md5" }, MacAlgorithm: { HMAC_SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    getUuid: function () { return crypto.randomUUID(); },
    computeDigest: function (alg, value) { return toSigned(crypto.createHash(alg).update(toBuf(value)).digest()); },
    computeHmacSignature: function (alg, value, key) { return toSigned(crypto.createHmac(alg, toBuf(key)).update(toBuf(value)).digest()); },
    base64Encode: function (d) { return toBuf(d).toString("base64"); },
    base64Decode: function (s) { return toSigned(Buffer.from(String(s), "base64")); },
    newBlob: newBlob, formatDate: formatDate, parseDate: parseDate, sleep: function () {}
  };

  /* ---------------- Services divers ---------------- */
  const PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return M.props[k] === undefined ? null : M.props[k]; }, setProperty: function (k, v) { M.props[k] = String(v); return this; }, deleteProperty: function (k) { delete M.props[k]; } }; } };
  const CacheService = { getScriptCache: function () { return { get: function (k) { const e = M.cache[k]; return e && e.exp > Date.now() ? e.v : null; }, put: function (k, v, s) { M.cache[k] = { v: String(v), exp: Date.now() + (s || 600) * 1000 }; }, remove: function (k) { delete M.cache[k]; } }; } };
  const LockService = { getScriptLock: function () { return { tryLock: function () { if (M.held) return false; M.held = true; return true; }, waitLock: function () { if (M.held) throw new Error("Verrou indisponible"); M.held = true; }, releaseLock: function () { M.held = false; }, hasLock: function () { return M.held; } }; } };
  const Session = { getActiveUser: function () { return { getEmail: function () { return M.session.active; } }; }, getEffectiveUser: function () { return { getEmail: function () { return M.session.effective; } }; } };
  const MailApp = { sendEmail: function (o) { M.outbox.push(o); }, getRemainingDailyQuota: function () { return 100; } };
  function trig(fn) { const t = { fn: fn, getHandlerFunction: function () { return fn; } }; const b = { timeBased: function () { return b; }, everyMinutes: function () { return b; }, everyDays: function () { return b; }, atHour: function () { return b; }, inTimezone: function () { return b; }, create: function () { M.triggers.push(t); return t; } }; return b; }
  const ScriptApp = { getService: function () { return { getUrl: function () { return null; } }; }, getProjectTriggers: function () { return M.triggers.slice(); }, newTrigger: trig, deleteTrigger: function (t) { M.triggers = M.triggers.filter(function (x) { return x !== t; }); } };
  const DocumentApp = { create: function (n) { const id = nid("doc_"); registerFile(id, n, "application/vnd.google-apps.document", [], null); return { getId: function () { return id; } }; }, openById: function () { return { getBody: function () { return { replaceText: function () {} }; }, saveAndClose: function () {} }; } };
  const Logger = { log: function (m) { M.logs.push(String(m)); } };
  return { M: M, globals: { SpreadsheetApp: SpreadsheetApp, DriveApp: DriveApp, Utilities: Utilities, PropertiesService: PropertiesService, CacheService: CacheService, LockService: LockService,
    Session: Session, MailApp: MailApp, ScriptApp: ScriptApp, DocumentApp: DocumentApp, Logger: Logger, __MOCK__: M } };
}
module.exports = { createMock: createMock };
