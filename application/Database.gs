/**
 * Couche d'accès aux données (Google Sheets). Les lignes sont liées par identifiant stable, jamais par numéro de ligne.
 * Lecture : une lecture de feuille par table et par exécution (mémoïsée, invalidée à l'écriture).
 * Les objets retournés par dbAll_/dbGet_ sont en LECTURE SEULE (ne pas les modifier : utiliser dbUpdate_).
 */
var DB_MEMO_ = {};
var DB_HEADERS_ = {};
var DB_SS_ = null;
var SCHEMA_ = null;

function dbReset_() { DB_MEMO_ = {}; DB_HEADERS_ = {}; }
function dbSetSpreadsheet_(ss) { DB_SS_ = ss; dbReset_(); }

function schema_() {
  if (SCHEMA_) return SCHEMA_;
  const out = {};
  Object.keys(TABLES_SRC).forEach(function (name) {
    const d = TABLES_SRC[name], parts = d.cols.split("|"), cols = [], types = {};
    parts.forEach(function (part) {
      part.split(",").forEach(function (raw) { raw = raw.trim(); if (!raw) return; const a = raw.split("#"); cols.push(a[0]); types[a[0]] = a[1] || "s"; });
    });
    out[name] = { name: name, pk: d.pk, idp: d.idp || "id", cols: cols, types: types, legacyCount: parts[0].split(",").filter(Boolean).length,
      org: d.org || null, req: (d.req || "").split(",").filter(Boolean), enums: d.enums || {} };
  });
  SCHEMA_ = out;
  return out;
}
function tableDef_(name) { const s = schema_()[name]; assert_(s, "Table inconnue : " + name, "INTERNAL"); return s; }

function dbSpreadsheet_() {
  if (DB_SS_) return DB_SS_;
  const id = PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.DATABASE_PROPERTY);
  assert_(id, "Base non configurée. Renseignez IMMO_DATABASE_SPREADSHEET_ID puis exécutez setupProject().", "CONFIG");
  DB_SS_ = SpreadsheetApp.openById(id);
  return DB_SS_;
}
function dbSheet_(name) {
  tableDef_(name);
  const sh = dbSpreadsheet_().getSheetByName(name);
  assert_(sh, "Feuille absente : " + name + ". Exécutez setupProject().", "CONFIG");
  return sh;
}
function dbHeaders_(name) {
  if (DB_HEADERS_[name]) return DB_HEADERS_[name];
  const sh = dbSheet_(name);
  DB_HEADERS_[name] = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  return DB_HEADERS_[name];
}

function normOut_(S, col, v) {
  const t = S.types[col] || "s";
  if (v === "" || v == null) return t === "b" ? false : (t === "n" ? null : "");
  if (t === "b") return v === true || /^true$/i.test(String(v));
  if (t === "n") { const n = Number(v); return isFinite(n) ? n : null; }
  if (isDateObj_(v)) return t === "d" ? Utilities.formatDate(v, tz_(), "yyyy-MM-dd") : (t === "t" ? v.toISOString() : Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm:ss"));
  if (t === "d") return String(v).slice(0, 10);
  return typeof v === "number" ? String(v) : v;
}
function toCell_(S, col, v) {
  const t = S.types[col] || "s";
  if (v === undefined || v === null || v === "") return "";
  if (t === "b") return v === true || /^true$/i.test(String(v));
  if (t === "n") { const n = Number(v); assert_(isFinite(n), "Valeur numérique invalide pour " + col, "VALIDATION"); return n; }
  if (t === "j" && typeof v !== "string") v = jsonSafe_(v);
  const s = String(v);
  if (s.length > 45000) throw new AppError("VALIDATION", "Valeur trop longue pour " + col + ".");
  // Toute valeur texte est préfixée d'une apostrophe (« texte forcé » de Sheets, non stockée dans la valeur) :
  // neutralise les formules (=, +, -, @), les conversions automatiques en date/heure/nombre et la perte des zéros initiaux.
  return "'" + s;
}
/** Ré-encode une cellule existante d'une colonne inconnue du schéma, sans la transformer. */
function reencodeRaw_(v) { return typeof v === "string" && v !== "" ? "'" + v : v; }

function dbAll_(name) {
  if (DB_MEMO_[name]) return DB_MEMO_[name];
  // Une seule lecture (getDataRange) au lieu de trois appels au service Sheets.
  const S = tableDef_(name), sh = dbSheet_(name), rows = [];
  const vals = sh.getDataRange().getValues();
  if (vals.length >= 2) {
    const headers = vals[0].map(String);
    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      if (!row.some(function (c) { return c !== "" && c !== null; })) continue;
      const o = {};
      headers.forEach(function (h, i) { if (h) o[h] = normOut_(S, h, row[i]); });
      S.cols.forEach(function (c) { if (!(c in o)) o[c] = normOut_(S, c, ""); });
      rows.push(o);
    }
  }
  DB_MEMO_[name] = rows;
  return rows;
}
/**
 * Lignes récentes d'une table où l'on ajoute toujours en fin (journal) : lecture par paquets depuis la fin jusqu'à la
 * première ligne antérieure à fromIso (champ field). Évite de relire tout l'historique pour un tableau de bord.
 */
