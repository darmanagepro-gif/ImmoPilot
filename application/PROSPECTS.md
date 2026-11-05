# Espace Prospects — mode d'emploi

Page réservée au super administrateur : **Administration › Prospects**. À utiliser sur une seule instance (l'édition France, fr.darpilot.fr) : elle suit la prospection France **et** Maroc.

## Ce que vous y trouvez

| Onglet | Contenu |
|---|---|
| Tableau de bord | Réponses à traiter, relances dues, brouillons prêts, découvertes 2 mois, clients payants, artisans vérifiés ; activité de la semaine ; rapport du dernier passage des agents ; tunnel ; résultats par territoire et par cible |
| Clients à signer | Agences, conciergeries, syndics, propriétaires : filtres par statut, pays, cible, origine, « réponses à traiter », « relances dues » |
| Artisans à référencer | Même chose pour les artisans |
| Équipe d'agents | État de la synchronisation, adresse secrète, réglages, enregistrements DNS, journal des échanges |

Chaque fiche montre le journal complet (brouillons préparés, e-mails envoyés, réponses, relances, notes, appels, rendez-vous) et permet de changer le statut, d'ajouter une note ou de cocher « ne plus contacter ».

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
