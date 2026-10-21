// Tests du second correctif de sécurité (19/10/2026) : node scripts/test-securite-2.mjs
// Hors ligne : fetch simulé (Supabase Auth, tables, kv_store, Odoo), aucune donnée réelle lue ni écrite, aucun e-mail.
//  • order-save : sans jeton → 401, rien écrit (ni commande, ni stock, ni notification) ; pharmacie : identité du JETON
//    (CIP, e-mail, nom du corps ignorés) ; { verifier } ne fait que contrôler ; admin en saisie inchangé ;
//  • quota-status : sans jeton → 401 avant toute lecture ; adresses en eq (plus d'ilike « *@* ») ; compte inconnu → 403 ;
//  • gp-pharmacy / gp-upload : plus de repli sur l'e-mail du corps ; admin en saisie : adresse du corps ;
//  • ml-recommend : suggestions au CIP du jeton ; segments et ruptures réservés à l'admin ; « commandent aussi » public ;
//  • group-order : sans jeton → 401 ; pharmacie : ses lignes, les autres anonymes ; écritures au CIP du jeton ;
//  • pharmacy-otp-send : limite durable (kv_store) 10 par connexion et 5 par adresse × connexion et par heure, avant toute
//    recherche ; IPv6 compté par préfixe /64 ; aucun plafond par adresse seule (pas de blocage d'une pharmacie par un
//    tiers) ; code non envoyé par Supabase (règle des 60 s) non compté ; parcours « adresse inconnue » inchangé ;
//    ni adresse ni IP en clair dans kv_store ;
//  • pharmacy-otp-verify : 5 codes erronés par adresse et 20 par connexion en 15 min ; nouveau code → essais remis à zéro ;
//  • order-save (relecture) : quarantaine bornée des pages d'avant le correctif ; entered_by pour la saisie Elixir
//    seulement ; source et lignes « justificatif » contrôlées pour une pharmacie ;
//  • send-email : destinataire fixé, adresse du jeton, « identité non vérifiée » sans jeton, 401 si jeton invalide.
// Relecture finale (même jour) :
//  • site (code de src/App.jsx rejoué) : commande enregistrée AVANT l'e-mail ; enregistrement refusé → rien ne part,
//    panier intact ; même numéro d'un essai à l'autre et réponse perdue → pas de doublon ; e-mail en échec → commande
//    gardée ; quantités de commande groupée refusées (401) → reconnexion demandée, renvoyées après ;
//  • order-save : même numéro déjà enregistré → { deja } si c'est la même commande, 409 sinon ;
//  • pharmacy-otp-verify : la connexion qui a demandé le code n'est pas bloquée par les codes faux d'un tiers ;
//  • quarantaine : justificatif nettoyé gardé ; menageOrdonnances garde les ordonnances des commandes « a_verifier » ;
//  • Supabase Auth en panne : 503 « indisponible » (jamais 401), aucun accès, rien lu ni écrit.
// Péremption courte, V1 (« Odoo facture la remise ») : peremption.js — page publique ; admin, journal, droits, écarts et
// toute action POST réservés à l'admin (401/403 sans jeton, 403 jeton pharmacie) ; chaîne de nuit : x-cron-secret.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.ODOO_APIKEY = "";
process.env.ADMIN_EMAIL = "admin@elixir.test";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── Données fictives ──
const CIP_A = "2000001", CIP_B = "2000002";
const MAIL_A = "compte@pharmacie-a.test", MAIL_B = "compte@pharmacie-b.test";
const JETONS = {
  "jeton-a": { id: "u-a", email: MAIL_A },
  "jeton-b": { id: "u-b", email: MAIL_B },
  "jeton-c": { id: "u-c", email: "compte@pharmacie-c.test" },            // compte sans CIP ni fiche Odoo
  "jeton-inconnu": { id: "u-x", email: "quelquun@ailleurs.test" },       // connecté, mais aucun compte pharmacie
  "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } },
};
const PHARMACIES = [
  { email: MAIL_A, name: "Pharmacie A", cip: CIP_A, odoo_id: 11 },
  { email: "Second@Pharmacie-A.test", name: "Pharmacie A", cip: CIP_A, odoo_id: 11 },
  { email: MAIL_B, name: "Pharmacie B", cip: CIP_B, odoo_id: 12 },
  { email: "compte@pharmacie-c.test", name: "Pharmacie C", cip: null, odoo_id: null },
];
const GROUPE = [
  { fournisseur: "ulabs", cip: "3400000000011", pharmacy_cip: CIP_A, pharmacy_name: "Pharmacie A", qty: 6, updated_at: "2026-10-18T08:00:00Z" },
  { fournisseur: "ulabs", cip: "3400000000011", pharmacy_cip: CIP_B, pharmacy_name: "Pharmacie B", qty: 12, updated_at: "2026-10-18T09:00:00Z" },
  { fournisseur: "ulabs", cip: "3400000000028", pharmacy_cip: CIP_B, pharmacy_name: "Pharmacie B", qty: 3, updated_at: "2026-10-18T09:05:00Z" },
];
let odooPartenaire = null;   // fiche renvoyée par res.partner search_read (pharmacy-otp-send, adresse hors cache)
const dernierCode = new Map(); // Supabase Auth simulé : adresse → heure du dernier code envoyé
let verifyEnPanne = false;
let authEnPanne = null;      // Supabase Auth /user : null, statut HTTP (503, 504, 429) ou "reseau"
let baseCommandes = null;    // elixir_orders simulée (Map id → ligne) : doublons refusés en 409 comme Postgres ; null = 201 toujours
let commandesEnPanne = false;
let emailEnPanne = false;
let site = null;             // fonctions du site (/.netlify/functions/…), partie « site » plus bas
const kv = new Map();        // kv_store simulé : clé → { value, updated_at }
let kvEnPanne = false;

// ── fetch simulé : toute adresse inconnue échoue (aucun appel réel possible) ──
let appels = [];
const q = (url) => Object.fromEntries(new URL(url).searchParams);
const val = (v) => String(v ?? "").replace(/^eq\./, "");
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (site && url.startsWith("/.netlify/functions/")) return site(url, opts);
  const methode = opts.method || "GET";
  appels.push({ url, methode, corps: opts.body || null });
  const rep = (corps, status = 200) => new Response(status === 204 ? null : JSON.stringify(corps), { status });
  const p = url.startsWith("https://supabase.test/") ? q(url) : {};
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    if (authEnPanne === "reseau") throw new TypeError("fetch failed");
    if (authEnPanne) return rep({ msg: "upstream request timeout" }, authEnPanne);
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? rep(JETONS[t]) : rep({ msg: "jeton invalide" }, 401);
  }
  if (url.startsWith("https://supabase.test/auth/v1/otp")) {
    // Supabase : un code par adresse et par minute
    const em = JSON.parse(opts.body).email;
    if (dernierCode.has(em) && Date.now() - dernierCode.get(em) < 60e3) return rep({ msg: "For security purposes, you can only request this after 60 seconds." }, 429);
    dernierCode.set(em, Date.now());
    return rep({});
  }
  if (url.startsWith("https://supabase.test/auth/v1/verify")) {
    if (verifyEnPanne) return rep({ msg: "indisponible" }, 503);
    const b = JSON.parse(opts.body);
    return b.token === "123456" ? rep({ access_token: "jeton-a", refresh_token: "r-a", expires_in: 3600 }) : rep({ msg: "Token has expired or is invalid" }, 403);
  }
  if (url === "https://api.emailjs.com/api/v1.0/email/send") return emailEnPanne ? rep("EmailJS KO", 500) : rep("OK");
  if (url.startsWith("https://supabase.test/rest/v1/elixir_pharmacies")) {
    if (methode === "POST") return rep(null, 201);
    const champs = String(p.select || "*").split(",");
    const lignes = PHARMACIES.filter(r => (!p.email || r.email === val(p.email)) && (!p.odoo_id || String(r.odoo_id) === val(p.odoo_id)));
    return rep(lignes.slice(0, p.limit ? +p.limit : 99).map(r => champs[0] === "*" ? r : Object.fromEntries(champs.map(c => [c, r[c] ?? null]))));
  }
  if (url.startsWith("https://supabase.test/rest/v1/elixir_orders")) {
    if (commandesEnPanne) return rep({ message: "base indisponible" }, 500);
    if (!baseCommandes) return methode === "POST" ? rep(null, 201) : rep([]);
    if (methode === "POST") {
      const b = JSON.parse(opts.body);
      if (baseCommandes.has(b.id)) return rep({ code: "23505", message: 'duplicate key value violates unique constraint "elixir_orders_pkey"' }, 409);
      baseCommandes.set(b.id, b); return rep(null, 201);
    }
    return rep([...baseCommandes.values()].filter(o => (!p.id || String(o.id) === val(p.id)) && (!p.source || o.source === val(p.source))
      && (!p.processed || String(o.processed) === val(p.processed))));
  }
  if (url.startsWith("https://supabase.test/rest/v1/rpc/decrement_stock")) return rep(null, 204);
  if (url.startsWith("https://supabase.test/rest/v1/ec_notifications")) return rep(null, 201);
  if (url.startsWith("https://supabase.test/rest/v1/gp_access")) return rep(["11"].includes(val(p.pharmacy_id)) || val(p.pharmacy_id) === "12" ? [{ pharmacy_id: val(p.pharmacy_id) }] : []);
  if (url.startsWith("https://supabase.test/rest/v1/gp_participants")) return rep([]);
  if (url.startsWith("https://supabase.test/rest/v1/pharmacy_patterns")) return rep([{ pharmacy_cip: val(p.pharmacy_cip), cip: "3400000000011", avg_qty: 4, avg_interval_days: 10, last_order_date: "2026-10-01T00:00:00Z", confidence: 0.9, order_count: 3 }]);
  if (url.startsWith("https://supabase.test/rest/v1/elixir_products")) return rep([{ cip: "3400000000011", name: "Produit 11", section: "otc", pn: 2.5 }]);
  if (url.startsWith("https://supabase.test/rest/v1/ec_pharmacy_segments")) return rep([{ pharmacy_cip: CIP_B, pharmacy_name: "Pharmacie B", total_ca: 1234 }]);
  if (url.startsWith("https://supabase.test/rest/v1/ec_rupture_predictions")) return rep([{ cip: "3400000000011", level: "critical" }]);
  if (url.startsWith("https://supabase.test/rest/v1/product_associations")) return rep([]);
  if (url.startsWith("https://supabase.test/rest/v1/elixir_group_orders")) {
    if (methode === "POST") return rep(null, 201);
    if (methode === "DELETE") return rep(null, 204);
    return rep(GROUPE.filter(r => !p.fournisseur || r.fournisseur === val(p.fournisseur)));
  }
  // peremption ?action=page : fenêtre de la page (lecture publique du catalogue)
  if (url.startsWith("https://supabase.test/rest/v1/odoo_catalog?select=cip,name,list_price,discounted_price")) return rep([{ cip: "3400933121549", name: "ZINNAT", list_price: 3.74,
    discounted_price: 3.51, discount_pct: 6.1, in_stock: true, available: 10, earliest_expiry: "2027-02-28", lots: "[]", updated_at: "2026-10-20T06:00:00Z" }]);
  if (url.startsWith("https://supabase.test/rest/v1/kv_store")) {
    if (kvEnPanne) return rep({ message: "kv indisponible" }, 503);
    if (methode === "POST") { const b = JSON.parse(opts.body); kv.set(b.key, { value: b.value, updated_at: b.updated_at || new Date(Date.now()).toISOString() }); return rep(null, 201); }
    const like = String(p.key || "").startsWith("like.") ? p.key.slice(5).replace(/\*$/, "") : null;
    const cles = [...kv.keys()].filter(k => like != null ? k.startsWith(like) : k === val(p.key));
    if (methode === "DELETE") {
      const avant = p.updated_at ? String(p.updated_at).replace(/^lt\./, "") : null;
      for (const k of cles) if (!avant || kv.get(k).updated_at < avant) kv.delete(k);
      return rep(null, 204);
    }
    return rep(cles.map(k => ({ key: k, value: kv.get(k).value, updated_at: kv.get(k).updated_at })));
  }
  if (url === "https://odoo.test/jsonrpc") {
    const b = JSON.parse(opts.body).params;
    if (b.service === "common") return rep({ result: 7 });
    const [, , , model, method] = b.args;
    if (model === "ir.property" && method === "search_read") return rep({ result: [{ res_id: "product.template,5" }] });
    if (model === "product.template" && method === "read") return rep({ result: [{ id: 5, default_code: "3400000000011", barcode: "3400000000011", name: "Produit contingenté",
      quota: 10, quota_period: "-4", quota_slippery_days: 0, product_variant_id: [55, "Produit contingenté"], active: true }] });
    if (model === "res.partner" && method === "read") return rep({ result: [{ id: 11, deny_quota: false }] });
    if (model === "sale.order.line" && method === "search_read") return rep({ result: [] });
    if (model === "sale.order" && method === "search_read") return rep({ result: [] });
    if (model === "res.partner" && method === "search_read") return rep({ result: odooPartenaire ? [odooPartenaire] : [] });
    return rep({ error: { message: `appel Odoo inattendu : ${model}.${method}` } });
  }
  throw new Error(`appel réseau inattendu : ${methode} ${url}`);
};

