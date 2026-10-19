// ── Assistant Elixir : lecture sûre du texte du modèle (docs/assistant-conception.md § 1.2 et § 3.3) ──
// Aucune CSP sur le site et des jetons dans localStorage : le texte du modèle n'est JAMAIS interprété comme du HTML.
// On n'en reconnaît que trois choses : le gras (**…**), les retours à la ligne et les listes « - ». Tout le reste —
// balises, liens, images, adresses web, titres Markdown — reste du texte, rendu par React (échappé). Aucun lien n'est
// fabriqué : une adresse écrite par le modèle s'affiche telle quelle, non cliquable.
// JS pur, sans dépendance (testé par scripts/banc/test-assistant-interface.mjs) ; rendu par TexteSur.jsx.

const LONGUEUR_MAX = 8000;   // au-delà, texte coupé (une réponse normale fait moins de 1 000 caractères)

// "a **b** c" → [{ texte: "a ", gras: false }, { texte: "b", gras: true }, { texte: " c", gras: false }]
// Un « ** » sans fermeture sur la ligne reste tel quel.
export function segments(ligne) {
  const out = [];
  const re = /\*\*(?=\S)([^*\n]*?\S)\*\*/g;
  let i = 0, m;
  while ((m = re.exec(ligne))) {
    if (m.index > i) out.push({ texte: ligne.slice(i, m.index), gras: false });
    out.push({ texte: m[1], gras: true });
    i = m.index + m[0].length;
  }
  if (i < ligne.length) out.push({ texte: ligne.slice(i), gras: false });
  return out;
}

// texte → blocs : { type: "para", lignes: [segments…] } (lignes consécutives, retours à la ligne gardés) ou
// { type: "liste", items: [segments…] } (lignes consécutives commençant par « - ») ; une ligne vide sépare les blocs
export function analyseTexte(texte) {
  let t = String(texte ?? "").replace(/\r\n?/g, "\n");
  if (t.length > LONGUEUR_MAX) t = t.slice(0, LONGUEUR_MAX) + "…";
  const blocs = [];
  let courant = null;
  for (const brute of t.split("\n")) {
    const ligne = brute.replace(/\s+$/, "");
    if (!ligne.trim()) { courant = null; continue; }
    const puce = ligne.match(/^\s*-\s+(.*)$/);
    if (puce) {
      if (!courant || courant.type !== "liste") blocs.push(courant = { type: "liste", items: [] });
      courant.items.push(segments(puce[1]));
    } else {
      if (!courant || courant.type !== "para") blocs.push(courant = { type: "para", lignes: [] });
      courant.lignes.push(segments(ligne.trim()));
    }
  }
  return blocs;
}
