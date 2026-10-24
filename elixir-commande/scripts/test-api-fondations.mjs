// Tests de l'API des pharmacies, phase 1 « fondations » : node scripts/test-api-fondations.mjs
// Hors ligne : faux PostgREST en mémoire (tables api_*, fonctions api_compter / api_lire_compteur, clé serveur exigée),
// fausse vérification de fiche Odoo, fausse identité (Assistant), faux admin. Aucun appel réseau, aucune donnée réelle :
// pharmacies, CIP et adresses fictifs ; les clés sont fabriquées à l'exécution (aucune clé complète dans ce fichier).
//  • clés : format, somme de contrôle (CRC32), empreinte, préfixe d'affichage, base62 sans biais, réseaux et CIDR ;
//  • réglages : interrupteur « Commandes par API » fermé tant que les prérequis ne sont pas cochés (P3 pas avant le 02/11) ;
//  • routeur /api/v1 : ordre des contrôles (débit IP avant toute lecture, clé, accès, portée, débit par clé, route,
//    journal), problem+json, X-Request-Id, aucune en-tête CORS, clé dans l'adresse, révocation, rotation, aperçu ;
//  • compte de la pharmacie : CGU (preuve), clés test puis production, rotation, révocation, lecture seule (admin, adresse) ;
//  • admin : prérequis, « Tout couper », ouverture d'accès (fiche revérifiée), réglages bornés, clé « sans compte » tracée ;
//  • fichiers : _redirects (route avant « /* »), SQL (RLS, aucune policy, revoke), chargement à la demande des écrans.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
process.env.CRON_SECRET = "secret-cron-test";
process.env.ODOO_URL = "https://odoo.test";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const cles = await import("../netlify/functions/_api-cles.js");
const conf = await import("../netlify/functions/_api-config.js");
const http = await import("../netlify/functions/_api-http.js");
const { creerStockApi } = await import("../netlify/functions/_api-stock.js");
const { fauxPostgrestApi } = await import("./api-faux.mjs");
const { capturer } = await import("./api-capture.mjs");
const routeur = await import("../netlify/functions/api-v1.js");
const compte = await import("../netlify/functions/api-compte.js");
const admin = await import("../netlify/functions/api-admin.js");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

let T = Date.parse("2026-10-26T09:00:00Z");
const maintenant = () => new Date(T);
const avancer = (s) => { T += s * 1000; };

const db = fauxPostgrestApi({ horloge: () => T });
const stock = creerStockApi({ fetch: db.fetch, maintenant });

// ── Fausses fiches Odoo (vérification ficheVerifiee) ──
const FICHES = {
  595: { id: 595, name: "PHARMACIE  EXEMPLE", city: "Exempleville", cip: "2000001", company_id: [2, "Elixir"] },
  777: { id: 777, name: "PHARMACIE AUTRE", city: "Ailleurs", cip: "2000002", company_id: [2, "Elixir"] },
  888: { id: 888, name: "PHARMACIE BLOQUEE", city: "Ailleurs", cip: false, company_id: [2, "Elixir"] },
};
const odooEtat = { panne: false, appels: 0, fiches: { ...FICHES } };
const verifierFiche = async (id) => { odooEtat.appels++; if (odooEtat.panne) throw new Error("Odoo injoignable"); return odooEtat.fiches[id] || null; };
const silence = () => {};

// requête sur le routeur
const IP_A = "203.0.113.9";
// (capturer : transparent, sauf pour scripts/test-api-openapi.mjs qui confronte les réponses à docs/api/openapi.yaml)
const requete = (h, { path = "/api/v1/etat", methode = "GET", cle = null, ip = IP_A, host = "elixir-commande.expepharma.com", query = null, body = undefined, entetes = {} } = {}) => {
  const event = { httpMethod: methode, path, headers: { host, "x-nf-client-connection-ip": ip, ...(cle ? { authorization: `Bearer ${cle}` } : {}), ...entetes },
    queryStringParameters: query, body };
  return capturer(event, h(event));
};
const corps = (r) => JSON.parse(r.body);
const nouveauRouteur = (extra = {}) => routeur.creerHandler({ stock, maintenant, verifierFiche, log: silence, hasard: () => 0.5, ...extra });

