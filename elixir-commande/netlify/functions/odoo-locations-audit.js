// ── Audit des emplacements internes Odoo ────────────────────────────────
// GET /.netlify/functions/odoo-locations-audit
// Retourne la liste exhaustive des emplacements internes (company_id=2)
// avec pour chacun : id, nom complet, statut scrap, statut do_not_export,
// statut inclus/exclu, raison, et nombre de quants présents.
//
// Applique EXACTEMENT la même logique d'exclusion que odoo-stock-sync.js
// step=stock_prep : exclu si do_not_export=true OU scrap_location=true.
//
// Le champ do_not_export est géré directement dans Odoo sur la fiche
// emplacement (case à cocher). Pour exclure un emplacement du sync, il
// suffit donc de cocher la case dans Odoo — plus besoin de modifier le code.

import { verifyAdmin } from "./auth.js";
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";
import { getCors } from "./cors.js";

const COMPANY_ID = ODOO_COMPANY || 2;

function classifyLocation(loc) {
  const isScrap    = loc.scrap_location === "1" || loc.scrap_location === true;
  const isDoNotExp = loc.do_not_export   === "1" || loc.do_not_export   === true;

  // Les deux peuvent être vrais en même temps : on rapporte la raison principale
  if (isScrap && isDoNotExp) return { excluded: true,  reason: "do_not_export+scrap", detail: "do_not_export coché + scrap_location" };
  if (isDoNotExp)            return { excluded: true,  reason: "do_not_export",       detail: "case do_not_export cochée dans Odoo" };
  if (isScrap)               return { excluded: true,  reason: "scrap",               detail: "scrap_location=true" };
  return                            { excluded: false, reason: null,                  detail: "inclus dans la sync stock" };
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
      { fields: ["id", "complete_name", "name", "scrap_location", "do_not_export"], limit: 2000 }
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
        do_not_export:  !!(loc.do_not_export   === "1" || loc.do_not_export   === true),
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
      excluded_by_do_not_export: rows.filter(r => r.do_not_export).length,
      excluded_by_scrap:         rows.filter(r => r.scrap_location).length,
      total_quants_excluded: rows.filter(r => r.excluded).reduce((s, r) => s + r.quants_count, 0),
      total_quants_included: rows.filter(r => !r.excluded).reduce((s, r) => s + r.quants_count, 0),
    };

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        company_id: COMPANY_ID,
        rules: {
          field_do_not_export: "do_not_export (case à cocher sur la fiche emplacement Odoo)",
          field_scrap: "scrap_location",
          logic: "exclu si do_not_export=true OU scrap_location=true",
        },
        summary,
        locations: rows,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500, headers: cors,
      body: JSON.stringify({
        error: e.message,
        hint: e.message && e.message.includes("do_not_export")
          ? "Le champ 'do_not_export' n'existe pas sur stock.location. Verifie le nom technique exact dans Odoo (Parametres -> Technique -> Champs)."
          : null,
      }),
    };
  }
};
