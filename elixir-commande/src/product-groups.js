// ── Articles vendus sous plusieurs CIP (même code produit du fournisseur) ──
// Règle de Zineb (09/10/2026) : le pharmacien ne voit qu'UNE référence par article (une ligne, un
// CIP, un prix) ; la commande est répartie entre les CIP à l'envoi, la plus ancienne d'abord (FIFO).
// Gammes concernées : celles des menus d'aide au choix (wheelchair-logic.js, LINES).
import { ALL_GROUP_CODES, ALL_FALLBACK_CIPS, allocate, totalStock } from "./wheelchair-logic.js";

let cached = null;
// Références de tous les groupes (service supplier-code-refs). fresh = stock du moment (envoi d'une commande).
// Ne lève jamais d'exception : null si le service ne répond pas (les appelants retombent sur le CIP de la ligne).
export function loadGroups({ fresh = false } = {}) {
  if (fresh || !cached || Date.now() - cached.at > 5 * 60e3) {
    const url = `/.netlify/functions/supplier-code-refs?codes=${ALL_GROUP_CODES.join(",")}&cips=${ALL_FALLBACK_CIPS.join(",")}`;
    const p = Promise.resolve()
      .then(() => fetch(url, typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(8000) } : undefined))   // Safari < 16 : sans délai
      .then(r => r.ok ? r.json() : null).then(j => (j && !j.error ? j : null)).catch(() => null);
    if (fresh) return p;
    const entry = { at: Date.now(), p };
    cached = entry;
    p.then(j => { if (!j && cached === entry) cached = null; });   // échec : pas gardé en cache, le prochain appel réessaie
  }
  return cached.p;
}

// CIP → code fournisseur (tous les CIP connus d'un groupe)
export function codeOfCip(data) {
  const out = {};
  for (const [code, refs] of Object.entries(data?.refs || {})) for (const r of refs) out[r.cip] = code;
  return out;
}

// Une seule ligne par groupe dans une liste de produits du catalogue : la référence servie en
// premier (FIFO), avec le stock cumulé et le code fournisseur (pour la répartition à l'envoi).
export function collapseGroups(products, data) {
  const codeOf = codeOfCip(data);
  if (!Object.keys(codeOf).length) return products || [];
  const seen = new Set();
  return (products || []).flatMap(p => {
    const code = codeOf[p.cip];
    if (!code) return [p];
    if (seen.has(code)) return [];
    seen.add(code);
    const refs = data.refs[code];
    const head = allocate(refs, 1).lines[0]?.ref || refs[0];
    const st = totalStock(refs);
    return [{ ...p, ...head, in_stock: st > 0, available: Number.isFinite(st) ? st : head.available, supplier_code: code }];
  });
}
