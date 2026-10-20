// ── Admin, « Affichage global » › « Page d'accueil » : les mises en avant de Zineb (docs/accueil.md § 7) ──
// Vitrine cinéma « Offre du moment » et grille « À la une », au-dessus des plus commandés : un produit (choisi par CIP,
// prix, remise, stock et règle de quantité du site) ou un menu promo entier. Clé ec_config « accueil_vedettes », publiée
// par l'éditeur lui-même (config-get POST avec base : 409 si un autre poste l'a modifiée, jamais d'écrasement silencieux ;
// display_config et admin_promos ne sont jamais écrits ici). Brouillon local : rien ne part avant « Publier ».
// États : publiés (GET accueil-offres, jeton admin : vedettes_etat), brouillon (?verifier= pour les produits, règles
// locales pour les dates et les menus). Repli automatique montré avec la règle de la page (repliMenus).
// Photo : banque d'images, adresse https, ou « Ajouter une photo » de l'ordinateur (photo-manuelle.js : réduite, envoyée
// par product-upload-image sous une clé « accueil-… » neuve à chaque envoi : catalogue intact, version en ligne inchangée
// jusqu'à « Publier »). État de la photo de chaque mise en avant tenu ici, pas dans le formulaire : fermé puis rouvert
// pendant un envoi, il montre toujours « Envoi… » ; un jeton par mise en avant fait ignorer une réponse dépassée (envoi
// ou recherche plus ancien, adresse collée ou retour au catalogue entre-temps) : le dernier choix l'emporte.
// Affichage vérifié (incident du 20/10/2026, stockage des photos privé : carte de devant blanche malgré « ✓ Photo
// ajoutée ») : une photo envoyée n'entre dans le brouillon qu'une fois affichée par le navigateur (envoyerEtVerifier de
// photo-manuelle.js) ; sinon message clair, motif lu dans la réponse du stockage (bucket privé : réglage, docs/accueil.md ;
// fichier absent, panne, connexion). Photos du brouillon et de la version en ligne contrôlées : « Photo illisible » avec
// son motif (vignette, miniature du formulaire, ligne), avertissement à « Publier » (sans le bloquer), « Vérifier de nouveau ».
// Couleur automatique : photo trop lente → « Relire la couleur » (jamais « l'hébergeur ne permet pas » à tort).
// Outil du site (docs/accueil.md § 7.8) : « Ajouter : Un produit · Un menu promo · Un outil » ; liste des 6 outils avec
// leurs chiffres du moment (outils_etat du GET, jeton admin), l'outil masqué ou vide signalé, ajout permis même non
// visible ; badge pré-rempli, titre et accroche par défaut en indication ; photo de Zineb ou composition automatique ;
// teinte de l'outil (pas de teinte automatique : photos du fabricant sans CORS) ; jamais de compte à rebours.
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { T, R, fmtEur, fmtPct, tone, ui } from "../theme.js";
import { Icone } from "../icons.jsx";
import { teinteDominante } from "./teinte-photo.js";
import { LIMITES, MAX_VISIBLES, accentOutil, couleurDe, couleurMenu, dateTexte, finEffective, jourParis, menuEnCours, produitsVisibles,
  repliMenus, teintes, titreMenu, titreParDefaut } from "./accueil/vedettes.js";
import { OUTILS, OUTILS_MEA, cartesOutil, chiffresTexte } from "./accueil/rubriques.js";
import { erreursBrouillon, etatDate } from "./accueil/vedettes-regles.js";
import { photo, surErreurPhoto, useIllisibles, useMedia } from "./accueil/outils.js";
import { estIllisible } from "./accueil/illisibles.js";
import { ACCEPT, AIDE, cleMiseEnAvant, controlerAffichage, controlerFichier, envoyerEtVerifier, expliquerIllisible, illisibleCarPrive, preparerPhoto,
  raisonIllisible, reverifierIllisibles, suivre } from "./photo-manuelle.js";

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
  menu_vide: ["warn", "Non visible : menu vide"], invalide: ["danger", "À corriger"], au_dela_de_5: ["warn", "Au-delà de 5 : en réserve"],
  outil_masque: ["warn", "Non visible : outil masqué dans le menu"], outil_vide: ["warn", "Non visible : aucun produit en ce moment"],
  donnees_anciennes: ["warn", "Non visible : données de plus de 36 h"], donnees_indisponibles: ["warn", "Non visible : données illisibles"],
  verification: ["neutral", "Vérification…"], inconnu: ["neutral", "État inconnu"],
};
const ALERTE = new Set(["rupture", "introuvable", "sans_prix", "prix_anormal", "justificatif", "campagne", "menu_masque", "menu_inactif", "menu_echu", "menu_vide",
  "outil_masque", "outil_vide", "donnees_anciennes", "donnees_indisponibles"]);
