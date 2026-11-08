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
let tables, mails, calls, mode, officine, panneLecture, commandes, hook, pages;
const sorties = [], logs = [], ecritures = [], tousMails = [];
for (const method of ["log", "warn", "error"]) { const original = console[method]; console[method] = (...args) => { logs.push(args.map(String).join(" ")); original(...args); }; }
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
function reset() {
  tables = { kv_store: [], elixir_orders: [], elixir_pharmacies: [{ email: "pharmacie@test.fr", cip: "1234567" }] };
  mails = []; calls = []; mode = "ok"; officine = { id_officine: "1234567", statut: "active", ref_erp: "42" }; panneLecture = false; commandes = []; hook = null; pages = null;
  avance(1000);
}
reset();
globalThis.fetch = async (input, options = {}) => {
  const u = new URL(input), method = options.method || "GET";
  if (u.origin === "https://supabase.test") {
    if (u.pathname === "/auth/v1/user") return json({ id: "admin", email: "admin@test.fr", app_metadata: { role: "admin" } });
    const table = u.pathname.replace("/rest/v1/", ""), rows = tables[table];
    assert.ok(rows, `table inattendue ${table}`);
    const filters = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
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
    if (model === "product.product" && operation === "search_read") result = [{ id: 1, free_qty: 1000 }];
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
const { handler } = await import("../netlify/functions/pml-relais.js");
const { handler: submit } = await import("../netlify/functions/submit-order.js");
let count = 0;
const test = async (nom, fn) => { reset(); await fn(); count++; console.log(`OK ${count} — ${nom}`); };
const retour = v => { sorties.push(v); return v; };
const prendre = () => R.prendre({ agent: "mac-bureau", version: 3, instance: "test" });
const voie = () => R.ecrireVoie("portail", "test");
let id = 1000000;
function order() {
  const o = { id: String(++id), date: new Date().toISOString(), pharmacy_cip: "1234567", pharmacy_email: "pharmacie@test.fr", pharmacy_name: "Test", source: "catalogue", items: [{ cip: "3400930000001", qty: 2, pn: 1, name: "Produit" }], processed: false };
  tables.elixir_orders.push(o); return o;
}
const envoyer = o => R.envoyerCommande({ orderId: o.id, par: "test" }).then(retour);
const posts = () => calls.filter(c => c.method === "POST").length;
const tache = o => R.lireTache(o.id);
const reserve = o => K.kvGet(`pmlr:ligne:${o.id}:0`);
const portailPour = t => ({ id: "retrouvee", numero: 124, ref_cde_client: t.ref, officine: { id_officine: "1234567" }, lignes: t.corps[0].lignes.map(l => ({ code_produit: l.CIP, quantite: l.quantiteCommandee })) });
const api = b => handler({ httpMethod: "POST", headers: { authorization: "Bearer admin-test" }, body: JSON.stringify(b) }).then(r => retour(JSON.parse(r.body)));
await test("1. Agent inchangé, aucun portail", async () => {
  const o = order(); assert.equal((await R.lireConfig()).voie, "agent"); assert.equal((await envoyer(o)).ok, true);
  const [t] = (await prendre()).taches; assert.equal(t.ref, o.id); assert.equal(calls.length, 0);
  const r = await R.rendre({ ...t, http: 200, texte: '{"status":"success","commandes":1,"errors":[]}' }); assert.equal(r.etat, "envoyee"); assert.equal(calls.length, 0);
});
await test("2. Auto site, marques, journal et réservations", async () => {
  await voie(); await R.ecrireConfig({ autoSite: true }, "test"); const o = order();
  const r = retour(await R.envoiAuto({ orderId: o.id, user: { cip: "1234567" } }));
  assert.equal(r.direct?.etat, "envoyee"); assert.equal(posts(), 1); assert.equal((await tache(o)).numeroPortail, 123);
  assert.equal(o.items[0].synced_ref, o.id); assert.ok(o.items[0].synced_at); assert.equal(o.processed, true); assert.ok(await reserve(o));
  assert.ok(tables.kv_store.some(r => r.key.startsWith("pml:")));
});
await test("3. Interrupteur et battement", async () => {
  const o = order(); await envoyer(o); assert.equal((await R.envoyerDirect(o.id)).code, "voie");
  await voie(); assert.deepEqual(await prendre(), { taches: [], voie: "portail" }); assert.ok(await K.kvGet("pmlr:agent")); assert.equal(posts(), 0);
});
for (const valeur of [null, { statut: "en_attente", ref_erp: "42" }, { statut: "bloquee", ref_erp: "42" }, { statut: "active", ref_erp: null }]) await test(`4. Officine ${valeur?.statut || "absente"} / ${valeur?.ref_erp || "sans lien"}`, async () => {
  await voie(); officine = valeur && { ...valeur, id_officine: "1234567" }; const o = order(); await envoyer(o);
  assert.equal((await tache(o)).etat, "non_envoyee"); assert.equal(await reserve(o), null); assert.equal(posts(), 0); assert.equal(mails.length, 1);
  await envoyer(order()); assert.equal(mails.length, 1); avance(86400001); await envoyer(order()); assert.equal(mails.length, 2);
});
await test("5. Lecture indisponible, reprise cron", async () => {
  await voie(); panneLecture = true; const o = order(); const r = await envoyer(o); assert.equal(r.direct.code, "transitoire"); assert.equal((await tache(o)).etat, "a_envoyer"); assert.equal(posts(), 0);
  panneLecture = false; await R.surveiller(); assert.equal((await tache(o)).etat, "envoyee"); assert.equal(posts(), 1);
});
await test("6. Refus métier certain", async () => { await voie(); mode = "refus"; const o = order(); await envoyer(o); assert.equal((await tache(o)).etat, "refusee"); assert.equal(await reserve(o), null); });
await test("7. Pause portail et bascule agent", async () => {
  await voie(); mode = 401; const o = order(); await envoyer(o); assert.equal((await tache(o)).etat, "refusee"); assert.equal((await K.kvGet("pmlr:pause")).voie, "portail");
  const autre = order(); assert.equal((await envoyer(autre)).direct.code, "pause"); assert.equal(posts(), 1);
  await R.ecrireVoie("agent", "test"); assert.equal((await prendre()).taches[0].ref, autre.id);
});
for (const erreur of ["timeout", 502]) for (const resultat of ["meme", "absente", "different"]) await test(`8. ${erreur}, vérification ${resultat}`, async () => {
  await voie(); mode = erreur; const o = order(); await envoyer(o); const t = await tache(o); assert.equal(t.etat, "incertaine"); assert.ok(await reserve(o));
  if (resultat !== "absente") { const p = portailPour(t); if (resultat === "different") p.lignes[0].quantite++; commandes.push(p); }
  const nb = mails.length; avance(120001); await R.surveiller(); const fin = await tache(o);
  assert.equal(fin.etat, resultat === "meme" ? "envoyee" : "incertaine"); assert.equal(posts(), 1);
  if (resultat === "meme") { assert.equal(o.items[0].synced_ref, o.id); assert.equal(fin.verifieePar, "portail (lecture automatique)"); }
  if (resultat === "absente") assert.equal(fin.verifAuto.resultat, "absente");
  if (resultat === "different") { assert.match(fin.message, /autre contenu/); assert.ok(mails.length > nb); }
});
for (const m of ["doublon", "doublon-different"]) await test(`9. ${m}`, async () => { await voie(); mode = m; const o = order(); await envoyer(o); assert.equal((await tache(o)).etat, m === "doublon" ? "envoyee" : "incertaine"); assert.equal(posts(), 1); });
await test("10. Deux prises directes concurrentes", async () => {
  const o = order(); await envoyer(o); await voie(); const rs = await Promise.all([R.envoyerDirect(o.id), R.envoyerDirect(o.id)]);
  assert.equal(posts(), 1); assert.equal(rs.filter(r => r.ok).length, 1); assert.equal((await tache(o)).historique.filter(h => h.etat === "prise").length, 1);
});
await test("10. Course changement de voie pendant lecture officine", async () => {
  const o = order(); await envoyer(o); await voie(); let agent;
  hook = async () => { await R.ecrireVoie("agent", "test"); agent = (await prendre()).taches[0]; };
  const r = await R.envoyerDirect(o.id); assert.equal(r.code, "voie"); assert.equal(posts(), 0); assert.equal(agent.ref, o.id);
  await R.rendre({ ...agent, http: 200, texte: '{"status":"success","commandes":1}' });
  assert.equal((await tache(o)).etat, "envoyee"); assert.equal((await tache(o)).historique.filter(h => h.etat === "prise").length, 1);
});
await test("11. Échéance", async () => { const o = order(); await envoyer(o); await voie(); avance(2 * 3600000 + 1); await R.surveiller(); assert.equal((await tache(o)).etat, "expiree"); assert.equal(await reserve(o), null); assert.equal(posts(), 0); });
for (const m of ["ok", 401, 404]) await test(`12. Action test portail ${m}`, async () => { mode = m; const r = await api({ action: "test", voie: "portail" }); assert.equal(r.ok, m === "ok"); assert.equal(r.injection.http, m === "ok" ? 400 : m); assert.equal(r.lecture.ok, true); assert.equal(tables.kv_store.length, 0); });
await test("13. Sans compte rendu portail, libération sans agent", async () => {
  const o = order(); await envoyer(o); await voie(); const t = await tache(o);
  await K.kvSet(`pmlr:tache:${o.id}`, { ...t, etat: "prise", voie: "portail", jeton: "interrompue", priseA: new Date().toISOString() });
  avance(16 * 60000); await R.surveiller(); assert.equal((await tache(o)).etat, "incertaine"); assert.equal(await K.kvGet("pmlr:agent"), null);
  assert.equal((await R.libererApresVerification(o.id, "test")).ok, true); assert.equal(await reserve(o), null);
});
await test("14. Secrets : réponses, base, e-mails, console", async () => {
  await voie(); mode = "echo"; await envoyer(order()); mode = "timeout"; await envoyer(order()); panneLecture = true; await envoyer(order());
  retour(await P.injecter([])); retour(await R.statut()); retour(await api({ action: "test", voie: "portail" }));
  const texte = JSON.stringify([ecritures, tousMails, sorties, logs]);
  for (const s of secrets) { assert.equal(texte.includes(s), false); assert.equal(texte.includes(encodeURIComponent(s)), false); }
});
await test("15. Configuration incomplète et conservation de la voie", async () => {
  for (const key of ["PML_INJECTION_U", "PML_INJECTION_P", "PML_CLE_LECTURE"]) { const v = process.env[key]; delete process.env[key]; await assert.rejects(R.ecrireVoie("portail", "test"), e => e.status === 400); process.env[key] = v; }
  await voie(); const c = await R.ecrireConfig({ autoSite: true, alertes: "test@test.fr" }, "test"); assert.equal(c.voie, "portail"); assert.equal(c.voiePar, "test");
  await R.ecrireVoie("agent", "test"); assert.equal((await R.lireConfig()).autoSite, true);
});
await test("Budget et test agent jamais injecté", async () => {
  const o = order(); await envoyer(o); await voie(); assert.equal((await R.envoyerDirect(o.id, { finAvant: Date.now() + 16000 })).code, "budget"); assert.equal((await tache(o)).etat, "a_envoyer");
  await R.mettreEnFile({ ref: "TEST-VIDE", source: "test", corps: [] }); await R.envoyerDirect("TEST-VIDE"); assert.equal((await R.lireTache("TEST-VIDE")).etat, "annulee"); assert.equal(posts(), 0);
});
await test("Revalidation corps et empreinte", async () => {
  for (const change of [t => t.corps[0].lignes[0].quantiteCommandee = -1, t => t.corps[0].lignes[0].prix = "2", t => t.empreinte = "incorrecte", t => t.corps[0].lignes = [], t => t.corps[0].lignes[0].CIP = "x".repeat(21)]) {
    await R.ecrireVoie("agent", "test"); const o = order(); await envoyer(o); const t = await tache(o); change(t); await K.kvSet(`pmlr:tache:${o.id}`, t); await voie(); await R.envoyerDirect(o.id); assert.equal((await tache(o)).etat, "non_envoyee");
  } assert.equal(posts(), 0);
});
await test("Pagination, ISO, multiensemble, 404", async () => {
  pages = u => { assert.equal(u.searchParams.get("depuis"), "2026-11-08T10:00:00.000Z"); return { commandes: [{ id: u.searchParams.get("curseur") || "1" }], curseur_suivant: u.searchParams.has("curseur") ? null : "2" }; };
  const opts = { depuis: "2026-11-08T11:00:00+01:00" };
  assert.deepEqual(await P.lireCommandes(opts), { commandes: [{ id: "1" }, { id: "2" }], complet: true });
  assert.equal((await P.lireCommandes({ ...opts, maxPages: 1 })).complet, false); assert.equal(await P.lireCommande("absente"), null);
  const c = { referenceCommande: "abc", lignes: [{ CIP: "1", quantiteCommandee: 2 }, { CIP: "1", quantiteCommandee: 2 }] };
  assert.equal(P.memeContenu({ ref_cde_client: "abc", lignes: [{ code_produit: "1", quantite: 4 }] }, c), false);
});
await test("submit-order annonce l'envoi direct", async () => {
  await voie(); await R.ecrireConfig({ autoSite: true }, "test"); const o = order(); o.entered_by = "admin@test.fr";
  const res = await submit({ httpMethod: "POST", headers: { authorization: "Bearer admin-test" }, body: JSON.stringify({ via: "auto", orderId: o.id }) });
  assert.equal(JSON.parse(res.body).envoye, true); assert.ok(tables.kv_store.some(r => r.value.includes('"outcome":"envoyee_portail"')));
});
await test("Réglages concurrents : aucun champ perdu", async () => {
  await Promise.all([R.ecrireVoie("portail", "voie"), R.ecrireConfig({ autoSite: true, alertes: "autre@test.fr" }, "config")]);
  const c = await R.lireConfig(); assert.equal(c.voie, "portail"); assert.equal(c.autoSite, true); assert.equal(c.alertes, "autre@test.fr");
});
await test("Libération avant 10 minutes refusée", async () => {
  await voie(); mode = "timeout"; const o = order(); await envoyer(o);
  assert.equal((await R.libererApresVerification(o.id, "test")).ok, false);
  avance(600001); assert.equal((await R.libererApresVerification(o.id, "test")).ok, true);
});
await test("Ancienne pause agent sans voie, test vide autorisé", async () => {
  const o = order(); await envoyer(o); await K.kvSet("pmlr:pause", { at: new Date().toISOString(), motif: "403" });
  assert.equal((await prendre()).taches.length, 0);
  await R.mettreEnFile({ ref: "TEST-AGENT", source: "test", corps: [] }); assert.equal((await prendre()).taches[0].ref, "TEST-AGENT");
  await voie(); assert.equal((await R.envoyerDirect(o.id)).etat, "envoyee");
});
await test("Attente directe : rappel à 2 h, pas d'alerte agent", async () => {
  await voie(); panneLecture = true; const o = order(); await envoyer(o); avance(600001); await R.surveiller();
  assert.equal(mails.filter(m => m.subject === "Envois directs au portail en attente").length, 1);
  await R.surveiller(); assert.equal(mails.length, 1); assert.ok(!mails.some(m => m.subject.includes("Mac")));
  avance(7200001); const autre = order(); await envoyer(autre); avance(600001); await R.surveiller();
  assert.equal(mails.filter(m => m.subject === "Envois directs au portail en attente").length, 2);
});
for (const m of [400, 403, 404, 429, "non-json"]) await test(`Classement supplémentaire ${m}`, async () => {
  await voie(); mode = m; const o = order(); await envoyer(o);
  assert.equal((await tache(o)).etat, m === "non-json" ? "incertaine" : "refusee");
  assert.equal(!!(await K.kvGet("pmlr:pause")), [403, 404, 429].includes(m));
});
for (const s of secrets) assert.equal(JSON.stringify([ecritures, tousMails, sorties, logs]).includes(s), false);
console.log(`${count} cas réussis, hors ligne.`);
process.exit(0); // rate-limit.js conserve un intervalle de ménage, comme dans l'application.

