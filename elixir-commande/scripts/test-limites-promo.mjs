// Tests des limites de quantité des menus promo et précommandes : node scripts/test-limites-promo.mjs (docs/limites-promo.md)
// Hors ligne : fetch simulé (Supabase Auth et REST), aucune donnée réelle lue ni écrite. Produits FICTIFS (CIP 3400999…) : le dépôt
// est public, aucun produit ni aucune limite d'Elixir n'y figure.
//  1. règles (src/limites-promo.js) : limites des menus actifs, entiers, CIP requis, plus basse limite d'un CIP en double, début du
//     comptage, quantités déjà commandées (date, lignes retirées par l'API, items en texte, numéro ignoré, pharmacie), reste et
//     limite qui bloque, dépassements du panier (lignes additionnées, limites seules sans lecture), textes ;
//  2. serveur (_promo-limites.js, sb simulé) : limites en texte, commandes de la pharmacie (CIP, adresse exacte, jamais ilike) ou de
//     toutes (max total), pages de 1 000, cache, contrôle d'une commande (rien de limité : aucune lecture des commandes ; limites
//     illisibles : commande non contrôlée ; commandes illisibles : exception) ;
//  3. fonction promo-limites : jeton exigé, compte sans pharmacie, pharmacie (reste), saisie Elixir, admin (totaux), refus admin ;
//  4. order-save : au-delà → 400 et rien d'écrit ; dans la limite → enregistrée ; même numéro renvoyé non compté contre lui-même ;
//     max total atteint par d'autres pharmacies ; commandes illisibles → 503 rien d'écrit ; commande sans produit limité inchangée ;
//  5. site et admin : branchement dans src/App.jsx (envoi bloqué, pastilles, module à la demande) et src/AdminPanel.jsx (champs).
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ADMIN_EMAIL = "admin@elixir.test";
import { readFileSync } from "node:fs";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

const A = "3400999000011", B = "3400999000028", C = "3400999000035";   // fictifs
const T0 = Date.parse("2026-10-26T08:00:00Z");
const PROMOS = [
  { id: T0 - 864e5, name: "Précommande FICTIVE", active: true, products: [
    { id: T0, name: "PRODUIT A (fictif)", cip: A, pn: 10, maxPharmacie: 5 },
    { id: T0, name: "PRODUIT B (fictif)", cip: B, pn: 20, maxPharmacie: 4, maxTotal: 10 },
    { id: T0, name: "PRODUIT C (fictif)", cip: C, pn: 30 },                          // sans limite
    { id: T0, name: "SANS CIP", cip: null, pn: 5, maxPharmacie: 2 },                 // ignoré : CIP requis
  ] },
  { id: T0, name: "Menu masqué", active: false, products: [{ id: T0, name: "C limité", cip: C, pn: 30, maxPharmacie: 1 }] },
  { id: T0, name: "Autre menu", active: true, products: [{ id: T0 + 5000, name: "A ailleurs", cip: A, pn: 9, maxPharmacie: 8, maxTotal: 50 }] },
];

// ════════════════════════ 1. règles ════════════════════════
const R = await import("../src/limites-promo.js");
eq("entier ≥ 1", [R.entierLimite("5"), R.entierLimite(3), R.entierLimite(""), R.entierLimite("0"), R.entierLimite("2.5"), R.entierLimite("-1"), R.entierLimite(null)], [5, 3, null, null, null, null, null]);
const L = R.limitesActives(PROMOS);
eq("menus actifs, CIP requis, produit sans limite ignoré", Object.keys(L).sort(), [A, B]);
eq("CIP limité dans deux menus actifs : plus basse de chaque limite, début le plus ancien", [L[A].parPharmacie, L[A].total, L[A].depuis], [5, 50, T0]);
eq("limites de B", [L[B].parPharmacie, L[B].total, L[B].nom, L[B].menu], [4, 10, "PRODUIT B (fictif)", "Précommande FICTIVE"]);
eq("début : date d'ajout du produit, sinon du menu", [R.depuisProduit({ id: T0 }, { id: T0 + 1 }), R.depuisProduit({ id: T0 }, { id: 7 }), R.depuisProduit({}, {})], [T0 + 1, T0, 0]);
eq("entrée vide ou invalide", [R.limitesActives(null), R.limitesActives("x")], [{}, {}]);

