import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { priceOrder, priceLine, objectiveProgress, objectiveContribution, objectiveIsAdditive, objectiveFrom, sumSlots, parisToday, ugFor, allocateFree, freeBySlot, slotOrder, invoiceDiscount, packCheck, packIssues, packLabel, IMMEDIATE_SLOT, round2 } from "../gp-pricing.js";
import { analyzeFile } from "../gp-files.js";
import { T, R, ui, tone, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";
import EnteteVue from "./ui/EnteteVue.jsx";
import EtatVide, { ActionEtat, Chargement } from "./ui/EtatVide.jsx";

// Affichage seulement (lot 8) : format français commun de src/theme.js (« 1 234,50 € », espace insécable avant € et %) ;
// les montants enregistrés (gp-pharmacy, gp-admin) sont calculés par gp-pricing et ne passent pas par ces fonctions.
const eur = (n) => fmtEur(n || 0);
const pct = (n) => `${round2(n || 0).toLocaleString("fr-FR")}\u00a0%`;
const dfr = (d, opts = { day: "numeric", month: "long" }) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("fr-FR", opts) : "";
const dts = (t) => t ? new Date(t).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" }) : "";
const daysLeft = (d) => Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(parisToday() + "T12:00:00Z")) / 86400e3);

// ── Refonte charte (lot 7) : atomes de theme.js au lieu des copies locales ; écran partagé avec l'admin (saisie d'une
// participante : AdminGroupPurchases). Calculs (gp-pricing), enregistrement, focus de retour et protection avant de
// quitter inchangés. Boutons : fond et survol par les classes ex-btn-petrole (action) / ex-btn-ligne (secondaire) ;
// un bouton indisponible passe en sable (style inline, qui l'emporte sur la classe).
const card = ui.card;
const h2 = ui.h2;
const btn = (primary) => ({ ...ui.btn(primary ? "primaire" : "ligne", "m"), height: 40, padding: "0 18px", background: undefined, color: primary ? undefined : T.ink,
  ...(primary ? {} : { boxShadow: `inset 0 0 0 1.5px ${T.lineField}` }) });
const btnClasse = (primary) => primary ? "ex-btn-petrole" : "ex-btn-ligne";
const btnInactif = { background: T.sand, color: T.inkSoft, boxShadow: "none", cursor: "not-allowed" };
// condition (remise, palier, UG) : pastille ok quand elle s'applique, neutre sinon
const chip = (on) => { const t = tone(on ? "ok" : "neutral");
  return { display: "inline-block", fontSize: 11, fontWeight: 700, lineHeight: 1.4, borderRadius: R.pill, padding: "2px 8px", margin: "2px 4px 2px 0",
    background: t.bg, color: t.fg, border: `1px solid ${on ? t.border : "transparent"}`, fontVariantNumeric: "tabular-nums" }; };
const PHASE = { ouverte: "Ouverte aux commandes", a_venir: "Pas encore ouverte", cloturee: "Clôturée", commandee: "Commandée au laboratoire", terminee: "Terminée" };
const hasQty = (grid) => Object.values(grid || {}).some(s => Object.values(s || {}).some(q => Number(q) > 0));

