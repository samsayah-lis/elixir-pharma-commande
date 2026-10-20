// ── La grille « À la une » (bento) : une grande tuile et 1 à 4 petites, sous la vitrine cinéma (docs/accueil.md § 7) ──
// Placement fixe selon le nombre de tuiles et la largeur (format s < 768 px, m < 1 280 px, l), la première en grand.
// Tuile produit : <article> (nom en h3), deux vrais boutons (« Ajouter » par BoutonLot, « Voir dans … »), pas de lien
// étiré. Tuile menu : un <button> entier (nom accessible : nom, références, « dès », remise, « voir le menu »).
// Pointeur fin seulement : bordure lumineuse qui tourne (pseudo-élément conique tourné, sans @property), relief qui suit
// le pointeur (±3 à ±4°, lissé), projecteur (tache déplacée par transform). Entrée en cascade une fois par chargement.
// Mouvement réduit : filet or clair fixe au survol et au focus, rien d'autre ; tactile : pression seulement.
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Icone } from "../../icons.jsx";
import { fmtEur, fmtPct } from "../../theme.js";
import Boite from "./Boite.jsx";
import BoutonLot from "./BoutonLot.jsx";
import Rebours from "./Rebours.jsx";
import Eventail from "./Eventail.jsx";
import { RESSORT, anime, photo, photoReconnue } from "./outils.js";
import { dateTexte, prixLu, resumeMenuLu } from "./vedettes.js";

let cascadeJouee = false;
// [colonnes, rangées] de chaque tuile et variante : g grande, b bandeau, c large compacte, p petite
const PLAN = {
  l: { 1: "4.1b", 2: "3.1b 1.1p", 3: "2.2g 2.1c 2.1c", 4: "2.2g 2.1c 1.1p 1.1p", 5: "2.2g 1.1p 1.1p 1.1p 1.1p" },
  m: { 1: "6.1b", 2: "4.1b 2.1p", 3: "4.2g 2.1c 2.1c", 4: "6.1b 2.1p 2.1p 2.1p", 5: "6.1b 3.1c 3.1c 3.1c 3.1c" },
  s: { 1: "2.1g", 2: "2.1g 2.1c", 3: "2.1g 1.1p 1.1p", 4: "2.1g 1.1p 1.1p 2.1c", 5: "2.1g 1.1p 1.1p 1.1p 1.1p" },
};
const VARIANTE = { g: "grande", b: "bandeau", c: "large", p: "petite" };
export const plan = (n, format) => (PLAN[format] || PLAN.l)[Math.max(1, Math.min(5, n))].split(" ").map(x => { const [c, r] = x.slice(0, -1).split("."); return { c: +c, r: +r, v: VARIANTE[x.slice(-1)] }; });
const varsTeinte = (e) => ({ "--mea-sombre": e.teintes.sombre, "--mea-claire": e.teintes.claire, "--mea-trait": e.teintes.trait });
const lot = (o) => (o.lot?.qte > 1 ? `${o.menu?.key === "stratege" ? "Carton" : "Lot"} de ${o.lot.qte}` : "1 boîte");

function Photo({ url, taille, teinte, offre }) {
  const [ko, setKo] = useState(false);
  if (url && !ko) return <img className="mea-tuile-photo" src={photo(url, taille)} srcSet={photoReconnue(url) ? `${photo(url, taille)} 1x, ${photo(url, "large")} 2x` : undefined}
    alt="" draggable={false} decoding="async" loading="lazy" onError={() => setKo(true)} />;
  return offre ? <span className="mea-tuile-boite"><Boite boite={offre.boite} cip={offre.cip} teinte={teinte} mode="25d" taille="carte" /></span> : null;
}

