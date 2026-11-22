// Hors ligne : faux Supabase Auth, faux PostgREST et simulation du déclencheur d'audit.
// Le SQL réel doit être validé séparément dans une base de test ; aucun réseau ici.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { creerHandlerCrm } from "../netlify/functions/crm.js";
import { creerHandlerLogin } from "../netlify/functions/crm-login.js";
import { verifierCrm } from "../netlify/functions/_crm-acces.js";
import { creerStockCrm } from "../netlify/functions/_crm-stock.js";
globalThis.fetch = () => { throw new Error("Appel réseau interdit dans ces tests"); };
let ok = 0, ko = 0;
async function test(nom, fn) { try { await fn(); ok++; } catch (e) { ko++; console.error("✗", nom, e.message); } }
const maintenant = () => new Date("2026-11-22T10:00:00Z");
const clone = x => structuredClone(x);
const json = (v, status = 200, headers = {}) => new Response(JSON.stringify(v), { status, headers });
const roles = ["admin", "commercial", "service_client", "lecture"];
function fauxSupabase() {
  const tables = Object.fromEntries(["comptes", "contacts", "activites", "opportunites", "equipe", "reglages", "journal", "indicateurs", "synchros"].map(r => [`crm_${r}`, []]));
  const users = Object.fromEntries([...roles, "pharmacie", "imposteur", "autre"].map(role => [role, {
    id: randomUUID(), email: `${role}@exemple.test`, app_metadata: { role: roles.includes(role) ? role : undefined, autre: "conserve" },
    user_metadata: role === "imposteur" ? { role: "admin" } : {},
  }]));
  const appels = [];
  const etat = { authStatus: 200, authIllisible: false, reseau: false, basePanne: false, auditPanne: false, adminPanne: false, course: false };
  const correspond = (row, p) => [...p].every(([k, v]) => {
    if (["select", "limit", "offset", "order"].includes(k)) return true;
    if (k === "and") return v.slice(1, -1).split(",").every(c => {
      const [col, op, val] = c.split("."); return row[col] != null && (op === "gte" ? row[col] >= Number(val) : row[col] <= Number(val));
    });
    if (k === "or") return v.slice(1, -1).split(",").some(c => { const [col, op, ...val] = c.split("."); assert.equal(op, "ilike"); return String(row[col] || "").toLowerCase().includes(val.join(".").slice(1, -1).toLowerCase()); });
    const [op, ...reste] = v.split("."), val = reste.join(".");
    if (op === "in") return val.slice(1, -1).split(",").includes(String(row[k]));
    if (op === "eq") return String(row[k]) === val;
    if (op === "lte") return row[k] != null && row[k] <= val;
    throw new Error(`Filtre non simulé : ${k}=${v}`);
  });
  async function fetch(url, opts = {}) {
    const u = new URL(url), method = opts.method || "GET", body = opts.body ? JSON.parse(opts.body) : undefined;
    appels.push({ url, method, body, headers: opts.headers });
    if (etat.reseau) throw new Error("panne fictive");
    if (u.pathname.startsWith("/auth/v1/admin/users/")) {
      assert.equal(opts.headers.apikey, "cle-serveur-fictive");
      assert.equal(opts.headers.Authorization, "Bearer cle-serveur-fictive");
      if (etat.adminPanne) return json({}, 503);
      const user = Object.values(users).find(v => v.id === u.pathname.split("/").at(-1));
      if (!user) return json({}, 404);
      if (method === "PUT") user.app_metadata = { ...user.app_metadata, ...body.app_metadata };
      return json(user);
    }
    if (u.pathname.startsWith("/auth/")) {
      assert.equal(opts.headers.apikey, "cle-auth-fictive");
      if (etat.authStatus !== 200) return json({}, etat.authStatus);
      if (etat.authIllisible) return new Response("invalide");
      if (u.pathname === "/auth/v1/user") return users[opts.headers.Authorization.slice(7)] ? json(users[opts.headers.Authorization.slice(7)]) : json({}, 401);
      assert.equal(u.pathname, "/auth/v1/token");
      assert.equal(u.searchParams.get("grant_type"), "password");
      const user = Object.values(users).find(v => v.email === body.email);
      if (!user || body.password !== "mot-de-passe-fictif") return json({}, 400);
      return json({ user, access_token: "jeton-fictif", refresh_token: "renouvellement-fictif", expires_in: 3600 });
    }
    if (u.pathname === "/.netlify/functions/crm-indicateurs-background") {
      assert.equal(opts.headers["x-cron-secret"], "secret-cron-fictif"); return json({}, 202);
    }
    assert.equal(opts.headers.apikey, "cle-serveur-fictive");
    assert.equal(opts.headers.Authorization, "Bearer cle-serveur-fictive");
    const t = u.pathname.replace("/rest/v1/", ""), p = u.searchParams;
    if (t === "crm_comptes_indicateurs") tables[t] = tables.crm_comptes.map(c => {
      const i = tables.crm_indicateurs.filter(i => i.odoo_id === c.odoo_id).sort((a, b) => b.periode_fin.localeCompare(a.periode_fin))[0];
      const d = i?.donnees;
      return { ...c, periode_fin:i?.periode_fin || null, indicateurs: d || null, ca: d?.ca ?? null, evolution: d?.prev > 0 ? (d.ca / d.prev - 1) * 100 : null,
        profil: d?.profil ?? null, action_proposee: d?.action ?? null, non_servi: d ? d.ns_fond + d.ns_cher + d.ns_glp : null };
    });
    assert.ok(tables[t], `Table inconnue ${t}`);
    if (etat.basePanne) return json({}, 503);
    if (method === "GET") {
      let lignes = tables[t].filter(r => correspond(r, p));
      const total = lignes.length;
      const ordres = p.get("order")?.split(",") || [];
      lignes = [...lignes].sort((a, b) => {
        for (const o of ordres) { const [c, sens] = o.split("."); const d = String(a[c]).localeCompare(String(b[c])); if (d) return d * (sens === "desc" ? -1 : 1); }
        return 0;
      });
      const offset = Number(p.get("offset") || 0);
      return json(lignes.slice(offset, offset + Number(p.get("limit") || 1000)).map(r=>{
        const aliases=Object.fromEntries((p.get("select") || "").split(",").filter(k=>k.includes(":")).map(k=>{const [alias,chemin]=k.split(":");return [alias,chemin.split("->").reduce((v,k)=>v?.[k],r)];}));
        return {...r,...aliases};
      }), 200, { "content-range": `*/${total}` });
    }
    assert.ok(["POST", "PATCH"].includes(method));
    if (etat.auditPanne) return json({}, 500); // Échec du trigger : rollback de la transaction.
    if (etat.course && method === "PATCH") {
      const row = tables[t].find(r => r.id === p.get("id")?.slice(3));
      if (row) row.version++;
      etat.course = false;
    }
    const cibles = method === "POST" ? [null] : tables[t].filter(r => correspond(r, p));
    const sorties = [];
    for (const avant of cibles) {
      const apres = { id: randomUUID(), ...avant, ...body };
      if (method === "POST" && ((t === "crm_reglages" && tables[t].length) || (t === "crm_equipe" && tables[t].some(r => r.utilisateur_id === apres.utilisateur_id)) ||
        (t === "crm_comptes" && tables[t].some(r => ["finess", "odoo_id"].some(k => apres[k] != null && r[k] === apres[k]))))) return json({ code: "23505" }, 409);
      tables.crm_journal.push({ id: randomUUID(), acteur_id: opts.headers["x-crm-acteur"], acteur_email: opts.headers["x-crm-email"],
        action: opts.headers["x-crm-action"], objet: t.slice(4), objet_id: apres.id, avant: clone(avant), apres: clone(apres), created_at: maintenant().toISOString() });
      if (avant) Object.assign(avant, apres); else tables[t].push(apres);
      sorties.push(apres);
    }
    return json(sorties, method === "POST" ? 201 : 200);
  }
  return { tables, users, appels, etat, fetch };
}
const db = fauxSupabase();
const deps = { fetch: db.fetch, url: "https://supabase.exemple.test", authCle: "cle-auth-fictive", cle: "cle-serveur-fictive", siteUrl: "https://site.exemple.test", cronSecret: "secret-cron-fictif", adminEmail: "", maintenant, rateLimit: () => null };
const api = creerHandlerCrm(deps), login = creerHandlerLogin(deps), stock = creerStockCrm(deps);
const event = (role, body, httpMethod = "POST") => ({ httpMethod, headers: { ...(role ? { authorization: `Bearer ${role}` } : {}), origin: "http://localhost:5173" }, body: JSON.stringify(body) });
const appel = async (role, action, extra = {}, attendu = 200) => {
  const res = await api(event(role, { action, ...extra }));
  assert.equal(res.statusCode, attendu, `${action}: ${res.body}`);
  assert.equal(res.headers["Cache-Control"], "no-store");
  return res.body ? JSON.parse(res.body) : null;
};
await test("sans jeton : 401 sans accès à la base", async () => { const n = db.appels.length; await appel(null, "moi", {}, 401); assert.equal(db.appels.length, n); });
await test("jeton invalide : 401", () => appel("invalide", "moi", {}, 401));
await test("pharmacie : 403", () => appel("pharmacie", "moi", {}, 403));
await test("user_metadata.role ignoré", () => appel("imposteur", "moi", {}, 403));
for (const role of roles) await test(`moi ${role}`, async () => { const r = await appel(role, "moi"); assert.equal(r.utilisateur.role, role); assert.equal(r.droits.marge.lire, role === "admin"); });
await test("ADMIN_EMAIL normalisé", async () => { const r = await verifierCrm(event("pharmacie", {}), { ...deps, adminEmail: " PHARMACIE@exemple.test " }); assert.equal(r.utilisateur.role, "admin"); });
await test("OPTIONS sans authentification", async () => { assert.equal((await api(event(null, {}, "OPTIONS"))).statusCode, 200); assert.equal((await verifierCrm(event(null, {}, "OPTIONS"), deps)).error.statusCode, 200); });
await test("GET refusé", async () => assert.equal((await api(event("admin", {}, "GET"))).statusCode, 405));
for (const status of [429, 500, 503]) await test(`Auth ${status} donne 503`, async () => { db.etat.authStatus = status; try { await appel("admin", "moi", {}, 503); } finally { db.etat.authStatus = 200; } });
await test("Auth JSON illisible donne 503", async () => { db.etat.authIllisible = true; try { await appel("admin", "moi", {}, 503); } finally { db.etat.authIllisible = false; } });
await test("Auth réseau en panne donne 503", async () => { db.etat.reseau = true; try { await appel("admin", "moi", {}, 503); } finally { db.etat.reseau = false; } });
await test("JSON invalide et enveloppes invalides", async () => {
  assert.equal((await api({ ...event("admin", {}), body: "{" })).statusCode, 400);
  for (const body of [null, [], {}, { action: "inconnue" }, { action: "moi", usurpation: true }]) assert.equal((await api(event("admin", body))).statusCode, 400);
});
let compte;
await test("commercial crée un prospect normalisé et journalisé", async () => {
  compte = (await appel("commercial", "comptes.creer", { donnees: { nom: "pharmacie-fictive-01", code_postal: "20200", email: "CONTACT@exemple.test", finess: "000000001" } })).donnees;
  assert.equal(compte.departement, "2B"); assert.equal(compte.email, "contact@exemple.test");
  const j = db.tables.crm_journal.at(-1); assert.equal(j.avant, null); assert.equal(j.apres.id, compte.id); assert.equal(j.acteur_id, db.users.commercial.id);
});
await test("lecture et service client ne créent pas de prospect", async () => { for (const r of ["lecture", "service_client"]) await appel(r, "comptes.creer", { donnees: { nom: "pharmacie-fictive-02" } }, 403); });
await test("commercial ne crée pas un client ni ne s'attribue un compte", async () => {
  await appel("commercial", "comptes.creer", { donnees: { nom: "pharmacie-fictive-02", statut: "client" } }, 403);
  await appel("commercial", "comptes.creer", { donnees: { nom: "pharmacie-fictive-02", commercial_email: "commercial@exemple.test" } }, 403);
});
await test("écriture conditionnelle et avant/après", async () => {
  const r = (await appel("commercial", "comptes.modifier", { id: compte.id, version: 1, donnees: { notes: "note fictive" } })).donnees;
  assert.equal(r.version, 2); assert.equal(r.statut, "prospect");
  const j = db.tables.crm_journal.at(-1); assert.equal(j.avant.version, 1); assert.equal(j.apres.version, 2);
  const n = db.tables.crm_journal.length;
  await appel("commercial", "comptes.modifier", { id: compte.id, version: 1, donnees: { notes: "périmée" } }, 409);
  assert.equal(db.tables.crm_journal.length, n);
});
await test("course entre lecture et PATCH : 409", async () => { db.etat.course = true; await appel("commercial", "comptes.modifier", { id: compte.id, version: 2, donnees: { notes: "course" } }, 409); });
await test("deux PATCH simultanés : un seul gagne", async () => {
  const v = db.tables.crm_comptes[0].version, n = db.tables.crm_journal.length;
  const rs = await Promise.all(["a", "b"].map(notes => api(event("commercial", { action: "comptes.modifier", id: compte.id, version: v, donnees: { notes } }))));
  assert.deepEqual(rs.map(r => r.statusCode).sort(), [200, 409]); assert.equal(db.tables.crm_journal.length, n + 1);
});
await test("panne du journal : écriture annulée", async () => {
  const avant = clone(db.tables.crm_comptes[0]); db.etat.auditPanne = true;
  try { await appel("admin", "comptes.modifier", { id: compte.id, version: avant.version, donnees: { notes: "non écrite" } }, 503); } finally { db.etat.auditPanne = false; }
  assert.deepEqual(db.tables.crm_comptes[0], avant);
});
await test("marge masquée dans liste et fiche pour chaque rôle", async () => {
  const ligne = db.tables.crm_comptes[0]; ligne.marge_brute = 0; ligne.detail = { marge: 0, ca: 0 };
  for (const role of roles) {
    const fiche = (await appel(role, "comptes.lire", { id: compte.id })).donnees;
    const liste = (await appel(role, "comptes.lister")).donnees.lignes[0];
    for (const r of [fiche, liste]) { assert.equal(Object.hasOwn(r, "marge_brute"), role === "admin"); assert.equal(Object.hasOwn(r.detail, "marge"), role === "admin"); }
  }
  delete ligne.marge_brute; delete ligne.detail;
});
await test("filtres comptes, tri, pagination et recherche", async () => {
  const nouveau = (await appel("admin", "comptes.creer", { donnees: { nom: "pharmacie-fictive-02", ville: "ville-fictive", cip: "0000002", code_postal: "97100" } })).donnees;
  await appel("admin", "comptes.attribuer", { id: nouveau.id, version: 1, donnees: { commercial_email: "commercial@exemple.test" } });
  for (const recherche of ["fictive-02", "ville-fictive", "0000002"]) assert.equal((await appel("lecture", "comptes.lister", { filtres: { recherche } })).donnees.total, 1);
  assert.equal((await appel("lecture", "comptes.lister", { filtres: { recherche: "000000001" } })).donnees.total, 1);
  const d = (await appel("lecture", "comptes.lister", { filtres: { departement: "971", commercial_email: "commercial@exemple.test", statut: "prospect", archive: false } })).donnees;
  assert.equal(d.total, 1);
  const p = (await appel("lecture", "comptes.lister", { filtres: { tri: "nom", sens: "asc", page: 2, limite: 1 } })).donnees;
  assert.equal(p.total, 2); assert.equal(p.lignes[0].nom, "pharmacie-fictive-02");
  await appel("admin", "comptes.lister", { filtres: { tri: "nom.desc,secret" } }, 400);
  await appel("admin", "contacts.lister", { filtres: { archive: true } }, 400);
});
let contact, activite, opportunite;
await test("service client crée et modifie un contact", async () => {
  contact = (await appel("service_client", "contacts.creer", { donnees: { compte_id: compte.id, nom: "contact-fictif" } })).donnees;
  await appel("service_client", "contacts.modifier", { id: contact.id, version: 1, donnees: { principal: true } });
  await appel("lecture", "contacts.creer", { donnees: { compte_id: compte.id, nom: "contact-fictif" } }, 403);
});
await test("activité créée avec auteur vérifié", async () => {
  activite = (await appel("service_client", "activites.creer", { donnees: { compte_id: compte.id, titre: "appel-fictif", type: "appel", contact_id: contact.id } })).donnees;
  assert.equal(activite.auteur_email, "service_client@exemple.test");
  await appel("commercial", "activites.creer", { donnees: { compte_id: compte.id, titre: "appel-fictif", type: "appel", auteur_email: "autre@exemple.test" } }, 403);
});
await test("commercial ne peut modifier ni clore l'activité d'un autre", async () => {
  await appel("commercial", "activites.modifier", { id: activite.id, version: 1, donnees: { assigne_email: "commercial@exemple.test" } }, 403);
  await appel("commercial", "activites.terminer", { id: activite.id, version: 1 }, 403);
});
await test("auteur peut assigner, assigné peut terminer", async () => {
  await appel("service_client", "activites.modifier", { id: activite.id, version: 1, donnees: { assigne_email: "commercial@exemple.test" } });
  const a = (await appel("commercial", "activites.terminer", { id: activite.id, version: 2 })).donnees;
  assert.equal(a.statut, "fait"); assert.equal(a.realise_at, maintenant().toISOString());
});
await test("opportunité propre seulement et réattribution refusée", async () => {
  opportunite = (await appel("commercial", "opportunites.creer", { donnees: { compte_id: compte.id, titre: "opportunite-fictive" } })).donnees;
  await appel("commercial", "opportunites.modifier", { id: opportunite.id, version: 1, donnees: { etape: "rdv" } });
  await appel("commercial", "opportunites.modifier", { id: opportunite.id, version: 2, donnees: { proprietaire_email: "autre@exemple.test" } }, 403);
  await appel("service_client", "opportunites.creer", { donnees: { compte_id: compte.id, titre: "opportunite-fictive" } }, 403);
  await appel("commercial", "opportunites.creer", { donnees: { compte_id: compte.id, titre: "opportunite-fictive", proprietaire_email: "autre@exemple.test" } }, 403);
});
await test("références inter-comptes refusées", async () => {
  const autre = db.tables.crm_comptes[1];
  await appel("admin", "activites.creer", { donnees: { compte_id: autre.id, titre: "appel-fictif", type: "appel", contact_id: contact.id } }, 400);
  await appel("admin", "activites.creer", { donnees: { compte_id: autre.id, titre: "appel-fictif", type: "appel", opportunite_id: opportunite.id } }, 400);
});
await test("attribution et archivage administrateur", async () => {
  let v = db.tables.crm_comptes[0].version;
  for (const r of ["commercial", "service_client", "lecture"]) {
    await appel(r, "comptes.attribuer", { id: compte.id, version: v, donnees: { commercial_email: "commercial@exemple.test" } }, 403);
    await appel(r, "comptes.archiver", { id: compte.id, version: v, donnees: { archive: true } }, 403);
  }
  await appel("admin", "comptes.attribuer", { id: compte.id, version: v++, donnees: { commercial_email: "commercial@exemple.test" } });
  await appel("admin", "comptes.archiver", { id: compte.id, version: v, donnees: { archive: true } });
  assert.equal((await appel("lecture", "comptes.lister", { filtres: { archive: true } })).donnees.total, 1);
  assert.equal((await appel("lecture", "comptes.lister")).donnees.total, 1);
});
await test("champs CRM modifiables, champs Odoo protégés", async () => {
  const c = (await appel("admin", "comptes.creer", { donnees: { nom: "pharmacie-fictive-client", statut: "client" } })).donnees;
  const row = db.tables.crm_comptes.find(r => r.id === c.id); row.odoo_id = 42;
  for (const role of ["admin", "commercial"]) {
    const version = row.version;
    await appel(role, "comptes.modifier", { id: c.id, version, donnees: { notes: "note CRM fictive", etiquettes: ["fictif"], groupement: "groupe fictif", logiciel: "logiciel fictif", email: "contact@exemple.test" } });
    for (const donnees of [{ nom: "nom interdit" }, { odoo_id: null }, { cip: "0000000" }, { siret: "00000000000000" }, { adresse: "rue fictive" }, { code_postal: "75000" }, { ville: "ville fictive" }, { telephone: "+33100000000" }, { statut: "prospect" }, { source: "saisie" }, { commercial_email: null }, { archive: false }])
      await appel(role, "comptes.modifier", { id: c.id, version: row.version, donnees }, 403);
  }
  for (const role of ["lecture", "service_client"]) await appel(role, "comptes.modifier", { id: c.id, version: row.version, donnees: { notes: "interdit" } }, 403);
  await appel("commercial", "comptes.modifier", { id: compte.id, version: db.tables.crm_comptes[0].version, donnees: { statut: "client" } }, 403);
  await appel("admin", "comptes.creer", { donnees: { nom: "pharmacie-fictive-odoo", odoo_id: 1, source: "odoo" } }, 403);
});
await test("404, UUID invalide, version manquante et doublon FINESS", async () => {
  await appel("admin", "comptes.lire", { id: randomUUID() }, 404);
  await appel("admin", "comptes.lire", { id: "invalide" }, 400);
  await appel("admin", "comptes.modifier", { id: compte.id, donnees: { notes: "fictif" } }, 400);
  await appel("admin", "comptes.creer", { donnees: { nom: "pharmacie-fictive-doublon", finess: "000000001" } }, 409);
});
for (const r of ["contacts", "activites", "opportunites"]) for (const role of roles) await test(`liste ${r} accessible ${role}`, () => appel(role, `${r}.lister`, { filtres: { compte_id: compte.id } }));
for (const role of ["commercial", "service_client", "lecture"]) await test(`administration refusée ${role}`, async () => {
  for (const action of ["equipe.lister", "equipe.enregistrer", "reglages.lire", "reglages.enregistrer", "journal.lister"]) await appel(role, action, {}, 403);
});
await test("réglages singleton versionnés", async () => {
  assert.equal((await appel("admin", "reglages.lire")).donnees, null);
  const r = (await appel("admin", "reglages.enregistrer", { donnees: { seuils: { fictif: 0 }, cibles_indicateurs: {
    fond_de_rayon: 1, specialites_cheres: 2, glp1: 3, seuil_demande_isolee: 4, origine: "cibles fictives",
  }, territoire_indicateurs: ["75", "2A", "971"] } })).donnees;
  assert.equal(r.cibles_indicateurs.glp1, 3);
  await appel("admin", "reglages.enregistrer", { id: r.id, version: 1, donnees: { jalons: { "2026-12-01": 0 } } });
  await appel("admin", "reglages.enregistrer", { id: r.id, version: 1, donnees: { seuils: {} } }, 409);
  await appel("admin", "reglages.enregistrer", { donnees: {} }, 409);
});
let membre;
await test("équipe écrit app_metadata.role et conserve les autres métadonnées", async () => {
  membre = (await appel("admin", "equipe.enregistrer", { donnees: { utilisateur_id: db.users.autre.id, email: db.users.autre.email, nom_affiche: "membre-fictif", role: "lecture", territoires: ["2A", "971"] } })).donnees;
  assert.equal(db.users.autre.app_metadata.role, "lecture"); assert.equal(db.users.autre.app_metadata.autre, "conserve");
  await appel("admin", "equipe.enregistrer", { id: membre.id, version: 1, donnees: { role: "commercial" } });
  assert.equal(db.users.autre.app_metadata.role, "commercial");
  await appel("admin", "equipe.lister");
});
await test("équipe version périmée n'appelle pas PUT Auth", async () => {
  const n = db.appels.filter(a => a.method === "PUT").length;
  await appel("admin", "equipe.enregistrer", { id: membre.id, version: 1, donnees: { role: "admin" } }, 409);
  assert.equal(db.appels.filter(a => a.method === "PUT").length, n);
});
await test("compensation Auth si écriture SQL échoue", async () => {
  db.etat.auditPanne = true;
  try { await appel("admin", "equipe.enregistrer", { id: membre.id, version: 2, donnees: { role: "admin" } }, 503); } finally { db.etat.auditPanne = false; }
  assert.equal(db.users.autre.app_metadata.role, "commercial"); assert.equal(db.tables.crm_equipe[0].role, "commercial");
});
await test("panne administration Auth ne modifie pas l'équipe", async () => {
  db.etat.adminPanne = true;
  try { await appel("admin", "equipe.enregistrer", { id: membre.id, version: 2, donnees: { role: "admin" } }, 503); } finally { db.etat.adminPanne = false; }
  assert.equal(db.tables.crm_equipe[0].version, 2);
});
await test("équipe concurrente : le rôle gagnant est conservé", async () => {
  const rs = await Promise.all(["lecture", "admin"].map(role => api(event("admin", {
    action: "equipe.enregistrer", id: membre.id, version: 2, donnees: { role },
  }))));
  assert.deepEqual(rs.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(db.users.autre.app_metadata.role, db.tables.crm_equipe[0].role);
});
await test("journal réservé et filtrable", async () => {
  const j = (await appel("admin", "journal.lister", { filtres: { objet: "comptes", objet_id: compte.id } })).donnees;
  assert.ok(j.total >= 4); assert.ok(j.lignes.every(r => r.objet_id === compte.id));
});
await test("base en panne : 503", async () => { db.etat.basePanne = true; try { await appel("admin", "comptes.lister", {}, 503); } finally { db.etat.basePanne = false; } });
await test("stock sans configuration : 503", async () => { await assert.rejects(creerStockCrm({ ...deps, cle: "" }).lister("comptes"), e => e.status === 503); });
await test("stock refuse modification directe du journal", async () => { await assert.rejects(stock.modifier("journal", randomUUID(), 1, {}, db.users.admin), e => e.status === 403); });
for (const role of [...roles, "pharmacie", "imposteur"]) await test(`login ${role}`, async () => {
  const res = await login(event(null, { email: db.users[role].email.toUpperCase(), password: "mot-de-passe-fictif" }));
  assert.equal(res.statusCode, roles.includes(role) ? 200 : 403); assert.equal(res.headers["Cache-Control"], "no-store");
  if (roles.includes(role)) assert.equal(JSON.parse(res.body).role, role); else assert.equal(JSON.parse(res.body).token, undefined);
});
await test("login panne Auth", async () => { db.etat.authStatus = 503; try { assert.equal((await login(event(null, { email: db.users.admin.email, password: "mot-de-passe-fictif" }))).statusCode, 503); } finally { db.etat.authStatus = 200; } });
await test("login invalide et prévol", async () => {
  assert.equal((await login(event(null, { email: db.users.admin.email, password: "incorrect" }))).statusCode, 401);
  assert.equal((await login(event(null, { email: "invalide" }))).statusCode, 400);
  assert.equal((await login(event(null, {}, "OPTIONS"))).statusCode, 200);
});
await test("limitation API et login : 429, CORS, no-store", async () => {
  const rateLimit = () => ({ statusCode: 429, headers: { "Retry-After": "60" }, body: "{}" });
  for (const h of [creerHandlerCrm({ ...deps, rateLimit }), creerHandlerLogin({ ...deps, rateLimit })]) {
    const res = await h(event("admin", { action: "moi" })); assert.equal(res.statusCode, 429); assert.equal(res.headers["Cache-Control"], "no-store"); assert.ok(res.headers["Access-Control-Allow-Origin"]);
  }
});
await test("indicateurs compte et global : historique et marge selon rôle", async () => {
  const c = db.tables.crm_comptes.find(c => c.odoo_id === 42);
  for (const odoo_id of [0, 42]) for (const periode_fin of ["2026-11-20", "2026-11-21"]) db.tables.crm_indicateurs.push({ odoo_id, periode_fin,
    donnees: { ca: 100, prev: 50, profil: "D – Occasionnelle", action: "action fictive", ns_fond: 2, ns_cher: 3, ns_glp: 4, marge: 0, marge_taux: 0, ca_avec_cout: 0 } });
  db.tables.crm_synchros.push({ id: randomUUID(), debut: "2026-11-22T03:30:00Z", statut: "termine", compteurs: {} });
  for (const role of roles) for (const action of ["indicateurs.compte", "indicateurs.global"]) {
    const d = (await appel(role, action, { id: c.id })).donnees;
    assert.equal(d.dernier.periode_fin, "2026-11-21"); assert.equal(d.historique.length, 2);
    for (const i of [d.dernier, ...d.historique]) assert.equal(Object.hasOwn(i.donnees, "marge"), role === "admin");
  }
  for (const role of roles) assert.equal((await appel(role, "indicateurs.etat")).donnees.statut, "termine");
  await appel("pharmacie", "indicateurs.global", {}, 403);
  assert.equal((await appel("admin", "indicateurs.compte", { id: compte.id })).donnees.dernier, null);
  await appel("admin", "indicateurs.compte", { id: randomUUID() }, 404);
});
await test("filtres et tri par dernier indicateur avant pagination", async () => {
  const d = (await appel("commercial", "comptes.lister", { filtres: { ca_min: 90, ca_max: 110, evolution_min: 99, evolution_max: 101, non_servi_min: 8, non_servi_max: 10,
    profil: "D – Occasionnelle", action_proposee: "action fictive", tri: "ca", limite: 1 } })).donnees;
  assert.equal(d.total, 1); assert.equal(d.lignes[0].odoo_id, 42); assert.equal(Object.hasOwn(d.lignes[0].indicateurs, "marge"), false);
  assert.equal((await appel("admin", "comptes.lister", { filtres: { ca_min: 101 } })).donnees.total, 0);
});
await test("relance réservée à admin, secret transmis au background", async () => {
  await appel("admin", "indicateurs.relancer", {}, 202);
  for (const role of ["commercial", "service_client", "lecture"]) await appel(role, "indicateurs.relancer", {}, 403);
  const res = await creerHandlerCrm({ ...deps, cronSecret: "" })(event("admin", { action: "indicateurs.relancer" }));
  assert.equal(res.statusCode, 503);
});
await test("colonnes écrites présentes dans le SQL", () => {
  const sql = readFileSync(new URL("../sql/crm-schema.sql", import.meta.url), "utf8");
  for (const a of db.appels.filter(a => a.body && a.url.includes("/rest/v1/"))) {
    const table = new URL(a.url).pathname.split("/").at(-1);
    const bloc = sql.split(`create table if not exists public.${table} (`)[1]?.split("\n);")[0];
    assert.ok(bloc, table);
    for (const k of Object.keys(a.body)) assert.match(bloc, new RegExp(`\\b${k}\\s`), `${table}.${k}`);
  }
});
await test("commandes : CIP du compte, 50 dernières, résumé seul, quatre rôles", async () => {
  const c = db.tables.crm_comptes[0]; c.cip = "9900001";
  db.tables.elixir_orders = Array.from({ length: 55 }, (_, n) => ({ id:String(n).padStart(3,"0"), date:`2026-11-${String(n % 22 + 1).padStart(2,"0")}`, pharmacy_cip:c.cip, total_ht:111+n, nb_lignes:2, processed:false, source:"site", items:[{ marge:99 }], marge:99 }));
  db.tables.elixir_orders.push({ id:"autre", pharmacy_cip:"9900002", date:"2026-11-22" });
  for (const role of roles) {
    const d = (await appel(role,"comptes.commandes",{ id:c.id })).donnees;
    assert.equal(d.length,50); assert.ok(d.every(r => !Object.hasOwn(r,"items") && !Object.hasOwn(r,"marge") && r.id !== "autre"));
    assert.ok(d.every((r,j) => j === 0 || d[j-1].date >= r.date));
  }
  await appel("lecture","comptes.commandes",{ id:randomUUID() },404);
  await appel(null,"comptes.commandes",{ id:c.id },401);
  await appel("pharmacie","comptes.commandes",{ id:c.id },403);
  const q = new URL(db.appels.filter(a => a.url.includes("elixir_orders")).at(-1).url).searchParams;
  assert.equal(q.get("pharmacy_cip"),`eq.${c.cip}`); assert.equal(q.get("limit"),"50"); assert.ok(!q.get("select").includes("items"));
  db.etat.basePanne = true; try { await appel("admin","comptes.commandes",{ id:c.id },503); } finally { db.etat.basePanne = false; }
});
await test("factures : parent commercial et enfants, société 2, validées, 12 mois, pages et aucune marge", async () => {
  const c = db.tables.crm_comptes.find(c => c.odoo_id === 42), appels = [];
  const documents = creerHandlerCrm({ ...deps, odoo:async (model,method,args,kw) => {
    appels.push({ model,method,args,kw });
    return Array.from({ length:kw.offset === 0 ? 500 : 1 },(_,n) => ({ id:kw.offset+n,name:"FACT-FICTIVE",invoice_date:"2026-11-01",move_type:n ? "out_invoice" : "out_refund",amount_untaxed:123,is_move_sent:true,marge:999 }));
  } });
  for (const role of roles) {
    const r = await documents(event(role,{ action:"comptes.factures",id:c.id })); assert.equal(r.statusCode,200);
    const d = JSON.parse(r.body).donnees; assert.equal(d.length,501); assert.equal(d[0].montant_ht,-123); assert.equal(d[1].montant_ht,123); assert.equal(d[0].envoye,true); assert.ok(!r.body.includes("marge"));
  }
  const a = appels[0]; assert.equal(a.model,"account.move"); assert.equal(a.method,"search_read");
  for (const clause of [["company_id","=",2],["state","=","posted"],["partner_id.commercial_partner_id","=",42],["invoice_date",">=","2025-11-22"],["invoice_date","<=","2026-11-22"],["move_type","in",["out_invoice","out_refund"]]]) assert.ok(a.args[0].some(c => JSON.stringify(c) === JSON.stringify(clause)));
  assert.deepEqual(a.kw.context,{ allowed_company_ids:[2] }); assert.ok(!a.kw.fields.includes("marge")); assert.equal(appels[1].kw.offset,500);
  const prospect = db.tables.crm_comptes.find(c => !c.odoo_id), n = appels.length;
  assert.deepEqual(JSON.parse((await documents(event("lecture",{ action:"comptes.factures",id:prospect.id }))).body).donnees,[]); assert.equal(appels.length,n);
  const panne = creerHandlerCrm({ ...deps,odoo:async () => { throw new Error("Panne fictive"); } });
  assert.equal((await panne(event("admin",{ action:"comptes.factures",id:c.id }))).statusCode,503);
});
await test("tri dernière activité avant pagination et activité réalisée", async () => {
  const cs = db.tables.crm_comptes.slice(0,2); cs.forEach(c => { c.archive = false; });
  const dates = ["2028-01-01T10:00:00Z","2029-01-01T10:00:00Z"];
  cs.forEach((c,j) => db.tables.crm_activites.push({ id:randomUUID(),compte_id:c.id,created_at:"2026-01-01T10:00:00Z",realise_at:dates[j] }));
  const d = (await appel("lecture","comptes.lister",{ filtres:{ tri:"derniere_activite",sens:"desc",limite:1,page:1 } })).donnees;
  assert.equal(d.lignes[0].id,cs[1].id); assert.equal(d.lignes[0].derniere_activite,dates[1]);
  assert.equal((await appel("lecture","comptes.lister",{ filtres:{ tri:"derniere_activite",sens:"desc",limite:1,page:2 } })).donnees.lignes[0].id,cs[0].id);
});
await test("équipe chercher : admin seul, validation avant lecture Auth", async () => {
  let lectures=0;
  const h=creerHandlerCrm({ ...deps,fetch:async (url,opts) => {
    if(new URL(url).pathname==="/auth/v1/admin/users"){lectures++;return json({users:[]});}
    return db.fetch(url,opts);
  } });
  for(const role of [null,"pharmacie","commercial","service_client","lecture"]){
    const r=await h(event(role,{action:"equipe.chercher",donnees:{email:"nouveau@exemple.test"}}));assert.equal(r.statusCode,role?403:401);
  }
  assert.equal(lectures,0);
  for(const donnees of [{},{email:"invalide"},{email:"nouveau@exemple.test",role:"admin"}])assert.equal((await h(event("admin",{action:"equipe.chercher",donnees}))).statusCode,400);
  assert.equal(lectures,0);
});
await test("équipe chercher : e-mail exact normalisé, pagination, réponse minimale", async () => {
  const cible={id:randomUUID(),email:"NOUVEAU@exemple.test",app_metadata:{role:"lecture",secret:"fictif"},user_metadata:{note:"fictive"}},pages=[];
  const h=creerHandlerCrm({ ...deps,fetch:async (url,opts) => {
    const u=new URL(url);if(u.pathname!=="/auth/v1/admin/users")return db.fetch(url,opts);
    assert.equal(opts.headers.apikey,deps.cle);assert.equal(opts.headers.Authorization,`Bearer ${deps.cle}`);
    assert.equal(u.searchParams.get("per_page"),"1000");const p=Number(u.searchParams.get("page"));pages.push(p);
    return json({users:p===1?[{id:randomUUID(),email:"autre-nouveau@exemple.test"}]:[cible],last_page:2});
  } });
  const r=await h(event("admin",{action:"equipe.chercher",donnees:{email:" NOUVEAU@exemple.test "}}));assert.equal(r.statusCode,200);
  assert.deepEqual(pages,[1,2]);assert.deepEqual(JSON.parse(r.body),{donnees:{utilisateur_id:cible.id,email:"nouveau@exemple.test"}});
  assert.equal(r.headers["Cache-Control"],"no-store");
  pages.length=0;assert.equal((await h(event("admin",{action:"equipe.chercher",donnees:{email:"absent@exemple.test"}}))).statusCode,404);assert.deepEqual(pages,[1,2]);
});
await test("équipe chercher : pages pleines sans métadonnées, pannes et réponse malformée", async () => {
  let pages=0;
  const h=creerHandlerCrm({...deps,fetch:async(url,opts)=>{
    if(new URL(url).pathname!=="/auth/v1/admin/users")return db.fetch(url,opts);
    pages++;return json({users:pages===1?Array.from({length:1000},(_,n)=>({id:randomUUID(),email:`membre-fictif-${n}@exemple.test`})) : []});
  }});
  assert.equal((await h(event("admin",{action:"equipe.chercher",donnees:{email:"absent@exemple.test"}}))).statusCode,404);assert.equal(pages,2);
  for(const repondre of [()=>json({},503),()=>json({users:null}),()=>{throw new Error("Panne fictive");}]){
    const panne=creerHandlerCrm({...deps,fetch:(url,opts)=>new URL(url).pathname==="/auth/v1/admin/users"?repondre():db.fetch(url,opts)});
    assert.equal((await panne(event("admin",{action:"equipe.chercher",donnees:{email:"absent@exemple.test"}}))).statusCode,503);
  }
});
await test("opportunité perdue : motif obligatoire sur création et état fusionné", async () => {
  const compte_id=db.tables.crm_comptes[0].id;
  for(const motif_perte of [undefined,null,"   "])await appel("commercial","opportunites.creer",{donnees:{compte_id,titre:"Projet fictif perdu",etape:"perdue",motif_perte}},400);
  let o=(await appel("commercial","opportunites.creer",{donnees:{compte_id,titre:"Projet fictif",etape:"proposition",probabilite:35,montant_mensuel_estime:123}})).donnees;
  await appel("commercial","opportunites.modifier",{id:o.id,version:o.version,donnees:{etape:"perdue"}},400);
  o=(await appel("commercial","opportunites.modifier",{id:o.id,version:o.version,donnees:{etape:"perdue",motif_perte:"Projet fictif reporté"}})).donnees;
  await appel("commercial","opportunites.modifier",{id:o.id,version:o.version,donnees:{motif_perte:null}},400);
  o=(await appel("commercial","opportunites.modifier",{id:o.id,version:o.version,donnees:{titre:"Projet fictif clôturé"}})).donnees;
  assert.equal(o.motif_perte,"Projet fictif reporté");
  await appel("lecture","opportunites.modifier",{id:o.id,version:o.version,donnees:{etape:"gagnee"}},403);
});
await test("objectif du tableau de bord : projection seule pour tous les rôles", async () => {
  const r=db.tables.crm_reglages[0];r.objectif_mensuel_global=12345;r.seuils={interne:999};r.cibles_indicateurs={origine:"réglage privé fictif"};
  for(const role of roles){
    const d=(await appel(role,"indicateurs.global")).donnees;assert.equal(d.objectif_mensuel_global,12345);assert.ok(!JSON.stringify(d).includes("réglage privé fictif"));assert.ok(!Object.hasOwn(d,"seuils"));
    if(role!=="admin")await appel(role,"reglages.lire",{},403);
  }
});
await test("Rôle CRM explicite prioritaire sur ADMIN_EMAIL, également à la connexion", async () => {
  for (const role of roles) {
    const d={...deps,adminEmail:db.users[role].email};
    assert.equal((await verifierCrm(event(role,{}),d)).utilisateur.role,role);
    const connexion=await creerHandlerLogin(d)(event(null,{email:db.users[role].email,password:"mot-de-passe-fictif"}));
    assert.equal(JSON.parse(connexion.body).role,role);
  }
});

await test("synthèses et listes enrichies : quatre rôles, marge admin seulement, accès anonyme refusé", async () => {
  const {creerBancCrm}=await import('./banc/crm-banc.mjs');
  const b=await creerBancCrm({date:maintenant(),volume:'grand'});
  const requete=async(role,action,filtres={})=>{
    const r=await b.repondre({fn:'crm',corps:{action,filtres},entetes:role?{authorization:`Bearer crm-banc-${role}`}:{}});
    return {status:r.statut,...JSON.parse(r.texte)};
  };
  for(const role of ['admin','commercial','service','lecture']){
    for(const action of ['tableau.synthese','accueil.synthese','contacts.lister','activites.lister','opportunites.lister']){
      const r=await requete(role,action);assert.equal(r.status,200);
      if(action==='tableau.synthese')assert.equal(JSON.stringify(r).includes('"marge"'),role==='admin');
    }
  }
  for(const role of [null,'nouveau']) for(const action of ['tableau.synthese','accueil.synthese']){
    assert.equal((await requete(role,action)).status,role?403:401);
  }
  for(const role of ['commercial','service','lecture']){
    const a=(await requete(role,'accueil.synthese')).donnees;
    for(const groupe of Object.values(a.taches))assert.ok(groupe.lignes.every(l=>l.assigne_email===b.utilisateurs[role].email));
  }
  const contacts=(await requete('admin','contacts.lister',{recherche:'grand 79',tri:'nom',sens:'asc',limite:25})).donnees;
  assert.equal(contacts.lignes.length,25);assert.ok(contacts.total>25);
  assert.ok(contacts.lignes.every(c=>c.nom.includes('grand 79')||c.compte_nom.includes('grand 79')));
  const parCompte=(await requete('admin','contacts.lister',{recherche:'Pharmacie fictive grand 2999',tri:'compte'})).donnees;
  assert.ok(parCompte.total>0);assert.ok(parCompte.lignes.every(c=>c.compte_nom==='Pharmacie fictive grand 2999'));
  b.tables.crm_contacts[0].fonction='preparateur';
  const parFonction=(await requete('admin','contacts.lister',{recherche:'Préparateur'})).donnees;
  assert.equal(parFonction.total,1);assert.equal(parFonction.lignes[0].fonction,'preparateur');
  const page2=(await requete('admin','contacts.lister',{recherche:'grand 79',tri:'nom',sens:'asc',limite:25,page:2})).donnees;
  assert.ok(page2.lignes.every(c=>!contacts.lignes.some(p=>p.id===c.id)));
  const filtres={type:'tache',statut:'a_faire',assigne_email:'commercial@banc.test',retard:true,recherche:'démonstration'};
  const a=(await requete('admin','activites.lister',filtres)).donnees;
  assert.ok(a.total>0);
  assert.ok(a.lignes.every(a=>a.type==='tache'&&a.statut==='a_faire'&&a.assigne_email===filtres.assigne_email&&a.echeance<maintenant().toISOString()));
  for(const f of [{echeance_debut:'2026-02-30'},{page:0},{limite:1001},{vue_tableau:true}]){
    assert.equal((await requete('admin','activites.lister',f)).status,400);
  }
});
await test("agenda : bornes de semaine en heure de Paris, changements d’heure et échéance absente", async () => {
  const {creerBancCrm}=await import('./banc/crm-banc.mjs');
  const {minuitParis}=await import('../netlify/functions/_crm-synthese.js');
  assert.equal(minuitParis('2026-03-23'),'2026-03-22T23:00:00.000Z');
  assert.equal(minuitParis('2026-03-29',1),'2026-03-29T22:00:00.000Z');
  assert.equal(minuitParis('2026-10-25',1),'2026-10-25T23:00:00.000Z');
  const b=await creerBancCrm({date:maintenant()});
  const base=b.tables.crm_activites[0];
  b.tables.crm_activites=[null,'2026-03-22T22:59:59Z','2026-03-22T23:00:00Z','2026-03-29T21:59:59Z','2026-03-29T22:00:00Z'].map(echeance=>({...base,id:randomUUID(),echeance}));
  const r=await b.repondre({fn:'crm',entetes:{authorization:'Bearer crm-banc-lecture'},corps:{action:'activites.lister',filtres:{echeance_debut:'2026-03-23',echeance_fin:'2026-03-29'}}});
  assert.equal(r.statut,200);assert.deepEqual(JSON.parse(r.texte).donnees.lignes.map(a=>a.echeance).sort(),['2026-03-22T23:00:00Z','2026-03-29T21:59:59Z']);
});
console.log(`CRM API : ${ok} ok, ${ko} ko`);
// rate-limit.js possède un intervalle de ménage ; quitter après toutes les assertions.
process.exit(ko ? 1 : 0);
