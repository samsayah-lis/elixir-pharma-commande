// Uniquement des personnes, identifiants, adresses et montants inventés.
import assert from 'node:assert/strict';
import { creerBancCrm,ligneAnnuaireFictive,enteteAnnuaireFictive } from './banc/crm-banc.mjs';
import { lireLigneAnnuaire,regrouperSites,rapprocherSite,planifierRapprochements,adressesProches,verifierEntete } from '../netlify/functions/_crm-annuaire.js';
import { creerHandlerAnnuaire,BUDGET_ANNUAIRE,JEU_ANNUAIRE } from '../netlify/functions/crm-annuaire-background.js';
import { creerStockAnnuaire } from '../netlify/functions/_crm-annuaire-stock.js';
import { creerHandlerCronAnnuaire } from '../netlify/functions/crm-annuaire-cron.js';
globalThis.fetch=()=>{throw new Error('Réseau interdit');};
let ok=0,ko=0;
async function test(nom,fn){try{await fn();ok++;}catch(e){ko++;console.error('✗',nom,e);}}
const date='2026-11-22T10:00:00Z',banc=()=>creerBancCrm({date}),event={httpMethod:'POST',headers:{'x-cron-secret':'cron-fictif'}},autoriser=e=>e.headers?.['x-cron-secret']==='cron-fictif';
const ligne=(n,c={})=>lireLigneAnnuaire(ligneAnnuaireFictive(n,c));
const site=regrouperSites([ligne(1)])[0];
const appeler=async(b,action,params={},role='admin')=>{const r=await b.repondre({fn:'crm',corps:{action,...params},entetes:{authorization:`Bearer crm-banc-${role}`}});return {status:r.statut,...JSON.parse(r.texte)};};
await test('Entête publique et format incompatible',()=>{verifierEntete(enteteAnnuaireFictive);assert.throws(()=>verifierEntete('mauvais|format'));});
await test('Titulaire : colonnes, adresse, e-mail, FINESS et RPPS',()=>{const l=ligne(1,{43:'CONTACT@EXEMPLE.TEST'});assert.equal(l.rpps,'99000000001');assert.equal(l.compte.finess,'990000001');assert.equal(l.compte.adresse,'1 RUE DES EXEMPLES FICTIFS');assert.equal(l.compte.email,'contact@exemple.test');assert.equal(site.contacts[0].fonction,'titulaire');});
await test('Profession, section, identifiants et territoire filtrés',()=>{for(const c of [{9:'10'},{50:'B'},{35:'69000'},{1:'INVALIDE'},{19:'',21:''}])assert.equal(ligne(1,c),null);assert.ok(lireLigneAnnuaire(ligneAnnuaireFictive(1,{35:'97100'}),['971']));assert.equal(lireLigneAnnuaire(ligneAnnuaireFictive(1),[]),null);});
await test('D officinal ; D sans secteur seulement avec A ; hôpital exclu',()=>{assert.equal(regrouperSites([ligne(2,{50:'D'})])[0].contacts[0].fonction,'adjoint');assert.equal(regrouperSites([ligne(2,{50:'D',49:''})]).length,0);assert.equal(ligne(2,{50:'D',49:'Hôpital'}),null);const sites=regrouperSites([ligne(1),ligne(2,{50:'D',49:'',21:site.finess,19:site.siret})]);assert.equal(sites.length,1);assert.equal(sites[0].contacts.length,2);});
await test('Regroupement SIRET sans FINESS et RPPS multi-site déterministe',()=>{const a=ligne(2,{21:'',19:site.siret,50:'D'});assert.equal(regrouperSites([ligne(1),a]).length,1);const x=ligne(2,{1:site.contacts[0].rpps,50:'D'});assert.deepEqual(regrouperSites([x,ligne(1)]),regrouperSites([ligne(1),x]));assert.equal(regrouperSites([x,ligne(1)]).flatMap(s=>s.contacts).length,1);});
await test('Adresse : abréviations, accents, faute, numéro et CP',()=>{const a={adresse:'12 av. du Général Fictif',code_postal:'75000'};assert.ok(adressesProches(a,{...a,adresse:'12 avenue General Fictif'}));assert.ok(adressesProches(a,{...a,adresse:'12 av Generall Fictif'}));for(const adresse of ['13 av General Fictif','12 bis av General Fictif','av General Fictif','12 av Autre Exemple'])assert.equal(adressesProches(a,{...a,adresse}),false);assert.equal(adressesProches(a,{...a,code_postal:'78000'}),false);});
await test('Rapprochements sûr, proposé, absent, ambigu et hors cible',()=>{const c={...site,id:'client',odoo_id:1,statut:'client'};assert.equal(rapprocherSite(site,[c]).type,'sur');assert.equal(rapprocherSite(site,[{...c,siret:null,finess:null}]).type,'a_valider');assert.equal(rapprocherSite(site,[]).type,'nouveau');assert.equal(rapprocherSite(site,[{...c,statut:'hors_cible'}]).type,'ignore');assert.equal(rapprocherSite({...site,finess:null},[c,{...c,id:'autre'}]).type,'a_valider');});
await test('Secret obligatoire et POST obligatoire, sans écriture',async()=>{const b=await banc();assert.equal((await b.handlerAnnuaire({...event,headers:{}})).statusCode,403);assert.equal((await b.handlerAnnuaire({...event,httpMethod:'GET'})).statusCode,405);assert.equal(b.tables.crm_annuaire_etat.length,0);});
await test('Import en flux : créations, rapprochement sûr, proposition seule, CRM intact',async()=>{const b=await banc(),avant=structuredClone(b.tables.crm_comptes[0]);assert.equal((await b.handlerAnnuaire(event)).statusCode,200);assert.equal(b.tables.crm_annuaire_etat[0].statut,'termine');const c=b.tables.crm_comptes[0];for(const k of ['nom','adresse','notes','commercial_email','etiquettes','groupement','logiciel','archive','email'])assert.deepEqual(c[k],avant[k],k);assert.equal(c.finess,site.finess);assert.ok(b.tables.crm_contacts.some(x=>x.compte_id===c.id && x.rpps===site.contacts[0].rpps));assert.ok(b.tables.crm_comptes.some(c=>c.source==='annuaire' && c.statut==='prospect' && c.finess==='990000003'));assert.equal(b.tables.crm_rapprochements.filter(r=>r.statut==='a_valider').length,2);assert.equal(b.tables.crm_comptes[1].finess,null);assert.equal(b.tables.crm_contacts.some(c=>c.rpps==='99000000002'),false);});
await test('Deuxième import : mise à jour, pas de doublons, champs CRM conservés',async()=>{const b=await banc();await b.handlerAnnuaire(event);const c=b.tables.crm_comptes.find(c=>c.finess==='990000003');Object.assign(c,{notes:'Note fictive conservée',etiquettes:['Test'],commercial_email:'commercial@exemple.test',groupement:'Fictif',logiciel:'Fictif',archive:true});const avant=structuredClone(c),n=b.tables.crm_comptes.length;b.annuaire.texte=b.annuaire.texte.replace('Officine fictive 3|','Officine fictive modifiée 3|');await b.handlerAnnuaire(event);assert.equal(c.nom,'Officine fictive modifiée 3');for(const k of ['notes','etiquettes','commercial_email','groupement','logiciel','archive'])assert.deepEqual(c[k],avant[k]);assert.equal(b.tables.crm_comptes.length,n);});
await test('Hors cible : compte et contacts inchangés',async()=>{const b=await banc(),c=b.tables.crm_comptes[0];c.statut='hors_cible';const avant=structuredClone(c);await b.handlerAnnuaire(event);assert.deepEqual(c,avant);assert.equal(b.tables.crm_contacts.some(x=>x.rpps===site.contacts[0].rpps),false);});
await test('Disparition : contact désactivé, officine étiquetée, manuel intact',async()=>{const b=await banc();await b.handlerAnnuaire(event);const c=b.tables.crm_contacts.find(c=>c.rpps==='99000000003'),manuel=b.tables.crm_contacts[0];manuel.rpps='99000000004';manuel.source='saisie';const avant=structuredClone(manuel),n=b.tables.crm_contacts.length;b.annuaire.texte=b.annuaire.texte.split('\n').filter(l=>!l.startsWith('|99000000003|')).join('\n');await b.handlerAnnuaire(event);assert.equal(c.actif,false);assert.equal(b.tables.crm_contacts.length,n);assert.deepEqual(manuel,avant);assert.ok(b.tables.crm_comptes.find(a=>a.id===c.compte_id).etiquettes.includes("absente de l'annuaire"));});
await test('Verrou et ancien détenteur expiré',async()=>{const b=await banc(),s=creerStockAnnuaire(b.deps),e=await s.commencer(['75']);const r=await b.handlerAnnuaire(event);assert.equal(JSON.parse(r.body).occupe,true);b.tables.crm_annuaire_etat[0].debut='2026-11-22T09:00:00Z';const nouveau=await s.commencer(['75']);assert.notEqual(nouveau.passage,e.passage);await assert.rejects(s.checkpoint(e.passage,{}),e=>e.status===409 || e.statusCode===409);});
await test('Budget : arrêt propre, reprise écriture sans nettoyage prématuré',async()=>{const b=await banc();let temps=0;const stock=creerStockAnnuaire(b.deps),lot=stock.lot;stock.lot=async(...a)=>{const r=await lot(...a);temps=BUDGET_ANNUAIRE-10000;return r;};const h=creerHandlerAnnuaire({...b.deps,annuaireStock:stock,autoriser,horloge:()=>temps});assert.equal(JSON.parse((await h(event)).body).pause,true);assert.equal(b.tables.crm_annuaire_etat[0].statut,'pause');assert.equal(b.tables.crm_annuaire_etat[0].phase,'ecriture');assert.ok(Object.keys(b.tables.crm_annuaire_etat[0].sites).length);await b.handlerAnnuaire(event);assert.equal(b.tables.crm_annuaire_etat[0].statut,'termine');assert.equal(b.tables.crm_comptes.filter(c=>c.finess==='990000003').length,1);});
await test('Extraction tronquée ou mauvaise : erreur publique neutre, aucun nettoyage',async()=>{const b=await banc();await b.handlerAnnuaire(event);const avant=structuredClone(b.tables.crm_contacts);b.annuaire.texte='format incompatible';const r=await b.handlerAnnuaire(event);assert.equal(r.statusCode,503);assert.deepEqual(b.tables.crm_contacts,avant);assert.equal(r.body.includes('format incompatible'),false);});
await test('État public sans tampon ni URL, filtre source',async()=>{const b=await banc();await b.handlerAnnuaire(event);const r=await appeler(b,'annuaire.etat');assert.equal(r.status,200);for(const k of ['sites','reste','source_url','passage'])assert.equal(k in r.donnees,false);const l=await appeler(b,'comptes.lister',{filtres:{source:'annuaire'}});assert.ok(l.donnees.lignes.length);assert.ok(l.donnees.lignes.every(c=>c.source==='annuaire'));});
for(const role of ['commercial','service','lecture'])await test(`API annuaire et rapprochements interdits : ${role}`,async()=>{const b=await banc();for(const action of ['annuaire.etat','annuaire.relancer','rapprochements.lister','rapprochements.valider','rapprochements.rejeter'])assert.equal((await appeler(b,action,{},role)).status,403,action);});
await test('Validation atomique : identifiants, contacts, archivage, auteur et conflit',async()=>{const b=await banc();assert.equal((await appeler(b,'annuaire.relancer')).status,202);const r=(await appeler(b,'rapprochements.lister')).donnees.lignes.find(r=>r.compte_propose===b.tables.crm_comptes[1].id);assert.equal((await appeler(b,'rapprochements.valider',{id:r.id,version:r.version,donnees:{version_compte:r.compte.version+1}})).status,409);assert.equal(b.tables.crm_comptes[1].finess,null);const valide=await appeler(b,'rapprochements.valider',{id:r.id,version:r.version,donnees:{version_compte:r.compte.version}});assert.equal(valide.status,200);assert.equal(valide.donnees.statut,'valide');assert.equal(valide.donnees.auteur_email,'admin@banc.test');assert.equal(b.tables.crm_comptes[1].finess,'990000002');assert.equal(b.tables.crm_comptes[3].archive,true);assert.ok(b.tables.crm_contacts.some(c=>c.rpps==='99000000002' && c.compte_id===r.compte.id));assert.equal((await appeler(b,'rapprochements.rejeter',{id:r.id,version:r.version})).status,409);});
await test('Rejet sans mutation de compte ; prospect au passage suivant',async()=>{const b=await banc();await b.handlerAnnuaire(event);const r=b.tables.crm_rapprochements.find(r=>r.statut==='a_valider'),avant=structuredClone(b.tables.crm_comptes);assert.equal((await appeler(b,'rapprochements.rejeter',{id:r.id,version:r.version})).status,200);assert.deepEqual(b.tables.crm_comptes,avant);await b.handlerAnnuaire(event);assert.equal(b.tables.crm_rapprochements.find(x=>x.id===r.id).statut,'rejete');assert.equal(b.tables.crm_comptes[3].archive,false);assert.ok(b.tables.crm_contacts.some(c=>c.rpps==='99000000002'));});
await test('Panne de métadonnées sans erreur brute',async()=>{const b=await banc(),h=creerHandlerAnnuaire({...b.deps,autoriser,fetch:(url,o)=>url===JEU_ANNUAIRE?Promise.reject(new Error('DÉTAIL PRIVÉ')):b.deps.fetch(url,o)});const r=await h(event);assert.equal(r.statusCode,503);assert.equal(r.body.includes('DÉTAIL PRIVÉ'),false);});
await test('Planification : 5 h Paris hiver et été, une seule exécution',async()=>{let n=0;for(const [d,attendu] of [['2026-01-01T04:00:00Z',1],['2026-07-01T03:00:00Z',2],['2026-07-01T04:00:00Z',2],['2026-01-02T04:00:00Z',2]]){await creerHandlerCronAnnuaire({maintenant:()=>new Date(d),siteUrl:'https://site-fictif.test',cronSecret:'fictif',fetch:async()=>{n++;return new Response('{}',{status:202});}})({});assert.equal(n,attendu);}});

