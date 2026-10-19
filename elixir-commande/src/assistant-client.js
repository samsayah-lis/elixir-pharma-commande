// ── Assistant Elixir : identité des appels et état du bouton (docs/assistant-contrat.md, « API HTTP ») ──
// Dans le bundle des pharmacies : seulement ce qu'il faut pour savoir si le bouton s'affiche (action « etat », lue
// une fois par identité) ; les autres appels (conversation, attente, fichiers) sont dans le panneau, chargé à la
// demande (src/components/assistant/api.js, qui reprend jetonCourant et renouvelleJeton).
// Identité : jeton du code reçu par e-mail pour une pharmacie ; admin_token + pour_odoo_id en mode « Commander pour
// une pharmacie ». Jamais d'autre identifiant envoyé par le navigateur (le serveur ne le lirait pas).
import { freshPharmacyToken } from "./lab-justif-client.js";

// auth = { admin: false } (pharmacie) ou { admin: true, odooId } (saisie Elixir pour une pharmacie)
export const authAssistant = (actingFor) => actingFor ? { admin: true, odooId: actingFor.odoo_id } : { admin: false };

export const jetonCourant = (auth) => (auth.admin ? localStorage.getItem("admin_token") : localStorage.getItem("pharmacy_token")) || "";

// Jeton pharmacie expiré (une heure) : un seul renouvellement à la fois, partagé par les appels simultanés (le jeton de
// renouvellement change à chaque usage) ; sans jeton de renouvellement (ancien mode) : rien à tenter
let renouvellement = null;
export function renouvelleJeton() {
  if (!localStorage.getItem("pharmacy_refresh_token")) return Promise.resolve(null);
  if (!renouvellement) renouvellement = freshPharmacyToken().finally(() => { renouvellement = null; });
  return renouvellement;
}

// Bouton de l'assistant : état gardé pour la session de la page, par identité. Pas gardés : « reconnexion » (jeton
// expiré au démarrage, nouvelle connexion) ni une coupure réseau. Fonction absente ou en erreur : bouton masqué.
const etats = new Map();
export function etatAssistant(auth, identite) {
  if (etats.has(identite)) return etats.get(identite);
  const lit = (j = jetonCourant(auth)) => fetch("/.netlify/functions/chat", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(j ? { Authorization: `Bearer ${j}` } : {}) },
    body: JSON.stringify({ action: "etat", ...(auth.admin ? { pour_odoo_id: auth.odooId } : {}) }) })
    .then((r) => (r.ok ? r.json() : null)).then((e) => e || { disponible: false, raison: null });
  // jeton expiré pendant que la page dormait : un renouvellement, puis une seconde lecture
  const p = lit().then(async (e) => (!e.disponible && e.raison === "reconnexion" && !auth.admin && await renouvelleJeton() ? lit() : e))
    .catch(() => ({ disponible: false, raison: "reseau" }));
  etats.set(identite, p);
  p.then((e) => { if (!e.disponible && (e.raison === "reconnexion" || e.raison === "reseau")) etats.delete(identite); });
  return p;
}
