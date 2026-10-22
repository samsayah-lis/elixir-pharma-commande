import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
// ── Sections du catalogue : lectures de l'admin (onglet ✏️ Modifier, ajout et retrait de produits d'une section) ──
// LECTURE SEULE. Les changements passent par products-upsert (jeton admin, seules les lignes concernées, historique).
//  GET ?section=<clé>       → produits retirés de cette section (elixir_products.active = false), du plus récent au plus
//                             ancien : nom, CIP, photo, date et auteur du retrait (dernière entrée d'historique), prix et
//                             stock Odoo (odoo_catalog), prix enregistré (repli quand le produit n'est plus dans Odoo),
//                             colis et prix carton enregistrés (Sélection Stratège).
//  GET ?cips=<cip,cip…>     → état de ces CIP sur le site (actif ou retiré, section, nom, prix enregistrés, colis et carton,
//                             dernière entrée d'historique ; absents : aucune ligne) et leur stock Odoo (quantité libre
//                             « available », écrite par odoo-stock-sync) — 200 CIP au plus.
// products-get ne renvoie que les produits actifs : sans cette lecture, l'admin ne voit ni les produits retirés ni un CIP
// retiré d'une autre section (un CIP n'a qu'une ligne, donc qu'une section : la clé de la table est le CIP).
// Réservé à l'admin (verifyAdmin) : les produits retirés et les quantités en stock ne sont pas publics.
const MAX_CIPS = 200;
const MAX_RETIRES = 500;
const CIP = /^[\w.-]{1,40}$/;
const SECTION = /^[\w-]{1,60}$/;

const nombre = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
// dernière entrée d'historique (texte JSON de la colonne history) : { action, date, author } ou null
export function derniereEntree(history) {
  let h = history;
  if (typeof h === "string") { try { h = JSON.parse(h); } catch { return null; } }
  if (!Array.isArray(h) || !h.length) return null;
  const e = h[h.length - 1] || {};
  return { action: e.action ? String(e.action) : null, date: e.date ? String(e.date) : null, author: e.author ? String(e.author).slice(0, 120) : null };
}

export function creerHandler({
  fetch: f = (...a) => globalThis.fetch(...a),
  url = process.env.SUPABASE_URL,
  cle = process.env.SUPABASE_KEY,
  verifierAdmin = verifyAdmin,
} = {}) {
  const SB = { apikey: cle, Authorization: `Bearer ${cle}` };
  const lire = async (chemin) => {
    const r = await f(`${url}/rest/v1/${chemin}`, { headers: SB });
    if (!r.ok) throw Object.assign(new Error(`Supabase ${r.status} : ${(await r.text().catch(() => "")).slice(0, 200)}`), { status: 502 });
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  };
  // stock et prix Odoo de ces CIP (par lots de 100 : longueur d'adresse)
  const odooDe = async (cips) => {
    const out = {};
    for (let i = 0; i < cips.length; i += 100) {
      const lot = cips.slice(i, i + 100).map(encodeURIComponent).join(",");
      for (const r of await lire(`odoo_catalog?cip=in.(${lot})&select=cip,name,list_price,discounted_price,discount_pct,in_stock,available`)) {
        out[r.cip] = { name: r.name ?? null, list_price: nombre(r.list_price), discounted_price: nombre(r.discounted_price), discount_pct: nombre(r.discount_pct),
          in_stock: r.in_stock === true, available: nombre(r.available) };
      }
    }
    return out;
  };

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
    const repond = (statusCode, corps) => ({ statusCode, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(corps) });
    if (event.httpMethod !== "GET") return repond(405, { error: "GET seulement (lecture) : les changements passent par products-upsert" });

    const auth = await verifierAdmin(event);
    if (auth.error) return auth.error;
    if (!url || !cle) return repond(500, { error: "Supabase non configuré" });

    const q = event.queryStringParameters || {};
    try {
      if (q.section != null) {
        const section = String(q.section);
        if (!SECTION.test(section)) return repond(400, { error: "section invalide" });
        const lignes = await lire(`elixir_products?section=eq.${encodeURIComponent(section)}&active=eq.false`
          + `&select=cip,name,section,pv,pn,remise_eur,colis,carton,image_url,updated_at,history&order=updated_at.desc&limit=${MAX_RETIRES}`);
        const odoo = await odooDe(lignes.map(l => l.cip).filter(c => CIP.test(String(c))));
        const retires = lignes.map(l => ({
          cip: l.cip, name: l.name, section: l.section, image_url: l.image_url || null, updated_at: l.updated_at || null,
          pv: nombre(l.pv), pn: nombre(l.pn), remise_eur: nombre(l.remise_eur), colis: nombre(l.colis), carton: nombre(l.carton),
          retrait: derniereEntree(l.history), odoo: odoo[l.cip] || null,
        }));
        return repond(200, { section, retires, plafond: lignes.length >= MAX_RETIRES });
      }
      if (q.cips != null) {
        const cips = [...new Set(String(q.cips).split(",").map(c => c.trim()).filter(c => CIP.test(c)))];
        if (!cips.length) return repond(400, { error: "cips requis (séparés par des virgules)" });
        if (cips.length > MAX_CIPS) return repond(413, { error: `${MAX_CIPS} CIP au plus` });
        const produits = {};
        for (let i = 0; i < cips.length; i += 100) {
          const lot = cips.slice(i, i + 100).map(encodeURIComponent).join(",");
          for (const l of await lire(`elixir_products?cip=in.(${lot})&select=cip,name,section,active,pv,pn,remise_eur,colis,carton,image_url,updated_at,history`)) {
            produits[l.cip] = { active: l.active !== false, section: l.section ?? null, name: l.name ?? null, image_url: l.image_url || null,
              pv: nombre(l.pv), pn: nombre(l.pn), remise_eur: nombre(l.remise_eur), colis: nombre(l.colis), carton: nombre(l.carton),
              updated_at: l.updated_at || null, derniere: derniereEntree(l.history) };
          }
        }
        return repond(200, { produits, stocks: await odooDe(cips) });
      }
      return repond(400, { error: "paramètre section ou cips requis" });
    } catch (e) {
      console.error("[products-sections]", e.message);
      return repond(e.status || 500, { error: e.message });
    }
  };
}

export const handler = creerHandler();
