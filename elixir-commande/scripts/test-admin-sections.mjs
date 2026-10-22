// Tests : ajout et retrait de produits d'une section existante (admin, onglet ✏️ Modifier) — node scripts/test-admin-sections.mjs
// Hors ligne : VRAIES fonctions products-upsert.js et products-sections.js sur un faux Supabase en mémoire
// (scripts/peremption-faux.mjs), logique du client (src/components/sections-produits.js) branchée sur elles par un faux
// adminFetch ; aucune donnée réelle lue ni écrite.
//  1. règles pures : sections exclues (menus promo, campagnes, outils), prix et nom Odoo, état d'un CIP, verdicts, corps envoyés ;
//  2. products-sections : réservé à l'admin, lecture seule, produits retirés d'une section, état et stock de CIP ;
//  3. bout à bout : ajout d'un CIP nouveau, déplacement depuis une autre section, remise d'un produit retiré (ici ou
//     ailleurs), retrait d'un produit, retrait groupé, historique (auteur, avant / après, entrées précédentes gardées),
//     seules les lignes concernées écrites, aucune écriture de la configuration (ec_config), plan périmé, jeton refusé ;
//  4. photos Medipim après un ajout (trouvée, introuvable, saturation, plafond) ;
//  5. banc d'essai (scripts/banc/sections-banc.mjs) : mêmes lignes que le vrai products-upsert pour la même suite d'opérations.
process.env.SUPABASE_URL = "https://supabase.faux";
process.env.SUPABASE_KEY = "cle-service";
const { fauxSupabase } = await import("./peremption-faux.mjs");
const S0 = await import("../src/components/sections-produits.js");
const { nomSection, sectionBloquee, prixOdoo, nomProvisoire, etatCip, verdictAjout, operation, verifierPlan, appliquer, photosMedipim, bilanTexte, ACTIONS } = S0;

