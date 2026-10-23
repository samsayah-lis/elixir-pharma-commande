// ── Pastille de contingentement d'une ligne d'article (chargée avec la liste ; textes et règle : src/quota-ligne.js) ──
// Affichée partout où un produit contingenté se commande (Saisie, menus en tableau, cartes et liste mobile, Péremption courte,
// recherche, accueil), APRÈS les boutons de quantité ou sur sa propre rangée : en changeant de texte, elle ne déplace jamais
// le « + » sous le doigt. Son affichage demande le reste de la pharmacie (c.demander : quota-status, un appel pour tous les
// produits, gardé 5 min par App) ; en attendant, « vérification… » (la place est prise). Ton de theme.js : info (reste), warn
// (quota atteint, colis plus grand que le reste), danger (au-delà du reste : le panier refusera l'envoi), neutral (vérification,
// reste non vérifié) ; jamais la couleur seule (texte ; cadenas pour warn et danger).
// Accessibilité : la pastille est un bouton qui ouvre le détail (au doigt et au clavier, aria-expanded) ; son id décrit le champ
// de quantité de la ligne (aria-describedby) ; le passage au rouge est annoncé par une seule région role="status".
import React, { useEffect, useId, useRef, useState } from "react";
import { Icone } from "../../icons.jsx";
import { tone, R } from "../../theme.js";
import { pastilleQuota } from "../../quota-ligne.js";

// région d'annonce unique (masquée : classe ex-lecteur de tokens.css), créée à la première annonce
let region = null;
const annoncer = (texte) => {
  if (!region) { region = document.createElement("div"); region.className = "ex-lecteur"; region.setAttribute("role", "status"); document.body.append(region); }
  region.textContent = texte;
};
// conteneur de la ligne d'article, pour y trouver son champ de quantité
const LIGNE = ".ex-saisie-ligne, .ex-carte, .ex-tr, tr, li, article";

export default function PastilleQuota({ c, cip, saisie, tape, pas, forme, as: Balise = "div", className, style }) {
  const { demander, ko, cle, montees } = c, pret = !!c.quota;
  const id = useId(), ref = useRef(null), [ouvert, setOuvert] = useState(false);
  // reste demandé à l'affichage, à chaque changement de pharmacie, après un échec (nouvel essai : 1 min) ou un envoi
  useEffect(() => { demander(); }, [demander, pret, ko, cle]);
  // pastilles affichées : App ne relit le reste après un envoi que s'il y en a une (aucune lecture Odoo de plus sinon)
  useEffect(() => { montees.current++; return () => { montees.current--; }; }, [montees]);
  const p = pastilleQuota(c, cip, { saisie, tape, pas, forme });
  const rouge = p?.ton === "danger";
  // le champ de quantité de la ligne est décrit par la pastille
  useEffect(() => {
    const champ = p && ref.current?.closest(LIGNE)?.querySelector("input");
    if (!champ) return;
    const avant = champ.getAttribute("aria-describedby");
    champ.setAttribute("aria-describedby", avant ? `${avant} ${id}` : id);
    return () => { const v = (champ.getAttribute("aria-describedby") || "").split(" ").filter(x => x && x !== id).join(" "); v ? champ.setAttribute("aria-describedby", v) : champ.removeAttribute("aria-describedby"); };
  }, [!!p, id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rouge) annoncer(`${p.nom || "Produit contingenté"} : ${p.trop} de trop, le panier refusera l'envoi.`); }, [rouge]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  const t = tone(p.ton), alerte = p.ton === "warn" || rouge;
  return (
    <Balise ref={ref} className={className} data-quota={p.ton} style={{ display: "block", width: "fit-content", maxWidth: "100%", boxSizing: "border-box", marginTop: 5,
      borderRadius: R.s, background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1px ${t.border}`, fontSize: 12, fontWeight: 500, lineHeight: 1.4, letterSpacing: 0,
      textAlign: "left", whiteSpace: "normal", overflowWrap: "normal", ...style }}>
      <button type="button" id={id} aria-expanded={ouvert} title={p.bulle} onClick={(e) => { e.stopPropagation(); setOuvert(o => !o); }}
        style={{ display: "flex", alignItems: "flex-start", gap: 5, width: "100%", padding: "3px 9px", margin: 0, border: 0, background: "none", color: "inherit",
          font: "inherit", textAlign: "inherit", cursor: "pointer", borderRadius: R.s }}>
        {alerte && <Icone nom="cadenas" taille={12} epaisseur={2.2} style={{ marginTop: 2, flexShrink: 0 }} />}
        <span>{forme === "courte" ? "Quota" : "Contingenté\u00a0:"} {p.regle} · <strong style={{ fontWeight: 700 }}>{p.etat}</strong></span>
      </button>
      {ouvert && <span style={{ display: "block", padding: "0 9px 5px", fontSize: 11.5, lineHeight: 1.45 }}>{p.bulle}</span>}
    </Balise>
  );
}
