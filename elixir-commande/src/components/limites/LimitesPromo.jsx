// ── Limites de quantité des menus promo et précommandes (26/10/2026, docs/limites-promo.md) : partie affichée ──
// Chargée à la demande par App, seulement quand un menu actif a un produit limité (rien de plus dans le bundle des pharmacies
// le reste du temps). Règles et textes : src/limites-promo.js (partagé avec le serveur), réexportés ici pour App.
//  • Pastille : ligne d'article (menus, recherche), même place et même allure que celle du contingentement — sous la désignation,
//    ou sous les boutons de quantité (le « + » ne bouge pas quand le texte change) ;
//  • EncartLimite : sous la ligne du panier (première ligne du CIP), « Ramener à » au-delà ;
//  • AlerteLimites : au-dessus de « Envoyer la commande », qui est alors bloqué.
// Tons de theme.js : info (reste), warn (limite atteinte, épuisé), danger (au-delà : le panier refuse l'envoi) ; cadenas pour warn et
// danger, jamais la couleur seule. Détail de la pastille en bulle au survol, lu par les lecteurs d'écran (ex-lecteur).
import React from "react";
import { Icone } from "../../icons.jsx";
import { tone, ui, R } from "../../theme.js";
import { pastilleLimite, messageDepassement } from "../../limites-promo.js";

export { limitesActives, depassementsLimites } from "../../limites-promo.js";

// encart du panier (même allure que ceux d'App : palier, contingentement, rupture)
const encart = (ton) => {
  const t = tone(ton);
  return { marginTop: 8, padding: "7px 10px", borderRadius: R.s, fontSize: 12, lineHeight: 1.45, background: t.bg, color: t.fg, border: `1px solid ${t.border}` };
};
const ligne = { display: "flex", alignItems: "flex-start", gap: 6 };

// l : limite du CIP ; e : reste lu par promo-limites (absent : la limite seule) ; auPanier : quantité du CIP au panier
export function Pastille({ l, e, auPanier, style }) {
  const p = pastilleLimite(l, e, auPanier);
  if (!p) return null;
  const t = tone(p.ton), alerte = p.ton === "warn" || p.ton === "danger";
  return (
    <div data-limite={p.ton} title={p.bulle} style={{ display: "flex", alignItems: "flex-start", gap: 5, width: "fit-content", maxWidth: "100%", boxSizing: "border-box",
      marginTop: 5, padding: "3px 9px", borderRadius: R.s, background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1px ${t.border}`, fontSize: 12, fontWeight: 500,
      lineHeight: 1.4, letterSpacing: 0, textAlign: "left", whiteSpace: "normal", ...style }}>
      {alerte && <Icone nom="cadenas" taille={12} epaisseur={2.2} style={{ marginTop: 2, flexShrink: 0 }} />}
      <span>{p.regle.charAt(0).toUpperCase() + p.regle.slice(1)}{p.etat && <> · <strong style={{ fontWeight: 700 }}>{p.etat}</strong></>}<span className="ex-lecteur"> {p.bulle}</span></span>
    </div>
  );
}

// o : dépassement du CIP (depassementsLimites) ; item : ligne du panier ; onQte(quantité) : ramener la ligne
export function EncartLimite({ l, e, o, item, onQte }) {
  const room = o ? Math.max(0, o.reste - (o.demande - item.qty)) : 0;   // reste pour CETTE ligne
  const max = item.step > 1 ? Math.floor(room / item.step) * item.step : room;
  return (
    <div style={encart(o ? "danger" : e?.reste === 0 ? "warn" : "info")}>
      <div style={ligne}>
        <Icone nom="cadenas" taille={14} style={{ marginTop: 2 }} />
        <span>Quantité limitée : <strong>{l.parPharmacie ? `${l.parPharmacie} par pharmacie` : "offre en quantité limitée"}</strong>
          {e?.deja > 0 ? ` · déjà commandé ${e.deja}` : ""}{e ? <> · {e.motif === "total" ? "disponible" : "reste"} <strong>{e.reste}</strong></> : null}</span>
      </div>
      {o && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 6, paddingLeft: 20, fontWeight: 700 }}>
          {o.reste === 0 ? (o.motif === "total" ? "Plus rien de disponible pour cette offre" : "Limite atteinte pour cette offre") : `Maximum ${o.reste} pour cette offre`}
          <button className="ex-btn-danger-ligne" onClick={() => onQte(max)} style={{ ...ui.btn("ligne", "s"), background: undefined, color: undefined, boxShadow: undefined,
            height: 28, padding: "0 12px", fontSize: 12 }}>{max > 0 ? `Ramener à ${max}` : "Retirer"}</button>
        </div>
      )}
    </div>
  );
}

export function AlerteLimites({ over }) {
  return (
    <div role="alert" style={{ ...encart("danger"), ...ligne, gap: 8, marginTop: 0, marginBottom: 10, fontWeight: 600 }}>
      <Icone nom="cadenas" taille={16} style={{ marginTop: 1 }} />
      <span>Quantité limitée dépassée : {over.map(messageDepassement).join(" ; ")}. Ajustez ces lignes pour envoyer la commande.</span>
    </div>
  );
}
