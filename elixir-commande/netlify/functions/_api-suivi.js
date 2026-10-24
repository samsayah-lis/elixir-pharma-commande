// ── API des pharmacies : suivi des commandes (GET /v1/commandes, GET /v1/commandes/{id}) ──
// Commandes du site ET de l'API de LA pharmacie de la clé : elixir_orders par le CIP de la fiche (commandesSite de
// _chat-perimetre.js, état du relais compris), commandes Odoo liées relues avec le domaine de la fiche (suiviCommandesOdoo :
// société 2, fiche commerciale et ses contacts), et, pour une commande passée par l'API, sa ligne api_commandes (référence
// client, délai d'annulation, mise « à vérifier »). Clé de test : commandes réelles + commandes de test (« T… », simulées).
// Les commandes passées par le logiciel d'officine ne sont pas listées en V1.
// États (conception § 10) : recue, en_attente_elixir (+ motif), en_transmission, transmise, en_preparation,
// partiellement_sortie, sortie_entrepot, facturee, non_servie, annulee. Jamais « livrée » : la date est celle de la sortie
// d'entrepôt. Jamais de texte libre d'une commande du site (libellés), d'e-mail, de message technique du relais, ni de nom
// de la plomberie interne : « commandes_elixir » = numéros de nos bons de commande (imprimés sur le BL et la facture).
import { commandesSite, suiviCommandesOdoo, REF_SITE } from "./_chat-perimetre.js";
import { isoParis } from "./_api-http.js";

export const ORDRE_SITE = /^1[7-9]\d{11}$/;
export const ORDRE_TEST = /^T1[7-9]\d{11}$/;
const RANG = { en_preparation: 1, partiellement_sortie: 2, sortie_entrepot: 3, facturee: 4 };
const lireJson = (t, d) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return d; } };
const creeLe = (id, date) => isoParis(date || (ORDRE_SITE.test(String(id)) ? new Date(Number(id)) : null));

// état global de plusieurs commandes Odoo (une commande du site peut être coupée en deux, P2…) : la moins avancée des
// commandes vivantes ; « non servie » seulement si toutes le sont ; « annulée » si toutes le sont
export function etatDepuisOdoo(codes) {
  const vivants = (codes || []).filter(c => c !== "annulee");
  if (!vivants.length) return codes?.length ? "annulee" : null;
  const servis = vivants.filter(c => c !== "non_servie");
  if (!servis.length) return "non_servie";
  return servis.sort((a, b) => (RANG[a] || 0) - (RANG[b] || 0))[0];
}
// état d'une commande du site (etatSite de _chat-perimetre.js) → { etat, motif }
const DEPUIS_SITE = {
  recue: { etat: "recue", motif: null }, en_transmission: { etat: "en_transmission", motif: null }, transmise: { etat: "transmise", motif: null },
  a_verifier: { etat: "en_attente_elixir", motif: "verification" }, non_verifiee: { etat: "en_attente_elixir", motif: "verification" },
  campagne: { etat: "en_attente_elixir", motif: "campagne" }, justificatif: { etat: "en_attente_elixir", motif: "justificatif" },
};
// ligne api_commandes (phase commande) qui prime sur le site tant que rien n'est parti : annulée, toutes lignes en rupture
// (non servie), gardée « à vérifier », reçue dans son délai d'annulation. Dès qu'une ligne part (relais en cours, transmise,
// dans Odoo), l'état du site, du relais et d'Odoo l'emporte (une commande « à vérifier » validée par Elixir avance ainsi).
const PARTIE = new Set(["en_transmission", "transmise", "dans_odoo"]);
function etatApi(row, now, site = null) {
  if (!row) return null;
  if (row.etat === "annulee") return { etat: "annulee", motif: row.motif || null };
  if (row.etat === "non_servie") return { etat: "non_servie", motif: row.motif || "rupture" };
  if (PARTIE.has(site?.etat)) return null;
  if (row.etat === "a_verifier") return { etat: "en_attente_elixir", motif: row.motif || "anomalie" };
  if (row.etat === "recue" && row.envoi_apres && Date.parse(row.envoi_apres) > now.getTime()) return { etat: "recue", motif: null, annulable_jusqu_a: isoParis(row.envoi_apres) };
  if (row.etat === "en_cours" || row.etat === "recue") return { etat: "recue", motif: null };
  if (row.etat === "envoi_demande") return { etat: "en_transmission", motif: null };
  return null;
}
// commande de test (« T… », jamais dans elixir_orders) : état simulé (conception § 9) — reçue pendant le délai d'annulation,
// puis transmise, puis sortie de l'entrepôt 10 min plus tard
export function etatTest(row, now) {
  const fin = row.envoi_apres ? Date.parse(row.envoi_apres) : Date.parse(row.recu_le);
  if (row.etat === "annulee") return { etat: "annulee", motif: row.motif || null };
  if (row.etat === "a_verifier") return { etat: "en_attente_elixir", motif: row.motif || "anomalie" };
  if (row.etat === "en_cours") return { etat: "recue", motif: null };
  if (now.getTime() < fin) return { etat: "recue", motif: null, annulable_jusqu_a: isoParis(fin) };
  return now.getTime() < fin + 10 * 60e3 ? { etat: "transmise", motif: null } : { etat: "sortie_entrepot", motif: null };
}
function etatSiteApi(site, codesOdoo, row, now) {
  const a = etatApi(row, now, site);
  if (a) return a;
  if (site?.etat === "dans_odoo") return { etat: etatDepuisOdoo(codesOdoo) || "transmise", motif: null };
  return DEPUIS_SITE[site?.etat] || { etat: "recue", motif: null };
}
// lignes de la commande du site (CIP de la fiche) pour l'état des lignes d'une commande de l'API
async function lignesSite(stock, id, cip) {
  if (!/^\d{7,13}$/.test(String(cip || ""))) return [];
  const [o] = (await stock.sbLecture(`elixir_orders?id=eq.${id}&pharmacy_cip=eq.${encodeURIComponent(cip)}&select=items&limit=1`)) || [];
  const its = lireJson(o?.items, []);
  return Array.isArray(its) ? its : [];
}
// état d'une ligne acceptée : annulée (pharmacie), rupture (retirée à l'envoi), traitée par Elixir sans envoi ; sinon inchangé
function etatLigne(l, items, row) {
  if (l.etat !== "acceptee") return {};
  const it = items.find(x => x && Number(x.ligne_api) === Number(l.ligne)) || items.find(x => x && String(x.cip) === String(l.cip));
  if (!it?.handled_at || it.synced_at) return row?.etat === "annulee" ? { etat: "annulee", motif: "annulee_par_la_pharmacie" } : {};
  if (it.api_motif === "annulee") return { etat: "annulee", motif: "annulee_par_la_pharmacie" };
  if (it.api_motif === "rupture") return { etat: "rupture", motif: "rupture", detail: "En rupture au moment de l'envoi : ligne retirée." };
  return { etat: "traitee_par_elixir", motif: null };
}
// lignes de la réponse rendue par l'API à la création (preuve, rejouée à l'identique) — forme de la phase commande
const lignesReponse = (row) => { const r = lireJson(row?.reponse, null); return Array.isArray(r?.lignes) ? r : null; };

