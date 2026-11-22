import { creerCacheCrm, initialiserCacheCrm } from "./_crm-cache.js";
// Aucune lecture au chargement du module. Entrées externes exclusivement publiques, en flux.
import { isCronAuthorized } from './auth.js';
import { creerStockCrm, erreurCrm } from './_crm-stock.js';
import { creerStockAnnuaire } from './_crm-annuaire-stock.js';
import { TERRITOIRE_ANNUAIRE,lireLigneAnnuaire,verifierEntete,regrouperSites,planifierRapprochements } from './_crm-annuaire.js';
export const JEU_ANNUAIRE='https://www.data.gouv.fr/api/1/datasets/annuaire-sante-extractions-des-donnees-en-libre-acces-des-professionnels-intervenant-dans-le-systeme-de-sante-rpps/';
export const BUDGET_ANNUAIRE=14*60*1000;
export async function lancerAnnuaire(deps={}) {
  const base=(deps.siteUrl ?? process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? '').replace(/\/$/,''),secret=deps.cronSecret ?? process.env.CRON_SECRET;
  if(!secret || !/^https:\/\//.test(base))throw erreurCrm(503,'Déclenchement annuaire non configuré.');
  try {const r=await (deps.fetch || fetch)(`${base}/.netlify/functions/crm-annuaire-background`,{method:'POST',headers:{'Content-Type':'application/json','x-cron-secret':secret},body:'{}',signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error();return {lance:true};}
  catch {throw erreurCrm(503,'Déclenchement annuaire indisponible.');}
}
export function creerHandlerAnnuaire(deps={}) {
  const http=deps.fetch || fetch,horloge=deps.horloge || (()=>Date.now()),stock=deps.annuaireStock || creerStockAnnuaire(deps),crm=deps.stock || creerStockCrm(deps);
  return async event=>{
    initialiserCacheCrm(event);
    const rep=(statusCode,d)=>({statusCode,headers:{'Cache-Control':'no-store'},body:JSON.stringify(d)});
    if(event.httpMethod!=='POST')return rep(405,{error:'Méthode POST requise.'});
    if(!(deps.autoriser || isCronAuthorized)(event))return rep(403,{error:'Accès refusé.'});
    const debut=horloge(),resteTemps=()=>BUDGET_ANNUAIRE-(horloge()-debut),pause=()=>Object.assign(new Error('pause'),{pause:true});
    const verifier=()=>{if(resteTemps()<15000)throw pause();};
    let etat;
    try {
      const reglage=(await crm.lister('reglages',{limite:1})).lignes[0],territoire=[...new Set(reglage?.territoire_indicateurs ?? TERRITOIRE_ANNUAIRE)].sort();
      verifier();etat=await stock.commencer(territoire);
      if(!etat)return rep(200,{occupe:true});
      if(etat.phase==='collecte') {
        verifier();const meta=await http(JEU_ANNUAIRE,{signal:AbortSignal.timeout(Math.max(1,Math.min(30000,resteTemps()-15000)))});
        if(!meta.ok)throw new Error();const jeu=await meta.json(),ressource=(jeu.resources || []).find(r=>/personne-activite/i.test(r.title || ''));
        if(!ressource?.url || !/^https:\/\//.test(ressource.url))throw new Error();
        const extraction=(ressource.last_modified || ressource.created_at || '').slice(0,10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(extraction))throw new Error();
        if(etat.source_url!==ressource.url || etat.date_extraction!==extraction)etat=await stock.checkpoint(etat.passage,{reset:true,source_url:ressource.url,date_extraction:extraction,octets:0,reste:'',entete:true,etag:null,phase:'collecte',compteurs:{lues:0,gardees:0}});
        verifier();const reprendre=etat.octets && etat.etag && !etat.etag.startsWith('W/');
        let reponse=await http(ressource.url,{headers:{'Accept-Encoding':'identity',...(reprendre?{Range:`bytes=${etat.octets}-`,...(etat.etag?{'If-Range':etat.etag}:{})}:{})},signal:AbortSignal.timeout(Math.max(1,resteTemps()-15000))});
        if(reprendre && reponse.status===416 && reponse.headers.get('content-range')===`bytes */${etat.octets}` && reponse.headers.get('etag')===etat.etag)
          reponse=new Response(new Uint8Array(),{status:206,headers:{'content-range':`bytes ${etat.octets}-${etat.octets-1}/${etat.octets}`,etag:etat.etag}});
        if(!reponse.ok || !reponse.body || !['identity',''].includes(reponse.headers.get('content-encoding') || ''))throw new Error();
        // Un serveur ignorant Range ou un ETag modifié impose une collecte neuve :
        // jamais de mélange de deux extractions, ni de nettoyage sur un fichier partiel.
        if(etat.octets && reponse.status===200)etat=await stock.checkpoint(etat.passage,{reset:true,source_url:ressource.url,date_extraction:extraction,octets:0,reste:'',entete:true,etag:null,compteurs:{lues:0,gardees:0}});
        if(etat.octets && (reponse.status!==206 || !reponse.headers.get('content-range')?.startsWith(`bytes ${etat.octets}-`)))throw new Error();
        const plage=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(reponse.headers.get('content-range') || '');
        if(reponse.status===206 && (!plage || Number(plage[1])!==etat.octets || Number(plage[2])+1!==Number(plage[3])))throw new Error();
        const tailleAttendue=plage?Number(plage[3]):reponse.headers.has('content-length')?etat.octets+Number(reponse.headers.get('content-length')):null;
        const etag=reponse.headers.get('etag');
        if(etat.octets && etat.etag && etag!==etat.etag)throw new Error();
        let octets=etat.octets,tampon=Buffer.from(etat.reste || '','base64'),entete=etat.entete,lues=etat.compteurs.lues || 0,gardees=etat.compteurs.gardees || 0,lot=[],dernier=octets;
        const decoder=new TextDecoder('utf-8',{fatal:true});
        const traiter=bytes=>{const ligne=decoder.decode(bytes).replace(/\r$/,'');if(entete){verifierEntete(ligne);entete=false;return;}if(!ligne.trim())return;lues++;const l=lireLigneAnnuaire(ligne,territoire);if(l){lot.push(l);gardees++;}};
        const sauver=async phase=>{etat=await stock.checkpoint(etat.passage,{source_url:ressource.url,date_extraction:extraction,etag,octets,reste:tampon.toString('base64'),entete,phase,compteurs:{lues,gardees}},lot);lot=[];dernier=octets;};
        const lecteur=reponse.body.getReader();
        try {
          for(;;){verifier();const {value,done}=await lecteur.read();if(done)break;octets+=value.byteLength;tampon=Buffer.concat([tampon,Buffer.from(value)]);let position=0,index;
            while((index=tampon.indexOf(10,position))!==-1){traiter(tampon.subarray(position,index));position=index+1;}
            tampon=Buffer.from(tampon.subarray(position));if(tampon.length>1024*1024)throw new Error();
            if(octets-dernier>=4*1024*1024 || lot.length>=500) {verifier();await sauver('collecte');}
          }
          if(tampon.length){traiter(tampon);tampon=Buffer.alloc(0);}
          if(entete || !lues || tailleAttendue!==null && octets!==tailleAttendue)throw new Error();verifier();await sauver('ecriture');
        } finally {await lecteur.cancel().catch(()=>{});}
      }
      verifier();const tampon=await stock.tampon(etat.passage),sites=regrouperSites(Object.values(tampon).flatMap(g=>Object.values(g)));
      if(!sites.length && etat.territoire.length)throw new Error();
      if(etat.phase==='ecriture') {
        verifier();let plan=await stock.plan(etat.passage);
        if(!plan){plan=planifierRapprochements(sites,await stock.tous('comptes'),await stock.tous('rapprochements'));etat=await stock.checkpoint(etat.passage,{plan});}
        for(let i=0;i<plan.length;i+=10){verifier();const lot=plan.slice(i,i+10).filter(p=>p.site.cle>etat.curseur);if(lot.length)etat=await stock.lot(etat.passage,lot);}
        verifier();etat=await stock.checkpoint(etat.passage,{phase:'fin'});
      }
      verifier();await stock.finir(etat.passage,sites);return rep(200,{termine:true});
    } catch(e) {
      const interrompu=e.pause || resteTemps()<15000;
      if(etat?.passage)try{await stock.arreter(etat.passage,interrompu?'pause':'erreur');}catch{/* Le bail expirera si la base n'est plus joignable. */}
      return rep(interrompu?200:503,interrompu?{pause:true}:{error:'Import annuaire interrompu. Consultez son état puis relancez pour reprendre.'});
    } finally { if(etat?.passage)await creerCacheCrm(deps).invalider(); }
  };
}
export const handler=creerHandlerAnnuaire();
