// Hors ligne : Blobs, PostgREST et Auth inventés ; aucune donnée persistée.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as XLSX from 'xlsx';
import { creerCacheCrm,DUREE_CACHE } from '../netlify/functions/_crm-cache.js';
import { creerBancCrm,creerBlobsMemoire } from './banc/crm-banc.mjs';
import { creerClient,creerMemoireCrm,chargerEcran,cacheEcran,prechargerEcran } from '../src/crm/client.js';
globalThis.fetch=()=>{throw new Error('Réseau interdit');};
let ok=0,ko=0;
async function test(nom,fn){try{await fn();ok++;}catch(e){ko++;console.error('✗',nom,e);}}
const date=new Date('2026-11-22T10:00:00Z');
const numero=magasin=>[...magasin.entrees].find(([k])=>k.endsWith('/generation'))?.[1].data.numero || 0;
async function requete(b,action,extra={},role='admin'){
  const r=await b.repondre({fn:'crm',corps:{action,...extra},entetes:{authorization:`Bearer crm-banc-${role}`}});
  assert.ok(r.statut<300,r.texte);return JSON.parse(r.texte);
}
await test('Blobs : TTL, périmètre, paramètres, concurrence et calcul traversant une écriture',async()=>{
  const magasin=creerBlobsMemoire();let temps=+date,calculs=0;
  const deps={url:'https://base-a.exemple.test',cacheMagasin:magasin,maintenant:()=>new Date(temps)},cache=creerCacheCrm(deps);
  const calculer=async()=>({numero:++calculs,marge:123});
  assert.equal((await cache.lire('tableau',{},calculer)).numero,1);
  assert.equal((await cache.lire('tableau',{},calculer)).numero,1);
  temps+=DUREE_CACHE-1;assert.equal((await cache.lire('tableau',{},calculer)).numero,1);
  temps++;assert.equal((await cache.lire('tableau',{},calculer)).numero,2);
  await cache.lire('alertes',{email:'commercial@exemple.test'},calculer);
  await cache.lire('alertes',{email:'autre@exemple.test'},calculer);assert.equal(calculs,4);
  await creerCacheCrm({...deps,url:'https://base-b.exemple.test'}).lire('tableau',{},calculer);assert.equal(calculs,5);
  await Promise.all(Array.from({length:8},()=>cache.invalider()));assert.equal(numero(magasin),8);
  assert.equal((await cache.lire('tableau',{},calculer)).numero,6);
  let finir;const attente=cache.lire('course',{},()=>new Promise(r=>{finir=r;}));
  while(!finir)await new Promise(r=>setTimeout(r,0));
  await cache.invalider();finir({numero:-1});await attente;
  assert.equal((await cache.lire('course',{},calculer)).numero,7);
});
await test('Blobs indisponible : calcul direct, aucune erreur publique',async()=>{
  const magasin=creerBlobsMemoire();magasin.etat.panne=true;
  const cache=creerCacheCrm({cacheMagasin:magasin});let n=0;
  assert.equal(await cache.lire('tableau',{},async()=>++n),1);
  assert.equal(await cache.lire('tableau',{},async()=>++n),2);
  await cache.invalider();
});
await test('API : entrée complète partagée, marge masquée à chaque réponse, tâches directes',async()=>{
  const b=await creerBancCrm({date});
  const admin=(await requete(b,'tableau.synthese')).donnees;
  assert.ok(Object.hasOwn(admin.global.dernier.donnees,'marge'));
  b.appels.length=0;
  for(const role of ['commercial','service','lecture']){
    const d=(await requete(b,'tableau.synthese',{},role)).donnees;
    assert.ok(!JSON.stringify(d).includes('"marge'));
  }
  assert.equal(b.appels.filter(a=>a.url.includes('/rest/')).length,0);
  await requete(b,'accueil.synthese',{},'commercial');b.appels.length=0;
  const a=b.tables.crm_activites.find(a=>a.type==='tache'&&a.assigne_email==='commercial@banc.test');
  Object.assign(a,{statut:'a_faire',echeance:'2026-11-21T10:00:00Z'});
  const accueil=(await requete(b,'accueil.synthese',{},'commercial')).donnees;
  assert.ok(accueil.taches.retard.lignes.some(l=>l.id===a.id));
  assert.equal(b.appels.filter(a=>a.url.includes('/crm_comptes_indicateurs')).length,0);
  const autre=(await requete(b,'accueil.synthese',{},'admin')).donnees;
  assert.ok(Object.values(autre.taches).every(g=>g.lignes.every(a=>a.assigne_email==='admin@banc.test')));
  b.cacheMagasin.etat.panne=true;
  assert.ok((await requete(b,'tableau.synthese')).donnees.pipeline);
});
await test('mutations CRM : génération incrémentée ; refus sans invalidation',async()=>{
  const b=await creerBancCrm({date}),c=b.tables.crm_comptes.find(c=>!c.odoo_id),a=b.tables.crm_activites[0];
  const changer=async(action,extra)=>{const avant=numero(b.cacheMagasin);const r=await requete(b,action,extra);assert.equal(numero(b.cacheMagasin),avant+1,action);return r;};
  const cree=(await changer('comptes.creer',{donnees:{nom:'Prospect fictif cache',statut:'prospect'}})).donnees;
  await changer('comptes.modifier',{id:cree.id,version:cree.version,donnees:{notes:'Note fictive'}});
  await changer('comptes.attribuer',{id:c.id,version:c.version,donnees:{commercial_email:'commercial@banc.test'}});
  await changer('comptes.archiver',{id:c.id,version:c.version,donnees:{archive:true}});
  await changer('activites.terminer',{id:a.id,version:a.version,donnees:{}});
  for(const r of ['contacts','opportunites']){
    const l=b.tables[`crm_${r}`][0];await changer(`${r}.modifier`,{id:l.id,version:l.version,donnees:r==='contacts'?{prenom:'Prénom fictif'}:{titre:'Projet fictif cache'}});
  }
  for(const r of ['equipe','reglages']){
    const l=b.tables[`crm_${r}`][0];await changer(`${r}.enregistrer`,{id:l.id,version:l.version,donnees:r==='equipe'?{nom_affiche:'Membre fictif cache'}:{objectif_mensuel_global:321}});
  }
  const avant=numero(b.cacheMagasin);
  const r=await b.repondre({fn:'crm',corps:{action:'comptes.creer',donnees:{nom:'Refus fictif'}},entetes:{authorization:'Bearer crm-banc-lecture'}});
  assert.equal(r.statut,403);assert.equal(numero(b.cacheMagasin),avant);
  await requete(b,'indicateurs.relancer');assert.equal(numero(b.cacheMagasin),avant+1);
  await requete(b,'annuaire.relancer');assert.equal(numero(b.cacheMagasin),avant+2);
  const rapprochement=b.tables.crm_rapprochements.find(r=>r.statut==='a_valider');
  assert.ok(rapprochement);
  await changer('rapprochements.rejeter',{id:rapprochement.id,version:rapprochement.version});
});
await test('sélections légères et trente cartes par étape, suites sans doublons et totaux exacts',async()=>{
  const b=await creerBancCrm({date,volume:'grand'});
  await requete(b,'tableau.synthese');await requete(b,'comptes.lister');
  const urls=b.appels.filter(a=>/crm_(indicateurs|comptes_indicateurs)\?/.test(a.url)).map(a=>new URL(a.url));
  assert.ok(urls.length>0);
  for(const u of urls){
    const select=u.searchParams.get('select').split(',');
    assert.ok(!select.includes('*')&&!select.includes('donnees')&&!select.includes('indicateurs'),u.href);
  }
  const d=(await requete(b,'opportunites.lister',{filtres:{vue_tableau:true}})).donnees;
  for(const col of d.colonnes){
    assert.equal(col.lignes.length,30);
    const suite=(await requete(b,'opportunites.lister',{filtres:{vue_tableau:true,etape:col.etape,page:2}})).donnees.colonnes[0];
    assert.equal(suite.nombre,col.nombre);assert.equal(suite.total,col.total);assert.equal(suite.pondere,col.pondere);
    assert.ok(suite.lignes.every(o=>!col.lignes.some(p=>p.id===o.id)));
    assert.ok(!Object.hasOwn(suite.lignes[0],'notes'));
  }
  console.log(`  Opportunités grand volume : ${Buffer.byteLength(JSON.stringify(d))} octets, ${d.colonnes.reduce((n,c)=>n+c.lignes.length,0)} cartes`);
});
await test('import Excel, validation et défaire : invalidation après chaque écriture réussie',async()=>{
  const b=await creerBancCrm({date}),classeur=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur,XLSX.utils.aoa_to_sheet([
    ['Pharmacie','CIP','Responsable','Date du contact','Statut','Commentaire'],
    ['Pharmacie fictive',b.tables.crm_comptes[0].cip,'Responsable fictif','','Contactée','Note fictive cache'],
  ]),'Pharmacies');
  const donnees={nom_fichier:'suivi-fictif-cache.xlsx',fichier:XLSX.write(classeur,{type:'buffer',bookType:'xlsx'}).toString('base64')};
  await requete(b,'import_suivi.apercu',{donnees});assert.equal(numero(b.cacheMagasin),0);
  await requete(b,'import_suivi.appliquer',{donnees});assert.equal(numero(b.cacheMagasin),1);
  await requete(b,'annuaire.relancer');assert.equal(numero(b.cacheMagasin),2);
  const r=b.tables.crm_rapprochements.find(r=>r.statut==='a_valider');assert.ok(r);
  const c=b.tables.crm_comptes.find(c=>c.id===r.compte_propose);
  await requete(b,'rapprochements.valider',{id:r.id,version:r.version,donnees:{version_compte:c.version}});
  assert.equal(numero(b.cacheMagasin),3);
  await requete(b,'rapprochements.defaire',{id:r.id,version:r.version,donnees:{version_compte:c.version}});
  assert.equal(numero(b.cacheMagasin),4);
});
await test('mémoire navigateur : instantané immédiat, rafraîchissement, invalidation et réponses retardées',async()=>{
  let temps=1000;const memoire=creerMemoireCrm(()=>temps),params={filtres:{}};
  const appel=Object.assign((action,p)=>memoire.actualiser(action,p,async()=>({donnees:{compteur:temps}})),{memoire});
  await chargerEcran(appel,'tableau');
  assert.deepEqual(cacheEcran(appel,'tableau'),{donnees:{compteur:1000},maj:1000});
  temps=2000;
  const refresh=chargerEcran(appel,'tableau');
  assert.equal(cacheEcran(appel,'tableau').donnees.compteur,1000);
  await refresh;assert.equal(cacheEcran(appel,'tableau').donnees.compteur,2000);
  memoire.identite('autre-utilisateur:lecture');assert.equal(cacheEcran(appel,'tableau'),null);
  let finir;
  const attente=memoire.actualiser('tableau.synthese',params,()=>new Promise(r=>{finir=r;}));
  await Promise.resolve();memoire.vider();finir({donnees:{marge:123}});
  await assert.rejects(attente);assert.equal(cacheEcran(appel,'tableau'),null);
});
await test('client : vidage aux écritures, connexion, déconnexion et changement de rôle ; préchargement',async()=>{
  const b=await creerBancCrm({date});
  const client=creerClient({session:null,enregistrer:()=>{},http:async(url,o)=>{
    const r=await b.repondre({fn:url.split('/').at(-1),corps:o.body,entetes:Object.fromEntries(Object.entries(o.headers).map(([k,v])=>[k.toLowerCase(),v]))});
    return new Response(r.texte,{status:r.statut});
  }});
  await client.connexion('admin@banc.test','fictif');await client.appel('moi');
  await prechargerEcran(client.appel,'Tableau de bord');assert.ok(client.memoire.lire('tableau.synthese',{filtres:{}}));
  await client.appel('comptes.creer',{donnees:{nom:'Compte fictif cache',statut:'prospect'}});
  assert.equal(client.memoire.lire('tableau.synthese',{filtres:{}}),null);
  await prechargerEcran(client.appel,'Accueil');client.deconnexion();assert.equal(client.memoire.lire('accueil.synthese',{filtres:{}}),null);
  await client.connexion('lecture@banc.test','fictif');await client.appel('moi');
  await prechargerEcran(client.appel,'Tableau de bord');
  assert.ok(!JSON.stringify(client.memoire.lire('tableau.synthese',{filtres:{}})).includes('"marge'));
  b.utilisateurs.lecture.app_metadata.role='commercial';await client.appel('moi');
  assert.equal(client.memoire.lire('tableau.synthese',{filtres:{}}),null);
});
await test('#crm : le site pharmacie ne monte pas, puis monte à la sortie du CRM',async()=>{
  const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const wrapper=source.slice(source.indexOf('export default function App()'),source.indexOf('function SitePharmacie()'));
  assert.ok(wrapper.length>0);
  const {code}=await transformWithEsbuild(wrapper.replace('export default ', '')+'\nglobalThis.executer=App;','app.jsx',{loader:'jsx'});
  let valeur,initial=true,montages=0;const evenements={};
  const window={location:{hash:'#crm'},addEventListener:(k,v)=>{evenements[k]=v;},removeEventListener:()=>{}};
  const SitePharmacie=()=>{montages++;return 'pharmacie';};
  const contexte={window,SitePharmacie,CrmApp:()=>null,ErrorBoundary:()=>null,
    useState:init=>{if(initial){valeur=init();initial=false;}return [valeur,v=>{valeur=v;}];},
    useEffect:fn=>fn(),React:{Suspense:()=>null,createElement:(type,props,...children)=>type===SitePharmacie?SitePharmacie():({type,props,children})}};
  vm.createContext(contexte);vm.runInContext(code,contexte);
  contexte.executer();assert.equal(montages,0);
  window.location.hash='#crm/contacts';evenements.hashchange();contexte.executer();assert.equal(montages,0);
  window.location.hash='';evenements.hashchange();contexte.executer();assert.equal(montages,1);
  window.location.hash='#crm';evenements.popstate();contexte.executer();assert.equal(montages,1);
});
console.log(`CRM cache : ${ok} ok, ${ko} ko`);process.exit(ko?1:0);
