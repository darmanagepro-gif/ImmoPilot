/**
 * ImmoPilot — environnement d'exécution « serveur dédié » (VPS).
 *
 * Exécute le MÊME code serveur que Google Apps Script (fichier ImmoPilot.gs de l'édition choisie) en fournissant
 * les services Google qu'il utilise, avec un stockage durable sur le serveur :
 *   - SpreadsheetApp → base SQLite (une ligne SQLite par ligne de feuille, écriture des seules lignes modifiées) ;
 *   - DriveApp       → fichiers privés sur disque (DATA_DIR/files), métadonnées en base ;
 *   - MailApp        → file d'envoi en base, envoyée en SMTP par le serveur (server.js) ;
 *   - PDF (getAs)    → Chromium sans interface (impression HTML → PDF, JavaScript désactivé) ;
 *   - UrlFetchApp    → requête HTTPS (assistant IA facultatif) ;
 *   - PropertiesService, CacheService, LockService, Session, ScriptApp, HtmlService, Utilities, Logger.
 * Le code applicatif n'est jamais modifié : les règles de sécurité, les droits et les tests restent les mêmes.
 * Un seul processus Node.js accède aux données (les requêtes sont traitées l'une après l'autre) : ne lancez pas deux serveurs
 * sur le même dossier de données.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto"), os = require("os"), cp = require("child_process");
const { DatabaseSync } = require("node:sqlite");

function toSigned(buf) { const out = new Array(buf.length); for (let i = 0; i < buf.length; i++) out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i]; return out; }
function toBuf(v) { if (typeof v === "string") return Buffer.from(v, "utf8"); if (Buffer.isBuffer(v)) return v; return Buffer.from(v.map(function (b) { return (b + 256) % 256; })); }
const DATE_KEY = "$d";
function encodeRow(row) { return JSON.stringify(row.map(function (v) { return v instanceof Date ? { [DATE_KEY]: v.toISOString() } : v; })); }
function decodeRow(s) { return JSON.parse(s).map(function (v) { return v && typeof v === "object" && v[DATE_KEY] ? new Date(v[DATE_KEY]) : v; }); }

function createRuntime(opts) {
  const DATA = opts.dataDir, FILES = path.join(DATA, "files");
  fs.mkdirSync(FILES, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(DATA, "immopilot.db"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheets (id TEXT PRIMARY KEY, name TEXT, tz TEXT, trashed INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sheets (uid TEXT PRIMARY KEY, ssid TEXT, name TEXT, pos INTEGER, maxcols INTEGER);
    CREATE TABLE IF NOT EXISTS rows (uid TEXT, n INTEGER, data TEXT, PRIMARY KEY (uid, n));
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, mime TEXT, parent TEXT, sharing TEXT, trashed INTEGER, created TEXT, size INTEGER, ssid TEXT);
    CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT, parent TEXT, sharing TEXT, trashed INTEGER);
    CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT, recipient TEXT, subject TEXT, body TEXT, html TEXT, sender TEXT, status TEXT, tries INTEGER DEFAULT 0, error TEXT, sent TEXT, next TEXT);
  `);
  // Colonnes ajoutées en 2.2 (pièces jointes, copie cachée, adresse de réponse) : ajout sans perte sur une base existante.
  const outboxCols = db.prepare("PRAGMA table_info(outbox)").all().map(function (c) { return c.name; });
  ["attachments", "bcc", "replyto"].forEach(function (c) { if (outboxCols.indexOf(c) < 0) db.exec("ALTER TABLE outbox ADD COLUMN " + c + " TEXT"); });
  const state = { session: { active: "", effective: opts.adminEmail || "" }, triggers: [], cache: new Map(), held: false, logs: null };
  const spreadsheets = new Map(), files = new Map(), folders = new Map(), props = new Map();
  const dirty = { ss: new Set(), sheets: new Set(), rewrite: new Set(), rows: new Map(), files: new Set(), folders: new Set(), props: new Set() };

  /* ------------------------------ Feuilles ------------------------------ */
  // Mêmes conversions que Google Sheets (texte forcé par apostrophe, nombres, booléens, dates, formules neutralisées).
  function coerce(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "object") return String(v);
    const s = String(v);
    if (s.charAt(0) === "'") return s.slice(1);
    if (s.charAt(0) === "=") return s; // jamais exécutée : le code applicatif préfixe toujours les textes
    if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return new Date(s.length === 10 ? s + "T00:00:00Z" : s.replace(" ", "T") + "Z");
    return s;
  }
  function Sheet(ss, name, uid) { this.ss = ss; this.name = name; this.uid = uid || "sh_" + crypto.randomBytes(9).toString("hex"); this.rows = []; this.maxCols = 26; }
  const markRow = function (sh, r) { if (!dirty.rows.has(sh.uid)) dirty.rows.set(sh.uid, new Set()); dirty.rows.get(sh.uid).add(r); };
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.setName = function (n) { this.name = String(n); dirty.sheets.add(this); return this; };
  Sheet.prototype.getLastRow = function () { for (let r = this.rows.length - 1; r >= 0; r--) { const row = this.rows[r]; if (row && row.some(function (c) { return c !== ""; })) return r + 1; } return 0; };
  Sheet.prototype.getLastColumn = function () { let m = 0; this.rows.forEach(function (row) { if (!row) return; for (let c = row.length - 1; c >= 0; c--) if (row[c] !== "") { m = Math.max(m, c + 1); break; } }); return m; };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.rows.length); };
  Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
  Sheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols += n; dirty.sheets.add(this); };
  Sheet.prototype.setFrozenRows = function () { return this; };
  Sheet.prototype.cell = function (r, c) { const row = this.rows[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ""; };
  Sheet.prototype.put = function (r, c, v) {
    if (c > this.maxCols) { this.maxCols = c; dirty.sheets.add(this); }
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1] || (this.rows[r - 1] = []); while (row.length < c) row.push("");
    row[c - 1] = coerce(v); markRow(this, r);
  };
  Sheet.prototype.appendRow = function (arr) { const r = this.getLastRow() + 1, self = this; if (arr.length > this.maxCols) { this.maxCols = arr.length; dirty.sheets.add(this); } arr.forEach(function (v, i) { self.put(r, i + 1, v); }); return this; };
  Sheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); dirty.rewrite.add(this); };
  Sheet.prototype.getRange = function (row, col, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error("Plage invalide (" + row + "," + col + "," + nr + "," + nc + ")");
    const sh = this;
    return {
      getValues: function () { const out = []; for (let r = 0; r < nr; r++) { const line = []; for (let c = 0; c < nc; c++) { const v = sh.cell(row + r, col + c); line.push(v instanceof Date ? new Date(v.getTime()) : v); } out.push(line); } return out; },
      getValue: function () { return sh.cell(row, col); },
      setValues: function (vals) {
        if (vals.length !== nr || vals.some(function (l) { return l.length !== nc; })) throw new Error("Les dimensions des données ne correspondent pas à la plage.");
        vals.forEach(function (l, r) { l.forEach(function (v, c) { sh.put(row + r, col + c, v); }); }); return this;
      },
      setValue: function (v) { sh.put(row, col, v); return this; },
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

  function Spreadsheet(name, id) { this.id = id || "ss_" + crypto.randomBytes(12).toString("hex"); this.name = name; this.sheets = []; this.tz = ""; this.trashed = false; spreadsheets.set(this.id, this); }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getName = function () { return this.name; };
  Spreadsheet.prototype.getUrl = function () { return ""; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.find(function (s) { return s.name === n; }) || null; };
  Spreadsheet.prototype.insertSheet = function (n) { if (this.getSheetByName(n)) throw new Error("Feuille existante : " + n); const s = new Sheet(this, n); this.sheets.push(s); dirty.sheets.add(s); dirty.rewrite.add(s); return s; };
  Spreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); s.deleted = true; dirty.sheets.add(s); return this; };
  Spreadsheet.prototype.setSpreadsheetTimeZone = function (tz) { this.tz = tz; dirty.ss.add(this); return this; };
  Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return this.tz || "Etc/GMT"; };
  function cloneSpreadsheet(src, name) {
    const c = new Spreadsheet(name); dirty.ss.add(c);
    src.sheets.forEach(function (s) { const n = c.insertSheet(s.name); n.maxCols = s.maxCols; n.rows = s.rows.map(function (r) { return (r || []).map(function (v) { return v instanceof Date ? new Date(v.getTime()) : v; }); }); });
    return c;
  }
  const SpreadsheetApp = {
    create: function (n) { const ss = new Spreadsheet(n); dirty.ss.add(ss); const s = new Sheet(ss, "Feuille 1"); ss.sheets.push(s); dirty.sheets.add(s); registerFile(ss.id, n, "application/vnd.google-apps.spreadsheet", null, null, ss.id); return ss; },
    flush: function () {},
    openById: function (id) { const s = spreadsheets.get(String(id)); const f = files.get(String(id)); if (!s || s.trashed || (f && f.trashed)) throw new Error("Document introuvable : " + id); return s; }
  };

  /* ------------------------------ Fichiers (Drive) ------------------------------ */
  const filePath = function (id) { return path.join(FILES, id.slice(-2), id); };
  function registerFile(id, name, mime, bytes, parent, ssid) {
    const f = { id: id, name: name, mime: mime, parent: parent || null, sharing: "PRIVATE", trashed: false, created: new Date().toISOString(), size: 0, ssid: ssid || "" };
    if (bytes) {
      const buf = toBuf(bytes), p = filePath(id);
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      fs.writeFileSync(p + ".tmp", buf, { mode: 0o600 }); fs.renameSync(p + ".tmp", p);
      f.size = buf.length;
    }
    files.set(id, f); dirty.files.add(f); return f;
  }
  const readBytes = function (f) { try { return fs.readFileSync(filePath(f.id)); } catch (e) { return Buffer.alloc(0); } };
  function FileObj(f) { this.f = f; }
  FileObj.prototype.getId = function () { return this.f.id; };
  FileObj.prototype.getName = function () { return this.f.name; };
  FileObj.prototype.getMimeType = function () { return this.f.mime; };
  FileObj.prototype.getUrl = function () { return ""; };
  FileObj.prototype.getBlob = function () { return newBlob(readBytes(this.f), this.f.mime, this.f.name); };
  FileObj.prototype.getAs = function (mime) { return this.getBlob().getAs(mime); };
  FileObj.prototype.setSharing = function (a) { this.f.sharing = "PRIVATE"; dirty.files.add(this.f); return this; }; // jamais public sur le serveur
  FileObj.prototype.getSharingAccess = function () { return this.f.sharing; };
  FileObj.prototype.setTrashed = function (t) {
    this.f.trashed = !!t; dirty.files.add(this.f);
    if (this.f.ssid && spreadsheets.has(this.f.ssid)) { spreadsheets.get(this.f.ssid).trashed = !!t; dirty.ss.add(spreadsheets.get(this.f.ssid)); }
    return this;
  };
  FileObj.prototype.isTrashed = function () { return this.f.trashed; };
  FileObj.prototype.getDateCreated = function () { return new Date(this.f.created); };
  FileObj.prototype.getSize = function () { return this.f.size; };
  FileObj.prototype.moveTo = function (folder) { this.f.parent = folder.getId(); dirty.files.add(this.f); return this; };
  FileObj.prototype.getParents = function () { const pid = this.f.parent; return iter(pid && folders.has(pid) ? [new FolderObj(folders.get(pid))] : []); };
  FileObj.prototype.makeCopy = function (name, folder) {
    if (this.f.ssid && spreadsheets.has(this.f.ssid)) { const c = cloneSpreadsheet(spreadsheets.get(this.f.ssid), name); const nf = registerFile(c.id, name, this.f.mime, null, folder ? folder.getId() : null, c.id); return new FileObj(nf); }
    const id = "file_" + crypto.randomBytes(12).toString("hex"); return new FileObj(registerFile(id, name, this.f.mime, readBytes(this.f), folder ? folder.getId() : null));
  };
  function FolderObj(d) { this.d = d; }
  FolderObj.prototype.getId = function () { return this.d.id; };
  FolderObj.prototype.getName = function () { return this.d.name; };
  FolderObj.prototype.getUrl = function () { return ""; };
  FolderObj.prototype.createFolder = function (n) { const id = "fld_" + crypto.randomBytes(12).toString("hex"); const d = { id: id, name: n, parent: this.d.id, sharing: "PRIVATE", trashed: false }; folders.set(id, d); dirty.folders.add(d); return new FolderObj(d); };
  FolderObj.prototype.getFoldersByName = function (n) { const self = this; return iter(Array.from(folders.values()).filter(function (x) { return x.parent === self.d.id && x.name === n && !x.trashed; }).map(function (x) { return new FolderObj(x); })); };
  FolderObj.prototype.getFolders = function () { const self = this; return iter(Array.from(folders.values()).filter(function (x) { return x.parent === self.d.id && !x.trashed; }).map(function (x) { return new FolderObj(x); })); };
  FolderObj.prototype.getFiles = function () { const self = this; return iter(Array.from(files.values()).filter(function (x) { return x.parent === self.d.id && !x.trashed; }).map(function (x) { return new FileObj(x); })); };
  FolderObj.prototype.createFile = function (blob) { const id = "file_" + crypto.randomBytes(12).toString("hex"); return new FileObj(registerFile(id, blob.getName(), blob.getContentType(), blob.getBytes(), this.d.id)); };
  FolderObj.prototype.setSharing = function () { this.d.sharing = "PRIVATE"; dirty.folders.add(this.d); return this; };
  FolderObj.prototype.getSharingAccess = function () { return this.d.sharing; };
  FolderObj.prototype.setTrashed = function (t) { this.d.trashed = !!t; dirty.folders.add(this.d); return this; };
  function iter(list) { let i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; }
  const DriveApp = {
    Access: { PRIVATE: "PRIVATE", ANYONE_WITH_LINK: "ANYONE_WITH_LINK", ANYONE: "ANYONE", DOMAIN: "DOMAIN" }, Permission: { NONE: "NONE", VIEW: "VIEW", EDIT: "EDIT" },
    createFolder: function (n) { const id = "fld_" + crypto.randomBytes(12).toString("hex"); const d = { id: id, name: n, parent: null, sharing: "PRIVATE", trashed: false }; folders.set(id, d); dirty.folders.add(d); return new FolderObj(d); },
    getFolderById: function (id) { const d = folders.get(String(id)); if (!d || d.trashed) throw new Error("Dossier introuvable"); return new FolderObj(d); },
    getFileById: function (id) { const f = files.get(String(id)); if (!f) throw new Error("Fichier introuvable : " + id); return new FileObj(f); },
    getRootFolder: function () { return DriveApp.createFolder("racine"); }
  };

  /* ------------------------------ Utilitaires ------------------------------ */
  function htmlToPdfBuffer(html) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immopdf-")), inp = path.join(dir, "doc.html"), out = path.join(dir, "doc.pdf");
    try {
      // Politique de sécurité du document : aucun script, aucune ressource externe (images intégrées en data: uniquement).
      const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:\">";
      fs.writeFileSync(inp, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + csp; }) : csp + html);
      const args = ["--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--mute-audio",
        "--user-data-dir=" + path.join(dir, "profile"), "--no-pdf-header-footer", "--print-to-pdf=" + out, "file://" + inp];
      cp.execFileSync(opts.chromium, args, { timeout: 60000, stdio: "ignore" });
      return fs.readFileSync(out);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  function newBlob(data, type, name) {
    let bytes = typeof data === "string" ? Buffer.from(data, "utf8") : toBuf(data || []);
    const b = { bytes: bytes, type: type || "application/octet-stream", name: name || "blob" };
    return {
      getBytes: function () { return toSigned(b.bytes); }, getDataAsString: function () { return b.bytes.toString("utf8"); },
      getContentType: function () { return b.type; }, getName: function () { return b.name; }, setName: function (n) { b.name = n; return this; }, setContentType: function (t) { b.type = t; return this; },
      getAs: function (mime) {
        if (mime === "application/pdf" && /html/.test(b.type)) {
          // opts.pdfStub : uniquement pour smoke-test.js (contrôle de la logique sans Chromium, contenu HTML lisible par les tests)
          const pdf = opts.pdfStub ? Buffer.concat([Buffer.from("%PDF-1.4\n% test\n"), b.bytes]) : htmlToPdfBuffer(b.bytes.toString("utf8"));
          return newBlob(pdf, "application/pdf", b.name.replace(/\.[^.]+$/, "") + ".pdf");
        }
        return newBlob(b.bytes, mime, b.name);
      }
    };
  }
  function tzParts(date, tz) {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const o = {}; f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; }); if (o.hour === "24") o.hour = "00"; return o;
  }
  function formatDate(date, tz, fmt) {
    const p = tzParts(date, tz || "UTC"); let out = "", i = 0;
    while (i < fmt.length) {
      if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j); i = j + 1; continue; }
      const t = ["yyyy", "MM", "dd", "HH", "mm", "ss"].find(function (k) { return fmt.substr(i, k.length) === k; });
      if (t) { out += { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second }[t]; i += t.length; } else { out += fmt[i]; i++; }
    }
    return out;
  }
  function parseDate(str, tz, fmt) {
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m || fmt !== "yyyy-MM-dd HH:mm") throw new Error("parseDate : format non pris en charge (" + fmt + ")");
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); let guess = wall;
    for (let k = 0; k < 2; k++) { const p = tzParts(new Date(guess), tz); const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); guess = guess - (asUtc - wall); }
    return new Date(guess);
  }
  const Utilities = {
    DigestAlgorithm: { SHA_256: "sha256", MD5: "md5", SHA_1: "sha1" }, MacAlgorithm: { HMAC_SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    getUuid: function () { return crypto.randomUUID(); },
    computeDigest: function (alg, value) { return toSigned(crypto.createHash(alg).update(toBuf(value)).digest()); },
    computeHmacSignature: function (alg, value, key) { return toSigned(crypto.createHmac(alg, toBuf(key)).update(toBuf(value)).digest()); },
    base64Encode: function (d) { return toBuf(d).toString("base64"); },
    base64Decode: function (s) { return toSigned(Buffer.from(String(s), "base64")); },
    gzip: function (blob) { return newBlob(require("zlib").gzipSync(toBuf(blob.getBytes())), "application/x-gzip", "data.gz"); },
    ungzip: function (blob) { return newBlob(require("zlib").gunzipSync(toBuf(blob.getBytes())), "application/octet-stream", "data"); },
    newBlob: newBlob, formatDate: formatDate, parseDate: parseDate,
    sleep: function (ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(Number(ms) || 0, 5000)); }
  };

  /* ------------------------------ Services divers ------------------------------ */
  const PropertiesService = { getScriptProperties: function () { return {
    getProperty: function (k) { return props.has(k) ? props.get(k) : null; },
    getProperties: function () { const o = {}; props.forEach(function (v, k) { o[k] = v; }); return o; },
    setProperty: function (k, v) { props.set(k, String(v)); dirty.props.add(k); return this; },
    deleteProperty: function (k) { props.delete(k); dirty.props.add(k); return this; } }; } };
  const cacheGet = function (k) { const e = state.cache.get(k); if (!e) return null; if (e.exp < Date.now()) { state.cache.delete(k); return null; } return e.v; };
  const cachePut = function (k, v, s) { state.cache.set(k, { v: String(v), exp: Date.now() + Math.min(s || 600, 21600) * 1000 }); };
  const CacheService = { getScriptCache: function () { return {
    get: cacheGet, getAll: function (ks) { const o = {}; ks.forEach(function (k) { const v = cacheGet(k); if (v !== null) o[k] = v; }); return o; },
    put: cachePut, putAll: function (o, s) { Object.keys(o).forEach(function (k) { cachePut(k, o[k], s); }); },
    remove: function (k) { state.cache.delete(k); }, removeAll: function (ks) { ks.forEach(function (k) { state.cache.delete(k); }); } }; } };
  // Les requêtes sont exécutées l'une après l'autre dans ce processus : le verrou ne sert qu'à respecter la logique du code.
  const LockService = { getScriptLock: function () { return { tryLock: function () { if (state.held) return false; state.held = true; return true; }, waitLock: function () { if (state.held) throw new Error("Verrou indisponible"); state.held = true; },
    releaseLock: function () { state.held = false; }, hasLock: function () { return state.held; } }; } };
  const Session = { getActiveUser: function () { return { getEmail: function () { return state.session.active; } }; }, getEffectiveUser: function () { return { getEmail: function () { return state.session.effective; } }; },
    getScriptTimeZone: function () { return opts.timezone; } };
  const sentToday = db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE created >= ?"), enqueue = db.prepare("INSERT INTO outbox (created, recipient, subject, body, html, sender, status, attachments, bcc, replyto) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)");
  const mailAddr = function (v) { const a = String(v || "").trim(); if (a && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(a)) throw new Error("Adresse e-mail invalide : " + a); return a || null; };
  const MailApp = {
    sendEmail: function (o) {
      if (typeof o !== "object") o = { to: arguments[0], subject: arguments[1], body: arguments[2] };
      const to = String(o.to || "").trim();
      if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new Error("Adresse e-mail invalide : " + to);
      // Pièces jointes (PDF d'appel de loyer, quittance…) : conservées en base avec l'e-mail jusqu'à l'envoi SMTP.
      const att = (o.attachments || []).map(function (b) { return { name: String(b.getName() || "piece-jointe"), type: String(b.getContentType() || "application/octet-stream"), base64: Buffer.from(b.getBytes()).toString("base64") }; });
      enqueue.run(new Date().toISOString(), to, String(o.subject || "").slice(0, 250), String(o.body || ""), String(o.htmlBody || ""), String(o.name || opts.appName || "ImmoPilot"),
        att.length ? JSON.stringify(att) : null, mailAddr(o.bcc), mailAddr(o.replyTo));
      if (opts.onMail) opts.onMail();
    },
    getRemainingDailyQuota: function () { const since = new Date(Date.now() - 86400000).toISOString(); return Math.max(0, opts.mailDailyQuota - Number(sentToday.get(since).n)); }
  };
  const UrlFetchApp = {
    fetch: function (url, params) {
      params = params || {};
      const req = { url: String(url), method: String(params.method || "get").toUpperCase(), headers: Object.assign({}, params.headers || {}), body: params.payload === undefined ? null : String(params.payload) };
      if (params.contentType) req.headers["Content-Type"] = params.contentType;
      const raw = cp.execFileSync(process.execPath, [path.join(__dirname, "fetch-helper.js")], { input: JSON.stringify(req), timeout: 70000, maxBuffer: 30 * 1024 * 1024 });
      const r = JSON.parse(raw.toString("utf8"));
      if (r.error) throw new Error("Requête impossible : " + r.error);
      if (!params.muteHttpExceptions && (r.status < 200 || r.status >= 300)) throw new Error("Requête refusée (HTTP " + r.status + ")");
      return { getResponseCode: function () { return r.status; }, getContentText: function () { return r.text; }, getHeaders: function () { return r.headers || {}; } };
    }
  };
  function trig(fn) { const t = { fn: fn, getHandlerFunction: function () { return fn; }, getUniqueId: function () { return fn; } };
    const b = { timeBased: function () { return b; }, everyMinutes: function () { return b; }, everyHours: function () { return b; }, everyDays: function () { return b; }, atHour: function () { return b; }, inTimezone: function () { return b; },
      forSpreadsheet: function () { return b; }, onEdit: function () { return b; }, create: function () { state.triggers.push(t); return t; } }; return b; }
  // Les tâches planifiées (jobFrequent toutes les 15 min, jobDaily à 6 h) sont lancées par server.js : ces déclencheurs sont indicatifs.
  const ScriptApp = { getService: function () { return { getUrl: function () { return opts.publicUrl; } }; }, getProjectTriggers: function () { return state.triggers.slice(); }, newTrigger: trig,
    deleteTrigger: function (t) { state.triggers = state.triggers.filter(function (x) { return x !== t; }); }, getScriptId: function () { return "vps"; } };
  const DocumentApp = { create: function () { throw new Error("Modèles Google Docs indisponibles sur le serveur dédié : laissez vides les paramètres template.* (les PDF intégrés sont utilisés)."); },
    openById: function () { throw new Error("Modèles Google Docs indisponibles sur le serveur dédié."); } };
  const Logger = { log: function (m) { if (state.logs) state.logs.push(String(m)); else console.log(String(m)); } };

  /* HtmlService : modèle Index (scriptlets <?!= … ?>) et sortie HTML. */
  function htmlOutput(content) {
    const o = { content: content, title: "", metas: [], xfo: "DEFAULT",
      getContent: function () { return o.content; }, setTitle: function (t) { o.title = t; return o; }, addMetaTag: function (n, c) { o.metas.push([n, c]); return o; },
      setXFrameOptionsMode: function (m) { o.xfo = m; return o; }, setSandboxMode: function () { return o; }, setFaviconUrl: function () { return o; },
      append: function (s) { o.content += s; return o; } };
    return o;
  }
  const readHtml = function (n) { const p = path.join(opts.bundleDir, n + ".html"); if (!fs.existsSync(p)) throw new Error("Fichier introuvable : " + n); return fs.readFileSync(p, "utf8"); };
  const HtmlService = {
    XFrameOptionsMode: { DEFAULT: "DEFAULT", ALLOWALL: "ALLOWALL" }, SandboxMode: { IFRAME: "IFRAME" },
    createHtmlOutputFromFile: function (n) { return htmlOutput(readHtml(n)); },
    createHtmlOutput: function (h) { return htmlOutput(String(h || "")); },
    createTemplateFromFile: function (n) {
      const src = readHtml(n), tpl = {};
      tpl.evaluate = function () {
        const names = Object.keys(tpl).filter(function (k) { return k !== "evaluate"; }), vals = names.map(function (k) { return tpl[k]; });
        const out = src.replace(/<\?!=([\s\S]*?)\?>/g, function (m, expr) { return String(Function.apply(null, names.concat("return (" + expr + ");")).apply(null, vals)); });
        return htmlOutput(out);
      };
      return tpl;
    }
  };

  /* ------------------------------ Persistance ------------------------------ */
  function load() {
    db.prepare("SELECT k, v FROM props").all().forEach(function (r) { props.set(r.k, r.v); });
    db.prepare("SELECT * FROM folders").all().forEach(function (r) { folders.set(r.id, { id: r.id, name: r.name, parent: r.parent, sharing: r.sharing, trashed: !!r.trashed }); });
    db.prepare("SELECT * FROM files").all().forEach(function (r) { files.set(r.id, { id: r.id, name: r.name, mime: r.mime, parent: r.parent, sharing: r.sharing, trashed: !!r.trashed, created: r.created, size: r.size, ssid: r.ssid || "" }); });
    db.prepare("SELECT * FROM spreadsheets").all().forEach(function (r) { const ss = new Spreadsheet(r.name, r.id); ss.tz = r.tz || ""; ss.trashed = !!r.trashed; });
    const rowsStmt = db.prepare("SELECT n, data FROM rows WHERE uid = ? ORDER BY n");
    db.prepare("SELECT * FROM sheets ORDER BY ssid, pos").all().forEach(function (r) {
      const ss = spreadsheets.get(r.ssid); if (!ss) return;
      const sh = new Sheet(ss, r.name, r.uid); sh.maxCols = r.maxcols || 26;
      rowsStmt.all(r.uid).forEach(function (x) { sh.rows[x.n - 1] = decodeRow(x.data); });
      for (let i = 0; i < sh.rows.length; i++) if (!sh.rows[i]) sh.rows[i] = [];
      ss.sheets.push(sh);
    });
  }
  const st = {
    ss: db.prepare("INSERT INTO spreadsheets (id, name, tz, trashed) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, tz = excluded.tz, trashed = excluded.trashed"),
    sheet: db.prepare("INSERT INTO sheets (uid, ssid, name, pos, maxcols) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name, pos = excluded.pos, maxcols = excluded.maxcols"),
    sheetDel: db.prepare("DELETE FROM sheets WHERE uid = ?"), rowsDel: db.prepare("DELETE FROM rows WHERE uid = ?"), rowsTail: db.prepare("DELETE FROM rows WHERE uid = ? AND n > ?"),
    row: db.prepare("INSERT INTO rows (uid, n, data) VALUES (?, ?, ?) ON CONFLICT(uid, n) DO UPDATE SET data = excluded.data"),
    file: db.prepare("INSERT INTO files (id, name, mime, parent, sharing, trashed, created, size, ssid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent = excluded.parent, sharing = excluded.sharing, trashed = excluded.trashed, size = excluded.size"),
    folder: db.prepare("INSERT INTO folders (id, name, parent, sharing, trashed) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent = excluded.parent, sharing = excluded.sharing, trashed = excluded.trashed"),
    prop: db.prepare("INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"), propDel: db.prepare("DELETE FROM props WHERE k = ?")
  };
  /** Écrit en une transaction tout ce qui a changé pendant la requête. */
  function commit() {
    const n = dirty.ss.size + dirty.sheets.size + dirty.rewrite.size + dirty.rows.size + dirty.files.size + dirty.folders.size + dirty.props.size;
    if (!n) return 0;
    db.exec("BEGIN");
    try {
      dirty.ss.forEach(function (ss) {
        st.ss.run(ss.id, ss.name, ss.tz || "", ss.trashed ? 1 : 0);
        if (ss.trashed) ss.sheets.forEach(function (s) { st.rowsDel.run(s.uid); }); // sauvegarde supprimée : données libérées
        else ss.sheets.forEach(function (s, i) { st.sheet.run(s.uid, ss.id, s.name, i, s.maxCols); });
      });
      dirty.sheets.forEach(function (s) {
        if (s.deleted) { st.sheetDel.run(s.uid); st.rowsDel.run(s.uid); return; }
        st.sheet.run(s.uid, s.ss.id, s.name, Math.max(0, s.ss.sheets.indexOf(s)), s.maxCols);
      });
      dirty.rewrite.forEach(function (s) {
        if (s.deleted || s.ss.trashed) return;
        st.rowsDel.run(s.uid);
        s.rows.forEach(function (r, i) { if (r && r.length) st.row.run(s.uid, i + 1, encodeRow(r)); });
        dirty.rows.delete(s.uid);
      });
      dirty.rows.forEach(function (set, uid) {
        let sh = null; spreadsheets.forEach(function (ss) { if (!sh) sh = ss.sheets.find(function (x) { return x.uid === uid; }) || null; });
        if (!sh || sh.ss.trashed) return;
        set.forEach(function (r) { const row = sh.rows[r - 1]; if (row) st.row.run(uid, r, encodeRow(row)); });
        st.rowsTail.run(uid, sh.rows.length);
      });
      dirty.files.forEach(function (f) { st.file.run(f.id, f.name, f.mime, f.parent || null, f.sharing, f.trashed ? 1 : 0, f.created, f.size, f.ssid || ""); if (f.trashed && !f.ssid) { try { fs.rmSync(filePath(f.id), { force: true }); } catch (e) { /* déjà supprimé */ } } });
      dirty.folders.forEach(function (d) { st.folder.run(d.id, d.name, d.parent || null, d.sharing, d.trashed ? 1 : 0); });
      dirty.props.forEach(function (k) { if (props.has(k)) st.prop.run(k, props.get(k)); else st.propDel.run(k); });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    Object.keys(dirty).forEach(function (k) { dirty[k].clear(); });
    return n;
  }

  /* ------------------------------ Chargement du code ImmoPilot ------------------------------ */
  load();
  const sandbox = { console: console, SpreadsheetApp: SpreadsheetApp, DriveApp: DriveApp, Utilities: Utilities, PropertiesService: PropertiesService, CacheService: CacheService,
    LockService: LockService, Session: Session, MailApp: MailApp, UrlFetchApp: UrlFetchApp, ScriptApp: ScriptApp, DocumentApp: DocumentApp, Logger: Logger, HtmlService: HtmlService,
    IMMO_RUNTIME_: "vps" };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(opts.bundleDir, "ImmoPilot.gs"), "utf8"), ctx, { filename: "ImmoPilot.gs" });
  // Toutes les données sont déjà en mémoire dans ce processus : la couche de cache Google (CacheService) n'apporte rien ici.
  vm.runInContext("TEST_HOOKS_.noDbCache = true;", ctx);

  return {
    ctx: ctx, db: db, commit: commit, state: state, files: files,
    /** Appelle une fonction globale du code (api, apiPublic, doGet, jobFrequent…) puis enregistre les changements. */
    call: function (fn, args, asEditor) {
      const prev = state.session.active;
      if (asEditor) state.session.active = state.session.effective;
      try { return ctx[fn].apply(null, args || []); }
      finally { state.session.active = prev; state.held = false; try { commit(); } catch (e) { console.error("Enregistrement impossible : " + (e.stack || e.message)); throw e; } }
    },
    /** Empreinte de toutes les feuilles (contrôle de la persistance : identique avant arrêt et après redémarrage). */
    snapshot: function () {
      const h = crypto.createHash("sha256"), ids = Array.from(spreadsheets.keys()).sort();
      ids.forEach(function (id) { const ss = spreadsheets.get(id); if (ss.trashed) return; h.update(id);
        ss.sheets.forEach(function (sh) { h.update(sh.name); const last = sh.getLastRow(); for (let r = 0; r < last; r++) h.update(encodeRow((sh.rows[r] || []).slice(0, sh.getLastColumn()).concat())); }); });
      return { spreadsheets: ids.length, files: files.size, hash: h.digest("hex").slice(0, 16) };
    },
    close: function () { try { commit(); } finally { db.close(); } }
  };
}
module.exports = { createRuntime: createRuntime };
