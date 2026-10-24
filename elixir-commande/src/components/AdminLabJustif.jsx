import React, { useEffect, useState, useCallback, useRef } from "react";
import { T, tone } from "../theme.js";

// ── Admin : commandes sur justificatif labo ─────────────────────────────
// Réglages par laboratoire (produits, destinataires, objet, règles, envoi automatique) et suivi
// des demandes (commandes du site et commandes PharmaML repérées), avec envoi/relance/ignorer.
const API = "/.netlify/functions/lab-justif";
// statut → [libellé, fond, texte], aux tons de la charte (lot 10 : tone(), src/theme.js) ; le libellé reste toujours affiché
const st = (lib, ton) => [lib, tone(ton).bg, tone(ton).fg];
const STATUTS = {
  en_attente: st("En attente (labo non activé)", "warn"),
  a_envoyer: st("À envoyer", "labo"),
  en_cours: st("Envoi en cours", "labo"),
  a_verifier: st("À vérifier", "acting"),
  bloquee: st("Client bloqué", "danger"),
  erreur: st("Erreur", "danger"),
  envoye: st("Envoyée", "ok"),
  ignoree: st("Ignorée", "neutral"),
};
const card = { background: T.surface, borderRadius: 14, padding: "16px 20px", border: "1px solid var(--line)" };
const lbl = { fontSize: 11, fontWeight: 700, color: T.inkSoft, display: "block", marginBottom: 3 };
const inp = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.lineField}`, borderRadius: 8, padding: "7px 9px", fontSize: 13, fontFamily: "inherit", background: T.surface, color: T.ink };
const btn = (bg, color = T.paper) => ({ background: bg, color, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" });
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

// Suivi vu par la pharmacie : étapes qu'Elixir peut poser à la main
const ETAPES_SUIVI = [
  ["transmise", "Transmise au laboratoire (hors outil)"],
  ["acceptee", "Acceptée par le laboratoire"],
  ["recue_elixir", "Reçue chez Elixir"],
  ["expediee", "Expédiée à la pharmacie"],
  ["refusee", "Refusée par le laboratoire"],
  ["annulee", "Annulée"],
];
// étape proposée par défaut : la suivante dans le parcours normal
const PARCOURS = ["recue", "transmise", "acceptee", "recue_elixir", "expediee"];
const etapeSuivante = (e) => { const i = PARCOURS.indexOf(e); return i < 0 ? "acceptee" : PARCOURS[Math.min(i + 1, PARCOURS.length - 1)]; };
// couleur du libellé de suivi (texte seulement, toujours avec le libellé) : jetons de la charte, violet fonctionnel pour « acceptée »
const COULEUR_SUIVI = { recue: T.inkSoft, transmise: T.teal, acceptee: T.violet, recue_elixir: T.warn, expediee: T.ok, refusee: T.danger, annulee: T.inkMute };

// commandes / syncStatus / onSync : liste et synchronisation PharmaML de l'onglet « Commandes » (AdminPanel)
export default function AdminLabJustif({ adminFetch, flash, syncStatus = {}, onSync }) {
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(null);
  const [demandes, setDemandes] = useState([]);
  const [busy, setBusy] = useState("");
  const [filtre, setFiltre] = useState("actives");
  const [preview, setPreview] = useState(null);
  const [testAdr, setTestAdr] = useState("");
  const [suiviEdit, setSuiviEdit] = useState(null);   // { demande, etape, commentaire, datePrevue, prevenir }

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
  // après une action : liste des demandes seulement (des réglages en cours de saisie ne sont jamais écrasés)
  const vivant = useRef(true);
  useEffect(() => () => { vivant.current = false; }, []);
  const chargerDemandes = useCallback(async () => {
    try { const l = await call({ action: "list" }); if (vivant.current) setDemandes(l.demandes || []); }
    catch (e) { if (vivant.current) flash?.(`⚠ ${e.message}`); }
  }, [call, flash]);
  const plusTard = (ms) => setTimeout(() => { if (vivant.current) chargerDemandes(); }, ms);

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
  // réponse d'une action (demande brute) : le suivi et l'état de la commande calculés par la liste sont conservés
  const majDemande = (d) => setDemandes(ds => ds.map(x => x.id === d.id ? { ...x, ...d } : x));

  if (!cfg) return <div style={{ padding: 30, color: T.inkMute }}>Chargement…</div>;
  const visibles = demandes.filter(d => filtre === "toutes" ? true : filtre === "envoye" ? d.statut === "envoye" : !["envoye", "ignoree"].includes(d.statut));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ex-on-dark" style={{ ...card, background: T.petrol, color: T.paper, border: "none" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>📑 Commandes sur justificatif labo</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, lineHeight: 1.5 }}>
          Pour les produits ci-dessous, chaque commande de pharmacie (site, et logiciel de la pharmacie via PharmaML si « repérage » est coché)
          crée un bon d'achat Odoo chez le fournisseur du labo, puis envoie au labo le bon et le justificatif (pharmacie, CIP, référence et date
          de la commande, ordonnance anonymisée si jointe). Les commandes du site restent ensuite à synchroniser vers PharmaML à réception.
        </div>
      </div>

      {Object.values(cfg.labs).map(lab => (
        <div key={lab.key} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.petrol }}>{lab.nom}</div>
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "3px 9px", background: lab.actif ? T.okBg : T.surface2, color: lab.actif ? T.ok : T.inkSoft }}>
              {lab.actif ? `● Envoi automatique actif depuis le ${dt(lab.depuis)}` : "○ Envoi automatique arrêté"}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => basculer(lab.key)} disabled={!!busy || dirty} title={dirty ? "Enregistrez d'abord les réglages" : ""}
              style={{ ...btn(lab.actif ? T.danger : T.ok), opacity: busy || dirty ? 0.5 : 1 }}>{lab.actif ? "Arrêter l'envoi automatique" : "Activer l'envoi automatique"}</button>
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
              <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{"{bon} {produit} {pharmacie} {cip} {ville} {reference} {date}"}</div></div>
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
              <thead><tr style={{ color: T.inkMute, textAlign: "left" }}>
                <th style={{ padding: 4 }}>CIP13</th><th>Produit</th><th>Nom dans l'objet</th><th>Max / commande</th><th>Max / jour</th><th>Repérage PharmaML</th><th />
              </tr></thead>
              <tbody>{lab.produits.map((p, i) => (
                <tr key={p.cip} style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <td style={{ padding: 4, fontFamily: "monospace" }}>{p.cip}{!p.odooId && <span style={{ color: T.danger }}> ⚠ sans fiche</span>}</td>
                  <td>{p.nom}</td>
                  <td><input style={{ ...inp, padding: "3px 6px" }} value={p.court} onChange={e => majProd(lab.key, i, { court: e.target.value })} /></td>
                  <td><input style={{ ...inp, width: 60, padding: "3px 6px" }} value={p.maxCommande || ""} onChange={e => majProd(lab.key, i, { maxCommande: e.target.value.replace(/\D/g, "") })} /></td>
                  <td><input style={{ ...inp, width: 60, padding: "3px 6px" }} value={p.maxJour || ""} onChange={e => majProd(lab.key, i, { maxJour: e.target.value.replace(/\D/g, "") })} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={p.detection !== false} onChange={e => majProd(lab.key, i, { detection: e.target.checked })} /></td>
                  <td><button onClick={() => window.confirm(`Retirer ${p.nom} ?`) && setCfg(c => ({ ...c, labs: { ...c.labs, [lab.key]: { ...c.labs[lab.key], produits: c.labs[lab.key].produits.filter((_, j) => j !== i) } } }))}
                    style={{ background: "none", border: "none", color: T.inkMute, cursor: "pointer" }}>✕</button></td>
                </tr>))}</tbody>
            </table>
            <button onClick={() => ajouterProduit(lab.key)} disabled={!!busy} style={{ ...btn(T.surface2, T.petrol), marginTop: 6 }}>＋ Ajouter un produit (CIP)</button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
            <input placeholder="adresse interne pour le mail de test" value={testAdr} onChange={e => setTestAdr(e.target.value)} style={{ ...inp, width: 260 }} />
            <button disabled={!!busy || dirty} onClick={() => act("test", { action: "test_mail", lab: lab.key, adresse: testAdr }, (j) => flash?.(`✓ Mail de test envoyé à ${j.a}`))}
              style={{ ...btn(T.inkSoft), opacity: busy || dirty ? 0.5 : 1 }}>✉️ Mail de test</button>
            <span style={{ fontSize: 11, color: T.inkMute }}>Exemple fictif, sans bon de commande, jamais envoyé au laboratoire.</span>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={enregistrer} disabled={!dirty || !!busy} style={{ ...btn(T.petrol), opacity: !dirty || busy ? 0.5 : 1 }}>{busy === "save" ? "Enregistrement…" : "💾 Enregistrer les réglages"}</button>
        {dirty && <span style={{ fontSize: 12, color: T.warn, fontWeight: 700 }}>Réglages modifiés non enregistrés</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => act("portail", { action: "test_portail" }, (j) => flash?.(`✓ Portail PharmaML joignable (${j.commandesDuJour} commande(s) aujourd'hui)`))} disabled={!!busy} style={btn(T.surface2, T.petrol)}>🔌 Tester le portail PharmaML</button>
        <button onClick={() => act("run", { action: "run" }, (j) => { flash?.((j.journal || []).join(" · ")); plusTard(20000); })} disabled={!!busy} style={btn(T.surface2, T.petrol)}>{busy === "run" ? "Lancement…" : "🔄 Contrôler maintenant"}</button>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.petrol }}>Demandes</div>
          {[["actives", "À traiter / en cours"], ["envoye", "Envoyées"], ["toutes", "Toutes"]].map(([k, t]) => (
            <button key={k} onClick={() => setFiltre(k)} style={{ ...btn(filtre === k ? T.petrol : T.surface2, filtre === k ? T.paper : T.petrol), padding: "4px 10px" }}>{t}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={chargerDemandes} style={{ ...btn(T.surface2, T.petrol), padding: "4px 10px" }}>↻ Actualiser</button>
        </div>
        {!visibles.length ? <div style={{ color: T.inkMute, fontSize: 13, padding: 10 }}>Aucune demande.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: T.inkMute, textAlign: "left" }}>
                <th style={{ padding: 5 }}>Commande</th><th>Pharmacie</th><th>Produits</th><th>Labo</th><th>Statut</th><th>Bon</th><th>Suivi pharmacie</th><th>Actions</th>
              </tr></thead>
              <tbody>{visibles.map(d => {
                const [t, bg, fg] = STATUTS[d.statut] || st(d.statut, "neutral");
                return (
                  <tr key={d.id} style={{ borderTop: "1px solid var(--line-soft)", verticalAlign: "top" }}>
                    <td style={{ padding: 5 }}>{dt(d.dateCommande)}<div style={{ fontSize: 11, color: T.inkMute }}>{d.source === "site" ? "🌐 site" : "📡 PharmaML"} · {d.reference}</div></td>
                    <td>{d.pharmacie?.nom}<div style={{ fontSize: 11, color: T.inkMute }}>CIP {d.pharmacie?.cip || "?"}{d.saisiPar ? " · saisie Elixir" : ""}</div></td>
                    <td>{d.lignes.map((l, i) => <div key={i}>{l.qte} × {l.produit}</div>)}
                      <div style={{ fontSize: 11, color: T.violet }}>{[d.attestation && "attestation", d.renouvellement && "renouvellement"].filter(Boolean).join(" · ")}</div>
                      {(d.rx || []).map(x => <button key={x.id} onClick={() => voirOrdonnance(x.id)} style={{ background: "none", border: "none", color: T.teal, cursor: "pointer", fontSize: 11, padding: 0, display: "block" }}>📎 {x.name}</button>)}
                    </td>
                    <td>{cfg.labs[d.lab]?.nom || d.lab}</td>
                    <td><span style={{ background: bg, color: fg, borderRadius: 8, padding: "2px 7px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{t}</span>
                      {d.envoyeLe && <div style={{ fontSize: 11, color: T.inkMute }}>{dt(d.envoyeLe)}</div>}
                      {(d.motif || d.erreur) && <div style={{ fontSize: 11, color: T.acting, maxWidth: 260 }}>{d.erreur || d.motif}</div>}
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{d.poNom || ""}</td>
                    <td style={{ minWidth: 170 }}>
                      {d.suivi && <div style={{ fontSize: 11, fontWeight: 700, color: COULEUR_SUIVI[d.suivi.etape] || T.inkSoft }}>{d.suivi.libelle}{d.suivi.date ? <span style={{ fontWeight: 500, color: T.inkMute }}> · {dt(d.suivi.date)}</span> : null}</div>}
                      {d.suivi?.datePrevue && <div style={{ fontSize: 11, color: T.violet }}>livraison prévue le {new Date(d.suivi.datePrevue).toLocaleDateString("fr-FR")}</div>}
                      {d.suivi?.commentaire && <div style={{ fontSize: 11, color: T.inkSoft, maxWidth: 220 }}>« {d.suivi.commentaire} »</div>}
                      {d.commande && <div style={{ fontSize: 11, color: d.commande.processed ? T.ok : d.commande.commandeTraitee ? T.inkMute : T.warn }}>{d.commande.processed ? `✓ envoyée à PharmaML${d.commande.syncedAt ? ` le ${dt(d.commande.syncedAt)}` : ""}` : d.commande.commandeTraitee ? "commande close sans envoi PharmaML" : "pas encore synchronisée"}</div>}
                      {d.commande && syncStatus[d.orderId] && syncStatus[d.orderId] !== "ok" && <div style={{ fontSize: 11, color: syncStatus[d.orderId] === "pending" ? T.teal : T.danger }}>{syncStatus[d.orderId] === "pending" ? "synchronisation en cours…" : syncStatus[d.orderId]}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {d.source === "site" && <><button disabled={!!busy} onClick={() => setSuiviEdit({ demande: d, etape: etapeSuivante(d.suivi?.etape), commentaire: "", datePrevue: d.suivi?.datePrevue || "", prevenir: !!d.email })}
                        style={{ ...btn("#6d28d9", "#fff"), padding: "3px 8px" }}>Suivi…</button>{" "}</>}
                      {d.commande && !d.commande.processed && !d.commande.commandeTraitee && d.commande.lignes > 0 && onSync && <><button disabled={!!busy || syncStatus[d.orderId] === "pending"}
                        onClick={() => { if (window.confirm(`Synchroniser vers PharmaML, commande n° ${d.orderId} (${d.pharmacie?.nom}) :\n${d.lignes.map(l => `  ${l.qte} × ${l.produit}`).join("\n")}\n\nSeules ces lignes (${cfg.labs[d.lab]?.nom || d.lab}) partent. À faire quand la marchandise est reçue chez Elixir : elle part en préparation et la pharmacie la voit « expédiée ».`)) { onSync(d.orderId, d.lignes.map(l => String(l.cip))); plusTard(8000); } }}
                        style={{ ...btn(T.petrol), padding: "3px 8px" }}>🔄 Synchroniser</button>{" "}</>}
                      <button onClick={() => act("preview", { action: "preview", id: d.id }, setPreview)} style={{ ...btn(T.surface2, T.petrol), padding: "3px 8px" }}>Mail</button>{" "}
                      {d.statut !== "envoye" && d.statut !== "en_cours" && (<>
                        <button disabled={!!busy} onClick={() => {
                          const forcer = d.statut === "a_verifier" || d.statut === "bloquee";
                          if (!window.confirm(`${forcer && d.motif ? `Alerte : ${d.motif}\n\nEnvoyer quand même ? ` : ""}Créer et confirmer le bon chez ${cfg.labs[d.lab]?.fournisseurNom || "le fournisseur"}${/CSP|EDI/i.test(cfg.labs[d.lab]?.fournisseurNom || "") ? " (commande EDI immédiate)" : ""} et envoyer le justificatif à ${cfg.labs[d.lab]?.a} ?`)) return;
                          act("send", { action: "send", id: d.id, forcer }, (j) => {
                            majDemande(j.demande);
                            flash?.(j.lance ? "Envoi lancé : bon, PDF et mail sont faits en arrière-plan" : "Envoi programmé au prochain passage (10 min)");
                            plusTard(12000);
                          });
                        }} style={{ ...btn(T.ok), padding: "3px 8px" }}>Envoyer</button>{" "}
                        {d.statut !== "ignoree" && <button disabled={!!busy} onClick={() => { const m = window.prompt("Motif (facultatif) :", ""); if (m === null) return; act("ignore", { action: "ignore", id: d.id, motif: m || undefined }, (j) => majDemande(j.demande)); }}
                          style={{ ...btn(T.surface2, T.inkSoft), padding: "3px 8px" }}>Ignorer</button>}
                      </>)}
                    </td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      {suiviEdit && (
        <div onClick={() => setSuiviEdit(null)} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, maxWidth: 520, width: "100%", padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.petrol }}>Suivi de la demande — {suiviEdit.demande.pharmacie?.nom}</div>
            <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>Commande n° {suiviEdit.demande.orderId} · {suiviEdit.demande.lignes.map(l => `${l.qte} × ${l.produit}`).join(", ")}</div>
            {(suiviEdit.demande.suiviBrut || []).length > 0 && (
              <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 8, background: T.paper, borderRadius: 8, padding: "6px 8px" }}>
                {suiviEdit.demande.suiviBrut.map((e, i) => <div key={i}>{dt(e.at)} — {ETAPES_SUIVI.find(x => x[0] === e.etape)?.[1] || e.etape}{e.datePrevue ? ` (prévue le ${new Date(e.datePrevue).toLocaleDateString("fr-FR")})` : ""}{e.commentaire ? ` : « ${e.commentaire} »` : ""} <span style={{ color: T.inkMute }}>({e.par})</span></div>)}
              </div>
            )}
            <label style={{ ...lbl, marginTop: 12 }}>Étape</label>
            <select style={inp} value={suiviEdit.etape} onChange={e => setSuiviEdit(s => ({ ...s, etape: e.target.value }))}>
              {ETAPES_SUIVI.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            {suiviEdit.etape === "acceptee" && (<>
              <label style={{ ...lbl, marginTop: 10 }}>Livraison prévue le (facultatif)</label>
              <input type="date" style={inp} value={suiviEdit.datePrevue} onChange={e => setSuiviEdit(s => ({ ...s, datePrevue: e.target.value }))} />
            </>)}
            {suiviEdit.etape === "expediee" && suiviEdit.demande.commande && !suiviEdit.demande.commande.processed && (
              <div style={{ fontSize: 11, color: T.warn, marginTop: 8 }}>La commande n'est pas encore synchronisée vers PharmaML : « 🔄 Synchroniser » la fait partir en préparation (l'étape « expédiée » s'affiche alors toute seule).</div>
            )}
            <label style={{ ...lbl, marginTop: 10 }}>Message pour la pharmacie (facultatif, visible sur son site ; remplace le message affiché, vide = aucun message)</label>
            <textarea style={{ ...inp, minHeight: 64 }} maxLength={600} value={suiviEdit.commentaire} onChange={e => setSuiviEdit(s => ({ ...s, commentaire: e.target.value }))}
              placeholder={suiviEdit.etape === "refusee" ? "Ex. : le laboratoire ne livre plus ce produit en ville ; nous vous proposons…" : "Ex. : livraison avec votre tournée de jeudi"} />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 10 }}>
              <input type="checkbox" checked={suiviEdit.prevenir} disabled={!suiviEdit.demande.email} onChange={e => setSuiviEdit(s => ({ ...s, prevenir: e.target.checked }))} />
              Prévenir la pharmacie par e-mail {suiviEdit.demande.email ? `(${suiviEdit.demande.email})` : "(pas d'adresse connue)"}
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={() => setSuiviEdit(null)} style={btn(T.surface2, T.inkSoft)}>Annuler</button>
              <button disabled={!!busy} onClick={() => act("suivi", { action: "suivi", id: suiviEdit.demande.id, etape: suiviEdit.etape, commentaire: suiviEdit.commentaire,
                datePrevue: suiviEdit.etape === "acceptee" && suiviEdit.datePrevue ? suiviEdit.datePrevue : null, prevenir: suiviEdit.prevenir }, (j) => {
                  setSuiviEdit(null); chargerDemandes();
                  flash?.(j.mail?.a ? `✓ Suivi mis à jour, e-mail envoyé à ${j.mail.a}` : j.mail?.erreur ? `Suivi mis à jour — ⚠ e-mail non envoyé : ${j.mail.erreur}` : "✓ Suivi mis à jour");
                })} style={{ ...btn("#6d28d9", "#fff"), opacity: busy ? 0.5 : 1 }}>{busy === "suivi" ? "Enregistrement…" : "Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, maxWidth: 760, width: "100%", maxHeight: "86vh", overflow: "auto", padding: 18 }}>
            <div style={{ fontSize: 12, color: T.inkSoft }}>À : {preview.a}{preview.cc ? ` · Cc : ${preview.cc}` : ""}</div>
            <div style={{ fontWeight: 700, margin: "4px 0 10px" }}>{preview.sujet}</div>
            <iframe title="Aperçu du mail" sandbox="" srcDoc={preview.corps} style={{ width: "100%", height: 460, border: "1px solid var(--line)", borderRadius: 8 }} />
            <div style={{ textAlign: "right", marginTop: 8 }}><button onClick={() => setPreview(null)} style={btn(T.petrol)}>Fermer</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
