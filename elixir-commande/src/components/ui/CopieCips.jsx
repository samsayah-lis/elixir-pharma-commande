// ── « Copier les CIP » d'un lot de lignes (27/10/2026, docs/cip-copie.md) ──
// Données de la pharmacie seulement — lignes du panier, commande de « Mes commandes », carte commande de l'assistant — jamais un
// menu du catalogue : exception explicite à la règle anti-copie (docs/refonte-charte.md § 19). Chargé à la demande (React.lazy
// dans App ; Mes commandes et l'assistant sont déjà des morceaux à la demande) : rien dans le bundle des pharmacies.
// Bouton partagé en deux : « Copier les CIP » copie tout de suite au dernier format choisi (mémorisé sur l'appareil, src/cip-copie.js) ;
// sans format mémorisé, ou par le petit bouton « Format », un menu propose les trois formats de collage :
//   un CIP par ligne · CIP;quantité · CIP ⇥ quantité (logiciel de la pharmacie, tableur) — quantité servie quand elle est connue.
// Réussi : « N CIP copiés ✓ » 2 s sur le bouton et le message en bas de l'écran (ToastCopie) ; refusé : « Copie impossible » et le
// texte dans un champ sélectionné, à copier à la main (un champ : l'anti-copie laisse passer).
// <CopieCips lignes={cartItems} />  ·  <CopieCips lignes={items} libelle="Copier les CIP de cette commande" />
import React, { useEffect, useRef, useState } from "react";
import { T, R, ui, tone } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import { FORMATS_CIP, lignesCip, texteCips, formatMemorise, memoriserFormat, copierTexte, signalerCopie } from "../../cip-copie.js";

const pluriel = (n) => `${n} CIP copié${n > 1 ? "s" : ""}`;
const btnBase = { ...ui.btn("ligne", "m"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, height: 36, padding: "0 14px" };

// Menu des formats (role menu, un choix coché = dernier format) ; Échap et clic hors du menu : fermé par le parent
export function MenuFormats({ format, onChoisir, id }) {
  return (
    <div role="menu" id={id} aria-label="Format de copie des CIP" style={{ display: "grid", gap: 4, marginTop: 6, padding: 6, background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.s, boxShadow: T.shadow1 }}>
      {FORMATS_CIP.map((f) => (
        <button key={f.id} type="button" role="menuitemradio" aria-checked={format === f.id} className="ex-btn-ligne ex-copie-format" onClick={() => onChoisir(f.id)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", minHeight: 36, padding: "6px 10px", border: "none",
            borderRadius: R.xs, background: format === f.id ? T.surface2 : "transparent", color: T.ink, font: "inherit", fontSize: 13, fontWeight: format === f.id ? 700 : 500, cursor: "pointer", textAlign: "left" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 14, display: "inline-flex", color: T.teal }}>{format === f.id && <Icone nom="coche" taille={14} epaisseur={2.6} />}</span>{f.libelle}
          </span>
          <span className="num" style={{ fontFamily: T.mono, fontSize: 11, color: T.inkMute, whiteSpace: "nowrap" }}>{f.exemple}</span>
        </button>
      ))}
    </div>
  );
}

