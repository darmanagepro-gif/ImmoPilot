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
function dbSetSpreadsheet_(ss) { DB_SS_ = ss; dbReset_(); DBC_ = null; }

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
  const useCache = dbcUsable_(name);
  if (useCache) {
    const hit = dbcRead_(name);
    if (hit) { DB_MEMO_[name] = hit; return hit; }
  }
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
  if (useCache && dbcUsable_(name)) dbcWrite_(name, rows);
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
  delete DB_MEMO_[name]; dbcTouch_(name);
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
  delete DB_MEMO_[name]; dbcTouch_(name);
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
  delete DB_MEMO_[name]; dbcTouch_(name);
  if (name === "Sessions") { const th = headers.indexOf("tokenHash"); if (th >= 0 && cur[th]) dbcForgetToken_(String(cur[th])); }
  return true;
}
function dbDelete_(name, id) {
  const S = tableDef_(name), sh = dbSheet_(name), lr = sh.getLastRow();
  if (lr < 2) return false;
  const pkIdx = dbHeaders_(name).indexOf(S.pk), ids = sh.getRange(2, pkIdx + 1, lr - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) {
    if (name === "Sessions") { const th = dbHeaders_(name).indexOf("tokenHash"); if (th >= 0) dbcForgetToken_(String(sh.getRange(i + 2, th + 1).getValue())); }
    sh.deleteRow(i + 2); delete DB_MEMO_[name]; dbcTouch_(name); return true; }
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

/* ============================== Cache partagé des tables ==============================
 * Chaque lecture de feuille coûte 0,1 à 0,5 s dans Google. Les tables sont donc gardées, compressées, dans le cache
 * de script (CacheService, mémoire partagée par toutes les exécutions) : un écran n'ouvre plus le classeur.
 * Cohérence :
 *  - chaque table a une « version » dans le cache ; une donnée en cache n'est utilisée que si elle porte la version
 *    courante et l'époque courante (viderCache() change l'époque, donc tout le cache) ;
 *  - toute écriture change aussitôt la version de la table (les autres exécutions cessent d'utiliser l'ancienne copie),
 *    puis la change encore après SpreadsheetApp.flush() en fin de requête ou de verrou : une copie lue pendant
 *    l'écriture ne peut jamais devenir « la » version courante ;
 *  - sous verrou (withLock_), les lectures vont toujours à la feuille : les contrôles critiques (double réservation,
 *    paiements…) restent faits sur les données réelles ;
 *  - une table modifiée dans l'exécution en cours est relue depuis la feuille jusqu'à la fin de l'exécution.
 * Les journaux (ActivityLogs, NotificationLogs…) ne sont pas mis en cache. En cas de panne du cache, tout est lu
 * dans la feuille comme avant. Modifications faites à la main dans le classeur : déclencheur surModificationBase
 * (installTriggers) ou fonction viderCache(), sinon prises en compte au plus tard après 30 minutes.
 */
var DBC_ = null;
var DBC_SKIP_ = { ActivityLogs: true, NotificationLogs: true, PasswordResets: true, MigrationHistory: true, Sessions: true, ScheduledJobs: true };
var DBC_CORE_ = ["Users", "Organizations", "UserRoles", "SupportGrants", "PlatformSettings", "Settings", "Subscriptions", "SubscriptionPlans", "Properties", "AgencyPropertyPermissions", "PropertyAssignments",
  "Reservations", "CleaningMissions", "Incidents", "Quotes", "WorkOrders", "Invoices", "Payments", "Expenses", "Leases", "RentSchedules", "Artisans", "Tenants", "Notifications", "AvailabilityBlocks", "RevenueRecords"];
var DBC_DATA_TTL_ = 1800, DBC_VER_TTL_ = 21600, DBC_TOKEN_TTL_ = 600, DBC_CHUNK_ = 95000, DBC_MAX_CHUNKS_ = 40;

/** Début d'exécution : « request » (api, tâches planifiées, lot) = validation groupée en fin ; « script » = validation à chaque écriture. */
function dbcBegin_(mode) { DBC_ = { mode: mode || "script", loaded: false, off: false, base: "", epoch: "", vers: {}, got: {}, dirty: {}, bumped: {}, tokens: {}, hits: 0, misses: 0 }; return DBC_; }
function dbcState_() { return DBC_ || dbcBegin_("script"); }
function dbcCache_() { return CacheService.getScriptCache(); }
function dbcNewTag_() { return Utilities.getUuid().replace(/-/g, "").slice(0, 12); }
function dbcUsable_(name) { const st = dbcState_(); return !TEST_HOOKS_.noDbCache && !DBC_SKIP_[name] && !LOCK_DEPTH_ && !st.off && !st.dirty[name]; }
function dbcBase_() {
  const st = dbcState_();
  if (!st.base) {
    const id = DB_SS_ ? DB_SS_.getId() : (PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.DATABASE_PROPERTY) || "");
    st.base = "ipdb" + sha256Hex_(String(id)).slice(0, 10) + "_";
  }
  return st.base;
}
/** Une seule lecture du cache par exécution : époque, versions de toutes les tables, tables les plus utilisées, clés demandées. */
function dbcLoad_(extraKeys) {
  const st = dbcState_();
  if (st.loaded || st.off) return st;
  st.loaded = true;
  try {
    const b = dbcBase_(), names = Object.keys(schema_()).filter(function (n) { return !DBC_SKIP_[n]; });
    const keys = [b + "epoch"].concat(names.map(function (n) { return b + "v_" + n; }), DBC_CORE_.map(function (n) { return b + "d_" + n + "_0"; }), extraKeys || []);
    st.got = dbcCache_().getAll(keys) || {};
    st.epoch = st.got[b + "epoch"] || "";
    if (!st.epoch) { st.epoch = dbcNewTag_(); dbcCache_().put(b + "epoch", st.epoch, DBC_VER_TTL_); }
    names.forEach(function (n) { if (st.got[b + "v_" + n]) st.vers[n] = st.got[b + "v_" + n]; });
  } catch (e) { st.off = true; console.error("Cache indisponible : " + e.message); }
  return st;
}
/** Version courante d'une table ; créée AVANT toute lecture de la feuille si elle n'existe pas encore. */
function dbcVersion_(name) {
  const st = dbcLoad_();
  if (!st.vers[name]) { st.vers[name] = dbcNewTag_(); try { dbcCache_().put(dbcBase_() + "v_" + name, st.vers[name], DBC_VER_TTL_); } catch (e) { st.off = true; } }
  return st.vers[name];
}
function dbcRead_(name) {
  const st = dbcLoad_(); if (st.off) return null;
  const known = !!st.vers[name], v = dbcVersion_(name);
  if (!known || st.off) { st.misses++; return null; }
  try {
    const b = dbcBase_(), k0 = b + "d_" + name + "_0", c = dbcCache_();
    const c0 = Object.prototype.hasOwnProperty.call(st.got, k0) ? st.got[k0] : c.get(k0);
    const head = function (x) { const m = /^([^~]*)~([^~]*)~(\d+)~/.exec(x || ""); return m ? { v: m[1], e: m[2], n: Number(m[3]), d: x.slice(m[0].length) } : null; };
    const h0 = head(c0);
    if (!h0 || h0.v !== v || h0.e !== st.epoch) { st.misses++; return null; }
    const parts = [h0.d];
    if (h0.n > 1) {
      const ks = []; for (let i = 1; i < h0.n; i++) ks.push(b + "d_" + name + "_" + i);
      const more = c.getAll(ks);
      for (let i = 0; i < ks.length; i++) { const hi = head(more[ks[i]]); if (!hi || hi.v !== v || hi.e !== st.epoch) { st.misses++; return null; } parts.push(hi.d); }
    }
    const json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(parts.join("")), "application/x-gzip")).getDataAsString("UTF-8");
    st.hits++;
    return JSON.parse(json);
  } catch (e) { st.misses++; return null; }
}
function dbcWrite_(name, rows) {
  const st = dbcState_(); if (st.off || !st.vers[name]) return;
  try {
    const packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(rows), "application/json")).getBytes());
    const n = Math.max(1, Math.ceil(packed.length / DBC_CHUNK_));
    if (n > DBC_MAX_CHUNKS_) return; // table trop grande pour le cache : lue dans la feuille
    const b = dbcBase_(), out = {}, pre = st.vers[name] + "~" + st.epoch + "~" + n + "~";
    for (let i = 0; i < n; i++) out[b + "d_" + name + "_" + i] = pre + packed.slice(i * DBC_CHUNK_, (i + 1) * DBC_CHUNK_);
    dbcCache_().putAll(out, DBC_DATA_TTL_);
  } catch (e) { console.error("Mise en cache impossible (" + name + ") : " + e.message); }
}
/** Écriture dans une table : la copie en cache cesse immédiatement d'être utilisée par toutes les exécutions. */
function dbcTouch_(name) {
  if (TEST_HOOKS_.noDbCache || DBC_SKIP_[name]) return;
  const st = dbcState_();
  st.dirty[name] = true;
  if (st.mode === "script") { try { SpreadsheetApp.flush(); } catch (e) { /* rien à valider */ } dbcBumpNow_([name]); return; }
  if (!st.bumped[name]) { st.bumped[name] = true; dbcBumpNow_([name]); }
}
function dbcBumpNow_(names) {
  const st = dbcState_(), b = dbcBase_(), puts = {};
  names.forEach(function (n) { st.vers[n] = dbcNewTag_(); puts[b + "v_" + n] = st.vers[n]; });
  try { if (names.length) dbcCache_().putAll(puts, DBC_VER_TTL_); } catch (e) { console.error("Cache : " + e.message); }
}
function dbcForgetToken_(hash) {
  if (TEST_HOOKS_.noDbCache || !hash) return;
  const st = dbcState_(); st.tokens[hash] = true;
  try { dbcCache_().remove(dbcBase_() + "t_" + hash); } catch (e) { /* expirera seul */ }
}
/** Fin de requête ou de verrou : les écritures sont validées dans la feuille, puis les versions changent une dernière fois. */
function dbcCommit_() {
  const st = DBC_; if (!st) return;
  const names = Object.keys(st.dirty), toks = Object.keys(st.tokens);
  if (!names.length && !toks.length) return;
  try { SpreadsheetApp.flush(); } catch (e) { /* rien à valider */ }
  if (names.length) dbcBumpNow_(names);
  if (toks.length) { try { dbcCache_().removeAll(toks.map(function (h) { return dbcBase_() + "t_" + h; })); } catch (e) { /* expirera seul */ } }
  st.dirty = {}; st.bumped = {}; st.tokens = {};
}
/** Exécute un traitement par lot (beaucoup d'écritures) avec une seule validation finale. */
function withDbBatch_(fn) {
  const prev = DBC_; dbcBegin_("request");
  try { return fn(); } finally { dbcCommit_(); DBC_ = prev; }
}
/** Session (par empreinte du jeton) en cache 10 minutes ; effacée dès que la session change. */
function dbcSessionGet_(hash) {
  if (TEST_HOOKS_.noDbCache) return null;
  const st = dbcLoad_([dbcBase_() + "t_" + hash]);
  const raw = st.got[dbcBase_() + "t_" + hash];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function dbcSessionPut_(hash, row) {
  if (TEST_HOOKS_.noDbCache || !row) return;
  const st = dbcState_(); if (st.off || st.tokens[hash]) return;
  try { dbcCache_().put(dbcBase_() + "t_" + hash, JSON.stringify(row), DBC_TOKEN_TTL_); } catch (e) { /* facultatif */ }
}
/** Invalide tout le cache des tables (après une modification manuelle du classeur, une restauration, une migration). */
function dbcBumpEpoch_() {
  const mode = DBC_ ? DBC_.mode : "script";
  try { const b = dbcBase_(); dbcCache_().put(b + "epoch", dbcNewTag_(), DBC_VER_TTL_); } catch (e) { console.error("Cache : " + e.message); }
  dbcBegin_(mode);
}
/** Éditeur Apps Script : à exécuter après avoir modifié le classeur à la main (le déclencheur surModificationBase le fait seul). */
function viderCache() { assertEditor_(); dbcBumpEpoch_(); return { ok: true, message: "Cache vidé : toutes les données seront relues dans le classeur." }; }
/** Déclencheur installable « à la modification » du classeur (installTriggers) : toute saisie manuelle vide le cache. */
function surModificationBase(e) { if (e && e.source && typeof e.source.getId === "function") dbcBumpEpoch_(); }
