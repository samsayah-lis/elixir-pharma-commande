// ── CIP / EAN avec bouton « Copier » (refonte charte, lot 4 ; sorti d'App à la revue : docs/refonte-charte.md § 20) ──
// Catalogue (grille, tableaux), Saisie de commande et recherche globale. CIP en chasse fixe 12 px --ink-mute, non
// sélectionnable (anti-copie, § 19 : une sélection balayée donnerait la liste des CIP) : on le copie un à la fois.
//  - copie par navigator.clipboard : coche « CIP copié » en ton ok ;
//  - copie refusée ou impossible (contexte non sécurisé, navigateur embarqué, permission) : « Copie impossible » en
//    ton danger, et ce CIP-là devient sélectionnable (ex-selectionnable : la copie à la main y est permise).
// Icône « copier » dessinée en CSS (ex-ico ex-ico-copier : masque sur un pseudo-élément, tokens.css) : aucun nœud SVG,
// la grille OTC en compte une par carte. tabulable={false} : hors de la tabulation (Saisie de commande, où l'on
// enchaîne « − », quantité, « + » au clavier).
// <CipCell cip={p.cip} />  ·  <CipCell cip={p.cip} tabulable={false} />
import { useState } from "react";
import { T, R } from "../../theme.js";
import { Icone } from "../../icons.jsx";

export default function CipCell({ cip, tabulable = true }) {
  const [etat, setEtat] = useState(null);         // null | "copie" | "echec"
  const [manuel, setManuel] = useState(false);    // copie refusée une fois : le CIP reste sélectionnable
  // sans CIP : tiret --ink-mute (il signifie « aucun », ce n'est pas un ornement)
  if (!cip || cip === "–") return <span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMute }}>–</span>;
  const copier = () => {
    const reussi = () => { setEtat("copie"); setTimeout(() => setEtat(null), 1500); };
    const refuse = () => { setEtat("echec"); setManuel(true); setTimeout(() => setEtat(null), 2500); };
    try { navigator.clipboard.writeText(cip).then(reussi, refuse); } catch { refuse(); }
  };
  const libelle = etat === "copie" ? "CIP copié" : etat === "echec" ? "Copie impossible : sélectionnez le CIP pour le copier" : `Copier le CIP ${cip}`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
      <span className={manuel ? "ex-selectionnable" : undefined} title={manuel ? "Sélectionnez le CIP pour le copier" : undefined}
        style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMute, letterSpacing: "-0.01em" }}>{cip}</span>
      {/* 18 px dessiné ; zone de toucher de 44 px sur écran tactile (ex-cible, lot 9) */}
      <button className={etat ? "ex-cible" : "ex-btn-discret ex-cible ex-ico ex-ico-copier"} onClick={copier}
        tabIndex={tabulable ? undefined : -1} title={etat ? libelle : "Copier CIP"} aria-label={libelle} style={{
        width: 18, height: 18, padding: 0, border: "none", borderRadius: R.xs, cursor: "pointer", flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center", "--ico": "12px",
        ...(etat === "copie" ? { background: T.okBg, color: T.ok } : etat === "echec" ? { background: T.dangerBg, color: T.danger } : {}),
      }}>{etat && <Icone nom={etat === "copie" ? "coche" : "alerte"} taille={12} epaisseur={2.2} />}</button>
    </span>
  );
}
