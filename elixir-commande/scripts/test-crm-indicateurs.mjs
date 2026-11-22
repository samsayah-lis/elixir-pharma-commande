// Exemple (depuis elixir-commande) : CRM_REFERENCE_PLAN10M="/chemin/vers/plan-10m-outil" node scripts/test-crm-indicateurs.mjs
// Parité entièrement hors ligne. Seuls ces deux scripts externes sont exécutés ;
// --cibles explicite interdit le repli vers les réglages réels du dossier de référence.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { creerHandlerIndicateurs, lireDonneesOdoo, lancerIndicateurs } from "../netlify/functions/crm-indicateurs-background.js";
import { creerHandlerCron } from "../netlify/functions/crm-indicateurs-cron.js";
import { creerStockCrm } from "../netlify/functions/_crm-stock.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculerIndicateurs, arrondir, decalerJour } from "../netlify/functions/_crm-indicateurs.js";
const reference = process.env.CRM_REFERENCE_PLAN10M;
const disponible = reference && statSync(reference, { throwIfNoEntry: false })?.isDirectory();
if (!disponible) console.log(`parité non vérifiée : CRM_REFERENCE_PLAN10M ${reference ? "dossier introuvable" : "absent"}`);
const temporaire = mkdtempSync(join(tmpdir(), "crm-indicateurs-test-"));
const cibles = { fond_de_rayon: 4321, specialites_cheres: 2345, glp1: 1234, seuil_demande_isolee: 9876, origine: "Cibles fictives de test" };
writeFileSync(join(temporaire, "cibles.json"), JSON.stringify(cibles));
let ok = 0, ko = 0;
async function test(nom, fn) { try { await fn(); ok++; } catch (e) { ko++; console.error("✗", nom, e.message); } }
const fichiers = ["lignes", "partners", "produits", "taxes", "sol", "so", "mois", "meta"];
const lire = dossier => Object.fromEntries(fichiers.map(n => [n, JSON.parse(readFileSync(join(dossier, `${n}.json`), "utf8"))]));
function python(dossier, date) {
  const sortie = join(dossier, "reference.json");
  execFileSync("python3", ["-I", join(reference, "prep_listes.py"), "--donnees", dossier, "--date", date,
    "--sortie", sortie, "--cibles", join(temporaire, "cibles.json")], { encoding: "utf8" });
  return JSON.parse(readFileSync(sortie, "utf8"));
}
function comparer(obtenu, attendu, chemin) {
  if (Array.isArray(attendu)) {
    assert.equal(obtenu.length, attendu.length, `${chemin}.length`);
    attendu.forEach((x, i) => comparer(obtenu[i], x, `${chemin}[${i}]`));
  } else if (attendu && typeof attendu === "object") {
    for (const [k, v] of Object.entries(attendu)) comparer(obtenu[k], v, `${chemin}.${k}`);
  } else assert.equal(obtenu, attendu, chemin);
}
const trier = (a, key) => [...a].sort((x, y) => typeof x[key] === "number" ? x[key] - y[key] : x[key] < y[key] ? -1 : x[key] > y[key] ? 1 : 0);
function parite(donnees, attendu, date) {
  const r = calculerIndicateurs(donnees, { date, cibles });
  for (const [table, key] of [["pharmacies", "id"], ["produits", "code"], ["laboratoires", "nom"]]) comparer(trier(r[table], key), trier(attendu[table], key), table);
  for (const k of ["controle", "indicateurs", "params", "periode", "precedente"]) comparer(r[k], attendu[k], k);
  return r;
}
// Jeu inventé de repli : les tests locaux restent exécutables sans les scripts Python.
function donneesLocales() {
  const d = { lignes: [], partners: [], produits: [], taxes: [], sol: [], so: [], mois: [], meta: {} };
  for (let id = 1; id <= 32; id++) {
    const nom = `pharmacie-fictive-${id}`;
    d.partners.push({ id, name: nom, cip: String(2000000 + id), zip: id === 30 ? "33000" : "75000", city: "Ville fictive", commercial_partner_id: [id, nom] });
    d.produits.push({ id, default_code: `FICT${String(id).padStart(4, "0")}`, list_price: id, taxes_id: [] });
    d.lignes.push([id === 2 ? "2026-10-01" : "2026-11-22", id, 1, "produit fictif", 1, 10, 1, "out_invoice", id]);
    d.mois.push([id, "mois fictif", 10, 1, "2026-10-01"]);
    d.so.push([id, "2026-11-22 12:00:00", id, "FICTIF", `FICTIF-${id}`]);
    // Deux lignes le même jour : manque maximal de trois, service cumulé de quatre.
    d.sol.push([id, 1, "produit fictif", 2, 5, 2, 1, 0, 2, id], [id, 1, "produit fictif", 2, 5, 2, 1, 0, 2, id]);
  }
  for (let id = 2; id <= 32; id++) d.sol.push([7, id, "produit fictif", 1, 5, 1, id, 0, id, 7]);
  return d;
}
let donnees = donneesLocales(), calcul = calculerIndicateurs(donnees, { date: "2026-11-22", cibles });
try {
  if (disponible) for (const date of ["2026-11-22", "2027-01-15"]) await test(`parité exacte champ par champ ${date}`, () => {
    const dossier = join(temporaire, date);
    execFileSync("python3", ["-I", join(reference, "tests/fabrique_donnees.py"), dossier, "--date", date]);
    const d = lire(dossier), r = parite(d, python(dossier, date), date);
    if (date === "2026-11-22") { donnees = d; calcul = r; }
    assert.equal(r.pharmacies[0].ca_mois.length, 13);
    if (date.startsWith("2027")) assert.equal(r.pharmacies[0].ca_mois[0].mois, "2026-01");
  });
  await test("avoir : marge et CA net ; coût nul exclu du dénominateur", () => {
    const d = structuredClone(donnees);
    d.lignes = [["2026-11-22", 1, 1, "produit fictif", 4, 40, 5, "out_invoice", 1], ["2026-11-22", 1, 1, "produit fictif", 1, 10, 5, "out_refund", 2], ["2026-11-22", 1, 1, "produit fictif", 2, 20, 0, "out_invoice", 3]];
    const r = calculerIndicateurs(d, { date: "2026-11-22", cibles }).pharmacies[0];
    assert.equal(r.ca, 50); assert.equal(r.marge, 15); assert.equal(r.ca_avec_cout, 30); assert.equal(r.marge_taux, 0.5);
  });
  await test("demandes répétées : un manque, service additionné", () => {
    const p = calcul.produits.find(p => p.code === "FICT0001");
    assert.equal(p.demandes, 32); assert.equal(p.q_ns, 32 * 3); assert.equal(p.q_srv, 32 * 4); assert.equal(p.coeur, true);
  });
  await test("hors territoire conservé dans les totaux", () => {
    const p = calcul.pharmacies.find(p => p.id === 30); assert.equal(p.territoire, "Non"); assert.ok(p.action.startsWith("7"));
    const r = calculerIndicateurs(donnees, { date: "2026-11-22", cibles, territoire: ["33"] });
    assert.equal(r.pharmacies.find(p => p.id === 30).territoire, "Oui"); assert.equal(r.controle.ca, calcul.controle.ca);
  });
  await test("arrondi Python binaire et au pair", () => { assert.equal(arrondir(2.675, 2), 2.67); assert.equal(arrondir(2.5), 2); assert.equal(arrondir(3.5), 4); assert.equal(arrondir(-2.5), -2); });
  if (disponible) await test("parité des cas limites : plafond, médiane, génériques et regroupements", () => {
    const d = structuredClone(donnees), dossier = join(temporaire, "2026-11-22");
    d.sol.push([1, 1, "DCI FICTIVE TEVA", 0, 999, 0, 2.675, 0, 0, d.so[0][0]]);
    d.produits[0].manufacturer_id = [1, "BAYER HEALTHCARE SAS"];
    d.produits[1].manufacturer_id = [2, "BAYER SANTE"];
    d.sol.find(l => l[1] === 2)[2] = "[FICT0002] SPECIALITE FICTIVE TEVA (nom fictif)";
    d.sol.find(l => l[1] === 3)[6] = 0;
    for (const n of fichiers) writeFileSync(join(dossier, `${n}.json`), JSON.stringify(d[n]));
    const r = parite(d, python(dossier, "2026-11-22"), "2026-11-22");
    assert.equal(r.pharmacies.find(p => p.id === 1).non_servis.find(p => p.produit_id === 1).quantite, 200);
    assert.ok(r.laboratoires.some(p => p.nom === "BAYER"));
  });
  if (disponible) await test("parité : fiches commerciales, arrondis de prix, maximum entre jours", () => {
    const d = structuredClone(donnees), dossier = join(temporaire, "2026-11-22");
    d.partners.push({ ...d.partners[0], id: 101, cip: "2000101", commercial_partner_id: [1, "pharmacie-fictive-01"] });
    d.lignes.push(["2026-11-22", 101, 1, "produit fictif", 3, 8.025, 0.5, "out_invoice", 999]);
    d.mois.push([101, "mois fictif", 8.025, 1, "2026-11-01"]);
    d.so.push([999, "2026-11-21 12:00:00", 101, "FICTIF", "FICTIF-999"]);
    d.sol.push([101, 1, "DCI FICTIVE TEVA", 0, 7, 0, 2.675, 0, 0, 999]);
    for (const l of d.sol) if (l[1] === 108) l[6] = 2.675;
    for (const n of fichiers) writeFileSync(join(dossier, `${n}.json`), JSON.stringify(d[n]));
    const r = parite(d, python(dossier, "2026-11-22"), "2026-11-22");
    assert.equal(r.pharmacies.length, calcul.pharmacies.length);
    assert.equal(r.pharmacies.find(p => p.id === 1).non_servis.find(p => p.produit_id === 1).quantite, 7);
    assert.equal(r.produits.find(p => p.code === "FICT0108").prix, 2.67);
  });
  await test("non-servis limités à 30 et triés par valeur", () => {
    const d = structuredClone(donnees);
    for (const l of d.sol) { l[3] = 0; l[4] = 5; }
    const ns = calculerIndicateurs(d, { date: "2026-11-22", cibles }).pharmacies.find(p => p.id === 7).non_servis;
    assert.equal(ns.length, 30); assert.ok(ns.every((x, i) => !i || x.valeur <= ns[i - 1].valeur));
  });
  await test("calcul pur : entrées inchangées", () => { const avant = JSON.stringify(donnees); calculerIndicateurs(donnees, { date: "2026-11-22", cibles }); assert.equal(JSON.stringify(donnees), avant); });
} finally { rmSync(temporaire, { recursive: true, force: true }); }


