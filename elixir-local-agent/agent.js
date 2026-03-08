import http from "http";
import https from "https";
import { URLSearchParams } from "url";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Charge .env manuellement (pas de dépendance externe)
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envContent = readFileSync(resolve(__dir, ".env"), "utf8");
  envContent.split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
} catch(e) { /* .env optionnel */ }

const CONFIG = {
  pharmaml_url:   process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr",
  username:       process.env.PHARMAML_USER || "admin",
  password:       process.env.PHARMAML_PASS || "A_CHANGER",
  netlify_url:    process.env.NETLIFY_URL   || "https://commandes-elixir.netlify.app",
  stock_interval: 5 * 60 * 1000,
  port:           parseInt(process.env.PORT || "3001"),
};

// CIPs du catalogue à surveiller (extraits du catalogue Elixir)
// L'agent va checker le dispo de chacun sur PharmaML
const CATALOG_CIPS = [
  // Expert
  "3400930083048","3400930260494","3400930073537","3400930073544","3400930067314",
  "3400930167267","3400930229385","3400926783501","3400930283325","3400930076279",
  "3400930141434","3400930141441","3400930075296","3400930075302","3400930075272",
  "3400930182482","3400930182505","3400930156162","3400930156179","3400930144824",
  "3400930091753","3400930108765","3400930091777","3400930108772","3400930091791",
  "3400930091807","3400930091814","3400930256527","3400930256534","3400930256541",
  "3400930256558","3400930138939","3400930175484","3400930175491","3400930064382",
  // Obeso
  "3400930258620","3400930317815","3400930258644","3400930260241","3400930258668",
  "3400930292907","3400930292914","3400930292938","3400930292945","3400930292952","3400930292976",
  // NR
  "3400930141861","3400930198087","3400930021972","3400930056296","3400930122044",
  "3400930139905","3400930179123","3400930150405","3400930164259","3400930177459",
  "3400930180644","3400930168332",
];

// ── HTTP helper avec suivi de redirections et collecte de cookies ─────────────

function httpsGet(urlStr, cookieJar = {}) {
  return new Promise((resolve, reject) => {
    const doRequest = (url, jar, redirects = 0) => {
      if (redirects > 10) return reject(new Error("Trop de redirections"));
      const u = new URL(url);
      const options = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept":     "text/html,application/json",
          "Cookie":     Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; "),
        },
      };
      const req = https.request(options, res => {
        // Collecte les cookies
        (res.headers["set-cookie"] || []).forEach(c => {
          const [kv] = c.split(";");
          const [k, ...rest] = kv.split("=");
          if (k) jar[k.trim()] = rest.join("=");
        });
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (!loc.startsWith("http")) loc = CONFIG.pharmaml_url + loc;
          res.resume();
          return doRequest(loc, jar, redirects + 1);
        }
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => resolve({ status: res.statusCode, url, headers: res.headers, body, jar }));
      });
      req.on("error", reject);
      req.end();
    };
    doRequest(urlStr, cookieJar, 0);
  });
}

function httpsPost(urlStr, body, extraHeaders = {}, cookieJar = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const options = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Cookie":     Object.entries(cookieJar).map(([k,v]) => `${k}=${v}`).join("; "),
        "Content-Length": bodyBuf.length,
        ...extraHeaders,
      },
    };
    const req = https.request(options, res => {
      (res.headers["set-cookie"] || []).forEach(c => {
        const [kv] = c.split(";");
        const [k, ...rest] = kv.split("=");
        if (k) cookieJar[k.trim()] = rest.join("=");
      });
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data, jar: cookieJar }));
    });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login() {
  const jar = {};

  // 1. GET /login — récupère page + cookies initiaux
  const getResp = await httpsGet(`${CONFIG.pharmaml_url}/login`, jar);
  console.log(`  [login] GET → ${getResp.status}, cookies: ${Object.keys(jar).join(", ")}`);

  // Détecte tous les champs name="..." et value="..." dans la page
  const fields = [...getResp.body.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
  console.log(`  [login] champs: ${fields.join(", ")}`);

  // Cherche le token CSRF quel que soit son nom (_csrf_token, _token, csrf_token…)
  const csrfFieldMatch = getResp.body.match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i)
                      || getResp.body.match(/value="([^"]+)"[^>]*name="([^"]*csrf[^"]*)"/i);
  const csrfName  = csrfFieldMatch ? csrfFieldMatch[1] : null;
  const csrfValue = csrfFieldMatch ? csrfFieldMatch[2] : null;
  console.log(`  [login] csrf: ${csrfName || "non"} = ${csrfValue ? csrfValue.substring(0,20)+"…" : "—"}`);

  // 2. POST credentials avec tous les noms de champs détectés
  const formBody = new URLSearchParams({
    login:    CONFIG.username,
    username: CONFIG.username,
    email:    CONFIG.username,
    password: CONFIG.password,
    passwd:   CONFIG.password,
  });
  if (csrfName && csrfValue) formBody.append(csrfName, csrfValue);

  const postResp = await httpsPost(
    `${CONFIG.pharmaml_url}/login`,
    formBody.toString(),
    { "Content-Type": "application/x-www-form-urlencoded", "Referer": `${CONFIG.pharmaml_url}/login`, "Accept": "text/html" },
    jar
  );
  console.log(`  [login] POST → ${postResp.status}, location: ${postResp.headers.location || "—"}, cookies: ${Object.keys(jar).join(", ")}`);

  // 3. Suit la redirection si 302
  if (postResp.status >= 300 && postResp.status < 400) {
    let loc = postResp.headers.location || "/";
    if (!loc.startsWith("http")) loc = CONFIG.pharmaml_url + loc;
    const redirResp = await httpsGet(loc, jar);
    console.log(`  [login] Redir → ${redirResp.status} (${loc}), cookies: ${Object.keys(jar).join(", ")}`);
  }

  // 4. Vérifie l'accès à /commandes/saisie
  const check = await httpsGet(`${CONFIG.pharmaml_url}/commandes/saisie`, jar);
  console.log(`  [login] Vérif commandes → ${check.status} (url finale: ${check.url})`);

  if (check.url.includes("/401") || check.url.includes("/login") || check.status === 401) {
    throw new Error(`Login échoué — url finale: ${check.url}`);
  }

  console.log("  ✓ Authentifié sur PharmaML");
  return jar;
}

