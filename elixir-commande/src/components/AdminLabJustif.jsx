import React, { useEffect, useState, useCallback } from "react";

// ── Admin : commandes sur justificatif labo ─────────────────────────────
// Réglages par laboratoire (produits, destinataires, objet, règles, envoi automatique) et suivi
// des demandes (commandes du site et commandes PharmaML repérées), avec envoi/relance/ignorer.
const API = "/.netlify/functions/lab-justif";
const STATUTS = {
  en_attente: ["En attente (labo non activé)", "#fef3c7", "#92400e"],
  a_envoyer: ["À envoyer", "#e0f2fe", "#075985"],
  en_cours: ["Envoi en cours", "#e0f2fe", "#075985"],
  a_verifier: ["À vérifier", "#ffedd5", "#9a3412"],
  bloquee: ["Client bloqué", "#fee2e2", "#991b1b"],
  erreur: ["Erreur", "#fee2e2", "#991b1b"],
  envoye: ["Envoyée", "#d1fae5", "#065f46"],
  ignoree: ["Ignorée", "#f1f5f9", "#475569"],
};
const card = { background: "white", borderRadius: 14, padding: "16px 20px", border: "1px solid #e8ecf0" };
const lbl = { fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 3 };
const inp = { width: "100%", boxSizing: "border-box", border: "1.5px solid #d6dde3", borderRadius: 8, padding: "7px 9px", fontSize: 13, fontFamily: "inherit" };
const btn = (bg, color = "white") => ({ background: bg, color, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" });
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export default function AdminLabJustif({ adminFetch, flash }) {
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(null);
  const [demandes, setDemandes] = useState([]);
  const [busy, setBusy] = useState("");
  const [filtre, setFiltre] = useState("actives");
  const [preview, setPreview] = useState(null);
  const [testAdr, setTestAdr] = useState("");

  const call = useCallback(async (body) => {
    const r = await adminFetch(API, { method: "POST", body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }, [adminFetch]);
  const charger = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([call({ action: "config_get" }), call({ action: "list" })]);
      setCfg(c.config); setSaved(JSON.stringify(c.config)); setDemandes(l.demandes || []);
    } catch (e) { flash?.(`⚠ ${e.message}`); }
  }, [call, flash]);
  useEffect(() => { charger(); }, [charger]);

  const act = async (label, body, ok) => {
    setBusy(label);
    try { const j = await call(body); if (ok) ok(j); return j; }
    catch (e) { flash?.(`⚠ ${e.message}`); return null; }
    finally { setBusy(""); }
  };
  const majLab = (k, patch) => setCfg(c => ({ ...c, labs: { ...c.labs, [k]: { ...c.labs[k], ...patch } } }));
  const majProd = (k, i, patch) => setCfg(c => { const ps = [...c.labs[k].produits]; ps[i] = { ...ps[i], ...patch }; return { ...c, labs: { ...c.labs, [k]: { ...c.labs[k], produits: ps } } }; });
  const dirty = cfg && JSON.stringify(cfg) !== saved;
  const enregistrer = () => act("save", { action: "config_save", config: cfg }, (j) => { setCfg(j.config); setSaved(JSON.stringify(j.config)); flash?.("✓ Réglages enregistrés"); });
  const basculer = (k) => {
    const lab = cfg.labs[k];
    if (!lab.actif && !window.confirm(`Activer l'envoi automatique pour ${lab.nom} ?\n\nChaque commande sur justificatif (site${lab.detection ? " et logiciel des pharmacies via PharmaML" : ""}) créera et CONFIRMERA un bon d'achat Odoo chez ${lab.fournisseurNom || "le fournisseur"}${/EDI|CSP/i.test(lab.fournisseurNom || "") ? " (envoi EDI immédiat)" : ""}, puis enverra le justificatif à ${lab.a}.\n\nLes commandes PharmaML passées avant l'activation ne sont jamais reprises.`)) return;
    const next = { ...cfg, labs: { ...cfg.labs, [k]: { ...lab, actif: !lab.actif } } };
    act("save", { action: "config_save", config: next }, (j) => { setCfg(j.config); setSaved(JSON.stringify(j.config)); flash?.(j.config.labs[k].actif ? `✓ ${lab.nom} : envoi automatique activé` : `${lab.nom} : envoi automatique arrêté`); });
  };
  const ajouterProduit = async (k) => {
    const cip = window.prompt("CIP13 du produit à ajouter :");
    if (!cip) return;
    const j = await act("lookup", { action: "product_lookup", cip: cip.trim() });
    if (!j) return;
    if (!j.odooId) { flash?.("⚠ Produit introuvable dans Odoo"); return; }
    setCfg(c => ({ ...c, labs: { ...c.labs, [k]: { ...c.labs[k], produits: [...c.labs[k].produits, { cip: cip.trim(), odooId: j.odooId, nom: j.nom, court: j.nom.split(" ")[0], maxCommande: null, maxJour: null, detection: true }] } } }));
  };
  const voirOrdonnance = async (id) => {
    const j = await act("rx", { action: "rx_get", id });
    if (!j) return;
    const bin = atob(j.data_base64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    window.open(URL.createObjectURL(new Blob([arr], { type: j.mime })), "_blank", "noopener");
  };
  const majDemande = (d) => setDemandes(ds => ds.map(x => x.id === d.id ? d : x));

  if (!cfg) return <div style={{ padding: 30, color: "#888" }}>Chargement…</div>;
  const visibles = demandes.filter(d => filtre === "toutes" ? true : filtre === "envoye" ? d.statut === "envoye" : !["envoye", "ignoree"].includes(d.statut));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "linear-gradient(135deg,#0f2d3d,#1a4a5e)", color: "white" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>📑 Commandes sur justificatif labo</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, lineHeight: 1.5 }}>
          Pour les produits ci-dessous, chaque commande de pharmacie (site, et logiciel de la pharmacie via PharmaML si « repérage » est coché)
          crée un bon d'achat Odoo chez le fournisseur du labo, puis envoie au labo le bon et le justificatif (pharmacie, CIP, référence et date
          de la commande, ordonnance anonymisée si jointe). Les commandes du site restent ensuite à synchroniser vers PharmaML à réception.
        </div>
      </div>

      {Object.values(cfg.labs).map(lab => (
        <div key={lab.key} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f2d3d" }}>{lab.nom}</div>
            <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 10, padding: "3px 9px", background: lab.actif ? "#d1fae5" : "#f1f5f9", color: lab.actif ? "#065f46" : "#475569" }}>
              {lab.actif ? `● Envoi automatique actif depuis le ${dt(lab.depuis)}` : "○ Envoi automatique arrêté"}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => basculer(lab.key)} disabled={!!busy || dirty} title={dirty ? "Enregistrez d'abord les réglages" : ""}
              style={{ ...btn(lab.actif ? "#b91c1c" : "#059669"), opacity: busy || dirty ? 0.5 : 1 }}>{lab.actif ? "Arrêter l'envoi automatique" : "Activer l'envoi automatique"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
            <div><label style={lbl}>Destinataires (séparés par des virgules)</label><input style={inp} value={lab.a} onChange={e => majLab(lab.key, { a: e.target.value })} /></div>
            <div><label style={lbl}>Copie</label><input style={inp} value={lab.cc} onChange={e => majLab(lab.key, { cc: e.target.value })} /></div>
            <div><label style={lbl}>Fournisseur Odoo (id · nom)</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...inp, width: 90 }} value={lab.fournisseurId || ""} onChange={e => majLab(lab.key, { fournisseurId: e.target.value.replace(/\D/g, "") })} />
                <input style={inp} value={lab.fournisseurNom} onChange={e => majLab(lab.key, { fournisseurNom: e.target.value })} />
              </div></div>
            <div><label style={lbl}>Objet du mail</label><input style={inp} value={lab.sujet} onChange={e => majLab(lab.key, { sujet: e.target.value })} />
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{"{bon} {produit} {pharmacie} {cip} {ville} {reference} {date}"}</div></div>
          </div>
          <div style={{ marginTop: 10 }}><label style={lbl}>Texte d'introduction</label>
            <textarea style={{ ...inp, minHeight: 64 }} value={lab.intro} onChange={e => majLab(lab.key, { intro: e.target.value })} /></div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12, alignItems: "center" }}>
            <label>Ordonnance anonymisée :{" "}
              <select value={lab.ordonnance} onChange={e => majLab(lab.key, { ordonnance: e.target.value })} style={{ ...inp, width: "auto", padding: "4px 6px" }}>
                <option value="facultative">facultative</option><option value="obligatoire">obligatoire</option><option value="non">non demandée</option>
              </select></label>
            <label><input type="checkbox" checked={!!lab.renouvellement} onChange={e => majLab(lab.key, { renouvellement: e.target.checked })} /> question « renouvellement »</label>
            <label><input type="checkbox" checked={!!lab.detection} onChange={e => majLab(lab.key, { detection: e.target.checked })} /> repérage des commandes PharmaML (logiciel des pharmacies)</label>
            <label>Anti-relance : <input type="number" min="0" max="60" value={lab.antiRelanceJours ?? 7} onChange={e => majLab(lab.key, { antiRelanceJours: e.target.value })} style={{ ...inp, width: 56, padding: "4px 6px" }} /> jours</label>
            <label><input type="checkbox" checked={lab.site !== false} onChange={e => majLab(lab.key, { site: e.target.checked })} /> commandable sur le site</label>
          </div>
          <div style={{ marginTop: 6 }}><label style={lbl}>Délai affiché aux pharmacies</label><input style={inp} value={lab.delai} onChange={e => majLab(lab.key, { delai: e.target.value })} /></div>

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                <th style={{ padding: 4 }}>CIP13</th><th>Produit</th><th>Nom dans l'objet</th><th>Max / commande</th><th>Max / jour</th><th>Repérage PharmaML</th><th />
              </tr></thead>
              <tbody>{lab.produits.map((p, i) => (
                <tr key={p.cip} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: 4, fontFamily: "monospace" }}>{p.cip}{!p.odooId && <span style={{ color: "#b91c1c" }}> ⚠ sans fiche</span>}</td>
                  <td>{p.nom}</td>
                  <td><input style={{ ...inp, padding: "3px 6px" }} value={p.court} onChange={e => majProd(lab.key, i, { court: e.target.value })} /></td>
                  <td><input style={{ ...inp, width: 60, padding: "3px 6px" }} value={p.maxCommande || ""} onChange={e => majProd(lab.key, i, { maxCommande: e.target.value.replace(/\D/g, "") })} /></td>
                  <td><input style={{ ...inp, width: 60, padding: "3px 6px" }} value={p.maxJour || ""} onChange={e => majProd(lab.key, i, { maxJour: e.target.value.replace(/\D/g, "") })} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={p.detection !== false} onChange={e => majProd(lab.key, i, { detection: e.target.checked })} /></td>
                  <td><button onClick={() => window.confirm(`Retirer ${p.nom} ?`) && setCfg(c => ({ ...c, labs: { ...c.labs, [lab.key]: { ...c.labs[lab.key], produits: c.labs[lab.key].produits.filter((_, j) => j !== i) } } }))}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}>✕</button></td>
                </tr>))}</tbody>
            </table>
            <button onClick={() => ajouterProduit(lab.key)} disabled={!!busy} style={{ ...btn("#f1f5f9", "#0f2d3d"), marginTop: 6 }}>＋ Ajouter un produit (CIP)</button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e2e8f0" }}>
            <input placeholder="adresse interne pour le mail de test" value={testAdr} onChange={e => setTestAdr(e.target.value)} style={{ ...inp, width: 260 }} />
            <button disabled={!!busy || dirty} onClick={() => act("test", { action: "test_mail", lab: lab.key, adresse: testAdr }, (j) => flash?.(`✓ Mail de test envoyé à ${j.a}`))}
              style={{ ...btn("#334155"), opacity: busy || dirty ? 0.5 : 1 }}>✉️ Mail de test</button>
            <span style={{ fontSize: 11, color: "#64748b" }}>Exemple fictif, sans bon de commande, jamais envoyé au laboratoire.</span>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={enregistrer} disabled={!dirty || !!busy} style={{ ...btn("#0f2d3d"), opacity: !dirty || busy ? 0.5 : 1 }}>{busy === "save" ? "Enregistrement…" : "💾 Enregistrer les réglages"}</button>
        {dirty && <span style={{ fontSize: 12, color: "#b45309", fontWeight: 700 }}>Réglages modifiés non enregistrés</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => act("portail", { action: "test_portail" }, (j) => flash?.(`✓ Portail PharmaML joignable (${j.commandesDuJour} commande(s) aujourd'hui)`))} disabled={!!busy} style={btn("#f1f5f9", "#0f2d3d")}>🔌 Tester le portail PharmaML</button>
        <button onClick={() => act("run", { action: "run" }, (j) => { flash?.((j.journal || []).join(" · ")); setTimeout(charger, 20000); })} disabled={!!busy} style={btn("#f1f5f9", "#0f2d3d")}>{busy === "run" ? "Lancement…" : "🔄 Contrôler maintenant"}</button>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2d3d" }}>Demandes</div>
          {[["actives", "À traiter / en cours"], ["envoye", "Envoyées"], ["toutes", "Toutes"]].map(([k, t]) => (
            <button key={k} onClick={() => setFiltre(k)} style={{ ...btn(filtre === k ? "#0f2d3d" : "#f1f5f9", filtre === k ? "white" : "#0f2d3d"), padding: "4px 10px" }}>{t}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={charger} style={{ ...btn("#f1f5f9", "#0f2d3d"), padding: "4px 10px" }}>↻ Actualiser</button>
        </div>
        {!visibles.length ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 10 }}>Aucune demande.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                <th style={{ padding: 5 }}>Commande</th><th>Pharmacie</th><th>Produits</th><th>Labo</th><th>Statut</th><th>Bon</th><th>Actions</th>
              </tr></thead>
              <tbody>{visibles.map(d => {
                const [t, bg, fg] = STATUTS[d.statut] || [d.statut, "#f1f5f9", "#475569"];
                return (
                  <tr key={d.id} style={{ borderTop: "1px solid #f1f5f9", verticalAlign: "top" }}>
                    <td style={{ padding: 5 }}>{dt(d.dateCommande)}<div style={{ fontSize: 10, color: "#64748b" }}>{d.source === "site" ? "🌐 site" : "📡 PharmaML"} · {d.reference}</div></td>
                    <td>{d.pharmacie?.nom}<div style={{ fontSize: 10, color: "#64748b" }}>CIP {d.pharmacie?.cip || "?"}{d.saisiPar ? " · saisie Elixir" : ""}</div></td>
                    <td>{d.lignes.map((l, i) => <div key={i}>{l.qte} × {l.produit}</div>)}
                      <div style={{ fontSize: 10, color: "#6d28d9" }}>{[d.attestation && "attestation", d.renouvellement && "renouvellement"].filter(Boolean).join(" · ")}</div>
                      {(d.rx || []).map(x => <button key={x.id} onClick={() => voirOrdonnance(x.id)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 11, padding: 0, display: "block" }}>📎 {x.name}</button>)}
                    </td>
                    <td>{cfg.labs[d.lab]?.nom || d.lab}</td>
                    <td><span style={{ background: bg, color: fg, borderRadius: 8, padding: "2px 7px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{t}</span>
                      {d.envoyeLe && <div style={{ fontSize: 10, color: "#64748b" }}>{dt(d.envoyeLe)}</div>}
                      {(d.motif || d.erreur) && <div style={{ fontSize: 10, color: "#9a3412", maxWidth: 260 }}>{d.erreur || d.motif}</div>}
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{d.poNom || ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button onClick={() => act("preview", { action: "preview", id: d.id }, setPreview)} style={{ ...btn("#f1f5f9", "#0f2d3d"), padding: "3px 8px" }}>Mail</button>{" "}
                      {d.statut !== "envoye" && d.statut !== "en_cours" && (<>
                        <button disabled={!!busy} onClick={() => {
                          const forcer = d.statut === "a_verifier" || d.statut === "bloquee";
                          if (!window.confirm(`${forcer && d.motif ? `Alerte : ${d.motif}\n\nEnvoyer quand même ? ` : ""}Créer et confirmer le bon chez ${cfg.labs[d.lab]?.fournisseurNom || "le fournisseur"}${/CSP|EDI/i.test(cfg.labs[d.lab]?.fournisseurNom || "") ? " (commande EDI immédiate)" : ""} et envoyer le justificatif à ${cfg.labs[d.lab]?.a} ?`)) return;
                          act("send", { action: "send", id: d.id, forcer }, (j) => {
                            majDemande(j.demande);
                            flash?.(j.lance ? "Envoi lancé : bon, PDF et mail sont faits en arrière-plan" : "Envoi programmé au prochain passage (10 min)");
                            setTimeout(charger, 12000);
                          });
                        }} style={{ ...btn("#059669"), padding: "3px 8px" }}>Envoyer</button>{" "}
                        {d.statut !== "ignoree" && <button disabled={!!busy} onClick={() => { const m = window.prompt("Motif (facultatif) :", ""); if (m === null) return; act("ignore", { action: "ignore", id: d.id, motif: m || undefined }, (j) => majDemande(j.demande)); }}
                          style={{ ...btn("#f1f5f9", "#475569"), padding: "3px 8px" }}>Ignorer</button>}
                      </>)}
                    </td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 760, width: "100%", maxHeight: "86vh", overflow: "auto", padding: 18 }}>
            <div style={{ fontSize: 12, color: "#475569" }}>À : {preview.a}{preview.cc ? ` · Cc : ${preview.cc}` : ""}</div>
            <div style={{ fontWeight: 800, margin: "4px 0 10px" }}>{preview.sujet}</div>
            <iframe title="Aperçu du mail" sandbox="" srcDoc={preview.corps} style={{ width: "100%", height: 460, border: "1px solid #e2e8f0", borderRadius: 8 }} />
            <div style={{ textAlign: "right", marginTop: 8 }}><button onClick={() => setPreview(null)} style={btn("#0f2d3d")}>Fermer</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
