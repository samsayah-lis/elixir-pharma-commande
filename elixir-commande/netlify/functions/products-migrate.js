// Migration unique : insère le catalogue statique dans Supabase
// Appeler UNE SEULE FOIS via : /.netlify/functions/products-migrate?token=elixir2026
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

import { CATALOG_DATA } from "./catalog-data.js";

export const handler = async (event) => {
  if (event.queryStringParameters?.token !== "elixir2026") {
    return { statusCode: 403, body: "Forbidden" };
  }

  const now = new Date().toISOString();
  const rows = [];

  for (const [sectionKey, section] of Object.entries(CATALOG_DATA)) {
    for (const p of section.products || []) {
      rows.push({
        cip: p.cip,
        name: p.name,
        section: sectionKey,
        pv: p.pv ?? p.prix ?? null,
        pct: p.pct ?? p.remise ?? null,
        pn: p.pn ?? null,
        remise_eur: p.remise_eur ?? null,
        colis: p.colis ?? null,
        carton: p.carton ?? null,
        note: p.note ?? null,
        active: true,
        source: "catalog",
        history: JSON.stringify([{ action: "created", date: now, author: "migration", note: "Import catalogue initial" }]),
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Insère par batch de 50
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 500, body: JSON.stringify({ error: err, insertedSoFar: inserted }) };
    }
    inserted += batch.length;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, count: inserted, message: `${inserted} produits migrés` })
  };
};
