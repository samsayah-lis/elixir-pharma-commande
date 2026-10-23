// Tests du contingentement : node scripts/test-quota.mjs
// Hors ligne : fetch simulé (Supabase Auth, Odoo), aucune donnée réelle lue ni écrite. Produits et règles FICTIFS (CIP
// 3400999…, « PRODUIT A/B/C ») : le dépôt est public, aucun produit contingenté d'Elixir ni aucune de ses règles n'y figure.
//  1. périodes de _quota.js (semaine lundi → dimanche, décade, quinzaine, mois, jours glissants) et libellés du panier ;
//  2. pastille de la ligne d'article (src/quota-ligne.js, 23/10/2026) : périodes en clair, jour du nouveau quota, reste,
//     panier et saisie (« encore n possibles », « rien de plus possible »), colis plus grand que le reste, quantité arrondie
//     au colis, version courte, quota atteint, jours glissants, dispense, vérification en cours, mise à jour après l'envoi,
//     service indisponible, compte sans fiche Odoo, produit sorti de la liste ; paliers atteignables (tiersQuota) ;
//  3. jamais plus permissive que le panier : quotaOver extrait tel quel de src/App.jsx (contrôle de l'envoi), colis, version
//     courte et compte sans fiche Odoo compris ;
//  4. fonction quota-liste : jeton exigé avant toute lecture, admin en saisie, Odoo injoignable, Supabase Auth en panne,
//     cache navigateur privé, règles seules (ni commandes ni fiche lues) ;
//  5. App (VRAI code extrait de src/App.jsx : pharmacie affichée, état du panier et loadQuota, bloc de la ligne ; crochets
//     React simulés) : liste lue une fois avec la pastille, nouvel essai après 2 min si elle échoue ; reste lu seulement à
//     l'affichage d'un produit contingenté, un appel pour tous, gardé 5 min, échec puis nouvel essai après 1 min ; lecture du
//     panier réussie après un échec de la pastille ; commande envoyée : « mise à jour… », lecture partie avant l'envoi
//     ignorée, relu une fois le panier vidé seulement s'il y a une pastille ; dispense gardée pendant la mise à jour ;
//     saisie Elixir : réponse tardive d'une autre pharmacie (pastille ou panier) jamais montrée ni gardée, relue pour la
//     nouvelle ; quota-status au nom de la pharmacie servie (loadQuota).
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.ODOO_APIKEY = "";
process.env.ADMIN_EMAIL = "admin@elixir.test";
import { readFileSync } from "node:fs";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── fetch simulé : toute adresse inconnue échoue (aucun appel réel possible) ──
let appels = [], odooEnPanne = false, authEnPanne = false;
const JETONS = { "jeton-a": { id: "u-a", email: "compte@pharmacie-a.test" }, "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } } };
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  appels.push(url);
  const rep = (corps, status = 200) => new Response(JSON.stringify(corps), { status });
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    if (authEnPanne) return rep({ msg: "upstream request timeout" }, 504);
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? rep(JETONS[t]) : rep({ msg: "jeton invalide" }, 401);
  }
  if (url.startsWith("https://supabase.test/rest/v1/elixir_pharmacies")) return rep([{ cip: "2000001" }]);
  if (url === "https://odoo.test/jsonrpc") {
    if (odooEnPanne) throw new TypeError("fetch failed");
    const b = JSON.parse(opts.body).params;
    if (b.service === "common") return rep({ result: 7 });
    const [, , , model, method] = b.args;
    if (model === "ir.property" && method === "search_read") return rep({ result: [{ res_id: "product.template,5" }, { res_id: "product.template,6" }, { res_id: "product.template,7" }] });
    if (model === "product.template" && method === "read") return rep({ result: [
      { id: 5, default_code: "3400999000011", barcode: "3400999000011", name: "PRODUIT A (fictif)", quota: 6, quota_period: "-1", quota_slippery_days: 0, product_variant_id: [55, "A"], active: true },
      { id: 6, default_code: "REF-B", barcode: "3400999000028", name: "PRODUIT B (fictif)", quota: 2, quota_period: "1", quota_slippery_days: 3, product_variant_id: [56, "B"], active: true },
      { id: 7, default_code: "3400999000035", barcode: "", name: "PRODUIT C (fictif)", quota: 0, quota_period: "-4", quota_slippery_days: 0, product_variant_id: [57, "C"], active: true },
    ] });
    return rep({ error: { message: `appel Odoo inattendu : ${model}.${method}` } });
  }
  throw new Error(`appel réseau inattendu : ${url}`);
};

// ════════════════════════ 1. périodes (_quota.js) ════════════════════════
const { currentPeriod, quotaLabel, parisDate } = await import("../netlify/functions/_quota.js");
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

// ════════════════════════ 2. pastille de la ligne d'article (src/quota-ligne.js) ════════════════════════
const { periodeQuota, prochainQuota, jourQuota, pastilleQuota } = await import("../src/quota-ligne.js");
const { tiersQuota } = await import("../src/components/quota/entree.jsx").catch(async () => {
  // entree.jsx est du JSX : tiersQuota (fonction pure, sans JSX) en est extraite et évaluée seule
  const src = readFileSync(new URL("../src/components/quota/entree.jsx", import.meta.url), "utf8");
  const i = src.indexOf("export function tiersQuota");
  return import("data:text/javascript," + encodeURIComponent(src.slice(i)));
});
const sp = (s) => s.replace(/ /g, " ");   // espaces insécables de la pastille → espaces (comparaison)
eq("périodes en clair (pastille)", ["-1", "-2", "-3", "-4"].map(p => periodeQuota(p, 0).court).concat([periodeQuota("1", 1).court, periodeQuota("1", 7).court, periodeQuota("1", 0).court]),
  ["par semaine (lundi–dimanche)", "par décade", "par quinzaine", "par mois", "par jour", "sur 7 jours glissants", "par jour"]);
