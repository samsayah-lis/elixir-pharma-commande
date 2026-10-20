// ── Accueil : les mises en avant de Zineb (clé ec_config « accueil_vedettes », docs/accueil.md § 7) — JS pur ──
// Validation (mêmes règles que src/components/accueil/vedettes.js, recopiées comme applyTiers : les fonctions
// n'importent pas le code du navigateur ; scripts/test-vedettes.mjs compare les deux), visibilité au moment présent
// (dates de Paris, jours inclus ; produit : prix, stock, menu de rangement, justificatif, campagne ; menu : actif, pas
// échu, pas masqué, non vide), et réponse du GET accueil-offres : vedettes visibles (5 au plus par emplacement) pour
// tous, états de toutes les mises en avant et vérification d'un brouillon (?verifier=) pour l'admin seulement.
import { offreDynamique, premierMenu, jourParis } from "./_accueil-selection.js";

export const MAX_ITEMS = 20, MAX_VISIBLES = 5;
const LIMITES = { titre: 60, accroche: 140, badge: 24 };
const EMPLACEMENTS = ["vitrine", "grille"];
const RE_ID = /^mea_[a-z0-9_]{4,32}$/, RE_CIP = /^\d{8,14}$/, RE_MENU = /^[\w-]{1,40}$/, RE_COULEUR = /^#[0-9a-f]{6}$/;
const RE_IMAGE = /^https:\/\/[^\s"'()<>\\]+$/;
export const jourValide = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const jour10 = (s) => (jourValide(String(s || "").slice(0, 10)) ? String(s).slice(0, 10) : null);
export const finEffective = (dateFin, finMenu) => [jour10(dateFin), jour10(finMenu)].filter(Boolean).sort()[0] || null;

// ── Validation (copie de verifierVedette / validerVedettes du navigateur) ──
export function verifierVedette(x) {
  if (!x || typeof x !== "object") return { item: null, erreurs: [{ champ: "objet", message: "Mise en avant illisible" }] };
  const t = (k) => String(x[k] ?? "").replace(/\s+/g, " ").trim();
  const c = (k) => (x[k] ? String(x[k]).trim().toLowerCase() : null);
  const it = { id: String(x.id ?? ""), type: x.type, cip: x.type === "produit" ? String(x.cip ?? "").trim() : null, menu_id: x.type === "menu" ? String(x.menu_id ?? "").trim() : null,
    emplacement: x.emplacement, titre: t("titre"), accroche: t("accroche"), badge: t("badge"), date_debut: x.date_debut || null, date_fin: x.date_fin || null,
    ordre: Number.isFinite(Number(x.ordre)) ? Math.round(Number(x.ordre)) : 0, image: x.image ? String(x.image).trim() : null, couleur: c("couleur"), couleur_auto: c("couleur_auto"),
    actif: x.actif !== false, maj: typeof x.maj === "string" ? x.maj.slice(0, 40) : null };
  const e = [];
  const err = (champ, message, long) => e.push({ champ, message, ...(long ? { long: true } : {}) });
  if (!RE_ID.test(it.id)) err("id", "Identifiant invalide");
  if (it.type !== "produit" && it.type !== "menu") err("type", "Type inconnu");
  if (it.type === "produit" && !RE_CIP.test(it.cip)) err("cip", "CIP invalide (8 à 14 chiffres)");
  if (it.type === "menu" && !RE_MENU.test(it.menu_id)) err("menu_id", "Menu promo invalide");
  if (!EMPLACEMENTS.includes(it.emplacement)) err("emplacement", "Emplacement inconnu");
  for (const k of ["date_debut", "date_fin"]) if (it[k] && !jourValide(it[k])) err(k, "Date invalide");
  if (it.date_debut && it.date_fin && jourValide(it.date_debut) && jourValide(it.date_fin) && it.date_fin < it.date_debut) err("date_fin", "La fin précède le début");
  for (const [k, n] of Object.entries(LIMITES)) if (it[k].length > n) err(k, `${n} caractères au plus`, true);
  if (it.image && !(it.image.length <= 500 && RE_IMAGE.test(it.image))) err("image", "Adresse d'image invalide (https://…)");
  for (const k of ["couleur", "couleur_auto"]) if (it[k] && !RE_COULEUR.test(it[k])) err(k, "Couleur invalide");
  return { item: it, erreurs: e };
}
const triPlace = (a, b) => EMPLACEMENTS.indexOf(a.emplacement) - EMPLACEMENTS.indexOf(b.emplacement) || a.ordre - b.ordre;
const cleObjet = (it) => (it.type === "menu" ? `m:${it.menu_id}` : `p:${it.cip}`);
export function validerVedettes(valeur) {
  let v = valeur;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  const src = v && typeof v === "object" ? v : {};
  const ignores = [], vus = new Set(), items = [];
  const lus = (Array.isArray(src.items) ? src.items : []).map((x, i) => ({ ...verifierVedette(x), i }));
  for (const { item, erreurs, i } of lus.filter(r => r.item).sort((a, b) => triPlace(a.item, b.item) || a.i - b.i)) {
    if (erreurs.some(e => !e.long)) { ignores.push({ id: item.id, erreurs }); continue; }
    for (const [k, n] of Object.entries(LIMITES)) item[k] = item[k].slice(0, n);
    if (vus.has(cleObjet(item))) { ignores.push({ id: item.id, erreurs: [{ champ: "doublon", message: "Déjà mis en avant" }] }); continue; }
    if (items.length >= MAX_ITEMS) { ignores.push({ id: item.id, erreurs: [{ champ: "nombre", message: "Au-delà de 20" }] }); continue; }
    vus.add(cleObjet(item)); items.push(item);
  }
  return { conf: { version: 1, repli: src.repli !== false, defilement: src.defilement !== false, items }, ignores };
}
// CIP des produits mis en avant (relus avec le classement : même lot de lectures odoo_catalog / elixir_products)
export const cipsVedettes = (valeur) => validerVedettes(valeur).conf.items.filter(i => i.type === "produit").map(i => i.cip);

// ── Produit : offre au moment présent (règle des diapositives) et motifs qui l'écartent d'une mise en avant ──
// Contrairement à la vitrine des plus commandés : précommande permise (stock sans objet), PV absent permis (produits
// Vaseline), contingentés permis (le panier applique le quota comme partout). Écartés : justificatif labo, campagne, menu
// de rangement masqué, introuvable (ni menu ni catalogue), sans prix, prix anormal, rupture (hors précommande).
// ctx : { catalogue: { cip: ligne odoo_catalog }, curees, menus (contexteMenus), promos (admin_promos), justifs: Set }
export function evaluerProduit(cip, ctx) {
  const cat = (ctx.catalogue || {})[cip];
  const m = premierMenu(cip, ctx.curees, ctx.menus);
  const { offre } = offreDynamique({ cip, nom: cat?.name || "", labo: null }, { cat, curees: ctx.curees, menus: ctx.menus });
  delete offre.popularite;
  const raisons = [];
  if ((ctx.justifs || new Set()).has(cip)) raisons.push("justificatif");
  if (m.campagne) raisons.push("campagne");
  if (m.source === "saisie" && !cat) raisons.push("introuvable");
  if (!(offre.pn > 0)) raisons.push("sans_prix");
  else if (offre.pn < 0.05 || (offre.pv > 0 && offre.pn > offre.pv)) raisons.push("prix_anormal");
  if (m.cache) raisons.push("menu_masque");
  if (!m.sansStock && cat && !cat.in_stock) raisons.push("rupture");
  const promo = m.source === "promo" ? (ctx.promos || []).find(p => `promo_${p?.id}` === m.key) : null;
  return { offre, raisons, finMenu: promo?.endDate || null };
}
// ── Menu : existe, actif, pas échu, pas masqué, au moins un produit à prix ──
export function evaluerMenu(menuId, ctx, aujourdhui) {
  const m = (ctx.promos || []).find(p => String(p?.id) === String(menuId));
  if (!m) return { raisons: ["introuvable"], finMenu: null };
  const raisons = [];
  if (!m.active) raisons.push("menu_inactif");
  if (jour10(m.endDate) && jour10(m.endDate) < aujourdhui) raisons.push("menu_echu");
  if (ctx.menus?.caches?.has(`promo_${m.id}`)) raisons.push("menu_masque");
  if (!(Array.isArray(m.products) ? m.products : []).some(p => parseFloat(String(p?.pn ?? "").replace(",", ".")) > 0)) raisons.push("menu_vide");
  return { raisons, finMenu: m.endDate || null };
}

// ── Toutes les mises en avant au moment présent ──
// → { publiques: { maj, repli, defilement, items (visibles, triées, 5 au plus par emplacement) }, etats: [{ id, statut, detail? }] }
export function evaluerVedettes(valeur, majCle, ctx, maintenant = Date.now()) {
  const aujourdhui = jourParis(maintenant);
  const { conf, ignores } = validerVedettes(valeur);
  const etats = ignores.map(x => ({ id: x.id, statut: "invalide", detail: x.erreurs.map(e => e.message).join(", ") }));
  const items = [], parPlace = { vitrine: 0, grille: 0 };
  for (const it of conf.items) {
    const ev = it.type === "produit" ? evaluerProduit(it.cip, ctx) : evaluerMenu(it.menu_id, ctx, aujourdhui);
    const fin = finEffective(it.date_fin, ev.finMenu);
    // menu échu ou inactif : son motif (plus utile pour l'admin que « terminée ») ; sinon fin effective passée : terminée
    const motifMenu = it.type === "menu" ? ev.raisons[0] : null;
    const statut = !it.actif ? "masquee" : it.date_debut && aujourdhui < it.date_debut ? "programmee" : motifMenu || (fin && aujourdhui > fin ? "terminee"
      : ev.raisons[0] || (parPlace[it.emplacement] >= MAX_VISIBLES ? "au_dela_de_5" : "visible"));
    etats.push({ id: it.id, statut, ...(fin ? { fin } : {}) });
    if (statut !== "visible") continue;
    parPlace[it.emplacement]++;
    items.push({ id: it.id, type: it.type, emplacement: it.emplacement, titre: it.titre, accroche: it.accroche, badge: it.badge, fin, image: it.image,
      couleur: it.couleur, couleur_auto: it.couleur_auto, ...(it.type === "produit" ? { offre: ev.offre } : { menu_id: it.menu_id }) });
  }
  return { publiques: { maj: majCle || null, repli: conf.repli, defilement: conf.defilement, items }, etats };
}
// ?verifier=cip,cip (admin) : brouillon de l'éditeur, 20 CIP au plus, chiffres seulement
export const cipsAVerifier = (q) => [...new Set(String(q || "").split(",").map(s => s.trim()).filter(s => RE_CIP.test(s)))].slice(0, MAX_ITEMS);
export function verification(cips, ctx) {
  const out = {};
  for (const cip of cips) { const { offre, raisons } = evaluerProduit(cip, ctx); out[cip] = { offre, raisons }; }
  return out;
}
