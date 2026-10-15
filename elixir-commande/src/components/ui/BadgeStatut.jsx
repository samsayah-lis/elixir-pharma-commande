// ── Statut d'un produit dans une liste de résultats (refonte charte, lot 5 : docs/refonte-charte.md § 3) ──
// Saisie de commande et recherche globale de l'en-tête. Toujours un libellé et une icône, jamais la couleur seule :
// en stock (ok), sur commande au laboratoire avec justificatif (sarcelle, décision de la cliente § 6), rupture (danger).
// <BadgeStatut statut="stock" />  ·  <BadgeStatut statut="commande" title="Commandé au laboratoire …" />
import { ui } from "../../theme.js";
import { Icone } from "../../icons.jsx";

const STATUTS = {
  stock:    { ton: "ok", icone: "coche", libelle: "En stock" },
  commande: { ton: "labo", icone: "document", libelle: "Sur commande" },
  rupture:  { ton: "danger", icone: "alerte", libelle: "Rupture" },
};

export default function BadgeStatut({ statut, title }) {
  const s = STATUTS[statut] || STATUTS.rupture;
  return (
    <span title={title} style={{ ...ui.badge(s.ton), padding: "2px 8px 2px 6px", flexShrink: 0 }}>
      <Icone nom={s.icone} taille={12} epaisseur={2.4} />{s.libelle}
    </span>
  );
}
