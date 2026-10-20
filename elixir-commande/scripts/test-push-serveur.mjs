// Tests des notifications Web Push, côté serveur : node scripts/test-push-serveur.mjs
// Hors ligne : aucune requête vers Supabase, Google, Apple ni Mozilla. Clés VAPID et clés d'abonnement générées EN MÉMOIRE à
// chaque passage (webpush.generateVAPIDKeys, ECDH P-256) : aucune clé n'est écrite nulle part.
//  • règles partagées (src/notifications/regles.js) : liens admis, annonces, réglages, ouverture ;
//  • configPush : clés absentes, illisibles, dépareillées, sujet ; aucune valeur de clé dans les messages ;
//  • validerAbonnement : hôtes des services push admis, refus anti-SSRF (http, IP, port, identifiants, autre hôte) ;
//  • faux service push local (http 127.0.0.1) : en-têtes, corps DÉCHIFFRÉ (RFC 8291 : ECDH, HKDF, AES-128-GCM),
//    jeton VAPID vérifié (signature ES256, aud, sub, exp) ; réponses 201, 404, 410, 429, 500, 403, délai dépassé ;
//    parallélisme borné ; mises à jour de la base (succès, échecs, retraits) ;
//  • push-abonnement, push-admin, push-envoi-background : identité du jeton, ouverture, plafond, idempotence, aperçu ;
//    aucune réponse ne contient endpoint, p256dh, auth ni la clé privée ;
//  • notifierPharmacie ne lève jamais ; creerStockPush (chemins PostgREST, tables absentes) ;
//  • empaquetage esbuild des trois fonctions (comme Netlify) puis import du résultat.
import crypto from "node:crypto";
import http from "node:http";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import webpush from "web-push";
import * as R from "../src/notifications/regles.js";
import * as P from "../netlify/functions/_push.js";
import { creerHandler as handlerAbonnement } from "../netlify/functions/push-abonnement.js";
import { creerHandler as handlerAdmin } from "../netlify/functions/push-admin.js";
import { creerHandler as handlerEnvoi } from "../netlify/functions/push-envoi-background.js";

const RACINE = new URL("..", import.meta.url).pathname;
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString("base64url");

// ── 1. Règles partagées ──
for (const [u, attendu] of [["/", "/"], ["/?menu=promo_12", "/?menu=promo_12"], ["/?menu=accueil", "/?menu=accueil"], ["/?outil=fauteuil", "/?outil=fauteuil"],
  ["/?cip=3400930000000", "/?cip=3400930000000"], ["/?cip=3400936", "/?cip=3400936"], ["/?notifications=1", "/?notifications=1"], [" /?outil=saisie ", "/?outil=saisie"],
  ["https://x.fr", null], ["//x.fr", null], ["javascript:alert(1)", null], ["/?menu=<script>", null], ["/?outil=admin", null], ["/?cip=12", null],
  ["/?menu=otc&x=1", null], ["/#admin", null], ["/autre", null], ["", null], [null, null], ["/?notifications=0", null], ["/?menu=" + "a".repeat(61), null]])
  eq(`lienValide(${JSON.stringify(u)})`, R.lienValide(u), attendu);
{
  const a = R.verifierAnnonce({ titre: "  Vaseline :\nprécommande  ", corps: "13 références", url: "/?menu=promo_1", audience: "toutes" });
  eq("annonce valide : espaces et retours à la ligne resserrés", [a.ok, a.annonce.titre, a.annonce.audience, a.annonce.cips], [true, "Vaseline : précommande", "toutes", null]);
  eq("annonce : titre de 60 caractères admis, 61 refusé", [R.verifierAnnonce({ titre: "é".repeat(60), corps: "x", url: "/" }).ok, R.verifierAnnonce({ titre: "é".repeat(61), corps: "x", url: "/" }).ok], [true, false]);
  eq("annonce : texte de 160 admis, 161 refusé", [R.verifierAnnonce({ titre: "t", corps: "x".repeat(160), url: "/" }).ok, R.verifierAnnonce({ titre: "t", corps: "x".repeat(161), url: "/" }).ok], [true, false]);
  eq("annonce : emoji compté pour 1 (comme char_length)", R.verifierAnnonce({ titre: "🎁".repeat(60), corps: "x", url: "/" }).ok, true);
  eq("annonce : vides et lien refusé → 3 erreurs", R.verifierAnnonce({ titre: "   ", corps: "", url: "https://x.fr" }).erreurs.length, 3);
  eq("annonce liste : CIP illisible refusé", R.verifierAnnonce({ titre: "t", corps: "c", url: "/", audience: "liste", cips: ["12"] }).ok, false);
  eq("annonce liste sans CIP refusée", R.verifierAnnonce({ titre: "t", corps: "c", url: "/", audience: "liste", cips: [] }).ok, false);
  eq("annonce liste : doublons retirés", R.verifierAnnonce({ titre: "t", corps: "c", url: "/", audience: "liste", cips: ["2000001", "2000001"] }).annonce.cips, ["2000001"]);
  eq("réglages valides", R.verifierReglages({ ouverture: "pilote", pilote_cips: ["2000001", " 2000001 "], plafond_offres_7j: 3 }),
    { ok: true, erreurs: [], reglages: { ouverture: "pilote", pilote_cips: ["2000001"], plafond_offres_7j: 3 } });
  eq("réglages : ouverture, CIP et plafond refusés", R.verifierReglages({ ouverture: "x", pilote_cips: ["abc"], plafond_offres_7j: 8 }).erreurs.length, 3);
  eq("réglages : plafond 0 admis (plus aucune offre)", R.verifierReglages({ ouverture: "toutes", pilote_cips: [], plafond_offres_7j: 0 }).ok, true);
  eq("réglages illisibles → défauts (fermée, plafond 2)", R.fusionnerReglages("{pas du json"), { ouverture: "fermee", pilote_cips: [], plafond_offres_7j: 2 });
  eq("ouverture : toutes / pilote / fermée", [R.raisonOuverture({ ouverture: "toutes", pilote_cips: [] }, "1"), R.raisonOuverture({ ouverture: "pilote", pilote_cips: ["2000001"] }, "2000001"),
    R.raisonOuverture({ ouverture: "pilote", pilote_cips: [] }, "2000001"), R.raisonOuverture({ ouverture: "fermee", pilote_cips: [] }, "2000001")], [null, null, "hors_pilote", "fermee"]);
  eq("catégories filtrées (inconnues retirées, ordre fixe)", R.filtrerCategories(["offres", "x", "stock", "stock"]), ["stock", "offres"]);
  eq("catégories illisibles → null", R.filtrerCategories("stock"), null);
  eq("aide des offres selon le plafond", [R.aideOffres(2), R.aideOffres(1), R.aideOffres(0)],
    ["Nos offres et nouveaux produits, 2 par semaine au plus.", "Nos offres et nouveaux produits, 1 par semaine au plus.", "Nos offres et nouveaux produits (aucun envoi en ce moment)."]);
}

// ── 2. Configuration ──
const VAPID = webpush.generateVAPIDKeys();          // paire d'essai, en mémoire seulement
const AUTRE = webpush.generateVAPIDKeys();
const ENV = { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: "mailto:pharmacien@elixirpharma.fr",
  SUPABASE_URL: "https://essai.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-serveur-essai", CRON_SECRET: "secret-essai" };
