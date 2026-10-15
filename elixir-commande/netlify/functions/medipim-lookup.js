import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { MEDIPIM_BASE, MEDIPIM_HEADERS as H } from "./_medipim.js";
async function tryFind(param, value) {
  if (!value) return null;
  const res = await fetch(`${MEDIPIM_BASE}/products/find?${param}=${value}`, { headers: H });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.product) return null;
  return extractProduct(data);
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
    // Ordre de priorité : cip7 (ACL) → cip13 → heuristique
    const attempts = [];
    if (cip7) attempts.push(["cip7", cip7]);
    if (cip && cip.length === 13 && cip.startsWith("34")) attempts.push(["cip13", cip]);
    if (cip && cip.length === 13 && !cip.startsWith("34")) attempts.push(["cip7", cip.slice(-7)]);
    if (cip && cip.length === 13) attempts.push(["cip13", cip]);

    let sansImage = null;
    const faits = new Set();
    for (const [param, val] of attempts) {
      if (faits.has(`${param}=${val}`)) continue; // même requête Medipim déjà faite
      faits.add(`${param}=${val}`);
      const result = await tryFind(param, val);
      if (result?.image_url) return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
      if (result && !sansImage) sansImage = result;
    }
    if (sansImage && sansPhoto === "1") return { statusCode: 200, headers: cors, body: JSON.stringify(sansImage) };
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "Produit non trouvé" }) };
  } catch (e) {
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
