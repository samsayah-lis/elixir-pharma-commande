import React, { useCallback, useEffect, useState } from "react";
import { T, R, ui, fmtEur } from "../theme.js";

// ── Admin : onglet « 🔌 API » (API des pharmacies, /api/v1) — chargé à la demande par AdminPanel ──
// État du service (« Tout couper »), interrupteur « Commandes par API » et sa liste de prérequis, accès des pharmacies
// (ouverture, réglages, suspension), clés SANS secret (révocation ; variante admin tracée pour une pharmacie sans compte),
// usage et journal des appels. API : netlify/functions/api-admin.js (verifyAdmin). Les secrets ne sont jamais lus : seule
// une clé créée ici par l'admin est montrée, UNE fois.
const API = "/.netlify/functions/api-admin";
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
const ETATS_CLE = { active: ["Active", "ok"], remplacee: ["Remplacée (encore valide)", "warn"], expiree: ["Expirée", "neutral"], revoquee: ["Révoquée", "danger"] };
const ENV = { live: ["Production", "labo"], test: ["Test", "info"] };
const MODES = { auto: "Automatique (délai d'annulation, puis envoi)", bloque: "Bloqué (commandes refusées, rien n'est envoyé)" };
const CHAMPS = [
  ["delai_annulation_min", "Délai d'annulation (min)"], ["plafond_lignes", "Lignes par commande"], ["plafond_boites", "Boîtes par commande"],
  ["plafond_montant_ht", "Montant HT par commande (€)"], ["plafond_commandes_jour", "Commandes par jour"],
  ["anomalie_facteur", "Anomalie : × la quantité mensuelle habituelle"], ["anomalie_doublon_min", "Anomalie : quasi-doublon sur (min)"],
];
const carte = { ...ui.card, marginBottom: 16 };
const grille = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 };
// bouton désactivé : visible comme tel (ui.btn n'a pas d'état désactivé)
const off = (desactive) => (desactive ? { opacity: 0.45, cursor: "not-allowed" } : null);
const Badge = ({ ton = "neutral", plein = false, children }) => <span style={ui.badge(ton, plein)}>{children}</span>;
const lire = async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok) throw Object.assign(new Error(d.error || `Erreur ${res.status}`), { donnees: d, status: res.status }); return d; };

// Clé créée par l'admin : montrée une seule fois
function SecretUnique({ secret, onFermer }) {
  const [copie, setCopie] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="api-secret-titre" style={{ ...ui.overlay, zIndex: 1300 }}>
      <div style={{ ...ui.modal, maxWidth: 560 }}>
        <h2 id="api-secret-titre" style={ui.titreModal}>Clé créée : copiez-la maintenant</h2>
        <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>Elle ne sera plus jamais affichée (seule son empreinte est gardée). Remise à la pharmacie <b>de vive voix</b>, jamais par e-mail ni message. Ce que vous voyez est tracé dans le journal de l'accès.</p>
        <code style={{ display: "block", wordBreak: "break-all", background: T.surface2, padding: "12px 14px", borderRadius: R.s, fontFamily: T.mono, fontSize: 13, userSelect: "all" }}>{secret}</code>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button style={ui.btn("ligne")} onClick={() => navigator.clipboard?.writeText(secret).then(() => setCopie(true), () => setCopie(false))}>{copie ? "Copiée ✓" : "Copier"}</button>
          <button style={ui.btn("primaire")} onClick={onFermer}>J'ai remis la clé, fermer</button>
        </div>
      </div>
    </div>
  );
}