const CONF = P.configPush(ENV);
eq("configuration complète", [CONF.ok, CONF.defauts, CONF.cle_publique === VAPID.publicKey, CONF.sujet_affiche], [true, [], true, "mailto:pharmacien@elixirpharma.fr"]);
{
  const sansCle = P.configPush({ ...ENV, VAPID_PRIVATE_KEY: "" });
  eq("clé privée absente → indisponible", [sansCle.ok, sansCle.cles, sansCle.defauts], [false, null, ["VAPID_PRIVATE_KEY absente"]]);
  const illisible = P.configPush({ ...ENV, VAPID_PUBLIC_KEY: "pas-une-cle!" });
  eq("clé publique illisible", [illisible.ok, illisible.service.vapid_publique, illisible.cle_publique], [false, false, null]);
  const depareillees = P.configPush({ ...ENV, VAPID_PRIVATE_KEY: AUTRE.privateKey });
  eq("paire dépareillée (clé publique recalculée) → indisponible", [depareillees.ok, depareillees.service.vapid_paire, depareillees.cle_publique], [false, false, null]);
  const sujet = P.configPush({ ...ENV, VAPID_SUBJECT: "pharmacien@elixirpharma.fr" });
  eq("sujet sans mailto: refusé", [sujet.ok, sujet.service.sujet], [false, false]);
  const sujetDefaut = P.configPush({ ...ENV, VAPID_SUBJECT: "" });
  eq("sujet absent → mailto:pharmacien@elixirpharma.fr (signalé)", [sujetDefaut.ok, sujetDefaut.service.sujet_defaut, sujetDefaut.cles.subject], [true, true, "mailto:pharmacien@elixirpharma.fr"]);
  const sansServeur = P.configPush({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" });
  eq("clé serveur absente → indisponible", [sansServeur.ok, sansServeur.service.cle_serveur], [false, false]);
  const avecEgal = P.configPush({ ...ENV, VAPID_PUBLIC_KEY: `${VAPID.publicKey}=`, VAPID_PRIVATE_KEY: ` ${VAPID.privateKey} ` });
  eq("clés collées avec espace ou « = » final : acceptées", avecEgal.ok, true);
  const textes = JSON.stringify([sansCle, illisible, depareillees, sujet, sansServeur].map((c) => ({ d: c.defauts, s: c.service })));
  eq("aucune valeur de clé dans les messages de configuration", [textes.includes(VAPID.privateKey), textes.includes(AUTRE.privateKey), textes.includes("cle-serveur-essai")], [false, false, false]);
}

// ── 3. Abonnements ──
// abonnement d'essai : clé ECDH du « navigateur » + secret auth (le serveur ne voit que la partie publique)
function nouvelAppareil(endpoint) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, authBrut: auth, abonnement: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}
{
  const ap = nouvelAppareil("https://fcm.googleapis.com/fcm/send/abc");
  for (const e of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QOx",
    "https://api.push.apple.com/3/x", "https://wns2-db5p.notify.windows.com/w/?token=x", "https://android.googleapis.com/gcm/send/x"])
    eq(`hôte admis : ${new URL(e).hostname}`, P.validerAbonnement({ ...ap.abonnement, endpoint: e }).ok, true);
  for (const e of ["http://fcm.googleapis.com/fcm/send/abc", "https://127.0.0.1/x", "https://localhost/x", "https://fcm.googleapis.com:8443/x",
    "https://u:p@fcm.googleapis.com/x", "https://evil.example.com/x", "https://fcm.googleapis.com.evil.com/x", "https://notify.windows.com.evil.fr/x",
    `https://fcm.googleapis.com/${"a".repeat(1100)}`, "file:///etc/passwd", "pas une adresse"])
    eq(`adresse refusée : ${e.slice(0, 50)}`, P.validerAbonnement({ ...ap.abonnement, endpoint: e }).ok, false);
  eq("p256dh de 65 octets commençant par 0x04 seulement", [P.validerAbonnement({ ...ap.abonnement, keys: { ...ap.abonnement.keys, p256dh: b64u(Buffer.alloc(65, 1)) } }).ok,
    P.validerAbonnement({ ...ap.abonnement, keys: { ...ap.abonnement.keys, p256dh: b64u(Buffer.alloc(33, 4)) } }).ok], [false, false]);
  eq("auth de 16 octets seulement", P.validerAbonnement({ ...ap.abonnement, keys: { ...ap.abonnement.keys, auth: b64u(crypto.randomBytes(12)) } }).ok, false);
  eq("abonnement absent", P.validerAbonnement(null).ok, false);
  eq("hôte d'essai admis seulement si déclaré", [P.endpointValide("http://127.0.0.1:9/x"), P.endpointValide("http://127.0.0.1:9/x", ["127.0.0.1:9"])], [false, true]);
  eq("memeSecret", [P.memeSecret("abc", "abc"), P.memeSecret("abc", "abd"), P.memeSecret("", ""), P.memeSecret("abc", undefined)], [true, false, false, false]);
  eq("libellé d'appareil nettoyé", [P.libelleNet("iPhone · application"), P.libelleNet("<b>x</b>\n"), P.libelleNet(""), P.libelleNet("x".repeat(80)).length], ["iPhone · application", "bx/b", "Appareil", 60]);
  eq("plateforme inconnue → autre", [P.plateformeNette("ios"), P.plateformeNette("windows")], ["ios", "autre"]);
}
{
  const c = JSON.parse(P.charge({ categorie: "offres", titre: "T".repeat(100), corps: "C\nD", url: "https://x.fr", tag: "offre-1/2", id: "abc" }, 1));
  eq("charge : titre ≤ 80, corps sur une ligne, lien refusé → accueil, étiquette nettoyée", [c.v, c.titre.length, c.corps, c.url, c.tag, c.id, c.ts], [1, 80, "C D", "/", "offre-12", "abc", 1]);
  eq("charge : titre vide → Elixir Pharma", JSON.parse(P.charge({ titre: "" })).titre, "Elixir Pharma");
  eq("sujet (Topic) : 32 caractères base64url au plus", [P.sujetDe("stock-3400930000000"), P.sujetDe("é#"), P.sujetDe("x".repeat(40)).length], ["stock-3400930000000", null, 32]);
}

// ── 4. Faux service push local ──
// Déchiffrement aes128gcm (RFC 8188 + RFC 8291), comme le ferait le navigateur avec la clé privée de l'abonnement
function dechiffre(corps, appareil) {
  const salt = corps.subarray(0, 16), rs = corps.readUInt32BE(16), idlen = corps[20];
  const asPublic = corps.subarray(21, 21 + idlen), chiffre = corps.subarray(21 + idlen);
  const secret = appareil.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), appareil.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, appareil.authBrut, info, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  let fin = clair.length - 1;
  while (fin >= 0 && clair[fin] === 0) fin--;
  if (clair[fin] !== 2) throw new Error("délimiteur de dernier enregistrement absent");
  return { texte: clair.subarray(0, fin).toString("utf8"), rs, idlen };
}
// Jeton VAPID : « vapid t=<jwt>, k=<clé publique> » → { valide, charge }
function verifieVapid(autorisation, clePublique) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(autorisation || "");
  if (!m) return { valide: false };
  const [h, c, s] = m[1].split(".");
  const pub = Buffer.from(m[2], "base64url");
  const cle = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
  const valide = m[2] === clePublique && crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: cle, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  return { valide, entete: JSON.parse(Buffer.from(h, "base64url")), charge: JSON.parse(Buffer.from(c, "base64url")) };
}
const recues = [];
const reponses = new Map();   // chemin → statut (absent : 201 ; « lent » : aucune réponse)
const serveur = http.createServer((req, res) => {
  const morceaux = [];
  req.on("data", (m) => morceaux.push(m));
  req.on("end", () => {
    recues.push({ methode: req.method, chemin: req.url, entetes: req.headers, corps: Buffer.concat(morceaux) });
    const statut = reponses.get(req.url) ?? 201;
    if (statut === "lent") return;   // jamais de réponse : le délai de l'envoi doit couper
    res.statusCode = statut; res.end();
  });
});
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const HOTE = `127.0.0.1:${serveur.address().port}`;
const ESSAI = [HOTE];
const adresse = (chemin) => `http://${HOTE}${chemin}`;

{
  const ap = nouvelAppareil(adresse("/ok/1"));
  const ligne = { id: "l1", endpoint: ap.abonnement.endpoint, ...ap.abonnement.keys, failures: 0 };
  const texte = P.charge({ categorie: "stock", titre: "De retour en stock", corps: "Doliprane 1000 mg est de nouveau disponible.", url: "/?cip=3400930000000", tag: "stock-3400930000000" }, 42);
  const avant = Math.floor(Date.now() / 1000);
  const r = await P.envoyerAAppareils([ligne], texte, { cles: CONF.cles, ttl: P.TTL.stock, urgence: P.URGENCE.stock, sujet: "stock-3400930000000" }, { hotesEssai: ESSAI });
  eq("envoi réel au faux service : succès", [r.envoyes, r.echecs, r.retires, r.parLigne.get("l1")], [1, 0, 0, { ok: true, statut: 201 }]);
  const q = recues.at(-1);
  eq("requête POST au chemin de l'abonnement", [q.methode, q.chemin], ["POST", "/ok/1"]);
  eq("en-têtes : aes128gcm, TTL, Urgency, Topic", [q.entetes["content-encoding"], q.entetes.ttl, q.entetes.urgency, q.entetes.topic, q.entetes["content-type"]],
    ["aes128gcm", "43200", "high", "stock-3400930000000", "application/octet-stream"]);
  eq("Content-Length calculé par fetch (corps entier reçu)", Number(q.entetes["content-length"]), q.corps.length);
  const d = dechiffre(q.corps, ap);
  eq("corps déchiffré = charge JSON envoyée", JSON.parse(d.texte), JSON.parse(texte));
  eq("enregistrement aes128gcm : rs 4096, clé de l'émetteur de 65 octets", [d.rs, d.idlen], [4096, 65]);
  const j = verifieVapid(q.entetes.authorization, VAPID.publicKey);
  eq("jeton VAPID : signature ES256 valide avec la clé publique", [j.valide, j.entete.alg], [true, "ES256"]);
  eq("jeton VAPID : aud = origine du service, sub = mailto Elixir", [j.charge.aud, j.charge.sub], [`http://${HOTE}`, "mailto:pharmacien@elixirpharma.fr"]);
  vrai("jeton VAPID : exp dans les 24 h", j.charge.exp > avant && j.charge.exp <= avant + 24 * 3600 + 5);
  const faux = verifieVapid(q.entetes.authorization, AUTRE.publicKey);
  eq("jeton VAPID : refusé avec une autre clé", faux.valide, false);
  // Content-Length jamais transmis tel quel à fetch (calculé par fetch)
  let entetesVues = null;
  await P.envoyerAAppareils([ligne], texte, { cles: CONF.cles }, { transport: async (u, init) => { entetesVues = init.headers; return new Response(null, { status: 201 }); }, hotesEssai: ESSAI });
  eq("Content-Length absent des en-têtes donnés à fetch", Object.keys(entetesVues).includes("Content-Length"), false);
}

