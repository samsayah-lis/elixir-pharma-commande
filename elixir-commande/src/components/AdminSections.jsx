import React, { useEffect, useMemo, useRef, useState } from "react";
import { T, R, ui, adm } from "../theme.js";
import { PHOTOS_MAX, nomSection, sectionBloquee, etatCip, verdictAjout, operation, verifierPlan, appliquer, photosMedipim, prixOdoo,
  prixAffiche, refusRemise, colisRequis, rechercheOdoo, euros, pluriel, dateCourte, bilanTexte, guillemets, sectionsTouchees,
  panierTexte, desactiveAlaMain } from "./sections-produits.js";

// ── Admin, onglet ✏️ Modifier : ajouter et retirer des produits d'une section existante (règles : sections-produits.js) ──
// Chargé à la demande par AdminEdit (React.lazy). Section choisie dans le filtre de l'onglet :
//  • « ＋ Ajouter des produits à « … » » : recherche dans le catalogue Odoo (odoo-catalog, comme l'onglet ➕ Ajouter et la
//    Saisie : nom, CIP ou EAN ; plusieurs mots ou accents : rechercheOdoo), état de chaque CIP sur le site
//    (products-sections?cips=), choix multiple, barre « N à ajouter » en bas de l'écran, confirmation ;
//  • « Produits retirés de cette section » (products-sections?section=), filtrés par la recherche de l'onglet, « Remettre »
//    après confirmation (prix montré aux pharmacies, produit désactivé à la main) ;
//  • sélection par cases à cocher (cartes d'AdminEdit) et « Retirer la sélection » (barre en bas de l'écran).
// Retrait d'une seule carte (bouton « Retirer » d'AdminEdit, toutes sections comprises) : fenêtre de confirmation d'ici.
// Toute écriture : products-upsert, une ligne à la fois, après relecture de l'état (verifierPlan) ; jamais la configuration.
// Écriture en partie refusée : la fenêtre reste ouverte avec la raison de chaque produit et « Réessayer ».
const LIMITE = 30;
const PAR_PAGE = 30;
const SITE = "Les pharmacies verront ce changement au prochain chargement du site (ouverture ou actualisation de la page).";
const NBSP_FINE = " ";

const aDesProblemes = (b) => !!b && (!!b.erreur || b.echecs.length + b.nonTraites.length + b.perimes.length > 0);
const aRefaire = (b) => (!b ? 0 : b.erreur ? b.nonTraites.length : b.echecs.length + b.nonTraites.length);
const sourcePrix = (p) => (p?.source === "odoo" ? "Odoo" : "prix enregistré");