export default function Bento({ items, format = "l", reduit, finPointer, depart = 0, qteAuPanier = {}, pret = true, apercu = false,
  onAjouter, onModifier, onOuvrirPanier, onVoir, onExpire }) {
  const uid = useId().replace(/:/g, "");
  const liste = useRef(null);
  const vivant = finPointer && !reduit;
  const places = plan(items.length, format);

  // entrée en cascade (une fois par chargement) : tuiles visibles au montage après l'arrivée de la vitrine, les autres
  // quand la grille entre à l'écran (20 %) ; un tour de bordure lumineuse par tuile, même décalage
  useLayoutEffect(() => {
    if (cascadeJouee || reduit || apercu || !liste.current) return undefined;
    cascadeJouee = true;
    const tuiles = [...liste.current.querySelectorAll(".mea-tuile")];
    const jouer = (els, base) => els.forEach((t, i) => {
      anime(t, [{ transform: "translateY(28px) scale(.97)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 600, delay: base + i * 80, easing: RESSORT });
      // un tour de bordure lumineuse : animation CSS du pseudo-élément (classe retirée après le tour)
      t.style.setProperty("--mea-retard", `${base + i * 80}ms`);
      t.classList.add("mea-tour");
      setTimeout(() => t.classList.remove("mea-tour"), base + i * 80 + 1200);
    });
    const h = window.innerHeight;
    const visibles = tuiles.filter(t => t.getBoundingClientRect().top < h);
    jouer(visibles, depart);
    const autres = tuiles.filter(t => !visibles.includes(t));
    if (!autres.length) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([x]) => { if (x.intersectionRatio >= 0.2) { io.disconnect(); jouer(autres, 0); } }, { threshold: [0.2] });
    io.observe(liste.current);
    return () => io.disconnect();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // relief et projecteur : variables écrites dans un requestAnimationFrame (lissage 0,15), jamais de setState
  const relief = (t) => {
    const s = t.__mea;
    if (s.raf) return;
    const amp = t.dataset.amp === "3" ? 3 : 4;
    const pas = () => {
      s.x += (s.cx - s.x) * 0.15; s.y += (s.cy - s.y) * 0.15;
      const fin = s.cx === 0 && s.cy === 0 && Math.abs(s.x) < 0.003 && Math.abs(s.y) < 0.003;
      t.style.setProperty("--tx", fin ? "0deg" : `${(s.x * amp).toFixed(3)}deg`); t.style.setProperty("--ty", fin ? "0deg" : `${(-s.y * amp).toFixed(3)}deg`);
      t.style.setProperty("--px", fin ? "0" : s.x.toFixed(3)); t.style.setProperty("--py", fin ? "0" : s.y.toFixed(3));
      s.raf = fin ? 0 : requestAnimationFrame(pas);
    };
    s.raf = requestAnimationFrame(pas);
  };
  const survol = (ev) => {
    if (!vivant || ev.pointerType !== "mouse") return;
    const t = ev.currentTarget, r = t.getBoundingClientRect();
    const s = t.__mea || (t.__mea = { x: 0, y: 0, cx: 0, cy: 0, raf: 0 });
    s.cx = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1)); s.cy = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1));
    t.style.setProperty("--mx", `${(ev.clientX - r.left).toFixed(0)}px`); t.style.setProperty("--my", `${(ev.clientY - r.top).toFixed(0)}px`);
    relief(t);
  };
  const sortie = (ev) => { const t = ev.currentTarget; if (!t.__mea) return; t.__mea.cx = 0; t.__mea.cy = 0; relief(t); };

  return (
    <section className={`mea-grille-section mea-f-${format}`} aria-labelledby={`${uid}-titre`}>
      <h2 id={`${uid}-titre`} className="mea-grille-titre">À la une</h2>
      <ul role="list" ref={liste} className={`mea-grille mea-grille--${format}${vivant ? " mea-vivant" : ""}`}>
        {items.map((e, i) => {
          const p = places[i] || { c: 1, r: 1, v: "petite" };
          const props = { className: `mea-tuile mea-tuile--${p.v}${e.menu ? " mea-tuile--menu" : ""}`, style: varsTeinte(e), "data-amp": p.v === "grande" || p.v === "bandeau" ? "3" : "4",
            onPointerMove: survol, onPointerLeave: sortie };
          return (
            <li key={e.id} className="mea-place" style={{ gridColumn: `span ${p.c}`, gridRow: `span ${p.r}` }}>
              {e.menu ? <TuileMenu e={e} v={p.v} format={format} props={props} onVoir={onVoir} onExpire={onExpire} />
                : <TuileProduit e={e} v={p.v} props={props} id={`${uid}-t${i}`} qte={qteAuPanier[e.offre.cip] || 0} pret={pret} apercu={apercu}
                  onAjouter={onAjouter} onModifier={onModifier} onOuvrirPanier={onOuvrirPanier} onVoir={onVoir} onExpire={onExpire} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const Fond = ({ e }) => (
  <span className="mea-tuile-fond" aria-hidden="true">
    <span className="mea-tuile-lavis" />
    {e.halo && <img className="mea-tuile-halo" src={photo(e.halo, "thumbnail")} alt="" draggable={false} decoding="async" loading="lazy" />}
    <span className="mea-projecteur" />
  </span>
);

function TuileProduit({ e, v, props, id, qte, pret, apercu, onAjouter, onModifier, onOuvrirPanier, onVoir, onExpire }) {
  const o = e.offre, grand = v === "grande" || v === "bandeau";
  const ref = useRef(null);
  return (
    <article ref={ref} {...props} aria-labelledby={id}>
      <Fond e={e} />
      <div className="mea-tuile-visuel" aria-hidden="true">
        <Photo url={o.image_url} taille={grand ? "medium" : "thumbnail"} teinte={e.couleur} offre={o} />
        {grand && <span className="mea-tuile-ombre" />}
      </div>
      <div className="mea-tuile-corps">
        <p className="mea-tuile-eyebrow">{e.badge || (v === "grande" ? "À la une" : e.rayon)}</p>
        <h3 id={id} className="mea-tuile-nom">{e.titre}</h3>
        {grand && e.sousLigne && <p className="mea-tuile-sous">{e.sousLigne}</p>}
        <p className="mea-tuile-prix num">
          <span className="acc-vh">{prixLu(o)}</span>
          <span aria-hidden="true"><b>{fmtEur(o.pn)}</b><small> HT</small></span>
          {o.pct >= 1 && <span className="mea-tuile-remise" aria-hidden="true">{fmtPct(o.pct)}</span>}
        </p>
        {grand && o.pv > o.pn && <p className="mea-tuile-pv num" aria-hidden="true">PV {fmtEur(o.pv)} HT · remise {fmtEur(o.remise_eur > 0 ? o.remise_eur : o.pv - o.pn)}</p>}
        {!grand && <p className="mea-tuile-lot num" aria-hidden="true"><span>{lot(o)}</span><span>{fmtEur(o.lot?.total ?? o.pn)} HT</span></p>}
        {e.fin && <Rebours fin={e.fin} secondes={false} onFin={onExpire} classe="mea-tuile-fin" />}
        <div className="mea-tuile-actions">
          <BoutonLot offre={o} nom={e.titre} qte={qte} pret={pret} desactive={apercu} compacte={!grand}
            onAjouter={(q) => onAjouter?.(e, q, ref.current?.querySelector(".mea-tuile-visuel > *") || ref.current)}
            onModifier={(q) => onModifier?.(o.cip, q)} onOuvrirPanier={onOuvrirPanier} />
          <button type="button" className="mea-voir mea-voir--clair" onClick={() => onVoir?.(e)}>
            {v === "petite" ? "Voir" : o.menu?.key && o.menu.key !== "saisie" ? `Voir dans ${o.menu.label}` : "Voir dans la Saisie"}<Icone nom="fleche" taille={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function TuileMenu({ e, v, format, props, onVoir, onExpire }) {
  const m = e.menu, grand = v === "grande" || v === "bandeau";
  const fin = e.fin ? `, jusqu'au ${dateTexte(e.fin)}` : "";
  const vignettes = m.cartes.filter(c => c.url).slice(0, 3);
  return (
    <button type="button" {...props} aria-label={`${resumeMenuLu(e)}${fin}, voir le menu`} onClick={() => onVoir?.(e)}>
      <Fond e={e} />
      <span className="mea-tuile-visuel" aria-hidden="true">
        {grand ? <Eventail cartes={m.cartes} max={v === "grande" && format !== "s" ? 5 : 3} taille={v !== "grande" ? "s" : format === "l" ? "l" : format === "m" ? "m" : "s"} />
          : <span className="mea-pastilles">{vignettes.length ? vignettes.map((c, i) => <span key={i} className="mea-pastille"><img src={photo(c.url, "thumbnail")} alt="" draggable={false} decoding="async" loading="lazy" /></span>)
            : <span className="mea-tuile-icone">{m.icone || <Icone nom="etiquette" taille={20} />}</span>}</span>}
      </span>
      <span className="mea-tuile-corps" aria-hidden="true">
        <span className="mea-tuile-eyebrow">{e.badge || e.rayon}</span>
        <span className="mea-tuile-nom">{e.titre}</span>
        {grand && e.accroche && <span className="mea-tuile-accroche">{e.accroche}</span>}
        <span className="mea-tuile-meta num">
          {`${m.nb} ${v === "petite" ? "réf." : `référence${m.nb > 1 ? "s" : ""}`}${m.des ? ` · dès ${fmtEur(m.des)} HT` : ""}`}
          {m.jusqua ? <span className="mea-tuile-remise">jusqu’à {fmtPct(m.jusqua)}</span> : null}
        </span>
        {e.fin && <Rebours fin={e.fin} secondes={false} onFin={onExpire} classe="mea-tuile-fin" balise="span" />}
        <span className="mea-tuile-pied">Voir le menu<Icone nom="fleche" taille={16} epaisseur={2.4} /></span>
      </span>
    </button>
  );
}
