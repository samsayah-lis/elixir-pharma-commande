// Synthèses pures : mêmes règles que les calculs d’affichage, horloge injectée.
export const ETAPES = { a_qualifier: "À qualifier", premier_contact: "Premier contact", rdv: "Rendez-vous", proposition: "Proposition", ouverture_compte: "Ouverture de compte", gagnee: "Gagnée", perdue: "Perdue" };
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

export function syntheseTableau(comptes, opportunites, activites, global, date) {
  const statuts = new Map();
  for (const c of comptes.filter(c => !c.archive)) statuts.set(c.statut, (statuts.get(c.statut) || 0) + 1);
  return {
    repartitions: { profil: repartition(comptes, 'profil'), action: repartition(comptes, 'action'),
      statut: [...statuts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])) },
    pipeline: pipeline(opportunites).map(({ lignes,...c }) => ({ ...c,nombre:lignes.length })),
    equipe: activiteEquipe(activites,date), global,
  };
}
export function syntheseAccueil(comptes, activites, email, date) {
  const noms = new Map(comptes.map(c => [c.id,c.nom]));
  const borner = (groupes, compte) => Object.fromEntries(Object.entries(groupes).map(([k,lignes]) => [k,{
    total:lignes.length,lignes:lignes.slice(0,50).map(l => compte
      ? { id:l.id,compte_id:l.id,compte_nom:l.nom }
      : { ...l,compte_nom:noms.get(l.compte_id) || '' }),
  }]));
  return { taches:borner(mesEcheances(activites,email,date),false),
    alertes:borner(alertesComptes(comptes,email,date),true) };
}

// Minuit civil à Paris, y compris les semaines de changement d’heure.
export function minuitParis(jour, decalage = 0) {
  const cible = Date.parse(ajouterJours(jour, decalage) + 'T00:00:00Z');
  let t = cible;
  for (let n = 0; n < 3; n++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).formatToParts(new Date(t)).map(x => [x.type,x.value]));
    t += cible - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return new Date(t).toISOString();
}
