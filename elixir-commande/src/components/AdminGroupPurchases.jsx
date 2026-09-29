import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { priceLine, ugLabel, IMMEDIATE_SLOT, round2 } from "../gp-pricing.js";
import { analyzeFile } from "../gp-files.js";
import { Objective } from "./GroupOrders.jsx";

const API = "/.netlify/functions/gp-admin";
const LS = { fontSize: 12, fontWeight: 700, color: "#444", display: "block", marginBottom: 6 };
const IS = { width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
const CI = { ...IS, padding: "6px 8px", borderRadius: 8, fontSize: 12 };
const card = { background: "white", borderRadius: 14, padding: "18px 20px", border: "1px solid #e2e8f0", marginBottom: 16 };
const h3 = { fontSize: 13, fontWeight: 800, color: "#0f2d3d", textTransform: "uppercase", letterSpacing: 0.3, margin: "0 0 12px" };
const btn = (kind = "sec") => ({ border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
  ...(kind === "pri" ? { background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", color: "white" }
    : kind === "ok" ? { background: "#16a34a", color: "white" } : kind === "danger" ? { background: "#fee2e2", color: "#991b1b" } : { background: "#eef2f5", color: "#0f2d3d" }) });
const grid = (cols) => ({ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "end" });

const eur = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const dfr = (d) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
const STATUS = { brouillon: ["Brouillon", "#64748b"], ouverte: ["Ouverte", "#16a34a"], cloturee: ["Clôturée", "#d97706"], commandee: ["Commandée labo", "#2563eb"], terminee: ["Terminée", "#0f2d3d"], annulee: ["Annulée", "#991b1b"] };
const EMPTY_OP = { name: "", supplier_name: "", supplier_odoo_id: null, status: "brouillon", start_date: "", end_date: "", tier_mode: "collectif", fee_pct: 2,
  centralizer_type: "elixir", centralizer_cip: null, centralizer_name: null, objective_type: "aucun", objective_value: "", delivery_slots: [],
  rfa_pct: 0, coop_mode: "aucune", coop_amount: 0, coop_label: "", conditions_text: "", notes: "" };

// Paliers saisis en texte : « 10:5, 50:8 » (dès 10 u. → 5 %) et « 12+2, 24+5 » (UG)
const tiersToText = (t) => (t || []).map(x => `${x.min_qty}:${x.pct}`).join(", ");
const ugToText = (t) => (t || []).map(x => `${x.min_qty}+${x.free_qty}`).join(", ");
const num = (s) => parseFloat(String(s).replace(",", "."));
const parseTiers = (s) => String(s || "").split(/[;,\n]+/).map(p => p.trim()).filter(Boolean).map(p => { const [a, b] = p.split(/[:→=]/); return { min_qty: num(a), pct: num(String(b || "").replace("%", "")) }; }).filter(t => t.min_qty > 0 && t.pct > 0).sort((a, b) => a.min_qty - b.min_qty);
const parseUg = (s) => String(s || "").split(/[;,\n]+/).map(p => p.trim()).filter(Boolean).map(p => { const [a, b] = p.split("+"); return { min_qty: num(a), free_qty: num(b) }; }).filter(t => t.min_qty > 0 && t.free_qty > 0).sort((a, b) => a.min_qty - b.min_qty);
const withText = (l) => ({ ...l, _tiers: tiersToText(l.discount_tiers), _ug: ugToText(l.ug_tiers) });
const newSlotId = () => Math.random().toString(36).slice(2, 10);

export default function AdminGroupPurchases({ adminFetch, flash }) {
  const [view, setView] = useState("list");       // list | edit | access
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(EMPTY_OP);
  const [lines, setLines] = useState([]);
  const [parts, setParts] = useState([]);
  const [detail, setDetail] = useState(null);     // réponse « get » : suivi, stock, déclenchements
  const [access, setAccess] = useState([]);
  const [busy, setBusy] = useState("");

  const call = useCallback(async (qs, body) => {
    const r = await adminFetch(body ? API : `${API}?${qs}`, body ? { method: "POST", body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  }, [adminFetch]);

  const loadList = useCallback(async () => {
    setLoading(true); setErr("");
    try { setOps((await call("action=list")).operations || []); }
    catch (e) { setErr(e.message.includes("gp_operations") ? "Les tables des commandes groupées n'existent pas encore : exécutez le script sql/gp-schema.sql dans Supabase." : e.message); }
    setLoading(false);
  }, [call]);
  const loadAccess = useCallback(async () => { try { setAccess((await call("action=access")).access || []); } catch (e) { setErr(e.message); } }, [call]);
  useEffect(() => { loadList(); loadAccess(); }, [loadList, loadAccess]);

  const open = async (id) => {
    setBusy("load"); setErr("");
    try {
      const d = await call(`action=get&id=${id}`);
      setDetail(d); setForm({ ...EMPTY_OP, ...d.op }); setLines(d.lines.map(withText)); setParts(d.participants); setView("edit");
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const create = () => { setDetail(null); setForm({ ...EMPTY_OP }); setLines([]); setParts([]); setView("edit"); };
  const reload = () => form.id && open(form.id);

  const save = async () => {
    setBusy("save"); setErr("");
    try {
      const payloadLines = lines.map(l => ({ ...l, discount_tiers: parseTiers(l._tiers), ug_tiers: parseUg(l._ug) }));
      const r = await call(null, { action: "save", operation: { ...form, objective_value: form.objective_value === "" ? null : form.objective_value }, lines: payloadLines });
      await call(null, { action: "participants", id: r.operation.id, pharmacies: parts.map(p => ({ cip: p.pharmacy_cip, name: p.pharmacy_name, email: p.email, fee_pct: p.fee_pct })) });
      flash?.("✅ Opération enregistrée");
      await open(r.operation.id); loadList(); loadAccess();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  const setStatus = async (status, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy("status");
    try { await call(null, { action: "status", id: form.id, status }); await open(form.id); loadList(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement l'opération « ${form.name} » et toutes ses commandes ?`)) return;
    try { await call(null, { action: "delete", id: form.id }); setView("list"); loadList(); } catch (e) { setErr(e.message); }
  };

  if (view === "access") return <AccessView access={access} setAccess={setAccess} call={call} back={() => setView("list")} err={err} setErr={setErr} />;

  if (view === "list") return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2d3d" }}>🤝 Commandes groupées</div>
          <div style={{ fontSize: 13, color: "#64748b" }}>{access.length} pharmacie(s) autorisée(s) à voir l'onglet</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn()} onClick={() => setView("access")}>🏥 Pharmacies autorisées</button>
          <button style={btn("pri")} onClick={create}>＋ Nouvelle opération</button>
        </div>
      </div>
      {err && <Err text={err} />}
      {loading && <div style={card}>Chargement…</div>}
      {!loading && !ops.length && !err && <div style={card}>Aucune opération pour le moment.</div>}
      {ops.map(o => {
        const [label, color] = STATUS[o.status] || [o.status, "#666"];
        return (
          <div key={o.id} onClick={() => open(o.id)} style={{ ...card, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800, color: "#0f2d3d" }}>{o.name}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{o.supplier_name || "Fournisseur ?"} · du {dfr(o.start_date)} au {dfr(o.end_date)} · {o.participants_count} participant(s) · {o.orders_count} commande(s)</div>
              {o.pending_slots?.length > 0 && <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 2 }}>⏰ {o.pending_slots.length} livraison(s) à déclencher</div>}
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color: "white", background: color, borderRadius: 99, padding: "3px 10px" }}>{label}</span>
          </div>
        );
      })}
      {busy === "load" && <div style={card}>Ouverture…</div>}
    </div>
  );

  // ── Édition d'une opération ──
  const locked = ["commandee", "terminee", "annulee"].includes(form.status);
  const f = (k) => (e) => setForm(x => ({ ...x, [k]: e.target.type === "number" ? e.target.value : e.target.value }));
  const [stLabel, stColor] = STATUS[form.status] || [form.status, "#666"];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={btn()} onClick={() => { setView("list"); loadList(); }}>← Opérations</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f2d3d" }}>{form.name || "Nouvelle opération"}</div>
          <span style={{ fontSize: 11, fontWeight: 800, color: "white", background: stColor, borderRadius: 99, padding: "3px 10px" }}>{stLabel}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {form.id && form.status === "brouillon" && <button style={btn("ok")} disabled={!!busy} onClick={() => setStatus("ouverte", "Ouvrir l'opération aux pharmacies participantes ? Pensez à enregistrer vos modifications avant.")}>▶ Ouvrir aux commandes</button>}
          {form.status === "ouverte" && <button style={btn()} disabled={!!busy} onClick={() => setStatus("cloturee", "Clôturer l'opération ? Les pharmacies ne pourront plus modifier leur commande.")}>⏹ Clôturer</button>}
          {form.status === "cloturee" && <button style={btn()} disabled={!!busy} onClick={() => setStatus("ouverte")}>↺ Rouvrir</button>}
          {form.status === "commandee" && <button style={btn()} disabled={!!busy} onClick={() => setStatus("terminee", "Marquer l'opération comme terminée ?")}>✓ Terminée</button>}
          <button style={btn("pri")} disabled={!!busy} onClick={save}>{busy === "save" ? "Enregistrement…" : "💾 Enregistrer"}</button>
        </div>
      </div>
      {err && <Err text={err} />}

      <OfferImport adminFetch={adminFetch} form={form} setForm={setForm} setLines={setLines} lines={lines} disabled={locked} />

      <div style={card}>
        <div style={h3}>Opération</div>
        <div style={grid("2fr 2fr 1fr 1fr")}>
          <div><label style={LS}>Nom *</label><input style={IS} value={form.name} onChange={f("name")} placeholder="ex. Opération hiver Pfizer" /></div>
          <SupplierPicker call={call} form={form} setForm={setForm} />
          <div><label style={LS}>Début</label><input type="date" style={IS} value={form.start_date || ""} onChange={f("start_date")} /></div>
          <div><label style={LS}>Fin (clôture)</label><input type="date" style={IS} value={form.end_date || ""} onChange={f("end_date")} /></div>
        </div>
        <div style={{ ...grid("1fr 1fr 1fr 1fr"), marginTop: 12 }}>
          <div><label style={LS}>Paliers calculés sur</label>
            <select style={IS} value={form.tier_mode} onChange={f("tier_mode")}><option value="collectif">le total du groupe</option><option value="individuel">chaque pharmacie</option></select></div>
          <div><label style={LS}>Frais de traitement (%)</label><input type="number" step="0.1" style={IS} value={form.fee_pct} onChange={f("fee_pct")} /></div>
          <div><label style={LS}>Centralisation des achats</label>
            <select style={IS} value={form.centralizer_type} onChange={f("centralizer_type")}><option value="elixir">Elixir Pharma</option><option value="pharmacie">Une pharmacie</option></select></div>
          {form.centralizer_type === "pharmacie" ? (
            <div><label style={LS}>Pharmacie centralisatrice</label>
              <select style={IS} value={form.centralizer_cip || ""} onChange={e => { const p = parts.find(x => x.pharmacy_cip === e.target.value); setForm(x => ({ ...x, centralizer_cip: e.target.value || null, centralizer_name: p?.pharmacy_name || null })); }}>
                <option value="">— choisir parmi les participants —</option>
                {parts.map(p => <option key={p.pharmacy_cip} value={p.pharmacy_cip}>{p.pharmacy_name}</option>)}
              </select></div>
          ) : <div />}
        </div>
        <div style={{ ...grid("1fr 1fr 1fr 1fr"), marginTop: 12 }}>
          <div><label style={LS}>Objectif</label>
            <select style={IS} value={form.objective_type} onChange={f("objective_type")}>
              <option value="aucun">Aucun</option><option value="unites">Unités (produits ×2 comptés double)</option><option value="montant_brut">Montant brut HT</option><option value="montant_net">Montant remisé HT</option>
            </select></div>
          <div><label style={LS}>{form.objective_type === "unites" ? "Unités à atteindre" : "Montant à atteindre (€)"}</label><input type="number" style={IS} disabled={form.objective_type === "aucun"} value={form.objective_value ?? ""} onChange={f("objective_value")} /></div>
          <div><label style={LS}>Remise de fin d'année (%)</label><input type="number" step="0.1" style={IS} value={form.rfa_pct} onChange={f("rfa_pct")} /></div>
          <div />
        </div>
        <div style={{ ...grid("1fr 1fr 2fr"), marginTop: 12 }}>
          <div><label style={LS}>Coopération commerciale</label>
            <select style={IS} value={form.coop_mode} onChange={f("coop_mode")}><option value="aucune">Aucune</option><option value="par_pharmacie">Montant par pharmacie</option><option value="total">Montant global (prorata)</option></select></div>
          <div><label style={LS}>Montant (€)</label><input type="number" style={IS} disabled={form.coop_mode === "aucune"} value={form.coop_amount} onChange={f("coop_amount")} /></div>
          <div><label style={LS}>Contrepartie</label><input style={IS} disabled={form.coop_mode === "aucune"} value={form.coop_label || ""} onChange={f("coop_label")} placeholder="ex. mise en avant du produit en vitrine" /></div>
        </div>
        <div style={{ ...grid("1fr 1fr"), marginTop: 12 }}>
          <div><label style={LS}>Conditions affichées aux pharmacies</label><textarea style={{ ...IS, minHeight: 64 }} value={form.conditions_text || ""} onChange={f("conditions_text")} /></div>
          <div><label style={LS}>Notes internes</label><textarea style={{ ...IS, minHeight: 64 }} value={form.notes || ""} onChange={f("notes")} /></div>
        </div>
      </div>

      <Slots form={form} setForm={setForm} />
      <LinesEditor lines={lines} setLines={setLines} call={call} form={form} products={detail?.products || {}} locked={locked} />
      <Participants parts={parts} setParts={setParts} access={access} call={call} opFee={form.fee_pct} />

      {detail && form.id && <Dashboard detail={detail} form={form} />}
      {detail && form.id && ["cloturee", "commandee", "terminee"].includes(form.status) && <Fulfilment detail={detail} form={form} call={call} reload={reload} />}

      {form.id && <div style={{ textAlign: "right" }}><button style={btn("danger")} onClick={() => form.status === "brouillon" ? remove() : setStatus("annulee", "Annuler l'opération ? Elle ne sera plus visible des pharmacies.")}>{form.status === "brouillon" ? "Supprimer l'opération" : "Annuler l'opération"}</button></div>}
    </div>
  );
}

function Err({ text }) { return <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{text}</div>; }

// ── Fournisseur Odoo ──
function SupplierPicker({ call, form, setForm }) {
  const [res, setRes] = useState(null);
  const search = async () => { try { setRes((await call(`action=suppliers&q=${encodeURIComponent(form.supplier_name || "")}`)).suppliers || []); } catch { setRes([]); } };
  return (
    <div style={{ position: "relative" }}>
      <label style={LS}>Fournisseur {form.supplier_odoo_id ? <span style={{ color: "#16a34a" }}>· Odoo #{form.supplier_odoo_id}</span> : <span style={{ color: "#b45309" }}>· non relié à Odoo</span>}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={IS} value={form.supplier_name || ""} onChange={e => setForm(x => ({ ...x, supplier_name: e.target.value, supplier_odoo_id: null }))} onKeyDown={e => e.key === "Enter" && search()} placeholder="Nom du laboratoire" />
        <button style={btn()} onClick={search} title="Chercher dans les fournisseurs Odoo">🔎</button>
      </div>
      {res && (
        <div style={{ position: "absolute", zIndex: 5, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", marginTop: 4, width: "100%", maxHeight: 240, overflowY: "auto" }}>
          {!res.length && <div style={{ padding: 10, fontSize: 12, color: "#64748b" }}>Aucun fournisseur trouvé</div>}
          {res.map(s => <div key={s.id} onClick={() => { setForm(x => ({ ...x, supplier_name: s.name, supplier_odoo_id: s.id })); setRes(null); }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13 }}>{s.name} <span style={{ color: "#94a3b8" }}>#{s.id}</span></div>)}
        </div>
      )}
    </div>
  );
}

// ── Cadencement des livraisons ──
function Slots({ form, setForm }) {
  const slots = form.delivery_slots || [];
  const set = (i, k, v) => setForm(x => ({ ...x, delivery_slots: x.delivery_slots.map((s, j) => j === i ? { ...s, [k]: v } : s) }));
  return (
    <div style={card}>
      <div style={h3}>Livraisons (cadencement)</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Chaque date devient une colonne de saisie pour les pharmacies. Les produits en stock ont en plus une colonne « Immédiat ». Sans date, une seule colonne « Quantité » (livraison à réception).</div>
      {slots.map((s, i) => (
        <div key={s.id} style={{ ...grid("180px 1fr 40px"), marginBottom: 8 }}>
          <input type="date" style={IS} value={s.date || ""} onChange={e => set(i, "date", e.target.value)} />
          <input style={IS} value={s.label || ""} onChange={e => set(i, "label", e.target.value)} placeholder={`Libellé (ex. Livraison ${i + 1})`} />
          <button style={btn("danger")} onClick={() => setForm(x => ({ ...x, delivery_slots: x.delivery_slots.filter((_, j) => j !== i) }))}>✕</button>
        </div>
      ))}
      <button style={btn()} onClick={() => setForm(x => ({ ...x, delivery_slots: [...(x.delivery_slots || []), { id: newSlotId(), date: "", label: "" }] }))}>＋ Ajouter une date de livraison</button>
    </div>
  );
}

// ── Produits de l'opération ──
function LinesEditor({ lines, setLines, call, form, products, locked }) {
  const [cip, setCip] = useState("");
  const [info, setInfo] = useState(products);
  useEffect(() => setInfo(i => ({ ...i, ...products })), [products]);
  const set = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const add = async () => {
    const c = cip.replace(/\D/g, "");
    if (!c) return;
    let p = {};
    try { p = (await call(null, { action: "lookup", cips: [c] })).products?.[c] || {}; setInfo(i => ({ ...i, [c]: p })); } catch {}
    setLines(ls => [...ls, withText({ cip: c, name: p.odoo_name || "", odoo_product_id: p.odoo_product_id || null, price_gross: "", discount_mode: "aucune", discount_pct: 0, discount_tiers: [], ug_tiers: [], weight: 1, vat_rate: p.vat_rate ?? null, notes: "" })]);
    setCip("");
  };
  const refresh = async () => {
    try { const p = (await call(null, { action: "lookup", cips: lines.map(l => l.cip) })).products || {}; setInfo(p);
      setLines(ls => ls.map(l => ({ ...l, odoo_product_id: l.odoo_product_id || p[l.cip]?.odoo_product_id || null, vat_rate: l.vat_rate ?? p[l.cip]?.vat_rate ?? null, name: l.name || p[l.cip]?.odoo_name || "" }))); } catch {}
  };
  const th = { textAlign: "left", padding: "6px 6px", fontSize: 11, color: "#64748b", fontWeight: 700 };
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...h3, margin: 0 }}>Produits ({lines.length})</div>
        <button style={btn()} onClick={refresh}>↻ Stock et fiches Odoo</button>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Paliers de remise : <code>10:5, 50:8</code> = −5 % dès 10 unités, −8 % dès 50. UG : <code>12+2, 24+5</code> = 2 gratuites pour 12 facturées, 5 pour 24. « ×obj. » = poids dans l'objectif en unités (2 = compte double).</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1050 }}>
          <thead><tr><th style={th}>CIP</th><th style={th}>Désignation</th><th style={th}>Prix brut HT</th><th style={th}>Remise sur facture</th><th style={th}>UG</th><th style={th}>×obj.</th><th style={th}>TVA</th><th style={th}>Odoo</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const p = info[l.cip] || {};
              return (
                <tr key={l.id || i} style={{ borderTop: "1px solid #f1f5f9", verticalAlign: "top" }}>
                  <td style={{ padding: 4, width: 130 }}><input style={CI} value={l.cip} disabled={locked} onChange={e => set(i, "cip", e.target.value.replace(/\D/g, ""))} /></td>
                  <td style={{ padding: 4 }}><input style={CI} value={l.name} disabled={locked} onChange={e => set(i, "name", e.target.value)} />
                    <input style={{ ...CI, marginTop: 4, fontSize: 11 }} value={l.notes || ""} disabled={locked} onChange={e => set(i, "notes", e.target.value)} placeholder="note visible des pharmacies" /></td>
                  <td style={{ padding: 4, width: 90 }}><input style={CI} value={l.price_gross ?? ""} disabled={locked} onChange={e => set(i, "price_gross", e.target.value.replace(",", "."))} /></td>
                  <td style={{ padding: 4, width: 200 }}>
                    <select style={CI} value={l.discount_mode} disabled={locked} onChange={e => set(i, "discount_mode", e.target.value)}><option value="aucune">Aucune</option><option value="unitaire">Taux unique</option><option value="paliers">Paliers</option></select>
                    {l.discount_mode === "unitaire" && <input style={{ ...CI, marginTop: 4 }} value={l.discount_pct} disabled={locked} onChange={e => set(i, "discount_pct", e.target.value.replace(",", "."))} placeholder="%" />}
                    {l.discount_mode === "paliers" && <input style={{ ...CI, marginTop: 4 }} value={l._tiers} disabled={locked} onChange={e => set(i, "_tiers", e.target.value)} onBlur={() => set(i, "_tiers", tiersToText(parseTiers(l._tiers)))} placeholder="10:5, 50:8" />}
                  </td>
                  <td style={{ padding: 4, width: 130 }}><input style={CI} value={l._ug} disabled={locked} onChange={e => set(i, "_ug", e.target.value)} onBlur={() => set(i, "_ug", ugToText(parseUg(l._ug)))} placeholder="12+2" />
                    {parseUg(l._ug).map((t, k) => <div key={k} style={{ fontSize: 10, color: "#64748b" }}>{ugLabel(t)}</div>)}</td>
                  <td style={{ padding: 4, width: 56 }}><input style={CI} value={l.weight} disabled={locked} onChange={e => set(i, "weight", e.target.value.replace(",", "."))} /></td>
                  <td style={{ padding: 4, width: 64 }}><input style={CI} value={l.vat_rate ?? ""} disabled={locked} onChange={e => set(i, "vat_rate", e.target.value.replace(",", "."))} placeholder="%" /></td>
                  <td style={{ padding: "8px 4px", fontSize: 11, width: 120 }}>
                    {l.odoo_product_id || p.odoo_product_id ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ fiche</span> : <span style={{ color: "#b91c1c", fontWeight: 700 }}>✕ absente</span>}
                    {p.in_stock != null && <div style={{ color: p.in_stock ? "#16a34a" : "#b45309" }}>{p.in_stock ? `stock ${p.available}` : "précommande"}</div>}
                    {p.elixir_price != null && <div style={{ color: "#64748b" }}>Elixir {eur(p.elixir_price)}</div>}
                  </td>
                  <td style={{ padding: 4 }}>{!locked && <button style={{ ...btn("danger"), padding: "6px 10px" }} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 420 }}>
          <input style={IS} value={cip} onChange={e => setCip(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="CIP du produit à ajouter" />
          <button style={btn()} onClick={add}>＋ Ajouter</button>
        </div>
      )}
    </div>
  );
}

// ── Import IA d'une offre ──
function OfferImport({ adminFetch, form, setForm, lines, setLines, disabled }) {
  const [state, setState] = useState(null);    // { busy, secs, result, products, error }
  const [mode, setMode] = useState("remplacer");
  const [applyOp, setApplyOp] = useState(true);
  const ref = useRef(null);
  const run = async (file) => {
    if (!file) return;
    setState({ busy: true, secs: 0 });
    try {
      const token = localStorage.getItem("admin_token") || "";
      const r = await analyzeFile({ file, kind: "offre", opId: form.id, headers: { Authorization: `Bearer ${token}` }, onProgress: (s) => setState({ busy: true, secs: s }) });
      setState({ result: r.result, products: r.products || {}, file_name: r.file_name });
    } catch (e) { setState({ error: e.message }); }
    if (ref.current) ref.current.value = "";
  };
  const apply = () => {
    const { result, products } = state;
    const imported = result.lines.map(l => withText({ cip: l.cip, name: l.name || products[l.cip]?.odoo_name || "", odoo_product_id: products[l.cip]?.odoo_product_id || null,
      price_gross: l.price_gross ?? "", discount_mode: l.discount_mode, discount_pct: l.discount_pct || 0, discount_tiers: l.discount_tiers || [], ug_tiers: l.ug_tiers || [],
      weight: 1, vat_rate: products[l.cip]?.vat_rate ?? null, notes: l.notes || "" }));
    if (mode === "remplacer") setLines(imported);
    else { const have = new Set(lines.map(l => l.cip)); setLines([...lines, ...imported.filter(l => !have.has(l.cip))]); }
    if (applyOp) setForm(x => ({ ...x,
      name: x.name || result.operation_name || "", supplier_name: x.supplier_name || result.supplier_name || "",
      start_date: result.start_date || x.start_date, end_date: result.end_date || x.end_date,
      rfa_pct: result.rfa_pct ?? x.rfa_pct, coop_mode: result.coop_mode !== "aucune" ? result.coop_mode : x.coop_mode,
      coop_amount: result.coop_amount ?? x.coop_amount, coop_label: result.coop_label || x.coop_label,
      objective_type: result.objective_type !== "aucun" ? result.objective_type : x.objective_type, objective_value: result.objective_value ?? x.objective_value,
      conditions_text: result.conditions_text || x.conditions_text,
      delivery_slots: result.delivery_dates?.length ? result.delivery_dates.map((d, i) => ({ id: newSlotId(), date: d, label: `Livraison ${i + 1}` })) : x.delivery_slots }));
    setState(null);
  };
  const r = state?.result;
  return (
    <div style={{ ...card, background: "#f8fbff", borderColor: "#bfdbfe" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...h3, margin: 0 }}>📄 Importer l'offre du laboratoire</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Excel, CSV, PDF ou photo : l'IA relève les CIP, désignations, prix, remises, paliers, UG, RFA et coopération. Vous relisez avant d'appliquer.</div>
        </div>
        <input ref={ref} type="file" accept=".pdf,.csv,.txt,.xls,.xlsx,.ods,image/png,image/jpeg" style={{ display: "none" }} onChange={e => run(e.target.files?.[0])} />
        <button style={btn("pri")} disabled={disabled || state?.busy} onClick={() => ref.current?.click()}>{state?.busy ? `Analyse… ${state.secs || 0} s` : "Choisir un fichier"}</button>
      </div>
      {state?.error && <div style={{ marginTop: 10 }}><Err text={state.error} /></div>}
      {r && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: "#0f2d3d", marginBottom: 8 }}>
            <b>{r.lines.length} produit(s)</b> trouvé(s) dans « {state.file_name} »
            {r.supplier_name && <> · {r.supplier_name}</>}{r.start_date && <> · du {dfr(r.start_date)}</>}{r.end_date && <> au {dfr(r.end_date)}</>}
            {r.rfa_pct ? <> · RFA {r.rfa_pct} %</> : null}{r.coop_amount ? <> · coopération {eur(r.coop_amount)}</> : null}
            {r.objective_type !== "aucun" && r.objective_value ? <> · objectif {r.objective_value} ({r.objective_type})</> : null}
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "white" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <tbody>
                {r.lines.map((l, i) => {
                  const p = state.products[l.cip] || {};
                  return (
                    <tr key={i} style={{ borderTop: i ? "1px solid #f1f5f9" : "none" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{l.cip}</td>
                      <td style={{ padding: "5px 8px" }}>{l.name}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{l.price_gross != null ? eur(l.price_gross) : "prix ?"}</td>
                      <td style={{ padding: "5px 8px" }}>{l.discount_mode === "unitaire" ? `−${l.discount_pct} %` : l.discount_mode === "paliers" ? tiersToText(l.discount_tiers) : ""} {ugToText(l.ug_tiers) && `UG ${ugToText(l.ug_tiers)}`}</td>
                      <td style={{ padding: "5px 8px", color: p.odoo_product_id ? "#16a34a" : "#b91c1c", fontWeight: 700 }}>{p.odoo_product_id ? (p.in_stock ? "✓ en stock" : "✓ précommande") : "✕ pas de fiche Odoo"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {r.warnings?.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>⚠️ {w}</div>)}
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12, flexWrap: "wrap", fontSize: 13 }}>
            <label><input type="radio" checked={mode === "remplacer"} onChange={() => setMode("remplacer")} /> Remplacer les produits</label>
            <label><input type="radio" checked={mode === "ajouter"} onChange={() => setMode("ajouter")} /> Ajouter aux produits existants</label>
            <label><input type="checkbox" checked={applyOp} onChange={e => setApplyOp(e.target.checked)} /> Reprendre dates et conditions</label>
            <button style={btn("ok")} onClick={apply}>Appliquer</button>
            <button style={btn()} onClick={() => setState(null)}>Ignorer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pharmacies participantes ──
function Participants({ parts, setParts, access, call, opFee }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const inOp = new Set(parts.map(p => p.pharmacy_cip));
  const addP = (p) => { if (!inOp.has(p.cip)) setParts(ps => [...ps, { pharmacy_cip: p.cip, pharmacy_name: p.name, email: p.email, fee_pct: null }]); };
  const search = async () => { try { setRes((await call(`action=pharmacies&q=${encodeURIComponent(q)}`)).pharmacies || []); } catch { setRes([]); } };
  const candidates = access.filter(a => !inOp.has(a.pharmacy_cip));
  return (
    <div style={card}>
      <div style={h3}>Pharmacies participantes ({parts.length})</div>
      {parts.map((p, i) => (
        <div key={p.pharmacy_cip} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: i ? "1px solid #f1f5f9" : "none", fontSize: 13 }}>
          <div style={{ flex: 1 }}><b>{p.pharmacy_name}</b> <span style={{ color: "#94a3b8" }}>CIP {p.pharmacy_cip} · {p.email}</span></div>
          <span style={{ fontSize: 11, color: "#64748b" }}>frais</span>
          <input style={{ ...CI, width: 70 }} value={p.fee_pct ?? ""} placeholder={String(opFee)} onChange={e => setParts(ps => ps.map(x => x.pharmacy_cip === p.pharmacy_cip ? { ...x, fee_pct: e.target.value === "" ? null : e.target.value.replace(",", ".") } : x))} />
          <span style={{ fontSize: 11, color: "#64748b" }}>%</span>
          <button style={{ ...btn("danger"), padding: "5px 10px" }} onClick={() => setParts(ps => ps.filter(x => x.pharmacy_cip !== p.pharmacy_cip))}>✕</button>
        </div>
      ))}
      {candidates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>Pharmacies autorisées non inscrites</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {candidates.map(a => <button key={a.pharmacy_cip} style={{ ...btn(), padding: "5px 10px", fontSize: 12 }} onClick={() => addP({ cip: a.pharmacy_cip, name: a.pharmacy_name, email: a.email })}>＋ {a.pharmacy_name || a.pharmacy_cip}</button>)}
            <button style={{ ...btn("pri"), padding: "5px 10px", fontSize: 12 }} onClick={() => candidates.forEach(a => addP({ cip: a.pharmacy_cip, name: a.pharmacy_name, email: a.email }))}>Tout ajouter</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, maxWidth: 520 }}>
        <input style={IS} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Chercher une autre pharmacie (nom, ville, CIP, e-mail)" />
        <button style={btn()} onClick={search}>🔎</button>
      </div>
      {res.map(p => (
        <div key={p.cip} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0" }}>
          <span>{p.name} <span style={{ color: "#94a3b8" }}>{p.ville} · CIP {p.cip}</span></span>
          <button style={{ ...btn(), padding: "4px 10px" }} disabled={inOp.has(p.cip)} onClick={() => addP(p)}>{inOp.has(p.cip) ? "inscrite" : "＋ Ajouter"}</button>
        </div>
      ))}
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Une pharmacie ajoutée ici est automatiquement autorisée à voir l'onglet. N'oubliez pas d'enregistrer.</div>
    </div>
  );
}

// ── Suivi de l'opération ──
function Dashboard({ detail, form }) {
  const s = detail.summary;
  const op = detail.op;
  const slots = [{ id: IMMEDIATE_SLOT, label: (op.delivery_slots || []).length ? "Immédiat" : "Quantité" }, ...(op.delivery_slots || []).map(x => ({ id: x.id, label: x.label || dfr(x.date) }))];
  const usedSlots = slots.filter(sl => detail.lines.some(l => (s.groupBySlot[l.id]?.[sl.id] || 0) > 0));
  const confirmed = s.pharmacies.filter(p => p.order?.status === "confirmee");
  const tot = confirmed.reduce((a, p) => { for (const k of ["gross", "net", "fee", "totalHT", "rfaValue", "coop", "units"]) a[k] = (a[k] || 0) + (p.totals?.[k] || 0); return a; }, {});
  const exportXlsx = () => {
    const rows = [];
    for (const p of confirmed) for (const l of detail.lines) for (const sl of slots) {
      const q = p.bySlot[l.id]?.[sl.id] || 0;
      if (q) rows.push({ Pharmacie: p.name, CIP_pharmacie: p.cip, Livraison: sl.label, CIP: l.cip, Produit: l.name, Quantite: q, Prix_brut_HT: Number(l.price_gross) });
    }
    const perPh = confirmed.map(p => ({ Pharmacie: p.name, CIP: p.cip, Unites: p.totals.units, Brut_HT: round2(p.totals.gross), Net_HT: round2(p.totals.net), RFA: round2(p.totals.rfaValue), Cooperation: round2(p.totals.coop), Frais: round2(p.totals.fee), Total_HT: round2(p.totals.totalHT), Confirmee_le: p.order?.confirmed_at?.slice(0, 10) }));
    const perLine = detail.lines.map(l => { const q = s.group[l.id] || 0; const p = priceLine(op, l, q, q); return { CIP: l.cip, Produit: l.name, Quantite_groupe: q, ...Object.fromEntries(slots.map(sl => [sl.label, s.groupBySlot[l.id]?.[sl.id] || 0])), Remise_facture_pct: p.invoicePct, UG: p.ug.free, Prix_net_labo: round2(p.unitAfterUg) }; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perLine), "Par produit");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perPh), "Par pharmacie");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Détail");
    XLSX.writeFile(wb, `Commande groupee - ${op.name}.xlsx`);
  };
  const th = { textAlign: "left", padding: "6px 8px", fontSize: 11, color: "#64748b", fontWeight: 700, whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", fontSize: 12, borderTop: "1px solid #f1f5f9" };
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ ...h3, margin: 0 }}>Suivi — {confirmed.length}/{s.pharmacies.length} commande(s) · {tot.units || 0} unités · {eur(tot.totalHT)} HT</div>
        <button style={btn()} onClick={exportXlsx}>⬇ Excel</button>
      </div>
      {s.objective && <div style={{ marginBottom: 14 }}><Objective o={s.objective} /></div>}
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>Produit</th>{usedSlots.map(sl => <th key={sl.id} style={{ ...th, textAlign: "right" }}>{sl.label}</th>)}<th style={{ ...th, textAlign: "right" }}>Total</th><th style={th}>Palier atteint</th><th style={th}>Prochain palier</th></tr></thead>
          <tbody>
            {detail.lines.map(l => {
              const q = s.group[l.id] || 0;
              const p = priceLine(op, l, q, q);
              return (
                <tr key={l.id}>
                  <td style={td}>{l.name}</td>
                  {usedSlots.map(sl => <td key={sl.id} style={{ ...td, textAlign: "right" }}>{s.groupBySlot[l.id]?.[sl.id] || ""}</td>)}
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{q}</td>
                  <td style={td}>{op.tier_mode === "individuel" ? "par pharmacie" : [p.invoicePct ? `−${p.invoicePct} %` : "", p.ug.free ? `${p.ug.free} UG` : ""].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={{ ...td, color: "#0369a1" }}>{op.tier_mode === "individuel" ? "" : p.nextInvoiceTier ? `encore ${p.nextInvoiceTier.missing} → −${p.nextInvoiceTier.pct} %` : p.ug.next ? `encore ${p.ug.next.missing} → ${p.ug.next.min_qty}+${p.ug.next.free_qty}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>Pharmacie</th><th style={th}>Statut</th><th style={{ ...th, textAlign: "right" }}>Unités</th><th style={{ ...th, textAlign: "right" }}>Brut HT</th><th style={{ ...th, textAlign: "right" }}>RFA</th><th style={{ ...th, textAlign: "right" }}>Coop.</th><th style={{ ...th, textAlign: "right" }}>Net HT</th><th style={{ ...th, textAlign: "right" }}>Frais</th><th style={{ ...th, textAlign: "right" }}>Total HT</th><th style={th}>Source</th></tr></thead>
          <tbody>
            {s.pharmacies.map(p => (
              <tr key={p.cip}>
                <td style={td}><b>{p.name}</b></td>
                <td style={td}>{p.order?.status === "confirmee" ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ {dfr(p.order.confirmed_at)}{p.order.email_sent_at ? " ✉️" : ""}</span> : <span style={{ color: "#94a3b8" }}>pas encore</span>}</td>
                {p.totals ? (<>
                  <td style={{ ...td, textAlign: "right" }}>{p.totals.units}</td><td style={{ ...td, textAlign: "right" }}>{eur(p.totals.gross)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{p.totals.rfaValue ? eur(p.totals.rfaValue) : ""}</td><td style={{ ...td, textAlign: "right" }}>{p.totals.coop ? eur(p.totals.coop) : ""}</td>
                  <td style={{ ...td, textAlign: "right" }}>{eur(p.totals.net)}</td><td style={{ ...td, textAlign: "right" }}>{eur(p.totals.fee)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{eur(p.totals.totalHT)}</td>
                </>) : <td style={td} colSpan={7} />}
                <td style={td}>{p.order?.status !== "confirmee" ? "" : p.order.source === "fichier" ? `📄 ${p.order.file_name || "fichier"}` : "formulaire"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Bon de commande labo et commandes clients ──
function Fulfilment({ detail, form, call, reload }) {
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState(null);
  const op = detail.op;
  const s = detail.summary;
  const slots = [{ id: IMMEDIATE_SLOT, label: (op.delivery_slots || []).length ? "Livraison immédiate (produits en stock)" : "Livraison à réception", date: null }, ...(op.delivery_slots || []).map(x => ({ id: x.id, label: x.label || "Livraison", date: x.date }))];
  const po = async () => {
    if (!window.confirm("Créer le bon de commande (brouillon) chez le fournisseur dans Odoo ?")) return;
    setBusy("po"); setOut(null);
    try { const r = await call(null, { action: "po_create", id: op.id }); setOut({ type: "po", ...r }); reload(); } catch (e) { setOut({ error: e.message }); }
    setBusy("");
  };
  const trigger = async (sl) => {
    if (!window.confirm(`Créer dans Odoo les devis des pharmacies pour « ${sl.label} » ? (stock reçu)`)) return;
    setBusy(sl.id); setOut(null);
    try { const r = await call(null, { action: "trigger", id: op.id, slot_id: sl.id }); setOut({ type: "trigger", slot: sl.label, ...r }); reload(); } catch (e) { setOut({ error: e.message }); }
    setBusy("");
  };
  return (
    <div style={card}>
      <div style={h3}>Commandes Odoo</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13 }}><b>Bon de commande au laboratoire</b> {op.po_odoo_id ? <span style={{ color: "#16a34a" }}>· créé (Odoo #{op.po_odoo_id}, le {dfr(op.po_created_at)})</span> : <span style={{ color: "#64748b" }}>· à créer à la clôture (quantités totales, une ligne par date de livraison)</span>}</div>
        {!op.po_odoo_id && <button style={btn("pri")} disabled={!!busy} onClick={po}>{busy === "po" ? "Création…" : "Créer le bon de commande"}</button>}
      </div>
      {slots.map(sl => {
        const n = s.pharmacies.filter(p => p.order?.status === "confirmee" && Object.values(p.bySlot).some(x => (x[sl.id] || 0) > 0)).length;
        const done = (detail.triggers || []).filter(t => t.slot_id === sl.id).length;
        if (!n && !done) return null;
        return (
          <div key={sl.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid #f1f5f9", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}><b>{sl.label}</b>{sl.date ? ` · ${dfr(sl.date)}` : ""} · {n} pharmacie(s) · <span style={{ color: done >= n ? "#16a34a" : "#b45309" }}>{done} devis créé(s)</span></div>
            {done < n && <button style={btn("ok")} disabled={!!busy} onClick={() => trigger(sl)}>{busy === sl.id ? "Création…" : `Créer les commandes (${n - done})`}</button>}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Les devis sont créés en brouillon dans Odoo au nom de chaque pharmacie : prix brut de l'offre et une remise unique qui regroupe remise sur facture, UG, RFA et coopération, frais de traitement inclus. Vérifiez-les puis confirmez-les dans Odoo.</div>
      {out?.error && <div style={{ marginTop: 10 }}><Err text={out.error} /></div>}
      {out?.type === "po" && <div style={{ marginTop: 10, fontSize: 13, color: "#166534" }}>✓ Bon {out.po_name} créé : {out.lines} ligne(s), {eur(out.amount_ht)} HT.{out.skipped?.length ? ` Sans fiche Odoo (non repris) : ${out.skipped.join(", ")}` : ""}</div>}
      {out?.type === "trigger" && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {out.created.map(c => <div key={c.cip} style={{ color: "#166534" }}>✓ {c.name} : devis {c.so_name} ({eur(c.amount_ht)} HT)</div>)}
          {out.errors.map(c => <div key={c.cip} style={{ color: "#991b1b" }}>✕ {c.name} : {c.error}</div>)}
          {!out.created.length && !out.errors.length && <div>Rien à créer : toutes les commandes de cette livraison existent déjà.</div>}
        </div>
      )}
    </div>
  );
}

// ── Pharmacies autorisées à voir l'onglet ──
function AccessView({ access, setAccess, call, back, err, setErr }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const have = new Set(access.map(a => a.pharmacy_cip));
  const search = async () => { try { setRes((await call(`action=pharmacies&q=${encodeURIComponent(q)}`)).pharmacies || []); } catch (e) { setErr(e.message); } };
  const add = async (p) => { try { setAccess((await call(null, { action: "access_add", pharmacies: [{ cip: p.cip, name: p.name, email: p.email }] })).access); } catch (e) { setErr(e.message); } };
  const del = async (cip) => { try { setAccess((await call(null, { action: "access_remove", cip })).access); } catch (e) { setErr(e.message); } };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button style={btn()} onClick={back}>← Opérations</button>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f2d3d" }}>Pharmacies autorisées ({access.length})</div>
      </div>
      {err && <Err text={err} />}
      <div style={card}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Seules ces pharmacies voient l'onglet « Commandes groupées » dans leur menu. Vous choisissez ensuite, opération par opération, celles qui participent.</div>
        {access.map((a, i) => (
          <div key={a.pharmacy_cip} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i ? "1px solid #f1f5f9" : "none", fontSize: 13 }}>
            <span><b>{a.pharmacy_name}</b> <span style={{ color: "#94a3b8" }}>CIP {a.pharmacy_cip} · {a.email}</span></span>
            <button style={{ ...btn("danger"), padding: "5px 10px" }} onClick={() => del(a.pharmacy_cip)}>Retirer</button>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ display: "flex", gap: 8, maxWidth: 520 }}>
          <input style={IS} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Nom, ville, CIP ou e-mail" />
          <button style={btn("pri")} onClick={search}>Chercher</button>
        </div>
        {res.map(p => (
          <div key={p.cip} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0" }}>
            <span>{p.name} <span style={{ color: "#94a3b8" }}>{p.ville} · CIP {p.cip} · {p.email}</span></span>
            <button style={{ ...btn(), padding: "5px 10px" }} disabled={have.has(p.cip)} onClick={() => add(p)}>{have.has(p.cip) ? "autorisée" : "＋ Autoriser"}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