let ok = 0, ko = 0;
// textes de l'admin : espaces insécables des guillemets français lues comme des espaces
const sp = (x) => (typeof x === "string" ? x.replace(/\u00a0/g, " ") : x);
const eq = (label, got, exp) => { if (JSON.stringify(got, (k, v) => sp(v)) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };
const copie = (x) => JSON.parse(JSON.stringify(x));

// ── données d'exemple (fictives) ──
const SECTIONS = [
  { key: "expert", label: "💊 Sélection Expert" }, { key: "covid", label: "🦠 Diagnostic & Covid" }, { key: "otc", label: "🛒 Centrale OTC / Para" },
  { key: "ulabs", label: "🤝 Commande groupée U-Labs" }, { key: "promo_1790245367017", label: "🏷️ Precommande Masques BIODANCE" },
];
const H = (...e) => JSON.stringify(e);
const A = "6939663976367", B = "3700298194616", C = "3400930000001", U = "3401560000099", R = "3400930000002", R2 = "3400930000003";
const N = "3400930000010", NP = "3400930000011", NZ = "3400930000012", N2 = "3400930000013";
const PRODUITS = () => [
  { cip: A, name: "Autotest COVID-19 Antigénique unitaire", section: "covid", pv: 0.7, pct: 32.9, pn: 0.47, remise_eur: 0.23, colis: 25, carton: null, note: "Stock limité",
    active: true, source: "catalog", image_url: "https://exemple.test/a.png", labo: null,
    history: H({ action: "created", date: "2026-03-09T21:22:45.380Z", author: "migration" }, { action: "update", date: "2026-07-27T11:31:22.395Z", author: "admin", changes: null }),
    created_at: "2026-03-09T21:22:45.380Z", updated_at: "2026-07-27T11:31:22.395Z" },
  { cip: B, name: "Masques FFP2 NR Boîte/20", section: "covid", pv: 7.5, pct: 20, pn: 5.99, remise_eur: 1.51, colis: null, carton: null, note: null, active: true, source: "catalog",
    image_url: null, labo: null, history: "[]", created_at: "2026-03-09T21:22:45.380Z", updated_at: "2026-03-09T21:22:45.380Z" },
  { cip: C, name: "Spray nasal eau de mer 100 ml", section: "otc", pv: 4.2, pct: 10, pn: 3.78, remise_eur: 0.42, colis: 12, carton: 48, note: null, active: true, source: "catalog",
    image_url: "https://exemple.test/c.png", labo: "Laboratoire Exemple", history: H({ action: "created", date: "2026-03-09T21:22:45.380Z", author: "migration" }),
    created_at: "2026-03-09T21:22:45.380Z", updated_at: "2026-03-09T21:22:45.380Z" },
  { cip: U, name: "Dentifrice Parogencyl 75 ml", section: "ulabs", pv: 3, pct: 33, pn: 2.01, remise_eur: 0.99, colis: 6, carton: null, note: null, active: true, source: "catalog",
    image_url: null, labo: null, history: "[]", created_at: "2026-03-09T21:22:45.380Z", updated_at: "2026-03-09T21:22:45.380Z" },
  { cip: R, name: "Thermomètre infrarouge frontal", section: "covid", pv: 14, pct: 18.9, pn: 11.36, remise_eur: 2.64, colis: null, carton: null, note: null, active: false, source: "catalog",
    image_url: "https://exemple.test/r.png", labo: null, history: H({ action: "section_retrait", date: "2026-10-12T08:00:00.000Z", author: "admin", changes: { active: { avant: true, apres: false }, section: "covid" } }),
    created_at: "2026-03-09T21:22:45.380Z", updated_at: "2026-10-12T08:00:00.000Z" },
  { cip: R2, name: "Gel hydroalcoolique 500 ml", section: "otc", pv: 3.1, pct: 0, pn: 3.1, remise_eur: 0, colis: null, carton: null, note: null, active: false, source: "admin",
    image_url: null, labo: null, history: H({ action: "delete", date: "2026-09-01T10:00:00.000Z", author: "admin", changes: null }),
    created_at: "2026-05-02T10:00:00.000Z", updated_at: "2026-09-01T10:00:00.000Z" },
];
const ODOO = () => [
  { cip: A, barcode: A, name: "Autotest COVID-19 Antigénique unitaire", list_price: 0.7, discounted_price: 0.47, discount_pct: 32.9, in_stock: true, available: 1200 },
  { cip: C, barcode: C, name: "Spray nasal eau de mer 100 ml", list_price: 4.2, discounted_price: 3.78, discount_pct: 10, in_stock: true, available: 36 },
  { cip: R, barcode: R, name: "Thermomètre infrarouge frontal", list_price: 14, discounted_price: 11.36, discount_pct: 18.9, in_stock: false, available: 0 },
  { cip: N, barcode: "3400930000010", name: "PARACETAMOL EXEMPLE 500 mg, comprimés effervescents (B/16)", list_price: 1.06, discounted_price: 0.83, discount_pct: 21.7, in_stock: true, available: 40 },
  { cip: N2, barcode: N2, name: "Tensiomètre poignet automatique", list_price: 19.9, discounted_price: null, discount_pct: null, in_stock: true, available: 3 },
  { cip: NP, barcode: NP, name: "Nom à préciser : 3400930000011", list_price: 2, discounted_price: 1.8, discount_pct: 10, in_stock: true, available: 5 },
  { cip: NZ, barcode: NZ, name: "PRODUIT SANS PRIX", list_price: 0, discounted_price: 0, discount_pct: 0, in_stock: false, available: 0 },
];
const CONFIG = () => [
  { key: "admin_promos", value: JSON.stringify([{ id: 1790245367017, name: "Precommande Masques BIODANCE", active: true, products: [{ cip: N, name: "x", pn: 1 }] }]), updated_at: "2026-10-20T10:00:00.000Z" },
  { key: "display_config", value: JSON.stringify({ hiddenTabs: ["ulabs"], labels: { otc: "🔥🔥Centrale OTC / Para" } }), updated_at: "2026-10-20T10:00:00.000Z" },
];

// ── faux Supabase + Supabase Auth ; vraies fonctions ──
let S = fauxSupabase({ tables: { elixir_products: PRODUITS(), odoo_catalog: ODOO(), ec_config: CONFIG() } });
const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://supabase.faux/auth/v1/user")) {
    const a = opts.headers?.Authorization || "";
    if (a === "Bearer jeton-admin") return json({ id: "admin", email: "pharmacien@elixirpharma.fr" });
    if (a === "Bearer jeton-pharmacie") return json({ id: "ph", email: "pharmacie@exemple.test" });
    return json({ message: "invalid JWT" }, 401);
  }
  if (u.startsWith("https://supabase.faux/rest/v1/")) return S.fetch(url, opts);
  throw new Error("appel inattendu : " + u);
};
const { handler: upsert } = await import("../netlify/functions/products-upsert.js");
const { handler: sections, derniereEntree } = await import("../netlify/functions/products-sections.js");

