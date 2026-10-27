/**
 * Point d'entrée de l'application web et routeur unique des appels serveur.
 *
 * Le navigateur n'appelle que trois fonctions globales :
 *  - api(token, route, args)  : routes authentifiées (le jeton de session est vérifié à CHAQUE appel) ;
 *  - apiPublic(route, args)   : connexion, mot de passe, invitation, portail voyageur (jetons à usage limité) ;
 *  - doGet(e)                 : rendu de la page.
 * Les autres fonctions globales sans « _ » (setupProject, installTriggers…) sont protégées par assertEditor_().
 * Chaque route est une fonction privée (suffixe « _ ») qui reçoit le principal vérifié côté serveur.
 */
/** Table des routes (construite à l'appel : les fonctions sont définies dans d'autres fichiers, chargés après celui-ci). */
/**
 * Les routes désignent leur fonction par son NOM : si un fichier .gs manque ou a été collé incomplètement,
 * seules les routes concernées échouent (avec un message clair) au lieu de bloquer toute l'application.
 */
function resolveHandler_(name) {
  const g = typeof globalThis !== "undefined" ? globalThis : this;
  const fn = typeof name === "function" ? name : g[name];
  if (typeof fn !== "function") throw new AppError("CONFIG", "Installation incomplète : la fonction serveur « " + name + " » est introuvable (fichier .gs absent ou collé partiellement). Lancez verifierInstallation() dans l'éditeur Apps Script.");
  return fn;
}
function routes_() { return {
  "me.get": function (p) { return meBootstrap_(p); }, "me.logout": "meLogout_", "me.logoutAll": "meLogoutAll_", "me.changePassword": "meChangePassword_", "me.updateProfile": "meUpdateProfile_", "me.requestDeletion": "meRequestDeletion_",
  "meta.get": function (p) { return metaGet_(p); }, "me.boot": function (p) { return { me: meBootstrap_(p), meta: metaGet_(p) }; },
  "admin.accounts": "adminAccounts_", "admin.impersonate": "impersonateStart_", "me.endImpersonation": "impersonateEnd_",
  "org.list": "orgList_", "org.create": "orgCreate_", "org.update": "orgUpdate_", "org.setStatus": "orgSetStatus_",
  "support.request": "supportRequest_", "support.decide": "supportDecide_", "support.revoke": "supportRevoke_", "support.list": "supportList_",
  "invite.create": "inviteCreate_", "invite.resend": "inviteResend_", "invite.revoke": "inviteRevoke_", "invite.list": "inviteList_",
  "user.list": "userList_", "user.setStatus": "userSetStatus_", "user.sendActivation": "userSendActivation_", "user.erase": "userErase_", "role.setStatus": "roleSetStatus_", "role.setPermissions": "roleSetPermissions_", "role.caps": "roleCapsCatalog_",
  "notif.list": "notifList_", "notif.read": "notifRead_", "notif.whatsapp": "notifWhatsApp_", "notif.email": "notifSendEmail_",
  "doc.upload": "docUpload_", "doc.list": "docList_", "doc.get": "docGet_", "doc.archive": "docArchive_",
  "admin.diagnostics": "adminDiagnostics_", "admin.backup": "adminBackup_", "admin.backups": "adminBackups_", "admin.errors": "adminErrors_", "admin.jobs": "adminJobs_",
  "settings.get": "settingsGet_", "settings.set": "settingsSet_", "audit.list": "auditList_",
  "property.list": "propertyList_", "property.choices": "propertyChoices_", "property.get": "propertyGet_", "property.orgChoices": function (p) { return propertyOrgChoices_(p); },
  "property.create": "propertyCreate_", "property.update": "propertyUpdate_", "property.archive": "propertyArchive_", "property.import": "propertyImport_", "property.export": "propertyExport_",
  "residence.list": "residenceList_", "residence.create": "residenceCreate_",
  "property.agencyChoices": "propertyAgencyChoices_", "property.agencySet": "propertyAgencySet_", "property.agencyCreate": "ownerAgencyCreate_", "agency.mine": "ownerAgencyList_", "agency.update": "ownerAgencyUpdate_", "agency.resendInvite": "ownerAgencyResendInvite_", "agency.revokeAll": "ownerAgencyRevokeAll_", "agency.delete": "ownerAgencyDelete_", "property.access": "propertyAccessList_", "property.staffAssign": "propertyStaffAssign_", "property.staffRevoke": "propertyStaffRevoke_",
  "resv.list": "resvList_", "resv.get": "resvGet_", "resv.availability": "resvAvailability_", "resv.create": "resvCreate_", "resv.update": "resvUpdate_", "resv.setStatus": "resvSetStatus_", "resv.cancel": "resvCancel_",
  "resv.calendar": "resvCalendar_", "resv.sendConfirmation": "resvSendConfirmation_", "resv.sheet": "resvSheet_", "block.create": "blockCreate_", "block.cancel": "blockCancel_",
  "guest.list": "guestList_", "guest.policeForms": "guestPoliceForms_", "guest.save": "guestSave_", "guest.purge": "guestPurge_", "guest.tokenCreate": "guestTokenCreate_", "guest.tokenRevoke": "guestTokenRevoke_",
  "ops.today": "opsToday_", "ops.checkIn": "opsCheckIn_", "ops.checkOut": "opsCheckOut_", "ops.history": "opsHistory_", "ops.report": "opsReport_",
  "clean.list": "cleanList_", "clean.get": "cleanGet_", "clean.create": "cleanCreate_", "clean.assign": "cleanAssign_", "clean.respond": "cleanRespond_", "clean.start": "cleanStart_", "clean.room": "cleanRoom_",
  "clean.anomaly": "cleanAnomaly_", "clean.complete": "cleanComplete_", "clean.validate": "cleanValidate_", "clean.cancel": "cleanCancel_", "clean.orderPdf": "cleanOrderPdf_", "clean.reportPdf": "cleanReportPdf_",
  "inc.list": "incList_", "inc.get": "incGet_", "inc.create": "incCreate_", "inc.update": "incUpdate_", "inc.comment": "incComment_",
  "ctr.list": "ctrList_", "ctr.choices": "ctrChoices_", "ctr.get": "ctrGet_", "ctr.create": "ctrCreate_", "ctr.update": "ctrUpdate_",
  "quote.request": "quoteRequest_", "quote.submit": "quoteSubmit_", "quote.create": "quoteCreate_", "quote.decline": "quoteDeclineRequest_", "quote.decide": "quoteDecide_", "quote.list": "quoteList_", "quote.pdf": "quotePdf_",
  "wo.create": "woCreate_", "wo.respond": "woRespond_", "wo.schedule": "woSchedule_", "wo.start": "woStart_", "wo.complete": "woComplete_", "wo.verify": "woVerify_", "wo.cancel": "woCancel_",
  "wo.list": "woList_", "wo.get": "woGet_", "wo.pdf": "woOrderPdf_",
  "inv.submit": "invSubmit_", "inv.approve": "invApprove_", "inv.reject": "invReject_", "inv.list": "invList_", "inv.get": "invGet_", "inv.pdf": "invoicePdf_",
  "fin.summary": "finSummary_", "pay.record": "payRecord_", "pay.void": "payVoid_", "pay.reconcile": "payReconcile_", "pay.list": "payList_",
  "exp.create": "expCreate_", "exp.cancel": "expCancel_", "exp.list": "expList_", "rev.create": "revCreate_",
  "tenant.list": "tenantList_", "tenant.create": "tenantCreate_", "tenant.update": "tenantUpdate_",
  "lease.list": "leaseList_", "lease.get": "leaseGet_", "lease.create": "leaseCreate_", "lease.update": "leaseUpdate_", "lease.activate": "leaseActivate_", "lease.notice": "leaseNotice_",
  "lease.end": "leaseEnd_", "lease.renew": "leaseRenew_", "lease.depositReturn": "leaseDepositReturn_", "lease.receipt": "leaseReceipt_", "lease.document": "leaseDocument_", "lease.mine": function (p) { return leaseMine_(p); },
  "lease.automation": "leaseAutomationSet_", "rent.sendCall": "rentSendCallRoute_", "rent.sendReminder": "rentSendReminderRoute_", "rent.sendReceipt": "rentSendReceiptRoute_", "rent.preview": "rentPreview_",
  "leasedoc.draft": "leaseDocDraft_", "leasedoc.get": "leaseDocGet_", "leasedoc.update": "leaseDocUpdate_", "leasedoc.pdf": "leaseDocPdf_", "leasedoc.finalize": "leaseDocFinalize_",
  "leasedoc.send": "leaseDocSend_", "leasedoc.cancel": "leaseDocCancel_",
  "inspection.create": "inspectionCreate_", "inspection.get": "inspectionGet_", "inspection.save": "inspectionSave_", "inspection.write": "inspectionWrite_", "inspection.pdf": "inspectionPdf_",
  "inspection.finalize": "inspectionFinalize_", "inspection.send": "inspectionSend_", "inspection.cancel": "inspectionCancel_",
  "plan.list": "planList_", "plan.save": "planSave_", "sub.assign": "subAssign_", "sub.recordPayment": "subRecordPayment_", "sub.setStatus": "subSetStatus_", "sub.list": "subList_",
  "sub.mine": function (p) { return subMine_(p); }, "sub.requestChange": "subRequestChange_", "sub.contractPdf": "subContractPdf_", "assistant.kb": "assistantKb_", "assistant.ask": "assistantAsk_",
  "dash.get": "dashGet_", "pareto.run": "paretoRun_", "pareto.export": "paretoExport_", "report.run": "reportRun_", "report.export": "reportExport_"
}; }
function publicRoutes_() { return {
  "auth.login": "authLogin_", "assistant.kb": "assistantKbPublic_", "auth.requestReset": "authRequestReset_", "auth.resetPassword": "authResetPassword_",
  "invite.info": "inviteInfo_", "invite.accept": "inviteAccept_", "legal.get": "legalGet_", "demo.views": "demoPublicViews_", "demo.enter": "demoEnter_",
  "guest.portal.get": "guestPortalGet_", "guest.portal.save": "guestPortalSave_", "guest.portal.upload": "guestPortalUpload_", "guest.portal.incident": "guestPortalIncident_"
}; }

