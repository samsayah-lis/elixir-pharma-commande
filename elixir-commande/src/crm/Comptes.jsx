import { useState } from 'react';
import { STATUTS, dateFr, pourcent, lirePreferences, garderPreferences, csvPage } from './client';
import { Champ, Etat, Pagination, Vide, euros, useLecture } from './ui';
const OPTIONS = {
  profil:['A – Panier large','B – Spécialités seules','C – Intermédiaire','D – Occasionnelle','E – Sans achat depuis 30 jours'],
  action_proposee:['1 – Rappeler : aucun achat depuis 30 jours','1 – Rappeler : achats en baisse de plus de moitié','2 – Accueil : cliente depuis moins de deux mois','3 – Élargir le panier (spécialités seules)','4 – Élargir le panier et les spécialités','5 – Réveiller (moins de 2 500 € par mois)','6 – Entretenir et servir les demandes non servies','7 – Hors territoire : à décider'],
};
const COLONNES = [
  { key: 'nom', label: 'Compte' }, { key: 'ville', label: 'Ville' }, { key: 'statut', label: 'Statut', export: r => STATUTS[r.statut] },
  { key: 'ca', label: 'CA 30 jours', export: r => euros(r.ca) }, { key: 'evolution', label: 'Évolution', export: r => pourcent(r.evolution) },
  { key: 'non_servi', label: 'Non servi', export: r => euros(r.non_servi) }, { key: 'profil', label: 'Profil' },
  { key: 'action_proposee', label: 'Action proposée' }, { key: 'commercial_email', label: 'Commercial', sansTri: true },
  { key: 'derniere_activite', label: 'Dernière activité', export: r => dateFr(r.derniere_activite) },
];
export default function Comptes({ appel, utilisateur, ouvrir }) {
  const [prefs, setPrefs] = useState(() => lirePreferences(utilisateur.id));
  const [colonnes, setColonnes] = useState(() => prefs.colonnes || COLONNES.map(c => c.key));
  const [filtres, setFiltres] = useState({});
  const [brouillon, setBrouillon] = useState({});
  const [tri, setTri] = useState({ tri: 'nom', sens: 'asc' });
  const [page, setPage] = useState(1);
  const [nomVue, setNomVue] = useState('');
  const [message, setMessage] = useState('');
  const etat = useLecture(appel, 'comptes.lister', { filtres: { ...filtres, ...tri, page, limite: 20 } });
  const cs = COLONNES.filter(c => colonnes.includes(c.key));
  const sauver = p => { setPrefs(p); setMessage(garderPreferences(utilisateur.id, p) ? 'Préférences enregistrées.' : 'Stockage local indisponible : préférences conservées pour cette session.'); };
  function filtrer(e) { e.preventDefault(); setPage(1); setFiltres(Object.fromEntries(Object.entries(brouillon).filter(([,v]) => v !== ''))); }
  function exporter() {
    const url = URL.createObjectURL(new Blob([csvPage(etat.donnees?.lignes || [], cs)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'comptes-crm.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section><header className="crm-titre"><div><small>PORTEFEUILLE</small><h1>Comptes</h1></div><button onClick={exporter} disabled={!etat.donnees?.lignes.length}>Exporter cette page</button></header>
    <form className="crm-filtres" onSubmit={filtrer}>
      {['recherche', 'departement', 'commercial_email'].map(k => <Champ key={k} label={({ recherche: 'Nom, ville, CIP ou FINESS', departement: 'Département', commercial_email: 'Commercial (e-mail)', profil: 'Profil', action_proposee: 'Action proposée' })[k]} value={brouillon[k] || ''} onChange={e => setBrouillon({ ...brouillon, [k]: e.target.value })} />)}
      {Object.entries(OPTIONS).map(([k, options]) => <Champ key={k} label={k === 'profil' ? 'Profil' : 'Action proposée'}><select value={brouillon[k] || ''} onChange={e => setBrouillon({ ...brouillon, [k]:e.target.value })}><option value="">Tous</option>{options.map(v => <option key={v}>{v}</option>)}</select></Champ>)}
      <Champ label="Source"><select value={brouillon.source || ''} onChange={e => setBrouillon({ ...brouillon, source:e.target.value })}><option value="">Toutes</option><option value="annuaire">Annuaire Santé</option><option value="odoo">Odoo</option><option value="saisie">Saisie</option></select></Champ><Champ label="Statut"><select value={brouillon.statut || ''} onChange={e => setBrouillon({ ...brouillon, statut: e.target.value })}><option value="">Tous</option>{Object.entries(STATUTS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></Champ>
      <label><input type="checkbox" checked={brouillon.commercial_email === utilisateur.email} onChange={e => setBrouillon({ ...brouillon, commercial_email: e.target.checked ? utilisateur.email : '' })} /> Mes comptes</label><button>Appliquer les filtres</button><button type="button" onClick={() => { setFiltres({}); setBrouillon({}); setPage(1); }}>Réinitialiser</button>
    </form>
    <details><summary>Colonnes et vues enregistrées</summary><div className="crm-actions">{COLONNES.map(c => <label key={c.key}><input type="checkbox" checked={colonnes.includes(c.key)} disabled={c.key === 'nom'} onChange={e => { const cols = e.target.checked ? [...colonnes, c.key] : colonnes.filter(k => k !== c.key); setColonnes(cols); sauver({ ...prefs, colonnes: cols }); }} />{c.label}</label>)}</div>
      <div className="crm-actions"><Champ label="Nom de la vue" value={nomVue} maxLength={80} onChange={e => setNomVue(e.target.value)} /><button disabled={!nomVue.trim()} onClick={() => sauver({ ...prefs, vues: { ...prefs.vues, [nomVue.trim()]: { filtres, tri, colonnes } } })}>Enregistrer la vue</button>
        {Object.entries(prefs.vues || {}).map(([nom, v]) => <span key={nom}><button onClick={() => { setFiltres(v.filtres); setBrouillon(v.filtres); setTri(v.tri); setColonnes(v.colonnes); setPage(1); }}>{nom}</button><button aria-label={`Supprimer la vue ${nom}`} onClick={() => sauver({ ...prefs, vues: Object.fromEntries(Object.entries(prefs.vues).filter(([k]) => k !== nom)) })}>×</button></span>)}</div>
    </details><p role="status">{message}</p><Etat etat={etat} />
    {etat.donnees && <><div className="crm-table"><table><caption className="crm-sr">Liste des comptes</caption><thead><tr>{cs.map(c => <th key={c.key} aria-sort={tri.tri === c.key ? tri.sens === 'asc' ? 'ascending' : 'descending' : undefined}>{c.sansTri ? c.label : <button onClick={() => { setTri({ tri: c.key, sens: tri.tri === c.key && tri.sens === 'asc' ? 'desc' : 'asc' }); setPage(1); }}>{c.label}{tri.tri === c.key ? tri.sens === 'asc' ? ' ↑' : ' ↓' : ''}</button>}</th>)}</tr></thead><tbody>{etat.donnees.lignes.map(r => <tr key={r.id}>{cs.map(c => <td key={c.key}>{c.key === 'nom' ? <a href={`#crm/compte/${r.id}`} onClick={e => { e.preventDefault(); ouvrir(r.id); }}>{r.nom}</a> : c.export ? c.export(r) : r[c.key] || '—'}</td>)}</tr>)}</tbody></table></div>{!etat.donnees.lignes.length && <Vide>Aucun compte ne correspond à ces filtres.</Vide>}<Pagination page={page} limite={20} total={etat.donnees.total} changer={setPage} /></>}
  </section>;
}
