const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const AUTH = "Basic " + Buffer.from("288:094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696").toString("base64");
const H = { Authorization: AUTH, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };

async function tryFind(param, value) {
  if (!value) return null;
  const res = await fetch(`${MEDIPIM_BASE}/products/find?${param}=${value}`, { headers: H });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.product) return null;
  return extractProduct(data);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const { cip, cip7 } = event.queryStringParameters || {};
  if (!cip && !cip7) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip requis" }) };

  try {
    // Ordre de priorité : cip7 (ACL) → cip13 → heuristique
    const attempts = [];
    if (cip7) attempts.push(["cip7", cip7]);
    if (cip && cip.length === 13 && cip.startsWith("34")) attempts.push(["cip13", cip]);
    if (cip && cip.length === 13 && !cip.startsWith("34")) attempts.push(["cip7", cip.slice(-7)]);
    if (cip && cip.length === 13) attempts.push(["cip13", cip]);

    for (const [param, val] of attempts) {
      const result = await tryFind(param, val);
      if (result?.image_url) return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    }
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "Produit non trouvé" }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};

function extractProduct(data) {
  const p = data.product || data;
  const name = p.name?.fr || p.name?.en || null;
  const brand = p.brands?.[0]?.name || null;
  let image_url = null;
  const mainPhoto = (p.frontals || [])[0] || (p.photos || [])[0];
  if (mainPhoto?.formats) {
    image_url = mainPhoto.formats.mediumWebp || mainPhoto.formats.medium || mainPhoto.formats.mediumJpeg || mainPhoto.formats.large || null;
  }
  return { name, brand, image_url, medipim_id: p.id || null };
}