await test('Reprise Range : checkpoint durable au milieu du flux UTF-8',async()=>{
  const b=await banc();b.annuaire.texte=[enteteAnnuaireFictive,...Array.from({length:620},(_,i)=>ligneAnnuaireFictive(i%20+1,{8:'Élodie fictive'}))].join('\n');b.annuaire.tailleBloc=4097;
  let temps=0;const stock=creerStockAnnuaire(b.deps),checkpoint=stock.checkpoint;
  stock.checkpoint=async(...a)=>{const r=await checkpoint(...a);if(a[1].octets>0 && a[1].phase==='collecte')temps=BUDGET_ANNUAIRE-10000;return r;};
  const h=creerHandlerAnnuaire({...b.deps,annuaireStock:stock,autoriser,horloge:()=>temps});assert.equal(JSON.parse((await h(event)).body).pause,true);
  const e=b.tables.crm_annuaire_etat[0];assert.ok(e.octets>0);assert.equal(e.phase,'collecte');assert.equal(b.tables.crm_comptes.length,60);
  let range;const suite=creerHandlerAnnuaire({...b.deps,autoriser,fetch:(url,o)=>{if(url.includes('annuaire-fictif'))range=o.headers.Range;return b.deps.fetch(url,o);}});
  assert.equal(JSON.parse((await suite(event)).body).termine,true);assert.ok(range.startsWith('bytes='));assert.equal(b.tables.crm_annuaire_etat[0].compteurs.lues,620);assert.ok(b.tables.crm_contacts.some(c=>c.prenom==='Élodie fictive'));
});
await test('Longueur tronquée : pas de nettoyage',async()=>{
  const b=await banc(),h=creerHandlerAnnuaire({...b.deps,autoriser,fetch:async(url,o)=>{const r=await b.deps.fetch(url,o);if(url.includes('annuaire-fictif'))return new Response(r.body,{headers:{'content-length':String(b.annuaire.texte.length+999),etag:'"fictif"'}});return r;}});
  assert.equal((await h(event)).statusCode,503);assert.equal(b.tables.crm_comptes.length,60);
});

