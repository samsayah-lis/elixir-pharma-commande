import React, { useState } from "react";

export default function AdminSearchML({ adminFetch }) {
  const [searchML, setSearchML] = useState({ trending: [], zeroResults: [], funnel: null, stats: null, loading: false });
  const [mlCompute, setMlCompute] = useState({ running: false, result: null });
  const [mlRuptures, setMlRuptures] = useState([]);
  const [mlSegments, setMlSegments] = useState([]);

  const loadSearchML = async () => {
    setSearchML(prev => ({ ...prev, loading: true }));
    try {
      const [trendRes, zeroRes, funnelRes, statsRes] = await Promise.all([
        fetch("/.netlify/functions/search-track?trending=1"),
        fetch("/.netlify/functions/search-track?zero_results=1"),
        fetch("/.netlify/functions/search-track?funnel=1"),
        fetch("/.netlify/functions/search-track?stats=1"),
      ]);
      const [trend, zero, funnel, stats] = await Promise.all([trendRes.json(), zeroRes.json(), funnelRes.json(), statsRes.json()]);
      setSearchML({ trending: trend.trending || [], zeroResults: zero.zero_results || [], funnel: funnel.funnel || null, stats: stats || null, loading: false });
    } catch (e) {
      console.warn("[search-ml]", e.message);
      setSearchML(prev => ({ ...prev, loading: false }));
    }
  };

  const loadMLData = async () => {
    try {
      const [ruptRes, segRes] = await Promise.all([
        fetch("/.netlify/functions/ml-recommend?mode=ruptures"),
        fetch("/.netlify/functions/ml-recommend?mode=segments"),
      ]);
      const [rupt, seg] = await Promise.all([ruptRes.json(), segRes.json()]);
      setMlRuptures(rupt.predictions || []);
      setMlSegments(seg.segments || []);
    } catch {}
  };

  const runMLCompute = async () => {
    setMlCompute({ running: true, result: null });
    try {
      const res = await adminFetch("/.netlify/functions/ml-recommend", {
        method: "POST",
        body: JSON.stringify({ action: "compute" }),
      });
      const data = await res.json();
      setMlCompute({ running: false, result: data });
      loadMLData();
    } catch (e) {
      setMlCompute({ running: false, result: { error: e.message } });
    }
  };

  const segColors = { gros_generaliste:"#059669", specialiste_cher:"#7c3aed", parapharmacie:"#f59e0b", regulier:"#3b82f6", dormant:"#dc2626", nouveau:"#888" };
  const segLabels = { gros_generaliste:"Gros généraliste", specialiste_cher:"Spécialiste cher", parapharmacie:"Parapharmacie", regulier:"Régulier", dormant:"Dormant", nouveau:"Nouveau" };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <div style={{fontWeight:800,fontSize:18,color:"#0f2d3d"}}>🧠 Intelligence Recherche</div>
          <div style={{fontSize:12,color:"#888",marginTop:4}}>Analyse des recherches des pharmacies — trending, produits manquants, conversion</div>
        </div>
        <button onClick={loadSearchML} disabled={searchML.loading}
          style={{background:"#0f2d3d",color:"white",border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:searchML.loading?"default":"pointer",opacity:searchML.loading?0.6:1}}>
          {searchML.loading ? "⏳ Chargement..." : "📊 Charger les données"}
        </button>
      </div>

      {/* Stats globales */}
      {searchML.stats && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:12,marginBottom:20}}>
          {[
            { label:"Recherches totales", value:searchML.stats.total || 0, color:"#0f2d3d" },
            { label:"Aujourd'hui", value:searchML.stats.today || 0, color:"#3b82f6" },
            ...(searchML.funnel ? [
              { label:"Taux ajout panier", value:searchML.funnel.cart_rate + "%", color:"#059669" },
              { label:"Taux de clic", value:searchML.funnel.click_rate + "%", color:"#f59e0b" },
            ] : []),
          ].map((kpi, i) => (
            <div key={i} style={{background:"white",borderRadius:12,padding:"16px 20px",border:"1px solid #e8ecf0",textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:800,color:kpi.color}}>{kpi.value}</div>
              <div style={{fontSize:11,color:"#888",fontWeight:600}}>{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Funnel */}
      {searchML.funnel && (
        <div style={{background:"white",borderRadius:14,padding:"20px 24px",marginBottom:20,border:"1px solid #e8ecf0"}}>
          <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d",marginBottom:12}}>📈 Funnel de conversion (30 derniers jours)</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {[
              { label:"Recherches", value:searchML.funnel.total_searches, color:"#3b82f6" },
              { label:"Avec résultats", value:searchML.funnel.with_results, color:"#8b5cf6" },
              { label:"Clics produit", value:searchML.funnel.clicked, color:"#f59e0b" },
              { label:"Ajout panier", value:searchML.funnel.added_to_cart, color:"#059669" },
            ].map((step, i) => {
              const maxW = searchML.funnel.total_searches || 1;
              const pct = Math.round(step.value / maxW * 100);
              return (
                <div key={i} style={{flex:1}}>
                  <div style={{fontSize:10,color:"#888",fontWeight:600,marginBottom:4}}>{step.label}</div>
                  <div style={{background:"#f0f2f5",borderRadius:6,height:32,position:"relative",overflow:"hidden"}}>
                    <div style={{background:step.color,height:"100%",width:`${Math.max(pct,3)}%`,borderRadius:6,transition:"width 0.5s"}} />
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:pct>40?"white":"#333"}}>{step.value}</div>
                  </div>
                  <div style={{fontSize:9,color:"#aaa",textAlign:"center",marginTop:2}}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {/* Trending */}
        <div style={{background:"white",borderRadius:14,padding:"20px 24px",border:"1px solid #e8ecf0"}}>
          <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d",marginBottom:4}}>🔥 Top recherches (7 jours)</div>
          <div style={{fontSize:11,color:"#aaa",marginBottom:12}}>Les termes les plus recherchés</div>
          {searchML.trending.length === 0 ? (
            <div style={{textAlign:"center",padding:24,color:"#ccc",fontSize:13}}>Cliquez "Charger les données"</div>
          ) : (
            <div style={{maxHeight:400,overflowY:"auto"}}>
              {searchML.trending.map((t, i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}>
                  <span style={{fontSize:11,fontWeight:800,color:i<3?"#f59e0b":"#bbb",minWidth:20,textAlign:"center"}}>{i+1}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13,color:"#0f2d3d"}}>{t.query}</div>
                    <div style={{fontSize:10,color:"#aaa"}}>{t.avg_results} résultats en moyenne</div>
                  </div>
                  <span style={{background:"#eff6ff",color:"#3b82f6",fontWeight:700,fontSize:11,borderRadius:8,padding:"2px 8px"}}>{t.count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Zero results */}
        <div style={{background:"white",borderRadius:14,padding:"20px 24px",border:"1px solid #e8ecf0"}}>
          <div style={{fontWeight:700,fontSize:15,color:"#dc2626",marginBottom:4}}>❌ Recherches sans résultat</div>
          <div style={{fontSize:11,color:"#aaa",marginBottom:12}}>Produits demandés mais absents</div>
          {searchML.zeroResults.length === 0 ? (
            <div style={{textAlign:"center",padding:24,color:"#ccc",fontSize:13}}>Aucune donnée</div>
          ) : (
            <div style={{maxHeight:400,overflowY:"auto"}}>
              {searchML.zeroResults.map((z, i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}>
                  <span style={{fontSize:11,fontWeight:800,color:"#dc2626",minWidth:20,textAlign:"center"}}>{i+1}</span>
                  <div style={{flex:1,fontWeight:600,fontSize:13,color:"#0f2d3d"}}>{z.query}</div>
                  <span style={{background:"#fee2e2",color:"#dc2626",fontWeight:700,fontSize:11,borderRadius:8,padding:"2px 8px"}}>{z.count}× demandé</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div style={{background:"#f5f3ff",borderRadius:14,padding:"16px 20px",border:"1px solid #ddd6fe",fontSize:12,color:"#5b21b6",lineHeight:1.6,marginTop:20}}>
        <strong>Comment ça marche :</strong> Chaque recherche est loggée. Les données alimentent les recommandations ML.
      </div>

      {/* ML Compute */}
      <div style={{background:"white",borderRadius:14,padding:"20px 24px",marginTop:20,border:"1px solid #e8ecf0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d"}}>⚙️ Calcul des modèles ML</div>
            <div style={{fontSize:11,color:"#aaa",marginTop:2}}>Cross-sell, patterns d'achat, ruptures, segments</div>
          </div>
          <button onClick={runMLCompute} disabled={mlCompute.running}
            style={{background:"linear-gradient(135deg, #7c3aed, #a855f7)",color:"white",border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:mlCompute.running?"default":"pointer",opacity:mlCompute.running?0.6:1,whiteSpace:"nowrap"}}>
            {mlCompute.running ? "⏳ Calcul..." : "🧮 Lancer le calcul ML"}
          </button>
        </div>
        {mlCompute.result && !mlCompute.result.error && (
          <div style={{background:"#f0fdf4",borderRadius:10,padding:"12px 16px",border:"1px solid #bbf7d0",display:"flex",gap:16,flexWrap:"wrap"}}>
            {[
              { label:"Cross-sell", value:mlCompute.result.associations?.computed || 0, color:"#059669" },
              { label:"Paniers", value:mlCompute.result.associations?.baskets || 0, color:"#3b82f6" },
              { label:"Patterns", value:mlCompute.result.patterns?.computed || 0, color:"#f59e0b" },
              { label:"Ruptures", value:mlCompute.result.ruptures?.rupture || 0, color:"#dc2626" },
              { label:"Critiques (<7j)", value:mlCompute.result.ruptures?.critical || 0, color:"#f97316" },
              { label:"Pharmacies segm.", value:mlCompute.result.segments?.computed || 0, color:"#8b5cf6" },
            ].map((kpi, i) => (
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:800,color:kpi.color}}>{kpi.value}</div>
                <div style={{fontSize:10,color:"#888"}}>{kpi.label}</div>
              </div>
            ))}
          </div>
        )}
        {mlCompute.result?.error && (
          <div style={{background:"#fee2e2",borderRadius:10,padding:"12px 16px",fontSize:12,color:"#dc2626",fontWeight:600}}>{mlCompute.result.error}</div>
        )}
      </div>

      {/* Load predictions button */}
      <div style={{display:"flex",gap:8,marginTop:20,marginBottom:12}}>
        <button onClick={loadMLData}
          style={{background:"#0f2d3d",color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
          📊 Charger prédictions & segments
        </button>
      </div>

      {/* Ruptures */}
      {mlRuptures.length > 0 && (
        <div style={{background:"white",borderRadius:14,padding:"20px 24px",marginBottom:16,border:"1px solid #e8ecf0"}}>
          <div style={{fontWeight:700,fontSize:15,color:"#dc2626",marginBottom:4}}>⚠️ Prédictions de rupture</div>
          <div style={{fontSize:11,color:"#aaa",marginBottom:12}}>Vélocité vente vs stock actuel</div>
          <div style={{maxHeight:400,overflowY:"auto"}}>
            {mlRuptures.map((r, i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}>
                <span style={{
                  fontSize:9,fontWeight:700,borderRadius:4,padding:"2px 8px",minWidth:60,textAlign:"center",
                  background: r.level === "rupture" ? "#fee2e2" : r.level === "critical" ? "#fef3c7" : "#dbeafe",
                  color: r.level === "rupture" ? "#dc2626" : r.level === "critical" ? "#92400e" : "#1e40af",
                }}>{r.level === "rupture" ? "RUPTURE" : r.level === "critical" ? `${r.days_before_rupture}j ⚠` : `${r.days_before_rupture}j`}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:12,color:"#0f2d3d",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                  <div style={{fontSize:10,color:"#888"}}>CIP {r.cip} · stock: {r.stock} · {r.velocity} u/j · {r.order_count} cmd</div>
                </div>
                <span style={{fontWeight:700,fontSize:12,color:"#888"}}>{r.list_price ? parseFloat(r.list_price).toFixed(2)+" €" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Segments */}
      {mlSegments.length > 0 && (
        <div style={{background:"white",borderRadius:14,padding:"20px 24px",border:"1px solid #e8ecf0"}}>
          <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d",marginBottom:4}}>🏷️ Segmentation pharmacies</div>
          <div style={{fontSize:11,color:"#aaa",marginBottom:12}}>Score composite (fréquence, CA, diversité, récence)</div>
          <div style={{maxHeight:400,overflowY:"auto"}}>
            {mlSegments.map((s, i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}>
                <div style={{width:36,height:36,borderRadius:8,background:`${segColors[s.segment]||"#888"}20`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,color:segColors[s.segment]||"#888"}}>{s.score}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:12,color:"#0f2d3d",display:"flex",alignItems:"center",gap:6}}>
                    {s.pharmacy_name}
                    <span style={{fontSize:8,fontWeight:700,borderRadius:4,padding:"1px 6px",background:`${segColors[s.segment]||"#888"}20`,color:segColors[s.segment]||"#888"}}>{segLabels[s.segment]||s.segment}</span>
                  </div>
                  <div style={{fontSize:10,color:"#888"}}>{s.total_orders} cmd · {parseFloat(s.total_ca).toFixed(0)} € CA · {s.product_diversity} produits · il y a {s.days_since_last}j</div>
                </div>
                <span style={{fontWeight:700,fontSize:12,color:"#059669"}}>{parseFloat(s.avg_basket).toFixed(0)} € moy.</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
