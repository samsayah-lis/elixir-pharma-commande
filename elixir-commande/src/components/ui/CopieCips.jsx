// ── « Copier les CIP » d'un lot de lignes (27/10/2026, docs/cip-copie.md) ──
// Données de la pharmacie seulement — lignes du panier, commande de « Mes commandes », carte commande de l'assistant — jamais un
// menu du catalogue : exception explicite à la règle anti-copie (docs/refonte-charte.md § 19). Chargé à la demande (React.lazy
// dans App ; Mes commandes et l'assistant sont déjà des morceaux à la demande) : rien dans le bundle des pharmacies.
// Bouton partagé en deux : « Copier les CIP » copie tout de suite au dernier format choisi (mémorisé sur l'appareil, src/cip-copie.js) ;
// sans format mémorisé (le bouton principal porte alors aria-haspopup / aria-expanded), ou par le petit bouton « Format », un menu
// propose les trois formats de collage :
//   un CIP par ligne · CIP;quantité · CIP ⇥ quantité (logiciel de la pharmacie, tableur) — quantité servie quand elle est connue.
// Menu (role menu, menuitemradio) : amené dans la zone visible à l'ouverture (le tiroir du panier le coupait par le bas), focus sur le
// format coché (sinon le premier), flèches haut / bas (cycliques), Début / Fin ; Échap ou un choix rendent le focus au bouton d'origine.
// Réussi : « N CIP copiés ✓ » 2 s sur le bouton et le message en bas de l'écran (ToastCopie) ; refusé : « Copie impossible » et le
// texte dans un champ sélectionné, à copier à la main (un champ : l'anti-copie laisse passer).
// Disposition : la racine ne dépasse jamais son conteneur (max-width 100 %, min-width 0 : à 375 px, la rangée débordait de la carte
// de Mes commandes et de la carte de l'assistant) ; le libellé s'ellipse ; sous 768 px, libelleCourt remplace libelle à l'écran
// (title et aria-label gardent le libellé long) ; aide : courte ligne sous le bouton, reprise dans title.
// <CopieCips lignes={cartItems} />  ·  <CopieCips lignes={items} libelle="Copier les CIP de cette commande" libelleCourt="Copier les CIP" compact />
import React, { useEffect, useRef, useState } from "react";
import { T, R, ui, tone } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import { FORMATS_CIP, lignesCip, texteCips, formatMemorise, memoriserFormat, copierTexte, signalerCopie } from "../../cip-copie.js";

