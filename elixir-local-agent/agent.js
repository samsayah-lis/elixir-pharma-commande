import http from "http";
import https from "https";
import { URLSearchParams } from "url";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Charge .env
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
  odoo_url:       process.env.ODOO_URL      || "https://odoo.elixir-pharma.fr",
  odoo_db:        process.env.ODOO_DB       || "healthsoft-sas-lispharma-main-13622653",
  odoo_user:      process.env.ODOO_USER     || "pharmacien@elixirpharma.fr",
  odoo_pass:      process.env.ODOO_APIKEY   || process.env.ODOO_PASS || "A_CHANGER",
  odoo_company:   parseInt(process.env.ODOO_COMPANY || "2"),
  odoo_location_prefix: process.env.ODOO_LOCATION_PREFIX || "EP/Stock/",
  odoo_location_from:   process.env.ODOO_LOCATION_FROM   || "D",
  odoo_location_to:     process.env.ODOO_LOCATION_TO     || "U",
};

const CATALOG_CIPS = [
  "3400930083048","3400930260494","3400930073537","3400930073544","3400930067314",
  "3400930167267","3400930229385","3400926783501","3400930283325","3400930076279",
  "3400930141434","3400930141441","3400930075296","3400930075302","3400930075272",
  "3400930182482","3400930182505","3400930156162","3400930156179","3400930144824",
  "3400930091753","3400930108765","3400930091777","3400930108772","3400930091791",
  "3400930091807","3400930091814","3400930256527","3400930256534","3400930256541",
  "3400930256558","3400930138939","3400930175484","3400930175491","3400930064382",
  "3400930258620","3400930317815","3400930258644","3400930260241","3400930258668",
  "3400930292907","3400930292914","3400930292938","3400930292945","3400930292952","3400930292976",
  "3400930141861","3400930198087","3400930021972","3400930056296","3400930122044",
  "3400930139905","3400930179123","3400930150405","3400930164259","3400930177459",
  "3400930180644","3400930168332",
];



// ── Odoo XML-RPC ─────────────────────────────────────────────────────────────
// Utilise xmlrpc natif via https direct

function xmlVal(type, val) {
  if (type === "int")    return `<value><int>${val}</int></value>`;
  if (type === "string") return `<value><string>${String(val).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</string></value>`;
  if (type === "bool")   return `<value><boolean>${val ? 1 : 0}</boolean></value>`;
  if (type === "array")  return `<value><array><data>${val}</data></array></value>`;
  if (type === "struct") return `<value><struct>${val}</struct></value>`;
  return `<value>${val}</value>`;
}
function xmlMember(name, val) { return `<member><name>${name}</name>${val}</member>`; }
function xmlTuple(...items) { return xmlVal("array", items.join("")); }