// résumé d'une commande (liste)
function resume({ id, environnement, canal, row, site, codes, numeros, now, date }) {
  const e = canal === "test" ? etatTest(row, now) : etatSiteApi(site, codes, row, now);
  const rep = lignesReponse(row);
  return { id, environnement, canal: canal === "test" ? "api" : canal, reference_client: row?.reference_client || null, etat: e.etat, motif: e.motif || null,
    cree_le: canal === "test" ? isoParis(row.recu_le) : creeLe(id, date), annulable_jusqu_a: e.annulable_jusqu_a || null,
    lignes: rep ? rep.lignes.filter(l => l.etat === undefined || (l.etat === "acceptee" && l.quantite !== 0)).length : site?.lignes ?? 0, commandes_elixir: numeros || [] };
}

// GET /v1/commandes : page des commandes de la période (les plus récentes d'abord) → { donnees, suivante }
// ctx : { odooId, cip } (fiche de la clé) ; stock : _api-stock.js ; deps : { odoo, sb } (lectures) ; environnement : live | test
export async function listerCommandesApi(ctx, { debutIso, finIso, page, parPage, environnement, now }, stock, deps) {
  const offset = (page - 1) * parPage;
  let entrees;
  if (environnement === "test") {
    const [site, tests] = await Promise.all([stock.site.numeros(ctx.cip, { debutIso, finIso, offset: 0, limite: offset + parPage + 1 }),
      stock.commandes.deFiche(ctx.odooId, { test: true, depuisIso: debutIso, jusquaIso: finIso, limite: Math.min(500, offset + parPage + 1) })]);
    entrees = [...site.map(s => ({ id: String(s.id), date: s.date, canal: "site" })),
      ...tests.filter(r => ORDRE_TEST.test(String(r.order_id))).map(r => ({ id: String(r.order_id), date: r.recu_le, canal: "test", row: r }))]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(offset, offset + parPage + 1);
  } else {
    entrees = (await stock.site.numeros(ctx.cip, { debutIso, finIso, offset, limite: parPage + 1 })).map(s => ({ id: String(s.id), date: s.date, canal: "site" }));
  }
  const suivante = entrees.length > parPage;
  entrees = entrees.slice(0, parPage);
  const idsSite = entrees.filter(e => e.canal === "site").map(e => e.id);
  // commandes de l'API de la fiche d'abord : elles sont « vérifiées » sans e-mail de compte (rattachées par api_commandes)
  const rowsApi = idsSite.length ? await stock.commandes.parOrdres(ctx.odooId, idsSite) : [];
  const verifiees = new Set(rowsApi.filter(r => !r.test).map(r => String(r.order_id)));
  const sites = idsSite.length ? await commandesSite(ctx, { numeros: idsSite, verifiees }, deps) : [];
  const parSite = new Map(sites.map(s => [String(s.reference_site), s]));
  const parApi = new Map(rowsApi.filter(r => !r.test).map(r => [String(r.order_id), r]));
  const suivi = await suiviCommandesOdoo(ctx, sites.flatMap(s => s.ids_odoo || []), {}, deps);
  const parSo = new Map(suivi.commandes.map(c => [c.id, c]));
  const donnees = entrees.map(e => {
    if (e.canal === "test") return resume({ id: e.id, environnement: "test", canal: "test", row: e.row, now });
    const s = parSite.get(e.id);
    const sos = (s?.ids_odoo || []).map(i => parSo.get(i)).filter(Boolean);
    const row = parApi.get(e.id) || null;
    return resume({ id: e.id, environnement: "live", canal: row ? "api" : "site", row, site: s, codes: sos.map(x => x.etat), numeros: sos.map(x => x.numero), now, date: e.date });
  });
  return { donnees, suivante };
}

