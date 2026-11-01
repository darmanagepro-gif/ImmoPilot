/*
 * Adresse de l'application (serveur sécurisé en France, plus Google Apps Script).
 */
window.IMMOPILOT_CONFIG = {
  appUrl: "https://immopilotapp.fr/",
  appName: "ImmoPilot",

  // Société éditrice (utilisée dans les pages de contrats)
  societe: {
    nom: "ECO SYNERGY",
    ville: "Colomiers (France)",
    email: "ecosynergy31@gmail.com",
    telephone: "+33 7 49 98 09 18"
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
    devise: "MAD",          // devise des prix, des commissions et des contrats
    devisePaiement: "EUR",  // devise du compte SumUp : si elle diffère de « devise », la page de paiement prévient d'une conversion
    hotesAutorises: ["sumup.com", "sum.up"],
    commissions: { commanditaire: 6, artisan: 15 }
  }
};
