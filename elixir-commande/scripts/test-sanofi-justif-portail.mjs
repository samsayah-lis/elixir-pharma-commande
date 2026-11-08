// Banc intégral hors ligne : vrai relais, faux HTTP Supabase/Odoo/portail, horloge maîtrisée.
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "sb-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.ODOO_DB = "test";
process.env.ODOO_LOGIN = "test";
process.env.ODOO_PASSWORD = "test";
process.env.PML_PORTAIL_URL = "https://portail.test";
const secrets = ["SENTINEL_U+secret", "SENTINEL_P&secret", "SENTINEL_READ_secret"];
[process.env.PML_INJECTION_U, process.env.PML_INJECTION_P, process.env.PML_CLE_LECTURE] = secrets;
const NativeDate = Date;
let clock = NativeDate.parse("2026-11-08T10:00:00Z");
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
const avance = ms => { clock += ms; };
let info = [], infoCalls = 0, infoPanne = false;
process.env.PHARMAML_URL = "https://infosoft.test";
process.env.PHARMAML_PASS = "fictif";
let tables, mails, calls, mode, officine, panneLecture, commandes, hook, pages;
const sorties = [], logs = [], ecritures = [], tousMails = [];
for (const method of ["log", "warn", "error"]) { const original = console[method]; console[method] = (...args) => { logs.push(args.map(String).join(" ")); original(...args); }; }
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
function reset() {
  info = []; infoCalls = 0; infoPanne = false; process.env.PML_SOURCES = "portail";
  tables = { kv_store: [], elixir_orders: [], elixir_pharmacies: [{ email: "pharmacie@test.fr", cip: "1234567" }] };
  mails = []; calls = []; mode = "ok"; officine = { id_officine: "1234567", statut: "active", ref_erp: "42" }; panneLecture = false; commandes = []; hook = null; pages = null;
  avance(1000);
}
reset();
globalThis.fetch = async (input, options = {}) => {
  const u = new URL(input), method = options.method || "GET";
  if (u.origin === "https://infosoft.test") {
    infoCalls++;
    if (infoPanne) throw new Error("InfoSoft indisponible");
    if (u.pathname === "/connexion") return new Response("", { status: 302, headers: { "set-cookie": "session=fictive" } });
    if (u.pathname.startsWith("/liste/")) return json({ data: info, recordsFiltered: info.length });
    assert.fail("route InfoSoft non simulée");
  }
  if (u.origin === "https://supabase.test") {
    if (u.pathname === "/auth/v1/user") return json({ id: "admin", email: "admin@test.fr", app_metadata: { role: "admin" } });
    const table = u.pathname.replace("/rest/v1/", ""), rows = tables[table];
    assert.ok(rows, `table inattendue ${table}`);
    const filters = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "offset", "on_conflict"].includes(k));
    const match = row => filters.every(([k, v]) => v.startsWith("eq.") ? String(row[k]) === v.slice(3) : v.startsWith("like.") ? String(row[k]).startsWith(v.slice(5, -1)) : assert.fail(`filtre ${k}`));
    let selected = rows.filter(match);
    const prefer = options.headers?.Prefer || "";
    if (method === "POST") {
      const body = JSON.parse(options.body); ecritures.push(body); const old = rows.find(r => r.key === body.key);
      if (old && !prefer.includes("merge-duplicates")) return json({ message: "duplicate key" }, 409);
      if (old) Object.assign(old, body); else rows.push(body);
      return prefer.includes("return=representation") ? json([body]) : new Response(null, { status: 201 });
    }
    if (method === "PATCH") { const body = JSON.parse(options.body); ecritures.push(body); selected.forEach(r => Object.assign(r, body)); }
    if (method === "DELETE") tables[table] = rows.filter(r => !match(r));
    if (method === "GET") {
      if (u.searchParams.get("order") === "updated_at.desc") selected.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      if (u.searchParams.get("order") === "key.asc") selected.sort((a, b) => a.key.localeCompare(b.key));
      if (u.searchParams.has("offset")) selected = selected.slice(Number(u.searchParams.get("offset")));
      if (u.searchParams.has("limit")) selected = selected.slice(0, Number(u.searchParams.get("limit")));
      if (u.searchParams.has("select")) selected = selected.map(r => Object.fromEntries(u.searchParams.get("select").split(",").map(k => [k, r[k]])));
    }
    return prefer.includes("return=minimal") ? new Response(null, { status: 204 }) : json(selected);
  }
  if (u.origin === "https://odoo.test" && u.pathname === "/jsonrpc") {
    const p = JSON.parse(options.body).params;
    if (p.method === "login" || p.method === "authenticate") return json({ result: 7 });
    const [, , , model, operation, args] = p.args;
    let result;
    if (model === "product.product" && operation === "read") result = [{ id: 1, qty_available: 0 }];
    else if (model === "product.product" && operation === "search_read") result = [{ id: 1, free_qty: 1000 }];
    else if (model === "res.partner" && ["read", "search_read"].includes(operation)) result = [{ id: 42, name: "Pharmacie test", cip: "1234567", active: true, company_id: [2, "Elixir"], customer_rank: 1 }];
    else if (model === "sale.order" && operation === "search_count") result = 1;
    else if (model === "mail.mail" && operation === "create") { mails.push(args[0]); tousMails.push(args[0]); result = mails.length; }
    else if (model === "mail.mail" && operation === "send") result = true;
    else assert.fail(`Odoo inattendu ${model} ${operation}`);
    return json({ result });
  }
  if (u.origin === "https://portail.test") {
    calls.push({ path: u.pathname, method });
    if (u.pathname === "/commandes.php") {
      assert.equal(options.redirect, "manual");
      assert.equal(u.searchParams.get("U"), secrets[0]); assert.equal(u.searchParams.get("P"), secrets[1]);
      const corps = JSON.parse(options.body);
      if ([401, 403, 404, 429, 400, 502].includes(mode)) return json({ status: "error", message: "refus" }, mode);
      if (mode === "timeout") throw new Error(`timeout ${u} ${secrets.join(" ")}`);
      if (mode === "non-json") return new Response("illisible", { status: 200 });
      if (mode === "echo") return json({ status: "error", commandes: 0, message: secrets.join(" ") });
      if (!corps.length) return json({ status: "error", message: "Format invalide : aucune commande" }, 400);
      if (mode === "refus") return json({ status: "error", commandes: 0, errors: [{ message: "Officine bloquée" }] });
      const c = corps[0];
      const p = { id: `id-${c.referenceCommande}`, numero: 123, ref_cde_client: c.referenceCommande, canal: "infosoft", officine: { id_officine: c.identifiantPML }, lignes: c.lignes.map(l => ({ code_produit: l.CIP, quantite: l.quantiteCommandee })) };
      if (mode === "doublon-different") p.lignes[0].quantite++;
      commandes.push(p);
      return json({ status: "ok", commandes: mode.startsWith("doublon") ? 0 : 1, doublons: mode.startsWith("doublon") ? 1 : 0, resultats: [{ statut: mode.startsWith("doublon") ? "doublon" : "creee", commande_id: p.id, numero: p.numero }] });
    }
    assert.equal(options.headers.Authorization, `Bearer ${secrets[2]}`);
    if (panneLecture) throw new Error(`lecture impossible ${secrets.join(" ")}`);
    if (u.pathname === "/api/v1/officines") { if (hook) { const h = hook; hook = null; await h(); } return json({ officines: officine ? [officine] : [] }); }
    if (u.pathname === "/api/v1/commandes") {
      if (pages) return json(pages(u));
      return json({ commandes, curseur_suivant: null });
    }
    if (u.pathname.startsWith("/api/v1/commandes/")) { const c = commandes.find(c => c.id === u.pathname.split("/").pop()); return c ? json(c) : json({}, 404); }
  }
  throw new Error("réseau interdit : destination non simulée");
};
const R = await import("../netlify/functions/_relais.js");
const P = await import("../netlify/functions/_portail-pml.js");
const K = await import("../netlify/functions/_lab-justif.js");
const S = await import("../netlify/functions/_sanofipro.js");
const { handler } = await import("../netlify/functions/sanofipro.js");
let count = 0;
const test = async (nom, fn) => { reset(); await fn(); console.log(`OK ${++count} — ${nom}`); };
const code = "3400930000001", cip = "1234567";
const commande = (extra = {}) => ({ id: "fictive", numero: 123, ref_cde_client: "REF-FICTIVE", recue_le: new Date(Date.now() - 20 * 60000).toISOString(), canal: "pharmaml", statut: "repondue", officine: { id_officine: cip, raison_sociale: "Pharmacie fictive" }, lignes: [{ code_produit: code, cip13_reconnu: null, designation: "Produit fictif", quantite: 2, quantite_livree: 2 }], ...extra });
const ligneInfo = c => { const l = P.lignesFormatInfosoft(c)[0]; return { DateCommande: l.DateCommande, Identifiant: cip, RaisonSociale: "Pharmacie fictive", ReferenceCommande: l.ReferenceCommande, CodeProduit: code, Libelle: "Produit fictif", QuantiteCommandee: 2, QuantiteLivree: 2, ID_Adherent: "42" }; };
const lire = () => K.lignesCommandees({ termes: ["PRODUIT"], codes: [code], cip, du: new Date(Date.now() - 86400000), au: new Date() });
const cfg = { labs: { fictif: { key: "fictif", nom: "Fictif", actif: true, detection: true, produits: [{ cip: code, odooId: 1, nom: "Produit fictif", court: "Produit" }] } } };
const demandes = async () => (await K.kvList("lj:req:")).map(r => r.value);
const voie = () => R.ecrireVoie("portail", "banc");
const posts = () => calls.filter(c => c.method === "POST").length;
const corps = (ref = "SPFICTIVE") => [{ referenceCommande: ref, identifiantPML: cip, lignes: [{ CIP: code, quantiteCommandee: 2, quantiteLivree: 2, prix: 1 }] }];
const relais = () => new S.PharmaMLRelais({ attendre: async () => assert.fail("attente inutile"), priseMs: 75000 });
await test("Sources, valeurs inconnues et dates Paris été/hiver", async () => {
  delete process.env.PML_SOURCES; assert.deepEqual(P.sources(), ["infosoft", "portail"]);
  const cle = process.env.PML_CLE_LECTURE; delete process.env.PML_CLE_LECTURE; assert.deepEqual(P.sources(), ["infosoft"]); process.env.PML_CLE_LECTURE = cle;
  process.env.PML_SOURCES = "portail, inconnue,portail, infosoft"; assert.deepEqual(P.sources(), ["portail", "infosoft"]);
  for (const s of ["", "inconnue"]) { process.env.PML_SOURCES = s; assert.deepEqual(P.sources(), ["infosoft"]); }
  assert.equal(P.parisTexte("2026-07-01T10:00:00Z"), "2026-07-01 12:00:00");
  assert.equal(P.parisTexte("2026-01-01T10:00:00Z"), "2026-01-01 11:00:00");
  const c = commande(); c.lignes[0].cip13_reconnu = "reconnu"; c.lignes[0].quantite_livree = null; c.lignes[0].designation = null;
  const l = P.lignesFormatInfosoft(c)[0]; assert.equal(l.CodeProduit, "reconnu"); assert.equal(l.QuantiteLivree, 0); assert.equal(l.Libelle, ""); assert.equal(l.ID_Adherent, `pml:${cip}`); assert.equal(l.source, "portail");
});
await test("InfoSoft seul, portail seul, rapprochement prioritaire InfoSoft", async () => {
  const c = commande(); info = [ligneInfo(c)]; process.env.PML_SOURCES = "infosoft";
  assert.deepEqual(await lire(), [{ ...info[0], source: "infosoft" }]); assert.equal(calls.length, 0);
  const n = infoCalls; process.env.PML_SOURCES = "portail"; commandes = [c]; assert.equal((await lire())[0].source, "portail"); assert.equal(infoCalls, n);
  process.env.PML_SOURCES = "infosoft,portail"; commandes[0].recue_le = new Date(Date.parse(c.recue_le) + 60000).toISOString();
  assert.deepEqual(await lire(), [{ ...info[0], source: "infosoft" }]);
});
await test("Une source illisible ou une pagination incomplète lève", async () => {
  process.env.PML_SOURCES = "infosoft,portail"; infoPanne = true; await assert.rejects(lire, /InfoSoft/);
  infoPanne = false; panneLecture = true; await assert.rejects(lire, /lecture impossible/);
  panneLecture = false; pages = () => ({ commandes: [], curseur_suivant: "encore" }); await assert.rejects(lire, /incomplète/);
});
await test("Détection répondue, canal infosoft et statut recue ignorés", async () => {
  commandes = [commande(), commande({ id: "site", ref_cde_client: "SITE", canal: "infosoft" }), commande({ id: "recue", ref_cde_client: "RECUE", statut: "recue" })];
  await K.detecter(cfg); assert.equal((await demandes()).length, 1); assert.equal((await demandes())[0].reference, "REF-FICTIVE"); assert.equal((await demandes())[0].statut, "a_envoyer");
});
for (const premier of ["infosoft", "portail"]) await test(`Rapprochement demandes ${premier} puis autre source, 2 h distinctes`, async () => {
  const c = commande(); commandes = [c]; info = [ligneInfo(c)]; process.env.PML_SOURCES = premier;
  await K.detecter(cfg); assert.equal((await demandes()).length, 1);
  process.env.PML_SOURCES = premier === "portail" ? "infosoft" : "portail"; await K.detecter(cfg); assert.equal((await demandes()).length, 1);
  avance(2 * 3600000); const autre = commande({ id: "deuxieme" }); commandes = [autre]; info = [ligneInfo(autre)];
  await K.detecter(cfg); assert.equal((await demandes()).length, 2);
});
await test("Sanofi retrouve la saisie étrangère et couvre notre référence injectée", async () => {
  commandes = [commande({ canal: "saisie" }), commande({ id: "sanofi", canal: "infosoft", ref_cde_client: "SPFICTIVE" })];
  const ls = await new S.PharmaML().lignes(cip, [code], ["PRODUIT"], new Date(Date.now() - 86400000));
  assert.equal(ls.filter(l => l.ReferenceCommande !== "SPFICTIVE").length, 1);
  assert.equal(S.couverture(ls.filter(l => l.ReferenceCommande === "SPFICTIVE"), [{ code, qte: 2 }]).etat, "complete");
  commandes[1].statut = "recue"; commandes[1].lignes[0].quantite_livree = null;
  assert.equal((await lire()).length, 2);
});
await test("Sanofi direct réussi, un POST", async () => { await voie(); assert.equal((await relais().envoyer(corps())).ok, true); assert.equal(posts(), 1); });
for (const statut of [null, "bloquee"]) await test(`Officine ${statut || "absente"}, aucun POST`, async () => {
  await voie(); officine = statut ? { ...officine, statut } : null;
  const r = await relais().envoyer(corps()); assert.equal(r.nonEnvoye, true); assert.equal(r.cause, "refus_agent"); assert.match(r.message, /officine.*portail.*rien envoyé/); assert.equal(posts(), 0);
});
await test("Portail injoignable : retrait immédiat sans attente", async () => {
  await voie(); panneLecture = true; const debut = Date.now(); const r = await relais().envoyer(corps());
  assert.equal(r.nonEnvoye, true); assert.equal(r.cause, "agent"); assert.equal(Date.now(), debut); assert.equal((await R.lireTache("SPFICTIVE")).etat, "annulee"); assert.equal(await K.kvGet("pmlr:file:SPFICTIVE"), null); assert.equal(posts(), 0);
});
await test("401 : refus, pause portail, envoi suivant suspendu", async () => {
  await voie(); mode = 401; const p = relais(); assert.equal((await p.envoyer(corps())).refus, true); assert.equal((await K.kvGet("pmlr:pause")).voie, "portail");
  const r = await p.envoyer(corps("SPAUTRE")); assert.equal(r.nonEnvoye, true); assert.equal(r.cause, "pause"); assert.equal(posts(), 1);
});
await test("Timeout POST : incertain, pas nonEnvoye", async () => {
  await voie(); mode = "timeout"; const r = await relais().envoyer(corps()); assert.equal(r.ok, false); assert.equal(r.refus, false); assert.equal(r.nonEnvoye, undefined); assert.equal(posts(), 1);
});
await test("Pause agent ne bloque pas portail", async () => { await voie(); await K.kvSet("pmlr:pause", { at: new Date().toISOString(), voie: "agent", motif: "fictif" }); assert.equal((await relais().envoyer(corps())).ok, true); });
await test("Voie agent : prise et compte rendu, pause portail sans effet", async () => {
  await K.kvSet("pmlr:pause", { at: new Date().toISOString(), voie: "portail", motif: "fictif" });
  const p = new S.PharmaMLRelais({ attendre: async () => { const [t] = (await R.prendre({ agent: "mac-fictif", version: 3 })).taches; assert.ok(t); await R.rendre({ ...t, http: 200, texte: '{"status":"success","commandes":1}' }); } });
  assert.equal((await p.envoyer(corps())).ok, true); assert.equal(calls.length, 0);
});
await test("Action test_pharmaml directe sans tâche", async () => {
  await voie(); const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer admin-test" }, body: JSON.stringify({ action: "test_pharmaml" }) });
  const j = JSON.parse(r.body); assert.equal(j.voie, "portail"); assert.equal(j.ok, true); assert.equal((await K.kvList("pmlr:tache:")).length, 0);
});
await test("Diagnostic de chaque source, erreurs isolées", async () => {
  process.env.PML_SOURCES = "infosoft,portail"; infoPanne = true; commandes = [commande()];
  const r = await K.testSources(); assert.match(r.infosoft.erreur, /InfoSoft/); assert.equal(r.portail, 1);
});
await test("Anti-doublon au-delà de 2 000 demandes, toutes sources et tous statuts", async () => {
  const c = commande(); commandes = [c];
  for (let i = 0; i < 2001; i++) tables.kv_store.push({ key: `lj:req:a${String(i).padStart(4, "0")}`, value: JSON.stringify({ lab: "autre", dateCommande: c.recue_le }), updated_at: new Date().toISOString() });
  await K.kvSet("lj:req:zancienne", { lab: "fictif", pharmacie: { cip }, reference: c.ref_cde_client, dateCommande: c.recue_le, statut: "ignoree", source: "site" });
  assert.deepEqual(await K.detecter(cfg), []);
  assert.equal(tables.kv_store.filter(r => r.key.startsWith("lj:req:")).length, 2002);
});
await test("Pause et budget survenus pendant le contrôle officine : retrait immédiat", async () => {
  for (const cas of ["pause", "budget"]) {
    reset(); await voie();
    hook = async () => { if (cas === "pause") await K.kvSet("pmlr:pause", { at: new Date().toISOString(), voie: "portail", motif: "pause fictive" }); else avance(9000); };
    const r = await relais().envoyer(corps()); assert.equal(r.nonEnvoye, true); assert.equal(r.cause, cas === "pause" ? "pause" : "agent"); assert.equal(posts(), 0); assert.equal((await R.lireTache("SPFICTIVE")).etat, "annulee");
  }
});
console.log(`${count} cas réussis, hors ligne, données fictives.`);
process.exit(0);
