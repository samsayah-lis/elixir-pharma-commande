import React, { useCallback, useEffect, useMemo, useState } from "react";
import { T, R, ui, tone } from "../theme.js";
import { Icone } from "../icons.jsx";
import * as C from "../notifications/client.js";
import { analyser, libelleAppareil, parcours as parcoursDe } from "../notifications/plateforme.js";
import { PLAFOND_MAX, PLAFOND_COMMANDES_MAX } from "../notifications/regles.js";
import Messages, { CATS } from "./AdminMessages.jsx";

// ── Admin : notifications de l'appli (onglet « 📲 Notifications », docs/notifications.md) ──
// État du service (sans aucune valeur de clé), ouverture aux pharmacies (fermée / pilote / toutes) et plafond des offres,
// appareils de l'admin (tests et aperçus : rôle admin, jamais au nom d'une pharmacie), statistiques, messages unitaires et
// collectifs (types, modèles, programmation, e-mail de secours, historiques : AdminMessages.jsx). API :
// netlify/functions/push-admin.js (verifyAdmin).
// Chargé avec l'admin (chunk AdminPanel) : hors du bundle des pharmacies.

const API = C.API_ADMIN;
const card = { ...ui.card, padding: "16px 20px" };
const sourdine = { fontSize: 12, color: T.inkMute, lineHeight: 1.5 };
const thS = { ...ui.th, padding: "9px 10px" };
const tdS = { ...ui.td, fontSize: 12, padding: "9px 10px" };
const dt = (s) => (s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");
const pluriel = (n, mot, motPluriel = `${mot}s`) => `${nombre(n)} ${n > 1 ? motPluriel : mot}`;
const PLATEFORMES = { ios: "iPhone / iPad", android: "Android", ordinateur: "Ordinateur", autre: "Autre" };

const Erreur = ({ texte }) => (texte ? <div role="alert" style={{ ...ui.encart("danger"), display: "flex", gap: 6, alignItems: "flex-start" }}><Icone nom="alerte" taille={14} style={{ marginTop: 2, flexShrink: 0 }} /><span>{texte}</span></div> : null);
// options sur plusieurs lignes au besoin (téléphone) : jamais une option cachée par un défilement sans barre
const Segment = ({ options, valeur, onChange, etiquette }) => (
  <div className="ex-segment" role="group" aria-label={etiquette} style={{ maxWidth: "100%", flexWrap: "wrap", rowGap: 4, borderRadius: 16, alignSelf: "flex-start" }}>
    {options.map(([k, l]) => <button key={k} type="button" aria-pressed={valeur === k} onClick={() => onChange(k)}
      style={{ flexShrink: 1, minWidth: 0, whiteSpace: "normal", textAlign: "center", height: "auto", minHeight: 26, padding: "4px 12px", lineHeight: 1.3 }}>{l}</button>)}
  </div>
);
// grilles : une colonne sur téléphone (jamais plus large que la carte)
const grille = (min) => `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`;
const Bouton = ({ principal = false, children, style, ...reste }) => (
  <button type="button" className={principal ? "ex-btn-petrole" : "ex-btn-ligne"} style={{ ...ui.btn(principal ? "primaire" : "ligne", "m"), ...(principal ? {} : { background: undefined }), ...style }} {...reste}>{children}</button>
);
const Section = ({ id, titre, droite, children }) => (
  <section style={card} aria-labelledby={id}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <h3 id={id} style={{ ...ui.h2, margin: 0 }}>{titre}</h3>{droite}
    </div>
    {children}
  </section>
);
const Puce = ({ children, onRetirer, libelle }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.mint, color: T.teal, borderRadius: R.pill, padding: "3px 4px 3px 12px", fontSize: 12, fontWeight: 600 }}>
    {children}
    <button type="button" onClick={onRetirer} aria-label={libelle} title={libelle} className="ex-btn-discret" style={{ ...ui.rond(22), background: "transparent" }}><Icone nom="fermer" taille={12} /></button>
  </span>
);

