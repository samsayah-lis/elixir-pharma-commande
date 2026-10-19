// ── Assistant Elixir : identité et périmètre (SEUL accès Odoo / Supabase du chat) ──
// Contrat : docs/assistant-contrat.md (« Identité », « Règles absolues ») ; conception § 2.6, § 3.1, § 3.2.
//
// Identité : déduite du jeton vérifié ici, jamais d'un identifiant venu du navigateur ou du modèle
// (seule exception : l'admin « pour une pharmacie », dont pour_odoo_id est revalidé dans Odoo).
// Toute lecture impose ses filtres, jamais paramétrables par le modèle :
//   factures (et avoirs) : company_id = 2 ∧ commercial_partner_id = P ∧ state = posted ∧ move_type ∈ (out_invoice, out_refund)
//   commandes            : company_id = 2 ∧ partner_id child_of P ; lignes, livraisons, lots, retours : le même
//                          filtre redoublé sur chaque lecture (order_partner_id, picking_id.partner_id…)
// et toujours context.allowed_company_ids = [2] (sans lui, Odoo ouvre toutes les sociétés de l'utilisateur API :
// 1 099 factures d'autres sociétés sur les 17 fiches partagées). Jamais read([id]) sur un id venu du modèle :
// toujours un search_read portant ces domaines. P = fiche commerciale résolue par identifier().
//
// Référence inconnue OU d'une autre pharmacie : même chemin (le domaine ne la trouve pas), même réponse.
// Jamais lus : payment_state, amount_residual, credit, access_token, pharmaml_key, narration, notes, fil de
// discussion, e-mails ou téléphones des fiches, prix d'achat.
import { odoo as odooRpc, COMPANY_ID } from "./_odoo-rpc.js";
import { verifyTokenAsync } from "./auth.js";
import { sb as sbAnon } from "./_lab-justif.js";
import { validCip, splitEmails } from "./_pharmacies.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
export const DELAI_ODOO_MS = 6000;          // coupure de chaque lecture Odoo (conception § 2.6)
const DELAI_JETON_MS = 6000;                // vérification du jeton (auth.js n'a pas de coupure)
const enc = encodeURIComponent;

// ── Dépendances (injectables pour les tests) ────────────────────────────
// odoo(model, method, args, kwargs, { timeoutMs }) : même signature que _odoo-rpc.js
// sb(path) → JSON : même signature que sb de _lab-justif.js (lectures elixir_pharmacies, elixir_orders, kv_store)
// verifierJeton(jeton) → { id, email, isAdmin } | null : auth.js
// utilisateur(jeton) → utilisateur Supabase brut (email_confirmed_at) | null si le jeton est refusé ; lève si Supabase
// ne répond pas (délai, coupure, 5xx)
export function depsParDefaut(deps = {}) {
  return { odoo: odooRpc, sb: sbAnon, verifierJeton: verifyTokenAsync, utilisateur: lireUtilisateur, maintenant: () => new Date(), ...deps };
}
// Supabase Auth lent ou injoignable : erreur passagère (503), jamais une déconnexion de la pharmacie
export const erreurVerification = () => Object.assign(new Error("vérification du compte impossible"), { status: 503, code: "verification" });
async function lireUtilisateur(jeton) {
  if (!SUPABASE_URL || !jeton) return null;
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${jeton}` }, signal: AbortSignal.timeout(5000) });
  } catch { throw erreurVerification(); }
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) return null;   // jeton refusé
  if (!r.ok) throw erreurVerification();
  try { return await r.json(); } catch { throw erreurVerification(); }
}
const avecDelai = (promesse, ms) => new Promise((ok, ko) => {
  const t = setTimeout(() => ko(erreurVerification()), ms);
  Promise.resolve(promesse).then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); ko(e); });
});

// Lecture Odoo du chat : société 2 imposée dans le contexte, coupure à 6 s
function lire(d, model, method, args, kwargs = {}) {
  const kw = { ...kwargs, context: { lang: "fr_FR", ...(kwargs.context || {}), allowed_company_ids: [COMPANY_ID] } };
  return d.odoo(model, method, args, kw, { timeoutMs: DELAI_ODOO_MS });
}
// search_read par pages (relevé : jusqu'à ~1 000 lignes par mois pour les plus grosses pharmacies)
async function lireTout(d, model, domain, kwargs = {}, page = 2000, max = 20000) {
  const out = [];
  for (let offset = 0; offset < max; offset += page) {
    const rows = await lire(d, model, "search_read", [domain], { ...kwargs, limit: page, offset });
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// ── Erreurs d'identité ──────────────────────────────────────────────────
// 401 "reconnexion" | 403 "fiche" | 403 "admin_fiche"
export const erreurIdentite = (status, code) => Object.assign(new Error(code), { status, code, identite: true });
const minuscule = (s) => String(s || "").trim().toLowerCase();
const nettoyerNom = (s) => String(s || "").replace(/\s+/g, " ").trim();

// Fiche cliente d'Elixir : commerciale (parent_id = false), active, société 2 ou partagée (company_id = false)
// ayant au moins une vente confirmée de la société 2 — même règle que la connexion (_pharmacies.js),
// sans fichePharmacie({odooId}) qui ne contrôle pas la société
export async function ficheVerifiee(odooId, deps = {}) {
  const d = depsParDefaut(deps);
  const id = Number(odooId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [p] = await lire(d, "res.partner", "search_read", [[["id", "=", id], ["parent_id", "=", false], ["active", "=", true],
    ["company_id", "in", [COMPANY_ID, false]]]], { fields: ["id", "name", "city", "cip", "company_id"], limit: 1 });
  if (!p) return null;
  if (!p.company_id) {
    const ventes = await lire(d, "sale.order", "search_count", [[["company_id", "=", COMPANY_ID], ["state", "in", ["sale", "done"]], ["partner_id", "child_of", [p.id]]]]);
    if (!(ventes > 0)) return null;
  }
  return p;
}
// Compte non relié à sa fiche : fiche par le CIP (société 2 d'abord, puis partagée qui achète), comme fichePharmacie({cip})
async function ficheParCip(cip, d) {
  const cands = await lire(d, "res.partner", "search_read", [[["cip", "=", String(cip)], ["parent_id", "=", false], ["active", "=", true],
    ["company_id", "in", [COMPANY_ID, false]]]], { fields: ["id", "company_id"], limit: 10 });
  cands.sort((a, b) => (b.company_id?.[0] === COMPANY_ID) - (a.company_id?.[0] === COMPANY_ID));
  for (const c of cands) { const f = await ficheVerifiee(c.id, d); if (f) return f; }
  return null;
}
// Adresses encore portées par la fiche dans Odoo (fiche commerciale et contacts actifs). La synchronisation garde les
// anciennes adresses d'une pharmacie dans elixir_pharmacies (pharmacy-sync-now.js) : ancien titulaire, salarié parti…
// Elles ne donnent ni accès aux documents, ni d'e-mail. Les adresses sont comparées ici, jamais transmises au modèle.
async function adressesDeFiche(odooId, d) {
  const rows = await lire(d, "res.partner", "search_read", [[["commercial_partner_id", "=", Number(odooId)], ["active", "=", true], ["email", "!=", false],
    ["company_id", "in", [COMPANY_ID, false]]]], { fields: ["email"], limit: 500 });
  return new Set(rows.flatMap(r => splitEmails(r.email)));
}
// Adresses de compte du site reliées à la fiche ET encore sur la fiche Odoo (seules destinataires d'e-mails)
async function comptesDeFiche(odooId, d, adresses, premier = null) {
  const rows = (await d.sb(`elixir_pharmacies?odoo_id=eq.${Number(odooId)}&select=email`)) || [];
  const ok = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && adresses.has(e);
  return [...new Set([premier, ...rows.map(r => minuscule(r.email))].filter(e => e && ok(e)))];
}
// limite : compte dont l'adresse n'est plus sur la fiche → seulement « parler à un conseiller »
function contexte(p, extra, limite = false) {
  const cip = validCip(p.cip) ? String(p.cip).trim() : null;
  // règle Elixir : fiche sans CIP = client bloqué → seulement « parler à un conseiller » (message neutre)
  return { odooId: p.id, cip, nom: nettoyerNom(p.name), ville: nettoyerNom(p.city) || null, ...extra, mode: cip && !limite ? "complet" : "conseiller_seul" };
}

// Qui parle : pharmacie connectée (jeton vérifié, e-mail confirmé), ou admin pour une fiche revalidée dans Odoo
// Erreurs : 401 « reconnexion » (jeton refusé), 403 « fiche » / « admin_fiche », 503 « verification » (Supabase lent)
export async function identifier(event, body = {}, deps = {}) {
  const d = depsParDefaut(deps);
  const h = event?.headers || {};
  const jeton = String(h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!jeton) throw erreurIdentite(401, "reconnexion");
  // jeton relu auprès de Supabase : refusé → reconnexion ; Supabase lent ou injoignable → 503 (la pharmacie reste connectée)
  const brut = await d.utilisateur(jeton);
  if (!brut?.id) throw erreurIdentite(401, "reconnexion");
  // auth.js (rôle admin) avale ses erreurs : un échec juste après une relecture réussie est passager
  const u = await avecDelai(d.verifierJeton(jeton), DELAI_JETON_MS).catch((e) => { if (e?.code === "verification") throw e; return null; });
  if (!u?.id || u.id !== brut.id) throw erreurVerification();

  // ── Admin « pour une pharmacie » ──
  if (u.isAdmin === true) {
    const pour = String(body?.pour_odoo_id ?? "").trim();
    if (!/^\d{1,9}$/.test(pour)) throw erreurIdentite(403, "admin_fiche");
    const p = await ficheVerifiee(Number(pour), d);
    if (!p) throw erreurIdentite(403, "admin_fiche");
    const admin = minuscule(u.email) || "admin";
    return contexte(p, { compteEmail: admin, comptes: await comptesDeFiche(p.id, d, await adressesDeFiche(p.id, d)), admin });
  }

  // ── Pharmacie : rien n'est pris dans le corps (ni odoo_id, ni CIP, ni e-mail) ──
  const mail = minuscule(brut.email);
  if (!brut.email_confirmed_at || !mail || mail !== minuscule(u.email)) throw erreurIdentite(401, "reconnexion");
  const [row] = (await d.sb(`elixir_pharmacies?email=eq.${enc(mail)}&select=odoo_id,cip&limit=1`)) || [];
  if (!row) throw erreurIdentite(403, "fiche");
  let p = null;
  if (/^\d+$/.test(String(row.odoo_id ?? ""))) p = await ficheVerifiee(Number(row.odoo_id), d);
  else if (validCip(row.cip)) p = await ficheParCip(String(row.cip).trim(), d);   // compte non relié à sa fiche
  if (!p) throw erreurIdentite(403, "fiche");
  // adresse qui n'est plus sur la fiche Odoo (ancienne adresse gardée par la synchronisation, ajout manuel) : pas de document
  const adresses = await adressesDeFiche(p.id, d);
  const surFiche = adresses.has(mail);
  return contexte(p, { compteEmail: mail, comptes: await comptesDeFiche(p.id, d, adresses, surFiche ? mail : null), admin: null }, !surFiche);
}

// ── Domaines imposés ────────────────────────────────────────────────────
function fiche(ctx) {
  const id = Number(ctx?.odooId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("périmètre : fiche absente");
  return id;
}
export const domaineFactures = (ctx) => [["company_id", "=", COMPANY_ID], ["commercial_partner_id", "=", fiche(ctx)], ["state", "=", "posted"],
  ["move_type", "in", ["out_invoice", "out_refund"]]];
export const domaineCommandes = (ctx) => [["company_id", "=", COMPANY_ID], ["partner_id", "child_of", fiche(ctx)]];
const domaineLignesCommande = (ctx) => [["company_id", "=", COMPANY_ID], ["order_partner_id", "child_of", fiche(ctx)]];
const domaineLivraisons = (ctx) => [["company_id", "=", COMPANY_ID], ["partner_id", "child_of", fiche(ctx)]];
const domaineMouvements = (ctx) => [["company_id", "=", COMPANY_ID], ["picking_id.partner_id", "child_of", fiche(ctx)]];
const domaineLignesFacture = (ctx) => [["company_id", "=", COMPANY_ID], ["move_id.commercial_partner_id", "=", fiche(ctx)],
  ["parent_state", "=", "posted"], ["move_id.move_type", "in", ["out_invoice", "out_refund"]]];

// ── Petits outils (dates à l'heure de Paris, libellés) ──────────────────
export const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const tronquer = (s, n = 120) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
export const jourParis = (d) => new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
export const heureParis = (d) => new Date(d).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false });
export const dateOdoo = (s) => (s ? new Date(String(s).replace(" ", "T") + "Z") : null);     // datetime Odoo (UTC) → Date
export const jourOdoo = (s) => (s ? jourParis(dateOdoo(s)) : null);                            // datetime Odoo → « AAAA-MM-JJ » (Paris)
export const jourFr = (j) => (j ? `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}` : "");
function decalageParisMin(date) {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" }).format(date);
  const m = s.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
// minuit à Paris du jour « AAAA-MM-JJ » → datetime Odoo (UTC, « AAAA-MM-JJ HH:MM:SS »), changement d'heure compris
export function minuitParisOdoo(jour) {
  const approx = Date.parse(`${jour}T00:00:00Z`);
  let t = approx - decalageParisMin(new Date(approx)) * 60000;
  t = approx - decalageParisMin(new Date(t)) * 60000;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}
export const minuitParisIso = (jour) => minuitParisOdoo(jour).replace(" ", "T") + ".000Z";
export const jourValide = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
export const jourPlus = (jour, n) => new Date(Date.parse(`${jour}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
export function moisAvant(jour, n) {
  const [a, m, j] = jour.split("-").map(Number);
  const t = a * 12 + (m - 1) - n, an = Math.floor(t / 12), mo = t % 12;
  const fin = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
  return `${an}-${String(mo + 1).padStart(2, "0")}-${String(Math.min(j, fin)).padStart(2, "0")}`;
}
const normaliser = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normaliserLot = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// produit_id Odoo [id, "[3400930077696] NINLARO 2,3 mg B/3"] → { product_id, cip, produit }
export function produitDe(m2o) {
  const s = String(m2o?.[1] || "");
  const m = s.match(/^\[([^\]]+)\]\s*(.*)$/);
  return { product_id: m2o?.[0] || null, cip: m && /^\d{7,13}$/.test(m[1]) ? m[1] : null, produit: tronquer(m ? m[2] : s, 120) };
}
const nomM2o = (m2o) => String(m2o?.[1] || "").replace(/\s*\(.*\)\s*$/, "").trim() || null;   // « INV/2026/51300 (réf.) » → numéro

