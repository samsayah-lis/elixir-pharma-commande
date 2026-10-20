// ── Accueil : mises en avant « Un outil du site » (type « outil », docs/accueil.md § 7.8) — lectures et chiffres vivants ──
// Registre fermé (OUTILS_MEA, recopié de src/components/accueil/rubriques.js ; FAUTEUILS, recopié de LINES de
// src/wheelchair-logic.js : les fonctions n'importent pas le code du navigateur, scripts/test-accueil-outils.mjs compare
// les copies, comme applyTiers). Le SERVEUR calcule les chiffres ; le navigateur ne fait que les formater et appliquer
// les règles propres à chaque pharmacie (rubrique ouvrable, accès aux Commandes groupées). Champ public « chiffres » :
// jamais de quantité en stock (ni available, ni lot), jamais de CIP ni de nom de produit ; réservés à l'admin : en_menu,
// honnetes (outils_etat).
//  • saisie : comptes du catalogue (références, références en stock, mise à jour), calculés par la fonction planifiée
//    (kv « accueil:outils ») ; jamais masquée : sans chiffres récents (36 h), texte seul.
//  • peremption : règle de la page (ShortExpiry.jsx, odoo-catalog.js expiry_months=4) : en stock, péremption entre J+30
//    et le dernier jour du 4e mois qui suit (UTC, comme Netlify) ; remise propre au produit, sinon 50 % (20 % dès 500 €).
//    nb = toutes les lignes (ce que la page montre) ; « dès » et « jusqu'à » sur le sous-ensemble honnête seulement :
//    rangé dans aucun menu, campagne ni menu promo actif (sinon le panier le facture au prix du menu : défaut existant
//    d'addItemToCart, zone protégée, lot séparé ; sections ajoutées dans l'admin comprises : display_config.customSections),
//    moins cher que le prix habituel du site, au moins 0,05 €. Lectures gardées 5 min par instance (clé : jour de Paris et
//    fenêtre) ; fenêtre recalculée à chaque évaluation.
// Délai (GET) : chaque lecture d'outil est bornée (delaiMs) : au-delà, seul cet outil passe en donnees_indisponibles, la
// réponse de l'accueil part sans l'attendre (une lecture finie plus tard reste gardée 5 min : elle est complète).
//  • fauteuil, transfert : correspondance code fournisseur → CIP (plus ancien d'abord) calculée par la fonction planifiée
//    (copie en lecture seule de supplier-code-refs.cipsByCode), sinon CIP de repli (clé absente ou correspondance pas
//    encore calculée : signalé à l'admin, admin.correspondance) ; kv illisible : donnees_indisponibles (jamais le repli,
//    qui sous-compterait les largeurs) ; prix et stock relus à chaque GET (9 CIP) : par taille, la première référence en
//    stock donne le prix (priceOf de WheelchairOrder).
//  • justificatif : labos dont site !== false (comme lab-justif?action=products), médicaments = marques distinctes.
//  • groupees : aucune lecture (accès et opérations ouvertes : par pharmacie, dans le navigateur) → selon_pharmacie.
// Aucune écriture ici (la fonction planifiée écrit « accueil:outils »).
import { COMPANY_ID } from "./_odoo-rpc.js";
import { premierMenu, prixSaisie, jourParis } from "./_accueil-selection.js";

export const OUTILS_MEA = ["saisie", "peremption", "fauteuil", "transfert", "justificatif", "groupees"];
export const FAUTEUILS = {
  fauteuil: { model: "Invacare Action 2NG", sizes: [40.5, 43, 45.5, 48],
    codes: { "40.5": "BR1538205", "43": "BR1538206", "45.5": "BR1538207", "48": "BR1538212" },
    fallback: { "40.5": "3662050045614", "43": "3662050045638", "45.5": "3662050045652", "48": "3662050045676" } },
  transfert: { model: "Invacare Transit Lite Action 2NG", sizes: [43, 45.5],
    codes: { "43": "BR1685838", "45.5": "BR1685839" },
    fallback: { "43": "3662050469175", "45.5": "3662050469182" } },
};
export const CLE_OUTILS = "accueil:outils";
export const AGE_MAX_MS = 36 * 3600e3;
export const MEMO_MS = 5 * 60e3;
// « jusqu'à » de la Péremption : remise de la page sur le prix de base (« page », ce que la pharmacie retrouve en cliquant),
// ou économie réelle sur le prix habituel du site (« habituel ») — docs/accueil.md § 7.8
export const REMISE_REFERENCE = "page";

