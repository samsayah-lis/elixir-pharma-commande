import { creerCacheCrm } from "./_crm-cache.js";
import { syntheseTableau, syntheseAccueil, minuitParis, pipeline } from "./_crm-synthese.js";
// PostgREST privé. L'audit est atomique via crm_auditer (sql/crm-schema.sql).
import { filtresSchema, valider, uuid, version as versionSchema, CHAMPS_ODOO_COMPTE } from "./_crm-regles.js";
const ressources = ["comptes", "contacts", "activites", "opportunites", "equipe", "reglages", "journal", "indicateurs", "synchros", "comptes_indicateurs", "rpc/crm_importer_suivi", "rpc/crm_commencer_synchro", "rpc/crm_publier_indicateurs"];
const tris = { comptes: ["nom", "ville", "statut", "departement", "ca", "evolution", "profil", "action_proposee", "non_servi", "derniere_activite"], contacts: ["nom", "compte", "fonction", "email"], activites: ["echeance", "statut"],
  opportunites: ["etape", "date_visee", "titre"], equipe: ["nom_affiche"], reglages: [], journal: [] };
const filtres = { comptes: ["source", "statut", "commercial_email", "departement", "archive", "profil", "action_proposee"], contacts: ["compte_id", "fonction"],
  activites: ["compte_id", "statut", "assigne_email", "type"], opportunites: ["compte_id", "etape", "proprietaire_email"],
  equipe: ["utilisateur_id"], reglages: [], journal: ["objet", "objet_id"] };
