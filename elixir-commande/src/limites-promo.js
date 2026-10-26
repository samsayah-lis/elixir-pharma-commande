// ── Limites de quantité des menus promo et des précommandes (26/10/2026, docs/limites-promo.md) ──
// Deux limites facultatives par produit d'un menu promo (onglet Promos de l'admin, admin_promos) :
//  • maxPharmacie : boîtes qu'une pharmacie peut commander au plus, toutes ses commandes additionnées ;
//  • maxTotal : boîtes commandées au plus par l'ensemble des pharmacies (allocation du laboratoire).
// Menus actifs seulement. Comptées par CIP depuis l'ajout du produit au menu (son identifiant est sa date d'ajout), quel que
// soit le menu ou le canal de la commande (site, saisie Elixir, API). Ne comptent pas : une commande supprimée dans l'admin, une
// commande non vérifiée de la quarantaine d'order-save (source « a_verifier »), une ligne retirée par l'API (rupture, annulation :
// handled_at + api_motif, jamais envoyée). Une ligne traitée par l'admin (« Traiter sans envoi » : handled_at seul) compte.
// Un CIP limité dans deux menus actifs : chaque menu garde sa règle, comptée depuis l'ajout du produit à CE menu ; la plus
// restrictive l'emporte. JS pur, partagé par le site (pastille, panier), l'admin (saisie) et le serveur (_promo-limites.js).

// limite saisie → entier ≥ 1, sinon null (pas de limite)
export const entierLimite = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};
const dateMs = (v) => { const n = Number(v); return Number.isFinite(n) && n > 1.6e12 && n < 4e12 ? n : null; };
const minNul = (a, b) => a == null ? b : b == null ? a : Math.min(a, b);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// Début du comptage d'un produit : sa date d'ajout au menu (identifiant), sinon la création du menu
export const depuisProduit = (promo, prod) => dateMs(prod?.id) ?? dateMs(promo?.id) ?? 0;

// admin_promos → { <CIP>: { cip, nom, menu, parPharmacie, total, depuis, regles } } (produits limités des menus actifs) ;
// regles : une par menu (menu, parPharmacie, total, depuis) ; parPharmacie, total : les plus basses (affichage, panier pas encore
// lu) ; depuis : la plus ancienne (fenêtre de lecture des commandes)
export function limitesActives(promos) {
  const out = {};
  for (const ps of Array.isArray(promos) ? promos : []) {
    if (!ps?.active) continue;
    for (const p of Array.isArray(ps.products) ? ps.products : []) {
      const cip = String(p?.cip ?? "").trim(), parPharmacie = entierLimite(p?.maxPharmacie), total = entierLimite(p?.maxTotal);
      if (!/^\d{7,13}$/.test(cip) || (!parPharmacie && !total)) continue;
      const r = { menu: String(ps.name || ""), parPharmacie, total, depuis: depuisProduit(ps, p) }, a = out[cip];
      out[cip] = a ? { ...a, parPharmacie: minNul(a.parPharmacie, parPharmacie), total: minNul(a.total, total), depuis: Math.min(a.depuis, r.depuis), regles: [...a.regles, r] }
        : { cip, nom: String(p.name || cip), ...r, regles: [r] };
    }
  }
  return out;
}

// Lignes d'une commande enregistrée (elixir_orders.items : tableau, parfois en texte)
export const lignesCommande = (items) => {
  let v = items;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = []; } }
  return Array.isArray(v) ? v : [];
};

// Quantités déjà commandées par CIP limité → { <CIP>: { pharmacie, total } }.
// commandes : lignes elixir_orders { id, date, items, … } ; dePharmacie(commande) : true pour une commande de la pharmacie
// (absent : totaux seuls) ; sauf : numéro de commande ignoré (le même numéro renvoyé après une réponse perdue)
export function quantitesCommandees(commandes, limites, dePharmacie = null, sauf = null) {
  const out = {};
  for (const cip of Object.keys(limites)) out[cip] = { pharmacie: 0, total: 0 };
  for (const o of commandes || []) {
    // quarantaine d'order-save (page d'avant le correctif du 19/10, sans jeton) : données non vérifiées, comme pour le contingentement
    if (!o || o.source === "a_verifier" || (sauf != null && String(o.id) === String(sauf))) continue;
    const t = Date.parse(o.date), mienne = !!dePharmacie?.(o);
    for (const it of lignesCommande(o.items)) {
      const l = limites[String(it?.cip ?? "")];
      // ligne retirée par l'API : handled_at ET api_motif (marquerLignes), jamais envoyée ; un api_motif seul, venu de la page, ne
      // retire rien (le relais l'enverrait)
      if (!l || (it.api_motif && it.handled_at && !it.synced_at) || !(t >= l.depuis)) continue;
      const q = Math.max(0, parseInt(it.qty) || 0);
      out[l.cip].total += q;
      if (mienne) out[l.cip].pharmacie += q;
    }
  }
  return out;
}

// Ce que la pharmacie peut encore commander : la plus basse des deux limites → { reste, motif: "pharmacie" | "total", deja }
// (deja : ce que la pharmacie a déjà commandé)
export function resteLimite(l, deja) {
  const rp = l.parPharmacie != null ? Math.max(0, l.parPharmacie - (deja?.pharmacie || 0)) : null;
  const rt = l.total != null ? Math.max(0, l.total - (deja?.total || 0)) : null;
  return { reste: minNul(rp, rt), motif: rt != null && (rp == null || rt < rp) ? "total" : "pharmacie", deja: deja?.pharmacie || 0 };
}

