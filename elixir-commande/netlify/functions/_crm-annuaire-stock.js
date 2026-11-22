import { erreurCrm } from './_crm-stock.js';
const PUBLIC_ETAT='id,date_extraction,debut,fin,statut,phase,compteurs,updated_at';
export function creerStockAnnuaire(deps={}) {
  const http=deps.fetch || fetch,url=deps.url ?? process.env.SUPABASE_URL,cle=deps.cle ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  async function requete(chemin,{params={},body,u,action='annuaire.importer'}={}) {
    if(!url || !cle)throw erreurCrm(503,'Base annuaire indisponible.');
    let res,d;
    try { res=await http(`${url}/rest/v1/${chemin}?${new URLSearchParams(params)}`,{method:body===undefined?'GET':'POST',
      headers:{apikey:cle,Authorization:`Bearer ${cle}`,'Content-Type':'application/json',Prefer:'return=representation,count=exact',
        'x-crm-acteur':u?.id || '00000000-0000-4000-8000-000000000000','x-crm-email':u?.email || '', 'x-crm-action':action},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});d=await res.json(); }
    catch {throw erreurCrm(503,'Base annuaire indisponible.');}
    if(!res.ok && d?.code==='PCRM1')throw erreurCrm(409,'Ce contact possède un historique sur un autre compte. Le rapprochement nécessite une reprise de cet historique.');
    if(!res.ok)throw erreurCrm(['40001','23505'].includes(d?.code)?409:503,'Opération annuaire interrompue. Actualisez les données avant de réessayer.');
    return {d,total:Number(res.headers.get('content-range')?.split('/')[1])};
  }
  const rpc=async(n,body,u,action)=>(await requete(`rpc/crm_annuaire_${n}`,{body,u,action})).d;
  async function tous(table) {
    if(!['comptes','rapprochements'].includes(table))throw erreurCrm(400,'Table annuaire invalide.');
    const out=[];for(let offset=0;;offset+=1000){const {d}=await requete(`crm_${table}`,{params:{select:'*',order:'id.asc',offset,limit:1000}});if(!Array.isArray(d))throw erreurCrm(503,'Base annuaire indisponible.');out.push(...d);if(d.length<1000)return out;}
  }
  return {
    commencer:territoire=>rpc('commencer',{p_territoire:territoire}),
    checkpoint:(passage,meta,lot=[])=>rpc('checkpoint',{p_passage:passage,p_meta:meta,p_lot:lot}),
    lot:(passage,lot)=>rpc('lot',{p_passage:passage,p_lot:lot}),
    finir:(passage,sites)=>rpc('fin',{p_passage:passage,p_sites:sites}),
    arreter:(passage,statut)=>rpc('arreter',{p_passage:passage,p_statut:statut}),
    plan:async passage=>(await requete('crm_annuaire_etat',{params:{passage:`eq.${passage}`,select:'plan',limit:1}})).d[0]?.plan || null,
    tampon:async passage=>{const {d}=await requete('crm_annuaire_etat',{params:{passage:`eq.${passage}`,select:'sites',limit:1}});if(!d[0])throw erreurCrm(409,'Passage annuaire expiré.');return d[0].sites;},
    etat:async()=> (await requete('crm_annuaire_etat',{params:{select:PUBLIC_ETAT,limit:1}})).d[0] || null,
    tous,
    async rapprochements(filtres={}) {
      const {page=1,limite=25,statut='a_valider'}=filtres;
      const {d,total}=await requete('crm_rapprochements',{params:{select:'*',statut:`eq.${statut}`,...(filtres.automatique?{auteur:'eq.automatique'}:{}),order:'created_at.asc,id.asc',offset:(page-1)*limite,limit:limite}});
      const ids=[...new Set(d.map(r=>r.compte_propose))];
      const comptes=ids.length?(await requete('crm_comptes',{params:{select:'*',id:`in.(${ids.join(',')})`}})).d:[];
      return {lignes:d.map(r=>({...r,compte:comptes.find(c=>c.id===r.compte_propose)||null})),page,limite,total:Number.isFinite(total)?total:d.length};
    },
    decider:(id,version,action,versionCompte,u)=>rpc('decider',{p_id:id,p_version:version,p_action:action,p_version_compte:versionCompte ?? null},u,`rapprochements.${action}`),
  };
}
