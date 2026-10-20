// ── Page d'accueil : ce qui reste dans le bundle des pharmacies (le reste est chargé à la demande, chunk Accueil-*) ──
// lireOffres : GET accueil-offres (jeton par appelAuthentifie), partagé entre le préchargement (démarrage d'App, en
// parallèle de products-get et du chunk) et la page : pas de cascade chunk → données. Réponse gardée 60 s par identité ;
// refus (401, 403…) ou erreur réseau → null (accueil sans vitrine, sans message).

let offres = null;   // { cle, at, promesse }
export function lireOffres(appel, cle) {
  if (offres?.cle === cle && Date.now() - offres.at < 60e3) return offres.promesse;
  // sans le cache HTTP du navigateur (private, max-age=60) : une page rechargée juste après « Publier » montre la nouvelle
  // version ; la réponse reste gardée 60 s en mémoire pour la page ouverte
  const promesse = appel("/.netlify/functions/accueil-offres", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  offres = { cle, at: Date.now(), promesse };
  return promesse;
}
