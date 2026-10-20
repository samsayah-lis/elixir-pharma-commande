// ── Accueil « La Tête de gondole » : lectures (Odoo en lecture seule, Supabase) et calcul du classement ──
// Utilisé par accueil-offres-refresh.js (planifié) et accueil-offres.js (GET ; calcul au premier appel sans cache).
// Dépendances injectables (scripts/test-accueil.mjs : aucune lecture réelle). Aucune écriture Odoo ; dans Supabase,
// seulement kv_store « accueil:offres », « accueil:dernier_passage », « accueil:outils » (mises en avant d'outils,
// _accueil-outils.js) et le verrou « accueil:verrou ».
import { odoo as odooReel, COMPANY_ID } from "./_odoo-rpc.js";
import { quotaProducts as quotasReels } from "./_quota.js";
import { sb as sbReel, kvGet as kvGetReel, kvSet as kvSetReel, lireConfig, indexProduits, avecVerrou } from "./_lab-justif.js";
import { verifierJeton } from "./auth.js";
import { TOP_ODOO, VERSION, contexteMenus, dateOdoo, depuisOdoo, fenetre, jourParis, normaliser, selectionner } from "./_accueil-selection.js";
import { labosDeConfig } from "./_accueil-outils.js";

export const CLE_CACHE = "accueil:offres";
export const CLE_JOURNAL = "accueil:dernier_passage";
export const CLE_VERROU = "accueil:verrou";
export const CLE_ECHEC = "accueil:echec";   // dernier calcul au premier appel en échec (ou vide) : { at }
const CTX = { allowed_company_ids: [COMPANY_ID], lang: "fr_FR" };
const enc = encodeURIComponent;
const liste = (arr) => `(${arr.map(v => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;
const parse = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return null; } };

// deps : { odoo, sb, compter, quotaProducts, justifs, labosJustif, kvGet, kvSet, verrou, verifierJeton, maintenant } (tout est facultatif)
// delaiOdoo : délai maximal de chaque appel Odoo réel (ms ; 0 = aucun) — GET : court, la fonction entière est plafonnée
// à 10 s par Netlify ; planifiée : une erreur (journal écrit) plutôt qu'un arrêt muet à 30 s
export function creerSources(deps = {}, { delaiOdoo = 0 } = {}) {
  // configuration des justificatifs (kv « lj:config ») lue une fois par appel : justifs et labosJustif la partagent
  let configP = null;
  const config = () => (configP ||= lireConfig());
  return {
    odoo: deps.odoo || (delaiOdoo > 0 ? (m, me, a, k) => odooReel(m, me, a, k, { timeoutMs: delaiOdoo }) : odooReel),
    sb: deps.sb || sbReel,
    // nombre de lignes d'une lecture Supabase (Prefer: count=exact, Range: 0-0 → content-range « 0-0/27871 »)
    compter: deps.compter || compterReel,
    quotaProducts: deps.quotaProducts || quotasReels,
    // CIP sur justificatif labo (tous les labos, comme lab-justif?action=products)
    justifs: deps.justifs || (async () => new Set(Object.keys(indexProduits(await config())))),
    // laboratoires sur justificatif montrés sur le site (site !== false) : [{ nom, medicaments, presentations }]
    labosJustif: deps.labosJustif || (async () => labosDeConfig(await config())),
    kvGet: deps.kvGet || kvGetReel,
    kvSet: deps.kvSet || kvSetReel,
    verrou: deps.verrou || ((fn) => avecVerrou(fn, 60e3, CLE_VERROU)),
    verifierJeton: deps.verifierJeton || verifierJeton,
    maintenant: deps.maintenant || (() => Date.now()),
  };
}

async function compterReel(chemin) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${chemin}`, { headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
    Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok && r.status !== 206) throw new Error(`Supabase ${chemin.split("?")[0]} : HTTP ${r.status}`);
  const n = parseInt(String(r.headers.get("content-range") || "").split("/")[1], 10);
  if (!Number.isFinite(n)) throw new Error(`Supabase ${chemin.split("?")[0]} : compte illisible`);
  return n;
}

