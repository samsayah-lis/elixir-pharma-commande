// ── Debug : liste les emplacements de stock Elixir avec tous les champs utiles ──
import { authenticate, odooCall } from "./odoo.js";
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  try {
    const uid = await authenticate();

    // 1. Charger les emplacements internes d'Elixir (company_id=2)
    const locations = await odooCall(uid, "stock.location", "search_read",
      [["company_id", "=", 2], ["usage", "=", "internal"]],
      { fields: ["id", "name", "complete_name", "active", "scrap_location", "return_location", "usage", "replenish_location"], limit: 100 }
    );

    // 2. Chercher les champs disponibles sur stock.location
    const fields = await odooCall(uid, "stock.location", "fields_get",
      [],
      { attributes: ["string", "type"] }
    );
    
    // Filtrer les champs qui pourraient être "ne pas exporter"
    const exportFields = Object.entries(fields || {}).filter(([k, v]) => {
      const s = (v.string || "").toLowerCase();
      return s.includes("export") || s.includes("exclu") || s.includes("ignore") || s.includes("bloqu") || k.includes("export") || k.includes("exclude");
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      locations: Array.isArray(locations) ? locations : [],
      export_related_fields: exportFields.map(([k, v]) => ({ field: k, label: v.string, type: v.type })),
      total_fields: Object.keys(fields || {}).length,
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
