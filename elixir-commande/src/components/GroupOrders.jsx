import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { priceOrder, priceLine, objectiveProgress, objectiveContribution, objectiveIsAdditive, objectiveFrom, sumSlots, parisToday, ugFor, allocateFree, freeBySlot, slotOrder, invoiceDiscount, packCheck, packIssues, packLabel, IMMEDIATE_SLOT, round2 } from "../gp-pricing.js";
import { analyzeFile } from "../gp-files.js";

const eur = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const pct = (n) => `${round2(n || 0).toLocaleString("fr-FR")} %`;
const dfr = (d, opts = { day: "numeric", month: "long" }) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("fr-FR", opts) : "";
const dts = (t) => t ? new Date(t).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" }) : "";
const daysLeft = (d) => Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(parisToday() + "T12:00:00Z")) / 86400e3);

const card = { background: "white", borderRadius: 14, padding: "18px 22px", border: "1px solid #e8ecf0" };
const h2 = { fontSize: 13, fontWeight: 800, color: "#0f2d3d", letterSpacing: 0.3, textTransform: "uppercase", margin: "0 0 12px" };
const btn = (primary) => ({ border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer",
  background: primary ? "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)" : "#eef2f5", color: primary ? "white" : "#0f2d3d" });
const chip = (on) => ({ display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "2px 8px", margin: "2px 4px 2px 0",
  background: on ? "#dcfce7" : "#f1f5f9", color: on ? "#166534" : "#475569", border: on ? "1px solid #86efac" : "1px solid transparent" });
const PHASE = { ouverte: "Ouverte aux commandes", a_venir: "Pas encore ouverte", cloturee: "Clôturée", commandee: "Commandée au laboratoire", terminee: "Terminée" };
const hasQty = (grid) => Object.values(grid || {}).some(s => Object.values(s || {}).some(q => Number(q) > 0));