// ── Bandeau : service, « Tout couper », commandes par API et prérequis ──
function EtatService({ t, poster }) {
  const r = t.reglages;
  const basculer = (corps, question) => { if (!question || window.confirm(question)) poster({ ...corps, base: t.updated_at }); };
  return (
    <section style={carte} aria-labelledby="api-service">
      <h2 id="api-service" style={ui.h2}>État du service</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {r.actif ? <Badge ton="ok">API en service</Badge> : <Badge ton="danger" plein>API coupée (503 sauf /v1/etat)</Badge>}
        <Badge ton={t.commandes_production === "ouvertes" ? "ok" : "warn"}>Commandes par API : {t.commandes_production}</Badge>
        <span style={{ fontSize: 12, color: T.inkMute }}>Version {t.version_api} · CGU {t.cgu_version}</span>
        <span style={{ flex: 1 }} />
        {r.actif
          ? <button style={ui.btn("danger")} onClick={() => window.confirm("Tout couper ?\n\nToutes les routes de l'API répondront « service suspendu » (sauf /v1/etat) et les commandes par API seront fermées.") && poster({ action: "tout_couper" })}>Tout couper</button>
          : <button style={ui.btn("primaire")} onClick={() => basculer({ action: "reglages", actif: true }, "Remettre l'API en service ?")}>Remettre en service</button>}
      </div>
      <div style={{ ...ui.encart(t.commandes_production === "ouvertes" ? "ok" : "warn"), marginBottom: 12 }}>
        <b>Commandes par API (production) : {t.commandes_production}.</b> Les clés de test (elx_test_) fonctionnent dès la mise en ligne : elles n'écrivent que dans les tables privées de l'API.
        Les commandes réelles ne s'ouvrent qu'une fois TOUS les prérequis cochés ; décocher une case les referme.
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {t.prerequis.map(p => (
          <li key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" id={`api-pre-${p.id}`} checked={p.fait} disabled={!p.fait && !p.cochable}
              onChange={(e) => { const note = e.target.checked ? window.prompt(`${p.id} fait : note (facultative, ex. date, qui a vérifié)`, "") : ""; if (note !== null) poster({ action: "prerequis", id: p.id, fait: e.target.checked, note, base: t.updated_at }); }} />
            <label htmlFor={`api-pre-${p.id}`} style={{ lineHeight: 1.45 }}>
              <b>{p.id}</b> · {p.libelle}
              {!p.cochable && <span style={{ color: T.warn }}> — pas avant le {p.pas_avant.split("-").reverse().join("/")}</span>}
              {p.le && <span style={{ color: T.inkMute }}> — {p.fait ? "coché" : "décoché"} le {dt(p.le)} par {p.par}{p.note ? ` (${p.note})` : ""}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {r.commandes_live
          ? <button style={ui.btn("ligne")} onClick={() => basculer({ action: "reglages", commandes_live: false }, "Fermer les commandes par API (production) ?")}>Fermer les commandes par API</button>
          : <button style={{ ...ui.btn("primaire"), ...off(!t.ouvrable.ok || !r.actif) }} disabled={!t.ouvrable.ok || !r.actif} title={t.ouvrable.ok ? "" : `Prérequis manquants : ${t.ouvrable.manquants.join(", ")}`}
              onClick={() => basculer({ action: "reglages", commandes_live: true }, "Ouvrir les commandes par API en production ?\n\nLes pharmacies dont l'accès est en mode automatique pourront passer des commandes réelles.")}>Ouvrir les commandes par API</button>}
      </div>
    </section>
  );
}

// ── Ouvrir un accès : recherche d'une fiche cliente (admin-pharmacy-find) ──
function OuvrirAcces({ adminFetch, t, poster, onFermer }) {
  const [q, setQ] = useState(""), [res, setRes] = useState(null), [choix, setChoix] = useState(null);
  const [portees, setPortees] = useState(t.defauts.portees), [mode, setMode] = useState(t.defauts.mode), [note, setNote] = useState("");
  const chercher = async () => {
    if (q.trim().length < 2) return;
    setRes("…");
    try { setRes((await lire(await adminFetch(`/.netlify/functions/admin-pharmacy-find?q=${encodeURIComponent(q.trim())}`))).pharmacies || []); }
    catch (e) { setRes([]); window.alert(e.message); }
  };
  const dejaOuvert = new Set(t.acces.map(a => a.odoo_id));
  return (
    <div style={{ ...ui.panel, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input style={{ ...ui.input, flex: "1 1 260px" }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && chercher()}
          placeholder="Nom, ville, CIP ou e-mail de la pharmacie" aria-label="Rechercher une pharmacie" />
        <button style={ui.btn("primaire")} onClick={chercher}>Rechercher</button>
        <button style={ui.btn("ligne")} onClick={onFermer}>Annuler</button>
      </div>
      {res === "…" && <p style={{ fontSize: 13, color: T.inkMute }}>Recherche…</p>}
      {Array.isArray(res) && !choix && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 6 }}>
          {res.length === 0 && <li style={{ fontSize: 13, color: T.inkMute }}>Aucune fiche cliente trouvée.</li>}
          {res.map(p => (
            <li key={p.odoo_id}>
              <button style={{ ...ui.btn("ligne", "s"), width: "100%", justifyContent: "flex-start", height: "auto", padding: "8px 12px", whiteSpace: "normal", textAlign: "left", ...off(dejaOuvert.has(p.odoo_id) || !p.cip) }}
                disabled={dejaOuvert.has(p.odoo_id) || !p.cip} onClick={() => setChoix(p)}>
                <b>{p.name}</b>&nbsp;· {p.city || "–"} · CIP {p.cip || "absent (client bloqué)"} · n° {p.odoo_id}
                {p.has_account ? " · compte du site" : " · sans compte du site"}{dejaOuvert.has(p.odoo_id) ? " · accès déjà ouvert" : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      {choix && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13 }}>Ouvrir l'accès API de <b>{choix.name}</b> ({choix.city || "–"}, CIP {choix.cip}). La fiche est revérifiée dans Odoo.</p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 10 }}>
            {t.portees.map(p => (
              <label key={p} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={portees.includes(p)} onChange={e => setPortees(e.target.checked ? [...new Set([...portees, p])] : portees.filter(x => x !== p))} />
                {t.libelles_portees[p]}
              </label>
            ))}
          </div>
          <label style={ui.label} htmlFor="api-mode-nouveau">Mode</label>
          <select id="api-mode-nouveau" style={{ ...ui.input, maxWidth: 420, marginBottom: 10 }} value={mode} onChange={e => setMode(e.target.value)}>
            {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label style={ui.label} htmlFor="api-note-nouveau">Note interne (facultative)</label>
          <input id="api-note-nouveau" style={{ ...ui.input, marginBottom: 12 }} value={note} onChange={e => setNote(e.target.value)} placeholder="ex. demande reçue le …, outil utilisé" />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...ui.btn("primaire"), ...off(!portees.length) }} disabled={!portees.length} onClick={() => poster({ action: "ouvrir_acces", odoo_id: choix.odoo_id, portees, mode, note }, { ouvrir: choix.odoo_id }).then(ok => ok && onFermer())}>Ouvrir l'accès</button>
            <button style={ui.btn("ligne")} onClick={() => setChoix(null)}>Autre fiche</button>
          </div>
          <p style={{ fontSize: 12, color: T.inkMute }}>Plafonds par défaut : {t.defauts.plafond_lignes} lignes, {Number(t.defauts.plafond_boites).toLocaleString("fr-FR")} boîtes, {fmtEur(t.defauts.plafond_montant_ht)} HT, {t.defauts.plafond_commandes_jour} commandes par jour ; délai d'annulation {t.defauts.delai_annulation_min} min. Modifiables ensuite.</p>
        </div>
      )}
    </div>
  );
}

// ── Détail d'un accès : réglages, actions, clés, événements ──
function DetailAcces({ d, t, poster, recharger }) {
  const a = d.acces;
  const [f, setF] = useState(null);
  useEffect(() => {
    setF({ portees: a.portees, mode: a.mode, anomalie_active: a.anomalie_active, ip_autorisees: (a.ip_autorisees || []).join("\n"), note: a.note || "",
      ...Object.fromEntries(CHAMPS.map(([k]) => [k, String(a[k])])) });
  }, [a]);
  if (!f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const action = (corps, question, champ) => {
    if (question && !window.confirm(question)) return;
    const extra = champ ? window.prompt(champ, "") : null;
    if (champ && !extra?.trim()) return;
    poster({ ...corps, odoo_id: a.odoo_id, ...(champ ? { [corps.action === "cgu_signees" ? "reference" : "motif"]: extra } : {}) }).then(recharger);
  };
  const creerCle = () => {
    const environnement = a.test_valide_le && window.confirm("Clé de PRODUCTION ?\n\nOK : production · Annuler : test") ? "live" : "test";
    const libelle = window.prompt("Nom de la clé (l'outil qui l'utilise)", "");
    if (!libelle?.trim()) return;
    const motif = window.prompt("Motif (obligatoire, tracé) : ex. « pharmacie sans compte du site »", "pharmacie sans compte du site");
    if (!motif?.trim()) return;
    poster({ action: "creer_cle_admin", odoo_id: a.odoo_id, environnement, libelle, portees: a.portees, motif }, { secret: true }).then(recharger);
  };
  return (
    <section style={{ ...carte, borderColor: T.teal2 }} aria-labelledby="api-detail">
      <h2 id="api-detail" style={ui.h2}>{a.nom || `Fiche n° ${a.odoo_id}`}</h2>
      <p style={{ fontSize: 13, color: T.inkSoft, marginTop: -4 }}>
        CIP {a.cip || "–"} · {a.ville || "–"} · fiche Odoo n° {a.odoo_id} · liste de prix {a.liste_prix_id ? `n° ${a.liste_prix_id}` : "non lue"} ·
        ouvert le {dt(a.ouvert_le)} par {a.ouvert_par}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {a.actif ? <Badge ton="ok">Accès actif</Badge> : <Badge ton="danger" plein>Suspendu : {a.motif_suspension || "–"}</Badge>}
        {a.cgu_a_jour ? <Badge ton="ok">CGU acceptées le {dt(a.cgu_acceptees_le)}{a.cgu_preuve?.mode === "signature" ? " (signature)" : ""}</Badge> : <Badge ton="warn">CGU {a.cgu_version ? "à ré-accepter" : "non acceptées"}</Badge>}
        {a.test_valide_le ? <Badge ton="ok">Test validé le {dt(a.test_valide_le)}{a.test_valide_par ? ` (${a.test_valide_par})` : ""}</Badge> : <Badge ton="neutral">Test non validé</Badge>}
      </div>

      <div style={grille}>
        <div>
          <span style={ui.label}>Droits</span>
          {t.portees.map(p => (
            <label key={p} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
              <input type="checkbox" checked={f.portees.includes(p)} onChange={e => set("portees", e.target.checked ? [...new Set([...f.portees, p])] : f.portees.filter(x => x !== p))} />
              {p === "lecture" ? "Lecture" : "Commande"}
            </label>
          ))}
        </div>
        <div>
          <label style={ui.label} htmlFor="api-mode">Mode</label>
          <select id="api-mode" style={ui.input} value={f.mode} onChange={e => set("mode", e.target.value)}>
            {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 10 }}>
            <input type="checkbox" checked={f.anomalie_active} onChange={e => set("anomalie_active", e.target.checked)} />
            Garder « à vérifier » les commandes anormales
          </label>
        </div>
        {CHAMPS.map(([k, l]) => (
          <div key={k}>
            <label style={ui.label} htmlFor={`api-${k}`}>{l}</label>
            <input id={`api-${k}`} style={ui.input} inputMode="decimal" value={f[k]} onChange={e => set(k, e.target.value)} />
          </div>
        ))}
        <div>
          <label style={ui.label} htmlFor="api-ip">Réseaux autorisés (un par ligne, vide : tous)</label>
          <textarea id="api-ip" style={{ ...ui.input, minHeight: 64, fontFamily: T.mono, fontSize: 12 }} value={f.ip_autorisees} onChange={e => set("ip_autorisees", e.target.value)} placeholder="203.0.113.0/24" />
        </div>
        <div>
          <label style={ui.label} htmlFor="api-note">Note interne</label>
          <textarea id="api-note" style={{ ...ui.input, minHeight: 64 }} value={f.note} onChange={e => set("note", e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button style={ui.btn("primaire")} onClick={() => poster({ action: "modifier_acces", odoo_id: a.odoo_id, champs: f }).then(recharger)}>Enregistrer les réglages</button>
        {a.actif
          ? <button style={ui.btn("ligne")} onClick={() => action({ action: "suspendre_acces" }, null, "Motif de la suspension (tracé) :")}>Suspendre l'accès</button>
          : <button style={ui.btn("ligne")} onClick={() => action({ action: "reactiver_acces" }, "Réactiver l'accès ? La fiche est revérifiée dans Odoo.")}>Réactiver</button>}
        <button style={ui.btn("ligne")} onClick={() => action({ action: "rafraichir_fiche" })}>Relire la fiche dans Odoo</button>
        {!a.cgu_a_jour && <button style={ui.btn("ligne")} onClick={() => action({ action: "cgu_signees" }, null, "CGU acceptées hors ligne : référence du document signé (tracée)")}>CGU signées (PDF)</button>}
        {!a.test_valide_le && <button style={ui.btn("ligne")} onClick={() => action({ action: "valider_test" }, "Valider le test sans le parcours complet ?\n\nLa pharmacie pourra créer des clés de production.", "Motif (tracé) :")}>Valider le test (passer outre)</button>}
        <button style={ui.btn("doux")} onClick={creerCle} title="Pour une pharmacie sans compte du site : la clé est montrée une fois, à remettre de vive voix">Créer une clé (sans compte)</button>
      </div>

      <h3 style={{ ...ui.h2, marginTop: 22 }}>Clés ({d.cles.length})</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Clé", "Environnement", "Nom", "État", "Créée", "Dernière utilisation", "24 h", ""].map(h => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
          <tbody>
            {d.cles.length === 0 && <tr><td colSpan={8} style={{ ...ui.td, color: T.inkMute }}>Aucune clé : la pharmacie les crée dans son compte (« Mes commandes » → « Accès API »).</td></tr>}
            {d.cles.map(c => (
              <tr key={c.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td style={{ ...ui.td, fontFamily: T.mono, fontSize: 12 }}>{c.prefixe}</td>
                <td style={ui.td}><Badge ton={ENV[c.environnement][1]}>{ENV[c.environnement][0]}</Badge></td>
                <td style={ui.td}>{c.libelle}<div style={{ fontSize: 11, color: T.inkMute }}>{c.portees.join(" + ")}</div></td>
                <td style={ui.td}><Badge ton={ETATS_CLE[c.etat][1]}>{ETATS_CLE[c.etat][0]}</Badge>{c.etat === "remplacee" && <div style={{ fontSize: 11, color: T.inkMute }}>jusqu'au {dt(c.expire_le)}</div>}{c.motif_revocation && <div style={{ fontSize: 11, color: T.inkMute }}>{c.motif_revocation} ({c.revoquee_par})</div>}</td>
                <td style={ui.td}>{dt(c.created_at)}<div style={{ fontSize: 11, color: T.inkMute }}>{c.creee_par_role === "admin" ? "admin : " : ""}{c.creee_par}</div></td>
                <td style={ui.td}>{dt(c.derniere_utilisation)}<div style={{ fontSize: 11, color: T.inkMute, fontFamily: T.mono }}>{c.dernier_reseau || ""}</div></td>
                <td style={ui.td}>{c.usage_24h.requetes}{c.usage_24h.erreurs ? <span style={{ color: T.danger }}> · {c.usage_24h.erreurs} err.</span> : ""}</td>
                <td style={ui.td}>{["active", "remplacee"].includes(c.etat) && <button style={ui.btn("ligne", "s")} onClick={() => { const m = window.prompt(`Révoquer ${c.prefixe} (« ${c.libelle} ») ?\nMotif (tracé, vu par la pharmacie) :`, ""); if (m?.trim()) poster({ action: "revoquer_cle", id: c.id, motif: m }).then(recharger); }}>Révoquer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Historique de l'accès ({d.evenements.length})</summary>
        <ul style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.6 }}>
          {d.evenements.map(e => <li key={e.id}>{dt(e.at)} · <b>{e.type}</b> · {e.role === "admin" ? "admin " : ""}{e.par || "–"}{e.detail ? ` · ${JSON.stringify(e.detail)}` : ""}</li>)}
        </ul>
      </details>
    </section>
  );
}

// ── Journal des appels (500 derniers, jamais de corps) et export CSV ──
function Journal({ adminFetch, odooId }) {
  const [lignes, setLignes] = useState(null), [erreurs, setErreurs] = useState(false), [toutes, setToutes] = useState(false);
  const charger = useCallback(async () => {
    setLignes(null);
    const p = new URLSearchParams({ vue: "journal", ...(odooId && !toutes ? { odoo_id: String(odooId) } : {}), ...(erreurs ? { erreurs: "1" } : {}) });
    try { setLignes((await lire(await adminFetch(`${API}?${p}`))).lignes); } catch { setLignes([]); }
  }, [adminFetch, odooId, toutes, erreurs]);
  useEffect(() => { charger(); }, [charger]);
  const csv = () => {
    const cols = ["at", "request_id", "odoo_id", "cle", "environnement", "methode", "route", "statut", "code", "duree_ms", "reseau"];
    const echappe = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const texte = [cols.join(";"), ...(lignes || []).map(l => cols.map(c => echappe(l[c])).join(";"))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + texte], { type: "text/csv;charset=utf-8" }));
    const lien = Object.assign(document.createElement("a"), { href: url, download: `journal-api-${new Date().toISOString().slice(0, 10)}.csv` });
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section style={carte} aria-labelledby="api-journal">
      <h2 id="api-journal" style={ui.h2}>Journal des appels</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {odooId && <button style={ui.pill(!toutes)} aria-pressed={!toutes} onClick={() => setToutes(!toutes)}>Cette pharmacie</button>}
        <button style={ui.pill(erreurs)} aria-pressed={erreurs} onClick={() => setErreurs(!erreurs)}>Erreurs seulement</button>
        <button style={ui.btn("ligne", "s")} onClick={charger}>Actualiser</button>
        <button style={{ ...ui.btn("ligne", "s"), ...off(!lignes?.length) }} disabled={!lignes?.length} onClick={csv}>Export CSV</button>
      </div>
      {lignes === null ? <p style={{ fontSize: 13, color: T.inkMute }}>Chargement…</p> : (
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>{["Heure", "Fiche", "Clé", "Route", "Statut", "Code", "Durée", "Réseau", "Requête"].map(h => <th key={h} style={{ ...ui.th, position: "sticky", top: 0 }}>{h}</th>)}</tr></thead>
            <tbody>
              {lignes.length === 0 && <tr><td colSpan={9} style={{ ...ui.td, color: T.inkMute }}>Aucun appel.</td></tr>}
              {lignes.map(l => (
                <tr key={l.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <td style={ui.td}>{dt(l.at)}</td><td style={ui.td}>{l.odoo_id || "–"}</td>
                  <td style={{ ...ui.td, fontFamily: T.mono }}>{l.cle || "–"}{l.environnement === "test" ? " (test)" : ""}</td>
                  <td style={ui.td}>{l.methode} {l.route}</td>
                  <td style={{ ...ui.td, color: l.statut >= 400 ? T.danger : T.ok, fontWeight: 700 }}>{l.statut}</td>
                  <td style={ui.td}>{l.code || ""}</td><td style={ui.td}>{l.duree_ms} ms</td>
                  <td style={{ ...ui.td, fontFamily: T.mono }}>{l.reseau || ""}</td>
                  <td style={{ ...ui.td, fontFamily: T.mono, fontSize: 11, color: T.inkMute }}>{String(l.request_id).slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function AdminApi({ adminFetch, flash }) {
  const [t, setT] = useState(null), [erreur, setErreur] = useState(null);
  const [selection, setSelection] = useState(null), [detail, setDetail] = useState(null);
  const [ouvrir, setOuvrir] = useState(false), [secret, setSecret] = useState(null);

  const charger = useCallback(async () => {
    try { setT(await lire(await adminFetch(`${API}?vue=tableau`))); setErreur(null); }
    catch (e) { setErreur(e.message); }
  }, [adminFetch]);
  const chargerDetail = useCallback(async (id = selection) => {
    if (!id) return setDetail(null);
    try { setDetail(await lire(await adminFetch(`${API}?vue=acces&odoo_id=${id}`))); } catch (e) { flash?.(`⚠ ${e.message}`); }
  }, [adminFetch, selection, flash]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { chargerDetail(selection); }, [selection]);   // eslint-disable-line react-hooks/exhaustive-deps

  // POST → true si accepté ; opts.secret : clé montrée une fois ; opts.ouvrir : fiche à sélectionner ensuite
  const poster = useCallback(async (corps, opts = {}) => {
    try {
      const d = await lire(await adminFetch(API, { method: "POST", body: JSON.stringify(corps) }));
      if (opts.secret && d.cle) setSecret(d.cle);
      flash?.("✓ Enregistré");
      await charger();
      if (opts.ouvrir) setSelection(opts.ouvrir);
      return true;
    } catch (e) {
      window.alert(e.message);
      await charger();
      return false;
    }
  }, [adminFetch, charger, flash]);

  if (erreur) return <div style={{ ...ui.encart("danger"), margin: 24 }}>Onglet API : {erreur} <button style={{ ...ui.btn("ligne", "s"), marginLeft: 8 }} onClick={charger}>Réessayer</button></div>;
  if (!t) return <div style={{ padding: 40, textAlign: "center", color: T.inkMute }}>Chargement de l'onglet API…</div>;
  return (
    <div style={{ padding: "8px 0" }}>
      {secret && <SecretUnique secret={secret} onFermer={() => setSecret(null)} />}
      <EtatService t={t} poster={poster} />
      <section style={carte} aria-labelledby="api-acces">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 id="api-acces" style={ui.h2}>Accès des pharmacies ({t.acces.length})</h2>
          {!ouvrir && <button style={ui.btn("primaire", "s")} onClick={() => setOuvrir(true)}>Ouvrir un accès</button>}
        </div>
        <p style={{ fontSize: 12, color: T.inkMute, marginTop: 0 }}>Accès ouvert à la demande, pharmacie par pharmacie. La pharmacie accepte les conditions puis crée ses clés dans son compte (« Mes commandes » → « Accès API ») : clé de test d'abord, de production une fois le test validé.</p>
        {ouvrir && <OuvrirAcces adminFetch={adminFetch} t={t} poster={poster} onFermer={() => setOuvrir(false)} />}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Pharmacie", "Mode", "Droits", "Clés actives", "CGU", "Test", "Dernière activité"].map(h => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
            <tbody>
              {t.acces.length === 0 && <tr><td colSpan={7} style={{ ...ui.td, color: T.inkMute }}>Aucun accès ouvert.</td></tr>}
              {t.acces.map(a => (
                <tr key={a.odoo_id} onClick={() => setSelection(selection === a.odoo_id ? null : a.odoo_id)} aria-selected={selection === a.odoo_id}
                  style={{ borderTop: `1px solid ${T.lineSoft}`, cursor: "pointer", background: selection === a.odoo_id ? T.mint : undefined }}>
                  <td style={ui.td}><b>{a.nom || `n° ${a.odoo_id}`}</b><div style={{ fontSize: 11, color: T.inkMute }}>{a.ville || "–"} · CIP {a.cip || "–"}{a.actif ? "" : " · SUSPENDU"}</div></td>
                  <td style={ui.td}>{a.mode === "auto" ? <Badge ton="ok">auto</Badge> : <Badge ton="danger">bloqué</Badge>}</td>
                  <td style={ui.td}>{a.portees.join(" + ")}</td>
                  <td style={ui.td}>{a.cles_actives.live} prod. · {a.cles_actives.test} test</td>
                  <td style={ui.td}>{a.cgu_a_jour ? "✓" : "—"}</td>
                  <td style={ui.td}>{a.test_valide_le ? "✓" : "—"}</td>
                  <td style={ui.td}>{dt(a.derniere_utilisation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selection && detail?.acces?.odoo_id === selection && <DetailAcces d={detail} t={t} poster={poster} recharger={() => chargerDetail(selection)} />}
      <Journal adminFetch={adminFetch} odooId={selection} />
    </div>
  );
}
