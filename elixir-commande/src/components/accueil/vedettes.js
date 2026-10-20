// ── Page d'accueil : les mises en avant de Zineb (vitrine cinéma, grille à la une) — JS pur, sans React ──
// Clé ec_config « accueil_vedettes » (docs/accueil.md § 7) : { version, repli, defilement, items: [mise en avant] }.
// Règles partagées avec l'éditeur de l'admin (AdminVedettes.jsx) ; la validation (vedettes-regles.js, admin et tests
// seulement : la page reçoit des objets déjà validés par le serveur) recopie celle de netlify/functions/_accueil-vedettes.js.
// Ici : dates (heure de Paris), compte à rebours, repli automatique sur les menus promo, résumé d'un menu, teintes, et la
// construction finale des deux emplacements à partir du GET accueil-offres (produits recalés sur le catalogue chargé par
// resoudreOffre : le montant du bouton est ce que le panier facture).
import { resoudreOffre, produitDuCatalogue, nombre, jourParis } from "./resolution.js";

export const MAX_VISIBLES = 5;
export const LIMITES = { titre: 60, accroche: 140, badge: 24 };
export const ELIXIR = "#3c7782";                                  // --teal-2 : dernier repli de la teinte
export const COULEURS_DEFAUT = new Set(["#7c3aed", "#a855f7"]);    // violet par défaut des menus promo, jamais choisi
const RE_COULEUR = /^#[0-9a-f]{6}$/;
const sansEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();

// ── Dates (heure de Paris, jours inclus) ──
export { jourParis };
export const ajouteJours = (jour, n) => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const decalageParis = (t) => { const s = Math.floor(t / 1000) * 1000; return Date.parse(new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace(" ", "T") + "Z") - s; };
// minuit (heure de Paris) du jour AAAA-MM-JJ, en ms UTC (comme minuitParis du serveur)
export function minuitParis(jour) { const b = Date.parse(`${jour}T00:00:00Z`); return b - decalageParis(b - decalageParis(b)); }
export const jourValide = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const jour10 = (s) => (jourValide(String(s || "").slice(0, 10)) ? String(s).slice(0, 10) : null);
// fin effective : la plus proche de la fin de la mise en avant et de celle du menu (offre de menu promo)
export const finEffective = (dateFin, finMenu) => [jour10(dateFin), jour10(finMenu)].filter(Boolean).sort()[0] || null;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
// « 31 octobre », « vendredi 31 octobre », court : « 31 oct. »
export function dateTexte(jour, { semaine = false, court = false } = {}) {
  if (!jourValide(jour)) return "";
  const d = new Date(`${jour}T12:00:00Z`);
  return `${semaine ? `${JOURS[d.getUTCDay()]} ` : ""}${d.getUTCDate()} ${(court ? MOIS_COURT : MOIS)[d.getUTCMonth()]}`;
}

// Compte à rebours (fin incluse, cible = minuit de Paris qui suit) : pas de fausse urgence → { mode, ... }
//  « date » (plus de 7 jours) · « jours » (2 à 7 jours : n) · « puces » (moins de 48 h : [valeur, unité]) · « fini »
export function rebours(fin, t = Date.now(), secondes = true) {
  const J = 864e5, H = 3600e3, reste = minuitParis(ajouteJours(fin, 1)) - t;
  if (reste <= 0) return { mode: "fini", reste };
  if (reste > 7 * J) return { mode: "date", reste };
  if (reste >= 48 * H) return { mode: "jours", n: Math.ceil(reste / J), reste };
  const s = Math.floor(reste / 1000), deux = (x) => String(x).padStart(2, "0");
  const puces = reste >= H ? [[Math.floor(s / 86400), "j"], [Math.floor(s / 3600) % 24, "h"], [deux(Math.floor(s / 60) % 60), "min"]].filter(([v, u]) => u !== "j" || v > 0)
    : [[deux(Math.floor(s / 60)), "min"], ...(secondes ? [[deux(s % 60), "s"]] : [])];
  return { mode: "puces", puces, reste };
}

