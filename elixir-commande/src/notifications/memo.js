// ── Notifications de l'appli Elixir : « Plus tard » sur la carte de l'accueil (docs/notifications.md) ──
// Clé notif_carte_<empreinte> : date du « Plus tard » ; la carte revient après 30 jours. L'empreinte (16 caractères
// hexadécimaux, FNV-1a) remplace l'identité du compte : aucune adresse e-mail en clair dans le stockage d'un poste partagé
// (elle resterait après la déconnexion).
// Seuls appels de stockage du lot avec le brouillon d'annonce de l'admin (déclarés dans scripts/verifie-zones.mjs,
// CLES_AUTORISEES.notifications).
const TRENTE_JOURS = 30 * 86400e3;
export function empreinteIdentite(identite) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (const c of String(identite ?? "")) {
    const x = c.codePointAt(0);
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const cleCarte = (identite) => `notif_carte_${empreinteIdentite(identite)}`;

export function masquee(identite, maintenant = Date.now()) {
  try {
    const t = Number(localStorage.getItem(cleCarte(identite)));
    return t > 0 && maintenant - t < TRENTE_JOURS;
  } catch { return false; }
}

export function masquer(identite, maintenant = Date.now()) {
  try { localStorage.setItem(cleCarte(identite), String(maintenant)); } catch { /* stockage refusé : la carte reviendra */ }
}
