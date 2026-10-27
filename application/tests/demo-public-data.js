/* Données de démonstration (prévisualisation locale uniquement). Exécuté dans le simulateur après testFixtures_.
   Les séjours passés sont passés directement au statut COMPLETED (les fenêtres horaires du check-in empêchent de les rejouer). */
var __demo = (function () {
  var T = __T, fx = __fx, today = todayStr_();
  var o = { props: [fx.propA] };
  T.call(fx.tok.ownerA, "property.update", { propertyId: fx.propA, latitude: 31.6258, longitude: -7.9891, neighborhood: "Médina", address: "Derb Sidi Bouloukat", description: "Riad de trois chambres autour d'un patio planté d'orangers.", houseRules: "Pas de fête. Silence après 22 h.", arrivalInstructions: "Le gardien vous attend à Bab Laksour.", accessInstructions: "Boîte à clés : code 4821." });
  [["Villa Palmeraie", "VILLA", 3500, 31.6702, -7.9524, "Palmeraie", 4], ["Appartement Guéliz", "APARTMENT", 650, 31.6347, -8.0103, "Guéliz", 2], ["Studio Hivernage", "STUDIO", 480, 31.6213, -8.0129, "Hivernage", 1]].forEach(function (p) {
    o.props.push(T.call(fx.tok.ownerA, "property.create", { organizationId: fx.orgA.organizationId, name: p[0], propertyType: p[1], nightlyPrice: p[2], cleaningFee: 150, managementCommissionRate: 18, city: "Marrakech", neighborhood: p[5], bedrooms: p[6], capacity: p[6] * 2, latitude: p[3], longitude: p[4], rentalMode: "SHORT_TERM", rooms: ["Séjour", "Chambre", "Cuisine", "Salle de bain"] }).propertyId);
  });
  T.call(fx.tok.ownerA, "property.update", { propertyId: fx.propA2, latitude: 31.6402, longitude: -8.0151, neighborhood: "Guéliz" });
  T.call(fx.tok.ownerA, "property.agencySet", { propertyId: fx.propA, agencyOrganizationId: fx.ag1.organizationId, canView: true, canManageReservations: true, canManageOperations: true, canViewFinance: true, commissionRate: 20 });
  T.call(fx.tok.ownerA, "property.agencySet", { propertyId: o.props[1], agencyOrganizationId: fx.ag1.organizationId, canView: true, canManageReservations: true, canManageOperations: true });
  T.call(fx.tok.ownerA, "property.staffAssign", { propertyId: fx.propA, email: fx.users.cleaner.email, role: "CLEANER" });
  T.call(fx.tok.ownerA, "property.staffAssign", { propertyId: fx.propA, email: fx.users.guard.email, role: "GUARD" });
  var rr = T.call(fx.tok.ownerA, "resv.create", { propertyId: fx.propA, checkIn: today, checkOut: addDaysStr_(today, 3), guestName: "Nadia Berrada", guestCount: 3, guestPhone: "0699887766" });
  var names = ["Ali Benali", "Sarah Martin", "John Smith", "Fatima Zahra", "Lucas Bernard", "Amina El Idrissi", "Marco Rossi", "Yuki Tanaka", "Omar Haddad", "Emma Dubois", "Karim Tazi", "Laura Garcia"];
  var srcs = ["AIRBNB", "BOOKING", "DIRECT", "AIRBNB", "PHONE", "BOOKING"], reasons = ["GUEST_REQUEST", "GUEST_REQUEST", "NO_PAYMENT", "OWNER_REQUEST", "GUEST_REQUEST", "FORCE_MAJEURE"];
  var seed = 7; function rnd(n) { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); }
  o.props.forEach(function (pid, pi) {
    var d = addDaysStr_(today, -200 + pi * 3);
    while (d < addDaysStr_(today, 45)) {
      var n = 2 + rnd(5), ci = d, co = addDaysStr_(d, n);
      try {
        var r = T.call(fx.tok.ownerA, "resv.create", { propertyId: pid, checkIn: ci, checkOut: co, guestName: names[rnd(names.length)], guestCount: 1 + rnd(4), source: srcs[rnd(srcs.length)], guestPhone: "06000" + (10000 + rnd(89999)) });
        var g = dbGet_("Reservations", r.reservationId), due = num_(g.totalPrice) + num_(g.fees);
        if (rnd(10) === 0 && ci > today) T.call(fx.tok.ownerA, "resv.cancel", { reservationId: r.reservationId, reason: reasons[rnd(reasons.length)] });
        else if (co <= today) {
          var paid = rnd(8) === 0 ? round2_(due * 0.5) : due;
          T.call(fx.tok.ownerA, "pay.record", { refType: "RESERVATION", refId: r.reservationId, kind: "RESERVATION", amount: paid, paidAt: ci <= today ? ci : today, method: "TRANSFER", reference: "VIR-" + rnd(99999) });
          dbUpdate_("Reservations", r.reservationId, { status: "COMPLETED" });
          if (rnd(3) === 0) dbInsert_("CheckOuts", { organizationId: fx.orgA.organizationId, propertyId: pid, reservationId: r.reservationId, plannedAt: g.checkOutAt, actualAt: new Date(parseTs_(g.checkOutAt).getTime() + rnd(90) * 60000).toISOString(), agentEmail: fx.users.guard.email, status: "DONE", lateMinutes: rnd(90), createdAt: nowIso_(), checklistJson: {}, photoDocIdsJson: [] });
        } else if (ci <= today) T.call(fx.tok.ownerA, "pay.record", { refType: "RESERVATION", refId: r.reservationId, kind: "RESERVATION", amount: round2_(due * 0.3), method: "CARD" });
      } catch (e) { /* créneau occupé : on passe */ }
      d = addDaysStr_(co, rnd(6));
    }
  });
  var cats = ["PLUMBING", "PLUMBING", "PLUMBING", "PLUMBING", "AC", "AC", "AC", "ELECTRICITY", "ELECTRICITY", "HUMIDITY", "APPLIANCE", "LOCKSMITH", "FURNITURE", "PLUMBING", "AC", "DAMAGE"];
  var art = T.call(fx.tok.superA, "ctr.create", { name: "Atlas Plomberie", email: fx.users.artisan.email, phone: "0661234567", specialties: ["PLUMBING", "AC"], zones: ["Médina", "Guéliz"] });
  var art2 = T.call(fx.tok.superA, "ctr.create", { name: "Froid Menara", email: "froid.menara@example.test", phone: "0662345678", specialties: ["AC", "ELECTRICITY"] });
  T.call(fx.tok.superA, "ctr.create", { name: "Propreté Atlas", email: fx.users.cleaner.email, phone: "0663456789", specialties: ["CLEANING"], zones: ["Médina", "Guéliz"] });
  T.call(fx.tok.superA, "ctr.create", { name: "Clean Riads Marrakech", email: fx.users.cleaner2.email, phone: "0664567890", specialties: ["CLEANING"], zones: ["Hivernage"] });
  cats.forEach(function (c, i) {
    var inc = T.call(fx.tok.ownerA, "inc.create", { propertyId: o.props[i % o.props.length], category: c, severity: ["LOW", "MEDIUM", "HIGH"][i % 3], description: "Signalement " + st_(c) + " n°" + (i + 1), estimatedCost: 300 + rnd(2500) });
    dbUpdate_("IncidentsV4", inc.incidentId, { createdAt: new Date(Date.now() - (10 + i * 9) * 86400000).toISOString() });
    if (i % 3 === 0) {
      var a = i % 2 ? art2.artisanId : art.artisanId;
      var q = T.call(fx.tok.ownerA, "quote.create", { incidentId: inc.incidentId, artisanId: a, lines: [{ description: "Intervention " + c, quantity: 1, unitPrice: 400 + rnd(2000) }], vatRate: 20 });
      T.call(fx.tok.ownerA, "quote.decide", { quoteId: q.quoteId, decision: "APPROVED" });
      var wo = T.call(fx.tok.ownerA, "wo.create", { incidentId: inc.incidentId, artisanId: a, quoteId: q.quoteId });
      T.call(fx.tok.ownerA, "wo.schedule", { workOrderId: wo.workOrderId, scheduledAt: new Date(Date.now() + 3600000).toISOString() }); T.call(fx.tok.ownerA, "wo.start", { workOrderId: wo.workOrderId }); T.call(fx.tok.ownerA, "wo.complete", { workOrderId: wo.workOrderId, report: "Réparation effectuée" });
      T.call(fx.tok.ownerA, "wo.verify", { workOrderId: wo.workOrderId });
      var iv = T.call(fx.tok.ownerA, "inv.submit", { workOrderId: wo.workOrderId, invoiceNumber: "F-" + (100 + i), amountHT: 400 + rnd(2000), vatRate: 20 });
      T.call(fx.tok.ownerA, "inv.approve", { invoiceId: iv.invoiceId });
    }
  });
  ["UTILITIES", "UTILITIES", "TAXES", "INSURANCE", "SUPPLIES", "UTILITIES"].forEach(function (c, i) {
    T.call(fx.tok.ownerA, "exp.create", { propertyId: o.props[i % o.props.length], category: c, description: st_(c), amount: 300 + rnd(1500), expenseDate: addDaysStr_(today, -rnd(170)) });
  });
  var m = T.call(fx.tok.ownerA, "clean.create", { propertyId: fx.propA, startAt: new Date(Date.now() + 3 * 3600000).toISOString(), providerEmail: fx.users.cleaner.email, price: 200 });
  var m2 = T.call(fx.tok.ownerA, "clean.create", { propertyId: o.props[1], startAt: new Date(Date.now() + 26 * 3600000).toISOString(), price: 250 });
  var t = T.call(fx.tok.ownerA, "tenant.create", { propertyId: fx.propA2, fullName: "Samira Locataire", email: fx.users.tenant.email, phone: "0655443322" });
  var l = T.call(fx.tok.ownerA, "lease.create", { propertyId: fx.propA2, tenantId: t.tenantId, startDate: addMonthsStr_(today.slice(0, 8) + "01", -5), monthlyRent: 6500, charges: 400, deposit: 13000, dueDay: 5, indexationRate: 2 });
  T.call(fx.tok.ownerA, "lease.activate", { leaseId: l.leaseId });
  T.call(fx.tok.ownerA, "lease.get", { leaseId: l.leaseId }).schedules.forEach(function (s, i) { if (s.dueDate < today && i < 3) T.call(fx.tok.ownerA, "pay.record", { refType: "RENT_SCHEDULE", refId: s.scheduleId, kind: "RENT", amount: i === 2 ? 3000 : s.amountDue, paidAt: s.dueDate }); });
  T.call(fx.tok.superA, "sub.assign", { organizationId: fx.orgA.organizationId, planCode: "BUSINESS", trial: true });
  T.call(fx.tok.superA, "sub.assign", { organizationId: fx.orgB.organizationId, planCode: "ESSENTIEL" });
  var gt = api(fx.tok.ownerA, "guest.tokenCreate", { reservationId: rr.reservationId });
  return { mission: m.missionId, mission2: m2.missionId, resvToday: rr.reservationId, lease: l.leaseId, guestToken: gt.ok ? gt.data.url.split("token=")[1] : "" };
  function st_(c) { return ({ PLUMBING: "fuite d'eau", AC: "climatisation en panne", ELECTRICITY: "panne électrique", HUMIDITY: "humidité", APPLIANCE: "électroménager", LOCKSMITH: "serrure bloquée", FURNITURE: "mobilier à remplacer", DAMAGE: "dégât", UTILITIES: "Eau et électricité", TAXES: "Taxes", INSURANCE: "Assurance", SUPPLIES: "Fournitures" })[c] || String(c).toLowerCase(); }
})();