/* ------------------------- Vérification de l'installation -------------------------
 * Autonome (ne dépend d'aucun autre fichier) : si un fichier manque ou est mal nommé dans le projet Apps Script,
 * la page affiche la liste exacte des fichiers à corriger au lieu d'une erreur technique.
 */
var INSTALL_HTML_FILES_ = ["Index", "Styles", "Components", "I18n", "Login", "Dashboard", "Pages", "Scripts", "Assistant"];
/* Première et dernière fonction de chaque fichier : détecte un fichier absent ET un fichier collé incomplètement. */
var INSTALL_GS_SENTINELS_ = { Admin: ["assertEditor_", "auditList_"], Legal: ["legalGet_", "legalValues_"], Assistant: ["assistantRoles_", "testerAssistantIA"], Demo: ["creerEnvironnementDemo", "demoSummaryText_"], AuditService: ["auditRedact_", "diff_"], Auth: ["pbkdfIters_", "meBootstrap_"], CheckInOutService: ["checkEventOut_", "opsReport_"], CleaningService: ["cleanMine_", "cleaningExpireJob_"], Code: ["routes_", "metaGet_"], Compat: ["p4ExpireCleaningMissions", "installPhase4Triggers"], Config: ["include"], ContractorService: ["contractorUsableFor_", "ctrUpdate_"], DashboardService: ["dashGet_", "dashLease_"], Database: ["dbReset_", "setSetting_"], DriveService: ["driveRoot_", "purgeExpiredDocuments_"], FinanceService: ["finScopeProps_", "finSummary_"], GuestService: ["maskIdRef_", "guestPortalIncident_"], IncidentService: ["incidentInsert_", "incidentAlertsJob_"], InvoiceService: ["invoiceOut_", "invRefreshPaid_"], LeaseService: ["rentPaid_", "leaseJob_"], LeaseAgentService: ["laFill_", "inspectionCancel_"], RentAutomationService: ["rentReminderDays_", "rentMailingsOf_"], Migrations: ["migSchemaSync_", "listBackups_"], NotificationService: ["sendMailSafe_", "notifSendEmail_"], OrganizationService: ["orgPublic_", "supportList_"], ParetoService: ["paretoCompute_", "paretoExport_"], Permissions: ["ctxReset_", "assertQuota_"], PropertyService: ["propertyInput_", "propertyStaffRevoke_"], ReportsService: ["reportBuild_", "reportExport_"], ReservationService: ["idemRun_", "resvSheet_"], SubscriptionService: ["planOut_", "subscriptionJob_"], Tests: ["runAllTests", "TEST_GROUPS_"], Triggers: ["installTriggers", "guestTokenExpireJob_"], UserService: ["bestRoleIn_", "userSendActivation_"], Utils: ["assert_", "isDateObj_"], WorkOrderService: ["quoteOut_", "woOrderPdf_"] };
function installCheck_() {
  const g = typeof globalThis !== "undefined" ? globalThis : this;
  const missingGs = Object.keys(INSTALL_GS_SENTINELS_).filter(function (f) { return INSTALL_GS_SENTINELS_[f].some(function (n) { return typeof g[n] !== "function"; }); });
  // Toutes les fonctions appelées par les routes doivent exister.
  const handlers = [];
  try { [routes_(), publicRoutes_()].forEach(function (R) { Object.keys(R).forEach(function (k) { if (typeof R[k] === "string" && typeof g[R[k]] !== "function" && handlers.indexOf(R[k]) < 0) handlers.push(R[k]); }); }); } catch (e) { handlers.push("routes_"); }
  // Version « 2 fichiers » : Index.html contient toute l'interface (marqueur IMMOPILOT_BUNDLE), les autres fichiers HTML sont inutiles.
  // Détection par le CODE de l'interface (et non par un commentaire HTML, que Google peut retirer à la lecture du fichier).
  let indexContent = null;
  try { indexContent = HtmlService.createHtmlOutputFromFile("Index").getContent(); } catch (e) { indexContent = null; }
  const bundled = !!indexContent && indexContent.indexOf("const PAGES = {}") >= 0 && indexContent.indexOf("NAV_HASH") >= 0;
  let missingHtml = (bundled ? ["Index"] : INSTALL_HTML_FILES_).filter(function (n) { try { HtmlService.createHtmlOutputFromFile(n); return false; } catch (e) { return true; } });
  // Index présent mais court (ancienne version qui appelle 7 autres fichiers) alors qu'aucun de ces fichiers n'existe :
  // le plus simple est de remplacer Index par la version complète.
  // (Seulement si AUCUN des 7 fichiers n'existe : sinon il s'agit d'une installation en fichiers séparés incomplète.)
  const indexOutdated = !!indexContent && !bundled && missingHtml.length === INSTALL_HTML_FILES_.length - 1 && missingHtml.indexOf("Index") < 0;
  if (indexOutdated) missingHtml = ["Index"];
  return { ok: !missingGs.length && !missingHtml.length && !handlers.length, missingGs: missingGs, missingHtml: missingHtml, missingFunctions: handlers, indexOutdated: indexOutdated, bundled: bundled,
    expected: { gs: Object.keys(INSTALL_GS_SENTINELS_).length, html: INSTALL_HTML_FILES_.length } };
}
/** À lancer depuis l'éditeur : liste les fichiers manquants ou mal nommés (aucune donnée lue ni modifiée). */
function verifierInstallation() {
  const r = installCheck_();
  if (r.ok) console.log("Installation complète : " + r.expected.gs + " fichiers script et " + r.expected.html + " fichiers HTML trouvés.");
  else {
    if (r.indexOutdated) console.log("Index.html contient l'ancienne version courte (sans l'interface). Remplacez TOUT son contenu par le fichier 2_Index_html_A_COLLER.txt (environ 2 066 lignes), puis publiez une nouvelle version.");
    else if (r.missingHtml.length) console.log("Fichiers HTML introuvables (à créer avec ＋ › HTML, nom exact, sans .html) : " + r.missingHtml.join(", "));
    if (r.missingGs.length) console.log("Fichiers script introuvables ou collés incomplètement (＋ › Script, nom exact sans .gs, recollez TOUT le contenu) : " + r.missingGs.join(", "));
    if (r.missingFunctions.length) console.log("Fonctions serveur introuvables : " + r.missingFunctions.join(", "));
  }
  return r;
}
function installErrorPage_(r) {
  const esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  const list = function (items, ext) { return "<ul>" + items.map(function (n) { return "<li><code>" + esc(n) + ext + "</code></li>"; }).join("") + "</ul>"; };
  let html = "<!DOCTYPE html><html><head><meta charset='utf-8'><style>body{font-family:Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1d2b3a;line-height:1.5}" +
    "h1{font-size:20px;color:#1b3554}code{background:#eef2f7;padding:1px 5px;border-radius:4px}.box{border:1px solid #e3b341;background:#fff8e6;padding:12px 16px;border-radius:8px}</style></head><body>" +
    "<h1>ImmoPilot : installation incomplète</h1><div class='box'>L'application ne peut pas démarrer car des fichiers sont absents ou mal nommés dans le projet Apps Script. Aucune donnée n'est en cause.</div>";
  if (r.indexOutdated) html += "<h2>Le fichier Index.html n'est pas la version complète</h2><p>Il contient l'ancienne version courte, qui appelle 7 autres fichiers. Dans l'éditeur, ouvrez <code>Index.html</code>, faites Ctrl+A puis Supprimer, et collez <b>tout</b> le contenu du fichier <code>2_Index_html_A_COLLER.txt</code> (environ 2 066 lignes). Ne recréez pas les autres fichiers HTML.</p>";
  else if (r.missingHtml.length) html += "<h2>Fichiers HTML introuvables</h2>" + list(r.missingHtml, ".html") +
    "<p>Dans l'éditeur : <b>＋ › HTML</b> (et non « Script »), tapez le nom exact <b>sans</b> « .html », en respectant les majuscules, effacez le contenu proposé et collez celui du fichier du ZIP. Si un fichier du même nom existe en <code>.gs</code>, supprimez-le.</p>";
  if (r.missingGs.length) html += "<h2>Fichiers script introuvables ou incomplets</h2>" + list(r.missingGs, ".gs") +
    "<p>Dans l'éditeur : <b>＋ › Script</b>, nom exact sans « .gs », collez le contenu complet du fichier du ZIP.</p>";
  html += "<h2>Ensuite</h2><ol><li>Enregistrez (Ctrl+S).</li><li>Déployer › Gérer les déploiements › ✏️ › Version : <b>Nouvelle version</b> › Déployer.</li><li>Rechargez cette page.</li></ol>" +
    "<p>Astuce : dans l'éditeur, la fonction <code>verifierInstallation</code> affiche la même liste dans le journal d'exécution.</p></body></html>";
  return HtmlService.createHtmlOutput(html).setTitle("ImmoPilot — installation incomplète");
}

