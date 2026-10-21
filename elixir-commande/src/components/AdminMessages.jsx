import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T, R, ui, tone } from "../theme.js";
import { Icone } from "../icons.jsx";
import {
  LIMITES, TITRE_CONSEILLE, LIBELLES_OUTILS, OUTILS_LIEN, TYPES_MESSAGE, IDS_TYPES, lienValide, longueur, verifierMessage, champsACompleter,
  contientMontant, contientReference, estTransactionnel, categorieDuType, audiencesDuType, parisVersIso, isoVersParis, partiesParis, horsHeures,
  texteHeureParis, prochainMatin, MAX_LISTE_TRANSACTIONNEL, PROGRAMME_MIN_MS, PROGRAMME_RETARD_MAX_MS,
} from "../notifications/regles.js";
import { MODELES_ELIXIR, NOM_MODELE_MAX } from "../notifications/modeles.js";

// ── Admin : messages unitaires et collectifs de l'onglet « 📲 Notifications » (docs/notifications.md § 4 à 7) ──
// Demande de Zineb (21/10/2026) : « prévoir l'envoi d'une notification unitaire ou collective : communication, promotion,
// traitement d'une réclamation, etc. »
//  • Types : Promotion → « Offres et nouveautés » ; Communication → « Informations Elixir » ; Réclamation / SAV (une seule
//    pharmacie) et Commande (une, ou quelques-unes sans référence propre) → « Mes commandes et réclamations » (aucun montant).
//  • Destinataires : une pharmacie (recherche par nom, ville ou CIP : appareils, alertes acceptées, dernière activité),
//    plusieurs, ou toutes les pharmacies abonnées (Promotion et Communication) ; estimation avant l'envoi, e-mail de secours
//    compris (même règle que le serveur).
//  • E-mail de secours (message unitaire, jamais pour une Promotion) : le serveur l'envoie aux adresses du COMPTE de la
//    pharmacie si aucun de ses téléphones n'a été joint ; la page ne voit que des adresses masquées.
//  • Modèles (Elixir et enregistrés, remplaçables), programmation (heure de Paris, annulable, « Annuler et modifier »),
//    historique global, par pharmacie et outil entrepôt ; sur téléphone (600 px et moins), historiques en cartes et messages
//    à venir en tête. API : netlify/functions/push-admin.js (verifyAdmin).
// Chargé avec l'admin (chunk AdminPanel) : hors du bundle des pharmacies.

const card = { ...ui.card, padding: "16px 20px" };
const sourdine = { fontSize: 12, color: T.inkMute, lineHeight: 1.5 };
const thS = { ...ui.th, padding: "9px 10px" };
const tdS = { ...ui.td, fontSize: 12, padding: "9px 10px" };
const dt = (s) => (s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const jourLong = (s) => (s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "");
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");
const pluriel = (n, mot, motPluriel = `${mot}s`) => `${nombre(n)} ${n > 1 ? motPluriel : mot}`;
const nouvelleCle = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
export const CATS = { stock: "Retour en stock", commandes: "Mes commandes et réclamations", infos: "Informations Elixir", offres: "Offres et nouveautés" };
const PLATEFORMES = { ios: "iPhone / iPad", android: "Android", ordinateur: "Ordinateur", autre: "Autre" };
const STATUTS = { programmee: ["Programmé", "info"], en_file: ["En file", "warn"], en_cours: ["En cours", "info"], envoyee: ["Envoyé", "ok"], erreur: ["Erreur", "danger"],
  annulee: ["Annulé", "neutral"] };
const TONS_TYPE = { promotion: "promo", communication: "info", reclamation: "labo", commande: "labo" };
const AIDES_TYPE = {
  promotion: "Arrive dans « Offres et nouveautés » (plafonné par pharmacie sur 7 jours) : offres, nouveaux produits, nouveaux menus. Pas d'e-mail de secours.",
  communication: "Arrive dans « Informations Elixir » : fermetures, horaires, changements de service et du site (plafonné à part). Jamais d'offre ni de nouveau produit.",
  reclamation: "Arrive dans « Mes commandes et réclamations » : suivi d'une réclamation, d'un retour, d'un avoir. Une seule pharmacie à la fois ; aucun montant.",
  commande: "Arrive dans « Mes commandes et réclamations » : expédition, reliquat. Une pharmacie, ou quelques-unes pour un message sans numéro propre à l'une d'elles ; aucun montant.",
};
// e-mail de secours : résultat noté par le serveur (« plafond », « alerte_coupee », « non_requis » : rien n'est parti)
const EMAILS = { envoye: ["e-mail envoyé", "ok"], echec: ["e-mail en échec", "danger"], aucune_adresse: ["pas d'e-mail : aucune adresse de compte", "warn"],
  non_requis: ["e-mail inutile : notification reçue", "neutral"], plafond: ["pas d'e-mail : plafond atteint", "warn"],
  alerte_coupee: ["pas d'e-mail : alerte coupée par la pharmacie", "warn"] };
const SOURCES = { message: "Message de l'admin", stock: "Retour en stock", entrepot: "Outil entrepôt", commandes: "Automatique", offres: "Automatique", infos: "Automatique" };
const RESULTATS = { envoye: "envoyée", aucun_appareil: "aucun appareil joint", fermee: "ouverture fermée", hors_pilote: "hors pilote", plafond: "plafond de sécurité",
  configuration: "service incomplet", schema: "tables absentes", erreur: "erreur", deja_envoye: "déjà envoyée", categorie: "catégorie inconnue", differe: "différée au matin (8 h)",
  envoi: "envoi en cours", echec: "appareils en échec" };
const TYPES_EVT = { reclamation: "Réclamation", ticket: "Demande", commande: "Commande" };
const STATUTS_EVT = { recue: "reçue", recu: "reçue", en_cours: "en cours", acceptee: "acceptée", refusee: "réponse donnée", traitee: "traitée", resolu: "traitée",
  avoir_emis: "avoir émis", cloturee: "clôturée", clos: "clôturée", expediee: "expédiée", reliquat: "reliquat", annulee: "annulée" };

// téléphone (600 px et moins) : historiques en cartes, aperçus repliés
function useEtroit() {
  const requete = "(max-width: 600px)";
  const lire = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(requete).matches;
  const [v, setV] = useState(lire);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const m = window.matchMedia(requete);
    const f = () => setV(m.matches);
    f();
    if (m.addEventListener) { m.addEventListener("change", f); return () => m.removeEventListener("change", f); }
    m.addListener(f); return () => m.removeListener(f);
  }, []);
  return v;
}

const Erreur = ({ texte }) => (texte ? <div role="alert" style={{ ...ui.encart("danger"), display: "flex", gap: 6, alignItems: "flex-start" }}><Icone nom="alerte" taille={14} style={{ marginTop: 2, flexShrink: 0 }} /><span>{texte}</span></div> : null);
// options sur plusieurs lignes au besoin (téléphone) ; option désactivée : expliquée par son infobulle
const Segment = ({ options, valeur, onChange, etiquette }) => (
  <div className="ex-segment" role="group" aria-label={etiquette} style={{ maxWidth: "100%", flexWrap: "wrap", rowGap: 4, borderRadius: 16, alignSelf: "flex-start" }}>
    {options.map(([k, l, desactive, titre]) => <button key={k} type="button" aria-pressed={valeur === k} onClick={() => !desactive && onChange(k)} disabled={!!desactive} title={titre}
      style={{ flexShrink: 1, minWidth: 0, whiteSpace: "normal", textAlign: "center", height: "auto", minHeight: 26, padding: "4px 12px", lineHeight: 1.3, ...(desactive ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}>{l}</button>)}
  </div>
);
const grille = (min) => `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`;
const Bouton = ({ principal = false, children, style, ...reste }) => (
  <button type="button" className={principal ? "ex-btn-petrole" : "ex-btn-ligne"} style={{ ...ui.btn(principal ? "primaire" : "ligne", "m"), ...(principal ? {} : { background: undefined }), ...style }} {...reste}>{children}</button>
);
const inactif = { background: T.sand, color: T.inkSoft, cursor: "not-allowed" };
// libellé long (nom de la pharmacie) : passe à la ligne, jamais plus large que la carte
const largeLibre = { whiteSpace: "normal", height: "auto", minHeight: 38, maxWidth: "100%", textAlign: "center", lineHeight: 1.3 };
const Section = ({ id, titre, droite, children }) => (
  <section style={card} aria-labelledby={id}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <h3 id={id} style={{ ...ui.h2, margin: 0 }}>{titre}</h3>{droite}
    </div>
    {children}
  </section>
);
const Puce = ({ children, onRetirer, libelle }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.mint, color: T.teal, borderRadius: R.pill, padding: "3px 4px 3px 12px", fontSize: 12, fontWeight: 600, maxWidth: "100%" }}>
    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    <button type="button" onClick={onRetirer} aria-label={libelle} title={libelle} className="ex-btn-discret" style={{ ...ui.rond(22), background: "transparent" }}><Icone nom="fermer" taille={12} /></button>
  </span>
);
const Compteur = ({ n, max, conseil }) => (
  <div className="num" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, marginTop: 3, color: n > max ? T.danger : T.inkMute }}>
    <span style={{ color: tone("warn").fg }}>{conseil || ""}</span><span>{n}/{max}</span>
  </div>
);
const BadgeType = ({ type }) => <span style={ui.badge(TONS_TYPE[type] || "neutral")}>{TYPES_MESSAGE[type]?.libelle || "Promotion"}</span>;
// carte d'une ligne d'historique (téléphone) : jamais de défilement horizontal
const Carte = ({ children }) => <div style={{ border: `1px solid ${T.line}`, borderRadius: R.s, padding: "10px 12px", background: T.paper, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, minWidth: 0, overflowWrap: "anywhere" }}>{children}</div>;
const Cartes = ({ children }) => <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>;

