// Upload image produit vers Supabase Storage + update image_url dans elixir_products
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "POST only" };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { cip, imageBase64, mimeType, image_url: remoteUrl } = body;
  if (!cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip requis" }) };

  let image_url;

  if (remoteUrl) {
    // URL Medipim distante → stocke directement sans re-upload (images publiques)
    image_url = remoteUrl;

  } else if (imageBase64) {
    // Upload manuel base64 → Supabase Storage
    const buf = Buffer.from(imageBase64, "base64");
    const mime = mimeType || "image/jpeg";
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const filename = `products/${cip}.${ext}`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/elixir-images/${filename}`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": mime,
        "x-upsert": "true",
      },
      body: buf,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Storage: " + err }) };
    }
    image_url = `${SUPABASE_URL}/storage/v1/object/public/elixir-images/${filename}`;

  } else {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "image_url ou imageBase64 requis" }) };
  }

  // Met à jour image_url dans elixir_products
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${cip}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ image_url, updated_at: new Date().toISOString() }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "DB update: " + err }) };
  }

  console.log(`[product-upload-image] ✓ ${cip} → ${image_url}`);
  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, image_url }) };
};
