import React from "react";
// ── Jauge des paliers de quantité (22/10/2026) : rendu de jaugePaliers (src/tiers.jsx, logique et prix), styles
// .ex-jauge* de src/styles/tokens.css. Affichage seulement : aucun prix ni aucune quantité n'est calculé ici.
import { jaugePaliers, positionJauge, texteJauge } from "../tiers.jsx";
import { fmtEur, fmtPct } from "../theme.js";
import { Icone } from "../icons.jsx";

// variante : "complete" (Saisie, tableaux des menus : titre, « Voir le détail » à droite de la piste), "compacte" (panier,
// liste mobile : sans titre, « Détail », palier atteint et deux suivants), "mini" (cartes : ni titre ni détail, incitation
// sans la remise — elle est sous le palier — pour tenir dans une carte de 172 px).
// onChoisir(quantité) : clic sur un palier. Hauteur fixe d'un état à l'autre (pas de saut quand la quantité change).
// style : posé sur le bloc (placement dans la grille de l'appelant) ; rien n'est rendu sans palier utile.
export default function JaugePaliers({ base, pv, tiers, qte, pas, min, max, onChoisir, nom = "", variante = "complete", style }) {
  const [ouvert, setOuvert] = React.useState(false);
  const id = React.useId();
  const j = jaugePaliers({ base, pv, tiers, qte, pas, min, max });
  if (!j) return null;
  const i = j.atteinte ? j.etapes.indexOf(j.atteinte) : -1;
  const vues = variante === "complete" ? j.etapes : j.etapes.slice(Math.max(0, i), i + 3);   // palier atteint et deux suivants
  const x = positionJauge(vues, j.q), xp = j.prochaine && vues.includes(j.prochaine) ? positionJauge(vues, j.prochaine.seuil) : null;
  const detail = variante !== "mini" && (
    <button type="button" className="ex-jauge__detail" aria-expanded={ouvert} aria-controls={id} onClick={() => setOuvert(o => !o)}>
      {variante === "complete" ? "Voir le détail" : "Détail"}<Icone nom="fleche" taille={14} epaisseur={2.2} style={ouvert ? { transform: "rotate(90deg)" } : undefined} />
    </button>
  );
  return (
    <div className="ex-jauge" style={style} data-variante={variante} data-atteint={j.atteinte ? "" : undefined} role="group" aria-label={`Prix par quantité${nom ? ` : ${nom}` : ""}`}>
      <div className="ex-jauge__tete">
        {variante === "complete" && <span className="ex-jauge__titre"><Icone nom={j.prochaine ? "cible" : "coche"} taille={14} epaisseur={2.4} />Prix par quantité</span>}
        <span className="ex-jauge__incitation" aria-live="polite">
          {variante === "mini"   // texte complet pour les lecteurs d'écran, version courte à l'écran
            ? <><span className="ex-lecteur">{texteJauge(j)}</span><span aria-hidden="true" style={{ display: "contents" }}>{j.prochaine
                ? <>Plus que <b className="ex-jauge__n">{j.manque}</b></> : <><Icone nom="coche" taille={14} epaisseur={2.6} />Meilleur prix</>}</span></>
            : j.prochaine
            ? <>Plus que <b className="ex-jauge__n">{j.manque}</b> pour bénéficier de <b className="ex-jauge__pct">{fmtPct(j.prochaine.pct)}</b></>
            : <><Icone nom="coche" taille={14} epaisseur={2.6} />Meilleur prix atteint : <b className="ex-jauge__pct">{fmtPct(j.pct)}</b></>}
        </span>
      </div>
      <div className="ex-jauge__corps">
        <div className="ex-jauge__zone">
          <div className="ex-jauge__piste" aria-hidden="true">
            <div className="ex-jauge__plein" style={{ width: `${x}%` }} />
            {xp != null && <div className="ex-jauge__tirets" style={{ left: `${x}%`, width: `${xp - x}%` }} />}
            <div className="ex-jauge__curseur" style={{ left: `${x}%` }} />
          </div>
          <span className="ex-jauge__zero" aria-hidden="true">0</span>
          {vues.map(e => {
            const etat = e.seuil <= j.q ? "atteinte" : e === j.prochaine ? "prochaine" : "suite";
            const libelle = `${e.seuil} unités : ${fmtEur(e.prix)} HT l'unité (${fmtPct(e.pct)})${etat === "atteinte" ? ", palier atteint" : ""}`;
            const contenu = <><span className="ex-jauge__q">{e.seuil}</span><span className="ex-jauge__point" /><span className="ex-jauge__remise">{fmtPct(e.pct)}</span></>;
            return onChoisir
              ? <button key={e.seuil} type="button" className="ex-jauge__etape" data-etat={etat} style={{ left: `${positionJauge(vues, e.seuil)}%` }}
                  aria-label={`${libelle}. Commander ${e.qte}`} title={`${fmtEur(e.prix)} HT dès ${e.seuil} : commander ${e.qte}`} onClick={() => onChoisir(e.qte)}>{contenu}</button>
              : <span key={e.seuil} className="ex-jauge__etape" data-etat={etat} style={{ left: `${positionJauge(vues, e.seuil)}%` }} role="img" aria-label={libelle}>{contenu}</span>;
          })}
          <span className="ex-lecteur">Quantité {j.q}, prix appliqué {fmtEur(j.prix)} HT l'unité.</span>
        </div>
        {detail}
      </div>
      {detail && (
        <div id={id} hidden={!ouvert}>
          <table className="ex-jauge__table">
            <thead><tr><th scope="col">Quantité</th><th scope="col">Prix unitaire HT</th><th scope="col">Remise</th><th scope="col">Économie</th></tr></thead>
            <tbody>
              <tr data-actuel={j.atteinte ? undefined : ""}><th scope="row">{j.etapes[0].seuil > 2 ? `1 à ${j.etapes[0].seuil - 1}` : "1"}</th>
                <td>{fmtEur(j.base)}</td><td>{j.pctBase ? fmtPct(j.pctBase) : "–"}</td><td>–</td></tr>
              {j.etapes.map(e => (
                <tr key={e.seuil} data-actuel={e === j.atteinte ? "" : undefined}><th scope="row">Dès {e.seuil}{e.qte !== e.seuil ? ` (${e.qte})` : ""}</th>
                  <td>{fmtEur(e.prix)}</td><td>{fmtPct(e.pct)}</td><td>{fmtEur(e.economie)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="ex-jauge__note">{j.ref > j.base ? `Remise sur le prix de base de ${fmtEur(j.ref)} HT ; économie` : "Remise et économie"} par rapport au prix sans palier ({fmtEur(j.base)} HT), pour la quantité du palier.</p>
        </div>
      )}
    </div>
  );
}
