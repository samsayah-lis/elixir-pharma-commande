// ── Péremption courte : remise affichée et règle panier (décision de Zineb, 21/10/2026, docs/peremption.md) ──
// « Je veux que par défaut le −50 s'affiche et que ce soit la règle panier qui s'applique ; si le travail manuel côté admin
// n'est pas fait, on rectifiera les écarts depuis l'affichage des écarts. »
//  • Page : chaque produit a une offre (offreAffichee) : la règle Odoo facturée (V1, « Odoo facture la remise ») si elle
//    existe ; sinon la remise affichée de l'admin (expiry_discounts, 0 à 90 %, 0 = aucune) ; sinon −50 % (−20 % dès 500 € de
//    prix de base), comme avant le 20/10/2026 : prix de base (list_price) barré, prix de base × (1 − remise). Jamais plus
//    cher que le prix habituel (Saisie, liste n° 5) : sinon le prix habituel, sans remise.
//  • Panier (règle panier) : un ajout depuis la page est une ligne À PART (identité « per:<cip> »), au prix de la page, avec
//    « Pér. <date> · −X % », jamais fondue dans la ligne d'un menu ou de la Saisie du même CIP. Si le même CIP est sur une autre
//    ligne, elle part dans une commande à part (separerPeremption ; empreinte « :per » du relais, _relais.js).
//  • Commande : pn = prix de la page, note, peremption, remise, facture_odoo (true : une règle Odoo la facture) ; e-mail à
//    Elixir (boîtes à corriger dans Odoo), onglet Commandes de l'admin, « Mes commandes ».
//  • Odoo facture le tarif de la liste du client tant que la ligne n'est pas corrigée à la main : le Contrôle des écarts de
//    l'onglet Péremptions (peremption?action=ecarts) liste chaque ligne prise au prix de la page et facturée plus cher.
//  • Panier enregistré : une ligne péremption est remise au prix ACTUEL de la page (produit encore sur la page), ou au prix
//    habituel si le produit a quitté la page, avec un message (controleLignes, controlerPrixPanier d'App.jsx).
// Parties pures (sans React), importées aussi par netlify/functions/_peremption.js et _accueil-outils.js (même offre partout).
// Tests : scripts/test-peremption-panier.mjs, test-peremption-mention.mjs, test-peremption-odoo.mjs, test-accueil-outils.mjs.

