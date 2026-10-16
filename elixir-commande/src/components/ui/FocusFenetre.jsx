// ── Focus d'une fenêtre (role="dialog" aria-modal) : revue de la refonte, docs/refonte-charte.md § 20 ──
// À poser dans la fenêtre : à l'ouverture, le focus va sur l'élément marqué data-focus-initial (le bouton « Fermer »),
// sinon sur la fenêtre ; à la fermeture, il revient là où il était (le bouton qui l'a ouverte, ou le champ de la
// Saisie resté derrière « Offres du moment »). Rien d'autre : ni Échap ni piège à focus (lot E5, non validé).
// Sans hook dans App (le composant porte le sien) : utilisable dans un bloc rendu sous condition.
import { useEffect, useRef } from "react";

export default function FocusFenetre() {
  const repere = useRef(null);
  useEffect(() => {
    const avant = document.activeElement;
    const fenetre = repere.current?.closest('[role="dialog"]');
    (fenetre?.querySelector("[data-focus-initial]") || fenetre)?.focus?.({ preventScroll: true });
    return () => { if (avant && avant !== document.body && avant.isConnected) avant.focus?.({ preventScroll: true }); };
  }, []);
  return <span ref={repere} hidden />;
}