// ── Stock en mémoire (même interface que creerStockPush) ──
function stockMemoire({ reglages = { ouverture: "toutes" }, lignes = [], envois = [] } = {}) {
  const db = { ab: lignes.map((l) => ({ failures: 0, created_at: new Date().toISOString(), categories: ["stock", "commandes", "offres"], ...l })), reglages: R.fusionnerReglages(reglages),
    annonces: [], envois: envois.map((e, i) => ({ id: i + 1, ...e })), appels: [] };
  const copie = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
  const trace = (n) => db.appels.push(n);
  return {
    db,
    abonnements: {
      async parEndpoint(e) { trace("parEndpoint"); return copie(db.ab.find((l) => l.endpoint === e)) || null; },
      async deIdentite(i) { trace("deIdentite"); return copie(db.ab.filter((l) => (i.role === "admin" ? l.role === "admin" && l.compte_email === i.email : l.role === "pharmacie" && l.pharmacy_cip === i.cip))); },
      async enregistrer(ligne) {
        trace("enregistrer");
        const ex = db.ab.find((l) => l.endpoint === ligne.endpoint);
        if (ex) { Object.assign(ex, ligne); return copie(ex); }
        const n = { id: crypto.randomUUID(), failures: 0, created_at: new Date().toISOString(), last_success_at: null, ...ligne };
        db.ab.push(n); return copie(n);
      },
      async modifier(id, champs) { trace("modifier"); const l = db.ab.find((x) => x.id === id); if (l) Object.assign(l, champs); return copie(l) || null; },
      async supprimerIds(ids) { trace("supprimerIds"); db.ab = db.ab.filter((l) => !ids.includes(l.id)); },
      async succes(ids, quand) { trace("succes"); for (const l of db.ab) if (ids.includes(l.id)) Object.assign(l, { last_success_at: quand, failures: 0, last_error: null }); },
      async echec(id, failures, quand, erreur) { trace("echec"); const l = db.ab.find((x) => x.id === id); if (l) Object.assign(l, { failures, last_failure_at: quand, last_error: erreur }); },
      async dePharmacie(cip) { return copie(db.ab.filter((l) => l.role === "pharmacie" && l.pharmacy_cip === cip)); },
      async pourAnnonce({ cips = null } = {}) { return copie(db.ab.filter((l) => l.role === "pharmacie" && l.categories.includes("offres") && (!cips || cips.includes(l.pharmacy_cip)))); },
      async tous() { return copie(db.ab); },
    },
    reglages: { async lire() { return copie(db.reglages); }, async ecrire(v) { db.reglages = R.fusionnerReglages(v); return copie(db.reglages); } },
    annonces: {
      async creer(l) {
        if (l.idem && db.annonces.some((a) => a.idem === l.idem)) return { annonce: copie(db.annonces.find((a) => a.idem === l.idem)), existante: true };
        const a = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...l }; db.annonces.push(a); return { annonce: copie(a), existante: false };
      },
      async parIdem(idem) { return copie(db.annonces.find((a) => a.idem === idem)) || null; },
      async lire(id) { return copie(db.annonces.find((a) => a.id === id)) || null; },
      async enCours(depuis) { return copie(db.annonces.filter((a) => ["en_file", "en_cours"].includes(a.statut) && a.created_at >= depuis)); },
      async reclamer(id) { const a = db.annonces.find((x) => x.id === id && x.statut === "en_file"); if (!a) return null; a.statut = "en_cours"; return copie(a); },
      async terminer(id, champs) { Object.assign(db.annonces.find((a) => a.id === id), champs, { finished_at: new Date().toISOString() }); },
      async lister() { return copie(db.annonces.slice().reverse()); },
    },
    envois: {
      async ajouter(l) { for (const e of l) db.envois.push({ id: db.envois.length + 1, created_at: new Date().toISOString(), ...e }); },
      async plafond(depuis) { const n = new Map(); for (const e of db.envois) if (e.categorie === "offres" && e.nb_reussis > 0 && e.created_at >= depuis) n.set(e.pharmacy_cip, (n.get(e.pharmacy_cip) || 0) + 1); return n; },
      async dejaEnvoye(cip, tag) { return db.envois.some((e) => e.pharmacy_cip === cip && e.tag === tag && e.nb_reussis > 0); },
      async purger(avant) { db.envois = db.envois.filter((e) => e.created_at >= avant); },
    },
    async nomPharmacie() { return "PHARMACIE DU TEST"; },
  };
}
const ligneDe = (ap, extra) => ({ id: crypto.randomUUID(), endpoint: ap.abonnement.endpoint, ...ap.abonnement.keys, role: "pharmacie", ...extra });

{
  // statuts du service push : 404/410 → supprimée ; 429, 500, 403 → échec compté ; aucune réponse → délai dépassé
  const chemins = { "/ok/a": 201, "/ok/b": 200, "/g/404": 404, "/g/410": 410, "/e/429": 429, "/e/500": 500, "/e/403": 403, "/lent/1": "lent" };
  for (const [c, s] of Object.entries(chemins)) reponses.set(c, s);
  const aps = Object.keys(chemins).map((c) => nouvelAppareil(adresse(c)));
  const lignes = aps.map((ap, i) => ligneDe(ap, { pharmacy_cip: "2000001", failures: i === 4 ? 9 : 0, last_success_at: i === 5 ? new Date().toISOString() : null }));
  const stock = stockMemoire({ lignes });
  const t0 = Date.now();
  const r = await P.envoyerAAppareils(lignes, P.charge({ titre: "t", corps: "c" }), { cles: CONF.cles, delaiMs: 400 }, { stock, hotesEssai: ESSAI });
  eq("bilan : 2 envoyés, 4 échecs, 2 retirés", [r.envoyes, r.echecs, r.retires], [2, 4, 2]);
  vrai("délai dépassé coupé (≈ 400 ms, pas d'attente infinie)", Date.now() - t0 < 3000);
  eq("statut par ligne", lignes.map((l) => r.parLigne.get(l.id).statut), [201, 200, 404, 410, 429, 500, 403, 0]);
  eq("erreur du délai", r.parLigne.get(lignes[7].id).erreur, "délai dépassé");
  const reste = new Map(stock.db.ab.map((l) => [l.endpoint, l]));
  eq("404 et 410 : lignes supprimées", [reste.has(lignes[2].endpoint), reste.has(lignes[3].endpoint)], [false, false]);
  eq("succès : last_success_at posé, failures à 0", [!!reste.get(lignes[0].endpoint).last_success_at, reste.get(lignes[0].endpoint).failures], [true, 0]);
  eq("échec : failures + 1, dernière erreur", [reste.get(lignes[6].endpoint).failures, reste.get(lignes[6].endpoint).last_error], [1, "HTTP 403"]);
  eq("filet : 10e échec sans succès depuis 30 jours → supprimée", reste.has(lignes[4].endpoint), false);
  eq("10e échec mais succès récent → gardée", [reste.has(lignes[5].endpoint), reste.get(lignes[5].endpoint)?.failures], [true, 1]);
  // parallélisme borné
  let enVol = 0, max = 0;
  const transport = async () => { enVol++; max = Math.max(max, enVol); await pause(15); enVol--; return new Response(null, { status: 201 }); };
  const beaucoup = Array.from({ length: 50 }, (_, i) => ligneDe(nouvelAppareil(adresse(`/p/${i}`)), { pharmacy_cip: "2000001" }));
  const rp = await P.envoyerAAppareils(beaucoup, P.charge({ titre: "t", corps: "c" }), { cles: CONF.cles, parallele: 20 }, { transport, hotesEssai: ESSAI });
  eq("50 appareils, 20 en parallèle au plus", [rp.envoyes, max], [50, 20]);
  // adresse refusée en base (ligne ancienne) : jamais appelée, retirée
  let appele = false;
  const mauvaise = [{ id: "x", endpoint: "https://evil.example.com/x", ...nouvelAppareil("x").abonnement.keys }];
  const rm = await P.envoyerAAppareils(mauvaise, P.charge({ titre: "t" }), { cles: CONF.cles }, { transport: async () => { appele = true; return new Response(null, { status: 201 }); } });
  eq("adresse hors liste : jamais appelée, retirée", [appele, rm.retires], [false, 1]);
  let erreurCles = null;
  try { await P.envoyerAAppareils([], "{}", {}); } catch (e) { erreurCles = e.code; }
  eq("envoi sans clés VAPID refusé", erreurCles, "configuration");
}