const pluriel = (n) => `${n} CIP copié${n > 1 ? "s" : ""}`;
const btnBase = { ...ui.btn("ligne", "m"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, height: 36, padding: "0 14px" };

// Menu des formats (role menu, un choix coché = dernier format) ; Échap et clic hors du menu : fermés par le parent.
// À l'ouverture : amené dans la zone visible du conteneur qui défile, focus sur le choix coché (sinon le premier) ; flèches / Début / Fin.
export function MenuFormats({ format, onChoisir, id }) {
  const racine = useRef(null);
  useEffect(() => {
    const m = racine.current; if (!m) return;
    try { m.scrollIntoView?.({ block: "nearest" }); } catch { /* sans défilement */ }
    (m.querySelector('[aria-checked="true"]') || m.querySelector("button"))?.focus?.({ preventScroll: true });
  }, []);
  const clavier = (e) => {
    const items = [...(racine.current?.querySelectorAll('[role="menuitemradio"]') || [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const vers = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (vers === undefined) return;
    e.preventDefault(); items[vers].focus();
  };
  return (
    <div ref={racine} role="menu" id={id} aria-label="Format de copie des CIP" onKeyDown={clavier}
      style={{ display: "grid", gap: 4, marginTop: 6, padding: 6, background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.s, boxShadow: T.shadow1, maxWidth: "100%" }}>
      {FORMATS_CIP.map((f) => (
        <button key={f.id} type="button" role="menuitemradio" aria-checked={format === f.id} className="ex-btn-ligne ex-copie-format" onClick={() => onChoisir(f.id)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", minWidth: 0, minHeight: 36, padding: "6px 10px", border: "none",
            borderRadius: R.xs, background: format === f.id ? T.surface2 : "transparent", color: T.ink, font: "inherit", fontSize: 13, fontWeight: format === f.id ? 700 : 500, cursor: "pointer", textAlign: "left" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 14, flexShrink: 0, display: "inline-flex", color: T.teal }}>{format === f.id && <Icone nom="coche" taille={14} epaisseur={2.6} />}</span>{f.libelle}
          </span>
          <span className="num" style={{ fontFamily: T.mono, fontSize: 11, color: T.inkMute, whiteSpace: "nowrap" }}>{f.exemple}</span>
        </button>
      ))}
    </div>
  );
}

export default function CopieCips({ lignes, libelle = "Copier les CIP", libelleCourt = null, aide = null, style, compact = false }) {
  const [format, setFormat] = useState(formatMemorise);   // null : aucun format mémorisé encore
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState(null);                 // null | { ok: true, n } | { ok: false, texte }
  const racine = useRef(null), origine = useRef(null), champ = useRef(null);
  const idMenu = React.useId();
  const n = lignesCip(lignes).length;
  const libelleLong = aide ? `${libelle} (${aide})` : libelle;
  // marges extérieures du style reçu : sur la racine (sinon le bouton « Format », qui ne les reçoit pas, se décale de leur moitié) ;
  // la largeur est celle de la rangée (flex), pas du bouton (width: 100 % du style du panier le ferait passer seul sur sa ligne)
  const { marginTop, marginBottom, width: _largeur, ...styleBouton } = style || {};   // eslint-disable-line no-unused-vars

  // menu fermé par Échap (focus rendu au bouton qui l'a ouvert) ou par un clic hors du composant
  useEffect(() => {
    if (!ouvert) return;
    const clavier = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOuvert(false); origine.current?.focus?.({ preventScroll: true }); } };
    const dehors = (e) => { if (racine.current && !racine.current.contains(e.target)) setOuvert(false); };
    document.addEventListener("keydown", clavier); document.addEventListener("mousedown", dehors); document.addEventListener("touchstart", dehors);
    return () => { document.removeEventListener("keydown", clavier); document.removeEventListener("mousedown", dehors); document.removeEventListener("touchstart", dehors); };
  }, [ouvert]);
  // copie refusée : le texte est proposé dans un champ, déjà sélectionné
  useEffect(() => { if (etat && !etat.ok) { champ.current?.focus(); champ.current?.select(); } }, [etat]);

  const ouvrir = (e) => { origine.current = e?.currentTarget || null; setOuvert(true); };
  const copier = (id) => {
    const texte = texteCips(lignes, id);
    memoriserFormat(id); setFormat(id);
    if (ouvert) { setOuvert(false); origine.current?.focus?.({ preventScroll: true }); }   // choix dans le menu : focus rendu au bouton d'origine
    copierTexte(texte).then((ok) => {
      if (ok) { setEtat({ ok: true, n }); signalerCopie(pluriel(n)); setTimeout(() => setEtat(null), 2000); }
      else { setEtat({ ok: false, texte }); signalerCopie("Copie impossible : le texte est à copier à la main", "danger"); }
    });
  };
  const principal = (e) => { if (etat && !etat.ok) setEtat(null); else if (format) copier(format); else if (ouvert) setOuvert(false); else ouvrir(e); };

  const t = etat ? tone(etat.ok ? "ok" : "danger") : null;
  const texteBouton = etat ? (etat.ok ? pluriel(etat.n) : "Copie impossible") : null;
  const nomFormat = format ? FORMATS_CIP.find((f) => f.id === format)?.libelle : null;
  const desactive = n === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {};
  return (
    <div ref={racine} className="ex-copie-cips" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", maxWidth: "100%", minWidth: 0, marginTop, marginBottom, ...(compact ? {} : { width: "100%" }) }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
        <button type="button" className={`ex-tactile${etat ? "" : " ex-btn-ligne"}`} onClick={principal} disabled={n === 0}
          title={n === 0 ? "Aucun CIP dans ces lignes" : nomFormat ? `${libelleLong} — ${nomFormat}` : `${libelleLong} — choisir le format`}
          aria-label={etat ? texteBouton : n === 0 ? `${libelleLong} : aucun CIP` : libelleLong}
          {...(!format && !etat ? { "aria-haspopup": "menu", "aria-expanded": ouvert, "aria-controls": ouvert ? idMenu : undefined } : {})}
          style={{ ...btnBase, flex: compact ? "1 1 auto" : "1 1 0%", minWidth: 0, ...styleBouton, ...desactive,
            ...(etat ? { background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1.5px ${t.border}` } : {}) }}>
          <Icone nom={etat ? (etat.ok ? "coche" : "alerte") : "copier"} taille={16} epaisseur={2.2} />
          {texteBouton
            ? <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{texteBouton}</span>
            : <>
              <span className={libelleCourt ? "ex-copie-cips__long" : undefined} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{libelle}</span>
              {libelleCourt && <span className="ex-copie-cips__court" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{libelleCourt}</span>}
            </>}
        </button>
        {/* choix du format : menu sous le bouton (toujours accessible, même avec un format mémorisé) */}
        <button type="button" className="ex-btn-ligne ex-tactile" onClick={(e) => (ouvert ? setOuvert(false) : ouvrir(e))} disabled={n === 0}
          aria-haspopup="menu" aria-expanded={ouvert} aria-controls={ouvert ? idMenu : undefined} title="Format de copie : un CIP par ligne, CIP;quantité, CIP tabulation quantité"
          aria-label="Choisir le format de copie des CIP" style={{ ...btnBase, height: styleBouton.height ?? btnBase.height, padding: "0 10px", flexShrink: 0, ...desactive }}>
          Format{/* petit triangle en CSS (un glyphe ▾ sort de la ligne avec la police de repli) */}
          <span aria-hidden="true" style={{ width: 0, height: 0, marginLeft: 2, borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
            ...(ouvert ? { borderBottom: "5px solid currentColor" } : { borderTop: "5px solid currentColor" }) }} />
        </button>
      </div>
      {aide && !etat && <div style={{ marginTop: 4, fontSize: 11, color: T.inkMute, lineHeight: 1.3 }}>{aide[0].toUpperCase() + aide.slice(1)}</div>}
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
