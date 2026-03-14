import React, { useState, useEffect, useMemo } from "react";

const fmt = (n) => n != null ? n.toFixed(2).replace(".", ",") + " €" : "–";

// ── CROSS-SELL : "Les pharmacies qui commandent X commandent aussi Y" ──
export function CrossSellBanner({ cartCips = [], onAdd, accent = "#10b981" }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(new Set());
  const uniqueCips = useMemo(() => [...new Set(cartCips.filter(Boolean))], [cartCips]);

  useEffect(() => {
    if (uniqueCips.length === 0) { setRecs([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const all = await Promise.all(
          uniqueCips.slice(0, 5).map(async cip => {
            const res = await fetch(`/.netlify/functions/ml-recommend?cip=${cip}&limit=3`);
            const d = await res.json();
            return (d.recommendations || []).map(r => ({ ...r, sourceCip: cip }));
          })
        );
        if (cancelled) return;
        const seen = new Set(uniqueCips);
        const deduped = [];
        for (const r of all.flat().sort((a, b) => b.lift - a.lift)) {
          if (!seen.has(r.cip) && !dismissed.has(r.cip)) { seen.add(r.cip); deduped.push(r); }
        }
        setRecs(deduped.slice(0, 4));
      } catch (e) { console.warn("[cross-sell]", e.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [uniqueCips, dismissed]);

  if (recs.length === 0 && !loading) return null;

  return (
    <div style={{ background: `linear-gradient(135deg, ${accent}08, ${accent}15)`, border: `1px solid ${accent}30`, borderRadius: 14, padding: "14px 18px", marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2d3d" }}>Produits complémentaires</span>
        <span style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>Basé sur les commandes d'autres pharmacies</span>
      </div>
      {loading && recs.length === 0 ? (
        <div style={{ fontSize: 12, color: "#aaa", padding: "8px 0" }}>Recherche de recommandations...</div>
      ) : (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {recs.map(rec => (
            <div key={rec.cip} style={{ background: "white", borderRadius: 10, padding: "10px 14px", minWidth: 180, maxWidth: 220, border: "1px solid #e8ecf0", display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
              {rec.image_url && <img src={rec.image_url} alt="" style={{ width: "100%", height: 60, objectFit: "contain", borderRadius: 6, background: "#f8fafc" }} />}
              <div style={{ fontWeight: 600, fontSize: 12, color: "#1a2a3a", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{rec.name || rec.cip}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ fontSize: 10, color: accent, fontWeight: 700, background: `${accent}15`, borderRadius: 4, padding: "1px 6px" }}>
                  {rec.lift >= 3 ? "Très pertinent" : rec.lift >= 2 ? "Pertinent" : "Suggéré"}
                </div>
              </div>
              {rec.pn != null && <div style={{ fontSize: 14, fontWeight: 800, color: "#0f2d3d" }}>{fmt(rec.pn)}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                <button onClick={() => onAdd?.(rec.cip, 1)} style={{ flex: 1, background: accent, color: "white", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Ajouter</button>
                <button onClick={() => setDismissed(p => new Set([...p, rec.cip]))} style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 14, padding: "0 4px" }} title="Masquer">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── RE-ORDER : "Réapprovisionnement suggéré" à la connexion ────────────
export function ReorderSuggestion({ pharmacyCip, onApply }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!pharmacyCip) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/.netlify/functions/ml-recommend?pharmacy_cip=${pharmacyCip}&mode=reorder&limit=15`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data.suggestions))
          setSuggestions(data.suggestions.filter(s => s.should_reorder));
      } catch (e) { console.warn("[reorder]", e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [pharmacyCip]);

  if (!visible || (suggestions.length === 0 && !loading)) return null;

  return (
    <div style={{ background: "linear-gradient(135deg, #eff6ff, #dbeafe)", border: "1px solid #93c5fd", borderRadius: 16, padding: "18px 22px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#1e40af" }}>Réapprovisionnement suggéré</div>
          <div style={{ fontSize: 12, color: "#3b82f6", marginTop: 2 }}>Basé sur votre historique de commandes</div>
        </div>
        <button onClick={() => setVisible(false)} style={{ background: "rgba(255,255,255,0.5)", border: "none", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14, color: "#93c5fd" }}>✕</button>
      </div>
      {loading ? <div style={{ fontSize: 12, color: "#93c5fd" }}>Analyse de votre historique...</div> : (<>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {suggestions.slice(0, 6).map(s => (
            <div key={s.cip} style={{ display: "flex", alignItems: "center", gap: 12, background: "white", borderRadius: 10, padding: "8px 14px", border: "1px solid #dbeafe" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#1a2a3a", lineHeight: 1.3 }}>{s.name || s.cip}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                  Dernière commande il y a {s.days_since_last}j · Habituellement tous les {s.avg_interval_days}j
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1e40af" }}>×{s.suggested_qty}</div>
                <div style={{ fontSize: 10, color: "#93c5fd" }}>qté suggérée</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => { const cart = {}; suggestions.forEach(s => { cart[s.cip] = s.suggested_qty; }); onApply?.(cart); setVisible(false); }}
          style={{ width: "100%", background: "linear-gradient(135deg, #1e40af, #3b82f6)", color: "white", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          Pré-remplir mon panier ({suggestions.length} référence{suggestions.length > 1 ? "s" : ""})
        </button>
      </>)}
    </div>
  );
}