// ── Upload CSV ────────────────────────────────────────────────────────────────

async function uploadCsv(jar, csvContent) {
  const boundary = "----ElixirBoundary" + Date.now();
  const CRLF = "\r\n";
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}${CRLF}`),
    Buffer.from(`Content-Disposition: form-data; name="fichierImport"; filename="commande.csv"${CRLF}`),
    Buffer.from(`Content-Type: text/csv${CRLF}`),
    Buffer.from(CRLF),
    Buffer.from(csvContent, "utf-8"),
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ]);

  const resp = await httpsPost(
    `${CONFIG.pharmaml_url}/commandes/fichierSaisie`,
    bodyBuf,
    {
      "Content-Type":     `multipart/form-data; boundary=${boundary}`,
      "Accept":           "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "Referer":          `${CONFIG.pharmaml_url}/commandes/saisie`,
    },
    jar
  );

  console.log(`  [upload] → ${resp.status}, body: ${resp.body.substring(0, 100)}`);

  if (resp.status >= 300 && resp.status < 400) {
    throw new Error(`Upload redirigé vers ${resp.headers.location} — session invalide`);
  }
  if (resp.status !== 200) throw new Error(`Upload CSV échoué : HTTP ${resp.status}`);

  const json = JSON.parse(resp.body);
  if (json.status !== "success") throw new Error(`Fichier rejeté : ${json.message || resp.body}`);
  return { commande: json.data, clientFromFile: json.client || null };
}

// ── Find adherent ────────────────────────────────────────────────────────────

async function findAdherent(jar, pharmacyName, pharmacyEmail) {
  const q = encodeURIComponent((pharmacyName || "").substring(0, 30));
  const u = new URL(`${CONFIG.pharmaml_url}/adherents/api/listeS2?q=${q}&page=1`);
  const cookieStr = Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ");

  const resp = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "GET",
      headers: { Cookie: cookieStr, Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    }, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });

  console.log(`  [adherent] → ${resp.status}, body: ${resp.body.substring(0, 150)}`);
  if (resp.status !== 200) return null;
  const data = JSON.parse(resp.body);
  const results = data.results || data.items || [];
  if (!results.length) return null;

  const emailLower = (pharmacyEmail || "").toLowerCase();
  const nameLower  = (pharmacyName  || "").toLowerCase();
  const match = results.find(r => (r.email||"").toLowerCase() === emailLower)
             || results.find(r => (r.text||r.nom||"").toLowerCase().includes(nameLower))
             || results[0];
  console.log(`  [adherent] trouvé: ${match?.text || match?.id} (id=${match?.id})`);
  return match?.id || null;
}

// ── Submit order ──────────────────────────────────────────────────────────────

async function submitOrder(jar, commande, idAdherent, ref) {
  const payload = { commande, referenceCommande: ref || "", codeSpeciale: "", etatCommande: 0 };
  if (idAdherent) payload.idAdherent = idAdherent;

  const body = JSON.stringify(payload);
  const resp = await httpsPost(
    `${CONFIG.pharmaml_url}/commandes/api/saisie`,
    body,
    { "Content-Type": "application/json", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" },
    jar
  );

  console.log(`  [submit] → ${resp.status}, body: ${resp.body.substring(0, 300)}`);
  if (resp.status !== 200) throw new Error(`Envoi échoué : HTTP ${resp.status} — ${resp.body.substring(0,300)}`);
  const json = JSON.parse(resp.body);
  if (json.status !== "success") throw new Error(`Commande refusée : ${json.message || (json.erreurs||[]).join(", ")}`);
  return json;
}

// ── Stock checker ────────────────────────────────────────────────────────────

let currentStocks = {};  // stocké en mémoire, servi via GET /stock
let stocksUpdatedAt = null;
let stockJar = null;

async function discoverStockApi(jar) {
  const host = new URL(CONFIG.pharmaml_url).hostname;
  const cookieStr = Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ");
  const testCip = CATALOG_CIPS[0]; // 3400930083048

  const endpoints = [
    `/articles/api/search?q=${testCip}&page=1`,
    `/articles/api/search?q=${testCip}`,
    `/articles/api/listeS2?q=${testCip}&page=1`,
    `/commandes/api/articles?q=${testCip}`,
    `/commandes/api/search?q=${testCip}`,
    `/articles/search?q=${testCip}`,
    `/api/articles?cip=${testCip}`,
    `/api/search?q=${testCip}`,
    `/commandes/fichierSaisie?cip=${testCip}`,
    `/articles?q=${testCip}`,
  ];

  console.log("  [stock] Découverte de l'API stock...");
  for (const path of endpoints) {
    const resp = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host, path, method: "GET",
        headers: { Cookie: cookieStr, Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      }, res => {
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
    const preview = resp.body.substring(0, 120).replace(/\n/g, " ");
    console.log(`  [stock] ${path} → HTTP ${resp.status} | ${preview}`);
    await new Promise(r => setTimeout(r, 100));
  }
  console.log("  [stock] Fin découverte — analyse les résultats ci-dessus");
  return {};
}

async function checkStock(jar) {
  // Pour l'instant : mode découverte — remplacé une fois l'API connue
  return await discoverStockApi(jar);
}

async function runStockCheck() {
  try {
    if (!stockJar) stockJar = await login();
    const stocks = await checkStock(stockJar);
    currentStocks = stocks;
    stocksUpdatedAt = new Date().toISOString();
    const count = Object.keys(stocks).length;
    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    const ts = new Date().toLocaleTimeString("fr-FR");
    console.log(`[${ts}] 📦 Stocks : ${count} produits vérifiés, ${ruptures} rupture(s)`);
  } catch (err) {
    console.warn(`[stock] Erreur : ${err.message}`);
    stockJar = null;
  }
}

// ── Serveur local ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  // GET /stock — retourne les données de stock en mémoire
  if (req.method === "GET" && req.url === "/stock") {
    res.writeHead(200);
    res.end(JSON.stringify({ stocks: currentStocks, updatedAt: stocksUpdatedAt }));
    return;
  }

  if (req.method !== "POST")    { res.writeHead(405); res.end(JSON.stringify({ error: "POST only" })); return; }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let payload;
  try { payload = JSON.parse(raw); }
  catch { res.writeHead(400); res.end(JSON.stringify({ error: "JSON invalide" })); return; }

  const { csvContent, pharmacyName, pharmacyEmail, orderId } = payload;
  if (!csvContent) { res.writeHead(400); res.end(JSON.stringify({ error: "csvContent manquant" })); return; }

  const ts = new Date().toLocaleTimeString("fr-FR");
  console.log(`\n[${ts}] Nouvelle commande : ${pharmacyName} (id: ${orderId})`);

  try {
    const jar = await login();
    const [{ commande, clientFromFile }, idAdherent] = await Promise.all([
      uploadCsv(jar, csvContent),
      findAdherent(jar, pharmacyName, pharmacyEmail),
    ]);
    console.log(`  ✓ CSV parsé : ${commande.length} ligne(s)`);
    const finalId = clientFromFile || idAdherent;
    if (!finalId) throw new Error("Officine introuvable dans PharmaML — vérifiez le nom ou l'email");
    await submitOrder(jar, commande, finalId, String(orderId || ""));
    console.log(`  ✓ Commande créée sur PharmaML !\n`);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, nbLignes: commande.length }));
  } catch (err) {
    console.error(`  ✗ Erreur : ${err.message}\n`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n⚠️  Port ${CONFIG.port} déjà utilisé. Lance: kill $(lsof -ti:${CONFIG.port})\n`);
  } else { console.error(err); }
  process.exit(1);
});

server.listen(CONFIG.port, "127.0.0.1", () => {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║     Elixir Pharma — Agent local PharmaML          ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  console.log(`║  Serveur actif sur http://localhost:${CONFIG.port}         ║`);
  console.log(`║  Connecté en tant que : ${CONFIG.username.padEnd(26)}║`);
  console.log(`║  Vérif stocks toutes les 5 minutes                ║`);
  console.log("╚═══════════════════════════════════════════════════╝");

  // Première vérification immédiate, puis toutes les 5 min
  runStockCheck();
  setInterval(runStockCheck, CONFIG.stock_interval);
});