// ── Liens ──
const TYPES_LIEN = [["accueil", "Accueil"], ["commandes", "Mes commandes"], ["promo", "Menu promo"], ["menu", "Menu du catalogue"], ["outil", "Outil"], ["produit", "Produit (CIP)"]];
const TYPES_LIEN_IDS = TYPES_LIEN.map(([k]) => k);
function cheminDe(type, valeur) {
  if (type === "accueil") return "/";
  if (type === "commandes") return "/?commandes=1";
  if (type === "promo" || type === "menu") return valeur ? `/?menu=${valeur}` : "";
  if (type === "outil") return valeur ? `/?outil=${valeur}` : "";
  if (type === "produit") return valeur ? `/?cip=${String(valeur).replace(/\D/g, "")}` : "";
  return "";
}
// chemin → [type de lien, valeur] (modèles, brouillon)
function lienVersChamps(url) {
  const u = lienValide(url) || "/";
  if (u === "/") return ["accueil", ""];
  if (u === "/?commandes=1") return ["commandes", ""];
  const m = /^\/\?(menu|outil|cip)=(.+)$/.exec(u);
  if (!m) return ["accueil", ""];
  if (m[1] === "menu") return [m[2].startsWith("promo_") ? "promo" : "menu", m[2]];
  return [m[1] === "cip" ? "produit" : "outil", m[2]];
}
// lien d'un message en clair : « Menu promo : Vaseline », « Mes commandes »… (chemin brut en infobulle)
export function libelleLien(url, promos = [], sections = []) {
  if (url === "/") return "Accueil";
  if (url === "/?commandes=1") return "Mes commandes";
  const m = /^\/\?(menu|outil|cip|notifications)=(.+)$/.exec(String(url || ""));
  if (!m) return String(url || "");
  if (m[1] === "menu") {
    const p = promos.find((x) => `promo_${x.id}` === m[2]);
    if (p) return `Menu promo : ${p.name}`;
    const s = sections.find((x) => x.key === m[2]);
    return s ? `Menu : ${s.label}` : `Menu ${m[2]}`;
  }
  if (m[1] === "outil") return `Outil : ${LIBELLES_OUTILS[m[2]] || m[2]}`;
  if (m[1] === "cip") return `Produit (CIP ${m[2]})`;
  return "Panneau « Notifications »";
}

// heure de Paris : avant 8 h, après 20 h ou le dimanche, l'envoi (ou l'heure programmée) demande une confirmation de plus
const motifHorsHeures = (t) => { const p = partiesParis(t); return p.jourSemaine === "dimanche" ? "un dimanche" : p.heure < 8 ? "avant 8 h" : "après 20 h"; };
// date proposée : prochain jour hors dimanche, 8 h 30 (heure de Paris)
const dateProposee = () => isoVersParis(prochainMatin(Date.now(), { heure: 8, minute: 30, demain: true }));

