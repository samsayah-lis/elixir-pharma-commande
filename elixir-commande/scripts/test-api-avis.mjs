// Tests de l'API des pharmacies, P9 « avis par e-mail des clés et alertes d'usage » : node scripts/test-api-avis.mjs
// Hors ligne : faux PostgREST en mémoire (tables api_*, scripts/api-faux.mjs), faux Odoo (mail.mail : créations, envois, état,
// recherche par Message-ID, remise en file ; panne, lenteur et refus de la messagerie simulés — AUCUN e-mail réel), horloge
// simulée des budgets, fausse identité (compte de pharmacie), faux admin. Aucune donnée réelle : pharmacies, adresses et clés
// fictives, clés fabriquées à l'exécution (aucune clé complète dans ce fichier).
//  • textes : e-mails d'avis (créée, remplacée, révoquée ; compte, admin, automatique ; test et production ; sans compte),
//    e-mails d'alerte, échappement HTML, jamais le secret ;
//  • envoi : destinataires, Message-ID, budget (jamais au-delà), état « exception » de la messagerie, reprise idempotente ;
//  • compte de la pharmacie (api-compte) : e-mail aux adresses de compte, copie Elixir en production seulement, marque
//    « en attente » posée avant l'envoi, `avis_envoye` ; Odoo muet ou lent → clé créée quand même, réponse dans le budget,
//    échec tracé ; plafond des créations par heure, révocation jamais limitée ;
//  • admin (api-admin) : clé « sans compte » et révocation → e-mail « par Elixir Pharma » ; adresses illisibles → échec repris,
//    jamais « fiche sans compte » ;
//  • passage planifié (api-cron) : reprises espacées (15 min, 2 h, 8 h ; 4 tentatives), marque restée seule, abandon signalé,
//    3 reprises par passage, sans doublon ; clé inutilisée (signalée à 90 jours, révoquée à 180, 3 par passage) ; nouveau
//    réseau (un par clé et par jour), réseau refusé, erreurs (refus de réseau à part), volume ; dédoublonnage ; aperçus
//    ignorés ; 5 alertes par passage ; échéance du passage ; Odoo ou Supabase muets ne font jamais échouer le passage ;
//    surveillance même si l'étape des prix échoue ; vue=tableau de l'admin liste les alertes ;
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
const { AVIS, ALERTES } = conf;

let T = Date.parse("2026-10-26T09:00:00Z");   // date des données (lundi, 10 h à Paris)
const maintenant = () => new Date(T);
const iso = (ms = T) => new Date(ms).toISOString();
const MIN = 60e3, H_ = 3600e3, J = 86400e3;
const avancer = (ms) => { T += ms; };

const db = fauxPostgrestApi({ horloge: () => T });
const stock = creerStockApi({ fetch: db.fetch, maintenant });

// ── horloge simulée des budgets (millisecondes écoulées dans une requête ou un passage) ──
let H = 0;
const horloge = () => H;

// ── faux Odoo : mail.mail seulement ──
const mails = [], appelsOdoo = [];
let mailPanne = false, envoiPanne = false, smtpRefus = false, delaiOdoo = 0, idMail = 0;
const fauxOdoo = async (model, method, args, kwargs = {}, opts = {}) => {
  if (model !== "mail.mail") throw new Error(`modèle inattendu : ${model}`);
  appelsOdoo.push({ method, timeoutMs: opts.timeoutMs });
  if (delaiOdoo) {
    if (opts.timeoutMs && delaiOdoo > opts.timeoutMs) { H += opts.timeoutMs; throw new Error("délai dépassé (Odoo)"); }
    H += delaiOdoo;
  }
  if (mailPanne) throw new Error("Odoo injoignable");
  const trouve = (id) => mails.find(x => x.id === id);
  if (method === "create") { const m = { id: ++idMail, ...args[0], state: "outgoing", envois: 0 }; mails.push(m); return m.id; }
  if (method === "send") {
    if (envoiPanne) throw new Error("envoi interrompu");
    for (const id of args[0]) { const m = trouve(id); if (!m) throw new Error("mail inconnu"); m.envois++; m.state = smtpRefus ? "exception" : "sent"; }
    return true;
  }
  if (method === "read") return args[0].map(id => ({ id, state: trouve(id)?.state, failure_reason: false }));
  if (method === "search_read") { const val = args[0][0][2]; return mails.filter(m => m.message_id === val).slice(0, kwargs.limit || 80).map(m => ({ id: m.id, state: m.state })); }
  if (method === "mark_outgoing") { for (const id of args[0]) trouve(id).state = "outgoing"; return true; }
  throw new Error(`méthode inattendue : ${method}`);
};
const dernier = () => mails[mails.length - 1];
const avis = A.creerAvis({ odoo: fauxOdoo, journal: silence, horloge });
const reset = () => { mailPanne = false; envoiPanne = false; smtpRefus = false; delaiOdoo = 0; };

// ── fiches et accès ──
const COMPTES = { 595: ["titulaire@pharmacie-exemple.test", "adjoint@pharmacie-exemple.test"], 777: [], 888: ["compte@pharmacie-limite.test"], 999: ["compte@pharmacie-reprise.test"] };
let comptesPanne = false, comptesLents = false;
const comptes = async (id) => {
  if (comptesPanne) throw new Error("Odoo injoignable (adresses)");
  if (comptesLents) await new Promise(r => setTimeout(r, AVIS.delai_odoo_ms + 200));
  return COMPTES[id] || [];
};
const ouvrir = (odoo_id, nom, cip) => stock.acces.creer({ odoo_id, nom, cip, ville: "Exempleville", ouvert_par: "equipe@elixir.test",
  cgu_version: conf.CGU.version, cgu_acceptees_le: iso(), cgu_acceptees_par: "equipe@elixir.test", test_valide_le: iso(), liste_prix_lue_le: iso(T + 30 * J) });
