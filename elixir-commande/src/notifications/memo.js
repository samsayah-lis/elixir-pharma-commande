// ── Notifications de l'appli Elixir : « Plus tard » sur la carte de l'accueil (docs/notifications.md) ──
// Clé notif_carte_<identité> (compte de la pharmacie) : date du « Plus tard » ; la carte revient après 30 jours.
// Seuls appels de stockage du lot (déclarés dans scripts/verifie-zones.mjs, CLES_AUTORISEES.notifications).
const TRENTE_JOURS = 30 * 86400e3;
const cleCarte = (identite) => `notif_carte_${identite}`;

export function masquee(identite, maintenant = Date.now()) {
  try {
    const t = Number(localStorage.getItem(cleCarte(identite)));
    return t > 0 && maintenant - t < TRENTE_JOURS;
  } catch { return false; }
}

export function masquer(identite, maintenant = Date.now()) {
  try { localStorage.setItem(cleCarte(identite), String(maintenant)); } catch { /* stockage refusé : la carte reviendra */ }
}
