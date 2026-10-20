// ── Fin d'une mise en avant : date, jours restants, puis compte à rebours (docs/accueil.md § 7) ──
// Fin = jour inclus (heure de Paris) : la cible est le minuit suivant. Pas de fausse urgence : plus de 7 jours → « Jusqu'au
// 31 octobre » ; 2 à 7 jours → « Plus que 5 jours » ; moins de 48 h → « Se termine dans 1 j 14 h 05 min » (minutes qui
// roulent) ; moins d'une heure → minutes et secondes (secondes : vitrine cinéma seulement). Composant isolé : seul son texte
// se redessine, et seulement quand « actif » (salle à l'écran, onglet affiché). Ligne animée aria-hidden, texte fixe lu.
import React, { useEffect, useState } from "react";
import { Icone } from "../../icons.jsx";
import Rouleau from "./Rouleau.jsx";
import { dateTexte, rebours } from "./vedettes.js";

const J = 864e5, H = 3600e3;

export default function Rebours({ fin, actif = true, secondes = true, onFin, classe = "", balise: Balise = "p" }) {
  const [t, setT] = useState(() => Date.now());
  const r = fin ? rebours(fin, t, secondes) : null;
  useEffect(() => {
    if (!r || !actif) return undefined;
    if (r.mode === "fini") { onFin?.(); return undefined; }
    const maintenant = Date.now(), reste = r.reste;
    // prochaine mise à jour : la seconde, la minute, ou le passage d'un seuil (7 jours, 48 h, minuit de Paris)
    const pas = reste < H && secondes ? 1000 - (maintenant % 1000) : reste < 48 * H ? 60e3 - (maintenant % 60e3)
      : Math.min(reste - 48 * H, reste > 7 * J ? reste - 7 * J : (reste % J) || J);
    const id = setTimeout(() => setT(Date.now()), Math.max(50, Math.min(pas + 20, 2 ** 31 - 1)));
    return () => clearTimeout(id);
  }, [t, actif, fin]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (actif) setT(Date.now()); }, [actif]);
  if (!r) return null;
  const lu = <span className="acc-vh">Offre valable jusqu’au {dateTexte(fin, { semaine: true })} inclus</span>;
  const rendu = r.mode === "date" ? <span className="mea-fin-texte"><Icone nom="horloge" taille={14} />Jusqu’au {dateTexte(fin)}</span>
    : r.mode === "jours" ? <span className="mea-fin-texte mea-fin--proche"><Icone nom="horloge" taille={14} />Plus que {r.n} jours</span>
    : r.mode === "puces" ? (
      <span className="mea-fin-texte mea-fin--rebours"><Icone nom="horloge" taille={14} />Se termine dans
        {r.puces.map(([v, u]) => <span key={u} className="mea-puce-temps num"><b><Rouleau texte={String(v)} decalage={30} /></b>{u}</span>)}
      </span>
    ) : null;
  return <Balise className={`mea-fin ${classe}`}><span aria-hidden="true">{rendu}</span>{lu}</Balise>;
}
