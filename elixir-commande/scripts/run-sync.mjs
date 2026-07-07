// Orchestration des syncs Odoo pour le cron GitHub Actions.
// Rejoue la même séquence que l'admin, en appelant les étapes déjà validées.
// Usage : node scripts/run-sync.mjs stock|price|expiry
// Env   : CRON_SECRET (obligatoire), SITE_URL (défaut = prod)

const SITE = (process.env.SITE_URL || "https://commandes-elixir.netlify.app").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
const target = process.argv[2];

if (!SECRET) { console.error("✗ CRON_SECRET manquant"); process.exit(1); }
if (!["stock", "stock-quick", "price", "expiry"].includes(target)) {
  console.error("Usage: node scripts/run-sync.mjs stock|stock-quick|price|expiry");
  process.exit(1);
}

const HEADERS = { "x-cron-secret": SECRET };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Appel avec retries : les fonctions Netlify peuvent renvoyer un 502/504
// (timeout / cold start) de façon transitoire, ou un échec réseau ponctuel.
async function call(fn, qs, attempt = 1) {
  const url = `${SITE}/.netlify/functions/${fn}?${qs}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    if (res.status >= 500 && attempt <= 5) {
      console.log(`  ⟳ ${fn}?${qs} HTTP ${res.status} — retry ${attempt}/5 dans ${attempt * 4}s`);
      await sleep(attempt * 4000);
      return call(fn, qs, attempt + 1);
    }
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`${fn}?${qs} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (json.error) throw new Error(`${fn}?${qs} → ${json.error}`);
    return json;
  } catch (e) {
    if (/fetch failed|network|ECONN|EAI_AGAIN|timeout|socket/i.test(e.message) && attempt <= 5) {
      console.log(`  ⟳ ${fn}?${qs} ${e.message} — retry ${attempt}/5 dans ${attempt * 4}s`);
      await sleep(attempt * 4000);
      return call(fn, qs, attempt + 1);
    }
    throw e;
  }
}

// Boucle une étape paginée jusqu'à done (protège contre une boucle infinie).
async function loop(fn, step) {
  let offset = 0, guard = 0;
  while (true) {
    if (++guard > 2000) throw new Error(`${fn} ${step || ""}: trop d'itérations (garde-fou)`);
    const qs = step ? `step=${step}&offset=${offset}` : `offset=${offset}`;
    const d = await call(fn, qs);
    console.log(`  ${fn} ${step || "(offset)"} @${offset} →`, JSON.stringify(d).slice(0, 160));
    if (d.done) return d;
    if (d.next_offset == null) return d; // sécurité : pas de next → on s'arrête
    offset = d.next_offset;
  }
}

async function syncStock() {
  console.log("== STOCK (complet) ==");
  await loop("odoo-stock-sync", "products");
  await stockRefresh();
}

// Rafraîchit uniquement la disponibilité (saute le rechargement des 27k produits).
async function stockRefresh() {
  console.log("  → stock_prep", JSON.stringify(await call("odoo-stock-sync", "step=stock_prep")).slice(0, 160));
  console.log("  → stock",      JSON.stringify(await call("odoo-stock-sync", "step=stock")).slice(0, 160));
  await loop("odoo-stock-sync", "apply");
  console.log("  → reset_absent", JSON.stringify(await call("odoo-stock-sync", "step=reset_absent")));
}

async function syncStockQuick() {
  console.log("== STOCK (rapide) ==");
  await stockRefresh();
}

async function syncPrice() {
  console.log("== PRIX ==");
  await loop("odoo-price-sync", "load");
  await loop("odoo-price-sync", "apply");
}

async function syncExpiry() {
  console.log("== PÉREMPTION ==");
  await loop("odoo-expiry-sync", null);
}

const runners = { stock: syncStock, "stock-quick": syncStockQuick, price: syncPrice, expiry: syncExpiry };
runners[target]()
  .then(() => console.log(`✓ Sync « ${target} » terminée`))
  .catch((e) => { console.error(`✗ Sync « ${target} » échouée :`, e.message); process.exit(1); });
