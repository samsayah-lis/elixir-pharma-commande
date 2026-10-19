// ── Jetons du site : renouvellement d'un jeton expiré (pharmacie, ou admin en saisie pour une pharmacie) ──
// Partagé par les appels authentifiés d'App (appelAuthentifie) et par l'Assistant Elixir (assistant-client.js) : un seul
// registre pour tout l'onglet, donc un seul échange même quand le site et l'assistant sont refusés ensemble (jeton expiré
// au chargement de la page). Repris tel quel d'App.jsx (correctifs de sécurité du 19/10/2026) à la fusion de l'assistant.

// Un seul renouvellement de jeton à la fois par onglet (« pharmacie » ou « admin ») : plusieurs appels refusés ensemble
// (jeton expiré au chargement de la page) attendent le même échange au lieu d'en lancer chacun un — Supabase fait
// tourner le jeton de renouvellement à chaque échange
const renouvellements = {};
export const renouvelerUneFois = (qui, renouveler) => (renouvellements[qui] ||= renouveler().finally(() => { delete renouvellements[qui]; }));

// Jeton admin (saisie Elixir pour une pharmacie) : même renouvellement qu'adminFetch (AdminPanel.jsx) ; rt = jeton de
// renouvellement admin → nouveau jeton (gardé avec le nouveau jeton de renouvellement), ou null
export const renouvelleAdmin = async (rt) => {
  const d = await fetch("/.netlify/functions/admin-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) })
    .then(r => r.json()).catch(() => ({}));
  if (!(d.success && d.token)) return null;
  localStorage.setItem("admin_token", d.token);
  if (d.refresh_token) localStorage.setItem("admin_refresh_token", d.refresh_token);
  return d.token;
};
