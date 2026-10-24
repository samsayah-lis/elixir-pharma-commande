import React from "react";
// ── Jauge des paliers de quantité (22/10/2026, corrigée après revue) : rendu de jaugePaliers (src/tiers.jsx, logique et prix),
// styles .ex-jauge* de src/styles/tokens.css. Affichage seulement : aucun prix ni aucune quantité n'est calculé ici (curseur :
// quantiteJauge et toucheJauge de src/tiers.jsx).
import { jaugePaliers, positionJauge, vuesJauge, quantiteJauge, toucheJauge } from "../tiers.jsx";
import { fmtEur, fmtPct } from "../theme.js";
import { Icone } from "../icons.jsx";

// variante : "complete" (Saisie ; tableaux des menus avec une quantité et un palier à viser : titre, 3 étapes au plus, « Voir le
// détail »), "compacte" (panier, liste mobile : 2 étapes, « Détail »), "mini" (cartes : 1 étape, texte court), "ligne" (tableaux
// et liste mobile à 0 ou au meilleur prix : une ligne de texte et « Passer à N »).
// onChoisir(quantité) : clic sur un palier, curseur lâché ou déplacé au clavier (quantité totale de la ligne). deja : quantité déjà
// au panier (Saisie), dite dans l'en-tête, et plancher du curseur.
// Hauteur fixe d'un état à l'autre pour une même variante ; style : posé sur le bloc ; rien n'est rendu sans étape.
export default function JaugePaliers({ base, pv, tiers, qte, pas, min, max, onChoisir, nom = "", variante = "complete", style, deja = 0 }) {
  const [ouvert, setOuvert] = React.useState(false);
  // curseur à glisser (24/10/2026) : quantité sous le doigt et étapes figées le temps du geste (la piste ne change pas d'échelle
  // sous le doigt). La quantité ne part à onChoisir qu'au lâcher : tableaux et panier changent de forme de jauge au dernier palier
  const [glisse, setGlisse] = React.useState(null);
  const geste = React.useRef(null);
  const id = React.useId();
  const j = jaugePaliers({ base, pv, tiers, qte: glisse ? glisse.q : qte, pas, min, max });
  if (!j) return null;
  const p = j.prochaine, mini = variante === "mini", nomme = { role: "group", "aria-label": `Prix par quantité${nom ? ` : ${nom}` : ""}` };
  const unite = (e) => `${fmtEur(e.prix)} HT l'unité, ${fmtPct(e.pct)}`;
  // prix unitaire en pastille or et remise à côté : jamais le % seul (revue : il grossissait un gain de quelques centimes)
  const prix = (e) => <><b className="ex-jauge__prix">{fmtEur(e.prix)}{mini ? "" : " HT"}</b>{!mini && <> <span className="ex-jauge__u">l'unité </span>({fmtPct(e.pct)})</>}</>;
  // ex-jauge__br : retour à la ligne avant le prix (compacte, mini, complète sur téléphone) — deux lignes dans tous les états,
  // la hauteur ne change pas quand le texte change (tokens.css)
  const br = <span className="ex-jauge__br" />;
  const incitation = p
    ? <>{j.q ? <>{mini ? "Encore" : "Plus que"} <b className="ex-jauge__n">{j.manque}</b> pour</> : <>Dès <b className="ex-jauge__n">{p.qte}</b> :</>}{br} {prix(p)}</>
    : <>{variante !== "complete" && <Icone nom="coche" taille={14} epaisseur={2.6} />}{mini ? "Prix palier" : "Prix palier appliqué :"}{br} {prix(j)}{variante === "ligne" && j.prix < j.depart.prix ? `, au lieu de ${fmtEur(j.depart.prix)}` : ""}</>;
  // lecteurs d'écran : annonce quand le palier visé ou atteint change, pas à chaque touche
  const lu = <span className="ex-lecteur" aria-live="polite">{p ? `Prochain palier : ${p.qte} unités à ${fmtEur(p.prix)} HT l'unité` : `Prix palier appliqué : ${fmtEur(j.prix)} HT l'unité`}</span>;
  if (variante === "ligne") return (
    <div className="ex-jauge" style={style} data-variante="ligne" {...nomme} title={j.etapes.map(e => `${fmtEur(e.prix)} HT dès ${e.qte}`).join(" · ")}>
      <span className="ex-jauge__incitation">{p && <Icone nom="cible" taille={14} epaisseur={2.4} />}{incitation}</span>
      {p && onChoisir && <button type="button" className="ex-jauge__passer" aria-label={`Mettre la quantité à ${p.qte} : ${unite(p)}`} onClick={() => onChoisir(p.qte)}>Passer à {p.qte}</button>}
      {lu}
    </div>
  );
  const figees = (seuils) => j.etapes.filter(e => seuils.includes(e.seuil));
  const vues = (glisse && figees(glisse.seuils).length && figees(glisse.seuils)) || vuesJauge(j, mini ? 1 : variante === "compacte" ? 2 : 3);
  const x = positionJauge(vues, j.q), xp = p && vues.includes(p) ? positionJauge(vues, p.qte) : null, e0 = j.etapes[0];
  // curseur réglable dès qu'une quantité peut être posée : glissé (souris, doigt ; un appui sur la piste l'y amène, un palier garde
  // son clic) ou au clavier (role="slider", toucheJauge) ; plancher : quantité déjà au panier (Saisie)
  const regle = { pas, min, max, plancher: deja }, reglable = !!onChoisir;
  const surPiste = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); return r.width ? (ev.clientX - r.left) / r.width * 100 : 0; };
  const poser = (ev) => {
    if (ev.button !== 0 || !ev.isPrimary || geste.current || ev.target.closest(".ex-jauge__etape")) return;
    const xd = surPiste(ev), prise = !!ev.target.closest(".ex-jauge__curseur"), seuils = vues.map(e => e.seuil);
    // pris par le curseur : la quantité ne bouge qu'avec le doigt (écart gardé) ; ailleurs sur la piste : quantité sous le doigt
    const g = geste.current = { id: ev.pointerId, x0: ev.clientX, depart: j.q, ecart: prise ? x - xd : 0, seuils, q: prise ? j.q : quantiteJauge(vues, xd, regle) };
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();   // ni sélection de texte ni focus déplacé (champ de quantité en cours de frappe)
    setGlisse({ q: g.q, seuils });
  };
  // quantité sous le doigt, une fois parti de 3 px (un appui qui tremble ne déplace pas le curseur ni ne l'aimante à un palier)
  const viser = (g, ev) => {
    if (!g.bouge && Math.abs(ev.clientX - g.x0) < 3) return g.q;
    g.bouge = true;
    return (g.q = quantiteJauge(figees(g.seuils), surPiste(ev) + g.ecart, regle));
  };
  const suivre = (ev) => {
    const g = geste.current, avant = g?.q;
    if (g && ev.pointerId === g.id && viser(g, ev) !== avant) setGlisse({ q: g.q, seuils: g.seuils });
  };
  // lâcher : quantité posée si elle a changé ; geste annulé (défilement repris par le navigateur, capture perdue) : rien
  const lacher = (ev) => {
    const g = geste.current;
    if (!g || ev.pointerId !== g.id) return;
    geste.current = null;
    setGlisse(null);
    if (ev.type === "pointerup" && viser(g, ev) !== g.depart) onChoisir(g.q);
  };
  const clavier = (ev) => {
    const n = toucheJauge(j, ev.key, regle);
    if (n == null || geste.current) return;
    ev.preventDefault();
    if (n !== j.q) onChoisir(n);
  };
  const curseur = reglable ? {
    role: "slider", tabIndex: 0, onKeyDown: clavier, "aria-label": `Quantité à commander${nom ? ` : ${nom}` : ""}`,
    "aria-valuemin": deja, "aria-valuemax": Math.max(j.q, quantiteJauge(vues, 100, regle)), "aria-valuenow": j.q,
    "aria-valuetext": `${j.q} unités, ${fmtEur(j.prix)} HT l'unité${deja > 0 ? `, dont ${deja} déjà au panier` : ""}`,
  } : { "aria-hidden": "true" };
  const detail = !mini && (
    <button type="button" className="ex-jauge__detail" aria-expanded={ouvert} aria-controls={id} onClick={() => setOuvert(o => !o)}>
      {variante === "complete" ? "Voir le détail" : "Détail"}<Icone nom="fleche" taille={14} epaisseur={2.2} style={ouvert ? { transform: "rotate(90deg)" } : undefined} />
    </button>
  );
  return (
    <div className="ex-jauge" style={style} data-variante={variante} data-atteint={j.prix < j.base ? "" : undefined} {...nomme}>
      <div className="ex-jauge__tete">
        {variante === "complete" && <span className="ex-jauge__titre"><Icone nom={p ? "cible" : "coche"} taille={14} epaisseur={2.4} />Prix par quantité</span>}
        <span className="ex-jauge__incitation">{incitation}</span>
        {deja > 0 && <span className="ex-jauge__deja">dont {deja} déjà au panier</span>}
      </div>
      <div className="ex-jauge__corps">
        <div className="ex-jauge__zone" data-reglable={reglable ? "" : undefined} data-glisse={glisse ? "" : undefined}
          {...(reglable && { onPointerDown: poser, onPointerMove: suivre, onPointerUp: lacher, onPointerCancel: lacher, onLostPointerCapture: lacher })}>
          <div className="ex-jauge__piste" aria-hidden="true">
            <div className="ex-jauge__plein" style={{ width: `${x}%` }} />
            {xp != null && <div className="ex-jauge__tirets" style={{ left: `${x}%`, width: `${xp - x}%` }} />}
          </div>
          <div className="ex-jauge__curseur" style={{ left: `${x}%` }} {...curseur} />
          {glisse && <span className="ex-jauge__n ex-jauge__bulle" style={{ left: `${x}%` }} aria-hidden="true">{j.q}</span>}
          <span className="ex-jauge__zero" aria-hidden="true">0</span>
          {vues.map(e => {
            // étape à sa quantité commandable (au pas du colis), prix et remise dessous
            const etat = e.seuil <= j.q ? "atteinte" : e === p ? "prochaine" : "suite", pos = { left: `${positionJauge(vues, e.qte)}%` };
            const contenu = <><span className="ex-jauge__q">{e.qte}</span><span className="ex-jauge__point" /><span className="ex-jauge__remise">{fmtEur(e.prix)}<span className="ex-jauge__rp"> · {fmtPct(e.pct)}</span></span></>;
            return onChoisir
              ? <button key={e.seuil} type="button" className="ex-jauge__etape" data-etat={etat} style={pos} aria-label={`Mettre la quantité à ${e.qte} : ${unite(e)}${etat === "atteinte" ? " (atteint)" : ""}`}
                  title={`${fmtEur(e.prix)} HT dès ${e.seuil}${e.qte !== e.seuil ? ` : commander ${e.qte}` : ""}`} onClick={() => onChoisir(e.qte)}>{contenu}</button>
              : <span key={e.seuil} className="ex-jauge__etape" data-etat={etat} style={pos} role="img" aria-label={`${e.qte} unités : ${unite(e)}`}>{contenu}</span>;
          })}
          {!reglable && <span className="ex-lecteur">Quantité {j.q}, prix appliqué {fmtEur(j.prix)} HT l'unité.</span>}
        </div>
        {detail}
      </div>
      {lu}
      {detail && (
        <div id={id} hidden={!ouvert}>
          <div className="ex-jauge__defile">
            <table className="ex-jauge__table">
              <caption className="ex-lecteur">Prix par quantité{nom ? ` : ${nom}` : ""}</caption>
              <thead><tr><th scope="col">Quantité</th><th scope="col">Prix HT/u</th><th scope="col">Remise</th><th scope="col">Économie au palier</th></tr></thead>
              <tbody>
                <tr data-actuel={j.atteinte ? undefined : ""}><th scope="row">{j.depart.qte > 1 ? `Moins de ${e0.qte}` : e0.qte > 2 ? `1 à ${e0.qte - 1}` : "1"}</th>
                  <td>{fmtEur(j.depart.prix)}</td><td>{j.depart.pct ? fmtPct(j.depart.pct) : "–"}</td><td>–</td></tr>
                {j.etapes.map(e => (
                  <tr key={e.seuil} data-actuel={e === j.atteinte ? "" : undefined}><th scope="row">Dès {e.seuil}{e.qte !== e.seuil ? ` (commander ${e.qte})` : ""}</th>
                    <td>{fmtEur(e.prix)}</td><td>{fmtPct(e.pct)}</td><td>{fmtEur(e.economie)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ex-jauge__note">{j.ref > j.base ? `Remise calculée sur le prix catalogue (${fmtEur(j.ref)} HT). ` : ""}Économie : gain total au palier par rapport à {fmtEur(j.depart.prix)} HT l'unité.</p>
        </div>
      )}
    </div>
  );
}
