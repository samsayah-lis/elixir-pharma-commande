// ── Admin, « Affichage global » : bloc « Page d'accueil » (docs/accueil.md § 4) ──
// Réglages publiés dans display_config.accueil par saveDisplayConfig (inchangée) : masquer l'accueil (interrupteur
// d'urgence), ouvrir le site sur l'accueil, défilement automatique sur ordinateur, produits exclus de la vitrine.
// Aperçu en lecture seule du classement (GET accueil-offres, jeton admin) : « Exclure » / « Réintégrer » par ligne,
// jamais de CIP à saisir. Une ligne = une famille (tous ses dosages) : l'exclusion retire toute la diapositive, même si le
// dosage principal change ensuite. Une exclusion est filtrée par le navigateur : effet dès la publication, sans recalcul.
// Produit sans photo au catalogue (boîte générée) : « Chercher les photos » lit la banque d'images de l'admin
// (medipim-lookup, comme la fiche produit) pour chaque dosage et publie les adresses trouvées dans
// display_config.accueil.photos (CIP → adresse) ; « Retirer les photos » revient à la boîte générée.
// « Ajouter une photo » (demande de Zineb du 20/10/2026 ; photo-manuelle.js) : photo de l'ordinateur réduite dans le
// navigateur, envoyée par product-upload-image (fonction du catalogue, inchangée) pour le dosage montré et chaque dosage
// sans photo, publiée de même dans display_config.accueil.photos (adresse avec ?v=) ; « Retirer » revient à la boîte
// générée. Produit rangé dans un menu du catalogue : la fonction en fait aussi la photo du produit (image_url, avec ?v=
// par un second appel) ; elle paraît dans son menu (grilles) et l'accueil la préfère. Aucune fonction ne sait la retirer
// du catalogue : la ligne passe en « photo ajoutée ici (aussi au catalogue) », remplaçable d'ici, plus retirable.
// Trois intertitres dans l'ordre de la page : Mises en avant (AdminVedettes.jsx : vitrine cinéma et grille, clé
// accueil_vedettes publiée par l'éditeur lui-même) · Les plus commandés (aperçu et exclusions) · Réglages (interrupteurs).
import React, { useEffect, useRef, useState } from "react";
import { T, R, fmtEur, ui } from "../theme.js";
import AdminVedettes from "./AdminVedettes.jsx";
import { ACCEPT, AIDE, auCatalogue, ciblesFamille, controlerFichier, envoyerPhoto, estPhotoEnvoyee, poseeIci, portee, preparerPhoto,
  versionnerAuCatalogue } from "./photo-manuelle.js";

const Case = ({ coche, onChange, titre, texte }) => (
  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
    <input type="checkbox" checked={coche} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--teal)" }} />
    <span><span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{titre}</span><span style={{ display: "block", fontSize: 11, color: T.inkMute, marginTop: 2 }}>{texte}</span></span>
  </label>
);

const intertitre = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: T.inkMute, margin: "20px 0 4px", paddingTop: 14, borderTop: "1px solid var(--line)" };