// Brouillon gardé pour l'onglet (sessionStorage) : toucher l'aperçu sur le même appareil, ou recharger, ne perd rien ;
// aussi écrit par « Écrire à cette pharmacie » (fiche de l'onglet 🏥 Pharmacies) avant d'ouvrir l'onglet 📲 Notifications
const CLE_BROUILLON = "notif_brouillon_annonce";
function lireBrouillon() {
  try { const b = JSON.parse(sessionStorage.getItem(CLE_BROUILLON) || "null"); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}
function garderBrouillon(brouillon) {
  try {
    if (brouillon) sessionStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
    else sessionStorage.removeItem(CLE_BROUILLON);
  } catch { /* stockage refusé : pas de brouillon */ }
}
// message de l'historique → brouillon du composeur (« Annuler et modifier »)
function brouillonDe(a) {
  const [typeLien, valeurLien] = lienVersChamps(a.url);
  return { type: a.type || "promotion", titre: a.titre || "", corps: a.corps || "", typeLien, valeurLien, audience: a.audience || "toutes",
    choix: (Array.isArray(a.cips) ? a.cips : []).map((cip) => ({ cip, nom: a.audience === "une" ? a.destinataire_nom || null : null, ville: null })),
    repli: a.repli_email === true, quand: a.programme_pour ? "programmer" : "maintenant", date: a.programme_pour ? isoVersParis(a.programme_pour) : "" };
}

// ── Messages : composeur et historique ──
export default function Messages({ etat, appeler, flash, promos = [], sections = [], masques = [], onEnvoye }) {
  const [historique, setHistorique] = useState(null);
  const [modeles, setModeles] = useState([]);
  // « Annuler et modifier » : le composeur repart du message annulé (nouvelle clé : remonté avec ce brouillon)
  const [reprise, setReprise] = useState(null);
  const chargerHistorique = useCallback(async () => {
    const r = await appeler("historique").catch(() => null);
    setHistorique(r?.ok ? r.corps.annonces || [] : []);
  }, [appeler]);
  const chargerModeles = useCallback(async () => {
    const r = await appeler("modeles").catch(() => null);
    setModeles(r?.ok ? r.corps.modeles || [] : []);
  }, [appeler]);
  useEffect(() => { chargerHistorique(); chargerModeles(); }, [chargerHistorique, chargerModeles]);
  // stable : le suivi d'un envoi (Composeur) en dépend
  const apres = useCallback(async () => { await Promise.all([chargerHistorique(), onEnvoye?.()]); }, [chargerHistorique, onEnvoye]);
  const modifier = useCallback((a) => {
    setReprise({ cle: Date.now(), brouillon: brouillonDe(a) });
    setTimeout(() => { try { document.getElementById("notif-message")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* sans défilement */ } }, 50);
  }, []);
  return (
    <>
      <Composeur key={reprise?.cle || 0} initial={reprise?.brouillon || null} etat={etat} appeler={appeler} flash={flash} promos={promos} sections={sections} masques={masques}
        modeles={modeles} onModeles={chargerModeles} onEnvoye={apres} />
      <Historiques annonces={historique} etat={etat} appeler={appeler} flash={flash} onChange={chargerHistorique} onModifier={modifier} promos={promos} sections={sections} />
    </>
  );
}

// ── Composeur ──
function Composeur({ initial, etat, appeler, flash, promos, sections, masques, modeles, onModeles, onEnvoye }) {
  const etroit = useEtroit();
  const [b0] = useState(() => initial || lireBrouillon());
  const texteDe = (v) => (typeof v === "string" ? v : "");
  const [type, setType] = useState(IDS_TYPES.includes(b0.type) ? b0.type : "promotion");
  const [titre, setTitre] = useState(texteDe(b0.titre));
  const [corps, setCorps] = useState(texteDe(b0.corps));
  const [typeLien, setTypeLien] = useState(TYPES_LIEN_IDS.includes(b0.typeLien) ? b0.typeLien : "accueil");
  const [valeurLien, setValeurLien] = useState(texteDe(b0.valeurLien));
  const [audience, setAudience] = useState(["une", "liste", "toutes"].includes(b0.audience) ? b0.audience : "toutes");
  // pharmacies choisies : { cip, nom, ville, … } (détails de joignabilité quand ils sont connus)
  const [choix, setChoix] = useState(Array.isArray(b0.choix) ? b0.choix.filter((p) => p && typeof p.cip === "string").slice(0, 500) : []);
  const [repli, setRepli] = useState(b0.repli === true);
  const [quand, setQuand] = useState(b0.quand === "programmer" ? "programmer" : "maintenant");
  const [date, setDate] = useState(typeof b0.date === "string" && b0.date ? b0.date : dateProposee);
  const [modele, setModele] = useState("");
  // titre et texte du dernier modèle appliqué : un texte écrit ou modifié à la main n'est jamais écrasé sans confirmation
  const origine = useRef({ titre: "", corps: "" });
  useEffect(() => {
    const brouillon = { type, titre, corps, typeLien, valeurLien, audience, choix: choix.map(({ cip, nom, ville }) => ({ cip, nom, ville })), repli, quand, date };
    garderBrouillon(titre || corps || choix.length ? brouillon : null);
  }, [type, titre, corps, typeLien, valeurLien, audience, choix, repli, quand, date]);
  const transactionnel = estTransactionnel(type);
  const categorie = categorieDuType(type);
  const permises = audiencesDuType(type);
  // passage à « une » : le choix précédent est vidé (jamais une pharmacie héritée d'une liste ou d'un ancien brouillon)
  const changerAudience = (a) => {
    if (a === "une" && audience !== "une") setChoix([]);
    setAudience(a);
  };
  // Réclamation / SAV : une seule pharmacie ; Commande : une ou quelques-unes ; jamais « toutes »
  useEffect(() => {
    if (!audiencesDuType(type).includes(audience)) { setChoix([]); setAudience("une"); }
  }, [type, audience]);
  useEffect(() => { if (audience === "une" && choix.length > 1) setChoix([]); }, [audience, choix.length]);
  const cips = audience === "toutes" ? [] : choix.map((p) => p.cip);
  // brouillon repris (« Écrire à cette pharmacie », « Annuler et modifier », rechargement) : détails de joignabilité
  useEffect(() => {
    const sans = choix.filter((p) => p.appareils == null).map((p) => p.cip).slice(0, 20);
    if (!sans.length) return;
    appeler("chercher", { cips: sans }).then((r) => {
      const m = new Map((r?.ok ? r.corps.pharmacies || [] : []).map((p) => [p.cip, p]));
      if (m.size) setChoix((l) => l.map((x) => (m.has(x.cip) ? { ...x, ...m.get(x.cip), nom: x.nom || m.get(x.cip).nom } : x)));
    }, () => {});
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const [estimation, setEstimation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [suivi, setSuivi] = useState(null);   // message unitaire parti : suivi de son envoi
  const chemin = cheminDe(typeLien, valeurLien);
  const lien = lienValide(chemin);
  const programmeIso = quand === "programmer" ? parisVersIso(date) : null;
  const repliPossible = audience === "une" && type !== "promotion";
  const msg = { type, titre: titre.trim(), corps: corps.trim(), url: lien || "", audience, cips: audience === "toutes" ? null : cips,
    repli_email: repliPossible && repli, programme_pour: programmeIso };
  // une clé par CONTENU : un double clic ou une réponse perdue n'envoie jamais deux fois ; un message corrigé prend une
  // nouvelle clé (jamais l'ancien envoyé à sa place)
  const idem = useRef(nouvelleCle());
  const signature = JSON.stringify([msg.type, msg.titre, msg.corps, msg.url, msg.audience, msg.cips, msg.repli_email, msg.programme_pour]);
  useEffect(() => { idem.current = nouvelleCle(); }, [signature]);
  const v = verifierMessage(msg);
  const aCompleter = champsACompleter(`${titre} ${corps}`);
  const montant = transactionnel && contientMontant(`${titre} ${corps}`);
  const referenceListe = type === "commande" && audience === "liste" && contientReference(`${titre} ${corps}`);
  // au moins 5 minutes à l'avance (le serveur admet 30 s de moins : le temps des confirmations)
  const dateValide = quand !== "programmer" || (!!programmeIso && Date.parse(programmeIso) >= Date.now() + PROGRAMME_MIN_MS);
  const valide = v.ok && dateValide;
  // seulement ce qu'une pharmacie peut ouvrir (menus masqués dans « Affichage » : le lien retomberait sur l'accueil)
  const promosActifs = promos.filter((p) => p.active && !masques.includes(`promo_${p.id}`));
  const menus = sections.filter((s) => !String(s.key).startsWith("promo_") && !masques.includes(s.key));
  const nbMasques = sections.filter((s) => masques.includes(s.key)).length;
  const nT = longueur(titre.trim()), nC = longueur(corps.trim());

  // estimation en direct des destinataires (lecture seule), 400 ms après le dernier changement
  const cleCips = cips.join(",");
  useEffect(() => {
    if (!etat.disponible) return undefined;
    if (audience !== "toutes" && !cleCips) { setEstimation({ vide: true }); return undefined; }
    let annule = false;
    setEstimation(null);
    const t = setTimeout(async () => {
      const r = await appeler("estimer", { type, audience, cips: cleCips ? cleCips.split(",") : [] }).catch(() => null);
      if (!annule) setEstimation(r?.ok ? r.corps : { erreur: true });
    }, 400);
    return () => { annule = true; clearTimeout(t); };
  }, [type, audience, cleCips, appeler, etat.disponible]);

  const appliquerModele = (id) => {
    const m = MODELES_ELIXIR.find((x) => x.id === id) || modeles.find((x) => x.id === id);
    if (!m) { setModele(id); return; }
    // titre ou texte modifiés à la main : jamais écrasés sans le demander
    const modifie = (titre.trim() || corps.trim()) && (titre !== origine.current.titre || corps !== origine.current.corps);
    if (modifie && !window.confirm(`Remplacer le titre et le texte en cours par le modèle « ${m.nom} » ?`)) return;
    setModele(id);
    setType(m.type); setTitre(m.titre); setCorps(m.corps);
    origine.current = { titre: m.titre, corps: m.corps };
    // « Nouveau menu », « Offre du moment » : menu promo à choisir (envoi bloqué tant qu'il ne l'est pas)
    if (m.typeLien) { setTypeLien(m.typeLien); setValeurLien(""); }
    else { const [tl, vl] = lienVersChamps(m.url); setTypeLien(tl); setValeurLien(vl); }
    if (!audiencesDuType(m.type).includes(audience)) changerAudience("une");
    if (m.type === "promotion") setRepli(false);
  };
  const persoChoisi = modeles.find((x) => x.id === modele);

  const apercu = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await appeler("apercu", { message: msg });
      setMessage(!r.ok ? { ton: "danger", texte: (r.corps.erreurs || [r.corps.message || r.corps.error || `HTTP ${r.statut}`]).join(" ") }
        : r.corps.aucun ? { ton: "warn", texte: "Aucun de vos appareils n'est activé : voir « Vos appareils (tests et aperçus) » plus bas." }
        : { ton: "ok", texte: `Aperçu envoyé à ${pluriel(r.corps.envoyes, "appareil")}${r.corps.echecs ? ` (${r.corps.echecs} en échec)` : ""}.` });
    } finally { setBusy(false); }
  };
  const recevront = estimation?.recevront ?? 0;
  const emailPossible = repliPossible && repli && !!estimation?.email?.permis;
  const fermee = !!estimation?.fermee;
  const peutPartir = quand === "programmer" || recevront > 0 || emailPossible;
  const bloque = busy || !valide || !etat.disponible || !peutPartir || (quand === "maintenant" && fermee && !emailPossible) || (audience !== "toutes" && !cips.length);

  // suivi d'un message unitaire ou d'une petite liste : statut relu toutes les 2 s (20 s au plus)
  useEffect(() => {
    if (!suivi?.id || suivi.fini) return undefined;
    let n = 0, annule = false;
    const t = setInterval(async () => {
      n++;
      const r = await appeler("message", { id: suivi.id }).catch(() => null);
      const a = r?.ok ? r.corps.annonce : null;
      if (annule) return;
      if (a && ["envoyee", "erreur"].includes(a.statut)) { setSuivi({ id: a.id, fini: true, annonce: a }); clearInterval(t); onEnvoye(); }
      else if (n >= 10) { setSuivi((s) => ({ ...s, fini: true, lent: true })); clearInterval(t); }
    }, 2000);
    return () => { annule = true; clearInterval(t); };
  }, [suivi?.id, suivi?.fini, appeler, onEnvoye]);

  const nomUne = audience === "une" && choix[0] ? choix[0].nom || `CIP ${choix[0].cip}` : null;
  const envoyer = async () => {
    // plusieurs pharmacies : leurs noms dans la confirmation (12 au plus, puis « et N autres »)
    const noms = choix.map((p) => p.nom || `CIP ${p.cip}`);
    const liste = noms.length > 12 ? `${noms.slice(0, 12).join(", ")} et ${pluriel(noms.length - 12, "autre")}` : noms.join(", ");
    const cible = audience === "une" ? `« ${nomUne} »` : audience === "liste" ? `${pluriel(choix.length, "pharmacie choisie", "pharmacies choisies")} (${liste})` : pluriel(recevront, "pharmacie");
    if (quand === "programmer") {
      const t = Date.parse(programmeIso);
      if (!window.confirm(`Programmer « ${msg.titre} » (${TYPES_MESSAGE[type].libelle}) pour ${cible}, le ${jourLong(programmeIso)} (heure de Paris) ?\n\nDestinataires calculés à l'heure d'envoi. Vous pourrez l'annuler jusque-là dans l'historique.`)) return;
      if (horsHeures(t) && !window.confirm(`Le ${jourLong(programmeIso)} tombe ${motifHorsHeures(t)} (heure de Paris) : les pharmacies le recevront à ce moment-là, sur leur téléphone. Programmer quand même ?`)) return;
    } else {
      const h = Date.now();
      const secours = msg.repli_email ? "\n\nSi aucun téléphone de la pharmacie ne reçoit la notification, l'e-mail de secours part aux adresses de son compte." : "";
      if (!window.confirm(`Envoyer « ${msg.titre} » (${TYPES_MESSAGE[type].libelle}) à ${cible} maintenant ?${secours}\n\nCe n'est pas annulable.`)) return;
      if (horsHeures(h) && !window.confirm(`Il est ${texteHeureParis(h)} (heure de Paris)${partiesParis(h).jourSemaine === "dimanche" ? ", un dimanche" : ""} : la pharmacie le recevra tout de suite, sur son téléphone. Envoyer quand même ?`)) return;
    }
    setBusy(true); setMessage(null); setSuivi(null);
    try {
      const r = await appeler("envoyer", { message: msg, idem: idem.current });
      if (r.statut === 202 || (r.ok && (r.corps.deja || r.corps.programmee))) {
        idem.current = nouvelleCle();
        const a = r.corps.annonce;
        flash(r.corps.programmee ? `✓ Message programmé pour le ${dt(a?.programme_pour)}` : "✓ Message parti : suivez son envoi dans l'historique");
        setTitre(""); setCorps(""); setModele(""); origine.current = { titre: "", corps: "" };
        // réclamation, commande : la pharmacie suivante se choisit, jamais héritée du message précédent
        if (transactionnel) { setChoix([]); setRepli(false); }
        setMessage({ ton: "ok", texte: r.corps.deja ? "Ce message était déjà enregistré (double clic ou réponse perdue) : il part tel quel, rien n'est envoyé deux fois."
          : r.corps.programmee ? `Programmé pour le ${jourLong(a?.programme_pour)} (heure de Paris). Annulable dans l'historique jusqu'à l'envoi.`
          : "Message parti : l'envoi prend quelques secondes (historique ci-dessous)." });
        if (!r.corps.programmee && !r.corps.deja && a?.id && audience !== "toutes") setSuivi({ id: a.id, fini: false });
        await onEnvoye();
        return;
      }
      if (r.corps.error === "idem_reutilise") idem.current = nouvelleCle();
      setMessage({ ton: "danger", texte: r.corps.error === "en_cours" ? "Un message plafonné (offre ou information) est en cours d'envoi : attendez qu'il soit terminé, ou programmez celui-ci."
        : r.corps.error === "fermee" ? "Ouverture « fermée » : aucune pharmacie ne reçoit encore les notifications (voir « Ouverture aux pharmacies »). Un message unitaire avec e-mail de secours peut partir."
        : r.corps.error === "lancement" ? "Le message est enregistré mais l'envoi n'a pas démarré : il est relancé automatiquement dans les 5 minutes (aux heures ouvertes), ou « Relancer » dans l'historique. Pour le corriger, annulez-le d'abord dans l'historique."
        : r.corps.error === "idem_reutilise" ? "Ce message a changé depuis un premier essai enregistré : rien n'a été envoyé. Vérifiez l'historique, puis renvoyez-le."
        : r.corps.error === "trop_de_programmes" ? "50 messages programmés au plus : annulez-en un dans l'historique."
        : r.corps.error === "configuration" ? "Service incomplet : terminez la mise en service." : (r.corps.erreurs || [r.corps.message || `Erreur (HTTP ${r.statut})`]).join(" ") });
      if (r.corps.error === "lancement") await onEnvoye();
    } finally { setBusy(false); }
  };

  // modèles enregistrés
  const [nomModele, setNomModele] = useState(null);   // null : fermé ; texte : saisie du nom
  const enregistrerModele = async (remplacer = false) => {
    const r = await appeler("modele_enregistrer", { modele: { nom: nomModele, type, titre: titre.trim(), corps: corps.trim(), url: lien || "/" }, ...(remplacer ? { remplacer: true } : {}) });
    if (r.ok) { flash(r.corps.remplace ? "✓ Modèle remplacé" : "✓ Modèle enregistré"); setNomModele(null); await onModeles(); setModele(r.corps.modele?.id || ""); origine.current = { titre, corps }; return; }
    if (r.corps.error === "doublon" && !remplacer) {
      if (window.confirm(`Un modèle « ${nomModele.trim()} » existe déjà. Le remplacer par ce message ?`)) await enregistrerModele(true);
      return;
    }
    flash(r.corps.error === "trop" ? "⚠ 100 modèles au plus : supprimez-en un" : `⚠ ${(r.corps.erreurs || [r.corps.message || r.corps.error || `HTTP ${r.statut}`]).join(" ")}`);
  };
  const supprimerModele = async () => {
    if (!persoChoisi || !window.confirm(`Supprimer le modèle « ${persoChoisi.nom} » ? Les messages déjà envoyés ne changent pas.`)) return;
    const r = await appeler("modele_supprimer", { id: persoChoisi.id });
    flash(r.ok ? "✓ Modèle supprimé" : "⚠ Suppression impossible");
    setModele(""); await onModeles();
  };

  const champ = { ...ui.input, fontSize: 13 };
  const optionsAudience = [["une", "Une pharmacie"],
    ["liste", "Plusieurs pharmacies", !permises.includes("liste"), !permises.includes("liste") ? "Réclamation / SAV : une seule pharmacie à la fois" : undefined],
    ["toutes", "Toutes les pharmacies abonnées", transactionnel, transactionnel ? "Réclamation / SAV et Commande : une ou quelques pharmacies seulement" : undefined]];
  const libelleBouton = busy ? "Envoi…" : quand === "programmer" ? "Programmer"
    : audience === "une" ? (nomUne && (recevront || emailPossible) ? `Envoyer à ${nomUne}${!recevront ? " (e-mail de secours)" : ""}` : "Envoyer")
    : `Envoyer à ${pluriel(recevront, "pharmacie")}`;
  const apercus = (
    <div style={{ display: "grid", gridTemplateColumns: grille(250), gap: 12 }}>
      <ApercuAndroid titre={msg.titre} corps={msg.corps} />
      <ApercuIphone titre={msg.titre} corps={msg.corps} />
    </div>
  );
  return (
    <Section id="notif-message" titre="Nouveau message">
      {!etat.disponible && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>Service incomplet&nbsp;: le message ne peut pas partir.</div>}
      {etat.service?.tables && etat.service?.tables_messages === false && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>Exécutez sql/push-messages.sql dans Supabase (types, modèles, programmation, historique)&nbsp;: sans lui, les messages ne peuvent pas être enregistrés.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={ui.label}>Type de message</div>
          <Segment etiquette="Type de message" valeur={type} onChange={(t) => { setType(t); setModele(""); if (t === "promotion") setRepli(false); }} options={IDS_TYPES.map((k) => [k, TYPES_MESSAGE[k].libelle])} />
          <div style={{ ...sourdine, marginTop: 6 }}>{AIDES_TYPE[type]}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <label htmlFor="notif-modele" style={ui.label}>Partir d'un modèle</label>
            <select id="notif-modele" value={modele} onChange={(e) => appliquerModele(e.target.value)} style={champ}>
              <option value="">Message libre…</option>
              <optgroup label="Modèles Elixir">
                {MODELES_ELIXIR.map((m) => <option key={m.id} value={m.id}>{m.nom} ({TYPES_MESSAGE[m.type].libelle})</option>)}
              </optgroup>
              {modeles.length > 0 && <optgroup label="Vos modèles">
                {modeles.map((m) => <option key={m.id} value={m.id}>{m.nom} ({TYPES_MESSAGE[m.type]?.libelle || m.type})</option>)}
              </optgroup>}
            </select>
          </div>
          {persoChoisi && <button type="button" className="ex-lien-danger" onClick={supprimerModele} style={{ ...ui.btn("lien"), fontSize: 12.5, fontWeight: 600 }}>Supprimer ce modèle</button>}
        </div>
        <div style={sourdine}>Les champs entre crochets («&nbsp;[référence]&nbsp;», «&nbsp;[date]&nbsp;») sont à remplacer avant l'envoi. Un modèle enregistré est partagé entre les admins.</div>

        <div style={{ display: "grid", gridTemplateColumns: grille(320), gap: 18, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div>
              <label htmlFor="notif-titre-annonce" style={ui.label}>Titre</label>
              <input id="notif-titre-annonce" value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={LIMITES.titre + 10}
                placeholder={transactionnel ? "Réclamation traitée" : "Vaseline : précommande ouverte"} style={champ} />
              <Compteur n={nT} max={LIMITES.titre} conseil={nT > TITRE_CONSEILLE ? "peut être coupé sur Android" : null} />
            </div>
            <div>
              <label htmlFor="notif-texte-annonce" style={ui.label}>Texte</label>
              <textarea id="notif-texte-annonce" value={corps} onChange={(e) => setCorps(e.target.value)} rows={3}
                placeholder={transactionnel ? "Votre réclamation EN-601-2026-12 est traitée." : "13 références à prix net jusqu'au 31/10."} style={{ ...champ, resize: "vertical", lineHeight: 1.45 }} />
              <Compteur n={nC} max={LIMITES.corps} />
              {aCompleter.length > 0 && <div style={{ ...sourdine, color: tone("warn").fg, fontWeight: 600 }}>À remplacer&nbsp;: {aCompleter.join(", ")}</div>}
              {montant && <div style={{ ...sourdine, color: T.danger, fontWeight: 600 }}>Retirez le montant&nbsp;: il s'afficherait sur l'écran verrouillé.</div>}
              <div style={sourdine}>Jamais de donnée de patient{transactionnel ? ", de montant (avoir, facture) ni de solde" : ", de montant de facture ni de solde"}&nbsp;: la notification s'affiche sur l'écran verrouillé.</div>
            </div>
            <div>
              <div style={ui.label}>Lien (ouvert au toucher)</div>
              <Segment etiquette="Type de lien" valeur={typeLien} onChange={(t) => { setTypeLien(t); setValeurLien(""); }} options={TYPES_LIEN} />
              <div style={{ marginTop: 8 }}>
                {typeLien === "promo" && (promosActifs.length ? (
                  <select value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} aria-label="Menu promo" style={champ}>
                    <option value="">Choisir un menu promo…</option>
                    {promosActifs.map((p) => <option key={p.id} value={`promo_${p.id}`}>{p.icon ? `${p.icon} ` : ""}{p.name}</option>)}
                  </select>) : <div style={sourdine}>Aucun menu promo actif.</div>)}
                {typeLien === "menu" && (
                  <select value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} aria-label="Menu du catalogue" style={champ}>
                    <option value="">Choisir un menu…</option>
                    {menus.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>)}
                {(typeLien === "menu" || typeLien === "promo") && nbMasques > 0 && <div style={{ ...sourdine, marginTop: 4 }}>{pluriel(nbMasques, "menu masqué", "menus masqués")} aux pharmacies (Affichage)&nbsp;: non proposé{nbMasques > 1 ? "s" : ""}.</div>}
                {typeLien === "outil" && (
                  <select value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} aria-label="Outil" style={champ}>
                    <option value="">Choisir un outil…</option>
                    {OUTILS_LIEN.map((o) => <option key={o} value={o}>{LIBELLES_OUTILS[o]}</option>)}
                  </select>)}
                {typeLien === "produit" && (
                  <input value={valeurLien} onChange={(e) => setValeurLien(e.target.value)} inputMode="numeric" placeholder="CIP13 (ou CIP7)" aria-label="CIP du produit" style={champ} />)}
                <div className="num" style={{ ...sourdine, marginTop: 4 }}>
                  {lien ? <>Page&nbsp;: <b style={{ color: T.ink }}>{libelleLien(lien, promos, sections)}</b>{lien === "/?commandes=1" ? " (la pharmacie connectée voit ses commandes)" : ""}</>
                    : chemin ? <span style={{ color: T.danger }}>Lien refusé (CIP de 7 à 14 chiffres, menu ou outil du site)</span>
                    : <span style={{ color: tone("warn").fg, fontWeight: 600 }}>Choisissez la page à ouvrir.</span>}
                </div>
              </div>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            {etroit ? (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: T.ink, minHeight: 28 }}>Voir l'aperçu (Android et iPhone)</summary>
                <div style={{ marginTop: 8 }}>{apercus}</div>
              </details>
            ) : <><div style={ui.label}>Aperçu</div>{apercus}</>}
            <p style={{ ...sourdine, margin: "8px 0 0" }}>Coupures simulées&nbsp;: titre sur une ligne et texte sur deux lignes sous Android (notification repliée), texte sur quatre lignes sur iPhone.</p>
          </div>
        </div>

        <div>
          <div style={ui.label}>Destinataires</div>
          <Segment etiquette="Destinataires" valeur={audience} onChange={changerAudience} options={optionsAudience} />
          {audience !== "toutes" && <ChoixDestinataires appeler={appeler} etat={etat} audience={audience} categorie={categorie} choix={choix} setChoix={setChoix}
            max={audience === "une" ? 1 : transactionnel ? MAX_LISTE_TRANSACTIONNEL : 500} />}
          {type === "commande" && audience === "liste" && (
            <div role={referenceListe ? "alert" : "note"} style={{ ...ui.encart(referenceListe ? "danger" : "info"), marginTop: 10 }}>
              Le même texte part à chaque pharmacie&nbsp;: aucune référence propre à une pharmacie (n° de commande, de bon…). {referenceListe ? "Ce texte en contient une : retirez-la, ou choisissez « Une pharmacie »." : ""}
            </div>
          )}
          {repliPossible && (
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, fontSize: 13, lineHeight: 1.45, cursor: "pointer", color: T.ink }}>
              <input type="checkbox" checked={repli} onChange={(e) => setRepli(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
              <span><b>Si la pharmacie n'est pas joignable sur téléphone, envoyer aussi par e-mail</b>
                <span style={{ display: "block", ...sourdine }}>Seulement si aucun de ses téléphones (iPhone, Android) n'accepte la notification. Aux adresses de connexion de son compte (jamais l'e-mail de la fiche Odoo, parfois partagé avec une autre officine). {type === "communication"
                  ? "Pas d'e-mail si elle a coupé cette alerte sur ses appareils ou si le plafond l'écarte ; l'e-mail parti compte dans le plafond." : "Pas d'e-mail si le plafond de sécurité l'écarte ; l'e-mail parti y compte."}</span></span>
            </label>
          )}
          <Estimation estimation={estimation} audience={audience} categorie={categorie} repli={repliPossible && repli} transactionnel={transactionnel} />
        </div>

        <div>
          <div style={ui.label}>Envoi</div>
          <Segment etiquette="Moment de l'envoi" valeur={quand} onChange={setQuand} options={[["maintenant", "Maintenant"], ["programmer", "Programmer"]]} />
          {quand === "programmer" && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label htmlFor="notif-date" style={{ fontSize: 13, color: T.ink }}>Le</label>
              <input id="notif-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} min={isoVersParis(new Date(Date.now() + 5 * 60e3).toISOString())}
                style={{ ...champ, width: "auto", maxWidth: "100%", minHeight: 36, padding: "5px 10px" }} />
              <span style={sourdine}>heure de Paris{programmeIso && horsHeures(Date.parse(programmeIso)) ? <b style={{ color: tone("warn").fg }}> · {motifHorsHeures(Date.parse(programmeIso))}</b> : null}</span>
              {!dateValide && <span style={{ ...sourdine, color: T.danger }}>{programmeIso ? "Au moins 5 minutes à l'avance." : "Date ou heure illisible (ou inexistante au changement d'heure)."}</span>}
              {dateValide && programmeIso && <div style={{ ...sourdine, flexBasis: "100%", color: T.ink }}>Envoi prévu le <b>{jourLong(programmeIso)}</b> (heure de Paris).</div>}
              <div style={{ ...sourdine, flexBasis: "100%" }}>Envoyé au plus 5 minutes après l'heure choisie, destinataires et plafonds calculés à ce moment-là. Annulable dans l'historique jusqu'à l'envoi.</div>
            </div>
          )}
        </div>
      </div>
      {!v.ok && (titre || corps) && <div style={{ marginTop: 12 }}><Erreur texte={v.erreurs.join(" ")} /></div>}
      {message && <div role={message.ton === "danger" ? "alert" : "status"} style={{ ...ui.encart(message.ton), marginTop: 12 }}>{message.texte}</div>}
      {suivi && <SuiviEnvoi suivi={suivi} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
        <Bouton onClick={apercu} disabled={busy || !msg.titre || !msg.corps || !lien || !etat.disponible || aCompleter.length > 0}><Icone nom="envoyer" taille={15} />M'envoyer l'aperçu</Bouton>
        {nomModele == null && <Bouton onClick={() => setNomModele(titre.trim().slice(0, NOM_MODELE_MAX))} disabled={!titre.trim() || !corps.trim() || !lien}>Enregistrer comme modèle</Bouton>}
        <Bouton principal onClick={envoyer} disabled={bloque} style={{ ...largeLibre, ...(bloque ? inactif : {}) }}>
          {quand === "programmer" ? <Icone nom="horloge" taille={15} /> : null}{libelleBouton}
        </Bouton>
      </div>
      {nomModele != null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input value={nomModele} onChange={(e) => setNomModele(e.target.value)} maxLength={NOM_MODELE_MAX} aria-label="Nom du modèle" placeholder="Nom du modèle"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enregistrerModele(); } }} style={{ ...champ, flex: "1 1 200px", minHeight: 36 }} />
          <Bouton principal onClick={() => enregistrerModele()} disabled={!nomModele.trim()}>Enregistrer le modèle</Bouton>
          <Bouton onClick={() => setNomModele(null)}>Annuler</Bouton>
        </div>
      )}
    </Section>
  );
}

