// Tests des messages unitaires et collectifs des notifications : node scripts/test-push-messages.mjs
// Hors ligne : aucune requête vers Supabase, Resend, Google, Apple ni Mozilla. Clés VAPID, clés d'appareil et secret de l'API
// générés EN MÉMOIRE à chaque passage (rien n'est écrit, rien n'est affiché).
//  1. règles : types → catégories, destinataires, montants, champs à compléter, e-mail de secours, programmation, heure de
//     Paris (heure d'été, heure d'hiver, heure inexistante), soir et dimanche, plafonds, liens (/?commandes=1) ;
//  2. modèles Elixir : bornes, aucun montant, champs à compléter (jamais envoyables tels quels), remplis → valides ;
//  3. diffusion : plafond des informations à part, plafond de sécurité « commandes » (24 h), message transactionnel jamais
//     bloqué par une diffusion plafonnée ; e-mail de secours (adresses de COMPTE seulement, une par adresse, idempotence,
//     alerte coupée, plafond, ouverture fermée) ; e-mail à la charte, échappé ; envoi Resend borné ;
//  4. programmation : push-admin (5 min, 60 jours, annulation), push-programmes (dus, retard de plus de 3 h, deux passages
//     simultanés, relance des messages restés en file) ;
//  5. API de l'outil entrepôt (push-evenement) : signature HMAC identique au contrat « chatbot-intake », horodatage ±5 min,
//     corps altéré, Idempotency-Key, doublons, plafond de sécurité, débit, aperçu, charge déchiffrée (catégorie, lien,
//     étiquette à clé) ;
//  6. push-admin : recherche (adresses masquées seulement), estimation, historique d'une pharmacie, modèles, refus ;
//  7. creerStockPush : chemins PostgREST des nouvelles lectures et écritures, repli sans les colonnes de push-messages.sql ;
//  7 bis. correctifs de la revue : e-mail de secours plafonné et compté, Promotion sans e-mail, relances bornées à 3 h et
//     jamais la nuit, annulation en file, API (débit avant signature, échecs passagers rejouables, orpheline, doublon 10 min,
//     différé de nuit), estimation = envoi, clé idem par contenu, modèles remplacés, effacement, conservation ;
//  8. rendu de l'onglet (React côté serveur) et empaquetage esbuild des nouvelles fonctions (comme Netlify).
import crypto from "node:crypto";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import webpush from "web-push";
import * as R from "../src/notifications/regles.js";
import { MODELES_ELIXIR, verifierModele } from "../src/notifications/modeles.js";
import * as P from "../netlify/functions/_push.js";
import * as M from "../netlify/functions/_push-messages.js";
import { creerHandler as handlerAdmin } from "../netlify/functions/push-admin.js";
import { creerHandler as handlerEnvoi } from "../netlify/functions/push-envoi-background.js";
import { creerHandler as handlerEvenement } from "../netlify/functions/push-evenement.js";
import { creerHandler as handlerProgrammes } from "../netlify/functions/push-programmes.js";
import { stockMemoire } from "./push-stock-memoire.mjs";

const RACINE = new URL("..", import.meta.url).pathname;
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const b64u = (b) => Buffer.from(b).toString("base64url");
const corpsDe = (r) => JSON.parse(r.body || "null");
const MIN = 60e3, H = 3600e3, J = 86400e3;

// ── 1. Règles ──
{
  eq("types → catégories", R.IDS_TYPES.map((t) => [t, R.categorieDuType(t), R.estTransactionnel(t)]),
    [["promotion", "offres", false], ["communication", "infos", false], ["reclamation", "commandes", true], ["commande", "commandes", true]]);
  eq("catégories : 4, ordre fixe, libellé « Mes commandes et réclamations », toutes par défaut", [R.IDS_CATEGORIES, R.CATEGORIES[1].libelle, R.CATEGORIES_DEFAUT],
    [["stock", "commandes", "infos", "offres"], "Mes commandes et réclamations", ["stock", "commandes", "infos", "offres"]]);
  eq("aides selon les plafonds (offres 3, informations 1)", R.categoriesAffichees(3, 1).filter((c) => ["infos", "offres"].includes(c.id)).map((c) => /\d par semaine/.exec(c.aide)?.[0]),
    ["1 par semaine", "3 par semaine"]);
  eq("informations à 0 : aucun envoi en ce moment", /aucun envoi/.test(R.aideInfos(0)), true);
  eq("lien /?commandes=1 admis, /?commandes=2 refusé", [R.lienValide("/?commandes=1"), R.lienValide("/?commandes=2")], ["/?commandes=1", null]);
  const base = { titre: "Réclamation traitée", corps: "Votre réclamation EN-601-2026-12 est traitée.", url: "/?commandes=1" };
  const v = (m) => R.verifierMessage({ ...base, ...m });
  eq("réclamation à une pharmacie : valide, catégorie commandes", [v({ type: "reclamation", audience: "une", cips: ["2000001"] }).ok, v({ type: "reclamation", audience: "une", cips: ["2000001"] }).message.categorie], [true, "commandes"]);
  eq("réclamation à toutes : refusée", v({ type: "reclamation", audience: "toutes" }).erreurs.some((e) => /jamais toutes/.test(e)), true);
  eq("commande à 21 pharmacies : refusée (20 au plus)", v({ type: "commande", audience: "liste", cips: Array.from({ length: 21 }, (_, i) => String(3000000 + i)) }).ok, false);
  eq("communication à 21 pharmacies : admise", v({ type: "communication", audience: "liste", cips: Array.from({ length: 21 }, (_, i) => String(3000000 + i)) }).ok, true);
  eq("une : un seul CIP", v({ type: "reclamation", audience: "une", cips: ["2000001", "2000002"] }).ok, false);
  eq("montant dans une réclamation : refusé ; dans une promotion : admis", [v({ type: "reclamation", audience: "une", cips: ["2000001"], corps: "Avoir de 12,50 € émis." }).ok,
    v({ type: "reclamation", audience: "une", cips: ["2000001"], corps: "Avoir de 30 euros." }).ok, v({ type: "promotion", corps: "Vaseline à 2,90 € HT." }).ok], [false, false, true]);
  eq("contientMontant", ["12 €", "3,5 EUR", "10 euros", "€", "tournée 3", "Europe", "24 h"].map(R.contientMontant), [true, true, true, true, false, false, false]);
  eq("champs à compléter : refusés ; « [NOUVEAU] » admis", [v({ type: "reclamation", audience: "une", cips: ["2000001"], corps: "Votre réclamation [référence] est traitée." }).ok,
    v({ type: "promotion", titre: "[NOUVEAU] Vaseline" }).ok, R.champsACompleter("le [n° de commande] et [date]")], [false, true, ["[n° de commande]", "[date]"]]);
  eq("e-mail de secours : message unitaire seulement", [v({ type: "reclamation", audience: "une", cips: ["2000001"], repli_email: true }).message.repli_email,
    v({ type: "commande", audience: "liste", cips: ["2000001"], repli_email: true }).message.repli_email], [true, false]);
  eq("type inconnu refusé ; sans type : promotion", [v({ type: "pub" }).ok, v({}).message.type], [false, "promotion"]);
  eq("verifierAnnonce (forme d'avant) : inchangée", R.verifierAnnonce({ titre: "t", corps: "c", url: "/", audience: "liste", cips: ["2000001"] }),
    { ok: true, erreurs: [], annonce: { titre: "t", corps: "c", url: "/", audience: "liste", cips: ["2000001"] } });
  const t0 = Date.parse("2026-10-21T10:00:00Z");
  eq("programmation : 4 min refusée, 6 min admise, 61 jours refusée, illisible refusée", [R.verifierProgrammation(new Date(t0 + 4 * MIN).toISOString(), t0).ok,
    R.verifierProgrammation(new Date(t0 + 6 * MIN).toISOString(), t0).ok, R.verifierProgrammation(new Date(t0 + 61 * J).toISOString(), t0).ok, R.verifierProgrammation("demain", t0).ok],
  [false, true, false, false]);
  eq("heure de Paris → UTC : été (+2), hiver (+1)", [R.parisVersIso("2026-10-21T08:30"), R.parisVersIso("2026-12-01T08:30")], ["2026-10-21T06:30:00.000Z", "2026-12-01T07:30:00.000Z"]);
  eq("heure inexistante (29/03/2026 02:30) et date impossible : null", [R.parisVersIso("2026-03-29T02:30"), R.parisVersIso("2026-02-30T10:00"), R.parisVersIso("22/10/2026 08:30")], [null, null, null]);
  eq("heure double (25/10/2026 02:30) : lisible, aller-retour", R.isoVersParis(R.parisVersIso("2026-10-25T02:30")), "2026-10-25T02:30");
  eq("aller-retour ISO ↔ Paris", R.isoVersParis("2026-07-14T19:05:00Z"), "2026-07-14T21:05");
  eq("hors heures : 7 h 59, 8 h, 19 h 59, 20 h (jeudi), dimanche 10 h", ["2026-10-22T05:59:00Z", "2026-10-22T06:00:00Z", "2026-10-22T17:59:00Z", "2026-10-22T18:00:00Z", "2026-10-25T09:00:00Z"]
    .map((d) => R.horsHeures(Date.parse(d))), [true, false, false, true, true]);
  eq("réglages : plafonds des informations et de sécurité bornés", [R.verifierReglages({ ouverture: "toutes", plafond_offres_7j: 2, plafond_infos_7j: 8 }).ok,
    R.verifierReglages({ ouverture: "toutes", plafond_offres_7j: 2, plafond_commandes_jour: 0 }).ok, R.verifierReglages({ ouverture: "toutes", plafond_offres_7j: 2, plafond_commandes_jour: 51 }).ok,
    R.verifierReglages({ ouverture: "toutes", plafond_offres_7j: 2 }).reglages], [false, false, false,
    { ouverture: "toutes", pilote_cips: [], plafond_offres_7j: 2, plafond_infos_7j: 2, plafond_commandes_jour: 10 }]);
  eq("plafondDe", [R.plafondDe("offres", R.REGLAGES_DEFAUT).fenetreMs, R.plafondDe("infos", { plafond_infos_7j: 1 }).max, R.plafondDe("commandes", R.REGLAGES_DEFAUT).fenetreMs, R.plafondDe("stock", R.REGLAGES_DEFAUT)],
    [7 * J, 1, J, null]);
}

// ── 2. Modèles Elixir ──
{
  const remplir = (t) => t.replace(/\[[^\]]+\]/g, "X12");
  for (const m of MODELES_ELIXIR) {
    const brut = R.verifierMessage({ type: m.type, titre: m.titre, corps: m.corps, url: m.url, audience: R.estTransactionnel(m.type) ? "une" : "toutes", cips: ["2000001"] });
    const rempli = R.verifierMessage({ type: m.type, titre: remplir(m.titre), corps: remplir(m.corps), url: m.url, audience: R.estTransactionnel(m.type) ? "une" : "toutes", cips: ["2000001"] });
    eq(`modèle « ${m.nom} » : bornes, aucun montant, envoi refusé tant que les crochets restent, valide une fois rempli`,
      [R.longueur(m.titre) <= 60, R.longueur(remplir(m.corps)) <= 160, R.contientMontant(m.corps), brut.ok, rempli.ok, verifierModele(m).ok], [true, true, false, false, true, true]);
  }
  eq("modèles demandés présents", MODELES_ELIXIR.map((m) => m.id), ["reclamation_recue", "reclamation_traitee", "retour_accepte", "avoir_emis", "commande_expediee", "reliquat",
    "fermeture_exceptionnelle", "nouveau_menu", "offre_du_moment"]);
  eq("modèle à enregistrer : nom, type, bornes", [verifierModele({ nom: "", type: "promotion", titre: "t", corps: "c", url: "/" }).ok, verifierModele({ nom: "x".repeat(41), type: "promotion", titre: "t", corps: "c" }).ok,
    verifierModele({ nom: "Ok", type: "pub", titre: "t", corps: "c" }).ok, verifierModele({ nom: "Ok", type: "commande", titre: "t", corps: "c", url: "https://x.fr" }).ok], [false, false, false, false]);
}

