import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T, R, ui, tone } from "../theme.js";
import { Icone } from "../icons.jsx";
import * as C from "../notifications/client.js";
import { analyser, libelleAppareil, parcours as parcoursDe } from "../notifications/plateforme.js";
import { LIMITES, TITRE_CONSEILLE, LIBELLES_OUTILS, OUTILS_LIEN, PLAFOND_MAX, lienValide, longueur } from "../notifications/regles.js";

// ── Admin : notifications de l'appli (onglet « 🔔 Notifications », docs/notifications.md) ──
// État du service (sans aucune valeur de clé), ouverture aux pharmacies (fermée / pilote / toutes) et plafond des offres,
// appareils de l'admin (tests et aperçus : rôle admin, jamais au nom d'une pharmacie), statistiques, nouvelle annonce
// « Offres et nouveautés » avec aperçus Android et iPhone, historique. API : netlify/functions/push-admin.js (verifyAdmin).
// Chargé avec l'admin (chunk AdminPanel) : hors du bundle des pharmacies.

const API = C.API_ADMIN;
const card = { ...ui.card, padding: "16px 20px" };
const sourdine = { fontSize: 12, color: T.inkMute, lineHeight: 1.5 };
const thS = { ...ui.th, padding: "9px 10px" };
const tdS = { ...ui.td, fontSize: 12, padding: "9px 10px" };
const dt = (s) => (s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");
const pluriel = (n, mot, motPluriel = `${mot}s`) => `${nombre(n)} ${n > 1 ? motPluriel : mot}`;
const nouvelleCle = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const CATS = { stock: "Retour en stock", commandes: "Mes commandes", offres: "Offres et nouveautés" };
const PLATEFORMES = { ios: "iPhone / iPad", android: "Android", ordinateur: "Ordinateur", autre: "Autre" };
const STATUTS = { en_file: ["En file", "warn"], en_cours: ["En cours", "info"], envoyee: ["Envoyée", "ok"], erreur: ["Erreur", "danger"] };

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
  const [historique, setHistorique] = useState(null);
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
      const [e, h] = await Promise.all([appeler("etat", sub ? { endpoint: sub.endpoint } : {}), appeler("historique")]);
      if (!e.ok) throw new Error(e.corps.message || e.corps.error || `HTTP ${e.statut}`);
      // abonnement local inconnu de toute identité (mort, retiré) : désinscrit, l'activation en prendra un nouveau
      if (sub && e.corps.appareil_inconnu === true) await C.oublierLocal(sub);
      setEtat(e.corps);
      setHistorique(h.ok ? h.corps.annonces || [] : []);
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
        L'e-mail reste la voie des informations importantes. Mode d'emploi&nbsp;: docs/notifications.md.
      </p>
      {erreur && <Erreur texte={erreur} />}
      <EtatService etat={etat} onActualiser={charger} busy={busy} />
      <Ouverture etat={etat} appeler={appeler} flash={flash} adminFetch={adminFetch} onEnregistre={(reglages) => setEtat((e) => ({ ...e, reglages }))} />
      <MesAppareils etat={etat} api={api} flash={flash} onChange={charger} />
      <Statistiques etat={etat} appeler={appeler} flash={flash} onChange={charger} />
      <Annonce etat={etat} appeler={appeler} flash={flash} promos={promos} sections={sections} masques={masques} onEnvoyee={charger} />
      <Historique annonces={historique} appeler={appeler} flash={flash} onChange={charger} promos={promos} sections={sections} />
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
      const r = await appeler("reglages", { reglages: { ...form, plafond_offres_7j: Number(form.plafond_offres_7j) } });
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <label htmlFor="notif-plafond" style={{ fontSize: 13, color: T.ink }}>Plafond des offres&nbsp;:</label>
        <input id="notif-plafond" type="number" min={0} max={PLAFOND_MAX} step={1} value={form.plafond_offres_7j}
          onChange={(e) => setForm((f) => ({ ...f, plafond_offres_7j: e.target.value === "" ? "" : Number(e.target.value) }))}
          style={{ ...ui.input, width: 70, minHeight: 34, padding: "5px 10px", textAlign: "center" }} />
        <span style={{ fontSize: 13, color: T.ink }}>par pharmacie sur 7 jours glissants</span>
      </div>
      <p style={{ ...sourdine, margin: "4px 0 0" }}>Les annonces «&nbsp;Offres et nouveautés&nbsp;» au-delà sont écartées pour la pharmacie concernée. Retour en stock et commandes ne sont pas plafonnés.</p>
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
        : p === "activer" ? <Bouton principal onClick={activer} disabled={busy}><Icone nom="cloche" taille={15} />{busy ? "Activation…" : "Recevoir les notifications sur cet appareil"}</Bouton>
        : p === "installer_ios" ? (
          <div style={ui.encart("info")}>
            <b>Sur iPhone, installez l'appli «&nbsp;Elixir Admin&nbsp;»</b> depuis cette page&nbsp;: Safari → Partager → <b>Sur l'écran d'accueil</b> → Ajouter. Ouvrez ensuite l'icône
            «&nbsp;Elixir Admin&nbsp;», connectez-vous à l'admin, revenez dans 🔔 Notifications et touchez «&nbsp;Recevoir les notifications sur cet appareil&nbsp;». iOS 16.4 ou plus récent.
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
  // demande d'effacement, appareil perdu ou vendu : tous les appareils de la pharmacie (elle pourra les réactiver)
  const retirer = async (p) => {
    if (!window.confirm(`Retirer les ${pluriel(p.appareils, "appareil")} de «\u00a0${p.nom || `CIP ${p.cip}`}\u00a0»\u00a0?\n\nIls ne recevront plus aucune notification\u00a0; la pharmacie pourra les réactiver. À utiliser pour une demande d'effacement ou un appareil perdu.`)) return;
    setBusy(true);
    try {
      const r = await appeler("retirer_pharmacie", { cip: p.cip });
      flash(r.ok ? `✓ ${pluriel(r.corps.retires || 0, "appareil retiré", "appareils retirés")}` : `⚠ Retrait impossible (${r.corps.error || r.statut})`);
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

// ── 5. Nouvelle annonce « Offres et nouveautés » ──
const TYPES_LIEN = [["accueil", "Accueil"], ["promo", "Menu promo"], ["menu", "Menu du catalogue"], ["outil", "Outil"], ["produit", "Produit (CIP)"]];
function cheminDe(type, valeur) {
  if (type === "accueil") return "/";
  if (type === "promo" || type === "menu") return valeur ? `/?menu=${valeur}` : "";
  if (type === "outil") return valeur ? `/?outil=${valeur}` : "";
  if (type === "produit") return valeur ? `/?cip=${String(valeur).replace(/\D/g, "")}` : "";
  return "";
}
// Brouillon gardé pour l'onglet (sessionStorage) : toucher l'aperçu sur le même appareil, ou recharger, ne perd rien
const CLE_BROUILLON = "notif_brouillon_annonce";
function lireBrouillon() {
  try { const b = JSON.parse(sessionStorage.getItem(CLE_BROUILLON) || "null"); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}
const TYPES_IDS = ["accueil", "promo", "menu", "outil", "produit"];
function Annonce({ etat, appeler, flash, promos, sections, masques = [], onEnvoyee }) {
  const [b0] = useState(lireBrouillon);
  const texteDe = (v) => (typeof v === "string" ? v : "");
  const [titre, setTitre] = useState(texteDe(b0.titre));
  const [corps, setCorps] = useState(texteDe(b0.corps));
  const [typeLien, setTypeLien] = useState(TYPES_IDS.includes(b0.typeLien) ? b0.typeLien : "accueil");
  const [valeurLien, setValeurLien] = useState(texteDe(b0.valeurLien));
  const [audience, setAudience] = useState(b0.audience === "liste" ? "liste" : "toutes");
  const [cips, setCips] = useState(Array.isArray(b0.cips) ? b0.cips.filter((c) => typeof c === "string").slice(0, 500) : []);
  useEffect(() => {
    const brouillon = { titre, corps, typeLien, valeurLien, audience, cips };
    try {
      if (titre || corps) sessionStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
      else sessionStorage.removeItem(CLE_BROUILLON);
    } catch { /* stockage refusé : pas de brouillon */ }
  }, [titre, corps, typeLien, valeurLien, audience, cips]);
  const [filtre, setFiltre] = useState("");
  const [estimation, setEstimation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const idem = useRef(nouvelleCle());   // une clé par annonce : un double clic ou une réponse perdue n'envoie jamais deux fois
  const chemin = cheminDe(typeLien, valeurLien);
  const lien = lienValide(chemin);
  // seulement ce qu'une pharmacie peut ouvrir (menus masqués dans « Affichage » : le lien retomberait sur l'accueil)
  const promosActifs = promos.filter((p) => p.active && !masques.includes(`promo_${p.id}`));
  const menus = sections.filter((s) => !String(s.key).startsWith("promo_") && !masques.includes(s.key));
  const nbMasques = sections.filter((s) => masques.includes(s.key)).length;
  const nT = longueur(titre.trim()), nC = longueur(corps.trim());
  const valide = nT > 0 && nT <= LIMITES.titre && nC > 0 && nC <= LIMITES.corps && !!lien && (audience === "toutes" || cips.length > 0);
  const abonnesOffres = (etat.pharmacies || []).filter((p) => p.categories.includes("offres"));

  // estimation en direct des destinataires (lecture seule), 400 ms après le dernier changement
  useEffect(() => {
    if (!etat.disponible) return undefined;
    let annule = false;
    const t = setTimeout(async () => {
      const r = await appeler("estimer", { audience, cips }).catch(() => null);
      if (!annule) setEstimation(r?.ok ? r.corps : null);
    }, 400);
    return () => { annule = true; clearTimeout(t); };
  }, [audience, cips, appeler, etat.disponible]);

  const annonce = { titre: titre.trim(), corps: corps.trim(), url: lien || "/", audience, cips: audience === "liste" ? cips : null };
  const apercu = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await appeler("apercu", { annonce });
      setMessage(!r.ok ? { ton: "danger", texte: (r.corps.erreurs || [r.corps.message || r.corps.error || `HTTP ${r.statut}`]).join(" ") }
        : r.corps.aucun ? { ton: "warn", texte: "Aucun de vos appareils n'est activé\u00a0: voir «\u00a0Vos appareils\u00a0» ci-dessus." }
        : { ton: "ok", texte: `Aperçu envoyé à ${pluriel(r.corps.envoyes, "appareil")}${r.corps.echecs ? ` (${r.corps.echecs} en échec)` : ""}.` });
    } finally { setBusy(false); }
  };
  const recevront = estimation?.recevront ?? 0;
  const envoyer = async () => {
    const h = heureParis();
    if (!window.confirm(`Envoyer «\u00a0${annonce.titre}\u00a0» à ${pluriel(recevront, "pharmacie")} maintenant\u00a0?\n\nCe n'est pas annulable.`)) return;
    if (h.horsHeures && !window.confirm(`Il est ${h.texte} (heure de Paris)\u00a0: les pharmacies la recevront tout de suite, sur leur téléphone. Envoyer quand même\u00a0?`)) return;
    setBusy(true); setMessage(null);
    try {
      const r = await appeler("envoyer", { annonce, idem: idem.current });
      if (r.statut === 202 || (r.ok && r.corps.deja)) {
        flash("✓ Annonce partie\u00a0: suivez son envoi dans l'historique");
        idem.current = nouvelleCle();
        setTitre(""); setCorps(""); setMessage({ ton: "ok", texte: r.corps.deja ? "Cette annonce était déjà partie (double clic)\u00a0: rien n'a été envoyé deux fois." : "Annonce partie\u00a0: l'envoi prend quelques secondes à quelques minutes (historique ci-dessous)." });
        await onEnvoyee();
        return;
      }
      setMessage({ ton: "danger", texte: r.corps.error === "en_cours" ? "Une annonce est en cours d'envoi\u00a0: attendez qu'elle soit terminée."
        : r.corps.error === "fermee" ? "Ouverture «\u00a0fermée\u00a0»\u00a0: aucune pharmacie ne reçoit encore les annonces (voir «\u00a0Ouverture aux pharmacies\u00a0»)."
        : r.corps.error === "lancement" ? "L'annonce est enregistrée mais l'envoi n'a pas démarré\u00a0: utilisez «\u00a0Relancer\u00a0» dans l'historique dans 2 minutes."
        : r.corps.error === "configuration" ? "Service incomplet\u00a0: terminez la mise en service." : (r.corps.erreurs || [r.corps.message || `Erreur (HTTP ${r.statut})`]).join(" ") });
      if (r.corps.error === "lancement") await onEnvoyee();
    } finally { setBusy(false); }
  };

  const champ = { ...ui.input, fontSize: 13 };
  return (
    <Section id="notif-annonce" titre="Nouvelle annonce — Offres et nouveautés">
      {!etat.disponible && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>Service incomplet&nbsp;: l'annonce ne peut pas partir.</div>}
      <div style={{ display: "grid", gridTemplateColumns: grille(320), gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div>
            <label htmlFor="notif-titre-annonce" style={ui.label}>Titre</label>
            <input id="notif-titre-annonce" value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={LIMITES.titre + 10} placeholder="Vaseline&nbsp;: précommande ouverte" style={champ} />
            <Compteur n={nT} max={LIMITES.titre} conseil={nT > TITRE_CONSEILLE ? "peut être coupé sur Android" : null} />
          </div>
          <div>
            <label htmlFor="notif-texte-annonce" style={ui.label}>Texte</label>
            <textarea id="notif-texte-annonce" value={corps} onChange={(e) => setCorps(e.target.value)} rows={3} placeholder="13 références à prix net jusqu'au 31/10."
              style={{ ...champ, resize: "vertical", lineHeight: 1.45 }} />
            <Compteur n={nC} max={LIMITES.corps} />
            <div style={sourdine}>Jamais de donnée de patient, de montant de facture ni de solde&nbsp;: la notification s'affiche sur l'écran verrouillé.</div>
          </div>
          <div>
            <div style={ui.label}>Lien (ouvert au toucher)</div>
            <Segment etiquette="Type de lien" valeur={typeLien} onChange={(v) => { setTypeLien(v); setValeurLien(""); }} options={TYPES_LIEN} />
            <div style={{ marginTop: 8 }}>
              {typeLien === "promo" && (promosActifs.length ? (
                <select value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} aria-label="Menu promo" style={champ}>
                  <option value="">Choisir un menu promo…</option>
                  {promosActifs.map((p) => <option key={p.id} value={`promo_${p.id}`}>{p.icon ? `${p.icon} ` : ""}{p.name}</option>)}
                </select>) : <div style={sourdine}>Aucun menu promo actif.</div>)}
              {typeLien === "menu" && (
                <select value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} aria-label="Menu du catalogue" style={champ}>
                  <option value="">Choisir un menu…</option>
                  {menus.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>)}
              {(typeLien === "menu" || typeLien === "promo") && nbMasques > 0 && <div style={{ ...sourdine, marginTop: 4 }}>{pluriel(nbMasques, "menu masqué", "menus masqués")} aux pharmacies (Affichage)&nbsp;: non proposé{nbMasques > 1 ? "s" : ""}.</div>}
              {typeLien === "outil" && (
                <select value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} aria-label="Outil" style={champ}>
                  <option value="">Choisir un outil…</option>
                  {OUTILS_LIEN.map((o) => <option key={o} value={o}>{LIBELLES_OUTILS[o]}</option>)}
                </select>)}
              {typeLien === "produit" && (
                <input value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} inputMode="numeric" placeholder="CIP13 (ou CIP7)" aria-label="CIP du produit" style={champ} />)}
              <div className="num" style={{ ...sourdine, marginTop: 4 }}>
                {lien ? <>Page&nbsp;: <b style={{ color: T.ink }}>{lien}</b></> : chemin ? <span style={{ color: T.danger }}>Lien refusé (CIP de 7 à 14 chiffres, menu ou outil du site)</span> : "Choisissez la page à ouvrir."}
              </div>
            </div>
          </div>
          <div>
            <div style={ui.label}>Destinataires</div>
            <Segment etiquette="Destinataires" valeur={audience} onChange={setAudience} options={[["toutes", "Toutes les pharmacies abonnées aux offres"], ["liste", "Pharmacies choisies"]]} />
            {audience === "liste" && (
              <div style={{ marginTop: 8 }}>
                {cips.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {cips.map((c) => <Puce key={c} libelle={`Retirer ${c}`} onRetirer={() => setCips((l) => l.filter((x) => x !== c))}>{abonnesOffres.find((p) => p.cip === c)?.nom || "CIP"} · {c}</Puce>)}
                </div>}
                <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer les pharmacies abonnées aux offres" aria-label="Filtrer les pharmacies"
                  style={{ ...champ, borderRadius: R.pill, minHeight: 34, padding: "5px 12px" }} />
                <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 6, border: `1px solid ${T.line}`, borderRadius: R.s }}>
                  {abonnesOffres.filter((p) => !filtre || `${p.nom || ""} ${p.cip}`.toLowerCase().includes(filtre.toLowerCase())).map((p) => (
                    <label key={p.cip} className="ex-tr" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", fontSize: 13, borderBottom: `1px solid ${T.lineSoft}`, cursor: "pointer" }}>
                      <input type="checkbox" checked={cips.includes(p.cip)} onChange={(e) => setCips((l) => (e.target.checked ? [...l, p.cip] : l.filter((x) => x !== p.cip)))} />
                      <span style={{ flex: 1 }}>{p.nom || "—"}</span><span className="num" style={{ color: T.inkMute, fontSize: 12 }}>{p.cip}</span>
                    </label>
                  ))}
                  {!abonnesOffres.length && <div style={{ ...sourdine, padding: 10 }}>Aucune pharmacie abonnée aux offres.</div>}
                </div>
              </div>
            )}
            <div role="status" style={{ ...sourdine, marginTop: 8, color: T.ink }}>
              {estimation == null ? "Estimation…" : estimation.fermee ? "Ouverture «\u00a0fermée\u00a0»\u00a0: aucune pharmacie ne recevra l'annonce."
                : <>{pluriel(estimation.recevront, "pharmacie")} ({pluriel(estimation.appareils, "appareil")}){estimation.plafonnees ? `\u00a0; ${pluriel(estimation.plafonnees, "pharmacie")} déjà à ${estimation.plafond_offres_7j} offre${estimation.plafond_offres_7j > 1 ? "s" : ""} ces 7 jours, écartée${estimation.plafonnees > 1 ? "s" : ""}` : ""}.</>}
            </div>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={ui.label}>Aperçu</div>
          <div style={{ display: "grid", gridTemplateColumns: grille(250), gap: 12 }}>
            <ApercuAndroid titre={annonce.titre} corps={annonce.corps} />
            <ApercuIphone titre={annonce.titre} corps={annonce.corps} />
          </div>
          <p style={{ ...sourdine, margin: "8px 0 0" }}>Coupures simulées&nbsp;: titre sur une ligne et texte sur deux lignes sous Android (notification repliée), texte sur quatre lignes sur iPhone.</p>
        </div>
      </div>
      {message && <div role={message.ton === "danger" ? "alert" : "status"} style={{ ...ui.encart(message.ton), marginTop: 12 }}>{message.texte}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <Bouton onClick={apercu} disabled={busy || !valide || !etat.disponible}><Icone nom="envoyer" taille={15} />M'envoyer l'aperçu</Bouton>
        <Bouton principal onClick={envoyer} disabled={busy || !valide || !etat.disponible || !recevront || estimation?.fermee}
          style={busy || !valide || !etat.disponible || !recevront || estimation?.fermee ? { background: T.sand, color: T.inkSoft, cursor: "not-allowed" } : undefined}>
          {busy ? "Envoi…" : `Envoyer à ${pluriel(recevront, "pharmacie")}`}
        </Bouton>
      </div>
    </Section>
  );
}
const Compteur = ({ n, max, conseil }) => (
  <div className="num" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, marginTop: 3, color: n > max ? T.danger : T.inkMute }}>
    <span style={{ color: tone("warn").fg }}>{conseil || ""}</span><span>{n}/{max}</span>
  </div>
);

// Aperçus : Android (volet des notifications, repliée) et iPhone (écran verrouillé)
const clamp = (lignes) => ({ display: "-webkit-box", WebkitLineClamp: lignes, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" });
const ICONE = "/icones/elixir-192.png";
export function ApercuAndroid({ titre, corps }) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ background: "#1f2427", borderRadius: 18, padding: 10 }}>
        <div style={{ background: "#2d3236", color: "#e8eaed", borderRadius: 14, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
          fontFamily: "Roboto, system-ui, sans-serif" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#bdc1c6" }}>
              <img src="/icones/badge-96.png" alt="" width="14" height="14" style={{ filter: "none" }} /><span>Elixir</span><span>· maintenant</span>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 4, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titre || "Titre de l'annonce"}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.35, marginTop: 1, color: "#d2d5d9", ...clamp(2) }}>{corps || "Texte de l'annonce."}</div>
          </div>
          <img src={ICONE} alt="" width="36" height="36" style={{ borderRadius: 8, flexShrink: 0 }} />
        </div>
      </div>
      <figcaption style={{ ...sourdine, marginTop: 4, textAlign: "center" }}>Android, application installée (sinon&nbsp;: «&nbsp;Chrome · elixir-commande.expepharma.com&nbsp;»)</figcaption>
    </figure>
  );
}
export function ApercuIphone({ titre, corps }) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ background: "linear-gradient(160deg, #335a6b 0%, #0f2d3d 55%, #b5904a 140%)", borderRadius: 18, padding: "18px 10px 12px" }}>
        <div style={{ textAlign: "center", color: "rgba(255,255,255,.92)", fontFamily: "-apple-system, system-ui, sans-serif", fontSize: 30, fontWeight: 600, lineHeight: 1, marginBottom: 12 }}>9:41</div>
        <div style={{ background: "rgba(245,245,245,.78)", backdropFilter: "blur(12px)", borderRadius: 16, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
          fontFamily: "-apple-system, system-ui, sans-serif", color: "#111" }}>
          <img src={ICONE} alt="" width="34" height="34" style={{ borderRadius: 8, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, ...clamp(1) }}>{titre || "Titre de l'annonce"}</span>
              <span style={{ fontSize: 11.5, color: "#555", flexShrink: 0 }}>maintenant</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.3, marginTop: 1, ...clamp(4) }}>{corps || "Texte de l'annonce."}</div>
          </div>
        </div>
      </div>
      <figcaption style={{ ...sourdine, marginTop: 4, textAlign: "center" }}>iPhone (écran verrouillé)</figcaption>
    </figure>
  );
}

