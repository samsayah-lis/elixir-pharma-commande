// ── Contingentement dans la ligne de l'article (demande des pharmacies, 23/10/2026 ; docs/contingentement-ligne.md) ──
// Textes de la pastille « Contingenté : 10 par semaine (lundi–dimanche) · reste 4 » : fonctions pures, chargées avec la
// pastille (src/components/quota/PastilleQuota.jsx, à la demande) et testées hors ligne (scripts/test-quota.mjs). Règle :
// celle du panier (quotaOver de src/App.jsx, qui bloque l'envoi) — quantités du CIP au panier additionnées (check.inCart),
// dépassement dès que panier + quantité saisie pas encore ajoutée > reste. La pastille n'est donc jamais plus permissive que
// le contrôle final. Rien : pharmacie dispensée (deny_quota), produit hors de la liste. Reste pas encore lu : « vérification… »
// (« mise à jour… » après l'envoi d'une commande) — la place est prise dès le premier rendu, rien ne saute à l'arrivée du
// reste. Reste illisible (Odoo injoignable, session ; compte sans fiche Odoo : seules les commandes du site comptées) :
// « reste non vérifié » — le panier ne bloque pas non plus (sauf au-delà de ce qu'il a pu compter : rouge, comme lui).

const nbJours = (days) => Math.max(1, Math.floor(Number(days) || 1));
const lendemain = (s) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// espaces insécables : « reste 8 », « 1 de trop », « 3 au panier » ne se coupent jamais en fin de ligne
const nb = (s) => s.replace(/ /g, " ");
const pl = (n) => (n > 1 ? "s" : "");

// « AAAA-MM-JJ » → « lun. 26 oct. » : le format du panier (quotaDay de src/App.jsx), affiché à côté
export const jourQuota = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Période de quota_period (module Odoo edi_healthsoft) en clair : court (pastille), unite (pastille compacte « 6/semaine »),
// detail (bulle : bornes de la décade et de la quinzaine) ; null si inconnue
export function periodeQuota(period, days) {
  switch (String(period)) {
    case "-1": return { court: "par semaine (lundi–dimanche)", unite: "semaine", detail: "par semaine, du lundi au dimanche" };
    case "-2": return { court: "par décade", unite: "décade", detail: "par décade : du 1er au 10, du 11 au 20, du 21 à la fin du mois" };
    case "-3": return { court: "par quinzaine", unite: "quinzaine", detail: "par quinzaine : du 1er au 15, du 16 à la fin du mois" };
    case "-4": return { court: "par mois", unite: "mois", detail: "par mois, du 1er à la fin du mois" };
    case "1": {
      const n = nbJours(days);
      return n === 1 ? { court: "par jour", unite: "jour", detail: "par jour" }
        : { court: `sur ${n} jours glissants`, unite: `${n} jours`, detail: `sur ${n} jours glissants (aujourd'hui et ${n === 2 ? "la veille" : `les ${n - 1} jours précédents`})` };
    }
    default: return null;
  }
}

// Jour du nouveau quota (« AAAA-MM-JJ ») d'une ligne de quota-status : fin de la période en cours (end, exclue) ; un seul
// jour glissant : demain ; plusieurs : inconnu (les commandes sortent de la fenêtre une à une) → null
export function prochainQuota(q) {
  if (q?.end) return q.end;
  if (String(q?.period) === "1" && nbJours(q.days) === 1 && q.start) return lendemain(q.start);
  return null;
}