// faux Medipim et photo (étape 4)
let medipim = {};
const appels = [];
let jeton = "jeton-admin";
const adminFetch = async (url, options = {}) => {
  const u = new URL(url, "http://banc.local");
  const fn = u.pathname.replace("/.netlify/functions/", "");
  const methode = options.method || "GET";
  appels.push({ fn, methode, corps: options.body ? JSON.parse(options.body) : null, q: Object.fromEntries(u.searchParams) });
  if (fn === "medipim-lookup") { const r = medipim[u.searchParams.get("cip")] ?? { statut: 404, corps: { error: "Non trouvé" } }; return json(r.corps, r.statut); }
  if (fn === "product-upload-image") return json({ success: true, image_url: `https://stockage.test/${JSON.parse(options.body).cip}.png` });
  const h = { "products-upsert": upsert, "products-sections": sections }[fn];
  if (!h) throw new Error("fonction inattendue : " + fn);
  const r = await h({ httpMethod: methode, headers: { authorization: `Bearer ${jeton}` }, queryStringParameters: Object.fromEntries(u.searchParams), body: options.body ?? null });
  return new Response(r.body, { status: r.statusCode });
};
const ligne = (cip) => S.table("elixir_products").find(r => r.cip === cip);
const hist = (cip) => JSON.parse(ligne(cip)?.history || "[]");
const odoo = (cip) => ODOO().find(o => o.cip === cip);
const lire = async (q) => { const r = await sections({ httpMethod: "GET", headers: { authorization: `Bearer ${jeton}` }, queryStringParameters: q }); return { statut: r.statusCode, corps: JSON.parse(r.body) }; };
const etats = async (cips) => (await lire({ cips: cips.join(",") })).corps.produits;

// ═══ 1. règles pures ═══
eq("nomSection : libellé sans l'icône", [nomSection("covid", SECTIONS), nomSection("otc", SECTIONS), nomSection("inconnue", SECTIONS)], ["Diagnostic & Covid", "Centrale OTC / Para", "inconnue"]);
eq("sectionBloquee : section ordinaire, « toutes »", [sectionBloquee("covid"), sectionBloquee("all"), sectionBloquee("")], [null, null, null]);
eq("sectionBloquee : menu promo, U-Labs, campagne active, outils du site",
  ["promo_1790245367017", "ulabs", "covid", "peremption", "fauteuil", "justificatif", "transfert", "saisie"].map(k => sectionBloquee(k, { campagnes: k === "covid" ? ["covid"] : [], sections: SECTIONS })?.raison),
  ["promo", "campagne", "campagne", "outil", "outil", "outil", "outil", "outil"]);