/**
 * Intégration de l'application dans VOTRE site ou VOS applications mobiles (désactivée par défaut).
 * Propriété du script IMMO_EMBED_ORIGINS : liste d'origines autorisées, séparées par des virgules,
 * ex. « https://monnom.github.io ». Vide = l'application ne peut pas être affichée dans un autre site (protection anti-clickjacking).
 * Google ne permet pas de restreindre l'intégration à certaines origines côté serveur : l'interface vérifie donc
 * elle-même ses cadres parents (location.ancestorOrigins) et refuse de s'afficher dans un site non autorisé.
 */
function embedOrigins_() {
  let raw = "";
  try { raw = PropertiesService.getScriptProperties().getProperty(IMMO_CONFIG.EMBED_ORIGINS_PROPERTY) || ""; } catch (e) { raw = ""; }
  // On ne garde que l'origine (https://domaine[:port]) : une adresse avec un chemin (…github.io/immopilot/) est acceptée.
  return raw.split(",").map(function (x) { const m = String(x).trim().match(/^https:\/\/[a-z0-9.-]+(:\d+)?(?=\/|$)/i); return m ? m[0].toLowerCase() : ""; })
    .filter(Boolean).slice(0, 10);
}

/** Réglages d'édition utiles à l'interface (aucune donnée privée). */
function editionPublic_() {
  const e = edition_();
  return { code: e.code, country: e.country, countryName: e.countryName, currency: e.currency, timezone: e.timezone, city: e.city, mapCenter: e.mapCenter, phoneCountry: e.phoneCountry,
    localMobileRe: e.localMobileRe, tagline: e.tagline, taglineKey: e.taglineKey, logoSvg: e.logoSvg, policeForms: e.policeForms, registrationNumber: e.registrationNumber,
    dataAuthority: e.dataAuthority, taxIdLabel: e.taxIdLabel, publicDemo: !!IMMO_PUBLIC_DEMO_ };
}
/** Contrôle d'installation mémorisé 6 h par version installée : l'ouverture de l'application ne relit pas tous les fichiers à chaque fois. */
function installCheckCached_() {
  if (IMMO_BUILD_ === "dev") return installCheck_();
  const k = "installok_" + IMMO_BUILD_;
  try { if (CacheService.getScriptCache().get(k)) return { ok: true }; } catch (e) { /* contrôle complet */ }
  const r = installCheck_();
  if (r.ok) { try { CacheService.getScriptCache().put(k, "1", 21600); } catch (e) { /* facultatif */ } }
  return r;
}
function doGet(e) {
  const check = installCheckCached_();
  if (!check.ok) return installErrorPage_(check);
  const prm = (e && e.parameter) || {};
  const action = ["accept", "reset", "guest", "legal"].indexOf(String(prm.action || "")) >= 0 ? String(prm.action) : "app";
  const doc = /^[a-z]{2,20}$/.test(String(prm.doc || "")) ? String(prm.doc) : "";
  const token = /^[a-f0-9]{64}$/.test(String(prm.token || "")) ? String(prm.token) : "";
  const t = HtmlService.createTemplateFromFile("Index");
  const embed = embedOrigins_();
  t.boot = JSON.stringify({ mode: action, token: token, appName: IMMO_CONFIG.APP_NAME, version: IMMO_CONFIG.VERSION, embed: embed, edition: editionPublic_(), doc: doc });
  return t.evaluate().setTitle(IMMO_CONFIG.APP_NAME).addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(embed.length ? HtmlService.XFrameOptionsMode.ALLOWALL : HtmlService.XFrameOptionsMode.DEFAULT);
}