export default function AdminAccueil({ displayConfig, saveDisplayConfig, adminFetch, promos, accents, setTab, onVedettesDirty }) {
  const acc = displayConfig.accueil || {};
  // réglages les plus récents (une recherche ou un envoi de photos se termine après d'autres changements : rien n'est
  // écrasé, même deux fins de suite avant le rendu suivant), publiés par la dernière saveDisplayConfig (reste de
  // display_config à jour ; publication avec base, 409 si un autre poste l'a modifiée)
  const accRef = useRef(acc); accRef.current = acc;
  const saveRef = useRef(saveDisplayConfig); saveRef.current = saveDisplayConfig;
  const maj = (patch) => { accRef.current = { ...accRef.current, ...patch }; saveRef.current({ accueil: accRef.current }); };
  const exclus = new Set(acc.exclus || []);
  const photos = acc.photos || {};
  const [etats, setEtats] = useState({});   // CIP principal → { occupe: "recherche" | "envoi" | null, message, ton }
  const noter = (cip, e) => setEtats(x => ({ ...x, [cip]: { occupe: null, message: "", ton: "neutral", ...e } }));
  const fichierRef = useRef(null), ligneRef = useRef(null);   // sélecteur de fichier unique ; ligne qui l'a ouvert
  const [apercu, setApercu] = useState(null);   // null : chargement ; { erreur } ; réponse du GET
  useEffect(() => {
    if (!adminFetch) return;
    adminFetch("/.netlify/functions/accueil-offres").then(r => (r.ok ? r.json() : { erreur: `HTTP ${r.status}` }))
      .then(setApercu).catch(e => setApercu({ erreur: e.message }));
  }, [adminFetch]);
  const membres = (s) => [s.cip, ...(s.variantes || []).map(v => v.cip)].filter(Boolean);
  // dosages de la ligne (objets du GET), chacun une fois ; la ligne principale figure aussi parmi les variantes
  const dosages = (s) => { const vus = new Set(); return [s, ...(s.variantes || [])].filter(o => o?.cip && !vus.has(o.cip) && vus.add(o.cip)); };
  const estExclue = (s) => membres(s).some(c => exclus.has(c));
  // Exclure : le CIP principal ; Réintégrer : tous les CIP de la famille (une exclusion faite sur un ancien principal aussi)
  const basculer = (s) => {
    const n = new Set(accRef.current.exclus || []);
    if (estExclue(s)) membres(s).forEach(c => n.delete(c)); else n.add(s.cip);
    maj({ exclus: [...n] });
  };
  const chercherPhotos = async (s) => {
    const cips = [...new Set([s, ...(s.variantes || [])].filter(o => o.cip && !o.image_url).map(o => o.cip))];
    noter(s.cip, { occupe: "recherche" });
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
    noter(s.cip, { message: message || (nb ? `${nb} photo${nb > 1 ? "s" : ""} trouvée${nb > 1 ? "s" : ""} sur ${cips.length}` : "Aucune photo trouvée"), ton: message ? "warn" : "neutral" });
  };
  const choisirPhoto = (s) => {
    ligneRef.current = s;
    if (fichierRef.current) { fichierRef.current.value = ""; fichierRef.current.click(); }
  };
  // photo posée au catalogue par la fonction : l'aperçu la montre comme après un rechargement (CIP → adresse)
  const poserAuCatalogue = (urls) => setApercu(a => {
    if (!a?.slides) return a;
    const pose = (o) => (urls[o.cip] ? { ...o, image_url: urls[o.cip] } : o);
    const ligne = (s) => ({ ...pose(s), variantes: (s.variantes || []).map(pose) });
    return { ...a, slides: a.slides.map(ligne), reserves: (a.reserves || []).map(ligne) };
  });
  const ajouterPhoto = async (s, fichier) => {
    const refus = controlerFichier(fichier);
    if (refus) { noter(s.cip, { message: refus, ton: "danger" }); return; }
    noter(s.cip, { occupe: "envoi", message: "Préparation de la photo…" });
    let prete;
    try { prete = await preparerPhoto(fichier); } catch (e) { noter(s.cip, { message: e.message, ton: "danger" }); return; }
    const avant = accRef.current.photos || {};
    const tous = dosages(s), parCip = Object.fromEntries(tous.map(o => [o.cip, o]));
    const cips = ciblesFamille(s, avant);
    const remplace = cips.some(c => avant[c] || parCip[c]?.image_url);
    const t = Date.now(), recues = {}, auCat = {};
    let erreur = "";
    for (const [k, cip] of cips.entries()) {
      noter(s.cip, { occupe: "envoi", message: cips.length > 1 ? `Envoi de la photo : dosage ${k + 1} sur ${cips.length}…` : "Envoi de la photo…" });
      try { recues[cip] = await envoyerPhoto(adminFetch, cip, prete, t); } catch (e) { erreur = e.message; break; }
      // produit du catalogue : la fonction y a rangé la photo (adresse sans ?v=) ; l'adresse avec ?v= l'y remplace
      if (auCatalogue(parCip[cip])) auCat[cip] = (await versionnerAuCatalogue(adminFetch, cip, recues[cip])) ? recues[cip] : recues[cip].split("?")[0];
    }
    const nb = Object.keys(recues).length;
    if (nb) maj({ photos: { ...(accRef.current.photos || {}), ...recues } });
    if (Object.keys(auCat).length) poserAuCatalogue(auCat);
    const verbe = remplace ? "remplacée" : "ajoutée", gardees = tous.length - cips.length;
    const combien = tous.length < 2 ? "" : ` (${nb} dosage${nb > 1 ? "s" : ""}${nb < cips.length ? ` sur ${cips.length}` : ""}${gardees ? ` ; ${gardees > 1 ? `${gardees} gardent leur` : "1 garde sa"} propre photo` : ""})`;
    const p = portee(Object.keys(recues).map(c => parCip[c]));
    noter(s.cip, !nb ? { message: erreur, ton: "danger" }
      : erreur ? { message: `Photo ${verbe}${combien}, puis arrêt : ${erreur}`, ton: "warn" }
        : { message: `✓ Photo ${verbe}${combien} : visible sur l'accueil${remplace ? "" : " à la place de la boîte générée"}${p.menus.length ? `, et dans le menu « ${p.menus.join(" », « ")} »` : ""}.`
          + (p.catalogue ? " C'est aussi la photo du produit au catalogue : elle se remplace d'ici, mais ne s'en retire plus." : ""), ton: "ok" });
  };
  const retirerPhotos = (s) => {
    const n = { ...(accRef.current.photos || {}) };
    const restent = dosages(s).filter(o => poseeIci(o.image_url, n[o.cip])).length;   // rangées au catalogue : y restent
    membres(s).forEach(c => { delete n[c]; });
    maj({ photos: n });
    noter(s.cip, restent ? { message: `Retirée de l'accueil pour ce produit ; ${restent > 1 ? `${restent} dosages gardent` : "1 dosage garde"} la photo au catalogue (son menu), que l'accueil montre aussi.`, ton: "warn" } : {});
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
              const posee = poseeIci(s.image_url, photos[s.cip]);   // photo du catalogue envoyée d'ici : se remplace d'ici
              const etat = etats[s.cip] || {}, occupe = !!etat.occupe;
              const statut = s.image_url ? (posee ? "photo ajoutée ici (aussi au catalogue)" : "photo")
                : photoAdmin ? (estPhotoEnvoyee(photos[s.cip]) ? "photo ajoutée ici" : "photo choisie ici") : "boîte générée";
              return (
                // une ligne qui passe à la ligne : boutons sous le nom quand la place manque (le nom garde 220 px au moins)
                <div key={s.cip} className="ex-tr" style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center", padding: "6px 10px", fontSize: 12, opacity: ex ? 0.5 : 1 }}>
                  <b style={{ width: 28, flexShrink: 0, color: i < 12 ? T.ink : T.inkMute }}>{i < 12 ? s.rang : "R"}</b>
                  <span style={{ flex: "1 1 220px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.nom}>
                    {s.nom_court}{plusieurs ? ` (+${s.variantes.length - 1} dosage${s.variantes.length > 2 ? "s" : ""})` : ""} <span style={{ color: T.inkMute }}>· {s.menu?.label} · {statut}</span>
                  </span>
                  <span className="num" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtEur(s.pn)}</span>
                  <span className="num" style={{ color: T.inkMute, whiteSpace: "nowrap" }}>{s.lot ? `${s.lot.qte} × ${fmtEur(s.lot.pu)} = ${fmtEur(s.lot.total)}` : ""}</span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" }}>
                    {!s.image_url && (photoAdmin
                      ? <button onClick={() => retirerPhotos(s)} disabled={occupe} style={{ ...ui.btn("ligne", "s"), height: 28 }}>Retirer {plusieurs ? "les photos" : "la photo"}</button>
                      : <button onClick={() => chercherPhotos(s)} disabled={occupe} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{etat.occupe === "recherche" ? "Recherche…" : plusieurs ? "Chercher les photos" : "Chercher la photo"}</button>)}
                    {(!s.image_url || posee) && (
                      <button onClick={() => choisirPhoto(s)} disabled={occupe} title={AIDE} aria-label={`${photoAdmin || posee ? "Remplacer la photo" : "Ajouter une photo"} de ${s.nom_court}`}
                        style={{ ...ui.btn("ligne", "s"), height: 28, minWidth: 128 }}>{etat.occupe === "envoi" ? "Envoi…" : photoAdmin || posee ? "Remplacer la photo" : "Ajouter une photo"}</button>
                    )}
                    <button onClick={() => basculer(s)} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{ex ? "Réintégrer" : plusieurs ? "Exclure (tous les dosages)" : "Exclure"}</button>
                  </span>
                  {etat.message && <span role="status" style={{ flexBasis: "100%", paddingLeft: 38, fontSize: 11, marginTop: -2, color: { ok: T.ok, warn: T.warn, danger: T.danger }[etat.ton] || T.inkMute }}>{etat.message}</span>}
                </div>
              );
            })}
          </div>
        )}
      <input ref={fichierRef} type="file" accept={ACCEPT} hidden onChange={e => { const f = e.target.files?.[0], s = ligneRef.current; e.target.value = ""; if (f && s) ajouterPhoto(s, f); }} />
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>R : réserve (remplace une diapositive retirée ou en rupture). Écartés d'office : rupture, justificatif labo, stupéfiant, contingenté, prix anormal.</div>
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>Ajouter une photo : JPG, PNG ou WebP de votre ordinateur (15 Mo au plus, réduite avant l'envoi), pour le dosage montré et les dosages sans photo. Produit rangé dans un menu du catalogue : elle devient aussi sa photo dans ce menu, puis se remplace d'ici mais ne s'en retire plus.</div>
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
