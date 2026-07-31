import http from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(resolve(__dirname, ".env"), "utf8");
  envFile.split("\n").forEach(line => {
    const [k, ...rest] = line.split("=");
    if (k && !k.startsWith("#")) process.env[k.trim()] = rest.join("=").trim();
  });
} catch {}

const PHARMAML_URL  = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "A_CHANGER";
const SITE_URL      = process.env.SITE_URL       || "https://commandes-elixir.netlify.app";
const PORT = parseInt(process.env.PORT || "3001");



// ── Helpers ───────────────────────────────────────────────────────────────
const ts = () => new Date().toLocaleTimeString("fr-FR");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Lookup CIP from Netlify pharmacy-lookup endpoint
async function lookupCip(email) {
  if (!email) return null;
  try {
    const res = await fetch(`${SITE_URL}/.netlify/functions/pharmacy-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    const json = await res.json();
    if (json.found && json.pharmacy?.cip && json.pharmacy.cip !== "0") {
      return json.pharmacy.cip;
    }
  } catch (e) {
    console.log(`  ⚠ Lookup CIP erreur: ${e.message}`);
  }
  return null;
}

// ── Server ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }
  if (req.method !== "POST")    { res.writeHead(405); return res.end(JSON.stringify({ error: "POST only" })); }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: "JSON invalide" }));
  }

  let { items, pharmacyName, pharmacyEmail, pharmacyCip, orderId } = payload;

  if (!items?.length) {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: "items manquants" }));
  }

  // ── Auto-lookup CIP si manquant ou "0" ──────────────────────────────
  if (!pharmacyCip || pharmacyCip === "0" || pharmacyCip === 0 || pharmacyCip === "null") {
    console.log(`[${ts()}] CIP manquant pour ${pharmacyName} (${pharmacyEmail}) — recherche automatique...`);
    const foundCip = await lookupCip(pharmacyEmail);
    if (foundCip) {
      pharmacyCip = foundCip;
      console.log(`  ✓ CIP retrouvé : ${pharmacyCip}`);
    } else {
      console.log(`  ✗ CIP introuvable dans Odoo pour ${pharmacyEmail}`);
      res.writeHead(400);
      return res.end(JSON.stringify({ error: `CIP introuvable pour ${pharmacyName || pharmacyEmail}. Vérifiez l'email dans Odoo.` }));
    }
  }

  console.log(`[${ts()}] Nouvelle commande : ${pharmacyName} (${items.length} ligne(s), CIP=${pharmacyCip}, id=${orderId})`);

  // ── Build PharmaML JSON payload ─────────────────────────────────────
  const body = [
    {
      identifiantPML: String(pharmacyCip),
      referenceCommande: String(orderId || Date.now()),
      lignes: items.map(i => ({
        CIP: i.cip || "",
        libelle: (i.name || "").substring(0, 50),
        quantiteCommandee: parseInt(i.qty) || 0,
        quantiteLivree: parseInt(i.qty) || 0,
        prix: i.pn != null ? Math.round(parseFloat(i.pn) * 100) / 100 : 0,
      })),
    },
  ];

  // ── Send to PharmaML ────────────────────────────────────────────────
  try {
    const url = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
    const pharmaRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await pharmaRes.text();
    let result;
    try { result = JSON.parse(text); }
    catch { result = { raw: text }; }

    console.log(`  -> PharmaML HTTP ${pharmaRes.status} :`, JSON.stringify(result));

    if (!pharmaRes.ok || result?.status === "error") {
      const msg = result?.message || result?.errors?.[0]?.message || `HTTP ${pharmaRes.status}`;
      console.log(`  ✗ Erreur PharmaML : ${msg}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ success: false, error: msg, detail: result }));
    }

    console.log(`  ✓ Commande transmise à PharmaML !`);
    res.writeHead(200);
    return res.end(JSON.stringify({ success: true, commandes: result?.commandes || 1, pharmaml: result }));

  } catch (err) {
    console.error(`  ✗ Exception :`, err.message);
    res.writeHead(500);
    return res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║     Elixir Pharma — Agent local PharmaML v2.1     ║
╠═══════════════════════════════════════════════════╣
║  Serveur actif sur http://localhost:${PORT}         ║
║  Utilisateur : ${PHARMAML_USER.padEnd(34)}║
║  PharmaML    : ${PHARMAML_URL.substring(0, 34).padEnd(34)}║
║  Lookup CIP  : ${SITE_URL.substring(0, 34).padEnd(34)}║
╚═══════════════════════════════════════════════════╝
`);
});
