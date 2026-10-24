// Tests de l'API des pharmacies, P9 « avis par e-mail des clés et alertes d'usage » : node scripts/test-api-avis.mjs
// Hors ligne : faux PostgREST en mémoire (tables api_*, scripts/api-faux.mjs), faux Odoo (mail.mail : créations et envois
// enregistrés, panne simulée — AUCUN e-mail réel), fausse identité (compte de pharmacie), faux admin. Aucune donnée réelle :
// pharmacies, adresses et clés fictives, clés fabriquées à l'exécution (aucune clé complète dans ce fichier).
//  • textes : e-mails d'avis (créée, remplacée, révoquée ; compte, admin, automatique ; test et production ; sans compte),
//    e-mails d'alerte, échappement HTML, jamais le secret ;
//  • compte de la pharmacie (api-compte) : e-mail aux adresses de compte, copie Elixir en production seulement, réponse
//    `avis_envoye`, événement avis_envoye ; Odoo muet → clé créée quand même, avis_echec, aucun e-mail ;
//  • admin (api-admin) : clé « sans compte » et révocation → e-mail « par Elixir Pharma », destinataires relus ;
//  • passage planifié (api-cron) : reprise des avis en échec (3 fois au plus), clé inutilisée (signalée à 90 jours, révoquée
//    à 180 avec e-mail), nouveau réseau, réseau refusé, erreurs, volume ; dédoublonnage ; aperçus ignorés ; 5 alertes par
//    passage ; Odoo muet ne fait jamais échouer le passage ; vue=tableau de l'admin liste les alertes ;
//  • fichiers : prérequis P9 cochable, zones (_api-avis admis), documentation (contrat, mise en service, page).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
process.env.CRON_SECRET = "secret-cron-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.GP_ADMIN_MAIL = "equipe@elixir.test";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = await import("../netlify/functions/_api-config.js");
const cles = await import("../netlify/functions/_api-cles.js");
const { creerStockApi } = await import("../netlify/functions/_api-stock.js");
const { fauxPostgrestApi } = await import("./api-faux.mjs");
const A = await import("../netlify/functions/_api-avis.js");
const compte = await import("../netlify/functions/api-compte.js");
const admin = await import("../netlify/functions/api-admin.js");
const { creerHandler: creerCron } = await import("../netlify/functions/api-cron.js");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const silence = () => {};
const CLE_COMPLETE = /elx_(live|test)_[0-9A-Za-z]{40}/;

let T = Date.parse("2026-10-26T09:00:00Z");   // lundi, 11 h à Paris (heure d'été jusqu'au 25/10 : désormais +01:00)
const maintenant = () => new Date(T);
const iso = (ms = T) => new Date(ms).toISOString();
const MIN = 60e3, H = 3600e3, J = 86400e3;

const db = fauxPostgrestApi({ horloge: () => T });
const stock = creerStockApi({ fetch: db.fetch, maintenant });

// ── faux Odoo : mail.mail seulement ──
const mails = [];
let mailPanne = false, idMail = 0;
const fauxOdoo = async (model, method, args) => {
  if (model !== "mail.mail") throw new Error(`modèle inattendu : ${model}`);
  if (mailPanne) throw new Error("Odoo injoignable");
  if (method === "create") { const m = { id: ++idMail, ...args[0], envoye: false }; mails.push(m); return m.id; }
  if (method === "send") { const m = mails.find(x => x.id === args[0][0]); if (!m) throw new Error("mail inconnu"); m.envoye = true; return true; }
  throw new Error(`méthode inattendue : ${method}`);
};
const dernier = () => mails[mails.length - 1];
const avis = A.creerAvis({ odoo: fauxOdoo, journal: silence });

// ── fiches et accès ──
const COMPTES = { 595: ["titulaire@pharmacie-exemple.test", "adjoint@pharmacie-exemple.test"], 777: [] };
const comptes = async (id) => COMPTES[id] || [];
await stock.acces.creer({ odoo_id: 595, nom: "PHARMACIE EXEMPLE", cip: "2000001", ville: "Exempleville", ouvert_par: "equipe@elixir.test",
  cgu_version: conf.CGU.version, cgu_acceptees_le: iso(), cgu_acceptees_par: COMPTES[595][0], test_valide_le: iso(), liste_prix_lue_le: iso() });
await stock.acces.creer({ odoo_id: 777, nom: "PHARMACIE SANS COMPTE", cip: "2000002", ville: "Ailleurs", ouvert_par: "equipe@elixir.test",
  cgu_version: conf.CGU.version, cgu_acceptees_le: iso(), cgu_acceptees_par: "equipe@elixir.test", test_valide_le: iso(), liste_prix_lue_le: iso() });
