// ── La vitrine cinéma « Offre du moment » : les mises en avant de Zineb, au-dessus des plus commandés (docs/accueil.md § 7) ──
// Une salle sombre (pétrole profond), un écran lumineux où flotte le produit (ou l'éventail d'un menu promo) ; la lumière
// de l'écran déborde dans la salle, dans la teinte de l'offre (couleur stockée + miniature floutée agrandie : aucun pixel lu,
// aucun canvas). Reflet qui balaie le produit, médaillon or de la remise, compte à rebours dans les 7 derniers jours (fin
// du prix seulement : menu promo daté ; la date de fin d'une mise en avant ne fait que la retirer).
// Carrousel à onglets (motif APG) dès 2 offres : barres façon « stories » (onglets), précédent / suivant ; défilement
// automatique sur ordinateur seulement (8 s par offre, deux tours, puis arrêt sur la première ; pause au survol, onglet
// caché, salle à moins de 50 % à l'écran, tiroir ou fenêtre modale ouverts ; arrêt définitif à la première action) ;
// glissé au doigt (mobile, tablette) et à la souris sur l'écran. Mouvement en Web Animations (transform et opacity) ;
// mouvement réduit : fondu de 150 ms, rien d'automatique. Offre suivie par son identifiant (la liste peut raccourcir :
// offre échue, produit passé en rupture). Photos en multiply directement sur l'écran clair : aucune enveloppe transformée
// entre la photo et l'écran (elle effacerait le fond blanc des PNG opaques).
// Outil du site (docs/accueil.md § 7.8) : photo de Zineb rendue comme celle d'un produit, sinon l'éventail de sa
// composition automatique (photos du fabricant, ou plaque et cartes-chiffres) ; sur-titre « Outil · <rubrique> », chiffres
// du moment sous le titre, un seul bouton qui ouvre l'outil (comme l'appui sur l'écran) ; médaillon « jusqu'à » pour la
// Péremption seulement ; jamais de compte à rebours.
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icone } from "../../icons.jsx";
import { fmtEur, fmtPct } from "../../theme.js";
import Boite from "./Boite.jsx";
import BoutonLot from "./BoutonLot.jsx";
import Rouleau from "./Rouleau.jsx";
import Rebours from "./Rebours.jsx";
import Eventail, { donne } from "./Eventail.jsx";
import { EASE, PhotoDecor, RESSORT, SORTIE, anime, photo, photoReconnue, prechargerPhoto, surErreurPhoto, useIllisibles } from "./outils.js";
import { prixLu, resumeMenuLu } from "./vedettes.js";
import { estIllisible } from "./illisibles.js";

// mémoire de la page (aucune clé de stockage) : arrivée jouée, défilement arrêté par l'utilisateur, indice de glissé vu
let arriveeJouee = false, defilementArrete = false, indiceVu = false;
const DUREE = 8000, TOURS = 2, FLOTTE = "cubic-bezier(.45,0,.55,1)";
const borne = (v, a) => Math.max(-a, Math.min(a, v));
const tailleTitre = (t) => (t.length <= 24 ? "l" : t.length <= 40 ? "m" : "s");
const lienVoir = (o) => (o.menu?.key && o.menu.key !== "saisie" ? `Voir dans ${o.menu.label}` : "Voir dans la Saisie de commande");
// éventail à l'écran : menu promo, ou outil sans photo de Zineb (composition automatique)
const enEventail = (e) => !!(e?.menu || (e?.outil && !e.outil.photo));

