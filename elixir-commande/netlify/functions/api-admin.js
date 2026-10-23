// ── API des pharmacies : onglet admin « 🔌 API » (src/components/AdminApi.jsx), verifyAdmin sur toutes les routes ──
// GET  ?vue=tableau                 → { reglages, updated_at, prerequis, ouvrable, commandes_production, acces: [...],
//                                       defauts, bornes, portees, libelles_portees, cgu_version, version_api }
// GET  ?vue=acces&odoo_id=          → { acces, cles: [... sans secret, usage_24h], evenements }
// GET  ?vue=journal[&odoo_id=][&cle_id=][&erreurs=1] → { lignes: 500 dernières requêtes (jamais de corps) }
// POST { action: "reglages", actif?, commandes_live?, base }   → { ok, updated_at } | 409 (conflit, prérequis manquants)
// POST { action: "prerequis", id, fait, note?, base }          → { ok, updated_at } (décocher referme les commandes réelles)
// POST { action: "tout_couper" }                               → { ok } (API suspendue ET commandes réelles fermées)
// POST { action: "ouvrir_acces", odoo_id, ...réglages }        → { acces } (fiche revérifiée dans Odoo : cliente, CIP présent)
// POST { action: "modifier_acces", odoo_id, champs }           → { acces }
// POST { action: "suspendre_acces", odoo_id, motif } / { action: "reactiver_acces", odoo_id } → { acces }
// POST { action: "rafraichir_fiche", odoo_id }                 → { acces } (nom, CIP, ville, liste de prix relus dans Odoo)
// POST { action: "revoquer_cle", id, motif }                   → { ok, cle }
// POST { action: "creer_cle_admin", odoo_id, environnement, libelle, portees, motif } → 201 { cle (secret, UNE fois), info }
//      variante tracée pour une pharmacie SANS compte du site (conception § 3.3) : le journal note quel admin l'a vue ;
//      remise de vive voix, jamais par e-mail
// POST { action: "cgu_signees", odoo_id, reference }           → { acces } (acceptation hors ligne : signature, tracée)
// POST { action: "valider_test", odoo_id, motif }              → { acces } (passer outre le parcours de test, tracé)
// Les secrets ne sont jamais lus ni affichés (seule l'empreinte est en base). Hôte d'aperçu : lecture seule.
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { ficheVerifiee } from "./_chat-perimetre.js";
import { validCip } from "./_pharmacies.js";
import { creerStockApi, estUuid } from "./_api-stock.js";
import { cidrValide, clePublique, creerCle, refusCreation } from "./_api-cles.js";
import { ACCES_DEFAUT, BORNES, CGU, LIBELLES_PORTEES, MODES, PORTEES, PREREQUIS, VERSION_API, commandesLiveOuvertes, commandesOuvrables,
  fusionnerReglages, prerequisEtat } from "./_api-config.js";
import { estApercu } from "./_api-http.js";

const json = (cors, statusCode, corps) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(corps) });
const entier = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 1e9 ? n : null; };
const texte = (v, max) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
const ENTIERS = new Set(["delai_annulation_min", "plafond_lignes", "plafond_boites", "plafond_commandes_jour", "anomalie_doublon_min"]);
const LIBELLES = { delai_annulation_min: "Délai d'annulation (min)", plafond_lignes: "Lignes par commande", plafond_boites: "Boîtes par commande",
  plafond_montant_ht: "Montant HT par commande", plafond_commandes_jour: "Commandes par jour", anomalie_facteur: "Facteur d'anomalie",
  anomalie_doublon_min: "Fenêtre de doublon (min)" };

