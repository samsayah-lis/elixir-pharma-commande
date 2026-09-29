// ── Pharmacies clientes d'Elixir Pharma (société Odoo 2) ────────────────
// Règle unique utilisée par la synchronisation et par la connexion :
// une fiche est cliente d'Elixir si elle est active et
//   - rattachée à la société 2, ou
//   - « partagée » (sans société) ET a déjà une commande confirmée chez Elixir
//     (ex. Pharmacie de l'Avenir, Paris Magenta : fiches partagées actives).
// Les clients des autres sociétés du groupe (Schatz, Novapharma, CPA…) sont exclus.
import { odoo, odooAll, COMPANY_ID } from "./_odoo-rpc.js";

export const PARTNER_FIELDS = ["id", "name", "email", "ref", "cip", "street", "zip", "city", "phone", "mobile",
  "company_id", "commercial_partner_id", "parent_id", "active", "customer_rank", "supplier_rank"];

export const validCip = (c) => { const s = String(c ?? "").trim(); return !!s && s !== "0" && s.toLowerCase() !== "false"; };
// Le vrai CIP est dans le champ « CIP » de la fiche ; « Référence » ne sert qu'en repli
export const pickCip = (...ps) => { for (const p of ps) for (const k of ["cip", "ref"]) if (p && validCip(p[k])) return String(p[k]).trim(); return ""; };
// Un champ e-mail Odoo peut contenir plusieurs adresses (« a@x.fr ; b@y.fr », « Nom <a@x.fr> »)
export const splitEmails = (s) => [...new Set(String(s || "").toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [])];
const commercialId = (p) => p.commercial_partner_id?.[0] || p.id;

// Fiches commerciales ayant au moins une commande confirmée chez Elixir
export async function elixirBuyers() {
  const groups = await odoo("sale.order", "read_group",
    [[["company_id", "=", COMPANY_ID], ["state", "in", ["sale", "done"]]], ["partner_id"], ["partner_id"]], { lazy: false });
  const ids = [...new Set(groups.map(g => g.partner_id?.[0]).filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await odoo("res.partner", "read", [ids], { fields: ["commercial_partner_id"], context: { active_test: false } });
  return new Set(rows.map(commercialId));
}

export const isElixirCustomer = (p, buyers) => !!p && p.active !== false &&
  (p.company_id?.[0] === COMPANY_ID || (!p.company_id && buyers.has(commercialId(p))));

// Un fournisseur pur (labo) n'est pas une pharmacie cliente
const isPureSupplier = (p) => (p.supplier_rank || 0) > 0 && !((p.customer_rank || 0) > 0);

// Préférence quand plusieurs fiches portent la même adresse : fiche principale,
// puis fiche avec CIP, puis fiche qui commande chez Elixir
const score = (p, buyers) => (p.parent_id ? 0 : 4) + (validCip(p.cip) || validCip(p.ref) ? 2 : 0) + (buyers.has(commercialId(p)) ? 1 : 0);

// Ligne de elixir_pharmacies : identité = fiche commerciale (la pharmacie, pas le contact)
export function pharmacyRow(p, commercial, email) {
  const c = commercial || p;
  return { email, name: c.name || p.name || "", cip: pickCip(c, p), street: c.street || p.street || "", cp: c.zip || p.zip || "",
    ville: c.city || p.city || "", tel: c.phone || c.mobile || p.phone || p.mobile || "", odoo_id: c.id, updated_at: new Date().toISOString() };
}

// Toutes les pharmacies clientes d'Elixir, une ligne par adresse e-mail
export async function elixirPharmacyRows() {
  const buyers = await elixirBuyers();
  const partners = (await odooAll("res.partner",
    [["customer_rank", ">", 0], ["active", "=", true], ["email", "!=", false], ["company_id", "in", [COMPANY_ID, false]]],
    { fields: PARTNER_FIELDS, order: "id" })).filter(p => isElixirCustomer(p, buyers) && !isPureSupplier(p));
  const byId = new Map(partners.map(p => [p.id, p]));
  const missing = [...new Set(partners.map(commercialId).filter(id => !byId.has(id)))];
  if (missing.length) for (const c of await odoo("res.partner", "read", [missing], { fields: PARTNER_FIELDS, context: { active_test: false } })) byId.set(c.id, c);
  const best = new Map();
  for (const p of partners) for (const email of splitEmails(p.email)) {
    const prev = best.get(email);
    if (!prev || score(p, buyers) > score(prev, buyers)) best.set(email, p);
  }
  const rows = [...best.entries()].map(([email, p]) => pharmacyRow(p, byId.get(commercialId(p)), email));
  return { rows, buyers, partnersCount: partners.length };
}

// Connexion d'une adresse absente du cache : fiche cliente Elixir portant cette adresse
export async function findElixirPharmacy(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return null;
  const cands = (await odoo("res.partner", "search_read",
    [[["email", "ilike", e], ["active", "=", true], ["company_id", "in", [COMPANY_ID, false]]]], { fields: PARTNER_FIELDS, limit: 20 }))
    .filter(p => splitEmails(p.email).includes(e) && !isPureSupplier(p));
  if (!cands.length) return null;
  let buyers = new Set();
  if (cands.some(p => !p.company_id)) {
    const coms = [...new Set(cands.filter(p => !p.company_id).map(commercialId))];
    const g = await odoo("sale.order", "read_group", [[["company_id", "=", COMPANY_ID], ["state", "in", ["sale", "done"]],
      ["partner_id", "child_of", coms]], ["partner_id"], ["partner_id"]], { lazy: false });
    if (g.length) {
      const rows = await odoo("res.partner", "read", [g.map(x => x.partner_id[0])], { fields: ["commercial_partner_id"], context: { active_test: false } });
      buyers = new Set(rows.map(commercialId));
    }
  }
  const ok = cands.filter(p => isElixirCustomer(p, buyers)).sort((a, b) => score(b, buyers) - score(a, buyers));
  if (!ok.length) return null;
  const p = ok[0];
  const commercial = commercialId(p) === p.id ? p
    : (await odoo("res.partner", "read", [[commercialId(p)]], { fields: PARTNER_FIELDS, context: { active_test: false } }))[0];
  return pharmacyRow(p, commercial, e);
}

// Fiches (par id) encore clientes d'Elixir — pour ne pas retirer une ancienne adresse d'une pharmacie Elixir
export async function elixirCustomerIds(ids, buyers) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    // search_read plutôt que read : une fiche supprimée d'Odoo est simplement absente (read lèverait une erreur)
    const rows = await odoo("res.partner", "search_read", [[["id", "in", ids.slice(i, i + 500)]]],
      { fields: ["id", "active", "company_id", "commercial_partner_id"], context: { active_test: false } });
    for (const p of rows) out.set(p.id, isElixirCustomer(p, buyers) ? commercialId(p) : null);
  }
  return out;   // id → id de la fiche commerciale si cliente Elixir, sinon null
}
