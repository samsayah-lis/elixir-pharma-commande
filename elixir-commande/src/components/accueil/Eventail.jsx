// ── L'éventail d'un menu promo : 3 à 5 cartes tenues en main (photos des produits ; cartes texte en complément) ──
// Carte 0 (la « carte de devant ») au centre, au-dessus des autres ; géométrie de la spécification (rotation, décalage en %
// de la carte, origine sous la carte). Survol (ordinateur) : l'éventail s'ouvre (+4° par carte, carte centrale +10 px) par
// la variable --ouvre posée par le parent, transition CSS. Donne (arrivée, changement d'offre) : donne(), Web Animations,
// cartes parties empilées du centre vers l'extérieur. Photos en multiply sur la carte blanche. Décoratif (aria-hidden).
// Photo en erreur (stockage pas public, photo retirée) : notée (illisibles.js), la carte disparaît et l'éventail est
// refait par la page sans elle (resumeMenu : photos restantes du menu, puis cartes texte), exactement comme sans photo ;
// jamais de carte blanche (la carte de devant n'a pas de texte) ni d'icône d'image cassée.
import React from "react";
import { fmtEur } from "../../theme.js";
import { RESSORT, anime, photo, useIllisibles } from "./outils.js";
import { estIllisible, noterIllisible } from "./illisibles.js";

// nombre de cartes → [rotation (°), décalage x (%), décalage y (%)] de gauche à droite, et place de chaque carte (0 = devant)
const GEO = {
  1: [[0, 0, 0]], 2: [[-6, -8, 1], [6, 8, 1]], 3: [[-10, -12, 4], [0, 0, 0], [10, 12, 4]],
  4: [[-12, -14, 5], [-4, -4.5, 1], [4, 4.5, 1], [12, 14, 5]], 5: [[-16, -18, 6], [-8, -9, 2], [0, 0, 0], [8, 9, 2], [16, 18, 6]],
};
const PLACE = { 1: [0], 2: [1, 0], 3: [1, 0, 2], 4: [1, 2, 0, 3], 5: [2, 1, 3, 0, 4] };
const transformDe = ([r, x, y], centre, ouvre) => ouvre
  ? `translate(calc(${x}% * (1 + .3 * var(--ouvre, 0))), calc(${y}% - ${centre ? 10 : 0}px * var(--ouvre, 0))) rotate(calc(${r}deg + ${Math.sign(r) * 4}deg * var(--ouvre, 0)))`
  : `translate(${x}%, ${y}%) rotate(${r}deg)`;

// balise : "span" dans un bouton (tuile menu de la grille : un <div> n'y est pas permis)
export default function Eventail({ cartes = [], max = 5, taille = "l", balise: Balise = "div" }) {
  useIllisibles();
  // carte de photo illisible, carte sans photo ni texte : retirées (la page refait l'éventail dans le même rendu)
  const liste = cartes.filter(c => (c.url ? !estIllisible(c.url) : !!c.nom)).slice(0, max);
  const n = liste.length;
  if (!n) return null;
  return (
    <Balise className={`mea-eventail mea-eventail--${taille}`} aria-hidden="true">
      {liste.map((c, k) => {
        const slot = PLACE[n][k], g = GEO[n][slot], centre = Math.abs(slot - (n - 1) / 2) < 1;
        const img = !!c.url;
        return (
          // clé stable (adresse, ou nom d'une carte texte, uniques dans resumeMenu) : une carte retirée, les autres glissent
          // à leur nouvelle place (transition CSS) sans être recréées ni redemander leur photo
          <span key={c.url ? `p:${c.url}` : `t:${c.nom}`} className={`mea-carte${img ? "" : " mea-carte--texte"}`} data-fin={transformDe(g, centre, false)}
            data-ordre={Math.round(Math.abs(slot - (n - 1) / 2))} style={{ transform: transformDe(g, centre, true), zIndex: 10 - k }}>
            {img ? <img src={photo(c.url, "medium")} alt="" draggable={false} decoding="async" onError={() => noterIllisible(c.url)} />
              : <><span className="mea-carte-nom">{c.nom}</span>{c.pn > 0 && <span className="mea-carte-prix num">{fmtEur(c.pn)} HT</span>}</>}
            <span className="mea-reflet" />
          </span>
        );
      })}
    </Balise>
  );
}

// La donne : les cartes partent empilées au centre (seule celle du dessus visible) et s'ouvrent du centre vers l'extérieur
export function donne(racine, delai = 0) {
  return [...(racine?.querySelectorAll(".mea-carte") || [])].map((c, k) => anime(c,
    [{ transform: "translateY(30px) scale(.92)", opacity: k === 0 ? 1 : 0 }, { opacity: 1, offset: 0.2 }, { transform: c.dataset.fin, opacity: 1 }],
    { duration: 640, delay: delai + Number(c.dataset.ordre || 0) * 70, easing: RESSORT }));
}
