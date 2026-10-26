// Tests des limites de quantité des menus promo et précommandes : node scripts/test-limites-promo.mjs (docs/limites-promo.md)
// Hors ligne : fetch simulé (Supabase Auth et REST), aucune donnée réelle lue ni écrite. Produits FICTIFS (CIP 3400999…) : le dépôt
// est public, aucun produit ni aucune limite d'Elixir n'y figure.
//  1. règles (src/limites-promo.js) : limites des menus actifs, entiers, CIP requis, un CIP limité dans deux menus (une règle par
//     menu, chacune depuis l'ajout du produit à SON menu), début du comptage, quantités déjà commandées (date, quarantaine non
//     comptée, ligne retirée par l'API — handled_at + api_motif — non comptée, api_motif seul compté, items en texte, numéro
//     ignoré, pharmacie), reste et limite qui bloque, dépassements du panier (lignes additionnées, limites seules sans lecture),
//     textes ;
//  2. serveur (_promo-limites.js, sb simulé) : limites en texte, commandes de la pharmacie (CIP, adresse exacte, jamais ilike ;
//     fiche sans CIP : toutes ses adresses) ou de toutes (max total), pages de 1 000, cache (celles de la pharmacie toujours
//     relues), contrôle d'une commande (rien de limité : aucune lecture des commandes ; limites illisibles : non contrôlée ;
//     commandes illisibles : exception) ;
//  3. fonction promo-limites : jeton exigé, compte sans pharmacie, pharmacie (reste), saisie Elixir, admin (totaux par menu),
//     refus admin, { frais } sans le cache ;
//  4. order-save : au-delà → 400 et rien d'écrit ; même numéro renvoyé non compté contre lui-même ; dans la limite → enregistrée ;
//     saisie Elixir ; quarantaine non comptée ; api_motif seul compté ; envois simultanés (nouveau contrôle après l'écriture,
//     commande retirée) ; commandes illisibles avant (503 rien d'écrit) ou après l'écriture (retirée, 503) ; retrait impossible
//     (503, le renvoi retrouve la commande) ; { verifier } sans lecture ;
//  5. site et admin : branchement dans src/App.jsx et src/AdminPanel.jsx.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ADMIN_EMAIL = "admin@elixir.test";
import { readFileSync } from "node:fs";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const choisir = (o, cles) => Object.fromEntries(cles.map(k => [k, o?.[k]]));

const A = "3400999000011", B = "3400999000028", C = "3400999000035", X = "3400999000042";   // fictifs
const T0 = Math.floor(Date.now() / 1000) * 1000 - 3 * 3600e3;   // ajout des produits : il y a 3 h (les commandes écrites maintenant comptent)
const PROMOS = [
  { id: T0 - 864e5, name: "Précommande FICTIVE", active: true, products: [
    { id: T0, name: "PRODUIT A (fictif)", cip: A, pn: 10, maxPharmacie: 5 },
    { id: T0 + 1, name: "PRODUIT B (fictif)", cip: B, pn: 20, maxPharmacie: 4, maxTotal: 10 },
    { id: T0 + 2, name: "PRODUIT C (fictif)", cip: C, pn: 30 },                          // sans limite
    { id: T0 + 3, name: "SANS CIP", cip: null, pn: 5, maxPharmacie: 2 },                 // ignoré : CIP requis
  ] },
  { id: T0, name: "Menu masqué", active: false, products: [{ id: T0, name: "C limité", cip: C, pn: 30, maxPharmacie: 1 }] },
  { id: T0, name: "Autre menu", active: true, products: [{ id: T0 + 5000, name: "A ailleurs", cip: A, pn: 9, maxPharmacie: 8, maxTotal: 50 }] },
];

