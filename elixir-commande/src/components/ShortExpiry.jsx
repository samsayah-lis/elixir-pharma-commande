import React, { useState, useEffect, useCallback } from "react";

const fmt = (n) => n != null ? parseFloat(n).toFixed(2).replace(".", ",") + " €" : "–";

export default function ShortExpiry({ isAdmin, onAddToCart, pharmacyCip }) {
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [quantities, setQuantities] = useState({});
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [discountInput, setDiscountInput] = useState("");
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [sortBy, setSortBy] = useState("expiry");

  const [syncing, setSyncing] = useState(false);
  const triggerExpirySync = async () => {
    setSyncing(true);
    try {
      // Trigger la background function
      fetch("/.netlify/functions/odoo-expiry-sync-background", { method: "POST", body: "{}" }).catch(() => {});
      // Poll toutes les 5s
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await fetch("/.netlify/functions/odoo-catalog?expiry_months=4");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.products) && data.products.length > 0) {
            setProducts(data.products);
            break;
          }
        }
      }
    } catch (e) { console.warn("[expiry-sync]", e.message); }
    finally { setSyncing(false); }
  };

  // ── Chargement : tous les produits en stock < 4 mois de péremption ────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, discRes] = await Promise.all([
        fetch("/.netlify/functions/odoo-catalog?expiry_months=4"),
        fetch("/.netlify/functions/restock-alert?action=expiry_discounts"),
      ]);
      if (!prodRes.ok) throw new Error(`Erreur catalogue: HTTP ${prodRes.status}`);
      const prodData = await prodRes.json();
      if (prodData.error) throw new Error(prodData.error);
      setProducts(Array.isArray(prodData.products) ? prodData.products : []);

      const discData = await discRes.json();
      const map = {};
      (Array.isArray(discData) ? discData : []).forEach(d => { map[d.cip] = d.discount_pct; });
      setDiscounts(map);
    } catch (e) {
      console.error("[short-expiry]", e.message);
      setError(e.message);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Remise admin ──────────────────────────────────────────────────────
  const saveDiscount = async (cip, productName) => {
    const pct = parseFloat(discountInput) || 0;
    setSavingDiscount(true);
    try {
      await fetch("/.netlify/functions/restock-alert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_expiry_discount", cip, discount_pct: pct, product_name: productName }),
      });
      setDiscounts(prev => ({ ...prev, [cip]: pct }));
      setEditingDiscount(null);
    } catch (e) { console.warn("[discount]", e.message); }
    finally { setSavingDiscount(false); }
  };

  // ── Filtrage et tri ───────────────────────────────────────────────────
  const filtered = products.filter(p =>
    search.length < 2 ||
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.cip?.includes(search)
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "expiry") return (a.earliest_expiry || "9999").localeCompare(b.earliest_expiry || "9999");
    if (sortBy === "name") return (a.name || "").localeCompare(b.name || "", "fr");
    if (sortBy === "stock") return (b.available || 0) - (a.available || 0);
    return 0;
  });

  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date()) / 86400000);
  };

  const expiryColor = (days) => {
    if (days === null) return "#888";
    if (days <= 30) return "#dc2626";
    if (days <= 60) return "#ea580c";
    if (days <= 90) return "#d97706";
    return "#ca8a04";
  };

  const handleAdd = (p) => {
    const qty = parseInt(quantities[p.cip]) || 0;
    if (qty <= 0) return;
    const disc = discounts[p.cip] || 0;
    const price = disc > 0 ? Math.round(p.list_price * (1 - disc / 100) * 100) / 100 : p.list_price;
    onAddToCart?.({ cip: p.cip, name: p.name, qty, pn: price, pv: p.list_price, discount: disc, note: `Pér. ${p.earliest_expiry?.slice(0,10)}` });
    setQuantities(prev => ({ ...prev, [p.cip]: 0 }));
  };

  return (
    <div>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #7c2d12, #ea580c)", borderRadius: 16, padding: "20px 24px", marginBottom: 20, color: "white" }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Péremption courte</div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          Produits en stock avec moins de 4 mois de date de péremption
          {!loading && <span> · {products.length} référence{products.length > 1 ? "s" : ""}</span>}
          {isAdmin && <span style={{ marginLeft: 8, background: "rgba(255,255,255,0.2)", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>Mode admin — remises modifiables</span>}
        </div>
      </div>

      {/* Search + Sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filtrer par nom ou CIP..."
            style={{ width: "100%", padding: "10px 14px 10px 38px", fontSize: 13, border: "1.5px solid #e2e8f0", borderRadius: 10, outline: "none", boxSizing: "border-box" }} />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding: "8px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, background: "white", cursor: "pointer" }}>
          <option value="expiry">Trier : péremption proche</option>
          <option value="name">Trier : A → Z</option>
          <option value="stock">Trier : stock décroissant</option>
        </select>
      </div>

      {/* Loading */}
      {loading && <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Chargement des produits à péremption courte...</div>}

      {/* Error */}
      {!loading && error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#991b1b" }}>{error}</div>
          <button onClick={fetchData} style={{ marginTop: 8, background: "#dc2626", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Réessayer</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && products.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", background: "white", borderRadius: 14 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#0f2d3d", marginBottom: 8 }}>
            {syncing ? "Synchronisation des péremptions en cours..." : "Aucune donnée de péremption"}
          </div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>
            Les dates de péremption doivent être synchronisées depuis Odoo.
          </div>
          <button onClick={triggerExpirySync} disabled={syncing}
            style={{ background: "linear-gradient(135deg, #7c2d12, #ea580c)", color: "white", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "⏳ Synchronisation en cours..." : "🔄 Synchroniser les péremptions Odoo"}
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && sorted.length > 0 && (
        <div style={{ background: "white", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#7c2d12" }}>
                {["CIP", "Désignation", "Stock", "Péremption", "Lots", "Prix de base", isAdmin ? "Remise admin" : "Remise", "Prix remisé", "Qté"].map(h => (
                  <th key={h} style={{ color: "white", padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const days = daysUntil(p.earliest_expiry);
                const disc = discounts[p.cip] || 0;
                const discPrice = disc > 0 ? Math.round(p.list_price * (1 - disc / 100) * 100) / 100 : null;
                const qty = quantities[p.cip] || 0;

                return (
                  <tr key={p.cip} style={{ background: i % 2 === 0 ? "white" : "#fafbfc", borderBottom: "1px solid #f0f2f5" }}>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: "monospace", color: "#888" }}>{p.cip}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13, color: "#0f2d3d", maxWidth: 280 }}>{p.name}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: p.available > 10 ? "#059669" : p.available > 0 ? "#d97706" : "#dc2626" }}>
                        {p.available}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {p.earliest_expiry && (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: expiryColor(days) }}>
                            {new Date(p.earliest_expiry).toLocaleDateString("fr-FR")}
                          </div>
                          <div style={{ fontSize: 10, color: expiryColor(days), fontWeight: 600 }}>
                            {days != null && (days <= 0 ? "EXPIRÉ" : `${days}j restants`)}
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: "#666" }}>
                      {(p.lots || []).slice(0, 3).map((l, j) => (
                        <div key={j} style={{ whiteSpace: "nowrap" }}>
                          {l.lot_name} ({l.qty}) {l.expiry ? `· ${new Date(l.expiry).toLocaleDateString("fr-FR")}` : ""}
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontSize: 13, color: disc > 0 ? "#aaa" : "#0f2d3d", textDecoration: disc > 0 ? "line-through" : "none", fontWeight: disc > 0 ? 400 : 700 }}>
                      {fmt(p.list_price)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      {isAdmin ? (
                        editingDiscount === p.cip ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="number" min="0" max="99" step="1" value={discountInput}
                              onChange={e => setDiscountInput(e.target.value)}
                              onKeyDown={e => e.key === "Enter" && saveDiscount(p.cip, p.name)}
                              autoFocus
                              style={{ width: 48, textAlign: "center", border: "1.5px solid #ea580c", borderRadius: 6, padding: "3px", fontSize: 13, outline: "none" }} />
                            <span style={{ fontSize: 12 }}>%</span>
                            <button onClick={() => saveDiscount(p.cip, p.name)} disabled={savingDiscount}
                              style={{ background: "#059669", color: "white", border: "none", borderRadius: 4, padding: "3px 6px", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>✓</button>
                            <button onClick={() => { setEditingDiscount(null); setDiscountInput(""); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 12 }}>✕</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingDiscount(p.cip); setDiscountInput(String(disc || "")); }}
                            style={{
                              background: disc > 0 ? "#d1fae5" : "#f0f2f5",
                              border: disc > 0 ? "1px solid #6ee7b7" : "1px solid #ddd",
                              borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700,
                              color: disc > 0 ? "#065f46" : "#999", cursor: "pointer",
                            }}>
                            {disc > 0 ? `-${disc}%` : "Définir"}
                          </button>
                        )
                      ) : (
                        disc > 0 ? (
                          <span style={{ background: "#d1fae5", color: "#065f46", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>-{disc}%</span>
                        ) : <span style={{ color: "#ccc" }}>–</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: disc > 0 ? "#059669" : "#0f2d3d" }}>
                        {fmt(discPrice || p.list_price)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                        <button onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: Math.max(0, (parseInt(prev[p.cip]) || 0) - 1) }))}
                          style={{ background: "#f0f2f5", border: "none", borderRadius: 5, width: 24, height: 24, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>−</button>
                        <input type="number" min="0" value={quantities[p.cip] || ""}
                          onChange={e => setQuantities(prev => ({ ...prev, [p.cip]: parseInt(e.target.value) || 0 }))}
                          placeholder="0"
                          style={{ width: 42, textAlign: "center", border: `1.5px solid ${qty > 0 ? "#ea580c" : "#ddd"}`, borderRadius: 5, padding: "3px", fontSize: 13, fontWeight: qty > 0 ? 700 : 400, outline: "none" }} />
                        <button onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: (parseInt(prev[p.cip]) || 0) + 1 }))}
                          style={{ background: "#7c2d12", border: "none", borderRadius: 5, width: 24, height: 24, cursor: "pointer", fontWeight: 700, fontSize: 14, color: "white" }}>+</button>
                      </div>
                      {qty > 0 && (
                        <button onClick={() => handleAdd(p)}
                          style={{ marginTop: 4, background: "#ea580c", color: "white", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                          Ajouter
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
