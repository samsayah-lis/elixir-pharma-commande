// ── Choix de la largeur d'assise d'un fauteuil roulant (4 tailles Invacare) ──
// Logique validée avec le calculateur de référence : deux méthodes (mesure
// hanches/cuisses assis, ou estimation par le poids avec ajustement IMC
// optionnel) qui convergent vers 40,5 / 43 / 45,5 / 48 cm.

export const SIZES = [40.5, 43, 45.5, 48];
export const SIZE_LABELS = ["40,5 cm", "43 cm", "45,5 cm", "48 cm"];

// Taille → fauteuil INVACARE ACTION 2NG fixe. Une nouvelle livraison peut arriver sous un AUTRE CIP :
// les références d'une même taille sont reconnues par le code du produit du fournisseur (DHCARE,
// product.supplierinfo.product_code), identique d'une livraison à l'autre. Le CIP historique sert de
// repli si le code n'est pas renseigné dans Odoo (code du 48 cm renseigné le 09/10/2026).
export const SUPPLIER_CODE_BY_SIZE = { "40.5": "BR1538205", "43": "BR1538206", "45.5": "BR1538207", "48": "BR1538212" };
export const FALLBACK_CIP_BY_SIZE = { "40.5": "3662050045614", "43": "3662050045638", "45.5": "3662050045652", "48": "3662050045676" };
export const WHEELCHAIR_CODES = SIZES.map(s => SUPPLIER_CODE_BY_SIZE[String(s)]);
export const WHEELCHAIR_FALLBACK_CIPS = SIZES.map(s => FALLBACK_CIP_BY_SIZE[String(s)]);
export const codeForSize = (idx) => SUPPLIER_CODE_BY_SIZE[String(SIZES[idx])];
export const fallbackCipForSize = (idx) => FALLBACK_CIP_BY_SIZE[String(SIZES[idx])];

// Références d'une taille : celles du code fournisseur, sinon le CIP historique
export function refsForSize(idx, data) {
  const byCode = data?.refs?.[codeForSize(idx)] || [];
  if (byCode.length) return byCode;
  const fb = data?.byCip?.[fallbackCipForSize(idx)];
  return fb ? [fb] : [];
}
// Stock connu d'une référence (catalogue : « available » ; à défaut, en stock sans quantité connue)
const avail = (r) => r.available == null ? (r.in_stock ? Infinity : 0) : Math.max(0, Math.floor(Number(r.available) || 0));
export const totalStock = (refs) => (refs || []).reduce((a, r) => a + avail(r), 0);

// Répartit la quantité sur les références en stock d'une même taille : d'abord celle qui en a le
// moins (écoule le reliquat de l'ancienne livraison), sans dépasser le stock connu de chacune.
export function allocate(refs, qty) {
  const q = Math.max(0, Math.floor(Number(qty) || 0));
  const inStock = (refs || []).filter(r => avail(r) > 0)
    .sort((a, b) => (avail(a) - avail(b)) || String(a.cip).localeCompare(String(b.cip)));
  const lines = [];
  let left = q;
  for (const r of inStock) {
    if (left <= 0) break;
    const n = Math.min(left, avail(r));
    lines.push({ ref: r, qty: n });
    left -= n;
  }
  return { lines, missing: left };
}

// Méthode 1 — mesure disponible : largeur = mesure + 2,5 à 5 cm de jeu.
export const MEASURE_BANDS = [
  { max: 38,   idx: 0, label: "≤ 38 cm" },
  { max: 40.5, idx: 1, label: "38 – 40,5 cm" },
  { max: 43,   idx: 2, label: "40,5 – 43 cm" },
  { max: 45.5, idx: 3, label: "43 – 45,5 cm" },
  { max: null, idx: null, label: "> 45,5 cm" },
];
export function sizeFromMeasure(m) {
  for (const b of MEASURE_BANDS) if (b.max == null || m <= b.max) return b;
  return MEASURE_BANDS[MEASURE_BANDS.length - 1];
}

// Méthode 2 — pas de mesure : estimation par le poids.
export const WEIGHT_BANDS = [
  { low: 0,   high: 45,   idx: 0, label: "< 45 kg" },
  { low: 45,  high: 57,   idx: 0, label: "45 – 57 kg" },
  { low: 57,  high: 72,   idx: 1, label: "57 – 72 kg" },
  { low: 72,  high: 87,   idx: 2, label: "72 – 87 kg" },
  { low: 87,  high: 100,  idx: 3, label: "87 – 100 kg" },
  { low: 100, high: null, idx: null, label: "> 100 kg" },
];
export function sizeFromWeight(w) {
  if (w < 45) return WEIGHT_BANDS[0];
  for (const b of WEIGHT_BANDS.slice(1)) if (b.high == null || w <= b.high) return b;
  return WEIGHT_BANDS[WEIGHT_BANDS.length - 1];
}

const fr = (n, d = 1) => Number(n).toFixed(d).replace(".", ",");

// Recommandation complète. method = "mesure" | "poids".
// Retourne { idx (0..3 ou null), size, label, band, outOfRange, reason, imc, adjustment }
export function recommend({ method, measure, weight, height }) {
  if (method === "mesure") {
    const m = parseFloat(measure);
    if (!(m > 0)) return null;
    const b = sizeFromMeasure(m);
    if (b.idx == null) {
      return { idx: null, size: null, label: "Hors gamme standard", band: b, outOfRange: "surmesure",
               reason: `Mesure ${fr(m)} cm (${b.label}) : au-delà de la plus grande largeur standard → orienter vers un modèle large ou sur mesure.` };
    }
    return { idx: b.idx, size: SIZES[b.idx], label: SIZE_LABELS[b.idx], band: b, outOfRange: null,
             reason: `Mesure ${fr(m)} cm + 2,5 à 5 cm de jeu → tranche ${b.label}.` };
  }
  const w = parseFloat(weight);
  if (!(w > 0)) return null;
  const b = sizeFromWeight(w);
  let idx = b.idx, imc = null, adjustment = null;
  let reason = `Poids ${fr(w)} kg → tranche ${b.label}.`;
  const t = parseFloat(height);
  if (idx != null && t > 0) {
    const tm = t / 100;
    imc = w / (tm * tm);
    const position = b.high != null ? (w - b.low) / (b.high - b.low) : null;
    const corp = imc < 18.5 ? "mince" : imc > 30 ? "forte" : "normale";
    if (imc < 18.5 && position != null && position > 0.7 && idx > 0) { idx -= 1; adjustment = "down"; }
    else if (imc > 30 && position != null && position < 0.3 && idx < SIZES.length - 1) { idx += 1; adjustment = "up"; }
    reason += ` IMC ${fr(imc)} (corpulence ${corp})` + (adjustment ? ` → taille ${adjustment === "down" ? "inférieure" : "supérieure"} retenue.` : " → pas d'ajustement.");
  }
  if (idx == null) {
    return { idx: null, size: null, label: "Hors gamme standard", band: b, outOfRange: "bariatrique", imc, adjustment,
             reason: reason + " Orienter vers du matériel bariatrique." };
  }
  return { idx, size: SIZES[idx], label: SIZE_LABELS[idx], band: b, outOfRange: null, imc, adjustment, reason };
}
