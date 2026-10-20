// ── Admin, « Affichage global » › « Page d'accueil » : les mises en avant de Zineb (docs/accueil.md § 7) ──
// Vitrine cinéma « Offre du moment » et grille « À la une », au-dessus des plus commandés : un produit (choisi par CIP,
// prix, remise, stock et règle de quantité du site) ou un menu promo entier. Clé ec_config « accueil_vedettes », publiée
// par l'éditeur lui-même (config-get POST avec base : 409 si un autre poste l'a modifiée, jamais d'écrasement silencieux ;
// display_config et admin_promos ne sont jamais écrits ici). Brouillon local : rien ne part avant « Publier ».
// États : publiés (GET accueil-offres, jeton admin : vedettes_etat), brouillon (?verifier= pour les produits, règles
// locales pour les dates et les menus). Repli automatique montré avec la règle de la page (repliMenus).
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { T, R, fmtEur, fmtPct, tone, ui } from "../theme.js";
import { teinteDominante } from "./teinte-photo.js";
import { LIMITES, MAX_VISIBLES, couleurDe, couleurMenu, dateTexte, finEffective, jourParis, menuEnCours, produitsVisibles,
  repliMenus, teintes, titreMenu, titreParDefaut } from "./accueil/vedettes.js";
import { erreursBrouillon, etatDate } from "./accueil/vedettes-regles.js";
import { photo } from "./accueil/outils.js";

const ApercuMea = React.lazy(() => import("./accueil/ApercuMea.jsx"));
const CLE = "accueil_vedettes";
const PLACES = { vitrine: ["Vitrine cinéma", "l'offre du moment · 5 au plus ; défile sur ordinateur"], grille: ["Grille", "à la une · 5 au plus ; la 1re en grand"] };
const BADGES = ["Exclusivité Elixir", "Nouveau", "Précommande", "Prix de lancement"];
const NUANCIER = [["Pétrole", "#0f2d3d"], ["Sarcelle", "#3c7782"], ["Menthe", "#a9cdc2"], ["Or clair", "#d7bb7f"]];
const SOURCES = { choisie: "choisie", photo: "tirée de la photo", menu: "couleur du menu", rayon: "couleur du rayon", elixir: "couleur Elixir" };
const STATUTS = {
  visible: ["ok", "Visible"], programmee: ["info", "Programmée"], terminee: ["neutral", "Terminée"], masquee: ["neutral", "Masquée"],
  rupture: ["warn", "Non visible : rupture"], introuvable: ["danger", "Non visible : introuvable"], sans_prix: ["danger", "Non visible : sans prix"],
  prix_anormal: ["danger", "Non visible : prix anormal"], justificatif: ["danger", "Non visible : sur justificatif labo"], campagne: ["danger", "Non visible : produit de campagne"],
  menu_masque: ["warn", "Non visible : menu masqué"], menu_inactif: ["warn", "Non visible : menu inactif"], menu_echu: ["warn", "Non visible : menu échu"],
  menu_vide: ["warn", "Non visible : menu vide"], invalide: ["danger", "À corriger"], au_dela_de_5: ["warn", "Au-delà de 5 : ne s'affiche pas"],
  verification: ["neutral", "Vérification…"], inconnu: ["neutral", "État inconnu"],
};
const ALERTE = new Set(["rupture", "introuvable", "sans_prix", "prix_anormal", "justificatif", "campagne", "menu_masque", "menu_inactif", "menu_echu", "menu_vide"]);
const vide = () => ({ version: 1, repli: true, defilement: true, items: [] });
const lireValeur = (v) => {
  let x = v;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { x = null; } }
  return x && typeof x === "object" ? { version: 1, repli: x.repli !== false, defilement: x.defilement !== false, items: Array.isArray(x.items) ? x.items : [] } : vide();
};
const sansMaj = ({ maj, ...x }) => x;   // eslint-disable-line no-unused-vars
const nouvelId = () => `mea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
const num = (x) => { const v = parseFloat(String(x ?? "").replace(",", ".").replace(/[^0-9.-]/g, "")); return Number.isFinite(v) ? v : null; };
const renumeroter = (items) => {
  for (const p of Object.keys(PLACES)) items.filter(i => i.emplacement === p).sort((a, b) => a.ordre - b.ordre).forEach((i, k) => { i.ordre = (k + 1) * 10; });
  return items;
};
const heure = (iso) => { const d = new Date(iso || Date.now()); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`; };
const intertitre = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: T.inkMute };
const champ = { ...ui.input, minHeight: 36, padding: "7px 10px", fontSize: 13 };