// ── 6. Historique ──
// lien d'une annonce en clair : « Menu promo : Vaseline », « Outil : Saisie de commande »… (chemin brut en infobulle)
function libelleLien(url, promos = [], sections = []) {
  if (url === "/") return "Accueil";
  const m = /^\/\?(menu|outil|cip|notifications)=(.+)$/.exec(String(url || ""));
  if (!m) return String(url || "");
  if (m[1] === "menu") {
    const p = promos.find((x) => `promo_${x.id}` === m[2]);
    if (p) return `Menu promo\u00a0: ${p.name}`;
    const s = sections.find((x) => x.key === m[2]);
    return s ? `Menu\u00a0: ${s.label}` : `Menu ${m[2]}`;
  }
  if (m[1] === "outil") return `Outil\u00a0: ${LIBELLES_OUTILS[m[2]] || m[2]}`;
  if (m[1] === "cip") return `Produit (CIP ${m[2]})`;
  return "Panneau «\u00a0Notifications\u00a0»";
}
const RELANCE_MAX_MS = 24 * 3600e3;
const ERREURS_RELANCE = { trop_tot: "⚠ Attendez 2 minutes avant de relancer", trop_ancienne: "⚠ Annonce de plus de 24 h\u00a0: recomposez-la plutôt que de la relancer",
  en_cours: "⚠ Une autre annonce est en cours d'envoi\u00a0: relancez quand elle sera terminée" };