// Faux Odoo au format natif (many2one) : le lecteur du serveur réalise vraiment
// search/read/read_group/search_read, puis reconstruit les tableaux de référence.
globalThis.fetch = () => { throw new Error("Réseau interdit dans les tests"); };
function fauxOdoo(d) {
  const m2o = (id, nom = "fiche fictive") => id ? [id, nom] : false;
  const modeles = {
    "account.move.line": d.lignes.map((l, i) => ({ id: i + 1, date: l[0], partner_id: m2o(l[1]), product_id: m2o(l[2], l[3]), quantity: l[4], price_subtotal: l[5], purchase_price: l[6], move_type: l[7], move_id: m2o(l[8]) })),
    "sale.order.line": d.sol.map((l, i) => ({ id: i + 1, order_partner_id: m2o(l[0]), product_id: m2o(l[1], l[2]), product_uom_qty: l[3], pharmaml_ordered_qty: l[4], qty_delivered: l[5], price_unit: l[6], discount: l[7], price_subtotal: l[8], order_id: m2o(l[9]) })),
    "sale.order": d.so.map(o => ({ id: o[0], date_order: o[1], partner_id: m2o(o[2]), origin: o[3], client_order_ref: o[4] })),
    "account.move": d.mois.map(g => ({ partner_id: m2o(g[0]), "invoice_date:month": g[1], amount_untaxed_signed: g[2], __count: g[3], __range: { "invoice_date:month": { from: g[4] } } })),
    "res.partner": d.partners, "product.product": d.produits, "account.tax": d.taxes,
  };
  const appels = [], etat = { panne: false };
  async function ex(modele, methode, args, kwargs, opts) {
    appels.push({ modele, methode, args, kwargs, opts });
    assert.ok(["search", "read", "read_group", "search_read"].includes(methode));
    assert.deepEqual(kwargs.context.allowed_company_ids, [2]);
    if (etat.panne) throw new Error("Erreur métier fictive à ne pas publier");
    const rows = modeles[modele]; assert.ok(rows, modele);
    if (methode === "search") return rows.map(r => r.id);
    if (methode === "read") return structuredClone(rows.filter(r => args[0].includes(r.id)));
    return structuredClone(rows);
  }
  return { ex, appels, etat };
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
function fauxStock() {
  let now = new Date("2026-11-23T03:30:00Z");
  const tables = { crm_comptes: [], crm_indicateurs: [], crm_synchros: [], crm_journal: [], crm_reglages: [{ id: randomUUID(), cibles_indicateurs: cibles }] };
  const etat = { pannePublication: false, conflitCompte: false, changementHorsCible: false, refuserFin: false };
  const appels = [];
  const correspond = (r, p) => [...p].every(([k, v]) => {
    if (["select", "order", "limit", "offset"].includes(k)) return true;
    assert.ok(v.startsWith("eq.")); return String(r[k]) === v.slice(3);
  });
  async function fetch(url, opts = {}) {
    assert.equal(opts.headers.apikey, "cle-serveur-fictive"); assert.equal(opts.headers.Authorization, "Bearer cle-serveur-fictive");
    const u = new URL(url), t = u.pathname.replace("/rest/v1/", ""), method = opts.method || "GET", b = opts.body ? JSON.parse(opts.body) : undefined;
    appels.push({ t, method, b });
    if (t === "rpc/crm_commencer_synchro") {
      if (tables.crm_synchros.some(r => r.statut === "en_cours" && now - new Date(r.debut) < 20 * 60e3)) return response([]);
      for (const r of tables.crm_synchros) if (r.statut === "en_cours") Object.assign(r, { statut: "abandonne", fin: now.toISOString() });
      const r = { id: randomUUID(), debut: now.toISOString(), periode_fin: b.p_date, statut: "en_cours" }; tables.crm_synchros.push(r); return response([r]);
    }
    if (t === "rpc/crm_publier_indicateurs") {
      if (etat.pannePublication) return response({}, 503);
      const passage = tables.crm_synchros.find(r => r.id === b.p_id && r.statut === "en_cours");
      if (!passage || now - new Date(passage.debut) >= 20 * 60e3) return response({ code: "40001" }, 409);
      for (const row of b.p_instantanes) {
        const existant = tables.crm_indicateurs.find(r => r.odoo_id === row.odoo_id && r.periode_fin === passage.periode_fin);
        if (existant) Object.assign(existant, row, { calcule_le: now.toISOString() });
        else tables.crm_indicateurs.push({ ...row, periode_fin: passage.periode_fin, calcule_le: now.toISOString() });
      }
      tables.crm_indicateurs = tables.crm_indicateurs.filter(r => tables.crm_indicateurs.filter(x => x.odoo_id === r.odoo_id).sort((a, b) => b.periode_fin.localeCompare(a.periode_fin)).indexOf(r) < 26);
      Object.assign(passage, { statut: "termine", fin: now.toISOString(), compteurs: b.p_compteurs }); return response([passage]);
    }
    assert.ok(tables[t], t);
    if (method === "GET") {
      let rows = tables[t].filter(r => correspond(r, u.searchParams));
      const ordre = u.searchParams.get("order")?.split(",")[0];
      if (ordre) { const [col, sens] = ordre.split("."); rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (sens === "desc" ? -1 : 1)); }
      return response(rows.slice(Number(u.searchParams.get("offset") || 0), Number(u.searchParams.get("offset") || 0) + Number(u.searchParams.get("limit") || 1000)));
    }
    if (method === "POST") {
      if (t === "crm_comptes" && tables[t].some(r => r.odoo_id === b.odoo_id)) return response({ code: "23505" }, 409);
      const r = { id: randomUUID(), archive: false, etiquettes: [], ...b }; tables[t].push(r);
      tables.crm_journal.push({ avant: null, apres: structuredClone(r) }); return response([r], 201);
    }
    assert.equal(method, "PATCH");
    if (t === "crm_synchros" && etat.refuserFin) return response({}, 503);
    if (t === "crm_comptes" && (etat.conflitCompte || etat.changementHorsCible)) {
      const r = tables[t].find(r => String(r.id) === u.searchParams.get("id")?.slice(3));
      if (r) { r.version++; r.notes = "note concurrente fictive"; if (etat.changementHorsCible) r.statut = "hors_cible"; }
      etat.conflitCompte = false; etat.changementHorsCible = false;
    }
    const rows = tables[t].filter(r => correspond(r, u.searchParams));
    for (const r of rows) { const avant = structuredClone(r); Object.assign(r, b); if (t === "crm_comptes") tables.crm_journal.push({ avant, apres: structuredClone(r) }); }
    return response(rows);
  }
  const deps = { fetch, url: "https://supabase.exemple.test", cle: "cle-serveur-fictive", maintenant: () => new Date(now) };
  return { tables, etat, appels, deps, stock: creerStockCrm(deps), avancer: ms => { now = new Date(now.getTime() + ms); } };
}
const secretAvant = process.env.CRON_SECRET;
process.env.CRON_SECRET = "secret-cron-fictif";
const event = { httpMethod: "POST", headers: { "x-cron-secret": "secret-cron-fictif" }, body: "{}" };
try {
  await test("lecteur Odoo : domaines, société, tableaux identiques", async () => {
    const od = fauxOdoo(donnees);
    const d = await lireDonneesOdoo({ date: "2026-11-22", ex: od.ex });
    for (const k of fichiers.filter(k => k !== "meta")) assert.deepEqual(d[k], donnees[k], k);
    const fact = od.appels.find(a => ["account.move.line", "sale.order.line"].includes(a.modele) && a.methode === "search");
    assert.ok(fact.args[0].some(c => JSON.stringify(c) === '["company_id","=",2]'));
    assert.ok(fact.args[0].some(c => JSON.stringify(c) === '["date",">=","2026-09-24"]'));
    const sol = od.appels.find(a => a.modele === "sale.order.line" && a.methode === "search");
    assert.ok(sol.args[0].some(c => JSON.stringify(c) === '["order_id.date_order","<","2026-11-23 00:00:00"]'));
    assert.ok(od.appels.every(a => a.opts.timeoutMs === 20000));
  });
  await test("lecteur pagine les produits et les partenaires", async () => {
    const d = structuredClone(donnees);
    for (let i = 200; i < 3500; i++) {
      d.produits.push({ ...d.produits[0], id: i });
      d.partners.push({ ...d.partners[0], id: i, commercial_partner_id: [i, "pharmacie fictive"] });
      d.lignes.push(["2026-11-22", i, i, "produit fictif", 1, 1, 0, "out_invoice", i]);
    }
    const od = fauxOdoo(d), r = await lireDonneesOdoo({ date: "2026-11-22", ex: od.ex });
    assert.equal(r.produits.length, d.produits.length); assert.equal(r.partners.length, d.partners.length);
    for (const a of od.appels.filter(a => a.methode === "read")) assert.ok(a.args[0].length <= ({ "res.partner": 800, "product.product": 1500, "sale.order": 5000 })[a.modele] || a.args[0].length <= 8000 && ["account.move.line", "sale.order.line"].includes(a.modele));
  });
  await test("secret obligatoire, avant tout accès aux services", async () => {
    const db = fauxStock(), od = fauxOdoo(donnees), h = creerHandlerIndicateurs({ ...db.deps, odoo: od.ex });
    for (const headers of [{}, { "x-cron-secret": "incorrect" }]) assert.equal((await h({ ...event, headers })).statusCode, 403);
    assert.equal(db.appels.length, 0); assert.equal(od.appels.length, 0);
    assert.equal((await h({ ...event, httpMethod: "GET" })).statusCode, 405);
  });
  await test("synchro : champs CRM conservés, anciens clients, hors_cible et 26 instantanés", async () => {
    const d = structuredClone(donnees);
    d.partners.push({ ...d.partners[0], id: 99, cip: "2000099", name: "pharmacie-fictive-99", commercial_partner_id: [99, "pharmacie-fictive-99"] });
    d.mois.push([99, "mois fictif", 100, 1, "2025-02-01"]);
    d.partners[0].street = "rue fictive"; d.partners[0].phone = "+33100000000";
    const db = fauxStock(), od = fauxOdoo(d);
    const crm = { commercial_email: "commercial@exemple.test", notes: "note fictive", etiquettes: ["fictif"], groupement: "groupe fictif", logiciel: "logiciel fictif", archive: true, email: "contact@exemple.test" };
    db.tables.crm_comptes.push({ id: randomUUID(), odoo_id: 1, nom: "ancien nom fictif", statut: "client", source: "saisie", version: 4, ...crm });
    const exclu = { id: randomUUID(), odoo_id: 3, nom: "hors cible fictif", statut: "hors_cible", version: 1, ...crm };
    db.tables.crm_comptes.push(structuredClone(exclu));
    for (const odoo_id of [0, 1]) for (let i = 0; i < 30; i++) db.tables.crm_indicateurs.push({ odoo_id, periode_fin: decalerJour("2026-11-21", -i), donnees: {} });
    const h = creerHandlerIndicateurs({ ...db.deps, odoo: od.ex });
    const res = await h(event); assert.equal(res.statusCode, 200, res.body);
    const c = db.tables.crm_comptes.find(c => c.odoo_id === 1);
    assert.equal(c.nom, d.partners[0].name); assert.equal(c.adresse, "rue fictive"); assert.equal(c.telephone, "+33100000000"); assert.equal(c.source, "saisie");
    for (const [k, v] of Object.entries(crm)) assert.deepEqual(c[k], v, k);
    assert.equal(db.tables.crm_comptes.find(c => c.odoo_id === 2).statut, "ancien_client");
    assert.equal(db.tables.crm_comptes.find(c => c.odoo_id === 99).statut, "ancien_client");
    assert.deepEqual(db.tables.crm_comptes.find(c => c.odoo_id === 3), exclu);
    assert.equal(db.tables.crm_comptes.find(c => c.odoo_id === 4).source, "odoo");
    for (const id of [0, 1]) assert.equal(db.tables.crm_indicateurs.filter(i => i.odoo_id === id).length, 26);
    assert.equal(db.tables.crm_indicateurs.filter(i => i.odoo_id === 3).length, 0);
    assert.equal(db.tables.crm_synchros[0].statut, "termine"); assert.ok(db.tables.crm_journal.length > 0);
    const n = db.tables.crm_indicateurs.length;
    assert.equal((await h(event)).statusCode, 200); assert.equal(db.tables.crm_indicateurs.length, n);
    assert.equal(db.tables.crm_synchros[1].compteurs.modifies, 0);
  });
  await test("verrou : une seule prise concurrente ; reprise après vingt minutes", async () => {
    const db = fauxStock();
    const rs = await Promise.all([db.stock.commencerSynchro("2026-11-22"), db.stock.commencerSynchro("2026-11-22")]);
    assert.equal(rs.filter(Boolean).length, 1);
    const od = fauxOdoo(donnees), h = creerHandlerIndicateurs({ ...db.deps, odoo: od.ex });
    assert.equal(JSON.parse((await h(event)).body).en_cours, true); assert.equal(od.appels.length, 0);
    db.avancer(20 * 60e3);
    const nouveau = await db.stock.commencerSynchro("2026-11-22"); assert.ok(nouveau); assert.equal(db.tables.crm_synchros[0].statut, "abandonne");
    await assert.rejects(db.stock.publierIndicateurs(rs.find(Boolean).id, [{ odoo_id: 0, donnees: {} }], {}), e => e.status === 409);
  });
  await test("conflit compte : relecture sans écraser une note concurrente", async () => {
    const db = fauxStock(); db.tables.crm_comptes.push({ id: randomUUID(), odoo_id: 1, nom: "fictif", statut: "client", version: 1 });
    db.etat.conflitCompte = true;
    assert.equal(await db.stock.synchroniserCompte({ odoo_id: 1, nom: "nom fictif actualisé", statut: "client", notes: "ne doit pas écraser" }), "modifies");
    assert.equal(db.tables.crm_comptes[0].notes, "note concurrente fictive");
    db.etat.changementHorsCible = true;
    assert.equal(await db.stock.synchroniserCompte({ odoo_id: 1, nom: "autre nom fictif", statut: "client" }), "ignores");
    assert.equal(db.tables.crm_comptes[0].statut, "hors_cible");
  });
  await test("panne Odoo ou publication : passage en erreur, aucun instantané partiel", async () => {
    for (const type of ["odoo", "publication", "cibles"]) {
      const db = fauxStock(), od = fauxOdoo(donnees);
      if (type === "odoo") od.etat.panne = true;
      if (type === "publication") db.etat.pannePublication = true;
      if (type === "cibles") db.tables.crm_reglages = [];
      const res = await creerHandlerIndicateurs({ ...db.deps, odoo: od.ex })(event);
      assert.equal(res.statusCode, 503); assert.equal(db.tables.crm_synchros[0].statut, "erreur");
      assert.equal(db.tables.crm_indicateurs.length, 0); assert.ok(!res.body.includes("Erreur métier"));
      assert.ok(!db.tables.crm_synchros[0].erreur.includes("Erreur métier"));
    }
  });
  await test("budget dépassé : arrêt avant la limite du background", async () => {
    const db = fauxStock(), od = fauxOdoo(donnees); let t = 0;
    const res = await creerHandlerIndicateurs({ ...db.deps, odoo: od.ex, horloge: () => t += 100, budgetMs: 50 })(event);
    assert.equal(res.statusCode, 503); assert.equal(od.appels.length, 0); assert.equal(db.tables.crm_synchros[0].statut, "erreur");
  });
  await test("déclenchement : secret et URL serveur obligatoires", async () => {
    await assert.rejects(lancerIndicateurs({ cronSecret: "", siteUrl: "https://site.exemple.test" }), e => e.status === 503);
    await assert.rejects(lancerIndicateurs({ cronSecret: "fictif", siteUrl: "" }), e => e.status === 503);
    let appels = 0;
    const fetch = async (url, opts) => { appels++; assert.equal(url, "https://site.exemple.test/.netlify/functions/crm-indicateurs-background"); assert.equal(opts.headers["x-cron-secret"], "secret-cron-fictif"); return response({}, 202); };
    await lancerIndicateurs({ fetch, siteUrl: "https://site.exemple.test" }); assert.equal(appels, 1);
  });
  await test("cron : 04:30 Paris exactement, hiver et été", async () => {
    for (const [iso, attendu] of [["2026-11-23T03:30:00Z", 1], ["2026-11-23T02:30:00Z", 0], ["2026-07-23T02:30:00Z", 1], ["2026-07-23T03:30:00Z", 0]]) {
      let n = 0;
      const h = creerHandlerCron({ maintenant: () => new Date(iso), siteUrl: "https://site.exemple.test", fetch: async () => { n++; return response({}, 202); } });
      assert.equal((await h()).statusCode, 200); assert.equal(n, attendu);
      // Un événement de planification peut avoir la forme Lambda POST : ne pas
      // exiger de secret entrant que le planificateur Netlify ne fournit pas.
      assert.equal((await h({ httpMethod: "POST", body: '{"next_run":"2026-11-24T03:30:00Z"}' })).statusCode, 200);
      assert.equal(n, attendu * 2);
    }
  });
} finally {
  if (secretAvant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secretAvant;
}
console.log(`CRM indicateurs et synchronisation : ${ok} ok, ${ko} ko`);
process.exitCode = ko ? 1 : 0;