// ── Outils communs : clés en mémoire, appareils d'essai, transport espion, déchiffrement ──
const VAPID = webpush.generateVAPIDKeys();
const ENV = { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: "mailto:pharmacien@elixirpharma.fr",
  SUPABASE_URL: "https://essai.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-serveur-essai", CRON_SECRET: "secret-essai" };
const CONF = P.configPush(ENV);
const HOTE = "127.0.0.1:9", ESSAI = [HOTE];
const appareils = new Map();   // endpoint → { ecdh, auth }
function ligne(chemin, extra = {}) {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `http://${HOTE}${chemin}`;
  appareils.set(endpoint, { ecdh, authBrut: auth });
  return { id: crypto.randomUUID(), endpoint, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth), role: "pharmacie", plateforme: "android",
    ...(extra.pharmacy_cip && !extra.compte_email ? { compte_email: `p${extra.pharmacy_cip}@pharma.fr` } : {}), ...extra };
}
function dechiffre(endpoint, corps) {
  const a = appareils.get(endpoint);
  const salt = corps.subarray(0, 16), idlen = corps[20], asPublic = corps.subarray(21, 21 + idlen), chiffre = corps.subarray(21 + idlen);
  const secret = a.ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, a.authBrut, Buffer.concat([Buffer.from("WebPush: info\0"), a.ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  let fin = clair.length - 1; while (clair[fin] === 0) fin--;
  return JSON.parse(clair.subarray(0, fin).toString("utf8"));
}
function espion(statuts = {}) {
  const recus = [];
  const transport = async (u, init) => {
    recus.push({ endpoint: u, chemin: new URL(u).pathname, topic: init.headers.Topic, urgence: init.headers.Urgency, ttl: init.headers.TTL, charge: dechiffre(u, Buffer.from(init.body)) });
    return new Response(null, { status: statuts[new URL(u).pathname] ?? 201 });
  };
  return { recus, transport };
}
const UTIL = { "jeton-admin": { email: "pharmacien@elixirpharma.fr", isAdmin: true } };
const verifierAdmin = async (e) => { const u = UTIL[String(e.headers.authorization || "").replace("Bearer ", "")]; return u ? { admin: u } : { error: { statusCode: 403, headers: {}, body: "{}" } }; };
let nIp = 0;
const A = (corps, { hote = "elixir-commande.expepharma.com" } = {}) => ({ httpMethod: "POST", headers: { host: hote, authorization: "Bearer jeton-admin", "x-nf-client-connection-ip": `10.9.0.${++nIp % 250}` },
  body: JSON.stringify(corps), queryStringParameters: {} });

// ── 3. Diffusion : plafonds par catégorie, messages transactionnels, e-mail de secours ──
{
  // pharmacies : 5000001 (commandes + infos), 5000002 (offres seulement), 5000003 (aucun appareil, deux comptes),
  // 5000004 (appareil qui échoue), 5000005 (commandes coupée)
  const lignes = [
    ligne("/d/1", { pharmacy_cip: "5000001", categories: ["stock", "commandes", "infos"] }),
    ligne("/d/2", { pharmacy_cip: "5000002", categories: ["offres"] }),
    ligne("/d/4", { pharmacy_cip: "5000004", categories: ["stock", "commandes", "infos", "offres"] }),
    ligne("/d/5", { pharmacy_cip: "5000005", categories: ["stock", "offres"] }),
  ];
  const pharmacies = [
    { email: "p5000001@pharma.fr", name: "PHARMACIE UN", cip: "5000001", ville: "Versailles" },
    { email: "p5000002@pharma.fr", name: "PHARMACIE DEUX", cip: "5000002", ville: "Paris" },
    { email: "titulaire@trois.fr", name: "PHARMACIE TROIS", cip: "5000003", ville: "Rambouillet" }, { email: "adjoint@trois.fr", name: "PHARMACIE TROIS", cip: "5000003", ville: "Rambouillet" },
    // l'e-mail de la fiche Odoo de TROIS est partagé avec QUATRE (même titulaire) : rattaché à QUATRE, jamais utilisé pour TROIS
    { email: "groupe@titulaire.fr", name: "PHARMACIE QUATRE", cip: "5000004", ville: "Plaisir" }, { email: "p5000004@pharma.fr", name: "PHARMACIE QUATRE", cip: "5000004", ville: "Plaisir" },
    { email: "p5000005@pharma.fr", name: "PHARMACIE CINQ", cip: "5000005", ville: "Viroflay" },
  ];
  const stock = stockMemoire({ reglages: { ouverture: "toutes", plafond_offres_7j: 2, plafond_infos_7j: 1, plafond_commandes_jour: 2 }, lignes, pharmacies });
  const { recus, transport } = espion({ "/d/4": 500 });
  const mails = [];
  const envoyerEmail = async (m) => { mails.push(m); return { sent: true }; };
  const bg = handlerEnvoi({ stock, config: () => CONF, transport, hotesEssai: ESSAI, journal: () => {}, autoriser: () => true, envoyerEmail });
  const lancer = async (id) => bg({ httpMethod: "POST", headers: {}, body: JSON.stringify({ annonce: id }) });
  const creer = async (m) => (await stock.annonces.creer({ titre: "Titre", corps: "Texte", url: "/?commandes=1", statut: "en_file", ...m })).annonce;
  const parId = (id) => stock.db.annonces.find((a) => a.id === id);

  // informations : plafond à part (1 par 7 jours), indépendant des offres
  stock.db.envois.push({ id: 900, categorie: "offres", pharmacy_cip: "5000001", nb_appareils: 1, nb_reussis: 1, created_at: new Date(Date.now() - J).toISOString() });
  const i1 = await creer({ type: "communication", categorie: "infos", titre: "Fermeture exceptionnelle", audience: "toutes", url: "/" });
  await lancer(i1.id);
  eq("communication : appareils abonnés aux informations (5000001 ; 5000004 en échec), catégorie infos dans la charge, TTL et étiquette msg-",
    [recus.map((r) => r.chemin).sort(), recus[0]?.charge.categorie, recus[0]?.ttl, /^msg-/.test(recus[0]?.topic || ""), parId(i1.id).statut, parId(i1.id).nb_reussis, parId(i1.id).nb_echecs],
    [["/d/1", "/d/4"], "infos", 86400, true, "envoyee", 1, 1]);
  eq("push_envois : titre, type, source « message »", stock.db.envois.filter((e) => e.annonce_id === i1.id).map((e) => [e.pharmacy_cip, e.categorie, e.titre, e.type, e.source]).sort(),
    [["5000001", "infos", "Fermeture exceptionnelle", "communication", "message"], ["5000004", "infos", "Fermeture exceptionnelle", "communication", "message"]]);
  recus.length = 0;
  const i2 = await creer({ type: "communication", categorie: "infos", audience: "toutes", url: "/" });
  await lancer(i2.id);
  eq("2e communication de la semaine : 5000001 plafonnée (1 réussie), 5000004 (échec, non comptée) servie", [recus.map((r) => r.chemin), parId(i2.id).nb_plafonnees], [["/d/4"], 1]);

  // transactionnel : jamais bloqué par une diffusion plafonnée en cours
  stock.db.annonces.push({ id: crypto.randomUUID(), type: "promotion", categorie: "offres", statut: "en_cours", started_at: new Date().toISOString(), created_at: new Date().toISOString(), titre: "x", corps: "x", url: "/" });
  recus.length = 0;
  const c1 = await creer({ type: "reclamation", categorie: "commandes", titre: "Réclamation traitée", audience: "une", cips: ["5000001"] });
  await lancer(c1.id);
  eq("réclamation pendant une diffusion d'offres : envoyée, charge commandes, lien Mes commandes", [parId(c1.id).statut, recus.map((r) => [r.chemin, r.charge.categorie, r.charge.url])],
    ["envoyee", [["/d/1", "commandes", "/?commandes=1"]]]);
  const o1 = await creer({ type: "promotion", categorie: "offres", audience: "toutes", url: "/" });
  await lancer(o1.id);
  eq("promotion pendant une autre diffusion plafonnée : reste en file (une seule à la fois)", parId(o1.id).statut, "en_file");
  stock.db.annonces = stock.db.annonces.filter((a) => a.statut !== "en_cours");

  // plafond de sécurité « commandes » : 2 envois TENTÉS par 24 h
  recus.length = 0;
  for (let i = 0; i < 2; i++) await lancer((await creer({ type: "commande", categorie: "commandes", audience: "une", cips: ["5000001"] })).id);
  eq("plafond de sécurité : 2e commande (3e message transactionnel en 24 h) écartée", [recus.length, stock.db.annonces.at(-1).nb_plafonnees], [1, 1]);

  // e-mail de secours
  mails.length = 0; recus.length = 0;
  const r1 = await creer({ type: "reclamation", categorie: "commandes", titre: "Réclamation traitée", corps: "Votre réclamation EN-601-2026-12 est traitée.", audience: "une", cips: ["5000003"], repli_email: true });
  await lancer(r1.id);
  eq("pharmacie sans appareil : e-mail de secours aux 2 adresses de son COMPTE (jamais l'adresse partagée rattachée à une autre)",
    [parId(r1.id).statut, parId(r1.id).email_statut, parId(r1.id).nb_emails, mails.map((m) => m.to).sort(), recus.length], ["envoyee", "envoye", 2, ["adjoint@trois.fr", "titulaire@trois.fr"], 0]);
  eq("un e-mail par adresse, clé d'idempotence distincte et stable", [mails.length, new Set(mails.map((m) => m.idempotence)).size, mails.every((m) => m.idempotence.startsWith(`push-msg-${r1.id}-`))], [2, 2, true]);
  eq("e-mail : objet = titre, texte et lien Mes commandes, charte (pétrole), nom de la pharmacie", [mails[0].subject, mails[0].html.includes("Votre réclamation EN-601-2026-12 est traitée."),
    mails[0].html.includes("https://elixir-commande.expepharma.com/?commandes=1"), mails[0].html.includes("#0f2d3d"), mails[0].html.includes("PHARMACIE TROIS"), mails[0].html.includes("Voir mes commandes")],
  ["Réclamation traitée", true, true, true, true, true]);
  eq("push_envois de la pharmacie : ligne sans appareil, e-mail envoyé", stock.db.envois.filter((e) => e.annonce_id === r1.id).map((e) => [e.pharmacy_cip, e.nb_appareils, e.email]), [["5000003", 0, "envoye"]]);
  mails.length = 0;
  // plafond de sécurité de 5000001 remis à zéro : la pharmacie est jointe sur son téléphone Android
  stock.db.envois = stock.db.envois.filter((e) => !(e.pharmacy_cip === "5000001" && e.categorie === "commandes"));
  const r2 = await creer({ type: "reclamation", categorie: "commandes", audience: "une", cips: ["5000001"], repli_email: true });
  await lancer(r2.id);
  eq("pharmacie jointe sur son téléphone : pas d'e-mail (inutile)", [parId(r2.id).email_statut, mails.length], ["non_requis", 0]);
  const r3 = await creer({ type: "reclamation", categorie: "commandes", audience: "une", cips: ["5000005"], repli_email: true });
  await lancer(r3.id);
  eq("transactionnel, alerte « Mes commandes » coupée : e-mail quand même (suivi de son dossier)", [parId(r3.id).email_statut, mails.map((m) => m.to)], ["envoye", ["p5000005@pharma.fr"]]);
  mails.length = 0;
  const r4 = await creer({ type: "communication", categorie: "infos", audience: "une", cips: ["5000002"], repli_email: true, url: "/" });
  await lancer(r4.id);
  eq("communication, alerte « Informations » coupée sur ses appareils : jamais d'e-mail (son choix, noté)", [parId(r4.id).email_statut, mails.length], ["alerte_coupee", 0]);
  const r5 = await creer({ type: "communication", categorie: "infos", audience: "une", cips: ["5000001"], repli_email: true, url: "/" });
  await lancer(r5.id);
  eq("plafond atteint : ni notification ni e-mail (noté « plafond »)", [parId(r5.id).nb_plafonnees, parId(r5.id).email_statut, mails.length], [1, "plafond", 0]);
  const r6 = await creer({ type: "commande", categorie: "commandes", audience: "une", cips: ["5000009"], repli_email: true });
  await lancer(r6.id);
  eq("aucun compte pour ce CIP : aucune adresse", parId(r6.id).email_statut, "aucune_adresse");
  stock.db.reglages = R.fusionnerReglages({ ouverture: "fermee" });
  const r7 = await creer({ type: "reclamation", categorie: "commandes", audience: "une", cips: ["5000003"], repli_email: true });
  await lancer(r7.id);
  const r8 = await creer({ type: "reclamation", categorie: "commandes", audience: "une", cips: ["5000003"] });
  await lancer(r8.id);
  eq("ouverture fermée : e-mail de secours seul (envoyé, noté) ; sans e-mail de secours : erreur, rien", [parId(r7.id).statut, parId(r7.id).email_statut, /e-mail de secours/.test(parId(r7.id).erreur),
    parId(r8.id).statut], ["envoyee", "envoye", true, "erreur"]);
  const html = M.emailSecours({ type: "promotion", titre: "<script>x</script>\r\nBcc: a@b.fr", corps: "a & b <img src=x>", url: "https://autre.fr" }).html;
  const sujet = M.emailSecours({ titre: "Ligne 1\r\nBcc: a@b.fr", corps: "x" }).subject;
  eq("e-mail : textes échappés, lien hors site → accueil, objet sur une ligne", [html.includes("<script>"), html.includes("&lt;img"), html.includes('href="https://autre.fr'), /[\r\n]/.test(sujet)], [false, true, false, false]);
  eq("adresse masquée", [M.masquerEmail("titulaire@trois.fr"), M.masquerEmail("x")], ["ti…@…fr", null]);
}
{
  // envoi Resend : sans clé, refus, déjà envoyé (idempotence), délai ; en-têtes et corps
  eq("Resend sans clé : non envoyé", (await M.envoyerEmailResend({ to: "a@b.fr", subject: "s", html: "h" }, { env: {} })).sent, false);
  let vu = null;
  const r = await M.envoyerEmailResend({ to: "a@b.fr", subject: "s", html: "h", idempotence: "push-msg-1" }, { env: { RESEND_API_KEY: "cle-essai" },
    http: async (u, init) => { vu = { u, h: init.headers, b: JSON.parse(init.body) }; return new Response("{}", { status: 200 }); } });
  eq("Resend : expéditeur Elixir, une adresse, clé d'idempotence, réponse à pharmacien@", [r.sent, vu.u, vu.h["Idempotency-Key"], vu.b.from, vu.b.to, vu.b.reply_to],
    [true, "https://api.resend.com/emails", "push-msg-1", "Elixir Pharma <pharmacien@elixirpharma.fr>", ["a@b.fr"], "pharmacien@elixirpharma.fr"]);
  eq("Resend 409 « déjà envoyé » : compté envoyé ; 422 : non", [(await M.envoyerEmailResend({ to: "a@b.fr" }, { env: { RESEND_API_KEY: "k" }, http: async () => new Response(JSON.stringify({ name: "invalid_idempotent_request" }), { status: 409 }) })).sent,
    (await M.envoyerEmailResend({ to: "a@b.fr" }, { env: { RESEND_API_KEY: "k" }, http: async () => new Response("{}", { status: 422 }) })).sent], [true, false]);
  const muet = (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  const garde = setTimeout(() => {}, 2000);   // AbortSignal.timeout ne retient pas la boucle d'événements de Node
  eq("Resend muet : délai dépassé", await M.envoyerEmailResend({ to: "a@b.fr" }, { env: { RESEND_API_KEY: "k" }, http: muet, delaiMs: 100 }), { sent: false, reason: "délai dépassé" });
  clearTimeout(garde);
  // 5 adresses au plus
  const st = stockMemoire({ pharmacies: Array.from({ length: 7 }, (_, i) => ({ email: `a${i}@x.fr`, name: "P", cip: "6000001" })) });
  const envois = [];
  const res = await M.creerRepli({ stock: st, envoyer: async (m) => { envois.push(m.to); return { sent: true }; } })({ annonce: { id: crypto.randomUUID(), type: "commande", titre: "t", corps: "c", url: "/" }, cip: "6000001" });
  eq("e-mail de secours : 5 adresses au plus", [res, envois.length], [{ statut: "envoye", nb: 5 }, 5]);
}

// ── 4. Programmation ──
{
  const t0 = Date.parse("2026-10-22T06:00:00Z");   // jeudi 8 h à Paris
  let maintenant = t0;
  const horloge = () => new Date(maintenant);
  const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/p/1", { pharmacy_cip: "7000001", categories: ["stock", "commandes", "infos", "offres"] })],
    pharmacies: [{ email: "p7000001@pharma.fr", name: "PHARMACIE SEPT", cip: "7000001" }], horloge });
  const lancements = [];
  const h = handlerAdmin({ stock, config: () => CONF, verifierAdmin, lancer: async (e, id) => { lancements.push(id); return null; }, maintenant: horloge, journal: () => {} });
  const msg = { type: "communication", titre: "Fermeture exceptionnelle", corps: "Elixir Pharma sera fermé le 1er novembre.", url: "/", audience: "toutes" };
  const trop = await h(A({ action: "envoyer", message: { ...msg, programme_pour: new Date(t0 + 3 * MIN).toISOString() }, idem: "prog-0000001" }));
  eq("programmé dans 3 min : refusé (5 min au moins)", [trop.statusCode, /5 minutes/.test(corpsDe(trop).erreurs?.[0] || "")], [400, true]);
  const p1 = await h(A({ action: "envoyer", message: { ...msg, programme_pour: "2026-10-22T09:00:00.000Z" }, idem: "prog-0000002" }));
  const id1 = corpsDe(p1).annonce?.id;
  eq("programmé : 200, statut programmée, rien lancé, heure exacte gardée", [p1.statusCode, corpsDe(p1).programmee, corpsDe(p1).annonce.statut, lancements.length, stock.db.annonces[0].programme_pour],
    [200, true, "programmee", 0, "2026-10-22T09:00:00.000Z"]);
  const p2 = await h(A({ action: "envoyer", message: { ...msg, programme_pour: "2026-10-22T10:00:00.000Z" }, idem: "prog-0000003" }));
  const id2 = corpsDe(p2).annonce.id;
  // une offre envoyée maintenant n'est pas bloquée par les messages programmés
  eq("envoi immédiat d'une offre malgré deux messages programmés : 202", (await h(A({ action: "envoyer", message: { ...msg, type: "promotion" }, idem: "prog-0000004" }))).statusCode, 202);
  stock.db.annonces.filter((a) => a.statut === "en_file").forEach((a) => { a.statut = "envoyee"; });
  const hist = corpsDe(await h(A({ action: "historique" })));
  eq("historique : programmés d'abord, par heure prévue", hist.annonces.slice(0, 2).map((a) => [a.id, a.statut]), [[id1, "programmee"], [id2, "programmee"]]);
  const an = await h(A({ action: "annuler", id: id2 }));
  eq("annuler un message programmé → annulé, par cet admin", [an.statusCode, corpsDe(an).annonce.statut, corpsDe(an).annonce.annule_par], [200, "annulee", "pharmacien@elixirpharma.fr"]);
  eq("annuler deux fois → 409", (await h(A({ action: "annuler", id: id2 }))).statusCode, 409);
  // push-programmes
  const lances = [];
  const lancer = async (id) => { lances.push(id); return null; };
  maintenant = Date.parse("2026-10-22T08:59:00Z");
  eq("avant l'heure : rien", (await M.traiterProgrammes({ stock, lancer, maintenant: horloge })).dus, 0);
  maintenant = Date.parse("2026-10-22T09:03:00Z");
  const [b1, b2] = await Promise.all([M.traiterProgrammes({ stock, lancer, maintenant: horloge }), M.traiterProgrammes({ stock, lancer, maintenant: horloge })]);
  eq("à l'heure (deux passages simultanés) : lancé une seule fois, l'annulé jamais", [b1.lances + b2.lances, lances, stock.db.annonces.find((a) => a.id === id1).statut, stock.db.annonces.find((a) => a.id === id2).statut],
    [1, [id1], "en_file", "annulee"]);
  // resté en file (lancement perdu) : relancé après 2 minutes
  maintenant += 3 * MIN;
  const b3 = await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  eq("resté « en file » 3 min : relancé", [b3.relances, lances.at(-1)], [1, id1]);
  // programmé puis service arrêté 4 h : jamais envoyé
  const p3 = await h(A({ action: "envoyer", message: { ...msg, programme_pour: new Date(maintenant + 10 * MIN).toISOString() }, idem: "prog-0000005" }));
  maintenant += 10 * MIN + 4 * H;
  const nLances = lances.length;
  const b4 = await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  const tard = stock.db.annonces.find((a) => a.id === corpsDe(p3).annonce.id);
  eq("plus de 3 h de retard : abandonné, expliqué, jamais lancé", [b4.abandonnes, tard.statut, /plus de 3 h/.test(tard.erreur), lances.length === nLances || lances.slice(nLances).every((x) => x !== tard.id)],
    [1, "erreur", true, true]);
  eq("50 programmés au plus", await (async () => {
    for (let i = 0; i < 50; i++) stock.db.annonces.push({ id: crypto.randomUUID(), statut: "programmee", programme_pour: new Date(maintenant + J).toISOString(), categorie: "infos", titre: "t", corps: "c", url: "/", created_at: new Date().toISOString() });
    return corpsDe(await h(A({ action: "envoyer", message: { ...msg, programme_pour: new Date(maintenant + J).toISOString() }, idem: "prog-0000006" }))).error;
  })(), "trop_de_programmes");
  const journaux = [];
  await handlerProgrammes({ config: () => P.configPush({}), journal: (o) => journaux.push(o) })();
  eq("push-programmes sans clé serveur : rien, noté", journaux, [{ evt: "push_programmes", code: "configuration" }]);
  const j2 = [];
  await handlerProgrammes({ stock, config: () => CONF, lancer, maintenant: horloge, journal: (o) => j2.push(o) })();
  eq("push-programmes : bilan au journal, sans contenu", Object.keys(j2[0] || {}).sort(), ["abandonnes", "dus", "echecs", "evt", "expires", "lances", "relances"]);
}

// ── 5. API de l'outil entrepôt (push-evenement) ──
{
  const SECRET = crypto.randomBytes(32).toString("hex");
  const t0 = Date.parse("2026-10-22T09:00:00Z");
  const horloge = () => new Date(t0);
  eq("signature : même calcul que l'API chatbot-intake (HMAC-SHA256 hexadécimal de « horodatage.corps »)",
    M.signer(SECRET, "1792659600", '{"a":1}'), `sha256=${crypto.createHmac("sha256", SECRET).update('1792659600.{"a":1}').digest("hex")}`);
  const stock = stockMemoire({ reglages: { ouverture: "toutes", plafond_commandes_jour: 3 }, lignes: [ligne("/e/1", { pharmacy_cip: "8000001", categories: ["commandes"] }),
    ligne("/e/2", { pharmacy_cip: "8000002", categories: ["stock"] })], horloge });
  const { recus, transport } = espion();
  const journaux = [];
  const h = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: (o) => journaux.push(o) });
  let n = 0;
  const evt = (corps, { cle = `entrepot-cle-${++n}`, ts = Math.floor(t0 / 1000), secret = SECRET, hote = "elixir-commande.expepharma.com", alterer = null, entetes = {} } = {}) => {
    const texte = typeof corps === "string" ? corps : JSON.stringify(corps);
    return { httpMethod: "POST", headers: { host: hote, "content-type": "application/json", "x-elixir-horodatage": String(ts), "x-elixir-signature": M.signer(secret, String(ts), texte),
      ...(cle ? { "idempotency-key": cle } : {}), ...entetes }, body: alterer ? alterer(texte) : texte };
  };
  const base = { cip: "8000001", type: "reclamation", statut: "traitee", reference: "EN-601-2026-12" };
  eq("sans secret → 503 configuration ; secret trop court → 503", [(await handlerEvenement({ secret: "" })(evt(base))).statusCode, (await handlerEvenement({ secret: "court" })(evt(base))).statusCode], [503, 503]);
  eq("GET → 405", (await h({ httpMethod: "GET", headers: {} })).statusCode, 405);
  eq("signature d'un autre secret → 401 signature", corpsDe(await h(evt(base, { secret: crypto.randomBytes(32).toString("hex") }))), { error: "signature" });
  eq("corps modifié après la signature → 401", (await h(evt(base, { alterer: (t) => t.replace("8000001", "8000002") }))).statusCode, 401);
  eq("horodatage de plus de 5 min (passé ou futur) → 401 horodatage", [corpsDe(await h(evt(base, { ts: Math.floor(t0 / 1000) - 301 }))).error,
    corpsDe(await h(evt(base, { ts: Math.floor(t0 / 1000) + 301 }))).error, (await h(evt(base, { ts: Math.floor(t0 / 1000) - 299, cle: "entrepot-limite-0001" }))).statusCode], ["horodatage", "horodatage", 200]);
  recus.length = 0; stock.db.envois.length = 0; stock.db.evenements.length = 0;
  eq("signature absente ou mal formée → 401", [(await h({ httpMethod: "POST", headers: { "x-elixir-horodatage": String(Math.floor(t0 / 1000)) }, body: "{}" })).statusCode,
    (await h({ ...evt(base), headers: { ...evt(base).headers, "x-elixir-signature": "md5=abc" } })).statusCode], [401, 401]);
  eq("Idempotency-Key absente ou illisible → 400", [corpsDe(await h(evt(base, { cle: null }))).error, corpsDe(await h(evt(base, { cle: "court" }))).error], ["idempotency_key", "idempotency_key"]);
  eq("JSON illisible → 400 json", corpsDe(await h(evt("{pas du json"))).error, "json");
  const mauvais = corpsDe(await h(evt({ cip: "12", type: "facture", statut: "Traitée!", reference: "" })));
  eq("champs refusés → 400 avec la liste (cip, type, statut, reference)", [mauvais.error, mauvais.erreurs.length], ["requete", 4]);
  eq("statut inconnu sans texte → 400 ; avec titre et corps → admis", [(await h(evt({ ...base, statut: "en_attente_labo" }))).statusCode,
    (await h(evt({ ...base, statut: "en_attente_labo", titre: "Réclamation en attente", corps: "Nous attendons la réponse du laboratoire." }))).statusCode], [400, 200]);
  eq("montant refusé (écran verrouillé) ; lien hors site refusé", [corpsDe(await h(evt({ ...base, statut: "en_attente_labo", titre: "Avoir", corps: "Avoir de 45,20 € émis." }))).erreurs,
    corpsDe(await h(evt({ ...base, url: "https://x.fr" }))).erreurs.length], [["aucun montant (écran verrouillé)"], 1]);
  recus.length = 0;
  const cle = "entrepot-EN-601-2026-12-traitee";
  const r1 = await h(evt(base, { cle }));
  eq("événement valide → 200 envoyé, un appareil", [r1.statusCode, corpsDe(r1)], [200, { ok: true, resultat: "envoye", envoyes: 1, echecs: 0 }]);
  const q = recus.at(-1);
  eq("charge : « Mes commandes et réclamations », texte par défaut avec la référence, lien Mes commandes",
    [q.charge.categorie, q.charge.titre, q.charge.corps, q.charge.url], ["commandes", "Réclamation traitée", "Votre réclamation EN-601-2026-12 est traitée.", "/?commandes=1"]);
  eq("étiquette (Topic) à clé : la référence n'est jamais lisible par le service push", [/^evt-[A-Za-z0-9_-]{16}$/.test(q.charge.tag), (q.topic || "").includes("601"), q.topic === q.charge.tag.slice(0, 32)], [true, false, true]);
  eq("même clé → 200 déjà, rien renvoyé", [corpsDe(await h(evt(base, { cle }))), recus.length], [{ ok: true, deja: true, resultat: "envoye", envoyes: 1 }, 1]);
  eq("même statut, même référence, autre clé → déjà (jamais deux fois)", [corpsDe(await h(evt(base, { cle: "entrepot-autre-cle-01" }))).deja, recus.length], [true, 1]);
  eq("même clé pour un autre événement → 409", corpsDe(await h(evt({ ...base, statut: "cloturee" }, { cle }))).error, "idempotency_key_reutilisee");
  const r2 = await h(evt({ ...base, statut: "avoir_emis" }));
  eq("nouveau statut de la même référence : envoyé, même étiquette (remplace la précédente sur l'appareil)", [corpsDe(r2).resultat, recus.at(-1).charge.tag === q.charge.tag, recus.at(-1).charge.titre], ["envoye", true, "Avoir émis"]);
  eq("plafond de sécurité (3 par 24 h) atteint → plafond", corpsDe(await h(evt({ ...base, statut: "cloturee" }))).resultat, "plafond");
  eq("pharmacie sans l'alerte « Mes commandes » → aucun_appareil (journalisé)", [corpsDe(await h(evt({ cip: "8000002", type: "commande", statut: "expediee", reference: "S04512" }))).resultat,
    stock.db.evenements.find((e) => e.reference === "S04512")?.resultat], ["aucun_appareil", "aucun_appareil"]);
  eq("ticket et commande : textes par défaut", [M.verifierEvenement({ cip: "8000001", type: "ticket", statut: "resolu", reference: "TK-2026-3" }).evenement.corps,
    M.verifierEvenement({ cip: "8000001", type: "commande", statut: "reliquat", reference: "S04512" }).evenement.titre], ["Votre demande TK-2026-3 est traitée.", "Reliquat sur votre commande"]);
  eq("en-têtes en majuscules et corps en base64 (Netlify) : acceptés", (await h({ ...evt({ ...base, reference: "EN-601-2026-20", statut: "recue" }), isBase64Encoded: true,
    body: Buffer.from(JSON.stringify({ ...base, reference: "EN-601-2026-20", statut: "recue" })).toString("base64"),
    headers: Object.fromEntries(Object.entries(evt({ ...base, reference: "EN-601-2026-20", statut: "recue" }, { cle: "entrepot-majuscules-1" }).headers).map(([k, v]) => [k.toUpperCase(), v])) })).statusCode, 200);
  eq("corps de plus de 4 Ko → 413", (await h(evt({ ...base, titre: "x".repeat(5000) }))).statusCode, 413);
  const nEvt = stock.db.evenements.length;
  eq("hôte d'aperçu : signature vérifiée, rien enregistré ni envoyé", [corpsDe(await h(evt({ ...base, reference: "AP-1" }, { hote: "deploy-preview-4--commandes-elixir.netlify.app" }))).apercu, stock.db.evenements.length], [true, nEvt]);
  const limite = P.creerLimiteur();
  const hDebit = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: () => {},
    limite: (k, max, f) => limite(k, k.startsWith("cip|") ? 1 : max, f) });
  await hDebit(evt({ ...base, cip: "8000002", reference: "D-1", statut: "recue" }));
  const rq = await hDebit(evt({ ...base, cip: "8000002", reference: "D-2", statut: "recue" }));
  eq("débit par pharmacie dépassé → 429 Retry-After", [rq.statusCode, Number(rq.headers["Retry-After"]) > 0], [429, true]);
  const texteJournal = JSON.stringify(journaux);
  eq("journal : ni secret, ni texte, ni référence", [texteJournal.includes(SECRET), texteJournal.includes("Réclamation traitée"), texteJournal.includes("EN-601")], [false, false, false]);
  eq("tables absentes → 503 indisponible", (await handlerEvenement({ stock: { ...stock, evenements: { reserver: async () => { throw Object.assign(new Error("x"), { code: "schema" }); } } },
    config: () => CONF, secret: SECRET, maintenant: horloge, journal: () => {} })(evt({ ...base, reference: "S-1" }))).statusCode, 503);
}

