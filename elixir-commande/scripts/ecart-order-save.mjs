// ── order-save.js : écarts admis depuis la production, pour les tests qui le veulent inchangé ──
// Limites des menus promo et précommandes (26/10/2026, docs/limites-promo.md) : lignes AJOUTÉES seulement (import de
// _promo-limites.js, contrôle avant l'écriture), aucune retirée. Utilisé par test-api-commandes.mjs et test-peremption-mention.mjs ;
// toute autre modification d'order-save.js reste signalée par ces tests (et par verifie-zones.mjs, empreinte).
import { execFileSync } from "node:child_process";

export const LIGNES_LIMITES = [
  'import { controleLimites, pharmacie } from "./_promo-limites.js";',
  "// Limites des menus promo et précommandes (26/10/2026, docs/limites-promo.md) : au-delà de ce que la pharmacie (ou l'ensemble",
  "// des pharmacies, max total) peut encore commander → 400, rien d'écrit, le site garde le panier ; le même numéro renvoyé après",
  "// une réponse perdue n'est pas compté contre lui-même (sauf) ; commandes illisibles → 503 (réessayer)",
  "try {",
  "const refus = await controleLimites({ items: row.items, ph: pharmacie(row.pharmacy_cip, row.pharmacy_email), sauf: orderId });",
  "if (refus) return json(400, { success: false, error: refus.message, limites: refus.over });",
  "} catch (e) {",
  'console.error("[order-save] limites :", e.message);',
  'return json(503, { success: false, error: "Vérification des quantités limitées impossible : réessayez dans un instant" });',
  "}",
  "",
];

// order-save.js identique à `ref`, à l'écart des limites près → true ; autre écart → false ; git illisible → null
export function orderSaveAdmis(ref, cwd) {
  let d;
  try { d = execFileSync("git", ["diff", "-U0", ref, "--", "netlify/functions/order-save.js"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
  const lignes = d.split("\n").filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  if (!lignes.length) return true;
  const ajoutees = lignes.filter(l => l.startsWith("+")).map(l => l.slice(1).trim());
  return lignes.every(l => l.startsWith("+")) && JSON.stringify(ajoutees) === JSON.stringify(LIGNES_LIMITES);
}