vrai("sectionBloquee : le texte du menu promo renvoie à l'onglet Promos", /onglet 🎯 Promos/.test(sectionBloquee("promo_1790245367017", { sections: SECTIONS }).texte));
eq("prixOdoo : prix de vente et liste n° 5", prixOdoo({ list_price: 1.06, discounted_price: 0.83, discount_pct: 21.7 }), { pv: 1.06, pn: 0.83, pct: 21.7, remise_eur: 0.23 });
eq("prixOdoo : sans prix remisé → prix de vente, remise 0", prixOdoo({ list_price: "19.9", discounted_price: null }), { pv: 19.9, pn: 19.9, pct: 0, remise_eur: 0 });
eq("prixOdoo : remise calculée si discount_pct absent", prixOdoo({ list_price: 10, discounted_price: 8 }), { pv: 10, pn: 8, pct: 20, remise_eur: 2 });
eq("prixOdoo : sans prix de vente → null", [prixOdoo({ list_price: 0, discounted_price: 0 }), prixOdoo({}), prixOdoo(null)], [null, null, null]);
eq("nomProvisoire", ["Nom à préciser : 34009", "  nom à préciser", "", null, "DOLIPRANE 1000"].map(nomProvisoire), [true, true, true, true, false]);
const produitsEtat = { [A]: { active: true, section: "covid" }, [C]: { active: true, section: "otc" }, [U]: { active: true, section: "ulabs" }, [R2]: { active: false, section: "otc" } };
eq("etatCip : ici, ailleurs, retiré, nouveau", [A, C, R2, N].map(c => etatCip(c, "covid", produitsEtat).type), ["ici", "ailleurs", "retire", "nouveau"]);
const verdict = (cip, sec = "covid", extra = {}) => verdictAjout({ ligne: odoo(cip) || { cip, name: "x", list_price: 1 }, etat: etatCip(cip, sec, produitsEtat), section: sec, sections: SECTIONS, ...extra });
eq("verdict : nouveau → ajouter ; ailleurs → déplacer ; retiré → remettre", [verdict(N).type, verdict(C).type, verdict(R2).type], ["ajouter", "deplacer", "remettre"]);
eq("verdict : déjà ici → rien", [verdict(A).type, verdict(A).raison], [null, "Déjà dans cette section"]);
vrai("verdict : dans U-Labs (campagne) → déplacement refusé, section nommée", verdict(U).type === null && /« Commande groupée U-Labs ».*campagne/.test(sp(verdict(U).raison)), verdict(U).raison);
vrai("verdict : nom provisoire d'Odoo → refusé", verdict(NP).type === null && /Nom à préciser/.test(verdict(NP).raison));
vrai("verdict : sans prix dans Odoo → refusé", verdict(NZ).type === null && /prix/.test(verdict(NZ).raison));
eq("verdict : code inutilisable, état inconnu", [verdictAjout({ ligne: { cip: "a b" }, etat: { type: "nouveau" }, section: "covid" }).type, verdictAjout({ ligne: odoo(N), etat: null, section: "covid" }).type], [null, null]);

// corps envoyés : seules les colonnes qui changent
const opN = operation("ajouter", { cip: N, section: "covid", ligne: odoo(N), etat: { type: "nouveau" } });
eq("operation ajouter : corps products-upsert", opN.corps, { product: { cip: N, name: odoo(N).name, section: "covid", pv: 1.06, pn: 0.83, pct: 21.7, remise_eur: 0.23, source: "admin", active: true,
  _changes: { section: { avant: null, apres: "covid" }, active: { avant: null, apres: true }, origine: "odoo_catalog", prix: { pv: 1.06, pn: 0.83 } } }, action: "section_ajout", author: "admin" });
eq("operation déplacer : section seule", operation("deplacer", { cip: C, section: "covid", etat: { type: "ailleurs", section: "otc" } }).corps,
  { product: { cip: C, section: "covid", _changes: { section: { avant: "otc", apres: "covid" } } }, action: "section_deplacement", author: "admin" });
eq("operation remettre (d'une autre section) : active + section", operation("remettre", { cip: R2, section: "covid", etat: { type: "retire", section: "otc" } }).corps.product,
  { cip: R2, active: true, section: "covid", _changes: { active: { avant: false, apres: true }, section: { avant: "otc", apres: "covid" } } });
eq("operation remettre (même section) : active seule", operation("remettre", { cip: R, section: "covid", produit: { section: "covid" } }).corps.product,
  { cip: R, active: true, _changes: { active: { avant: false, apres: true }, section: "covid" } });
eq("operation retirer : active seule", operation("retirer", { cip: A, section: "covid", produit: { name: "x" } }).corps,
  { product: { cip: A, active: false, _changes: { active: { avant: true, apres: false }, section: "covid" } }, action: "section_retrait", author: "admin" });
eq("actions d'historique", ACTIONS, { ajouter: "section_ajout", deplacer: "section_deplacement", remettre: "section_remise", retirer: "section_retrait" });

