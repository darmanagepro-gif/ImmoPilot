/**
 * Tableaux de bord par rôle. Tous les indicateurs sont calculés à partir des données réelles (aucune valeur codée en dur)
 * et uniquement sur le périmètre autorisé de l'utilisateur. Le super administrateur ne voit que des AGRÉGATS de plateforme.
 */
function dashGet_(p, a) {
  a = a || {};
  const per = periodFromFilters_(a);
  const out = { period: per, sections: [] };
  if (p.isSuper) { out.admin = dashAdmin_(per, a.includeDemo === true); out.sections.push("admin"); }
  const portfolioProps = finScopeProps_(p, a);
  if (portfolioProps.length && hasAnyRole_(p, ["OWNER", "AGENCY_ADMIN", "AGENCY_USER"])) { out.portfolio = dashPortfolio_(p, a, per, portfolioProps); out.sections.push("portfolio"); }
  else if (hasAnyRole_(p, ["AGENCY_ADMIN", "AGENCY_USER", "OWNER"])) { out.operations = dashOperationsOnly_(p, a, per); out.sections.push("operations"); }
  if (hasRole_(p, "CLEANER") || accessibleProps_(p, "cleaning.manage").length) { out.cleaning = dashCleaning_(p, a, per); out.sections.push("cleaning"); }
  if (myArtisanIds_(p).length) { out.artisan = dashArtisan_(p, per); out.sections.push("artisan"); }
  if (accessibleProps_(p, "lease.view").some(function (x) { return x.rentalMode !== "SHORT_TERM"; })) { out.lease = dashLease_(p, a, per); out.sections.push("lease"); }
  if (hasRole_(p, "GUARD") || accessibleProps_(p, "checkin.operate").length) { const t = opsToday_(p, {}); out.today = { arrivals: t.arrivals.length, departures: t.departures.length, overdue: t.overdue.length, arrivalsDone: t.arrivals.filter(function (x) { return x.done; }).length, departuresDone: t.departures.filter(function (x) { return x.done; }).length }; out.sections.push("today"); }
  if (myTenantIds_(p).length) { out.tenant = leaseMine_(p).map(function (l) { return { leaseId: l.leaseId, propertyName: l.propertyName, status: l.status, nextDue: l.nextDue, arrears: l.arrears }; }); out.sections.push("tenant"); }
  return out;
}

