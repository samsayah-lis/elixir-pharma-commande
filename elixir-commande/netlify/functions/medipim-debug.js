// Debug : retourne la réponse brute Medipim pour un CIP donné
// Appel : /.netlify/functions/medipim-debug?cip=3400930137420&token=elixir2026

const MEDIPIM_BASE = "https://api.medipim.fr/v4";
const MEDIPIM_ID  = "288";
const MEDIPIM_KEY = "094fc1eed6142243036e51b3fa54b4dd6a25088cee8e5ed1e9f7036099cbf696";
const AUTH = "Basic " + Buffer.from(`${MEDIPIM_ID}:${MEDIPIM_KEY}`).toString("base64");

const cors = { "Access-Control-Allow-Origin": "*" };

export const handler = async (event) => {
  const { cip, token } = event.queryStringParameters || {};
  if (token !== "elixir2026") return { statusCode: 403, headers: cors, body: "Forbidden" };
  if (!cip) return { statusCode: 400, headers: cors, body: "cip requis" };

  const results = {};

  // Test 1 : find par cip13
  try {
    const r1 = await fetch(`${MEDIPIM_BASE}/products/find?cip13=${cip}`, {
      headers: { Authorization: AUTH }
    });
    results.find_cip13 = { status: r1.status, body: await r1.json().catch(() => r1.text()) };
  } catch(e) { results.find_cip13 = { error: e.message }; }

  // Test 2 : find par barcode
  try {
    const r2 = await fetch(`${MEDIPIM_BASE}/products/find?barcode=${cip}`, {
      headers: { Authorization: AUTH }
    });
    results.find_barcode = { status: r2.status, body: await r2.json().catch(() => r2.text()) };
  } catch(e) { results.find_barcode = { error: e.message }; }

  // Test 3 : query par cip13 (POST)
  try {
    const r3 = await fetch(`${MEDIPIM_BASE}/products/query`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { cip13: { value: cip } } })
    });
    results.query_cip13 = { status: r3.status, body: await r3.json().catch(() => r3.text()) };
  } catch(e) { results.query_cip13 = { error: e.message }; }

  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(results, null, 2)
  };
};