// ═══ 2. products-sections (vrai code) ═══
jeton = "";
eq("products-sections : sans jeton → 403", (await lire({ section: "covid" })).statut, 403);
jeton = "jeton-pharmacie";
eq("products-sections : jeton de pharmacie → 403", (await lire({ section: "covid" })).statut, 403);
jeton = "jeton-admin";
eq("products-sections : écriture refusée (POST → 405)", (await sections({ httpMethod: "POST", headers: { authorization: "Bearer jeton-admin" }, body: "{}" })).statusCode, 405);
eq("products-sections : paramètres invalides", [(await lire({ section: "co vid" })).statut, (await lire({ cips: "" })).statut, (await lire({})).statut,
  (await lire({ cips: Array.from({ length: 201 }, (_, i) => String(3400930100000 + i)).join(",") })).statut], [400, 400, 400, 413]);
{
  const r = await lire({ section: "covid" });
  eq("retirés de « covid » : le thermomètre seul (pas ceux d'otc, pas les actifs)", r.corps.retires.map(x => x.cip), [R]);
  eq("retirés : retrait (dernière entrée d'historique), prix et stock Odoo, prix enregistré", [r.corps.retires[0].retrait, r.corps.retires[0].odoo, r.corps.retires[0].pn, r.corps.retires[0].image_url],
    [{ action: "section_retrait", date: "2026-10-12T08:00:00.000Z", author: "admin" }, { name: "Thermomètre infrarouge frontal", list_price: 14, discounted_price: 11.36, discount_pct: 18.9, in_stock: false, available: 0 }, 11.36, "https://exemple.test/r.png"]);
  vrai("retirés : l'historique complet n'est pas renvoyé", !("history" in r.corps.retires[0]));
  const e = await lire({ cips: [A, R2, N, U].join(",") });
  eq("état de CIP : actif ici, retiré ailleurs, absent, campagne", [e.corps.produits[A]?.section, e.corps.produits[A]?.active, e.corps.produits[R2]?.active, e.corps.produits[R2]?.section, e.corps.produits[N], e.corps.produits[U]?.section],
    ["covid", true, false, "otc", undefined, "ulabs"]);
  eq("état de CIP : stock Odoo (quantité libre)", [e.corps.stocks[N]?.available, e.corps.stocks[N]?.in_stock, e.corps.stocks[U]], [40, true, undefined]);
  eq("derniereEntree : texte illisible, vide", [derniereEntree("{"), derniereEntree("[]"), derniereEntree(null)], [null, null, null]);
}
vrai("products-sections : lectures seulement (aucun PATCH / POST / DELETE)", S.etat.requetes.every(q => q.methode === "GET"), JSON.stringify(S.etat.requetes.filter(q => q.methode !== "GET")));

// ═══ 3. bout à bout : logique du client → vrai products-upsert ═══
const avantTout = copie(S.table("elixir_products"));
const configAvant = copie(S.table("ec_config"));
const nbRequetes = S.etat.requetes.length;
const executer = async (ops) => {
  const p = await etats(ops.map(o => o.cip));
  const { valides, perimes } = verifierPlan(ops, p, SECTIONS);
  const r = await appliquer(valides, { adminFetch });
  return { ...r, perimes };
};
const sauf = (cips) => (r) => !cips.includes(r.cip);
const inchangees = (avant, cips) => JSON.stringify(avant.filter(sauf(cips))) === JSON.stringify(S.table("elixir_products").filter(sauf(cips)));