// ── 6. push-admin : recherche, estimation, historique, modèles, refus ──
{
  const lignes = [ligne("/a/1", { pharmacy_cip: "9000001", pharmacie_nom: "PHARMACIE A", categories: ["stock", "commandes", "infos", "offres"], last_seen_at: "2026-10-20T08:00:00.000Z", last_success_at: "2026-10-19T08:00:00.000Z" }),
    ligne("/a/2", { pharmacy_cip: "9000002", pharmacie_nom: "PHARMACIE B", categories: ["stock"], plateforme: "ios" })];
  const pharmacies = [{ email: "contact@pharmacie-a.fr", name: "PHARMACIE A", cip: "9000001", ville: "Versailles" }, { email: "p9000002@pharma.fr", name: "PHARMACIE B", cip: "9000002", ville: "Paris" },
    { email: "titulaire@pharmacie-c.fr", name: "PHARMACIE C", cip: "9000003", ville: "Versailles" }, { email: "sans-cip@x.fr", name: "PHARMACIE SANS CIP", cip: "0", ville: "Versailles" }];
  const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes, pharmacies });
  stock.db.envois.push({ id: 1, categorie: "stock", pharmacy_cip: "9000001", tag: "stock-x", nb_appareils: 1, nb_reussis: 1, titre: "De retour en stock", source: "stock", created_at: "2026-10-18T08:00:00.000Z" });
  const ann = (await stock.annonces.creer({ titre: "Vaseline", corps: "x", url: "/", audience: "toutes", statut: "envoyee", type: "promotion", categorie: "offres" })).annonce;
  stock.db.envois.push({ id: 2, categorie: "offres", pharmacy_cip: "9000001", annonce_id: ann.id, tag: "offre-x", nb_appareils: 1, nb_reussis: 1, created_at: "2026-10-19T08:00:00.000Z" });
  const reponses = [];
  const h0 = handlerAdmin({ stock, config: () => CONF, verifierAdmin, lancer: async () => null, journal: () => {} });
  const h = async (e) => { const r = await h0(e); reponses.push(r.body || ""); return r; };
  const ch = corpsDe(await h(A({ action: "chercher", q: "versailles" })));
  eq("chercher (ville) : une ligne par CIP, CIP « 0 » écarté, appareils et alertes, adresses masquées", ch.pharmacies.map((p) => [p.nom, p.cip, p.appareils, p.categories.length, p.adresses, p.adresses_masquees]),
    [["PHARMACIE A", "9000001", 1, 4, 1, ["co…@…fr"]], ["PHARMACIE C", "9000003", 0, 0, 1, ["ti…@…fr"]]]);
  eq("chercher : dernière visite et dernière notification", [ch.pharmacies[0].derniere_visite, ch.pharmacies[0].derniere_notification], ["2026-10-20T08:00:00.000Z", "2026-10-19T08:00:00.000Z"]);
  eq("chercher par CIP choisis", corpsDe(await h(A({ action: "chercher", cips: ["9000002"] }))).pharmacies.map((p) => [p.nom, p.plateformes]), [["PHARMACIE B", ["ios"]]]);
  eq("chercher : moins de 2 caractères → rien", corpsDe(await h(A({ action: "chercher", q: "a" }))).pharmacies, []);
  const e1 = corpsDe(await h(A({ action: "estimer", type: "reclamation", audience: "une", cips: ["9000003"] })));
  eq("estimer (réclamation, une pharmacie sans appareil) : 0 recevra, sans appareil, e-mail de secours permis (masqué)", [e1.categorie, e1.recevront, e1.sans_appareil, e1.email, e1.plafond.fenetre],
    ["commandes", 0, 1, { adresses: 1, masquees: ["ti…@…fr"], permis: true, raison: null, telephone: false }, "24 heures"]);
  const e2 = corpsDe(await h(A({ action: "estimer", type: "communication", audience: "liste", cips: ["9000001", "9000002", "9000003"] })));
  eq("estimer (communication, liste) : 1 recevra, 1 alerte coupée, 1 sans appareil", [e2.recevront, e2.alerte_coupee, e2.sans_appareil], [1, 1, 1]);
  const e3 = corpsDe(await h(A({ action: "estimer", type: "promotion", audience: "toutes" })));
  eq("estimer (toutes) : pharmacies clientes sans appareil (C)", [e3.recevront, e3.alerte_coupee, e3.sans_appareil], [1, 1, 1]);
  eq("estimer réclamation à toutes → 400", (await h(A({ action: "estimer", type: "reclamation", audience: "toutes" }))).statusCode, 400);
  const hp = corpsDe(await h(A({ action: "historique", cip: "9000001" })));
  eq("historique d'une pharmacie : envois récents d'abord, titre repris du message pour une ligne d'avant, origine", hp.envois.map((e) => [e.titre, e.source, e.categorie]),
    [["Vaseline", "message", "offres"], ["De retour en stock", "stock", "stock"]]);
  eq("historique d'une pharmacie : nom, appareils, adresses (nombre)", [hp.nom, hp.appareils.appareils, hp.adresses], ["PHARMACIE A", 1, 1]);
  eq("historique : CIP illisible → 400", (await h(A({ action: "historique", cip: "abc" }))).statusCode, 400);
  // modèles
  const m1 = await h(A({ action: "modele_enregistrer", modele: { nom: "Reliquat Pfizer", type: "commande", titre: "Reliquat", corps: "Votre commande [n° de commande] attend le stock Pfizer.", url: "/?commandes=1" } }));
  eq("modèle enregistré (champs entre crochets admis dans un modèle)", [m1.statusCode, corpsDe(m1).modele.nom, corpsDe(m1).modele.admin_email], [200, "Reliquat Pfizer", "pharmacien@elixirpharma.fr"]);
  eq("même nom (casse différente) → 409 doublon", corpsDe(await h(A({ action: "modele_enregistrer", modele: { nom: "reliquat pfizer", type: "commande", titre: "t", corps: "c" } }))).error, "doublon");
  eq("modèle invalide → 400", (await h(A({ action: "modele_enregistrer", modele: { nom: "x", type: "pub", titre: "", corps: "" } }))).statusCode, 400);
  eq("modèles : liste", corpsDe(await h(A({ action: "modeles" }))).modeles.map((m) => m.nom), ["Reliquat Pfizer"]);
  await h(A({ action: "modele_supprimer", id: corpsDe(m1).modele.id }));
  eq("modèle supprimé", corpsDe(await h(A({ action: "modeles" }))).modeles, []);
  // refus à l'envoi
  const base = { type: "reclamation", titre: "Réclamation traitée", corps: "Votre réclamation EN-601-2026-12 est traitée.", url: "/?commandes=1" };
  eq("envoyer une réclamation à toutes → 400", (await h(A({ action: "envoyer", message: { ...base, audience: "toutes" }, idem: "adm-0000001" }))).statusCode, 400);
  eq("envoyer un montant → 400", (await h(A({ action: "envoyer", message: { ...base, audience: "une", cips: ["9000001"], corps: "Avoir de 10 € émis." }, idem: "adm-0000002" }))).statusCode, 400);
  const u1 = await h(A({ action: "envoyer", message: { ...base, audience: "une", cips: ["9000003"], repli_email: true }, idem: "adm-0000003" }));
  eq("message unitaire avec e-mail de secours : 202, nom de la pharmacie gardé (historique), aucune adresse renvoyée", [u1.statusCode, corpsDe(u1).annonce.destinataire_nom, corpsDe(u1).annonce.repli_email, corpsDe(u1).annonce.type],
    [202, "PHARMACIE C", true, "reclamation"]);
  eq("suivi : action « message »", corpsDe(await h(A({ action: "message", id: corpsDe(u1).annonce.id }))).annonce.statut, "en_file");
  stock.db.reglages = R.fusionnerReglages({ ouverture: "fermee" });
  eq("ouverture fermée : message unitaire avec e-mail de secours admis, sans → 409 fermee",
    [(await h(A({ action: "envoyer", message: { ...base, audience: "une", cips: ["9000003"], repli_email: true }, idem: "adm-0000004" }))).statusCode,
      corpsDe(await h(A({ action: "envoyer", message: { ...base, audience: "une", cips: ["9000003"] }, idem: "adm-0000005" }))).error], [202, "fermee"]);
  stock.db.evenements.push({ cle: "k-00000001", pharmacy_cip: "9000001", type: "commande", statut: "expediee", reference: "S1", recu_le: "2026-10-20T08:00:00.000Z", resultat: "envoye" });
  eq("événements de l'outil entrepôt", corpsDe(await h(A({ action: "evenements" }))).evenements.map((e) => e.reference), ["S1"]);
  // seule l'adresse de l'admin connecté (auteur d'un message ou d'un modèle) peut apparaître ; jamais celle d'une pharmacie
  eq("aucune réponse admin ne contient l'adresse e-mail d'une pharmacie", reponses.filter((t) => /[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(t.replaceAll("pharmacien@elixirpharma.fr", ""))).length, 0);
  const etat = corpsDe(await h(A({ action: "etat" })));
  eq("état : tables des messages présentes, statistiques avec Informations Elixir", [etat.service.tables_messages, "infos" in etat.stats.par_categorie], [true, true]);
  const sansModeles = { ...stock, modeles: { lister: async () => { throw Object.assign(new Error("x"), { code: "schema" }); } } };
  const etat2 = corpsDe(await handlerAdmin({ stock: sansModeles, config: () => CONF, verifierAdmin, journal: () => {} })(A({ action: "etat" })));
  eq("état sans sql/push-messages.sql : signalé", [etat2.service.tables_messages, etat2.service.defauts.some((d) => /push-messages\.sql/.test(d))], [false, true]);
  eq("aperçu Netlify : chercher et modèles fictifs", [corpsDe(await h(A({ action: "chercher", q: "pharma" }, { hote: "deploy-preview-2--commandes-elixir.netlify.app" }))).apercu,
    corpsDe(await h(A({ action: "modeles" }, { hote: "deploy-preview-2--commandes-elixir.netlify.app" }))).apercu], [true, true]);
}

