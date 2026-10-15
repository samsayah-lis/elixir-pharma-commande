import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { MEDIPIM_BASE, MEDIPIM_HEADERS as H } from "./_medipim.js";
// Fiche Medipim (nom, marque, photo) d'un produit par code, pour l'admin.
// 404 = produit absent de Medipim (ou sans photo, sauf sansPhoto=1) ; 429/503 = base saturée ou indisponible
// (jamais confondu avec « non trouvé » : la clé est partagée, 100 appels/min).

// Erreur Medipim autre que « pas trouvé » : remontée telle quelle à l'appelant
class Indisponible extends Error { constructor(status) { super(status === 429 ? "Base photos saturée" : `Base photos indisponible (${status})`); this.status = status; } }

async function requete(filter) {
  const res = await fetch(`${MEDIPIM_BASE}/products/query`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ filter: { and: [{ status: "active" }, filter] }, page: { no: 0, size: 10 } }),
  });
  if (res.status === 429 || res.status >= 500) throw new Indisponible(res.status);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.results || [];
}

// Recherche par code-barres (EAN, CIP13 ou ACL13) en un appel, comme l'outil étiquettes : trouve aussi la
// parapharmacie que /products/find (cip13) manque.
async function parCode(code) {
  if (!/^\d{8,14}$/.test(code || "")) return null;
  const q = code.length === 12 ? "0" + code : code;
  const liste = (await requete({ search: { type: "refcode", query: q, locale: "fr" } }))
    .filter(p => [p.cip13, p.acl13, ...(p.ean || [])].includes(q));
  return meilleur(liste);
}

// CIP7 / ACL7 explicite (le paramètre cip7 de /products/find n'existe pas : 422)
async function parCip7(c7) {
  if (!/^\d{7}$/.test(c7 || "")) return null;
  return meilleur(await requete({ cipOrAcl7: c7 }));
}

// Repli pour les médicaments (CIP13 34009…) que la recherche par code ne renverrait pas
async function parCip13(cip) {
  const res = await fetch(`${MEDIPIM_BASE}/products/find?cip13=${encodeURIComponent(cip)}`, { headers: H });
  if (res.status === 429 || res.status >= 500) throw new Indisponible(res.status);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.product ? extractProduct(data) : null;
}

function meilleur(liste) {
  if (!liste.length) return null;
  const produits = liste.map(p => extractProduct({ product: p }));
  return produits.find(p => p.image_url) || produits[0];
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;

  // sansPhoto=1 : renvoie aussi une fiche trouvée sans photo (nom seul) au lieu d'un 404
  const { cip, cip7, sansPhoto } = event.queryStringParameters || {};
  if (!cip && !cip7) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip requis" }) };

  try {
    // Ordre : CIP7/ACL7 explicite → code-barres exact → CIP13 (médicaments). Plus d'heuristique « 7 derniers
    // chiffres d'un EAN » : elle pouvait tomber sur l'ACL7 d'un autre produit (mauvaise photo).
    let trouve = cip7 ? await parCip7(cip7) : null;
    if (!trouve?.image_url && cip) {
      const r = await parCode(cip);
      if (r && (!trouve || r.image_url)) trouve = r;
    }
    if (!trouve && cip && /^34\d{11}$/.test(cip)) trouve = await parCip13(cip);
    if (trouve && (trouve.image_url || sansPhoto === "1")) return { statusCode: 200, headers: cors, body: JSON.stringify(trouve) };
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "Produit non trouvé" }) };
  } catch (e) {
    if (e instanceof Indisponible) {
      const code = e.status === 429 ? 429 : 503;
      return { statusCode: code, headers: { ...cors, "Retry-After": "30" }, body: JSON.stringify({ error: e.message }) };
    }
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};

function extractProduct(data) {
  const p = data.product || data;
  const name = p.name?.fr || p.name?.en || null;
  // nom lisible « Marque - Nom » (le nom officiel est souvent abrégé en majuscules)
  const seo_name = p.seoName?.fr || p.seoName?.en || null;
  const brand = p.brands?.[0]?.name || null;
  let image_url = null;
  const mainPhoto = (p.frontals || [])[0] || (p.photos || [])[0];
  if (mainPhoto?.formats) {
    image_url = mainPhoto.formats.mediumWebp || mainPhoto.formats.medium || mainPhoto.formats.mediumJpeg || mainPhoto.formats.large || null;
  }
  return { name, seo_name, brand, image_url, medipim_id: p.id || null };
}