// a. ajout d'un CIP absent du site
{
  const r = await executer([opN]);
  eq("a. ajout : 1 fait, aucun échec", [r.faits.length, r.echecs.length, r.perimes.length], [1, 0, 0]);
  const l = ligne(N);
  eq("a. ajout : nouvelle ligne dans la section, nom et prix d'Odoo, source admin, active",
    [l?.section, l?.name, l?.pv, l?.pn, l?.pct, l?.remise_eur, l?.source, l?.active], ["covid", odoo(N).name, 1.06, 0.83, 21.7, 0.23, "admin", true]);
  vrai("a. ajout : created_at et updated_at posés", !!l?.created_at && !!l?.updated_at);
  eq("a. ajout : historique (action, auteur, avant / après)", hist(N).map(h => [h.action, h.author, h.changes?.section]), [["section_ajout", "admin", { avant: null, apres: "covid" }]]);
  vrai("a. ajout : les autres lignes ne bougent pas", inchangees(avantTout, [N]));
}
// b. déplacement depuis une autre section
{
  const avant = copie(S.table("elixir_products"));
  const e = (await etats([C]))[C];
  eq("b. état avant : dans otc", [e.section, e.active], ["otc", true]);
  const r = await executer([operation("deplacer", { cip: C, section: "covid", etat: etatCip(C, "covid", { [C]: e }) })]);
  eq("b. déplacement : fait", [r.faits.length, r.echecs.length], [1, 0]);
  const l = ligne(C), a = avant.find(x => x.cip === C);
  eq("b. déplacement : section changée, nom, prix, colis, carton, photo, labo, source inchangés",
    [l.section, l.name, l.pv, l.pn, l.colis, l.carton, l.image_url, l.labo, l.source, l.active], ["covid", a.name, a.pv, a.pn, a.colis, a.carton, a.image_url, a.labo, a.source, true]);
  eq("b. déplacement : historique précédent gardé + entrée avant / après", hist(C).map(h => [h.action, h.changes?.section ?? null]),
    [["created", null], ["section_deplacement", { avant: "otc", apres: "covid" }]]);
  vrai("b. un seul CIP, une seule ligne (pas de doublon)", S.table("elixir_products").filter(x => x.cip === C).length === 1);
  vrai("b. les autres lignes ne bougent pas", inchangees(avant, [C]));
}
// c. remise d'un produit retiré d'une AUTRE section
{
  const avant = copie(S.table("elixir_products"));
  const e = (await etats([R2]))[R2];
  const r = await executer([operation("remettre", { cip: R2, section: "covid", etat: etatCip(R2, "covid", { [R2]: e }) })]);
  eq("c. remise (autre section) : fait", r.faits.length, 1);
  eq("c. remise : active, section d'ici, nom et prix gardés", [ligne(R2).active, ligne(R2).section, ligne(R2).name, ligne(R2).pn], [true, "covid", "Gel hydroalcoolique 500 ml", 3.1]);
  eq("c. remise : historique", hist(R2).map(h => [h.action, h.changes?.active ?? null, h.changes?.section ?? null]),
    [["delete", null, null], ["section_remise", { avant: false, apres: true }, { avant: "otc", apres: "covid" }]]);
  vrai("c. les autres lignes ne bougent pas", inchangees(avant, [R2]));
}
// d. remise d'un produit retiré de CETTE section (liste « Produits retirés ») : la section n'est pas envoyée
{
  const n0 = S.etat.requetes.length;
  const r = await executer([operation("remettre", { cip: R, section: "covid", produit: (await lire({ section: "covid" })).corps.retires.find(x => x.cip === R) })]);
  eq("d. remise (même section) : fait", r.faits.length, 1);
  const patch = S.etat.requetes.slice(n0).find(q => q.methode === "PATCH");
  vrai("d. remise : PATCH de cette ligne seulement", patch && patch.url.includes(`cip=eq.${R}`), patch?.url);
  eq("d. remise : active, section inchangée", [ligne(R).active, ligne(R).section], [true, "covid"]);
  eq("d. remise : plus dans la liste des retirés", (await lire({ section: "covid" })).corps.retires.map(x => x.cip), []);
}
// e. retrait d'un produit (une carte)
{
  const avant = copie(S.table("elixir_products"));
  const h0 = hist(A).length;
  const r = await executer([operation("retirer", { cip: A, section: "covid", produit: avant.find(x => x.cip === A) })]);
  eq("e. retrait : fait", r.faits.length, 1);
  const l = ligne(A), a = avant.find(x => x.cip === A);
  eq("e. retrait : active à false, ligne gardée (nom, prix, photo, note, colis)", [l.active, l.name, l.pn, l.image_url, l.note, l.colis, l.section], [false, a.name, a.pn, a.image_url, a.note, a.colis, "covid"]);
  eq("e. retrait : historique gardé + 1 entrée (avant / après)", [hist(A).length, hist(A).at(-1).action, hist(A).at(-1).changes], [h0 + 1, "section_retrait", { active: { avant: true, apres: false }, section: "covid" }]);
  eq("e. retrait : dans la liste des retirés de la section", (await lire({ section: "covid" })).corps.retires.map(x => [x.cip, x.retrait.action]), [[A, "section_retrait"]]);
  vrai("e. les autres lignes ne bougent pas", inchangees(avant, [A]));
}
// f. retrait groupé (sélection)
{
  const avant = copie(S.table("elixir_products"));
  const choisis = avant.filter(x => [B, N].includes(x.cip));
  const n0 = S.etat.requetes.length;
  const r = await executer(choisis.map(p => operation("retirer", { cip: p.cip, section: p.section, produit: p })));
  eq("f. retrait groupé : 2 faits", [r.faits.map(o => o.cip).sort(), r.echecs.length], [[B, N].sort(), 0]);
  eq("f. retrait groupé : les deux retirés", [ligne(B).active, ligne(N).active], [false, false]);
  const ecritures = S.etat.requetes.slice(n0).filter(q => q.methode !== "GET");
  eq("f. retrait groupé : un PATCH par produit, rien d'autre", ecritures.map(q => [q.methode, q.table, new URL(q.url).searchParams.get("cip")]).sort(),
    [["PATCH", "elixir_products", `eq.${B}`], ["PATCH", "elixir_products", `eq.${N}`]].sort());
  vrai("f. les autres lignes ne bougent pas", inchangees(avant, [B, N]));
  eq("f. bilan", bilanTexte({ faits: r.faits, echecs: [], nonTraites: [], perimes: [] }, "covid", SECTIONS), "✅ « Diagnostic & Covid » : 2 retirés");
}
// g. plan périmé (un autre poste a changé les produits entre la recherche et la confirmation) : rien n'est écrit
{
  const n0 = S.etat.requetes.length;
  const r = await executer([
    operation("ajouter", { cip: C, section: "covid", ligne: odoo(C), etat: { type: "nouveau" } }),               // existe désormais
    operation("deplacer", { cip: C, section: "covid", etat: { type: "ailleurs", section: "otc" } }),             // déjà déplacé ici
    operation("remettre", { cip: R2, section: "covid", etat: { type: "retire", section: "otc" } }),              // déjà remis
    operation("retirer", { cip: A, section: "covid", produit: { name: "x" } }),                                  // déjà retiré
  ]);
  eq("g. plan périmé : 4 écartés, 0 écrit", [r.perimes.length, r.faits.length], [4, 0]);
  eq("g. plan périmé : raisons", r.perimes.map(p => p.raison), ["est désormais sur le site (« Diagnostic & Covid »)", "est déjà dans cette section", "a déjà été remis", "est déjà retiré"]);
  vrai("g. plan périmé : aucune écriture", S.etat.requetes.slice(n0).every(q => q.methode === "GET"));
}
// h. jeton admin refusé : arrêt au premier, le reste n'est pas tenté
{
  jeton = "jeton-expire";
  const ops = [operation("remettre", { cip: A, section: "covid", produit: {} }), operation("remettre", { cip: B, section: "covid", produit: {} })];
  const n0 = S.etat.requetes.length;
  const r = await appliquer(ops, { adminFetch });
  eq("h. jeton refusé : 1 échec (session), 1 non tenté", [r.faits.length, r.echecs.map(e => e.erreur), r.nonTraites.map(o => o.cip)], [0, ["session admin expirée : reconnectez-vous"], [B]]);
  vrai("h. jeton refusé : aucune écriture", S.etat.requetes.slice(n0).every(q => q.methode === "GET"));
  jeton = "jeton-admin";
}
// i. aucune écriture de la configuration, seules les lignes concernées
{
  const ecritures = S.etat.requetes.slice(nbRequetes).filter(q => q.methode !== "GET");
  eq("i. écritures : uniquement la table elixir_products", [...new Set(ecritures.map(q => q.table))], ["elixir_products"]);
  eq("i. configuration (menus promo, affichage) intacte", S.table("ec_config"), configAvant);
  vrai("i. aucun appel à config-get depuis la logique des sections", appels.every(a => a.fn !== "config-get"));
  const cibles = new Set([N, C, R2, R, A, B]);
  vrai("i. chaque PATCH vise un CIP concerné", ecritures.filter(q => q.methode === "PATCH").every(q => cibles.has(new URL(q.url).searchParams.get("cip").replace(/^eq\./, ""))));
  eq("i. U-Labs jamais touché", ligne(U), PRODUITS().find(x => x.cip === U));
  eq("i. une seule insertion (le CIP nouveau)", ecritures.filter(q => q.methode === "POST").length, 1);
}

