// ── L'éventail d'un menu promo : 3 à 5 cartes tenues en main (photos des produits ; cartes texte en complément) ──
// Carte 0 (la « carte de devant ») au centre, au-dessus des autres ; géométrie de la spécification (rotation, décalage en %
// de la carte, origine sous la carte). Survol (ordinateur) : l'éventail s'ouvre (+4° par carte, carte centrale +10 px) par
// la variable --ouvre posée par le parent, transition CSS. Donne (arrivée, changement d'offre) : donne(), Web Animations,
// cartes parties empilées du centre vers l'extérieur. Photos en multiply sur la carte blanche. Décoratif (aria-hidden).
// Photo en erreur (stockage pas public, photo retirée) : notée (illisibles.js, après l'essai de l'original : surErreurPhoto),
// la carte disparaît et l'éventail est refait par la page sans elle (resumeMenu : photos restantes du menu, puis cartes
// texte), exactement comme sans photo ; jamais d'icône d'image cassée. Liste changée pendant ou après la donne (le 400 du
// stockage arrive en moins de 100 ms, la donne dure 640 ms) : chaque carte déjà là finit sa course vers sa NOUVELLE place,
// une carte ajoutée entre avec la donne (ou seule si elle est finie) ; jamais de saut, jamais de carte visible avant la
// donne. Photo pas encore chargée (lente, ou erreur en attente) : la carte montre son nom et son prix (après 0,3 s, sans
// minuteur : délai CSS) au lieu d'une carte blanche.
import React, { useLayoutEffect, useRef, useState } from "react";
import { fmtEur } from "../../theme.js";
import { EASE, REDUIT, RESSORT, anime, photo, surErreurPhoto, useIllisibles, useMedia } from "./outils.js";
import { estIllisible } from "./illisibles.js";

// nombre de cartes → [rotation (°), décalage x (%), décalage y (%)] de gauche à droite, et place de chaque carte (0 = devant)
const GEO = {
  1: [[0, 0, 0]], 2: [[-6, -8, 1], [6, 8, 1]], 3: [[-10, -12, 4], [0, 0, 0], [10, 12, 4]],
  4: [[-12, -14, 5], [-4, -4.5, 1], [4, 4.5, 1], [12, 14, 5]], 5: [[-16, -18, 6], [-8, -9, 2], [0, 0, 0], [8, 9, 2], [16, 18, 6]],
};
const PLACE = { 1: [0], 2: [1, 0], 3: [1, 0, 2], 4: [1, 2, 0, 3], 5: [2, 1, 3, 0, 4] };
const transformDe = ([r, x, y], centre, ouvre) => ouvre
  ? `translate(calc(${x}% * (1 + .3 * var(--ouvre, 0))), calc(${y}% - ${centre ? 10 : 0}px * var(--ouvre, 0))) rotate(calc(${r}deg + ${Math.sign(r) * 4}deg * var(--ouvre, 0)))`
  : `translate(${x}%, ${y}%) rotate(${r}deg)`;
// clé stable (adresse, ou nom d'une carte texte, uniques dans resumeMenu)
const cleDe = (c) => (c.url ? `p:${c.url}` : `t:${c.nom}`);
const DEPART = "translateY(30px) scale(.92)";
const DUREE_DONNE = 640, ECART_DONNE = 70;
// la donne d'une carte : partie empilée au centre (seule la première visible), jusqu'à sa place
const donnerCarte = (c, delai, premiere) => anime(c,
  [{ transform: DEPART, opacity: premiere ? 1 : 0 }, { opacity: 1, offset: 0.2 }, { transform: c.dataset.fin, opacity: 1 }],
  { duration: DUREE_DONNE, delay: delai, easing: RESSORT });
// attente avant le départ d'une animation de donne (ms), 0 si elle est partie
const attenteDe = (a) => { try { return Math.max(0, (Number(a.effect?.getTiming?.().delay) || 0) - (Number(a.currentTime) || 0)); } catch { return 0; } };

// une carte : photo (nom et prix montrés tant qu'elle n'est pas chargée), ou carte texte
function Carte({ c, style, fin, ordre }) {
  const img = useRef(null);
  const [chargee, setChargee] = useState(false);
  // photo déjà en cache : chargée avant même le premier affichage (aucun texte entrevu)
  useLayoutEffect(() => { const i = img.current; setChargee(!!(i?.complete && i.naturalWidth > 0)); }, [c.url]);
  const texte = (c.nom || c.pn > 0) && (!c.url || !chargee);
  return (
    <span data-cle={cleDe(c)} className={`mea-carte${c.url ? (chargee ? " mea-carte--chargee" : " mea-carte--attente") : " mea-carte--texte"}`} data-fin={fin}
      data-ordre={ordre} style={style}>
      {c.url && <img ref={img} src={photo(c.url, "medium")} alt="" draggable={false} decoding="async" onLoad={() => setChargee(true)} onError={(ev) => surErreurPhoto(c.url, ev)} />}
      {texte && <>{c.nom && <span className="mea-carte-nom">{c.nom}</span>}{c.pn > 0 && <span className="mea-carte-prix num">{fmtEur(c.pn)} HT</span>}</>}
      <span className="mea-reflet" />
    </span>
  );
}

