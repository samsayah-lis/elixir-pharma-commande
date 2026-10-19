// ── Assistant Elixir : fenêtre de présentation (demande de Zineb Moulatif du 19/10/2026 : « Mets une fenetre de dialogue
// qui s'affiche sur le site et pas seulement un onglet Assistant Elixir : la pharmacie ne sait pas de quoi il s'agit ») ──
// Morceau chargé à la demande (React.lazy, Aide.jsx), seulement quand la fenêtre doit s'afficher : hors du bundle des
// pharmacies. Quand l'afficher et combien de fois : presentation.js (CoucheAssistant d'Aide.jsx).
// Fenêtre de la charte (paper, rayon 28, voile --scrim, zIndex 2000 comme « Offres du moment ») à en-tête pétrole et croix
// or clair ; « Essayer maintenant » pétrole (l'or reste à l'envoi de la commande, aux promos et au compteur du panier).
// Accessibilité : role="dialog" aria-modal, titre et texte reliés (aria-labelledby, aria-describedby) ; focus sur
// « Fermer » à l'ouverture et rendu à la fermeture (FocusFenetre) ; Tab gardé dans la fenêtre ; Échap = « Plus tard ».
// Props : mobile ; onEssayer (ouvre l'assistant), onPlusTard (Échap et « Fermer » aussi), onNePlusAfficher.
import React, { useEffect, useRef } from "react";
import { T, R, ui } from "../../theme.js";
import { Icone, CroixElixir } from "../../icons.jsx";
import FocusFenetre from "../ui/FocusFenetre.jsx";
import { focusSuivant } from "./presentation.js";

// les quatre demandes des pastilles d'accueil du panneau (AssistantPanel), dans le même ordre
const EXEMPLES = [
  ["document", "Duplicata d'une facture", "Retrouvée par sa date ou son numéro, en PDF."],
  ["calendrier", "Relevé de facturation", "Sur la période de votre choix, en PDF et Excel."],
  ["camion", "Où en est ma commande ?", "Préparation, sortie d'entrepôt, quantités servies."],
  ["recommander", "Demande de retour ou réclamation", "Préparée avec vous, envoyée seulement après votre accord."],
];

// Mobile (< 768 px) : tout tient sur un écran de 375 × 812 sans défiler — exemples sur une colonne, titres seuls (le
// détail reste sur ordinateur), pas de sous-titre ; « Essayer maintenant » sur toute la largeur, « Plus tard » et « Ne plus
// afficher » côte à côte dessous (cibles de 44 px au moins)
const CSS = `
.ex-presentation__exemples { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.ex-presentation__exemple { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; background: var(--surface);
  border: 1px solid var(--line); border-radius: 16px; }
.ex-presentation__detail { display: block; margin-top: 3px; font-size: 12px; line-height: 1.4; color: var(--ink-soft); }
.ex-presentation__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ex-presentation__plus { margin-left: auto; }
@media (max-width: 767px) {
  .ex-presentation__sous-titre, .ex-presentation__detail { display: none; }
  .ex-presentation__exemples { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .ex-presentation__exemple { align-items: center; padding: 8px 12px; }
  .ex-presentation__actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .ex-presentation__actions > :first-child { grid-column: 1 / -1; }
  .ex-presentation__plus { margin-left: 0; }
}
@media print { .ex-presentation { display: none !important; } }
`;

