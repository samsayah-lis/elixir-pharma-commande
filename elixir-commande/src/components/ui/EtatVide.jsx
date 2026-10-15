// ── États vides, chargement et erreurs (refonte charte, lot 8 : docs/refonte-charte.md § 3) ──
// Un seul dessin pour toute l'app, au lieu des copies locales (Saisie, Mes commandes, Péremption, Commandes groupées,
// catalogue, panier) : pastille ronde à icône au trait, titre 16/640 pétrole, texte --ink-soft, actions en pastilles.
//  • EtatVide : liste vide, aucun résultat, filtres trop restrictifs ; erreur → pastille danger et role="alert"
//  • ActionEtat : bouton d'un état (pétrole pour l'action principale, à filet sinon)
//  • Chargement : roue discrète + texte, role="status" (la roue ne tourne pas si l'utilisateur réduit les animations)
//  • Squelette, SqueletteCatalogue : blocs sable statiques, aux dimensions des cartes et lignes qu'ils annoncent
//    (pas de saut à l'arrivée des produits) ; jamais animés (jusqu'à 675 cartes en Centrale OTC)
// <EtatVide icone="recherche" titre="Aucun produit ne correspond" texte="…" actions={<ActionEtat …/>} cadre />
import { T, R, ui, tone } from "../../theme.js";
import { Icone } from "../../icons.jsx";

export default function EtatVide({ icone = "recherche", titre, texte, actions, erreur = false, compact = false, cadre = false, style }) {
  const t = tone(erreur ? "danger" : "info");   // pastille menthe + sarcelle ; erreur : danger
  const pastille = compact ? 44 : 56;
  return (
    <div role={erreur ? "alert" : undefined} style={{
      ...(cadre ? ui.card : null), textAlign: "center", padding: compact ? "24px 16px" : "44px 20px", ...style,
    }}>
      <span aria-hidden="true" style={{
        width: pastille, height: pastille, borderRadius: R.pill, background: t.bg, color: t.fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: compact ? 10 : 14,
      }}><Icone nom={icone} taille={compact ? 20 : 26} /></span>
      {titre && <div style={{ fontSize: compact ? 15 : 16, fontWeight: 640, letterSpacing: "-0.01em", lineHeight: 1.3, color: T.petrol, overflowWrap: "anywhere" }}>{titre}</div>}
      {texte && <div style={{ fontSize: 13, lineHeight: 1.5, color: T.inkSoft, maxWidth: 480, margin: "6px auto 0", overflowWrap: "anywhere" }}>{texte}</div>}
      {actions && <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: compact ? 12 : 18 }}>{actions}</div>}
    </div>
  );
}