function dashAdmin_(per, includeDemo) {
  // Les organisations de démonstration sont exclues par défaut (case « Inclure la démo » dans l'interface).
  const demo = includeDemo ? {} : demoOrgIdSet_(), keep = function (r) { return !demo[String(r.organizationId)]; };
  const all = function (t) { return dbAll_(t).filter(keep); };
  const demoOnly = {};
  if (!includeDemo) { const byUser = {}; dbAll_("UserRoles").filter(function (r) { return r.status === "ACTIVE"; }).forEach(function (r) { (byUser[r.userId] = byUser[r.userId] || []).push(r); });
    Object.keys(byUser).forEach(function (u) { if (byUser[u].every(function (r) { return demo[String(r.organizationId)]; })) demoOnly[u] = true; }); }
  const inP = function (d) { const s = String(d || "").slice(0, 10); return s >= per.from && s <= per.to; };
  const orgs = all("Organizations").filter(function (o) { return o.type !== "PLATFORM"; });
  const users = dbAll_("Users").filter(function (u) { return !demoOnly[u.userId]; }), props = all("Properties"), resv = all("Reservations"), subs = all("Subscriptions");
  const activeOrgIds = orgs.filter(function (o) { return o.status === "ACTIVE"; }).map(function (o) { return String(o.organizationId); });
  const uses = function (table, field) { const s = {}; all(table).forEach(function (r) { s[String(r[field || "organizationId"])] = true; }); return pct_(activeOrgIds.filter(function (o) { return s[o]; }).length, activeOrgIds.length); };
  const unpaidSubs = subs.filter(function (s) { return ["PAST_DUE", "SUSPENDED"].indexOf(s.status) >= 0; });
  const logs = all("ActivityLogs").filter(function (l) { return inP(l.timestamp); });
  const months = {};
  orgs.forEach(function (o) { const m = String(o.createdAt).slice(0, 7); months[m] = (months[m] || 0) + 1; });
  const daily = {};
  logs.forEach(function (l) { const d = String(l.timestamp).slice(0, 10); daily[d] = (daily[d] || 0) + 1; });
  return {
    organizations: orgs.length, organizationsActive: activeOrgIds.length, organizationsSuspended: orgs.filter(function (o) { return o.status === "SUSPENDED"; }).length,
    usersActive: users.filter(function (u) { return u.status === "ACTIVE"; }).length, usersNew: users.filter(function (u) { return inP(u.createdAt); }).length,
    usersNeverActivated: users.filter(function (u) { return u.status === "ACTIVE" && !u.passwordHash; }).length,
    properties: props.filter(function (x) { return x.status !== "DELETED"; }).length, propertiesActive: props.filter(function (x) { return x.status === "ACTIVE"; }).length,
    reservations: resv.filter(function (r) { return inP(r.checkIn) && r.status !== "DRAFT"; }).length,
    declaredRevenue: sumBy_(resv.filter(function (r) { return inP(r.checkIn) && REVENUE_STATUSES_.indexOf(r.status) >= 0; }), function (r) { return num_(r.totalPrice) + num_(r.fees); }) +
      sumBy_(all("RentSchedules").filter(function (s) { return s.status === "OPEN" && inP(s.dueDate); }), function (s) { return s.amountDue; }),
    declaredRevenueNote: "Données déclaratives saisies par les clients (non auditées).",
    platformRevenue: sumBy_(all("Payments").filter(function (x) { return x.kind === "SUBSCRIPTION" && x.status === "RECORDED" && inP(x.paidAt); }), function (x) { return x.amount; }),
    subscriptionsActive: subs.filter(function (s) { return s.status === "ACTIVE"; }).length, subscriptionsTrial: subs.filter(function (s) { return s.status === "TRIAL"; }).length,
    subscriptionsExpired: subs.filter(function (s) { return s.status === "EXPIRED"; }).length, subscriptionsPastDue: subs.filter(function (s) { return s.status === "PAST_DUE"; }).length,
    subscriptionsSuspended: subs.filter(function (s) { return s.status === "SUSPENDED"; }).length,
    subscriptionUnpaidAmount: sumBy_(unpaidSubs, function (s) { return s.price; }),
    upcomingRenewals: subs.filter(function (s) { return ["ACTIVE", "TRIAL"].indexOf(s.status) >= 0 && (s.periodEnd || s.trialEnd) && (s.periodEnd || s.trialEnd) <= addDaysStr_(todayStr_(), 15); }).length,
    storageMb: round2_(sumBy_(all("Documents").filter(function (d) { return d.status === "ACTIVE"; }), function (d) { return d.sizeBytes; }) / 1048576),
    activityVolume: logs.length, errors: logs.filter(function (l) { return l.action === "ERROR"; }).length,
    loginsFailed: logs.filter(function (l) { return l.action === "LOGIN_FAILED"; }).length,
    featureUsage: { reservations: uses("Reservations"), leases: uses("Leases"), cleaning: uses("CleaningMissions"), incidents: uses("IncidentsV4"), contractors: uses("Artisans"), invoices: uses("Invoices"), guestPortal: uses("GuestAccessTokens") },
    newOrganizationsByMonth: Object.keys(months).sort().slice(-12).map(function (m) { return { month: m, count: months[m] }; }),
    demoExcluded: Object.keys(demo).length, activityByDay: Object.keys(daily).sort().map(function (d) { return { date: d, count: daily[d] }; })
  };
}

