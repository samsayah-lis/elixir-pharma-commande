// ── En-tête de vue (refonte charte, lot 4 : docs/refonte-charte.md § 3) ──
// Carte paper, rayon 16, titre 26/640 pétrole. La couleur du rayon (SECTION_META, ou saisie dans l'admin pour une
// campagne, un menu promo, une section perso) n'est plus qu'un repère : filet de 3 px à gauche et pastille d'icône
// teintée à 14 %. Les textes restent aux jetons : une couleur choisie dans l'admin ne rend jamais un texte illisible.
// Marges intérieures et taille du titre sur mobile : classe ex-entete-vue (src/styles/tokens.css), le composant ne
// reçoit pas isMobile (réutilisable par les vues spéciales : Saisie, Péremption…, lots 5 et 7).
// <EnteteVue icone={…} couleur="#2d7d9a" titre="Sélection Stratège" sousTitre="…" actions={…} aside={…}>…</EnteteVue>
import { T, R, alpha } from "../../theme.js";

export default function EnteteVue({ icone, couleur, titre, sousTitre, actions, aside, children, style }) {
  // pastille : teinte à 14 % d'un hex ; toute autre valeur (nom de couleur, rgb()…) → menthe, comme une icône neutre
  const teinte = alpha(couleur, 0.14);
  const fondIcone = typeof teinte === "string" && teinte.startsWith("rgba(") ? teinte : T.mint;
  return (
    <div className="ex-entete-vue" style={{
      background: T.paper, color: T.ink, borderRadius: R.m, marginBottom: 20,
      border: `1px solid ${T.line}`, borderLeft: `3px solid ${couleur || T.line}`, ...style,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        {/* base de 200 px : à 375 px, le compteur tient encore à droite du titre */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0, flex: "1 1 200px" }}>
          {icone && (
            <span className="ex-entete-vue__icone" aria-hidden="true" style={{
              width: 44, height: 44, borderRadius: 12, background: fondIcone, color: T.petrol, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, lineHeight: 1,
            }}>{icone}</span>
          )}
          <div style={{ minWidth: 0 }}>
            <h1 className="ex-entete-vue__titre" style={{ margin: 0, fontSize: 26, fontWeight: 640, letterSpacing: "-0.02em", lineHeight: 1.15, color: T.petrol, overflowWrap: "anywhere" }}>
              {titre}
            </h1>
            {sousTitre && <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.45, color: T.inkSoft }}>{sousTitre}</p>}
            {actions}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

// Compteur à droite de l'en-tête : grand chiffre (chiffres tabulaires) + libellé en eyebrow.
// chargement (lot 8) : bloc sable à la place du chiffre, la place est tenue (l'en-tête ne saute pas à l'arrivée des données)
export function CompteurVue({ valeur, libelle, detail, chargement }) {
  return (
    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "auto" }}>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: T.ink }}>
        {chargement ? <span aria-hidden="true" className="ex-squelette" style={{ display: "inline-block", width: 48, height: 20, borderRadius: 6, verticalAlign: "-3px" }} /> : valeur}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkMute, marginTop: 2 }}>{libelle}</div>
      {detail && <div className="num" style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>{detail}</div>}
    </div>
  );
}
