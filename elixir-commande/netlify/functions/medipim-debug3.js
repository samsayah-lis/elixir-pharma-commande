const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const AUTH = "Basic " + Buffer.from("288:094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696").toString("base64");
const H = { Authorization: AUTH };

export const handler = async (event) => {
  const { cip, token } = event.queryStringParameters || {};
  if (token !== "elixir2026") return { statusCode: 403, body: "Forbidden" };

  // Teste tous les noms de paramètres possibles
  const params = ["cip13", "cip7", "cip", "acl", "acl7", "barcode", "ean13", "code7", "reference"];
  const results = {};

  for (const param of params) {
    try {
      const res = await fetch(`${MEDIPIM_BASE}/products/find?${param}=${cip}`, { headers: H });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      const p = parsed?.product;
      const mainPhoto = (p?.frontals || [])[0] || (p?.photos || [])[0];
      results[param] = {
        status: res.status,
        has_product: !!p,
        name: p?.name?.fr || null,
        image_url: mainPhoto?.formats?.medium || mainPhoto?.formats?.mediumJpeg || null,
        raw: !p ? text.slice(0, 100) : undefined,
      };
    } catch (e) {
      results[param] = { error: e.message };
    }
  }

  // Aussi tester le endpoint /products/{id} avec l'ID Medipim si connu
  // Et tenter une liste paginée filtrée
  try {
    const res = await fetch(`${MEDIPIM_BASE}/products?limit=1&q=${cip}`, { headers: H });
    const text = await res.text();
    results["list_q"] = { status: res.status, raw: text.slice(0, 200) };
  } catch(e) { results["list_q"] = { error: e.message }; }

  try {
    const res = await fetch(`${MEDIPIM_BASE}/products?limit=1&filter[acl]=${cip}`, { headers: H });
    results["list_filter_acl"] = { status: res.status, raw: (await res.text()).slice(0, 200) };
  } catch(e) { results["list_filter_acl"] = { error: e.message }; }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results, null, 2)
  };
};
