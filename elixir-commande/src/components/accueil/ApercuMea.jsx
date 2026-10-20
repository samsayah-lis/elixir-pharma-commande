// ── Aperçu des mises en avant dans l'admin (chargé à la demande ; mêmes composants et styles que l'accueil) ──
// Rend le BROUILLON (objets visibles d'après l'éditeur) dans deux cadres : téléphone (375 px) et ordinateur (largeur du
// panneau). Produits résolus par la vérification du serveur (?verifier=, règle des diapositives), menus par admin_promos.
// Ajout au panier désactivé, pas de défilement automatique ; « Rejouer l'animation » remonte les deux vitrines.
// Cinema et Bento sont pris dans le chunk de l'accueil (import dynamique : ils n'en sortent pas, aucun chunk partagé de plus
// pour les pharmacies) ; ses styles viennent avec lui.
import React, { useEffect, useRef, useState } from "react";
import { construireMisesEnAvant, finEffective, jourParis } from "./vedettes.js";
import { POINTEUR_FIN, REDUIT, useMedia } from "./outils.js";

const rien = () => {};

export default function ApercuMea({ brouillon, statut, verif, promos = [], caches = new Set() }) {
  const [tour, setTour] = useState(0);
  const [mod, setMod] = useState(null);   // { Cinema, Bento } du chunk de l'accueil
  useEffect(() => { import("./Accueil.jsx").then(setMod).catch(() => setMod({ erreur: true })); }, []);
  const [largeur, setLargeur] = useState(1000);
  const cadre = useRef(null);
  useEffect(() => {
    const el = cadre.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(() => setLargeur(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const reduit = useMedia(REDUIT), finPointer = useMedia(POINTEUR_FIN);
  const aujourdhui = jourParis();
  const finMenuDe = (o) => promos.find(p => `promo_${p.id}` === o?.menu?.key)?.endDate;
  const ved = { repli: brouillon.repli, defilement: false, items: brouillon.items.filter(i => statut(i.id) === "visible").sort((a, b) => a.ordre - b.ordre)
    .map(i => { const o = i.type === "produit" ? verif[i.cip]?.offre : undefined;
      return { id: i.id, type: i.type, emplacement: i.emplacement, titre: i.titre, accroche: i.accroche, badge: i.badge, fin: finEffective(i.date_fin, finMenuDe(o)), image: i.image,
        couleur: i.couleur, couleur_auto: i.couleur_auto, offre: o, menu_id: i.menu_id }; }) };
  const mea = construireMisesEnAvant(ved, { catalogue: {}, catalogueCharge: false, stockData: {}, justifProducts: {}, menuOuvrable: (k) => !caches.has(k),
    regleSaisie: () => null, estCampagne: () => false, photos: {}, teinte: () => null, promos, aujourdhui });
  const commun = { reduit, finPointer, apercu: true, pret: true, qteAuPanier: {}, onAjouter: rien, onModifier: rien, onOuvrirPanier: rien, onVoir: rien, onExpire: rien };
  const vide = !mea.vitrine.length && !mea.grille.length;
  const { Cinema, Bento } = mod || {};
  const rendu = (format) => (<>
    {mea.vitrine.length > 0 && <Cinema key={`c${tour}`} items={mea.vitrine} format={format} defilement={false} arriveeForcee={!reduit} {...commun} />}
    {mea.grille.length > 0 && <Bento key={`b${tour}`} items={mea.grille} format={format} {...commun} />}
  </>);
  return (
    <div style={{ margin: "10px 0 6px", padding: 12, background: "var(--cream)", border: "1px solid var(--line)", borderRadius: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13, color: "var(--petrol)" }}>Aperçu du brouillon</b>
        <span style={{ fontSize: 11, color: "var(--ink-mute)", flex: 1 }}>Aperçu : ajout désactivé, pas de défilement automatique. Produits aux prix vérifiés par le serveur.</span>
        <button type="button" onClick={() => setTour(t => t + 1)} style={{ height: 30, padding: "0 12px", border: "none", borderRadius: 999, background: "var(--petrol)", color: "var(--paper)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Rejouer l'animation</button>
      </div>
      {!mod ? <div style={{ fontSize: 12, color: "var(--ink-mute)", padding: 12 }}>Chargement…</div> : mod.erreur ? <div style={{ fontSize: 12, color: "var(--danger)", padding: 12 }}>Aperçu indisponible (rechargez la page).</div>
        : vide ? <div style={{ fontSize: 12, color: "var(--ink-mute)", padding: 12 }}>Rien à montrer : aucune mise en avant visible et pas de menu promo actif pour le repli automatique.</div> : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div aria-label="Aperçu téléphone" style={{ width: 375, flexShrink: 0, maxHeight: 812, overflowY: "auto", overflowX: "hidden", padding: "12px 10px", background: "var(--cream)", borderRadius: 28, boxShadow: "0 0 0 8px var(--ink), 0 20px 40px -20px rgba(0,0,0,.5)", margin: 8 }}>
            {rendu("s")}
          </div>
          <div ref={cadre} aria-label="Aperçu ordinateur" style={{ flex: "1 1 600px", minWidth: 0 }}>{rendu(largeur >= 1100 ? "l" : "m")}</div>
        </div>
      )}
    </div>
  );
}
