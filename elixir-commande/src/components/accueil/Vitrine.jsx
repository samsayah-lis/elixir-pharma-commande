// ── La vitrine : carrousel à onglets (motif APG), « le linéaire » au-dessus de « la tête de gondole » ──
// Ordinateur et tablette : le linéaire (10 facings sur une tablette, chacun avec son étiquette de rayon) est la liste
// d'onglets ; la tête de gondole est le panneau. Mobile : segments (onglets) et piste de cartes à aimantation.
// Rotation automatique (ordinateur seulement) : 7 s par produit, un tour puis arrêt sur le n°1 ; pause tant que le
// pointeur est sur la vitrine, l'onglet caché, la vitrine à moins de 50 % à l'écran ou un tiroir ouvert ; arrêt définitif
// au focus clavier, à un clic (précédent, suivant, onglet), au choix d'un dosage, à un ajout, à un glissé ; seul « Lancer le
// défilement » la relance. Pause aussi tant qu'une fenêtre modale est ouverte (aria-modal). Région vivante muette pendant la
// rotation et à sa fin, polie seulement après une action (précédent, suivant, glissé).
// Produit actif suivi par sa FAMILLE, pas par son rang : la liste peut raccourcir en cours de session (stock rafraîchi,
// exclusion de l'admin, catalogue chargé tard) sans que la vitrine ne change de produit ni ne casse.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icone } from "../../icons.jsx";
import { fmtEur } from "../../theme.js";
import Boite from "./Boite.jsx";
import Rouleau from "./Rouleau.jsx";
import Pouls from "./Pouls.jsx";
import Etiquette from "./Etiquette.jsx";
import Gondole, { Visuel, Halo } from "./Gondole.jsx";
import { RESSORT, EASE, anime, photo, periodeTexte, prixHT, useDebord, useIllisibles } from "./outils.js";
import { estIllisible, noterIllisible } from "./illisibles.js";
import { voler, rebondPanier } from "./vol.js";
import { indexActif } from "./resolution.js";

// mémoire de la page (aucune clé de stockage) : arrivée jouée, rotation arrêtée par l'utilisateur
let arriveeJouee = false;
let rotationArretee = false;

const nomLu = (s) => s.famille.charAt(0) + s.famille.slice(1).toLowerCase();
const DUREE = 7000;