// ════════════════════════ 1. règles ════════════════════════
const R = await import("../src/limites-promo.js");
eq("entier ≥ 1", [R.entierLimite("5"), R.entierLimite(3), R.entierLimite(""), R.entierLimite("0"), R.entierLimite("2.5"), R.entierLimite("-1"), R.entierLimite(null)], [5, 3, null, null, null, null, null]);
const L = R.limitesActives(PROMOS);
eq("menus actifs, CIP requis, produit sans limite ignoré", Object.keys(L).sort(), [A, B]);
eq("CIP limité dans deux menus actifs : plus basses limites (affichage), début le plus ancien (lecture)", [L[A].parPharmacie, L[A].total, L[A].depuis], [5, 50, T0]);
eq("CIP limité dans deux menus actifs : une règle par menu, chacune depuis l'ajout à SON menu", L[A].regles,
  [{ menu: "Précommande FICTIVE", parPharmacie: 5, total: null, depuis: T0 }, { menu: "Autre menu", parPharmacie: 8, total: 50, depuis: T0 + 5000 }]);
eq("limites de B", [L[B].parPharmacie, L[B].total, L[B].nom, L[B].menu, L[B].regles.length], [4, 10, "PRODUIT B (fictif)", "Précommande FICTIVE", 1]);
eq("début : date d'ajout du produit, sinon du menu", [R.depuisProduit({ id: T0 }, { id: T0 + 1 }), R.depuisProduit({ id: T0 }, { id: 7 }), R.depuisProduit({}, {})], [T0 + 1, T0, 0]);
eq("entrée vide ou invalide", [R.limitesActives(null), R.limitesActives("x")], [{}, {}]);

const iso = (ms) => new Date(ms).toISOString();
const MOI = { pharmacy_cip: "2000001", pharmacy_email: "compte@pharmacie-a.test" };
const AUTRE = { pharmacy_cip: "2000002", pharmacy_email: "autre@pharmacie-b.test" };
const CMDS = [
  { id: 1, date: iso(T0 - 3600e3), ...MOI, items: [{ cip: A, qty: 4 }] },                                    // avant l'ajout : pas comptée
  { id: 2, date: iso(T0 + 60e3), ...MOI, source: "catalogue", items: [{ cip: A, qty: 2 }, { cip: B, qty: 1 }, { cip: C, qty: 9 }] },
  { id: 3, date: iso(T0 + 120e3), ...MOI, items: JSON.stringify([{ cip: B, qty: "2" }]) },                     // items en texte
  { id: 4, date: iso(T0 + 180e3), ...AUTRE, items: [{ cip: B, qty: 5 }, { cip: A, qty: 3, api_motif: "annulee", handled_at: iso(T0 + 200e3) }] },   // A retiré par l'API
  { id: 5, date: iso(T0 + 240e3), pharmacy_cip: null, pharmacy_email: "compte@pharmacie-a.test", items: [{ cip: A, qty: 1 }] },   // sans CIP : par l'adresse
];
const mienne = (o) => o.pharmacy_cip === "2000001" || String(o.pharmacy_email).toLowerCase() === "compte@pharmacie-a.test";
const D = R.quantitesCommandees(CMDS, L, mienne);
eq("déjà commandé : depuis l'ajout, ligne retirée par l'API exclue, items en texte, commande sans CIP par l'adresse", D, { [A]: { pharmacie: 3, total: 3 }, [B]: { pharmacie: 3, total: 8 } });
eq("numéro ignoré (renvoi après réponse perdue)", R.quantitesCommandees(CMDS, L, mienne, 2)[A], { pharmacie: 1, total: 1 });
eq("totaux seuls", R.quantitesCommandees(CMDS, L)[B], { pharmacie: 0, total: 8 });
const PIEGES = [
  { id: 8, date: iso(T0 + 300e3), source: "a_verifier", pharmacy_cip: null, pharmacy_email: null, items: [{ cip: B, qty: 100000 }] },   // quarantaine
  { id: 9, date: iso(T0 + 310e3), ...MOI, items: [{ cip: A, qty: 2, api_motif: "rupture" }] },                                          // api_motif seul (envoyé par la page)
  { id: 10, date: iso(T0 + 320e3), ...MOI, items: [{ cip: A, qty: 1, api_motif: "x", handled_at: "h", synced_at: "s" }] },              // envoyée malgré tout
];
eq("quarantaine (a_verifier) non comptée ; api_motif seul compté ; ligne envoyée comptée", R.quantitesCommandees(PIEGES, L, mienne), { [A]: { pharmacie: 3, total: 3 }, [B]: { pharmacie: 0, total: 0 } });