// heure de Paris : avant 8 h, après 20 h ou le dimanche, l'envoi demande une confirmation de plus
function heureParis(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", weekday: "long", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const h = Number(p.hour);
  return { texte: `${p.hour} h ${p.minute}`, horsHeures: h < 8 || h >= 20 || p.weekday === "dimanche" };
}

export default function AdminNotifications({ adminFetch, flash, promos = [], sections = [], masques = [] }) {
  const api = useMemo(() => C.apiAdmin(adminFetch), [adminFetch]);
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState("");
  const [busy, setBusy] = useState(false);
  const appeler = useCallback(async (action, corps = {}) => {
    const r = await adminFetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...corps }) });
    const j = await r.json().catch(() => ({}));
    return { statut: r.status, ok: r.ok, corps: j };
  }, [adminFetch]);

  const charger = useCallback(async () => {
    setBusy(true); setErreur("");
    try {
      // banc d'essai local (npm run dev) : navigateur simulé, comme côté pharmacies — absent du build de production
      if (import.meta.env.DEV) {
        const conf = await C.lireConfig();
        if (conf.cle_publique === "BANC-FICTIVE") {
          const { navigateurBanc } = await import("../notifications/banc.js");
          C.installerNavigateur(navigateurBanc(new URLSearchParams(window.location.search).get("banc_push") || "auto"));
        }
      }
      const { sub } = await C.abonnementLocal();
      const e = await appeler("etat", sub ? { endpoint: sub.endpoint } : {});
      if (!e.ok) throw new Error(e.corps.message || e.corps.error || `HTTP ${e.statut}`);
      // abonnement local inconnu de toute identité (mort, retiré) : désinscrit, l'activation en prendra un nouveau
      if (sub && e.corps.appareil_inconnu === true) await C.oublierLocal(sub);
      setEtat(e.corps);
    } catch (err) { setErreur(`Lecture impossible\u00a0: ${err.message}`); }
    finally { setBusy(false); }
  }, [appeler]);
  useEffect(() => { charger(); }, [charger]);

  if (!etat) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {erreur ? <Erreur texte={erreur} /> : <div role="status" style={{ padding: 20, color: T.inkMute, fontSize: 13 }}>Chargement…</div>}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {etat.apercu && <div role="status" style={ui.encart("warn")}>Aperçu&nbsp;: aucune notification n'est envoyée, aucun réglage n'est enregistré.</div>}
      <p style={{ ...sourdine, margin: 0 }}>
        Notifications de l'appli Elixir&nbsp;: les pharmacies les activent sur leur téléphone ou leur ordinateur («&nbsp;Notifications&nbsp;» dans le menu, carte de l'accueil).
        «&nbsp;Retour en stock&nbsp;» part juste après l'e-mail de l'onglet «&nbsp;🔔 Alertes retour&nbsp;». L'e-mail reste la voie des informations importantes. Mode d'emploi&nbsp;: docs/notifications.md.
      </p>
      {erreur && <Erreur texte={erreur} />}
      {/* usage quotidien d'abord (nouveau message, historique) : sur téléphone, le composeur arrive sans défilement */}
      <Messages etat={etat} appeler={appeler} flash={flash} promos={promos} sections={sections} masques={masques} onEnvoye={charger} />
      <EtatService etat={etat} onActualiser={charger} busy={busy} />
      <Ouverture etat={etat} appeler={appeler} flash={flash} adminFetch={adminFetch} onEnregistre={(reglages) => setEtat((e) => ({ ...e, reglages }))} />
      <MesAppareils etat={etat} api={api} flash={flash} onChange={charger} />
      <Statistiques etat={etat} appeler={appeler} flash={flash} onChange={charger} />
    </div>
  );
}

