// ── CIP / EAN : tout l'élément copie le CIP (refonte charte, lot 4 ; revue § 20 ; copie facile du 27/10/2026, docs/cip-copie.md) ──
// Partout où une pharmacie voit un CIP : catalogue (grille, tableaux, liste mobile), Saisie de commande, recherche globale,
// suggestions de recommande, panier, Mes commandes, Péremption courte, fauteuils, justificatif labo, commandes groupées, cartes
// de l'assistant.
// CIP en chasse fixe 12 px --ink-mute, NON sélectionnable (anti-copie, § 19 : une sélection balayée donnerait la liste des
// CIP du catalogue) : on le copie un à la fois, en cliquant sur le numéro lui-même — numéro et icône forment un seul bouton
// (grande zone, curseur, survol, Entrée / Espace au clavier, « Cliquer pour copier le CIP » au survol). Le clic ne remonte pas
// au conteneur (stopPropagation) : copier un CIP ne déclenche jamais l'action d'une carte cliquable (suggestions de recommande,
// qui ajoutent au panier) ; les écouteurs de l'anti-copie sont en phase de capture sur window, ils ne sont pas concernés.
//  - copie réussie (src/cip-copie.js, copierCip) : « CIP copié ✓ » en ton ok à la place du numéro pendant 1,5 s, largeur
//    gardée (pas de saut dans les tableaux), et un petit message en bas de l'écran (ToastCopie, pour qu'on le voie sur mobile) ;
//  - copie refusée ou impossible (contexte non sécurisé, navigateur embarqué, permission, repli execCommand en échec) :
//    « Copie impossible » en ton danger 2,5 s sur le bouton entier et un message en bas (« Copie impossible : sélectionnez le
//    numéro pour le copier », ton danger) ; PUIS ce CIP-là devient sélectionnable (ex-selectionnable : la copie à la main y est
//    permise), avec la mention « à sélectionner » et un petit bouton pour réessayer.
// Icône « copier » dessinée en CSS (ex-ico ex-ico-copier : masque sur ::before, tokens.css ; .ex-cip la place à droite) :
// aucun nœud SVG, la grille OTC en compte une par carte. tabulable={false} : hors de la tabulation (Saisie de commande, où
// l'on enchaîne « − », quantité, « + » au clavier) ; le clic et le toucher copient toujours.
// <CipCell cip={p.cip} />  ·  <CipCell cip={p.cip} tabulable={false} />
import { useEffect, useState } from "react";
import { T, R, tone } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import { copierCip, EVENEMENT_COPIE } from "../../cip-copie.js";

const mono = { fontFamily: T.mono, fontSize: 12, letterSpacing: "-0.01em" };
const TITRE = "Cliquer pour copier le CIP";
export const DUREE_COPIE = 1500, DUREE_ECHEC = 2500;