// Références citées : facture/avoir, commande de vente, livraison, commande du site (13 chiffres), CIP13
export const REF_SITE = /^(17\d{11})(P\d{1,2})?$/;
// Numéros de pièces d'Odoo : R?INV/AAAA/NNNNN, partie numérique sur 5 chiffres complétée par des zéros
const cinq = (n) => String(n).replace(/^0+(?=\d)/, "").padStart(5, "0");
export function normaliserReference(s) {
  const t = String(s || "").trim().toUpperCase().replace(/[\s_-]+/g, "/").replace(/\/+/g, "/");
  const m = t.match(/^(R?INV)\/?(\d{4})\/(\d{1,6})$/);    // « RINV/2026/1176 », « INV2026/51300 » → zéros de tête ajoutés
  if (m) return `${m[1]}/${m[2]}/${cinq(m[3])}`;
  if (/^R?INV\/\d{4}\/\d+$/.test(t) || /^EP\/OUT\/\d+$/.test(t)) return t;
  const nu = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^S\d{3,}$/.test(nu) || REF_SITE.test(nu)) return nu;
  return t;
}
// Numéro de pièce cité → condition sur account.move.name, ou null. Formes : INV/2026/51300, RINV/2026/1176 (zéros
// ajoutés), INV 51300 ou RINV1176 (sans l'année : toutes années), 2026/51300, 51300 ou 1176 (numéro seul)
export function conditionNumero(s) {
  const t = normaliserReference(s);
  let m;
  if (/^R?INV\/\d{4}\/\d+$/.test(t)) return ["name", "=", t];
  if ((m = t.match(/^(R?INV)\/?(\d{1,6})$/))) return ["name", "=like", `${m[1]}/%/${cinq(m[2])}`];
  if ((m = t.match(/^(\d{4})\/(\d{1,6})$/))) return ["name", "=like", `%/${m[1]}/${cinq(m[2])}`];
  if ((m = t.match(/^(\d{1,6})$/))) return ["name", "=like", `%/${cinq(m[1])}`];
  return null;
}
export function analyserRecherche(s) {
  const brut = String(s || "").trim();
  if (!brut) return null;
  const ref = normaliserReference(brut);
  if ((/^R?INV\/?\d/.test(ref) || /^\d{4}\/\d{1,6}$/.test(ref)) && conditionNumero(ref)) return { type: "numero", valeur: ref, brut };
  if (/^S\d{3,}$/.test(ref)) return { type: "commande", valeur: ref, brut };
  if (/^EP\/OUT\/\d+$/.test(ref)) return { type: "livraison", valeur: ref, brut };
  if (REF_SITE.test(ref)) return { type: "site", valeur: ref.match(REF_SITE)[1], brut };
  // 7 ou 13 chiffres : CIP, mais aussi format des références de certains logiciels d'officine (cherchées aussi)
  if (/^\d{13}$/.test(brut) || /^\d{7}$/.test(brut)) return { type: "cip", valeur: brut, brut };
  if (/^\d{3,12}$/.test(brut)) return { type: "numero_court", valeur: brut, brut };
  const mot = brut.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").slice(0, 60).trim();
  return mot.length >= 3 ? { type: "mot", valeur: mot, brut } : null;
}
// Produit cité → conditions (notation préfixée d'Odoo) sur une ligne de facture ou de commande. Le libellé d'une ligne
// ne porte que le nom du produit ; le CIP13 est le code interne du produit (default_code), CIP7 = 34009 + CIP7 + clé.
function conditionsProduit(r) {
  if (r.type === "cip") return r.valeur.length === 13 ? [["product_id.default_code", "=", r.valeur]] : [["product_id.default_code", "=like", `34009${r.valeur}_`]];
  return ["|", ["name", "ilike", r.valeur], ["product_id", "ilike", r.valeur]];
}
// Référence d'un logiciel d'officine (pml_order_ref, recopiée telle quelle) : chiffres, ou mot sans espace avec un chiffre
const refLogiciel = (r) => (r.type === "cip" || r.type === "numero_court" || (r.type === "mot" && /^[0-9a-z]{4,30}$/i.test(r.brut) && /\d/.test(r.brut))
  ? [...new Set([r.brut, r.brut.toLowerCase(), r.brut.toUpperCase()])] : null);

