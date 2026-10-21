import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T, R, ui, tone } from "../theme.js";
import { Icone } from "../icons.jsx";
import {
  LIMITES, TITRE_CONSEILLE, LIBELLES_OUTILS, OUTILS_LIEN, TYPES_MESSAGE, IDS_TYPES, lienValide, longueur, verifierMessage, champsACompleter,
  contientMontant, estTransactionnel, categorieDuType, parisVersIso, isoVersParis, partiesParis, horsHeures, texteHeureParis, MAX_LISTE_TRANSACTIONNEL,
} from "../notifications/regles.js";
import { MODELES_ELIXIR, NOM_MODELE_MAX } from "../notifications/modeles.js";

// ── Admin : messages unitaires et collectifs de l'onglet « 📲 Notifications » (docs/notifications.md § 4 à 6) ──
// Demande de Zineb (21/10/2026) : « prévoir l'envoi d'une notification unitaire ou collective : communication, promotion,
// traitement d'une réclamation, etc. »
//  • Types : Promotion → « Offres et nouveautés » ; Communication → « Informations Elixir » ; Réclamation / SAV et Commande →
//    « Mes commandes et réclamations » (une ou quelques pharmacies, jamais toutes, aucun montant).
//  • Destinataires : une pharmacie (recherche par nom, ville ou CIP : appareils, alertes acceptées, dernière activité),
//    plusieurs, ou toutes les pharmacies abonnées (Promotion et Communication) ; estimation avant l'envoi.
//  • E-mail de secours (message unitaire) : le serveur l'envoie aux adresses du COMPTE de la pharmacie si aucun appareil n'a
//    été joint ; la page ne voit que des adresses masquées.
//  • Modèles (Elixir et enregistrés), programmation (heure de Paris, annulable), historique global, par pharmacie et outil
//    entrepôt. API : netlify/functions/push-admin.js (verifyAdmin).
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
  promotion: "Arrive dans «\u00a0Offres et nouveautés\u00a0» (plafonné par pharmacie sur 7 jours).",
  communication: "Arrive dans «\u00a0Informations Elixir\u00a0»\u00a0: fermetures, changements de service, nouveautés du site (plafonné à part).",
  reclamation: "Arrive dans «\u00a0Mes commandes et réclamations\u00a0»\u00a0: suivi d'une réclamation, d'un retour, d'un avoir. Une ou quelques pharmacies, jamais toutes\u00a0; aucun montant.",
  commande: "Arrive dans «\u00a0Mes commandes et réclamations\u00a0»\u00a0: expédition, reliquat. Une ou quelques pharmacies, jamais toutes\u00a0; aucun montant.",
};
const EMAILS = { envoye: ["e-mail envoyé", "ok"], echec: ["e-mail en échec", "danger"], aucune_adresse: ["aucune adresse de compte", "warn"], non_requis: ["e-mail non nécessaire", "neutral"] };
const SOURCES = { message: "Message de l'admin", stock: "Retour en stock", entrepot: "Outil entrepôt", commandes: "Automatique", offres: "Automatique", infos: "Automatique" };
const RESULTATS = { envoye: "envoyée", aucun_appareil: "aucun appareil", fermee: "ouverture fermée", hors_pilote: "hors pilote", plafond: "plafond de sécurité",
  configuration: "service incomplet", schema: "tables absentes", erreur: "erreur", deja_envoye: "déjà envoyée", categorie: "catégorie inconnue" };

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
    if (p) return `Menu promo\u00a0: ${p.name}`;
    const s = sections.find((x) => x.key === m[2]);
    return s ? `Menu\u00a0: ${s.label}` : `Menu ${m[2]}`;
  }
  if (m[1] === "outil") return `Outil\u00a0: ${LIBELLES_OUTILS[m[2]] || m[2]}`;
  if (m[1] === "cip") return `Produit (CIP ${m[2]})`;
  return "Panneau «\u00a0Notifications\u00a0»";
}

// heure de Paris : avant 8 h, après 20 h ou le dimanche, l'envoi (ou l'heure programmée) demande une confirmation de plus
const motifHorsHeures = (t) => { const p = partiesParis(t); return p.jourSemaine === "dimanche" ? "un dimanche" : p.heure < 8 ? "avant 8\u00a0h" : "après 20\u00a0h"; };
const demainMatin = () => { const p = partiesParis(Date.now() + 86400e3), d = (n) => String(n).padStart(2, "0"); return `${p.annee}-${d(p.mois)}-${d(p.jour)}T08:30`; };

