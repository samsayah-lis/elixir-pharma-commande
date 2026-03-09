const PHARMAML_URL  = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "";

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*" };

  // Test 1 : liste des commandes du jour (GET simple)
  const testUrl = `${PHARMAML_URL}/commandes.php/liste?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
  
  try {
    const res = await fetch(testUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    // Test 2 : envoyer une commande de test si ?send=1
    let sendResult = null;
    if (event.queryStringParameters?.send === "1") {
      const cip = event.queryStringParameters?.cip || "2014039"; // CIP7 pharmacie test
      const body = [{
        identifiantPML: cip,
        referenceCommande: "TEST-" + Date.now(),
        lignes: [{
          CIP: "3400930260494",
          libelle: "AMVUTTRA 25MG TEST",
          quantiteCommandee: 1,
          quantiteLivree: 1,
          prix: 65098.84
        }]
      }];
      const sendUrl = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
      const sendRes = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      const sendText = await sendRes.text();
      try { sendResult = { status: sendRes.status, body: JSON.parse(sendText) }; }
      catch { sendResult = { status: sendRes.status, body: sendText }; }
    }

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        config: {
          url: PHARMAML_URL,
          user: PHARMAML_USER,
          pass_set: !!PHARMAML_PASS,
          pass_length: PHARMAML_PASS.length
        },
        get_liste: { status: res.status, parsed, raw: text.substring(0, 500) },
        send_test: sendResult
      }, null, 2)
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, config: { url: PHARMAML_URL, user: PHARMAML_USER, pass_set: !!PHARMAML_PASS } }) };
  }
};
