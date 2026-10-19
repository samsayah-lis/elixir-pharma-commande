// ── Assistant Elixir : ce qui reste dans le bundle des pharmacies (docs/assistant-conception.md § 1.1 et § 1.2) ──
// Budget du bundle : 4 Ko au plus pour l'assistant (§ 5 lot 4, relevé de 3 à 4 Ko avec l'accord de Zineb le 19/10/2026).
// Le groupe « AIDE », le lanceur flottant et le cadre du panneau (Aide.jsx) se chargent à la demande, seulement quand
// l'assistant est disponible (App ne les affiche pas sinon) ; le panneau lui-même au premier clic, la fenêtre de
// présentation quand elle doit s'afficher. Échec du chargement : ni groupe « AIDE » ni lanceur ; à l'ouverture, un encart
// « rechargez la page ».
import React from "react";
import { T, ui } from "../../theme.js";

const charger = () => import("./Aide.jsx");
const Secours = ({ onClose }) => (
  <aside role="alert" aria-label="Assistant Elixir" style={{ ...ui.encart("danger"), position: "fixed", top: 16, right: 16, zIndex: 301, maxWidth: "calc(100% - 32px)",
    boxShadow: T.shadow3, display: "flex", alignItems: "center", gap: 12 }}>
    L'assistant n'a pas pu se charger : rechargez la page.
    <button className="ex-btn-ligne" onClick={onClose} style={ui.btn("ligne", "s")}>Fermer</button>
  </aside>
);
// composant `nom` d'Aide.jsx, chargé à la demande ; échec du chargement : secours (rien par défaut)
const aLaDemande = (nom, secours = () => null) => {
  const C = React.lazy(() => charger().then((m) => ({ default: m[nom] }), () => ({ default: secours })));
  return (props) => <React.Suspense fallback={null}><C {...props} /></React.Suspense>;
};

export const GroupeAide = aLaDemande("GroupeAide");
export const PanneauAssistant = aLaDemande("PanneauAssistant", Secours);
export const CoucheAssistant = aLaDemande("CoucheAssistant");