// ═══ Factures et avoirs ═════════════════════════════════════════════════
const CHAMPS_PIECE = ["name", "move_type", "invoice_date", "amount_untaxed_signed", "amount_tax_signed", "amount_total_signed",
  "invoice_origin", "reversed_entry_id", "ref", "invoice_pdf_report_id"];
// pièce lue → forme interne (liste blanche ; le PDF n'est qu'un indicateur, son id ne sort pas d'ici)
function piece(m) {
  const avoir = m.move_type === "out_refund";
  const origine = String(m.invoice_origin || "").split(",").map(x => x.trim()).filter(Boolean);
  return {
    id: m.id, piece: avoir ? "avoir" : "facture", numero: m.name, date: m.invoice_date || null,
    montant_ht: r2(m.amount_untaxed_signed), montant_tva: r2(m.amount_tax_signed), montant_ttc: r2(m.amount_total_signed),
    commandes: origine.filter(x => /^S\d+$/.test(x)), pdf_disponible: !!m.invoice_pdf_report_id,
    ...(avoir ? { avoir_de: nomM2o(m.reversed_entry_id), motif: m.ref ? tronquer(m.ref, 120) : null } : {}),
  };
}
// pièces d'une recherche produit (CIP ou mot du nom) : lignes de facture de CETTE pharmacie
async function idsPiecesParProduit(ctx, r, debut, fin, d) {
  const lignes = await lire(d, "account.move.line", "search_read", [[...domaineLignesFacture(ctx), ["display_type", "=", "product"],
    ["move_id.invoice_date", ">=", debut], ["move_id.invoice_date", "<=", fin], ...conditionsProduit(r)]], { fields: ["move_id"], limit: 2000 });
  return [...new Set(lignes.map(l => l.move_id?.[0]).filter(Boolean))];
}
// Liste paginée (20 par page, les plus récentes d'abord)
export async function listerPieces(ctx, { debut, fin, type = "tous", recherche = null, page = 1, parPage = 20 }, deps = {}) {
  const d = depsParDefaut(deps);
  const dom = [...domaineFactures(ctx), ["invoice_date", ">=", debut], ["invoice_date", "<=", fin]];
  if (type === "factures") dom.push(["move_type", "=", "out_invoice"]);
  else if (type === "avoirs") dom.push(["move_type", "=", "out_refund"]);
  const r = analyserRecherche(recherche);
  if (r?.type === "numero" || r?.type === "numero_court") {
    const c = conditionNumero(r.valeur);
    if (!c) return { total: 0, pieces: [] };
    dom.push(c);
  } else if (r?.type === "commande") dom.push(["invoice_origin", "ilike", r.valeur]);
  else if (r?.type === "cip" || r?.type === "mot") {
    const ids = await idsPiecesParProduit(ctx, r, debut, fin, d);
    if (!ids.length) return { total: 0, pieces: [] };
    dom.push(["id", "in", ids]);
  } else if (r) return { total: 0, pieces: [] };   // livraison, commande du site : pas des pièces comptables
  const total = await lire(d, "account.move", "search_count", [dom]);
  if (!total) return { total: 0, pieces: [] };
  const rows = await lire(d, "account.move", "search_read", [dom], { fields: CHAMPS_PIECE, order: "invoice_date desc, name desc",
    limit: parPage, offset: (Math.max(1, page) - 1) * parPage });
  return { total, pieces: rows.map(piece) };
}

// Duplicata : par numéro (exact, sans zéros de tête, sans année : « RINV 1176 », « 2026/51300 », « 51300 ») OU par date
export async function piecesPourDuplicata(ctx, { numero = null, date = null }, deps = {}) {
  const d = depsParDefaut(deps);
  const base = domaineFactures(ctx);
  const lireP = (dom, kw = {}) => lire(d, "account.move", "search_read", [dom], { fields: CHAMPS_PIECE, order: "invoice_date desc, name desc", ...kw });
  if (numero) {
    const c = conditionNumero(numero);
    if (!c) return { pieces: [], proches: [] };
    return { pieces: (await lireP([...base, c], { limit: 5 })).map(piece), proches: [] };
  }
  if (!jourValide(date)) return { pieces: [], proches: [] };
  const pieces = (await lireP([...base, ["invoice_date", "=", date]], { limit: 10 })).map(piece);
  if (pieces.length) return { pieces, proches: [] };
  // aucune pièce ce jour-là : les plus proches avant et après
  const avant = await lireP([...base, ["invoice_date", "<", date]], { limit: 2 });
  const apres = await lire(d, "account.move", "search_read", [[...base, ["invoice_date", ">", date]]], { fields: CHAMPS_PIECE, order: "invoice_date asc, name asc", limit: 2 });
  return { pieces: [], proches: [...avant.reverse(), ...apres].map(piece) };
}

