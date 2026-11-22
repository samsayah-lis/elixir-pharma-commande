import { useEffect, useState } from 'react';
export function useLecture(appel, action, params, revision = 0) {
  const cle = JSON.stringify(params);
  const cache=()=>{const e=appel.memoire?.lire(action,params);return e?{donnees:e.valeur.donnees,maj:e.date}:null;};
  const [etat, setEtat] = useState(()=>cache() || { chargement: true });
  useEffect(() => {
    let actif = true;
    const e=appel.memoire?.lire(action,JSON.parse(cle));
    setEtat(v=>({...v,...(e?{donnees:e.valeur.donnees,maj:e.date}:{}),chargement:!e && !v.donnees,rafraichissement:true}));
    appel(action, JSON.parse(cle)).then(d => { if (actif) setEtat({ donnees: d.donnees,maj:Date.now() }); }, e => { if (actif) setEtat(v=>({...v,chargement:false,rafraichissement:false,erreur:e.message})); });
    return () => { actif = false; };
  }, [appel, action, cle, revision]);
  return etat;
}
export function Etat({ etat }) { return etat.chargement ? <p role="status">Chargement…</p> : etat.erreur ? <p role="alert" className="crm-erreur">{etat.erreur}</p> : etat.maj ? <small role="status">Mis à jour à {new Date(etat.maj).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}{etat.rafraichissement?' · Actualisation…':''}</small> : null; }
export function Champ({ label, children, ...props }) { return <label className="crm-champ"><span>{label}</span>{children || <input {...props} />}</label>; }
export function Pagination({ page, total, limite, changer }) { return <div className="crm-actions"><button disabled={page <= 1} onClick={() => changer(page - 1)}>Précédent</button><span>Page {page} / {Math.max(1, Math.ceil(total / limite))} · {total} résultats</span><button disabled={page * limite >= total} onClick={() => changer(page + 1)}>Suivant</button></div>; }
export function Vide({ children = 'Aucun élément pour le moment.' }) { return <p className="crm-vide">{children}</p>; }
export const euros = n => n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