export default function CipCell({ cip, tabulable = true }) {
  const [etat, setEtat] = useState(null);         // null | "copie" | "echec"
  const [manuel, setManuel] = useState(false);    // copie refusée une fois (après le message « Copie impossible ») : le CIP reste sélectionnable
  const [largeur, setLargeur] = useState(0);      // largeur du bouton au clic : gardée pendant le message
  // sans CIP : tiret --ink-mute (il signifie « aucun », ce n'est pas un ornement)
  if (!cip || cip === "–") return <span style={{ ...mono, color: T.inkMute }}>–</span>;
  const copier = (e) => {
    e?.stopPropagation?.();   // jamais l'action du conteneur (carte cliquable)
    setLargeur(e?.currentTarget?.offsetWidth || 0);
    copierCip(cip).then((ok) => {
      if (ok) { setEtat("copie"); setTimeout(() => setEtat(null), DUREE_COPIE); }
      else { setEtat("echec"); setTimeout(() => { setEtat(null); setManuel(true); }, DUREE_ECHEC); }   // le message d'abord, le repli sélectionnable ensuite
    });
  };
  const libelle = etat === "copie" ? "CIP copié" : etat === "echec" ? "Copie impossible : sélectionnez le CIP pour le copier" : `Copier le CIP ${cip}`;
  if (manuel) {
    // repli : numéro sélectionnable (copie à la main permise), mention visible, petit bouton pour réessayer (18 px dessiné, 44 px au toucher)
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
        <span className="ex-selectionnable" title="Sélectionnez le CIP pour le copier" style={{ ...mono, color: T.inkMute }}>{cip}</span>
        <span style={{ fontSize: 11, color: T.inkSoft, fontStyle: "italic", whiteSpace: "nowrap" }}>à sélectionner</span>
        <button type="button" className={etat ? "ex-cible" : "ex-btn-discret ex-cible ex-ico ex-ico-copier"} onClick={copier}
          tabIndex={tabulable ? undefined : -1} title={etat ? libelle : "Réessayer la copie"} aria-label={etat ? libelle : `Réessayer la copie du CIP ${cip}`} style={{
          width: 18, height: 18, padding: 0, border: "none", borderRadius: R.xs, cursor: "pointer", flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center", "--ico": "12px",
          ...(etat ? { background: tone(etat === "copie" ? "ok" : "danger").bg, color: tone(etat === "copie" ? "ok" : "danger").fg } : {}),
        }}>{etat && <Icone nom={etat === "copie" ? "coche" : "alerte"} taille={12} epaisseur={2.2} />}</button>
      </span>
    );
  }
  // un seul bouton : numéro + icône (tokens.css, .ex-cip) ; pendant le message, « CIP copié » et une coche à la largeur du numéro
  return (
    <button type="button" className={`ex-cip ex-cible${etat ? ` ex-cip--${etat}` : " ex-ico ex-ico-copier"}`} onClick={copier}
      tabIndex={tabulable ? undefined : -1} title={etat ? libelle : TITRE} aria-label={libelle}
      style={etat && largeur ? { minWidth: largeur, justifyContent: "center" } : undefined}>
      {etat
        ? <><Icone nom={etat === "copie" ? "coche" : "alerte"} taille={12} epaisseur={2.4} /><span style={{ fontSize: 12, fontWeight: 600 }}>{etat === "copie" ? "CIP copié" : "Copie impossible"}</span></>
        : <span style={mono}>{cip}</span>}
    </button>
  );
}

// ── Message « CIP 3400… copié » en bas de l'écran, hors du flux (une fois dans App, à côté du message flash) ──
// Région d'annonce toujours présente (aria-live polite) ; écoute l'événement de src/cip-copie.js (signalerCopie : { message, ton })
// envoyé par CipCell et CopieCips. Ton ok 1,8 s ; ton danger (copie impossible) 3 s. Position en CSS (.ex-toast-copie, tokens.css) :
// centré en bas sur ordinateur ; sous 768 px, calé à gauche pour laisser la colonne du panier flottant et du lanceur de l'assistant.
export function ToastCopie() {
  const [msg, setMsg] = useState(null);   // null | { message, ton }
  useEffect(() => {
    let t;
    const sur = (e) => {
      const d = e.detail && typeof e.detail === "object" ? e.detail : { message: String(e.detail || ""), ton: "ok" };
      setMsg(d.message ? d : null); clearTimeout(t); t = setTimeout(() => setMsg(null), d.ton === "danger" ? 3000 : 1800);
    };
    window.addEventListener(EVENEMENT_COPIE, sur);
    return () => { window.removeEventListener(EVENEMENT_COPIE, sur); clearTimeout(t); };
  }, []);
  const t = tone(msg?.ton === "danger" ? "danger" : "ok");
  return (
    <div role="status" aria-live="polite" className="ex-toast-copie">
      {msg && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: t.bg, color: t.fg, border: `1px solid ${t.border}`,
          padding: "8px 14px", borderRadius: R.pill, fontSize: 13, fontWeight: 600, lineHeight: 1.3, boxShadow: T.shadow2, animation: "fadeIn 0.2s" }}>
          <Icone nom={msg.ton === "danger" ? "alerte" : "coche"} taille={14} epaisseur={2.4} />{msg.message}
        </div>
      )}
    </div>
  );
}