function Fenetre({ id, titre, children, onFermer, bloque }) {
  const ref = useRef(null);
  const fermer = useRef(onFermer); fermer.current = onFermer;
  const occupe = useRef(bloque); occupe.current = bloque;
  useEffect(() => {
    const avant = document.activeElement;
    ref.current?.querySelector("[data-defaut]")?.focus();
    const touche = (e) => { if (e.key === "Escape" && !occupe.current) fermer.current(); };
    window.addEventListener("keydown", touche);
    return () => { window.removeEventListener("keydown", touche); if (avant && typeof avant.focus === "function") avant.focus(); };
  }, []);
  return (
    <div style={{ ...ui.overlay, zIndex: 1500 }} onClick={(e) => { if (e.target === e.currentTarget && !bloque) onFermer(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}
        style={{ ...ui.modal, padding: "22px 20px", maxWidth: 540, maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box" }}>
        <h2 id={id} style={{ ...ui.titreModal, fontSize: 18, marginBottom: 12, alignItems: "flex-start" }}>{titre}</h2>
        {children}
      </div>
    </div>
  );
}

// Liste d'une fenêtre de confirmation (un groupe d'opérations) : lignes { cle, texte, detail, extra }
function Groupe({ titre, note, lignes }) {
  if (!lignes.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.petrol }}>{titre}</div>
      {note && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>{note}</div>}
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", border: `1px solid ${T.line}`, borderRadius: R.s, maxHeight: 260, overflowY: "auto" }}>
        {lignes.map(({ cle, texte, detail, extra }) => (
          <li key={cle} style={{ padding: "7px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 13, color: T.ink }}>
            <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{texte}</div>
            {detail && <div style={{ fontSize: 11, color: T.inkMute, marginTop: 1 }}>{detail}</div>}
            {extra}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Raisons par produit d'un bilan (périmés, refusés, non tentés)
function DetailBilan({ b }) {
  const lignes = [...b.perimes.map(({ op, raison }) => [op.cip, `${op.nom} : ${raison} — rien n'a été fait`]),
    ...b.echecs.map(({ op, erreur }) => [op.cip, `${op.nom} : ${erreur}`]),
    ...(b.erreur ? [] : b.nonTraites.map(op => [op.cip, `${op.nom} : non tenté`]))];
  return lignes.map(([cle, t]) => <div key={cle} style={{ fontSize: 12, marginTop: 4, wordBreak: "break-word" }}>• {t}</div>);
}

// Bilan affiché DANS une fenêtre quand une écriture a échoué en partie (la fenêtre reste ouverte)
function BilanFenetre({ b, sections }) {
  if (!b) return null;
  return (
    <div role="alert" style={{ ...ui.encart("warn"), marginBottom: 12 }}>
      <strong>{b.erreur ? `⚠ Rien n'a été enregistré : ${b.erreur}` : bilanTexte(b, b.section, sections)}</strong>
      <DetailBilan b={b} />
      {aRefaire(b) > 0 && <div style={{ fontSize: 12, marginTop: 6 }}>{aRefaire(b) > 1 ? "Ces produits restent à faire" : "Ce produit reste à faire"} : « Réessayer » relance seulement {aRefaire(b) > 1 ? "eux" : "lui"}.</div>}
    </div>
  );
}

const Stock = ({ s }) => {
  if (!s) return <span style={ui.badge("neutral")}>Stock inconnu</span>;
  return s.in_stock ? <span style={ui.badge("ok")}>En stock{s.available != null ? ` · ${Math.round(s.available)}` : ""}</span> : <span style={ui.badge("danger")}>Rupture</span>;
};

// Champ « Colis » d'une ligne de confirmation (Sélection Stratège : vendue au colis)
function ChampColis({ op, valeur, onChange, bloque }) {
  const id = `colis-${op.cip}`;
  const p = op.corps.product;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", marginTop: 6 }}>
      <label htmlFor={id} style={{ fontSize: 12, fontWeight: 700, color: op.incomplet ? T.danger : T.inkSoft }}>Colis (quantité minimale)</label>
      <input id={id} type="number" inputMode="numeric" min="1" step="1" value={valeur} disabled={bloque} onChange={e => onChange(e.target.value)}
        aria-invalid={!!op.incomplet} style={{ ...adm.input, width: 96, fontSize: 16, padding: "6px 10px", borderColor: op.incomplet ? T.danger : T.lineField }} />
      {p.colis ? <span style={{ fontSize: 12, color: T.inkSoft }}>Prix carton : {euros(p.carton)}</span>
        : <span style={{ fontSize: 12, color: T.danger }}>À renseigner : la section se vend au colis</span>}
    </div>
  );
}

export default function AdminSections({
  section, sections, products, affiches = [], selection, setSelection, retraitDemande, setRetraitDemande,
  campagnes = null, campagnesEtat = "ok", relireCampagnes, recherche = "", demandeAjout = null, surEtat,
  promos = [], adminFetch, flash, fetchProducts,
}) {
  const enSection = !!section && section !== "all";
  const bloque = enSection ? sectionBloquee(section, { campagnes, sections }) : null;
  const actif = enSection && !bloque;
  const nom = nomSection(section, sections);
  const dansSection = useMemo(() => (products || []).filter(p => (p._section ?? p.section) === section), [products, section]);

  const [occupe, setOccupe] = useState(null);         // texte de progression pendant une écriture
  const [bilan, setBilan] = useState(null);
  const [bilanFenetre, setBilanFenetre] = useState(null);
  const [retires, setRetires] = useState({ etat: "attente", liste: [] });
  const [ouvertRetires, setOuvertRetires] = useState(false);
  const [parPage, setParPage] = useState({ admin: PAR_PAGE, anciens: PAR_PAGE });
  const [ouvertAjout, setOuvertAjout] = useState(false);
  const [confirmAjout, setConfirmAjout] = useState(false);
  const [remiseDemandee, setRemiseDemandee] = useState(null);   // ligne de la liste des retirés
  const [confirmeDesactive, setConfirmeDesactive] = useState(false);
  const [avecPhotos, setAvecPhotos] = useState(true);
  const [choix, setChoix] = useState({});              // cip → { ligne, etat, type }
  const [colisSaisis, setColisSaisis] = useState({});  // cip → texte saisi (Sélection Stratège)
  const [q, setQ] = useState("");
  const [stockSeul, setStockSeul] = useState(false);
  const [relance, setRelance] = useState(0);
  const [res, setRes] = useState({ etat: "vide", lignes: [], produits: {}, stocks: {}, plusieursMots: false });
  const tour = useRef(0);
  const tourRetires = useRef(0);
  const refBilan = useRef(null);
  const fenetreOuverte = confirmAjout || retraitDemande != null || remiseDemandee != null;

  // menus promo actifs qui proposent aussi ce CIP (information : un menu promo garde ses propres produits)
  const promosParCip = useMemo(() => {
    const m = {};
    for (const p of Array.isArray(promos) ? promos : []) if (p?.active) for (const x of p.products || []) if (x?.cip) (m[x.cip] ||= []).push(p.name);
    return m;
  }, [promos]);

  const chargerRetires = async () => {
    if (!actif) return;
    const n = ++tourRetires.current;
    setRetires(r => ({ ...r, etat: "charge" }));
    try {
      const r = await adminFetch(`/.netlify/functions/products-sections?section=${encodeURIComponent(section)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `erreur ${r.status}`);
      if (n === tourRetires.current) setRetires({ etat: "ok", liste: j.retires || [], plafond: !!j.plafond });
    } catch (e) { if (n === tourRetires.current) setRetires({ etat: "erreur", erreur: e.message, liste: [] }); }
  };

  // changement de section : tout repart de zéro (AdminEdit demande confirmation si des produits choisis attendent)
  useEffect(() => {
    setChoix({}); setColisSaisis({}); setBilan(null); setBilanFenetre(null); setOuvertAjout(false); setConfirmAjout(false); setRemiseDemandee(null);
    setQ(""); setRetires({ etat: "attente", liste: [] }); setOuvertRetires(false); setParPage({ admin: PAR_PAGE, anciens: PAR_PAGE });
    chargerRetires();
  }, [section, actif]);   // eslint-disable-line react-hooks/exhaustive-deps

  // « Chercher « … » dans le catalogue Odoo » (bas de la liste d'AdminEdit) : panneau d'ajout ouvert, recherche reprise
  useEffect(() => {
    if (!demandeAjout || !actif) return;
    setOuvertAjout(true); setQ(String(demandeAjout.q || ""));
    const t = setTimeout(() => { const el = document.getElementById("sections-recherche"); el?.scrollIntoView({ block: "center" }); el?.focus(); }, 50);
    return () => clearTimeout(t);
  }, [demandeAjout]);   // eslint-disable-line react-hooks/exhaustive-deps

  // recherche dans le catalogue Odoo, puis état de chaque CIP sur le site
  useEffect(() => {
    const t = q.trim();
    if (!ouvertAjout || t.length < 2) { tour.current++; setRes({ etat: "vide", lignes: [], produits: {}, stocks: {}, plusieursMots: false }); return; }
    const n = ++tour.current;
    setRes(r => ({ ...r, etat: "charge" }));
    const minuterie = setTimeout(async () => {
      try {
        const lire = async (adresse) => {
          const r = await fetch(adresse);
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || `recherche : erreur ${r.status}`);
          return d.products || [];
        };
        const { lignes, plusieursMots } = await rechercheOdoo(t, { lire, stockSeul, limite: LIMITE });
        let etats = { produits: {}, stocks: {} };
        if (lignes.length) {
          const s = await adminFetch(`/.netlify/functions/products-sections?cips=${lignes.map(l => encodeURIComponent(l.cip)).join(",")}`);
          const sj = await s.json().catch(() => ({}));
          if (!s.ok) throw new Error(sj.error || `état des produits sur le site : erreur ${s.status}`);
          etats = { produits: sj.produits || {}, stocks: sj.stocks || {} };
        }
        if (n === tour.current) setRes({ etat: "ok", lignes, plusieursMots, ...etats });
      } catch (e) { if (n === tour.current) setRes({ etat: "erreur", erreur: e.message, lignes: [], produits: {}, stocks: {}, plusieursMots: false }); }
    }, 300);
    return () => clearTimeout(minuterie);
  }, [q, stockSeul, ouvertAjout, relance, adminFetch]);

  // ── écriture : relecture de l'état, products-upsert une ligne à la fois, photos, liste rafraîchie ──
  // Message fixe (2,5 s) pour un succès complet seulement ; sinon le bilan détaillé (fenêtre ou encart) donne les raisons.
  const executer = async (ops, { photos = false } = {}) => {
    if (!ops.length || occupe) return null;
    setOccupe("Vérification de l'état des produits…");
    let b;
    try {
      // état relu juste avant d'écrire (par lots de 200 CIP, plafond de products-sections)
      const produits = {};
      for (let i = 0; i < ops.length; i += 200) {
        const r = await adminFetch(`/.netlify/functions/products-sections?cips=${ops.slice(i, i + 200).map(o => encodeURIComponent(o.cip)).join(",")}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `état des produits : erreur ${r.status}`);
        Object.assign(produits, j.produits || {});
      }
      const { valides, perimes } = verifierPlan(ops, produits, sections);
      const fait = await appliquer(valides, { adminFetch, surProgres: (i, n) => setOccupe(`Enregistrement ${Math.min(i + 1, n)} sur ${n}…`) });
      let ph = null;
      const nouveaux = fait.faits.filter(o => o.type === "ajouter").map(o => o.cip);
      if (photos && nouveaux.length) {
        setOccupe(`Photos Medipim : ${pluriel(Math.min(nouveaux.length, PHOTOS_MAX), "produit")}, environ une seconde chacun…`);
        ph = await photosMedipim(nouveaux, { adminFetch });
      }
      if (fait.faits.length) await fetchProducts();
      b = { ...fait, perimes, photos: ph, section };
    } catch (e) {
      b = { faits: [], echecs: [], nonTraites: ops, perimes: [], erreur: e.message, section };
    } finally {
      setOccupe(null);
      chargerRetires();
    }
    setBilan(b);
    if (!aDesProblemes(b)) flash(bilanTexte(b, section, sections));
    return b;
  };
  // problème sans fenêtre ouverte (annulation d'un retrait) : l'encart du bilan est amené à l'écran
  useEffect(() => {
    if (bilan && aDesProblemes(bilan) && !fenetreOuverte) refBilan.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [bilan]);   // eslint-disable-line react-hooks/exhaustive-deps

  const basculer = (ligne, etat, type) => setChoix(c => {
    const n = { ...c };
    if (n[ligne.cip]) delete n[ligne.cip]; else n[ligne.cip] = { ligne, etat, type };
    return n;
  });
  const opsAjout = useMemo(() => Object.values(choix).map(c => operation(c.type, { cip: c.ligne.cip, section, ligne: c.ligne, etat: c.etat, colis: colisSaisis[c.ligne.cip] })),
    [choix, section, colisSaisis]);
  const ouvrirAjout = () => { setConfirmeDesactive(false); setBilanFenetre(null); setConfirmAjout(true); };
  const fermerAjout = () => { setConfirmAjout(false); setBilanFenetre(null); };
  const confirmerAjout = async () => {
    const b = await executer(opsAjout, { photos: avecPhotos });
    if (!b) return;
    // faits et périmés (état changé entre-temps, raison dans le bilan) quittent les choix ; un échec reste choisi, à relancer
    const traites = new Set([...b.faits, ...b.perimes.map(p => p.op)].map(o => o.cip));
    setChoix(c => Object.fromEntries(Object.entries(c).filter(([cip]) => !traites.has(cip))));
    setRelance(x => x + 1);
    if (aDesProblemes(b)) setBilanFenetre(b); else fermerAjout();
  };

  const opsRetrait = useMemo(() => (retraitDemande || []).map(p => operation("retirer", { cip: p.cip, section: p._section ?? p.section, produit: p })), [retraitDemande]);
  const fermerRetrait = () => { setRetraitDemande(null); setBilanFenetre(null); };
  const confirmerRetrait = async () => {
    const b = await executer(opsRetrait);
    if (!b) return;
    const faits = new Set(b.faits.map(o => o.cip));
    setSelection(s => new Set([...s].filter(c => !faits.has(c))));
    setRelance(x => x + 1);
    if (aDesProblemes(b)) {
      const restants = new Set([...b.echecs.map(e => e.op.cip), ...b.nonTraites.map(o => o.cip)]);
      setRetraitDemande(rd => (rd || []).filter(p => restants.has(p.cip)));
      setBilanFenetre(b);
    } else fermerRetrait();
  };
  // « Annuler » juste après un retrait : remise telle qu'avant, dans la section d'origine (sans autre changement)
  const annulerRetrait = (b) => executer(b.faits.filter(o => o.type === "retirer")
    .map(o => operation("remettre", { cip: o.cip, section: o.section, produit: { name: o.nom, section: o.section }, annulation: true })));

  const opRemise = useMemo(() => (remiseDemandee ? operation("remettre", { cip: remiseDemandee.cip, section, produit: remiseDemandee, colis: colisSaisis[remiseDemandee.cip] }) : null),
    [remiseDemandee, section, colisSaisis]);
  const ouvrirRemise = (r) => { setConfirmeDesactive(false); setBilanFenetre(null); setRemiseDemandee(r); };
  const fermerRemise = () => { setRemiseDemandee(null); setBilanFenetre(null); };
  const confirmerRemise = async () => {
    const b = await executer([opRemise]);
    if (!b) return;
    if (aDesProblemes(b)) setBilanFenetre(b); else fermerRemise();
  };

  // sélection (cases des cartes) : produits de la section seulement
  const choisis = actif ? dansSection.filter(p => selection.has(p.cip)) : [];
  const affichesSection = actif ? affiches.filter(p => p.cip && (p._section ?? p.section) === section) : [];
  const tousAffichesChoisis = affichesSection.length > 0 && affichesSection.every(p => selection.has(p.cip));
  const nbChoix = Object.keys(choix).length;
  const barreAjout = actif && nbChoix > 0 && !fenetreOuverte;
  const barreSelection = choisis.length > 0 && !fenetreOuverte;
  useEffect(() => { surEtat?.({ occupe: !!occupe, nbChoix, barre: barreAjout || barreSelection }); }, [occupe, nbChoix, barreAjout, barreSelection, surEtat]);
  const viderChoix = () => {
    if (nbChoix > 1 && !window.confirm(`Abandonner les ${nbChoix} produits choisis ?`)) return;
    setChoix({}); setColisSaisis({});
  };

  const lignesRes = res.lignes.map(l => {
    const etat = etatCip(l.cip, section, res.produits);
    return { l, etat, v: verdictAjout({ ligne: l, etat, section, campagnes, sections }) };
  });

  // produits retirés : recherche de l'onglet (nom ou CIP), retirés depuis l'admin d'abord, puis désactivés auparavant
  const filtreRetires = String(recherche || "").trim().toLowerCase();
  const retiresVus = retires.liste.filter(r => !filtreRetires || String(r.name ?? "").toLowerCase().includes(filtreRetires) || String(r.cip ?? "").includes(filtreRetires));
  const groupesRetires = [
    { cle: "admin", titre: "Retirés depuis l'admin", liste: retiresVus.filter(r => !desactiveAlaMain(r.retrait)) },
    { cle: "anciens", titre: "Désactivés auparavant (🗑️, alignements…)", liste: retiresVus.filter(r => desactiveAlaMain(r.retrait)) },
  ];

  const btnLong = { ...ui.btn("primaire", "s"), whiteSpace: "normal", height: "auto", minHeight: 36, padding: "8px 14px", lineHeight: 1.25, textAlign: "left" };
  const saisieColis = (cip) => (v) => setColisSaisis(c => ({ ...c, [cip]: v }));
  const valeurColis = (op, stocke) => colisSaisis[op.cip] ?? (stocke?.colis > 0 ? String(stocke.colis) : "");
  const caseDesactive = (n) => (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, margin: "0 0 12px", cursor: "pointer", minHeight: 32 }}>
      <input type="checkbox" checked={confirmeDesactive} onChange={e => setConfirmeDesactive(e.target.checked)} disabled={!!occupe} style={{ width: 20, height: 20, marginTop: 0, flexShrink: 0, accentColor: "var(--petrol)" }} />
      <span>Je confirme la remise {n > 1 ? "de produits désactivés" : "d'un produit désactivé"} à la main
        <span style={{ display: "block", fontSize: 12, color: T.inkSoft, marginTop: 2 }}>{n > 1 ? "Ils avaient été désactivés" : "Il avait été désactivé"} autrement que par « Retirer » (🗑️ de l'onglet ➕ Ajouter, alignement de catalogue…) : vérifiez {n > 1 ? "qu'ils doivent" : "qu'il doit"} bien revenir.</span>
      </span>
    </label>
  );

  return (
    <>
      {campagnesEtat === "erreur" && (
        <div role="alert" style={{ ...ui.encart("warn"), marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ flex: "1 1 220px" }}><strong>Lecture des campagnes impossible :</strong> ajout et retrait de produits suspendus, pour ne pas toucher une section de campagne sans le savoir.</span>
          {relireCampagnes && <button type="button" onClick={relireCampagnes} style={ui.btn("ligne", "s")}>Réessayer</button>}
        </div>
      )}
      {campagnesEtat === "attente" && enSection && <div role="status" style={{ fontSize: 12, color: T.inkMute, marginBottom: 10 }}>Lecture des campagnes…</div>}
      {!enSection && campagnesEtat === "ok" && (
        <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10 }}>Choisissez une section pour y ajouter des produits ou en retirer plusieurs à la fois.</div>
      )}

      {occupe && !fenetreOuverte && <div role="status" style={{ ...ui.encart("info"), marginBottom: 12 }}>{occupe}</div>}

      {bilan && (
        <div ref={refBilan} role="status" style={{ ...ui.encart(aDesProblemes(bilan) ? "warn" : "ok"), marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ wordBreak: "break-word" }}>{bilan.erreur ? `⚠ Rien n'a été enregistré : ${bilan.erreur}` : bilanTexte(bilan, bilan.section, sections)}</strong>
            <DetailBilan b={bilan} />
            {bilan.photos && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Photos Medipim : {pluriel(bilan.photos.trouvees, "ajoutée")}{bilan.photos.introuvables ? `, ${pluriel(bilan.photos.introuvables, "introuvable")}` : ""}
                {bilan.photos.nonTraitees ? `, ${pluriel(bilan.photos.nonTraitees, "à chercher", "à chercher")} plus tard avec « 🔄 Importer photos Medipim… » en bas de la liste` : ""}
                {bilan.photos.arret ? ` (${bilan.photos.arret})` : ""}
              </div>
            )}
            {!!bilan.faits.length && <div style={{ fontSize: 12, marginTop: 4 }}>{SITE}</div>}
            {bilan.faits.some(o => o.type === "retirer") && (
              <button type="button" onClick={() => annulerRetrait(bilan)} disabled={!!occupe} style={{ ...ui.btn("ligne", "s"), marginTop: 8, color: "inherit" }}>
                Annuler {bilan.faits.filter(o => o.type === "retirer").length > 1 ? "ces retraits" : "ce retrait"}
              </button>
            )}
          </div>
          <button type="button" onClick={() => setBilan(null)} aria-label="Fermer ce message" className="ex-btn-discret" style={{ ...adm.fermer, width: 32, height: 32, fontSize: 14, background: "transparent", color: "inherit", flexShrink: 0 }}>✕</button>
        </div>
      )}

      {enSection && bloque && bloque.raison !== "campagnes" && (
        <div style={{ ...ui.encart("info"), marginBottom: 12 }}>
          <strong>Ajout et retrait de produits indisponibles ici.</strong> {bloque.texte}
        </div>
      )}

      {actif && (
        <section aria-label={`Produits de la section ${nom}`} style={{ ...ui.panel, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 14px", alignItems: "center" }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.petrol }}>{guillemets(nom)}</div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                {pluriel(dansSection.length, "produit")} sur le site
                {retires.etat === "ok" && retires.liste.length > 0 && <> · {pluriel(retires.liste.length, "retiré")}</>}
              </div>
            </div>
            <button type="button" aria-expanded={ouvertAjout} onClick={() => setOuvertAjout(o => !o)} style={btnLong}>
              {ouvertAjout ? "Fermer la recherche" : `＋ Ajouter des produits à ${guillemets(nom)}`}
            </button>
          </div>
          {colisRequis(section) && (
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8 }}>{guillemets(nom)} se vend au colis : chaque produit ajouté, déplacé ou remis ici demande son colis (quantité minimale), le prix carton en découle.</div>
          )}

          {affichesSection.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10, fontSize: 12, color: T.inkSoft }}>
              <button type="button" onClick={() => setSelection(s => {
                const n = new Set(s);
                for (const p of affichesSection) { if (tousAffichesChoisis) n.delete(p.cip); else n.add(p.cip); }
                return n;
              })} style={ui.btn("ligne", "s")}>
                {tousAffichesChoisis ? "Tout désélectionner" : `Tout sélectionner (${affichesSection.length})`}
              </button>
              <span>Cochez des produits pour les retirer ensemble de la section.</span>
            </div>
          )}

          {ouvertAjout && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.line}` }}>
              <label htmlFor="sections-recherche" style={adm.label}>Rechercher dans le catalogue Odoo</label>
              <input id="sections-recherche" type="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" autoFocus
                placeholder="Nom, CIP ou EAN (2 caractères au moins)" style={{ ...adm.input, fontSize: 16 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: T.inkSoft, marginTop: 8, minHeight: 32, cursor: "pointer" }}>
                <input type="checkbox" checked={stockSeul} onChange={e => setStockSeul(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--petrol)" }} />
                En stock seulement
              </label>

              {nbChoix > 0 && (
                <div style={{ ...ui.encart("info"), marginTop: 10 }}>
                  <div style={{ fontWeight: 700 }}>{pluriel(nbChoix, "produit choisi", "produits choisis")}, pas encore {nbChoix > 1 ? "ajoutés" : "ajouté"} : validez avec le bouton en bas de l'écran.</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {Object.values(choix).map(c => (
                      <span key={c.ligne.cip} style={{ ...ui.badge("neutral"), whiteSpace: "normal", maxWidth: "100%", padding: "2px 2px 2px 10px", gap: 4 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.type === "deplacer" ? "Déplacé · " : c.type === "remettre" ? "Remis · " : "Nouveau · "}{c.etat?.name || c.ligne.name}</span>
                        <button type="button" onClick={() => basculer(c.ligne, c.etat, c.type)} aria-label={`Ne plus ajouter ${c.etat?.name || c.ligne.name}`}
                          className="ex-btn-discret" style={{ ...ui.rond(32), background: "transparent", color: "inherit", fontSize: 13 }}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div aria-live="polite" style={{ fontSize: 12, color: T.inkMute, marginTop: 8 }}>
                {res.etat === "charge" && "Recherche…"}
                {res.etat === "erreur" && <span style={{ color: T.danger }}>⚠ {res.erreur}</span>}
                {res.etat === "ok" && !res.lignes.length && (res.plusieursMots
                  ? "Aucun produit Odoo ne contient tous ces mots : essayez un seul mot, le CIP ou l'EAN."
                  : `Aucun produit Odoo ne contient ${guillemets(q.trim())} : essayez un autre mot, le CIP ou l'EAN.`)}
                {res.etat === "ok" && res.lignes.length >= LIMITE && `Les ${LIMITE} premiers résultats : précisez la recherche pour en voir d'autres.`}
              </div>

              {res.lignes.length > 0 && (
                <ul style={{ margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {lignesRes.map(({ l, etat, v }) => {
                    const pris = !!choix[l.cip];
                    const prix = prixOdoo(l);
                    const enPromo = promosParCip[l.cip];
                    const ailleurs = etat.section ? guillemets(nomSection(etat.section, sections)) : null;
                    const quand = dateCourte(res.produits[l.cip]?.updated_at);
                    const statut = etat.type === "ici" ? { ton: T.ok, t: "✓ Déjà dans cette section" }
                      : v.type === "deplacer" ? { ton: T.warn, t: `Actuellement dans ${ailleurs}. « Déplacer ici » l'enlève de ${ailleurs} (un produit n'est que dans une section).` }
                      : v.type === "remettre" ? { ton: T.inkSoft, t: `${desactiveAlaMain(etat.derniere) ? "Désactivé" : "Retiré"}${ailleurs ? ` de ${ailleurs}` : ""}${quand ? ` le ${quand}` : ""} : « Remettre ici » le fait revenir dans cette section.` }
                      : v.type === "ajouter" ? { ton: T.inkMute, t: "Pas encore sur le site" }
                      : { ton: T.danger, t: v.raison };
                    const libelle = v.type === "ajouter" ? (pris ? "✓ À ajouter" : "＋ Ajouter ici") : v.type === "deplacer" ? (pris ? "✓ À déplacer ici" : "Déplacer ici") : (pris ? "✓ À remettre ici" : "Remettre ici");
                    return (
                      <li key={l.cip} style={{ listStyle: "none", border: `1px solid ${pris ? T.teal : T.line}`, background: pris ? T.mint : T.surface, borderRadius: R.s,
                        padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
                        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: T.petrol, wordBreak: "break-word" }}>{l.name}</div>
                          <div style={{ fontSize: 11, color: T.inkMute, fontFamily: T.mono, marginTop: 2, wordBreak: "break-all" }}>
                            CIP {l.cip}{l.barcode && String(l.barcode) !== String(l.cip) ? ` · EAN ${l.barcode}` : ""}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "center", fontSize: 12, marginTop: 4, color: T.ink }}>
                            {prix ? <span><strong style={{ color: T.ok }}>{euros(prix.pn)}</strong> net{prix.pn < prix.pv && <span style={{ color: T.inkMute }}> · prix {euros(prix.pv)}</span>}</span>
                              : <span style={{ color: T.inkMute }}>Prix : —</span>}
                            <Stock s={res.stocks[l.cip] || (l.in_stock != null ? { in_stock: !!l.in_stock, available: null } : null)} />
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4, color: statut.ton }}>{statut.t}</div>
                          {enPromo && <div style={{ fontSize: 11, marginTop: 2, color: T.inkMute }}>Aussi proposé dans le menu promo {enPromo.map(guillemets).join(", ")} (inchangé)</div>}
                        </div>
                        {v.type && (
                          <button type="button" aria-pressed={pris} onClick={() => basculer(l, etat, v.type)} style={{ ...ui.btn(pris ? "primaire" : "ligne", "s"), marginLeft: "auto" }}>
                            {libelle}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <details open={ouvertRetires} onToggle={e => setOuvertRetires(e.currentTarget.open)} style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: T.petrol, minHeight: 32, lineHeight: "32px" }}>
              Produits retirés de cette section{retires.etat === "ok" ? ` (${retires.liste.length}${retires.plafond ? "+" : ""})` : retires.etat === "charge" ? " (…)" : ""}
            </summary>
            {retires.etat === "erreur" && <div style={{ ...ui.encart("danger"), marginTop: 8 }}>⚠ Liste indisponible : {retires.erreur} <button type="button" onClick={chargerRetires} style={{ ...ui.btn("ligne", "s"), marginLeft: 8 }}>Réessayer</button></div>}
            {retires.etat === "ok" && !retires.liste.length && <div style={{ fontSize: 12, color: T.inkMute, marginTop: 6 }}>Aucun produit retiré de cette section.</div>}
            {retires.liste.length > 0 && filtreRetires && (
              <div style={{ fontSize: 12, color: T.inkMute, marginTop: 6 }}>Filtrés par la recherche {guillemets(recherche.trim())} : {pluriel(retiresVus.length, "produit")}.</div>
            )}
            {groupesRetires.filter(g => g.liste.length).map(g => (
              <div key={g.cle} style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.inkSoft }}>{g.titre} ({g.liste.length})</div>
                <ul style={{ margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.liste.slice(0, parPage[g.cle]).map(r => {
                    const prix = prixAffiche(r.odoo, r);
                    const refus = refusRemise({ odoo: r.odoo, nom: r.name, section, stocke: r, sections });
                    const quand = dateCourte(r.retrait?.date || r.updated_at);
                    const auteur = r.retrait?.author && r.retrait.author !== "admin" ? ` (${r.retrait.author})` : "";
                    return (
                      <li key={r.cip} style={{ listStyle: "none", border: `1px solid ${T.line}`, background: T.surface, borderRadius: R.s, padding: "10px 12px",
                        display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
                        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: T.ink, wordBreak: "break-word" }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                            <span style={{ fontFamily: T.mono }}>CIP {r.cip}</span>{quand ? ` · ${desactiveAlaMain(r.retrait) ? "Désactivé" : "Retiré"} le ${quand}` : ""}{auteur}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "center", fontSize: 12, marginTop: 4 }}>
                            {r.odoo && prixOdoo(r.odoo) && prix ? <span><strong style={{ color: T.ok }}>{euros(prix.pn)}</strong> net ({sourcePrix(prix)})</span>
                              : <span style={{ color: T.warn }}>Plus dans Odoo : prix enregistré {euros(r.pn)}</span>}
                            {r.odoo && <Stock s={r.odoo} />}
                          </div>
                          {refus && <div style={{ fontSize: 12, marginTop: 4, color: T.danger }}>{refus}</div>}
                        </div>
                        {!refus && (
                          <button type="button" disabled={!!occupe} onClick={() => ouvrirRemise(r)}
                            style={{ ...ui.btn("ligne", "s"), marginLeft: "auto" }} aria-label={`Remettre ${r.name} dans ${nom}`}>
                            ↺ Remettre
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {g.liste.length > parPage[g.cle] && (
                  <button type="button" onClick={() => setParPage(p => ({ ...p, [g.cle]: p[g.cle] + PAR_PAGE }))} style={{ ...ui.btn("ligne", "s"), marginTop: 8 }}>
                    Afficher plus ({g.liste.length - parPage[g.cle]} de plus)
                  </button>
                )}
              </div>
            ))}
          </details>
        </section>
      )}

      {/* barres en bas de l'écran (au-dessus du message de l'admin) : produits choisis à ajouter, cartes cochées à retirer */}
      {(barreAjout || barreSelection) && (
        <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(80px + env(safe-area-inset-bottom, 0px))", zIndex: 1200,
          display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, width: "max-content", maxWidth: "calc(100vw - 24px)" }}>
          {barreAjout && (
            <div role="region" aria-label="Produits à ajouter" style={{ background: T.petrol, color: T.paper, borderRadius: R.l, boxShadow: T.shadow2,
              padding: "6px 6px 6px 16px", display: "flex", alignItems: "center", gap: 10, boxSizing: "border-box" }}>
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{nbChoix} à ajouter</span>
              <button type="button" onClick={ouvrirAjout} disabled={!!occupe}
                style={{ ...ui.btn("primaire", "s"), background: T.paper, color: T.petrol, whiteSpace: "normal", height: "auto", minHeight: 36, padding: "6px 14px", lineHeight: 1.25, textAlign: "left", minWidth: 0 }}>
                Ajouter à {guillemets(nom)}
              </button>
              <button type="button" onClick={viderChoix} aria-label="Abandonner les produits choisis" style={{ ...ui.rond(32), background: "transparent", color: T.paper, fontSize: 14 }}>✕</button>
            </div>
          )}
          {barreSelection && (
            <div role="region" aria-label="Produits sélectionnés" style={{ background: T.petrol, color: T.paper, borderRadius: R.pill, boxShadow: T.shadow2,
              padding: "6px 6px 6px 16px", display: "flex", alignItems: "center", gap: 10, boxSizing: "border-box" }}>
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{pluriel(choisis.length, "sélectionné")}</span>
              <button type="button" onClick={() => setRetraitDemande(choisis)} disabled={!!occupe} style={ui.btn("danger", "s")}>Retirer la sélection</button>
              <button type="button" onClick={() => setSelection(new Set())} aria-label="Tout désélectionner" style={{ ...ui.rond(32), background: "transparent", color: T.paper, fontSize: 14 }}>✕</button>
            </div>
          )}
        </div>
      )}

      {confirmAjout && (() => {
        const de = (t) => opsAjout.filter(o => o.type === t);
        const nouveaux = de("ajouter"), deplaces = de("deplacer"), remis = de("remettre");
        const desactives = remis.filter(o => o.desactive).length;
        const incomplets = opsAjout.filter(o => o.incomplet).length;
        const types = new Set(opsAjout.map(o => o.type));
        const verbe = types.size === 1 && types.has("deplacer") ? "Déplacer" : types.size === 1 && types.has("remettre") ? "Remettre" : "Ajouter";
        const reste = !!bilanFenetre;
        const prixLigne = (o) => (o.prix ? ` · ${euros(o.prix.pn)} net (${sourcePrix(o.prix)})` : "");
        const colis = (o) => colisRequis(section) && <ChampColis op={o} valeur={valeurColis(o, choix[o.cip]?.etat?.stocke)} onChange={saisieColis(o.cip)} bloque={!!occupe} />;
        const bloqueConfirmer = !!occupe || !opsAjout.length || incomplets > 0 || (desactives > 0 && !confirmeDesactive);
        return (
          <Fenetre id="sections-confirm-ajout" titre={`Ajouter à ${guillemets(nom)}`} onFermer={fermerAjout} bloque={!!occupe}>
            <BilanFenetre b={bilanFenetre} sections={sections} />
            <Groupe titre={`${nouveaux.length > 1 ? "Nouveaux" : "Nouveau"} sur le site (${nouveaux.length})`}
              note={`Nom et prix repris d'Odoo (prix de vente et liste n°\u00a05)${NBSP_FINE}; le site affiche toujours le prix d'Odoo du jour.`}
              lignes={nouveaux.map(o => ({ cle: o.cip, texte: o.nom, detail: `CIP ${o.cip}${prixLigne(o)}`, extra: colis(o) }))} />
            <Groupe titre={`${deplaces.length > 1 ? "Déplacés" : "Déplacé"} ici (${deplaces.length})`}
              note={`Un produit n'est que dans une section : ${deplaces.length > 1 ? "ils quittent leur section actuelle" : "il quitte sa section actuelle"}.`}
              lignes={deplaces.map(o => ({ cle: o.cip, texte: o.nom, detail: `${guillemets(nomSection(o.depuis, sections))} → ${guillemets(nom)}${prixLigne(o)}`, extra: colis(o) }))} />
            <Groupe titre={`Remis sur le site (${remis.length})`}
              lignes={remis.map(o => ({ cle: o.cip, texte: o.nom,
                detail: `${o.depuis && o.depuis !== section ? `retiré de ${guillemets(nomSection(o.depuis, sections))}, remis dans ${guillemets(nom)}` : `CIP ${o.cip}`}${prixLigne(o)}${o.desactive ? " · désactivé à la main" : ""}`,
                extra: colis(o) }))} />
            {nouveaux.length > 0 && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, margin: "4px 0 12px", cursor: "pointer" }}>
                <input type="checkbox" checked={avecPhotos} onChange={e => setAvecPhotos(e.target.checked)} disabled={!!occupe} style={{ width: 18, height: 18, marginTop: 1, accentColor: "var(--petrol)" }} />
                <span>Chercher leur photo dans Medipim ({PHOTOS_MAX} produits au plus, environ une seconde chacun)</span>
              </label>
            )}
            {desactives > 0 && caseDesactive(desactives)}
            {incomplets > 0 && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>Indiquez le colis (quantité minimale) de {incomplets > 1 ? `chacun des ${incomplets} produits` : "ce produit"} : {guillemets(nom)} se vend au colis.</div>}
            <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.45 }}>{SITE} {panierTexte(sectionsTouchees(opsAjout), sections)}</p>
            {occupe && <div role="status" style={{ ...ui.encart("info"), marginBottom: 12 }}>{occupe}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={fermerAjout} disabled={!!occupe} style={ui.btn("doux", "m")}>{reste ? "Fermer" : "Annuler"}</button>
              {opsAjout.length > 0 && (
                <button type="button" data-defaut onClick={confirmerAjout} disabled={bloqueConfirmer} style={ui.btn("primaire", "m")}>
                  {occupe ? "Enregistrement…" : reste ? `Réessayer pour ${pluriel(opsAjout.length, "produit")}` : `${verbe} ${pluriel(opsAjout.length, "produit")}`}
                </button>
              )}
            </div>
          </Fenetre>
        );
      })()}

      {retraitDemande && (() => {
        const seul = retraitDemande.length === 1 ? retraitDemande[0] : null;
        const sec = (p) => nomSection(p._section ?? p.section, sections);
        const unique = new Set(retraitDemande.map(p => p._section ?? p.section)).size === 1;
        const titre = !retraitDemande.length ? "Bilan du retrait"
          : seul ? `Retirer ${guillemets(seul.name)} de ${guillemets(sec(seul))} ?`
          : `Retirer ${retraitDemande.length} produits ${unique ? `de ${guillemets(sec(retraitDemande[0]))}` : "de leurs sections"} ?`;
        return (
          <Fenetre id="sections-confirm-retrait" titre={titre} onFermer={fermerRetrait} bloque={!!occupe}>
            <BilanFenetre b={bilanFenetre} sections={sections} />
            {retraitDemande.length > 0 && <>
              {!seul && <Groupe titre="Produits retirés" lignes={retraitDemande.map(p => ({ cle: p.cip, texte: p.name, detail: `CIP ${p.cip} · ${guillemets(sec(p))}` }))} />}
              <p style={{ fontSize: 13, color: T.ink, margin: "0 0 10px", lineHeight: 1.45 }}>
                {seul ? "Le produit disparaît" : "Les produits disparaissent"} du site. {seul ? "Sa fiche, sa photo et son historique sont gardés" : "Leurs fiches, photos et historiques sont gardés"} :
                « Remettre » {seul ? "le" : "les"} fait revenir (liste « Produits retirés de cette section », sous le filtre de la section).
              </p>
              <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.45 }}>{SITE} {panierTexte(sectionsTouchees(opsRetrait), sections)}</p>
            </>}
            {occupe && <div role="status" style={{ ...ui.encart("info"), marginBottom: 12 }}>{occupe}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" data-defaut onClick={fermerRetrait} disabled={!!occupe} style={ui.btn("doux", "m")}>{bilanFenetre ? "Fermer" : "Annuler"}</button>
              {retraitDemande.length > 0 && (
                <button type="button" onClick={confirmerRetrait} disabled={!!occupe} style={ui.btn("danger", "m")}>
                  {occupe ? "Retrait…" : bilanFenetre ? `Réessayer pour ${pluriel(retraitDemande.length, "produit")}` : seul ? "Retirer" : `Retirer ${retraitDemande.length} produits`}
                </button>
              )}
            </div>
          </Fenetre>
        );
      })()}

      {remiseDemandee && opRemise && (() => {
        const r = remiseDemandee;
        const refus = refusRemise({ odoo: r.odoo, nom: r.name, section, stocke: r, sections });
        const fini = !!bilanFenetre && aRefaire(bilanFenetre) === 0;
        const bloqueConfirmer = !!occupe || !!refus || !!opRemise.incomplet || (opRemise.desactive && !confirmeDesactive);
        return (
          <Fenetre id="sections-confirm-remise" titre={`Remettre ${guillemets(r.name)} dans ${guillemets(nom)} ?`} onFermer={fermerRemise} bloque={!!occupe}>
            <BilanFenetre b={bilanFenetre} sections={sections} />
            {!fini && <>
              <div style={{ fontSize: 13, color: T.ink, margin: "0 0 10px", lineHeight: 1.5 }}>
                <div style={{ fontSize: 12, color: T.inkMute, fontFamily: T.mono }}>CIP {r.cip}</div>
                {opRemise.prix
                  ? <div>Prix montré aux pharmacies : <strong style={{ color: T.ok }}>{euros(opRemise.prix.pn)}</strong> net{opRemise.prix.pv > opRemise.prix.pn ? ` (prix ${euros(opRemise.prix.pv)})` : ""}, {opRemise.prix.source === "odoo" ? "repris d'Odoo du jour" : "prix enregistré (Odoo n'a pas de prix liste n°\u00a05)"}.</div>
                  : <div style={{ color: T.danger }}>Prix inconnu.</div>}
                {refus && <div style={{ color: T.danger, marginTop: 4 }}>{refus}</div>}
                {colisRequis(section) && <ChampColis op={opRemise} valeur={valeurColis(opRemise, r)} onChange={saisieColis(r.cip)} bloque={!!occupe} />}
              </div>
              {opRemise.desactive && caseDesactive(1)}
              <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.45 }}>{SITE} {panierTexte([section], sections)}</p>
            </>}
            {occupe && <div role="status" style={{ ...ui.encart("info"), marginBottom: 12 }}>{occupe}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={fermerRemise} disabled={!!occupe} style={ui.btn("doux", "m")}>{bilanFenetre ? "Fermer" : "Annuler"}</button>
              {!fini && (
                <button type="button" data-defaut onClick={confirmerRemise} disabled={bloqueConfirmer} style={ui.btn("primaire", "m")}>
                  {occupe ? "Remise…" : bilanFenetre ? "Réessayer" : "Remettre"}
                </button>
              )}
            </div>
          </Fenetre>
        );
      })()}
    </>
  );
}