export default function CopieCips({ lignes, libelle = "Copier les CIP", style, compact = false }) {
  const [format, setFormat] = useState(formatMemorise);   // null : aucun format mémorisé encore
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState(null);                 // null | { ok: true, n } | { ok: false, texte }
  const racine = useRef(null), boutonFormat = useRef(null), champ = useRef(null);
  const idMenu = React.useId();
  const n = lignesCip(lignes).length;

  // menu fermé par Échap (focus rendu au bouton « Format ») ou par un clic hors du composant
  useEffect(() => {
    if (!ouvert) return;
    const clavier = (e) => { if (e.key === "Escape") { setOuvert(false); boutonFormat.current?.focus(); } };
    const dehors = (e) => { if (racine.current && !racine.current.contains(e.target)) setOuvert(false); };
    document.addEventListener("keydown", clavier); document.addEventListener("mousedown", dehors); document.addEventListener("touchstart", dehors);
    return () => { document.removeEventListener("keydown", clavier); document.removeEventListener("mousedown", dehors); document.removeEventListener("touchstart", dehors); };
  }, [ouvert]);
  // copie refusée : le texte est proposé dans un champ, déjà sélectionné
  useEffect(() => { if (etat && !etat.ok) { champ.current?.focus(); champ.current?.select(); } }, [etat]);

  const copier = (id) => {
    const texte = texteCips(lignes, id);
    memoriserFormat(id); setFormat(id); setOuvert(false);
    copierTexte(texte).then((ok) => {
      if (ok) { setEtat({ ok: true, n }); signalerCopie(pluriel(n)); setTimeout(() => setEtat(null), 2000); }
      else setEtat({ ok: false, texte });
    });
  };
  const principal = () => { if (etat && !etat.ok) setEtat(null); else if (format) copier(format); else setOuvert(true); };

  const t = etat ? tone(etat.ok ? "ok" : "danger") : null;
  const texteBouton = etat ? (etat.ok ? pluriel(etat.n) : "Copie impossible") : libelle;
  return (
    <div ref={racine} className="ex-copie-cips" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", ...(compact ? {} : { width: "100%" }) }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button type="button" className={`ex-tactile${etat ? "" : " ex-btn-ligne"}`} onClick={principal} disabled={n === 0}
          title={n === 0 ? "Aucun CIP dans ces lignes" : format ? `${libelle} — ${FORMATS_CIP.find((f) => f.id === format)?.libelle}` : `${libelle} — choisir le format`}
          aria-label={etat ? texteBouton : n === 0 ? `${libelle} : aucun CIP` : libelle}
          style={{ ...btnBase, flex: compact ? "0 0 auto" : 1, minWidth: 0, ...style, ...(n === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}),
            ...(etat ? { background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1.5px ${t.border}` } : {}) }}>
          <Icone nom={etat ? (etat.ok ? "coche" : "alerte") : "copier"} taille={16} epaisseur={2.2} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{texteBouton}</span>
        </button>
        {/* choix du format : menu sous le bouton (toujours accessible, même avec un format mémorisé) */}
        <button ref={boutonFormat} type="button" className="ex-btn-ligne ex-tactile" onClick={() => setOuvert((o) => !o)} disabled={n === 0}
          aria-haspopup="menu" aria-expanded={ouvert} aria-controls={ouvert ? idMenu : undefined} title="Format de copie : un CIP par ligne, CIP;quantité, CIP tabulation quantité"
          aria-label="Choisir le format de copie des CIP" style={{ ...btnBase, height: style?.height ?? btnBase.height, padding: "0 10px", flexShrink: 0, ...(n === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}>
          Format{/* petit triangle en CSS (un glyphe ▾ sort de la ligne avec la police de repli) */}
          <span aria-hidden="true" style={{ width: 0, height: 0, marginLeft: 2, borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
            ...(ouvert ? { borderBottom: "5px solid currentColor" } : { borderTop: "5px solid currentColor" }) }} />
        </button>
      </div>
      {ouvert && <MenuFormats id={idMenu} format={format} onChoisir={copier} />}
      {etat && !etat.ok && (
        <label style={{ display: "block", marginTop: 6, fontSize: 12, color: T.inkSoft }}>
          Le presse-papiers a été refusé par votre navigateur : sélectionnez le texte ci-dessous et copiez-le (Ctrl + C ou Cmd + C).
          <textarea ref={champ} readOnly value={etat.texte} rows={Math.min(6, Math.max(2, n))} aria-label="CIP à copier à la main"
            style={{ ...ui.input, marginTop: 6, fontFamily: T.mono, fontSize: 12, resize: "vertical" }} />
        </label>
      )}
    </div>
  );
}