// ── Couleur ──
const hexValide = (h) => (typeof h === "string" && RE_COULEUR.test(h.toLowerCase()) ? h.toLowerCase() : null);
export const couleurMenu = (menu) => { const h = hexValide(menu?.color); return h && !COULEURS_DEFAUT.has(h) ? h : null; };
// teinte retenue et sa source : choisie > tirée de la photo > couleur du menu (sauf violet par défaut) > accent du rayon > Elixir
export function couleurDe(v, { menu, accent } = {}) {
  const c = [[v?.couleur, "choisie"], [v?.couleur_auto, "photo"], [couleurMenu(menu), "menu"], [accent, "rayon"]].find(([h]) => hexValide(h));
  return c ? { hex: hexValide(c[0]), source: c[1] } : { hex: ELIXIR, source: "elixir" };
}
// Trois variantes bornées (sans color-mix : Safari 15) : débord sombre sur la salle, périphérie claire de l'écran, trait
// lumineux de la grille → « rgb(r, g, b) » (jamais une chaîne libre dans un style)
export function teintes(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")) || /^#?([0-9a-f]{6})$/i.exec(ELIXIR);
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const rgb = (S, L) => {
    const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((h / 60) % 2 - 1)), M = L - C / 2;
    const [a, bb, cc] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return `rgb(${[a, bb, cc].map(v => Math.round((v + M) * 255)).join(", ")})`;
  };
  return { sombre: rgb(Math.min(s, 0.65), Math.min(0.48, Math.max(0.32, l))), claire: rgb(Math.min(s, 0.5), 0.86), trait: rgb(Math.min(s, 0.7), 0.55) };
}

// ── Menus promo ──
// produits montrés d'un menu : prix net > 0 ; en stock (stockData), sauf précommande (sansStock)
const enRupture = (stockData, cip) => { const st = (stockData || {})[cip]; return !!st && (st.dispo === 0 || st.dispo === false); };
export function produitsVisibles(menu, stockData) {
  return (Array.isArray(menu?.products) ? menu.products : []).filter(p => p && nombre(p.pn) > 0 && (menu.sansStock || !enRupture(stockData, String(p.cip || ""))));
}
// photo d'un produit de menu : la sienne, sinon celle du catalogue pour ce CIP (premier menu qui en a une)
const photoCatalogue = (catalogue, cip) => {
  for (const c of Object.values(catalogue || {})) { const p = (c.products || []).find(x => x.cip === cip && x.image_url); if (p) return p.image_url; }
  return null;
};
// résumé d'un menu : nombre de produits montrés, « dès » (plus petit prix net), « jusqu'à » (plus forte remise réellement
// présente), cartes de l'éventail (5 au plus : photos dans l'ordre du menu, dédoublonnées, la carte de devant d'abord ;
// complétées jusqu'à 3 par des cartes texte)
export function resumeMenu(menu, { stockData, catalogue, image } = {}) {
  const vis = produitsVisibles(menu, stockData);
  const pns = vis.map(p => nombre(p.pn)), pcts = vis.map(p => Math.abs(nombre(p.pct) ?? 0)).filter(x => x >= 1 && x < 100);
  const cartes = [], urls = new Set();
  if (image) { cartes.push({ url: image, nom: "", pn: null }); urls.add(image); }
  for (const p of vis) {
    if (cartes.length >= 5) break;
    const url = p.image_url || photoCatalogue(catalogue, String(p.cip || ""));
    if (url && !urls.has(url)) { urls.add(url); cartes.push({ url, nom: String(p.name || ""), pn: nombre(p.pn) }); }
  }
  for (const p of vis) {
    if (cartes.length >= 3) break;
    if (!cartes.some(c => c.nom === String(p.name || ""))) cartes.push({ url: null, nom: String(p.name || ""), pn: nombre(p.pn) });
  }
  return { nb: vis.length, des: pns.length ? Math.min(...pns) : null, jusqua: pcts.length ? Math.max(...pcts) : null, cartes };
}
export const menuEnCours = (m, aujourdhui) => !!m && !!m.active && (!jour10(m.endDate) || jour10(m.endDate) >= aujourdhui);

