// ── Page d'accueil : squelette (chargement du chunk ou des offres) et chunk introuvable — bundle des pharmacies ──
// Un bloc sable statique (squelettes jamais animés : charte, lot 8) à la hauteur de la vitrine : titre, linéaire et tête
// de gondole sur ordinateur, segments et carte sur mobile (aucun décalage à l'arrivée ; hauteurs mesurées le 20/10/2026 :
// 627 / 653 / 670 px à 375 × 667, 375 × 812, 430 × 932 ; 728 px à 1440 × 900).
import React from "react";
import EtatVide, { ActionEtat } from "../ui/EtatVide.jsx";

// Salle de la vitrine cinéma au-dessus (mises en avant, docs/accueil.md § 7) : réservée à la hauteur mesurée à la dernière
// visite (même largeur de fenêtre, hauteur à 80 px près ; 0 = pas de vitrine la dernière fois), sinon si un menu promo
// actif, pas échu (heure de Paris) et ouvrable existe (le repli automatique montrera une vitrine), à la hauteur de ce
// repli (un menu : 416 / 503 px à 375 × 667 / 812, hauteur minimale de la salle sur ordinateur). Mémo écrit par Accueil.
const CLE_SALLE = "accueil_salle";
export function salleMemorisee() {
  try {
    const m = JSON.parse(localStorage.getItem(CLE_SALLE) || "null");
    return m && m.l === window.innerWidth && Math.abs(m.h - window.innerHeight) <= 80 && m.s >= 0 ? m.s : null;
  } catch { return null; }
}
export function noterSalle(hauteur) {
  const memo = JSON.stringify({ l: window.innerWidth, h: window.innerHeight, s: Math.max(0, Math.round(hauteur || 0)) });
  try { localStorage.setItem(CLE_SALLE, memo); } catch { /* stockage indisponible : hauteur par défaut */ }
}
export const salleProbable = (promos, ouvrable = () => true) => {
  const aujourdhui = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  return (promos || []).some(p => p?.active && !(String(p.endDate || "").slice(0, 10) && String(p.endDate).slice(0, 10) < aujourdhui) && ouvrable(`promo_${p.id}`));
};

export default function SqueletteAccueil({ mobile, vedettes }) {
  const memo = salleMemorisee();
  const salle = memo != null ? memo > 0 : vedettes;
  const hauteur = memo || (mobile ? "clamp(416px, 62vh, 503px)" : window.innerWidth >= 1280 ? "clamp(440px, 58vh, 560px)" : "clamp(420px, 56vh, 520px)");
  return (<div role="status" aria-label="Chargement…">
    {salle && <div style={{ background: "var(--deep)", borderRadius: mobile ? 0 : 28, margin: mobile ? "-12px -10px 24px" : "0 0 24px", height: hauteur }} />}
    <div className="ex-squelette" style={{ borderRadius: 16, marginBottom: 28, height: mobile ? "min(18vh + 506px, 676px)" : "min(52vh + 260px, 740px)" }} />
  </div>);
}

// chunk introuvable (nouvelle version mise en ligne pendant que la page était ouverte, connexion coupée)
export const AccueilIndisponible = () => <EtatVide cadre icone="actualiser" titre="Une nouvelle version du site est disponible"
  actions={<ActionEtat principal onClick={() => window.location.reload()}>Recharger la page</ActionEtat>} />;
