import React, { useEffect, useMemo, useRef, useState } from "react";
import { T, R, ui, adm } from "../theme.js";
import { PHOTOS_MAX, nomSection, sectionBloquee, etatCip, verdictAjout, operation, verifierPlan, appliquer, photosMedipim, prixOdoo,
  euros, pluriel, dateCourte, bilanTexte, guillemets } from "./sections-produits.js";

// ── Admin, onglet ✏️ Modifier : ajouter et retirer des produits d'une section existante (règles : sections-produits.js) ──
// Chargé à la demande par AdminEdit (React.lazy). Section choisie dans le filtre de l'onglet :
//  • « ＋ Ajouter des produits à « … » » : recherche dans le catalogue Odoo (odoo-catalog, comme l'onglet ➕ Ajouter et la
//    Saisie : nom, CIP ou EAN), état de chaque CIP sur le site (products-sections?cips=), choix multiple, confirmation ;
//  • « Produits retirés de cette section » (products-sections?section=) avec « Remettre » ;
//  • sélection par cases à cocher (cartes d'AdminEdit) et « Retirer la sélection » (barre en bas de l'écran).
// Retrait d'une seule carte (bouton « Retirer » d'AdminEdit, toutes sections comprises) : fenêtre de confirmation d'ici.
// Toute écriture : products-upsert, une ligne à la fois, après relecture de l'état (verifierPlan) ; jamais la configuration.
const LIMITE = 30;
const SITE = "Les pharmacies verront ce changement au prochain chargement du site (ouverture ou actualisation de la page).";
const PANIER = "Une pharmacie qui avait déjà des produits de cette section dans son panier le retrouvera vidé à ce moment-là : c'est la protection habituelle du site quand une section change.";

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