// Estimation des destinataires (lecture seule, mise à jour en direct) ; e-mail de secours : même règle que l'envoi
function Estimation({ estimation: e, audience, categorie, repli, transactionnel }) {
  if (e == null) return <div role="status" style={{ ...sourdine, marginTop: 8 }}>Estimation…</div>;
  if (e.vide) return <div role="status" style={{ ...sourdine, marginTop: 8 }}>Choisissez {audience === "une" ? "la pharmacie" : "les pharmacies"}.</div>;
  if (e.erreur) return <div role="status" style={{ ...sourdine, marginTop: 8, color: T.danger }}>Estimation impossible pour le moment.</div>;
  const plafond = e.plafond;
  const lignes = [];
  if (e.fermee) lignes.push("Ouverture « fermée » : aucune pharmacie ne recevra de notification.");
  else {
    lignes.push(e.recevront ? `${pluriel(e.recevront, "pharmacie")} recevr${e.recevront > 1 ? "ont" : "a"} la notification (${pluriel(e.appareils, "appareil")}).`
      : "Aucune pharmacie ne recevra la notification.");
    if (e.plafonnees) lignes.push(`${pluriel(e.plafonnees, "pharmacie écartée", "pharmacies écartées")} par le plafond (${plafond?.max} « ${CATS[categorie]} » sur ${plafond?.fenetre}).`);
    const non = [];
    if (e.sans_appareil) non.push(audience === "toutes" ? `${pluriel(e.sans_appareil, "pharmacie cliente", "pharmacies clientes")} sans notifications activées` : `${pluriel(e.sans_appareil, "pharmacie")} sans appareil`);
    if (e.alerte_coupee) non.push(`${pluriel(e.alerte_coupee, "pharmacie")} avec l'alerte « ${CATS[categorie]} » coupée`);
    if (e.hors_ouverture) non.push(`${pluriel(e.hors_ouverture, "pharmacie")} hors pilote`);
    if (non.length) lignes.push(`Non joignables${audience === "toutes" ? "" : " parmi les choisies"} : ${non.join(", ")}.`);
  }
  if (audience === "une" && repli && e.email) {
    const m = e.email;
    const adresses = m.adresses ? `${pluriel(m.adresses, "adresse")} du compte (${(m.masquees || []).join(", ")})` : "";
    lignes.push(m.raison === "aucune_adresse" || !m.adresses ? "Pas d'e-mail de secours : aucune adresse de compte pour cette pharmacie."
      : m.raison === "alerte_coupee" ? `Pas d'e-mail de secours : la pharmacie a coupé « ${CATS[categorie]} ».`
      : m.raison === "plafond" ? "Pas d'e-mail de secours : plafond atteint pour cette pharmacie."
      : m.raison === "type" ? "Pas d'e-mail de secours pour une Promotion."
      : m.telephone ? `E-mail de secours seulement si son téléphone ne reçoit pas la notification : ${adresses}.`
      : `E-mail de secours prévu (aucun téléphone de la pharmacie ne reçoit cette alerte) : ${adresses}.`);
  }
  if (transactionnel && plafond) lignes.push(`Plafond de sécurité : ${plafond.max} messages « ${CATS.commandes} » par pharmacie sur ${plafond.fenetre}.`);
  return <div role="status" style={{ ...sourdine, marginTop: 10, color: T.ink, display: "flex", flexDirection: "column", gap: 2 }}>{lignes.filter(Boolean).map((l) => <span key={l}>{l}</span>)}</div>;
}