function argsGuard_(args) {
  if (args === null || args === undefined) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw new AppError("VALIDATION", "Paramètres invalides.");
  let size = 0; try { size = JSON.stringify(args).length; } catch (e) { throw new AppError("VALIDATION", "Paramètres non sérialisables."); }
  if (size > 7 * 1024 * 1024) throw new AppError("VALIDATION", "Requête trop volumineuse.");
  return args;
}
function errorResponse_(e, route) {
  if (e instanceof AppError || (e && e.name === "AppError")) {
    if (e.code === "FORBIDDEN") audit_("ACCESS_DENIED", "Route", route, "", { message: String(e.message).slice(0, 200) }, "DENIED");
    return { ok: false, error: { code: e.code, message: e.message } };
  }
  const errorId = "ERR-" + Utilities.getUuid().slice(0, 8).toUpperCase();
  console.error(errorId + " " + route + " : " + (e && e.stack ? e.stack : e));
  try { dbInsert_("ActivityLogs", { timestamp: nowIso_(), actorEmail: CTX_.principal ? CTX_.principal.email : "", actorUserId: CTX_.principal ? CTX_.principal.userId : "", organizationId: "",
    action: "ERROR", entityType: "Route", entityId: route, detailsJson: jsonSafe_({ route: route, message: String(e && e.message || e).slice(0, 500), errorId: errorId }), result: "ERROR", errorId: errorId }); } catch (e2) { console.error(e2.message); }
  const quota = /quota|Service invoked too many times|Limit Exceeded|trop de fois/i.test(String(e && e.message));
  return { ok: false, error: { code: quota ? "QUOTA" : "INTERNAL", message: quota ? "Quota Google atteint, réessayez plus tard (réf. " + errorId + ")." : "Erreur interne. Référence : " + errorId + "." } };
}