await ouvrir(595, "PHARMACIE EXEMPLE", "2000001");
await ouvrir(777, "PHARMACIE SANS COMPTE", "2000002");
await ouvrir(888, "PHARMACIE LIMITE", "2000003");
await ouvrir(999, "PHARMACIE REPRISE", "2000004");
const acces595 = await stock.acces.lire(595);
const evts = (type, cleId = null) => db.tables.api_evenements.filter(e => e.type === type && (!cleId || e.cle_id === cleId)).map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
const notifs = () => db.tables.ec_notifications;
const corps = (r) => JSON.parse(r.body);

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
  t = A.texteAvisCle({ type: "cle_revoquee", cle: { ...cle, environnement: "test" }, acces: acces595, par: "equipe@elixir.test", role: "admin", quand: new Date(T), motif: "fuite <signalée>" });
  vrai("révoquée par l'admin (test) : origine Elixir, motif échappé, mention clé de test", /révoquée \(test\)/.test(t.sujet) && /par Elixir Pharma, dans son administration/.test(t.html) && /motif : fuite &lt;signalée&gt;/.test(t.html) && /clé de test ne passe aucune commande réelle/.test(t.html));
  t = A.texteAvisCle({ type: "cle_revoquee", cle, acces: acces595, par: "api-cron", role: "systeme", quand: new Date(T), motif: "inutilisée depuis 181 jours : révoquée automatiquement" });
  vrai("révocation automatique : origine, rien à faire", /automatiquement : inutilisée depuis 181 jours/.test(t.html) && /il n'y a rien à faire/.test(t.html) && !/Si vous n'êtes pas à l'origine/.test(t.html));
  t = A.texteAvisCle({ type: "cle_creee", cle, acces: acces595, par: "equipe@elixir.test", role: "admin", quand: new Date(T), sansCompte: true });
  vrai("sans compte : mention pour Elixir", /aucune adresse de compte du site/.test(t.html));
  for (const type of A.TYPES_ALERTE) {
    const a = A.texteAlerte({ type, acces: acces595, cle, detail: { jours_inactive: 91, appels: 3, reseaux: ["198.51.100.0/24"], erreurs: 10, requetes: 25, part: 40, appels_jour: 350, moyenne_jour: 12 } });
    vrai(`alerte ${type} : sujet et corps`, a.sujet.startsWith(`API des pharmacies : ${A.LIBELLES_ALERTE[type]} — PHARMACIE EXEMPLE`) && /elx_live_Ab3d…k9Qz/.test(a.html) && !CLE_COMPLETE.test(a.html));
  }
  vrai("alerte réseau refusé : « dans la dernière heure »", /refusés dans la dernière heure/.test(A.texteAlerte({ type: "alerte_reseau_refuse", acces: acces595, cle, detail: { appels: 2, reseaux: ["192.0.2.0/24"] } }).html));
  eq("MAIL_ELIXIR : variable, puis défaut", [A.MAIL_ELIXIR({ GP_ADMIN_MAIL: " x@elixir.test " }), A.MAIL_ELIXIR({})], ["x@elixir.test", "pharmacien@elixirpharma.fr"]);
  eq("début du jour de Paris (été, hiver)", [A.debutJourParis(new Date("2026-10-24T12:00:00Z")).toISOString(), A.debutJourParis(new Date("2026-12-01T12:00:00Z")).toISOString()],
    ["2026-10-23T22:00:00.000Z", "2026-11-30T23:00:00.000Z"]);
  eq("Message-ID d'un avis", A.messageIdAvis("00000000-0000-4000-8000-000000000001", "cle_creee"), "<api-avis-00000000-0000-4000-8000-000000000001-cle_creee@elixirpharma.fr>");
  eq("borne : valeur, échec, délai", [await A.borne(Promise.resolve(1), 50), await A.borne(Promise.reject(new Error("x")), 50, "d"), await A.borne(new Promise(() => {}), 20, "d")], [1, "d", "d"]);
  eq("P9 livré : cochable", [conf.PREREQUIS.find(p => p.id === "P9").indisponible ?? null, conf.prerequisEtat({}, new Date(T)).find(p => p.id === "P9").cochable], [null, true]);
  eq("réglages : 4 tentatives espacées, budget de requête 3 s, plafond 10 clés/heure", [AVIS.tentatives_max, AVIS.espacements_min, AVIS.budget_requete_ms, conf.CLES_CREATIONS_HEURE], [4, [15, 120, 480], 3000, 10]);
}

// ═══ 2. Envoi ═══
{
  let erreur = null;
  try { await avis.envoyer({ a: [], cc: null, sujet: "x", html: "<p>x</p>" }); } catch (e) { erreur = e.message; }
  eq("aucun destinataire : refusé", erreur, "aucun destinataire");
  await avis.envoyer({ a: ["A@Pharmacie.test ", "a@pharmacie.test", "pas-une-adresse"], cc: "equipe@elixir.test", sujet: "Sujet", html: "<p>x</p>", messageId: "<essai-1@elixirpharma.fr>" });
  eq("destinataires dédoublonnés, copie, Message-ID, envoyé", [dernier().email_to, dernier().email_cc, dernier().state, dernier().email_from, dernier().message_id, dernier().auto_delete],
    ["a@pharmacie.test", "equipe@elixir.test", "sent", "pharmacien@elixirpharma.fr", "<essai-1@elixirpharma.fr>", false]);
  await avis.envoyer({ a: [], cc: "equipe@elixir.test", sujet: "Sujet", html: "<p>x</p>" });
  eq("sans adresse de pharmacie : la copie devient destinataire", [dernier().email_to, dernier().email_cc], ["equipe@elixir.test", false]);
  // reprise : message déjà envoyé → rien de recréé ni de renvoyé
  const n = mails.length;
  const r = await avis.envoyer({ a: ["a@pharmacie.test"], sujet: "Sujet", html: "<p>x</p>", messageId: "<essai-1@elixirpharma.fr>", rechercher: true });
  eq("reprise d'un message déjà envoyé : retrouvé, ni recréé ni renvoyé", [r.deja, mails.length - n, mails.find(m => m.message_id === "<essai-1@elixirpharma.fr>").envois], [true, 0, 1]);
  // messagerie qui refuse (état exception) : échec ; la reprise remet en file et renvoie le MÊME message
  smtpRefus = true;
  erreur = null;
  try { await avis.envoyer({ a: ["b@pharmacie.test"], sujet: "Sujet", html: "<p>x</p>", messageId: "<essai-2@elixirpharma.fr>" }); } catch (e) { erreur = e.message; }
  eq("état « exception » après l'envoi : échec", erreur, "envoi refusé par la messagerie");
  smtpRefus = false;
  await avis.envoyer({ a: ["b@pharmacie.test"], sujet: "Sujet", html: "<p>x</p>", messageId: "<essai-2@elixirpharma.fr>", rechercher: true });
  const m2 = mails.filter(m => m.message_id === "<essai-2@elixirpharma.fr>");
  eq("…reprise : un seul message, remis en file puis envoyé", [m2.length, m2[0].state, m2[0].envois], [1, "sent", 2]);
  // budget : Odoo à 1,2 s par appel, budget de 3 s → jamais plus de 3 s, échec propre
  delaiOdoo = 1200; H = 0; erreur = null;
  try { await avis.envoyer({ a: ["c@pharmacie.test"], sujet: "S", html: "<p>x</p>", budgetMs: 3000 }); } catch (e) { erreur = e.message; }
  eq("Odoo lent : échec dans le budget (3 s au plus)", [!!erreur, H <= 3000], [true, true]);
  delaiOdoo = 2600; H = 0; erreur = null;
  try { await avis.envoyer({ a: ["c@pharmacie.test"], sujet: "S", html: "<p>x</p>" }); } catch (e) { erreur = e.message; }
  eq("appel Odoo au-delà de 2,5 s : coupé à 2,5 s", [erreur, H], ["délai dépassé (Odoo)", AVIS.delai_odoo_ms]);
  vrai("chaque appel borné à 2,5 s au plus", appelsOdoo.every(a => a.timeoutMs > 0 && a.timeoutMs <= AVIS.delai_odoo_ms));
  reset(); H = 0;
  mails.length = 0;
}