// Champs d'un accès modifiables par l'admin → { champs, erreurs } (bornes : contraintes de sql/api-schema.sql)
export function verifierChampsAcces(entree = {}) {
  const champs = {}, erreurs = [];
  if ("portees" in entree) {
    const p = Array.isArray(entree.portees) ? entree.portees.map(String) : [];
    if (!p.length || p.some(x => !PORTEES.includes(x))) erreurs.push("Droits : « lecture » et/ou « commande ».");
    else champs.portees = PORTEES.filter(x => p.includes(x));
  }
  if ("mode" in entree) { if (MODES.includes(entree.mode)) champs.mode = entree.mode; else erreurs.push("Mode : « auto » ou « bloque »."); }
  for (const [k, [min, max]] of Object.entries(BORNES)) {
    if (!(k in entree)) continue;
    const n = Number(String(entree[k]).replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max || (ENTIERS.has(k) && !Number.isInteger(n))) erreurs.push(`${LIBELLES[k]} : entre ${min} et ${max}${ENTIERS.has(k) ? " (nombre entier)" : ""}.`);
    else champs[k] = ENTIERS.has(k) ? n : Math.round(n * 100) / 100;
  }
  if ("anomalie_active" in entree) champs.anomalie_active = entree.anomalie_active === true;
  if ("ip_autorisees" in entree) {
    const brut = Array.isArray(entree.ip_autorisees) ? entree.ip_autorisees : String(entree.ip_autorisees ?? "").split(/[\s,;]+/);
    const liste = brut.map(x => String(x).trim()).filter(Boolean);
    const lus = liste.map(cidrValide);
    if (liste.length > 20) erreurs.push("Réseaux autorisés : 20 au plus.");
    else if (lus.some(x => !x)) erreurs.push(`Réseau illisible : ${liste.filter((x, i) => !lus[i]).slice(0, 3).join(", ")} (ex. 203.0.113.10 ou 203.0.113.0/24).`);
    else champs.ip_autorisees = lus.length ? [...new Set(lus)] : null;
  }
  if ("note" in entree) champs.note = texte(entree.note, 500);
  return { champs, erreurs };
}

// liste de prix de la fiche (société 2) : id, ou null si illisible (affichage seulement en phase 1)
async function listePrixOdoo(odooId) {
  const [p] = await odoo("res.partner", "search_read", [[["id", "=", odooId]]], { fields: ["property_product_pricelist"], limit: 1,
    context: { allowed_company_ids: [COMPANY_ID], active_test: false } }, { timeoutMs: 6000 });
  const v = p?.property_product_pricelist;
  return Array.isArray(v) && Number.isInteger(v[0]) ? v[0] : null;
}

