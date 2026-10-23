// ── Banc d'essai : contingentement dans la ligne de l'article (docs/contingentement-ligne.md) ──
// quota-liste (GET) et quota-status (POST) répondus par le banc avec les VRAIES fonctions de période de _quota.js
// (currentPeriod, quotaLabel, parisDate). Règles FICTIVES, une par type de période, sur des produits des données figées QUI NE
// SONT PAS contingentés chez Elixir (vérifié en lecture seule dans Odoo le 23/10/2026) ni suivis par controle-paliers.mjs
// (DAFALGAN 1000 effervescent) : le dépôt est public, aucun produit contingenté d'Elixir ni aucune de ses règles n'y figure.
// « Déjà commandé dans Odoo » : inventé aussi. Les commandes enregistrées sur le banc (order-save) comptent comme commandes du
// site pas encore dans Odoo : le reste baisse après un envoi, comme en ligne.
// Scénario (BANC_QUOTA au lancement, ou à chaud : GET /banc-quota?mode=<scénario> ; sans paramètre : état actuel) :
//   normal (défaut) · atteint (reste 0 partout) · panne (quota-status 502 : « reste non vérifié ») · dispense
//   (pharmacie dispensée, deny_quota : aucune pastille) · off (liste vide : aucun produit contingenté, aucun appel
//   quota-status) · accueil (normal + trois règles de plus sur des produits de la page d'accueil : vitrine, cinéma, grille).
// &raz=1 : les commandes déjà enregistrées sur le banc ne comptent plus (contrôle rejouable sans redémarrer le banc).
// &retard=<ms> : quota-status répond après ce délai (lecture Odoo lente : place de la pastille prise avant le reste).
import { currentPeriod, quotaLabel, parisDate } from "../../netlify/functions/_quota.js";

// règles d'exemple (quantités et périodes inventées) ; produits des données figées non contingentés en réel
const REGLES = [
  { cip: "3400927562396", name: "CODOLIPRANE 500 mg/30 mg (Master, Saisie ; FICTIF)", quota: 12, period: "1", days: 1, deja: 4 },
  { cip: "3400933220754", name: "CODOLIPRANE 400 mg/20 mg (Master ; FICTIF)", quota: 2, period: "-4", days: 0, deja: 2 },
  { cip: "3400933071998", name: "DOLIPRANE 500 mg effervescent (Master, palier dès 20 ; FICTIF)", quota: 12, period: "-1", days: 0, deja: 0 },
  { cip: "3400932679041", name: "DAFALGAN 500 mg gélules (Stratège, colis de 160 ; FICTIF)", quota: 100, period: "-4", days: 0, deja: 0 },
  { cip: "3400930229613", name: "DOLIPRANELIQUIZ 1000 mg (Centrale OTC ; FICTIF)", quota: 8, period: "-1", days: 0, deja: 0 },
  { cip: "3400941631825", name: "DOLIPRANETABS 500 mg (Centrale OTC ; FICTIF)", quota: 3, period: "-2", days: 0, deja: 1 },
  { cip: "3400930258644", name: "WEGOVY 1 mg (Mounjaro / Wegovy ; FICTIF)", quota: 2, period: "1", days: 3, deja: 0 },
  { cip: "3400930258620", name: "WEGOVY 0,25 mg (Mounjaro / Wegovy ; FICTIF)", quota: 2, period: "1", days: 1, deja: 0 },
  { cip: "3068320012506", name: "Brumisateur Evian 50 ml (menu promo ; FICTIF)", quota: 20, period: "-3", days: 0, deja: 0 },
];
// mode « accueil » seulement : règles inventées pour voir la pastille sur la page d'accueil (aucun de ces produits n'est
// contingenté chez Elixir)
const FICTIVES = [
  { cip: "3400930292914", name: "MOUNJARO 5 mg (vitrine des plus commandés, FICTIF)", quota: 6, period: "-1", days: 0, deja: 2 },
  { cip: "3400934438738", name: "VENTOLINE (vitrine cinéma, carton de 120, FICTIF)", quota: 240, period: "-4", days: 0, deja: 200 },
  { cip: "3400930986080", name: "SPASFON (grille « À la une », FICTIF)", quota: 60, period: "-3", days: 0, deja: 60 },
];
export const MODES_QUOTA = ["normal", "atteint", "panne", "dispense", "off", "accueil"];
let mode = MODES_QUOTA.includes(process.env.BANC_QUOTA) ? process.env.BANC_QUOTA : "normal";
export const modeQuota = (m) => { if (MODES_QUOTA.includes(m)) mode = m; return mode; };
let depuis = 0;   // commandes du banc comptées à partir de cette heure (ms)
export const razQuota = () => { depuis = Date.now(); };
let retard = 0;   // délai de réponse de quota-status (ms)
export const retardQuota = (ms) => { if (ms != null) retard = Math.max(0, Math.min(20000, Number(ms) || 0)); return retard; };

const regles = () => (mode === "off" ? [] : mode === "accueil" ? [...REGLES, ...FICTIVES] : REGLES);

// → { statut, corps, source } ou null (pas une fonction du contingentement)
export function repondreQuota({ methode, fn, commandes = [] }) {
  const source = `banc contingentement (${mode})`;
  if (fn === "quota-liste" && methode === "GET")
    return { statut: 200, corps: { produits: Object.fromEntries(regles().map(r => [r.cip, { quota: r.quota, period: r.period, days: r.days }])) }, source };
  if (fn !== "quota-status" || methode !== "POST") return null;
  if (mode === "panne") return { statut: 502, corps: { error: "Banc d'essai : Odoo injoignable (BANC_QUOTA=panne)" }, source, retard };
  if (mode === "dispense") return { statut: 200, corps: { exempt: true, products: {} }, source, retard };
  const today = parisDate();
  const site = {};
  for (const o of commandes.filter(c => !(Date.parse(c.date) < depuis))) for (const it of Array.isArray(o.items) ? o.items : []) if (it?.cip) site[it.cip] = (site[it.cip] || 0) + (parseInt(it.qty) || 0);
  const products = {};
  for (const r of regles()) {
    const per = currentPeriod(r.period, r.days, today);
    const uo = mode === "atteint" ? r.quota : r.deja, us = site[r.cip] || 0;
    products[r.cip] = { name: r.name, quota: r.quota, period: r.period, days: r.days, label: quotaLabel(r), used: uo + us, used_odoo: uo, used_site: us,
      remaining: Math.max(0, r.quota - uo - us), start: per.start, end: per.end };
  }
  return { statut: 200, corps: { exempt: false, identified: true, today, products }, source, retard };
}
