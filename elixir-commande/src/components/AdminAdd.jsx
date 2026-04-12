import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";

const LS={fontSize:12,fontWeight:700,color:"#444",display:"block",marginBottom:6};
const IS={width:"100%",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
const PB={width:"100%",background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)",color:"white",border:"none",borderRadius:12,padding:"13px",fontWeight:800,fontSize:14,cursor:"pointer"};

const EMPTY_FORM = { name:"", cip:"", pv:"", pct:"", remise_eur:"", pn:"", section:"otc", hasPalier:false, palier:"", note:"" };

const fmt = (n) => n != null ? parseFloat(n).toFixed(2).replace(".", ",") + " €" : "—";

export default function AdminAdd({ allSectionsList, adminFetch, flash, fetchProducts, products, medipimLookup, setMedipimLookup }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [catSearch, setCatSearch] = useState("");
  const [catResults, setCatResults] = useState([]);
  const [catSearching, setCatSearching] = useState(false);
  const catSearchRef = useRef(null);
  const [catPendingProduct, setCatPendingProduct] = useState(null);
  const [importSection, setImportSection] = useState("otc");
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const [importCount, setImportCount] = useState(0);
  const fileInputRef = useRef(null);

  const lookupMedipim = async (cip) => {
    if (!cip || cip.length < 7 || medipimLookup[cip]) return;
    setMedipimLookup(prev => ({ ...prev, [cip]: { loading: true } }));
    try {
      const res = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${cip}`);
      if (res.ok) {
        const data = await res.json();
        setMedipimLookup(prev => ({ ...prev, [cip]: { ...data, loading: false } }));
        if (data.image_url && !form._medipim_image) {
          setForm(f => ({ ...f, _medipim_image: data.image_url }));
        }
      } else {
        setMedipimLookup(prev => ({ ...prev, [cip]: { loading: false, error: "Non trouvé" } }));
      }
    } catch (e) {
      setMedipimLookup(prev => ({ ...prev, [cip]: { loading: false, error: e.message } }));
    }
  };

  const searchCatalog = (q) => {
    setCatSearch(q);
    if (catSearchRef.current) clearTimeout(catSearchRef.current);
    if (q.length < 2) { setCatResults([]); return; }
    catSearchRef.current = setTimeout(async () => {
      setCatSearching(true);
      try {
        const res = await fetch(`/.netlify/functions/odoo-catalog?q=${encodeURIComponent(q)}&limit=8`);
        if (res.ok) { const data = await res.json(); setCatResults(data.products || []); }
      } catch {}
      setCatSearching(false);
    }, 300);
  };

  const selectFromCatalog = (p) => setCatPendingProduct(p);

  const confirmCatalogSection = (section) => {
    const p = catPendingProduct;
    if (!p) return;
    setForm(f => ({
      ...f, name: p.name || f.name, cip: p.cip || f.cip,
      pv: p.list_price ? String(p.list_price) : f.pv,
      pn: p.discounted_price ? String(p.discounted_price) : "",
      pct: p.discount_pct ? String(p.discount_pct) : "",
      remise_eur: p.list_price && p.discounted_price ? String(Math.round((p.list_price - p.discounted_price) * 100) / 100) : "",
      section,
    }));
    setCatSearch(""); setCatResults([]); setCatPendingProduct(null);
  };

  const handleAdd = async () => {
    if (!form.name.trim()) return alert("Le nom du produit est requis.");
    if (!form.pn) return alert("Le prix remisé est requis.");
    const product = {
      cip: form.cip.trim() || `admin_${Date.now()}`, name: form.name.trim(), section: form.section,
      pv: parseFloat(form.pv) || null, pct: parseFloat(form.pct) || null, pn: parseFloat(form.pn),
      colis: form.hasPalier ? parseInt(form.palier) || null : null,
      note: form.note.trim() || null, source: "admin", active: true,
    };
    try {
      const res = await adminFetch("/.netlify/functions/products-upsert", {
        method: "POST", body: JSON.stringify({ product, action: "create", author: "admin" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await fetchProducts();
      setForm(EMPTY_FORM);
      flash("✅ Produit ajouté !");
      if (form._medipim_image && product.cip) {
        try {
          await adminFetch("/.netlify/functions/product-upload-image", {
            method: "POST", body: JSON.stringify({ cip: product.cip, image_url: form._medipim_image }),
          });
        } catch {}
      }
    } catch (e) { alert("Erreur : " + e.message); }
  };

  const handleImportFile = (file) => {
    if (!file) return;
    setImportError(""); setImportPreview(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const mapped = rows.map((r, i) => {
          const get = (...keys) => {
            for (const k of keys) {
              const found = Object.keys(r).find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g,"").includes(k.toLowerCase().replace(/[^a-z0-9]/g,"")));
              if (found && r[found] !== "") return r[found];
            }
            return "";
          };
          const pv = parseFloat(String(get("prix","pv","catalogue","brut")).replace(",",".")) || null;
          const pctRaw = String(get("remise","pct","reduction","rabais")).replace(",",".").replace("%","").trim();
          const pct = parseFloat(pctRaw) || null;
          const pn = (pv != null && pct != null) ? parseFloat((pv * (1 - pct/100)).toFixed(2)) : null;
          const palier = parseInt(get("palier","colis","qte","min")) || null;
          return {
            _row: i+2, cip: String(get("cip","code","reference","ref")).trim() || null,
            name: String(get("nom","designation","name","produit","libelle")).trim(),
            pv, pct: pct ?? null, pn, palier,
            _valid: !!String(get("nom","designation","name","produit","libelle")).trim() && pn != null,
          };
        }).filter(r => r.name);
        if (mapped.length === 0) { setImportError("Aucun produit détecté."); return; }
        setImportPreview(mapped);
      } catch(err) { setImportError("Erreur de lecture : " + err.message); }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    const valid = importPreview.filter(r => r._valid);
    const newProducts = valid.map(r => ({
      id: Date.now() + Math.random(), section: importSection, name: r.name, cip: r.cip,
      pv: r.pv, pct: r.pct, pn: r.pn, palier: r.palier, colis: r.palier, note: null,
      addedAt: new Date().toLocaleDateString("fr-FR"),
    }));
    try {
      await Promise.all(newProducts.map(p =>
        adminFetch("/.netlify/functions/products-upsert", {
          method: "POST", body: JSON.stringify({ product: p, action: "create", author: "import" }),
        })
      ));
      await fetchProducts();
      setImportCount(valid.length);
      setImportPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      flash(`✅ ${valid.length} produit(s) importé(s) dans ${allSectionsList.find(s=>s.key===importSection)?.label} !`);
    } catch(e) { alert("Erreur import : " + e.message); }
  };

  return (
          <>
            {/* ── EXCEL IMPORT ── */}
            <div style={{background:"#fafbfc",border:"1px solid #e8eaed",borderRadius:14,padding:"16px",marginBottom:24}}>
              <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                📥 Import depuis Excel
                <span style={{fontSize:10,fontWeight:400,color:"#888",background:"#f0f2f5",borderRadius:6,padding:"2px 8px"}}>CIP · Nom · Prix catalogue · Remise · Palier</span>
              </div>
              <div style={{display:"flex",gap:10,marginBottom:12}}>
                <div style={{flex:1}}>
                  <label style={{...LS,fontSize:10}}>Section de destination</label>
                  <select value={importSection} onChange={e=>setImportSection(e.target.value)} style={{...IS,fontSize:12,padding:"7px 10px"}}>
                    {allSectionsList.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div style={{flex:1}}>
                  <label style={{...LS,fontSize:10}}>Fichier Excel (.xlsx, .xls, .csv)</label>
                  <label style={{display:"flex",alignItems:"center",gap:8,background:"white",border:"1.5px dashed #cbd5e0",borderRadius:10,padding:"7px 12px",cursor:"pointer"}}>
                    <span style={{fontSize:16}}>📂</span>
                    <span style={{fontSize:12,color:"#555"}}>Choisir un fichier</span>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={e=>handleImportFile(e.target.files[0])} style={{display:"none"}}/>
                  </label>
                </div>
              </div>

              {importError&&<div style={{background:"#fff5f5",border:"1px solid #fed7d7",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#c53030",marginBottom:10}}>⚠️ {importError}</div>}

              {importPreview&&(
                <div>
                  <div style={{fontSize:12,color:"#555",marginBottom:8,fontWeight:600}}>
                    Aperçu : {importPreview.filter(r=>r._valid).length} valide(s) / {importPreview.length} ligne(s)
                    {importPreview.some(r=>!r._valid)&&<span style={{color:"#e07b39",marginLeft:6}}>— {importPreview.filter(r=>!r._valid).length} ignorée(s) (nom ou prix manquant)</span>}
                  </div>
                  <div style={{maxHeight:200,overflowY:"auto",border:"1px solid #e8eaed",borderRadius:10,marginBottom:12}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead>
                        <tr style={{background:"#f8fafc",position:"sticky",top:0}}>
                          {["CIP","Désignation","Prix cat.","Remise","Prix net","Palier",""].map(h=>(
                            <th key={h} style={{padding:"6px 8px",textAlign:"left",fontWeight:700,color:"#555",borderBottom:"1px solid #e8eaed"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((r,i)=>(
                          <tr key={i} style={{background:r._valid?"white":"#fff5f5",borderBottom:"1px solid #f5f5f5"}}>
                            <td style={{padding:"5px 8px"}}><CipCopy cip={r.cip||""}/></td>
                            <td style={{padding:"5px 8px",fontWeight:600,color:r._valid?"#0f2d3d":"#c53030"}}>{r.name||<em>manquant</em>}</td>
                            <td style={{padding:"5px 8px",textAlign:"right"}}>{r.pv!=null?r.pv.toFixed(2)+" €":"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",color:"#7c3aed"}}>{r.pct||"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",fontWeight:700,color:r.pn!=null?"#059669":"#c53030"}}>{r.pn!=null?r.pn.toFixed(2)+" €":"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",color:"#888"}}>{r.palier||"—"}</td>
                            <td style={{padding:"5px 8px"}}>{r._valid?"✅":"⚠️"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={confirmImport} style={{...PB,flex:2,padding:"9px",fontSize:13}}>
                      ✅ Importer {importPreview.filter(r=>r._valid).length} produit(s) → {allSectionsList.find(s=>s.key===importSection)?.label}
                    </button>
                    <button onClick={()=>{setImportPreview(null);if(fileInputRef.current)fileInputRef.current.value="";}} style={{flex:1,background:"#e5e7eb",border:"none",borderRadius:10,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:700,color:"#374151"}}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Recherche dans le stock Odoo ── */}
            <div style={{background:"white",border:"1px solid #e8eaed",borderRadius:14,padding:"16px 20px",marginBottom:24}}>
              <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                🔍 Rechercher dans le stock Odoo
                <span style={{fontSize:10,fontWeight:400,color:"#888",background:"#f0f2f5",borderRadius:6,padding:"2px 8px"}}>Pré-remplit le formulaire</span>
              </div>
              <div style={{position:"relative"}}>
                <input value={catSearch} onChange={e=>searchCatalog(e.target.value)}
                  placeholder="Tapez un nom ou un CIP (ex: DOLIPRANE, 3400930...)..."
                  style={{...IS,paddingLeft:36,fontSize:14}} />
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,opacity:0.4}}>🔍</span>
                {catSearch && <button onClick={()=>{setCatSearch("");setCatResults([]);}}
                  style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#bbb"}}>✕</button>}
              </div>

              {catSearching && <div style={{fontSize:11,color:"#3b82f6",marginTop:8}}>Recherche en cours...</div>}

              {catResults.length > 0 && !catPendingProduct && (
                <div style={{marginTop:10,border:"1px solid #e8eaed",borderRadius:10,overflow:"hidden",maxHeight:320,overflowY:"auto"}}>
                  {catResults.map(p => (
                    <button key={p.cip} onClick={()=>selectFromCatalog(p)}
                      style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"10px 14px",border:"none",borderBottom:"1px solid #f0f2f5",
                        background:"white",cursor:"pointer",textAlign:"left",transition:"background 0.1s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#f0f9ff"}
                      onMouseLeave={e=>e.currentTarget.style.background="white"}>
                      {/* Stock badge */}
                      <span style={{fontSize:9,fontWeight:700,borderRadius:4,padding:"2px 6px",
                        background:p.in_stock?"#d1fae5":"#fee2e2",color:p.in_stock?"#065f46":"#991b1b"}}>
                        {p.in_stock?"EN STOCK":"RUPTURE"}
                      </span>
                      {/* Info */}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:12,color:"#0f2d3d",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                        <div style={{fontSize:10,color:"#888",fontFamily:"monospace"}}>CIP {p.cip}</div>
                      </div>
                      {/* Prix */}
                      <div style={{textAlign:"right",flexShrink:0}}>
                        {p.discounted_price && p.discount_pct > 0 ? (<>
                          <div style={{fontSize:10,color:"#aaa",textDecoration:"line-through"}}>{parseFloat(p.list_price).toFixed(2)} €</div>
                          <div style={{fontSize:13,fontWeight:700,color:"#059669"}}>{parseFloat(p.discounted_price).toFixed(2)} €</div>
                          <div style={{fontSize:9,color:"#10b981",fontWeight:600}}>-{p.discount_pct}%</div>
                        </>) : (
                          <div style={{fontSize:13,fontWeight:700,color:"#0f2d3d"}}>{parseFloat(p.list_price).toFixed(2)} €</div>
                        )}
                      </div>
                      {/* Arrow */}
                      <span style={{color:"#ccc",fontSize:16}}>→</span>
                    </button>
                  ))}
                </div>
              )}

              {catSearch.length >= 2 && !catSearching && catResults.length === 0 && !catPendingProduct && (
                <div style={{fontSize:11,color:"#aaa",marginTop:8}}>Aucun résultat. Vous pouvez saisir manuellement ci-dessous.</div>
              )}

              {/* Section picker after product selection */}
              {catPendingProduct && (
                <div style={{marginTop:12,background:"#f0f9ff",border:"2px solid #3b82f6",borderRadius:12,padding:"16px 20px",animation:"fadeIn 0.2s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:11,color:"#3b82f6",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>📌 Choisissez la section de destination</div>
                      <div style={{fontSize:14,fontWeight:700,color:"#0f2d3d",marginTop:4}}>{catPendingProduct.name}</div>
                      <div style={{fontSize:11,color:"#888",fontFamily:"monospace"}}>CIP {catPendingProduct.cip} · {catPendingProduct.list_price ? parseFloat(catPendingProduct.list_price).toFixed(2) + " €" : ""}</div>
                    </div>
                    <button onClick={()=>setCatPendingProduct(null)}
                      style={{background:"#f0f2f5",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,color:"#888"}}>✕</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))",gap:8}}>
                    {allSectionsList.map(s => (
                      <button key={s.key} onClick={()=>confirmCatalogSection(s.key)}
                        style={{
                          display:"flex",alignItems:"center",gap:8,
                          padding:"10px 14px",borderRadius:10,fontSize:12,fontWeight:600,
                          cursor:"pointer",transition:"all 0.15s",textAlign:"left",
                          background: form.section === s.key ? "#dbeafe" : "white",
                          border: form.section === s.key ? "2px solid #3b82f6" : "1px solid #e2e8f0",
                          color:"#0f2d3d",
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor="#93c5fd"}}
                        onMouseLeave={e=>{e.currentTarget.style.background=form.section===s.key?"#dbeafe":"white";e.currentTarget.style.borderColor=form.section===s.key?"#3b82f6":"#e2e8f0"}}>
                        <span style={{fontSize:16}}>{s.label.split(" ")[0]}</span>
                        <span>{s.label.replace(/^[^\s]+\s/,"")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Séparateur ── */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <div style={{flex:1,height:1,background:"#e8eaed"}}/>
              <span style={{fontSize:11,color:"#aaa",fontWeight:600}}>SAISIE MANUELLE</span>
              <div style={{flex:1,height:1,background:"#e8eaed"}}/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Nom du produit *</label>
                <input value={form.name} onChange={e=>handleField("name",e.target.value)} placeholder="DOLIPRANE 500MG BTE 16" style={IS}/>
              </div>
              <div>
                <label style={LS}>Code CIP</label>
                <input value={form.cip}
                  onChange={e=>handleField("cip",e.target.value)}
                  onBlur={e=>{ if(e.target.value.length>=7) lookupMedipim(e.target.value); }}
                  placeholder="3400930000000" style={IS}/>
                {form.cip && medipimLookup[form.cip] && (() => {
                  const m = medipimLookup[form.cip];
                  if (m.loading) return <div style={{fontSize:11,color:"#3b82f6",marginTop:4}}>🔍 Recherche Medipim...</div>;
                  if (m.error) return <div style={{fontSize:11,color:"#dc2626",marginTop:4}}>⚠️ Medipim : {m.error}</div>;
                  return (
                    <div style={{marginTop:8,padding:"10px 12px",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,display:"flex",gap:10,alignItems:"center"}}>
                      {m.image_url && <img src={m.image_url} alt="" style={{width:48,height:48,objectFit:"contain",borderRadius:6,background:"white",border:"1px solid #e2e8f0"}}/>}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#0369a1"}}>✅ Trouvé dans Medipim</div>
                        {m.brand && <div style={{fontSize:11,color:"#666"}}>{m.brand}</div>}
                        {m.name && <div style={{fontSize:12,fontWeight:600,color:"#1a2a3a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>}
                      </div>
                      <button onClick={()=>{
                        if(m.name && !form.name) setForm(f=>({...f, name: m.name}));
                        if(m.image_url) setForm(f=>({...f, _medipim_image: m.image_url}));
                      }} style={{fontSize:11,background:"#0ea5e9",color:"white",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>
                        ⬇️ Importer
                      </button>
                    </div>
                  );
                })()}
                {form._medipim_image && (
                  <div style={{marginTop:6,fontSize:11,color:"#059669"}}>📸 Photo Medipim prête à être enregistrée</div>
                )}
              </div>
              <div>
                <label style={{...LS, color: "#3b82f6", fontWeight: 800}}>📌 Section de destination *</label>
                <select value={form.section} onChange={e=>handleField("section",e.target.value)}
                  style={{...IS, borderColor: "#3b82f6", borderWidth: 2, background: "#f0f9ff", fontWeight: 700}}>
                  {allSectionsList.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={LS}>Prix de base (€)</label>
                <input type="number" step="0.01" value={form.pv} onChange={e=>handleField("pv",e.target.value)} placeholder="5.90" style={IS}/>
              </div>
              <div>
                <label style={LS}>Remise %</label>
                <input type="number" step="0.01" value={form.pct}
                  onChange={e=>setForm(f=>({...f, pct:e.target.value, _lastEdited:"pct"}))}
                  placeholder="20.00" style={IS}/>
              </div>
              <div>
                <label style={LS}>Remise €</label>
                <input type="number" step="0.01" value={form.remise_eur}
                  onChange={e=>setForm(f=>({...f, remise_eur:e.target.value, _lastEdited:"eur"}))}
                  placeholder="1.18" style={IS}/>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Prix remisé (€) – calculé auto *</label>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="number" step="0.01" value={form.pn} onChange={e=>handleField("pn",e.target.value)} placeholder="4.72"
                    style={{...IS,flex:1,background:form.pv&&form.pct?"#f0fdf4":"white",fontWeight:700,color:"#059669"}}/>
                  {form.pv&&form.pct&&<span style={{fontSize:12,color:"#059669",fontWeight:600,whiteSpace:"nowrap"}}>= {form.pv} × {(1-parseFloat(form.pct)/100).toFixed(3)}</span>}
                </div>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Palier / Colis minimum ?</label>
                <div style={{display:"flex",gap:10}}>
                  {[{v:false,l:"Non"},{v:true,l:"Oui"}].map(opt=>(
                    <button key={opt.l} onClick={()=>handleField("hasPalier",opt.v)} style={{
                      flex:1,padding:"9px",borderRadius:10,fontWeight:700,fontSize:13,cursor:"pointer",
                      border:form.hasPalier===opt.v?"2px solid #0f2d3d":"2px solid #e2e8f0",
                      background:form.hasPalier===opt.v?"#0f2d3d":"white",
                      color:form.hasPalier===opt.v?"white":"#555",
                    }}>{opt.l}</button>
                  ))}
                </div>
              </div>
              {form.hasPalier&&<div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Quantité minimum</label>
                <input type="number" value={form.palier} onChange={e=>handleField("palier",e.target.value)} placeholder="ex: 24" style={IS}/>
              </div>}
              <div style={{gridColumn:"1 / -1"}}>
                <label style={LS}>Note (optionnel)</label>
                <input value={form.note} onChange={e=>handleField("note",e.target.value)} placeholder="Stock limité..." style={IS}/>
              </div>
            </div>
            <button onClick={handleAdd} style={{...PB,marginTop:20}}>➕ Ajouter ce produit</button>
            {products.length>0&&(
              <div style={{marginTop:24,borderTop:"1px solid #f0f2f5",paddingTop:20}}>
                <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",marginBottom:10}}>Produits ajoutés ({products.length})</div>
                {products.map(p=>(
                  <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",background:"#fafbfc",borderRadius:10,padding:"10px 14px",marginBottom:8,border:"1px solid #f0f2f5"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d"}}>{p.name}</div>
                      <div style={{fontSize:11,color:"#888",marginTop:2}}>{allSectionsList.find(s=>s.key===p.section)?.label} · {fmt(p.pn)}{p.palier?` · ×${p.palier}`:""}{p.cip && <> · <CipCopy cip={p.cip}/></>}</div>
                    </div>
                    <button onClick={()=>handleDelete(p.cip||p._key)} style={{background:"none",border:"none",cursor:"pointer",color:"#f87171",fontSize:16}}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </>
  );
}
