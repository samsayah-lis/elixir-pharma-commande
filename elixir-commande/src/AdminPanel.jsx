import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

// ── Copy CIP button ──────────────────────────────────────────────────────────
function CipCopy({ cip }) {
  const [copied, setCopied] = useState(false);
  if (!cip) return <span style={{ fontFamily:"monospace", fontSize:11, color:"#888" }}>—</span>;
  const copy = () => { navigator.clipboard.writeText(cip).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"monospace", fontSize:11, color:"#888" }}>{cip}</span>
      <button onClick={copy} title="Copier CIP" style={{
        background: copied ? "#dcfce7" : "#f0f2f5", border:"none", borderRadius:4,
        padding:"1px 5px", cursor:"pointer", fontSize:9, color: copied ? "#166534" : "#999",
        fontWeight:700, lineHeight:"14px", transition:"all 0.2s"
      }}>{copied ? "✓" : "⎘"}</button>
    </span>
  );
}


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
  { key: "ulabs",     label: "🤝 Commande groupée U-Labs" },
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
  const [promoForm, setPromoForm] = useState({ name:"", description:"", icon:"🏷️", color:"#7c3aed", accentColor:"#a855f7", endDate:"", withPhotos:false });
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
  const [uploadingImg, setUploadingImg] = useState(null); // cip en cours d'upload
  const [uploadedImgs, setUploadedImgs] = useState({}); // cip → url (preview local)
  // Commandes groupées
  const [groupCampaigns, setGroupCampaigns] = useState([]);
  const [gcLoading, setGcLoading] = useState(false);
  const [gcForm, setGcForm] = useState({
    fournisseur: "", label: "", subtitle: "", color: "#0d4f3c", accent: "#059669",
    icon: "🤝", palier: 500, deadline: "", restricted_email: "",
    mandatory_cips: "", free_units_cips: "", free_units_ratio: "6+2"
  });
  const [gcOrders, setGcOrders] = useState([]);
  const [gcOrdersLoading, setGcOrdersLoading] = useState(false);

  // ── Campagnes ─────────────────────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState([]);
  const [campLoading, setCampLoading] = useState(false);
  const [campEditing, setCampEditing] = useState(null); // null = liste, {...} = formulaire
  const [campSaving, setCampSaving] = useState(false);

  const EMPTY_CAMPAIGN = {
    id: "", label: "", subtitle: "", color: "#0d4f3c", accent: "#059669", icon: "🤝",
    restricted_to: [], deadline: "", palier_qty: 500, palier_remise: 33,
    min_refs: 12, conditions: [], groupes: [], active: true
  };

  const fetchCampaigns = async () => {
    setCampLoading(true);
    const r = await fetch("/.netlify/functions/campaign-get");
    const d = await r.json();
    setCampaigns(Array.isArray(d) ? d : []);
    setCampLoading(false);
  };

  const saveCampaign = async (camp) => {
    setCampSaving(true);
    const r = await fetch("/.netlify/functions/campaign-save", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(camp) });
    const d = await r.json();
    setCampSaving(false);
    if (d.error) { flash("❌ " + d.error); return; }
    flash("✅ Campagne sauvegardée");
    setCampEditing(null);
    fetchCampaigns();
  };

  const deleteCampaign = async (id) => {
    if (!confirm(`Supprimer la campagne "${id}" ?`)) return;
    await fetch(`/.netlify/functions/campaign-save?id=${id}`, { method: "DELETE" });
    flash("🗑️ Campagne supprimée");
    fetchCampaigns();
  };
  const [selectedCampaign, setSelectedCampaign] = useState("ulabs");

  const fetchGroupCampaignOrders = async (fournisseur) => {
    setGcOrdersLoading(true);
    try {
      const res = await fetch(`/.netlify/functions/group-order?fournisseur=${fournisseur}`);
      const rows = await res.json();
      setGcOrders(Array.isArray(rows) ? rows : []);
    } catch(e) { console.error(e); }
    setGcOrdersLoading(false);
  };
  const [medipimLookup, setMedipimLookup] = useState({}); // cip → {loading, name, image_url, brand, error}

  const lookupMedipim = async (cip) => {
    if (!cip || cip.length < 7) return;
    setMedipimLookup(prev => ({ ...prev, [cip]: { loading: true } }));
    try {
      const res = await fetch(`/.netlify/functions/medipim-lookup?cip=${cip}`);
      const data = await res.json();
      if (data.error) {
        setMedipimLookup(prev => ({ ...prev, [cip]: { loading: false, error: data.error } }));
      } else {
        setMedipimLookup(prev => ({ ...prev, [cip]: { loading: false, ...data } }));
      }
    } catch(e) {
      setMedipimLookup(prev => ({ ...prev, [cip]: { loading: false, error: e.message } }));
    }
  };

  const GRID_SECTIONS = ["otc", "molnlycke", "obeso"];

  const handleImageUpload = async (cip, file) => {
    if (!file) return;
    setUploadingImg(cip);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result.split(",")[1];
        const mimeType = file.type;
        const res = await fetch("/.netlify/functions/product-upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cip, imageBase64: base64, mimeType }),
        });
        const json = await res.json();
        if (json.success) {
          setUploadedImgs(prev => ({ ...prev, [cip]: json.image_url }));
          flash("🖼️ Photo uploadée !");
          await fetchProducts();
        } else {
          alert("Erreur upload : " + json.error);
        }
        setUploadingImg(null);
      };
      reader.readAsDataURL(file);
    } catch(e) {
      alert("Erreur : " + e.message);
      setUploadingImg(null);
    }
  };
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
      // Upload image Medipim si disponible
      if (form._medipim_image && product.cip) {
        try {
          await fetch("/.netlify/functions/product-upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cip: product.cip, image_url: form._medipim_image }),
          });
          await fetchProducts();
        } catch(imgErr) { console.warn("Image Medipim non importée:", imgErr.message); }
      }
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
    const pv  = parseFloat(p.pv) || 0;
    const pct = parseFloat(typeof p.pct === "string" ? p.pct.replace(/[-% ]/g,"") : (p.pct ?? "")) || 0;
    const remise_eur = pv && pct ? (pv * pct / 100).toFixed(2) : "";
    setEditForm({
      cip:       String(p.cip  ?? ""),
      pv:        String(p.pv   ?? ""),
      pct:       String(pct || ""),
      remise_eur: String(p.remise_eur ?? remise_eur),
      pn:        String(p.pn   ?? ""),
      palier:    String(p.colis ?? ""),
      note:      String(p.note ?? ""),
      _lastEdited: "",
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
      remise_eur: parseFloat(editForm.remise_eur) || null,
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
    setPromoForm({ name:"", description:"", icon:"🏷️", color:"#7c3aed", accentColor:"#a855f7", endDate:"", withPhotos:false });
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
            pct: pct ?? null,
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
          {[{k:"add",label:"➕ Ajouter"},{k:"edit",label:"✏️ Modifier"},{k:"promos",label:`🎯 Promos${promos.length>0?" ("+promos.length+")":""}` },{k:"orders",label:`📋 Commandes${orders.filter(o=>!o.processed).length>0?" ("+orders.filter(o=>!o.processed).length+")":"" }` },{k:"grouporders",label:"🤝 Groupements"},{k:"campaigns",label:"🏗️ Campagnes"}].map(t=>(
            <button key={t.k} onClick={()=>{ setTab(t.k); if(t.k==="grouporders") fetchGroupCampaignOrders("ulabs"); }} style={{
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
                            <td style={{padding:"5px 8px"}}><CipCopy cip={r.cip||""}/></td>
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
                <input value={form.cip}
                  onChange={e=>handleField("cip",e.target.value)}
                  onBlur={e=>{ if(e.target.value.length>=7) lookupMedipim(e.target.value); }}
                  placeholder="3400930000000" style={IS}/>
                {form.cip && medipimLookup[form.cip] && (() => {
                  const m = medipimLookup[form.cip];
                  if (m.loading) return <div style={{fontSize:11,color:"#3b82f6",marginTop:4}}>🔍 Recherche Medipim...</div>;
                  if (m.error) return <div style={{fontSize:11,color:"#dc2626",marginTop:4}}>⚠️ Medipim : {m.error}</div>;
                  return (
                    <div style={{marginTop:8,padding:"10px 12px",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,display:"flex",gap:10,alignItems:"center"}}>
                      {m.image_url && <img src={m.image_url} alt="" style={{width:48,height:48,objectFit:"contain",borderRadius:6,background:"white",border:"1px solid #e2e8f0"}}/>}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#0369a1"}}>✅ Trouvé dans Medipim</div>
                        {m.brand && <div style={{fontSize:11,color:"#666"}}>{m.brand}</div>}
                        {m.name && <div style={{fontSize:12,fontWeight:600,color:"#1a2a3a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>}
                      </div>
                      <button onClick={()=>{
                        if(m.name && !form.name) setForm(f=>({...f, name: m.name}));
                        if(m.image_url) setForm(f=>({...f, _medipim_image: m.image_url}));
                      }} style={{fontSize:11,background:"#0ea5e9",color:"white",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>
                        ⬇️ Importer
                      </button>
                    </div>
                  );
                })()}
                {form._medipim_image && (
                  <div style={{marginTop:6,fontSize:11,color:"#059669"}}>📸 Photo Medipim prête à être enregistrée</div>
                )}
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
                      <div style={{fontSize:11,color:"#888",marginTop:2}}>{SECTIONS.find(s=>s.key===p.section)?.label} · {fmt(p.pn)}{p.palier?` · ×${p.palier}`:""}{p.cip && <> · <CipCopy cip={p.cip}/></>}</div>
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
              <div style={{marginBottom:12}}>
                <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
                  <input type="checkbox" checked={promoForm.withPhotos}
                    onChange={e=>setPromoForm(f=>({...f,withPhotos:e.target.checked}))}
                    style={{width:16,height:16,cursor:"pointer"}}/>
                  <span style={{fontSize:13,fontWeight:600,color:"#0f2d3d"}}>
                    🖼️ Affichage avec photos (présentation horizontale)
                  </span>
                </label>
                <div style={{fontSize:11,color:"#999",marginTop:3,marginLeft:26}}>
                  Les produits avec image_url seront affichés en mode visuel, les autres en tableau.
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
                          {prod.cip&&<span style={{marginLeft:8}}><CipCopy cip={prod.cip}/></span>}
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
                        <span style={{width:110,flexShrink:0}}><CipCopy cip={item.cip}/></span>
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
                        {p._sectionLabel}{p.cip && <> · <CipCopy cip={p.cip}/></>}
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
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:8}}>
                        {[
                          {key:"pv",  label:"Prix brut (€)"},
                          {key:"pct", label:"Remise (%)"},
                          {key:"remise_eur", label:"Remise (€)"},
                        ].map(({key,label})=>(
                          <div key={key}>
                            <label style={{...LS,fontSize:10}}>{label}</label>
                            <input type="number" step="0.01" value={editForm[key]||""}
                              onChange={e=>setEditForm(f=>({...f,[key]:e.target.value,_lastEdited:key==="remise_eur"?"eur":"pct"}))}
                              style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                        {[
                          {key:"pn",     label:"Prix net (€) ★", green:true},
                          {key:"palier", label:"Palier / Colis"},
                        ].map(({key,label,green})=>(
                          <div key={key}>
                            <label style={{...LS,fontSize:10,color:green?"#059669":undefined}}>{label}</label>
                            <input type="number" step="0.01" value={editForm[key]||""}
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
                      {GRID_SECTIONS.includes(p._section) && (
                        <div style={{marginBottom:12}}>
                          <label style={{...LS,fontSize:10}}>📸 Photo produit</label>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
                            {(uploadedImgs[p.cip] || p.image_url) && (
                              <img src={uploadedImgs[p.cip] || p.image_url} alt=""
                                style={{width:48,height:48,objectFit:"cover",borderRadius:6,border:"1px solid #e2e8f0"}}/>
                            )}
                            <label style={{
                              display:"inline-block",padding:"6px 12px",borderRadius:8,
                              background:"#f0f2f5",border:"1px solid #e2e8f0",cursor:"pointer",
                              fontSize:11,fontWeight:600,color:"#555"
                            }}>
                              {uploadingImg===p.cip ? "⏳ Upload..." : "📂 Choisir une photo"}
                              <input type="file" accept="image/*" style={{display:"none"}}
                                onChange={e=>handleImageUpload(p.cip, e.target.files[0])}
                                disabled={uploadingImg===p.cip}/>
                            </label>
                            {p.cip && medipimLookup[p.cip]?.image_url && (
                              <button onClick={async()=>{
                                setUploadingImg(p.cip);
                                try {
                                  const r=await fetch("/.netlify/functions/product-upload-image",{
                                    method:"POST",headers:{"Content-Type":"application/json"},
                                    body:JSON.stringify({cip:p.cip,image_url:medipimLookup[p.cip].image_url})
                                  });
                                  const j=await r.json();
                                  if(j.success){setUploadedImgs(prev=>({...prev,[p.cip]:j.image_url}));flash("🖼️ Photo Medipim importée !");await fetchProducts();}
                                  setUploadingImg(null);
                                }catch(e){alert(e.message);setUploadingImg(null);}
                              }} style={{fontSize:11,background:"#0ea5e9",color:"white",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:700}}>
                                🔄 Photo Medipim
                              </button>
                            )}
                            {p.cip && !medipimLookup[p.cip] && !p.image_url && (
                              <button onClick={()=>lookupMedipim(p.cip)} style={{fontSize:11,background:"#f0f2f5",border:"1px solid #e2e8f0",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:600,color:"#555"}}>
                                🔍 Chercher Medipim
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <button onClick={()=>saveEdit(p)} style={{...PB,padding:"9px",fontSize:13}}>
                        💾 Enregistrer les modifications
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length>80&&<div style={{textAlign:"center",fontSize:12,color:"#999",padding:10}}>Affichage limité à 80 résultats – affinez la recherche.</div>}
            {filtered.length>0&&(
              <div style={{textAlign:"center",padding:"10px 0 4px"}}>
                <button onClick={async()=>{
                  // Utilise allProducts (pas filtered qui est limité à 80 dans l'affichage)
                  const base = filterSection==="all" ? allProducts : allProducts.filter(p=>p._section===filterSection);
                  const toFetch = base.filter(p=>p.cip&&p.cip.length>=7&&!p.image_url);
                  if(toFetch.length===0){flash("Tous les produits filtrés ont déjà une photo (ou pas de CIP).");return;}
                  if(!window.confirm(`Importer les photos Medipim pour ${toFetch.length} produits (sans photo) ?`))return;
                  let ok=0,ko=0;
                  // Traitement par batches de 5 en parallèle
                  const BATCH = 5;
                  for(let i=0; i<toFetch.length; i+=BATCH){
                    const batch = toFetch.slice(i, i+BATCH);
                    await Promise.all(batch.map(async p => {
                      try{
                        const r=await fetch(`/.netlify/functions/medipim-lookup?cip=${p.cip}${p.cip7?`&cip7=${p.cip7}`:''}`);
                        const d=await r.json();
                        if(d.image_url){
                          const up=await fetch("/.netlify/functions/product-upload-image",{
                            method:"POST",headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({cip:p.cip,image_url:d.image_url})
                          });
                          const uj=await up.json();
                          if(uj.success) ok++; else ko++;
                        }else{ko++;}
                      }catch(e){console.warn(p.cip,e);ko++;}
                    }));
                    flash(`⏳ ${ok+ko}/${toFetch.length} traités...`);
                  }
                  await fetchProducts();
                  flash(`✅ ${ok} photos importées${ko>0?`, ${ko} non trouvées`:""}`)
                }} style={{fontSize:12,background:"#0ea5e9",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontWeight:700}}>
                  🔄 Importer photos Medipim pour les produits filtrés sans photo
                </button>
                {filterSection === "ulabs" && (
                  <div style={{marginTop:8,padding:"10px 14px",background:"#f0fdf4",borderRadius:8,border:"1px solid #86efac",fontSize:12,color:"#166534"}}>
                    💡 <strong>U-Labs :</strong> Le bouton ci-dessus importera les photos pour les {filtered.filter(p=>!p.image_url).length} produits U-Labs sans photo via Medipim.
                  </div>
                )}
              </div>
            )}
            {filtered.length===0&&search&&<div style={{textAlign:"center",fontSize:13,color:"#999",padding:24}}>Aucun produit trouvé pour « {search} »</div>}
          </>
        )}

        {/* ── GROUPEMENTS TAB ── */}
        {tab==="grouporders"&&(
          <div>
            {/* Sélecteur campagne */}
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:20,flexWrap:"wrap"}}>
              <div style={{fontWeight:700,fontSize:13,color:"#444"}}>Campagne :</div>
              <input value={selectedCampaign} onChange={e=>setSelectedCampaign(e.target.value)}
                placeholder="ex: ulabs"
                style={{...IS,width:140,display:"inline-block"}}/>
              <button onClick={()=>fetchGroupCampaignOrders(selectedCampaign)} style={{
                background:"#0f2d3d",color:"white",border:"none",borderRadius:8,
                padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13
              }}>🔄 Charger</button>
              {gcOrders.length>0&&(
                <button onClick={()=>{
                  const pharmacies = [...new Set(gcOrders.map(r=>r.pharmacy_cip))];
                  const header = "Pharmacie;CIP produit;Nom pharmacie;Quantité";
                  const rows = gcOrders.map(r=>`${r.pharmacy_cip};${r.cip};${r.pharmacy_name||""};${r.qty}`);
                  const csv = [header,...rows].join("\n");
                  const blob = new Blob([csv],{type:"text/csv"});
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `groupement_${selectedCampaign}_${new Date().toISOString().slice(0,10)}.csv`;
                  a.click();
                }} style={{background:"#059669",color:"white",border:"none",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                  ⬇️ Exporter CSV
                </button>
              )}
              {gcOrders.length>0&&(
                <button onClick={async()=>{
                  if(!confirm(`Vider toutes les commandes de la campagne "${selectedCampaign}" ?`)) return;
                  const pharmacies = [...new Set(gcOrders.map(r=>r.pharmacy_cip))];
                  for(const pc of pharmacies){
                    await fetch(`/.netlify/functions/group-order?fournisseur=${selectedCampaign}&pharmacy_cip=${pc}`,{method:"DELETE"});
                  }
                  fetchGroupCampaignOrders(selectedCampaign);
                }} style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                  🗑️ Vider la campagne
                </button>
              )}
            </div>

            {gcOrdersLoading&&<div style={{textAlign:"center",padding:24,color:"#888"}}>Chargement…</div>}

            {!gcOrdersLoading&&gcOrders.length>0&&(()=>{
              // Map CIP → nom produit depuis la liste produits chargée
              const cipToName = {};
              products.forEach(p => { cipToName[p.cip] = p.name; });
              // Agréger par pharmacie
              const byPharm = {};
              gcOrders.forEach(r=>{
                if(!byPharm[r.pharmacy_cip]) byPharm[r.pharmacy_cip]={name:r.pharmacy_name||r.pharmacy_cip,cip:r.pharmacy_cip,lines:[]};
                byPharm[r.pharmacy_cip].lines.push(r);
              });
              const pharmacies = Object.values(byPharm);
              const totalUnites = gcOrders.reduce((s,r)=>s+(parseInt(r.qty)||0),0);
              const totalPharm = pharmacies.length;

              return(
                <div>
                  {/* Résumé */}
                  <div style={{display:"flex",gap:16,marginBottom:20,flexWrap:"wrap"}}>
                    {[
                      {label:"Pharmacies",val:totalPharm,bg:"#eff6ff",color:"#1d4ed8"},
                      {label:"Unités commandées",val:totalUnites,bg:"#f0fdf4",color:"#166534"},
                      {label:"Références",val:new Set(gcOrders.map(r=>r.cip)).size,bg:"#fefce8",color:"#92400e"},
                    ].map(s=>(
                      <div key={s.label} style={{background:s.bg,borderRadius:12,padding:"12px 20px",flex:1,minWidth:120,textAlign:"center"}}>
                        <div style={{fontWeight:800,fontSize:24,color:s.color}}>{s.val}</div>
                        <div style={{fontSize:11,color:"#666"}}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Vue par pharmacie */}
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {pharmacies.map(ph=>(
                      <div key={ph.cip} style={{border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
                        <div style={{background:"#0f2d3d",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontWeight:700,color:"white",fontSize:14}}>{ph.name}</div>
                          <div style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>
                            {ph.lines.length} réf. · {ph.lines.reduce((s,r)=>s+(parseInt(r.qty)||0),0)} unités
                          </div>
                        </div>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <thead>
                            <tr style={{background:"#f8fafc"}}>
                              {["CIP","Quantité","Modifié le"].map(h=>(
                                <th key={h} style={{padding:"7px 12px",textAlign:"left",fontSize:11,color:"#666",fontWeight:700,borderBottom:"1px solid #e2e8f0"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ph.lines.sort((a,b)=>b.qty-a.qty).map(r=>(
                              <tr key={r.cip} style={{borderBottom:"1px solid #f0f2f5"}}>
                                <td style={{padding:"7px 12px",fontSize:12,color:"#222"}}>{cipToName[r.cip] || r.cip}</td>
                                <td style={{padding:"7px 12px",fontSize:13,fontWeight:700,color:"#0f2d3d"}}>{r.qty}</td>
                                <td style={{padding:"7px 12px",fontSize:11,color:"#999"}}>{r.updated_at?new Date(r.updated_at).toLocaleString("fr-FR"):"-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>

                  {/* Récap par produit */}
                  <div style={{marginTop:20}}>
                    <div style={{fontWeight:700,fontSize:14,color:"#0f2d3d",marginBottom:10}}>Récapitulatif par produit</div>
                    <table style={{width:"100%",borderCollapse:"collapse",background:"white",borderRadius:10,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,0.06)"}}>
                      <thead>
                        <tr style={{background:"#0f2d3d"}}>
                          {["CIP","Total unités","Nb pharmacies"].map(h=>(
                            <th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:11,color:"rgba(255,255,255,0.8)",fontWeight:700}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...new Set(gcOrders.map(r=>r.cip))].map(cip=>{
                          const lines = gcOrders.filter(r=>r.cip===cip);
                          const total = lines.reduce((s,r)=>s+(parseInt(r.qty)||0),0);
                          const nbP = new Set(lines.map(r=>r.pharmacy_cip)).size;
                          return(
                            <tr key={cip} style={{borderBottom:"1px solid #f0f2f5"}}>
                              <td style={{padding:"8px 14px",fontSize:12,color:"#222"}}>{cipToName[cip] || cip}</td>
                              <td style={{padding:"8px 14px",fontSize:11,fontFamily:"monospace",color:"#aaa"}}>{cip}</td>
                              <td style={{padding:"8px 14px",fontSize:14,fontWeight:800,color:"#059669"}}>{total}</td>
                              <td style={{padding:"8px 14px",fontSize:12,color:"#888"}}>{nbP}</td>
                            </tr>
                          );
                        }).sort((a,b)=>0)}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {!gcOrdersLoading&&gcOrders.length===0&&(
              <div style={{textAlign:"center",padding:40,color:"#aaa",fontSize:14}}>
                Aucune commande pour cette campagne. Cliquez sur "Charger" pour voir les données.
              </div>
            )}
          </div>
        )}
        {tab==="campaigns"&&(
          <div style={{padding:"0 4px"}}>
            {/* ── En-tête ── */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              {campEditing
                ? <button onClick={()=>setCampEditing(null)} style={{fontSize:13,background:"#f0f2f5",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:600}}>← Retour</button>
                : <span style={{fontWeight:800,fontSize:16,color:"#1a2a3a"}}>🏗️ Campagnes groupement</span>
              }
              {!campEditing&&(
                <div style={{display:"flex",gap:8}}>
                  <button onClick={fetchCampaigns} style={{fontSize:12,background:"#f0f2f5",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer"}}>🔄</button>
                  <button onClick={()=>setCampEditing({...EMPTY_CAMPAIGN})} style={{fontSize:12,background:"#059669",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontWeight:700}}>+ Nouvelle campagne</button>
                </div>
              )}
            </div>

            {/* ── Liste des campagnes ── */}
            {!campEditing&&(
              campLoading
                ? <div style={{textAlign:"center",padding:40,color:"#aaa"}}>Chargement…</div>
                : campaigns.length===0
                  ? <div style={{textAlign:"center",padding:40,color:"#aaa",fontSize:14}}>
                      Aucune campagne.{" "}
                      <span style={{color:"#059669",cursor:"pointer",fontWeight:700}} onClick={()=>setCampEditing({...EMPTY_CAMPAIGN})}>Créer la première →</span>
                    </div>
                  : campaigns.map(c=>(
                    <div key={c.id} style={{background:"white",border:"1.5px solid #e2e8f0",borderRadius:12,padding:"14px 18px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{c.icon} {c.label}</div>
                        <div style={{fontSize:11,color:"#aaa",marginTop:2}}>ID : {c.id} · {c.groupes?.length||0} groupes · {c.min_refs} réf. min · palier {c.palier_qty}u →−{c.palier_remise}%</div>
                        {c.restricted_to?.length>0&&<div style={{fontSize:11,color:"#0ea5e9"}}>🔒 {c.restricted_to.join(", ")}</div>}
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:11,background:c.active?"#d1fae5":"#fee2e2",color:c.active?"#065f46":"#dc2626",borderRadius:6,padding:"3px 9px",fontWeight:700}}>{c.active?"Actif":"Inactif"}</span>
                        <button onClick={()=>setCampEditing({...c, restricted_to: c.restricted_to||[], conditions: c.conditions||[], groupes: c.groupes||[]})} style={{fontSize:12,background:"#0ea5e9",color:"white",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontWeight:700}}>✏️ Éditer</button>
                        <button onClick={()=>deleteCampaign(c.id)} style={{fontSize:12,background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontWeight:700}}>🗑️</button>
                      </div>
                    </div>
                  ))
            )}

            {/* ── Formulaire campagne ── */}
            {campEditing&&(()=>{
              const upd = (key,val) => setCampEditing(p=>({...p,[key]:val}));
              const updGroupe = (gi,key,val) => setCampEditing(p=>{ const g=[...p.groupes]; g[gi]={...g[gi],[key]:val}; return {...p,groupes:g}; });
              const addGroupe = () => setCampEditing(p=>({...p, groupes:[...p.groupes, {key:"", label:"", color:"#1e3a5f", accent:"#3b82f6", desc:"", match_regex:"", gratuite_type:"aucune", gratuite_condition:""}]}));
              const removeGroupe = (gi) => setCampEditing(p=>({...p, groupes: p.groupes.filter((_,i)=>i!==gi)}));
              const updCond = (ci,key,val) => setCampEditing(p=>{ const c=[...p.conditions]; c[ci]={...c[ci],[key]:val}; return {...p,conditions:c}; });
              const addCond = () => setCampEditing(p=>({...p, conditions:[...p.conditions, {label:"", match_regex:"", count:1}]}));
              const removeCond = (ci) => setCampEditing(p=>({...p, conditions: p.conditions.filter((_,i)=>i!==ci)}));

              const inp = (label, key, type="text", placeholder="") => (
                <div style={{marginBottom:12}}>
                  <label style={LS}>{label}</label>
                  <input type={type} value={campEditing[key]||""} onChange={e=>upd(key, type==="number"?Number(e.target.value):e.target.value)} placeholder={placeholder} style={IS}/>
                </div>
              );

              return (
                <div>
                  <div style={{fontWeight:800,fontSize:15,marginBottom:16,color:"#1a2a3a"}}>
                    {campEditing.id ? `✏️ Éditer "${campEditing.id}"` : "✨ Nouvelle campagne"}
                  </div>

                  {/* ── Infos générales ── */}
                  <div style={{background:"#f8fafc",borderRadius:12,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#555",marginBottom:10}}>📋 Informations générales</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div>
                        <label style={LS}>Identifiant (ID unique, ex: ulabs)</label>
                        <input value={campEditing.id} onChange={e=>upd("id",e.target.value.toLowerCase().replace(/\s/g,""))} placeholder="ulabs" style={{...IS, fontFamily:"monospace"}} disabled={!!campaigns.find(c=>c.id===campEditing.id&&campEditing.id!=="")&&false}/>
                      </div>
                      <div>
                        <label style={LS}>Nom affiché</label>
                        <input value={campEditing.label} onChange={e=>upd("label",e.target.value)} placeholder="Commande groupée U-Labs" style={IS}/>
                      </div>
                    </div>
                    <div style={{marginTop:10}}>
                      <label style={LS}>Sous-titre</label>
                      <input value={campEditing.subtitle||""} onChange={e=>upd("subtitle",e.target.value)} placeholder="12 réf. min · Fluocaril · Parogencyl…" style={IS}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:10,marginTop:10}}>
                      <div>
                        <label style={LS}>Icône</label>
                        <input value={campEditing.icon} onChange={e=>upd("icon",e.target.value)} style={IS}/>
                      </div>
                      <div>
                        <label style={LS}>Couleur principale</label>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="color" value={campEditing.color} onChange={e=>upd("color",e.target.value)} style={{width:40,height:36,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={campEditing.color} onChange={e=>upd("color",e.target.value)} style={{...IS,flex:1}}/></div>
                      </div>
                      <div>
                        <label style={LS}>Couleur accent</label>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="color" value={campEditing.accent} onChange={e=>upd("accent",e.target.value)} style={{width:40,height:36,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={campEditing.accent} onChange={e=>upd("accent",e.target.value)} style={{...IS,flex:1}}/></div>
                      </div>
                    </div>
                  </div>

                  {/* ── Accès & Date ── */}
                  <div style={{background:"#f8fafc",borderRadius:12,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#555",marginBottom:10}}>🔒 Accès & Planning</div>
                    <div>
                      <label style={LS}>Emails autorisés (un par ligne — vide = tout le monde)</label>
                      <textarea
                        value={(campEditing.restricted_to||[]).join("\n")}
                        onChange={e=>upd("restricted_to", e.target.value.split("\n").map(s=>s.trim()).filter(Boolean))}
                        placeholder={"pharmacie@example.com\nautrepharmacie@example.com"}
                        rows={3} style={{...IS,resize:"vertical",fontFamily:"monospace",fontSize:12}}
                      />
                    </div>
                    <div style={{marginTop:10}}>
                      <label style={LS}>Date limite (deadline)</label>
                      <input type="datetime-local" value={campEditing.deadline ? campEditing.deadline.slice(0,16) : ""} onChange={e=>upd("deadline",e.target.value)} style={IS}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10}}>
                      <input type="checkbox" id="camp-active" checked={campEditing.active} onChange={e=>upd("active",e.target.checked)} style={{width:16,height:16}}/>
                      <label htmlFor="camp-active" style={{fontSize:13,fontWeight:600}}>Campagne active (visible pour les pharmacies autorisées)</label>
                    </div>
                  </div>

                  {/* ── Objectif palier ── */}
                  <div style={{background:"#f8fafc",borderRadius:12,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#555",marginBottom:10}}>🎯 Objectif & Remise</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      <div>
                        <label style={LS}>Palier (nb unités)</label>
                        <input type="number" value={campEditing.palier_qty} onChange={e=>upd("palier_qty",Number(e.target.value))} style={IS}/>
                      </div>
                      <div>
                        <label style={LS}>Remise palier (%)</label>
                        <input type="number" value={campEditing.palier_remise} onChange={e=>upd("palier_remise",Number(e.target.value))} style={IS}/>
                      </div>
                      <div>
                        <label style={LS}>Nb réf. minimum</label>
                        <input type="number" value={campEditing.min_refs} onChange={e=>upd("min_refs",Number(e.target.value))} style={IS}/>
                      </div>
                    </div>
                  </div>

                  {/* ── Conditions obligatoires ── */}
                  <div style={{background:"#fdf4ff",borderRadius:12,padding:16,marginBottom:16,border:"1px solid #e9d5ff"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#7e22ce"}}>⚠️ Conditions obligatoires</div>
                      <button onClick={addCond} style={{fontSize:12,background:"#7e22ce",color:"white",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontWeight:700}}>+ Ajouter</button>
                    </div>
                    <div style={{fontSize:11,color:"#9333ea",marginBottom:10}}>Ex : "3 dentifrices Parogencyl" → label="Parogencyl", regex="parogencyl.*dentifrice", count=3</div>
                    {(campEditing.conditions||[]).length===0&&<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:8}}>Aucune condition obligatoire</div>}
                    {(campEditing.conditions||[]).map((cond,ci)=>(
                      <div key={ci} style={{background:"white",borderRadius:8,padding:12,marginBottom:8,border:"1px solid #e9d5ff",display:"grid",gridTemplateColumns:"1fr 1fr 80px 32px",gap:8,alignItems:"end"}}>
                        <div>
                          <label style={LS}>Libellé (ex: Parogencyl)</label>
                          <input value={cond.label||""} onChange={e=>updCond(ci,"label",e.target.value)} placeholder="Parogencyl" style={IS}/>
                        </div>
                        <div>
                          <label style={LS}>Regex nom produit (insensible casse)</label>
                          <input value={cond.match_regex||""} onChange={e=>updCond(ci,"match_regex",e.target.value)} placeholder="parogencyl.*dentifrice" style={{...IS,fontFamily:"monospace",fontSize:11}}/>
                        </div>
                        <div>
                          <label style={LS}>Nb min</label>
                          <input type="number" min={1} value={cond.count||1} onChange={e=>updCond(ci,"count",Number(e.target.value))} style={IS}/>
                        </div>
                        <button onClick={()=>removeCond(ci)} style={{background:"#fee2e2",border:"none",borderRadius:8,cursor:"pointer",color:"#dc2626",fontWeight:800,fontSize:16,height:36}}>✕</button>
                      </div>
                    ))}
                  </div>

                  {/* ── Groupes produits ── */}
                  <div style={{background:"#f0fdf4",borderRadius:12,padding:16,marginBottom:16,border:"1px solid #86efac"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#065f46"}}>📦 Groupes de produits</div>
                      <button onClick={addGroupe} style={{fontSize:12,background:"#059669",color:"white",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontWeight:700}}>+ Ajouter un groupe</button>
                    </div>
                    <div style={{fontSize:11,color:"#059669",marginBottom:10}}>Les produits sont classés dans le premier groupe dont la regex correspond à leur nom. Ordre = priorité.</div>
                    {(campEditing.groupes||[]).length===0&&<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:8}}>Aucun groupe — les produits seront affichés sans regroupement</div>}
                    {(campEditing.groupes||[]).map((g,gi)=>(
                      <div key={gi} style={{background:"white",borderRadius:10,padding:14,marginBottom:10,border:"1.5px solid #86efac"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontWeight:700,fontSize:13,color:g.color||"#1a2a3a"}}>{g.icon||"📦"} {g.label||`Groupe ${gi+1}`}</div>
                          <div style={{display:"flex",gap:6}}>
                            {gi>0&&<button onClick={()=>{ const gs=[...campEditing.groupes]; [gs[gi-1],gs[gi]]=[gs[gi],gs[gi-1]]; setCampEditing(p=>({...p,groupes:gs})); }} style={{background:"#f0f2f5",border:"none",borderRadius:6,cursor:"pointer",padding:"4px 8px"}}>↑</button>}
                            {gi<campEditing.groupes.length-1&&<button onClick={()=>{ const gs=[...campEditing.groupes]; [gs[gi],gs[gi+1]]=[gs[gi+1],gs[gi]]; setCampEditing(p=>({...p,groupes:gs})); }} style={{background:"#f0f2f5",border:"none",borderRadius:6,cursor:"pointer",padding:"4px 8px"}}>↓</button>}
                            <button onClick={()=>removeGroupe(gi)} style={{background:"#fee2e2",border:"none",borderRadius:6,cursor:"pointer",color:"#dc2626",fontWeight:800,padding:"4px 8px"}}>✕</button>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <label style={LS}>Clé interne (ex: bdm)</label>
                            <input value={g.key||""} onChange={e=>updGroupe(gi,"key",e.target.value)} placeholder="bdm" style={{...IS,fontFamily:"monospace"}}/>
                          </div>
                          <div>
                            <label style={LS}>Libellé affiché</label>
                            <input value={g.label||""} onChange={e=>updGroupe(gi,"label",e.target.value)} placeholder="🧴 Bains de bouche" style={IS}/>
                          </div>
                        </div>
                        <div style={{marginBottom:8}}>
                          <label style={LS}>Description / condition affichée sous le groupe</label>
                          <input value={g.desc||""} onChange={e=>updGroupe(gi,"desc",e.target.value)} placeholder="🎁 6 achetées = 2 offertes" style={IS}/>
                        </div>
                        <div style={{marginBottom:8}}>
                          <label style={LS}>Regex de correspondance (nom produit, insensible casse)</label>
                          <input value={g.match_regex||""} onChange={e=>updGroupe(gi,"match_regex",e.target.value)} placeholder="bain de bouche" style={{...IS,fontFamily:"monospace",fontSize:11}}/>
                          <div style={{fontSize:10,color:"#aaa",marginTop:2}}>Ex : <code>fluocaril.*145</code> · <code>brosse</code> · <code>junior|kids</code></div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <label style={LS}>Couleur fond</label>
                            <div style={{display:"flex",gap:4}}><input type="color" value={g.color||"#1e3a5f"} onChange={e=>updGroupe(gi,"color",e.target.value)} style={{width:36,height:34,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={g.color||""} onChange={e=>updGroupe(gi,"color",e.target.value)} style={{...IS,flex:1}}/></div>
                          </div>
                          <div>
                            <label style={LS}>Couleur accent</label>
                            <div style={{display:"flex",gap:4}}><input type="color" value={g.accent||"#3b82f6"} onChange={e=>updGroupe(gi,"accent",e.target.value)} style={{width:36,height:34,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={g.accent||""} onChange={e=>updGroupe(gi,"accent",e.target.value)} style={{...IS,flex:1}}/></div>
                          </div>
                          <div>
                            <label style={LS}>Step (incrément + / −)</label>
                            <input type="number" min={1} value={g.step||1} onChange={e=>updGroupe(gi,"step",Number(e.target.value))} style={IS}/>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <label style={LS}>Qté min (1er clic sur + → saute ici)</label>
                            <input type="number" min={0} value={g.min_qty||""} onChange={e=>updGroupe(gi,"min_qty",e.target.value===""?0:Number(e.target.value))} placeholder="ex: 6" style={IS}/>
                            <div style={{fontSize:10,color:"#aaa",marginTop:2}}>0 = pas de minimum</div>
                          </div>
                          <div>
                            <label style={LS}>Multiple obligatoire (ex: 3 → 3, 6, 9…)</label>
                            <input type="number" min={1} value={g.multiple||""} onChange={e=>updGroupe(gi,"multiple",e.target.value===""?1:Number(e.target.value))} placeholder="ex: 3" style={IS}/>
                            <div style={{fontSize:10,color:"#aaa",marginTop:2}}>1 = libre</div>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          <div>
                            <label style={LS}>Gratuité</label>
                            <select value={g.gratuite_type||"aucune"} onChange={e=>updGroupe(gi,"gratuite_type",e.target.value)} style={IS}>
                              <option value="aucune">Aucune</option>
                              <option value="6+2">6 achetées → 2 offertes</option>
                              <option value="3+1">3 achetées → 1 offerte</option>
                            </select>
                          </div>
                          {(g.gratuite_type&&g.gratuite_type!=="aucune")&&(
                            <div>
                              <label style={LS}>Condition d'activation (regex groupe requis, ou vide)</label>
                              <input value={g.gratuite_condition||""} onChange={e=>updGroupe(gi,"gratuite_condition",e.target.value)} placeholder="vide = automatique" style={{...IS,fontSize:11,fontFamily:"monospace"}}/>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Bouton sauvegarder ── */}
                  <button onClick={()=>saveCampaign(campEditing)} disabled={campSaving||!campEditing.id||!campEditing.label} style={{...PB, opacity: (campSaving||!campEditing.id||!campEditing.label)?0.5:1}}>
                    {campSaving ? "⏳ Sauvegarde…" : "💾 Sauvegarder la campagne"}
                  </button>
                  {(!campEditing.id||!campEditing.label)&&<div style={{fontSize:11,color:"#dc2626",marginTop:6,textAlign:"center"}}>L'ID et le nom sont obligatoires</div>}
                </div>
              );
            })()}
          </div>
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
