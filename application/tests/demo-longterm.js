/* Données de démonstration « location longue durée » (prévisualisation locale et démo publique, simulateur uniquement) :
   envois automatiques activés, historique d'appels de loyer, de relances et de quittances, contrat rédigé par l'agent,
   état des lieux d'entrée validé et état des lieux de sortie en cours. À exécuter APRÈS demo-data.js (__demo.lease). */
(function () {
  var T = __T, fx = __fx, tok = fx.tok.ownerA, org = fx.orgA.organizationId, leaseId = __demo && __demo.lease;
  if (!leaseId) return;
  [["rent.autoCall", true], ["rent.callDaysBefore", 7], ["rent.autoReminders", true], ["rent.reminderDays", "5,15,30"], ["rent.autoReceipt", true],
   ["rent.paymentInstructions", "Virement bancaire au compte du bailleur (coordonnées de démonstration : Banque Démo, RIB 000 000 0000000000000000 00), en indiquant la référence de l'avis."]]
    .forEach(function (x) { T.call(tok, "settings.set", { organizationId: org, key: x[0], value: x[1] }); });
  var l = dbGet_("Leases", leaseId);
  T.call(tok, "property.update", { propertyId: l.propertyId, address: "Résidence Les Jardins, Bd Mohammed VI", surfaceM2: 92, propertyType: "APARTMENT",
    rooms: ["Entrée", "Séjour", "Cuisine", "Chambre 1", "Chambre 2", "Salle de bain", "Balcon"], equipment: ["Réfrigérateur", "Plaques de cuisson", "Four", "Lave-linge", "Canapé", "Table et 4 chaises", "Lit double", "Climatiseur"] });
  // Envois automatiques : relance (impayés), appel de la prochaine échéance, puis quittance automatique au paiement.
  rentAutomationJob_({ force: true, batch: 50 });
  var g = T.call(tok, "lease.get", { leaseId: leaseId });
  var partial = g.schedules.filter(function (s) { return s.status !== "PAID" && s.paid > 0; })[0];
  if (partial) T.call(tok, "pay.record", { refType: "RENT_SCHEDULE", refId: partial.scheduleId, kind: "RENT", amount: partial.remaining, method: "TRANSFER", reference: "VIR-DEMO-" + partial.period });
  // Contrat rédigé par l'agent (modèle intégré) et validé.
  var d = T.call(tok, "leasedoc.draft", { leaseId: leaseId, docType: "LEASE_CONTRACT", furnished: true, usage: "HABITATION", clauses: ["INSURANCE_REQUIRED", "SUBLET_FORBIDDEN", "NO_SMOKING"],
    instructions: "Place de parking n° 12 en sous-sol incluse dans la location.", useAi: false });
  T.call(tok, "leasedoc.finalize", { leaseDocId: d.leaseDocId });
  // État des lieux d'entrée validé.
  var e = T.call(tok, "inspection.create", { leaseId: leaseId, type: "ENTRY", inspectionDate: l.startDate });
  var notes = { "Murs": "Petite trace près de l'interrupteur", "Sols": "", "Placards et rangements": "Une poignée à resserrer" };
  e.rooms.forEach(function (r, ri) { r.items.forEach(function (i, ii) { i.condition = (ri + ii) % 7 === 3 ? "WORN" : (ri === 0 && ii === 0 ? "NEW" : "GOOD"); if (i.condition === "WORN" && notes[i.name]) i.note = notes[i.name]; }); });
  T.call(tok, "inspection.save", { inspectionId: e.inspectionId, rooms: e.rooms, meters: { electricity: "045 812", water: "01 337" }, keys: [{ label: "Clés de la porte d'entrée", count: 3 }, { label: "Clés de la boîte aux lettres", count: 2 }, { label: "Badges ou télécommandes", count: 1 }],
    attendees: "Le bailleur et la locataire", generalNote: "Logement repeint avant l'entrée dans les lieux." });
  T.call(tok, "inspection.write", { inspectionId: e.inspectionId, useAi: false });
  T.call(tok, "inspection.finalize", { inspectionId: e.inspectionId });
  dbUpdate_("LeaseInspections", e.inspectionId, { inspectionDate: l.startDate });
})();