eq("périodes, version courte", ["-1", "-2", "-3", "-4"].map(p => periodeQuota(p, 0).unite).concat([periodeQuota("1", 1).unite, periodeQuota("1", 7).unite]),
  ["semaine", "décade", "quinzaine", "mois", "jour", "7 jours"]);
eq("périodes en clair (bulle : bornes de la décade et de la quinzaine)", [periodeQuota("-1").detail, periodeQuota("-2").detail, periodeQuota("-3").detail, periodeQuota("1", 2).detail, periodeQuota("1", 7).detail],
  ["par semaine, du lundi au dimanche", "par décade : du 1er au 10, du 11 au 20, du 21 à la fin du mois", "par quinzaine : du 1er au 15, du 16 à la fin du mois",
    "sur 2 jours glissants (aujourd'hui et la veille)", "sur 7 jours glissants (aujourd'hui et les 6 jours précédents)"]);
eq("période inconnue ou « pas de quota » → null", [periodeQuota("0"), periodeQuota("9"), periodeQuota(undefined)], [null, null, null]);
eq("jour en clair, au format du panier (quotaDay d'App.jsx)", [jourQuota("2026-10-26"), jourQuota("2026-11-01"), jourQuota("2027-01-04")], ["lun. 26 oct.", "dim. 1 nov.", "lun. 4 janv."]);
// jour du nouveau quota : fin de la période (vendredi 23/10/2026 → lundi 26/10), demain pour un jour glissant, inconnu sinon
const semaine = { ...currentPeriod("-1", 0, "2026-10-23"), period: "-1", days: 0 };
eq("nouveau quota : semaine (vendredi 23/10 → lundi 26/10)", prochainQuota(semaine), "2026-10-26");
eq("nouveau quota : décade, quinzaine, mois", ["-2", "-3", "-4"].map(p => prochainQuota({ ...currentPeriod(p, 0, "2026-10-23"), period: p })), ["2026-11-01", "2026-11-01", "2026-11-01"]);
eq("nouveau quota : 1 jour glissant → demain (fin de mois)", prochainQuota({ ...currentPeriod("1", 1, "2026-10-31"), period: "1", days: 1 }), "2026-11-01");
eq("nouveau quota : plusieurs jours glissants → inconnu", prochainQuota({ ...currentPeriod("1", 7, "2026-10-23"), period: "1", days: 7 }), null);

// produits FICTIFS : A (6 par semaine), B (2 sur 3 jours glissants)
const K = "3400999000011", W = "3400999000028";
const LISTE = { [K]: { quota: 6, period: "-1", days: 0 }, [W]: { quota: 2, period: "1", days: 3 } };
const ligneK = (reste, extra = {}) => ({ name: "PRODUIT A", quota: 6, period: "-1", days: 0, label: "6 par semaine", used: Math.max(0, 6 - reste), remaining: reste, ...semaine, ...extra });
const statut = (produits, extra = {}) => ({ exempt: false, identified: true, today: "2026-10-23", products: produits, ...extra });
const ctx = (quota, inCart = {}, o = {}) => ({ liste: LISTE, quota, check: { inCart }, ko: false, ...o });
const vue = (p) => p && sp(`[${p.ton}] ${p.regle} · ${p.etat}`);
const PK = "6 par semaine (lundi–dimanche)";
eq("reste", vue(pastilleQuota(ctx(statut({ [K]: ligneK(4) })), K)), `[info] ${PK} · reste 4`);
eq("panier : encore n possibles", vue(pastilleQuota(ctx(statut({ [K]: ligneK(4) }), { [K]: 3 }), K)), `[info] ${PK} · reste 4 · 3 au panier : encore 1 possible`);
eq("panier au maximum : rien de plus possible (date du nouveau quota seulement à « quota atteint »)", vue(pastilleQuota(ctx(statut({ [K]: ligneK(8, { quota: 10 }) }), { [K]: 3 }), K, { saisie: 5 })),
  "[info] 10 par semaine (lundi–dimanche) · reste 8 · 3 au panier + 5 saisis : rien de plus possible");
eq("saisie au maximum (rien au panier)", vue(pastilleQuota(ctx(statut({ [K]: ligneK(4) })), K, { saisie: 4 })), `[info] ${PK} · reste 4 · 4 saisis : rien de plus possible`);
eq("saisie : encore n possibles", vue(pastilleQuota(ctx(statut({ [K]: ligneK(4) }), { [K]: 1 }), K, { saisie: 1 })), `[info] ${PK} · reste 4 · 1 au panier + 1 saisi : encore 2 possibles`);
eq("quota atteint (reste 0)", vue(pastilleQuota(ctx(statut({ [K]: ligneK(0) })), K)), `[warn] ${PK} · quota atteint · nouveau quota le lun. 26 oct.`);
eq("au-delà du reste : panier", vue(pastilleQuota(ctx(statut({ [K]: ligneK(2) }), { [K]: 3 }), K)), `[danger] ${PK} · reste 2 · 3 au panier : 1 de trop`);
eq("au-delà du reste : panier + saisie", vue(pastilleQuota(ctx(statut({ [K]: ligneK(2) }), { [K]: 1 }), K, { saisie: "2" })), `[danger] ${PK} · reste 2 · 1 au panier + 2 saisis : 1 de trop`);
eq("au-delà du reste : saisie seule", vue(pastilleQuota(ctx(statut({ [K]: ligneK(2) })), K, { saisie: 3 })), `[danger] ${PK} · reste 2 · 3 saisis : 1 de trop`);
eq("quota atteint et panier : date du nouveau quota", vue(pastilleQuota(ctx(statut({ [K]: ligneK(0) }), { [K]: 1 }), K)),
  `[danger] ${PK} · quota atteint · 1 au panier : 1 de trop · nouveau quota le lun. 26 oct.`);