// ── 5. push-abonnement ──
// une IP par requête (la limite de débit par IP a son propre essai, avec une IP fixe)
let numeroIp = 0;
const EVT = (corps, { methode = "POST", jeton = "jeton-pharmacie", hote = "elixir-commande.expepharma.com", ip = `10.0.${Math.floor(++numeroIp / 250)}.${numeroIp % 250}` } = {}) => ({
  httpMethod: methode, headers: { host: hote, origin: "https://elixir-commande.expepharma.com", "x-nf-client-connection-ip": ip, ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
  body: corps === undefined ? undefined : JSON.stringify(corps), queryStringParameters: {},
});
const UTILISATEURS = {
  "jeton-pharmacie": { email: "a@pharma.fr", isAdmin: false, cip: "2000001" },
  "jeton-autre": { email: "b@pharma.fr", isAdmin: false, cip: "2000002" },
  "jeton-sans-cip": { email: "c@pharma.fr", isAdmin: false, cip: null },
  "jeton-admin": { email: "pharmacien@elixirpharma.fr", isAdmin: true, cip: null },
  "jeton-admin2": { email: "sam.sayah@elixir-pharma.fr", isAdmin: true, cip: null },
};
const verifierJeton = async (t) => { if (t === "jeton-panne") throw Object.assign(new Error("x"), { indisponible: true }); return UTILISATEURS[t] || null; };
const corpsDe = (r) => JSON.parse(r.body || "null");
const secrets = (r, ap) => { const t = r.body || ""; return [ap.abonnement.endpoint, ap.abonnement.keys.p256dh, ap.abonnement.keys.auth, VAPID.privateKey].some((s) => s && t.includes(s)); };
const toutesReponses = [];
const avecTrace = (h) => async (e) => { const r = await h(e); toutesReponses.push(r); return r; };

{
  const stock = stockMemoire({ reglages: { ouverture: "toutes" } });
  const envoyes = [];
  const transport = async (u, init) => { envoyes.push(u); return new Response(null, { status: reponses.get(new URL(u).pathname) ?? 201 }); };
  const h = avecTrace(handlerAbonnement({ stock, config: () => CONF, verifierJeton, transport, hotesEssai: ESSAI, journal: () => {} }));
  // GET
  const g = await h(EVT(undefined, { methode: "GET", jeton: null }));
  eq("GET : disponible, clé publique, ouverture ; gardé 60 s", [g.statusCode, corpsDe(g), g.headers["Cache-Control"]],
    [200, { disponible: true, cle_publique: VAPID.publicKey, ouverture: "toutes" }, "private, max-age=60"]);
  const gSans = await handlerAbonnement({ stock, config: () => P.configPush({ ...ENV, VAPID_PRIVATE_KEY: "" }), journal: () => {} })(EVT(undefined, { methode: "GET", jeton: null }));
  eq("GET sans clé privée : indisponible, aucune clé", corpsDe(gSans), { disponible: false, cle_publique: null, ouverture: "fermee" });
  const gSchema = await handlerAbonnement({ stock: { reglages: { lire: async () => { throw Object.assign(new Error("x"), { code: "schema" }); } } }, config: () => CONF, journal: () => {} })(EVT(undefined, { methode: "GET", jeton: null }));
  eq("GET sans tables : indisponible", corpsDe(gSchema).disponible, false);
  // identité
  eq("sans jeton → 401 reconnexion", [(await h(EVT({ action: "statut" }, { jeton: null }))).statusCode], [401]);
  eq("jeton admin (saisie Elixir) → 403 admin", corpsDe(await h(EVT({ action: "abonner" }, { jeton: "jeton-admin" }))), { error: "admin" });
  eq("compte sans CIP → 403 fiche", corpsDe(await h(EVT({ action: "statut" }, { jeton: "jeton-sans-cip" }))), { error: "fiche" });
  const panne = await h(EVT({ action: "statut" }, { jeton: "jeton-panne" }));
  eq("Supabase Auth en panne → 503 indisponible (jamais « reconnectez-vous »)", [panne.statusCode, corpsDe(panne).error], [503, "indisponible"]);
  // statut sans appareil
  const s0 = corpsDe(await h(EVT({ action: "statut" })));
  eq("statut : disponible, aucun appareil, 3 catégories", [s0.disponible, s0.raison, s0.appareil, s0.appareils, s0.categories_disponibles.map((c) => c.id), s0.cle_publique],
    [true, null, null, [], ["stock", "commandes", "offres"], VAPID.publicKey]);
  // abonner
  const ap = nouvelAppareil(adresse("/ab/1"));
  const a1 = await h(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: { libelle: "Android · Chrome", plateforme: "android", installe: false },
    pharmacy_cip: "9999999", cip: "9999999", email: "pirate@x.fr" }));
  eq("abonner : 200, catégories par défaut", [a1.statusCode, corpsDe(a1).appareil.categories, corpsDe(a1).appareil.appareil], [200, ["stock", "commandes", "offres"], "Android · Chrome"]);
  const l1 = stock.db.ab.find((l) => l.endpoint === ap.abonnement.endpoint);
  eq("identité prise du JETON (CIP et e-mail du corps ignorés)", [l1.pharmacy_cip, l1.compte_email, l1.role, l1.pharmacie_nom], ["2000001", "a@pharma.fr", "pharmacie", "PHARMACIE DU TEST"]);
  // statut avec cet appareil
  const s1 = corpsDe(await h(EVT({ action: "statut", endpoint: ap.abonnement.endpoint })));
  eq("statut : appareil reconnu, marqué actuel", [s1.appareil?.appareil, s1.appareils.length, s1.appareils[0].actuel, s1.autre_identite], ["Android · Chrome", 1, true, false]);
  vrai("statut : dernière ouverture notée", !!stock.db.ab[0].last_seen_at);
  // catégories filtrées
  const c1 = await h(EVT({ action: "categories", endpoint: ap.abonnement.endpoint, categories: ["offres", "pirate"] }));
  eq("catégories : inconnues retirées", corpsDe(c1), { success: true, categories: ["offres"] });
  // une autre pharmacie ne touche pas cet appareil
  eq("catégories d'un appareil d'une autre pharmacie → 404", (await h(EVT({ action: "categories", endpoint: ap.abonnement.endpoint, categories: [] }, { jeton: "jeton-autre" }))).statusCode, 404);
  const a2 = await h(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: {} }, { jeton: "jeton-autre" }));
  eq("même appareil, autre pharmacie → 409 autre_identite (sans nom)", [a2.statusCode, corpsDe(a2)], [409, { error: "autre_identite", de: "une autre pharmacie" }]);
  eq("retirer par id d'une autre pharmacie → rien", [(await h(EVT({ action: "retirer", id: l1.id }, { jeton: "jeton-autre" }))).statusCode, stock.db.ab.length], [200, 1]);
  const s2 = corpsDe(await h(EVT({ action: "statut", endpoint: ap.abonnement.endpoint }, { jeton: "jeton-autre" })));
  eq("statut de l'autre pharmacie : autre_identite, aucun appareil à elle", [s2.autre_identite, s2.appareil, s2.appareils], [true, null, []]);
  const a3 = await h(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: { libelle: "PC", plateforme: "ordinateur" }, remplacer: true }, { jeton: "jeton-autre" }));
  eq("remplacer: true → repris par l'autre pharmacie", [a3.statusCode, stock.db.ab[0].pharmacy_cip, stock.db.ab.length], [200, "2000002", 1]);
  // 10 appareils au plus
  for (let i = 0; i < 10; i++) await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse(`/dix/${i}`)).abonnement, appareil: {} }));
  const trop = await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse("/onze")).abonnement, appareil: {} }));
  eq("11e appareil → 409 trop_d_appareils", [trop.statusCode, corpsDe(trop).error], [409, "trop_d_appareils"]);
  const reabo = await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse("/dix/3")).abonnement, appareil: {}, categories: ["stock"] }));
  eq("10 appareils : réabonner un appareil déjà connu reste possible", [reabo.statusCode, corpsDe(reabo).appareil.categories], [200, ["stock"]]);
  const mauvais = await h(EVT({ action: "abonner", abonnement: { ...ap.abonnement, endpoint: "https://evil.example.com/x" }, appareil: {} }, { jeton: "jeton-autre" }));
  eq("adresse hors liste → 400 abonnement", [mauvais.statusCode, corpsDe(mauvais).error], [400, "abonnement"]);
  // test : seulement cet appareil, 3 par 10 min, 410 → retiré
  envoyes.length = 0;
  const t1 = await h(EVT({ action: "test", endpoint: ap.abonnement.endpoint }, { jeton: "jeton-autre" }));
  eq("test : 200, un seul envoi, vers cet appareil", [t1.statusCode, envoyes], [200, [ap.abonnement.endpoint]]);
  await h(EVT({ action: "test", endpoint: ap.abonnement.endpoint }, { jeton: "jeton-autre" }));
  await h(EVT({ action: "test", endpoint: ap.abonnement.endpoint }, { jeton: "jeton-autre" }));
  const t4 = await h(EVT({ action: "test", endpoint: ap.abonnement.endpoint }, { jeton: "jeton-autre" }));
  eq("4e test en 10 min → 429", [t4.statusCode, envoyes.length], [429, 3]);
  const apGone = nouvelAppareil(adresse("/test/410"));
  reponses.set("/test/410", 410);
  await h(EVT({ action: "abonner", abonnement: apGone.abonnement, appareil: {} }, { jeton: "jeton-autre" }));
  const t410 = await h(EVT({ action: "test", endpoint: apGone.abonnement.endpoint }, { jeton: "jeton-autre" }));
  eq("test sur un appareil expiré → 410 expire, ligne retirée", [t410.statusCode, corpsDe(t410).error, stock.db.ab.some((l) => l.endpoint === apGone.abonnement.endpoint)], [410, "expire", false]);
  const apErr = nouvelAppareil(adresse("/test/429"));
  reponses.set("/test/429", 429);
  await h(EVT({ action: "abonner", abonnement: apErr.abonnement, appareil: {} }, { jeton: "jeton-autre" }));
  const t429 = await h(EVT({ action: "test", endpoint: apErr.abonnement.endpoint }, { jeton: "jeton-autre" }));
  eq("test refusé par le service push → 502 envoi HTTP 429", [t429.statusCode, corpsDe(t429)], [502, { error: "envoi", detail: "HTTP 429" }]);
  eq("test d'un appareil d'une autre pharmacie → 404", (await h(EVT({ action: "test", endpoint: ap.abonnement.endpoint }))).statusCode, 404);
  // oublier (sans jeton, preuve)
  const mauvaisePreuve = await h(EVT({ action: "oublier", endpoint: ap.abonnement.endpoint, auth: b64u(crypto.randomBytes(16)) }, { jeton: null }));
  eq("oublier, mauvaise preuve → 200, rien supprimé, aucun indice", [mauvaisePreuve.statusCode, corpsDe(mauvaisePreuve), stock.db.ab.some((l) => l.endpoint === ap.abonnement.endpoint)],
    [200, { success: true, role: null }, true]);
  const inconnu = await h(EVT({ action: "oublier", endpoint: adresse("/inconnu"), auth: "x" }, { jeton: null }));
  eq("oublier, appareil inconnu → même réponse", corpsDe(inconnu), { success: true, role: null });
  const bonnePreuve = await h(EVT({ action: "oublier", endpoint: ap.abonnement.endpoint, auth: ap.abonnement.keys.auth }, { jeton: null }));
  eq("oublier, bonne preuve → supprimé", [corpsDe(bonnePreuve), stock.db.ab.some((l) => l.endpoint === ap.abonnement.endpoint)], [{ success: true, role: "pharmacie" }, false]);
  // renouveler (sans jeton, preuve de l'ancien)
  const ancien = nouvelAppareil(adresse("/ren/ancien")), nouveau = nouvelAppareil(adresse("/ren/nouveau"));
  await h(EVT({ action: "abonner", abonnement: ancien.abonnement, appareil: { libelle: "iPhone · application", plateforme: "ios", installe: true }, categories: ["stock"] }, { jeton: "jeton-autre" }));
  const rf = await h(EVT({ action: "renouveler", ancien: { endpoint: ancien.abonnement.endpoint, auth: "faux" }, abonnement: nouveau.abonnement }, { jeton: null }));
  eq("renouveler, preuve fausse → success: false, rien changé", [corpsDe(rf), stock.db.ab.some((l) => l.endpoint === nouveau.abonnement.endpoint)], [{ success: false }, false]);
  const rv = await h(EVT({ action: "renouveler", ancien: { endpoint: ancien.abonnement.endpoint, auth: ancien.abonnement.keys.auth }, abonnement: nouveau.abonnement }, { jeton: null }));
  const ren = stock.db.ab.find((l) => l.endpoint === nouveau.abonnement.endpoint);
  eq("renouveler, bonne preuve → identité et catégories gardées", [corpsDe(rv), ren?.pharmacy_cip, ren?.categories, ren?.p256dh === nouveau.abonnement.keys.p256dh,
    stock.db.ab.some((l) => l.endpoint === ancien.abonnement.endpoint)], [{ success: true }, "2000002", ["stock"], true, false]);
  // retirer (idempotent)
  const idRen = ren.id;
  eq("retirer par id (même pharmacie) → supprimé", [(await h(EVT({ action: "retirer", id: idRen }, { jeton: "jeton-autre" }))).statusCode, stock.db.ab.some((l) => l.id === idRen)], [200, false]);
  eq("retirer à nouveau → 200 (idempotent)", (await h(EVT({ action: "retirer", id: idRen }, { jeton: "jeton-autre" }))).statusCode, 200);
  // ouverture
  stock.db.reglages = R.fusionnerReglages({ ouverture: "fermee" });
  const sf = corpsDe(await h(EVT({ action: "statut" })));
  eq("ouverture fermée : statut 200 disponible: false, raison fermee", [sf.disponible, sf.raison], [false, "fermee"]);
  eq("ouverture fermée : abonner → 403 fermee", corpsDe(await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse("/f")).abonnement, appareil: {} }))), { error: "fermee" });
  stock.db.reglages = R.fusionnerReglages({ ouverture: "pilote", pilote_cips: ["2000002"] });
  eq("pilote : hors liste → hors_pilote ; dans la liste → disponible", [corpsDe(await h(EVT({ action: "statut" }))).raison, corpsDe(await h(EVT({ action: "statut" }, { jeton: "jeton-autre" }))).disponible], ["hors_pilote", true]);
  eq("pilote : abonner hors liste → 403 hors_pilote", corpsDe(await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse("/hp")).abonnement, appareil: {} }))), { error: "hors_pilote" });
  stock.db.reglages = R.fusionnerReglages({ ouverture: "toutes" });
  // aperçu Netlify : fictif, rien lu ni écrit
  const nAppels = stock.db.appels.length, nLignes = stock.db.ab.length;
  const ap1 = await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse("/apercu")).abonnement, appareil: {} }, { hote: "deploy-preview-12--commandes-elixir.netlify.app" }));
  const ap2 = await h(EVT({ action: "statut" }, { hote: "deploy-preview-12--commandes-elixir.netlify.app" }));
  eq("aperçu : réponses fictives, aucune lecture ni écriture", [corpsDe(ap1), corpsDe(ap2).apercu, stock.db.appels.length === nAppels, stock.db.ab.length === nLignes],
    [{ success: true, apercu: true }, true, true, true]);
  // erreurs de base
  const hPanne = handlerAbonnement({ stock: { ...stock, reglages: { lire: async () => { throw Object.assign(new Error("x"), { code: "schema" }); } } }, config: () => CONF, verifierJeton, journal: () => {} });
  eq("tables absentes : statut → disponible: false (carte masquée)", corpsDe(await hPanne(EVT({ action: "statut" }))), { disponible: false, raison: null });
  eq("tables absentes : abonner → 503", (await hPanne(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: {} }))).statusCode, 503);
  eq("action inconnue → 400 ; corps illisible → 400", [(await h(EVT({ action: "pirater" }))).statusCode, (await h({ ...EVT({}), body: "{x" })).statusCode], [400, 400]);
  // débit par IP
  const hDebit = handlerAbonnement({ stock, config: () => CONF, verifierJeton, journal: () => {} });
  let dernier = null;
  for (let i = 0; i < 11; i++) dernier = await hDebit(EVT({ action: "oublier", endpoint: "x", auth: "y" }, { jeton: null, ip: "1.2.3.4" }));
  eq("oublier : 10 par minute et par IP, puis 429 avec Retry-After", [dernier.statusCode, !!dernier.headers["Retry-After"]], [429, true]);
}