const appelsVers = (morceau, methode) => appels.filter(a => a.url.includes(morceau) && (!methode || a.methode === methode));
const tab = (x) => Array.isArray(x) ? x : [];
const lit = (r) => { let corps; try { corps = JSON.parse(r.body); } catch { corps = r.body; } return { statut: r.statusCode, corps, entetes: r.headers || {} }; };
const ORIGINE = "https://elixir-commande.expepharma.com";
const ev = (methode, { jeton, q: qs, corps, ip, entetes } = {}) => ({
  httpMethod: methode,
  headers: { origin: ORIGINE, ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(ip ? { "x-nf-client-connection-ip": ip } : {}), ...(entetes || {}) },
  queryStringParameters: qs || {},
  body: corps === undefined ? null : (typeof corps === "string" ? corps : JSON.stringify(corps)),
});
const corsEtNoStore = (r) => [r.entetes["Access-Control-Allow-Origin"], r.entetes["Cache-Control"]];

// ════════════════════════ order-save ════════════════════════
const { handler: orderSave } = await import("../netlify/functions/order-save.js");
// site à jour : en-tête X-Elixir-Session (appelAuthentifie) ; { ancienne: true } = page ouverte avant la mise en ligne
const SITE = { "x-elixir-session": "jeton" };
const sauve = async ({ ancienne, ...o }) => { appels = []; return lit(await orderSave(ev("POST", { ip: "10.2.0.1", ...(ancienne ? {} : { entetes: SITE }), ...o }))); };
const ecrite = () => JSON.parse(appelsVers("elixir_orders", "POST")[0]?.corps || "null");
// commande telle que le site l'envoie, au nom (prétendu) de la pharmacie B
const COMMANDE = { id: 1760860000000, date: "2020-01-01T00:00:00.000Z", pharmacyName: "Pharmacie B", pharmacyEmail: MAIL_B, pharmacyCip: CIP_B, isClient: true,
  items: [{ cip: "3400000000011", name: "Produit 11", qty: 2, pn: 2.5, total: 5 }], totalHt: 5, nbLignes: 1, csv: "3400000000011;2", processed: false, source: "catalogue" };

