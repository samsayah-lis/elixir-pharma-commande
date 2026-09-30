import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { priceLine, ugLabel, invoiceDiscount, IMMEDIATE_SLOT, round2 } from "../gp-pricing.js";
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
const dfr = (d) => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
const STATUS = { brouillon: ["Brouillon", "#64748b"], ouverte: ["Ouverte", "#16a34a"], cloturee: ["Clôturée", "#d97706"], commandee: ["Commandée labo", "#2563eb"], terminee: ["Terminée", "#0f2d3d"], annulee: ["Annulée", "#991b1b"] };
const LOCKED = ["commandee", "terminee", "annulee"];
const EMPTY_OP = { name: "", supplier_name: "", supplier_odoo_id: null, status: "brouillon", start_date: "", end_date: "", tier_mode: "collectif", fee_pct: 2,
  centralizer_type: "elixir", centralizer_id: null, centralizer_name: null, objective_type: "aucun", objective_value: "", delivery_slots: [],
  rfa_pct: 0, coop_mode: "aucune", coop_amount: 0, coop_label: "", conditions_text: "", notes: "" };

// Nombres saisis à la française : « 1 234,50 € », « 7,5 % »
// Espaces admis seulement comme séparateurs de milliers (« 1 234,50 ») ; « 12 24 » est illisible
const toNum = (s) => {
  let t = String(s ?? "").trim().replace(/[€%]/g, "").trim();
  if (/^\d{1,3}([\s\u00a0\u202f]\d{3})+([.,]\d+)?$/.test(t)) t = t.replace(/[\s\u00a0\u202f]/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return NaN;
  return parseFloat(t.replace(",", "."));
};
const fr = (n) => String(n).replace(".", ",");
// Paliers de remise : « 10:5 ; 50:7,5 ». Séparateur « ; » ou retour à la ligne ; une virgule
// sépare aussi deux paliers quand elle est suivie d'un seuil (« 10:5, 50:8 »), sinon c'est une décimale.
const tierParts = (s) => String(s || "").split(/\s*(?:;|\n|,(?=\s*\d+\s*[:=→]))\s*/).map(p => p.trim()).filter(Boolean);
const parseTiers = (s) => tierParts(s).map(p => { const parts = p.split(/[:=→]/); return parts.length === 2 ? { min_qty: toNum(parts[0]), pct: toNum(parts[1]) } : { min_qty: NaN, pct: NaN }; })
  .filter(t => t.min_qty > 0 && t.pct > 0 && t.pct < 100).sort((a, b) => a.min_qty - b.min_qty);
const ugParts = (s) => String(s || "").split(/\s*[;,\n]\s*/).map(p => p.trim()).filter(Boolean);
const parseUg = (s) => ugParts(s).map(p => { const parts = p.split("+"); return parts.length === 2 ? { min_qty: toNum(parts[0]), free_qty: toNum(parts[1]) } : { min_qty: NaN, free_qty: NaN }; })
  .filter(t => t.min_qty > 0 && t.free_qty > 0).sort((a, b) => a.min_qty - b.min_qty);
const tiersToText = (t) => (t || []).map(x => `${x.min_qty}:${fr(x.pct)}`).join(" ; ");
const ugToText = (t) => (t || []).map(x => `${x.min_qty}+${x.free_qty}`).join(", ");
const withText = (l) => ({ ...l, price_gross: l.price_gross === "" || l.price_gross == null ? "" : fr(l.price_gross), _tiers: tiersToText(l.discount_tiers), _ug: ugToText(l.ug_tiers),
  _extra: (Array.isArray(l.extra_discounts) ? l.extra_discounts : []).slice(0, 2).map(d => ({ mode: d.mode || "aucune", pct: d.pct ?? "", combine: d.combine === "additionnelle" ? "additionnelle" : "cascade", _tiers: tiersToText(d.tiers) })) });
// remises 2 et 3 : texte d'édition → valeurs enregistrées
const extraToSave = (x) => (x || []).filter(d => d.mode !== "aucune").map(d => ({ mode: d.mode, pct: d.mode === "unitaire" ? (toNum(d.pct) || 0) : 0,
  tiers: d.mode === "paliers" ? parseTiers(d._tiers) : [], combine: d.combine === "additionnelle" ? "additionnelle" : "cascade" }));
// remise totale pour une quantité donnée (aperçu)
const previewDiscount = (l, q) => invoiceDiscount({ discount_mode: l.discount_mode, discount_pct: toNum(l.discount_pct) || 0, discount_tiers: parseTiers(l._tiers), extra_discounts: extraToSave(l._extra) }, q).pct;
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? "")) && !isNaN(Date.parse(d + "T00:00:00Z"));
const newSlotId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 8);

