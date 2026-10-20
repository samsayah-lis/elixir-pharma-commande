// ── Admin, « Affichage global » : bloc « Page d'accueil » (docs/accueil.md § 4) ──
// Réglages publiés dans display_config.accueil par majAccueil (AdminPanel ; saveDisplayConfig inchangée) : masquer l'accueil (interrupteur
// d'urgence), ouvrir le site sur l'accueil, défilement automatique sur ordinateur, produits exclus de la vitrine.
// Aperçu en lecture seule du classement (GET accueil-offres, jeton admin) : « Exclure » / « Réintégrer » par ligne,
// jamais de CIP à saisir. Une ligne = une famille (tous ses dosages) : l'exclusion retire toute la diapositive, même si le
// dosage principal change ensuite. Une exclusion est filtrée par le navigateur : effet dès la publication, sans recalcul.
// Produit sans photo au catalogue (boîte générée) : « Chercher les photos » lit la banque d'images de l'admin
// (medipim-lookup, comme la fiche produit) pour chaque dosage et publie les adresses trouvées dans
// display_config.accueil.photos (CIP → adresse) ; « Retirer les photos » revient à la boîte générée.
// « Ajouter une photo » (demande de Zineb du 20/10/2026 ; photo-manuelle.js) : photo de l'ordinateur réduite dans le
// navigateur, envoyée UNE fois par product-upload-image (fonction du catalogue, inchangée) pour le dosage montré, puis publiée
// de même dans display_config.accueil.photos (adresse avec ?v=) pour lui et chaque autre dosage de même forme sans photo
// (accueil seulement : jamais écrite au catalogue d'un dosage non montré) ; « Retirer » revient à la boîte générée. Dosage
// montré rangé dans un menu du catalogue : après confirmation, la photo devient aussi la sienne au catalogue (clé = CIP,
// image_url avec ?v= par un second appel) ; aucune fonction ne sait l'en retirer : la ligne passe en « photo ajoutée ici
// (aussi au catalogue) », remplaçable d'ici, plus retirable. Ce lien se lit dans accueil.photos (liee), jamais dans
// l'image_url du GET, qui peut être en retard. Hors catalogue : clé « accueil-… », le catalogue n'est pas touché.
// Publication : majAccueil (AdminPanel) applique seulement le changement voulu à la DERNIÈRE version des réglages, même
// si l'onglet a été quitté ou remonté pendant l'envoi ; l'état d'envoi de chaque ligne vit hors du composant.
// Affichage vérifié (incident du 20/10/2026, stockage des photos privé ; envoyerEtVerifier de photo-manuelle.js) : la
// photo envoyée doit s'afficher dans le navigateur avant d'être publiée et annoncée ; sinon rien n'est publié et le message
// dit pourquoi, d'après la réponse du stockage (docs/accueil.md, « Stockage des photos »). Produit du catalogue : le
// stockage est TOUJOURS sondé avant l'envoi (l'envoi écrit l'adresse dans sa fiche avant toute vérification) ; refus si
// son état n'est pas établi ; photo envoyée qui ne s'affiche pas : son ancienne photo (autre fichier) lui est remise.
// Photos de la liste qui ne s'affichent pas : « Photo illisible » sur la ligne, avec son motif et ce que l'accueil montre
// à la place, et « Vérifier de nouveau ».
// Trois intertitres dans l'ordre de la page : Mises en avant (AdminVedettes.jsx : vitrine cinéma et grille, clé
// accueil_vedettes publiée par l'éditeur lui-même) · Les plus commandés (aperçu et exclusions) · Réglages (interrupteurs).
import React, { useEffect, useRef, useState } from "react";
import { T, R, fmtEur, ui } from "../theme.js";
import AdminVedettes from "./AdminVedettes.jsx";
import { ACCEPT, AIDE, abonnerLignes, auCatalogue, cleEnvoi, controlerAffichage, controlerFichier, envoyerEtVerifier, estPhotoEnvoyee, etatLigne,
  expliquerIllisible, illisibleCarPrive, liee, noterLigne, portee, preparerPhoto, questionCatalogue, raisonIllisible, repartitionFamille,
  reverifierIllisibles, suivre } from "./photo-manuelle.js";
import { estIllisible } from "./accueil/illisibles.js";
import { photo, useIllisibles } from "./accueil/outils.js";

