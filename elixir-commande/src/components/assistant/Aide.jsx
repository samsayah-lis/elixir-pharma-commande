// ── Assistant Elixir : groupe « AIDE » de la barre latérale, cadre du panneau, lanceur flottant et fenêtre de présentation
// (docs/assistant-conception.md § 1.1 et § 1.2) ──
// Morceau chargé à la demande par Entree.jsx, seulement quand l'assistant est disponible pour la pharmacie : hors du
// bundle des pharmacies. Le panneau (AssistantPanel, ses cartes et sa garde d'erreur) se charge à son tour au premier
// clic, dans un autre morceau, comme la fenêtre de présentation (Presentation.jsx) quand elle doit s'afficher ; ici :
// leur chargement (attente, échec du chargement), le groupe « AIDE » et le lanceur flottant (CoucheAssistant).
import React, { useEffect, useRef, useState } from "react";
import { T, R, ui } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import EtatVide, { Chargement } from "../ui/EtatVide.jsx";
import { aPresenter, noterVue, noterFini, champSaisie, DELAI_PRESENTATION } from "./presentation.js";

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
// Lanceur : bouton pétrole au coin bas droit, au-dessus du panier flottant quand il est affiché (pile : même colonne,
// 12 px d'écart ; main réserve la place en bas). Ordinateur et tablette : pastille « Une question ? Assistant Elixir » ;
// mobile : bulle ronde de 52 px centrée sur l'axe du panier, zone de sécurité de l'iPhone comprise. Masqué pendant que le
// panneau, le panier, l'admin ou le tiroir de menu sont ouverts, pendant la fenêtre de présentation et, sur écran
// tactile, tant que le clavier est ouvert (Saisie de commande, recherche, quantités : rien de la saisie n'est recouvert).
// Panneau ouvert par le lanceur (ou par « Essayer maintenant ») puis fermé : le focus revient au lanceur (le panneau, lui,
// le rendrait au bouton de l'en-tête : le lanceur masqué a perdu le focus à l'ouverture).
// Signal discret (anneau qui s'élargit, 3 fois) après la fenêtre fermée sans essayer : il montre où retrouver l'assistant ;
// aucun mouvement si l'utilisateur réduit les animations.
// zIndex 290 : le niveau du panier flottant, sous les voiles du panier (300), de Mes commandes (400) et des fenêtres.
const CSS_LANCEUR = `
.ex-lanceur { position: fixed; z-index: 290; right: 24px; bottom: 24px; display: inline-flex; align-items: center; gap: 10px;
  height: 48px; padding: 0 20px 0 16px; border: none; border-radius: 999px; background: var(--petrol); color: var(--paper);
  font-size: 14px; font-weight: 700; line-height: 1; white-space: nowrap; cursor: pointer; box-shadow: var(--shadow-2);
  transition: background-color .15s var(--ease), bottom .2s var(--ease); }
.ex-lanceur[hidden] { display: none; }
.ex-lanceur[data-pile] { bottom: 96px; }
.ex-lanceur__q { font-weight: 500; color: var(--paper-mute); }
@media (hover: hover) { .ex-lanceur:hover { background: var(--teal); } }
@media (max-width: 767px) {
  .ex-lanceur { width: 52px; height: 52px; padding: 0; justify-content: center; right: 28px; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); }
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
const chargerPresentation = () => import("./Presentation.jsx");
const Presentation = React.lazy(() => chargerPresentation().catch(() => ({ default: () => null })));

// Props (App) : identite (compte, comme le panneau) ; mobile ; presenter (fenêtre permise : pharmacie connectée, assistant
// complet, jamais en saisie Elixir) ; pret (catalogue affiché) ; ouvert (panneau ouvert) ; cache (panier, admin ou tiroir de
// menu mobile ouverts) ; pile (panier flottant affiché) ; onOuvrir() (ouvre le panneau).
export function CoucheAssistant({ identite, mobile, presenter, pret, ouvert, cache, pile, onOuvrir }) {
  const [aFaire, setAFaire] = useState(false);     // fenêtre encore à présenter dans cet onglet (presentation.js)
  const [affiche, setAffiche] = useState(false);
  const [appel, setAppel] = useState(false);       // signal discret sur le lanceur
  const [saisie, setSaisie] = useState(false);     // clavier ouvert sur écran tactile
  const activite = useRef(0);                      // dernière frappe ou dernier clic (ms)
  const bouton = useRef(null), parLanceur = useRef(false);

  useEffect(() => { setAFaire(!!presenter && aPresenter(identite)); }, [identite, presenter]);
  // assistant ouvert par n'importe quelle entrée (en-tête, menu, lanceur, Mes commandes) : la pharmacie le connaît
  useEffect(() => { if (ouvert && presenter) { noterFini(identite); setAFaire(false); } }, [ouvert, presenter, identite]);

  // frappe ou clic récent : la fenêtre attend, elle ne s'ouvre pas sous les doigts
  useEffect(() => {
    const note = () => { activite.current = Date.now(); };
    document.addEventListener("keydown", note, true);
    document.addEventListener("pointerdown", note, true);
    return () => { document.removeEventListener("keydown", note, true); document.removeEventListener("pointerdown", note, true); };
  }, []);

  // Attente : catalogue affiché, ni panneau, ni panier, ni admin, ni tiroir de menu (cache), aucune autre fenêtre
  // (aria-modal : « Offres du moment » après la connexion, Mes commandes, photo agrandie, choix de la pharmacie, assistant
  // sur mobile), onglet visible, puis DELAI_PRESENTATION de calme d'affilée (une frappe ou un clic relance l'attente)
  const attend = aFaire && !!pret && !ouvert && !cache && !affiche;
  useEffect(() => {
    if (!attend) return;
    chargerPresentation().catch(() => {});   // préchargée pendant l'attente
    let calme = 0;
    const t = setInterval(() => {
      const occupe = document.visibilityState === "hidden" || Date.now() - activite.current < 500 || !!document.querySelector('[aria-modal="true"]');
      calme = occupe ? 0 : calme + 500;
      if (calme < DELAI_PRESENTATION) return;
      clearInterval(t);
      noterVue(identite);
      setAFaire(false);
      setAffiche(true);
    }, 500);
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

  // panneau fermé après une ouverture par le lanceur : focus rendu au lanceur (après celui que pose le panneau en partant)
  useEffect(() => {
    if (ouvert || !parLanceur.current) return;
    parLanceur.current = false;
    if (bouton.current && !bouton.current.hidden) bouton.current.focus({ preventScroll: true });
  }, [ouvert]);

  const ouvrir = () => { parLanceur.current = true; onOuvrir(); };
  const fermer = (fini) => { if (fini) noterFini(identite); setAffiche(false); setAppel(true); };
  return (
    <>
      <style>{CSS_LANCEUR}</style>
      <button ref={bouton} type="button" className={appel ? "ex-lanceur ex-lanceur--appel" : "ex-lanceur"} data-pile={pile ? "" : undefined}
        hidden={!!(ouvert || cache || saisie || affiche)} onClick={ouvrir} onAnimationEnd={() => setAppel(false)}
        aria-label="Une question ? Assistant Elixir">
        <Icone nom="bulle" taille={mobile ? 24 : 20} />
        {!mobile && <span><span className="ex-lanceur__q">Une question ?</span> Assistant Elixir</span>}
      </button>
      {affiche && (
        <React.Suspense fallback={null}>
          <Presentation mobile={mobile} onPlusTard={() => fermer(false)} onNePlusAfficher={() => fermer(true)}
            onEssayer={() => { noterFini(identite); setAffiche(false); ouvrir(); }} />
        </React.Suspense>
      )}
    </>
  );
}