// ═══ 4. photos Medipim ═══
{
  medipim = { [N]: { statut: 200, corps: { image_url: "https://medipim.test/n.png" } }, [N2]: { statut: 404, corps: { error: "Non trouvé" } } };
  const n0 = appels.length;
  const b = await photosMedipim([N, N2], { adminFetch, pause: async () => {} });
  eq("photos : 1 ajoutée, 1 introuvable", [b.trouvees, b.introuvables, b.nonTraitees, b.arret], [1, 1, 0, null]);
  eq("photos : product-upload-image avec l'adresse Medipim", appels.slice(n0).filter(a => a.fn === "product-upload-image").map(a => a.corps), [{ cip: N, image_url: "https://medipim.test/n.png" }]);
  medipim = { [N]: { statut: 429, corps: { error: "saturé" } } };
  const s = await photosMedipim([N, N2, B], { adminFetch, pause: async () => {} });
  eq("photos : saturation → arrêt, le reste à faire plus tard", [s.trouvees, s.nonTraitees, s.arret], [0, 3, "base photos saturée"]);
  const m = await photosMedipim(Array.from({ length: 13 }, (_, i) => String(3400930200000 + i)), { adminFetch, pause: async () => {}, max: 10 });
  eq("photos : 10 au plus", [m.introuvables, m.nonTraitees], [10, 3]);
}