const Case = ({ coche, onChange, titre, texte }) => (
  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
    <input type="checkbox" checked={coche} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--teal)" }} />
    <span><span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{titre}</span><span style={{ display: "block", fontSize: 11, color: T.inkMute, marginTop: 2 }}>{texte}</span></span>
  </label>
);

const intertitre = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: T.inkMute, margin: "20px 0 4px", paddingTop: 14, borderTop: "1px solid var(--line)" };
// zone de message d'une ligne : toujours présente (lue par les lecteurs d'écran dès son premier message), masquée vide
const CACHE = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" };
const BANDEAU = " : voir le bandeau en haut de l'admin.";   // publication refusée (409, écart non tranché, erreur)
const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);
const guillemets = (l) => l.map(x => `« ${x} »`).join(", ");

export default function AdminAccueil({ displayConfig, majAccueil, adminFetch, promos, accents, setTab, onVedettesDirty }) {
  const acc = displayConfig.accueil || {};
  const exclus = new Set(acc.exclus || []);
  const photos = acc.photos || {};
  // état de chaque ligne (CIP du dosage montré → { occupe, message, ton }) : hors du composant (photo-manuelle.js)
  const [, rafraichir] = useState(0);
  useEffect(() => abonnerLignes(() => rafraichir(n => n + 1)), []);
  useIllisibles();   // photo de la liste notée illisible (contrôle ci-dessous) : ligne redessinée
  const [reverif, setReverif] = useState(null);   // null | "en cours" | message du dernier essai
  const noter = noterLigne;
  const fichierRef = useRef(null), ligneRef = useRef(null);   // sélecteur de fichier unique ; ligne qui l'a ouvert
  const [apercu, setApercu] = useState(null);   // null : chargement ; { erreur } ; réponse du GET
  useEffect(() => {
    if (!adminFetch) return;
    // sans cache HTTP (la fonction répond « max-age=60 ») : photos du catalogue à jour au retour sur l'onglet
    adminFetch("/.netlify/functions/accueil-offres", { cache: "no-store" }).then(r => (r.ok ? r.json() : { erreur: `HTTP ${r.status}` }))
      .then(setApercu).catch(e => setApercu({ erreur: e.message }));
  }, [adminFetch]);
  const membres = (s) => [s.cip, ...(s.variantes || []).map(v => v.cip)].filter(Boolean);
  // dosages de la ligne (objets du GET), chacun une fois ; la ligne principale figure aussi parmi les variantes
  const dosages = (s) => { const vus = new Set(); return [s, ...(s.variantes || [])].filter(o => o?.cip && !vus.has(o.cip) && vus.add(o.cip)); };
  const sansPhoto = (s) => dosages(s).filter(o => !o.image_url && !photos[o.cip]);   // boîte générée
  const estExclue = (s) => membres(s).some(c => exclus.has(c));
  // Exclure : le CIP principal ; Réintégrer : tous les CIP de la famille (une exclusion faite sur un ancien principal aussi)
  const basculer = (s) => {
    const reintegrer = estExclue(s);
    majAccueil(a => {
      const n = new Set(a.exclus || []);
      if (reintegrer) membres(s).forEach(c => n.delete(c)); else n.add(s.cip);
      return { ...a, exclus: [...n] };
    });
  };
  // photos ajoutées à la dernière version des réglages (seulement ces CIP) → résultat de la publication
  const publierPhotos = (recues) => majAccueil(a => ({ ...a, photos: { ...(a.photos || {}), ...recues } }));
  const chercherPhotos = (s) => suivre((async () => {
    const cips = sansPhoto(s).map(o => o.cip);
    noter(s.cip, { occupe: "recherche", message: "Recherche dans la banque d'images…" });
    const trouvees = {};
    let message = "";
    for (const cip of cips) {
      try {
        const r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${encodeURIComponent(cip)}`);
        if (r.status === 429 || r.status === 503) { message = "Base d'images saturée : réessayez dans une minute."; break; }
        const j = r.ok ? await r.json() : null;
        if (j?.image_url && /^https:\/\//.test(j.image_url)) trouvees[cip] = j.image_url;
      } catch { message = "Base d'images injoignable."; break; }
    }
    const nb = Object.keys(trouvees).length;
    // une photo posée entre-temps sur un de ces dosages n'est jamais remplacée par la recherche
    const r = nb ? await majAccueil(a => ({ ...a, photos: { ...Object.fromEntries(Object.entries(trouvees).filter(([c]) => !(a.photos || {})[c])), ...(a.photos || {}) } })) : { ok: true };
    const bilan = nb ? `${nb} photo${nb > 1 ? "s" : ""} trouvée${nb > 1 ? "s" : ""} sur ${cips.length}` : "Aucune photo trouvée";
    noter(s.cip, !r.ok ? { message: `${bilan}, mais pas encore ${pluriel(nb, "publiée", "publiées")} sur l'accueil${BANDEAU}`, ton: "warn" }
      : message ? { message: `${bilan}. ${message}`, ton: "warn" } : { message: `${bilan}.`, ton: "neutral" });
  })());
  const choisirPhoto = (s) => {
    ligneRef.current = s;
    if (fichierRef.current) { fichierRef.current.value = ""; fichierRef.current.click(); }
  };
  const ajouterPhoto = (s, fichier) => {
    if (etatLigne(s.cip)?.occupe) return;
    const refus = controlerFichier(fichier);
    if (refus) { noter(s.cip, { message: refus, ton: "danger" }); return; }
    const { cibles, gardees } = repartitionFamille(s, photos);
    const versCatalogue = auCatalogue(s), dejaLiee = liee(s, photos);
    // premier envoi d'un produit du catalogue : la photo y deviendra la sienne, sans retour possible d'ici
    if (versCatalogue && !dejaLiee && !window.confirm(questionCatalogue(s, cibles.length - 1))) {
      noter(s.cip, { message: "Rien n'a été envoyé.", ton: "neutral" });
      return;
    }
    const tous = dosages(s), parCip = Object.fromEntries(tous.map(o => [o.cip, o]));
    const remplace = cibles.some(c => photos[c]);
    return suivre((async () => {
      noter(s.cip, { occupe: "envoi", message: "Préparation de la photo…" });
      let prete;
      try { prete = await preparerPhoto(fichier); } catch (e) { noter(s.cip, { message: e.message, ton: "danger" }); return; }
      // sonde du stockage (produit du catalogue), envoi, affichage vérifié, adresse avec ?v= rangée au catalogue, puis
      // seulement publication (photo-manuelle.js, envoyerEtVerifier) ; échec : rien de publié, message avec le motif
      const t = Date.now();
      const connues = [...Object.values(photos), ...(apercu?.slides || []), ...(apercu?.reserves || [])].flatMap(x => (typeof x === "string" ? [x] : dosages(x).map(o => o.image_url)));
      const res = await envoyerEtVerifier({ adminFetch, cle: cleEnvoi(s, t), prete, t, candidats: connues,
        catalogue: versCatalogue ? { cip: s.cip, ancienne: s.image_url || (dejaLiee ? photos[s.cip] : null) } : null,
        publier: (url) => publierPhotos(Object.fromEntries(cibles.map(c => [c, url]))),
        etape: (message) => noter(s.cip, { occupe: "envoi", message }) });
      if (!res.url) { noter(s.cip, { message: res.message, ton: res.ton }); return; }
      const r = res.publication || { ok: false };
      const n = cibles.length, verbe = remplace ? "remplacée" : "ajoutée";
      const dosagesTxt = tous.length < 2 ? "" : n === tous.length ? ` pour les ${n} dosages` : ` pour ${n} dosage${n > 1 ? "s" : ""} sur ${tous.length}`;
      const par = (raison) => gardees.filter(g => g.raison === raison);
      const forme = par("forme"), cat = par("catalogue"), banque = par("banque");
      const restes = [
        forme.length ? `${guillemets(forme.map(g => g.libelle))} (autre forme de boîte) ne ${pluriel(forme.length, "la reçoit", "la reçoivent")} pas.` : "",
        cat.length ? `${cat.length} ${pluriel(cat.length, "dosage garde sa", "dosages gardent leur")} photo du catalogue.` : "",
        banque.length ? `${banque.length} ${pluriel(banque.length, "dosage garde sa", "dosages gardent leur")} photo de la banque d'images.` : "",
      ].filter(Boolean).join(" ");
      const menus = portee([parCip[s.cip] || s]).menus;
      const auCat = !versCatalogue ? ""
        : dejaLiee ? ` C'est aussi la nouvelle photo du produit dans le catalogue${menus.length ? ` (menu « ${menus[0]} »)` : ""}.`
          : ` Elle est aussi devenue la photo du produit dans le catalogue${menus.length ? ` (menu « ${menus[0]} »)` : ""} : vous pourrez la remplacer d'ici, pas la retirer.`;
      noter(s.cip, !r.ok
        ? { message: `Photo envoyée, mais pas encore publiée sur l'accueil${BANDEAU}${versCatalogue ? " Elle est déjà la photo du produit dans le catalogue." : ""}`, ton: "warn" }
        : { message: `✓ Photo ${verbe} sur l'accueil${dosagesTxt}${remplace ? "" : ", à la place de la boîte générée"}.${auCat}${restes ? ` ${restes}` : ""}`, ton: "ok" });
    })());
  };
  // Retirer : seulement les photos de l'accueil seul ; une photo devenue celle du catalogue reste (l'accueil la montre)
  const retirerPhotos = (s) => {
    const lies = dosages(s).filter(o => liee(o, photos));
    const cips = dosages(s).filter(o => photos[o.cip] && !liee(o, photos)).map(o => o.cip);
    majAccueil(a => { const n = { ...(a.photos || {}) }; cips.forEach(c => { delete n[c]; }); return { ...a, photos: n }; })
      .then(r => noter(s.cip, !r.ok ? { message: `Retrait pas encore publié sur l'accueil${BANDEAU}`, ton: "warn" }
        : lies.length ? { message: `Photos retirées, sauf pour ${lies.length} dosage${lies.length > 1 ? "s" : ""} dont la photo est aussi celle du catalogue : l'accueil continue de la montrer.`, ton: "warn" }
          : { message: `✓ ${cips.length > 1 ? "Photos retirées" : "Photo retirée"} de l'accueil.`, ton: "neutral" }));
  };
  const lignes = apercu?.slides ? [...apercu.slides, ...(apercu.reserves || [])] : [];
  // photos montrées par la liste (catalogue, choisies ici) : contrôlées une fois chacune ; illisible → « Photo illisible »
  const photosListe = [...new Set(lignes.flatMap(s => [s.image_url, ...dosages(s).map(o => photos[o.cip])]).filter(Boolean))];
  const clePhotos = photosListe.join("|");
  useEffect(() => { photosListe.forEach(u => controlerAffichage(u, { variante: photo(u, "thumbnail") })); }, [clePhotos]);   // eslint-disable-line react-hooks/exhaustive-deps
  const illisiblesListe = photosListe.filter(estIllisible);
  // motif de chaque photo du stockage illisible (lu dans la réponse du stockage, jamais deviné)
  const cleIllisibles = illisiblesListe.join("|");
  useEffect(() => { illisiblesListe.forEach(u => expliquerIllisible(u)); }, [cleIllisibles]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reverifier = async () => {
    setReverif("en cours");
    const n = await reverifierIllisibles(illisiblesListe);
    const reste = illisiblesListe.length - n;
    setReverif(reste ? `${reste} photo${reste > 1 ? "s" : ""} toujours illisible${reste > 1 ? "s" : ""}.` : "✓ Toutes les photos s'affichent de nouveau.");
  };
  // ce que l'accueil montre pour le dosage montré d'une ligne : photo du catalogue, puis celle choisie ici, sinon la boîte
  const montreeAlaPlace = (s) => { const u = [s.image_url, photos[s.cip]].find(x => x && !estIllisible(x)); return !u ? "la boîte générée" : u === s.image_url ? "la photo du catalogue" : "la photo choisie ici"; };
  return (
    <div style={{ background: T.surface, borderRadius: 14, padding: "20px 24px", marginBottom: 20, border: "1px solid var(--line)" }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: T.petrol, marginBottom: 10 }}>Page d'accueil</div>
      <AdminVedettes adminFetch={adminFetch} promos={promos} displayConfig={displayConfig} accents={accents} setTab={setTab} onDirtyChange={onVedettesDirty} />
      <div style={intertitre}>Les plus commandés · 15 jours</div>
      <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 8 }}>Vitrine des produits les plus commandés et servis, recalculée toutes les 3 h de 6 h 40 à 21 h 40 ; les pharmacies en voient 10.</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.inkSoft, margin: "12px 0 6px" }}>Classement en cours{apercu?.genere_le ? ` · calculé le ${new Date(apercu.genere_le).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>
      {illisiblesListe.length > 0 && (
        <div role="status" style={{ ...ui.encart("warn"), fontSize: 12, margin: "6px 0 8px" }}>
          ⚠ {illisiblesListe.length} photo{illisiblesListe.length > 1 ? "s" : ""} de cette liste ne s'affiche{illisiblesListe.length > 1 ? "nt" : ""} pas (lignes marquées « Photo illisible ») : l'accueil {illisiblesListe.length > 1 ? "les remplace" : "la remplace"} par une autre photo du produit ou par la boîte générée.
          {illisiblesListe.some(illisibleCarPrive) ? " Stockage des photos pas public : réglage à faire une seule fois dans Supabase (docs/accueil.md, « Stockage des photos ») ; ensuite, « Vérifier de nouveau »." : ""}
          <button type="button" onClick={reverifier} disabled={reverif === "en cours"} style={{ ...ui.btn("ligne", "s"), height: 26, marginLeft: 8 }}>{reverif === "en cours" ? "Vérification…" : "Vérifier de nouveau"}</button>
          {reverif && reverif !== "en cours" && <span style={{ marginLeft: 8 }}>{reverif}</span>}
        </div>
      )}
      {illisiblesListe.length === 0 && reverif && reverif !== "en cours" && <div role="status" style={{ fontSize: 12, color: T.ok, margin: "6px 0" }}>{reverif}</div>}
      {apercu === null ? <div style={{ fontSize: 12, color: T.inkMute }}>Chargement…</div>
        : apercu.erreur || apercu.perime ? <div style={{ ...ui.encart("warn"), fontSize: 12 }}>{apercu.erreur ? `Classement indisponible (${apercu.erreur}).` : "Classement périmé ou pas encore calculé : la vitrine est masquée chez les pharmacies."}</div>
        : (
          <div style={{ border: "1px solid var(--line)", borderRadius: R.s, overflow: "hidden" }}>
            {lignes.map((s, i) => {
              const ex = estExclue(s), plusieurs = (s.variantes?.length || 0) > 1;
              const ds = dosages(s), lie = liee(s, photos);
              const sans = sansPhoto(s);
              const retirables = ds.filter(o => photos[o.cip] && !liee(o, photos));
              const etat = etatLigne(s.cip) || {}, occupe = !!etat.occupe, envoi = etat.occupe === "envoi";
              const statut = (lie ? "photo ajoutée ici (aussi au catalogue)" : s.image_url ? "photo"
                : photos[s.cip] ? (estPhotoEnvoyee(photos[s.cip]) ? "photo ajoutée ici" : "photo choisie ici") : "boîte générée")
                + (ds.length > 1 && sans.length && sans.length < ds.length ? ` · ${sans.length} dosage${sans.length > 1 ? "s" : ""} sans photo` : "");
              const libelleAjout = lie || photos[s.cip] ? "Remplacer la photo" : "Ajouter une photo";
              const libelleRetrait = lie ? (retirables.length > 1 ? "Retirer la photo des autres dosages" : "Retirer la photo de l'autre dosage")
                : retirables.length > 1 ? "Retirer les photos" : "Retirer la photo";
              const styleMessage = { flexBasis: "100%", paddingLeft: 38, fontSize: 11, marginTop: -2, color: { ok: T.ok, warn: T.warn, danger: T.danger }[etat.ton] || T.inkMute };
              // photos de la ligne qui ne s'affichent pas (catalogue ou choisies ici, tous dosages)
              const illisiblesLigne = [...new Set([s.image_url, ...ds.map(o => photos[o.cip])].filter(u => u && estIllisible(u)))];
              const refus = etat.message && etat.ton === "danger";
              return (
                // une ligne qui passe à la ligne : boutons sous le nom quand la place manque (le nom garde 220 px au moins)
                <div key={s.cip} className="ex-tr" style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center", padding: "6px 10px", fontSize: 12, opacity: ex ? 0.5 : 1 }}>
                  <b style={{ width: 28, flexShrink: 0, color: i < 12 ? T.ink : T.inkMute }}>{i < 12 ? s.rang : "R"}</b>
                  {/* nom, puis menu et état de la photo en dessous (jamais coupé par les boutons : passe à la ligne) */}
                  <span style={{ flex: "1 1 300px", minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.nom}>
                      {s.nom_court}{plusieurs ? ` (+${s.variantes.length - 1} dosage${s.variantes.length > 2 ? "s" : ""})` : ""}</span>
                    <span style={{ display: "block", fontSize: 11, color: T.inkMute }}>{s.menu?.label} · {statut}{illisiblesLigne.length > 0 && <b style={{ color: T.danger }}> · Photo illisible</b>}</span>
                  </span>
                  <span className="num" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtEur(s.pn)}</span>
                  <span className="num" style={{ color: T.inkMute, whiteSpace: "nowrap" }}>{s.lot ? `${s.lot.qte} × ${fmtEur(s.lot.pu)} = ${fmtEur(s.lot.total)}` : ""}</span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" }}>
                    {retirables.length > 0 && <button onClick={() => retirerPhotos(s)} disabled={occupe} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{libelleRetrait}</button>}
                    {sans.length > 0 && (
                      <button onClick={() => chercherPhotos(s)} disabled={occupe} aria-busy={etat.occupe === "recherche"} style={{ ...ui.btn("ligne", "s"), height: 28 }}>
                        {etat.occupe === "recherche" ? "Recherche…" : sans.length > 1 ? "Chercher les photos" : "Chercher la photo"}</button>
                    )}
                    {(!s.image_url || lie) && (
                      <button onClick={() => choisirPhoto(s)} disabled={occupe} aria-busy={envoi} title={AIDE}
                        aria-label={envoi ? `Envoi de la photo de ${s.nom_court} en cours` : `${libelleAjout} de ${s.nom_court}`}
                        style={{ ...ui.btn("ligne", "s"), height: 28, minWidth: 128 }}>{envoi ? "Envoi…" : libelleAjout}</button>
                    )}
                    <button onClick={() => basculer(s)} style={{ ...ui.btn("ligne", "s"), height: 28 }}>{ex ? "Réintégrer" : plusieurs ? "Exclure (tous les dosages)" : "Exclure"}</button>
                  </span>
                  {/* photo de la ligne qui ne s'affiche pas : motif et ce que l'accueil montre à la place, sur toute la largeur */}
                  {illisiblesLigne.length > 0 && (
                    <span style={{ ...styleMessage, color: T.danger }}>
                      <b>Photo illisible</b>{illisiblesLigne.length > 1 ? ` (${illisiblesLigne.length})` : ""} : {raisonIllisible(illisiblesLigne[0])}.
                      {[s.image_url, photos[s.cip]].some(estIllisible) ? ` L'accueil montre ${montreeAlaPlace(s)} à la place.` : " Les dosages concernés montrent une autre photo ou la boîte générée à la place."}</span>
                  )}
                  <span role="status" aria-live="polite" style={etat.message && !refus ? styleMessage : CACHE}>{refus ? "" : etat.message}</span>
                  {refus && <span key={etat.n} role="alert" style={styleMessage}>{etat.message}</span>}
                </div>
              );
            })}
          </div>
        )}
      <input ref={fichierRef} type="file" accept={ACCEPT} hidden onChange={e => { const f = e.target.files?.[0], s = ligneRef.current; e.target.value = ""; if (f && s) ajouterPhoto(s, f); }} />
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>R : réserve (remplace une diapositive retirée ou en rupture). Écartés d'office : rupture, justificatif labo, stupéfiant, contingenté, prix anormal.</div>
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>Ajouter une photo : JPG, PNG ou WebP de votre ordinateur (15 Mo au plus, réduite avant l'envoi), pour le dosage montré et, sur l'accueil seulement, les dosages de même forme sans photo. Produit rangé dans un menu du catalogue : après confirmation, elle devient aussi la photo de ce dosage au catalogue ; vous pourrez la remplacer d'ici, pas la retirer.</div>
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>Les dosages en rupture aujourd'hui ne sont pas dans la liste et ne reçoivent pas la photo : à leur retour (« 1 dosage sans photo »), refaites « Remplacer la photo ».</div>
      <div style={intertitre}>Réglages</div>
      <Case coche={!acc.masque} onChange={v => majAccueil(a => ({ ...a, masque: !v }))} titre="Afficher la page d'accueil"
        texte="Décoché : plus d'entrée « Accueil » ni d'arrivée sur l'accueil (interrupteur d'urgence)." />
      <Case coche={acc.arrivee !== false} onChange={v => majAccueil(a => ({ ...a, arrivee: v }))} titre="Ouvrir le site sur l'accueil"
        texte="Sinon, l'onglet par défaut (étoile ci-dessous). Les liens ?menu= et ?cip= mènent toujours à leur vue." />
      <Case coche={acc.auto !== false} onChange={v => majAccueil(a => ({ ...a, auto: v }))} titre="Défilement automatique des plus commandés sur ordinateur"
        texte="7 s par produit, un tour puis arrêt sur le n°1 ; jamais sur mobile ni si l'utilisateur réduit les animations. En pause tant que la vitrine cinéma défile." />
    </div>
  );
}
