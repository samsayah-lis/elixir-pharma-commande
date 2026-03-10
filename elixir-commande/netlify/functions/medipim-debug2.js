// Debug étape par étape : lookup + upload pour un CIP
// /.netlify/functions/medipim-debug2?cip=3400930137420&token=elixir2026

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const MEDIPIM_ID  = "288";
const MEDIPIM_KEY = "094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696";
const AUTH = "Basic " + Buffer.from(`${MEDIPIM_ID}:${MEDIPIM_KEY}`).toString("base64");

const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  const { cip, token } = event.queryStringParameters || {};
  if (token !== "elixir2026") return { statusCode: 403, headers: cors, body: "Forbidden" };

  const log = [];

  // Étape 1 : lookup Medipim
  log.push("--- ÉTAPE 1 : Lookup Medipim ---");
  let image_url = null;
  try {
    const r = await fetch(`${MEDIPIM_BASE}/products/find?cip13=${cip}`, {
      headers: { Authorization: AUTH }
    });
    log.push(`Status: ${r.status}`);
    const data = await r.json();
    const p = data.product || data;
    log.push(`Name: ${p.name?.fr}`);
    log.push(`Photos count: ${(p.photos||[]).length}`);
    log.push(`Frontals count: ${(p.frontals||[]).length}`);
    
    const mainPhoto = (p.frontals||[])[0] || (p.photos||[])[0];
    log.push(`mainPhoto formats: ${JSON.stringify(mainPhoto?.formats)}`);
    
    image_url = mainPhoto?.formats?.mediumWebp 
      || mainPhoto?.formats?.medium 
      || mainPhoto?.formats?.mediumJpeg
      || mainPhoto?.formats?.large;
    log.push(`image_url trouvée: ${image_url}`);
  } catch(e) {
    log.push(`ERREUR lookup: ${e.message}`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ log }) };
  }

  if (!image_url) {
    log.push("Pas d'image_url → arrêt");
    return { statusCode: 200, headers: cors, body: JSON.stringify({ log }) };
  }

  // Étape 2 : télécharger l'image
  log.push("--- ÉTAPE 2 : Téléchargement image ---");
  let imageBuffer, resolvedMime;
  try {
    const imgRes = await fetch(image_url);
    log.push(`Status téléchargement: ${imgRes.status}`);
    log.push(`Content-Type: ${imgRes.headers.get("content-type")}`);
    const arrayBuf = await imgRes.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuf);
    resolvedMime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    log.push(`Taille image: ${imageBuffer.length} bytes`);
  } catch(e) {
    log.push(`ERREUR download: ${e.message}`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ log }) };
  }

  // Étape 3 : upload Supabase Storage
  log.push("--- ÉTAPE 3 : Upload Supabase Storage ---");
  const ext = resolvedMime === "image/png" ? "png" : resolvedMime === "image/webp" ? "webp" : "jpg";
  const filename = `products/${cip}.${ext}`;
  log.push(`Fichier: ${filename}`);
  log.push(`SUPABASE_URL: ${SUPABASE_URL ? "✓ défini" : "✗ MANQUANT"}`);
  log.push(`SUPABASE_KEY: ${SUPABASE_KEY ? "✓ défini" : "✗ MANQUANT"}`);
  
  try {
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/elixir-images/${filename}`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": resolvedMime,
        "x-upsert": "true",
      },
      body: imageBuffer,
    });
    const uploadText = await uploadRes.text();
    log.push(`Status upload: ${uploadRes.status}`);
    log.push(`Réponse upload: ${uploadText}`);

    if (uploadRes.ok) {
      const pub_url = `${SUPABASE_URL}/storage/v1/object/public/elixir-images/${filename}`;
      log.push(`URL publique: ${pub_url}`);

      // Étape 4 : update DB
      log.push("--- ÉTAPE 4 : Update elixir_products ---");
      const updRes = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${cip}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ image_url: pub_url, updated_at: new Date().toISOString() }),
      });
      log.push(`Status DB update: ${updRes.status}`);
      log.push(`Réponse DB: ${await updRes.text()}`);
    }
  } catch(e) {
    log.push(`ERREUR upload: ${e.message}`);
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify({ log }, null, 2) };
};
