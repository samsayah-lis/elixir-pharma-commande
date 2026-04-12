import React from "react";

const LS={fontSize:12,fontWeight:700,color:"#444",display:"block",marginBottom:6};
const IS={width:"100%",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};

export default function AdminEdit({
  products, search, setSearch, filterSection, setFilterSection,
  editingKey, setEditingKey, editForm, setEditForm,
  uploadingImg, setUploadingImg, uploadedImgs, setUploadedImgs,
  medipimLookup, setMedipimLookup, adminFetch, flash, fetchProducts,
  allProducts, sectionMeta,
}) {
  const sections = [...new Set(products.map(p => p.section).filter(Boolean))].sort();
  const filtered = allProducts || products.filter(p => {
    const ms = filterSection === "all" || p.section === filterSection;
    const mq = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.cip?.includes(search);
    return ms && mq;
  });

  const handleSave = async (product) => {
    try {
      const res = await adminFetch("/.netlify/functions/products-upsert", {
        method: "POST",
        body: JSON.stringify({ product: { ...product, ...editForm }, action: "update", author: "admin" }),
      });
      if (res.ok) {
        flash("✓ Produit mis à jour");
        setEditingKey(null);
        fetchProducts();
      }
    } catch (e) { flash("❌ " + e.message); }
  };

  const handleDelete = async (product) => {
    if (!confirm(`Supprimer ${product.name} ?`)) return;
    await adminFetch("/.netlify/functions/products-upsert", {
      method: "POST",
      body: JSON.stringify({ product: { ...product, active: false }, action: "delete", author: "admin" }),
    });
    flash("🗑️ Produit supprimé");
    fetchProducts();
  };

  return (
          <>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="🔍 Rechercher par nom ou CIP..." style={{...IS,flex:2}}/>
              <select value={filterSection} onChange={e=>setFilterSection(e.target.value)} style={{...IS,flex:1}}>
                <option value="all">Toutes sections</option>
                {allSectionsList.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{fontSize:11,color:"#999",marginBottom:12}}>
              {filtered.length} produit(s) dans Supabase
              {false&&(
                <button onClick={()=>{
                  if(!window.confirm("Réinitialiser TOUTES les modifications ?")) return;
                  flash("↩️ Les modifications sont dans Supabase — utilisez l'onglet Modifier pour réinitialiser.");
                }} style={{marginLeft:12,background:"#fee2e2",border:"none",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:11,color:"#b91c1c",fontWeight:700}}>
                  Tout réinitialiser
                </button>
              )}
            </div>

            {filtered.slice(0,80).map(p=>{
              const ov={};
              const isEditing=editingKey===p._key;
              const hasOv=!!ov;
              return (
                <div key={p._key} style={{
                  borderRadius:12,marginBottom:8,
                  border:hasOv?"2px solid #fbbf24":"1px solid #e8eaed",
                  background:hasOv?"#fffbeb":"#fafbfc",overflow:"hidden"
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#0f2d3d",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {hasOv&&<span style={{background:"#fbbf24",color:"#78350f",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:4}}>MODIFIÉ</span>}
                        <span style={{wordBreak:"break-word"}}>{p.name}</span>
                      </div>
                      <div style={{fontSize:11,color:"#888",marginTop:2}}>
                        {p._sectionLabel}{p.cip && <> · <CipCopy cip={p.cip}/></>}
                        {" · "}
                        <span style={{color:hasOv?"#d97706":"#555",fontWeight:600}}>
                          {fmt(ov?.pn??p.pn)} net
                          {(ov?.palier??p.palier??p.colis)?` · ×${ov?.palier??p.palier??p.colis}`:""}
                        </span>
                        {hasOv&&<span style={{color:"#9ca3af",marginLeft:4}}>(orig: {fmt(p.pn)})</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6,marginLeft:10,flexShrink:0}}>
                      {hasOv&&(
                        <button onClick={()=>clearEdit(p._key)} title="Réinitialiser" style={{background:"#fef3c7",border:"none",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,color:"#92400e",fontWeight:700}}>↩</button>
                      )}
                      <button onClick={()=>isEditing?setEditingKey(null):startEdit(p)} style={{
                        background:isEditing?"#e5e7eb":"#0f2d3d",border:"none",borderRadius:8,
                        padding:"5px 12px",cursor:"pointer",fontSize:12,
                        color:isEditing?"#374151":"white",fontWeight:700
                      }}>{isEditing?"Annuler":"✏️ Modifier"}</button>
                    </div>
                  </div>

                  {isEditing&&(
                    <div style={{background:"white",borderTop:"1px solid #e8eaed",padding:"14px 14px 16px"}}>
                      <div style={{marginBottom:10}}>
                        <label style={{...LS,fontSize:10}}>Code CIP / Référence</label>
                        <input value={editForm.cip} onChange={e=>setEditForm(f=>({...f,cip:e.target.value}))}
                          placeholder="3400930000000" style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:8}}>
                        {[
                          {key:"pv",  label:"Prix brut (€)"},
                          {key:"pct", label:"Remise (%)"},
                          {key:"remise_eur", label:"Remise (€)"},
                        ].map(({key,label})=>(
                          <div key={key}>
                            <label style={{...LS,fontSize:10}}>{label}</label>
                            <input type="number" step="0.01" value={editForm[key]||""}
                              onChange={e=>setEditForm(f=>({...f,[key]:e.target.value,_lastEdited:key==="remise_eur"?"eur":"pct"}))}
                              style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                        {[
                          {key:"pn",     label:"Prix net (€) ★", green:true},
                          {key:"palier", label:"Palier / Colis"},
                        ].map(({key,label,green})=>(
                          <div key={key}>
                            <label style={{...LS,fontSize:10,color:green?"#059669":undefined}}>{label}</label>
                            <input type="number" step="0.01" value={editForm[key]||""}
                              onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))}
                              style={{...IS,fontSize:12,padding:"7px 10px",
                                borderColor:green?"#86efac":"#e2e8f0",
                                fontWeight:green?700:400,color:green?"#059669":"inherit"}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{marginBottom:12}}>
                        <label style={{...LS,fontSize:10}}>Note</label>
                        <input value={editForm.note} onChange={e=>setEditForm(f=>({...f,note:e.target.value}))}
                          placeholder="Stock limité, Promo..." style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                      </div>
                      {GRID_SECTIONS.includes(p._section) && (
                        <div style={{marginBottom:12}}>
                          <label style={{...LS,fontSize:10}}>📸 Photo produit</label>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
                            {(uploadedImgs[p.cip] || p.image_url) && (
                              <img src={uploadedImgs[p.cip] || p.image_url} alt=""
                                style={{width:48,height:48,objectFit:"cover",borderRadius:6,border:"1px solid #e2e8f0"}}/>
                            )}
                            <label style={{
                              display:"inline-block",padding:"6px 12px",borderRadius:8,
                              background:"#f0f2f5",border:"1px solid #e2e8f0",cursor:"pointer",
                              fontSize:11,fontWeight:600,color:"#555"
                            }}>
                              {uploadingImg===p.cip ? "⏳ Upload..." : "📂 Choisir une photo"}
                              <input type="file" accept="image/*" style={{display:"none"}}
                                onChange={e=>handleImageUpload(p.cip, e.target.files[0])}
                                disabled={uploadingImg===p.cip}/>
                            </label>
                            {p.cip && medipimLookup[p.cip]?.image_url && (
                              <button onClick={async()=>{
                                setUploadingImg(p.cip);
                                try {
                                  const r=await adminFetch("/.netlify/functions/product-upload-image",{
                                    method:"POST",headers:{"Content-Type":"application/json"},
                                    body:JSON.stringify({cip:p.cip,image_url:medipimLookup[p.cip].image_url})
                                  });
                                  const j=await r.json();
                                  if(j.success){setUploadedImgs(prev=>({...prev,[p.cip]:j.image_url}));flash("🖼️ Photo Medipim importée !");await fetchProducts();}
                                  setUploadingImg(null);
                                }catch(e){alert(e.message);setUploadingImg(null);}
                              }} style={{fontSize:11,background:"#0ea5e9",color:"white",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:700}}>
                                🔄 Photo Medipim
                              </button>
                            )}
                            {p.cip && !medipimLookup[p.cip] && !p.image_url && (
                              <button onClick={()=>lookupMedipim(p.cip)} style={{fontSize:11,background:"#f0f2f5",border:"1px solid #e2e8f0",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:600,color:"#555"}}>
                                🔍 Chercher Medipim
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <button onClick={()=>saveEdit(p)} style={{...PB,padding:"9px",fontSize:13}}>
                        💾 Enregistrer les modifications
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length>80&&<div style={{textAlign:"center",fontSize:12,color:"#999",padding:10}}>Affichage limité à 80 résultats – affinez la recherche.</div>}
            {filtered.length>0&&(
              <div style={{textAlign:"center",padding:"10px 0 4px"}}>
                <button onClick={async()=>{
                  // Utilise allProducts (pas filtered qui est limité à 80 dans l'affichage)
                  const base = filterSection==="all" ? allProducts : allProducts.filter(p=>p._section===filterSection);
                  const toFetch = base.filter(p=>p.cip&&p.cip.length>=7&&!p.image_url);
                  if(toFetch.length===0){flash("Tous les produits filtrés ont déjà une photo (ou pas de CIP).");return;}
                  if(!window.confirm(`Importer les photos Medipim pour ${toFetch.length} produits (sans photo) ?`))return;
                  let ok=0,ko=0;
                  // Traitement par batches de 5 en parallèle
                  const BATCH = 5;
                  for(let i=0; i<toFetch.length; i+=BATCH){
                    const batch = toFetch.slice(i, i+BATCH);
                    await Promise.all(batch.map(async p => {
                      try{
                        const r=await adminFetch(`/.netlify/functions/medipim-lookup?cip=${p.cip}${p.cip7?`&cip7=${p.cip7}`:''}`);
                        const d=await r.json();
                        if(d.image_url){
                          const up=await adminFetch("/.netlify/functions/product-upload-image",{
                            method:"POST",headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({cip:p.cip,image_url:d.image_url})
                          });
                          const uj=await up.json();
                          if(uj.success) ok++; else ko++;
                        }else{ko++;}
                      }catch(e){console.warn(p.cip,e);ko++;}
                    }));
                    flash(`⏳ ${ok+ko}/${toFetch.length} traités...`);
                  }
                  await fetchProducts();
                  flash(`✅ ${ok} photos importées${ko>0?`, ${ko} non trouvées`:""}`)
                }} style={{fontSize:12,background:"#0ea5e9",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontWeight:700}}>
                  🔄 Importer photos Medipim pour les produits filtrés sans photo
                </button>
                {filterSection === "ulabs" && (
                  <div style={{marginTop:8,padding:"10px 14px",background:"#f0fdf4",borderRadius:8,border:"1px solid #86efac",fontSize:12,color:"#166534"}}>
                    💡 <strong>U-Labs :</strong> Le bouton ci-dessus importera les photos pour les {filtered.filter(p=>!p.image_url).length} produits U-Labs sans photo via Medipim.
                  </div>
                )}
              </div>
            )}
            {filtered.length===0&&search&&<div style={{textAlign:"center",fontSize:13,color:"#999",padding:24}}>Aucun produit trouvé pour « {search} »</div>}
          </>
  );
}
