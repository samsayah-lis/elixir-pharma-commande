// Développement seulement : données et montants inventés, aucun accès à un service.
import { createHmac, randomUUID } from 'node:crypto';
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers });
const identifiant = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Extraction entièrement inventée, servie en flux par fauxFetch, jamais téléchargée.
export function ligneAnnuaireFictive(n, changements={}) {
  const c=Array(54).fill('');Object.assign(c,{1:`9900000${String(n).padStart(4,'0')}`,7:`Nom fictif ${n}`,8:'Camille',9:'21',19:`9900000${String(n).padStart(7,'0')}`,21:`99000${String(n).padStart(4,'0')}`,24:`Officine fictive ${n}`,28:String(n),31:'RUE',32:'DES EXEMPLES FICTIFS',35:'75000',37:'Ville fictive',43:`officine-${n}@exemple.test`,49:'Officine',50:'A',...changements});return c.join('|');
}
export const enteteAnnuaireFictive=Array.from({length:54},(_,n)=>({1:'Identifiant PP',9:'Code profession',35:'Code postal',50:'Code section du tableau de l ordre'})[n] || `Colonne ${n}`).join('|');
// Modèle transactionnel des RPC SQL, réservé au banc et aux tests hors ligne.
function rpcAnnuaire(t,nom,p,h,maintenant) {
  const copie=structuredClone(t),date=maintenant().toISOString(),publicEtat=e=>{const r={...e};delete r.sites;delete r.plan;return r;};
  const conflit=()=>{throw Object.assign(new Error('Conflit simulé'),{code:'40001'});};
  const audit=(table,avant,apres)=>t.crm_journal.push({id:randomUUID(),objet:table.slice(4),objet_id:apres.id,avant,apres:structuredClone(apres),action:h['x-crm-action'],acteur_email:h['x-crm-email'],created_at:date});
  function modifier(table,r,d){const avant=structuredClone(r);Object.assign(r,d,{version:(r.version||0)+1,updated_at:date});audit(table,avant,r);return r;}
  function creer(table,d){const r={id:randomUUID(),version:1,created_at:date,updated_at:date,...d};t[table].push(r);audit(table,null,r);return r;}
  function appliquer(s,cible,mode){
    const lies=t.crm_comptes.filter(c=>c.id===cible || s.finess && c.finess===s.finess || s.siret && c.siret===s.siret);
    if(lies.some(c=>c.statut==='hors_cible'))return null;
    let c;
    if(cible){c=t.crm_comptes.find(c=>c.id===cible);if(!c?.odoo_id || mode==='sur' && c.siret!==s.siret || mode==='lie' && c.finess!==s.finess || mode==='automatique' && c.finess && c.finess!==s.finess)conflit();
      if(t.crm_comptes.some(a=>a.id!==c.id && a.odoo_id && s.finess && a.finess===s.finess))conflit();
      for(const a of lies)if(a.id!==c.id && !a.odoo_id)modifier('crm_comptes',a,{archive:true,finess:null,annuaire_site:null});
    }else{
      for(const a of lies)if(a.odoo_id && t.crm_rapprochements.some(r=>r.cle_site===s.cle && r.compte_propose===a.id && r.statut==='rejete'))modifier('crm_comptes',a,{finess:a.finess===s.finess?null:a.finess,siret:a.siret===s.siret?null:a.siret,annuaire_site:null});
      c=lies.filter(a=>!a.odoo_id).find(a=>s.finess && a.finess===s.finess)||lies.filter(a=>!a.odoo_id).find(a=>s.siret && a.siret===s.siret && !a.archive && (!s.finess || !a.finess));if(c?.odoo_id)conflit();if(!c)c=creer('crm_comptes',{nom:s.nom,source:'annuaire',statut:'prospect',archive:false,etiquettes:s.doublon_possible?['doublon possible']:[],odoo_id:null});}
    const champs=cible?{}:Object.fromEntries(['nom','adresse','code_postal','ville','departement','telephone','email'].map(k=>[k,s[k]]));
    modifier('crm_comptes',c,{...champs,finess:s.finess||c.finess,siret:s.siret||c.siret,annuaire_site:s.cle,annuaire_maj:date,etiquettes:(c.etiquettes||[]).filter(v=>v!=="absente de l'annuaire")});
    for(const x of s.contacts){const a=t.crm_contacts.find(a=>a.rpps===x.rpps);if(a && ((a.source||'saisie')==='saisie' || t.crm_comptes.find(c=>c.id===a.compte_id)?.statut==='hors_cible'))continue;
      if(a && a.compte_id!==c.id && t.crm_activites.some(v=>v.contact_id===a.id))continue;
      const d={...x,compte_id:c.id,actif:true,annuaire_maj:date};if(a)modifier('crm_contacts',a,d);else creer('crm_contacts',{...d,source:'annuaire',principal:false});}
    return c.id;
  }
  try {
    let e=t.crm_annuaire_etat[0];
    if(nom==='commencer'){
      if(e?.statut==='en_cours' && new Date(date)-new Date(e.debut)<1200000)return json(null);
      const reprend=e && e.phase!=='termine' && JSON.stringify(e.territoire)===JSON.stringify(p.p_territoire);
      if(!reprend){e={id:e?.id||randomUUID(),sites:{},plan:null,phase:'collecte',compteurs:{},octets:0,reste:'',entete:true,etag:null,curseur:'',territoire:p.p_territoire,version:0};t.crm_annuaire_etat=[e];}
      Object.assign(e,{passage:randomUUID(),debut:date,fin:null,statut:'en_cours',updated_at:date,version:e.version+1});return json(publicEtat(e));
    }
    if(nom==='decider'){
      const r=t.crm_rapprochements.find(r=>r.id===p.p_id);if(!r || r.version!==p.p_version || r.statut!==(p.p_action==='defaire'?'valide':'a_valider'))conflit();
      const decision={statut:p.p_action==='valider'?'valide':'rejete',auteur:h['x-crm-acteur'],auteur_email:h['x-crm-email'],date_decision:date};
      if(p.p_action==='defaire'){const c=t.crm_comptes.find(c=>c.id===r.compte_propose);if(!c || c.version!==p.p_version_compte || c.statut==='hors_cible' || c.finess && c.finess!==r.finess)conflit();modifier('crm_comptes',c,{finess:null,siret:null,annuaire_site:null,annuaire_maj:null});}
      else if(p.p_action==='valider'){const c=t.crm_comptes.find(c=>c.id===r.compte_propose);if(c?.version!==p.p_version_compte || !appliquer(r.site,r.compte_propose,'valide'))conflit();for(const autre of t.crm_rapprochements)if(autre.id!==r.id && autre.cle_site===r.cle_site && autre.statut==='a_valider')modifier('crm_rapprochements',autre,{...decision,statut:'rejete'});}
      else if(p.p_action!=='rejeter')conflit();return json(modifier('crm_rapprochements',r,decision));
    }
    if(!e || e.passage!==p.p_passage || e.statut!=='en_cours' || new Date(date)-new Date(e.debut)>=1200000)conflit();
    if(nom==='checkpoint'){
      const m={...p.p_meta};if(m.reset){e.plan=null;e.sites={};e.curseur='';e.compteurs={};}delete m.reset;
      for(const l of p.p_lot||[]){e.sites[l.cle]||={};e.sites[l.cle][`${l.rpps}:${l.section}`]=l;}
      Object.assign(e,{...m,compteurs:{...e.compteurs,...m.compteurs}});
    }else if(nom==='arreter'){e.statut=p.p_statut;e.fin=date;}
    else if(nom==='lot'){
      if(e.phase!=='ecriture')conflit();
      for(const item of p.p_lot){const s=item.site;let d=item.decision;if(s.cle<=e.curseur)continue;let k='sites_traites';
        if(d.type!=='ignore' && t.crm_rapprochements.some(r=>r.cle_site===s.cle && r.statut==='rejete') && !t.crm_rapprochements.some(r=>r.cle_site===s.cle && r.statut==='valide'))d={type:'nouveau',comptes:[]};
        if(d.type==='ignore')k='ignores';else if(d.type==='a_valider'){k='rapprochements';for(const cible of d.comptes){const r=t.crm_rapprochements.find(r=>r.cle_site===s.cle && r.compte_propose===cible),donnees={cle_site:s.cle,finess:s.finess,siret:s.siret,site:s,motif:d.motif,compte_propose:cible};if(!r)creer('crm_rapprochements',{...donnees,statut:'a_valider'});else if(r.statut==='a_valider')modifier('crm_rapprochements',r,donnees);}}
        else {const id=appliquer(s,d.comptes[0],d.type);if(!id)k='ignores';else {
          if(s.doublon_possible)e.compteurs.doublons_possibles=(e.compteurs.doublons_possibles||0)+1;
          if(['automatique','sur'].includes(d.type)){const r=t.crm_rapprochements.find(r=>r.cle_site===s.cle && r.compte_propose===id),donnees={cle_site:s.cle,finess:s.finess,siret:s.siret,site:s,motif:d.motif,compte_propose:id,statut:'valide',auteur:'automatique',date_decision:date};if(!r)creer('crm_rapprochements',donnees);else if(r.statut==='a_valider')modifier('crm_rapprochements',r,donnees);e.compteurs.automatiques=(e.compteurs.automatiques||0)+1;}
        }}e.compteurs[k]=(e.compteurs[k]||0)+1;e.curseur=s.cle;}
    }else if(nom==='fin'){
      if(e.phase!=='fin' || !p.p_sites.length && e.territoire.length)conflit();
      const rp=new Set(p.p_sites.flatMap(s=>s.contacts.map(c=>c.rpps)));let n=0,m=0;
      for(const c of t.crm_contacts){const a=t.crm_comptes.find(a=>a.id===c.compte_id);if(c.source==='annuaire' && c.actif && a?.statut!=='hors_cible' && e.territoire.includes(a?.departement) && !rp.has(c.rpps)){modifier('crm_contacts',c,{actif:false});n++;}}
      for(const a of t.crm_comptes)if(a.annuaire_site && !a.archive && a.statut!=='hors_cible' && e.territoire.includes(a.departement) && !(a.etiquettes||[]).includes("absente de l'annuaire") && !p.p_sites.some(s=>s.cle===a.annuaire_site || s.finess && s.finess===a.finess || s.siret && s.siret===a.siret)){modifier('crm_comptes',a,{etiquettes:[...(a.etiquettes||[]),"absente de l'annuaire"]});m++;}
      Object.assign(e,{statut:'termine',phase:'termine',fin:date,sites:{},plan:null,reste:'',compteurs:{...e.compteurs,contacts_desactives:n,officines_absentes:m}});
    }else throw new Error('RPC non simulé');
    e.version++;e.updated_at=date;return json(publicEtat(e));
  }catch(err){for(const k of Object.keys(t))t[k]=copie[k];return json({code:err.code||'XX000'},409);}
}
export async function creerBancCrm({ date = new Date() } = {}) {
  // Import différé : le build ne charge ni les fonctions serveur ni leurs minuteries.
  const [{ creerHandlerCrm }, { creerHandlerLogin }] = await Promise.all([import('../../netlify/functions/crm.js'), import('../../netlify/functions/crm-login.js')]);
  date = new Date(date);
  const maintenant = () => date;
  const utilisateurs = Object.fromEntries(['admin','commercial','service','lecture'].map((nom,j) => [nom, { id:identifiant(900+j),email:`${nom}@banc.test`,app_metadata:{ role:nom === 'service' ? 'service_client' : nom } }]));
  const tables = Object.fromEntries(['comptes','contacts','activites','opportunites','indicateurs','synchros','equipe','reglages','journal','rapprochements','annuaire_etat'].map(k => [`crm_${k}`,[]]));
  tables.elixir_orders = [];
  for (let n = 1; n <= 60; n++) {
    const id = identifiant(n), client = n % 4 !== 0, ca = 300 + n * 97;
    const base = { version:1,created_at:date.toISOString(),updated_at:date.toISOString() };
    tables.crm_comptes.push({ ...base,id,nom:`Pharmacie fictive ${String(n).padStart(2,'0')}`,odoo_id:client ? n : null,cip:`990${String(n).padStart(4,'0')}`,finess:null,siret:null,adresse:`${n} voie fictive`,code_postal:'99000',departement:n % 2 ? '75' : '69',ville:`Ville fictive ${n % 6 + 1}`,telephone:null,email:`pharmacie-fictive-${n}@exemple.test`,statut:client ? n % 7 ? 'client' : 'ancien_client' : 'prospect',source:client ? 'odoo' : 'saisie',archive:false,commercial_email:n % 3 ? 'commercial@banc.test' : null,notes:'Fiche inventée pour le banc CRM.',etiquettes:['Démonstration'],groupement:'Groupement fictif',logiciel:'Logiciel fictif' });
    tables.crm_contacts.push({ ...base,id:identifiant(1000+n),compte_id:id,nom:`Contact fictif ${n}`,prenom:'Camille',fonction:'titulaire',email:`contact-${n}@exemple.test`,principal:true,actif:true,telephone:null });
    tables.crm_activites.push({ ...base,id:identifiant(2000+n),compte_id:id,titre:'Appel de démonstration',type:'appel',statut:'a_faire',echeance:'2026-11-24T10:00:00Z',auteur_email:n % 2 ? 'commercial@banc.test' : 'service@banc.test',assigne_email:n % 2 ? 'commercial@banc.test' : 'service@banc.test',notes:'Rappeler pour compléter la fiche fictive.' });
    tables.crm_opportunites.push({ ...base,id:identifiant(3000+n),compte_id:id,titre:'Projet fictif de développement',etape:'a_qualifier',montant_mensuel_estime:111 + n,proprietaire_email:'commercial@banc.test' });
    if (client) for (let semaine = 0; semaine < 5; semaine++) {
      const d = new Date(date); d.setUTCDate(d.getUTCDate()-7*semaine);
      tables.crm_indicateurs.push({ odoo_id:n,periode_fin:d.toISOString().slice(0,10),calcule_le:d.toISOString(),donnees:{ id:n,ca:ca-semaine*10,prev:ca*.8,refs:10+n,jours:3+n%9,profil:['A – Panier large','B – Spécialités seules','C – Intermédiaire','D – Occasionnelle','E – Sans achat depuis 30 jours'][n%5],action:'6 – Entretenir et servir les demandes non servies',cher:ca*.2,mj:ca*.1,glp:ca*.05,ns_fond:25+n,ns_cher:17,ns_glp:0,marge:ca*.17,marge_taux:.17,ca_avec_cout:ca,ca_mois:Array.from({ length:13 },(_,j) => { const m = new Date(Date.UTC(2025,10+j,1)); return { mois:m.toISOString().slice(0,7),ca:ca*(j+2)/14 }; }),non_servis:[{ produit_id:1,nom:'Produit fictif 01',valeur:25+n }] } });
    }
    tables.elixir_orders.push({ id:`BC-FICTIF-${n}`,pharmacy_cip:`990${String(n).padStart(4,'0')}`,date:date.toISOString(),total_ht:120+n,nb_lignes:3,processed:n%2===0,source:'site',items:[{ nom:'Produit fictif' }] });
  }
  // Jeu quotidien relatif à l'horloge injectée : chaque écran reste peuplé demain aussi.
  const jour = (n, heure = 10) => { const d=new Date(date);d.setUTCDate(d.getUTCDate()+n);d.setUTCHours(heure,0,0,0);return d.toISOString(); };
  utilisateurs.nouveau = { id:identifiant(950),email:'nouveau@banc.test',app_metadata:{} };
  const membres = ['admin','commercial','service','lecture'];
  tables.crm_equipe = membres.map((k,n) => ({ id:identifiant(5000+n),utilisateur_id:utilisateurs[k].id,email:utilisateurs[k].email,nom_affiche:`Membre fictif ${n+1}`,role:utilisateurs[k].app_metadata.role,territoires:n%2?['75']:['69'],objectif_mensuel:1234+n*111,actif:true,version:1,created_at:jour(-60),updated_at:jour(-10) }));
  tables.crm_reglages.push({ id:identifiant(6000),version:1,created_at:jour(-60),updated_at:jour(-5),objectif_mensuel_global:65432,jalons:{ [jour(15).slice(0,10)]:76543 },cibles_indicateurs:{ fond_de_rayon:321,specialites_cheres:234,glp1:123,seuil_demande_isolee:45,origine:'Cibles inventées du banc' },territoire_indicateurs:['75','69'] });
  tables.crm_synchros.push({ id:identifiant(7000),version:1,debut:jour(0,4),fin:jour(0,5),statut:'termine',compteurs:{crees:45,modifies:0,ignores:0,instantanes:46},erreur:null,created_at:jour(0,4),updated_at:jour(0,5) });
  const etapes=['a_qualifier','premier_contact','rdv','proposition','ouverture_compte','gagnee','perdue'];
  tables.crm_comptes.forEach(c=>{c.created_at=jour(-60);});
  tables.crm_activites.forEach((a,n)=>{
    const age=[0,-2,2,5,-9,-29,-40][n%7];
    a.type=['tache','rendez_vous','appel','visite','note'][n%5];a.echeance=jour(age,n%2?18:8);
    a.auteur_email=utilisateurs[membres[n%4]].email;a.assigne_email=a.auteur_email;
    a.created_at=jour(n%6===0?-45:-12);
    if(n%6===0)a.echeance=jour(-40);
    a.statut=n%3===0?'fait':'a_faire';a.realise_at=a.statut==='fait'?jour(Math.min(-1,age)):null;
  });
  tables.crm_opportunites.forEach((o,n)=>{o.etape=etapes[n%7];o.probabilite=[0,20,40,65,80,100,0][n%7];o.date_visee=jour(15).slice(0,10);o.proprietaire_email=n%3?'commercial@banc.test':'admin@banc.test';o.motif_perte=o.etape==='perdue'?'Projet fictif reporté':null;});
  for(const i of tables.crm_indicateurs){const n=i.odoo_id,p=i.donnees;p.depuis=jour(n%5===0?-20:-150).slice(0,7);if(n%7===0){p.ca=0;p.profil='E – Sans achat depuis 30 jours';p.action='1 – Rappeler : aucun achat depuis 30 jours';}else if(n%5===0)p.action='2 – Accueil : cliente depuis moins de deux mois';else if(n%3===0){p.prev=p.ca*3;p.action='1 – Rappeler : achats en baisse de plus de moitié';}p.marge=p.ca*.17;p.ca_avec_cout=p.ca;}
  const periodes=[...new Set(tables.crm_indicateurs.map(i=>i.periode_fin))];
  for(const periode_fin of periodes){const lignes=tables.crm_indicateurs.filter(i=>i.periode_fin===periode_fin).map(i=>i.donnees),ca=lignes.reduce((s,p)=>s+p.ca,0),ns=lignes.reduce((s,p)=>s+p.ns_fond+p.ns_cher+p.ns_glp,0);tables.crm_indicateurs.push({odoo_id:0,periode_fin,calcule_le:periode_fin+'T05:00:00Z',donnees:{indicateurs:{date:periode_fin,ca,ca_jour_ouvre:ca/21,pharmacies_actives:lignes.filter(p=>p.ca>0).length,part_servie:.83,non_servi:ns},marge:ca*.17,ca_avec_cout:ca,marge_taux:.17,controle:{ca,ns_total:ns},periode:[jour(-29).slice(0,10),periode_fin],produits:[],laboratoires:[]}});}
  tables.crm_journal.push(...['comptes','contacts','activites','opportunites','equipe','reglages'].map((objet,n)=>({id:identifiant(8000+n),objet,objet_id:tables[`crm_${objet}`][0].id,action:`${objet}.creer`,acteur_email:'admin@banc.test',created_at:jour(-n),avant:null,apres:structuredClone(tables[`crm_${objet}`][0])})));
  const { creerHandlerAnnuaire, JEU_ANNUAIRE }=await import('../../netlify/functions/crm-annuaire-background.js');
  const annuaire={texte:[enteteAnnuaireFictive,...Array.from({length:20},(_,i)=>ligneAnnuaireFictive(i+1))].join('\n')+'\n',etag:'"extraction-fictive-1"',tailleBloc:113};
  Object.assign(tables.crm_comptes[0],{siret:'99000000000001'});
  Object.assign(tables.crm_comptes[4],{adresse:'2 rue des exemples fictifs',code_postal:'75000'});
  Object.assign(tables.crm_comptes[1],{adresse:'2 rue des exemples fictifs',code_postal:'75000'});
  Object.assign(tables.crm_comptes[3],{finess:'990000002',siret:'99000000000002',source:'annuaire'});
  function correspond(row, p) {
    const comparer = (k,op,v) => op === 'eq' ? String(row[k]) === v : op === 'in' ? v.slice(1,-1).split(',').includes(String(row[k])) : op === 'ilike' ? String(row[k] || '').toLowerCase().includes(v.replaceAll('*','').toLowerCase()) : op === 'gte' ? row[k] >= Number(v) : op === 'lte' ? row[k] <= (Number.isNaN(Number(v)) ? v : Number(v)) : false;
    const terme = s => { const [k,op,...v] = s.split('.'); return comparer(k,op,v.join('.')); };
    return [...p].every(([k,v]) => ['select','order','offset','limit'].includes(k) || (k === 'or' ? v.slice(1,-1).split(',').some(terme) : k === 'and' ? v.slice(1,-1).split(',').every(terme) : terme(`${k}.${v}`)));
  }
  const jeton = nom => `crm-banc-${nom}`;
  const parJeton = t => utilisateurs[t?.replace(/^crm-banc-/,'')] || (['essai-jeton-admin','essai-jeton'].includes(t) ? utilisateurs.admin : null);
  async function fauxFetch(url, opts = {}) {
    const u = new URL(url), method = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : {};
    if(u.hostname==='entrepot-fictif.test'){
      const h=new Headers(opts.headers),horodatage=h.get('X-Elixir-Horodatage');
      const signature='sha256='+createHmac('sha256',deps.reclamationsSecret).update(`${horodatage}.${opts.body}`).digest('hex');
      if(method!=='POST' || u.pathname!=='/.netlify/functions/crm-reclamations' || h.has('origin') || h.get('X-Elixir-Signature')!==signature || Math.abs(Number(horodatage)-date.getTime()/1000)>300)return json({},401);
      const ids=body.partner_ids;if(!Array.isArray(ids) || !ids.length || ids.length>50)return json({},400);
      const commun={created_at:date.toISOString(),urgence:'normale',order_ref:'COMMANDE-FICTIVE-01',partner_id:ids[0]};
      return json({reclamations:[{...commun,numero:'EN-601-FICTIF-01',type:'produit_manquant',status:'ouverte',product_name:'Produit fictif 01',qty:2,souhait_pharmacie:'renvoi',source:'chatbot',closed_at:null},{...commun,numero:'EN-601-FICTIF-02',type:'produit_casse',status:'cloturee',product_name:'Produit fictif 02',qty:1,souhait_pharmacie:'avoir',source:'saisie',closed_at:date.toISOString()}],tickets:[{...commun,partner_id:ids.at(-1),reference:'TK-FICTIF-01',categorie:'livraison',objet:'Préciser un horaire de livraison fictif',statut:'ouvert',canal:'chatbot',cloture_at:null}]});
    }
    if(url===JEU_ANNUAIRE)return json({resources:[{title:'personne-activite',url:'https://annuaire-fictif.test/extraction',last_modified:date.toISOString()}]});
    if(u.hostname==='annuaire-fictif.test'){
      const bytes=Buffer.from(annuaire.texte),range=opts.headers?.Range,offset=range && opts.headers['If-Range']===annuaire.etag?Number(range.match(/\d+/)[0]):0;
      if(offset>=bytes.length)return new Response(null,{status:416,headers:{etag:annuaire.etag,'content-range':`bytes */${bytes.length}`}});
      let position=offset;
      const body=new ReadableStream({pull(controller){if(position>=bytes.length){controller.close();return;}const fin=Math.min(position+annuaire.tailleBloc,bytes.length);controller.enqueue(bytes.subarray(position,fin));position=fin;annuaire.apresBloc?.(position);}});
      return new Response(body,{status:offset?206:200,headers:{etag:annuaire.etag,'content-length':String(bytes.length-offset),...(offset?{'content-range':`bytes ${offset}-${bytes.length-1}/${bytes.length}`}:{})}});
    }
    if(u.pathname==='/.netlify/functions/crm-annuaire-background'){const r=await handlerAnnuaire({httpMethod:method,headers:opts.headers});return new Response(r.body,{status:r.statusCode});}
    if(u.pathname==='/rest/v1/rpc/crm_importer_suivi'){
      if(body.p_lignes.some(l=>{const cs=tables.crm_comptes.filter(c=>c.cip===l.cip);return cs.length!==1 || cs[0].id!==l.compte_id;}))return json({code:'40001'},409);
      const sorties=[];for(const l of body.p_lignes){if(tables.crm_activites.some(a=>a.import_empreinte===l.import_empreinte))continue;const a={...l,id:randomUUID(),version:1,created_at:date.toISOString(),updated_at:date.toISOString()};delete a.cip;tables.crm_activites.push(a);sorties.push(a);tables.crm_journal.push({id:randomUUID(),objet:'activites',objet_id:a.id,avant:null,apres:structuredClone(a),acteur_email:opts.headers['x-crm-email'],action:opts.headers['x-crm-action'],created_at:date.toISOString()});}return json([{creees:sorties.length}]);
    }
    if(u.pathname.startsWith('/rest/v1/rpc/crm_annuaire_'))return rpcAnnuaire(tables,u.pathname.split('crm_annuaire_')[1],body,opts.headers,maintenant);
    if(u.pathname === '/auth/v1/admin/users') {
      const page=Number(u.searchParams.get('page')||1),taille=Number(u.searchParams.get('per_page')||100),users=Object.values(utilisateurs);
      return json({users:users.slice((page-1)*taille,page*taille),last_page:Math.ceil(users.length/taille)});
    }
    if(u.pathname.startsWith('/auth/v1/admin/users/')){
      const user=Object.values(utilisateurs).find(x=>x.id===u.pathname.split('/').at(-1));if(!user)return json({},404);
      if(method==='PUT')user.app_metadata={...user.app_metadata,...body.app_metadata};return json(user);
    }
    if(u.pathname==='/.netlify/functions/crm-indicateurs-background'){
      if(opts.headers['x-cron-secret']!=='cron-fictif')return json({},403);
      tables.crm_synchros.push({id:randomUUID(),debut:date.toISOString(),fin:date.toISOString(),statut:'termine',compteurs:{instantanes:46},erreur:null,created_at:date.toISOString(),updated_at:date.toISOString(),version:1});return json({},202);
    }
    if (u.pathname === '/auth/v1/user') { const user = parJeton(opts.headers.Authorization?.slice(7)); return json(user || {},user ? 200 : 401); }
    if (u.pathname === '/auth/v1/token') { const nom = Object.keys(utilisateurs).find(k => utilisateurs[k].email === body.email); return nom ? json({ user:utilisateurs[nom],access_token:jeton(nom),refresh_token:`crm-refresh-${nom}`,expires_in:3600 }) : json({},401); }
    if (!u.pathname.startsWith('/rest/v1/')) throw new Error('Service non simulé');
    const t = u.pathname.slice('/rest/v1/'.length), p = u.searchParams;
    let rows = tables[t];
    if (t === 'crm_comptes_indicateurs') rows = tables.crm_comptes.map(c => {
      const i = tables.crm_indicateurs.filter(r => r.odoo_id === c.odoo_id).sort((a,b) => b.periode_fin.localeCompare(a.periode_fin))[0]?.donnees;
      return { ...c,indicateurs:i || null,ca:i?.ca ?? null,evolution:i?.prev ? (i.ca/i.prev-1)*100 : null,profil:i?.profil ?? null,action_proposee:i?.action ?? null,non_servi:i ? i.ns_fond+i.ns_cher+i.ns_glp : null };
    });
    if (!rows) return json({},503);
    if (method === 'GET') {
      const result = rows.filter(r => correspond(r,p));
      result.sort((a,b) => { for (const o of (p.get('order') || '').split(',')) { const [k,sens] = o.split('.'); const av=a[k],bv=b[k]; const cmp=av == null ? bv == null ? 0 : 1 : bv == null ? -1 : typeof av === 'number' ? av-bv : String(av).localeCompare(String(bv)); if(cmp) return cmp*(sens==='desc'?-1:1); } return 0; });
      const offset = Number(p.get('offset') || 0), select = p.get('select');
      const resultats = result.slice(offset,offset+Number(p.get('limit') || 1000)).map(r => select && select !== '*' ? Object.fromEntries(select.split(',').map(k => [k,r[k]])) : r);
      return json(resultats,200,{ 'content-range':`*/${result.length}` });
    }
    if (!['POST','PATCH'].includes(method)) return json({},405);
    const cibles = method === 'POST' ? [null] : rows.filter(r => correspond(r,p)), sorties = [];
    for (const avant of cibles) {
      if (body.compte_id && !tables.crm_comptes.some(c => c.id === body.compte_id)) return json({ code:'23503' },400);
      const apres = { ...(avant || { id:randomUUID() }),...body };
      if(t==='crm_equipe' && rows.some(r=>r.id!==apres.id && (r.utilisateur_id===apres.utilisateur_id || r.email===apres.email)))return json({code:'23505'},409);
      const audit = { id:randomUUID(),objet:t.replace('crm_',''),objet_id:apres.id,avant:avant ? structuredClone(avant) : null,apres:structuredClone(apres),action:opts.headers['x-crm-action'],acteur_email:opts.headers['x-crm-email'],created_at:date.toISOString() };
      if (avant) Object.assign(avant,apres); else rows.push(apres);
      tables.crm_journal.push(audit); sorties.push(apres);
    }
    return json(sorties);
  }
  async function fauxOdoo(model,method,args,kw) {
    if(model==='res.partner' && method==='search_read'){const id=args[0].find(x=>x[0]==='commercial_partner_id')[2];return [{id:10000+id}];}
    if (model !== 'account.move' || method !== 'search_read') throw new Error('Lecture non simulée');
    if (kw.offset) return [];
    const n = args[0].find(x => x[0] === 'partner_id.commercial_partner_id')?.[2];
    return [{ id:n*10,name:`FACT-FICTIVE-${n}`,invoice_date:'2026-11-10',move_type:'out_invoice',amount_untaxed:150+n,is_move_sent:true },{ id:n*10+1,name:`AVOIR-FICTIF-${n}`,invoice_date:'2026-11-12',move_type:'out_refund',amount_untaxed:12,is_move_sent:false }];
  }
  const deps = { entrepotUrl:'https://entrepot-fictif.test',reclamationsSecret:'secret-de-banc-reclamations-invente-uniquement',siteUrl:'https://site-fictif.test',cronSecret:'cron-fictif',fetch:fauxFetch,url:'https://supabase-fictif.test',cle:'serveur-fictif',authCle:'auth-fictive',adminEmail:'',maintenant,odoo:fauxOdoo,rateLimit:() => null };
  const handlerAnnuaire=creerHandlerAnnuaire({...deps,autoriser:e=>e.headers?.['x-cron-secret']==='cron-fictif'});
  const handlers = { crm:creerHandlerCrm(deps),'crm-login':creerHandlerLogin(deps) };
  return { tables,utilisateurs,deps,annuaire,handlerAnnuaire,async repondre({ fn,methode='POST',corps,entetes={} }) {
    if (fn === 'admin-refresh') {
      let body; try { body = typeof corps === 'string' ? JSON.parse(corps) : corps; } catch { return null; }
      const nom = body?.refresh_token?.replace(/^crm-refresh-/,'');
      if (!utilisateurs[nom] || !body.refresh_token.startsWith('crm-refresh-')) return null;
      return { statut:200,texte:JSON.stringify({ success:true,token:jeton(nom),refresh_token:body.refresh_token,expires_in:3600 }),source:'CRM fictif' };
    }
    if (!handlers[fn]) return null;
    const r = await handlers[fn]({ httpMethod:methode,headers:entetes,body:typeof corps === 'string' ? corps : JSON.stringify(corps) });
    return { statut:r.statusCode,texte:r.body,entetes:r.headers,source:'CRM fictif · vraies fonctions' };
  } };
}
let monde;
export async function repondreCrm(options) {
  if (!['crm','crm-login','admin-refresh'].includes(options.fn)) return null;
  monde ||= creerBancCrm();
  return (await monde).repondre(options);
}