// Liste d'une fenêtre de confirmation (un groupe d'opérations)
function Groupe({ titre, note, lignes }) {
  if (!lignes.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.petrol }}>{titre}</div>
      {note && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>{note}</div>}
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", border: `1px solid ${T.line}`, borderRadius: R.s, maxHeight: 220, overflowY: "auto" }}>
        {lignes.map(([cle, texte, detail]) => (
          <li key={cle} style={{ padding: "7px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 13, color: T.ink }}>
            <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{texte}</div>
            {detail && <div style={{ fontSize: 11, color: T.inkMute, marginTop: 1 }}>{detail}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Stock = ({ s }) => {
  if (!s) return <span style={ui.badge("neutral")}>Stock inconnu</span>;
  return s.in_stock ? <span style={ui.badge("ok")}>En stock{s.available != null ? ` · ${Math.round(s.available)}` : ""}</span> : <span style={ui.badge("danger")}>Rupture</span>;
};

export default function AdminSections({
  section, sections, products, affiches = [], selection, setSelection, retraitDemande, setRetraitDemande,
  campagnes = [], promos = [], adminFetch, flash, fetchProducts,
}) {
  const enSection = !!section && section !== "all";
  const bloque = enSection ? sectionBloquee(section, { campagnes, sections }) : null;
  const actif = enSection && !bloque;
  const nom = nomSection(section, sections);
  const dansSection = useMemo(() => (products || []).filter(p => (p._section ?? p.section) === section), [products, section]);

  const [occupe, setOccupe] = useState(null);         // texte de progression pendant une écriture
  const [bilan, setBilan] = useState(null);
  const [retires, setRetires] = useState({ etat: "attente", liste: [] });
  const [ouvertRetires, setOuvertRetires] = useState(false);
  const [ouvertAjout, setOuvertAjout] = useState(false);
  const [confirmAjout, setConfirmAjout] = useState(false);
  const [avecPhotos, setAvecPhotos] = useState(true);
  const [choix, setChoix] = useState({});              // cip → { ligne, etat, type }
  const [q, setQ] = useState("");
  const [stockSeul, setStockSeul] = useState(false);
  const [relance, setRelance] = useState(0);
  const [res, setRes] = useState({ etat: "vide", lignes: [], produits: {}, stocks: {} });
  const tour = useRef(0);
  const tourRetires = useRef(0);

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

  // changement de section : tout repart de zéro
  useEffect(() => {
    setChoix({}); setBilan(null); setOuvertAjout(false); setConfirmAjout(false); setQ(""); setRetires({ etat: "attente", liste: [] }); setOuvertRetires(false);
    chargerRetires();
  }, [section, actif]);   // eslint-disable-line react-hooks/exhaustive-deps

  // recherche dans le catalogue Odoo, puis état de chaque CIP sur le site
  useEffect(() => {
    const t = q.trim();
    if (!ouvertAjout || t.length < 2) { tour.current++; setRes({ etat: "vide", lignes: [], produits: {}, stocks: {} }); return; }
    const n = ++tour.current;
    setRes(r => ({ ...r, etat: "charge" }));
    const minuterie = setTimeout(async () => {
      try {
        const r = await fetch(`/.netlify/functions/odoo-catalog?q=${encodeURIComponent(t)}&limit=${LIMITE}${stockSeul ? "&stock_only=1" : ""}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `recherche : erreur ${r.status}`);
        const vus = new Set();   // un CIP une fois (codes-barres en double dans Odoo)
        const lignes = (d.products || []).filter(p => p && p.cip && !vus.has(p.cip) && vus.add(p.cip));
        let etats = { produits: {}, stocks: {} };
        if (lignes.length) {
          const s = await adminFetch(`/.netlify/functions/products-sections?cips=${lignes.map(l => encodeURIComponent(l.cip)).join(",")}`);
          const sj = await s.json().catch(() => ({}));
          if (!s.ok) throw new Error(sj.error || `état des produits sur le site : erreur ${s.status}`);
          etats = { produits: sj.produits || {}, stocks: sj.stocks || {} };
        }
        if (n === tour.current) setRes({ etat: "ok", lignes, ...etats });
      } catch (e) { if (n === tour.current) setRes({ etat: "erreur", erreur: e.message, lignes: [], produits: {}, stocks: {} }); }
    }, 300);
    return () => clearTimeout(minuterie);
  }, [q, stockSeul, ouvertAjout, relance, adminFetch]);

  // ── écriture : relecture de l'état, products-upsert une ligne à la fois, photos, liste rafraîchie ──
  const executer = async (ops, { photos = false } = {}) => {
    if (!ops.length || occupe) return null;
    setOccupe("Vérification de l'état des produits…");
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
      const b = { ...fait, perimes, photos: ph, section };
      setBilan(b);
      flash(bilanTexte(b, section, sections));
      return b;
    } catch (e) {
      const b = { faits: [], echecs: [], nonTraites: ops, perimes: [], erreur: e.message, section };
      setBilan(b);
      flash("⚠ " + e.message);
      return b;
    } finally {
      setOccupe(null);
      chargerRetires();
    }
  };

  const basculer = (ligne, etat, type) => setChoix(c => {
    const n = { ...c };
    if (n[ligne.cip]) delete n[ligne.cip]; else n[ligne.cip] = { ligne, etat, type };
    return n;
  });
  const opsAjout = useMemo(() => Object.values(choix).map(c => operation(c.type, { cip: c.ligne.cip, section, ligne: c.ligne, etat: c.etat })), [choix, section]);
  const confirmerAjout = async () => {
    const b = await executer(opsAjout, { photos: avecPhotos });
    if (!b) return;
    // faits et périmés (état changé entre-temps, raison dans le bilan) quittent les choix ; un échec reste choisi, à relancer
    const traites = new Set([...b.faits, ...b.perimes.map(p => p.op)].map(o => o.cip));
    setChoix(c => Object.fromEntries(Object.entries(c).filter(([cip]) => !traites.has(cip))));
    setConfirmAjout(false);
    setRelance(x => x + 1);
  };

  const opsRetrait = useMemo(() => (retraitDemande || []).map(p => operation("retirer", { cip: p.cip, section: p._section ?? p.section, produit: p })), [retraitDemande]);
  const confirmerRetrait = async () => {
    const b = await executer(opsRetrait);
    if (!b) return;
    const faits = new Set(b.faits.map(o => o.cip));
    setSelection(s => new Set([...s].filter(c => !faits.has(c))));
    setRetraitDemande(null);
    setRelance(x => x + 1);
  };

  // sélection (cases des cartes) : produits de la section seulement
  const choisis = actif ? dansSection.filter(p => selection.has(p.cip)) : [];
  const affichesSection = actif ? affiches.filter(p => p.cip && (p._section ?? p.section) === section) : [];
  const tousAffichesChoisis = affichesSection.length > 0 && affichesSection.every(p => selection.has(p.cip));
  const nbChoix = Object.keys(choix).length;

  const lignesRes = res.lignes.map(l => {
    const etat = etatCip(l.cip, section, res.produits);
    return { l, etat, v: verdictAjout({ ligne: l, etat, section, campagnes, sections }) };
  });

  const btnLong = { ...ui.btn("primaire", "s"), whiteSpace: "normal", height: "auto", minHeight: 36, padding: "8px 14px", lineHeight: 1.25, textAlign: "left" };

  return (
    <>
      {bilan && (
        <div role="status" style={{ ...ui.encart(bilan.erreur || bilan.echecs.length || bilan.perimes.length || bilan.nonTraites.length ? "warn" : "ok"), marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{bilan.erreur ? `⚠ Rien n'a été enregistré : ${bilan.erreur}` : bilanTexte(bilan, bilan.section, sections)}</strong>
            {[...bilan.perimes.map(({ op, raison }) => [op.cip, `${op.nom} : ${raison} — rien n'a été fait`]),
              ...bilan.echecs.map(({ op, erreur }) => [op.cip, `${op.nom} : ${erreur}`]),
              ...(bilan.erreur ? [] : bilan.nonTraites.map(op => [op.cip, `${op.nom} : non tenté`]))].map(([cle, t]) => (
              <div key={cle} style={{ fontSize: 12, marginTop: 4 }}>• {t}</div>
            ))}
            {bilan.photos && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Photos Medipim : {pluriel(bilan.photos.trouvees, "ajoutée")}{bilan.photos.introuvables ? `, ${pluriel(bilan.photos.introuvables, "introuvable")}` : ""}
                {bilan.photos.nonTraitees ? `, ${pluriel(bilan.photos.nonTraitees, "à chercher", "à chercher")} plus tard avec « 🔄 Importer photos Medipim… » en bas de la liste` : ""}
                {bilan.photos.arret ? ` (${bilan.photos.arret})` : ""}
              </div>
            )}
            {!!bilan.faits.length && <div style={{ fontSize: 12, marginTop: 4 }}>{SITE}</div>}
          </div>
          <button type="button" onClick={() => setBilan(null)} aria-label="Fermer ce message" className="ex-btn-discret" style={{ ...adm.fermer, width: 28, height: 28, fontSize: 14, background: "transparent", color: "inherit" }}>✕</button>
        </div>
      )}

      {enSection && bloque && (
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
              <input id="sections-recherche" type="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off"
                placeholder="Nom, CIP ou EAN (2 caractères au moins)" style={{ ...adm.input, fontSize: 16 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: T.inkSoft, marginTop: 8, minHeight: 32, cursor: "pointer" }}>
                <input type="checkbox" checked={stockSeul} onChange={e => setStockSeul(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--petrol)" }} />
                En stock seulement
              </label>

              {nbChoix > 0 && (
                <div style={{ ...ui.encart("info"), marginTop: 10 }}>
                  <div style={{ fontWeight: 700 }}>{pluriel(nbChoix, "produit choisi", "produits choisis")}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                    {Object.values(choix).map(c => (
                      <span key={c.ligne.cip} style={{ ...ui.badge("neutral"), whiteSpace: "normal", maxWidth: "100%", padding: "3px 4px 3px 10px", gap: 6 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.type === "deplacer" ? "↪ " : c.type === "remettre" ? "↺ " : "+ "}{c.ligne.name}</span>
                        <button type="button" onClick={() => basculer(c.ligne, c.etat, c.type)} aria-label={`Retirer ${c.ligne.name} des produits choisis`}
                          style={{ ...ui.rond(22), background: "transparent", color: "inherit", fontSize: 12 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <button type="button" onClick={() => setConfirmAjout(true)} disabled={!!occupe} style={btnLong}>
                    {`Ajouter ${pluriel(nbChoix, "produit")} à ${guillemets(nom)}…`}
                  </button>
                </div>
              )}

              <div aria-live="polite" style={{ fontSize: 12, color: T.inkMute, marginTop: 8 }}>
                {res.etat === "charge" && "Recherche…"}
                {res.etat === "erreur" && <span style={{ color: T.danger }}>⚠ {res.erreur}</span>}
                {res.etat === "ok" && !res.lignes.length && "Aucun produit trouvé dans le catalogue Odoo."}
                {res.etat === "ok" && res.lignes.length >= LIMITE && `Les ${LIMITE} premiers résultats : précisez la recherche pour en voir d'autres.`}
              </div>

              {res.lignes.length > 0 && (
                <ul style={{ margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {lignesRes.map(({ l, etat, v }) => {
                    const pris = !!choix[l.cip];
                    const prix = prixOdoo(l);
                    const enPromo = promosParCip[l.cip];
                    const statut = etat.type === "ici" ? { ton: T.ok, t: "✓ Déjà dans cette section" }
                      : v.type === "deplacer" ? { ton: T.warn, t: `Dans ${guillemets(nomSection(etat.section, sections))} : un produit n'est que dans une section, « Déplacer ici » l'en retire.` }
                      : v.type === "remettre" ? { ton: T.inkSoft, t: `Retiré${etat.section ? ` de ${guillemets(nomSection(etat.section, sections))}` : ""}${dateCourte(res.produits[l.cip]?.updated_at) ? ` le ${dateCourte(res.produits[l.cip].updated_at)}` : ""} : « Remettre ici » le rallume dans cette section.` }
                      : v.type === "ajouter" ? { ton: T.inkMute, t: "Pas encore sur le site" }
                      : { ton: T.danger, t: v.raison };
                    const libelle = v.type === "ajouter" ? (pris ? "✓ Choisi" : "Choisir") : v.type === "deplacer" ? (pris ? "✓ À déplacer ici" : "Déplacer ici") : (pris ? "✓ À remettre" : "Remettre ici");
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
            {retires.liste.length > 0 && (
              <ul style={{ margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {retires.liste.map(r => {
                  const o = r.odoo;
                  const net = o ? (o.discounted_price > 0 ? o.discounted_price : o.list_price) : null;
                  const quand = dateCourte(r.retrait?.date || r.updated_at);
                  const retrait = r.retrait?.action === "section_retrait" ? "Retiré" : "Désactivé";
                  return (
                    <li key={r.cip} style={{ listStyle: "none", border: `1px solid ${T.line}`, background: T.surface, borderRadius: R.s, padding: "10px 12px",
                      display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: T.ink, wordBreak: "break-word" }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                          <span style={{ fontFamily: T.mono }}>CIP {r.cip}</span>{quand ? ` · ${retrait} le ${quand}` : ""}{r.retrait?.author ? ` (${r.retrait.author})` : ""}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "center", fontSize: 12, marginTop: 4 }}>
                          {net > 0 ? <span><strong style={{ color: T.ok }}>{euros(net)}</strong> net (Odoo)</span>
                            : <span style={{ color: T.warn }}>Plus dans Odoo : prix enregistré {euros(r.pn)}</span>}
                          {o && <Stock s={o} />}
                        </div>
                      </div>
                      <button type="button" disabled={!!occupe} onClick={() => executer([operation("remettre", { cip: r.cip, section, produit: r })])}
                        style={{ ...ui.btn("ligne", "s"), marginLeft: "auto" }} aria-label={`Remettre ${r.name} dans ${nom}`}>
                        ↺ Remettre
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        </section>
      )}

      {/* barre de la sélection (cases des cartes) : en bas de l'écran tant qu'au moins un produit est coché */}
      {choisis.length > 0 && !retraitDemande && (
        <div role="region" aria-label="Produits sélectionnés" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 16, zIndex: 1200,
          background: T.petrol, color: T.paper, borderRadius: R.pill, boxShadow: T.shadow2, padding: "6px 6px 6px 16px", display: "flex", alignItems: "center",
          gap: 10, maxWidth: "calc(100vw - 24px)", boxSizing: "border-box" }}>
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{pluriel(choisis.length, "sélectionné")}</span>
          <button type="button" onClick={() => setRetraitDemande(choisis)} style={ui.btn("danger", "s")}>Retirer la sélection</button>
          <button type="button" onClick={() => setSelection(new Set())} aria-label="Tout désélectionner" style={{ ...ui.rond(32), background: "transparent", color: T.paper, fontSize: 14 }}>✕</button>
        </div>
      )}

      {confirmAjout && (
        <Fenetre id="sections-confirm-ajout" titre={`Ajouter à ${guillemets(nom)}`} onFermer={() => setConfirmAjout(false)} bloque={!!occupe}>
          <Groupe titre={`Nouveaux sur le site (${opsAjout.filter(o => o.type === "ajouter").length})`}
            note="Nom et prix repris d'Odoo (prix de vente et liste n° 5) ; le site affiche toujours le prix d'Odoo du jour."
            lignes={opsAjout.filter(o => o.type === "ajouter").map(o => [o.cip, o.nom, `CIP ${o.cip} · ${euros(o.corps.product.pn)} net`])} />
          <Groupe titre={`Déplacés ici (${opsAjout.filter(o => o.type === "deplacer").length})`}
            note="Un produit n'est que dans une section : ils quittent leur section actuelle."
            lignes={opsAjout.filter(o => o.type === "deplacer").map(o => [o.cip, o.nom, `${guillemets(nomSection(o.depuis, sections))} → ${guillemets(nom)}`])} />
          <Groupe titre={`Remis sur le site (${opsAjout.filter(o => o.type === "remettre").length})`}
            lignes={opsAjout.filter(o => o.type === "remettre").map(o => [o.cip, o.nom, o.depuis && o.depuis !== section ? `retiré de ${guillemets(nomSection(o.depuis, sections))}, remis dans ${guillemets(nom)}` : `CIP ${o.cip}`])} />
          {opsAjout.some(o => o.type === "ajouter") && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, margin: "4px 0 12px", cursor: "pointer" }}>
              <input type="checkbox" checked={avecPhotos} onChange={e => setAvecPhotos(e.target.checked)} disabled={!!occupe} style={{ width: 18, height: 18, marginTop: 1, accentColor: "var(--petrol)" }} />
              <span>Chercher leur photo dans Medipim ({PHOTOS_MAX} produits au plus, environ une seconde chacun)</span>
            </label>
          )}
          <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.45 }}>{SITE} {PANIER}</p>
          {occupe && <div role="status" style={{ ...ui.encart("info"), marginBottom: 12 }}>{occupe}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setConfirmAjout(false)} disabled={!!occupe} style={ui.btn("doux", "m")}>Annuler</button>
            <button type="button" data-defaut onClick={confirmerAjout} disabled={!!occupe || !opsAjout.length} style={ui.btn("primaire", "m")}>
              {occupe ? "Enregistrement…" : `Confirmer (${opsAjout.length})`}
            </button>
          </div>
        </Fenetre>
      )}

      {retraitDemande && retraitDemande.length > 0 && (() => {
        const seul = retraitDemande.length === 1 ? retraitDemande[0] : null;
        const sec = (p) => nomSection(p._section ?? p.section, sections);
        const unique = new Set(retraitDemande.map(p => p._section ?? p.section)).size === 1;
        const titre = seul ? `Retirer ${guillemets(seul.name)} de ${guillemets(sec(seul))}\u00a0?`
          : `Retirer ${retraitDemande.length} produits ${unique ? `de ${guillemets(sec(retraitDemande[0]))}` : "de leurs sections"}\u00a0?`;
        return (
          <Fenetre id="sections-confirm-retrait" titre={titre} onFermer={() => setRetraitDemande(null)} bloque={!!occupe}>
            {!seul && <Groupe titre="Produits retirés" lignes={retraitDemande.map(p => [p.cip, p.name, `CIP ${p.cip} · ${guillemets(sec(p))}`])} />}
            <p style={{ fontSize: 13, color: T.ink, margin: "0 0 10px", lineHeight: 1.45 }}>
              {seul ? "Le produit disparaît" : "Les produits disparaissent"} du site. {seul ? "Sa fiche, sa photo et son historique sont gardés" : "Leurs fiches, photos et historiques sont gardés"} :
              « Remettre » {seul ? "le" : "les"} fait revenir (liste « Produits retirés de cette section », sous le filtre de la section).
            </p>
            <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.45 }}>{SITE} {PANIER}</p>
            {occupe && <div role="status" style={{ ...ui.encart("info"), marginBottom: 12 }}>{occupe}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" data-defaut onClick={() => setRetraitDemande(null)} disabled={!!occupe} style={ui.btn("doux", "m")}>Annuler</button>
              <button type="button" onClick={confirmerRetrait} disabled={!!occupe} style={ui.btn("danger", "m")}>
                {occupe ? "Retrait…" : seul ? "Retirer" : `Retirer ${retraitDemande.length} produits`}
              </button>
            </div>
          </Fenetre>
        );
      })()}
    </>
  );
}
