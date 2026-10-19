// ── Compteur mécanique (rang, prix) : chaque chiffre est une bande 0–9 qui roule jusqu'à sa valeur ──
// Décoratif (aria-hidden) : le texte réel est porté à côté (visually-hidden). Roule de droite à gauche (décalage par
// chiffre) ; nombre de caractères changé → simple fondu (nouvelles colonnes). Mouvement réduit : la règle globale de
// tokens.css ramène la transition à 0,01 ms (changement instantané).
import React from "react";

const CHIFFRES = "0123456789".split("");

export default function Rouleau({ texte, className = "", decalage = 18 }) {
  const car = [...String(texte ?? "")];
  return (
    <span key={car.length} className={`acc-rouleau ${className}`} aria-hidden="true">
      {car.map((c, i) => (/\d/.test(c) ? (
        <span key={i} className="acc-rouleau-col">
          <span className="acc-rouleau-bande" style={{ transform: `translateY(${-Number(c) * 10}%)`, transitionDelay: `${(car.length - 1 - i) * decalage}ms` }}>
            {CHIFFRES.map(d => <span key={d}>{d}</span>)}
          </span>
        </span>
      ) : <span key={i} className="acc-rouleau-fixe">{c}</span>))}
    </span>
  );
}