const iso = (ms) => new Date(ms).toISOString();
const MOI = { pharmacy_cip: "2000001", pharmacy_email: "compte@pharmacie-a.test" };
const AUTRE = { pharmacy_cip: "2000002", pharmacy_email: "autre@pharmacie-b.test" };
const CMDS = [
  { id: 1, date: iso(T0 - 3600e3), ...MOI, items: [{ cip: A, qty: 4 }] },                                    // avant l'ajout : pas comptée
  { id: 2, date: iso(T0 + 60e3), ...MOI, source: "catalogue", items: [{ cip: A, qty: 2 }, { cip: B, qty: 1 }, { cip: C, qty: 9 }] },
  { id: 3, date: iso(T0 + 120e3), ...MOI, items: JSON.stringify([{ cip: B, qty: "2" }]) },                     // items en texte
  { id: 4, date: iso(T0 + 180e3), ...AUTRE, items: [{ cip: B, qty: 5 }, { cip: A, qty: 3, api_motif: "annulee" }] },
  { id: 5, date: iso(T0 + 240e3), pharmacy_cip: null, pharmacy_email: "compte@pharmacie-a.test", items: [{ cip: A, qty: 1 }] },   // sans CIP : par l'adresse
];
const mienne = (o) => o.pharmacy_cip === "2000001" || String(o.pharmacy_email).toLowerCase() === "compte@pharmacie-a.test";
const D = R.quantitesCommandees(CMDS, L, mienne);
eq("déjà commandé : depuis l'ajout, lignes API retirées exclues, items en texte, commande sans CIP par l'adresse", D, { [A]: { pharmacie: 3, total: 3 }, [B]: { pharmacie: 3, total: 8 } });
eq("numéro ignoré (renvoi après réponse perdue)", R.quantitesCommandees(CMDS, L, mienne, 2)[A], { pharmacie: 1, total: 1 });
eq("totaux seuls", R.quantitesCommandees(CMDS, L)[B], { pharmacie: 0, total: 8 });

eq("reste : max par pharmacie", R.resteLimite(L[A], D[A]), { reste: 2, motif: "pharmacie", deja: 3 });
eq("reste : max total plus bas que le max par pharmacie", R.resteLimite(L[B], D[B]), { reste: 1, motif: "pharmacie", deja: 3 });
eq("reste : le total bloque", R.resteLimite(L[B], { pharmacie: 0, total: 9 }), { reste: 1, motif: "total", deja: 0 });
eq("reste : égalité → par pharmacie", R.resteLimite({ parPharmacie: 2, total: 5 }, { pharmacie: 0, total: 3 }).motif, "pharmacie");
eq("reste : jamais négatif", R.resteLimite(L[B], { pharmacie: 9, total: 99 }).reste, 0);

const ETAT = { [A]: R.resteLimite(L[A], D[A]), [B]: R.resteLimite(L[B], D[B]) };
const P1 = R.depassementsLimites([{ cip: A, qty: 1 }, { cip: A, qty: 2 }, { cip: B, qty: 1 }, { cip: C, qty: 99 }], L, ETAT);
eq("panier : lignes d'un même CIP additionnées, produit sans limite ignoré", P1.panier, { [A]: 3, [B]: 1 });
eq("panier : dépassement", P1.over.map(o => [o.cip, o.demande, o.reste, o.motif]), [[A, 3, 2, "pharmacie"]]);
eq("panier sans lecture : limites seules", R.depassementsLimites([{ cip: A, qty: 5 }, { cip: B, qty: 5 }], L, null).over.map(o => [o.cip, o.reste]), [[B, 4]]);
eq("message : par pharmacie", R.messageDepassement(P1.over[0]), "PRODUIT A (fictif) : 5 au plus par pharmacie pour cette offre (déjà commandé : 3), encore 2 possibles");
eq("message : total", R.messageDepassement({ nom: "X", motif: "total", reste: 1, demande: 3 }), "X : quantité limitée, plus que 1 boîte disponible pour cette offre (3 demandées)");
eq("message : total épuisé", R.messageDepassement({ nom: "X", motif: "total", reste: 0, demande: 1 }), "X : quantité limitée, plus rien de disponible pour cette offre");
eq("message : limite atteinte", R.messageDepassement({ nom: "X", motif: "pharmacie", reste: 0, demande: 1, deja: 5, parPharmacie: 5 }), "X : 5 au plus par pharmacie pour cette offre (déjà commandé : 5), plus rien de possible");