// Pastille d'une ligne d'article. ctx (App) : { liste (quota-liste), quota (réponse de quota-status pour la pharmacie
// affichée, null tant qu'elle n'est pas lue ou après un envoi), check (quotaOver(quota, panier) : inCart par CIP), ko (lecture
// en échec), attente (commande envoyée, reste à relire) }. o : { saisie (quantité qui partira, pas encore ajoutée au panier :
// Saisie arrondie au colis, Péremption courte), tape (quantité tapée, si l'arrondi la change), pas (colis ou lot : quantité
// d'un ajout), forme : longue par défaut (Saisie, liste mobile : rangée à part, sous les boutons), « moyenne » (tableaux, recherche,
// accueil : période en clair, état court — « encore 5 », « 1 de trop », « quota atteint » — de longueur à peu près constante :
// la ligne ne change pas de hauteur d'un état à l'autre), « courte » (cartes, tuiles : « 6/semaine · encore 5 ») ; le détail
// (panier, saisie, nouveau quota) est toujours dans la bulle }.
// → null (rien à afficher) ou { ton, regle, etat, bulle, trop, nom }
export function pastilleQuota(ctx, cip, o = {}) {
  const r = cip && ctx?.liste?.[cip];
  if (!r) return null;
  const quota = ctx.quota;
  if (quota?.exempt) return null;                                   // pharmacie dispensée : rien
  const q = quota?.products?.[cip];
  if (quota && !q) return null;                                     // plus contingenté (liste plus ancienne que le reste)
  const s = q || r, p = periodeQuota(s.period, s.days);
  if (!p) return null;
  const compact = o.forme === "courte" || o.forme === "moyenne", regle = o.forme === "courte" ? `${s.quota}/${p.unite}` : `${s.quota} ${p.court}`;
  const loi = `Contingentement : ${s.quota} au plus ${p.detail}.`;
  if (!q) return ctx.ko
    ? { ton: "neutral", regle, etat: nb("reste non vérifié"), trop: 0, bulle: `${loi} Le reste n'a pas pu être lu : Odoo applique le contingentement à la réception de la commande.` }
    : { ton: "neutral", regle, etat: ctx.attente ? "mise à jour…" : "vérification…", trop: 0, bulle: loi };
  const reste = Math.max(0, Number(q.remaining) || 0);
  const panier = Math.max(0, Number(ctx.check?.inCart?.[cip]) || 0);
  const n = Math.max(0, parseInt(o.saisie) || 0), tape = Math.max(0, parseInt(o.tape) || 0);
  const pas = Math.max(1, parseInt(o.pas) || 1);
  const trop = panier + n - reste, libre = -trop;
  const possible = Math.floor(Math.max(0, libre) / pas) * pas;   // ce qu'on peut encore ajouter, au pas du colis
  const jour = prochainQuota(q);
  const renouvele = jour ? nb(`nouveau quota le ${jourQuota(jour)}`) : String(q.period) === "1" ? "se libère au fil des jours" : "";
  const ou = [panier > 0 && nb(`${panier} au panier`),
    n > 0 && (tape && tape !== n ? nb(`${tape} saisi${pl(tape)} → ${n}`) + (pas > 1 ? nb(" (colis)") : "") : nb(`${n} saisi${pl(n)}`))].filter(Boolean).join(" + ");
  const rr = nb(`reste ${reste}`), deja = Math.max(0, Number(q.used) || 0);
  const nonLu = quota.identified === false;   // compte sans fiche Odoo : seules les commandes du site sont comptées
  let ton = "info", etat;
  if (trop > 0) {
    ton = "danger";
    etat = compact ? nb(`${trop} de trop`) : `${reste > 0 ? rr : "quota atteint"} · ${ou} : ${nb(`${trop} de trop`)}${reste > 0 || !renouvele ? "" : ` · ${renouvele}`}`;
  } else if (nonLu) {
    ton = "neutral"; etat = nb("reste non vérifié");
  } else if (reste === 0) {
    ton = "warn"; etat = compact || !renouvele ? "quota atteint" : `quota atteint · ${renouvele}`;
  } else if (!ou && pas > reste) {
    ton = "warn"; etat = compact ? `${rr} · ${nb(`par ${pas}`)}` : `${rr} · se commande par ${pas} : pas possible sur cette période`;
  } else if (!ou) etat = rr;
  else if (possible > 0) etat = compact ? nb(`encore ${possible}`) : `${rr} · ${ou} : ${nb(`encore ${possible} possible${pl(possible)}`)}`;
  else etat = compact ? "rien de plus" : `${rr} · ${ou} : rien de plus possible`;
  const bulle = nonLu
    ? `${loi} Commandes passées sur le site pendant la période : ${deja}. Les autres commandes n'ont pas pu être comptées (compte sans fiche Elixir) : Odoo applique le contingentement à la réception de la commande.`
    : `${loi} Déjà commandé sur la période : ${deja} (commandes passées et commandes du site pas encore transmises). Reste : ${reste}.`
      + `${panier > 0 ? ` Au panier : ${panier}.` : ""}${pas > 1 ? ` Se commande par ${pas}.` : ""}${jour ? ` Nouveau quota le ${jourQuota(jour).replace(/\.?$/, ".")}` : ""} Le panier refuse l'envoi au-delà du reste.`;
  return { ton, regle, etat, trop: Math.max(0, trop), bulle, nom: q.name || "" };
}
