const BASE     = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const USERNAME = process.env.PHARMAML_USER || "admin";
const PASSWORD = process.env.PHARMAML_PASS || "";

function extractCookies(response) {
  const raw = response.headers.getSetCookie?.() || [];
  return raw.map(c => c.split(";")[0]).join("; ");
}

function mergeCookies(existing, fresh) {
  if (!fresh) return existing;
  const map = {};
  [...existing.split("; "), ...fresh.split("; ")]
    .filter(Boolean)
    .forEach(c => { const [k, ...rest] = c.split("="); if (k) map[k.trim()] = rest.join("="); });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login() {
  // GET login page — récupère le formulaire et le cookie de session initial
  const getResp = await fetch(`${BASE}/login`, {
    redirect: "follow",
    headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0" }
  });
  console.log(`[login] GET /login → ${getResp.status} (${getResp.url})`);
  let cookies = extractCookies(getResp);
  console.log(`[login] cookies initiaux : ${cookies.substring(0, 80)}`);

  const html = await getResp.text().catch(() => "");
  // Log les champs du formulaire détectés
  const fields = [...html.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
  console.log(`[login] champs formulaire détectés : ${fields.join(", ")}`);
  const csrf = html.match(/name="_token"\s+value="([^"]+)"/)?.[1]
            || html.match(/value="([a-zA-Z0-9\/+]{40,})"/)?.[1]
            || null;
  console.log(`[login] csrf token : ${csrf ? csrf.substring(0,20)+"…" : "aucun"}`);

  // POST avec tous les noms de champs possibles
  const body = new URLSearchParams();
  body.append("login",    USERNAME);
  body.append("password", PASSWORD);
  body.append("username", USERNAME);
  body.append("email",    USERNAME);
  body.append("passwd",   PASSWORD);
  body.append("pass",     PASSWORD);
  if (csrf) body.append("_token", csrf);

  const postResp = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookies,
      "User-Agent": "Mozilla/5.0",
      "Referer": `${BASE}/login`,
    },
    body: body.toString(),
    redirect: "manual",
  });
  console.log(`[login] POST /login → ${postResp.status} location=${postResp.headers.get("location")}`);
  const freshCookies = extractCookies(postResp);
  console.log(`[login] nouveaux cookies : ${freshCookies.substring(0,80)}`);
  cookies = mergeCookies(cookies, freshCookies);

  // Suit la redirection manuellement si 302
  let finalUrl = postResp.headers.get("location");
  if (finalUrl && postResp.status >= 300 && postResp.status < 400) {
    if (!finalUrl.startsWith("http")) finalUrl = BASE + finalUrl;
    const redirResp = await fetch(finalUrl, {
      headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
    });
    console.log(`[login] Redirect → ${redirResp.status} (${finalUrl})`);
    cookies = mergeCookies(cookies, extractCookies(redirResp));
  }

  // Vérifie l'accès à la page commandes
  const check = await fetch(`${BASE}/commandes/saisie`, {
    headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  console.log(`[login] Vérif /commandes/saisie → ${check.status} (${check.url})`);
  if (check.url?.includes("/login") || check.url?.includes("/401") || check.status === 401) {
    throw new Error(`Échec d'authentification — status=${check.status} url=${check.url}`);
  }
  return cookies;
}

async function findAdherent(cookies, pharmacyName, pharmacyEmail) {
  const q = (pharmacyName || "").substring(0, 30);
  const resp = await fetch(`${BASE}/adherents/api/listeS2?q=${encodeURIComponent(q)}&page=1`, {
    headers: { Cookie: cookies, Accept: "application/json" },
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  if (!data?.results?.length) return null;
  const emailLower = (pharmacyEmail || "").toLowerCase();
  const nameLower  = (pharmacyName  || "").toLowerCase();
  const match = data.results.find(r => r.email?.toLowerCase() === emailLower)
             || data.results.find(r => r.text?.toLowerCase().includes(nameLower));
  return match?.id || data.results[0]?.id || null;
}

async function uploadCsv(cookies, csvContent) {
  const form = new FormData();
  const blob = new Blob([csvContent], { type: "text/csv" });
  form.append("fichierImport", blob, "commande.csv");
  const resp = await fetch(`${BASE}/commandes/fichierSaisie`, {
    method:  "POST",
    headers: { Cookie: cookies },
    body:    form,
  });
  if (!resp.ok) throw new Error(`Upload CSV échoué : HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.status !== "success") throw new Error(`Fichier rejeté : ${json.message || JSON.stringify(json)}`);
  return { commande: json.data, clientFromFile: json.client || null };
}

async function submitOrder(cookies, commande, idAdherent, ref) {
  const payload = { commande, referenceCommande: ref || "", codeSpeciale: "", etatCommande: 0 };
  if (idAdherent) payload.idAdherent = idAdherent;
  const resp = await fetch(`${BASE}/commandes/api/saisie`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies, Accept: "application/json" },
    body:    JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Envoi échoué : HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.status !== "success") throw new Error(`Commande refusée : ${json.message || (json.erreurs||[]).join(", ")}`);
  return json;
}

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { csvContent, pharmacyName, pharmacyEmail, orderId } = payload;
  if (!csvContent) return { statusCode: 400, body: JSON.stringify({ error: "csvContent manquant" }) };

  try {
    console.log(`[submit-order] ${orderId} — ${pharmacyName}`);
    const cookies    = await login();
    console.log("[submit-order] Auth ✓");
    const idAdherent = await findAdherent(cookies, pharmacyName, pharmacyEmail);
    console.log(`[submit-order] idAdherent=${idAdherent}`);
    const { commande, clientFromFile } = await uploadCsv(cookies, csvContent);
    console.log(`[submit-order] CSV parsé : ${commande.length} ligne(s)`);
    await submitOrder(cookies, commande, clientFromFile || idAdherent, String(orderId || ""));
    console.log("[submit-order] Commande validée ✓");
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, nbLignes: commande.length }) };
  } catch (err) {
    console.error("[submit-order] Erreur :", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