// résultat d'un message envoyé, en phrase (historique, suivi)
function resultatTexte(a) {
  if (["programmee", "annulee", "en_file", "en_cours"].includes(a.statut) || (a.statut === "erreur" && a.nb_visees == null)) return null;
  const parties = [];
  if (a.nb_reussis) parties.push(`${pluriel(a.nb_pharmacies || 0, "pharmacie jointe", "pharmacies jointes")} (${pluriel(a.nb_reussis, "appareil")})`);
  else parties.push(a.email_statut === "envoye" ? "Aucun appareil joint" : "Personne de joint");
  if (a.nb_echecs) parties.push(`${pluriel(a.nb_echecs, "appareil en échec", "appareils en échec")}`);
  if (a.nb_plafonnees) parties.push(`${pluriel(a.nb_plafonnees, "pharmacie écartée", "pharmacies écartées")} par le plafond`);
  if (a.nb_retires) parties.push(`${pluriel(a.nb_retires, "appareil retiré", "appareils retirés")} (plus joignable${a.nb_retires > 1 ? "s" : ""})`);
  return parties.join(" · ");
}
const libelleEmail = (a) => (a.repli_email && a.email_statut ? `${EMAILS[a.email_statut]?.[0] || a.email_statut}${a.email_statut === "envoye" && a.nb_emails ? ` (${pluriel(a.nb_emails, "adresse")})` : ""}` : null);
// statut affiché : « Envoyé » vert seulement si une pharmacie a été jointe (appareil ou e-mail de secours)
function statutDe(a) {
  if (a.statut === "envoyee" && !a.nb_reussis) return a.email_statut === "envoye" ? ["Envoyé par e-mail", "ok"] : ["Aucun appareil joint", "warn"];
  return STATUTS[a.statut] || [a.statut, "neutral"];
}

// Suivi d'un message unitaire (ou d'une petite liste) juste après l'envoi
function SuiviEnvoi({ suivi }) {
  const a = suivi.annonce;
  if (!suivi.fini) return <div role="status" style={{ ...ui.encart("info"), marginTop: 10 }}>Envoi en cours…</div>;
  if (!a) return <div role="status" style={{ ...ui.encart("warn"), marginTop: 10 }}>L'envoi prend plus de temps que prévu&nbsp;: suivez-le dans l'historique.</div>;
  if (a.statut === "erreur") return <div role="alert" style={{ ...ui.encart("danger"), marginTop: 10 }}>Non envoyé&nbsp;: {a.erreur || "erreur"}</div>;
  const email = libelleEmail(a);
  return (
    <div role="status" style={{ ...ui.encart(a.nb_reussis || a.email_statut === "envoye" ? "ok" : "warn"), marginTop: 10 }}>
      {resultatTexte(a)}.{email ? ` E-mail de secours : ${email}.` : ""}
    </div>
  );
}