function dashPortfolio_(p, a, per, props) {
  const ids = indexBy_(props, "propertyId");
  const fin = finComputeForProps_(props, per, a);
  const prev = finComputeForProps_(props, previousPeriod_(per), a);
  const yearFrom = addDaysStr_(addMonthsStr_(per.to, -12), 1);
  const year = finComputeForProps_(props, { from: yearFrom, to: per.to, toExcl: addDaysStr_(per.to, 1), days: diffDays_(yearFrom, per.to) + 1 }, a);
  const today = todayStr_(), in30 = addDaysStr_(today, 30);
  const resv = dbAll_("Reservations").filter(function (r) { return ids[String(r.propertyId)] && (!a.agencyOrganizationId || String(r.agencyOrganizationId) === String(a.agencyOrganizationId)); });
  const inc = dbAll_("IncidentsV4").filter(function (i) { return ids[String(i.propertyId)]; });
  const resolved = inc.filter(function (i) { return i.resolvedAt && String(i.resolvedAt).slice(0, 10) >= per.from && String(i.resolvedAt).slice(0, 10) <= per.to; });
  const agencyOrgs = p.roles.filter(function (r) { return r.role === "AGENCY_ADMIN" || r.role === "AGENCY_USER"; }).map(function (r) { return r.organizationId; });
  const t = opsToday_(p, {});
  return {
    isAgency: agencyOrgs.length > 0 && !hasRole_(p, "OWNER"),
    propertyCount: props.length, propertiesActive: props.filter(function (x) { return x.status === "ACTIVE"; }).length,
    reservationsInPeriod: resv.filter(function (r) { return r.checkIn >= per.from && r.checkIn <= per.to && REVENUE_STATUSES_.concat(["PENDING"]).indexOf(r.status) >= 0; }).length,
    upcomingReservations: resv.filter(function (r) { return r.checkIn >= today && r.checkIn <= in30 && ["PENDING", "CONFIRMED"].indexOf(r.status) >= 0; }).length,
    arrivalsToday: t.arrivals.length, departuresToday: t.departures.length,
    totals: fin.totals, previousTotals: prev.totals,
    deltas: { expected: round2_(fin.totals.expected - prev.totals.expected), collected: round2_(fin.totals.collected - prev.totals.collected), expenses: round2_(fin.totals.expenses - prev.totals.expenses),
      occupancyRate: round2_(fin.totals.occupancyRate - prev.totals.occupancyRate), result: round2_(fin.totals.result - prev.totals.result) },
    openIncidents: inc.filter(function (i) { return ["CLOSED", "CANCELLED", "RESOLVED"].indexOf(i.status) < 0; }).length,
    severeIncidents: inc.filter(function (i) { return ["CLOSED", "CANCELLED", "RESOLVED"].indexOf(i.status) < 0 && ["HIGH", "CRITICAL"].indexOf(i.severity) >= 0; }).length,
    avgResolutionDays: resolved.length ? round2_(resolved.reduce(function (s, i) { return s + (parseTs_(i.resolvedAt).getTime() - parseTs_(i.createdAt).getTime()) / 86400000; }, 0) / resolved.length) : null,
    maintenanceCost: round2_(num_(fin.expensesByCategory.MAINTENANCE)),
    cleaningPending: dbAll_("CleaningMissions").filter(function (m) { return ids[String(m.propertyId)] && ["CREATED", "OFFERED", "EXPIRED"].indexOf(m.status) >= 0; }).length,
    cleaningToValidate: dbAll_("CleaningMissions").filter(function (m) { return ids[String(m.propertyId)] && m.status === "COMPLETED"; }).length,
    invoicesPending: dbAll_("Invoices").filter(function (v) { return ids[String(v.propertyId)] && v.status === "SUBMITTED"; }).length,
    quotesToValidate: dbAll_("Quotes").filter(function (q) { return ids[String(q.propertyId)] && q.status === "PENDING"; }).length,
    latePayments: resv.filter(function (r) { return REVENUE_STATUSES_.indexOf(r.status) >= 0 && r.checkIn < today && resvMoney_(r).balance > 0; }).length +
      dbAll_("RentSchedules").filter(function (s) { return ids[String(s.propertyId)] && s.status === "OPEN" && rentStatus_(s).status === "LATE"; }).length,
    commissions: { management: fin.totals.managementCommissions, contractor: agencyOrgs.reduce(function (s, o) { return round2_(s + num_(fin.contractorCommissionsByBeneficiary[o])); }, 0),
      byAgency: fin.byAgency },
    ranking: fin.byProperty.slice().sort(function (x, y) { return y.result - x.result; }).map(function (r, i) { return Object.assign({ rank: i + 1 }, r); }),
    byMonth: year.byMonth, byAgency: fin.byAgency, expensesByCategory: fin.expensesByCategory
  };
}
function dashOperationsOnly_(p, a, per) {
  const props = accessibleProps_(p, "reservation.view"), ids = indexBy_(props, "propertyId"), t = opsToday_(p, {});
  return { propertyCount: props.length, reservationsInPeriod: dbAll_("Reservations").filter(function (r) { return ids[String(r.propertyId)] && r.checkIn >= per.from && r.checkIn <= per.to && r.status !== "CANCELLED"; }).length,
    arrivalsToday: t.arrivals.length, departuresToday: t.departures.length,
    openIncidents: dbAll_("IncidentsV4").filter(function (i) { return ids[String(i.propertyId)] && ["CLOSED", "CANCELLED", "RESOLVED"].indexOf(i.status) < 0; }).length };
}