// niveauTitre : h1, ou h2 quand les mises en avant de Zineb sont au-dessus (le h1 de la page est alors « Accueil »)
export default function Vitrine({ slides, periode, isMobile, reduit, finPointer, reglages, pauseExterne, qteAuPanier, pret, onAjouter, onModifier, onOuvrirPanier, onVoir,
  offres = [], onOffre, niveauTitre = "h1" }) {
  const Titre = niveauTitre === "h2" ? "h2" : "h1";
  useIllisibles();   // facing dont la photo est en erreur : redessiné aussitôt (boîte), avant même la reconstruction
  const n = slides.length;
  // produit actif : sa famille ; disparue de la liste, la place qu'elle occupait (bornée au dernier produit)
  const [famActive, setFamActive] = useState(() => slides[0]?.famille);
  const placeActive = useRef(0);
  const trouve = slides.findIndex(x => x.famille === famActive);
  const actif = indexActif(slides, famActive, placeActive.current);
  placeActive.current = actif;
  const slidesRef = useRef(slides); slidesRef.current = slides;
  const setActif = (j) => { const l = slidesRef.current; if (!l.length) return; const k = ((j % l.length) + l.length) % l.length; setFamActive(l[k].famille); };
  useEffect(() => { if (trouve < 0 && slides[actif]) setFamActive(slides[actif].famille); }, [trouve, actif, slides]);
  const [choix, setChoix] = useState({});   // famille → CIP du dosage choisi
  const rotationPossible = !isMobile && finPointer && !reduit && reglages.auto !== false && n >= 3;
  const [rotation, setRotation] = useState(() => (rotationPossible && !rotationArretee ? "marche" : "arretee"));
  const [survol, setSurvol] = useState(false);
  const [cache, setCache] = useState(() => typeof document !== "undefined" && document.hidden);
  const [horsVue, setHorsVue] = useState(false);
  const [modale, setModale] = useState(false);   // fenêtre modale ouverte (présentation, offres, photo agrandie…)
  const [live, setLive] = useState({ mode: "off", texte: "" });
  const arrivee = useRef(!arriveeJouee && !reduit);
  const region = useRef(null), lineaire = useRef(null), piste = useRef(null), produit = useRef(null), bandeau = useRef(null);
  const debordBandeau = useDebord(bandeau, `${offres.map(o => o.id).join()}:${isMobile}`);
  const animRotation = useRef(null), tours = useRef(0);
  const enMarche = rotationPossible && rotation === "marche";
  const enPause = survol || cache || horsVue || modale || !!pauseExterne;
  const enPauseRef = useRef(enPause); enPauseRef.current = enPause;
  useEffect(() => { arriveeJouee = true; }, []);

  const offreDe = (s) => s.variantes.find(v => v.cip === choix[s.famille]) || s.principal;
  const dejaAuPanier = (s) => [s.principal, ...s.variantes].some(v => qteAuPanier[v.cip] > 0);   // un dosage de la famille au panier
  const annonce = (i) => { const s = slides[i]; setLive({ mode: "polite", texte: `${i + 1} sur ${n} : ${nomLu(s)}, ${prixHT(offreDe(s).pn)}` }); };
  const arreter = () => { if (rotation === "marche") { rotationArretee = true; setRotation("arretee"); } };
  const defilementProg = useRef(0);
  const actifRef = useRef(actif); actifRef.current = actif;
  const annonceRef = useRef(annonce); annonceRef.current = annonce;

  // aller au produit i (source : « onglet », « clavier », « precedent », « suivant », « glisse », « rotation », « carte »)
  const aller = (i, source) => {
    const j = ((i % n) + n) % n;
    if (source !== "rotation") arreter();
    setActif(j);
    if (["precedent", "suivant", "glisse"].includes(source)) annonce(j);
    if (isMobile && piste.current && source !== "defilement") {
      const carte = piste.current.children[j];
      if (carte) { defilementProg.current = Date.now(); piste.current.scrollTo({ left: carte.offsetLeft - 16, behavior: reduit ? "auto" : "smooth" }); }
    }
  };

  // ── rotation automatique : barre de progression de l'onglet actif (WAAPI), produit suivant à la fin ──
  useEffect(() => {
    if (!enMarche) return undefined;
    const barre = document.querySelector(`#acc-onglet-${actif} .acc-progression-barre`);
    const premier = tours.current === 0 && arrivee.current;
    const a = anime(barre, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: DUREE, delay: premier ? 1200 : 0, easing: "linear", fill: "none" });
    if (!a) return undefined;
    animRotation.current = a;
    if (enPauseRef.current) a.pause();
    // fin du tour : retour au n°1 sans annonce (la région vivante ne parle qu'après une action de l'utilisateur)
    a.onfinish = () => {
      tours.current += 1;
      if (tours.current >= n) { tours.current = 0; setActif(0); setRotation("finie"); }
      else setActif(actifRef.current + 1);
    };
    return () => { a.onfinish = null; a.cancel(); animRotation.current = null; };
  }, [enMarche, actif]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = animRotation.current; if (!a) return; if (enPause) a.pause(); else if (a.playState === "paused") a.play(); }, [enPause]);
  useEffect(() => { if (rotation === "marche") setLive(l => (l.mode === "off" ? l : { mode: "off", texte: "" })); }, [rotation]);
  // fenêtre modale ouverte par-dessus la page (aria-modal) : pause, sondée tant que la rotation tourne
  useEffect(() => {
    if (!enMarche) { setModale(false); return undefined; }
    const lire = () => setModale(!!document.querySelector('[role="dialog"][aria-modal="true"]'));
    lire();
    const t = setInterval(lire, 400);
    return () => clearInterval(t);
  }, [enMarche]);
  // onglet caché, vitrine à moins de 50 % à l'écran : pause
  useEffect(() => {
    const vis = () => setCache(document.hidden);
    document.addEventListener("visibilitychange", vis);
    let io = null;
    if (region.current && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => setHorsVue(e.intersectionRatio < 0.5), { threshold: [0, 0.5, 1] });
      io.observe(region.current);
    }
    return () => { document.removeEventListener("visibilitychange", vis); io?.disconnect(); };
  }, []);

  // ── arrivée : les facings tombent sur la tablette (40 ms d'écart) ; mobile : segments de gauche à droite ──
  useLayoutEffect(() => {
    if (!arrivee.current || !region.current) return;
    const els = region.current.querySelectorAll(isMobile ? ".acc-segment-barre" : ".acc-facing");
    els.forEach((el, i) => anime(el, isMobile ? [{ transform: "scaleX(0)" }, { transform: "none" }] : [{ transform: "translateY(-14px)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 360, delay: i * (isMobile ? 30 : 40), easing: RESSORT }));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // changement de produit (ordinateur) : textes de l'étiquette en fondu (0 → 120 ms sortie, 120 → 320 ms entrée) ; le prix roule
  const changeVu = useRef(false);
  useLayoutEffect(() => {
    if (!changeVu.current) { changeVu.current = true; return; }
    if (isMobile || reduit || !region.current) return;
    region.current.querySelectorAll([".acc-etiquette-tete", ".acc-rayon", ".acc-marque", ".acc-sous-ligne", ".acc-dosages", ".acc-faits"].map(c => `.acc-tete-gondole ${c}`).join(",")).forEach(el =>
      anime(el, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 200, delay: 120, easing: EASE }));
  }, [famActive]);   // eslint-disable-line react-hooks/exhaustive-deps

  // linéaire plus large que la vitrine : l'onglet actif reste visible, hors des fondus des bords (défilement horizontal du
  // linéaire seul ; position mesurée dans le linéaire, qui n'est pas le parent de positionnement des onglets)
  useEffect(() => {
    const c = lineaire.current, t = c?.children[actif];
    if (!c || !t || c.scrollWidth <= c.clientWidth) return;
    const gauche = t.getBoundingClientRect().left - c.getBoundingClientRect().left + c.scrollLeft;
    const g = Math.max(0, gauche - 16), d = gauche + t.offsetWidth - c.clientWidth + 16;
    if (g < c.scrollLeft) c.scrollTo({ left: g, behavior: reduit ? "auto" : "smooth" });
    else if (d > c.scrollLeft) c.scrollTo({ left: d, behavior: reduit ? "auto" : "smooth" });
  }, [actif, reduit]);

  // clavier dans la liste d'onglets : ← → (activation automatique), Début, Fin ; le focus suit
  const toucheOnglet = (e) => {
    const k = { ArrowRight: actif + 1, ArrowLeft: actif - 1, Home: 0, End: n - 1 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    const j = ((k % n) + n) % n;
    aller(j, "clavier");
    requestAnimationFrame(() => document.getElementById(`acc-onglet-${j}`)?.focus());
  };

  // ── ajout : petit bond, vol vers le panier, rebond du compteur ──
  const ajouter = (s, offre, qty, source) => {
    arreter();
    onAjouter({ cip: offre.cip, name: offre.nom_panier, qty, pn: offre.pn, pv: offre.pv, discount: offre.pct > 0 ? offre.pct : 0, tiers: offre.price_tiers || null });
    if (reduit) return;
    const el = source || produit.current;
    anime(el, [{ transform: "translateY(0)" }, { transform: "translateY(-10px)", offset: 0.4 }, { transform: "translateY(0)" }], { duration: 280, easing: RESSORT });
    voler(el, { image: offre.image_url ? photo(offre.image_url, "thumbnail") : null, marque: s.famille, dosage: offre.boite?.dosage, teinte: s.teinte });
    setTimeout(rebondPanier, 520);
    try { if (window.matchMedia?.("(pointer: coarse)").matches) navigator.vibrate?.(8); } catch { /* sans vibreur */ }
  };
  const choisir = (s, cip) => { arreter(); setChoix(c => ({ ...c, [s.famille]: cip })); };

  // ── mobile : distance au centre (--d), inclinaison de vitesse, carte active au défilement ──
  useEffect(() => {
    const p = piste.current;
    if (!isMobile || !p) return undefined;
    let raf = 0, dernier = { x: p.scrollLeft, t: performance.now() }, fin = 0;
    // toutes les lectures d'abord (positions dans la piste, sans getBoundingClientRect entre deux écritures), puis les
    // écritures : --d / --da sur les cartes proches seulement (les lointaines, data-loin, restent en 2D statique, sans
    // couche 3D), --v (inclinaison de vitesse) sur le produit de la carte centrale seulement (plus d'héritage depuis la
    // piste, qui recalculait le style des 10 cartes à chaque image)
    let incline = null;
    const calcule = () => {
      raf = 0;
      const enfants = [...p.children], sl = p.scrollLeft, centre = sl + p.clientWidth / 2;
      const ds = enfants.map(c => Math.max(-1, Math.min(1, (c.offsetLeft + c.offsetWidth / 2 - centre) / (c.offsetWidth || 1))));
      let meilleur = 0, dmin = Infinity;
      ds.forEach((d, i) => { if (Math.abs(d) < dmin) { dmin = Math.abs(d); meilleur = i; } });
      const t = performance.now(), v = (sl - dernier.x) / Math.max(1, t - dernier.t) * 1000;
      dernier = { x: sl, t };
      if (!reduit) {
        enfants.forEach((c, i) => {
          const a = Math.abs(ds[i]), loin = a >= 1;
          if (loin !== c.hasAttribute("data-loin")) c.toggleAttribute("data-loin", loin);
          if (!loin || c.__da !== 1) { c.style.setProperty("--d", ds[i].toFixed(3)); c.style.setProperty("--da", a.toFixed(3)); c.__da = loin ? 1 : a; }
        });
        const incl = enfants[meilleur]?.querySelector(".acc-produit-incl");
        if (incline && incline !== incl) incline.style.removeProperty("--v");
        incline = incl;
        incl?.style.setProperty("--v", `${Math.max(-4, Math.min(4, v * 0.02)).toFixed(2)}deg`);
      }
      if (Date.now() - defilementProg.current > 700 && meilleur !== actifRef.current) { actifRef.current = meilleur; setActif(meilleur); annonceRef.current(meilleur); }
    };
    const finDefilement = () => { p.removeAttribute("data-defile"); incline?.style.removeProperty("--v"); };
    const surDefilement = () => {
      p.setAttribute("data-defile", "");
      if (!raf) raf = requestAnimationFrame(calcule);
      clearTimeout(fin); fin = setTimeout(finDefilement, 120);
    };
    p.addEventListener("scroll", surDefilement, { passive: true });
    if ("onscrollend" in window) p.addEventListener("scrollend", finDefilement);
    calcule();
    return () => { p.removeEventListener("scroll", surDefilement); p.removeEventListener("scrollend", finDefilement); cancelAnimationFrame(raf); clearTimeout(fin); };
  }, [isMobile, n, reduit]);   // eslint-disable-line react-hooks/exhaustive-deps

  // mobile : titre sur une ligne (« Les plus commandés »), « par vos confrères » passe dans la ligne du dessus
  const titreEyebrow = isMobile ? `Par vos confrères · ${periodeTexte(periode, true)}` : `Ces 15 derniers jours · ${periodeTexte(periode, false)}`;
  const s = slides[actif], o = offreDe(s);
  const etiquetteProps = (sl, of, i, inactif) => ({
    slide: sl, offre: of, position: i + 1, variantes: sl.variantes, choix: choix[sl.famille] || sl.principal.cip, onChoix: (cip) => choisir(sl, cip),
    teinte: sl.teinte, qte: qteAuPanier[of.cip] || 0, pret, inactif, mobile: isMobile,
    onAjouter: (q) => ajouter(sl, of, q, isMobile ? piste.current?.children[i]?.querySelector(".acc-produit-incl") : null),
    onModifier: (q) => { arreter(); onModifier(of.cip, q); }, onOuvrirPanier, onVoir: () => onVoir(of, sl),
  });

  return (
    <section ref={region} className={`acc-vitrine${isMobile ? " acc-vitrine--mobile" : ""}`} aria-roledescription="carrousel" aria-labelledby="acc-titre"
      onMouseEnter={() => setSurvol(true)} onMouseLeave={() => setSurvol(false)}
      onFocus={(e) => { try { if (e.target.matches(":focus-visible")) arreter(); } catch { arreter(); } }}>
      <div className="acc-entete">
        <div className="acc-entete-titres">
          <p className="acc-eyebrow acc-eyebrow--titre">{titreEyebrow}</p>
          <Titre id="acc-titre" className="acc-h1">Les plus commandés{isMobile ? <span className="acc-vh"> par vos confrères</span> : " par vos confrères"}</Titre>
        </div>
        {/* grand écran : les menus promo en cours en bandeau, à côté du titre (au premier écran, sans fenêtre par-dessus) */}
        {!isMobile && offres.length > 0 && onOffre && (
          <nav className="acc-bandeau-offres" aria-label="Offres du moment">
            <span className="acc-eyebrow" aria-hidden="true">Offres du moment</span>
            <span ref={bandeau} className="acc-bandeau-offres-liste" data-debord={debordBandeau || undefined}>
              {offres.map(ps => (
                <button key={ps.id} type="button" className="acc-offre-puce" title={ps.name} style={ps.color ? { "--acc-teinte": ps.color } : undefined} onClick={() => onOffre(ps)}>
                  <span className="acc-offre-puce-icone" aria-hidden="true">{ps.icon || <Icone nom="etiquette" taille={13} />}</span>
                  <span className="acc-offre-puce-nom">{ps.name}</span>
                </button>
              ))}
            </span>
          </nav>
        )}
        {!isMobile && (
          <div className="acc-controles">
            {rotationPossible && (
              <button type="button" className="acc-rond acc-rond--pause" title={rotation === "marche" ? "Arrêter le défilement" : "Lancer le défilement"} onClick={() => {
                if (rotation === "marche") { rotationArretee = true; setRotation("arretee"); }
                else { rotationArretee = false; tours.current = 0; setRotation("marche"); }
              }}>
                <Icone nom={rotation === "marche" ? "pause" : "lecture"} taille={16} epaisseur={2.4} />
                <span className="acc-vh">{rotation === "marche" ? "Arrêter le défilement" : "Lancer le défilement"}</span>
              </button>
            )}
            <button type="button" className="acc-rond" aria-label="Produit précédent" onClick={() => aller(actif - 1, "precedent")}><Icone nom="precedent" taille={18} epaisseur={2.4} /></button>
            <button type="button" className="acc-rond" aria-label="Produit suivant" onClick={() => aller(actif + 1, "suivant")}><Icone nom="suivant" taille={18} epaisseur={2.4} /></button>
          </div>
        )}
      </div>

      {isMobile ? (<>
        <div className="acc-segments-rangee">
          <button type="button" className="acc-rond acc-rond--44" aria-label="Produit précédent" onClick={() => aller(actif - 1, "precedent")}><Icone nom="precedent" taille={18} epaisseur={2.4} /></button>
          <div role="tablist" aria-label="Choisir un produit du classement" className="acc-segments">
            {slides.map((sl, i) => (
              <button key={sl.famille} type="button" role="tab" id={`acc-onglet-${i}`} aria-selected={i === actif} aria-controls={`acc-diapo-${i}`} tabIndex={i === actif ? 0 : -1}
                className="acc-segment" onClick={() => aller(i, "onglet")} onKeyDown={toucheOnglet}>
                <span className="acc-vh">{i + 1} : {nomLu(sl)}, {prixHT(offreDe(sl).pn)}{dejaAuPanier(sl) ? ", déjà au panier" : ""}</span>
                <span className="acc-segment-barre" aria-hidden="true" />
              </button>
            ))}
          </div>
          <button type="button" className="acc-rond acc-rond--44" aria-label="Produit suivant" onClick={() => aller(actif + 1, "suivant")}><Icone nom="suivant" taille={18} epaisseur={2.4} /></button>
        </div>
        <div ref={piste} className="acc-piste">
          {slides.map((sl, i) => {
            const of = offreDe(sl);
            return (
              <div key={sl.famille} className="acc-carte-env" onClick={() => { if (i !== actif) aller(i, "carte"); }}>
                <div role="tabpanel" id={`acc-diapo-${i}`} aria-roledescription="diapositive" aria-label={`${i + 1} sur ${n} : ${nomLu(sl)}`}
                  className="acc-carte" {...(i !== actif ? { inert: "", "aria-hidden": "true" } : {})}>
                  <SceneCarte slide={sl} offre={of} position={i + 1} actif={i === actif} reduit={reduit} arrivee={arrivee.current && i === 0} />
                  <Etiquette {...etiquetteProps(sl, of, i, i !== actif)} />
                </div>
              </div>
            );
          })}
        </div>
      </>) : (<>
        <div ref={lineaire} role="tablist" aria-label="Choisir un produit du classement" className="acc-lineaire">
          {slides.map((sl, i) => {
            const p = offreDe(sl), deja = dejaAuPanier(sl);   // dosage choisi (prix, boîte), pas seulement le principal
            return (
              <button key={sl.famille} type="button" role="tab" id={`acc-onglet-${i}`} aria-selected={i === actif} aria-controls="acc-diapo" tabIndex={i === actif ? 0 : -1}
                className="acc-emplacement" onClick={() => aller(i, "onglet")} onKeyDown={toucheOnglet}
                aria-label={`${i + 1} : ${nomLu(sl)}, ${prixHT(p.pn)}${deja ? ", déjà au panier" : ""}`}>
                <span className="acc-facing" aria-hidden="true">
                  {/* photo en erreur : notée, la page reconstruit le produit sans elle (autre photo, sinon la boîte) */}
                  {p.image_url && !estIllisible(p.image_url) ? <img src={photo(p.image_url, "thumbnail")} alt="" draggable={false} decoding="async" loading={i < 6 ? "eager" : "lazy"} onError={() => noterIllisible(p.image_url)} />
                    : <span className="acc-facing-boite"><Boite boite={p.boite} cip={p.cip} teinte={sl.teinte} taille="mini" /></span>}
                </span>
                <span className="acc-tablette" aria-hidden="true" />
                <span className="acc-etiq-rayon" aria-hidden="true" style={{ "--acc-teinte": sl.teinte }}>
                  <b className="num">{i + 1}</b><span className="acc-etiq-nom">{sl.famille}</span><span className="acc-etiq-prix num">{fmtEur(p.pn)}</span>
                </span>
                {deja && <span className="acc-deja" aria-hidden="true"><Icone nom="coche" taille={11} epaisseur={3} /></span>}
                <span className="acc-progression" aria-hidden="true"><span className="acc-progression-barre" /></span>
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id="acc-diapo" aria-roledescription="diapositive" aria-label={`${actif + 1} sur ${n} : ${nomLu(s)}`} className="acc-tete-gondole">
          <Gondole offre={o} index={actif} cle={s.famille} position={actif + 1} arrivee={arrivee.current} reduit={reduit} finPointer={finPointer} teinte={s.teinte}
            refProduit={produit} onGlisse={(d) => aller(actif + d, "glisse")} />
          <Etiquette {...etiquetteProps(s, o, actif, false)} tracer={!reduit} delaiPouls={arrivee.current && actif === 0 && !changeVu.current ? 450 : 200} />
        </div>
      </>)}
      <div className="acc-vh" aria-live={live.mode} aria-atomic="true">{live.texte}</div>
    </section>
  );
}

// ── scène d'une carte (mobile ; une ou deux cartes) : projecteur fixe, rang géant, halo, produit en 2,5D, pouls fin ──
export function SceneCarte({ slide, offre, position, actif = true, reduit, arrivee }) {
  const valeur = String(position).padStart(2, "0");
  const [rang, setRang] = useState(valeur);
  const [net, setNet] = useState(false);
  const [vu, setVu] = useState(false);
  const prod = useRef(null);
  // première fois active : le rang roule depuis 00, le pouls se trace ; arrivée : le produit monte et apparaît
  useEffect(() => {
    if (!actif || vu || reduit) return undefined;
    setVu(true); setNet(true); setRang("00");
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => { setNet(false); setRang(valeur); }); });
    if (arrivee) anime(prod.current, [{ transform: "translateY(16px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 120, easing: EASE });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [actif]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="acc-carte-scene">
      <span className="acc-scene-fond" aria-hidden="true">
        <span className="acc-projecteur" />
        <span className={`acc-rang-geant num${net ? " acc-rouleau--net" : ""}`}><Rouleau texte={rang} decalage={40} /></span>
        <Halo offre={offre} teinte={slide.teinte} />
      </span>
      <span className="acc-socle" aria-hidden="true" />
      <div className="acc-emplacement-produit">
        <div ref={prod} className="acc-produit"><div className="acc-produit-incl"><Visuel offre={offre} mode="25d" taille="carte" teinte={slide.teinte} priorite={position === 1} /></div></div>
      </div>
      {slide.serie_15j?.length > 1 && <span className="acc-carte-pouls"><Pouls key={vu ? "trace" : "fixe"} serie={slide.serie_15j} fin tracer={vu && !reduit} duree={400} /></span>}
    </div>
  );
}
