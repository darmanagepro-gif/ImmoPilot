/**
 * Analyses de Pareto (80/20), calculées côté serveur. Le même résultat alimente le tableau, le graphique et les exports.
 * Règles de calcul (paretoCompute_, testé) :
 *  - agrégation par clé ; libellé vide ou inconnu → « NON_CLASSE » ;
 *  - valeurs négatives exclues (signalées dans warnings) ; valeurs nulles conservées en fin de classement, jamais « prioritaires » ;
 *  - tri décroissant (égalité : ordre alphabétique du libellé, pour un résultat stable) ;
 *  - part = valeur / total ; part cumulée = somme des parts jusqu'au rang ;
 *  - éléments PRIORITAIRES : du 1er jusqu'à celui qui fait franchir (ou atteindre) le seuil de 80 % inclus ;
 *  - total nul (aucune donnée, période sans activité) : résultat vide explicite, sans division par zéro.
 */
var PARETO_THRESHOLD_ = 80;
var PARETO_TYPES_ = {
  INCIDENTS_BY_CATEGORY: { title: "Incidents par catégorie", unit: "COUNT", cap: "incident.view" },
  INCIDENT_COST_BY_CATEGORY: { title: "Coût des incidents par catégorie", unit: "MAD", cap: "incident.view" },
  MAINTENANCE_BY_CATEGORY: { title: "Dépenses de maintenance par catégorie d'incident", unit: "MAD", cap: "finance.view" },
  COST_BY_CONTRACTOR: { title: "Coûts par prestataire", unit: "MAD", cap: "invoice.view" },
  COST_BY_PROPERTY: { title: "Biens les plus coûteux", unit: "MAD", cap: "finance.view" },
  CANCEL_REASONS: { title: "Motifs d'annulation", unit: "COUNT", cap: "reservation.view" },
  CLEANING_ANOMALIES: { title: "Anomalies de ménage", unit: "COUNT", cap: "cleaning.manage" },
  DELAYS_NONCONFORMITIES: { title: "Retards et non-conformités", unit: "COUNT", cap: null },
  EXPENSES_BY_CATEGORY: { title: "Dépenses par catégorie", unit: "MAD", cap: "finance.view" },
  UNPAID: { title: "Impayés", unit: "MAD", cap: "finance.view" }
};

/** Calcul pur de Pareto. items : [{key, label, value}]. */
function paretoCompute_(items, threshold) {
  threshold = threshold || PARETO_THRESHOLD_;
  const agg = {}, warnings = [];
  (items || []).forEach(function (it) {
    let key = String(it.key == null || it.key === "" ? "NON_CLASSE" : it.key);
    const v = Number(it.value);
    if (!isFinite(v)) { warnings.push("Valeur non numérique ignorée (" + key + ")."); return; }
    if (v < 0) { warnings.push("Valeur négative exclue (" + key + " : " + v + ")."); return; }
    if (!agg[key]) agg[key] = { key: key, label: String(it.label == null || it.label === "" ? key : it.label), value: 0, count: 0 };
    agg[key].value += v; agg[key].count += 1;
  });
  const list = Object.keys(agg).map(function (k) { agg[k].value = round2_(agg[k].value); return agg[k]; })
    .sort(function (a, b) { return b.value !== a.value ? b.value - a.value : String(a.label).localeCompare(String(b.label)); });
  const total = round2_(list.reduce(function (s, x) { return s + x.value; }, 0));
  if (total <= 0) return { total: 0, items: list.map(function (x, i) { return Object.assign(x, { rank: i + 1, share: 0, cumShare: 0, vital: false }); }), vitalCount: 0, vitalShare: 0, threshold: threshold, empty: true, warnings: warnings };
  let cum = 0, reached = false, vitalCount = 0, vitalShare = 0;
  list.forEach(function (x, i) {
    x.rank = i + 1;
    x.share = round2_(x.value / total * 100);
    cum += x.value;
    x.cumShare = round2_(Math.min(100, cum / total * 100));
    x.vital = !reached && x.value > 0;
    if (x.vital) { vitalCount++; vitalShare = x.cumShare; }
    if (cum / total * 100 >= threshold - 1e-9) reached = true;
  });
  return { total: total, items: list, vitalCount: vitalCount, vitalShare: vitalShare, itemCount: list.length,
    vitalItemShare: pct_(vitalCount, list.filter(function (x) { return x.value > 0; }).length), threshold: threshold, empty: false, warnings: warnings };
}

