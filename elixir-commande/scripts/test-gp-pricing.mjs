// Tests du moteur de prix des commandes groupées : node scripts/test-gp-pricing.mjs
// Convention : quantités saisies = unités FACTURÉES ; les UG sont calculées et ajoutées.
import { priceLine, priceOrder, objectiveProgress, ugFor, invoiceDiscount, splitInteger, allocateFree, freeBySlot, odooLine, round2, packCheck, packIssues, packLabel } from "../src/gp-pricing.js";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { const g = typeof got === "number" ? round2(got) : got; const x = typeof exp === "number" ? round2(exp) : exp; if (JSON.stringify(g) === JSON.stringify(x)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(g), "attendu", JSON.stringify(x)); } };
const L1 = { id: "a", price_gross: 10, discount_mode: "paliers", discount_tiers: [{ min_qty: 50, pct: 5 }, { min_qty: 100, pct: 10 }], ug_tiers: [{ min_qty: 12, free_qty: 2 }], weight: 1, vat_rate: 2.1 };
const L2 = { id: "b", price_gross: 20, discount_mode: "unitaire", discount_pct: 3, ug_tiers: [], weight: 2, vat_rate: 20 };

// ── Remise sur facture par paliers (sur les unités facturées)
eq("palier 49", invoiceDiscount(L1, 49).pct, 0); eq("palier 50", invoiceDiscount(L1, 50).pct, 5); eq("palier 150", invoiceDiscount(L1, 150).pct, 10);
eq("prochain palier à 60 : encore 40", invoiceDiscount(L1, 60).next.missing, 40);

// ── 3 remises : 1re, puis 2e et 3e en cascade ou additionnelles
const R = (extra, first = { discount_mode: "unitaire", discount_pct: 30 }) => ({ price_gross: 10, ...first, extra_discounts: extra });
eq("30 % puis 10 % en cascade = 37 %", invoiceDiscount(R([{ mode: "unitaire", pct: 10, combine: "cascade" }]), 1).pct, 37);
eq("30 % + 10 % additionnelle = 40 %", invoiceDiscount(R([{ mode: "unitaire", pct: 10, combine: "additionnelle" }]), 1).pct, 40);
eq("30, 10 cascade, 5 additionnelle = 42 %", invoiceDiscount(R([{ mode: "unitaire", pct: 10, combine: "cascade" }, { mode: "unitaire", pct: 5, combine: "additionnelle" }]), 1).pct, 42);
eq("30, 10 additionnelle, 5 cascade = 43 %", invoiceDiscount(R([{ mode: "unitaire", pct: 10, combine: "additionnelle" }, { mode: "unitaire", pct: 5, combine: "cascade" }]), 1).pct, 43);
const R2 = R([{ mode: "paliers", tiers: [{ min_qty: 50, pct: 5 }], combine: "cascade" }]);
eq("2e remise par paliers : 49 u. → 30 %", invoiceDiscount(R2, 49).pct, 30);
eq("2e remise par paliers : 50 u. → 33,5 %", invoiceDiscount(R2, 50).pct, 33.5);
eq("prochain palier (2e remise) : encore 1 → 33,5 %", [invoiceDiscount(R2, 49).next.rank, invoiceDiscount(R2, 49).next.missing, round2(invoiceDiscount(R2, 49).next.totalPct)], [2, 1, 33.5]);
eq("prix après 3 remises", priceLine({ tier_mode: "individuel", rfa_pct: 0 }, R([{ mode: "unitaire", pct: 10, combine: "cascade" }]), 10, 10).unitAfterInvoice, 6.3);
eq("remise 2 absente ou vide sans effet", invoiceDiscount(R([{ mode: "aucune", combine: "additionnelle" }]), 1).pct, 30);
eq("cumul plafonné à 100 %", invoiceDiscount(R([{ mode: "unitaire", pct: 60, combine: "additionnelle" }, { mode: "unitaire", pct: 30, combine: "additionnelle" }], { discount_mode: "unitaire", discount_pct: 30 }), 1).pct, 100);

// ── UG « 12 + 2 » : 2 offertes par tranche de 12 facturées
eq("UG 11 facturées", ugFor(L1, 11).free, 0); eq("UG 12 facturées", ugFor(L1, 12).free, 2);
eq("UG 23 facturées", ugFor(L1, 23).free, 2); eq("UG 24 facturées", ugFor(L1, 24).free, 4);
eq("prochaine UG à 20 : encore 4 pour +2", [ugFor(L1, 20).next.missing, ugFor(L1, 20).next.gain], [4, 2]);
eq("prochaine UG à 0 : encore 12", ugFor(L1, 0).next.missing, 12);
const LM = { ug_tiers: [{ min_qty: 12, free_qty: 2 }, { min_qty: 24, free_qty: 5 }] };
eq("multi-paliers à 24 : 24+5 l'emporte (5)", ugFor(LM, 24).free, 5);
eq("multi-paliers à 36 : 12+2 donne 6, 24+5 donne 5 → 6", ugFor(LM, 36).free, 6);