export default function Presentation({ mobile, onEssayer, onPlusTard, onNePlusAfficher }) {
  const boite = useRef(null);

  // mobile : page figée derrière la fenêtre (sur ordinateur, la barre de défilement disparaîtrait et décalerait la page)
  useEffect(() => {
    if (!mobile) return;
    const html = document.documentElement, avant = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = avant; };
  }, [mobile]);

  // Échap = « Plus tard » ; Tab et Maj+Tab bouclent sur les boutons de la fenêtre
  const auClavier = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onPlusTard(); return; }
    if (e.key !== "Tab") return;
    const cible = focusSuivant([...(boite.current?.querySelectorAll("button:not([disabled])") || [])], document.activeElement, e.shiftKey);
    if (cible) { e.preventDefault(); cible.focus(); }
  };

  const bouton = { ...ui.btn("primaire", "l"), background: undefined, color: undefined };
  return (
    <div ref={boite} className="ex-presentation" role="dialog" aria-modal="true" aria-labelledby="presentation-assistant-titre"
      aria-describedby="presentation-assistant-texte" onKeyDown={auClavier} style={{ ...ui.overlay, zIndex: 2000 }}>
      <style>{CSS}</style>
      <div style={{ background: T.paper, color: T.ink, borderRadius: R.l, width: "100%", maxWidth: 580, maxHeight: "calc(100vh - 32px)",
        overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: T.shadow3, animation: "fadeIn .25s var(--ease)" }}>
        <FocusFenetre />

        {/* En-tête pétrole : croix or clair, « Nouveau : votre Assistant Elixir », Fermer (= Plus tard) */}
        <div className="ex-on-dark" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: mobile ? 12 : 16, background: T.petrol, color: T.paper,
          padding: mobile ? "12px 8px 12px 18px" : "22px 16px 22px 28px" }}>
          <CroixElixir taille={mobile ? 28 : 38} style={{ color: T.orClair }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="presentation-assistant-titre" style={{ margin: 0, fontSize: mobile ? 18 : 22, fontWeight: 640, letterSpacing: "-0.02em", lineHeight: 1.2, color: T.paper }}>
              Nouveau : votre Assistant Elixir
            </h2>
            <div className="ex-presentation__sous-titre" style={{ fontSize: 12, color: T.paperMute, marginTop: 4 }}>Factures · relevés · commandes · retours</div>
          </div>
          <button type="button" className="ex-icone-entete ex-cible" data-focus-initial onClick={onPlusTard} aria-label="Fermer" title="Fermer"
            style={{ ...ui.rond(mobile ? 44 : 36), color: T.paper, alignSelf: "flex-start" }}><Icone nom="fermer" /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: mobile ? "16px 18px 4px" : "24px 28px 8px" }}>
          <p id="presentation-assistant-texte" style={{ margin: 0, fontSize: mobile ? 14 : 15, lineHeight: 1.5, color: T.ink }}>
            Un assistant automatique consulte vos factures et vos commandes Elixir, celles de votre pharmacie uniquement, et vous répond
            tout de suite. <b>Il ne voit jamais vos règlements.</b>
          </p>
          <p style={{ margin: mobile ? "14px 0 8px" : "18px 0 10px", fontSize: 13, fontWeight: 700, color: T.inkSoft }}>Demandez-lui par exemple :</p>
          <ul className="ex-presentation__exemples">
            {EXEMPLES.map(([icone, titre, detail]) => (
              <li key={titre} className="ex-presentation__exemple">
                <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  background: T.mint, color: T.petrol }}><Icone nom={icone} taille={20} /></span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 650, lineHeight: 1.3, color: T.ink }}>{titre}</span>
                  <span className="ex-presentation__detail">{detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div style={{ ...ui.encart("neutral"), display: "flex", alignItems: "center", gap: 10, marginTop: mobile ? 10 : 12 }}>
            <Icone nom="groupe" taille={18} style={{ color: T.teal }} />
            <span>Si besoin, il transmet votre demande à l'équipe Elixir.</span>
          </div>
          <p style={{ margin: mobile ? "10px 0 0" : "14px 0 0", fontSize: 12, lineHeight: 1.45, color: T.inkMute, display: "flex", alignItems: "flex-start", gap: 6 }}>
            <Icone nom="bulle" taille={14} style={{ marginTop: 1 }} />
            <span>
              Vous le retrouverez à tout moment avec {mobile ? "la bulle" : "le bouton « Une question ? »"} en bas à droite de l'écran,
              et dans le menu, rubrique « Aide ».
            </span>
          </p>
        </div>

        {/* Actions : Essayer (pétrole, 48 px), Plus tard (filet), Ne plus afficher (discret) */}
        <div className="ex-presentation__actions" style={{ flexShrink: 0, padding: mobile ? "12px 18px 16px" : "18px 28px 24px" }}>
          <button type="button" className="ex-btn-petrole" onClick={onEssayer} style={bouton}>
            <Icone nom="bulle" taille={18} />Essayer maintenant
          </button>
          <button type="button" className="ex-btn-ligne" onClick={onPlusTard}
            style={{ ...ui.btn("ligne", "l"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}` }}>Plus tard</button>
          <button type="button" className="ex-presentation__plus" onClick={onNePlusAfficher}
            style={{ background: "none", border: "none", padding: "8px 4px", minHeight: mobile ? 48 : 36, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
              color: T.inkSoft, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>Ne plus afficher</button>
        </div>
      </div>
    </div>
  );
}
