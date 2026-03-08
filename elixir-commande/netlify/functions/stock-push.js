import { getStore } from "@netlify/blobs";

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Agent-Token" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  try {
    const store = getStore("elixir-stock");
    const data = {
      stocks: payload.stocks,   // { [cip]: { dispo: 0|1, stock: number } }
      updatedAt: new Date().toISOString(),
    };
    await store.setJSON("catalog-stock", data);
    console.log(`[stock-push] ${Object.keys(payload.stocks || {}).length} produits mis à jour`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, count: Object.keys(payload.stocks || {}).length }) };
  } catch (err) {
    console.error("[stock-push] Erreur :", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
