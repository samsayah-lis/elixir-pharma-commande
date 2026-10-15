import React, { useRef, useState } from "react";
import { uploadPrescription } from "../lab-justif-client.js";
import { T, R, tone } from "../theme.js";
import { Icone } from "../icons.jsx";

// Bloc « sur justificatif labo » sous une ligne du panier : attestation patient en France,
// renouvellement (si le labo l'exige), ordonnance anonymisée (facultative ou obligatoire).
// info = { attestation, renouvellement, rx: [{ id, name } | { uploading, name }] } ; auth = { getToken, odooId }
// Refonte charte (lot 6) : ton « labo » (sarcelle, décision de la cliente : justificatif et précommande en sarcelle,
// plus de violet), icônes au trait, 11 px minimum. Cases, dépôt et retrait des ordonnances inchangés.
const TON = tone("labo");
export default function JustifCartBlock({ rule, info = {}, onChange, auth }) {
  const fileRef = useRef(null);
  const [err, setErr] = useState("");
  const rx = info.rx || [];
  const box = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.45, color: T.ink, cursor: "pointer", marginTop: 8 };
  const caseACocher = { marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: "var(--teal)", cursor: "pointer" };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    const temp = { uploading: true, name: file.name, key: Math.random().toString(36).slice(2) };
    onChange(prev => ({ rx: [...(prev.rx || []), temp] }));
    try {
      const up = { ...(await uploadPrescription(file, auth)), at: Date.now() };   // effacée côté serveur après 2 jours sans commande
      onChange(prev => ({ rx: (prev.rx || []).map(x => x.key === temp.key ? up : x) }));
    } catch (ex) {
      setErr(ex.message);
      onChange(prev => ({ rx: (prev.rx || []).filter(x => x.key !== temp.key) }));
    }
  };

  return (
    <div style={{ marginTop: 8, background: TON.bg, border: `1px solid ${TON.border}`, borderRadius: R.s, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, fontWeight: 700, lineHeight: 1.4, color: TON.fg }}>
        <Icone nom="document" taille={14} style={{ marginTop: 2 }} />
        <span>Sur commande laboratoire ({rule.labNom}) — justificatif : ordonnance anonymisée</span>
      </div>
      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.45 }}>
        Elixir commande ce produit au laboratoire avec votre commande et l'ordonnance anonymisée comme justificatif{rule.delai ? ` — ${rule.delai}` : ""}.
        {rule.maxCommande ? ` ${rule.maxCommande} au plus par commande.` : ""}
      </div>
      <label style={box}>
        <input type="checkbox" checked={!!info.attestation} onChange={e => onChange({ attestation: e.target.checked })} style={caseACocher} />
        <span>J'atteste que cette commande répond au besoin d'un patient en France. <b style={{ color: T.danger }}>*</b></span>
      </label>
      {rule.renouvellement && (
        <label style={box}>
          <input type="checkbox" checked={!!info.renouvellement} onChange={e => onChange({ renouvellement: e.target.checked })} style={caseACocher} />
          <span>Il s'agit d'un renouvellement (patient déjà traité, nouvelle commande).</span>
        </label>
      )}
      {rule.ordonnance !== "non" && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.ink }}>
            Ordonnance anonymisée {rule.ordonnance === "obligatoire" ? <b style={{ color: T.danger }}>* obligatoire</b> : <span style={{ fontWeight: 400, color: T.inkSoft }}>(facultative, appuie la demande)</span>}
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2, lineHeight: 1.45 }}>Anonymisée = nom, prénom, date de naissance et n° de sécurité sociale du patient masqués ; médicament, posologie, date et prescripteur visibles.</div>
          {rx.map((f, i) => (
            <div key={f.id || f.key || i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.ink, marginTop: 6 }}>
              <Icone nom={f.uploading ? "horloge" : "document"} taille={14} style={{ color: TON.fg }} titre={f.uploading ? "Envoi en cours" : undefined} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <button className="ex-btn-discret" onClick={() => onChange(prev => ({ rx: (prev.rx || []).filter(x => (f.key ? x.key !== f.key : x.id !== f.id)) }))} title="Retirer" aria-label={`Retirer ${f.name}`}
                style={{ width: 24, height: 24, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icone nom="fermer" taille={12} epaisseur={2.4} />
              </button>
            </div>
          ))}
          {rx.length < 3 && (
            <button onClick={() => fileRef.current?.click()} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, background: T.surface,
              border: `1px dashed ${T.teal2}`, color: TON.fg, borderRadius: R.s, padding: "6px 12px", fontSize: 12, fontWeight: 700, lineHeight: 1.3, textAlign: "left", cursor: "pointer" }}>
              <Icone nom="plus" taille={14} epaisseur={2.4} />Joindre l'ordonnance anonymisée (photo ou PDF)</button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" capture={undefined} onChange={onFile} style={{ display: "none" }} />
          {rx.some(f => !f.uploading) && (
            <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>En joignant ce document, vous confirmez qu'il est anonymisé.</div>
          )}
          {err && <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: T.danger, marginTop: 6 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} />{err}</div>}
        </div>
      )}
    </div>
  );
}
