# Espace commercial — mode d'emploi

Page réservée au super administrateur : **Administration › Espace commercial**. Les commerciaux terrain ont leur propre page, **Mon espace commercial**. À utiliser sur une seule instance (l'édition France, fr.darpilot.fr) : elle suit la prospection France **et** Maroc.

## Ce que vous y trouvez

| Onglet | Contenu |
|---|---|
| Vue d'ensemble | Commerciaux terrain (actifs, clients rattachés, inscriptions à rattacher, commissions en attente / à payer / payées) puis prospection : réponses à traiter, relances dues, brouillons prêts, découvertes 2 mois, clients payants, artisans vérifiés ; activité de la semaine ; rapport du dernier passage des agents ; tunnel ; résultats par territoire et par cible |
| Prospects clients | Agences, conciergeries, syndics, propriétaires : filtres par commercial, statut, pays, cible, origine (agents, commerciaux, import, saisie), « réponses à traiter », « relances dues » |
| Artisans | Même chose pour les artisans |
| Commerciaux terrain | Chaque commercial : code, secteur, clients, actifs, non signés, prospects, abonnements générés, commissions à payer ; fiche détaillée avec l'état de chaque dossier |
| Inscriptions | Tous les clients inscrits : forfait, contrat signé ou non, carte, fin d'essai, commercial (ou nom indiqué à rattacher) |
| Commissions | Toutes les commissions, filtres, totaux, export, « Recalculer » ; paiement depuis la fiche du commercial |
| Plan de commissionnement | Taux, durée, délai de reprise et simulation par forfait |
| Équipe d'agents | État de la synchronisation, adresse secrète, réglages, enregistrements DNS, journal des échanges |

Chaque fiche montre le journal complet (brouillons préparés, e-mails envoyés, réponses, relances, notes, appels, rendez-vous) et permet de changer le statut, d'ajouter une note ou de cocher « ne plus contacter ».

## Commerciaux terrain

1. **Créer un commercial** : bouton « ＋ Commercial » (nom, e-mail, téléphone, pays, secteur ; taux particuliers facultatifs). Il reçoit un e-mail pour créer son mot de passe.
2. **Son espace** (« Mon espace commercial ») : son lien d'inscription à partager (`…?action=signup&ref=CODE`, aussi par WhatsApp), ses clients et l'état de chaque dossier (inscrit, contrat signé, payé en essai, actif, résilié), ses commissions, son plan, ses propres prospects (ajout, import Excel / PDF / photo). Il ne voit rien d'autre : ni les autres commerciaux, ni les prospects des agents.
3. **Rattachement** : à l'inscription, la case facultative « Votre commercial DarPilot » accepte le code ou « prénom nom » (dans n'importe quel ordre) ; le lien de parrainage la remplit tout seul. Un nom non reconnu apparaît dans **Inscriptions › À rattacher** et vous êtes notifié.
4. **Prospects des commerciaux** : les agents ne les contactent jamais (ils sont signalés « ne pas contacter » dans les consignes).

## Plan de commissionnement (par défaut, modifiable)

| | Règle |
|---|---|
| Prime de signature | 100 % du prix mensuel HT du forfait (hors options), **acquise** quand le client a payé et que son essai de 2 mois se termine sans résiliation |
| Commission mensuelle | 10 % du prix mensuel HT sur chacun des 12 paiements suivants |
| Reprise | si le client part dans les 90 jours suivant l'acquisition : prime annulée, ou déduite si elle a déjà été payée |

Exemple France, forfait Pro (59 € HT) : 59 € à la signature puis 5,90 € par mois pendant 12 mois, soit 129,80 € la première année. Le calcul est refait chaque nuit et par « Recalculer ». Les commissions se paient au commercial sur facture : marquez-les payées depuis sa fiche avec la référence du virement. Faites valider le contrat de commercial ou d'apporteur d'affaires par un professionnel du droit.

