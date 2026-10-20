import React from "react";
import { T, ui, fmtPct } from "../theme.js";
import { Icone } from "../icons.jsx";

// ── Onglet « Péremptions » de l'admin : parties propres à l'admin (lot 0 de « Odoo facture la remise », 20/10/2026,
// docs/peremption.md). Importées par AdminPanel seulement (chargé à la demande) : hors du bundle des pharmacies.
// ShortExpiry les reçoit en prop (admin={PEREMPTIONS_ADMIN}). Odoo ne facture aucune remise péremption. Revue du lot 0 :
// plus aucune saisie ici. expiry_discounts n'est plus écrite : l'ancienne page, encore ouverte dans des onglets non
// rechargés, l'appliquait comme prix affiché, la table est publique, et la suite (conception § 1 et § 6) ne la reprend
// pas — une remise notée maintenant serait perdue. Une valeur déjà notée s'affiche en lecture seule. ──

// Remise saisie (lot suivant : décision « Appliquer dans Odoo ») : entier de 0 à 90 (0 = aucune, conception § 1) ; toute
// autre saisie → null (refusée). Plus utilisée par l'onglet au lot 0, gardée et testée pour le lot suivant.
export const remiseSaisie = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 90 ? n : null;
};

// encart en tête de l'onglet (ton warn) : ce que voient les pharmacies, pourquoi aucune remise ne se saisit ici
function Encart({ style }) {
  return (
    <div role="note" style={style}>
      <Icone nom="alerte" taille={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span><strong>Remises non facturées.</strong> Odoo facture le prix de la liste du client tant que la fonction « Odoo facture
        la remise » n'est pas en service. Les pharmacies voient donc le prix habituel (liste n° 5, comme partout sur le site), sans
        remise ni prix barré, et la date du lot. Les remises ne se saisissent plus ici : elles se décideront dans cet onglet, avec
        un aperçu des prix dans Odoo, quand la fonction sera en service. Une remise notée auparavant s'affiche, mais ne s'applique
        à rien et ne sera pas reprise.</span>
    </div>
  );
}

// cellule « Remise notée » d'un produit, en lecture seule : valeur déjà notée (sans effet, non reprise), sinon « — »
function CelluleRemise({ notee }) {
  if (notee == null) return <span style={{ fontSize: 12, color: T.inkMute }}>—</span>;
  return (
    <span title="Remise notée avant le 20/10/2026 : ne s'applique à rien, ni sur le site ni dans Odoo, et ne sera pas reprise"
      style={{ ...ui.badge("neutral"), fontSize: 12, padding: "3px 10px" }}>
      {fmtPct(notee)} · notée, non reprise
    </span>
  );
}

export const PEREMPTIONS_ADMIN = { Encart, CelluleRemise };
