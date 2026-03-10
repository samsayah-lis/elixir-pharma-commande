// Proxy Medipim API — cherche un produit par CIP13 et retourne nom + image
const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const MEDIPIM_ID  = "288";
const MEDIPIM_KEY = "094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696";
const AUTH = "Basic " + Buffer.from(`${MEDIPIM_ID}:${MEDIPIM_KEY}`).toString("base64");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const { cip } = event.queryStringParameters || {};
  if (!cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip requis" }) };

  try {
    // Cherche par cip13 (CIP13) ou barcode13
    const res = await fetch(`${MEDIPIM_BASE}/products/find?cip13=${cip}`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
    });

    if (res.status === 404) {
      // Essaie aussi avec barcode
      const res2 = await fetch(`${MEDIPIM_BASE}/products/find?barcode=${cip}`, {
        headers: { Authorization: AUTH, "Content-Type": "application/json" },
      });
      if (!res2.ok) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "Produit non trouvé dans Medipim" }) };
      const data2 = await res2.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify(extractProduct(data2)) };
    }

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers: cors, body: JSON.stringify({ error: err }) };
    }

    const data = await res.json();
    return { statusCode: 200, headers: cors, body: JSON.stringify(extractProduct(data)) };

  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};

function extractProduct(data) {
  // Extrait les champs utiles : nom, marque, image principale
  const name = data.name?.fr || data.name?.en || data.name || null;
  const brand = data.brand?.name || null;
  
  // Image principale : cherche la première image de type "product" ou la première media disponible
  let image_url = null;
  const medias = data.medias || data.media || [];
  const mainImg = medias.find(m => m.type === "PRODUCT_IMAGE" || m.type === "image") || medias[0];
  if (mainImg) {
    image_url = mainImg.url || mainImg.src || null;
  }

  return {
    name,
    brand,
    image_url,
    medipim_id: data.id || null,
    description: data.descriptions?.[0]?.content?.fr || null,
  };
}