// ═══ 3. Compte de la pharmacie ═══
const CTX = {
  pharmacie: { odooId: 595, cip: "2000001", nom: "PHARMACIE EXEMPLE", mode: "complet", compteEmail: COMPTES[595][0], comptes: COMPTES[595], admin: null },
  sans: { odooId: 777, cip: "2000002", nom: "PHARMACIE SANS COMPTE", mode: "complet", compteEmail: "compte@sans.test", comptes: [], admin: null },
  limite: { odooId: 888, cip: "2000003", nom: "PHARMACIE LIMITE", mode: "complet", compteEmail: COMPTES[888][0], comptes: COMPTES[888], admin: null },
  reprise: { odooId: 999, cip: "2000004", nom: "PHARMACIE REPRISE", mode: "complet", compteEmail: COMPTES[999][0], comptes: COMPTES[999], admin: null },
};
const identifier = async (event) => { const j = String(event.headers?.authorization || "").replace(/^Bearer\s+/, ""); if (!CTX[j]) throw Object.assign(new Error("fiche"), { status: 403, code: "fiche", identite: true }); return CTX[j]; };
const hc = compte.creerHandler({ stock, identifier, maintenant, journal: silence, avis });
let ipSeq = 20;
const poste = (qui, body) => hc({ httpMethod: "POST", path: "/.netlify/functions/api-compte", headers: { host: "elixir-commande.expepharma.com", authorization: `Bearer ${qui}`, "x-nf-client-connection-ip": `203.0.113.${ipSeq++ % 250}` }, body: JSON.stringify(body) });
let cleLive;
{
  let r = await poste("pharmacie", { action: "creer_cle", environnement: "test", libelle: "Outil de test", portees: ["lecture"] });
  const cleTest = corps(r);
  eq("clé de test créée, avis envoyé", [r.statusCode, cleTest.avis_envoye, mails.length], [201, true, 1]);
  eq("e-mail : aux deux adresses de compte, sans copie Elixir (test), Message-ID de la clé", [dernier().email_to, dernier().email_cc, dernier().state, dernier().message_id],
    [COMPTES[595].join(", "), false, "sent", A.messageIdAvis(cleTest.info.id, "cle_creee")]);
  vrai("e-mail : sujet créée (test), début de la clé, jamais le secret", /créée \(test\)/.test(dernier().subject) && dernier().body_html.includes(cleTest.info.prefixe) && !dernier().body_html.includes(cleTest.cle) && !CLE_COMPLETE.test(dernier().body_html));
  eq("marque « en attente » posée avant l'envoi, puis « envoyé »", db.tables.api_evenements.filter(e => e.cle_id === cleTest.info.id && /^avis_/.test(e.type)).map(e => e.type), ["avis_en_attente", "avis_envoye"]);
  eq("événement avis_envoye (destinataires, pas de copie)", evts("avis_envoye", cleTest.info.id).map(e => [e.detail.avis, e.detail.destinataires, e.detail.copie_elixir, e.role, e.detail.tentative]), [["cle_creee", 2, false, "systeme", 1]]);
  vrai("événements sans secret", !JSON.stringify(db.tables.api_evenements).includes(cleTest.cle));

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
  eq("Odoo muet : clé créée, secret rendu, avis non envoyé", [r.statusCode, !!cles.analyserCle(k3.cle), k3.avis_envoye, mails.length], [201, true, false, 4]);
  eq("événement avis_echec (tentative 1, erreur, de quoi reprendre)", evts("avis_echec", k3.info.id).map(e => [e.detail.avis, e.detail.tentative, e.detail.erreur, e.detail.role, e.detail.par]),
    [["cle_creee", 1, "Odoo injoignable", "pharmacie", COMPTES[595][0]]]);
  reset();
  globalThis.__k3 = k3;

  // Odoo lent (1,2 s par appel) : la réponse part dans le budget avec le secret ; le message créé n'est jamais doublé ensuite
  delaiOdoo = 1200; H = 0;
  r = await poste("pharmacie", { action: "creer_cle", environnement: "test", libelle: "Odoo lent", portees: ["lecture"] });
  const k5 = corps(r);
  eq("Odoo lent : 201 avec le secret, avis non confirmé, 3 s au plus", [r.statusCode, !!cles.analyserCle(k5.cle), k5.avis_envoye, H <= AVIS.budget_requete_ms], [201, true, false, true]);
  eq("…le message existe déjà dans Odoo (créé, envoyé)", mails.filter(m => m.message_id === A.messageIdAvis(k5.info.id, "cle_creee")).map(m => m.state), ["sent"]);
  reset(); H = 0;
  globalThis.__k5 = k5;

  // fiche sans aucune adresse de compte (lecture réussie) : Elixir seul, avec la mention
  r = await poste("sans", { action: "creer_cle", environnement: "test", libelle: "Sans compte", portees: ["lecture"] });
  eq("sans compte : e-mail à Elixir seul", [r.statusCode, corps(r).avis_envoye, dernier().email_to, dernier().email_cc, /aucune adresse de compte/.test(dernier().body_html)], [201, true, "equipe@elixir.test", false, true]);
  eq("événement : sans_compte", evts("avis_envoye", corps(r).info.id)[0].detail.sans_compte, true);

  // plafond des créations : 10 par heure et par fiche ; la révocation reste toujours possible
  let derniere = null, refus = null;
  for (let i = 0; i < 11; i++) {
    r = await poste("limite", { action: "creer_cle", environnement: "test", libelle: `Essai ${i}`, portees: ["lecture"] });
    if (r.statusCode !== 201) { refus = r; break; }
    derniere = corps(r);
    await poste("limite", { action: "revoquer_cle", id: derniere.info.id });
  }
  eq("11e création dans l'heure : 429 trop_d_operations, Retry-After", [refus?.statusCode, refus && corps(refus).error, refus?.headers["Retry-After"], /10 au plus/.test(refus ? corps(refus).message : "")], [429, "trop_d_operations", "3600", true]);
  r = await poste("limite", { action: "creer_cle", environnement: "test", libelle: "Encore", portees: ["lecture"] });
  eq("…remplacement compris dans le plafond (refusé aussi)", [r.statusCode, corps(r).error], [429, "trop_d_operations"]);
  avancer(61 * MIN);
  r = await poste("limite", { action: "creer_cle", environnement: "test", libelle: "Une heure après", portees: ["lecture"] });
  eq("une heure après : de nouveau possible", r.statusCode, 201);
  const kl = corps(r);
  for (let i = 0; i < 9; i++) { const x = await poste("limite", { action: "creer_cle", environnement: "test", libelle: `Bis ${i}`, portees: ["lecture"] }); if (x.statusCode === 201) await poste("limite", { action: "revoquer_cle", id: corps(x).info.id }); }
  r = await poste("limite", { action: "revoquer_cle", id: kl.info.id });
  eq("révocation au-delà du plafond : toujours possible", r.statusCode, 200);
}