// ═══ 1. Clés ═══
{
  eq("crc32 de référence", cles.crc32("123456789"), 0xcbf43926);
  const k = cles.genererCle("live");
  vrai("format live", /^elx_live_[0-9A-Za-z]{40}_[0-9A-Za-z]{6}$/.test(k));
  eq("longueur", k.length, 56);
  eq("analyse", cles.analyserCle(k), { environnement: "live" });
  eq("analyse test", cles.analyserCle(cles.genererCle("test")), { environnement: "test" });
  const i = 20, autre = k[i] === "A" ? "B" : "A";
  eq("un caractère changé : somme de contrôle fausse", cles.analyserCle(k.slice(0, i) + autre + k.slice(i + 1)), null);
  eq("préfixe inconnu", cles.analyserCle(k.replace("elx_live_", "elx_prod_")), null);
  eq("vide", cles.analyserCle(""), null);
  vrai("préfixe d'affichage", new RegExp(`^elx_live_${k.slice(9, 13)}…${k.slice(-4)}$`).test(cles.prefixeCle(k)));
  vrai("empreinte sha256 hex", /^[0-9a-f]{64}$/.test(cles.empreinteCle(k)));
  eq("empreinte stable", cles.empreinteCle(k), crypto.createHash("sha256").update(k).digest("hex"));
  const lot = new Set(Array.from({ length: 300 }, () => cles.genererCle("test")));
  eq("300 clés distinctes", lot.size, 300);
  // base62 sans biais : octets ≥ 248 écartés
  let n = 0;
  const octets = (m) => Buffer.from(Array.from({ length: m }, () => (n++ % 2 ? 255 : 61)));
  vrai("octets ≥ 248 écartés", /^elx_test_z{40}_/.test(cles.genererCle("test", octets)));
  let erreur = null;
  try { cles.genererCle("prod"); } catch (e) { erreur = e.message; }
  eq("environnement inconnu refusé", erreur, "environnement inconnu");
  eq("Bearer", cles.cleDeRequete({ headers: { authorization: `Bearer ${k}` } }), k);
  eq("Bearer (majuscule)", cles.cleDeRequete({ headers: { Authorization: `bearer ${k}` } }), k);
  eq("autre schéma : invalide", cles.analyserCle(cles.cleDeRequete({ headers: { authorization: `Basic ${k}` } })), null);
  eq("absente", cles.cleDeRequete({ headers: {} }), "");
  // réseaux
  eq("réseau IPv4 /24", cles.reseauDe("203.0.113.77"), "203.0.113.0/24");
  eq("réseau IPv6 /64", cles.reseauDe("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  eq("réseau IPv4 en IPv6", cles.reseauDe("::ffff:198.51.100.4"), "198.51.100.0/24");
  eq("CIDR v6", cles.cidrValide("2001:DB8::/32"), "2001:db8::/32");
  eq("adresse seule", cles.cidrValide("203.0.113.10"), "203.0.113.10/32");
  for (const x of ["300.1.1.1", "10.0.0.0/4", "2001:db8::/8", "abc", "1.2.3.4/33", "1:2:3:4:5:6:7:8:9", "1.2.3.4/24/1"]) eq(`CIDR refusé : ${x}`, cles.cidrValide(x), null);
  vrai("IPv4 dans /24", cles.ipDansListe("203.0.113.200", ["203.0.113.0/24"]));
  vrai("IPv4 hors /24", !cles.ipDansListe("203.0.114.1", ["203.0.113.0/24"]));
  vrai("IPv6 dans /32", cles.ipDansListe("2001:db8:ffff::1", ["2001:db8::/32"]));
  vrai("IPv6 hors /32", !cles.ipDansListe("2001:db9::1", ["2001:db8::/32"]));
  vrai("IPv4 ≠ IPv6", !cles.ipDansListe("203.0.113.1", ["2001:db8::/32"]));
  vrai("adresse exacte", cles.ipDansListe("198.51.100.4", ["198.51.100.4/32"]));
  // états
  const now = maintenant();
  eq("active", cles.etatCle({}, now), "active");
  eq("remplacée", cles.etatCle({ expire_le: new Date(T + 1000).toISOString() }, now), "remplacee");
  eq("expirée", cles.etatCle({ expire_le: new Date(T - 1000).toISOString() }, now), "expiree");
  eq("révoquée", cles.etatCle({ revoquee_le: new Date(T).toISOString(), expire_le: new Date(T + 1e6).toISOString() }, now), "revoquee");
  // création possible ?
  const acc = { odoo_id: 1, actif: true, portees: ["lecture", "commande"], cgu_version: conf.CGU.version, test_valide_le: null };
  const base = { acces: acc, environnement: "test", libelle: "Outil", portees: ["lecture"], maintenant: now };
  eq("création ok", cles.refusCreation(base), null);
  eq("accès absent", cles.refusCreation({ ...base, acces: null })?.code, "acces_ferme");
  eq("accès suspendu", cles.refusCreation({ ...base, acces: { ...acc, actif: false } })?.code, "acces_ferme");
  eq("CGU d'une autre version", cles.refusCreation({ ...base, acces: { ...acc, cgu_version: "ancienne" } })?.code, "cgu_a_accepter");
  eq("production avant le test", cles.refusCreation({ ...base, environnement: "live" })?.code, "test_requis");
  eq("production après le test", cles.refusCreation({ ...base, environnement: "live", acces: { ...acc, test_valide_le: "2026-10-01T00:00:00Z" } }), null);
  eq("libellé vide", cles.refusCreation({ ...base, libelle: "  " })?.code, "libelle");
  eq("libellé trop long", cles.refusCreation({ ...base, libelle: "x".repeat(61) })?.code, "libelle");
  eq("droit inconnu", cles.refusCreation({ ...base, portees: ["admin"] })?.code, "portees");
  eq("droit non ouvert", cles.refusCreation({ ...base, acces: { ...acc, portees: ["lecture"] }, portees: ["commande"] })?.code, "portees");
  const trois = [1, 2, 3].map(j => ({ id: `k${j}`, environnement: "test" }));
  eq("3 clés actives : refus", cles.refusCreation({ ...base, cles: trois })?.code, "trop_de_cles");
  eq("3 clés actives, autre environnement : ok", cles.refusCreation({ ...base, cles: trois.map(c => ({ ...c, environnement: "live" })) }), null);
  eq("rotation à 3 clés : ok", cles.refusCreation({ ...base, cles: trois, remplace: "k1" }), null);
  eq("clé révoquée non comptée", cles.refusCreation({ ...base, cles: [...trois.slice(0, 2), { id: "k3", environnement: "test", revoquee_le: "2026-10-01T00:00:00Z" }] }), null);
}

// ═══ 2. Réglages et prérequis ═══
{
  const d = conf.fusionnerReglages("{}");
  eq("défauts : API en service, commandes réelles fermées", [d.actif, d.commandes_live], [true, false]);
  eq("JSON illisible : défauts", conf.fusionnerReglages("{oups").commandes_live, false);
  const avant = new Date("2026-11-01T22:59:00Z"), apres = new Date("2026-11-01T23:00:00Z");   // minuit à Paris le 02/11
  const tous = { commandes_live: true, prerequis: Object.fromEntries(conf.PREREQUIS.map(p => [p.id, { fait: true }])) };
  eq("rien de coché", conf.commandesOuvrables({}, apres).manquants, ["P1", "P3", "P4", "P7"]);
  eq("P3 pas cochable avant le 02/11 (Paris)", conf.prerequisEtat({}, avant).find(p => p.id === "P3").cochable, false);
  eq("P3 cochable le 02/11 à minuit (Paris)", conf.prerequisEtat({}, apres).find(p => p.id === "P3").cochable, true);
  eq("tout coché mais avant la date : fermé", conf.commandesOuvrables(tous, avant), { ok: false, manquants: ["P3"] });
  eq("tout coché à la date : ouvrable", conf.commandesOuvrables(tous, apres).ok, true);
  eq("interrupteur ouvert + prérequis : commandes réelles", conf.commandesLiveOuvertes(tous, apres), true);
  eq("interrupteur fermé : non", conf.commandesLiveOuvertes({ ...tous, commandes_live: false }, apres), false);
  eq("une case décochée : non", conf.commandesLiveOuvertes({ ...tous, prerequis: { ...tous.prerequis, P4: { fait: false } } }, apres), false);
  eq("CGU : empreinte stable", conf.empreinteCgu(), conf.empreinteCgu());
  vrai("textes vus par les pharmacies sans plomberie interne", !/supabase|odoo|pharmaml|relais|infosoft|\bmac\b/i.test(JSON.stringify([conf.CGU, http.CODES, conf.MENTION_PRIX, conf.LIBELLES_PORTEES])));
  eq("codes : statuts du contrat", ["cle_absente", "portee_insuffisante", "introuvable", "requete_en_cours", "trop_long", "requete_invalide", "debit", "api_suspendue"].map(c => http.CODES[c][0]),
    [401, 403, 404, 409, 413, 422, 429, 503]);
  eq("isoParis hiver", http.isoParis("2026-11-16T08:30:12Z"), "2026-11-16T09:30:12+01:00");
  eq("isoParis été", http.isoParis("2026-07-16T08:30:12Z"), "2026-07-16T10:30:12+02:00");
  eq("chemins", ["/api/v1/etat", "/.netlify/functions/api-v1/etat", "/.netlify/functions/api-v1/v1/etat", "/api/v1/etat/", "/api/v1/commandes/123"].map(p => routeur.cheminDe({ path: p })),
    ["/v1/etat", "/v1/etat", "/v1/etat", "/v1/etat", "/v1/commandes/123"]);
}

// ── Mise en place : accès ouvert pour la fiche 595, CGU acceptées ; clés de test et de production ──
await stock.acces.creer({ odoo_id: 595, nom: "PHARMACIE EXEMPLE", cip: "2000001", ville: "Exempleville", ouvert_par: "equipe@elixir.test" });
await stock.acces.modifier(595, { cgu_version: conf.CGU.version, cgu_acceptees_le: new Date(T).toISOString(), cgu_acceptees_par: "compte@pharmacie-exemple.test",
  test_valide_le: new Date(T).toISOString() });
const acces595 = await stock.acces.lire(595);
eq("accès : montant en nombre", acces595.plafond_montant_ht, 3000);
const cleTest = (await cles.creerCle(stock, { acces: acces595, environnement: "test", libelle: "Tableur", portees: ["lecture", "commande"], par: "compte@pharmacie-exemple.test", role: "pharmacie", maintenant: maintenant() }));
const cleLive = (await cles.creerCle(stock, { acces: acces595, environnement: "live", libelle: "ERP", portees: ["lecture"], par: "compte@pharmacie-exemple.test", role: "pharmacie", maintenant: maintenant() }));
vrai("secret rendu une fois", cles.analyserCle(cleTest.secret));
eq("ligne : empreinte, jamais le secret", db.tables.api_cles.find(c => c.id === cleTest.cle.id).empreinte, cles.empreinteCle(cleTest.secret));
eq("préfixe enregistré", cleTest.cle.prefixe, cles.prefixeCle(cleTest.secret));
eq("droits gardés dans l'ordre", cleTest.cle.portees, ["lecture", "commande"]);

// ═══ 3. Routeur /api/v1 ═══
{
  // routes de test (ajoutées au tableau, comme le feront les lots suivants)
  routeur.ROUTES.push(
    { methode: "GET", gabarit: "/v1/essai-lecture", re: /^\/v1\/essai-lecture$/, portee: "lecture", classe: "lecture", traiter: async () => ({ ok: true }) },
    { methode: "POST", gabarit: "/v1/essai-commande", re: /^\/v1\/essai-commande$/, portee: "commande", classe: "commande", fiche_fraiche: true, traiter: async () => ({ ok: true }) },
  );
  let h = nouveauRouteur();

  // sans clé
  let n0 = db.tables.api_journal.length;
  let r = await requete(h);
  eq("sans clé : 401", r.statusCode, 401);
  eq("sans clé : code", corps(r).code, "cle_absente");
  eq("problem+json", r.headers["Content-Type"], "application/problem+json; charset=utf-8");
  eq("instance = X-Request-Id", corps(r).instance, `urn:uuid:${r.headers["X-Request-Id"]}`);
  vrai("type : page de documentation", corps(r).type === "https://elixir-commande.expepharma.com/api/#erreur-cle_absente");
  vrai("WWW-Authenticate", /^Bearer realm=/.test(r.headers["WWW-Authenticate"]));
  vrai("aucune en-tête CORS", !Object.keys(r.headers).some(k => /^access-control-/i.test(k)));
  eq("no-store", r.headers["Cache-Control"], "no-store");
  eq("journal : une ligne", db.tables.api_journal.length, n0 + 1);
  const j = db.tables.api_journal.at(-1);
  eq("journal : route, statut, code", [j.route, j.statut, j.code, j.cle_id], ["/v1/etat", 401, "cle_absente", null]);
  eq("journal : réseau /24, jamais l'IP", j.reseau, "203.0.113.0/24");

  // clé mal recopiée : refusée sans lecture de api_cles, comptée par réseau
  const lus = () => db.appels.filter(a => a.table === "api_cles" && a.methode === "GET").length;
  let avant = lus();
  r = await requete(h, { cle: cleTest.secret.slice(0, -1) + (cleTest.secret.endsWith("A") ? "B" : "A") });
  eq("clé mal recopiée : 401 cle_invalide", [r.statusCode, corps(r).code], [401, "cle_invalide"]);
  eq("…sans lecture en base", lus(), avant);
  eq("…comptée parmi les refus du réseau", db.tables.api_compteurs.filter(c => c.cle.startsWith("ipko:")).reduce((s, c) => s + c.n, 0), 1);
  r = await requete(h, { cle: cles.genererCle("live") });
  eq("clé inconnue (somme juste) : 401 cle_invalide", [r.statusCode, corps(r).code], [401, "cle_invalide"]);
  r = await requete(h, { entetes: { authorization: `Basic ${cleTest.secret}` } });
  eq("autre schéma qu'un Bearer : 401 cle_invalide", corps(r).code, "cle_invalide");

  // clé de test valide
  r = await requete(h, { cle: cleTest.secret });
  eq("etat : 200", r.statusCode, 200);
  const e = corps(r);
  eq("etat : pharmacie (nom de la fiche)", e.pharmacie, "PHARMACIE EXEMPLE");
  eq("etat : environnement", e.environnement, "test");
  eq("etat : droits", e.portees, ["lecture", "commande"]);
  eq("etat : commandes réelles fermées", e.commandes.production, "fermees");
  eq("etat : route de commande (phase 3), clé de test : commandes disponibles", e.commandes.disponibles, true);
  eq("etat : plafonds par défaut", e.commandes.plafonds, { lignes_par_commande: 100, boites_par_commande: 1000, montant_ht_par_commande: 3000, commandes_par_jour: 10 });
  eq("etat : délai d'annulation", e.commandes.delai_annulation_min, 10);
  eq("etat : mention des prix", e.prix, { base: "liste_pharmacie", mention: "Prix HT de votre liste, hors offres du site" });
  eq("etat : version", e.version_api, "1.0.0");
  eq("etat : clé (préfixe seulement)", e.cle.prefixe, cleTest.cle.prefixe);
  vrai("etat : jamais le secret", !r.body.includes(cleTest.secret));
  vrai("etat : en-têtes de débit", /"minute";q=60;w=60/.test(r.headers["RateLimit-Policy"]) && /"minute";r=59;/.test(r.headers.RateLimit));
  vrai("etat : aucune en-tête CORS", !Object.keys(r.headers).some(k => /^access-control-/i.test(k)));
  const c595 = db.tables.api_cles.find(c => c.id === cleTest.cle.id);
  eq("dernière utilisation notée (réseau /24)", [c595.derniere_utilisation, c595.dernier_reseau], [new Date(T).toISOString(), "203.0.113.0/24"]);
  eq("journal : clé et fiche", [db.tables.api_journal.at(-1).cle_id, db.tables.api_journal.at(-1).odoo_id, db.tables.api_journal.at(-1).environnement], [cleTest.cle.id, 595, "test"]);
  const patchs = () => db.appels.filter(a => a.table === "api_cles" && a.methode === "PATCH").length;
  avant = patchs();
  await requete(h, { cle: cleTest.secret });
  eq("dernière utilisation : une écriture par minute au plus", patchs(), avant);
  r = await requete(h, { cle: cleTest.secret, path: "/.netlify/functions/api-v1/etat" });
  eq("appel direct de la fonction : même route", r.statusCode, 200);
  r = await requete(h, { cle: cleLive.secret });
  eq("clé de production : environnement live", corps(r).environnement, "live");
  eq("clé de production à droit unique", corps(r).portees, ["lecture"]);

  // clé dans l'adresse
  r = await requete(h, { cle: cleTest.secret, query: { api_key: cleLive.secret } });
  eq("clé dans l'adresse : 400", [r.statusCode, corps(r).code], [400, "cle_dans_url"]);
  eq("…rattachée à sa clé dans le journal", db.tables.api_journal.at(-1).cle_id, cleLive.cle.id);
  vrai("…le journal ne contient pas la clé", !JSON.stringify(db.tables.api_journal).includes(cleLive.secret));
  r = await requete(h, { query: { q: `x${cleTest.secret}` } });
  eq("clé dans une valeur quelconque : 400", corps(r).code, "cle_dans_url");

  // routes
  r = await requete(h, { path: "/api/v1/inconnue" });
  eq("route inconnue : 404 sans clé", [r.statusCode, corps(r).code], [404, "introuvable"]);
  r = await requete(h, { methode: "POST", cle: cleTest.secret });
  eq("méthode non prévue : 405 + Allow", [r.statusCode, r.headers.Allow], [405, "GET"]);
  r = await requete(h, { methode: "OPTIONS" });
  eq("OPTIONS (pré-requête d'un navigateur) : 405, sans CORS", [r.statusCode, Object.keys(r.headers).some(k => /^access-control-/i.test(k))], [405, false]);
  r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "x".repeat(256 * 1024 + 1) });
  eq("corps > 256 Ko : 413", [r.statusCode, corps(r).code], [413, "trop_long"]);

  // portée
  r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleLive.secret, body: "{}" });
  eq("clé sans droit « commande » : 403", corps(r).code, "portee_insuffisante");
  r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "{}" });
  eq("clé avec droit « commande » : 200", r.statusCode, 200);
  await stock.acces.modifier(595, { portees: ["lecture"] });
  avancer(31);
  r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "{}" });
  eq("droit retiré de l'accès : 403 même si la clé l'a", corps(r).code, "portee_insuffisante");
  r = await requete(h, { cle: cleTest.secret });
  eq("etat : droits = clé ∩ accès", corps(r).portees, ["lecture"]);
  await stock.acces.modifier(595, { portees: ["lecture", "commande"] });

  // fiche Odoo : relue au plus toutes les 10 min pour une lecture, à chaque écriture
  h = nouveauRouteur();
  odooEtat.appels = 0;
  await requete(h, { cle: cleTest.secret });
  await requete(h, { path: "/api/v1/essai-lecture", cle: cleTest.secret });
  eq("lecture : fiche lue une fois (cache 10 min)", odooEtat.appels, 1);
  await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "{}" });
  eq("écriture : fiche relue", odooEtat.appels, 2);
  odooEtat.panne = true;
  avancer(601);
  r = await requete(h, { path: "/api/v1/essai-lecture", cle: cleTest.secret });
  eq("Odoo muet, lecture : servie", r.statusCode, 200);
  const n1 = odooEtat.appels;
  await requete(h, { path: "/api/v1/essai-lecture", cle: cleTest.secret });
  eq("Odoo muet : nouvel essai dans 1 min seulement", odooEtat.appels, n1);
  r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "{}" });
  eq("Odoo muet, écriture : 503 indisponible + Retry-After", [r.statusCode, corps(r).code, r.headers["Retry-After"]], [503, "indisponible", "60"]);
  odooEtat.panne = false;
  odooEtat.fiches[595] = null;
  avancer(61);
  r = await requete(h, { cle: cleTest.secret });
  eq("fiche archivée ou plus cliente : 403 acces_suspendu", corps(r).code, "acces_suspendu");
  odooEtat.fiches[595] = { ...FICHES[595], cip: false };
  avancer(601);
  r = await requete(h, { cle: cleTest.secret });
  eq("fiche sans CIP : 403 compte_bloque", corps(r).code, "compte_bloque");
  vrai("…message neutre", !/cip|bloqu/i.test(corps(r).detail));
  odooEtat.fiches[595] = FICHES[595];
  avancer(601);

  // réseaux autorisés
  await stock.acces.modifier(595, { ip_autorisees: ["203.0.113.0/24", "2001:db8::/32"] });
  h = nouveauRouteur();
  r = await requete(h, { cle: cleTest.secret, ip: "198.51.100.7" });
  eq("réseau non déclaré : 403", corps(r).code, "ip_non_autorisee");
  r = await requete(h, { cle: cleTest.secret, ip: "2001:db8:5::1" });
  eq("réseau IPv6 déclaré : 200", r.statusCode, 200);
  await stock.acces.modifier(595, { ip_autorisees: null });

  // interrupteur général (« Tout couper ») : /v1/etat reste servi
  await stock.reglages.ecrire({ actif: false, commandes_live: false, prerequis: {} });
  h = nouveauRouteur();
  r = await requete(h, { cle: cleTest.secret });
  eq("API coupée : etat servi, « suspendu »", [r.statusCode, corps(r).etat_service], [200, "suspendu"]);
  r = await requete(h, { path: "/api/v1/essai-lecture", cle: cleTest.secret });
  eq("API coupée : autres routes 503", [r.statusCode, corps(r).code, r.headers["Retry-After"]], [503, "api_suspendue", "300"]);
  await stock.reglages.ecrire({ actif: true, commandes_live: false, prerequis: {} });

  // accès suspendu
  await stock.acces.modifier(595, { actif: false });
  h = nouveauRouteur();
  r = await requete(h, { cle: cleTest.secret });
  eq("accès suspendu : 403", corps(r).code, "acces_suspendu");
  await stock.acces.modifier(595, { actif: true });

  // débit par clé (minute, puis jour)
  avancer(60 - (Math.floor(T / 1000) % 60));   // début d'une minute
  h = nouveauRouteur();
  let dernier;
  for (let i = 0; i < 61; i++) dernier = await requete(h, { path: "/api/v1/essai-lecture", cle: cleTest.secret });
  eq("61e lecture de la minute : 429 debit", [dernier.statusCode, corps(dernier).code], [429, "debit"]);
  vrai("…Retry-After jusqu'à la minute suivante", Number(dernier.headers["Retry-After"]) === 60);
  avancer(60);
  const jour = new Date(Math.floor(T / 86400e3) * 86400e3).toISOString();
  db.tables.api_compteurs.find(c => c.cle === `cle:${cleTest.cle.id}:lecture:86400` && c.fenetre === jour).n = 5000;
  r = await requete(h, { path: "/api/v1/essai-lecture", cle: cleTest.secret });
  eq("5001e lecture du jour : 429 plafond_journalier", [r.statusCode, corps(r).code], [429, "plafond_journalier"]);
  r = await requete(h, { path: "/api/v1/essai-lecture", cle: cleLive.secret });
  eq("…l'autre clé n'est pas touchée", r.statusCode, 200);
  r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "{}" });
  eq("…ni la classe « commande »", r.statusCode, 200);
  for (let i = 0; i < 6; i++) r = await requete(h, { methode: "POST", path: "/api/v1/essai-commande", cle: cleTest.secret, body: "{}" });
  eq("7e écriture de la minute : 429", corps(r).code, "debit");
  db.tables.api_compteurs.find(c => c.cle === `cle:${cleTest.cle.id}:lecture:86400` && c.fenetre === jour).n = 0;

  // débit par IP, avant toute lecture de clé
  avancer(60);
  h = nouveauRouteur();
  for (let i = 0; i < 120; i++) await requete(h, { ip: "198.51.100.50" });
  avant = lus();
  r = await requete(h, { ip: "198.51.100.50", cle: cleTest.secret });
  eq("121e requête de l'IP : 429", [r.statusCode, corps(r).code], [429, "debit"]);
  eq("…sans lecture de clé", lus(), avant);
  r = await requete(h, { ip: "198.51.100.51", cle: cleTest.secret });
  eq("…une autre IP passe", r.statusCode, 200);
  // IPv6 : compté par /64
  for (let i = 0; i < 120; i++) await requete(h, { ip: `2001:db8:aa:1::${(i + 1).toString(16)}` });
  r = await requete(h, { ip: "2001:db8:aa:1::ffff", cle: cleTest.secret });
  eq("IPv6 : même /64, même compteur", corps(r).code, "debit");

  // garde par instance (crue) : aucun appel à la base au-delà de 240
  const appelsAvant = db.appels.length;
  const muet = { compteurs: { compter: async () => 1, lire: async () => 0, purger: async () => {} } };
  const h2 = routeur.creerHandler({ stock: { ...stock, ...muet, journal: { ajouter: async () => {} } }, maintenant, verifierFiche, log: silence, hasard: () => 0.5 });
  for (let i = 0; i < 240; i++) await requete(h2, { ip: "192.0.2.1" });
  r = await requete(h2, { ip: "192.0.2.1" });
  eq("241e requête d'une instance : 429 sans la base", corps(r).code, "debit");
  eq("…aucune requête à la base", db.appels.length, appelsAvant);

  // refus de clés par réseau : 20 en 10 min → 429 même avec une bonne clé
  avancer(600);
  h = nouveauRouteur();
  for (let i = 0; i < 20; i++) await requete(h, { ip: "198.51.100.60", cle: cles.genererCle("test") });
  r = await requete(h, { ip: "198.51.100.60", cle: cleTest.secret });
  eq("20 clés refusées : 429", [r.statusCode, corps(r).code], [429, "debit"]);
  vrai("…message explicite", /clés refusées/.test(corps(r).detail));

  // aperçu Netlify : toute clé = test ; ni journal ni dernière utilisation
  avancer(600);
  h = nouveauRouteur();
  n0 = db.tables.api_journal.length;
  avant = patchs();
  r = await requete(h, { cle: cleLive.secret, host: "deploy-preview-12--commandes-elixir.netlify.app" });
  eq("aperçu : clé de production vue comme test", corps(r).environnement, "test");
  eq("aperçu : pas de journal", db.tables.api_journal.length, n0);
  eq("aperçu : pas d'écriture sur la clé", patchs(), avant);

  // Supabase injoignable : 503
  db.etat.panne = true;
  r = await requete(nouveauRouteur(), { cle: cleTest.secret });
  eq("Supabase injoignable : 503 indisponible", [r.statusCode, corps(r).code, r.headers["Retry-After"]], [503, "indisponible", "30"]);
  vrai("…problem+json", /problem\+json/.test(r.headers["Content-Type"]));
  db.etat.panne = false;
}

