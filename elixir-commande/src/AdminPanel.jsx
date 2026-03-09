import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

const ADMIN_PASSWORD = "elixir2026";

const SECTIONS = [
  { key: "expert",    label: "💊 Sélection Expert" },
  { key: "stratege",  label: "📦 Sélection Stratège" },
  { key: "master",    label: "⭐ Sélection Master" },
  { key: "obeso",     label: "💉 Mounjaro / Wegovy" },
  { key: "nr",        label: "🔬 Autres NR" },
  { key: "molnlycke", label: "🩹 Offre Mölnlycke" },
  { key: "blanche",   label: "🧻 Gamme Blanche" },
  { key: "covid",     label: "🦠 Diagnostic & Covid" },
  { key: "otc",       label: "🛒 Centrale OTC / Para" },
];

const EMPTY_FORM = { name:"", cip:"", pv:"", pct:"", remise_eur:"", pn:"", section:"otc", hasPalier:false, palier:"", note:"" };

const overrideKey = (sectionKey, p) => `${sectionKey}::${p.cip || p.name}`;

export default function AdminPanel({ onClose, sectionMeta }) {
  const [authed, setAuthed]     = useState(false);
  const [pwd, setPwd]           = useState("");
  const [pwdError, setPwdError] = useState(false);
  const [tab, setTab]           = useState("add");
  const [saved, setSaved]       = useState("");

  const [form, setForm]         = useState(EMPTY_FORM);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const fetchProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await fetch("/.netlify/functions/products-get");
      const data = await res.json();
      if (data.products) setProducts(data.products);
    } catch(e) { console.warn("[products] fetch error:", e.message); }
    setProductsLoading(false);
  };
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState({}); // orderId → "pending"|"ok"|"error"|message
  const [promos, setPromos] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_promos") || "[]"); } catch { return []; }
  });
  const [promoForm, setPromoForm] = useState({ name:"", description:"", icon:"🏷️", color:"#7c3aed", accentColor:"#a855f7", endDate:"" });
  const [editingPromoId, setEditingPromoId] = useState(null);
  const [addingProductToPromo, setAddingProductToPromo] = useState(null); // promoId
  const [promoProductForm, setPromoProductForm] = useState({ name:"", cip:"", pv:"", pct:"", pn:"", note:"" });
  // Excel import
  const [importSection, setImportSection] = useState("otc");
  const [importPreview, setImportPreview] = useState(null); // parsed rows
  const [importError, setImportError] = useState("");
  const [importCount, setImportCount] = useState(0);
  const fileInputRef = useRef();
  const [search, setSearch]       = useState("");
  const [filterSection, setFilterSection] = useState("all");
  const [editingKey, setEditingKey] = useState(null);
  const [editForm, setEditForm]   = useState({});

  useEffect(() => {
    const pv = parseFloat(form.pv);
    if (isNaN(pv) || pv === 0) return;
    const pct = parseFloat(form.pct);
    const eur = parseFloat(form.remise_eur);
    if (!isNaN(pct) && form._lastEdited !== "eur") {
      const e = (pv * pct / 100).toFixed(2);
      const pn = (pv - pv*pct/100).toFixed(2);
      setForm(f => ({ ...f, remise_eur: e, pn }));
    } else if (!isNaN(eur) && form._lastEdited === "eur") {
      const p = (eur / pv * 100).toFixed(2);
      const pn = (pv - eur).toFixed(2);
      setForm(f => ({ ...f, pct: p, pn }));
    }
  }, [form.pv, form.pct, form.remise_eur]);

  useEffect(() => {
    const pv = parseFloat(editForm.pv);
    if (isNaN(pv) || pv === 0) return;
    const pct = parseFloat(editForm.pct);
    const eur = parseFloat(editForm.remise_eur);
    if (!isNaN(pct) && editForm._lastEdited !== "eur") {
      const e = (pv * pct / 100).toFixed(2);
      setEditForm(f => ({ ...f, remise_eur: e, pn: (pv - pv*pct/100).toFixed(2) }));
    } else if (!isNaN(eur) && editForm._lastEdited === "eur") {
      setEditForm(f => ({ ...f, pct: (eur/pv*100).toFixed(2), pn: (pv - eur).toFixed(2) }));
    }
  }, [editForm.pv, editForm.pct, editForm.remise_eur]);

  const handleLogin = () => {
    if (pwd === ADMIN_PASSWORD) { setAuthed(true); setPwdError(false); refreshOrders(); fetchProducts(); }
    else setPwdError(true);
  };

  const handleField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!form.name.trim()) return alert("Le nom du produit est requis.");
    if (!form.pn) return alert("Le prix remisé est requis.");
    const product = {
      cip: form.cip.trim() || `admin_${Date.now()}`,
      name: form.name.trim(),
      section: form.section,
      pv: parseFloat(form.pv) || null,
      pct: parseFloat(form.pct) || null,
      pn: parseFloat(form.pn),
      colis: form.hasPalier ? parseInt(form.palier) || null : null,
      note: form.note.trim() || null,
      source: "admin",
      active: true,
    };
    try {
      const res = await fetch("/.netlify/functions/products-upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, action: "create", author: "admin" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await fetchProducts();
      setForm(EMPTY_FORM);
      flash("✅ Produit ajouté !");
    } catch(e) { alert("Erreur : " + e.message); }
  };

  const handleDelete = async (cip) => {
    if (!window.confirm("Désactiver ce produit ?")) return;
    try {
      await fetch("/.netlify/functions/products-upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: { cip, active: false }, action: "delete", author: "admin" }),
      });
      await fetchProducts();
      flash("🗑️ Produit désactivé");
    } catch(e) { alert("Erreur : " + e.message); }
  };

  const allProducts = useMemo(() => {
    return products.map(p => ({
      ...p,
      _section: p.section,
      _sectionLabel: SECTIONS.find(s=>s.key===p.section)?.label || p.section,
      _key: overrideKey(p.section, p),
    }));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allProducts.filter(p => {
      const mq = !q || p.name.toLowerCase().includes(q) || (p.cip||"").includes(q);
      const ms = filterSection==="all" || p._section===filterSection;
      return mq && ms;
    });
  }, [allProducts, search, filterSection]);

  const startEdit = (p) => {
    setEditForm({
      cip:    String(p.cip   ?? ""),
      pv:     String(p.pv    ?? ""),
      pct:    String(typeof p.pct === "string" ? p.pct.replace(/[-% ]/g,"") : (p.pct ?? "")),
      pn:     String(p.pn    ?? ""),
      palier: String(p.colis ?? ""),
      note:   String(p.note  ?? ""),
    });
    setEditingKey(p._key);
  };

  const saveEdit = async (p) => {
    const pv=parseFloat(editForm.pv), pct=parseFloat(editForm.pct), pn=parseFloat(editForm.pn);
    const product = {
      cip: p.cip,
      name: p.name,
      section: p._section,
      pv:  !isNaN(pv)  ? pv  : p.pv,
      pct: !isNaN(pct) ? pct : p.pct,
      pn:  !isNaN(pn)  ? pn  : p.pn,
      colis: editForm.palier !== "" ? parseInt(editForm.palier)||null : p.colis,
      note:  editForm.note   !== "" ? editForm.note : p.note,
      source: p.source || "catalog",
      active: true,
      _changes: { pv, pct, pn, note: editForm.note },
    };
    try {
      const res = await fetch("/.netlify/functions/products-upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, action: "update", author: "admin" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await fetchProducts();
      setEditingKey(null);
      flash("✅ Modification enregistrée !");
    } catch(e) { alert("Erreur : " + e.message); }
  };

  const clearEdit = async (p) => {
    // Remet les valeurs d'origine (supprime les overrides = recharge depuis catalog-data)
    flash("↩️ Fonctionnalité disponible via re-migration");
  };

  // ── PROMO helpers ──
  const savePromos = (updated) => {
    setPromos(updated);
    localStorage.setItem("admin_promos", JSON.stringify(updated));
  };
  const createPromo = () => {
    if (!promoForm.name.trim()) return alert("Nom requis");
    const newPromo = { id: Date.now(), ...promoForm, active: false, products: [] };
    savePromos([...promos, newPromo]);
    setPromoForm({ name:"", description:"", icon:"🏷️", color:"#7c3aed", accentColor:"#a855f7", endDate:"" });
    flash("✅ Section promo créée !");
  };
  const togglePromoActive = (id) => savePromos(promos.map(p => p.id===id ? {...p, active:!p.active} : p));
  const deletePromo = (id) => { if(!window.confirm("Supprimer cette section promo ?")) return; savePromos(promos.filter(p => p.id!==id)); };
  const addProductToPromo = (promoId) => {
    const pn = parseFloat(promoProductForm.pn);
    if (!promoProductForm.name.trim() || isNaN(pn)) return alert("Nom et prix net requis");
    const prod = { id: Date.now(), name: promoProductForm.name.trim(), cip: promoProductForm.cip.trim()||null, pv: parseFloat(promoProductForm.pv)||null, pct: promoProductForm.pct||null, pn, note: promoProductForm.note.trim()||null };
    savePromos(promos.map(p => p.id===promoId ? {...p, products:[...(p.products||[]), prod]} : p));
    setPromoProductForm({ name:"", cip:"", pv:"", pct:"", pn:"", note:"" });
    setAddingProductToPromo(null);
    flash("✅ Produit ajouté à la promo !");
  };
  const removeProductFromPromo = (promoId, prodId) => savePromos(promos.map(p => p.id===promoId ? {...p, products:(p.products||[]).filter(pr=>pr.id!==prodId)} : p));
  const updatePromoField = (id, field, val) => savePromos(promos.map(p => p.id===id ? {...p, [field]:val} : p));

  // ── IMPORT helpers ──
  const handleImportFile = (file) => {
    if (!file) return;
    setImportError("");
    setImportPreview(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        // Try to map columns flexibly
        const mapped = rows.map((r, i) => {
          // Find keys case-insensitively
          const get = (...keys) => {
            for (const k of keys) {
              const found = Object.keys(r).find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g,"").includes(k.toLowerCase().replace(/[^a-z0-9]/g,"")));
              if (found && r[found] !== "") return r[found];
            }
            return "";
          };
          const pv = parseFloat(String(get("prix","pv","catalogue","brut")).replace(",",".")) || null;
          const pctRaw = String(get("remise","pct","reduction","rabais")).replace(",",".").replace("%","").trim();
          const pct = parseFloat(pctRaw) || null;
          const pn = (pv != null && pct != null) ? parseFloat((pv * (1 - pct/100)).toFixed(2)) : null;
          const palier = parseInt(get("palier","colis","qte","min")) || null;
          return {
            _row: i+2,
            cip: String(get("cip","code","reference","ref")).trim() || null,
            name: String(get("nom","designation","name","produit","libelle")).trim(),
            pv,
            pct: pct ? `-${pct}%` : null,
            pn,
            palier,
            _valid: !!String(get("nom","designation","name","produit","libelle")).trim() && pn != null,
          };
        }).filter(r => r.name);
        if (mapped.length === 0) { setImportError("Aucun produit détecté. Vérifiez les colonnes."); return; }
        setImportPreview(mapped);
      } catch(err) {
        setImportError("Erreur de lecture : " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    const valid = importPreview.filter(r => r._valid);
    const newProducts = valid.map(r => ({
      id: Date.now() + Math.random(),
      section: importSection,
      name: r.name,
      cip: r.cip,
      pv: r.pv,
      pct: r.pct,
      pn: r.pn,
      palier: r.palier,
      colis: r.palier,
      note: null,
      addedAt: new Date().toLocaleDateString("fr-FR"),
    }));
    try {
      await Promise.all(newProducts.map(p =>
        fetch("/.netlify/functions/products-upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product: p, action: "create", author: "import" }),
        })
      ));
      await fetchProducts();
      setImportCount(valid.length);
      setImportPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      flash(`✅ ${valid.length} produit(s) importé(s) dans ${SECTIONS.find(s=>s.key===importSection)?.label} !`);
    } catch(e) { alert("Erreur import : " + e.message); }
  };

  // ── SYNC helpers ──
  const syncOrder = async (order) => {
    setSyncStatus(s => ({ ...s, [order.id]: "pending" }));
    // Build CSV
    const cipLookup = {};
    products.forEach(p => { if(p.cip && p.name) cipLookup[p.name.trim().toLowerCase()] = p.cip; });
    const lines = (order.items||[]).map(i => {
      let cip = i.cip && i.cip !== "—" ? i.cip : cipLookup[i.name?.trim().toLowerCase()] || "—";
      return `${cip.replace(/;/g,"")};${i.qty}`;
    });
    const csvContent = lines.join("\n");
    try {
      const res = await fetch("http://localhost:3001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent: order.csv, items: order.items, pharmacyName: order.pharmacyName, pharmacyEmail: order.pharmacyEmail, pharmacyCip: order.pharmacyCip, orderId: order.id }),
        signal: AbortSignal.timeout(15000),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setSyncStatus(s => ({ ...s, [order.id]: "ok" }));
        // Auto-mark as processed dans Supabase
        setOrders(orders.map(o => o.id===order.id ? {...o, processed:true} : o));
        fetch("/.netlify/functions/order-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: order.id, processed: true })
        });
      } else {
        setSyncStatus(s => ({ ...s, [order.id]: json.error || "Erreur inconnue" }));
      }
    } catch(err) {
      setSyncStatus(s => ({ ...s, [order.id]: err.message.includes("fetch") || err.message.includes("connect") ? "Agent local non démarré — lance LANCER_AGENT.command" : err.message }));
    }
  };

  const syncAllPending = async () => {
    const pending = orders.filter(o => !o.processed);
    for (const o of pending) await syncOrder(o);
  };

  const flash = (msg) => { setSaved(msg); setTimeout(()=>setSaved(""), 2500); };
  const fmt = (n) => n!=null&&!isNaN(n) ? Number(n).toFixed(2)+" €" : "—";

  const refreshOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch("/.netlify/functions/order-list");
      const json = await res.json();
      if (json.orders) setOrders(json.orders);
    } catch(e) { console.warn("[order-list] erreur:", e.message); }
    setOrdersLoading(false);
  };

  const downloadCsv = (order) => {
    // Build a CIP lookup from all catalog sections (name → cip, and cip → cip)
    const cipLookup = {};
    products.forEach(p => {
      if (p.cip) {
        cipLookup[p.name?.trim().toLowerCase()] = p.cip;
        cipLookup[p.cip] = p.cip;
      }
    });
    // Regenerate CSV from items, resolving CIP if stored value is missing
    const lines = ["CIP;Quantité"];
    (order.items || []).forEach(i => {
      let cip = i.cip && i.cip !== "—" ? i.cip : null;
      if (!cip) cip = cipLookup[i.name?.trim().toLowerCase()] || "—";
      lines.push(`${cip.replace(/;/g,"")};${i.qty}`);
    });
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commande_${order.pharmacyName.replace(/\s+/g,"_")}_${order.date.slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const toggleProcessed = async (id) => {
    const order = orders.find(o => o.id === id);
    const newVal = !order?.processed;
    setOrders(orders.map(o => o.id===id ? {...o, processed: newVal} : o));
    await fetch("/.netlify/functions/order-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, processed: newVal })
    });
  };

  const deleteOrder = async (id) => {
    setOrders(orders.filter(o => o.id!==id));
    await fetch("/.netlify/functions/order-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "delete" })
    });
  };

  // LOGIN
  if (!authed) return (
    <div style={OV}>
      <div style={MO}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d" }}>🔐 Espace Admin</div>
            <div style={{ fontSize:12, color:"#aaa", marginTop:2 }}>Elixir Pharma – Gestion du catalogue</div>
          </div>
          <button onClick={onClose} style={CB}>✕</button>
        </div>
        <label style={LS}>Mot de passe administrateur</label>
        <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••"
          style={{ ...IS, borderColor: pwdError?"#f87171":"#e2e8f0" }} />
        {pwdError&&<div style={{color:"#ef4444",fontSize:12,marginTop:6}}>Mot de passe incorrect.</div>}
        <button onClick={handleLogin} style={{...PB,marginTop:16}}>Accéder →</button>
      </div>
    </div>
  );

  return (
    <div style={OV}>
      <div style={{...MO, maxWidth:700, maxHeight:"92vh", overflowY:"auto", padding:"28px 32px"}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontWeight:800,fontSize:18,color:"#0f2d3d"}}>⚙️ Administration catalogue</div>
            <div style={{fontSize:11,color:"#aaa",marginTop:2}}>
              {products.filter(p=>p.source==="admin").length} ajouté(s) · {products.length} total · {promos.length} promo(s) · {orders.length} commande(s)
            </div>
          </div>
          <button onClick={onClose} style={CB}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          {[{k:"add",label:"➕ Ajouter"},{k:"edit",label:"✏️ Modifier"},{k:"promos",label:`🎯 Promos${promos.length>0?" ("+promos.length+")":""}`},{k:"orders",label:`📋 Commandes${orders.filter(o=>!o.processed).length>0?" ("+orders.filter(o=>!o.processed).length+")":"" }`}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{
              flex:1, padding:"10px", borderRadius:10, fontWeight:700, fontSize:13, cursor:"pointer",
              border: tab===t.k?"2px solid #0f2d3d":"2px solid #e2e8f0",
              background: tab===t.k?"#0f2d3d":"white",
              color: tab===t.k?"white":"#555",
            }}>{t.label}</button>
          ))}
        </div>

        {saved&&<div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,padding:"10px 14px",marginBottom:16,color:"#166534",fontWeight:600,fontSize:13}}>{saved}</div>}

        {/* ── ADD TAB ── */}
        {tab==="add"&&(
          <>
            {/* ── EXCEL IMPORT ── */}
            <div style={{background:"#fafbfc",border:"1px solid #e8eaed",borderRadius:14,padding:"16px",marginBottom:24}}>
              <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                📥 Import depuis Excel
                <span style={{fontSize:10,fontWeight:400,color:"#888",background:"#f0f2f5",borderRadius:6,padding:"2px 8px"}}>CIP · Nom · Prix catalogue · Remise · Palier</span>
              </div>
              <div style={{display:"flex",gap:10,marginBottom:12}}>
                <div style={{flex:1}}>
                  <label style={{...LS,fontSize:10}}>Section de destination</label>
                  <select value={importSection} onChange={e=>setImportSection(e.target.value)} style={{...IS,fontSize:12,padding:"7px 10px"}}>
                    {SECTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div style={{flex:1}}>
                  <label style={{...LS,fontSize:10}}>Fichier Excel (.xlsx, .xls, .csv)</label>
                  <label style={{display:"flex",alignItems:"center",gap:8,background:"white",border:"1.5px dashed #cbd5e0",borderRadius:10,padding:"7px 12px",cursor:"pointer"}}>
                    <span style={{fontSize:16}}>📂</span>
                    <span style={{fontSize:12,color:"#555"}}>Choisir un fichier</span>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={e=>handleImportFile(e.target.files[0])} style={{display:"none"}}/>
                  </label>
                </div>
              </div>

              {importError&&<div style={{background:"#fff5f5",border:"1px solid #fed7d7",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#c53030",marginBottom:10}}>⚠️ {importError}</div>}

              {importPreview&&(
                <div>
                  <div style={{fontSize:12,color:"#555",marginBottom:8,fontWeight:600}}>
                    Aperçu : {importPreview.filter(r=>r._valid).length} valide(s) / {importPreview.length} ligne(s)
                    {importPreview.some(r=>!r._valid)&&<span style={{color:"#e07b39",marginLeft:6}}>— {importPreview.filter(r=>!r._valid).length} ignorée(s) (nom ou prix manquant)</span>}
                  </div>
                  <div style={{maxHeight:200,overflowY:"auto",border:"1px solid #e8eaed",borderRadius:10,marginBottom:12}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead>
                        <tr style={{background:"#f8fafc",position:"sticky",top:0}}>
                          {["CIP","Désignation","Prix cat.","Remise","Prix net","Palier",""].map(h=>(
                            <th key={h} style={{padding:"6px 8px",textAlign:"left",fontWeight:700,color:"#555",borderBottom:"1px solid #e8eaed"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((r,i)=>(
                          <tr key={i} style={{background:r._valid?"white":"#fff5f5",borderBottom:"1px solid #f5f5f5"}}>
                            <td style={{padding:"5px 8px",fontFamily:"monospace",color:"#888"}}>{r.cip||"—"}</td>
                            <td style={{padding:"5px 8px",fontWeight:600,color:r._valid?"#0f2d3d":"#c53030"}}>{r.name||<em>manquant</em>}</td>
                            <td style={{padding:"5px 8px",textAlign:"right"}}>{r.pv!=null?r.pv.toFixed(2)+" €":"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",color:"#7c3aed"}}>{r.pct||"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",fontWeight:700,color:r.pn!=null?"#059669":"#c53030"}}>{r.pn!=null?r.pn.toFixed(2)+" €":"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",color:"#888"}}>{r.palier||"—"}</td>
                            <td style={{padding:"5px 8px"}}>{r._valid?"✅":"⚠️"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={confirmImport} style={{...PB,flex:2,padding:"9px",fontSize:13}}>
                      ✅ Importer {importPreview.filter(r=>r._valid).length} produit(s) → {SECTIONS.find(s=>s.key===importSection)?.label}
                    </button>
                    <button onClick={()=>{setImportPreview(null);if(fileInputRef.current)fileInputRef.current.value="";}} style={{flex:1,background:"#e5e7eb",border:"none",borderRadius:10,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:700,color:"#374151"}}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Séparateur ── */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <div style={{flex:1,height:1,background:"#e8eaed"}}/>
              <span style={{fontSize:11,color:"#aaa",fontWeight:600}}>OU SAISIE MANUELLE</span>
              <div style={{flex:1,height:1,background:"#e8eaed"}}/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Nom du produit *</label>
                <input value={form.name} onChange={e=>handleField("name",e.target.value)} placeholder="DOLIPRANE 500MG BTE 16" style={IS}/>
              </div>
              <div>
                <label style={LS}>Code CIP</label>
                <input value={form.cip} onChange={e=>handleField("cip",e.target.value)} placeholder="3400930000000" style={IS}/>
              </div>
              <div>
                <label style={LS}>Section *</label>
                <select value={form.section} onChange={e=>handleField("section",e.target.value)} style={IS}>
                  {SECTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={LS}>Prix de base (€)</label>
                <input type="number" step="0.01" value={form.pv} onChange={e=>handleField("pv",e.target.value)} placeholder="5.90" style={IS}/>
              </div>
              <div>
                <label style={LS}>Remise %</label>
                <input type="number" step="0.01" value={form.pct}
                  onChange={e=>setForm(f=>({...f, pct:e.target.value, _lastEdited:"pct"}))}
                  placeholder="20.00" style={IS}/>
              </div>
              <div>
                <label style={LS}>Remise €</label>
                <input type="number" step="0.01" value={form.remise_eur}
                  onChange={e=>setForm(f=>({...f, remise_eur:e.target.value, _lastEdited:"eur"}))}
                  placeholder="1.18" style={IS}/>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Prix remisé (€) – calculé auto *</label>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="number" step="0.01" value={form.pn} onChange={e=>handleField("pn",e.target.value)} placeholder="4.72"
                    style={{...IS,flex:1,background:form.pv&&form.pct?"#f0fdf4":"white",fontWeight:700,color:"#059669"}}/>
                  {form.pv&&form.pct&&<span style={{fontSize:12,color:"#059669",fontWeight:600,whiteSpace:"nowrap"}}>= {form.pv} × {(1-parseFloat(form.pct)/100).toFixed(3)}</span>}
                </div>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Palier / Colis minimum ?</label>
                <div style={{display:"flex",gap:10}}>
                  {[{v:false,l:"Non"},{v:true,l:"Oui"}].map(opt=>(
                    <button key={opt.l} onClick={()=>handleField("hasPalier",opt.v)} style={{
                      flex:1,padding:"9px",borderRadius:10,fontWeight:700,fontSize:13,cursor:"pointer",
                      border:form.hasPalier===opt.v?"2px solid #0f2d3d":"2px solid #e2e8f0",
                      background:form.hasPalier===opt.v?"#0f2d3d":"white",
                      color:form.hasPalier===opt.v?"white":"#555",
                    }}>{opt.l}</button>
                  ))}
                </div>
              </div>
              {form.hasPalier&&<div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Quantité minimum</label>
                <input type="number" value={form.palier} onChange={e=>handleField("palier",e.target.value)} placeholder="ex: 24" style={IS}/>
              </div>}
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Note (optionnel)</label>
                <input value={form.note} onChange={e=>handleField("note",e.target.value)} placeholder="Stock limité..." style={IS}/>
              </div>
            </div>
            <button onClick={handleAdd} style={{...PB,marginTop:20}}>➕ Ajouter ce produit</button>
            {products.length>0&&(
              <div style={{marginTop:24,borderTop:"1px solid #f0f2f5",paddingTop:20}}>
                <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",marginBottom:10}}>Produits ajoutés ({products.length})</div>
                {products.map(p=>(
                  <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",background:"#fafbfc",borderRadius:10,padding:"10px 14px",marginBottom:8,border:"1px solid #f0f2f5"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d"}}>{p.name}</div>
                      <div style={{fontSize:11,color:"#888",marginTop:2}}>{SECTIONS.find(s=>s.key===p.section)?.label} · {fmt(p.pn)}{p.palier?` · ×${p.palier}`:""}{p.cip?` · ${p.cip}`:""}</div>
                    </div>
                    <button onClick={()=>handleDelete(p.cip||p._key)} style={{background:"none",border:"none",cursor:"pointer",color:"#f87171",fontSize:16}}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── PROMOS TAB ── */}
        {tab==="promos"&&(
          <>
            {/* Create new promo form */}
            <div style={{background:"#fafbfc",borderRadius:14,padding:"16px",marginBottom:20,border:"1px solid #e8eaed"}}>
              <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",marginBottom:14}}>Créer une section promotionnelle</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{...LS,fontSize:10}}>Nom de la section *</label>
                  <input value={promoForm.name} onChange={e=>setPromoForm(f=>({...f,name:e.target.value}))} placeholder="Flash Semaine / Offre Spéciale..." style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{...LS,fontSize:10}}>Description (affichée dans le popup)</label>
                  <input value={promoForm.description} onChange={e=>setPromoForm(f=>({...f,description:e.target.value}))} placeholder="Promotions exclusives cette semaine !" style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                </div>
                <div>
                  <label style={{...LS,fontSize:10}}>Icône (emoji)</label>
                  <input value={promoForm.icon} onChange={e=>setPromoForm(f=>({...f,icon:e.target.value}))} placeholder="🏷️" style={{...IS,fontSize:18,padding:"5px 10px",textAlign:"center"}}/>
                </div>
                <div>
                  <label style={{...LS,fontSize:10}}>Date de fin (optionnel)</label>
                  <input type="date" value={promoForm.endDate} onChange={e=>setPromoForm(f=>({...f,endDate:e.target.value}))} style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                </div>
                <div>
                  <label style={{...LS,fontSize:10}}>Couleur principale</label>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input type="color" value={promoForm.color} onChange={e=>setPromoForm(f=>({...f,color:e.target.value}))} style={{width:36,height:36,border:"none",borderRadius:8,cursor:"pointer",padding:2}}/>
                    <span style={{fontSize:12,color:"#888"}}>{promoForm.color}</span>
                  </div>
                </div>
                <div>
                  <label style={{...LS,fontSize:10}}>Couleur accent</label>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input type="color" value={promoForm.accentColor} onChange={e=>setPromoForm(f=>({...f,accentColor:e.target.value}))} style={{width:36,height:36,border:"none",borderRadius:8,cursor:"pointer",padding:2}}/>
                    <span style={{fontSize:12,color:"#888"}}>{promoForm.accentColor}</span>
                  </div>
                </div>
              </div>
              <button onClick={createPromo} style={{...PB,padding:"9px",fontSize:13}}>✨ Créer cette section</button>
            </div>

            {/* Existing promos */}
            {promos.length===0&&<div style={{textAlign:"center",padding:"30px",color:"#aaa",fontSize:13}}>Aucune section promo créée.</div>}
            {promos.map(ps=>(
              <div key={ps.id} style={{borderRadius:14,marginBottom:14,border:`2px solid ${ps.active?ps.color+"60":"#e8eaed"}`,background:ps.active?`${ps.color}08`:"#fafbfc",overflow:"hidden"}}>
                {/* Promo header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",borderBottom:"1px solid #f0f2f5"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:24}}>{ps.icon}</span>
                    <div>
                      <div style={{fontWeight:800,fontSize:14,color:"#0f2d3d",display:"flex",alignItems:"center",gap:8}}>
                        {ps.name}
                        {ps.active
                          ? <span style={{background:"#dcfce7",color:"#166534",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:10}}>● VISIBLE</span>
                          : <span style={{background:"#f3f4f6",color:"#6b7280",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:10}}>○ MASQUÉ</span>
                        }
                      </div>
                      {ps.description&&<div style={{fontSize:11,color:"#888"}}>{ps.description}</div>}
                      {ps.endDate&&<div style={{fontSize:11,color:"#e07b39",fontWeight:600}}>⏰ Jusqu'au {new Date(ps.endDate).toLocaleDateString("fr-FR")}</div>}
                      <div style={{fontSize:11,color:"#999"}}>{(ps.products||[]).length} produit(s)</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button onClick={()=>togglePromoActive(ps.id)} style={{
                      background:ps.active?"#fef3c7":"#dcfce7",border:"none",borderRadius:8,padding:"5px 10px",
                      cursor:"pointer",fontSize:11,fontWeight:800,color:ps.active?"#92400e":"#166534"
                    }}>{ps.active?"Masquer":"Afficher"}</button>
                    <button onClick={()=>setAddingProductToPromo(addingProductToPromo===ps.id?null:ps.id)} style={{background:"#eff6ff",border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:"#1e40af"}}>+ Produit</button>
                    <button onClick={()=>deletePromo(ps.id)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,color:"#b91c1c"}}>🗑</button>
                  </div>
                </div>

                {/* Add product form */}
                {addingProductToPromo===ps.id&&(
                  <div style={{background:"#eff6ff",padding:"12px 16px",borderBottom:"1px solid #dbeafe"}}>
                    <div style={{fontWeight:700,fontSize:12,color:"#1e40af",marginBottom:10}}>Ajouter un produit à {ps.name}</div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8,marginBottom:8}}>
                      <div>
                        <label style={{...LS,fontSize:10}}>Nom *</label>
                        <input value={promoProductForm.name} onChange={e=>setPromoProductForm(f=>({...f,name:e.target.value}))} placeholder="DOLIPRANE 1G..." style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:10}}>CIP</label>
                        <input value={promoProductForm.cip} onChange={e=>setPromoProductForm(f=>({...f,cip:e.target.value}))} placeholder="3400930..." style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
                      <div>
                        <label style={{...LS,fontSize:10}}>Prix brut (€)</label>
                        <input type="number" step="0.01" value={promoProductForm.pv} onChange={e=>setPromoProductForm(f=>({...f,pv:e.target.value}))} style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:10}}>Remise</label>
                        <input value={promoProductForm.pct} onChange={e=>setPromoProductForm(f=>({...f,pct:e.target.value}))} placeholder="-20%" style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:10,color:"#059669"}}>Prix net (€) ★</label>
                        <input type="number" step="0.01" value={promoProductForm.pn} onChange={e=>setPromoProductForm(f=>({...f,pn:e.target.value}))} style={{...IS,fontSize:12,padding:"6px 10px",borderColor:"#86efac",color:"#059669",fontWeight:700}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:10}}>Note</label>
                        <input value={promoProductForm.note} onChange={e=>setPromoProductForm(f=>({...f,note:e.target.value}))} placeholder="Stock limité" style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>addProductToPromo(ps.id)} style={{...PB,flex:1,padding:"8px",fontSize:12}}>➕ Ajouter</button>
                      <button onClick={()=>setAddingProductToPromo(null)} style={{background:"#e5e7eb",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:700,color:"#374151"}}>Annuler</button>
                    </div>
                  </div>
                )}

                {/* Products list */}
                {(ps.products||[]).length>0&&(
                  <div style={{padding:"8px 16px 12px"}}>
                    {ps.products.map(prod=>(
                      <div key={prod.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f5f5f5"}}>
                        <div>
                          <span style={{fontWeight:600,fontSize:12,color:"#0f2d3d"}}>{prod.name}</span>
                          {prod.cip&&<span style={{fontFamily:"monospace",fontSize:10,color:"#aaa",marginLeft:8}}>{prod.cip}</span>}
                          {prod.note&&<span style={{fontSize:10,color:"#e07b39",marginLeft:6,background:"#fef3ec",borderRadius:4,padding:"1px 5px"}}>{prod.note}</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:12,fontWeight:700,color:"#059669"}}>{prod.pn?.toFixed(2)} €</span>
                          {prod.pct&&<span style={{fontSize:11,color:"#7c3aed"}}>{prod.pct}</span>}
                          <button onClick={()=>removeProductFromPromo(ps.id,prod.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#f87171",fontSize:14,padding:"0 2px"}}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(ps.products||[]).length===0&&<div style={{padding:"12px 16px",fontSize:12,color:"#aaa",fontStyle:"italic"}}>Aucun produit dans cette section.</div>}
              </div>
            ))}
          </>
        )}

        {/* ── ORDERS TAB ── */}
        {tab==="orders"&&(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:12,color:"#666"}}>
                <span style={{fontWeight:700,color:"#0f2d3d"}}>{orders.filter(o=>!o.processed).length}</span> en attente · <span style={{color:"#888"}}>{orders.filter(o=>o.processed).length} traitée(s)</span>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={syncAllPending} disabled={orders.filter(o=>!o.processed).length===0} style={{background:"#0f2d3d",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"white",opacity:orders.filter(o=>!o.processed).length===0?0.4:1}}>
                  🔁 Sync toutes ({orders.filter(o=>!o.processed).length})
                </button>
                <button onClick={refreshOrders} style={{background:"#f0f2f5",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"#555"}}>🔄 Actualiser</button>
              </div>
            </div>
            {orders.length===0&&(
              <div style={{textAlign:"center",padding:"40px 20px",color:"#aaa",fontSize:13}}>
                Aucune commande reçue pour le moment.
              </div>
            )}
            {orders.map(o=>(
              <div key={o.id} style={{
                borderRadius:12,marginBottom:10,overflow:"hidden",
                border: o.processed?"1px solid #e5e7eb":"2px solid #3b82f6",
                background: o.processed?"#fafbfc":"#eff6ff",
              }}>
                <div style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontWeight:800,fontSize:14,color:"#0f2d3d"}}>{o.pharmacyName}</span>
                        {o.processed
                          ? <span style={{background:"#dcfce7",color:"#166534",fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:10}}>✓ TRAITÉE</span>
                          : <span style={{background:"#dbeafe",color:"#1e40af",fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:10}}>EN ATTENTE</span>
                        }
                      </div>
                      <div style={{fontSize:11,color:"#666",marginTop:3}}>
                        {o.pharmacyEmail} · {new Date(o.date).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
                      </div>
                      <div style={{fontSize:11,color:"#888",marginTop:2}}>
                        {o.nbLignes} référence(s) · Total : <strong>{o.totalHt?.toFixed(2)} €</strong>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      {/* Sync button + status */}
                      {syncStatus[o.id]==="pending" && <span style={{fontSize:11,color:"#2563eb",fontWeight:700,padding:"6px 4px"}}>⏳ Sync…</span>}
                      {syncStatus[o.id]==="ok" && <span style={{fontSize:11,color:"#059669",fontWeight:700,padding:"6px 4px"}}>✓ Envoyée</span>}
                      {syncStatus[o.id] && syncStatus[o.id]!=="pending" && syncStatus[o.id]!=="ok" && (
                        <span title={syncStatus[o.id]} style={{fontSize:11,color:"#dc2626",fontWeight:700,padding:"6px 4px",cursor:"help"}}>⚠️ Erreur</span>
                      )}
                      {!o.processed && syncStatus[o.id]!=="pending" && (
                        <button onClick={()=>syncOrder(o)} style={{background:"#2563eb",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:"white",fontWeight:700}}>
                          🔁 Sync
                        </button>
                      )}
                      <button onClick={()=>downloadCsv(o)} title="Télécharger CSV" style={{background:"#0f2d3d",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:"white",fontWeight:700}}>⬇ CSV</button>
                      <button onClick={()=>toggleProcessed(o.id)} style={{
                        background:o.processed?"#f3f4f6":"#dcfce7",border:"none",borderRadius:8,
                        padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:700,
                        color:o.processed?"#6b7280":"#166534"
                      }}>{o.processed?"↩ Rouvrir":"✓ Traiter"}</button>
                      <button onClick={()=>{ if(window.confirm("Supprimer cette commande ?")) deleteOrder(o.id); }} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:13,color:"#b91c1c"}}>🗑</button>
                    </div>
                  </div>
                  {/* Items preview */}
                  <div style={{marginTop:10,background:"white",borderRadius:8,padding:"8px 10px",fontSize:11,color:"#555",maxHeight:140,overflowY:"auto"}}>
                    <div style={{display:"flex",padding:"0 0 5px 0",borderBottom:"2px solid #e5e7eb",marginBottom:4,fontWeight:800,fontSize:10,color:"#999",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                      <span style={{fontFamily:"monospace",width:110,flexShrink:0}}>CIP13</span>
                      <span style={{flex:1}}>Désignation</span>
                      <span style={{width:30,textAlign:"right"}}>Qté</span>
                      <span style={{width:55,textAlign:"right",marginLeft:10}}>PU HT</span>
                      <span style={{width:60,textAlign:"right",marginLeft:10}}>Total HT</span>
                    </div>
                    {o.items?.map((item,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",padding:"3px 0",borderBottom:i<o.items.length-1?"1px solid #f5f5f5":"none"}}>
                        <span style={{fontFamily:"monospace",color:"#888",width:110,flexShrink:0}}>{item.cip||"—"}</span>
                        <span style={{flex:1,paddingRight:8}}>{item.name}</span>
                        <span style={{fontWeight:700,width:30,textAlign:"right"}}>{item.qty}</span>
                        <span style={{color:"#555",width:55,textAlign:"right",marginLeft:10}}>{item.pn!=null?item.pn.toFixed(2)+" €":"—"}</span>
                        <span style={{fontWeight:700,color:"#0f2d3d",width:60,textAlign:"right",marginLeft:10}}>{item.total!=null?item.total.toFixed(2)+" €":"—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── EDIT TAB ── */}
        {tab==="edit"&&(
          <>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="🔍 Rechercher par nom ou CIP..." style={{...IS,flex:2}}/>
              <select value={filterSection} onChange={e=>setFilterSection(e.target.value)} style={{...IS,flex:1}}>
                <option value="all">Toutes sections</option>
                {SECTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{fontSize:11,color:"#999",marginBottom:12}}>
              {filtered.length} produit(s) dans Supabase
              {false&&(
                <button onClick={()=>{
                  if(!window.confirm("Réinitialiser TOUTES les modifications ?")) return;
                  flash("↩️ Les modifications sont dans Supabase — utilisez l'onglet Modifier pour réinitialiser.");
                }} style={{marginLeft:12,background:"#fee2e2",border:"none",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#b91c1c",fontWeight:700}}>
                  Tout réinitialiser
                </button>
              )}
            </div>

            {filtered.slice(0,80).map(p=>{
              const ov={};
              const isEditing=editingKey===p._key;
              const hasOv=!!ov;
              return (
                <div key={p._key} style={{
                  borderRadius:12,marginBottom:8,
                  border:hasOv?"2px solid #fbbf24":"1px solid #e8eaed",
                  background:hasOv?"#fffbeb":"#fafbfc",overflow:"hidden"
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {hasOv&&<span style={{background:"#fbbf24",color:"#78350f",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:4}}>MODIFIÉ</span>}
                        <span style={{wordBreak:"break-word"}}>{p.name}</span>
                      </div>
                      <div style={{fontSize:11,color:"#888",marginTop:2}}>
                        {p._sectionLabel}{p.cip?` · ${p.cip}`:""}
                        {" · "}
                        <span style={{color:hasOv?"#d97706":"#555",fontWeight:600}}>
                          {fmt(ov?.pn??p.pn)} net
                          {(ov?.palier??p.palier??p.colis)?` · ×${ov?.palier??p.palier??p.colis}`:""}
                        </span>
                        {hasOv&&<span style={{color:"#9ca3af",marginLeft:4}}>(orig: {fmt(p.pn)})</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6,marginLeft:10,flexShrink:0}}>
                      {hasOv&&(
                        <button onClick={()=>clearEdit(p._key)} title="Réinitialiser" style={{background:"#fef3c7",border:"none",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,color:"#92400e",fontWeight:700}}>↩</button>
                      )}
                      <button onClick={()=>isEditing?setEditingKey(null):startEdit(p)} style={{
                        background:isEditing?"#e5e7eb":"#0f2d3d",border:"none",borderRadius:8,
                        padding:"5px 12px",cursor:"pointer",fontSize:12,
                        color:isEditing?"#374151":"white",fontWeight:700
                      }}>{isEditing?"Annuler":"✏️ Modifier"}</button>
                    </div>
                  </div>

                  {isEditing&&(
                    <div style={{background:"white",borderTop:"1px solid #e8eaed",padding:"14px 14px 16px"}}>
                      <div style={{marginBottom:10}}>
                        <label style={{...LS,fontSize:10}}>Code CIP / Référence</label>
                        <input value={editForm.cip} onChange={e=>setEditForm(f=>({...f,cip:e.target.value}))}
                          placeholder="3400930000000" style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>
                        {[
                          {key:"pv",  label:"Prix brut (€)"},
                          {key:"pct", label:"Remise (%)"},
                          {key:"pn",  label:"Prix net (€) ★", green:true},
                          {key:"palier",label:"Palier / Colis"},
                        ].map(({key,label,green})=>(
                          <div key={key}>
                            <label style={{...LS,fontSize:10,color:green?"#059669":undefined}}>{label}</label>
                            <input type="number" step="0.01" value={editForm[key]}
                              onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))}
                              style={{...IS,fontSize:12,padding:"7px 10px",
                                borderColor:green?"#86efac":"#e2e8f0",
                                fontWeight:green?700:400,color:green?"#059669":"inherit"}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{marginBottom:12}}>
                        <label style={{...LS,fontSize:10}}>Note</label>
                        <input value={editForm.note} onChange={e=>setEditForm(f=>({...f,note:e.target.value}))}
                          placeholder="Stock limité, Promo..." style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                      </div>
                      <button onClick={()=>saveEdit(p)} style={{...PB,padding:"9px",fontSize:13}}>
                        💾 Enregistrer les modifications
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length>80&&<div style={{textAlign:"center",fontSize:12,color:"#999",padding:10}}>Affichage limité à 80 résultats – affinez la recherche.</div>}
            {filtered.length===0&&search&&<div style={{textAlign:"center",fontSize:13,color:"#999",padding:24}}>Aucun produit trouvé pour « {search} »</div>}
          </>
        )}
      </div>
    </div>
  );
}

const OV={position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16,backdropFilter:"blur(4px)"};
const MO={background:"white",borderRadius:20,padding:"36px 40px",maxWidth:480,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.3)",fontFamily:"'DM Sans','Segoe UI',sans-serif"};
const CB={background:"#f0f2f5",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"};
const LS={fontSize:12,fontWeight:700,color:"#444",display:"block",marginBottom:6};
const IS={width:"100%",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
const PB={width:"100%",background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)",color:"white",border:"none",borderRadius:12,padding:"13px",fontWeight:800,fontSize:14,cursor:"pointer"};