const pa = (l, e, n) => { const p = R.pastilleLimite(l, e, n); return p && [p.ton, p.regle, p.etat]; };
eq("pastille : pas encore lue", pa(L[A], null, 0), ["info", "5 max par pharmacie", ""]);
eq("pastille : pas encore lue, au-delà de la limite", pa(L[A], null, 7), ["danger", "5 max par pharmacie", "2 de trop"]);
eq("pastille : reste", pa(L[A], ETAT[A], 0), ["info", "5 max par pharmacie", "encore 2"]);
eq("pastille : reste avec panier", pa(L[A], ETAT[A], 1), ["info", "5 max par pharmacie", "encore 1"]);
eq("pastille : rien de plus", pa(L[A], ETAT[A], 2), ["info", "5 max par pharmacie", "rien de plus possible"]);
eq("pastille : de trop", pa(L[A], ETAT[A], 4), ["danger", "5 max par pharmacie", "2 de trop"]);
eq("pastille : limite atteinte", pa(L[A], { reste: 0, motif: "pharmacie", deja: 5 }, 0), ["warn", "5 max par pharmacie", "limite atteinte"]);
eq("pastille : épuisé (total)", pa(L[B], { reste: 0, motif: "total", deja: 0 }, 0), ["warn", "4 max par pharmacie", "épuisé"]);
eq("pastille : plus que n disponibles (total)", pa(L[B], { reste: 3, motif: "total", deja: 0 }, 1), ["info", "4 max par pharmacie", "plus que 2 disponibles"]);
eq("pastille : total seul", pa({ parPharmacie: null, total: 10 }, null, 0), ["info", "quantité limitée", ""]);
vrai("pastille : détail (déjà commandé, panier)", /Déjà commandé : 3\. Au panier : 1\. Encore possible : 1\./.test(R.pastilleLimite(L[A], ETAT[A], 1).bulle));
eq("pastille : produit sans limite", R.pastilleLimite(null, null, 0), null);

// ════════════════════════ 2. serveur (_promo-limites.js) ════════════════════════
const S = await import("../netlify/functions/_promo-limites.js");
// base simulée : ec_config + elixir_orders (filtres date, or=(pharmacy_cip.eq…, pharmacy_email.eq…), pages par Range)
let BASE = { promos: JSON.stringify(PROMOS), commandes: CMDS }, lectures = [], configEnPanne = false, commandesEnPanne = false;
const filtrer = (path) => {
  const u = new URL(`https://x/${path}`);
  const depuis = Date.parse(decodeURIComponent(u.searchParams.get("date") || "gte.").slice(4)) || 0;
  const ou = u.searchParams.get("or"), id = u.searchParams.get("id");
  let rows = BASE.commandes.filter(o => Date.parse(o.date) >= depuis && (!id || `eq.${o.id}` === id));
  if (ou) {
    const conds = ou.slice(1, -1).split(",").map(c => { const [champ, op, ...v] = c.split("."); return { champ, op, v: v.join(".").replace(/^"|"$/g, "") }; });
    if (conds.some(c => c.op !== "eq")) throw new Error(`opérateur refusé : ${ou}`);
    rows = rows.filter(o => conds.some(c => String(o[c.champ] ?? "") === c.v));
  }
  return rows.sort((a, b) => a.id - b.id);
};
const sbFaux = async (path, { range } = {}) => {
  lectures.push(path);
  if (path.startsWith("ec_config")) { if (configEnPanne) throw new Error("Supabase en panne"); return [{ value: BASE.promos }]; }
  if (path.startsWith("elixir_orders")) {
    if (commandesEnPanne) throw new Error("Supabase en panne");
    const rows = filtrer(path), [de, a] = (range || "0-999").split("-").map(Number);
    return rows.slice(de, a + 1);
  }
  if (path.startsWith("elixir_pharmacies")) return path.includes("sans-fiche") ? [] : [{ cip: "2000001" }];
  throw new Error(`lecture inattendue : ${path}`);
};
eq("limites lues (valeur en texte)", Object.keys(await S.lireLimites(sbFaux)).sort(), [A, B]);
eq("pharmacie : CIP valide, adresses en minuscules", S.pharmacie("2000001", "Compte@Pharmacie-A.test", "", null), { cip: "2000001", emails: ["compte@pharmacie-a.test"] });
eq("pharmacie : CIP « 0 » ignoré", S.pharmacie("0", "x@y.fr").cip, null);
const PH = S.pharmacie("2000001", "compte@pharmacie-a.test");

