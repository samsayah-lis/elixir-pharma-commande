import React, { useState } from "react";

const IS={width:"100%",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"9px 12px",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
const LS={fontSize:12,fontWeight:700,color:"#444",display:"block",marginBottom:6};
const PB={width:"100%",background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)",color:"white",border:"none",borderRadius:12,padding:"13px",fontWeight:800,fontSize:14,cursor:"pointer"};

const EMPTY_CAMPAIGN = {
  id: "", label: "", subtitle: "", color: "#0d4f3c", accent: "#059669", icon: "🤝",
  restricted_to: [], deadline: "", palier_qty: 500, palier_remise: 33,
  min_refs: 12, conditions: [], groupes: [], active: true
};

export default function AdminCampaigns({ campaigns, setCampaigns, adminFetch, flash }) {
  const [campLoading, setCampLoading] = useState(false);
  const [campEditing, setCampEditing] = useState(null);
  const [campSaving, setCampSaving] = useState(false);

  const fetchCampaigns = async () => {
    setCampLoading(true);
    const r = await adminFetch("/.netlify/functions/campaign-get");
    const d = await r.json();
    setCampaigns(Array.isArray(d) ? d : []);
    setCampLoading(false);
  };

  const saveCampaign = async (camp) => {
    setCampSaving(true);
    const r = await adminFetch("/.netlify/functions/campaign-save", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(camp) });
    const d = await r.json();
    setCampSaving(false);
    if (d.error) { flash("❌ " + d.error); return; }
    flash("✅ Campagne sauvegardée");
    setCampEditing(null);
    fetchCampaigns();
  };

  const deleteCampaign = async (id) => {
    if (!confirm(`Supprimer la campagne "${id}" ?`)) return;
    await adminFetch("/.netlify/functions/campaign-save?id=" + id, { method: "DELETE" });
    flash("🗑️ Campagne supprimée");
    fetchCampaigns();
  };

  // Load on first render if empty
  React.useEffect(() => { if (campaigns.length === 0) fetchCampaigns(); }, []);


  return (
          <div style={{padding:"0 4px"}}>
            {/* ── En-tête ── */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              {campEditing
                ? <button onClick={()=>setCampEditing(null)} style={{fontSize:13,background:"#f0f2f5",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:600}}>← Retour</button>
                : <span style={{fontWeight:800,fontSize:16,color:"#1a2a3a"}}>🏗️ Campagnes groupement</span>
              }
              {!campEditing&&(
                <div style={{display:"flex",gap:8}}>
                  <button onClick={fetchCampaigns} style={{fontSize:12,background:"#f0f2f5",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer"}}>🔄</button>
                  <button onClick={()=>setCampEditing({...EMPTY_CAMPAIGN})} style={{fontSize:12,background:"#059669",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontWeight:700}}>+ Nouvelle campagne</button>
                </div>
              )}
            </div>

            {/* ── Liste des campagnes ── */}
            {!campEditing&&(
              campLoading
                ? <div style={{textAlign:"center",padding:40,color:"#aaa"}}>Chargement…</div>
                : campaigns.length===0
                  ? <div style={{textAlign:"center",padding:40,color:"#aaa",fontSize:14}}>
                      Aucune campagne.{" "}
                      <span style={{color:"#059669",cursor:"pointer",fontWeight:700}} onClick={()=>setCampEditing({...EMPTY_CAMPAIGN})}>Créer la première →</span>
                    </div>
                  : campaigns.map(c=>(
                    <div key={c.id} style={{background:"white",border:"1.5px solid #e2e8f0",borderRadius:12,padding:"14px 18px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{c.icon} {c.label}</div>
                        <div style={{fontSize:11,color:"#aaa",marginTop:2}}>ID : {c.id} · {c.groupes?.length||0} groupes · {c.min_refs} réf. min · palier {c.palier_qty}u →−{c.palier_remise}%</div>
                        {c.restricted_to?.length>0&&<div style={{fontSize:11,color:"#0ea5e9"}}>🔒 {c.restricted_to.join(", ")}</div>}
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:11,background:c.active?"#d1fae5":"#fee2e2",color:c.active?"#065f46":"#dc2626",borderRadius:6,padding:"3px 9px",fontWeight:700}}>{c.active?"Actif":"Inactif"}</span>
                        <button onClick={()=>setCampEditing({...c, restricted_to: c.restricted_to||[], conditions: c.conditions||[], groupes: c.groupes||[]})} style={{fontSize:12,background:"#0ea5e9",color:"white",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontWeight:700}}>✏️ Éditer</button>
                        <button onClick={()=>deleteCampaign(c.id)} style={{fontSize:12,background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontWeight:700}}>🗑️</button>
                      </div>
                    </div>
                  ))
            )}

            {/* ── Formulaire campagne ── */}
            {campEditing&&(()=>{
              const upd = (key,val) => setCampEditing(p=>({...p,[key]:val}));
              const updGroupe = (gi,key,val) => setCampEditing(p=>{ const g=[...p.groupes]; g[gi]={...g[gi],[key]:val}; return {...p,groupes:g}; });
              const addGroupe = () => setCampEditing(p=>({...p, groupes:[...p.groupes, {key:"", label:"", color:"#1e3a5f", accent:"#3b82f6", desc:"", match_regex:"", gratuite_type:"aucune", gratuite_condition:""}]}));
              const removeGroupe = (gi) => setCampEditing(p=>({...p, groupes: p.groupes.filter((_,i)=>i!==gi)}));
              const updCond = (ci,key,val) => setCampEditing(p=>{ const c=[...p.conditions]; c[ci]={...c[ci],[key]:val}; return {...p,conditions:c}; });
              const addCond = () => setCampEditing(p=>({...p, conditions:[...p.conditions, {label:"", match_regex:"", count:1}]}));
              const removeCond = (ci) => setCampEditing(p=>({...p, conditions: p.conditions.filter((_,i)=>i!==ci)}));

              const inp = (label, key, type="text", placeholder="") => (
                <div style={{marginBottom:12}}>
                  <label style={LS}>{label}</label>
                  <input type={type} value={campEditing[key]||""} onChange={e=>upd(key, type==="number"?Number(e.target.value):e.target.value)} placeholder={placeholder} style={IS}/>
                </div>
              );

              return (
                <div>
                  <div style={{fontWeight:800,fontSize:15,marginBottom:16,color:"#1a2a3a"}}>
                    {campEditing.id ? `✏️ Éditer "${campEditing.id}"` : "✨ Nouvelle campagne"}
                  </div>

                  {/* ── Infos générales ── */}
                  <div style={{background:"#f8fafc",borderRadius:12,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#555",marginBottom:10}}>📋 Informations générales</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div>
                        <label style={LS}>Identifiant (ID unique, ex: ulabs)</label>
                        <input value={campEditing.id} onChange={e=>upd("id",e.target.value.toLowerCase().replace(/\s/g,""))} placeholder="ulabs" style={{...IS, fontFamily:"monospace"}} disabled={!!campaigns.find(c=>c.id===campEditing.id&&campEditing.id!=="")&&false}/>
                      </div>
                      <div>
                        <label style={LS}>Nom affiché</label>
                        <input value={campEditing.label} onChange={e=>upd("label",e.target.value)} placeholder="Commande groupée U-Labs" style={IS}/>
                      </div>
                    </div>
                    <div style={{marginTop:10}}>
                      <label style={LS}>Sous-titre</label>
                      <input value={campEditing.subtitle||""} onChange={e=>upd("subtitle",e.target.value)} placeholder="12 réf. min · Fluocaril · Parogencyl…" style={IS}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:10,marginTop:10}}>
                      <div>
                        <label style={LS}>Icône</label>
                        <input value={campEditing.icon} onChange={e=>upd("icon",e.target.value)} style={IS}/>
                      </div>
                      <div>
                        <label style={LS}>Couleur principale</label>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="color" value={campEditing.color} onChange={e=>upd("color",e.target.value)} style={{width:40,height:36,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={campEditing.color} onChange={e=>upd("color",e.target.value)} style={{...IS,flex:1}}/></div>
                      </div>
                      <div>
                        <label style={LS}>Couleur accent</label>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}><input type="color" value={campEditing.accent} onChange={e=>upd("accent",e.target.value)} style={{width:40,height:36,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={campEditing.accent} onChange={e=>upd("accent",e.target.value)} style={{...IS,flex:1}}/></div>
                      </div>
                    </div>
                  </div>

                  {/* ── Accès & Date ── */}
                  <div style={{background:"#f8fafc",borderRadius:12,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#555",marginBottom:10}}>🔒 Accès & Planning</div>
                    <div>
                      <label style={LS}>Emails autorisés (un par ligne — vide = tout le monde)</label>
                      <textarea
                        value={(campEditing.restricted_to||[]).join("\n")}
                        onChange={e=>upd("restricted_to", e.target.value.split("\n").map(s=>s.trim()).filter(Boolean))}
                        placeholder={"pharmacie@example.com\nautrepharmacie@example.com"}
                        rows={3} style={{...IS,resize:"vertical",fontFamily:"monospace",fontSize:12}}
                      />
                    </div>
                    <div style={{marginTop:10}}>
                      <label style={LS}>Date limite (deadline)</label>
                      <input type="datetime-local" value={campEditing.deadline ? campEditing.deadline.slice(0,16) : ""} onChange={e=>upd("deadline",e.target.value)} style={IS}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10}}>
                      <input type="checkbox" id="camp-active" checked={campEditing.active} onChange={e=>upd("active",e.target.checked)} style={{width:16,height:16}}/>
                      <label htmlFor="camp-active" style={{fontSize:13,fontWeight:600}}>Campagne active (visible pour les pharmacies autorisées)</label>
                    </div>
                  </div>

                  {/* ── Objectif palier ── */}
                  <div style={{background:"#f8fafc",borderRadius:12,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#555",marginBottom:10}}>🎯 Objectif & Remise</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      <div>
                        <label style={LS}>Palier (nb unités)</label>
                        <input type="number" value={campEditing.palier_qty} onChange={e=>upd("palier_qty",Number(e.target.value))} style={IS}/>
                      </div>
                      <div>
                        <label style={LS}>Remise palier (%)</label>
                        <input type="number" value={campEditing.palier_remise} onChange={e=>upd("palier_remise",Number(e.target.value))} style={IS}/>
                      </div>
                      <div>
                        <label style={LS}>Nb réf. minimum</label>
                        <input type="number" value={campEditing.min_refs} onChange={e=>upd("min_refs",Number(e.target.value))} style={IS}/>
                      </div>
                    </div>
                  </div>

                  {/* ── Conditions obligatoires ── */}
                  <div style={{background:"#fdf4ff",borderRadius:12,padding:16,marginBottom:16,border:"1px solid #e9d5ff"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#7e22ce"}}>⚠️ Conditions obligatoires</div>
                      <button onClick={addCond} style={{fontSize:12,background:"#7e22ce",color:"white",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontWeight:700}}>+ Ajouter</button>
                    </div>
                    <div style={{fontSize:11,color:"#9333ea",marginBottom:10}}>Ex : "3 dentifrices Parogencyl" → label="Parogencyl", regex="parogencyl.*dentifrice", count=3</div>
                    {(campEditing.conditions||[]).length===0&&<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:8}}>Aucune condition obligatoire</div>}
                    {(campEditing.conditions||[]).map((cond,ci)=>(
                      <div key={ci} style={{background:"white",borderRadius:8,padding:12,marginBottom:8,border:"1px solid #e9d5ff",display:"grid",gridTemplateColumns:"1fr 1fr 80px 32px",gap:8,alignItems:"end"}}>
                        <div>
                          <label style={LS}>Libellé (ex: Parogencyl)</label>
                          <input value={cond.label||""} onChange={e=>updCond(ci,"label",e.target.value)} placeholder="Parogencyl" style={IS}/>
                        </div>
                        <div>
                          <label style={LS}>Regex nom produit (insensible casse)</label>
                          <input value={cond.match_regex||""} onChange={e=>updCond(ci,"match_regex",e.target.value)} placeholder="parogencyl.*dentifrice" style={{...IS,fontFamily:"monospace",fontSize:11}}/>
                        </div>
                        <div>
                          <label style={LS}>Nb min</label>
                          <input type="number" min={1} value={cond.count||1} onChange={e=>updCond(ci,"count",Number(e.target.value))} style={IS}/>
                        </div>
                        <button onClick={()=>removeCond(ci)} style={{background:"#fee2e2",border:"none",borderRadius:8,cursor:"pointer",color:"#dc2626",fontWeight:800,fontSize:16,height:36}}>✕</button>
                      </div>
                    ))}
                  </div>

                  {/* ── Groupes produits ── */}
                  <div style={{background:"#f0fdf4",borderRadius:12,padding:16,marginBottom:16,border:"1px solid #86efac"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#065f46"}}>📦 Groupes de produits</div>
                      <button onClick={addGroupe} style={{fontSize:12,background:"#059669",color:"white",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontWeight:700}}>+ Ajouter un groupe</button>
                    </div>
                    <div style={{fontSize:11,color:"#059669",marginBottom:10}}>Les produits sont classés dans le premier groupe dont la regex correspond à leur nom. Ordre = priorité.</div>
                    {(campEditing.groupes||[]).length===0&&<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:8}}>Aucun groupe — les produits seront affichés sans regroupement</div>}
                    {(campEditing.groupes||[]).map((g,gi)=>(
                      <div key={gi} style={{background:"white",borderRadius:10,padding:14,marginBottom:10,border:"1.5px solid #86efac"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontWeight:700,fontSize:13,color:g.color||"#1a2a3a"}}>{g.icon||"📦"} {g.label||`Groupe ${gi+1}`}</div>
                          <div style={{display:"flex",gap:6}}>
                            {gi>0&&<button onClick={()=>{ const gs=[...campEditing.groupes]; [gs[gi-1],gs[gi]]=[gs[gi],gs[gi-1]]; setCampEditing(p=>({...p,groupes:gs})); }} style={{background:"#f0f2f5",border:"none",borderRadius:6,cursor:"pointer",padding:"4px 8px"}}>↑</button>}
                            {gi<campEditing.groupes.length-1&&<button onClick={()=>{ const gs=[...campEditing.groupes]; [gs[gi],gs[gi+1]]=[gs[gi+1],gs[gi]]; setCampEditing(p=>({...p,groupes:gs})); }} style={{background:"#f0f2f5",border:"none",borderRadius:6,cursor:"pointer",padding:"4px 8px"}}>↓</button>}
                            <button onClick={()=>removeGroupe(gi)} style={{background:"#fee2e2",border:"none",borderRadius:6,cursor:"pointer",color:"#dc2626",fontWeight:800,padding:"4px 8px"}}>✕</button>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <label style={LS}>Clé interne (ex: bdm)</label>
                            <input value={g.key||""} onChange={e=>updGroupe(gi,"key",e.target.value)} placeholder="bdm" style={{...IS,fontFamily:"monospace"}}/>
                          </div>
                          <div>
                            <label style={LS}>Libellé affiché</label>
                            <input value={g.label||""} onChange={e=>updGroupe(gi,"label",e.target.value)} placeholder="🧴 Bains de bouche" style={IS}/>
                          </div>
                        </div>
                        <div style={{marginBottom:8}}>
                          <label style={LS}>Description / condition affichée sous le groupe</label>
                          <input value={g.desc||""} onChange={e=>updGroupe(gi,"desc",e.target.value)} placeholder="🎁 6 achetées = 2 offertes" style={IS}/>
                        </div>
                        <div style={{marginBottom:8}}>
                          <label style={LS}>Regex de correspondance (nom produit, insensible casse)</label>
                          <input value={g.match_regex||""} onChange={e=>updGroupe(gi,"match_regex",e.target.value)} placeholder="bain de bouche" style={{...IS,fontFamily:"monospace",fontSize:11}}/>
                          <div style={{fontSize:10,color:"#aaa",marginTop:2}}>Ex : <code>fluocaril.*145</code> · <code>brosse</code> · <code>junior|kids</code></div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <label style={LS}>Couleur fond</label>
                            <div style={{display:"flex",gap:4}}><input type="color" value={g.color||"#1e3a5f"} onChange={e=>updGroupe(gi,"color",e.target.value)} style={{width:36,height:34,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={g.color||""} onChange={e=>updGroupe(gi,"color",e.target.value)} style={{...IS,flex:1}}/></div>
                          </div>
                          <div>
                            <label style={LS}>Couleur accent</label>
                            <div style={{display:"flex",gap:4}}><input type="color" value={g.accent||"#3b82f6"} onChange={e=>updGroupe(gi,"accent",e.target.value)} style={{width:36,height:34,borderRadius:6,border:"1.5px solid #e2e8f0",cursor:"pointer"}}/><input value={g.accent||""} onChange={e=>updGroupe(gi,"accent",e.target.value)} style={{...IS,flex:1}}/></div>
                          </div>
                          <div>
                            <label style={LS}>Step (incrément + / −)</label>
                            <input type="number" min={1} value={g.step||1} onChange={e=>updGroupe(gi,"step",Number(e.target.value))} style={IS}/>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <label style={LS}>Qté min (1er clic sur + → saute ici)</label>
                            <input type="number" min={0} value={g.min_qty||""} onChange={e=>updGroupe(gi,"min_qty",e.target.value===""?0:Number(e.target.value))} placeholder="ex: 6" style={IS}/>
                            <div style={{fontSize:10,color:"#aaa",marginTop:2}}>0 = pas de minimum</div>
                          </div>
                          <div>
                            <label style={LS}>Multiple obligatoire (ex: 3 → 3, 6, 9…)</label>
                            <input type="number" min={1} value={g.multiple||""} onChange={e=>updGroupe(gi,"multiple",e.target.value===""?1:Number(e.target.value))} placeholder="ex: 3" style={IS}/>
                            <div style={{fontSize:10,color:"#aaa",marginTop:2}}>1 = libre</div>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          <div>
                            <label style={LS}>Gratuité</label>
                            <select value={g.gratuite_type||"aucune"} onChange={e=>updGroupe(gi,"gratuite_type",e.target.value)} style={IS}>
                              <option value="aucune">Aucune</option>
                              <option value="6+2">6 achetées → 2 offertes</option>
                              <option value="3+1">3 achetées → 1 offerte</option>
                            </select>
                          </div>
                          {(g.gratuite_type&&g.gratuite_type!=="aucune")&&(
                            <div>
                              <label style={LS}>Condition d'activation (regex groupe requis, ou vide)</label>
                              <input value={g.gratuite_condition||""} onChange={e=>updGroupe(gi,"gratuite_condition",e.target.value)} placeholder="vide = automatique" style={{...IS,fontSize:11,fontFamily:"monospace"}}/>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Bouton sauvegarder ── */}
                  <button onClick={()=>saveCampaign(campEditing)} disabled={campSaving||!campEditing.id||!campEditing.label} style={{...PB, opacity: (campSaving||!campEditing.id||!campEditing.label)?0.5:1}}>
                    {campSaving ? "⏳ Sauvegarde…" : "💾 Sauvegarder la campagne"}
                  </button>
                  {(!campEditing.id||!campEditing.label)&&<div style={{fontSize:11,color:"#dc2626",marginTop:6,textAlign:"center"}}>L'ID et le nom sont obligatoires</div>}
                </div>
              );
            })()}
          </div>
  );
}