/** Indicateurs ménage : vue prestataire (ses missions) et vue responsable (missions des biens gérés, qualité par équipe). */
function dashCleaning_(p, a, per) {
  const managed = accessiblePropIds_(p, "cleaning.manage");
  const inP = function (d) { const s = String(d || "").slice(0, 10); return s >= per.from && s <= per.to; };
  const all = dbAll_("CleaningMissions").filter(function (m) { return (managed[String(m.propertyId)] || cleanMine_(p, m)) && (!a.propertyId || String(m.propertyId) === String(a.propertyId)); });
  const inPeriod = all.filter(function (m) { return inP(m.startAt); });
  const now = Date.now();
  const done = inPeriod.filter(function (m) { return ["COMPLETED", "VALIDATED"].indexOf(m.status) >= 0; });
  const missionIds = {}; all.forEach(function (m) { missionIds[String(m.missionId)] = m; });
  const logs = dbAll_("ActivityLogs").filter(function (l) { return inP(l.timestamp) && missionIds[String(l.entityId)] && ["CLEANING_ACCEPTED", "CLEANING_DECLINED", "CLEANING_EXPIRED"].indexOf(l.action) >= 0; });
  const acc = logs.filter(function (l) { return l.action === "CLEANING_ACCEPTED"; }).length;
  const onTime = done.filter(function (m) { return parseTs_(m.completedAt) && parseTs_(m.endAt) && parseTs_(m.completedAt).getTime() <= parseTs_(m.endAt).getTime(); }).length;
  const teams = {};
  done.forEach(function (m) { const k = m.providerEmail || "—"; const t = teams[k] = teams[k] || { provider: k, missions: 0, minutes: 0, anomalies: 0, scoreSum: 0, scored: 0, late: 0 };
    t.missions++; t.minutes += num_(m.actualMinutes); t.anomalies += parseJson_(m.anomaliesJson, []).length; if (num_(m.qualityScore) > 0) { t.scoreSum += num_(m.qualityScore); t.scored++; }
    if (parseTs_(m.completedAt) && parseTs_(m.endAt) && parseTs_(m.completedAt).getTime() > parseTs_(m.endAt).getTime()) t.late++; });
  const byProp = {}; const props = indexBy_(dbAll_("Properties"), "propertyId");
  inPeriod.forEach(function (m) { const n = parseJson_(m.anomaliesJson, []).length; if (n) byProp[m.propertyId] = { propertyName: (props[String(m.propertyId)] || {}).name, anomalies: (byProp[m.propertyId] ? byProp[m.propertyId].anomalies : 0) + n }; });
  return {
    toAccept: all.filter(function (m) { return m.status === "OFFERED"; }).length, unassigned: all.filter(function (m) { return m.status === "CREATED"; }).length,
    expired: all.filter(function (m) { return m.status === "EXPIRED"; }).length, accepted: all.filter(function (m) { return m.status === "ACCEPTED"; }).length,
    inProgress: all.filter(function (m) { return m.status === "IN_PROGRESS"; }).length, toValidate: all.filter(function (m) { return m.status === "COMPLETED"; }).length,
    late: all.filter(function (m) { return ["ACCEPTED", "OFFERED", "CREATED"].indexOf(m.status) >= 0 && parseTs_(m.startAt) && parseTs_(m.startAt).getTime() + 30 * 60000 < now; }).length,
    completedInPeriod: done.length, avgMinutes: done.length ? Math.round(done.reduce(function (s, m) { return s + num_(m.actualMinutes); }, 0) / done.length) : null,
    acceptanceRate: pct_(acc, logs.length), onTimeRate: pct_(onTime, done.length),
    anomalies: inPeriod.reduce(function (s, m) { return s + parseJson_(m.anomaliesJson, []).length; }, 0),
    qualityAvg: (function () { const sc = done.filter(function (m) { return num_(m.qualityScore) > 0; }); return sc.length ? round2_(sc.reduce(function (s, m) { return s + num_(m.qualityScore); }, 0) / sc.length) : null; })(),
    byTeam: Object.keys(teams).map(function (k) { const t = teams[k]; return { provider: t.provider, missions: t.missions, avgMinutes: Math.round(t.minutes / t.missions), anomalies: t.anomalies, lateRate: pct_(t.late, t.missions), qualityAvg: t.scored ? round2_(t.scoreSum / t.scored) : null }; }),
    anomaliesByProperty: Object.keys(byProp).map(function (k) { return byProp[k]; }).sort(function (x, y) { return y.anomalies - x.anomalies; })
  };
}

