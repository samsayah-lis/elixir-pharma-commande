import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { preparerSuivi,decoderSuivi,TAILLE_MAX_SUIVI } from '../netlify/functions/_crm-import-suivi.js';
import { creerBancCrm } from './banc/crm-banc.mjs';
globalThis.fetch=()=>{throw new Error('Réseau interdit');};
let ok=0,ko=0;async function test(nom,fn){try{await fn();ok++;}catch(e){ko++;console.error('✗',nom,e);}}
const titres=['Pharmacie','CIP','Responsable','Date du contact','Statut','Commentaire'];
function fichier(lignes,titresPerso=titres,suivi){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([titresPerso,...lignes]),'Pharmacies');if(suivi)XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([titres,...suivi]),'Suivi non repris');return XLSX.write(w,{type:'buffer',bookType:'xlsx'});}
const ligne=(statut='Contactée',date='22/11/2026',cip='9900001')=>['Pharmacie fictive',cip,'Responsable fictif',date,statut,'Commentaire inventé'];
const options={nomFichier:'suivi-fictif.xlsx',aujourdhui:'2026-11-22',auteur:'admin@exemple.test',comptes:[{id:'00000000-0000-4000-8000-000000000001',nom:'Pharmacie fictive',cip:'9900001'}]};
await test('Tous les statuts et notes de provenance',()=>{const d=preparerSuivi(fichier(['À contacter','Contactée','Rendez-vous pris','Logiciel paramétré','Sans suite'].map(s=>ligne(s))),options);assert.equal(d.a_creer.length,5);assert.deepEqual(d.a_creer.map(l=>[l.activite.type,l.activite.statut]),[['tache','a_faire'],['appel','fait'],['rendez_vous','a_faire'],['appel','fait'],['appel','fait']]);assert.match(d.a_creer[0].activite.notes,/Responsable : Responsable fictif\nImporté de : suivi-fictif.xlsx/);assert.equal(d.a_creer[0].activite.auteur_email,options.auteur);});
await test('Dates Excel et texte équivalentes, doublons dans les deux onglets',()=>{const serial=(Date.UTC(2026,10,22)-Date.UTC(1899,11,30))/86400000;const d=preparerSuivi(fichier([ligne('Contactée',serial)],titres,[ligne()]),options);assert.equal(d.a_creer.length,1);assert.equal(d.ignorees.length,1);assert.equal(d.a_creer[0].activite.realise_at,'2026-11-22T12:00:00.000Z');});
await test('Date absente : tâche sans échéance et empreinte stable demain',()=>{const f=fichier([ligne('À contacter','')]),d=preparerSuivi(f,options),demain=preparerSuivi(f,{...options,aujourdhui:'2026-11-23'});assert.equal(d.a_creer[0].activite.echeance,null);assert.equal(d.a_creer[0].activite.import_empreinte,demain.a_creer[0].activite.import_empreinte);});
await test('Dates et statuts invalides ignorés avec motif',()=>{const d=preparerSuivi(fichier([ligne('Contactée','31/02/2026'),ligne('Rendez-vous pris','date illisible'),ligne('inconnu')]),options);assert.equal(d.a_creer.length,0);assert.equal(d.ignorees.length,3);assert.ok(d.ignorees.every(l=>l.raison));});
await test('CIP inconnu, ambigu, et ligne sans suivi',()=>{const d=preparerSuivi(fichier([ligne('Contactée',undefined,'9900099'),['Pharmacie fictive','9900001','','','','']]),options);assert.equal(d.cip_inconnus.length,1);assert.equal(d.ignorees.length,1);assert.equal(preparerSuivi(fichier([ligne()]),{...options,comptes:[...options.comptes,...options.comptes]}).ignorees.length,1);});
await test('Titres exacts manquants et onglet absent',()=>{assert.throws(()=>preparerSuivi(fichier([ligne()],titres.map(t=>t==='CIP'?'cip':t)),options),/Titre manquant/);const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([titres]),'Autre');assert.throws(()=>preparerSuivi(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),options),/Pharmacies/);});
await test('Limite 5 Mo, base64 invalide, classeur illisible',()=>{assert.throws(()=>decoderSuivi(Buffer.alloc(TAILLE_MAX_SUIVI+1).toString('base64')),/5 Mo/);assert.throws(()=>preparerSuivi(Buffer.alloc(TAILLE_MAX_SUIVI+1),options),/5 Mo/);assert.throws(()=>decoderSuivi('!bad'),/invalide/);assert.throws(()=>preparerSuivi(Buffer.from('illisible'),options),/Pharmacies|illisible/);});
await test('CIP avec zéro initial conservé',()=>{const d=preparerSuivi(fichier([ligne('Contactée',undefined,'0990001')]),{...options,comptes:[{...options.comptes[0],cip:'0990001'}]});assert.equal(d.a_creer[0].cip,'0990001');});
const b=await creerBancCrm({date:'2026-11-22T10:00:00Z'}),f=fichier([ligne()]),donnees={nom_fichier:'suivi-fictif.xlsx',fichier:f.toString('base64')};
async function appel(action,role='admin',d=donnees){const r=await b.repondre({fn:'crm',entetes:{authorization:`Bearer crm-banc-${role}`},corps:{action:`import_suivi.${action}`,donnees:d}});return {status:r.statut,...JSON.parse(r.texte)};}
await test('Aperçu sans écriture puis application et journal',async()=>{const n=b.tables.crm_activites.length;const d=await appel('apercu');assert.equal(d.status,200);assert.equal(d.donnees.a_creer.length,1);assert.equal(b.tables.crm_activites.length,n);const r=await appel('appliquer');assert.equal(r.status,200);assert.equal(r.donnees.creees,1);assert.equal(b.tables.crm_activites.at(-1).auteur_email,'admin@banc.test');assert.equal(b.tables.crm_journal.at(-1).action,'activites.importer_suivi');});
await test('Double import sans doublon',async()=>{const n=b.tables.crm_activites.length;assert.equal((await appel('appliquer')).donnees.creees,0);assert.equal(b.tables.crm_activites.length,n);assert.equal((await appel('apercu')).donnees.ignorees.length,1);});
for(const role of ['commercial','service','lecture','nouveau'])await test(`Import réservé à l’admin : ${role}`,async()=>{for(const action of ['apercu','appliquer'])assert.equal((await appel(action,role)).status,403);});
await test('Base64 invalide refusé par API',async()=>{assert.equal((await appel('apercu','admin',{...donnees,fichier:'invalide!'})).status,400);});