/* Noms et adresses de démonstration présentables : remplacement cohérent dans toute la base simulée (domaine réservé .test, jamais de vraie adresse). */
(function () {
  var sfx = (dbAll_("Users")[0].email.match(/\.([0-9a-f]{6})@/) || [])[1];
  if (!sfx) return;
  var people = {
    super: ["admin", "Administrateur ImmoPilot"], ownera: ["jean.bernard", "Jean Bernard"], ownerb: ["claire.dubois", "Claire Dubois"], ag1: ["karim.alaoui", "Karim Alaoui"],
    ag1u: ["sara.bennani", "Sara Bennani"], ag2: ["youssef.chraibi", "Youssef Chraibi"], cleaner: ["fatima.zahra", "Fatima Zahra"], cleaner2: ["latifa.mansouri", "Latifa Mansouri"],
    guard: ["hassan.elidrissi", "Hassan El Idrissi"], artisan: ["mohamed.zetounie", "Mohamed Zetounie"], tenant: ["samira.haddad", "Samira Haddad"]
  };
  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
  var reps = [];
  Object.keys(people).forEach(function (k) { reps.push([new RegExp(esc(k + "." + sfx + "@example.test"), "g"), people[k][0] + "@example.test"]); });
  Object.keys(people).forEach(function (k) { reps.push([new RegExp("\\b" + esc(k + "." + sfx) + "\\b", "g"), people[k][1]]); });
  [["Propriétaire A " + sfx, "Jean Bernard Immobilier"], ["Propriétaire B " + sfx, "Claire Dubois Patrimoine"], ["Agence 1 " + sfx, "Agence Atlas Immo"],
   ["Agence 2 " + sfx, "Agence Médina Conciergerie"], ["Prestataires " + sfx, "Atlas Plomberie et Services"], ["Riad Test A", "Riad Dar Zitoun"],
   ["Appartement Gueliz", "Résidence Jardins de l'Agdal"], ["Villa B", "Villa Al Andalous"]]
    .forEach(function (x) { reps.push([new RegExp(esc(x[0]), "g"), x[1]]); });
  DB_SS_.getSheets().forEach(function (sh) {
    sh.rows.forEach(function (row) {
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (typeof v !== "string" || !v) continue;
        for (var i = 0; i < reps.length; i++) v = v.replace(reps[i][0], reps[i][1]);
        row[c] = v;
      }
    });
  });
  DB_MEMO_ = {};
  if (typeof __mock !== "undefined") __mock.cache = {};
  if (typeof ctxReset_ === "function") ctxReset_();
})();