// PDF d'origine d'une pièce (chat-fichier) : propriété revérifiée, puis pièce jointe invoice_pdf_report_id telle quelle
export async function pdfPiece(ctx, moveId, deps = {}) {
  const d = depsParDefaut(deps);
  const id = Number(moveId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [m] = await lire(d, "account.move", "search_read", [[...domaineFactures(ctx), ["id", "=", id]]], { fields: ["name", "move_type", "invoice_pdf_report_id"], limit: 1 });
  const att = m?.invoice_pdf_report_id?.[0];
  if (!att) return null;
  const [a] = await lire(d, "ir.attachment", "search_read", [[["id", "=", att], ["res_model", "=", "account.move"], ["res_id", "=", m.id]]],
    { fields: ["datas", "mimetype"], limit: 1 });
  if (!a?.datas || a.mimetype !== "application/pdf") return null;
  return { numero: m.name, piece: m.move_type === "out_refund" ? "avoir" : "facture", base64: String(a.datas) };
}

// Relevé : pièces de la période, lignes produit (base HT par taux) et lignes de taxe (TVA), taux
// Base HT = −Σ balance des lignes « product » regroupées par tax_ids ; TVA = −Σ balance des lignes « tax ».
// Jamais tax_base_amount (non signé : un avoir gonflerait la base).
export async function donneesReleve(ctx, debut, fin, { parProduit = false } = {}, deps = {}) {
  const d = depsParDefaut(deps);
  if (!jourValide(debut) || !jourValide(fin) || debut > fin) throw new Error("relevé : période invalide");
  const pieces = await lireTout(d, "account.move", [...domaineFactures(ctx), ["invoice_date", ">=", debut], ["invoice_date", "<=", fin]],
    { fields: ["name", "move_type", "invoice_date", "invoice_date_due", "amount_untaxed_signed", "amount_tax_signed", "amount_total_signed", "invoice_origin"],
      order: "invoice_date asc, name asc" }, 1000, 5000);
  if (!pieces.length) return { pieces: [], lignes: [], taxes: [] };
  const lignes = [];
  const champs = ["move_id", "display_type", "balance", "tax_ids", "tax_line_id", ...(parProduit ? ["product_id", "quantity"] : [])];
  for (let i = 0; i < pieces.length; i += 400) {
    lignes.push(...await lireTout(d, "account.move.line", [...domaineLignesFacture(ctx), ["move_id", "in", pieces.slice(i, i + 400).map(p => p.id)],
      ["display_type", "in", ["product", "tax"]]], { fields: champs, order: "id" }, 4000, 40000));
  }
  const ids = [...new Set(lignes.flatMap(l => (l.display_type === "tax" ? [l.tax_line_id?.[0]] : l.tax_ids || [])).filter(Boolean))];
  const taxes = ids.length ? await lire(d, "account.tax", "search_read", [[["id", "in", ids], ["company_id", "=", COMPANY_ID]]],
    { fields: ["amount", "amount_type"], context: { active_test: false } }) : [];
  return { pieces, lignes, taxes };
}

// ═══ Commandes ═════════════════════════════════════════════════════════
const CHAMPS_COMMANDE = ["name", "date_order", "state", "from_pharmaml", "delivery_status", "invoice_status", "x_studio_statut_prparation",
  "x_studio_tourne", "pharmaml_lock_status", "effective_date", "picking_ids", "invoice_ids"];
const CHAMPS_LIGNE = ["order_id", "product_id", "pharmaml_ordered_qty", "product_uom_qty", "qty_delivered", "qty_invoiced", "pml_order_ref"];
const lignesDe = (ctx, ids, d) => (ids.length ? lireTout(d, "sale.order.line", [...domaineLignesCommande(ctx), ["order_id", "in", ids],
  ["display_type", "=", false]], { fields: CHAMPS_LIGNE, order: "id" }, 2000, 10000) : []);
const facturesDe = async (ctx, ids, d) => (ids.length ? (await lire(d, "account.move", "search_read", [[...domaineFactures(ctx), ["id", "in", ids]]],
  { fields: ["name", "move_type", "invoice_date"], order: "invoice_date asc, name asc" })) : []);
// factures et avoirs d'une commande, séparés (un avoir n'est jamais présenté comme une facture de la commande)
const pieces2 = (fs) => ({ factures: fs.filter(f => f.move_type !== "out_refund"), avoirs: fs.filter(f => f.move_type === "out_refund") });

// Quantités réellement sorties de l'entrepôt, par ligne de commande : mouvements validés des livraisons sortantes, hors
// retours. qty_delivered d'Odoo déduit les retours : un produit sorti puis repris y paraîtrait « non servi ».
// → { parLigne: Map(id de ligne → quantité sortie), derniere: Map(id de commande → datetime Odoo de la dernière sortie) }
async function sortiesDe(ctx, lignes, d) {
  const parLigne = new Map(), derniere = new Map();
  const ids = lignes.map(l => l.id).filter(Boolean);
  const cde = new Map(lignes.map(l => [l.id, l.order_id?.[0]]));
  for (let i = 0; i < ids.length; i += 1000) {
    const mv = await lire(d, "stock.move", "search_read", [[...domaineMouvements(ctx), ["sale_line_id", "in", ids.slice(i, i + 1000)], ["state", "=", "done"],
      ["picking_code", "=", "outgoing"], ["origin_returned_move_id", "=", false]]], { fields: ["sale_line_id", "quantity", "date"], limit: 20000 });
    for (const m of mv) {
      const l = m.sale_line_id?.[0];
      parLigne.set(l, (parLigne.get(l) || 0) + (Number(m.quantity) || 0));
      const o = cde.get(l);
      if (o && m.date && !(derniere.get(o) >= m.date)) derniere.set(o, m.date);
    }
  }
  return { parLigne, derniere };
}

// quantités d'une ligne de commande : commandé (PharmaML) / servi (sorti de l'entrepôt si la commande est sortie, sinon
// retenu) / non servi. sorties : quantités sorties par ligne (sortiesDe) ; à défaut, qty_delivered d'Odoo.
export function quantitesLigne(l, sortie, sorties = null) {
  const commande = Number(l.pharmaml_ordered_qty) > 0 ? Number(l.pharmaml_ordered_qty) : Number(l.product_uom_qty) || 0;
  const servi = !sortie ? Number(l.product_uom_qty) || 0 : sorties ? Number(sorties.get(l.id)) || 0 : Number(l.qty_delivered) || 0;
  return { commande, servi, non_servi: Math.max(0, commande - servi), facture: Number(l.qty_invoiced) || 0 };
}
const entierementZero = (lignes) => lignes.length > 0 && lignes.every(l => !(Number(l.product_uom_qty) > 0));
const refSiteDe = (lignes) => { for (const l of lignes) { const m = String(l.pml_order_ref || "").match(REF_SITE); if (m) return m[1]; } return null; };
const origineDe = (so, lignes) => (!so.from_pharmaml ? "saisie" : refSiteDe(lignes) ? "site" : "logiciel");
// tournée affichable : numéro, ou Chronopost ; les libellés internes (IMPERATIFS, DEROGATION…) ne sortent pas
function tourneeDe(t) {
  const s = String(t || "").trim();
  if (/^\d{1,2}$/.test(s)) return `tournée ${s}`;
  if (/^chronopost$/i.test(s)) return "Chronopost";
  return null;
}
// libellé lisible de l'état (jamais « livrée chez vous » : la date est celle de la sortie d'entrepôt). derniereSortie :
// dernière sortie validée (effective_date d'Odoo est la PREMIÈRE : une commande livrée en deux fois afficherait la 1re)
export function etatCommande(so, lignes, factures = [], derniereSortie = null) {
  if (so.state === "cancel") return "Annulée";
  if (entierementZero(lignes)) return "Non servie (aucun produit disponible)";
  const t = tourneeDe(so.x_studio_tourne);
  const quand = derniereSortie || so.effective_date;
  const sortie = quand ? jourFr(jourOdoo(quand)) : null;
  if (so.delivery_status === "full" || so.delivery_status === "partial") {
    const base = `${so.delivery_status === "partial" ? "Partiellement sortie" : "Sortie"} de l'entrepôt${sortie ? ` le ${sortie}` : ""}${t ? ` (${t})` : ""}`;
    const { factures: fs, avoirs } = pieces2(factures);
    return [base, fs.length ? `Facturée (${fs.map(f => f.name).join(", ")})` : null, avoirs.length ? `Avoir ${avoirs.map(f => f.name).join(", ")}` : null]
      .filter(Boolean).join(" · ");
  }
  if (so.delivery_status === "started" || so.pharmaml_lock_status === "closed" || so.x_studio_statut_prparation === "🟡 En cours") return "En préparation";
  return "Reçue";
}

// Recherche Odoo (filtres d'état, recherche) → ids de commandes, sinon null (pas de filtre)
async function idsParRecherche(ctx, r, debutDt, finDt, d) {
  if (!r) return null;
  if (r.type === "livraison") {
    const p = await lire(d, "stock.picking", "search_read", [[...domaineLivraisons(ctx), ["name", "=", r.valeur]]], { fields: ["sale_id"], limit: 5 });
    return [...new Set(p.map(x => x.sale_id?.[0]).filter(Boolean))];
  }
  if (r.type === "numero") {   // facture citée : ses commandes d'origine
    const c = conditionNumero(r.valeur);
    const ms = c ? await lire(d, "account.move", "search_read", [[...domaineFactures(ctx), c]], { fields: ["invoice_origin"], limit: 5 }) : [];
    const noms = [...new Set(ms.flatMap(m => String(m.invoice_origin || "").split(",").map(x => x.trim()).filter(x => /^S\d+$/.test(x))))];
    if (!noms.length) return [];
    return (await lire(d, "sale.order", "search_read", [[...domaineCommandes(ctx), ["name", "in", noms]]], { fields: ["id"] })).map(x => x.id);
  }
  let dom;
  const ref = refLogiciel(r);   // référence du logiciel de l'officine, telle qu'elle est recopiée sur les lignes
  if (r.type === "site") dom = [["pml_order_ref", "=like", `${r.valeur}%`]];
  else if (r.type === "numero_court") dom = [["pml_order_ref", "in", ref]];
  else if (r.type === "cip" || r.type === "mot") dom = ref ? ["|", ["pml_order_ref", "in", ref], ...conditionsProduit(r)] : conditionsProduit(r);
  else return [];
  const l = await lire(d, "sale.order.line", "search_read", [[...domaineLignesCommande(ctx), ...dom, ["order_id.date_order", ">=", debutDt],
    ["order_id.date_order", "<", finDt]]], { fields: ["order_id"], limit: 2000 });
  return [...new Set(l.map(x => x.order_id?.[0]).filter(Boolean))];
}

// Commandes Odoo de la période (20 par page), avec lignes, sorties et factures de la page
export async function listerCommandes(ctx, { debut, fin, etat = "toutes", recherche = null, page = 1, parPage = 20 }, deps = {}) {
  const d = depsParDefaut(deps);
  const debutDt = minuitParisOdoo(debut), finDt = minuitParisOdoo(jourPlus(fin, 1));
  const dom = [...domaineCommandes(ctx), ["state", "in", ["sale", "done"]], ["date_order", ">=", debutDt], ["date_order", "<", finDt]];
  const r = analyserRecherche(recherche);
  if (r?.type === "commande") dom.push(["name", "=", r.valeur]);
  else if (r) {
    const ids = await idsParRecherche(ctx, r, debutDt, finDt, d);
    if (!ids.length) return { total: 0, commandes: [], limite: false };
    dom.push(["id", "in", ids]);
  }
  if (etat === "en_cours") dom.push(["delivery_status", "in", ["pending", "started"]]);
  else if (etat === "sorties") dom.push(["delivery_status", "in", ["partial", "full"]]);
  // invoice_status « invoiced » est aussi posé sur les commandes entièrement non servies (rien à facturer, aucune facture)
  else if (etat === "facturees") dom.push(["invoice_status", "=", "invoiced"], ["invoice_ids", "!=", false]);
  let rows, total, limite = false, lignes, sorties;
  if (etat === "partiellement_servies") {
    // non exprimable en domaine : filtre sur les 200 commandes les plus récentes de la période ; les commandes sans
    // livraison (delivery_status vide = entièrement non servies) sont écartées d'abord, elles ne sont jamais partielles
    const cands = await lire(d, "sale.order", "search_read", [[...dom, ["delivery_status", "!=", false]]], { fields: CHAMPS_COMMANDE, order: "date_order desc", limit: 200 });
    limite = cands.length === 200;
    const toutes = await lignesDe(ctx, cands.map(c => c.id), d);
    const s = await sortiesDe(ctx, toutes, d);
    const parCde = groupe(toutes, l => l.order_id?.[0]);
    const partielles = cands.filter(c => { const ls = parCde.get(c.id) || [];
      const sortie = c.delivery_status === "full" || c.delivery_status === "partial";
      return ls.some(l => quantitesLigne(l, sortie, s.parLigne).non_servi > 0) && !entierementZero(ls); });
    total = partielles.length;
    rows = partielles.slice((Math.max(1, page) - 1) * parPage, Math.max(1, page) * parPage);
    const ids = new Set(rows.map(c => c.id));
    lignes = toutes.filter(l => ids.has(l.order_id?.[0]));
    sorties = s;
  } else {
    total = await lire(d, "sale.order", "search_count", [dom]);
    rows = total ? await lire(d, "sale.order", "search_read", [dom], { fields: CHAMPS_COMMANDE, order: "date_order desc",
      limit: parPage, offset: (Math.max(1, page) - 1) * parPage }) : [];
    lignes = await lignesDe(ctx, rows.map(c => c.id), d);
    sorties = await sortiesDe(ctx, lignes, d);
  }
  const parCde = groupe(lignes, l => l.order_id?.[0]);
  const factures = await facturesDe(ctx, [...new Set(rows.flatMap(c => c.invoice_ids || []))], d);
  const parId = new Map(factures.map(f => [f.id, f]));
  return { total, limite, commandes: rows.map(so => resumeCommande(so, parCde.get(so.id) || [], (so.invoice_ids || []).map(i => parId.get(i)).filter(Boolean), sorties)) };
}
function resumeCommande(so, lignes, factures, sorties) {
  const sortie = so.delivery_status === "full" || so.delivery_status === "partial";
  const q = lignes.map(l => quantitesLigne(l, sortie, sorties.parLigne));
  const dt = dateOdoo(so.date_order);
  const { factures: fs, avoirs } = pieces2(factures);
  return {
    id: so.id, reference: so.name, date: dt ? jourParis(dt) : null, heure: dt ? heureParis(dt) : null, origine: origineDe(so, lignes),
    commande_site_id: refSiteDe(lignes), etat: etatCommande(so, lignes, factures, sorties.derniere.get(so.id) || null), lignes: lignes.length,
    lignes_non_servies: q.filter(x => x.servi === 0 && x.commande > 0).length,
    lignes_partielles: q.filter(x => x.servi > 0 && x.non_servi > 0).length, factures: fs.map(f => f.name), avoirs: avoirs.map(f => f.name),
  };
}
const groupe = (xs, cle) => { const m = new Map(); for (const x of xs) { const k = cle(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

// ── Commandes du site (Supabase elixir_orders, CIP DE LA FICHE) et état simplifié du relais PharmaML ──
// elixir_orders a été écrite par order-save SANS authentification jusqu'au correctif de sécurité du 19/10/2026 (depuis :
// jeton obligatoire ; commandes en quarantaine « a_verifier » sans CIP) : une ligne ancienne au CIP de la fiche peut venir d'un tiers.
// Aucun texte libre de la ligne (libellé d'article…) ne part donc vers le modèle (CIP et quantités seulement, noms relus
// dans Odoo), et une commande qui n'est rattachée ni à un compte de la fiche ni à une commande Odoo est « non vérifiée ».
const ETATS_A_VERIFIER = new Set(["incertaine", "refusee", "non_envoyee", "expiree", "annulee"]);
const itemsDe = (o) => { let it = o?.items; if (typeof it === "string") { try { it = JSON.parse(it); } catch { it = []; } } return Array.isArray(it) ? it : []; };
const parseJson = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return null; } };
async function tachesRelais(ids, d) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const or = ids.slice(i, i + 40).map(id => `key.like.pmlr:tache:${id}*`).join(",");
    const rows = (await d.sb(`kv_store?or=(${enc(or)})&select=key,value`).catch(() => [])) || [];
    for (const r of rows) { const t = parseJson(r.value); if (t?.orderId) { if (!out.has(String(t.orderId))) out.set(String(t.orderId), []); out.get(String(t.orderId)).push(t); } }
  }
  return out;
}
// état lisible d'une commande du site (le détail technique n'est jamais donné)
function etatSite(o, taches, dansOdoo, verifiee) {
  const its = itemsDe(o);
  if (dansOdoo.length) return { code: "dans_odoo", libelle: `Transmise et enregistrée dans notre système de préparation (${dansOdoo.join(", ")})` };
  if (!verifiee) return { code: "non_verifiee", libelle: "Commande enregistrée sur le site sans être rattachée à un compte de la pharmacie : Elixir doit la vérifier" };
  if (o.source === "ulabs") return { code: "campagne", libelle: "Commande de campagne enregistrée : traitée par Elixir avec la campagne" };
  if (o.source === "justificatif") return { code: "justificatif", libelle: "Commande sur justificatif laboratoire : suivi dans « Commande labo sur justificatif »" };
  const etats = taches.map(t => t.etat);
  const envoyees = its.length > 0 && its.every(it => it?.synced_at || it?.handled_at);
  if (etats.some(e => e === "a_envoyer" || e === "prise")) return { code: "en_transmission", libelle: "En cours de transmission à notre système de préparation" };
  if (envoyees || o.processed) return { code: "transmise", libelle: "Transmise ; elle peut mettre jusqu'à 2 heures à apparaître dans notre système de préparation" };
  if (etats.some(e => ETATS_A_VERIFIER.has(e))) return { code: "a_verifier", libelle: "Elixir doit vérifier cette commande" };
  return { code: "recue", libelle: "Reçue sur le site, en attente de transmission" };
}
const cipDe = (v) => { const s = String(v ?? "").trim(); return /^\d{7,13}$/.test(s) ? s : null; };
// noms des produits relus dans Odoo (catalogue), jamais le libellé écrit dans la commande du site
async function nomsProduits(cips, d) {
  const codes = [...new Set(cips.filter(c => /^\d{13}$/.test(String(c || ""))))].slice(0, 30);
  if (!codes.length) return new Map();
  const rows = await lire(d, "product.product", "search_read", [[["default_code", "in", codes], ["company_id", "in", [COMPANY_ID, false]]]],
    { fields: ["default_code", "name"], limit: 60, context: { active_test: false } });
  return new Map(rows.map(r => [r.default_code, tronquer(r.name, 120)]));
}
// commandes du site de la période, avec leur lien éventuel vers les commandes Odoo (pml_order_ref = id, idP2…)
// noms : relit dans Odoo le nom des produits (détail d'UNE commande seulement)
export async function commandesSite(ctx, { debut, fin, id = null, noms = false }, deps = {}) {
  const d = depsParDefaut(deps);
  const P = fiche(ctx);
  if (!ctx.cip) return [];
  const filtre = id ? `id=eq.${enc(id)}` : `date=gte.${enc(minuitParisIso(debut))}&date=lt.${enc(minuitParisIso(jourPlus(fin, 1)))}`;
  const rows = (await d.sb(`elixir_orders?pharmacy_cip=eq.${enc(ctx.cip)}&${filtre}&select=id,date,items,processed,source,entered_by,pharmacy_email&order=date.desc&limit=100`)) || [];
  if (!rows.length) return [];
  // comptes du site de la fiche (anciennes adresses comprises : une commande passée avant un changement d'adresse reste la sienne)
  const comptes = new Set(((await d.sb(`elixir_pharmacies?odoo_id=eq.${P}&select=email`)) || []).map(r => minuscule(r.email)).filter(Boolean));
  const ids = rows.map(o => String(o.id));
  const taches = await tachesRelais(ids, d);
  // lien Odoo par la ligne de commande (référence PharmaML recopiée par le connecteur)
  const refs = new Set();
  for (const o of rows) { refs.add(String(o.id)); for (const it of itemsDe(o)) if (it?.synced_ref) refs.add(String(it.synced_ref)); for (const t of taches.get(String(o.id)) || []) if (t.ref) refs.add(String(t.ref)); }
  const refsSite = [...refs].filter(r => REF_SITE.test(r));
  const liens = refsSite.length ? await lire(d, "sale.order.line", "search_read", [[...domaineLignesCommande(ctx), ["pml_order_ref", "in", refsSite]]],
    { fields: ["order_id", "pml_order_ref"], limit: 2000 }) : [];
  const versOdoo = new Map();
  for (const l of liens) { const m = String(l.pml_order_ref || "").match(REF_SITE); if (m) { if (!versOdoo.has(m[1])) versOdoo.set(m[1], new Map()); versOdoo.get(m[1]).set(l.order_id[0], nomM2o(l.order_id)); } }
  const sorties = rows.map(o => {
    const dansOdoo = [...(versOdoo.get(String(o.id))?.values() || [])].filter(Boolean);
    const verifiee = dansOdoo.length > 0 || comptes.has(minuscule(o.pharmacy_email));
    const e = etatSite(o, taches.get(String(o.id)) || [], dansOdoo, verifiee);
    const dt = o.date && !Number.isNaN(Date.parse(o.date)) ? new Date(o.date) : null;
    return { reference_site: String(o.id), date: dt ? jourParis(dt) : null, heure: dt ? heureParis(dt) : null,
      origine: o.entered_by && verifiee ? "saisie" : "site", lignes: itemsDe(o).length, etat: e.code, libelle: e.libelle, verifiee, commandes_odoo: dansOdoo,
      ids_odoo: [...(versOdoo.get(String(o.id))?.keys() || [])],
      produits: itemsDe(o).slice(0, 30).map(it => ({ produit: null, cip: cipDe(it?.cip), commande: Math.max(0, parseInt(it?.qty) || 0) })) };
  });
  if (noms) {
    const n = await nomsProduits(sorties.filter(s => s.verifiee).flatMap(s => s.produits.map(x => x.cip)), d).catch(() => new Map());
    for (const s of sorties) if (s.verifiee) for (const x of s.produits) x.produit = n.get(x.cip) || null;
  }
  return sorties;
}