// ── Supabase : configuration de l'accueil en une requête (menus, menus promo, mises en avant de Zineb) ──
// → { displayConfig, promos, vedettes: { valeur, maj } } ; table illisible → valeurs vides (la page garde son repli)
export async function lireConfigAccueil(src) {
  const rows = await src.sb(`ec_config?key=in.${enc(liste(["display_config", "admin_promos", "accueil_vedettes"]))}&select=key,value,updated_at`).catch(() => []);
  const ligne = (k) => (rows || []).find(r => r.key === k);
  const promos = parse(ligne("admin_promos")?.value);
  return { displayConfig: parse(ligne("display_config")?.value) || {}, promos: Array.isArray(promos) ? promos : [],
    vedettes: { valeur: parse(ligne("accueil_vedettes")?.value), maj: ligne("accueil_vedettes")?.updated_at || null } };
}

// ── Supabase : catalogue, produits curatés, configuration, campagnes ──
// conf : configuration déjà lue (lireConfigAccueil, GET : lue en parallèle du cache), sinon lue ici
export async function lireContexte(src, cips, conf = null) {
  const catalogue = {}, curees = [];
  for (let i = 0; i < cips.length; i += 150) {
    const lot = enc(liste(cips.slice(i, i + 150)));
    const [cat, cur] = await Promise.all([
      src.sb(`odoo_catalog?cip=in.${lot}&select=cip,name,list_price,discounted_price,discount_pct,price_tiers,in_stock,available`),
      src.sb(`elixir_products?active=eq.true&cip=in.${lot}&select=*`),
    ]);
    for (const r of cat || []) catalogue[r.cip] = r;
    curees.push(...(cur || []));
  }
  const [c, campagnes] = await Promise.all([
    conf || lireConfigAccueil(src),
    src.sb("elixir_campaigns?active=eq.true&select=id,active").catch(() => []),
  ]);
  const menus = contexteMenus({ displayConfig: c.displayConfig || {}, promos: c.promos || [], campagnes });
  return { catalogue, curees, menus, promos: c.promos || [] };
}

// ── Odoo : commandes SERVIES (au moins une boîte acceptée), société Elixir, état « sale » ──
const domaine = (du, au, pids) => [["company_id", "=", COMPANY_ID], ["state", "=", "sale"], ["order_id.date_order", ">=", dateOdoo(du)],
  ...(au ? [["order_id.date_order", "<", dateOdoo(au)]] : []), ["display_type", "=", false], ["product_uom_qty", ">", 0],
  ...(pids ? [["product_id", "in", pids]] : [])];
const idDe = (m2o) => (Array.isArray(m2o) ? m2o[0] : m2o) || null;
const cipDe = (p) => [p.default_code, p.barcode].map(x => String(x || "").trim()).find(x => /^\d{13}$/.test(x)) || null;

