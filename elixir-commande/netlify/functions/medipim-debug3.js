// Debug : teste tous les paramètres possibles pour un EAN
const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const MEDIPIM_ID  = "288";
const MEDIPIM_KEY = "094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696";
const AUTH = "Basic " + Buffer.from(`${MEDIPIM_ID}:${MEDIPIM_KEY}`).toString("base64");

export const handler = async (event) => {
  const { cip, token } = event.queryStringParameters || {};
  if (token !== "elixir2026") return { statusCode: 403, body: "Forbidden" };

  const params = ["cip13", "barcode", "ean13", "barcode13", "code"];
  const results = {};

  for (const param of params) {
    const url = `${MEDIPIM_BASE}/products/find?${param}=${cip}`;
    try {
      const res = await fetch(url, { headers: { Authorization: AUTH } });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      results[param] = {
        status: res.status,
        image_url: parsed?.product?.frontals?.[0]?.formats?.medium
          || parsed?.product?.photos?.[0]?.formats?.medium
          || null,
        has_product: !!parsed?.product,
        name: parsed?.product?.name?.fr || null,
      };
    } catch (e) {
      results[param] = { error: e.message };
    }
  }

  // Essai search par nom de marque
  const searchUrl = `${MEDIPIM_BASE}/products/search?q=${encodeURIComponent(cip)}&limit=1`;
  try {
    const res = await fetch(searchUrl, { headers: { Authorization: AUTH } });
    results["search"] = { status: res.status, body: await res.text() };
  } catch(e) { results["search"] = { error: e.message }; }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results, null, 2)
  };
};