let r = await sauve({ corps: COMMANDE });
eq("order-save sans jeton → 401 reconnexion", [r.statut, r.corps.error], [401, "reconnexion"]);
eq("order-save sans jeton : ni commande, ni stock, ni notification", [appelsVers("elixir_orders").length, appelsVers("decrement_stock").length, appelsVers("ec_notifications").length], [0, 0, 0]);
eq("order-save 401 : CORS et no-store", corsEtNoStore(r), [ORIGINE, "no-store"]);
r = await sauve({ jeton: "jeton-perime", corps: COMMANDE });
eq("order-save jeton invalide ou expiré → 401, rien écrit", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
r = await sauve({ jeton: "jeton-inconnu", corps: COMMANDE });
eq("order-save jeton sans compte pharmacie → 403 fiche, rien écrit", [r.statut, r.corps.error, appelsVers("elixir_orders").length, appelsVers("decrement_stock").length], [403, "fiche", 0, 0]);
r = await sauve({ jeton: "jeton-a", corps: { ...COMMANDE, enteredByAdmin: true } });
eq("order-save enteredByAdmin avec un jeton pharmacie → 403, rien écrit", [r.statut, appelsVers("elixir_orders").length], [403, 0]);

r = await sauve({ jeton: "jeton-a", corps: { verifier: true } });
eq("order-save { verifier } pharmacie A → 200, admin:false", [r.statut, r.corps], [200, { success: true, admin: false }]);
eq("order-save { verifier } : rien écrit", [appelsVers("elixir_orders").length, appelsVers("decrement_stock").length, appelsVers("ec_notifications").length], [0, 0, 0]);
r = await sauve({ corps: { verifier: true } });
eq("order-save { verifier } sans jeton → 401 (le site demande la reconnexion avant tout envoi)", r.statut, 401);
r = await sauve({ jeton: "jeton-inconnu", corps: { verifier: true } });
eq("order-save { verifier } compte sans pharmacie → 403 fiche", [r.statut, r.corps.error], [403, "fiche"]);
r = await sauve({ jeton: "jeton-admin", corps: { verifier: true } });
eq("order-save { verifier } admin → admin:true", r.corps, { success: true, admin: true });

const debut = new Date().toISOString();
r = await sauve({ jeton: "jeton-a", corps: COMMANDE });
let ligne = ecrite();
eq("order-save pharmacie A, corps au nom de B → enregistrée au nom de A (jeton)", [r.statut, r.corps.success, ligne?.pharmacy_cip, ligne?.pharmacy_email, ligne?.pharmacy_name],
  [200, true, CIP_A, MAIL_A, "Pharmacie A"]);
eq("order-save pharmacie : date du serveur, id et lignes du site, non traitée, pas d'entered_by", [ligne?.date >= debut, ligne?.id, ligne?.items?.length, ligne?.processed, "entered_by" in (ligne || {})],
  [true, COMMANDE.id, 1, false, false]);
eq("order-save pharmacie : stock décrémenté après enregistrement", appelsVers("decrement_stock").length, 1);
eq("order-save 200 : CORS et no-store", corsEtNoStore(r), [ORIGINE, "no-store"]);
r = await sauve({ jeton: "jeton-c", corps: { ...COMMANDE, pharmacyCip: CIP_B } });
eq("order-save compte sans CIP : enregistrée sans CIP (jamais celui du corps)", [r.statut, ecrite()?.pharmacy_cip, ecrite()?.pharmacy_email], [200, null, "compte@pharmacie-c.test"]);
r = await sauve({ jeton: "jeton-a", corps: { ...COMMANDE, items: [] } });
eq("order-save sans ligne → 400, rien écrit", [r.statut, appelsVers("elixir_orders").length], [400, 0]);
r = await sauve({ jeton: "jeton-a", corps: "{pas du json" });
eq("order-save JSON invalide → 400", r.statut, 400);
r = lit(await orderSave(ev("GET", { jeton: "jeton-a", ip: "10.2.0.1" })));
eq("order-save GET → 405", r.statut, 405);

r = await sauve({ jeton: "jeton-admin", corps: { ...COMMANDE, enteredByAdmin: true } });
ligne = ecrite();
eq("order-save admin en saisie pour B : identité du corps, entered_by posé", [r.statut, ligne?.pharmacy_cip, ligne?.pharmacy_email, ligne?.pharmacy_name, ligne?.entered_by],
  [200, CIP_B, MAIL_B, "Pharmacie B", "equipe@elixir.test"]);

r = await sauve({ jeton: "jeton-admin", corps: COMMANDE });
eq("order-save jeton admin SANS enteredByAdmin (adresse admin qui commande comme pharmacie) : pas d'entered_by (synchro manuelle, comme avant)",
  [r.statut, "entered_by" in (ecrite() || {})], [200, false]);

// ── pages ouvertes avant la mise en ligne (ni jeton ni X-Elixir-Session) : quarantaine jusqu'à FIN_TRANSITION ──
r = await sauve({ ancienne: true, corps: COMMANDE });
ligne = ecrite();
eq("order-save page ancienne sans jeton → 200 aVerifier (l'ancienne page ne perd pas la commande)", [r.statut, r.corps.success, r.corps.aVerifier], [200, true, true]);
eq("order-save quarantaine : « a_verifier », sans CIP ni e-mail (ni « Mes commandes » ni contingentement de B)", [ligne?.source, ligne?.pharmacy_cip, ligne?.pharmacy_email, ligne?.processed], ["a_verifier", null, null, false]);
eq("order-save quarantaine : identité annoncée dans le nom seulement, marquée NON VÉRIFIÉE", [/^⚠ NON VÉRIFIÉE — Pharmacie B · compte@pharmacie-b\.test · CIP 2000002$/.test(ligne?.pharmacy_name || "")], [true]);
eq("order-save quarantaine : ni stock, ni notification, ni entered_by", [appelsVers("decrement_stock").length, appelsVers("ec_notifications").length, "entered_by" in (ligne || {})], [0, 0, false]);
eq("order-save quarantaine : lignes gardées (cip, nom, quantité, prix)", ligne?.items, [{ cip: "3400000000011", name: "Produit 11", qty: 2, pn: 2.5, total: 5 }]);
r = await sauve({ ancienne: true, corps: { ...COMMANDE, source: "justificatif", pharmacyName: "x".repeat(400), items: Array.from({ length: 600 }, (_, i) => ({ cip: String(i), name: "y".repeat(500), qty: 1, justif: { rx: ["z"] } })) } });
ligne = ecrite();
eq("order-save quarantaine : source d'origine dans le nom, lignes et textes bornés, justificatif nettoyé", [r.statut, /^⚠ NON VÉRIFIÉE \(justificatif\) — x+/.test(ligne?.pharmacy_name), ligne?.pharmacy_name.length <= 300, ligne?.items.length, ligne?.items[0].name.length, ligne.items[0].justif],
  [200, true, true, 500, 200, { attestation: false, renouvellement: false, rx: [] }]);
{
  const RX = ["0f8e2c1a-1111-4a2b-8c3d-000000000001", "0f8e2c1a-1111-4a2b-8c3d-000000000002"];
  r = await sauve({ ancienne: true, corps: { ...COMMANDE, source: "justificatif", items: [{ cip: "3400930177006", name: "LORVIQUA", qty: 1, pn: 100, total: 100,
    justif: { attestation: "oui", renouvellement: 0, rx: [RX[0], "../../etc", { id: "x" }, RX[1], RX[0], RX[1], RX[0], RX[1]], autre: "<script>" } }] } });
  eq("order-save quarantaine : justificatif gardé (attestation, renouvellement, 5 ordonnances au plus, identifiants seulement)", ecrite()?.items[0].justif,
    { attestation: true, renouvellement: false, rx: [RX[0], RX[1], RX[0], RX[1], RX[0]] });
}
r = await sauve({ ancienne: true, corps: { verifier: true } });
eq("order-save page ancienne { verifier } (sans ligne) → 401, rien écrit", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
r = await sauve({ ancienne: true, jeton: "jeton-perime", corps: COMMANDE });
eq("order-save jeton joint mais invalide → 401, jamais de quarantaine", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
r = await sauve({ corps: COMMANDE });
eq("order-save site à jour sans jeton → 401, jamais de quarantaine", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
{
  const vrai = Date.now;
  Date.now = () => Date.parse("2026-11-03T08:00:00+01:00");   // après FIN_TRANSITION
  r = await sauve({ ancienne: true, corps: COMMANDE });
  Date.now = vrai;
  eq("order-save page ancienne après la fin de la transition → 401, rien écrit", [r.statut, r.corps.error, appelsVers("elixir_orders").length], [401, "reconnexion", 0]);
}

// ── source et lignes « justificatif » d'une pharmacie (disponibilité affichée à toutes) ──
const LORVIQUA = "3400930177006";   // Pfizer : 1 par commande (CONFIG_DEFAUT, lj:config absente)
const justif = (items) => ({ ...COMMANDE, source: "justificatif", items });
r = await sauve({ jeton: "jeton-a", corps: { ...COMMANDE, source: "a_verifier" } });
eq("order-save pharmacie : source inventée → catalogue", [r.statut, ecrite()?.source], [200, "catalogue"]);
r = await sauve({ jeton: "jeton-a", corps: { ...COMMANDE, source: "ulabs" } });
eq("order-save pharmacie : source ulabs (commande groupée U-Labs) gardée", ecrite()?.source, "ulabs");
r = await sauve({ jeton: "jeton-a", corps: justif([{ cip: LORVIQUA, name: "Lorviqua", qty: 1, pn: 1, total: 1 }]) });
eq("order-save pharmacie : justificatif conforme → 200", [r.statut, ecrite()?.source], [200, "justificatif"]);
r = await sauve({ jeton: "jeton-a", corps: justif([{ cip: LORVIQUA, name: "Lorviqua", qty: 9999, pn: 1, total: 1 }]) });
eq("order-save pharmacie : justificatif au-delà de maxCommande → 400, rien écrit", [r.statut, /1 au plus par commande/.test(r.corps.error), appelsVers("elixir_orders", "POST").length], [400, true, 0]);
r = await sauve({ jeton: "jeton-a", corps: justif([{ cip: LORVIQUA, qty: 1 }, { cip: LORVIQUA, qty: 1 }]) });
eq("order-save pharmacie : justificatif, même produit sur deux lignes (somme) → 400", r.statut, 400);
r = await sauve({ jeton: "jeton-a", corps: justif([{ cip: "3400000000011", qty: 1 }]) });
eq("order-save pharmacie : justificatif sur un produit hors liste → 400", [r.statut, /non commandable sur justificatif/.test(r.corps.error)], [400, true]);
r = await sauve({ jeton: "jeton-a", corps: justif([{ cip: "3400930077696", qty: 1.5 }]) });
eq("order-save pharmacie : justificatif, quantité non entière → 400", r.statut, 400);
r = await sauve({ jeton: "jeton-a", corps: justif([{ cip: "3400930077696", qty: 1000 }]) });
eq("order-save pharmacie : justificatif sans maxCommande, au-delà de 999 → 400", r.statut, 400);
r = await sauve({ jeton: "jeton-admin", corps: { ...justif([{ cip: LORVIQUA, qty: 5 }]), enteredByAdmin: true } });
eq("order-save admin en saisie : justificatif non bridé (chemin admin inchangé)", [r.statut, ecrite()?.source, ecrite()?.entered_by], [200, "justificatif", "equipe@elixir.test"]);

// ════════════════════════ send-email ════════════════════════
{
  const { handler: mail } = await import("../netlify/functions/send-email.js");
  const PARAMS = { to_email: "victime@ailleurs.test", pharmacy_name: "Pharmacie B", pharmacy_email: MAIL_B, order_lines: "• Produit 11", total_ht: "5,00 €" };
  const envoie = async (o) => { appels = []; return lit(await mail(ev("POST", { ip: "10.9.0.1", corps: { template_params: PARAMS }, ...o }))); };
  const envoye = () => JSON.parse(appelsVers("api.emailjs.com")[0]?.corps || "null")?.template_params || null;
  r = await envoie({});
  eq("send-email sans jeton : envoyé, destinataire FIXÉ (to_email ignoré), nom marqué « identité non vérifiée »", [r.statut, envoye()?.to_email, envoye()?.pharmacy_name, envoye()?.order_lines],
    [200, "pharmacien@elixirpharma.fr", "⚠ IDENTITÉ NON VÉRIFIÉE — Pharmacie B", "• Produit 11"]);
  r = await envoie({ jeton: "jeton-perime" });
  eq("send-email jeton invalide → 401 reconnexion, rien envoyé", [r.statut, r.corps.error, appelsVers("api.emailjs.com").length], [401, "reconnexion", 0]);
  eq("send-email 401 : CORS et no-store", corsEtNoStore(r), [ORIGINE, "no-store"]);
  r = await envoie({ jeton: "jeton-a" });
  eq("send-email jeton pharmacie A, paramètres au nom de B → adresse et nom de A", [r.statut, envoye()?.pharmacy_email, envoye()?.pharmacy_name, envoye()?.to_email],
    [200, MAIL_A, "Pharmacie A", "pharmacien@elixirpharma.fr"]);
  r = await envoie({ jeton: "jeton-admin", corps: { template_params: { ...PARAMS, pharmacy_name: "Pharmacie B — saisie par Elixir" } } });
  eq("send-email admin en saisie : paramètres inchangés (sauf destinataire)", [r.statut, envoye()?.pharmacy_name, envoye()?.pharmacy_email, envoye()?.to_email],
    [200, "Pharmacie B — saisie par Elixir", MAIL_B, "pharmacien@elixirpharma.fr"]);
  appels = [];
  r = lit(await mail({ ...ev("POST", { ip: "10.9.0.2", corps: { template_params: PARAMS } }), headers: { origin: "https://tiers.test" } }));
  eq("send-email origine étrangère → 403, rien envoyé, CORS", [r.statut, appelsVers("api.emailjs.com").length, r.entetes["Access-Control-Allow-Origin"]], [403, 0, "https://elixir-commande.expepharma.com"]);
  r = await envoie({ corps: { template_params: ["x"] } });
  eq("send-email template_params invalide → 400", r.statut, 400);
  for (let i = 0; i < 60; i++) await mail(ev("POST", { ip: "10.9.9.9", corps: { template_params: PARAMS } }));
  r = lit(await mail(ev("POST", { ip: "10.9.9.9", corps: { template_params: PARAMS } })));
  eq("send-email 429 : CORS présent", [r.statut, r.entetes["Access-Control-Allow-Origin"]], [429, ORIGINE]);
}

// limite par IP (60 par minute) : la réponse 429 garde le CORS
let dernier = null;
for (let i = 0; i < 61; i++) dernier = lit(await orderSave(ev("POST", { jeton: "jeton-a", corps: { verifier: true }, ip: "10.2.9.9" })));
eq("order-save 429 : CORS présent", [dernier.statut, dernier.entetes["Access-Control-Allow-Origin"]], [429, ORIGINE]);

// ════════════════════════ quota-status ════════════════════════
const { handler: quota } = await import("../netlify/functions/quota-status.js");
let ipQ = 1;
const qs = async (o) => { appels = []; return lit(await quota(ev("POST", { ip: `10.3.0.${ipQ++}`, ...o }))); };
const filtreCommandes = () => q(appelsVers("elixir_orders", "GET")[0]?.url || "https://x.test/").or || "";

r = await qs({ corps: { cip: CIP_B, email: "*@*" } });
eq("quota-status sans jeton → 401, avant toute lecture (ni Odoo, ni commandes)", [r.statut, r.corps.error, appelsVers("odoo.test").length, appelsVers("elixir_orders").length], [401, "reconnexion", 0, 0]);
eq("quota-status 401 : CORS et no-store", corsEtNoStore(r), [ORIGINE, "no-store"]);
r = await qs({ jeton: "jeton-inconnu", corps: { email: MAIL_B } });
eq("quota-status jeton sans compte pharmacie → 403 fiche, rien lu", [r.statut, r.corps.error, appelsVers("elixir_orders").length], [403, "fiche", 0]);
r = await qs({ jeton: "jeton-a", corps: { cip: CIP_B, email: "*@*" } });
eq("quota-status pharmacie A + corps « *@* » → 200, identifiée", [r.statut, r.corps.identified], [200, true]);
eq("quota-status : commandes du site comptées en eq sur les adresses de A (plus d'ilike, rien de B ni « *@* »)", filtreCommandes(),
  `(pharmacy_email.eq."${MAIL_A}",pharmacy_email.eq."Second@Pharmacie-A.test",pharmacy_email.eq."second@pharmacie-a.test",pharmacy_cip.eq.${CIP_A})`);
r = await qs({ jeton: "jeton-a", corps: { odoo_id: 12, email: MAIL_B, cip: CIP_B } });
eq("quota-status odoo_id (saisie admin) avec un jeton pharmacie → 403", r.statut, 403);
r = await qs({ jeton: "jeton-admin", corps: { odoo_id: 12, email: MAIL_B, cip: CIP_B } });
eq("quota-status admin en saisie pour B (odoo_id) → 200, adresses et CIP de B", [r.statut, filtreCommandes()], [200, `(pharmacy_email.eq."${MAIL_B}",pharmacy_cip.eq.${CIP_B})`]);
r = await qs({ jeton: "jeton-admin", corps: { email: MAIL_B, cip: CIP_B } });
eq("quota-status admin sans odoo_id : compte de l'adresse donnée (B), en eq", [r.statut, r.corps.identified, filtreCommandes()], [200, true, `(pharmacy_email.eq."${MAIL_B}",pharmacy_cip.eq.${CIP_B})`]);
r = await qs({ jeton: "jeton-c" });
eq("quota-status compte sans fiche Odoo : commandes du site de SON adresse seulement", [r.statut, r.corps.identified, filtreCommandes()], [200, false, `(pharmacy_email.eq."compte@pharmacie-c.test")`]);

// ════════════════════════ gp-pharmacy ════════════════════════
const { handler: gpPharmacie } = await import("../netlify/functions/gp-pharmacy.js");
const gp = async (o) => { appels = []; return lit(await gpPharmacie(ev("POST", o))); };
const accesLu = () => appelsVers("gp_access").map(a => q(a.url).pharmacy_id);

r = await gp({ corps: { action: "access", email: MAIL_B } });
eq("gp-pharmacy sans jeton, e-mail de B → 401, rien lu", [r.statut, r.corps.error, accesLu()], [401, "reconnexion", []]);
r = await gp({ corps: { action: "list", email: MAIL_B } });
eq("gp-pharmacy list sans jeton → 401", r.statut, 401);
r = await gp({ jeton: "jeton-a", corps: { action: "access", email: MAIL_B, cip: CIP_B } });
eq("gp-pharmacy pharmacie A + e-mail et CIP de B → identité de A", [r.statut, r.corps.allowed, accesLu()], [200, true, ["eq.11"]]);
r = await gp({ jeton: "jeton-c", corps: { action: "access" } });
eq("gp-pharmacy compte sans fiche → pas d'accès (menu masqué)", [r.statut, r.corps.allowed], [200, false]);
r = await gp({ jeton: "jeton-c", corps: { action: "list" } });
eq("gp-pharmacy compte sans fiche, list → 403", r.statut, 403);
r = await gp({ jeton: "jeton-admin", corps: { action: "access", email: MAIL_B } });
eq("gp-pharmacy admin en saisie pour B → adresse du corps", [r.statut, accesLu()], [200, ["eq.12"]]);

// ════════════════════════ gp-upload ════════════════════════
const { handler: gpDepot } = await import("../netlify/functions/gp-upload.js");
const up = async (o) => { appels = []; return lit(await gpDepot(ev("POST", o))); };
r = await up({ corps: { action: "upload", kind: "lgo", email: MAIL_B, text: "a;b" } });
eq("gp-upload sans jeton, e-mail de B → 401, ni lecture ni écriture", [r.statut, r.corps.error, appelsVers("kv_store").length, appelsVers("gp_").length], [401, "reconnexion", 0, 0]);
r = await up({ jeton: "jeton-c", corps: { action: "status", job: "x", email: MAIL_B } });
eq("gp-upload compte sans fiche → 403 fiche", [r.statut, r.corps.error], [403, "fiche"]);
r = await up({ jeton: "jeton-a", corps: { action: "status", job: "pas-un-uuid", email: MAIL_B } });
eq("gp-upload pharmacie A : identifiée par le jeton (analyse inconnue → 404)", r.statut, 404);

// ════════════════════════ ml-recommend ════════════════════════
const { handler: ml } = await import("../netlify/functions/ml-recommend.js");
const mlr = async (o) => { appels = []; return lit(await ml(ev("GET", o))); };
const motifLu = () => appelsVers("pharmacy_patterns").map(a => q(a.url).pharmacy_cip);

r = await mlr({ q: { mode: "reorder", pharmacy_cip: CIP_B } });
eq("ml-recommend reorder sans jeton → 401, habitudes non lues", [r.statut, r.corps.error, motifLu()], [401, "reconnexion", []]);
r = await mlr({ jeton: "jeton-a", q: { mode: "reorder", pharmacy_cip: CIP_B } });
eq("ml-recommend reorder pharmacie A + ?pharmacy_cip=B → habitudes de A", [r.statut, motifLu(), r.corps.suggestions?.[0]?.cip], [200, [`eq.${CIP_A}`], "3400000000011"]);
r = await mlr({ jeton: "jeton-c", q: { mode: "reorder" } });
eq("ml-recommend reorder compte sans CIP → 403 fiche", [r.statut, r.corps.error, motifLu()], [403, "fiche", []]);
r = await mlr({ jeton: "jeton-admin", q: { mode: "reorder", pharmacy_cip: CIP_B } });
eq("ml-recommend reorder admin en saisie pour B", [r.statut, motifLu()], [200, [`eq.${CIP_B}`]]);
for (const mode of ["segments", "ruptures"]) {
  r = await mlr({ q: { mode } });
  eq(`ml-recommend ${mode} sans jeton → 403, rien lu`, [r.statut, appelsVers(mode === "segments" ? "ec_pharmacy_segments" : "ec_rupture_predictions").length], [403, 0]);
  r = await mlr({ jeton: "jeton-a", q: { mode } });
  eq(`ml-recommend ${mode} par une pharmacie → 403`, r.statut, 403);
  r = await mlr({ jeton: "jeton-admin", q: { mode } });
  eq(`ml-recommend ${mode} par l'admin → 200`, [r.statut, (r.corps.segments || r.corps.predictions || []).length], [200, 1]);
}
r = await mlr({ q: { cip: "3400000000011", limit: "3" } });
eq("ml-recommend « commandent aussi » (?cip=) : public", [r.statut, Array.isArray(r.corps.recommendations)], [200, true]);
r = await mlr({ q: { cip: "x),pharmacy_cip.not.is.null,(" } });
eq("ml-recommend ?cip= invalide → 400", r.statut, 400);

// ════════════════════════ group-order ════════════════════════
const { handler: groupe } = await import("../netlify/functions/group-order.js");
const go = async (methode, o) => { appels = []; return lit(await groupe(ev(methode, o))); };
const ecritureGroupe = () => JSON.parse(appelsVers("elixir_group_orders", "POST")[0]?.corps || "null");
const suppressionsGroupe = () => appelsVers("elixir_group_orders", "DELETE").map(a => q(a.url).pharmacy_cip);

r = await go("GET", { q: { fournisseur: "ulabs" } });
eq("group-order GET sans jeton → 401, rien lu", [r.statut, r.corps.error, appelsVers("elixir_group_orders").length], [401, "reconnexion", 0]);
r = await go("GET", { jeton: "jeton-a", q: { fournisseur: "ulabs" } });
const brut = JSON.stringify(r.corps);
eq("group-order GET pharmacie A : 3 lignes, aucune trace de B (CIP, nom)", [r.statut, tab(r.corps).length, brut.includes(CIP_B), brut.includes("Pharmacie B")], [200, 3, false, false]);
eq("group-order GET pharmacie A : ses lignes intactes", tab(r.corps).filter(x => x.pharmacy_cip === CIP_A).map(x => [x.cip, x.qty, x.pharmacy_name]), [["3400000000011", 6, "Pharmacie A"]]);
eq("group-order GET pharmacie A : autres pharmacies = un même repère anonyme (nombre de participantes juste)", new Set(tab(r.corps).map(x => x.pharmacy_cip)).size, 2);
eq("group-order GET pharmacie A : totaux par produit inchangés", tab(r.corps).filter(x => x.cip === "3400000000011").reduce((s, x) => s + x.qty, 0), 18);
r = await go("GET", { jeton: "jeton-admin", q: { fournisseur: "ulabs" } });
eq("group-order GET admin : toutes les lignes, identité comprise", [tab(r.corps).length, tab(r.corps).filter(x => x.pharmacy_cip === CIP_B).length], [3, 2]);
r = await go("GET", { jeton: "jeton-c" });
eq("group-order GET compte sans CIP → 403 fiche", [r.statut, r.corps.error], [403, "fiche"]);

r = await go("POST", { corps: { fournisseur: "ulabs", cip: "3400000000011", pharmacy_cip: CIP_B, pharmacy_name: "Pharmacie B", qty: 0 } });
eq("group-order POST sans jeton → 401, rien écrit ni supprimé", [r.statut, appelsVers("elixir_group_orders").length], [401, 0]);
r = await go("POST", { jeton: "jeton-a", corps: { fournisseur: "ulabs", cip: "3400000000011", pharmacy_cip: CIP_B, pharmacy_name: "Usurpée", qty: 12 } });
eq("group-order POST pharmacie A + pharmacy_cip=B → ligne de A, nom de sa fiche", [r.statut, ecritureGroupe()?.pharmacy_cip, ecritureGroupe()?.pharmacy_name, ecritureGroupe()?.qty, ecritureGroupe()?.fournisseur],
  [200, CIP_A, "Pharmacie A", 12, "ulabs"]);
r = await go("POST", { jeton: "jeton-a", corps: { cip: "3400000000011", pharmacy_cip: CIP_B, qty: 0 } });
eq("group-order POST qty 0 pharmacie A → supprime chez A seulement", [r.statut, suppressionsGroupe()], [200, [`eq.${CIP_A}`]]);
r = await go("POST", { jeton: "jeton-a", corps: { cip: "3400000000011", qty: -3 } });
eq("group-order POST quantité invalide → 400, rien écrit", [r.statut, appelsVers("elixir_group_orders").length], [400, 0]);
r = await go("POST", { jeton: "jeton-admin", corps: { cip: "3400000000011", pharmacy_cip: CIP_B, pharmacy_name: "Pharmacie B", qty: 6 } });
eq("group-order POST admin en saisie pour B", [r.statut, ecritureGroupe()?.pharmacy_cip, ecritureGroupe()?.pharmacy_name], [200, CIP_B, "Pharmacie B"]);
r = await go("DELETE", { q: { fournisseur: "ulabs", pharmacy_cip: CIP_B } });
eq("group-order DELETE sans jeton → 401, rien vidé", [r.statut, suppressionsGroupe()], [401, []]);
r = await go("DELETE", { jeton: "jeton-a", q: { fournisseur: "ulabs", pharmacy_cip: CIP_B } });
eq("group-order DELETE pharmacie A + ?pharmacy_cip=B → vide le panier de A seulement", [r.statut, suppressionsGroupe()], [200, [`eq.${CIP_A}`]]);
r = await go("DELETE", { jeton: "jeton-admin", q: { fournisseur: "ulabs", pharmacy_cip: CIP_B } });
eq("group-order DELETE admin pour B", suppressionsGroupe(), [`eq.${CIP_B}`]);
r = await go("DELETE", { jeton: "jeton-admin", q: { fournisseur: "ulabs" } });
eq("group-order DELETE admin sans pharmacy_cip → 400", [r.statut, suppressionsGroupe()], [400, []]);
r = await go("GET", { jeton: "jeton-a", q: { fournisseur: "ulabs*" } });
eq("group-order fournisseur invalide → 400", r.statut, 400);

// ════════════════════════ pharmacy-otp-send ════════════════════════
const { handler: otp } = await import("../netlify/functions/pharmacy-otp-send.js");
// horloge simulée : la limite par instance (5/min) se libère entre deux demandes, la limite durable (1 h) non
let horloge = Date.parse("2026-10-19T08:00:00Z");
const dateReelle = Date.now;
Date.now = () => horloge;
const avance = (s) => { horloge += s * 1000; };
const envoi = async (email, ip) => { appels = []; avance(61); return lit(await otp(ev("POST", { corps: { email }, ip }))); };
const codesEnvoyes = () => appelsVers("auth/v1/otp").length;
const recherches = () => appelsVers("elixir_pharmacies").length + appelsVers("odoo.test").length;

r = await envoi(MAIL_A, "10.4.0.1");
eq("otp-send adresse connue → 200 success, un code envoyé", [r.statut, r.corps.success, codesEnvoyes()], [200, true, 1]);
eq("otp-send : no-store", r.entetes["Cache-Control"], "no-store");
r = await envoi("inconnue@nulle-part.test", "10.4.0.1");
eq("otp-send adresse inconnue → parcours « nouveau client » inchangé (404 unknown), aucun code", [r.statut, r.corps.unknown, codesEnvoyes()], [404, true, 0]);
eq("otp-send : ni adresse ni IP en clair dans kv_store", [...kv.keys()].some(k => k.includes("pharmacie-a") || k.includes("nulle-part") || k.includes("10.4.0.1")), false);
eq("otp-send : clés de la limite rl:otp-… et de la connexion demandeuse (empreintes seulement)", [...kv.keys()].every(k => /^rl:otp-(ip|adresse-ip):[0-9a-f]{24}:\d{4}-\d\d-\d\dT[\d:.]+Z:[0-9a-f]{8}$/.test(k)
  || /^rl:otp-demandeur:[0-9a-f]{24}:[0-9a-f]{24}$/.test(k)), true);
eq("otp-send : connexion demandeuse enregistrée pour le code envoyé (une seule clé)", [...kv.keys()].filter(k => k.startsWith("rl:otp-demandeur:")).length, 1);

// par adresse ET connexion : 5 par heure ; un tiers ne bloque pas la pharmacie (aucun plafond par adresse seule)
kv.clear();
const statutsAdresse = [];
for (let i = 0; i < 6; i++) statutsAdresse.push((await envoi(MAIL_B, "203.0.113.9")).statut);
eq("otp-send : 5 demandes par heure pour une adresse depuis une connexion, la 6e refusée", statutsAdresse, [200, 200, 200, 200, 200, 429]);
eq("otp-send 429 : ni recherche ni code envoyé", [recherches(), codesEnvoyes()], [0, 0]);
r = await envoi(MAIL_B, "203.0.113.9");
eq("otp-send 429 : message lisible, CORS, Retry-After", [r.statut, /Trop de demandes de code pour cette adresse/.test(r.corps.error), r.corps.success, r.entetes["Access-Control-Allow-Origin"], Number(r.entetes["Retry-After"]) > 0],
  [429, true, false, ORIGINE, true]);
eq("otp-send : un refus n'est pas compté (5 passages enregistrés pour l'adresse et la connexion)", [...kv.keys()].filter(k => k.startsWith("rl:otp-adresse-ip:")).length, 5);
r = await envoi(MAIL_B, "198.51.100.77");
eq("otp-send : la pharmacie, depuis SA connexion, n'est pas bloquée par les demandes d'un tiers", [r.statut, r.corps.success, codesEnvoyes()], [200, true, 1]);
avance(3600);
r = await envoi(MAIL_B, "203.0.113.9");
eq("otp-send : une heure plus tard, l'adresse est de nouveau servie depuis cette connexion", [r.statut, codesEnvoyes()], [200, 1]);
eq("otp-send : passages sortis de la fenêtre effacés", [...kv.keys()].filter(k => k.startsWith("rl:otp-adresse-ip:")).length, 2);

// par connexion : 10 par heure, adresses connues ou non (énumération)
kv.clear();
const statutsIp = [];
for (let i = 0; i < 11; i++) statutsIp.push((await envoi(`essai${i}@nulle-part.test`, "10.6.0.1")).statut);
eq("otp-send : 10 demandes par heure et par IP, la 11e refusée avant toute recherche", [statutsIp.slice(0, 10).every(s => s === 404), statutsIp[10], recherches()], [true, 429, 0]);
r = await envoi(MAIL_A, "10.6.0.2");
eq("otp-send : une autre IP n'est pas bloquée", r.statut, 200);

// IPv6 : une connexion = un préfixe /64 (un serveur en a des milliards d'adresses)
kv.clear();
const statutsV6 = [];
for (let i = 1; i <= 40; i++) statutsV6.push((await envoi(`v6-${i}@nulle-part.test`, `2001:db8:1:2::${i.toString(16)}`)).statut);
eq("otp-send IPv6 : 40 adresses d'un même /64 → 10 essais servis, 30 refusés", [statutsV6.filter(x => x === 404).length, statutsV6.filter(x => x === 429).length], [10, 30]);
r = await envoi("v6-autre@nulle-part.test", "2001:db8:1:3::1");
eq("otp-send IPv6 : un autre /64 n'est pas bloqué", r.statut, 404);
r = await envoi("v6-mappee@nulle-part.test", "::ffff:10.6.0.9");
eq("otp-send : IPv4 notée en IPv6 comptée comme l'IPv4", [r.statut, [...kv.keys()].filter(k => k.startsWith("rl:otp-ip:")).length], [404, 12]);

// Supabase refuse un code moins d'une minute après le précédent : ce code non envoyé ne compte pas
kv.clear(); dernierCode.clear();
const parcours = [];
for (const s of [0, 30, 45, 15, 60, 30, 30, 30, 60]) { avance(s - 61); parcours.push(await envoi(MAIL_A, "10.10.0.1")); }   // envoi avance déjà de 61 s
eq("otp-send : allers-retours « Changer d'e-mail » → jamais de blocage", parcours.map(x => x.statut).every(x => x === 200), true);
eq("otp-send : seuls les codes réellement envoyés sont comptés", [...kv.keys()].filter(k => k.startsWith("rl:otp-adresse-ip:")).length, parcours.filter(x => x.corps.success).length);
eq("otp-send : refus de Supabase rendu tel quel (message affiché)", parcours.some(x => x.corps.success === false && /60 seconds/.test(x.corps.error)), true);

// demandes simultanées (instances différentes) : le passage est écrit puis compté
const { limiteDurable } = await import("../netlify/functions/rate-limit.js");
kv.clear();
const simultanees = await Promise.all([1, 2, 3, 4, 5, 6].map(() => limiteDurable([{ nom: "essai", valeur: "x", max: 3 }], 3600)));
eq("limiteDurable : 6 passages simultanés pour un plafond de 3 → 3 acceptés, 3 refusés", [simultanees.filter(x => !x.refus).length, simultanees.filter(x => x.refus).length], [3, 3]);
eq("limiteDurable : passages refusés effacés (3 restent)", [...kv.keys()].filter(k => k.startsWith("rl:essai:")).length, 3);
await simultanees.find(x => !x.refus).liberer();
eq("limiteDurable : liberer() efface le passage accepté", [...kv.keys()].filter(k => k.startsWith("rl:essai:")).length, 2);
eq("limiteDurable : place libérée → nouveau passage accepté", (await limiteDurable([{ nom: "essai", valeur: "x", max: 3 }], 3600)).refus, null);

// ════════════════════════ pharmacy-otp-verify ════════════════════════
{
  const { handler: verif } = await import("../netlify/functions/pharmacy-otp-verify.js");
  const essai = async (email, code, ip) => { appels = []; avance(7); return lit(await verif(ev("POST", { corps: { email, token: code }, ip }))); };
  const verifications = () => appelsVers("auth/v1/verify").length;
  kv.clear(); dernierCode.clear();
  const faux = [];
  for (let i = 0; i < 5; i++) faux.push(await essai(MAIL_A, `00000${i}`, `10.11.0.${i + 1}`));
  eq("otp-verify : 5 codes faux (connexions différentes) → refusés par Supabase", faux.map(x => [x.statut, x.corps.success]), Array(5).fill([200, false]));
  r = await essai(MAIL_A, "123456", "10.11.0.9");
  eq("otp-verify : 6e essai, même le bon code → 429 sans interroger Supabase", [r.statut, r.corps.success, /Trop de codes erronés pour cette adresse/.test(r.corps.error), verifications(), Number(r.entetes["Retry-After"]) > 0],
    [429, false, true, 0, true]);
  eq("otp-verify 429 : CORS et no-store", corsEtNoStore(r), [ORIGINE, "no-store"]);
  r = await essai(MAIL_B, "123456", "10.11.0.9");
  eq("otp-verify : une autre adresse n'est pas bloquée", [r.statut, r.corps.success], [200, true]);
  avance(61);
  r = lit(await otp(ev("POST", { corps: { email: MAIL_A }, ip: "10.11.0.20" })));
  eq("otp-verify : nouveau code envoyé → essais erronés de l'adresse effacés", [r.corps.success, [...kv.keys()].filter(k => k.startsWith("rl:otp-essai:")).length], [true, 0]);
  r = await essai(MAIL_A, "123456", "10.11.0.20");
  eq("otp-verify : avec le nouveau code, connexion réussie (jeton rendu)", [r.statut, r.corps.success, r.corps.token], [200, true, "jeton-a"]);
  eq("otp-verify : un code juste ne compte pas", [...kv.keys()].filter(k => k.startsWith("rl:otp-essai:")).length, 0);
  // par connexion : 20 codes faux en 15 min, adresses différentes
  kv.clear();
  const parIp = [];
  for (let i = 0; i < 21; i++) parIp.push((await essai(`p${i}@pharmacie.test`, "999999", `2001:db8:9:9::${i + 1}`)).statut);
  eq("otp-verify : 20 codes faux par connexion (/64) en 15 min, le 21e refusé", [parIp.slice(0, 20).every(x => x === 200), parIp[20]], [true, 429]);
  avance(900);
  r = await essai("p0@pharmacie.test", "123456", "2001:db8:9:9::1");
  eq("otp-verify : 15 min plus tard, la connexion est de nouveau servie", [r.statut, r.corps.success], [200, true]);
  // Supabase en panne : l'essai ne compte pas ; kv_store en panne : la vérification passe
  kv.clear(); verifyEnPanne = true;
  r = await essai(MAIL_A, "123456", "10.12.0.1");
  verifyEnPanne = false;
  eq("otp-verify : Supabase indisponible → essai non compté", [r.corps.success, [...kv.keys()].filter(k => k.startsWith("rl:otp-essai:")).length], [false, 0]);
  kvEnPanne = true;
  r = await essai(MAIL_A, "123456", "10.12.0.2");
  kvEnPanne = false;
  eq("otp-verify : kv_store en panne → la connexion passe", [r.statut, r.corps.success], [200, true]);

  // Relecture finale : un tiers qui connaît l'adresse ne bloque plus la connexion qui a demandé le code en cours
  const PHARMA = "86.1.2.3", TIERS = "203.0.113.50";
  kv.clear(); dernierCode.clear(); avance(61);
  r = lit(await otp(ev("POST", { corps: { email: MAIL_A }, ip: PHARMA })));
  eq("otp-send : la pharmacie demande un code depuis sa connexion", r.corps.success, true);
  const tiers = [];
  for (let i = 0; i < 6; i++) tiers.push((await essai(MAIL_A, `11111${i}`, TIERS)).statut);
  eq("otp-verify : un tiers (autre connexion) → 5 codes faux comptés, le 6e refusé (devinette toujours bridée)", tiers, [200, 200, 200, 200, 200, 429]);
  r = await essai(MAIL_A, "123456", PHARMA);
  eq("otp-verify : la pharmacie, depuis la connexion qui a demandé le code, saisit le bon code → 200 avec un jeton", [r.statut, r.corps.success, r.corps.token], [200, true, "jeton-a"]);
  r = await essai(MAIL_A, "123456", "203.0.113.51");
  eq("otp-verify : une autre connexion reste soumise au plafond de l'adresse (même avec le bon code)", r.statut, 429);
  avance(61);
  await otp(ev("POST", { corps: { email: MAIL_A }, ip: PHARMA }));
  const dem = [];
  for (let i = 0; i < 5; i++) dem.push((await essai(MAIL_A, `22222${i}`, PHARMA)).statut);
  r = await essai(MAIL_A, "123456", PHARMA);
  eq("otp-verify : la connexion demandeuse a ses 5 essais à elle, puis 429 (même le bon code)", [dem, r.statut, /pour cette adresse/.test(r.corps.error)],
    [[200, 200, 200, 200, 200], 429, true]);
  avance(61);
  await otp(ev("POST", { corps: { email: MAIL_A }, ip: PHARMA }));
  r = await essai(MAIL_A, "123456", PHARMA);
  eq("otp-verify : nouveau code demandé → essais de la demandeuse remis à zéro, connexion réussie", [r.statut, r.corps.success], [200, true]);
  avance(61);
  await otp(ev("POST", { corps: { email: MAIL_A }, ip: TIERS }));
  eq("otp-send : une seule connexion demandeuse par adresse (la dernière à avoir demandé un code)", [...kv.keys()].filter(k => k.startsWith("rl:otp-demandeur:")).length, 1);
  const parTiers = [];
  for (let i = 0; i < 6; i++) parTiers.push((await essai(MAIL_A, `33333${i}`, TIERS)).statut);
  eq("otp-verify : un tiers devenu demandeur (en faisant envoyer un code à la pharmacie) n'a que 5 essais lui aussi", parTiers, [200, 200, 200, 200, 200, 429]);
}

// kv_store injoignable : la connexion n'est pas bloquée (limite par instance seulement)
kvEnPanne = true;
r = await envoi(MAIL_A, "10.7.0.1");
eq("otp-send kv_store en panne → la demande passe", [r.statut, codesEnvoyes()], [200, 1]);
kvEnPanne = false;
const passagesAvant = kv.size;
r = lit(await otp(ev("POST", { corps: { email: "pas-une-adresse" }, ip: "10.7.0.2" })));
eq("otp-send adresse invalide → 400, rien compté", [r.statut, kv.size], [400, passagesAvant]);
Date.now = dateReelle;

// ════════════════════════ Supabase Auth en panne : 503, jamais 401, aucun accès ════════════════════════
{
  const { handler: mail } = await import("../netlify/functions/send-email.js");
  const { handler: liste } = await import("../netlify/functions/order-list.js");
  const { handler: majCommande } = await import("../netlify/functions/order-update.js");
  const { handler: alertes } = await import("../netlify/functions/restock-alert.js");
  let n = 0;
  const appel = async (h, methode, o) => { appels = []; return lit(await h(ev(methode, { ip: `10.30.0.${++n}`, entetes: SITE, ...o }))); };
  for (const panne of [503, 504, 429, "reseau"]) {
    authEnPanne = panne;
    r = await appel(orderSave, "POST", { jeton: "jeton-a", corps: COMMANDE });
    eq(`Auth en panne (${panne}) : order-save → 503 indisponible, rien écrit`, [r.statut, r.corps.error, appelsVers("elixir_orders").length, appelsVers("decrement_stock").length], [503, "indisponible", 0, 0]);
  }
  authEnPanne = 503;
  r = await appel(orderSave, "POST", { jeton: "jeton-a", corps: { verifier: true } });
  eq("Auth en panne : order-save { verifier } → 503 (le site dit « réessayez », pas « reconnectez-vous »), Retry-After, CORS, no-store",
    [r.statut, r.corps.error, Number(r.entetes["Retry-After"]) > 0, ...corsEtNoStore(r)], [503, "indisponible", true, ORIGINE, "no-store"]);
  r = await appel(orderSave, "POST", { ancienne: true, jeton: "jeton-a", corps: COMMANDE });
  eq("Auth en panne : jeton joint → jamais de quarantaine", [r.statut, appelsVers("elixir_orders").length], [503, 0]);
  r = await appel(mail, "POST", { jeton: "jeton-a", corps: { template_params: { pharmacy_name: "Pharmacie A" } } });
  eq("Auth en panne : send-email → 503, rien envoyé", [r.statut, r.corps.error, appelsVers("api.emailjs.com").length], [503, "indisponible", 0]);
  r = await appel(groupe, "GET", { jeton: "jeton-a", q: { fournisseur: "ulabs" } });
  eq("Auth en panne : group-order GET → 503, rien lu", [r.statut, appelsVers("elixir_group_orders").length], [503, 0]);
  r = await appel(groupe, "POST", { jeton: "jeton-a", corps: { cip: "3400000000011", qty: 6 } });
  eq("Auth en panne : group-order POST → 503, rien écrit", [r.statut, appelsVers("elixir_group_orders").length], [503, 0]);
  r = await appel(liste, "GET", { jeton: "jeton-a" });
  eq("Auth en panne : order-list → 503, rien lu", [r.statut, appelsVers("elixir_orders").length], [503, 0]);
  r = await appel(gpPharmacie, "POST", { jeton: "jeton-a", corps: { action: "access" } });
  eq("Auth en panne : gp-pharmacy → 503 (le menu n'invite pas à se reconnecter), accès non lu", [r.statut, appelsVers("gp_access").length], [503, 0]);
  r = await appel(quota, "POST", { jeton: "jeton-a", corps: {} });
  eq("Auth en panne : quota-status → refus (5xx, pas 401), ni Odoo ni commandes lus", [r.statut >= 500, appelsVers("odoo.test").length, appelsVers("elixir_orders").length], [true, 0, 0]);
  r = await appel(gpDepot, "POST", { jeton: "jeton-a", corps: { action: "status", job: "x" } });
  eq("Auth en panne : gp-upload → refus (5xx, pas 401), kv_store non lu", [r.statut >= 500, appelsVers("kv_store").length], [true, 0]);
  r = await appel(majCommande, "POST", { jeton: "jeton-admin", corps: { id: 1, action: "delete" } });
  eq("Auth en panne : fonction admin (verifyAdmin) → 503 (l'admin n'est plus déconnecté par le renouvellement), rien modifié",
    [r.statut, appelsVers("elixir_orders").length], [503, 0]);
  r = await appel(ml, "GET", { jeton: "jeton-a", q: { mode: "reorder" } });
  eq("Auth en panne : appelants de verifyTokenAsync (ml-recommend) → refus, aucune donnée lue", [r.statut, motifLu()], [401, []]);
  r = await appel(alertes, "GET", { jeton: "jeton-a" });
  eq("Auth en panne : restock-alert → refus, rien lu", [r.statut, appelsVers("restock").length], [401, 0]);
  authEnPanne = null;
  r = await appel(orderSave, "POST", { jeton: "jeton-perime", corps: { verifier: true } });
  eq("Auth disponible : jeton invalide → toujours 401 reconnexion", [r.statut, r.corps.error], [401, "reconnexion"]);
}

// ════════════════════════ order-save : même numéro (nouvel essai du site) ════════════════════════
{
  baseCommandes = new Map();
  const C = { ...COMMANDE, id: 1792000000001 };
  r = await sauve({ jeton: "jeton-a", corps: C });
  eq("order-save : première fois → 200, enregistrée, stock décrémenté", [r.statut, r.corps.success, r.corps.deja, baseCommandes.size, appelsVers("decrement_stock").length], [200, true, undefined, 1, 1]);
  r = await sauve({ jeton: "jeton-a", corps: C });
  eq("order-save : même commande renvoyée (réponse perdue) → 200 { deja }, aucun doublon, ni stock ni notification en double",
    [r.statut, r.corps.success, r.corps.deja, r.corps.id, baseCommandes.size, appelsVers("decrement_stock").length, appelsVers("ec_notifications").length], [200, true, true, C.id, 1, 0, 0]);
  baseCommandes.get(C.id).items = baseCommandes.get(C.id).items.map(i => ({ ...i, synced_at: "2026-10-19T10:00:00Z", synced_ref: "R1" }));
  r = await sauve({ jeton: "jeton-a", corps: C });
  eq("order-save : même commande déjà marquée par le relais → toujours reconnue", [r.statut, r.corps.deja], [200, true]);
  r = await sauve({ jeton: "jeton-a", corps: { ...C, items: [{ ...C.items[0], qty: 3 }] } });
  eq("order-save : même numéro, autres lignes → 409 numero, rien réécrit", [r.statut, r.corps.error, baseCommandes.get(C.id).items[0].qty], [409, "numero", 2]);
  r = await sauve({ jeton: "jeton-b", corps: C });
  eq("order-save : même numéro, autre pharmacie → 409 numero (jamais « déjà enregistrée » pour une autre)", [r.statut, r.corps.error], [409, "numero"]);
  r = await sauve({ jeton: "jeton-a", corps: { ...C, source: "ulabs" } });
  eq("order-save : même numéro, autre source → 409", r.statut, 409);
  // numéro pris par une commande en quarantaine (sans jeton) : jamais confondue avec celle de la pharmacie
  r = await sauve({ ancienne: true, corps: { ...C, id: 1792000000002 } });
  r = await sauve({ jeton: "jeton-a", corps: { ...C, id: 1792000000002 } });
  eq("order-save : numéro d'une commande en quarantaine → 409", r.statut, 409);
  commandesEnPanne = true;
  r = await sauve({ jeton: "jeton-a", corps: C });
  commandesEnPanne = false;
  eq("order-save : base en panne → 500 (le site garde le panier et le numéro)", [r.statut, r.corps.success], [500, false]);
  baseCommandes = null;
}

// ════════════════════════ ordonnances des commandes en quarantaine ════════════════════════
{
  const { menageOrdonnances } = await import("../netlify/functions/_lab-justif.js");
  const RX_GARDEE = "0f8e2c1a-2222-4a2b-8c3d-000000000001", RX_ORPHELINE = "0f8e2c1a-2222-4a2b-8c3d-000000000002", RX_DEMANDE = "0f8e2c1a-2222-4a2b-8c3d-000000000003";
  const ilYa = (j) => new Date(Date.now() - j * 86400e3).toISOString();
  const prepare = () => {
    kv.clear();
    for (const id of [RX_GARDEE, RX_ORPHELINE, RX_DEMANDE]) kv.set(`lj:rx:${id}`, { value: JSON.stringify({ owner: "11", name: "ordonnance.pdf" }), updated_at: ilYa(3) });
    kv.set("lj:req:s-1-pfizer", { value: JSON.stringify({ id: "s-1-pfizer", rx: [{ id: RX_DEMANDE }] }), updated_at: ilYa(3) });
    baseCommandes = new Map([[1792000000010, { id: 1792000000010, source: "a_verifier", processed: false,
      items: [{ cip: "3400930177006", qty: 1, justif: { attestation: true, renouvellement: false, rx: [RX_GARDEE] } }] }]]);
  };
  prepare();
  await menageOrdonnances();
  eq("menageOrdonnances : ordonnance d'une commande « a_verifier » non traitée gardée, celle d'une demande gardée, l'orpheline effacée",
    [kv.has(`lj:rx:${RX_GARDEE}`), kv.has(`lj:rx:${RX_DEMANDE}`), kv.has(`lj:rx:${RX_ORPHELINE}`)], [true, true, false]);
  prepare();
  baseCommandes.get(1792000000010).processed = true;
  await menageOrdonnances();
  eq("menageOrdonnances : commande « a_verifier » traitée → son ordonnance n'est plus protégée", kv.has(`lj:rx:${RX_GARDEE}`), false);
  prepare(); commandesEnPanne = true;
  const erreur = await menageOrdonnances().then(() => null, e => e.message);
  commandesEnPanne = false;
  eq("menageOrdonnances : commandes illisibles → erreur, aucune ordonnance effacée", [!!erreur, kv.has(`lj:rx:${RX_GARDEE}`), kv.has(`lj:rx:${RX_ORPHELINE}`)], [true, true, true]);
  kv.clear(); baseCommandes = null;
}

// ════════════════════════ site : envoi d'une commande et commandes groupées (code de src/App.jsx rejoué) ════════════════════════
// Le code du site est extrait tel quel de src/App.jsx (appelAuthentifie, sessionPourEnvoi, envoi, groupement) et rejoué
// contre les vraies fonctions order-save, send-email et group-order (renouvellement des jetons : src/jetons.js, importé).
{
  const { readFileSync } = await import("node:fs");
  const { handler: mail } = await import("../netlify/functions/send-email.js");
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const entre = (debut, fin) => { const i = src.indexOf(debut), j = src.indexOf(fin, i + 1); if (i < 0 || j < 0) throw new Error(`extrait de App.jsx introuvable : ${debut}`); return src.slice(i, j); };
  const code = `import { loadJustifProducts, justifIssues, submitJustif, needsJustif, freshPharmacyToken, qtyByCip } from ${JSON.stringify(new URL("../src/lab-justif-client.js", import.meta.url).href)};
import { renouvelerUneFois, renouvelleAdmin } from ${JSON.stringify(new URL("../src/jetons.js", import.meta.url).href)};
import { estPeremption, separerPeremption, mentionCommande, mentionMail } from ${JSON.stringify(new URL("../src/peremption-panier.js", import.meta.url).href)};
const DEFAULT_RECIPIENT = "pharmacien@elixirpharma.fr";
${entre("const quotaOver = (quota, items) => {", "const quotaDay")}
${entre("const MESSAGE_ENVOI_BLOQUE = {", "class ErrorBoundary")}
export function fabrique(ctx) {
  const { actingFor, cartItems, justifInfo, pharmacyName, pharmacyEmail, pharmacyCip, isClient, quantities, CATALOG_WITH_ADMIN, getCampaign, setTimeout } = ctx;
  let { justifProducts } = ctx;
  const { flash, setSendStatus, setEnvoiBloque, setJustifProducts, setCartOpen, setQuantities, setSpecialItems, setJustifInfo, setUlabsError, fetchGroupOrders } = ctx;
  const jetonVersion = 0, useCallback = (f) => f, useRef = (v) => ({ current: v });
  const cartTotal = cartItems.reduce((s, i) => s + i.total, 0), cartCount = cartItems.reduce((s, i) => s + i.qty, 0);
  const expandSupplierGroups = async (items) => items;
  const loadQuota = async () => null;
${entre("  const appelAuthentifie = useCallback(", "  const [groupOrders, setGroupOrders]")}
${entre("  const sessionPourEnvoi = async () => {", "  // Reconnexion par code sans quitter")}
${entre("  const groupeARenvoyer = useRef(", "  useEffect(() => { if (jetonVersion) renvoyerGroupe(); }")}
${entre("  const sendingRef = useRef(false);", "  // ── ONBOARDING SCREEN")}
  return { handleSend, syncGroupe, renvoyerGroupe };
}`;
  const { fabrique } = await import("data:text/javascript," + encodeURIComponent(code));

  const LS = new Map();
  globalThis.localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => LS.delete(k) };
  let monde = null, ipSite = 0;
  const repSite = (c, s = 200) => new Response(JSON.stringify(c), { status: s });
  const versHandler = async (h, url, o, nom) => {
    const headers = { origin: ORIGINE, "x-nf-client-connection-ip": `10.40.0.${ipSite}` };
    for (const [k, v] of Object.entries(o.headers || {})) headers[k.toLowerCase()] = v;
    const r = await h({ httpMethod: o.method || "GET", headers, body: o.body ?? null, queryStringParameters: Object.fromEntries(new URL(url, "https://site.test").searchParams) });
    monde.journal.push(`${nom}${o.body && JSON.parse(o.body).verifier ? "(verifier)" : ""}:${r.statusCode}`);
    return new Response(r.body ?? null, { status: r.statusCode });
  };
  site = async (url, o = {}) => {
    const nom = url.match(/^\/\.netlify\/functions\/([\w-]+)/)[1];
    if (nom === "order-save") {
      const corps = JSON.parse(o.body || "{}");
      if (!corps.verifier) monde.avantEnregistrement?.(corps);
      const rep = await versHandler(orderSave, url, o, nom);
      if (!corps.verifier && monde.reponsePerdue) { monde.reponsePerdue = false; throw new TypeError("Failed to fetch"); }   // enregistrée, réponse perdue
      return rep;
    }
    if (nom === "send-email") return versHandler(mail, url, o, nom);
    if (nom === "group-order") return versHandler(groupe, url, o, nom);
    monde.journal.push(nom);
    if (nom === "admin-refresh") return repSite({ success: false });
    if (nom === "lab-justif") {
      if ((o.method || "GET") === "GET") return repSite({ products: { [LORVIQUA]: { lab: "pfizer", labNom: "Pfizer", maxCommande: 1, dispo: 0, ordonnance: "facultative" } } });
      monde.justif.push(JSON.parse(o.body).order_id); return repSite({ demandes: [] });
    }
    if (nom === "submit-order") { monde.relais.push(JSON.parse(o.body).orderId); return repSite({ queued: true, lignes: 1, reference: "R" }); }
    throw new Error(`fonction du site non simulée : ${nom}`);
  };
  const DOLIPRANE = { cip: "3400000000011", name: "Doliprane", qty: 2, pn: 1.5, total: 3 };
  const LIGNE_LORVIQUA = { cip: LORVIQUA, name: "LORVIQUA", qty: 1, pn: 100, total: 100 };
  const PRODUITS_ULABS = [{ cip: "3400000000011", name: "U 11" }, { cip: "3400000000028", name: "U 28" }];
  const nouvelle = ({ jeton = "jeton-a", items = [DOLIPRANE], quantities = {} } = {}) => {
    LS.clear(); if (jeton) LS.set("pharmacy_token", jeton);
    const ev = { statuts: [], bloque: [], flashes: [], ulabs: [], panierVide: false, minuteries: [] };
    const f = fabrique({ actingFor: null, cartItems: items, justifProducts: {}, justifInfo: { [LORVIQUA]: { attestation: true } },
      pharmacyName: "Pharmacie A", pharmacyEmail: MAIL_A, pharmacyCip: CIP_A, isClient: true, quantities,
      CATALOG_WITH_ADMIN: { ulabs: { products: PRODUITS_ULABS } }, getCampaign: (m) => (m === "ulabs" ? {} : null),
      setTimeout: (fn) => ev.minuteries.push(fn), flash: (m) => ev.flashes.push(m), setSendStatus: (s) => ev.statuts.push(s),
      setEnvoiBloque: (b) => ev.bloque.push(b), setJustifProducts: () => {}, setCartOpen: () => {},
      setQuantities: (q) => { if (typeof q !== "function") ev.panierVide = true; }, setSpecialItems: () => {}, setJustifInfo: () => {},
      setUlabsError: (u) => ev.ulabs.push(typeof u === "function" ? u(ev.ulabs.at(-1) ?? null) : u), fetchGroupOrders: () => {} });
    return { f, ev };
  };
  const envoie = async ({ f, ev }) => {
    ipSite++;
    monde.journal.length = 0;
    await f.handleSend();
    await new Promise(r => setTimeout(r, 20));   // relais : non attendu par le site
    ev.minuteries.splice(0).forEach(fn => fn());
    // statut affiché : « success » (puis remis à zéro 3 s après), sinon le dernier (null = bouton rendu, rien d'envoyé)
    return { statut: ev.statuts.includes("success") ? "success" : ev.statuts.at(-1) ?? null, bloque: ev.bloque.filter(Boolean).at(-1) || null, panierVide: ev.panierVide };
  };
  const mails = () => appels.filter(a => a.url.includes("api.emailjs.com")).length;
  const neuf = (o = {}) => { baseCommandes = new Map(); appels = []; monde = { journal: [], relais: [], justif: [], ...o }; };

  // nominal : enregistrement, puis e-mail, puis relais
  neuf();
  let s1 = nouvelle(), x = await envoie(s1);
  const ordre = monde.journal.map(j => j.split(":")[0]);
  eq("site : envoi nominal → commande enregistrée, e-mail, relais, panier vidé", [x.statut, baseCommandes.size, mails(), monde.relais.length, x.panierVide], ["success", 1, 1, 1, true]);
  eq("site : la commande est enregistrée AVANT l'e-mail", ordre.indexOf("order-save") >= 0 && ordre.indexOf("order-save") < ordre.indexOf("send-email"), true);
  eq("site : relais avec le numéro enregistré", monde.relais[0], [...baseCommandes.keys()][0]);
  x = await envoie(s1);
  eq("site : même panier renvoyé APRÈS un envoi réussi → nouvelle commande (jamais prise pour un doublon)", [x.statut, baseCommandes.size, new Set(monde.relais).size], ["success", 2, 2]);

  // enregistrement en panne : rien ne part
  neuf(); commandesEnPanne = true;
  x = await envoie(nouvelle());
  commandesEnPanne = false;
  eq("site : enregistrement en panne → ni e-mail ni relais, panier intact, « réessayez »", [x.statut, x.bloque, mails(), monde.relais.length, x.panierVide], [null, "erreur", 0, 0, false]);

  // session expirée entre le contrôle et l'enregistrement : rien ne part, reconnexion demandée
  neuf({ avantEnregistrement: () => { delete JETONS["jeton-ephemere"]; } });
  JETONS["jeton-ephemere"] = { id: "u-a", email: MAIL_A };
  x = await envoie(nouvelle({ jeton: "jeton-ephemere" }));
  eq("site : session refusée à l'enregistrement (401) → ni e-mail ni relais, panier intact, reconnexion", [x.statut, x.bloque, mails(), monde.relais.length, x.panierVide], [null, "reconnexion", 0, 0, false]);

  // Supabase Auth en panne à l'enregistrement : « réessayez », pas de reconnexion ni de renouvellement
  neuf({ avantEnregistrement: () => { authEnPanne = 504; } });
  x = await envoie(nouvelle());
  authEnPanne = null;
  eq("site : Auth en panne à l'enregistrement (503) → rien ne part, panier intact, motif « erreur » (pas de reconnexion)", [x.statut, x.bloque, mails(), monde.relais.length, x.panierVide], [null, "erreur", 0, 0, false]);
  eq("site : Auth en panne → aucun renouvellement de jeton tenté", monde.journal.includes("admin-refresh"), false);

  // réponse perdue : enregistrée mais le site ne le sait pas ; le nouvel essai garde le numéro → pas de doublon
  neuf({ reponsePerdue: true });
  const s5 = nouvelle();
  x = await envoie(s5);
  eq("site : réponse de l'enregistrement perdue → rien d'autre ne part, panier intact", [x.statut, x.bloque, mails(), monde.relais.length, x.panierVide, baseCommandes.size], [null, "erreur", 0, 0, false, 1]);
  x = await envoie(s5);
  eq("site : nouvel essai → même numéro reconnu ({ deja }), une seule commande, un e-mail, un relais", [x.statut, baseCommandes.size, mails(), monde.relais.length, monde.relais[0] === [...baseCommandes.keys()][0], x.panierVide],
    ["success", 1, 1, 1, true, true]);

  // e-mail en échec APRÈS l'enregistrement : la commande est gardée et relayée
  neuf(); emailEnPanne = true;
  x = await envoie(nouvelle());
  emailEnPanne = false;
  eq("site : e-mail en échec après l'enregistrement → commande en base et relayée, envoi réussi", [x.statut, baseCommandes.size, monde.relais.length, x.panierVide], ["success", 1, 1, true]);

  // lignes « sur justificatif » : deux commandes enregistrées avant l'e-mail ; seule la normale part au relais
  neuf();
  x = await envoie(nouvelle({ items: [DOLIPRANE, LIGNE_LORVIQUA] }));
  eq("site : panier avec justificatif → 2 commandes, 1 e-mail, relais de la normale, demande labo", [x.statut, [...baseCommandes.values()].map(o => o.source), mails(), monde.relais.length, monde.justif.length],
    ["success", ["catalogue", "justificatif"], 1, 1, 1]);
  neuf(); commandesEnPanne = true;
  x = await envoie(nouvelle({ items: [LIGNE_LORVIQUA] }));
  commandesEnPanne = false;
  eq("site : justificatif seul non enregistré → rien ne part, panier intact", [x.statut, x.bloque, mails(), monde.justif.length, x.panierVide], [null, "erreur", 0, 0, false]);

  // commandes groupées : quantité refusée faute de session → reconnexion demandée, renvoyée après
  neuf();
  const g = nouvelle({ jeton: null, quantities: { "ulabs-0": 6, "ulabs-1": 0 } });
  await g.f.syncGroupe("ulabs", "3400000000011", 6);
  await g.f.syncGroupe("ulabs", "3400000000028", 0);
  eq("site : groupement sans session (401) → reconnexion demandée, message, rien écrit", [g.ev.bloque.at(-1), g.ev.flashes.length > 0, /Quantités non comptées/.test(g.ev.ulabs.at(-1) || ""), appelsVers("elixir_group_orders").length],
    ["reconnexion", true, true, 0]);
  LS.set("pharmacy_token", "jeton-a"); appels = [];
  await g.f.renvoyerGroupe();
  eq("site : après la reconnexion → quantités renvoyées au groupement (6 écrite, remise à zéro supprimée), message retiré",
    [appelsVers("elixir_group_orders", "POST").map(a => JSON.parse(a.corps)).map(b => [b.cip, b.qty, b.pharmacy_cip]), appelsVers("elixir_group_orders", "DELETE").length, g.ev.ulabs.at(-1)],
    [[["3400000000011", 6, CIP_A]], 1, null]);
  appels = [];
  await g.f.renvoyerGroupe();
  eq("site : rien à renvoyer ensuite", appelsVers("group-order").length + appelsVers("elixir_group_orders").length, 0);
  // reconnexion après une confirmation U-Labs refusée, page rechargée (aucun refus mémorisé) : le panier U-Labs est renvoyé
  const g2 = nouvelle({ quantities: { "ulabs-0": 4, "ulabs-1": 12 } });
  authEnPanne = 503; appels = [];
  await g2.f.syncGroupe("ulabs", "3400000000011", 4);
  authEnPanne = null;
  eq("site : groupement en panne d'Auth (503) → pas de demande de reconnexion", [g2.ev.bloque.length, appelsVers("elixir_group_orders").length], [0, 0]);
  site = null; baseCommandes = null; delete globalThis.localStorage;
}

// ════════════════════════ peremption (« Odoo facture la remise », V1) ════════════════════════
// Page publique ; tout le reste réservé à l'admin (jeton vérifié par Supabase Auth) ou à la chaîne de nuit (x-cron-secret).
// Sans SUPABASE_SERVICE_ROLE_KEY (tables privées) : la page reste servie sans remise, l'admin reçoit 503 « non_installe ».
{
  const { handler: peremption } = await import("../netlify/functions/peremption.js");
  const odooAvant = () => appelsVers("odoo.test").length;
  const avant = odooAvant();
  const pe = async (methode, o) => { appels = []; return lit(await peremption(ev(methode, o))); };
  let x = await pe("GET", { q: { action: "page" } });
  eq("peremption ?action=page : public (sans jeton), sans cache, aucune remise sans les tables", [x.statut, x.entetes["Cache-Control"], x.corps.facturees, x.corps.etat], [200, "no-store", 0, "non_installe"]);
  for (const [label, o] of [["GET admin", { q: { action: "admin" } }], ["GET journal", { q: { action: "journal" } }], ["GET droits", { q: { action: "droits" } }], ["GET ecarts", { q: { action: "ecarts" } }], ["GET retrait_apercu", { q: { action: "retrait_apercu", cips: "3400933121549" } }]]) {
    x = await pe("GET", o);
    eq(`peremption ${label} sans jeton : refusé, rien lu`, [[401, 403].includes(x.statut), appelsVers("rest/v1").length], [true, 0]);
    x = await pe("GET", { ...o, jeton: "jeton-a" });
    eq(`peremption ${label} jeton pharmacie : 403`, x.statut, 403);
  }
  for (const action of ["apercu", "appliquer", "etape", "retirer", "tout_retirer", "reessayer", "mode", "reglages", "reconcilier", "faits"]) {
    x = await pe("POST", { corps: { action, cips: ["3400933121549"], remise_pct: 12, confirmation: "RETIRER" } });
    eq(`peremption POST ${action} sans jeton : refusé, rien lu ni écrit`, [[401, 403].includes(x.statut), appelsVers("rest/v1").length], [true, 0]);
    x = await pe("POST", { jeton: "jeton-b", corps: { action, cips: ["3400933121549"], remise_pct: 12, confirmation: "RETIRER" } });
    eq(`peremption POST ${action} jeton pharmacie : 403`, x.statut, 403);
  }
  x = await pe("GET", { q: { step: "nuit" } });
  eq("peremption chaîne de nuit sans x-cron-secret : 403", x.statut, 403);
  x = await pe("GET", { q: { action: "admin" }, jeton: "jeton-admin" });
  eq("peremption admin sans la clé service_role : 503 non_installe", [x.statut, x.corps.error], [503, "non_installe"]);
  authEnPanne = 503;
  x = await pe("POST", { jeton: "jeton-admin", corps: { action: "tout_retirer", confirmation: "RETIRER" } });
  authEnPanne = null;
  eq("peremption : Supabase Auth en panne → 503 indisponible, rien fait", [x.statut, x.corps.error], [503, "indisponible"]);
  eq("peremption : aucun appel Odoo pendant ces refus", odooAvant() - avant, 0);
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);   // rate-limit.js garde un minuteur de nettoyage : sortie explicite