await test('Dates Excel 1904 et titres déplacés',()=>{
  const w=XLSX.utils.book_new();w.Workbook={WBProps:{date1904:true}};const ts=[...titres].reverse(),l=ligne('Contactée',(Date.UTC(2026,10,22)-Date.UTC(1904,0,1))/86400000).reverse();
  XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([ts,l]),'Pharmacies');const d=preparerSuivi(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),options);assert.equal(d.a_creer[0].activite.realise_at,'2026-11-22T12:00:00.000Z');
});
await test('Imports simultanés : une seule création et un seul audit',async()=>{
  const nouveau={...donnees,fichier:fichier([ligne('Sans suite')]).toString('base64')},n=b.tables.crm_journal.length;
  const resultats=await Promise.all([appel('appliquer','admin',nouveau),appel('appliquer','admin',nouveau)]);assert.ok(resultats.every(r=>r.status===200));assert.equal(resultats.reduce((s,r)=>s+r.donnees.creees,0),1);assert.equal(b.tables.crm_journal.length,n+1);
});
await test('Formule de suivi refusée, titre du second onglet vérifié',()=>{
  const w=XLSX.read(fichier([ligne()]),{type:'buffer'});w.Sheets.Pharmacies.F2.f='"Commentaire"';assert.match(preparerSuivi(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),options).ignorees[0].raison,/formule/);
  XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Pharmacie']]),'Suivi non repris');assert.throws(()=>preparerSuivi(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),options),/Titre manquant/);
});