lectures = [];
const E1 = await S.etatLimites({ sb: sbFaux, limites: { [A]: { ...L[A], total: null } }, ph: PH });
eq("pharmacie, sans max total : ses commandes seulement (filtre exact)", lectures.filter(l => l.startsWith("elixir_orders")).every(l => /or=\(/.test(l) && !/ilike/.test(l)), true);
eq("pharmacie, sans max total : reste", E1[A], { reste: 2, motif: "pharmacie", deja: 3, dejaTotal: 3 });
lectures = [];
const E2 = await S.etatLimites({ sb: sbFaux, limites: L, ph: PH });
eq("max total : toutes les commandes (aucun filtre de pharmacie)", lectures.filter(l => l.startsWith("elixir_orders")).every(l => !/or=\(/.test(l)), true);
eq("max total : reste de la pharmacie", [E2[B].reste, E2[B].motif, E2[B].deja, E2[B].dejaTotal], [1, "pharmacie", 3, 8]);
eq("admin : totaux", (await S.etatLimites({ sb: sbFaux, limites: L }))[B].dejaTotal, 8);

// pages de 1 000 : 2 345 commandes → 3 lectures
BASE = { ...BASE, commandes: Array.from({ length: 2345 }, (_, i) => ({ id: 100 + i, date: iso(T0 + 1000 + i), ...AUTRE, items: [{ cip: B, qty: 1 }] })) };
lectures = [];
eq("pages : toutes lues", (await S.etatLimites({ sb: sbFaux, limites: L, ph: PH }))[B].dejaTotal, 2345);
eq("pages : 3 lectures", lectures.filter(l => l.startsWith("elixir_orders")).length, 3);
lectures = [];
const L10 = { [B]: { ...L[B], depuis: T0 - 600e3 } };   // autre début : autre entrée du cache que celle de promo-limites plus bas
await S.etatLimites({ sb: sbFaux, limites: L10, ph: PH, cacheMs: 60e3 });
await S.etatLimites({ sb: sbFaux, limites: L10, ph: PH, cacheMs: 60e3 });
eq("cache 60 s (toutes les commandes) : une seule série de lectures", lectures.filter(l => l.startsWith("elixir_orders")).length, 3);
BASE = { ...BASE, commandes: CMDS };

lectures = [];
eq("contrôle : rien de limité → null, commandes non lues", [await S.controleLimites({ sb: sbFaux, items: [{ cip: C, qty: 50 }], ph: PH }), lectures.some(l => l.startsWith("elixir_orders"))], [null, false]);
const refus = await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 3 }], ph: PH });
eq("contrôle : au-delà → message", refus?.message, "PRODUIT A (fictif) : 5 au plus par pharmacie pour cette offre (déjà commandé : 3), encore 2 possibles");
eq("contrôle : dans la limite → null", await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 2 }], ph: PH }), null);
eq("contrôle : nouvelle pharmacie, total 8/10 → 2 possibles", await S.controleLimites({ sb: sbFaux, items: [{ cip: B, qty: 2 }], ph: S.pharmacie("2000009", "neuve@pharmacie.test") }), null);
eq("contrôle : nouvelle pharmacie, au-delà du total", (await S.controleLimites({ sb: sbFaux, items: [{ cip: B, qty: 3 }], ph: S.pharmacie("2000009", "neuve@pharmacie.test") }))?.over?.map(o => [o.reste, o.motif]), [[2, "total"]]);
BASE = { ...BASE, commandes: [...CMDS, { id: 6, date: iso(T0 + 300e3), ...AUTRE, items: [{ cip: B, qty: 2 }] }] };   // total : 10/10
eq("contrôle : max total atteint → épuisé", (await S.controleLimites({ sb: sbFaux, items: [{ cip: B, qty: 1 }], ph: S.pharmacie("2000009", "neuve@pharmacie.test") }))?.message,
  "PRODUIT B (fictif) : quantité limitée, plus rien de disponible pour cette offre");