eq("reste : max par pharmacie", R.resteLimite(L[A].regles[0], D[A]), { reste: 2, motif: "pharmacie", deja: 3 });
eq("reste : par pharmacie plus bas que le total restant", R.resteLimite(L[B], D[B]), { reste: 1, motif: "pharmacie", deja: 3 });
eq("reste : le total bloque", R.resteLimite(L[B], { pharmacie: 0, total: 9 }), { reste: 1, motif: "total", deja: 0 });
eq("reste : égalité → par pharmacie", R.resteLimite({ parPharmacie: 2, total: 5 }, { pharmacie: 0, total: 3 }).motif, "pharmacie");
eq("reste : jamais négatif", R.resteLimite(L[B], { pharmacie: 9, total: 99 }).reste, 0);

// un même CIP dans deux menus actifs (relevé de la revue) : automne (ajouté il y a 55 jours, 10 par pharmacie), hiver (ajouté il y a
// 3 h, 6 par pharmacie, 300 au total) ; à l'automne la pharmacie a pris 6 et les autres 300
const AUTOMNE = T0 - 55 * 864e5;
const LX = R.limitesActives([
  { id: AUTOMNE, name: "Promo automne", active: true, products: [{ id: AUTOMNE, name: "X automne", cip: X, pn: 1, maxPharmacie: 10 }] },
  { id: T0, name: "Précommande hiver", active: true, products: [{ id: T0, name: "X hiver", cip: X, pn: 1, maxPharmacie: 6, maxTotal: 300 }] },
]);
const CX = [{ id: 20, date: iso(AUTOMNE + 864e5), ...MOI, items: [{ cip: X, qty: 6 }] }, { id: 21, date: iso(AUTOMNE + 2 * 864e5), ...AUTRE, items: [{ cip: X, qty: 300 }] }];
const EX = R.etatLimite(CX, LX[X], mienne);
eq("deux menus : chaque règle depuis SON menu, la plus restrictive (automne : 10 − 6 = 4 ; hiver : 6, rien depuis)", choisir(EX, ["reste", "motif", "deja", "parPharmacie", "parMenu"]),
  { reste: 4, motif: "pharmacie", deja: 6, parPharmacie: 10, parMenu: { "Promo automne": 306, "Précommande hiver": 0 } });
eq("deux menus : totaux seuls (admin)", R.etatLimite(CX, LX[X]).parMenu, { "Promo automne": 306, "Précommande hiver": 0 });