// accents : couleur de chaque rayon (clé → accent, celle du catalogue du site) pour la teinte « Auto » d'un produit
export default function AdminVedettes({ adminFetch, promos = [], displayConfig = {}, accents = {}, setTab, onDirtyChange }) {
  const [enLigne, setEnLigne] = useState(null);       // { valeur, maj } | { erreur }
  const [brouillon, setBrouillon] = useState(null);
  const [ouvert, setOuvert] = useState(null);         // formulaire déplié (id)
  const [ajout, setAjout] = useState(null);           // { place, type }
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState(null);       // { ton, texte, reessayer }
  const [conflit, setConflit] = useState(null);       // version en ligne refusée (409) : { valeur, maj }
  const [etats, setEtats] = useState({});             // publiés : id → { statut }
  const [verif, setVerif] = useState({});             // CIP → { offre, raisons } | { erreur }
  const [couleurMsg, setCouleurMsg] = useState({});   // id → message de la couleur automatique
  const [apercu, setApercu] = useState(false);
  const verifRef = useRef(verif); verifRef.current = verif;
  const aujourdhui = jourParis();
  const caches = new Set(displayConfig.hiddenTabs || []);

  const charger = async () => {
    try {
      const r = await fetch(`/.netlify/functions/config-get?key=${CLE}&_=${Date.now()}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const v = lireValeur(j.value);
      setEnLigne({ valeur: v, maj: j.updated_at ?? null }); setBrouillon(v); setConflit(null);
    } catch (e) { setEnLigne({ erreur: e.message }); }
  };
  const lireEtats = () => adminFetch?.(`/.netlify/functions/accueil-offres?_=${Date.now()}`).then(r => (r.ok ? r.json() : null))
    .then(j => { if (Array.isArray(j?.vedettes_etat)) setEtats(Object.fromEntries(j.vedettes_etat.map(x => [x.id, x]))); }).catch(() => {});
  const verifier = async (cips) => {
    const manquants = [...new Set(cips)].filter(c => /^\d{8,14}$/.test(c || "") && !verifRef.current[c]).slice(0, 20);
    if (!manquants.length || !adminFetch) return;
    setVerif(v => ({ ...v, ...Object.fromEntries(manquants.map(c => [c, { attente: true }])) }));
    const j = await adminFetch(`/.netlify/functions/accueil-offres?verifier=${manquants.join(",")}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    setVerif(v => ({ ...v, ...Object.fromEntries(manquants.map(c => [c, j?.verification?.[c] || { erreur: true }])) }));
  };
  useEffect(() => { charger(); lireEtats(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const nbProduits = brouillon?.items.filter(i => i.type === "produit").map(i => i.cip).join(",");
  useEffect(() => { if (nbProduits) verifier(nbProduits.split(",")); }, [nbProduits]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── modifications non publiées ──
  const valeurEnLigne = enLigne?.valeur;
  const modifs = useMemo(() => {
    if (!brouillon || !valeurEnLigne) return 0;
    const avant = new Map(valeurEnLigne.items.map(i => [i.id, JSON.stringify(sansMaj(i))]));
    return brouillon.items.filter(i => avant.get(i.id) !== JSON.stringify(sansMaj(i))).length
      + valeurEnLigne.items.filter(i => !brouillon.items.some(b => b.id === i.id)).length
      + (brouillon.repli !== valeurEnLigne.repli) + (brouillon.defilement !== valeurEnLigne.defilement);
  }, [brouillon, valeurEnLigne]);
  useEffect(() => { onDirtyChange?.(modifs > 0); }, [modifs > 0]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange?.(false), []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!modifs) return undefined;
    const avant = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, [modifs > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!enLigne) return <div style={{ fontSize: 12, color: T.inkMute, padding: "8px 0" }}>Chargement des mises en avant…</div>;
  if (enLigne.erreur) return <div style={{ ...ui.encart("warn"), fontSize: 12 }}>Mises en avant illisibles ({enLigne.erreur}). <button onClick={charger} style={{ ...ui.btn("ligne", "s"), height: 26, marginLeft: 6 }}>Réessayer</button></div>;

  const items = brouillon.items;
  const erreurs = erreursBrouillon(brouillon);
  const menuDe = (it) => (it.type === "menu" ? promos.find(p => String(p.id) === String(it.menu_id)) : null);
  const offreDe = (it) => (it.type === "produit" ? verif[it.cip]?.offre : null);
  const menuRangement = (it) => { const k = offreDe(it)?.menu?.key || ""; return k.startsWith("promo_") ? promos.find(p => `promo_${p.id}` === k) : null; };
  // état du brouillon (dates et menus : règles locales ; produits : vérification par le serveur)
  const evaluer = (it) => {
    if (erreurs.some(e => e.id === it.id)) return { statut: "invalide" };
    const m = menuDe(it), v = it.type === "produit" ? verif[it.cip] : null;
    const fin = finEffective(it.date_fin, (m || menuRangement(it))?.endDate);
    // même ordre que le serveur : masquée, programmée, motif du menu, terminée, motif du produit
    const d = etatDate(it, aujourdhui, null);
    if (d) return { statut: d, fin };
    if (it.type === "menu") {
      const st = !m ? "introuvable" : !m.active ? "menu_inactif" : !menuEnCours(m, aujourdhui) ? "menu_echu" : caches.has(`promo_${m.id}`) ? "menu_masque"
        : !produitsVisibles(m).length ? "menu_vide" : etatDate(it, aujourdhui, fin) || "visible";
      return { statut: st, fin };
    }
    if (etatDate(it, aujourdhui, fin)) return { statut: "terminee", fin };
    if (!v || v.attente) return { statut: "verification", fin };
    if (v.erreur) return { statut: etats[it.id]?.statut || "inconnu", fin };
    return { statut: v.raisons?.[0] || "visible", fin };
  };
  const evalues = new Map();
  for (const p of Object.keys(PLACES)) {
    let n = 0;
    items.filter(i => i.emplacement === p).sort((a, b) => a.ordre - b.ordre).forEach(it => {
      const e = evaluer(it);
      if (e.statut === "visible" && ++n > MAX_VISIBLES) e.statut = "au_dela_de_5";
      evalues.set(it.id, e);
    });
  }
  const liste = (p) => items.filter(i => i.emplacement === p).sort((a, b) => a.ordre - b.ordre);
  const visibles = (p) => liste(p).filter(i => evalues.get(i.id).statut === "visible");
  const titreDe = (it) => it.titre || (it.type === "menu" ? titreMenu(menuDe(it)) || "Menu introuvable" : offreDe(it) ? titreParDefaut(offreDe(it)) : `Produit ${it.cip}`);
  const accentDe = (it) => { const k = offreDe(it)?.menu?.key || ""; return k && !k.startsWith("promo_") && k !== "saisie" ? accents[k] : null; };
  const couleur = (it) => couleurDe(it, { menu: menuDe(it) || menuRangement(it), accent: accentDe(it) });
  // repli automatique (même règle que la page) : menus actifs non montrés
  const montrable = (m) => !caches.has(`promo_${m.id}`) && produitsVisibles(m).length > 0;
  const montres = new Set(items.filter(i => i.type === "menu" && evalues.get(i.id).statut === "visible").map(i => String(i.menu_id)));
  const auto = { vitrine: [], grille: [] };
  if (brouillon.repli) {
    const menus = repliMenus(promos, montres, aujourdhui, montrable);
    if (!visibles("vitrine").length && menus[0]) auto.vitrine = [menus[0]];
    if (!visibles("grille").length) auto.grille = menus.filter(m => !auto.vitrine.includes(m)).slice(0, MAX_VISIBLES);
  }
  const alertes = items.filter(i => ALERTE.has(evalues.get(i.id).statut));
  const terminees = items.filter(i => evalues.get(i.id).statut === "terminee");

  // ── édition du brouillon ──
  const modifier = (id, patch) => setBrouillon(b => ({ ...b, items: b.items.map(i => (i.id === id ? { ...i, ...patch } : i)) }));
  const deplacer = (id, d) => setBrouillon(b => {
    const its = b.items.map(i => ({ ...i })), it = its.find(i => i.id === id);
    const l = its.filter(i => i.emplacement === it.emplacement).sort((x, y) => x.ordre - y.ordre), k = l.indexOf(it), j = k + d;
    if (j < 0 || j >= l.length) return b;
    [l[k].ordre, l[j].ordre] = [l[j].ordre, l[k].ordre];
    return { ...b, items: renumeroter(its) };
  });
  const changerPlace = (id, place) => setBrouillon(b => {
    const dernier = Math.max(0, ...b.items.filter(i => i.emplacement === place && i.id !== id).map(i => i.ordre));
    return { ...b, items: renumeroter(b.items.map(i => (i.id === id ? { ...i, emplacement: place, ordre: dernier + 10 } : { ...i }))) };
  });
  const supprimer = (it) => { if (window.confirm(`Supprimer la mise en avant « ${titreDe(it)} » ? (rien ne part avant « Publier »)`)) setBrouillon(b => ({ ...b, items: b.items.filter(i => i.id !== it.id) })); };
  const calculerTeinte = (id, url) => {
    if (!url) return;
    setCouleurMsg(m => ({ ...m, [id]: "Lecture de la couleur de la photo…" }));
    teinteDominante(url).then(r => {
      modifier(id, { couleur_auto: r.hex || null });
      setCouleurMsg(m => ({ ...m, [id]: r.hex ? "" : r.erreur ? "L'hébergeur de cette photo ne permet pas d'en lire la couleur : couleur du menu ou du rayon utilisée. Choisissez-en une si vous préférez."
        : "Photo sans couleur dominante (produit blanc ou gris) : couleur du menu ou du rayon utilisée." }));
    });
  };
  const ajouter = (type, place, objet) => {
    const dernier = Math.max(0, ...items.filter(i => i.emplacement === place).map(i => i.ordre));
    const it = { id: nouvelId(), type, cip: type === "produit" ? objet.cip : null, menu_id: type === "menu" ? String(objet.id) : null, emplacement: place,
      titre: "", accroche: "", badge: "", date_debut: null, date_fin: null, ordre: dernier + 10, image: null, couleur: null, couleur_auto: null, actif: true, maj: new Date().toISOString() };
    setBrouillon(b => ({ ...b, items: [...b.items, it] }));
    setOuvert(it.id); setAjout(null);
    calculerTeinte(it.id, type === "produit" ? verif[objet.cip]?.offre?.image_url : (objet.products || []).find(p => p.image_url)?.image_url);
  };

  // ── publication (base / 409) ──
  const preparer = () => {
    const avant = new Map(valeurEnLigne.items.map(i => [i.id, JSON.stringify(sansMaj(i))]));
    const its = renumeroter(items.map(i => ({ ...i, titre: i.titre.trim(), accroche: i.accroche.trim(), badge: i.badge.trim(), image: i.image?.trim() || null })));
    const maint = new Date().toISOString();
    return { version: 1, repli: brouillon.repli, defilement: brouillon.defilement, items: its.map(i => (avant.get(i.id) === JSON.stringify(sansMaj(i)) ? i : { ...i, maj: maint })) };
  };
  const publier = async (base = enLigne.maj) => {
    const valeur = preparer();
    setEnvoi(true); setMessage(null);
    try {
      const r = await adminFetch("/.netlify/functions/config-get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: CLE, value: valeur, base: base ?? null }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success) {
        setEnLigne({ valeur, maj: j.updated_at ?? null }); setBrouillon(valeur); setConflit(null);
        setMessage({ ton: "ok", texte: `✓ Publié à ${heure()} : visible chez les pharmacies dans les 5 minutes (ou en rechargeant la page).` });
        lireEtats();
      } else if (r.status === 409) setConflit({ valeur: lireValeur(j.value), maj: j.updated_at ?? null });
      else setMessage({ ton: "danger", texte: `Non publié : ${j.error || `HTTP ${r.status}`}. Vos modifications sont gardées.`, reessayer: true });
    } catch (e) { setMessage({ ton: "danger", texte: `Non publié : ${e.message}. Vos modifications sont gardées.`, reessayer: true }); }
    setEnvoi(false);
  };
  const annuler = () => { if (window.confirm("Abandonner les modifications non publiées et revenir à la version en ligne ?")) { setBrouillon(valeurEnLigne); setOuvert(null); setMessage(null); } };
  const titreEnLigne = (i) => i.titre || (i.type === "menu" ? titreMenu(promos.find(p => String(p.id) === String(i.menu_id))) : `produit ${i.cip}`);
  const ecarts = conflit && (() => {
    const a = conflit.valeur.items, m = items;
    return { ajoutees: m.filter(i => !a.some(x => x.id === i.id)).map(titreDe), retirees: a.filter(x => !m.some(i => i.id === x.id)).map(titreEnLigne),
      modifiees: m.filter(i => { const x = a.find(y => y.id === i.id); return x && JSON.stringify(sansMaj(x)) !== JSON.stringify(sansMaj(i)); }).map(titreDe) };
  })();

  const deja = (type, cle) => items.find(i => (type === "menu" ? String(i.menu_id) === String(cle) : i.cip === cle));
  const ouvrirPromos = setTab ? () => { if (!modifs || window.confirm("Des mises en avant ne sont pas publiées. Ouvrir l'onglet Promos quand même ?")) setTab("promos"); } : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={intertitre}>Mises en avant · au-dessus des plus commandés</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>Un produit ou un menu promo entier ; rien ne part avant « Publier ».</div>
        </div>
        {modifs > 0 && <span style={{ ...ui.badge("warn"), fontSize: 12 }}>● {modifs} modification{modifs > 1 ? "s" : ""} non publiée{modifs > 1 ? "s" : ""}</span>}
        <button onClick={annuler} disabled={!modifs || envoi} style={{ ...ui.btn("ligne", "s"), opacity: modifs ? 1 : 0.5 }}>Annuler</button>
        <button onClick={() => setApercu(a => !a)} style={ui.btn("ligne", "s")} aria-expanded={apercu}>{apercu ? "Fermer l'aperçu" : "Aperçu"}</button>
        <button onClick={() => publier()} disabled={!modifs || envoi || erreurs.length > 0} style={{ ...ui.btn("primaire", "s"), opacity: !modifs || envoi || erreurs.length ? 0.5 : 1 }}>{envoi ? "Publication…" : "Publier"}</button>
      </div>
      {erreurs.length > 0 && <div role="alert" style={{ ...ui.encart("danger"), fontSize: 12, margin: "8px 0" }}>Publication impossible : {[...new Set(erreurs.map(e => `${e.id ? `${titreDe(items.find(i => i.id === e.id) || {})} — ` : ""}${e.message}`))].join(" ; ")}</div>}
      {message && <div role="status" style={{ ...ui.encart(message.ton), fontSize: 12, margin: "8px 0" }}>{message.texte}{message.reessayer && <button onClick={() => publier()} style={{ ...ui.btn("ligne", "s"), height: 26, marginLeft: 8 }}>Réessayer</button>}</div>}
      {conflit && (
        <div role="alert" style={{ ...ui.encart("warn"), fontSize: 12, margin: "8px 0" }}>
          <b>Modifiées depuis un autre poste{conflit.maj ? ` (le ${new Date(conflit.maj).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.</b> Rien n'a été publié.
          {ecarts.ajoutees.length > 0 && <div>Seulement dans votre version : {ecarts.ajoutees.join(", ")}</div>}
          {ecarts.retirees.length > 0 && <div>Seulement dans la version en ligne : {ecarts.retirees.join(", ")}</div>}
          {ecarts.modifiees.length > 0 && <div>Différentes : {ecarts.modifiees.join(", ")}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => { if (window.confirm("Abandonner votre version et reprendre celle en ligne ?")) { setEnLigne(conflit); setBrouillon(conflit.valeur); setConflit(null); } }} style={ui.btn("ligne", "s")}>Reprendre la version en ligne</button>
            <button onClick={() => { if (window.confirm(`Publier votre version à la place de celle en ligne ?${ecarts.retirees.length ? `\n\nDisparaîtront : ${ecarts.retirees.join(", ")}` : ""}`)) publier(conflit.maj); }} style={ui.btn("primaire", "s")}>Publier ma version à la place</button>
          </div>
        </div>
      )}
      {alertes.length > 0 && <div style={{ ...ui.encart("warn"), fontSize: 12, margin: "8px 0" }}>⚠ {alertes.length} mise{alertes.length > 1 ? "s" : ""} en avant {alertes.length > 1 ? "ne sont" : "n'est"} pas visible{alertes.length > 1 ? "s" : ""} en ce moment : {alertes.map(i => `${titreDe(i)} (${STATUTS[evalues.get(i.id).statut][1].replace("Non visible : ", "")})`).join(", ")}.</div>}
      {terminees.length > 0 && <div style={{ ...ui.encart("neutral"), fontSize: 12, margin: "8px 0" }}>{terminees.length} mise{terminees.length > 1 ? "s" : ""} en avant {terminees.length > 1 ? "sont terminées" : "est terminée"} : vous pouvez {terminees.length > 1 ? "les" : "la"} supprimer.</div>}
      {apercu && (
        <Suspense fallback={<div style={{ fontSize: 12, color: T.inkMute, padding: 12 }}>Chargement de l'aperçu…</div>}>
          <ApercuMea brouillon={brouillon} statut={(id) => evalues.get(id)?.statut} verif={verif} promos={promos} caches={caches} />
        </Suspense>
      )}

      {Object.entries(PLACES).map(([place, [nom, aide]]) => (
        <div key={place} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.petrol, marginBottom: 6 }}>{nom.toUpperCase()} <span style={{ fontWeight: 500, color: T.inkMute }}>· {aide}</span></div>
          <div style={{ border: "1px solid var(--line)", borderRadius: R.s, overflow: "hidden" }}>
            {liste(place).map((it, k, l) => (
              <Ligne key={it.id} it={it} titre={titreDe(it)} eval={evalues.get(it.id)} publie={etats[it.id]} premier={k === 0} dernier={k === l.length - 1} place={place}
                menu={menuDe(it)} offre={offreDe(it)} couleur={couleur(it)} ouvert={ouvert === it.id} onOuvrir={() => setOuvert(o => (o === it.id ? null : it.id))}
                onMonter={() => deplacer(it.id, -1)} onDescendre={() => deplacer(it.id, 1)} onMasquer={() => modifier(it.id, { actif: !it.actif })} onSupprimer={() => supprimer(it)} ouvrirPromos={ouvrirPromos}>
                {ouvert === it.id && <Formulaire it={it} titreDefaut={it.type === "menu" ? titreMenu(menuDe(it)) : titreParDefaut(offreDe(it))} menu={menuDe(it) || menuRangement(it)}
                  offre={offreDe(it)} couleur={couleur(it)} accent={accentDe(it)} erreurs={erreurs.filter(e => e.id === it.id)} couleurMsg={couleurMsg[it.id]} adminFetch={adminFetch}
                  onChange={(patch) => { modifier(it.id, patch); if ("image" in patch) calculerTeinte(it.id, patch.image || (it.type === "produit" ? offreDe(it)?.image_url : (menuDe(it)?.products || []).find(p => p.image_url)?.image_url)); }}
                  onPlace={(p) => changerPlace(it.id, p)} />}
              </Ligne>
            ))}
            {auto[place].length > 0 && (
              <div style={{ padding: "10px 12px", border: `1.5px dashed ${T.lineField}`, borderRadius: R.s, margin: 6, fontSize: 12, color: T.inkSoft }}>
                <span style={{ ...ui.badge("info"), marginRight: 8 }}>automatique</span>
                {auto[place].map(m => titreMenu(m)).join(", ")} — menu{auto[place].length > 1 ? "s" : ""} promo actif{auto[place].length > 1 ? "s" : ""}{place === "grille" ? " non montré(s) en vitrine" : " (fin la plus proche, sinon le plus récent)"}.
                <div style={{ color: T.inkMute, marginTop: 2 }}>Ajoutez une mise en avant pour remplacer ce choix automatique.</div>
              </div>
            )}
            {!liste(place).length && !auto[place].length && <div style={{ padding: "10px 12px", fontSize: 12, color: T.inkMute }}>Aucune mise en avant : {place === "vitrine" ? "pas de vitrine cinéma" : "pas de grille"} sur la page.</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={() => setAjout(a => (a?.place === place && a.type === "produit" ? null : { place, type: "produit" }))} style={ui.btn("ligne", "s")} aria-expanded={ajout?.place === place && ajout.type === "produit"}>+ Produit</button>
            <button onClick={() => setAjout(a => (a?.place === place && a.type === "menu" ? null : { place, type: "menu" }))} style={ui.btn("ligne", "s")} aria-expanded={ajout?.place === place && ajout.type === "menu"}>+ Menu promo</button>
          </div>
          {ajout?.place === place && ajout.type === "produit" && <AjoutProduit verif={verif} verifier={verifier} deja={(c) => deja("produit", c)} onChoisir={(p) => ajouter("produit", place, p)} />}
          {ajout?.place === place && ajout.type === "menu" && <AjoutMenu promos={promos} caches={caches} aujourdhui={aujourdhui} deja={(id) => deja("menu", id)} ouvrirPromos={ouvrirPromos} onChoisir={(m) => ajouter("menu", place, m)} />}
        </div>
      ))}
      <label style={{ display: "flex", gap: 10, padding: "12px 0 4px", fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={brouillon.repli} onChange={e => setBrouillon(b => ({ ...b, repli: e.target.checked }))} style={{ width: 16, height: 16, accentColor: "var(--teal)" }} />
        <span><b style={{ fontWeight: 600 }}>Sans mise en avant visible, montrer automatiquement les menus promo actifs</b><span style={{ display: "block", fontSize: 11, color: T.inkMute }}>La page n'est jamais nue : 1 menu en vitrine, les suivants dans la grille.</span></span>
      </label>
      <label style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={brouillon.defilement} onChange={e => setBrouillon(b => ({ ...b, defilement: e.target.checked }))} style={{ width: 16, height: 16, accentColor: "var(--teal)" }} />
        <span><b style={{ fontWeight: 600 }}>Défilement automatique de la vitrine sur ordinateur</b><span style={{ display: "block", fontSize: 11, color: T.inkMute }}>8 s par offre, deux tours ; jamais sur téléphone ni si l'utilisateur réduit les animations.</span></span>
      </label>
    </div>
  );
}

// ── vignette 16:9 (CSS seul) : salle, débord de la teinte, photo ou mini-cartes, médaillon or si remise ──
function Vignette({ it, menu, offre, couleur }) {
  const t = teintes(couleur.hex);
  const urls = it.type === "menu" ? [it.image, ...(menu?.products || []).map(p => p.image_url)].filter(Boolean).slice(0, 3) : [it.image || offre?.image_url].filter(Boolean);
  const remise = it.type === "menu" ? Math.max(0, ...produitsVisibles(menu).map(p => Math.abs(num(p.pct) ?? 0)).filter(x => x < 100)) : offre?.pct;
  return (
    <span aria-hidden="true" style={{ position: "relative", width: 112, height: 63, flexShrink: 0, borderRadius: 8, overflow: "hidden", opacity: it.actif ? 1 : 0.5,
      background: `radial-gradient(60% 90% at 66% 50%, ${t.sombre}, transparent 75%), linear-gradient(180deg, var(--deep), var(--petrol))` }}>
      <span style={{ position: "absolute", left: 44, top: 7, right: 6, bottom: 7, borderRadius: 5, background: `radial-gradient(70% 70% at 50% 45%, var(--paper) 45%, ${t.claire})`,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        {urls.length ? urls.map((u, k) => <img key={k} src={photo(u, "thumbnail")} alt="" draggable={false} style={{ maxHeight: 42, maxWidth: urls.length > 1 ? 22 : 54, objectFit: "contain", mixBlendMode: "multiply",
          ...(urls.length > 1 ? { background: "#fff", borderRadius: 3, padding: 1, transform: `rotate(${(k - 1) * 9}deg)`, margin: "0 -3px", boxShadow: "0 2px 6px rgba(0,0,0,.25)" } : {}) }} />)
          : <span style={{ width: 22, height: 30, borderRadius: 2, background: "var(--surface)", borderTop: `3px solid ${t.trait}`, boxShadow: "0 2px 6px rgba(0,0,0,.2)" }} />}
      </span>
      <span style={{ position: "absolute", left: 7, top: 14, width: 30, height: 4, borderRadius: 2, background: "rgba(251,248,242,.85)" }} />
      <span style={{ position: "absolute", left: 7, top: 22, width: 22, height: 4, borderRadius: 2, background: "rgba(251,248,242,.55)" }} />
      <span style={{ position: "absolute", left: 7, bottom: 12, width: 26, height: 7, borderRadius: 4, background: "var(--paper)" }} />
      {remise >= 1 && <span style={{ position: "absolute", right: 2, top: 2, width: 15, height: 15, borderRadius: "50%", background: "var(--or)" }} />}
    </span>
  );
}

function Puce({ statut, fin, debut }) {
  const [t, txt] = STATUTS[statut] || STATUTS.inconnu;
  const quand = statut === "programmee" && debut ? ` · à partir du ${dateTexte(debut, { court: true })}` : statut === "terminee" && fin ? ` le ${dateTexte(fin, { court: true })}` : "";
  return <span style={{ ...ui.badge(t), whiteSpace: "normal" }}>{statut === "visible" ? "● " : ""}{txt}{quand}</span>;
}

function Ligne({ it, titre, eval: ev, publie, premier, dernier, place, menu, offre, couleur, ouvert, onOuvrir, onMonter, onDescendre, onMasquer, onSupprimer, ouvrirPromos, children }) {
  const meta = it.type === "menu"
    ? `MENU PROMO · ${menu ? titreMenu(menu) : "introuvable"} · ${(menu?.products || []).length} p.`
    : `PRODUIT · ${offre?.menu?.label?.replace(/[\p{Extended_Pictographic}️‍]/gu, "").trim() || "…"} · ${offre?.pn > 0 ? `${fmtEur(offre.pn)} HT` : it.cip}${offre?.pct >= 1 ? ` · ${fmtPct(offre.pct)}` : ""}`;
  const dates = it.date_debut || it.date_fin || ev.fin ? `${it.date_debut ? `du ${dateTexte(it.date_debut, { court: true })} ` : ""}${ev.fin ? `${it.date_debut ? "au" : "jusqu'au"} ${dateTexte(ev.fin, { court: true })}` : "sans fin"}` : "";
  const petit = { ...ui.btn("ligne", "s"), height: 30, padding: "0 10px", fontSize: 12 };
  return (
    <div className="ex-tr" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", flexWrap: "wrap" }}>
        <Vignette it={it} menu={menu} offre={offre} couleur={couleur} />
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titre}{premier && place === "grille" ? <span style={{ ...ui.badge("neutral"), marginLeft: 6 }}>En grand</span> : null}</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{meta}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", minWidth: 150 }}>
          <Puce statut={ev.statut} fin={ev.fin} debut={it.date_debut} />
          {dates && <span style={{ fontSize: 11, color: T.inkMute }}>{dates}</span>}
          {publie && publie.statut !== ev.statut && <span style={{ fontSize: 10, color: T.inkMute }}>en ligne : {(STATUTS[publie.statut] || STATUTS.inconnu)[1].toLowerCase()}</span>}
          {/^menu_/.test(ev.statut) && ouvrirPromos && <button onClick={ouvrirPromos} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Onglet Promos</button>}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button onClick={onOuvrir} style={petit} aria-expanded={ouvert}>{ouvert ? "Fermer" : "Modifier"}</button>
          <button onClick={onMonter} disabled={premier} aria-label={`Monter « ${titre} »`} style={{ ...petit, width: 34, padding: 0, opacity: premier ? 0.4 : 1 }}>↑</button>
          <button onClick={onDescendre} disabled={dernier} aria-label={`Descendre « ${titre} »`} style={{ ...petit, width: 34, padding: 0, opacity: dernier ? 0.4 : 1 }}>↓</button>
          <button onClick={onMasquer} style={petit}>{it.actif ? "Masquer" : "Afficher"}</button>
          <button onClick={onSupprimer} style={{ ...petit, color: T.danger }}>Supprimer</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Compteur({ v, max }) { return <span style={{ fontSize: 11, fontWeight: 600, color: v > max ? T.danger : T.inkMute }}>{v}/{max}</span>; }

function Formulaire({ it, titreDefaut, menu, offre, couleur, accent, erreurs, couleurMsg, adminFetch, onChange, onPlace }) {
  const [adresse, setAdresse] = useState(it.image || "");
  const [banque, setBanque] = useState("");
  const err = (k) => erreurs.find(e => e.champ === k);
  const bord = (k) => (err(k) ? { borderColor: T.danger, boxShadow: `0 0 0 1px ${T.danger}` } : {});
  const medicament = it.type === "produit" && /^34009/.test(it.cip || "");
  const finMenu = menu?.endDate ? String(menu.endDate).slice(0, 10) : null;
  const chercher = async () => {
    setBanque("Recherche…");
    try {
      const r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${encodeURIComponent(it.cip)}`);
      if (r.status === 429 || r.status === 503) { setBanque("Base d'images saturée : réessayez dans une minute"); return; }
      const j = r.ok ? await r.json() : null;
      if (j?.image_url && /^https:\/\//.test(j.image_url)) { onChange({ image: j.image_url }); setAdresse(j.image_url); setBanque("Photo trouvée"); } else setBanque("Aucune photo trouvée");
    } catch { setBanque("Base d'images injoignable"); }
  };
  const ligne = { display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 10, alignItems: "start", marginBottom: 10 };
  const etiquette = { fontSize: 12, fontWeight: 700, color: T.inkSoft, paddingTop: 8 };
  const aide = { fontSize: 11, color: T.inkMute, marginTop: 4 };
  const pastille = (hex, actif, titre, onClick) => (
    <button key={titre} type="button" onClick={onClick} title={titre} aria-pressed={actif}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px 0 4px", borderRadius: R.pill, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
        background: actif ? T.ink : T.sand, color: actif ? T.paper : T.ink }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: hex, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />{titre}
    </button>
  );
  const auto = couleurDe({ ...it, couleur: null }, { menu, accent });
  return (
    <div style={{ padding: "12px 14px 14px", background: T.paper, borderTop: `1px solid ${T.lineSoft}` }}>
      <div style={ligne}><span style={etiquette}>Emplacement</span>
        <div role="radiogroup" aria-label="Emplacement" style={{ display: "flex", gap: 6, paddingTop: 2 }}>
          {Object.entries(PLACES).map(([p, [nom]]) => <button key={p} type="button" role="radio" aria-checked={it.emplacement === p} onClick={() => it.emplacement !== p && onPlace(p)} style={ui.pill(it.emplacement === p)}>{nom}</button>)}
        </div>
      </div>
      <label style={ligne}><span style={etiquette}>Titre <Compteur v={it.titre.length} max={LIMITES.titre} /></span>
        <span><input value={it.titre} onChange={e => onChange({ titre: e.target.value })} placeholder={titreDefaut || ""} style={{ ...champ, ...bord("titre") }} />
          <span style={{ ...aide, display: "block" }}>Court et parlant : il s'affiche en très grand. Vide : « {titreDefaut} ».</span></span>
      </label>
      <label style={ligne}><span style={etiquette}>Accroche <Compteur v={it.accroche.length} max={LIMITES.accroche} /></span>
        <textarea value={it.accroche} rows={2} onChange={e => onChange({ accroche: e.target.value })} placeholder={it.type === "menu" ? String(menu?.description || "") : ""} style={{ ...champ, resize: "vertical", ...bord("accroche") }} />
      </label>
      <div style={ligne}><span style={etiquette}>Badge <Compteur v={it.badge.length} max={LIMITES.badge} /></span>
        <span><input value={it.badge} onChange={e => onChange({ badge: e.target.value })} aria-label="Badge" style={{ ...champ, ...bord("badge") }} />
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{BADGES.map(b => <button key={b} type="button" onClick={() => onChange({ badge: b })} style={{ ...ui.pill(it.badge === b), height: 26, fontSize: 12 }}>{b}</button>)}</span>
          <span style={{ ...aide, display: "block" }}>La remise s'affiche d'elle-même dans le médaillon or.</span></span>
      </div>
      <div style={ligne}><span style={etiquette}>Dates</span>
        <span>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Du <input type="date" value={it.date_debut || ""} onChange={e => onChange({ date_debut: e.target.value || null })} aria-label="Date de début" style={{ ...champ, width: 160, ...bord("date_debut") }} />
            au <input type="date" value={it.date_fin || ""} onChange={e => onChange({ date_fin: e.target.value || null })} aria-label="Date de fin" style={{ ...champ, width: 160, ...bord("date_fin") }} />
          </span>
          {err("date_fin") && <span style={{ ...aide, display: "block", color: T.danger }}>{err("date_fin").message}</span>}
          <span style={{ ...aide, display: "block" }}>Vides : tout de suite, sans fin. Jours inclus (heure de Paris). Compte à rebours dans les 7 derniers jours seulement.
            {finMenu ? ` Le menu se termine le ${dateTexte(finMenu)} : la mise en avant s'arrête au plus tard ce jour-là.` : ""}</span>
        </span>
      </div>
      <div style={ligne}><span style={etiquette}>Photo</span>
        <span>
          {it.type === "produit" ? (<>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(it.image || offre?.image_url) ? <img src={photo(it.image || offre.image_url, "thumbnail")} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: `1px solid ${T.line}` }} />
                : <span style={{ fontSize: 12, color: T.inkMute }}>Boîte générée (marque, dosage, forme)</span>}
              <button type="button" onClick={chercher} style={ui.btn("ligne", "s")}>Chercher dans la banque d'images</button>
              {it.image && <button type="button" onClick={() => { onChange({ image: null }); setAdresse(""); }} style={ui.btn("ligne", "s")}>Revenir à la photo du catalogue</button>}
              {banque && <span style={{ fontSize: 11, color: T.inkMute }}>{banque}</span>}
            </span>
            <input value={adresse} onChange={e => setAdresse(e.target.value)} onBlur={() => onChange({ image: adresse.trim() || null })} placeholder="Coller une adresse https://…" style={{ ...champ, marginTop: 6, ...bord("image") }} />
          </>) : (<>
            <input value={adresse} onChange={e => setAdresse(e.target.value)} onBlur={() => onChange({ image: adresse.trim() || null })} placeholder="Carte de devant : adresse https://… (facultatif)" style={{ ...champ, ...bord("image") }} />
            <span style={{ ...aide, display: "block" }}>L'éventail montre les photos du menu dans son ordre ; moins de 3 photos : complété par des cartes texte.</span>
          </>)}
        </span>
      </div>
      <div style={ligne}><span style={etiquette}>Couleur</span>
        <span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {pastille(auto.hex, !it.couleur, `Auto (${SOURCES[auto.source]})`, () => onChange({ couleur: null }))}
            {NUANCIER.map(([nom, hex]) => pastille(hex, it.couleur === hex, nom, () => onChange({ couleur: hex })))}
            {couleurMenu(menu) && pastille(couleurMenu(menu), it.couleur === couleurMenu(menu), "Couleur du menu", () => onChange({ couleur: couleurMenu(menu) }))}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <input type="color" value={it.couleur || couleur.hex} onChange={e => onChange({ couleur: e.target.value.toLowerCase() })} style={{ width: 30, height: 30, border: "none", padding: 0, background: "none" }} />Autre
            </label>
          </span>
          {couleurMsg && <span style={{ ...aide, display: "block" }}>{couleurMsg}</span>}
        </span>
      </div>
      {medicament && <div style={{ ...ui.encart("warn"), fontSize: 12 }}>Médicament : restez sur le prix, la disponibilité et le conditionnement (publicité réglementée : pas d'allégation thérapeutique).</div>}
    </div>
  );
}

function AjoutProduit({ verif, verifier, deja, onChoisir }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const minuteur = useRef(0);
  const chercher = (v) => {
    setQ(v); clearTimeout(minuteur.current);
    if (v.trim().length < 2) { setRes(null); return; }
    minuteur.current = setTimeout(async () => {
      setRes("…");
      try {
        const r = await fetch(`/.netlify/functions/odoo-catalog?q=${encodeURIComponent(v.trim())}&limit=8`);
        const j = r.ok ? await r.json() : { products: [] };
        const l = (j.products || []).filter(p => p.cip);
        setRes(l); verifier(l.map(p => p.cip));
      } catch { setRes([]); }
    }, 300);
  };
  useEffect(() => () => clearTimeout(minuteur.current), []);
  return (
    <div style={{ marginTop: 8, padding: 12, background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.s }}>
      <input autoFocus value={q} onChange={e => chercher(e.target.value)} placeholder="CIP ou nom (2 caractères au moins)" aria-label="Chercher un produit par CIP ou par nom" style={champ} />
      {res === "…" && <div style={{ fontSize: 12, color: T.inkMute, marginTop: 8 }}>Recherche…</div>}
      {Array.isArray(res) && !res.length && <div style={{ fontSize: 12, color: T.inkMute, marginTop: 8 }}>Aucun produit trouvé.</div>}
      {Array.isArray(res) && res.map(p => {
        const v = verif[p.cip], raisons = v?.raisons || [], o = v?.offre;
        const motif = deja(p.cip) ? `Déjà mis en avant (${deja(p.cip).emplacement === "vitrine" ? "vitrine" : "grille"})` : raisons.includes("justificatif") ? "Sur justificatif labo : ajout direct impossible"
          : raisons.includes("campagne") ? "Produit de campagne" : null;
        const pn = num(p.discounted_price) > 0 ? num(p.discounted_price) : num(p.list_price);
        return (
          <button key={p.cip} type="button" disabled={!!motif || !v || v.attente} onClick={() => onChoisir(p)} className="ex-tr"
            style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", textAlign: "left", padding: "8px 6px", border: "none", borderBottom: `1px solid ${T.lineSoft}`, cursor: motif ? "not-allowed" : "pointer", opacity: motif ? 0.55 : 1, font: "inherit" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.ink }}>{p.name}</span>
              <span style={{ fontSize: 11, color: T.inkMute }}><span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{p.cip}</span>
                {pn > 0 ? ` · ${fmtEur(pn)} HT` : ""}{num(p.discount_pct) >= 1 ? ` · ${fmtPct(p.discount_pct)}` : ""}{o?.menu?.label ? ` · rangé dans ${o.menu.label}` : v?.attente ? " · vérification…" : ""}</span>
              {(motif || raisons.includes("rupture") || raisons.some(r => ["sans_prix", "prix_anormal", "introuvable", "menu_masque"].includes(r))) && (
                <span style={{ display: "block", fontSize: 11, color: motif ? T.danger : T.warn }}>{motif || (raisons.includes("rupture") ? "Masqué tant qu'il est en rupture" : `Non visible pour l'instant : ${raisons.map(r => STATUTS[r]?.[1].replace("Non visible : ", "") || r).join(", ")}`)}</span>
              )}
            </span>
            <span style={ui.badge(p.in_stock ? "ok" : "danger")}>{p.in_stock ? "En stock" : "Rupture"}</span>
          </button>
        );
      })}
    </div>
  );
}

function AjoutMenu({ promos, caches, aujourdhui, deja, ouvrirPromos, onChoisir }) {
  const etat = (m) => (!m.active ? "Inactif" : !menuEnCours(m, aujourdhui) ? `Échu le ${dateTexte(String(m.endDate).slice(0, 10), { court: true })}` : caches.has(`promo_${m.id}`) ? "Masqué"
    : m.endDate ? `Actif · fin le ${dateTexte(String(m.endDate).slice(0, 10), { court: true })}` : "Actif");
  const tries = [...promos].sort((a, b) => (menuEnCours(b, aujourdhui) ? 1 : 0) - (menuEnCours(a, aujourdhui) ? 1 : 0) || (Number(b.id) || 0) - (Number(a.id) || 0));
  return (
    <div style={{ marginTop: 8, padding: 6, background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.s, maxHeight: 340, overflowY: "auto" }}>
      {!tries.length && <div style={{ fontSize: 12, color: T.inkMute, padding: 8 }}>Aucun menu promo : créez-en un dans l'onglet Promos.</div>}
      {tries.map(m => {
        const pret = menuEnCours(m, aujourdhui) && !caches.has(`promo_${m.id}`), d = deja(m.id);
        return (
          <div key={m.id} className="ex-tr" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>
            <span style={{ fontSize: 20, width: 28, textAlign: "center" }} aria-hidden="true">{m.icon || "🏷️"}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.ink }}>{titreMenu(m)}</span>
              <span style={{ fontSize: 11, color: pret ? T.ok : T.inkMute }}>{etat(m)} · {(m.products || []).length} produit{(m.products || []).length > 1 ? "s" : ""}</span>
              {!pret && !d && <span style={{ display: "block", fontSize: 11, color: T.warn }}>Ne s'affichera qu'une fois le menu actif. {ouvrirPromos && <button onClick={ouvrirPromos} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Ouvrir l'onglet Promos</button>}</span>}
            </span>
            <button type="button" disabled={!!d} onClick={() => onChoisir(m)} style={{ ...ui.btn("ligne", "s"), opacity: d ? 0.5 : 1 }}>{d ? `Déjà en ${d.emplacement === "vitrine" ? "vitrine" : "grille"}` : "Mettre en avant"}</button>
          </div>
        );
      })}
    </div>
  );
}