// ── 6. push-admin ──
const lancements = [];
{
  const pharmas = Array.from({ length: 4 }, (_, i) => nouvelAppareil(adresse(`/pa/${i}`)));
  const lignes = [
    ligneDe(pharmas[0], { pharmacy_cip: "2000001", pharmacie_nom: "PHARMACIE A", compte_email: "a@pharma.fr", plateforme: "android", categories: ["stock", "offres"] }),
    ligneDe(pharmas[1], { pharmacy_cip: "2000001", pharmacie_nom: "PHARMACIE A", compte_email: "a@pharma.fr", plateforme: "ordinateur", categories: ["stock"], failures: 4 }),
    ligneDe(pharmas[2], { pharmacy_cip: "2000002", pharmacie_nom: "PHARMACIE B", compte_email: "b@pharma.fr", plateforme: "ios", installe: true, categories: ["commandes"] }),
    ligneDe(pharmas[3], { pharmacy_cip: "2000003", pharmacie_nom: "PHARMACIE C", compte_email: "c@pharma.fr", plateforme: "ios", installe: true, categories: ["offres"] }),
  ];
  const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes });
  const verifierAdmin = async (e) => { const u = UTILISATEURS[String(e.headers.authorization || "").replace("Bearer ", "")]; return u?.isAdmin ? { admin: u } : { error: { statusCode: 403, headers: {}, body: "{\"error\":\"Accès admin requis\"}" } }; };
  const envoyes = [];
  const transport = async (u) => { envoyes.push(new URL(u).pathname); return new Response(null, { status: 201 }); };
  const lancer = async (event, id) => { lancements.push(id); return null; };
  const h = avecTrace(handlerAdmin({ stock, config: () => CONF, verifierAdmin, transport, hotesEssai: ESSAI, lancer, journal: () => {} }));
  const A = (corps, o = {}) => EVT(corps, { jeton: "jeton-admin", ...o });
  eq("jeton pharmacie → 403", (await h(EVT({ action: "etat" }))).statusCode, 403);
  const etat = corpsDe(await h(A({ action: "etat" })));
  eq("état : service complet, tables", [etat.disponible, etat.service.tables, etat.service.vapid_paire, etat.service.defauts, etat.cle_publique], [true, true, true, [], VAPID.publicKey]);
  eq("état : statistiques", etat.stats, { pharmacies: 3, appareils: 4, par_categorie: { stock: 1, commandes: 1, offres: 2 }, par_plateforme: { ios: 2, android: 1, ordinateur: 1, autre: 0 },
    installes: 2, en_echec: 1, vus_30j: 4 });
  eq("état : pharmacies triées par nom", etat.pharmacies.map((p) => [p.nom, p.appareils, p.categories]), [["PHARMACIE A", 2, ["stock", "offres"]], ["PHARMACIE B", 1, ["commandes"]], ["PHARMACIE C", 1, ["offres"]]]);
  const etatSans = corpsDe(await handlerAdmin({ stock, config: () => P.configPush({ ...ENV, VAPID_PUBLIC_KEY: "", CRON_SECRET: "" }), verifierAdmin, journal: () => {} })(A({ action: "etat" })));
  eq("état sans clé publique ni CRON_SECRET : coches et consignes, aucune valeur", [etatSans.disponible, etatSans.service.vapid_publique, etatSans.service.defauts.length >= 2,
    JSON.stringify(etatSans).includes(VAPID.privateKey)], [false, false, true, false]);
  // réglages
  eq("réglages invalides → 400 erreurs", (await h(A({ action: "reglages", reglages: { ouverture: "x", plafond_offres_7j: 9 } }))).statusCode, 400);
  eq("réglages valides enregistrés", corpsDe(await h(A({ action: "reglages", reglages: { ouverture: "toutes", pilote_cips: [], plafond_offres_7j: 2 } }))).reglages.plafond_offres_7j, 2);
  // appareils admin
  const tel = nouvelAppareil(adresse("/adm/tel")), tel2 = nouvelAppareil(adresse("/adm/autre-admin"));
  const ab = await h(A({ action: "abonner_admin", abonnement: tel.abonnement, appareil: { libelle: "iPhone · application", plateforme: "ios", installe: true } }));
  eq("abonner_admin : rôle admin, aucune catégorie, sans CIP", [ab.statusCode, stock.db.ab.find((l) => l.endpoint === tel.abonnement.endpoint)?.role,
    stock.db.ab.find((l) => l.endpoint === tel.abonnement.endpoint)?.categories, stock.db.ab.find((l) => l.endpoint === tel.abonnement.endpoint)?.pharmacy_cip], [200, "admin", [], null]);
  await h(A({ action: "abonner_admin", abonnement: tel2.abonnement, appareil: {} }, { jeton: "jeton-admin2" }));
  const etat2 = corpsDe(await h(A({ action: "etat", endpoint: tel.abonnement.endpoint })));
  eq("mes appareils : ceux de CET admin seulement, actuel repéré", etat2.mes_appareils.map((a) => [a.appareil, a.actuel]), [["iPhone · application", true]]);
  eq("appareil de pharmacie pris par l'admin → 409 avec le nom (admin)", corpsDe(await h(A({ action: "abonner_admin", abonnement: pharmas[3].abonnement, appareil: {} }))),
    { error: "autre_identite", de: "PHARMACIE C" });
  envoyes.length = 0;
  eq("test admin : ses appareils seulement", [corpsDe(await h(A({ action: "test" }))), envoyes], [{ envoyes: 1, echecs: 0, retires: 0 }, ["/adm/tel"]]);
  envoyes.length = 0;
  const apc = corpsDe(await h(A({ action: "apercu", annonce: { titre: "Vaseline", corps: "Précommande ouverte", url: "/?menu=promo_1" } })));
  eq("aperçu de l'annonce : ses appareils seulement, rien dans push_envois", [apc.envoyes, envoyes, stock.db.envois.length], [1, ["/adm/tel"], 0]);
  eq("aperçu d'une annonce invalide → 400", (await h(A({ action: "apercu", annonce: { titre: "", corps: "x", url: "/" } }))).statusCode, 400);
  // estimer et plafond
  stock.db.envois.push({ id: 99, categorie: "offres", pharmacy_cip: "2000003", nb_reussis: 1, created_at: new Date(Date.now() - 3 * 86400e3).toISOString() },
    { id: 100, categorie: "offres", pharmacy_cip: "2000003", nb_reussis: 1, created_at: new Date(Date.now() - 1 * 86400e3).toISOString() });
  eq("estimer : 2 visées (offres), 1 plafonnée (2 offres ces 7 jours), 1 recevra", corpsDe(await h(A({ action: "estimer", audience: "toutes" }))),
    { visees: 2, plafonnees: 1, recevront: 1, appareils: 1, fermee: false, plafond_offres_7j: 2 });
  eq("estimer liste", corpsDe(await h(A({ action: "estimer", audience: "liste", cips: ["2000001", "2000002"] }))).visees, 1);
  // envoyer : validation, idempotence, en cours, lancement
  const annonce = { titre: "Vaseline : précommande", corps: "13 références à prix net.", url: "/?menu=promo_1", audience: "toutes" };
  eq("envoyer sans idem → 400", (await h(A({ action: "envoyer", annonce }))).statusCode, 400);
  eq("envoyer une annonce invalide → 400 erreurs", corpsDe(await h(A({ action: "envoyer", annonce: { ...annonce, url: "https://x.fr" }, idem: "idem-00000001" }))).erreurs.length, 1);
  const e1 = await h(A({ action: "envoyer", annonce, idem: "idem-00000001" }));
  eq("envoyer → 202, en file, lancée une fois", [e1.statusCode, corpsDe(e1).annonce.statut, lancements.length], [202, "en_file", 1]);
  const e2 = await h(A({ action: "envoyer", annonce, idem: "idem-00000001" }));
  eq("même idem (double clic) → même annonce, pas de 2e lancement", [e2.statusCode, corpsDe(e2).deja, corpsDe(e2).annonce.id === corpsDe(e1).annonce.id, lancements.length], [200, true, true, 1]);
  const e3 = await h(A({ action: "envoyer", annonce, idem: "idem-00000002" }));
  eq("autre annonce pendant l'envoi → 409 en_cours", [e3.statusCode, corpsDe(e3).error], [409, "en_cours"]);
  // envoi en arrière-plan
  const bg = handlerEnvoi({ stock, config: () => CONF, transport, hotesEssai: ESSAI, journal: () => {} });
  eq("arrière-plan sans secret → 403", (await handlerEnvoi({ stock })({ httpMethod: "POST", headers: {}, body: JSON.stringify({ annonce: lancements[0] }) })).statusCode, 403);
  const bgAuto = handlerEnvoi({ stock, config: () => CONF, transport, hotesEssai: ESSAI, journal: () => {}, autoriser: () => true });
  envoyes.length = 0;
  await bgAuto({ httpMethod: "POST", headers: {}, body: JSON.stringify({ annonce: lancements[0] }) });
  await bgAuto({ httpMethod: "POST", headers: {}, body: JSON.stringify({ annonce: lancements[0] }) });
  const fin = stock.db.annonces.find((a) => a.id === lancements[0]);
  eq("annonce envoyée une seule fois (double lancement sans effet), plafond appliqué", [envoyes, fin.statut, fin.nb_visees, fin.nb_plafonnees, fin.nb_pharmacies, fin.nb_appareils, fin.nb_reussis],
    [["/pa/0"], "envoyee", 2, 1, 1, 1, 1]);
  eq("push_envois : une ligne par pharmacie servie", stock.db.envois.filter((e) => e.annonce_id === fin.id).map((e) => [e.pharmacy_cip, e.nb_appareils, e.nb_reussis, e.tag]),
    [["2000001", 1, 1, `offre-${fin.id.slice(0, 8)}`]]);
  void bg;
  // relancer, historique, saisie Elixir
  const e4 = await h(A({ action: "envoyer", annonce: { ...annonce, audience: "liste", cips: ["2000001"] }, idem: "idem-00000003" }));
  eq("nouvelle annonce après la fin de la précédente → 202", e4.statusCode, 202);
  eq("relancer trop tôt → 409", corpsDe(await h(A({ action: "relancer", id: corpsDe(e4).annonce.id }))).error, "trop_tot");
  stock.db.annonces.find((a) => a.id === corpsDe(e4).annonce.id).created_at = new Date(Date.now() - 3 * 60e3).toISOString();
  const nLanc = lancements.length;
  eq("relancer après 2 min → 202, relancée", [(await h(A({ action: "relancer", id: corpsDe(e4).annonce.id }))).statusCode, lancements.length], [202, nLanc + 1]);
  const hEchec = handlerAdmin({ stock, config: () => CONF, verifierAdmin, lancer: async () => "HTTP 500", journal: () => {} });
  stock.db.annonces.forEach((a) => { a.statut = "envoyee"; });
  const e5 = await hEchec(A({ action: "envoyer", annonce, idem: "idem-00000004" }));
  eq("lancement impossible → 502 lancement + annonce (bouton « Relancer »)", [e5.statusCode, corpsDe(e5).error, corpsDe(e5).annonce.statut], [502, "lancement", "en_file"]);
  const hist = corpsDe(await h(A({ action: "historique" })));
  eq("historique : annonces, CIP abrégés", [hist.annonces.length, hist.annonces.find((a) => a.audience === "liste").nb_cips], [3, 1]);
  const ph = corpsDe(await h(A({ action: "pharmacie", cip: "2000001" })));
  eq("saisie Elixir : appareils de la pharmacie, sans données techniques", [ph.appareils.length, ph.raison, Object.keys(ph.appareils[0]).sort()],
    [2, null, ["appareil", "categories", "created_at", "en_echec", "id", "installe", "last_success_at", "plateforme"]]);
  eq("saisie Elixir : CIP illisible → 400", (await h(A({ action: "pharmacie", cip: "x" }))).statusCode, 400);
  stock.db.reglages = R.fusionnerReglages({ ouverture: "fermee" });
  stock.db.annonces.forEach((a) => { a.statut = "envoyee"; });
  eq("ouverture fermée : envoyer → 409 fermee", corpsDe(await h(A({ action: "envoyer", annonce, idem: "idem-00000005" }))).error, "fermee");
  // retirer_admin
  const autreAdmin = stock.db.ab.find((l) => l.endpoint === tel2.abonnement.endpoint);
  await h(A({ action: "retirer_admin", id: autreAdmin.id }));
  eq("retirer_admin : jamais l'appareil d'un autre admin", stock.db.ab.some((l) => l.id === autreAdmin.id), true);
  await h(A({ action: "retirer_admin", endpoint: tel.abonnement.endpoint }));
  eq("retirer_admin : son appareil", stock.db.ab.some((l) => l.endpoint === tel.abonnement.endpoint), false);
  // aperçu Netlify
  const n0 = lancements.length;
  const apE = await h(A({ action: "envoyer", annonce, idem: "idem-00000006" }, { hote: "deploy-preview-3--commandes-elixir.netlify.app" }));
  eq("aperçu : envoyer fictif, rien lancé", [corpsDe(apE).apercu, lancements.length], [true, n0]);
  eq("aucune réponse admin ne contient d'adresse ni de clé d'appareil",
    toutesReponses.filter((r) => pharmas.some((p) => secrets(r, p)) || secrets(r, tel)).length, 0);
}

