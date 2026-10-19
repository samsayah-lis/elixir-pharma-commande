// ── Assistant Elixir : groupe « AIDE » de la barre latérale, cadre du panneau, lanceur flottant et fenêtre de présentation
// (docs/assistant-conception.md § 1.1 et § 1.2) ──
// Morceau chargé à la demande par Entree.jsx, seulement quand l'assistant est disponible pour la pharmacie : hors du
// bundle des pharmacies. Le panneau (AssistantPanel, ses cartes et sa garde d'erreur) se charge à son tour au premier
// clic, dans un autre morceau, comme la fenêtre de présentation (Presentation.jsx) quand elle doit s'afficher ; ici :
// leur chargement (attente, échec du chargement), le groupe « AIDE » et le lanceur flottant (CoucheAssistant).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { T, R, ui } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import EtatVide, { Chargement } from "../ui/EtatVide.jsx";
import { aPresenter, noterVue, noterFini, champSaisie, champRempli, pasAttente, PAS_ATTENTE, recouvre, placeLanceur } from "./presentation.js";

// échec du chargement (connexion, ou nouvelle version du site mise en ligne pendant que la page était ouverte)
const Panneau = React.lazy(() => import("../AssistantPanel.jsx").catch(() => ({ default: Indisponible })));

// cadre provisoire, à la place du panneau (ses règles CSS et son en-tête viennent avec lui) ; échec du chargement :
// « Recharger la page » ou « Fermer »
const Cadre = ({ children }) => (
  <aside aria-label="Assistant Elixir" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 301, width: "min(420px, 100%)",
    background: T.paper, boxShadow: T.shadow3, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>{children}</aside>
);
const Indisponible = ({ onClose }) => (
  <Cadre>
    <EtatVide erreur compact icone="alerte" titre="Assistant indisponible" texte="L'assistant n'a pas pu se charger : rechargez la page."
      actions={<>
        <button className="ex-btn-petrole" onClick={() => window.location.reload()} style={{ ...ui.btn(), background: undefined }}>Recharger la page</button>
        <button className="ex-btn-ligne" onClick={onClose} style={ui.btn("ligne")}>Fermer</button>
      </>} />
  </Cadre>
);

export const PanneauAssistant = (props) => (
  <React.Suspense fallback={<Cadre><Chargement texte="Ouverture de l'assistant…" /></Cadre>}>
    <Panneau {...props} />
  </React.Suspense>
);

// Barre latérale : groupe « AIDE » sous « OUTILS » (mêmes dessins que les menus) ; l'entrée ouvre le panneau, ce
// n'est pas un onglet du catalogue. Ligne de contact : textes des réglages de l'assistant, jamais écrits ici.
export function GroupeAide({ isDesktop, infos, onOuvrir }) {
  const tel = String(infos?.telephone || "").replace(/[^\d+]/g, "");
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ padding: "12px 22px 6px", fontSize: 11, letterSpacing: "0.14em", color: T.inkMute, fontWeight: 700 }}>AIDE</div>
      <button className="ex-menu" onClick={onOuvrir} style={{ display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 20px)", margin: "1px 10px",
        border: "none", borderRadius: isDesktop ? R.pill : 22, color: T.inkSoft, padding: isDesktop ? "8px 12px" : "10px 12px", minHeight: isDesktop ? 0 : 44,
        cursor: "pointer", fontSize: isDesktop ? 13 : 14, fontWeight: 500, lineHeight: 1.3 }}>
        <Icone nom="bulle" taille={18} style={{ margin: "0 1px" }} />Assistant Elixir
      </button>
      {tel.length > 5 && (
        <div className="ex-selectionnable num" style={{ padding: "4px 22px 0 52px", fontSize: 12, lineHeight: 1.45, color: T.inkSoft }}>
          <a href={`tel:${tel}`} style={{ color: T.teal, fontWeight: 600 }}>{infos.telephone}</a>
          {infos.horaires && <div>{infos.horaires}</div>}
        </div>
      )}
    </div>
  );
}

