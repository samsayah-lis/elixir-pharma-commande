import React, { useState, useEffect, useCallback, useRef } from "react";

const fmt = (n) => n != null ? parseFloat(n).toFixed(2).replace(".", ",") + " €" : "–";
const fmtPct = (n) => n > 0 ? `-${n % 1 === 0 ? n : n.toFixed(1)}%` : "";

export default function OrderEntry({ pharmacyCip, pharmacyName, pharmacyEmail, onAddToCart }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [catalogInfo, setCatalogInfo] = useState(null); // { total, in_stock, updated_at }
  const [priceRules, setPriceRules] = useState([]);
  const [pricelistName, setPricelistName] = useState("");
  const [quantities, setQuantities] = useState({});
  const [alerts, setAlerts] = useState({});
  const [alertSaving, setAlertSaving] = useState({});
  const [stockOnly, setStockOnly] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // ── Chargement initial : count + pricelist + alerts ───────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Count des produits (léger, pas de 502)
        const countRes = await fetch("/.netlify/functions/odoo-catalog?count=1");
        if (countRes.ok) {
          const countData = await countRes.json();
          if (!cancelled) setCatalogInfo(countData);
        }

        // Liste de prix
        if (pharmacyCip) {
          try {
            const plRes = await fetch(`/.netlify/functions/odoo-pricelist?pharmacy_cip=${pharmacyCip}`);
            const plData = await plRes.json();
            if (!cancelled && plData.rules) setPriceRules(plData.rules);
            if (!cancelled && plData.pricelists?.[0]?.name) setPricelistName(plData.pricelists[0].name);
          } catch (e) { console.warn("[pricelist]", e.message); }
        }

        // Alertes
        if (pharmacyCip) {
          try {
            const alertRes = await fetch(`/.netlify/functions/restock-alert?pharmacy_cip=${pharmacyCip}`);
            const alertData = await alertRes.json();
            const map = {};
            (Array.isArray(alertData) ? alertData : []).forEach(a => { map[a.cip] = true; });
            if (!cancelled) setAlerts(map);
          } catch (e) { console.warn("[alerts]", e.message); }
        }
      } catch (e) { console.warn("[init]", e.message); }
    })();
    return () => { cancelled = true; };
  }, [pharmacyCip]);

  // ── Recherche côté serveur ────────────────────────────────────────────
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `/.netlify/functions/odoo-catalog?q=${encodeURIComponent(query.trim())}&limit=100${stockOnly ? "&stock_only=1" : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(Array.isArray(data.products) ? data.products : []);
      } catch (e) {
        console.warn("[search]", e.message);
        setResults([]);
      }
      finally { setSearching(false); }
    }, 350);
  }, [query, stockOnly]);

  // ── Prix remisé ───────────────────────────────────────────────────────
  const getDiscountedPrice = useCallback((product) => {
    if (!product || priceRules.length === 0) return { price: product?.list_price, discount: 0 };
    const base = product.list_price || 0;
    const rule = priceRules.find(r => r.product_id && r.cip === product.cip)
      || priceRules.find(r => r.applied_on === "3_global");
    if (!rule) return { price: base, discount: 0 };
    if (rule.type === "fixed" && rule.fixed_price != null) return { price: rule.fixed_price, discount: Math.round((1 - rule.fixed_price / base) * 100) };
    if ((rule.type === "percentage" || rule.type === "formula") && rule.discount > 0) {
      return { price: Math.round(base * (1 - rule.discount / 100) * 100) / 100 + (rule.surcharge || 0), discount: rule.discount };
    }
    return { price: base, discount: 0 };
  }, [priceRules]);

  // ── Alerte retour en stock ────────────────────────────────────────────
  const toggleAlert = async (product) => {
    const cip = product.cip;
    setAlertSaving(prev => ({ ...prev, [cip]: true }));
    if (alerts[cip]) {
      await fetch(`/.netlify/functions/restock-alert?pharmacy_cip=${pharmacyCip}&cip=${cip}`, { method: "DELETE" });
      setAlerts(prev => { const n = { ...prev }; delete n[cip]; return n; });
    } else {
      await fetch("/.netlify/functions/restock-alert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_cip: pharmacyCip, pharmacy_email: pharmacyEmail, cip, product_name: product.name }),
      });
      setAlerts(prev => ({ ...prev, [cip]: true }));
    }
    setAlertSaving(prev => ({ ...prev, [cip]: false }));
  };

  const handleAdd = (product) => {
    const qty = parseInt(quantities[product.cip]) || 0;
    if (qty <= 0) return;
    const { price, discount } = getDiscountedPrice(product);
    onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: price, pv: product.list_price, discount });
    setQuantities(prev => ({ ...prev, [product.cip]: 0 }));
  };

  // ── Refresh catalogue ─────────────────────────────────────────────────
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      await fetch("/.netlify/functions/odoo-catalog?refresh=1");
      // Poll le count toutes les 5s
      const startTotal = catalogInfo?.total || 0;
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await fetch("/.netlify/functions/odoo-catalog?count=1");
        if (res.ok) {
          const data = await res.json();
          if (data.total > startTotal || (startTotal === 0 && data.total > 0)) {
            setCatalogInfo(data);
            break;
          }
        }
      }
      // Recharger le count final
      const finalRes = await fetch("/.netlify/functions/odoo-catalog?count=1");
      if (finalRes.ok) setCatalogInfo(await finalRes.json());
    } catch (e) { setError("Refresh échoué : " + e.message); }
    finally { setRefreshing(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const hasProducts = catalogInfo && catalogInfo.total > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f2d3d, #1a4a5e)", borderRadius: 16, padding: "20px 24px", marginBottom: 20, color: "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Saisie de commande</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              Recherchez par code CIP ou nom de produit
              {pricelistName && <span> · Liste de prix : <strong>{pricelistName}</strong></span>}
              {catalogInfo?.updated_at && <span> · Màj : {new Date(catalogInfo.updated_at).toLocaleString("fr-FR", {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>}
            </div>
          </div>
          <button onClick={handleRefresh} disabled={refreshing}
            style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "white", borderRadius: 10, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.5 : 1, whiteSpace: "nowrap" }}>
            {refreshing ? "⏳ Actualisation en cours..." : "🔄 Actualiser depuis Odoo"}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, opacity: 0.4 }}>🔍</span>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Saisissez un code CIP (ex: 3400930...) ou un nom de produit..."
          autoFocus
          style={{ width: "100%", padding: "14px 16px 14px 44px", fontSize: 15, border: "2px solid #e2e8f0", borderRadius: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "white", transition: "border 0.2s" }}
          onFocus={e => e.target.style.borderColor = "#2d9cbc"}
          onBlur={e => e.target.style.borderColor = "#e2e8f0"}
        />
        {query && <button onClick={() => setQuery("")} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#bbb" }}>✕</button>}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", fontSize: 13 }}>
          <input type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#10b981", cursor: "pointer" }} />
          <span style={{ fontWeight: stockOnly ? 700 : 400, color: stockOnly ? "#059669" : "#666" }}>
            N'afficher que les produits en stock
          </span>
        </label>
        {catalogInfo && (
          <span style={{ fontSize: 11, color: "#aaa" }}>
            <span style={{ background: "#d1fae5", color: "#065f46", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>{catalogInfo.in_stock} en stock</span>
            <span style={{ marginLeft: 6 }}>sur {catalogInfo.total} produits</span>
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#991b1b" }}>{error}</div>
          <button onClick={() => { setError(null); handleRefresh(); }} style={{ marginTop: 8, background: "#dc2626", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Réessayer</button>
        </div>
      )}

      {/* Empty catalog — first load needed */}
      {!hasProducts && !error && (
        <div style={{ textAlign: "center", padding: "60px 20px", background: "white", borderRadius: 14 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f2d3d", marginBottom: 8 }}>Catalogue vide — premier chargement nécessaire</div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>Cliquez ci-dessous pour charger les produits depuis Odoo.</div>
          <button onClick={handleRefresh} disabled={refreshing}
            style={{ background: "linear-gradient(135deg, #0f2d3d, #1a4a5e)", color: "white", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.6 : 1 }}>
            {refreshing ? "⏳ Chargement en cours..." : "🔄 Charger le catalogue Odoo"}
          </button>
        </div>
      )}

      {/* Empty search */}
      {hasProducts && query.length < 2 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Saisissez au moins 2 caractères</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Code CIP, EAN, ou début de nom</div>
        </div>
      )}

      {/* Search results */}
      {query.length >= 2 && (
        <div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
            {searching ? "Recherche..." : `${results.length} résultat${results.length > 1 ? "s" : ""} pour « ${query} »`}
          </div>
          {!searching && results.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#aaa", background: "white", borderRadius: 14 }}>
              Aucun produit trouvé pour « {query} »{stockOnly ? " (filtre en stock actif)" : ""}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map(p => {
              const { price, discount } = getDiscountedPrice(p);
              const qty = quantities[p.cip] || 0;
              const isAlert = alerts[p.cip];
              return (
                <div key={p.cip} style={{
                  background: "white", borderRadius: 14, padding: "14px 18px",
                  border: p.in_stock ? "1px solid #e8ecf0" : "1px solid #fed7d7",
                  display: "flex", alignItems: "center", gap: 16, opacity: p.in_stock ? 1 : 0.85,
                }}>
                  {/* Stock badge */}
                  <div style={{ flexShrink: 0, textAlign: "center", minWidth: 52 }}>
                    {p.in_stock ? (
                      <div style={{ background: "#d1fae5", color: "#065f46", borderRadius: 8, padding: "4px 8px", fontSize: 10, fontWeight: 700 }}>
                        EN STOCK<div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{p.available}</div>
                      </div>
                    ) : (
                      <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "4px 8px", fontSize: 10, fontWeight: 700 }}>RUPTURE</div>
                    )}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2d3d", lineHeight: 1.3 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                      CIP : <span style={{ fontFamily: "monospace" }}>{p.cip}</span>
                      {p.earliest_expiry && <span style={{ marginLeft: 10, color: "#b45309" }}>Pér. : {new Date(p.earliest_expiry).toLocaleDateString("fr-FR")}</span>}
                    </div>
                  </div>
                  {/* Prix */}
                  <div style={{ flexShrink: 0, textAlign: "right", minWidth: 100 }}>
                    {discount > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 11, color: "#aaa", textDecoration: "line-through" }}>{fmt(p.list_price)}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "white", background: "#10b981", borderRadius: 4, padding: "1px 5px" }}>{fmtPct(discount)}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 18, fontWeight: 800, color: discount > 0 ? "#059669" : "#0f2d3d" }}>{fmt(price)}</div>
                    <div style={{ fontSize: 10, color: "#bbb" }}>Prix unitaire HT</div>
                  </div>
                  {/* Actions */}
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 120 }}>
                    {p.in_stock ? (<>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: Math.max(0, (parseInt(prev[p.cip]) || 0) - 1) }))}
                          style={{ background: "#f0f2f5", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>−</button>
                        <input type="number" min="0" value={quantities[p.cip] || ""} onChange={e => setQuantities(prev => ({ ...prev, [p.cip]: parseInt(e.target.value) || 0 }))}
                          placeholder="0" style={{ width: 48, textAlign: "center", border: "1.5px solid #ddd", borderRadius: 6, padding: "4px", fontSize: 14, fontWeight: qty > 0 ? 700 : 400, outline: "none" }} />
                        <button onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: (parseInt(prev[p.cip]) || 0) + 1 }))}
                          style={{ background: "#0f2d3d", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontWeight: 700, fontSize: 16, color: "white" }}>+</button>
                      </div>
                      {qty > 0 && (
                        <button onClick={() => handleAdd(p)}
                          style={{ background: "#10b981", color: "white", border: "none", borderRadius: 8, padding: "5px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          Ajouter {fmt(price * qty)}
                        </button>
                      )}
                    </>) : (
                      <button onClick={() => toggleAlert(p)} disabled={alertSaving[p.cip]}
                        style={{
                          background: isAlert ? "#fef3c7" : "#eff6ff", border: isAlert ? "1px solid #fbbf24" : "1px solid #93c5fd",
                          color: isAlert ? "#92400e" : "#1e40af", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700,
                          cursor: "pointer", opacity: alertSaving[p.cip] ? 0.5 : 1,
                        }}>
                        {isAlert ? "✓ Alerte activée" : "🔔 M'avertir du retour"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