// ── 1. État du service ──
function EtatService({ etat, onActualiser, busy }) {
  const s = etat.service || {};
  const lignes = [
    [s.vapid_publique, "Clé publique VAPID (VAPID_PUBLIC_KEY)", "Ajoutez VAPID_PUBLIC_KEY dans Netlify (docs/notifications.md, mise en service, étapes a et b)."],
    [s.vapid_privee, "Clé privée VAPID (VAPID_PRIVATE_KEY)", "Ajoutez VAPID_PRIVATE_KEY dans Netlify, en «\u00a0secret\u00a0» (étapes a et b)."],
    [s.vapid_paire, "Les deux clés vont ensemble", "Les deux clés doivent venir de la même génération\u00a0: régénérez-les ensemble et remplacez les deux."],
    [s.sujet, s.sujet_defaut ? "Adresse de contact (VAPID_SUBJECT absente\u00a0: mailto:pharmacien@elixirpharma.fr par défaut)" : `Adresse de contact (VAPID_SUBJECT\u00a0: ${etat.sujet_affiche || "?"})`,
      "VAPID_SUBJECT doit être «\u00a0mailto:pharmacien@elixirpharma.fr\u00a0»."],
    [s.cle_serveur, "Clé serveur Supabase (SUPABASE_SERVICE_ROLE_KEY)", "Déjà utilisée par l'Assistant Elixir\u00a0: vérifiez qu'elle est toujours dans Netlify."],
    [s.tables, "Tables créées (sql/push-schema.sql)", "Exécutez sql/push-schema.sql dans l'éditeur SQL de Supabase (étape c)."],
    [s.cron_secret, "Secret des envois (CRON_SECRET)", "Sans CRON_SECRET, les annonces ne peuvent pas partir (déjà en place pour l'assistant)."],
  ];
  return (
    <Section id="notif-service" titre="État du service" droite={<button onClick={onActualiser} disabled={busy} className="ex-btn-ligne" style={ui.btn("ligne", "s")}><Icone nom="actualiser" taille={14} />Actualiser</button>}>
      <div role="status" style={{ ...ui.encart(etat.disponible ? "ok" : "warn"), marginBottom: 12 }}>
        {etat.disponible ? "Service prêt\u00a0: les notifications peuvent être activées et envoyées." : "Service incomplet\u00a0: les pharmacies ne voient encore rien (ni carte, ni menu). Voir les points ci-dessous."}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: grille(320), gap: "6px 18px" }}>
        {lignes.map(([bon, libelle, aide]) => (
          <li key={libelle} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, lineHeight: 1.45 }}>
            <span aria-hidden="true" style={{ color: bon ? T.ok : T.danger, fontWeight: 700, width: 16, flexShrink: 0 }}>{bon ? "✓" : "✗"}</span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><span style={{ color: T.ink }}>{libelle}</span><span style={srOnly}>{bon ? "\u00a0: en place" : "\u00a0: à faire"}</span>
              {!bon && <span style={{ display: "block", color: T.inkSoft, fontSize: 12 }}>{aide}</span>}</span>
          </li>
        ))}
      </ul>
      {(etat.hotes_refuses || []).length > 0 && (
        <div style={{ ...ui.encart("warn"), marginTop: 12 }}>
          <b>Services push refusés</b> (adresse proposée par un navigateur, hors de la liste admise)&nbsp;: {etat.hotes_refuses.map((h) => `${h.hote} (${dt(h.vu_le)})`).join(", ")}.
          <span style={{ display: "block", fontSize: 12, marginTop: 4 }}>Les appareils concernés ne peuvent pas s'abonner. Si c'est un service légitime (Google, Apple, Mozilla, Microsoft…), l'équipe technique peut l'ajouter (src/notifications/regles.js, HOTES_PUSH).</span>
        </div>
      )}
    </Section>
  );
}
const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" };

