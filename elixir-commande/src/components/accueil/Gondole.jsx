// ── La tête de gondole (ordinateur, tablette) : le produit choisi, en grand, sous un projecteur ──
// Plans (du fond vers l'avant) : fond, projecteur, rang géant, halo d'ambiance, socle, produit. Le produit a deux
// enveloppes : l'externe porte le vol FLIP depuis son emplacement du linéaire, l'interne l'inclinaison et le petit bond.
// Pointeur fin (souris) : le produit s'incline vers le pointeur (±6°), les plans bougent à des vitesses différentes, le
// projecteur suit ; tout passe par des variables CSS écrites dans un requestAnimationFrame (aucun setState par image).
// Glisser à la souris (ou au doigt sur iPad) : produit suivant ou précédent. Mouvement réduit : fondu de 150 ms au plus.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Boite from "./Boite.jsx";
import Rouleau from "./Rouleau.jsx";
import { EASE, RESSORT, SORTIE, anime, photo, photoReconnue } from "./outils.js";
import { alpha } from "../../theme.js";

// photo (medium, large en 2x) ou boîte générée ; photo en erreur → boîte
export function Visuel({ offre, mode, taille, priorite = false, teinte }) {
  const [erreur, setErreur] = useState(false);
  useEffect(() => { setErreur(false); }, [offre.image_url]);
  if (offre.image_url && !erreur) {
    const r = photoReconnue(offre.image_url);
    return <img className="acc-photo" src={photo(offre.image_url, "medium")} srcSet={r ? `${photo(offre.image_url, "medium")} 1x, ${photo(offre.image_url, "large")} 2x` : undefined}
      alt="" draggable={false} decoding="async" loading={priorite ? "eager" : "lazy"} fetchpriority={priorite ? "high" : undefined} onError={() => setErreur(true)} />;
  }
  return <Boite boite={offre.boite} cip={offre.cip} teinte={teinte} mode={mode} taille={taille} />;
}

export function Halo({ offre, teinte }) {
  const t = alpha(teinte, 0.14);
  return offre.image_url
    ? <span className="acc-halo" aria-hidden="true"><img src={photo(offre.image_url, "thumbnail")} alt="" draggable={false} decoding="async" /></span>
    : <span className="acc-halo acc-halo--boite" aria-hidden="true" style={typeof t === "string" && t.startsWith("rgba(") ? { "--acc-halo": t } : undefined} />;
}

