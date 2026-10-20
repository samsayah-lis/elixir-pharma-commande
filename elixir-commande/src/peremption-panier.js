// ── Péremption courte, lot 0 (20/10/2026, conception « Odoo facture la remise », § 8 et § 15 étape 0) ──
// Odoo facture le prix de la liste du client ; il ne connaît aucune remise péremption tant que la fonction « Odoo facture la
// remise » n'est pas en service. La page n'annonce donc plus de remise : elle affiche le prix facturé, celui de la Saisie de
// commande (prixPage), avec la date du lot. Un ajout depuis la page porte la mention « Pér. <date> » : panier, commande
// enregistrée (admin, « Mes commandes »), e-mail à Elixir. Elle sert face à une demande de retour « date trop courte ».
// La mention ne change ni le prix, ni l'identité de la ligne (CIP), ni ce que lit le relais PharmaML (cip, name, qty, pn) ;
// PharmaML et Odoo n'ont aucun champ texte par ligne, elle reste dans le site. Produit rangé dans un menu : l'ajout va sur
// la ligne du menu, au même prix, et la mention se perd (conception, § 8.2 ; question ouverte, § 16.3).
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

// Prix de la page = prix facturé, même règle que la Saisie de commande (OrderEntry.handleAdd) : prix remisé de la liste
// n° 5 (odoo_catalog.discounted_price, synchro « Prix remisés ») s'il y a une remise, sinon prix catalogue ; paliers de
// quantité d'Odoo appliqués au panier (applyTiers). Aucune remise péremption : Odoo ne la facture pas encore.
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
// le prix de la ligne est celui qu'Odoo facture, rien à corriger
export const mentionMail = (i) => (estPeremption(i) ? ` — PÉREMPTION COURTE (${notePeremption(i.peremption)}, sans remise péremption)` : "");