/** Appel authentifié. Le jeton est vérifié côté serveur à chaque appel ; aucune donnée d'identité fournie par le navigateur n'est crue. */
function api(token, route, args) {
  ctxReset_(); dbReset_(); LOCK_DEPTH_ = 0; dbcBegin_("request");
  try { return apiRun_(token, route, args); } finally { dbcCommit_(); }
}
function apiRun_(token, route, args) {
  ensureSchemaCurrent_();
  route = String(route || "");
  try {
    const R = routes_(), name = Object.prototype.hasOwnProperty.call(R, route) ? R[route] : null;
    if (!name) throw new AppError("NOT_FOUND", "Fonction inconnue : " + route);
    const fn = resolveHandler_(name);
    const a = argsGuard_(args);
    const p = principalFromToken_(token);
    CTX_.principal = p;
    if (p.demoView && !demoRouteAllowed_(route)) return { ok: false, error: { code: "DEMO_READONLY", message: "Démonstration en lecture seule : cette action est désactivée. Vous pouvez parcourir toutes les pages et ouvrir les documents." } };
    return { ok: true, data: fn(p, a) };
  } catch (e) { return errorResponse_(e, route); }
}
/** Appel public : uniquement les routes dont la sécurité repose sur un secret à usage unique ou un mot de passe. */
function apiPublic(route, args) {
  ctxReset_(); dbReset_(); LOCK_DEPTH_ = 0; dbcBegin_("request");
  try { return apiPublicRun_(route, args); } finally { dbcCommit_(); }
}
function apiPublicRun_(route, args) {
  ensureSchemaCurrent_();
  route = String(route || "");
  try {
    const R = publicRoutes_(), name = Object.prototype.hasOwnProperty.call(R, route) ? R[route] : null;
    if (!name) throw new AppError("NOT_FOUND", "Fonction inconnue.");
    const fn = resolveHandler_(name);
    return { ok: true, data: fn(argsGuard_(args)) };
  } catch (e) { return errorResponse_(e, route); }
}

