import React, { useState, useEffect, useMemo } from "react";
import { T, R, tone, ui, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";

// ── CROSS-SELL : "Les pharmacies qui commandent X commandent aussi Y" ──
// Refonte charte (lot 6) : carte neutre (paper, filet), pertinence en ton info (menthe + sarcelle), « Ajouter » en
// pastille pétrole ; la couleur verte passée par le panier (accent) n'est plus utilisée. Recherche et onAdd inchangés.
const TON_PERTINENCE = tone("info");
export function CrossSellBanner({ cartCips = [], onAdd }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(new Set());
  // Clé stable PAR VALEUR : le compte à rebours re-rend App chaque seconde, donc
  // cartCips change de référence à chaque render. Sans clé stable, l'effet ci-dessous
  // refetchait ml-recommend ~1×/s en continu. On ne relance que si l'ensemble change.
  const cipsKey = useMemo(() => [...new Set(cartCips.filter(Boolean))].sort().join(","), [cartCips]);

  useEffect(() => {
    const uniqueCips = cipsKey ? cipsKey.split(",") : [];
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
  }, [cipsKey, dismissed]);

  if (recs.length === 0 && !loading) return null;

  return (
    <section aria-label="Produits complémentaires" style={{ background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.m, padding: "14px 16px", marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <Icone nom="ampoule" taille={18} style={{ color: T.teal, marginTop: 1 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: T.ink }}>Produits complémentaires</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 1 }}>Basé sur les commandes d'autres pharmacies</div>
        </div>
      </div>
      {loading && recs.length === 0 ? (
        <div role="status" style={{ fontSize: 12, color: T.inkMute, padding: "8px 0" }}>Recherche de recommandations…</div>
      ) : (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {recs.map(rec => (
            <div key={rec.cip} style={{ background: T.surface, borderRadius: R.s, padding: "10px 12px", minWidth: 168, maxWidth: 200, border: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
              {rec.image_url && <img src={rec.image_url} alt="" style={{ width: "100%", height: 60, objectFit: "contain", borderRadius: 6, background: T.surface }} />}
              <div style={{ fontWeight: 600, fontSize: 12, color: T.ink, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{rec.name || rec.cip}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.4, color: TON_PERTINENCE.fg, background: TON_PERTINENCE.bg, borderRadius: R.pill, padding: "1px 8px" }}>
                  {rec.lift >= 3 ? "Très pertinent" : rec.lift >= 2 ? "Pertinent" : "Suggéré"}
                </span>
              </div>
              {rec.pn != null && <div className="num" style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{fmtEur(rec.pn)}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
                <button className="ex-btn-petrole" onClick={() => onAdd?.(rec.cip, 1)} aria-label={`Ajouter ${rec.name || rec.cip} au panier`}
                  style={{ ...ui.btn("primaire", "s"), background: undefined, color: undefined, flex: 1, height: 30, padding: "0 10px", fontSize: 12, gap: 4 }}>
                  <Icone nom="plus" taille={14} epaisseur={2.4} />Ajouter
                </button>
                <button className="ex-btn-discret" onClick={() => setDismissed(p => new Set([...p, rec.cip]))} title="Masquer" aria-label={`Masquer ${rec.name || rec.cip}`}
                  style={{ width: 28, height: 28, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icone nom="fermer" taille={14} epaisseur={2.4} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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
