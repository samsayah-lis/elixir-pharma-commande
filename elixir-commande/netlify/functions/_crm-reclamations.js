import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { odoo } from './_odoo-rpc.js';
import { erreurCrm } from './_crm-stock.js';
const texte=z.string().max(10000).nullable(),instant=z.string().datetime({offset:true}).nullable();
const commun={created_at:instant,urgence:texte,order_ref:texte,partner_id:z.number().int().positive().safe()};
const schema=z.object({
  reclamations:z.array(z.object({...commun,numero:z.union([z.string().max(200),z.number().safe()]).nullable(),type:texte,status:texte,product_name:texte,qty:z.number().finite().nullable(),souhait_pharmacie:texte,source:texte,closed_at:instant})).max(300),
  tickets:z.array(z.object({...commun,reference:texte,categorie:texte,objet:texte,statut:texte,canal:texte,cloture_at:instant})).max(300),
});
export function urlEntrepot(deps={}) {
  try {const u=new URL(deps.entrepotUrl ?? process.env.ENTREPOT_URL ?? '');if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash)return null;return u.href.replace(/\/$/,'');}catch{return null;}
}
export function creerReclamationsCrm(deps={}) {
  return async compte=>{
    const vide={reclamations:[],tickets:[]};
    if(!compte.odoo_id)return {etat:'sans_compte_client',...vide};
    const base=urlEntrepot(deps),secret=deps.reclamationsSecret ?? process.env.CRM_RECLAMATIONS_SECRET;
    if(!base || typeof secret!=='string' || secret.length<32)return {etat:'non_configure',...vide};
    let ids;
    try {
      if(!Number.isSafeInteger(compte.odoo_id) || compte.odoo_id<=0)throw new Error();
      // inclut les contacts archivés : leurs anciennes réclamations restent pertinentes.
      const rows=await (deps.odoo || odoo)('res.partner','search_read',[[['commercial_partner_id','=',compte.odoo_id],['id','!=',compte.odoo_id],'|',['company_id','=',false],['company_id','=',2]]],
        {fields:['id'],order:'id asc',limit:49,context:{allowed_company_ids:[2],active_test:false}},{timeoutMs:6000});
      if(!Array.isArray(rows) || rows.length>49 || rows.some(r=>!Number.isSafeInteger(r.id) || r.id<=0))throw new Error();
      ids=[...new Set([compte.odoo_id,...rows.map(r=>r.id)])];
    }catch{throw erreurCrm(503,'Réclamations indisponibles : impossible de lire les fiches liées dans Odoo.');}
    const corps=JSON.stringify({partner_ids:ids}),horodatage=String(Math.floor(new Date((deps.maintenant || (()=>new Date()))()).getTime()/1000));
    const signature='sha256='+createHmac('sha256',secret).update(`${horodatage}.${corps}`).digest('hex');
    const controleur=new AbortController();let minuterie;
    try {
      const attente=new Promise((_,rejeter)=>{minuterie=setTimeout(()=>{controleur.abort();rejeter(new Error());},6000);});
      const lecture=(async()=>{
        const r=await (deps.fetch || fetch)(`${base}/.netlify/functions/crm-reclamations`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Elixir-Horodatage':horodatage,'X-Elixir-Signature':signature},body:corps,signal:controleur.signal});
        if(!r.ok)throw new Error();
        const d=schema.parse(await r.json());
        if([...d.reclamations,...d.tickets].some(r=>!ids.includes(r.partner_id)))throw new Error();
        return {etat:'disponible',...d};
      })();
      return await Promise.race([lecture,attente]);
    }catch{throw erreurCrm(503,'Réclamations momentanément indisponibles : l’outil entrepôt ne répond pas correctement. Réessayez.');}
    finally{clearTimeout(minuterie);}
  };
}