/** Métadonnées pour l'interface (listes de valeurs, types d'analyses et de rapports). Aucune donnée client. */
function metaGet_(p) {
  const S = schema_(), enums = {};
  ["Reservations", "CleaningMissions", "IncidentsV4", "Quotes", "WorkOrders", "Invoices", "Leases", "Subscriptions", "Payments", "Properties", "Expenses"].forEach(function (t) { enums[t] = S[t].enums; });
  const inviteRoles = {};
  p.roles.forEach(function (r) { const best = bestRoleIn_(p, r.organizationId); if (best && INVITABLE_ROLES[best]) inviteRoles[r.organizationId] = INVITABLE_ROLES[best]; });
  return { enums: enums, paretoTypes: Object.keys(PARETO_TYPES_).map(function (k) { return { type: k, title: PARETO_TYPES_[k].title, unit: PARETO_TYPES_[k].unit }; }),
    reportTypes: Object.keys(REPORT_TYPES_).map(function (k) { return { type: k, title: REPORT_TYPES_[k] }; }), roles: IMMO_CONFIG.ROLES, inviteRoles: inviteRoles,
    superInviteRoles: p.isSuper ? INVITABLE_ROLES.SUPER_ADMIN : [], roleCaps: ROLE_CAPS, propertyTypes: PROPERTY_TYPES_, sources: RESV_SOURCES_, idTypes: idTypes_(), payMethods: PAY_METHODS_,
    planFeatures: PLAN_FEATURES_, severities: SEVERITIES_, settingsKeys: Object.keys(DEFAULT_SETTINGS), orgEditableSettings: ORG_EDITABLE_SETTINGS_ };
}