// ── 7. Annonces : audience, pilote, plafond, catégories ──
{
  const aps = Array.from({ length: 5 }, (_, i) => nouvelAppareil(adresse(`/an/${i}`)));
  const lignes = [
    ligneDe(aps[0], { pharmacy_cip: "3000001", categories: ["offres"] }),
    ligneDe(aps[1], { pharmacy_cip: "3000001", categories: ["offres", "stock"] }),
    ligneDe(aps[2], { pharmacy_cip: "3000002", categories: ["stock"] }),        // pas les offres
    ligneDe(aps[3], { pharmacy_cip: "3000003", categories: ["offres"] }),
    { ...ligneDe(aps[4], {}), role: "admin", pharmacy_cip: null, compte_email: "pharmacien@elixirpharma.fr", categories: [] },
  ];
  const jour = 86400e3;
  const stock = stockMemoire({ reglages: { ouverture: "pilote", pilote_cips: ["3000001", "3000002"], plafond_offres_7j: 2 }, lignes, envois: [
    { categorie: "offres", pharmacy_cip: "3000001", nb_reussis: 0, created_at: new Date(Date.now() - jour).toISOString() },     // échec : non compté
    { categorie: "offres", pharmacy_cip: "3000001", nb_reussis: 1, created_at: new Date(Date.now() - 8 * jour).toISOString() }, // 8e jour : sorti
    { categorie: "offres", pharmacy_cip: "3000001", nb_reussis: 1, created_at: new Date(Date.now() - 2 * jour).toISOString() },
    { categorie: "stock", pharmacy_cip: "3000001", nb_reussis: 1, created_at: new Date(Date.now() - jour).toISOString() },       // autre catégorie
    { categorie: "offres", pharmacy_cip: "3000009", nb_reussis: 1, created_at: new Date(Date.now() - 100 * jour).toISOString() }, // > 90 jours : purgé
  ] });
  const id = (await stock.annonces.creer({ titre: "t", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  const vus = [];
  const transport = async (u) => { vus.push(new URL(u).pathname); return new Response(null, { status: 201 }); };
  const r = await P.diffuserAnnonce(id, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("pilote : seuls les CIP pilotes abonnés aux offres ; admin jamais", [r.statut, vus.sort()], ["envoyee", ["/an/0", "/an/1"]]);
  eq("plafond : échecs, autres catégories et 8e jour non comptés (1 offre réussie sur 7 jours < 2)", stock.db.annonces[0].nb_plafonnees, 0);
  eq("purge des envois de plus de 90 jours", stock.db.envois.some((e) => e.pharmacy_cip === "3000009"), false);
  const id2 = (await stock.annonces.creer({ titre: "t2", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  vus.length = 0;
  await P.diffuserAnnonce(id2, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("2e annonce de la semaine → 3000001 plafonné (2 réussies sur 7 jours)", [vus, stock.db.annonces[1].nb_plafonnees, stock.db.annonces[1].nb_visees], [[], 1, 1]);
  stock.db.reglages = R.fusionnerReglages({ ouverture: "toutes", plafond_offres_7j: 0 });
  const id3 = (await stock.annonces.creer({ titre: "t3", corps: "c", url: "/", audience: "liste", cips: ["3000003"], statut: "en_file" })).annonce.id;
  vus.length = 0;
  await P.diffuserAnnonce(id3, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("plafond 0 → personne", [vus, stock.db.annonces[2].nb_plafonnees], [[], 1]);
  stock.db.reglages = R.fusionnerReglages({ ouverture: "toutes", plafond_offres_7j: 2 });
  const id4 = (await stock.annonces.creer({ titre: "t4", corps: "c", url: "/", audience: "liste", cips: ["3000003"], statut: "en_file" })).annonce.id;
  vus.length = 0;
  await P.diffuserAnnonce(id4, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("audience liste : seulement les CIP choisis", vus, ["/an/3"]);
  stock.db.reglages = R.fusionnerReglages({ ouverture: "fermee" });
  const id5 = (await stock.annonces.creer({ titre: "t5", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  const rf = await P.diffuserAnnonce(id5, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("ouverture fermée entre-temps → annonce en erreur, rien envoyé", [rf.statut, stock.db.annonces[4].statut, /fermée/.test(stock.db.annonces[4].erreur)], ["erreur", "erreur", true]);
  const rc = await P.diffuserAnnonce(crypto.randomUUID(), { stock, config: CONF });
  eq("annonce inconnue ou déjà réclamée → non lancée", rc.lancee, false);
}

// ── 8. notifierPharmacie : ne lève jamais ──
{
  const ap = nouvelAppareil(adresse("/np/1")), ap2 = nouvelAppareil(adresse("/np/2"));
  const stock = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligneDe(ap, { pharmacy_cip: "4000001", categories: ["stock"] }), ligneDe(ap2, { pharmacy_cip: "4000001", categories: ["offres"] })] });
  const vus = [];
  const transport = async (u, init) => { vus.push([new URL(u).pathname, init.headers.Topic, init.headers.Urgency]); return new Response(null, { status: 201 }); };
  const o = { stock, config: CONF, transport, hotesEssai: ESSAI };
  const r = await P.notifierPharmacie("4000001", "stock", { titre: "De retour en stock", corps: "x", url: "/?cip=3400930000000", tag: "stock-3400930000000" }, o);
  eq("stock : appareils qui ont gardé la catégorie, étiquette et urgence", [r, vus], [{ envoyes: 1, echecs: 0, retires: 0, raison: null }, [["/np/1", "stock-3400930000000", "high"]]]);
  eq("trace dans push_envois", stock.db.envois.at(-1).tag, "stock-3400930000000");
  eq("unique : même étiquette déjà envoyée → rien", (await P.notifierPharmacie("4000001", "stock", { titre: "t", tag: "stock-3400930000000" }, { ...o, unique: true })).raison, "deja_envoye");
  eq("commandes : aucun appareil abonné", (await P.notifierPharmacie("4000001", "commandes", { titre: "t" }, o)).raison, "aucun_appareil");
  eq("catégorie inconnue", (await P.notifierPharmacie("4000001", "pub", { titre: "t" }, o)).raison, "categorie");
  eq("clés absentes", (await P.notifierPharmacie("4000001", "stock", { titre: "t" }, { ...o, config: P.configPush({}) })).raison, "configuration");
  const panne = { ...stock, reglages: { lire: async () => { throw Object.assign(new Error("x"), { code: "schema" }); } } };
  eq("tables absentes", (await P.notifierPharmacie("4000001", "stock", { titre: "t" }, { ...o, stock: panne })).raison, "schema");
  const panne2 = { ...stock, reglages: { lire: async () => { throw new Error("réseau"); } } };
  eq("Supabase en panne", (await P.notifierPharmacie("4000001", "stock", { titre: "t" }, { ...o, stock: panne2 })).raison, "erreur");
  stock.db.reglages = R.fusionnerReglages({ ouverture: "fermee" });
  eq("ouverture fermée → rien", (await P.notifierPharmacie("4000001", "stock", { titre: "t" }, o)).raison, "fermee");
  stock.db.reglages = R.fusionnerReglages({ ouverture: "toutes", plafond_offres_7j: 1 });
  eq("offres : 1re envoyée", (await P.notifierPharmacie("4000001", "offres", { titre: "t", tag: "o1" }, o)).raison, null);
  eq("offres : plafond atteint", (await P.notifierPharmacie("4000001", "offres", { titre: "t", tag: "o2" }, o)).raison, "plafond");
  // service push qui ne répond pas : le délai (AbortSignal.timeout) coupe l'attente, l'appelant n'est jamais bloqué
  const muet = (u, init) => new Promise((_, rejette) => init.signal.addEventListener("abort", () => rejette(init.signal.reason)));
  const t0 = Date.now();
  const rl = await P.notifierPharmacie("4000001", "stock", { titre: "t" }, { ...o, transport: muet, delaiMs: 200 });
  eq("délai respecté : échec « délai dépassé » compté, sans exception", [rl.echecs, rl.raison, Date.now() - t0 < 2000], [1, null, true]);
  eq("délai : dernière erreur notée sur l'appareil", stock.db.ab.find((l) => l.endpoint === ap.abonnement.endpoint).last_error, "délai dépassé");
}

// ── 9. creerStockPush : chemins PostgREST, en-têtes, tables absentes ──
{
  const appels = [];
  const fauxFetch = (statut = 200, reponse = "[]") => async (u, init) => { appels.push({ u, init }); return new Response(reponse, { status: statut }); };
  const s = P.creerStockPush({ url: "https://essai.supabase.co", cle: "cle-serveur-essai", fetch: fauxFetch() });
  await s.abonnements.parEndpoint("https://fcm.googleapis.com/fcm/send/a,b(c)");
  eq("parEndpoint : filtre eq encodé, clé serveur en en-tête", [appels[0].u.includes("endpoint=eq.https%3A%2F%2Ffcm.googleapis.com%2Ffcm%2Fsend%2Fa%2Cb(c)"), appels[0].init.headers.apikey], [true, "cle-serveur-essai"]);
  await s.abonnements.enregistrer({ endpoint: "x" });
  eq("enregistrer : upsert sur endpoint", [appels[1].u.includes("on_conflict=endpoint"), appels[1].init.headers.Prefer], [true, "resolution=merge-duplicates,return=representation"]);
  await s.abonnements.pourAnnonce({ cips: ["2000001", "x"] });
  eq("pourAnnonce : catégorie offres, CIP filtrés", [appels[2].u.includes("categories=cs.%7Boffres%7D"), appels[2].u.includes('pharmacy_cip=in.("2000001")')], [true, true]);
  eq("pourAnnonce : liste vide → aucun appel", [await s.abonnements.pourAnnonce({ cips: [] }), appels.length], [[], 3]);
  await s.annonces.reclamer("00000000-0000-4000-8000-000000000000");
  eq("reclamer : écriture conditionnelle (statut en_file)", [appels[3].init.method, appels[3].u.includes("statut=eq.en_file")], ["PATCH", true]);
  await s.envois.plafond("2026-10-13T00:00:00.000Z");
  eq("plafond : offres réussies depuis 7 jours", /categorie=eq\.offres&nb_reussis=gt\.0&created_at=gte\./.test(appels[4].u), true);
  const s404 = P.creerStockPush({ url: "https://essai.supabase.co", cle: "k", fetch: fauxFetch(404, JSON.stringify({ code: "PGRST205", message: "table push_reglages absente" })) });
  let err = null;
  try { await s404.reglages.lire(); } catch (e) { err = e; }
  eq("table absente → code schema, message sans contenu de réponse", [err?.code, /absente/.test(err?.message)], ["schema", false]);
  let errCle = null;
  try { await P.creerStockPush({ url: "https://essai.supabase.co", cle: "" }).reglages.lire({ frais: true }); } catch (e) { errCle = e.code; }
  eq("clé serveur absente → configuration", errCle, "configuration");
  eq("réglages lus : défauts si la ligne est vide", await P.creerStockPush({ url: "u", cle: "k", fetch: fauxFetch(200, "[]") }).reglages.lire(), R.REGLAGES_DEFAUT);
}

// ── 10. Aucune réponse de la pharmacie ne contient de secret ──
eq("aucune réponse ne contient la clé privée VAPID", toutesReponses.filter((r) => (r.body || "").includes(VAPID.privateKey)).length, 0);
eq("aucune réponse ne contient de secret auth d'appareil", toutesReponses.filter((r) => /"auth"\s*:/.test(r.body || "") || /"p256dh"/.test(r.body || "") || /"endpoint"/.test(r.body || "")).length, 0);

// ── 11. Empaquetage comme Netlify (esbuild, Node 18, ESM + require) ──
{
  const dossier = mkdtempSync(join(tmpdir(), "test-push-paquet-"));
  try {
    for (const nom of ["push-abonnement", "push-admin", "push-envoi-background"]) {
      const sortie = join(dossier, `${nom}.mjs`);
      await build({ entryPoints: [join(RACINE, "netlify/functions", `${nom}.js`)], bundle: true, platform: "node", target: "node18", format: "esm", outfile: sortie,
        logLevel: "silent", banner: { js: 'import { createRequire as ___creerRequire } from "module"; const require = ___creerRequire(import.meta.url);' } });
      const m = await import(pathToFileURL(sortie).href);
      eq(`${nom} : empaqueté, handler exporté`, typeof m.handler, "function");
      if (nom === "push-abonnement") {
        const r = await m.handler({ httpMethod: "GET", headers: {} });
        eq("push-abonnement empaqueté, sans variables : GET indisponible, sans erreur", corpsDe(r), { disponible: false, cle_publique: null, ouverture: "fermee" });
      }
    }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

serveur.closeAllConnections?.();
serveur.close();
console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