// deps (doublures des tests) : stock, verifierAdmin(event), verifierFiche(odooId), listePrix(odooId), maintenant, journal, octets
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockApi());
  const maintenant = deps.maintenant || (() => new Date());
  const verifierFiche = deps.verifierFiche || ((id) => ficheVerifiee(id));
  const listePrix = deps.listePrix || listePrixOdoo;
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-admin", ...o })));

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    const { admin, error } = await (deps.verifierAdmin || verifyAdmin)(event);
    if (error) return { ...error, headers: { ...cors, ...(error.headers || {}), "Cache-Control": "no-store" } };
    const par = String(admin?.email || "admin").toLowerCase();
    const stock = stockDe();
    const now = maintenant();
    const evenement = (type, odooId, detail, cleId = null) => stock.evenements.ajouter({ type, odoo_id: odooId, cle_id: cleId, par, role: "admin", detail })
      .catch((e) => journal({ code: "evenement", type, erreur: String(e?.message || e).slice(0, 80) }));
    // fiche Odoo revérifiée : cliente d'Elixir (société 2 ou partagée qui achète), active, avec un CIP → { p } | { refus }
    const ficheOk = async (id) => {
      let p;
      try { p = await verifierFiche(id); } catch { return { refus: json(cors, 503, { error: "Odoo ne répond pas : réessayez dans un instant." }) }; }
      if (!p) return { refus: json(cors, 409, { error: "Fiche introuvable, archivée, ou non cliente d'Elixir (société 2 ou fiche partagée qui commande)." }) };
      if (!validCip(p.cip)) return { refus: json(cors, 409, { error: "Fiche sans CIP (client bloqué) : accès impossible." }) };
      return { p };
    };
    const infosFiche = async (p) => {
      const liste = await listePrix(p.id).catch((e) => { journal({ code: "liste_prix", erreur: String(e?.message || e).slice(0, 80) }); return null; });
      return { nom: texte(p.name, 200), cip: String(p.cip).trim(), ville: texte(p.city, 100), liste_prix_id: liste, liste_prix_lue_le: liste ? now.toISOString() : null };
    };

    try {
      if (event.httpMethod === "GET") {
        const q = event.queryStringParameters || {};
        switch (q.vue) {
          case "tableau": {
            const [lu, acces, cles] = await Promise.all([stock.reglages.lire(), stock.acces.lister(), stock.cles.toutes()]);
            const parFiche = new Map();
            for (const c of cles) (parFiche.get(c.odoo_id) || parFiche.set(c.odoo_id, []).get(c.odoo_id)).push(c);
            return json(cors, 200, {
              reglages: fusionnerReglages(lu.valeur), updated_at: lu.updated_at, prerequis: prerequisEtat(lu.valeur, now),
              ouvrable: commandesOuvrables(lu.valeur, now), commandes_production: commandesLiveOuvertes(lu.valeur, now) ? "ouvertes" : "fermees",
              acces: acces.map(a => {
                const siennes = (parFiche.get(a.odoo_id) || []).map(c => clePublique(c, now));
                const actives = (env) => siennes.filter(c => c.environnement === env && ["active", "remplacee"].includes(c.etat)).length;
                const derniere = siennes.map(c => c.derniere_utilisation).filter(Boolean).sort().pop() || null;
                return { ...a, cgu_preuve: undefined, cgu_a_jour: a.cgu_version === CGU.version, cles_actives: { live: actives("live"), test: actives("test") }, derniere_utilisation: derniere };
              }),
              defauts: ACCES_DEFAUT, bornes: BORNES, portees: PORTEES, libelles_portees: LIBELLES_PORTEES, cgu_version: CGU.version, version_api: VERSION_API,
            });
          }
          case "acces": {
            const id = entier(q.odoo_id);
            const a = id && await stock.acces.lire(id);
            if (!a) return json(cors, 404, { error: "Accès introuvable" });
            const [cles, lignes, evenements] = await Promise.all([stock.cles.deFiche(id),
              stock.journal.lister({ odooId: id, depuisIso: new Date(now.getTime() - 86400e3).toISOString(), limite: 5000 }), stock.evenements.lister(id, 100)]);
            const usage = new Map();
            for (const l of lignes) { const u = usage.get(l.cle_id) || usage.set(l.cle_id, { requetes: 0, erreurs: 0 }).get(l.cle_id); u.requetes++; if (l.statut >= 400) u.erreurs++; }
            let preuve = null;
            try { preuve = a.cgu_preuve ? JSON.parse(a.cgu_preuve) : null; } catch { /* illisible */ }
            return json(cors, 200, { acces: { ...a, cgu_preuve: preuve, cgu_a_jour: a.cgu_version === CGU.version },
              cles: cles.map(c => ({ ...clePublique(c, now, { admin: true }), usage_24h: usage.get(c.id) || { requetes: 0, erreurs: 0 } })), evenements });
          }
          case "journal": {
            const [lignes, cles] = await Promise.all([stock.journal.lister({ odooId: entier(q.odoo_id), cleId: estUuid(q.cle_id) ? q.cle_id : null,
              erreurs: q.erreurs === "1", limite: 500 }), stock.cles.toutes()]);
            const prefixe = new Map(cles.map(c => [c.id, c.prefixe]));
            return json(cors, 200, { lignes: lignes.map(l => ({ ...l, cle: prefixe.get(l.cle_id) || null })) });
          }
          default: return json(cors, 400, { error: "Vue inconnue" });
        }
      }

      if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
      if (estApercu(event)) return json(cors, 409, { error: "Aperçu : aucune modification n'est enregistrée ici." });
      let b;
      try { b = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "Requête illisible" }); }

      // ── réglages ──
      if (["reglages", "prerequis", "tout_couper"].includes(b.action)) {
        const lu = await stock.reglages.lire();
        if (b.action !== "tout_couper" && b.base && b.base !== lu.updated_at) return json(cors, 409, { conflit: true, error: "Réglages modifiés entre-temps : actualisez l'onglet." });
        const v = fusionnerReglages(lu.valeur);
        let detail;
        if (b.action === "tout_couper") { v.actif = false; v.commandes_live = false; detail = { actif: false, commandes_live: false }; }
        else if (b.action === "reglages") {
          if ("actif" in b) v.actif = b.actif === true;
          if ("commandes_live" in b) {
            if (b.commandes_live === true) {
              const o = commandesOuvrables(v, now);
              if (!o.ok) return json(cors, 409, { error: `Commandes par API : prérequis non remplis (${o.manquants.join(", ")}).`, manquants: o.manquants });
            }
            v.commandes_live = b.commandes_live === true;
          }
          detail = { actif: v.actif, commandes_live: v.commandes_live };
        } else {
          const p = PREREQUIS.find(x => x.id === b.id);
          if (!p) return json(cors, 400, { error: "Prérequis inconnu" });
          const fait = b.fait === true;
          if (fait && !prerequisEtat(v, now).find(x => x.id === p.id).cochable) return json(cors, 409, { error: `${p.id} : ne peut pas être coché avant le ${p.pas_avant.split("-").reverse().join("/")}.` });
          v.prerequis[p.id] = { fait, le: now.toISOString(), par, note: texte(b.note, 300) };
          if (!fait) v.commandes_live = false;   // une case décochée referme les commandes réelles
          detail = { id: p.id, fait, note: v.prerequis[p.id].note, commandes_live: v.commandes_live };
        }
        const res = await stock.reglages.ecrire(v, b.action === "tout_couper" ? null : lu.updated_at);
        if (res.conflit) return json(cors, 409, { conflit: true, error: "Réglages modifiés entre-temps : actualisez l'onglet." });
        await evenement(b.action, null, detail);
        return json(cors, 200, { ok: true, updated_at: res.updated_at });
      }

      const id = entier(b.odoo_id);
      switch (b.action) {
        case "ouvrir_acces": {
          if (!id) return json(cors, 400, { error: "Fiche manquante" });
          if (await stock.acces.lire(id)) return json(cors, 409, { error: "Un accès existe déjà pour cette fiche : modifiez-le ou réactivez-le." });
          const { champs, erreurs } = verifierChampsAcces({ ...ACCES_DEFAUT, ...Object.fromEntries(Object.entries(b).filter(([k]) => k in ACCES_DEFAUT || k === "note" || k === "ip_autorisees")) });
          if (erreurs.length) return json(cors, 400, { error: erreurs.join(" "), erreurs });
          const f = await ficheOk(id);
          if (f.refus) return f.refus;
          const a = await stock.acces.creer({ odoo_id: id, ...(await infosFiche(f.p)), ...champs, actif: true, ouvert_par: par });
          if (!a) return json(cors, 409, { error: "Un accès existe déjà pour cette fiche." });
          await evenement("acces_ouvert", id, { portees: a.portees, mode: a.mode });
          return json(cors, 200, { acces: a });
        }
        case "modifier_acces": {
          if (!id || !(await stock.acces.lire(id))) return json(cors, 404, { error: "Accès introuvable" });
          const { champs, erreurs } = verifierChampsAcces(b.champs || {});
          if (erreurs.length) return json(cors, 400, { error: erreurs.join(" "), erreurs });
          if (!Object.keys(champs).length) return json(cors, 400, { error: "Rien à modifier" });
          const a = await stock.acces.modifier(id, champs);
          await evenement("acces_modifie", id, champs);
          return json(cors, 200, { acces: a });
        }
        case "suspendre_acces": {
          const motif = texte(b.motif, 300);
          if (!motif) return json(cors, 400, { error: "Motif obligatoire" });
          if (!id || !(await stock.acces.lire(id))) return json(cors, 404, { error: "Accès introuvable" });
          const a = await stock.acces.modifier(id, { actif: false, suspendu_le: now.toISOString(), suspendu_par: par, motif_suspension: motif });
          await evenement("acces_suspendu", id, { motif });
          return json(cors, 200, { acces: a });
        }
        case "reactiver_acces": case "rafraichir_fiche": {
          if (!id || !(await stock.acces.lire(id))) return json(cors, 404, { error: "Accès introuvable" });
          const f = await ficheOk(id);
          if (f.refus) return f.refus;
          const a = await stock.acces.modifier(id, { ...(await infosFiche(f.p)),
            ...(b.action === "reactiver_acces" ? { actif: true, suspendu_le: null, suspendu_par: null, motif_suspension: null } : {}) });
          await evenement(b.action === "reactiver_acces" ? "acces_reactive" : "fiche_rafraichie", id, { liste_prix_id: a?.liste_prix_id ?? null });
          return json(cors, 200, { acces: a });
        }
        case "revoquer_cle": {
          const motif = texte(b.motif, 300);
          if (!motif) return json(cors, 400, { error: "Motif obligatoire" });
          const c = await stock.cles.lireAdmin(b.id);
          if (!c) return json(cors, 404, { error: "Clé introuvable" });
          const r = await stock.cles.revoquer(c.id, c.odoo_id, { par, motif });
          if (!r) return json(cors, 409, { error: "Clé déjà révoquée" });
          await evenement("cle_revoquee", c.odoo_id, { motif, prefixe: r.prefixe }, r.id);
          return json(cors, 200, { ok: true, cle: clePublique(r, now, { admin: true }) });
        }
        case "creer_cle_admin": {
          const motif = texte(b.motif, 300);
          if (!motif || motif.length < 5) return json(cors, 400, { error: "Motif obligatoire (ex. « pharmacie sans compte du site »)" });
          const a = id && await stock.acces.lire(id);
          if (!a) return json(cors, 404, { error: "Accès introuvable" });
          const environnement = ["live", "test"].includes(b.environnement) ? b.environnement : null;
          const portees = Array.isArray(b.portees) ? [...new Set(b.portees.map(String))] : [];
          const refus = refusCreation({ acces: a, cles: await stock.cles.deFiche(id), environnement, libelle: b.libelle, portees, maintenant: now });
          if (refus) return json(cors, 409, { error: refus.message, code: refus.code });
          const res = await creerCle(stock, { acces: a, environnement, libelle: b.libelle, portees, par, role: "admin", maintenant: now, octets: deps.octets });
          await evenement("cle_creee_admin", id, { environnement, libelle: res.cle.libelle, portees: res.cle.portees, prefixe: res.cle.prefixe, motif, vue_par: par }, res.cle.id);
          return json(cors, 201, { cle: res.secret, info: res.cle });
        }
        case "cgu_signees": {
          const reference = texte(b.reference, 200);
          if (!reference) return json(cors, 400, { error: "Référence du document signé obligatoire" });
          if (!id || !(await stock.acces.lire(id))) return json(cors, 404, { error: "Accès introuvable" });
          const a = await stock.acces.modifier(id, { cgu_version: CGU.version, cgu_acceptees_le: now.toISOString(), cgu_acceptees_par: par,
            cgu_preuve: JSON.stringify({ mode: "signature", reference, saisie_par: par, le: now.toISOString() }) });
          await evenement("cgu_signees", id, { version: CGU.version, reference });
          return json(cors, 200, { acces: a });
        }
        case "valider_test": {
          const motif = texte(b.motif, 300);
          if (!motif) return json(cors, 400, { error: "Motif obligatoire" });
          if (!id || !(await stock.acces.lire(id))) return json(cors, 404, { error: "Accès introuvable" });
          const a = await stock.acces.modifier(id, { test_valide_le: now.toISOString(), test_valide_par: par });
          await evenement("test_valide_admin", id, { motif });
          return json(cors, 200, { acces: a });
        }
        default: return json(cors, 400, { error: "Action inconnue" });
      }
    } catch (e) {
      journal({ code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      if (e?.code === "schema") return json(cors, 503, { error: "Tables de l'API absentes : exécuter sql/api-schema.sql dans Supabase.", schema: true });
      if (e?.code === "configuration") return json(cors, 503, { error: e.message });
      return json(cors, 500, { error: "Erreur du serveur : réessayez." });
    }
  };
}

export const handler = creerHandler();
