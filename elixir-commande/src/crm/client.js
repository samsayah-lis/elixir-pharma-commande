const API = "/.netlify/functions/";
export function lireSession() { try { return JSON.parse(sessionStorage.getItem("crm_session") || "null"); } catch { return null; } }
export function garderSession(s) {
  try { if (s) sessionStorage.setItem("crm_session", JSON.stringify(s)); else sessionStorage.removeItem("crm_session"); } catch { /* session en mémoire si le stockage est refusé */ }
}
export function lirePreferences(id) { try { return JSON.parse(localStorage.getItem(`crm_vues_${id}`) || "{}"); } catch { return {}; } }
export function garderPreferences(id, valeur) { try { localStorage.setItem(`crm_vues_${id}`, JSON.stringify(valeur)); return true; } catch { return false; } }
export function creerClient({ http = fetch, adminFetch, session = lireSession(), enregistrer = garderSession, onSession = () => {} } = {}) {
  let courant = session, renouvellement, generation = 0;
  const requete = async (...args) => {
    try { return await http(...args); }
    catch { throw Object.assign(new Error("Connexion indisponible. Vérifiez votre réseau puis réessayez."), { status: 503 }); }
  };
  const changer = s => { courant = s; enregistrer(s); onSession(s); };
  const lire = async res => {
    let d; try { d = await res.json(); } catch { throw Object.assign(new Error("Réponse illisible. Réessayez dans un instant."), { status: 503 }); }
    if (!res.ok || d.success === false) throw Object.assign(new Error(res.status === 409 ? "Cette fiche a été modifiée ailleurs. Les données ont été rechargées ; vérifiez-les avant de recommencer." : d.error || "Le service est momentanément indisponible."), { status: res.status });
    return d;
  };
  async function rafraichir() {
    if (!courant?.refresh_token) { changer(null); throw Object.assign(new Error("Votre session a expiré. Reconnectez-vous."), { status: 401 }); }
    const g = generation;
    const res = await requete(`${API}admin-refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: courant.refresh_token }) });
    if (res.status >= 500 || res.status === 429) throw Object.assign(new Error("Connexion indisponible. Votre session est conservée ; réessayez."), { status: 503 });
    const d = await res.json();
    if (g !== generation) throw Object.assign(new Error("Session fermée."), { status: 401 });
    if (!res.ok || !d.success || !d.token) { changer(null); throw Object.assign(new Error("Votre session a expiré. Reconnectez-vous."), { status: 401 }); }
    changer({ ...courant, token: d.token, refresh_token: d.refresh_token || courant.refresh_token });
  }
  return {
    async connexion(email, password) {
      const d = await lire(await requete(`${API}crm-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
      generation++; changer({ token: d.token, refresh_token: d.refresh_token });
    },
    deconnexion() { generation++; changer(null); },
    async appel(action, extra = {}) {
      const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) };
      if (adminFetch) return lire(await adminFetch(`${API}crm`, opts));
      const envoyer = () => requete(`${API}crm`, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${courant?.token || ""}` } });
      const ancien = courant?.token;
      let res = await envoyer();
      if (res.status === 401 && courant) {
        if (courant.token === ancien) {
          renouvellement ||= rafraichir().finally(() => { renouvellement = null; });
          await renouvellement;
        }
        res = await envoyer();
        if (res.status === 401) changer(null);
      }
      return lire(res);
    },
  };
}
export function peutAfficher(droits, utilisateur, ressource, action, ligne) {
  const droit = droits?.[ressource]?.[action];
  if (droit === true) return true;
  if (droit === "prospects") return !ligne || !ligne.odoo_id && ligne.statut === "prospect";
  if (droit === "propres") return ressource === "opportunites" ? !ligne || ligne.proprietaire_email === utilisateur.email :
    ligne?.auteur_email === utilisateur.email || ligne?.assigne_email === utilisateur.email;
  return false;
}
export const STATUTS = { prospect: "Prospect", client: "Client", ancien_client: "Ancien client", hors_cible: "Hors cible" };
export const ETAPES = { a_qualifier: "À qualifier", premier_contact: "Premier contact", rdv: "Rendez-vous", proposition: "Proposition", ouverture_compte: "Ouverture de compte", gagnee: "Gagnée", perdue: "Perdue" };
export const dateFr = d => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
export const evolution = (ca, prev) => prev > 0 ? (ca / prev - 1) * 100 : null;
export const pourcent = n => n == null ? "—" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
export function csvPage(lignes, colonnes) {
  const cellule = v => `"${String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
  return "\uFEFF" + [colonnes.map(c => cellule(c.label)).join(";"), ...lignes.map(r => colonnes.map(c => cellule(c.export ? c.export(r) : r[c.key])).join(";"))].join("\r\n");
}

// Tous les lots sont lus : pas de totaux calculés sur la seule première page.
export async function lireToutes(appel, ressource, filtres = {}, actif = () => true) {
  const lignes = [], ids = new Set();
  for (let page=1; ; page++) {
    if (!actif()) return [];
    const { donnees:d } = await appel(`${ressource}.lister`,{ filtres:{ tri:'created_at',sens:'asc',...filtres,page,limite:100 } });
    for (const r of d.lignes) if(!ids.has(r.id)) { ids.add(r.id);lignes.push(r); }
    if (!d.lignes.length || page*d.limite>=d.total) return lignes;
  }
}