Chaque édition (France, Maroc) a ses propres commerciaux et commissions, dans sa devise.

## Importer une liste

Bouton **Importer une liste** :

- **Excel, CSV, ODS** : lu directement dans le navigateur, colonnes reconnues automatiquement (nom, contact, e-mail, téléphone, adresse, ville, département/région, site, métier…).
- **PDF, photo, capture d'écran, carte de visite** : lu par l'IA Claude, qui détecte noms, e-mails, téléphones, adresses et métiers.

Vous vérifiez tout dans l'aperçu avant l'enregistrement : doublons signalés et décochés, lignes sans e-mail ni téléphone décochées, téléphones mis au format international. Les fiches importées sont transmises aux agents dans les consignes suivantes.

Rappel légal : un particulier (propriétaire) ne doit être contacté qu'avec son consentement.

## Mise en service (une seule fois)

1. **Mettre à jour le serveur** : `sudo immopilot-update` (sauvegarde, récupération du code, redémarrage, contrôle).
2. **Clé IA** (lecture des PDF et photos), si ce n'est pas déjà fait pour l'assistant :
   `sudo immopilot set IMMO_AI_PROVIDER anthropic` puis `sudo immopilot set-secret IMMO_AI_API_KEY` (la clé est saisie sans s'afficher). Facultatif : `IMMO_AI_DOC_MODEL` pour choisir le modèle de lecture.
3. **DNS** chez votre registraire (Scaleway pour darpilot.fr), deux enregistrements :

   | Nom | Type | Priorité | Valeur |
   |---|---|---|---|
   | crm.darpilot.fr | MX | 10 | inbound1.sendinblue.com. |
   | crm.darpilot.fr | MX | 20 | inbound2.sendinblue.com. |

   Le domaine darpilot.fr doit être vérifié dans Brevo (domaine expéditeur).
4. Dans **Prospects › Équipe d'agents** : vérifiez le domaine (crm.darpilot.fr par défaut) et l'adresse Gmail des agents (par défaut celle du super administrateur), puis cliquez sur **Activer la synchronisation**. Le webhook Brevo est déclaré automatiquement dans les 10 minutes (état affiché sur la page), puis **Envoyer les consignes maintenant** transmet l'adresse secrète aux agents.

## Fonctionnement de la synchronisation

- **Agents → DarPilot** : après chaque passage, les agents envoient un e-mail à l'adresse secrète `agents-…@crm.darpilot.fr`. Brevo le transmet au serveur, qui l'applique seulement s'il vient de l'adresse des agents. Un même passage n'est jamais appliqué deux fois.
- **DarPilot → agents** : chaque jour vers 6 h (avant le passage des agents) et à la demande, un e-mail « [DarPilot-Consignes] » leur transmet les fiches importées ou modifiées ici, les statuts et les « ne plus contacter ». Ce que vous décidez dans DarPilot (désinscrit, perdu, refusé, ne plus contacter) n'est jamais écrasé par les agents.
- En cas de doute, **Changer l'adresse secrète** : l'ancienne est refusée aussitôt et la nouvelle part avec les consignes suivantes.

Format du bloc échangé (entre `-----DARPILOT-SYNC-BEGIN-----` et `-----DARPILOT-SYNC-END-----`) :

```json
{ "version": 1, "runId": "2026-11-06-matin",
  "prospects": [{ "key": "contact@agence.fr", "company": "…", "email": "…", "phone": "…", "country": "FR", "territory": "31 Haute-Garonne", "city": "Toulouse",
                  "target": "AGENCE", "status": "a_envoyer", "score": 70, "sourceUrl": "https://…", "notes": "…" }],
  "events": [{ "key": "contact@agence.fr", "kind": "DRAFT|SENT|REPLY|FOLLOWUP|NOTE|STATUS", "at": "2026-11-06T06:50:00Z", "summary": "…" }],
  "summary": { "text": "Rapport du passage", "territories": ["31", "marrakech-safi"] } }
```