await test('Deux FINESS distincts ne fusionnent pas sur le seul SIRET d’un prospect',async()=>{
  const b=await banc();b.annuaire.texte=[enteteAnnuaireFictive,ligneAnnuaireFictive(31),ligneAnnuaireFictive(32,{19:'99000000000031'})].join('\n');
  assert.equal(JSON.parse((await b.handlerAnnuaire(event)).body).termine,true);assert.equal(b.tables.crm_comptes.filter(c=>c.siret==='99000000000031').length,2);
});
await test('Fusion : contact avec activité conservé sur l’ancien compte',async()=>{
  const b=await banc();await b.handlerAnnuaire(event);const r=b.tables.crm_rapprochements.find(r=>r.statut==='a_valider'),dup=b.tables.crm_comptes[3],contact=b.tables.crm_contacts.find(c=>c.compte_id===dup.id);
  Object.assign(contact,{source:'annuaire',rpps:'99000000002'});b.tables.crm_activites.find(a=>a.compte_id===dup.id).contact_id=contact.id;
  const avant=structuredClone(b.tables.crm_comptes);const reponse=await appeler(b,'rapprochements.valider',{id:r.id,version:r.version,donnees:{version_compte:b.tables.crm_comptes[1].version}});
  assert.equal(reponse.status,200);assert.equal(contact.compte_id,dup.id);assert.equal(dup.archive,true);assert.equal(b.tables.crm_rapprochements.find(x=>x.id===r.id).statut,'valide');assert.notDeepEqual(b.tables.crm_comptes,avant);
});
await test('RPPS importé non modifiable et source non falsifiable par API',async()=>{
  const b=await banc();await b.handlerAnnuaire(event);const c=b.tables.crm_contacts.find(c=>c.source==='annuaire');
  assert.equal((await appeler(b,'contacts.modifier',{id:c.id,version:c.version,donnees:{rpps:'99000000999'}})).status,403);
  assert.equal((await appeler(b,'contacts.modifier',{id:c.id,version:c.version,donnees:{source:'saisie'}})).status,400);
});
await test('Territoire vide explicite : aucun import ni nettoyage',async()=>{
  const b=await banc();b.tables.crm_reglages[0].territoire_indicateurs=[];const avant=structuredClone(b.tables.crm_contacts);
  assert.equal(JSON.parse((await b.handlerAnnuaire(event)).body).termine,true);assert.equal(b.tables.crm_comptes.length,60);assert.deepEqual(b.tables.crm_contacts,avant);
});