const ETAT = { [A]: R.etatLimite(CMDS, L[A], mienne), [B]: R.etatLimite(CMDS, L[B], mienne) };
eq("état de A : règle du menu FICTIVE (5 par pharmacie) plus restrictive que l'autre (8)", choisir(ETAT[A], ["reste", "motif", "deja", "parPharmacie"]), { reste: 2, motif: "pharmacie", deja: 3, parPharmacie: 5 });
const P1 = R.depassementsLimites([{ cip: A, qty: 1 }, { cip: A, qty: 2 }, { cip: B, qty: 1 }, { cip: C, qty: 99 }], L, ETAT);
eq("panier : lignes d'un même CIP additionnées, produit sans limite ignoré", P1.panier, { [A]: 3, [B]: 1 });
eq("panier : dépassement", P1.over.map(o => [o.cip, o.demande, o.reste, o.motif, o.parPharmacie]), [[A, 3, 2, "pharmacie", 5]]);
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
// base simulée : ec_config, elixir_pharmacies (email eq/in, odoo_id in), elixir_orders (filtres date, id, or=(… .eq …), pages par Range)
const PHARMAS = [
  { email: "compte@pharmacie-a.test", cip: "2000001", name: "PHARMACIE A", odoo_id: 1 },
  { email: "autre@pharmacie-b.test", cip: "2000002", name: "PHARMACIE B", odoo_id: 2 },
  { email: "neuve@pharmacie.test", cip: "2000009", name: "PHARMACIE NEUVE", odoo_id: 3 },
  { email: "rapide@pharmacie.test", cip: "2000010", name: "PHARMACIE RAPIDE", odoo_id: 4 },
  { email: "titulaire@sanscip.test", cip: null, name: "PHARMACIE SANS CIP", odoo_id: 9 },
  { email: "commandes@sanscip.test", cip: null, name: "PHARMACIE SANS CIP", odoo_id: 9 },
];
let BASE = { promos: JSON.stringify(PROMOS), commandes: [...CMDS] }, lectures = [], configEnPanne = false, commandesEnPanne = false, panneApres = null;
const sansGuillemets = (v) => v.replace(/^"|"$/g, "");
const filtrer = (path) => {
  const u = new URL(`https://x/${path}`);
  const depuis = Date.parse(decodeURIComponent(u.searchParams.get("date") || "gte.").slice(4)) || 0;
  const ou = u.searchParams.get("or"), id = u.searchParams.get("id");
  let rows = BASE.commandes.filter(o => Date.parse(o.date) >= depuis && (!id || `eq.${o.id}` === id));
  if (ou) {
    const conds = ou.slice(1, -1).split(",").map(c => { const [champ, op, ...v] = c.split("."); return { champ, op, v: sansGuillemets(v.join(".")) }; });
    if (conds.some(c => c.op !== "eq")) throw new Error(`opérateur refusé : ${ou}`);
    rows = rows.filter(o => conds.some(c => String(o[c.champ] ?? "") === c.v));
  }
  return rows.sort((a, b) => a.id - b.id);
};
const pharmacies = (path) => {
  const u = new URL(`https://x/${path}`), email = u.searchParams.get("email"), odoo = u.searchParams.get("odoo_id");
  const liste = (v) => v.slice(4, -1).split(",").map(sansGuillemets);
  if (email?.startsWith("eq.")) return PHARMAS.filter(p => p.email === email.slice(3));
  if (email?.startsWith("in.")) return PHARMAS.filter(p => liste(email).includes(p.email));
  if (odoo?.startsWith("in.")) return PHARMAS.filter(p => liste(odoo).includes(String(p.odoo_id)));
  throw new Error(`lecture des pharmacies inattendue : ${path}`);
};
const sbFaux = async (path, { range } = {}) => {
  lectures.push(path);
  if (path.startsWith("ec_config")) { if (configEnPanne) throw new Error("Supabase en panne"); return [{ value: BASE.promos }]; }
  if (path.startsWith("elixir_orders")) {
    if (panneApres != null && panneApres-- <= 0) throw new Error("Supabase en panne");
    if (commandesEnPanne) throw new Error("Supabase en panne");
    const rows = filtrer(path), [de, a] = (range || "0-999").split("-").map(Number);
    return rows.slice(de, a + 1);
  }
  if (path.startsWith("elixir_pharmacies")) return pharmacies(path);
  throw new Error(`lecture inattendue : ${path}`);
};
const commandesLues = (filtre) => lectures.filter(l => l.startsWith("elixir_orders") && (filtre === undefined || /or=\(/.test(l) === filtre)).length;
eq("limites lues (valeur en texte)", Object.keys(await S.lireLimites(sbFaux)).sort(), [A, B]);
eq("pharmacie : CIP valide, adresses en minuscules", S.pharmacie("2000001", "Compte@Pharmacie-A.test", "", null), { cip: "2000001", emails: ["compte@pharmacie-a.test"] });
eq("pharmacie : CIP « 0 » ignoré", S.pharmacie("0", "x@y.fr").cip, null);
const PH = S.pharmacie("2000001", "compte@pharmacie-a.test");

lectures = [];
const sansTotal = { [A]: { ...L[A], total: null, regles: L[A].regles.map(r => ({ ...r, total: null })) } };
const E1 = await S.etatLimites({ sb: sbFaux, limites: sansTotal, ph: PH });
eq("pharmacie, sans max total : ses commandes seulement (filtre exact)", lectures.filter(l => l.startsWith("elixir_orders")).every(l => /or=\(/.test(l) && !/ilike/.test(l)), true);
eq("pharmacie, sans max total : reste", choisir(E1[A], ["reste", "motif", "deja", "dejaTotal"]), { reste: 2, motif: "pharmacie", deja: 3, dejaTotal: 3 });
lectures = [];
const E2 = await S.etatLimites({ sb: sbFaux, limites: L, ph: PH });
eq("max total : toutes les commandes (aucun filtre de pharmacie), CIP connu : pas de lecture des adresses", [commandesLues(true), lectures.some(l => l.startsWith("elixir_pharmacies"))], [0, false]);
eq("max total : reste de la pharmacie", [E2[B].reste, E2[B].motif, E2[B].deja, E2[B].dejaTotal], [1, "pharmacie", 3, 8]);
eq("admin : totaux", (await S.etatLimites({ sb: sbFaux, limites: L }))[B].dejaTotal, 8);

// fiche sans CIP : deux adresses de connexion → les commandes de l'une comptent pour l'autre
BASE.commandes = [...CMDS, { id: 30, date: iso(T0 + 400e3), pharmacy_cip: null, pharmacy_email: "commandes@sanscip.test", items: [{ cip: A, qty: 5 }] }];
lectures = [];
const ESC = await S.etatLimites({ sb: sbFaux, limites: sansTotal, ph: S.pharmacie(null, "titulaire@sanscip.test") });
eq("fiche sans CIP : commandes de toutes ses adresses (limite atteinte)", choisir(ESC[A], ["reste", "deja"]), { reste: 0, deja: 5 });
vrai("fiche sans CIP : adresses lues par la fiche (odoo_id)", lectures.some(l => /^elixir_pharmacies\?odoo_id=in\.\(9\)/.test(l)));
BASE.commandes = [...CMDS];

// pages de 1 000 : 2 345 commandes → 3 lectures
BASE.commandes = Array.from({ length: 2345 }, (_, i) => ({ id: 100 + i, date: iso(T0 + 1000 + i), ...AUTRE, items: [{ cip: B, qty: 1 }] }));
lectures = [];
eq("pages : toutes lues", (await S.etatLimites({ sb: sbFaux, limites: L, ph: PH }))[B].dejaTotal, 2345);
eq("pages : 3 lectures", commandesLues(), 3);
lectures = [];
const L10 = { [B]: { ...L[B], depuis: T0 - 600e3, regles: [{ ...L[B].regles[0], depuis: T0 - 600e3 }] } };   // autre entrée du cache que promo-limites
await S.etatLimites({ sb: sbFaux, limites: L10, ph: PH, cacheMs: 60e3 });
BASE.commandes.push({ id: 9000, date: iso(T0 + 9000e3), ...MOI, items: [{ cip: B, qty: 2 }] }, { id: 9001, date: iso(T0 + 9001e3), ...AUTRE, items: [{ cip: B, qty: 7 }] });
const EC = await S.etatLimites({ sb: sbFaux, limites: L10, ph: PH, cacheMs: 60e3 });
eq("cache 60 s : toutes les commandes lues une fois (3 pages), celles de la pharmacie relues à chaque fois", [commandesLues(false), commandesLues(true)], [3, 2]);
eq("cache 60 s : la commande que la pharmacie vient d'envoyer comptée, celle d'une autre pas encore", [EC[B].deja, EC[B].dejaTotal], [2, 2347]);
eq("sans le cache : celle de l'autre pharmacie aussi", (await S.etatLimites({ sb: sbFaux, limites: L10, ph: PH }))[B].dejaTotal, 2354);
BASE.commandes = [...CMDS];

lectures = [];
eq("contrôle : rien de limité → pas de limite, commandes non lues", [await S.controleLimites({ sb: sbFaux, items: [{ cip: C, qty: 50 }], ph: PH }), commandesLues()], [{ limite: false, refus: null }, 0]);
eq("contrôle : au-delà → refus", (await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 3 }], ph: PH })).refus?.message,
  "PRODUIT A (fictif) : 5 au plus par pharmacie pour cette offre (déjà commandé : 3), encore 2 possibles");
