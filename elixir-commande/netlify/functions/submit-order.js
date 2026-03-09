// Soumet une commande au frontal PharmaML via l'API INFOSOFT
// POST https://pharmaml.elixirpharma.fr/commandes.php?U=admin&P=xxxx
// Format JSON : [{ identifiantPML, referenceCommande, lignes: [{ CIP, libelle, quantiteCommandee, quantiteLivree, prix }] }]

const PHARMAML_URL  = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "";

export const handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { items, pharmacyName, pharmacyEmail, pharmacyCip, orderId } = payload;

  if (!items?.length) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "items manquants" }) };
  }
  if (!pharmacyCip) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "identifiantPML (pharmacyCip) manquant" }) };
  }

  // Construction du payload PharmaML JSON
  const body = [
    {
      identifiantPML: String(pharmacyCip),
      referenceCommande: String(orderId || Date.now()),
      lignes: items.map(i => ({
        CIP: i.cip || "",
        libelle: (i.name || "").substring(0, 50),
        quantiteCommandee: i.qty,
        quantiteLivree: i.qty, // à la commande, qté livrée = qté commandée
        prix: i.pn != null ? parseFloat(i.pn.toFixed(2)) : 0
      }))
    }
  ];

  try {
    const url = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    let result;
    try { result = JSON.parse(text); }
    catch { result = { raw: text }; }

    console.log(`[submit-order] PharmaML réponse (${res.status}):`, JSON.stringify(result));

    if (!res.ok || result?.status === "error") {
      const msg = result?.message || result?.errors?.[0]?.message || `HTTP ${res.status}`;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: msg, detail: result }) };
    }

    console.log(`[submit-order] ✓ Commande ${orderId} transmise à PharmaML pour ${pharmacyName} (${pharmacyCip})`);
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ success: true, commandes: result?.commandes || 1, pharmaml: result })
    };

  } catch (err) {
    console.error("[submit-order] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
