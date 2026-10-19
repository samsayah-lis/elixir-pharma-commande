// ── Assistant Elixir : identité des appels et état du bouton (docs/assistant-contrat.md, « API HTTP ») ──
// Dans le bundle des pharmacies : seulement ce qu'il faut pour savoir si le bouton s'affiche (action « etat », lue
// une fois par identité) ; les autres appels (conversation, attente, fichiers) sont dans le panneau, chargé à la
// demande (src/components/assistant/api.js, qui reprend jetonCourant et renouvelleJeton).
// Identité : jeton du code reçu par e-mail pour une pharmacie ; admin_token + pour_odoo_id en mode « Commander pour
// une pharmacie ». Jamais d'autre identifiant envoyé par le navigateur (le serveur ne le lirait pas).
import { freshPharmacyToken } from "./lab-justif-client.js";
import { renouvelerUneFois, renouvelleAdmin } from "./jetons.js";

// auth = { admin: false } (pharmacie) ou { admin: true, odooId } (saisie Elixir pour une pharmacie)
export const authAssistant = (actingFor) => actingFor ? { admin: true, odooId: actingFor.odoo_id } : { admin: false };

export const jetonCourant = (auth) => (auth.admin ? localStorage.getItem("admin_token") : localStorage.getItem("pharmacy_token")) || "";

// Jeton expiré (une heure) : renouvelé par l'échange partagé avec les appels authentifiés d'App (src/jetons.js : un seul
// à la fois par sorte de jeton, le jeton de renouvellement change à chaque usage) ; pharmacie comme admin en saisie Elixir.
// Sans jeton de renouvellement (ancien mode) : rien à tenter. → jeton (pharmacie : l'actuel si le renouvellement échoue) ou null
export function renouvelleJeton(auth = { admin: false }) {
  if (auth?.admin) {
    const rt = localStorage.getItem("admin_refresh_token");
    return rt ? renouvelerUneFois("admin", () => renouvelleAdmin(rt)) : Promise.resolve(null);
  }
  return localStorage.getItem("pharmacy_refresh_token") ? renouvelerUneFois("pharmacie", freshPharmacyToken) : Promise.resolve(null);
}

// Bouton de l'assistant : état gardé pour la session de la page, par identité, s'il est franc (disponible, éteint, hors
// pilote, budget). Pas gardés : « reconnexion », une coupure réseau, un échec technique du serveur (raison vide) : relus
// au retour sur l'onglet (App). Fonction absente ou en erreur : bouton masqué.
const etats = new Map();
export function etatAssistant(auth, identite) {
  if (etats.has(identite)) return etats.get(identite);
  const lit = (j = jetonCourant(auth)) => fetch("/.netlify/functions/chat", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(j ? { Authorization: `Bearer ${j}` } : {}) },
    body: JSON.stringify({ action: "etat", ...(auth.admin ? { pour_odoo_id: auth.odooId } : {}) }) })
    .then((r) => (r.ok ? r.json() : null)).then((e) => e || { disponible: false, raison: null });
  // jeton expiré pendant que la page dormait : un renouvellement, puis une seconde lecture
  const p = lit().then(async (e) => (!e.disponible && e.raison === "reconnexion" && await renouvelleJeton(auth) ? lit() : e))
    .catch(() => ({ disponible: false, raison: "reseau" }));
  etats.set(identite, p);
  p.then((e) => { if (!e.disponible && (!e.raison || e.raison === "reconnexion" || e.raison === "reseau")) etats.delete(identite); });
  return p;
}
