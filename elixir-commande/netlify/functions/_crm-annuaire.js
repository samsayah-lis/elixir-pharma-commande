// Logique pure : colonnes « personne-activite », indices à partir de zéro.
import { departement, normaliserTelephone, email as schemaEmail } from './_crm-regles.js';
export const TERRITOIRE_ANNUAIRE = ['75','78','91','92','93','94','95'];
const propre = x => String(x ?? '').trim().replace(/\s+/g,' ');
const identifiant = (v,n) => new RegExp(`^\\d{${n}}$`).test(v) ? v : null;
const brut = t => propre(String(t ?? '').normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().replaceAll('Œ','OE').replaceAll('Æ','AE').replace(/[^A-Z0-9]/g,' '));
const ABREVIATIONS = { BD:'BOULEVARD',BLVD:'BOULEVARD',BVD:'BOULEVARD',BLD:'BOULEVARD',BOUL:'BOULEVARD',AV:'AVENUE',AVE:'AVENUE',AVN:'AVENUE',R:'RUE',PL:'PLACE',RTE:'ROUTE',CHE:'CHEMIN',CHEM:'CHEMIN',ST:'SAINT',STE:'SAINTE',FBG:'FAUBOURG',IMP:'IMPASSE',ALL:'ALLEE',QU:'QUAI',CRS:'COURS',RPT:'ROND POINT',RDPT:'ROND POINT',CHS:'CHAUSSEE',SQ:'SQUARE',PROM:'PROMENADE',PAS:'PASSAGE',PRV:'PARVIS',ESP:'ESPLANADE',GAL:'GENERAL',GEN:'GENERAL',MAL:'MARECHAL',PDT:'PRESIDENT',DR:'DOCTEUR' };
const TYPES = new Set('RUE AVENUE BOULEVARD PLACE ROUTE CHEMIN IMPASSE ALLEE QUAI COURS CHAUSSEE SQUARE PASSAGE MAIL PROMENADE VOIE SENTE SENTIER VILLA CITE RESIDENCE ESPLANADE PARVIS ROND POINT CARREFOUR LOTISSEMENT HAMEAU GALERIE'.split(' '));
const VIDES = new Set('DE DU DES LA LE LES L D ET A AU AUX'.split(' '));
export const normaliserAdresse = t => brut(t).split(' ').map(m=>ABREVIATIONS[m] || m).join(' ');
export function distance(a,b) {
  let p=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const q=[i];for(let j=1;j<=b.length;j++)q[j]=Math.min(p[j]+1,q[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=q;}
  return p[b.length];
}
const proche = (a,b) => a===b || /\D/.test(a+b) && distance(a,b) <= (Math.min(a.length,b.length)>=9?2:Math.min(a.length,b.length)>=5?1:0);
const decomposer = t => { const s=normaliserAdresse(t),m=s.match(/^(\d+)(?:\s*(BIS|TER|QUATER|[A-Z])(?=\s|$))?\s*/);return {numero:m?[m[1],m[2]].filter(Boolean).join(' '):'',voie:s.slice(m?.[0].length || 0)}; };
export function adressesProches(a,b) {
  if(!a.code_postal || a.code_postal!==b.code_postal)return false;
  const x=decomposer(a.adresse),y=decomposer(b.adresse);
  // Aucun rapprochement sans numéro, ni entre 12 et 12 BIS. Un type de voie
  // différent est toléré UNIQUEMENT pour une proposition à valider par l'admin.
  if(!x.numero || x.numero!==y.numero)return false;
  const mots=v=>v.split(' ').filter(m=>m && !TYPES.has(m) && !VIDES.has(m)),p=mots(x.voie),q=mots(y.voie);
  const colles=v=>v.split(' ').filter(m=>m && !TYPES.has(m)).join('');
  return !!p.length && !!q.length && (p.length===q.length && p.every((m,i)=>proche(m,q[i])) || p.join('').length>=5 && proche(p.join(''),q.join('')) || colles(x.voie).length>=5 && colles(x.voie)===colles(y.voie));
}
export function verifierEntete(ligne) {
  const c=ligne.replace(/^\uFEFF/,'').split('|').map(brut);
  if(!c[9]?.includes('CODE PROFESSION') || !c[50]?.includes('CODE SECTION') || !c[35]?.includes('CODE POSTAL') || !c[1]?.includes('IDENTIFIANT'))throw new Error('Format annuaire incompatible');
}
export function lireLigneAnnuaire(ligne,territoire=TERRITOIRE_ANNUAIRE) {
  const c=String(ligne).split('|').map(propre);
  if(c.length<54 || c[9]!=='21' || !['A','D'].includes(c[50]) || !territoire.includes(departement(c[35])))return null;
  const rpps=identifiant(c[1],11),finess=identifiant(c[21],9),siret=identifiant(c[19],14);
  if(!rpps || !c[7] || (!finess && !siret))return null;
  // 9 : profession ; 50 : section du tableau ; 49 : libellé du secteur d'activité.
  // A = titulaire d'officine. D = adjoint, retenu si le secteur est explicitement
  // « Officine » / « Pharmacie d'officine ». Si le secteur manque, il faut un A
  // sur le même site. Un secteur hospitalier, industriel, etc. n'est jamais déduit
  // de la seule présence du mot « pharmacie » dans la raison sociale.
  const secteur=brut(c[49]),officine=['OFFICINE','OFFICINES','PHARMACIE D OFFICINE','PHARMACIES D OFFICINE'].includes(secteur);
  if(c[50]==='D' && secteur && !officine)return null;
  const telephone=normaliserTelephone(c[40] || c[41] || ''),mail=schemaEmail.safeParse(c[43] || '');
  return {cle:finess?`f:${finess}`:`s:${siret}`,section:c[50],officine:c[50]==='A'||officine,
    rpps,nom:c[7].slice(0,500),prenom:(c[8] || '').slice(0,500),
    compte:{finess,siret,nom:(c[24] || c[25] || 'Officine de l’annuaire').slice(0,500),adresse:propre([28,29,31,32].map(i=>c[i]).join(' ')).slice(0,500),
      code_postal:c[35],departement:departement(c[35]),ville:(c[37] || '').slice(0,500),telephone:/^\+[1-9]\d{7,14}$/.test(telephone)?telephone:null,email:mail.success?mail.data:null} };
}
export function regrouperSites(lignes) {
  // Un SIRET sans FINESS rejoint son site identifié si ce SIRET désigne un seul FINESS.
  const finessParSiret=new Map();for(const l of lignes)if(l.compte.finess && l.compte.siret){const s=finessParSiret.get(l.compte.siret)||new Set();s.add(l.cle);finessParSiret.set(l.compte.siret,s);}
  const groupes=new Map();for(const l of lignes){const f=finessParSiret.get(l.compte.siret),cle=!l.compte.finess && f?.size===1?[...f][0]:l.cle;const g=groupes.get(cle)||[];g.push(l);groupes.set(cle,g);}
  const sites=[];
  for(const [cle,ls] of groupes){if(!ls.some(l=>l.officine))continue;const tries=[...ls].sort((a,b)=>(a.section==='A'?0:1)-(b.section==='A'?0:1)||a.rpps.localeCompare(b.rpps));
    const c={...tries.find(l=>l.compte.finess)?.compte || tries[0].compte};
    sites.push({cle,...c,contacts:[...new Map(tries.map(l=>[l.rpps,{rpps:l.rpps,nom:l.nom,prenom:l.prenom,fonction:l.section==='A'?'titulaire':'adjoint'}]).reverse()).values()].sort((a,b)=>a.rpps.localeCompare(b.rpps))});
  }
  sites.sort((a,b)=>a.cle.localeCompare(b.cle));
  // Le schéma exige un RPPS unique : multi-sites = titulaire prioritaire, puis clé
  // de site croissante. Ce choix stable évite un changement de rattachement à chaque import.
  const proprietaires=new Map();for(const s of sites)for(const c of s.contacts){const ancien=proprietaires.get(c.rpps);if(!ancien || ancien.contact.fonction!=='titulaire' && c.fonction==='titulaire')proprietaires.set(c.rpps,{site:s.cle,contact:c});}
  return sites.map(s=>({...s,contacts:s.contacts.filter(c=>proprietaires.get(c.rpps).site===s.cle)}));
}
export function rapprocherSite(site,comptes) {
  const memes=comptes.filter(c=>site.finess && c.finess===site.finess || site.siret && c.siret===site.siret);
  if(memes.some(c=>c.statut==='hors_cible'))return {type:'ignore',comptes:[],motif:'Compte hors cible'};
  const clients=comptes.filter(c=>c.odoo_id && c.statut!=='hors_cible');
  const surs=clients.filter(c=>site.siret && c.siret===site.siret);
  if(surs.length===1)return {type:'sur',comptes:[surs[0].id],motif:'SIRET identique'};
  const deja=clients.filter(c=>site.finess && c.finess===site.finess);
  if(deja.length===1)return {type:'lie',comptes:[deja[0].id],motif:'FINESS déjà rattaché'};
  const proches=surs.length>1?surs:clients.filter(c=>adressesProches(site,c));
  if(proches.length)return {type:'a_valider',comptes:proches.map(c=>c.id).sort(),motif:surs.length>1?'SIRET partagé par plusieurs clients':'Même code postal et adresse proche'};
  return {type:'nouveau',comptes:[],motif:'Aucun client correspondant'};
}

const motsNom = nom => new Set(brut(nom).split(' ').filter(m=>m.length>2 && !VIDES.has(m) && !['PHARMACIE','PHARMACIES','OFFICINE','OFFICINES','SELARL','SELAS','SARL','SNC'].includes(m)));
export function nomsProches(a,b) {const x=motsNom(a),y=motsNom(b);return [...x].some(m=>y.has(m));}
// Calcul sur TOUS les sites, avant découpage en lots et avant toute écriture.
export function planifierRapprochements(sites,comptes,rapprochements=[]) {
  const plans=sites.map(site=>{
    const historique=rapprochements.filter(r=>r.cle_site===site.cle),rejete=historique.some(r=>r.statut==='rejete') && !historique.some(r=>r.statut==='valide');
    const decision=rapprocherSite(site,comptes);
    return {site,decision:decision.type==='ignore'?decision:rejete?{type:'nouveau',comptes:[],motif:'Rapprochement rejeté',rejete:true}:decision};
  });
  const propositions=new Map();for(const p of plans)for(const id of p.decision.comptes)propositions.set(id,(propositions.get(id)||0)+1);
  for(const p of plans){const d=p.decision,c=comptes.find(c=>c.id===d.comptes[0]);
    if(d.type==='a_valider' && d.motif==='Même code postal et adresse proche' && d.comptes.length===1 && propositions.get(c.id)===1 && (!c.finess || c.finess===p.site.finess))Object.assign(d,{type:'automatique',motif:'Adresse identique, un pour un'});
  }
  const lies=new Set(plans.filter(p=>['sur','lie','automatique'].includes(p.decision.type)).flatMap(p=>p.decision.comptes));
  for(const p of plans)if(p.decision.type==='nouveau')p.site={...p.site,doublon_possible:comptes.some(c=>c.odoo_id && c.statut!=='hors_cible' && !lies.has(c.id) && c.code_postal===p.site.code_postal && nomsProches(c.nom,p.site.nom))};
  return plans;
}
