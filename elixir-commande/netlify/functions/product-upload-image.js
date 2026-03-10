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

  const { cip, imageBase64, mimeType } = body;
  if (!cip || !imageBase64) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip et imageBase64 requis" }) };

  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const filename = `products/${cip}.${ext}`;
  const imageBuffer = Buffer.from(imageBase64, "base64");

  // Upload dans Supabase Storage bucket "elixir-images"
  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/elixir-images/${filename}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": mimeType || "image/jpeg",
      "x-upsert": "true",
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Storage: " + err }) };
  }

  const image_url = `${SUPABASE_URL}/storage/v1/object/public/elixir-images/${filename}`;

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