// Brouillon gardé pour l'onglet (sessionStorage) : toucher l'aperçu sur le même appareil, ou recharger, ne perd rien
const CLE_BROUILLON = "notif_brouillon_annonce";
function lireBrouillon() {
  try { const b = JSON.parse(sessionStorage.getItem(CLE_BROUILLON) || "null"); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}

// ── Messages : composeur et historique ──
export default function Messages({ etat, appeler, flash, promos = [], sections = [], masques = [], onEnvoye }) {
  const [historique, setHistorique] = useState(null);
  const [modeles, setModeles] = useState([]);
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
  return (
    <>
      <Composeur etat={etat} appeler={appeler} flash={flash} promos={promos} sections={sections} masques={masques} modeles={modeles} onModeles={chargerModeles} onEnvoye={apres} />
      <Historiques annonces={historique} etat={etat} appeler={appeler} flash={flash} onChange={chargerHistorique} promos={promos} sections={sections} />
    </>
  );
}

// ── Composeur ──
function Composeur({ etat, appeler, flash, promos, sections, masques, modeles, onModeles, onEnvoye }) {
  const [b0] = useState(lireBrouillon);
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
  const [date, setDate] = useState(typeof b0.date === "string" && b0.date ? b0.date : demainMatin());
  const [modele, setModele] = useState("");
  useEffect(() => {
    const brouillon = { type, titre, corps, typeLien, valeurLien, audience, choix: choix.map(({ cip, nom, ville }) => ({ cip, nom, ville })), repli, quand, date };
    try {
      if (titre || corps) sessionStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
      else sessionStorage.removeItem(CLE_BROUILLON);
    } catch { /* stockage refusé : pas de brouillon */ }
  }, [type, titre, corps, typeLien, valeurLien, audience, choix, repli, quand, date]);
  const transactionnel = estTransactionnel(type);
  const categorie = categorieDuType(type);
  // Réclamation / SAV et Commande : jamais « toutes » ; au plus 20 pharmacies
  useEffect(() => { if (transactionnel && audience === "toutes") setAudience("une"); }, [transactionnel, audience]);
  useEffect(() => { if (audience === "une" && choix.length > 1) setChoix((l) => l.slice(0, 1)); }, [audience, choix.length]);
  const cips = audience === "toutes" ? [] : choix.map((p) => p.cip);

  const [estimation, setEstimation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [suivi, setSuivi] = useState(null);   // message unitaire parti : suivi de son envoi
  const idem = useRef(nouvelleCle());   // une clé par message : un double clic ou une réponse perdue n'envoie jamais deux fois
  const chemin = cheminDe(typeLien, valeurLien);
  const lien = lienValide(chemin);
  const programmeIso = quand === "programmer" ? parisVersIso(date) : null;
  const msg = { type, titre: titre.trim(), corps: corps.trim(), url: lien || "", audience, cips: audience === "toutes" ? null : cips,
    repli_email: audience === "une" && repli, programme_pour: programmeIso };
  const v = verifierMessage(msg);
  const aCompleter = champsACompleter(`${titre} ${corps}`);
  const montant = transactionnel && contientMontant(`${titre} ${corps}`);
  const dateValide = quand !== "programmer" || (!!programmeIso && Date.parse(programmeIso) > Date.now() + 4 * 60e3);
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
    setModele(id);
    const m = MODELES_ELIXIR.find((x) => x.id === id) || modeles.find((x) => x.id === id);
    if (!m) return;
    setType(m.type); setTitre(m.titre); setCorps(m.corps);
    const [tl, vl] = lienVersChamps(m.url);
    setTypeLien(tl); setValeurLien(vl);
    if (estTransactionnel(m.type) && audience === "toutes") setAudience("une");
  };
  const persoChoisi = modeles.find((x) => x.id === modele);

  const apercu = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await appeler("apercu", { message: msg });
      setMessage(!r.ok ? { ton: "danger", texte: (r.corps.erreurs || [r.corps.message || r.corps.error || `HTTP ${r.statut}`]).join(" ") }
        : r.corps.aucun ? { ton: "warn", texte: "Aucun de vos appareils n'est activé\u00a0: voir «\u00a0Vos appareils\u00a0» ci-dessus." }
        : { ton: "ok", texte: `Aperçu envoyé à ${pluriel(r.corps.envoyes, "appareil")}${r.corps.echecs ? ` (${r.corps.echecs} en échec)` : ""}.` });
    } finally { setBusy(false); }
  };
  const recevront = estimation?.recevront ?? 0;
  const emailPossible = audience === "une" && repli && (estimation?.email?.adresses || 0) > 0;
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

  const envoyer = async () => {
    const nomDest = audience === "une" ? choix[0]?.nom || `CIP ${choix[0]?.cip}` : null;
    const cible = audience === "une" ? `«\u00a0${nomDest}\u00a0»` : pluriel(recevront, "pharmacie");
    if (quand === "programmer") {
      const t = Date.parse(programmeIso);
      if (!window.confirm(`Programmer «\u00a0${msg.titre}\u00a0» (${TYPES_MESSAGE[type].libelle}) pour le ${jourLong(programmeIso)} (heure de Paris)\u00a0?\n\nDestinataires calculés à l'heure d'envoi. Vous pourrez l'annuler jusque-là dans l'historique.`)) return;
      if (horsHeures(t) && !window.confirm(`Le ${jourLong(programmeIso)} tombe ${motifHorsHeures(t)} (heure de Paris)\u00a0: les pharmacies le recevront à ce moment-là, sur leur téléphone. Programmer quand même\u00a0?`)) return;
    } else {
      const h = Date.now();
      const secours = audience === "une" && repli ? "\n\nSi la pharmacie n'est jointe sur aucun appareil, l'e-mail de secours part aux adresses de son compte." : "";
      if (!window.confirm(`Envoyer «\u00a0${msg.titre}\u00a0» (${TYPES_MESSAGE[type].libelle}) à ${cible} maintenant\u00a0?${secours}\n\nCe n'est pas annulable.`)) return;
      if (horsHeures(h) && !window.confirm(`Il est ${texteHeureParis(h)} (heure de Paris)${partiesParis(h).jourSemaine === "dimanche" ? ", un dimanche" : ""}\u00a0: la pharmacie le recevra tout de suite, sur son téléphone. Envoyer quand même\u00a0?`)) return;
    }
    setBusy(true); setMessage(null); setSuivi(null);
    try {
      const r = await appeler("envoyer", { message: msg, idem: idem.current });
      if (r.statut === 202 || (r.ok && (r.corps.deja || r.corps.programmee))) {
        idem.current = nouvelleCle();
        const a = r.corps.annonce;
        flash(r.corps.programmee ? `✓ Message programmé pour le ${dt(a?.programme_pour)}` : "✓ Message parti\u00a0: suivez son envoi dans l'historique");
        setTitre(""); setCorps(""); setModele("");
        setMessage({ ton: "ok", texte: r.corps.deja ? "Ce message était déjà parti (double clic)\u00a0: rien n'a été envoyé deux fois."
          : r.corps.programmee ? `Programmé pour le ${jourLong(a?.programme_pour)} (heure de Paris). Annulable dans l'historique jusqu'à l'envoi.`
          : "Message parti\u00a0: l'envoi prend quelques secondes (historique ci-dessous)." });
        if (!r.corps.programmee && !r.corps.deja && a?.id && audience !== "toutes") setSuivi({ id: a.id, fini: false });
        await onEnvoye();
        return;
      }
      setMessage({ ton: "danger", texte: r.corps.error === "en_cours" ? "Un message plafonné (offre ou information) est en cours d'envoi\u00a0: attendez qu'il soit terminé, ou programmez celui-ci."
        : r.corps.error === "fermee" ? "Ouverture «\u00a0fermée\u00a0»\u00a0: aucune pharmacie ne reçoit encore les notifications (voir «\u00a0Ouverture aux pharmacies\u00a0»). Un message unitaire avec e-mail de secours peut partir."
        : r.corps.error === "lancement" ? "Le message est enregistré mais l'envoi n'a pas démarré\u00a0: il est relancé automatiquement dans les 5 minutes (ou «\u00a0Relancer\u00a0» dans l'historique)."
        : r.corps.error === "trop_de_programmes" ? "50 messages programmés au plus\u00a0: annulez-en un dans l'historique."
        : r.corps.error === "configuration" ? "Service incomplet\u00a0: terminez la mise en service." : (r.corps.erreurs || [r.corps.message || `Erreur (HTTP ${r.statut})`]).join(" ") });
      if (r.corps.error === "lancement") await onEnvoye();
    } finally { setBusy(false); }
  };

  // modèles enregistrés
  const [nomModele, setNomModele] = useState(null);   // null : fermé ; texte : saisie du nom
  const enregistrerModele = async () => {
    const r = await appeler("modele_enregistrer", { modele: { nom: nomModele, type, titre: titre.trim(), corps: corps.trim(), url: lien || "/" } });
    if (r.ok) { flash("✓ Modèle enregistré"); setNomModele(null); await onModeles(); setModele(r.corps.modele?.id || ""); return; }
    flash(r.corps.error === "doublon" ? "⚠ Un modèle porte déjà ce nom" : r.corps.error === "trop" ? "⚠ 100 modèles au plus : supprimez-en un"
      : `⚠ ${(r.corps.erreurs || [r.corps.message || r.corps.error || `HTTP ${r.statut}`]).join(" ")}`);
  };
  const supprimerModele = async () => {
    if (!persoChoisi || !window.confirm(`Supprimer le modèle «\u00a0${persoChoisi.nom}\u00a0»\u00a0? Les messages déjà envoyés ne changent pas.`)) return;
    const r = await appeler("modele_supprimer", { id: persoChoisi.id });
    flash(r.ok ? "✓ Modèle supprimé" : "⚠ Suppression impossible");
    setModele(""); await onModeles();
  };

  const champ = { ...ui.input, fontSize: 13 };
  const optionsAudience = [["une", "Une pharmacie"], ["liste", "Plusieurs pharmacies"],
    ["toutes", "Toutes les pharmacies abonnées", transactionnel, transactionnel ? "Réclamation / SAV et Commande : une ou quelques pharmacies seulement" : undefined]];
  const libelleBouton = busy ? "Envoi…" : quand === "programmer" ? (programmeIso ? `Programmer pour le ${dt(programmeIso)}` : "Programmer")
    : audience === "une" ? (recevront ? "Envoyer à cette pharmacie" : emailPossible ? "Envoyer (e-mail de secours)" : "Envoyer")
    : `Envoyer à ${pluriel(recevront, "pharmacie")}`;
  return (
    <Section id="notif-message" titre="Nouveau message">
      {!etat.disponible && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>Service incomplet&nbsp;: le message ne peut pas partir.</div>}
      {etat.service?.tables && etat.service?.tables_messages === false && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>Exécutez sql/push-messages.sql dans Supabase (types, modèles, programmation, historique)&nbsp;: sans lui, les messages ne peuvent pas être enregistrés.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={ui.label}>Type de message</div>
          <Segment etiquette="Type de message" valeur={type} onChange={(t) => { setType(t); setModele(""); }} options={IDS_TYPES.map((k) => [k, TYPES_MESSAGE[k].libelle])} />
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
          {nomModele == null ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Bouton onClick={() => setNomModele(titre.trim().slice(0, NOM_MODELE_MAX))} disabled={!titre.trim() || !corps.trim() || !lien}>Enregistrer comme modèle</Bouton>
              {persoChoisi && <button type="button" className="ex-lien-danger" onClick={supprimerModele} style={{ ...ui.btn("lien"), fontSize: 12.5, fontWeight: 600 }}>Supprimer ce modèle</button>}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "1 1 260px" }}>
              <input value={nomModele} onChange={(e) => setNomModele(e.target.value)} maxLength={NOM_MODELE_MAX} aria-label="Nom du modèle" placeholder="Nom du modèle"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enregistrerModele(); } }} style={{ ...champ, flex: "1 1 160px", minHeight: 36 }} />
              <Bouton principal onClick={enregistrerModele} disabled={!nomModele.trim()}>Enregistrer</Bouton>
              <Bouton onClick={() => setNomModele(null)}>Annuler</Bouton>
            </div>
          )}
        </div>
        <div style={sourdine}>Les champs entre crochets («&nbsp;[référence]&nbsp;», «&nbsp;[date]&nbsp;») sont à remplacer avant l'envoi. Un modèle enregistré est partagé entre les admins.</div>

        <div style={{ display: "grid", gridTemplateColumns: grille(320), gap: 18, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div>
              <label htmlFor="notif-titre-annonce" style={ui.label}>Titre</label>
              <input id="notif-titre-annonce" value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={LIMITES.titre + 10}
                placeholder={transactionnel ? "Réclamation traitée" : "Vaseline\u00a0: précommande ouverte"} style={champ} />
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
                    : chemin ? <span style={{ color: T.danger }}>Lien refusé (CIP de 7 à 14 chiffres, menu ou outil du site)</span> : "Choisissez la page à ouvrir."}
                </div>
              </div>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={ui.label}>Aperçu</div>
            <div style={{ display: "grid", gridTemplateColumns: grille(250), gap: 12 }}>
              <ApercuAndroid titre={msg.titre} corps={msg.corps} />
              <ApercuIphone titre={msg.titre} corps={msg.corps} />
            </div>
            <p style={{ ...sourdine, margin: "8px 0 0" }}>Coupures simulées&nbsp;: titre sur une ligne et texte sur deux lignes sous Android (notification repliée), texte sur quatre lignes sur iPhone.</p>
          </div>
        </div>

        <div>
          <div style={ui.label}>Destinataires</div>
          <Segment etiquette="Destinataires" valeur={audience} onChange={setAudience} options={optionsAudience} />
          {audience !== "toutes" && <ChoixDestinataires appeler={appeler} etat={etat} audience={audience} categorie={categorie} choix={choix} setChoix={setChoix}
            max={audience === "une" ? 1 : transactionnel ? MAX_LISTE_TRANSACTIONNEL : 500} />}
          {audience === "une" && (
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, fontSize: 13, lineHeight: 1.45, cursor: "pointer", color: T.ink }}>
              <input type="checkbox" checked={repli} onChange={(e) => setRepli(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
              <span><b>Si la pharmacie n'est pas joignable sur téléphone, envoyer aussi par e-mail</b>
                <span style={{ display: "block", ...sourdine }}>Aux adresses de connexion de son compte (jamais l'e-mail de la fiche Odoo, parfois partagé avec une autre officine). {type === "promotion" || type === "communication"
                  ? "Pas d'e-mail si elle a coupé cette alerte sur ses appareils ou si le plafond l'écarte." : "Pas d'e-mail si le plafond de sécurité l'écarte."}</span></span>
            </label>
          )}
          <Estimation estimation={estimation} audience={audience} categorie={categorie} repli={audience === "une" && repli} transactionnel={transactionnel} />
        </div>

        <div>
          <div style={ui.label}>Envoi</div>
          <Segment etiquette="Moment de l'envoi" valeur={quand} onChange={setQuand} options={[["maintenant", "Maintenant"], ["programmer", "Programmer"]]} />
          {quand === "programmer" && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label htmlFor="notif-date" style={{ fontSize: 13, color: T.ink }}>Le</label>
              <input id="notif-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} min={isoVersParis(new Date(Date.now() + 5 * 60e3).toISOString())}
                style={{ ...champ, width: "auto", minHeight: 36, padding: "5px 10px" }} />
              <span style={sourdine}>heure de Paris{programmeIso && horsHeures(Date.parse(programmeIso)) ? <b style={{ color: tone("warn").fg }}> · {motifHorsHeures(Date.parse(programmeIso))}</b> : null}</span>
              {!dateValide && <span style={{ ...sourdine, color: T.danger }}>{programmeIso ? "Au moins 5 minutes à l'avance." : "Date ou heure illisible (ou inexistante au changement d'heure)."}</span>}
              <div style={{ ...sourdine, flexBasis: "100%" }}>Envoyé au plus 5 minutes après l'heure choisie, destinataires et plafonds calculés à ce moment-là. Annulable dans l'historique jusqu'à l'envoi.</div>
            </div>
          )}
        </div>
      </div>
      {!v.ok && (titre || corps) && <div style={{ marginTop: 12 }}><Erreur texte={v.erreurs.join(" ")} /></div>}
      {message && <div role={message.ton === "danger" ? "alert" : "status"} style={{ ...ui.encart(message.ton), marginTop: 12 }}>{message.texte}</div>}
      {suivi && <SuiviEnvoi suivi={suivi} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <Bouton onClick={apercu} disabled={busy || !msg.titre || !msg.corps || !lien || !etat.disponible || aCompleter.length > 0}><Icone nom="envoyer" taille={15} />M'envoyer l'aperçu</Bouton>
        <Bouton principal onClick={envoyer} disabled={bloque} style={bloque ? inactif : undefined}>
          {quand === "programmer" ? <Icone nom="horloge" taille={15} /> : null}{libelleBouton}
        </Bouton>
      </div>
    </Section>
  );
}