eq("trop : nombre exact", pastilleQuota(ctx(statut({ [K]: ligneK(2) }), { [K]: 5 }), K, { saisie: 1 }).trop, 4);
// colis (pas) : reste qu'aucun ajout ne peut utiliser ; quantité tapée arrondie au colis
eq("colis plus grand que le reste : avertissement, pas « reste 4 » en calme", vue(pastilleQuota(ctx(statut({ [K]: ligneK(4) })), K, { pas: 120 })),
  `[warn] ${PK} · reste 4 · se commande par 120 : pas possible sur cette période`);
eq("colis : encore possible au pas du colis", vue(pastilleQuota(ctx(statut({ [K]: ligneK(300, { quota: 400 }) }), { [K]: 120 }), K, { pas: 120 })),
  "[info] 400 par semaine (lundi–dimanche) · reste 300 · 120 au panier : encore 120 possibles");
eq("colis : reste du panier plus petit qu'un colis → rien de plus possible", vue(pastilleQuota(ctx(statut({ [K]: ligneK(300, { quota: 400 }) }), { [K]: 240 }), K, { pas: 120 })),
  "[info] 400 par semaine (lundi–dimanche) · reste 300 · 240 au panier : rien de plus possible");
eq("Saisie : 1 tapé → 120 (colis) au-delà du reste", vue(pastilleQuota(ctx(statut({ [K]: ligneK(10, { quota: 10 }) })), K, { saisie: 120, tape: 1, pas: 120 })),
  "[danger] 10 par semaine (lundi–dimanche) · reste 10 · 1 saisi → 120 (colis) : 110 de trop");
// version courte (cartes, tuiles, liste) : règle « 6/semaine », état court, détail dans la bulle
const court = (inCart, saisie, reste = 4, pas, forme = "courte") => vue(pastilleQuota(ctx(statut({ [K]: ligneK(reste) }), inCart), K, { saisie, pas, forme }));
eq("version courte : reste, encore, rien de plus, de trop, quota atteint, colis",
  [court({}), court({ [K]: 1 }), court({ [K]: 4 }), court({ [K]: 5 }), court({}, 0, 0), court({}, 0, 4, 120)],
  ["[info] 6/semaine · reste 4", "[info] 6/semaine · encore 3", "[info] 6/semaine · rien de plus", "[danger] 6/semaine · 1 de trop", "[warn] 6/semaine · quota atteint", "[warn] 6/semaine · reste 4 · par 120"]);
// forme moyenne (tableaux, recherche, accueil) : période en clair, état court — longueur à peu près constante d'un état à l'autre
eq("forme moyenne : période en clair, état court",
  [court({}, 0, 4, 1, "moyenne"), court({ [K]: 1 }, 0, 4, 1, "moyenne"), court({ [K]: 5 }, 0, 4, 1, "moyenne"), court({}, 0, 0, 1, "moyenne"), vue(pastilleQuota(ctx(null), K, { forme: "moyenne" }))],
  [`[info] ${PK} · reste 4`, `[info] ${PK} · encore 3`, `[danger] ${PK} · 1 de trop`, `[warn] ${PK} · quota atteint`, `[neutral] ${PK} · vérification…`]);
{
  // longueur de l'état, forme moyenne : 20 caractères au plus (« reste 100 · par 160 », « reste non vérifié ») quel que soit l'état
  const etats = [];
  for (const reste of [0, 3, 12, 120]) for (const panier of [0, 2, 13, 200]) for (const pas of [1, 120])
    etats.push(pastilleQuota(ctx(statut({ [K]: ligneK(reste, { quota: 240 }) }), { [K]: panier }), K, { pas, forme: "moyenne" }).etat);
  etats.push(pastilleQuota(ctx(null), K, { forme: "moyenne" }).etat, pastilleQuota(ctx(null, {}, { ko: true }), K, { forme: "moyenne" }).etat);
  eq("forme moyenne : états courts (20 caractères au plus)", etats.filter(e => e.length > 20), []);
}
eq("espaces insécables (jamais « reste / 8 », « 1 de / trop »)", ["reste 4", "1 de trop", "3 au panier"].every(t => pastilleQuota(ctx(statut({ [K]: ligneK(2) }), { [K]: 3 }), K).etat.includes(t.replace(/ /g, " ")) || t === "reste 4"), true);
const ligneW = (reste) => ({ name: "PRODUIT B", quota: 2, period: "1", days: 3, used: 2 - reste, remaining: reste, ...currentPeriod("1", 3, "2026-10-23") });
eq("plusieurs jours glissants : quota atteint, se libère au fil des jours", vue(pastilleQuota(ctx(statut({ [W]: ligneW(0) })), W)), "[warn] 2 sur 3 jours glissants · quota atteint · se libère au fil des jours");
eq("1 jour glissant : nouveau quota demain", vue(pastilleQuota({ ...ctx(statut({ [W]: { ...ligneW(0), days: 1, ...currentPeriod("1", 1, "2026-10-23") } })), liste: { [W]: { quota: 2, period: "1", days: 1 } } }, W)),
  "[warn] 2 par jour · quota atteint · nouveau quota le sam. 24 oct.");
eq("bulle : quota, période, déjà commandé, reste, panier, nouveau quota", pastilleQuota(ctx(statut({ [K]: ligneK(4) }), { [K]: 1 }), K).bulle,
  "Contingentement : 6 au plus par semaine, du lundi au dimanche. Déjà commandé sur la période : 2 (commandes passées et commandes du site pas encore transmises). Reste : 4. Au panier : 1. Nouveau quota le lun. 26 oct. Le panier refuse l'envoi au-delà du reste.");