// ── Répartition entière au plus fort reste (somme exacte)
eq("4 UG pour 20 et 10 → 3 et 1", splitInteger(4, [{ key: "A", weight: 20 }, { key: "B", weight: 10 }]), { A: 3, B: 1 });
eq("2 UG pour 12 et 11 → 1 et 1", splitInteger(2, [{ key: "A", weight: 12 }, { key: "B", weight: 11 }]), { A: 1, B: 1 });
eq("7 UG pour 3 pharmacies égales → somme 7", Object.values(splitInteger(7, [{ key: "c", weight: 5 }, { key: "a", weight: 5 }, { key: "b", weight: 5 }])).reduce((s, n) => s + n, 0), 7);
eq("égalité : clé la plus petite d'abord", splitInteger(1, [{ key: "b", weight: 5 }, { key: "a", weight: 5 }]), { b: 0, a: 1 });
eq("poids nul → 0", splitInteger(3, [{ key: "a", weight: 0 }, { key: "b", weight: 4 }]), { a: 0, b: 3 });

// ── UG par pharmacie : collectif (groupe 30 → 4 UG répartis) / individuel (chacun sa tranche)
const opC = { id: "op", tier_mode: "collectif", rfa_pct: 2, fee_pct: 2, coop_mode: "aucune" };
const opI = { ...opC, tier_mode: "individuel" };
eq("collectif 20 + 10 → 3 + 1", allocateFree(opC, L1, { A: 20, B: 10 }), { A: 3, B: 1 });
eq("individuel 20 + 10 → 2 + 0", allocateFree(opI, L1, { A: 20, B: 10 }), { A: 2, B: 0 });
// chacun garde ses propres gratuités ; seul le surplus du groupe est réparti
eq("A 12 seule → 2 ; B rejoint avec 5 → A garde 2, B 0", allocateFree(opC, L1, { A: 12, B: 5 }), { A: 2, B: 0 });
eq("A 6 + B 6 → 1 + 1", allocateFree(opC, L1, { A: 6, B: 6 }), { A: 1, B: 1 });
eq("A, B, C à 6 : 18 u. → 2 UG pour le groupe, 1 max chacun", (() => { const a = allocateFree(opC, L1, { A: 6, B: 6, C: 6 }); return [Object.values(a).reduce((s, n) => s + n, 0), Math.max(...Object.values(a))]; })(), [2, 1]);
eq("somme = UG du groupe (30 → 4)", Object.values(allocateFree(opC, L1, { A: 20, B: 10 })).reduce((s, n) => s + n, 0), 4);
eq("paliers multiples : jamais plus que le labo (36 → 6)", Object.values(allocateFree(opC, LM, { A: 24, B: 12 })).reduce((s, n) => s + n, 0), 6);
eq("remise 10 % seule = exactement 10", invoiceDiscount({ discount_mode: "paliers", discount_tiers: [{ min_qty: 50, pct: 10 }] }, 55).pct, 10);

// ── UG d'une pharmacie réparties entre ses dates
eq("30 UG sur 60/60/60 → 10/10/10", freeBySlot(30, { s1: 60, s2: 60, s3: 60 }, ["immediat", "s1", "s2", "s3"]), { s1: 10, s2: 10, s3: 10 });
eq("2 UG sur 5/5/5 → les 2 premières dates", freeBySlot(2, { s1: 5, s2: 5, s3: 5 }, ["immediat", "s1", "s2", "s3"]), { s1: 1, s2: 1 });
eq("somme conservée", Object.values(freeBySlot(5, { immediat: 7, s2: 3 }, ["immediat", "s1", "s2"])).reduce((s, n) => s + n, 0), 5);

// ── Prix : la pharmacie paie ses unités facturées ; les UG s'ajoutent
const pc = priceLine(opC, L1, 20, 100);
eq("collectif : palier 10 % sur 100 facturées", pc.invoicePct, 10);
eq("collectif : net facturé", pc.unitAfterRfa, 10 * 0.9 * 0.98);
const one = priceOrder(opI, [L1], { a: 12 }, { a: 12 });
eq("12 facturées → 2 UG, 14 reçues", [one.rows[0].qty, one.rows[0].free, one.rows[0].received], [12, 2, 14]);
eq("montant = 12 × prix net (UG gratuites)", one.totals.net, 12 * 10 * 0.98);
eq("totaux d'unités", [one.totals.units, one.totals.freeUnits, one.totals.receivedUnits], [12, 2, 14]);
eq("valeur des UG", one.totals.ugValue, 2 * 10);
eq("prix par unité reçue", one.rows[0].receivedUnitNet, 12 * 9.8 / 14);

