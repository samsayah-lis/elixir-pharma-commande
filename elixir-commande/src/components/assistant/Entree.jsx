// ── Assistant Elixir : ce qui reste dans le bundle des pharmacies (docs/assistant-conception.md § 1.1 et § 1.2) ──
// Le panneau (AssistantPanel, ses cartes et sa garde d'erreur) se charge à la demande, au premier clic, dans un
// morceau séparé. Ici, le strict nécessaire (budget du bundle : 3 Ko au plus pour l'assistant, § 5 lot 4) : son
// chargement (attente, échec du chargement) et le groupe « AIDE » de la barre latérale.
import React from "react";
import { T, R, ui } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import EtatVide, { Chargement } from "../ui/EtatVide.jsx";

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