// ═══ 4. Compte de la pharmacie (« Accès API ») ═══
const CTX = {
  pharmacie: { odooId: 595, cip: "2000001", nom: "PHARMACIE EXEMPLE", mode: "complet", compteEmail: "compte@pharmacie-exemple.test", admin: null },
  adresse: { odooId: 595, cip: "2000001", nom: "PHARMACIE EXEMPLE", mode: "conseiller_seul", compteEmail: "ancien@pharmacie-exemple.test", admin: null },
  admin: { odooId: 595, cip: "2000001", nom: "PHARMACIE EXEMPLE", mode: "complet", compteEmail: "equipe@elixir.test", admin: "equipe@elixir.test" },
  autre: { odooId: 777, cip: "2000002", nom: "PHARMACIE AUTRE", mode: "complet", compteEmail: "compte@pharmacie-autre.test", admin: null },
};
const identifier = async (event) => {
  const j = String(event.headers?.authorization || "").replace(/^Bearer\s+/, "");
  if (j === "expire") throw Object.assign(new Error("reconnexion"), { status: 401, code: "reconnexion", identite: true });
  if (j === "lent") throw Object.assign(new Error("verification"), { status: 503, code: "verification" });
  if (!CTX[j]) throw Object.assign(new Error("fiche"), { status: 403, code: "fiche", identite: true });
  return CTX[j];
};
const hc = compte.creerHandler({ stock, identifier, maintenant, journal: silence });
const poste = (h, qui, body, host = "elixir-commande.expepharma.com") => h({ httpMethod: "POST", path: "/.netlify/functions/x",
  headers: { host, authorization: `Bearer ${qui}`, "x-nf-client-connection-ip": "203.0.113.20", origin: "https://elixir-commande.expepharma.com" }, body: JSON.stringify(body) });
{
  // nouvel accès vierge pour la fiche 777 : CGU non acceptées
  await stock.acces.creer({ odoo_id: 777, nom: "PHARMACIE AUTRE", cip: "2000002", ouvert_par: "equipe@elixir.test" });
  let r = await poste(hc, "autre", { action: "etat" });
  let e = corps(r);
  eq("etat : ouvert", [r.statusCode, e.ouvert, e.actif, e.lecture_seule], [200, true, true, null]);
  eq("etat : CGU à accepter", [e.cgu.acceptee, e.cgu.version, e.cgu.articles.length > 5], [false, conf.CGU.version, true]);
  eq("etat : aucune clé, commandes réelles fermées", [e.cles.length, e.commandes_production, e.test_valide], [0, "fermees", false]);
  vrai("etat : ni note, ni auteur, ni preuve", !/ouvert_par|cgu_preuve|"note"/.test(r.body));
  r = await poste(hc, "autre", { action: "creer_cle", environnement: "test", libelle: "Outil", portees: ["lecture"] });
  eq("clé avant les CGU : 409", [r.statusCode, corps(r).error], [409, "cgu_a_accepter"]);
  r = await poste(hc, "autre", { action: "cgu", version: "ancienne" });
  eq("CGU d'une autre version : 409", corps(r).error, "cgu_version");
  r = await poste(hc, "autre", { action: "cgu", version: conf.CGU.version });
  eq("CGU acceptées", [r.statusCode, corps(r).cgu.acceptee], [200, true]);
  const a777 = db.tables.api_acces.find(a => a.odoo_id === 777);
  const preuve = JSON.parse(a777.cgu_preuve);
  eq("preuve : version, compte", [a777.cgu_version, a777.cgu_acceptees_par], [conf.CGU.version, "compte@pharmacie-autre.test"]);
  eq("preuve : empreinte du texte, réseau /24, mode", [preuve.empreinte_texte, preuve.reseau, preuve.mode], [conf.empreinteCgu(), "203.0.113.0/24", "en_ligne"]);
  vrai("événement cgu_acceptees", db.tables.api_evenements.some(v => v.type === "cgu_acceptees" && v.odoo_id === 777 && v.role === "pharmacie"));

  r = await poste(hc, "autre", { action: "creer_cle", environnement: "live", libelle: "Outil", portees: ["lecture"] });
  eq("production avant le test : 409 test_requis", corps(r).error, "test_requis");
  r = await poste(hc, "autre", { action: "creer_cle", environnement: "test", libelle: "  Outil   de  réassort ", portees: ["lecture", "commande", "lecture"] });
  eq("clé de test créée : 201", r.statusCode, 201);
  const k = corps(r);
  vrai("secret au bon format", cles.analyserCle(k.cle)?.environnement === "test");
  eq("info : libellé nettoyé, droits", [k.info.libelle, k.info.portees, k.info.etat, k.info.creee_par_role], ["Outil de réassort", ["lecture", "commande"], "active", "pharmacie"]);
  vrai("info sans adresse du créateur", !("creee_par" in k.info));
  vrai("secret absent de toutes les tables", !JSON.stringify(db.tables).includes(k.cle));
  vrai("événement cle_creee (préfixe seulement)", db.tables.api_evenements.some(v => v.type === "cle_creee" && v.cle_id === k.info.id && !v.detail.includes(k.cle)));
  // la clé fonctionne aussitôt
  let h = nouveauRouteur();
  r = await requete(h, { cle: k.cle, ip: "198.51.100.90" });
  eq("nouvelle clé acceptée par le routeur", [r.statusCode, corps(r).pharmacie], [200, "PHARMACIE AUTRE"]);
  // 3 clés actives au plus
  for (let i = 0; i < 2; i++) await poste(hc, "autre", { action: "creer_cle", environnement: "test", libelle: `Outil ${i}`, portees: ["lecture"] });
  r = await poste(hc, "autre", { action: "creer_cle", environnement: "test", libelle: "Quatrième", portees: ["lecture"] });
  eq("4e clé de test : 409", corps(r).error, "trop_de_cles");

  // rotation : nouvelle clé, l'ancienne valide 7 jours
  r = await poste(hc, "autre", { action: "remplacer_cle", id: k.info.id });
  eq("remplacement : 201", r.statusCode, 201);
  const k2 = corps(r);
  vrai("nouveau secret", cles.analyserCle(k2.cle) && k2.cle !== k.cle);
  eq("nouvelle clé : même nom, lien vers l'ancienne", [k2.info.libelle, k2.info.remplace], ["Outil de réassort", k.info.id]);
  eq("ancienne : expire dans 7 jours", db.tables.api_cles.find(c => c.id === k.info.id).expire_le, new Date(T + 7 * 86400e3).toISOString());
  r = await poste(hc, "autre", { action: "remplacer_cle", id: k.info.id });
  eq("remplacer une clé déjà remplacée : 409", corps(r).error, "cle_inactive");
  h = nouveauRouteur();
  r = await requete(h, { cle: k.cle, ip: "198.51.100.90" });
  eq("ancienne clé encore acceptée pendant 7 jours", r.statusCode, 200);
  avancer(7 * 86400 + 1);
  h = nouveauRouteur();
  r = await requete(h, { cle: k.cle, ip: "198.51.100.91" });
  eq("…puis 401 cle_expiree", corps(r).code, "cle_expiree");
  r = await requete(h, { cle: k2.cle, ip: "198.51.100.91" });
  eq("nouvelle clé acceptée", r.statusCode, 200);

  // révocation
  r = await poste(hc, "autre", { action: "revoquer_cle", id: k2.info.id, motif: "outil remplacé" });
  eq("révocation", [r.statusCode, corps(r).info.etat], [200, "revoquee"]);
  r = await poste(hc, "autre", { action: "revoquer_cle", id: k2.info.id });
  eq("révocation rejouée : ok (déjà)", [r.statusCode, corps(r).deja], [200, true]);
  avancer(31);
  r = await requete(h, { cle: k2.cle, ip: "198.51.100.91" });
  eq("clé révoquée refusée (cache ≤ 30 s)", corps(r).code, "cle_revoquee");
  r = await poste(hc, "autre", { action: "revoquer_cle", id: cleTest.cle.id });
  eq("révoquer la clé d'une autre pharmacie : 404", r.statusCode, 404);
  eq("…qui reste active", db.tables.api_cles.find(c => c.id === cleTest.cle.id).revoquee_le, null);

  // journal de la pharmacie : ses appels seulement
  r = await poste(hc, "autre", { action: "journal" });
  const ap = corps(r).appels;
  vrai("journal : appels de la fiche", ap.length > 0 && ap.every(l => [k.info.prefixe, k2.info.prefixe].includes(l.cle)));
  vrai("journal : sans réseau ni identifiant de requête", !/reseau|request_id/.test(r.body));

  // lecture seule : admin en saisie, adresse plus sur la fiche, aperçu
  r = await poste(hc, "admin", { action: "etat" });
  eq("admin en saisie : lecture seule", corps(r).lecture_seule, "admin");
  r = await poste(hc, "admin", { action: "creer_cle", environnement: "test", libelle: "x", portees: ["lecture"] });
  eq("admin en saisie : création refusée", [r.statusCode, corps(r).error], [403, "lecture_seule"]);
  r = await poste(hc, "adresse", { action: "revoquer_cle", id: cleTest.cle.id });
  eq("adresse plus sur la fiche : refus", [r.statusCode, corps(r).raison], [403, "adresse"]);
  r = await poste(hc, "pharmacie", { action: "creer_cle", environnement: "test", libelle: "x", portees: ["lecture"] }, "deploy-preview-3--commandes-elixir.netlify.app");
  eq("aperçu : refus", corps(r).raison, "apercu");
  // identité
  r = await poste(hc, "expire", { action: "etat" });
  eq("jeton expiré : 401 reconnexion", [r.statusCode, corps(r).error], [401, "reconnexion"]);
  r = await poste(hc, "lent", { action: "etat" });
  eq("Supabase Auth lent : 503", r.statusCode, 503);
  r = await poste(hc, "inconnu", { action: "etat" });
  eq("compte sans fiche : 403", r.statusCode, 403);
  r = await poste(hc, "pharmacie", { action: "pirater" });
  eq("action inconnue : 400", r.statusCode, 400);
  // fiche sans accès ouvert
  delete CTX.autre.mode; CTX.sans = { odooId: 999, cip: "2000009", nom: "PHARMACIE SANS ACCES", mode: "complet", compteEmail: "x@pharmacie-sans.test", admin: null };
  r = await poste(hc, "sans", { action: "etat" });
  eq("sans accès ouvert : { ouvert: false }", corps(r), { ouvert: false });
  r = await poste(hc, "sans", { action: "creer_cle", environnement: "test", libelle: "x", portees: ["lecture"] });
  eq("sans accès ouvert : création refusée", corps(r).error, "acces_ferme");
}

