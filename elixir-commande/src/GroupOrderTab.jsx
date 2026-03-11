import { useState, useEffect, useCallback } from "react";

const fmt = (n) => n != null ? Number(n).toFixed(2).replace(".", ",") + " €" : "–";
const MARQUES = ["Tous", "Fluocaril", "Parogencyl", "Regenerate"];

export default function GroupOrderTab({ products, pharmacyCip, pharmacyName, accent = "#059669", color = "#0d4f3c" }) {
  const [groupOrders, setGroupOrders] = useState([]); // toutes les lignes de la table
  const [myQty, setMyQty] = useState({});             // cip → qty (ma pharmacie)
  const [saving, setSaving] = useState({});
  const [search, setSearch] = useState("");
  const [marque, setMarque] = useState("Tous");
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Charger toutes les commandes groupées
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/.netlify/functions/group-order?fournisseur=ulabs");
      const rows = await res.json();
      setGroupOrders(Array.isArray(rows) ? rows : []);
      // Pré-remplir mes quantités
      const mine = {};
      rows.filter(r => r.pharmacy_cip === pharmacyCip).forEach(r => { mine[r.cip] = r.qty; });
      setMyQty(mine);
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [pharmacyCip]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Totaux par produit (toutes pharmacies)
  const totals = {};
  groupOrders.forEach(r => {
    if (!totals[r.cip]) totals[r.cip] = { total: 0, pharmacies: new Set() };
    totals[r.cip].total += r.qty;
    totals[r.cip].pharmacies.add(r.pharmacy_cip);
  });

  // Nb total pharmacies participantes
  const allPharmacies = new Set(groupOrders.map(r => r.pharmacy_cip));
  const myTotal = Object.values(myQty).reduce((s, q) => s + q, 0);

  // Mise à jour quantité (debounce en ligne)
  const updateQty = async (cip, qty) => {
    setMyQty(q => ({ ...q, [cip]: qty }));
    setSaving(s => ({ ...s, [cip]: true }));
    await fetch("/.netlify/functions/group-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fournisseur: "ulabs", cip, pharmacy_cip: pharmacyCip, pharmacy_name: pharmacyName, qty })
    });
    setSaving(s => ({ ...s, [cip]: false }));
    // Rafraîchir les totaux
    const res = await fetch("/.netlify/functions/group-order?fournisseur=ulabs");
    const rows = await res.json();
    setGroupOrders(Array.isArray(rows) ? rows : []);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    // Marquer la commande comme soumise (on pourrait envoyer un email ici)
    // Pour l'instant on affiche une confirmation
    await new Promise(r => setTimeout(r, 800));
    setSubmitted(true);
    setSubmitting(false);
  };

  // Filtrage produits
  const filtered = products.filter(p => {
    const mq = marque === "Tous" || (p.note || p.name || "").includes(marque) || p.name?.includes(marque);
    const sq = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.cip?.includes(search);
    return mq && sq;
  });

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#888" }}>⏳ Chargement du groupement...</div>;

  if (submitted) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
      <div style={{ fontWeight: 800, fontSize: 22, color: "#0d4f3c", marginBottom: 8 }}>Commande groupée enregistrée</div>
      <div style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
        Votre sélection de {myTotal} unités est visible par Elixir Pharma.<br/>
        Vous serez contacté dès que le groupement sera finalisé.
      </div>
      <button onClick={() => { setSubmitted(false); fetchOrders(); }} style={{
        background: color, color: "white", border: "none", borderRadius: 10,
        padding: "10px 24px", fontWeight: 700, cursor: "pointer", fontSize: 14
      }}>Modifier ma sélection</button>
    </div>
  );

  return (
    <div>
      {/* Bannière groupement */}
      <div style={{ background: `linear-gradient(135deg, ${color} 0%, #065f46 100%)`, borderRadius: 16, padding: "20px 24px", marginBottom: 20, color: "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🤝 Commande groupée U-Labs 2025</div>
            <div style={{ opacity: 0.85, fontSize: 13 }}>Fluocaril · Parogencyl · Regenerate · Tarif grossiste HT</div>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{allPharmacies.size}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>pharmacie(s)</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{Object.values(totals).reduce((s,t) => s + t.total, 0)}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>unités groupées</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{myTotal}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>ma sélection</div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px" }}>
          💡 Plus le groupement est important, meilleures seront les conditions négociées. Indiquez vos quantités souhaitées — Elixir Pharma finalisera les conditions et vous recontactera.
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher..."
          style={{ flex: 1, minWidth: 180, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 14px", fontSize: 13, outline: "none" }} />
        <div style={{ display: "flex", gap: 6 }}>
          {MARQUES.map(m => (
            <button key={m} onClick={() => setMarque(m)} style={{
              background: marque === m ? color : "white", color: marque === m ? "white" : "#555",
              border: `1px solid ${marque === m ? color : "#e2e8f0"}`, borderRadius: 8,
              padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600
            }}>{m}</button>
          ))}
        </div>
      </div>

      {/* Liste produits */}
      <div style={{ background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.08)", marginBottom: 20 }}>
        <div style={{ background: color, padding: "10px 16px", display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center" }}>
          <span style={{ color: "white", fontWeight: 700, fontSize: 11 }}>DÉSIGNATION</span>
          <span style={{ color: "white", fontWeight: 700, fontSize: 11, textAlign: "right", minWidth: 70 }}>TARIF HT</span>
          <span style={{ color: "white", fontWeight: 700, fontSize: 11, textAlign: "center", minWidth: 80 }}>TOTAL GROUPE</span>
          <span style={{ color: "white", fontWeight: 700, fontSize: 11, textAlign: "center", minWidth: 110 }}>MA QTÉ</span>
        </div>

        {filtered.map((p, idx) => {
          const qty = myQty[p.cip] || 0;
          const groupTotal = totals[p.cip]?.total || 0;
          const groupPharm = totals[p.cip]?.pharmacies.size || 0;
          const isSaving = saving[p.cip];
          const marqueLabel = p.name?.startsWith("Fluocaril") ? "Fluocaril" : p.name?.startsWith("Parogencyl") ? "Parogencyl" : p.name?.startsWith("Regenerate") ? "Regenerate" : "";
          const marqueColor = marqueLabel === "Fluocaril" ? "#2563eb" : marqueLabel === "Parogencyl" ? "#7c3aed" : "#059669";

          return (
            <div key={p.cip} style={{
              padding: "12px 16px", borderBottom: "1px solid #f0f2f5",
              background: qty > 0 ? "#f0fdf4" : idx % 2 === 0 ? "white" : "#fafbfc",
              display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center"
            }}>
              {/* Désignation */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: marqueColor, background: marqueColor + "15", borderRadius: 4, padding: "2px 6px" }}>{marqueLabel}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "#0f2d3d" }}>{p.name?.replace(/^(Fluocaril|Parogencyl|Regenerate)\s+/, "")}</span>
                </div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>EAN : {p.cip} · {p.note}</div>
              </div>
              {/* Tarif HT */}
              <div style={{ textAlign: "right", fontWeight: 700, fontSize: 14, color: "#0f2d3d", minWidth: 70 }}>
                {fmt(p.pv)}
              </div>
              {/* Total groupe */}
              <div style={{ textAlign: "center", minWidth: 80 }}>
                {groupTotal > 0 ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 16, color: accent }}>{groupTotal}</div>
                    <div style={{ fontSize: 10, color: "#888" }}>{groupPharm} pharm.</div>
                  </>
                ) : (
                  <span style={{ color: "#ddd", fontSize: 12 }}>—</span>
                )}
              </div>
              {/* Ma quantité */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", minWidth: 110 }}>
                <button onClick={() => updateQty(p.cip, Math.max(0, qty - 1))} style={{
                  background: "#f0f2f5", border: "none", borderRadius: 6, width: 28, height: 28,
                  cursor: "pointer", fontWeight: 700, fontSize: 16, color: "#555"
                }}>−</button>
                <span style={{ width: 32, textAlign: "center", fontWeight: 700, fontSize: 15, color: qty > 0 ? accent : "#888" }}>{qty}</span>
                <button onClick={() => updateQty(p.cip, qty + 1)} style={{
                  background: accent, border: "none", borderRadius: 6, width: 28, height: 28,
                  cursor: "pointer", fontWeight: 700, fontSize: 16, color: "white"
                }}>+</button>
                {isSaving && <span style={{ fontSize: 10, color: "#aaa" }}>💾</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bouton soumettre */}
      {myTotal > 0 && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Votre sélection : <strong>{myTotal} unités</strong> sur {Object.keys(myQty).filter(k => myQty[k] > 0).length} référence(s)
          </div>
          <button onClick={handleSubmit} disabled={submitting} style={{
            background: accent, color: "white", border: "none", borderRadius: 12,
            padding: "14px 36px", fontWeight: 800, fontSize: 16, cursor: "pointer",
            boxShadow: `0 4px 16px ${accent}40`, opacity: submitting ? 0.7 : 1
          }}>
            {submitting ? "⏳ Envoi..." : "✅ Confirmer ma participation au groupement"}
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>Aucun produit trouvé</div>
      )}
    </div>
  );
}
