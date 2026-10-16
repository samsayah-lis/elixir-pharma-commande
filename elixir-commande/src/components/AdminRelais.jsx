import React, { useCallback, useEffect, useState } from "react";
import { T, tone } from "../theme.js";

// Relais PharmaML (agent du Mac du bureau) : état de l'agent, envoi automatique des commandes du site,
// pause générale (refus 403), envois à vérifier. Logique : netlify/functions/_relais.js
const API = "/.netlify/functions/pml-relais";
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
// état → [libellé, texte, fond], aux tons de la charte (lot 10 : tone(), src/theme.js)
const et = (lib, ton) => [lib, tone(ton).fg, tone(ton).bg];
const ETATS = {
  a_envoyer: et("📡 en file", "labo"), prise: et("📤 envoi en cours", "labo"), envoyee: et("✓ envoyée", "ok"),
  refusee: et("✕ refusée", "danger"), incertaine: et("⚠ à vérifier", "acting"), expiree: et("non prise (agent absent)", "neutral"),
  annulee: et("annulée", "neutral"), non_envoyee: et("vérifiée non envoyée", "neutral"),
};
const Badge = ({ etat }) => { const [t, c, bg] = ETATS[etat] || et(etat, "neutral"); return <span style={{ background: bg, color: c, fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>{t}</span>; };

async function appel(adminFetch, body) {
  const r = await adminFetch(API, { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function liberer(adminFetch, flash, ref, onChange) {
  if (!window.confirm(`Envoi ${ref} à l'issue inconnue.\n\nConfirmez-vous l'avoir cherché sur le portail PharmaML (référence ${ref}) et qu'il N'Y EST PAS ?\n\nSes lignes redeviendront « à synchroniser ».`)) return;
  try { await appel(adminFetch, { action: "liberer", ref, confirme: true }); flash?.(`✓ ${ref} : lignes rendues à la synchro manuelle`); onChange?.(); }
  catch (e) { flash?.(`⚠ ${e.message}`); }
}
async function confirmer(adminFetch, flash, ref, onChange) {
  if (!window.confirm(`Envoi ${ref} à l'issue inconnue.\n\nConfirmez-vous l'avoir TROUVÉ sur le portail PharmaML (référence ${ref}) ?\n\nSes lignes seront marquées envoyées (jamais renvoyées).`)) return;
  try { await appel(adminFetch, { action: "confirmer", ref, confirme: true }); flash?.(`✓ ${ref} : marquée envoyée`); onChange?.(); }
  catch (e) { flash?.(`⚠ ${e.message}`); }
}
const lien = { background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, textDecoration: "underline", padding: 0 };
const Verifier = ({ t, adminFetch, flash, onChange }) => (<>
  <button onClick={() => confirmer(adminFetch, flash, t.ref, onChange)} style={{ ...lien, color: T.ok }}>vérifié : arrivé dans PharmaML</button>
  <button onClick={() => liberer(adminFetch, flash, t.ref, onChange)} style={{ ...lien, color: "#9a3412" }}>vérifié : pas dans PharmaML</button>
</>);

// Envois d'une commande (sous la commande, onglet Commandes)
export function RelaisCommande({ taches, adminFetch, flash, onChange }) {
  return (
    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
      {taches.map(t => (
        <div key={t.ref} style={{ fontSize: 11, color: T.inkSoft, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Badge etat={t.etat} />
          <span style={{ fontFamily: "monospace" }}>{t.ref}</span>
          <span>{t.creePar === "auto" ? "auto" : t.creePar?.startsWith("auto-saisie") ? "auto (saisie Elixir)" : "synchro admin"} · {dt(t.renduA || t.priseA || t.creeA)}</span>
          {t.message && t.etat !== "envoyee" && <span title={t.message} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>— {t.message}</span>}
          {t.etat === "a_envoyer" && <button onClick={async () => { try { await appel(adminFetch, { action: "annuler", ref: t.ref }); flash?.(`✓ ${t.ref} annulée`); onChange?.(); } catch (e) { flash?.(`⚠ ${e.message}`); } }}
            style={{ background: "none", border: "none", color: T.teal, cursor: "pointer", fontSize: 11, fontWeight: 700, textDecoration: "underline", padding: 0 }}>annuler</button>}
          {t.etat === "incertaine" && <Verifier t={t} adminFetch={adminFetch} flash={flash} onChange={onChange} />}
        </div>
      ))}
    </div>
  );
}

export default function AdminRelais({ adminFetch, flash }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState("");
  const charger = useCallback(async () => {
    try { setSt(await appel(adminFetch, { action: "statut" })); setErr(""); } catch (e) { setErr(e.message); }
  }, [adminFetch]);
  useEffect(() => { charger(); const t = setInterval(charger, 30e3); return () => clearInterval(t); }, [charger]);
  if (!st) return err ? <div style={{ fontSize: 12, color: T.danger, marginBottom: 10 }}>⚠ Relais PharmaML : {err}</div> : null;
  const vu = st.agent?.vuA ? (Date.now() - Date.parse(st.agent.vuA)) / 60e3 : Infinity;
  const couleur = vu < 2 ? T.ok : vu < 10 ? T.warn : T.danger;
  const basculer = async () => {
    const actif = !st.config?.autoSite;
    if (!window.confirm(actif
      ? "Activer l'envoi automatique des commandes du site ?\n\nÀ partir de maintenant, les lignes EN STOCK des commandes des pharmacies (et des saisies Elixir) partent dans PharmaML dans la minute, par l'agent du Mac. Les précommandes, U-Labs et justificatifs restent à la synchro manuelle. Les commandes déjà reçues ne sont pas concernées."
      : "Arrêter l'envoi automatique ? Les nouvelles commandes resteront à synchroniser à la main.")) return;
    setBusy(true);
    try { await appel(adminFetch, { action: "config_save", autoSite: actif, alertes: st.config?.alertes }); flash?.(actif ? "✓ Envoi automatique activé" : "Envoi automatique arrêté"); await charger(); }
    catch (e) { flash?.(`⚠ ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <div style={{ background: T.surface, border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ color: T.petrol }}>📡 Relais PharmaML</b>
        <span><span style={{ color: couleur, fontWeight: 700 }}>●</span> agent du Mac {Number.isFinite(vu) ? (vu < 2 ? "connecté" : `vu il y a ${Math.round(vu)} min`) : "jamais vu"}{st.agent?.version ? ` (v${st.agent.version})` : ""}</span>
        <span>{st.enFile} en file</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: busy ? "wait" : "pointer" }}>
          <input type="checkbox" checked={!!st.config?.autoSite} disabled={busy} onChange={basculer} />
          Envoi automatique des commandes du site{st.config?.autoSite && st.config?.depuis ? ` (depuis le ${dt(st.config.depuis)})` : ""}
        </label>
        <button onClick={async () => {
            setBusy(true);
            try {
              const j = await appel(adminFetch, { action: "test" });
              setTest(`Essai ${j.ref} en file…`);
              const fin = Date.now() + 90e3;
              let t = null, pause = null;
              while (Date.now() < fin) {
                await new Promise(r => setTimeout(r, 2500));
                const e = await appel(adminFetch, { action: "etat", refs: [j.ref] }).catch(() => null);
                t = e?.taches?.[j.ref]; pause = e?.pause;
                if (t && !["a_envoyer", "prise"].includes(t.etat)) break;
              }
              setTest(t?.etat === "envoyee" ? `✓ Chaîne complète OK : l'agent a envoyé l'essai, PharmaML a répondu (HTTP ${t.http})`
                : t && !["a_envoyer", "prise"].includes(t.etat) ? `⚠ Essai ${t.etat} : ${t.message || ""}`
                : t?.etat === "prise" ? "⚠ Essai pris par l'agent, sans compte rendu en 90 s"
                : pause ? `⚠ Essai non pris en 90 s alors que les essais passent même en pause : agent arrêté ?` : "⚠ L'agent du Mac n'a pas pris l'essai en 90 s : est-il lancé ?");
              await charger();
            } catch (e) { setTest(`⚠ ${e.message}`); } finally { setBusy(false); }
          }}
          disabled={busy} title="L'agent du Mac envoie à PharmaML une liste VIDE (aucune commande créée) ; marche aussi pendant une pause, pour vérifier l'adresse du bureau" style={{ background: T.surface2, border: "none", borderRadius: 8, padding: "4px 10px", cursor: busy ? "wait" : "pointer", fontSize: 11, fontWeight: 700 }}>{busy ? "Essai (jusqu'à 90 s)…" : "🔌 Tester"}</button>
      </div>
      {test && <div style={{ marginTop: 6, fontSize: 12, color: /^✓/.test(test) ? T.ok : "#9a3412" }}>{test}</div>}
      {st.pause?.at && (
        <div style={{ marginTop: 8, background: T.dangerBg, border: "1px solid #fecaca", borderRadius: 8, padding: "6px 10px", color: T.danger }}>
          ⛔ Envois suspendus depuis le {dt(st.pause.at)} : {st.pause.motif}{" "}
          <button onClick={async () => { if (!window.confirm("Reprendre les envois vers PharmaML ? (l'adresse du bureau doit de nouveau être autorisée par InfoSoft)")) return; try { await appel(adminFetch, { action: "reprendre_envois" }); await charger(); } catch (e) { flash?.(`⚠ ${e.message}`); } }}
            style={{ marginLeft: 8, background: T.danger, color: "white", border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Reprendre les envois</button>
        </div>
      )}
      {(st.aVerifier || []).length > 0 && (
        <div style={{ marginTop: 8, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "6px 10px" }}>
          <b style={{ color: "#9a3412" }}>⚠ Envois à l'issue inconnue : à vérifier sur le portail PharmaML avant toute nouvelle saisie</b>
          {st.aVerifier.map(t => (
            <div key={t.ref} style={{ marginTop: 3 }}>
              <span style={{ fontFamily: "monospace" }}>{t.ref}</span> · {t.pharmacie || t.source} · {dt(t.renduA || t.priseA)} — {t.message}{" "}
              <span style={{ display: "inline-flex", gap: 8, marginLeft: 6 }}><Verifier t={t} adminFetch={adminFetch} flash={flash} onChange={charger} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
