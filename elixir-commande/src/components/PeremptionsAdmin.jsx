import React, { useState } from "react";
import { T, ui, tone, fmtPct } from "../theme.js";
import { Icone } from "../icons.jsx";

// ── Onglet « Péremptions » de l'admin : parties propres à l'admin (lot 0 de « Odoo facture la remise », 20/10/2026,
// docs/peremption.md). Importées par AdminPanel seulement (chargé à la demande) : hors du bundle des pharmacies.
// ShortExpiry les reçoit en prop (admin={PEREMPTIONS_ADMIN}). Odoo ne facture aucune remise péremption : la remise de
// l'admin devient une « remise notée » (expiry_discounts, comme avant), sans effet sur les prix ni dans Odoo. ──

// Remise notée : entier de 0 à 90 (0 = aucune, conception § 1) ; toute autre saisie → null (refusée, rien n'est envoyé)
export const remiseSaisie = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 90 ? n : null;
};

// encart en tête de l'onglet (ton warn) : ce que voient les pharmacies, ce que fait une remise notée
function Encart({ style }) {
  return (
    <div role="note" style={style}>
      <Icone nom="alerte" taille={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span><strong>Remises non facturées.</strong> Odoo facture le prix de la liste du client tant que la fonction « Odoo facture
        la remise » n'est pas en service. Les pharmacies voient donc le prix habituel (liste n° 5, comme partout sur le site), sans
        remise ni prix barré, et la date du lot. Une remise notée ici ne change aucun prix, ni sur le site ni dans Odoo.</span>
    </div>
  );
}

// cellule « Remise notée » d'un produit : badge (ou « — »), saisie, enregistrement par restock-alert (set_expiry_discount,
// comme avant) ; réponse vérifiée (avant : état local mis à jour même sur un refus) ; appelAdmin : adminFetch (jeton
// renouvelé) ou jeton de la session admin. onEnregistree(cip, pct) : met à jour la liste de ShortExpiry
function CelluleRemise({ p, notee, appelAdmin, onEnregistree }) {
  const [edition, setEdition] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);
  const enregistrer = async () => {
    const pct = remiseSaisie(saisie);
    if (pct == null) { setErreur("Un nombre entier de 0 à 90 (0 = aucune)"); return; }
    setEnvoi(true); setErreur(null);
    try {
      const res = await appelAdmin("/.netlify/functions/restock-alert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_expiry_discount", cip: p.cip, discount_pct: pct, product_name: p.name }),
      });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "session admin expirée, reconnectez-vous" : `HTTP ${res.status}`);
      onEnregistree(p.cip, pct);
      setEdition(false);
    } catch (e) { console.warn("[remise notée]", e.message); setErreur(`Non enregistrée : ${e.message}`); }
    finally { setEnvoi(false); }
  };
  const message = erreur && <div role="alert" style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: T.danger, maxWidth: 200 }}>{erreur}</div>;
  if (edition) return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" min="0" max="90" step="1" value={saisie} onChange={e => setSaisie(e.target.value)}
          onKeyDown={e => e.key === "Enter" && enregistrer()} autoFocus aria-label={`Remise notée sur ${p.name} (%), non facturée`}
          style={{ ...ui.qtyInput(true), width: 48 }} />
        <span style={{ fontSize: 12 }}>%</span>
        <button onClick={enregistrer} disabled={envoi} aria-label="Enregistrer la remise notée" title="Enregistrer"
          style={{ ...ui.rond(26), background: T.ok, color: "#fff" }}><Icone nom="coche" taille={13} epaisseur={2.6} /></button>
        <button className="ex-btn-discret" onClick={() => { setEdition(false); setErreur(null); }} aria-label="Annuler" title="Annuler"
          style={ui.rond(26)}><Icone nom="fermer" taille={12} epaisseur={2.4} /></button>
      </div>
      {message}
    </div>
  );
  // remise notée (ton info, « non facturée ») ; sans remise : « — » (plus de remise d'office)
  return (
    <div>
      <button onClick={() => { setEdition(true); setSaisie(notee != null ? String(notee) : ""); setErreur(null); }}
        title="Noter une remise (non facturée tant qu'Odoo ne la facture pas)"
        aria-label={notee != null ? `Remise notée ${notee} %, non facturée : modifier` : `Noter une remise sur ${p.name} (non facturée)`}
        style={{ ...ui.badge(notee != null ? "info" : "neutral"), fontSize: 12, padding: "3px 10px", border: `1px solid ${notee != null ? tone("info").border : "transparent"}`,
          cursor: "pointer", fontFamily: "inherit" }}>
        {notee != null ? <>{fmtPct(notee)} · non facturée</> : "—"}<Icone nom="crayon" taille={12} />
      </button>
      {message}
    </div>
  );
}

export const PEREMPTIONS_ADMIN = { Encart, CelluleRemise };