// Estimation des destinataires (lecture seule, mise à jour en direct)
function Estimation({ estimation: e, audience, categorie, repli, transactionnel }) {
  if (e == null) return <div role="status" style={{ ...sourdine, marginTop: 8 }}>Estimation…</div>;
  if (e.vide) return <div role="status" style={{ ...sourdine, marginTop: 8 }}>Choisissez {audience === "une" ? "la pharmacie" : "les pharmacies"}.</div>;
  if (e.erreur) return <div role="status" style={{ ...sourdine, marginTop: 8, color: T.danger }}>Estimation impossible pour le moment.</div>;
  const plafond = e.plafond;
  const lignes = [];
  if (e.fermee) lignes.push("Ouverture «\u00a0fermée\u00a0»\u00a0: aucune pharmacie ne recevra de notification.");
  else {
    lignes.push(e.recevront ? `${pluriel(e.recevront, "pharmacie")} recevr${e.recevront > 1 ? "ont" : "a"} la notification (${pluriel(e.appareils, "appareil")}).`
      : "Aucune pharmacie ne recevra la notification.");
    if (e.plafonnees) lignes.push(`${pluriel(e.plafonnees, "pharmacie écartée", "pharmacies écartées")} par le plafond (${plafond?.max} «\u00a0${CATS[categorie]}\u00a0» sur ${plafond?.fenetre}).`);
    const non = [];
    if (e.sans_appareil) non.push(audience === "toutes" ? `${pluriel(e.sans_appareil, "pharmacie cliente", "pharmacies clientes")} sans notifications activées` : `${pluriel(e.sans_appareil, "pharmacie")} sans appareil`);
    if (e.alerte_coupee) non.push(`${pluriel(e.alerte_coupee, "pharmacie")} avec l'alerte «\u00a0${CATS[categorie]}\u00a0» coupée`);
    if (e.hors_ouverture) non.push(`${pluriel(e.hors_ouverture, "pharmacie")} hors pilote`);
    if (non.length) lignes.push(`Non joignables${audience === "toutes" ? "" : " parmi les choisies"}\u00a0: ${non.join(", ")}.`);
  }
  if (audience === "une" && repli) {
    const m = e.email;
    lignes.push(!m ? "" : m.adresses ? `E-mail de secours possible\u00a0: ${pluriel(m.adresses, "adresse")} du compte (${m.masquees.join(", ")}).`
      : "E-mail de secours impossible\u00a0: aucune adresse de compte pour cette pharmacie.");
  }
  if (transactionnel && plafond) lignes.push(`Plafond de sécurité\u00a0: ${plafond.max} messages «\u00a0${CATS.commandes}\u00a0» par pharmacie sur ${plafond.fenetre}.`);
  return <div role="status" style={{ ...sourdine, marginTop: 10, color: T.ink, display: "flex", flexDirection: "column", gap: 2 }}>{lignes.filter(Boolean).map((l) => <span key={l}>{l}</span>)}</div>;
}