// ── Choix des pharmacies : recherche (nom, ville, CIP) avec joignabilité, ou pharmacies abonnées à l'alerte ──
function Joignabilite({ p, categorie }) {
  if (p.appareils == null) return null;
  const recoit = (p.categories || []).includes(categorie);
  return (
    <div style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.5, marginTop: 2 }}>
      {p.appareils ? <>{pluriel(p.appareils, "appareil")} ({(p.plateformes || []).map((x) => PLATEFORMES[x] || x).join(", ")}) · <span style={{ color: recoit ? T.ok : tone("warn").fg, fontWeight: 600 }}>
        {recoit ? "✓" : "✗"} {CATS[categorie]}</span>{p.en_echec ? <span style={{ color: tone("warn").fg }}> · {p.en_echec} ne répond plus</span> : null}</>
        : <span style={{ color: tone("warn").fg, fontWeight: 600 }}>Aucun appareil</span>}
      {p.raison && <span style={{ color: tone("warn").fg }}> · {p.raison === "hors_pilote" ? "hors pilote" : "ouverture fermée"}</span>}
      <br />
      {p.derniere_visite ? `Vue le ${dt(p.derniere_visite)}` : "Jamais vue sur un appareil activé"}{p.derniere_notification ? ` · dernière notification le ${dt(p.derniere_notification)}` : ""}
      {" · "}{p.adresses ? `e-mail de secours : ${(p.adresses_masquees || []).join(", ")}` : "aucune adresse de compte"}
    </div>
  );
}
function ChoixDestinataires({ appeler, etat, audience, categorie, choix, setChoix, max }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [filtre, setFiltre] = useState("");
  const chercher = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setErr("");
    try {
      const r = await appeler("chercher", { q: q.trim() });
      if (!r.ok) throw new Error(r.corps.message || r.corps.error || `HTTP ${r.statut}`);
      setRes(r.corps.pharmacies || []);
    } catch (e) { setErr(e.message); setRes(null); }
    finally { setBusy(false); }
  };
  // détails de joignabilité d'une pharmacie ajoutée depuis la liste des abonnées
  const completer = async (cip) => {
    const r = await appeler("chercher", { cips: [cip] }).catch(() => null);
    const p = r?.ok ? (r.corps.pharmacies || [])[0] : null;
    if (p) setChoix((l) => l.map((x) => (x.cip === cip ? { ...x, ...p, nom: x.nom || p.nom } : x)));
  };
  const ajouter = (p) => {
    if (audience === "une") setChoix([p]);
    else setChoix((l) => (l.some((x) => x.cip === p.cip) || l.length >= max ? l : [...l, p]));
    if (p.appareils == null) completer(p.cip);
  };
  const retirer = (cip) => setChoix((l) => l.filter((x) => x.cip !== cip));
  const abonnees = (etat.pharmacies || []).filter((p) => p.categories.includes(categorie));
  const inactifR = busy || q.trim().length < 2;
  return (
    <div style={{ marginTop: 10 }}>
      {choix.length > 0 && (audience === "une" ? (
        <div style={{ border: `1px solid ${T.line}`, borderRadius: R.s, padding: "10px 12px", background: T.paper, display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 13.5 }}>{choix[0].nom || "Pharmacie"}</div>
            <div className="num" style={{ fontSize: 11.5, color: T.inkSoft }}>{[choix[0].ville, `CIP ${choix[0].cip}`].filter(Boolean).join(" · ")}</div>
            <Joignabilite p={choix[0]} categorie={categorie} />
          </div>
          <Bouton onClick={() => setChoix([])}>Changer</Bouton>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {choix.map((p) => <Puce key={p.cip} libelle={`Retirer ${p.nom || p.cip}`} onRetirer={() => retirer(p.cip)}>{p.nom || "CIP"} · {p.cip}</Puce>)}
          <span style={{ ...sourdine, alignSelf: "center" }}>{choix.length}/{max}</span>
        </div>
      ))}
      {(audience !== "une" || !choix.length) && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chercher(); } }}
              placeholder="Nom, ville ou CIP de la pharmacie" aria-label="Rechercher une pharmacie"
              style={{ ...ui.input, minHeight: 36, flex: "1 1 220px", padding: "6px 14px", borderRadius: R.pill, fontSize: 13 }} />
            <Bouton principal onClick={chercher} disabled={inactifR} style={inactifR ? inactif : undefined}><Icone nom="recherche" taille={14} />{busy ? "Recherche…" : "Rechercher"}</Bouton>
          </div>
          {err && <div style={{ marginTop: 8 }}><Erreur texte={err} /></div>}
          {res && !res.length && <div style={{ ...sourdine, marginTop: 8 }}>Aucune pharmacie avec un compte sur le site ne correspond (seules ces pharmacies peuvent recevoir une notification ou l'e-mail de secours).</div>}
          {res && res.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
              {res.map((p) => {
                const present = choix.some((x) => x.cip === p.cip);
                return (
                  <div key={p.cip} className="ex-tr" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.nom || "—"}</div>
                      <div className="num" style={{ fontSize: 11, color: T.inkSoft }}>{[p.ville, `CIP ${p.cip}`].filter(Boolean).join(" · ")}</div>
                      <Joignabilite p={p} categorie={categorie} />
                    </div>
                    <button type="button" onClick={() => ajouter(p)} disabled={present || (audience !== "une" && choix.length >= max)} className={present ? undefined : "ex-btn-ligne"} style={ui.btn("ligne", "s")}>
                      {present ? "Déjà choisie" : audience === "une" ? "Choisir" : "Ajouter"}</button>
                  </div>
                );
              })}
            </div>
          )}
          {audience === "liste" && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: T.ink, minHeight: 28 }}>Ou choisir parmi les {pluriel(abonnees.length, "pharmacie abonnée", "pharmacies abonnées")} à «&nbsp;{CATS[categorie]}&nbsp;»</summary>
              <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer (nom ou CIP)" aria-label="Filtrer les pharmacies abonnées"
                style={{ ...ui.input, fontSize: 13, borderRadius: R.pill, minHeight: 34, padding: "5px 12px", marginTop: 6 }} />
              <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 6, border: `1px solid ${T.line}`, borderRadius: R.s }}>
                {abonnees.filter((p) => !filtre || `${p.nom || ""} ${p.cip}`.toLowerCase().includes(filtre.toLowerCase())).map((p) => (
                  <label key={p.cip} className="ex-tr" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", fontSize: 13, borderBottom: `1px solid ${T.lineSoft}`, cursor: "pointer" }}>
                    <input type="checkbox" checked={choix.some((x) => x.cip === p.cip)} disabled={!choix.some((x) => x.cip === p.cip) && choix.length >= max}
                      onChange={(e) => (e.target.checked ? ajouter({ cip: p.cip, nom: p.nom }) : retirer(p.cip))} />
                    <span style={{ flex: 1 }}>{p.nom || "—"}</span><span className="num" style={{ color: T.inkMute, fontSize: 12 }}>{p.cip}</span>
                  </label>
                ))}
                {!abonnees.length && <div style={{ ...sourdine, padding: 10 }}>Aucune pharmacie abonnée à cette alerte.</div>}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ── Aperçus : Android (volet des notifications, repliée) et iPhone (écran verrouillé) ──
const clamp = (lignes) => ({ display: "-webkit-box", WebkitLineClamp: lignes, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" });
const ICONE = "/icones/elixir-192.png";
export function ApercuAndroid({ titre, corps }) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ background: "#1f2427", borderRadius: 18, padding: 10 }}>
        <div style={{ background: "#2d3236", color: "#e8eaed", borderRadius: 14, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
          fontFamily: "Roboto, system-ui, sans-serif" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#bdc1c6" }}>
              <img src="/icones/badge-96.png" alt="" width="14" height="14" style={{ filter: "none" }} /><span>Elixir</span><span>· maintenant</span>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 4, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titre || "Titre du message"}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.35, marginTop: 1, color: "#d2d5d9", ...clamp(2) }}>{corps || "Texte du message."}</div>
          </div>
          <img src={ICONE} alt="" width="36" height="36" style={{ borderRadius: 8, flexShrink: 0 }} />
        </div>
      </div>
      <figcaption style={{ ...sourdine, marginTop: 4, textAlign: "center" }}>Android, application installée (sinon&nbsp;: «&nbsp;Chrome · elixir-commande.expepharma.com&nbsp;»)</figcaption>
    </figure>
  );
}
export function ApercuIphone({ titre, corps }) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ background: "linear-gradient(160deg, #335a6b 0%, #0f2d3d 55%, #b5904a 140%)", borderRadius: 18, padding: "18px 10px 12px" }}>
        <div style={{ textAlign: "center", color: "rgba(255,255,255,.92)", fontFamily: "-apple-system, system-ui, sans-serif", fontSize: 30, fontWeight: 600, lineHeight: 1, marginBottom: 12 }}>9:41</div>
        <div style={{ background: "rgba(245,245,245,.78)", backdropFilter: "blur(12px)", borderRadius: 16, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
          fontFamily: "-apple-system, system-ui, sans-serif", color: "#111" }}>
          <img src={ICONE} alt="" width="34" height="34" style={{ borderRadius: 8, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, ...clamp(1) }}>{titre || "Titre du message"}</span>
              <span style={{ fontSize: 11.5, color: "#555", flexShrink: 0 }}>maintenant</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.3, marginTop: 1, ...clamp(4) }}>{corps || "Texte du message."}</div>
          </div>
        </div>
      </div>
      <figcaption style={{ ...sourdine, marginTop: 4, textAlign: "center" }}>iPhone (écran verrouillé)</figcaption>
    </figure>
  );
}

// ── Historiques : messages, par pharmacie, outil entrepôt ──
const ERREURS_RELANCE = { trop_tot: "⚠ Attendez 2 minutes avant de relancer", trop_ancienne: "⚠ Prévu il y a plus de 3 h : il ne partira plus (recomposez-le si besoin)",
  en_cours: "⚠ Un autre message plafonné est en cours d'envoi : relancez quand il sera terminé" };
