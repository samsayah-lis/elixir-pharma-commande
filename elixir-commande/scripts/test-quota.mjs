// Tests des périodes de contingentement : node scripts/test-quota.mjs
import { currentPeriod, quotaLabel, parisDate } from "../netlify/functions/_quota.js";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
// semaine : lundi → dimanche (le 1/10/2026 est un jeudi)
eq("semaine (jeudi)", currentPeriod("-1", 0, "2026-10-01"), { start: "2026-09-28", end: "2026-10-05" });
eq("semaine (lundi)", currentPeriod("-1", 0, "2026-09-28"), { start: "2026-09-28", end: "2026-10-05" });
eq("semaine (dimanche)", currentPeriod("-1", 0, "2026-10-04"), { start: "2026-09-28", end: "2026-10-05" });
eq("semaine à cheval sur l'année", currentPeriod("-1", 0, "2027-01-01"), { start: "2026-12-28", end: "2027-01-04" });
// décade : 1–10, 11–20, 21–fin du mois
eq("décade 1", currentPeriod("-2", 0, "2026-10-10"), { start: "2026-10-01", end: "2026-10-11" });
eq("décade 2", currentPeriod("-2", 0, "2026-10-11"), { start: "2026-10-11", end: "2026-10-21" });
eq("décade 3 (février)", currentPeriod("-2", 0, "2027-02-28"), { start: "2027-02-21", end: "2027-03-01" });
// quinzaine : 1–15, 16–fin
eq("quinzaine 1", currentPeriod("-3", 0, "2026-10-15"), { start: "2026-10-01", end: "2026-10-16" });
eq("quinzaine 2 (décembre)", currentPeriod("-3", 0, "2026-12-31"), { start: "2026-12-16", end: "2027-01-01" });
// mois
eq("mois", currentPeriod("-4", 0, "2026-10-01"), { start: "2026-10-01", end: "2026-11-01" });
// jours glissants : n derniers jours, aujourd'hui compris
eq("1 jour glissant = aujourd'hui", currentPeriod("1", 1, "2026-10-01"), { start: "2026-10-01", end: null });
eq("7 jours glissants", currentPeriod("1", 7, "2026-10-01"), { start: "2026-09-25", end: null });
eq("jours glissants non renseignés → 1", currentPeriod("1", 0, "2026-10-01"), { start: "2026-10-01", end: null });
eq("changement d'heure (fin octobre)", currentPeriod("1", 3, "2026-10-26"), { start: "2026-10-24", end: null });
eq("pas de quota", currentPeriod("0", 0, "2026-10-01"), null);
// libellés
eq("libellés", [quotaLabel({ quota: 12, period: "-1" }), quotaLabel({ quota: 1, period: "-4" }), quotaLabel({ quota: 2, period: "1", days: 7 }), quotaLabel({ quota: 1, period: "1", days: 1 })],
  ["12 par semaine", "1 par mois", "2 sur 7 jours glissants", "1 sur 1 jour glissant"]);
// date de Paris : 23 h 30 UTC le 30/09 = 1er octobre à Paris
eq("date de Paris", parisDate("2026-09-30T23:30:00Z"), "2026-10-01");
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