export const COULEUR_PEREMPTION = "#ea580c";   // orange du menu Péremption courte (ShortExpiry)
export const REMISE_DEFAUT = 50;
export const REMISE_DEFAUT_CHER = 20;
export const SEUIL_CHER = 500;                  // prix de base à partir duquel la remise par défaut est de 20 %
const num = (x) => { if (x == null || x === "") return null; const v = typeof x === "number" ? x : Number(String(x).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const centimes = (n) => Math.round(n * 100) / 100;
const ECART_PRIX = 0.005;

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

// Prix habituel = prix de la Saisie de commande (OrderEntry.handleAdd), celui de la liste n° 5 : prix remisé (synchro « Prix
// remisés ») s'il y a une remise, sinon prix catalogue ; paliers de quantité d'Odoo.
export function prixPage(p) {
  const remise = !!(p?.discounted_price && p.discount_pct > 0);
  return { pn: remise ? p.discounted_price : (p?.list_price ?? null), pv: p?.list_price ?? null, pct: remise ? p.discount_pct : 0,
    tiers: Array.isArray(p?.price_tiers) && p.price_tiers.length ? p.price_tiers : null };
}

// Remise par défaut (avant le 20/10/2026, rétablie le 21/10) : 50 %, 20 % dès 500 € de prix de base
export const remiseDefaut = (prixBase) => ((num(prixBase) || 0) >= SEUIL_CHER ? REMISE_DEFAUT_CHER : REMISE_DEFAUT);
// Remise affichée saisie par l'admin (expiry_discounts.discount_pct) : 0 à 90 (0 = aucune remise), sinon null (défaut)
export const remiseAdmin = (v) => { const n = num(v); return n != null && n >= 0 && n <= 90 ? n : null; };
// Remise péremption facturée par Odoo (V1) : produit « facturee » de peremption?action=page (règle vérifiée sur toutes les
// listes et prix du site repris : discounted_price = prix facturé) → % de la facture, sinon null
export const remiseFacturee = (p) => (p?.facturee === true && Number(p.remise_pct) >= 1 && prixPage(p).pn > 0 ? Number(p.remise_pct) : null);

// Offre de la page pour un produit (ligne de peremption?action=page, ou d'odoo_catalog dans le repli) :
// → { pn, base, remise, source, facture_odoo, tiers, motif }
//    source « odoo »   : règle facturée par Odoo (V1) : prix du site, remise de la facture, base barrée (prix_barre du serveur) ;
//           « admin »  : remise affichée de l'admin ; « defaut » : 50 % (20 % dès 500 €) ; prix = base × (1 − remise) ;
//           « habituel » : aucune remise (motif « admin_zero » : l'admin a mis 0 ; « habituel_plus_bas » : le prix habituel
//             est déjà sous le prix remisé ; « sans_base » : pas de prix de base) : prix de la Saisie et ses paliers.
// remises : { cip: % } (expiry_discounts) ; p.remise_admin (posé par le serveur, null = aucune) prime.
export function offreAffichee(p, remises = null) {
  const hab = prixPage(p);
  const facturee = remiseFacturee(p);
  if (facturee != null) return { pn: hab.pn, base: num(p.prix_barre ?? p.prix_base ?? p.list_price), remise: facturee, source: "odoo", facture_odoo: true, tiers: hab.tiers, motif: null };
  const admin = remiseAdmin(p?.remise_admin !== undefined ? p.remise_admin : remises?.[p?.cip]);
  const base = num(p?.list_price);
  const remise = admin ?? remiseDefaut(base);
  const habituel = (motif) => ({ pn: hab.pn ?? null, base, remise: 0, source: "habituel", facture_odoo: false, tiers: hab.tiers, motif });
  if (admin === 0) return habituel("admin_zero");
  if (!(base > 0)) return habituel("sans_base");
  const pn = centimes(base * (1 - remise / 100));
  if (!(pn > 0)) return habituel("sans_base");
  if (hab.pn > 0 && hab.pn <= pn + ECART_PRIX) return habituel("habituel_plus_bas");
  return { pn, base, remise, source: admin != null ? "admin" : "defaut", facture_odoo: false, tiers: null, motif: null };
}
// libellé court de l'offre (admin) : « −50 % (défaut) », « −30 % (admin) », « −12 % facturée par Odoo », « aucune »
export const libelleOffre = (o) => (!o ? "–" : o.source === "odoo" ? `−${o.remise} % facturée par Odoo` : o.remise >= 1 ? `−${o.remise} % (${o.source === "admin" ? "admin" : "défaut"})`
  : o.motif === "admin_zero" ? "aucune (admin)" : o.motif === "habituel_plus_bas" ? "aucune (prix habituel plus bas)" : "aucune");

// Remise et facturation d'une ligne (panier, commande) : remise (règle panier), facture_odoo ; V1 : peremption_remise
// (ligne ajoutée sous une remise facturée par Odoo) ; ligne du lot 0 (mention seule) : remise null
export function remiseLigne(x) {
  if (Number(x?.peremption_remise) >= 1) return { remise: Number(x.peremption_remise), facture_odoo: true };
  const r = num(x?.remise);
  return { remise: r != null && r >= 0 ? r : null, facture_odoo: x?.facture_odoo === true };
}

// Objet ajouté au panier par la page (ShortExpiry, handleAdd) : prix et remise de l'offre, prix de base, date du lot le plus
// court (« date inconnue » si Odoo n'en donne pas : la ligne reste une ligne péremption)
export function offrePeremption(p, qty, remises = null) {
  const o = offreAffichee(p, remises);
  const peremption = jourPeremption(p?.earliest_expiry);
  return { cip: p.cip, name: p.name, qty, pn: o.pn, pv: o.base ?? num(p?.list_price), discount: o.remise, tiers: o.tiers,
    note: notePeremption(peremption), peremption, remise: o.remise, facture_odoo: o.facture_odoo };
}

// Identité d'une ligne hors catalogue (specialItems) : CIP, ou nom ; ligne péremption : la sienne, distincte d'une ligne de
// la Saisie du même CIP. Paniers enregistrés sans ligne péremption : mêmes identités qu'avant.
export const idSpecial = (s) => (estPeremption(s) ? `per:${s.cip || s.name}` : (s.cip || s.name));

// Ajout depuis la page : le produit a déjà sa ligne péremption → quantité ajoutée, au prix, à la remise et à la date de l'offre
// du moment (une ligne, un prix) ; sinon nouvelle ligne. Jamais fondue dans une autre ligne du même CIP.
export function ajouterPeremption(prev, item) {
  const { remise, facture_odoo } = remiseLigne(item);
  const offre = { cip: item.cip || null, name: item.name, pn: item.pn ?? null, pv: item.pv ?? null, tiers: Array.isArray(item.tiers) && item.tiers.length ? item.tiers : null,
    peremption: jourPeremption(item.peremption), remise: remise ?? 0, facture_odoo };
  const id = idSpecial(offre);
  const qty = parseInt(item.qty) || 0;
  const i = prev.findIndex(s => idSpecial(s) === id);
  if (i < 0) return [...prev, { ...offre, qty }];
  return prev.map((s, k) => { if (k !== i) return s; const { peremption_remise, ...reste } = s; return { ...reste, ...offre, qty: (parseInt(s.qty) || 0) + qty }; });   // eslint-disable-line no-unused-vars
}

// Champs ajoutés à une ligne péremption du panier calculé (cartItems) ; aucune autre ligne ne change
export const champsPeremption = (s) => {
  if (!estPeremption(s)) return {};
  const { remise, facture_odoo } = remiseLigne(s);
  return { peremption: s.peremption, note: notePeremption(s.peremption), remise, facture_odoo, pv: s.pv ?? null };
};

// Champs ajoutés à une ligne de commande enregistrée (toItems) : order-save garde les lignes telles quelles, le relais n'en
// lit que cip, name, qty et pn
export const mentionCommande = (i) => {
  if (!estPeremption(i)) return {};
  const { remise, facture_odoo } = remiseLigne(i);
  return { note: notePeremption(i.peremption), peremption: i.peremption, ...(remise != null ? { remise } : {}), facture_odoo };
};

// Texte de la remise d'une ligne : « −50 % » (vide sans remise)
const pctTexte = (r) => `−${String(r).replace(".", ",")} %`;
// Badge de l'admin et de « Mes commandes » : « Pér. 31/12/2026 · −50 % » (sans remise : « Pér. 31/12/2026 »)
export const badgePeremption = (i) => { const { remise } = remiseLigne(i); return `${notePeremption(i?.peremption)}${remise >= 1 ? ` · ${pctTexte(remise)}` : ""}`; };

// Ce qu'Elixir corrige dans Odoo (e-mail, admin) : Odoo facture le tarif de la liste du client, pas le prix de la page.
// Seulement pour une ligne au prix de la page (remise ≥ 1) qu'aucune règle Odoo ne facture. Commande à part (separeDe : n° de
// la commande qui porte l'autre ligne du produit) : le connecteur PharmaML → Odoo regroupe les commandes d'une pharmacie
// reçues dans le même cycle et additionne les quantités d'un même produit sur UNE ligne Odoo : seules ces boîtes-là sont à
// corriger, pas toute la ligne. Sans correction : Contrôle des écarts (onglet Péremptions).
const euros = (n) => `${(Number(n) || 0).toFixed(2).replace(".", ",")} €`;
const boites = (q) => `${q} boîte${q > 1 ? "s" : ""}`;
export const consigneOdoo = (i) => {
  if (!estPeremption(i)) return "";
  const { remise, facture_odoo } = remiseLigne(i);
  if (facture_odoo || !(remise >= 1)) return "";
  const q = parseInt(i.qty) || 0;
  return `prix de la page Péremption courte (${pctTexte(remise)}) non repris par Odoo, qui facture le tarif de la liste du client : corriger ${boites(q)} à ${euros(i.pn)}`
    + (i.separeDe ? ` ; dans Odoo, ${q > 1 ? "elles peuvent être additionnées" : "elle peut être additionnée"} à la ligne du même produit de la commande n° ${i.separeDe} : corriger ${boites(q)} seulement, pas toute la ligne` : "")
    + " (sinon : Contrôle des écarts, onglet Péremptions)";
};

// Mention de l'e-mail de commande (envoyé à Elixir seulement) ; vide pour toute autre ligne. aPart : { numero, de } quand la
// ligne part dans une commande à part (numéros des deux commandes du site)
export const mentionMail = (i, aPart = null) => {
  if (!estPeremption(i)) return "";
  const { remise, facture_odoo } = remiseLigne(i);
  const quoi = facture_odoo ? `remise ${pctTexte(remise)} facturée par Odoo` : remise >= 1 ? `${pctTexte(remise)}, prix de la page` : "au prix habituel";
  const consigne = consigneOdoo({ ...i, separeDe: aPart ? aPart.de ?? "?" : i.separeDe });
  return ` — PÉREMPTION COURTE (${notePeremption(i.peremption)}, ${quoi})`
    + (aPart ? `\n  Commande à part${aPart.numero ? ` n° ${aPart.numero}` : ""} (même produit dans la commande n° ${aPart.de ?? "?"})` : "")
    + (consigne ? `\n  ⚠ ${consigne}` : "");
};

// Même produit sur une autre ligne du panier (menu, Saisie) : ce que fait PharmaML de deux lignes du même CIP dans UNE
// commande n'est pas connu (jamais observé) ; deux commandes du même produit, si (le connecteur Odoo additionne les
// quantités). La ligne péremption part donc dans une commande à part, enregistrée et relayée juste après l'autre ; ses
// lignes portent separeDe (n° de l'autre commande). L'anti-doublon du relais (_relais.js, envoiAuto) distingue une ligne
// péremption : « Hec 3 au menu » et « Hec 3 en péremption » ne sont pas deux commandes identiques.
export function separerPeremption(items) {
  const ailleurs = new Set(items.filter(i => !estPeremption(i) && i.cip).map(i => String(i.cip)));
  const separe = items.filter(i => estPeremption(i) && i.cip && ailleurs.has(String(i.cip)));
  return { principal: separe.length ? items.filter(i => !separe.includes(i)) : items, separe };
}
// ligne péremption du panier qui partira dans une commande à part (explication affichée sous la ligne)
export const partiraAPart = (item, items) => estPeremption(item) && !!item.cip
  && items.some(j => j !== item && !estPeremption(j) && j.cip === item.cip);

// « − » de l'accueil : quantité des lignes d'un CIP ramenée à n → [[ligne, nouvelle quantité], …]. L'accueil ne compte et
// ne baisse que les lignes des menus et de la Saisie (App.jsx, qteAccueil et modifierQte) : la ligne péremption, à un autre
// prix que la carte, ne se modifie que depuis le panier. Si une ligne péremption est passée, elle baisse en dernier.
export function baisseParCip(lignes, n) {
  const total = lignes.reduce((t, l) => t + (l.qty || 0), 0);
  let reste = total - Math.max(0, parseInt(n) || 0);
  if (reste < 0) {   // hausse (non utilisée par l'accueil) : sur la ligne d'un menu, sinon la première
    const l = lignes.find(x => !estPeremption(x)) || lignes[0];
    return l ? [[l, l.qty - reste]] : [];
  }
  const out = [];
  for (const l of [...lignes.filter(x => !estPeremption(x)), ...lignes.filter(estPeremption)]) {
    if (reste <= 0) break;
    const q = Math.max(0, l.qty - reste);
    reste -= l.qty - q;
    out.push([l, q]);
  }
  return out;
}

// ── Panier enregistré : contrôle des lignes péremption (controlerPrixPanier d'App.jsx, hors zones protégées) ──
// Le panier (localStorage) garde le prix du moment de l'ajout. Au chargement, à l'ouverture et à la fermeture du panier, au
// changement de pharmacie et au retour sur l'onglet, la page est relue :
//  • « page »     : ligne péremption dont le produit est encore sur la page → prix, remise, facturation et date de l'offre
//                   ACTUELLE (à la hausse comme à la baisse : remise changée par l'admin, règle Odoo posée ou retirée) ;
//  • « sortie »   : produit qui a quitté la page (date, lot court épuisé ou en quarantaine) → la ligne redevient une ligne
//                   ordinaire au prix habituel (App la rajoute par addItemToCart : ligne du menu s'il y en a une) ;
//  • « ancienne » : ligne ordinaire d'un panier de l'ancienne page (avant le 20/10/2026 : prix de base × 0,5, ou × 0,8 dès
//                   500 €, sans mention) dont le produit est sur la page → ligne péremption à l'offre actuelle.
// Article multi-CIP (supplier_code) et ligne sans CIP : jamais touchés. Une ligne péremption dont le produit est introuvable
// (ni sur la page, ni dans horsPage) est rendue dans « inconnus » (App demande son prix habituel, puis recontrôle).
// produits : produits de la page ; horsPage : prix habituel de produits absents de la page (masques, retirees, prix).
export function controleLignes(lignes, { produits = [], horsPage = [], remises = null } = {}) {
  const page = new Map(), hors = new Map();
  for (const p of Array.isArray(produits) ? produits : []) if (p?.cip && !page.has(p.cip)) page.set(p.cip, p);
  for (const p of Array.isArray(horsPage) ? horsPage : []) if (p?.cip && !hors.has(p.cip)) hors.set(p.cip, p);
  const changes = [], inconnus = [];
  for (const s of Array.isArray(lignes) ? lignes : []) {
    if (!s?.cip || s.supplier_code) continue;
    const avant = { pn: num(s.pn), ...remiseLigne(s), peremption: s.peremption ?? null };
    const p = page.get(s.cip);
    if (estPeremption(s)) {
      if (p) {
        const o = offreAffichee(p, remises);
        if (!(o.pn > 0)) continue;
        const date = jourPeremption(p.earliest_expiry);
        const memePrix = avant.pn != null && Math.abs(avant.pn - o.pn) < ECART_PRIX;
        if (memePrix && avant.remise === o.remise && avant.facture_odoo === o.facture_odoo && s.peremption === date && !("peremption_remise" in s)) continue;
        changes.push({ type: "page", cip: s.cip, name: s.name || p.name || s.cip, qty: s.qty, avant,
          apres: { pn: o.pn, pv: o.base ?? num(p.list_price), tiers: o.tiers, remise: o.remise, facture_odoo: o.facture_odoo, peremption: date }, prixChange: !memePrix });
        continue;
      }
      const h = hors.get(s.cip);
      const hab = h ? prixPage(h) : null;
      if (hab?.pn > 0) changes.push({ type: "sortie", cip: s.cip, name: s.name || h.name || s.cip, qty: s.qty, avant, apres: { pn: hab.pn, pv: hab.pv, tiers: hab.tiers } });
      else inconnus.push(s.cip);
      continue;
    }
    if (!p || avant.pn == null) continue;
    const base = num(p.list_price) || 0;
    const ancienne = base > 0 && Math.abs(avant.pn - centimes(base * (base >= SEUIL_CHER ? 0.8 : 0.5))) < ECART_PRIX && avant.pn < (prixPage(p).pn ?? 0) - ECART_PRIX;
    if (!ancienne) continue;
    const o = offreAffichee(p, remises);
    if (!(o.pn > 0)) continue;
    changes.push({ type: "ancienne", cip: s.cip, name: s.name || p.name || s.cip, qty: s.qty, avant,
      apres: { pn: o.pn, pv: o.base ?? base, tiers: o.tiers, remise: o.remise, facture_odoo: o.facture_odoo, peremption: jourPeremption(p.earliest_expiry) }, prixChange: Math.abs(avant.pn - o.pn) >= ECART_PRIX });
  }
  return { changes, inconnus: [...new Set(inconnus)] };
}
// Lignes du panier après le contrôle → { lignes, aRajouter } (même tableau si rien ne change : pas de rendu inutile).
// aRajouter : lignes « sortie », à remettre au panier comme un ajout ordinaire (App : addItemToCart, sans ouvrir le panier).
export function appliquerControle(lignes, changes) {
  if (!changes?.length) return { lignes, aRajouter: [] };
  const parCle = new Map(changes.map(c => [`${c.type === "ancienne" ? "" : "per:"}${c.cip}`, c]));
  const aRajouter = [];
  let out = [];
  for (const s of lignes) {
    const c = s && !s.supplier_code && s.cip ? parCle.get(estPeremption(s) ? `per:${s.cip}` : s.cip) : null;
    if (!c) { out.push(s); continue; }
    if (c.type === "sortie") { aRajouter.push({ cip: s.cip, name: s.name, qty: s.qty, pn: c.apres.pn, pv: c.apres.pv, tiers: c.apres.tiers }); continue; }
    const { peremption_remise, ...reste } = s;   // eslint-disable-line no-unused-vars
    out.push({ ...reste, pn: c.apres.pn, pv: c.apres.pv, tiers: c.apres.tiers, peremption: c.apres.peremption, remise: c.apres.remise, facture_odoo: c.apres.facture_odoo });
  }
  // « ancienne » devenue ligne péremption alors qu'une ligne péremption du même CIP existait : une seule ligne, quantités additionnées
  const vues = new Map();
  out = out.reduce((acc, s) => {
    if (!estPeremption(s)) { acc.push(s); return acc; }
    const id = idSpecial(s);
    if (!vues.has(id)) { vues.set(id, acc.length); acc.push(s); return acc; }
    const k = vues.get(id);
    acc[k] = { ...acc[k], qty: (parseInt(acc[k].qty) || 0) + (parseInt(s.qty) || 0) };
    return acc;
  }, []);
  return { lignes: out, aRajouter };
}
const nomCourt = (n) => { const t = String(n ?? "").trim(); return t.length > 32 ? `${t.slice(0, 31).trimEnd()}…` : t; };
const liste2 = (cs, f) => cs.slice(0, 2).map(f).join(", ") + (cs.length > 2 ? ` et ${cs.length - 2} autre${cs.length > 3 ? "s" : ""}` : "");
// Message affiché après le contrôle (flash d'App.jsx) ; vide si aucun prix ne change (date seule mise à jour)
export function messageControle(changes) {
  const page = (changes || []).filter(c => c.type !== "sortie" && c.prixChange), sortie = (changes || []).filter(c => c.type === "sortie");
  const offre = (c) => `${nomCourt(c.name)} : ${euros(c.apres.pn)}${c.apres.remise >= 1 ? `, ${pctTexte(c.apres.remise)}` : ", prix habituel"}`;
  return [page.length ? `Péremption courte : prix de la page mis à jour (${liste2(page, offre)})` : "",
    sortie.length ? `Plus en péremption courte, ligne remise au prix habituel (${liste2(sortie, c => `${nomCourt(c.name)} : ${euros(c.apres.pn)}`)})` : ""].filter(Boolean).join(" · ");
}
// Encart de la ligne du panier mise à jour (texte après « Prix mis à jour : »)
export const detailControle = (c) => `${euros(c.apres.pn)} au lieu de ${c.avant?.pn != null ? euros(c.avant.pn) : "—"}`
  + (c.type === "sortie" ? " : le produit n'est plus en péremption courte (prix habituel)"
    : c.type === "ancienne" ? ` : prix de la page Péremption courte${c.apres.remise >= 1 ? ` (${pctTexte(c.apres.remise)})` : ""}`
    : c.apres.facture_odoo ? ` : remise ${pctTexte(c.apres.remise)} facturée par Odoo` : c.apres.remise >= 1 ? ` : prix actuel de la page (${pctTexte(c.apres.remise)})` : " : prix habituel (plus de remise péremption)");
