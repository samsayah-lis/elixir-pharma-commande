// ── Medipim (API v4) : fiche produit par CIP ────────────────────────────
// Accès partagé par medipim-lookup (images de l'admin) et les commandes groupées
// (nom, TVA, prix public d'un produit absent d'Odoo).
export const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const MEDIPIM_USER = process.env.MEDIPIM_USER || "288";
const MEDIPIM_KEY  = process.env.MEDIPIM_KEY  || "094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696";
const AUTH = "Basic " + Buffer.from(`${MEDIPIM_USER}:${MEDIPIM_KEY}`).toString("base64");
export const MEDIPIM_HEADERS = { Authorization: AUTH, "Content-Type": "application/json" };

const cents = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) / 100 : null);

const pickProduct = (p, c) => ({
  medipim_id: p.id || null,
  name: p.name?.fr || p.name?.en || null,
  brand: p.brands?.[0]?.name || null,
  cip13: p.cip13 || p.acl13 || (c.length === 13 ? c : null),
  cip7: p.cip7 || p.acl7 || (c.length === 13 && c.startsWith("34009") ? c.slice(5, 12) : c.length === 7 ? c : null),
  vat: Number.isFinite(Number(p.vat)) && p.vat !== null ? Number(p.vat) : null,
  public_price: cents(p.publicPrice),
  manufacturer_price: cents(p.manufacturerPrice),
  pharmacist_price: cents(p.pharmacistPrice),
});

// Fiche Medipim d'un code produit, null si introuvable. Médicaments : CIP13 (34009…) ou CIP7 ;
// parapharmacie : ACL13 (3401…) ; autres codes-barres : recherche par EAN.
// CIP7 → CIP13 : 34009 + CIP7 + clé EAN-13
export function cip7to13(c7) {
  const base = `34009${c7}`;
  const sum = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}
export async function medipimProduct(code) {
  let c = String(code || "").replace(/\D/g, "");
  if (c.length === 7) c = cip7to13(c);
  const finds = c.length === 13 && c.startsWith("34009") ? [["cip13", c], ["cip7", c.slice(5, 12)]]
    : c.length === 13 && c.startsWith("340") ? [["acl13", c], ["cip13", c]]
    : c.length === 7 ? [["cip7", c], ["acl7", c]] : [];
  for (const [param, value] of finds) {
    const res = await fetch(`${MEDIPIM_BASE}/products/find?${param}=${value}`, { headers: MEDIPIM_HEADERS });
    if (!res.ok) continue;
    const p = (await res.json().catch(() => null))?.product;
    if (p) return pickProduct(p, c);
  }
  if (c.length >= 8) {
    const res = await fetch(`${MEDIPIM_BASE}/products/query`, { method: "POST", headers: MEDIPIM_HEADERS, body: JSON.stringify({ filter: { ean: [c] }, page: { size: 10, no: 0 } }) });
    if (res.ok) {
      const p = (await res.json().catch(() => null))?.results?.[0];
      if (p) return pickProduct(p, c);
    }
  }
  return null;
}
