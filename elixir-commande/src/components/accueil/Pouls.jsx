// ── Le « pouls » : courbe des commandes servies par jour sur 15 jours, normalisée (la forme, jamais les chiffres) ──
// Ordinateur : 240 × 44, aire menthe, courbe sarcelle, dernier jour (en cours) en pointillé, role="img" avec un libellé
// sans chiffre. Mobile : ligne fine de 24 px, décorative. Tracé à l'arrivée (stroke-dashoffset), sauf mouvement réduit.
import React, { useLayoutEffect, useRef } from "react";
import { anime } from "./outils.js";

// courbe lissée (Catmull-Rom → Bézier), bornée à la hauteur utile
function chemin(pts, haut, bas) {
  if (pts.length < 2) return "";
  const borne = (y) => Math.min(bas, Math.max(haut, y));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, borne(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, borne(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export default function Pouls({ serie = [], fin = false, tracer = true, delai = 0, duree = 500, libelle }) {
  const trait = useRef(null);
  const L = fin ? 300 : 240, H = fin ? 24 : 44, marge = fin ? 3 : 5;
  const n = serie.length;
  const pts = serie.map((v, i) => [i * (L / Math.max(1, n - 1)), H - marge - (Number(v) || 0) * (H - 2 * marge)]);
  const plein = chemin(pts.slice(0, Math.max(2, n - 1)), marge, H - marge);
  const dernier = n >= 2 ? `M${pts[n - 2][0].toFixed(1)},${pts[n - 2][1].toFixed(1)}L${pts[n - 1][0].toFixed(1)},${pts[n - 1][1].toFixed(1)}` : "";
  useLayoutEffect(() => {
    const el = trait.current;
    if (!tracer || !el || typeof el.getTotalLength !== "function") return undefined;
    const lg = el.getTotalLength();
    const a = anime(el, [{ strokeDasharray: lg, strokeDashoffset: lg }, { strokeDasharray: lg, strokeDashoffset: 0 }], { duration: duree, delay: delai, easing: "ease-in-out" });
    return () => a?.cancel();
  }, [tracer, plein, delai, duree]);
  if (n < 2) return null;
  return (
    <svg className={fin ? "acc-pouls acc-pouls--fin" : "acc-pouls"} viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" focusable="false"
      {...(libelle ? { role: "img", "aria-label": libelle } : { "aria-hidden": true })}>
      {!fin && <path className="acc-pouls-aire" d={`${plein}L${pts[n - 2][0].toFixed(1)},${H}L0,${H}Z`} />}
      <path ref={trait} className="acc-pouls-trait" d={plein} />
      <path className="acc-pouls-encours" d={dernier} />
    </svg>
  );
}