export default function AdminGroupPurchases({ adminFetch, flash, onDirtyChange }) {
  const [view, setView] = useState("list");       // list | edit | access
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(EMPTY_OP);
  const [lines, setLines] = useState([]);
  const [parts, setParts] = useState([]);
  const [detail, setDetail] = useState(null);     // réponse « get » : suivi, stock, déclenchements
  const [snapshot, setSnapshot] = useState("");   // état chargé, pour détecter les modifications non enregistrées
  const [access, setAccess] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);     // fiches produits créées / à compléter
  const [prodJob, setProdJob] = useState(null);   // création des fiches Odoo en arrière-plan { id, status, done, total }

  const call = useCallback(async (qs, body) => {
    const r = await adminFetch(body ? API : `${API}?${qs}`, body ? { method: "POST", body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Erreur ${r.status}`), { data: j, status: r.status });
    return j;
  }, [adminFetch]);

  const state = JSON.stringify({ form, lines, parts });
  const dirty = view === "edit" && snapshot !== "" && state !== snapshot;
  const discard = () => !dirty || window.confirm("Des modifications ne sont pas enregistrées. Les abandonner ?");
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const loadList = useCallback(async () => {
    setLoading(true); setErr("");
    try { setOps((await call("action=list")).operations || []); }
    catch (e) { setErr(/gp_operations|pharmacy_id/.test(e.message) ? "Les tables des commandes groupées ne sont pas à jour : exécutez les scripts SQL du dossier sql/ dans Supabase." : e.message); }
    setLoading(false);
  }, [call]);
  const loadAccess = useCallback(async () => { try { setAccess((await call("action=access")).access || []); } catch (e) { setErr(e.message); } }, [call]);
  useEffect(() => { loadList(); loadAccess(); }, [loadList, loadAccess]);

  const open = async (id) => {
    setBusy("load"); setErr("");
    try {
      const d = await call(`action=get&id=${id}`);
      const f = { ...EMPTY_OP, ...d.op }, ls = d.lines.map(withText), ps = d.participants;
      setDetail(d); setForm(f); setLines(ls); setParts(ps); setSnapshot(JSON.stringify({ form: f, lines: ls, parts: ps })); setView("edit");
      call(`action=products_status&id=${id}`).then(j => { if (j.status === "en_cours") setProdJob(x => x?.id === id ? x : { ...j, id }); }).catch(() => {});
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const create = () => { setDetail(null); setForm({ ...EMPTY_OP }); setLines([]); setParts([]); setSnapshot(JSON.stringify({ form: EMPTY_OP, lines: [], parts: [] })); setView("edit"); };
  const reload = () => form.id && open(form.id);
  // Suivi rafraîchi sans toucher à la saisie en cours (statut et bon labo seulement)
  const formIdRef = useRef(form.id);
  formIdRef.current = form.id;
  const refreshDetail = useCallback(async (id) => {
    try {
      const d = await call(`action=get&id=${id}`);
      if (formIdRef.current !== id) return;
      const meta = { status: d.op.status, po_odoo_id: d.op.po_odoo_id, po_created_at: d.op.po_created_at, updated_at: d.op.updated_at };
      setDetail(d); setForm(f => ({ ...f, ...meta }));
      setSnapshot(s => { try { const o = JSON.parse(s); o.form = { ...o.form, ...meta }; return JSON.stringify(o); } catch { return s; } });
    } catch { /* l'écran garde l'état précédent */ }
  }, [call]);
  // Fiches créées en arrière-plan : on relie les produits sans toucher au reste de la saisie
  const mergeProducts = useCallback(async (id) => {
    try {
      const d = await call(`action=get&id=${id}`);
      if (formIdRef.current !== id) return;
      const byId = Object.fromEntries(d.lines.filter(l => l.odoo_product_id).map(l => [l.id, l]));
      const fix = (ls) => ls.map(l => !l.odoo_product_id && byId[l.id]?.cip === l.cip ? { ...l, odoo_product_id: byId[l.id].odoo_product_id } : l);
      setDetail(d); setLines(fix);
      setSnapshot(s => { try { const o = JSON.parse(s); o.lines = fix(o.lines); return JSON.stringify(o); } catch { return s; } });
    } catch { /* bouton « Recharger » en secours */ }
  }, [call]);
  const jobId = prodJob?.status === "en_cours" ? prodJob.id : null;
  useEffect(() => {
    if (!jobId) return;
    let stop = false, timer = null, fails = 0;
    const tick = async () => {
      if (stop) return;
      try {
        const j = await call(`action=products_status&id=${jobId}`);
        fails = 0;
        if (stop) return;
        if (j.status === "en_cours") { setProdJob({ ...j, id: jobId }); timer = setTimeout(tick, 3000); return; }
        setProdJob(null);
        if (j.status === "termine" || j.status === "erreur") {
          await mergeProducts(jobId);
          const msgs = [...(j.created || []).map(x => `✅ Fiche Odoo créée : ${x.name} (${x.cip})`),
            ...(j.linked || []).map(x => `🔗 Fiche Odoo existante reliée : ${x.name} (${x.cip})`), ...(j.warnings || []).map(w => `⚠️ ${w}`),
            ...(j.status === "erreur" ? [`❌ ${j.error || "Création des fiches interrompue"}`] : [])];
          if (msgs.length) setNotice(n => [...(n || []), ...msgs]);
        }
      } catch { if (++fails < 10 && !stop) timer = setTimeout(tick, 5000); else setProdJob(null); }
    };
    timer = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(timer); };
  }, [jobId, call, mergeProducts]);

  const save = async (force = false, confirmedDetails = null) => {
    setErr("");
    // Contrôles avant envoi : aucune saisie illisible ne doit devenir 0 en silence
    const problems = [];
    const numField = (v, label, max) => { if (String(v ?? "").trim() === "") return; const n = toNum(v); if (!(n >= 0) || (max && n >= max)) problems.push(`${label} illisible (« ${v} »)`); };
    numField(form.fee_pct, "frais de traitement", 100); numField(form.rfa_pct, "remise de fin d'année", 100);
    numField(form.coop_amount, "montant de coopération"); numField(form.objective_value, "objectif");
    for (const [v, label] of [[form.coop_amount, "montant de coopération"], [form.objective_value, "objectif"]])
      if (/^\d{1,3}(\.\d{3})+$/.test(String(v ?? "").trim())) problems.push(`${label} « ${v} » : écrivez ${String(v).replace(/\./g, "")} (le point n'est pas un séparateur de milliers)`);
    for (const l of lines) {
      const label = l.name || l.cip || "produit";
      if (String(l.price_gross ?? "").trim() !== "" && !(toNum(l.price_gross) >= 0)) problems.push(`prix illisible pour « ${label} »`);
      if (l.discount_mode === "paliers" && parseTiers(l._tiers).length !== tierParts(l._tiers).length) problems.push(`palier de remise illisible pour « ${label} » (format 10:5 ; 50:7,5)`);
      if (l.discount_mode === "unitaire" && !(toNum(l.discount_pct) >= 0 && toNum(l.discount_pct) < 100)) problems.push(`remise illisible pour « ${label} »`);
      if (parseUg(l._ug).length !== ugParts(l._ug).length) problems.push(`UG illisibles pour « ${label} » (format 12+2)`);
      (l._extra || []).forEach((d, k) => {
        if (d.mode === "unitaire" && !(toNum(d.pct) >= 0 && toNum(d.pct) < 100)) problems.push(`remise ${k + 2} illisible pour « ${label} »`);
        if (d.mode === "paliers" && (!tierParts(d._tiers).length || parseTiers(d._tiers).length !== tierParts(d._tiers).length)) problems.push(`paliers de la remise ${k + 2} illisibles pour « ${label} »`);
      });
    }
    if (problems.length) { setErr(`À corriger avant d'enregistrer : ${problems.join(" ; ")}`); return; }
    setBusy("save");
    try {
      const r = await call(null, { action: "save", force, confirmed_details: confirmedDetails,
        operation: { ...form, objective_value: form.objective_value === "" ? null : toNum(form.objective_value), fee_pct: toNum(form.fee_pct), rfa_pct: toNum(form.rfa_pct) || 0, coop_amount: toNum(form.coop_amount) || 0 },
        lines: lines.map(l => ({ ...l, price_gross: String(l.price_gross ?? "").trim() === "" ? 0 : toNum(l.price_gross), discount_pct: toNum(l.discount_pct) || 0,
          weight: toNum(l.weight) || 1, vat_rate: String(l.vat_rate ?? "").trim() === "" ? null : toNum(l.vat_rate),
          discount_tiers: parseTiers(l._tiers), ug_tiers: parseUg(l._ug), extra_discounts: extraToSave(l._extra) })),
        participants: parts.map(p => ({ id: p.pharmacy_id, name: p.pharmacy_name, email: p.email, cip: p.pharmacy_cip, fee_pct: p.fee_pct === "" || p.fee_pct == null ? null : toNum(p.fee_pct) })),
        loaded_updated_at: form.updated_at || null, loaded_line_ids: (detail?.lines || []).map(l => l.id) });
      setForm(x => ({ ...x, id: r.id || r.operation?.id, updated_at: r.operation?.updated_at || x.updated_at }));   // pas de doublon si le rechargement échoue
      const opId = r.id || r.operation?.id;
      flash?.(r.locked ? "✅ Notes enregistrées" : `✅ Opération enregistrée${r.products_pending ? ` — création de ${r.products_pending} fiche(s) produit dans Odoo en cours` : ""}`);
      setNotice(r.product_warnings?.length || r.products_job?.error ? [...(r.product_warnings || []).map(w => `⚠️ ${w}`), ...(r.products_job?.error ? [`❌ ${r.products_job.error}`] : [])] : null);
      if (r.products_pending && !r.products_job?.error) setProdJob({ id: opId, status: "en_cours", done: 0, total: r.products_pending });
      setBusy("");
      await open(opId); loadList(); loadAccess();
      return;
    } catch (e) {
      setBusy("");
      if (e.data?.code === "confirm") {
        if (window.confirm(`${e.message} :\n\n• ${(e.data.details || []).join("\n• ")}\n\nCes quantités seront supprimées (les pharmacies concernées ne sont pas prévenues automatiquement). Confirmer ?`)) return save(true, JSON.stringify(e.data.details || []));
        return;
      }
      setErr(e.data?.code === "stale" ? `${e.message} (vos modifications ne sont pas enregistrées : notez-les, puis cliquez sur « Recharger »)` : e.message);
    }
  };

  const setStatus = async (status, confirmText) => {
    if (dirty) { setErr("Enregistrez d'abord vos modifications (ou rechargez l'opération)."); return; }
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy("status"); setErr("");
    try { await call(null, { action: "status", id: form.id, status }); await open(form.id); loadList(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement l'opération « ${form.name} » ?`)) return;
    try { await call(null, { action: "delete", id: form.id }); setView("list"); setSnapshot(""); loadList(); } catch (e) { setErr(e.message); }
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
          <div key={o.id} role="button" tabIndex={0} onClick={() => open(o.id)} onKeyDown={e => e.key === "Enter" && open(o.id)} style={{ ...card, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800, color: "#0f2d3d" }}>{o.name}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{o.supplier_name || "Fournisseur ?"} · du {dfr(o.start_date)} au {dfr(o.end_date)} · {o.participants_count} participant(s) · {o.orders_count} commande(s)</div>
              {o.pending_slots?.length > 0 && <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 2 }}>⏰ {o.pending_slots.length} livraison(s) avec des devis à créer</div>}
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color: "white", background: color, borderRadius: 99, padding: "3px 10px" }}>{label}</span>
          </div>
        );
      })}
      {busy === "load" && <div style={card}>Ouverture…</div>}
    </div>
  );

  // ── Édition d'une opération ──
  const locked = LOCKED.includes(form.status);
  const f = (k) => (e) => setForm(x => ({ ...x, [k]: e.target.value }));
  const [stLabel, stColor] = STATUS[form.status] || [form.status, "#666"];
  const hasTriggers = (detail?.triggers || []).length > 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button style={btn()} onClick={() => { if (discard()) { setView("list"); setSnapshot(""); loadList(); } }}>← Opérations</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f2d3d" }}>{form.name || "Nouvelle opération"}</div>
          <span style={{ fontSize: 11, fontWeight: 800, color: "white", background: stColor, borderRadius: 99, padding: "3px 10px" }}>{stLabel}</span>
          {dirty && <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>● modifications non enregistrées</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {form.id && <button style={btn()} disabled={!!busy} onClick={() => discard() && reload()}>↻ Recharger</button>}
          {form.id && form.status === "brouillon" && <button style={btn("ok")} disabled={!!busy} onClick={() => setStatus("ouverte", "Ouvrir l'opération aux pharmacies participantes ?")}>▶ Ouvrir aux commandes</button>}
          {form.status === "ouverte" && <button style={btn()} disabled={!!busy} onClick={() => setStatus("cloturee", "Clôturer l'opération ? Les pharmacies ne pourront plus modifier leur commande.")}>⏹ Clôturer</button>}
          {form.status === "cloturee" && !form.po_odoo_id && !form.po_created_at && !hasTriggers && <button style={btn()} disabled={!!busy} onClick={() => setStatus("ouverte", "Rouvrir l'opération aux commandes ?")}>↺ Rouvrir</button>}
          {form.status === "commandee" && <button style={btn()} disabled={!!busy} onClick={() => setStatus("terminee", "Marquer l'opération comme terminée ?")}>✓ Terminée</button>}
          <button style={btn("pri")} disabled={!!busy} onClick={() => save(false)}>{busy === "save" ? "Enregistrement…" : "💾 Enregistrer"}</button>
        </div>
      </div>
      {err && <Err text={err} />}
      {prodJob?.id === form.id && <div style={{ ...card, background: "#eff6ff", borderColor: "#93c5fd", fontSize: 13 }}>
        ⏳ Création des fiches produits dans Odoo : <b>{prodJob.done || 0} / {prodJob.total || "…"}</b> (environ 10 secondes par fiche). Vous pouvez continuer à travailler ; l'opération ne pourra être ouverte aux commandes qu'une fois toutes les fiches créées.
      </div>}
      {notice && <div style={{ ...card, background: "#f0fdf4", borderColor: "#86efac", fontSize: 13 }}>{notice.map((t, i) => <div key={i}>{t}</div>)}<button type="button" style={{ ...btn(), marginTop: 8, padding: "5px 10px" }} onClick={() => setNotice(null)}>OK</button></div>}
      {locked && <div style={{ ...card, background: "#f8fafc", fontSize: 13, color: "#475569" }}>Opération {stLabel.toLowerCase()} : seules les notes et les conditions affichées restent modifiables.</div>}

      {!locked && <OfferImport adminFetch={adminFetch} form={form} setForm={setForm} setLines={setLines} lines={lines} />}

      <fieldset disabled={locked} style={{ border: "none", padding: 0, margin: 0, minWidth: 0 }}>
        <div style={card}>
          <div style={h3}>Opération</div>
          <div style={grid("2fr 2fr 1fr 1fr")}>
            <div><label style={LS}>Nom *</label><input style={IS} aria-label="Nom de l'opération" value={form.name} onChange={f("name")} placeholder="ex. Opération hiver Pfizer" /></div>
            <SupplierPicker call={call} form={form} setForm={setForm} />
            <div><label style={LS}>Début</label><input type="date" style={IS} aria-label="Date de début" value={form.start_date || ""} onChange={f("start_date")} /></div>
            <div><label style={LS}>Fin (clôture) *</label><input type="date" style={IS} aria-label="Date de fin (clôture)" value={form.end_date || ""} onChange={f("end_date")} /></div>
          </div>
          <div style={{ ...grid("1fr 1fr 1fr 1fr"), marginTop: 12 }}>
            <div><label style={LS}>Paliers calculés sur</label>
              <select style={IS} aria-label="Paliers calculés sur" value={form.tier_mode} onChange={f("tier_mode")}><option value="collectif">le total du groupe</option><option value="individuel">chaque pharmacie</option></select></div>
            <div><label style={LS}>Frais de traitement (%)</label><input inputMode="decimal" style={IS} aria-label="Frais de traitement en pourcentage" value={form.fee_pct} onChange={f("fee_pct")} /></div>
            <div><label style={LS}>Centralisation des achats</label>
              <select style={IS} aria-label="Centralisation des achats" value={form.centralizer_type} onChange={f("centralizer_type")}><option value="elixir">Elixir Pharma</option><option value="pharmacie">Une pharmacie</option></select></div>
            {form.centralizer_type === "pharmacie" ? (
              <div><label style={LS}>Pharmacie centralisatrice</label>
                <select style={IS} value={form.centralizer_id || ""} onChange={e => { const p = parts.find(x => x.pharmacy_id === e.target.value); setForm(x => ({ ...x, centralizer_id: e.target.value || null, centralizer_name: p?.pharmacy_name || null })); }}>
                  <option value="">— choisir parmi les participantes —</option>
                  {parts.map(p => <option key={p.pharmacy_id} value={p.pharmacy_id}>{p.pharmacy_name}</option>)}
                </select></div>
            ) : <div />}
          </div>
          <div style={{ ...grid("1fr 1fr 1fr 1fr"), marginTop: 12 }}>
            <div><label style={LS}>Objectif</label>
              <select style={IS} aria-label="Type d'objectif" value={form.objective_type} onChange={f("objective_type")}>
                <option value="aucun">Aucun</option><option value="unites">Unités (produits ×2 comptés double)</option><option value="montant_brut">Montant brut HT</option><option value="montant_net">Montant remisé HT</option>
              </select></div>
            <div><label style={LS}>{form.objective_type === "unites" ? "Unités à atteindre" : "Montant à atteindre (€)"}</label><input inputMode="decimal" style={IS} disabled={form.objective_type === "aucun"} aria-label="Valeur de l'objectif" value={form.objective_value ?? ""} onChange={f("objective_value")} /></div>
            <div><label style={LS}>Remise de fin d'année (%)</label><input inputMode="decimal" style={IS} aria-label="Remise de fin d'année en pourcentage" value={form.rfa_pct} onChange={f("rfa_pct")} /></div>
            <div />
          </div>
          <div style={{ ...grid("1fr 1fr 2fr"), marginTop: 12 }}>
            <div><label style={LS}>Coopération commerciale</label>
              <select style={IS} aria-label="Coopération commerciale" value={form.coop_mode} onChange={f("coop_mode")}><option value="aucune">Aucune</option><option value="par_pharmacie">Montant par pharmacie</option><option value="total">Montant global (prorata)</option></select></div>
            <div><label style={LS}>Montant (€)</label><input inputMode="decimal" style={IS} disabled={form.coop_mode === "aucune"} aria-label="Montant de la coopération" value={form.coop_amount} onChange={f("coop_amount")} /></div>
            <div><label style={LS}>Contrepartie</label><input style={IS} disabled={form.coop_mode === "aucune"} aria-label="Contrepartie de la coopération" value={form.coop_label || ""} onChange={f("coop_label")} placeholder="ex. mise en avant du produit en vitrine" /></div>
          </div>
        </div>
      </fieldset>
      <div style={{ ...card, ...grid("1fr 1fr") }}>
        <div><label style={LS}>Conditions affichées aux pharmacies</label><textarea style={{ ...IS, minHeight: 64 }} aria-label="Conditions affichées aux pharmacies" value={form.conditions_text || ""} onChange={f("conditions_text")} /></div>
        <div><label style={LS}>Notes internes</label><textarea style={{ ...IS, minHeight: 64 }} aria-label="Notes internes" value={form.notes || ""} onChange={f("notes")} /></div>
      </div>

      <fieldset disabled={locked} style={{ border: "none", padding: 0, margin: 0, minWidth: 0 }}>
        <Slots form={form} setForm={setForm} triggers={detail?.triggers || []} />
        <LinesEditor lines={lines} setLines={setLines} call={call} products={detail?.products || {}} locked={locked} />
        <Participants parts={parts} setParts={setParts} access={access} call={call} opFee={form.fee_pct} locked={locked} />
      </fieldset>

      {detail && form.id && <Dashboard detail={detail} />}
      {detail && form.id && ["cloturee", "commandee", "terminee"].includes(form.status) && <Fulfilment key={form.id} detail={detail} call={call} refresh={() => refreshDetail(form.id)} dirty={dirty} />}

      {form.id && (
        <div style={{ textAlign: "right" }}>
          {form.status === "brouillon" && <button style={btn("danger")} onClick={remove}>Supprimer l'opération</button>}
          {["ouverte", "cloturee", "commandee"].includes(form.status) && <button style={btn("danger")} onClick={() => setStatus("annulee",
            form.po_odoo_id ? "Annuler l'opération ? Pensez à annuler aussi le bon de commande labo et les devis dans Odoo." : "Annuler l'opération ? Elle ne sera plus visible des pharmacies.")}>Annuler l'opération</button>}
        </div>
      )}
    </div>
  );
}

function Err({ text }) { return <div role="alert" style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{text}</div>; }

// ── Fournisseur Odoo ──
function SupplierPicker({ call, form, setForm }) {
  const [res, setRes] = useState(null);
  const search = async () => { try { setRes((await call(`action=suppliers&q=${encodeURIComponent(form.supplier_name || "")}`)).suppliers || []); } catch { setRes([]); } };
  return (
    <div style={{ position: "relative" }}>
      <label style={LS}>Fournisseur {form.supplier_odoo_id ? <span style={{ color: "#16a34a" }}>· Odoo #{form.supplier_odoo_id}</span> : <span style={{ color: "#b45309" }}>· non relié à Odoo</span>}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={IS} value={form.supplier_name || ""} onChange={e => setForm(x => ({ ...x, supplier_name: e.target.value, supplier_odoo_id: null }))} onKeyDown={e => e.key === "Enter" && search()} placeholder="Nom du laboratoire" />
        <button type="button" style={btn()} onClick={search} title="Chercher dans les fournisseurs Odoo">🔎</button>
      </div>
      {res && (
        <div style={{ position: "absolute", zIndex: 5, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", marginTop: 4, width: "100%", maxHeight: 240, overflowY: "auto" }}>
          {!res.length && <div style={{ padding: 10, fontSize: 12, color: "#64748b" }}>Aucun fournisseur trouvé</div>}
          {res.map(s => <button type="button" key={s.id} onClick={() => { setForm(x => ({ ...x, supplier_name: s.name, supplier_odoo_id: s.id })); setRes(null); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "white", padding: "8px 12px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{s.name} <span style={{ color: "#94a3b8" }}>#{s.id}</span></button>)}
          <button type="button" onClick={() => setRes(null)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderTop: "1px solid #f1f5f9", background: "white", padding: "6px 12px", fontSize: 12, color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}>Fermer</button>
        </div>
      )}
    </div>
  );
}

// ── Cadencement des livraisons ──
function Slots({ form, setForm, triggers }) {
  const slots = form.delivery_slots || [];
  const set = (i, k, v) => setForm(x => ({ ...x, delivery_slots: x.delivery_slots.map((s, j) => j === i ? { ...s, [k]: v } : s) }));
  const triggered = new Set(triggers.map(t => t.slot_id));
  return (
    <div style={card}>
      <div style={h3}>Livraisons (cadencement)</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Chaque date devient une colonne de saisie pour les pharmacies. Les produits en stock ont en plus une colonne « Immédiat ». Sans date, une seule colonne « Quantité » (livraison à réception).</div>
      {slots.map((s, i) => (
        <div key={s.id} style={{ ...grid("180px 1fr 40px"), marginBottom: 8 }}>
          <input type="date" style={IS} value={s.date || ""} disabled={triggered.has(s.id)} onChange={e => set(i, "date", e.target.value)} aria-label={`Date de la livraison ${i + 1}`} />
          <input style={IS} value={s.label || ""} onChange={e => set(i, "label", e.target.value)} placeholder={`Libellé (ex. Livraison ${i + 1})`} />
          <button type="button" style={btn("danger")} disabled={triggered.has(s.id)} title={triggered.has(s.id) ? "Livraison déjà déclenchée" : "Supprimer"} onClick={() => setForm(x => ({ ...x, delivery_slots: x.delivery_slots.filter((_, j) => j !== i) }))}>✕</button>
        </div>
      ))}
      <button type="button" style={btn()} onClick={() => setForm(x => ({ ...x, delivery_slots: [...(x.delivery_slots || []), { id: newSlotId(), date: "", label: "" }] }))}>＋ Ajouter une date de livraison</button>
    </div>
  );
}

// ── Produits de l'opération ──
function LinesEditor({ lines, setLines, call, products, locked }) {
  const [cip, setCip] = useState("");
  const [info, setInfo] = useState(products);
  const [msg, setMsg] = useState("");
  useEffect(() => setInfo(i => ({ ...i, ...products })), [products]);
  const set = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  // Un CIP modifié désigne un autre produit : on oublie la fiche Odoo et la TVA de l'ancien
  const setCipAt = (i, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, cip: v.replace(/\D/g, ""), odoo_product_id: null, vat_rate: null } : l));
  const add = async () => {
    const c = cip.replace(/\D/g, "");
    if (!c) return;
    if (lines.some(l => l.cip === c)) { setMsg(`Le CIP ${c} est déjà dans la liste.`); return; }
    let p = {};
    try { p = (await call(null, { action: "lookup", cips: [c] })).products?.[c] || {}; setInfo(i => ({ ...i, [c]: p })); } catch {}
    setMsg(p.odoo_product_id ? "" : p.medipim ? `CIP ${c} absent d'Odoo : désignation et TVA reprises de Medipim ; la fiche Odoo sera créée à l'enregistrement (saisissez le prix brut).`
      : `CIP ${c} introuvable dans Odoo et Medipim : saisissez la désignation et la TVA ; la fiche Odoo sera créée à l'enregistrement.`);
    setLines(ls => [...ls, withText({ cip: p.medipim?.cip13 && c.length === 7 ? p.medipim.cip13 : c, name: p.odoo_name || p.medipim?.name || "", odoo_product_id: p.odoo_product_id || null, price_gross: "", discount_mode: "aucune", discount_pct: 0, discount_tiers: [], ug_tiers: [], weight: 1, vat_rate: p.vat_rate ?? p.medipim?.vat ?? null, notes: "" })]);
    setCip("");
  };
  const refresh = async () => {
    try { const p = (await call(null, { action: "lookup", cips: lines.map(l => l.cip) })).products || {}; setInfo(p);
      setLines(ls => ls.map(l => ({ ...l, odoo_product_id: l.odoo_product_id || p[l.cip]?.odoo_product_id || null, vat_rate: l.vat_rate ?? p[l.cip]?.vat_rate ?? p[l.cip]?.medipim?.vat ?? null, name: l.name || p[l.cip]?.odoo_name || p[l.cip]?.medipim?.name || "" }))); } catch {}
  };
  const th = { textAlign: "left", padding: "6px 6px", fontSize: 11, color: "#64748b", fontWeight: 700 };
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...h3, margin: 0 }}>Produits ({lines.length})</div>
        {!locked && <button type="button" style={btn()} onClick={refresh}>↻ Stock et fiches Odoo</button>}
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Paliers de remise : <code>10:5 ; 50:7,5</code> = −5 % dès 10 unités, −7,5 % dès 50. UG : <code>12+2, 24+5</code> = 2 offertes par tranche de 12 facturées, 5 par tranche de 24 (la pharmacie saisit 12, le site ajoute les 2 gratuites). « ×obj. » = poids dans l'objectif en unités (2 = compte double).</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1050 }}>
          <thead><tr><th style={th}>CIP</th><th style={th}>Désignation</th><th style={th}>Prix brut HT</th><th style={th}>Remise sur facture</th><th style={th}>UG</th><th style={th}>×obj.</th><th style={th}>TVA %</th><th style={th}>Odoo</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const p = info[l.cip] || {};
              const tiers = parseTiers(l._tiers), ugs = parseUg(l._ug);
              const badTiers = l.discount_mode === "paliers" && tiers.length !== tierParts(l._tiers).length;
              const badUg = ugs.length !== ugParts(l._ug).length;
              const badPrice = String(l.price_gross ?? "").trim() !== "" && !(toNum(l.price_gross) >= 0);
              return (
                <tr key={l.id || `new-${i}`} style={{ borderTop: "1px solid #f1f5f9", verticalAlign: "top" }}>
                  <td style={{ padding: 4, width: 130 }}><input style={CI} value={l.cip} onChange={e => setCipAt(i, e.target.value)} aria-label="CIP" /></td>
                  <td style={{ padding: 4 }}><input style={{ ...CI, borderColor: l.name ? "#e2e8f0" : "#f59e0b" }} value={l.name} onChange={e => set(i, "name", e.target.value)} placeholder="Désignation" aria-label="Désignation" />
                    <input style={{ ...CI, marginTop: 4, fontSize: 11 }} value={l.notes || ""} onChange={e => set(i, "notes", e.target.value)} placeholder="note visible des pharmacies" /></td>
                  <td style={{ padding: 4, width: 96 }}><input inputMode="decimal" style={{ ...CI, borderColor: badPrice ? "#ef4444" : "#e2e8f0" }} value={l.price_gross ?? ""} onChange={e => set(i, "price_gross", e.target.value)} placeholder="0,00" aria-label="Prix brut" /></td>
                  <td style={{ padding: 4, width: 250 }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>Remise 1</div>
                    <select style={CI} value={l.discount_mode} onChange={e => set(i, "discount_mode", e.target.value)} aria-label="Remise 1"><option value="aucune">Aucune</option><option value="unitaire">Taux unique</option><option value="paliers">Paliers</option></select>
                    {l.discount_mode === "unitaire" && <input inputMode="decimal" style={{ ...CI, marginTop: 4 }} value={l.discount_pct} onChange={e => set(i, "discount_pct", e.target.value)} placeholder="%" aria-label="Taux de la remise 1" />}
                    {l.discount_mode === "paliers" && <>
                      <input style={{ ...CI, marginTop: 4, borderColor: badTiers ? "#ef4444" : "#e2e8f0" }} value={l._tiers} onChange={e => set(i, "_tiers", e.target.value)} placeholder="10:5 ; 50:7,5" aria-label="Paliers de la remise 1" />
                      <div style={{ fontSize: 10, color: badTiers ? "#b91c1c" : "#64748b" }}>{badTiers ? "Palier illisible" : tiers.map(t => `dès ${t.min_qty} : −${fr(t.pct)} %`).join(" · ")}</div>
                    </>}
                    {(l._extra || []).map((d, k) => {
                      const setX = (key, v) => set(i, "_extra", (l._extra || []).map((x, j) => j === k ? { ...x, [key]: v } : x));
                      return (
                        <div key={k} style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e2e8f0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", fontWeight: 700 }}>
                            <span>Remise {k + 2}</span>
                            <button type="button" onClick={() => set(i, "_extra", (l._extra || []).filter((_, j) => j !== k))} style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer", fontSize: 10 }} aria-label={`Retirer la remise ${k + 2}`}>retirer</button>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <select style={CI} value={d.combine} onChange={e => setX("combine", e.target.value)} aria-label={`Combinaison de la remise ${k + 2}`}><option value="cascade">En cascade</option><option value="additionnelle">Additionnelle</option></select>
                            <select style={CI} value={d.mode} onChange={e => setX("mode", e.target.value)} aria-label={`Type de la remise ${k + 2}`}><option value="unitaire">Taux</option><option value="paliers">Paliers</option></select>
                          </div>
                          {d.mode === "unitaire" && <input inputMode="decimal" style={{ ...CI, marginTop: 4 }} value={d.pct} onChange={e => setX("pct", e.target.value)} placeholder="%" aria-label={`Taux de la remise ${k + 2}`} />}
                          {d.mode === "paliers" && <input style={{ ...CI, marginTop: 4 }} value={d._tiers} onChange={e => setX("_tiers", e.target.value)} placeholder="50:5 ; 100:8" aria-label={`Paliers de la remise ${k + 2}`} />}
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {(l._extra || []).length < 2 && <button type="button" style={{ ...btn(), padding: "3px 8px", fontSize: 11 }} onClick={() => set(i, "_extra", [...(l._extra || []), { mode: "unitaire", pct: "", combine: "cascade", _tiers: "" }])}>＋ Remise {(l._extra || []).length + 2}</button>}
                      {lines.length > 1 && <button type="button" style={{ ...btn(), padding: "3px 8px", fontSize: 11 }} onClick={() => window.confirm("Appliquer les remises de ce produit à tous les produits de l'opération ?") && setLines(ls => ls.map(x => ({ ...x, discount_mode: l.discount_mode, discount_pct: l.discount_pct, _tiers: l._tiers, _extra: (l._extra || []).map(e => ({ ...e })) })))}>Appliquer à tous</button>}
                      {(l.discount_mode !== "aucune" || (l._extra || []).length > 0) && <span style={{ fontSize: 10, color: "#0f2d3d", fontWeight: 700 }}>Total : −{fr(round2(previewDiscount(l, 1e9)))} %{(l.discount_mode === "paliers" || (l._extra || []).some(d => d.mode === "paliers")) ? " (paliers max.)" : ""}</span>}
                    </div>
                  </td>
                  <td style={{ padding: 4, width: 140 }}><input style={{ ...CI, borderColor: badUg ? "#ef4444" : "#e2e8f0" }} value={l._ug} onChange={e => set(i, "_ug", e.target.value)} placeholder="12+2" />
                    {badUg ? <div style={{ fontSize: 10, color: "#b91c1c" }}>UG illisibles</div> : ugs.map((t, k) => <div key={k} style={{ fontSize: 10, color: "#64748b" }}>{ugLabel(t)}</div>)}</td>
                  <td style={{ padding: 4, width: 56 }}><input inputMode="decimal" style={CI} value={l.weight} onChange={e => set(i, "weight", e.target.value)} aria-label="Poids dans l'objectif" /></td>
                  <td style={{ padding: 4, width: 64 }}><input inputMode="decimal" style={CI} value={l.vat_rate ?? ""} onChange={e => set(i, "vat_rate", e.target.value)} placeholder="auto" aria-label="TVA" /></td>
                  <td style={{ padding: "8px 4px", fontSize: 11, width: 120 }}>
                    {l.odoo_product_id || p.odoo_product_id ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ fiche</span>
                      : <span style={{ color: "#b45309", fontWeight: 700 }} title="La fiche sera créée dans Odoo après l'enregistrement, en arrière-plan (prix de vente = prix brut, TVA, tarif fournisseur)">➕ à créer{p.medipim ? " (Medipim)" : ""}</span>}
                    {!(l.odoo_product_id || p.odoo_product_id) && p.medipim?.public_price != null && <div style={{ color: "#64748b" }}>PPTTC {eur(p.medipim.public_price)}</div>}
                    {p.in_stock != null && <div style={{ color: p.in_stock ? "#16a34a" : "#b45309" }}>{p.in_stock ? `stock ${p.available}` : "précommande"}</div>}
                    {p.elixir_price != null && <div style={{ color: "#64748b" }}>Elixir {eur(p.elixir_price)}</div>}
                  </td>
                  <td style={{ padding: 4 }}><button type="button" style={{ ...btn("danger"), padding: "6px 10px" }} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Retirer le produit">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg && <div style={{ fontSize: 12, color: "#b45309", marginTop: 8 }}>{msg}</div>}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 420 }}>
          <input style={IS} value={cip} onChange={e => setCip(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="CIP du produit à ajouter" aria-label="CIP du produit à ajouter" />
          <button type="button" style={btn()} onClick={add}>＋ Ajouter</button>
        </div>
      )}
    </div>
  );
}

// ── Import IA d'une offre ──
function OfferImport({ adminFetch, form, setForm, lines, setLines }) {
  const [state, setState] = useState(null);    // { busy, secs, result, products, error }
  const [mode, setMode] = useState(lines.length ? "ajouter" : "remplacer");
  const [applyOp, setApplyOp] = useState(true);
  const ref = useRef(null);
  useEffect(() => { if (!state) setMode(lines.length ? "ajouter" : "remplacer"); }, [lines.length, state]);
  const post = async (body) => {
    const r = await adminFetch("/.netlify/functions/gp-upload", { method: "POST", body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  };
  const run = async (file) => {
    if (ref.current) ref.current.value = "";
    if (!file) return;
    setState({ busy: true, secs: 0 });
    try {
      const r = await analyzeFile({ file, kind: "offre", opId: form.id, post, onProgress: (s) => setState({ busy: true, secs: s }) });
      setState({ result: r.result, products: r.products || {}, file_name: r.file_name });
    } catch (e) { setState({ error: e.message }); }
  };
  const apply = () => {
    const { result, products } = state;
    // Un produit déjà présent garde son identifiant : ses quantités commandées restent attachées
    const byCip = new Map(lines.map(l => [l.cip, l]));
    const imported = result.lines.map(l => {
      const prev = byCip.get(l.cip), p = products[l.cip] || {};
      return withText({ id: prev?.id, cip: l.cip, name: p.odoo_name || l.name || prev?.name || p.medipim?.name || "", odoo_product_id: p.odoo_product_id || prev?.odoo_product_id || null,
        price_gross: l.price_gross ?? prev?.price_gross ?? "", discount_mode: l.discount_mode, discount_pct: l.discount_pct || 0, discount_tiers: l.discount_tiers || [],
        extra_discounts: l.extra_discounts || [], ug_tiers: l.ug_tiers || [],
        weight: prev?.weight ?? 1, vat_rate: p.vat_rate ?? prev?.vat_rate ?? p.medipim?.vat ?? null, notes: l.notes || prev?.notes || "" });
    });
    if (mode === "remplacer") {
      const kept = lines.filter(l => !imported.some(x => x.cip === l.cip));
      if (kept.length && !window.confirm(`${kept.length} produit(s) actuel(s) absent(s) de l'offre seront retirés à l'enregistrement. Continuer ?`)) return;
      setLines(imported);
    } else {
      const have = new Set(lines.map(l => l.cip));
      setLines([...lines, ...imported.filter(l => !have.has(l.cip))]);
    }
    if (applyOp) setForm(x => {
      // Une date déjà prévue garde son identifiant (et donc les quantités saisies pour elle)
      const byDate = new Map((x.delivery_slots || []).map(s => [s.date, s]));
      const dates = [...new Set((result.delivery_dates || []).filter(okDate))].sort();
      const slots = dates.length
        ? dates.map(d => byDate.get(d) || { id: newSlotId(), date: d, label: "" })   // libellé vide : la date sert de libellé
        : x.delivery_slots;
      const dropped = (x.delivery_slots || []).filter(s => !slots.some(n => n.id === s.id));
      return { ...x,
        name: x.name || result.operation_name || "", supplier_name: x.supplier_name || result.supplier_name || "",
        start_date: okDate(result.start_date) ? result.start_date : x.start_date, end_date: okDate(result.end_date) ? result.end_date : x.end_date,
        rfa_pct: result.rfa_pct ?? x.rfa_pct, coop_mode: result.coop_mode && result.coop_mode !== "aucune" ? result.coop_mode : x.coop_mode,
        coop_amount: result.coop_amount ?? x.coop_amount, coop_label: result.coop_label || x.coop_label,
        objective_type: result.objective_type && result.objective_type !== "aucun" ? result.objective_type : x.objective_type, objective_value: result.objective_value ?? x.objective_value,
        conditions_text: result.conditions_text || x.conditions_text,
        delivery_slots: dropped.length ? [...slots, ...dropped] : slots };   // aucune date existante n'est retirée par l'import
    });
    setState(null);
  };
  const r = state?.result;
  return (
    <div style={{ ...card, background: "#f8fbff", borderColor: "#bfdbfe" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...h3, margin: 0 }}>📄 Importer l'offre du laboratoire</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Excel, CSV, PDF ou photo : l'IA relève les CIP, désignations, prix, remises, paliers, UG, RFA et coopération. Vous relisez avant d'appliquer, puis vous enregistrez.</div>
        </div>
        <input ref={ref} type="file" accept=".pdf,.csv,.txt,.xls,.xlsx,.ods,image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={e => run(e.target.files?.[0])} />
        <button type="button" style={btn("pri")} disabled={state?.busy} onClick={() => ref.current?.click()}>{state?.busy ? `Analyse… ${state.secs || 0} s` : "Choisir un fichier"}</button>
      </div>
      {state?.error && <div style={{ marginTop: 10 }}><Err text={state.error} /></div>}
      {r && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: "#0f2d3d", marginBottom: 8 }}>
            <b>{r.lines.length} produit(s)</b> trouvé(s) dans « {state.file_name} »
            {r.supplier_name && <> · {r.supplier_name}</>}{r.start_date && <> · du {dfr(r.start_date)}</>}{r.end_date && <> au {dfr(r.end_date)}</>}
            {r.rfa_pct ? <> · RFA {fr(r.rfa_pct)} %</> : null}{r.coop_amount ? <> · coopération {eur(r.coop_amount)}</> : null}
            {r.objective_type && r.objective_type !== "aucun" && r.objective_value ? <> · objectif {r.objective_value} ({r.objective_type})</> : null}
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
                      <td style={{ padding: "5px 8px" }}>{l.discount_mode === "unitaire" ? `−${fr(l.discount_pct)} %` : l.discount_mode === "paliers" ? tiersToText(l.discount_tiers) : ""}{(l.extra_discounts || []).map((d, k) => ` ${d.combine === "additionnelle" ? "+" : "puis"} ${d.mode === "paliers" ? tiersToText(d.tiers) : `−${fr(d.pct || 0)} %`}`).join("")} {ugToText(l.ug_tiers) && `UG ${ugToText(l.ug_tiers)}`}</td>
                      <td style={{ padding: "5px 8px", color: p.odoo_product_id ? "#16a34a" : "#b45309", fontWeight: 700 }}>{p.odoo_product_id ? (p.in_stock ? "✓ en stock" : "✓ précommande") : p.medipim ? "➕ fiche à créer (Medipim)" : "➕ fiche à créer"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {r.warnings?.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>⚠️ {w}</div>)}
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12, flexWrap: "wrap", fontSize: 13 }}>
            <label><input type="radio" checked={mode === "ajouter"} onChange={() => setMode("ajouter")} /> Ajouter les nouveaux produits</label>
            <label><input type="radio" checked={mode === "remplacer"} onChange={() => setMode("remplacer")} /> Remplacer la liste (conditions mises à jour)</label>
            <label><input type="checkbox" checked={applyOp} onChange={e => setApplyOp(e.target.checked)} /> Reprendre dates et conditions</label>
            <button type="button" style={btn("ok")} onClick={apply}>Appliquer</button>
            <button type="button" style={btn()} onClick={() => setState(null)}>Ignorer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pharmacies participantes ──
function Participants({ parts, setParts, access, call, opFee, locked }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const inOp = new Set(parts.map(p => p.pharmacy_id));
  const addP = (p) => { if (!inOp.has(p.id)) setParts(ps => [...ps, { pharmacy_id: p.id, pharmacy_name: p.name, email: p.email, pharmacy_cip: p.cip || null, fee_pct: null }]); };
  const search = async () => { try { setRes((await call(`action=pharmacies&q=${encodeURIComponent(q)}`)).pharmacies || []); } catch { setRes([]); } };
  const candidates = access.filter(a => !inOp.has(a.pharmacy_id));
  const allowed = new Set(access.map(a => a.pharmacy_id));
  return (
    <div style={card}>
      <div style={h3}>Pharmacies participantes ({parts.length})</div>
      {parts.map((p, i) => (
        <div key={p.pharmacy_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: i ? "1px solid #f1f5f9" : "none", fontSize: 13, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}><b>{p.pharmacy_name}</b> <span style={{ color: "#94a3b8" }}>{p.pharmacy_cip ? `CIP ${p.pharmacy_cip} · ` : ""}{p.email} · fiche Odoo {p.pharmacy_id}</span>
            {!allowed.has(p.pharmacy_id) && <span style={{ color: "#b45309" }}> · onglet débloqué à l'enregistrement</span>}</div>
          <span style={{ fontSize: 11, color: "#64748b" }}>frais</span>
          <input inputMode="decimal" style={{ ...CI, width: 70 }} value={p.fee_pct ?? ""} placeholder={String(opFee)} onChange={e => setParts(ps => ps.map(x => x.pharmacy_id === p.pharmacy_id ? { ...x, fee_pct: e.target.value === "" ? null : e.target.value } : x))} aria-label={`Frais de ${p.pharmacy_name}`} />
          <span style={{ fontSize: 11, color: "#64748b" }}>%</span>
          <button type="button" style={{ ...btn("danger"), padding: "5px 10px" }} onClick={() => setParts(ps => ps.filter(x => x.pharmacy_id !== p.pharmacy_id))} aria-label={`Retirer ${p.pharmacy_name}`}>✕</button>
        </div>
      ))}
      {!locked && candidates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>Pharmacies autorisées non inscrites</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {candidates.map(a => <button type="button" key={a.pharmacy_id} style={{ ...btn(), padding: "5px 10px", fontSize: 12 }} onClick={() => addP({ id: a.pharmacy_id, name: a.pharmacy_name, email: a.email, cip: a.pharmacy_cip })}>＋ {a.pharmacy_name || a.pharmacy_id}</button>)}
            <button type="button" style={{ ...btn("pri"), padding: "5px 10px", fontSize: 12 }} onClick={() => candidates.forEach(a => addP({ id: a.pharmacy_id, name: a.pharmacy_name, email: a.email, cip: a.pharmacy_cip }))}>Tout ajouter</button>
          </div>
        </div>
      )}
      {!locked && <>
        <div style={{ display: "flex", gap: 8, marginTop: 12, maxWidth: 520 }}>
          <input style={IS} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Chercher une autre pharmacie Elixir (nom, ville, CIP, e-mail)" aria-label="Chercher une pharmacie" />
          <button type="button" style={btn()} onClick={search}>🔎</button>
        </div>
        {res.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", gap: 8 }}>
            <span>{p.name} <span style={{ color: "#94a3b8" }}>{p.ville}{p.cip ? ` · CIP ${p.cip}` : ""} · {p.emails.join(", ")}</span></span>
            <button type="button" style={{ ...btn(), padding: "4px 10px" }} disabled={inOp.has(p.id)} onClick={() => addP(p)}>{inOp.has(p.id) ? "inscrite" : "＋ Ajouter"}</button>
          </div>
        ))}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Seules les pharmacies clientes d'Elixir apparaissent. Une pharmacie nouvellement inscrite reçoit l'accès à l'onglet à l'enregistrement.</div>
      </>}
    </div>
  );
}

// ── Suivi de l'opération ──
function Dashboard({ detail }) {
  const s = detail.summary;
  const op = detail.op;
  const slots = [{ id: IMMEDIATE_SLOT, label: (op.delivery_slots || []).length ? "Immédiat" : "Quantité" }, ...(op.delivery_slots || []).map(x => ({ id: x.id, label: x.label ? `${x.label} (${dfr(x.date)})` : dfr(x.date) }))];
  const usedSlots = slots.filter(sl => detail.lines.some(l => (s.groupBySlot[l.id]?.[sl.id] || 0) > 0));
  const confirmed = s.pharmacies.filter(p => p.totals);
  const tot = confirmed.reduce((a, p) => { for (const k of ["gross", "net", "fee", "totalHT", "rfaValue", "coop", "units"]) a[k] = (a[k] || 0) + (p.totals?.[k] || 0); return a; }, {});
  const exportXlsx = () => {
    const rows = [];
    for (const p of confirmed) for (const l of detail.lines) for (const sl of slots) {
      const q = p.bySlot[l.id]?.[sl.id] || 0;
      const f = p.freeBySlot?.[l.id]?.[sl.id] || 0;
      if (q) rows.push({ Pharmacie: p.name, Fiche_Odoo: p.id, CIP_pharmacie: p.cip || "", Livraison: sl.label, CIP: l.cip, Produit: l.name, Facturees: q, UG: f, Recues: q + f, Prix_brut_HT: Number(l.price_gross) });
    }
    const perPh = confirmed.map(p => ({ Pharmacie: p.name, Fiche_Odoo: p.id, Unites_facturees: p.totals.units, UG: p.totals.freeUnits, Unites_recues: p.totals.receivedUnits, Brut_HT: round2(p.totals.gross), Net_HT: round2(p.totals.net), RFA: round2(p.totals.rfaValue), Cooperation: round2(p.totals.coop), Frais: round2(p.totals.fee), Total_HT: round2(p.totals.totalHT), Confirmee_le: p.order?.confirmed_at?.slice(0, 10) }));
    const perLine = detail.lines.map(l => {
      const q = s.group[l.id] || 0, f = s.groupFree?.[l.id] || 0, gross = Number(l.price_gross) || 0;
      // montant labo = unités facturées × prix après remise sur facture (palier du groupe, ou de chaque pharmacie)
      const noRfa = { ...op, rfa_pct: 0 };
      const amount = op.tier_mode === "individuel"
        ? Object.values(s.perPharmacyTotal).reduce((a, qs) => a + (qs[l.id] || 0) * priceLine(noRfa, l, qs[l.id] || 0, qs[l.id] || 0).unitAfterInvoice, 0)
        : q * priceLine(noRfa, l, q, q).unitAfterInvoice;
      return { CIP: l.cip, Produit: l.name, Facturees_groupe: q, UG_groupe: f, Recues_groupe: q + f,
        ...Object.fromEntries(slots.flatMap(sl => [[sl.label, s.groupBySlot[l.id]?.[sl.id] || 0], ...(Object.keys(s.groupFree || {}).length ? [[`${sl.label} UG`, s.groupFreeBySlot?.[l.id]?.[sl.id] || 0]] : [])])),
        Prix_brut_HT: gross, Remise_facture_labo_pct: q > 0 && gross > 0 ? round2((1 - amount / (q * gross)) * 100) : 0, Montant_labo_HT: round2(amount) };
    });
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div style={{ ...h3, margin: 0 }}>Suivi — {confirmed.length}/{s.pharmacies.length} commande(s) · {tot.units || 0} unités · {eur(tot.totalHT)} HT</div>
        <button type="button" style={btn()} onClick={exportXlsx}>⬇ Excel</button>
      </div>
      {s.orphans > 0 && <div style={{ fontSize: 12, color: "#b45309", marginBottom: 10 }}>⚠️ {s.orphans} quantité(s) enregistrée(s) ne comptent plus (produit, date ou pharmacie retirés).</div>}
      {s.objective && <div style={{ marginBottom: 14 }}><Objective o={s.objective} /></div>}
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>Produit</th>{usedSlots.map(sl => <th key={sl.id} style={{ ...th, textAlign: "right" }}>{sl.label}</th>)}<th style={{ ...th, textAlign: "right" }}>Facturées</th><th style={{ ...th, textAlign: "right" }}>UG</th><th style={th}>Palier atteint</th><th style={th}>Prochain palier</th></tr></thead>
          <tbody>
            {detail.lines.map(l => {
              const q = s.group[l.id] || 0;
              const p = priceLine(op, l, q, q);
              return (
                <tr key={l.id}>
                  <td style={td}>{l.name}</td>
                  {usedSlots.map(sl => <td key={sl.id} style={{ ...td, textAlign: "right" }}>{s.groupBySlot[l.id]?.[sl.id] || ""}{s.groupFreeBySlot?.[l.id]?.[sl.id] ? <span style={{ color: "#15803d" }}> +{s.groupFreeBySlot[l.id][sl.id]}</span> : null}</td>)}
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{q}</td>
                  <td style={{ ...td, textAlign: "right", color: "#15803d", fontWeight: 700 }}>{s.groupFree?.[l.id] ? `+${s.groupFree[l.id]}` : ""}</td>
                  <td style={td}>{op.tier_mode === "individuel" ? "par pharmacie" : [p.invoicePct ? `−${fr(round2(p.invoicePct))} %` : "", p.ug.free ? `${p.ug.free} UG` : ""].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={{ ...td, color: "#0369a1" }}>{op.tier_mode === "individuel" ? "" : p.nextInvoiceTier ? `encore ${p.nextInvoiceTier.missing} → remise totale −${fr(round2(p.nextInvoiceTier.totalPct ?? p.nextInvoiceTier.pct))} %` : p.ug.next ? `encore ${p.ug.next.missing} → +${p.ug.next.gain} UG` : ""}</td>
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
              <tr key={p.id}>
                <td style={td}><b>{p.name}</b></td>
                <td style={td}>{p.totals ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ {dfr(p.order.confirmed_at)}{p.order.email_sent_at ? " ✉️" : ""}</span> : <span style={{ color: "#94a3b8" }}>pas encore</span>}</td>
                {p.totals ? (<>
                  <td style={{ ...td, textAlign: "right" }}>{p.totals.units}{p.totals.freeUnits ? <span style={{ color: "#15803d" }}> +{p.totals.freeUnits} UG</span> : null}</td><td style={{ ...td, textAlign: "right" }}>{eur(p.totals.gross)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{p.totals.rfaValue ? eur(p.totals.rfaValue) : ""}</td><td style={{ ...td, textAlign: "right" }}>{p.totals.coop ? eur(p.totals.coop) : ""}</td>
                  <td style={{ ...td, textAlign: "right" }}>{eur(p.totals.net)}</td><td style={{ ...td, textAlign: "right" }}>{eur(p.totals.fee)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{eur(p.totals.totalHT)}</td>
                </>) : <td style={td} colSpan={7} />}
                <td style={td}>{!p.totals ? "" : p.order.source === "fichier" ? `📄 ${p.order.file_name || "fichier"}` : "formulaire"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Bon de commande labo et commandes clients ──
function Fulfilment({ detail, call, refresh, dirty }) {
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState(null);
  const [jobs, setJobs] = useState({});          // slotId → état du déclenchement en arrière-plan
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const op = detail.op;
  const s = detail.summary;
  const slots = [{ id: IMMEDIATE_SLOT, label: (op.delivery_slots || []).length ? "Livraison immédiate (produits en stock)" : "Livraison à réception", date: null }, ...(op.delivery_slots || []).map(x => ({ id: x.id, label: x.label || "Livraison", date: x.date }))];
  const count = (sl) => {
    const need = s.pharmacies.filter(p => p.totals && Object.values(p.bySlot).some(x => (x[sl.id] || 0) > 0)).map(p => p.id);
    const done = new Set((detail.triggers || []).filter(t => t.slot_id === sl.id && t.odoo_sale_order_id).map(t => t.pharmacy_id));
    return { n: need.length, done: need.filter(id => done.has(id)).length };
  };
  const poll = useCallback(async (slotId) => {
    let failures = 0;
    for (let i = 0; i < 600 && alive.current; i++) {
      const st = await call(`action=trigger_status&id=${op.id}&slot_id=${encodeURIComponent(slotId)}`).catch(() => null);
      if (!alive.current) return;
      if (!st) { if (++failures >= 5) { setJobs(j => ({ ...j, [slotId]: { status: "inconnu", error: "Suivi interrompu (réseau) : rechargez pour voir l'état." } })); return; } }
      else { failures = 0; setJobs(j => ({ ...j, [slotId]: st })); if (st.status !== "en_cours") { refresh(); return; } }
      await new Promise(r => setTimeout(r, 2000));
    }
  }, [call, op.id, refresh]);
  // Reprendre le suivi d'un déclenchement déjà en cours (page rechargée)
  useEffect(() => {
    slots.forEach(sl => call(`action=trigger_status&id=${op.id}&slot_id=${encodeURIComponent(sl.id)}`).then(st => {
      if (st?.status && st.status !== "aucun") setJobs(j => ({ ...j, [sl.id]: st }));
      if (st?.status === "en_cours") poll(sl.id);
    }).catch(() => {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.id]);
  const po = async () => {
    if (dirty) { setOut({ error: "Enregistrez d'abord vos modifications." }); return; }
    if (!window.confirm("Créer le bon de commande (brouillon) chez le fournisseur dans Odoo ?")) return;
    setBusy("po"); setOut(null);
    try { const r = await call(null, { action: "po_create", id: op.id }); setOut({ type: "po", ...r }); } catch (e) { setOut({ error: e.message }); }
    refresh();
    setBusy("");
  };
  const trigger = async (sl) => {
    if (dirty) { setOut({ error: "Enregistrez d'abord vos modifications." }); return; }
    if (!window.confirm(`Créer dans Odoo les devis des pharmacies pour « ${sl.label} » ? (stock reçu)`)) return;
    setBusy(sl.id); setOut(null);
    try { await call(null, { action: "trigger", id: op.id, slot_id: sl.id }); setJobs(j => ({ ...j, [sl.id]: { status: "en_cours", created: [], errors: [] } })); await poll(sl.id); }
    catch (e) { setOut({ error: e.message }); }
    setBusy("");
  };
  return (
    <div style={card}>
      <div style={h3}>Commandes Odoo</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13 }}><b>Bon de commande au laboratoire</b> {op.po_odoo_id ? <span style={{ color: "#16a34a" }}>· créé (Odoo #{op.po_odoo_id}, le {dfr(op.po_created_at)})</span>
          : op.po_created_at ? <span style={{ color: "#b45309" }}>· création {Date.now() - Date.parse(op.po_created_at) > 2 * 60e3 ? "interrompue : relancez (le bon déjà créé sera retrouvé, pas de doublon)" : "en cours…"}</span>
          : <span style={{ color: "#64748b" }}>· quantités totales, une ligne par produit et par date de livraison</span>}</div>
        {!op.po_odoo_id && op.status === "cloturee" && (!op.po_created_at || Date.now() - Date.parse(op.po_created_at) > 2 * 60e3) &&
          <button type="button" style={btn("pri")} disabled={!!busy} onClick={po}>{busy === "po" ? "Création…" : op.po_created_at ? "Reprendre la création du bon" : "Créer le bon de commande"}</button>}
      </div>
      {slots.map(sl => {
        const { n, done } = count(sl);
        const job = jobs[sl.id];
        if (!n && !job) return null;
        const running = job?.status === "en_cours";
        return (
          <div key={sl.id} style={{ padding: "8px 0", borderTop: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}><b>{sl.label}</b>{sl.date ? ` · ${dfr(sl.date)}` : ""} · {n} pharmacie(s) · <span style={{ color: done >= n ? "#16a34a" : "#b45309" }}>{done} devis créé(s)</span></div>
              {done < n && <button type="button" style={btn("ok")} disabled={!!busy || running} onClick={() => trigger(sl)}>{running ? `Création… ${(job.created || []).length + (job.errors || []).length}/${job.total || "?"}` : `Créer les commandes (${n - done})`}</button>}
            </div>
            {job && job.status !== "en_cours" && (
              <div style={{ fontSize: 12, marginTop: 6 }}>
                {job.error && <div style={{ color: "#991b1b" }}>✕ {job.error}</div>}
                {(job.created || []).map(c => <div key={c.id} style={{ color: "#166534" }}>✓ {c.name} : devis {c.so_name} ({eur(c.amount_ht)} HT){c.recovered ? " — retrouvé après interruption" : ""}</div>)}
                {(job.errors || []).map(c => <div key={c.id} style={{ color: "#991b1b" }}>✕ {c.name} : {c.error}</div>)}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Les devis sont créés en brouillon dans Odoo sur la fiche client Elixir de chaque pharmacie : prix brut de l'offre et une remise unique qui regroupe remise sur facture, UG, RFA et coopération, frais de traitement inclus (remise arrondie à 2 décimales, comme dans Odoo). Vérifiez-les puis confirmez-les dans Odoo.</div>
      {out?.error && <div style={{ marginTop: 10 }}><Err text={out.error} /></div>}
      {out?.type === "po" && <div style={{ marginTop: 10, fontSize: 13, color: "#166534" }}>✓ Bon {out.po_name} {out.reused ? "retrouvé" : "créé"} : {out.lines} ligne(s), {eur(out.amount_ht)} HT.{out.skipped?.length ? ` Sans fiche Odoo (non repris) : ${out.skipped.join(", ")}` : ""}</div>}
    </div>
  );
}

// ── Pharmacies autorisées à voir l'onglet ──
function AccessView({ access, setAccess, call, back, err, setErr }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const have = new Set(access.map(a => a.pharmacy_id));
  const search = async () => { try { setRes((await call(`action=pharmacies&q=${encodeURIComponent(q)}`)).pharmacies || []); } catch (e) { setErr(e.message); } };
  const add = async (p) => { try { setAccess((await call(null, { action: "access_add", pharmacies: [{ id: p.id, name: p.name, email: p.email, cip: p.cip }] })).access); } catch (e) { setErr(e.message); } };
  const del = async (a) => {
    if (!window.confirm(`Retirer l'accès de ${a.pharmacy_name} ? L'onglet disparaîtra de son menu.`)) return;
    try { setAccess((await call(null, { action: "access_remove", id: a.pharmacy_id })).access); } catch (e) { setErr(e.message); }
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button type="button" style={btn()} onClick={back}>← Opérations</button>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f2d3d" }}>Pharmacies autorisées ({access.length})</div>
      </div>
      {err && <Err text={err} />}
      <div style={card}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Seules ces pharmacies voient l'onglet « Commandes groupées » dans leur menu. Vous choisissez ensuite, opération par opération, celles qui participent.</div>
        {access.map((a, i) => (
          <div key={a.pharmacy_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i ? "1px solid #f1f5f9" : "none", fontSize: 13, gap: 8 }}>
            <span><b>{a.pharmacy_name}</b> <span style={{ color: "#94a3b8" }}>{a.pharmacy_cip ? `CIP ${a.pharmacy_cip} · ` : ""}{a.email} · fiche Odoo {a.pharmacy_id}</span></span>
            <button type="button" style={{ ...btn("danger"), padding: "5px 10px" }} onClick={() => del(a)}>Retirer</button>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ display: "flex", gap: 8, maxWidth: 520 }}>
          <input style={IS} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Nom, ville, CIP ou e-mail" aria-label="Chercher une pharmacie" />
          <button type="button" style={btn("pri")} onClick={search}>Chercher</button>
        </div>
        {res.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", gap: 8 }}>
            <span>{p.name} <span style={{ color: "#94a3b8" }}>{p.ville}{p.cip ? ` · CIP ${p.cip}` : ""} · {p.emails.join(", ")}</span></span>
            <button type="button" style={{ ...btn(), padding: "5px 10px" }} disabled={have.has(p.id)} onClick={() => add(p)}>{have.has(p.id) ? "autorisée" : "＋ Autoriser"}</button>
          </div>
        ))}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Seules les pharmacies clientes d'Elixir (société 2) apparaissent.</div>
      </div>
    </div>
  );
}
