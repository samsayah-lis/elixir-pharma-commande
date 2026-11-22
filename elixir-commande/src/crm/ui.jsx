import { useEffect, useState } from 'react';
export function useLecture(appel, action, params, revision = 0) {
  const cle = JSON.stringify(params);
  const [etat, setEtat] = useState({ chargement: true });
  useEffect(() => {
    let actif = true;
    setEtat({ chargement: true });
    appel(action, JSON.parse(cle)).then(d => { if (actif) setEtat({ donnees: d.donnees }); }, e => { if (actif) setEtat({ erreur: e.message }); });
    return () => { actif = false; };
  }, [appel, action, cle, revision]);
  return etat;
}
export function Etat({ etat }) { return etat.chargement ? <p role="status">Chargement…</p> : etat.erreur ? <p role="alert" className="crm-erreur">{etat.erreur}</p> : null; }
export function Champ({ label, children, ...props }) { return <label className="crm-champ"><span>{label}</span>{children || <input {...props} />}</label>; }
export function Pagination({ page, total, limite, changer }) { return <div className="crm-actions"><button disabled={page <= 1} onClick={() => changer(page - 1)}>Précédent</button><span>Page {page} / {Math.max(1, Math.ceil(total / limite))} · {total} résultats</span><button disabled={page * limite >= total} onClick={() => changer(page + 1)}>Suivant</button></div>; }
export function Vide({ children = 'Aucun élément pour le moment.' }) { return <p className="crm-vide">{children}</p>; }
export const euros = n => n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