function paretoProps_(p, cap, f) {
  return dbAll_("Properties").filter(function (x) {
    if (x.status === "DELETED") return false;
    if (cap ? !(canProp_(p, x, cap) || (cap === "finance.view" && canProp_(p, x, "property.edit"))) : !propertyAccess_(p, x)) return false;
    if (f.propertyId && String(x.propertyId) !== String(f.propertyId)) return false;
    if (f.organizationId && String(x.organizationId) !== String(f.organizationId)) return false;
    if (f.agencyOrganizationId && !dbAll_("AgencyPropertyPermissions").some(function (z) { return String(z.propertyId) === String(x.propertyId) && String(z.agencyOrganizationId) === String(f.agencyOrganizationId) && z.status === "ACTIVE"; })) return false;
    return true;
  });
}

/** Collecte des données brutes d'une analyse pour une période. Retourne [{key,label,value}]. */
function paretoItems_(p, type, per, f) {
  const def = PARETO_TYPES_[type];
  const props = paretoProps_(p, def.cap, f), ids = indexBy_(props, "propertyId");
  const inP = function (d) { const s = String(d || "").slice(0, 10); return s >= per.from && s <= per.to; };
  const catOk = function (c) { return !f.category || String(c) === String(f.category); };
  const incidents = function () { return dbAll_("IncidentsV4").filter(function (i) { return ids[String(i.propertyId)] && i.status !== "CANCELLED" && inP(i.createdAt) && catOk(i.category); }); };
  switch (type) {
    case "INCIDENTS_BY_CATEGORY": return incidents().map(function (i) { return { key: i.category, label: i.category, value: 1 }; });
    case "INCIDENT_COST_BY_CATEGORY": return incidents().map(function (i) { return { key: i.category, label: i.category, value: num_(i.finalCost) || num_(i.estimatedCost) }; });
    case "MAINTENANCE_BY_CATEGORY": {
      const inv = indexBy_(dbAll_("Invoices"), "invoiceId"), inc = indexBy_(dbAll_("IncidentsV4"), "incidentId");
      return dbAll_("Expenses").filter(function (e) { return ids[String(e.propertyId)] && e.category === "MAINTENANCE" && e.status !== "CANCELLED" && inP(e.expenseDate); }).map(function (e) {
        const v = e.refType === "INVOICE" ? inv[String(e.refId)] : null, i = v ? inc[String(v.incidentId)] : null;
        const k = i ? i.category : (e.refType === "INVOICE" ? "NON_CLASSE" : "SAISIE_MANUELLE");
        return { key: k, label: k, value: num_(e.amount) };
      }).filter(function (x) { return catOk(x.key); });
    }
    case "COST_BY_CONTRACTOR": {
      const arts = indexBy_(dbAll_("Artisans"), "artisanId");
      return dbAll_("Invoices").filter(function (v) { return ids[String(v.propertyId)] && ["APPROVED", "PARTIAL", "PAID"].indexOf(v.status) >= 0 && inP(v.issueDate); })
        .map(function (v) { return { key: v.artisanId, label: (arts[String(v.artisanId)] || {}).name || "Prestataire inconnu", value: num_(v.amountTTC) }; });
    }
    case "COST_BY_PROPERTY": return dbAll_("Expenses").filter(function (e) { return ids[String(e.propertyId)] && e.status !== "CANCELLED" && inP(e.expenseDate) && catOk(e.category); })
      .map(function (e) { return { key: e.propertyId, label: ids[String(e.propertyId)].name, value: num_(e.amount) }; });
    case "EXPENSES_BY_CATEGORY": return dbAll_("Expenses").filter(function (e) { return ids[String(e.propertyId)] && e.status !== "CANCELLED" && inP(e.expenseDate) && catOk(e.category); })
      .map(function (e) { return { key: e.category, label: e.category, value: num_(e.amount) }; });
    case "CANCEL_REASONS": return dbAll_("Reservations").filter(function (r) { return ids[String(r.propertyId)] && r.status === "CANCELLED" && inP(r.checkIn) && (!f.agencyOrganizationId || String(r.agencyOrganizationId) === String(f.agencyOrganizationId)); })
      .map(function (r) { return { key: r.cancelReason || "NON_RENSEIGNE", label: r.cancelReason || "NON_RENSEIGNE", value: 1 }; });
    case "CLEANING_ANOMALIES": {
      const out = [];
      dbAll_("CleaningMissions").filter(function (m) { return ids[String(m.propertyId)]; }).forEach(function (m) {
        parseJson_(m.anomaliesJson, []).forEach(function (an) { if (inP(an.at)) out.push({ key: an.type || "OTHER", label: an.type || "OTHER", value: 1 }); });
      });
      return out;
    }
    case "DELAYS_NONCONFORMITIES": {
      const out = [], has = function (prop, cap) { return canProp_(p, prop, cap); };
      const push = function (k, n) { for (let i = 0; i < (n || 1); i++) out.push({ key: k, label: k, value: 1 }); };
      dbAll_("CheckIns").forEach(function (c) { const pr = ids[String(c.propertyId)]; if (pr && (has(pr, "reservation.view") || has(pr, "checkin.operate")) && inP(c.actualAt) && num_(c.lateMinutes) > 0) push("CHECKIN_LATE"); });
      dbAll_("CheckOuts").forEach(function (c) { const pr = ids[String(c.propertyId)]; if (pr && (has(pr, "reservation.view") || has(pr, "checkin.operate")) && inP(c.actualAt) && num_(c.lateMinutes) > 0) push("CHECKOUT_LATE"); });
      dbAll_("Reservations").forEach(function (r) { const pr = ids[String(r.propertyId)]; if (pr && has(pr, "reservation.view") && r.status === "NO_SHOW" && inP(r.checkIn)) push("NO_SHOW"); });
      const missions = indexBy_(dbAll_("CleaningMissions"), "missionId");
      dbAll_("CleaningMissions").forEach(function (m) { const pr = ids[String(m.propertyId)]; if (pr && has(pr, "cleaning.manage") && m.completedAt && inP(m.completedAt) && parseTs_(m.endAt) && parseTs_(m.completedAt).getTime() > parseTs_(m.endAt).getTime()) push("CLEANING_LATE"); });
      dbAll_("ActivityLogs").forEach(function (l) {
        if ((l.action === "CLEANING_EXPIRED" || l.action === "CLEANING_REJECTED") && inP(l.timestamp)) { const m = missions[String(l.entityId)]; const pr = m && ids[String(m.propertyId)]; if (pr && has(pr, "cleaning.manage")) push(l.action === "CLEANING_EXPIRED" ? "CLEANING_NOT_ACCEPTED" : "CLEANING_REJECTED"); }
      });
      dbAll_("WorkOrders").forEach(function (w) { const pr = ids[String(w.propertyId)]; if (pr && has(pr, "workorder.manage") && w.desiredDate && w.completedAt && inP(w.completedAt) && String(w.completedAt).slice(0, 10) > w.desiredDate) push("WORKORDER_LATE"); });
      dbAll_("RentSchedules").forEach(function (s) {
        const pr = ids[String(s.propertyId)];
        if (!pr || !has(pr, "lease.view") || s.status !== "OPEN" || !inP(s.dueDate)) return;
        const st = rentStatus_(s), limit = addDaysStr_(s.dueDate, Number(getSetting_("rent.graceDays", s.organizationId)) || 0);
        const lastPay = dbAll_("Payments").filter(function (z) { return z.refType === "RENT_SCHEDULE" && String(z.refId) === String(s.scheduleId) && z.status === "RECORDED"; }).map(function (z) { return z.paidAt; }).sort().pop();
        if (st.status === "LATE" || (st.status === "PAID" && lastPay && lastPay > limit)) push("RENT_LATE");
      });
      return out;
    }
    case "UNPAID": {
      const out = [], today = todayStr_(), byPeriod = f.groupBy === "period";
      dbAll_("RentSchedules").filter(function (s) { return ids[String(s.propertyId)] && s.status === "OPEN" && inP(s.dueDate) && s.dueDate <= today; }).forEach(function (s) {
        const st = rentStatus_(s); if (st.remaining > 0) out.push(byPeriod ? { key: s.dueDate.slice(0, 7), label: s.dueDate.slice(0, 7), value: st.remaining } : { key: s.propertyId, label: ids[String(s.propertyId)].name, value: st.remaining });
      });
      dbAll_("Reservations").filter(function (r) { return ids[String(r.propertyId)] && REVENUE_STATUSES_.indexOf(r.status) >= 0 && inP(r.checkIn) && r.checkIn <= today; }).forEach(function (r) {
        const m = resvMoney_(r); if (m.balance > 0) out.push(byPeriod ? { key: r.checkIn.slice(0, 7), label: r.checkIn.slice(0, 7), value: m.balance } : { key: r.propertyId, label: ids[String(r.propertyId)].name, value: m.balance });
      });
      return out;
    }
  }
  throw new AppError("VALIDATION", "Type d'analyse inconnu.");
}

