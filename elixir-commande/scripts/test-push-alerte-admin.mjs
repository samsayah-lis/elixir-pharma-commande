// Hors ligne : clés éphémères, faux push sur loopback, PostgREST doublé.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import webpush from "web-push";
import { creerHandler } from "../netlify/functions/push-alerte-admin.js";
import { charge, creerStockPush, configPush } from "../netlify/functions/_push.js";
import { lienValide } from "../src/notifications/regles.js";
import { stockMemoire } from "./push-stock-memoire.mjs";

let nb = 0;
const eq = (label, a, b) => { assert.deepEqual(a, b, label); nb++; };
const secret = "secret-fictif-test-admin-01234567890123456789";
const maintenant = () => new Date("2026-11-22T02:00:00Z"); // dimanche, nuit : envoi immédiat
const horodatage = String(maintenant().getTime() / 1000);
const signe = (b = { corps: "Question confidentielle", titre: "Titre confidentiel", tag: "groupe_1" }, extra = {}) => {
  const body = typeof b === "string" ? b : JSON.stringify(b);
  return { httpMethod: "POST", body, headers: { host: "elixir.example", "X-Elixir-Horodatage": horodatage,
    "X-Elixir-Signature": "sha256=" + crypto.createHmac("sha256", secret).update(`${horodatage}.${body}`).digest("hex") }, ...extra };
};
const vapid = webpush.generateVAPIDKeys();
const conf = configPush({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:test@example.com", SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "fictif" });
const logs = [], reponses = [], recues = [];
const serveur = http.createServer((req, res) => {
  const morceaux = [];
  req.on("data", (b) => morceaux.push(b));
  req.on("end", () => { recues.push({ url: req.url, headers: req.headers, corps: Buffer.concat(morceaux) }); res.statusCode = req.url === "/retire" ? 410 : req.url === "/echec" ? 500 : 201; res.end(); });
});
await new Promise((ok, non) => { serveur.once("error", non); serveur.listen(0, "127.0.0.1", ok); });
const hote = `127.0.0.1:${serveur.address().port}`;
const appareils = new Map();
function ligne(id, role = "admin") {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const authBrut = crypto.randomBytes(16); appareils.set(`/${id}`, { ecdh, authBrut });
  return { id, role, compte_email: `${id}@secret.invalid`, endpoint: `http://${hote}/${id}`, p256dh: ecdh.getPublicKey().toString("base64url"), auth: authBrut.toString("base64url") };
}
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
const stock = stockMemoire({ lignes: [ligne("admin1"), ligne("admin2"), ligne("pharmacie", "pharmacie"), ligne("retire"), ligne("echec")] });
const deps = { secret, maintenant, stock, config: () => conf, hotesEssai: [hote], journal: (o) => logs.push(o) };
async function appel(event, options = {}) { const r = await creerHandler({ ...deps, ...options })(event); reponses.push(r); return [r.statusCode, JSON.parse(r.body)]; }
try {
  eq("405", await appel({ httpMethod: "GET" }), [405, { error: "methode" }]);
  for (const body of ["x".repeat(2049), "é".repeat(1025)]) eq("413 octets", (await appel(signe(body)))[0], 413);
  eq("413 base64", (await appel(signe({}, { body: Buffer.alloc(2049).toString("base64"), isBase64Encoded: true })))[0], 413);
  for (const s of ["", "court"]) eq("secret absent/court", await appel(signe(), { secret: s }), [503, { error: "configuration" }]);
  const vieux = signe(); vieux.headers["X-Elixir-Horodatage"] = "1";
  eq("périmé", await appel(vieux), [401, { error: "horodatage" }]);
  const faux = signe(); faux.headers["X-Elixir-Signature"] = "sha256=" + "0".repeat(64);
  eq("fausse signature", await appel(faux), [401, { error: "signature" }]);
  for (const b of [null, [], {}, { corps: "" }, { corps: "   " }, { corps: 12 }, { corps: "x".repeat(241) }, { corps: "x", inconnu: 1 }, { corps: "x", url: "/admin" }, { corps: "x", titre: "x".repeat(81) }, { corps: "x", tag: "x".repeat(33) }, { corps: "x", tag: "a.b" }, { corps: "x", tag: null }])
    eq("corps invalide", (await appel(signe(JSON.stringify(b))))[0], 400);
  eq("json invalide", await appel(signe("{")), [400, { error: "json" }]);
  eq("VAPID absent", await appel(signe(), { config: () => configPush({}) }), [503, { error: "configuration" }]);
  eq("envoi", await appel(signe()), [200, { ok: true, envoyes: 2, echecs: 1, retires: 1 }]);
  eq("seuls admins", recues.map((r) => r.url).sort(), ["/admin1", "/admin2", "/echec", "/retire"]);
  for (const r of recues) {
    const c = JSON.parse(dechiffre(r.corps, appareils.get(r.url)).texte);
    eq("charge déchiffrée", [c.url, c.titre, c.corps, c.tag], ["/admin", "Titre confidentiel", "Question confidentielle", "groupe_1"]);
    eq("urgence et TTL et topic", [r.headers.urgency, r.headers.ttl, r.headers.topic], ["high", "21600", "groupe_1"]);
  }
  eq("stock mis à jour", [stock.db.supprimes, stock.db.ab.find((l) => l.id === "echec").failures, !!stock.db.ab.find((l) => l.id === "admin1").last_success_at], [["retire"], 1, true]);
  eq("aucun admin", await appel(signe(), { stock: stockMemoire({ lignes: [ligne("pharmacie2", "pharmacie")] }) }), [200, { ok: true, envoyes: 0, aucun: true }]);
  const avant = recues.length;
  const apercu = signe(); apercu.headers.host = "deploy-preview-42--commandes-elixir.netlify.app";
  eq("aperçu sans config ni stock", await appel(apercu, { config: () => { throw Error("ne doit pas lire"); } }), [200, { apercu: true }]);
  eq("aperçu sans envoi", recues.length, avant);
  const appels = [];
  eq("IP avant signature", (await appel(faux, { limite: (k) => { appels.push(k); return 60; } }))[0], 429);
  eq("IP seulement", appels, ["ip|?"]);
  appels.length = 0;
  await appel(faux, { limite: (k) => { appels.push(k); return 0; } });
  eq("signature fausse ne consomme pas global", appels, ["ip|?"]);
  const h = creerHandler({ ...deps, stock: stockMemoire() });
  for (let i = 0; i < 30; i++) eq("quota autorisé", (await h(signe())).statusCode, 200);
  const q = await h(signe()); eq("global dépassé", q.statusCode, 429); eq("Retry-After", Number(q.headers["Retry-After"]) > 0, true);
  eq("règles pharmacie inchangées", lienValide("/admin"), null);
  eq("charge sans option", JSON.parse(charge({ url: "/admin" })).url, "/");
  eq("option admin bornée", JSON.parse(charge({ url: "/admin/autre" }, 0, { admin: true })).url, "/");
  await appel(signe({ corps: "x" }), { stock: stockMemoire({ lignes: [ligne("defaut")] }) });
  eq("titre par défaut", JSON.parse(dechiffre(recues.at(-1).corps, appareils.get("/defaut")).texte).titre, "Elixir Admin : alerte");
  await appel(signe(), { stock: { abonnements: { admins: async () => { throw Error("endpoint email secret"); } } } });
  eq("journal à champs fixes", logs.every((o) => o.evt === "push_alerte_admin" && Object.keys(o).sort().join() === "code,echecs,envoyes,evt"), true);
  eq("aucune fuite", /confidentiel|endpoint|p256dh|auth|secret.invalid/.test(JSON.stringify([logs, reponses])), false);
  const urls = [];
  const s = creerStockPush({ url: "https://fictif.invalid", cle: "fictif", fetch: async (u) => { urls.push(new URL(u)); return new Response(JSON.stringify(urls.length === 1 ? Array(1000).fill({ role: "admin" }) : [{ role: "admin" }])); } });
  eq("admins paginés", (await s.abonnements.admins()).length, 1001);
  eq("filtre sur chaque page", urls.map((u) => [u.searchParams.get("role"), u.searchParams.get("offset"), u.searchParams.get("limit")]), [["eq.admin", "0", "1000"], ["eq.admin", "1000", "1000"]]);
  const dossier = mkdtempSync(join(tmpdir(), "alerte-admin-paquet-"));
  try {
    const sortie = join(dossier, "fonction.mjs");
    await build({ entryPoints: [new URL("../netlify/functions/push-alerte-admin.js", import.meta.url).pathname], bundle: true, platform: "node", target: "node18", format: "esm", outfile: sortie, logLevel: "silent", banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' } });
    const m = await import(pathToFileURL(sortie).href);
    eq("handler empaqueté", typeof m.handler, "function");
    eq("import opérationnel", (await m.creerHandler({ secret: "", journal: () => {} })(signe())).statusCode, 503);
  } finally { rmSync(dossier, { recursive: true, force: true }); }
  console.log(`${nb} OK, 0 échec(s)`);
} finally { serveur.closeAllConnections?.(); await new Promise((ok) => serveur.close(ok)); }