eq("contrôle : dans la limite → produit limité, pas de refus", await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 2 }], ph: PH }), { limite: true, refus: null });
const NEUVE = S.pharmacie("2000009", "neuve@pharmacie.test");
eq("contrôle : nouvelle pharmacie, total 8/10 → 2 possibles", (await S.controleLimites({ sb: sbFaux, items: [{ cip: B, qty: 2 }], ph: NEUVE })).refus, null);
eq("contrôle : nouvelle pharmacie, au-delà du total", (await S.controleLimites({ sb: sbFaux, items: [{ cip: B, qty: 3 }], ph: NEUVE })).refus?.over?.map(o => [o.reste, o.motif]), [[2, "total"]]);
BASE.commandes = [...CMDS, { id: 6, date: iso(T0 + 300e3), ...AUTRE, items: [{ cip: B, qty: 2 }] }];   // total : 10/10
eq("contrôle : max total atteint → épuisé", (await S.controleLimites({ sb: sbFaux, items: [{ cip: B, qty: 1 }], ph: NEUVE })).refus?.message,
  "PRODUIT B (fictif) : quantité limitée, plus rien de disponible pour cette offre");
BASE.commandes = [...CMDS];
configEnPanne = true;
eq("contrôle : limites illisibles → commande non contrôlée", await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 99 }], ph: PH }), { limite: false, refus: null });
configEnPanne = false; commandesEnPanne = true;
let leve = false;
try { await S.controleLimites({ sb: sbFaux, items: [{ cip: A, qty: 1 }], ph: PH }); } catch { leve = true; }
eq("contrôle : commandes illisibles → exception", leve, true);
commandesEnPanne = false;

