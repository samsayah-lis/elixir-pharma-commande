import { useEffect, useState } from 'react';
import { lireToutes } from './client';
export function useDonnees(appel, ressources, revision = 0, actions = []) {
  const cle=JSON.stringify({ ressources,actions }), [etat,setEtat]=useState({ chargement:true });
  useEffect(() => {
    let actif=true; setEtat({ chargement:true });
    const { ressources,actions }=JSON.parse(cle);
    Promise.all([
      ...ressources.map(async r => [r,r === 'comptes' ? [...await lireToutes(appel,r,{},() => actif), ...await lireToutes(appel,r,{ archive:true },() => actif)] : await lireToutes(appel,r,{},() => actif)]),
      ...actions.map(async a => [a,(await appel(a)).donnees]),
    ]).then(resultats => { if(actif)setEtat({ donnees:Object.fromEntries(resultats) }); },e => { if(actif)setEtat({ erreur:e.message }); });
    return () => { actif=false; };
  },[appel,cle,revision]);
  return etat;
}
export function useEcriture(appel) {
  const [revision,setRevision]=useState(0), [message,setMessage]=useState(''), [busy,setBusy]=useState(false), [conflit,setConflit]=useState(0);
  async function enregistrer(action,donnees,ligne) {
    setBusy(true);setMessage('');
    try { const r=await appel(action,{ donnees,...(ligne ? { id:ligne.id,version:ligne.version } : {}) });setMessage('Enregistré.');setRevision(v=>v+1);return r.donnees || true; }
    catch(e) { setMessage(e.message);if(e.status===409){setRevision(v=>v+1);setConflit(v=>v+1);}return null; }
    finally { setBusy(false); }
  }
  return { revision,message,busy,conflit,enregistrer,recharger:()=>setRevision(v=>v+1) };
}