// ── Récap : coopération par pharmacie + frais
const opK = { ...opC, coop_mode: "par_pharmacie", coop_amount: 10 };
const o = priceOrder(opK, [L1, L2], { a: 20, b: 5 }, { a: 100, b: 5 }, { free: { a: 3 } });
const netL1 = 20 * 10 * 0.9 * 0.98, netL2 = 5 * 20 * 0.97 * 0.98;
eq("brut = facturées × prix brut", o.totals.gross, 300);
eq("UG attribuées reprises", o.rows[0].free, 3);
eq("après RFA", o.totals.net + o.totals.coop, netL1 + netL2); eq("coop", o.totals.coop, 10);
eq("frais 2 %", o.totals.fee, (netL1 + netL2 - 10) * 0.02); eq("total HT", o.totals.totalHT, (netL1 + netL2 - 10) * 1.02);
eq("lignes cohérentes avec le net", o.rows[0].totalNet + o.rows[1].totalNet, o.totals.net);
// coopération « total » au prorata
const opT = { ...opC, coop_mode: "total", coop_amount: 100 };
const oT = priceOrder(opT, [L1], { a: 20 }, { a: 100 }, { groupNetAfterRfa: 100 * 10 * 0.9 * 0.98 });
eq("coop totale : 20 % de 100 €", oT.totals.coop, 20);

// ── Ligne Odoo : 14 unités au prix brut, remise = montant dû
const lo = odooLine(10, 14, 12 * 9);
eq("14 u. × 10 € − 22,86 % ≈ 108 €", [lo.qty, lo.price_unit, lo.discount], [14, 10, 22.86]);
eq("montant Odoo à 1 centime près", Math.abs(lo.qty * lo.price_unit * (1 - lo.discount / 100) - 108) < 0.01, true);
const lf = odooLine(10, 10, 102);   // frais sans remise : pas de remise négative
eq("frais sans remise → prix net au centime, remise 0", [lf.price_unit, lf.discount], [10.2, 0]);
const l3 = odooLine(4.125, 140, 495);   // prix brut à 3 décimales : remise calculée sur 4,13 envoyé à Odoo
eq("prix à 3 décimales : montant Odoo à 1 ct", Math.abs(l3.qty * l3.price_unit * (1 - l3.discount / 100) - 495) < 0.01, true);
const lx = odooLine(4.9, 150, 749.7);   // frais sans remise : prix au centime supérieur + petite remise
eq("frais sans remise : montant exact", Math.abs(lx.qty * lx.price_unit * (1 - lx.discount / 100) - 749.7) < 0.01, true);
// devis d'une livraison : 60 facturées + 10 UG, prix net frais compris
const r0 = priceOrder(opI, [L1], { a: 60 }, { a: 60 }, { feePct: 2 }).rows[0];
const l60 = odooLine(r0.gross, 60 + 10, 60 * r0.unitWithFee);
eq("60 + 10 UG → 70 u., montant = 60 × net frais compris", Math.abs(l60.qty * l60.price_unit * (1 - l60.discount / 100) - 60 * r0.unitWithFee) < 0.05 && l60.qty === 70, true);

// ── Objectif (sur les unités facturées)
const g = { a: 100, b: 5 };
eq("objectif unités : 100 + 5×2 = 110", objectiveProgress({ ...opC, objective_type: "unites", objective_value: 200 }, [L1, L2], g).value, 110);
eq("objectif brut : 100×10 + 5×20", objectiveProgress({ ...opC, objective_type: "montant_brut", objective_value: 5000 }, [L1, L2], g).value, 1100);
eq("objectif net collectif : facturé après remise facture", objectiveProgress({ ...opC, objective_type: "montant_net", objective_value: 5000 }, [L1, L2], g).value, 100 * 9 + 5 * 19.4);

// ── Colisage (par livraison, sur la quantité saisie)
const PM = { id: "m", pack_size: 12, pack_rule: "multiple" }, PN = { id: "n", pack_size: 12, pack_rule: "minimum" }, PI = { id: "i", pack_size: 12, pack_rule: "aucune" };
eq("multiple : 24 accepté", packCheck(PM, 24), null);
eq("multiple : 18 refusé → 24", [packCheck(PM, 18).text, packCheck(PM, 18).suggestion], ["par 12", 24]);
eq("multiple : 6 refusé → 12", packCheck(PM, 6).suggestion, 12);
eq("0 toujours permis", [packCheck(PM, 0), packCheck(PN, 0)], [null, null]);
eq("minimum : 13 accepté, 11 refusé → 12", [packCheck(PN, 13), packCheck(PN, 11).suggestion], [null, 12]);
eq("indicatif : jamais bloquant", packCheck(PI, 5), null);
eq("sans colisage ou colis de 1 : jamais bloquant", [packCheck({ pack_rule: "multiple" }, 5), packCheck({ pack_size: 1, pack_rule: "multiple" }, 5)], [null, null]);
eq("chaque livraison vérifiée séparément", packIssues([PM, PN], { m: { s1: 12, s2: 6 }, n: { s1: 5, s2: 0 } }).map(x => `${x.line.id}:${x.slot_id}:${x.suggestion}`), ["m:s2:12", "n:s1:12"]);
eq("libellés", [packLabel(PM), packLabel(PN), packLabel(PI), packLabel({})], ["Colis de 12 · commande par 12", "Colis de 12 · minimum 12", "Colis de 12", ""]);
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