const enc = encodeURIComponent;
const liste = (arr) => `(${arr.map(v => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;
const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => { const v = typeof x === "number" ? x : parseFloat(String(x ?? "").replace(",", ".")); return Number.isFinite(v) ? v : null; };
const jour10 = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10) : null);
const RE_ID = /^mea_[a-z0-9_]{4,32}$/;
const ageMs = (iso, maintenant) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? maintenant - t : Infinity; };
const sizeLabel = (s) => `${String(s).replace(".", ",")} cm`;

// ── Outils à évaluer pour un GET de pharmacie : objets « outil » valides, actifs, dans leurs dates (Paris, jours inclus).
// Un outil programmé, masqué ou terminé n'est pas lu (son statut de date passe en premier).
export function outilsAEvaluer(valeur, aujourdhui) {
  let v = valeur;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  const out = new Set();
  for (const x of Array.isArray(v?.items) ? v.items : []) {
    if (!x || typeof x !== "object" || x.type !== "outil" || x.actif === false) continue;
    const cle = String(x.outil ?? "").trim();
    if (!OUTILS_MEA.includes(cle) || !RE_ID.test(String(x.id ?? "")) || !["vitrine", "grille"].includes(x.emplacement)) continue;
    const debut = x.date_debut ? jour10(x.date_debut) : null, fin = x.date_fin ? jour10(x.date_fin) : null;
    if ((x.date_debut && !debut) || (x.date_fin && !fin) || (debut && aujourdhui < debut) || (fin && aujourdhui > fin)) continue;
    out.add(cle);
  }
  return [...out];
}

// ── Péremption : fenêtre de la page (UTC, comme odoo-catalog.js sur Netlify) ──
export function fenetrePeremption(t) {
  const d = new Date(t);
  return { min: new Date(t + 30 * 864e5).toISOString().slice(0, 10), max: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 5, 0)).toISOString().slice(0, 10) };
}
export const remisePeremption = (ligne, remises) => {
  const propre = num(remises?.[ligne.cip]);
  if (propre != null && propre !== 0) return propre;
  return (num(ligne.list_price) || 0) >= 500 ? 20 : 50;
};
export const prixPeremption = (ligne, remise) => r2((num(ligne.list_price) || 0) * (1 - remise / 100));

let memo = { cle: null, at: 0, valeur: null };
export const oublierMemo = () => { memo = { cle: null, at: 0, valeur: null }; };
// 2 lectures en parallèle (6 colonnes du catalogue, sans lots ni stock exact ; remises), puis les produits curatés de ces
// CIP (lots de 150 en parallèle) ; gardées 5 min par instance
export async function lirePeremption(src) {
  const t = src.maintenant();
  const { min, max } = fenetrePeremption(t);
  const cle = `${jourParis(t)}|${min}|${max}`;
  if (memo.valeur && memo.cle === cle && t - memo.at >= 0 && t - memo.at < MEMO_MS) return memo.valeur;
  const [rows, remises] = await Promise.all([
    src.sb(`odoo_catalog?select=cip,list_price,discounted_price,discount_pct,earliest_expiry,updated_at&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=gte.${min}&earliest_expiry=lte.${max}&order=earliest_expiry.asc&limit=1000`),
    src.sb("expiry_discounts?select=cip,discount_pct"),
  ]);
  const lignes = (Array.isArray(rows) ? rows : []).filter(r => r && r.cip);
  const cips = [...new Set(lignes.map(r => String(r.cip)))];
  const lots = [];
  for (let i = 0; i < cips.length; i += 150) lots.push(src.sb(`elixir_products?active=eq.true&cip=in.${enc(liste(cips.slice(i, i + 150)))}&select=cip,section`));
  const curees = (await Promise.all(lots)).flatMap(x => (Array.isArray(x) ? x : []));
  const valeur = { min, max, rows: lignes, remises: Object.fromEntries((Array.isArray(remises) ? remises : []).filter(r => r?.cip).map(r => [String(r.cip), num(r.discount_pct)])), curees };
  memo = { cle, at: t, valeur };
  return valeur;
}

// ── Fauteuils : CIP à relire (correspondance de la fonction planifiée, sinon CIP de repli) ──
const cipsTaille = (F, taille, plan) => { const c = plan?.fauteuils?.[F.codes[String(taille)]]; return Array.isArray(c) && c.length ? c.map(String) : []; };
export function cipsFauteuils(cles, plan) {
  const out = new Set();
  for (const k of cles) { const F = FAUTEUILS[k]; if (!F) continue; for (const s of F.sizes) { cipsTaille(F, s, plan).forEach(c => out.add(c)); out.add(F.fallback[String(s)]); } }
  return [...out];
}
async function lireFauteuilsCat(src, cles, plan) {
  const cips = cipsFauteuils(cles, plan);
  const rows = cips.length ? await src.sb(`odoo_catalog?cip=in.${enc(liste(cips))}&select=cip,list_price,discounted_price,discount_pct,in_stock`) : [];
  return { parCip: Object.fromEntries((Array.isArray(rows) ? rows : []).filter(r => r?.cip).map(r => [String(r.cip), r])) };
}

// ── Justificatif : labos de la configuration (lireConfig de _lab-justif.js), site !== false ──
const marque = (s) => String(s || "").trim().split(/\s+/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function labosDeConfig(cfg) {
  const out = [];
  for (const lab of Object.values(cfg?.labs || {})) {
    if (!lab || lab.site === false) continue;
    const produits = (Array.isArray(lab.produits) ? lab.produits : []).filter(p => p?.cip);
    const cips = new Set(produits.map(p => String(p.cip)));
    if (!cips.size) continue;
    out.push({ nom: String(lab.nom || lab.key || "Laboratoire"), medicaments: new Set(produits.map(p => marque(p.court || p.nom || p.cip))).size, presentations: cips.size });
  }
  return out;
}

// sections ajoutées dans l'admin (display_config.customSections) : App y range les produits de elixir_products de même
// section, et addItemToCart les facture au prix de la section, comme un menu du catalogue
export const sectionsPerso = (displayConfig) => (Array.isArray(displayConfig?.customSections) ? displayConfig.customSections : [])
  .map(cs => String(cs?.key || "").trim()).filter(Boolean);

// ── Lectures d'un GET : seulement ce que demandent `cles`, tout en parallèle ; une lecture en échec (ou plus lente que
// delaiMs, délai commun à toutes) ne fait échouer que son outil → { plan, fauteuilsCat, peremption, labos, perso }
// (partie : { erreur }). Outils masqués par l'admin : rien à lire, sauf lireMasques (GET de l'admin : l'éditeur montre
// leurs chiffres, prêts quand Zineb les réaffiche).
export async function lireOutils(src, cles, conf = null, { delaiMs = 0, lireMasques = false } = {}) {
  const caches = new Set(lireMasques ? [] : conf?.displayConfig?.hiddenTabs || []);
  const veut = (k) => cles.includes(k) && !caches.has(k);
  const limite = delaiMs > 0 ? Date.now() + delaiMs : 0;
  // la course contre le délai : la lecture continue (et peut finir en mémoire), sa partie vaut { erreur } tout de suite
  const borne = (p) => {
    if (!limite) return p;
    let minuteur;
    const delai = new Promise(ok => { minuteur = setTimeout(() => ok({ erreur: "délai dépassé" }), Math.max(0, limite - Date.now())); });
    return Promise.race([p, delai]).finally(() => clearTimeout(minuteur));
  };
  const garde = (p) => borne(Promise.resolve().then(() => p()).catch(e => ({ erreur: String(e?.message || e).slice(0, 200) })));
  const fauteuils = ["fauteuil", "transfert"].filter(veut);
  const planP = veut("saisie") || fauteuils.length ? garde(async () => (await src.kvGet(CLE_OUTILS)) || null) : Promise.resolve(undefined);
  // kv illisible : pas de repli sur les anciens CIP (les largeurs seraient sous-comptées) → donnees_indisponibles ;
  // clé absente (null) : CIP de repli, signalés à l'admin
  const catP = fauteuils.length ? planP.then(plan => (plan?.erreur ? { erreur: `correspondance illisible (${plan.erreur})` }
    : garde(() => lireFauteuilsCat(src, fauteuils, plan)))) : Promise.resolve(undefined);
  const [plan, fauteuilsCat, peremption, labos] = await Promise.all([planP, catP,
    veut("peremption") ? garde(() => lirePeremption(src)) : undefined,
    veut("justificatif") ? garde(async () => src.labosJustif()) : undefined]);
  return { plan, fauteuilsCat, peremption, labos, perso: sectionsPerso(conf?.displayConfig) };
}

// ── Évaluation d'un outil au moment présent ──
// ctx : { outils (lireOutils), menus (contexteMenus : masqués, menus promo actifs, campagnes) }
// → { raisons, chiffres (publics), admin (outils_etat seulement), selon_pharmacie? }
export function evaluerOutil(cle, ctx = {}, maintenant = Date.now()) {
  const raisons = [];
  if (cle !== "groupees" && ctx.menus?.caches?.has?.(cle)) raisons.push("outil_masque");
  const o = ctx.outils || {};
  const plan = o.plan && !o.plan.erreur ? o.plan : null;
  if (cle === "groupees") return { raisons, chiffres: null, selon_pharmacie: true };
  if (cle === "saisie") {
    const s = plan?.saisie;
    const age = s ? ageMs(s.maj, maintenant) : Infinity;
    const frais = s && Number(s.references) > 0 && age <= AGE_MAX_MS;
    // admin : pourquoi la carte est en texte seul (comptes absents : pas encore calculés ou kv illisible ; anciens : la
    // fonction planifiée ne les met plus à jour)
    const comptes = frais ? "frais" : o.plan?.erreur ? "illisibles" : !(s && Number(s.references) > 0) ? "absents" : "anciens";
    return { raisons, chiffres: frais ? { references: Number(s.references), en_stock: Number(s.en_stock) || 0, maj: s.maj } : null,
      admin: { comptes, ...(Number.isFinite(age) ? { age_h: Math.floor(age / 3600e3) } : {}) } };
  }
  if (cle === "peremption") {
    const P = o.peremption;
    if (!P || P.erreur || !Array.isArray(P.rows)) return { raisons: [...raisons, "donnees_indisponibles"], chiffres: null };
    const { min, max } = fenetrePeremption(maintenant);
    const rows = P.rows.filter(r => { const d = jour10(r.earliest_expiry); return d && d >= min && d <= max; });
    if (!rows.length) return { raisons: [...raisons, "outil_vide"], chiffres: null };
    const maj = rows.map(r => r.updated_at).filter(x => Number.isFinite(Date.parse(x || ""))).sort().at(-1) || null;
    if (ageMs(maj, maintenant) > AGE_MAX_MS) raisons.push("donnees_anciennes");
    let enMenu = 0;
    const honnetes = [];
    const perso = new Set((o.perso || []).map(String));
    const enSectionPerso = (cip) => perso.size > 0 && (P.curees || []).some(c => String(c.cip) === cip && perso.has(String(c.section)));
    for (const r of rows) {
      const m = premierMenu(String(r.cip), P.curees || [], ctx.menus || { libelle: (k) => k, caches: new Set(), promos: [], campagnes: new Set() });
      if (m.source !== "saisie" || enSectionPerso(String(r.cip))) { enMenu++; continue; }
      const remise = remisePeremption(r, P.remises), prix = prixPeremption(r, remise), habituel = prixSaisie(r).pn;
      if (!(prix >= 0.05) || !(habituel > 0) || !(prix < habituel)) continue;
      honnetes.push({ prix, remise: REMISE_REFERENCE === "habituel" ? (1 - prix / habituel) * 100 : remise });
    }
    const jours = rows.map(r => jour10(r.earliest_expiry)).sort();
    const jusqua = honnetes.length ? Math.floor(Math.max(...honnetes.map(h => h.remise))) : null;
    return { raisons, chiffres: { nb: rows.length, des: honnetes.length ? Math.min(...honnetes.map(h => h.prix)) : null, jusqua: jusqua >= 1 ? jusqua : null,
      mois: [jours[0].slice(0, 7), jours.at(-1).slice(0, 7)], maj }, admin: { en_menu: enMenu, honnetes: honnetes.length } };
  }
  if (cle === "fauteuil" || cle === "transfert") {
    const F = FAUTEUILS[cle], cat = o.fauteuilsCat;
    // admin : correspondance code fournisseur → CIP de la fonction planifiée pour toutes les tailles (« odoo »), pour
    // certaines (« partielle »), ou aucune (« repli » : anciens CIP, largeurs peut-être sous-comptées)
    const nCodes = F.sizes.filter(s => cipsTaille(F, s, plan).length).length;
    const admin = { correspondance: nCodes === F.sizes.length ? "odoo" : nCodes ? "partielle" : "repli", calculee_le: plan?.at || null };
    if (!cat || cat.erreur || !cat.parCip) return { raisons: [...raisons, "donnees_indisponibles"], chiffres: null, admin };
    const tailles = [], prix = [];
    for (const s of F.sizes) {
      const parCode = cipsTaille(F, s, plan).map(c => cat.parCip[c]).filter(Boolean);
      const refs = parCode.length ? parCode : [cat.parCip[F.fallback[String(s)]]].filter(Boolean);
      const r = refs.find(x => x.in_stock);
      if (!r) continue;
      const p = num(r.discounted_price) > 0 && num(r.discount_pct) > 0 ? num(r.discounted_price) : num(r.list_price);
      if (!(p > 0)) continue;
      tailles.push(sizeLabel(s)); prix.push(p);
    }
    if (!tailles.length) return { raisons: [...raisons, "rupture"], chiffres: null, admin };
    return { raisons, chiffres: { tailles, des: Math.min(...prix), a: Math.max(...prix), modele: F.model }, admin };
  }
  if (cle === "justificatif") {
    const L = o.labos;
    if (!L || L.erreur || !Array.isArray(L)) return { raisons: [...raisons, "donnees_indisponibles"], chiffres: null };
    const labos = L.filter(l => l && l.presentations > 0);
    const presentations = labos.reduce((s, l) => s + l.presentations, 0);
    if (!presentations) return { raisons: [...raisons, "outil_vide"], chiffres: null };
    return { raisons, chiffres: { labos: labos.map(l => ({ nom: l.nom, medicaments: l.medicaments })), medicaments: labos.reduce((s, l) => s + l.medicaments, 0), presentations } };
  }
  return { raisons: ["introuvable"], chiffres: null };
}

// ── Fonction planifiée (Odoo permis) : correspondance des fauteuils et comptes du catalogue ──
// Copie en lecture seule des deux appels de supplier-code-refs.cipsByCode (fonction protégée, non importée) : codes →
// CIP de toutes les variantes actives des modèles, triés par date d'entrée (plus ancienne d'abord)
const cipOf = (p) => [p.default_code, p.barcode].map(x => String(x || "").trim()).find(x => /^\d{13}$/.test(x)) || null;
export async function correspondanceFauteuils(src) {
  const codes = [...new Set(Object.values(FAUTEUILS).flatMap(F => Object.values(F.codes)))].sort();
  const si = await src.odoo("product.supplierinfo", "search_read", [[["product_code", "in", codes]]],
    { fields: ["product_code", "product_tmpl_id", "product_id"], context: { allowed_company_ids: [COMPANY_ID] } });
  const tids = [...new Set((si || []).map(s => s.product_tmpl_id?.[0]).filter(Boolean))];
  const variants = tids.length ? await src.odoo("product.product", "search_read", [[["product_tmpl_id", "in", tids], ["active", "=", true]]],
    { fields: ["id", "default_code", "barcode", "product_tmpl_id", "create_date"] }) : [];
  const found = Object.fromEntries(codes.map(c => [c, new Map()]));
  for (const s of si || []) for (const v of variants || []) {
    if (v.product_tmpl_id?.[0] !== s.product_tmpl_id?.[0]) continue;
    if (s.product_id && s.product_id[0] !== v.id) continue;
    const cip = cipOf(v);
    if (cip) found[s.product_code]?.set(cip, `${v.create_date || ""}|${String(v.id).padStart(10, "0")}`);
  }
  const out = Object.fromEntries(codes.map(c => [c, [...found[c].entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([cip]) => cip)]).filter(([, l]) => l.length));
  if (!Object.keys(out).length) throw new Error("aucune correspondance code → CIP");   // Odoo vide : la précédente est gardée
  return out;
}
export async function comptesSaisie(src) {
  // dernière mise à jour : lignes datées seulement (en PostgreSQL, « desc » met les NULL en tête : une seule ligne sans
  // date effacerait l'heure, et la Saisie perdrait ses chiffres sans bruit)
  const [references, enStock, derniere] = await Promise.all([src.compter("odoo_catalog?select=cip"), src.compter("odoo_catalog?select=cip&in_stock=eq.true"),
    src.sb("odoo_catalog?select=updated_at&updated_at=not.is.null&order=updated_at.desc.nullslast&limit=1")]);
  if (!(references > 0)) throw new Error("catalogue vide");
  return { references, en_stock: enStock || 0, maj: (Array.isArray(derniere) && derniere[0]?.updated_at) || null };
}
// → { at, fauteuils, saisie } : chaque partie recalculée, ou gardée telle quelle si son calcul échoue ; at = dernier
// calcul réussi (inchangé si rien n'a réussi : rien à écrire). journal : lignes ajoutées (fonction planifiée)
export async function calculerOutilsPlanifies(src, precedent = null, journal = []) {
  const prec = precedent && typeof precedent === "object" ? precedent : {};
  const [f, s] = await Promise.allSettled([correspondanceFauteuils(src), comptesSaisie(src)]);
  const v = { at: f.status === "fulfilled" || s.status === "fulfilled" ? new Date(src.maintenant()).toISOString() : prec.at ?? null,
    fauteuils: f.status === "fulfilled" ? f.value : prec.fauteuils ?? null, saisie: s.status === "fulfilled" ? s.value : prec.saisie ?? null };
  const nCips = new Set(Object.values(v.fauteuils || {}).flat()).size;
  const heure = (iso) => { const t = Date.parse(iso || ""); if (!Number.isFinite(t)) return "?"; const [h, m] = new Date(t).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":"); return `${Number(h)} h ${m}`; };
  journal.push(`outils : ${f.status === "fulfilled" ? `${Object.keys(v.fauteuils).length} codes → ${nCips} CIP` : `correspondance des fauteuils gardée (${String(f.reason?.message || f.reason).slice(0, 120)})`}`
    + ` · ${s.status === "fulfilled" ? `catalogue ${v.saisie.references.toLocaleString("fr-FR")} réf., ${v.saisie.maj ? `màj ${heure(v.saisie.maj)}` : "comptes sans date de mise à jour (Saisie en texte seul)"}`
      : `comptes du catalogue gardés (${String(s.reason?.message || s.reason).slice(0, 120)})`}`);
  return v;
}
