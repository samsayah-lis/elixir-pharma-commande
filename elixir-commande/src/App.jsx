import React, { useState, useMemo, useEffect, useCallback } from "react";
import emailjs from "@emailjs/browser";
import { EMAILJS_CONFIG, DEFAULT_RECIPIENT } from "./emailjsConfig";
import AdminPanel from "./AdminPanel";

const SECTION_META = {
  expert:   { label: "Sélection Expert",      subtitle: "Médicaments chers – Abandon de marge fixe 30€/boîte",        color: "#1a3a4a", accent: "#2d7d9a", icon: "💊", columns: ["CIP13","Désignation","Prix Vente","Remise %","Remise €","Prix net"] },
  stratege: { label: "Sélection Stratège",     subtitle: "Cartons standard – Top 50 rotations nationales",              color: "#2d5a27", accent: "#4a9e42", icon: "📦", columns: ["CIP","Désignation","Colis","Prix","Remise %","Remise €","Prix net","Prix carton"] },
  master:   { label: "Sélection Master",       subtitle: "Parapharmacie – Top marques sélectionnées",                   color: "#7c3a00", accent: "#c2692d", icon: "🌿", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  obeso:    { label: "Mounjaro / Wegovy",       subtitle: "Traitements de l'obésité",                                    color: "#4a1a7a", accent: "#8b5cf6", icon: "⚖️",  columns: ["CIP","Désignation","Qté","PV","Remise","PN"] },
  nr:       { label: "Autres NR",              subtitle: "Médicaments non remboursés",                                   color: "#1a3a5a", accent: "#3b82f6", icon: "🔵", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  molnlycke:{ label: "Offre Mölnlycke",        subtitle: "Matériel médical – pansements & soins",                        color: "#1a4a3a", accent: "#10b981", icon: "🩹", columns: ["CIP","Désignation","Colis","PV","Remise %","Remise €","PN","Prix carton"] },
  blanche:  { label: "Gamme Blanche",          subtitle: "Génériques & médicaments courants",                            color: "#3a3a3a", accent: "#6b7280", icon: "🏷️",  columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  covid:    { label: "Diagnostic & Covid",     subtitle: "Tests & traitements Covid",                                    color: "#1a2a5a", accent: "#6366f1", icon: "🧪", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  otc:      { label: "Centrale OTC / Para",    subtitle: "Vente libre & parapharmacie centrale",                         color: "#5a1a1a", accent: "#ef4444", icon: "🛒", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  ulabs:    { label: "Commande groupée U-Labs",       subtitle: "dont 3 références Parogencyl obligatoires · Fluocaril · Parogencyl · Regenerate",       color: "#0d4f3c", accent: "#059669", icon: "🤝", columns: [] },
};
const fmt = (n) => n != null ? n.toFixed(2).replace(".", ",") + " €" : "–";
// Jours fériés France (récurrents + Pâques/Ascension/Pentecôte calculés)
const getFrenchHolidays = (year) => {
  // Pâques (algorithme de Meeus/Jones/Butcher)
  const a = year % 19, b = Math.floor(year/100), c = year % 100;
  const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
  const i = Math.floor(c/4), k = c % 4;
  const l = (32+2*e+2*i-h-k) % 7;
  const m = Math.floor((a+11*h+22*l)/451);
  const month = Math.floor((h+l-7*m+114)/31);
  const day = ((h+l-7*m+114) % 31) + 1;
  const easter = new Date(year, month-1, day);
  const d1 = (dt, dd) => { const x = new Date(dt); x.setDate(x.getDate()+dd); return x; };
  return [
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`,
    `${year}-07-14`, `${year}-08-15`, `${year}-11-01`,
    `${year}-11-11`, `${year}-12-25`,
    // Pâques + lundi, Ascension, Pentecôte + lundi
    d1(easter,1).toISOString().slice(0,10),
    d1(easter,39).toISOString().slice(0,10),
    d1(easter,49).toISOString().slice(0,10),
    d1(easter,50).toISOString().slice(0,10),
  ];
};

const nextBusinessDay = () => {
  const d = new Date();
  // Si après 14h, on passe au lendemain d'emblée
  if (d.getHours() >= 14) d.setDate(d.getDate() + 1);
  else d.setDate(d.getDate() + 1);
  const holidays = getFrenchHolidays(d.getFullYear());
  let safety = 0;
  while (safety++ < 10) {
    const day = d.getDay();
    const iso = d.toISOString().slice(0,10);
    if (day !== 0 && day !== 6 && !holidays.includes(iso)) break;
    d.setDate(d.getDate() + 1);
    if (!holidays.includes(d.toISOString().slice(0,10)) && getFrenchHolidays(d.getFullYear())) {}
  }
  return d.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
};

const GRID_SECTIONS = ["otc", "molnlycke", "obeso", "covid", "blanche", "nr", "ulabs"];

const fmtPct = (pct) => {
  if (pct == null || pct === "" || pct === "–") return "–";
  const n = Math.abs(parseFloat(String(pct).replace(/[^0-9.-]/g, "")));
  if (isNaN(n) || n === 0) return "–";
  return `-${n % 1 === 0 ? n : n.toFixed(2)} %`;
};

// ── Copy CIP button ──────────────────────────────────────────────────────────
function CipCell({ cip }) {
  const [copied, setCopied] = React.useState(false);
  if (!cip || cip === "–") return <span style={{ fontFamily:"monospace", fontSize:11, color:"#bbb" }}>–</span>;
  const copy = () => {
    navigator.clipboard.writeText(cip).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
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

export default function App() {
  const [activeTab, setActiveTab] = useState("expert");
  const [groupOrders, setGroupOrders] = useState([]); // commandes groupées ulabs
  const [groupSaving, setGroupSaving] = useState({});
  const [ulabsConfirming, setUlabsConfirming] = useState(false);
  const [ulabsConfirmed, setUlabsConfirmed] = useState(false);
  const [ulabsPalier, setUlabsPalier] = useState(null); // null | "engage" | "expert"
  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    const tick = () => {
      // Fin dimanche 23:59:59
      const now = new Date();
      const end = new Date(now);
      const day = now.getDay(); // 0=dim
      const daysUntilSun = day === 0 ? 7 : 7 - day;
      end.setDate(now.getDate() + daysUntilSun);
      end.setHours(23, 59, 59, 0);
      const diff = end - now;
      if (diff <= 0) { setCountdown("Terminé"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${d}j ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  const [quantities, setQuantities] = useState(() => { try { return JSON.parse(localStorage.getItem("cart_quantities") || "{}"); } catch { return {}; } });
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [sendStatus, setSendStatus] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);

  // Produits chargés depuis Supabase (source unique de vérité)
  const [dbProducts, setDbProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await fetch("/.netlify/functions/products-get");
      const data = await res.json();
      if (data.products) setDbProducts(data.products);
    } catch(e) { console.warn("[products] fetch error:", e.message); }
    finally { setProductsLoading(false); }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Persiste le panier dans localStorage
  useEffect(() => {
    localStorage.setItem("cart_quantities", JSON.stringify(quantities));
  }, [quantities]);
  const [promoSections, setPromoSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_promos") || "[]"); } catch { return []; }
  });
  const [promoPopupOpen, setPromoPopupOpen] = useState(false);
  const [stockData, setStockData] = useState({}); // { [cip]: { dispo, stock } }
  const [stockUpdatedAt, setStockUpdatedAt] = useState(null);

  // Stock : chargement et actualisation manuelle
  const [stockLoading, setStockLoading] = useState(false);
  const [stockRefreshing, setStockRefreshing] = useState(false); // true = refresh Odoo en cours
  // Charger commandes groupées U-Labs
  const fetchGroupOrders = useCallback(async () => {
    try {
      const res = await fetch("/.netlify/functions/group-order?fournisseur=ulabs");
      const rows = await res.json();
      setGroupOrders(Array.isArray(rows) ? rows : []);
    } catch(e) { console.error(e); }
  }, []);
  useEffect(() => {
    if (activeTab === "ulabs") fetchGroupOrders();
  }, [activeTab, fetchGroupOrders]);

  const [isMobile, setIsMobile] = React.useState(() => window.innerWidth < 768);
  React.useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Lit les stocks depuis Supabase (rapide)
  const fetchStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await fetch("/.netlify/functions/stock-get", { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (data.error) console.warn("[stock] Erreur Odoo:", data.error);
      if (data.stocks) {
        const count = Object.values(data.stocks).filter(s => s.dispo === 0 || s.dispo === false).length;
        console.log(`[stock] ${Object.keys(data.stocks).length} produits, ${count} rupture(s)`);
        setStockData(data.stocks);
        setStockUpdatedAt(data.updatedAt || new Date().toISOString());
      }
    } catch(e) { console.warn("[stock] fetch error:", e.message); }
    finally { setStockLoading(false); }
  }, []);

  // Déclenche la mise à jour Odoo → Supabase (background, ~35s), puis relit depuis Supabase
  const handleRefresh = useCallback(async () => {
    if (stockRefreshing) return;
    setStockRefreshing(true);
    try {
      // Lance le refresh Odoo en background (retourne 202 immédiatement)
      await fetch("/.netlify/functions/stock-refresh-background", { signal: AbortSignal.timeout(5000) });
      console.log("[stock] Refresh Odoo lancé en background, attente 40s…");
      // Attend 40s que la fonction background ait fini d'écrire dans Supabase
      await new Promise(r => setTimeout(r, 40000));
      // Relit les stocks depuis Supabase
      await fetchStock();
    } catch(e) {
      console.warn("[stock] refresh error:", e.message);
      // En cas d'erreur réseau, on relit quand même
      await fetchStock();
    } finally {
      setStockRefreshing(false);
    }
  }, [stockRefreshing, fetchStock]);

  useEffect(() => {
    fetchStock();
    const interval = setInterval(fetchStock, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStock]);

  const CATALOG_WITH_ADMIN = useMemo(() => {
    const merged = {};
    // Construit chaque section depuis les produits Supabase
    Object.entries(SECTION_META).forEach(([k, meta]) => {
      const sectionProducts = dbProducts
        .filter(p => p.section === k)
        .map(p => ({
          cip: p.cip,
          name: p.name,
          pv: p.pv,
          pct: p.pct,
          pn: p.pn,
          remise_eur: p.remise_eur,
          colis: p.colis,
          carton: p.carton,
          note: p.note,
          source: p.source,
          image_url: p.image_url || null,
          _dbId: p.cip,
        }));
      merged[k] = { ...meta, products: sectionProducts };
    });
    // Inject active promo sections as dynamic tabs
    promoSections.filter(ps => ps.active).forEach(ps => {
      merged[`promo_${ps.id}`] = {
        label: ps.name,
        icon: ps.icon || "🏷️",
        subtitle: ps.description || "",
        color: ps.color || "#7c3aed",
        accent: ps.accentColor || "#a855f7",
        columns: ["CIP", "Désignation", "Prix", "Remise", "Prix net"],
        products: (ps.products || []),
        isPromo: true,
        promoId: ps.id,
      };
    });
    return merged;
  }, [dbProducts, promoSections]);

  // Onboarding
  const [onboardingDone, setOnboardingDone] = useState(() => !!localStorage.getItem("session_email"));
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  // Onboarding flow: "email" | "confirm" | "new_client"
  const [obStep, setObStep] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [foundPharmacy, setFoundPharmacy] = useState(null);
  const [pharmacyName, setPharmacyName] = useState(() => localStorage.getItem("session_name") || "");
  const [pharmacyEmail, setPharmacyEmail] = useState(() => localStorage.getItem("session_email") || "");
  const [pharmacyCip, setPharmacyCip] = useState(() => localStorage.getItem("session_cip") || "");

  const handleLogout = () => {
    localStorage.removeItem("session_name");
    localStorage.removeItem("session_email");
    localStorage.removeItem("session_cip");
    setPharmacyName("");
    setPharmacyEmail("");
    setPharmacyCip("");
    setOnboardingDone(false);
    setQuantities({});
    setCartOpen(false);
  };
  const [isClient, setIsClient] = useState(null);
  const [ribFile, setRibFile] = useState(null);
  const [ribBase64, setRibBase64] = useState(null);
  const [onboardingError, setOnboardingError] = useState("");
  // New client form
  const [ncName, setNcName] = useState("");
  const [ncTel, setNcTel] = useState("");
  const [ncVille, setNcVille] = useState("");
  const [ncSending, setNcSending] = useState(false);
  const [ncSent, setNcSent] = useState(false);

  const getStep = (catKey, p) => {
    if (catKey === "stratege") return p.colis || 1;
    if (catKey === "master") return p.palier || 1;
    if (catKey === "blanche") return p.colis || 1;
    if (catKey === "ulabs") return 6;
    return 1;
  };

  const setQty = (key, val, step = 1) => {
    const raw = Math.max(0, parseInt(val) || 0);
    // Snap to nearest multiple of step
    const snapped = step > 1 ? Math.round(raw / step) * step : raw;
    setQuantities(prev => ({ ...prev, [key]: snapped }));
  };

  const cartItems = useMemo(() => {
    const items = [];
    Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, cat]) => {
      (cat.products || []).forEach((p, idx) => {
        const key = `${catKey}-${idx}`;
        const qty = quantities[key] || 0;
        if (qty > 0 && p.pn != null) {
          items.push({
            key,
            cat: cat.label,
            name: p.name,
            cip: p.cip || null,
            pn: p.pn,
            qty,
            total: p.pn * qty,
            color: cat.accent,
            step: getStep(catKey, p),
          });
        }
      });
    });
    return items;
  }, [quantities, CATALOG_WITH_ADMIN]);

  const cartTotal = cartItems.reduce((s, i) => s + i.total, 0);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  const cat = CATALOG_WITH_ADMIN[activeTab];

  const globalResults = globalSearch.trim().length >= 2
    ? Object.entries(CATALOG_WITH_ADMIN).flatMap(([catKey, c]) =>
        (c.products || [])
          .filter(p => p.name?.toLowerCase().includes(globalSearch.toLowerCase()) || (p.cip||"").includes(globalSearch))
          .map(p => ({ ...p, _catKey: catKey, _catLabel: c.label, _catIcon: c.icon, _catAccent: c.accent,
            _idx: c.products.indexOf(p) }))
      )
    : [];

  const filteredProducts = (() => {
    const filtered = (cat?.products || []).filter(p =>
      search === "" || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.cip && p.cip.includes(search))
    );
    if (activeTab === "otc" || activeTab === "nr") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    if (activeTab === "ulabs") {
      const OBL = ["8710604763356","8720181397233","8710604763363"];
      return [...filtered].sort((a, b) => {
        const aP = OBL.includes(a.cip) ? 0 : 1;
        const bP = OBL.includes(b.cip) ? 0 : 1;
        return aP - bP || a.name.localeCompare(b.name, "fr");
      });
    }
    return filtered;
  })();

  // Split grille/tableau
  const isGridSection = GRID_SECTIONS.includes(activeTab) || !!(cat?.withPhotos);
  const gridWithPhoto = isGridSection ? filteredProducts : [];
  const gridWithoutPhoto = isGridSection ? [] : filteredProducts;

  const handlePrint = () => {
    window.print();
  };

  const [copyStatus, setCopyStatus] = useState("");
  const handleCopy = () => {
    if (cartItems.length === 0) return;
    const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const lines = [
      `BON DE COMMANDE — ELIXIR PHARMA`,
      `Publication 6 — Février 2026`,
      `Date : ${date}`,
      `Pharmacie : ${pharmacyName}`,
      ``,
      `${"─".repeat(70)}`,
      `CIP/Réf           Désignation                            Qté  P.Net    Total`,
      `${"─".repeat(70)}`,
      ...cartItems.map(i => {
        const cip = (i.cip || "—").substring(0, 16).padEnd(18);
        const nm  = i.name.substring(0, 36).padEnd(38);
        const qty = String(i.qty).padStart(4);
        const pn  = (i.pn != null ? i.pn.toFixed(2)+"€" : "—").padStart(9);
        const tot = (i.pn != null ? (i.pn*i.qty).toFixed(2)+"€" : "—").padStart(9);
        return `${cip}${nm}${qty}${pn}${tot}`;
      }),
      `${"─".repeat(70)}`,
      `TOTAL : ${cartItems.reduce((s,i)=>s+(i.pn||0)*i.qty,0).toFixed(2)} €`,
    ].join("\n");
    navigator.clipboard.writeText(lines).then(() => {
      setCopyStatus("✓ Copié !");
      setTimeout(() => setCopyStatus(""), 2500);
    }).catch(() => setCopyStatus("Erreur copie"));
  };

  const handleRibUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRibFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setRibBase64(ev.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const handleEmailLookup = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) { setOnboardingError("Veuillez saisir une adresse e-mail valide."); return; }
    setOnboardingError("");
    setObStep("loading");
    try {
      const res = await fetch("/.netlify/functions/pharmacy-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.found && json.pharmacy) {
        setFoundPharmacy(json.pharmacy);
        setObStep("confirm");
      } else {
        setObStep("new_client");
      }
    } catch (err) {
      setOnboardingError("Erreur de connexion. Veuillez reessayer.");
      setObStep("email");
    }
  };

  const handleConfirmPharmacy = () => {
    setPharmacyName(foundPharmacy.name);
    setPharmacyEmail(foundPharmacy.email);
    localStorage.setItem("session_name", foundPharmacy.name);
    localStorage.setItem("session_email", foundPharmacy.email);
    localStorage.setItem("session_cip", foundPharmacy.cip || "");
    setPharmacyCip(foundPharmacy.cip || "");
    setIsClient(true);
    setOnboardingDone(true);
    // Show promo popup if active promos exist
    try {
      const promos = JSON.parse(localStorage.getItem("admin_promos") || "[]");
      if (promos.some(p => p.active)) setPromoPopupOpen(true);
    } catch {}
  };

  const handleNewClientSubmit = async () => {
    if (!ncName.trim()) { setOnboardingError("Veuillez saisir le nom de la pharmacie."); return; }
    setOnboardingError("");
    setNcSending(true);
    // Send via EmailJS to notify Elixir Pharma of new prospect
    try {
      await emailjs.send(
        EMAILJS_CONFIG.SERVICE_ID,
        EMAILJS_CONFIG.TEMPLATE_ID,
        {
          to_email: DEFAULT_RECIPIENT,
          pharmacy_name: ncName,
          pharmacy_email: emailInput.trim().toLowerCase(),
          is_client: "Non – NOUVEAU PROSPECT",
          order_date: new Date().toLocaleDateString("fr-FR"),
          order_lines: `Demande d'accès nouvelle pharmacie:\n  Nom : ${ncName}\n  Email : ${emailInput.trim()}\n  Tél : ${ncTel}\n  Ville : ${ncVille}`,
          total_ht: "—",
          nb_lignes: 0,
          nb_unites: 0,
        },
        EMAILJS_CONFIG.PUBLIC_KEY
      );
    } catch(e) { console.error(e); }
    setNcSending(false);
    setNcSent(true);
  };

  const handleOnboarding = () => {
    // legacy fallback — not used anymore
    setOnboardingDone(true);
  };

  const handleSend = async () => {
    if (cartItems.length === 0) return;
    setSendStatus("sending");

    const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const lignes = cartItems.map(i =>
      `• ${i.name}\n  Qté : ${i.qty}  |  PU : ${i.pn.toFixed(2).replace(".", ",")} €  |  Total : ${i.total.toFixed(2).replace(".", ",")} €`
    ).join("\n\n");

    // Build CSV and save order to localStorage for admin
    // Build catalog CIP lookup for fallback
    const cipLookup = {};
    Object.values(CATALOG_WITH_ADMIN).forEach(section => {
      (section.products || []).forEach(p => {
        if (p.cip && p.name) cipLookup[p.name.trim().toLowerCase()] = p.cip;
      });
    });
    const csvLines = [];
    cartItems.forEach(i => {
      let cip = i.cip || cipLookup[i.name?.trim().toLowerCase()] || "—";
      csvLines.push(`${cip.replace(/;/g,"")};${i.qty}`);
    });
    const csvContent = csvLines.join("\n");

    const templateParams = {
      to_email:      DEFAULT_RECIPIENT,
      pharmacy_name: pharmacyName,
      pharmacy_email: pharmacyEmail,
      is_client:     isClient ? "Oui" : "Non (nouveau client – RIB joint)",
      order_date:    date,
      order_lines:   lignes,
      total_ht:      cartTotal.toFixed(2).replace(".", ",") + " €",
      nb_lignes:     cartItems.length,
      nb_unites:     cartCount,
    };

    try {
      await emailjs.send(
        EMAILJS_CONFIG.SERVICE_ID,
        EMAILJS_CONFIG.TEMPLATE_ID,
        templateParams,
        EMAILJS_CONFIG.PUBLIC_KEY
      );
      setSendStatus("success");
      // Save order to Supabase via Netlify Function
      try {
        const order = {
          id: Date.now(),
          date: new Date().toISOString(),
          pharmacyName,
          pharmacyEmail,
          pharmacyCip: pharmacyCip || null,
          isClient,
          items: cartItems.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total })),
          totalHt: cartTotal,
          nbLignes: cartItems.length,
          csv: csvContent,
          processed: false,
        };

        // Sauvegarde dans Supabase
        fetch("/.netlify/functions/order-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order),
        }).then(r => r.json()).then(j => {
          if (j.success) console.log("[order-save] ✓ Commande sauvegardée dans Supabase");
          else console.warn("[order-save] ✗", j.error);
        }).catch(e => console.warn("[order-save] erreur réseau:", e.message));

        // ── Auto-submit vers PharmaML ──
        // Essaie d'abord l'agent local (port 3001), sinon fallback Netlify Function
        (async () => {
          const payload = JSON.stringify({
            csvContent,
            items: order.items,
            pharmacyName, pharmacyEmail, pharmacyCip, orderId: order.id,
          });
          const endpoints = [
            { url: "http://localhost:3001", label: "agent local" },
            { url: "/.netlify/functions/submit-order", label: "Netlify Function" },
          ];
          for (const ep of endpoints) {
            try {
              const res = await fetch(ep.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                signal: AbortSignal.timeout(5000),
              });
              const json = await res.json().catch(() => ({}));
              if (res.ok && json.success) {
                console.log(`[PharmaML] ✓ Commande transmise via ${ep.label} — ${json.nbLignes} ligne(s)`);
                return;
              }
              console.warn(`[PharmaML] ${ep.label} error :`, json.error || res.status);
            } catch (err) {
              console.warn(`[PharmaML] ${ep.label} injoignable :`, err.message);
            }
          }
          console.warn("[PharmaML] Tous les endpoints ont échoué.");
        })();

      } catch(e) { console.error("Order save error", e); }
      setTimeout(() => {
        setSendStatus(null);
        setQuantities({});
        setCartOpen(false);
      }, 3000);
    } catch (err) {
      console.error("EmailJS error:", err);
      setSendStatus("error");
      setTimeout(() => setSendStatus(null), 5000);
    }
  };

  // ── ONBOARDING SCREEN ──────────────────────────────────────────────
  const obBg = { minHeight:"100vh", background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 60%, #16637a 100%)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif", padding:24 };
  const obCard = { background:"white", borderRadius:20, padding:"40px 44px", maxWidth:480, width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,0.35)" };
  const obInput = { width:"100%", border:"1.5px solid #e2e8f0", borderRadius:10, padding:"10px 14px", fontSize:14, outline:"none", boxSizing:"border-box" };
  const obBtn = { width:"100%", background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", color:"white", border:"none", borderRadius:12, padding:"14px", fontWeight:800, fontSize:15, cursor:"pointer" };
  const obLabel = { fontSize:12, fontWeight:700, color:"#444", display:"block", marginBottom:6 };
  const obLogo = (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:28 }}>
      <div style={{ background:"#0f2d3d", borderRadius:10, padding:"6px 14px", fontWeight:800, fontSize:20, letterSpacing:2, color:"white" }}>ELIXIR</div>
      <div>
        <div style={{ fontWeight:700, fontSize:13, color:"#0f2d3d", letterSpacing:1 }}>PHARMA</div>
        <div style={{ fontSize:11, color:"#aaa" }}>Bon de commande – Catalogue Février 2026</div>
      </div>
    </div>
  );
  const obFooter = (
    <>
      <div style={{ fontSize:11, color:"#bbb", textAlign:"center", marginTop:14 }}>Elixir Pharma · pharmacien@elixirpharma.fr · 01 86 04 39 95</div>
      <div style={{ textAlign:"center", marginTop:8 }}>
        <button onClick={() => setShowAdminLogin(true)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#ddd", textDecoration:"underline", padding:0 }}>Accès administrateur</button>
      </div>
    </>
  );

  if (!onboardingDone) return (
    <div style={obBg}>

      {/* ── STEP LOADING ── */}
      {obStep === "loading" && (
        <div style={obCard}>
          {obLogo}
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ fontSize:32, marginBottom:12 }}>⏳</div>
            <div style={{ fontWeight:700, fontSize:15, color:"#0f2d3d" }}>Recherche en cours…</div>
            <div style={{ fontSize:13, color:"#888", marginTop:6 }}>Vérification dans notre système</div>
          </div>
        </div>
      )}

      {/* ── STEP 1 : EMAIL ── */}
      {obStep === "email" && (
        <div style={obCard}>
          {obLogo}
          <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d", marginBottom:6 }}>Bienvenue 👋</div>
          <div style={{ fontSize:13, color:"#666", marginBottom:28 }}>Saisissez votre adresse e-mail pour accéder au catalogue</div>
          <label style={obLabel}>Adresse e-mail</label>
          <input
            type="email" value={emailInput}
            onChange={e => { setEmailInput(e.target.value); setOnboardingError(""); }}
            onKeyDown={e => e.key==="Enter" && handleEmailLookup()}
            placeholder="pharmacie@exemple.fr"
            style={{ ...obInput, marginBottom:16 }}
            autoFocus
          />
          {onboardingError && <div style={{ background:"#fff5f5", border:"1px solid #fed7d7", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#c53030", marginBottom:16 }}>⚠️ {onboardingError}</div>}
          <button onClick={handleEmailLookup} style={obBtn}>Continuer →</button>
          {obFooter}
        </div>
      )}

      {/* ── STEP 2 : CONFIRM ── */}
      {obStep === "confirm" && foundPharmacy && (
        <div style={obCard}>
          {obLogo}
          <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d", marginBottom:6 }}>Pharmacie reconnue ✓</div>
          <div style={{ fontSize:13, color:"#666", marginBottom:20 }}>Nous avons trouvé un compte associé à cet e-mail :</div>
          <div style={{ background:"#f0fdf4", border:"2px solid #86efac", borderRadius:14, padding:"18px 20px", marginBottom:24 }}>
            <div style={{ fontWeight:800, fontSize:17, color:"#0f2d3d", marginBottom:4 }}>🏥 {foundPharmacy.name}</div>
            {foundPharmacy.street && <div style={{ fontSize:13, color:"#555" }}>{foundPharmacy.street}</div>}
            <div style={{ fontSize:13, color:"#555" }}>{foundPharmacy.cp} {foundPharmacy.ville}</div>
            {foundPharmacy.tel && <div style={{ fontSize:12, color:"#888", marginTop:4 }}>📞 {foundPharmacy.tel}</div>}
          </div>
          <div style={{ fontSize:14, fontWeight:700, color:"#0f2d3d", marginBottom:14, textAlign:"center" }}>
            Êtes-vous bien cette pharmacie ?
          </div>
          <div style={{ display:"flex", gap:12 }}>
            <button onClick={handleConfirmPharmacy} style={{ ...obBtn, flex:1 }}>✅ Oui, c'est moi</button>
            <button onClick={() => { setObStep("email"); setFoundPharmacy(null); setEmailInput(""); }} style={{ flex:1, background:"#f0f2f5", color:"#374151", border:"none", borderRadius:12, padding:"14px", fontWeight:700, fontSize:14, cursor:"pointer" }}>
              ← Retour
            </button>
          </div>
          {obFooter}
        </div>
      )}

      {/* ── STEP 3 : NEW CLIENT ── */}
      {obStep === "new_client" && (
        <div style={obCard}>
          {obLogo}
          <div style={{ fontWeight:800, fontSize:18, color:"#0f2d3d", marginBottom:4 }}>Pharmacie non reconnue</div>
          <div style={{ fontSize:13, color:"#666", marginBottom:24 }}>
            L'adresse <strong>{emailInput}</strong> n'est pas encore dans notre base clients.
          </div>
          <div style={{ background:"#eff6ff", border:"2px solid #93c5fd", borderRadius:14, padding:"20px", marginBottom:24, textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
            <div style={{ fontWeight:700, fontSize:15, color:"#1e40af", marginBottom:8 }}>Devenez client Elixir Pharma</div>
            <div style={{ fontSize:13, color:"#3b82f6", marginBottom:18 }}>Remplissez notre formulaire de demande d'accès — notre équipe vous contactera sous 24h ouvrées.</div>
            <a
              href="https://form.asana.com/?k=9APiLAEcOh9v6OrT8il4mg&d=1208646355437005"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:"inline-block", background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", color:"white", borderRadius:12, padding:"13px 28px", fontWeight:800, fontSize:14, textDecoration:"none" }}
            >
              Accéder au formulaire →
            </a>
          </div>
          <button onClick={() => { setObStep("email"); setOnboardingError(""); }} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#999", textDecoration:"underline" }}>← Retour</button>
          {obFooter}
        </div>
      )}

      {showAdminLogin && (
        <AdminPanel
          sectionMeta={SECTION_META}
          onClose={() => {
            setShowAdminLogin(false);
            fetchProducts();
            try { setPromoSections(JSON.parse(localStorage.getItem("admin_promos") || "[]")); } catch {}
          }}
        />
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column" }}>

      {/* ── PROMO POPUP ── */}
      {promoPopupOpen && promoSections.some(p => p.active) && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(4px)" }}>
          <div style={{ background:"white", borderRadius:20, padding:"36px 40px", maxWidth:480, width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,0.4)", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d" }}>🎉 Offres du moment</div>
                <div style={{ fontSize:13, color:"#666", marginTop:4 }}>Des promotions exclusives sont disponibles cette semaine !</div>
              </div>
              <button onClick={() => setPromoPopupOpen(false)} style={{ background:"#f0f2f5", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>✕</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {promoSections.filter(p => p.active).map(ps => (
                <button key={ps.id} onClick={() => { setActiveTab(`promo_${ps.id}`); setPromoPopupOpen(false); }} style={{
                  display:"flex", alignItems:"center", gap:14, background:`linear-gradient(135deg, ${ps.color}15, ${ps.accentColor || ps.color}25)`,
                  border:`2px solid ${ps.color}40`, borderRadius:14, padding:"14px 18px", cursor:"pointer", textAlign:"left", width:"100%"
                }}>
                  <span style={{ fontSize:28 }}>{ps.icon || "🏷️"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:15, color:"#0f2d3d" }}>{ps.name}</div>
                    {ps.description && <div style={{ fontSize:12, color:"#666", marginTop:2 }}>{ps.description}</div>}
                    {ps.endDate && <div style={{ fontSize:11, color:"#e07b39", marginTop:3, fontWeight:600 }}>⏰ Jusqu'au {ps.endDate}</div>}
                    <div style={{ fontSize:11, color:ps.color, fontWeight:700, marginTop:4 }}>{(ps.products||[]).length} référence(s) → Voir les offres</div>
                  </div>
                  <span style={{ fontSize:18, color:ps.color }}>→</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPromoPopupOpen(false)} style={{ width:"100%", background:"#f0f2f5", border:"none", borderRadius:12, padding:"12px", fontWeight:700, fontSize:13, cursor:"pointer", marginTop:20, color:"#555" }}>
              Continuer vers le catalogue
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{
        background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 60%, #16637a 100%)",
        color: "white", padding: "0", position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "8px 12px" : "12px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ background: "#2d9cbc", borderRadius: 10, padding: isMobile ? "4px 8px" : "6px 12px", fontWeight: 800, fontSize: isMobile ? 15 : 20, letterSpacing: 2 }}>
              ELIXIR
            </div>
            <div>
              <div style={{ fontSize: 13, opacity: 0.7, letterSpacing: 1 }}>PHARMA</div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>
                Bon de commande – Catalogue Février 2026
                {stockUpdatedAt && (
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>· stocks mis à jour {new Date(stockUpdatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                )}
                <button
                  onClick={handleRefresh}
                  disabled={stockRefreshing || stockLoading}
                  title={stockRefreshing ? "Actualisation Odoo en cours (~40s)…" : "Forcer la mise à jour depuis Odoo"}
                  style={{ marginLeft: 8, background: "none", border: "none", cursor: (stockRefreshing || stockLoading) ? "default" : "pointer", padding: "0 2px", opacity: (stockRefreshing || stockLoading) ? 0.4 : 0.8, fontSize: 13, color: "inherit" }}
                >{stockRefreshing ? "⏳ Actualisation…" : "🔄"}</button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8, padding: "4px 4px 4px 14px"
            }}>
              <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", maxWidth: isMobile ? 100 : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}>🏥 {pharmacyName}</span>
              <button onClick={handleLogout} title="Se déconnecter" style={{
                background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6, color: "rgba(255,255,255,0.7)", cursor: "pointer",
                padding: "3px 8px", fontSize: 11, lineHeight: 1
              }}>⎋ Déco</button>
            </div>
            {!isMobile && <button onClick={handlePrint} style={{
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
              color: "white", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12
            }}>🖨 Imprimer</button>}
            <button onClick={() => setShowAdmin(true)} style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.5)", borderRadius: 8, padding: "6px 10px",
              cursor: "pointer", fontSize: 12, title: "Administration"
            }} title="Administration">{isMobile ? "" : "⚙️"}</button>
            <button onClick={() => setCartOpen(!cartOpen)} style={{
              background: cartCount > 0 ? "#10b981" : "rgba(255,255,255,0.15)",
              border: "none", color: "white", borderRadius: 10, padding: "8px 16px",
              cursor: "pointer", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8,
              transition: "all 0.2s"
            }}>
              🛒 Panier {cartCount > 0 && <span style={{
                background: "white", color: "#10b981", borderRadius: 20,
                padding: "2px 8px", fontSize: 12, fontWeight: 800
              }}>{cartCount}</span>}
            </button>
          </div>
        </div>

        {/* Global search bar */}
        <div style={{ padding: isMobile ? "6px 12px 0" : "8px 24px 0", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ position: "relative", maxWidth: isMobile ? "100%" : 480 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, opacity:0.6 }}>🔍</span>
            <input
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Recherche toutes sections — nom ou CIP..."
              style={{
                width: "100%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10, color: "white", padding: "7px 14px 7px 34px", fontSize: 13,
                outline: "none", boxSizing: "border-box",
              }}
            />
            {globalSearch && (
              <button onClick={() => setGlobalSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:16, padding:0 }}>✕</button>
            )}
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: "flex", overflowX: "auto", paddingBottom: 0, borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 8 }}>
          {Object.entries(CATALOG_WITH_ADMIN).map(([key, c]) => (
            <button key={key} onClick={() => { setActiveTab(key); setSearch(""); }} style={{
              background: activeTab === key ? "rgba(255,255,255,0.15)" : "transparent",
              border: "none", color: activeTab === key ? "white" : "rgba(255,255,255,0.55)",
              padding: "10px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
              whiteSpace: "nowrap", borderBottom: activeTab === key ? `3px solid ${c.accent}` : "3px solid transparent",
              transition: "all 0.2s"
            }}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, position: "relative" }}>
        {/* Main content */}
        <main style={{ flex: 1, padding: isMobile ? "12px 10px" : "20px 24px", minWidth: 0 }}>

          {/* ── GLOBAL SEARCH RESULTS ── */}
          {globalSearch.trim().length >= 2 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0f2d3d", marginBottom: 12, display:"flex", alignItems:"center", gap:10 }}>
                🔍 Résultats pour « {globalSearch} »
                <span style={{ fontSize:12, fontWeight:400, color:"#888", background:"#f0f2f5", borderRadius:8, padding:"2px 10px" }}>
                  {globalResults.length} produit(s) trouvé(s)
                </span>
              </div>
              {globalResults.length === 0 ? (
                <div style={{ background:"white", borderRadius:14, padding:"32px", textAlign:"center", color:"#aaa", fontSize:14 }}>
                  Aucun produit trouvé pour « {globalSearch} »
                </div>
              ) : (
                <div style={{ background:"white", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#0f2d3d" }}>
                        {["Section","CIP","Désignation","Prix net",""].map(h => (
                          <th key={h} style={{ color:"white", padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, letterSpacing:0.5 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {globalResults.map((p, i) => {
                        const qKey = `${p._catKey}-${p._idx}`;
                        const qty = quantities[qKey] || 0;
                        const step = getStep(p._catKey, p);
                        return (
                          <tr key={i} style={{ background: i%2===0?"white":"#fafbfc", borderBottom:"1px solid #f0f2f5" }}
                            onMouseEnter={e => e.currentTarget.style.background=`${p._catAccent}10`}
                            onMouseLeave={e => e.currentTarget.style.background=i%2===0?"white":"#fafbfc"}>
                            <td style={{ padding:"10px 14px" }}>
                              <button onClick={() => { setActiveTab(p._catKey); setGlobalSearch(""); }} style={{ background:`${p._catAccent}20`, border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, fontWeight:700, color:p._catAccent, cursor:"pointer", whiteSpace:"nowrap" }}>
                                {p._catIcon} {p._catLabel}
                              </button>
                            </td>
                            <td style={{ padding:"10px 14px" }}><CipCell cip={p.cip} /></td>
                            <td style={{ padding:"10px 14px", fontWeight:600, color:"#0f2d3d", maxWidth:300 }}>
                              {p.name}
                              {p.note && <span style={{ marginLeft:6, fontSize:10, color:"#e07b39", background:"#fef3ec", borderRadius:4, padding:"1px 5px" }}>{p.note}</span>}
                              {p._overridden && <span style={{ marginLeft:6, fontSize:10, color:"#f59e0b", background:"#fffbeb", borderRadius:4, padding:"1px 5px" }}>✎ modifié</span>}
                            </td>
                            <td style={{ padding:"10px 14px", textAlign:"right", fontWeight:800, color:"#0f2d3d", whiteSpace:"nowrap" }}>
                              {p.pn != null ? fmt(p.pn) : "—"}
                            </td>
                            <td style={{ padding:"10px 14px", textAlign:"center" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"center" }}>
                                <button onClick={() => setQty(qKey, qty - step, step)} style={{ background:"#f0f2f5", border:"none", borderRadius:6, width:26, height:26, cursor:"pointer", fontWeight:800, fontSize:14, color:"#555" }}>−</button>
                                <span style={{ minWidth:28, textAlign:"center", fontWeight:700, fontSize:13, color: qty>0?"#10b981":"#aaa" }}>{qty||0}</span>
                                <button onClick={() => setQty(qKey, qty + step, step)} style={{ background: qty>0?"#10b981":"#0f2d3d", border:"none", borderRadius:6, width:26, height:26, cursor:"pointer", fontWeight:800, fontSize:14, color:"white" }}>+</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Category header */}
          <div style={{
            background: `linear-gradient(135deg, ${cat.color} 0%, ${cat.accent}33 100%)`,
            borderRadius: 16, padding: "20px 28px", marginBottom: 20,
            border: `1px solid ${cat.accent}40`
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "white", display: "flex", alignItems: "center", gap: 12 }}>
                  <span>{cat.icon}</span> {cat.label}
                </div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 }}>{cat.subtitle}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 16px", textAlign: "right" }}>
                {activeTab === "ulabs" ? (<>
                  <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>Pharmacies participantes</div>
                  <div style={{ color: "white", fontWeight: 700, fontSize: 22 }}>
                    {new Set(groupOrders.map(r => r.pharmacy_cip)).size}
                  </div>
                </>) : (<>
                  <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>Lignes dans cette gamme</div>
                  <div style={{ color: "white", fontWeight: 700, fontSize: 22 }}>{(cat.products||[]).length}</div>
                </>)}
              </div>
            </div>
            {/* Bloc groupement U-Labs */}
            {activeTab === "ulabs" && (() => {
              const totalUnites = groupOrders.reduce((s,r) => s + (parseInt(r.qty) || 0), 0);
              const nbPharm = new Set(groupOrders.map(r => r.pharmacy_cip)).size;
              const PALIER_EXPERT = 500;
              const pctExpert = Math.min(100, Math.round(totalUnites / PALIER_EXPERT * 100));
              const palierAtteint = totalUnites >= PALIER_EXPERT;
              return (
                <div style={{ marginTop: 16 }}>
                  {/* Countdown + stats */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 800, fontSize: 20, color: "white" }}>{totalUnites}</div>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>unités groupées</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 800, fontSize: 20, color: "white" }}>{nbPharm}</div>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>pharmacie(s)</div>
                      </div>
                      {palierAtteint && (
                        <div style={{ background: "#f59e0b", borderRadius: 8, padding: "4px 12px", display: "flex", alignItems: "center" }}>
                          <span style={{ fontWeight: 800, fontSize: 13, color: "white" }}>⭐ Objectif −33% atteint !</span>
                        </div>
                      )}
                    </div>
                    <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>⏱️</span>
                      <div>
                        <div style={{ fontSize: 9, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>Fermeture dimanche 23h59</div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: "white", fontVariantNumeric: "tabular-nums" }}>{countdown}</div>
                      </div>
                    </div>
                  </div>
                  {/* Barre de progression unique avec jalons */}
                  <div style={{ marginTop: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "baseline" }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>
                        {totalUnites} unité{totalUnites > 1 ? "s" : ""} commandée{totalUnites > 1 ? "s" : ""}
                      </span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>objectif {PALIER_EXPERT} unités</span>
                    </div>
                    {/* Barre */}
                    <div style={{ position: "relative", background: "rgba(255,255,255,0.15)", borderRadius: 99, height: 14 }}>
                      {/* Remplissage */}
                      <div style={{
                        width: `${pctExpert}%`, height: "100%", borderRadius: 99, transition: "width 0.6s ease",
                        background: palierAtteint ? "linear-gradient(90deg,#f59e0b,#fcd34d)" : "linear-gradient(90deg,#059669,#34d399)"
                      }}/>
                    </div>
                    {/* Légende */}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>0</span>
                      <span style={{ fontSize: 10, color: palierAtteint ? "#fcd34d" : "rgba(255,255,255,0.6)", fontWeight: 700 }}>⭐ {PALIER_EXPERT} unités = −33% sur facture</span>
                    </div>
                  </div>
                  {/* Sélection palier prix */}
                  <div style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>· Prix affichés avec remise −33% sur facture incluse</span>
                  </div>
                </div>
              );
            })()}
            {/* Search */}
            <div style={{ marginTop: 16 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍  Rechercher par nom ou CIP..."
                style={{
                  width: "100%", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 10, color: "white", padding: "8px 16px", fontSize: 13,
                  outline: "none", boxSizing: "border-box"
                }}
              />
            </div>
          </div>

          {/* Products grid (photos) + table */}
          <>
          <>
{gridWithPhoto.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                  {gridWithPhoto.map((p) => {
                    const realIdx = cat.products.indexOf(p);
                    const key = `${activeTab}-${realIdx}`;
                    const qty = quantities[key] || 0;
                    const step = getStep(activeTab, p);
                    const isRupture = p.cip && (stockData[p.cip]?.dispo === 0 || stockData[p.cip]?.dispo === false);
                    const groupTotal = activeTab === "ulabs" ? groupOrders.filter(r => r.cip === p.cip).reduce((s,r) => s + (parseInt(r.qty)||0), 0) : 0;
                    const groupPharm = activeTab === "ulabs" ? new Set(groupOrders.filter(r => r.cip === p.cip).map(r => r.pharmacy_cip)).size : 0;
                    const remisePct = activeTab === "ulabs" ? 33 : 0;
                    const pnAffiche = remisePct > 0 ? Math.round(p.pv * (1 - remisePct/100) * 100) / 100 : p.pn;
                    const OBL_CIPS = ["8710604763356","8720181397233","8710604763363"];
                    const has6plus2 = activeTab === "ulabs" && (
                      OBL_CIPS.includes(p.cip) ||
                      p.name?.toLowerCase().includes("junior") ||
                      p.name?.toLowerCase().includes("kids")
                    );
                    const livrées6plus2 = has6plus2 && qty >= 6 ? Math.floor(qty / 6) * 2 : 0;
                    return (
                      <div key={key} style={{
                        background: "white", borderRadius: 14,
                        boxShadow: qty > 0 ? `0 0 0 2px ${cat.accent}, 0 2px 12px rgba(0,0,0,0.08)` : "0 1px 6px rgba(0,0,0,0.06)",
                        border: `1px solid ${qty > 0 ? cat.accent : "#eef0f3"}`,
                        display: "flex", alignItems: "center", gap: 0,
                        overflow: "hidden", transition: "box-shadow 0.2s, border 0.2s"
                      }}>
                        {/* Photo */}
                        <div style={{ flexShrink: 0, width: isMobile ? 72 : 110, height: isMobile ? 72 : 110, background: "#f8fafc", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #f0f2f5" }}>
                          {p.image_url
                            ? <img src={p.image_url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }}/>
                            : null
                          }
                          {isRupture && (
                            <div style={{ position: "absolute", top: 4, left: 4, background: "#dc2626", color: "white", fontSize: 9, fontWeight: 800, borderRadius: 4, padding: "2px 5px" }}>⚠️ RUPTURE</div>
                          )}
                        </div>
                        {/* Info centrale */}
                        <div style={{ flex: 1, padding: "14px 16px", minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1a2a3a", lineHeight: 1.4, marginBottom: 4 }}>{p.name}</div>
                          {p.cip && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>EAN : <CipCell cip={p.cip}/></div>}
                          {p.note && <span style={{ fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>{p.note}</span>}
                          {activeTab === "ulabs" && ["8710604763356","8720181397233","8710604763363"].includes(p.cip) && (
                            <span style={{ fontSize: 10, color: "white", background: "#dc2626", borderRadius: 4, padding: "2px 7px", fontWeight: 700, marginLeft: 4 }}>⚠️ Réf. obligatoire</span>
                          )}
                          {has6plus2 && (
                            <span style={{ fontSize: 10, color: "#065f46", background: "#d1fae5", borderRadius: 4, padding: "2px 7px", fontWeight: 700, marginLeft: 4, border: "1px solid #6ee7b7" }}>🎁 6 achetées = 2 offertes</span>
                          )}
                          {p.colis && p.colis > 1 && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>Conditionnement : ×{p.colis}</div>}
                          {activeTab === "ulabs" && groupTotal > 0 && (
                            <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, background: "#d1fae5", borderRadius: 6, padding: "3px 8px" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46" }}>🤝 {groupTotal} unités groupées</span>
                              <span style={{ fontSize: 10, color: "#6ee7b7" }}>· {groupPharm} pharm.</span>
                            </div>
                          )}
                        </div>
                        {/* Prix + remise + qté */}
                        <div style={{ flexShrink: 0, padding: "14px 20px", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, borderLeft: "1px solid #f0f2f5", minWidth: 160 }}>
                          {(p.pv && p.pct || remisePct > 0) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 12, color: "#aaa", textDecoration: "line-through" }}>{fmt(p.pv)}</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "white", background: remisePct > 0 ? (ulabsPalier === "expert" ? "#f59e0b" : "#06b6d4") : cat.accent, borderRadius: 4, padding: "1px 6px" }}>
                                {remisePct > 0 ? `-${remisePct}%` : fmtPct(p.pct)}
                              </span>
                            </div>
                          )}
                          <div style={{ fontSize: 20, fontWeight: 800, color: remisePct > 0 ? (ulabsPalier === "expert" ? "#d97706" : "#0891b2") : cat.color }}>{pnAffiche != null ? fmt(pnAffiche) : "–"}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button onClick={() => {
                              const nq = Math.max(0, qty - step);
                              setQty(key, nq, step);
                              if (activeTab === "ulabs") {
                                const snapped = step > 1 ? Math.round(nq / step) * step : nq;
                                fetch("/.netlify/functions/group-order", { method:"POST", headers:{"Content-Type":"application/json"},
                                  body: JSON.stringify({fournisseur:"ulabs", cip:p.cip, pharmacy_cip:pharmacyCip, pharmacy_name:pharmacyName, qty:snapped})})
                                  .then(() => fetchGroupOrders());
                              }
                            }} style={{
                              background: cat.accent + "15", border: `1px solid ${cat.accent}40`,
                              color: cat.accent, borderRadius: 7, width: 32, height: 32,
                              cursor: "pointer", fontWeight: 800, fontSize: 18, lineHeight: 1
                            }}>−</button>
                            <input type="number" min="0" step={step} value={quantities[key] || ""}
                              onChange={e => setQty(key, e.target.value, step)}
                              onBlur={e => {
                                if (activeTab === "ulabs") {
                                  const v = parseInt(e.target.value) || 0;
                                  const snapped = Math.round(v / step) * step;
                                  fetch("/.netlify/functions/group-order", { method:"POST", headers:{"Content-Type":"application/json"},
                                    body: JSON.stringify({fournisseur:"ulabs", cip:p.cip, pharmacy_cip:pharmacyCip, pharmacy_name:pharmacyName, qty:snapped})})
                                    .then(() => fetchGroupOrders());
                                }
                              }}
                              placeholder="0"
                              style={{
                                width: 50, textAlign: "center", border: `1.5px solid ${qty > 0 ? cat.accent : "#ddd"}`,
                                borderRadius: 7, padding: "5px 4px", fontSize: 14,
                                fontWeight: qty > 0 ? 700 : 400, outline: "none"
                              }}/>
                            <button onClick={() => {
                              const nq = qty + step;
                              setQty(key, nq, step);
                              if (activeTab === "ulabs") {
                                const snapped = step > 1 ? Math.round(nq / step) * step : nq;
                                fetch("/.netlify/functions/group-order", { method:"POST", headers:{"Content-Type":"application/json"},
                                  body: JSON.stringify({fournisseur:"ulabs", cip:p.cip, pharmacy_cip:pharmacyCip, pharmacy_name:pharmacyName, qty:snapped})})
                                  .then(() => fetchGroupOrders());
                              }
                            }} style={{
                              background: qty > 0 ? cat.accent : "#0f2d3d", border: "none",
                              color: "white", borderRadius: 7, width: 32, height: 32,
                              cursor: "pointer", fontWeight: 800, fontSize: 18, lineHeight: 1
                            }}>+</button>
                          </div>
                          {step > 1 && <div style={{ fontSize: 9, color: "#aaa" }}>par {step}</div>}
                          {qty > 0 && p.pn != null && (
                            <div style={{ fontSize: 12, fontWeight: 700, color: cat.color, background: cat.accent + "15", borderRadius: 6, padding: "2px 10px" }}>
                              = {fmt((pnAffiche ?? p.pn) * qty)}
                              {livrées6plus2 > 0 && <span style={{ color: "#059669", fontWeight: 800, marginLeft: 6 }}>+{livrées6plus2} offertes</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {gridWithoutPhoto.length > 0 && (
          <div style={{ background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.08)" }}>
            {isMobile ? (
              /* ── VUE MOBILE : liste simplifiée nom + PN + quantité ── */
              <div>
                <div style={{ background: cat.color, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "white", fontWeight: 700, fontSize: 12 }}>DÉSIGNATION</span>
                  <span style={{ color: "white", fontWeight: 700, fontSize: 12 }}>PN · QTÉ</span>
                </div>
                {gridWithoutPhoto.map((p, idx) => {
                  const realIdx = cat.products.indexOf(p);
                  const key = `${activeTab}-${realIdx}`;
                  const qty = quantities[key] || 0;
                  const isRupture = p.cip && (stockData[p.cip]?.dispo === 0 || stockData[p.cip]?.dispo === false);
                  const step = getStep(activeTab, p);
                  return (
                    <div key={key} style={{
                      padding: "10px 14px", borderBottom: "1px solid #f0f2f5",
                      background: isRupture ? "#fff8f8" : idx % 2 === 0 ? "white" : "#fafbfc",
                      display: "flex", alignItems: "center", gap: 10
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#0f2d3d", lineHeight: 1.3 }}>
                          {p.name}
                          {p.note && <span style={{ marginLeft: 5, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                          {isRupture && <span style={{ marginLeft: 5, fontSize: 10, color: "#dc2626", background: "#fee2e2", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠️ Rupture</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{fmt(p.pn)} {p.pct ? <span style={{ color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</span> : null}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setQuantities(q => ({ ...q, [key]: Math.max(0, (q[key]||0) - step) }))}
                          style={{ background: cat.accent+"20", border: `1px solid ${cat.accent}40`, color: cat.accent, borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                        <span style={{ width: 28, textAlign: "center", fontWeight: 700, fontSize: 15 }}>{qty}</span>
                        <button onClick={() => setQuantities(q => ({ ...q, [key]: (q[key]||0) + step }))}
                          style={{ background: cat.accent, border: "none", color: "white", borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: cat.color }}>
                    {cat.columns.map(col => (
                      <th key={col} style={{
                        color: "white", padding: "12px 14px", textAlign: "left",
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap"
                      }}>{col.toUpperCase()}</th>
                    ))}
                    <th style={{ color: "white", padding: "12px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>QTÉ</th>
                    <th style={{ color: "white", padding: "12px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>SOUS-TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {gridWithoutPhoto.map((p, idx) => {
                    const realIdx = cat.products.indexOf(p);
                    const key = `${activeTab}-${realIdx}`;
                    const qty = quantities[key] || 0;
                    const subtotal = p.pn != null ? p.pn * qty : null;

                    const isRupture = p.cip && (stockData[p.cip]?.dispo === 0 || stockData[p.cip]?.dispo === false);
                    const ruptureBadge = isRupture ? <span style={{ marginLeft: 6, fontSize: 10, color: "#dc2626", background: "#fee2e2", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠️ Rupture</span> : null;
                    return (
                      <tr key={key} style={{
                        background: isRupture ? "#fff8f8" : idx % 2 === 0 ? "white" : "#fafbfc",
                        borderBottom: "1px solid #f0f2f5",
                        transition: "background 0.15s"
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = `${cat.accent}10`}
                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "white" : "#fafbfc"}
                      >
                        {/* Render cells based on category */}
                        {activeTab === "expert" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 300 }}>
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                            {ruptureBadge}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pv)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {fmtPct(p.pct)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.remise_eur ? fmt(p.remise_eur) : (p.pv && p.pct ? fmt(parseFloat(p.pv)*parseFloat(p.pct)/100) : "—")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{fmt(p.pn)}</td>
                        </>}
                        {activeTab === "stratege" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>{p.colis}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.prix)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.remise_eur ? fmt(p.remise_eur) : (p.pv && p.pct ? fmt(parseFloat(p.pv)*parseFloat(p.pct)/100) : "—")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(p.pn)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#666" }}>{fmt(p.carton)}</td>
                        </>}
                        {activeTab === "master" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "center", color: cat.accent, fontWeight: 700 }}>×{p.palier}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pb)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.remise_eur ? fmt(p.remise_eur) : (p.pb && p.pct ? fmt(parseFloat(p.pb)*parseFloat(p.pct)/100) : "—")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{fmt(p.pn)}</td>
                        </>}
                        {activeTab === "obeso" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                            {p.groupe && (
                              <div style={{ fontSize: 9, color: "#3b82f6", fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>{p.groupe.toUpperCase()}</div>
                            )}
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#3b82f6", fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {activeTab === "nr" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {activeTab === "molnlycke" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 350 }}>{p.name}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pv)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: cat.accent }}>{fmt(p.pn)}</td>
                        </>}
                        {activeTab === "blanche" && <>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 300 }}>{p.name}</td>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, textAlign: "center", color: "#666" }}>{p.colis}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.carton != null ? fmt(p.carton) : "–"}</td>
                        </>}
                        {activeTab === "covid" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 320 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {activeTab === "otc" && <>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 260 }}>{p.name}{ruptureBadge}</td>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {cat.isPromo && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                            {ruptureBadge}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{fmtPct(p.pct)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}

                        {/* Qty input */}
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {(() => {
                            const step = getStep(activeTab, p);
                            return (
                              <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", flexDirection: "column" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <button onClick={() => setQty(key, (quantities[key] || 0) - step, step)} style={qtyBtnStyle(cat.accent)}>−</button>
                                  <input
                                    type="number" min="0" step={step} value={quantities[key] || ""}
                                    onChange={e => setQty(key, e.target.value, step)}
                                    onBlur={e => setQty(key, e.target.value, step)}
                                    placeholder="0"
                                    style={{
                                      width: 50, textAlign: "center", border: `1.5px solid ${qty > 0 ? cat.accent : "#ddd"}`,
                                      borderRadius: 6, padding: "4px 4px", fontSize: 13,
                                      fontWeight: qty > 0 ? 700 : 400, color: qty > 0 ? cat.color : "#999",
                                      outline: "none"
                                    }}
                                  />
                                  <button onClick={() => setQty(key, (quantities[key] || 0) + step, step)} style={qtyBtnStyle(cat.accent)}>+</button>
                                </div>
                                {step > 1 && <span style={{ fontSize: 9, color: "#aaa" }}>par {step}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        {/* Subtotal */}
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                          {qty > 0 && subtotal != null
                            ? <span style={{ color: cat.color, background: `${cat.accent}15`, borderRadius: 6, padding: "2px 8px" }}>{fmt(subtotal)}</span>
                            : <span style={{ color: "#ccc" }}>–</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            ) /* fin ternaire desktop */}
          </div>
              )}
          </>}

          {/* Bouton confirmation commande groupée U-Labs */}
          {activeTab === "ulabs" && (() => {
            const myItems = (cat?.products || [])
              .map((p, idx) => ({ p, qty: quantities[`ulabs-${idx}`] || 0, idx }))
              .filter(({ qty }) => qty > 0);
            if (myItems.length === 0) return null;
            const myTotal = myItems.reduce((s, { p, qty }) => {
              const pn = p.pv ? Math.round(p.pv * 0.67 * 100) / 100 : p.pn;
              return s + (pn || 0) * qty;
            }, 0);
            const confirmOrder = async () => {
              if (ulabsConfirming || ulabsConfirmed) return;
              setUlabsConfirming(true);
              const orderId = `UL-${Date.now()}`;
              const items = myItems.map(({ p, qty }) => {
                const pn = p.pv ? Math.round(p.pv * 0.67 * 100) / 100 : p.pn;
                return { cip: p.cip, name: p.name, qty, pn, total: Math.round((pn||0) * qty * 100) / 100 };
              });
              const csv = ["CIP;Désignation;Qté;Prix net HT;Total HT",
                ...items.map(i => `${i.cip};${i.name};${i.qty};${(i.pn||0).toFixed(2)};${(i.total||0).toFixed(2)}`)
              ].join("\n");
              try {
                await fetch("/.netlify/functions/order-save", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: orderId, pharmacyName, pharmacyEmail, pharmacyCip,
                    isClient: true, items, totalHt: myTotal, nbLignes: items.length, csv,
                    source: "ulabs"
                  })
                });
                setUlabsConfirmed(true);
              } catch(e) { console.error(e); }
              setUlabsConfirming(false);
            };
            return (
              <div style={{ position: "sticky", bottom: 20, display: "flex", justifyContent: "center", zIndex: 50, marginTop: 16 }}>
                <div style={{ background: ulabsConfirmed ? "#059669" : "#0d4f3c", borderRadius: 16, padding: "16px 28px", boxShadow: "0 8px 32px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", gap: 20, border: "1px solid #059669" }}>
                  <div>
                    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>{myItems.length} référence(s) · {myItems.reduce((s,{qty})=>s+qty,0)} unités</div>
                    <div style={{ color: "white", fontWeight: 800, fontSize: 18 }}>{fmt(myTotal)} HT <span style={{ fontSize: 11, color: "#34d399", fontWeight: 400 }}>remise −33% incluse</span></div>
                  </div>
                  <button onClick={confirmOrder} disabled={ulabsConfirming || ulabsConfirmed} style={{
                    background: ulabsConfirmed ? "rgba(255,255,255,0.2)" : "#059669",
                    color: "white", border: "none", borderRadius: 10, padding: "10px 22px",
                    fontWeight: 800, fontSize: 14, cursor: ulabsConfirmed ? "default" : "pointer",
                    opacity: ulabsConfirming ? 0.7 : 1
                  }}>
                    {ulabsConfirmed ? "✓ Commande confirmée !" : ulabsConfirming ? "Envoi…" : "✅ Confirmer ma commande"}
                  </button>
                </div>
              </div>
            );
          })()}
          </>
        </main>

        {/* Cart panel */}
        <aside style={isMobile ? {
          position: "fixed", inset: 0, zIndex: 200,
          background: "white", display: cartOpen ? "flex" : "none",
          flexDirection: "column", overflowY: "auto"
        } : {
          width: cartOpen ? 360 : 0, minWidth: cartOpen ? 360 : 0,
          background: "white", borderLeft: cartOpen ? "1px solid #e8edf2" : "none",
          overflow: "hidden", transition: "all 0.3s ease",
          display: "flex", flexDirection: "column",
          boxShadow: cartOpen ? "-4px 0 20px rgba(0,0,0,0.08)" : "none"
        }}>
          {cartOpen && (
            <>
              <div style={{ padding: "20px 20px 0", borderBottom: "1px solid #f0f2f5" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "#1a2a3a" }}>🛒 Panier commun</div>
                  <button onClick={() => setCartOpen(false)} style={{
                    background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#888"
                  }}>×</button>
                </div>
                {pharmacyName && (
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4, marginBottom: 12 }}>📍 {pharmacyName}</div>
                )}
                <div style={{ display: "flex", gap: 12, paddingBottom: 16 }}>
                  <div style={{ flex: 1, background: "#f0f9ff", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: "#666" }}>Lignes</div>
                    <div style={{ fontWeight: 800, fontSize: 20, color: "#0ea5e9" }}>{cartItems.length}</div>
                  </div>
                  <div style={{ flex: 1, background: "#f0fdf4", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: "#666" }}>Unités</div>
                    <div style={{ fontWeight: 800, fontSize: 20, color: "#10b981" }}>{cartCount}</div>
                  </div>
                </div>
              </div>

              <div style={{ overflowY: "auto", padding: "12px 16px" }}>
                {cartItems.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#bbb", padding: 40, fontSize: 14 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
                    Aucun produit sélectionné
                  </div>
                ) : (
                  cartItems.map(item => (
                    <div key={item.key} style={{
                      background: "#fafbfc", borderRadius: 10, padding: "10px 12px",
                      marginBottom: 8, border: `1px solid ${item.color}20`
                    }}>
                      {/* Category + delete button */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                        <div style={{ fontSize: 10, color: item.color, fontWeight: 700, letterSpacing: 0.5 }}>
                          {item.cat.toUpperCase()}
                        </div>
                        <button onClick={() => setQty(item.key, 0)} style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: "#ccc", fontSize: 15, lineHeight: 1, padding: "0 2px"
                        }} title="Supprimer">✕</button>
                      </div>
                      {/* Product name */}
                      <div style={{ fontWeight: 600, fontSize: 12, color: "#1a2a3a", lineHeight: 1.3, marginBottom: 8 }}>{item.name}</div>
                      {/* Qty controls + subtotal */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button onClick={() => setQty(item.key, item.qty - item.step, item.step)} style={{
                            background: item.color + "20", border: `1px solid ${item.color}40`,
                            color: item.color, borderRadius: 6, width: 26, height: 26,
                            cursor: "pointer", fontWeight: 800, fontSize: 16, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}>−</button>
                          <span style={{ fontWeight: 700, fontSize: 14, minWidth: 24, textAlign: "center", color: "#1a2a3a" }}>{item.qty}</span>
                          <button onClick={() => setQty(item.key, item.qty + item.step, item.step)} style={{
                            background: item.color + "20", border: `1px solid ${item.color}40`,
                            color: item.color, borderRadius: 6, width: 26, height: 26,
                            cursor: "pointer", fontWeight: 800, fontSize: 16, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}>+</button>
                          <span style={{ fontSize: 10, color: "#999", marginLeft: 2 }}>× {fmt(item.pn)}</span>
                          {item.step > 1 && <span style={{ fontSize: 9, color: "#bbb" }}>/ par {item.step}</span>}
                        </div>
                        <span style={{ fontWeight: 800, color: "#1a2a3a", fontSize: 13 }}>{fmt(item.total)}</span>
                      </div>
                      {/* Avertissement rupture */}
                      {item.cip && (stockData[item.cip]?.dispo === 0 || stockData[item.cip]?.dispo === false) && (
                        <div style={{ marginTop: 6, fontSize: 11, color: "#dc2626", background: "#fff5f5", borderRadius: 6, padding: "4px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                          ⚠️ <strong>Rupture de stock</strong> — ce produit peut ne pas être disponible à la livraison
                        </div>
                      )}
                    </div>
                  ))
                )}

                {cartItems.length > 0 && (
                <div style={{ padding: "8px 0 16px 0", borderTop: "2px solid #f0f2f5", marginTop: 8 }}>

                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "#666", fontSize: 13 }}>Total HT estimé</span>
                    <span style={{ fontWeight: 800, fontSize: 20, color: "#0f2d3d" }}>{fmt(cartTotal)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#aaa", marginBottom: 8 }}>
                    * Prix nets remisés – Hors conditions spéciales
                  </div>
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12 }}>
                    <span style={{ color: "#15803d", fontWeight: 700 }}>🚚 Livraison estimée : </span>
                    <span style={{ color: "#166534", fontWeight: 800 }}>{nextBusinessDay()}</span>
                  </div>

                  {/* Pharmacy recap */}
                  <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: "#0f2d3d" }}>🏥 {pharmacyName}</div>
                    <div style={{ color: "#666", marginTop: 2 }}>📧 {pharmacyEmail}</div>
                    <div style={{ color: isClient ? "#059669" : "#d97706", marginTop: 2, fontSize: 11 }}>
                      {isClient ? "✅ Client existant" : "🆕 Nouveau client – RIB joint"}
                    </div>
                  </div>

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={sendStatus === "sending"}
                    style={{
                      width: "100%",
                      background: sendStatus === "success"
                        ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                        : sendStatus === "error"
                        ? "linear-gradient(135deg, #e53e3e 0%, #c53030 100%)"
                        : "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                      color: "white", border: "none", borderRadius: 10, padding: "12px",
                      fontWeight: 700, fontSize: 14, cursor: sendStatus === "sending" ? "not-allowed" : "pointer",
                      opacity: sendStatus === "sending" ? 0.7 : 1, marginBottom: 8
                    }}>
                    {sendStatus === "sending" ? "⏳ Envoi en cours..." :
                     sendStatus === "success" ? "✅ Commande envoyée !" :
                     sendStatus === "error" ? "❌ Erreur – Réessayez" :
                     "📧 Envoyer la commande"}
                  </button>

                  <button onClick={handlePrint} style={{
                    width: "100%", background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)",
                    color: "white", border: "none", borderRadius: 10, padding: "10px",
                    fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8
                  }}>🖨 Imprimer le bon de commande</button>
                  <button onClick={handleCopy} style={{
                    width: "100%", background: copyStatus ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "linear-gradient(135deg, #374151 0%, #1f2937 100%)",
                    color: "white", border: "none", borderRadius: 10, padding: "10px",
                    fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8,
                    transition: "background 0.3s"
                  }}>
                    {copyStatus || "📋 Copier le bon de commande"}
                  </button>
                  <button onClick={() => setQuantities({})} style={{
                    width: "100%", background: "none", color: "#e53e3e",
                    border: "1px solid #fed7d7", borderRadius: 10, padding: "8px",
                    fontWeight: 600, fontSize: 12, cursor: "pointer"
                  }}>🗑 Vider le panier</button>
                </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Floating cart button when closed */}
      {!cartOpen && cartCount > 0 && (
        <button onClick={() => setCartOpen(true)} style={{
          position: "fixed", bottom: 24, right: 24,
          background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          color: "white", border: "none", borderRadius: 50, width: 64, height: 64,
          fontSize: 24, cursor: "pointer", boxShadow: "0 8px 24px rgba(16,185,129,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column"
        }}>
          🛒
          <span style={{ fontSize: 10, fontWeight: 800, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "0 4px" }}>{cartCount}</span>
        </button>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        @media (max-width: 767px) {
          table { font-size: 11px !important; }
          table td, table th { padding: 6px 6px !important; }
          .tab-label { display: none; }
        }
        @media print {
          header button, aside button { display: none !important; }
          aside { display: block !important; width: 100% !important; min-width: 100% !important; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e0; border-radius: 3px; }
      `}</style>

      {/* Admin Panel */}
      {showAdmin && (
        <AdminPanel
          sectionMeta={SECTION_META}
          onClose={() => {
            setShowAdmin(false);
            fetchProducts();
            try { setPromoSections(JSON.parse(localStorage.getItem("admin_promos") || "[]")); } catch {}
          }}
        />
      )}
    </div>
  );
}

const tdStyle = {
  padding: "10px 14px", fontSize: 12, color: "#333", verticalAlign: "middle"
};

const qtyBtnStyle = (accent) => ({
  background: accent + "20", border: `1px solid ${accent}40`,
  color: accent, borderRadius: 5, width: 24, height: 24,
  cursor: "pointer", fontWeight: 700, fontSize: 14,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 0
});
