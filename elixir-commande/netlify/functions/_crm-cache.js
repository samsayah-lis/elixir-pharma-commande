// Cache facultatif et privé : jamais une condition de succès d'une opération CRM.
import { createHash } from 'node:crypto';
import { connectLambda, getStore } from '@netlify/blobs';
export const DUREE_CACHE = 15 * 60 * 1000;
export function initialiserCacheCrm(event) {
  try { if (event.blobs) connectLambda(event); } catch { /* calcul direct si le contexte manque */ }
}
const empreinte = valeur => createHash('sha256').update(JSON.stringify(valeur)).digest('hex');
export function creerCacheCrm(deps = {}) {
  const maintenant = deps.maintenant || (() => new Date());
  const prefixe = empreinte(['crm-v2', deps.url ?? process.env.SUPABASE_URL ?? 'non-configure']);
  const generation = `${prefixe}/generation`;
  const magasin = () => deps.cacheMagasin === undefined ? getStore({ name:'crm-cache',consistency:'strong' }) : deps.cacheMagasin;
  async function limite(promesse) {
    let timer;
    try { return await Promise.race([promesse,new Promise((_,rejeter)=>{timer=setTimeout(()=>rejeter(new Error('Cache indisponible')),750);})]); }
    finally { clearTimeout(timer); }
  }
  async function lireGeneration(store) {
    const r = await limite(store.getWithMetadata(generation,{type:'json',consistency:'strong'}));
    if (r && (!Number.isSafeInteger(r.data?.numero) || r.data.numero<0)) throw new Error('Génération illisible');
    return r;
  }
  return {
    async invalider() {
      try {
        const store=magasin();
        for(let n=0;n<12;n++){
          const r=await lireGeneration(store);
          const e=await limite(store.setJSON(generation,{numero:(r?.data.numero || 0)+1},r?{onlyIfMatch:r.etag}:{onlyIfNew:true}));
          if(e.modified)return;
        }
      } catch { /* l'écriture métier reste réussie même si Blobs est indisponible */ }
    },
    async lire(action,params,calculer) {
      let store,g,cle;
      try {
        store=magasin();g=(await lireGeneration(store))?.data.numero || 0;
        cle=`${prefixe}/${g}/${empreinte([action,params])}`;
        const entree=await limite(store.get(cle,{type:'json',consistency:'strong'}));
        const age=maintenant().getTime()-entree?.date;
        if(entree && age>=0 && age<DUREE_CACHE && entree.generation===g)return entree.donnees;
      } catch { return calculer(); }
      const donnees=await calculer();
      try {
        // Une écriture survenue pendant le calcul rend ce résultat non réutilisable.
        if(((await lireGeneration(store))?.data.numero || 0)===g)
          await limite(store.setJSON(cle,{generation:g,date:maintenant().getTime(),donnees}));
      } catch { /* aucun message de cache dans la réponse publique */ }
      return donnees;
    },
  };
}