function dbTailSince_(name, field, fromIso, chunk) {
  if (DB_MEMO_[name]) return DB_MEMO_[name].filter(function (r) { return String(r[field]) >= fromIso; });
  chunk = chunk || 2000;
  const S = tableDef_(name), sh = dbSheet_(name), headers = dbHeaders_(name), lr = sh.getLastRow(), out = [];
  let end = lr;
  while (end >= 2) {
    const start = Math.max(2, end - chunk + 1), vals = sh.getRange(start, 1, end - start + 1, headers.length).getValues();
    let older = false;
    for (let r = vals.length - 1; r >= 0; r--) {
      const row = vals[r]; if (!row.some(function (c) { return c !== "" && c !== null; })) continue;
      const o = {}; headers.forEach(function (h, i) { if (h) o[h] = normOut_(S, h, row[i]); });
      if (String(o[field]) < fromIso) { older = true; continue; }
      out.push(o);
    }
    if (older) break;
    end = start - 1;
  }
  return out.reverse();
}
/**
 * Recherche rapide d'UNE ligne par valeur exacte d'une colonne (ex. empreinte de jeton de session), sans lire toute la feuille :
 * TextFinder de Sheets sur la seule colonne concernée, puis lecture de la ligne trouvée. Repli sur dbAll_ si indisponible.
 */
function dbFindFast_(name, field, value) {
  if (DB_MEMO_[name]) return dbFind_(name, field, value);
  const S = tableDef_(name), sh = dbSheet_(name), headers = dbHeaders_(name), col = headers.indexOf(field), lr = sh.getLastRow();
  if (col < 0 || lr < 2) return dbFind_(name, field, value);
  const range = sh.getRange(2, col + 1, lr - 1, 1);
  if (typeof range.createTextFinder !== "function") return dbFind_(name, field, value);
  const hit = range.createTextFinder(String(value)).matchEntireCell(true).findNext();
  if (!hit) return null;
  const row = sh.getRange(hit.getRow(), 1, 1, headers.length).getValues()[0], o = {};
  headers.forEach(function (h, i) { if (h) o[h] = normOut_(S, h, row[i]); });
  S.cols.forEach(function (c) { if (!(c in o)) o[c] = normOut_(S, c, ""); });
  return String(o[field]) === String(value) ? o : dbFind_(name, field, value);
}
function dbWhere_(name, pred) { return dbAll_(name).filter(pred); }
function dbGet_(name, id) {
  const pk = tableDef_(name).pk, s = String(id);
  return dbAll_(name).find(function (r) { return String(r[pk]) === s; }) || null;
}
function dbFind_(name, field, value) { const s = String(value); return dbAll_(name).find(function (r) { return String(r[field]) === s; }) || null; }

function validateRow_(S, obj, isInsert) {
  Object.keys(obj).forEach(function (k) { assert_(S.cols.indexOf(k) >= 0, "Colonne inconnue " + S.name + "." + k, "INTERNAL"); });
  if (isInsert) S.req.forEach(function (k) { assert_(obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== "", "Champ obligatoire manquant : " + k); });
  Object.keys(S.enums).forEach(function (k) {
    if (obj[k] !== undefined && obj[k] !== "" && obj[k] !== null) assert_(S.enums[k].indexOf(obj[k]) >= 0, "Valeur invalide pour " + k + " : " + obj[k]);
  });
}