// ── Lanceur flottant et fenêtre de présentation (demande de Zineb Moulatif du 19/10/2026 : « la pharmacie ne sait pas de
// quoi il s'agit ») ──
// Lanceur : bouton pétrole au coin bas droit, au-dessus du panier flottant quand il est affiché (pile : même colonne ;
// main réserve la place en bas). Trois places au repos (placeLanceur, presentation.js ; revue du 19/10/2026) :
//  • pastille « Une question ? Assistant Elixir » : ordinateur et tablette, en haut de page (HAUT_DE_PAGE) ;
//  • bulle de 52 px centrée sur l'axe du panier flottant : mobile toujours, ailleurs dès que la page défile (le libellé
//    revient au survol et au focus clavier, l'aria-label ne change pas) ;
//  • masqué, tant que sa place recouvrirait un bouton ou un champ (« − / quantité / + », A–Z, « Copier le CIP »,
//    « Envoyer »…) : la page est sondée sous le lanceur à chaque repos (défilement arrêté depuis REPOS ms, page modifiée,
//    fenêtre redimensionnée). Sur mobile, il s'efface aussi pendant le défilement : un toucher juste après l'arrêt ne
//    tombe jamais sur lui au lieu du « + ». Jamais masqué sous le focus clavier ou le pointeur de la souris. La bulle de
//    l'en-tête reste, elle, toujours visible.
// Masqué aussi pendant que le panneau, le panier, l'admin, le tiroir de menu ou la barre de confirmation U-Labs sont
// affichés (cache), pendant la fenêtre de présentation et, sur écran tactile, tant que le clavier est ouvert (Saisie de
// commande, recherche, quantités).
// Panneau ouvert par le lanceur (ou par « Essayer maintenant ») puis fermé : le focus revient au lanceur (le panneau, lui,
// le rendrait au bouton de l'en-tête : le lanceur masqué a perdu le focus à l'ouverture). Fenêtre fermée sans élément où
// rendre le focus (connexion, puis « Offres du moment ») : focus sur le lanceur, ou sur la bulle de l'en-tête s'il est masqué.
// Signal discret (anneau qui s'élargit, 3 fois) après la fenêtre fermée sans essayer : il montre où retrouver l'assistant ;
// aucun mouvement si l'utilisateur réduit les animations.
// zIndex 290 : le niveau du panier flottant, sous les voiles du panier (300), de Mes commandes (400) et des fenêtres.
// Pastille et bulle partagent bord droit (28 px), bas et hauteur (52 px) : la pastille dépliée au survol contient la bulle,
// le pointeur ne la quitte pas en la dépliant (pas de clignotement).
const CSS_LANCEUR = `
.ex-lanceur { position: fixed; z-index: 290; right: 28px; bottom: 24px; display: inline-flex; align-items: center; gap: 10px;
  height: 52px; padding: 0 22px 0 15px; border: none; border-radius: 999px; background: var(--petrol); color: var(--paper);
  font-size: 14px; font-weight: 700; line-height: 1; white-space: nowrap; cursor: pointer; box-shadow: var(--shadow-2);
  transition: background-color .15s var(--ease), opacity .15s var(--ease), visibility .15s; }
.ex-lanceur[hidden] { display: none; }
.ex-lanceur[data-pile] { bottom: 96px; }
.ex-lanceur[data-masque] { visibility: hidden; opacity: 0; pointer-events: none; }
.ex-lanceur__q { font-weight: 500; color: var(--paper-mute); }
.ex-lanceur[data-forme="bulle"] { width: 52px; padding: 0; gap: 0; justify-content: center; }
.ex-lanceur[data-forme="bulle"] > .ex-lanceur__libelle { display: none; }
.ex-lanceur[data-forme="bulle"]:focus-visible { width: auto; padding: 0 22px 0 15px; gap: 10px; }
.ex-lanceur[data-forme="bulle"]:focus-visible > .ex-lanceur__libelle { display: inline; }
@media (hover: hover) {
  .ex-lanceur:hover { background: var(--teal); }
  .ex-lanceur[data-forme="bulle"]:hover { width: auto; padding: 0 22px 0 15px; gap: 10px; }
  .ex-lanceur[data-forme="bulle"]:hover > .ex-lanceur__libelle { display: inline; }
}
@media (max-width: 767px) {
  .ex-lanceur, .ex-lanceur[data-forme]:hover, .ex-lanceur[data-forme]:focus-visible { width: 52px; padding: 0; gap: 0; justify-content: center; }
  .ex-lanceur { bottom: calc(24px + env(safe-area-inset-bottom, 0px)); }
  .ex-lanceur[data-pile] { bottom: calc(96px + env(safe-area-inset-bottom, 0px)); }
}
.ex-lanceur--appel { animation: ex-lanceur-appel 1.6s var(--ease) 3; }
@keyframes ex-lanceur-appel {
  from { box-shadow: var(--shadow-2), 0 0 0 0 rgba(60,119,130,.55); }
  70%, to { box-shadow: var(--shadow-2), 0 0 0 14px rgba(60,119,130,0); }
}
@media (prefers-reduced-motion: reduce) { .ex-lanceur { transition: none; } .ex-lanceur--appel { animation: none; } }
@media print { .ex-lanceur { display: none !important; } }
`;
const HAUT_DE_PAGE = 120;   // px défilés en deçà desquels la pastille garde son libellé (ordinateur, tablette)
const REPOS = 160;          // ms sans défilement : la page est au repos, on sonde la place du lanceur
// ce qu'un clic ou un toucher sous le lanceur atteindrait : bouton, champ, lien, case, ou élément cliquable (curseur main)
const CONTROLE = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="option"]';
const estControle = (el) => !!el.closest?.(CONTROLE) || getComputedStyle(el).cursor === "pointer";

