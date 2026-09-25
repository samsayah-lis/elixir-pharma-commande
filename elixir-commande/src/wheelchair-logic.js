// ── Choix de la largeur d'assise d'un fauteuil roulant (4 tailles Invacare) ──
// Logique validée avec le calculateur de référence : deux méthodes (mesure
// hanches/cuisses assis, ou estimation par le poids avec ajustement IMC
// optionnel) qui convergent vers 40,5 / 43 / 45,5 / 48 cm.

export const SIZES = [40.5, 43, 45.5, 48];
export const SIZE_LABELS = ["40,5 cm", "43 cm", "45,5 cm", "48 cm"];

// Taille → CIP13 du fauteuil INVACARE ACTION 2NG fixe correspondant.
export const PRODUCT_BY_SIZE = {
  "40.5": "3662050045614",
  "43":   "3662050045638",
  "45.5": "3662050045652",
  "48":   "3662050045676",
};
export const WHEELCHAIR_CIPS = SIZES.map(s => PRODUCT_BY_SIZE[String(s)]);
export const cipForSize = (idx) => PRODUCT_BY_SIZE[String(SIZES[idx])];

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
