// ── Admin, « Affichage global » : bloc « Page d'accueil » (docs/accueil.md § 4) ──
// Réglages publiés dans display_config.accueil par saveDisplayConfig (inchangée) : masquer l'accueil (interrupteur
// d'urgence), ouvrir le site sur l'accueil, défilement automatique sur ordinateur, produits exclus de la vitrine.
// Aperçu en lecture seule du classement (GET accueil-offres, jeton admin) : « Exclure » / « Réintégrer » par ligne,
// jamais de CIP à saisir. Une exclusion est filtrée par le navigateur : effet dès la publication, sans recalcul.
import React, { useEffect, useState } from "react";
import { T, R, fmtEur, ui } from "../theme.js";

const Case = ({ coche, onChange, titre, texte }) => (
  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
    <input type="checkbox" checked={coche} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--teal)" }} />
    <span><span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{titre}</span><span style={{ display: "block", fontSize: 11, color: T.inkMute, marginTop: 2 }}>{texte}</span></span>
  </label>
);

export default function AdminAccueil({ displayConfig, saveDisplayConfig, adminFetch }) {
  const acc = displayConfig.accueil || {};
  const maj = (patch) => saveDisplayConfig({ accueil: { ...acc, ...patch } });
  const exclus = new Set(acc.exclus || []);
  const [apercu, setApercu] = useState(null);   // null : chargement ; { erreur } ; réponse du GET
  useEffect(() => {
    if (!adminFetch) return;
    adminFetch("/.netlify/functions/accueil-offres").then(r => (r.ok ? r.json() : { erreur: `HTTP ${r.status}` }))
      .then(setApercu).catch(e => setApercu({ erreur: e.message }));
  }, [adminFetch]);
  const basculer = (cip) => { const n = new Set(exclus); if (n.has(cip)) n.delete(cip); else n.add(cip); maj({ exclus: [...n] }); };
  const lignes = apercu?.slides ? [...apercu.slides, ...(apercu.reserves || [])] : [];
  return (
    <div style={{ background: T.surface, borderRadius: 14, padding: "20px 24px", marginBottom: 20, border: "1px solid var(--line)" }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: T.petrol, marginBottom: 4 }}>Page d'accueil · les plus commandés (15 jours)</div>
      <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 8 }}>Vitrine des produits les plus commandés et servis, recalculée toutes les 3 h de 6 h 40 à 21 h 40 ; les pharmacies en voient 10.</div>
      <Case coche={!acc.masque} onChange={v => maj({ masque: !v })} titre="Afficher la page d'accueil"
        texte="Décoché : plus d'entrée « Accueil » ni d'arrivée sur l'accueil (interrupteur d'urgence)." />
      <Case coche={acc.arrivee !== false} onChange={v => maj({ arrivee: v })} titre="Ouvrir le site sur l'accueil"
        texte="Sinon, l'onglet par défaut (étoile ci-dessous). Les liens ?menu= et ?cip= mènent toujours à leur vue." />
      <Case coche={acc.auto !== false} onChange={v => maj({ auto: v })} titre="Défilement automatique sur ordinateur"
        texte="7 s par produit, un tour puis arrêt sur le n°1 ; jamais sur mobile ni si l'utilisateur réduit les animations." />
      <div style={{ fontSize: 12, fontWeight: 700, color: T.inkSoft, margin: "12px 0 6px" }}>Classement en cours{apercu?.genere_le ? ` · calculé le ${new Date(apercu.genere_le).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>
      {apercu === null ? <div style={{ fontSize: 12, color: T.inkMute }}>Chargement…</div>
        : apercu.erreur || apercu.perime ? <div style={{ ...ui.encart("warn"), fontSize: 12 }}>{apercu.erreur ? `Classement indisponible (${apercu.erreur}).` : "Classement périmé ou pas encore calculé : la vitrine est masquée chez les pharmacies."}</div>
        : (
          <div style={{ border: "1px solid var(--line)", borderRadius: R.s, overflow: "hidden" }}>
            {lignes.map((s, i) => {
              const ex = exclus.has(s.cip);
              return (
                <div key={s.cip} className="ex-tr" style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) auto auto auto", gap: 10, alignItems: "center", padding: "6px 10px", fontSize: 12, opacity: ex ? 0.5 : 1 }}>
                  <b style={{ color: i < 12 ? T.ink : T.inkMute }}>{i < 12 ? s.rang : "R"}</b>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.nom}>
                    {s.nom_court}{s.variantes?.length ? ` (+${s.variantes.length - 1} dosage${s.variantes.length > 2 ? "s" : ""})` : ""} <span style={{ color: T.inkMute }}>· {s.menu?.label} · {s.image_url ? "photo" : "boîte générée"}</span>
                  </span>
                  <span className="num" style={{ fontWeight: 700 }}>{fmtEur(s.pn)}</span>
                  <span className="num" style={{ color: T.inkMute }}>{s.lot ? `${s.lot.qte} × ${fmtEur(s.lot.pu)} = ${fmtEur(s.lot.total)}` : ""}</span>
                  <button onClick={() => basculer(s.cip)} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{ex ? "Réintégrer" : "Exclure"}</button>
                </div>
              );
            })}
          </div>
        )}
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>R : réserve (remplace une diapositive retirée ou en rupture). Écartés d'office : rupture, justificatif labo, stupéfiant, contingenté, prix anormal.</div>
    </div>
  );
}
