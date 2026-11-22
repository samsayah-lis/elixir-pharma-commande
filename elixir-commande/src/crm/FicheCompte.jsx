import Reclamations, { nombreOuvertes } from './Reclamations';
import { useState } from 'react';
import { STATUTS, ETAPES, dateFr, evolution, pourcent } from './client';
import { Champ, Etat, Pagination, Vide, euros, useLecture } from './ui';
const TABS = { activites: 'Activité', contacts: 'Contacts', opportunites: 'Opportunités', indicateurs: 'Indicateurs', commandes: 'Commandes du site', factures: 'Factures', reclamations: 'Réclamations', informations: 'Informations' };
export default function FicheCompte({ id, appel, peut, utilisateur, retour, entrepotUrl }) {
  const [onglet, setOnglet] = useState('activites'), [revision, setRevision] = useState(0), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const etat = useLecture(appel, 'comptes.lire', { id }, revision), ind = useLecture(appel, 'indicateurs.compte', { id }, revision);
  const reclamations = useLecture(appel, 'comptes.reclamations', { id }, revision);
  const c = etat.donnees, i = ind.donnees?.dernier?.donnees;
  async function mutation(action, donnees, ligne) {
    setBusy(true); setMessage('');
    try { await appel(action, { donnees, ...(ligne ? { id: ligne.id, version: ligne.version } : {}) }); setRevision(v => v + 1); setMessage('Enregistré.'); return true; }
    catch (e) { setMessage(e.message); if (e.status === 409) setRevision(v => v + 1); return false; }
    finally { setBusy(false); }
  }
  return <section><button onClick={retour}>← Comptes</button><Etat etat={etat} /><p role="status" className="crm-message">{message}</p>{c && <>
    <header className="crm-titre"><div><small>{STATUTS[c.statut]} · {c.ville || 'Ville non renseignée'}</small><h1>{c.nom}</h1>{reclamations.donnees?.etat === 'disponible' && <button className="crm-badge" onClick={() => setOnglet('reclamations')}>{nombreOuvertes(reclamations.donnees.reclamations)} réclamation(s) ouverte(s)</button>}{reclamations.erreur && <p>Réclamations indisponibles — consultez l’onglet pour réessayer.</p>}{entrepotUrl && <p><a href={entrepotUrl} target="_blank" rel="noopener noreferrer">Ouvrir l’outil entrepôt</a></p>}<p>Origine : {({annuaire:'Annuaire Santé',odoo:'Odoo',saisie:'Saisie'})[c.source] || 'Saisie'}{c.annuaire_maj && <> · Annuaire Santé mis à jour le {dateFr(c.annuaire_maj)}</>}</p><p>CIP {c.cip || '—'} · FINESS {c.finess || '—'}</p><p>Commercial : {c.commercial_email || 'Non attribué'} · Logiciel : {c.logiciel || 'Non renseigné'}</p><p>{c.etiquettes?.map(t => <span className="crm-badge" key={t}>{t}</span>)}</p></div><div><strong>{i?.profil || 'Profil non calculé'}</strong><p>{i?.action || 'Aucune action proposée'}</p></div></header>
    <Etat etat={ind} />{i ? <div className="crm-kpis">{[['CA 30 jours', euros(i.ca)], ['Évolution', pourcent(evolution(i.ca, i.prev))], ...(peut('marge','lire') ? [['Marge', euros(i.marge)]] : []), ['Références', i.refs], ['Jours facturés', i.jours], ['Non servi', euros(i.ns_fond + i.ns_cher + i.ns_glp)]].map(([nom,v]) => <div key={nom}><small>{nom}</small><strong>{v ?? '—'}</strong></div>)}</div> : !ind.chargement && <Vide>Aucun indicateur disponible pour ce compte.</Vide>}
    <nav className="crm-onglets" aria-label="Rubriques du compte">{Object.entries(TABS).map(([k,v]) => <button key={k} aria-current={onglet === k ? 'page' : undefined} onClick={() => setOnglet(k)}>{v}</button>)}</nav>
    <h2>{TABS[onglet]}</h2>
    {['activites','contacts','opportunites'].includes(onglet) && <Objets key={`${onglet}-${id}-${revision}`} {...{ onglet, id, appel, revision, peut, utilisateur, mutation, busy }} />}
    {onglet === 'reclamations' && <Reclamations etat={reclamations} recharger={() => setRevision(v => v + 1)} />}
    {onglet === 'indicateurs' && <Indicateurs i={i} />}
    {['commandes','factures'].includes(onglet) && <Documents key={onglet} {...{ appel, id, onglet }} />}
    {onglet === 'informations' && <Informations key={`${c.id}-${c.version}`} {...{ c, peut, mutation, busy, utilisateur }} />}
  </>}</section>;
}
function Objets({ onglet, id, appel, revision, peut, utilisateur, mutation, busy }) {
  const [page, setPage] = useState(1), [edition, setEdition] = useState(null), [form, setForm] = useState({});
  const etat = useLecture(appel, `${onglet}.lister`, { filtres: { compte_id: id, page, limite: 20, tri: onglet === 'activites' ? 'created_at' : 'updated_at', sens: 'desc' } }, revision);
  const changer = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const ouvrir = row => { setEdition(row || {}); setForm(row ? { ...row, ...(onglet === 'activites' ? { echeance: row.echeance ? new Date(new Date(row.echeance).getTime() - new Date(row.echeance).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '' } : {}) } : onglet === 'activites' ? { type: 'appel', titre: '', assigne_email: utilisateur.email, statut: 'a_faire' } : onglet === 'contacts' ? { nom: '', prenom: '', fonction: 'autre', principal: false } : { titre: '', etape: 'a_qualifier' }); };
  async function sauver(e) {
    e.preventDefault();
    const champs = onglet === 'contacts' ? ['nom','prenom','fonction','telephone','mobile','email','principal'] : onglet === 'activites' ? ['titre','type','echeance','assigne_email','notes','statut'] : ['titre','etape','montant_mensuel_estime','probabilite','date_visee','motif_perte'];
    const donnees = Object.fromEntries(champs.filter(k => form[k] !== undefined).map(k => [k, form[k] === '' ? null : k === 'echeance' && form[k] ? new Date(form[k]).toISOString() : ['montant_mensuel_estime','probabilite'].includes(k) && form[k] != null ? Number(form[k]) : form[k]]));
    if (!edition.id) donnees.compte_id = id;
    if (await mutation(`${onglet}.${edition.id ? 'modifier' : 'creer'}`, donnees, edition.id ? edition : null)) { setEdition(null); setPage(1); }
  }
  const input = (k, label, type = 'text', required = false) => <Champ key={k} label={label} type={type} required={required} value={form[k] ?? ''} onChange={e => changer(k,e.target.value)} />;
  return <><div className="crm-actions">{peut(onglet, 'creer') && <button onClick={() => ouvrir(null)}>Ajouter {onglet === 'activites' ? 'une activité' : onglet === 'contacts' ? 'un contact' : 'une opportunité'}</button>}</div>
    {edition && <form className="crm-form" onSubmit={sauver}><h3>{edition.id ? 'Modifier' : 'Ajouter'}</h3><div className="crm-grille">
      {onglet === 'contacts' ? <>{input('nom','Nom','text',true)}{input('prenom','Prénom')}<Champ label="Fonction"><select value={form.fonction} onChange={e => changer('fonction',e.target.value)}>{['titulaire','cotitulaire','adjoint','preparateur','acheteur','comptable','autre'].map(v => <option key={v}>{v}</option>)}</select></Champ>{input('telephone','Téléphone','tel')}{input('mobile','Mobile','tel')}{input('email','E-mail','email')}<label><input type="checkbox" checked={form.principal} onChange={e => changer('principal',e.target.checked)} />Contact principal</label></> : <>{input('titre','Objet','text',true)}{onglet === 'activites' ? <><Champ label="Type"><select value={form.type} onChange={e => changer('type',e.target.value)}>{['appel','visite','note','tache','email','rendez_vous'].map(v => <option key={v} value={v}>{({ tache:'Tâche', rendez_vous:'Rendez-vous' })[v] || v}</option>)}</select></Champ>{input('echeance','Échéance','datetime-local')}{input('assigne_email','Personne assignée (e-mail)','email')}<Champ label="Notes"><textarea value={form.notes || ''} onChange={e => changer('notes',e.target.value)} /></Champ></> : <><Champ label="Étape"><select value={form.etape} onChange={e => changer('etape',e.target.value)}>{Object.entries(ETAPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></Champ>{input('montant_mensuel_estime','Montant mensuel estimé (€)','number')}{input('probabilite','Probabilité (%)','number')}{input('date_visee','Date visée','date')}{form.etape === 'perdue' && <Champ label="Motif de perte"><textarea required value={form.motif_perte || ''} onChange={e => changer('motif_perte',e.target.value)} /></Champ>}</>}</>}
    </div><div className="crm-actions"><button disabled={busy}>Enregistrer</button><button type="button" onClick={() => setEdition(null)}>Annuler</button></div></form>}
    <Etat etat={etat} />{etat.donnees && <>{!etat.donnees.lignes.length && <Vide />}
      <ol className="crm-liste">{etat.donnees.lignes.map(r => <li key={r.id}><div><strong>{onglet === 'contacts' ? `${r.prenom || ''} ${r.nom}` : r.titre}</strong>
        {onglet === 'activites' && <><p>{r.type} · {dateFr(r.realise_at || r.created_at)} · {r.statut === 'fait' ? 'Terminé' : r.statut === 'annule' ? 'Annulé' : 'À faire'}</p><p>Échéance : {dateFr(r.echeance)} · Assigné à {r.assigne_email || 'personne'}</p><p className="crm-notes">{r.notes || r.resultat}</p></>}
        {onglet === 'contacts' && <><p>{r.fonction}{r.principal ? ' · Contact principal' : ''}</p><div className="crm-actions">{[r.telephone,r.mobile].filter(Boolean).map((tel,j) => <a key={j} href={`tel:${tel}`}>{tel}</a>)}{r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}</div></>}
        {onglet === 'opportunites' && <p>{ETAPES[r.etape]} · {euros(r.montant_mensuel_estime)} / mois · {dateFr(r.date_visee)}</p>}</div>
        <div className="crm-actions">{peut(onglet,'modifier',r) && <button onClick={() => ouvrir(r)}>Modifier{onglet === 'opportunites' ? ' l’étape' : ''}</button>}{onglet === 'activites' && r.statut !== 'fait' && peut(onglet,'terminer',r) && <button disabled={busy} onClick={() => mutation('activites.terminer',{},r)}>Terminer</button>}</div></li>)}</ol><Pagination page={page} limite={20} total={etat.donnees.total} changer={setPage} /></>}
  </>;
}
function Indicateurs({ i }) {
  if (!i) return <Vide>Aucun instantané disponible.</Vide>;
  const mois = i.ca_mois || [], max = Math.max(1, ...mois.map(m => m.ca));
  return <><h3>CA des 13 derniers mois</h3><svg className="crm-chart" viewBox="0 0 650 190" role="img" aria-label="Chiffre d’affaires par mois, valeurs détaillées ci-dessous">{mois.map((m,j) => <g key={m.mois}><title>{m.mois} : {euros(m.ca)}</title><rect x={j * 50 + 6} y={150 - Math.max(0,m.ca) / max * 130} width="32" height={Math.max(0,m.ca) / max * 130} rx="3" /><text x={j * 50 + 22} y="175" textAnchor="middle">{m.mois.slice(2)}</text></g>)}</svg><details><summary>Valeurs mensuelles</summary><dl>{mois.map(m => <div key={m.mois}><dt>{m.mois}</dt><dd>{euros(m.ca)}</dd></div>)}</dl></details>
    <h3>Familles</h3><dl>{[['Fond de rayon', i.ca - i.cher - i.mj - i.glp], ['Spécialités chères',i.cher], ['Mounjaro',i.mj], ['Autres GLP-1',i.glp]].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{euros(v)}</dd></div>)}</dl><h3>Produits non servis</h3>{!i.non_servis?.length ? <Vide>Aucun produit non servi.</Vide> : <ul>{i.non_servis.map(p => <li key={p.produit_id}>{p.nom || p.produit || p.produit_id} · {euros(p.valeur)}</li>)}</ul>}</>;
}
function Documents({ appel, id, onglet }) {
  const etat = useLecture(appel, `comptes.${onglet}`, { id });
  return <><p>{onglet === 'commandes' ? 'Les 50 dernières commandes du site.' : 'Factures et avoirs validés des 12 derniers mois.'}</p><Etat etat={etat} />{etat.donnees && (!etat.donnees.length ? <Vide>Aucun document disponible.</Vide> : <div className="crm-table"><table><thead><tr><th>Numéro</th><th>Date</th><th>Type / résumé</th><th>Montant HT</th><th>État</th></tr></thead><tbody>{etat.donnees.map(r => <tr key={r.id}><td>{r.numero || r.id}</td><td>{dateFr(r.date)}</td><td>{onglet === 'commandes' ? `${r.lignes ?? '—'} lignes` : r.type === 'out_refund' ? 'Avoir' : 'Facture'}</td><td>{euros(r.montant_ht)}</td><td>{onglet === 'commandes' ? r.traite ? 'Traitée' : 'En attente' : r.envoye ? 'Envoyée' : 'Non envoyée'}</td></tr>)}</tbody></table></div>)}</>;
}
function Informations({ c, peut, mutation, busy, utilisateur }) {
  const [form, setForm] = useState({ ...c, etiquettes:(c.etiquettes || []).join(', ') }), [commercial, setCommercial] = useState(c.commercial_email || '');
  const propre = ['notes','etiquettes','groupement','logiciel','email'], odoo = ['nom','cip','siret','adresse','code_postal','ville','telephone','statut','source'];
  const labels = { notes:'Notes', etiquettes:'Étiquettes (séparées par des virgules)', groupement:'Groupement', logiciel:'Logiciel', email:'E-mail', nom:'Nom', cip:'CIP', siret:'SIRET', adresse:'Adresse', code_postal:'Code postal', ville:'Ville', telephone:'Téléphone', statut:'Statut', source:'Source', finess:'FINESS' };
  const editable = peut('comptes','modifier',c), champs = c.odoo_id ? propre : [...odoo,'finess',...propre];
  async function sauver(e) { e.preventDefault(); const d = {}; for (const k of champs) { if (k === 'statut' && utilisateur.role !== 'admin') continue; const valeur = k === 'etiquettes' ? form[k].split(',').map(v => v.trim()).filter(Boolean) : form[k] === '' ? null : form[k]; if (JSON.stringify(valeur) !== JSON.stringify(c[k] ?? null)) d[k] = valeur; } if (Object.keys(d).length) await mutation('comptes.modifier',d,c); }
  return <><p>Département : {c.departement || '—'}{c.odoo_id ? ' · Odoo' : ' (déduit du code postal)'}</p><form className="crm-form" onSubmit={sauver}><div className="crm-grille">{[...odoo,'finess',...propre].map(k => {
    const lecture = !editable || !champs.includes(k) || k === 'statut' && utilisateur.role !== 'admin';
    const value = form[k] || '';
    return <Champ key={k} label={`${labels[k]}${c.odoo_id && odoo.includes(k) ? ' · Odoo' : ''}`}>{k === 'statut' || k === 'source' ? <select disabled={lecture} value={value} onChange={e => setForm({ ...form,[k]:e.target.value })}>{Object.entries(k === 'statut' ? STATUTS : c.odoo_id ? { odoo:'Odoo' } : { saisie:'Saisie',annuaire:'Annuaire' }).map(([a,b]) => <option key={a} value={a}>{b}</option>)}</select> : k === 'notes' ? <textarea readOnly={lecture} value={value} onChange={e => setForm({ ...form,[k]:e.target.value })} /> : <input readOnly={lecture} type={k === 'email' ? 'email' : 'text'} value={value} onChange={e => setForm({ ...form,[k]:e.target.value })} />}</Champ>;
  })}</div>{editable && <button disabled={busy}>Enregistrer les informations</button>}</form>
    {peut('comptes','attribuer',c) && <form className="crm-actions" onSubmit={e => { e.preventDefault(); mutation('comptes.attribuer',{ commercial_email:commercial || null },c); }}><Champ label="Commercial (e-mail)" type="email" value={commercial} onChange={e => setCommercial(e.target.value)} /><button disabled={busy}>Attribuer</button></form>}
    {peut('comptes','archiver',c) && <button disabled={busy} onClick={() => mutation('comptes.archiver',{ archive:!c.archive },c)}>{c.archive ? 'Désarchiver' : 'Archiver'} le compte</button>}
  </>;
}