// Onglet « Commandes groupées » côté pharmacie.
// admin = { call(body) → réponse gp-admin, opId, participantId, onSaved } : même écran utilisé par
// l'admin pour saisir la commande d'une participante (Elixir pour son stock, ou une pharmacie).
// icone, couleur : icône et couleur du menu (App), pour l'en-tête de vue (pharmacie seulement)
// fetchAuth : appel avec le jeton de la pharmacie, renouvelé s'il a expiré (appelAuthentifie d'App ; correctif de sécurité
// du 19/10/2026 : gp-pharmacy et gp-upload exigent un jeton, l'adresse e-mail envoyée ne désigne plus la pharmacie)
export default function GroupOrders({ pharmacyCip, pharmacyEmail, onDirtyChange, admin = null, icone, couleur, fetchAuth = fetch }) {
  const [ops, setOps] = useState(null);
  const [selId, setSelId] = useState(null);
  const [view, setView] = useState(null);
  const [grid, setGrid] = useState({});        // { lineId: { slotId: qty } }
  const [dirty, setDirty] = useState(false);
  const [source, setSource] = useState({ source: "formulaire", file_name: null });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);         // { type: ok|err|info, text }
  const [imp, setImp] = useState(null);         // résultat d'import LGO
  const fileRef = useRef(null);
  const reqRef = useRef(0);
  const [stale, setStale] = useState(false);   // commande modifiée ailleurs : recharger
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const call = useCallback(async (fn, body) => {
    const r = await fetchAuth(`/.netlify/functions/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cip: pharmacyCip, email: pharmacyEmail, ...body }) });
    const j = await r.json().catch(() => ({}));
    // session expirée ou compte sans fiche : le serveur donne un message lisible (« reconnexion », « fiche » sont des codes)
    if (!r.ok) throw new Error(j.message || j.error || `Erreur ${r.status}`);
    return j;
  }, [fetchAuth, pharmacyCip, pharmacyEmail]);
  const adminCall = admin?.call, adminOp = admin?.opId, adminPart = admin?.participantId;
  const api = useCallback((body) => adminCall
    ? adminCall({ ...body, action: body.action === "save" ? "participant_save" : "participant_view", id: adminOp, pharmacy_id: adminPart })
    : call("gp-pharmacy", body), [call, adminCall, adminOp, adminPart]);

  const listReq = useRef(0);
  const loadList = useCallback((quiet) => {
    if (adminOp) { setOps([{ id: adminOp }]); setSelId(adminOp); return; }   // saisie admin : une seule opération
    const req = ++listReq.current;
    api({ action: "list" }).then(j => { if (req === listReq.current) setOps(j.operations || []); })
      .catch(e => { if (req !== listReq.current) return; if (!quiet) { setOps([]); setMsg({ type: "err", text: e.message }); } });
  }, [api, adminOp]);
  useEffect(() => { loadList(false); }, [loadList]);
  // accessibilité : focus sur « retour » à l'ouverture, sur la ligne quittée au retour
  const backRef = useRef(null), lastOpened = useRef(null);
  useEffect(() => {
    if (selId) { lastOpened.current = selId; backRef.current?.focus(); return; }
    const id = lastOpened.current;
    if (id) requestAnimationFrame(() => document.querySelector(`[data-gp-open="${id}"]`)?.focus());
  }, [selId]);

  const loadView = useCallback((id) => {
    const req = ++reqRef.current;
    setBusy("load"); setImp(null); setMsg(null); setStale(false);
    api({ action: "get", id }).then(v => {
      if (req !== reqRef.current) return;          // une autre opération a été choisie entre-temps
      setView(v); setGrid(JSON.parse(JSON.stringify(v.my_order?.bySlot || {}))); setDirty(false);
      setSource({ source: "formulaire", file_name: null });
    }).catch(e => { if (req === reqRef.current) setMsg({ type: "err", text: e.message }); })
      .finally(() => { if (req === reqRef.current) setBusy(""); });
  }, [api]);
  useEffect(() => { if (selId) loadView(selId); else setView(null); }, [selId, loadView]);

  const choose = (id) => {
    if (id === selId) return;
    if (dirty && !window.confirm(id ? "Vos quantités non confirmées seront perdues. Changer d'opération ?" : "Vos quantités non confirmées seront perdues. Revenir à la liste ?")) return;
    if (!id) { reqRef.current++; setDirty(false); setGrid({}); setImp(null); setMsg(null); setStale(false); setBusy(""); loadList(true); }
    setSelId(id);
  };

  const op = view?.operation;
  const lines = view?.lines || [];
  // saisie admin : modifiable jusqu'au bon de commande labo (le serveur le vérifie aussi)
  const editable = admin ? ["brouillon", "ouverte", "cloturee"].includes(op?.status) : op?.phase === "ouverte";
  const inStock = (l) => !!view?.products?.[l.cip]?.in_stock;
  const slots = useMemo(() => {
    if (!op) return [];
    const ds = (op.delivery_slots || []).map(s => ({ id: s.id, label: s.label || `Livraison ${dfr(s.date, { day: "numeric", month: "short" })}`, sub: s.label ? dfr(s.date, { day: "numeric", month: "short" }) : "" }));
    if (!ds.length) return [{ id: IMMEDIATE_SLOT, label: "Quantité", any: true }];
    const immediateNeeded = lines.some(inStock) || lines.some(l => Number(grid[l.id]?.[IMMEDIATE_SLOT]) > 0);
    return immediateNeeded ? [{ id: IMMEDIATE_SLOT, label: "Immédiat", sub: "produits en stock" }, ...ds] : ds;
  }, [op, lines, view, grid]);

  // ── Calcul en direct (même moteur que le serveur) ──
  const calc = useMemo(() => {
    if (!view) return null;
    const collectif = op.tier_mode !== "individuel";
    const mine = sumSlots(grid);
    const group = Object.fromEntries(lines.map(l => [l.id, (view.group_others?.[l.id] || 0) + (mine[l.id] || 0)]));
    const noCoop = (qty) => priceOrder({ ...op, coop_mode: "aucune" }, lines, qty, group, { feePct: view.fee_pct }).totals.net;
    // Base de répartition de la coopération « montant global » : tout le groupe, après RFA
    // (pharmacies seulement : les quantités d'Elixir pour son stock en sont exclues)
    const groupNet = collectif ? lines.reduce((s, l) => s + noCoop({ [l.id]: Math.max(0, (group[l.id] || 0) - (view.coop_excluded?.[l.id] || 0)) }), 0) : (view.others_net || 0) + noCoop(mine);
    // Unités gratuites : individuel = tranches de la pharmacie ; collectif = part des UG du groupe
    // (répartition au plus fort reste avec les autres pharmacies, clés anonymes, comme au serveur)
    const free = {}, freeSlots = {};
    for (const l of lines) {
      if (!(l.ug_tiers || []).length) continue;
      const q = mine[l.id] || 0;
      free[l.id] = !q ? 0 : !collectif ? ugFor(l, q).free : (allocateFree(op, l, { ...(view.ug_others?.[l.id] || {}), [view.my_key]: q })[view.my_key] || 0);
      if (free[l.id]) freeSlots[l.id] = freeBySlot(free[l.id], grid[l.id] || {}, slotOrder(op));
    }
    const summary = priceOrder(op, lines, mine, group, { free, groupNetAfterRfa: groupNet, feePct: view.fee_pct });
    const objective = objectiveIsAdditive(op)
      ? (view.objective_others != null ? objectiveFrom(op, view.objective_others + objectiveContribution(op, lines, mine)) : null)
      : objectiveProgress(op, lines, group);
    return { mine, group, summary, objective, freeSlots };
  }, [view, grid, lines, op]);
  // Colisage : chaque livraison saisie doit respecter la règle du produit (même contrôle qu'au serveur)
  const packProblems = useMemo(() => packIssues(lines, grid), [lines, grid]);

  const setQty = (lineId, slotId, v) => {
    const q = Math.max(0, Math.floor(Number(String(v).replace(/\D/g, "")) || 0));
    setGrid(g => ({ ...g, [lineId]: { ...(g[lineId] || {}), [slotId]: q } }));
    setDirty(true); setMsg(null);
  };

  const confirm = async () => {
    const opId = op.id, req = reqRef.current;
    setBusy("save"); setMsg(null);
    try {
      const entries = [];
      for (const [line_id, s] of Object.entries(grid)) for (const [slot_id, qty] of Object.entries(s || {})) entries.push({ line_id, slot_id, qty: Number(qty) || 0 });
      const r = await api({ action: "save", id: opId, entries, ...source, resend: !dirty, loaded_updated_at: view.my_order?.updated_at || null });
      if (req !== reqRef.current) return;         // une autre opération a été ouverte entre-temps
      setView(r); setGrid(JSON.parse(JSON.stringify(r.my_order?.bySlot || {}))); setDirty(false); setImp(null);
      setSource({ source: "formulaire", file_name: null });
      setOps(list => (list || []).map(o => o.id === op.id ? { ...o, my_order: { status: r.my_order.status, confirmed_at: r.my_order.confirmed_at, units: r.total || 0 } } : o));
      const mailNote = admin ? (r.mail?.sent ? ` E-mail de confirmation envoyé à ${r.mail.to}.` : r.mail?.reason && r.mail.reason !== "aucune modification" ? ` (E-mail non envoyé : ${r.mail.reason}.)` : "") : r.mail?.sent ? ` Un e-mail a été envoyé à ${r.pharmacy.email}.` : r.mail?.reason && r.mail.reason !== "commande vide" ? ` (E-mail non envoyé : ${r.mail.reason}.)` : "";
      if (r.cancelled) setMsg({ type: "info", text: `Votre commande est annulée : vous avez retiré toutes vos quantités.${mailNote}` });
      else if (!r.total) setMsg({ type: "info", text: "Votre commande est vide : rien n'a été enregistré." });
      else if (!r.changed) setMsg({ type: "ok", text: `Aucune modification.${mailNote}` });
      else setMsg({ type: "ok", text: `Commande enregistrée.${mailNote}` });
      if (r.changed || r.cancelled) admin?.onSaved?.();
    } catch (e) { setMsg({ type: "err", text: e.message }); if (/rechargez/.test(e.message)) setStale(true); }
    setBusy("");
  };

  const importLgo = async (file) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (hasQty(grid) && !window.confirm("Les quantités de votre fichier remplaceront votre saisie actuelle. Continuer ?")) return;
    const opId = op.id, req = reqRef.current;
    setBusy("import"); setMsg({ type: "info", text: "Analyse de votre bon de commande…" }); setImp(null);
    try {
      const r = await analyzeFile({ file, kind: "lgo", opId, post: (body) => call("gp-upload", body),
        onProgress: (s) => setMsg({ type: "info", text: `Analyse de votre bon de commande… ${s} s` }) });
      if (req !== reqRef.current || op.id !== opId) return;   // l'opération affichée a changé pendant l'analyse
      const next = {};
      const slotIds = new Set((op.delivery_slots || []).map(s => s.id));
      const firstSlot = (op.delivery_slots || [])[0]?.id;
      const auto = (l) => !firstSlot || inStock(l) ? IMMEDIATE_SLOT : firstSlot;
      // bon échelonné : chaque ligne va sur sa date de livraison ; sans date, livraison immédiate si en stock, sinon 1re date
      const src = r.result?.grid || Object.fromEntries(Object.entries(r.result?.qty || {}).map(([k, q]) => [k, { _auto: q }]));
      for (const [lineId, bySlot] of Object.entries(src)) {
        const l = lines.find(x => x.id === lineId);
        if (!l) continue;
        for (const [slot, q] of Object.entries(bySlot || {})) {
          if (!q) continue;
          const target = slotIds.has(slot) ? slot : auto(l);
          (next[lineId] ||= {})[target] = (next[lineId][target] || 0) + q;
        }
      }
      setGrid(next); setDirty(true); setSource({ source: "fichier", file_name: r.file_name });
      setImp({ unmatched: r.result?.unmatched || [], warnings: r.result?.warnings || [] });
      const offPack = packIssues(lines, next).length;
      setMsg({ type: "info", text: `${Object.keys(next).length} produit(s) repris de « ${r.file_name} ». Vérifiez les quantités et les dates de livraison, puis confirmez.`
        + (offPack ? ` ${offPack} quantité(s) ne respectent pas le colisage (cases en rouge) : ajustez-les avant de confirmer.` : "") });
    } catch (e) { if (req === reqRef.current) setMsg({ type: "err", text: e.message }); }
    if (req === reqRef.current) setBusy("");
  };

  // En-tête de vue commun (lot 7) au lieu du bandeau en dégradé (pharmacie seulement ; l'admin a son propre cadre).
  // Lot 8 : affiché dès le chargement, la liste arrive dessous sans décaler la page.
  const entete = !admin && <EnteteVue
    icone={icone || <Icone nom="groupe" taille={24} />}
    couleur={couleur}
    titre="Commandes groupées"
    sousTitre="Achetez ensemble pour obtenir de meilleures conditions. Les produits hors stock sont des précommandes, livrées aux dates prévues."
    style={{ marginBottom: 0 }}
  />;
  // chargement, aucune opération, liste en échec (« Réessayer » : même chargement qu'à l'ouverture) — composants communs (lot 8)
  if (ops === null) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {entete}
      <Chargement texte="Chargement des commandes groupées…" style={{ ...card, padding: "40px 20px" }} />
    </div>
  );
  if (!ops.length) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {entete}
      {msg?.type === "err"
        ? <EtatVide cadre erreur icone="alerte" titre="Les opérations n’ont pas pu être chargées" texte={msg.text}
            actions={<ActionEtat principal icone="actualiser" onClick={() => { setMsg(null); setOps(null); loadList(false); }}>Réessayer</ActionEtat>} />
        : <EtatVide cadre icone="groupe" titre="Aucune opération en cours"
            texte="Aucune opération de commande groupée ne vous est proposée pour le moment." />}
      {msg && msg.type !== "err" && <Msg m={msg} />}
    </div>
  );

  const t = calc?.summary?.totals;
  const confirmed = view?.my_order?.status === "confirmee";
  // aspect grisé de « Confirmer » : même règle que l'ancienne opacité (la condition disabled, elle, est inchangée)
  const confirmerGrise = busy || packProblems.length || (!dirty && !confirmed && !hasQty(grid));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {entete}

      {!selId && <OpsList ops={ops} onOpen={choose} />}
      {selId && !admin && (
        <div>
          <button ref={backRef} className={busy === "save" || busy === "import" ? undefined : "ex-btn-ligne"} style={{ ...btn(false), ...(busy === "save" || busy === "import" ? btnInactif : {}) }} disabled={busy === "save" || busy === "import"} onClick={() => choose(null)}>
            <Icone nom="retour" taille={16} />Toutes les opérations</button>
        </div>
      )}

      {selId && busy === "load" && <Chargement texte="Chargement de l’opération…" style={{ ...card, padding: "40px 20px" }} />}
      {selId && op && calc && busy !== "load" && (<>
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 640, letterSpacing: "-0.02em", color: T.petrol }}>{op.name}</div>
              <div className="num" style={{ fontSize: 13, color: T.inkSoft, marginTop: 2 }}>{op.supplier_name ? `${op.supplier_name} · ` : ""}{op.start_date ? `du ${dfr(op.start_date)} ` : ""}{op.end_date ? `au ${dfr(op.end_date, { day: "numeric", month: "long", year: "numeric" })}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ ...ui.badge(editable ? "ok" : "warn"), fontSize: 12 }}>{PHASE[op.phase] || op.phase}{op.phase === "a_venir" && op.start_date ? ` (le ${dfr(op.start_date)})` : ""}</span>
              {editable && op.end_date && <div className="num" style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>{daysLeft(op.end_date) <= 0 ? "Clôture ce soir" : `Clôture dans ${daysLeft(op.end_date)} jour${daysLeft(op.end_date) > 1 ? "s" : ""}`}</div>}
              {confirmed && <div style={{ fontSize: 12, fontWeight: 600, color: T.ok, marginTop: 4, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}><Icone nom="coche" taille={13} epaisseur={2.6} />Commande confirmée le {dts(view.my_order.confirmed_at)}</div>}
            </div>
          </div>
          <div className="num" style={{ fontSize: 13, color: T.inkSoft, display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            <span>Paliers calculés sur {op.tier_mode === "individuel" ? "votre quantité" : <b>le total du groupe ({view.participants_count} pharmacies)</b>}</span>
            {Number(op.rfa_pct) > 0 && <span>Remise de fin d'année : <b>{pct(op.rfa_pct)}</b> (déduite du prix)</span>}
            {op.coop_mode !== "aucune" && Number(op.coop_amount) > 0 && <span>Coopération commerciale : <b>{eur(op.coop_amount)}</b> {op.coop_mode === "total" ? "à répartir au prorata" : "par pharmacie"}{op.coop_label ? ` (${op.coop_label})` : ""}</span>}
            <span>Frais de traitement : <b>{pct(view.fee_pct)}</b></span>
          </div>
          {op.conditions_text && <div style={{ fontSize: 12, color: T.inkSoft, background: T.surface2, borderRadius: R.s, padding: "8px 12px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{op.conditions_text}</div>}
          {calc.objective && <Objective o={calc.objective} />}
          {lines.some(l => (l.ug_tiers || []).length) && <div style={{ fontSize: 12, color: T.inkSoft }}>Saisissez les <b>unités facturées</b> : les unités gratuites sont ajoutées automatiquement (pour « 12 + 2 UG », saisissez 12 : vous recevrez 14).
            {op.tier_mode !== "individuel" && <> Vous gardez toujours au moins vos propres gratuités ; celles que le groupe gagne en plus sont partagées au prorata et votre part peut évoluer jusqu'à la clôture.</>}</div>}
          {lines.some(l => packCheck(l, 1)) && <div style={{ fontSize: 12, color: T.inkSoft, display: "flex", alignItems: "flex-start", gap: 6 }}><Icone nom="carton" taille={14} style={{ marginTop: 1, color: T.teal }} /><span>Certains produits se commandent par colis : la règle indiquée sous le produit s'applique à <b>chaque date de livraison</b>, sur les unités facturées que vous saisissez.</span></div>}
        </div>

        {/* Grille de saisie : en-tête neutre (eyebrow --ink-mute), colonne produit collée à gauche, chiffres alignés */}
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table className="num" style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 720, color: T.ink }}>
            <thead>
              <tr>
                <th style={{ ...thGrille, textAlign: "left", padding: "10px 14px", position: "sticky", left: 0, zIndex: 1 }}>Produit</th>
                <th style={{ ...thGrille, textAlign: "right" }}>Prix brut</th>
                <th style={{ ...thGrille, textAlign: "left" }}>Conditions</th>
                {slots.map(s => <th key={s.id} style={{ ...thGrille, textAlign: "center", padding: "10px 6px", minWidth: 86 }}>{s.label}{s.sub && <div style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{s.sub}</div>}</th>)}
                <th style={{ ...thGrille, textAlign: "right" }}>Prix net</th>
                <th style={{ ...thGrille, textAlign: "right", padding: "10px 14px" }}>Total net</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const myQ = calc.mine[l.id] || 0;
                const p = priceLine(op, l, myQ, calc.group[l.id] || 0);
                const row = calc.summary.rows.find(r => r.line.id === l.id);
                const stock = inStock(l);
                const tiers = (l.discount_mode === "paliers" ? l.discount_tiers : []) || [];
                const inv = invoiceDiscount(l, p.basis);   // détail des 3 remises au palier actuel
                const netPct = row ? row.totalDiscountPct : (1 - p.unitAfterRfa / (p.gross || 1)) * 100;
                return (
                  <tr key={l.id} style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                    <td style={{ padding: "10px 14px", position: "sticky", left: 0, background: T.surface, zIndex: 1, minWidth: 150, maxWidth: 220, boxShadow: `1px 0 0 ${T.lineSoft}` }}>
                      <div style={{ fontWeight: 600, color: T.ink }}>{l.name}</div>
                      {/* statut écrit : en stock (ok), précommande (sarcelle, décision de la cliente) */}
                      <div style={{ fontSize: 11, color: T.inkMute }}>CIP {l.cip} · {stock ? <span style={{ color: T.ok, fontWeight: 700 }}>En stock</span> : <span style={{ color: T.teal, fontWeight: 700 }}>Précommande</span>}{Number(l.weight) > 1 ? ` · compte ×${l.weight}` : ""}</div>
                      {packLabel(l) && <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><Icone nom="carton" taille={12} />{packLabel(l)}</div>}
                      {l.notes && <div style={{ fontSize: 11, color: T.inkSoft }}>{l.notes}</div>}
                      {row?.free > 0 && <div style={{ fontSize: 12, color: T.ok, fontWeight: 700, marginTop: 3 }}>{row.qty} facturées + {row.free} UG = {row.received} reçues{op.tier_mode !== "individuel" && row.free > ugFor(l, row.qty).free ? " (dont part du groupe, provisoire)" : ""}</div>}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap", color: T.inkSoft }}>{eur(l.price_gross)}</td>
                    <td style={{ padding: "10px 8px", maxWidth: 240 }}>
                      {l.discount_mode === "unitaire" && Number(l.discount_pct) > 0 && <span style={chip(true)}>−{pct(l.discount_pct)}</span>}
                      {tiers.map((t, i) => <span key={i} style={chip(p.invoiceTier && Number(t.min_qty) === p.invoiceTier.min_qty)}>dès {t.min_qty} : −{pct(t.pct)}</span>)}
                      {(l.extra_discounts || []).map((d, k) => {
                        const part = inv.parts[k + 1] || {};
                        const word = d.combine === "additionnelle" ? "+" : "puis";
                        return d.mode === "paliers"
                          ? (d.tiers || []).map((t, j) => <span key={`x${k}-${j}`} style={chip(part.tier && Number(t.min_qty) === part.tier.min_qty)}>{word} dès {t.min_qty} : −{pct(t.pct)}</span>)
                          : Number(d.pct) > 0 ? <span key={`x${k}`} style={chip(true)}>{word} −{pct(d.pct)}</span> : null;
                      })}
                      {(l.extra_discounts || []).length > 0 && inv.pct > 0 && <div style={{ fontSize: 11, color: T.ink, fontWeight: 700 }}>Remise totale : −{pct(inv.pct)}</div>}
                      {(l.ug_tiers || []).map((t, i) => <span key={"u" + i} style={chip(p.ug.tier && Number(t.min_qty) === p.ug.tier.min_qty)}>{t.min_qty} + {t.free_qty} UG</span>)}
                      {p.nextInvoiceTier && <div style={{ fontSize: 11, color: T.teal, fontWeight: 600, marginTop: 2 }}>Encore {p.nextInvoiceTier.missing} u.{op.tier_mode !== "individuel" ? " (groupe)" : ""} → remise totale −{pct(p.nextInvoiceTier.totalPct ?? p.nextInvoiceTier.pct)}</div>}
                      {p.ug.next && <div style={{ fontSize: 11, color: T.ok, fontWeight: 600, marginTop: 2 }}>Encore {p.ug.next.missing} u.{op.tier_mode !== "individuel" ? " (groupe)" : ""} → +{p.ug.next.gain} UG{op.tier_mode !== "individuel" ? " pour le groupe" : ""}</div>}
                      {op.tier_mode !== "individuel" && <div style={{ fontSize: 11, color: T.inkMute }}>Groupe : {calc.group[l.id] || 0} u.</div>}
                    </td>
                    {slots.map(s => {
                      const v = grid[l.id]?.[s.id] || "";
                      const pb = packCheck(l, v);
                      const allowed = s.any || s.id !== IMMEDIATE_SLOT || stock;
                      // une quantité déjà saisie reste visible et modifiable même si le produit n'est plus en stock
                      const show = allowed || Number(v) > 0;
                      return (
                        <td key={s.id} style={{ padding: "8px 6px", textAlign: "center" }}>
                          {show ? (<>
                            <input value={v} inputMode="numeric" disabled={!editable || busy === "import" || busy === "save"} onChange={e => setQty(l.id, s.id, e.target.value)} placeholder="0" aria-label={`${l.name} — ${s.label}`}
                              aria-invalid={pb ? true : undefined}
                              style={{ width: 64, height: 36, boxSizing: "border-box", border: pb ? `2px solid ${T.danger}` : Number(v) > 0 ? `2px solid ${allowed ? T.teal : T.warn}` : `1px solid ${allowed ? T.lineField : T.warn}`,
                                borderRadius: R.s, padding: "0 6px", fontSize: 14, fontWeight: Number(v) > 0 ? 700 : 500, textAlign: "center", color: T.ink,
                                background: pb ? T.dangerBg : editable ? T.surface : T.surface2, fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }} />
                            {pb && <div style={{ fontSize: 11, color: T.danger, fontWeight: 700, marginTop: 2 }}>{pb.text}
                              {editable && <button type="button" className={busy ? undefined : "ex-btn-danger-ligne"} disabled={!!busy} onClick={() => setQty(l.id, s.id, pb.suggestion)} title={`Passer à ${pb.suggestion}`}
                                style={{ display: "block", margin: "3px auto 0", border: "none", borderRadius: R.pill, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}>→ {pb.suggestion}</button>}</div>}
                            {calc.freeSlots[l.id]?.[s.id] > 0 && <div style={{ fontSize: 11, color: T.ok, fontWeight: 700 }}>+{calc.freeSlots[l.id][s.id]} UG</div>}
                            {!allowed && <div style={{ fontSize: 11, color: T.warn }}>plus en stock</div>}
                          </>) : <span style={{ color: T.inkFaint }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <b>{eur(row ? row.unitNet : p.unitAfterRfa)}</b>
                      {row?.free > 0 && <div style={{ fontSize: 11, color: T.ok }}>soit {eur(row.receivedUnitNet)} / u. reçue</div>}
                      {netPct > 0.05 && <div style={{ fontSize: 11, color: T.ok, fontWeight: 600 }}>−{pct(netPct)}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: row ? T.ink : T.inkFaint }}>{row ? eur(row.totalNet) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {imp && (imp.unmatched.length > 0 || imp.warnings.length > 0) && (
          <div style={{ ...card, ...ui.encart("warn"), padding: "16px 20px", borderRadius: R.m, boxShadow: "none" }}>
            {imp.unmatched.length > 0 && (<>
              <b>Produits de votre fichier qui ne font pas partie de l'opération ({imp.unmatched.length})</b>
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{imp.unmatched.slice(0, 30).map((u, i) => <li key={i}>{u.name}{u.cip ? ` (${u.cip})` : ""} — {u.qty}</li>)}</ul>
            </>)}
            {imp.warnings.map((w, i) => <div key={i} style={{ marginTop: 6, display: "flex", alignItems: "flex-start", gap: 6 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} /><span>{w}</span></div>)}
          </div>
        )}

        <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end" }}>
          <table className="num" style={{ fontSize: 13, borderCollapse: "collapse", minWidth: 280, color: T.ink }}>
            <tbody>
              <Tot label={`Montant brut HT (${t.units} u. facturées)`} v={eur(t.gross)} />
              {t.invoiceDiscount > 0.004 && <Tot label="Remises sur facture" v={"− " + eur(t.invoiceDiscount)} />}
              {t.rfaValue > 0.004 && <Tot label="Remise de fin d'année" v={"− " + eur(t.rfaValue)} />}
              {t.coop > 0.004 && <Tot label="Coopération commerciale" v={"− " + eur(t.coop)} />}
              <Tot label={`Frais de traitement (${pct(t.feePct)})`} v={"+ " + eur(t.fee)} />
              <Tot label="Total HT" v={eur(t.totalHT)} strong />
              {t.freeUnits > 0 && <tr><td colSpan={2} style={{ padding: "4px 0", color: T.ok, fontSize: 12, fontWeight: 700 }}>+ {t.freeUnits} unités gratuites (valeur {eur(t.ugValue)}) : {t.receivedUnits} unités reçues</td></tr>}
              {t.vat > 0 && <Tot label="TVA" v={eur(t.vat)} />}
              {t.vat > 0 && <Tot label="Total TTC" v={eur(t.totalTTC)} />}
            </tbody>
          </table>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            {op.tier_mode !== "individuel" && editable && <div style={{ fontSize: 12, color: T.inkSoft, maxWidth: 360, textAlign: "right", lineHeight: 1.45 }}>Prix estimés avec les quantités du groupe à cet instant : ils peuvent encore s'améliorer jusqu'à la clôture. La part des gratuités gagnées par le groupe est provisoire.</div>}
            {dirty && editable && <div style={{ ...ui.badge("warn"), fontSize: 12 }}><Icone nom="crayon" taille={12} />Modifications non confirmées</div>}
            {editable && packProblems.length > 0 && <div role="alert" style={{ fontSize: 12, color: T.danger, fontWeight: 700, maxWidth: 420, textAlign: "right", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", gap: 6 }}><Icone nom="carton" taille={14} style={{ marginTop: 1, flexShrink: 0 }} />{packProblems.length} quantité{packProblems.length > 1 ? "s" : ""} hors colisage (cases en rouge) : corrigez-{packProblems.length > 1 ? "les" : "la"} pour confirmer.</div>}
            {editable && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,.xls,.xlsx,.ods,image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={e => importLgo(e.target.files?.[0])} />
                {!admin && <button className={busy ? undefined : btnClasse(false)} style={{ ...btn(false), ...(busy ? btnInactif : {}) }} disabled={!!busy} onClick={() => fileRef.current?.click()}>
                  <Icone nom={busy === "import" ? "horloge" : "importer"} taille={16} />{busy === "import" ? "Analyse…" : "Importer mon bon de commande (LGO)"}</button>}
                <button className={confirmerGrise ? undefined : btnClasse(true)} style={{ ...btn(true), ...(confirmerGrise ? btnInactif : {}), ...(busy === "save" ? { cursor: "wait" } : {}) }} disabled={!!busy || packProblems.length > 0 || (!dirty && !confirmed && !hasQty(grid)) || (!!admin && !dirty)} onClick={confirm}>
                  {busy === "save" ? "Envoi…" : admin ? (confirmed ? "Enregistrer les modifications" : "Enregistrer la commande") : confirmed ? (dirty ? "Enregistrer les modifications" : "Renvoyer la confirmation") : "Confirmer ma commande"}
                </button>
              </div>
            )}
          </div>
        </div>
      </>)}
      {msg && <Msg m={msg} />}
      {stale && <button className={btnClasse(true)} style={{ ...btn(true), alignSelf: "flex-start" }} onClick={() => loadView(selId)}><Icone nom="actualiser" taille={16} />Recharger ma commande</button>}
    </div>
  );
}

// ── Liste des opérations : une ligne par opération (période, statut, participation) ──
const sdate = (d, year) => dfr(d, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
const period = (o) => o.start_date && o.end_date ? `du ${sdate(o.start_date, o.start_date.slice(0, 4) !== o.end_date.slice(0, 4))} au ${sdate(o.end_date, true)}`
  : o.end_date ? `jusqu'au ${sdate(o.end_date, true)}` : o.start_date ? `à partir du ${sdate(o.start_date, true)}` : "—";
const RANK = { ouverte: 0, a_venir: 1, cloturee: 2, commandee: 3, terminee: 4 };
// statut d'une opération → ton de theme.js (libellé toujours écrit)
const PHASE_TON = { ouverte: "ok", a_venir: "info", cloturee: "warn", commandee: "labo", terminee: "neutral" };
// retour à la ligne permis : colonnes étroites du tableau (largeurs fixes) sur petit écran, le badge ne déborde plus
const badge = (ton) => ({ ...ui.badge(ton), fontSize: 12, padding: "3px 10px", whiteSpace: "normal", maxWidth: "100%", borderRadius: 12 });
// en-tête de colonne : eyebrow --ink-mute 11 px sur --surface-2 (ui.th)
const thGrille = { ...ui.th, padding: "10px 8px", whiteSpace: "normal", lineHeight: 1.25, verticalAlign: "bottom" };

function OpsList({ ops, onOpen }) {
  const current = ops.filter(o => o.phase === "ouverte" || o.phase === "a_venir")
    .sort((a, b) => RANK[a.phase] - RANK[b.phase] || String(a.phase === "a_venir" ? a.start_date : a.end_date || "9").localeCompare(String(b.phase === "a_venir" ? b.start_date : b.end_date || "9")));
  const past = ops.filter(o => !(o.phase === "ouverte" || o.phase === "a_venir")).sort((a, b) => String(b.end_date || "").localeCompare(String(a.end_date || "")));
  const cell = { padding: "12px 14px", verticalAlign: "middle" };
  const th = { ...ui.th, padding: "8px 14px", background: "transparent" };
  // une carte par groupe d'opérations ; lignes .ex-tr (zébrure et survol en CSS : plus de fond réécrit en JS) ;
  // sous 768 px, une carte par opération (classe ex-ops, lot 9 : disposition seulement, ligne toujours cliquable)
  const section = (title, list) => list.length > 0 && (
    <div style={{ ...card, padding: 0, overflowX: "auto" }}>
      <div className="num" style={{ ...h2, padding: "16px 14px 4px" }}>{title} ({list.length})</div>
      <table className="ex-ops" style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, fontSize: 14, tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "31%" }} /><col style={{ width: "19%" }} /><col style={{ width: "17%" }} /><col style={{ width: "18%" }} /><col style={{ width: "15%" }} /></colgroup>
        <thead><tr><th style={th}>Opération</th><th style={th}>Période</th><th style={th}>Statut</th><th style={th}>Ma commande</th><th style={th} /></tr></thead>
        <tbody>
          {list.map(o => {
            const mine = o.my_order?.status === "confirmee";
            const open = o.phase === "ouverte";
            const slots = (o.delivery_slots || []).filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date));
            const left = open && o.end_date ? daysLeft(o.end_date) : null;
            return (
              <tr key={o.id} className="ex-tr" onClick={() => onOpen(o.id)}
                style={{ borderTop: `1px solid ${T.lineSoft}`, cursor: "pointer" }}>
                <td style={cell}>
                  <div style={{ fontWeight: 600, color: T.ink }}>{o.name}</div>
                  <div className="num" style={{ fontSize: 12, color: T.inkSoft }}>{[o.supplier_name, o.products_count ? `${o.products_count} produit${o.products_count > 1 ? "s" : ""}` : "",
                    slots.length > 1 ? `${slots.length} livraisons à partir du ${sdate(slots[0].date)}` : slots.length === 1 ? `livraison le ${sdate(slots[0].date)}` : ""].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="num" style={{ ...cell, color: T.inkSoft }}>{period(o)}</td>
                <td style={cell}>
                  <span style={badge(PHASE_TON[o.phase] || "neutral")}>{PHASE[o.phase] || o.phase}</span>
                  {left != null && <div className="num" style={{ fontSize: 12, color: left <= 2 ? T.warn : T.inkSoft, fontWeight: left <= 2 ? 700 : 500, marginTop: 3 }}>{left < 0 ? "Clôturée" : left === 0 ? "Clôture ce soir" : `Clôture dans ${left} jour${left > 1 ? "s" : ""}`}</div>}
                  {o.phase === "a_venir" && o.start_date && <div className="num" style={{ fontSize: 12, color: T.inkSoft, marginTop: 3 }}>Ouverture le {sdate(o.start_date)}</div>}
                </td>
                <td style={cell}>
                  {mine ? (<>
                    <span className="num" style={badge("ok")}><Icone nom="coche" taille={12} epaisseur={2.6} />{open || o.phase === "a_venir" ? "Commandé" : "Participé"}{o.my_order.units ? ` · ${o.my_order.units} u.` : ""}</span>
                    {o.my_order.confirmed_at && <div className="num" style={{ fontSize: 12, color: T.inkSoft, marginTop: 3 }}>le {dts(o.my_order.confirmed_at)}</div>}
                  </>) : open ? <span style={badge("warn")}>Pas encore commandé</span>
                    : o.phase === "a_venir" ? <span style={{ fontSize: 13, color: T.inkFaint }}>—</span>
                    : <span style={badge("neutral")}>Non participé</span>}
                </td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button type="button" data-gp-open={o.id} onClick={e => { e.stopPropagation(); onOpen(o.id); }} aria-label={`${open ? (mine ? "Modifier ma commande" : "Commander") : "Voir"} : ${o.name}`}
                    className={open ? btnClasse(!mine) : undefined}
                    style={open ? { ...btn(!mine), height: 34, padding: "0 14px", gap: 6 } : { border: "none", background: "none", fontSize: 13, fontWeight: 700, color: T.petrol, cursor: "pointer", padding: "7px 4px", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {open ? (mine ? "Modifier" : "Commander") : "Voir"}<Icone nom="fleche" taille={14} epaisseur={2.4} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (<>{section("En cours", current)}{section("Opérations passées", past)}</>);
}

function Tot({ label, v, strong }) {
  return <tr><td style={{ padding: strong ? "6px 16px 3px 0" : "3px 16px 3px 0", color: strong ? T.ink : T.inkSoft, fontWeight: strong ? 700 : 500 }}>{label}</td><td style={{ textAlign: "right", padding: strong ? "6px 0 3px" : undefined, fontWeight: 700, fontSize: strong ? 16 : undefined, color: T.ink, whiteSpace: "nowrap" }}>{v}</td></tr>;
}

// message d'état : ok (vert), erreur (danger), information (menthe + sarcelle) ; toujours avec une icône.
// Erreur annoncée aussitôt (role="alert", lot 8) ; les autres restent polies (role="status")
const MSG = { ok: ["ok", "coche"], err: ["danger", "alerte"], info: ["info", "horloge"] };
function Msg({ m }) {
  const [ton, icone] = MSG[m.type] || ["neutral", "alerte"];
  return <div role={m.type === "err" ? "alert" : "status"} style={{ ...ui.encart(ton), fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 8 }}><Icone nom={icone} taille={16} style={{ marginTop: 1 }} /><span>{m.text}</span></div>;
}

export function Objective({ o }) {
  const unit = o.type === "unites" ? " unités" : "";
  const f = (n) => o.type === "unites" ? Math.round(n).toLocaleString("fr-FR") : eur(n);
  const label = { unites: "Objectif du groupe", montant_brut: "Objectif du groupe (montant brut)", montant_net: "Objectif du groupe (montant remisé)" }[o.type];
  return (
    <div>
      <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: T.inkSoft, marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <span>{label} : {f(o.target)}{unit}</span>
        <span style={{ color: o.reached ? T.ok : T.teal, display: "inline-flex", alignItems: "center", gap: 4 }}>{o.reached ? <><Icone nom="coche" taille={13} epaisseur={2.6} />Objectif atteint</> : `${f(o.value)}${unit} · encore ${f(o.missing)}${unit}`}</span>
      </div>
      {/* piste sable, remplie en sarcelle puis or à l'objectif atteint (comme la progression U-Labs) */}
      <div style={{ height: 10, background: T.sand, borderRadius: R.pill, overflow: "hidden" }}>
        <div style={{ width: `${o.pct}%`, height: "100%", borderRadius: R.pill, background: o.reached ? T.or : T.teal2, transition: "width .3s var(--ease)" }} />
      </div>
    </div>
  );
}