export const erreurCrm = (status, message) => Object.assign(new Error(message), { status });
export function creerStockCrm(deps = {}) {
  const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.cle ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cache = creerCacheCrm(deps);
  const invalider = () => deps.invalidationCache === false ? Promise.resolve() : cache.invalider();
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
  // Toutes les pages serveur utilisent un ordre stable et une taille de 1 000.
  async function toutes(r, params = {}) {
    const lignes = [];
    for (let offset = 0; ; offset += 1000) {
      const lot = await requete(r, { select: "*", order: "id.asc", ...params, limit: 1000, offset });
      lignes.push(...lot.lignes);
      if (lot.lignes.length < 1000) return lignes;
    }
  }
  async function synthese(r, email) {
    const date = maintenant();
    const [comptes, activites, opportunites, global, reglages] = await Promise.all([
      toutes("comptes_indicateurs", {
        select: "id,nom,odoo_id,statut,archive,commercial_email,created_at,periode_fin,ca,profil,action_proposee,prev:indicateurs->prev",
        order: "created_at.asc,id.asc",
      }),
      toutes("activites", { order: "created_at.asc,id.asc" }),
      r === "tableau" ? toutes("opportunites", { order: "created_at.asc,id.asc" }) : [],
      r === "tableau" ? instantanes(0) : null,
      r === "tableau" ? requete("reglages", { limit: 1 }) : null,
    ]);
    const dates = new Map();
    for (const a of activites) {
      const d = a.realise_at || a.created_at;
      if (d && (!dates.has(a.compte_id) || d > dates.get(a.compte_id))) dates.set(a.compte_id, d);
    }
    const comptesDates = comptes.map(c => ({ ...c,
      indicateurs: c.periode_fin ? { ca:c.ca,prev:c.prev,profil:c.profil,action:c.action_proposee } : null,
      derniere_activite: dates.get(c.id) || null }));
    if (r === "accueil") return syntheseAccueil(comptesDates, activites, email, date);
    global.objectif_mensuel_global = reglages.lignes[0]?.objectif_mensuel_global ?? null;
    return syntheseTableau(comptesDates, opportunites, activites, global, date);
  }
  async function taches(email) {
    const lignes=await toutes("activites",{assigne_email:`eq.${email}`,statut:"eq.a_faire",type:"in.(tache,rendez_vous)",order:"created_at.asc,id.asc"});
    const groupes=syntheseAccueil([],lignes,email,maintenant()).taches;
    for(const g of Object.values(groupes))g.lignes=await nommer(g.lignes);
    return groupes;
  }
  async function nommer(lignes) {
    const ids = [...new Set(lignes.map(l => l.compte_id))], noms = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const lot = await requete("comptes", { id: `in.(${ids.slice(i,i+100).join(",")})`, select: "id,nom", limit: 100 });
      for (const c of lot.lignes) noms.set(c.id, c.nom);
    }
    return lignes.map(l => ({ ...l, compte_nom: noms.get(l.compte_id) || "" }));
  }
  async function lister(r, options = {}) {
    table(r);
    const f = valider(filtresSchema, r === "journal" ? { tri: "created_at", ...options } : options);
    if (!["created_at", ...(r === "journal" ? [] : ["updated_at"]), ...tris[r]].includes(f.tri)) throw erreurCrm(400, "Tri invalide.");
    const p = { select: "*", order: `${f.tri === "derniere_activite" ? "nom" : f.tri}.${f.sens},id.asc`, limit: f.limite, offset: (f.page - 1) * f.limite };
    if (r === "contacts" && (f.recherche || f.tri === "compte")) {
      p.select = "*,crm_comptes(nom),compte_recherche:crm_comptes()";
      if (f.tri === "compte") p.order = `crm_comptes(nom).${f.sens},id.asc`;
    }
    const conditions = [];
    for (const [k, v] of Object.entries(f)) {
      if (["page", "limite", "tri", "sens"].includes(k)) continue;
      if (k === "vue_tableau" && r === "opportunites") continue;
      if (r === "activites" && ["echeance_debut", "echeance_fin", "retard"].includes(k)) {
        if (k === "retard" && v) conditions.push("statut.eq.a_faire", `echeance.lt.${maintenant().toISOString()}`);
        if (k === "echeance_debut") conditions.push(`echeance.gte.${minuitParis(v)}`);
        if (k === "echeance_fin") conditions.push(`echeance.lt.${minuitParis(v, 1)}`);
        continue;
      }
      if (filtres[r].includes(k)) p[k] = `eq.${v}`;
      else if (r === "comptes" && /^(ca|evolution|non_servi)_(min|max)$/.test(k)) {
        const [, colonne, borne] = k.match(/^(ca|evolution|non_servi)_(min|max)$/);
        // Plusieurs bornes d'une même colonne passent par AND, pas par une clé écrasée.
        p.and = p.and ? `${p.and.slice(0, -1)},${colonne}.${borne === "min" ? "gte" : "lte"}.${v})` :
          `(${colonne}.${borne === "min" ? "gte" : "lte"}.${v})`;
      }
      else if (k === "echeance_avant" && r === "activites") p.echeance = `lte.${v}`;
      else if (k === "recherche" && ["comptes", "contacts", "activites"].includes(r)) {
        // Les métacaractères PostgREST sont neutralisés, puis URLSearchParams encode l'URL.
        const q = v.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
        if (!q) throw erreurCrm(400, "Recherche invalide.");
        const champs = r === "comptes" ? ["nom", "ville", "cip", "finess"] : r === "contacts" ? ["nom", "prenom", "fonction"] : ["titre"];
        const clauses = champs.map(c => `${c}.ilike.*${q}*`);
        if (r === "contacts") {
          p["compte_recherche.nom"] = `ilike.*${q}*`;
          clauses.push("compte_recherche.not.is.null");
          // La recherche porte aussi sur les libellés français affichés (ex. « Préparateur »).
          const fonctions = { titulaire:"Titulaire",cotitulaire:"Cotitulaire",adjoint:"Adjoint",preparateur:"Préparateur",acheteur:"Acheteur",comptable:"Comptable",autre:"Autre" };
          for (const [code,libelle] of Object.entries(fonctions)) if (libelle.toLocaleLowerCase("fr-FR").includes(q.toLocaleLowerCase("fr-FR"))) clauses.push(`fonction.eq.${code}`);
        }
        p.or = `(${clauses.join(",")})`;
      } else throw erreurCrm(400, "Filtre invalide pour cet objet.");
    }
    if (conditions.length) p.and = `(${conditions.join(",")})`;
    if (r === "comptes" && f.archive === undefined) p.archive = "eq.false";
    if (r === "comptes") p.select = "id,nom,ville,statut,source,commercial_email,departement,archive,odoo_id,cip,finess,version,created_at,updated_at,ca,evolution,profil,action_proposee,non_servi,periode_fin,prev:indicateurs->prev,marge:indicateurs->marge";
    if (r === "opportunites" && f.vue_tableau) {
      const resumes=await toutes(r,{...p,select:"etape,montant_mensuel_estime,probabilite"});
      const colonnes=await Promise.all(pipeline(resumes).filter(c=>!f.etape || c.etape===f.etape).map(async({lignes,...c})=>{
        const page=await requete(r,{...p,etape:`eq.${c.etape}`,select:"id,compte_id,titre,etape,montant_mensuel_estime,probabilite,proprietaire_email,date_visee,motif_perte,version",limit:30,offset:(f.page-1)*30});
        return {...c,nombre:lignes.length,lignes:await nommer(page.lignes),page:f.page};
      }));
      return {colonnes,total:resumes.length,page:f.page,limite:30};
    }
    if (r !== "comptes") {
      const resultat = await requete(r, p);
      resultat.total ??= resultat.lignes.length;
      if (["contacts", "activites", "opportunites"].includes(r)) {
        resultat.lignes = await nommer(resultat.lignes.map(({ crm_comptes, compte_recherche, ...l }) => l)); // eslint-disable-line no-unused-vars
      }
      return { ...resultat, page: f.page, limite: f.vue_tableau ? resultat.total : f.limite };
    }
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
    resultat.lignes = resultat.lignes.map(c => ({ ...c,
      indicateurs:c.periode_fin ? {ca:c.ca,prev:c.prev,profil:c.profil,action:c.action_proposee,marge:c.marge} : null,
      derniere_activite: dates.get(c.id) || null }));
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
    await invalider();
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
    await invalider();
    return rows[0];
  }
  const instantanes = async odooId => {
    if (!Number.isSafeInteger(odooId) || odooId < 0) throw erreurCrm(400, "Compte Odoo invalide.");
    let rows = (await requete("indicateurs", { odoo_id: `eq.${odooId}`, order: "periode_fin.desc", limit: 26,
      select:odooId ? "*" : "odoo_id,periode_fin,calcule_le,indicateurs:donnees->indicateurs,marge:donnees->marge,ca_avec_cout:donnees->ca_avec_cout,marge_taux:donnees->marge_taux",
    })).lignes;
    if(!odooId)rows=rows.map(({odoo_id,periode_fin,calcule_le,indicateurs,marge,ca_avec_cout,marge_taux})=>({odoo_id,periode_fin,calcule_le,donnees:{indicateurs,marge,ca_avec_cout,marge_taux}}));
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
  const importerSuivi=async(lignes,u)=>{
    const n=(await requete('rpc/crm_importer_suivi',{},'POST',{p_lignes:lignes},u,'activites.importer_suivi')).lignes[0]?.creees;
    await invalider();return n;
  };
  return { taches, synthese, donneesImport, importerSuivi, lister, lire, creer, modifier, instantanes, etatSynchro, commencerSynchro, publierIndicateurs, echouerSynchro, synchroniserCompte };
}
