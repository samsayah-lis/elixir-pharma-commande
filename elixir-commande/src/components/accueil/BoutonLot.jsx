// ── Ajout au panier depuis la vitrine : « Ajouter un carton de 120 · 361,20 € HT », puis sélecteur « − 120 au panier + » ──
// Quantité et montant affichés AVANT le toucher (montant = applyTiers(pn, paliers, lot) × lot : ce que le panier facture),
// jamais rognés : bouton trop étroit pour une ligne (tablette, étiquette étroite, petit téléphone) → deux lignes, le lot
// puis le montant (mesuré : ResizeObserver sur la largeur). Prix du palier compris dans le lot : « soit 1,67 € HT la boîte ».
// Le bouton central est toujours le même nœud : après l'ajout, le focus y reste (il devient « 120 au panier », qui ouvre
// le panier) ; − et + apparaissent de part et d'autre ; à 0, il redevient « Ajouter ». Catalogue pas encore chargé :
// bouton désactivé, « Chargement des prix… » (sans lui, un produit d'un menu partirait au mauvais prix).
// compacte (petites tuiles de la grille à la une) : « Ajouter » seul (lot et montant écrits au-dessus par la tuile, nom
// accessible complet), puis le même sélecteur − n + ; « n au panier » trop large pour le bouton (petite tuile : 48 px à
// 375 px) → la quantité seule (data-court, mesuré comme les deux lignes ; « au panier » reste dans le nom accessible) ;
// desactive (aperçu de l'admin) : bouton inerte, « Aperçu : ajout désactivé ».
import React, { useLayoutEffect, useRef } from "react";
import { Icone } from "../../icons.jsx";
import { fmtEur } from "../../theme.js";
import { libelleLot } from "./outils.js";

export default function BoutonLot({ offre, nom, qte = 0, pret = true, inactif = false, compacte = false, desactive = false, onAjouter, onModifier, onOuvrirPanier }) {
  const lot = offre.lot || { qte: 1, total: offre.pn, pu: offre.pn };
  const pas = Math.max(1, offre.regle?.step || 1);
  const carton = offre.menu?.key === "stratege" && pas > 1;
  const unite = pas > 1 ? `${carton ? "un carton" : "un lot"} de ${pas}` : "une boîte";
  const plein = qte > 0 && pret;
  const refCentre = useRef(null), refLot = useRef(null);
  // retour à 0 par « − » : le focus passe au bouton central (redevenu « Ajouter ») avant que « − » ne disparaisse
  const retirer = () => { const n = qte - pas < (offre.regle?.min || 1) ? 0 : qte - pas; if (n === 0) refCentre.current?.focus(); onModifier(n); };
  const tab = inactif ? -1 : undefined;
  const quoi = lot.qte > 1 ? `Ajouter ${offre.menu?.key === "stratege" ? "un carton" : "un lot"} de ${lot.qte}` : "Ajouter 1 boîte";
  const montant = `${fmtEur(lot.total)} HT`;
  const libelleAjout = `Ajouter au panier : ${nom}, ${lot.qte > 1 ? `${libelleLot(lot.qte, offre.menu?.key)} boîtes` : "1 boîte"}, ${montant}`;
  const palier = pret && !plein && lot.pu != null && offre.pn != null && lot.pu < offre.pn;
  const centre = desactive ? { onClick: undefined, "aria-disabled": "true", "aria-label": `${libelleAjout} (aperçu : ajout désactivé)` }
    : !pret
    ? { onClick: undefined, "aria-disabled": "true", "aria-label": `Ajouter au panier : ${nom}, chargement des prix` }
    : plein
      ? { onClick: onOuvrirPanier, "aria-label": `${qte} au panier, ouvrir le panier` }
      : { onClick: () => onAjouter(lot.qte), "aria-label": libelleAjout };

  // une ligne si elle tient, sinon deux ; « n au panier » qui ne tient pas : la quantité seule (attributs posés
  // directement : ce n'est qu'une mise en page). Remesuré à la fin de l'ouverture du sélecteur (colonnes − et + qui
  // s'élargissent en 200 ms : au premier rendu, le bouton central a encore toute la largeur)
  useLayoutEffect(() => {
    const b = refCentre.current, l = refLot.current;
    if (!b || !l) return undefined;
    // débordement réel (largeur du texte au demi-pixel, pas scrollWidth arrondi : « 240 au panier » de 95,09 px dans
    // 94 px passait pour entier, rogné d'1 px dans une petite tuile à 1 280 px)
    const deborde = (el) => {
      if (el.scrollWidth > el.clientWidth + 1) return true;
      try { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.5; } catch { return false; }
    };
    const mesure = () => {
      b.removeAttribute("data-lignes"); b.removeAttribute("data-court");
      const t = b.querySelector(".acc-lot-textes"), q = b.querySelector(".acc-lot-qte");
      if (t && deborde(t)) b.setAttribute("data-lignes", "2");
      if (q && deborde(q)) b.setAttribute("data-court", "");
    };
    mesure();
    let largeur = l.clientWidth;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (l.clientWidth !== largeur) { largeur = l.clientWidth; mesure(); } }) : null;
    ro?.observe(l);
    const finTransition = (ev) => { if (ev.target === l) mesure(); };
    l.addEventListener("transitionend", finTransition);
    const t = setTimeout(mesure, 260);
    return () => { ro?.disconnect(); l.removeEventListener("transitionend", finTransition); clearTimeout(t); };
  }, [quoi, montant, plein, pret, qte]);

  return (
    <div ref={refLot} className="acc-lot" data-plein={plein ? "" : undefined}>
      <button type="button" className="acc-lot-pas acc-lot-moins" tabIndex={plein ? tab : -1} aria-hidden={plein ? undefined : "true"} disabled={!plein}
        aria-label={`Retirer ${unite}`} onClick={retirer}><Icone nom="moins" taille={18} epaisseur={2.4} /></button>
      <button ref={refCentre} type="button" className={`acc-lot-centre${pret ? "" : " acc-lot-centre--attente"}`} tabIndex={tab} {...centre}>
        {!pret ? <span>Chargement des prix…</span>
          : plein ? <span className="acc-lot-qte num"><b>{qte}</b><span className="acc-lot-suffixe"> au panier</span></span>
          : <><Icone nom="plus" taille={17} epaisseur={2.6} />
            {compacte ? <span className="acc-lot-textes"><span className="acc-lot-quoi">Ajouter</span></span>
              : <span className="acc-lot-textes"><span className="acc-lot-quoi">{quoi}</span><span className="acc-lot-sep" aria-hidden="true">·</span><span className="acc-lot-montant num">{montant}</span></span>}</>}
      </button>
      <button type="button" className="acc-lot-pas acc-lot-plus" tabIndex={plein ? tab : -1} aria-hidden={plein ? undefined : "true"} disabled={!plein}
        aria-label={`Ajouter ${unite}`} onClick={() => onAjouter(pas)}><Icone nom="plus" taille={18} epaisseur={2.4} /></button>
      {palier && !compacte && <p className="acc-lot-note num" aria-hidden="true">soit {fmtEur(lot.pu)} HT la boîte, palier compris</p>}
    </div>
  );
}
