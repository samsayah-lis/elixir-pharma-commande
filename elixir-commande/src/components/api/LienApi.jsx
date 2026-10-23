import React, { useEffect, useState } from "react";
import { T, ui } from "../../theme.js";
import { Icone } from "../../icons.jsx";

// ── « Accès API » dans « Mes commandes » (API des pharmacies) — chargé à la demande par App (aucun octet de plus dans
// le bundle des pharmacies que l'appel React.lazy) ──
// Le lien n'apparaît que si Elixir a ouvert un accès API pour la fiche : api-compte « etat », lu au plus une fois par
// identité et par session de la page (réponses franches seulement ; une erreur sera relue à la prochaine ouverture).
// Le panneau (AccesApi.jsx) est chargé à son tour, au clic. Identité : celle du jeton (appel = appelAuthentifie d'App) ;
// saisie Elixir « pour une pharmacie » : pour_odoo_id, revalidé par le serveur, panneau en lecture seule.
const AccesApi = React.lazy(() => import("../AccesApi.jsx"));
const etats = new Map();

export function lireEtatApi(appel, pour, qui) {
  if (!etats.has(qui)) {
    const p = appel("/.netlify/functions/api-compte", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "etat", ...(pour ? { pour_odoo_id: pour } : {}) }) })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    etats.set(qui, p);
    p.then(e => { if (!e) etats.delete(qui); });
  }
  return etats.get(qui);
}

// appel : appelAuthentifie d'App ; pour : odoo_id en saisie Elixir ; qui : identité (e-mail du compte, ou « a<odoo_id> »)
export default function LienApi({ appel, pour, qui }) {
  const [etat, setEtat] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    if (!qui) return undefined;
    let fini = false;
    lireEtatApi(appel, pour, qui).then(e => { if (!fini) setEtat(e); });
    return () => { fini = true; };
  }, [appel, pour, qui]);
  if (!qui || !etat?.ouvert) return null;
  // téléphone : icône seule (le titre « Mes commandes » garde sa place), libellé pour les lecteurs d'écran
  const etroit = typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 520px)").matches;
  return (
    <>
      <button className="ex-cible" onClick={() => setOuvert(true)} title="Accès API : clés pour automatiser vos commandes depuis un outil" aria-label="Accès API"
        style={{ ...(etroit ? ui.rond(36) : ui.btn("ligne", "s")), marginLeft: "auto", flexShrink: 0, background: undefined, color: T.petrol, boxShadow: `inset 0 0 0 1.5px ${T.lineField}` }}>
        <Icone nom="cadenas" taille={etroit ? 16 : 14} />{etroit ? null : "Accès API"}
      </button>
      {ouvert && (
        <React.Suspense fallback={null}>
          <AccesApi appel={appel} pour={pour} etatInitial={etat} onClose={() => setOuvert(false)}
            onEtat={(e) => { etats.set(qui, Promise.resolve(e)); setEtat(e); }} />
        </React.Suspense>
      )}
    </>
  );
}
