// ── La grande étiquette Elixir de la tête de gondole (docs/accueil.md § 4.1) ──
// Information commerciale seulement : rang, tendance, rayon, marque, forme et labo, dosages, prix net, PV et remise,
// palier, stock, règle de quantité, popularité (tranche), pouls, ajout au panier, « Voir dans… ». Jamais inclinée.
import React, { useLayoutEffect, useRef } from "react";
import { Icone, ICONES_RAYON } from "../../icons.jsx";
import { applyTiers } from "../../tiers.jsx";
import { alpha, fmtEur, fmtPct } from "../../theme.js";
import Rouleau from "./Rouleau.jsx";
import Pouls from "./Pouls.jsx";
import BoutonLot from "./BoutonLot.jsx";
import { Quota } from "../quota/entree.jsx";
import { prixHT, useDebord } from "./outils.js";

const STOCK = { ok: ["ok", "coche", "En stock"], limite: ["warn", "horloge", "Stock limité"], dernieres: ["warn", "alerte", "Dernières boîtes"] };
export const tendanceMot = (pct) => (pct >= 15 ? "en hausse" : pct <= -15 ? "en baisse" : "stable");

// Dosages : l'unité commune (« mg ») en tête de rangée, puis « 2,5 », « 5 », … ; sans unité commune, le libellé entier.
// Rangée plus large que l'étiquette : défilement horizontal, fondu du côté qui déborde (aucune pastille coupée sans
// indice), pastille cochée toujours ramenée dans la partie visible. Cible de 44 px de haut (lot 9), pastille de 32 px.
function Dosages({ variantes, choix, onChoix, inactif, nom }) {
  const refs = useRef([]), liste = useRef(null);
  const parties = variantes.map(v => /^([\d\s ,]+)\s(\S+)$/.exec(v.libelle || ""));
  const unite = parties.every(p => p && p[2] === parties[0][2]) ? parties[0][2] : null;
  const i0 = Math.max(0, variantes.findIndex(v => v.cip === choix));
  const debord = useDebord(liste, variantes.map(v => v.cip).join());   // "", "g", "d", "gd" : côtés qui débordent
  // pastille cochée dans la partie visible de la rangée (hors du fondu de 28 px), sans faire défiler la page
  useLayoutEffect(() => {
    const l = liste.current, p = refs.current[i0];
    if (!l || !p || l.scrollWidth <= l.clientWidth) return;
    const marge = 28;
    if (p.offsetLeft - marge < l.scrollLeft) l.scrollLeft = Math.max(0, p.offsetLeft - marge);
    else if (p.offsetLeft + p.offsetWidth + marge > l.scrollLeft + l.clientWidth) l.scrollLeft = p.offsetLeft + p.offsetWidth + marge - l.clientWidth;
  }, [i0, variantes.length]);
  const aller = (i) => { const j = (i + variantes.length) % variantes.length; onChoix(variantes[j].cip); refs.current[j]?.focus(); };
  const touche = (e, i) => {
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (k) { e.preventDefault(); aller(i + k); }
    else if (e.key === "Home") { e.preventDefault(); aller(0); }
    else if (e.key === "End") { e.preventDefault(); aller(variantes.length - 1); }
  };
  return (
    <div className="acc-dosages">
      {unite && <span className="acc-dosages-unite" aria-hidden="true">{unite}</span>}
      <div ref={liste} role="radiogroup" aria-label={`Dosage de ${nom}${unite ? ` (${unite})` : ""}`} className="acc-dosages-liste" data-debord={debord || undefined}>
        {variantes.map((v, i) => {
          const coche = i === i0;
          return (
            <button key={v.cip} ref={el => { refs.current[i] = el; }} type="button" role="radio" aria-checked={coche} tabIndex={inactif ? -1 : coche ? 0 : -1}
              className="acc-puce-dosage" onClick={() => onChoix(v.cip)} onKeyDown={e => touche(e, i)}
              aria-label={`${v.libelle}, ${prixHT(v.lot?.pu ?? v.pn)}${v.stock?.niveau !== "ok" ? `, ${STOCK[v.stock?.niveau]?.[2].toLowerCase() || ""}` : ""}`}>
              {unite ? parties[i][1].trim() : v.libelle}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Etiquette({ slide, offre, position, variantes, choix, onChoix, teinte, qte, pret, inactif, mobile, tracer, delaiPouls = 0,
  onAjouter, onModifier, onOuvrirPanier, onVoir }) {
  const tab = inactif ? -1 : undefined;
  const lotQ = offre.lot?.qte || 1;
  const palier = applyTiers(offre.pn, offre.price_tiers, lotQ);
  const [ton, ico, txtStock] = STOCK[offre.stock?.niveau] || STOCK.ok;
  const multiple = offre.regle?.multiple > 1 ? offre.regle.multiple : 0;
  const saisie = offre.menu?.key === "saisie";
  const nomLu = slide.famille.charAt(0) + slide.famille.slice(1).toLowerCase();
  const sous = [offre.boite?.forme, slide.labo].filter(Boolean).join(" · ") || offre.nom_court;
  const tendance = slide.tendance_pct >= 15 ? "En hausse" : slide.nouveau ? "Nouveau dans le classement" : null;
  // mobile : la tranche seule (« Plus de 200 pharmacies »), sur la même rangée que le stock
  const popularite = !offre.popularite ? null : mobile ? offre.popularite : `Commandé par ${offre.popularite.charAt(0).toLowerCase()}${offre.popularite.slice(1)}`;
  const teinteFond = alpha(teinte, 0.14);
  return (
    <div className="acc-etiquette">
      <div className="acc-etiquette-tete">
        {/* mobile : « N°1 » seul (le grand « 01 » de la scène le dit déjà) ; le reste pour les lecteurs d'écran */}
        <span className="acc-bandeau-rang">N°{position}{mobile ? <span className="acc-vh"> des commandes</span> : " des commandes"}</span>
        {tendance && <span className="acc-puce acc-puce--info"><Icone nom={slide.nouveau && !(slide.tendance_pct >= 15) ? "ampoule" : "fleche"} taille={13} style={slide.nouveau && !(slide.tendance_pct >= 15) ? undefined : { transform: "rotate(-45deg)" }} />{tendance}</span>}
        {/* rayon : seulement pour un produit d'un menu (la Saisie de commande est un outil, pas un rayon) */}
        {!saisie && offre.menu?.label && (
          <span className="acc-rayon" style={{ background: typeof teinteFond === "string" && teinteFond.startsWith("rgba(") ? teinteFond : undefined }}>
            <Icone nom={ICONES_RAYON[offre.menu?.key] || "etiquette"} taille={13} />{offre.menu.label}
          </span>
        )}
      </div>
      <h2 className="acc-marque">{slide.famille}</h2>
      <p className="acc-sous-ligne">{sous}</p>
      {variantes.length > 1 && <Dosages variantes={variantes} choix={choix} onChoix={onChoix} inactif={inactif} nom={nomLu} />}
      <div className="acc-prix-bloc">
        {!mobile && <span className="acc-eyebrow">Prix net HT</span>}
        <div className="acc-prix-ligne">
          <span className="acc-prix num"><span className="acc-vh">{prixHT(offre.pn)}</span><Rouleau texte={fmtEur(offre.pn)} /><span className="acc-prix-ht" aria-hidden="true">HT</span></span>
          {offre.pct > 0 && <span className="acc-badge-remise num">{fmtPct(offre.pct)}</span>}
        </div>
        <p className="acc-pv num">PV {fmtEur(offre.pv)}{offre.remise_eur > 0 ? ` · remise ${fmtEur(offre.remise_eur)}` : ""}</p>
      </div>
      {palier.tier ? <span className="acc-palier acc-palier--atteint num"><Icone nom="etiquette" taille={13} />{fmtEur(palier.tier.price)} dès {palier.tier.min_qty} · palier compris</span>
        : palier.next ? <span className="acc-palier acc-palier--suivant num"><Icone nom="etiquette" taille={13} />{fmtEur(palier.next.price)} dès {palier.next.min_qty}</span> : null}
      <ul className="acc-faits">
        <li className={`acc-puce acc-puce--${ton}`}><Icone nom={ico} taille={14} />{txtStock}</li>
        {/* mobile : le bouton dit déjà « Ajouter un carton de 120 » */}
        {multiple > 0 && !mobile && <li className="acc-puce"><Icone nom="carton" taille={14} />Se commande par {offre.menu?.key === "stratege" ? "carton" : "lot"} de {multiple}</li>}
        {popularite && <li className="acc-puce"><Icone nom="cible" taille={14} />{popularite}</li>}
        {/* contingentement (src/components/quota/) : reste de la période et déjà au panier, comme la ligne du menu */}
        <Quota cip={offre.cip} pas={offre.lot?.qte} forme="moyenne" as="li" style={{ marginTop: 0 }} />
      </ul>
      {!mobile && slide.serie_15j?.length > 1 && (
        <div className="acc-pouls-bloc">
          <Pouls key={slide.famille} serie={slide.serie_15j} tracer={tracer} delai={delaiPouls} libelle={`Rythme des commandes sur 15 jours : ${tendanceMot(slide.tendance_pct)}`} />
          <span className="acc-pouls-legende" aria-hidden="true">Rythme des commandes · 15 jours</span>
        </div>
      )}
      <BoutonLot offre={offre} nom={nomLu} qte={qte} pret={pret} inactif={inactif} onAjouter={onAjouter} onModifier={onModifier} onOuvrirPanier={onOuvrirPanier} />
      <button type="button" className="acc-voir" tabIndex={tab} onClick={onVoir}>
        {saisie ? "Voir dans la Saisie de commande" : `Voir dans le menu ${offre.menu?.label}`}<Icone nom="fleche" taille={15} />
      </button>
    </div>
  );
}