function paretoRun_(p, a) {
  a = a || {};
  const type = oneOf_(a.type, Object.keys(PARETO_TYPES_), "Type d'analyse");
  memberOrgIds_(p).forEach(function (o) { if (hasRole_(p, "OWNER", o) || hasRole_(p, "AGENCY_ADMIN", o)) assertFeature_(o, "pareto"); });
  const per = periodFromFilters_(a), prev = previousPeriod_(per);
  const f = { propertyId: a.propertyId, agencyOrganizationId: a.agencyOrganizationId, organizationId: a.organizationId, category: a.category, groupBy: a.groupBy };
  const cur = paretoCompute_(paretoItems_(p, type, per, f), PARETO_THRESHOLD_);
  const old = paretoCompute_(paretoItems_(p, type, prev, f), PARETO_THRESHOLD_);
  const oldBy = indexBy_(old.items, "key");
  cur.items.forEach(function (x) { const o = oldBy[x.key]; x.previousValue = o ? o.value : 0; x.previousRank = o ? o.rank : null; x.delta = round2_(x.value - x.previousValue); x.deltaPct = o && o.value > 0 ? round2_((x.value - o.value) / o.value * 100) : null; });
  return { type: type, title: PARETO_TYPES_[type].title, unit: PARETO_TYPES_[type].unit, period: per, previousPeriod: prev, filters: f, result: cur,
    previous: { total: old.total, vitalCount: old.vitalCount, items: old.items.slice(0, 20).map(function (x) { return { key: x.key, label: x.label, value: x.value, rank: x.rank }; }) },
    totalDelta: round2_(cur.total - old.total), totalDeltaPct: old.total > 0 ? round2_((cur.total - old.total) / old.total * 100) : null,
    priorities: cur.items.filter(function (x) { return x.vital; }).map(function (x) { return x.label; }), computedAt: nowIso_() };
}
function paretoTable_(r) {
  return { headers: ["Rang", "Élément", r.unit === "MAD" ? "Montant (MAD)" : "Nombre", "Part %", "Part cumulée %", "Prioritaire (80 %)", "Période précédente", "Évolution"],
    rows: r.result.items.map(function (x) { return [x.rank, x.label, x.value, x.share, x.cumShare, x.vital ? "OUI" : "", x.previousValue, x.delta]; }) };
}
function paretoExport_(p, a) {
  const r = paretoRun_(p, a), t = paretoTable_(r), fmt = a.format === "pdf" ? "pdf" : "csv";
  audit_("PARETO_EXPORTED", "Report", r.type, "", { format: fmt, period: r.period.from + "/" + r.period.to });
  if (fmt === "csv") return { fileName: "pareto_" + r.type.toLowerCase() + "_" + r.period.from + "_" + r.period.to + ".csv", mimeType: "text/csv", content: toCsv_(t.headers, t.rows) };
  const html = "<p>Période : " + r.period.from + " → " + r.period.to + " — Total : <b>" + r.result.total + (r.unit === "MAD" ? " MAD" : "") + "</b> (période précédente : " + r.previous.total + ")</p>" +
    "<p>Éléments prioritaires (≈ 80 % du total, " + r.result.vitalCount + " sur " + (r.result.itemCount || 0) + ") : <b>" + escapeHtml_(r.priorities.join(", ") || "—") + "</b></p>" +
    (r.result.empty ? "<p>Aucune donnée sur la période.</p>" : htmlTable_(t.headers, t.rows)) + (r.result.warnings.length ? "<p class='muted'>" + escapeHtml_(r.result.warnings.join(" ")) + "</p>" : "");
  const pdf = htmlToPdf_(pdfShell_("Pareto — " + r.title, html), "Pareto_" + r.type);
  return storeGeneratedPdf_(p, pdf, { propertyId: "", organizationId: "" }, "REPORT", p.userId, "PARETO");
}