// le sujet de l'écran : photo (medium, large en 2x) posée en multiply sur l'écran, boîte générée, ou éventail du menu.
// Photo en erreur : l'original d'abord (taille réduite en erreur), puis notée (illisibles.js) ; la page reconstruit l'offre
// sans elle (photo du catalogue ou de la banque), sinon la boîte générée, dans le même rendu (jamais d'écran vide ni
// d'icône d'image cassée). Photo pas encore chargée : lueur de la teinte de l'offre sous le produit (écran jamais nu).
function Sujet({ e, format, priorite, mode }) {
  useIllisibles();
  const url = e.offre?.image_url || e.outil?.photo;
  const img = useRef(null);
  const [chargee, setChargee] = useState(null);   // adresse chargée
  const montree = url && !estIllisible(url) && !e.menu ? url : null;
  useLayoutEffect(() => { const i = img.current; if (montree && i?.complete && i.naturalWidth > 0) setChargee(montree); }, [montree]);
  if (e.menu) return <Eventail cartes={e.menu.cartes} max={format === "s" ? 3 : 5} taille={format} />;
  // outil : photo de Zineb (en erreur : la page refait l'entrée sans elle, composition automatique)
  if (e.outil && !montree) return <Eventail cartes={e.outil.cartes} max={format === "s" ? 3 : 5} taille={format} />;
  return (
    <span className={`mea-cadre${montree && chargee !== montree ? " mea-cadre--attente" : ""}`}>
      {montree ? <img ref={img} className="mea-sujet mea-photo" src={photo(url, "medium")} srcSet={photoReconnue(url) ? `${photo(url, "medium")} 1x, ${photo(url, "large")} 2x` : undefined}
        alt="" draggable={false} decoding="async" loading={priorite ? "eager" : "lazy"} fetchpriority={priorite ? "high" : undefined}
        onLoad={() => setChargee(url)} onError={(ev) => surErreurPhoto(url, ev)} />
        : e.offre && <span className="mea-sujet mea-sujet--boite"><Boite boite={e.offre.boite} cip={e.offre.cip} teinte={e.couleur} mode={mode} taille={format === "s" ? "carte" : "grande"} /></span>}
      <span className="mea-reflet-cadre"><span className="mea-reflet" /></span>
    </span>
  );
}
const varsTeinte = (e) => (e ? { "--mea-sombre": e.teintes.sombre, "--mea-claire": e.teintes.claire, "--mea-trait": e.teintes.trait } : undefined);
// calque de lumière (deux calques en fondu enchaîné : la salle change de couleur comme un changement de lumière) ;
// miniature floutée en erreur : retirée (la teinte seule reste)
const Lumiere = ({ e, k, devant, ecran }) => (
  <span className={`mea-calque${ecran ? " mea-calque--ecran" : ""}${devant ? " mea-calque--devant" : ""}`} data-k={k} style={varsTeinte(e)}>
    <span className="mea-debord" />
    <PhotoDecor url={e?.halo} className="mea-debord-photo" />
  </span>
);