// ── Détail d'une commande (S…, livraison EP/OUT/…, ou référence du site) ──
export async function detailCommande(ctx, reference, deps = {}) {
  const d = depsParDefaut(deps);
  const ref = normaliserReference(reference);
  const dom = [...domaineCommandes(ctx), ["state", "in", ["sale", "done", "cancel"]]];
  let commandes = [], site = null;
  if (/^S\d{3,}$/.test(ref)) commandes = await lire(d, "sale.order", "search_read", [[...dom, ["name", "=", ref]]], { fields: CHAMPS_COMMANDE, limit: 1 });
  else if (/^EP\/OUT\/\d+$/.test(ref)) {
    const p = await lire(d, "stock.picking", "search_read", [[...domaineLivraisons(ctx), ["name", "=", ref]]], { fields: ["sale_id"], limit: 1 });
    const sid = p[0]?.sale_id?.[0];
    if (sid) commandes = await lire(d, "sale.order", "search_read", [[...dom, ["id", "=", sid]]], { fields: CHAMPS_COMMANDE, limit: 1 });
  } else if (REF_SITE.test(ref)) {
    const id = ref.match(REF_SITE)[1];
    const l = await lire(d, "sale.order.line", "search_read", [[...domaineLignesCommande(ctx), ["pml_order_ref", "=like", `${id}%`]]], { fields: ["order_id"], limit: 500 });
    const ids = [...new Set(l.map(x => x.order_id?.[0]).filter(Boolean))];
    if (ids.length) commandes = await lire(d, "sale.order", "search_read", [[...dom, ["id", "in", ids]]], { fields: CHAMPS_COMMANDE, order: "date_order asc", limit: 3 });
    [site] = await commandesSite(ctx, { id, noms: !ids.length }, d);
    site = site || null;
  } else return null;
  if (!commandes.length && !site) return null;
  const details = [];
  for (const so of commandes) details.push(await detailOdoo(ctx, so, d));
  return { commandes: details, site };
}
async function detailOdoo(ctx, so, d) {
  const lignes = await lignesDe(ctx, [so.id], d);
  const livraisons = so.picking_ids?.length ? await lire(d, "stock.picking", "search_read", [[...domaineLivraisons(ctx), ["id", "in", so.picking_ids]]],
    { fields: ["name", "state", "date_done", "picking_type_code", "return_id"], order: "id asc" }) : [];
  const sorties = livraisons.filter(p => p.picking_type_code === "outgoing" && !p.return_id);
  const faites = sorties.filter(p => p.state === "done");
  const retours = livraisons.filter(p => p.return_id || p.picking_type_code === "incoming");
  // lots et péremptions : seulement une fois la livraison validée (réservés avant, ils peuvent encore changer)
  const lots = faites.length ? await lire(d, "stock.move.line", "search_read", [[...domaineMouvements(ctx), ["picking_id", "in", faites.map(p => p.id)],
    ["state", "=", "done"]]], { fields: ["product_id", "lot_id", "expiration_date", "quantity"], order: "id asc", limit: 500 }) : [];
  const { factures, avoirs } = pieces2(await facturesDe(ctx, so.invoice_ids || [], d));
  const sortieFaite = faites.length > 0;
  const { parLigne } = sortieFaite ? await sortiesDe(ctx, lignes, d) : { parLigne: null };
  const zero = entierementZero(lignes);
  const derniere = faites.map(p => p.date_done).filter(Boolean).sort().pop() || null;
  const t = tourneeDe(so.x_studio_tourne);
  const prep = so.state !== "cancel" && !zero && (sortieFaite || so.delivery_status === "started" || so.pharmaml_lock_status === "closed"
    || so.x_studio_statut_prparation === "🟡 En cours" || sorties.some(p => p.state === "assigned"));
  const partielle = sortieFaite && sorties.some(p => p.state !== "done" && p.state !== "cancel");
  const dt = dateOdoo(so.date_order);
  return {
    reference: so.name, date: dt ? jourParis(dt) : null, heure: dt ? heureParis(dt) : null, origine: origineDe(so, lignes),
    commande_site_id: refSiteDe(lignes), etat: etatCommande(so, lignes, [...factures, ...avoirs], derniere), entierement_non_servie: zero,
    etapes: [
      { cle: "recue", libelle: "Reçue", date: dt ? jourParis(dt) : null, fait: true },
      { cle: "preparation", libelle: "En préparation", date: null, fait: prep },
      { cle: "sortie", libelle: sortieFaite ? `${partielle ? "Partiellement sortie" : "Sortie"} de l'entrepôt le ${jourFr(jourOdoo(derniere))}${t ? ` (${t})` : ""}` : "Sortie de l'entrepôt",
        date: sortieFaite ? jourOdoo(derniere) : null, fait: sortieFaite },
      { cle: "facturee", libelle: factures.length ? `Facturée (${factures.map(f => f.name).join(", ")})` : "Facturée",
        date: factures[0]?.invoice_date || null, fait: factures.length > 0 },
    ],
    lignes: lignes.map(l => ({ ...produitSansId(l.product_id), ...quantitesLigne(l, sortieFaite, parLigne) })),
    lots: lots.filter(l => l.lot_id).map(l => ({ ...produitSansId(l.product_id), lot: tronquer(nomM2o(l.lot_id) || "", 40), peremption: l.expiration_date ? jourOdoo(l.expiration_date) : null,
      quantite: Number(l.quantity) || 0 })),
    factures: factures.map(f => f.name), avoirs: avoirs.map(f => f.name),
    retours: retours.map(p => ({ reference: p.name, date: p.date_done ? jourOdoo(p.date_done) : null, etat: p.state === "done" ? "Retour reçu à l'entrepôt" : p.state === "cancel" ? "Retour annulé" : "Retour en cours" })),
  };
}
const produitSansId = (m2o) => { const { cip, produit } = produitDe(m2o); return { produit, cip }; };