export default function Gondole({ offre, index, position, arrivee, reduit, finPointer, teinte, refProduit, onGlisse }) {
  const scene = useRef(null), vol = useRef(null), sortantRef = useRef(null);
  const anims = useRef([]);
  const prec = useRef({ index, offre });
  const [sortant, setSortant] = useState(null);
  const [rang, setRang] = useState(arrivee && !reduit ? "00" : String(position).padStart(2, "0"));
  const mode = finPointer && !reduit ? "3d" : "25d";

  // rang géant : rouleau (00 → 01 à l'arrivée)
  useEffect(() => {
    const cible = String(position).padStart(2, "0");
    if (rang === cible) return undefined;
    const t = setTimeout(() => setRang(cible), arrivee && rang === "00" ? 360 : 120);
    return () => clearTimeout(t);
  }, [position]);   // eslint-disable-line react-hooks/exhaustive-deps

  // arrivée et changement de produit : FLIP depuis l'emplacement du linéaire ; le produit sortant s'efface
  useLayoutEffect(() => {
    const change = prec.current.index !== index;
    const premier = !prec.current.vu;
    prec.current = { index, offre, vu: true, ancien: change ? prec.current.offre : null };
    if (!change && !premier) return;
    anims.current.forEach(a => a?.finish?.());   // changements rapides : seul le dernier produit vole
    anims.current = [];
    if (reduit) { anims.current.push(anime(vol.current, [{ opacity: 0 }, { opacity: 1 }], { duration: premier ? 0 : 150 })); return; }
    if (change) setSortant({ offre: prec.current.ancien, id: Date.now() });
    if (premier && !arrivee) { anims.current.push(anime(scene.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 })); return; }
    const facing = document.querySelector(`#acc-onglet-${index} .acc-facing`);
    const a = facing?.getBoundingClientRect(), b = vol.current?.getBoundingClientRect();
    const visible = a && a.width > 0 && a.right > 0 && a.left < window.innerWidth;
    const debut = premier ? 300 : 60, duree = premier ? 520 : 500;
    if (visible && b?.height) {
      const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
      const s = Math.max(0.15, Math.min(0.6, a.height / b.height));
      anims.current.push(anime(vol.current, [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.5 }, { transform: "none", opacity: 1 }],
        { duration: duree, delay: debut, easing: RESSORT }));
    } else anims.current.push(anime(vol.current, [{ transform: "scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: duree, delay: debut, easing: RESSORT }));
    if (premier) anims.current.push(anime(scene.current?.querySelector(".acc-projecteur"), [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE }));
    anims.current.push(anime(scene.current?.querySelector(".acc-halo"), [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE }));
  }, [index, offre, reduit]);   // eslint-disable-line react-hooks/exhaustive-deps

  // produit sortant : 200 ms (opacité, glissé à gauche, léger pivot), puis retiré
  useLayoutEffect(() => {
    if (!sortant) return undefined;
    const a = anime(sortantRef.current, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-24px) rotateY(-8deg)" }], { duration: 200, easing: SORTIE, fill: "forwards" });
    const fin = () => setSortant(s => (s?.id === sortant.id ? null : s));
    if (a) a.onfinish = fin; else fin();
    const t = setTimeout(fin, 400);
    return () => clearTimeout(t);
  }, [sortant]);

  // pointeur : inclinaison, profondeur, projecteur (lissage 0,12 par image, retour au neutre à la sortie)
  const pt = useRef({ cx: 0, cy: 0, x: 0, y: 0, dedans: false, raf: 0 });
  const boucle = () => {
    const p = pt.current, el = scene.current;
    if (!el) { p.raf = 0; return; }
    p.x += (p.cx - p.x) * 0.12; p.y += (p.cy - p.y) * 0.12;
    el.style.setProperty("--px", p.x.toFixed(4)); el.style.setProperty("--py", p.y.toFixed(4));
    if (!p.dedans && Math.abs(p.x) < 0.002 && Math.abs(p.y) < 0.002) { el.style.setProperty("--px", "0"); el.style.setProperty("--py", "0"); p.raf = 0; return; }
    p.raf = requestAnimationFrame(boucle);
  };
  useEffect(() => () => cancelAnimationFrame(pt.current.raf), []);
  const actif = finPointer && !reduit;
  const surDeplacement = (e) => {
    if (!actif || e.pointerType !== "mouse") return;
    const r = scene.current.getBoundingClientRect();
    pt.current.cx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    pt.current.cy = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    pt.current.dedans = true;
    if (!pt.current.raf) pt.current.raf = requestAnimationFrame(boucle);
  };
  const surSortie = () => { pt.current.cx = 0; pt.current.cy = 0; pt.current.dedans = false; if (actif && !pt.current.raf) pt.current.raf = requestAnimationFrame(boucle); };
  // glisser : 40 px ou 0,3 px/ms
  const glisse = useRef(null);
  const surAppui = (e) => { if (e.button === 0 || e.pointerType !== "mouse") glisse.current = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const surRelache = (e) => {
    const g = glisse.current; glisse.current = null;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y, v = Math.abs(dx) / Math.max(1, performance.now() - g.t);
    if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) >= 40 || (v >= 0.3 && Math.abs(dx) >= 12))) onGlisse(dx < 0 ? 1 : -1);
  };

  return (
    <div ref={scene} className={`acc-scene${actif ? " acc-scene--vivante" : ""}`} onPointerMove={surDeplacement} onPointerLeave={surSortie}
      onPointerDown={surAppui} onPointerUp={surRelache} onPointerCancel={() => { glisse.current = null; }}>
      {/* fond rogné (halo agrandi, projecteur) ; le produit, lui, n'est pas rogné : il vole depuis le linéaire */}
      <span className="acc-scene-fond" aria-hidden="true">
        <span className="acc-projecteur" />
        <span className="acc-rang-geant num"><Rouleau texte={rang} decalage={40} /></span>
        <Halo offre={offre} teinte={teinte} />
      </span>
      <span className="acc-socle" aria-hidden="true" />
      <div className="acc-emplacement-produit">
        {sortant && <div ref={sortantRef} key={sortant.id} className="acc-produit acc-produit--sortant" aria-hidden="true"><Visuel offre={sortant.offre} mode={mode} teinte={teinte} /></div>}
        <div ref={vol} className="acc-produit acc-produit-vol">
          <div ref={refProduit} className="acc-produit-incl">
            <Visuel offre={offre} mode={mode} teinte={teinte} priorite={position === 1} />
          </div>
        </div>
      </div>
    </div>
  );
}