// Suivi d'un message unitaire (ou d'une petite liste) juste après l'envoi
function SuiviEnvoi({ suivi }) {
  const a = suivi.annonce;
  if (!suivi.fini) return <div role="status" style={{ ...ui.encart("info"), marginTop: 10 }}>Envoi en cours…</div>;
  if (!a) return <div role="status" style={{ ...ui.encart("warn"), marginTop: 10 }}>L'envoi prend plus de temps que prévu&nbsp;: suivez-le dans l'historique.</div>;
  if (a.statut === "erreur") return <div role="alert" style={{ ...ui.encart("danger"), marginTop: 10 }}>Non envoyé&nbsp;: {a.erreur || "erreur"}</div>;
  const joints = a.nb_reussis || 0;
  const email = a.email_statut ? EMAILS[a.email_statut]?.[0] : null;
  return (
    <div role="status" style={{ ...ui.encart(joints || a.email_statut === "envoye" ? "ok" : "warn"), marginTop: 10 }}>
      {joints ? `Envoyé\u00a0: ${pluriel(joints, "appareil joint", "appareils joints")}${a.nb_echecs ? `, ${a.nb_echecs} en échec` : ""}.`
        : `Aucun appareil joint${a.nb_plafonnees ? " (plafond atteint)" : ""}.`}
      {email ? ` E-mail de secours\u00a0: ${email}${a.email_statut === "envoye" && a.nb_emails ? ` (${pluriel(a.nb_emails, "adresse")})` : ""}.` : ""}
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
      {" · "}{p.adresses ? `e-mail de secours\u00a0: ${(p.adresses_masquees || []).join(", ")}` : "aucune adresse de compte"}
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
const RELANCE_MAX_MS = 24 * 3600e3;
const ERREURS_RELANCE = { trop_tot: "⚠ Attendez 2 minutes avant de relancer", trop_ancienne: "⚠ Message de plus de 24 h\u00a0: recomposez-le plutôt que de le relancer",
  en_cours: "⚠ Un autre message plafonné est en cours d'envoi\u00a0: relancez quand il sera terminé" };
function Historiques({ annonces, etat, appeler, flash, onChange, promos, sections }) {
  const [vue, setVue] = useState("messages");
  return (
    <Section id="notif-historique" titre="Historique" droite={<Segment etiquette="Historique" valeur={vue} onChange={setVue}
      options={[["messages", "Messages"], ["pharmacie", "Par pharmacie"], ["entrepot", "Outil entrepôt"]]} />}>
      {vue === "messages" ? <HistoriqueMessages annonces={annonces} appeler={appeler} flash={flash} onChange={onChange} promos={promos} sections={sections} />
        : vue === "pharmacie" ? <HistoriquePharmacie appeler={appeler} etat={etat} />
        : <HistoriqueEntrepot appeler={appeler} />}
    </Section>
  );
}
const destinatairesDe = (a) => (a.audience === "une" ? (a.destinataire_nom || `CIP ${a.cips?.[0] || "?"}`) : a.audience === "liste" ? pluriel(a.nb_cips || 0, "pharmacie choisie", "pharmacies choisies") : "toutes");
function HistoriqueMessages({ annonces, appeler, flash, onChange, promos, sections }) {
  const [busy, setBusy] = useState(false);
  const relancer = async (a) => {
    setBusy(true);
    try {
      const r = await appeler("relancer", { id: a.id });
      flash(r.statut === 202 ? "✓ Envoi relancé" : ERREURS_RELANCE[r.corps.error] || `⚠ Relance impossible (${r.corps.error || r.statut})`);
      await onChange();
    } finally { setBusy(false); }
  };
  const annuler = async (a) => {
    if (!window.confirm(`Annuler «\u00a0${a.titre}\u00a0», programmé pour le ${jourLong(a.programme_pour)}\u00a0? Il ne partira pas.`)) return;
    setBusy(true);
    try {
      const r = await appeler("annuler", { id: a.id });
      flash(r.ok ? "✓ Message annulé\u00a0: il ne partira pas" : "⚠ Trop tard\u00a0: le message est déjà parti (ou en cours d'envoi)");
      await onChange();
    } finally { setBusy(false); }
  };
  if (annonces == null) return <div role="status" style={sourdine}>Chargement…</div>;
  if (!annonces.length) return <p style={{ ...sourdine, margin: 0 }}>Aucun message envoyé.</p>;
  return (
    <>
      <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={thS}>Date</th><th style={thS}>Type</th><th style={thS}>Message</th><th style={thS}>Destinataires</th>
            <th style={thS} title="Pharmacies : visées / écartées par le plafond / servies · Appareils : réussis / échecs / retirés">Résultat</th><th style={thS}>Statut</th>
          </tr></thead>
          <tbody>
            {annonces.map((a) => {
              const [l, t] = STATUTS[a.statut] || [a.statut, "neutral"];
              const age = Date.now() - Date.parse(a.created_at);
              const relancable = a.statut === "en_file" && age >= 2 * 60e3 && age <= RELANCE_MAX_MS;
              const [lE, tE] = a.repli_email ? (EMAILS[a.email_statut] || ["prévu", "neutral"]) : [null, null];
              return (
                <tr key={a.id} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                  <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}>{a.statut === "programmee" ? <>prévu le<br />{dt(a.programme_pour)}</> : dt(a.created_at)}</td>
                  <td style={tdS}><BadgeType type={a.type} /></td>
                  <td style={{ ...tdS, minWidth: 220, maxWidth: 340 }}><b>{a.titre}</b><div style={{ color: T.inkSoft, overflowWrap: "anywhere" }}>{a.corps}</div>
                    <div style={{ color: T.inkMute, marginTop: 3, overflowWrap: "anywhere" }} title={a.url}>Lien&nbsp;: {libelleLien(a.url, promos, sections)}</div></td>
                  <td style={{ ...tdS, minWidth: 110 }}>{destinatairesDe(a)}</td>
                  <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}>
                    {a.statut === "programmee" || a.statut === "annulee" ? "—" : <>
                      <div>Pharmacies&nbsp;: {a.nb_visees ?? "–"} / {a.nb_plafonnees ?? "–"} / {a.nb_pharmacies ?? "–"}</div>
                      <div>Appareils&nbsp;: {a.nb_reussis ?? "–"} / {a.nb_echecs ?? "–"} / {a.nb_retires ?? "–"}</div></>}
                    {lE && <div style={{ marginTop: 4 }}><span style={ui.badge(tE)}>{lE}{a.email_statut === "envoye" && a.nb_emails ? ` (${a.nb_emails})` : ""}</span></div>}
                  </td>
                  <td style={tdS}>
                    <span style={ui.badge(t)}>{l}</span>
                    {a.erreur && <div style={{ color: a.statut === "erreur" ? T.danger : T.inkSoft, marginTop: 4 }}>{a.erreur}</div>}
                    {a.statut === "annulee" && a.annule_at && <div style={{ color: T.inkSoft, marginTop: 4 }}>le {dt(a.annule_at)}</div>}
                    {a.statut === "programmee" && <button type="button" onClick={() => annuler(a)} disabled={busy} className="ex-btn-ligne" style={{ ...ui.btn("ligne", "s"), marginTop: 6 }}>Annuler</button>}
                    {relancable && <button type="button" onClick={() => relancer(a)} disabled={busy} className="ex-btn-ligne" style={{ ...ui.btn("ligne", "s"), marginTop: 6 }}>Relancer</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ ...sourdine, margin: "8px 0 0" }}>Résultat&nbsp;: pharmacies visées / écartées par le plafond / servies (au moins un appareil joint)&nbsp;; appareils réussis / échecs / retirés (plus joignables)&nbsp;; e-mail de secours d'un message unitaire. Un message resté «&nbsp;En file&nbsp;» est relancé automatiquement toutes les 5 minutes pendant 24 heures.</p>
    </>
  );
}

// Envois d'une pharmacie (90 jours) : messages de l'admin, retours en stock, outil entrepôt
export function ListeEnvois({ envois, compact = false }) {
  if (!envois.length) return <p style={{ ...sourdine, margin: 0 }}>Aucune notification envoyée à cette pharmacie ces 90 derniers jours.</p>;
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
          {res.map((p) => <button key={p.cip} type="button" className="ex-btn-ligne" aria-pressed={cip === p.cip} onClick={() => setCip(p.cip)} style={ui.btn("ligne", "s")}>{p.nom || "—"} · {p.cip}</button>)}
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
function HistoriqueEntrepot({ appeler }) {
  const [evts, setEvts] = useState(null);
  useEffect(() => { let annule = false; appeler("evenements").then((r) => { if (!annule) setEvts(r.ok ? r.corps.evenements || [] : []); }, () => { if (!annule) setEvts([]); }); return () => { annule = true; }; }, [appeler]);
  if (evts == null) return <div role="status" style={sourdine}>Chargement…</div>;
  return (
    <>
      {!evts.length ? <p style={{ ...sourdine, margin: 0 }}>Aucun événement reçu de l'outil entrepôt (API push-evenement, docs/notifications.md §&nbsp;6).</p> : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead><tr><th style={thS}>Reçu le</th><th style={thS}>CIP</th><th style={thS}>Type</th><th style={thS}>Statut</th><th style={thS}>Référence</th><th style={thS}>Notification</th><th style={thS}>Résultat</th></tr></thead>
            <tbody>
              {evts.map((e) => (
                <tr key={e.cle} className="ex-tr" style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                  <td className="num" style={{ ...tdS, whiteSpace: "nowrap" }}>{dt(e.recu_le)}</td>
                  <td className="num" style={tdS}>{e.pharmacy_cip}</td>
                  <td style={tdS}>{{ reclamation: "Réclamation", ticket: "Ticket", commande: "Commande" }[e.type] || e.type}</td>
                  <td style={tdS}>{e.statut}</td>
                  <td className="num" style={tdS}>{e.reference || "—"}</td>
                  <td style={{ ...tdS, maxWidth: 220 }}>{e.titre || "—"}</td>
                  <td style={tdS}><span style={ui.badge(e.resultat === "envoye" ? "ok" : e.resultat ? "warn" : "neutral")}>{RESULTATS[e.resultat] || e.resultat || "en cours"}</span>
                    {e.nb_appareils != null && <div className="num" style={{ color: T.inkSoft, marginTop: 3 }}>{e.nb_reussis ?? 0} / {e.nb_appareils} appareil{e.nb_appareils > 1 ? "s" : ""}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ ...sourdine, margin: "8px 0 0" }}>Notifications automatiques «&nbsp;Mes commandes et réclamations&nbsp;» déclenchées par l'outil entrepôt (Réclamations, Tickets). Un même statut d'une même référence n'est notifié qu'une fois.</p>
    </>
  );
}

// ── Bloc « Notifications envoyées » de la fiche pharmacie (onglet 🏥 Pharmacies) ──
// cip : CIP de la fiche en cours d'édition (lu 600 ms après la dernière frappe) ; lecture seule
export function NotificationsEnvoyees({ adminFetch, cip }) {
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
  return (
    <section aria-labelledby="pharm-notif-titre" style={{ background: T.surface, borderRadius: 12, padding: 16, border: "1.5px solid var(--line)", marginTop: 16 }}>
      <div id="pharm-notif-titre" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <Icone nom="cloche" taille={16} />Notifications envoyées <span style={{ fontWeight: 400, fontSize: 12, color: T.inkMute }}>(90 derniers jours · détail et envoi dans 📲 Notifications)</span>
      </div>
      {donnees == null ? <div role="status" style={sourdine}>Chargement…</div>
        : donnees.erreur ? <div style={sourdine}>Lecture impossible (service des notifications pas encore en place&nbsp;?).</div>
        : <><ResumeAppareils a={donnees.appareils} adresses={donnees.adresses} /><ListeEnvois envois={(donnees.envois || []).slice(0, 20)} compact /></>}
    </section>
  );
}
