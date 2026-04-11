import React from "react";

export default function MyOrdersPanel({ orders, loading, pharmacyName, onClose, onReorder }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:400, backdropFilter:"blur(2px)", display:"flex", justifyContent:"center", alignItems:"center", padding:20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"white", borderRadius:20, width:"100%", maxWidth:700, maxHeight:"85vh", overflow:"hidden",
        display:"flex", flexDirection:"column", boxShadow:"0 24px 64px rgba(0,0,0,0.25)"
      }}>
        {/* Header */}
        <div style={{ padding:"20px 24px", borderBottom:"1px solid #f0f2f5", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:"#0f2d3d" }}>📋 Mes commandes</div>
            <div style={{ fontSize:12, color:"#888", marginTop:2 }}>{pharmacyName} · {orders.length} commande(s)</div>
          </div>
          <button onClick={onClose}
            style={{ background:"#f0f2f5", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 24px" }}>
          {loading && <div style={{ textAlign:"center", padding:40, color:"#888" }}>Chargement...</div>}
          {!loading && orders.length === 0 && (
            <div style={{ textAlign:"center", padding:40, color:"#aaa" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📦</div>
              <div style={{ fontSize:15, fontWeight:600 }}>Aucune commande trouvée</div>
            </div>
          )}
          {orders.map(order => {
            const date = new Date(order.date);
            const items = Array.isArray(order.items) ? order.items : [];
            return (
              <div key={order.id} style={{ background:"#fafbfc", borderRadius:14, padding:"16px 20px", marginBottom:12, border:"1px solid #e8ecf0" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:"#0f2d3d" }}>
                      {date.toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" })}
                      <span style={{ fontSize:11, color:"#888", marginLeft:8 }}>{date.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}</span>
                    </div>
                    <div style={{ fontSize:11, color:"#888", marginTop:2 }}>{items.length} ligne(s) · {order.nbLignes || items.length} réf.</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:800, fontSize:16, color:"#059669" }}>{order.totalHt ? parseFloat(order.totalHt).toFixed(2).replace(".",",") + " €" : "—"}</div>
                    <span style={{
                      fontSize:9, fontWeight:700, borderRadius:6, padding:"2px 8px",
                      background: order.processed ? "#d1fae5" : "#fef3c7",
                      color: order.processed ? "#065f46" : "#92400e",
                    }}>{order.processed ? "✓ TRAITÉE" : "EN ATTENTE"}</span>
                  </div>
                </div>
                {/* Items */}
                <div style={{ borderTop:"1px solid #e8ecf0", paddingTop:8 }}>
                  {items.slice(0, 5).map((it, j) => (
                    <div key={j} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"3px 0", color:"#555" }}>
                      <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.name}</span>
                      <span style={{ flexShrink:0, marginLeft:12, fontWeight:600 }}>×{it.qty}</span>
                      <span style={{ flexShrink:0, marginLeft:12, fontWeight:600, minWidth:60, textAlign:"right" }}>{it.pn ? parseFloat(it.pn * it.qty).toFixed(2) + " €" : ""}</span>
                    </div>
                  ))}
                  {items.length > 5 && <div style={{ fontSize:11, color:"#aaa", paddingTop:4 }}>+ {items.length - 5} autre(s)...</div>}
                </div>
                {/* Recommander */}
                <button onClick={() => onReorder(items)}
                  style={{
                    marginTop:10, width:"100%", background:"#eff6ff", border:"1px solid #bfdbfe",
                    borderRadius:8, padding:"8px", fontSize:12, fontWeight:700, color:"#1e40af",
                    cursor:"pointer"
                  }}>🔄 Recommander cette commande</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
