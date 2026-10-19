// ── Assistant Elixir : afficheur sûr du texte du modèle (règles dans texte-sur.js) ──
// Seulement des nœuds texte React (échappés), <strong>, <br>, <p>, <ul>/<li> : jamais dangerouslySetInnerHTML, jamais
// de lien ni d'image, quel que soit le texte reçu.
import React from "react";
import { analyseTexte } from "./texte-sur.js";

const Segments = ({ segs }) => segs.map((s, i) => (s.gras ? <strong key={i} style={{ fontWeight: 700 }}>{s.texte}</strong> : <React.Fragment key={i}>{s.texte}</React.Fragment>));

export default function TexteSur({ texte }) {
  const blocs = analyseTexte(texte);
  return blocs.map((b, i) => b.type === "liste"
    ? <ul key={i} style={{ margin: i ? "6px 0 0" : 0, paddingLeft: 20 }}>
        {b.items.map((segs, j) => <li key={j} style={{ marginTop: j ? 2 : 0 }}><Segments segs={segs} /></li>)}
      </ul>
    : <p key={i} style={{ margin: i ? "8px 0 0" : 0, overflowWrap: "anywhere" }}>
        {b.lignes.map((segs, j) => <React.Fragment key={j}>{j > 0 && <br />}<Segments segs={segs} /></React.Fragment>)}
      </p>);
}
