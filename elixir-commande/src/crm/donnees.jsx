import { useEffect, useState } from 'react';
import { lireToutes,chargerEcran,cacheEcran } from './client';
export function useDonnees(appel, ressources, revision = 0, actions = []) {
  const cle=JSON.stringify({ ressources,actions });
  const cache=()=>{
    const donnees={},dates=[];
    for(const r of ressources){
      const lignes=[];
      for(let page=1;;page++){
        const e=appel.memoire?.lire(`${r}.lister`,{filtres:{tri:'created_at',sens:'asc',page,limite:100}});
        if(!e)return null;
        dates.push(e.date);lignes.push(...e.valeur.donnees.lignes);
        if(page*100>=e.valeur.donnees.total)break;
      }
      donnees[r]=lignes;
    }
    for(const a of actions){const e=appel.memoire?.lire(a,{});if(!e)return null;dates.push(e.date);donnees[a]=e.valeur.donnees;}
    return {donnees,maj:Math.min(...dates)};
  };
  const [etat,setEtat]=useState(()=>cache() || {chargement:true});
  useEffect(() => {
    let actif=true; const precedent=cache(); setEtat(e=>({...e,...precedent,chargement:!precedent && !e.donnees,rafraichissement:true}));
    const { ressources,actions }=JSON.parse(cle);
    Promise.all([
      ...ressources.map(async r => [r,await lireToutes(appel,r,{},() => actif)]),
      ...actions.map(async a => [a,(await appel(a)).donnees]),
    ]).then(resultats => { if(actif)setEtat({ donnees:Object.fromEntries(resultats),maj:Date.now() }); },e => { if(actif)setEtat({ erreur:e.message }); });
    return () => { actif=false; };
  },[appel,cle,revision]); // eslint-disable-line react-hooks/exhaustive-deps -- ressources et actions sont représentées par cle
  return etat;
}
export function useEcran(appel, ecran, revision = 0, filtres = {}) {
  const cle=JSON.stringify(filtres),[etat,setEtat]=useState(()=>cacheEcran(appel,ecran,filtres) || {chargement:true});
  useEffect(() => {
    let actif=true;
    setEtat(e=>{const c=cacheEcran(appel,ecran,JSON.parse(cle));return {...(c || e),chargement:!c && !e.donnees,rafraichissement:true,erreur:null};});
    const timer=setTimeout(() => {
      chargerEcran(appel,ecran,JSON.parse(cle)).then(donnees=>{
        if(actif)setEtat({donnees,maj:Date.now()});
      },e=>{if(actif)setEtat(v=>({...v,chargement:false,erreur:e.message}));});
    },150);
    return () => {actif=false;clearTimeout(timer);};
  },[appel,ecran,cle,revision]);
  return etat;
}
export function useEcriture(appel) {
  const [revision,setRevision]=useState(0), [message,setMessage]=useState(''), [busy,setBusy]=useState(false), [conflit,setConflit]=useState(0);
  async function enregistrer(action,donnees,ligne) {
    setBusy(true);setMessage('');appel.memoire?.vider();
    try { const r=await appel(action,{ donnees,...(ligne ? { id:ligne.id,version:ligne.version } : {}) });setMessage('Enregistré.');setRevision(v=>v+1);return r.donnees || true; }
    catch(e) { setMessage(e.message);if(e.status===409){setRevision(v=>v+1);setConflit(v=>v+1);}return null; }
    finally { setBusy(false); }
  }
  return { revision,message,busy,conflit,enregistrer,recharger:()=>setRevision(v=>v+1) };
}
