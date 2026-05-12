import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import ShortExpiry from "./components/ShortExpiry";
import AdminSearchML from "./components/AdminSearchML";
import AdminOrderKPIs from "./components/AdminOrderKPIs";
import AdminDisplay from "./components/AdminDisplay";
import AdminCampaigns from "./components/AdminCampaigns";
import AdminEdit from "./components/AdminEdit";
import AdminAdd from "./components/AdminAdd";

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


// Admin password vérifié côté serveur (plus de secret dans le bundle JS)
const ADMIN_AUTH_ENDPOINT = "/.netlify/functions/admin-login";

// ── Helper UG campagne ───────────────────────────────────────────────────────
function calcUgAdmin(itemName, qty, campaign) {
  if (!campaign?.groupes?.length || qty < 1) return 0;
  for (const g of campaign.groupes) {
    try {
      if (g.match_regex && new RegExp(g.match_regex, "i").test(itemName)) {
        if (g.gratuite_type === "6+2" && qty >= 6) return Math.floor(qty/6)*2;
        if (g.gratuite_type === "3+1" && qty >= 3) return Math.floor(qty/3);
        return 0;
      }
    } catch(e) {}
  }
  return 0;
}

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
  const [authed, setAuthed]     = useState(() => !!localStorage.getItem("admin_token"));

  // Helper : fetch avec JWT Supabase + auto-refresh
  const adminFetch = useCallback(async (url, options = {}) => {
    const token = localStorage.getItem("admin_token") || "";
    const headers = { "Authorization": `Bearer ${token}`, ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = headers["Content-Type"] || "application/json";
    let res = await fetch(url, { ...options, headers });

    // Si 401/403, essayer de refresh le token via Netlify function
    if ((res.status === 401 || res.status === 403) && localStorage.getItem("admin_refresh_token")) {
      try {
        const refreshRes = await fetch("/.netlify/functions/admin-refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: localStorage.getItem("admin_refresh_token") }),
        });
        const refreshData = await refreshRes.json();
        if (refreshData.success && refreshData.token) {
          localStorage.setItem("admin_token", refreshData.token);
          if (refreshData.refresh_token) localStorage.setItem("admin_refresh_token", refreshData.refresh_token);
          headers["Authorization"] = `Bearer ${refreshData.token}`;
          res = await fetch(url, { ...options, headers });
        } else {
          localStorage.removeItem("admin_token");
          localStorage.removeItem("admin_refresh_token");
          setAuthed(false);
        }
      } catch {
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_refresh_token");
        setAuthed(false);
      }
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem("admin_token");
      setAuthed(false);
    }
    return res;
  }, []);
  const [pwd, setPwd]           = useState("");
  const [adminEmail, setAdminEmail] = useState("pharmacien@elixirpharma.fr");
  const [pwdError, setPwdError] = useState("");
  const [tab, setTab]           = useState(() => sessionStorage.getItem("admin_tab") || "sync");
  useEffect(() => { sessionStorage.setItem("admin_tab", tab); }, [tab]);
  const [saved, setSaved]       = useState("");

  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [promos, setPromos] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_promos") || "[]"); } catch { return []; }
  });

  // ── Display config (needed early for allSectionsList) ─────────────────
  const [displayConfig, setDisplayConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem("display_config") || "{}"); } catch { return {}; }
  });
  const customSections = displayConfig.customSections || [];
  const activePromos = promos.filter(p => p.active);
  const allSectionKeys = [
    ...Object.keys(sectionMeta),
    ...customSections.map(cs => cs.key),
    ...activePromos.map(p => `promo_${p.id}`),
  ];
  const allMeta = { ...sectionMeta };
  customSections.forEach(cs => {
    allMeta[cs.key] = { label: cs.label, subtitle: cs.subtitle || "", color: cs.color || "#333", accent: cs.accent || "#666", icon: cs.icon || "📁", columns: [], isCustom: true };
  });
  activePromos.forEach(p => {
    allMeta[`promo_${p.id}`] = { label: p.name, subtitle: p.description || "", color: p.color || "#7c3aed", accent: p.accentColor || "#a855f7", icon: p.icon || "🏷️", columns: [], isPromo: true };
  });
  const allSectionsList = [
    ...SECTIONS,
    ...customSections.map(cs => ({ key: cs.key, label: `${cs.icon || "📁"} ${cs.label}` })),
    ...activePromos.map(p => ({ key: `promo_${p.id}`, label: `${p.icon || "🏷️"} ${p.name}` })),
  ];
  const tabOrder = displayConfig.tabOrder || allSectionKeys;
  // Ajouter les clés manquantes (promos créées après, sections custom) en fin de liste
  const orderedKeys = [...tabOrder];
  allSectionKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });
  const hiddenTabs = new Set(displayConfig.hiddenTabs || []);
  const defaultTab = displayConfig.defaultTab || tabOrder.find(k => !hiddenTabs.has(k)) || "expert";

  const saveDisplayConfig = (newConfig) => {
    const merged = { ...displayConfig, ...newConfig };
    setDisplayConfig(merged);
    localStorage.setItem("display_config", JSON.stringify(merged));
    // Sync vers Supabase (fire-and-forget)
    adminFetch("/.netlify/functions/config-get", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "display_config", value: merged }),
    }).catch(() => {});
  };

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
  const [promoForm, setPromoForm] = useState({ name:"", description:"", icon:"🏷️", color:"#7c3aed", accentColor:"#a855f7", endDate:"", withPhotos:false });
  const [editingPromoId, setEditingPromoId] = useState(null);
  const [addingProductToPromo, setAddingProductToPromo] = useState(null); // promoId
  const [promoProductForm, setPromoProductForm] = useState({ name:"", cip:"", pv:"", pct:"", pn:"", note:"" });
  // Excel import
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

  const fetchCampaigns = async () => {
    const r = await adminFetch("/.netlify/functions/campaign-get");
    const d = await r.json();
    setCampaigns(Array.isArray(d) ? d : []);
  };

  // ── Pharmacies ────────────────────────────────────────────────────────────
  const [pharmSearch, setPharmSearch] = useState("");
  const [pharmResults, setPharmResults] = useState([]);
  const [pharmSearching, setPharmSearching] = useState(false);
  const [pharmSyncing, setPharmSyncing] = useState(false);
  const [pharmManual, setPharmManual] = useState({ email:"", name:"", cip:"", street:"", cp:"", ville:"", tel:"" });
  const [pharmSaving, setPharmSaving] = useState(false);

  const searchPharm = async (q) => {
    if (!q.trim()) return;
    setPharmSearching(true);
    const url = `${process.env.REACT_APP_SUPABASE_URL || ""}`; // will use netlify fn instead
    const r = await fetch(`/.netlify/functions/pharmacy-search?q=${encodeURIComponent(q.trim())}`);
    const d = await r.json();
    setPharmResults(Array.isArray(d) ? d : []);
    setPharmSearching(false);
  };

  const syncPharmacies = async () => {
    setPharmSyncing(true);
    flash("⏳ Synchronisation Odoo en cours…");
    const r = await adminFetch("/.netlify/functions/pharmacy-sync-now");
    const d = await r.json();
    setPharmSyncing(false);
    flash(d.inserted != null ? `✅ Sync terminée — ${d.inserted} pharmacies mises à jour` : "✅ Sync terminée");
  };

  const savePharmManual = async () => {
    if (!pharmManual.email || !pharmManual.name) { flash("❌ Email et nom obligatoires"); return; }
    setPharmSaving(true);
    const row = { ...pharmManual, email: pharmManual.email.trim().toLowerCase() };
    const r = await adminFetch("/.netlify/functions/pharmacy-upsert", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(row) });
    const d = await r.json();
    setPharmSaving(false);
    if (d.error) { flash("❌ " + d.error); return; }
    flash("✅ Pharmacie ajoutée/mise à jour");
    setPharmManual({ email:"", name:"", cip:"", street:"", cp:"", ville:"", tel:"" });
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


  const GRID_SECTIONS = ["otc", "molnlycke", "obeso"];

  const handleImageUpload = async (cip, file) => {
    if (!file) return;
    setUploadingImg(cip);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result.split(",")[1];
        const mimeType = file.type;
        const res = await adminFetch("/.netlify/functions/product-upload-image", {
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

  // ── Sync config locale → Supabase (pour que les clients voient la même chose) ──
  const syncConfigToSupabase = async () => {
    try {
      const dc = displayConfig;
      const pm = promos;
      await Promise.all([
        adminFetch("/.netlify/functions/config-get", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "display_config", value: dc }),
        }),
        adminFetch("/.netlify/functions/config-get", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "admin_promos", value: pm }),
        }),
      ]);
      console.log("[config] ✓ Config synchronisée vers Supabase");
    } catch (e) { console.warn("[config] Sync error:", e.message); }
  };

  const handleLogin = async () => {
    setPwdError("");
    try {
      const res = await fetch(ADMIN_AUTH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: pwd }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem("admin_token", data.token);
        if (data.refresh_token) localStorage.setItem("admin_refresh_token", data.refresh_token);
        setAuthed(true);
        refreshOrders();
        fetchProducts();
        syncConfigToSupabase();
      } else {
        setPwdError(data.error || "Identifiants incorrects");
      }
    } catch (e) {
      console.error("[admin-login]", e.message);
      setPwdError("Erreur réseau : " + e.message);
    }
  };

  const handleField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Recherche dans le catalogue Odoo (odoo_catalog Supabase) ──────────





  const handleDelete = async (cip) => {
    if (!window.confirm("Désactiver ce produit ?")) return;
    try {
      await adminFetch("/.netlify/functions/products-upsert", {
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
      _sectionLabel: allSectionsList.find(s=>s.key===p.section)?.label || p.section,
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
      const res = await adminFetch("/.netlify/functions/products-upsert", {
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
    // Remet les valeurs d'origine (re-sync depuis Supabase)
    flash("↩️ Fonctionnalité disponible via re-migration");
  };

  // ── PROMO helpers ──
  const savePromos = (updated) => {
    setPromos(updated);
    localStorage.setItem("admin_promos", JSON.stringify(updated));
    // Sync vers Supabase (fire-and-forget)
    adminFetch("/.netlify/functions/config-get", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "admin_promos", value: updated }),
    }).catch(() => {});
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


  // ── SYNC helpers ──
  const syncOrder = async (order) => {
    setSyncStatus(s => ({ ...s, [order.id]: "pending" }));

    // Si pas de CIP, essayer de le retrouver depuis Supabase (elixir_pharmacies)
    let cip = order.pharmacyCip;
    if ((!cip || cip === "0" || cip === 0) && order.pharmacyEmail) {
      try {
        const lookupRes = await fetch("/.netlify/functions/pharmacy-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: order.pharmacyEmail }),
        });
        const lookupJson = await lookupRes.json();
        if (lookupJson.found && lookupJson.pharmacy?.cip) {
          cip = lookupJson.pharmacy.cip;
          console.log(`[sync] CIP retrouvé pour ${order.pharmacyEmail}: ${cip}`);
          // Mettre à jour la commande en base
          adminFetch("/.netlify/functions/order-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: order.id, pharmacy_cip: cip }),
          });
        }
      } catch (e) { console.warn("[sync] CIP lookup error:", e.message); }
    }

    const payload = JSON.stringify({
      csvContent: order.csv,
      items: order.items,
      pharmacyName: order.pharmacyName,
      pharmacyEmail: order.pharmacyEmail,
      pharmacyCip: cip,
      orderId: order.id,
    });
    const endpoints = [
      { url: "http://localhost:3001", label: "agent local" },
      { url: "/.netlify/functions/submit-order", label: "Netlify" },
    ];
    let lastError = "";
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(15000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) {
          setSyncStatus(s => ({ ...s, [order.id]: "ok" }));
          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, processed: true } : o));
          adminFetch("/.netlify/functions/order-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: order.id, processed: true }),
          });
          return; // success
        }
        lastError = json.error || json.detail?.message || `HTTP ${res.status}`;
        console.warn(`[sync] ${ep.label} échoué:`, lastError);
      } catch (err) {
        lastError = err.message;
        console.warn(`[sync] ${ep.label} inaccessible:`, err.message);
      }
    }
    setSyncStatus(s => ({ ...s, [order.id]: lastError || "Erreur inconnue" }));
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
      const res = await adminFetch("/.netlify/functions/order-list");
      const json = await res.json();
      if (json.orders) setOrders(json.orders);
    } catch(e) { console.warn("[order-list] erreur:", e.message); }
    setOrdersLoading(false);
  };

  const exportOrdersXlsx = () => {
    if (orders.length === 0) return;
    // Sheet 1 : Résumé commandes
    const summary = orders.map(o => ({
      "Date": new Date(o.date).toLocaleDateString("fr-FR"),
      "Heure": new Date(o.date).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" }),
      "Pharmacie": o.pharmacyName,
      "Email": o.pharmacyEmail,
      "CIP": o.pharmacyCip || "",
      "Lignes": o.nbLignes || (Array.isArray(o.items) ? o.items.length : 0),
      "Total HT": parseFloat(o.totalHt) || 0,
      "Statut": o.processed ? "Traitée" : "En attente",
      "Source": o.source || "catalogue",
    }));
    // Sheet 2 : Détail lignes
    const lines = [];
    orders.forEach(o => {
      (Array.isArray(o.items) ? o.items : []).forEach(it => {
        lines.push({
          "Date": new Date(o.date).toLocaleDateString("fr-FR"),
          "Pharmacie": o.pharmacyName,
          "CIP Pharmacie": o.pharmacyCip || "",
          "CIP Produit": it.cip || "",
          "Produit": it.name || "",
          "Quantité": parseInt(it.qty) || 0,
          "Prix net HT": parseFloat(it.pn) || 0,
          "Total HT": Math.round((parseFloat(it.pn) || 0) * (parseInt(it.qty) || 0) * 100) / 100,
        });
      });
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Commandes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), "Détail lignes");
    XLSX.writeFile(wb, `commandes_elixir_${new Date().toISOString().slice(0,10)}.xlsx`);
    flash("✓ Export Excel téléchargé");
  };

  // Charger les données au montage si déjà authentifié
  useEffect(() => {
    if (authed) { fetchProducts(); refreshOrders(); syncConfigToSupabase(); }
  }, [authed]);

  // ── Notifications push : polling 30s + Notification API ──────────────
  const lastOrderCountRef = useRef(orders.length);
  const notifSoundRef = useRef(null);

  // Demander la permission au montage
  useEffect(() => {
    if (authed && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [authed]);

  // Polling toutes les 30s
  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(async () => {
      try {
        const res = await adminFetch("/.netlify/functions/order-list");
        const json = await res.json();
        if (!json.orders) return;
        const newOrders = json.orders.filter(o => !orders.some(existing => existing.id === o.id));
        if (newOrders.length > 0) {
          setOrders(json.orders);
          // Browser notification
          if ("Notification" in window && Notification.permission === "granted") {
            newOrders.forEach(o => {
              new Notification("🛒 Nouvelle commande Elixir", {
                body: `${o.pharmacyName} — ${parseFloat(o.totalHt || 0).toFixed(2)} € HT · ${o.nbLignes || "?"} ligne(s)`,
                icon: "/favicon.ico",
                tag: `order-${o.id}`,
              });
            });
          }
          // Sound
          try {
            if (!notifSoundRef.current) {
              notifSoundRef.current = new Audio("data:audio/wav;base64,UklGRl9vT19teleVBATUxJU1QAAAAGgABABwWBAAYFgQAAgAQAGRhdGE7b09v" +
                "AAAAAP//AQACAAMABAAFAAYAB//+//3//P/7//r/+f/4//f/+P/5//r/+//8//3//v8AAAEAAQACAAMABQAGAAYA");
            }
            notifSoundRef.current.play().catch(() => {});
          } catch {}
          // Flash
          flash(`🔔 ${newOrders.length} nouvelle(s) commande(s) !`);
        }
        lastOrderCountRef.current = json.orders.length;
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, [authed, orders, adminFetch]);

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
    await adminFetch("/.netlify/functions/order-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, processed: newVal })
    });
  };

  const deleteOrder = async (id) => {
    setOrders(orders.filter(o => o.id!==id));
    await adminFetch("/.netlify/functions/order-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "delete" })
    });
  };

  // ── Sync state (must be before any return) ────────────────────────────
  const [syncStock, setSyncStock] = useState({ running: false, progress: null });
  const [syncPrice, setSyncPrice] = useState({ running: false, progress: null });
  const [audit, setAudit]         = useState({ running: false, data: null, error: null });

  const setDefaultTab = (key) => {
    saveDisplayConfig({ defaultTab: key });
  };

  const handleAuditLocations = async () => {
    if (audit.running) return;
    setAudit({ running: true, data: null, error: null });
    try {
      const res = await adminFetch("/.netlify/functions/odoo-locations-audit");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAudit({ running: false, data, error: null });
    } catch (e) {
      setAudit({ running: false, data: null, error: e.message });
    }
  };

  const handleSyncStock = async () => {
    if (syncStock.running) return;
    setSyncStock({ running: true, progress: "Étape 1/3 : chargement des produits Odoo..." });
    try {
      // Step 1 : Products
      let offset = 0, totalProducts = 0;
      while (true) {
        const res = await adminFetch(`/.netlify/functions/odoo-stock-sync?step=products&offset=${offset}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        totalProducts += data.cip13_saved || 0;
        setSyncStock({ running: true, progress: `Étape 1/3 : ${totalProducts} produits chargés...` });
        if (data.done) break;
        offset = data.next_offset;
      }
      setSyncStock({ running: true, progress: `Étape 2/4 : préparation (emplacements, mappings)...` });

      // Step 2a : Stock prep (locations + mappings → kv_store)
      const prepRes = await adminFetch("/.netlify/functions/odoo-stock-sync?step=stock_prep");
      if (!prepRes.ok) throw new Error(`Stock prep HTTP ${prepRes.status}`);
      const prepData = await prepRes.json();
      if (prepData.error) throw new Error(prepData.error);
      setSyncStock({ running: true, progress: `Étape 3/4 : chargement des quants (${prepData.excluded_locations} emplacements exclus)...` });

      // Step 2b : Stock compute (quants → stock_map)
      const stockRes = await adminFetch("/.netlify/functions/odoo-stock-sync?step=stock");
      if (!stockRes.ok) throw new Error(`Stock HTTP ${stockRes.status}`);
      const stockData = await stockRes.json();
      if (stockData.error) throw new Error(stockData.error);
      setSyncStock({ running: true, progress: `Étape 4/4 : application du stock (${stockData.in_stock} en stock, ${stockData.quants_excluded || 0} quants exclus)...` });

      // Step 4 : Apply stock
      offset = 0;
      let totalUpdated = 0;
      while (true) {
        const res = await adminFetch(`/.netlify/functions/odoo-stock-sync?step=apply&offset=${offset}`);
        if (!res.ok) break;
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        totalUpdated += data.updated || 0;
        setSyncStock({ running: true, progress: `Étape 4/4 : ${offset + (data.updated || 0)} / ${data.total || "?"}...` });
        if (data.done) break;
        offset = data.next_offset;
      }

      setSyncStock({ running: false, progress: `✓ Terminé — ${totalProducts} produits, ${stockData.in_stock} en stock (${stockData.quants_excluded || 0} quants exclus de ${stockData.excluded_locations || 0} emplacements), ${totalUpdated} mises à jour` });
    } catch (e) { setSyncStock({ running: false, progress: "Erreur: " + e.message }); }
  };

  const handleSyncPrice = async () => {
    if (syncPrice.running) return;
    setSyncPrice({ running: true, progress: "Phase 0 : mise à jour des catégories produits..." });
    try {
      // Phase 0 : remplir odoo_tmpl_id + categ_id si manquants
      let fillRound = 0;
      while (fillRound < 200) { // max 200 batches = 40000 produits
        const fillRes = await adminFetch("/.netlify/functions/fill-tmpl-categ");
        if (!fillRes.ok) break;
        const fillData = await fillRes.json();
        if (fillData.done || fillData.remaining === 0) break;
        fillRound++;
        setSyncPrice({ running: true, progress: `Phase 0 : catégories... ${fillData.remaining} produits restants` });
      }

      // Phase 1 : charger les règles
      setSyncPrice({ running: true, progress: "Phase 1 : chargement des règles de prix Odoo..." });
      let offset = 0, totalRules = 0;
      while (true) {
        const res = await adminFetch(`/.netlify/functions/odoo-price-sync?step=load&offset=${offset}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        totalRules = data.total_rules || totalRules;
        setSyncPrice({ running: true, progress: `Phase 1 : ${totalRules} règles chargées...` });
        if (data.done) break;
        offset = data.next_offset;
      }

      // Phase 2 : appliquer
      setSyncPrice({ running: true, progress: `Phase 2 : application de ${totalRules} règles aux produits...` });
      offset = 0;
      let totalUpdated = 0, rulesInfo = "";
      while (true) {
        const res = await adminFetch(`/.netlify/functions/odoo-price-sync?step=apply&offset=${offset}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        totalUpdated += data.updated || 0;
        if (data.rules_by_product != null) rulesInfo = `${data.rules_by_product} produit + ${data.rules_by_template} template + ${data.rules_by_category} catégorie + ${data.rules_global} global`;
        setSyncPrice({ running: true, progress: `Phase 2 : ${offset + 200} / ${data.total || "?"}... ${totalUpdated} prix (${rulesInfo})` });
        if (data.done) break;
        offset = data.next_offset;
      }
      setSyncPrice({ running: false, progress: `✓ Terminé — ${totalUpdated} prix mis à jour (${rulesInfo})` });
    } catch (e) { setSyncPrice({ running: false, progress: "Erreur: " + e.message }); }
  };

  // LOGIN
  if (!authed) return (
    <div style={{position:"fixed",inset:0,background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <div style={{background:"white",borderRadius:20,padding:"40px 44px",maxWidth:420,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.12)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:28}}>
          <div>
            <div style={{fontWeight:800,fontSize:22,color:"#0f2d3d"}}>🔐 Espace Admin</div>
            <div style={{fontSize:12,color:"#aaa",marginTop:3}}>Elixir Pharma – Authentification Supabase</div>
          </div>
          <button onClick={onClose} style={CB}>✕</button>
        </div>
        <label style={LS}>Email</label>
        <input type="email" value={adminEmail} onChange={e=>setAdminEmail(e.target.value)}
          placeholder="pharmacien@elixirpharma.fr"
          style={{...IS, marginBottom:12}} autoFocus />
        <label style={LS}>Mot de passe</label>
        <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••"
          style={{...IS,borderColor:pwdError?"#f87171":"#e2e8f0"}} />
        {pwdError&&<div style={{color:"#ef4444",fontSize:12,marginTop:6}}>{pwdError}</div>}
        <button onClick={handleLogin} style={{...PB,marginTop:16}}>Accéder →</button>
      </div>
    </div>
  );

  const TABS = [
    {k:"add",      label:"➕ Ajouter",    icon:"➕"},
    {k:"edit",     label:"✏️ Modifier",   icon:"✏️"},
    {k:"promos",   label:"🎯 Promos",     icon:"🎯", badge: promos.length||null},
    {k:"orders",   label:"📋 Commandes",  icon:"📋", badge: orders.filter(o=>!o.processed).length||null},
    {k:"grouporders",label:"🤝 Groupements",icon:"🤝"},
    {k:"campaigns",label:"🏗️ Campagnes",  icon:"🏗️"},
    {k:"pharmacies",label:"🏥 Pharmacies",icon:"🏥"},
    {k:"expiry",    label:"⏰ Péremptions",icon:"⏰"},
    {k:"display",   label:"🎨 Affichage",  icon:"🎨"},
    {k:"sync",      label:"🔄 Synchronisation",icon:"🔄"},
    {k:"search_ml", label:"🧠 Recherches",icon:"🧠"},
  ];

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#f1f5f9",display:"flex",flexDirection:"column",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>

      {/* ── Top bar ── */}
      <div style={{background:"#0f2d3d",color:"white",padding:"0 24px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,boxShadow:"0 2px 8px rgba(0,0,0,0.25)"}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{fontWeight:800,fontSize:17,letterSpacing:"-0.3px"}}>⚙️ Administration Elixir Pharma</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",paddingLeft:16,borderLeft:"1px solid rgba(255,255,255,0.15)"}}>
            {products.filter(p=>p.source==="admin").length} ajoutés · {products.length} produits · {orders.length} commandes
          </div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.12)",border:"none",borderRadius:8,color:"white",padding:"6px 14px",fontWeight:700,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6}}>
          ← Retour au catalogue
        </button>
      </div>

      {/* ── Body : sidebar + content ── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* Sidebar */}
        <div style={{width:200,background:"white",borderRight:"1px solid #e2e8f0",display:"flex",flexDirection:"column",padding:"16px 0",flexShrink:0,overflowY:"auto"}}>
          {TABS.map(t=>(
            <button key={t.k} onClick={()=>{ setTab(t.k); if(t.k==="grouporders") fetchGroupCampaignOrders("ulabs"); if(t.k==="campaigns") fetchCampaigns(); }}
              style={{display:"flex",alignItems:"center",gap:10,padding:"11px 20px",border:"none",background:tab===t.k?"#f0f9ff":"transparent",color:tab===t.k?"#0f2d3d":"#555",fontWeight:tab===t.k?700:500,fontSize:13,cursor:"pointer",textAlign:"left",borderLeft:tab===t.k?"3px solid #0ea5e9":"3px solid transparent",position:"relative"}}>
              <span style={{fontSize:16}}>{t.icon}</span>
              <span style={{flex:1}}>{t.label.replace(/^[^\s]+\s/,"")}</span>
              {t.badge ? <span style={{background:"#ef4444",color:"white",borderRadius:99,fontSize:10,fontWeight:800,padding:"1px 6px",minWidth:18,textAlign:"center"}}>{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div style={{flex:1,overflowY:"auto",padding:"24px 32px"}}>



        {/* ── ADD TAB ── */}
        {tab==="add"&&(
          <AdminAdd allSectionsList={allSectionsList} adminFetch={adminFetch} flash={flash}
            fetchProducts={fetchProducts} products={products}
            medipimLookup={medipimLookup} setMedipimLookup={setMedipimLookup} />
        )}
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
            {orders.length > 0 && <AdminOrderKPIs orders={orders} />}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:12,color:"#666"}}>
                <span style={{fontWeight:700,color:"#0f2d3d"}}>{orders.filter(o=>!o.processed).length}</span> en attente · <span style={{color:"#888"}}>{orders.filter(o=>o.processed).length} traitée(s)</span>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={syncAllPending} disabled={orders.filter(o=>!o.processed).length===0} style={{background:"#0f2d3d",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"white",opacity:orders.filter(o=>!o.processed).length===0?0.4:1}}>
                  🔁 Sync toutes ({orders.filter(o=>!o.processed).length})
                </button>
                <button onClick={refreshOrders} style={{background:"#f0f2f5",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"#555"}}>🔄 Actualiser</button>
                <button onClick={exportOrdersXlsx} style={{background:"#059669",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"white"}}>📥 Export Excel</button>
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
                        <span title={syncStatus[o.id]} style={{fontSize:11,color:"#dc2626",fontWeight:700,padding:"6px 4px",cursor:"help",maxWidth:300,display:"inline-block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>⚠️ {syncStatus[o.id]}</span>
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
                    {(() => {
                      const campAdmin = campaigns.find(cp => cp.id === o.source);
                      const hasUG = campAdmin && o.items?.some(item => calcUgAdmin(item.name||'', item.qty||0, campAdmin) > 0);
                      return (<>
                        <div style={{display:"flex",padding:"0 0 5px 0",borderBottom:"2px solid #e5e7eb",marginBottom:4,fontWeight:800,fontSize:10,color:"#999",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                          <span style={{fontFamily:"monospace",width:110,flexShrink:0}}>CIP13</span>
                          <span style={{flex:1}}>Désignation</span>
                          <span style={{width:30,textAlign:"right"}}>Qté</span>
                          {hasUG && <span style={{width:36,textAlign:"right",marginLeft:6,color:"#059669"}}>UG</span>}
                          <span style={{width:55,textAlign:"right",marginLeft:10}}>PU HT</span>
                          <span style={{width:60,textAlign:"right",marginLeft:10}}>Total HT</span>
                        </div>
                        {o.items?.map((item,i)=>{
                          const ug = campAdmin ? calcUgAdmin(item.name||'', item.qty||0, campAdmin) : 0;
                          return (
                            <div key={i} style={{display:"flex",alignItems:"center",padding:"3px 0",borderBottom:i<o.items.length-1?"1px solid #f5f5f5":"none"}}>
                              <span style={{width:110,flexShrink:0}}><CipCopy cip={item.cip}/></span>
                              <span style={{flex:1,paddingRight:8}}>{item.name}</span>
                              <span style={{fontWeight:700,width:30,textAlign:"right"}}>{item.qty}</span>
                              {hasUG && <span style={{width:36,textAlign:"right",marginLeft:6,color:ug>0?"#059669":"#ddd",fontWeight:ug>0?800:400}}>{ug>0?`+${ug}`:"—"}</span>}
                              <span style={{color:"#555",width:55,textAlign:"right",marginLeft:10}}>{item.pn!=null?item.pn.toFixed(2)+" €":"—"}</span>
                              <span style={{fontWeight:700,color:"#0f2d3d",width:60,textAlign:"right",marginLeft:10}}>{item.total!=null?item.total.toFixed(2)+" €":"—"}</span>
                            </div>
                          );
                        })}
                        {hasUG && (
                          <div style={{marginTop:6,padding:"4px 6px",background:"#d1fae5",borderRadius:6,fontSize:10,color:"#065f46",fontWeight:700}}>
                            🎁 Total UG : {o.items.reduce((s,item)=>s+calcUgAdmin(item.name||'',item.qty||0,campAdmin),0)} unités offertes
                          </div>
                        )}
                      </>);
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── EDIT TAB ── */}
        {tab==="edit"&&(
          <AdminEdit
            products={products} search={search} setSearch={setSearch}
            filterSection={filterSection} setFilterSection={setFilterSection}
            editingKey={editingKey} setEditingKey={setEditingKey}
            editForm={editForm} setEditForm={setEditForm}
            uploadingImg={uploadingImg} setUploadingImg={setUploadingImg}
            uploadedImgs={uploadedImgs} setUploadedImgs={setUploadedImgs}
            medipimLookup={medipimLookup} setMedipimLookup={setMedipimLookup}
            adminFetch={adminFetch} flash={flash} fetchProducts={fetchProducts}
            allProducts={allProducts} sectionMeta={sectionMeta}
            allSectionsList={allSectionsList}
          />
        )}
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
          <AdminCampaigns campaigns={campaigns} setCampaigns={setCampaigns} adminFetch={adminFetch} flash={flash} />
        )}
        {tab==="pharmacies"&&(
          <div style={{padding:"0 4px"}}>
            {/* ── Sync Odoo ── */}
            <div style={{background:"#f0fdf4",borderRadius:12,padding:16,marginBottom:16,border:"1px solid #86efac",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:"#065f46"}}>🔄 Synchronisation depuis Odoo</div>
                <div style={{fontSize:11,color:"#059669",marginTop:2}}>Met à jour toutes les pharmacies depuis Odoo (partenaires actifs avec email)</div>
              </div>
              <button onClick={syncPharmacies} disabled={pharmSyncing} style={{background:"#059669",color:"white",border:"none",borderRadius:10,padding:"9px 18px",fontWeight:800,fontSize:13,cursor:"pointer",opacity:pharmSyncing?0.6:1}}>
                {pharmSyncing?"⏳ Sync…":"🔄 Lancer la sync"}
              </button>
            </div>

            {/* ── Recherche ── */}
            <div style={{background:"white",borderRadius:12,padding:16,marginBottom:16,border:"1.5px solid #e2e8f0"}}>
              <div style={{fontWeight:700,fontSize:14,color:"#1a2a3a",marginBottom:10}}>🔍 Rechercher une pharmacie</div>
              <div style={{display:"flex",gap:8}}>
                <input value={pharmSearch} onChange={e=>setPharmSearch(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&searchPharm(pharmSearch)}
                  placeholder="Email ou nom…" style={{...IS,flex:1}}/>
                <button onClick={()=>searchPharm(pharmSearch)} disabled={pharmSearching} style={{background:"#0ea5e9",color:"white",border:"none",borderRadius:10,padding:"9px 16px",fontWeight:700,cursor:"pointer"}}>
                  {pharmSearching?"…":"Chercher"}
                </button>
              </div>
              {pharmResults.length > 0 && (
                <div style={{marginTop:10}}>
                  {pharmResults.map((p,i)=>(
                    <div key={i} style={{padding:"8px 12px",borderBottom:"1px solid #f0f2f5",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13}}>{p.name}</div>
                        <div style={{fontSize:11,color:"#888"}}>{p.email} · CIP : {p.cip||"—"} · {p.ville||"—"}</div>
                      </div>
                      <button onClick={()=>setPharmManual({...p})} style={{fontSize:11,background:"#f0f2f5",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>✏️ Éditer</button>
                    </div>
                  ))}
                </div>
              )}
              {pharmResults.length === 0 && pharmSearch && !pharmSearching && (
                <div style={{marginTop:8,fontSize:12,color:"#dc2626"}}>Aucun résultat — ajoutez-la manuellement ci-dessous</div>
              )}
            </div>

            {/* ── Ajout / édition manuel ── */}
            <div style={{background:"white",borderRadius:12,padding:16,border:"1.5px solid #e2e8f0"}}>
              <div style={{fontWeight:700,fontSize:14,color:"#1a2a3a",marginBottom:12}}>➕ Ajouter / modifier manuellement</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <label style={LS}>Email *</label>
                  <input value={pharmManual.email} onChange={e=>setPharmManual(p=>({...p,email:e.target.value}))} placeholder="pharmacie@example.com" style={{...IS,fontFamily:"monospace"}}/>
                </div>
                <div>
                  <label style={LS}>Nom *</label>
                  <input value={pharmManual.name} onChange={e=>setPharmManual(p=>({...p,name:e.target.value}))} placeholder="Pharmacie du Centre" style={IS}/>
                </div>
                <div>
                  <label style={LS}>CIP7 (référence Odoo)</label>
                  <input value={pharmManual.cip} onChange={e=>setPharmManual(p=>({...p,cip:e.target.value}))} placeholder="2012345" style={{...IS,fontFamily:"monospace"}}/>
                </div>
                <div>
                  <label style={LS}>Téléphone</label>
                  <input value={pharmManual.tel} onChange={e=>setPharmManual(p=>({...p,tel:e.target.value}))} style={IS}/>
                </div>
                <div>
                  <label style={LS}>Adresse</label>
                  <input value={pharmManual.street} onChange={e=>setPharmManual(p=>({...p,street:e.target.value}))} style={IS}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"90px 1fr",gap:8}}>
                  <div>
                    <label style={LS}>CP</label>
                    <input value={pharmManual.cp} onChange={e=>setPharmManual(p=>({...p,cp:e.target.value}))} style={IS}/>
                  </div>
                  <div>
                    <label style={LS}>Ville</label>
                    <input value={pharmManual.ville} onChange={e=>setPharmManual(p=>({...p,ville:e.target.value}))} style={IS}/>
                  </div>
                </div>
              </div>
              <button onClick={savePharmManual} disabled={pharmSaving||!pharmManual.email||!pharmManual.name}
                style={{...PB,opacity:pharmSaving||!pharmManual.email||!pharmManual.name?0.5:1}}>
                {pharmSaving?"⏳ Sauvegarde…":"💾 Sauvegarder"}
              </button>
            </div>
          </div>
        )}

        {/* ── EXPIRY TAB ── */}
        {tab==="expiry"&&(
          <ShortExpiry isAdmin={true} onAddToCart={() => {}} />
        )}

        {/* ── DISPLAY TAB ── */}
        {tab==="display"&&(
          <AdminDisplay
            displayConfig={displayConfig} saveDisplayConfig={saveDisplayConfig}
            orderedKeys={orderedKeys} allMeta={allMeta} allSectionKeys={allSectionKeys}
            hiddenTabs={hiddenTabs} defaultTab={defaultTab}
            syncConfigToSupabase={syncConfigToSupabase} flash={flash} setTab={setTab}
          />
        )}

        {/* ── SYNC TAB ── */}
        {tab==="sync"&&(
          <div>
            <div style={{fontWeight:800,fontSize:18,color:"#0f2d3d",marginBottom:24}}>Synchronisation Odoo → Supabase</div>

            {/* Stock sync */}
            <div style={{background:"white",borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid #e8ecf0"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d"}}>🔄 Catalogue & Stock</div>
                  <div style={{fontSize:12,color:"#888",marginTop:4}}>Synchronise les produits et le stock depuis Odoo. Exclut les emplacements dont la case <strong>do_not_export</strong> est cochée dans Odoo (ou marqués comme scrap).</div>
                </div>
                <button onClick={handleSyncStock} disabled={syncStock.running}
                  style={{background:"linear-gradient(135deg, #0f2d3d, #1a4a5e)",color:"white",border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:syncStock.running?"default":"pointer",opacity:syncStock.running?0.6:1,whiteSpace:"nowrap"}}>
                  {syncStock.running?"⏳ En cours...":"Lancer le sync"}
                </button>
              </div>
              {syncStock.progress&&<div style={{marginTop:12,fontSize:12,color:syncStock.progress.startsWith("✓")?"#059669":"#888",fontWeight:600,background:"#f8fafc",borderRadius:8,padding:"8px 12px"}}>{syncStock.progress}</div>}
            </div>

            {/* Audit emplacements */}
            <div style={{background:"white",borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid #e8ecf0"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d"}}>🔍 Audit emplacements Odoo</div>
                  <div style={{fontSize:12,color:"#888",marginTop:4}}>Liste tous les emplacements internes (company 2) et vérifie ceux qui sont exclus du sync stock. Affiche le nombre de quants par emplacement.</div>
                </div>
                <button onClick={handleAuditLocations} disabled={audit.running}
                  style={{background:"linear-gradient(135deg, #475569, #334155)",color:"white",border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:audit.running?"default":"pointer",opacity:audit.running?0.6:1,whiteSpace:"nowrap"}}>
                  {audit.running?"⏳ Analyse...":"Lancer l'audit"}
                </button>
              </div>
              {audit.error&&<div style={{marginTop:12,fontSize:12,color:"#dc2626",fontWeight:600,background:"#fef2f2",borderRadius:8,padding:"8px 12px"}}>Erreur : {audit.error}</div>}
              {audit.data&&(
                <div style={{marginTop:16}}>
                  {/* Résumé */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:16}}>
                    <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 12px",border:"1px solid #e2e8f0"}}>
                      <div style={{fontSize:11,color:"#64748b",fontWeight:600}}>Total emplacements</div>
                      <div style={{fontSize:20,fontWeight:800,color:"#0f2d3d",marginTop:2}}>{audit.data.summary.total_locations}</div>
                    </div>
                    <div style={{background:"#fef2f2",borderRadius:8,padding:"10px 12px",border:"1px solid #fecaca"}}>
                      <div style={{fontSize:11,color:"#991b1b",fontWeight:600}}>Exclus</div>
                      <div style={{fontSize:20,fontWeight:800,color:"#dc2626",marginTop:2}}>{audit.data.summary.excluded}</div>
                      <div style={{fontSize:10,color:"#991b1b",marginTop:2}}>{audit.data.summary.total_quants_excluded} quants</div>
                    </div>
                    <div style={{background:"#ecfdf5",borderRadius:8,padding:"10px 12px",border:"1px solid #a7f3d0"}}>
                      <div style={{fontSize:11,color:"#065f46",fontWeight:600}}>Inclus dans le stock</div>
                      <div style={{fontSize:20,fontWeight:800,color:"#059669",marginTop:2}}>{audit.data.summary.included}</div>
                      <div style={{fontSize:10,color:"#065f46",marginTop:2}}>{audit.data.summary.total_quants_included} quants</div>
                    </div>
                    <div style={{background:"#fef3c7",borderRadius:8,padding:"10px 12px",border:"1px solid #fde68a"}}>
                      <div style={{fontSize:11,color:"#92400e",fontWeight:600}}>Détail exclusions</div>
                      <div style={{fontSize:12,color:"#92400e",marginTop:4,lineHeight:1.5}}>
                        do_not_export : {audit.data.summary.excluded_by_do_not_export}<br/>
                        scrap : {audit.data.summary.excluded_by_scrap}
                      </div>
                    </div>
                  </div>

                  {/* Règles appliquées */}
                  <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#475569",border:"1px solid #e2e8f0"}}>
                    <strong>Règle d'exclusion :</strong> un emplacement est exclu du sync stock si <code style={{background:"#fff",padding:"1px 5px",borderRadius:3,border:"1px solid #ddd"}}>do_not_export = true</code> OU <code style={{background:"#fff",padding:"1px 5px",borderRadius:3,border:"1px solid #ddd"}}>scrap_location = true</code>.<br/>
                    Pour modifier l'exclusion : ouvre la fiche emplacement dans Odoo et coche/décoche la case <strong>"Do not export"</strong>. Plus besoin de toucher au code.
                  </div>

                  {/* Tableau */}
                  <div style={{maxHeight:480,overflow:"auto",border:"1px solid #e8ecf0",borderRadius:8}}>
                    <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                      <thead style={{position:"sticky",top:0,background:"#0f2d3d",color:"white",zIndex:1}}>
                        <tr>
                          <th style={{padding:"8px 10px",textAlign:"left"}}>Statut</th>
                          <th style={{padding:"8px 10px",textAlign:"left"}}>Emplacement</th>
                          <th style={{padding:"8px 10px",textAlign:"center"}}>do_not_export</th>
                          <th style={{padding:"8px 10px",textAlign:"center"}}>scrap</th>
                          <th style={{padding:"8px 10px",textAlign:"right"}}>Quants</th>
                          <th style={{padding:"8px 10px",textAlign:"right"}}>Qté totale</th>
                          <th style={{padding:"8px 10px",textAlign:"right"}}>ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.data.locations.map(loc=>(
                          <tr key={loc.id} style={{background:loc.excluded?"#fef2f2":"white",borderBottom:"1px solid #f0f2f5"}}>
                            <td style={{padding:"6px 10px",fontWeight:700,color:loc.excluded?"#dc2626":"#059669",whiteSpace:"nowrap"}}>
                              {loc.excluded?"❌ Exclu":"✓ Inclus"}
                            </td>
                            <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:11}}>{loc.complete_name}</td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontSize:14}}>{loc.do_not_export?"☑":"☐"}</td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontSize:14}}>{loc.scrap_location?"☑":"☐"}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600}}>{loc.quants_count}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontSize:11}}>{loc.total_quantity}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:"#94a3b8"}}>{loc.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Price sync */}
            <div style={{background:"white",borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid #e8ecf0"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d"}}>💰 Prix remisés (Liste de prix EUR 2)</div>
                  <div style={{fontSize:12,color:"#888",marginTop:4}}>Synchronise les 7 376 règles de prix depuis Odoo. Nécessite un sync stock préalable. ~2 minutes.</div>
                </div>
                <button onClick={handleSyncPrice} disabled={syncPrice.running}
                  style={{background:"linear-gradient(135deg, #0f2d3d, #1a4a5e)",color:"white",border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:syncPrice.running?"default":"pointer",opacity:syncPrice.running?0.6:1,whiteSpace:"nowrap"}}>
                  {syncPrice.running?"⏳ En cours...":"Lancer le sync"}
                </button>
              </div>
              {syncPrice.progress&&<div style={{marginTop:12,fontSize:12,color:syncPrice.progress.startsWith("✓")?"#059669":"#888",fontWeight:600,background:"#f8fafc",borderRadius:8,padding:"8px 12px"}}>{syncPrice.progress}</div>}
            </div>

            {/* Expiry sync */}
            <div style={{background:"white",borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid #e8ecf0"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d"}}>⏰ Péremptions & Lots</div>
                  <div style={{fontSize:12,color:"#888",marginTop:4}}>Synchronise les dates de péremption et les lots pour chaque produit en stock. Le bouton se trouve dans l'onglet Péremptions.</div>
                </div>
                <button onClick={()=>setTab("expiry")}
                  style={{background:"#f0f2f5",color:"#0f2d3d",border:"1px solid #ddd",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                  Aller à Péremptions →
                </button>
              </div>
            </div>

            {/* Info */}
            <div style={{background:"#eff6ff",borderRadius:14,padding:"16px 20px",border:"1px solid #bfdbfe",fontSize:12,color:"#1e40af",lineHeight:1.6}}>
              <strong>Ordre recommandé :</strong> 1. Stock → 2. Prix → 3. Péremptions<br/>
              Le sync stock charge les produits et quantités. Le sync prix associe les remises de la liste de prix EUR 2. Le sync péremptions charge les lots et dates d'expiration pour les produits en stock.
            </div>
          </div>
        )}

        {/* ── SEARCH ML TAB ── */}
        {tab==="search_ml"&&(
          <AdminSearchML adminFetch={adminFetch} />
        )}

        </div>
      </div>
      {saved&&<div style={{position:"fixed",bottom:24,right:24,background:"#0f2d3d",color:"white",borderRadius:12,padding:"12px 20px",fontWeight:700,fontSize:13,boxShadow:"0 8px 24px rgba(0,0,0,0.2)",zIndex:2000}}>{saved}</div>}
    </div>
  );
}

const OV={position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16,backdropFilter:"blur(4px)"};
const MO={background:"white",borderRadius:20,padding:"36px 40px",maxWidth:480,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.3)",fontFamily:"'DM Sans','Segoe UI',sans-serif"};
const CB={background:"#f0f2f5",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"};
const LS={fontSize:12,fontWeight:700,color:"#444",display:"block",marginBottom:6};
const IS={width:"100%",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
const PB={width:"100%",background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)",color:"white",border:"none",borderRadius:12,padding:"13px",fontWeight:800,fontSize:14,cursor:"pointer"};
