// ── Page d'accueil : résolution des offres avec le catalogue chargé (docs/accueil.md § 4) — JS pur, sans React ──
// Le GET accueil-offres fournit la SÉLECTION (classement, dosages, boîte, popularité) ; prix, paliers, menu, règle de
// quantité et lot sont repris ici du catalogue du site, dans l'ordre d'addItemToCart : la vitrine ne contredit jamais un
// menu ni le panier. Testé hors ligne par scripts/test-accueil-client.mjs (montant du lot = ce que cartItems facture).
import { applyTiers } from "../../tiers.jsx";

export const NB = 10;   // diapositives montrées (diapositives du GET, puis réserves)
const r2 = (x) => Math.round(x * 100) / 100;
const nombreTranche = (t) => parseInt(String(t || "").replace(/\D/g, ""), 10) || 0;

// Nombre saisi par l'admin ou lu d'une table : 12.96, « 12,96 », « -10% », « 38% » → nombre ; vide ou illisible → null
// (même lecture que num() de netlify/functions/_accueil-selection.js)
export function nombre(x) {
  if (x == null || x === "") return null;
  const v = typeof x === "number" ? x : parseFloat(String(x).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(v) ? v : null;
}

// Produit du catalogue : PREMIER menu qui contient le CIP, dans l'ordre d'addItemToCart (c'est là que l'ajout range la
// ligne, au prix de ce menu) → { catKey, p, label, accent } | null (produit hors menu : ligne « spéciale » de la Saisie)
export function produitDuCatalogue(catalogue, cip) {
  for (const [catKey, c] of Object.entries(catalogue || {})) {
    const p = (c.products || []).find(x => x.cip === cip);
    if (p) return { catKey, p, label: c.label || catKey, accent: c.accent };
  }
  return null;
}

const sansEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").trim();

// Une offre (diapositive ou dosage du GET) au moment présent → offre résolue, ou null si elle ne doit pas paraître.
// ctx : { catalogue, catalogueCharge, stockData, justifProducts, menuOuvrable(k), regleSaisie(cip), estCampagne(k),
//         photos: { cip: url } (admin), teinte(k) }
// Retirés : justificatif labo, produit de campagne (prix et UG propres au panier), menu non ouvrable, rupture d'un produit
// de menu, prix net absent.
export function resoudreOffre(o, ctx) {
  if (!o?.cip || (ctx.justifProducts || {})[o.cip]) return null;
  const teinte = ctx.teinte || (() => null);
  const photoAdmin = (ctx.photos || {})[o.cip] || null;
  let r = { ...o, image_url: o.image_url || photoAdmin };
  if (!ctx.catalogueCharge) {
    // catalogue pas encore chargé : prix du GET, ajout désactivé (« Chargement des prix… »)
    return { ...r, regle: o.regle_qte || { step: 1, min: 1, multiple: 1 }, teinte: teinte(o.menu?.key) || teinte("saisie") };
  }
  const t = produitDuCatalogue(ctx.catalogue, o.cip);
  if (t) {
    if (ctx.estCampagne?.(t.catKey)) return null;
    if (!ctx.menuOuvrable(t.catKey)) return null;
    const st = (ctx.stockData || {})[o.cip];
    if (st && (st.dispo === 0 || st.dispo === false)) return null;
    const p = t.p;
    const pn = nombre(p.pn), pv = nombre(p.pv);
    if (!(pn > 0)) return null;
    const remise = nombre(p.remise_eur);
    r = { ...r, pv, pn, pct: Math.abs(nombre(p.pct) ?? 0), remise_eur: remise ?? (pv > 0 ? r2(pv - pn) : null),
      price_tiers: p.price_tiers || null, nom_panier: p.name, image_url: p.image_url || o.image_url || photoAdmin,
      menu: { key: t.catKey, label: sansEmoji(t.label) }, teinte: t.accent || teinte("saisie") };
  } else r = { ...r, menu: { key: "saisie", label: "Saisie de commande" }, teinte: teinte("saisie") };
  // règle de quantité de la Saisie (colis, minimum) ; lot = max(minimum, multiple, 1) ; montant = ce que le panier
  // facture (cartItems : applyTiers(pn, paliers, quantité).pn × quantité)
  const g = ctx.regleSaisie(o.cip);
  r.regle = g ? { step: g.step, min: g.min, multiple: g.multiple } : { step: 1, min: 1, multiple: 1 };
  const qte = Math.max(r.regle.min || 0, r.regle.multiple || 1, 1);
  const pu = applyTiers(r.pn, r.price_tiers, qte).pn;
  r.lot = { qte, pu, total: r2(pu * qte) };
  return r;
}

// Diapositives de la vitrine (NB au plus) : diapositives du GET, puis réserves. Exclusion de l'admin : TOUTE la famille
// (l'aperçu de l'admin montre une ligne par famille ; un CIP exclu, principal ou dosage, retire la diapositive, même si le
// serveur a changé de dosage principal entre-temps). Dosage principal retiré (rupture…) : le plus commandé des autres.
export function construireDiapos(donnees, ctx) {
  if (!donnees) return [];
  const exclus = ctx.exclus || new Set();
  const out = [];
  for (const s of [...(donnees.slides || []), ...(donnees.reserves || [])]) {
    if (out.length >= NB) break;
    if (!s?.cip || [s.cip, ...(s.variantes || []).map(v => v.cip)].some(c => exclus.has(c))) continue;
    const vars = (s.variantes || []).map(v => { const r = resoudreOffre(v, ctx); return r && { ...r, libelle: v.libelle, principal: !!v.principal }; }).filter(Boolean);
    const principal = resoudreOffre(s, ctx) || [...vars].sort((a, b) => nombreTranche(b.popularite) - nombreTranche(a.popularite))[0];
    if (!principal) continue;
    out.push({ famille: s.famille, labo: s.labo, tendance_pct: s.tendance_pct, nouveau: !!s.nouveau, serie_15j: s.serie_15j || [],
      principal, variantes: vars.length > 1 ? vars.map(v => ({ ...v, principal: v.cip === principal.cip })) : [], teinte: principal.teinte });
  }
  return out;
}

// Jour de Paris (AAAA-MM-JJ) ; menus promo à mettre en avant : actifs et pas encore échus (endDate inclus)
export const jourParis = (t = Date.now()) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
export const promosEnCours = (promos, aujourdhui = jourParis()) =>
  (Array.isArray(promos) ? promos : []).filter(p => p && p.active && (!p.endDate || String(p.endDate).slice(0, 10) >= aujourdhui));

// Produit actif de la vitrine, suivi par sa famille : son rang actuel ; famille disparue de la liste (stock rafraîchi,
// exclusion de l'admin, catalogue chargé tard), la place qu'elle occupait, bornée au dernier produit (jamais hors liste)
export function indexActif(slides, famille, place = 0) {
  const i = (slides || []).findIndex(x => x.famille === famille);
  return i >= 0 ? i : Math.max(0, Math.min(place, (slides || []).length - 1));
}