await test('Date absente : les cinq statuts sont conservés, notes et aperçu explicites',()=>{
  const statuts=['Contactée','Logiciel paramétré','Sans suite','Rendez-vous pris','À contacter'];
  const d=preparerSuivi(fichier(statuts.map(s=>ligne(s,''))),options);
  assert.equal(d.a_creer.length,5);assert.equal(d.ignorees.length,0);
  for(const [i,l] of d.a_creer.entries()){
    assert.equal(l.date_contact,null);assert.equal(l.date_invalide,false);assert.match(l.activite.notes,/Date du contact non renseignée/);
    assert.equal(l.activite.echeance,null);assert.equal(l.activite.realise_at,i<3?'2026-11-22T12:00:00.000Z':null);assert.equal(l.activite.statut,i<3?'fait':'a_faire');
  }
});
await test('Statut vide : responsable seul, date seule ou commentaire seul deviennent des notes',()=>{
  const lignes=[['Pharmacie fictive','9900001','Responsable fictif','','',''],['Pharmacie fictive','9900001','','21/11/2026','',''],['Pharmacie fictive','9900001','','','','Commentaire fictif']];
  const d=preparerSuivi(fichier(lignes),options);assert.equal(d.a_creer.length,3);
  for(const l of d.a_creer){assert.equal(l.activite.type,'note');assert.equal(l.activite.titre,'Suivi importé');assert.equal(l.activite.statut,'fait');assert.equal(l.activite.echeance,null);}
  assert.equal(d.a_creer[0].activite.realise_at,'2026-11-22T12:00:00.000Z');assert.equal(d.a_creer[1].activite.realise_at,'2026-11-21T12:00:00.000Z');assert.equal(d.a_creer[1].activite.notes.includes('Date du contact non renseignée'),false);
});
await test('Date illisible ou impossible reste ignorée, même sans statut ; espaces = absence',()=>{
  const d=preparerSuivi(fichier([ligne('','31/02/2026'),ligne('','illisible'),ligne('Contactée',60),ligne('','   ')]),options);
  assert.equal(d.ignorees.length,3);assert.ok(d.ignorees.every(l=>l.date_invalide && /Date du contact invalide/.test(l.raison)));assert.equal(d.a_creer.length,1);assert.equal(d.a_creer[0].date_contact,null);
});
await test('Empreintes sans date stables pour tous les statuts, notes incluses, réimport le lendemain vide',()=>{
  const f=fichier(['Contactée','Logiciel paramétré','Sans suite','Rendez-vous pris','À contacter',''].map(s=>ligne(s,'')));
  const d=preparerSuivi(f,options),demain=preparerSuivi(f,{...options,aujourdhui:'2026-11-23'});
  assert.equal(d.a_creer.length,6);assert.deepEqual(d.a_creer.map(l=>l.activite.import_empreinte),demain.a_creer.map(l=>l.activite.import_empreinte));
  const reprise=preparerSuivi(f,{...options,aujourdhui:'2026-11-23',activites:d.a_creer.map(l=>l.activite)});assert.equal(reprise.a_creer.length,0);assert.equal(reprise.ignorees.length,6);
});
await test('API : rendez-vous sans date et note sans statut créés, puis dédupliqués',async()=>{
  const d={...donnees,fichier:fichier([ligne('Rendez-vous pris',''),ligne('','')]).toString('base64')};
  const apercu=await appel('apercu','admin',d);assert.equal(apercu.donnees.a_creer.length,2);assert.ok(apercu.donnees.a_creer.every(l=>l.date_contact===null));
  assert.equal((await appel('appliquer','admin',d)).donnees.creees,2);assert.equal((await appel('appliquer','admin',d)).donnees.creees,0);
  const [rdv,note]=b.tables.crm_activites.slice(-2);assert.equal(rdv.echeance,null);assert.equal(note.type,'note');assert.equal(note.realise_at,'2026-11-22T12:00:00.000Z');
});
console.log(`CRM import suivi : ${ok} ok, ${ko} ko`);process.exit(ko?1:0);