// ═══ Demandes de retour ═════════════════════════════════════════════════
// Combinaisons motif → souhaits de l'application de réclamation (entrepot/bundle.js) ; « non_precise » toujours admis
export const SOUHAITS_PAR_MOTIF = {
  produit_manquant: ["renvoi", "avoir"], caisse_manquante: ["renvoi", "avoir"], quantite_incorrecte: ["renvoi", "avoir"], produit_casse: ["renvoi", "avoir"],
  commande_non_recue: ["renvoi", "avoir"], erreur_produit: ["garde", "reprise"], mauvaise_caisse: ["reprise", "garde"],
  retour_erreur_pharmacie: ["avoir", "reprise"], dlu_courte: ["avoir", "remise", "garde"], ecart_facture: ["avoir", "renvoi"],
  reliquat: ["recevoir_reliquat", "annule_reliquat"], mauvaise_commande_recue: [], autre: [],
};
export const combinaisonValide = (motif, souhait) => souhait === "non_precise" || (SOUHAITS_PAR_MOTIF[motif] || []).includes(souhait);
// motifs où la pharmacie renvoie physiquement la marchandise : le lot doit être connu
const LOT_REQUIS = new Set(["retour_erreur_pharmacie", "dlu_courte", "produit_casse"]);
export const DELAI_RETOUR_JOURS = 10;
export const MSG_DOC_INCONNU = "Aucun document de ce numéro pour votre pharmacie.";

