// Supabase plafonne les lignes par réponse, même avec un statut 200 sans erreur.
// Le total exact permet de poursuivre quand ce plafond est inférieur à la page demandée.
export async function lireToutesLesPages(url, headers, { page = 1000, maxPages = 50, cle = null } = {}) {
  const lignes = [], vues = new Set();
  let de = 0;
  for (let i = 0; i < maxPages; i++) {
    const entetes = new Headers(headers);
    entetes.set("Range", `${de}-${de + page - 1}`);
    entetes.set("Prefer", "count=exact");
    const res = await fetch(url, { headers: entetes });
    if (!res.ok) throw new Error(`Supabase ${res.status} : ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("Supabase : réponse attendue sous forme de tableau");
    const compte = res.headers.get("Content-Range")?.split("/")[1];
    const total = compte && /^\d+$/.test(compte) ? Number(compte) : NaN;
    for (const row of rows) {
      if (cle !== null) {
        if (vues.has(row[cle])) continue;
        vues.add(row[cle]);
      }
      lignes.push(row);
    }
    de += rows.length;
    if (!rows.length || (!Number.isNaN(total) ? de >= total : rows.length < page)) return lignes;
  }
  throw new Error(`Supabase : limite de ${maxPages} pages atteinte, lecture incomplète`);
}