function dbInsert_(name, obj) {
  const S = tableDef_(name), row = Object.assign({}, obj);
  if (!row[S.pk]) row[S.pk] = newId_(S.idp);
  validateRow_(S, row, true);
  const headers = dbHeaders_(name);
  dbSheet_(name).appendRow(headers.map(function (h) { return row[h] === undefined ? "" : toCell_(S, h, row[h]); }));
  delete DB_MEMO_[name];
  return row;
}
function dbInsertMany_(name, objs) {
  if (!objs.length) return [];
  const S = tableDef_(name), headers = dbHeaders_(name), sh = dbSheet_(name), out = [];
  const values = objs.map(function (o) {
    const row = Object.assign({}, o); if (!row[S.pk]) row[S.pk] = newId_(S.idp);
    validateRow_(S, row, true); out.push(row);
    return headers.map(function (h) { return row[h] === undefined ? "" : toCell_(S, h, row[h]); });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  delete DB_MEMO_[name];
  return out;
}
/** Met à jour une ligne par identifiant (retrouvé à chaque appel). Retourne false si introuvable. */
function dbUpdate_(name, id, patch) {
  const S = tableDef_(name), sh = dbSheet_(name), lr = sh.getLastRow();
  if (lr < 2) return false;
  assert_(patch[S.pk] === undefined || String(patch[S.pk]) === String(id), "Identifiant non modifiable.", "INTERNAL");
  validateRow_(S, patch, false);
  const headers = dbHeaders_(name), pkIdx = headers.indexOf(S.pk);
  assert_(pkIdx >= 0, "Colonne identifiant absente de " + name, "CONFIG");
  const ids = sh.getRange(2, pkIdx + 1, lr - 1, 1).getValues();
  let rowNo = -1;
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { rowNo = i + 2; break; }
  if (rowNo < 0) return false;
  const cur = sh.getRange(rowNo, 1, 1, headers.length).getValues()[0];
  // La ligne entière est réécrite : chaque cellule est ré-encodée pour ne pas laisser Sheets reconvertir un texte (date, heure, nombre).
  const out = headers.map(function (h, i) {
    if (!h) return cur[i];
    if (Object.prototype.hasOwnProperty.call(patch, h)) return patch[h] === undefined ? "" : toCell_(S, h, patch[h]);
    if (S.types[h] === undefined) return reencodeRaw_(cur[i]);
    return toCell_(S, h, normOut_(S, h, cur[i]));
  });
  sh.getRange(rowNo, 1, 1, headers.length).setValues([out]);
  delete DB_MEMO_[name];
  return true;
}
function dbDelete_(name, id) {
  const S = tableDef_(name), sh = dbSheet_(name), lr = sh.getLastRow();
  if (lr < 2) return false;
  const pkIdx = dbHeaders_(name).indexOf(S.pk), ids = sh.getRange(2, pkIdx + 1, lr - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); delete DB_MEMO_[name]; return true; }
  return false;
}
/** Insertion unique : retourne {row, created}. À appeler sous verrou. */
function dbInsertUnique_(name, field, value, obj) {
  const ex = dbFind_(name, field, value);
  if (ex) return { row: ex, created: false };
  const o = Object.assign({}, obj); o[field] = value;
  return { row: dbInsert_(name, o), created: true };
}

/* ---------- Paramètres (plateforme < organisation) ---------- */
function getSetting_(key, orgId) {
  if (orgId) {
    const o = dbAll_("Settings").find(function (s) { return String(s.organizationId) === String(orgId) && s.settingKey === key; });
    if (o) return parseJson_(o.settingValue, o.settingValue);
  }
  const g = dbAll_("PlatformSettings").find(function (s) { return s.settingKey === key; });
  if (g) return parseJson_(g.settingValue, g.settingValue);
  return DEFAULT_SETTINGS[key];
}
function setSetting_(key, value, orgId, actor) {
  assert_(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key), "Paramètre inconnu : " + key);
  const json = jsonSafe_(value);
  if (orgId) {
    const ex = dbAll_("Settings").find(function (s) { return String(s.organizationId) === String(orgId) && s.settingKey === key; });
    if (ex) dbUpdate_("Settings", ex.settingId, { settingValue: json, updatedAt: nowIso_(), updatedBy: actor || "" });
    else dbInsert_("Settings", { organizationId: orgId, settingKey: key, settingValue: json, updatedAt: nowIso_(), updatedBy: actor || "" });
  } else {
    if (dbGet_("PlatformSettings", key)) dbUpdate_("PlatformSettings", key, { settingValue: json, updatedAt: nowIso_(), updatedBy: actor || "" });
    else dbInsert_("PlatformSettings", { settingKey: key, settingValue: json, updatedAt: nowIso_(), updatedBy: actor || "" });
  }
}
