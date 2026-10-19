// ── Ajout au panier depuis la vitrine : « Ajouter · carton de 120 · 361,20 € HT », puis sélecteur « − 120 au panier + » ──
// Quantité et montant affichés AVANT le toucher (montant = applyTiers(pn, paliers, lot) × lot : ce que le panier facture).
// Le bouton central est toujours le même nœud : après l'ajout, le focus y reste (il devient « 120 au panier », qui ouvre
// le panier) ; − et + apparaissent de part et d'autre ; à 0, il redevient « Ajouter ». Catalogue pas encore chargé :
// bouton désactivé, « Chargement des prix… » (sans lui, un produit d'un menu partirait au mauvais prix).
import React, { useRef } from "react";
import { Icone } from "../../icons.jsx";
import { fmtEur } from "../../theme.js";
import { libelleLot } from "./outils.js";

export default function BoutonLot({ offre, nom, qte = 0, pret = true, inactif = false, onAjouter, onModifier, onOuvrirPanier }) {
  const lot = offre.lot || { qte: 1, total: offre.pn };
  const pas = Math.max(1, offre.regle?.step || 1);
  const carton = offre.menu?.key === "stratege" && pas > 1;
  const unite = pas > 1 ? `${carton ? "un carton" : "un lot"} de ${pas}` : "une boîte";
  const plein = qte > 0 && pret;
  const refCentre = useRef(null);
  // retour à 0 par « − » : le focus passe au bouton central (redevenu « Ajouter ») avant que « − » ne disparaisse
  const retirer = () => { const n = qte - pas < (offre.regle?.min || 1) ? 0 : qte - pas; if (n === 0) refCentre.current?.focus(); onModifier(n); };
  const tab = inactif ? -1 : undefined;
  const libelleAjout = `Ajouter au panier : ${nom}, ${lot.qte > 1 ? `${libelleLot(lot.qte, offre.menu?.key)} boîtes` : "1 boîte"}, ${fmtEur(lot.total)} HT`;
  const centre = !pret
    ? { onClick: undefined, "aria-disabled": "true", "aria-label": `Ajouter au panier : ${nom}, chargement des prix` }
    : plein
      ? { onClick: onOuvrirPanier, "aria-label": `${qte} au panier, ouvrir le panier` }
      : { onClick: () => onAjouter(lot.qte), "aria-label": libelleAjout };
  return (
    <div className="acc-lot" data-plein={plein ? "" : undefined}>
      <button type="button" className="acc-lot-pas acc-lot-moins" tabIndex={plein ? tab : -1} aria-hidden={plein ? undefined : "true"} disabled={!plein}
        aria-label={`Retirer ${unite}`} onClick={retirer}><Icone nom="moins" taille={18} epaisseur={2.4} /></button>
      <button ref={refCentre} type="button" className={`acc-lot-centre${pret ? "" : " acc-lot-centre--attente"}`} tabIndex={tab} {...centre}>
        {!pret ? <span>Chargement des prix…</span>
          : plein ? <span className="num"><b>{qte}</b> au panier</span>
          : <><Icone nom="plus" taille={17} epaisseur={2.6} /><span><span className="acc-lot-verbe">Ajouter · </span>{libelleLot(lot.qte, offre.menu?.key)} · <span className="num">{fmtEur(lot.total)} HT</span></span></>}
      </button>
      <button type="button" className="acc-lot-pas acc-lot-plus" tabIndex={plein ? tab : -1} aria-hidden={plein ? undefined : "true"} disabled={!plein}
        aria-label={`Ajouter ${unite}`} onClick={() => onAjouter(pas)}><Icone nom="plus" taille={18} epaisseur={2.4} /></button>
    </div>
  );
}
