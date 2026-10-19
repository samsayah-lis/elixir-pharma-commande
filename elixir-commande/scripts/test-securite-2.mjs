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
const kv = new Map();        // kv_store simulé : clé → { value, updated_at }
let kvEnPanne = false;

// ── fetch simulé : toute adresse inconnue échoue (aucun appel réel possible) ──
let appels = [];
const q = (url) => Object.fromEntries(new URL(url).searchParams);
const val = (v) => String(v ?? "").replace(/^eq\./, "");
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const methode = opts.method || "GET";
  appels.push({ url, methode, corps: opts.body || null });
  const rep = (corps, status = 200) => new Response(status === 204 ? null : JSON.stringify(corps), { status });
  const p = url.startsWith("https://supabase.test/") ? q(url) : {};
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
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
  if (url === "https://api.emailjs.com/api/v1.0/email/send") return rep("OK");
  if (url.startsWith("https://supabase.test/rest/v1/elixir_pharmacies")) {
    if (methode === "POST") return rep(null, 201);
    const champs = String(p.select || "*").split(",");
    const lignes = PHARMACIES.filter(r => (!p.email || r.email === val(p.email)) && (!p.odoo_id || String(r.odoo_id) === val(p.odoo_id)));
    return rep(lignes.slice(0, p.limit ? +p.limit : 99).map(r => champs[0] === "*" ? r : Object.fromEntries(champs.map(c => [c, r[c] ?? null]))));
  }
  if (url.startsWith("https://supabase.test/rest/v1/elixir_orders")) return methode === "POST" ? rep(null, 201) : rep([]);
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
eq("order-save quarantaine : source d'origine dans le nom, lignes et textes bornés", [r.statut, /^⚠ NON VÉRIFIÉE \(justificatif\) — x+/.test(ligne?.pharmacy_name), ligne?.pharmacy_name.length <= 300, ligne?.items.length, ligne?.items[0].name.length, "justif" in ligne.items[0]],
  [200, true, true, 500, 200, false]);
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
eq("otp-send : clés de la limite rl:otp-…", [...kv.keys()].every(k => /^rl:otp-(ip|adresse-ip):[0-9a-f]{24}:\d{4}-\d\d-\d\dT[\d:.]+Z:[0-9a-f]{8}$/.test(k)), true);

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

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);   // rate-limit.js garde un minuteur de nettoyage : sortie explicite
