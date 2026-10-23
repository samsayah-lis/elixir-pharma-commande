// Numéros des commandes du site = Date.now() : « 17… » jusqu'au 15/01/2027 08:00 UTC, puis « 18… », « 19… ».
// REF_SITE (Assistant : rattachement des commandes du site à Odoo) et canalVente (Péremption : ventes site / LGO)
// doivent reconnaître les trois préfixes, et rien d'autre.
import { REF_SITE } from "../netlify/functions/_chat-perimetre.js";
import { canalVente } from "../netlify/functions/_peremption.js";

let ok = 0, ko = 0;
const eq = (nom, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { ko++; console.log("✗", nom, JSON.stringify(a), "≠", JSON.stringify(b)); } };

const avant = String(Date.UTC(2026, 9, 21, 12));          // 1792…
const apres = String(Date.UTC(2027, 0, 15, 8, 0, 1));     // 1800000001000
const tard = String(Date.UTC(2032, 11, 31));              // 19…
eq("bascule 18… le 15/01/2027 08:00 UTC", Date.UTC(2027, 0, 15, 8) >= 1.8e12 && Date.UTC(2027, 0, 15, 7) < 1.8e12, true);
for (const [nom, ref] of [["avant", avant], ["après la bascule", apres], ["2032", tard]]) {
  eq(`REF_SITE ${nom}`, REF_SITE.test(ref), true);
  eq(`REF_SITE ${nom} P2`, REF_SITE.exec(ref + "P2")?.slice(1, 3), [ref, "P2"]);
  eq(`canalVente ${nom}`, canalVente(ref), "site");
  eq(`canalVente ${nom} P3`, canalVente(ref + "P3"), "site");
}
for (const ref of ["1600000000000", "2000000000000", "180000000000", "18000000000000", "S351354", "3400935291035"]) {
  eq(`REF_SITE refuse ${ref}`, REF_SITE.test(ref), false);
  eq(`canalVente ${ref}`, canalVente(ref), "lgo");
}
eq("canalVente vide", canalVente(""), "autre");
console.log(`${ok} OK, ${ko} échec(s)`);
if (ko) process.exit(1);