export default function Cinema({ items, format = "l", reduit, finPointer, defilement = true, pauseExterne, qteAuPanier = {}, pret = true, apercu = false,
  arriveeForcee = false, onAjouter, onModifier, onOuvrirPanier, onVoir, onExpire, onDefile }) {
  const uid = useId().replace(/:/g, "");
  const n = items.length, mobile = format === "s";
  const [actifId, setActifId] = useState(() => items[0]?.id);
  const place = useRef(0);
  const trouve = items.findIndex(x => x.id === actifId);
  const actif = trouve >= 0 ? trouve : Math.max(0, Math.min(place.current, n - 1));
  place.current = actif;
  useEffect(() => { if (trouve < 0 && items[actif]) setActifId(items[actif].id); }, [trouve, actif, items]);
  const e = items[actif];
  const refs = useRef({}); refs.current = { items, actif };
  const region = useRef(null), ecranEnv = useRef(null);
  const arrivee = useRef(arriveeForcee || (!arriveeJouee && !reduit && !apercu));
  useEffect(() => { if (!apercu) arriveeJouee = true; }, [apercu]);

  // ── défilement automatique ──
  const possible = !apercu && !mobile && finPointer && !reduit && defilement && n >= 2;
  // « marche » même quand le défilement n'est pas (encore) possible : une 2e offre arrivée après le montage (menu promo
  // créé depuis la dernière visite, absent du cache local admin_promos) le lance, sauf si l'utilisateur l'a arrêté
  const [rotation, setRotation] = useState(() => (defilementArrete ? "arretee" : "marche"));
  const [survol, setSurvol] = useState(false);
  const [cache, setCache] = useState(() => typeof document !== "undefined" && document.hidden);
  const [horsVue, setHorsVue] = useState(false);
  const [modale, setModale] = useState(false);
  const [live, setLive] = useState({ mode: "off", texte: "" });
  const enMarche = possible && rotation === "marche";
  const enPause = survol || cache || horsVue || modale || !!pauseExterne;
  const pauseRef = useRef(enPause); pauseRef.current = enPause;
  const animRot = useRef(null), tours = useRef(0);
  const arreter = () => { if (rotation === "marche") { defilementArrete = true; setRotation("arretee"); } };
  useEffect(() => { onDefile?.(enMarche && !horsVue && !cache); }, [enMarche, horsVue, cache]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDefile?.(false), []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── changement d'offre : sens, calques de lumière, offre sortante (clone inerte retiré après 320 ms) ──
  const sens = useRef(1), glisseDx = useRef(null);
  const [calques, setCalques] = useState(() => ({ ids: [e?.id, null], devant: 0 }));
  const [sortant, setSortant] = useState(null);
  const prec = useRef(e);
  const aller = (i, source) => {
    const l = refs.current.items;
    if (!l.length) return;
    const j = ((i % l.length) + l.length) % l.length;
    if (source !== "rotation") arreter();
    sens.current = source === "precedent" || (source === "glisse" && glisseDx.current > 0) ? -1 : source === "onglet" || source === "clavier" ? (j >= refs.current.actif ? 1 : -1) : 1;
    setActifId(l[j].id);
    if (["precedent", "suivant", "glisse"].includes(source)) setLive({ mode: "polite", texte: `Offre ${j + 1} sur ${l.length} : ${l[j].titre}` });
    if (source === "glisse") { try { if (window.matchMedia?.("(pointer: coarse)").matches) navigator.vibrate?.(6); } catch { /* sans vibreur */ } }
  };
  useLayoutEffect(() => {
    const avant = prec.current;
    prec.current = e;
    if (!e || !avant || avant.id === e.id) return;
    setCalques(c => { const k = 1 - c.devant, ids = [...c.ids]; ids[k] = e.id; return { ids, devant: k }; });
    setSortant({ e: avant, cle: Date.now(), sens: sens.current, dx: glisseDx.current });
    glisseDx.current = null;
  }, [e?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const lumiere = (k) => items.find(x => x.id === calques.ids[k]) || (calques.ids[k] === sortant?.e.id ? sortant.e : null);

  // ── animations : arrivée (une fois par chargement), changement, reflet ──
  const anims = useRef([]);
  const garder = (...a) => { anims.current.push(...a.flat().filter(Boolean)); };
  const sel = (q) => region.current?.querySelector(q);
  const tous = (q) => [...(region.current?.querySelectorAll(q) || [])];
  const reflet = (delai) => tous(".mea-visuel:not(.mea-sortant) .mea-reflet").forEach((r, i) => garder(anime(r, [{ transform: "translateX(-110%)" }, { transform: "translateX(110%)" }],
    { duration: 1000, delay: delai + i * 80, easing: "cubic-bezier(.4,0,.2,1)", fill: "none" })));
  // le sujet lui-même (photo, boîte, éventail) porte les mouvements : une enveloppe transformée isolerait le multiply
  const sujetDe = (q) => sel(`${q} .mea-sujet`) || sel(`${q} .mea-eventail`);
  const sujetActif = () => sujetDe(".mea-visuel:not(.mea-sortant)");
  const motsEtTextes = (delaiMots, delaiTextes) => {
    tous(".mea-diapo .mea-mot").forEach((m, i) => garder(anime(m, [{ transform: "translateY(.45em)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 420, delay: delaiMots + i * 24, easing: EASE })));
    if (delaiTextes != null) tous(".mea-diapo .mea-a").forEach(el => garder(anime(el, [{ transform: "translateY(6px)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 300, delay: el.classList.contains("mea-tot") ? delaiMots : delaiTextes, easing: EASE })));
  };
  const medaillon = (delai) => garder(anime(sel(".mea-medaillon"), [{ transform: "scale(.85) rotate(-20deg)" }, { transform: "scale(1.06) rotate(-6deg)", offset: 0.6 },
    { transform: "scale(1) rotate(-8deg)" }], { duration: 420, delay: delai, easing: RESSORT }));
  useLayoutEffect(() => {
    if (!e) return;
    if (!arrivee.current) { if (!reduit && !apercu) garder(anime(region.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 })); return; }
    garder(anime(sel(".mea-voile-ecran"), [{ opacity: 0.85 }, { opacity: 0 }], { duration: 600, easing: EASE }));
    tous('.mea-calque[data-k="0"]').forEach(c => garder(anime(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 100, easing: EASE })));
    if (enEventail(e)) garder(donne(sel(".mea-visuel"), 200));
    else garder(anime(sujetActif(), [{ transform: "translateY(36px) scale(.94)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 200, easing: RESSORT }));
    motsEtTextes(0, null);
    medaillon(450);
    reflet(900);
    garder(anime(sel(".mea-medaillon-eclat"), [{ transform: "translateX(-120%)" }, { transform: "translateX(120%)" }], { duration: 600, delay: 1300, fill: "none" }));
    // indice de glissé (mobile, 2 offres ou plus, une fois) : le produit esquisse le geste, liseré de l'offre suivante
    if (mobile && n >= 2 && !indiceVu && !apercu) {
      indiceVu = true;
      garder(anime(sujetActif(), [{ translate: "0 0" }, { translate: "-24px 0", offset: 0.45 }, { translate: "0 0" }], { duration: 600, delay: 1600, easing: RESSORT, fill: "none" }));
      garder(anime(sel(".mea-lisere"), [{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 600, delay: 1600, fill: "none" }));
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!sortant) return undefined;
    anims.current.forEach(a => { try { a.finish(); } catch { /* déjà finie */ } });
    anims.current = [];
    const s = sortant.sens || 1, dx = sortant.dx;
    const cloneSujet = sujetDe(".mea-sortant");
    if (reduit) {
      garder(anime(cloneSujet, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }),
        anime(sel(".mea-texte-sortant"), [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }),
        anime(sujetActif(), [{ opacity: 0 }, { opacity: 1 }], { duration: 150 }),
        tous(`.mea-calque[data-k="${calques.devant}"]`).map(c => anime(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 })));
    } else {
      const depart = dx != null ? `translateX(${dx * 0.9}px) rotate(${borne(dx * 0.02, 6)}deg)` : "none";
      garder(anime(cloneSujet, [{ transform: depart, opacity: 1 }, { transform: dx != null ? `translateX(${dx < 0 ? -120 : 120}%) rotate(${dx < 0 ? -6 : 6}deg)` : `translateX(${-48 * s}px) scale(.94)`, opacity: 0 }],
        { duration: dx != null ? 260 : 300, easing: SORTIE, fill: "forwards" }));
      garder(anime(sel(".mea-texte-sortant"), [{ opacity: 1, transform: dx != null ? `translateX(${dx * 0.35}px)` : "none" }, { opacity: 0, transform: "translateY(-6px)" }],
        { duration: 180, easing: SORTIE, fill: "forwards" }));
      tous(`.mea-calque[data-k="${calques.devant}"]`).forEach(c => garder(anime(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: EASE })));
      garder(anime(sel(".mea-ecran"), [{ transform: "scale(1)" }, { transform: "scale(.985)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 700, easing: EASE }));
      if (enEventail(e)) garder(donne(sel(".mea-visuel:not(.mea-sortant)"), 120));
      else garder(anime(sujetActif(), [{ transform: `translateX(${(dx != null ? 120 : 64) * s}${dx != null ? "%" : "px"}) scale(.9)`, opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: dx != null ? 560 : 700, delay: dx != null ? 60 : 120, easing: RESSORT }));
      motsEtTextes(180, 260);
      medaillon(380);
      reflet(700);
    }
    const t = setTimeout(() => setSortant(x => (x?.cle === sortant.cle ? null : x)), 320);
    return () => clearTimeout(t);
  }, [sortant?.cle]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── flottement borné : pendant le défilement automatique, sinon deux cycles après l'arrivée ou un changement ──
  useEffect(() => {
    if (reduit || horsVue || cache || !e) return undefined;
    const cible = sujetActif();
    const opts = { duration: 3200, iterations: enMarche ? TOURS * n * 3 : 2, delay: arrivee.current ? 900 : 700, easing: FLOTTE, fill: "none" };
    const a = anime(cible, [{ translate: "0 0" }, { translate: "0 -8px" }, { translate: "0 0" }], opts);
    const b = anime(sel(".mea-visuel:not(.mea-sortant) .mea-ombre"), [{ transform: "scale(1)", opacity: 0.5 }, { transform: "scale(.9)", opacity: 0.38 }, { transform: "scale(1)", opacity: 0.5 }], opts);
    return () => { a?.cancel(); b?.cancel(); };
  }, [e?.id, enMarche, horsVue, cache, reduit]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── défilement : barre de l'offre active (Web Animations), offre suivante à la fin ; deux tours puis la première ──
  useEffect(() => {
    if (!enMarche) return undefined;
    const premier = tours.current === 0 && arrivee.current && actif === 0;
    const a = anime(sel(`#${uid}-onglet-${actif} .mea-barre-rempli`), [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: DUREE, delay: premier ? 1200 : 0, easing: "linear", fill: "none" });
    if (!a) return undefined;
    animRot.current = a;
    if (pauseRef.current) a.pause();
    a.onfinish = () => {
      const l = refs.current.items, j = (refs.current.actif + 1) % l.length;
      sens.current = 1;
      if (j === 0 && ++tours.current >= TOURS) { tours.current = 0; setActifId(l[0].id); setRotation("finie"); return; }
      setActifId(l[j].id);
    };
    // préchargement de l'offre suivante, 1 s avant son tour (photo en erreur, original compris : notée, l'offre arrive déjà
    // sans elle ; hors ligne : rien n'est noté ; erreur passagère : nouvel essai par illisibles.js)
    const suivante = items[(actif + 1) % n];
    const t = setTimeout(() => [suivante?.offre?.image_url, suivante?.outil?.photo, ...(suivante?.menu?.cartes || suivante?.outil?.cartes || []).map(c => c.url)].filter(Boolean).slice(0, 5)
      .forEach(u => prechargerPhoto(u, "medium")), DUREE - 1000 + (premier ? 1200 : 0));
    return () => { a.onfinish = null; a.cancel(); animRot.current = null; clearTimeout(t); };
  }, [enMarche, actif]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = animRot.current; if (!a) return; if (enPause) a.pause(); else if (a.playState === "paused") a.play(); }, [enPause]);
  useEffect(() => { if (rotation === "marche") setLive(l => (l.mode === "off" ? l : { mode: "off", texte: "" })); }, [rotation]);
  useEffect(() => {
    if (!enMarche) { setModale(false); return undefined; }
    const lire = () => setModale(!!document.querySelector('[role="dialog"][aria-modal="true"]'));
    lire();
    const t = setInterval(lire, 400);
    return () => clearInterval(t);
  }, [enMarche]);
  useEffect(() => {
    const vis = () => setCache(document.hidden);
    document.addEventListener("visibilitychange", vis);
    let io = null;
    if (region.current && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([x]) => setHorsVue(x.intersectionRatio < 0.5), { threshold: [0, 0.5, 1] });
      io.observe(region.current);
    }
    return () => { document.removeEventListener("visibilitychange", vis); io?.disconnect(); };
  }, []);

  // ── pointeur fin : inclinaison, profondeur, lumière qui suit ; reflet au survol (une fois toutes les 4 s) ──
  const vivant = finPointer && !reduit;
  const pt = useRef({ cx: 0, cy: 0, x: 0, y: 0, dedans: false, raf: 0, reflet: 0 });
  const boucle = () => {
    const p = pt.current, el = region.current;
    if (!el) { p.raf = 0; return; }
    p.x += (p.cx - p.x) * 0.12; p.y += (p.cy - p.y) * 0.12;
    const fin = !p.dedans && Math.abs(p.x) < 0.002 && Math.abs(p.y) < 0.002;
    el.style.setProperty("--px", fin ? "0" : p.x.toFixed(4)); el.style.setProperty("--py", fin ? "0" : p.y.toFixed(4));
    p.raf = fin ? 0 : requestAnimationFrame(boucle);
  };
  useEffect(() => () => cancelAnimationFrame(pt.current.raf), []);
  const surSurvol = (ev) => {
    if (!vivant || ev.pointerType !== "mouse" || !ecranEnv.current) return;
    const r = ecranEnv.current.getBoundingClientRect(), p = pt.current;
    p.cx = borne(((ev.clientX - r.left) / r.width) * 2 - 1, 1); p.cy = borne(((ev.clientY - r.top) / r.height) * 2 - 1, 1);
    const surEcran = !!ev.target.closest?.(".mea-ecran-env");
    if (surEcran && !p.surEcran && performance.now() - p.reflet > 4000) { p.reflet = performance.now(); reflet(0); }
    p.surEcran = surEcran; p.dedans = true;
    if (!p.raf) p.raf = requestAnimationFrame(boucle);
  };
  const surSortie = () => { const p = pt.current; p.cx = 0; p.cy = 0; p.dedans = false; p.surEcran = false; if (vivant && !p.raf) p.raf = requestAnimationFrame(boucle); };

  // ── glissé : au doigt sur la salle (mobile, tablette), à la souris sur l'écran ; suivi du doigt sans setState ──
  const geste = useRef(null), dernierGlisse = useRef(0);
  // appui sur l'écran sans glisser (le geste naturel sur une bannière) : comme « Voir … » ; raccourci du pointeur
  // seulement, le bouton reste le chemin du clavier
  const toucheEcran = () => { if (apercu || performance.now() - dernierGlisse.current < 400) return; arreter(); onVoir?.(e); };
  const ecrireGlisse = (dx) => {
    const k = n > 1 ? 1 : 0.25, v = sujetActif(), t = sel(".mea-diapo");
    if (v) v.style.transform = dx ? `translateX(${dx * 0.9 * k}px) rotate(${borne(dx * 0.02 * k, 6)}deg)` : "";
    if (t) t.style.transform = dx ? `translateX(${dx * 0.35 * k}px)` : "";
  };
  const surAppui = (ev) => {
    if (ev.target.closest("button, a, input") || (ev.pointerType === "mouse" && (ev.button !== 0 || !ev.target.closest(".mea-ecran-env")))) return;
    geste.current = { x: ev.clientX, y: ev.clientY, t: performance.now(), mode: null, id: ev.pointerId, dx: 0, raf: 0 };
  };
  const surDeplacement = (ev) => {
    const g = geste.current;
    if (!g || g.id !== ev.pointerId) { if (ev.pointerType === "mouse") surSurvol(ev); return; }
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { g.mode = "h"; try { region.current.setPointerCapture(ev.pointerId); } catch { /* sans capture */ } arreter(); }
      else if (Math.abs(dy) > 10) { geste.current = null; return; } else return;
    }
    g.dx = dx;
    if (!reduit && !g.raf) g.raf = requestAnimationFrame(() => { g.raf = 0; if (geste.current === g) ecrireGlisse(g.dx); });
  };
  const surRelache = (ev) => {
    const g = geste.current;
    geste.current = null;
    if (!g || g.mode !== "h") return;
    dernierGlisse.current = performance.now();
    cancelAnimationFrame(g.raf);
    const v = Math.abs(g.dx) / Math.max(1, performance.now() - g.t);
    const seuil = ev.pointerType === "mouse" ? 40 : 56;
    if (n > 1 && (Math.abs(g.dx) > seuil || v > 0.35)) {
      glisseDx.current = reduit ? null : g.dx;
      ecrireGlisse(0);
      aller(refs.current.actif + (g.dx < 0 ? 1 : -1), "glisse");
      return;
    }
    const vis = sujetActif(), t = sel(".mea-diapo");
    const avant = [vis?.style.transform, t?.style.transform];
    ecrireGlisse(0);
    if (!reduit) { garder(anime(vis, [{ transform: avant[0] || "none" }, { transform: "none" }], { duration: 320, easing: RESSORT, fill: "none" }),
      anime(t, [{ transform: avant[1] || "none" }, { transform: "none" }], { duration: 320, easing: RESSORT, fill: "none" })); }
  };

  // clavier dans la liste d'onglets : ← → (activation automatique), Début, Fin ; le focus suit
  const toucheOnglet = (ev) => {
    const k = { ArrowRight: actif + 1, ArrowLeft: actif - 1, Home: 0, End: n - 1 }[ev.key];
    if (k === undefined) return;
    ev.preventDefault();
    const j = ((k % n) + n) % n;
    aller(j, "clavier");
    requestAnimationFrame(() => document.getElementById(`${uid}-onglet-${j}`)?.focus());
  };

  if (!e) return null;
  const titreId = `${uid}-titre`;
  const carrousel = n > 1;
  const suivante = carrousel ? items[(actif + 1) % n] : null;
  const ajouter = (x, q) => { arreter(); onAjouter?.(x, q, sujetActif() || sel(".mea-visuel")); };
  // actions d'une offre ; inerte : copie de la diapositive sortante ou du gabarit (même hauteur, aucun effet)
  const actions = (x, inerte) => (x.outil ? (
    <button type="button" className="mea-cta" tabIndex={inerte ? -1 : undefined} onClick={() => { arreter(); onVoir?.(x); }}>
      {x.outil.cta}<Icone nom="fleche" taille={17} epaisseur={2.4} />
    </button>
  ) : x.offre ? (<>
    <BoutonLot offre={x.offre} nom={x.titre} qte={qteAuPanier[x.offre.cip] || 0} pret={pret} desactive={apercu} inactif={inerte} onAjouter={(q) => ajouter(x, q)}
      onModifier={(q) => { arreter(); onModifier?.(x.offre.cip, q); }} onOuvrirPanier={onOuvrirPanier} />
    <button type="button" className="mea-voir" tabIndex={inerte ? -1 : undefined} onClick={() => { arreter(); onVoir?.(x); }}>{lienVoir(x.offre)}<Icone nom="fleche" taille={15} /></button>
  </>) : (
    <button type="button" className="mea-cta" tabIndex={inerte ? -1 : undefined} onClick={() => { arreter(); onVoir?.(x); }}>
      Voir {x.menu.nb > 1 ? `les ${x.menu.nb} produits` : "le produit"}<Icone nom="fleche" taille={17} epaisseur={2.4} />
    </button>
  ));
  return (
    <section ref={region} className={`mea-cinema mea-f-${format}${vivant ? " mea-vivant" : ""}${enMarche ? " mea--defile" : ""}${carrousel || possible ? "" : " mea--seule"} ex-on-dark`}
      style={varsTeinte(e)}
      {...(carrousel ? { "aria-roledescription": "carrousel", "aria-label": "Offre du moment" } : { "aria-labelledby": titreId })}
      onMouseEnter={() => setSurvol(true)} onMouseLeave={() => { setSurvol(false); surSortie(); }}
      onPointerDown={surAppui} onPointerMove={surDeplacement} onPointerUp={surRelache} onPointerCancel={() => { geste.current = null; ecrireGlisse(0); }}
      onFocus={(ev) => { try { if (ev.target.matches(":focus-visible")) arreter(); } catch { arreter(); } }}>
      <span className="mea-lumieres" aria-hidden="true">
        <Lumiere e={lumiere(0)} k={0} devant={calques.devant === 0} /><Lumiere e={lumiere(1)} k={1} devant={calques.devant === 1} />
        <span className="mea-vignette" />
      </span>

      {(carrousel || possible) && (
        <div className="mea-ctrl">
          {possible && (
            <button type="button" className="mea-rond" onClick={() => { if (rotation === "marche") { defilementArrete = true; setRotation("arretee"); } else { defilementArrete = false; tours.current = 0; setRotation("marche"); } }}>
              <Icone nom={rotation === "marche" ? "pause" : "lecture"} taille={15} epaisseur={2.4} />
              <span className="acc-vh">{rotation === "marche" ? "Arrêter le défilement" : "Lancer le défilement"}</span>
            </button>
          )}
          {carrousel && (
            <div role="tablist" aria-label="Choisir une offre" className="mea-barres">
              {items.map((x, i) => (
                <button key={x.id} type="button" role="tab" id={`${uid}-onglet-${i}`} aria-selected={i === actif} aria-controls={`${uid}-diapo`} tabIndex={i === actif ? 0 : -1}
                  className={`mea-barre${i < actif ? " mea-barre--passee" : ""}`} onClick={() => aller(i, "onglet")} onKeyDown={toucheOnglet}>
                  <span className="acc-vh">Offre {i + 1} sur {n} : {x.titre}</span>
                  <span className="mea-barre-fond" aria-hidden="true"><span className="mea-barre-rempli" /></span>
                </button>
              ))}
            </div>
          )}
          {carrousel && !mobile && (<>
            <button type="button" className="mea-rond" aria-label="Offre précédente" onClick={() => aller(actif - 1, "precedent")}><Icone nom="precedent" taille={17} epaisseur={2.4} /></button>
            <button type="button" className="mea-rond" aria-label="Offre suivante" onClick={() => aller(actif + 1, "suivant")}><Icone nom="suivant" taille={17} epaisseur={2.4} /></button>
          </>)}
        </div>
      )}

      <div ref={ecranEnv} className={`mea-ecran-env${apercu ? "" : " mea-ecran-env--lien"}`} aria-hidden="true" onClick={toucheEcran}>
        <div className="mea-ecran">
          <Lumiere e={lumiere(0)} k={0} devant={calques.devant === 0} ecran /><Lumiere e={lumiere(1)} k={1} devant={calques.devant === 1} ecran />
          <div className="mea-plateau">
            {sortant && <div key={sortant.cle} className="mea-visuel mea-sortant" inert=""><Sujet e={sortant.e} format={format} mode={vivant ? "3d" : "25d"} /><span className="mea-ombre" /></div>}
            <div className={`mea-visuel${enEventail(e) ? " mea-visuel--menu" : ""}`}><Sujet e={e} format={format} priorite={actif === 0} mode={vivant ? "3d" : "25d"} /><span className="mea-ombre" /></div>
          </div>
          <span className="mea-voile-ecran" />
          {suivante && <span className="mea-lisere" style={varsTeinte(suivante)} />}
        </div>
        <Medaillon e={e} />
      </div>

      <div className="mea-texte">
        {/* gabarit invisible : toutes les offres dans la même cellule, la salle garde la hauteur de la plus haute (aucun saut
            de la page sous la vitrine au changement d'offre) */}
        {carrousel && items.map(x => <div key={x.id} className="mea-pile mea-gabarit" inert="" aria-hidden="true"><Textes e={x} fantome>{actions(x, true)}</Textes></div>)}
        {sortant && <div className="mea-pile mea-texte-sortant" inert="" aria-hidden="true"><Textes e={sortant.e} fantome>{actions(sortant.e, true)}</Textes></div>}
        <div className="mea-pile mea-diapo" {...(carrousel ? { role: "tabpanel", id: `${uid}-diapo`, "aria-roledescription": "diapositive", "aria-label": `${actif + 1} sur ${n} : ${e.titre}` } : {})}>
          <Textes e={e} titreId={titreId} actif={!horsVue && !cache} reduit={reduit} onExpire={onExpire}>{actions(e)}</Textes>
        </div>
      </div>
      <div className="acc-vh" aria-live={live.mode} aria-atomic="true">{live.texte}</div>
    </section>
  );
}

// médaillon or : remise du produit, ou « jusqu'à » la plus forte remise d'un menu ou de la Péremption courte (absent sans
// remise ; jamais pour les autres outils : les fauteuils ont la remise standard du catalogue)
function Medaillon({ e }) {
  const pct = e.offre ? (e.offre.pct >= 1 ? e.offre.pct : null) : e.menu ? e.menu.jusqua : e.outil?.jusqua;
  if (!pct) return null;
  return (
    <span className="mea-medaillon num">
      {(e.menu || e.outil) && <small>jusqu’à</small>}<b>{fmtPct(pct)}</b>
      <span className="mea-medaillon-eclat" />
    </span>
  );
}

// textes d'une offre (diapositive active, ou copie inerte de l'offre sortante : « fantome », sans prix ni boutons visibles)
function Textes({ e, titreId, fantome, actif = true, reduit, onExpire, children }) {
  const mots = e.titre.split(/\s+/).filter(Boolean);
  const groupes = mots.length > 12 ? [...mots.slice(0, 11), mots.slice(11).join(" ")] : mots;
  const o = e.offre;
  return (<>
    <div className="mea-tete mea-a mea-tot"><p className="mea-eyebrow"><span className="mea-eyebrow-pre">{e.outil ? "Outil" : "Offre du moment"} · </span>{e.rayon}</p>
      {e.badge && e.badge.toLowerCase() !== e.rayon.toLowerCase() && <span className="mea-badge">{e.badge}</span>}</div>
    <h2 id={titreId} className={`mea-titre mea-titre--${tailleTitre(e.titre)}`}>
      <span className="acc-vh">{e.titre}</span>
      <span aria-hidden="true">{groupes.map((m, i) => <React.Fragment key={i}><span className="mea-mot">{m}</span>{i < groupes.length - 1 ? " " : ""}</React.Fragment>)}</span>
    </h2>
    {e.sousLigne && <p className="mea-sous mea-a">{e.sousLigne}</p>}
    {e.accroche && <p className={`mea-accroche mea-a${e.outil ? " mea-accroche--outil" : ""}`}>{e.accroche}</p>}
    <div className={`mea-prix-bloc${fantome ? " mea-cache" : ""}`}>
      {o ? (<>
        <span className="mea-prix num"><span className="acc-vh">{prixLu(o)}</span><span aria-hidden="true"><Rouleau texte={fmtEur(o.pn)} /><span className="mea-ht">HT</span></span></span>
        {o.pv > o.pn && <span className="mea-pv num" aria-hidden="true">PV {fmtEur(o.pv)} HT · remise {fmtEur(o.remise_eur > 0 ? o.remise_eur : o.pv - o.pn)} HT</span>}
      </>) : e.outil ? (<>
        {e.outil.meta ? <span className="mea-menu-meta num"><span className="acc-vh">{e.outil.lu}</span><span aria-hidden="true">{e.outil.meta}</span></span>
          : <span className="acc-vh">{e.outil.lu}</span>}
        {e.outil.meta2 && <span className="mea-sous mea-outil-sous">{e.outil.meta2}</span>}
      </>) : (
        <span className="mea-menu-meta num"><span className="acc-vh">{resumeMenuLu(e)}</span><span aria-hidden="true">{e.menu.nb} référence{e.menu.nb > 1 ? "s" : ""}{e.menu.des ? ` · dès ${fmtEur(e.menu.des)} HT` : ""}</span></span>
      )}
    </div>
    {e.finOffre && <Rebours fin={e.finOffre} actif={actif && !fantome} secondes={!reduit} onFin={fantome ? undefined : onExpire} classe={`mea-a${fantome ? " mea-cache" : ""}`} />}
    <div className={`mea-actions mea-actions--${o ? "produit" : e.outil ? "outil" : "menu"}${fantome ? " mea-cache" : ""}`}>{children}</div>
  </>);
}
