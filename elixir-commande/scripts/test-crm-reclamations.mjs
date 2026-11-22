// Exemple (depuis elixir-commande) : CRM_REFERENCE_ENTREPOT="/chemin/vers/outil-entrepot" node scripts/test-crm-reclamations.mjs
// Contrat externe lu/importé seulement ici. Aucun appel réseau, données inventées.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { creerReclamationsCrm,urlEntrepot } from '../netlify/functions/_crm-reclamations.js';
import { nombreOuvertes } from '../src/crm/logique.js';
import { creerBancCrm } from './banc/crm-banc.mjs';
globalThis.fetch=()=>{throw new Error('Réseau interdit');};
const reference=process.env.CRM_REFERENCE_ENTREPOT;
const disponible=reference && statSync(reference,{throwIfNoEntry:false})?.isDirectory();
if(!disponible) console.log(`signature de référence non vérifiée : CRM_REFERENCE_ENTREPOT ${reference?'dossier introuvable':'absent'}`);
const contrat=disponible?(await import(pathToFileURL(resolve(reference,'netlify/functions/lib/chatbot-intake.js')).href)).default:null;
let ok=0,ko=0;
async function test(nom,fn){try{await fn();ok++;}catch(e){ko++;console.error('✗',nom,e);}}
const secret='secret-invente-pour-le-test-du-contrat-uniquement',date=new Date('2026-11-22T10:00:00Z');
const r={numero:'EN-601-FICTIF-01',created_at:date.toISOString(),type:'produit_manquant',status:'ouverte',product_name:'Produit fictif',qty:2,souhait_pharmacie:'renvoi',urgence:'normale',order_ref:'COMMANDE-FICTIVE',source:'chatbot',partner_id:11,closed_at:null};
const t={reference:'TK-FICTIF-01',created_at:date.toISOString(),categorie:'livraison',objet:'Demande fictive',statut:'ouvert',canal:'chatbot',urgence:'normale',order_ref:null,partner_id:12,cloture_at:null};
const deps={entrepotUrl:'https://entrepot.exemple.test',reclamationsSecret:secret,maintenant:()=>date,odoo:async()=>[{id:12}],fetch:async()=>new Response(JSON.stringify({reclamations:[r],tickets:[t]}))};
await test('Signature identique au signer de l’entrepôt, corps brut et en-têtes',async()=>{
  const lire=creerReclamationsCrm({...deps,fetch:async(url,o)=>{
    assert.equal(url,'https://entrepot.exemple.test/.netlify/functions/crm-reclamations');assert.equal(o.method,'POST');const h=new Headers(o.headers);
    if(contrat) assert.equal(h.get('X-Elixir-Signature'),contrat.signer(secret,h.get('X-Elixir-Horodatage'),Buffer.from(o.body)));
    assert.equal(h.get('X-Elixir-Horodatage'),String(date.getTime()/1000));assert.equal(h.has('Origin'),false);assert.equal(h.get('Content-Type'),'application/json');assert.deepEqual(JSON.parse(o.body),{partner_ids:[11,12]});assert.equal(o.redirect,'error');return deps.fetch();
  }});assert.equal((await lire({odoo_id:11})).etat,'disponible');
});
await test('Odoo : société 2, enfants commerciaux y compris archivés, 50 identifiants maximum',async()=>{
  await creerReclamationsCrm({...deps,odoo:async(model,methode,args,kw,opts)=>{
    assert.equal(model,'res.partner');assert.equal(methode,'search_read');assert.ok(args[0].some(x=>x[0]==='commercial_partner_id' && x[2]===11));assert.ok(args[0].some(x=>x[0]==='company_id' && x[2]===2));assert.equal(kw.limit,49);assert.equal(kw.context.active_test,false);assert.deepEqual(kw.context.allowed_company_ids,[2]);assert.equal(opts.timeoutMs,6000);return Array.from({length:49},(_,i)=>({id:12+i}));
  },fetch:async(url,o)=>{assert.equal(JSON.parse(o.body).partner_ids.length,50);return deps.fetch();}})({odoo_id:11});
});
await test('Projection : aucun champ hors contrat, doublons Odoo dédupliqués',async()=>{
  const d=await creerReclamationsCrm({...deps,odoo:async()=>[{id:11},{id:12},{id:12}],fetch:async(url,o)=>{assert.deepEqual(JSON.parse(o.body).partner_ids,[11,12]);return new Response(JSON.stringify({secret:'ne pas transmettre',reclamations:[{...r,commentaire:'privé fictif',email:'contact@exemple.test',photo:'photo-fictive'}],tickets:[{...t,conversation:[]}]}));}})({odoo_id:11});
  assert.deepEqual(d,{etat:'disponible',reclamations:[r],tickets:[t]});
});
for(const contenu of [{}, {reclamations:{},tickets:[]},{reclamations:[{...r,qty:'deux'}],tickets:[]},{reclamations:[{...r,partner_id:999}],tickets:[]},{reclamations:[{...r,created_at:'invalide'}],tickets:[]},{reclamations:Array(301).fill(r),tickets:[]}])await test('Réponse malformée ou hors périmètre refusée',async()=>{
  await assert.rejects(creerReclamationsCrm({...deps,fetch:async()=>new Response(JSON.stringify(contenu))})({odoo_id:11}),e=>e.status===503 && !e.message.includes('999'));
});
await test('HTTP en erreur et page HTML : message neutre',async()=>{for(const response of [()=>new Response('erreur privée',{status:500}),()=>new Response('<html>outil</html>')])await assert.rejects(creerReclamationsCrm({...deps,fetch:async()=>response()})({odoo_id:11}),e=>e.status===503 && !e.message.includes('privée'));});
await test('Délai de six secondes, même si le faux fetch ignore AbortSignal',async()=>{
  let signal;const debut=Date.now();await assert.rejects(creerReclamationsCrm({...deps,fetch:async(url,o)=>{signal=o.signal;return new Promise(()=>{});}})({odoo_id:11}),e=>e.status===503);
  assert.ok(signal.aborted);assert.ok(Date.now()-debut>=5900 && Date.now()-debut<8000);
});
await test('Configuration absente ou invalide : pas d’appel Odoo ni entrepôt',async()=>{
  for(const d of [{entrepotUrl:''},{reclamationsSecret:''},{reclamationsSecret:'trop-court'},{entrepotUrl:'javascript:alert(1)'},{entrepotUrl:'https://identifiant:secret@exemple.test'}]){
    const lire=creerReclamationsCrm({...deps,...d,odoo:()=>assert.fail('Odoo interdit'),fetch:()=>assert.fail('Entrepôt interdit')});assert.deepEqual(await lire({odoo_id:11}),{etat:'non_configure',reclamations:[],tickets:[]});
  }assert.equal(urlEntrepot({entrepotUrl:''}),null);
});
await test('Prospect : listes vides sans accès externe',async()=>{assert.deepEqual(await creerReclamationsCrm({...deps,odoo:()=>assert.fail(),fetch:()=>assert.fail()})({odoo_id:null}),{etat:'sans_compte_client',reclamations:[],tickets:[]});});
await test('Odoo indisponible ou identifiant invalide : aucun appel signé',async()=>{for(const odoo of [async()=>{throw new Error('privé');},async()=>[{id:'12'}],async()=>Array(50).fill({id:12})])await assert.rejects(creerReclamationsCrm({...deps,odoo,fetch:()=>assert.fail()})({odoo_id:11}),e=>e.status===503);});
const b=await creerBancCrm({date});
async function appel(role,action,params={}){const r=await b.repondre({fn:'crm',entetes:role?{authorization:`Bearer crm-banc-${role}`}:{},corps:{action,...params}});return {status:r.statut,...JSON.parse(r.texte)};}
for(const role of ['admin','commercial','service','lecture'])await test(`API et banc : ${role}, client rempli, prospect vide, lien sans secret`,async()=>{
  const client=b.tables.crm_comptes.find(c=>c.odoo_id),prospect=b.tables.crm_comptes.find(c=>!c.odoo_id);
  const d=await appel(role,'comptes.reclamations',{id:client.id});assert.equal(d.status,200);assert.equal(d.donnees.reclamations.length,2);assert.equal(d.donnees.tickets.length,1);
  assert.equal((await appel(role,'comptes.reclamations',{id:prospect.id})).donnees.reclamations.length,0);
  const moi=await appel(role,'moi');assert.equal(moi.entrepot_url,b.deps.entrepotUrl);assert.equal(JSON.stringify(moi).includes(b.deps.reclamationsSecret),false);
});
await test('Accès anonyme refusé et pharmacie sans rôle refusée',async()=>{assert.equal((await appel(null,'comptes.reclamations',{id:b.tables.crm_comptes[0].id})).status,401);assert.equal((await appel('nouveau','comptes.reclamations',{id:b.tables.crm_comptes[0].id})).status,403);});
await test('Compte introuvable et identifiant mal formé',async()=>{assert.equal((await appel('admin','comptes.reclamations',{id:'00000000-0000-4000-8000-999999999999'})).status,404);assert.equal((await appel('admin','comptes.reclamations',{id:'incorrect'})).status,400);});
await test('Pastille : dates de clôture, états terminaux, statut absent et liste vide',()=>{
  assert.equal(nombreOuvertes([]),0);
  assert.equal(nombreOuvertes([{status:'ouverte',closed_at:null},{status:'Clôturée',closed_at:null},{status:'en_cours',closed_at:date.toISOString()},{status:'annulee'},{status:null}]),2);
});
console.log(`CRM réclamations : ${ok} ok, ${ko} ko`);process.exit(ko?1:0);