function Historique({ annonces, appeler, flash, onChange, promos = [], sections = [] }) {
  const [busy, setBusy] = useState(false);
  const relancer = async (a) => {
    setBusy(true);
    try {
      const r = await appeler("relancer", { id: a.id });
      flash(r.statut === 202 ? "✓ Envoi relancé" : ERREURS_RELANCE[r.corps.error] || `⚠ Relance impossible (${r.corps.error || r.statut})`);
      await onChange();
    } finally { setBusy(false); }
  };
  return (
    <Section id="notif-historique" titre="Historique des annonces">
      {annonces == null ? <div role="status" style={sourdine}>Chargement…</div> : !annonces.length ? <p style={{ ...sourdine, margin: 0 }}>Aucune annonce envoyée.</p> : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={thS}>Date</th><th style={thS}>Annonce</th><th style={thS}>Lien</th><th style={thS}>Destinataires</th>
              <th style={thS} title="visées / écartées par le plafond / servies">Pharmacies</th><th style={thS} title="réussis / échecs / retirés">Appareils</th><th style={thS}>Statut</th>
            </tr></thead>
            <tbody>
              {annonces.map((a) => {
                const [l, t] = STATUTS[a.statut] || [a.statut, "neutral"];
                const age = Date.now() - Date.parse(a.created_at);
                const relancable = a.statut === "en_file" && age >= 2 * 60e3 && age <= RELANCE_MAX_MS;
                return (
                  <tr key={a.id} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                    <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}>{dt(a.created_at)}</td>
                    <td style={{ ...tdS, maxWidth: 280 }}><b>{a.titre}</b><div style={{ color: T.inkSoft, overflowWrap: "anywhere" }}>{a.corps}</div></td>
                    <td style={{ ...tdS, overflowWrap: "anywhere", minWidth: 120 }} title={a.url}>{libelleLien(a.url, promos, sections)}</td>
                    <td style={tdS}>{a.audience === "liste" ? `${pluriel(a.nb_cips || 0, "pharmacie choisie", "pharmacies choisies")}` : "toutes"}</td>
                    <td className="num" style={tdS}>{a.nb_visees ?? "–"} / {a.nb_plafonnees ?? "–"} / {a.nb_pharmacies ?? "–"}</td>
                    <td className="num" style={tdS}>{a.nb_reussis ?? "–"} / {a.nb_echecs ?? "–"} / {a.nb_retires ?? "–"}</td>
                    <td style={tdS}>
                      <span style={ui.badge(t)}>{l}</span>
                      {a.erreur && <div style={{ color: T.danger, marginTop: 4 }}>{a.erreur}</div>}
                      {relancable && <button type="button" onClick={() => relancer(a)} disabled={busy} className="ex-btn-ligne" style={{ ...ui.btn("ligne", "s"), marginTop: 6 }}>Relancer</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ ...sourdine, margin: "8px 0 0" }}>Pharmacies&nbsp;: visées / écartées par le plafond / servies (au moins un appareil joint). Appareils&nbsp;: réussis / échecs / retirés (plus joignables).</p>
    </Section>
  );
}