function Historiques({ annonces, etat, appeler, flash, onChange, onModifier, promos, sections }) {
  const [vue, setVue] = useState("messages");
  return (
    <Section id="notif-historique" titre="Historique" droite={<Segment etiquette="Historique" valeur={vue} onChange={setVue}
      options={[["messages", "Messages"], ["pharmacie", "Par pharmacie"], ["entrepot", "Outil entrepôt"]]} />}>
      {vue === "messages" ? <HistoriqueMessages annonces={annonces} appeler={appeler} flash={flash} onChange={onChange} onModifier={onModifier} promos={promos} sections={sections} />
        : vue === "pharmacie" ? <HistoriquePharmacie appeler={appeler} etat={etat} />
        : <HistoriqueEntrepot appeler={appeler} />}
    </Section>
  );
}
const destinatairesDe = (a) => (a.audience === "une" ? (a.destinataire_nom || (a.cips?.[0] ? `CIP ${a.cips[0]}` : "pharmacie (effacée)")) : a.audience === "liste" ? pluriel(a.nb_cips || 0, "pharmacie choisie", "pharmacies choisies") : "toutes");
// date d'un message : composé le …, prévu le …, parti le …
function DateMessage({ a }) {
  if (a.statut === "programmee") return <>prévu le<br />{dt(a.programme_pour)}</>;
  if (a.programme_pour) return <>prévu le {dt(a.programme_pour)}{a.started_at ? <><br />parti le {dt(a.started_at)}</> : null}</>;
  return <>{dt(a.created_at)}</>;
}
function HistoriqueMessages({ annonces, appeler, flash, onChange, onModifier, promos, sections }) {
  const etroit = useEtroit();
  const [busy, setBusy] = useState(false);
  const maintenant = Date.now();
  const relancable = (a) => a.statut === "en_file" && maintenant - Date.parse(a.en_file_le || a.created_at) >= 2 * 60e3
    && maintenant - Date.parse(a.programme_pour || a.created_at) <= PROGRAMME_RETARD_MAX_MS;
  const relancer = async (a) => {
    const h = Date.now();
    if (horsHeures(h) && !window.confirm(`Il est ${texteHeureParis(h)} (heure de Paris)${partiesParis(h).jourSemaine === "dimanche" ? ", un dimanche" : ""} : « ${a.titre} » partira tout de suite sur le téléphone des pharmacies. Relancer quand même ?`)) return;
    setBusy(true);
    try {
      const r = await appeler("relancer", { id: a.id });
      flash(r.statut === 202 ? "✓ Envoi relancé" : ERREURS_RELANCE[r.corps.error] || `⚠ Relance impossible (${r.corps.error || r.statut})`);
      await onChange();
    } finally { setBusy(false); }
  };
  // annuler (programmé ou en file) ; modifier : le composeur repart du message annulé
  const annuler = async (a, modifier = false) => {
    const quand = a.statut === "programmee" ? `, programmé pour le ${jourLong(a.programme_pour)}` : ", en attente d'envoi";
    if (!window.confirm(`Annuler « ${a.titre} »${quand} ? Il ne partira pas.${modifier ? "\n\nIl est repris dans « Nouveau message » pour être corrigé, puis renvoyé ou reprogrammé." : ""}`)) return;
    setBusy(true);
    try {
      const r = await appeler("annuler", { id: a.id });
      flash(r.ok ? (modifier ? "✓ Message annulé : corrigez-le dans « Nouveau message »" : "✓ Message annulé : il ne partira pas") : "⚠ Trop tard : le message est déjà parti (ou en cours d'envoi)");
      if (r.ok && modifier) onModifier(r.corps.annonce || a);
      await onChange();
    } finally { setBusy(false); }
  };
  if (annonces == null) return <div role="status" style={sourdine}>Chargement…</div>;
  if (!annonces.length) return <p style={{ ...sourdine, margin: 0 }}>Aucun message envoyé.</p>;
  const aVenir = annonces.filter((a) => a.statut === "programmee" || a.statut === "en_file");
  const passes = annonces.filter((a) => !aVenir.includes(a));
  const actions = (a, pleine) => {
    const b = { ...ui.btn("ligne", "s"), ...(pleine ? { width: "100%", justifyContent: "center", minHeight: 36 } : {}) };
    return (
      <>
        {(a.statut === "programmee" || a.statut === "en_file") && <button type="button" onClick={() => annuler(a)} disabled={busy} className="ex-btn-ligne" style={b}>Annuler</button>}
        {(a.statut === "programmee" || a.statut === "en_file") && <button type="button" onClick={() => annuler(a, true)} disabled={busy} className="ex-btn-ligne" style={b}>Annuler et modifier</button>}
        {relancable(a) && <button type="button" onClick={() => relancer(a)} disabled={busy} className="ex-btn-ligne" style={b}>Relancer</button>}
      </>
    );
  };
  const carte = (a) => {
    const [l, t] = statutDe(a);
    const email = libelleEmail(a);
    return (
      <Carte key={a.id}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><BadgeType type={a.type} /><span style={ui.badge(t)}>{l}</span>
          <span className="num" style={{ color: T.inkSoft, fontSize: 11.5 }}><DateMessage a={a} /></span></div>
        <div><b>{a.titre}</b><div style={{ color: T.inkSoft }}>{a.corps}</div></div>
        <div style={{ color: T.inkSoft }}>À&nbsp;: {destinatairesDe(a)} · lien&nbsp;: {libelleLien(a.url, promos, sections)}</div>
        {resultatTexte(a) && <div>{resultatTexte(a)}</div>}
        {email && <div><span style={ui.badge(EMAILS[a.email_statut]?.[1] || "neutral")}>{email}</span></div>}
        {a.erreur && <div style={{ color: a.statut === "erreur" ? T.danger : T.inkSoft }}>{a.erreur}</div>}
        {a.statut === "annulee" && a.annule_at && <div style={{ color: T.inkSoft }}>Annulé le {dt(a.annule_at)}</div>}
        <div style={{ display: "flex", flexDirection: etroit ? "column" : "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>{actions(a, etroit)}</div>
      </Carte>
    );
  };
  return (
    <>
      {aVenir.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...ui.label, marginBottom: 6 }}>À venir ({aVenir.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: grille(300), gap: 8 }}>{aVenir.map(carte)}</div>
        </div>
      )}
      {passes.length > 0 && (etroit ? <Cartes>{passes.map(carte)}</Cartes> : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={thS}>Date</th><th style={thS}>Type</th><th style={thS}>Message</th><th style={thS}>Destinataires</th><th style={thS}>Résultat</th><th style={thS}>Statut</th>
            </tr></thead>
            <tbody>
              {passes.map((a) => {
                const [l, t] = statutDe(a);
                const email = libelleEmail(a);
                return (
                  <tr key={a.id} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                    <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}><DateMessage a={a} /></td>
                    <td style={tdS}><BadgeType type={a.type} /></td>
                    <td style={{ ...tdS, minWidth: 220, maxWidth: 340 }}><b>{a.titre}</b><div style={{ color: T.inkSoft, overflowWrap: "anywhere" }}>{a.corps}</div>
                      <div style={{ color: T.inkMute, marginTop: 3, overflowWrap: "anywhere" }} title={a.url}>Lien&nbsp;: {libelleLien(a.url, promos, sections)}</div></td>
                    <td style={{ ...tdS, minWidth: 110 }}>{destinatairesDe(a)}</td>
                    <td style={{ ...tdS, minWidth: 170, maxWidth: 260 }}>
                      {resultatTexte(a) || "—"}
                      {email && <div style={{ marginTop: 4 }}><span style={ui.badge(EMAILS[a.email_statut]?.[1] || "neutral")}>{email}</span></div>}
                    </td>
                    <td style={tdS}>
                      <span style={ui.badge(t)}>{l}</span>
                      {a.erreur && <div style={{ color: a.statut === "erreur" ? T.danger : T.inkSoft, marginTop: 4 }}>{a.erreur}</div>}
                      {a.statut === "annulee" && a.annule_at && <div style={{ color: T.inkSoft, marginTop: 4 }}>le {dt(a.annule_at)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <p style={{ ...sourdine, margin: "8px 0 0" }}>Un message resté «&nbsp;En file&nbsp;» est relancé automatiquement toutes les 5 minutes, aux heures ouvertes (8 h – 20 h, hors dimanche)&nbsp;; prévu depuis plus de 3 heures, il ne part plus (erreur expliquée). «&nbsp;Annuler&nbsp;» reste possible tant qu'il n'est pas parti.</p>
    </>
  );
}

// Envois d'une pharmacie (90 jours) : messages de l'admin, retours en stock, outil entrepôt
export function ListeEnvois({ envois, compact = false }) {
  const etroit = useEtroit();
  if (!envois.length) return <p style={{ ...sourdine, margin: 0 }}>Aucune notification envoyée à cette pharmacie ces 90 derniers jours.</p>;
  const appareils = (e) => (e.nb_appareils ? `${e.nb_reussis} / ${pluriel(e.nb_appareils, "appareil joint", "appareils joints")}` : "aucun appareil");
  if (etroit) return (
    <Cartes>
      {envois.map((e) => (
        <Carte key={e.id}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{e.type ? <BadgeType type={e.type} /> : null}<span style={{ color: T.inkSoft }}>{CATS[e.categorie] || e.categorie}</span>
            <span className="num" style={{ color: T.inkSoft, fontSize: 11.5 }}>{dt(e.created_at)}</span></div>
          <div><b>{e.titre || "—"}</b></div>
          <div style={{ color: e.nb_appareils && !e.nb_reussis ? T.danger : T.inkSoft }}>{SOURCES[e.source] || e.source || "—"} · {appareils(e)}</div>
          {e.email && <div><span style={ui.badge(EMAILS[e.email]?.[1] || "neutral")}>{EMAILS[e.email]?.[0] || e.email}</span></div>}
        </Carte>
      ))}
    </Cartes>
  );
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: compact ? 520 : 680 }}>
        <thead><tr><th style={thS}>Date</th><th style={thS}>Alerte</th><th style={thS}>Notification</th><th style={thS}>Origine</th><th style={thS} title="appareils joints / visés">Appareils</th><th style={thS}>E-mail</th></tr></thead>
        <tbody>
          {envois.map((e) => (
            <tr key={e.id} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
              <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}>{dt(e.created_at)}</td>
              <td style={tdS}>{e.type ? <BadgeType type={e.type} /> : null}<div style={{ color: T.inkSoft, marginTop: e.type ? 3 : 0 }}>{CATS[e.categorie] || e.categorie}</div></td>
              <td style={{ ...tdS, maxWidth: 260, overflowWrap: "anywhere" }}>{e.titre || "—"}</td>
              <td style={tdS}>{SOURCES[e.source] || e.source || "—"}</td>
              <td className="num" style={{ ...tdS, color: e.nb_appareils && !e.nb_reussis ? T.danger : T.ink }}>{e.nb_reussis} / {e.nb_appareils}</td>
              <td style={tdS}>{e.email ? <span style={ui.badge(EMAILS[e.email]?.[1] || "neutral")}>{EMAILS[e.email]?.[0] || e.email}</span> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const ResumeAppareils = ({ a, adresses }) => (
  <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5, marginBottom: 8 }}>
    {a?.appareils ? <>{pluriel(a.appareils, "appareil")} ({(a.plateformes || []).map((x) => PLATEFORMES[x] || x).join(", ")})&nbsp;· alertes&nbsp;: {(a.categories || []).map((c) => CATS[c]).join(", ") || "aucune"}
      {a.derniere_visite ? ` · vue le ${dt(a.derniere_visite)}` : ""}</> : "Aucun appareil activé."}
    {adresses != null && <> · {adresses ? pluriel(adresses, "adresse de compte", "adresses de compte") : "aucune adresse de compte"} (e-mail de secours)</>}
  </div>
);
function HistoriquePharmacie({ appeler, etat }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [cip, setCip] = useState("");
  const [donnees, setDonnees] = useState(null);
  const [busy, setBusy] = useState(false);
  const chercher = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try { const r = await appeler("chercher", { q: q.trim() }); setRes(r.ok ? r.corps.pharmacies || [] : []); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!cip) { setDonnees(null); return undefined; }
    let annule = false;
    setDonnees(null);
    appeler("historique", { cip }).then((r) => { if (!annule) setDonnees(r.ok ? r.corps : { erreur: true }); }, () => { if (!annule) setDonnees({ erreur: true }); });
    return () => { annule = true; };
  }, [cip, appeler]);
  const joignables = etat.pharmacies || [];
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={joignables.some((p) => p.cip === cip) ? cip : ""} onChange={(e) => setCip(e.target.value)} aria-label="Pharmacie joignable" style={{ ...ui.input, fontSize: 13, flex: "1 1 220px", minHeight: 36 }}>
          <option value="">Pharmacies joignables…</option>
          {joignables.map((p) => <option key={p.cip} value={p.cip}>{p.nom || "—"} · {p.cip}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chercher(); } }} placeholder="ou nom, ville, CIP"
          aria-label="Rechercher une pharmacie" style={{ ...ui.input, minHeight: 36, flex: "1 1 180px", padding: "6px 14px", borderRadius: R.pill, fontSize: 13 }} />
        <Bouton onClick={chercher} disabled={busy || q.trim().length < 2}><Icone nom="recherche" taille={14} />Rechercher</Bouton>
      </div>
      {res && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {!res.length && <span style={sourdine}>Aucune pharmacie ne correspond.</span>}
          {res.map((p) => <button key={p.cip} type="button" className="ex-btn-ligne" aria-pressed={cip === p.cip} onClick={() => setCip(p.cip)} style={{ ...ui.btn("ligne", "s"), ...largeLibre, minHeight: 30 }}>{p.nom || "—"} · {p.cip}</button>)}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {!cip ? <p style={{ ...sourdine, margin: 0 }}>Choisissez une pharmacie pour voir les notifications qu'elle a reçues (90 derniers jours).</p>
          : donnees == null ? <div role="status" style={sourdine}>Chargement…</div>
          : donnees.erreur ? <Erreur texte="Lecture impossible pour le moment." />
          : <>
            <div style={{ fontWeight: 650, fontSize: 13.5, marginBottom: 4 }}>{donnees.nom || "Pharmacie"} <span className="num" style={{ color: T.inkSoft, fontWeight: 400 }}>· CIP {donnees.cip}</span></div>
            <ResumeAppareils a={donnees.appareils} adresses={donnees.adresses} />
            <ListeEnvois envois={donnees.envois || []} />
          </>}
      </div>
    </div>
  );
}
// résultat d'un événement de l'outil entrepôt : badge (vert seulement si un appareil a été joint)
function resultatEvt(e) {
  const libelle = RESULTATS[e.resultat] || e.resultat || "en cours";
  const ton = e.resultat === "envoye" ? (e.nb_reussis ? "ok" : "warn") : e.resultat === "differe" || e.resultat === "envoi" ? "info" : e.resultat ? "warn" : "neutral";
  const detail = e.resultat === "differe" && e.a_envoyer_le ? `prévue le ${dt(e.a_envoyer_le)}`
    : e.nb_appareils != null ? (e.nb_reussis ? pluriel(e.nb_reussis, "appareil joint", "appareils joints") : e.nb_appareils ? `aucun des ${pluriel(e.nb_appareils, "appareil")} joint` : "") : "";
  return { libelle: e.resultat === "envoye" && !e.nb_reussis ? "aucun appareil joint" : libelle, ton, detail };
}
function HistoriqueEntrepot({ appeler }) {
  const etroit = useEtroit();
  const [evts, setEvts] = useState(null);
  useEffect(() => { let annule = false; appeler("evenements").then((r) => { if (!annule) setEvts(r.ok ? r.corps.evenements || [] : []); }, () => { if (!annule) setEvts([]); }); return () => { annule = true; }; }, [appeler]);
  if (evts == null) return <div role="status" style={sourdine}>Chargement…</div>;
  const pharmacie = (e) => <>{e.pharmacie_nom || "Pharmacie"} <span className="num" style={{ color: T.inkSoft }}>· CIP {e.pharmacy_cip}</span></>;
  const quoi = (e) => `${TYPES_EVT[e.type] || e.type} ${STATUTS_EVT[e.statut] || e.statut.replace(/_/g, " ")}`;
  return (
    <>
      {!evts.length ? <p style={{ ...sourdine, margin: 0 }}>Aucun événement reçu de l'outil entrepôt (API push-evenement, docs/notifications.md §&nbsp;6).</p> : etroit ? (
        <Cartes>
          {evts.map((e) => { const r = resultatEvt(e); return (
            <Carte key={e.cle}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><span style={ui.badge(r.ton)}>{r.libelle}</span><span className="num" style={{ color: T.inkSoft, fontSize: 11.5 }}>{dt(e.recu_le)}</span></div>
              <div><b>{pharmacie(e)}</b></div>
              <div>{quoi(e)} · <span className="num">{e.reference || "—"}</span></div>
              {e.titre && <div style={{ color: T.inkSoft }}>Notification&nbsp;: {e.titre}</div>}
              {r.detail && <div style={{ color: T.inkSoft }}>{r.detail}</div>}
            </Carte>); })}
        </Cartes>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead><tr><th style={thS}>Reçu le</th><th style={thS}>Pharmacie</th><th style={thS}>Événement</th><th style={thS}>Référence</th><th style={thS}>Notification</th><th style={thS}>Résultat</th></tr></thead>
            <tbody>
              {evts.map((e) => { const r = resultatEvt(e); return (
                <tr key={e.cle} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                  <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}>{dt(e.recu_le)}</td>
                  <td style={tdS}>{pharmacie(e)}</td>
                  <td style={tdS}>{quoi(e)}</td>
                  <td className="num" style={tdS}>{e.reference || "—"}</td>
                  <td style={{ ...tdS, maxWidth: 220 }}>{e.titre || "—"}</td>
                  <td style={tdS}><span style={ui.badge(r.ton)}>{r.libelle}</span>{r.detail && <div style={{ color: T.inkSoft, marginTop: 3 }}>{r.detail}</div>}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ ...sourdine, margin: "8px 0 0" }}>Notifications automatiques «&nbsp;Mes commandes et réclamations&nbsp;» déclenchées par l'outil entrepôt (Réclamations, Tickets). Reçues avant 8 h, après 20 h ou le dimanche&nbsp;: envoyées le matin suivant à 8 h. Un même statut d'une même référence reçu deux fois en 10 minutes n'est notifié qu'une fois.</p>
    </>
  );
}

// ── Bloc « Notifications envoyées » de la fiche pharmacie (onglet 🏥 Pharmacies) ──
// cip : CIP de la fiche en cours d'édition (lu 600 ms après la dernière frappe) ; lecture seule. onEcrire : ouvre l'onglet
// 📲 Notifications, le composeur prérempli pour cette pharmacie (« Écrire à cette pharmacie »).
export function NotificationsEnvoyees({ adminFetch, cip, onEcrire }) {
  const c = String(cip || "").trim();
  const valide = /^\d{7,14}$/.test(c);
  const [donnees, setDonnees] = useState(null);
  const appeler = useMemo(() => async (action, corps = {}) => {
    const r = await adminFetch("/.netlify/functions/push-admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...corps }) });
    return { ok: r.ok, statut: r.status, corps: await r.json().catch(() => ({})) };
  }, [adminFetch]);
  useEffect(() => {
    if (!valide) { setDonnees(null); return undefined; }
    let annule = false;
    const t = setTimeout(async () => {
      const r = await appeler("historique", { cip: c }).catch(() => null);
      if (!annule) setDonnees(r?.ok ? r.corps : { erreur: true });
    }, 600);
    return () => { annule = true; clearTimeout(t); };
  }, [c, valide, appeler]);
  if (!valide) return null;
  const ecrire = () => {
    garderBrouillon({ type: "reclamation", titre: "", corps: "", typeLien: "commandes", valeurLien: "", audience: "une", choix: [{ cip: c, nom: donnees?.nom || null, ville: null }],
      repli: false, quand: "maintenant", date: "" });
    onEcrire?.();
  };
  return (
    <section aria-labelledby="pharm-notif-titre" style={{ background: T.surface, borderRadius: 12, padding: 16, border: "1.5px solid var(--line)", marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div id="pharm-notif-titre" style={{ fontWeight: 700, fontSize: 14, color: T.ink, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icone nom="cloche" taille={16} />Notifications envoyées <span style={{ fontWeight: 400, fontSize: 12, color: T.inkMute }}>(90 derniers jours)</span>
        </div>
        {onEcrire && <Bouton onClick={ecrire}><Icone nom="envoyer" taille={14} />Écrire à cette pharmacie</Bouton>}
      </div>
      {donnees == null ? <div role="status" style={sourdine}>Chargement…</div>
        : donnees.erreur ? <div style={sourdine}>Lecture impossible (service des notifications pas encore en place&nbsp;?).</div>
        : <><ResumeAppareils a={donnees.appareils} adresses={donnees.adresses} /><ListeEnvois envois={(donnees.envois || []).slice(0, 20)} compact /></>}
    </section>
  );
}
