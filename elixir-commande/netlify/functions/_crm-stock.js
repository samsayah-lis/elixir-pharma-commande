// PostgREST privé. L'audit est atomique via crm_auditer (sql/crm-schema.sql).
import { filtresSchema, valider, uuid, version as versionSchema, CHAMPS_ODOO_COMPTE } from "./_crm-regles.js";
const ressources = ["comptes", "contacts", "activites", "opportunites", "equipe", "reglages", "journal", "indicateurs", "synchros", "comptes_indicateurs", "rpc/crm_importer_suivi", "rpc/crm_commencer_synchro", "rpc/crm_publier_indicateurs"];
const tris = { comptes: ["nom", "ville", "statut", "departement", "ca", "evolution", "profil", "action_proposee", "non_servi", "derniere_activite"], contacts: ["nom"], activites: ["echeance", "statut"],
  opportunites: ["etape", "date_visee", "titre"], equipe: ["nom_affiche"], reglages: [], journal: [] };
const filtres = { comptes: ["source", "statut", "commercial_email", "departement", "archive", "profil", "action_proposee"], contacts: ["compte_id"],
  activites: ["compte_id", "statut", "assigne_email"], opportunites: ["compte_id", "etape", "proprietaire_email"],
  equipe: ["utilisateur_id"], reglages: [], journal: ["objet", "objet_id"] };
