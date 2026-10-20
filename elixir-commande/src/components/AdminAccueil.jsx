// ── Admin, « Affichage global » : bloc « Page d'accueil » (docs/accueil.md § 4) ──
// Réglages publiés dans display_config.accueil par saveDisplayConfig (inchangée) : masquer l'accueil (interrupteur
// d'urgence), ouvrir le site sur l'accueil, défilement automatique sur ordinateur, produits exclus de la vitrine.
// Aperçu en lecture seule du classement (GET accueil-offres, jeton admin) : « Exclure » / « Réintégrer » par ligne,
// jamais de CIP à saisir. Une ligne = une famille (tous ses dosages) : l'exclusion retire toute la diapositive, même si le
// dosage principal change ensuite. Une exclusion est filtrée par le navigateur : effet dès la publication, sans recalcul.
// Produit sans photo au catalogue (boîte générée) : « Chercher les photos » lit la banque d'images de l'admin
// (medipim-lookup, comme la fiche produit) pour chaque dosage et publie les adresses trouvées dans
// display_config.accueil.photos (CIP → adresse) ; « Retirer les photos » revient à la boîte générée.
// Trois intertitres dans l'ordre de la page : Mises en avant (AdminVedettes.jsx : vitrine cinéma et grille, clé
// accueil_vedettes publiée par l'éditeur lui-même) · Les plus commandés (aperçu et exclusions) · Réglages (interrupteurs).
import React, { useEffect, useRef, useState } from "react";
import { T, R, fmtEur, ui } from "../theme.js";
import AdminVedettes from "./AdminVedettes.jsx";

const Case = ({ coche, onChange, titre, texte }) => (
  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
    <input type="checkbox" checked={coche} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--teal)" }} />
    <span><span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{titre}</span><span style={{ display: "block", fontSize: 11, color: T.inkMute, marginTop: 2 }}>{texte}</span></span>
  </label>
);

const intertitre = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: T.inkMute, margin: "20px 0 4px", paddingTop: 14, borderTop: "1px solid var(--line)" };