// GET /v1/commandes/{id} → commande détaillée, ou null (inconnue, ou d'une autre pharmacie : même réponse)
export async function detailCommandeApi(ctx, id, { environnement, now }, stock, deps) {
  if (ORDRE_TEST.test(id)) {
    if (environnement !== "test") return null;
    const [row] = (await stock.commandes.parOrdres(ctx.odooId, [id])).filter(r => r.test && String(r.order_id) === id);
    if (!row) return null;
    const e = etatTest(row, now);
    const rep = lignesReponse(row);
    return { id, environnement: "test", canal: "api", reference_client: row.reference_client || null, etat: e.etat, motif: e.motif || null,
      cree_le: isoParis(row.recu_le), annulable_jusqu_a: e.annulable_jusqu_a || null, total_indicatif_ht: rep?.total_indicatif_ht ?? null,
      commandes_elixir: [], lignes: (rep?.lignes || []).map(l => ({ ...l, ...(row.etat === "annulee" && l.etat === "acceptee" ? { etat: "annulee", motif: "annulee_par_la_pharmacie" } : {}), suivi: null })) };
  }
  if (!ORDRE_SITE.test(id)) return null;
  const rowsApi = await stock.commandes.parOrdres(ctx.odooId, [id]);
  const row = rowsApi.find(r => !r.test && String(r.order_id) === id) || null;
  const [site] = await commandesSite(ctx, { id, noms: true, lignesMax: 200, verifiees: new Set(row ? [id] : []) }, deps);
  if (!site) return null;
  const suivi = await suiviCommandesOdoo(ctx, site.ids_odoo || [], { detail: true }, deps);
  // lignes Odoo de CETTE commande (une commande Odoo peut regrouper plusieurs commandes du site ou du logiciel)
  const miennes = suivi.lignes.filter(l => REF_SITE.exec(l.ref)?.[1] === id);
  const parCip = new Map();
  for (const l of miennes) {
    const k = l.cip || `?${l.produit}`;
    const a = parCip.get(k) || { cip: l.cip, nom: l.produit, commandee: 0, acceptee: 0, servie: 0, non_servie: 0, a_livrer: 0, facturee: 0 };
    for (const c of ["commandee", "acceptee", "servie", "non_servie", "a_livrer", "facturee"]) a[c] += Number(l[c]) || 0;
    parCip.set(k, a);
  }
  const suiviDe = (cip) => { const a = parCip.get(cip); if (!a) return null; parCip.delete(cip); const { cip: _c, nom: _n, ...q } = a; return q; };
  const rep = lignesReponse(row);
  // commande de l'API : état de chaque ligne depuis la commande du site (rupture retirée à l'envoi, annulation, ligne traitée
  // sans envoi par Elixir) ; la réponse d'origine reste celle rendue à la création (rejouée à l'identique)
  const items = rep ? await lignesSite(stock, id, ctx.cip) : [];
  const lignes = rep
    ? rep.lignes.map(l => ({ ...l, ...etatLigne(l, items, row), suivi: suiviDe(l.cip) }))
    : (site.produits || []).map(p => ({ cip: p.cip, nom: p.produit || null, quantite_demandee: p.commande, suivi: suiviDe(p.cip) }));
  // lignes servies sous un autre CIP (article multi-CIP réparti à l'envoi) : rendues à part
  for (const a of parCip.values()) { const { cip, nom, ...q } = a; lignes.push({ cip: cip || null, nom: nom || null, quantite_demandee: null, suivi: q }); }
  const e = etatSiteApi(site, suivi.commandes.map(c => c.etat), row, now);
  return { id, environnement: "live", canal: row ? "api" : "site", reference_client: row?.reference_client || null, etat: e.etat, motif: e.motif || null,
    cree_le: creeLe(id), annulable_jusqu_a: e.annulable_jusqu_a || null, total_indicatif_ht: rep?.total_indicatif_ht ?? null,
    commandes_elixir: suivi.commandes.map(c => ({ numero: c.numero, etat: c.etat, sortie_le: isoParis(c.sortie_le), factures: c.factures, avoirs: c.avoirs,
      livraisons: (c.livraisons || []).map(l => ({ id: l.id, numero: l.numero, sortie_le: isoParis(l.sortie_le) })) })),
    lignes };
}
