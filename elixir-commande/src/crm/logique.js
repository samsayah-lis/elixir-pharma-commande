// Calculs d'affichage purs. L'horloge est toujours passée par l'appelant.
import { ETAPES } from './client.js';
export const TYPES = { appel:'Appel', visite:'Visite', email:'E-mail', rendez_vous:'Rendez-vous', note:'Note', tache:'Tâche' };
export const FONCTIONS = { titulaire:'Titulaire', cotitulaire:'Cotitulaire', adjoint:'Adjoint', preparateur:'Préparateur', acheteur:'Acheteur', comptable:'Comptable', autre:'Autre' };
export const nombre = v => Number.isFinite(Number(v)) ? Number(v) : 0;
export const jourParis = valeur => {
  if (!valeur) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return valeur;
  const date = new Date(valeur); if (!Number.isFinite(date.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(date).map(x => [x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
export function ajouterJours(jour, n) { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
export function semaine(date, decalage = 0) {
  const jour = jourParis(date), lundi = ajouterJours(jour, -((new Date(`${jour}T12:00:00Z`).getUTCDay()+6)%7)+decalage*7);
  return Array.from({ length:7 },(_,j) => ajouterJours(lundi,j));
}
export function estEnRetard(a, maintenant) { return a.statut === 'a_faire' && !!a.echeance && new Date(a.echeance).getTime() < new Date(maintenant).getTime(); }
export function mesEcheances(activites, email, maintenant) {
  const jour = jourParis(maintenant), jours = semaine(maintenant), groupes = { retard:[],jour:[],semaine:[] };
  for (const a of activites) {
    if (a.assigne_email !== email || a.statut !== 'a_faire' || !['tache','rendez_vous'].includes(a.type) || !a.echeance) continue;
    const j = jourParis(a.echeance);
    if (estEnRetard(a,maintenant)) groupes.retard.push(a);
    else if (j === jour) groupes.jour.push(a);
    else if (jours.includes(j)) groupes.semaine.push(a);
  }
  for (const lignes of Object.values(groupes)) lignes.sort((a,b) => a.echeance.localeCompare(b.echeance));
  return groupes;
}
export function alertesComptes(comptes, email, maintenant) {
  const limite = ajouterJours(jourParis(maintenant),-30), resultat = { baisse:[],sansAchat:[],nouvelles:[],sansActivite:[] };
  for (const c of comptes) {
    if (c.archive || c.statut === 'hors_cible') continue;
    const i=c.indicateurs;
    if (i) {
      if (i.prev > 0 && i.ca < i.prev*.5) resultat.baisse.push(c);
      if (c.odoo_id && i.ca <= 0) resultat.sansAchat.push(c);
      if (i.action?.startsWith('2 – Accueil')) resultat.nouvelles.push(c);
    }
    const dernier = jourParis(c.derniere_activite || c.created_at);
    if (c.commercial_email === email && dernier && dernier <= limite) resultat.sansActivite.push(c);
  }
  return resultat;
}
export function pipeline(opportunites) {
  return Object.entries(ETAPES).map(([etape,label]) => {
    const lignes = opportunites.filter(o => o.etape === etape);
    return { etape,label,lignes,total:lignes.reduce((s,o) => s+nombre(o.montant_mensuel_estime),0),
      pondere:lignes.reduce((s,o) => s+nombre(o.montant_mensuel_estime)*nombre(o.probabilite)/100,0) };
  });
}
export function repartition(comptes, champ) {
  const groupes = new Map();
  for (const c of comptes.filter(c => !c.archive)) { const nom = c.indicateurs?.[champ] || 'Non calculé'; groupes.set(nom,(groupes.get(nom)||0)+1); }
  return [...groupes].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
}
export function activiteEquipe(activites, maintenant) {
  const fin = new Date(maintenant).getTime(), debut = fin-30*86400000, sept = fin-7*86400000, personnes = new Map();
  for (const a of activites) {
    const date = new Date(a.realise_at).getTime();
    if (a.statut !== 'fait' || !a.realise_at || !(date >= debut && date <= fin)) continue;
    const personne=a.assigne_email || a.auteur_email || 'Non renseigné';
    if (!personnes.has(personne)) personnes.set(personne,{ personne,jours7:0,jours30:0 });
    const p=personnes.get(personne);p.jours30++;if(date>=sept)p.jours7++;
  }
  return [...personnes.values()].sort((a,b) => b.jours30-a.jours30 || a.personne.localeCompare(b.personne));
}
export function agenda(activites, jours) { return jours.map(jour => ({ jour,lignes:activites.filter(a => jourParis(a.echeance) === jour).sort((a,b) => a.echeance.localeCompare(b.echeance)) })); }
export function contactsFiltres(contacts, comptes, { recherche='', compte='', fonction='', tri='nom', sens='asc' } = {}) {
  const noms=new Map(comptes.map(c => [c.id,c.nom])), q=recherche.trim().toLocaleLowerCase('fr-FR');
  const valeur=(c,k) => k === 'compte' ? noms.get(c.compte_id) || '' : k === 'nom' ? `${c.nom || ''} ${c.prenom || ''}` : c[k] || '';
  return contacts.filter(c => (!compte || c.compte_id === compte) && (!fonction || c.fonction === fonction) && (!q || [valeur(c,'nom'),valeur(c,'compte'),FONCTIONS[c.fonction]].join(' ').toLocaleLowerCase('fr-FR').includes(q)))
    .sort((a,b) => valeur(a,tri).localeCompare(valeur(b,tri),'fr',{ numeric:true })*(sens==='desc'?-1:1) || a.id.localeCompare(b.id));
}

export function nombreOuvertes(lignes=[]) {
  // closed_at fait foi ; les états terminaux couvrent aussi les anciennes fiches sans date.
  return lignes.filter(r=>!r.closed_at && !['clos','close','closed','cloture','cloturee','termine','terminee','resolu','resolue','annule','annulee','cancelled','resolved'].includes(String(r.status || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase())).length;
}
