// Tests hors ligne du client utilisé par les écrans, contre les vraies fonctions du banc.
import assert from 'node:assert/strict';
import { jourParis,semaine,mesEcheances,estEnRetard,alertesComptes,pipeline,repartition,activiteEquipe,agenda,contactsFiltres } from '../src/crm/logique.js';
import { creerBancCrm } from './banc/crm-banc.mjs';
import { creerClient, peutAfficher, csvPage, lireToutes, chargerEcran } from '../src/crm/client.js';
globalThis.fetch = () => { throw new Error('Réseau interdit'); };
let ok = 0, ko = 0;
async function test(nom, fn) { try { await fn(); ok++; } catch (e) { ko++; console.error('✗',nom,e); } }
const banc = await creerBancCrm();
const http = async (url, opts = {}) => {
  const r = await banc.repondre({ fn:url.split('/').at(-1),methode:opts.method,corps:opts.body,entetes:Object.fromEntries(Object.entries(opts.headers || {}).map(([k,v]) => [k.toLowerCase(),v])) });
  assert.ok(r,'Route simulée'); return new Response(r.texte,{ status:r.statut,headers:r.entetes });
};
for (const nom of ['admin','commercial','service','lecture']) await test(`banc ${nom} : connexion, liste, fiche, marge, saisie selon droits`, async () => {
  let session;
  const client = creerClient({ http,session:null,enregistrer:s => { session=s; } });
  await client.connexion(`${nom}@banc.test`,'mot-de-passe-inventé'); assert.ok(session.token);
  const moi = await client.appel('moi'), u = moi.utilisateur;
  assert.equal(u.role,nom === 'service' ? 'service_client' : nom);
  const comptes = (await client.appel('comptes.lister',{ filtres:{ tri:'nom',sens:'asc',limite:20 } })).donnees;
  assert.equal(comptes.total,60); assert.equal(comptes.lignes.length,20);
  const id = comptes.lignes[0].id;
  const compte = (await client.appel('comptes.lire',{ id })).donnees; assert.equal(compte.nom,'Pharmacie fictive 01');
  const i = (await client.appel('indicateurs.compte',{ id })).donnees;
  assert.equal(i.historique.length,5); assert.equal(i.dernier.donnees.ca_mois.length,13);
  assert.equal(JSON.stringify(i).includes('"marge"'),nom === 'admin');
  assert.equal(peutAfficher(moi.droits,u,'marge','lire'),nom === 'admin');
  const action = () => client.appel('activites.creer',{ donnees:{ compte_id:id,type:'note',titre:`Note fictive ${nom}` } });
  if (nom === 'lecture') { assert.equal(peutAfficher(moi.droits,u,'activites','creer'),false); await assert.rejects(action,e => e.status === 403); }
  else {
    const a = (await action()).donnees; assert.equal(a.auteur_email,u.email);
    assert.equal(peutAfficher(moi.droits,u,'activites','terminer',a),true);
    const fin = (await client.appel('activites.terminer',{ id:a.id,version:a.version })).donnees; assert.equal(fin.statut,'fait');
    await assert.rejects(() => client.appel('activites.modifier',{ id:a.id,version:a.version,donnees:{ titre:'Version périmée' } }),e => e.status === 409 && e.message.includes('rechargées'));
    assert.ok(banc.tables.crm_journal.some(j => j.objet_id === a.id));
  }
  assert.equal((await client.appel('comptes.commandes',{ id })).donnees.length,1);
  assert.equal((await client.appel('comptes.factures',{ id })).donnees[1].montant_ht,-12);
  client.deconnexion(); assert.equal(session,null);
});
await test('banc : écritures contact, opportunité, notes Odoo ; filtres et tri', async () => {
  const client = creerClient({ http,session:null,enregistrer:() => {} }); await client.connexion('commercial@banc.test','inventé');
  const c = banc.tables.crm_comptes[0];
  const contact = (await client.appel('contacts.creer',{ donnees:{ compte_id:c.id,nom:'Contact fictif ajouté',email:'contact-ajoute@exemple.test' } })).donnees;
  assert.equal((await client.appel('contacts.modifier',{ id:contact.id,version:contact.version,donnees:{ principal:true } })).donnees.principal,true);
  const o = (await client.appel('opportunites.creer',{ donnees:{ compte_id:c.id,titre:'Projet fictif ajouté' } })).donnees;
  assert.equal((await client.appel('opportunites.modifier',{ id:o.id,version:o.version,donnees:{ etape:'proposition' } })).donnees.etape,'proposition');
  assert.equal((await client.appel('comptes.modifier',{ id:c.id,version:c.version,donnees:{ notes:'Note CRM fictive modifiée',etiquettes:['Fictif','Essai'] } })).donnees.notes,'Note CRM fictive modifiée');
  await assert.rejects(() => client.appel('comptes.modifier',{ id:c.id,version:c.version,donnees:{ nom:'Interdit' } }),e => e.status === 403);
  const d = (await client.appel('comptes.lister',{ filtres:{ recherche:'fictive',departement:'75',commercial_email:'commercial@banc.test',tri:'ca',sens:'desc',limite:5 } })).donnees;
  assert.equal(d.lignes.length,5); assert.ok(d.lignes.every((r,j) => r.departement === '75' && (!j || d.lignes[j-1].ca >= r.ca)));
});
await test('renouvellement concurrent unique et nouvelle tentative', async () => {
  let n = 0, session;
  const client = creerClient({ session:{ token:'expire',refresh_token:'crm-refresh-commercial' },enregistrer:s => { session=s; },http:async (url,opts) => { if(url.endsWith('admin-refresh')) n++; return http(url,opts); } });
  const [a,b] = await Promise.all([client.appel('moi'),client.appel('moi')]);
  assert.equal(a.utilisateur.role,'commercial'); assert.equal(b.utilisateur.role,'commercial'); assert.equal(n,1); assert.equal(session.token,'crm-banc-commercial');
});
await test('403 sans renouvellement ; panne conserve la session ; session invalide effacée', async () => {
  let n=0, session='inchangée';
  const client=creerClient({ session:{ token:'fictif',refresh_token:'fictif' },enregistrer:s => { session=s; },http:async () => { n++;return new Response('{"error":"Droit refusé"}',{status:403}); } });
  await assert.rejects(() => client.appel('moi'),e => e.status===403);assert.equal(n,1);
  for (const status of [503,200]) {
    const c=creerClient({ session:{ token:'fictif',refresh_token:'fictif' },enregistrer:s => { session=s; },http:async url => url.endsWith('admin-refresh') ? new Response('{"success":false}',{status}) : new Response('{}',{status:401}) });
    await assert.rejects(() => c.appel('moi')); assert.equal(session,status===503?'inchangée':null);
  }
});
await test('déconnexion pendant renouvellement : ne ressuscite pas la session', async () => {
  let liberer, session, signal;
  const pret = new Promise(r => { signal=r; });
  const client=creerClient({ session:{ token:'expire',refresh_token:'fictif' },enregistrer:s => { session=s; },http:async url => {
    if (url.endsWith('admin-refresh')) { signal(); await new Promise(r => { liberer=r; }); return new Response('{"success":true,"token":"nouveau"}'); }
    return new Response('{}',{status:401});
  } });
  const p=client.appel('moi'); await pret; client.deconnexion();liberer(); await assert.rejects(() => p); assert.equal(session,null);
});
await test('mode intégré utilise uniquement adminFetch', async () => {
  const client=creerClient({ session:null,http:() => assert.fail('HTTP autonome'),enregistrer:() => assert.fail('stockage autonome'),adminFetch:(url,opts) => http(url,{ ...opts,headers:{ ...opts.headers,Authorization:'Bearer essai-jeton-admin' } }) });
  assert.equal((await client.appel('moi')).utilisateur.role,'admin');
});
await test('CSV français : échappement des guillemets et formules', () => {
  const csv=csvPage([{ nom:'=FICTIF',ville:'Ville "inventée"; test' }],[{key:'nom',label:'Nom'},{key:'ville',label:'Ville'}]);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=FICTIF"'));assert.ok(csv.includes('"Ville ""inventée""; test"'));
});
await test('semaines : lundi, dimanche, année et changement d’heure à Paris', () => {
  assert.deepEqual(semaine('2027-01-01'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.equal(semaine('2026-11-22')[0],'2026-11-16');assert.equal(semaine('2026-11-22',1)[0],'2026-11-23');
  assert.equal(jourParis('2026-03-29T22:30:00Z'),'2026-03-30');assert.equal(jourParis('2026-10-25T23:30:00Z'),'2026-10-26');
  assert.equal(jourParis(null),null);assert.equal(jourParis('invalide'),null);
});
await test('mes échéances : groupes sans doublons, statuts, assignation et heures', () => {
  const maintenant='2026-11-18T10:00:00Z',base={type:'tache',statut:'a_faire',assigne_email:'commercial@exemple.test'},lignes=[
    {...base,id:'retard',echeance:'2026-11-18T09:00:00Z'}, {...base,id:'jour',echeance:maintenant},
    {...base,id:'semaine',type:'rendez_vous',echeance:'2026-11-22T17:00:00Z'}, {...base,id:'plus-tard',echeance:'2026-11-23T09:00:00Z'},
    {...base,id:'fait',statut:'fait',echeance:'2026-11-01T09:00:00Z'}, {...base,id:'annule',statut:'annule',echeance:'2026-11-01T09:00:00Z'},
    {...base,id:'autre',assigne_email:'autre@exemple.test',echeance:'2026-11-18T09:00:00Z'}, {...base,id:'note',type:'note',echeance:'2026-11-18T09:00:00Z'}, {...base,id:'sans-date'},
  ];
  const g=mesEcheances(lignes,base.assigne_email,maintenant);assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k,v])=>[k,v.map(a=>a.id)])),{retard:['retard'],jour:['jour'],semaine:['semaine']});
  assert.equal(estEnRetard(lignes[1],maintenant),false);assert.equal(estEnRetard(lignes[4],maintenant),false);
  const jours=agenda(lignes,semaine(maintenant));assert.equal(jours.length,7);assert.ok(jours[2].lignes.some(a=>a.id==='jour'));assert.ok(!jours.some(j=>j.lignes.some(a=>a.id==='sans-date')));
});
await test('alertes : seuil strict, comptes anciens, nouvelles, portefeuille et archives', () => {
  const base={id:'a',odoo_id:1,statut:'client',archive:false,commercial_email:'commercial@exemple.test',created_at:'2026-09-01T10:00:00Z'};
  const comptes=[{...base,indicateurs:{ca:49,prev:100,action:'2 – Accueil : cliente depuis moins de deux mois'},derniere_activite:'2026-10-23T10:00:00Z'},
    {...base,id:'b',commercial_email:'autre@exemple.test',indicateurs:{ca:50,prev:100}}, {...base,id:'c',statut:'ancien_client',indicateurs:{ca:0,prev:0}},
    {...base,id:'d',archive:true,indicateurs:{ca:0,prev:100}}, {...base,id:'e',statut:'hors_cible',indicateurs:{ca:0,prev:100}}, {...base,id:'f',created_at:'2026-11-22T09:00:00Z'},
    {...base,id:'g',derniere_activite:'2026-11-21T10:00:00Z',indicateurs:{ca:1,prev:0}},
  ];
  const a=alertesComptes(comptes,base.commercial_email,'2026-11-22T12:00:00Z');
  assert.deepEqual(a.baisse.map(c=>c.id),['a']);assert.deepEqual(a.sansAchat.map(c=>c.id),['c']);assert.deepEqual(a.nouvelles.map(c=>c.id),['a']);assert.deepEqual(a.sansActivite.map(c=>c.id),['a','c']);
});
await test('pipeline : montants, probabilité nulle ou absente, toutes les étapes, sans mutation', () => {
  const lignes=[{etape:'proposition',montant_mensuel_estime:100,probabilite:25},{etape:'proposition',montant_mensuel_estime:80,probabilite:0},{etape:'proposition',montant_mensuel_estime:20},{etape:'gagnee',montant_mensuel_estime:50,probabilite:100},{etape:'perdue',montant_mensuel_estime:30,probabilite:0}],avant=structuredClone(lignes),p=pipeline(lignes);
  assert.equal(p.length,7);assert.equal(p.find(c=>c.etape==='proposition').total,200);assert.equal(p.find(c=>c.etape==='proposition').pondere,25);assert.equal(p.find(c=>c.etape==='gagnee').pondere,50);assert.equal(p[0].total,0);assert.deepEqual(lignes,avant);
});
await test('activité équipe : fenêtres glissantes, dates futures exclues, attribution explicite', () => {
  const base={statut:'fait',auteur_email:'auteur@exemple.test',assigne_email:'assigne@exemple.test'},r=activiteEquipe([
    {...base,realise_at:'2026-11-15T10:00:00Z'}, {...base,realise_at:'2026-10-23T10:00:00Z'}, {...base,realise_at:'2026-10-23T09:59:00Z'},
    {...base,realise_at:'2026-11-23T10:00:00Z'}, {...base,statut:'a_faire',realise_at:'2026-11-21T10:00:00Z'}, {...base,assigne_email:null,realise_at:'2026-11-22T10:00:00Z'},
  ],'2026-11-22T10:00:00Z');
  assert.deepEqual(r,[{personne:'assigne@exemple.test',jours7:1,jours30:2},{personne:'auteur@exemple.test',jours7:1,jours30:1}]);
});
await test('contacts : recherche transversale, filtres et tri par compte', () => {
  const comptes=[{id:'1',nom:'Pharmacie fictive Z'},{id:'2',nom:'Pharmacie fictive A'}],contacts=[{id:'c1',nom:'Contact fictif',fonction:'titulaire',compte_id:'1'},{id:'c2',nom:'Autre fictif',fonction:'adjoint',compte_id:'2'}];
  assert.deepEqual(contactsFiltres(contacts,comptes,{recherche:'fictive A'}).map(c=>c.id),['c2']);assert.equal(contactsFiltres(contacts,comptes,{recherche:'TITULAIRE'}).length,1);
  assert.deepEqual(contactsFiltres(contacts,comptes,{tri:'compte'}).map(c=>c.id),['c2','c1']);assert.equal(contactsFiltres(contacts,comptes,{compte:'2',fonction:'titulaire'}).length,0);
});
await test('répartitions : valeurs manquantes et comptes archivés', () => {
  assert.deepEqual(repartition([{indicateurs:{profil:'A'}},{indicateurs:{profil:'A'}},{indicateurs:null},{archive:true,indicateurs:{profil:'B'}}],'profil'),[['A',2],['Non calculé',1]]);
});
await test('lecture complète : pagination au-delà de 100, stabilité et annulation', async () => {
  const rows=Array.from({length:205},(_,id)=>({id:String(id)})),pages=[];
  const appel=async(action,{filtres:f})=>{pages.push(f.page);assert.equal(action,'contacts.lister');return {donnees:{lignes:rows.slice((f.page-1)*100,f.page*100),total:205,limite:100}};};
  assert.equal((await lireToutes(appel,'contacts')).length,205);assert.deepEqual(pages,[1,2,3]);pages.length=0;assert.deepEqual(await lireToutes(appel,'contacts',{},()=>false),[]);assert.equal(pages.length,0);
});
await test('banc : toutes les rubriques lisibles, réglages et recherche réservés, marge masquée', async () => {
  for(const nom of ['admin','commercial','service','lecture']){
    const client=creerClient({http,session:null,enregistrer:()=>{}});await client.connexion(`${nom}@banc.test`,'inventé');
    for(const r of ['comptes','contacts','activites','opportunites'])assert.ok((await lireToutes(client.appel,r)).length>0);
    const global=(await client.appel('indicateurs.global')).donnees;assert.ok(global.objectif_mensuel_global>0);assert.equal(global.historique.length,5);assert.equal(Object.hasOwn(global.dernier.donnees,'marge'),nom==='admin');
    for(const [action,extra] of [['equipe.lister',{}],['reglages.lire',{}],['journal.lister',{}],['equipe.chercher',{donnees:{email:'nouveau@banc.test'}}]]){
      if(nom==='admin')assert.ok((await client.appel(action,extra)).donnees);else await assert.rejects(()=>client.appel(action,extra),e=>e.status===403);
    }
  }
});
await test('banc : ajout membre Auth, changement du rôle, réglages, relance, journal', async () => {
  const client=creerClient({http,session:null,enregistrer:()=>{}});await client.connexion('admin@banc.test','inventé');
  const user=(await client.appel('equipe.chercher',{donnees:{email:'NOUVEAU@banc.test'}})).donnees;
  const m=(await client.appel('equipe.enregistrer',{donnees:{...user,nom_affiche:'Nouveau membre fictif',role:'commercial',territoires:['2A','971'],objectif_mensuel:456,actif:true}})).donnees;
  assert.equal(banc.utilisateurs.nouveau.app_metadata.role,'commercial');
  const n=creerClient({http,session:null,enregistrer:()=>{}});await n.connexion('nouveau@banc.test','inventé');assert.equal((await n.appel('moi')).utilisateur.role,'commercial');
  await client.appel('equipe.enregistrer',{id:m.id,version:m.version,donnees:{role:'lecture',actif:false}});assert.equal((await n.appel('moi')).utilisateur.role,'lecture');
  const r=(await client.appel('reglages.lire')).donnees;
  await client.appel('reglages.enregistrer',{id:r.id,version:r.version,donnees:{objectif_mensuel_global:54321,jalons:{'2027-01-01':65432},territoire_indicateurs:['2A','971'],cibles_indicateurs:{fond_de_rayon:111,specialites_cheres:222,glp1:333,seuil_demande_isolee:44,origine:'Test inventé'}}});
  assert.equal((await client.appel('indicateurs.global')).donnees.objectif_mensuel_global,54321);
  assert.equal((await client.appel('indicateurs.relancer')).lance,true);assert.ok((await client.appel('indicateurs.etat')).donnees);
  const j=(await client.appel('journal.lister',{filtres:{objet:'equipe'}})).donnees;assert.ok(j.lignes.some(j=>j.objet_id===m.id));assert.ok(j.lignes.every(j=>j.objet==='equipe'));
});