// Document cité → commandes, livraisons sortantes, factures (toujours dans le périmètre de la fiche)
async function resoudreDocument(ctx, reference, d) {
  const ref = normaliserReference(reference);
  const domC = [...domaineCommandes(ctx), ["state", "in", ["sale", "done"]]];
  const champsC = ["name", "picking_ids", "invoice_ids"];
  let commandes = [], factureIds = null, pickIds = null, numero = ref;
  if (/^R?INV\/?\d/.test(ref) || /^\d{4}\/\d{1,6}$/.test(ref)) {
    // numéro de facture, même sans zéros de tête ni année (« INV 123 ») : un seul document doit correspondre
    const c = conditionNumero(ref);
    const ms = c ? await lire(d, "account.move", "search_read", [[...domaineFactures(ctx), c]], { fields: ["name", "invoice_origin"], order: "invoice_date desc", limit: 2 }) : [];
    if (!ms.length) return null;
    if (ms.length > 1) return { ambigu: true };
    const m = ms[0];
    numero = m.name;
    factureIds = [m.id];
    const noms = String(m.invoice_origin || "").split(",").map(x => x.trim()).filter(x => /^S\d+$/.test(x));
    commandes = noms.length ? await lire(d, "sale.order", "search_read", [[...domC, ["name", "in", noms]]], { fields: champsC }) : [];
  } else if (/^S\d{3,}$/.test(ref)) commandes = await lire(d, "sale.order", "search_read", [[...domC, ["name", "=", ref]]], { fields: champsC, limit: 1 });
  else if (/^EP\/OUT\/\d+$/.test(ref)) {
    const [p] = await lire(d, "stock.picking", "search_read", [[...domaineLivraisons(ctx), ["name", "=", ref], ["picking_type_code", "=", "outgoing"]]], { fields: ["sale_id"], limit: 1 });
    if (!p) return null;
    pickIds = [p.id];
    if (p.sale_id?.[0]) commandes = await lire(d, "sale.order", "search_read", [[...domC, ["id", "=", p.sale_id[0]]]], { fields: champsC, limit: 1 });
  } else if (REF_SITE.test(ref)) {
    const l = await lire(d, "sale.order.line", "search_read", [[...domaineLignesCommande(ctx), ["pml_order_ref", "=like", `${ref.match(REF_SITE)[1]}%`]]], { fields: ["order_id"], limit: 500 });
    const ids = [...new Set(l.map(x => x.order_id?.[0]).filter(Boolean))];
    if (ids.length) commandes = await lire(d, "sale.order", "search_read", [[...domC, ["id", "in", ids]]], { fields: champsC });
  } else return null;
  if (!commandes.length && !pickIds) return null;
  const ids = pickIds || [...new Set(commandes.flatMap(c => c.picking_ids || []))];
  const sorties = ids.length ? await lire(d, "stock.picking", "search_read", [[...domaineLivraisons(ctx), ["id", "in", ids], ["picking_type_code", "=", "outgoing"],
    ["return_id", "=", false]]], { fields: ["name", "state", "date_done"], order: "id asc" }) : [];
  if (!factureIds) factureIds = (await facturesDe(ctx, [...new Set(commandes.flatMap(c => c.invoice_ids || []))], d)).filter(f => f.move_type === "out_invoice").map(f => f.id);
  return { numero, commandes, sorties, faites: sorties.filter(p => p.state === "done"), factureIds };
}

// Quantités livrées (lignes de mouvement validées) et déjà retournées (retours non annulés), par produit et par lot
async function quantitesLivrees(ctx, doc, d) {
  const produits = new Map();
  const prod = (m2o) => { const id = m2o?.[0]; if (!produits.has(id)) produits.set(id, { ...produitDe(m2o), livre: 0, retourne: 0, lots: new Map(), pickings: new Set() }); return produits.get(id); };
  const faites = doc.faites.map(p => p.id);
  if (!faites.length) return produits;
  const ml = await lire(d, "stock.move.line", "search_read", [[...domaineMouvements(ctx), ["picking_id", "in", faites], ["state", "=", "done"]]],
    { fields: ["product_id", "lot_id", "expiration_date", "quantity", "picking_id"], order: "id asc", limit: 5000 });
  for (const l of ml) {
    const p = prod(l.product_id), q = Number(l.quantity) || 0;
    p.livre += q; p.pickings.add(l.picking_id?.[0]);
    if (l.lot_id) {
      const k = l.lot_id[0];
      if (!p.lots.has(k)) p.lots.set(k, { lot_id: k, lot: tronquer(nomM2o(l.lot_id) || "", 40), peremption: l.expiration_date ? jourOdoo(l.expiration_date) : null, livre: 0, retourne: 0 });
      p.lots.get(k).livre += q;
    }
  }
  // retours déjà faits ou en cours : mouvements dont le mouvement d'origine sort de ces livraisons (origin_returned_move_id).
  // Compter par réception (stock.picking.return_id) manquerait les reliquats de retour, où Odoo ne recopie pas return_id.
  const mv = await lire(d, "stock.move", "search_read", [[...domaineMouvements(ctx), ["origin_returned_move_id.picking_id", "in", faites], ["state", "!=", "cancel"]]],
    { fields: ["product_id", "product_uom_qty", "quantity", "state"], limit: 5000 });
  for (const m of mv) prod(m.product_id).retourne += m.state === "done" ? Number(m.quantity) || 0 : Number(m.product_uom_qty) || 0;
  const faits = mv.filter(m => m.state === "done").map(m => m.id);
  if (faits.length) {
    const mlr = await lire(d, "stock.move.line", "search_read", [[...domaineMouvements(ctx), ["move_id", "in", faits], ["state", "=", "done"]]],
      { fields: ["product_id", "lot_id", "quantity"], limit: 5000 });
    for (const l of mlr) { const lot = l.lot_id && prod(l.product_id).lots.get(l.lot_id[0]); if (lot) lot.retourne += Number(l.quantity) || 0; }
  }
  return produits;
}
// Reliquat : quantité commandée jamais sortie de l'entrepôt, par produit (commandé − sorti, retours non déduits)
async function quantitesNonLivrees(ctx, doc, d) {
  const produits = new Map();
  const lignes = await lignesDe(ctx, doc.commandes.map(c => c.id), d);
  const { parLigne } = await sortiesDe(ctx, lignes, d);
  for (const l of lignes) {
    const id = l.product_id?.[0];
    if (!produits.has(id)) produits.set(id, { ...produitDe(l.product_id), livre: 0, retourne: 0, lots: new Map(), pickings: new Set() });
    const q = quantitesLigne(l, true, parLigne);
    produits.get(id).livre += Math.max(0, q.commande - q.servi);   // « livre » = disponible pour la demande (non livré)
  }
  return produits;
}
// produit demandé (CIP13, libellé, ou product_id à la revalidation) parmi ceux du document
function trouverProduit(spec, produits) {
  const liste = [...produits.values()].filter(p => p.livre > 0 || p.retourne > 0);
  if (spec.product_id) return { p: liste.find(p => p.product_id === Number(spec.product_id)) || null };
  const s = String(spec.produit || "").trim();
  if (/^\d{7,13}$/.test(s)) return { p: liste.find(p => p.cip === s || (s.length === 7 && p.cip?.slice(5, 12) === s)) || null };
  const n = normaliser(s);
  if (!n) return { p: null };
  const mots = n.split(" ").filter(Boolean);
  const cands = liste.filter(p => { const pn = normaliser(p.produit); return pn.includes(n) || mots.every(m => pn.split(" ").includes(m) || pn.includes(m)); });
  if (cands.length === 1) return { p: cands[0] };
  return { p: null, ambigus: cands.slice(0, 5).map(c => ({ produit: c.produit, cip: c.cip })) };
}