// balise : "span" dans un bouton (tuile menu de la grille : un <div> n'y est pas permis)
export default function Eventail({ cartes = [], max = 5, taille = "l", balise: Balise = "div" }) {
  useIllisibles();
  const reduit = useMedia(REDUIT);
  const racine = useRef(null), avant = useRef(null);
  // carte de photo illisible, carte sans photo ni texte : retirées (la page refait l'éventail dans le même rendu)
  const liste = cartes.filter(c => (c.url ? !estIllisible(c.url) : !!c.nom)).slice(0, max);
  const n = liste.length;
  const cles = liste.map(cleDe).join("|");
  // liste changée (photo en erreur, photo revenue) : les cartes déjà là vont à leur nouvelle place, les nouvelles entrent ;
  // rien au premier affichage (donne() s'en charge) ni en mouvement réduit (remplacement immédiat)
  useLayoutEffect(() => {
    const prec = avant.current;
    avant.current = cles;
    if (prec === null || prec === cles || reduit || !racine.current) return;
    const anciennes = new Set(prec.split("|"));
    const els = [...racine.current.querySelectorAll(":scope > .mea-carte")];
    // donne pas encore partie (cartes empilées, invisibles) : la plus courte attente restante
    // animations de chaque carte déjà là : donne (Web Animations) et transition CSS que le changement de place vient de créer
    const anims = new Map(els.filter(el => anciennes.has(el.dataset.cle)).map(el => {
      const toutes = (el.getAnimations?.() || []).filter(a => a.playState === "running" || a.playState === "paused");
      return [el, { donne: toutes.filter(a => !("transitionProperty" in a)), transitions: toutes.filter(a => "transitionProperty" in a) }];
    }));
    let attente = null;
    for (const { donne: d } of anims.values()) for (const a of d) { const r = attenteDe(a); if (r > 0) attente = attente === null ? r : Math.min(attente, r); }
    for (const el of els) {
      const fin = el.dataset.fin, ordre = Number(el.dataset.ordre || 0);
      if (!anims.has(el)) {
        // nouvelle carte : avec la donne si elle n'est pas partie (jamais visible avant les autres), sinon entrée seule
        if (attente !== null) donnerCarte(el, attente + ordre * ECART_DONNE, false);
        else anime(el, [{ transform: DEPART, opacity: 0 }, { transform: fin, opacity: 1 }], { duration: 420, easing: RESSORT });
        continue;
      }
      const { donne: enCours, transitions } = anims.get(el);
      if (!enCours.length) continue;   // au repos : la transition CSS la mène à sa nouvelle place
      // en pleine donne : la transition CSS (prioritaire sur les Web Animations) la ferait sauter ; c'est la donne qui la mène
      transitions.forEach(a => a.cancel());
      const reste = Math.max(...enCours.map(attenteDe));
      enCours.forEach(a => { if (reste > 0) a.cancel(); });
      // pas encore partie : même donne, même départ, vers la nouvelle place ; en route : de là où elle est
      if (reste > 0) { donnerCarte(el, reste, el === els[0]); continue; }
      const cs = getComputedStyle(el), de = { transform: cs.transform, opacity: Number(cs.opacity) };
      enCours.forEach(a => a.cancel());
      anime(el, [de, { transform: fin, opacity: 1 }], { duration: 320, easing: EASE });
    }
  }, [cles, reduit]);
  if (!n) return null;
  return (
    <Balise ref={racine} className={`mea-eventail mea-eventail--${taille}`} aria-hidden="true">
      {liste.map((c, k) => {
        const slot = PLACE[n][k], g = GEO[n][slot], centre = Math.abs(slot - (n - 1) / 2) < 1;
        // clé stable : une carte retirée, les autres glissent à leur nouvelle place sans être recréées ni redemander leur photo
        return <Carte key={cleDe(c)} c={c} fin={transformDe(g, centre, false)} ordre={Math.round(Math.abs(slot - (n - 1) / 2))}
          style={{ transform: transformDe(g, centre, true), zIndex: 10 - k }} />;
      })}
    </Balise>
  );
}

// La donne : les cartes partent empilées au centre (seule celle du dessus visible) et s'ouvrent du centre vers l'extérieur
export function donne(racine, delai = 0) {
  return [...(racine?.querySelectorAll(".mea-carte") || [])].map((c, k) => donnerCarte(c, delai + Number(c.dataset.ordre || 0) * ECART_DONNE, k === 0));
}