// → cache interne { version, genere_le, periode, slides, reserves } + journal (motifs d'exclusion, hors cache)
export async function calculerClassement(src) {
  const t0 = src.maintenant();
  const f = fenetre(t0);
  // 1. classement de tous les produits (≈ 0,7 s mesuré) : commandes distinctes, pharmacies distinctes, quantité servie
  const groupes = await src.odoo("sale.order.line", "read_group",
    [domaine(f.depuis), ["order_id:count_distinct", "order_partner_id:count_distinct", "product_uom_qty:sum"], ["product_id"]],
    { lazy: false, orderby: "order_id desc", limit: TOP_ODOO, context: CTX });
  const classement = (groupes || []).map(g => ({ pid: idDe(g.product_id), cmd: Number(g.order_id) || 0, ph: Number(g.order_partner_id) || 0, qte: Number(g.product_uom_qty) || 0 }))
    .filter(c => c.pid);
  if (!classement.length) throw new Error("classement Odoo vide");
  const pids = classement.map(c => c.pid);
  // 2. fiches produit (CIP, nom français, laboratoire, stupéfiant, actif, vendable)
  const prods = await src.odoo("product.product", "read", [pids],
    { fields: ["default_code", "barcode", "name", "manufacturer_id", "stup", "active", "sale_ok"], context: { ...CTX, active_test: false } });
  const fiches = {};
  for (const p of prods || []) fiches[p.id] = { cip: cipDe(p), nom: p.name || "", labo: Array.isArray(p.manufacturer_id) ? p.manufacturer_id[1] : null,
    laboId: idDe(p.manufacturer_id), stup: !!p.stup, active: p.active !== false, sale_ok: p.sale_ok !== false };
  // 3. période précédente (tendance, « nouveau »), contingentés, justificatifs, données du site
  const cips = [...new Set(Object.values(fiches).map(x => x.cip).filter(Boolean))];
  const [prec, quotas, justifs, ctx] = await Promise.all([
    src.odoo("sale.order.line", "read_group", [domaine(f.avant, f.depuis, pids), ["order_id:count_distinct"], ["product_id"]], { lazy: false, context: CTX }),
    src.quotaProducts(),
    src.justifs(),
    lireContexte(src, cips),
  ]);
  const precedent = {};
  for (const g of prec || []) precedent[idDe(g.product_id)] = Number(g.order_id) || 0;
  const qset = new Set();
  for (const q of quotas || []) { if (q.product_id) qset.add(q.product_id); if (q.cip) qset.add(q.cip); if (q.barcode) qset.add(q.barcode); }
  const sel = selectionner({ classement, precedent, fiches, catalogue: ctx.catalogue, curees: ctx.curees, menus: ctx.menus, quotas: qset, justifs: justifs || new Set() });
  // 4. courbe : commandes servies par jour (Paris) des produits en tête de diapositive
  const tetes = [...sel.slides, ...sel.reserves].map(d => d._pid).filter(Boolean);
  const series = await seriesJournalieres(src, tetes, f);
  for (const d of [...sel.slides, ...sel.reserves]) d.serie_15j = normaliser(series[d._pid] || f.jours.map(() => 0));
  return {
    cache: { version: VERSION, genere_le: new Date(t0).toISOString(), periode: { du: f.jours[0], au: f.jours[14], jours: f.jours }, slides: sel.slides, reserves: sel.reserves },
    journal: sel.journal,
  };
}

// commandes distinctes par jour (heure de Paris) : lignes servies des produits, puis date de leurs commandes
async function seriesJournalieres(src, pids, f) {
  if (!pids.length) return {};
  const lignes = [];
  for (let offset = 0; ; offset += 5000) {
    const page = await src.odoo("sale.order.line", "search_read", [domaine(f.depuis, null, pids)], { fields: ["product_id", "order_id"], limit: 5000, offset, order: "id", context: CTX });
    lignes.push(...(page || []));
    if (!page || page.length < 5000 || offset > 40000) break;
  }
  const ids = [...new Set(lignes.map(l => idDe(l.order_id)).filter(Boolean))];
  const jourDe = {};
  for (let i = 0; i < ids.length; i += 2000) {
    const rows = await src.odoo("sale.order", "read", [ids.slice(i, i + 2000)], { fields: ["date_order"], context: CTX });
    for (const o of rows || []) jourDe[o.id] = jourParis(depuisOdoo(o.date_order));
  }
  const parJour = {};
  for (const l of lignes) {
    const pid = idDe(l.product_id), j = jourDe[idDe(l.order_id)];
    if (!pid || !j) continue;
    ((parJour[pid] ||= {})[j] ||= new Set()).add(idDe(l.order_id));
  }
  const out = {};
  for (const pid of pids) out[pid] = f.jours.map(j => parJour[pid]?.[j]?.size || 0);
  return out;
}