// ═══ 4. Admin ═══
const verifierAdmin = async (event) => (String(event.headers?.authorization || "") === "Bearer admin" ? { admin: { email: "equipe@elixir.test" }, error: null }
  : { admin: null, error: { statusCode: 403, headers: {}, body: JSON.stringify({ error: "admin" }) } });
const ha = admin.creerHandler({ stock, verifierAdmin, verifierFiche: async (id) => ({ id, name: "PHARMACIE EXEMPLE", city: "Exempleville", cip: "2000001" }), listePrix: async () => 5,
  maintenant, journal: silence, avis, comptes });
const adm = (body) => ha({ httpMethod: "POST", headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer admin" }, body: JSON.stringify(body) });
const vue = (q) => ha({ httpMethod: "GET", headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer admin" }, queryStringParameters: q });
{
  const n = mails.length;
  let r = await adm({ action: "creer_cle_admin", odoo_id: 595, environnement: "test", libelle: "Clé remise de vive voix", portees: ["lecture"], motif: "pharmacie sans compte du site" });
  const cleAdmin = corps(r);
  eq("clé admin : e-mail à la pharmacie, origine Elixir", [r.statusCode, cleAdmin.avis_envoye, mails.length - n, dernier().email_to, /par Elixir Pharma, dans son administration/.test(dernier().body_html)], [201, true, 1, COMPTES[595].join(", "), true]);
  vrai("clé admin : le secret n'est ni dans l'e-mail ni dans les événements", !dernier().body_html.includes(cleAdmin.cle) && !JSON.stringify(db.tables.api_evenements).includes(cleAdmin.cle));
  r = await adm({ action: "revoquer_cle", id: cleLive.info.id, motif: "demande de la pharmacie par téléphone" });
  eq("révocation admin d'une clé de production : e-mail avec copie Elixir et motif", [r.statusCode, corps(r).avis_envoye, dernier().email_cc, /révoquée \(production\)/.test(dernier().subject), /motif : demande de la pharmacie par téléphone/.test(dernier().body_html)],
    [200, true, "equipe@elixir.test", true, true]);
  // adresses illisibles : rien n'est envoyé, échec repris plus tard — jamais la version « fiche sans compte »
  comptesPanne = true;
  const n2 = mails.length;
  r = await adm({ action: "creer_cle_admin", odoo_id: 595, environnement: "live", libelle: "Adresses illisibles", portees: ["lecture"], motif: "pharmacie sans compte du site" });
  const kIll = corps(r);
  comptesPanne = false;
  eq("adresses illisibles : 201, avis non envoyé, aucun e-mail", [r.statusCode, kIll.avis_envoye, mails.length - n2], [201, false, 0]);
  eq("…échec « adresses de compte illisibles », jamais « sans compte »", evts("avis_echec", kIll.info.id).map(e => [e.detail.erreur, e.detail.tentative, e.detail.sans_compte ?? null]), [["adresses de compte illisibles", 1, null]]);
  globalThis.__kIll = kIll;
  // adresses trop lentes (au-delà de 2,5 s) : même chose
  comptesLents = true;
  r = await adm({ action: "revoquer_cle", id: kIll.info.id, motif: "essai" });
  comptesLents = false;
  eq("adresses trop lentes : révoquée, avis en échec (repris)", [r.statusCode, corps(r).avis_envoye, evts("avis_echec", kIll.info.id).filter(e => e.detail.avis === "cle_revoquee").length], [200, false, 1]);
  r = await vue({ vue: "tableau" });
  eq("tableau : aucune alerte pour l'instant", corps(r).alertes, []);
}

// ═══ 5. Passage planifié : reprise des avis ═══
const cron = (opts = {}) => creerCron({ stock, odoo: async () => [], maintenant, journal: silence, lancer: async () => null, avis, comptes, horloge,
  horaire: { inactives: false, volumes: false }, ...opts })();
{
  const k3 = globalThis.__k3, k5 = globalThis.__k5, kIll = globalThis.__kIll;
  // k3 et k5 : échecs du § 3, il y a plus d'une heure (le plafond horaire a avancé l'horloge) ; kIll : échecs du § 4, à l'instant
  await cron();
  eq("échec de plus de 15 min : renvoyé (tentative 2)", [evts("avis_envoye", k3.info.id).map(e => e.detail.tentative), /créée \(test\)/.test(mails.find(m => m.message_id === A.messageIdAvis(k3.info.id, "cle_creee"))?.subject || "")], [[2], true]);
  eq("Odoo lent : le message déjà envoyé est retrouvé, ni recréé ni renvoyé", [evts("avis_envoye", k5.info.id).map(e => e.detail.tentative), mails.filter(m => m.message_id === A.messageIdAvis(k5.info.id, "cle_creee")).length, mails.find(m => m.message_id === A.messageIdAvis(k5.info.id, "cle_creee")).envois], [[2], 1, 1]);
  eq("échecs de moins de 15 min : pas encore repris", evts("avis_envoye", kIll.info.id).length, 0);
  avancer(16 * MIN);
  await cron();
  const envoyesIll = evts("avis_envoye", kIll.info.id);
  eq("adresses illisibles : relues 15 min après, les deux avis partis vers la pharmacie (copie Elixir)", [envoyesIll.length, envoyesIll.every(e => e.detail.destinataires === 2 && e.detail.copie_elixir)], [2, true]);
  const n2 = mails.length;
  await cron();
  eq("rien de plus à reprendre : aucun e-mail", mails.length - n2, 0);

  // marque restée seule (fonction coupée pendant l'envoi) : reprise après 2 min
  const kc = (await cles.creerCle(stock, { acces: acces595, environnement: "test", libelle: "Coupée", portees: ["lecture"], par: COMPTES[595][0], role: "pharmacie", maintenant: maintenant() })).cle;
  await stock.evenements.ajouter({ type: "avis_en_attente", odoo_id: 595, cle_id: kc.id, par: "api-avis", role: "systeme",
    detail: { avis: "cle_creee", destinataires: 2, copie_elixir: false, par: COMPTES[595][0], role: "pharmacie", motif: null, expire: null, quand: iso(), tentative: 0 } });
  avancer(1 * MIN);
  await cron();
  eq("marque seule depuis 1 min : pas encore", evts("avis_envoye", kc.id).length, 0);
  avancer(2 * MIN);
  await cron();
  eq("marque seule depuis 3 min : reprise (tentative 2)", evts("avis_envoye", kc.id).map(e => [e.detail.tentative, e.detail.destinataires]), [[2, 2]]);

  // panne durable : tentatives à 0, 15 min, 2 h 15, 10 h 15 ; abandon signalé
  mailPanne = true;
  const r = await poste("reprise", { action: "creer_cle", environnement: "test", libelle: "Panne durable", portees: ["lecture"] });
  const k4 = corps(r);
  eq("(clé créée pendant la panne)", [r.statusCode, k4.avis_envoye], [201, false]);
  const tentatives = () => evts("avis_echec", k4.info.id).map(e => e.detail.tentative).sort();
  avancer(16 * MIN); await cron();
  eq("tentative 2 après 15 min", tentatives(), [1, 2]);
  avancer(60 * MIN); await cron();
  eq("1 h plus tard : pas de 3e tentative (2 h d'espacement)", tentatives(), [1, 2]);
  avancer(61 * MIN); await cron();
  eq("tentative 3 après 2 h", tentatives(), [1, 2, 3]);
  avancer(481 * MIN); await cron();
  const fin = evts("avis_echec", k4.info.id).find(e => e.detail.tentative === 4);
  eq("tentative 4 après 8 h : abandon", [tentatives(), fin?.detail.abandon], [[1, 2, 3, 4], true]);
  vrai("abandon : notification « prévenez la pharmacie »", notifs().some(x => /E-mail d'avis de clé API non envoyé — PHARMACIE REPRISE/.test(x.title) && /Prévenez la pharmacie/.test(x.body)));
  reset();
  avancer(600 * MIN); await cron();
  eq("après l'abandon : plus rien (aucune 5e tentative, aucun e-mail)", [tentatives().length, evts("avis_envoye", k4.info.id).length], [4, 0]);

  // 5 avis en échec : 3 reprises au plus par passage
  const acces999 = await stock.acces.lire(999);
  const lot = [];
  for (let i = 0; i < 5; i++) {
    const k = (await cles.creerCle(stock, { acces: acces999, environnement: "test", libelle: `Lot ${i}`, portees: ["lecture"], par: COMPTES[999][0], role: "pharmacie", maintenant: maintenant() })).cle;
    lot.push(k.id);
    await stock.evenements.ajouter({ type: "avis_echec", odoo_id: 999, cle_id: k.id, par: "api-avis", role: "systeme",
      detail: { avis: "cle_creee", destinataires: 1, copie_elixir: false, par: COMPTES[999][0], role: "pharmacie", motif: null, expire: null, quand: iso(), tentative: 1, erreur: "Odoo injoignable" } });
  }
  avancer(16 * MIN); await cron();
  eq("3 reprises au plus par passage", lot.filter(id => evts("avis_envoye", id).length).length, AVIS.reprises_par_passage);
  await cron();
  eq("…les autres au passage suivant", lot.filter(id => evts("avis_envoye", id).length).length, 5);
}

// ═══ 6. Clés inutilisées ═══
const ligneCle = (id) => db.tables.api_cles.find(c => c.id === id);
const creerLive = async (libelle, odooId = 595) => (await cles.creerCle(stock, { acces: await stock.acces.lire(odooId), environnement: "live", libelle, portees: ["lecture"], par: "compte@x.test", role: "pharmacie", maintenant: maintenant() })).cle;
{
  // ménage : clés créées plus haut, rendues récentes (le § 6 ne concerne que les clés qu'il crée)
  for (const c of db.tables.api_cles) if (!c.revoquee_le) c.derniere_utilisation = iso();
  const a = await creerLive("Jamais utilisée"), b = await creerLive("Récente"), c = await creerLive("Remplacée"), d = await creerLive("Oubliée");
  ligneCle(a.id).created_at = iso(T - 91 * J);
  ligneCle(b.id).created_at = iso(T - 400 * J); ligneCle(b.id).derniere_utilisation = iso(T - 10 * J);
  ligneCle(c.id).created_at = iso(T - 300 * J); ligneCle(c.id).expire_le = iso(T + 3 * J);
  ligneCle(d.id).created_at = iso(T - 400 * J); ligneCle(d.id).derniere_utilisation = iso(T - 181 * J);
  const n = mails.length, nn = notifs().length;
  await cron();
  eq("hors de la passe quotidienne : rien", [evts("alerte_cle_inactive").length, mails.length - n], [0, 0]);
  await cron({ horaire: { inactives: true, volumes: false } });
  eq("91 jours jamais utilisée : signalée (une fois)", evts("alerte_cle_inactive").map(e => [e.cle_id, e.detail.jours_inactive, e.detail.jamais_utilisee, e.detail.prefixe, e.role]), [[a.id, 91, true, a.prefixe, "systeme"]]);
  vrai("signalée : notification et e-mail à Elixir", notifs().some(x => /API : clé inutilisée — PHARMACIE EXEMPLE/.test(x.title)) && mails.some(m => /clé inutilisée — PHARMACIE EXEMPLE/.test(m.subject) && m.email_to === "equipe@elixir.test"));
  const dd = ligneCle(d.id);
  eq("181 jours : révoquée automatiquement", [!!dd.revoquee_le, dd.revoquee_par, /inutilisée depuis 181 jours/.test(dd.motif_revocation)], [true, "systeme", true]);
  eq("révocation : événement systeme, automatique", evts("cle_revoquee", d.id).map(e => [e.role, e.detail.automatique, e.detail.jours_inactive]), [["systeme", true, 181]]);
  eq("révocation : marque « en attente » puis « envoyé »", db.tables.api_evenements.filter(e => e.cle_id === d.id && /^avis_/.test(e.type)).map(e => e.type), ["avis_en_attente", "avis_envoye"]);
  const mailRevoc = mails.find(m => /révoquée \(production\)/.test(m.subject) && m.body_html.includes(d.prefixe));
  vrai("révocation : e-mail à la pharmacie, copie Elixir, « rien à faire »", mailRevoc && mailRevoc.email_to === COMPTES[595].join(", ") && mailRevoc.email_cc === "equipe@elixir.test" && /il n'y a rien à faire/.test(mailRevoc.body_html));
  vrai("révocation : notification à Elixir", notifs().some(x => /Clé API révoquée automatiquement/.test(x.title)));
  eq("récente et remplacée : rien", [evts("alerte_cle_inactive", b.id).length, evts("alerte_cle_inactive", c.id).length, !!ligneCle(b.id).revoquee_le, !!ligneCle(c.id).revoquee_le], [0, 0, false, false]);
  const n2 = mails.length;
  await cron({ horaire: { inactives: true, volumes: false } });
  eq("passe suivante : pas de doublon", [evts("alerte_cle_inactive").length, mails.length - n2, notifs().length - nn], [1, 0, 2]);
  // réutilisée puis oubliée de nouveau : signalée de nouveau
  ligneCle(a.id).derniere_utilisation = iso(T - 95 * J);
  const nAvant = evts("alerte_cle_inactive").length;
  for (const e of db.tables.api_evenements) if (e.type === "alerte_cle_inactive" && e.cle_id === a.id) e.at = iso(T - 100 * J);
  await cron({ horaire: { inactives: true, volumes: false } });
  eq("réutilisée après un signalement, oubliée de nouveau : signalée de nouveau", evts("alerte_cle_inactive", a.id).length - nAvant, 1);
  // 5 clés à révoquer : 3 par passage
  const vieilles = [];
  for (let i = 0; i < 5; i++) { const k = await creerLive(`Très vieille ${i}`); ligneCle(k.id).created_at = iso(T - 300 * J); vieilles.push(k.id); }
  await cron({ horaire: { inactives: true, volumes: false } });
  eq("révocations automatiques : 3 par passage", vieilles.filter(id => ligneCle(id).revoquee_le).length, ALERTES.revocations_par_passage);
  await cron({ horaire: { inactives: true, volumes: false } });
  eq("…les autres au passage suivant", vieilles.filter(id => ligneCle(id).revoquee_le).length, 5);
  // Odoo muet pour l'e-mail : révoquée quand même, l'échec est tracé et repris 15 min plus tard
  const e2 = await creerLive("Oubliée, Odoo muet");
  ligneCle(e2.id).created_at = iso(T - 200 * J);
  mailPanne = true;
  await cron({ horaire: { inactives: true, volumes: false } });
  reset();
  eq("Odoo muet : révoquée quand même, avis en échec tracé", [!!ligneCle(e2.id).revoquee_le, evts("avis_echec", e2.id).length], [true, 1]);
  avancer(16 * MIN);
  const n3 = mails.length;
  await cron();
  eq("…et l'e-mail part au passage suivant (15 min après)", [mails.length - n3, evts("avis_envoye", e2.id).length], [1, 1]);
  // adresses illisibles lors d'une révocation automatique : échec repris, jamais « sans compte »
  const e3 = await creerLive("Oubliée, adresses illisibles");
  ligneCle(e3.id).created_at = iso(T - 200 * J);
  comptesPanne = true;
  await cron({ horaire: { inactives: true, volumes: false } });
  comptesPanne = false;
  eq("révocation automatique, adresses illisibles : échec, aucun « sans compte »", [!!ligneCle(e3.id).revoquee_le, evts("avis_echec", e3.id).map(e => e.detail.erreur), evts("avis_envoye", e3.id).length], [true, ["adresses de compte illisibles"], 0]);
}

// ═══ 7. Journal de la dernière heure : erreurs, réseaux ═══
let reqSeq = 0;
const ligneJournal = (cle, { at = T - 5 * MIN, statut = 200, code = null, reseau = "203.0.113.0/24", environnement = "live" } = {}) =>
  stock.journal.ajouter({ at: iso(at), request_id: `00000000-0000-4000-8000-${String(++reqSeq).padStart(12, "0")}`, cle_id: cle.id, odoo_id: cle.odoo_id, environnement, methode: "GET", route: "/v1/etat", statut, code, duree_ms: 12, reseau });
{
  // erreurs : 25 appels dont 10 refusés (40 %) ; une autre clé : 19 appels dont 19 refusés (trop peu d'appels) ; une autre : 2 %
  const err = await creerLive("Outil mal réglé"), peu = await creerLive("Peu d'appels"), sain = await creerLive("Outil sain");
  for (let i = 0; i < 25; i++) await ligneJournal(err, { statut: i < 10 ? 422 : 200, code: i < 10 ? "requete_invalide" : null });
  for (let i = 0; i < 19; i++) await ligneJournal(peu, { statut: 401, code: "portee_insuffisante" });
  for (let i = 0; i < 50; i++) await ligneJournal(sain, { statut: i === 0 ? 404 : 200 });
  const n = mails.length;
  await cron();
  eq("erreurs : une alerte pour la clé à 40 %, rien pour 19 appels ni 2 %", evts("alerte_erreurs").map(e => [e.cle_id, e.detail.requetes, e.detail.erreurs, e.detail.part]), [[err.id, 25, 10, 40]]);
  vrai("erreurs : e-mail à Elixir", mails.slice(n).some(m => /trop d'erreurs — PHARMACIE EXEMPLE/.test(m.subject) && /10 réponses 4xx sur 25 appels/.test(m.body_html)));
  await cron();
  eq("erreurs : une alerte par heure", evts("alerte_erreurs").length, 1);

  // nouveau réseau : clé avec historique (il y a 2 h) qui appelle depuis un autre réseau ; clé sans historique : rien ;
  // clé d'un accès à réseaux autorisés : rien ; appels sur un aperçu : ignorés
  const hist = await creerLive("Avec historique"), neuve = await creerLive("Toute neuve"), bornee = await creerLive("Réseaux bornés", 777);
  await ligneJournal(hist, { at: T - 2 * H_, reseau: "203.0.113.0/24" });
  await ligneJournal(hist, { at: T - 10 * MIN, reseau: "198.51.100.0/24" });
  await ligneJournal(hist, { at: T - 9 * MIN, reseau: "198.51.100.0/24" });
  await ligneJournal(hist, { at: T - 8 * MIN, reseau: "203.0.113.0/24" });
  await ligneJournal(neuve, { at: T - 10 * MIN, reseau: "198.51.100.0/24" });
  await stock.acces.modifier(777, { ip_autorisees: ["203.0.113.0/24"] });
  await ligneJournal(bornee, { at: T - 3 * H_, reseau: "203.0.113.0/24" });
  await ligneJournal(bornee, { at: T - 10 * MIN, reseau: "192.0.2.0/24" });
  await ligneJournal(hist, { at: T - 7 * MIN, reseau: "192.0.2.0/24", environnement: "apercu" });
  await cron();
  eq("nouveau réseau : une alerte (clé avec historique, réseau jamais vu), rien pour la neuve, la bornée et l'aperçu",
    evts("alerte_nouveau_reseau").map(e => [e.cle_id, e.detail.reseaux, e.detail.appels]), [[hist.id, ["198.51.100.0/24"], 2]]);
  await ligneJournal(hist, { at: T - 2 * MIN, reseau: "2001:db8:1:2::/64" });
  await cron();
  eq("nouveau réseau : une alerte par clé et par jour (un 2e réseau le même jour : rien)", evts("alerte_nouveau_reseau").length, 1);
  vrai("détail : jamais d'adresse IP complète", !/\d{1,3}\.\d{1,3}\.\d{1,3}\.[1-9]\d{0,2}(?!\/)/.test(JSON.stringify(evts("alerte_nouveau_reseau"))));

  // réseau refusé : appels 403 ip_non_autorisee (accès 777), jamais comptés dans « erreurs »
  for (let i = 0; i < 25; i++) await ligneJournal(bornee, { at: T - 6 * MIN + i * 1000, statut: 403, code: "ip_non_autorisee", reseau: "192.0.2.0/24" });
  await cron();
  eq("réseau refusé : une alerte, 25 appels, réseau", evts("alerte_reseau_refuse").map(e => [e.cle_id, e.detail.appels, e.detail.reseaux]), [[bornee.id, 25, ["192.0.2.0/24"]]]);
  eq("…et pas d'alerte « trop d'erreurs » pour les mêmes refus", evts("alerte_erreurs", bornee.id).length, 0);
  await ligneJournal(bornee, { at: T - 4 * MIN, statut: 403, code: "ip_non_autorisee", reseau: "192.0.2.0/24" });
  await cron();
  eq("réseau refusé : une alerte par jour", evts("alerte_reseau_refuse").length, 1);
  // la vue de l'admin liste les alertes des 30 derniers jours (l'alerte antidatée de 100 jours du § 6 n'y est plus)
  const t = corps(await vue({ vue: "tableau" }));
  const recentes = db.tables.api_evenements.filter(e => /^alerte_/.test(e.type) && Date.parse(e.at) >= T - 30 * J);
  eq("tableau : alertes des 30 jours, la plus récente d'abord, avec la pharmacie", [t.alertes.length, t.alertes[0].type, t.alertes[0].pharmacie, t.alertes.every(x => x.detail && x.detail.prefixe)],
    [recentes.length, "alerte_reseau_refuse", "PHARMACIE SANS COMPTE", true]);
}

// ═══ 8. Volume du jour ═══
{
  const vol = await creerLive("Synchro en boucle"), calme = await creerLive("Calme");
  const minuit = A.debutJourParis(new Date(T)).getTime();
  for (const c of [vol, calme]) ligneCle(c.id).derniere_utilisation = iso(T - MIN);
  // 350 appels aujourd'hui (il y a plus d'une heure : hors de la fenêtre des erreurs), 14 appels sur les 14 jours précédents
  for (let i = 0; i < 350; i++) await ligneJournal(vol, { at: minuit + 5 * MIN + i * 1000 });
  for (let i = 1; i <= 14; i++) await ligneJournal(vol, { at: minuit - i * J + 3 * H_ });
  for (let i = 0; i < 299; i++) await ligneJournal(calme, { at: minuit + 5 * MIN + i * 1000 });
  vrai("(les appels du jour sont à plus d'une heure de maintenant)", minuit + 5 * MIN + 350e3 < T - H_);
  await cron();
  eq("hors de la première passe de l'heure : rien", evts("alerte_volume").length, 0);
  const n = mails.length;
  await cron({ horaire: { inactives: false, volumes: true } });
  eq("volume : une alerte (350 contre 1 par jour), rien sous 300", evts("alerte_volume").map(e => [e.cle_id, e.detail.appels_jour, e.detail.moyenne_jour]), [[vol.id, 350, 1]]);
  vrai("volume : e-mail à Elixir", mails.slice(n).some(m => /volume inhabituel — PHARMACIE EXEMPLE/.test(m.subject) && /350 appels aujourd'hui/.test(m.body_html)));
  await cron({ horaire: { inactives: false, volumes: true } });
  eq("volume : une alerte par jour", evts("alerte_volume").length, 1);
}

// ═══ 9. Bornes, échéance et pannes ═══
{
  // 7 clés en erreur d'un coup : 5 alertes au premier passage, 2 au suivant
  const nAvant = evts("alerte_erreurs").length;
  const bruyantes = [];
  for (let k = 0; k < 7; k++) {
    const c = await creerLive(`Bruyante ${k}`);
    bruyantes.push(c);
    for (let i = 0; i < 20; i++) await ligneJournal(c, { at: T - 20 * MIN - k * 1000 - i * 10, statut: 422, code: "requete_invalide" });
  }
  await cron();
  eq("5 alertes au plus par passage", evts("alerte_erreurs").length - nAvant, 5);
  await cron();
  eq("…le reste au passage suivant", evts("alerte_erreurs").length - nAvant, 7);
  // échéance : Odoo à 1 s par appel (3 appels par e-mail) → 2 alertes tiennent avant l'échéance de 8,5 s, la suite attend
  for (const e of db.tables.api_evenements) if (e.type === "alerte_erreurs") e.at = iso(T - 2 * H_);   // anciennes : à refaire
  for (const c of bruyantes) for (let i = 0; i < 20; i++) await ligneJournal(c, { at: T - 10 * MIN - i * 10, statut: 422, code: "requete_invalide" });
  delaiOdoo = 1000; H = 0;
  const avant = evts("alerte_erreurs").length;
  let bilan = null;
  const cronEchu = creerCron({ stock, odoo: async () => [], maintenant, journal: silence, lancer: async () => null, comptes, horloge, horaire: { inactives: false, volumes: false },
    avis: { ...avis, surveiller: async (s, o) => (bilan = await avis.surveiller(s, o)) } });
  await cronEchu();
  reset();
  eq("échéance : 2 alertes, passage arrêté avant 8,5 s, signalé", [evts("alerte_erreurs").length - avant, bilan.coupe, H <= ALERTES.echeance_ms], [2, true, true]);
  H = 0;
  // Odoo muet pour les e-mails : les alertes sont quand même enregistrées et notifiées
  mailPanne = true;
  const c = await creerLive("Alerte sans e-mail");
  for (let i = 0; i < 20; i++) await ligneJournal(c, { at: T - 15 * MIN - i * 10, statut: 422, code: "requete_invalide" });
  for (const e of db.tables.api_evenements) if (e.type === "alerte_erreurs") e.at = iso(T - 2 * H_);
  for (const e of db.tables.api_journal) if (e.statut === 422 && e.cle_id !== c.id) e.at = iso(T - 3 * H_);
  const nn = notifs().length, nm = mails.length;
  const rep = await cron();
  reset();
  eq("Odoo muet : alerte enregistrée et notifiée, aucun e-mail, passage terminé", [evts("alerte_erreurs", c.id).length, notifs().length - nn, mails.length - nm, rep.statusCode], [1, 1, 0, 200]);
  // Supabase injoignable : le passage ne lève pas
  db.etat.panne = true;
  const r = await cron();
  db.etat.panne = false;
  eq("Supabase injoignable : le passage rend 200", r.statusCode, 200);
  // l'étape des prix échoue : la surveillance tourne quand même, avec son échéance
  let appel = null;
  const stockCasse = { ...stock, acces: { ...stock.acces, lister: async () => { throw new Error("accès illisibles"); } } };
  const r2 = await creerCron({ stock: stockCasse, odoo: async () => [], maintenant, journal: silence, lancer: async () => null, comptes, horloge: () => 1000,
    avis: { surveiller: async (s, o) => { appel = o; return {}; } } })();
  eq("étape des prix en échec : surveillance quand même, échéance depuis le début du passage", [r2.statusCode, !!appel, appel?.echeance], [200, true, 1000 + ALERTES.echeance_ms]);
}

// ═══ 10. Fichiers ═══
{
  const lire = (f) => readFileSync(join(APP, f), "utf8");
  const zones = lire("scripts/verifie-zones.mjs");
  vrai("zones : _api-avis.js admis (motif _api-[a-z-]+)", zones.includes("_api-[a-z-]+"));
  vrai("ce fichier et le module : aucune clé complète", !CLE_COMPLETE.test(lire("scripts/test-api-avis.mjs").replace(/CLE_COMPLETE = .*\n/, "")) && !CLE_COMPLETE.test(lire("netlify/functions/_api-avis.js")));
  const contrat = lire("docs/api.md"), mes = lire("docs/api/mise-en-service.md"), page = lire("public/api/index.html");
  vrai("contrat : § 11 (avis et alertes), seuils du code", contrat.includes("## 11.") && contrat.includes(`**${ALERTES.inactive_jours} jours**`) && contrat.includes(`**${ALERTES.revocation_jours} jours**`) && contrat.includes("alerte_cle_inactive")
    && contrat.includes(`**${AVIS.tentatives_max} tentatives**`) && contrat.includes(`**${conf.CLES_CREATIONS_HEURE} par heure**`));
  vrai("contrat : espacements des reprises du code (15 min, 2 h, 8 h)", AVIS.espacements_min.join() === "15,120,480" && /15 min, puis 2 h, puis 8 h/.test(contrat));
  vrai("mise en service : § 5.4, P9 livré, seuils", mes.includes("### 5.4") && /\*\*P9\*\*.*Livré/.test(mes) && mes.includes(`${ALERTES.inactive_jours} jours`) && mes.includes(`${ALERTES.revocation_jours} jours`) && !mes.includes("grisé")
    && mes.includes(`${AVIS.tentatives_max} tentatives`) && mes.includes(`${conf.CLES_CREATIONS_HEURE} clés par heure`) && /au moins 20 %/.test(mes) && !/plus de 20 %/.test(mes));
  vrai("page : e-mail d'avis, plafond des clés et révocation automatique annoncés, version", page.includes("e-mail d'avis") && page.includes(`${ALERTES.revocation_jours} jours`) && page.includes(`${conf.CLES_CREATIONS_HEURE} clés créées ou remplacées par heure`) && page.includes(`version ${conf.VERSION_API}`));
  vrai("netlify.toml : api-cron inchangé (toutes les 15 min)", /\[functions\."api-cron"\]\s+schedule = "\*\/15 \* \* \* \*"/.test(lire("netlify.toml")));
  vrai("api-cron : documentation de tête (P9, échéance)", /P9/.test(lire("netlify/functions/api-cron.js").split("\n").slice(0, 16).join("\n")) && /échéance|ALERTES\.echeance_ms/.test(lire("netlify/functions/api-cron.js")));
  vrai("relais et enregistrement des commandes du site : intouchés par P9", !/_api-avis|avisCle/.test(lire("netlify/functions/_relais.js") + lire("netlify/functions/order-save.js")));
}

console.log(`\nAPI des pharmacies (avis et alertes, P9) : ${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