// Repli automatique (la page n'est jamais nue) : menus promo actifs, pas échus, ouvrables et non vides, absents de
// dejaMontres ; la fin la plus proche d'abord, puis les plus récents (id = horodatage de création). Utilisé aussi par
// l'éditeur de l'admin pour montrer ce choix (une seule règle).
export function repliMenus(promos, dejaMontres, aujourdhui, montrable = () => true) {
  return (Array.isArray(promos) ? promos : [])
    .filter(m => menuEnCours(m, aujourdhui) && !dejaMontres.has(String(m.id)) && montrable(m))
    .sort((a, b) => (jour10(a.endDate) ? 0 : 1) - (jour10(b.endDate) ? 0 : 1) || String(jour10(a.endDate) || "").localeCompare(String(jour10(b.endDate) || ""))
      || (Number(b.id) || 0) - (Number(a.id) || 0));
}

// ── Textes par défaut ──
const casseTitre = (s) => String(s || "").toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
// titre d'un produit : le nom du menu promo s'il est écrit en minuscules et court, sinon la marque en casse de titre
// (« Ventoline ») ; jamais le nom Odoo en capitales
export function titreParDefaut(offre) {
  const nc = String(offre?.nom_court || "").trim();
  // nom écrit en minuscules (au moins 3 lettres minuscules : « 100µG » ne suffit pas)
  if (nc && (nc.match(/[a-zàâäçéèêëîïôöùûüÿœæ]/g) || []).length >= 3 && nc.length <= LIMITES.titre) return nc;
  return casseTitre(offre?.boite?.marque || nc.split(/\s+/)[0] || "");
}
export const titreMenu = (menu) => sansEmoji(menu?.name) || "Offre";

// ── Construction finale (page des pharmacies, aperçu de l'admin) ──
// ved : vedettes du GET ({ repli, defilement, items }) ou null (GET absent, refusé, trop lent) ; ctx : celui de
// resoudreOffre + { promos, aujourdhui, apercu } → { vitrine: [entrée], grille: [entrée], auto: { vitrine, grille }, defilement }
export function construireMisesEnAvant(ved, ctx) {
  const conf = ved && typeof ved === "object" ? ved : { repli: true, defilement: true, items: [] };
  const out = { vitrine: [], grille: [], auto: { vitrine: false, grille: false }, defilement: conf.defilement !== false };
  const vus = new Set();
  const aj = ctx.aujourdhui || jourParis();
  for (const v of Array.isArray(conf.items) ? conf.items : []) {
    const place = out[v?.emplacement];
    if (!place || place.length >= MAX_VISIBLES || (v.fin && aj > v.fin)) continue;
    const e = v.type === "menu" ? entreeMenu(v, ctx, aj) : v.type === "produit" ? entreeProduit(v, ctx) : null;
    if (!e || vus.has(e.cle)) continue;
    vus.add(e.cle); place.push(e);
  }
  if (conf.repli !== false) {
    const deja = new Set([...vus].filter(c => c.startsWith("m:")).map(c => c.slice(2)));
    const menus = repliMenus(ctx.promos, deja, aj, (m) => !!entreeMenu({ id: "auto", type: "menu", menu_id: m.id }, ctx, aj));
    if (!out.vitrine.length && menus.length) { out.vitrine.push(entreeMenu({ id: `auto_v_${menus[0].id}`, type: "menu", menu_id: menus[0].id, auto: true }, ctx, aj)); out.auto.vitrine = true; }
    if (!out.grille.length) {
      const reste = menus.filter(m => !out.vitrine.some(e => e.cle === `m:${m.id}`)).slice(0, MAX_VISIBLES);
      reste.forEach(m => out.grille.push(entreeMenu({ id: `auto_g_${m.id}`, type: "menu", menu_id: m.id, auto: true }, ctx, aj)));
      out.auto.grille = reste.length > 0;
    }
  }
  return out;
}
// entrée commune : { id, cle, type, auto, titre, accroche, badge, fin, finOffre, couleur, teintes, halo, rayon, ... }
// fin : fin effective (l'entrée disparaît) ; finOffre : fin du prix (menu promo daté), seule affichée (compte à rebours)
const commun = (v, cle, couleur, halo) => ({ id: v.id, cle, type: v.type, auto: !!v.auto, accroche: v.accroche || "", badge: v.badge || "",
  couleur: couleur.hex, source: couleur.source, teintes: teintes(couleur.hex), halo: halo || null });
