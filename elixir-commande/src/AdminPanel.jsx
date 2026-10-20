import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import ShortExpiry from "./components/ShortExpiry";
import { PEREMPTIONS_ADMIN } from "./components/PeremptionsAdmin.jsx";
import { estPeremption, notePeremption, datePeremption } from "./peremption-panier.js";
import AdminSearchML from "./components/AdminSearchML";
import AdminOrderKPIs from "./components/AdminOrderKPIs";
import AdminDisplay from "./components/AdminDisplay";
import AdminCampaigns from "./components/AdminCampaigns";
import AdminEdit from "./components/AdminEdit";
import AdminAdd from "./components/AdminAdd";
import AdminGroupPurchases from "./components/AdminGroupPurchases";
import AdminRelais, { RelaisCommande } from "./components/AdminRelais.jsx";
import AdminLabJustif from "./components/AdminLabJustif";
import AdminSanofiPro from "./components/AdminSanofiPro";
import AdminAssistant from "./components/AdminAssistant.jsx";
import AdminAlertesRetour from "./components/AdminAlertesRetour.jsx";
import { envoisEnCours } from "./components/photo-manuelle.js";
import { T, R, tone, alpha, adm } from "./theme.js";
import { Icone, CroixElixir } from "./icons.jsx";

// ── Copy CIP button ──────────────────────────────────────────────────────────
function CipCopy({ cip }) {
  const [copied, setCopied] = useState(false);
  if (!cip) return <span style={{ fontFamily:"monospace", fontSize:11, color:T.inkMute }}>—</span>;
  const copy = () => { navigator.clipboard.writeText(cip).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"monospace", fontSize:11, color:T.inkMute }}>{cip}</span>
      <button onClick={copy} title="Copier CIP" style={{
        background: copied ? T.okBg : T.surface2, border:"none", borderRadius:4,
        padding:"1px 5px", cursor:"pointer", fontSize:11, color: copied ? T.ok : T.inkMute,
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

// Ligne de commande réglée : envoyée à PharmaML (synced_at) ou traitée sans envoi (handled_at :
// saisie à la main dans Odoo, annulée, livrée autrement…)
const lineDone = (it) => !!(it?.synced_at || it?.handled_at);
// JSON à clés triées (la base renvoie les objets dans un autre ordre de clés)
const stable = (v) => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);
// Écart entre la configuration de ce navigateur et la version en ligne (null : identiques)
function comparerConfig(loc, srv) {
  const pl = Array.isArray(loc.promos) ? loc.promos : [], ps = Array.isArray(srv.promos) ? srv.promos : [];
  const parId = new Map(ps.map(p => [p.id, p]));
  const seulementIci = pl.filter(p => !parId.has(p.id)).map(p => `${p.name}${p.active ? " (actif)" : ""}`);
  const seulementEnLigne = ps.filter(p => !pl.some(x => x.id === p.id)).map(p => `${p.name}${p.active ? " (actif)" : ""}`);
  const modifies = pl.filter(p => parId.has(p.id) && stable(p) !== stable(parId.get(p.id))).map(p => p.name);
  const dl = loc.display || {}, ds = srv.display || {};
  const affichage = [...new Set([...Object.keys(dl), ...Object.keys(ds)])].filter(k => stable(dl[k]) !== stable(ds[k]));
  return seulementIci.length || seulementEnLigne.length || modifies.length || affichage.length ? { seulementIci, seulementEnLigne, modifies, affichage } : null;
}

export default function AdminPanel({ onClose, sectionMeta, onOrderForPharmacy }) {
  const [authed, setAuthed]     = useState(() => !!localStorage.getItem("admin_token"));

  // Helper : fetch avec JWT Supabase + auto-refresh
  const gpDirtyRef = useRef(false);   // saisie non enregistrée dans l'onglet Commandes groupées
  const onGpDirty = useCallback((d) => { gpDirtyRef.current = d; }, []);
  const assistantDirtyRef = useRef(false);   // réglages de l'onglet Assistant modifiés, non enregistrés
  const onAssistantDirty = useCallback((d) => { assistantDirtyRef.current = d; }, []);
  const quitterAssistant = (suite) => !assistantDirtyRef.current || window.confirm(`Des réglages de l'Assistant ne sont pas enregistrés. ${suite}`);
  const vedettesDirtyRef = useRef(false);   // mises en avant de l'accueil modifiées, non publiées (onglet Affichage)
  const onVedettesDirty = useCallback((d) => { vedettesDirtyRef.current = d; }, []);
  // + photo de la page d'accueil en cours d'envoi (photo-manuelle.js) : quitter ne l'annule pas, mais son résultat ne se voit plus
  const quitterVedettes = (suite) => (!vedettesDirtyRef.current || window.confirm(`Des mises en avant de l'accueil ne sont pas publiées. ${suite}`))
    && (!envoisEnCours() || window.confirm(`Une photo de la page d'accueil est en cours d'envoi : attendez quelques secondes pour voir si elle a réussi. ${suite}`));
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

  // ── Configuration publiée (display_config, admin_promos) ──────────────
  // La version en ligne (celle que voient les pharmacies) fait foi : jamais d'écrasement silencieux.
  // Chaque écriture porte la version lue (updated_at) : si un autre poste a modifié entre-temps, elle est
  // refusée et un bandeau montre l'écart (avant : chaque ouverture de l'admin repoussait sa copie locale).
  const configBase = useRef({});      // clé → updated_at de la version en ligne connue
  const fileConfig = useRef({});      // clé → écriture en cours (les écritures d'une clé partent en série)
  const configLocale = useRef({}); configLocale.current = { promos, displayConfig };
  const [configEcart, setConfigEcart] = useState(null);
  const ecartRef = useRef(null); ecartRef.current = configEcart;
  const publier = (key, value, { forcer = false } = {}) => {
    const p = (fileConfig.current[key] || Promise.resolve()).then(async () => {
      // tant qu'un écart avec la version en ligne n'est pas tranché, rien n'est publié (sinon une copie
      // ancienne de ce navigateur effacerait les changements faits ailleurs)
      if (!forcer && ecartRef.current && !ecartRef.current.erreurSeule) return { ok: false, bloque: true };
      const base = configBase.current[key];
      const res = await adminFetch("/.netlify/functions/config-get", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, ...(base !== undefined ? { base } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.success) { configBase.current[key] = j.updated_at ?? null; return { ok: true }; }
      if (res.status === 409) return { ok: false, conflit: true };
      return { ok: false, erreur: j.error || `HTTP ${res.status}` };
    }).catch(e => ({ ok: false, erreur: e.message }));
    fileConfig.current[key] = p;
    return p;
  };
  const signalerPublication = (r) => {
    if (r.ok) { if (ecartRef.current?.erreurSeule) setConfigEcart(null); return; }
    if (r.bloque) { flash("⚠ Non publié : tranchez d'abord la différence signalée en haut de l'admin"); return; }
    if (r.conflit) { flash("⚠ Non publié : la configuration a été modifiée depuis un autre poste (bandeau en haut)"); chargerConfigServeur(); return; }
    setConfigEcart({ erreurSeule: true, erreur: r.erreur });
  };
  const saveDisplayConfig = (newConfig) => {
    const merged = { ...displayConfig, ...newConfig };
    setDisplayConfig(merged);
    localStorage.setItem("display_config", JSON.stringify(merged));
    publier("display_config", merged).then(signalerPublication);
  };

  // Page d'accueil (AdminAccueil) : changement de display_config.accueil calculé sur la DERNIÈRE version de ce navigateur
  // (fn : accueil → nouvel accueil), même si l'onglet Affichage a été quitté ou remonté pendant un envoi de photo ou une
  // recherche : jamais un accueil ni une saveDisplayConfig d'un ancien rendu (qui republieraient des réglages périmés).
  // Deux appels avant le rendu suivant s'enchaînent (dcRef mis à jour tout de suite). Publié par la saveDisplayConfig du
  // dernier rendu (base / 409 inchangés) → promesse du résultat de cette publication ({ ok } ou { conflit | bloque | erreur },
  // déjà signalé par signalerPublication) : la file des écritures de display_config porte cette publication en dernier.
  const dcRef = useRef(displayConfig); dcRef.current = displayConfig;
  const saveDcRef = useRef(saveDisplayConfig); saveDcRef.current = saveDisplayConfig;
  const majAccueil = useCallback((fn) => {
    const accueil = fn(dcRef.current.accueil || {});
    dcRef.current = { ...dcRef.current, accueil };
    saveDcRef.current({ accueil });
    return fileConfig.current.display_config || Promise.resolve({ ok: false, erreur: "publication non lancée" });
  }, []);

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
  // Envoi partiel : lignes cochées par commande ; une ligne transmise porte synced_at / synced_ref
  const [lineSel, setLineSel] = useState({});        // orderId → [index des lignes cochées]
  const [orderStock, setOrderStock] = useState({});  // cip → true (en stock) | false (précommande)
  const ordersRef = useRef(orders); ordersRef.current = orders;   // état à jour pendant les envois en série
  const inFlight = useRef(new Set());                // commandes en cours d'envoi (pas de double envoi)
  const [syncingAll, setSyncingAll] = useState(false);
  const [promoForm, setPromoForm] = useState({ name:"", description:"", icon:"🏷️", color:"#7c3aed", accentColor:"#a855f7", endDate:"", withPhotos:false });
  const [editingPromoId, setEditingPromoId] = useState(null);
  const [addingProductToPromo, setAddingProductToPromo] = useState(null); // promoId
  const PRODUIT_VIDE = { name:"", cip:"", pv:"", pct:"", pn:"", note:"", image_url:"" };
  const [promoProductForm, setPromoProductForm] = useState(PRODUIT_VIDE);
  const [editingPromoProduct, setEditingPromoProduct] = useState(null);   // { promoId, prodId } : modification d'un produit existant
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
    const r = await adminFetch(`/.netlify/functions/pharmacy-search?q=${encodeURIComponent(q.trim())}`);
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
    flash(d.error ? `❌ ${d.error}` : `✅ ${d.message || "Sync terminée"}`);
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
      // jeton admin : toutes les lignes (CIP et nom des pharmacies) — correctif de sécurité du 19/10/2026
      const res = await adminFetch(`/.netlify/functions/group-order?fournisseur=${encodeURIComponent(fournisseur)}`);
      const rows = await res.json().catch(() => []);
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

  // ── Version en ligne relue (ouverture de l'admin, bouton de l'onglet Affichage) : écart montré, jamais écrasé ──
  const chargerConfigServeur = async () => {
    try {
      const lire = async (k) => {
        const r = await fetch(`/.netlify/functions/config-get?key=${k}&_=${Date.now()}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      };
      const [d, p] = await Promise.all([lire("display_config"), lire("admin_promos")]);
      configBase.current = { display_config: d.updated_at ?? null, admin_promos: p.updated_at ?? null };
      const srv = { promos: Array.isArray(p.value) ? p.value : [], display: d.value && typeof d.value === "object" ? d.value : {} };
      const ecart = comparerConfig({ promos: configLocale.current.promos, display: configLocale.current.displayConfig }, srv);
      setConfigEcart(ecart ? { ...ecart, srv } : null);
      return ecart;
    } catch (e) { setConfigEcart({ erreurSeule: true, erreur: `version en ligne illisible (${e.message})` }); return undefined; }
  };
  const syncConfigToSupabase = async () => {
    const ecart = await chargerConfigServeur();
    if (ecart === null) flash("✓ À jour : les pharmacies voient la même configuration que ce navigateur");
    else if (ecart) flash("Différences avec la version en ligne : voir le bandeau en haut");
  };
  // publier la version de ce navigateur à la place de la version en ligne (choix explicite dans le bandeau)
  const publierMaVersion = async () => {
    const e = configEcart || {};
    const lignes = [
      e.seulementIci?.length ? `Menus promo ajoutés pour les pharmacies : ${e.seulementIci.join(", ")}` : "",
      e.seulementEnLigne?.length ? `Menus promo qui DISPARAÎTRONT : ${e.seulementEnLigne.join(", ")}` : "",
      e.modifies?.length ? `Menus promo remplacés par votre version : ${e.modifies.join(", ")}` : "",
      e.affichage?.length ? `Réglages d'affichage remplacés : ${e.affichage.join(", ")}` : "",
    ].filter(Boolean).join("\n");
    if (!window.confirm(`Remplacer la version que voient les pharmacies par celle de ce navigateur ?\n\n${lignes}`)) return;
    const { promos: pm, displayConfig: dc } = configLocale.current;
    const [r1, r2] = await Promise.all([publier("admin_promos", pm, { forcer: true }), publier("display_config", dc, { forcer: true })]);
    if (r1.ok && r2.ok) { setConfigEcart(null); flash("✓ Publié : les pharmacies voient votre version (rechargement de leur page)"); return; }
    const err = [r1, r2].find(r => !r.ok);
    if (err.conflit) { flash("⚠ Modifiée entre-temps depuis un autre poste : écart mis à jour"); chargerConfigServeur(); }
    else setConfigEcart(c => ({ ...(c || {}), erreurPublication: err.erreur || "erreur inconnue" }));
  };
  const reprendreVersionEnLigne = () => {
    const srv = configEcart?.srv; if (!srv) return;
    if ((configEcart.seulementIci || []).length && !window.confirm(`Abandonner ce qui n'existe que dans ce navigateur (${configEcart.seulementIci.join(", ")}) et reprendre la version en ligne ?`)) return;
    setPromos(srv.promos); localStorage.setItem("admin_promos", JSON.stringify(srv.promos));
    setDisplayConfig(srv.display); localStorage.setItem("display_config", JSON.stringify(srv.display));
    setConfigEcart(null); flash("✓ Version en ligne reprise");
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
        setAuthed(true);   // l'effet sur authed relit aussi la configuration en ligne
        refreshOrders();
        fetchProducts();
      } else {
        setPwdError(data.error || "Identifiants incorrects");
      }
    } catch (e) {
      console.error("[admin-login]", e.message);
      setPwdError("Erreur réseau : " + e.message);
    }
  };

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
    publier("admin_promos", updated).then(signalerPublication);
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
    const pn = parseFloat(String(promoProductForm.pn).replace(",", "."));
    if (!promoProductForm.name.trim() || isNaN(pn)) return alert("Nom et prix net requis");
    const img = String(promoProductForm.image_url || "").trim();
    if (img && !/^https:\/\/\S+$/.test(img)) return alert("Photo : adresse https://… de l'image");
    const champs = { name: promoProductForm.name.trim(), cip: String(promoProductForm.cip || "").trim() || null, pv: parseFloat(String(promoProductForm.pv).replace(",", ".")) || null,
      pct: String(promoProductForm.pct || "").trim() || null, pn, note: String(promoProductForm.note || "").trim() || null, image_url: img || null };
    if (editingPromoProduct?.promoId === promoId) {
      // modification sur place (même position : les paniers en cours restent valables)
      savePromos(promos.map(p => p.id===promoId ? {...p, products:(p.products||[]).map(pr => pr.id===editingPromoProduct.prodId ? { ...pr, ...champs } : pr)} : p));
      flash("✅ Produit modifié");
    } else {
      savePromos(promos.map(p => p.id===promoId ? {...p, products:[...(p.products||[]), { id: Date.now(), ...champs }]} : p));
      flash("✅ Produit ajouté à la promo !");
    }
    setPromoProductForm(PRODUIT_VIDE);
    setEditingPromoProduct(null);
    setAddingProductToPromo(null);
  };
  const editerProduitPromo = (promoId, prod) => {
    setPromoProductForm({ name: prod.name || "", cip: prod.cip || "", pv: prod.pv ?? "", pct: prod.pct || "", pn: prod.pn ?? "", note: prod.note || "", image_url: prod.image_url || "" });
    setEditingPromoProduct({ promoId, prodId: prod.id });
    setAddingProductToPromo(promoId);
  };
  const editerPromo = (ps) => {
    const name = window.prompt("Nom du menu", ps.name); if (name === null) return;
    const description = window.prompt("Sous-titre (facultatif)", ps.description || ""); if (description === null) return;
    if (!name.trim()) return alert("Nom requis");
    savePromos(promos.map(p => p.id===ps.id ? {...p, name: name.trim(), description: description.trim()} : p));
  };
  const removeProductFromPromo = (promoId, prodId) => savePromos(promos.map(p => p.id===promoId ? {...p, products:(p.products||[]).filter(pr=>pr.id!==prodId)} : p));
  const updatePromoField = (id, field, val) => savePromos(promos.map(p => p.id===id ? {...p, [field]:val} : p));

  // ── IMPORT helpers ──


  // ── SYNC helpers ──
  // Envoi à PharmaML par le relais : le serveur crée une tâche (lignes pas encore envoyées, référence id puis
  // idP<n>, jamais deux fois la même ligne), l'agent du Mac du bureau l'envoie (PharmaML refuse toute autre
  // adresse), le serveur marque les lignes envoyées. La synchro marche donc depuis n'importe quel poste.
  const suivreTaches = async (refs, maxMs) => {
    const fin = Date.now() + maxMs;
    let res = {};
    while (Date.now() < fin) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const r = await adminFetch("/.netlify/functions/pml-relais", { method: "POST", body: JSON.stringify({ action: "etat", refs }) });
        res = (await r.json()).taches || {};
        if (refs.every(ref => res[ref] && !["a_envoyer", "prise"].includes(res[ref].etat))) break;
      } catch { /* réseau : nouvel essai */ }
    }
    return res;
  };
  const enFond = useRef(new Set());
  const appliquerIssue = (orderId, t, idxEnvoyes) => {
    if (!t) return;
    if (t.etat === "envoyee") {
      const order = ordersRef.current.find(o => o.id === orderId);
      if (!order) return;
      const at = t.renduA || new Date().toISOString();
      const lignes = t.idx || idxEnvoyes || [];
      const newItems = (order.items || []).map((it, i) => lignes.includes(i) ? { ...it, synced_at: it.synced_at || at, synced_ref: it.synced_ref || t.ref } : it);
      const done = newItems.every(lineDone);
      ordersRef.current = ordersRef.current.map(o => o.id === orderId ? { ...o, items: newItems, processed: done } : o);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, items: newItems, processed: done } : o));
      setLineSel(sel => ({ ...sel, [orderId]: [] }));
      setSyncStatus(s => ({ ...s, [orderId]: done ? "ok" : `partielle:${lignes.length}` }));
      return;
    }
    const h = (d) => d ? new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
    const msg = t.etat === "refusee" ? `Refusée par PharmaML (réf. ${t.ref}) : ${t.message || ""} — rien n'a été créé, les lignes sont de nouveau à synchroniser`
      : t.etat === "incertaine" ? `Issue inconnue (réf. ${t.ref}) : vérifiez le portail PharmaML avant toute nouvelle saisie — ${t.message || ""}`
      : t.etat === "expiree" ? `Non prise par l'agent du Mac avant l'échéance (réf. ${t.ref}) : rien envoyé, à resynchroniser`
      : ["annulee", "non_envoyee"].includes(t.etat) ? `Non envoyée (${t.etat === "annulee" ? "annulée" : "vérifiée absente"}, réf. ${t.ref}) ${t.message || ""}`
      : t.etat === "prise" ? `📤 Envoi en cours par l'agent du Mac (réf. ${t.ref}) : ne pas ressaisir avant son compte rendu`
      : `📡 En file (réf. ${t.ref}) : en attente de l'agent du Mac jusqu'à ${h(t.priseAvant)} — non prise d'ici là, elle reviendra à la synchro manuelle (rien envoyé)`;
    setSyncStatus(s => ({ ...s, [orderId]: msg }));
    // encore en file : suivi en arrière-plan (30 min au plus) pour afficher l'issue sans actualiser
    if (["a_envoyer", "prise"].includes(t.etat) && !enFond.current.has(t.ref)) {
      enFond.current.add(t.ref);
      suivreTaches([t.ref], 30 * 60e3).then(res => { enFond.current.delete(t.ref); const f = res[t.ref]; if (f && !["a_envoyer", "prise"].includes(f.etat)) appliquerIssue(orderId, f, idxEnvoyes); });
    }
  };
  const syncOrder = async (orderArg, onlyIdx = null) => {
    const order = ordersRef.current.find(o => o.id === orderArg.id) || orderArg;   // marques d'envoi à jour
    if (order.processed || inFlight.current.has(order.id)) return;
    const all = order.items || [];
    const remaining = all.map((_, i) => i).filter(i => !lineDone(all[i]));
    const idx = onlyIdx ? onlyIdx.filter(i => remaining.includes(i)) : remaining;
    if (!idx.length) return;
    if (order.avisAuto?.code === "double" && !window.confirm(`⚠ Possible doublon : ${order.avisAuto.error}\n\nVérifiez que la pharmacie veut bien les deux commandes. Envoyer quand même celle-ci à PharmaML ?`)) return;
    inFlight.current.add(order.id);
    setSyncStatus(s => ({ ...s, [order.id]: "pending" }));
    try {
      const r = await adminFetch("/.netlify/functions/pml-relais", { method: "POST", body: JSON.stringify({ action: "envoyer", orderId: order.id, idx }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setSyncStatus(s => ({ ...s, [order.id]: j.error || `HTTP ${r.status}` })); return; }
      const res = await suivreTaches([j.ref], 75e3);
      appliquerIssue(order.id, res[j.ref] || { ref: j.ref, etat: "a_envoyer" }, j.idx || idx);
    } catch (e) {
      setSyncStatus(s => ({ ...s, [order.id]: `Erreur (${e.message}) : actualisez avant de réessayer` }));
    } finally { inFlight.current.delete(order.id); }
  };

  // Lignes traitées sans envoi à PharmaML (ou retour « à envoyer ») ; commande traitée quand tout est réglé
  const markLines = async (orderArg, idxList, handled) => {
    const order = ordersRef.current.find(o => o.id === orderArg.id) || orderArg;
    if (inFlight.current.has(order.id)) return;
    const all = order.items || [];
    const now = new Date().toISOString();
    const newItems = all.map((it, i) => {
      if (!idxList.includes(i) || it?.synced_at) return it;   // une ligne envoyée reste envoyée
      if (handled) return { ...it, handled_at: now };
      const { handled_at, ...rest } = it; return rest;
    });
    const done = newItems.length > 0 && newItems.every(lineDone);
    const avant = { items: order.items, processed: order.processed };
    const appliquer = (v) => { ordersRef.current = ordersRef.current.map(o => o.id === order.id ? { ...o, ...v } : o); setOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...v } : o)); };
    appliquer({ items: newItems, processed: done });
    setLineSel(sel => ({ ...sel, [order.id]: [] }));
    try {
      const r = await adminFetch("/.netlify/functions/order-update", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, items: newItems, processed: done }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (Array.isArray(j.items)) appliquer({ items: j.items, processed: j.processed });   // marques d'envoi gardées par le serveur
      setSyncStatus(s => ({ ...s, [order.id]: handled ? `traitees:${idxList.length}` : undefined }));
    } catch (e) { appliquer(avant); setSyncStatus(s => ({ ...s, [order.id]: `Non enregistré : ${e.message}` })); }
  };

  // « Sync toutes » : commandes en attente SANS envoi partiel — le reste d'une commande partielle
  // (précommandes retenues) ne part que par son propre bouton « Sync le reste »
  // Commandes « sur justificatif labo » : jamais dans « Sync toutes » — à synchroniser une par une, à réception du labo
  // Commandes « a_verifier » (page d'avant le correctif de sécurité du 19/10/2026, sans jeton) : jamais en masse non plus
  const bulkPending = orders.filter(o => !o.processed && o.source !== "justificatif" && o.source !== "a_verifier" && !(o.items || []).some(lineDone)
    && !(o.relais || []).some(t => ["a_envoyer", "prise", "incertaine"].includes(t.etat))   // en cours ou à vérifier : pas en masse
    && o.avisAuto?.code !== "double");                                                       // possible doublon : une par une, après vérification
  const syncAllPending = async () => {
    if (syncingAll) return;
    setSyncingAll(true);
    const lances = [];
    try {
      // toutes les tâches d'abord (rapide), puis suivi groupé de leurs issues
      for (const o of bulkPending) {
        if (inFlight.current.has(o.id)) continue;
        inFlight.current.add(o.id);
        setSyncStatus(s => ({ ...s, [o.id]: "pending" }));
        try {
          const r = await adminFetch("/.netlify/functions/pml-relais", { method: "POST", body: JSON.stringify({ action: "envoyer", orderId: o.id }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) { setSyncStatus(s => ({ ...s, [o.id]: j.error || `HTTP ${r.status}` })); inFlight.current.delete(o.id); continue; }
          lances.push({ id: o.id, ref: j.ref, idx: j.idx });
        } catch (e) { setSyncStatus(s => ({ ...s, [o.id]: `Erreur (${e.message})` })); inFlight.current.delete(o.id); }
      }
      if (lances.length) {
        const res = await suivreTaches(lances.map(l => l.ref), 120e3);
        for (const l of lances) appliquerIssue(l.id, res[l.ref] || { ref: l.ref, etat: "a_envoyer" }, l.idx);
      }
    } finally { for (const l of lances) inFlight.current.delete(l.id); setSyncingAll(false); }
  };
  // Stock des lignes des commandes en attente (cases « en stock » / « précommande »)
  useEffect(() => {
    const cips = [...new Set(orders.filter(o => !o.processed).flatMap(o => (o.items || []).map(i => i?.cip)).filter(c => c && /^\d{7,14}$/.test(c) && !(c in orderStock)))];
    if (!cips.length) return;
    let alive = true;
    (async () => {
      const found = {};
      for (let i = 0; i < cips.length; i += 300) {
        try {
          const r = await fetch(`/.netlify/functions/stock-get?cips=${cips.slice(i, i + 300).join(",")}`);
          const j = await r.json();
          if (!r.ok || !j.stocks || j.error) continue;
          for (const c of cips.slice(i, i + 300)) if (j.stocks[c]) found[c] = j.stocks[c].dispo > 0;   // inconnu : pas de badge
        } catch { /* stock inconnu : pas de badge, redemandé plus tard */ }
      }
      if (alive && Object.keys(found).length) setOrderStock(st => ({ ...st, ...found }));
    })();
    return () => { alive = false; };
  }, [orders]);   // eslint-disable-line react-hooks/exhaustive-deps

  // stable (useCallback) : les onglets qui le reçoivent rechargent leurs données quand il change
  const flash = useCallback((msg) => { setSaved(msg); setTimeout(()=>setSaved(""), 2500); }, []);
  const fmt = (n) => n!=null&&!isNaN(n) ? Number(n).toFixed(2)+" €" : "—";

  const refreshOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await adminFetch("/.netlify/functions/order-list");
      const json = await res.json();
      if (json.orders) { setOrderStock({}); setOrders(json.orders); }
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
    // configuration : version en ligne relue et comparée (plus jamais repoussée automatiquement, ce qui
    // effaçait les menus promo créés depuis un autre poste)
    if (authed) { fetchProducts(); refreshOrders(); chargerConfigServeur(); }
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
    const its = order?.items || [];
    // une ligne envoyée à PharmaML ne repart jamais (marques gardées par le serveur) : une commande
    // entièrement envoyée ne se rouvre pas pour un renvoi
    if (!newVal && its.length && its.every(it => it?.synced_at)) {
      window.alert("Commande entièrement envoyée à PharmaML : elle ne peut pas être renvoyée depuis l'admin (risque de doublon).\n\nSi elle manque vraiment dans PharmaML (vérifiez le portail), saisissez-la directement dans PharmaML.");
      return;
    }
    const items = newVal ? null : its.some(it => it?.handled_at && !it?.synced_at) ? its.map(it => { if (it?.synced_at) return it; const { handled_at, ...rest } = it; return rest; }) : null;   // lignes traitées sans envoi : de nouveau à envoyer
    const avantO = order;
    setOrders(prev => prev.map(o => o.id===id ? {...o, processed: newVal, ...(items ? { items } : {})} : o));
    const r = await adminFetch("/.netlify/functions/order-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, processed: newVal, ...(items ? { items } : {}) })
    }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setOrders(prev => prev.map(o => o.id === id ? avantO : o)); flash(`⚠ Non enregistré : ${j?.error || "erreur réseau"}`); }
    else if (Array.isArray(j?.items)) setOrders(prev => prev.map(o => o.id === id ? { ...o, items: j.items, processed: j.processed } : o));
  };

  const deleteOrder = async (id) => {
    const avantO = orders.find(o => o.id === id);
    setOrders(prev => prev.filter(o => o.id!==id));
    const r = await adminFetch("/.netlify/functions/order-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "delete" })
    }).catch(() => null);
    if (!r?.ok && avantO) {
      setOrders(prev => prev.some(o => o.id === id) ? prev : [...prev, avantO].sort((a, b) => String(b.date).localeCompare(String(a.date))));
      flash(`⚠ Non supprimée : ${(await r?.json().catch(() => ({})))?.error || "erreur réseau"}`);
    }
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
        if (!res.ok) throw new Error(`Application du stock interrompue (HTTP ${res.status}) — sync partielle, relancez.`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        totalUpdated += data.updated || 0;
        setSyncStock({ running: true, progress: `Étape 4/4 : ${offset + (data.updated || 0)} / ${data.total || "?"}...` });
        if (data.done) break;
        offset = data.next_offset;
      }

      // Étape 5 : RAZ des produits disparus → remis en rupture (garde-fou côté serveur)
      setSyncStock({ running: true, progress: "Nettoyage des ruptures (produits disparus)..." });
      let resetInfo = "";
      try {
        const resetRes = await adminFetch("/.netlify/functions/odoo-stock-sync?step=reset_absent");
        const resetData = await resetRes.json().catch(() => ({}));
        if (resetData.skipped) resetInfo = ` · ⚠ RAZ ignorée (${resetData.reason})`;
        else if (resetData.reset != null) resetInfo = ` · ${resetData.reset} remis en rupture`;
      } catch (e) { resetInfo = " · ⚠ RAZ des ruptures échouée : " + e.message; }

      setSyncStock({ running: false, progress: `✓ Terminé — ${totalProducts} produits, ${stockData.in_stock} en stock (${stockData.quants_excluded || 0} quants exclus de ${stockData.excluded_locations || 0} emplacements), ${totalUpdated} mises à jour${resetInfo}` });
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
  // lot 10 : fond cream, carte paper (rayon 16 au plus dans l'admin), croix Elixir sarcelle ; champs, bouton et
  // gestionnaires inchangés (autoFocus, Entrée, handleLogin)
  if (!authed) return (
    <div className="ex-admin" style={{position:"fixed",inset:0,background:T.cream,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,fontFamily:"inherit",padding:16}}>
      <div style={{background:T.paper,borderRadius:R.m,padding:"40px 44px",maxWidth:420,width:"100%",border:`1px solid ${T.line}`,boxShadow:T.shadow3}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:28}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <CroixElixir taille={30} epaisseur={75} style={{color:T.teal}} />
            <div>
              <h1 style={{margin:0,fontWeight:640,fontSize:22,letterSpacing:"-0.02em",lineHeight:1.2,color:T.petrol}}>Espace Admin</h1>
              <div style={{fontSize:12,color:T.inkMute,marginTop:3}}>Elixir Pharma – Authentification Supabase</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" title="Fermer" className="ex-btn-discret" style={CB}><Icone nom="fermer" taille={16} /></button>
        </div>
        <label style={LS}>Email</label>
        <input type="email" value={adminEmail} onChange={e=>setAdminEmail(e.target.value)}
          placeholder="pharmacien@elixirpharma.fr"
          style={{...IS, marginBottom:12}} autoFocus />
        <label style={LS}>Mot de passe</label>
        <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••"
          style={{...IS,borderColor:pwdError?T.danger:T.lineField}} />
        {pwdError&&<div role="alert" style={{color:T.danger,fontSize:12,marginTop:6,display:"flex",alignItems:"center",gap:6}}><Icone nom="alerte" taille={14} />{pwdError}</div>}
        <button onClick={handleLogin} style={{...PB,marginTop:16}}>Accéder →</button>
      </div>
    </div>
  );

  const TABS = [
    {k:"add",      label:"➕ Ajouter",    icon:"➕"},
    {k:"edit",     label:"✏️ Modifier",   icon:"✏️"},
    {k:"promos",   label:"🎯 Promos",     icon:"🎯", badge: promos.length||null},
    {k:"orders",   label:"📋 Commandes",  icon:"📋", badge: orders.filter(o=>!o.processed).length||null},
    {k:"gp",       label:"🛒 Commandes groupées",icon:"🛒"},
    {k:"justif",   label:"📑 Justificatifs labos",icon:"📑"},
    {k:"sanofipro",label:"💉 Sanofi Pro",icon:"💉"},
    {k:"assistant",label:"💬 Assistant",icon:"💬"},
    {k:"grouporders",label:"🤝 Groupements",icon:"🤝"},
    {k:"campaigns",label:"🏗️ Campagnes",  icon:"🏗️"},
    {k:"pharmacies",label:"🏥 Pharmacies",icon:"🏥"},
    {k:"expiry",    label:"⏰ Péremptions",icon:"⏰"},
    {k:"alertes",   label:"🔔 Alertes retour",icon:"🔔"},
    {k:"display",   label:"🎨 Affichage",  icon:"🎨"},
    {k:"sync",      label:"🔄 Synchronisation",icon:"🔄"},
    {k:"search_ml", label:"🧠 Recherches",icon:"🧠"},
  ];

  return (
    <div className="ex-admin" style={{position:"fixed",inset:0,zIndex:1000,background:T.cream,display:"flex",flexDirection:"column",fontFamily:"inherit"}}>

      {/* ── Top bar ── lot 10 : pétrole comme l'en-tête du site, croix or clair, anneau de focus or clair (ex-on-dark) */}
      <div className="ex-on-dark" style={{background:T.petrol,color:T.paper,padding:"0 24px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexShrink:0,boxShadow:T.shadow1}}>
        <div style={{display:"flex",alignItems:"center",gap:16,minWidth:0,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,fontWeight:640,fontSize:17,letterSpacing:"-0.02em",minWidth:0}}>
            <CroixElixir taille={22} style={{color:T.orClair}} />
            <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Administration Elixir Pharma</span>
          </div>
          <div className="num ex-admin-stats" style={{fontSize:11,color:T.paperMute,paddingLeft:16,borderLeft:"1px solid rgba(251,248,242,0.18)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {products.filter(p=>p.source==="admin").length} ajoutés · {products.length} produits · {orders.length} commandes
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          {onOrderForPharmacy && <button className="ex-admin-btn-acting" onClick={()=>{ if (gpDirtyRef.current && !window.confirm("Des modifications de commande groupée ne sont pas enregistrées. Continuer ?")) return; if (!quitterAssistant("Continuer ?") || !quitterVedettes("Continuer ?")) return; onOrderForPharmacy(); }} title="Passer une commande sur le site à la place d'une pharmacie (sans accès, par téléphone…)" style={{border:"none",borderRadius:R.pill,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
            <Icone nom="crayon" taille={15} /> <span className="ex-admin-libelle">Commander pour une pharmacie</span>
          </button>}
          <button className="ex-admin-btn-sombre" onClick={()=>{ if (gpDirtyRef.current && !window.confirm("Des modifications de commande groupée ne sont pas enregistrées. Quitter l'administration ?")) return; if (!quitterAssistant("Quitter l'administration ?") || !quitterVedettes("Quitter l'administration ?")) return; onClose(); }} title="Retour au catalogue" style={{border:"none",borderRadius:R.pill,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
            <Icone nom="retour" taille={15} /> <span className="ex-admin-libelle">Retour au catalogue</span>
          </button>
        </div>
      </div>

      {/* ── Configuration (menus promo, affichage) différente de celle que voient les pharmacies ── */}
      {/* lot 10 : ton warn (écart) ou danger (erreur de publication) ; textes, boutons et gestionnaires inchangés */}
      {configEcart && (
        <div role="alert" style={{background: configEcart.erreurSeule ? T.dangerBg : T.warnBg, borderBottom:`1px solid ${configEcart.erreurSeule ? tone("danger").border : tone("warn").border}`, padding:"10px 24px", fontSize:12, color: configEcart.erreurSeule ? T.danger : T.warn, display:"flex", gap:16, alignItems:"center", flexWrap:"wrap", flexShrink:0}}>
          <div style={{flex:"1 1 420px", lineHeight:1.5}}>
            {configEcart.erreurSeule ? (
              <><b style={{color:T.danger}}>⚠ Dernière modification NON publiée</b> : les pharmacies ne la voient pas ({configEcart.erreur}).</>
            ) : (<>
              <b>⚠ Ce navigateur n'a pas la même configuration que celle que voient les pharmacies.</b> Rien n'est publié tant que vous n'avez pas choisi.
              {configEcart.seulementIci?.length > 0 && <div>Menus promo présents seulement ici : <b>{configEcart.seulementIci.join(", ")}</b></div>}
              {configEcart.seulementEnLigne?.length > 0 && <div>Menus promo en ligne absents d'ici : <b>{configEcart.seulementEnLigne.join(", ")}</b></div>}
              {configEcart.modifies?.length > 0 && <div>Menus promo différents : <b>{configEcart.modifies.join(", ")}</b></div>}
              {configEcart.affichage?.length > 0 && <div>Réglages d'affichage différents : {configEcart.affichage.join(", ")}</div>}
              {configEcart.erreurPublication && <div style={{color:T.danger}}>Publication impossible : {configEcart.erreurPublication}</div>}
            </>)}
          </div>
          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            <button onClick={publierMaVersion} style={{background:T.warn,color:"white",border:"none",borderRadius:R.pill,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>Publier la version de ce navigateur</button>
            {!configEcart.erreurSeule && <button onClick={reprendreVersionEnLigne} style={{background:T.surface,color:T.warn,border:`1px solid ${tone("warn").border}`,borderRadius:R.pill,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>Reprendre la version en ligne</button>}
          </div>
        </div>
      )}

      {/* ── Body : sidebar + content ── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* Sidebar */}
        {/* lot 10 : paper + filet ; onglet actif menthe + sarcelle (aria-current), survol par ex-menu (fond actif en inline,
            il l'emporte) ; emoji de tête des TABS conservé (la regex du libellé retire le premier mot) */}
        <nav aria-label="Onglets de l'administration" className="ex-admin-onglets" style={{width:200,background:T.paper,borderRight:`1px solid ${T.line}`,display:"flex",flexDirection:"column",padding:"16px 0",flexShrink:0,overflowY:"auto"}}>
          {TABS.map(t=>(
            <button key={t.k} className="ex-menu" aria-current={tab===t.k?"page":undefined} title={t.label.replace(/^[^\s]+\s/,"")} onClick={()=>{ if (tab==="gp" && t.k!=="gp" && gpDirtyRef.current && !window.confirm("Des modifications de commande groupée ne sont pas enregistrées. Quitter l'onglet ?")) return; if (tab==="assistant" && t.k!=="assistant" && !quitterAssistant("Quitter l'onglet ?")) return; if (tab==="display" && t.k!=="display" && !quitterVedettes("Quitter l'onglet ?")) return; setTab(t.k); if(t.k==="grouporders") fetchGroupCampaignOrders("ulabs"); if(t.k==="campaigns") fetchCampaigns(); }}
              style={{display:"flex",alignItems:"center",gap:10,padding:"11px 20px",border:"none",background:tab===t.k?T.mint:undefined,color:tab===t.k?T.teal:T.inkSoft,fontWeight:tab===t.k?700:500,fontSize:13,cursor:"pointer",textAlign:"left",borderLeft:tab===t.k?`3px solid ${T.teal}`:"3px solid transparent",position:"relative"}}>
              <span style={{fontSize:16}}>{t.icon}</span>
              <span className="ex-admin-libelle" style={{flex:1}}>{t.label.replace(/^[^\s]+\s/,"")}</span>
              {t.badge ? <span className="num ex-admin-badge" style={{background:T.danger,color:"white",borderRadius:99,fontSize:11,fontWeight:700,padding:"1px 6px",minWidth:18,textAlign:"center"}}>{t.badge}</span> : null}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <div className="ex-admin-contenu" style={{flex:1,overflowY:"auto",padding:"24px 32px"}}>



        {/* ── ADD TAB ── */}
        {tab==="add"&&(
          <AdminAdd allSectionsList={allSectionsList} adminFetch={adminFetch} flash={flash}
            fetchProducts={fetchProducts} products={products}
            medipimLookup={medipimLookup} setMedipimLookup={setMedipimLookup} />
        )}
        {tab==="promos"&&(
          <>
            {/* Create new promo form */}
            <div style={{background:T.paper,borderRadius:14,padding:"16px",marginBottom:20,border:"1px solid var(--line)"}}>
              <div style={{fontWeight:700,fontSize:13,color:T.petrol,marginBottom:14}}>Créer une section promotionnelle</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{...LS,fontSize:11}}>Nom de la section *</label>
                  <input value={promoForm.name} onChange={e=>setPromoForm(f=>({...f,name:e.target.value}))} placeholder="Flash Semaine / Offre Spéciale..." style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{...LS,fontSize:11}}>Description (affichée dans le popup)</label>
                  <input value={promoForm.description} onChange={e=>setPromoForm(f=>({...f,description:e.target.value}))} placeholder="Promotions exclusives cette semaine !" style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                </div>
                <div>
                  <label style={{...LS,fontSize:11}}>Icône (emoji)</label>
                  <input value={promoForm.icon} onChange={e=>setPromoForm(f=>({...f,icon:e.target.value}))} placeholder="🏷️" style={{...IS,fontSize:18,padding:"5px 10px",textAlign:"center"}}/>
                </div>
                <div>
                  <label style={{...LS,fontSize:11}}>Date de fin (optionnel)</label>
                  <input type="date" value={promoForm.endDate} onChange={e=>setPromoForm(f=>({...f,endDate:e.target.value}))} style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                </div>
                <div>
                  <label style={{...LS,fontSize:11}}>Couleur principale</label>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input type="color" value={promoForm.color} onChange={e=>setPromoForm(f=>({...f,color:e.target.value}))} style={{width:36,height:36,border:"none",borderRadius:8,cursor:"pointer",padding:2}}/>
                    <span style={{fontSize:12,color:T.inkMute}}>{promoForm.color}</span>
                  </div>
                </div>
                <div>
                  <label style={{...LS,fontSize:11}}>Couleur accent</label>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input type="color" value={promoForm.accentColor} onChange={e=>setPromoForm(f=>({...f,accentColor:e.target.value}))} style={{width:36,height:36,border:"none",borderRadius:8,cursor:"pointer",padding:2}}/>
                    <span style={{fontSize:12,color:T.inkMute}}>{promoForm.accentColor}</span>
                  </div>
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
                  <input type="checkbox" checked={promoForm.withPhotos}
                    onChange={e=>setPromoForm(f=>({...f,withPhotos:e.target.checked}))}
                    style={{width:16,height:16,cursor:"pointer"}}/>
                  <span style={{fontSize:13,fontWeight:600,color:T.petrol}}>
                    🖼️ Affichage avec photos (présentation horizontale)
                  </span>
                </label>
                <div style={{fontSize:11,color:T.inkMute,marginTop:3,marginLeft:26}}>
                  Les produits avec image_url seront affichés en mode visuel, les autres en tableau.
                </div>
              </div>
              <button onClick={createPromo} style={{...PB,padding:"9px",fontSize:13}}>✨ Créer cette section</button>
            </div>

            {/* Existing promos */}
            {promos.length===0&&<div style={{textAlign:"center",padding:"30px",color:T.inkMute,fontSize:13}}>Aucune section promo créée.</div>}
            {promos.map(ps=>(
              <div key={ps.id} style={{borderRadius:14,marginBottom:14,border:`2px solid ${ps.active?alpha(ps.color,.38):T.line}`,background:ps.active?alpha(ps.color,.03):T.paper,overflow:"hidden"}}>
                {/* Promo header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",borderBottom:"1px solid var(--line-soft)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:24}}>{ps.icon}</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,color:T.petrol,display:"flex",alignItems:"center",gap:8}}>
                        {ps.name}
                        {ps.active
                          ? <span style={{background:T.okBg,color:T.ok,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>● VISIBLE</span>
                          : <span style={{background:T.surface2,color:T.inkMute,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>○ MASQUÉ</span>
                        }
                      </div>
                      {ps.description&&<div style={{fontSize:11,color:T.inkMute}}>{ps.description}</div>}
                      {ps.endDate&&<div style={{fontSize:11,color:T.warn,fontWeight:600}}>⏰ Jusqu'au {new Date(ps.endDate).toLocaleDateString("fr-FR")}</div>}
                      <div style={{fontSize:11,color:T.inkMute}}>{(ps.products||[]).length} produit(s)</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button onClick={()=>togglePromoActive(ps.id)} style={{
                      background:ps.active?T.warnBg:T.okBg,border:"none",borderRadius:8,padding:"5px 10px",
                      cursor:"pointer",fontSize:11,fontWeight:700,color:ps.active?T.warn:T.ok
                    }}>{ps.active?"Masquer":"Afficher"}</button>
                    <button onClick={()=>updatePromoField(ps.id,"withPhotos",!ps.withPhotos)} title="Affichage des produits avec leurs photos (grille) ou en tableau"
                      style={{background:ps.withPhotos?"#ede9fe":T.surface2,border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:ps.withPhotos?"#5b21b6":T.inkMute}}>📷 {ps.withPhotos?"Photos":"Tableau"}</button>
                    <button onClick={()=>updatePromoField(ps.id,"sansStock",!ps.sansStock)} title="Précommande : ne rien afficher sur le stock (ni filtres « En stock / Ruptures », ni badge rupture)"
                      style={{background:ps.sansStock?T.warnBg:T.surface2,border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:ps.sansStock?T.warn:T.inkMute}}>📦 {ps.sansStock?"Sans stock":"Stock affiché"}</button>
                    <button onClick={()=>editerPromo(ps)} title="Modifier le nom et le sous-titre" style={{background:T.surface2,border:"none",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:11,fontWeight:700,color:T.inkSoft}}>✏️</button>
                    <button onClick={()=>{ setEditingPromoProduct(null); setPromoProductForm(PRODUIT_VIDE); setAddingProductToPromo(addingProductToPromo===ps.id?null:ps.id); }} style={{background:T.mint,border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:T.teal}}>+ Produit</button>
                    <button onClick={()=>deletePromo(ps.id)} style={{background:T.dangerBg,border:"none",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,color:T.danger}}>🗑</button>
                  </div>
                </div>

                {/* Add product form */}
                {addingProductToPromo===ps.id&&(
                  <div style={{background:T.mint,padding:"12px 16px",borderBottom:`1px solid ${T.mint2}`}}>
                    <div style={{fontWeight:700,fontSize:12,color:T.teal,marginBottom:10}}>{editingPromoProduct?.promoId===ps.id ? "Modifier le produit" : `Ajouter un produit à ${ps.name}`}</div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8,marginBottom:8}}>
                      <div>
                        <label style={{...LS,fontSize:11}}>Nom *</label>
                        <input value={promoProductForm.name} onChange={e=>setPromoProductForm(f=>({...f,name:e.target.value}))} placeholder="DOLIPRANE 1G..." style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:11}}>CIP</label>
                        <input value={promoProductForm.cip} onChange={e=>setPromoProductForm(f=>({...f,cip:e.target.value}))} placeholder="3400930..." style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
                      <div>
                        <label style={{...LS,fontSize:11}}>Prix brut (€)</label>
                        <input type="number" step="0.01" value={promoProductForm.pv} onChange={e=>setPromoProductForm(f=>({...f,pv:e.target.value}))} style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:11}}>Remise</label>
                        <input value={promoProductForm.pct} onChange={e=>setPromoProductForm(f=>({...f,pct:e.target.value}))} placeholder="-20%" style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:11,color:T.ok}}>Prix net (€) ★</label>
                        <input type="number" step="0.01" value={promoProductForm.pn} onChange={e=>setPromoProductForm(f=>({...f,pn:e.target.value}))} style={{...IS,fontSize:12,padding:"6px 10px",borderColor:T.ok,color:T.ok,fontWeight:700}}/>
                      </div>
                      <div>
                        <label style={{...LS,fontSize:11}}>Note</label>
                        <input value={promoProductForm.note} onChange={e=>setPromoProductForm(f=>({...f,note:e.target.value}))} placeholder="Stock limité" style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"flex-end",marginBottom:8}}>
                      <div style={{flex:1}}>
                        <label style={{...LS,fontSize:11}}>Photo (adresse https:// de l'image, facultatif)</label>
                        <input value={promoProductForm.image_url} onChange={e=>setPromoProductForm(f=>({...f,image_url:e.target.value}))} placeholder="https://…/image.png" style={{...IS,fontSize:12,padding:"6px 10px"}}/>
                      </div>
                      {/^https:\/\//.test(promoProductForm.image_url||"") && <img src={promoProductForm.image_url} alt="" style={{width:44,height:44,objectFit:"contain",borderRadius:6,background:"white",border:"1px solid #dbeafe"}}/>}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>addProductToPromo(ps.id)} style={{...PB,flex:1,padding:"8px",fontSize:12}}>{editingPromoProduct?.promoId===ps.id ? "💾 Enregistrer" : "➕ Ajouter"}</button>
                      <button onClick={()=>{ setAddingProductToPromo(null); setEditingPromoProduct(null); setPromoProductForm(PRODUIT_VIDE); }} style={{background:T.sand,border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:700,color:T.inkSoft}}>Annuler</button>
                    </div>
                  </div>
                )}

                {/* Products list */}
                {(ps.products||[]).length>0&&(
                  <div style={{padding:"8px 16px 12px"}}>
                    {ps.products.map(prod=>(
                      <div key={prod.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--line-soft)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          {prod.image_url && <img src={prod.image_url} alt="" style={{width:30,height:30,objectFit:"contain",borderRadius:4,background:T.surface,border:"1px solid var(--line-soft)"}}/>}
                          <span style={{fontWeight:600,fontSize:12,color:T.petrol}}>{prod.name}</span>
                          {prod.cip&&<span style={{marginLeft:8}}><CipCopy cip={prod.cip}/></span>}
                          {prod.note&&<span style={{fontSize:11,color:T.warn,marginLeft:6,background:T.warnBg,borderRadius:4,padding:"1px 5px"}}>{prod.note}</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:12,fontWeight:700,color:T.ok}}>{prod.pn?.toFixed(2)} €</span>
                          {prod.pct&&<span style={{fontSize:11,color:"#7c3aed"}}>{prod.pct}</span>}
                          <button onClick={()=>editerProduitPromo(ps.id,prod)} title="Modifier" style={{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:"0 2px"}}>✏️</button>
                          <button onClick={()=>{ if (window.confirm(`Retirer « ${prod.name} » du menu ?`)) removeProductFromPromo(ps.id,prod.id); }} style={{background:"none",border:"none",cursor:"pointer",color:T.danger,fontSize:14,padding:"0 2px"}}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(ps.products||[]).length===0&&<div style={{padding:"12px 16px",fontSize:12,color:T.inkMute,fontStyle:"italic"}}>Aucun produit dans cette section.</div>}
              </div>
            ))}
          </>
        )}

        {/* ── ORDERS TAB ── */}
        {tab==="orders"&&(
          <>
            {orders.length > 0 && <AdminOrderKPIs orders={orders} />}
            <AdminRelais adminFetch={adminFetch} flash={flash} />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:12,color:T.inkSoft}}>
                <span style={{fontWeight:700,color:T.petrol}}>{orders.filter(o=>!o.processed).length}</span> en attente · <span style={{color:T.inkMute}}>{orders.filter(o=>o.processed).length} traitée(s)</span>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={syncAllPending} disabled={syncingAll||bulkPending.length===0} title="Commandes en attente sans envoi partiel (le reste d'une commande partielle part par son bouton « Sync le reste »)" style={{background:T.petrol,border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"white",opacity:syncingAll||bulkPending.length===0?0.4:1}}>
                  {syncingAll ? "⏳ Sync en cours…" : `🔁 Sync toutes (${bulkPending.length})`}
                </button>
                <button onClick={refreshOrders} style={{background:T.surface2,border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:T.inkSoft}}>🔄 Actualiser</button>
                <button onClick={exportOrdersXlsx} style={{background:T.ok,border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700,color:"white"}}>📥 Export Excel</button>
              </div>
            </div>
            {orders.length===0&&(
              <div style={{textAlign:"center",padding:"40px 20px",color:T.inkMute,fontSize:13}}>
                Aucune commande reçue pour le moment.
              </div>
            )}
            {orders.map(o=>(
              <div key={o.id} style={{
                borderRadius:12,marginBottom:10,overflow:"hidden",
                border: o.processed?"1px solid var(--line)":"2px solid var(--teal)",
                background: o.processed?T.paper:T.mint,
              }}>
                <div style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:14,color:T.petrol}}>{o.pharmacyName}</span>
                        {o.avisAuto?.code === "double" && !o.processed && <span title={o.avisAuto.error} style={{background:T.dangerBg,color:T.danger,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>⚠ POSSIBLE DOUBLON{o.avisAuto.doubleDe ? ` de n° ${o.avisAuto.doubleDe}` : ""} : à vérifier</span>}
                        {o.source === "a_verifier" && <span title="Envoyée sans connexion par une page ouverte avant le correctif de sécurité du 19/10/2026 : identité NON vérifiée. Confirmez par téléphone avec la pharmacie avant de la saisir (Commander pour une pharmacie)." style={{background:T.dangerBg,color:T.danger,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>⚠ À VÉRIFIER PAR TÉLÉPHONE</span>}
                        {o.enteredBy && <span title={`Saisie par ${o.enteredBy}`} style={{background:tone("acting").bg,color:tone("acting").fg,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>🛠 SAISIE ELIXIR</span>}
                        {o.source === "justificatif" && <span title={`Commande sur justificatif labo : à synchroniser à réception de la marchandise.${(o.justif||[]).map(j => ` ${j.lab} : ${j.statut}${j.poNom ? ` (${j.poNom})` : ""}${j.motif ? ` — ${j.motif}` : ""}`).join(" ;")}`}
                          style={{background:tone("labo").bg,color:tone("labo").fg,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>📑 JUSTIFICATIF LABO{(o.justif||[]).length ? ` · ${(o.justif||[]).map(j => j.statut === "envoye" ? `envoyé ${j.poNom || ""}`.trim() : j.statut.replace("_", " ")).join(", ")}` : ""}</span>}
                        {o.source === "justificatif" && !(o.justif||[]).length && (
                          <button title="La demande au laboratoire n'a pas été créée (session expirée, panne…). Elle sera créée « à vérifier » dans l'onglet Justificatifs labos."
                            onClick={async () => {
                              try {
                                const r = await adminFetch("/.netlify/functions/lab-justif", { method: "POST", body: JSON.stringify({ action: "submit", order_id: o.id, lignes: [] }) });
                                const j = await r.json().catch(() => ({}));
                                if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
                                setOrders(prev => prev.map(x => x.id === o.id ? { ...x, justif: (j.demandes || []).map(d => ({ lab: d.id.split("-").pop(), statut: d.statut || "a_verifier" })) } : x));
                                flash("✓ Demande labo créée : à vérifier dans l'onglet Justificatifs labos");
                              } catch (e) { flash(`⚠ ${e.message}`); }
                            }}
                            style={{background:tone("acting").bg,color:tone("acting").fg,border:`1px solid ${tone("acting").border}`,fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,cursor:"pointer"}}>⚠ demande labo non créée — créer</button>
                        )}
                        {o.processed
                          ? <span style={{background:T.okBg,color:T.ok,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>✓ TRAITÉE</span>
                          : (o.items||[]).some(lineDone)
                            ? <span style={{background:T.warnBg,color:T.warn,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:10}}>PARTIELLE · {[
                                (o.items||[]).filter(it=>it?.synced_at).length ? `${(o.items||[]).filter(it=>it?.synced_at).length} ENVOYÉE(S)` : "",
                                (o.items||[]).filter(it=>it?.handled_at && !it?.synced_at).length ? `${(o.items||[]).filter(it=>it?.handled_at && !it?.synced_at).length} TRAITÉE(S) SANS ENVOI` : ""].filter(Boolean).join(" · ")} / {(o.items||[]).length} LIGNES</span>
                            : <span style={{background:T.surface,color:T.teal,border:`1px solid ${T.mint2}`,fontSize:11,fontWeight:700,padding:"1px 7px",borderRadius:10}}>EN ATTENTE</span>
                        }
                      </div>
                      <div style={{fontSize:11,color:T.inkSoft,marginTop:3}}>
                        {o.pharmacyEmail} · {new Date(o.date).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
                      </div>
                      <div style={{fontSize:11,color:T.inkMute,marginTop:2}}>
                        {o.nbLignes} référence(s) · Total : <strong>{o.totalHt?.toFixed(2)} €</strong>
                      </div>
                      {(o.relais||[]).length > 0 && <RelaisCommande taches={o.relais} adminFetch={adminFetch} flash={flash} onChange={refreshOrders} />}
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      {/* Sync button + status */}
                      {syncStatus[o.id]==="pending" && <span style={{fontSize:11,color:T.teal,fontWeight:700,padding:"6px 4px"}}>⏳ Sync…</span>}
                      {syncStatus[o.id]==="ok" && <span style={{fontSize:11,color:T.ok,fontWeight:700,padding:"6px 4px"}}>✓ Envoyée</span>}
                      {String(syncStatus[o.id]||"").startsWith("partielle:") && <span style={{fontSize:11,color:T.ok,fontWeight:700,padding:"6px 4px"}}>✓ {syncStatus[o.id].split(":")[1]} ligne(s) envoyée(s)</span>}
                      {String(syncStatus[o.id]||"").startsWith("traitees:") && <span style={{fontSize:11,color:T.ok,fontWeight:700,padding:"6px 4px"}}>✓ {syncStatus[o.id].split(":")[1]} ligne(s) traitée(s)</span>}
                      {syncStatus[o.id] && syncStatus[o.id]!=="pending" && syncStatus[o.id]!=="ok" && !/^(partielle|traitees):/.test(String(syncStatus[o.id])) && (
                        <span title={syncStatus[o.id]} style={{fontSize:11,color:T.danger,fontWeight:700,padding:"6px 4px",cursor:"help",maxWidth:300,display:"inline-block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>⚠️ {syncStatus[o.id]}</span>
                      )}
                      {!o.processed && syncStatus[o.id]!=="pending" && (lineSel[o.id]||[]).length>0 && (
                        <button onClick={()=>syncOrder(o, lineSel[o.id])} title="Envoyer seulement les lignes cochées" style={{background:"#7c3aed",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:"white",fontWeight:700}}>
                          🔁 Sync sélection ({lineSel[o.id].length})
                        </button>
                      )}
                      {!o.processed && syncStatus[o.id]!=="pending" && (lineSel[o.id]||[]).length>0 && (
                        <button onClick={()=>markLines(o, lineSel[o.id], true)} title="Marquer les lignes cochées comme traitées, SANS les envoyer à PharmaML" style={{background:T.okBg,border:"1px solid #86efac",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:T.ok,fontWeight:700}}>
                          ✓ Traiter sélection ({lineSel[o.id].length})
                        </button>
                      )}
                      {!o.processed && syncStatus[o.id]!=="pending" && (
                        <button onClick={()=>syncOrder(o)} title="Envoyer toutes les lignes pas encore transmises" style={{background:T.teal,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:"white",fontWeight:700}}>
                          🔁 {(o.items||[]).some(lineDone) ? `Sync le reste (${(o.items||[]).filter(it=>!lineDone(it)).length})` : "Sync"}
                        </button>
                      )}
                      <button onClick={()=>downloadCsv(o)} title="Télécharger CSV" style={{background:T.petrol,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:"white",fontWeight:700}}>⬇ CSV</button>
                      <button onClick={()=>toggleProcessed(o.id)} style={{
                        background:o.processed?T.surface2:T.okBg,border:"none",borderRadius:8,
                        padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:700,
                        color:o.processed?T.inkMute:T.ok
                      }}>{o.processed?"↩ Rouvrir":"✓ Traiter"}</button>
                      <button onClick={()=>{ if(window.confirm("Supprimer cette commande ?")) deleteOrder(o.id); }} style={{background:T.dangerBg,border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:13,color:T.danger}}>🗑</button>
                    </div>
                  </div>
                  {/* Sélection des lignes à envoyer (commande en attente) */}
                  {!o.processed && (o.items||[]).length > 1 && (() => {
                    const rest = (o.items||[]).map((it,i)=>i).filter(i=>!lineDone(o.items[i]));
                    const inSt = rest.filter(i=>orderStock[o.items[i]?.cip]===true), pre = rest.filter(i=>orderStock[o.items[i]?.cip]===false);
                    const pick = (arr) => setLineSel(sel=>({...sel,[o.id]:arr}));
                    const link = {background:"none",border:"none",color:T.teal,cursor:"pointer",fontSize:11,fontWeight:700,padding:"0 4px"};
                    return (
                      <div style={{marginTop:8,fontSize:11,color:T.inkSoft,display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
                        <span>Cocher :</span>
                        <button style={link} disabled={!inSt.length} onClick={()=>pick(inSt)}>en stock ({inSt.length})</button>·
                        <button style={link} disabled={!pre.length} onClick={()=>pick(pre)}>précommande ({pre.length})</button>·
                        <button style={link} onClick={()=>pick(rest)}>tout</button>·
                        <button style={link} onClick={()=>pick([])}>rien</button>
                      </div>
                    );
                  })()}
                  {/* Items preview */}
                  <div style={{marginTop:10,background:T.surface,borderRadius:8,padding:"8px 10px",fontSize:11,color:T.inkSoft,maxHeight:!o.processed?260:140,overflowY:"auto"}}>
                    {(() => {
                      const campAdmin = campaigns.find(cp => cp.id === o.source);
                      const hasUG = campAdmin && o.items?.some(item => calcUgAdmin(item.name||'', item.qty||0, campAdmin) > 0);
                      return (<>
                        <div style={{display:"flex",padding:"0 0 5px 0",borderBottom:"2px solid var(--line)",marginBottom:4,fontWeight:700,fontSize:11,color:T.inkMute,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                          {(!o.processed || (o.items||[]).some(it=>it?.handled_at)) && <span style={{width:22,flexShrink:0}} />}
                          <span style={{fontFamily:"monospace",width:110,flexShrink:0}}>CIP13</span>
                          <span style={{flex:1}}>Désignation</span>
                          <span style={{width:30,textAlign:"right"}}>Qté</span>
                          {hasUG && <span style={{width:36,textAlign:"right",marginLeft:6,color:T.ok}}>UG</span>}
                          <span style={{width:55,textAlign:"right",marginLeft:10}}>PU HT</span>
                          <span style={{width:60,textAlign:"right",marginLeft:10}}>Total HT</span>
                        </div>
                        {o.items?.map((item,i)=>{
                          const ug = campAdmin ? calcUgAdmin(item.name||'', item.qty||0, campAdmin) : 0;
                          return (
                            <div key={i} style={{display:"flex",alignItems:"center",padding:"3px 0",borderBottom:i<o.items.length-1?"1px solid var(--line-soft)":"none",opacity:lineDone(item)&&(!o.processed||(o.items||[]).some(it=>it?.handled_at))?0.55:1}}>
                              {(!o.processed || (o.items||[]).some(it=>it?.handled_at)) && <span style={{width:22,flexShrink:0}}>
                                {item.synced_at ? <span title={`Envoyée le ${new Date(item.synced_at).toLocaleString("fr-FR")} (réf. ${item.synced_ref})`} style={{color:T.ok,fontWeight:700}}>✓</span>
                                  : item.handled_at ? <span title={`Traitée sans envoi le ${new Date(item.handled_at).toLocaleString("fr-FR")}`} style={{color:T.inkMute,fontWeight:700}}>✓</span>
                                  : o.processed ? null : <input type="checkbox" aria-label={`Envoyer ${item.name}`} checked={(lineSel[o.id]||[]).includes(i)}
                                      onChange={e=>setLineSel(sel=>{ const cur=sel[o.id]||[]; return {...sel,[o.id]: e.target.checked ? [...cur,i] : cur.filter(x=>x!==i)}; })} />}
                              </span>}
                              <span style={{width:110,flexShrink:0}}><CipCopy cip={item.cip}/></span>
                              <span style={{flex:1,paddingRight:8}}>{item.name}
                                {/* péremption courte (src/peremption-panier.js) : ligne commandée depuis la page, date du lot ; prix habituel */}
                                {estPeremption(item) && <span title={`Commandée depuis la page Péremption courte : lot au ${datePeremption(item.peremption)} (prix habituel, sans remise péremption)`} style={{marginLeft:6,fontSize:11,fontWeight:700,borderRadius:4,padding:"1px 5px",background:tone("warn").bg,color:tone("warn").fg}}>{notePeremption(item.peremption)}</span>}
                                {!o.processed && !lineDone(item) && orderStock[item.cip]!==undefined && <span style={{marginLeft:6,fontSize:11,fontWeight:700,borderRadius:4,padding:"1px 5px",background:orderStock[item.cip]?T.okBg:tone("acting").bg,color:orderStock[item.cip]?T.ok:tone("acting").fg}}>{orderStock[item.cip]?"EN STOCK":"PRÉCOMMANDE"}</span>}
                                {item.synced_at && (!o.processed || (o.items||[]).some(it=>it?.handled_at)) && <span style={{marginLeft:6,fontSize:11,color:T.ok,fontWeight:700}}>envoyée · réf. {item.synced_ref}</span>}
                                {!item.synced_at && item.handled_at && <span style={{marginLeft:6,fontSize:11,color:T.inkSoft,fontWeight:700}}>traitée sans envoi
                                  <button onClick={()=>markLines(o,[i],false)} disabled={syncStatus[o.id]==="pending"} style={{marginLeft:4,background:"none",border:"none",color:T.teal,cursor:"pointer",fontSize:11,fontWeight:700,padding:0,textDecoration:"underline"}}>annuler</button></span>}
                              </span>
                              <span style={{fontWeight:700,width:30,textAlign:"right"}}>{item.qty}</span>
                              {hasUG && <span style={{width:36,textAlign:"right",marginLeft:6,color:ug>0?T.ok:T.inkFaint,fontWeight:ug>0?800:400}}>{ug>0?`+${ug}`:"—"}</span>}
                              <span style={{color:T.inkSoft,width:55,textAlign:"right",marginLeft:10}}>{item.pn!=null?item.pn.toFixed(2)+" €":"—"}</span>
                              <span style={{fontWeight:700,color:T.petrol,width:60,textAlign:"right",marginLeft:10}}>{item.total!=null?item.total.toFixed(2)+" €":"—"}</span>
                            </div>
                          );
                        })}
                        {hasUG && (
                          <div style={{marginTop:6,padding:"4px 6px",background:T.okBg,borderRadius:6,fontSize:11,color:T.ok,fontWeight:700}}>
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
              <div style={{fontWeight:700,fontSize:13,color:T.inkSoft}}>Campagne :</div>
              <input value={selectedCampaign} onChange={e=>setSelectedCampaign(e.target.value)}
                placeholder="ex: ulabs"
                style={{...IS,width:140,display:"inline-block"}}/>
              <button onClick={()=>fetchGroupCampaignOrders(selectedCampaign)} style={{
                background:T.petrol,color:"white",border:"none",borderRadius:8,
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
                }} style={{background:T.ok,color:"white",border:"none",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                  ⬇️ Exporter CSV
                </button>
              )}
              {gcOrders.length>0&&(
                <button onClick={async()=>{
                  if(!confirm(`Vider toutes les commandes de la campagne "${selectedCampaign}" ?`)) return;
                  const pharmacies = [...new Set(gcOrders.map(r=>r.pharmacy_cip))];
                  for(const pc of pharmacies){
                    await adminFetch(`/.netlify/functions/group-order?fournisseur=${encodeURIComponent(selectedCampaign)}&pharmacy_cip=${encodeURIComponent(pc)}`,{method:"DELETE"});
                  }
                  fetchGroupCampaignOrders(selectedCampaign);
                }} style={{background:T.danger,color:"white",border:"none",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                  🗑️ Vider la campagne
                </button>
              )}
            </div>

            {gcOrdersLoading&&<div style={{textAlign:"center",padding:24,color:T.inkMute}}>Chargement…</div>}

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
                      {label:"Pharmacies",val:totalPharm,bg:T.mint,color:T.teal},
                      {label:"Unités commandées",val:totalUnites,bg:T.okBg,color:T.ok},
                      {label:"Références",val:new Set(gcOrders.map(r=>r.cip)).size,bg:T.warnBg,color:T.warn},
                    ].map(s=>(
                      <div key={s.label} style={{background:s.bg,borderRadius:12,padding:"12px 20px",flex:1,minWidth:120,textAlign:"center"}}>
                        <div style={{fontWeight:700,fontSize:24,color:s.color}}>{s.val}</div>
                        <div style={{fontSize:11,color:T.inkSoft}}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Vue par pharmacie */}
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {pharmacies.map(ph=>(
                      <div key={ph.cip} style={{border:"1px solid var(--line)",borderRadius:12,overflow:"hidden"}}>
                        <div style={{background:T.petrol,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontWeight:700,color:"white",fontSize:14}}>{ph.name}</div>
                          <div style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>
                            {ph.lines.length} réf. · {ph.lines.reduce((s,r)=>s+(parseInt(r.qty)||0),0)} unités
                          </div>
                        </div>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <thead>
                            <tr style={{background:T.paper}}>
                              {["CIP","Quantité","Modifié le"].map(h=>(
                                <th key={h} style={{padding:"7px 12px",textAlign:"left",fontSize:11,color:T.inkSoft,fontWeight:700,borderBottom:"1px solid var(--line)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ph.lines.sort((a,b)=>b.qty-a.qty).map(r=>(
                              <tr key={r.cip} style={{borderBottom:"1px solid var(--line-soft)"}}>
                                <td style={{padding:"7px 12px",fontSize:12,color:T.ink}}>{cipToName[r.cip] || r.cip}</td>
                                <td style={{padding:"7px 12px",fontSize:13,fontWeight:700,color:T.petrol}}>{r.qty}</td>
                                <td style={{padding:"7px 12px",fontSize:11,color:T.inkMute}}>{r.updated_at?new Date(r.updated_at).toLocaleString("fr-FR"):"-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>

                  {/* Récap par produit */}
                  <div style={{marginTop:20}}>
                    <div style={{fontWeight:700,fontSize:14,color:T.petrol,marginBottom:10}}>Récapitulatif par produit</div>
                    <table style={{width:"100%",borderCollapse:"collapse",background:T.surface,borderRadius:10,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,0.06)"}}>
                      <thead>
                        <tr style={{background:T.petrol}}>
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
                            <tr key={cip} style={{borderBottom:"1px solid var(--line-soft)"}}>
                              <td style={{padding:"8px 14px",fontSize:12,color:T.ink}}>{cipToName[cip] || cip}</td>
                              <td style={{padding:"8px 14px",fontSize:11,fontFamily:"monospace",color:T.inkMute}}>{cip}</td>
                              <td style={{padding:"8px 14px",fontSize:14,fontWeight:700,color:T.ok}}>{total}</td>
                              <td style={{padding:"8px 14px",fontSize:12,color:T.inkMute}}>{nbP}</td>
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
              <div style={{textAlign:"center",padding:40,color:T.inkMute,fontSize:14}}>
                Aucune commande pour cette campagne. Cliquez sur "Charger" pour voir les données.
              </div>
            )}
          </div>
        )}
        {tab==="gp"&&(
          <AdminGroupPurchases adminFetch={adminFetch} flash={flash} onDirtyChange={onGpDirty} />
        )}
        {tab==="justif"&&(
          <AdminLabJustif adminFetch={adminFetch} flash={flash} syncStatus={syncStatus}
            onSync={(orderId, cips) => {   // lignes de la demande seulement (une commande peut porter plusieurs labos)
              const o = ordersRef.current.find(x => String(x.id) === String(orderId));
              if (!o) { flash("⚠ Commande introuvable dans la liste : actualisez l'onglet Commandes"); return; }
              const idx = (o.items || []).map((it, i) => (cips || []).includes(String(it?.cip)) ? i : -1).filter(i => i >= 0);
              if (!idx.length) { flash("⚠ Lignes de cette demande introuvables dans la commande"); return; }
              syncOrder(o, idx);
            }} />
        )}
        {tab==="sanofipro"&&(
          <AdminSanofiPro adminFetch={adminFetch} flash={flash} />
        )}
        {tab==="assistant"&&(
          <AdminAssistant adminFetch={adminFetch} flash={flash} onDirtyChange={onAssistantDirty} />
        )}
        {tab==="campaigns"&&(
          <AdminCampaigns campaigns={campaigns} setCampaigns={setCampaigns} adminFetch={adminFetch} flash={flash} />
        )}
        {tab==="pharmacies"&&(
          <div style={{padding:"0 4px"}}>
            {/* ── Sync Odoo ── */}
            <div style={{background:T.okBg,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${tone("ok").border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:T.ok}}>🔄 Synchronisation depuis Odoo</div>
                <div style={{fontSize:11,color:T.ok,marginTop:2}}>Met à jour toutes les pharmacies depuis Odoo (partenaires actifs avec email)</div>
              </div>
              <button onClick={syncPharmacies} disabled={pharmSyncing} style={{background:T.ok,color:"white",border:"none",borderRadius:10,padding:"9px 18px",fontWeight:700,fontSize:13,cursor:"pointer",opacity:pharmSyncing?0.6:1}}>
                {pharmSyncing?"⏳ Sync…":"🔄 Lancer la sync"}
              </button>
            </div>

            {/* ── Recherche ── */}
            <div style={{background:T.surface,borderRadius:12,padding:16,marginBottom:16,border:"1.5px solid var(--line)"}}>
              <div style={{fontWeight:700,fontSize:14,color:T.ink,marginBottom:10}}>🔍 Rechercher une pharmacie</div>
              <div style={{display:"flex",gap:8}}>
                <input value={pharmSearch} onChange={e=>setPharmSearch(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&searchPharm(pharmSearch)}
                  placeholder="Email ou nom…" style={{...IS,flex:1}}/>
                <button onClick={()=>searchPharm(pharmSearch)} disabled={pharmSearching} style={{background:T.teal,color:"white",border:"none",borderRadius:10,padding:"9px 16px",fontWeight:700,cursor:"pointer"}}>
                  {pharmSearching?"…":"Chercher"}
                </button>
              </div>
              {pharmResults.length > 0 && (
                <div style={{marginTop:10}}>
                  {pharmResults.map((p,i)=>(
                    <div key={i} style={{padding:"8px 12px",borderBottom:"1px solid var(--line-soft)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13}}>{p.name}</div>
                        <div style={{fontSize:11,color:T.inkMute}}>{p.email} · CIP : {p.cip||"—"} · {p.ville||"—"}</div>
                      </div>
                      <button onClick={()=>setPharmManual({...p})} style={{fontSize:11,background:T.surface2,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>✏️ Éditer</button>
                    </div>
                  ))}
                </div>
              )}
              {pharmResults.length === 0 && pharmSearch && !pharmSearching && (
                <div style={{marginTop:8,fontSize:12,color:T.danger}}>Aucun résultat — ajoutez-la manuellement ci-dessous</div>
              )}
            </div>

            {/* ── Ajout / édition manuel ── */}
            <div style={{background:T.surface,borderRadius:12,padding:16,border:"1.5px solid var(--line)"}}>
              <div style={{fontWeight:700,fontSize:14,color:T.ink,marginBottom:12}}>➕ Ajouter / modifier manuellement</div>
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
          <ShortExpiry isAdmin={true} onAddToCart={() => {}} adminFetch={adminFetch} admin={PEREMPTIONS_ADMIN} />
        )}

        {/* ── DISPLAY TAB ── */}
        {tab==="display"&&(
          <AdminDisplay
            displayConfig={displayConfig} saveDisplayConfig={saveDisplayConfig}
            orderedKeys={orderedKeys} allMeta={allMeta} allSectionKeys={allSectionKeys}
            hiddenTabs={hiddenTabs} defaultTab={defaultTab}
            syncConfigToSupabase={syncConfigToSupabase} flash={flash} setTab={setTab} adminFetch={adminFetch}
            promos={promos} onVedettesDirty={onVedettesDirty} majAccueil={majAccueil}
          />
        )}

        {/* ── SYNC TAB ── */}
        {tab==="sync"&&(
          <div>
            <div style={{fontWeight:700,fontSize:18,color:T.petrol,marginBottom:24}}>Synchronisation Odoo → Supabase</div>

            {/* Stock sync */}
            <div style={{background:T.surface,borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid var(--line)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:T.petrol}}>🔄 Catalogue & Stock</div>
                  <div style={{fontSize:12,color:T.inkMute,marginTop:4}}>Synchronise les produits et le stock depuis Odoo. Exclut les emplacements dont la case <strong>do_not_export</strong> est cochée dans Odoo (ou marqués comme scrap).</div>
                </div>
                <button onClick={handleSyncStock} disabled={syncStock.running}
                  style={{background:T.petrol,color:T.paper,border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:syncStock.running?"default":"pointer",opacity:syncStock.running?0.6:1,whiteSpace:"nowrap"}}>
                  {syncStock.running?"⏳ En cours...":"Lancer le sync"}
                </button>
              </div>
              {syncStock.progress&&<div style={{marginTop:12,fontSize:12,color:syncStock.progress.startsWith("✓")?T.ok:T.inkMute,fontWeight:600,background:T.paper,borderRadius:8,padding:"8px 12px"}}>{syncStock.progress}</div>}
            </div>

            {/* Audit emplacements */}
            <div style={{background:T.surface,borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid var(--line)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:T.petrol}}>🔍 Audit emplacements Odoo</div>
                  <div style={{fontSize:12,color:T.inkMute,marginTop:4}}>Liste tous les emplacements internes (company 2) et vérifie ceux qui sont exclus du sync stock. Affiche le nombre de quants par emplacement.</div>
                </div>
                <button onClick={handleAuditLocations} disabled={audit.running}
                  style={{background:T.inkSoft,color:T.paper,border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:audit.running?"default":"pointer",opacity:audit.running?0.6:1,whiteSpace:"nowrap"}}>
                  {audit.running?"⏳ Analyse...":"Lancer l'audit"}
                </button>
              </div>
              {audit.error&&<div style={{marginTop:12,fontSize:12,color:T.danger,fontWeight:600,background:T.dangerBg,borderRadius:8,padding:"8px 12px"}}>Erreur : {audit.error}</div>}
              {audit.data&&(
                <div style={{marginTop:16}}>
                  {/* Résumé */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:16}}>
                    <div style={{background:T.paper,borderRadius:8,padding:"10px 12px",border:"1px solid var(--line)"}}>
                      <div style={{fontSize:11,color:T.inkMute,fontWeight:600}}>Total emplacements</div>
                      <div style={{fontSize:20,fontWeight:700,color:T.petrol,marginTop:2}}>{audit.data.summary.total_locations}</div>
                    </div>
                    <div style={{background:T.dangerBg,borderRadius:8,padding:"10px 12px",border:`1px solid ${tone("danger").border}`}}>
                      <div style={{fontSize:11,color:T.danger,fontWeight:600}}>Exclus</div>
                      <div style={{fontSize:20,fontWeight:700,color:T.danger,marginTop:2}}>{audit.data.summary.excluded}</div>
                      <div style={{fontSize:11,color:T.danger,marginTop:2}}>{audit.data.summary.total_quants_excluded} quants</div>
                    </div>
                    <div style={{background:T.okBg,borderRadius:8,padding:"10px 12px",border:`1px solid ${tone("ok").border}`}}>
                      <div style={{fontSize:11,color:T.ok,fontWeight:600}}>Inclus dans le stock</div>
                      <div style={{fontSize:20,fontWeight:700,color:T.ok,marginTop:2}}>{audit.data.summary.included}</div>
                      <div style={{fontSize:11,color:T.ok,marginTop:2}}>{audit.data.summary.total_quants_included} quants</div>
                    </div>
                    <div style={{background:T.warnBg,borderRadius:8,padding:"10px 12px",border:`1px solid ${tone("warn").border}`}}>
                      <div style={{fontSize:11,color:T.warn,fontWeight:600}}>Détail exclusions</div>
                      <div style={{fontSize:12,color:T.warn,marginTop:4,lineHeight:1.5}}>
                        do_not_export : {audit.data.summary.excluded_by_do_not_export}<br/>
                        scrap : {audit.data.summary.excluded_by_scrap}
                      </div>
                    </div>
                  </div>

                  {/* Règles appliquées */}
                  <div style={{background:T.paper,borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:T.inkSoft,border:"1px solid var(--line)"}}>
                    <strong>Règle d'exclusion :</strong> un emplacement est exclu du sync stock si <code style={{background:T.surface,padding:"1px 5px",borderRadius:3,border:"1px solid var(--line)"}}>do_not_export = true</code> OU <code style={{background:T.surface,padding:"1px 5px",borderRadius:3,border:"1px solid var(--line)"}}>scrap_location = true</code>.<br/>
                    Pour modifier l'exclusion : ouvre la fiche emplacement dans Odoo et coche/décoche la case <strong>"Do not export"</strong>. Plus besoin de toucher au code.
                  </div>

                  {/* Tableau */}
                  <div style={{maxHeight:480,overflow:"auto",border:"1px solid var(--line)",borderRadius:8}}>
                    <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                      <thead style={{position:"sticky",top:0,background:T.petrol,color:"white",zIndex:1}}>
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
                          <tr key={loc.id} style={{background:loc.excluded?T.dangerBg:T.surface,borderBottom:"1px solid var(--line-soft)"}}>
                            <td style={{padding:"6px 10px",fontWeight:700,color:loc.excluded?T.danger:T.ok,whiteSpace:"nowrap"}}>
                              {loc.excluded?"❌ Exclu":"✓ Inclus"}
                            </td>
                            <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:11}}>{loc.complete_name}</td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontSize:14}}>{loc.do_not_export?"☑":"☐"}</td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontSize:14}}>{loc.scrap_location?"☑":"☐"}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600}}>{loc.quants_count}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontSize:11}}>{loc.total_quantity}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:T.inkMute}}>{loc.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Price sync */}
            <div style={{background:T.surface,borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid var(--line)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:T.petrol}}>💰 Prix remisés (Liste de prix EUR 2)</div>
                  <div style={{fontSize:12,color:T.inkMute,marginTop:4}}>Synchronise les 7 376 règles de prix depuis Odoo. Nécessite un sync stock préalable. ~2 minutes.</div>
                </div>
                <button onClick={handleSyncPrice} disabled={syncPrice.running}
                  style={{background:T.petrol,color:T.paper,border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:syncPrice.running?"default":"pointer",opacity:syncPrice.running?0.6:1,whiteSpace:"nowrap"}}>
                  {syncPrice.running?"⏳ En cours...":"Lancer le sync"}
                </button>
              </div>
              {syncPrice.progress&&<div style={{marginTop:12,fontSize:12,color:syncPrice.progress.startsWith("✓")?T.ok:T.inkMute,fontWeight:600,background:T.paper,borderRadius:8,padding:"8px 12px"}}>{syncPrice.progress}</div>}
            </div>

            {/* Expiry sync */}
            <div style={{background:T.surface,borderRadius:14,padding:"24px",marginBottom:16,border:"1px solid var(--line)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:T.petrol}}>⏰ Péremptions & Lots</div>
                  <div style={{fontSize:12,color:T.inkMute,marginTop:4}}>Synchronise les dates de péremption et les lots pour chaque produit en stock. Le bouton se trouve dans l'onglet Péremptions.</div>
                </div>
                <button onClick={()=>setTab("expiry")}
                  style={{background:T.surface2,color:T.petrol,border:"1px solid var(--line)",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                  Aller à Péremptions →
                </button>
              </div>
            </div>

            {/* Info */}
            <div style={{background:T.mint,borderRadius:14,padding:"16px 20px",border:"1px solid var(--mint-2)",fontSize:12,color:T.teal,lineHeight:1.6}}>
              <strong>Ordre recommandé :</strong> 1. Stock → 2. Prix → 3. Péremptions<br/>
              Le sync stock charge les produits et quantités. Le sync prix associe les remises de la liste de prix EUR 2. Le sync péremptions charge les lots et dates d'expiration pour les produits en stock.
            </div>
          </div>
        )}

        {/* ── ALERTES RETOUR EN STOCK (« M'avertir du retour » de la Saisie : docs/alertes-retour.md) ── */}
        {tab==="alertes"&&(
          <AdminAlertesRetour adminFetch={adminFetch} flash={flash} />
        )}

        {/* ── SEARCH ML TAB ── */}
        {tab==="search_ml"&&(
          <AdminSearchML adminFetch={adminFetch} />
        )}

        </div>
      </div>
      {saved&&<div role="status" style={{position:"fixed",bottom:24,right:24,background:T.petrol,color:T.paper,borderRadius:12,padding:"12px 20px",fontWeight:700,fontSize:13,boxShadow:T.shadow2,zIndex:2000}}>{saved}</div>}
    </div>
  );
}

// ── Atomes de l'admin (lot 10) : communs à AdminAdd, AdminEdit, AdminCampaigns, AdminGroupPurchases (src/theme.js) ──
// OV et MO (fenêtre et voile) ne servaient nulle part : retirés.
const CB=adm.fermer;
const LS=adm.label;
const IS=adm.input;
const PB=adm.btn;
