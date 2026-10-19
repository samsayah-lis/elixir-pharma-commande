// ── Page d'accueil : squelette (chargement du chunk ou des offres) et chunk introuvable — bundle des pharmacies ──
// Un bloc sable statique (squelettes jamais animés : charte, lot 8) à la hauteur de la vitrine : titre, linéaire et tête
// de gondole sur ordinateur, segments et carte sur mobile (aucun décalage à l'arrivée).
import React from "react";
import EtatVide, { ActionEtat } from "../ui/EtatVide.jsx";

export default function SqueletteAccueil({ mobile }) {
  return <div role="status" aria-label="Chargement…" className="ex-squelette"
    style={{ borderRadius: 16, marginBottom: 28, height: mobile ? "min(26vh + 500px, 710px)" : "min(52vh + 216px, 736px)" }} />;
}

// chunk introuvable (nouvelle version mise en ligne pendant que la page était ouverte, connexion coupée)
export const AccueilIndisponible = () => <EtatVide cadre icone="actualiser" titre="Une nouvelle version du site est disponible"
  actions={<ActionEtat principal onClick={() => window.location.reload()}>Recharger la page</ActionEtat>} />;
