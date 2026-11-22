// Logique pure : classeur, comptes, activités et jour de référence fournis par l'appelant.
import XLSX from 'xlsx';
import { createHash } from 'node:crypto';
export const TAILLE_MAX_SUIVI=5*1024*1024;
const TITRES=['Pharmacie','CIP','Responsable','Date du contact','Statut','Commentaire'];
const STATUTS=['À contacter','Contactée','Rendez-vous pris','Logiciel paramétré','Sans suite'];
const erreur=message=>Object.assign(new Error(message),{status:400});
const texte=v=>String(v ?? '').trim();
function jourValide(y,m,d){const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d?date.toISOString().slice(0,10):null;}
function lireDate(v,date1904){
  if(!texte(v))return null;
  if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v,{date1904});if(d)return jourValide(d.y,d.m,d.d) ?? undefined;}
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texte(v));if(m)return jourValide(+m[3],+m[2],+m[1]) ?? undefined;
  return undefined;
}
export function decoderSuivi(base64){
  if(typeof base64!=='string' || base64.length>4*Math.ceil(TAILLE_MAX_SUIVI/3))throw erreur('Le fichier dépasse la limite de 5 Mo.');
  if(!base64 || base64.length%4 || /[^A-Za-z0-9+/=]/.test(base64))throw erreur('Le fichier encodé est invalide.');
  const octets=Buffer.from(base64,'base64');if(octets.toString('base64')!==base64)throw erreur('Le fichier encodé est invalide.');if(octets.length>TAILLE_MAX_SUIVI)throw erreur('Le fichier dépasse la limite de 5 Mo.');return octets;
}
export function preparerSuivi(octets,{nomFichier,comptes=[],activites=[],aujourdhui,auteur}={}){
  if(!octets?.length || octets.length>TAILLE_MAX_SUIVI)throw erreur('Le fichier est vide ou dépasse la limite de 5 Mo.');
  if(!texte(nomFichier) || nomFichier.length>200 || /[\r\n/\\]/.test(nomFichier))throw erreur('Nom de fichier invalide.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(aujourdhui || ''))throw erreur('Date de référence invalide.');
  let classeur;
  try{classeur=XLSX.read(octets,{type:'buffer',cellDates:false});}catch{throw erreur('Classeur Excel illisible.');}
  if(!classeur.Sheets.Pharmacies)throw erreur('L’onglet « Pharmacies » est obligatoire.');
  const resultat={a_creer:[],cip_inconnus:[],ignorees:[]},connues=new Set(activites.map(a=>a.import_empreinte).filter(Boolean));
  const parCip=new Map();for(const c of comptes){const cle=texte(c.cip),liste=parCip.get(cle)||[];liste.push(c);parCip.set(cle,liste);}
  for(const onglet of ['Pharmacies','Suivi non repris']){
    const feuille=classeur.Sheets[onglet];if(!feuille)continue;
    let plage;try{plage=XLSX.utils.decode_range(feuille['!ref'] || 'A1');}catch{throw erreur(`Plage invalide dans « ${onglet} ».`);}
    if(plage.e.r>50000 || plage.e.c>1000)throw erreur('Le classeur contient trop de lignes ou de colonnes.');
    const colonnes={};for(let c=0;c<=plage.e.c;c++){const titre=feuille[XLSX.utils.encode_cell({r:0,c})]?.v;if(TITRES.includes(titre)){if(colonnes[titre]!=null)throw erreur(`Titre en double : « ${titre} » (${onglet}).`);colonnes[titre]=c;}}
    for(const titre of TITRES)if(colonnes[titre]==null)throw erreur(`Titre manquant : « ${titre} » (${onglet}).`);
    for(let r=1;r<=plage.e.r;r++){
      const cellule=t=>feuille[XLSX.utils.encode_cell({r,c:colonnes[t]})],val=t=>cellule(t)?.v;
      const cip=texte(cellule('CIP')?.w || (cellule('CIP')?XLSX.utils.format_cell(cellule('CIP')):''));
      const date=lireDate(val('Date du contact'),!!classeur.Workbook?.WBProps?.date1904);
      const ligne={onglet,ligne:r+1,pharmacie:texte(val('Pharmacie')),cip,date_contact:date===undefined?texte(val('Date du contact')):date,date_invalide:date===undefined};
      const ignorer=raison=>resultat.ignorees.push({...ligne,raison});
      if(!TITRES.slice(2).some(t=>texte(val(t)))){ignorer('Aucun suivi renseigné.');continue;}
      if(TITRES.some(t=>cellule(t)?.f)){ignorer('Une cellule contient une formule : saisir une valeur.');continue;}
      const statut=texte(val('Statut')),commentaire=texte(val('Commentaire')),responsable=texte(val('Responsable'));
      if(statut && !STATUTS.includes(statut)){ignorer('Statut non reconnu.');continue;}
      if(date===undefined){ignorer('Date du contact invalide (JJ/MM/AAAA attendu).');continue;}
      const candidats=parCip.get(cip)||[];
      if(!cip || !candidats.length){resultat.cip_inconnus.push({...ligne,raison:'CIP inconnu.'});continue;}
      if(candidats.length!==1){ignorer('CIP partagé par plusieurs comptes : rapprochement ambigu.');continue;}
      const compte=candidats[0];
      // La date vide reste vide dans l'empreinte : réimporter demain ne recrée pas une activité.
      const empreinte=createHash('sha256').update(JSON.stringify([cip,date || '',statut,commentaire])).digest('hex');
      if(connues.has(empreinte)){ignorer('Suivi déjà importé ou répété dans le classeur.');continue;}
      const notes=[commentaire,date===null?'Date du contact non renseignée':null,`Responsable : ${responsable || 'Non renseigné'}`,`Importé de : ${nomFichier}`].filter(Boolean).join('\n');
      if(notes.length>20000){ignorer('Commentaire ou responsable trop long.');continue;}
      const fait=!['À contacter','Rendez-vous pris'].includes(statut),instant=`${date || aujourdhui}T12:00:00.000Z`;
      resultat.a_creer.push({...ligne,compte:compte.nom,activite:{compte_id:compte.id,type:!statut?'note':statut==='À contacter'?'tache':statut==='Rendez-vous pris'?'rendez_vous':'appel',titre:statut || 'Suivi importé',statut:fait?'fait':'a_faire',echeance:fait || date===null?null:instant,realise_at:fait?instant:null,notes,auteur_email:auteur,import_empreinte:empreinte}});connues.add(empreinte);
    }
  }
  return resultat;
}
