// Patch one-shot : corrige la note des 3 refs obligatoires → Min 2 u
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const PATCHES = [
  { cip: "8710604763356", note_pattern: /Min \d+ u/ },
  { cip: "8720181397233", note_pattern: /Min \d+ u/ },
  { cip: "8710604763363", note_pattern: /Min \d+ u/ },
];

export const handler = async (event) => {
  if (event.queryStringParameters?.token !== "elixir2026")
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized" }) };

  const results = [];
  for (const { cip } of PATCHES) {
    // Lire la note actuelle
    const r = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${cip}&select=cip,note`, { headers: H });
    const [row] = await r.json();
    if (!row) { results.push({ cip, status: "not found" }); continue; }

    const newNote = (row.note || "").replace(/Min \d+ u/, "Min 2 u");
    const upd = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${cip}`, {
      method: "PATCH", headers: { ...H, "Prefer": "return=minimal" },
      body: JSON.stringify({ note: newNote })
    });
    results.push({ cip, old: row.note, new: newNote, status: upd.ok ? "ok" : upd.status });
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify(results) };
};