// bouton d'un état vide ou d'une erreur : fond et survol par les classes ex-btn-petrole / ex-btn-ligne
const btnPrincipal = { ...ui.btn("primaire", "m"), background: undefined, color: undefined };
const btnLigne = { ...ui.btn("ligne", "m"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}` };
export function ActionEtat({ principal = false, icone, children, style, ...reste }) {
  return (
    <button type="button" className={principal ? "ex-btn-petrole" : "ex-btn-ligne"} style={{ ...(principal ? btnPrincipal : btnLigne), ...style }} {...reste}>
      {icone && <Icone nom={icone} taille={16} />}{children}
    </button>
  );
}

// chargement : roue de 16 px (classe ex-roue, tokens.css) + texte ; compact = dans une carte, calé à gauche
export function Chargement({ texte = "Chargement…", compact = false, style }) {
  return (
    <div role="status" style={{
      display: "flex", alignItems: "center", justifyContent: compact ? "flex-start" : "center", gap: 10,
      padding: compact ? "6px 0" : "40px 20px", fontSize: compact ? 13 : 14, color: T.inkMute, ...style,
    }}>
      <span className="ex-roue" aria-hidden="true" />{texte}
    </div>
  );
}

// bloc de squelette (sable, statique) ; décoratif : le conteneur porte role="status" et un texte pour les lecteurs d'écran
export function Squelette({ largeur = "100%", hauteur = 12, rayon = 6, style }) {
  return <span aria-hidden="true" className="ex-squelette" style={{ display: "block", width: largeur, height: hauteur, borderRadius: rayon, flexShrink: 0, ...style }} />;
}

// ── Squelettes du catalogue, pendant le premier chargement des produits ──
// grille : cartes de la grille photo (puits de 160 px, 120 sur mobile) ; sinon tableau d'ordinateur ou liste mobile
// (entete = false : lignes seules, pour la recherche globale de l'en-tête) ; alphabet : place du rail A–Z des menus
// classés par ordre alphabétique (Centrale OTC, Autres NR), qui n'apparaît qu'avec les produits.
// Largeurs variées d'une ligne à l'autre (désignations de longueurs différentes), fixées : rien ne bouge au rendu.
const LARGEURS = ["72%", "58%", "84%", "64%", "77%", "52%", "69%", "81%", "60%", "74%"];
const masque = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
export function SqueletteCatalogue({ grille = false, mobile = false, lignes = 10, entete = true, alphabet = false, texte = "Chargement du catalogue…" }) {
  const n = Array.from({ length: lignes }, (_, i) => i);
  return (
    <div role="status" aria-busy="true" style={{ marginBottom: 24 }}>
      <span style={masque}>{texte}</span>
      {alphabet && (
        <div style={{ padding: "6px 0 10px", marginBottom: 4 }}>
          <div style={{ height: 40, boxSizing: "border-box", background: T.surface, border: `1px solid ${T.lineSoft}`, borderRadius: R.pill, boxShadow: T.shadow1 }} />
        </div>
      )}
      {grille ? (
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(220px, 1fr))", gap: mobile ? 10 : 14 }}>
          {n.map(i => (
            <div key={i} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, boxShadow: T.shadow1, overflow: "hidden" }}>
              <div style={{ height: mobile ? 120 : 160, background: T.surface2, borderBottom: `1px solid ${T.lineSoft}` }} />
              <div style={{ padding: mobile ? "10px 10px 4px" : "12px 14px 6px", display: "grid", gap: 7 }}>
                <Squelette hauteur={13} largeur="92%" />
                <Squelette hauteur={13} largeur={LARGEURS[i % LARGEURS.length]} />
                <Squelette hauteur={10} largeur="46%" style={{ marginTop: 2 }} />
                <Squelette hauteur={10} largeur="38%" />
              </div>
              <div style={{ padding: mobile ? "8px 8px 10px" : "10px 14px 14px", borderTop: `1px solid ${T.lineSoft}`, display: "grid", justifyItems: "center", gap: 8 }}>
                <Squelette hauteur={14} largeur={96} />
                <Squelette hauteur={22} largeur={84} />
                <Squelette hauteur={32} largeur="70%" rayon={R.pill} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, overflow: "hidden", boxShadow: T.shadow1 }}>
          {entete && <div style={{ ...ui.th, height: mobile ? 36 : 48, display: "flex", alignItems: "center" }}><Squelette hauteur={9} largeur={mobile ? 90 : 160} /></div>}
          {n.map(i => (
            <div key={i} style={{ background: i % 2 ? T.paper : T.surface, display: "flex", alignItems: "center", gap: mobile ? 10 : 16, padding: mobile ? "10px 14px" : "0 14px", minHeight: mobile ? 56 : 52, borderBottom: `1px solid ${T.lineSoft}` }}>
              {mobile ? (<>
                <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                  <Squelette hauteur={12} largeur={LARGEURS[i % LARGEURS.length]} />
                  <Squelette hauteur={10} largeur={64} />
                </div>
                <Squelette hauteur={30} largeur={94} rayon={R.pill} />
              </>) : (<>
                <Squelette hauteur={14} largeur={14} rayon={R.pill} />
                <Squelette hauteur={10} largeur={96} />
                <div style={{ flex: 1, minWidth: 0 }}><Squelette hauteur={12} largeur={LARGEURS[i % LARGEURS.length]} /></div>
                <Squelette hauteur={12} largeur={56} />
                <Squelette hauteur={12} largeur={64} />
                <Squelette hauteur={24} largeur={104} rayon={R.pill} />
                <Squelette hauteur={12} largeur={60} />
              </>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
