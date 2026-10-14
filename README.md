# ImmoPilot — site officiel

Coquille installable (PWA) de l'application ImmoPilot. Les données sont hébergées par l'application Google Apps Script configurée dans `config.js`.

- Application : https://darmanagepro-gif.github.io/ImmoPilot/
- Politique de confidentialité : https://darmanagepro-gif.github.io/ImmoPilot/politique-confidentialite.html
- Suppression de compte : https://darmanagepro-gif.github.io/ImmoPilot/suppression-compte.html

## Paiements SumUp et contrats

| Page | Rôle |
|---|---|
| `abonnement.html` | Souscription : acceptation du contrat, autorisation de prélèvement, bouton de paiement du 1er mois |
| `contrat-abonnement.html` | Contrat type d'abonnement propriétaire (sans engagement, prélèvement mensuel par carte) |
| `payer-mission.html` | Appelée par l'application quand le propriétaire valide la facture d'une mission et clique sur « Payer » |
| `contrat-mission.html` | Contrat type de mise en relation moyennant commission : `?mode=ligne` (paiement en ligne + assurance) ou `?mode=direct` (sans assurance) |

Les boutons « Payer » restent **désactivés** tant que les liens SumUp ne sont pas renseignés dans `config.js` (bloc `paiement`).

À renseigner : `paiement.abonnementUrl` (lien SumUp du 1er mois), `paiement.prixMensuel`, et, pour les missions, un lien SumUp par facture transmis à `payer-mission.html` (paramètre `lien`) ou, à défaut, `paiement.missionUrl`.

Le prélèvement mensuel automatique par carte et la confirmation fiable des paiements (webhook) demandent du code côté application : voir `docs/apps-script-paiement.gs` (squelette à adapter et à tester). Un simple lien de paiement SumUp ne permet pas de renouveler l'abonnement automatiquement.

Les contrats sont des **modèles à faire valider par un avocat marocain** : les passages surlignés sont à compléter (forme juridique, RC, ICE, prix, taux de commission, assureur, etc.).