const acces595 = await stock.acces.lire(595);
const evts = (type, cleId = null) => db.tables.api_evenements.filter(e => e.type === type && (!cleId || e.cle_id === cleId)).map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
const notifs = () => db.tables.ec_notifications;

// ═══ 1. Textes ═══
{
  const cle = { id: "00000000-0000-4000-8000-000000000001", odoo_id: 595, environnement: "live", prefixe: "elx_live_Ab3d…k9Qz", libelle: "Tableur <b>réassort</b>", portees: ["lecture", "commande"] };
  let t = A.texteAvisCle({ type: "cle_creee", cle, acces: acces595, par: COMPTES[595][0], role: "pharmacie", quand: new Date(T) });
  eq("sujet : créée (production), nom de la clé", t.sujet, "Elixir Pharma — clé d'API créée (production) : « Tableur <b>réassort</b> »");
  vrai("corps : début de la clé, droits, pharmacie, origine compte", /elx_live_Ab3d…k9Qz/.test(t.html) && /Lecture \+ Commande/.test(t.html) && /PHARMACIE EXEMPLE/.test(t.html) && /depuis le compte du site de votre pharmacie \(titulaire@pharmacie-exemple\.test\)/.test(t.html));
  vrai("corps : date à l'heure de Paris", /26\/10\/2026 à 10 h 00/.test(t.html));
  vrai("corps : HTML du libellé échappé", t.html.includes("Tableur &lt;b&gt;réassort&lt;/b&gt;") && !t.html.includes("<b>réassort</b>"));
  vrai("corps : consigne si ce n'est pas vous, adresse d'Elixir", /Si vous n'êtes pas à l'origine/.test(t.html) && t.html.includes("equipe@elixir.test"));
  vrai("corps : jamais la clé", !CLE_COMPLETE.test(t.html) && /seul son début est rappelé/.test(t.html));
  t = A.texteAvisCle({ type: "cle_remplacee", cle, acces: acces595, par: COMPTES[595][0], role: "pharmacie", quand: new Date(T), expire: iso(T + 7 * J) });
  vrai("remplacée : ancienne valide jusqu'au…", /remplacée/.test(t.sujet) && /reste valide jusqu'au 02\/11\/2026/.test(t.html));
  t = A.texteAvisCle({ type: "cle_revoquee", cle: { ...cle, environnement: "test" }, acces: acces595, par: "equipe@elixir.test", role: "admin", quand: new Date(T), motif: "fuite signalée" });
  vrai("révoquée par l'admin (test) : origine Elixir, motif, mention clé de test", /révoquée \(test\)/.test(t.sujet) && /par Elixir Pharma, dans son administration/.test(t.html) && /motif : fuite signalée/.test(t.html) && /clé de test ne passe aucune commande réelle/.test(t.html));
  t = A.texteAvisCle({ type: "cle_revoquee", cle, acces: acces595, par: "api-cron", role: "systeme", quand: new Date(T), motif: "inutilisée depuis 181 jours : révoquée automatiquement" });
  vrai("révocation automatique : origine, rien à faire", /automatiquement : inutilisée depuis 181 jours/.test(t.html) && /il n'y a rien à faire/.test(t.html) && !/Si vous n'êtes pas à l'origine/.test(t.html));
  t = A.texteAvisCle({ type: "cle_creee", cle, acces: acces595, par: "equipe@elixir.test", role: "admin", quand: new Date(T), sansCompte: true });
  vrai("sans compte : mention pour Elixir", /aucune adresse de compte du site/.test(t.html));
  for (const type of A.TYPES_ALERTE) {
    const a = A.texteAlerte({ type, acces: acces595, cle, detail: { jours_inactive: 91, reseau: "198.51.100.0/24", appels: 3, reseaux: ["198.51.100.0/24"], erreurs: 10, requetes: 25, part: 40, appels_jour: 350, moyenne_jour: 12 } });
    vrai(`alerte ${type} : sujet et corps`, a.sujet.startsWith(`API des pharmacies : ${A.LIBELLES_ALERTE[type]} — PHARMACIE EXEMPLE`) && /elx_live_Ab3d…k9Qz/.test(a.html) && !CLE_COMPLETE.test(a.html));
  }
  eq("MAIL_ELIXIR : variable, puis défaut", [A.MAIL_ELIXIR({ GP_ADMIN_MAIL: " x@elixir.test " }), A.MAIL_ELIXIR({})], ["x@elixir.test", "pharmacien@elixirpharma.fr"]);
  eq("début du jour de Paris (été, hiver)", [A.debutJourParis(new Date("2026-10-24T12:00:00Z")).toISOString(), A.debutJourParis(new Date("2026-12-01T12:00:00Z")).toISOString()],
    ["2026-10-23T22:00:00.000Z", "2026-11-30T23:00:00.000Z"]);
  eq("P9 livré : cochable", [conf.PREREQUIS.find(p => p.id === "P9").indisponible ?? null, conf.prerequisEtat({}, new Date(T)).find(p => p.id === "P9").cochable], [null, true]);
}

// ═══ 2. Envoi ═══
{
  let erreur = null;
  try { await avis.envoyer({ a: [], cc: null, sujet: "x", html: "<p>x</p>" }); } catch (e) { erreur = e.message; }
  eq("aucun destinataire : refusé", erreur, "aucun destinataire");
  await avis.envoyer({ a: ["A@Pharmacie.test ", "a@pharmacie.test", "pas-une-adresse"], cc: "equipe@elixir.test", sujet: "Sujet", html: "<p>x</p>" });
  eq("destinataires dédoublonnés et nettoyés, copie", [dernier().email_to, dernier().email_cc, dernier().envoye, dernier().email_from], ["a@pharmacie.test", "equipe@elixir.test", true, "pharmacien@elixirpharma.fr"]);
  await avis.envoyer({ a: [], cc: "equipe@elixir.test", sujet: "Sujet", html: "<p>x</p>" });
  eq("sans adresse de pharmacie : la copie devient destinataire", [dernier().email_to, dernier().email_cc], ["equipe@elixir.test", false]);
  mails.length = 0;
}

// ═══ 3. Compte de la pharmacie ═══
const CTX = {
  pharmacie: { odooId: 595, cip: "2000001", nom: "PHARMACIE EXEMPLE", mode: "complet", compteEmail: COMPTES[595][0], comptes: COMPTES[595], admin: null },
  sans: { odooId: 777, cip: "2000002", nom: "PHARMACIE SANS COMPTE", mode: "complet", compteEmail: "compte@sans.test", comptes: [], admin: null },
};
const identifier = async (event) => { const j = String(event.headers?.authorization || "").replace(/^Bearer\s+/, ""); if (!CTX[j]) throw Object.assign(new Error("fiche"), { status: 403, code: "fiche", identite: true }); return CTX[j]; };
const hc = compte.creerHandler({ stock, identifier, maintenant, journal: silence, avis });
const poste = (qui, body) => hc({ httpMethod: "POST", path: "/.netlify/functions/api-compte", headers: { host: "elixir-commande.expepharma.com", authorization: `Bearer ${qui}`, "x-nf-client-connection-ip": "203.0.113.20" }, body: JSON.stringify(body) });
const corps = (r) => JSON.parse(r.body);
let cleTest, cleLive;
{
  let r = await poste("pharmacie", { action: "creer_cle", environnement: "test", libelle: "Outil de test", portees: ["lecture"] });
  cleTest = corps(r);
  eq("clé de test créée, avis envoyé", [r.statusCode, cleTest.avis_envoye, mails.length], [201, true, 1]);
  eq("e-mail : aux deux adresses de compte, sans copie Elixir (test)", [dernier().email_to, dernier().email_cc, dernier().envoye], [COMPTES[595].join(", "), false, true]);
  vrai("e-mail : sujet créée (test), début de la clé, jamais le secret", /créée \(test\)/.test(dernier().subject) && dernier().body_html.includes(cleTest.info.prefixe) && !dernier().body_html.includes(cleTest.cle) && !CLE_COMPLETE.test(dernier().body_html));
  eq("événement avis_envoye (clé, destinataires, pas de copie)", evts("avis_envoye", cleTest.info.id).map(e => [e.detail.avis, e.detail.destinataires, e.detail.copie_elixir, e.role, e.detail.tentative]), [["cle_creee", 2, false, "systeme", 1]]);
  vrai("événement sans secret", !JSON.stringify(db.tables.api_evenements).includes(cleTest.cle));

  r = await poste("pharmacie", { action: "creer_cle", environnement: "live", libelle: "Outil de production", portees: ["lecture", "commande"] });
  cleLive = corps(r);
  eq("clé de production : e-mail avec copie Elixir", [r.statusCode, dernier().email_to, dernier().email_cc], [201, COMPTES[595].join(", "), "equipe@elixir.test"]);
  vrai("notification à Elixir conservée (clé de production)", notifs().some(n => /Clé API de production créée/.test(n.title)));

  r = await poste("pharmacie", { action: "remplacer_cle", id: cleTest.info.id });
  const k2 = corps(r);
  eq("remplacement : e-mail « remplacée », avis envoyé", [r.statusCode, k2.avis_envoye, /remplacée \(test\)/.test(dernier().subject), /reste valide jusqu'au/.test(dernier().body_html)], [201, true, true, true]);
  r = await poste("pharmacie", { action: "revoquer_cle", id: k2.info.id, motif: "outil abandonné" });
  eq("révocation : e-mail « révoquée » avec le motif", [r.statusCode, corps(r).avis_envoye, /révoquée \(test\)/.test(dernier().subject), /motif : outil abandonné/.test(dernier().body_html)], [200, true, true, true]);
  eq("quatre avis envoyés, quatre e-mails", [evts("avis_envoye").length, mails.length], [4, 4]);

  // Odoo muet : la clé est créée quand même, l'échec est tracé, rien n'est envoyé
  mailPanne = true;
  r = await poste("pharmacie", { action: "creer_cle", environnement: "test", libelle: "Pendant la panne", portees: ["lecture"] });
  const k3 = corps(r);
  eq("Odoo muet : clé créée, avis non envoyé", [r.statusCode, k3.avis_envoye, mails.length], [201, false, 4]);
  eq("événement avis_echec (tentative 1, erreur, de quoi reprendre)", evts("avis_echec", k3.info.id).map(e => [e.detail.avis, e.detail.tentative, e.detail.erreur, e.detail.role, e.detail.par]),
    [["cle_creee", 1, "Odoo injoignable", "pharmacie", COMPTES[595][0]]]);
  mailPanne = false;
  globalThis.__k3 = k3;

  // fiche sans aucune adresse de compte : Elixir seul, avec la mention
  r = await poste("sans", { action: "creer_cle", environnement: "test", libelle: "Sans compte", portees: ["lecture"] });
  eq("sans compte : e-mail à Elixir seul", [r.statusCode, corps(r).avis_envoye, dernier().email_to, dernier().email_cc, /aucune adresse de compte/.test(dernier().body_html)], [201, true, "equipe@elixir.test", false, true]);
  eq("événement : sans_compte", evts("avis_envoye", corps(r).info.id)[0].detail.sans_compte, true);
}

// ═══ 4. Admin ═══
const verifierAdmin = async (event) => (String(event.headers?.authorization || "") === "Bearer admin" ? { admin: { email: "equipe@elixir.test" }, error: null }
  : { admin: null, error: { statusCode: 403, headers: {}, body: JSON.stringify({ error: "admin" }) } });
const ha = admin.creerHandler({ stock, verifierAdmin, verifierFiche: async (id) => ({ id, name: "PHARMACIE EXEMPLE", city: "Exempleville", cip: "2000001" }), listePrix: async () => 5,
  maintenant, journal: silence, avis, comptes });
const adm = (body) => ha({ httpMethod: "POST", headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer admin" }, body: JSON.stringify(body) });
const vue = (q) => ha({ httpMethod: "GET", headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer admin" }, queryStringParameters: q });
let cleAdmin;
{
  const n = mails.length;
  let r = await adm({ action: "creer_cle_admin", odoo_id: 595, environnement: "test", libelle: "Clé remise de vive voix", portees: ["lecture"], motif: "pharmacie sans compte du site" });
  cleAdmin = corps(r);
  eq("clé admin : e-mail à la pharmacie, origine Elixir", [r.statusCode, cleAdmin.avis_envoye, mails.length - n, dernier().email_to, /par Elixir Pharma, dans son administration/.test(dernier().body_html)], [201, true, 1, COMPTES[595].join(", "), true]);
  vrai("clé admin : le secret n'est ni dans l'e-mail ni dans les événements", !dernier().body_html.includes(cleAdmin.cle) && !JSON.stringify(db.tables.api_evenements).includes(cleAdmin.cle));
  r = await adm({ action: "revoquer_cle", id: cleLive.info.id, motif: "demande de la pharmacie par téléphone" });
  eq("révocation admin d'une clé de production : e-mail avec copie Elixir et motif", [r.statusCode, corps(r).avis_envoye, dernier().email_cc, /révoquée \(production\)/.test(dernier().subject), /motif : demande de la pharmacie par téléphone/.test(dernier().body_html)],
    [200, true, "equipe@elixir.test", true, true]);
  r = await vue({ vue: "tableau" });
  eq("tableau : aucune alerte pour l'instant", corps(r).alertes, []);
}

// ═══ 5. Passage planifié : reprise des avis en échec ═══
const cron = (horaire = { inactives: false, volumes: false }) => creerCron({ stock, odoo: async () => [], maintenant, journal: silence, lancer: async () => null, avis, comptes, horaire })();
{
  const k3 = globalThis.__k3;
  const n = mails.length;
  await cron();
  eq("reprise : l'avis en échec est renvoyé (tentative 2)", [mails.length - n, /créée \(test\)/.test(dernier().subject), dernier().body_html.includes(k3.info.prefixe), evts("avis_envoye", k3.info.id).map(e => e.detail.tentative)], [1, true, true, [2]]);
  await cron();
  eq("reprise : pas deux fois", mails.length - n, 1);
  // trois échecs : plus de reprise
  mailPanne = true;
  let r = await poste("pharmacie", { action: "creer_cle", environnement: "test", libelle: "Panne durable", portees: ["lecture"] });
  const k4 = corps(r);
  await cron(); await cron();
  eq("échecs successifs tracés (tentatives 1, 2, 3)", evts("avis_echec", k4.info.id).map(e => e.detail.tentative).sort(), [1, 2, 3]);
  mailPanne = false;
  await cron();
  eq("après 3 tentatives : abandon (aucun e-mail, aucune 4e tentative)", [mails.length - n, evts("avis_envoye", k4.info.id).length], [1, 0]);
  // révoquée entre-temps : la reprise d'un avis « créée » ne concerne que la clé encore connue (toujours renvoyé si tentatives restantes)
  vrai("un passage sans rien à faire ne lève pas", (await cron()) && true);
}

// ═══ 6. Clés inutilisées ═══
{
  const ligne = (id) => db.tables.api_cles.find(c => c.id === id);
  // clé A : jamais utilisée, créée il y a 91 jours ; clé B : utilisée il y a 10 jours ; clé C : remplacée (ignorée) ; clé D : 181 jours
  const creer = async (libelle) => (await cles.creerCle(stock, { acces: acces595, environnement: "live", libelle, portees: ["lecture"], par: COMPTES[595][0], role: "pharmacie", maintenant: maintenant() })).cle;
  const a = await creer("Jamais utilisée"), b = await creer("Récente"), c = await creer("Remplacée"), d = await creer("Oubliée");
  ligne(a.id).created_at = iso(T - 91 * J);
  ligne(b.id).created_at = iso(T - 400 * J); ligne(b.id).derniere_utilisation = iso(T - 10 * J);
  ligne(c.id).created_at = iso(T - 300 * J); ligne(c.id).expire_le = iso(T + 3 * J);
  ligne(d.id).created_at = iso(T - 400 * J); ligne(d.id).derniere_utilisation = iso(T - 181 * J);
  const n = mails.length, nn = notifs().length;
  await cron({ inactives: false, volumes: false });
  eq("hors de la passe quotidienne : rien", [evts("alerte_cle_inactive").length, mails.length - n], [0, 0]);
  await cron({ inactives: true, volumes: false });
  eq("91 jours jamais utilisée : signalée (une fois)", evts("alerte_cle_inactive").map(e => [e.cle_id, e.detail.jours_inactive, e.detail.jamais_utilisee, e.detail.prefixe, e.role]), [[a.id, 91, true, a.prefixe, "systeme"]]);
  vrai("signalée : notification et e-mail à Elixir", notifs().some(x => /API : clé inutilisée — PHARMACIE EXEMPLE/.test(x.title)) && mails.some(m => /clé inutilisée — PHARMACIE EXEMPLE/.test(m.subject) && m.email_to === "equipe@elixir.test"));
  const dd = ligne(d.id);
  eq("181 jours : révoquée automatiquement", [!!dd.revoquee_le, dd.revoquee_par, /inutilisée depuis 181 jours/.test(dd.motif_revocation)], [true, "systeme", true]);
  eq("révocation : événement systeme, automatique", evts("cle_revoquee", d.id).map(e => [e.role, e.detail.automatique, e.detail.jours_inactive]), [["systeme", true, 181]]);
  const mailRevoc = mails.find(m => /révoquée \(production\)/.test(m.subject) && m.body_html.includes(d.prefixe));
  vrai("révocation : e-mail à la pharmacie, copie Elixir, « rien à faire »", mailRevoc && mailRevoc.email_to === COMPTES[595].join(", ") && mailRevoc.email_cc === "equipe@elixir.test" && /il n'y a rien à faire/.test(mailRevoc.body_html));
  vrai("révocation : notification à Elixir", notifs().some(x => /Clé API révoquée automatiquement/.test(x.title)));
  eq("récente et remplacée : rien", [evts("alerte_cle_inactive", b.id).length, evts("alerte_cle_inactive", c.id).length, !!ligne(b.id).revoquee_le, !!ligne(c.id).revoquee_le], [0, 0, false, false]);
  const n2 = mails.length;
  await cron({ inactives: true, volumes: false });
  eq("passe suivante : pas de doublon", [evts("alerte_cle_inactive").length, mails.length - n2, notifs().length - nn], [1, 0, 2]);
  // réutilisée puis oubliée de nouveau : signalée de nouveau
  ligne(a.id).derniere_utilisation = iso(T - 95 * J);
  const nAvant = evts("alerte_cle_inactive").length;
  for (const e of db.tables.api_evenements) if (e.type === "alerte_cle_inactive" && e.cle_id === a.id) e.at = iso(T - 100 * J);
  await cron({ inactives: true, volumes: false });
  eq("réutilisée après un signalement, oubliée de nouveau : signalée de nouveau", evts("alerte_cle_inactive", a.id).length - nAvant, 1);
  // la révocation automatique s'arrête là si Odoo est muet pour l'e-mail : la révocation reste faite, l'échec est tracé
  const e2 = await creer("Oubliée, Odoo muet");
  ligne(e2.id).created_at = iso(T - 200 * J);
  mailPanne = true;
  await cron({ inactives: true, volumes: false });
  mailPanne = false;
  eq("Odoo muet : révoquée quand même, avis en échec tracé", [!!ligne(e2.id).revoquee_le, evts("avis_echec", e2.id).length], [true, 1]);
  const n3 = mails.length;
  await cron();
  eq("…et l'e-mail part au passage suivant", [mails.length - n3, evts("avis_envoye", e2.id).length], [1, 1]);
}

// ═══ 7. Journal de la dernière heure : erreurs, réseaux ═══
let reqSeq = 0;
const ligneJournal = (cle, { at = T - 5 * MIN, statut = 200, code = null, reseau = "203.0.113.0/24", environnement = "live" } = {}) =>
  stock.journal.ajouter({ at: iso(at), request_id: `00000000-0000-4000-8000-${String(++reqSeq).padStart(12, "0")}`, cle_id: cle.id, odoo_id: cle.odoo_id, environnement, methode: "GET", route: "/v1/etat", statut, code, duree_ms: 12, reseau });
const creerLive = async (libelle, odooId = 595) => (await cles.creerCle(stock, { acces: await stock.acces.lire(odooId), environnement: "live", libelle, portees: ["lecture"], par: "compte@x.test", role: "pharmacie", maintenant: maintenant() })).cle;
{
  // erreurs : 25 appels dont 10 refusés (40 %) ; une autre clé : 19 appels dont 19 refusés (trop peu d'appels) ; une autre : 2 % d'erreurs
  const err = await creerLive("Outil mal réglé"), peu = await creerLive("Peu d'appels"), sain = await creerLive("Outil sain");
  for (let i = 0; i < 25; i++) await ligneJournal(err, { statut: i < 10 ? 422 : 200, code: i < 10 ? "requete_invalide" : null });
  for (let i = 0; i < 19; i++) await ligneJournal(peu, { statut: 401, code: "portee_insuffisante" });
  for (let i = 0; i < 50; i++) await ligneJournal(sain, { statut: i === 0 ? 404 : 200 });
  // historique du réseau : clé déjà utilisée il y a 2 h depuis 203.0.113.0/24
  const n = mails.length;
  await cron();
  eq("erreurs : une alerte pour la clé à 40 %, rien pour 19 appels ni 2 %", evts("alerte_erreurs").map(e => [e.cle_id, e.detail.requetes, e.detail.erreurs, e.detail.part]), [[err.id, 25, 10, 40]]);
  vrai("erreurs : e-mail à Elixir", mails.slice(n).some(m => /trop d'erreurs — PHARMACIE EXEMPLE/.test(m.subject) && /10 réponses 4xx sur 25 appels/.test(m.body_html)));
  await cron();
  eq("erreurs : une alerte par heure", evts("alerte_erreurs").length, 1);

  // nouveau réseau : clé avec historique (il y a 2 h) qui appelle depuis un autre réseau ; clé sans historique : rien ;
  // clé d'un accès à réseaux autorisés : rien ; appels sur un aperçu : ignorés
  const hist = await creerLive("Avec historique"), neuve = await creerLive("Toute neuve"), bornee = await creerLive("Réseaux bornés", 777);
  await ligneJournal(hist, { at: T - 2 * H, reseau: "203.0.113.0/24" });
  await ligneJournal(hist, { at: T - 10 * MIN, reseau: "198.51.100.0/24" });
  await ligneJournal(hist, { at: T - 9 * MIN, reseau: "198.51.100.0/24" });
  await ligneJournal(hist, { at: T - 8 * MIN, reseau: "203.0.113.0/24" });
  await ligneJournal(neuve, { at: T - 10 * MIN, reseau: "198.51.100.0/24" });
  await stock.acces.modifier(777, { ip_autorisees: ["203.0.113.0/24"] });
  await ligneJournal(bornee, { at: T - 3 * H, reseau: "203.0.113.0/24" });
  await ligneJournal(bornee, { at: T - 10 * MIN, reseau: "192.0.2.0/24" });
  await ligneJournal(hist, { at: T - 7 * MIN, reseau: "192.0.2.0/24", environnement: "apercu" });
  await cron();
  eq("nouveau réseau : une alerte (clé avec historique, réseau jamais vu), rien pour la neuve, la bornée et l'aperçu",
    evts("alerte_nouveau_reseau").map(e => [e.cle_id, e.detail.reseau, e.detail.appels]), [[hist.id, "198.51.100.0/24", 2]]);
  await cron();
  eq("nouveau réseau : une alerte par (clé, réseau)", evts("alerte_nouveau_reseau").length, 1);
  vrai("détail : jamais d'adresse IP complète", !/\d{1,3}\.\d{1,3}\.\d{1,3}\.[1-9]\d{0,2}(?!\/)/.test(JSON.stringify(evts("alerte_nouveau_reseau"))));

  // réseau refusé : appels 403 ip_non_autorisee (accès 777)
  await ligneJournal(bornee, { at: T - 6 * MIN, statut: 403, code: "ip_non_autorisee", reseau: "192.0.2.0/24" });
  await ligneJournal(bornee, { at: T - 5 * MIN, statut: 403, code: "ip_non_autorisee", reseau: "192.0.2.0/24" });
  await cron();
  eq("réseau refusé : une alerte, 2 appels, réseau", evts("alerte_reseau_refuse").map(e => [e.cle_id, e.detail.appels, e.detail.reseaux]), [[bornee.id, 2, ["192.0.2.0/24"]]]);
  await ligneJournal(bornee, { at: T - 4 * MIN, statut: 403, code: "ip_non_autorisee", reseau: "192.0.2.0/24" });
  await cron();
  eq("réseau refusé : une alerte par jour", evts("alerte_reseau_refuse").length, 1);
  // la vue de l'admin liste les alertes des 30 derniers jours (l'alerte antidatée de 100 jours du § 6 n'y est plus) avec la pharmacie
  const t = corps(await vue({ vue: "tableau" }));
  const recentes = db.tables.api_evenements.filter(e => /^alerte_/.test(e.type) && Date.parse(e.at) >= T - 30 * J);
  eq("tableau : alertes des 30 jours, la plus récente d'abord, avec la pharmacie", [t.alertes.length, t.alertes[0].type, t.alertes[0].pharmacie, t.alertes.every(x => x.detail && x.detail.prefixe)],
    [recentes.length, "alerte_reseau_refuse", "PHARMACIE SANS COMPTE", true]);
}

// ═══ 8. Volume du jour ═══
{
  const vol = await creerLive("Synchro en boucle"), calme = await creerLive("Calme");
  const minuit = A.debutJourParis(new Date(T)).getTime();
  for (const c of [vol, calme]) db.tables.api_cles.find(x => x.id === c.id).derniere_utilisation = iso(T - MIN);
  // 350 appels aujourd'hui (hors de la fenêtre d'erreurs : il y a plus d'une heure), 14 appels sur les 14 jours précédents
  for (let i = 0; i < 350; i++) await ligneJournal(vol, { at: minuit + 5 * MIN + i * 1000 });
  for (let i = 1; i <= 14; i++) await ligneJournal(vol, { at: minuit - i * J + 3 * H });
  for (let i = 0; i < 299; i++) await ligneJournal(calme, { at: minuit + 5 * MIN + i * 1000 });
  await cron({ inactives: false, volumes: false });
  eq("hors de la première passe de l'heure : rien", evts("alerte_volume").length, 0);
  const n = mails.length;
  await cron({ inactives: false, volumes: true });
  eq("volume : une alerte (350 contre 1 par jour), rien sous 300", evts("alerte_volume").map(e => [e.cle_id, e.detail.appels_jour, e.detail.moyenne_jour]), [[vol.id, 350, 1]]);
  vrai("volume : e-mail à Elixir", mails.slice(n).some(m => /volume inhabituel — PHARMACIE EXEMPLE/.test(m.subject) && /350 appels aujourd'hui/.test(m.body_html)));
  await cron({ inactives: false, volumes: true });
  eq("volume : une alerte par jour", evts("alerte_volume").length, 1);
}

// ═══ 9. Bornes et pannes ═══
{
  // 7 clés en erreur d'un coup : 5 alertes au premier passage, 2 au suivant
  const nAvant = evts("alerte_erreurs").length;
  for (let k = 0; k < 7; k++) {
    const c = await creerLive(`Bruyante ${k}`);
    for (let i = 0; i < 20; i++) await ligneJournal(c, { at: T - 20 * MIN - k * 1000 - i * 10, statut: 422, code: "requete_invalide" });
  }
  await cron();
  eq("5 alertes au plus par passage", evts("alerte_erreurs").length - nAvant, 5);
  await cron();
  eq("…le reste au passage suivant", evts("alerte_erreurs").length - nAvant, 7);
  // Odoo muet pour les e-mails : les alertes sont quand même enregistrées et notifiées
  mailPanne = true;
  const c = await creerLive("Alerte sans e-mail");
  for (let i = 0; i < 20; i++) await ligneJournal(c, { at: T - 15 * MIN - i * 10, statut: 422, code: "requete_invalide" });
  const nn = notifs().length, nm = mails.length;
  const bilan = await cron();
  mailPanne = false;
  eq("Odoo muet : alerte enregistrée et notifiée, aucun e-mail, passage terminé", [evts("alerte_erreurs", c.id).length, notifs().length - nn, mails.length - nm, bilan.statusCode], [1, 1, 0, 200]);
  // Supabase injoignable : le passage ne lève pas
  db.etat.panne = true;
  const r = await cron();
  db.etat.panne = false;
  eq("Supabase injoignable : le passage rend 200", r.statusCode, 200);
}

// ═══ 10. Fichiers ═══
{
  const lire = (f) => readFileSync(join(APP, f), "utf8");
  const zones = lire("scripts/verifie-zones.mjs");
  vrai("zones : _api-avis.js admis (motif _api-[a-z-]+)", zones.includes("_api-[a-z-]+"));
  vrai("ce fichier et le module : aucune clé complète", !CLE_COMPLETE.test(lire("scripts/test-api-avis.mjs").replace(/CLE_COMPLETE = .*\n/, "")) && !CLE_COMPLETE.test(lire("netlify/functions/_api-avis.js")));
  const contrat = lire("docs/api.md"), mes = lire("docs/api/mise-en-service.md"), page = lire("public/api/index.html");
  vrai("contrat : § 11 (avis et alertes), seuils du code", contrat.includes("## 11.") && contrat.includes(`**${conf.ALERTES.inactive_jours} jours**`) && contrat.includes(`**${conf.ALERTES.revocation_jours} jours**`) && contrat.includes("alerte_cle_inactive"));
  vrai("mise en service : § 5.4, P9 livré, seuils", mes.includes("### 5.4") && /\*\*P9\*\*.*Livré/.test(mes) && mes.includes(`${conf.ALERTES.inactive_jours} jours`) && mes.includes(`${conf.ALERTES.revocation_jours} jours`) && !mes.includes("grisé"));
  vrai("page : e-mail d'avis et révocation automatique annoncés, version", page.includes("e-mail d'avis") && page.includes(`${conf.ALERTES.revocation_jours} jours`) && page.includes(`version ${conf.VERSION_API}`));
  vrai("netlify.toml : api-cron inchangé (toutes les 15 min)", /\[functions\."api-cron"\]\s+schedule = "\*\/15 \* \* \* \*"/.test(lire("netlify.toml")));
  vrai("api-cron : documentation de tête (P9)", /P9/.test(lire("netlify/functions/api-cron.js").split("\n").slice(0, 12).join("\n")));
}

console.log(`\nAPI des pharmacies (avis et alertes, P9) : ${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
