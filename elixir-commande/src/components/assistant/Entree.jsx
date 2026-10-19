// ── Assistant Elixir : ce qui reste dans le bundle des pharmacies (docs/assistant-conception.md § 1.1 et § 1.2) ──
// Budget du bundle : 3 Ko au plus pour l'assistant (§ 5 lot 4). Le groupe « AIDE » et le cadre du panneau (Aide.jsx) se
// chargent à la demande, seulement quand l'assistant est disponible (App ne les affiche pas sinon) ; le panneau lui-même
// au premier clic. Échec du chargement : rien dans la barre latérale ; à l'ouverture, un encart « rechargez la page ».
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
const Aide = React.lazy(() => charger().then((m) => ({ default: m.GroupeAide }), () => ({ default: () => null })));
const Panneau = React.lazy(() => charger().then((m) => ({ default: m.PanneauAssistant }), () => ({ default: Secours })));

export const GroupeAide = (props) => <React.Suspense fallback={null}><Aide {...props} /></React.Suspense>;
export const PanneauAssistant = (props) => <React.Suspense fallback={null}><Panneau {...props} /></React.Suspense>;