await test('Un pour un global : automatique ; un-à-plusieurs et plusieurs-à-un restent proposés',()=>{
  const s={...site},c={id:'client',odoo_id:1,statut:'client',adresse:s.adresse,code_postal:s.code_postal,finess:null,siret:null};
  assert.equal(planifierRapprochements([s],[c])[0].decision.type,'automatique');
  assert.equal(planifierRapprochements([s],[c,{...c,id:'autre'}])[0].decision.type,'a_valider');
  assert.ok(planifierRapprochements([s,{...s,cle:'f:990000099',finess:'990000099'}],[c]).every(p=>p.decision.type==='a_valider'));
  assert.equal(planifierRapprochements([s],[{...c,finess:'990000099'}])[0].decision.type,'a_valider');
});
await test('Rejet mémorisé : aucune reprise automatique par FINESS, SIRET ou adresse',()=>{
  const c={...site,id:'client',odoo_id:1,statut:'client'};
  for(const changement of [{},{siret:null},{siret:null,finess:null}])assert.equal(planifierRapprochements([site],[{...c,...changement}],[{cle_site:site.cle,statut:'rejete',compte_propose:c.id}])[0].decision.type,'nouveau');
});
await test('Doublon possible : mots significatifs et même code postal, cliente non rapprochée',()=>{
  const s={...site,nom:'Pharmacie des Lilas Fictifs'},c={id:'client',odoo_id:1,statut:'client',nom:'Pharmacie des Lilas',code_postal:s.code_postal,adresse:'99 rue Autre'};
  assert.equal(planifierRapprochements([s],[c])[0].site.doublon_possible,true);
  assert.equal(planifierRapprochements([s],[{...c,nom:'Pharmacie de la Place'}])[0].site.doublon_possible,false);
  assert.equal(planifierRapprochements([s],[{...c,code_postal:'78000'}])[0].site.doublon_possible,false);
});
await test('Automatique journalisé, défaire, prospect et contacts avec/sans historique',async()=>{
  const b=await banc();b.tables.crm_comptes[4].adresse='99 voie autre';await b.handlerAnnuaire(event);
  const r=b.tables.crm_rapprochements.find(r=>r.motif==='Adresse identique, un pour un');assert.ok(r);assert.equal(r.statut,'valide');assert.equal(r.auteur,'automatique');assert.ok(b.tables.crm_annuaire_etat[0].compteurs.automatiques);
  const c=b.tables.crm_comptes.find(c=>c.id===r.compte_propose),contact=b.tables.crm_contacts.find(x=>x.rpps==='99000000002');
  for(const role of ['commercial','service','lecture'])assert.equal((await appeler(b,'rapprochements.defaire',{id:r.id,version:r.version,donnees:{version_compte:c.version}},role)).status,403);
  const avantVersion=c.version;assert.equal((await appeler(b,'rapprochements.defaire',{id:r.id,version:r.version,donnees:{version_compte:avantVersion+1}})).status,409);
  assert.equal((await appeler(b,'rapprochements.defaire',{id:r.id,version:r.version,donnees:{version_compte:avantVersion}})).status,200);
  assert.equal(b.tables.crm_comptes.find(x=>x.id===c.id).finess,null);assert.equal(b.tables.crm_comptes.find(x=>x.id===c.id).siret,null);
  await b.handlerAnnuaire(event);const prospect=b.tables.crm_comptes.find(x=>x.finess===r.finess);assert.equal(prospect.odoo_id,null);assert.equal(prospect.archive,false);assert.equal(b.tables.crm_contacts.find(x=>x.id===contact.id).compte_id,prospect.id);
  assert.ok(b.tables.crm_journal.some(j=>j.action==='rapprochements.defaire'));
});
await test('Défaire avec historique : contact reste sur la cliente, le prospect est quand même créé',async()=>{
  const b=await banc();b.tables.crm_comptes[4].adresse='99 voie autre';await b.handlerAnnuaire(event);
  const r=b.tables.crm_rapprochements.find(r=>r.motif==='Adresse identique, un pour un'),c=b.tables.crm_comptes.find(c=>c.id===r.compte_propose),contact=b.tables.crm_contacts.find(x=>x.rpps==='99000000002');
  b.tables.crm_activites.find(a=>a.compte_id===c.id).contact_id=contact.id;
  assert.equal((await appeler(b,'rapprochements.defaire',{id:r.id,version:r.version,donnees:{version_compte:c.version}})).status,200);await b.handlerAnnuaire(event);
  assert.equal(contact.compte_id,c.id);assert.ok(b.tables.crm_comptes.some(x=>x.finess===r.finess && !x.odoo_id && !x.archive));
});
await test('Étiquette doublon possible écrite sur un nouveau prospect',async()=>{
  const b=await banc();Object.assign(b.tables.crm_comptes[0],{nom:'Pharmacie des Lilas Fictifs',siret:null,code_postal:'75000',adresse:'99 voie Autre'});
  b.annuaire.texte=[enteteAnnuaireFictive,ligneAnnuaireFictive(31,{24:'Pharmacie des Lilas Fictifs'})].join('\n');await b.handlerAnnuaire(event);
  assert.ok(b.tables.crm_comptes.find(c=>c.finess==='990000031').etiquettes.includes('doublon possible'));
});