BASE = { ...BASE, commandes: CMDS };
configEnPanne = true;
eq("contrôle : limites illisibles → commande non contrôlée", await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 99 }], ph: PH }), null);
configEnPanne = false; commandesEnPanne = true;
let leve = false;
try { await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 1 }], ph: PH }); } catch { leve = true; }
eq("contrôle : commandes illisibles → exception", leve, true);
commandesEnPanne = false;

// ════════════════════════ 3 et 4. fonctions (fetch simulé) ════════════════════════
const JETONS = { "jeton-a": { id: "u-a", email: "compte@pharmacie-a.test" }, "jeton-sans-fiche": { id: "u-s", email: "sans-fiche@pharmacie.test" },
  "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } } };
let ecrites = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const rep = (corps, status = 200, headers = {}) => new Response(corps == null ? "" : JSON.stringify(corps), { status, headers });
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? rep(JETONS[t]) : rep({ msg: "jeton invalide" }, 401);
  }
  if (url.startsWith("https://supabase.test/rest/v1/")) {
    const path = url.slice("https://supabase.test/rest/v1/".length);
    if ((opts.method || "GET") === "POST") {
      if (path.startsWith("elixir_orders")) { const row = JSON.parse(opts.body); if (BASE.commandes.some(o => o.id === row.id)) return rep({ code: "23505", message: "duplicate key" }, 409); ecrites.push(row); return rep(null, 201); }
      return rep(null, 201);   // notifications, décompte du stock
    }
    try { return rep(await sbFaux(path, { range: opts.headers?.Range })); } catch (e) { return rep({ message: e.message }, 503); }
  }
  throw new Error(`appel réseau inattendu : ${url}`);
};
const evt = (corps, jeton, extra = {}) => ({ httpMethod: "POST", headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), "x-elixir-session": "jeton", ...extra },
  body: JSON.stringify(corps) });
const lire = async (r) => ({ status: r.statusCode, corps: JSON.parse(r.body || "null") });

const { handler: limites } = await import("../netlify/functions/promo-limites.js");
eq("promo-limites : sans jeton → 401", (await lire(await limites(evt({}, null)))).status, 401);
eq("promo-limites : compte sans pharmacie → 403", (await lire(await limites(evt({}, "jeton-sans-fiche")))).status, 403);
const rp = await lire(await limites(evt({ cip: "9999999", email: "autre@x.fr" }, "jeton-a")));
eq("promo-limites : pharmacie (corps ignoré) → reste, rien sur les autres pharmacies", rp, { status: 200, corps: { limites: { [A]: { reste: 2, motif: "pharmacie", deja: 3 }, [B]: { reste: 1, motif: "pharmacie", deja: 3 } } } });
eq("promo-limites : saisie Elixir → pharmacie servie (déjà au-delà : 5 pour 4)", (await lire(await limites(evt({ cip: "2000002", email: "autre@pharmacie-b.test" }, "jeton-admin")))).corps.limites[B], { reste: 0, motif: "pharmacie", deja: 5 });
eq("promo-limites : admin → totaux", (await lire(await limites(evt({ admin: true }, "jeton-admin")))).corps.limites[B], { nom: "PRODUIT B (fictif)", menu: "Précommande FICTIVE", parPharmacie: 4, total: 10, dejaTotal: 8 });
eq("promo-limites : totaux refusés à une pharmacie", (await lire(await limites(evt({ admin: true }, "jeton-a")))).status, 403);
BASE = { ...BASE, promos: "[]" };
lectures = [];
eq("promo-limites : aucune limite → {} sans lire les commandes", [(await lire(await limites(evt({}, "jeton-a")))).corps, lectures.some(l => l.startsWith("elixir_orders"))], [{ limites: {} }, false]);
BASE = { ...BASE, promos: JSON.stringify(PROMOS) };

