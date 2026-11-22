import { useEffect,useState } from 'react';
import { Champ } from './ui';
import { ETAPES } from './client';
import { TYPES, FONCTIONS } from './logique';
export function ChoixCompte({ comptes=[],appel,value,onChange }) {
  const [q,setQ]=useState(''),[resultat,setResultat]=useState([]),[erreur,setErreur]=useState(''),[charge,setCharge]=useState(false),[choisi,setChoisi]=useState(null);
  useEffect(()=>{
    if(!appel)return;
    let actif=true;setCharge(true);
    const timer=setTimeout(()=>appel('comptes.lister',{filtres:{tri:'nom',sens:'asc',limite:25,...(q.trim()?{recherche:q.trim()}:{})}}).then(r=>{
      if(actif){setResultat(r.donnees.lignes);setErreur('');setCharge(false);}
    },e=>{if(actif){setErreur(e.message);setCharge(false);}}),200);
    return ()=>{actif=false;clearTimeout(timer);};
  },[appel,q]);
  if(appel)comptes=[...new Map([...comptes,...resultat,...(choisi?[choisi]:[])].map(c=>[c.id,c])).values()];
  const lignes=comptes.filter(c=>c.id===value || !c.archive && c.nom.toLowerCase().includes(q.toLowerCase()));
  return <><Champ label="Rechercher un compte" type="search" value={q} onChange={e=>setQ(e.target.value)} /><Champ label="Compte"><select required value={value || ''} onChange={e=>{setChoisi(comptes.find(c=>c.id===e.target.value));onChange(e.target.value);}}><option value="">Choisir un compte</option>{lignes.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}</select></Champ>{charge && <p role="status">Recherche des comptes…</p>}{erreur && <p role="alert">{erreur}</p>}{appel && <small>25 résultats maximum : précisez la recherche pour trouver un autre compte.</small>}</>;
}
export function FormulaireObjet({ ressource,comptes,appel,utilisateur,enregistrer,busy,fermer,initial={} }) {
  const [f,setF]=useState({ compte_id:'',titre:'',nom:'',type:'tache',assigne_email:utilisateur.email,fonction:'autre',etape:'a_qualifier',probabilite:'',...initial });
  const changer=(k,v)=>setF(x=>({ ...x,[k]:v }));
  const champ=(k,label,type='text',required=false,options={})=><Champ key={k} label={label} type={type} required={required} autoFocus={k==='nom' || k==='titre'} value={f[k] ?? ''} onChange={e=>changer(k,e.target.value)} {...options} />;
  async function sauver(e) {
    e.preventDefault();
    const champs=ressource==='activites' ? ['compte_id','titre','type','assigne_email','echeance','notes'] : ressource==='contacts' ? ['compte_id','nom','prenom','fonction','email','telephone','principal'] : ressource==='opportunites' ? ['compte_id','titre','etape','probabilite','montant_mensuel_estime','date_visee','motif_perte'] : ['nom','ville','code_postal','email','telephone','notes'];
    const d=Object.fromEntries(champs.filter(k=>f[k] !== undefined).map(k=>[k,f[k]==='' ? null : ['probabilite','montant_mensuel_estime'].includes(k) ? Number(f[k]) : k==='echeance' ? new Date(f[k]).toISOString() : f[k]]));
    if(ressource==='comptes') d.statut='prospect';
    const r=await enregistrer(`${ressource}.${initial.id ? "modifier" : "creer"}`,d,initial.id ? initial : undefined);if(r)fermer(r);
  }
  return <form className="crm-form" onSubmit={sauver}><h2>{initial.id ? 'Modifier' : ({ activites:'Nouvelle activité',contacts:'Nouveau contact',opportunites:'Nouvelle opportunité',comptes:'Nouveau prospect' })[ressource]}</h2><div className="crm-grille">
    {ressource !== 'comptes' && <ChoixCompte appel={appel} comptes={comptes} value={f.compte_id} onChange={v=>changer('compte_id',v)} />}
    {champ(['contacts','comptes'].includes(ressource)?'nom':'titre',ressource==='contacts'?'Nom du contact':ressource==='comptes'?'Nom de la pharmacie':'Objet','text',true)}
    {ressource==='activites' && <><Champ label="Type"><select value={f.type} onChange={e=>changer('type',e.target.value)}>{Object.entries(TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Champ>{champ('echeance','Échéance','datetime-local',['tache','rendez_vous'].includes(f.type))}{champ('assigne_email','Assignée à (e-mail)','email')}</>}
    {ressource==='contacts' && <>{champ('prenom','Prénom')}<Champ label="Fonction"><select value={f.fonction} onChange={e=>changer('fonction',e.target.value)}>{Object.entries(FONCTIONS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Champ><label><input type="checkbox" checked={!!f.principal} onChange={e=>changer('principal',e.target.checked)} />Contact principal</label></>}
    {['comptes','contacts'].includes(ressource) && <>{champ('email','E-mail','email')}{champ('telephone','Téléphone','tel')}</>}
    {ressource==='comptes' && <>{champ('ville','Ville')}{champ('code_postal','Code postal','text',false,{ pattern:'[0-9]{5}' })}</>}
    {ressource==='opportunites' && <><Champ label="Étape"><select value={f.etape} onChange={e=>changer('etape',e.target.value)}>{Object.entries(ETAPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Champ>{champ('montant_mensuel_estime','Montant mensuel estimé (€)','number',false,{ min:0,step:'0.01' })}{champ('probabilite','Probabilité (%)','number',false,{ min:0,max:100,step:'0.1' })}{champ('date_visee','Date visée','date')}{f.etape==='perdue' && <Champ label="Motif de perte"><textarea required value={f.motif_perte || ''} onChange={e=>changer('motif_perte',e.target.value)} /></Champ>}</>}
    {['activites','comptes'].includes(ressource) && <Champ label="Notes"><textarea value={f.notes || ''} onChange={e=>changer('notes',e.target.value)} /></Champ>}
  </div><div className="crm-actions"><button disabled={busy}>Enregistrer</button><button type="button" disabled={busy} onClick={()=>fermer()}>Annuler</button></div></form>;
}
export function LienCompte({ id,nom,comptes=[],ouvrir }) { return <a href={`#crm/compte/${id}`} onClick={e=>{e.preventDefault();ouvrir(id);}}>{nom || comptes.find(c=>c.id===id)?.nom || 'Ouvrir la fiche compte'}</a>; }