const chargerPresentation = () => import("./Presentation.jsx");
// préchargée pendant l'attente, affichée seulement une fois chargée (pasAttente) : ce secours ne sert qu'en dernier recours
const SecoursPresentation = ({ onEchec }) => { useEffect(() => { onEchec(); }, [onEchec]); return null; };
const Presentation = React.lazy(() => chargerPresentation().catch(() => ({ default: SecoursPresentation })));

// Props (App) : identite (compte, comme le panneau) ; mobile ; presenter (fenêtre permise : pharmacie connectée, assistant
// complet, jamais en saisie Elixir ni à l'arrivée par le lien d'un menu promo) ; pret (catalogue affiché) ; ouvert
// (panneau ouvert) ; cache (panier, admin, tiroir de menu mobile ou barre U-Labs affichés) ; pile (panier flottant
// affiché) ; onOuvrir() (ouvre le panneau).
export function CoucheAssistant({ identite, mobile, presenter, pret, ouvert, cache, pile, onOuvrir }) {
  const [aFaire, setAFaire] = useState(false);     // fenêtre encore à présenter dans cet onglet (presentation.js)
  const [affiche, setAffiche] = useState(false);
  const [appel, setAppel] = useState(false);       // signal discret sur le lanceur
  const [saisie, setSaisie] = useState(false);     // clavier ouvert sur écran tactile
  const [pose, setPose] = useState(mobile ? "bulle" : "pastille");   // place au repos : pastille, bulle ou masque
  const activite = useRef(0);                      // dernière frappe, dernier clic ou dernier défilement (ms)
  const bouton = useRef(null), parLanceur = useRef(false);
  const horsJeu = !!(ouvert || cache || saisie || affiche);

  useEffect(() => { setAFaire(!!presenter && aPresenter(identite)); }, [identite, presenter]);
  // assistant ouvert par n'importe quelle entrée (en-tête, menu, lanceur, Mes commandes) : la pharmacie le connaît
  useEffect(() => { if (ouvert && presenter) { noterFini(identite); setAFaire(false); } }, [ouvert, presenter, identite]);

  // frappe, clic ou défilement récent (molette, pavé tactile, doigt) : la fenêtre attend, elle ne s'ouvre pas sous les doigts
  useEffect(() => {
    const note = () => { activite.current = Date.now(); };
    const evts = ["keydown", "pointerdown", "wheel", "touchmove", "scroll"];
    evts.forEach((n) => document.addEventListener(n, note, { capture: true, passive: true }));
    return () => evts.forEach((n) => document.removeEventListener(n, note, true));
  }, []);

  // Attente : catalogue affiché, ni panneau, ni panier, ni admin, ni tiroir de menu (cache), aucune autre fenêtre
  // (aria-modal : « Offres du moment » après la connexion, Mes commandes, photo agrandie, choix de la pharmacie, assistant
  // sur mobile), onglet visible, aucun champ rempli en cours de saisie, puis DELAI_PRESENTATION de calme d'affilée (une
  // frappe, un clic ou un défilement relance l'attente). Morceau Presentation préchargé : affiché (et compté) seulement une
  // fois chargé ; introuvable → pas de fenêtre pour cette page, rien de compté, le lanceur reste (pasAttente).
  const attend = aFaire && !!pret && !ouvert && !cache && !affiche;
  useEffect(() => {
    if (!attend) return;
    let calme = 0, charge = false, echec = false;
    chargerPresentation().then(() => { charge = true; }, () => { echec = true; });
    const t = setInterval(() => {
      const occupe = document.visibilityState === "hidden" || Date.now() - activite.current < PAS_ATTENTE
        || champRempli(document.activeElement) || !!document.querySelector('[aria-modal="true"]');
      const pas = pasAttente({ calme, occupe, charge, echec });
      calme = pas.calme;
      if (pas.suite === "attendre") return;
      clearInterval(t);
      setAFaire(false);
      if (pas.suite === "afficher") { noterVue(identite); setAffiche(true); }
    }, PAS_ATTENTE);
    return () => clearInterval(t);
  }, [attend, identite]);

  // Clavier ouvert (écran tactile) : champ de saisie actif et partie visible de l'écran réduite (visualViewport, comme le
  // panneau) ; un champ qui a le focus sans clavier (autoFocus de la Saisie sur iPhone) ne masque rien
  useEffect(() => {
    if (!mobile && !window.matchMedia?.("(pointer: coarse)").matches) return;
    const v = window.visualViewport;
    const maj = () => setSaisie(champSaisie(document.activeElement) && (!v || v.height < window.innerHeight - 120));
    const apres = () => setTimeout(maj, 0);   // focusout : le nouvel élément actif n'est connu qu'ensuite
    document.addEventListener("focusin", maj);
    document.addEventListener("focusout", apres);
    v?.addEventListener("resize", maj);
    maj();
    return () => {
      document.removeEventListener("focusin", maj);
      document.removeEventListener("focusout", apres);
      v?.removeEventListener("resize", maj);
      setSaisie(false);
    };
  }, [mobile]);

  // Place au repos (voir l'en-tête de ce bloc) : sondée avant l'affichage (pas de lanceur qui apparaît sur un « + » puis
  // s'efface), puis à chaque repos du défilement, à chaque modification de la page (une sonde par 250 ms au plus) et au
  // redimensionnement. Chaque forme est mesurée en posant data-forme le temps d'une lecture, sans dessin intermédiaire.
  useLayoutEffect(() => {
    const el = bouton.current;
    if (!el || horsJeu) return;
    // focus clavier ou pointeur de souris sur le lanceur : il reste (un focus posé par programme ou un survol « collant »
    // après un toucher ne le retiennent pas, sinon il resterait sur les « + » pendant le défilement)
    // (:focus-visible inconnu d'un vieux Safari, avant iOS 15.4 : matches lèverait une erreur → faux)
    const vise = (sel) => { try { return el.matches(sel); } catch { return false; } };
    const garde = () => vise(":focus-visible") || (!!window.matchMedia?.("(hover: hover)").matches && vise(":hover"));
    const libre = (forme) => {
      const avant = el.getAttribute("data-forme");
      el.setAttribute("data-forme", forme);
      const r = el.getBoundingClientRect();
      if (avant === null) el.removeAttribute("data-forme"); else el.setAttribute("data-forme", avant);
      const panier = document.querySelector(".ex-panier-flottant");
      return !recouvre(r, { aPoint: (x, y) => document.elementsFromPoint?.(x, y) || [], estControle,
        ignorer: (e) => el.contains(e) || !!panier?.contains(e) });
    };
    let repos = 0, sonde = 0, defile = 0;
    const placer = () => {
      clearTimeout(repos); clearTimeout(sonde); sonde = 0;
      if (Date.now() - defile < REPOS) { repos = setTimeout(placer, REPOS); return; }   // la page défile encore
      // une sonde qui échoue ne doit jamais casser la page : bulle par défaut
      let p = "bulle";
      try { p = placeLanceur({ pastilleVoulue: !mobile && window.scrollY <= HAUT_DE_PAGE, libre, garde: garde() }); } catch { /* bulle */ }
      setPose(p);
    };
    const auDefilement = () => {
      defile = Date.now();
      if (!garde()) setPose((p) => (mobile ? "masque" : p === "pastille" && window.scrollY > HAUT_DE_PAGE ? "bulle" : p));
      clearTimeout(repos); repos = setTimeout(placer, REPOS);
    };
    const bientot = () => { if (!sonde) sonde = setTimeout(placer, 250); };
    placer();
    const mo = typeof MutationObserver === "function" ? new MutationObserver(bientot) : null;
    mo?.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("scroll", auDefilement, { capture: true, passive: true });
    window.addEventListener("resize", bientot);
    return () => {
      mo?.disconnect();
      document.removeEventListener("scroll", auDefilement, true);
      window.removeEventListener("resize", bientot);
      clearTimeout(repos); clearTimeout(sonde);
    };
  }, [horsJeu, mobile, pile]);

  // panneau fermé après une ouverture par le lanceur : focus rendu au lanceur (après celui que pose le panneau en partant)
  useEffect(() => {
    if (ouvert || !parLanceur.current) return;
    parLanceur.current = false;
    if (bouton.current && !bouton.current.hidden) bouton.current.focus({ preventScroll: true });
  }, [ouvert]);

  const ouvrir = () => { parLanceur.current = true; onOuvrir(); };
  const fermer = (fini) => {
    if (fini) noterFini(identite);
    setAffiche(false); setAppel(true);
    // FocusFenetre a rendu le focus là où il était ; rien à rendre (arrivée par la connexion puis « Offres du moment ») :
    // focus sur le lanceur, ou sur la bulle de l'en-tête s'il est masqué — l'utilisateur au clavier garde sa place
    requestAnimationFrame(() => {
      const actif = document.activeElement;
      if (actif && actif !== document.body) return;
      const el = bouton.current;
      (el && !el.hidden && !el.hasAttribute("data-masque") ? el : document.querySelector("[data-assistant-ouvrir]"))?.focus({ preventScroll: true });
    });
  };
  return (
    <>
      <style>{CSS_LANCEUR}</style>
      <button ref={bouton} type="button" className={appel ? "ex-lanceur ex-lanceur--appel" : "ex-lanceur"} data-pile={pile ? "" : undefined}
        data-forme={pose === "pastille" ? undefined : "bulle"} data-masque={pose === "masque" ? "" : undefined}
        hidden={horsJeu} onClick={ouvrir} onAnimationEnd={() => setAppel(false)}
        aria-label={"Une question\u00a0? Assistant Elixir"}>
        <Icone nom="bulle" taille={mobile ? 24 : 22} />
        {!mobile && <span className="ex-lanceur__libelle"><span className="ex-lanceur__q">Une question&nbsp;?</span> Assistant Elixir</span>}
      </button>
      {affiche && (
        <React.Suspense fallback={null}>
          <Presentation mobile={mobile} onPlusTard={() => fermer(false)} onNePlusAfficher={() => fermer(true)} onEchec={() => setAffiche(false)}
            onEssayer={() => { noterFini(identite); setAffiche(false); ouvrir(); }} />
        </React.Suspense>
      )}
    </>
  );
}
