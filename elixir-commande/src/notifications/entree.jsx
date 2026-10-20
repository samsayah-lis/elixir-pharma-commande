// ── Notifications de l'appli Elixir : ce qui reste dans le bundle des pharmacies (docs/notifications.md) ──
// Seul fichier du lot importé par App : l'entrée « Notifications » de la barre latérale et deux fonctions qui chargent le
// reste à la demande (démarrage, déconnexion). Carte de l'accueil et panneau : Notifications.jsx, chargé seulement quand
// App les affiche (serveur disponible pour cette identité). Échec du chargement : rien (carte), encart « rechargez » (panneau).
import React from "react";
import { T, R, ui } from "../theme.js";
import { Icone } from "../icons.jsx";

const charger = () => import("./Notifications.jsx");
const SecoursPanneau = ({ onClose }) => (
  <aside role="alert" aria-label="Notifications" style={{ ...ui.encart("danger"), position: "fixed", top: 16, right: 16, zIndex: 401, maxWidth: "calc(100% - 32px)",
    boxShadow: T.shadow3, display: "flex", alignItems: "center", gap: 12 }}>
    Les notifications n'ont pas pu se charger : rechargez la page.
    <button type="button" className="ex-btn-ligne" onClick={onClose} style={ui.btn("ligne", "s")}>Fermer</button>
  </aside>
);
const aLaDemande = (nom, secours = () => null) => {
  const C = React.lazy(() => charger().then((m) => ({ default: m[nom] }), () => ({ default: secours })));
  return (props) => <React.Suspense fallback={null}><C {...props} /></React.Suspense>;
};
export const CarteNotifications = aLaDemande("CarteNotifications");
export const PanneauNotifications = aLaDemande("PanneauNotifications", SecoursPanneau);

// Barre latérale : groupe « MON COMPTE » sous « AIDE » (même dessin que GroupeAide)
export function EntreeMenuNotifications({ isDesktop, onOuvrir }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ padding: "12px 22px 6px", fontSize: 11, letterSpacing: "0.14em", color: T.inkMute, fontWeight: 700 }}>MON COMPTE</div>
      <button type="button" className="ex-menu" onClick={onOuvrir} style={{ display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 20px)", margin: "1px 10px",
        border: "none", borderRadius: isDesktop ? R.pill : 22, color: T.inkSoft, padding: isDesktop ? "8px 12px" : "10px 12px", minHeight: isDesktop ? 0 : 44,
        cursor: "pointer", fontSize: isDesktop ? 13 : 14, fontWeight: 500, lineHeight: 1.3, fontFamily: "inherit" }}>
        <Icone nom="cloche" taille={18} style={{ margin: "0 1px" }} />Notifications
      </button>
    </div>
  );
}

// Démarrage (une fois par identité) → { visible, carte, parcours, statut, acting } ; échec : rien d'affiché
export const demarrerNotifications = (opts) => import("./demarrage.js").then((m) => m.demarrer(opts)).catch(() => ({ visible: false }));

// Déconnexion : cet appareil ne reçoit plus les notifications de la pharmacie (seulement s'il a un service worker)
export function oublierAppareilNotifications() {
  try {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    sw.getRegistration("/").then((reg) => reg && import("./client.js").then((m) => m.oublier(reg))).catch(() => {});
  } catch { /* navigateur sans service worker */ }
}
