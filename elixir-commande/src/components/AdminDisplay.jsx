import React, { useState } from "react";

export default function AdminDisplay({ displayConfig, saveDisplayConfig, orderedKeys, allMeta, allSectionKeys, hiddenTabs, defaultTab, syncConfigToSupabase, flash, setTab }) {
  // Local state
  const [dragIdx, setDragIdx] = useState(null);
  const [editingSubtitle, setEditingSubtitle] = useState(null);
  const [subtitleInput, setSubtitleInput] = useState("");
  const [editingIcon, setEditingIcon] = useState(null);
  const [iconInput, setIconInput] = useState("");
  const [editingLabel, setEditingLabel] = useState(null);
  const [labelInput, setLabelInput] = useState("");
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSection, setNewSection] = useState({ key: "", label: "", subtitle: "", icon: "📁", color: "#333333", accent: "#666666" });

  const saveSubtitle = (key) => {
    saveDisplayConfig({ subtitles: { ...(displayConfig.subtitles || {}), [key]: subtitleInput } });
    setEditingSubtitle(null);
  };
  const saveIcon = (key) => {
    saveDisplayConfig({ icons: { ...(displayConfig.icons || {}), [key]: iconInput } });
    setEditingIcon(null);
  };
  const saveLabel = (key) => {
    saveDisplayConfig({ labels: { ...(displayConfig.labels || {}), [key]: labelInput } });
    setEditingLabel(null);
  };
  const addCustomSection = () => {
    if (!newSection.key.trim() || !newSection.label.trim()) return alert("Clé et nom requis");
    const key = newSection.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const existing = displayConfig.customSections || [];
    if (existing.some(s => s.key === key) || allSectionKeys.includes(key)) return alert("Cette clé existe déjà");
    const cs = { ...newSection, key };
    saveDisplayConfig({ tabOrder: [...orderedKeys, key], customSections: [...existing, cs] });
    setNewSection({ key: "", label: "", subtitle: "", icon: "📁", color: "#333333", accent: "#666666" });
    setShowNewSection(false);
  };
  const removeCustomSection = (key) => {
    if (!window.confirm(`Supprimer la section "${key}" ?`)) return;
    const existing = (displayConfig.customSections || []).filter(s => s.key !== key);
    saveDisplayConfig({ customSections: existing, tabOrder: orderedKeys.filter(k => k !== key) });
  };
  const moveTab = (from, to) => {
    if (from === to) return;
    const order = [...orderedKeys];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    saveDisplayConfig({ tabOrder: order });
  };
  const toggleTabVisibility = (key) => {
    const current = new Set(displayConfig.hiddenTabs || []);
    if (current.has(key)) current.delete(key); else current.add(key);
    saveDisplayConfig({ hiddenTabs: [...current] });
  };
  const setDefaultTabFn = (key) => saveDisplayConfig({ defaultTab: key });

  return (
          <div>
            <div style={{fontWeight:800,fontSize:18,color:"#0f2d3d",marginBottom:8}}>Affichage global</div>
            <div style={{fontSize:12,color:"#888",marginBottom:16}}>Personnalisez l'ordre, la visibilité et le comportement des onglets du catalogue. Les modifications sont appliquées instantanément.</div>

            {/* Sync config button */}
            <div style={{background:"#eff6ff",borderRadius:12,padding:"12px 16px",marginBottom:20,border:"1px solid #bfdbfe",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#1e40af"}}>📡 Synchronisation config → clients</div>
                <div style={{fontSize:11,color:"#3b82f6",marginTop:2}}>Pousse votre config (onglets, promos, sections) vers Supabase pour que tous les clients la voient.</div>
              </div>
              <button onClick={async () => { await syncConfigToSupabase(); flash("✓ Config synchronisée vers Supabase"); }}
                style={{background:"#2563eb",color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                Synchroniser maintenant
              </button>
            </div>

            {/* Ordre + visibilité des onglets */}
            <div style={{background:"white",borderRadius:14,padding:"20px 24px",marginBottom:20,border:"1px solid #e8ecf0"}}>
              <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d",marginBottom:4}}>Ordre et visibilité des onglets</div>
              <div style={{fontSize:11,color:"#aaa",marginBottom:16}}>Glissez-déposez pour réorganiser · Cliquez sur l'œil pour masquer/afficher · L'étoile définit l'onglet par défaut</div>

              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {orderedKeys.map((key, idx) => {
                  const baseMeta = allMeta[key];
                  if (!baseMeta) return null;
                  // Apply overrides for display
                  const meta = {
                    ...baseMeta,
                    icon: displayConfig.icons?.[key] || baseMeta.icon,
                    label: displayConfig.labels?.[key] || baseMeta.label,
                    subtitle: displayConfig.subtitles?.[key] ?? baseMeta.subtitle,
                  };
                  const isHidden = hiddenTabs.has(key);
                  const isDefault = defaultTab === key;
                  const isDragging = dragIdx === idx;
                  const isCustom = baseMeta.isCustom;
                  const isPromo = baseMeta.isPromo;

                  return (
                    <div key={key}
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => { e.preventDefault(); }}
                      onDrop={() => { if (dragIdx !== null) moveTab(dragIdx, idx); setDragIdx(null); }}
                      onDragEnd={() => setDragIdx(null)}
                      style={{
                        display:"flex", alignItems:"center", gap:12,
                        padding:"10px 14px", borderRadius:10,
                        background: isDragging ? "#dbeafe" : isHidden ? "#fafafa" : "white",
                        border: isDragging ? "2px dashed #3b82f6" : isHidden ? "1px solid #eee" : "1px solid #e2e8f0",
                        opacity: isHidden ? 0.5 : 1,
                        cursor:"grab", transition:"all 0.15s",
                      }}
                    >
                      {/* Drag handle */}
                      <span style={{fontSize:14,color:"#ccc",cursor:"grab",userSelect:"none"}}>⣿</span>

                      {/* Position */}
                      <span style={{fontSize:10,color:"#bbb",fontWeight:700,minWidth:18,textAlign:"center"}}>{idx+1}</span>

                      {/* Editable Icon */}
                      {editingIcon === key ? (
                        <div style={{display:"flex",gap:2,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                          <input value={iconInput} onChange={e=>setIconInput(e.target.value)}
                            onKeyDown={e=>{ if(e.key==="Enter") saveIcon(key); if(e.key==="Escape") setEditingIcon(null); }}
                            autoFocus style={{width:36,textAlign:"center",border:"1.5px solid #3b82f6",borderRadius:6,padding:"2px",fontSize:16,outline:"none"}} />
                          <button onClick={e=>{e.stopPropagation();saveIcon(key);}} style={{background:"#059669",color:"white",border:"none",borderRadius:4,padding:"2px 5px",fontSize:9,cursor:"pointer"}}>✓</button>
                        </div>
                      ) : (
                        <span style={{fontSize:18,width:28,textAlign:"center",cursor:"pointer"}} title="Cliquer pour changer l'icône"
                          onClick={e=>{e.stopPropagation();setEditingIcon(key);setIconInput(meta.icon||"");}}>
                          {meta.icon}
                        </span>
                      )}

                      <div style={{width:6,height:28,borderRadius:3,background:meta.accent,flexShrink:0}} />

                      {/* Editable Label + subtitle */}
                      <div style={{flex:1,minWidth:0}}>
                        {editingLabel === key ? (
                          <div style={{display:"flex",gap:4,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                            <input value={labelInput} onChange={e=>setLabelInput(e.target.value)}
                              onKeyDown={e=>{ if(e.key==="Enter") saveLabel(key); if(e.key==="Escape") setEditingLabel(null); }}
                              autoFocus style={{flex:1,border:"1.5px solid #3b82f6",borderRadius:6,padding:"3px 8px",fontSize:13,fontWeight:600,outline:"none",fontFamily:"inherit"}} />
                            <button onClick={e=>{e.stopPropagation();saveLabel(key);}} style={{background:"#059669",color:"white",border:"none",borderRadius:4,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>✓</button>
                            <button onClick={e=>{e.stopPropagation();setEditingLabel(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#aaa",fontSize:12}}>✕</button>
                          </div>
                        ) : (
                          <div style={{fontWeight:600,fontSize:13,color:isHidden?"#bbb":"#0f2d3d",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}
                            onClick={e=>{e.stopPropagation();setEditingLabel(key);setLabelInput(meta.label||"");}}>
                            <span>{meta.label}</span>
                            <span style={{fontSize:9,opacity:0.4}}>✏️</span>
                            {isCustom && <span style={{fontSize:8,background:"#f0fdf4",color:"#059669",borderRadius:4,padding:"1px 5px",fontWeight:700}}>CUSTOM</span>}
                            {isPromo && <span style={{fontSize:8,background:"#faf5ff",color:"#7c3aed",borderRadius:4,padding:"1px 5px",fontWeight:700}}>PROMO</span>}
                          </div>
                        )}
                        {editingSubtitle === key ? (
                          <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2}} onClick={e=>e.stopPropagation()}>
                            <input value={subtitleInput} onChange={e=>setSubtitleInput(e.target.value)}
                              onKeyDown={e=>{ if(e.key==="Enter") saveSubtitle(key); if(e.key==="Escape") setEditingSubtitle(null); }}
                              autoFocus placeholder="Sous-titre de la section..."
                              style={{flex:1,border:"1.5px solid #3b82f6",borderRadius:6,padding:"3px 8px",fontSize:11,outline:"none",fontFamily:"inherit"}} />
                            <button onClick={(e)=>{e.stopPropagation();saveSubtitle(key);}}
                              style={{background:"#059669",color:"white",border:"none",borderRadius:4,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>✓</button>
                            <button onClick={(e)=>{e.stopPropagation();setEditingSubtitle(null);}}
                              style={{background:"none",border:"none",cursor:"pointer",color:"#aaa",fontSize:12}}>✕</button>
                          </div>
                        ) : (
                          <div style={{fontSize:10,color: (displayConfig.subtitles?.[key] != null) ? "#3b82f6" : "#aaa",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}
                            onClick={(e)=>{e.stopPropagation();setEditingSubtitle(key);setSubtitleInput(displayConfig.subtitles?.[key] ?? meta.subtitle ?? "");}}>
                            <span>{displayConfig.subtitles?.[key] ?? meta.subtitle ?? "Aucun sous-titre"}</span>
                            <span style={{fontSize:9,opacity:0.5}}>✏️</span>
                          </div>
                        )}
                      </div>

                      {/* Special badges */}
                      {meta.specialView && <span style={{fontSize:9,background:"#eff6ff",color:"#3b82f6",borderRadius:4,padding:"2px 6px",fontWeight:600}}>ODOO</span>}
                      {meta.restrictedTo && <span style={{fontSize:9,background:"#fef3c7",color:"#92400e",borderRadius:4,padding:"2px 6px",fontWeight:600}}>GROUPEMENT</span>}

                      {/* Default star */}
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!isHidden) setDefaultTabFn(key); }}
                        title={isDefault ? "Onglet par défaut" : "Définir comme onglet par défaut"}
                        style={{background:"none",border:"none",cursor:isHidden?"default":"pointer",fontSize:18,padding:4,opacity:isHidden?0.2:1}}
                      >
                        {isDefault ? "⭐" : "☆"}
                      </button>

                      {/* Visibility toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleTabVisibility(key); }}
                        title={isHidden ? "Afficher cet onglet" : "Masquer cet onglet"}
                        style={{background:isHidden?"#fee2e2":"#d1fae5",border:"none",cursor:"pointer",borderRadius:6,padding:"4px 8px",fontSize:13}}
                      >
                        {isHidden ? "👁️‍🗨️" : "👁️"}
                      </button>

                      {/* Move buttons */}
                      <div style={{display:"flex",flexDirection:"column",gap:1}}>
                        <button onClick={(e)=>{e.stopPropagation();if(idx>0)moveTab(idx,idx-1);}}
                          disabled={idx===0}
                          style={{background:"#f0f2f5",border:"none",borderRadius:4,cursor:idx>0?"pointer":"default",padding:"1px 6px",fontSize:10,opacity:idx>0?1:0.3}}>▲</button>
                        <button onClick={(e)=>{e.stopPropagation();if(idx<orderedKeys.length-1)moveTab(idx,idx+1);}}
                          disabled={idx>=orderedKeys.length-1}
                          style={{background:"#f0f2f5",border:"none",borderRadius:4,cursor:"pointer",padding:"1px 6px",fontSize:10,opacity:idx<orderedKeys.length-1?1:0.3}}>▼</button>
                      </div>

                      {/* Delete custom section */}
                      {isCustom && (
                        <button onClick={(e)=>{e.stopPropagation();removeCustomSection(key);}}
                          title="Supprimer cette section"
                          style={{background:"#fee2e2",border:"none",borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",color:"#dc2626",fontWeight:700}}>🗑️</button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add new section button + form */}
              {!showNewSection ? (
                <button onClick={()=>setShowNewSection(true)}
                  style={{marginTop:12,width:"100%",padding:"12px",border:"2px dashed #cbd5e0",borderRadius:10,background:"transparent",
                    cursor:"pointer",fontSize:13,fontWeight:600,color:"#888",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#3b82f6";e.currentTarget.style.color="#3b82f6"}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#cbd5e0";e.currentTarget.style.color="#888"}}>
                  ➕ Créer une nouvelle section
                </button>
              ) : (
                <div style={{marginTop:12,background:"#f0f9ff",border:"2px solid #3b82f6",borderRadius:12,padding:"16px 20px"}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#1e40af",marginBottom:12}}>➕ Nouvelle section</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#444",display:"block",marginBottom:4}}>Clé technique *</label>
                      <input value={newSection.key} onChange={e=>setNewSection(s=>({...s,key:e.target.value}))}
                        placeholder="ex: promo_ete" style={{width:"100%",border:"1.5px solid #ddd",borderRadius:8,padding:"7px 10px",fontSize:12,outline:"none",boxSizing:"border-box"}} />
                    </div>
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#444",display:"block",marginBottom:4}}>Nom affiché *</label>
                      <input value={newSection.label} onChange={e=>setNewSection(s=>({...s,label:e.target.value}))}
                        placeholder="ex: Promo Été 2026" style={{width:"100%",border:"1.5px solid #ddd",borderRadius:8,padding:"7px 10px",fontSize:12,outline:"none",boxSizing:"border-box"}} />
                    </div>
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#444",display:"block",marginBottom:4}}>Icône (emoji)</label>
                      <input value={newSection.icon} onChange={e=>setNewSection(s=>({...s,icon:e.target.value}))}
                        style={{width:"100%",border:"1.5px solid #ddd",borderRadius:8,padding:"7px 10px",fontSize:16,outline:"none",boxSizing:"border-box",textAlign:"center"}} />
                    </div>
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#444",display:"block",marginBottom:4}}>Sous-titre</label>
                      <input value={newSection.subtitle} onChange={e=>setNewSection(s=>({...s,subtitle:e.target.value}))}
                        placeholder="Description courte..." style={{width:"100%",border:"1.5px solid #ddd",borderRadius:8,padding:"7px 10px",fontSize:12,outline:"none",boxSizing:"border-box"}} />
                    </div>
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#444",display:"block",marginBottom:4}}>Couleur principale</label>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="color" value={newSection.color} onChange={e=>setNewSection(s=>({...s,color:e.target.value}))} style={{width:32,height:32,border:"none",borderRadius:6,cursor:"pointer"}} />
                        <span style={{fontSize:10,color:"#888",fontFamily:"monospace"}}>{newSection.color}</span>
                      </div>
                    </div>
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#444",display:"block",marginBottom:4}}>Couleur accent</label>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="color" value={newSection.accent} onChange={e=>setNewSection(s=>({...s,accent:e.target.value}))} style={{width:32,height:32,border:"none",borderRadius:6,cursor:"pointer"}} />
                        <span style={{fontSize:10,color:"#888",fontFamily:"monospace"}}>{newSection.accent}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:14}}>
                    <button onClick={addCustomSection}
                      style={{background:"#0f2d3d",color:"white",border:"none",borderRadius:8,padding:"8px 20px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                      ✓ Créer la section
                    </button>
                    <button onClick={()=>setShowNewSection(false)}
                      style={{background:"#f0f2f5",color:"#666",border:"none",borderRadius:8,padding:"8px 20px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Onglet par défaut */}
            <div style={{background:"white",borderRadius:14,padding:"20px 24px",marginBottom:20,border:"1px solid #e8ecf0"}}>
              <div style={{fontWeight:700,fontSize:15,color:"#0f2d3d",marginBottom:12}}>Onglet par défaut à l'ouverture</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {orderedKeys.filter(k => !hiddenTabs.has(k)).map(key => {
                  const meta = allMeta[key];
                  if (!meta) return null;
                  return (
                    <button key={key} onClick={() => setDefaultTabFn(key)}
                      style={{
                        display:"flex",alignItems:"center",gap:6,
                        padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600,
                        cursor:"pointer",transition:"all 0.15s",
                        background: defaultTab===key ? meta.color : "#f8fafc",
                        color: defaultTab===key ? "white" : "#444",
                        border: defaultTab===key ? `2px solid ${meta.accent}` : "1px solid #ddd",
                      }}>
                      {meta.icon} {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Résumé */}
            <div style={{background:"#eff6ff",borderRadius:14,padding:"16px 20px",border:"1px solid #bfdbfe",fontSize:12,color:"#1e40af",lineHeight:1.6}}>
              <strong>Résumé :</strong> {(displayConfig.tabOrder||allSectionKeys).filter(k => !hiddenTabs.has(k)).length} onglets visibles sur {allSectionKeys.length} ·
              Onglet par défaut : <strong>{allMeta[defaultTab]?.icon} {allMeta[defaultTab]?.label}</strong> ·
              Les modifications sont sauvegardées automatiquement dans le navigateur.
            </div>
          </div>
  );
}
