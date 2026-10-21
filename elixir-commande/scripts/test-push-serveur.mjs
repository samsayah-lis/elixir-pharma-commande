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
//  • empaquetage esbuild des trois fonctions (comme Netlify) puis import du résultat ; restock-notify et restock-notify-cron
//    (crochet « Retour en stock » de _restock.js) : notifierPharmacie et web-push dans le paquet.
import crypto from "node:crypto";
import http from "node:http";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import webpush from "web-push";
import * as R from "../src/notifications/regles.js";
import * as P from "../netlify/functions/_push.js";
import { creerHandler as handlerAbonnement } from "../netlify/functions/push-abonnement.js";
import { creerHandler as handlerAdmin } from "../netlify/functions/push-admin.js";
import { creerHandler as handlerEnvoi } from "../netlify/functions/push-envoi-background.js";
import { stockMemoire } from "./push-stock-memoire.mjs";

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
    { ok: true, erreurs: [], reglages: { ouverture: "pilote", pilote_cips: ["2000001"], plafond_offres_7j: 3, plafond_infos_7j: 2, plafond_commandes_jour: 10 } });
  eq("réglages : ouverture, CIP et plafond refusés", R.verifierReglages({ ouverture: "x", pilote_cips: ["abc"], plafond_offres_7j: 8 }).erreurs.length, 3);
  eq("réglages : plafond 0 admis (plus aucune offre)", R.verifierReglages({ ouverture: "toutes", pilote_cips: [], plafond_offres_7j: 0 }).ok, true);
  eq("réglages illisibles → défauts (fermée, plafonds 2, 2 et 10)", R.fusionnerReglages("{pas du json"),
    { ouverture: "fermee", pilote_cips: [], plafond_offres_7j: 2, plafond_infos_7j: 2, plafond_commandes_jour: 10 });
  eq("ouverture : toutes / pilote / fermée", [R.raisonOuverture({ ouverture: "toutes", pilote_cips: [] }, "1"), R.raisonOuverture({ ouverture: "pilote", pilote_cips: ["2000001"] }, "2000001"),
    R.raisonOuverture({ ouverture: "pilote", pilote_cips: [] }, "2000001"), R.raisonOuverture({ ouverture: "fermee", pilote_cips: [] }, "2000001")], [null, null, "hors_pilote", "fermee"]);
  eq("catégories filtrées (inconnues retirées, ordre fixe)", R.filtrerCategories(["offres", "x", "stock", "stock"]), ["stock", "offres"]);
  eq("catégories illisibles → null", R.filtrerCategories("stock"), null);
  eq("aide des offres selon le plafond", [R.aideOffres(2), R.aideOffres(1), R.aideOffres(0)],
    ["Nos offres et nouveaux produits, 2 par semaine au plus.", "Nos offres et nouveaux produits, 1 par semaine au plus.", "Nos offres et nouveaux produits (aucun envoi en ce moment)."]);
  // « Retour en stock » branché (_restock.js, docs/notifications.md § 9.1) ; « Mes commandes et réclamations » branché aux
  // messages de l'admin et à l'outil entrepôt (§ 4 et 6) : plus de « bientôt » nulle part
  const aideDe = (id) => R.CATEGORIES.find((c) => c.id === id)?.aide || "";
  eq("Retour en stock et Mes commandes et réclamations : branchés, sans « bientôt », bouton de la Saisie nommé",
    [/bientôt/.test(aideDe("stock")), aideDe("stock").includes("M’avertir du retour"), /bientôt/.test(aideDe("commandes")), R.CATEGORIES.find((c) => c.id === "commandes").libelle],
    [false, true, false, "Mes commandes et réclamations"]);
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