// Onglet « Commandes groupées » côté pharmacie
export default function GroupOrders({ pharmacyCip, pharmacyEmail, onDirtyChange }) {
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

  const headers = useMemo(() => { const t = localStorage.getItem("pharmacy_token"); return t ? { Authorization: `Bearer ${t}` } : {}; }, []);
  const call = useCallback(async (fn, body) => {
    const r = await fetch(`/.netlify/functions/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ cip: pharmacyCip, email: pharmacyEmail, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  }, [headers, pharmacyCip, pharmacyEmail]);
  const api = useCallback((body) => call("gp-pharmacy", body), [call]);

  useEffect(() => {
    api({ action: "list" }).then(j => {
      const list = j.operations || [];
      setOps(list);
      const open = list.filter(o => o.phase === "ouverte");
      if (open.length === 1 || list.length === 1) setSelId((open[0] || list[0]).id);
    }).catch(e => { setOps([]); setMsg({ type: "err", text: e.message }); });
  }, [api]);

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
    if (dirty && !window.confirm("Vos quantités non confirmées seront perdues. Changer d'opération ?")) return;
    setSelId(id);
  };

  const op = view?.operation;
  const lines = view?.lines || [];
  const editable = op?.phase === "ouverte";
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
    const groupNet = collectif ? lines.reduce((s, l) => s + noCoop({ [l.id]: group[l.id] || 0 }), 0) : (view.others_net || 0) + noCoop(mine);
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
      setOps(list => (list || []).map(o => o.id === op.id ? { ...o, my_order: { status: r.my_order.status } } : o));
      const mailNote = r.mail?.sent ? ` Un e-mail a été envoyé à ${r.pharmacy.email}.` : r.mail?.reason && r.mail.reason !== "commande vide" ? ` (E-mail non envoyé : ${r.mail.reason}.)` : "";
      if (r.cancelled) setMsg({ type: "info", text: `Votre commande est annulée : vous avez retiré toutes vos quantités.${mailNote}` });
      else if (!r.total) setMsg({ type: "info", text: "Votre commande est vide : rien n'a été enregistré." });
      else if (!r.changed) setMsg({ type: "ok", text: `Aucune modification.${mailNote}` });
      else setMsg({ type: "ok", text: `Commande enregistrée.${mailNote}` });
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

  if (ops === null) return <div style={card}>Chargement des commandes groupées…</div>;
  if (!ops.length) return (
    <div style={card}>
      <div style={h2}>Commandes groupées</div>
      <div style={{ color: "#475569", fontSize: 14 }}>Aucune opération de commande groupée ne vous est proposée pour le moment.</div>
      {msg && <Msg m={msg} />}
    </div>
  );

  const t = calc?.summary?.totals;
  const confirmed = view?.my_order?.status === "confirmee";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", borderRadius: 14, padding: "18px 24px", color: "white" }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>🤝 Commandes groupées</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Achetez ensemble pour obtenir de meilleures conditions. Les produits hors stock sont des précommandes, livrées aux dates prévues.</div>
      </div>

      {ops.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ops.map(o => (
            <button key={o.id} disabled={!!busy} aria-pressed={o.id === selId} onClick={() => choose(o.id)} style={{ ...btn(o.id === selId), padding: "8px 14px", textAlign: "left" }}>
              {o.name}<span style={{ fontWeight: 500, opacity: 0.75, marginLeft: 6 }}>{o.my_order?.status === "confirmee" ? "✓ commandé" : PHASE[o.phase] || o.phase}</span>
            </button>
          ))}
        </div>
      )}

      {busy === "load" && <div style={card}>Chargement…</div>}
      {op && calc && busy !== "load" && (<>
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f2d3d" }}>{op.name}</div>
              <div style={{ fontSize: 13, color: "#475569" }}>{op.supplier_name ? `${op.supplier_name} · ` : ""}{op.start_date ? `du ${dfr(op.start_date)} ` : ""}{op.end_date ? `au ${dfr(op.end_date, { day: "numeric", month: "long", year: "numeric" })}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: editable ? "#166534" : "#92400e" }}>{PHASE[op.phase] || op.phase}{op.phase === "a_venir" && op.start_date ? ` (le ${dfr(op.start_date)})` : ""}</div>
              {editable && op.end_date && <div style={{ fontSize: 12, color: "#475569" }}>{daysLeft(op.end_date) <= 0 ? "Clôture ce soir" : `Clôture dans ${daysLeft(op.end_date)} jour${daysLeft(op.end_date) > 1 ? "s" : ""}`}</div>}
              {confirmed && <div style={{ fontSize: 12, color: "#166534" }}>✓ Commande confirmée le {dts(view.my_order.confirmed_at)}</div>}
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#334155", display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            <span>Paliers calculés sur {op.tier_mode === "individuel" ? "votre quantité" : <b>le total du groupe ({view.participants_count} pharmacies)</b>}</span>
            {Number(op.rfa_pct) > 0 && <span>Remise de fin d'année : <b>{pct(op.rfa_pct)}</b> (déduite du prix)</span>}
            {op.coop_mode !== "aucune" && Number(op.coop_amount) > 0 && <span>Coopération commerciale : <b>{eur(op.coop_amount)}</b> {op.coop_mode === "total" ? "à répartir au prorata" : "par pharmacie"}{op.coop_label ? ` (${op.coop_label})` : ""}</span>}
            <span>Frais de traitement : <b>{pct(view.fee_pct)}</b></span>
          </div>
          {op.conditions_text && <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", borderRadius: 8, padding: "8px 12px", whiteSpace: "pre-wrap" }}>{op.conditions_text}</div>}
          {calc.objective && <Objective o={calc.objective} />}
          {lines.some(l => (l.ug_tiers || []).length) && <div style={{ fontSize: 12, color: "#475569" }}>Saisissez les <b>unités facturées</b> : les unités gratuites sont ajoutées automatiquement (pour « 12 + 2 UG », saisissez 12 : vous recevrez 14).
            {op.tier_mode !== "individuel" && <> Vous gardez toujours au moins vos propres gratuités ; celles que le groupe gagne en plus sont partagées au prorata et votre part peut évoluer jusqu'à la clôture.</>}</div>}
          {lines.some(l => packCheck(l, 1)) && <div style={{ fontSize: 12, color: "#475569" }}>📦 Certains produits se commandent par colis : la règle indiquée sous le produit s'applique à <b>chaque date de livraison</b>, sur les unités facturées que vous saisissez.</div>}
        </div>

        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 }}>
                <th style={{ textAlign: "left", padding: "10px 14px", position: "sticky", left: 0, background: "#f8fafc", zIndex: 1 }}>Produit</th>
                <th style={{ textAlign: "right", padding: "10px 8px" }}>Prix brut</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Conditions</th>
                {slots.map(s => <th key={s.id} style={{ textAlign: "center", padding: "10px 6px", minWidth: 86 }}>{s.label}{s.sub && <div style={{ fontWeight: 500, textTransform: "none" }}>{s.sub}</div>}</th>)}
                <th style={{ textAlign: "right", padding: "10px 8px" }}>Prix net</th>
                <th style={{ textAlign: "right", padding: "10px 14px" }}>Total net</th>
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
                  <tr key={l.id} style={{ borderTop: "1px solid #eef2f5", verticalAlign: "top" }}>
                    <td style={{ padding: "10px 14px", position: "sticky", left: 0, background: "white", zIndex: 1, minWidth: 150, maxWidth: 220, boxShadow: "1px 0 0 #eef2f5" }}>
                      <div style={{ fontWeight: 700, color: "#0f2d3d" }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>CIP {l.cip} · {stock ? <span style={{ color: "#166534", fontWeight: 700 }}>En stock</span> : <span style={{ color: "#b45309", fontWeight: 700 }}>Précommande</span>}{Number(l.weight) > 1 ? ` · compte ×${l.weight}` : ""}</div>
                      {packLabel(l) && <div style={{ fontSize: 11, color: "#0f2d3d", fontWeight: 700 }}>📦 {packLabel(l)}</div>}
                      {l.notes && <div style={{ fontSize: 11, color: "#64748b" }}>{l.notes}</div>}
                      {row?.free > 0 && <div style={{ fontSize: 12, color: "#15803d", fontWeight: 700, marginTop: 3 }}>{row.qty} facturées + {row.free} UG = {row.received} reçues{op.tier_mode !== "individuel" && row.free > ugFor(l, row.qty).free ? " (dont part du groupe, provisoire)" : ""}</div>}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{eur(l.price_gross)}</td>
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
                      {(l.extra_discounts || []).length > 0 && inv.pct > 0 && <div style={{ fontSize: 11, color: "#0f2d3d", fontWeight: 700 }}>Remise totale : −{pct(inv.pct)}</div>}
                      {(l.ug_tiers || []).map((t, i) => <span key={"u" + i} style={chip(p.ug.tier && Number(t.min_qty) === p.ug.tier.min_qty)}>{t.min_qty} + {t.free_qty} UG</span>)}
                      {p.nextInvoiceTier && <div style={{ fontSize: 11, color: "#0369a1", marginTop: 2 }}>Encore {p.nextInvoiceTier.missing} u.{op.tier_mode !== "individuel" ? " (groupe)" : ""} → remise totale −{pct(p.nextInvoiceTier.totalPct ?? p.nextInvoiceTier.pct)}</div>}
                      {p.ug.next && <div style={{ fontSize: 11, color: "#15803d", marginTop: 2 }}>Encore {p.ug.next.missing} u.{op.tier_mode !== "individuel" ? " (groupe)" : ""} → +{p.ug.next.gain} UG{op.tier_mode !== "individuel" ? " pour le groupe" : ""}</div>}
                      {op.tier_mode !== "individuel" && <div style={{ fontSize: 11, color: "#94a3b8" }}>Groupe : {calc.group[l.id] || 0} u.</div>}
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
                              style={{ width: 64, border: `1.5px solid ${pb ? "#dc2626" : allowed ? "#d6dde3" : "#f59e0b"}`, borderRadius: 8, padding: "7px 6px", fontSize: 14, fontWeight: 700, textAlign: "center", background: pb ? "#fef2f2" : editable ? "white" : "#f8fafc", fontFamily: "inherit" }} />
                            {pb && <div style={{ fontSize: 10, color: "#b91c1c", fontWeight: 700 }}>{pb.text}
                              {editable && <button type="button" disabled={!!busy} onClick={() => setQty(l.id, s.id, pb.suggestion)} title={`Passer à ${pb.suggestion}`}
                                style={{ display: "block", margin: "2px auto 0", border: "1px solid #fca5a5", background: "white", color: "#b91c1c", borderRadius: 6, padding: "1px 6px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>→ {pb.suggestion}</button>}</div>}
                            {calc.freeSlots[l.id]?.[s.id] > 0 && <div style={{ fontSize: 11, color: "#15803d", fontWeight: 700 }}>+{calc.freeSlots[l.id][s.id]} UG</div>}
                            {!allowed && <div style={{ fontSize: 10, color: "#b45309" }}>plus en stock</div>}
                          </>) : <span style={{ color: "#cbd5e1" }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <b>{eur(row ? row.unitNet : p.unitAfterRfa)}</b>
                      {row?.free > 0 && <div style={{ fontSize: 11, color: "#15803d" }}>soit {eur(row.receivedUnitNet)} / u. reçue</div>}
                      {netPct > 0.05 && <div style={{ fontSize: 11, color: "#166534" }}>−{pct(netPct)}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{row ? eur(row.totalNet) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {imp && (imp.unmatched.length > 0 || imp.warnings.length > 0) && (
          <div style={{ ...card, borderColor: "#fcd34d", background: "#fffbeb", fontSize: 13 }}>
            {imp.unmatched.length > 0 && (<>
              <b>Produits de votre fichier qui ne font pas partie de l'opération ({imp.unmatched.length})</b>
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{imp.unmatched.slice(0, 30).map((u, i) => <li key={i}>{u.name}{u.cip ? ` (${u.cip})` : ""} — {u.qty}</li>)}</ul>
            </>)}
            {imp.warnings.map((w, i) => <div key={i} style={{ marginTop: 6 }}>⚠️ {w}</div>)}
          </div>
        )}

        <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end" }}>
          <table style={{ fontSize: 13, borderCollapse: "collapse", minWidth: 280 }}>
            <tbody>
              <Tot label={`Montant brut HT (${t.units} u. facturées)`} v={eur(t.gross)} />
              {t.invoiceDiscount > 0.004 && <Tot label="Remises sur facture" v={"− " + eur(t.invoiceDiscount)} />}
              {t.rfaValue > 0.004 && <Tot label="Remise de fin d'année" v={"− " + eur(t.rfaValue)} />}
              {t.coop > 0.004 && <Tot label="Coopération commerciale" v={"− " + eur(t.coop)} />}
              <Tot label={`Frais de traitement (${pct(t.feePct)})`} v={"+ " + eur(t.fee)} />
              <Tot label="Total HT" v={eur(t.totalHT)} strong />
              {t.freeUnits > 0 && <tr><td colSpan={2} style={{ padding: "4px 0", color: "#15803d", fontSize: 12, fontWeight: 700 }}>+ {t.freeUnits} unités gratuites (valeur {eur(t.ugValue)}) : {t.receivedUnits} unités reçues</td></tr>}
              {t.vat > 0 && <Tot label="TVA" v={eur(t.vat)} />}
              {t.vat > 0 && <Tot label="Total TTC" v={eur(t.totalTTC)} />}
            </tbody>
          </table>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            {op.tier_mode !== "individuel" && editable && <div style={{ fontSize: 11, color: "#64748b", maxWidth: 360, textAlign: "right" }}>Prix estimés avec les quantités du groupe à cet instant : ils peuvent encore s'améliorer jusqu'à la clôture. La part des gratuités gagnées par le groupe est provisoire.</div>}
            {dirty && editable && <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700 }}>Modifications non confirmées</div>}
            {editable && packProblems.length > 0 && <div role="alert" style={{ fontSize: 12, color: "#991b1b", fontWeight: 700, maxWidth: 420, textAlign: "right" }}>📦 {packProblems.length} quantité{packProblems.length > 1 ? "s" : ""} hors colisage (cases en rouge) : corrigez-{packProblems.length > 1 ? "les" : "la"} pour confirmer.</div>}
            {editable && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,.xls,.xlsx,.ods,image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={e => importLgo(e.target.files?.[0])} />
                <button style={btn(false)} disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === "import" ? "Analyse…" : "📄 Importer mon bon de commande (LGO)"}</button>
                <button style={{ ...btn(true), opacity: busy || packProblems.length || (!dirty && !confirmed && !hasQty(grid)) ? 0.6 : 1 }} disabled={!!busy || packProblems.length > 0 || (!dirty && !confirmed && !hasQty(grid))} onClick={confirm}>
                  {busy === "save" ? "Envoi…" : confirmed ? (dirty ? "Enregistrer les modifications" : "Renvoyer la confirmation") : "Confirmer ma commande"}
                </button>
              </div>
            )}
          </div>
        </div>
      </>)}
      {msg && <Msg m={msg} />}
      {stale && <button style={{ ...btn(true), alignSelf: "flex-start" }} onClick={() => loadView(selId)}>↻ Recharger ma commande</button>}
    </div>
  );
}

function Tot({ label, v, strong }) {
  return <tr><td style={{ padding: "3px 16px 3px 0", color: strong ? "#0f2d3d" : "#475569", fontWeight: strong ? 800 : 500 }}>{label}</td><td style={{ textAlign: "right", fontWeight: strong ? 800 : 600, whiteSpace: "nowrap" }}>{v}</td></tr>;
}

function Msg({ m }) {
  const c = { ok: ["#dcfce7", "#166534"], err: ["#fee2e2", "#991b1b"], info: ["#e0f2fe", "#075985"] }[m.type] || ["#f1f5f9", "#334155"];
  return <div role="status" style={{ background: c[0], color: c[1], borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{m.text}</div>;
}

export function Objective({ o }) {
  const unit = o.type === "unites" ? " unités" : "";
  const f = (n) => o.type === "unites" ? Math.round(n).toLocaleString("fr-FR") : eur(n);
  const label = { unites: "Objectif du groupe", montant_brut: "Objectif du groupe (montant brut)", montant_net: "Objectif du groupe (montant remisé)" }[o.type];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4, gap: 8, flexWrap: "wrap" }}>
        <span>{label} : {f(o.target)}{unit}</span>
        <span style={{ color: o.reached ? "#166534" : "#0369a1" }}>{o.reached ? "✓ Objectif atteint" : `${f(o.value)}${unit} · encore ${f(o.missing)}${unit}`}</span>
      </div>
      <div style={{ height: 10, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${o.pct}%`, height: "100%", background: o.reached ? "#22c55e" : "linear-gradient(90deg, #2d9cbc, #0f2d3d)", transition: "width .3s" }} />
      </div>
    </div>
  );
}