export const erreurCrm = (status, message) => Object.assign(new Error(message), { status });
export function creerStockCrm(deps = {}) {
  const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.cle ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const http = deps.fetch || fetch, maintenant = deps.maintenant || (() => new Date());
  const table = r => { if (!ressources.includes(r)) throw erreurCrm(400, "Objet inconnu."); return r.startsWith("rpc/") ? r : `crm_${r}`; };
  async function requete(r, params, method = "GET", body, u, action) {
    const t = table(r);
    if (!url || !cle) throw erreurCrm(503, "Base indisponible.");
    let res, data;
    try {
      res = await http(`${url}/rest/v1/${t}?${new URLSearchParams(params)}`, { method,
        headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json",
          Prefer: "return=representation,count=exact", ...(u ? { "x-crm-acteur": u.id, "x-crm-email": u.email, "x-crm-action": action } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      data = await res.json();
    } catch { throw erreurCrm(503, "Base indisponible."); }
    if (!res.ok) {
      if (res.status === 409 || ["23505", "40001"].includes(data?.code)) throw erreurCrm(409, "Conflit : cet enregistrement existe déjà.");
      if (["23503", "23514", "22P02"].includes(data?.code)) throw erreurCrm(400, "Entrée invalide ou référence inexistante.");
      throw erreurCrm(503, "Base indisponible.");
    }
    if (!Array.isArray(data)) throw erreurCrm(503, "Réponse de la base illisible.");
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    return { lignes: data, total: Number.isFinite(total) ? total : data.length };
  }
  async function lister(r, options = {}) {
    table(r);
    const f = valider(filtresSchema, r === "journal" ? { tri: "created_at", ...options } : options);
    if (!["created_at", ...(r === "journal" ? [] : ["updated_at"]), ...tris[r]].includes(f.tri)) throw erreurCrm(400, "Tri invalide.");
    const p = { select: "*", order: `${f.tri === "derniere_activite" ? "nom" : f.tri}.${f.sens},id.asc`, limit: f.limite, offset: (f.page - 1) * f.limite };
    for (const [k, v] of Object.entries(f)) {
      if (["page", "limite", "tri", "sens"].includes(k)) continue;
      if (filtres[r].includes(k)) p[k] = `eq.${v}`;
      else if (r === "comptes" && /^(ca|evolution|non_servi)_(min|max)$/.test(k)) {
        const [, colonne, borne] = k.match(/^(ca|evolution|non_servi)_(min|max)$/);
        // Plusieurs bornes d'une même colonne passent par AND, pas par une clé écrasée.
        p.and = p.and ? `${p.and.slice(0, -1)},${colonne}.${borne === "min" ? "gte" : "lte"}.${v})` :
          `(${colonne}.${borne === "min" ? "gte" : "lte"}.${v})`;
      }
      else if (k === "echeance_avant" && r === "activites") p.echeance = `lte.${v}`;
      else if (k === "recherche" && r === "comptes") {
        // Les métacaractères PostgREST sont neutralisés, puis URLSearchParams encode l'URL.
        const q = v.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
        if (!q) throw erreurCrm(400, "Recherche invalide.");
        p.or = `(${["nom", "ville", "cip", "finess"].map(c => `${c}.ilike.*${q}*`).join(",")})`;
      } else throw erreurCrm(400, "Filtre invalide pour cet objet.");
    }
    if (r === "comptes" && f.archive === undefined) p.archive = "eq.false";
    if (r !== "comptes") return { ...(await requete(r, p)), page: f.page, limite: f.limite };
    let resultat;
    if (f.tri === "derniere_activite") {
      // Sans migration SQL dans ce lot : joindre et trier AVANT la pagination.
      const lignes = [];
      for (let offset = 0; ; offset += 1000) {
        const lot = await requete("comptes_indicateurs", { ...p, limit: 1000, offset });
        lignes.push(...lot.lignes); if (lot.lignes.length < 1000) break;
      }
      resultat = { lignes, total: lignes.length };
    } else resultat = await requete("comptes_indicateurs", p);
    const dates = new Map();
    for (let i = 0; i < resultat.lignes.length; i += 100) {
      const ids = resultat.lignes.slice(i, i + 100).map(c => c.id);
      for (let offset = 0; ; offset += 1000) {
        const lot = await requete("activites", { compte_id: `in.(${ids.join(",")})`, select: "compte_id,created_at,realise_at", limit: 1000, offset, order: "created_at.desc,id.asc" });
        for (const a of lot.lignes) { const date = a.realise_at || a.created_at; if (date && (!dates.has(a.compte_id) || date > dates.get(a.compte_id))) dates.set(a.compte_id, date); }
        if (lot.lignes.length < 1000) break;
      }
    }
    resultat.lignes = resultat.lignes.map(c => ({ ...c, derniere_activite: dates.get(c.id) || null }));
    if (f.tri === "derniere_activite") {
      resultat.lignes.sort((a, b) => !a.derniere_activite ? !b.derniere_activite ? a.id.localeCompare(b.id) : 1 : !b.derniere_activite ? -1 :
        a.derniere_activite.localeCompare(b.derniere_activite) * (f.sens === "desc" ? -1 : 1) || a.id.localeCompare(b.id));
      resultat.lignes = resultat.lignes.slice((f.page - 1) * f.limite, f.page * f.limite);
    }
    return { ...resultat, page: f.page, limite: f.limite };
  }
  async function lire(r, id) {
    return (await requete(r, { id: `eq.${valider(uuid, id)}`, select: "*", limit: 1 })).lignes[0] || null;
  }
  async function creer(r, data, u, action = `${r}.creer`) {
    if (r === "journal") throw erreurCrm(403, "Journal en ajout automatique seulement.");
    const iso = maintenant().toISOString();
    const rows = (await requete(r, { select: "*" }, "POST", { ...data, version: 1, created_at: iso, updated_at: iso }, u, action)).lignes;
    if (!rows[0]) throw erreurCrm(503, "Écriture non confirmée.");
    return rows[0];
  }
  async function modifier(r, id, version, data, u, action = `${r}.modifier`) {
    if (r === "journal") throw erreurCrm(403, "Journal non modifiable.");
    valider(uuid, id); valider(versionSchema, version);
    const rows = (await requete(r, { id: `eq.${id}`, version: `eq.${version}`, select: "*" }, "PATCH",
      { ...data, version: version + 1, updated_at: maintenant().toISOString() }, u, action)).lignes;
    if (!rows[0]) {
      if (!await lire(r, id)) throw erreurCrm(404, "Enregistrement introuvable.");
      throw erreurCrm(409, "Conflit de version : rechargez l’enregistrement.");
    }
    return rows[0];
  }
  const instantanes = async odooId => {
    if (!Number.isSafeInteger(odooId) || odooId < 0) throw erreurCrm(400, "Compte Odoo invalide.");
    const rows = (await requete("indicateurs", { odoo_id: `eq.${odooId}`, order: "periode_fin.desc", limit: 26 })).lignes;
    return { dernier: rows[0] || null, historique: rows };
  };
  const etatSynchro = async () => (await requete("synchros", { order: "debut.desc,id.desc", limit: 1 })).lignes[0] || null;
  const commencerSynchro = async date => (await requete("rpc/crm_commencer_synchro", {}, "POST", { p_date: date })).lignes[0] || null;
  const publierIndicateurs = async (id, instantanes, compteurs) => {
    const rows = (await requete("rpc/crm_publier_indicateurs", {}, "POST", { p_id: id, p_instantanes: instantanes, p_compteurs: compteurs })).lignes;
    if (!rows.length) throw erreurCrm(409, "Passage expiré.");
    return rows[0];
  };
  const echouerSynchro = async (id, compteurs) => requete("synchros", { id: `eq.${id}`, statut: "eq.en_cours" }, "PATCH", {
    statut: "erreur", fin: maintenant().toISOString(), updated_at: maintenant().toISOString(), compteurs,
    erreur: "Synchronisation interrompue : vérifier les réglages et la disponibilité des services.",
  });
  async function synchroniserCompte(data) {
    if (!Number.isSafeInteger(data.odoo_id) || data.odoo_id <= 0) throw erreurCrm(400, "Compte Odoo invalide.");
    data = Object.fromEntries(Object.entries(data).filter(([k]) => CHAMPS_ODOO_COMPTE.includes(k)));
    // Relecture à chaque conflit : ni notes perdues, ni hors_cible écrasé en cas de course.
    for (let tentative = 0; tentative < 5; tentative++) {
      const c = (await requete("comptes", { odoo_id: `eq.${data.odoo_id}`, limit: 1 })).lignes[0];
      if (c?.statut === "hors_cible") return "ignores";
      const acteur = { id: "00000000-0000-4000-8000-000000000000", email: "" };
      try {
        if (c) {
          const patch = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "source"));
          if (Object.entries(patch).every(([k, v]) => c[k] === v)) return "inchanges";
          await modifier("comptes", c.id, c.version, patch, acteur, "comptes.synchroniser_odoo");
          return "modifies";
        }
        await creer("comptes", { ...data, source: "odoo" }, acteur, "comptes.synchroniser_odoo");
        return "crees";
      } catch (e) { if (e.status !== 409) throw e; }
    }
    throw erreurCrm(409, "Compte modifié simultanément, synchronisation à reprendre.");
  }
  async function donneesImport() {
    const result={};for(const r of ['comptes','activites']){result[r]=[];for(let offset=0;;offset+=1000){const d=await requete(r,{select:r==='comptes'?'id,cip,nom':'import_empreinte',order:'id.asc',offset,limit:1000});result[r].push(...d.lignes);if(d.lignes.length<1000)break;}}return result;
  }
  const importerSuivi=async(lignes,u)=>(await requete('rpc/crm_importer_suivi',{},'POST',{p_lignes:lignes},u,'activites.importer_suivi')).lignes[0]?.creees;
  return { donneesImport, importerSuivi, lister, lire, creer, modifier, instantanes, etatSynchro, commencerSynchro, publierIndicateurs, echouerSynchro, synchroniserCompte };
}