// ── Stock en mémoire (même interface que creerStockPush) : scripts/push-stock-memoire.mjs (partagé avec test-push-messages)
// comptes : Map(e-mail → CIP actuel dans elixir_pharmacies) ; absent : chaque e-mail d'abonnement rattaché à son CIP
// ligne d'abonnement d'essai ; e-mail de compte par défaut : p<CIP>@pharma.fr
const ligneDe = (ap, extra = {}) => ({ id: crypto.randomUUID(), endpoint: ap.abonnement.endpoint, ...ap.abonnement.keys, role: "pharmacie",
  ...(extra.pharmacy_cip && !extra.compte_email ? { compte_email: `p${extra.pharmacy_cip}@pharma.fr` } : {}), ...extra });

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
  eq("statut : disponible, aucun appareil, 4 catégories (Informations Elixir comprise), plafond des informations", [s0.disponible, s0.raison, s0.appareil, s0.appareils,
    s0.categories_disponibles.map((c) => c.id), s0.cle_publique, s0.plafond_infos_7j], [true, null, null, [], ["stock", "commandes", "infos", "offres"], VAPID.publicKey, 2]);
  // abonner
  const ap = nouvelAppareil(adresse("/ab/1"));
  const a1 = await h(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: { libelle: "Android · Chrome", plateforme: "android", installe: false },
    pharmacy_cip: "9999999", cip: "9999999", email: "pirate@x.fr" }));
  eq("abonner : 200, catégories par défaut (les 4)", [a1.statusCode, corpsDe(a1).appareil.categories, corpsDe(a1).appareil.appareil], [200, ["stock", "commandes", "infos", "offres"], "Android · Chrome"]);
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
  eq("état : statistiques", etat.stats, { pharmacies: 3, appareils: 4, par_categorie: { stock: 1, commandes: 1, infos: 0, offres: 2 }, par_plateforme: { ios: 2, android: 1, ordinateur: 1, autre: 0 },
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
  eq("estimer : 2 visées (offres), 1 plafonnée (2 offres ces 7 jours), 1 recevra ; 1 pharmacie sans l'alerte, aucune cliente sans appareil",
    corpsDe(await h(A({ action: "estimer", audience: "toutes" }))),
    { categorie: "offres", visees: 2, plafonnees: 1, recevront: 1, appareils: 1, fermee: false, plafond: { max: 2, fenetre: "7 jours" }, plafond_offres_7j: 2,
      sans_appareil: 0, alerte_coupee: 1, hors_ouverture: 0 });
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
  Object.assign(stock.db.annonces.find((a) => a.id === corpsDe(e4).annonce.id), { created_at: new Date(Date.now() - 3 * 60e3).toISOString(), en_file_le: new Date(Date.now() - 3 * 60e3).toISOString() });
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
  eq("reclamer : annonce bloquée « en_cours » libérée d'abord, puis écriture conditionnelle (statut en_file)",
    [appels[3].init.method, /statut=eq\.en_cours&started_at=lt\./.test(appels[3].u), appels[4].init.method, appels[4].u.includes("statut=eq.en_file")], ["PATCH", true, "PATCH", true]);
  await s.envois.plafond("2026-10-13T00:00:00.000Z");
  eq("plafond : offres réussies (appareil joint ou e-mail de secours parti) depuis 7 jours", [/categorie=eq\.offres&created_at=gte\./.test(appels[5].u),
    decodeURIComponent(appels[5].u).includes("or=(nb_reussis.gt.0,email.eq.envoye)")], [true, true]);
  const s409 = P.creerStockPush({ url: "u", cle: "k", fetch: async (u, init) => new Response(init.method === "PATCH" && u.includes("statut=eq.en_file")
    ? JSON.stringify({ code: "23505", message: "duplicate key value violates unique constraint" }) : "[]", { status: u.includes("statut=eq.en_file") ? 409 : 200 }) });
  eq("reclamer : autre annonce en cours (index unique, 23505) → null, l'annonce reste en file", await s409.annonces.reclamer("00000000-0000-4000-8000-000000000000"), null);
  const s404 = P.creerStockPush({ url: "https://essai.supabase.co", cle: "k", fetch: fauxFetch(404, JSON.stringify({ code: "PGRST205", message: "table push_reglages absente" })) });
  let err = null;
  try { await s404.reglages.lire(); } catch (e) { err = e; }
  eq("table absente → code schema, message sans contenu de réponse", [err?.code, /absente/.test(err?.message)], ["schema", false]);
  let errCle = null;
  try { await P.creerStockPush({ url: "https://essai.supabase.co", cle: "" }).reglages.lire({ frais: true }); } catch (e) { errCle = e.code; }
  eq("clé serveur absente → configuration", errCle, "configuration");
  eq("réglages lus : défauts si la ligne est vide", await P.creerStockPush({ url: "u", cle: "k", fetch: fauxFetch(200, "[]") }).reglages.lire(), R.REGLAGES_DEFAUT);
}

// ── 12. Correctifs de la revue (sécurité, fiabilité) ──
{
  // S1 : CIP sentinelles (« 0 », « false ») jamais une identité ; CIP avec espaces nettoyé (même identité que le pilote)
  const U2 = { ...UTILISATEURS, "jeton-cip0-a": { email: "a0@pharma.fr", isAdmin: false, cip: "0" }, "jeton-cip0-b": { email: "b0@pharma.fr", isAdmin: false, cip: "0" },
    "jeton-false": { email: "f@pharma.fr", isAdmin: false, cip: "false" }, "jeton-espaces": { email: "e@pharma.fr", isAdmin: false, cip: " 2000001 " },
    "jeton-num0": { email: "n@pharma.fr", isAdmin: false, cip: 0 } };
  const verif2 = async (t) => U2[t] || null;
  const stock = stockMemoire({ reglages: { ouverture: "pilote", pilote_cips: ["2000001"] } });
  const h = avecTrace(handlerAbonnement({ stock, config: () => CONF, verifierJeton: verif2, transport: async () => new Response(null, { status: 201 }), hotesEssai: ESSAI, journal: () => {} }));
  for (const j of ["jeton-cip0-a", "jeton-false", "jeton-num0"]) {
    eq(`CIP sentinelle (${j}) : statut → 403 fiche`, corpsDe(await h(EVT({ action: "statut" }, { jeton: j }))), { error: "fiche" });
    eq(`CIP sentinelle (${j}) : abonner → 403 fiche, rien d'enregistré`, [corpsDe(await h(EVT({ action: "abonner", abonnement: nouvelAppareil(adresse(`/s1/${j}`)).abonnement, appareil: {} }, { jeton: j }))), stock.db.ab.length],
      [{ error: "fiche" }, 0]);
  }
  const ap = nouvelAppareil(adresse("/s1/esp"));
  const r = await h(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: {} }, { jeton: "jeton-espaces" }));
  eq("CIP « 2000001 » avec espaces : nettoyé (pilote reconnu, identité 2000001)", [r.statusCode, stock.db.ab[0]?.pharmacy_cip], [200, "2000001"]);
  eq("deux officines sans CIP ne se voient jamais (statut de B → 403, appareil de A intact)",
    [(await h(EVT({ action: "retirer", id: stock.db.ab[0].id }, { jeton: "jeton-cip0-b" }))).statusCode, stock.db.ab.length], [403, 1]);
  eq("notifierPharmacie : « 0 », « false », espaces", [(await P.notifierPharmacie("0", "stock", { titre: "t" }, { stock, config: CONF })).raison,
    (await P.notifierPharmacie("false", "stock", { titre: "t" }, { stock, config: CONF })).raison], ["aucun_appareil", "aucun_appareil"]);
  const vus = [];
  const rn = await P.notifierPharmacie(" 2000001 ", "stock", { titre: "t" }, { stock, config: CONF, hotesEssai: ESSAI, transport: async (u) => { vus.push(u); return new Response(null, { status: 201 }); } });
  eq("notifierPharmacie(« 2000001 » avec espaces) : appareil trouvé", [rn.raison, rn.envoyes], [null, 1]);
}
{
  // S2 : une configuration refusée par web-push n'est jamais « prête » et ne supprime AUCUN abonnement
  for (const sujet of ["https://elixir%pharma.fr", "https://elixirpharma.fr:99999", "https://[elixir]"]) {
    const c = P.configPush({ ...ENV, VAPID_SUBJECT: sujet });
    eq(`sujet ${sujet} : configuration non prête, défaut affiché`, [c.ok, c.service.sujet, c.defauts.some((d) => /VAPID_SUBJECT/.test(d)), c.cles], [false, false, true, null]);
  }
  const aps = [1, 2, 3].map((i) => nouvelAppareil(adresse(`/s2/${i}`)));
  const stock = stockMemoire({ lignes: aps.map((ap) => ligneDe(ap, { pharmacy_cip: "2000001" })) });
  let appels = 0, code = null;
  const transport = async () => { appels++; return new Response(null, { status: 201 }); };
  try { await P.envoyerAAppareils(stock.db.ab, P.charge({ titre: "t" }), { cles: { ...CONF.cles, subject: "https://elixir%pharma.fr" } }, { stock, transport, hotesEssai: ESSAI }); }
  catch (e) { code = e.code; }
  eq("envoi avec un sujet refusé : exception configuration, aucun appel, aucune suppression", [code, appels, stock.db.supprimes.length, stock.db.ab.length], ["configuration", 0, 0, 3]);
  const id = (await stock.annonces.creer({ titre: "t", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  const rd = await P.diffuserAnnonce(id, { stock, config: { ...CONF, cles: { ...CONF.cles, subject: "https://[elixir]" } }, transport, hotesEssai: ESSAI });
  eq("annonce avec un sujet refusé : erreur « configuration », abonnements intacts", [rd.statut, /Configuration VAPID/.test(stock.db.annonces[0].erreur), stock.db.ab.length, appels], ["erreur", true, 3, 0]);
  // clés d'appareil : point hors de la courbe → refusé à l'abonnement, retiré à l'envoi (seul cas de retrait avant l'envoi)
  const horsCourbe = b64u(Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]));
  eq("p256dh hors de la courbe P-256 : refusé à l'abonnement", P.validerAbonnement({ ...aps[0].abonnement, keys: { ...aps[0].abonnement.keys, p256dh: horsCourbe } }).ok, false);
  const ligneMauvaise = { ...ligneDe(aps[0], { pharmacy_cip: "2000001" }), id: "mauvaise", p256dh: horsCourbe };
  const rm = await P.envoyerAAppareils([ligneMauvaise], P.charge({ titre: "t" }), { cles: CONF.cles }, { transport, hotesEssai: ESSAI });
  eq("clés d'appareil illisibles : retiré, jamais appelé", [rm.retires, rm.parLigne.get("mauvaise").erreur, appels], [1, "clés de l'appareil illisibles", 0]);
}
{
  // S3 : abonnement d'un compte qui n'a plus accès à la pharmacie → jamais servi, supprimé
  const aps = [1, 2, 3].map((i) => nouvelAppareil(adresse(`/s3/${i}`)));
  const lignes = [ligneDe(aps[0], { pharmacy_cip: "5000001", compte_email: "titulaire@p1.fr" }), ligneDe(aps[1], { pharmacy_cip: "5000001", compte_email: "ancien@p1.fr" }),
    ligneDe(aps[2], { pharmacy_cip: "5000001", compte_email: "deplace@p1.fr" })];
  const comptes = new Map([["titulaire@p1.fr", "5000001"], ["deplace@p1.fr", "5000002"]]);   // ancien@ : disparu ; deplace@ : autre CIP
  const stock = stockMemoire({ lignes, comptes });
  const vus = [];
  const transport = async (u) => { vus.push(new URL(u).pathname); return new Response(null, { status: 201 }); };
  const r = await P.notifierPharmacie("5000001", "stock", { titre: "t" }, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("notifierPharmacie : seul le compte toujours rattaché est servi ; les deux autres supprimés", [r.envoyes, vus, stock.db.ab.map((l) => l.compte_email)],
    [1, ["/s3/1"], ["titulaire@p1.fr"]]);
  const stock2 = stockMemoire({ lignes: lignes.map((l) => ({ ...l, categories: ["offres"] })), comptes });
  const id = (await stock2.annonces.creer({ titre: "t", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  vus.length = 0;
  const est = await P.destinataires(stock2, { audience: "toutes" });
  eq("estimation (lecture seule) : comptes retirés écartés, rien supprimé", [est.appareils, stock2.db.ab.length], [1, 3]);
  await P.diffuserAnnonce(id, { stock: stock2, config: CONF, transport, hotesEssai: ESSAI });
  eq("annonce : seul le compte rattaché reçoit, les autres supprimés", [vus, stock2.db.ab.length], [["/s3/1"], 1]);
  const panne = { ...stockMemoire({ lignes }), comptes: async () => { throw new Error("réseau"); } };
  eq("lecture des comptes impossible : rien n'est envoyé (raison erreur)", (await P.notifierPharmacie("5000001", "stock", { titre: "t" }, { stock: panne, config: CONF, transport, hotesEssai: ESSAI })).raison, "erreur");
  // ménage : 12 mois sans visite, comptes, envois > 90 jours, annonce bloquée, hôtes
  const jour = 86400e3, il = (j) => new Date(Date.now() - j * jour).toISOString();
  const stock3 = stockMemoire({ lignes: [
    ligneDe(nouvelAppareil(adresse("/m/1")), { pharmacy_cip: "6000001", last_seen_at: il(400), created_at: il(500) }),
    ligneDe(nouvelAppareil(adresse("/m/2")), { pharmacy_cip: "6000002", last_seen_at: null, created_at: il(370) }),
    ligneDe(nouvelAppareil(adresse("/m/3")), { pharmacy_cip: "6000003", last_seen_at: il(10), created_at: il(500) }),
    ligneDe(nouvelAppareil(adresse("/m/4")), { pharmacy_cip: "6000004", compte_email: "parti@x.fr", last_seen_at: il(1) }),
    { ...ligneDe(nouvelAppareil(adresse("/m/5")), {}), role: "admin", pharmacy_cip: null, compte_email: "pharmacien@elixirpharma.fr", created_at: il(800) },
  ], envois: [{ categorie: "stock", pharmacy_cip: "6000003", nb_reussis: 1, created_at: il(95) }, { categorie: "stock", pharmacy_cip: "6000003", nb_reussis: 1, created_at: il(5) }] });
  stock3.db.comptes = new Map([["p6000001@pharma.fr", "6000001"], ["p6000002@pharma.fr", "6000002"], ["p6000003@pharma.fr", "6000003"]]);
  stock3.db.annonces.push({ id: "bloquee", statut: "en_cours", started_at: il(1), created_at: il(1) });
  stock3.db.hotes.set("vieux.example.com", il(100));
  const { creerHandler: handlerMenage } = await import("../netlify/functions/push-menage.js");
  const journalMenage = [];
  await handlerMenage({ stock: stock3, config: () => CONF, journal: (o) => journalMenage.push(o) })();
  eq("ménage : 12 mois sans visite → supprimés (dernière visite, sinon création) ; compte parti → supprimé ; admin gardé",
    stock3.db.ab.map((l) => l.pharmacy_cip || l.role), ["6000003", "admin"]);
  eq("ménage : envois > 90 jours purgés, annonce bloquée libérée, hôtes > 90 jours purgés",
    [stock3.db.envois.length, stock3.db.annonces[0].statut, stock3.db.hotes.size, journalMenage.at(-1).code], [1, "erreur", 0, "ok"]);
}
{
  // S4 : une seule diffusion à la fois ; plafond tenu même pour deux diffusions simultanées ; relance bornée
  const ap = nouvelAppareil(adresse("/s4/1"));
  const stock = stockMemoire({ reglages: { ouverture: "toutes", plafond_offres_7j: 2 }, lignes: [ligneDe(ap, { pharmacy_cip: "7000001", categories: ["offres"] })],
    envois: [{ categorie: "offres", pharmacy_cip: "7000001", nb_reussis: 1, created_at: new Date(Date.now() - 86400e3).toISOString() }] });
  const a1 = (await stock.annonces.creer({ titre: "a", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  const a2 = (await stock.annonces.creer({ titre: "b", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  let recues = 0, envoisPendant = null;
  const transport = async () => { recues++; envoisPendant ??= stock.db.envois.filter((e) => e.annonce_id).map((e) => [e.pharmacy_cip, e.nb_reussis]); await pause(30); return new Response(null, { status: 201 }); };
  const [r1, r2] = await Promise.all([P.diffuserAnnonce(a1, { stock, config: CONF, transport, hotesEssai: ESSAI }), P.diffuserAnnonce(a2, { stock, config: CONF, transport, hotesEssai: ESSAI })]);
  eq("deux diffusions simultanées : une seule part, l'autre reste en file", [[r1.lancee, r2.lancee].sort(), recues, stock.db.annonces.map((a) => a.statut).sort()],
    [[false, true], 1, ["en_file", "envoyee"]]);
  eq("push_envois écrit AVANT l'envoi (compté dans le plafond même si la fonction est coupée)", envoisPendant, [["7000001", 1]]);
  const enFile = stock.db.annonces.find((a) => a.statut === "en_file");
  const r3 = await P.diffuserAnnonce(enFile.id, { stock, config: CONF, transport, hotesEssai: ESSAI });
  eq("relancée ensuite : plafond 2/7 j atteint → personne (jamais 3 sur 7 jours)", [r3.statut, recues, stock.db.annonces.find((a) => a.id === enFile.id).nb_plafonnees], ["envoyee", 1, 1]);
  // nombres réels corrigés après l'envoi (échec → 0 : non compté dans le plafond)
  const stockE = stockMemoire({ reglages: { ouverture: "toutes" }, lignes: [ligneDe(nouvelAppareil(adresse("/s4/e")), { pharmacy_cip: "7000002", categories: ["offres"] })] });
  const ae = (await stockE.annonces.creer({ titre: "e", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce.id;
  await P.diffuserAnnonce(ae, { stock: stockE, config: CONF, transport: async () => new Response(null, { status: 500 }), hotesEssai: ESSAI });
  eq("envoi en échec : ligne corrigée à 0 réussi (non comptée)", stockE.db.envois.map((e) => e.nb_reussis), [0]);
  // relancer : jamais pendant une autre diffusion, jamais au-delà de 24 h
  const verifierAdmin = async () => ({ admin: { email: "pharmacien@elixirpharma.fr", isAdmin: true } });
  const lanc = [];
  const hA = handlerAdmin({ stock, config: () => CONF, verifierAdmin, lancer: async (e, id) => { lanc.push(id); return null; }, journal: () => {} });
  const vieille = (await stock.annonces.creer({ titre: "v", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce;
  stock.db.annonces.find((a) => a.id === vieille.id).created_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  eq("relancer après 24 h → 409 trop_ancienne", corpsDe(await hA(EVT({ action: "relancer", id: vieille.id }, { jeton: "jeton-admin" }))).error, "trop_ancienne");
  const autre = (await stock.annonces.creer({ titre: "x", corps: "c", url: "/", audience: "toutes", statut: "en_file" })).annonce;
  stock.db.annonces.find((a) => a.id === autre.id).created_at = new Date(Date.now() - 20 * 60e3).toISOString();
  stock.db.annonces.find((a) => a.id === vieille.id).statut = "en_cours";
  eq("relancer pendant une autre diffusion → 409 en_cours, rien lancé", [corpsDe(await hA(EVT({ action: "relancer", id: autre.id }, { jeton: "jeton-admin" }))).error, lanc.length], ["en_cours", 0]);
  eq("envoyer pendant une diffusion (même ancienne) → 409 en_cours",
    corpsDe(await hA(EVT({ action: "envoyer", annonce: { titre: "t", corps: "c", url: "/", audience: "toutes" }, idem: "idem-s4-000001" }, { jeton: "jeton-admin" }))).error, "en_cours");
}
{
  // S5 : une redirection du service push n'est jamais suivie (aucun autre hôte appelé)
  const autreRecu = [];
  const cibleInterne = http.createServer((req, res) => { autreRecu.push(req.url); res.statusCode = 201; res.end(); });
  await new Promise((ok) => cibleInterne.listen(0, "127.0.0.1", ok));
  const relais = http.createServer((req, res) => { req.resume(); res.statusCode = 307; res.setHeader("Location", `http://localhost:${cibleInterne.address().port}/interne/metadata`); res.end(); });
  await new Promise((ok) => relais.listen(0, "127.0.0.1", ok));
  const hoteRelais = `127.0.0.1:${relais.address().port}`;
  const ap = nouvelAppareil(`http://${hoteRelais}/push/1`);
  const stock = stockMemoire({ lignes: [ligneDe(ap, { pharmacy_cip: "2000001" })] });
  const r = await P.envoyerAAppareils(stock.db.ab, P.charge({ titre: "t" }), { cles: CONF.cles }, { stock, hotesEssai: [hoteRelais] });
  const p = [...r.parLigne.values()][0];
  eq("307 vers un hôte non admis : non suivie, échec « redirection », abonnement gardé, l'autre hôte ne reçoit rien",
    [p.ok, p.erreur, p.statut, stock.db.ab.length, autreRecu], [false, "redirection", 307, 1, []]);
  cibleInterne.close(); relais.close();
}
{
  // F2 : URL PostgREST bornées (tranches de 100), même pour 1 000 appareils et 500 pharmacies ; une tranche en échec n'arrête pas les autres
  const urls = [];
  let echouer = 0;
  const fauxFetch = async (u) => { urls.push(u); if (echouer && urls.length === echouer) return new Response("{}", { status: 500 }); return new Response("[]", { status: 200 }); };
  const s = P.creerStockPush({ url: "https://essai.supabase.co", cle: "k", fetch: fauxFetch });
  const ids = Array.from({ length: 1000 }, () => crypto.randomUUID());
  const cips = Array.from({ length: 500 }, (_, i) => String(3400000 + i));
  await s.abonnements.supprimerIds(ids);
  await s.abonnements.succes(ids);
  await s.abonnements.pourAnnonce({ cips });
  await s.comptes(cips.map((c) => `pharmacie.${c}@exemple-officine.fr`));
  await s.envois.corriger("00000000-0000-4000-8000-000000000000", new Map(cips.map((c, i) => [c, i % 3])));
  const longueurs = urls.map((u) => new URL(u).href.length);
  eq("1 000 appareils, 500 CIP : aucune URL au-delà de 6 Ko", [Math.max(...longueurs) <= 6000, urls.length === 10 + 10 + 5 + 10 + 6], [true, true]);
  urls.length = 0; echouer = 2;
  let err = null;
  try { await s.abonnements.supprimerIds(ids.slice(0, 300)); } catch (e) { err = e.message; }
  eq("tranche 2 sur 3 en échec : les 3 tranches tentées, erreur levée à la fin", [urls.length, /1 tranche\(s\) sur 3/.test(err || "")], [3, true]);
}
{
  // F8 : service push hors liste → hôte noté (jamais le chemin), visible dans l'état de l'admin
  const stock = stockMemoire({ reglages: { ouverture: "toutes" } });
  const h = handlerAbonnement({ stock, config: () => CONF, verifierJeton, hotesEssai: ESSAI, journal: () => {} });
  const ap = nouvelAppareil("https://push.exemple-navigateur.com/sub/JETON-SECRET-123");
  eq("hôte hors liste : 400 abonnement", (await h(EVT({ action: "abonner", abonnement: ap.abonnement, appareil: {} }))).statusCode, 400);
  eq("hôte noté sans chemin ni jeton", [...stock.db.hotes.keys()], ["push.exemple-navigateur.com"]);
  const verifierAdmin = async () => ({ admin: { email: "pharmacien@elixirpharma.fr", isAdmin: true } });
  const e = corpsDe(await handlerAdmin({ stock, config: () => CONF, verifierAdmin, journal: () => {} })(EVT({ action: "etat" }, { jeton: "jeton-admin" })));
  eq("admin : services push refusés listés", [e.hotes_refuses.map((x) => x.hote), JSON.stringify(e).includes("JETON-SECRET")], [["push.exemple-navigateur.com"], false]);
}
{
  // S6c : l'admin retire les appareils d'une pharmacie (demande d'effacement, appareil perdu)
  const aps = [1, 2, 3].map((i) => nouvelAppareil(adresse(`/s6/${i}`)));
  const stock = stockMemoire({ lignes: [ligneDe(aps[0], { pharmacy_cip: "8000001" }), ligneDe(aps[1], { pharmacy_cip: "8000001" }), ligneDe(aps[2], { pharmacy_cip: "8000002" })] });
  const verifierAdmin = async () => ({ admin: { email: "pharmacien@elixirpharma.fr", isAdmin: true } });
  const hA = avecTrace(handlerAdmin({ stock, config: () => CONF, verifierAdmin, journal: () => {} }));
  const A = (c) => EVT(c, { jeton: "jeton-admin" });
  eq("retirer_pharmacie : CIP illisible → 400", (await hA(A({ action: "retirer_pharmacie", cip: "0" }))).statusCode, 400);
  eq("retirer_pharmacie { id } d'une autre pharmacie → rien", [corpsDe(await hA(A({ action: "retirer_pharmacie", cip: "8000001", id: stock.db.ab[2].id }))).retires, stock.db.ab.length], [0, 3]);
  eq("retirer_pharmacie { id } → cet appareil", [corpsDe(await hA(A({ action: "retirer_pharmacie", cip: "8000001", id: stock.db.ab[0].id }))).retires, stock.db.ab.length], [1, 2]);
  eq("retirer_pharmacie { cip } → tous ses appareils, pas ceux des autres", [corpsDe(await hA(A({ action: "retirer_pharmacie", cip: "8000001" }))).retires, stock.db.ab.map((l) => l.pharmacy_cip)], [1, ["8000002"]]);
}

// ── 10. Aucune réponse de la pharmacie ne contient de secret ──
eq("aucune réponse ne contient la clé privée VAPID", toutesReponses.filter((r) => (r.body || "").includes(VAPID.privateKey)).length, 0);
eq("aucune réponse ne contient de secret auth d'appareil", toutesReponses.filter((r) => /"auth"\s*:/.test(r.body || "") || /"p256dh"/.test(r.body || "") || /"endpoint"/.test(r.body || "")).length, 0);

// ── 11. Empaquetage comme Netlify (esbuild, Node 18, ESM + require) ──
{
  const dossier = mkdtempSync(join(tmpdir(), "test-push-paquet-"));
  try {
    for (const nom of ["push-abonnement", "push-admin", "push-envoi-background", "push-menage", "push-programmes", "push-evenement", "restock-notify", "restock-notify-cron"]) {
      const sortie = join(dossier, `${nom}.mjs`);
      await build({ entryPoints: [join(RACINE, "netlify/functions", `${nom}.js`)], bundle: true, platform: "node", target: "node18", format: "esm", outfile: sortie,
        logLevel: "silent", banner: { js: 'import { createRequire as ___creerRequire } from "module"; const require = ___creerRequire(import.meta.url);' } });
      const m = await import(pathToFileURL(sortie).href);
      eq(`${nom} : empaqueté, handler exporté`, typeof m.handler, "function");
      if (nom === "push-evenement") {
        const r = await m.handler({ httpMethod: "POST", headers: {}, body: "{}" });
        eq("push-evenement empaqueté, sans secret : 503 configuration, rien lu", [r.statusCode, corpsDe(r).error], [503, "configuration"]);
      }
      if (nom === "push-abonnement") {
        const r = await m.handler({ httpMethod: "GET", headers: {} });
        eq("push-abonnement empaqueté, sans variables : GET indisponible, sans erreur", corpsDe(r), { disponible: false, cle_publique: null, ouverture: "fermee" });
      }
      // alertes retour : notifierPharmacie (chargée à la demande par _restock.js) et web-push dans le paquet de la fonction
      if (nom.startsWith("restock-notify")) eq(`${nom} : notifierPharmacie et web-push empaquetés`, [readFileSync(sortie, "utf8").includes("notifierPharmacie"), readFileSync(sortie, "utf8").includes("generateRequestDetails")], [true, true]);
    }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

serveur.closeAllConnections?.();
serveur.close();
console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
