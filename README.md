# ImmoPilot — site officiel

Coquille installable (PWA) de l'application ImmoPilot. Les données sont hébergées par l'application Google Apps Script configurée dans `config.js`.

- Application : https://darmanagepro-gif.github.io/ImmoPilot/
- Politique de confidentialité : https://darmanagepro-gif.github.io/ImmoPilot/politique-confidentialite.html
- Suppression de compte : https://darmanagepro-gif.github.io/ImmoPilot/suppression-compte.html

## Icône et écran de démarrage

- **Icône** (écran d'accueil iPhone et Android, favicon) : fichiers du dossier `icons/` (`apple-touch-icon.png` 180 px pour iPhone, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` pour Android, `favicon-32.png`). Après un changement, augmenter `?v=2` dans `index.html` : iPhone et Android conservent l'ancienne icône tant que le raccourci n'a pas été supprimé puis recréé (iPhone : Safari › Partager › « Sur l'écran d'accueil »).
- **Vidéo de démarrage** : `media/intro.mp4` (muette : iPhone et Chrome interdisent la lecture automatique avec le son) et son image de départ `media/intro-poster.jpg`. Elle se joue en entier pendant le chargement, puis un fondu mène à l'écran de connexion ; un appui sur l'écran la passe. Pour la remplacer : mêmes noms de fichiers, format 16/9, fichier léger (moins de 2 Mo). Commande de compression : `ffmpeg -i source.mp4 -an -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart media/intro.mp4`. Les gris de fond autour de la vidéo (CSS de `index.html`) reprennent les couleurs des bords de la vidéo actuelle : à ajuster si la nouvelle vidéo a un autre fond.

## Paiements SumUp et contrats

| Page | Rôle |
|---|---|
| `abonnement.html` | Souscription : acceptation du contrat, autorisation de prélèvement, bouton de paiement du 1er mois |
| `contrat-abonnement.html` | Contrat type d'abonnement propriétaire (sans engagement, prélèvement mensuel par carte) |
| `payer-mission.html` | Appelée par l'application quand le propriétaire valide la facture d'une mission et clique sur « Payer » |
| `contrat-mission.html` | Contrat type de mise en relation moyennant commission : `?mode=ligne` (paiement en ligne + assurance) ou `?mode=direct` (sans assurance) |

Les boutons « Payer » restent **désactivés** tant que les liens SumUp ne sont pas renseignés dans `config.js` (bloc `paiement`).

À renseigner : `paiement.abonnementUrl` (lien SumUp du 1er mois), `paiement.prixMensuel`, et, pour les missions, un lien SumUp par facture transmis à `payer-mission.html` (paramètre `lien`) ou, à défaut, `paiement.missionUrl`.

### Commissions sur les missions

Calculées sur le **montant TTC de la facture finale**, arrondies au centime (taux dans `config.js`, `paiement.commissions`) :

| Qui | Taux | Fonctionnement |
|---|---|---|
| Commanditaire (propriétaire ou agence) | 6 % | Payée **en plus** de la facture : total à payer en ligne = TTC + 6 % |
| Artisan | 15 % | Retenue sur le reversement : l'artisan reçoit TTC − 15 % |

Exemple : facture finale de 1 000,00 MAD TTC → le commanditaire paie 1 060,00 MAD, l'artisan reçoit 850,00 MAD, ImmoPilot conserve 210,00 MAD (hors frais du prestataire de paiement et TVA éventuelle sur les commissions).

Un lien SumUp **fixe** ne convient qu'à un montant unique : pour des factures de montants différents, le lien doit être créé par facture avec le total à payer (voir `missionCreerLienPaiement_` dans `docs/apps-script-paiement.gs`). Si les taux changent, mettre à jour `config.js`, le contrat (le texte se met à jour tout seul) et `TAUX_COMMANDITAIRE` / `TAUX_ARTISAN` dans le script.

Le prélèvement mensuel automatique par carte et la confirmation fiable des paiements (webhook) demandent du code côté application : voir `docs/apps-script-paiement.gs` (squelette à adapter et à tester). Un simple lien de paiement SumUp ne permet pas de renouveler l'abonnement automatiquement.

Les contrats sont des **modèles à faire valider par un avocat marocain** : les passages surlignés sont à compléter (forme juridique, RC, ICE, prix, taux de commission, assureur, etc.).
