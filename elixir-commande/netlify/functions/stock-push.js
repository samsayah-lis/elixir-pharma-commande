export const handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("elixir-stock");
    await store.setJSON("catalog-stock", {
      stocks: payload.stocks,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[stock-push] ${Object.keys(payload.stocks || {}).length} produits`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("[stock-push] Erreur Blobs:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
