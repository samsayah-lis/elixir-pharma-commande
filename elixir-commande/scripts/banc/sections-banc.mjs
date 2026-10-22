// ── Banc d'essai : ajout et retrait de produits d'une section (admin, onglet ✏️ Modifier ; src/components/sections-produits.js) ──
// À la première lecture de products-sections ou au premier products-upsert, le banc range en mémoire (jusqu'à son
// redémarrage) les produits figés de products-get dans un faux Supabase (scripts/peremption-faux.mjs), avec le catalogue
// local (recherche du banc) comme odoo_catalog :
//  • products-sections : VRAI code (netlify/functions/products-sections.js, lecture seule) sur ce faux Supabase ;
//  • products-upsert : même règle que la fonction (seules les colonnes envoyées, entrée d'historique ajoutée, ligne absente
//    créée si le nom est fourni, changement de CIP refusé si le nouveau existe) — le VRAI code est essayé par
//    scripts/test-admin-sections.mjs ; s'applique aussi aux autres écritures de l'admin (✏️ Modifier, ➕ Ajouter, labos) ;
//  • products-get : produits actifs de la mémoire, triés par section puis nom (le site du banc suit l'admin, comme en ligne).
// Rien ne part vers Supabase ni Odoo.
import { fauxSupabase } from "../peremption-faux.mjs";
import { creerHandler } from "../../netlify/functions/products-sections.js";

const CHAMPS = ["name", "section", "pv", "pct", "pn", "remise_eur", "colis", "carton", "note", "active", "source"];
let monde = null;

function mondeSections({ produits, catalogue }) {
  if (monde) return monde;
  const lignes = JSON.parse(JSON.stringify(produits()));
  const odoo = catalogue().map(p => ({ cip: p.cip, name: p.name, list_price: p.list_price ?? null, discounted_price: p.discounted_price ?? null,
    discount_pct: p.discount_pct ?? null, in_stock: !!p.in_stock, available: p.available ?? null }));
  const S = fauxSupabase({ tables: { elixir_products: lignes, odoo_catalog: odoo } });
  // admin du banc : tout jeton présenté (connexion fictive « essai-jeton-admin ») ; sans jeton : refus, comme en ligne
  const verifierAdmin = async (event) => (/^Bearer\s+\S+/i.test(event.headers?.authorization || "") ? { admin: { email: "admin@banc.local" } }
    : { error: { statusCode: 403, headers: {}, body: JSON.stringify({ error: "Accès admin requis" }) } });
  monde = { S, handler: creerHandler({ fetch: S.fetch, url: S.url, cle: S.cleService, verifierAdmin }), odoo: new Map(odoo.map(o => [o.cip, o])) };
  return monde;
}

const ok = (corps, statut = 200) => ({ statut, corps, source: "banc sections (mémoire)" });

function upsertBanc(corps) {
  const { product, action, author } = corps && typeof corps === "object" ? corps : {};
  if (!product?.cip) return ok({ error: "cip manquant" }, 400);
  const lignes = monde.S.table("elixir_products");
  const t = new Date().toISOString();
  const ancien = product.old_cip && product.old_cip !== product.cip ? product.old_cip : null;
  const ligne = lignes.find(r => r.cip === (ancien || product.cip));
  if (ancien && lignes.some(r => r.cip === product.cip)) return ok({ error: `Le CIP ${product.cip} est déjà utilisé` }, 409);
  let hist = [];
  if (action !== "create") { try { hist = JSON.parse(ligne?.history || "[]"); } catch { hist = []; } }
  if (ancien) hist.push({ action: "cip_changed", date: t, author: author || "admin", changes: { old_cip: ancien, new_cip: product.cip } });
  hist.push({ action: action || "update", date: t, author: author || "admin", changes: product._changes || null });
  const ecrit = {};
  for (const k of CHAMPS) {
    if (action === "create") ecrit[k] = product[k] ?? (k === "active" ? true : k === "source" ? "admin" : null);
    else if (product[k] !== undefined) ecrit[k] = product[k];
  }
  if (product.labo !== undefined) ecrit.labo = typeof product.labo === "string" ? product.labo.replace(/\s+/g, " ").trim().slice(0, 120) || null : null;
  if (ligne && action !== "create") {
    Object.assign(ligne, ecrit, { cip: product.cip, history: JSON.stringify(hist), updated_at: t });
    return ok({ success: true });
  }
  if (!ligne && action !== "create" && (ancien || !ecrit.name)) return ok({ error: `produit ${ancien || product.cip} introuvable` }, 404);
  const o = monde.odoo.get(product.cip);
  const nouvelle = { cip: product.cip, image_url: null, ...ecrit, history: JSON.stringify(hist), created_at: t, updated_at: t,
    ...(o && Number(o.list_price) > 0 && Number(o.discounted_price) > 0 ? { _price_source: "odoo" } : {}) };
  if (ligne) Object.assign(ligne, nouvelle); else lignes.push(nouvelle);
  return ok({ success: true });
}

// → réponse { statut, corps, source } ou null (le banc répond comme d'habitude)
export async function repondreSections({ methode, fn, query = {}, corps = null, entetes = {}, produits, catalogue }) {
  if (fn === "products-get" && methode === "GET") {
    if (!monde) return null;   // rien de changé : données figées
    const actifs = monde.S.table("elixir_products").filter(p => p.active !== false)
      .sort((a, b) => String(a.section ?? "").localeCompare(String(b.section ?? "")) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return ok({ products: JSON.parse(JSON.stringify(actifs)) });
  }
  if (fn === "products-sections") {
    mondeSections({ produits, catalogue });
    const r = await monde.handler({ httpMethod: methode, headers: entetes, queryStringParameters: query });
    return { statut: r.statusCode, corps: JSON.parse(r.body || "null"), source: "vrai code products-sections (faux Supabase du banc)" };
  }
  if (fn === "products-upsert" && methode === "POST") {
    mondeSections({ produits, catalogue });
    return upsertBanc(corps);
  }
  return null;
}