// ═══ 5. Admin (onglet 🔌 API) ═══
const verifierAdmin = async (event) => String(event.headers?.authorization || "") === "Bearer admin"
  ? { admin: { email: "equipe@elixir.test" }, error: null } : { error: { statusCode: 403, headers: {}, body: JSON.stringify({ error: "Accès admin requis" }) } };
const listePrix = async (id) => (id === 595 ? 5 : 12);
const ha = admin.creerHandler({ stock, verifierAdmin, verifierFiche, listePrix, maintenant, journal: silence });
const adm = (body, { qui = "admin", host = "elixir-commande.expepharma.com" } = {}) => ha({ httpMethod: "POST", headers: { host, authorization: `Bearer ${qui}` }, body: JSON.stringify(body) });
const vue = (q, qui = "admin") => ha({ httpMethod: "GET", headers: { host: "elixir-commande.expepharma.com", authorization: `Bearer ${qui}` }, queryStringParameters: q });
{
  let r = await vue({ vue: "tableau" }, "pharmacie");
  eq("non admin : 403", r.statusCode, 403);
  T = Date.parse("2026-10-30T09:00:00Z");
  r = await vue({ vue: "tableau" });
  let t = corps(r);
  eq("tableau : réglages", [t.reglages.actif, t.reglages.commandes_live, t.commandes_production], [true, false, "fermees"]);
  eq("tableau : 4 prérequis", t.prerequis.map(p => p.id), ["P1", "P3", "P4", "P7"]);
  eq("tableau : P3 pas encore cochable", t.prerequis.find(p => p.id === "P3").cochable, false);
  eq("tableau : défauts d'un accès", [t.defauts.mode, t.defauts.delai_annulation_min, t.defauts.plafond_lignes, t.defauts.plafond_boites, t.defauts.plafond_montant_ht,
    t.defauts.plafond_commandes_jour, t.defauts.anomalie_facteur, t.defauts.anomalie_doublon_min], ["auto", 10, 100, 1000, 3000, 10, 10, 30]);
  const a595 = t.acces.find(a => a.odoo_id === 595);
  eq("tableau : clés actives par environnement", a595.cles_actives, { live: 1, test: 1 });
  vrai("tableau : ni empreinte ni preuve brute", !/empreinte|cgu_preuve/.test(r.body));

  r = await adm({ action: "reglages", commandes_live: true, base: t.updated_at });
  eq("ouvrir les commandes sans prérequis : 409", [r.statusCode, corps(r).manquants], [409, ["P1", "P3", "P4", "P7"]]);
  r = await adm({ action: "prerequis", id: "P3", fait: true, base: t.updated_at });
  eq("P3 avant le 02/11 : 409", r.statusCode, 409);
  for (const id of ["P1", "P4", "P7"]) { t = corps(await vue({ vue: "tableau" })); r = await adm({ action: "prerequis", id, fait: true, note: "vérifié", base: t.updated_at }); }
  eq("P1, P4, P7 cochés", r.statusCode, 200);
  r = await adm({ action: "prerequis", id: "P9", fait: true });
  eq("prérequis inconnu : 400", r.statusCode, 400);
  r = await adm({ action: "reglages", commandes_live: true, base: "2020-01-01T00:00:00.000Z" });
  eq("réglages lus périmés : 409 conflit", corps(r).conflit, true);
  T = Date.parse("2026-11-01T23:00:00Z");   // 02/11/2026, minuit à Paris
  t = corps(await vue({ vue: "tableau" }));
  r = await adm({ action: "prerequis", id: "P3", fait: true, base: t.updated_at });
  eq("P3 coché le 02/11", r.statusCode, 200);
  t = corps(await vue({ vue: "tableau" }));
  eq("ouvrable", t.ouvrable, { ok: true, manquants: [] });
  eq("prérequis : auteur et note tracés", [t.prerequis[0].par, t.prerequis[0].note], ["equipe@elixir.test", "vérifié"]);
  r = await adm({ action: "reglages", commandes_live: true, base: t.updated_at });
  eq("commandes par API ouvertes", r.statusCode, 200);
  t = corps(await vue({ vue: "tableau" }));
  eq("…production ouverte", t.commandes_production, "ouvertes");
  let h = nouveauRouteur();
  eq("routeur : production ouverte", corps(await requete(h, { cle: cleLive.secret })).commandes.production, "ouvertes");
  r = await adm({ action: "prerequis", id: "P4", fait: false, base: t.updated_at });
  t = corps(await vue({ vue: "tableau" }));
  eq("P4 décoché : commandes refermées", [t.reglages.commandes_live, t.commandes_production], [false, "fermees"]);
  r = await adm({ action: "tout_couper" });
  t = corps(await vue({ vue: "tableau" }));
  eq("Tout couper", [t.reglages.actif, t.reglages.commandes_live], [false, false]);
  vrai("événement tout_couper tracé", db.tables.api_evenements.some(v => v.type === "tout_couper" && v.par === "equipe@elixir.test"));
  r = await adm({ action: "reglages", actif: true, base: t.updated_at });
  eq("remise en service", r.statusCode, 200);

  // ouverture d'un accès : fiche revérifiée dans Odoo
  odooEtat.fiches[595] = FICHES[595];
  r = await adm({ action: "ouvrir_acces", odoo_id: 404 });
  eq("fiche inconnue : 409", r.statusCode, 409);
  r = await adm({ action: "ouvrir_acces", odoo_id: 888 });
  eq("fiche sans CIP : 409", [r.statusCode, /CIP/.test(corps(r).error)], [409, true]);
  r = await adm({ action: "ouvrir_acces", odoo_id: 595 });
  eq("accès déjà ouvert : 409", r.statusCode, 409);
  odooEtat.fiches[321] = { id: 321, name: "PHARMACIE NOUVELLE", city: "Ville", cip: "2000321", company_id: false };
  r = await adm({ action: "ouvrir_acces", odoo_id: 321, mode: "manuel" });
  eq("mode inconnu : 400", r.statusCode, 400);
  r = await adm({ action: "ouvrir_acces", odoo_id: 321, portees: ["lecture"], note: "demande du 24/10" });
  const nv = corps(r).acces;
  eq("accès ouvert", [r.statusCode, nv.actif, nv.portees, nv.mode, nv.delai_annulation_min, nv.nom, nv.cip, nv.liste_prix_id, nv.ouvert_par],
    [200, true, ["lecture"], "auto", 10, "PHARMACIE NOUVELLE", "2000321", 12, "equipe@elixir.test"]);
  vrai("événement acces_ouvert", db.tables.api_evenements.some(v => v.type === "acces_ouvert" && v.odoo_id === 321));
  // réglages bornés
  r = await adm({ action: "modifier_acces", odoo_id: 321, champs: { delai_annulation_min: 25, mode: "manuel", ip_autorisees: "999.1.1.1", plafond_lignes: 2.5 } });
  eq("réglages hors bornes : 400, 4 erreurs", [r.statusCode, corps(r).erreurs.length], [400, 4]);
  r = await adm({ action: "modifier_acces", odoo_id: 321, champs: { delai_annulation_min: "20", mode: "bloque", ip_autorisees: "203.0.113.0/24\n2001:db8::/32", plafond_montant_ht: "1500,5",
    anomalie_facteur: 4, anomalie_doublon_min: 0, anomalie_active: false, portees: ["commande", "lecture"], note: "" } });
  const m = corps(r).acces;
  eq("réglages enregistrés", [m.delai_annulation_min, m.mode, m.ip_autorisees, m.plafond_montant_ht, m.anomalie_facteur, m.anomalie_doublon_min, m.anomalie_active, m.portees, m.note],
    [20, "bloque", ["203.0.113.0/24", "2001:db8::/32"], 1500.5, 4, 0, false, ["lecture", "commande"], null]);
  r = await adm({ action: "suspendre_acces", odoo_id: 321 });
  eq("suspension sans motif : 400", r.statusCode, 400);
  r = await adm({ action: "suspendre_acces", odoo_id: 321, motif: "essai" });
  eq("suspension", [corps(r).acces.actif, corps(r).acces.motif_suspension], [false, "essai"]);
  r = await adm({ action: "reactiver_acces", odoo_id: 321 });
  eq("réactivation (fiche revérifiée)", [corps(r).acces.actif, corps(r).acces.suspendu_le], [true, null]);

  // clé « sans compte » : CGU signées, motif, montrée une fois, tracée
  r = await adm({ action: "creer_cle_admin", odoo_id: 321, environnement: "test", libelle: "Script", portees: ["lecture"] });
  eq("clé admin sans motif : 400", r.statusCode, 400);
  r = await adm({ action: "creer_cle_admin", odoo_id: 321, environnement: "test", libelle: "Script", portees: ["lecture"], motif: "pharmacie sans compte du site" });
  eq("clé admin avant les CGU : 409", [r.statusCode, corps(r).code], [409, "cgu_a_accepter"]);
  r = await adm({ action: "cgu_signees", odoo_id: 321 });
  eq("CGU signées sans référence : 400", r.statusCode, 400);
  r = await adm({ action: "cgu_signees", odoo_id: 321, reference: "PDF signé reçu le 24/10" });
  eq("CGU signées", [r.statusCode, corps(r).acces.cgu_version], [200, conf.CGU.version]);
  eq("preuve : signature", JSON.parse(db.tables.api_acces.find(a => a.odoo_id === 321).cgu_preuve).mode, "signature");
  r = await adm({ action: "creer_cle_admin", odoo_id: 321, environnement: "test", libelle: "Script", portees: ["lecture"], motif: "pharmacie sans compte du site" });
  eq("clé admin créée : 201", r.statusCode, 201);
  const ka = corps(r);
  vrai("secret montré une fois", cles.analyserCle(ka.cle));
  eq("créée par l'admin", [ka.info.creee_par_role, ka.info.creee_par], ["admin", "equipe@elixir.test"]);
  vrai("événement : vue par l'admin", db.tables.api_evenements.some(v => v.type === "cle_creee_admin" && JSON.parse(v.detail).vue_par === "equipe@elixir.test"));
  vrai("secret absent des tables", !JSON.stringify(db.tables).includes(ka.cle));
  r = await adm({ action: "creer_cle_admin", odoo_id: 321, environnement: "live", libelle: "Script", portees: ["lecture"], motif: "pharmacie sans compte du site" });
  eq("clé admin de production avant le test : 409", corps(r).code, "test_requis");
  r = await adm({ action: "valider_test", odoo_id: 321 });
  eq("valider le test sans motif : 400", r.statusCode, 400);
  r = await adm({ action: "valider_test", odoo_id: 321, motif: "parcours fait par téléphone" });
  eq("test validé par l'admin (tracé)", [corps(r).acces.test_valide_par, db.tables.api_evenements.some(v => v.type === "test_valide_admin")], ["equipe@elixir.test", true]);
  r = await adm({ action: "creer_cle_admin", odoo_id: 321, environnement: "live", libelle: "Script prod", portees: ["lecture", "commande"], motif: "pharmacie sans compte du site" });
  eq("clé de production créée après le test", r.statusCode, 201);
  // révocation par l'admin
  r = await adm({ action: "revoquer_cle", id: ka.info.id });
  eq("révocation sans motif : 400", r.statusCode, 400);
  r = await adm({ action: "revoquer_cle", id: ka.info.id, motif: "fin de l'essai" });
  eq("révocation par l'admin", [r.statusCode, corps(r).cle.etat, corps(r).cle.revoquee_par], [200, "revoquee", "equipe@elixir.test"]);
  r = await adm({ action: "revoquer_cle", id: ka.info.id, motif: "encore" });
  eq("…rejouée : 409", r.statusCode, 409);

  // détail : clés sans secret ni empreinte, usage sur 24 h
  h = nouveauRouteur();
  await requete(h, { cle: cleTest.secret, ip: "198.51.100.200" });
  await requete(h, { cle: cleTest.secret, ip: "198.51.100.200", path: "/api/v1/inconnue" });
  r = await vue({ vue: "acces", odoo_id: "595" });
  const d = corps(r);
  vrai("détail : aucune empreinte", !/empreinte/.test(r.body));
  vrai("détail : aucun secret", ![cleTest.secret, cleLive.secret].some(s => r.body.includes(s)));
  const u = d.cles.find(c => c.id === cleTest.cle.id).usage_24h;
  vrai("détail : usage sur 24 h", u.requetes >= 1);
  r = await vue({ vue: "journal", erreurs: "1" });
  vrai("journal : erreurs seulement", corps(r).lignes.every(l => l.statut >= 400) && corps(r).lignes.length > 0);
  vrai("journal : préfixe de la clé", corps(r).lignes.some(l => l.cle && l.cle.startsWith("elx_")));
  r = await adm({ action: "tout_couper" }, { host: "deploy-preview-9--commandes-elixir.netlify.app" });
  eq("aperçu : aucune modification", r.statusCode, 409);
  r = await vue({ vue: "inconnue" });
  eq("vue inconnue : 400", r.statusCode, 400);
}

