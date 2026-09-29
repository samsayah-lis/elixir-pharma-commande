import { priceLine, priceOrder, objectiveProgress, ugFor, invoiceDiscount, round2 } from "../src/gp-pricing.js";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { const g = typeof got === "number" ? round2(got) : got; const x = typeof exp === "number" ? round2(exp) : exp; if (JSON.stringify(g) === JSON.stringify(x)) ok++; else { ko++; console.log("✗", label, "→", g, "attendu", exp); } };
const L1 = { id: "a", price_gross: 10, discount_mode: "paliers", discount_tiers: [{ min_qty: 50, pct: 5 }, { min_qty: 100, pct: 10 }], ug_tiers: [{ min_qty: 12, free_qty: 2 }], weight: 1, vat_rate: 2.1 };
const L2 = { id: "b", price_gross: 20, discount_mode: "unitaire", discount_pct: 3, ug_tiers: [], weight: 2, vat_rate: 20 };
// remise sur facture par paliers
eq("palier 49", invoiceDiscount(L1, 49).pct, 0); eq("palier 50", invoiceDiscount(L1, 50).pct, 5); eq("palier 150", invoiceDiscount(L1, 150).pct, 10);
eq("prochain palier à 60", invoiceDiscount(L1, 60).next.missing, 40);
// UG 12+2 : tranche de 14
eq("UG 13", ugFor(L1, 13).free, 0); eq("UG 14", ugFor(L1, 14).free, 2); eq("UG 30", ugFor(L1, 30).free, 4); eq("UG équiv 14", ugFor(L1, 14).equivPct, 14.29);
// UG multi-paliers : 12+2 et 24+6 → à 30 : 12+2 donne 4, 24+6 donne 6 → meilleur 6
eq("UG multi 30", ugFor({ ug_tiers: [{ min_qty: 12, free_qty: 2 }, { min_qty: 24, free_qty: 6 }] }, 30).free, 6);
// mode collectif : la pharmacie commande 20, le groupe 100 → palier 10 % + UG sur 100 (7×2=14 → 14 %)
const opC = { tier_mode: "collectif", rfa_pct: 2, fee_pct: 2, coop_mode: "aucune" };
const pc = priceLine(opC, L1, 20, 100);
eq("collectif remise", pc.invoicePct, 10); eq("collectif UG équiv", pc.ug.equivPct, 14); eq("collectif net unitaire", pc.unitAfterRfa, 10 * 0.9 * 0.86 * 0.98);
// mode individuel : base = 20 → pas de palier, UG 1 tranche = 2/20 = 10 %
const opI = { ...opC, tier_mode: "individuel" };
const pi = priceLine(opI, L1, 20, 100);
eq("individuel remise", pi.invoicePct, 0); eq("individuel UG", pi.ug.equivPct, 10);
// récap commande + coopération par pharmacie + frais
const opK = { ...opC, coop_mode: "par_pharmacie", coop_amount: 10 };
const o = priceOrder(opK, [L1, L2], { a: 20, b: 5 }, { a: 100, b: 5 });
const netL1 = 20 * 10 * 0.9 * 0.86 * 0.98, netL2 = 5 * 20 * 0.97 * 0.98;
eq("brut", o.totals.gross, 300); eq("après RFA", o.totals.net + o.totals.coop, netL1 + netL2); eq("coop", o.totals.coop, 10);
eq("frais 2 %", o.totals.fee, (netL1 + netL2 - 10) * 0.02); eq("total HT", o.totals.totalHT, (netL1 + netL2 - 10) * 1.02);
eq("remise globale ligne 1 cohérente", o.rows[0].unitNet * 20 + o.rows[1].unitNet * 5, o.totals.net);
// coop « total » répartie au prorata
const opT = { ...opC, coop_mode: "total", coop_amount: 100 };
const oT = priceOrder(opT, [L1], { a: 20 }, { a: 100 }, { groupNetAfterRfa: 100 * 10 * 0.9 * 0.86 * 0.98 });
eq("coop total prorata 20 %", oT.totals.coop, 20);
// objectif unités avec produit comptant double
eq("objectif unités", objectiveProgress({ objective_type: "unites", objective_value: 120 }, [L1, L2], { a: 100, b: 5 }).value, 110);
eq("objectif brut", objectiveProgress({ objective_type: "montant_brut", objective_value: 2000 }, [L1, L2], { a: 100, b: 5 }).value, 1100);
eq("objectif net collectif", objectiveProgress({ ...opC, objective_type: "montant_net", objective_value: 2000 }, [L1], { a: 100 }).value, 100 * 10 * 0.9 * 0.86);
console.log(`${ok} OK, ${ko} échec(s)`);