// Construit (ou recontrôle) un brouillon de retour : document → livraison validée, lignes, lots,
// quantité ≤ livrée − déjà retournée (reliquat : ≤ commandée − livrée), date de sortie d'entrepôt (heure de Paris)
// demande = { reference_document, motif, souhait, commentaire, lignes: [{ produit | product_id, lot | lot_id, quantite }] }
// → { ok: true, brouillon } | { ok: false, raison, a_preciser? }
export async function construireRetour(ctx, demande, deps = {}) {
  const d = depsParDefaut(deps);
  const { motif, souhait } = demande;
  if (!combinaisonValide(motif, souhait)) return { ok: false, raison: "Ce souhait ne correspond pas à ce motif." };
  const doc = await resoudreDocument(ctx, demande.reference_document, d);
  if (!doc) return { ok: false, raison: MSG_DOC_INCONNU };
  if (doc.ambigu) return { ok: false, raison: "Plusieurs documents portent ce numéro : indiquez le numéro complet, avec l'année (par exemple INV/2026/00123)." };
  const reliquat = motif === "reliquat";
  // reliquat compris : tant qu'une livraison attend sa préparation, rien n'est encore « non livré » (seule exception : une
  // commande sans livraison en cours, entièrement non servie ou livraison annulée)
  if (!doc.faites.length && (!reliquat || doc.sorties.some(p => p.state !== "cancel"))) return { ok: false, raison: "Cette commande n'est pas encore sortie de l'entrepôt : aucune demande ne peut être préparée sur ce document pour l'instant." };
  const produits = reliquat ? await quantitesNonLivrees(ctx, doc, d) : await quantitesLivrees(ctx, doc, d);
  const lignes = [], a_preciser = [];
  for (const spec of demande.lignes || []) {
    const { p, ambigus } = trouverProduit(spec, produits);
    if (!p) return ambigus?.length ? { ok: false, raison: `Plusieurs produits du document correspondent à « ${tronquer(spec.produit, 60)} » : précisez lequel (CIP13).`, a_preciser: ambigus }
      : { ok: false, raison: `Le produit « ${tronquer(spec.produit || spec.product_id, 60)} » ne figure pas sur ce document${reliquat ? " parmi les quantités non livrées" : " parmi les produits sortis de l'entrepôt"}.` };
    let lot = null;
    if (!reliquat) {
      if (spec.lot_id) lot = p.lots.get(Number(spec.lot_id)) || null;
      else if (spec.lot) lot = [...p.lots.values()].find(l => normaliserLot(l.lot) === normaliserLot(spec.lot)) || null;
      if ((spec.lot_id || spec.lot) && !lot) return { ok: false, raison: `Le lot « ${tronquer(spec.lot || spec.lot_id, 40)} » n'a pas été livré pour ${p.produit} sur ce document.`,
        a_preciser: [{ produit: p.produit, cip: p.cip, lots: [...p.lots.values()].map(l => ({ lot: l.lot, peremption: l.peremption, quantite: l.livre })) }] };
      if (!lot && p.lots.size === 1) lot = [...p.lots.values()][0];
      if (!lot && p.lots.size > 1 && LOT_REQUIS.has(motif)) {
        a_preciser.push({ produit: p.produit, cip: p.cip, lots: [...p.lots.values()].map(l => ({ lot: l.lot, peremption: l.peremption, quantite: l.livre })) });
        continue;
      }
    }
    const maxProduit = Math.max(0, p.livre - p.retourne);
    const max = lot ? Math.min(maxProduit, Math.max(0, lot.livre - lot.retourne)) : maxProduit;
    lignes.push({ p, lot, quantite: Number(spec.quantite) || 0, max });
  }
  if (a_preciser.length) return { ok: false, raison: "Plusieurs lots ont été livrés : précisez le lot de chaque produit retourné.", a_preciser };
  if (!lignes.length) return { ok: false, raison: "Indiquez au moins un produit et sa quantité." };
  // contrôle global (même produit ou même lot sur plusieurs lignes)
  const parProduit = new Map(), parLot = new Map();
  for (const l of lignes) {
    if (!(l.quantite > 0)) return { ok: false, raison: `Quantité invalide pour ${l.p.produit}.` };
    parProduit.set(l.p.product_id, (parProduit.get(l.p.product_id) || 0) + l.quantite);
    if (l.lot) parLot.set(`${l.p.product_id}:${l.lot.lot_id}`, (parLot.get(`${l.p.product_id}:${l.lot.lot_id}`) || 0) + l.quantite);
  }
  for (const l of lignes) {
    const maxP = Math.max(0, l.p.livre - l.p.retourne);
    const maxL = l.lot ? Math.max(0, l.lot.livre - l.lot.retourne) : Infinity;
    if (parProduit.get(l.p.product_id) > maxP || (l.lot && parLot.get(`${l.p.product_id}:${l.lot.lot_id}`) > maxL)) {
      const borne = Math.min(maxP, maxL);
      return { ok: false, raison: borne > 0
        ? `Quantité trop élevée pour ${l.p.produit}${l.lot ? ` (lot ${l.lot.lot})` : ""} : ${borne} au plus (${reliquat ? `non livré : ${l.p.livre}` : `sorti de l'entrepôt : ${l.lot ? l.lot.livre : l.p.livre}, déjà retourné : ${l.lot ? l.lot.retourne : l.p.retourne}`}).`
        : `Rien ne reste à ${reliquat ? "réclamer" : "retourner"} pour ${l.p.produit}${l.lot ? ` (lot ${l.lot.lot})` : ""} sur ce document.` };
    }
  }
  // livraison retenue : celle (validée) qui porte les produits demandés, la plus récente
  const pick = new Set(lignes.flatMap(l => [...l.p.pickings]));
  const utiles = doc.faites.filter(p => pick.has(p.id));
  const sorties = (utiles.length ? utiles : doc.faites).slice().sort((a, b) => String(a.date_done).localeCompare(String(b.date_done)));
  const derniere = sorties[sorties.length - 1] || null;
  const date_sortie = derniere?.date_done ? jourOdoo(derniere.date_done) : null;
  // délai : livraison = lendemain de la sortie d'entrepôt (décision 6, à confirmer) ; information seulement, jamais de refus
  const aujourdhui = jourParis(d.maintenant());
  const limite = date_sortie ? jourPlus(jourPlus(date_sortie, 1), DELAI_RETOUR_JOURS) : null;
  const brouillon = {
    reference_document: doc.numero,
    document: { numero: doc.numero, date_sortie, picking_id: derniere?.id || null, picking_ids: sorties.map(p => p.id), facture_ids: doc.factureIds || [] },
    lignes: lignes.map(l => ({ produit: l.p.produit, cip: l.p.cip, product_id: l.p.product_id, lot: l.lot?.lot || null, lot_id: l.lot?.lot_id || null,
      peremption: l.lot?.peremption || null, quantite: l.quantite, quantite_max: l.max })),
    motif, souhait, commentaire: demande.commentaire ? tronquer(demande.commentaire, 1000) : null,
    hors_delai: !!(limite && aujourdhui > limite),
    limite_retour: limite,
  };
  return { ok: true, brouillon };
}

// Recontrôle à la confirmation (lots 2-3-5) : relit Odoo avec les domaines de propriété et revérifie
// quantité ≤ livrée − déjà retournée. → { ok: true, brouillon } (lots, quantités max, date de sortie rafraîchis)
// | { ok: false, raison (texte pour la pharmacie), temporaire? (Odoo injoignable : réessayer, ne pas refuser) }
export async function revaliderRetour(ctx, brouillon, deps = {}) {
  try {
    if (!brouillon || !Array.isArray(brouillon.lignes) || !brouillon.lignes.length) return { ok: false, raison: "Demande illisible : préparez-la de nouveau." };
    const r = await construireRetour(ctx, {
      reference_document: brouillon.reference_document, motif: brouillon.motif, souhait: brouillon.souhait, commentaire: brouillon.commentaire,
      lignes: brouillon.lignes.map(l => ({ product_id: l.product_id, lot_id: l.lot_id || null, produit: l.cip || l.produit, quantite: l.quantite })),
    }, deps);
    return r.ok ? { ok: true, brouillon: r.brouillon } : { ok: false, raison: r.raison };
  } catch {
    return { ok: false, temporaire: true, raison: "Vérification impossible pour le moment : réessayez dans quelques instants." };
  }
}
