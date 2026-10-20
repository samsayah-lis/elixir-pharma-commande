// ── Péremption courte, lot 0 (20/10/2026, conception « Odoo facture la remise », § 8 et § 15 étape 0) ──
// Odoo facture le prix de la liste du client ; il ne connaît aucune remise péremption tant que la fonction « Odoo facture la
// remise » n'est pas en service. La page n'annonce donc plus de remise : elle affiche le prix habituel, celui de la Saisie de
// commande (prixPage, liste n° 5) ou du menu qui contient le produit (prixDuMenu), avec la date du lot. Un ajout depuis la page porte la mention « Pér. <date> » : panier, commande
// enregistrée (admin, « Mes commandes »), e-mail à Elixir. Elle sert face à une demande de retour « date trop courte ».
// La mention ne change ni le prix, ni l'identité de la ligne (CIP), ni ce que lit le relais PharmaML (cip, name, qty, pn) ;
// PharmaML et Odoo n'ont aucun champ texte par ligne, elle reste dans le site. Produit rangé dans un menu : l'ajout va sur
// la ligne du menu, au prix du menu, et la mention se perd (conception, § 8.2 ; question ouverte, § 16.3). La date est celle
// affichée à l'ajout, pas celle du lot livré.
// Parties pures (sans React) : scripts/test-peremption-mention.mjs.

// ligne (de la page, du panier, de la commande) commandée depuis la page Péremption courte
export const estPeremption = (x) => typeof x?.peremption === "string" && x.peremption !== "";

// date du lot gardée sur la ligne : « AAAA-MM-JJ » (heure retirée) ; Odoo sans date : « date inconnue » ; autre texte : tel
// quel, 40 caractères au plus
export const jourPeremption = (d) => {
  const s = String(d ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s ? s.slice(0, 40) : "date inconnue";
};
// « 2026-12-31 » → « 31/12/2026 » (autre valeur : telle quelle)
export const datePeremption = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d ?? "");
};
export const notePeremption = (d) => `Pér. ${datePeremption(d)}`;

// Prix de la page = prix de la Saisie de commande (OrderEntry.handleAdd), celui de la liste n° 5 : prix remisé de la liste
// n° 5 (odoo_catalog.discounted_price, synchro « Prix remisés ») s'il y a une remise, sinon prix catalogue ; paliers de
// quantité d'Odoo appliqués au panier (applyTiers). Aucune remise péremption : Odoo ne la facture pas encore. Comme partout
// sur le site, c'est le prix de la liste n° 5 : les clients des listes 15, 1110 et 25 peuvent être facturés plus cher, ceux
// des listes 1112 et 1114 moins cher (relevé Odoo du 20/10/2026, écart connu, hors de ce chantier).
export function prixPage(p) {
  const remise = !!(p?.discounted_price && p.discount_pct > 0);
  return { pn: remise ? p.discounted_price : (p?.list_price ?? null), pv: p?.list_price ?? null, pct: remise ? p.discount_pct : 0,
    tiers: Array.isArray(p?.price_tiers) && p.price_tiers.length ? p.price_tiers : null };
}

// Objet ajouté au panier par la page (ShortExpiry, handleAdd) : celui de la Saisie de commande, plus la date du lot le plus
// court et sa mention
export function offrePeremption(p, qty) {
  const { pn, pv, pct, tiers } = prixPage(p);
  const peremption = jourPeremption(p?.earliest_expiry);
  return { cip: p.cip, name: p.name, qty, pn, pv, discount: pct, tiers, note: notePeremption(peremption), peremption };
}

// Champ gardé sur la ligne hors catalogue du panier (addItemToCart) : ajout depuis la page seulement ; un ajout de la Saisie
// sur une ligne déjà marquée ne retire pas la mention (les boîtes de la page y sont)
export const champsMention = (item) => (estPeremption(item) ? { peremption: jourPeremption(item.peremption) } : {});

// Champs ajoutés à la ligne du panier calculé (cartItems) ; aucune autre ligne ne change
export const champsPeremption = (s) => (estPeremption(s) ? { peremption: s.peremption, note: notePeremption(s.peremption) } : {});

// Champs ajoutés à une ligne de commande enregistrée (toItems) : order-save garde les lignes telles quelles, le relais n'en
// lit que cip, name, qty et pn
export const mentionCommande = (i) => (estPeremption(i) ? { note: notePeremption(i.peremption), peremption: i.peremption } : {});

// Mention de l'e-mail de commande (envoyé à Elixir seulement) ; vide pour toute autre ligne. « sans remise péremption » :
// le prix de la ligne est le prix habituel (liste n° 5, remonté s'il venait de l'ancienne page), aucune remise à reporter
export const mentionMail = (i) => (estPeremption(i) ? ` — PÉREMPTION COURTE (${notePeremption(i.peremption)}, sans remise péremption)` : "");

