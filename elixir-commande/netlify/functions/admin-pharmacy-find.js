// ── Admin : trouver une pharmacie cliente d'Elixir pour commander à sa place ──
// GET ?q=nom, ville, CIP ou e-mail. Cherche dans Odoo (fiches commerciales clientes d'Elixir,
// même règle que la connexion : société 2, ou fiche partagée qui commande chez Elixir), y compris
// les pharmacies SANS compte sur le site ; indique celles qui ont un compte (e-mails de connexion).
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { PARTNER_FIELDS, elixirBuyers, isElixirCustomer, pickCip, splitEmails } from "./_pharmacies.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
let buyers = null;   // fiches partagées qui commandent chez Elixir (cache 30 min par instance)

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  try {
    const q = String(event.queryStringParameters?.q || "").trim();
    if (q.length < 2) return json(200, { pharmacies: [] });
    const digits = q.replace(/\D/g, "");
    const terms = [["name", "ilike", q], ["city", "ilike", q], ["email", "ilike", q], ["ref", "ilike", q]];
    if (digits.length >= 4) terms.push(["cip", "ilike", digits]);
    const or = [...Array(terms.length - 1).fill("|"), ...terms];
    const rows = await odoo("res.partner", "search_read", [[["parent_id", "=", false], ["company_id", "in", [COMPANY_ID, false]], ...or]],
      { fields: PARTNER_FIELDS, limit: 40, order: "name" });
    if (!buyers || Date.now() - buyers.at > 30 * 60e3) buyers = { at: Date.now(), set: await elixirBuyers() };
    const found = rows.filter(p => isElixirCustomer(p, buyers.set) && !((p.supplier_rank || 0) > 0 && !((p.customer_rank || 0) > 0))).slice(0, 20);
    // comptes du site (adresses de connexion) de ces pharmacies
    const ids = found.map(p => p.id);
    const accounts = ids.length ? await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies?odoo_id=in.(${ids.join(",")})&select=email,odoo_id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }).then(r => r.json()).catch(() => []) : [];
    const mailsOf = {};
    for (const a of Array.isArray(accounts) ? accounts : []) (mailsOf[a.odoo_id] ||= []).push(a.email);
    return json(200, { pharmacies: found.map(p => ({ odoo_id: p.id, name: p.name, cip: pickCip(p), city: p.city || "", zip: p.zip || "",
      phone: p.phone || p.mobile || "",
      // adresses de connexion de CETTE pharmacie seulement : l'e-mail de la fiche Odoo peut être celui d'une
      // autre officine du même titulaire (et mènerait à son CIP) → affiché à part, jamais utilisé comme identité
      emails: mailsOf[p.id] || [], odoo_emails: splitEmails(p.email), has_account: !!mailsOf[p.id]?.length })) });
  } catch (e) {
    console.error("admin-pharmacy-find", e);
    return json(502, { error: e.message || String(e) });
  }
};
