// ── Audit des emplacements internes Odoo ────────────────────────────────
// GET /.netlify/functions/odoo-locations-audit
// Retourne la liste exhaustive des emplacements internes (company_id=2)
// avec pour chacun : id, nom complet, statut scrap, statut inclus/exclu,
// raison de l'exclusion, et nombre de quants présents.
//
// Applique EXACTEMENT la même logique d'exclusion que odoo-stock-sync.js
// pour permettre une vérification fidèle.

import { verifyAdmin } from "./auth.js";
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";
import { getCors } from "./cors.js";

const COMPANY_ID = ODOO_COMPANY || 2;

// ⚠ Doit rester synchronisé avec odoo-stock-sync.js (step=stock_prep)
const EXCLUDED_PREFIXES = ["EP/Stock/A/", "EP/Stock/B/", "EP/Stock/C/", "EP/Stock/V/", "EP/Quarantaine"];
const EXCLUDED_EXACT    = ["EP/Stock/A", "EP/Stock/B", "EP/Stock/C", "EP/Stock/V"];

function classifyLocation(loc) {
  const cn = loc.complete_name || "";
  const isScrap = loc.scrap_location === "1" || loc.scrap_location === true;
  const prefixMatch = EXCLUDED_PREFIXES.find(p => cn.startsWith(p));
  const exactMatch = EXCLUDED_EXACT.includes(cn);

  if (isScrap)     return { excluded: true,  reason: "scrap",  detail: "scrap_location=true" };
  if (prefixMatch) return { excluded: true,  reason: "prefix", detail: `commence par "${prefixMatch}"` };
  if (exactMatch)  return { excluded: true,  reason: "exact",  detail: `nom = "${cn}"` };
  return                  { excluded: false, reason: null,     detail: "inclus dans la sync stock" };
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;

  try {
    const uid = await authenticate();

    // 1) Tous les emplacements internes
    const locations = await odooCall(uid, "stock.location", "search_read",
      [["company_id", "=", COMPANY_ID], ["usage", "=", "internal"]],
      { fields: ["id", "complete_name", "name", "scrap_location"], limit: 2000 }
    );
    const locArr = Array.isArray(locations) ? locations : [];

    // 2) Compter les quants par emplacement (en une seule passe)
    const quantsByLoc = {};
    let qOffset = 0;
    while (true) {
      const page = await odooCall(uid, "stock.quant", "search_read",
        [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"]],
        { fields: ["location_id", "quantity"], limit: 1000, offset: qOffset }
      );
      if (!Array.isArray(page) || page.length === 0) break;
      page.forEach(q => {
        const lid = parseInt(q.location_id);
        if (!lid) return;
        if (!quantsByLoc[lid]) quantsByLoc[lid] = { count: 0, total_qty: 0 };
        quantsByLoc[lid].count += 1;
        quantsByLoc[lid].total_qty += parseFloat(q.quantity) || 0;
      });
      if (page.length < 1000) break;
      qOffset += 1000;
    }

    // 3) Classifier
    const rows = locArr.map(loc => {
      const c = classifyLocation(loc);
      const id = parseInt(loc.id);
      const q = quantsByLoc[id] || { count: 0, total_qty: 0 };
      return {
        id,
        complete_name: loc.complete_name || "",
        name: loc.name || "",
        scrap_location: !!(loc.scrap_location === "1" || loc.scrap_location === true),
        excluded: c.excluded,
        reason: c.reason,
        detail: c.detail,
        quants_count: q.count,
        total_quantity: Math.round(q.total_qty * 100) / 100,
      };
    });

    // 4) Tri : exclus d'abord (groupés par raison), puis inclus (alpha)
    rows.sort((a, b) => {
      if (a.excluded !== b.excluded) return a.excluded ? -1 : 1;
      if (a.excluded && b.excluded && a.reason !== b.reason) {
        return (a.reason || "").localeCompare(b.reason || "");
      }
      return a.complete_name.localeCompare(b.complete_name);
    });

    // 5) Résumés
    const summary = {
      total_locations: rows.length,
      excluded: rows.filter(r => r.excluded).length,
      included: rows.filter(r => !r.excluded).length,
      excluded_by_scrap:  rows.filter(r => r.reason === "scrap").length,
      excluded_by_prefix: rows.filter(r => r.reason === "prefix").length,
      excluded_by_exact:  rows.filter(r => r.reason === "exact").length,
      total_quants_excluded: rows.filter(r => r.excluded).reduce((s, r) => s + r.quants_count, 0),
      total_quants_included: rows.filter(r => !r.excluded).reduce((s, r) => s + r.quants_count, 0),
    };

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        company_id: COMPANY_ID,
        rules: {
          excluded_prefixes: EXCLUDED_PREFIXES,
          excluded_exact: EXCLUDED_EXACT,
          excludes_scrap: true,
        },
        summary,
        locations: rows,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
