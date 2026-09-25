import React, { useState, useEffect, useMemo } from "react";
import { recommend, SIZES, SIZE_LABELS, WHEELCHAIR_CIPS, cipForSize, MEASURE_BANDS, WEIGHT_BANDS } from "../wheelchair-logic.js";
import { TierBadge, applyTiers } from "../tiers.jsx";

const fmt = (n) => n != null ? parseFloat(n).toFixed(2).replace(".", ",") + " €" : "–";
const fmtPct = (n) => n > 0 ? `-${n % 1 === 0 ? n : n.toFixed(1)}%` : "";

const card = { background: "white", borderRadius: 14, padding: "18px 22px", border: "1px solid #e8ecf0" };
const h2 = { fontSize: 13, fontWeight: 800, color: "#0f2d3d", letterSpacing: 0.3, textTransform: "uppercase", margin: "0 0 12px" };
const input = { width: 120, border: "1.5px solid #d6dde3", borderRadius: 8, padding: "8px 10px", fontSize: 16, fontWeight: 700, outline: "none", fontFamily: "inherit" };
const label = { fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 };

// Parcours guidé : largeur d'assise → fauteuil Invacare correspondant (stock + prix Odoo).
export default function WheelchairOrder({ onAddToCart }) {
  const [method, setMethod] = useState("mesure");
  const [measure, setMeasure] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [manualIdx, setManualIdx] = useState(null);
  const [qty, setQty] = useState(1);
  const [products, setProducts] = useState({});
  const [loading, setLoading] = useState(true);

  // Stock et prix des 4 tailles, depuis le catalogue Odoo synchronisé.
  useEffect(() => {
    let cancelled = false;
    Promise.all(WHEELCHAIR_CIPS.map(cip =>
      fetch(`/.netlify/functions/odoo-catalog?limit=3&q=${cip}`).then(r => r.json())
        .then(j => (j.products || []).find(p => p.cip === cip) || null).catch(() => null)
    )).then(list => {
      if (cancelled) return;
      const map = {}; list.forEach((p, i) => { if (p) map[WHEELCHAIR_CIPS[i]] = p; });
      setProducts(map); setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const result = useMemo(() => recommend({ method, measure, weight, height }), [method, measure, weight, height]);
  const selectedIdx = manualIdx ?? (result && result.idx != null ? result.idx : null);
  const product = selectedIdx != null ? products[cipForSize(selectedIdx)] : null;
  const unitPrice = product ? (product.discounted_price && product.discount_pct > 0 ? product.discounted_price : product.list_price) : null;
  const tiered = product ? applyTiers(unitPrice, product.price_tiers, qty) : null;

  const add = () => {
    if (!product || qty < 1) return;
    onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: unitPrice, pv: product.list_price,
                    discount: product.discount_pct || 0, tiers: product.price_tiers || null });
  };
  const reset = () => { setMeasure(""); setWeight(""); setHeight(""); setManualIdx(null); setQty(1); };

  const seg = (key, text) => (
    <button onClick={() => { setMethod(key); setManualIdx(null); }} style={{
      flex: 1, border: "none", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13,
      background: method === key ? "#0f2d3d" : "transparent", color: method === key ? "white" : "#475569" }}>{text}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* En-tête */}
      <div style={{ background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", borderRadius: 14, padding: "18px 24px", color: "white" }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>🦽 Commande fauteuil roulant</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          Déterminez la largeur d'assise (4 tailles standard : 40,5 · 43 · 45,5 · 48 cm), le bon fauteuil Invacare Action 2NG s'affiche avec son stock et son prix.
        </div>
      </div>

      {/* 1 · Informations */}
      <div style={card}>
        <h2 style={h2}>1 · Informations disponibles</h2>
        <div style={{ display: "flex", background: "#f0f2f5", borderRadius: 10, padding: 4, gap: 4, marginBottom: 14, maxWidth: 520 }}>
          {seg("mesure", "Mesure disponible (recommandé)")}
          {seg("poids", "Pas de mesure → poids")}
        </div>
        {method === "mesure" ? (
          <div>
            <label style={label}>Largeur mesurée aux hanches / cuisses, patient assis (cm)</label>
            <input type="number" step="0.5" min="20" max="80" value={measure} onChange={e => { setMeasure(e.target.value); setManualIdx(null); }} placeholder="ex. 42" style={input} />
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Largeur d'assise = mesure + 2,5 à 5 cm de jeu. Voir « Comment prendre la mesure » ci-dessous.</div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <label style={label}>Poids (kg)</label>
              <input type="number" step="0.5" min="20" max="250" value={weight} onChange={e => { setWeight(e.target.value); setManualIdx(null); }} placeholder="ex. 68" style={input} />
            </div>
            <div>
              <label style={label}>Taille (cm) <span style={{ fontWeight: 400, color: "#94a3b8" }}>— optionnel, affine via l'IMC</span></label>
              <input type="number" step="1" min="100" max="230" value={height} onChange={e => { setHeight(e.target.value); setManualIdx(null); }} placeholder="ex. 170" style={input} />
            </div>
          </div>
        )}
      </div>

      {/* 2 · Résultat */}
      <div style={{ ...card, background: result ? (result.outOfRange ? "#fff7ed" : "#ecfdf5") : "white",
                    border: `1px solid ${result ? (result.outOfRange ? "#fdba74" : "#6ee7b7") : "#e8ecf0"}` }}>
        <h2 style={h2}>2 · Largeur d'assise recommandée</h2>
        {!result ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Renseignez {method === "mesure" ? "la mesure" : "le poids"} pour obtenir la recommandation.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <div style={{ fontSize: result.outOfRange ? 20 : 36, fontWeight: 900, color: result.outOfRange ? "#9a3412" : "#065f46", lineHeight: 1.1 }}>{result.label}</div>
            <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: "#1e293b" }}>
              {result.reason}
              {result.outOfRange && (
                <div style={{ marginTop: 6, fontWeight: 700, color: "#9a3412" }}>
                  {result.outOfRange === "bariatrique" ? "Au-delà de 100 kg : matériel bariatrique nécessaire." : "Au-delà de 45,5 cm mesurés : modèle large ou sur mesure."} Orienter vers un prestataire de matériel médical pour un essayage.
                </div>
              )}
            </div>
          </div>
        )}
        {/* Choix manuel / vue des 4 tailles avec stock */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#64748b", marginRight: 4 }}>Tailles disponibles :</span>
          {SIZES.map((s, i) => {
            const p = products[cipForSize(i)];
            const active = selectedIdx === i;
            return (
              <button key={s} onClick={() => setManualIdx(i)} title={p ? (p.in_stock ? "En stock" : "Rupture") : ""} style={{
                border: `1.5px solid ${active ? "#0f2d3d" : "#d6dde3"}`, background: active ? "#0f2d3d" : "white", color: active ? "white" : "#0f2d3d",
                borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {SIZE_LABELS[i]}
                <span style={{ width: 8, height: 8, borderRadius: 4, background: !p ? "#cbd5e1" : p.in_stock ? "#10b981" : "#ef4444" }} />
              </button>
            );
          })}
          {manualIdx != null && result && result.idx != null && manualIdx !== result.idx && (
            <button onClick={() => setManualIdx(null)} style={{ border: "none", background: "none", color: "#2563eb", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              revenir à la recommandation ({result.label})
            </button>
          )}
        </div>
      </div>

      {/* 3 · Produit */}
      <div style={card}>
        <h2 style={h2}>3 · Fauteuil correspondant</h2>
        {loading ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Chargement du stock et des prix…</div>
        ) : selectedIdx == null ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Le produit s'affichera dès qu'une taille est déterminée (ou choisie ci-dessus).</div>
        ) : !product ? (
          <div style={{ color: "#b91c1c", fontSize: 13 }}>Produit {cipForSize(selectedIdx)} introuvable dans le catalogue Odoo — utilisez la Saisie de commande.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flexShrink: 0 }}>
              {product.in_stock
                ? <div style={{ background: "#d1fae5", color: "#065f46", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}>EN STOCK</div>
                : <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}>RUPTURE</div>}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#0f2d3d" }}>{product.name}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>CIP : <span style={{ fontFamily: "monospace" }}>{product.cip}</span> · largeur d'assise {SIZE_LABELS[selectedIdx]}</div>
              {manualIdx != null && result && result.idx != null && manualIdx !== result.idx && (
                <div style={{ fontSize: 11, color: "#9a3412", marginTop: 4 }}>⚠️ Taille choisie manuellement, différente de la recommandation ({result.label}).</div>
              )}
            </div>
            <div style={{ textAlign: "right", minWidth: 120 }}>
              {product.discounted_price && product.discount_pct > 0 ? (<>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 11, color: "#aaa", textDecoration: "line-through" }}>{fmt(product.list_price)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "white", background: "#10b981", borderRadius: 4, padding: "1px 5px" }}>{fmtPct(product.discount_pct)}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#059669" }}>{fmt(product.discounted_price)}</div>
              </>) : (
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0f2d3d" }}>{fmt(product.list_price)}</div>
              )}
              <div style={{ fontSize: 10, color: "#bbb" }}>Prix HT</div>
              <TierBadge tiers={product.price_tiers} pn={unitPrice} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ background: "#f0f2f5", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>−</button>
                <input type="number" min="1" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: 48, textAlign: "center", border: "1.5px solid #ddd", borderRadius: 6, padding: 4, fontSize: 14, fontWeight: 700, outline: "none" }} />
                <button onClick={() => setQty(q => q + 1)} style={{ background: "#0f2d3d", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontWeight: 700, fontSize: 16, color: "white" }}>+</button>
              </div>
              <button onClick={add} disabled={!product.in_stock} style={{
                background: product.in_stock ? "#10b981" : "#cbd5e1", color: "white", border: "none", borderRadius: 8, padding: "7px 16px",
                fontSize: 12, fontWeight: 800, cursor: product.in_stock ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                {product.in_stock ? `Ajouter au panier · ${fmt((tiered ? tiered.pn : unitPrice) * qty)}` : "Indisponible"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tuto */}
      <details style={card}>
        <summary style={{ ...h2, cursor: "pointer", margin: 0 }}>📏 Comment prendre la mesure</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 12, fontSize: 13, color: "#1e293b" }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>La bonne méthode</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Matériel : un mètre ruban souple suffit.</li>
              <li>Patient <strong>assis</strong> bien au fond, dos droit, genoux à 90°, pieds à plat — jamais debout.</li>
              <li>Mesurer à l'horizontale au point le plus large (hanches ou haut des cuisses).</li>
              <li>Vêtements habituels, sans comprimer ; mesurer 2 fois et garder la moyenne.</li>
              <li>Ajouter 2,5 à 5 cm de jeu pour obtenir la largeur d'assise.</li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6, color: "#9a3412" }}>Erreurs à éviter</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Mesurer debout (les hanches s'élargissent assis).</li>
              <li>Mesurer par-dessus un gros manteau.</li>
              <li>Trop serrer le mètre.</li>
              <li>Se fier au poids seul quand une mesure est possible : la mesure directe reste toujours préférable.</li>
            </ul>
          </div>
        </div>
      </details>

      {/* Tables de référence */}
      <details style={card}>
        <summary style={{ ...h2, cursor: "pointer", margin: 0 }}>📋 Tables de référence</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 12 }}>
          {[["Mesure (hanches/cuisses)", MEASURE_BANDS, method === "mesure"], ["Poids (sans mesure)", WEIGHT_BANDS, method === "poids"]].map(([title, bands, isActive]) => (
            <table key={title} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ textAlign: "left", fontSize: 11, color: "#64748b", padding: "0 6px 6px", borderBottom: "1px solid #e8ecf0" }}>{title}</th><th style={{ textAlign: "right", fontSize: 11, color: "#64748b", padding: "0 6px 6px", borderBottom: "1px solid #e8ecf0" }}>Largeur</th></tr></thead>
              <tbody>
                {bands.map(b => {
                  const hit = isActive && result && result.band === b;
                  return (
                    <tr key={b.label} style={{ background: hit ? "#ecfdf5" : "transparent", fontWeight: hit ? 800 : 400, color: b.idx == null ? "#9a3412" : "#1e293b" }}>
                      <td style={{ padding: "7px 6px", borderBottom: "1px solid #f1f5f9" }}>{b.label}</td>
                      <td style={{ padding: "7px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{b.idx == null ? "hors gamme" : SIZE_LABELS[b.idx]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 10 }}>
          Ajustement IMC (si la taille est connue) : IMC &lt; 18,5 et poids en haut de tranche → taille inférieure ; IMC &gt; 30 et poids en bas de tranche → taille supérieure.
        </div>
      </details>

      <div style={{ textAlign: "right" }}>
        <button onClick={reset} style={{ background: "none", border: "1px solid #d6dde3", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#475569", cursor: "pointer" }}>Réinitialiser</button>
      </div>
    </div>
  );
}
