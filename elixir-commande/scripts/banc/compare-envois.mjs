// ── Banc d'essai : comparaison des données envoyées entre deux séries (avant / après un lot) ──
// node scripts/banc/compare-envois.mjs <série de référence> <série à vérifier>
// Une série = un dossier de dev-fixtures/_envois/ (BANC_JOURNAL=avant npm run dev, même parcours, puis
// BANC_JOURNAL=apres). On compare, dans l'ordre, les envois qui comptent (e-mail, enregistrement,
// relais, U-Labs, justificatif), identifiants et dates masqués : aucun autre écart toléré.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DOSSIER_ENVOIS } from "./commun.mjs";

const FONCTIONS = new Set(["send-email", "order-save", "submit-order", "group-order", "lab-justif"]);
const VOLATILES = new Set(["id", "date", "order_date", "orderId", "order_id"]);

const masque = (x) => {
  if (Array.isArray(x)) return x.map(masque);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, VOLATILES.has(k) ? "‹masqué›" : masque(v)]));
  return x;
};

function serie(nom) {
  const dossier = resolve(DOSSIER_ENVOIS, nom);
  if (!existsSync(dossier)) throw new Error(`série introuvable : ${dossier}`);
  return readdirSync(dossier).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ f, ...JSON.parse(readFileSync(resolve(dossier, f), "utf8")) }))
    .filter(e => FONCTIONS.has(e.fonction) && !(e.fonction === "lab-justif" && e.corps?.action === "mes_demandes"))
    .map(e => ({ f: e.f, cle: `${e.methode} ${e.fonction}${e.corps?.action ? ` (${e.corps.action})` : ""}`, texte: JSON.stringify(masque({ url: e.url, corps: e.corps }), null, 2) }));
}

const [refNom, nouvNom] = process.argv.slice(2);
if (!refNom || !nouvNom) { console.error("Usage : node scripts/banc/compare-envois.mjs <série de référence> <série à vérifier>"); process.exit(2); }
const ref = serie(refNom), nouv = serie(nouvNom);
let ecarts = 0;
for (let i = 0; i < Math.max(ref.length, nouv.length); i++) {
  const a = ref[i], b = nouv[i];
  if (!a || !b) { ecarts++; console.log(`✗ envoi n° ${i + 1} : ${a ? `${a.cle} absent de « ${nouvNom} »` : `${b.cle} en trop dans « ${nouvNom} »`}`); continue; }
  if (a.cle !== b.cle || a.texte !== b.texte) {
    ecarts++;
    const la = a.texte.split("\n"), lb = b.texte.split("\n");
    const n = la.findIndex((l, j) => l !== lb[j]);
    console.log(`✗ envoi n° ${i + 1} : ${a.cle} (${a.f}) ≠ ${b.cle} (${b.f})\n    réf.  : ${(la[n] ?? "").trim()}\n    après : ${(lb[n] ?? "").trim()}`);
  } else console.log(`✓ envoi n° ${i + 1} : ${a.cle}`);
}
console.log(ecarts ? `\n${ecarts} écart(s) entre « ${refNom} » et « ${nouvNom} »` : `\nIdentiques : ${ref.length} envoi(s), identifiants et dates masqués`);
process.exitCode = ecarts ? 1 : 0;