// ═══ 6. Aucune fuite : ni secret, ni IP complète, ni e-mail dans le journal ═══
{
  const journal = JSON.stringify(db.tables.api_journal);
  vrai("journal sans IP complète", !/203\.0\.113\.9"|198\.51\.100\.(7|50|90)"/.test(journal));
  vrai("journal sans e-mail", !/@/.test(journal));
  vrai("journal sans clé", ![cleTest.secret, cleLive.secret].some(s => journal.includes(s)));
  vrai("compteurs sans IP en clair", !/\d+\.\d+\.\d+\.\d+|2001:db8/.test(JSON.stringify(db.tables.api_compteurs)));
  eq("toutes les requêtes Supabase avec la clé serveur (jamais la clé anon)", [db.appels.length > 100, db.etat.refusees], [true, 0]);
}

// ═══ 7. Fichiers : _redirects, SQL, chargement à la demande ═══
{
  const lignes = readFileSync(join(APP, "public/_redirects"), "utf8").split("\n").filter(l => l.trim() && !l.startsWith("#"));
  const iApi = lignes.findIndex(l => /^\/api\/v1\/\*\s+\/\.netlify\/functions\/api-v1\/:splat\s+200!$/.test(l.trim()));
  const iTout = lignes.findIndex(l => /^\/\*\s/.test(l));
  vrai("_redirects : /api/v1/* forcé vers la fonction, AVANT /*", iApi >= 0 && iTout > iApi);
  const sql = readFileSync(join(APP, "sql/api-schema.sql"), "utf8");
  const tablesSql = [...sql.matchAll(/create table if not exists (api_\w+)/g)].map(m => m[1]);
  eq("SQL : tables", tablesSql, ["api_reglages", "api_acces", "api_cles", "api_commandes", "api_journal", "api_evenements", "api_compteurs",
    "api_prix", "api_prix_listes"]);   // phase 2 (lecture) : prix des listes
  vrai("SQL : RLS sur chaque table", tablesSql.every(t => new RegExp(`alter table ${t}\\s+enable row level security`).test(sql)));
  const revoke = /revoke all on table ([\s\S]*?) from anon, authenticated;/.exec(sql)?.[1] || "";
  vrai("SQL : droits retirés à anon et authenticated sur chaque table", tablesSql.every(t => revoke.split(/[\s,]+/).includes(t)));
  vrai("SQL : aucune policy", !/create policy/i.test(sql));
  vrai("SQL : fonctions réservées à service_role", /revoke all on function api_compter\(text, int\) from public, anon, authenticated/.test(sql)
    && /grant execute on function api_compter\(text, int\) to service_role/.test(sql) && /revoke all on function api_lire_compteur/.test(sql));
  vrai("SQL : empreinte seule (64 hex), jamais de colonne « secret »", /empreinte\s+text not null unique check \(empreinte ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(sql) && !/\bsecret\b\s+text/.test(sql));
  const app = readFileSync(join(APP, "src/App.jsx"), "utf8");
  vrai("App : LienApi chargé à la demande", /React\.lazy\(\(\) => import\("\.\/components\/api\/LienApi\.jsx"\)/.test(app) && !/^import .*LienApi/m.test(app));
  vrai("App : AccesApi jamais importé directement", !/AccesApi/.test(app));
  const panneau = readFileSync(join(APP, "src/AdminPanel.jsx"), "utf8");
  vrai("Admin : AdminApi chargé à la demande", /const AdminApi = React\.lazy\(\(\) => import\("\.\/components\/AdminApi\.jsx"\)\)/.test(panneau) && !/^import .*AdminApi/m.test(panneau));
  const lien = readFileSync(join(APP, "src/components/api/LienApi.jsx"), "utf8");
  vrai("LienApi : panneau chargé à la demande", /React\.lazy\(\(\) => import\("\.\.\/AccesApi\.jsx"\)\)/.test(lien) && !/^import .*AccesApi/m.test(lien));
  vrai("écrans sans stockage navigateur", ![lien, readFileSync(join(APP, "src/components/AccesApi.jsx"), "utf8"), readFileSync(join(APP, "src/components/AdminApi.jsx"), "utf8")]
    .some(s => /(local|session)Storage/.test(s)));
}

console.log(`\nAPI des pharmacies (fondations) : ${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
