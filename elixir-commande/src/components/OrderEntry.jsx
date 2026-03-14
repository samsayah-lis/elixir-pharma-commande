import React, { useState, useEffect, useCallback, useRef } from "react";

const fmt = (n) => n != null ? parseFloat(n).toFixed(2).replace(".", ",") + " €" : "–";
const fmtPct = (n) => n > 0 ? `-${n % 1 === 0 ? n : n.toFixed(1)}%` : "";

export default function OrderEntry({ pharmacyCip, pharmacyName, pharmacyEmail, onAddToCart }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [catalog, setCatalog] = useState(null); // full catalog cache
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState(null);
  const [priceRules, setPriceRules] = useState([]); // pharmacie pricelist rules
  const [pricelistName, setPricelistName] = useState("");
  const [quantities, setQuantities] = useState({});
  const [alerts, setAlerts] = useState({}); // { cip: true } = alerte active
  const [alertSaving, setAlertSaving] = useState({});
  const [stockOnly, setStockOnly] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // ── Chargement initial : catalogue Odoo + liste de prix ───────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const catRes = await fetch("/.netlify/functions/odoo-catalog");
        if (!catRes.ok) throw new Error(`Odoo HTTP ${catRes.status}`);
        const catData = await catRes.json();
        if (catData.error) throw new Error(catData.error);
        if (cancelled) return;
        if (catData.products) {
          setCatalog(catData.products);
          setCatalogUpdatedAt(catData.updated_at || null);
          console.log(`[order-entry] ✓ ${catData.products.length} produits chargés depuis Odoo`);
        } else {
          setCatalog([]);
          console.warn("[order-entry] Catalogue vide — aucun produit retourné");
        }

        // Liste de prix
        if (pharmacyCip) {
          try {
            const plRes = await fetch(`/.netlify/functions/odoo-pricelist?pharmacy_cip=${pharmacyCip}`);
            const plData = await plRes.json();
            if (plData.rules) setPriceRules(plData.rules);
            if (plData.pricelists?.[0]?.name) setPricelistName(plData.pricelists[0].name);
            console.log(`[order-entry] ✓ ${plData.rules?.length || 0} règles de prix`);
          } catch (e) { console.warn("[order-entry] pricelist error:", e.message); }
        }

        // Alertes retour en stock
        if (pharmacyCip) {
          try {
            const alertRes = await fetch(`/.netlify/functions/restock-alert?pharmacy_cip=${pharmacyCip}`);
            const alertData = await alertRes.json();
            const map = {};
            (Array.isArray(alertData) ? alertData : []).forEach(a => { map[a.cip] = true; });
            setAlerts(map);
          } catch (e) { console.warn("[order-entry] alerts error:", e.message); }
        }
      } catch (e) {
        console.error("[order-entry] ERREUR:", e.message);
        if (!cancelled) setError(e.message);
      }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [pharmacyCip]);

  // ── Recherche locale dans le catalogue ────────────────────────────────
  useEffect(() => {
    if (!catalog || query.trim().length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const q = query.toLowerCase().trim();
      const found = catalog.filter(p => {
        if (stockOnly && !p.in_stock) return false;
        return p.name?.toLowerCase().includes(q) || p.cip?.includes(q) || p.barcode?.includes(q);
      }).slice(0, 100);
      setResults(found);
    }, 200);
  }, [query, catalog, stockOnly]);

  // ── Calcul du prix remisé selon la liste de prix ──────────────────────
  const getDiscountedPrice = useCallback((product) => {
    if (!product || priceRules.length === 0) return { price: product?.list_price, discount: 0, rule: null };
    const base = product.list_price || 0;

    // Chercher une règle spécifique au produit, puis à la catégorie, puis globale
    const matchingRules = priceRules.filter(r => {
      if (r.product_id && r.cip === product.cip) return true;
      if (r.applied_on === "3_global") return true;
      return false;
    }).sort((a, b) => {
      // Priorité : produit spécifique > catégorie > global
      if (a.product_id && !b.product_id) return -1;
      if (!a.product_id && b.product_id) return 1;
      return 0;
    });

    const rule = matchingRules[0];
    if (!rule) return { price: base, discount: 0, rule: null };

    if (rule.type === "fixed" && rule.fixed_price != null) {
      return { price: rule.fixed_price, discount: Math.round((1 - rule.fixed_price / base) * 100), rule };
    }
    if (rule.type === "percentage" && rule.discount > 0) {
      const discounted = Math.round(base * (1 - rule.discount / 100) * 100) / 100;
      return { price: discounted + (rule.surcharge || 0), discount: rule.discount, rule };
    }
    if (rule.type === "formula" && rule.discount > 0) {
      const discounted = Math.round(base * (1 - rule.discount / 100) * 100) / 100;
      return { price: discounted + (rule.surcharge || 0), discount: rule.discount, rule };
    }
    return { price: base, discount: 0, rule };
  }, [priceRules]);

  // ── Alerte retour en stock ────────────────────────────────────────────
  const toggleAlert = async (product) => {
    const cip = product.cip;
    if (alerts[cip]) {
      setAlertSaving(prev => ({ ...prev, [cip]: true }));
      await fetch(`/.netlify/functions/restock-alert?pharmacy_cip=${pharmacyCip}&cip=${cip}`, { method: "DELETE" });
      setAlerts(prev => { const n = { ...prev }; delete n[cip]; return n; });
      setAlertSaving(prev => ({ ...prev, [cip]: false }));
    } else {
      setAlertSaving(prev => ({ ...prev, [cip]: true }));
      await fetch("/.netlify/functions/restock-alert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_cip: pharmacyCip, pharmacy_email: pharmacyEmail, cip, product_name: product.name }),
      });
      setAlerts(prev => ({ ...prev, [cip]: true }));
      setAlertSaving(prev => ({ ...prev, [cip]: false }));
    }
  };

  const handleAdd = (product) => {
    const qty = parseInt(quantities[product.cip]) || 0;
    if (qty <= 0) return;
    const { price, discount } = getDiscountedPrice(product);
    onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: price, pv: product.list_price, discount });
    setQuantities(prev => ({ ...prev, [product.cip]: 0 }));
  };

  // ── Refresh catalogue depuis Odoo (background) ─────────────────────
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      // 1. Déclenche la background function (retourne 202 immédiatement)
      await fetch("/.netlify/functions/odoo-catalog?refresh=1");
      console.log("[refresh] Background sync lancé, polling Supabase...");

      // 2. Poll Supabase toutes les 5s jusqu'à ce que des produits apparaissent (max 2min)
      const startCount = catalog?.length || 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await fetch("/.netlify/functions/odoo-catalog");
        const data = await res.json();
        if (data.products && data.products.length > startCount) {
          setCatalog(data.products);
          setCatalogUpdatedAt(data.updated_at);
          console.log(`[refresh] ✓ ${data.products.length} produits chargés`);
          setRefreshing(false);
          return;
        }
      }
      // Si rien après 2min, afficher ce qu'on a
      const finalRes = await fetch("/.netlify/functions/odoo-catalog");
      const finalData = await finalRes.json();
      if (finalData.products?.length > 0) {
        setCatalog(finalData.products);
        setCatalogUpdatedAt(finalData.updated_at);
      } else {
        setError("Le chargement Odoo semble prendre plus de temps que prévu. Réessayez dans quelques minutes.");
      }
    } catch (e) {
      console.error("[refresh]", e.message);
      setError("Refresh échoué : " + e.message);
    }
    finally { setRefreshing(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────
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
              {catalogUpdatedAt && <span> · Màj : {new Date(catalogUpdatedAt).toLocaleString("fr-FR", {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>}
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "white", borderRadius: 10, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.5 : 1, whiteSpace: "nowrap" }}
          >
            {refreshing ? "⏳ Actualisation Odoo en cours..." : "🔄 Actualiser depuis Odoo"}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, opacity: 0.4 }}>🔍</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Saisissez un code CIP (ex: 3400930...) ou un nom de produit..."
          autoFocus
          style={{
            width: "100%", padding: "14px 16px 14px 44px", fontSize: 15, border: "2px solid #e2e8f0",
            borderRadius: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
            background: "white", transition: "border 0.2s",
          }}
          onFocus={e => e.target.style.borderColor = "#2d9cbc"}
          onBlur={e => e.target.style.borderColor = "#e2e8f0"}
        />
        {query && <button onClick={() => setQuery("")} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#bbb" }}>✕</button>}
      </div>

      {/* Stock filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", fontSize: 13, color: "#444" }}>
          <input
            type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#10b981", cursor: "pointer" }}
          />
          <span style={{ fontWeight: stockOnly ? 700 : 400, color: stockOnly ? "#059669" : "#666" }}>
            N'afficher que les produits en stock
          </span>
        </label>
        {catalog && (
          <span style={{ fontSize: 11, color: "#aaa" }}>
            {catalog.filter(p => p.in_stock).length} en stock sur {catalog.length}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
        Chargement du catalogue Odoo...
      </div>}

      {/* Error */}
      {!loading && error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#991b1b", marginBottom: 6 }}>Erreur de chargement du catalogue Odoo</div>
          <div style={{ fontSize: 12, color: "#b91c1c", fontFamily: "monospace", wordBreak: "break-all" }}>{error}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 12, background: "#dc2626", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Réessayer</button>
        </div>
      )}

      {/* Catalog loaded indicator */}
      {!loading && !error && catalog && (
        <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#d1fae5", color: "#065f46", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>
            {catalog.length} produit{catalog.length > 1 ? "s" : ""} Odoo
          </span>
          {priceRules.length > 0 && (
            <span style={{ background: "#dbeafe", color: "#1e40af", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>
              {priceRules.length} règle{priceRules.length > 1 ? "s" : ""} de prix{pricelistName ? ` · ${pricelistName}` : ""}
            </span>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && catalog && catalog.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", background: "white", borderRadius: 14 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f2d3d", marginBottom: 8 }}>Catalogue vide — premier chargement nécessaire</div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>Cliquez sur le bouton ci-dessous pour charger les produits depuis Odoo. Cette opération prend environ 45 secondes.</div>
          <button onClick={handleRefresh} disabled={refreshing}
            style={{ background: "linear-gradient(135deg, #0f2d3d, #1a4a5e)", color: "white", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.6 : 1 }}>
            {refreshing ? "⏳ Chargement depuis Odoo en cours..." : "🔄 Charger le catalogue Odoo"}
          </button>
        </div>
      )}

      {!loading && !error && query.length < 2 && catalog && catalog.length > 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Saisissez au moins 2 caractères</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Code CIP, EAN, ou début de nom — {catalog.length} produits disponibles</div>
        </div>
      )}

      {/* Results */}
      {query.length >= 2 && (
        <div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
            {results.length} résultat{results.length > 1 ? "s" : ""} pour « {query} »
          </div>
          {results.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#aaa", background: "white", borderRadius: 14 }}>
              Aucun produit trouvé pour « {query} »
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
                  display: "flex", alignItems: "center", gap: 16,
                  opacity: p.in_stock ? 1 : 0.85,
                }}>
                  {/* Stock badge */}
                  <div style={{ flexShrink: 0, textAlign: "center", minWidth: 52 }}>
                    {p.in_stock ? (
                      <div style={{ background: "#d1fae5", color: "#065f46", borderRadius: 8, padding: "4px 8px", fontSize: 10, fontWeight: 700 }}>
                        EN STOCK
                        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{p.available}</div>
                      </div>
                    ) : (
                      <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "4px 8px", fontSize: 10, fontWeight: 700 }}>
                        RUPTURE
                      </div>
                    )}
                  </div>

                  {/* Product info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2d3d", lineHeight: 1.3 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                      CIP : <span style={{ fontFamily: "monospace" }}>{p.cip}</span>
                      {p.earliest_expiry && (
                        <span style={{ marginLeft: 10, color: "#b45309" }}>Pér. : {new Date(p.earliest_expiry).toLocaleDateString("fr-FR")}</span>
                      )}
                    </div>
                  </div>

                  {/* Pricing */}
                  <div style={{ flexShrink: 0, textAlign: "right", minWidth: 100 }}>
                    {discount > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 11, color: "#aaa", textDecoration: "line-through" }}>{fmt(p.list_price)}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "white", background: "#10b981", borderRadius: 4, padding: "1px 5px" }}>{fmtPct(discount)}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 18, fontWeight: 800, color: discount > 0 ? "#059669" : "#0f2d3d" }}>
                      {fmt(price)}
                    </div>
                    <div style={{ fontSize: 10, color: "#bbb" }}>Prix unitaire HT</div>
                  </div>

                  {/* Quantity + actions */}
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 120 }}>
                    {p.in_stock ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: Math.max(0, (parseInt(prev[p.cip]) || 0) - 1) }))}
                            style={{ background: "#f0f2f5", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>−</button>
                          <input type="number" min="0" value={quantities[p.cip] || ""}
                            onChange={e => setQuantities(prev => ({ ...prev, [p.cip]: parseInt(e.target.value) || 0 }))}
                            placeholder="0"
                            style={{ width: 48, textAlign: "center", border: "1.5px solid #ddd", borderRadius: 6, padding: "4px", fontSize: 14, fontWeight: qty > 0 ? 700 : 400, outline: "none" }}
                          />
                          <button onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: (parseInt(prev[p.cip]) || 0) + 1 }))}
                            style={{ background: "#0f2d3d", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontWeight: 700, fontSize: 16, color: "white" }}>+</button>
                        </div>
                        {qty > 0 && (
                          <button onClick={() => handleAdd(p)}
                            style={{ background: "#10b981", color: "white", border: "none", borderRadius: 8, padding: "5px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            Ajouter {fmt(price * qty)}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={() => toggleAlert(p)}
                        disabled={alertSaving[p.cip]}
                        style={{
                          background: isAlert ? "#fef3c7" : "#eff6ff",
                          border: isAlert ? "1px solid #fbbf24" : "1px solid #93c5fd",
                          color: isAlert ? "#92400e" : "#1e40af",
                          borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                          opacity: alertSaving[p.cip] ? 0.5 : 1,
                        }}
                      >
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