function entreeProduit(v, ctx) {
  const o = v.offre;
  if (!o?.cip) return null;
  const key = o.menu?.key || "";
  const promo = key.startsWith("promo_") ? (ctx.promos || []).find(p => `promo_${p.id}` === key) : null;
  const r = resoudreOffre(o, { ...ctx, ignorerStock: !!promo?.sansStock });
  if (!r) return null;
  if (v.image) r.image_url = v.image;
  const t = ctx.catalogueCharge ? produitDuCatalogue(ctx.catalogue, o.cip) : null;
  const rkey = r.menu?.key || key;
  const menuPromo = rkey.startsWith("promo_") ? (ctx.promos || []).find(p => `promo_${p.id}` === rkey) : null;
  const accent = rkey.startsWith("promo_") || rkey === "saisie" ? null : (t?.accent || ctx.catalogue?.[rkey]?.accent);
  const e = commun(v, `p:${o.cip}`, couleurDe(v, { menu: menuPromo, accent }), r.image_url);
  const b = o.boite || {};
  // finOffre (compte à rebours) : fin du prix seulement, celle du menu promo où l'ajout range la ligne ; la date de fin de
  // la mise en avant (fin) ne fait que la retirer de la page
  const finOffre = menuPromo ? jour10(menuPromo.endDate) : rkey.startsWith("promo_") ? jour10(v.fin_offre) : null;
  return { ...e, titre: v.titre || titreParDefaut(o), offre: r, fin: v.fin || null, finOffre, rayon: sansEmoji(r.menu?.label) || "Saisie de commande",
    sousLigne: [[b.dosage, b.forme].filter(Boolean).join(" · ") || (o.nom_court !== titreParDefaut(o) ? o.nom_court : ""), b.labo].filter(Boolean).join(" · ") };
}
function entreeMenu(v, ctx, aj) {
  const m = (ctx.promos || []).find(p => String(p?.id) === String(v.menu_id));
  const key = `promo_${m?.id}`;
  if (!menuEnCours(m, aj) || (ctx.menuOuvrable && !ctx.menuOuvrable(key))) return null;
  const res = resumeMenu(m, { stockData: ctx.stockData, catalogue: ctx.catalogue, image: v.image });
  if (!res.nb) return null;
  const e = commun(v, `m:${m.id}`, couleurDe(v, { menu: m }), res.cartes.find(c => c.url)?.url);
  return { ...e, titre: v.titre || titreMenu(m), accroche: v.accroche || String(m.description || "").trim(), fin: finEffective(v.fin, m.endDate), finOffre: jour10(m.endDate),
    rayon: m.sansStock ? "Précommande" : "Menu promo", menu: { id: String(m.id), key, nom: titreMenu(m), icone: m.icon || "", sansStock: !!m.sansStock, ...res } };
}

// ── Textes accessibles ──
const eur = (n) => `${Number(n).toFixed(2).replace(".", ",")} € HT`;
export function prixLu(o) {
  if (!(o?.pn > 0)) return "";
  return [eur(o.pn), o.pct >= 1 ? `remise de ${String(Number(Math.abs(o.pct).toFixed(2))).replace(".", ",")} %` : "", o.pv > o.pn ? `prix de vente ${eur(o.pv)}` : ""].filter(Boolean).join(", ");
}
export const resumeMenuLu = (e) => [e.titre, `${e.menu.nb} référence${e.menu.nb > 1 ? "s" : ""}`, e.menu.des ? `dès ${eur(e.menu.des)}` : "",
  e.menu.jusqua ? `jusqu'à −${String(e.menu.jusqua).replace(".", ",")} %` : ""].filter(Boolean).join(", ");
