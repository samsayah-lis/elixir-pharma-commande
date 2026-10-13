import React, { useRef, useState } from "react";
import { uploadPrescription } from "../lab-justif-client.js";

// Bloc « sur justificatif labo » sous une ligne du panier : attestation patient en France,
// renouvellement (si le labo l'exige), ordonnance anonymisée (facultative ou obligatoire).
// info = { attestation, renouvellement, rx: [{ id, name } | { uploading, name }] } ; auth = { getToken, odooId }
export default function JustifCartBlock({ rule, info = {}, onChange, auth }) {
  const fileRef = useRef(null);
  const [err, setErr] = useState("");
  const rx = info.rx || [];
  const box = { display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11, lineHeight: 1.4, color: "#1e293b", cursor: "pointer", marginTop: 5 };

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
    <div style={{ marginTop: 8, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#5b21b6" }}>📑 Sur commande laboratoire ({rule.labNom}) — justificatif</div>
      <div style={{ fontSize: 10.5, color: "#6d28d9", marginTop: 2, lineHeight: 1.4 }}>
        Elixir commande ce produit au laboratoire avec votre commande comme justificatif{rule.delai ? ` — ${rule.delai}` : ""}.
        {rule.maxCommande ? ` ${rule.maxCommande} au plus par commande.` : ""}
      </div>
      <label style={box}>
        <input type="checkbox" checked={!!info.attestation} onChange={e => onChange({ attestation: e.target.checked })} style={{ marginTop: 1 }} />
        <span>J'atteste que cette commande répond au besoin d'un patient en France. <b style={{ color: "#b91c1c" }}>*</b></span>
      </label>
      {rule.renouvellement && (
        <label style={box}>
          <input type="checkbox" checked={!!info.renouvellement} onChange={e => onChange({ renouvellement: e.target.checked })} style={{ marginTop: 1 }} />
          <span>Il s'agit d'un renouvellement (patient déjà traité, nouvelle commande).</span>
        </label>
      )}
      {rule.ordonnance !== "non" && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 11, color: "#1e293b" }}>
            Ordonnance anonymisée {rule.ordonnance === "obligatoire" ? <b style={{ color: "#b91c1c" }}>* obligatoire</b> : <span style={{ color: "#64748b" }}>(facultative, appuie la demande)</span>}
          </div>
          <div style={{ fontSize: 10, color: "#7c3aed", marginTop: 1 }}>Masquez nom, prénom, date de naissance et n° de sécurité sociale du patient avant l'envoi.</div>
          {rx.map((f, i) => (
            <div key={f.id || f.key || i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 4 }}>
              <span>{f.uploading ? "⏳" : "📎"}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <button onClick={() => onChange(prev => ({ rx: (prev.rx || []).filter(x => (f.key ? x.key !== f.key : x.id !== f.id)) }))} title="Retirer"
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
          ))}
          {rx.length < 3 && (
            <button onClick={() => fileRef.current?.click()} style={{ marginTop: 5, background: "white", border: "1px dashed #a78bfa", color: "#5b21b6",
              borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>＋ Joindre l'ordonnance (photo ou PDF)</button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" capture={undefined} onChange={onFile} style={{ display: "none" }} />
          {rx.some(f => !f.uploading) && (
            <div style={{ fontSize: 10, color: "#6d28d9", marginTop: 3 }}>En joignant ce document, vous confirmez qu'il est anonymisé.</div>
          )}
          {err && <div role="alert" style={{ fontSize: 11, color: "#b91c1c", marginTop: 4 }}>⚠ {err}</div>}
        </div>
      )}
    </div>
  );
}