// ── 7. notifierPharmacie et creerStockPush (chemins PostgREST) ──
{
  const st = stockMemoire({ reglages: { ouverture: "toutes", plafond_infos_7j: 1, plafond_commandes_jour: 1 }, lignes: [ligne("/n/1", { pharmacy_cip: "9100001", categories: ["infos", "commandes"] })] });
  const { transport } = espion();
  const o = { stock: st, config: CONF, transport, hotesEssai: ESSAI };
  eq("notifier « infos » : 1re envoyée, 2e plafonnée", [(await P.notifierPharmacie("9100001", "infos", { titre: "Info", tag: "i1" }, o)).raison, (await P.notifierPharmacie("9100001", "infos", { titre: "Info", tag: "i2" }, o)).raison], [null, "plafond"]);
  eq("notifier « commandes » : plafond de sécurité (1 par 24 h)", [(await P.notifierPharmacie("9100001", "commandes", { titre: "C", tag: "c1" }, { ...o, type: "commande", source: "entrepot" })).raison,
    (await P.notifierPharmacie("9100001", "commandes", { titre: "C", tag: "c2" }, o)).raison], [null, "plafond"]);
  eq("push_envois : titre, type et source tracés", st.db.envois.find((e) => e.tag === "c1") && [st.db.envois.find((e) => e.tag === "c1").titre, st.db.envois.find((e) => e.tag === "c1").type, st.db.envois.find((e) => e.tag === "c1").source],
    ["C", "commande", "entrepot"]);
}
{
  const appels = [];
  let schemaUneFois = true;
  const http = async (u, init = {}) => {
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ u: decodeURIComponent(u), m: init.method || "GET", corps, prefer: init.headers?.Prefer });
    if (u.includes("push_envois") && init.method === "POST" && schemaUneFois && corps?.[0]?.titre) { schemaUneFois = false; return new Response(JSON.stringify({ code: "PGRST204" }), { status: 400 }); }
    if (u.includes("push_evenements") && init.method === "POST") return new Response(JSON.stringify({ code: "23505" }), { status: 409 });
    return new Response(init.method === "PATCH" || init.method === "POST" ? "[]" : "[]", { status: 200 });
  };
  const s = P.creerStockPush({ fetch: http, url: "https://essai.supabase.co", cle: "cle-essai" });
  await s.envois.ajouter([{ categorie: "stock", pharmacy_cip: "1", nb_appareils: 1, nb_reussis: 1, titre: "t", source: "stock" }]);
  eq("envois : colonnes de push-messages.sql absentes → réécrit sans elles", appels.filter((a) => a.u.includes("push_envois")).map((a) => Object.keys(a.corps[0]).sort()),
    [["categorie", "nb_appareils", "nb_reussis", "pharmacy_cip", "source", "titre"], ["categorie", "nb_appareils", "nb_reussis", "pharmacy_cip"]]);
  appels.length = 0;
  await s.chercherPharmacies("Saint-Louis (78)*,");
  await s.chercherPharmacies("CIP 2000 01");
  eq("recherche : nom et ville en ilike entre guillemets, caractères spéciaux retirés ; CIP (3 chiffres au moins) en préfixe",
    [appels[0].u.includes('or=(name.ilike."*Saint-Louis 78*",ville.ilike."*Saint-Louis 78*")&'), appels[1].u.includes('cip.like.200001*)')], [true, true]);
  appels.length = 0;
  await s.comptesDuCip("2000001"); await s.comptesDuCip("0");
  eq("comptes d'un CIP : elixir_pharmacies par CIP ; « 0 » jamais lu", [appels.length, appels[0].u.includes("elixir_pharmacies?cip=eq.2000001&select=email,name,ville,cip")], [1, true]);
  appels.length = 0;
  const id = crypto.randomUUID();
  await s.annonces.passerEnFile(id); await s.annonces.annuler(id, "admin@x.fr"); await s.annonces.dus("2026-10-22T09:00:00.000Z"); await s.annonces.enCours("2026-10-22T08:45:00.000Z");
  eq("programmation : passages conditionnels (statut=eq.programmee), dus par heure, en cours = plafonnés seulement",
    [appels[0].u.includes(`push_annonces?id=eq.${id}&statut=eq.programmee`), appels[0].m, appels[1].corps.statut, appels[2].u.includes("statut=eq.programmee&programme_pour=lte.2026-10-22T09:00:00.000Z"),
      appels[3].u.includes("categorie=in.(offres,infos)")], [true, "PATCH", "annulee", true, true]);
  appels.length = 0;
  await s.evenements.reserver({ cle: "entrepot-cle-1", empreinte: "a".repeat(64), pharmacy_cip: "1", type: "commande", statut: "expediee" });
  eq("événement déjà connu (409) : relu par clé OU empreinte", appels[1]?.u.includes('push_evenements?or=(cle.eq."entrepot-cle-1",empreinte.eq."aaaa'), true);
}

