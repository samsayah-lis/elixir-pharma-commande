import React, { useEffect, useState, useCallback, useRef } from "react";

// ── Admin : commandes Sanofi Pro (Dupixent) ─────────────────────────────
// Réglages du traitement automatique sur le portail grossiste Sanofi Pro et suivi des commandes
// (traitées, en attente, à traiter à la main), avec « ignorer » / « reprendre ».
const API = "/.netlify/functions/sanofipro";
const ETATS = {
  nouvelle: ["À réexaminer", "#e0f2fe", "#075985"],
  en_attente: ["En attente", "#fef3c7", "#92400e"],
  a_traiter_main: ["À traiter à la main", "#ffedd5", "#9a3412"],
  en_cours: ["Envoi en cours", "#e0f2fe", "#075985"],
  a_repondre: ["PharmaML ✓ · « Traiter » à faire", "#ffedd5", "#9a3412"],
  doublon_pml: ["DOUBLON PharmaML probable", "#fee2e2", "#991b1b"],
  annulee_sanofi: ["Annulée sur Sanofi · dans PharmaML", "#fee2e2", "#991b1b"],
  traitee: ["Traitée · attente Odoo", "#e0f2fe", "#075985"],
  dans_odoo: ["Traitée · dans Odoo", "#d1fae5", "#065f46"],
  absente_odoo: ["Absente d'Odoo", "#fee2e2", "#991b1b"],
  incertaine: ["Issue inconnue", "#fee2e2", "#991b1b"],
  erreur: ["Refusée par PharmaML", "#fee2e2", "#991b1b"],
  portail: ["Faite sur le portail", "#f1f5f9", "#475569"],
  ignoree: ["Ignorée", "#f1f5f9", "#475569"],
};
const A_SUIVRE = new Set(["nouvelle", "en_attente", "a_traiter_main", "en_cours", "a_repondre", "doublon_pml", "annulee_sanofi", "traitee", "absente_odoo", "incertaine", "erreur"]);
const IGNORABLES = new Set(["en_attente", "nouvelle", "a_traiter_main", "erreur", "incertaine", "absente_odoo", "a_repondre", "doublon_pml", "annulee_sanofi"]);
const REPRENABLES = new Set(["en_attente", "a_traiter_main", "ignoree", "erreur", "incertaine"]);
// décision simulée (mode simulation) pour une commande en attente sur le portail
const DECISIONS = {
  serait_traitee: ["Serait traitée", "#d1fae5", "#065f46"],
  en_attente: ["Resterait en attente", "#fef3c7", "#92400e"],
  a_traiter_main: ["À traiter à la main", "#ffedd5", "#9a3412"],
};
const MODES = [["arret", "Arrêt"], ["simulation", "Simulation (rien n'est fait)"], ["auto_pml", "Automatique : PharmaML puis « Traiter »"]];
const card = { background: "white", borderRadius: 14, padding: "16px 20px", border: "1px solid #e8ecf0" };
const lbl = { fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 3 };
const inp = { width: "100%", boxSizing: "border-box", border: "1.5px solid #d6dde3", borderRadius: 8, padding: "7px 9px", fontSize: 13, fontFamily: "inherit" };
const btn = (bg, color = "white") => ({ background: bg, color, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" });
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const CHAMPS = ["mode", "ageMaxHeures", "maxQteLigne", "plafondJour", "delaiOdooMin", "alertes"];
const reglages = (c) => Object.fromEntries(CHAMPS.map(k => [k, c?.[k]]));
// comparaison des réglages : « 48 » saisi = 48 enregistré
const NUMS = ["ageMaxHeures", "maxQteLigne", "plafondJour", "delaiOdooMin"];
const empreinte = (c) => JSON.stringify(Object.fromEntries(CHAMPS.map(k => [k, NUMS.includes(k) && c?.[k] !== "" && c?.[k] != null ? Number(c[k]) : c?.[k]])));
// un envoi a pu avoir lieu (issue inconnue, refus, traitée sur le portail, document en double) : même règle que le serveur
const douteuse = (c) => ["incertaine", "erreur"].includes(c.etat) || !!c.issueInconnue || !!c.envoiPortail || !!c.plusieursDocs || !!c.pml?.envoyeA
  || (c.historique || []).some(h => ["incertaine", "erreur", "portail"].includes(h.etat));

export default function AdminSanofiPro({ adminFetch, flash }) {
  const [etat, setEtat] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState("");
  const [filtre, setFiltre] = useState("suivre");
  const [journalOuvert, setJournalOuvert] = useState(false);
  const flashRef = useRef(flash); flashRef.current = flash;
  const dirtyRef = useRef(false);

  const call = useCallback(async (body) => {
    const r = await adminFetch(API, { method: "POST", body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }, [adminFetch]);
  // recharge l'état ; les réglages en cours de saisie ne sont jamais écrasés
  const charger = useCallback(async () => {
    try {
      const j = await call({ action: "etat" });
      setEtat(j);
      if (!dirtyRef.current) { const c = reglages(j.config); setCfg(c); setSaved(empreinte(c)); }
    } catch (e) { flashRef.current?.(`⚠ ${e.message}`); }
  }, [call]);
  useEffect(() => { charger(); }, [charger]);

  const act = async (label, body, ok) => {
    setBusy(label);
    try { const j = await call(body); if (ok) ok(j); return j; }
    catch (e) { flashRef.current?.(`⚠ ${e.message}`); return null; }
    finally { setBusy(""); }
  };
  if (!etat || !cfg) return <div style={{ padding: 30, color: "#888" }}>Chargement…</div>;

  const dirty = empreinte(cfg) !== saved;
  dirtyRef.current = dirty;
  const maj = (patch) => setCfg(c => ({ ...c, ...patch }));
  const enregistrer = () => {
    const vers = cfg.mode, avant = JSON.parse(saved).mode;
    if (vers === "auto_pml" && avant !== "auto_pml" && !window.confirm("Passer en traitement AUTOMATIQUE ?\n\nChaque nouvelle commande Sanofi Pro dont la pharmacie est cliente Elixir et dont le stock libre Odoo couvre la quantité sera :\n1. créée dans PharmaML (référence SP + référence Sanofi), puis retrouvée sur le portail PharmaML ;\n2. « traitée » sur le portail Sanofi Pro (réponse à Sanofi : expédiée en totalité).\n\nPrévenez l'équipe : ne plus saisir ni traiter à la main les nouvelles commandes (risque de doublon PharmaML).")) return;
    act("save", { action: "config_save", config: { ...cfg, ageMaxHeures: Number(cfg.ageMaxHeures), maxQteLigne: Number(cfg.maxQteLigne), plafondJour: Number(cfg.plafondJour), delaiOdooMin: Number(cfg.delaiOdooMin) } },
      (j) => { const c = reglages(j.config); dirtyRef.current = false; setCfg(c); setSaved(empreinte(c)); flash?.("✓ Réglages enregistrés"); });
  };
  const majCommande = (c) => setEtat(e => ({ ...e, commandes: e.commandes.map(x => x.ref === c.ref ? { ...x, ...c } : x) }));
  const ignorer = (c) => window.confirm(`Ne plus traiter ni signaler automatiquement la commande ${c.ref} (${c.pharmacien}) ?`) &&
    act("ign", { action: "ignorer", ref: c.ref }, (j) => majCommande(j.commande));
  const reprendre = (c) => {
    const risque = douteuse(c);
    const msg = risque
      ? `ATTENTION — un envoi a pu avoir lieu pour ${c.ref} (issue inconnue, refus, traitée sur le portail ou document en double).\n\nAvant de reprendre, vérifiez sur le portail Sanofi Pro que la commande n'a AUCUN envoi, et sur le portail PharmaML qu'aucune commande de ${c.pharmacien} n'est arrivée à ce moment-là. Sinon : doublon.\n\nJ'ai vérifié : reprendre le traitement automatique ?`
      : `Réexaminer la commande ${c.ref} (${c.pharmacien}) au prochain passage ?\n\nSi la pharmacie est cliente Elixir et le stock suffisant, elle sera traitée automatiquement sur le portail (réponse à Sanofi + envoi PharmaML), même si elle est ancienne.`;
    if (!window.confirm(msg)) return;
    act("rep", { action: "reprendre", ref: c.ref, confirme: risque }, (j) => { majCommande(j.commande); flash?.("Reprise : traitée au prochain passage (10 min au plus) ou avec « Vérifier maintenant »"); });
  };

  const d = etat.dernier;
  const cmds = (etat.commandes || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const visibles = cmds.filter(c => filtre === "toutes" ? true : A_SUIVRE.has(c.etat));
  const modeLib = { arret: ["○ Arrêté", "#f1f5f9", "#475569"], simulation: ["◐ Simulation", "#fef3c7", "#92400e"], auto_pml: ["● Automatique (PharmaML + Sanofi)", "#d1fae5", "#065f46"] }[JSON.parse(saved).mode] || ["?", "#f1f5f9", "#475569"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "linear-gradient(135deg,#0f2d3d,#1a4a5e)", color: "white" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>💉 Commandes Sanofi Pro (Dupixent)</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, lineHeight: 1.5 }}>
          Les pharmacies commandent sur Sanofi Pro ; les commandes arrivent sur le <a href={`${etat.portail}/new-orders`} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc" }}>portail grossiste</a>.
          « Traiter » sur ce portail <b>répond seulement à Sanofi : il ne crée PAS de commande PharmaML</b>. Une commande se traite donc en deux temps :
          (1) saisie dans PharmaML, (2) « Traiter » sur le portail. En mode automatique, l'automate crée la commande PharmaML (réf. SP + réf. Sanofi),
          la retrouve sur le portail PharmaML, puis clique « Traiter » — si la pharmacie est cliente Elixir et que le stock libre Odoo couvre la quantité ;
          sinon la commande reste sur le portail et un e-mail prévient. Une commande ne doit jamais être saisie deux fois dans PharmaML.
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f2d3d" }}>Traitement automatique</div>
          <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 10, padding: "3px 9px", background: modeLib[1], color: modeLib[2] }}>{modeLib[0]}</span>
          {!etat.identifiants && <span style={{ fontSize: 11, fontWeight: 800, color: "#991b1b" }}>⚠ Identifiants du portail absents (SANOFIPRO_EMAIL / SANOFIPRO_PASSWORD sur Netlify)</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <div><label style={lbl}>Mode</label>
            <select style={inp} value={cfg.mode} onChange={e => maj({ mode: e.target.value })}>{MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div><label style={lbl}>Âge maximum d'une commande (heures)</label><input type="number" min="1" max="168" style={inp} value={cfg.ageMaxHeures} onChange={e => maj({ ageMaxHeures: e.target.value })} /></div>
          <div><label style={lbl}>Quantité maximum par ligne</label><input type="number" min="1" max="50" style={inp} value={cfg.maxQteLigne} onChange={e => maj({ maxQteLigne: e.target.value })} /></div>
          <div><label style={lbl}>Plafond de traitements par jour</label><input type="number" min="1" max="200" style={inp} value={cfg.plafondJour} onChange={e => maj({ plafondJour: e.target.value })} /></div>
          <div><label style={lbl}>Alerte si absente d'Odoo après (minutes)</label><input type="number" min="10" max="600" style={inp} value={cfg.delaiOdooMin} onChange={e => maj({ delaiOdooMin: e.target.value })} /></div>
          <div><label style={lbl}>E-mails d'alerte (séparés par des virgules)</label><input style={inp} value={cfg.alertes} onChange={e => maj({ alertes: e.target.value })} /></div>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
          Au-delà de l'âge maximum, une commande n'est plus traitée automatiquement (stock du moment non pertinent) : elle passe « à traiter à la main ».
          Une quantité au-dessus du maximum, une pharmacie sans fiche client Elixir (ou bloquée), un produit inconnu ou un stock libre insuffisant laissent la commande en attente.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={enregistrer} disabled={!dirty || !!busy} style={{ ...btn("#0f2d3d"), opacity: !dirty || busy ? 0.5 : 1 }}>{busy === "save" ? "Enregistrement…" : "💾 Enregistrer"}</button>
          {dirty && <span style={{ fontSize: 12, color: "#b45309", fontWeight: 700 }}>Réglages modifiés non enregistrés</span>}
          <div style={{ flex: 1 }} />
          <button disabled={!!busy} title="Envoie à PharmaML une liste VIDE (aucune commande créée) : vérifie que PharmaML accepte les envois depuis le serveur"
            onClick={() => act("tpml", { action: "test_pharmaml" }, (j) => flash?.(j.ok ? `✓ PharmaML répond au serveur (HTTP ${j.http}, JSON${j.message ? ` : ${j.message}` : ""}) — à confirmer sur une 1re vraie commande` : `⚠ PharmaML : HTTP ${j.http}${j.message ? ` — ${j.message}` : ""}`))}
            style={btn("#f1f5f9", "#0f2d3d")}>{busy === "tpml" ? "Essai…" : "🔌 Tester l'envoi PharmaML"}</button>
          <button disabled={!!busy || dirty} title={dirty ? "Enregistrez d'abord les réglages" : ""} onClick={() => act("run", { action: "run" }, (j) => { flash?.(j.lance ? "Passage lancé : résultat dans quelques secondes" : "⚠ Lancement impossible (CRON_SECRET ?)"); if (j.lance) setTimeout(charger, 15000); })}
            style={btn("#f1f5f9", "#0f2d3d")}>{busy === "run" ? "Lancement…" : "🔄 Vérifier maintenant"}</button>
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e2e8f0", fontSize: 12 }}>
          <b>Dernier passage :</b> {d ? <>
            {dt(d.at)}{d.mode ? ` · ${d.mode}` : ""}{d.occupe ? " · un passage était déjà en cours" : ""}
            {d.stats && ` · ${d.stats.vues} en attente sur le portail, ${d.stats.traitees} traitée(s)${d.stats.simulees ? `, ${d.stats.simulees} simulée(s)` : ""}${d.stats.aRepondre ? `, ${d.stats.aRepondre} « Traiter » à faire` : ""}${d.stats.incertaines ? `, ⚠ ${d.stats.incertaines} incertaine(s)` : ""}${d.stats.erreurs ? `, ⚠ ${d.stats.erreurs} refusée(s) par PharmaML` : ""}${d.stats.doublons ? `, ⚠⚠ ${d.stats.doublons} doublon(s)` : ""}`}
            {d.erreur && <div style={{ color: "#991b1b", fontWeight: 700 }}>⚠ {d.erreur}</div>}
            {(d.journal || []).length > 0 && <button onClick={() => setJournalOuvert(o => !o)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12 }}>{journalOuvert ? "masquer le détail" : "voir le détail"}</button>}
            {journalOuvert && <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, color: "#334155", whiteSpace: "pre-wrap" }}>{d.journal.join("\n")}</div>}
          </> : "aucun pour l'instant"}
        </div>
      </div>

      {d?.apercu && d.mode !== "auto_pml" && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2d3d" }}>Non traitées sur le portail ({d.apercu.length})</div>
            <span style={{ fontSize: 11, color: "#64748b" }}>Simulation du {dt(d.at)} : ce que ferait le mode automatique. Rien n'a été envoyé.</span>
            <div style={{ flex: 1 }} />
            <a href={`${etat.portail}/new-orders`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>Ouvrir le portail ↗</a>
          </div>
          {!d.apercu.length ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 10 }}>Aucune commande en attente sur le portail.</div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                  <th style={{ padding: 5 }}>Commande</th><th>Pharmacie</th><th>Produits</th><th>En automatique</th>
                </tr></thead>
                <tbody>{d.apercu.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(c => {
                  const [t, bg, fg] = DECISIONS[c.decision] || [c.decision, "#f1f5f9", "#475569"];
                  return (
                    <tr key={c.ref} style={{ borderTop: "1px solid #f1f5f9", verticalAlign: "top" }}>
                      <td style={{ padding: 5 }}>{dt(c.date)}<div style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>{c.ref}{c.par === "SANOFI_EMPLOYEE" ? " · saisie Sanofi" : ""}</div></td>
                      <td>{c.pharmacien}<div style={{ fontSize: 10, color: "#64748b" }}>CIP {c.cip}{c.pharmacieOdoo && c.pharmacieOdoo.toUpperCase() !== String(c.pharmacien).toUpperCase() ? ` · Odoo : ${c.pharmacieOdoo}` : ""}</div></td>
                      <td>{(c.lignes || []).map((l, i) => <div key={i}>{l.qte} × {l.nom}{l.prix ? <span style={{ color: "#64748b" }}> · {Number(l.prix).toFixed(2)} € net</span> : null}</div>)}</td>
                      <td><span style={{ background: bg, color: fg, borderRadius: 8, padding: "2px 7px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{t}</span>
                        {c.decision === "serait_traitee" && <div style={{ fontSize: 10, color: "#065f46" }}>PharmaML SP{c.ref} puis « Traiter »</div>}
                        {c.motif && <div style={{ fontSize: 10, color: "#9a3412", maxWidth: 320 }}>{c.motif}</div>}</td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2d3d" }}>Commandes</div>
          {[["suivre", "À suivre"], ["toutes", "Toutes"]].map(([k, t]) => (
            <button key={k} onClick={() => setFiltre(k)} style={{ ...btn(filtre === k ? "#0f2d3d" : "#f1f5f9", filtre === k ? "white" : "#0f2d3d"), padding: "4px 10px" }}>{t}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={charger} style={{ ...btn("#f1f5f9", "#0f2d3d"), padding: "4px 10px" }}>↻ Actualiser</button>
        </div>
        {!visibles.length ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 10 }}>{cmds.length ? "Rien à suivre." : "Aucune commande suivie : le suivi commence en mode automatique (en simulation, voir « Non traitées sur le portail » ci-dessus)."}</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                <th style={{ padding: 5 }}>Commande</th><th>Pharmacie</th><th>Produits</th><th>État</th><th>Actions</th>
              </tr></thead>
              <tbody>{visibles.map(c => {
                const [t, bg, fg] = ETATS[c.etat] || [c.etat, "#f1f5f9", "#475569"];
                const der = (c.historique || []).slice(-1)[0];
                return (
                  <tr key={c.ref} style={{ borderTop: "1px solid #f1f5f9", verticalAlign: "top" }}>
                    <td style={{ padding: 5 }}>{dt(c.date)}<div style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>{c.ref}{c.par === "SANOFI_EMPLOYEE" ? " · saisie Sanofi" : ""}</div></td>
                    <td>{c.pharmacien}<div style={{ fontSize: 10, color: "#64748b" }}>CIP {c.cip}{c.pharmacie?.nom && c.pharmacie.nom.toUpperCase() !== String(c.pharmacien).toUpperCase() ? ` · Odoo : ${c.pharmacie.nom}` : ""}</div></td>
                    <td>{(c.lignes || []).map((l, i) => <div key={i}>{l.qte} × {l.nom}</div>)}</td>
                    <td><span style={{ background: bg, color: fg, borderRadius: 8, padding: "2px 7px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{t}</span>
                      {c.pml?.ref && <div style={{ fontSize: 10, color: "#64748b" }}>PharmaML {c.pml.ref}{c.pml.vu ? ` ✓ ${dt(c.pml.vu)}` : c.pml.envoyeA ? ` envoyée ${dt(c.pml.envoyeA)}` : ""}</div>}
                      {c.traiteeA && <div style={{ fontSize: 10, color: "#64748b" }}>dans PharmaML depuis le {dt(c.traiteeA)}</div>}
                      {(c.doublon || c.deja || []).length > 0 && <div style={{ fontSize: 10, color: "#991b1b" }}>autre(s) commande(s) PharmaML : {(c.doublon || c.deja).map(x => `${x.ref} (${x.date})`).join(", ")}</div>}
                      {(c.odoo || []).length > 0 && <div style={{ fontSize: 10, color: "#065f46", fontFamily: "monospace" }}>{c.odoo.join(", ")}</div>}
                      {c.motif && !["dans_odoo", "traitee"].includes(c.etat) && <div style={{ fontSize: 10, color: "#9a3412", maxWidth: 320 }}>{c.motif}</div>}
                      {c.issueInconnue && c.etat !== "incertaine" && <div style={{ fontSize: 10, color: "#991b1b" }}>⚠ envoi tenté le {dt(c.issueInconnue)} (issue inconnue)</div>}
                      {c.envoiPortail && c.etat !== "portail" && <div style={{ fontSize: 10, color: "#991b1b" }}>⚠ déjà traitée sur le portail le {dt(c.envoiPortail)}{c.statutPortail ? ` (statut ${c.statutPortail})` : ""}</div>}
                      {c.plusieursDocs && <div style={{ fontSize: 10, color: "#991b1b" }}>⚠ référence vue avec plusieurs documents sur le portail</div>}
                      {c.alerteDue && <div style={{ fontSize: 10, color: "#b45309" }}>e-mail d'alerte en attente d'envoi</div>}
                      {der && <div title={(c.historique || []).map(h => `${dt(h.at)} ${h.etat}${h.motif ? ` — ${h.motif}` : ""}`).join("\n")} style={{ fontSize: 10, color: "#94a3b8", cursor: "help" }}>historique ({(c.historique || []).length})</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {REPRENABLES.has(c.etat) && !c.traiteeA && <button disabled={!!busy} onClick={() => reprendre(c)} style={{ ...btn(douteuse(c) ? "#b91c1c" : "#059669"), padding: "3px 8px" }}>Traiter automatiquement</button>}{" "}
                      {IGNORABLES.has(c.etat) && <button disabled={!!busy} onClick={() => ignorer(c)} style={{ ...btn("#f1f5f9", "#475569"), padding: "3px 8px" }}>{c.etat === "absente_odoo" ? "Vérifiée" : "Ignorer"}</button>}
                    </td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