await test('grand volume : cinq écrans, un appel chacun et parité avec les listes complètes', async () => {
  const date=new Date('2026-11-22T10:00:00Z'),grand=await creerBancCrm({date,volume:'grand'});
  assert.equal(grand.tables.crm_comptes.length,3000);
  assert.equal(grand.tables.crm_contacts.length,8000);
  assert.equal(grand.tables.crm_activites.length,2000);
  let nombre=0;
  const appel=async(action,extra={})=>{
    nombre++;
    const r=await grand.repondre({fn:'crm',corps:{action,...extra},entetes:{authorization:'Bearer crm-banc-admin'}});
    assert.equal(r.statut,200,r.texte);return JSON.parse(r.texte);
  };
  const compter=async(fn)=>{const avant=nombre,resultat=await fn();return {resultat,nombre:nombre-avant};};
  const comptes=await compter(async()=>[...await lireToutes(appel,'comptes'),...await lireToutes(appel,'comptes',{archive:true})]);
  const contacts=await compter(()=>lireToutes(appel,'contacts'));
  const activites=await compter(()=>lireToutes(appel,'activites'));
  const opportunites=await compter(()=>lireToutes(appel,'opportunites'));
  const global=(await appel('indicateurs.global')).donnees;
  const ancien={tableau:comptes.nombre+activites.nombre+opportunites.nombre+1,accueil:comptes.nombre+activites.nombre,
    contacts:comptes.nombre+contacts.nombre,activites:comptes.nombre+activites.nombre,opportunites:comptes.nombre+opportunites.nombre};
  const nouveaux={};
  grand.appels.length=0;
  for(const ecran of Object.keys(ancien)){
    const filtres=ecran==='opportunites'?{vue_tableau:true}:{page:1,limite:25};
    const {resultat,nombre:n}=await compter(()=>chargerEcran(appel,ecran,filtres));
    assert.equal(n,1);nouveaux[ecran]=resultat;
    console.log(`  ${ecran} : ${ancien[ecran]} → ${n} appel API (grand volume)`);
  }
  const lectures=grand.appels.map(a=>new URL(a.url)).filter(u=>u.pathname.endsWith('/crm_comptes_indicateurs'));
  assert.ok(lectures.length>2);
  assert.ok(lectures.every(u=>u.searchParams.get('limit')==='1000'));
  assert.ok(lectures.some(u=>u.searchParams.get('offset')==='2000'));
  assert.ok(lectures.every(u=>!u.searchParams.get('select').split(',').includes('*')));
  const statuts=new Map();
  for(const c of comptes.resultat.filter(c=>!c.archive))statuts.set(c.statut,(statuts.get(c.statut)||0)+1);
  assert.deepEqual(nouveaux.tableau,{
    repartitions:{profil:repartition(comptes.resultat,'profil'),action:repartition(comptes.resultat,'action'),statut:[...statuts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))},
    pipeline:pipeline(opportunites.resultat).map(({lignes,...col})=>({...col,nombre:lignes.length})),
    equipe:activiteEquipe(activites.resultat,date),global,
  });
  const email=grand.utilisateurs.admin.email,noms=new Map(comptes.resultat.map(c=>[c.id,c.nom]));
  const bornes=(groupes,comptes)=>Object.fromEntries(Object.entries(groupes).map(([k,l])=>[k,{total:l.length,lignes:l.slice(0,50).map(x=>comptes?{id:x.id,compte_id:x.id,compte_nom:x.nom}:{...x,compte_nom:noms.get(x.compte_id)})}]));
  assert.deepEqual(nouveaux.accueil,{taches:bornes(mesEcheances(activites.resultat,email,date),false),alertes:bornes(alertesComptes(comptes.resultat,email,date),true)});
  assert.ok(Object.values(nouveaux.accueil.alertes).some(g=>g.total>50));
  assert.equal(nouveaux.contacts.contacts.length,25);
  assert.equal(nouveaux.contacts.total,8000);
  assert.equal(nouveaux.activites.total,2000);
  assert.equal(nouveaux.opportunites.opportunites.length,210);
  assert.equal(nouveaux.opportunites.total,opportunites.resultat.length);
  for(const col of nouveaux.opportunites.colonnes){
    const attendu=pipeline(opportunites.resultat).find(c=>c.etape===col.etape);
    assert.equal(col.nombre,attendu.lignes.length);assert.equal(col.total,attendu.total);assert.equal(col.pondere,attendu.pondere);
    assert.ok(col.lignes.length<=30);
  }
  for(const ecran of ['contacts','activites','opportunites']) for(const l of nouveaux[ecran][ecran]) assert.equal(l.compte_nom,noms.get(l.compte_id));
});
console.log(`CRM écrans / banc : ${ok} ok, ${ko} ko`);
process.exit(ko?1:0);