export default function AdminAccueil({ displayConfig, saveDisplayConfig, adminFetch, promos, accents, setTab, onVedettesDirty }) {
  const acc = displayConfig.accueil || {};
  // réglages les plus récents (une recherche de photos se termine après d'autres changements : rien n'est écrasé)
  const accRef = useRef(acc); accRef.current = acc;
  const maj = (patch) => saveDisplayConfig({ accueil: { ...accRef.current, ...patch } });
  const exclus = new Set(acc.exclus || []);
  const photos = acc.photos || {};
  const [recherche, setRecherche] = useState({});   // CIP principal → "…" (en cours) ou message
  const [apercu, setApercu] = useState(null);   // null : chargement ; { erreur } ; réponse du GET
  useEffect(() => {
    if (!adminFetch) return;
    adminFetch("/.netlify/functions/accueil-offres").then(r => (r.ok ? r.json() : { erreur: `HTTP ${r.status}` }))
      .then(setApercu).catch(e => setApercu({ erreur: e.message }));
  }, [adminFetch]);
  const membres = (s) => [s.cip, ...(s.variantes || []).map(v => v.cip)].filter(Boolean);
  const estExclue = (s) => membres(s).some(c => exclus.has(c));
  // Exclure : le CIP principal ; Réintégrer : tous les CIP de la famille (une exclusion faite sur un ancien principal aussi)
  const basculer = (s) => {
    const n = new Set(accRef.current.exclus || []);
    if (estExclue(s)) membres(s).forEach(c => n.delete(c)); else n.add(s.cip);
    maj({ exclus: [...n] });
  };
  const chercherPhotos = async (s) => {
    const cips = [...new Set([s, ...(s.variantes || [])].filter(o => o.cip && !o.image_url).map(o => o.cip))];
    setRecherche(r => ({ ...r, [s.cip]: "…" }));
    const trouvees = {};
    let message = "";
    for (const cip of cips) {
      try {
        const r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${encodeURIComponent(cip)}`);
        if (r.status === 429 || r.status === 503) { message = "Base d'images saturée : réessayez dans une minute"; break; }
        const j = r.ok ? await r.json() : null;
        if (j?.image_url && /^https:\/\//.test(j.image_url)) trouvees[cip] = j.image_url;
      } catch { message = "Base d'images injoignable"; break; }
    }
    const nb = Object.keys(trouvees).length;
    if (nb) maj({ photos: { ...(accRef.current.photos || {}), ...trouvees } });
    setRecherche(r => ({ ...r, [s.cip]: message || (nb ? `${nb} photo${nb > 1 ? "s" : ""} sur ${cips.length}` : "Aucune photo trouvée") }));
  };
  const retirerPhotos = (s) => {
    const n = { ...(accRef.current.photos || {}) };
    membres(s).forEach(c => { delete n[c]; });
    maj({ photos: n });
    setRecherche(r => ({ ...r, [s.cip]: "" }));
  };
  const lignes = apercu?.slides ? [...apercu.slides, ...(apercu.reserves || [])] : [];
  return (
    <div style={{ background: T.surface, borderRadius: 14, padding: "20px 24px", marginBottom: 20, border: "1px solid var(--line)" }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: T.petrol, marginBottom: 10 }}>Page d'accueil</div>
      <AdminVedettes adminFetch={adminFetch} promos={promos} displayConfig={displayConfig} accents={accents} setTab={setTab} onDirtyChange={onVedettesDirty} />
      <div style={intertitre}>Les plus commandés · 15 jours</div>
      <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 8 }}>Vitrine des produits les plus commandés et servis, recalculée toutes les 3 h de 6 h 40 à 21 h 40 ; les pharmacies en voient 10.</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.inkSoft, margin: "12px 0 6px" }}>Classement en cours{apercu?.genere_le ? ` · calculé le ${new Date(apercu.genere_le).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>
      {apercu === null ? <div style={{ fontSize: 12, color: T.inkMute }}>Chargement…</div>
        : apercu.erreur || apercu.perime ? <div style={{ ...ui.encart("warn"), fontSize: 12 }}>{apercu.erreur ? `Classement indisponible (${apercu.erreur}).` : "Classement périmé ou pas encore calculé : la vitrine est masquée chez les pharmacies."}</div>
        : (
          <div style={{ border: "1px solid var(--line)", borderRadius: R.s, overflow: "hidden" }}>
            {lignes.map((s, i) => {
              const ex = estExclue(s), plusieurs = (s.variantes?.length || 0) > 1;
              const photoAdmin = !s.image_url && membres(s).some(c => photos[c]);
              const etat = recherche[s.cip];
              return (
                <div key={s.cip} className="ex-tr" style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) auto auto auto auto", gap: 10, alignItems: "center", padding: "6px 10px", fontSize: 12, opacity: ex ? 0.5 : 1 }}>
                  <b style={{ color: i < 12 ? T.ink : T.inkMute }}>{i < 12 ? s.rang : "R"}</b>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.nom}>
                    {s.nom_court}{plusieurs ? ` (+${s.variantes.length - 1} dosage${s.variantes.length > 2 ? "s" : ""})` : ""} <span style={{ color: T.inkMute }}>· {s.menu?.label} · {s.image_url ? "photo" : photoAdmin ? "photo choisie ici" : "boîte générée"}{etat && etat !== "…" ? ` · ${etat}` : ""}</span>
                  </span>
                  <span className="num" style={{ fontWeight: 700 }}>{fmtEur(s.pn)}</span>
                  <span className="num" style={{ color: T.inkMute }}>{s.lot ? `${s.lot.qte} × ${fmtEur(s.lot.pu)} = ${fmtEur(s.lot.total)}` : ""}</span>
                  {s.image_url ? <span /> : photoAdmin
                    ? <button onClick={() => retirerPhotos(s)} style={{ ...ui.btn("ligne", "s"), height: 28 }}>Retirer {plusieurs ? "les photos" : "la photo"}</button>
                    : <button onClick={() => chercherPhotos(s)} disabled={etat === "…"} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{etat === "…" ? "Recherche…" : plusieurs ? "Chercher les photos" : "Chercher la photo"}</button>}
                  <button onClick={() => basculer(s)} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{ex ? "Réintégrer" : plusieurs ? "Exclure (tous les dosages)" : "Exclure"}</button>
                </div>
              );
            })}
          </div>
        )}
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>R : réserve (remplace une diapositive retirée ou en rupture). Écartés d'office : rupture, justificatif labo, stupéfiant, contingenté, prix anormal.</div>
      <div style={intertitre}>Réglages</div>
      <Case coche={!acc.masque} onChange={v => maj({ masque: !v })} titre="Afficher la page d'accueil"
        texte="Décoché : plus d'entrée « Accueil » ni d'arrivée sur l'accueil (interrupteur d'urgence)." />
      <Case coche={acc.arrivee !== false} onChange={v => maj({ arrivee: v })} titre="Ouvrir le site sur l'accueil"
        texte="Sinon, l'onglet par défaut (étoile ci-dessous). Les liens ?menu= et ?cip= mènent toujours à leur vue." />
      <Case coche={acc.auto !== false} onChange={v => maj({ auto: v })} titre="Défilement automatique des plus commandés sur ordinateur"
        texte="7 s par produit, un tour puis arrêt sur le n°1 ; jamais sur mobile ni si l'utilisateur réduit les animations. En pause tant que la vitrine cinéma défile." />
    </div>
  );
}