eq("bulle : colis", /Se commande par 120\./.test(pastilleQuota(ctx(statut({ [K]: ligneK(4) })), K, { pas: 120 }).bulle), true);
// rien à afficher
eq("produit non contingenté : rien", pastilleQuota(ctx(statut({ [K]: ligneK(4) })), "3400000000000"), null);
eq("sans liste : rien", pastilleQuota({ quota: statut({ [K]: ligneK(4) }), check: { inCart: {} } }, K), null);
eq("pharmacie dispensée (deny_quota) : rien", pastilleQuota(ctx({ exempt: true, products: {} }, { [K]: 50 }), K, { saisie: 9 }), null);
eq("dispensée, même en échec de lecture précédent : rien", pastilleQuota(ctx({ exempt: true, products: {} }, {}, { ko: true }), K), null);
eq("produit sorti du contingentement (liste plus ancienne que le reste) : rien", pastilleQuota(ctx(statut({})), K), null);
// reste pas encore lu : la place est prise (« vérification… »), règle de la liste ; après un envoi : « mise à jour… »
eq("reste pas encore lu : « vérification… » (neutre, jamais rouge)", [vue(pastilleQuota(ctx(null, { [K]: 99 }), K, { saisie: 9 })), pastilleQuota(ctx(null, { [K]: 99 }), K, { saisie: 9 }).trop], [`[neutral] ${PK} · vérification…`, 0]);
eq("commande envoyée, reste pas encore relu : « mise à jour… »", vue(pastilleQuota(ctx(null, {}, { attente: true }), K, { forme: "courte" })), "[neutral] 6/semaine · mise à jour…");
// service indisponible : règle de la liste, « reste non vérifié », jamais de blocage annoncé
const nv = pastilleQuota(ctx(null, { [K]: 99 }, { ko: true }), K, { saisie: 5 });
eq("service indisponible : reste non vérifié", [vue(nv), nv.trop], [`[neutral] ${PK} · reste non vérifié`, 0]);
eq("service indisponible : bulle", nv.bulle, "Contingentement : 6 au plus par semaine, du lundi au dimanche. Le reste n'a pas pu être lu : Odoo applique le contingentement à la réception de la commande.");
// compte sans fiche Odoo (quota-status identified: false) : commandes Odoo non lues → jamais un « reste » affirmé ; rouge
// seulement là où le panier refusera (il ne compte, lui aussi, que les commandes du site)
const sansFiche = statut({ [K]: ligneK(6) }, { identified: false });
eq("compte sans fiche Odoo : reste non vérifié (neutre)", vue(pastilleQuota(ctx(sansFiche, { [K]: 2 }), K)), `[neutral] ${PK} · reste non vérifié`);
eq("compte sans fiche Odoo : bulle honnête (commandes du site seulement)", /Les autres commandes n'ont pas pu être comptées/.test(pastilleQuota(ctx(sansFiche), K).bulle) && !/commandes passées et/.test(pastilleQuota(ctx(sansFiche), K).bulle), true);
eq("compte sans fiche Odoo : au-delà de ce que le panier compte → rouge, comme le panier", vue(pastilleQuota(ctx(sansFiche, { [K]: 7 }), K)), `[danger] ${PK} · reste 6 · 7 au panier : 1 de trop`);
// paliers atteignables (jauge, badge) : au plus base + reste − panier, au pas du colis ; inchangés sans reste lu
const T3 = [{ min_qty: 10, price: 1 }, { min_qty: 20, price: 0.9 }, { min_qty: 50, price: 0.8 }];
const cT = (reste, inCart, o = {}) => ({ liste: { [K]: LISTE[K] }, quota: statut({ [K]: ligneK(reste, { quota: 100 }) }), check: { inCart }, ...o });
eq("paliers : au-delà du reste retirés (reste 12, rien au panier)", tiersQuota(cT(12, {}), K, T3, 0, 1).map(t => t.min_qty), [10]);
eq("paliers : la ligne compte (5 au panier sur cette ligne, reste 20)", tiersQuota(cT(20, { [K]: 5 }), K, T3, 5, 1).map(t => t.min_qty), [10, 20]);
eq("paliers : autre ligne du même CIP au panier (Saisie : 0 sur la ligne, 10 ailleurs)", tiersQuota(cT(20, { [K]: 10 }), K, T3, 0, 1).map(t => t.min_qty), [10]);
eq("paliers : au pas du colis (colis 12 : palier 20 → 24 > reste 20)", tiersQuota(cT(20, {}), K, T3, 0, 12).map(t => t.min_qty), [10]);
eq("paliers : reste pas lu, dispense, produit non contingenté → inchangés",
  [tiersQuota({ liste: LISTE, quota: null, check: { inCart: {} } }, K, T3, 0, 1), tiersQuota({ liste: LISTE, quota: { exempt: true, products: {} }, check: { inCart: {} } }, K, T3, 0, 1), tiersQuota(cT(1, {}), "3400000000000", T3, 0, 1)],
  [T3, T3, T3]);

// ════════════════════════ 3. jamais plus permissive que le panier (quotaOver de src/App.jsx) ════════════════════════
const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const entre = (debut, fin, inclure = false) => { const i = APP.indexOf(debut), j = APP.indexOf(fin, i + 1); if (i < 0 || j < 0) throw new Error(`extrait de App.jsx introuvable : ${debut}`); return APP.slice(i, inclure ? j + fin.length : j); };
const quotaOver = new Function(`${entre("const quotaOver = (quota, items) => {", "const quotaDay")}; return quotaOver;`)();
const quotaDay = new Function(`${entre("const quotaDay = ", "\n")}; return quotaDay;`)();
eq("date de la pastille = date du panier (quotaDay)", ["2026-10-26", "2026-11-01", "2027-01-04"].map(d => [jourQuota(d), quotaDay(d)]).every(([a, b]) => a === b), true);
{
  let cas = 0, ecarts = [];
  for (const reste of [0, 1, 2, 4]) for (const panier of [0, 1, 2, 3, 5]) for (const saisie of [0, 1, 2, 3]) for (const cle of [K, W])
    for (const pas of [1, 3]) for (const forme of [undefined, "moyenne", "courte"]) for (const identified of [true, false]) {
      const quota = statut({ [K]: ligneK(reste), [W]: ligneW(Math.min(reste, 2)) }, { identified });
      // panier en une ou deux lignes du même CIP (menu + Saisie, ligne péremption) : additionnées par le panier
      const items = panier > 1 ? [{ cip: cle, qty: 1 }, { cip: cle, qty: panier - 1 }, { cip: "3400000000000", qty: 7 }] : panier ? [{ cip: cle, qty: panier }] : [];
      const p = pastilleQuota(ctx(quota, quotaOver(quota, items).inCart), cle, { saisie, pas, forme });
      const envoi = quotaOver(quota, saisie ? [...items, { cip: cle, qty: saisie }] : items).over.find(o => o.cip === cle);
      cas++;
      if ((p.ton === "danger") !== !!envoi || (envoi && p.trop !== envoi.qty - envoi.remaining)) ecarts.push({ cle, reste, panier, saisie, pas, forme, identified, ton: p.ton, envoi: !!envoi });
    }
  eq(`pastille rouge ⇔ envoi refusé par le panier, même excédent (${cas} cas : colis, formes moyenne et courte, compte sans fiche)`, ecarts, []);
  const dispense = { exempt: true, products: {} };
  eq("dispense : le panier ne bloque pas, la pastille ne dit rien", [quotaOver(dispense, [{ cip: K, qty: 99 }]).over.length, pastilleQuota(ctx(dispense, quotaOver(dispense, [{ cip: K, qty: 99 }]).inCart), K)], [0, null]);
  eq("reste illisible : le panier ne bloque pas, la pastille ne l'annonce pas", [quotaOver(null, [{ cip: K, qty: 99 }]).over.length, pastilleQuota(ctx(null, {}, { ko: true }), K, { saisie: 99 }).ton], [0, "neutral"]);
}

// ════════════════════════ 4. fonction quota-liste ════════════════════════
const { handler: liste } = await import("../netlify/functions/quota-liste.js");
const ORIGINE = "https://elixir-commande.expepharma.com";
let ip = 1;
const appel = async (methode, jeton) => {
  appels = [];
  const r = await liste({ httpMethod: methode, headers: { origin: ORIGINE, "x-nf-client-connection-ip": `10.9.0.${ip++}`, ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) }, queryStringParameters: {}, body: null });
  let corps; try { corps = JSON.parse(r.body); } catch { corps = r.body; }
  return { statut: r.statusCode, corps, entetes: r.headers || {} };
};
const versOdoo = () => appels.filter(u => u.includes("odoo.test")).length;
let r = await appel("GET");
eq("quota-liste sans jeton → 401 reconnexion, rien lu dans Odoo", [r.statut, r.corps.error, versOdoo(), r.entetes["Cache-Control"]], [401, "reconnexion", 0, "no-store"]);
r = await appel("GET", "jeton-perime");
eq("quota-liste jeton refusé → 401, rien lu dans Odoo", [r.statut, versOdoo()], [401, 0]);
r = await appel("POST", "jeton-a");
eq("quota-liste : GET seulement", r.statut, 405);
odooEnPanne = true;
{ const err = console.error; console.error = () => {}; r = await appel("GET", "jeton-a"); console.error = err; }   // journal attendu de la fonction
eq("quota-liste : Odoo injoignable → 502 (pas de pastille), jamais gardé", [r.statut, r.entetes["Cache-Control"]], [502, "no-store"]);
odooEnPanne = false;
r = await appel("GET", "jeton-a");
eq("quota-liste pharmacie → 200, règles par CIP et par EAN, produits à quota 0 exclus", [r.statut, r.corps.produits],
  [200, { [K]: { quota: 6, period: "-1", days: 0 }, "REF-B": { quota: 2, period: "1", days: 3 }, [W]: { quota: 2, period: "1", days: 3 } }]);
