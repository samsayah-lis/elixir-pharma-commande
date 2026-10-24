import React, { useMemo } from "react";
import { T } from "../theme.js";

export default function AdminOrderKPIs({ orders }) {
  const { totalCA, panierMoyen, todayOrders, todayCA, topPharm, topProd } = useMemo(() => {
    const totalCA = orders.reduce((s, o) => s + (parseFloat(o.totalHt) || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter(o => o.date?.startsWith(today));
    const todayCA = todayOrders.reduce((s, o) => s + (parseFloat(o.totalHt) || 0), 0);
    const pharmCA = {};
    orders.forEach(o => { pharmCA[o.pharmacyName] = (pharmCA[o.pharmacyName] || 0) + (parseFloat(o.totalHt) || 0); });
    const prodQty = {};
    orders.forEach(o => { (Array.isArray(o.items) ? o.items : []).forEach(it => {
      if (it.name) prodQty[it.name] = (prodQty[it.name] || 0) + (parseInt(it.qty) || 0);
    }); });
    return {
      totalCA, panierMoyen: totalCA / orders.length, todayOrders, todayCA,
      topPharm: Object.entries(pharmCA).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topProd: Object.entries(prodQty).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [orders]);

  return (
    <div style={{marginBottom:20}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:10,marginBottom:16}}>
        {[
          { label:"CA total", value:totalCA.toFixed(0)+" €", color:T.ok },
          { label:"Commandes", value:orders.length, color:T.teal },
          { label:"Panier moyen", value:panierMoyen.toFixed(0)+" €", color:T.warn },   // ambre #f59e0b à 2,1:1 sur blanc → --warn
          { label:"Aujourd'hui", value:todayOrders.length+" cmd · "+todayCA.toFixed(0)+" €", color:T.violet },   // violet assombri : 7,1:1 (#8b5cf6 : 4,2:1)
          { label:"En attente", value:orders.filter(o=>!o.processed).length, color:T.danger },
        ].map((kpi, i) => (
          <div key={i} style={{background:T.surface,borderRadius:12,padding:"14px 16px",border:"1px solid var(--line)",textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:700,color:kpi.color}}>{kpi.value}</div>
            <div style={{fontSize:11,color:T.inkMute,fontWeight:600,marginTop:2}}>{kpi.label}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div style={{background:T.surface,borderRadius:12,padding:"14px 16px",border:"1px solid var(--line)"}}>
          <div style={{fontWeight:700,fontSize:12,color:T.petrol,marginBottom:8}}>🏥 Top pharmacies (CA)</div>
          {topPharm.map(([name, ca], i) => (
            <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderBottom:"1px solid var(--line-soft)"}}>
              <span style={{color:i<3?T.petrol:T.inkMute,fontWeight:i<3?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{name}</span>
              <span style={{fontWeight:700,color:T.ok,flexShrink:0,marginLeft:8}}>{ca.toFixed(0)} €</span>
            </div>
          ))}
        </div>
        <div style={{background:T.surface,borderRadius:12,padding:"14px 16px",border:"1px solid var(--line)"}}>
          <div style={{fontWeight:700,fontSize:12,color:T.petrol,marginBottom:8}}>📦 Top produits (quantité)</div>
          {topProd.map(([name, qty], i) => (
            <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderBottom:"1px solid var(--line-soft)"}}>
              <span style={{color:i<3?T.petrol:T.inkMute,fontWeight:i<3?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{name}</span>
              <span style={{fontWeight:700,color:T.teal,flexShrink:0,marginLeft:8}}>×{qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