const { handler: orderSave } = await import("../netlify/functions/order-save.js");
const commande = (id, items, extra = {}) => ({ id, items, totalHt: 1, nbLignes: items.length, source: "catalogue", pharmacyName: "PHARMACIE A", ...extra });
ecrites = [];
let r = await lire(await orderSave(evt(commande(1790000000001, [{ cip: A, qty: 3, pn: 10 }]), "jeton-a")));
eq("order-save : au-delà → 400, motif, rien d'écrit", [r.status, r.corps.error, ecrites.length], [400, "PRODUIT A (fictif) : 5 au plus par pharmacie pour cette offre (déjà commandé : 3), encore 2 possibles", 0]);
r = await lire(await orderSave(evt(commande(1790000000002, [{ cip: A, qty: 2, pn: 10 }, { cip: C, qty: 40, pn: 30 }]), "jeton-a")));
eq("order-save : dans la limite → enregistrée", [r.status, r.corps.success, ecrites.length], [200, true, 1]);
ecrites = [];
r = await lire(await orderSave(evt(commande(2, [{ cip: A, qty: 2 }, { cip: B, qty: 1 }, { cip: C, qty: 9 }]), "jeton-a")));
eq("order-save : même numéro renvoyé (réponse perdue) → pas compté contre lui-même, { deja }", [r.status, r.corps.deja, ecrites.length], [200, true, 0]);
r = await lire(await orderSave(evt(commande(1790000000003, [{ cip: C, qty: 500 }]), "jeton-a")));
eq("order-save : sans produit limité → inchangé", [r.status, r.corps.success], [200, true]);
ecrites = [];
r = await lire(await orderSave(evt(commande(1790000000004, [{ cip: A, qty: 6 }], { enteredByAdmin: true, pharmacyCip: "2000002", pharmacyEmail: "autre@pharmacie-b.test" }), "jeton-admin")));
eq("order-save : saisie Elixir au-delà → 400 aussi", [r.status, ecrites.length], [400, 0]);
commandesEnPanne = true;
r = await lire(await orderSave(evt(commande(1790000000005, [{ cip: A, qty: 1 }]), "jeton-a")));
eq("order-save : commandes illisibles → 503, rien d'écrit", [r.status, ecrites.length], [503, 0]);
commandesEnPanne = false;
r = await lire(await orderSave(evt({ verifier: true }, "jeton-a")));
eq("order-save : { verifier } inchangé (rien de lu ni d'écrit)", [r.status, r.corps.success], [200, true]);

// ════════════════════════ 5. site et admin (branchement) ════════════════════════
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"), adm = readFileSync(new URL("../src/AdminPanel.jsx", import.meta.url), "utf8");
vrai("site : module chargé à la demande", /const chargerLimites = \(\) => import\("\.\/components\/limites\/LimitesPromo\.jsx"\)/.test(app) && !/from "\.\/limites-promo\.js"/.test(app));
vrai("site : envoi bloqué au-delà", /disabled=\{[^}]*limitesCheck\.over\.length > 0/.test(app));
eq("site : pastille dans les 4 vues (recherche, cartes, liste mobile, tableau)", (app.match(/limiteLigne\(p\.cip/g) || []).length, 4);
vrai("site : encart et alerte du panier", app.includes("<modLimites.EncartLimite") && app.includes("<modLimites.AlerteLimites"));
vrai("site : lecture par promo-limites", app.includes('"/.netlify/functions/promo-limites"'));
vrai("admin : champs et contrôle", adm.includes("maxPharmacie, maxTotal }") && adm.includes("Max total (toutes pharmacies)") && adm.includes("CIP requis"));
const fictives = readFileSync(new URL("../src/dev/reponses-fictives.js", import.meta.url), "utf8");
vrai("aperçus (essai à blanc) : réponse neutre", fictives.includes('case "promo-limites":'));

console.log(`\n${ok} vérification(s) réussie(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
