import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { priceOrder, priceLine, objectiveProgress, sumSlots, IMMEDIATE_SLOT, round2 } from "../gp-pricing.js";
import { analyzeFile } from "../gp-files.js";

const eur = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const pct = (n) => `${round2(n || 0).toLocaleString("fr-FR")} %`;
const dfr = (d, opts = { day: "numeric", month: "long" }) => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", opts) : "";
const today = () => new Date().toISOString().slice(0, 10);
const daysLeft = (d) => Math.round((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400e3);

const card = { background: "white", borderRadius: 14, padding: "18px 22px", border: "1px solid #e8ecf0" };
const h2 = { fontSize: 13, fontWeight: 800, color: "#0f2d3d", letterSpacing: 0.3, textTransform: "uppercase", margin: "0 0 12px" };
const btn = (primary) => ({ border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer",
  background: primary ? "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)" : "#eef2f5", color: primary ? "white" : "#0f2d3d" });
const chip = (on) => ({ display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "2px 8px", margin: "2px 4px 2px 0",
  background: on ? "#dcfce7" : "#f1f5f9", color: on ? "#166534" : "#475569", border: on ? "1px solid #86efac" : "1px solid transparent" });
const STATUS = { ouverte: "Ouverte aux commandes", cloturee: "Clôturée", commandee: "Commandée au laboratoire", terminee: "Terminée" };

// Onglet « Commandes groupées » côté pharmacie
export default function GroupOrders({ pharmacyCip, pharmacyEmail }) {
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

  const headers = useMemo(() => { const t = localStorage.getItem("pharmacy_token"); return t ? { Authorization: `Bearer ${t}` } : {}; }, []);
  const api = useCallback(async (body) => {
    const r = await fetch("/.netlify/functions/gp-pharmacy", { method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ cip: pharmacyCip, email: pharmacyEmail, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  }, [headers, pharmacyCip, pharmacyEmail]);

  useEffect(() => {
    api({ action: "list" }).then(j => {
      setOps(j.operations || []);
      const open = (j.operations || []).filter(o => o.status === "ouverte");
      if (open.length === 1 || (j.operations || []).length === 1) setSelId((open[0] || j.operations[0]).id);
    }).catch(e => { setOps([]); setMsg({ type: "err", text: e.message }); });
  }, [api]);

  const loadView = useCallback((id) => {
    setBusy("load"); setImp(null);
    api({ action: "get", id }).then(v => {
      setView(v); setGrid(JSON.parse(JSON.stringify(v.my_order?.bySlot || {}))); setDirty(false);
      setSource({ source: "formulaire", file_name: null });
    }).catch(e => setMsg({ type: "err", text: e.message })).finally(() => setBusy(""));
  }, [api]);
  useEffect(() => { if (selId) loadView(selId); else setView(null); }, [selId, loadView]);

  const op = view?.operation;
  const lines = view?.lines || [];
  const editable = !!op && op.status === "ouverte" && (!op.start_date || today() >= op.start_date) && (!op.end_date || today() <= op.end_date);
  const inStock = (l) => !!view?.products?.[l.cip]?.in_stock;
  const slots = useMemo(() => {
    if (!op) return [];
    const ds = (op.delivery_slots || []).map(s => ({ id: s.id, label: s.label || `Livraison ${dfr(s.date, { day: "numeric", month: "short" })}`, date: s.date }));
    if (!ds.length) return [{ id: IMMEDIATE_SLOT, label: "Quantité", any: true }];
    return lines.some(inStock) ? [{ id: IMMEDIATE_SLOT, label: "Immédiat (en stock)" }, ...ds] : ds;
  }, [op, lines, view]);

  // ── Calcul en direct (même moteur que le serveur) ──
  const calc = useMemo(() => {
    if (!view) return null;
    const mine = sumSlots(grid);
    const group = Object.fromEntries(lines.map(l => [l.id, (view.group_others[l.id] || 0) + (mine[l.id] || 0)]));
    const noCoop = priceOrder({ ...op, coop_mode: "aucune" }, lines, mine, group, { feePct: view.fee_pct });
    const summary = priceOrder(op, lines, mine, group, { groupNetAfterRfa: view.group_net_others + noCoop.totals.net, feePct: view.fee_pct });
    return { mine, group, summary, objective: objectiveProgress(op, lines, group) };
  }, [view, grid, lines, op]);

  const setQty = (lineId, slotId, v) => {
    const q = Math.max(0, Math.floor(Number(String(v).replace(/\D/g, "")) || 0));
    setGrid(g => ({ ...g, [lineId]: { ...(g[lineId] || {}), [slotId]: q } }));
    setDirty(true); setMsg(null);
  };

  const confirm = async () => {
    setBusy("save"); setMsg(null);
    try {
      const entries = [];
      for (const [line_id, s] of Object.entries(grid)) for (const [slot_id, qty] of Object.entries(s || {})) entries.push({ line_id, slot_id, qty: Number(qty) || 0 });
      const r = await api({ action: "save", id: op.id, entries, ...source });
      setView(r); setGrid(JSON.parse(JSON.stringify(r.my_order?.bySlot || {}))); setDirty(false); setImp(null);
      setOps(list => (list || []).map(o => o.id === op.id ? { ...o, my_order: { status: r.my_order.status } } : o));
      if (!r.total) setMsg({ type: "info", text: "Votre commande est vide : rien n'a été envoyé." });
      else setMsg({ type: "ok", text: r.mail?.sent ? `Commande enregistrée. Une confirmation a été envoyée à ${r.pharmacy.email}.` : `Commande enregistrée. (E-mail de confirmation non envoyé : ${r.mail?.reason || "erreur"})` });
    } catch (e) { setMsg({ type: "err", text: e.message }); }
    setBusy("");
  };

  const importLgo = async (file) => {
    if (!file) return;
    setBusy("import"); setMsg({ type: "info", text: "Analyse de votre bon de commande…" }); setImp(null);
    try {
      const r = await analyzeFile({ file, kind: "lgo", opId: op.id, headers, identity: { cip: pharmacyCip, email: pharmacyEmail },
        onProgress: (s) => setMsg({ type: "info", text: `Analyse de votre bon de commande… ${s} s` }) });
      const next = {};
      const firstSlot = (op.delivery_slots || [])[0]?.id;
      for (const [lineId, q] of Object.entries(r.result.qty || {})) {
        const l = lines.find(x => x.id === lineId);
        if (!l || !q) continue;
        const slot = !firstSlot || inStock(l) ? IMMEDIATE_SLOT : firstSlot;
        next[lineId] = { [slot]: q };
      }
      setGrid(next); setDirty(true); setSource({ source: "fichier", file_name: r.file_name });
      setImp({ matched: Object.keys(next).length, unmatched: r.result.unmatched || [], warnings: r.result.warnings || [] });
      setMsg({ type: "info", text: `${Object.keys(next).length} produit(s) repris de « ${r.file_name} ». Vérifiez les quantités et les dates, puis confirmez.` });
    } catch (e) { setMsg({ type: "err", text: e.message }); }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", borderRadius: 14, padding: "18px 24px", color: "white" }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>🤝 Commandes groupées</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Achetez ensemble pour obtenir de meilleures conditions. Les produits hors stock sont des précommandes, livrées aux dates prévues.</div>
      </div>

      {ops.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ops.map(o => (
            <button key={o.id} onClick={() => setSelId(o.id)} style={{ ...btn(o.id === selId), padding: "8px 14px", textAlign: "left" }}>
              {o.name}<span style={{ fontWeight: 500, opacity: 0.75, marginLeft: 6 }}>{o.my_order?.status === "confirmee" ? "✓ commandé" : STATUS[o.status]}</span>
            </button>
          ))}
        </div>
      )}

      {busy === "load" && <div style={card}>Chargement…</div>}
      {op && busy !== "load" && (<>
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f2d3d" }}>{op.name}</div>
              <div style={{ fontSize: 13, color: "#475569" }}>{op.supplier_name ? `${op.supplier_name} · ` : ""}{op.start_date ? `du ${dfr(op.start_date)} ` : ""}{op.end_date ? `au ${dfr(op.end_date, { day: "numeric", month: "long", year: "numeric" })}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: editable ? "#166534" : "#92400e" }}>{editable ? "Ouverte aux commandes" : STATUS[op.status] || op.status}</div>
              {editable && op.end_date && <div style={{ fontSize: 12, color: "#475569" }}>{daysLeft(op.end_date) === 0 ? "Clôture ce soir" : `Clôture dans ${daysLeft(op.end_date)} jour${daysLeft(op.end_date) > 1 ? "s" : ""}`}</div>}
              {view.my_order?.status === "confirmee" && <div style={{ fontSize: 12, color: "#166534" }}>✓ Commande confirmée le {dfr(view.my_order.confirmed_at?.slice(0, 10))}</div>}
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#334155", display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            <span>Paliers calculés sur {op.tier_mode === "individuel" ? "votre quantité" : <b>le total du groupe ({view.participants_count} pharmacies)</b>}</span>
            {Number(op.rfa_pct) > 0 && <span>Remise de fin d'année : <b>{pct(op.rfa_pct)}</b> (déduite du prix)</span>}
            {op.coop_mode !== "aucune" && Number(op.coop_amount) > 0 && <span>Coopération commerciale : <b>{eur(op.coop_amount)}</b> {op.coop_mode === "total" ? "à répartir au prorata" : "par pharmacie"}{op.coop_label ? ` (${op.coop_label})` : ""}</span>}
            <span>Frais de traitement : <b>{pct(view.fee_pct)}</b></span>
          </div>
          {op.conditions_text && <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", borderRadius: 8, padding: "8px 12px", whiteSpace: "pre-wrap" }}>{op.conditions_text}</div>}
          {calc?.objective && <Objective o={calc.objective} />}
        </div>

        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 }}>
                <th style={{ textAlign: "left", padding: "10px 14px" }}>Produit</th>
                <th style={{ textAlign: "right", padding: "10px 8px" }}>Prix brut</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Conditions</th>
                {slots.map(s => <th key={s.id} style={{ textAlign: "center", padding: "10px 6px", minWidth: 86 }}>{s.label}</th>)}
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
                return (
                  <tr key={l.id} style={{ borderTop: "1px solid #eef2f5", verticalAlign: "top" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 700, color: "#0f2d3d" }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>CIP {l.cip} · {stock ? <span style={{ color: "#166534", fontWeight: 700 }}>En stock</span> : <span style={{ color: "#b45309", fontWeight: 700 }}>Précommande</span>}{Number(l.weight) > 1 ? ` · compte ×${l.weight}` : ""}</div>
                      {l.notes && <div style={{ fontSize: 11, color: "#64748b" }}>{l.notes}</div>}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{eur(l.price_gross)}</td>
                    <td style={{ padding: "10px 8px", maxWidth: 240 }}>
                      {l.discount_mode === "unitaire" && Number(l.discount_pct) > 0 && <span style={chip(true)}>−{pct(l.discount_pct)}</span>}
                      {tiers.map((t, i) => <span key={i} style={chip(p.invoiceTier && Number(t.min_qty) === p.invoiceTier.min_qty)}>dès {t.min_qty} : −{pct(t.pct)}</span>)}
                      {(l.ug_tiers || []).map((t, i) => <span key={"u" + i} style={chip(p.ug.tier && Number(t.min_qty) === p.ug.tier.min_qty)}>{t.min_qty} + {t.free_qty} UG</span>)}
                      {p.nextInvoiceTier && <div style={{ fontSize: 11, color: "#0369a1", marginTop: 2 }}>Encore {p.nextInvoiceTier.missing} u.{op.tier_mode !== "individuel" ? " (groupe)" : ""} → −{pct(p.nextInvoiceTier.pct)}</div>}
                      {!p.nextInvoiceTier && p.ug.next && <div style={{ fontSize: 11, color: "#0369a1", marginTop: 2 }}>Encore {p.ug.next.missing} u.{op.tier_mode !== "individuel" ? " (groupe)" : ""} → {p.ug.next.min_qty} + {p.ug.next.free_qty} UG</div>}
                      {op.tier_mode !== "individuel" && <div style={{ fontSize: 11, color: "#94a3b8" }}>Groupe : {calc.group[l.id] || 0} u.</div>}
                    </td>
                    {slots.map(s => {
                      const allowed = s.any || s.id !== IMMEDIATE_SLOT || stock;
                      const v = grid[l.id]?.[s.id] || "";
                      return (
                        <td key={s.id} style={{ padding: "8px 6px", textAlign: "center" }}>
                          {allowed ? (
                            <input value={v} inputMode="numeric" disabled={!editable} onChange={e => setQty(l.id, s.id, e.target.value)} placeholder="0"
                              style={{ width: 64, border: "1.5px solid #d6dde3", borderRadius: 8, padding: "7px 6px", fontSize: 14, fontWeight: 700, textAlign: "center", background: editable ? "white" : "#f8fafc", fontFamily: "inherit" }} />
                          ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <b>{eur(row ? row.unitNet : p.unitAfterRfa)}</b>
                      {(row ? row.totalDiscountPct : (1 - p.unitAfterRfa / (p.gross || 1)) * 100) > 0.05 && <div style={{ fontSize: 11, color: "#166534" }}>−{pct(row ? row.totalDiscountPct : (1 - p.unitAfterRfa / (p.gross || 1)) * 100)}</div>}
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
              <Tot label={`Montant brut HT (${t.units} u.)`} v={eur(t.gross)} />
              {t.invoiceDiscount > 0.004 && <Tot label="Remises sur facture" v={"− " + eur(t.invoiceDiscount)} />}
              {t.ugValue > 0.004 && <Tot label="Unités gratuites (converties en remise)" v={"− " + eur(t.ugValue)} />}
              {t.rfaValue > 0.004 && <Tot label="Remise de fin d'année" v={"− " + eur(t.rfaValue)} />}
              {t.coop > 0.004 && <Tot label="Coopération commerciale" v={"− " + eur(t.coop)} />}
              <Tot label={`Frais de traitement (${pct(t.feePct)})`} v={"+ " + eur(t.fee)} />
              <Tot label="Total HT" v={eur(t.totalHT)} strong />
              {t.vat > 0 && <Tot label="TVA" v={eur(t.vat)} />}
              {t.vat > 0 && <Tot label="Total TTC" v={eur(t.totalTTC)} />}
            </tbody>
          </table>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            {op.tier_mode !== "individuel" && <div style={{ fontSize: 11, color: "#64748b", maxWidth: 360, textAlign: "right" }}>Prix estimés avec les quantités du groupe à cet instant : ils peuvent encore s'améliorer jusqu'à la clôture.</div>}
            {editable && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,.xls,.xlsx,.ods,image/png,image/jpeg" style={{ display: "none" }} onChange={e => importLgo(e.target.files?.[0])} />
                <button style={btn(false)} disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === "import" ? "Analyse…" : "📄 Importer mon bon de commande (LGO)"}</button>
                <button style={{ ...btn(true), opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={confirm}>
                  {busy === "save" ? "Envoi…" : view.my_order?.status === "confirmee" ? (dirty ? "Enregistrer les modifications" : "Renvoyer la confirmation") : "Confirmer ma commande"}
                </button>
              </div>
            )}
          </div>
        </div>
      </>)}
      {msg && <Msg m={msg} />}
    </div>
  );
}

function Tot({ label, v, strong }) {
  return <tr><td style={{ padding: "3px 16px 3px 0", color: strong ? "#0f2d3d" : "#475569", fontWeight: strong ? 800 : 500 }}>{label}</td><td style={{ textAlign: "right", fontWeight: strong ? 800 : 600, whiteSpace: "nowrap" }}>{v}</td></tr>;
}

function Msg({ m }) {
  const c = { ok: ["#dcfce7", "#166534"], err: ["#fee2e2", "#991b1b"], info: ["#e0f2fe", "#075985"] }[m.type] || ["#f1f5f9", "#334155"];
  return <div style={{ background: c[0], color: c[1], borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{m.text}</div>;
}

export function Objective({ o }) {
  const unit = o.type === "unites" ? " unités" : "";
  const f = (n) => o.type === "unites" ? Math.round(n).toLocaleString("fr-FR") : eur(n);
  const label = { unites: "Objectif du groupe", montant_brut: "Objectif du groupe (montant brut)", montant_net: "Objectif du groupe (montant remisé)" }[o.type];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
        <span>{label} : {f(o.target)}{unit}</span>
        <span style={{ color: o.reached ? "#166534" : "#0369a1" }}>{o.reached ? "✓ Objectif atteint" : `${f(o.value)}${unit} · encore ${f(o.missing)}${unit}`}</span>
      </div>
      <div style={{ height: 10, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${o.pct}%`, height: "100%", background: o.reached ? "#22c55e" : "linear-gradient(90deg, #2d9cbc, #0f2d3d)", transition: "width .3s" }} />
      </div>
    </div>
  );
}