// ── Ligne rangée dans un menu : prix que prendra le panier (revue du lot 0, 20/10/2026) ──
// addItemToCart range un CIP présent dans un menu sur la ligne du PREMIER menu qui le contient (ordre du catalogue) ; le
// panier calculé (cartItems) lui donne alors le prix de campagne (pv × (1 − palier), 33 % par défaut) si le menu est une
// campagne, sinon le prix du menu et ses paliers. La page affiche ce prix-là (prixPanier de ShortExpiry). null : CIP dans
// aucun menu (le panier garde le prix de la page) ; pn null : ligne de menu sans prix, que le panier n'afficherait pas.
// campagneDe(catKey) : getCampaign d'App.jsx.
export function prixDuMenu(catalogue, cip, campagneDe = () => null) {
  if (!cip) return null;
  for (const [catKey, c] of Object.entries(catalogue || {})) {
    const p = (c?.products || []).find(x => x.cip === cip);
    if (!p) continue;
    const camp = campagneDe(catKey);
    const remisePct = camp ? (camp.palier_remise ?? 33) : 0;
    const pn = p.pn == null ? null : remisePct > 0 ? Math.round(p.pv * (1 - remisePct / 100) * 100) / 100 : p.pn;
    return { pn, pv: p.pv ?? null, pct: 0, tiers: !camp && Array.isArray(p.price_tiers) && p.price_tiers.length ? p.price_tiers : null,
      rayon: c.label || catKey, campagne: !!camp };
  }
  return null;
}

// ── Panier enregistré avant le lot 0 (revue du 20/10/2026 ; conception § 8.3, ramenée au lot 0) ──
// L'ancienne page mettait au panier −50 % (−20 % dès 500 €), qu'Odoo n'a jamais facturés, et le panier enregistré
// (localStorage) garde ce prix. Une ligne hors catalogue dont le CIP est sur la page et dont le prix est sous celui de la
// page (prixPage, celui de la Saisie) y est remontée, avec les paliers d'Odoo ; un prix n'est jamais baissé. Article
// multi-CIP (supplier_code), produit absent de la page ou page sans prix : ligne inchangée.
// ancienneRemise : le prix de la ligne est celui de l'ancienne page (prix catalogue × 0,5, ou × 0,8 dès 500 €).
const ECART_PRIX = 0.005;
const centimes = (n) => Math.round(n * 100) / 100;
export function prixARemonter(lignes, produits) {
  const parCip = new Map();
  for (const p of Array.isArray(produits) ? produits : []) if (p?.cip && !parCip.has(p.cip)) parCip.set(p.cip, p);
  const changes = [];
  for (const s of Array.isArray(lignes) ? lignes : []) {
    if (!s?.cip || s.supplier_code) continue;
    const p = parCip.get(s.cip);
    if (!p) continue;
    const prix = prixPage(p);
    if (!(prix.pn > 0)) continue;
    const avant = s.pn == null ? NaN : Number(s.pn);
    if (Number.isFinite(avant) && avant >= prix.pn - ECART_PRIX) continue;
    const base = Number(p.list_price) || 0;
    const ancienneRemise = Number.isFinite(avant) && base > 0 && Math.abs(avant - centimes(base * (base >= 500 ? 0.8 : 0.5))) < ECART_PRIX;
    changes.push({ cip: s.cip, name: s.name || p.name || s.cip, avant: Number.isFinite(avant) ? avant : null, apres: prix.pn, pv: prix.pv ?? s.pv ?? null,
      tiers: prix.tiers, ancienneRemise });
  }
  return changes;
}
// Lignes du panier remontées (même tableau si rien ne change : pas de rendu inutile)
export function remonterPrix(lignes, produits) {
  const changes = prixARemonter(lignes, produits);
  if (!changes.length) return lignes;
  const parCip = new Map(changes.map(c => [c.cip, c]));
  return lignes.map(s => { const c = s && !s.supplier_code ? parCip.get(s.cip) : null; return c ? { ...s, pn: c.apres, pv: c.pv, tiers: c.tiers } : s; });
}
const euros = (n) => `${Number(n).toFixed(2).replace(".", ",")} €`;
const nomCourt = (n) => { const t = String(n ?? "").trim(); return t.length > 32 ? `${t.slice(0, 31).trimEnd()}…` : t; };
// Message affiché une fois les prix remontés (flash d'App.jsx)
export function messageRemontee(changes) {
  if (!changes?.length) return "";
  const liste = changes.slice(0, 2).map(c => `${nomCourt(c.name)} : ${euros(c.apres)}`).join(", ")
    + (changes.length > 2 ? ` et ${changes.length - 2} autre${changes.length > 3 ? "s" : ""}` : "");
  return changes.every(c => c.ancienneRemise)
    ? `Prix mis à jour : la remise péremption affichée auparavant n'était pas facturée par Odoo (${liste})`
    : `Prix du panier mis à jour au prix actuel, celui de la Saisie de commande (${liste})`;
}
// Encart de la ligne du panier dont le prix a été remonté (texte après « Prix mis à jour : »)
export const detailRemontee = (c) => `${euros(c.apres)} au lieu de ${c.avant != null ? euros(c.avant) : "—"}`
  + (c.ancienneRemise ? " : la remise péremption affichée auparavant n'était pas facturée par Odoo" : " : prix actuel, celui de la Saisie de commande");
