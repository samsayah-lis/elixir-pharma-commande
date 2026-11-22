import { useEffect, useMemo, useState } from 'react';
import { creerClient, lireSession, peutAfficher, prechargerEcran } from './client';
import Comptes from './Comptes';
import FicheCompte from './FicheCompte';
import { Champ } from './ui';
import { Accueil, Contacts, Activites } from './Quotidien';
import { Opportunites, TableauBord } from './Pilotage';
import { Equipe, Reglages } from './Administration';
import './crm.css';
const ADRESSES = { Accueil:'', Comptes:'comptes', Contacts:'contacts', Opportunités:'opportunites', Activités:'activites', 'Tableau de bord':'tableau', Équipe:'equipe', Réglages:'reglages' };
const lireRubrique = integre => integre ? window.history.state?.crmRubrique || (window.history.state?.crmCompte ? 'Comptes' : 'Accueil') : window.location.hash.startsWith('#crm/compte/') ? 'Comptes' : Object.keys(ADRESSES).find(k => `#crm${ADRESSES[k] ? '/' + ADRESSES[k] : ''}` === window.location.hash) || 'Accueil';
const lireAdresse = integre => integre ? window.history.state?.crmCompte || null : /^#crm\/compte\/([\w-]+)$/.exec(window.location.hash)?.[1] || null;
export default function CrmApp({ adminFetch }) {
  const integre = !!adminFetch;
  const [session, setSession] = useState(lireSession), [moi, setMoi] = useState(null), [erreur, setErreur] = useState(''), [essai, setEssai] = useState(0);
  const [id, setId] = useState(() => lireAdresse(integre)), [rubrique, setRubrique] = useState(() => lireRubrique(integre));
  const client = useMemo(() => creerClient({ adminFetch, onSession:s => { setSession(s); setMoi(null); } }), [adminFetch]);
  const appel = useMemo(() => Object.assign((action, params) => client.appel(action, params), {memoire:client.memoire}), [client]);
  useEffect(() => {
    const lire = () => { setId(lireAdresse(integre)); setRubrique(lireRubrique(integre)); };
    window.addEventListener('hashchange', lire); window.addEventListener('popstate', lire);
    return () => { window.removeEventListener('hashchange',lire); window.removeEventListener('popstate',lire); };
  }, [integre]);
  useEffect(() => {
    if (!integre && !session) return;
    let actif = true;
    appel('moi').then(d => { if (actif) { setMoi(d); setErreur(''); prechargerEcran(appel,'Accueil'); prechargerEcran(appel,'Tableau de bord'); } }, e => { if (actif) setErreur(e.message); });
    return () => { actif = false; };
  }, [appel, integre, session, essai]);
  function naviguer(rubrique, compte = null) {
    setRubrique(rubrique); setId(compte);
    if (integre) window.history.pushState({ ...window.history.state, crmCompte:compte, crmRubrique:rubrique }, '', window.location.href);
    else window.location.hash = compte ? `#crm/compte/${compte}` : `#crm${ADRESSES[rubrique] ? '/' + ADRESSES[rubrique] : ''}`;
  }
  const ouvrir = compte => naviguer('Comptes',compte);
  async function actualiserIdentite() { try { setMoi(await appel('moi')); } catch(e) { setMoi(null);setErreur(e.message); } }
  if (!integre && !session) return <div className="crm"><Connexion client={client} /></div>;
  if (!moi) return <div className="crm"><p role={erreur ? 'alert' : 'status'}>{erreur || 'Ouverture du CRM…'}</p>{erreur && <button onClick={() => setEssai(v => v + 1)}>Réessayer</button>}{!integre && <button onClick={() => { setMoi(null); client.deconnexion(); }}>Déconnexion</button>}</div>;
  const peut = (ressource, action, ligne) => peutAfficher(moi.droits,moi.utilisateur,ressource,action,ligne);
  return <div className="crm"><div className="crm-coquille"><aside className="crm-sidebar"><strong>📇 CRM</strong><small>{moi.utilisateur.email}<br />{({ admin:'Administration',commercial:'Commercial',service_client:'Service client',lecture:'Lecture seule' })[moi.utilisateur.role]}</small><nav aria-label="Navigation CRM">{['Accueil','Comptes','Contacts','Opportunités','Activités','Tableau de bord',...(peut('equipe','lister') ? ['Équipe','Réglages'] : [])].map(r => <button key={r} aria-current={rubrique === r ? 'page' : undefined} onMouseEnter={() => prechargerEcran(appel,r)} onFocus={() => prechargerEcran(appel,r)} onClick={() => naviguer(r)}>{r}</button>)}</nav>{!integre && <button onClick={() => { setMoi(null); client.deconnexion(); }}>Déconnexion</button>}</aside>
    <main className="crm-main">
      {rubrique === 'Comptes' ? id ? <FicheCompte entrepotUrl={moi.entrepot_url} key={id} {...{ id, appel, peut }} utilisateur={moi.utilisateur} retour={() => ouvrir(null)} /> : <Comptes {...{ appel, ouvrir }} utilisateur={moi.utilisateur} /> :
        rubrique === 'Contacts' ? <Contacts {...{ appel, peut, ouvrir }} utilisateur={moi.utilisateur} /> :
        rubrique === 'Opportunités' ? <Opportunites {...{ appel, peut, ouvrir }} utilisateur={moi.utilisateur} /> :
        rubrique === 'Activités' ? <Activites {...{ appel, peut, ouvrir }} utilisateur={moi.utilisateur} /> :
        rubrique === 'Tableau de bord' ? <TableauBord {...{ appel, peut }} /> :
        rubrique === 'Équipe' && peut('equipe','lister') ? <Equipe {...{ appel, actualiserIdentite }} utilisateur={moi.utilisateur} /> :
        rubrique === 'Réglages' && peut('reglages','lire') ? <Reglages appel={appel} /> :
        <Accueil {...{ appel, peut, ouvrir }} utilisateur={moi.utilisateur} />}
    </main>
  </div></div>;
}
function Connexion({ client }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy,setBusy] = useState(false), [erreur,setErreur] = useState('');
  async function connecter(e) { e.preventDefault(); setBusy(true); setErreur(''); try { await client.connexion(email,password); } catch (e) { setErreur(e.message); } finally { setBusy(false); } }
  return <div className="crm-connexion"><form onSubmit={connecter}><small>ESPACE ÉQUIPE</small><h1>📇 CRM</h1><p>Connectez-vous avec votre compte CRM.</p><Champ label="Adresse e-mail" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /><Champ label="Mot de passe" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><p role="alert">{erreur}</p><button disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button></form></div>;
}