// ── 2. Ouverture aux pharmacies ──
function Ouverture({ etat, appeler, flash, adminFetch, onEnregistre }) {
  const [form, setForm] = useState(etat.reglages);
  const [noms, setNoms] = useState(() => Object.fromEntries((etat.pharmacies || []).filter((p) => p.nom).map((p) => [p.cip, p.nom])));
  const [busy, setBusy] = useState(false);
  const [erreurs, setErreurs] = useState([]);
  useEffect(() => { setForm(etat.reglages); }, [etat.reglages]);
  const modifie = JSON.stringify(form) !== JSON.stringify(etat.reglages);
  const enregistrer = async () => {
    setBusy(true); setErreurs([]);
    try {
      const r = await appeler("reglages", { reglages: { ...form, plafond_offres_7j: Number(form.plafond_offres_7j), plafond_infos_7j: Number(form.plafond_infos_7j),
        plafond_commandes_jour: Number(form.plafond_commandes_jour) } });
      if (!r.ok) { setErreurs(r.corps.erreurs || [r.corps.message || r.corps.error || `HTTP ${r.statut}`]); return; }
      onEnregistre(r.corps.reglages);
      flash("✓ Ouverture des notifications enregistrée");
    } finally { setBusy(false); }
  };
  return (
    <Section id="notif-ouverture" titre="Ouverture aux pharmacies">
      <Segment etiquette="Ouverture" valeur={form.ouverture} onChange={(v) => setForm((f) => ({ ...f, ouverture: v }))}
        options={[["fermee", "Fermée (équipe Elixir)"], ["pilote", "Pilote"], ["toutes", "Toutes les pharmacies"]]} />
      <p style={{ ...sourdine, margin: "8px 0 0" }}>
        {form.ouverture === "fermee" ? "Les pharmacies ne voient rien\u00a0: seuls les appareils de l'équipe Elixir («\u00a0Vos appareils\u00a0», ci-dessous) reçoivent tests et aperçus."
          : form.ouverture === "pilote" ? "Seules les pharmacies choisies voient la carte de l'accueil et le menu «\u00a0Notifications\u00a0», et reçoivent les annonces."
          : "Toutes les pharmacies connectées voient la carte de l'accueil et le menu «\u00a0Notifications\u00a0»."}
      </p>
      {form.ouverture === "pilote" && (
        <div style={{ marginTop: 12 }}>
          <div style={ui.label}>Pharmacies du pilote ({form.pilote_cips.length})</div>
          {!form.pilote_cips.length ? <div style={sourdine}>Aucune pharmacie au pilote.</div> : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {form.pilote_cips.map((cip) => (
                <Puce key={cip} libelle={`Retirer ${noms[cip] || cip} du pilote`} onRetirer={() => setForm((f) => ({ ...f, pilote_cips: f.pilote_cips.filter((c) => c !== cip) }))}>
                  {noms[cip] ? `${noms[cip]} · ` : ""}CIP {cip}
                </Puce>
              ))}
            </div>
          )}
          <ChoixPharmacie adminFetch={adminFetch} deja={form.pilote_cips} onAjout={(p) => { setNoms((n) => ({ ...n, [p.cip]: p.name })); setForm((f) => ({ ...f, pilote_cips: [...f.pilote_cips, p.cip] })); }} />
        </div>
      )}
      {[["plafond_offres_7j", "Plafond des offres (Promotion)", 0, PLAFOND_MAX, "par pharmacie sur 7 jours glissants"],
        ["plafond_infos_7j", "Plafond des informations (Communication)", 0, PLAFOND_MAX, "par pharmacie sur 7 jours glissants"],
        ["plafond_commandes_jour", "Plafond de sécurité «\u00a0Mes commandes et réclamations\u00a0»", 1, PLAFOND_COMMANDES_MAX, "par pharmacie sur 24 heures"]].map(([k, l, min, max, apres], i) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: i ? 8 : 14 }}>
          <label htmlFor={`notif-${k}`} style={{ fontSize: 13, color: T.ink }}>{l}&nbsp;:</label>
          <input id={`notif-${k}`} type="number" min={min} max={max} step={1} value={form[k] ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? "" : Number(e.target.value) }))}
            style={{ ...ui.input, width: 70, minHeight: 34, padding: "5px 10px", textAlign: "center" }} />
          <span style={{ fontSize: 13, color: T.ink }}>{apres}</span>
        </div>
      ))}
      <p style={{ ...sourdine, margin: "4px 0 0" }}>Au-delà, la pharmacie concernée est écartée de l'envoi (l'estimation le dit avant). Les offres et les informations ont chacune leur plafond. Le plafond de sécurité arrête un emballement (outil entrepôt, double saisie)&nbsp;: les messages «&nbsp;Réclamation / SAV&nbsp;» et «&nbsp;Commande&nbsp;» ne comptent pas dans les plafonds des offres et des informations. Retour en stock n'est pas plafonné.</p>
      {erreurs.length > 0 && <div style={{ marginTop: 10 }}><Erreur texte={erreurs.join(" ")} /></div>}
      <div style={{ marginTop: 12 }}>
        <Bouton principal onClick={enregistrer} disabled={busy || !modifie} style={!modifie ? { background: T.sand, color: T.inkSoft, cursor: "default" } : undefined}>{busy ? "Enregistrement…" : "Enregistrer"}</Bouton>
      </div>
    </Section>
  );
}