// ═══ 5. banc d'essai : même résultat que le vrai products-upsert ═══
{
  const { repondreSections } = await import("./banc/sections-banc.mjs");
  const ops = [
    operation("ajouter", { cip: N, section: "covid", ligne: odoo(N), etat: { type: "nouveau" } }),
    operation("deplacer", { cip: C, section: "covid", etat: { type: "ailleurs", section: "otc" } }),
    operation("remettre", { cip: R2, section: "covid", etat: { type: "retire", section: "otc" } }),
    operation("retirer", { cip: A, section: "covid", produit: {} }),
  ];
  S = fauxSupabase({ tables: { elixir_products: PRODUITS(), odoo_catalog: ODOO(), ec_config: CONFIG() } });
  for (const op of ops) await upsert({ httpMethod: "POST", headers: { authorization: "Bearer jeton-admin" }, body: JSON.stringify(op.corps) });
  const vraies = copie(S.table("elixir_products"));
  const entetes = { authorization: "Bearer essai-jeton-admin" };
  for (const op of ops) await repondreSections({ methode: "POST", fn: "products-upsert", corps: op.corps, entetes, produits: PRODUITS, catalogue: ODOO });
  const banc = (await repondreSections({ methode: "GET", fn: "products-get", entetes, produits: PRODUITS, catalogue: ODOO })).corps.products;
  // colonnes absentes d'une ligne insérée = null en base (le faux Supabase n'a pas de valeurs par défaut) ; clés triées
  const sansDates = (l) => { const { updated_at, created_at, _price_source, history, ...x } = l; void updated_at; void created_at; void _price_source;
    const y = { image_url: null, labo: null, colis: null, carton: null, note: null, ...x, history: JSON.parse(history || "[]").map(({ date, ...h }) => (void date, h)) };
    return Object.fromEntries(Object.entries(y).sort(([k1], [k2]) => k1.localeCompare(k2))); };
  const actives = vraies.filter(l => l.active !== false).sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  eq("banc : products-get = lignes actives du vrai products-upsert (hors dates)", banc.map(sansDates), actives.map(sansDates));
  const r = await repondreSections({ methode: "GET", fn: "products-sections", query: { section: "covid" }, entetes, produits: PRODUITS, catalogue: ODOO });
  eq("banc : products-sections (vrai code) voit le retrait", [r.statut, r.corps.retires.map(x => x.cip).sort()], [200, [A, R].sort()]);
  eq("banc : sans jeton → 403", (await repondreSections({ methode: "GET", fn: "products-sections", query: { section: "covid" }, entetes: {}, produits: PRODUITS, catalogue: ODOO })).statut, 403);
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
