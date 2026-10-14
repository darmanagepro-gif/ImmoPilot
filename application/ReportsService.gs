/**
 * Rapports filtrables et exports (JSON pour l'écran, CSV, PDF).
 * Chaque rapport réutilise les fonctions de lecture déjà cloisonnées (finCompute_, resvList_, incList_…) :
 * un export ne peut donc jamais contenir plus que ce que l'utilisateur peut voir à l'écran.
 * Les pièces d'identité, références de pièces et jetons ne figurent dans AUCUN export.
 */
var REPORT_TYPES_ = {
  OWNER_MONTHLY: "Rapport mensuel propriétaire", AGENCY_PERFORMANCE: "Performance d'agence", REVENUE_EXPENSES: "Revenus et dépenses", PROPERTY_PROFITABILITY: "Rentabilité par bien",
  RESERVATIONS: "Réservations", UNPAID: "Impayés", MAINTENANCE: "Maintenance", CONTRACTORS: "Prestataires", CLEANING: "Ménage", INCIDENTS: "Incidents", PARETO: "Analyse de Pareto",
  SUBSCRIPTIONS: "Abonnements", AUDIT: "Journal d'audit", CHECKINOUT: "Arrivées et départs"
};
function reportBuild_(p, a) {
  const type = oneOf_(a.type, Object.keys(REPORT_TYPES_), "Type de rapport");
  if (["SUBSCRIPTIONS", "AUDIT"].indexOf(type) < 0) assert_(p.isSuper || uiCaps_(p).some(function (c) { return ["report.view", "finance.view", "cleaning.manage", "contractor.manage", "workorder.operate", "checkin.operate"].indexOf(c) >= 0; }), "Accès aux rapports refusé.", "FORBIDDEN");
  const per = periodFromFilters_(a), f = Object.assign({}, a, { from: per.from, to: per.to });
  const listAll = function (fn, args) { const out = []; let page = 1; for (;;) { const r = fn(p, Object.assign({}, args, { page: page, pageSize: IMMO_CONFIG.MAX_PAGE_SIZE })); out.push.apply(out, r.items); if (out.length >= r.total || !r.items.length || out.length >= IMMO_CONFIG.MAX_EXPORT_ROWS) break; page++; } return out; };
  let R;
  switch (type) {
    case "OWNER_MONTHLY": case "PROPERTY_PROFITABILITY": {
      const fin = finCompute_(p, f);
      R = { headers: ["Bien", "Nuits réservées", "Occupation %", "Prix moyen/nuit", "RevPAR", "Prévu", "Facturé", "Encaissé", "Restant dû", "Dépenses", "Commissions gestion", "Résultat"],
        rows: fin.byProperty.map(function (r) { return [r.name, r.bookedNights, r.occupancyRate, r.adr, r.revpar, r.expected, r.billed, r.collected, r.outstanding, r.expenses, r.managementCommissions, r.result]; }),
        summary: fin.totals };
      if (type === "OWNER_MONTHLY") R.extra = { expensesByCategory: fin.expensesByCategory, byOwner: fin.byOwner };
      break;
    }
    case "AGENCY_PERFORMANCE": {
      const fin = finCompute_(p, f);
      R = { headers: ["Agence", "Réservations", "Nuits", "Revenus déclarés", "Commissions de gestion"], rows: fin.byAgency.map(function (x) { return [x.name, x.reservations, x.nights, x.expected, x.commissions]; }), summary: fin.totals };
      break;
    }
    case "REVENUE_EXPENSES": {
      const fin = finCompute_(p, f);
      R = { headers: ["Mois", "Prévu", "Encaissé", "Décaissé", "Dépenses", "Flux net", "Nuits"], rows: fin.byMonth.map(function (m) { return [m.month, m.expected, m.collected, m.paidOut, m.expenses, m.net, m.bookedNights]; }), summary: fin.totals };
      break;
    }
    case "RESERVATIONS": {
      const items = listAll(resvList_, { from: per.from, to: per.to, propertyId: a.propertyId, agencyOrganizationId: a.agencyOrganizationId, status: a.status, includeCancelled: true });
      R = { headers: ["Référence", "Bien", "Voyageur", "Arrivée", "Départ", "Voyageurs", "Statut", "Origine", "Total dû", "Payé", "Solde", "Paiement", "Commission"],
        rows: items.map(function (r) { return [r.reservationId, r.propertyName, r.guestName, r.checkIn, r.checkOut, r.guestCount, r.status, r.source || "", r.amountDue, r.paid, r.balance, r.paymentStatus || "", r.commissionAmount]; }) };
      break;
    }
    case "UNPAID": {
      const rows = [];
      listAll(resvList_, { from: per.from, to: per.to, propertyId: a.propertyId }).forEach(function (r) { if (num_(r.balance) > 0 && REVENUE_STATUSES_.indexOf(r.status) >= 0) rows.push(["Réservation", r.propertyName, r.guestName, r.checkIn, r.amountDue, r.paid, r.balance, r.checkIn < todayStr_() ? "EN RETARD" : "À VENIR"]); });
      const leaseProps = accessiblePropIds_(p, "lease.view");
      dbAll_("RentSchedules").filter(function (s) { return leaseProps[String(s.propertyId)] && s.status === "OPEN" && s.dueDate >= per.from && s.dueDate <= per.to && (!a.propertyId || String(s.propertyId) === String(a.propertyId)); }).forEach(function (s) {
        const st = rentStatus_(s); if (st.remaining > 0) { const l = dbGet_("Leases", s.leaseId), t = dbGet_("Tenants", l.tenantId) || {}; rows.push(["Loyer " + s.period, (dbGet_("Properties", s.propertyId) || {}).name, t.fullName, s.dueDate, st.amountDue, st.paid, st.remaining, st.status]); }
      });
      R = { headers: ["Nature", "Bien", "Débiteur", "Échéance", "Dû", "Payé", "Reste", "Statut"], rows: rows, summary: { totalOutstanding: sumBy_(rows, function (r) { return r[6]; }) } };
      break;
    }
    case "MAINTENANCE": {
      const incs = listAll(incList_, { from: per.from, to: per.to, propertyId: a.propertyId, category: a.category });
      R = { headers: ["Incident", "Bien", "Catégorie", "Gravité", "Statut", "Déclaré le", "Coût estimé", "Coût final", "Interventions", "Factures TTC"],
        rows: incs.map(function (i) { const w = dbAll_("WorkOrders").filter(function (x) { return String(x.incidentId) === String(i.incidentId) && x.status !== "CANCELLED"; });
          const v = dbAll_("Invoices").filter(function (x) { return String(x.incidentId) === String(i.incidentId) && ["APPROVED", "PARTIAL", "PAID"].indexOf(x.status) >= 0; });
          return [i.title, i.propertyName, i.category, i.severity, i.status, String(i.createdAt).slice(0, 10), i.estimatedCost, i.finalCost, w.length, sumBy_(v, function (x) { return x.amountTTC; })]; }) };
      break;
    }
    case "CONTRACTORS": {
      const items = listAll(ctrList_, { withStats: true });
      R = { headers: ["Prestataire", "Spécialités", "Statut", "Interventions", "Contrôlées", "Taux de résolution %", "Délai moyen (j)", "Facturé TTC", "Commissions"],
        rows: items.map(function (c) { return [c.name, (c.specialties || []).join(" / "), c.status, c.stats.interventions, c.stats.verified, c.stats.resolutionRate, c.stats.avgDelayDays, c.stats.totalInvoicedTTC, c.stats.commissionTotal]; }) };
      break;
    }
    case "CLEANING": {
      const items = listAll(cleanList_, { from: per.from, to: per.to, propertyId: a.propertyId, status: a.status });
      R = { headers: ["Mission", "Bien", "Prestataire", "Prévue", "Statut", "Durée estimée", "Durée réelle", "Anomalies", "Note qualité", "Coût"],
        rows: items.map(function (m) { return [m.missionId, m.propertyName, m.providerEmail, m.startAt, m.status, m.estimatedMinutes, m.actualMinutes, (m.anomalies || []).length, m.qualityScore, m.price]; }) };
      const d = dashCleaning_(p, f, per); R.summary = { completed: d.completedInPeriod, avgMinutes: d.avgMinutes, acceptanceRate: d.acceptanceRate, onTimeRate: d.onTimeRate, anomalies: d.anomalies };
      break;
    }
    case "INCIDENTS": {
      const items = listAll(incList_, { from: per.from, to: per.to, propertyId: a.propertyId, category: a.category, status: a.status, severity: a.severity });
      R = { headers: ["Référence", "Bien", "Titre", "Catégorie", "Gravité", "Statut", "Déclaré le", "Ancienneté (j)", "Résolu le", "Coût final"],
        rows: items.map(function (i) { return [i.incidentId, i.propertyName, i.title, i.category, i.severity, i.status, String(i.createdAt).slice(0, 10), i.ageDays, String(i.resolvedAt || "").slice(0, 10), i.finalCost]; }) };
      break;
    }
    case "CHECKINOUT": {
      const items = listAll(opsHistory_, { from: per.from, to: per.to, propertyId: a.propertyId });
      R = { headers: ["Type", "Bien", "Voyageur", "Prévu", "Réel", "Retard (min)", "Agent", "Incident"], rows: items.map(function (x) { return [x.kind, x.propertyName, x.guestName, x.plannedAt, x.actualAt, x.lateMinutes, x.agentEmail, x.incidentId || ""]; }) };
      break;
    }
    case "PARETO": {
      const r = paretoRun_(p, Object.assign({}, f, { type: a.paretoType || "INCIDENTS_BY_CATEGORY" }));
      const t = paretoTable_(r);
      R = { headers: t.headers, rows: t.rows, summary: { analyse: r.title, total: r.result.total, prioritaires: r.priorities.join(", "), periodePrecedente: r.previous.total } };
      break;
    }
    case "SUBSCRIPTIONS": {
      const r = { items: listAll(subList_, { includeClosed: true }) };
      R = { headers: ["Organisation", "Forfait", "Statut", "Début", "Fin de période", "Prochaine échéance", "Prix", "Retard (j)", "Biens", "Utilisateurs", "Stockage Mo"],
        rows: r.items.map(function (s) { return [s.organizationName, s.planCode, s.status, s.startDate, s.periodEnd, s.nextDueDate, s.price, s.daysOverdue, s.usage.properties, s.usage.users, s.usage.storageMb]; }) };
      break;
    }
    case "AUDIT": {
      const items = listAll(auditList_, { from: per.from, to: per.to, organizationId: a.organizationId, action: a.action });
      R = { headers: ["Horodatage", "Acteur", "Organisation", "Action", "Type", "Élément", "Résultat"], rows: items.map(function (l) { return [l.timestamp, l.actorEmail, l.organizationId, l.action, l.entityType, l.entityId, l.result]; }) };
      break;
    }
  }
  R.type = type; R.title = REPORT_TYPES_[type]; R.period = per;
  return R;
}
function exportLimit_(p) {
  let lim = IMMO_CONFIG.MAX_EXPORT_ROWS;
  if (!p.isSuper && billingEnforced_()) memberOrgIds_(p).forEach(function (o) { const e = entitlement_(o); if (e.plan && (e.features || []).indexOf("exports_unlimited") < 0) lim = Math.min(lim, num_((parseJson_(e.plan.quotasJson, {}) || {}).exportRows) || lim); });
  return lim;
}
function reportRun_(p, a) {
  const R = reportBuild_(p, a || {});
  R.totalRows = R.rows.length;
  R.rows = R.rows.slice(0, 500);
  R.truncated = R.totalRows > 500;
  return R;
}
function reportExport_(p, a) {
  a = a || {};
  const R = reportBuild_(p, a), fmt = a.format === "pdf" ? "pdf" : "csv";
  const lim = exportLimit_(p);
  assert_(R.rows.length <= lim, "Export limité à " + lim + " lignes par votre forfait : réduisez la période ou ajoutez des filtres.", "QUOTA");
  const hasAudit = uiCaps_(p).indexOf("report.export") >= 0 || p.isSuper || R.type === "CLEANING" || R.type === "CHECKINOUT";
  assert_(hasAudit, "Export non autorisé pour votre rôle.", "FORBIDDEN");
  audit_("REPORT_EXPORTED", "Report", R.type, "", { format: fmt, rows: R.rows.length, period: R.period.from + "/" + R.period.to });
  const base = "rapport_" + R.type.toLowerCase() + "_" + R.period.from + "_" + R.period.to;
  if (fmt === "csv") return { fileName: base + ".csv", mimeType: "text/csv", content: toCsv_(R.headers, R.rows) };
  assert_(R.rows.length <= 1500, "PDF limité à 1500 lignes : utilisez l'export CSV.");
  let html = "<p>Période : " + R.period.from + " → " + R.period.to + "</p>";
  if (R.summary) html += "<h2>Synthèse</h2>" + htmlTable_(["Indicateur", "Valeur"], Object.keys(R.summary).filter(function (k) { return typeof R.summary[k] !== "object"; }).map(function (k) { return [k, R.summary[k] == null ? "—" : R.summary[k]]; }));
  html += "<h2>Détail</h2>" + (R.rows.length ? htmlTable_(R.headers, R.rows) : "<p>Aucune donnée.</p>");
  return storeGeneratedPdf_(p, htmlToPdf_(pdfShell_(R.title, html), base), { propertyId: "", organizationId: "" }, "REPORT", p.userId, "REPORT");
}
