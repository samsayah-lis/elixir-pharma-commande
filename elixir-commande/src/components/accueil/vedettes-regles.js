// ── Mises en avant de l'accueil : validation (éditeur de l'admin, tests) — JS pur ──
// Mêmes règles que netlify/functions/_accueil-vedettes.js (recopiées, comme applyTiers : scripts/test-vedettes.mjs vérifie
// qu'elles donnent le même résultat). Éditeur : erreurs bloquantes (publication impossible) ; serveur : objet ignoré,
// textes tronqués. Hors du chunk de la page des pharmacies (elle reçoit des objets déjà validés par le serveur).
// Types : produit, menu promo, outil du site (liste fermée OUTILS_MEA de rubriques.js, « Outil inconnu » sinon).
import { LIMITES, jourValide } from "./vedettes.js";
import { OUTILS_MEA } from "./rubriques.js";

export const MAX_ITEMS = 20;
export const EMPLACEMENTS = ["vitrine", "grille"];
const TYPES = ["produit", "menu", "outil"];
const RE_ID = /^mea_[a-z0-9_]{4,32}$/, RE_CIP = /^\d{8,14}$/, RE_MENU = /^[\w-]{1,40}$/, RE_COULEUR = /^#[0-9a-f]{6}$/;
const RE_IMAGE = /^https:\/\/[^\s"'()<>\\]+$/;

export function verifierVedette(x) {
  if (!x || typeof x !== "object") return { item: null, erreurs: [{ champ: "objet", message: "Mise en avant illisible" }] };
  const t = (k) => String(x[k] ?? "").replace(/\s+/g, " ").trim();
  const c = (k) => (x[k] ? String(x[k]).trim().toLowerCase() : null);
  const it = { id: String(x.id ?? ""), type: x.type, cip: x.type === "produit" ? String(x.cip ?? "").trim() : null, menu_id: x.type === "menu" ? String(x.menu_id ?? "").trim() : null,
    outil: x.type === "outil" ? String(x.outil ?? "").trim() : null, emplacement: x.emplacement, titre: t("titre"), accroche: t("accroche"), badge: t("badge"), date_debut: x.date_debut || null, date_fin: x.date_fin || null,
    ordre: Number.isFinite(Number(x.ordre)) ? Math.round(Number(x.ordre)) : 0, image: x.image ? String(x.image).trim() : null, couleur: c("couleur"), couleur_auto: c("couleur_auto"),
    actif: x.actif !== false, maj: typeof x.maj === "string" ? x.maj.slice(0, 40) : null };
  const e = [];
  const err = (champ, message, long) => e.push({ champ, message, ...(long ? { long: true } : {}) });
  if (!RE_ID.test(it.id)) err("id", "Identifiant invalide");
  if (!TYPES.includes(it.type)) err("type", "Type inconnu");
  if (it.type === "produit" && !RE_CIP.test(it.cip)) err("cip", "CIP invalide (8 à 14 chiffres)");
  if (it.type === "menu" && !RE_MENU.test(it.menu_id)) err("menu_id", "Menu promo invalide");
  if (it.type === "outil" && !OUTILS_MEA.includes(it.outil)) err("outil", "Outil inconnu");
  if (!EMPLACEMENTS.includes(it.emplacement)) err("emplacement", "Emplacement inconnu");
  for (const k of ["date_debut", "date_fin"]) if (it[k] && !jourValide(it[k])) err(k, "Date invalide");
  if (it.date_debut && it.date_fin && jourValide(it.date_debut) && jourValide(it.date_fin) && it.date_fin < it.date_debut) err("date_fin", "La fin précède le début");
  for (const [k, n] of Object.entries(LIMITES)) if (it[k].length > n) err(k, `${n} caractères au plus`, true);
  if (it.image && !(it.image.length <= 500 && RE_IMAGE.test(it.image))) err("image", "Adresse d'image invalide (https://…)");
  for (const k of ["couleur", "couleur_auto"]) if (it[k] && !RE_COULEUR.test(it[k])) err(k, "Couleur invalide");
  return { item: it, erreurs: e };
}
const rangPlace = (it) => EMPLACEMENTS.indexOf(it.emplacement);
const triPlace = (a, b) => rangPlace(a) - rangPlace(b) || a.ordre - b.ordre;
export const cleObjet = (it) => (it.type === "menu" ? `m:${it.menu_id}` : it.type === "outil" ? `o:${it.outil}` : `p:${it.cip}`);

// Valeur publiée → configuration propre : objets de forme invalide ignorés, textes trop longs tronqués, doublons (même
// produit, même menu ou même outil, toutes places confondues) : le premier par emplacement puis ordre ; 20 objets au plus
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

// Brouillon de l'éditeur → erreurs bloquantes [{ id, champ, message }] (formes, longueurs, doublons, plus de 20)
export function erreursBrouillon(brouillon) {
  const out = [], vus = new Map();
  const items = Array.isArray(brouillon?.items) ? brouillon.items : [];
  if (items.length > MAX_ITEMS) out.push({ id: null, champ: "nombre", message: "20 mises en avant au plus : supprimez les terminées" });
  for (const x of [...items].sort((a, b) => triPlace(a, b))) {
    const { item, erreurs } = verifierVedette(x);
    for (const e of erreurs) out.push({ id: item?.id ?? null, ...e });
    if (!item) continue;
    const cle = cleObjet(item);
    if (vus.has(cle)) out.push({ id: item.id, champ: "doublon", message: `Déjà mis en avant ${vus.get(cle) === "vitrine" ? "en vitrine" : "dans la grille"}` });
    else vus.set(cle, item.emplacement);
  }
  return out;
}

// État daté d'une mise en avant : masquee, programmee, terminee, ou null (à afficher si le produit ou le menu le permet)
export function etatDate(it, aujourdhui, fin) {
  if (!it.actif) return "masquee";
  if (it.date_debut && aujourdhui < it.date_debut) return "programmee";
  if (fin && aujourdhui > fin) return "terminee";
  return null;
}