// ── 7 bis. Correctifs de la revue (21/10/2026) : plafonds de l'e-mail de secours, Promotion sans e-mail, relances et
// annulation des messages en file, API (débit avant signature, échec passager rejouable, réservation orpheline, doublon
// sur 10 minutes, statuts connus sans texte libre, différé de nuit), estimation alignée sur l'envoi, clé idem par contenu,
// destinataires des messages transactionnels, modèles, effacement, conservation ──
{
  // règles
  eq("montants élargis : HT, TTC, décimales, « E », en toutes lettres, solde ; dates, heures, ordinaux, numéros admis",
    ["Avoir de 45,90 HT émis", "Solde restant : 1 250,00", "Remboursement 12,5 TTC", "Avoir de 30 E", "quarante euros", "Solde : 120",
      "le 22/10", "Réponse sous 24 h ouvrées", "Votre 2e colis", "EN-601-2026-12", "S04512", "01 86 04 39 95", "le 1er novembre", "Europe"].map(R.contientMontant),
    [true, true, true, true, true, true, false, false, false, false, false, false, false, false]);
  eq("référence propre (commande à plusieurs pharmacies)", ["S04512", "EN-601", "n° 45120", "commande 45120", "Livraisons retardées le 22/10/2026", "tournée Nord"].map(R.contientReference),
    [true, true, true, true, false, false]);
  const v = (m) => R.verifierMessage({ titre: "Titre", corps: "Texte du message.", url: "/?commandes=1", ...m });
  eq("réclamation : une seule pharmacie ; commande à plusieurs : sans référence ; promotion : jamais d'e-mail de secours",
    [v({ type: "reclamation", audience: "liste", cips: ["2000001", "2000002"] }).ok, v({ type: "commande", audience: "liste", cips: ["2000001", "2000002"], corps: "Votre commande S04512 part demain." }).ok,
      v({ type: "commande", audience: "liste", cips: ["2000001", "2000002"], corps: "Livraisons retardées ce matin (neige)." }).ok,
      v({ type: "promotion", audience: "une", cips: ["2000001"], repli_email: true, url: "/" }).ok, v({ type: "communication", audience: "une", cips: ["2000001"], repli_email: true, url: "/" }).message.repli_email],
    [false, false, true, false, true]);
  eq("audiences par type", [R.audiencesDuType("reclamation"), R.audiencesDuType("commande"), R.audiencesDuType("promotion")], [["une"], ["une", "liste"], ["une", "liste", "toutes"]]);
  eq("prochain matin (Paris) : nuit → 8 h même jour ; soir → lendemain ; samedi soir et dimanche → lundi ; programmation : lendemain 8 h 30 hors dimanche",
    [["2026-10-21T04:00:00Z"], ["2026-10-21T19:00:00Z"], ["2026-10-24T19:30:00Z"], ["2026-10-25T08:00:00Z"], ["2026-10-24T10:00:00Z", { heure: 8, minute: 30, demain: true }]]
      .map(([d, o]) => R.isoVersParis(R.prochainMatin(Date.parse(d), o))), ["2026-10-21T08:00", "2026-10-22T08:00", "2026-10-26T08:00", "2026-10-26T08:00", "2026-10-26T08:30"]);
  eq("modèles : aucun ne promet un e-mail ; « Nouveau menu » est une Promotion à menu promo à choisir",
    [MODELES_ELIXIR.filter((m) => /e-mail|espace de la pharmacie/i.test(m.corps)).map((m) => m.id), MODELES_ELIXIR.find((m) => m.id === "nouveau_menu").type, MODELES_ELIXIR.find((m) => m.id === "nouveau_menu").typeLien],
    [[], "promotion", "promo"]);
  eq("« Informations Elixir » : plus de « nouveautés » ; « Mes commandes et réclamations » cite les demandes",
    [/nouveaut/i.test(R.CATEGORIES.find((c) => c.id === "infos").aide + R.aideInfos(2)), /demandes/.test(R.CATEGORIES.find((c) => c.id === "commandes").aide)], [false, true]);
}
{
  // e-mail de secours : jamais au-delà du plafond, compté dedans ; jamais pour une Promotion ; téléphones seulement
  const t0 = Date.parse("2026-10-22T09:00:00Z");
  const mk = (lignes, reglages, pharmacies) => stockMemoire({ reglages: { ouverture: "toutes", ...reglages }, lignes, pharmacies, horloge: () => new Date(t0) });
  const pharmacies = [{ email: "titulaire@sans.fr", name: "SANS APPAREIL", cip: "5500001" }, { email: "p5500002@pharma.fr", name: "ÉCHEC", cip: "5500002" },
    { email: "p5500003@pharma.fr", name: "COMPTOIR", cip: "5500003" }, { email: "p5500004@pharma.fr", name: "TÉLÉPHONE", cip: "5500004" }];
  const lignes = [ligne("/m/2", { pharmacy_cip: "5500002", categories: ["commandes", "infos"] }), ligne("/m/3", { pharmacy_cip: "5500003", categories: ["commandes", "infos"], plateforme: "ordinateur" }),
    ligne("/m/4", { pharmacy_cip: "5500004", categories: ["commandes", "infos"], plateforme: "ios" })];
  const essai = async (stock, statuts, messages) => {
    const mails = [];
    const { transport } = espion(statuts);
    const bg = handlerEnvoi({ stock, config: () => CONF, transport, hotesEssai: ESSAI, journal: () => {}, autoriser: () => true, maintenant: () => new Date(t0),
      envoyerEmail: async (m) => { mails.push(m.to); return { sent: true }; } });
    const ids = [];
    for (const m of messages) {
      const a = (await stock.annonces.creer({ titre: "Titre", corps: "Texte.", url: "/", statut: "en_file", audience: "une", repli_email: true, ...m })).annonce;
      ids.push(a.id);
      await bg({ httpMethod: "POST", headers: {}, body: JSON.stringify({ annonce: a.id }) });
    }
    return { mails, statuts: ids.map((id) => stock.db.annonces.find((a) => a.id === id).email_statut) };
  };
  const s1 = mk(lignes, { plafond_infos_7j: 2 }, pharmacies);
  const r1 = await essai(s1, {}, Array.from({ length: 3 }, () => ({ type: "communication", categorie: "infos", cips: ["5500001"] })));
  eq("Communication, pharmacie sans appareil, plafond 2 : 3 messages → 2 e-mails, le 3e « plafond »", [r1.mails.length, r1.statuts], [2, ["envoye", "envoye", "plafond"]]);
  eq("l'e-mail parti compte dans le plafond des informations", (await s1.envois.plafond("2026-01-01T00:00:00Z", "infos")).get("5500001"), 2);
  const s2 = mk(lignes, { plafond_commandes_jour: 2 }, pharmacies);
  const r2 = await essai(s2, {}, Array.from({ length: 3 }, () => ({ type: "reclamation", categorie: "commandes", url: "/?commandes=1", cips: ["5500001"] })));
  eq("Réclamation, pharmacie sans appareil, plafond de sécurité 2 : 3 messages → 2 e-mails", [r2.mails.length, r2.statuts], [2, ["envoye", "envoye", "plafond"]]);
  const s3 = mk(lignes, { plafond_commandes_jour: 2 }, pharmacies);
  const r3 = await essai(s3, { "/m/2": 500 }, Array.from({ length: 3 }, () => ({ type: "reclamation", categorie: "commandes", url: "/?commandes=1", cips: ["5500002"] })));
  eq("appareil toujours en échec, plafond 2 : 2 e-mails au plus", [r3.mails.length, r3.statuts], [2, ["envoye", "envoye", "plafond"]]);
  const s4 = mk(lignes, {}, pharmacies);
  const r4 = await essai(s4, {}, [{ type: "promotion", categorie: "offres", cips: ["5500001"] }]);
  eq("Promotion (ligne d'avant la règle, case cochée) : jamais d'e-mail", [r4.mails.length, r4.statuts], [0, [null]]);
  const s5 = mk(lignes, {}, pharmacies);
  const r5 = await essai(s5, {}, [{ type: "reclamation", categorie: "commandes", url: "/?commandes=1", cips: ["5500003"] }, { type: "reclamation", categorie: "commandes", url: "/?commandes=1", cips: ["5500004"] }]);
  eq("jointe sur un ordinateur seulement : e-mail quand même (« pas joignable sur téléphone ») ; jointe sur son iPhone : inutile",
    [r5.mails, r5.statuts], [["p5500003@pharma.fr"], ["envoye", "non_requis"]]);
  eq("ordinateur joint + e-mail : une seule ligne d'envoi, comptée une fois", s5.db.envois.filter((e) => e.pharmacy_cip === "5500003").map((e) => [e.nb_reussis, e.email]), [[1, "envoye"]]);
  const s6 = mk(lignes, { ouverture: "fermee", plafond_infos_7j: 1 }, pharmacies);
  const r6 = await essai(s6, {}, Array.from({ length: 2 }, () => ({ type: "communication", categorie: "infos", cips: ["5500001"] })));
  eq("ouverture fermée : l'e-mail de secours respecte aussi le plafond", [r6.mails.length, r6.statuts], [1, ["envoye", "plafond"]]);
}
{
  // programmation : relance bornée à 3 h, jamais le soir ni la nuit, annulation d'un message en file, heure de composition gardée
  let t = Date.parse("2026-10-23T08:00:00Z");   // vendredi 10 h à Paris
  const horloge = () => new Date(t);
  const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/q/1", { pharmacy_cip: "7600001", categories: ["stock", "commandes", "infos", "offres"] })], horloge });
  const id = crypto.randomUUID();
  stock.db.annonces.push({ id, statut: "programmee", programme_pour: "2026-10-23T08:00:00.000Z", type: "communication", categorie: "infos", titre: "Fermeture demain",
    corps: "Elixir fermé demain samedi.", url: "/", audience: "toutes", created_at: "2026-10-20T08:00:00.000Z" });
  let panne = true; const lances = [];
  const lancer = async (x) => { if (panne) return "injoignable"; lances.push([x, R.texteHeureParis(t)]); return null; };
  await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  const a = stock.db.annonces.find((x) => x.id === id);
  eq("passage en file : heure de composition gardée, passage noté à part", [a.statut, a.created_at, a.en_file_le], ["en_file", "2026-10-20T08:00:00.000Z", "2026-10-23T08:00:00.000Z"]);
  t += 30 * MIN; panne = false;
  const b1 = await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  eq("lancement perdu, 30 min plus tard en journée : relancé", [b1.relances, lances.length], [1, 1]);
  // même message resté en file (autre diffusion en cours), service muet jusqu'à 23 h 05 : jamais relancé, passé en erreur
  lances.length = 0;
  for (let i = 0; i < 12 * 13; i++) { t += 5 * MIN; await M.traiterProgrammes({ stock, lancer: async () => "injoignable", maintenant: horloge }); }
  t += 5 * MIN;
  const b2 = await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  eq("prévu à 10 h, encore en file à 23 h : jamais relancé, erreur « plus de 3 h de retard »", [lances.length, b2.relances, a.statut === "en_file" ? "en_file" : stock.db.annonces.find((x) => x.id === id).statut,
    /plus de 3 h/.test(stock.db.annonces.find((x) => x.id === id).erreur || "")], [0, 0, "erreur", true]);
  // soir : en file à 19 h 50, pas de relance après 20 h (bouton « Relancer » avec confirmation) ; expiré à 22 h 51
  t = Date.parse("2026-10-22T17:50:00Z");
  const id2 = crypto.randomUUID();
  stock.db.annonces.push({ id: id2, statut: "en_file", type: "promotion", categorie: "offres", titre: "Offre", corps: "c", url: "/", audience: "toutes", created_at: new Date(t).toISOString(), en_file_le: new Date(t).toISOString() });
  t = Date.parse("2026-10-22T18:01:00Z");
  const b3 = await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  t = Date.parse("2026-10-22T20:51:00Z");
  const b4 = await M.traiterProgrammes({ stock, lancer, maintenant: horloge });
  eq("en file depuis 19 h 50 : pas de relance automatique après 20 h, expiré après 22 h 50", [b3.relances, b4.expires, stock.db.annonces.find((x) => x.id === id2).statut], [0, 1, "erreur"]);
  // lancement tardif (relance manuelle ou fonction relancée) d'un message trop ancien : terminé en erreur, rien d'envoyé
  const { recus, transport } = espion();
  const id3 = crypto.randomUUID();
  stock.db.annonces.push({ id: id3, statut: "en_file", type: "communication", categorie: "infos", titre: "Fermeture", corps: "c", url: "/", audience: "toutes",
    programme_pour: new Date(t - 4 * H).toISOString(), created_at: new Date(t - 2 * J).toISOString(), en_file_le: new Date(t - 4 * H).toISOString() });
  const d3 = await P.diffuserAnnonce(id3, { stock, config: CONF, transport, hotesEssai: ESSAI, maintenant: horloge });
  eq("diffusion d'un message prévu il y a 4 h : erreur, rien d'envoyé", [d3.statut, recus.length, /plus de 3 h/.test(stock.db.annonces.find((x) => x.id === id3).erreur)], ["erreur", 0, true]);
  // annulation d'un message en file ; reclamer ensuite : sans effet
  t = Date.parse("2026-10-22T09:00:00Z");
  const h = handlerAdmin({ stock, config: () => CONF, verifierAdmin, lancer: async () => "HTTP 500", maintenant: horloge, journal: () => {} });
  const e1 = await h(A({ action: "envoyer", message: { type: "communication", titre: "Fermeture exceptionnelle", corps: "Elixir fermé le 1er novembre.", url: "/", audience: "toutes" }, idem: "revue-0000001" }));
  const idF = corpsDe(e1).annonce.id;
  const an = await h(A({ action: "annuler", id: idF }));
  eq("502 lancement, puis « Annuler » du message en file : annulé, jamais diffusé", [e1.statusCode, an.statusCode, corpsDe(an).annonce.statut, (await P.diffuserAnnonce(idF, { stock, config: CONF, transport, hotesEssai: ESSAI, maintenant: horloge })).lancee],
    [502, 200, "annulee", false]);
  // relance manuelle : refusée au-delà de 3 h après l'heure prévue
  const id4 = crypto.randomUUID();
  stock.db.annonces.push({ id: id4, statut: "en_file", type: "commande", categorie: "commandes", titre: "t", corps: "c", url: "/", audience: "une", cips: ["7600001"],
    programme_pour: new Date(t - 3.5 * H).toISOString(), created_at: new Date(t - J).toISOString(), en_file_le: new Date(t - 3.5 * H).toISOString() });
  eq("« Relancer » au-delà de 3 h : 409 trop_ancienne", corpsDe(await h(A({ action: "relancer", id: id4 }))).error, "trop_ancienne");
}
{
  // API : débit avant la signature, échecs passagers rejouables, réservation orpheline, doublon sur 10 minutes, différé de nuit
  const SECRET = crypto.randomBytes(32).toString("hex");
  let t = Date.parse("2026-10-22T09:00:00Z");   // jeudi 11 h à Paris
  const horloge = () => new Date(t);
  const req = (corps, { cle, ip = "198.51.100.7", signe = true } = {}) => {
    const texte = JSON.stringify(corps), ts = String(Math.floor(t / 1000));
    return { httpMethod: "POST", headers: { host: "elixir-commande.expepharma.com", "x-nf-client-connection-ip": ip, ...(signe ? { "x-elixir-horodatage": ts, "x-elixir-signature": M.signer(SECRET, ts, texte) } : {}),
      ...(cle ? { "idempotency-key": cle } : {}) }, body: texte };
  };
  const base = { cip: "8100001", type: "reclamation", statut: "traitee", reference: "REC-42" };
  {
    const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/f/1", { pharmacy_cip: "8100001", categories: ["commandes"] })], horloge });
    const { transport } = espion();
    const h = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: () => {} });
    for (let i = 0; i < 130; i++) await h(req({}, { ip: "203.0.113.66", signe: false }));
    const ok1 = await h(req(base, { cle: "evt-debit-0001" }));
    eq("130 requêtes NON signées d'une adresse : l'outil entrepôt (autre adresse) passe ; l'adresse fautive est limitée",
      [ok1.statusCode, (await h(req({}, { ip: "203.0.113.66", signe: false }))).statusCode], [200, 429]);
  }
  {
    const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/f/2", { pharmacy_cip: "8100001", categories: ["commandes"] })], horloge });
    const lire = stock.reglages.lire; let panne = true;
    stock.reglages.lire = async (...x) => { if (panne) throw Object.assign(new Error("Supabase HTTP 503"), { status: 503 }); return lire(...x); };
    const { recus, transport } = espion();
    const h = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: () => {} });
    const r1 = await h(req(base, { cle: "evt-panne-0001" }));
    panne = false;
    const r2 = await h(req(base, { cle: "evt-panne-0001" }));
    eq("panne passagère pendant l'envoi : 503 Retry-After, réservation retirée ; rejeu de la même clé → envoyée une fois",
      [r1.statusCode, corpsDe(r1).error, Number(r1.headers["Retry-After"]) > 0, r2.statusCode, corpsDe(r2).resultat, recus.length], [503, "indisponible", true, 200, "envoye", 1]);
  }
  {
    const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/f/3", { pharmacy_cip: "8100001", categories: ["commandes"] })], horloge });
    const { recus, transport } = espion();
    const h = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: () => {} });
    const e = { cip: "8100001", type: "commande", statut: "expediee", reference: "BL-1" };
    stock.db.evenements.push({ cle: "evt-orphelin-01", empreinte: M.empreinteEvenement(e, M.trancheDoublon(t - 2 * MIN)), pharmacy_cip: "8100001", type: "commande", statut: "expediee",
      reference: "BL-1", titre: "Commande expédiée", recu_le: new Date(t - 2 * MIN).toISOString(), traite_le: null, resultat: null });
    stock.db.evenements.push({ cle: "evt-recent-0001", empreinte: M.empreinteEvenement({ ...e, reference: "BL-2" }, M.trancheDoublon(t)), pharmacy_cip: "8100001", type: "commande", statut: "expediee",
      reference: "BL-2", titre: "Commande expédiée", recu_le: new Date(t - 20e3).toISOString(), traite_le: null, resultat: null });
    const r1 = await h(req(e, { cle: "evt-orphelin-01" }));
    const r2 = await h(req({ ...e, reference: "BL-2" }, { cle: "evt-recent-0001" }));
    eq("réservation orpheline (fonction coupée, 2 min) : reprise et envoyée ; réservation de 20 s : « déjà » (en cours ailleurs)",
      [corpsDe(r1).resultat, corpsDe(r2).deja, recus.length, stock.db.evenements.find((x) => x.cle === "evt-orphelin-01").resultat], ["envoye", true, 1, "envoye"]);
  }
  {
    const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/f/4", { pharmacy_cip: "8100001", categories: ["commandes"] })], horloge });
    const statuts = { "/f/4": 500 };
    const { recus, transport } = espion(statuts);
    const h = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: () => {} });
    const r1 = await h(req(base, { cle: "evt-echecs-0001" }));
    statuts["/f/4"] = 201;
    const r2 = await h(req(base, { cle: "evt-echecs-0001" }));
    eq("appareils tous en échec : 503 (à rejouer), jamais « envoyée » ; rejeu → envoyée", [r1.statusCode, corpsDe(r2).resultat, recus.length], [503, "envoye", 2]);
    const r3 = await h(req({ ...base, reference: "REC-43" }, { cle: "evt-doublon-001" }));
    const r4 = await h(req({ ...base, reference: "REC-43" }, { cle: "evt-doublon-002" }));
    t += 11 * MIN;
    const r5 = await h(req({ ...base, reference: "REC-43" }, { cle: "evt-doublon-003" }));
    eq("même statut, même référence, autre clé : écarté dans les 10 minutes, notifié de nouveau après", [corpsDe(r3).resultat, corpsDe(r4).deja, corpsDe(r5).resultat], ["envoye", true, "envoye"]);
    statuts["/f/4"] = 410;
    const r6 = await h(req({ ...base, reference: "REC-44" }, { cle: "evt-retire-0001" }));
    eq("seul appareil retiré (410) : « aucun appareil », jamais « envoyée »", corpsDe(r6).resultat, "aucun_appareil");
    eq("statut connu avec un texte libre : refusé (texte par défaut seulement)", corpsDe(await h(req({ ...base, reference: "REC-45", corps: "Ordonnance de Mme X traitée." }, { cle: "evt-libre-00001" }))).error, "requete");
    eq("statut inconnu, montant hors euro (« 45,90 HT ») : refusé", corpsDe(await h(req({ ...base, statut: "avoir_partiel", reference: "REC-46", titre: "Avoir", corps: "Avoir de 45,90 HT." }, { cle: "evt-montant-001" }))).erreurs,
      ["aucun montant (écran verrouillé)"]);
  }
  {
    // soir, nuit, dimanche : différé au matin 8 h (push-programmes) ; jamais la nuit
    t = Date.parse("2026-10-22T20:00:00Z");   // 22 h à Paris
    const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligne("/f/5", { pharmacy_cip: "8100001", categories: ["commandes"] })], horloge });
    const { recus, transport } = espion();
    const h = handlerEvenement({ stock, config: () => CONF, secret: SECRET, transport, hotesEssai: ESSAI, maintenant: horloge, journal: () => {} });
    const r1 = await h(req({ cip: "8100001", type: "commande", statut: "expediee", reference: "S04512" }, { cle: "evt-nuit-000001" }));
    const deja = corpsDe(await h(req({ cip: "8100001", type: "commande", statut: "expediee", reference: "S04512" }, { cle: "evt-nuit-000001" })));
    eq("22 h : différé au lendemain 8 h, rien d'envoyé ; rejeu → « déjà », différé", [r1.statusCode, corpsDe(r1).resultat, R.isoVersParis(corpsDe(r1).envoi_prevu), recus.length, deja.deja, deja.resultat],
      [200, "differe", "2026-10-23T08:00", 0, true, "differe"]);
    t = Date.parse("2026-10-23T05:59:00Z");   // 7 h 59
    const b0 = await M.traiterDifferes({ stock, config: CONF, transport, hotesEssai: ESSAI, maintenant: horloge });
    t = Date.parse("2026-10-23T06:02:00Z");   // 8 h 02
    const [b1, b2] = await Promise.all([M.traiterDifferes({ stock, config: CONF, transport, hotesEssai: ESSAI, maintenant: horloge }),
      M.traiterDifferes({ stock, config: CONF, transport, hotesEssai: ESSAI, maintenant: horloge })]);
    eq("7 h 59 : rien ; 8 h 02 (deux passages simultanés) : envoyé une fois, texte et lien gardés", [b0.differes, b1.envoyes + b2.envoyes, recus.length, recus[0]?.charge.corps,
      recus[0]?.charge.url, stock.db.evenements[0].resultat], [0, 1, 1, "Votre commande S04512 est sortie de l'entrepôt.", "/?commandes=1", "envoye"]);
    const jp = [];
    await handlerProgrammes({ stock, config: () => CONF, transport, hotesEssai: ESSAI, lancer: async () => null, maintenant: horloge, journal: (o) => jp.push(o) })();
    eq("push-programmes : traite aussi les différés (rien de plus à envoyer)", recus.length, 1);
  }
}
{
  // admin : estimation de l'e-mail de secours (même règle que l'envoi), appareils détachés, pilote ; clé idem par contenu ;
  // modèles remplacés ; effacement ; événements nommés ; conservation des messages
  const t0 = Date.parse("2026-10-22T09:00:00Z");
  const horloge = () => new Date(t0);
  const lignes = [ligne("/g/1", { pharmacy_cip: "9500001", categories: ["stock", "commandes", "offres"], plateforme: "ios" }),
    ligne("/g/2", { pharmacy_cip: "9500002", categories: ["commandes"], compte_email: "ancien@pharma.fr" }),
    ligne("/g/3", { pharmacy_cip: "9500003", categories: ["stock", "commandes", "infos", "offres"] })];
  const pharmacies = [{ email: "p9500001@pharma.fr", name: "UN", cip: "9500001" }, { email: "titulaire@deux.fr", name: "DEUX", cip: "9500002" },
    { email: "p9500003@pharma.fr", name: "TROIS", cip: "9500003" }, { email: "p9500004@pharma.fr", name: "QUATRE", cip: "9500004" }];
  const comptes = new Map([["p9500001@pharma.fr", "9500001"], ["p9500003@pharma.fr", "9500003"]]);
  const stock = stockMemoire({ reglages: { ouverture: "toutes", plafond_infos_7j: 1 }, lignes, pharmacies, comptes, horloge });
  stock.db.envois.push({ id: 500, categorie: "infos", pharmacy_cip: "9500004", nb_appareils: 0, nb_reussis: 0, email: "envoye", created_at: new Date(t0 - J).toISOString() });
  const h = handlerAdmin({ stock, config: () => CONF, verifierAdmin, lancer: async () => null, maintenant: horloge, journal: () => {} });
  const est = async (type, cip) => corpsDe(await h(A({ action: "estimer", type, audience: "une", cips: [cip] })));
  const [ePromo, eAlerte, ePlafond, eTel, eDetache] = [await est("promotion", "9500004"), await est("communication", "9500001"), await est("communication", "9500004"), await est("reclamation", "9500001"), await est("reclamation", "9500002")];
  eq("estimation de l'e-mail de secours = règle de l'envoi : Promotion non ; alerte coupée ; plafond (e-mail déjà parti) ; téléphone joignable",
    [[ePromo.email.permis, ePromo.email.raison], [eAlerte.email.permis, eAlerte.email.raison], [ePlafond.email.permis, ePlafond.email.raison], [eTel.email.permis, eTel.email.telephone]],
    [[false, "type"], [false, "alerte_coupee"], [false, "plafond"], [true, true]]);
  eq("appareil d'un compte détaché : compté « sans appareil » (comme à l'envoi), jamais « alerte coupée »", [eDetache.sans_appareil, eDetache.alerte_coupee], [1, 0]);
  stock.db.reglages = R.fusionnerReglages({ ouverture: "pilote", pilote_cips: ["9500001"] });
  const eToutes = corpsDe(await h(A({ action: "estimer", type: "communication", audience: "toutes" })));
  eq("toutes, en pilote : pharmacies hors pilote comptées", [eToutes.recevront, eToutes.hors_ouverture], [0, 1]);
  stock.db.reglages = R.fusionnerReglages({ ouverture: "toutes" });
  const msg = { type: "reclamation", titre: "Réclamation reçue", corps: "Votre réclamation REC-1 est reçue.", url: "/?commandes=1", audience: "une", cips: ["9500001"] };
  const k1 = await h(A({ action: "envoyer", message: msg, idem: "revue-idem-0001" }));
  const k2 = await h(A({ action: "envoyer", message: msg, idem: "revue-idem-0001" }));
  const k3 = await h(A({ action: "envoyer", message: { ...msg, titre: "Réclamation traitée", corps: "Votre réclamation REC-1 est traitée." }, idem: "revue-idem-0001" }));
  eq("même clé, même contenu : « déjà » ; même clé, autre contenu : 409 idem_reutilise (rien de créé)", [k1.statusCode, corpsDe(k2).deja, k3.statusCode, corpsDe(k3).error,
    stock.db.annonces.filter((a) => a.idem === "revue-idem-0001").length], [202, true, 409, "idem_reutilise", 1]);
  eq("réclamation à plusieurs pharmacies : 400", (await h(A({ action: "envoyer", message: { ...msg, audience: "liste", cips: ["9500001", "9500003"] }, idem: "revue-idem-0002" }))).statusCode, 400);
  eq("promotion avec e-mail de secours : 400", (await h(A({ action: "envoyer", message: { ...msg, type: "promotion", url: "/", repli_email: true }, idem: "revue-idem-0003" }))).statusCode, 400);
  const m1 = await h(A({ action: "modele_enregistrer", modele: { nom: "Retour Pfizer", type: "reclamation", titre: "Retour", corps: "Votre retour [référence] est accepté.", url: "/?commandes=1" } }));
  const m2 = await h(A({ action: "modele_enregistrer", modele: { nom: "retour pfizer", type: "reclamation", titre: "Retour accepté", corps: "Votre retour [référence] est accepté.", url: "/?commandes=1" } }));
  const m3 = await h(A({ action: "modele_enregistrer", modele: { nom: "retour pfizer", type: "reclamation", titre: "Retour accepté", corps: "Votre retour [référence] est accepté.", url: "/?commandes=1" }, remplacer: true }));
  eq("modèle de même nom : 409 doublon, puis « Remplacer »", [m1.statusCode, corpsDe(m2).error, corpsDe(m3).remplace, corpsDe(m3).modele.id === corpsDe(m1).modele.id, stock.db.modeles.length, stock.db.modeles[0].titre],
    [200, "doublon", true, true, 1, "Retour accepté"]);
  stock.db.evenements.push({ cle: "evt-nom-000001", pharmacy_cip: "9500003", type: "commande", statut: "expediee", reference: "S1", recu_le: new Date(t0).toISOString(), resultat: "envoye" });
  eq("événements : nom de la pharmacie joint (jamais d'adresse)", corpsDe(await h(A({ action: "evenements" }))).evenements.map((e) => e.pharmacie_nom), ["TROIS"]);
  // effacement d'une pharmacie
  stock.db.envois.push({ id: 600, categorie: "commandes", pharmacy_cip: "9500003", nb_appareils: 1, nb_reussis: 1, created_at: new Date(t0).toISOString() });
  stock.db.annonces.push({ id: crypto.randomUUID(), statut: "envoyee", type: "reclamation", categorie: "commandes", audience: "une", cips: ["9500003"], destinataire_nom: "TROIS", titre: "t", corps: "c", url: "/", created_at: new Date(t0).toISOString() },
    { id: crypto.randomUUID(), statut: "envoyee", type: "promotion", categorie: "offres", audience: "liste", cips: ["9500001", "9500003"], titre: "t", corps: "c", url: "/", created_at: new Date(t0).toISOString() });
  const ef = corpsDe(await h(A({ action: "retirer_pharmacie", cip: "9500003", effacer_historique: true })));
  eq("demande d'effacement : appareils, envois, événements, CIP et nom dans les messages", [ef.retires, ef.historique_efface, stock.db.envois.some((e) => e.pharmacy_cip === "9500003"),
    stock.db.evenements.some((e) => e.pharmacy_cip === "9500003"), stock.db.annonces.some((a) => (a.cips || []).includes("9500003") || a.destinataire_nom === "TROIS")], [1, true, false, false, false]);
  // conservation : messages terminés de plus de 12 mois purgés, programmés jamais
  const ms = stockMemoire({ annonces: [{ id: "a1", statut: "envoyee", created_at: "2025-09-01T00:00:00.000Z" }, { id: "a2", statut: "programmee", created_at: "2025-09-01T00:00:00.000Z" },
    { id: "a3", statut: "envoyee", created_at: "2026-10-01T00:00:00.000Z" }] });
  const bilan = await P.menage({ stock: ms, maintenant: horloge, journal: () => {} });
  eq("ménage : messages terminés de plus de 12 mois effacés, programmés gardés", [bilan.messages, ms.db.annonces.map((a) => a.id)], ["ok", ["a2", "a3"]]);
  // notifierPharmacie : ligne d'envoi écrite AVANT l'envoi (plafond de sécurité compté pendant l'envoi)
  const sn = stockMemoire({ reglages: { ouverture: "toutes", plafond_commandes_jour: 1 }, lignes: [ligne("/g/9", { pharmacy_cip: "9500009", categories: ["commandes"] })], horloge });
  let pendant = null;
  const tr = async () => { pendant ??= sn.db.envois.map((e) => [e.pharmacy_cip, e.nb_appareils]); return new Response(null, { status: 201 }); };
  const n1 = await P.notifierPharmacie("9500009", "commandes", { titre: "C", tag: "c-1" }, { stock: sn, config: CONF, transport: tr, hotesEssai: ESSAI, maintenant: horloge });
  const n2 = await P.notifierPharmacie("9500009", "commandes", { titre: "C", tag: "c-2" }, { stock: sn, config: CONF, transport: tr, hotesEssai: ESSAI, maintenant: horloge });
  eq("notifierPharmacie (commandes) : ligne écrite avant l'envoi, la suivante plafonnée", [pendant, n1.raison, n2.raison, sn.db.envois.map((e) => e.nb_reussis)], [[["9500009", 1]], null, "plafond", [1]]);
}

