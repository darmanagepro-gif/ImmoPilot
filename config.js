/*
 * SEUL FICHIER À MODIFIER : collez ici l'URL de votre application Apps Script (celle qui se termine par /exec).
 * Exemple : "https://script.google.com/macros/s/AKfycb.../exec"
 */
window.IMMOPILOT_CONFIG = {
  appUrl: "https://script.google.com/macros/s/AKfycbwK-erOdZm1bbrbntsJ-U36mF94CpmKHlnrhvPiqqlLoaGeAUGOsaIWiBbh07iBPvY/exec",
  appName: "ImmoPilot",

  // Société éditrice (utilisée dans les pages de contrats)
  societe: {
    nom: "Darmanagepro",
    ville: "Marrakech",
    email: "Darmanagepro@gmail.com",
    telephone: "+33 7 49 98 00 18"
  },

  /*
   * Paiement SumUp. Tant que les liens sont vides, les boutons « Payer » restent désactivés.
   *  - abonnementUrl : lien SumUp du 1er mois d'abonnement (mode "lien").
   *  - missionUrl    : lien SumUp de repli pour le règlement d'une mission. Le plus sûr est que l'application (Apps Script)
   *                    crée un lien par facture et le transmette à payer-mission.html (paramètre « lien »).
   *  - modeAbonnement: "lien" = lien SumUp fourni (1er mois, renouvellements à relancer) ;
   *                    "widget" = carte enregistrée + prélèvement mensuel automatique (nécessite docs/apps-script-paiement.gs).
   *  - hotesAutorises: seuls ces domaines SumUp sont acceptés comme destination de paiement.
   *  - commissions   : en % du montant TTC de la facture finale d'une mission.
   *                    commanditaire = propriétaire ou agence (payée EN PLUS du prix de la facture) ;
   *                    artisan       = retenue sur ce qui lui est reversé.
   */
  paiement: {
    modeAbonnement: "lien",
    abonnementUrl: "",
    missionUrl: "",
    enregistrerAcceptation: false,
    prixMensuel: "",
    devise: "EUR",
    hotesAutorises: ["sumup.com", "sum.up"],
    commissions: { commanditaire: 6, artisan: 15 }
  }
};