const vide = () => ({ version: 1, repli: true, defilement: true, items: [] });
const lireValeur = (v) => {
  let x = v;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { x = null; } }
  return x && typeof x === "object" ? { version: 1, repli: x.repli !== false, defilement: x.defilement !== false, items: Array.isArray(x.items) ? x.items : [] } : vide();
};
const sansMaj = ({ maj, ...x }) => x;   // eslint-disable-line no-unused-vars
// ce que la page montre à la place des photos choisies illisibles (mises en avant concernées)
const A_LA_PLACE = { produit: "la photo du catalogue (ou la boîte générée)", menu: "les photos du menu", outil: "la composition automatique de l'outil" };
const aLaPlaceDe = (liste) => {
  const types = [...new Set(liste.map(i => i.type))].filter(t => A_LA_PLACE[t]);
  return types.length === 1 ? A_LA_PLACE[types[0]] : types.map(t => `${A_LA_PLACE[t]} (${t === "produit" ? "produit" : t === "menu" ? "menu promo" : "outil"})`).join(" ou ");
};
const sansEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
const nouvelId = () => `mea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
const num = (x) => { const v = parseFloat(String(x ?? "").replace(",", ".").replace(/[^0-9.-]/g, "")); return Number.isFinite(v) ? v : null; };
const renumeroter = (items) => {
  for (const p of Object.keys(PLACES)) items.filter(i => i.emplacement === p).sort((a, b) => a.ordre - b.ordre).forEach((i, k) => { i.ordre = (k + 1) * 10; });
  return items;
};
const heure = (iso) => { const d = new Date(iso || Date.now()); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`; };
const intertitre = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: T.inkMute };
const champ = { ...ui.input, minHeight: 36, padding: "7px 10px", fontSize: 13 };
const COULEUR_MESSAGE = { ok: T.ok, warn: T.warn, danger: T.danger };
// zone de message de la photo : toujours présente (lue dès son premier message), masquée vide
const CACHE = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" };

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
  const [outilsEtat, setOutilsEtat] = useState(null); // outils du site : clé → { raisons, chiffres, admin, selon_pharmacie } (GET admin)
  const [verif, setVerif] = useState({});             // CIP → { offre, raisons } | { erreur }
  const [couleurMsg, setCouleurMsg] = useState({});   // id → message de la couleur automatique
  const [photoEtats, setPhotoEtats] = useState({});   // id → { occupe: "recherche" | "envoi" | null, texte, ton, n }
  const jetons = useRef(new Map());                   // id → numéro de la dernière opération sur la photo
  const jetonsTeinte = useRef(new Map());             // id → numéro de la dernière lecture de couleur (une lecture dépassée est ignorée)
  const [apercu, setApercu] = useState(false);
  const [reverif, setReverif] = useState(null);       // « Vérifier de nouveau » : null | "en cours" | bilan
  const verifRef = useRef(verif); verifRef.current = verif;
  useIllisibles();   // photo notée illisible (contrôle, vignette) : « Photo illisible » et avertissement redessinés
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
    .then(j => {
      if (Array.isArray(j?.vedettes_etat)) setEtats(Object.fromEntries(j.vedettes_etat.map(x => [x.id, x])));
      // outils : chiffres et motifs du moment ; illisibles (réponse refusée, ancien serveur) → état inconnu, plus « Vérification… »
      setOutilsEtat(o => (j?.outils_etat && typeof j.outils_etat === "object" ? j.outils_etat : o || {}));
    }).catch(() => setOutilsEtat(o => o || {}));
  const verifier = async (cips) => {
    // à vérifier : jamais vérifiés, ou vérification en échec (429, 502, réseau : refaite au prochain passage)
    const manquants = [...new Set(cips)].filter(c => /^\d{8,14}$/.test(c || "") && (!verifRef.current[c] || verifRef.current[c].erreur)).slice(0, 20);
    if (!manquants.length || !adminFetch) return;
    setVerif(v => ({ ...v, ...Object.fromEntries(manquants.map(c => [c, { attente: true }])) }));
    const j = await adminFetch(`/.netlify/functions/accueil-offres?verifier=${manquants.join(",")}&_=${Date.now()}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    setVerif(v => ({ ...v, ...Object.fromEntries(manquants.map(c => [c, j?.verification?.[c] || { erreur: true }])) }));
  };
  useEffect(() => { charger(); lireEtats(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // outil masqué ou réaffiché (icône œil, plus bas dans l'onglet) : états et chiffres relus peu après la publication de
  // l'affichage (« en ligne : … ») ; le masquage lui-même se lit tout de suite dans displayConfig (caches)
  const clesCaches = [...caches].sort().join("|");
  const cachesVus = useRef(clesCaches);
  useEffect(() => {
    if (cachesVus.current === clesCaches) return undefined;
    cachesVus.current = clesCaches;
    const t = setTimeout(() => lireEtats(), 1500);
    return () => clearTimeout(t);
  }, [clesCaches]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nbProduits = brouillon?.items.filter(i => i.type === "produit").map(i => i.cip).join(",");
  useEffect(() => { if (nbProduits) verifier(nbProduits.split(",")); }, [nbProduits]);   // eslint-disable-line react-hooks/exhaustive-deps
  // photos choisies (brouillon et version en ligne) : chacune contrôlée une fois ; illisible → notée (illisibles.js)
  const imagesChoisies = [...new Set([...(brouillon?.items || []), ...(enLigne?.valeur?.items || [])].map(i => i.image).filter(Boolean))].join("|");
  useEffect(() => { if (imagesChoisies) imagesChoisies.split("|").forEach(u => controlerAffichage(u, { variante: photo(u, "thumbnail") })); }, [imagesChoisies]);
  // motif de chaque photo du stockage notée illisible (contrôle ou miniature) : lu dans la réponse du stockage, jamais deviné
  const illisiblesChoisies = imagesChoisies ? imagesChoisies.split("|").filter(estIllisible).join("|") : "";
  useEffect(() => { if (illisiblesChoisies) illisiblesChoisies.split("|").forEach(u => expliquerIllisible(u)); }, [illisiblesChoisies]);

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
    if (it.type === "outil") {
      // même ordre que le serveur : masquée, programmée, terminée, outil masqué dans le menu, motif de l'outil
      const fin = finEffective(it.date_fin, null), d = etatDate(it, aujourdhui, fin);
      if (d) return { statut: d, fin };
      if (it.outil !== "groupees" && caches.has(it.outil)) return { statut: "outil_masque", fin };
      const o = outilsEtat?.[it.outil];
      if (!o) return { statut: outilsEtat ? "inconnu" : "verification", fin };
      // masquage : l'état vivant (caches) seulement, jamais celui lu par le serveur au dernier GET (outil réaffiché depuis)
      return { statut: (o.raisons || []).filter(r => r !== "outil_masque")[0] || "visible", fin, selon: !!o.selon_pharmacie };
    }
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
  const titreDe = (it) => it.titre || (it.type === "outil" ? OUTILS[it.outil]?.titre || "Outil inconnu" : it.type === "menu" ? titreMenu(menuDe(it)) || "Menu introuvable"
    : offreDe(it) ? titreParDefaut(offreDe(it)) : `Produit ${it.cip}`);
  // teinte d'un outil : accent de sa rubrique (celui du catalogue du site), le violet par défaut remplacé par la sarcelle ;
  // libellé renommé dans l'admin (sur-titre de l'aperçu, comme sur la page des pharmacies)
  const catalogueAccents = Object.fromEntries([...new Set([...Object.keys(accents || {}), ...Object.keys(displayConfig.labels || {})])]
    .map(k => [k, { ...(accents?.[k] ? { accent: accents[k] } : {}), ...(displayConfig.labels?.[k] ? { label: displayConfig.labels[k] } : {}) }]));
  const accentDe = (it) => { if (it.type === "outil") return accentOutil(it.outil, catalogueAccents); const k = offreDe(it)?.menu?.key || ""; return k && !k.startsWith("promo_") && k !== "saisie" ? accents[k] : null; };
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
  // photos choisies qui ne s'affichent pas : signalées (la page les remplace), jamais bloquantes pour « Publier »
  const sansPhoto = items.filter(i => i.image && estIllisible(i.image));
  const reverifier = async () => {
    setReverif("en cours");
    const urls = [...new Set(sansPhoto.map(i => i.image))];
    const reste = urls.length - await reverifierIllisibles(urls);
    setReverif(reste ? `${reste} photo${reste > 1 ? "s" : ""} toujours illisible${reste > 1 ? "s" : ""}.` : "✓ Les photos s'affichent de nouveau.");
  };
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
  // la dernière lecture lancée pour une mise en avant l'emporte (photo changée ou retirée entre-temps : résultat ignoré) ;
  // url vide : aucune lecture, celle en cours est abandonnée. type : « couleur de l'outil » pour un outil
  const calculerTeinte = (id, url, type) => {
    const n = (jetonsTeinte.current.get(id) || 0) + 1;
    jetonsTeinte.current.set(id, n);
    const actuelle = () => jetonsTeinte.current.get(id) === n;
    if (!url) return;
    const repli = type === "outil" ? "couleur de l'outil" : "couleur du menu ou du rayon";
    setCouleurMsg(m => ({ ...m, [id]: "Lecture de la couleur de la photo…" }));
    teinteDominante(url).then(async r => {
      if (!actuelle()) return;
      modifier(id, { couleur_auto: r.hex || null });
      // photo trop lente (2 s) : ni l'hébergeur ni la photo en cause, « Relire la couleur » ; lecture refusée : hébergeur sans
      // en-tête CORS (la photo s'affiche), ou photo qui ne s'affiche pas du tout (à dire autrement)
      const relire = { texte: `La photo a mis trop de temps à se charger : ${repli} utilisée pour l'instant.`, relire: url };
      if (r.erreur === "delai") { setCouleurMsg(m => ({ ...m, [id]: relire })); return; }
      const verdict = r.erreur ? (estIllisible(url) ? "illisible" : await controlerAffichage(url, { variante: photo(url, "thumbnail") })) : null;
      if (!actuelle()) return;
      setCouleurMsg(m => ({ ...m, [id]: r.hex ? "" : verdict === "illisible" ? `Photo illisible : ${repli} utilisée.`
        : verdict === "ok" ? `L'hébergeur de cette photo ne permet pas d'en lire la couleur : ${repli} utilisée. Choisissez-en une si vous préférez.`
          : r.erreur ? { ...relire, texte: `Couleur de la photo non lue (photo lente ou injoignable) : ${repli} utilisée pour l'instant.` }
            : `Photo sans couleur dominante (produit blanc ou gris) : ${repli} utilisée.` }));
    });
  };
  // ── photo d'une mise en avant : banque d'images, ordinateur, adresse ; la dernière opération lancée l'emporte ──
  // outil : aucune photo par défaut (photos du fabricant sans CORS) ; retour à la composition : teinte de l'outil
  const photoDefaut = (it) => (it.type === "outil" ? null : it.type === "produit" ? offreDe(it)?.image_url : (menuDe(it)?.products || []).find(p => p.image_url)?.image_url);
  const changerImage = (it, image) => {
    modifier(it.id, { image, ...(it.type === "outil" && !image ? { couleur_auto: null } : {}) });
    // outil revenu à la composition automatique : plus de photo, plus de message sur sa couleur (lecture en cours abandonnée)
    if (it.type === "outil" && !image) setCouleurMsg(m => ({ ...m, [it.id]: "" }));
    calculerTeinte(it.id, image || photoDefaut(it), it.type);
  };
  const noterPhoto = (id, e) => setPhotoEtats(x => ({ ...x, [id]: e ? { occupe: null, texte: "", ton: "neutral", ...e, n: (x[id]?.n || 0) + 1 } : null }));
  const jeton = (id) => { const n = (jetons.current.get(id) || 0) + 1; jetons.current.set(id, n); return () => jetons.current.get(id) === n; };
  // adresse collée, retour à la photo du catalogue, carte retirée : choix explicite, une réponse en cours ne l'écrase plus
  const imageManuelle = (it, image) => { jeton(it.id); noterPhoto(it.id, null); if ((it.image || null) !== image) changerImage(it, image); };
  const chercherPhoto = async (it) => {
    const actuel = jeton(it.id);
    noterPhoto(it.id, { occupe: "recherche", texte: "Recherche…" });
    try {
      const r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${encodeURIComponent(it.cip)}`);
      if (!actuel()) return;
      if (r.status === 429 || r.status === 503) { noterPhoto(it.id, { texte: "Base d'images saturée : réessayez dans une minute.", ton: "warn" }); return; }
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (!actuel()) return;
      if (j?.image_url && /^https:\/\//.test(j.image_url)) { changerImage(it, j.image_url); noterPhoto(it.id, { texte: "Photo trouvée." }); } else noterPhoto(it.id, { texte: "Aucune photo trouvée." });
    } catch { if (actuel()) noterPhoto(it.id, { texte: "Base d'images injoignable.", ton: "warn" }); }
  };
  // photo de l'ordinateur : réduite, envoyée (clé « accueil-… » : le catalogue n'est pas touché), mise dans le brouillon
  const ajouterPhoto = (it, fichier) => {
    const refus = controlerFichier(fichier);
    if (refus) { noterPhoto(it.id, { texte: refus, ton: "danger" }); return undefined; }
    const actuel = jeton(it.id);
    return suivre((async () => {
      noterPhoto(it.id, { occupe: "envoi", texte: "Préparation de la photo…" });
      let prete;
      try { prete = await preparerPhoto(fichier); } catch (e) { if (actuel()) noterPhoto(it.id, { texte: e.message, ton: "danger" }); return; }
      if (!actuel()) return;
      // envoi, puis l'adresse doit s'afficher AVANT d'entrer dans le brouillon (photo-manuelle.js, envoyerEtVerifier) ;
      // sinon rien dans le brouillon, message avec le motif lu dans la réponse du stockage
      const res = await envoyerEtVerifier({ adminFetch, cle: cleMiseEnAvant(it), prete,
        publier: (url) => { if (!actuel()) return null; changerImage(it, url); return { ok: true }; },
        etape: (texte) => { if (actuel()) noterPhoto(it.id, { occupe: "envoi", texte }); } });
      if (!actuel()) return;
      if (!res.url) { noterPhoto(it.id, { texte: res.message, ton: res.ton }); return; }
      // banc d'essai : adresse locale, que la règle des mises en avant (https) refuse à la publication
      noterPhoto(it.id, { texte: /^https:\/\//.test(res.url) ? `✓ Photo ajoutée : visible sur l'accueil après « Publier »${it.type === "produit" ? " (le catalogue n'est pas modifié)" : ""}.`
        : "✓ Photo ajoutée (banc d'essai : adresse locale, refusée à la publication ; en ligne, l'adresse est en https).", ton: "ok" });
    })());
  };
  const ajouter = (type, place, objet) => {
    const dernier = Math.max(0, ...items.filter(i => i.emplacement === place).map(i => i.ordre));
    const it = { id: nouvelId(), type, ...(type === "outil" ? { outil: objet.cle } : {}), cip: type === "produit" ? objet.cip : null, menu_id: type === "menu" ? String(objet.id) : null, emplacement: place,
      titre: "", accroche: "", badge: type === "outil" ? OUTILS[objet.cle]?.badge || "" : "", date_debut: null, date_fin: null, ordre: dernier + 10, image: null, couleur: null,
      couleur_auto: null, actif: true, maj: new Date().toISOString() };
    setBrouillon(b => ({ ...b, items: [...b.items, it] }));
    setOuvert(it.id); setAjout(null);
    // outil : pas de teinte automatique (photos du fabricant sans CORS ; la teinte de l'outil suffit)
    if (type !== "outil") calculerTeinte(it.id, type === "produit" ? verif[objet.cip]?.offre?.image_url : (objet.products || []).find(p => p.image_url)?.image_url);
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
        const publieesIllisibles = valeur.items.filter(i => i.image && estIllisible(i.image));
        const nb = publieesIllisibles.length;
        setMessage(nb
          ? { ton: "warn", texte: `Publié à ${heure()}, avec ${nb > 1 ? `${nb} photos illisibles` : "une photo illisible"} (${publieesIllisibles.map(i => `« ${titreDe(i)} »`).join(", ")}) : l'accueil montre à la place ${aLaPlaceDe(publieesIllisibles)} tant qu'${nb > 1 ? "elles ne s'affichent" : "elle ne s'affiche"} pas. Le reste est visible chez les pharmacies dans les 5 minutes, tout de suite en rechargeant la page.` }
          : { ton: "ok", texte: `✓ Publié à ${heure()} : visible chez les pharmacies dans les 5 minutes, tout de suite en rechargeant la page.` });
        lireEtats();
      } else if (r.status === 409) setConflit({ valeur: lireValeur(j.value), maj: j.updated_at ?? null });
      else setMessage({ ton: "danger", texte: `Non publié : ${j.error || `HTTP ${r.status}`}. Vos modifications sont gardées.`, reessayer: true });
    } catch (e) { setMessage({ ton: "danger", texte: `Non publié : ${e.message}. Vos modifications sont gardées.`, reessayer: true }); }
    setEnvoi(false);
  };
  const annuler = () => { if (window.confirm("Abandonner les modifications non publiées et revenir à la version en ligne ?")) { setBrouillon(valeurEnLigne); setOuvert(null); setMessage(null); } };
  const titreEnLigne = (i) => i.titre || (i.type === "outil" ? OUTILS[i.outil]?.titre || `outil ${i.outil}` : i.type === "menu" ? titreMenu(promos.find(p => String(p.id) === String(i.menu_id))) : `produit ${i.cip}`);
  const ecarts = conflit && (() => {
    const a = conflit.valeur.items, m = items;
    return { ajoutees: m.filter(i => !a.some(x => x.id === i.id)).map(titreDe), retirees: a.filter(x => !m.some(i => i.id === x.id)).map(titreEnLigne),
      modifiees: m.filter(i => { const x = a.find(y => y.id === i.id); return x && JSON.stringify(sansMaj(x)) !== JSON.stringify(sansMaj(i)); }).map(titreDe) };
  })();

  const deja = (type, cle) => items.find(i => (type === "outil" ? i.type === "outil" && i.outil === cle : type === "menu" ? i.type === "menu" && String(i.menu_id) === String(cle) : i.type === "produit" && i.cip === cle));
  // outils : libellé (renommage de l'admin compris), chiffres du moment, résumé de la ligne
  const libelleOutil = (cle) => sansEmoji(displayConfig.labels?.[cle]) || OUTILS[cle]?.libelle || cle;
  const chiffresOutil = (cle) => outilsEtat?.[cle]?.chiffres || null;
  const resumeOutil = (cle) => (cle === "groupees" ? "pharmacies inscrites seulement" : chiffresTexte(cle, chiffresOutil(cle)).meta.split(" · ")[0] || (outilsEtat ? "sans chiffres en ce moment" : "…"));
  // ce que Zineb doit savoir d'un outil mis en avant : correspondance des fauteuils pas calculée (largeurs peut-être
  // sous-comptées), comptes de la Saisie plus mis à jour
  const avertissementOutil = (cle) => {
    const a = outilsEtat?.[cle]?.admin;
    if ((cle === "fauteuil" || cle === "transfert") && a?.correspondance && a.correspondance !== "odoo") return AVERTISSEMENT_CORRESPONDANCE;
    if (cle === "saisie" && (a?.comptes === "anciens" || a?.comptes === "illisibles")) return TEXTE_SEUL_SAISIE[a.comptes];
    return "";
  };
  const ouvrirPromos = setTab ? () => { if (!modifs || window.confirm("Des mises en avant ne sont pas publiées. Ouvrir l'onglet Promos quand même ?")) setTab("promos"); } : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={intertitre}>Mises en avant · au-dessus des plus commandés</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>Un produit, un menu promo entier ou un outil du site ; rien ne part avant « Publier ».</div>
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
      {sansPhoto.length > 0 && (
        <div role="status" style={{ ...ui.encart("warn"), fontSize: 12, margin: "8px 0" }}>
          ⚠ Photo illisible pour {sansPhoto.map(i => `« ${titreDe(i)} »`).join(", ")} : {raisonIllisible(sansPhoto[0].image)}.
          {" "}L'accueil montre à la place {aLaPlaceDe(sansPhoto)} ; « Publier » reste possible.
          {sansPhoto.some(i => illisibleCarPrive(i.image)) ? ` Une fois le réglage fait, « Vérifier de nouveau » : ${sansPhoto.length > 1 ? "elles réapparaissent d'elles-mêmes" : "elle réapparaît d'elle-même"}.` : ""}
          <button type="button" onClick={reverifier} disabled={reverif === "en cours"} style={{ ...ui.btn("ligne", "s"), height: 26, marginLeft: 8 }}>{reverif === "en cours" ? "Vérification…" : "Vérifier de nouveau"}</button>
          {reverif && reverif !== "en cours" && <span style={{ marginLeft: 8 }}>{reverif}</span>}
        </div>
      )}
      {!sansPhoto.length && reverif && reverif !== "en cours" && <div role="status" style={{ fontSize: 12, color: T.ok, margin: "8px 0" }}>{reverif}</div>}
      {terminees.length > 0 && <div style={{ ...ui.encart("neutral"), fontSize: 12, margin: "8px 0" }}>{terminees.length} mise{terminees.length > 1 ? "s" : ""} en avant {terminees.length > 1 ? "sont terminées" : "est terminée"} : vous pouvez {terminees.length > 1 ? "les" : "la"} supprimer.</div>}
      {apercu && (
        <Suspense fallback={<div style={{ fontSize: 12, color: T.inkMute, padding: 12 }}>Chargement de l'aperçu…</div>}>
          <ApercuMea brouillon={brouillon} statut={(id) => evalues.get(id)?.statut} verif={verif} promos={promos} caches={caches} outilsEtat={outilsEtat} accents={catalogueAccents} />
        </Suspense>
      )}

      {Object.entries(PLACES).map(([place, [nom, aide]]) => (
        <div key={place} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.petrol, marginBottom: 6 }}>{nom.toUpperCase()} <span style={{ fontWeight: 500, color: T.inkMute }}>· {aide}</span></div>
          <div style={{ border: "1px solid var(--line)", borderRadius: R.s, overflow: "hidden" }}>
            {liste(place).map((it, k, l) => (
              <Ligne key={it.id} it={it} titre={titreDe(it)} eval={evalues.get(it.id)} publie={etats[it.id]} premier={k === 0} dernier={k === l.length - 1} place={place}
                menu={menuDe(it)} offre={offreDe(it)} couleur={couleur(it)} ouvert={ouvert === it.id} onOuvrir={() => setOuvert(o => (o === it.id ? null : it.id))}
                outil={it.type === "outil" ? { libelle: libelleOutil(it.outil), resume: resumeOutil(it.outil), chiffres: chiffresOutil(it.outil), avertissement: avertissementOutil(it.outil) } : null}
                onMonter={() => deplacer(it.id, -1)} onDescendre={() => deplacer(it.id, 1)} onMasquer={() => modifier(it.id, { actif: !it.actif })} onSupprimer={() => supprimer(it)} ouvrirPromos={ouvrirPromos}>
                {ouvert === it.id && <Formulaire it={it} titreDefaut={it.type === "outil" ? OUTILS[it.outil]?.titre : it.type === "menu" ? titreMenu(menuDe(it)) : titreParDefaut(offreDe(it))}
                  accrocheDefaut={it.type === "outil" ? OUTILS[it.outil]?.accroche(chiffresOutil(it.outil)) : it.type === "menu" ? String(menuDe(it)?.description || "") : ""} menu={menuDe(it) || menuRangement(it)}
                  offre={offreDe(it)} couleur={couleur(it)} accent={accentDe(it)} erreurs={erreurs.filter(e => e.id === it.id)} couleurMsg={couleurMsg[it.id]} onRelireCouleur={(u) => calculerTeinte(it.id, u, it.type)}
                  nom={titreDe(it)} photoEtat={photoEtats[it.id]} onChercher={() => chercherPhoto(it)} onFichier={(f) => ajouterPhoto(it, f)} onImage={(image) => imageManuelle(it, image)}
                  onChange={(patch) => modifier(it.id, patch)} onPlace={(p) => changerPlace(it.id, p)} />}
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
          <div role="group" aria-label={`Ajouter dans : ${nom}`} style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.inkSoft, marginRight: 2 }}>Ajouter :</span>
            {[["produit", "Un produit", "panier"], ["menu", "Un menu promo", "etiquette"], ["outil", "Un outil", "cible"]].map(([type, texte, icone]) => {
              const actif = ajout?.place === place && ajout.type === type;
              return (
                <button key={type} type="button" onClick={() => setAjout(a => (a?.place === place && a.type === type ? null : { place, type }))} aria-expanded={actif}
                  style={{ ...ui.pill(actif), height: 30, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <Icone nom={icone} taille={14} />{texte}
                </button>
              );
            })}
          </div>
          {ajout?.place === place && ajout.type === "produit" && <AjoutProduit verif={verif} verifier={verifier} deja={(c) => deja("produit", c)} onChoisir={(p) => ajouter("produit", place, p)} />}
          {ajout?.place === place && ajout.type === "outil" && <AjoutOutil outilsEtat={outilsEtat} caches={caches} libelle={libelleOutil} deja={(cle) => deja("outil", cle)}
            onChoisir={(cle) => ajouter("outil", place, { cle })} />}
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
// Photo choisie illisible : retirée comme sur la page (photos du menu, photo du catalogue), pastille rouge « illisible »
// outil : sa photo, sinon la 1re photo du fabricant (fauteuils), sinon son icône en pétrole ; point or si « jusqu'à »
function Vignette({ it, menu, offre, couleur, outil }) {
  const t = teintes(couleur.hex);
  const ok = (u) => u && !estIllisible(u);
  const urls = it.type === "outil" ? [[it.image, cartesOutil(it.outil, outil?.chiffres).find(c => c.url)?.url].find(ok)].filter(Boolean)
    : it.type === "menu" ? [...new Set([it.image, ...(menu?.products || []).map(p => p.image_url)].filter(ok))].slice(0, 3) : [[it.image, offre?.image_url].find(ok)].filter(Boolean);
  const illisible = !!it.image && estIllisible(it.image);
  const remise = it.type === "outil" ? (it.outil === "peremption" ? outil?.chiffres?.jusqua : 0)
    : it.type === "menu" ? Math.max(0, ...produitsVisibles(menu).map(p => Math.abs(num(p.pct) ?? 0)).filter(x => x < 100)) : offre?.pct;
  return (
    <span aria-hidden="true" style={{ position: "relative", width: 112, height: 63, flexShrink: 0, borderRadius: 8, overflow: "hidden", opacity: it.actif ? 1 : 0.5,
      background: `radial-gradient(60% 90% at 66% 50%, ${t.sombre}, transparent 75%), linear-gradient(180deg, var(--deep), var(--petrol))` }}>
      <span style={{ position: "absolute", left: 44, top: 7, right: 6, bottom: 7, borderRadius: 5, background: `radial-gradient(70% 70% at 50% 45%, var(--paper) 45%, ${t.claire})`,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        {urls.length ? urls.map((u, k) => <img key={u} src={photo(u, "thumbnail")} alt="" draggable={false} onError={(ev) => surErreurPhoto(u, ev)} style={{ maxHeight: 42, maxWidth: urls.length > 1 ? 22 : 54, objectFit: "contain", mixBlendMode: "multiply",
          ...(urls.length > 1 ? { background: "#fff", borderRadius: 3, padding: 1, transform: `rotate(${(k - 1) * 9}deg)`, margin: "0 -3px", boxShadow: "0 2px 6px rgba(0,0,0,.25)" } : {}) }} />)
          : it.type === "outil" && OUTILS[it.outil] ? <span style={{ color: T.petrol, display: "inline-flex" }}><Icone nom={OUTILS[it.outil].icone} taille={26} epaisseur={1.8} /></span>
            : <span style={{ width: 22, height: 30, borderRadius: 2, background: "var(--surface)", borderTop: `3px solid ${t.trait}`, boxShadow: "0 2px 6px rgba(0,0,0,.2)" }} />}
      </span>
      <span style={{ position: "absolute", left: 7, top: 14, width: 30, height: 4, borderRadius: 2, background: "rgba(251,248,242,.85)" }} />
      <span style={{ position: "absolute", left: 7, top: 22, width: 22, height: 4, borderRadius: 2, background: "rgba(251,248,242,.55)" }} />
      <span style={{ position: "absolute", left: 7, bottom: 12, width: 26, height: 7, borderRadius: 4, background: "var(--paper)" }} />
      {remise >= 1 && <span style={{ position: "absolute", right: 2, top: 2, width: 15, height: 15, borderRadius: "50%", background: "var(--or)" }} />}
      {illisible && <span style={{ position: "absolute", left: 44, right: 6, bottom: 3, padding: "1px 4px", borderRadius: 4, background: T.danger, color: "#fff", fontSize: 9, fontWeight: 700, textAlign: "center", lineHeight: 1.3 }}>illisible</span>}
    </span>
  );
}

// Miniature de la photo choisie (formulaire) : la photo, ou « Photo illisible » (jamais une icône d'image cassée) avec le
// motif et ce que la page montre à la place
function Miniature({ url, aLaPlace }) {
  useIllisibles();
  const cadre = { width: 44, height: 44, flexShrink: 0, borderRadius: 6, border: `1px solid ${T.line}`, background: "#fff" };
  if (!estIllisible(url)) return <img src={photo(url, "thumbnail")} alt="" onError={(ev) => surErreurPhoto(url, ev)} style={{ ...cadre, objectFit: "contain" }} />;
  return (<>
    <span role="img" aria-label="Photo illisible" style={{ ...cadre, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", border: `1.5px dashed ${T.danger}`,
      background: T.paper, color: T.danger, fontSize: 9, fontWeight: 700, lineHeight: 1.15 }}>Photo illisible</span>
    <span style={{ flexBasis: "100%", order: 9, fontSize: 11, color: T.danger }}><b>Photo illisible</b> : {raisonIllisible(url)}. {aLaPlace}</span>
  </>);
}

// selon : Commandes groupées, visibles seulement pour les pharmacies inscrites à une opération ouverte
function Puce({ statut, fin, debut, selon }) {
  const [t, txt] = STATUTS[statut] || STATUTS.inconnu;
  const quand = statut === "programmee" && debut ? ` · à partir du ${dateTexte(debut, { court: true })}` : statut === "terminee" && fin ? ` le ${dateTexte(fin, { court: true })}` : "";
  return <span style={{ ...ui.badge(t), whiteSpace: "normal" }}>{statut === "visible" ? "● " : ""}{txt}{statut === "visible" && selon ? " · pharmacies concernées" : ""}{quand}</span>;
}

function Ligne({ it, titre, eval: ev, publie, premier, dernier, place, menu, offre, couleur, outil, ouvert, onOuvrir, onMonter, onDescendre, onMasquer, onSupprimer, ouvrirPromos, children }) {
  const meta = it.type === "outil" ? `OUTIL · ${outil?.libelle || it.outil} · ${outil?.resume || "…"}` : it.type === "menu"
    ? `MENU PROMO · ${menu ? titreMenu(menu) : "introuvable"} · ${(menu?.products || []).length} produit${(menu?.products || []).length > 1 ? "s" : ""}`
    : `PRODUIT · ${offre?.menu?.label?.replace(/[\p{Extended_Pictographic}️‍]/gu, "").trim() || "…"} · ${offre?.pn > 0 ? `${fmtEur(offre.pn)} HT` : it.cip}${offre?.pct >= 1 ? ` · ${fmtPct(offre.pct)}` : ""}`;
  const dates = it.date_debut || it.date_fin || ev.fin ? `${it.date_debut ? `du ${dateTexte(it.date_debut, { court: true })} ` : ""}${ev.fin ? `${it.date_debut ? "au" : "jusqu'au"} ${dateTexte(ev.fin, { court: true })}` : "sans fin"}` : "";
  const tactile = useMedia("(pointer: coarse)");
  const petit = { ...ui.btn("ligne", "s"), height: tactile ? 44 : 30, padding: "0 10px", fontSize: 12 };
  return (
    <div className="ex-tr" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", flexWrap: "wrap" }}>
        <Vignette it={it} menu={menu} offre={offre} couleur={couleur} outil={outil} />
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titre}{premier && place === "grille" ? <span style={{ ...ui.badge("neutral"), marginLeft: 6 }}>En grand</span> : null}</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{meta}</div>
          {outil?.avertissement && <div style={{ fontSize: 11, color: T.warn, marginTop: 2 }}>⚠ {outil.avertissement}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", minWidth: 150 }}>
          <Puce statut={ev.statut} fin={ev.fin} debut={it.date_debut} selon={ev.selon} />
          {it.image && estIllisible(it.image) && <span style={{ ...ui.badge("danger"), whiteSpace: "normal" }}>Photo illisible</span>}
          {dates && <span style={{ fontSize: 11, color: T.inkMute }}>{dates}</span>}
          {publie && publie.statut !== ev.statut && <span style={{ fontSize: 10, color: T.inkMute }}>en ligne : {(STATUTS[publie.statut] || STATUTS.inconnu)[1].toLowerCase()}</span>}
          {/^menu_/.test(ev.statut) && ouvrirPromos && <button onClick={ouvrirPromos} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Onglet Promos</button>}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button onClick={onOuvrir} style={petit} aria-expanded={ouvert}>{ouvert ? "Fermer" : "Modifier"}</button>
          <button onClick={onMonter} disabled={premier} aria-label={`Monter « ${titre} »`} style={{ ...petit, width: tactile ? 44 : 34, padding: 0, opacity: premier ? 0.4 : 1 }}>↑</button>
          <button onClick={onDescendre} disabled={dernier} aria-label={`Descendre « ${titre} »`} style={{ ...petit, width: tactile ? 44 : 34, padding: 0, opacity: dernier ? 0.4 : 1 }}>↓</button>
          <button onClick={onMasquer} style={petit}>{it.actif ? "Masquer" : "Afficher"}</button>
          <button onClick={onSupprimer} style={{ ...petit, color: T.danger }}>Supprimer</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Compteur({ v, max }) { return <span style={{ fontSize: 11, fontWeight: 600, color: v > max ? T.danger : T.inkMute }}>{v}/{max}</span>; }

function Formulaire({ it, titreDefaut, accrocheDefaut, menu, offre, couleur, accent, erreurs, couleurMsg, onRelireCouleur, nom, photoEtat, onChercher, onFichier, onImage, onChange, onPlace }) {
  const [adresse, setAdresse] = useState(it.image || "");
  useEffect(() => { setAdresse(it.image || ""); }, [it.image]);   // photo trouvée ou envoyée, même formulaire rouvert
  const etat = photoEtat || {}, occupe = !!etat.occupe, envoi = etat.occupe === "envoi";
  const fichierRef = useRef(null);
  const err = (k) => erreurs.find(e => e.champ === k);
  // même propriété que le champ (border) : rien de mélangé quand l'erreur disparaît (avertissement de React, bordure perdue)
  const bord = (k) => (err(k) ? { border: `1px solid ${T.danger}`, boxShadow: `0 0 0 1px ${T.danger}` } : {});
  const medicament = it.type === "produit" && /^34009/.test(it.cip || "");
  const outil = it.type === "outil" ? OUTILS[it.outil] : null;
  // outil : badges sans prix (« Précommande », « Prix de lancement » n'ont pas de sens pour un outil)
  const badges = outil ? [...new Set([outil.badge, "Nouveau", "Exclusivité Elixir"])] : BADGES;
  const finMenu = menu?.endDate ? String(menu.endDate).slice(0, 10) : null;
  const choisir = () => { if (fichierRef.current) { fichierRef.current.value = ""; fichierRef.current.click(); } };
  const quoi = it.type === "menu" ? "la carte de devant" : "la photo";
  const libelleFichier = it.image ? "Remplacer la photo" : "Ajouter une photo";
  const boutonFichier = (<>
    <button type="button" onClick={choisir} disabled={occupe} aria-busy={envoi} title={AIDE} style={ui.btn("ligne", "s")}
      aria-label={envoi ? `Envoi de ${quoi} de « ${nom} » en cours` : `${it.image ? "Remplacer" : "Ajouter"} ${quoi} de « ${nom} »`}>{envoi ? "Envoi…" : libelleFichier}</button>
    <input ref={fichierRef} type="file" accept={ACCEPT} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFichier(f); }} />
  </>);
  const refus = etat.texte && etat.ton === "danger";
  const styleMessage = { fontSize: 11, color: COULEUR_MESSAGE[etat.ton] || T.inkMute };
  const message = (<>
    <span role="status" aria-live="polite" style={etat.texte && !refus ? styleMessage : CACHE}>{refus ? "" : etat.texte}</span>
    {refus && <span key={etat.n} role="alert" style={styleMessage}>{etat.texte}</span>}
  </>);
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
        <textarea value={it.accroche} rows={2} onChange={e => onChange({ accroche: e.target.value })} placeholder={accrocheDefaut || ""} style={{ ...champ, resize: "vertical", ...bord("accroche") }} />
      </label>
      <div style={ligne}><span style={etiquette}>Badge <Compteur v={it.badge.length} max={LIMITES.badge} /></span>
        <span><input value={it.badge} onChange={e => onChange({ badge: e.target.value })} aria-label="Badge" style={{ ...champ, ...bord("badge") }} />
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{badges.map(b => <button key={b} type="button" onClick={() => onChange({ badge: b })} style={{ ...ui.pill(it.badge === b), height: 26, fontSize: 12 }}>{b}</button>)}</span>
          <span style={{ ...aide, display: "block" }}>{!outil ? "La remise s'affiche d'elle-même dans le médaillon or." : it.outil === "peremption"
            ? "Aucune remise annoncée : les remises péremption ne sont pas facturées par Odoo pour l'instant (onglet Péremptions). « Petits prix » ne s'affiche pas. Vide : pas de badge." : "Vide : pas de badge."}</span></span>
      </div>
      <div style={ligne}><span style={etiquette}>Dates</span>
        <span>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Du <input type="date" value={it.date_debut || ""} onChange={e => onChange({ date_debut: e.target.value || null })} aria-label="Date de début" style={{ ...champ, width: 160, ...bord("date_debut") }} />
            au <input type="date" value={it.date_fin || ""} onChange={e => onChange({ date_fin: e.target.value || null })} aria-label="Date de fin" style={{ ...champ, width: 160, ...bord("date_fin") }} />
          </span>
          {err("date_fin") && <span style={{ ...aide, display: "block", color: T.danger }}>{err("date_fin").message}</span>}
          {outil ? <span style={{ ...aide, display: "block" }}>Vides : tout de suite, sans fin. Jours inclus (heure de Paris). La date de fin arrête l'affichage. Pas de compte à rebours pour un outil.</span>
            : <span style={{ ...aide, display: "block" }}>Vides : tout de suite, sans fin. Jours inclus (heure de Paris). La date de fin arrête l'affichage sur l'accueil.
            Le compte à rebours n'apparaît que si le prix lui-même s'arrête (fin du menu promo), dans ses 7 derniers jours.
            {finMenu ? ` Le menu se termine le ${dateTexte(finMenu)} : la mise en avant s'arrête au plus tard ce jour-là.` : ""}</span>}
        </span>
      </div>
      <div style={ligne}><span style={etiquette}>Photo</span>
        <span>
          {outil ? (<>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              {it.image && <Miniature url={it.image} aLaPlace="L'accueil montre la composition automatique de l'outil à la place." />}
              {boutonFichier}
              {it.image && <button type="button" onClick={() => onImage(null)} disabled={occupe} style={ui.btn("ligne", "s")}>Revenir à la composition automatique</button>}
              {message}
            </span>
            <input value={adresse} onChange={e => setAdresse(e.target.value)} onBlur={() => { if (adresse.trim() !== (it.image || "")) onImage(adresse.trim() || null); }} placeholder="Ou une adresse https://… (facultatif)" aria-label="Adresse https de la photo" style={{ ...champ, ...bord("image") }} />
            <span style={{ ...aide, display: "block" }}>Sans photo : {outil.sansPhoto}. Photo sur fond blanc ou transparent de préférence : elle se fond dans l'écran.</span>
          </>) : it.type === "produit" ? (<>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(it.image || offre?.image_url) ? <Miniature url={it.image || offre.image_url}
                aLaPlace={it.image ? `L'accueil montre ${offre?.image_url && !estIllisible(offre.image_url) ? "la photo du catalogue" : "la boîte générée"} à la place.` : "L'accueil montre la boîte générée à la place."} />
                : <span style={{ fontSize: 12, color: T.inkMute }}>Boîte générée (marque, dosage, forme)</span>}
              <button type="button" onClick={onChercher} disabled={occupe} aria-busy={etat.occupe === "recherche"} style={ui.btn("ligne", "s")}>{etat.occupe === "recherche" ? "Recherche…" : "Chercher dans la banque d'images"}</button>
              {boutonFichier}
              {it.image && <button type="button" onClick={() => onImage(null)} disabled={occupe} style={ui.btn("ligne", "s")}>Revenir à la photo du catalogue</button>}
              {message}
            </span>
            <input value={adresse} onChange={e => setAdresse(e.target.value)} onBlur={() => { if (adresse.trim() !== (it.image || "")) onImage(adresse.trim() || null); }} placeholder="Coller une adresse https://…" aria-label="Adresse https de la photo" style={{ ...champ, marginTop: 6, ...bord("image") }} />
          </>) : (<>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              {it.image && <Miniature url={it.image} aLaPlace="L'éventail montre les photos du menu à la place." />}
              {boutonFichier}
              {it.image && <button type="button" onClick={() => onImage(null)} disabled={occupe} style={ui.btn("ligne", "s")}>Retirer la carte de devant</button>}
              {message}
            </span>
            <input value={adresse} onChange={e => setAdresse(e.target.value)} onBlur={() => { if (adresse.trim() !== (it.image || "")) onImage(adresse.trim() || null); }} placeholder="Carte de devant : adresse https://… (facultatif)" aria-label="Adresse https de la carte de devant" style={{ ...champ, ...bord("image") }} />
            <span style={{ ...aide, display: "block" }}>L'éventail montre les photos du menu dans son ordre ; moins de 3 photos : complété par des cartes texte.</span>
          </>)}
        </span>
      </div>
      <div style={ligne}><span style={etiquette}>Couleur</span>
        <span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {pastille(auto.hex, !it.couleur, `Auto (${outil && auto.source === "rayon" ? "couleur de l'outil" : SOURCES[auto.source]})`, () => onChange({ couleur: null }))}
            {NUANCIER.map(([nom, hex]) => pastille(hex, it.couleur === hex, nom, () => onChange({ couleur: hex })))}
            {couleurMenu(menu) && pastille(couleurMenu(menu), it.couleur === couleurMenu(menu), "Couleur du menu", () => onChange({ couleur: couleurMenu(menu) }))}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <input type="color" value={it.couleur || couleur.hex} onChange={e => onChange({ couleur: e.target.value.toLowerCase() })} style={{ width: 30, height: 30, border: "none", padding: 0, background: "none" }} />Autre
            </label>
          </span>
          {couleurMsg && <span style={{ ...aide, display: "block" }}>{couleurMsg.texte ?? couleurMsg}
            {couleurMsg.relire && <button type="button" onClick={() => onRelireCouleur?.(couleurMsg.relire)} style={{ ...ui.btn("ligne", "s"), height: 24, marginLeft: 8 }}>Relire la couleur</button>}</span>}
        </span>
      </div>
      {medicament && <div style={{ ...ui.encart("warn"), fontSize: 12 }}>Médicament : restez sur le prix, la disponibilité et le conditionnement (publicité réglementée : pas d'allégation thérapeutique).</div>}
      {(it.outil === "peremption" || it.outil === "justificatif") && it.type === "outil" && <div style={{ ...ui.encart("warn"), fontSize: 12 }}>Médicaments : la carte ne montre ni nom ni photo de produit, seulement des chiffres d'ensemble (publicité réglementée).</div>}
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

// Les 6 outils du site, avec leur état du moment (outils_etat) ; ajout permis même non visible (comme un menu inactif)
// l'icône œil est dans le bloc « Ordre et visibilité des onglets », sous l'éditeur de la page d'accueil (AdminDisplay)
const MASQUE_DANS_LE_MENU = (debut) => `${debut} : réaffichez-le plus bas dans cet onglet, bloc « Ordre et visibilité des onglets » (icône œil)`;
const TEXTE_SEUL_SAISIE = { absents: "Texte seul (sans chiffres) : comptes du catalogue pas encore calculés (fonction planifiée accueil-offres-refresh)",
  illisibles: "Texte seul (sans chiffres) : comptes du catalogue illisibles en ce moment",
  anciens: "Texte seul (sans chiffres) : comptes du catalogue de plus de 36 h, la fonction planifiée ne les met plus à jour (à vérifier)" };
// fauteuils : correspondance code fournisseur → CIP pas (entièrement) calculée par la fonction planifiée : anciens CIP,
// largeurs peut-être sous-comptées
const AVERTISSEMENT_CORRESPONDANCE = "Correspondance des fauteuils pas encore calculée : largeurs peut-être sous-estimées (lancer accueil-offres-refresh)";
const MOTIFS_OUTIL = { outil_vide: "Aucun produit en ce moment : la carte resterait cachée", rupture: "Aucune largeur en stock : la carte resterait cachée",
  donnees_anciennes: "Données de plus de 36 h : la carte resterait cachée", donnees_indisponibles: "Données illisibles en ce moment : la carte resterait cachée" };
function AjoutOutil({ outilsEtat, caches, libelle, deja, onChoisir }) {
  const etat = (cle) => {
    if (cle !== "groupees" && caches.has(cle)) return { ton: "warn", texte: MASQUE_DANS_LE_MENU("Masqué dans le menu") };
    if (cle === "groupees") return { ton: "info", texte: "Seulement pour les pharmacies inscrites à une opération ouverte" };
    if (!outilsEtat) return { ton: "neutral", texte: "Lecture des chiffres du moment…" };
    const o = outilsEtat[cle];
    if (!o) return { ton: "neutral", texte: "Chiffres du moment indisponibles" };
    // masquage : l'état vivant (caches) seulement (outil réaffiché depuis le dernier GET)
    const motif = (o.raisons || []).filter(r => r !== "outil_masque")[0];
    if (motif) return { ton: "warn", texte: MOTIFS_OUTIL[motif] || STATUTS[motif]?.[1] || motif };
    const ch = o.chiffres;
    // Saisie sans chiffres : texte seul, et pourquoi (comptes jamais calculés, illisibles, ou plus mis à jour)
    if (cle === "saisie" && !ch) return { ton: o.admin?.comptes === "absents" ? "neutral" : "warn", texte: TEXTE_SEUL_SAISIE[o.admin?.comptes] || TEXTE_SEUL_SAISIE.absents };
    const texte = cle === "peremption" && ch ? [chiffresTexte(cle, ch).meta, ch.jusqua ? `jusqu'à ${fmtPct(ch.jusqua)}` : ""].filter(Boolean).join(" · ")
      : chiffresTexte(cle, ch, { court: cle === "fauteuil" || cle === "transfert" }).meta;
    const info = cle === "peremption" && o.admin?.remises_facturees === 0
      ? "Aucune remise péremption facturée par Odoo : la carte annonce les références, sans prix ni remise"
      : (cle === "fauteuil" || cle === "transfert") && o.admin?.correspondance && o.admin.correspondance !== "odoo" ? AVERTISSEMENT_CORRESPONDANCE : "";
    return { ton: info === AVERTISSEMENT_CORRESPONDANCE ? "warn" : "ok", texte, info };
  };
  return (
    <div style={{ marginTop: 8, padding: 6, background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.s }}>
      {OUTILS_MEA.map(cle => {
        const d = deja(cle), e = etat(cle);
        return (
          <div key={cle} className="ex-tr" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px", borderBottom: `1px solid ${T.lineSoft}` }}>
            <span aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "var(--petrol)", color: "var(--or-clair)" }}><Icone nom={OUTILS[cle].icone} taille={18} epaisseur={1.8} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.ink }}>{libelle(cle)}</span>
              {e.texte && <span style={{ display: "block", fontSize: 11, color: e.ton === "ok" ? T.ok : e.ton === "warn" ? T.warn : T.inkMute }}>{e.texte}</span>}
              {e.info && <span style={{ display: "block", fontSize: 11, color: T.inkMute }}>{e.info}</span>}
            </span>
            <button type="button" disabled={!!d} onClick={() => onChoisir(cle)} style={{ ...ui.btn("ligne", "s"), opacity: d ? 0.5 : 1 }}>{d ? `Déjà en ${d.emplacement === "vitrine" ? "vitrine" : "grille"}` : "Mettre en avant"}</button>
          </div>
        );
      })}
    </div>
  );
}

function AjoutMenu({ promos, caches, aujourdhui, deja, ouvrirPromos, onChoisir }) {
  const etat = (m) => (!m.active ? "Inactif" : !menuEnCours(m, aujourdhui) ? `Échu le ${dateTexte(String(m.endDate).slice(0, 10), { court: true })}` : caches.has(`promo_${m.id}`) ? "Masqué"
    : m.endDate ? `Actif · fin le ${dateTexte(String(m.endDate).slice(0, 10), { court: true })}` : "Actif");
  // pourquoi un menu ne s'affichera pas (encore) : inactif, terminé (prolonger sa date), masqué
  const pasPret = (m) => (!m.active ? "Ne s'affichera qu'une fois le menu activé."
    : !menuEnCours(m, aujourdhui) ? `Menu terminé le ${dateTexte(String(m.endDate).slice(0, 10), { court: true })} : prolongez sa date dans l'onglet Promos pour l'afficher.`
      : `${MASQUE_DANS_LE_MENU("Menu masqué")}.`);
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
              {!pret && !d && <span style={{ display: "block", fontSize: 11, color: T.warn }}>{pasPret(m)} {ouvrirPromos && <button onClick={ouvrirPromos} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Ouvrir l'onglet Promos</button>}</span>}
            </span>
            <button type="button" disabled={!!d} onClick={() => onChoisir(m)} style={{ ...ui.btn("ligne", "s"), opacity: d ? 0.5 : 1 }}>{d ? `Déjà en ${d.emplacement === "vitrine" ? "vitrine" : "grille"}` : "Mettre en avant"}</button>
          </div>
        );
      })}
    </div>
  );
}