eq("quota-liste : gardée 10 min par le navigateur seulement (privée), CORS", [r.entetes["Cache-Control"], r.entetes["Access-Control-Allow-Origin"]], ["private, max-age=600", ORIGINE]);
eq("quota-liste : règles seules (ni commandes, ni fiche, ni dispense lues)", appels.filter(u => /elixir_orders|sale\.order|res\.partner/.test(u)).length, 0);
r = await appel("GET", "jeton-admin");
eq("quota-liste admin (saisie pour une pharmacie) → 200, même liste, sans relire Odoo (cache de _quota.js)", [r.statut, Object.keys(r.corps.produits).length, versOdoo()], [200, 3, 0]);
authEnPanne = true;
r = await appel("GET", "jeton-a");
eq("quota-liste : Supabase Auth en panne → 503 indisponible (jamais 401)", [r.statut, r.corps.error], [503, "indisponible"]);
authEnPanne = false;

// ════════════════════════ 5. App : VRAI code extrait de src/App.jsx (pharmacie affichée, loadQuota, bloc de la ligne) ════════════════════════
// Crochets React simulés (état par rang d'appel, effets après le rendu, rendus répétés tant que l'état change)
function composant(rendu) {
  const cases = []; let i = 0, sale = false, effets = [], props = {}, sortie;
  const memes = (a, b) => !!a && !!b && a.length === b.length && a.every((d, j) => Object.is(d, b[j]));
  const H = {
    useState(init) { const k = i++; if (!cases[k]) cases[k] = { v: typeof init === "function" ? init() : init }; const c = cases[k];
      return [c.v, (x) => { const v = typeof x === "function" ? x(c.v) : x; if (!Object.is(v, c.v)) { c.v = v; sale = true; } }]; },
    useRef(init) { const k = i++; return (cases[k] ||= { current: init }); },
    useMemo(f, deps) { const k = i++; const c = cases[k]; if (c && memes(c.deps, deps)) return c.v; cases[k] = { v: f(), deps }; return cases[k].v; },
    useCallback(f, deps) { return H.useMemo(() => f, deps); },
    useEffect(f, deps) { const k = i++; const c = cases[k]; if (!c || !deps || !memes(c.deps, deps)) { c?.nettoie?.(); cases[k] = { deps }; effets.push(() => { const n = f(); cases[k].nettoie = typeof n === "function" ? n : null; }); } },
  };
  const rendre = (p = {}) => {
    props = { ...props, ...p };
    for (let n = 0; n < 30; n++) { i = 0; sale = false; effets = []; sortie = rendu(H, props); effets.forEach(f => f()); if (!sale) return sortie; }
    throw new Error("rendus sans fin");
  };
  return { rendre, get sortie() { return sortie; } };
}
const attendre = () => new Promise(r => setTimeout(r, 0));
{
  const cleCode = entre("  // Contingentement (23/10/2026, docs/contingentement-ligne.md) : pharmacie affichée", "  const cartItems = useMemo");
  const etat = entre("  const [quota, setQuota] = useState(null);", "  useEffect(() => { if (cartOpen) loadQuota(); }");
  const bloc = entre("  // ── Contingentement dans la ligne de l'article (23/10/2026", "demanderQuota, cleQuota]);", true);
  const { fabrique } = await import("data:text/javascript," + encodeURIComponent(`export function fabrique(H, P) {
  const { useState, useRef, useCallback, useEffect, useMemo } = H;
  const { pharmacyEmail, pharmacyCip, actingFor, appelAuthentifie, sendStatus, chargerPastille } = P;
  const delai = () => ({});
${cleCode}
${etat}
  const quotaCheck = useMemo(() => ({ inCart: P.inCart || {} }), [quota, P.inCart]);
${bloc}
  return { ctxQuota, demanderQuota, loadQuota, quota };
}`));
  // serveur simulé : quota-liste (panne au choix), quota-status retenu jusqu'à `repondre` / `echouer` (qui : odoo_id ou e-mail)
  let appelsListe = 0, listeEnPanne = false, chargements = 0;
  const lectures = [];
  const appelAuthentifie = async (url, o) => {
    if (url.includes("quota-liste")) { appelsListe++; return listeEnPanne ? { ok: false, status: 502, json: async () => ({}) } : { ok: true, json: async () => ({ produits: LISTE }) }; }
    const corps = JSON.parse(o.body);
    return new Promise(res => lectures.push({ qui: corps.odoo_id || corps.email, repondre: (j) => res({ ok: true, json: async () => j }), echouer: () => res({ ok: false, status: 502, json: async () => ({}) }) }));
  };
  let pastilleEnPanne = false;
  const chargerPastille = async () => { chargements++; return !pastilleEnPanne; };
  const c = composant((H, P) => fabrique(H, { ...P, appelAuthentifie, chargerPastille }));
  const cx = () => c.sortie.ctxQuota, reste = () => cx().quota?.products?.[K]?.remaining ?? null;
  const vueLigne = (o) => vue(pastilleQuota(cx(), K, o));
  const maintenant = Date.now; let decalage = 0; Date.now = () => maintenant() + decalage;
  // minuteries longues (nouvel essai de la liste : 2 min) retenues, déclenchées à la main
  const tempo = globalThis.setTimeout, minuteries = [];
  globalThis.setTimeout = (f, ms, ...a) => (ms >= 6e4 ? (minuteries.push(f), minuteries.length) : tempo(f, ms, ...a));
  const repondre = async (n, j) => { lectures[n].repondre(j); await attendre(); await attendre(); c.rendre(); };
  try {
    c.rendre({ pharmacyEmail: "", pharmacyCip: "", actingFor: null, sendStatus: null, inCart: {} });
    await attendre(); c.rendre();
    eq("App : sans identité, ni liste ni reste lus", [appelsListe, lectures.length, cx().liste], [0, 0, null]);
    // quota-liste en panne au début de la session (Odoo injoignable) : nouvel essai après 2 min (avant : plus jamais relue)
    listeEnPanne = true;
    c.rendre({ pharmacyEmail: "compte@pharmacie-a.test", pharmacyCip: "2000001" });
    await attendre(); await attendre(); c.rendre(); c.rendre();
    eq("App : liste en échec → pas de pastille, nouvel essai programmé (2 min)", [appelsListe, cx().liste, minuteries.length], [1, null, 1]);
    listeEnPanne = false;
    minuteries.shift()(); c.rendre(); await attendre(); await attendre(); c.rendre();
    eq("App : nouvel essai → liste lue (et pastille chargée avec elle)", [appelsListe, !!cx().liste?.[K], chargements >= 2], [2, true, true]);
    {
      // pastille pas chargée (connexion coupée, nouvelle version en ligne) : ni liste ni pastille, nouvel essai des deux
      const c3 = composant((H, P) => fabrique(H, { ...P, appelAuthentifie, chargerPastille }));
      pastilleEnPanne = true; const avant = appelsListe;
      c3.rendre({ pharmacyEmail: "compte@pharmacie-z.test", pharmacyCip: "", actingFor: null, sendStatus: null, inCart: {} }); await attendre(); await attendre(); c3.rendre();
      eq("App : pastille non chargée → liste non posée, nouvel essai programmé", [c3.sortie.ctxQuota.liste, minuteries.length], [null, 1]);
      pastilleEnPanne = false; minuteries.shift()(); c3.rendre(); await attendre(); await attendre(); c3.rendre();
      eq("App : nouvel essai → liste et pastille", [!!c3.sortie.ctxQuota.liste?.[K], appelsListe - avant], [true, 2]);
    }
    c.rendre(); c.rendre();
    eq("App : liste lue une fois ; aucun reste lu tant qu'aucun produit contingenté n'est affiché", [appelsListe, lectures.length], [4, 0]);
    // trois pastilles s'affichent : une seule lecture (un appel pour tous les produits)
    cx().montees.current = 3;
    cx().demander(); cx().demander(); cx().demander();
    eq("App : trois pastilles → une seule lecture de quota-status", lectures.length, 1);
    eq("App : pendant la lecture, « vérification… » (place prise, rien de bloqué)", [cx().quota, cx().ko, vueLigne()], [null, false, "[neutral] 6 par semaine (lundi–dimanche) · vérification…"]);
    await repondre(0, statut({ [K]: ligneK(4) }));
    eq("App : reste montré une fois lu", reste(), 4);
    cx().demander(); decalage = 299e3; cx().demander();
    eq("App : reste gardé 5 min (aucune relecture)", lectures.length, 1);
    decalage = 301e3; cx().demander();
    eq("App : relu après 5 min", lectures.length, 2);
    lectures[1].echouer(); await attendre(); await attendre(); c.rendre();
    eq("App : lecture en échec → « reste non vérifié » (ko), rien de bloqué", [cx().ko, cx().quota, vueLigne()], [true, null, "[neutral] 6 par semaine (lundi–dimanche) · reste non vérifié"]);
    decalage += 59e3; cx().demander();
    eq("App : pas de nouvel essai avant 1 min", lectures.length, 2);
    // le panier (ouverture, ajout depuis la Saisie) relit avec succès : la ligne reprend son reste (avant : « non vérifié » jusqu'au nouvel essai)
    const n = () => lectures.length, der = () => lectures.length - 1;
    c.sortie.loadQuota();
    eq("App : lecture du panier partie", n(), 3);
    await repondre(der(), statut({ [K]: ligneK(3) }));
    eq("App : lecture du panier réussie après un échec de la pastille → reste montré", [reste(), vueLigne()], [3, "[info] 6 par semaine (lundi–dimanche) · reste 3"]);
    decalage += 2e3; cx().demander();
    eq("App : reste lu par le panier → la pastille ne relit pas (gardé comme le sien)", [n(), reste()], [3, 3]);
    // commande envoyée : reste d'avant caché (« mise à jour… »), relu une fois le panier vidé (fin de « Commande envoyée »)
    c.rendre({ sendStatus: "success" });
    cx().demander();   // les pastilles redemandent : rien tant que le panier n'est pas vidé
    eq("App : « Commande envoyée » → reste d'avant caché, « mise à jour… », pas encore relu", [cx().quota, vueLigne({ forme: "courte" }), n()], [null, "[neutral] 6/semaine · mise à jour…", 3]);
    c.rendre({ sendStatus: null });
    eq("App : panier vidé, pastilles à l'écran → reste relu", n(), 4);
    await repondre(der(), statut({ [K]: ligneK(0) }));
    eq("App : reste relu après l'envoi (commande du site comptée)", [reste(), cx().attente], [0, false]);
    // relecture en échec après un envoi : « reste non vérifié » (jamais le reste d'avant l'envoi)
    c.rendre({ sendStatus: "success" }); c.rendre({ sendStatus: null });
    lectures[der()].echouer(); await attendre(); await attendre(); c.rendre();
    eq("App : relecture en échec après l'envoi → « reste non vérifié », reste d'avant toujours caché", [cx().quota, vueLigne()], [null, "[neutral] 6 par semaine (lundi–dimanche) · reste non vérifié"]);
    decalage += 61e3; cx().demander(); await repondre(der(), statut({ [K]: ligneK(0) }));
    eq("App : nouvel essai 1 min après → reste montré", [n(), reste(), cx().ko], [6, 0, false]);
    // C. lecture de la pastille EN COURS pendant l'envoi : sa réponse (d'avant l'enregistrement) n'est jamais montrée
    decalage += 301e3; cx().demander();
    const nAvant = der();
    eq("App : lecture partie juste avant l'envoi", n(), 7);
    c.rendre({ sendStatus: "success" });
    await repondre(nAvant, statut({ [K]: ligneK(4) }));   // réponse calculée AVANT l'enregistrement de la commande
    eq("App : réponse d'avant l'envoi arrivée pendant « Commande envoyée » → pas montrée", [cx().quota, cx().attente], [null, true]);
    c.rendre({ sendStatus: null });
    eq("App : panier vidé → relu (et non gardé 5 min sur la réponse d'avant ; avant : « reste 4 », 1 seule lecture)", n(), 8);
    await repondre(der(), statut({ [K]: ligneK(1) }));
    eq("App : reste d'après l'envoi montré", reste(), 1);
    // aucune pastille à l'écran : l'envoi ne relit pas le reste (aucune lecture Odoo de plus) ; la suivante relira
    cx().montees.current = 0;
    c.rendre({ sendStatus: "success" }); c.rendre({ sendStatus: null });
    eq("App : aucune pastille à l'écran → l'envoi ne lit pas le reste", n(), 8);
    cx().montees.current = 1; cx().demander();
    eq("App : pastille affichée ensuite → reste relu (pas gardé 5 min depuis avant l'envoi)", n(), 9);
    await repondre(der(), statut({ [K]: ligneK(1) }));
    // pharmacie dispensée : la mise à jour après l'envoi ne fait pas apparaître de pastille
    decalage += 301e3; cx().demander(); await repondre(der(), { exempt: true, products: {} });
    c.rendre({ sendStatus: "success" });
    eq("App : dispensée → rien, même pendant la mise à jour après l'envoi", [cx().quota?.exempt, pastilleQuota(cx(), K)], [true, null]);
    c.rendre({ sendStatus: null }); await repondre(der(), { exempt: true, products: {} });

    // A. saisie Elixir : lecture du PANIER pour A (hors pastille), réponse lente arrivée après le passage à B et la lecture de B.
    // Autre pharmacie : la pastille redemande (son effet dépend de ctx.cle) — simulé par changer()
    const changer = (p) => { c.rendre(p); cx().demander(); c.rendre(); };
    changer({ actingFor: { odoo_id: 41, name: "PHARMACIE A" }, pharmacyEmail: "", pharmacyCip: "7000041" });
    await repondre(lectures.length - 1, statut({ [K]: ligneK(4) }));
    eq("App : pharmacie A servie, reste montré", [lectures[lectures.length - 1].qui, reste()], [41, 4]);
    c.sortie.loadQuota();   // panier ouvert / ajout depuis la Saisie pour A
    const nA = lectures.length - 1;
    changer({ actingFor: { odoo_id: 42, name: "PHARMACIE B" }, pharmacyCip: "7000042" });
    eq("App : pharmacie B choisie → rien de montré de A, lecture pour B", [cx().quota, lectures[lectures.length - 1].qui], [null, 42]);
    await repondre(lectures.length - 1, statut({ [K]: ligneK(1) }));
    eq("App : reste de B montré", reste(), 1);
    await repondre(nA, statut({ [K]: ligneK(6) }));   // réponse tardive pour A
    eq("App : réponse tardive pour A (panier) après la lecture de B → ni montrée ni gardée (avant : « reste 6 » sur les lignes de B)", [reste(), c.sortie.quota?.products?.[K]?.remaining], [1, 1]);
    // même chose pour une lecture de la pastille partie pour B puis passage à C
    decalage += 301e3; cx().demander(); const nB = lectures.length - 1;
    changer({ actingFor: { odoo_id: 43, name: "PHARMACIE C" }, pharmacyCip: "7000043" });
    const nC = lectures.length - 1;
    eq("App : pastille de C : lecture pour C", [lectures[nB].qui, lectures[nC].qui], [42, 43]);
    await repondre(nB, statut({ [K]: ligneK(5) }));
    eq("App : réponse de B arrivée après le passage à C → pas montrée", cx().quota, null);
    await repondre(nC, statut({ [K]: ligneK(2) }));
    eq("App : reste de C montré", reste(), 2);
    eq("App : liste non relue au changement de pharmacie (mêmes règles pour toutes)", appelsListe, 4);
    // commande envoyée pendant un « mise à jour… », puis autre pharmacie : relue pour elle (jamais bloquée sur « mise à jour… »)
    c.rendre({ sendStatus: "success" }); c.rendre({ sendStatus: null });
    const nD = lectures.length - 1;
    changer({ actingFor: { odoo_id: 44, name: "PHARMACIE D" }, pharmacyCip: "7000044" });
    eq("App : autre pharmacie choisie pendant la mise à jour → relue pour elle", lectures[lectures.length - 1].qui, 44);
    await repondre(lectures.length - 1, statut({ [K]: ligneK(3) }));
    await repondre(nD, statut({ [K]: ligneK(9) }));
    eq("App : reste de la nouvelle pharmacie montré, celui de l'ancienne ignoré", [reste(), cx().attente], [3, false]);
  } finally { Date.now = maintenant; globalThis.setTimeout = tempo; }
}
// loadQuota (src/App.jsx) : saisie Elixir → quota-status au nom de la pharmacie servie (odoo_id, jeton admin)
{
  const code = entre("  const loadQuota = useCallback(async () => {", "  useEffect(() => { setQuota(null); }");
  const { fabrique } = await import("data:text/javascript," + encodeURIComponent(`export function fabrique(P) {
  const { pharmacyEmail, pharmacyCip, actingFor, appelAuthentifie, setQuota } = P;
  const useCallback = (f) => f, delai = () => ({});
  const cleQuotaRef = { current: \`\${actingFor?.odoo_id ?? ""}|\${pharmacyEmail}|\${pharmacyCip}\` };
${code}
  return loadQuota;
}`));
  const envois = [];
  const appelAuthentifie = async (url, o) => { envois.push({ url, corps: JSON.parse(o.body) }); return { ok: true, json: async () => statut({}) }; };
  let lu = "rien";
  await fabrique({ pharmacyEmail: "", pharmacyCip: "", actingFor: null, appelAuthentifie, setQuota: (q) => { lu = q; } })();
  eq("loadQuota sans identité : aucun appel", [envois.length, lu], [0, "rien"]);
  await fabrique({ pharmacyEmail: "", pharmacyCip: "7000042", actingFor: { odoo_id: 42 }, appelAuthentifie, setQuota: (q) => { lu = q; } })();
  eq("loadQuota en saisie Elixir : pharmacie servie (odoo_id), même sans compte", envois[0], { url: "/.netlify/functions/quota-status", corps: { cip: "7000042", email: "", odoo_id: 42 } });
  await fabrique({ pharmacyEmail: "compte@pharmacie-a.test", pharmacyCip: "2000001", actingFor: null, appelAuthentifie, setQuota: (q) => { lu = q; } })();
  eq("loadQuota pharmacie : sans odoo_id (identité du jeton)", envois[1].corps, { cip: "2000001", email: "compte@pharmacie-a.test" });
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