function buildXmlrpcCall(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${
    params.map(p => `<param>${p}</param>`).join("")
  }</params></methodCall>`;
}

function xmlrpcPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.from(body, "utf-8");
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: "POST",
      headers: { "Content-Type": "text/xml", "Content-Length": buf.length },
    }, res => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(buf); req.end();
  });
}

// Parse Odoo XML-RPC response — retourne tableau d'objets
function parseOdooResponse(xml) {
  if (xml.includes("<fault>")) {
    const msg = xml.match(/<n(?:ame)?>faultString<\/n(?:ame)?>/) && 
                xml.match(/<n(?:ame)?>faultString<\/n(?:ame)?>\s*<value><string>([\s\S]*?)<\/string>/)?.[1]
              || xml.match(/<string>([\s\S]{5,200}?)<\/string>/)?.[1]
              || "Fault";
    throw new Error(String(msg).substring(0, 200));
  }
  const results = [];
  // Match each <struct>...</struct> block
  let sIdx = 0;
  while (true) {
    const sStart = xml.indexOf("<struct>", sIdx);
    if (sStart === -1) break;
    const sEnd = xml.indexOf("</struct>", sStart);
    if (sEnd === -1) break;
    const block = xml.slice(sStart + 8, sEnd);
    sIdx = sEnd + 9;
    const obj = {};
    // Match members: <member><n[ame]>key</n[ame]><value>val</value></member>
    let mIdx = 0;
    while (true) {
      const mStart = block.indexOf("<member>", mIdx);
      if (mStart === -1) break;
      const mEnd = block.indexOf("</member>", mStart);
      if (mEnd === -1) break;
      const member = block.slice(mStart + 8, mEnd);
      mIdx = mEnd + 9;
      // Extract key from <n>key</n> or <n>key</n>
      const keyMatch = member.match(/<n(?:ame)?>([^<]+)<\/n(?:ame)?>/);
      const valMatch = member.match(/<value>([\s\S]*?)<\/value>/);
      if (keyMatch && valMatch) {
        const key = keyMatch[1].trim();
        const val = valMatch[1].replace(/<[^>]+>/g, "").trim();
        obj[key] = val;
      }
    }
    if (Object.keys(obj).length > 0) results.push(obj);
  }
  return results;
}

// Parse une valeur scalaire (int, bool, string) depuis une réponse XML-RPC
function parseScalar(xml) {
  const i = xml.match(/<int>(\d+)<\/int>/)?.[1];
  if (i) return parseInt(i);
  const s = xml.match(/<string>([\s\S]*?)<\/string>/)?.[1];
  if (s) return s;
  return null;
}

function encodeDomainItem(d) {
  if (d === "|" || d === "&" || d === "!") return xmlVal("string", d);
  if (!Array.isArray(d)) return "";
  const [f, op, v] = d;
  let vXml;
  if (Array.isArray(v)) {
    vXml = xmlVal("array", v.map(x => typeof x === "number" ? xmlVal("int", x) : xmlVal("string", String(x))).join(""));
  } else if (typeof v === "number") { vXml = xmlVal("int", v); }
  else if (typeof v === "boolean")  { vXml = xmlVal("bool", v); }
  else { vXml = xmlVal("string", String(v)); }
  return xmlVal("array", [xmlVal("string", f), xmlVal("string", op), vXml].join(""));
}

async function odooCall(uid, model, method, domain, kwargs = {}) {
  // args = [[domain]] — un tableau contenant le domain comme premier argument
  const domainItems = domain.map(encodeDomainItem).join("");
  const argsXml = xmlVal("array", xmlVal("array", domainItems));

  // kwargs struct
  const kwargsMembers = Object.entries(kwargs).map(([k, v]) => {
    let vXml;
    if (Array.isArray(v))        vXml = xmlVal("array", v.map(x => xmlVal("string", String(x))).join(""));
    else if (typeof v === "number") vXml = xmlVal("int", v);
    else                         vXml = xmlVal("string", String(v));
    return xmlMember(k, vXml);
  }).join("");
  const kwargsXml = xmlVal("struct", kwargsMembers);

  const body = buildXmlrpcCall("execute_kw", [
    xmlVal("string", CONFIG.odoo_db),
    xmlVal("int", uid),
    xmlVal("string", CONFIG.odoo_pass),
    xmlVal("string", model),
    xmlVal("string", method),
    argsXml,
    kwargsXml,
  ]);

  const xml = await xmlrpcPost(`${CONFIG.odoo_url}/xmlrpc/2/object`, body);
  return parseOdooResponse(xml);
}

async function odooListDbs() {
  const body = buildXmlrpcCall("list", []);
  const xml = await xmlrpcPost(`${CONFIG.odoo_url}/xmlrpc/2/db`, body);
  const dbs = [...xml.matchAll(/<string>([^<]+)<\/string>/g)].map(m => m[1]);
  return dbs;
}

async function odooAuthenticate() {
  // Auto-découverte de la base si celle configurée échoue
  const body = buildXmlrpcCall("authenticate", [
    xmlVal("string", CONFIG.odoo_db),
    xmlVal("string", CONFIG.odoo_user),
    xmlVal("string", CONFIG.odoo_pass),
    xmlVal("struct", ""),
  ]);
  const xml = await xmlrpcPost(`${CONFIG.odoo_url}/xmlrpc/2/common`, body);
  const uid = parseScalar(xml);
  if (!uid || uid === 0) {
    // Essaie de lister les bases disponibles
    try {
      const dbs = await odooListDbs();
      console.log(`  [odoo] Bases disponibles : ${dbs.join(", ")}`);
      if (dbs.length === 1) {
        console.log(`  [odoo] → Tentative avec "${dbs[0]}"...`);
        CONFIG.odoo_db = dbs[0];
        const body2 = buildXmlrpcCall("authenticate", [
          xmlVal("string", CONFIG.odoo_db),
          xmlVal("string", CONFIG.odoo_user),
          xmlVal("string", CONFIG.odoo_pass),
          xmlVal("struct", ""),
        ]);
        const xml2 = await xmlrpcPost(`${CONFIG.odoo_url}/xmlrpc/2/common`, body2);
        const uid2 = parseScalar(xml2);
        if (uid2 && uid2 > 0) { console.log(`  ✓ Odoo auth OK (uid=${uid2}, db=${dbs[0]})`); return uid2; }
      }
    } catch(e) { console.log(`  [odoo] List DB: ${e.message}`); }
    throw new Error("Odoo auth échouée — vérifiez ODOO_USER et ODOO_PASS dans .env");
  }
  console.log(`  ✓ Odoo auth OK (uid=${uid}, db=${CONFIG.odoo_db})`);
  return uid;
}

// ── Stock checker ────────────────────────────────────────────────────────────

let currentStocks = {};
let stocksUpdatedAt = null;

async function checkStock() {
  const uid = await odooAuthenticate();

  // 1. Cherche directement les produits dont le barcode = CIP du catalogue
  const cipDomain = [];
  if (CATALOG_CIPS.length > 1)
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) cipDomain.push("|");
  CATALOG_CIPS.forEach(cip => cipDomain.push(["barcode", "=", cip]));

  const products = await odooCall(uid, "product.product", "search_read", cipDomain, {
    fields: ["id", "barcode", "name"], limit: 200
  });
  console.log(`  [odoo] ${products.length} produits trouvés par CIP sur ${CATALOG_CIPS.length} recherchés`);
  if (products.length > 0)
    console.log(`  [odoo] ex: ${products[0].name} (barcode=${products[0].barcode})`);

  if (products.length === 0) {
    console.warn("  [odoo] ⚠ Aucun produit ne correspond aux CIPs — vérifie que le barcode = CIP13 dans Odoo");
    return {};
  }

  const productIds = products.map(p => parseInt(p.id)).filter(Boolean);
  const barcodeByPid = {};
  products.forEach(p => { barcodeByPid[parseInt(p.id)] = p.barcode; });

  // 3. stock.quant : tous les emplacements internes de la société
  const quants = await odooCall(uid, "stock.quant", "search_read", [
    ["product_id", "in", productIds],
    ["company_id", "=", CONFIG.odoo_company],
    ["location_id.usage", "=", "internal"],
  ], { fields: ["product_id", "quantity", "reserved_quantity"], limit: 2000 });
  console.log(`  [odoo] ${quants.length} lignes de stock`);

  // 4. Agrège stock disponible par barcode (CIP)
  const stockByCip = {};
  quants.forEach(q => {
    const barcode = barcodeByPid[parseInt(q.product_id)];
    if (!barcode) return;
    const dispo = parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0);
    stockByCip[barcode] = (stockByCip[barcode] || 0) + dispo;
  });

  // 5. Résultat pour tous les CIPs
  const stocks = {};
  CATALOG_CIPS.forEach(cip => {
    if (stockByCip[cip] !== undefined) {
      const s = stockByCip[cip];
      stocks[cip] = { dispo: s > 0 ? 1 : 0, stock: Math.round(s) };
    } else {
      // Produit connu dans Odoo mais pas dans ces emplacements = rupture
      const isKnown = products.some(p => p.barcode === cip);
      stocks[cip] = { dispo: isKnown ? 0 : 1, stock: 0 };
    }
  });

  const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
  console.log(`  [odoo] ✓ ${products.length} produits matchés · ${ruptures} rupture(s)`);
  return stocks;
}


async function runStockCheck() {
  const ts = new Date().toLocaleTimeString("fr-FR");
  try {
    // Debug: liste les bases disponibles
    try {
      const dbs = await odooListDbs();
      console.log(`  [odoo] Bases disponibles sur ${CONFIG.odoo_url} : [${dbs.join(", ")}]`);
      if (dbs.length > 0 && !dbs.includes(CONFIG.odoo_db) && dbs[0] !== "Access Denied") {
        console.log(`  [odoo] ⚠ "${CONFIG.odoo_db}" introuvable → utilise "${dbs[0]}"`);
        CONFIG.odoo_db = dbs[0];
      }
    } catch(e) { console.log(`  [odoo] List DB erreur: ${e.message}`); }

    console.log(`[${ts}] 📦 Vérification stock Odoo (db=${CONFIG.odoo_db})...`);
    const stocks = await checkStock();
    currentStocks = stocks;
    stocksUpdatedAt = new Date().toISOString();
    const count = Object.values(stocks).filter(s => s.stock > 0).length;
    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log(`[${ts}] ✓ ${count} produits en stock · ${ruptures} rupture(s)`);
  } catch (err) {
    console.warn(`[${ts}] ✗ Stock Odoo : ${err.message}`);
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
