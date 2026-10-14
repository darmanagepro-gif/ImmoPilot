/**
 * Compatibilité avec les versions précédentes (phases 2 à 4).
 * - p4ExpireCleaningMissions : ancien déclencheur installé par installPhase4Triggers() ; redirigé vers jobFrequent()
 *   tant que installTriggers() n'a pas été exécuté (installTriggers supprime l'ancien déclencheur).
 * - installPhase4Triggers : ancien nom, redirigé vers installTriggers().
 * Les anciennes fonctions appelées par l'ancienne interface (getAppBootstrap, createProperty, p4Event…) sont remplacées
 * par les routes de api() ; la correspondance est détaillée dans CHANGELOG.md. Supprimez le fichier Phase4Operations.gs
 * de votre projet Apps Script lors de la mise à jour.
 */
function p4ExpireCleaningMissions() { return jobFrequent(); }
function installPhase4Triggers() { return installTriggers(); }