// ════════════════════════ 3 et 4. fonctions (fetch simulé) ════════════════════════
const JETONS = { "jeton-a": { id: "u-a", email: "compte@pharmacie-a.test" }, "jeton-sans-fiche": { id: "u-s", email: "sans-fiche@pharmacie.test" },
  "jeton-n": { id: "u-n", email: "neuve@pharmacie.test" }, "jeton-r": { id: "u-r", email: "rapide@pharmacie.test" },
  "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } } };
let ecrites = [], retraitEnPanne = false;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const rep = (corps, status = 200, headers = {}) => new Response(status === 204 ? null : corps == null ? "" : JSON.stringify(corps), { status, headers });
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? rep(JETONS[t]) : rep({ msg: "jeton invalide" }, 401);
  }
  if (url.startsWith("https://supabase.test/rest/v1/")) {
    const path = url.slice("https://supabase.test/rest/v1/".length), methode = opts.method || "GET";
    await new Promise(r => setTimeout(r, 1));   // une vraie attente réseau : deux envois simultanés s'entrelacent
    if (methode === "POST") {
      if (path.startsWith("elixir_orders")) {
        const row = JSON.parse(opts.body);
        if (BASE.commandes.some(o => o.id === row.id)) return rep({ code: "23505", message: "duplicate key" }, 409);
        ecrites.push(row); BASE.commandes.push(row);
        return rep(null, 201);
      }
      return rep(null, 201);   // notifications, décompte du stock
    }
    if (methode === "DELETE" && path.startsWith("elixir_orders?id=eq.")) {
      if (retraitEnPanne) return rep({ message: "Supabase en panne" }, 503);
      const id = path.slice("elixir_orders?id=eq.".length);
      BASE.commandes = BASE.commandes.filter(o => String(o.id) !== id); ecrites = ecrites.filter(o => String(o.id) !== id);
      return rep(null, 204);
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
eq("promo-limites : admin → totaux, par menu", (await lire(await limites(evt({ admin: true }, "jeton-admin")))).corps.limites[A],
  { nom: "PRODUIT A (fictif)", menu: "Précommande FICTIVE", parPharmacie: 5, total: 50, dejaTotal: 3, parMenu: { "Précommande FICTIVE": 3, "Autre menu": 3 } });
eq("promo-limites : totaux refusés à une pharmacie", (await lire(await limites(evt({ admin: true }, "jeton-a")))).status, 403);
BASE.commandes.push({ id: 40, date: iso(T0 + 500e3), ...AUTRE, items: [{ cip: B, qty: 1 }] });   // autre pharmacie, après la mise en cache
eq("promo-limites : { frais } relit sans le cache (commande d'une autre pharmacie comptée)",
  [(await lire(await limites(evt({}, "jeton-n")))).corps.limites[B].reste, (await lire(await limites(evt({ frais: true }, "jeton-n")))).corps.limites[B].reste], [2, 1]);
BASE.commandes = [...CMDS];
BASE.promos = "[]";
lectures = [];
eq("promo-limites : aucune limite → {} sans lire les commandes", [(await lire(await limites(evt({}, "jeton-a")))).corps, commandesLues()], [{ limites: {} }, 0]);
BASE.promos = JSON.stringify(PROMOS);

const { handler: orderSave } = await import("../netlify/functions/order-save.js");
const commande = (id, items, extra = {}) => ({ id, items, totalHt: 1, nbLignes: items.length, source: "catalogue", pharmacyName: "PHARMACIE A", ...extra });
const envoyer = async (corps, jeton) => lire(await orderSave(evt(corps, jeton)));
const deA = (cip) => BASE.commandes.filter(o => o.pharmacy_cip === cip).flatMap(o => R.lignesCommande(o.items)).filter(l => l.cip === A).reduce((n, l) => n + (parseInt(l.qty) || 0), 0);
ecrites = [];
let r = await envoyer(commande(1790000000001, [{ cip: A, qty: 3, pn: 10 }]), "jeton-a");
eq("order-save : au-delà → 400, motif, rien d'écrit", [r.status, r.corps.error, ecrites.length], [400, "PRODUIT A (fictif) : 5 au plus par pharmacie pour cette offre (déjà commandé : 3), encore 2 possibles", 0]);
// renvoi du même numéro (réponse perdue) quand la commande remplit la limite : sans « sauf », elle serait comptée contre elle-même
BASE.commandes.push({ id: 7, date: iso(T0 + 300e3), ...MOI, source: "catalogue", items: [{ cip: A, qty: 2 }] });   // A : 5/5 avec elle
r = await envoyer(commande(7, [{ cip: A, qty: 2 }]), "jeton-a");
eq("order-save : même numéro renvoyé à la limite → pas compté contre lui-même, { deja }", [r.status, r.corps.deja, ecrites.length], [200, true, 0]);
BASE.commandes = [...CMDS];
r = await envoyer(commande(1790000000002, [{ cip: A, qty: 2, pn: 10 }, { cip: C, qty: 40, pn: 30 }]), "jeton-a");
eq("order-save : dans la limite → enregistrée (et gardée après le nouveau contrôle)", [r.status, r.corps.success, ecrites.length, BASE.commandes.some(o => o.id === 1790000000002)], [200, true, 1, true]);
r = await envoyer(commande(1790000000003, [{ cip: C, qty: 500 }]), "jeton-a");
eq("order-save : sans produit limité → inchangé", [r.status, r.corps.success], [200, true]);
ecrites = [];
r = await envoyer(commande(1790000000004, [{ cip: A, qty: 6 }], { enteredByAdmin: true, pharmacyCip: "2000002", pharmacyEmail: "autre@pharmacie-b.test" }), "jeton-admin");
eq("order-save : saisie Elixir au-delà → 400 aussi", [r.status, ecrites.length], [400, 0]);
BASE.commandes = [...CMDS, PIEGES[0]];   // quarantaine anonyme : 100 000 boîtes de B
r = await envoyer(commande(1790000000005, [{ cip: B, qty: 2 }]), "jeton-n");
eq("order-save : commande en quarantaine (a_verifier) non comptée dans le max total", [r.status, r.corps.success], [200, true]);
BASE.commandes = [...CMDS];
// api_motif seul (envoyé par la page) : la ligne compte quand même
r = await envoyer(commande(1790000000006, [{ cip: A, qty: 2, api_motif: "rupture" }]), "jeton-a");
const r2 = await envoyer(commande(1790000000007, [{ cip: A, qty: 1 }]), "jeton-a");
eq("order-save : api_motif posé par la page ne retire pas la ligne des comptes", [r.status, r2.status], [200, 400]);
BASE.commandes = [...CMDS];
// envois simultanés d'une même pharmacie (2 × 3 boîtes, max 5) : contrôlés avant l'écriture avec les mêmes chiffres, puis de nouveau
// juste après — au-delà, retirés ; jamais plus de 5 gardées
ecrites = [];
const [s1, s2] = await Promise.all([envoyer(commande(1790000000010, [{ cip: A, qty: 3 }]), "jeton-r"), envoyer(commande(1790000000011, [{ cip: A, qty: 3 }]), "jeton-r")]);
eq("order-save : envois simultanés → au plus 5 gardées, refus 400 avec le motif", [deA("2000010") <= 5, [s1.status, s2.status].includes(400),
  [s1, s2].filter(x => x.status === 400).every(x => /5 au plus par pharmacie/.test(x.corps.error))], [true, true, true]);
BASE.commandes = [...CMDS];
ecrites = [];
commandesEnPanne = true;
r = await envoyer(commande(1790000000020, [{ cip: A, qty: 1 }]), "jeton-a");
eq("order-save : commandes illisibles avant l'écriture → 503, rien d'écrit", [r.status, ecrites.length], [503, 0]);
commandesEnPanne = false;
panneApres = 1;   // contrôle avant l'écriture lu, nouveau contrôle illisible
r = await envoyer(commande(1790000000021, [{ cip: A, qty: 1 }]), "jeton-a");
eq("order-save : nouveau contrôle illisible → commande retirée, 503", [r.status, ecrites.length, BASE.commandes.some(o => o.id === 1790000000021)], [503, 0, false]);
panneApres = 1; retraitEnPanne = true;
r = await envoyer(commande(1790000000022, [{ cip: A, qty: 1 }]), "jeton-a");
panneApres = null; retraitEnPanne = false;
const renvoi = await envoyer(commande(1790000000022, [{ cip: A, qty: 1 }]), "jeton-a");
eq("order-save : retrait impossible → 503, le renvoi du même numéro retrouve la commande ({ deja })", [r.status, renvoi.status, renvoi.corps.deja, ecrites.length], [503, 200, true, 1]);
BASE.commandes = [...CMDS];
lectures = []; ecrites = [];
r = await envoyer({ verifier: true }, "jeton-a");
eq("order-save : { verifier } inchangé (ni limites ni commandes lues, rien d'écrit)", [r.status, r.corps.success, lectures.filter(l => /^(ec_config|elixir_orders)/.test(l)).length, ecrites.length], [200, true, 0, 0]);

// ════════════════════════ 5. site et admin (branchement) ════════════════════════
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"), adm = readFileSync(new URL("../src/AdminPanel.jsx", import.meta.url), "utf8");
vrai("site : module chargé à la demande", /const chargerLimites = \(\) => import\("\.\/components\/limites\/LimitesPromo\.jsx"\)/.test(app) && !/from "\.\/limites-promo\.js"/.test(app));
vrai("site : envoi bloqué au-delà", /disabled=\{[^}]*limitesCheck\.over\.length > 0/.test(app));
eq("site : pastille dans les 4 vues (recherche, cartes, liste mobile, tableau)", (app.match(/limiteLigne\(p\.cip/g) || []).length, 4);
vrai("site : résultats de recherche lus aussi", /limitesEnVue = useMemo\([\s\S]{0,400}globalResults\.some\(p => limitesPromo\[p\.cip\]\)/.test(app));
vrai("site : encart et alerte du panier", app.includes("<modLimites.EncartLimite") && app.includes("<modLimites.AlerteLimites"));
vrai("site : lecture par promo-limites, { frais } sans le cache", app.includes('"/.netlify/functions/promo-limites"') && app.includes('frais: force === "frais"'));
vrai("site : nouvel essai 30 s après un échec", app.includes("setTimeout(() => setEssaiLimites(n => n + 1), 30e3)") && /\[limitesEnVue, lireLimitesPromo, essaiLimites\]/.test(app));
vrai("site : commande envoyée → chiffres cachés, relus une fois le panier vidé ou après un refus",
  app.includes('if (sendStatus === "success") { limitesLues.current = {}; setLimitesEtat(null); }')
  && app.includes('else if (!sendStatus && avant && limitesEnVue) lireLimitesPromo("frais");'));
vrai("admin : champs et contrôle", adm.includes("maxPharmacie, maxTotal }") && adm.includes("Max total (toutes pharmacies)") && adm.includes("CIP requis"));
vrai("admin : quantités lues après la publication, par menu", adm.includes("await fileConfig.current.admin_promos;") && adm.includes("lu?.parMenu?.[ps.name] ?? lu?.dejaTotal"));
const fictives = readFileSync(new URL("../src/dev/reponses-fictives.js", import.meta.url), "utf8");
vrai("aperçus (essai à blanc) : réponse neutre", fictives.includes('case "promo-limites":'));

console.log(`\n${ok} vérification(s) réussie(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
