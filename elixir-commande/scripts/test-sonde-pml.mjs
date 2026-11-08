// Banc hors ligne : vrais modules, faux HTTP et horloge maîtrisée.
import assert from "node:assert/strict";
Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_KEY: "sb-test", ODOO_URL: "https://odoo.test", ODOO_DB: "test", ODOO_LOGIN: "test", ODOO_PASSWORD: "test" });
const secrets = ["SENTINEL_U+secret", "SENTINEL_P&secret", "SENTINEL_READ_secret"];
[process.env.PML_INJECTION_U, process.env.PML_INJECTION_P, process.env.PML_CLE_LECTURE] = secrets;
const DateNative = Date;
let horloge;
globalThis.Date = class extends DateNative { constructor(...args) { super(...(args.length ? args : [horloge])); } static now() { return horloge; } };
const avance = minutes => { horloge += minutes * 60000; };
let table, mails, brouillons, appels, mode, panneOdoo, panneLecture, panneEcriture;
const traces = [], sorties = [], ecritures = [], tousMails = [];
const journal = console.log;
for (const methode of ["log", "warn", "error"]) console[methode] = (...args) => traces.push(args.map(String).join(" "));
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
function reset() {
  table = new Map(); mails = []; brouillons = []; appels = []; mode = "ok";
  panneOdoo = panneLecture = panneEcriture = false;
  process.env.PML_PORTAIL_URL = "https://portail.test///"; delete process.env.PML_SONDE;
  horloge = DateNative.parse("2026-11-08T10:00:00Z");
}
reset();
globalThis.fetch = async (input, options = {}) => {
  const u = new URL(input), methode = options.method || "GET";
  appels.push(String(u));
  if (u.origin === "https://supabase.test" && u.pathname === "/rest/v1/kv_store") {
    if (methode === "DELETE") {
      table.delete(u.searchParams.get("key").slice(3));
      return new Response(null, { status: 204 });
    }
    if (methode === "GET") {
      const cle = u.searchParams.get("key").slice(3);
      if (panneLecture && cle === "pmlr:sonde") throw new Error(`lecture impossible ${secrets.join(" ")}`);
      return json(table.has(cle) ? [{ value: table.get(cle) }] : []);
    }
    assert.equal(methode, "POST");
    const corps = JSON.parse(options.body); ecritures.push(corps);
    if (panneEcriture && corps.key === "pmlr:sonde") throw new Error(`écriture impossible ${secrets.join(" ")}`);
    table.set(corps.key, corps.value); return new Response(null, { status: 201 });
  }
  if (u.origin === "https://odoo.test" && u.pathname === "/jsonrpc") {
    if (panneOdoo) throw new Error(`Odoo indisponible ${secrets.join(" ")}`);
    const p = JSON.parse(options.body).params;
    if (["login", "authenticate"].includes(p.method)) return json({ result: 7 });
    const [, , , modele, operation, args] = p.args;
    assert.equal(modele, "mail.mail");
    if (operation === "create") { brouillons.push(args[0]); return json({ result: brouillons.length }); }
    assert.equal(operation, "send");
    for (const id of args[0]) { mails.push(brouillons[id - 1]); tousMails.push(brouillons[id - 1]); }
    return json({ result: true });
  }
  if (["https://portail.test", "https://pml.elixirpharma.fr"].includes(u.origin)) {
    assert.equal(u.pathname + u.search, "/sante?detail"); assert.equal(methode, "GET");
    assert.deepEqual(options.headers, { "Cache-Control": "no-cache" }); assert.ok(options.signal instanceof AbortSignal);
    const attendre = () => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("annulé")), { once: true }));
    if (mode === "delai") return attendre();
    if (mode === "corps-lent") return { status: 200, json: attendre };
    if (mode === "reseau") throw new Error(`connexion impossible ${secrets.join(" ")}`);
    if (mode === "illisible") return new Response("<html>indisponible</html>");
    if (mode === "controles-secrets") return json({ ok: false, controles: Object.fromEntries(secrets.map(s => [s, false])) }, 503);
    if (mode === "503") return json({ ok: false, controles: { base: true, traitement: false, ecriture: false } }, 503);
    if (mode === "faux") return json({ ok: false });
    if (mode === "503-vrai") return json({ ok: true }, 503);
    return json({ ok: true, controles: { base: true, schema: true, ecriture: true, traitement: true } });
  }
  assert.fail(`destination non simulée : ${u.origin}`);
};
const { sonder } = await import("../netlify/functions/_sonde-pml.js");
const { handler } = await import("../netlify/functions/pml-sonde-cron.js");
const sonde = async options => { const r = await sonder(options); sorties.push(r); return r; };
const etat = () => JSON.parse(table.get("pmlr:sonde"));
const panne = async () => { mode = "503"; await sonde(); avance(5); return sonde(); };
let reussis = 0, rates = 0;
async function test(nom, fn) {
  reset();
  try { await fn(); reussis++; journal(`OK — ${nom}`); }
  catch (e) { rates++; journal(`ÉCHEC — ${nom}`, e); }
}
await test("succès simple et URL par défaut", async () => {
  delete process.env.PML_PORTAIL_URL;
  assert.deepEqual(await sonde(), { ok: true, echecs: 0, alerte: null }); assert.equal(mails.length, 0);
  assert.equal(etat().dernierSuccesA, new Date().toISOString());
});
await test("un échec sans e-mail, succès remet le compteur à zéro", async () => {
  mode = "503"; assert.equal((await sonde()).echecs, 1); assert.equal(mails.length, 0);
  assert.equal(etat().premierEchecA, new Date().toISOString());
  mode = "ok"; await sonde(); assert.equal(etat().premierEchecA, null);
  mode = "503"; assert.equal((await sonde()).echecs, 1); assert.equal(mails.length, 0);
});
for (const destinataire of [null, "astreinte@test.fr"]) await test(`deux échecs : destinataire ${destinataire || "par défaut"}`, async () => {
  if (destinataire) table.set("pmlr:config", JSON.stringify({ alertes: destinataire }));
  assert.equal((await panne()).alerte, "envoyee"); assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "Portail PharmaML injoignable"); assert.equal(mails[0].email_to, destinataire || "pharmacien@elixirpharma.fr");
  assert.match(mails[0].body_html, /2026-11-08 11:00:00.*heure de Paris/); assert.match(mails[0].body_html, /2 échecs de suite/);
  assert.match(mails[0].body_html, /https:\/\/portail.test/);
  assert.match(mails[0].body_html, /Les pharmacies ne peuvent plus envoyer de commandes au portail ; les commandes du site attendent dans la file du relais/);
  assert.equal(etat().alerteEnvoyee, true);
});
await test("limite horaire, rappel à 65 min, rétablissement et succès suivant", async () => {
  await panne(); avance(5); assert.equal((await sonde()).alerte, "retenue"); assert.equal(mails.length, 1);
  avance(60); assert.equal((await sonde()).alerte, "envoyee"); assert.equal(mails.length, 2);
  avance(5); mode = "ok"; assert.equal((await sonde()).alerte, "retabli"); assert.equal(mails.length, 3);
  assert.equal(mails[2].subject, "Portail PharmaML rétabli"); assert.match(mails[2].body_html, /75 minutes/);
  assert.match(mails[2].body_html, /2026-11-08 12:15:00.*heure de Paris/);
  assert.deepEqual(etat(), { echecs: 0, premierEchecA: null, dernierEchecA: null, dernierMotif: null, alerteEnvoyee: false, dernierSuccesA: new Date().toISOString() });
  assert.equal((await sonde()).alerte, null); assert.equal(mails.length, 3);
});
for (const [type, motif] of [["delai", /délai dépassé \(0.005 s\)/], ["corps-lent", /délai dépassé/], ["503", /HTTP 503 — contrôles en échec : traitement, ecriture/], ["faux", /HTTP 200/], ["503-vrai", /HTTP 503/], ["illisible", /réponse illisible/], ["reseau", /réseau : connexion impossible/]]) await test(`échec : ${type}`, async () => {
  mode = type; const r = await sonde({ delaiMs: 5 }); assert.equal(r.ok, false); assert.match(r.motif, motif); assert.equal(etat().dernierMotif, r.motif);
});
await test("nouvelle panne 20 min après rétablissement : alerte dès le deuxième échec", async () => {
  await panne(); assert.equal(mails.length, 1); assert.ok(table.has("pmlr:alerte:sonde"));
  avance(5); mode = "ok"; assert.equal((await sonde()).alerte, "retabli");
  assert.equal(table.has("pmlr:alerte:sonde"), false); assert.equal(mails.length, 2);
  avance(20); mode = "503"; assert.equal((await sonde()).alerte, null); assert.equal(mails.length, 2);
  avance(5); assert.equal((await sonde()).alerte, "envoyee"); assert.equal(mails.length, 3);
  assert.equal(mails[2].subject, "Portail PharmaML injoignable"); assert.equal(etat().echecs, 2);
});
await test("Odoo en panne, alerte réessayée au passage suivant", async () => {
  panneOdoo = true; assert.equal((await panne()).alerte, null); assert.equal(etat().alerteEnvoyee, false); assert.equal(mails.length, 0);
  panneOdoo = false; avance(5); assert.equal((await sonde()).alerte, "envoyee"); assert.equal(mails.length, 1);
});
await test("rétablissement réessayé si Odoo est indisponible", async () => {
  await panne(); mode = "ok"; panneOdoo = true; avance(5);
  assert.equal((await sonde()).alerte, null); assert.equal(etat().alerteEnvoyee, true);
  assert.equal(etat().premierEchecA, "2026-11-08T10:00:00.000Z"); assert.equal(etat().echecs, 0);
  panneOdoo = false; avance(5); assert.equal((await sonde()).alerte, "retabli"); assert.match(mails[1].body_html, /15 minutes/); assert.equal(etat().alerteEnvoyee, false);
});
await test("lecture et écriture d'état impossibles tolérées", async () => {
  panneLecture = true; mode = "503"; assert.equal((await sonde()).echecs, 1);
  panneEcriture = true; assert.equal((await sonde()).echecs, 1);
});
await test("interrupteur sans aucun appel réseau", async () => {
  process.env.PML_SONDE = "off"; assert.deepEqual(await sonde(), { desactivee: true }); assert.equal(appels.length, 0);
});
await test("secrets masqués dans les e-mails, l'état, les résumés et les journaux", async () => {
  for (const type of ["reseau", "controles-secrets"]) { mode = type; await sonde(); avance(65); await sonde(); }
  assert.equal(mails.length, 2);
  const tout = JSON.stringify({ sorties, ecritures, tousMails, traces });
  for (const secret of secrets) assert.ok(!tout.includes(secret), "secret divulgué");
});
await test("cron silencieux en bonne santé et désactivé, une ligne en échec et rétablissement", async () => {
  let debut = traces.length;
  assert.equal((await handler()).statusCode, 200); assert.equal(traces.length, debut);
  process.env.PML_SONDE = "off"; await handler(); assert.equal(traces.length, debut); delete process.env.PML_SONDE;
  mode = "503"; await handler(); assert.equal(traces.length, ++debut);
  avance(5); await handler(); assert.equal(traces.length, ++debut);
  mode = "ok"; await handler(); assert.equal(traces.length, ++debut);
});
await test("cron : exception inattendue masquée et HTTP 500", async () => {
  // Une erreur locale permet de vérifier le dernier filet du handler.
  const dateISO = Date.prototype.toISOString;
  Date.prototype.toISOString = () => { throw new Error(secrets.join(" ")); };
  try { const r = await handler(); assert.equal(r.statusCode, 500); for (const secret of secrets) assert.ok(!r.body.includes(secret)); }
  finally { Date.prototype.toISOString = dateISO; }
});
journal(`${reussis} cas réussis, ${rates} échecs.`);
process.exitCode = rates ? 1 : 0;