function dashArtisan_(p, per) {
  const ids = myArtisanIds_(p);
  const mine = function (x) { return ids.indexOf(String(x.artisanId)) >= 0; };
  const wos = dbAll_("WorkOrders").filter(mine), inv = dbAll_("Invoices").filter(mine), quotes = dbAll_("Quotes").filter(mine);
  const done = wos.filter(function (w) { return ["COMPLETED", "VERIFIED"].indexOf(w.status) >= 0 && w.completedAt; });
  const months = {};
  done.forEach(function (w) { const m = String(w.completedAt).slice(0, 7); months[m] = (months[m] || 0) + 1; });
  return {
    quotesToSend: quotes.filter(function (q) { return q.status === "REQUESTED"; }).length, quotesPending: quotes.filter(function (q) { return q.status === "PENDING"; }).length,
    quotesApproved: quotes.filter(function (q) { return q.status === "APPROVED"; }).length,
    upcoming: wos.filter(function (w) { return ["ASSIGNED", "ACCEPTED", "SCHEDULED"].indexOf(w.status) >= 0; }).length,
    inProgress: wos.filter(function (w) { return w.status === "IN_PROGRESS"; }).length, completed: done.length,
    invoicesSubmitted: inv.filter(function (v) { return v.status === "SUBMITTED"; }).length, invoicesApproved: inv.filter(function (v) { return ["APPROVED", "PARTIAL"].indexOf(v.status) >= 0; }).length,
    amountDue: sumBy_(inv.filter(function (v) { return ["APPROVED", "PARTIAL"].indexOf(v.status) >= 0; }), function (v) { return num_(v.netToContractor) - num_(v.paidAmount); }),
    amountPaid: sumBy_(inv, function (v) { return v.paidAmount; }),
    avgDelayDays: (function () { const d = done.map(function (w) { return (parseTs_(w.completedAt).getTime() - parseTs_(w.createdAt).getTime()) / 86400000; }); return d.length ? round2_(d.reduce(function (s, x) { return s + x; }, 0) / d.length) : null; })(),
    completedByMonth: Object.keys(months).sort().slice(-12).map(function (m) { return { month: m, count: months[m] }; })
  };
}

function dashLease_(p, a, per) {
  const props = accessibleProps_(p, "lease.view").filter(function (x) { return x.rentalMode !== "SHORT_TERM" && (!a.propertyId || String(x.propertyId) === String(a.propertyId)); });
  const ids = indexBy_(props, "propertyId"), today = todayStr_();
  const leases = dbAll_("Leases").filter(function (l) { return ids[String(l.propertyId)]; });
  const active = leases.filter(function (l) { return ["ACTIVE", "NOTICE"].indexOf(l.status) >= 0; });
  const sched = dbAll_("RentSchedules").filter(function (s) { return ids[String(s.propertyId)] && s.status === "OPEN"; }).map(function (s) { return rentStatus_(s, today); });
  const inPer = sched.filter(function (s) { return s.dueDate >= per.from && s.dueDate <= per.to; });
  const ltProps = props.filter(function (x) { return x.rentalMode === "LONG_TERM"; });
  const fin = finComputeForProps_(props, per, a);
  return {
    activeLeases: active.length, noticeLeases: leases.filter(function (l) { return l.status === "NOTICE"; }).length,
    rentExpected: sumBy_(inPer, function (s) { return s.amountDue; }), rentCollected: sumBy_(inPer, function (s) { return s.paid; }),
    unpaid: sumBy_(sched.filter(function (s) { return ["LATE", "DUE", "PARTIAL"].indexOf(s.status) >= 0; }), function (s) { return s.remaining; }),
    lateCount: sched.filter(function (s) { return s.status === "LATE"; }).length,
    endingSoon: active.filter(function (l) { return l.endDate && l.endDate <= addDaysStr_(today, 60); }).map(function (l) { return { leaseId: l.leaseId, propertyName: (ids[String(l.propertyId)] || {}).name, endDate: l.endDate }; }),
    occupancyRate: pct_(ltProps.filter(function (x) { return active.some(function (l) { return String(l.propertyId) === String(x.propertyId); }); }).length, ltProps.length),
    expenses: fin.totals.expenses, resultByProperty: fin.byProperty.map(function (r) { return { propertyId: r.propertyId, name: r.name, rentExpected: r.rentExpected, expenses: r.expenses, result: r.result }; })
  };
}