// État d'un CIP limité : la plus restrictive des règles de ses menus, chacune comptée depuis l'ajout du produit à son menu →
// { reste, motif, deja, parPharmacie (de la règle qui bloque), dejaTotal, parMenu: { <menu>: déjà commandé, toutes pharmacies } }.
// dePharmacie absent : totaux seuls (reste au total).
export function etatLimite(commandes, l, dePharmacie = null, sauf = null) {
  let pire = null;
  const parMenu = {};
  for (const r of l.regles || [l]) {
    const d = quantitesCommandees(commandes, { [l.cip]: { ...r, cip: l.cip } }, dePharmacie, sauf)[l.cip];
    const e = { ...resteLimite(r, dePharmacie ? d : { pharmacie: 0, total: d.total }), parPharmacie: r.parPharmacie, dejaTotal: d.total };
    parMenu[r.menu] = d.total;
    if (!pire || e.reste < pire.reste) pire = e;
  }
  return { ...pire, parMenu };
}

// Lignes (panier, commande) au-delà de ce qui reste → { panier: { <CIP>: quantité }, over: [{ cip, nom, demande, reste, motif,
// deja, parPharmacie }] }. Plusieurs lignes d'un même CIP sont additionnées. etat : { <CIP>: etatLimite } lu par promo-limites ;
// absent (pas encore lu, panne) : limites seules, rien de déjà commandé (une commande au-delà de la limite est toujours refusée)
export function depassementsLimites(lignes, limites, etat) {
  const panier = {}, over = [];
  for (const i of lignes || []) if (i?.cip && limites[i.cip]) panier[i.cip] = (panier[i.cip] || 0) + Math.max(0, parseInt(i.qty) || 0);
  for (const [cip, n] of Object.entries(panier)) {
    const l = limites[cip], e = etat?.[cip] || resteLimite(l, null);
    if (e.reste != null && n > e.reste) over.push({ cip, nom: l.nom, demande: n, reste: e.reste, motif: e.motif, deja: e.deja || 0, parPharmacie: e.parPharmacie ?? l.parPharmacie });
  }
  return { panier, over };
}

// Motif d'un refus (order-save, panier) : ce qui bloque et ce qui reste possible
export function messageDepassement(o) {
  if (o.motif === "total") return o.reste > 0 ? `${o.nom} : quantité limitée, plus que ${pluriel(o.reste, "boîte")} disponible${o.reste > 1 ? "s" : ""} pour cette offre (${o.demande} demandée${o.demande > 1 ? "s" : ""})`
    : `${o.nom} : quantité limitée, plus rien de disponible pour cette offre`;
  return `${o.nom} : ${o.parPharmacie} au plus par pharmacie pour cette offre${o.deja > 0 ? ` (déjà commandé : ${o.deja})` : ""}, ${o.reste > 0 ? `encore ${o.reste} possible${o.reste > 1 ? "s" : ""}` : "plus rien de possible"}`;
}

// Pastille d'une ligne d'article et encart du panier → { ton, regle, etat, bulle } ou null.
// l : limite du CIP ; e : resteLimite lu par promo-limites (absent : limite seule) ; auPanier : quantité de ce CIP au panier.
// Tons de theme.js : info (reste), warn (limite atteinte, épuisé), danger (au-delà : le panier refusera l'envoi)
export function pastilleLimite(l, e, auPanier = 0) {
  if (!l) return null;
  const regle = l.parPharmacie ? `${l.parPharmacie} max par pharmacie` : "quantité limitée";
  const debut = l.parPharmacie
    ? `Offre limitée à ${pluriel(l.parPharmacie, "boîte")} par pharmacie, toutes vos commandes additionnées${l.total ? " (quantité totale limitée aussi)" : ""}.`
    : "Quantité totale limitée pour l'ensemble des pharmacies.";
  if (!e || e.reste == null) {   // pas encore lu : la limite seule (au-delà, refusé quoi qu'il soit déjà commandé)
    const max = resteLimite(l, null).reste, trop = auPanier > max ? auPanier - max : 0;
    return { ton: trop ? "danger" : "info", regle, etat: trop ? `${trop} de trop` : "", bulle: trop ? `${debut} Le panier refusera l'envoi.` : debut };
  }
  const { reste, motif, deja } = e, total = motif === "total";
  const detail = [debut, deja > 0 ? `Déjà commandé : ${deja}.` : "", auPanier > 0 ? `Au panier : ${auPanier}.` : "",
    total ? (reste > 0 ? `Plus que ${pluriel(reste, "boîte")} disponible${reste > 1 ? "s" : ""}.` : "Plus rien de disponible.")
      : `Encore possible : ${Math.max(0, reste - auPanier)}.`].filter(Boolean).join(" ");
  if (auPanier > reste) return { ton: "danger", regle, etat: `${auPanier - reste} de trop`, bulle: `${detail} Le panier refusera l'envoi.` };
  if (reste === 0) return { ton: "warn", regle, etat: total ? "épuisé" : "limite atteinte", bulle: detail };
  if (auPanier === reste) return { ton: "info", regle, etat: "rien de plus possible", bulle: detail };
  const libre = reste - auPanier;
  return { ton: "info", regle, etat: total ? `plus que ${libre} disponible${libre > 1 ? "s" : ""}` : `encore ${libre}`, bulle: detail };
}