// recherche d'une pharmacie cliente (admin-pharmacy-find) : CIP obligatoire (identité des notifications)
function ChoixPharmacie({ adminFetch, deja, onAjout }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const chercher = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setErr("");
    try {
      const r = await adminFetch(`/.netlify/functions/admin-pharmacy-find?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRes(Array.isArray(j.pharmacies) ? j.pharmacies : []);
    } catch (e) { setErr(e.message); setRes(null); }
    finally { setBusy(false); }
  };
  const inactif = busy || q.trim().length < 2;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chercher(); } }}
          placeholder="Nom, ville, CIP ou e-mail" aria-label="Rechercher une pharmacie"
          style={{ ...ui.input, minHeight: 36, flex: "1 1 220px", padding: "6px 14px", borderRadius: R.pill, fontSize: 13 }} />
        <Bouton principal onClick={chercher} disabled={inactif} style={inactif ? { background: T.sand, color: T.inkSoft, cursor: "not-allowed" } : undefined}>
          <Icone nom="recherche" taille={14} />{busy ? "Recherche…" : "Rechercher"}
        </Bouton>
      </div>
      {err && <div style={{ marginTop: 8 }}><Erreur texte={err} /></div>}
      {res && !res.length && <div style={{ ...sourdine, marginTop: 8 }}>Aucune pharmacie cliente d'Elixir ne correspond.</div>}
      {res && res.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 260, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          {res.map((p) => {
            const present = !!p.cip && deja.includes(p.cip);
            return (
              <div key={p.odoo_id || p.cip} className="ex-tr" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div className="num" style={{ fontSize: 11, color: T.inkSoft }}>{[p.city, p.cip ? `CIP ${p.cip}` : "sans CIP"].filter(Boolean).join(" · ")}</div>
                </div>
                {!p.cip ? <span style={ui.badge("warn")} title="Sans CIP dans Odoo&nbsp;: notifications impossibles pour cette fiche">sans CIP</span>
                  : <button type="button" onClick={() => onAjout(p)} disabled={present} className={present ? undefined : "ex-btn-ligne"} style={ui.btn("ligne", "s")}>{present ? "Déjà choisie" : "Ajouter"}</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 3. Vos appareils (rôle admin : tests et aperçus) ──
function MesAppareils({ etat, api, flash, onChange }) {
  const env = C.navigateur().env();
  const a = analyser(env);
  const p = parcoursDe(env, (etat.mes_appareils || []).some((d) => d.actuel));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [de, setDe] = useState(null);
  useEffect(() => { if (p === "activer" && etat.disponible) C.preparer().catch(() => {}); }, [p, etat.disponible]);
  const apres = async (r) => {
    if (r.etat === "abonne") { setMessage({ ton: "ok", texte: "Cet appareil reçoit désormais les tests et les aperçus." }); await onChange(); return; }
    if (r.etat === "autre_identite") { setDe(r.de || "un autre compte"); return; }
    setMessage({ ton: "danger", texte: r.etat === "refuse" ? "Notifications bloquées pour ce site\u00a0: autorisez-les dans les réglages du navigateur (cadenas à gauche de l'adresse)."
      : r.etat === "sans_reponse" ? "Vous n'avez pas répondu à la demande\u00a0: cliquez à nouveau puis «\u00a0Autoriser\u00a0»."
      : r.etat === "trop_d_appareils" ? "10 appareils admin au plus\u00a0: retirez-en un." : "L'activation n'a pas abouti sur cet appareil." });
  };
  const activer = async () => { setBusy(true); setMessage(null); try { await apres(await C.activer({ api })); } finally { setBusy(false); } };
  const remplacer = async () => { setBusy(true); setDe(null); try { await apres(await C.reactiver({ api, remplacer: true })); } finally { setBusy(false); } };
  const tester = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await C.envoyerTest({ api });
      setMessage(r.etat === "aucun" ? { ton: "warn", texte: "Aucun appareil\u00a0: activez d'abord cet appareil." }
        : r.etat === "ok" ? { ton: "ok", texte: `Test envoyé à ${pluriel(r.bilan?.envoyes || 0, "appareil")}${r.bilan?.echecs ? `, ${r.bilan.echecs} en échec` : ""}${r.bilan?.retires ? `, ${r.bilan.retires} retiré(s) (plus joignables)` : ""}. Rien reçu\u00a0? Vérifiez le mode Ne pas déranger ou Concentration, et que le navigateur (ou l'appli) a le droit d'afficher des notifications dans les réglages du téléphone ou de l'ordinateur\u00a0; sur ordinateur, le navigateur doit rester ouvert.` }
        : { ton: "danger", texte: "Test impossible pour le moment\u00a0: réessayez." });
    } finally { setBusy(false); }
  };
  const retirer = async (d) => {
    if (!window.confirm(`Retirer «\u00a0${d.appareil}\u00a0»\u00a0? Il ne recevra plus les tests ni les aperçus.`)) return;
    setBusy(true);
    try {
      if (d.actuel) await C.desactiver({ api }); else await C.retirerAppareil({ api, id: d.id });
      flash("✓ Appareil retiré"); await onChange();
    } finally { setBusy(false); }
  };
  const actuel = (etat.mes_appareils || []).some((d) => d.actuel);
  return (
    <Section id="notif-appareils" titre="Vos appareils (tests et aperçus)">
      <p style={{ ...sourdine, margin: "0 0 10px" }}>Cet appareil&nbsp;: {libelleAppareil(env)}. Vos appareils reçoivent les tests et les aperçus des annonces, jamais les notifications des pharmacies.</p>
      {!etat.disponible ? <div style={ui.encart("warn")}>Service incomplet&nbsp;: terminez la mise en service (ci-dessus) avant d'activer vos appareils.</div>
        : de ? (
          <div role="alert" style={{ ...ui.encart("warn"), display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 280px" }}>Cet appareil reçoit les notifications de {de}. Le passer sur votre compte admin&nbsp;?</span>
            <Bouton principal onClick={remplacer} disabled={busy}>Oui, pour l'admin</Bouton><Bouton onClick={() => setDe(null)}>Annuler</Bouton>
          </div>
        ) : actuel ? null
        // libellé long : passe à la ligne sur téléphone (375 px) au lieu de déborder de l'écran
        : p === "activer" ? <Bouton principal onClick={activer} disabled={busy} style={{ whiteSpace: "normal", height: "auto", minHeight: 40, maxWidth: "100%", textAlign: "left", lineHeight: 1.3, paddingTop: 8, paddingBottom: 8 }}>
          <Icone nom="cloche" taille={15} style={{ flexShrink: 0 }} />{busy ? "Activation…" : "Recevoir les notifications sur cet appareil"}</Bouton>
        : p === "installer_ios" ? (
          <div style={ui.encart("info")}>
            <b>Sur iPhone, installez l'appli «&nbsp;Elixir Admin&nbsp;»</b> depuis cette page&nbsp;: Safari → Partager → <b>Sur l'écran d'accueil</b> → Ajouter. Ouvrez ensuite l'icône
            «&nbsp;Elixir Admin&nbsp;», connectez-vous à l'admin, revenez dans 📲 Notifications et touchez «&nbsp;Recevoir les notifications sur cet appareil&nbsp;». iOS 16.4 ou plus récent.
          </div>
        ) : p === "refuse" ? <div style={ui.encart("warn")}>Notifications bloquées pour ce site sur cet appareil&nbsp;: autorisez-les dans les réglages du navigateur, puis actualisez.</div>
        : p === "maj_ios" ? <div style={ui.encart("warn")}>Cet iPhone doit passer à iOS 16.4 ou plus récent (Réglages → Général → Mise à jour logicielle).</div>
        : p === "ouvrir_safari" ? <div style={ui.encart("warn")}>Ouvrez cette page dans Safari pour installer l'appli «&nbsp;Elixir Admin&nbsp;».</div>
        : <div style={ui.encart("warn")}>Ce navigateur ne permet pas les notifications{a.ios ? "" : " (utilisez Chrome, Edge, Firefox ou Safari)"}.</div>}
      {message && <div role={message.ton === "danger" ? "alert" : "status"} style={{ ...ui.encart(message.ton), marginTop: 10 }}>{message.texte}</div>}
      {(etat.mes_appareils || []).length > 0 && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {etat.mes_appareils.map((d) => (
            <li key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.lineSoft}`, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{d.appareil}{d.actuel && <span style={ui.badge("info")}>Cet appareil</span>}
                  {d.en_echec && <span style={ui.badge("warn")}>ne répond plus</span>}</div>
                <div style={{ fontSize: 11.5, color: T.inkSoft }}>depuis le {dt(d.created_at)}{d.last_success_at ? ` · dernier envoi réussi le ${dt(d.last_success_at)}` : ""}</div>
              </div>
              <button type="button" onClick={() => retirer(d)} disabled={busy} className="ex-btn-ligne" aria-label={`Retirer ${d.appareil}`} style={ui.btn("ligne", "s")}>Retirer</button>
            </li>
          ))}
        </ul>
      )}
      {(etat.mes_appareils || []).length > 0 && <Bouton principal onClick={tester} disabled={busy} style={{ marginTop: 12 }}><Icone nom="envoyer" taille={15} />M'envoyer un test</Bouton>}
    </Section>
  );
}

// ── 4. Statistiques ──
function Statistiques({ etat, appeler, flash, onChange }) {
  const s = etat.stats || {};
  const [busy, setBusy] = useState(false);
  // demande d'effacement, appareil perdu ou vendu : tous les appareils de la pharmacie (elle pourra les réactiver) ;
  // demande d'effacement : son historique aussi (envois, événements de l'outil entrepôt, son nom dans les messages envoyés)
  const retirer = async (p) => {
    if (!window.confirm(`Retirer les ${pluriel(p.appareils, "appareil")} de «\u00a0${p.nom || `CIP ${p.cip}`}\u00a0»\u00a0?\n\nIls ne recevront plus aucune notification\u00a0; la pharmacie pourra les réactiver. À utiliser pour une demande d'effacement ou un appareil perdu.`)) return;
    const effacer = window.confirm(`Demande d'effacement\u00a0: effacer aussi l'historique de «\u00a0${p.nom || `CIP ${p.cip}`}\u00a0» (notifications reçues, événements de l'outil entrepôt, son nom dans les messages envoyés)\u00a0?\n\nOK\u00a0: tout effacer. Annuler\u00a0: retirer seulement les appareils.`);
    setBusy(true);
    try {
      const r = await appeler("retirer_pharmacie", { cip: p.cip, ...(effacer ? { effacer_historique: true } : {}) });
      flash(r.ok ? `✓ ${pluriel(r.corps.retires || 0, "appareil retiré", "appareils retirés")}${r.corps.historique_efface ? ", historique effacé" : ""}` : `⚠ Retrait impossible (${r.corps.error || r.statut})`);
      await onChange();
    } finally { setBusy(false); }
  };
  const tuiles = [
    [s.pharmacies, "pharmacies joignables"], [s.appareils, "appareils"], [s.installes, "en application installée"],
    [s.vus_30j, "vus ces 30 jours"], [s.en_echec, "ne répondent plus"],
  ];
  const [filtre, setFiltre] = useState("");
  const liste = (etat.pharmacies || []).filter((p) => !filtre || `${p.nom || ""} ${p.cip}`.toLowerCase().includes(filtre.toLowerCase()));
  return (
    <Section id="notif-stats" titre="Pharmacies joignables">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {tuiles.map(([n, l]) => (
          <div key={l} style={{ background: T.paper, border: `1px solid ${T.lineSoft}`, borderRadius: R.s, padding: "10px 12px" }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 700, color: T.petrol }}>{nombre(n)}</div>
            <div style={{ fontSize: 12, color: T.inkSoft }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, fontSize: 12.5, color: T.ink }}>
        <div><b>Par alerte</b> (pharmacies)&nbsp;: {Object.entries(CATS).map(([k, l]) => `${l} ${nombre(s.par_categorie?.[k])}`).join(" · ")}</div>
        <div><b>Par appareil</b>&nbsp;: {Object.entries(PLATEFORMES).map(([k, l]) => `${l} ${nombre(s.par_plateforme?.[k])}`).join(" · ")}</div>
      </div>
      {liste.length > 0 || filtre ? (
        <>
          <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer (nom ou CIP)" aria-label="Filtrer les pharmacies joignables"
            style={{ ...ui.input, minHeight: 34, maxWidth: 280, marginTop: 12, padding: "5px 12px", fontSize: 13, borderRadius: R.pill }} />
          <div style={{ overflowX: "auto", marginTop: 8, maxHeight: 320, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={thS}>Pharmacie</th><th style={thS}>CIP</th><th style={thS}>Appareils</th><th style={thS}>Alertes</th><th style={thS}><span style={srOnly}>Retrait</span></th></tr></thead>
              <tbody>
                {liste.map((p) => (
                  <tr key={p.cip} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={tdS}>{p.nom || "—"}</td>
                    <td className="num" style={tdS}>{p.cip}</td>
                    <td style={tdS}>{nombre(p.appareils)} ({p.plateformes.map((x) => PLATEFORMES[x] || x).join(", ")}){p.en_echec ? <span style={{ color: tone("warn").fg }}> · {p.en_echec} ne répond plus</span> : ""}</td>
                    <td style={tdS}>{p.categories.map((c) => CATS[c] || c).join(", ") || "aucune"}</td>
                    <td style={{ ...tdS, textAlign: "right" }}>
                      <button type="button" onClick={() => retirer(p)} disabled={busy} className="ex-btn-ligne" aria-label={`Retirer les appareils de ${p.nom || `la pharmacie ${p.cip}`}`}
                        style={ui.btn("ligne", "s")}>Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p style={{ ...sourdine, margin: "10px 0 0" }}>Aucune pharmacie n'a encore activé les notifications.</p>}
    </Section>
  );
}