await test('Unicité sur tout le passage, y compris après pause entre deux lots',async()=>{
  const b=await banc();Object.assign(b.tables.crm_comptes[0],{siret:null,adresse:'31 rue des exemples fictifs',code_postal:'75000'});
  b.annuaire.texte=[enteteAnnuaireFictive,...Array.from({length:12},(_,i)=>ligneAnnuaireFictive(i+31,i===11?{28:'31'}:{}))].join('\n');
  let temps=0;const stock=creerStockAnnuaire(b.deps),lot=stock.lot;stock.lot=async(...a)=>{const r=await lot(...a);temps=BUDGET_ANNUAIRE-10000;return r;};
  const h=creerHandlerAnnuaire({...b.deps,annuaireStock:stock,autoriser,horloge:()=>temps});assert.equal(JSON.parse((await h(event)).body).pause,true);assert.equal(b.tables.crm_annuaire_etat[0].plan.length,12);
  await b.handlerAnnuaire(event);assert.equal(b.tables.crm_comptes[0].finess,null);assert.equal(b.tables.crm_rapprochements.filter(r=>r.compte_propose===b.tables.crm_comptes[0].id && r.statut==='a_valider').length,2);
});
await test('Liste des rapprochements automatiques filtrée côté serveur',async()=>{
  const b=await banc();await b.handlerAnnuaire(event);const r=await appeler(b,'rapprochements.lister',{filtres:{statut:'valide',automatique:true}});assert.equal(r.status,200);assert.ok(r.donnees.lignes.length);assert.ok(r.donnees.lignes.every(l=>l.auteur==='automatique' && l.statut==='valide'));
});
console.log(`Annuaire CRM : ${ok} ok, ${ko} ko`);process.exit(ko?1:0);
