import React from "react";
import { T, tone, adm } from "../theme.js";
// Outil « laboratoires » de la Centrale OTC (docs/labo-otc.md) : dans le module de l'admin, lui-même chargé à la
// demande (App.jsx), donc hors du bundle des pharmacies
import AdminLabos from "./AdminLabos.jsx";
import { sectionBloquee, nomSection, guillemets } from "./sections-produits.js";
// Ajout et retrait de produits d'une section (recherche Odoo, produits retirés, confirmations) : chargé à la demande
const AdminSections = React.lazy(() => import("./AdminSections.jsx"));

// atomes communs de l'admin (lot 10, src/theme.js) : libellé, champ, bouton principal pétrole
const LS=adm.label, IS=adm.input, PB=adm.btn;

export default function AdminEdit({
  products, search, setSearch, filterSection, setFilterSection,
  editingKey, setEditingKey, editForm, setEditForm,
  uploadingImg, setUploadingImg, uploadedImgs, setUploadedImgs,
  medipimLookup, setMedipimLookup, adminFetch, flash, fetchProducts,
  allProducts, sectionMeta, allSectionsList, promos,
}) {
  // ── sections : cases à cocher des cartes, retrait demandé (une carte ou la sélection), campagnes actives (sections gérées
  // par une campagne : ni ajout ni retrait ici, sections-produits.js) ──
  const [selection, setSelection] = React.useState(() => new Set());
  const [retraitDemande, setRetraitDemande] = React.useState(null);
  // campagnes actives : tant qu'elles ne sont pas lues (attente, erreur), aucune section n'est modifiable (campagnes = null)
  const [campagnesLues, setCampagnesLues] = React.useState({ etat: "attente", ids: null });
  const [lectureCampagnes, setLectureCampagnes] = React.useState(0);
  React.useEffect(() => {
    let vivant = true;
    setCampagnesLues({ etat: "attente", ids: null });
    adminFetch("/.netlify/functions/campaign-get").then(async r => {
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d)) throw new Error(`campagnes : erreur ${r.status}`);
      if (vivant) setCampagnesLues({ etat: "ok", ids: d.filter(c => c?.active && c.id).map(c => String(c.id)) });
    }).catch(() => { if (vivant) setCampagnesLues({ etat: "erreur", ids: null }); });
    return () => { vivant = false; };
  }, [adminFetch, lectureCampagnes]);
  const campagnes = campagnesLues.etat === "ok" ? campagnesLues.ids : null;
  // état d'AdminSections : écriture en cours (boutons « Retirer » des cartes inactifs), produits choisis pas encore ajoutés
  // (confirmation avant de changer de section), barre en bas de l'écran (espace en fin de liste)
  const [etatSections, setEtatSections] = React.useState({ occupe: false, nbChoix: 0, barre: false });
  const [demandeAjout, setDemandeAjout] = React.useState(null);
  React.useEffect(() => { setSelection(new Set()); }, [filterSection]);
  const changerSection = (v) => {
    const n = etatSections.nbChoix;
    if (n > 0 && !window.confirm(n > 1 ? `${n} produits choisis ne sont pas encore ajoutés : les abandonner ?` : "1 produit choisi n'est pas encore ajouté : l'abandonner ?")) return;
    setFilterSection(v);
  };
  const fmt = (n) => n!=null&&!isNaN(n) ? Number(n).toFixed(2)+" €" : "—";

  function CipCopy({ cip }) {
    const [copied, setCopied] = React.useState(false);
    if (!cip || cip === "–") return <span style={{ fontFamily:"monospace", fontSize:11, color:T.inkFaint }}>–</span>;
    const copy = () => { navigator.clipboard.writeText(cip).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        <span style={{ fontFamily:"monospace", fontSize:11, color:T.inkMute }}>{cip}</span>
        <button onClick={copy} title="Copier CIP" style={{
          background: copied ? T.okBg : T.surface2, border:"none", borderRadius:4,
          padding:"1px 5px", cursor:"pointer", fontSize:11, color: copied ? T.ok : T.inkMute,
          fontWeight:700, lineHeight:"14px"
        }}>{copied ? "✓" : "⎘"}</button>
      </span>
    );
  }

  // Bouton « copier le lien » : génère le lien profond vers la fiche produit
  // (ouvre la Saisie de commande pré-remplie côté client). Utilise l'origine
  // courante → le lien colle au domaine où l'admin est ouvert (netlify ou expepharma).
  function LinkCopy({ cip }) {
    const [copied, setCopied] = React.useState(false);
    if (!cip || cip === "–") return null;
    const link = `${window.location.origin}/?cip=${encodeURIComponent(cip)}`;
    const copy = () => { navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };
    return (
      <button onClick={copy} title={`Copier le lien produit :\n${link}`} style={{
        background: copied ? T.okBg : T.mint, border:"none", borderRadius:4,
        padding:"1px 6px", cursor:"pointer", fontSize:11, color: copied ? T.ok : T.teal,
        fontWeight:700, lineHeight:"14px", whiteSpace:"nowrap"
      }}>{copied ? "✓ Lien copié" : "🔗 Lien"}</button>
    );
  }

  const startEdit = (p) => {
    const pv = parseFloat(p.pv) || 0;
    const pct = parseFloat(typeof p.pct === "string" ? p.pct.replace(/[-% ]/g,"") : (p.pct ?? "")) || 0;
    const remise_eur = pv && pct ? (pv * pct / 100).toFixed(2) : "";
    setEditForm({
      name: String(p.name ?? ""), section: String(p._section ?? p.section ?? ""),
      cip: String(p.cip ?? ""), pv: String(p.pv ?? ""), pct: String(pct || ""),
      remise_eur: String(p.remise_eur ?? remise_eur), pn: String(p.pn ?? ""),
      palier: String(p.colis ?? ""), note: String(p.note ?? ""), labo: String(p.labo ?? ""), _lastEdited: "",
    });
    setEditingKey(p._key);
  };
  // Colonne labo présente dans Supabase (products-get la renvoie alors sur chaque produit, même vide) : sans elle,
  // le champ Laboratoire est désactivé et rien n'est envoyé (docs/labo-otc.md)
  const colonneLabo = products.some(p => Object.prototype.hasOwnProperty.call(p, "labo"));
  const laboNet = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

  const saveEdit = async (p) => {
    const pv=parseFloat(editForm.pv), pct=parseFloat(editForm.pct), pn=parseFloat(editForm.pn);
    const newCip = editForm.cip?.trim() || p.cip;
    const cipChanged = newCip !== p.cip;
    const name = (editForm.name ?? "").trim() || p.name;
    const section = editForm.section || p._section;
    const product = {
      cip: newCip, name, section,
      pv: !isNaN(pv) ? pv : p.pv, pct: !isNaN(pct) ? pct : p.pct, pn: !isNaN(pn) ? pn : p.pn,
      remise_eur: parseFloat(editForm.remise_eur) || null,
      // formulaire pré-rempli avec les valeurs actuelles : un champ vidé = valeur effacée
      colis: String(editForm.palier ?? "").trim() !== "" ? parseInt(editForm.palier)||null : null,
      note: String(editForm.note ?? "").trim() || null,
      source: p.source || "catalog", active: true,
      ...(cipChanged ? { old_cip: p.cip } : {}),
      // laboratoire : envoyé seulement s'il a changé (une modification ordinaire ne touche jamais la colonne labo)
      // (formulaire ouvert ailleurs sans ce champ : editForm.labo absent, rien n'est envoyé)
      ...(colonneLabo && editForm.labo !== undefined && laboNet(editForm.labo) !== laboNet(p.labo) ? { labo: laboNet(editForm.labo) || null } : {}),
    };
    try {
      const res = await adminFetch("/.netlify/functions/products-upsert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, action: "update", author: "admin" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await fetchProducts();
      setEditingKey(null);
      flash("✅ Modification enregistrée !" + (cipChanged ? " (CIP changé)" : "") + (section !== p._section ? " (section changée)" : ""));
    } catch(e) { alert("Erreur : " + e.message); }
  };

  const clearEdit = () => { flash("↩️ Fonctionnalité disponible via re-migration"); };

  const GRID_SECTIONS = ["otc", "molnlycke", "obeso"];

  const handleImageUpload = async (cip, file) => {
    if (!file) return;
    setUploadingImg(cip);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result.split(",")[1];
        const mimeType = file.type;
        const res = await adminFetch("/.netlify/functions/product-upload-image", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cip, imageBase64: base64, mimeType }),
        });
        const json = await res.json();
        if (json.success) {
          setUploadedImgs(prev => ({ ...prev, [cip]: json.image_url }));
          flash("🖼️ Photo uploadée !");
          await fetchProducts();
        } else { alert("Erreur upload : " + json.error); }
        setUploadingImg(null);
      };
      reader.readAsDataURL(file);
    } catch(e) { alert("Erreur : " + e.message); setUploadingImg(null); }
  };

  const lookupMedipim = async (cip) => {
    if (!cip || cip.length < 7 || medipimLookup[cip]) return;
    setMedipimLookup(prev => ({ ...prev, [cip]: { loading: true } }));
    try {
      const res = await adminFetch("/.netlify/functions/medipim-lookup?cip=" + cip);
      if (res.ok) {
        const data = await res.json();
        setMedipimLookup(prev => ({ ...prev, [cip]: { ...data, loading: false } }));
      } else if (res.status === 404) {
        setMedipimLookup(prev => ({ ...prev, [cip]: { loading: false, error: "Non trouvé" } }));
      } else {
        // base photos saturée ou indisponible : rien n'est mémorisé, le bouton reste disponible
        setMedipimLookup(prev => { const n = { ...prev }; delete n[cip]; return n; });
        flash(res.status === 429 ? "⏳ Base photos saturée : réessayez dans une minute" : "⚠ Base photos indisponible");
      }
    } catch (e) {
      setMedipimLookup(prev => { const n = { ...prev }; delete n[cip]; return n; });
      flash("⚠ " + e.message);
    }
  };

  // Laboratoire d'un produit dans Medipim (« Fabricant ») : remplit le champ, enregistré avec « Enregistrer ».
  // Code à 7 chiffres (CIP7 / ACL7) : paramètre cip7, la recherche par code-barres exige 8 à 14 chiffres
  const laboMedipim = async (p) => {
    const cip = String(p.cip ?? "").trim(), cip7 = [p.cip7, cip].map(c => String(c ?? "").trim()).find(c => /^\d{7}$/.test(c));
    try {
      const r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${encodeURIComponent(cip)}${cip7 ? `&cip7=${cip7}` : ""}&sansPhoto=1`);
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.labo) {
        setEditForm(f => ({ ...f, labo: d.labo }));
        flash(`Medipim : ${d.labo}${d.labo_autres?.length ? ` (autres organisations : ${d.labo_autres.join(", ")})` : ""} — à enregistrer`);
      } else flash(r.status === 429 ? "⏳ Medipim saturé : réessayez dans une minute" : r.ok || r.status === 404 ? "⚠ Laboratoire introuvable dans Medipim : à saisir à la main" : "⚠ Medipim indisponible");
    } catch (e) { flash("⚠ " + e.message); }
  };
  const labosConnus = [...new Set(products.map(p => laboNet(p.labo)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));

  const sections = [...new Set(products.map(p => p.section).filter(Boolean))].sort();
  const base = allProducts || products;
  const filtered = base.filter(p => {
    const ms = filterSection === "all" || p._section === filterSection || p.section === filterSection;
    const mq = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.cip?.includes(search) || p.labo?.toLowerCase().includes(search.toLowerCase());
    return ms && mq;
  });
  const affiches = filtered.slice(0, 80);
  // actions de section d'une carte : section ordinaire (ni menu promo, ni campagne, ni outil du site) et CIP connu
  const enSection = filterSection !== "all" && !sectionBloquee(filterSection, { campagnes, sections: allSectionsList });
  const retirable = (p) => !!p.cip && p.cip !== "–" && !sectionBloquee(p._section ?? p.section, { campagnes, sections: allSectionsList });
  // recherche de l'onglet → recherche dans le catalogue Odoo pour ajouter à la section (panneau d'AdminSections)
  const termeOdoo = String(search ?? "").trim();
  const chercherOdoo = enSection && termeOdoo.length >= 2 ? (
    <div style={{textAlign:"center",padding:"6px 0 10px"}}>
      <button type="button" onClick={()=>{ setDemandeAjout({ q: termeOdoo, n: Date.now() }); }}
        style={{background:T.mint,color:T.petrol,border:"none",borderRadius:999,padding:"8px 16px",cursor:"pointer",fontSize:12,fontWeight:700,whiteSpace:"normal",lineHeight:1.3,maxWidth:"100%"}}>
        🔍 Chercher {guillemets(termeOdoo)} dans le catalogue Odoo pour l'ajouter à {guillemets(nomSection(filterSection, allSectionsList))}
      </button>
    </div>
  ) : null;

  return (
          <>
            {/* téléphone : recherche et section l'une sous l'autre (le nom de la section reste lisible) */}
            <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="🔍 Rechercher par nom ou CIP..." style={{...IS,flex:"2 1 220px",width:"auto",minWidth:0}}/>
              <select value={filterSection} onChange={e=>changerSection(e.target.value)} aria-label="Section" style={{...IS,flex:"1 1 160px",width:"auto",minWidth:0}}>
                <option value="all">Toutes sections</option>
                {allSectionsList.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <React.Suspense fallback={null}>
              <AdminSections section={filterSection} sections={allSectionsList} products={base} affiches={affiches}
                selection={selection} setSelection={setSelection} retraitDemande={retraitDemande} setRetraitDemande={setRetraitDemande}
                campagnes={campagnes} campagnesEtat={campagnesLues.etat} relireCampagnes={()=>setLectureCampagnes(x=>x+1)}
                recherche={search} demandeAjout={demandeAjout} surEtat={setEtatSections}
                promos={promos} adminFetch={adminFetch} flash={flash} fetchProducts={fetchProducts} />
            </React.Suspense>
            {(filterSection === "all" || filterSection === "otc") && (
              <AdminLabos products={products} adminFetch={adminFetch} flash={flash} fetchProducts={fetchProducts} />
            )}
            <div style={{fontSize:11,color:T.inkMute,marginBottom:12}}>
              {filtered.length} produit(s) dans Supabase
              {false&&(
                <button onClick={()=>{
                  if(!window.confirm("Réinitialiser TOUTES les modifications ?")) return;
                  flash("↩️ Les modifications sont dans Supabase — utilisez l'onglet Modifier pour réinitialiser.");
                }} style={{marginLeft:12,background:T.dangerBg,border:"none",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:11,color:T.danger,fontWeight:700}}>
                  Tout réinitialiser
                </button>
              )}
            </div>

            {affiches.map(p=>{
              const ov={};
              const isEditing=editingKey===p._key;
              const hasOv=!!ov;
              return (
                <div key={p._key} style={{
                  borderRadius:12,marginBottom:8,
                  border:hasOv?"2px solid #fbbf24":"1px solid var(--line)",
                  background:hasOv?"rgba(251,191,36,.1)":T.paper,overflow:"hidden"
                }}>
                  <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:"8px 10px",padding:"10px 14px"}}>
                    {enSection && retirable(p) && (
                      // cible de 44 px au doigt (iPhone) autour de la case de 20 px, sans grandir la carte
                      <label style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minWidth:44,minHeight:44,margin:"-13px -6px -13px -13px",cursor:"pointer",flexShrink:0}}>
                        <input type="checkbox" checked={selection.has(p.cip)} aria-label={`Sélectionner ${p.name}`}
                          onChange={e=>{ const on=e.target.checked; setSelection(s=>{ const n=new Set(s); if(on) n.add(p.cip); else n.delete(p.cip); return n; }); }}
                          style={{width:20,height:20,margin:0,accentColor:"var(--petrol)",cursor:"pointer"}}/>
                      </label>
                    )}
                    <div style={{flex:"1 1 180px",minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:T.petrol,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {hasOv&&<span style={{background:"#fbbf24",color:"#78350f",fontSize:11,fontWeight:700,padding:"1px 5px",borderRadius:4}}>MODIFIÉ</span>}
                        <span style={{wordBreak:"break-word"}}>{p.name}</span>
                      </div>
                      <div style={{fontSize:11,color:T.inkMute,marginTop:2}}>
                        {p._sectionLabel}{p.labo && <> · <span style={{color:T.teal,fontWeight:600}}>{p.labo}</span></>}{p.cip && <> · <CipCopy cip={p.cip}/> <LinkCopy cip={p.cip}/></>}
                        {" · "}
                        <span style={{color:hasOv?T.warn:T.inkSoft,fontWeight:600}}>
                          {fmt(ov?.pn??p.pn)} net
                          {(ov?.palier??p.palier??p.colis)?` · ×${ov?.palier??p.palier??p.colis}`:""}
                        </span>
                        {hasOv&&<span style={{color:T.inkMute,marginLeft:4}}>(orig: {fmt(p.pn)})</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",justifyContent:"flex-end",gap:6,marginLeft:"auto",flexShrink:0}}>
                      {hasOv&&(
                        <button onClick={()=>clearEdit(p._key)} title="Réinitialiser" style={{background:T.warnBg,border:"none",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,color:T.warn,fontWeight:700}}>↩</button>
                      )}
                      <button onClick={()=>isEditing?setEditingKey(null):startEdit(p)} style={{
                        background:isEditing?T.sand:T.petrol,border:"none",borderRadius:8,
                        padding:"5px 12px",cursor:"pointer",fontSize:12,
                        color:isEditing?T.inkSoft:T.paper,fontWeight:700
                      }}>{isEditing?"Annuler":"✏️ Modifier"}</button>
                      {retirable(p) && (
                        <button type="button" onClick={()=>setRetraitDemande([p])} disabled={etatSections.occupe} title={`Retirer de la section « ${nomSection(p._section ?? p.section, allSectionsList)} »`}
                          style={{background:T.dangerBg,border:"none",borderRadius:8,padding:"5px 10px",cursor:etatSections.occupe?"default":"pointer",opacity:etatSections.occupe?0.5:1,fontSize:12,color:T.danger,fontWeight:700}}>
                          Retirer<span className="ex-admin-libelle"> de la section</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing&&(
                    <div style={{background:T.surface,borderTop:"1px solid var(--line)",padding:"14px 14px 16px"}}>
                      <div style={{marginBottom:10}}>
                        <label style={{...LS,fontSize:11}}>Nom affiché aux pharmacies</label>
                        <input value={editForm.name ?? ""} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))}
                          style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                        <div>
                          <label style={{...LS,fontSize:11}}>Code CIP / Référence</label>
                          <input value={editForm.cip} onChange={e=>setEditForm(f=>({...f,cip:e.target.value}))}
                            placeholder="3400930000000" style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                        </div>
                        <div>
                          <label style={{...LS,fontSize:11}}>Section</label>
                          <select value={editForm.section ?? p._section} onChange={e=>setEditForm(f=>({...f,section:e.target.value}))}
                            style={{...IS,fontSize:12,padding:"7px 10px"}}>
                            {(allSectionsList||[]).filter(s=>!String(s.key).startsWith("promo_")).map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                            {!(allSectionsList||[]).some(s=>s.key===p._section) && <option value={p._section}>{p._section}</option>}
                          </select>
                        </div>
                      </div>
                      {p._price_source === "odoo" && (
                        <div style={{fontSize:11,color:T.inkSoft,background:T.surface2,borderRadius:8,padding:"6px 10px",marginBottom:10}}>
                          ℹ️ Prix affichés aux pharmacies = Odoo (prix de vente et liste n°5), mis à jour automatiquement : pour les changer, modifiez-les dans Odoo. Les prix ci-dessous ne servent que si le produit sort d'Odoo.
                        </div>
                      )}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:8}}>
                        {[
                          {key:"pv",  label:"Prix brut (€)"},
                          {key:"pct", label:"Remise (%)"},
                          {key:"remise_eur", label:"Remise (€)"},
                        ].map(({key,label})=>(
                          <div key={key}>
                            <label style={{...LS,fontSize:11}}>{label}</label>
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
                            <label style={{...LS,fontSize:11,color:green?T.ok:undefined}}>{label}</label>
                            <input type="number" step="0.01" value={editForm[key]||""}
                              onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))}
                              style={{...IS,fontSize:12,padding:"7px 10px",
                                borderColor:green?T.ok:T.lineField,
                                fontWeight:green?700:400,color:green?T.ok:"inherit"}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{marginBottom:12}}>
                        <label style={{...LS,fontSize:11}}>Note</label>
                        <input value={editForm.note} onChange={e=>setEditForm(f=>({...f,note:e.target.value}))}
                          placeholder="Stock limité, Promo..." style={{...IS,fontSize:12,padding:"7px 10px"}}/>
                      </div>
                      <div style={{marginBottom:12}}>
                        <label htmlFor={`labo-${p._key}`} style={{...LS,fontSize:11}}>Laboratoire (tri et filtre du site)</label>
                        <div style={{display:"flex",gap:8}}>
                          <input id={`labo-${p._key}`} list="labos-connus" value={editForm.labo ?? ""} disabled={!colonneLabo}
                            onChange={e=>setEditForm(f=>({...f,labo:e.target.value}))}
                            placeholder={colonneLabo ? "Ex. Bayer — vide : non renseigné" : "Colonne labo à créer dans Supabase (docs/labo-otc.md)"}
                            style={{...IS,fontSize:12,padding:"7px 10px",flex:1}}/>
                          {colonneLabo && p.cip && (
                            <button type="button" onClick={()=>laboMedipim(p)} style={{fontSize:11,background:T.surface2,border:"1px solid var(--line)",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:600,color:T.inkSoft,whiteSpace:"nowrap"}}>
                              🔍 Medipim
                            </button>
                          )}
                        </div>
                        <datalist id="labos-connus">{labosConnus.map(l=><option key={l} value={l}/>)}</datalist>
                      </div>
                      {GRID_SECTIONS.includes(p._section) && (
                        <div style={{marginBottom:12}}>
                          <label style={{...LS,fontSize:11}}>📸 Photo produit</label>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
                            {(uploadedImgs[p.cip] || p.image_url) && (
                              <img src={uploadedImgs[p.cip] || p.image_url} alt=""
                                style={{width:48,height:48,objectFit:"cover",borderRadius:6,border:"1px solid var(--line)"}}/>
                            )}
                            <label style={{
                              display:"inline-block",padding:"6px 12px",borderRadius:8,
                              background:T.surface2,border:"1px solid var(--line)",cursor:"pointer",
                              fontSize:11,fontWeight:600,color:T.inkSoft
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
                              }} style={{fontSize:11,background:T.teal,color:T.paper,border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:700}}>
                                🔄 Photo Medipim
                              </button>
                            )}
                            {p.cip && !medipimLookup[p.cip] && !p.image_url && (
                              <button onClick={()=>lookupMedipim(p.cip)} style={{fontSize:11,background:T.surface2,border:"1px solid var(--line)",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:600,color:T.inkSoft}}>
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
            {filtered.length>80&&<div style={{textAlign:"center",fontSize:12,color:T.inkMute,padding:10}}>Affichage limité à 80 résultats – affinez la recherche.</div>}
            {filtered.length>0&&chercherOdoo}
            {filtered.length>0&&(
              <div style={{textAlign:"center",padding:"10px 0 4px"}}>
                <button onClick={async()=>{
                  // Utilise allProducts (pas filtered qui est limité à 80 dans l'affichage)
                  const base = filterSection==="all" ? allProducts : allProducts.filter(p=>p._section===filterSection);
                  const toFetch = base.filter(p=>p.cip&&p.cip.length>=7&&!p.image_url);
                  if(toFetch.length===0){flash("Tous les produits filtrés ont déjà une photo (ou pas de CIP).");return;}
                  if(!window.confirm(`Importer les photos Medipim pour ${toFetch.length} produits (sans photo) ?`))return;
                  let ok=0,ko=0,sature=0;
                  // Un produit à la fois, ~1 par seconde : la clé de la base photos est partagée (100 appels/min) ;
                  // une saturation (429) est réessayée après une pause et n'est pas comptée comme « non trouvée »
                  const pause = ms => new Promise(r => setTimeout(r, ms));
                  for (const p of toFetch) {
                    try {
                      let r = null;
                      for (let essai = 0; essai < 3; essai++) {
                        r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${p.cip}${p.cip7?`&cip7=${p.cip7}`:''}`);
                        if (r.status !== 429 && r.status < 500) break;
                        await pause((parseInt(r.headers.get("Retry-After")) || 20) * 1000);
                      }
                      if (r.status === 429 || r.status >= 500) { sature++; continue; }
                      const d = await r.json().catch(() => ({}));
                      if (d.image_url) {
                        const up=await adminFetch("/.netlify/functions/product-upload-image",{
                          method:"POST",headers:{"Content-Type":"application/json"},
                          body:JSON.stringify({cip:p.cip,image_url:d.image_url})
                        });
                        const uj=await up.json();
                        if(uj.success) ok++; else ko++;
                      } else { ko++; }
                    } catch(e) { console.warn(p.cip,e); ko++; }
                    flash(`⏳ ${ok+ko+sature}/${toFetch.length} traités...`);
                    await pause(1000);
                  }
                  await fetchProducts();
                  flash(`✅ ${ok} photos importées${ko>0?`, ${ko} non trouvées`:""}${sature>0?`, ${sature} non traitées (base photos saturée : relancez plus tard)`:""}`)
                }} style={{fontSize:12,background:T.teal,color:T.paper,border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontWeight:700}}>
                  🔄 Importer photos Medipim pour les produits filtrés sans photo
                </button>
                {filterSection === "ulabs" && (
                  <div style={{marginTop:8,padding:"10px 14px",background:T.okBg,borderRadius:8,border:`1px solid ${tone("ok").border}`,fontSize:12,color:T.ok}}>
                    💡 <strong>U-Labs :</strong> Le bouton ci-dessus importera les photos pour les {filtered.filter(p=>!p.image_url).length} produits U-Labs sans photo via Medipim.
                  </div>
                )}
              </div>
            )}
            {filtered.length===0&&search&&<div style={{textAlign:"center",fontSize:13,color:T.inkMute,padding:24}}>Aucun produit trouvé pour « {search} »</div>}
            {filtered.length===0&&chercherOdoo}
            {/* barre « à ajouter » ou « Retirer la sélection » en bas de l'écran : la fin de liste reste atteignable */}
            {etatSections.barre && <div aria-hidden="true" style={{height:150}}/>}
          </>
  );
}
