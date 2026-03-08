import { authenticate, odooCall, xmlVal, xmlMember, ODOO_COMPANY } from "./odoo.js";
import https from "https";

const ODOO_URL  = process.env.ODOO_URL  || "https://odoo.elixir-pharma.fr";
const ODOO_DB   = process.env.ODOO_DB   || "healthsoft-sas-lispharma-main-13622653";
const ODOO_PASS = process.env.ODOO_APIKEY || process.env.ODOO_PASS || "";

function buildCall(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${
    params.map(p => `<param>${p}</param>`).join("")
  }</params></methodCall>`;
}
function xmlPost(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(ODOO_URL);
    const buf = Buffer.from(body, "utf-8");
    const req = https.request({
      hostname: u.hostname, path, method: "POST",
      headers: { "Content-Type": "text/xml", "Content-Length": buf.length },
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d)); });
    req.on("error", reject); req.write(buf); req.end();
  });
}
function parseScalar(xml) {
  if (xml.includes("<fault>")) {
    const msg = xml.match(/<n(?:ame)?>faultString<\/n(?:ame)?>\s*<value><string>([\s\S]*?)<\/string>/)?.[1] || "Fault";
    throw new Error(String(msg).substring(0, 300));
  }
  return parseInt(xml.match(/<int>(\d+)<\/int>/)?.[1] || "0");
}

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { items, pharmacyName, pharmacyEmail, orderId } = payload;
  if (!items?.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "items manquants" }) };

  try {
    const uid = await authenticate();

    // 1. Trouve le partenaire (pharmacie)
    let partnerId = null;
    if (pharmacyEmail) {
      const partners = await odooCall(uid, "res.partner", "search_read",
        [["email", "=", pharmacyEmail], ["company_id", "=", ODOO_COMPANY]],
        { fields: ["id", "name"], limit: 1 }
      );
      if (partners.length > 0) partnerId = parseInt(partners[0].id);
    }
    if (!partnerId && pharmacyName) {
      const partners = await odooCall(uid, "res.partner", "search_read",
        [["name", "ilike", pharmacyName], ["company_id", "=", ODOO_COMPANY]],
        { fields: ["id", "name"], limit: 1 }
      );
      if (partners.length > 0) partnerId = parseInt(partners[0].id);
    }
    if (!partnerId) throw new Error(`Partenaire introuvable : ${pharmacyName} / ${pharmacyEmail}`);

    // 2. Trouve les product.product IDs depuis les CIPs
    const cips = [...new Set(items.map(i => i.cip).filter(Boolean))];
    const cipDomain = [];
    if (cips.length > 1) for (let i = 0; i < cips.length - 1; i++) cipDomain.push("|");
    cips.forEach(c => cipDomain.push(["barcode", "=", c]));
    const products = await odooCall(uid, "product.product", "search_read", cipDomain,
      { fields: ["id", "barcode"], limit: 200 }
    );
    const pidByCip = {};
    products.forEach(p => { pidByCip[p.barcode] = parseInt(p.id); });

    // 3. Crée le bon de commande (sale.order)
    const orderLines = items
      .filter(i => pidByCip[i.cip])
      .map(i => xmlVal("array",
        xmlVal("int", 0) + xmlVal("int", 0) +
        xmlVal("struct",
          xmlMember("product_id", xmlVal("int", pidByCip[i.cip])) +
          xmlMember("product_uom_qty", xmlVal("int", i.qty))
        )
      )).join("");

    const createBody = buildCall("execute_kw", [
      xmlVal("string", ODOO_DB),
      xmlVal("int", uid),
      xmlVal("string", ODOO_PASS),
      xmlVal("string", "sale.order"),
      xmlVal("string", "create"),
      xmlVal("array", xmlVal("array",
        xmlVal("struct",
          xmlMember("partner_id", xmlVal("int", partnerId)) +
          xmlMember("company_id", xmlVal("int", ODOO_COMPANY)) +
          xmlMember("client_order_ref", xmlVal("string", String(orderId || ""))) +
          xmlMember("order_line", xmlVal("array", orderLines))
        )
      )),
      xmlVal("struct", ""),
    ]);

    const createXml = await xmlPost("/xmlrpc/2/object", createBody);
    const newOrderId = parseScalar(createXml);
    if (!newOrderId) throw new Error("Création commande Odoo échouée");

    console.log(`[submit-order] ✓ sale.order créé id=${newOrderId} pour ${pharmacyName}`);
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ success: true, odooOrderId: newOrderId })
    };
  } catch (err) {
    console.error("[submit-order]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