// ── 8. Rendu de l'onglet (React côté serveur) et empaquetage ──
{
  const entree = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import Messages, { NotificationsEnvoyees, ListeEnvois } from "./components/AdminMessages.jsx";
export const messages = (props) => renderToStaticMarkup(React.createElement(Messages, props));
export const bloc = (props) => renderToStaticMarkup(React.createElement(NotificationsEnvoyees, props));
export const liste = (props) => renderToStaticMarkup(React.createElement(ListeEnvois, props));
`;
  const lot = await build({ stdin: { contents: entree, resolveDir: join(RACINE, "src"), loader: "jsx" }, bundle: true, write: false, format: "esm", platform: "browser",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, logLevel: "silent" });
  const rendu = await import(`data:text/javascript;base64,${Buffer.from(lot.outputFiles[0].text).toString("base64")}`);
  const html = rendu.messages({ etat: { disponible: true, service: { tables: true, tables_messages: true }, pharmacies: [] }, appeler: async () => ({ ok: true, corps: {} }), flash: () => {} });
  eq("onglet : 4 types, 3 destinataires, modèles Elixir, programmation, historique", ["Promotion", "Communication", "Réclamation / SAV", "Commande", "Une pharmacie", "Plusieurs pharmacies",
    "Toutes les pharmacies abonnées", "Fermeture exceptionnelle", "Programmer", "Historique", "Par pharmacie", "Outil entrepôt"].filter((t) => !html.includes(t)), []);
  eq("bloc de la fiche : rien sans CIP lisible", rendu.bloc({ adminFetch: async () => new Response("{}"), cip: "0" }), "");
  const l = rendu.liste({ envois: [{ id: 1, categorie: "commandes", type: "reclamation", titre: "Réclamation traitée", source: "entrepot", nb_appareils: 0, nb_reussis: 0, email: "envoye", created_at: "2026-10-20T08:00:00Z" }] });
  eq("liste des envois : alerte, origine, e-mail de secours", [l.includes("Mes commandes et réclamations"), l.includes("Outil entrepôt"), l.includes("e-mail envoyé")], [true, true, true]);
}
{
  const dossier = mkdtempSync(join(tmpdir(), "test-push-messages-"));
  try {
    for (const nom of ["push-evenement", "push-programmes", "push-envoi-background", "push-admin"]) {
      const sortie = join(dossier, `${nom}.mjs`);
      await build({ entryPoints: [join(RACINE, "netlify/functions", `${nom}.js`)], bundle: true, platform: "node", target: "node18", format: "esm", outfile: sortie,
        logLevel: "silent", banner: { js: 'import { createRequire as ___creerRequire } from "module"; const require = ___creerRequire(import.meta.url);' } });
      const m = await import(pathToFileURL(sortie).href);
      eq(`${nom} : empaqueté (Node 18), handler exporté`, typeof m.handler, "function");
      if (nom === "push-programmes") eq("push-programmes empaqueté, sans variables : 200, rien envoyé", (await m.handler()).statusCode, 200);
    }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
