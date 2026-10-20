import React, { useCallback, useEffect, useState } from "react";
import { T, R, tone, ui, fmtEur } from "../theme.js";

// Alertes « M'avertir du retour » (docs/alertes-retour.md) : produits les plus attendus, e-mails prêts à partir, avertis
// récemment, journal des passages, « Envoyer maintenant » et « Relancer » (envoi interrompu). Données : restock-notify
// (admin) — aucune adresse e-mail n'y figure, seulement le nom et le CIP des pharmacies. Logique : netlify/functions/_restock.js
const API = "/.netlify/functions/restock-notify";
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const jour = (s) => s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const ilYa = (s) => { const j = Math.floor((Date.now() - Date.parse(s)) / 86400e3); return !Number.isFinite(j) ? "" : j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`; };
// issue → [libellé, ton, explication (survol)]
const ISSUES = {
  envoye: ["✓ e-mail envoyé", "ok", "La pharmacie a reçu l'e-mail (une seule fois pour cette demande)"],
  ancienne: ["close : plus de 60 j", "neutral", "Demande de plus de 60 jours : close sans e-mail (trop ancienne)"],
  destinataire: ["close : adresse", "warn", "L'adresse de la demande n'est plus un compte de cette pharmacie : close sans e-mail (la pharmacie voit quand même « De retour en stock » dans sa Saisie)"],
  echec: ["échec : 3 refus", "danger", "Resend a refusé l'e-mail 3 fois : demande close"],
  interrompu: ["interrompu", "acting", "Fonction coupée pendant l'envoi : vérifier dans Resend, puis « Relancer » si l'e-mail n'est pas parti"],
};
const SOURCES = { planifie: "passage planifié", synchro: "après la synchro du stock", admin: "« Envoyer maintenant »" };
const Pastille = ({ ton, title, court, children }) => <span title={title} style={{ ...ui.badge(ton), whiteSpace: court ? "nowrap" : "normal" }}>{children}</span>;
const RECENTS_VISIBLES = 30;
const somme = (c) => Object.values(c || {}).reduce((s, n) => s + (Number(n) || 0), 0);
const resumePassage = (p) => [
  `${p.envoyes || 0} e-mail(s)${p.produits ? ` (${p.produits} produit${p.produits > 1 ? "s" : ""})` : ""}`,
  p.closes?.ancienne ? `${p.closes.ancienne} trop ancienne(s)` : "",
  p.closes?.destinataire ? `${p.closes.destinataire} sans destinataire` : "",
  p.closes?.echec ? `${p.closes.echec} en échec` : "",
  p.closes?.interrompu ? `${p.closes.interrompu} interrompu(s)` : "",
  p.echecs ? `${p.echecs} envoi(s) refusé(s), réessayé(s) plus tard` : "",
  p.restants ? `${p.restants} en attente${p.hors_fenetre ? " (hors 7 h – 21 h)" : ""}` : "",
].filter(Boolean).join(" · ");

export default function AdminAlertesRetour({ adminFetch, flash }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [envoi, setEnvoi] = useState("");
  const [ouvert, setOuvert] = useState(null);   // CIP du produit dont la liste des pharmacies est dépliée
  const [tousRecents, setTousRecents] = useState(false);
  const charger = useCallback(async () => {
    try {
      const r = await adminFetch(API);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setD(j); setErr("");
    } catch (e) { setErr(e.message); }
  }, [adminFetch]);
  useEffect(() => { charger(); }, [charger]);

  const t = d?.totaux || {};
  const envoyer = async () => {
    const lignes = [
      t.emails_prets ? `• jusqu'à ${t.emails_prets} e-mail(s) pour ${t.produits_prets} produit(s) revenu(s) en stock (une seule fois par demande)` : "• aucun produit attendu n'est revenu en stock pour l'instant",
      t.anciennes ? `• ${t.anciennes} demande(s) de plus de ${d.regles.age_max_jours} jours close(s) SANS e-mail (trop anciennes)` : "",
      d?.regles && !d.regles.dans_fenetre ? `• hors des heures d'envoi automatique (${d.regles.fenetre.de} h – ${d.regles.fenetre.a} h) : les e-mails partent quand même` : "",
    ].filter(Boolean).join("\n");
    if (!window.confirm(`Envoyer maintenant les alertes retour ?\n\n${lignes}`)) return;
    const total = { envoyes: 0, produits: 0, closes: 0, echecs: 0, erreurs: [] };
    setEnvoi("Envoi en cours…");
    try {
      for (let i = 0; i < 30; i++) {   // 5 s de travail par appel : rappelé tant qu'il en reste
        const r = await adminFetch(API, { method: "POST", body: JSON.stringify({ action: "envoyer" }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        total.envoyes += j.envoyes || 0; total.produits += j.produits || 0; total.closes += somme(j.closes); total.echecs += j.echecs || 0;
        total.erreurs.push(...(j.erreurs || []));
        setEnvoi(`Envoi en cours… ${total.envoyes} e-mail(s)`);
        if (j.done !== false) break;
      }
      const msg = `✓ ${total.envoyes} e-mail(s) envoyé(s) (${total.produits} produit(s)), ${total.closes} demande(s) close(s)${total.echecs ? `, ${total.echecs} refusé(s)` : ""}`;
      setEnvoi(total.erreurs.length ? `${msg} — ${[...new Set(total.erreurs)].slice(0, 3).join(" ; ")}` : msg);
      flash?.(msg);
    } catch (e) { setEnvoi(`⚠ ${e.message}`); }
    await charger();
  };
  const relancer = async (x) => {
    if (!window.confirm(`Envoi interrompu pour ${x.pharmacie || x.pharmacy_cip} (${x.produit || x.cip}).\n\nAvez-vous vérifié dans Resend que l'e-mail n'est PAS parti ?\n\nLa demande repartira au prochain passage.`)) return;
    try {
      const r = await adminFetch(API, { method: "POST", body: JSON.stringify({ action: "relancer", pharmacy_cip: x.pharmacy_cip, cip: x.cip }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash?.("✓ Demande remise en attente"); await charger();
    } catch (e) { flash?.(`⚠ ${e.message}`); }
  };

  if (!d) return err ? <div role="alert" style={{ ...ui.encart("danger") }}>⚠ Alertes retour : {err}</div>
    : <div style={{ fontSize: 13, color: T.inkMute }}>Chargement des alertes retour…</div>;
  const avertiesMois = (d.recents || []).filter(x => x.issue === "envoye").length;
  const recents = tousRecents ? d.recents || [] : (d.recents || []).slice(0, RECENTS_VISIBLES);
  const premiere = !(d.passages || []).length && !d.dernier;
  const carte = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, padding: "14px 16px" };
  const titre = { ...ui.h2, margin: "26px 0 10px" };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: T.petrol }}>🔔 Alertes retour en stock</div>
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.55, maxWidth: 760 }}>
            Bouton « M’avertir du retour » de la Saisie de commande. Après chaque mise à jour du stock, chaque pharmacie qui attendait un produit
            revenu reçoit <b>un</b> e-mail (plusieurs produits regroupés), une seule fois par demande, entre {d.regles.fenetre.de} h et {d.regles.fenetre.a} h.
            Les demandes de plus de {d.regles.age_max_jours} jours sont closes sans e-mail (trop anciennes). La pharmacie voit aussi « De retour en stock »
            dans sa Saisie pendant {d.regles.recent_jours} jours.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={charger} style={{ ...ui.btn("doux", "m") }}>Actualiser</button>
          <button onClick={envoyer} disabled={!!envoi && envoi.startsWith("Envoi en cours")} style={{ ...ui.btn("primaire", "m") }}>Envoyer maintenant</button>
        </div>
      </div>

      {d.mode === "reduit" && (
        <div role="note" style={{ ...ui.encart("warn"), marginBottom: 12 }}>
          <b>Base en mode réduit</b> : passez <code>sql/restock-notify.sql</code> dans Supabase (colonnes attempts et outcome). Les e-mails partent déjà,
          une seule fois par demande ; sans ces colonnes, les envois interrompus ne sont pas repérés.
        </div>
      )}
      {premiere && (t.emails_prets > 0 || t.anciennes > 0) && (
        <div role="note" style={{ ...ui.encart("info"), marginBottom: 12 }}>
          <b>Mise en service</b> : les demandes déjà enregistrées sont prises en compte. Au premier passage,
          {t.emails_prets > 0 ? <> jusqu’à <b>{t.emails_prets} e-mail(s)</b> partiront ({t.produits_prets} produit(s) revenu(s) en stock)</> : " aucun e-mail ne partira"}
          {t.anciennes > 0 ? <> ; <b>{t.anciennes} demande(s) de plus de {d.regles.age_max_jours} jours</b> seront closes sans e-mail (trop anciennes)</> : ""}.
        </div>
      )}
      {envoi && <div role="status" style={{ ...ui.encart(envoi.startsWith("⚠") ? "danger" : envoi.startsWith("✓") ? "ok" : "neutral"), marginBottom: 12 }}>{envoi}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {[
          ["En attente", t.en_attente, `${t.pharmacies_en_attente || 0} pharmacie(s)`],
          ["Prêts à partir", t.produits_prets, `produit(s) revenu(s) · jusqu'à ${t.emails_prets || 0} e-mail(s)`],
          ["Trop anciennes", t.anciennes, `plus de ${d.regles.age_max_jours} j : closes sans e-mail au prochain passage`],
          ["Averties par e-mail", avertiesMois, "demandes, sur 30 jours"],
        ].map(([l, v, s]) => (
          <div key={l} style={carte}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft }}>{l}</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 700, color: T.petrol, lineHeight: 1.2, marginTop: 4 }}>{(v || 0).toLocaleString("fr-FR")}</div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 10 }}>
        Dernier passage : {d.dernier ? <>{dt(d.dernier.at)} ({SOURCES[d.dernier.source] || d.dernier.source}) — {resumePassage(d.dernier)}
          {d.dernier.erreur ? <span style={{ color: T.danger }}> · erreur : {d.dernier.erreur}</span> : null}
          {(d.dernier.erreurs || []).length ? <span style={{ color: T.warn }}> · {d.dernier.erreurs.slice(0, 2).join(" ; ")}</span> : null}</> : "aucun pour l'instant"}
      </div>

      {(d.interrompus || []).length > 0 && (
        <div role="alert" style={{ ...ui.encart("acting"), marginTop: 14 }}>
          <b>Envois interrompus</b> (fonction coupée entre la réservation et le compte rendu) : jamais renvoyés d’office. Vérifiez dans Resend, puis relancez si l’e-mail n’est pas parti.
          {d.interrompus.map(x => (
            <div key={`${x.pharmacy_cip}-${x.cip}`} style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span>{dt(x.at)} · {x.pharmacie || `CIP ${x.pharmacy_cip}`} · {x.produit || x.cip}</span>
              <button onClick={() => relancer(x)} style={{ ...ui.btn("ligne", "s"), height: 26 }}>Relancer</button>
            </div>
          ))}
        </div>
      )}

      <h3 style={titre}>Produits les plus attendus</h3>
      {!(d.produits || []).length ? <div style={{ fontSize: 13, color: T.inkMute }}>Aucune demande en attente.</div> : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.m, background: T.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr>
              <th style={ui.th}>Produit</th><th style={{ ...ui.th, textAlign: "right" }}>Pharmacies</th>
              <th style={ui.th}>Plus ancienne demande</th><th style={ui.th}>Stock</th>
            </tr></thead>
            <tbody>
              {d.produits.map(p => (
                <React.Fragment key={p.cip}>
                  <tr style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={ui.td}>
                      <div style={{ fontWeight: 600 }}>{p.nom}</div>
                      <div className="num" style={{ fontSize: 11, color: T.inkMute }}>CIP {p.cip}</div>
                    </td>
                    <td style={{ ...ui.td, textAlign: "right" }}>
                      <button onClick={() => setOuvert(ouvert === p.cip ? null : p.cip)} aria-expanded={ouvert === p.cip}
                        title="Voir les pharmacies qui attendent ce produit" style={{ ...ui.btn("doux", "s"), height: 28, padding: "0 10px" }}>
                        <span className="num">{p.attente}</span> {ouvert === p.cip ? "▴" : "▾"}
                      </button>
                    </td>
                    <td style={ui.td}>{jour(p.plus_ancienne)} <span style={{ fontSize: 11, color: T.inkMute }}>({ilYa(p.plus_ancienne)})</span></td>
                    <td style={ui.td}>
                      {p.pret ? <Pastille ton="ok">En stock · {fmtEur(p.prix)} HT : part au prochain passage</Pastille>
                        : p.en_stock ? <Pastille ton="warn">En stock, prix manquant : attend un prix</Pastille>
                        : p.connu ? <Pastille ton="danger">Rupture</Pastille>
                        : <Pastille ton="neutral">Absent du catalogue Odoo</Pastille>}
                    </td>
                  </tr>
                  {ouvert === p.cip && (
                    <tr><td colSpan={4} style={{ ...ui.td, background: T.paper, fontSize: 12, color: T.inkSoft }}>
                      {p.pharmacies.map(x => <div key={x.cip}>{x.nom || "Pharmacie sans compte"} <span className="num" style={{ color: T.inkMute }}>· CIP {x.cip} · depuis le {jour(x.depuis)}</span></div>)}
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={titre}>Avertis récemment (30 jours)</h3>
      {!(d.recents || []).length ? <div style={{ fontSize: 13, color: T.inkMute }}>Aucun avertissement ni clôture depuis 30 jours.</div> : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.m, background: T.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr><th style={ui.th}>Date</th><th style={ui.th}>Pharmacie</th><th style={ui.th}>Produit</th><th style={ui.th}>Issue</th></tr></thead>
            <tbody>
              {recents.map((x, i) => {
                const [lib, ton, aide] = ISSUES[x.issue] || [x.issue, "neutral", ""];
                return (
                  <tr key={`${x.at}-${x.pharmacy_cip}-${x.cip}-${i}`} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{dt(x.at)}</td>
                    <td style={ui.td}>{x.pharmacie || "Pharmacie sans compte"}<div className="num" style={{ fontSize: 11, color: T.inkMute }}>CIP {x.pharmacy_cip}</div></td>
                    <td style={ui.td}>{x.produit || x.cip}<div className="num" style={{ fontSize: 11, color: T.inkMute }}>CIP {x.cip}{x.prix ? ` · ${fmtEur(x.prix)} HT` : ""}</div></td>
                    <td style={{ ...ui.td, whiteSpace: "nowrap" }}><Pastille court ton={ton} title={aide}>{lib}</Pastille></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(d.recents || []).length > RECENTS_VISIBLES && (
        <button onClick={() => setTousRecents(!tousRecents)} style={{ ...ui.btn("doux", "s"), marginTop: 8 }}>
          {tousRecents ? "Réduire la liste" : `Afficher les ${d.recents.length - RECENTS_VISIBLES} autres`}
        </button>
      )}

      <h3 style={titre}>Journal des passages</h3>
      {!(d.passages || []).length ? <div style={{ fontSize: 13, color: T.inkMute }}>Aucun passage avec envoi ou clôture depuis 30 jours.</div> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, color: T.inkSoft, display: "grid", gap: 4 }}>
          {d.passages.map(p => (
            <li key={p.at + p.source}>
              <span className="num">{dt(p.at)}</span> · {SOURCES[p.source] || p.source} — {resumePassage(p)}
              {p.erreur ? <span style={{ color: T.danger }}> · erreur : {p.erreur}</span> : null}
              {(p.erreurs || []).length ? <span style={{ color: tone("warn").fg }}> · {p.erreurs.slice(0, 2).join(" ; ")}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
