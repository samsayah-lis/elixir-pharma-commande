import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { applyTiers, TierBadge } from "./tiers.jsx";
import { CrossSellBanner, ReorderSuggestion } from "./components/MLRecommendations";
import OrderEntry from "./components/OrderEntry";
import ShortExpiry from "./components/ShortExpiry";
import WheelchairOrder from "./components/WheelchairOrder";
import LabJustifOrder from "./components/LabJustifOrder";
import { allocate } from "./wheelchair-logic.js";
import { loadGroups, codeOfCip, collapseGroups } from "./product-groups.js";
import GroupOrders from "./components/GroupOrders";
import MyOrdersPanel from "./components/MyOrdersPanel";
import CompteARebours from "./components/CompteARebours";
import JustifCartBlock from "./components/JustifCartBlock";
import { loadJustifProducts, justifIssues, submitJustif, needsJustif, freshPharmacyToken, qtyByCip, rxFrais } from "./lab-justif-client.js";
// Renouvellement des jetons (un seul échange à la fois, partagé avec l'Assistant Elixir) : src/jetons.js
import { renouvelerUneFois, renouvelleAdmin } from "./jetons.js";
import { T, R, tone, ui, alpha, fmtEur, fmtPct as fmtPctFr } from "./theme.js";
import { Icone, CroixElixir, ICONES_RAYON } from "./icons.jsx";
import EnteteVue, { CompteurVue } from "./components/ui/EnteteVue.jsx";
import EtatVide, { ActionEtat, SqueletteCatalogue, Chargement } from "./components/ui/EtatVide.jsx";
import BadgeStatut from "./components/ui/BadgeStatut.jsx";
import CipCell from "./components/ui/CipCell.jsx";
import FocusFenetre from "./components/ui/FocusFenetre.jsx";
// Assistant Elixir (docs/assistant-conception.md § 1) : panneau chargé à la demande, seuls le bouton et l'état d'ouverture ici
import { PanneauAssistant, GroupeAide, CoucheAssistant } from "./components/assistant/Entree.jsx";
import { authAssistant, etatAssistant } from "./assistant-client.js";
// Admin (#admin) chargé à la demande, avec ses outils et la bibliothèque xlsx qu'il est seul à utiliser : hors du bundle
// des pharmacies (budget du bundle, docs/refonte-charte.md § 7 ; docs/labo-otc.md). Échec du chargement (connexion,
// ou nouvelle version mise en ligne pendant que la page était ouverte) : message et rechargement, admin non déconnecté
const AdminPanel = React.lazy(() => import("./AdminPanel").catch(() => ({ default: AdminIndisponible })));
// Page d'accueil « La Tête de gondole » (docs/accueil.md) : chunk Accueil-* chargé à la demande ; ici, le préchargement
// (chunk + GET des offres), le squelette et l'écran « nouvelle version » seulement
import { lireOffres } from "./components/accueil/precharge.js";
import SqueletteAccueil, { AccueilIndisponible } from "./components/accueil/Squelette.jsx";
const Accueil = React.lazy(() => import("./components/accueil/Accueil.jsx").catch(() => ({ default: AccueilIndisponible })));

const DEFAULT_RECIPIENT = "pharmacien@elixirpharma.fr";
// Envoi d'une commande refusé AVANT tout envoi (correctif de sécurité du 19/10/2026 : session vérifiée d'abord) :
// message par motif ; dans tous les cas rien n'est parti et le panier reste tel quel
const MESSAGE_ENVOI_BLOQUE = {
  reconnexion: "Reconnexion nécessaire : pour envoyer votre commande, reconnectez-vous avec le code reçu par e-mail. Rien n'est parti, votre panier est conservé.",
  fiche: "Aucune pharmacie n'est rattachée à ce compte : la commande ne peut pas partir. Contactez Elixir Pharma au 01 86 04 39 95 (votre panier est conservé).",
  admin: "Session admin expirée : ouvrez l'admin (#admin) pour vous reconnecter, puis renvoyez la commande",
  erreur: "Envoi impossible pour le moment (serveur injoignable) : rien n'est parti, votre panier est conservé. Réessayez dans un instant.",
  // annoncé avant tout envoi : session sans aucun jeton (ouverte avant la connexion par code, ou sans code)
  sansJeton: "Pour envoyer votre commande, confirmez votre session avec le code reçu par e-mail (session ouverte sans code). Votre panier est conservé.",
};
// Délai d'un appel : AbortSignal.timeout n'existe pas avant Safari 16 (iPad iOS 15, Mac Safari 15), Chrome 103, Firefox 100 ;
// sans lui, l'appel part sans délai (comme product-groups.js) au lieu d'échouer avant même d'être envoyé
const delai = (ms) => (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(ms) } : {});

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error("[ErrorBoundary]", err, info); }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

const SECTION_META = {
  expert:   { label: "Sélection Expert",      subtitle: "Médicaments chers – Abandon de marge fixe 30€/boîte",        color: "#1a3a4a", accent: "#2d7d9a", icon: "💊", columns: ["CIP13","Désignation","Prix Vente","Remise €","Prix net"] },
  stratege: { label: "Sélection Stratège",     subtitle: "Cartons standard – Top 50 rotations nationales",              color: "#2d5a27", accent: "#4a9e42", icon: "📦", columns: ["CIP","Désignation","Colis","Prix","Remise %","Remise €","Prix net","Prix carton"] },
  master:   { label: "Sélection Master",       subtitle: "Parapharmacie – Top marques sélectionnées",                   color: "#7c3a00", accent: "#c2692d", icon: "🌿", columns: ["CIP","Désignation","Remise %","Remise €","PN"] },   // Palier et PV retirés (non fournis par le serveur) : décision de Zineb, 16/10/2026
  obeso:    { label: "Mounjaro / Wegovy",       subtitle: "Traitements de l'obésité",                                    color: "#4a1a7a", accent: "#8b5cf6", icon: "⚖️",  columns: ["CIP","Désignation","Qté","PV","Remise","PN"] },
  nr:       { label: "Autres NR",              subtitle: "Médicaments non remboursés",                                   color: "#1a3a5a", accent: "#3b82f6", icon: "🔵", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  molnlycke:{ label: "Offre Mölnlycke",        subtitle: "Matériel médical – pansements & soins",                        color: "#1a4a3a", accent: "#10b981", icon: "🩹", columns: ["CIP","Désignation","Colis","PV","Remise %","Remise €","PN","Prix carton"] },
  blanche:  { label: "Gamme Blanche",          subtitle: "Génériques & médicaments courants",                            color: "#3a3a3a", accent: "#6b7280", icon: "🏷️",  columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  covid:    { label: "Diagnostic & Covid",     subtitle: "Tests & traitements Covid",                                    color: "#1a2a5a", accent: "#6366f1", icon: "🧪", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  otc:      { label: "Centrale OTC / Para",    subtitle: "Vente libre & parapharmacie centrale",                         color: "#5a1a1a", accent: "#ef4444", icon: "🛒", columns: ["CIP","Désignation","PV","Remise %","Remise €","PN"] },
  ulabs:    { label: "Commande groupée U-Labs",       subtitle: "",       color: "#0d4f3c", accent: "#059669", icon: "🤝", columns: [], restrictedTo: [] },
  saisie:   { label: "Saisie de commande",  subtitle: "Recherche par CIP ou nom — stock temps réel Odoo", color: "#0f2d3d", accent: "#2d9cbc", icon: "📝", columns: [], specialView: "orderEntry" },
  peremption:{ label: "Péremption courte",  subtitle: "Produits à moins de 4 mois de péremption",         color: "#7c2d12", accent: "#ea580c", icon: "⏰", columns: [], specialView: "shortExpiry" },
  fauteuil: { label: "Fauteuil roulant",    subtitle: "Largeur d'assise → fauteuil Invacare, stock et prix Odoo", color: "#1e3a5f", accent: "#3b82f6", icon: "🦽", columns: [], specialView: "wheelchair" },
  transfert:{ label: "Fauteuil de transfert", subtitle: "Largeur d'assise → fauteuil de transfert Invacare (43 ou 45,5 cm)", color: "#1e3a5f", accent: "#3b82f6", icon: "🪑", columns: [], specialView: "transferChair" },
  justificatif:{ label: "Commande labo sur justificatif", subtitle: "Takeda, Pfizer… : commande transmise au laboratoire avec votre justificatif (ordonnance anonymisée)", color: "#2e1065", accent: "#7c3aed", icon: "📑", columns: [], specialView: "labJustif" },
};
// ── Coquille (refonte charte, lot 2) ──
// Icône d'un menu de la barre latérale : SVG pour un rayon connu resté à son icône d'origine ; une icône saisie
// dans l'admin (dc.icons, campagne…), un menu promo ou une section perso gardent leur emoji
const iconeMenu = (key, c, taille = 18) => {
  const nom = ICONES_RAYON[key];
  const origine = key === "groupees" ? "🤝" : SECTION_META[key]?.icon;
  return nom && c.icon === origine ? <Icone nom={nom} taille={taille} /> : c.icon;
};
// bouton rond de 36 px de l'en-tête pétrole (fond au survol : classe ex-icone-entete)
const btnEntete = { width: 36, height: 36, padding: 0, border: "none", borderRadius: R.pill, color: T.paper, cursor: "pointer",
  flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };
// ── Catalogue (refonte charte, lot 4) ──
// pastille de filtre de 32 px : fond et couleur posés par la classe ex-filtre selon aria-pressed (survol possible)
const filtreStyle = { ...ui.pill(false), background: undefined, color: undefined };
// ── Panier (refonte charte, lot 6) ──
// encart sous une ligne du panier (palier, contingentement, rupture…) : ton de theme.js, texte 12 px
const encart = (ton) => {
  const t = tone(ton);
  return { marginTop: 8, padding: "7px 10px", borderRadius: R.s, fontSize: 12, lineHeight: 1.45, background: t.bg, color: t.fg, border: `1px solid ${t.border}` };
};
const ligneEncart = { display: "flex", alignItems: "flex-start", gap: 6 };   // icône calée sur la première ligne du texte
const iconeEncart = { marginTop: 2 };
// boutons ronds de 28 px du panier (quantité, suppression) : fond et survol par les classes ex-qte-* / ex-btn-discret
const pasPanier = { width: 28, height: 28, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center" };
// boutons secondaires à filet (Imprimer, Copier) : survol par la classe ex-btn-ligne (un fond inline l'empêcherait)
const btnSecondaire = { ...ui.btn("ligne", "m"), background: undefined, width: "100%", height: 40, padding: "0 12px", boxShadow: `inset 0 0 0 1.5px ${T.lineField}` };
// Montants au format français (« 3 630,04 € ») : affichage seulement — l'e-mail, le texte copié et les données envoyées
// gardent leurs toFixed() d'origine (docs/refonte-charte.md § 0)
const fmt = (n) => fmtEur(n);
// Panier persisté : celui de la session (localStorage) ou, en saisie Elixir, celui de la pharmacie servie
// (sessionStorage de l'onglet, une clé par fiche) — jamais l'un pour l'autre
const cartKeys = (a) => a ? [`acting_cart_q_${a.odoo_id}`, `acting_cart_s_${a.odoo_id}`, `acting_cart_j_${a.odoo_id}`] : ["cart_quantities", "cart_special", "cart_justif"];
const cartStore = (a) => a ? sessionStorage : localStorage;
const readCart = (a) => {
  const [kq, ks, kj] = cartKeys(a);
  const rd = (k, d) => { try { const v = JSON.parse(cartStore(a).getItem(k) || d); return v && typeof v === "object" ? v : JSON.parse(d); } catch { return JSON.parse(d); } };
  // justificatifs labo (attestation, ordonnances déposées) par CIP ; un dépôt interrompu est retiré
  const j = rd(kj, "{}");
  for (const c of Object.keys(j)) j[c] = { ...j[c], rx: (Array.isArray(j[c]?.rx) ? j[c].rx : []).filter(rxFrais) };   // expirées : à redéposer
  return [rd(kq, "{}"), rd(ks, "[]"), j];
};
// Contingentement (quota Odoo par période) : lignes du panier au-delà du reste autorisé.
// Plusieurs lignes d'un même CIP sont additionnées.
const quotaOver = (quota, items) => {
  const P = quota && !quota.exempt ? (quota.products || {}) : {};
  const inCart = {};
  for (const i of items) if (i.cip && P[i.cip]) inCart[i.cip] = (inCart[i.cip] || 0) + i.qty;
  const over = Object.entries(inCart).filter(([c, n]) => n > P[c].remaining).map(([c, n]) => ({ cip: c, qty: n, ...P[c] }));
  return { P, inCart, over };
};
const quotaDay = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";

// ── Display config (ordre + visibilité des onglets, paramètres visuels) ──
function getDisplayConfig() {
  try { return JSON.parse(localStorage.getItem("display_config") || "{}"); } catch { return {}; }
}
function getOrderedTabs(catalog) {
  const config = getDisplayConfig();
  const allKeys = Object.keys(catalog).filter(k => !catalog[k].hidden);
  const order = config.tabOrder || allKeys;
  const hidden = new Set(config.hiddenTabs || []);
  // Ordre config d'abord, puis les clés restantes non listées
  const ordered = order.filter(k => allKeys.includes(k) && !hidden.has(k));
  allKeys.forEach(k => { if (!ordered.includes(k) && !hidden.has(k)) ordered.push(k); });
  return ordered;
}
// Jours fériés France (récurrents + Pâques/Ascension/Pentecôte calculés)
const getFrenchHolidays = (year) => {
  // Pâques (algorithme de Meeus/Jones/Butcher)
  const a = year % 19, b = Math.floor(year/100), c = year % 100;
  const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
  const i = Math.floor(c/4), k = c % 4;
  const l = (32+2*e+2*i-h-k) % 7;
  const m = Math.floor((a+11*h+22*l)/451);
  const month = Math.floor((h+l-7*m+114)/31);
  const day = ((h+l-7*m+114) % 31) + 1;
  const easter = new Date(year, month-1, day);
  const d1 = (dt, dd) => { const x = new Date(dt); x.setDate(x.getDate()+dd); return x; };
  return [
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`,
    `${year}-07-14`, `${year}-08-15`, `${year}-11-01`,
    `${year}-11-11`, `${year}-12-25`,
    // Pâques + lundi, Ascension, Pentecôte + lundi
    d1(easter,1).toISOString().slice(0,10),
    d1(easter,39).toISOString().slice(0,10),
    d1(easter,49).toISOString().slice(0,10),
    d1(easter,50).toISOString().slice(0,10),
  ];
};

const nextBusinessDay = () => {
  const now = new Date();
  const d = new Date(now);
  // Toujours au minimum J+1
  d.setDate(d.getDate() + 1);
  // Commande après 14h → J+2 minimum
  if (now.getHours() >= 14) d.setDate(d.getDate() + 1);
  const holidays = [...getFrenchHolidays(d.getFullYear()), ...getFrenchHolidays(d.getFullYear() + 1)];
  let safety = 0;
  while (safety++ < 14) {
    const day = d.getDay();
    const iso = d.toISOString().slice(0,10);
    if (day !== 0 && day !== 6 && !holidays.includes(iso)) break;
    d.setDate(d.getDate() + 1);
  }
  return d.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
};

// ── Constantes U-Labs ────────────────────────────────────────────────────────
// ── Helpers campagne dynamique ────────────────────────────────────────────────
// Cache de regex compilées pour éviter de recompiler à chaque render (PERF-05)
const _rxCache = new Map();
const getCachedRx = (pattern) => {
  if (_rxCache.has(pattern)) return _rxCache.get(pattern);
  try { const rx = new RegExp(pattern, "i"); _rxCache.set(pattern, rx); return rx; }
  catch { _rxCache.set(pattern, null); return null; }
};
// Construit le tableau de groupes depuis la config Supabase avec fallback vide
const buildGroupes = (campaign) => {
  if (!campaign?.groupes?.length) return [];
  return campaign.groupes.map(g => {
    const rx = g.match_regex ? getCachedRx(g.match_regex) : null;
    return {
      ...g,
      match: (p) => rx ? rx.test(p.name) : false,
      gratuite: g.gratuite_type && g.gratuite_type !== "aucune"
        ? { type: g.gratuite_type, condition: g.gratuite_condition || "" }
        : null,
    };
  });
};

// Trouve le groupe d'un produit (renvoie l'objet groupe ou null)
const campGetGroupe = (p, groupes) => {
  for (const g of groupes) { if (g.match(p)) return g; }
  return null;
};

// Calcule les gratuités dynamiquement depuis la config campagne
const campGratuite = (p, qty, allProducts, quantities, tabKey, groupes) => {
  if (qty < 1) return { livrées: 0, type: null };
  const groupe = campGetGroupe(p, groupes);
  if (!groupe?.gratuite) return { livrées: 0, type: null };

  // Condition optionnelle : regex sur les produits déjà commandés
  if (groupe.gratuite.condition) {
    try {
      const condRegex = new RegExp(groupe.gratuite.condition, "i");
      const condOk = (allProducts || []).some((ap, idx) =>
        condRegex.test(ap.name) && (parseInt(quantities[`${tabKey}-${idx}`]) || 0) > 0
      );
      if (!condOk) return { livrées: 0, type: null, hint: `Commandez d'abord : ${groupe.gratuite.condition}` };
    } catch(e) {}
  }

  if (groupe.gratuite.type === "6+2" && qty >= 6) return { livrées: Math.floor(qty / 6) * 2, type: "6+2" };
  if (groupe.gratuite.type === "3+1" && qty >= 3) return { livrées: Math.floor(qty / 3), type: "3+1" };
  return { livrées: 0, type: groupe.gratuite.type };
};

// Couleurs de conditions affichées dans le header de groupe (refonte charte, lot 4 : tons { bg, fg, border } de
// src/theme.js ; obligatoire en sarcelle, comme le justificatif et la précommande)
const COND_COLORS = {
  "aucune": tone("neutral"),
  "6+2":    tone("ok"),
  "3+1":    tone("info"),
  "oblig":  tone("labo"),
};

const GRID_SECTIONS = ["otc", "molnlycke", "obeso", "covid", "blanche", "nr", "ulabs"];
// Outils accessibles par les liens historiques ?outil= / ?cip= (même s'ils sont masqués dans le menu)
const OUTILS_LIEN = ["fauteuil", "transfert", "saisie", "peremption", "groupees", "justificatif"];
// Menus classés par ordre alphabétique (voir filteredProducts) : barre A–Z en haut
const ALPHA_SECTIONS = ["otc", "nr"];
// Tri et filtre par laboratoire (colonne labo d'elixir_products : fabricant Medipim ou saisie de l'admin ;
// docs/labo-otc.md). Centrale OTC seulement en V1. Laboratoires comparés sans casse, accents ni espaces doubles
const LABO_SECTIONS = ["otc"];
const cleLabo = (l) => String(l || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
// &tri=labo / &labo=… de l'adresse, lus seulement avec le ?menu= d'un de ces menus (ailleurs : ignorés)
const paramLabo = (nom) => { try { const p = new URLSearchParams(window.location.search); return LABO_SECTIONS.includes(p.get("menu")) ? p.get(nom) || "" : ""; } catch { return ""; } };

// Remise affichée (catalogue seulement, jamais envoyée) : format français de src/theme.js (refonte charte, lot 4) —
// « −9,7 % » (vrai signe moins, virgule, espace insécable) au lieu de « -9.70 % » ; vide ou 0 → « – »
const fmtPct = (pct) => fmtPctFr(pct);
// Remise en badge or + encre (refonte charte, lot 4) ; sans remise, un tiret --ink-mute (il signifie « aucune » : revue, § 20)
function BadgeRemise({ pct }) {
  const t = fmtPct(pct);
  return t === "–" ? <span style={{ color: T.inkMute }}>–</span> : <span style={{ ...ui.badge("promo"), padding: "1px 6px" }}>{t}</span>;
}
// Alignement des colonnes du tableau : textes à gauche, colis et palier au centre, montants et remises à droite
const alignCol = (col) => /^(CIP|CIP13|Désignation)$/.test(col) ? "left" : (col === "Colis" || col === "Qté" || col === "Palier") ? "center" : "right";
// Date de fin d'un menu promo (« AAAA-MM-JJ », champ date de l'admin) en français : « 25 sept. 2026 » (revue, § 20).
// Lue en date locale : new Date("2026-09-25") serait minuit UTC, donc la veille aux Antilles. Autre format : tel quel
const dateFin = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : d;
};

// Copie du CIP : composant partagé src/components/ui/CipCell.jsx (catalogue, Saisie, recherche globale ; revue, § 20)

// Quantité d'un tableau à colis (lot E1) : la frappe reste libre (taper 12 avec un colis de 6 donne 12) ;
// l'arrondi au colis (onValider → setQty) se fait à la sortie du champ ou sur Entrée, plus à chaque touche.
// Le texte en cours de frappe reste dans le champ : le panier ne reçoit que des quantités arrondies.
function ChampQteColis({ valeur, onValider, ...attributs }) {
  const [brouillon, setBrouillon] = useState(null);
  const valider = (v) => { setBrouillon(null); onValider(v); };
  // Revue (§ 11) : une quantité changée de l'extérieur pendant la frappe (« − » / « + » touchés sans que le champ perde
  // le focus, comme sur iPad ; panier) l'emporte sur le brouillon : champ et panier restent alignés. La frappe ne change
  // pas « valeur » : l'arrondi en sortie de champ (E1) est inchangé.
  useEffect(() => { setBrouillon(null); }, [valeur]);
  return (
    <input {...attributs} type="number" value={brouillon ?? (valeur || "")}
      onChange={e => setBrouillon(e.target.value)}
      onBlur={e => valider(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") valider(e.currentTarget.value); }} />
  );
}

// Lien direct vers un menu (admin) : https://…/?menu=<clé>, à coller dans un e-mail ou un catalogue
function LienMenu({ menu }) {
  const [copie, setCopie] = useState(false);
  const lien = `${window.location.origin}/?menu=${encodeURIComponent(menu)}`;
  const copier = () => { navigator.clipboard?.writeText(lien).then(() => { setCopie(true); setTimeout(() => setCopie(false), 1600); }).catch(() => window.prompt("Lien du menu :", lien)); };
  return (
    <button className={copie ? undefined : "ex-btn-discret"} onClick={copier} title={`Copier le lien de ce menu :\n${lien}`} style={{
      marginTop: 10, height: 28, padding: "0 12px", border: "none", borderRadius: R.pill, cursor: "pointer",
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
      ...(copie ? { background: T.okBg, color: T.ok } : {}),
    }}><Icone nom={copie ? "coche" : "lien"} taille={14} />{copie ? "Lien copié" : "Lien du menu"}</button>
  );
}

export default function App() {
  // Lien direct vers un produit : ?cip=... (ou ?produit=) → ouvre la Saisie de commande pré-remplie
  // (setter : « Voir dans la Saisie de commande » de l'accueil pré-remplit la Saisie avec le CIP, OrderEntry repart à neuf)
  const [initialProductQuery, setInitialProductQuery] = useState(() => {
    try { const p = new URLSearchParams(window.location.search); return p.get("cip") || p.get("produit") || ""; } catch { return ""; }
  });
  // Adresse propre à chaque menu : ?menu=<clé> (ex. ?menu=otc, ?menu=promo_1792040000000). Un menu promo
  // ou personnalisé n'existe qu'une fois la config chargée : il est retenu ici puis ouvert à ce moment-là.
  const menuDemande = useRef((() => { try { return new URLSearchParams(window.location.search).get("menu") || ""; } catch { return ""; } })());
  const navParClic = useRef(false);   // changement de menu par l'utilisateur → nouvelle entrée d'historique (bouton Retour)
  const menuViaLien = useRef(menuDemande.current.startsWith("promo_"));   // arrivée par le lien d'un menu promo : pas de fenêtre « Offres du moment »
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("menu")) return p.get("menu");
      const outil = p.get("outil") || p.get("tab");            // ?outil=fauteuil → parcours fauteuil roulant
      if (outil && OUTILS_LIEN.includes(outil)) return outil;
      if (p.get("cip") || p.get("produit")) return "saisie";
    } catch {}
    // arrivée sans lien (?menu=, ?outil=, ?cip=) : la page d'accueil, sauf si l'admin l'a masquée ou a coupé l'arrivée
    const acc = getDisplayConfig().accueil || {};
    return (!acc.masque && acc.arrivee !== false) ? "accueil" : (getDisplayConfig().defaultTab || "expert");
  });
  // Saisie par Elixir pour une pharmacie (admin connecté) : la commande part au nom de cette pharmacie.
  // L'identité de session ci-dessous est remplacée en mémoire seulement (la connexion pharmacie
  // enregistrée dans le navigateur n'est pas touchée) ; mémorisé pour l'onglet (sessionStorage).
  const [actingFor, setActingFor] = useState(() => { try { return JSON.parse(sessionStorage.getItem("acting_for") || "null"); } catch { return null; } });
  const [showPharmacyPicker, setShowPharmacyPicker] = useState(false);
  const hasAdminToken = !!localStorage.getItem("admin_token");
  // Session pharmacie — déclarés en premier car référencés dans useEffect et useMemo
  const [pharmacyName, setPharmacyName] = useState(() => actingFor ? actingFor.name : (localStorage.getItem("session_name") || ""));
  const [pharmacyEmail, setPharmacyEmail] = useState(() => actingFor ? (actingFor.email || "") : (localStorage.getItem("session_email") || ""));
  const [pharmacyCip, setPharmacyCip] = useState(() => actingFor ? (actingFor.cip || "") : (localStorage.getItem("session_cip") || ""));
  // Appel authentifié (correctifs de sécurité du 19/10/2026 : order-list, restock-alert, order-save, quota-status,
  // gp-pharmacy, gp-upload, group-order et les suggestions ml-recommend exigent un jeton) :
  // admin_token en saisie pour une pharmacie, sinon jeton pharmacie ; l'un comme l'autre renouvelé une fois s'il a expiré
  // (un seul renouvellement à la fois : renouvelerUneFois).
  // jetonVersion change après une reconnexion par code : les lectures faites avec appelAuthentifie sont refaites
  // (menu « Commandes groupées », suggestions, contingentement) sans recharger la page
  const [jetonVersion, setJetonVersion] = useState(0);
  // X-Elixir-Session : page à jour (order-save ne met en quarantaine que les commandes des pages d'avant le correctif)
  const appelAuthentifie = useCallback(async (url, options = {}) => {
    const envoi = (t) => fetch(url, { ...options, headers: { ...(options.headers || {}), "X-Elixir-Session": "jeton", ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
    if (actingFor) {
      let res = await envoi(localStorage.getItem("admin_token"));
      const rt = localStorage.getItem("admin_refresh_token");
      if (res.status === 401 && rt) {   // même renouvellement qu'adminFetch (AdminPanel.jsx)
        const jeton = await renouvelerUneFois("admin", () => renouvelleAdmin(rt));
        if (jeton) res = await envoi(jeton);
      }
      return res;
    }
    let res = await envoi(localStorage.getItem("pharmacy_token"));
    if (res.status === 401 && localStorage.getItem("pharmacy_refresh_token")) res = await envoi(await renouvelerUneFois("pharmacie", freshPharmacyToken));
    return res;
  }, [actingFor, jetonVersion]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [groupOrders, setGroupOrders] = useState([]); // commandes groupées ulabs
  // Commandes groupées (nouveau module) : null = vérification en cours
  const [gpAllowed, setGpAllowed] = useState(null);   // null | true | false | "reconnexion" (session à confirmer par code)
  const [gpDirty, setGpDirty] = useState(false);   // saisie de commande groupée non confirmée
  useEffect(() => {
    if (!pharmacyEmail) { setGpAllowed(false); return; }   // identité = compte (e-mail) → fiche Odoo, le CIP peut manquer
    let cancelled = false;
    // jeton pharmacie (saisie Elixir : jeton admin + adresse de la pharmacie servie). Sans jeton valide (401) : menu
    // « Commandes groupées » gardé, qui invite à se reconnecter (gpAllowed = "reconnexion") — avant, il disparaissait
    // sans rien dire à une pharmacie inscrite à une opération en cours ; saisie Elixir : pas de menu, comme avant
    appelAuthentifie("/.netlify/functions/gp-pharmacy", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "access", cip: pharmacyCip, email: pharmacyEmail }) })
      .then(r => r.status === 401 && !actingFor ? { allowed: "reconnexion" } : r.ok ? r.json() : { allowed: false })
      .then(j => { if (!cancelled) setGpAllowed(j.allowed === "reconnexion" ? "reconnexion" : !!j.allowed); })
      .catch(() => { if (!cancelled) setGpAllowed(false); });
    return () => { cancelled = true; };
  }, [pharmacyCip, pharmacyEmail, appelAuthentifie]);
  const [validatedCampOrders, setValidatedCampOrders] = useState({}); // {tabKey: cip[]} commandes déjà validées
  const [groupSaving, setGroupSaving] = useState({});
  const [ulabsConfirming, setUlabsConfirming] = useState(false);
  const [ulabsConfirmed, setUlabsConfirmed] = useState(false);
  const [ulabsError, setUlabsError] = useState(null);
  const [ulabsPalier, setUlabsPalier] = useState(null); // null | "engage" | "expert"
  const [quantities, setQuantities] = useState(() => readCart(actingFor)[0]);
  // Produits hors catalogue curaté (ajoutés depuis Saisie de commande / Péremption courte)
  const [specialItems, setSpecialItems] = useState(() => readCart(actingFor)[1]);
  // Lignes « sur justificatif labo » : attestation, renouvellement, ordonnances déposées (par CIP)
  const [justifInfo, setJustifInfo] = useState(() => readCart(actingFor)[2]);
  const [justifProducts, setJustifProducts] = useState({});
  useEffect(() => { loadJustifProducts().then(setJustifProducts); }, []);
  const updateJustif = (cip, patch) => setJustifInfo(prev => {
    const cur = prev[cip] || {};
    return { ...prev, [cip]: { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } };
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");

  // ── Favoris pharmacie ────────────────────────────────────────────────
  const favKey = pharmacyCip && pharmacyCip !== "0" ? `favorites_${pharmacyCip}` : "favorites_anon";
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(favKey) || "[]")); } catch { return new Set(); }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [filterStock, setFilterStock] = useState("all"); // "all" | "instock" | "rupture"
  const [filterRemise, setFilterRemise] = useState(false);
  // Centrale OTC : tri par laboratoire et laboratoire choisi (affichage seulement), repris de l'adresse &tri=labo&labo=…
  const [triLabo, setTriLabo] = useState(() => paramLabo("tri") === "labo");
  const [filtreLabo, setFiltreLabo] = useState(() => paramLabo("labo"));
  const toggleFav = (cip) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(cip)) next.delete(cip); else next.add(cip);
      localStorage.setItem(favKey, JSON.stringify([...next]));
      return next;
    });
  };
  const [flashMsg, setFlashMsg] = useState("");
  // un nouveau message reste affiché sa durée entière (lot E2 : ajouts enchaînés depuis la Saisie, alerte de contingentement)
  const flashTimer = useRef(null);
  const flash = (msg, duree = 3000) => { setFlashMsg(msg); clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlashMsg(""), duree); };

  // ── Suggestions de recommande (ML) ───────────────────────────────────
  const [reorderSuggestions, setReorderSuggestions] = useState([]);
  const [showReorder, setShowReorder] = useState(false);
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [myOrders, setMyOrders] = useState([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);
  const [myOrdersErreur, setMyOrdersErreur] = useState(null);   // null | "reconnexion" | "fiche" | "lecture"

  const fetchMyOrders = useCallback(async () => {
    if (!pharmacyCip || pharmacyCip === "0") return;
    setMyOrdersLoading(true);
    try {
      setMyOrdersErreur(null);
      // ?pharmacy_cip ne sert qu'à l'admin : pour une pharmacie, le serveur prend le CIP de son jeton
      const res = await appelAuthentifie(`/.netlify/functions/order-list?pharmacy_cip=${encodeURIComponent(pharmacyCip)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setMyOrders(data.orders || []);
      else { setMyOrders([]); setMyOrdersErreur(res.status === 401 ? "reconnexion" : res.status === 403 ? "fiche" : "lecture"); }
    } catch { setMyOrders([]); setMyOrdersErreur("lecture"); }
    setMyOrdersLoading(false);
  }, [pharmacyCip, appelAuthentifie]);
  useEffect(() => {
    setReorderSuggestions([]); setShowReorder(false);   // autre pharmacie (saisie Elixir) : pas les suggestions de la précédente
    setUlabsConfirmed(false); setUlabsError(null);
    if (!pharmacyCip || pharmacyCip === "0") return;
    let cancelled = false;
    // ?pharmacy_cip ne sert qu'à l'admin en saisie : pour une pharmacie, le serveur prend le CIP de son jeton
    appelAuthentifie(`/.netlify/functions/ml-recommend?mode=reorder&pharmacy_cip=${encodeURIComponent(pharmacyCip)}&limit=10`)
      .then(r => r.ok ? r.json() : {})
      .then(data => {
        if (cancelled) return;
        const due = (data.suggestions || []).filter(s => s.should_reorder && s.name);
        if (due.length > 0) { setReorderSuggestions(due); setShowReorder(true); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pharmacyCip, appelAuthentifie]);

  const [globalSearch, setGlobalSearch] = useState("");
  const [globalResults, setGlobalResults] = useState([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const globalSearchRef = useRef(null);

  // ── Search tracking (ML) ──────────────────────────────────────────────
  const trackSearch = useCallback((query, results_count, clicked_cip, added_to_cart) => {
    if (!query || query.length < 2) return;
    fetch("/.netlify/functions/search-track", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, pharmacy_cip: pharmacyCip || null, results_count, clicked_cip, added_to_cart }),
    }).catch(() => {});
  }, [pharmacyCip]);

  // Debounced Odoo search
  useEffect(() => {
    if (globalSearch.trim().length < 2) { setGlobalResults([]); setGlobalSearching(false); return; }
    clearTimeout(globalSearchRef.current);
    setGlobalSearching(true);   // lot 8 : « Recherche… » dès la frappe, plus de « 0 produit » pendant le délai de 350 ms
    globalSearchRef.current = setTimeout(async () => {
      setGlobalSearching(true);
      try {
        const res = await fetch(`/.netlify/functions/odoo-catalog?q=${encodeURIComponent(globalSearch.trim())}&limit=50`);
        const data = await res.json();
        const results = collapseGroups(Array.isArray(data) ? data : data.products || [], await loadGroups());
        setGlobalResults(results);
        // Track search (fire-and-forget)
        trackSearch(globalSearch.trim(), results.length, null, false);
      } catch { setGlobalResults([]); }
      setGlobalSearching(false);
    }, 350);
    return () => clearTimeout(globalSearchRef.current);
  }, [globalSearch, trackSearch]);
  const [sendStatus, setSendStatus] = useState(null);
  const [showAdmin, setShowAdmin] = useState(() => window.location.hash === "#admin");
  useEffect(() => {
    const onHash = () => setShowAdmin(window.location.hash === "#admin");
    window.addEventListener("hashchange", onHash);
    // Keyboard shortcut: Ctrl+Shift+A (or Cmd+Shift+A on Mac)
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "A") {
        e.preventDefault();
        if (window.location.hash === "#admin") { window.location.hash = ""; }
        else { window.location.hash = "#admin"; }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("keydown", onKey); };
  }, []);

  // Campagnes groupement (config dynamique depuis Supabase)
  const [campaigns, setCampaigns] = useState([]);
  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/.netlify/functions/campaign-get");
      const data = await res.json();
      if (Array.isArray(data)) setCampaigns(data);
    } catch(e) { console.warn("[campaigns] fetch error:", e.message); }
  }, []);
  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  // Campagne U-Labs de secours (si absent de Supabase)
  const ULABS_FALLBACK = {
    id: "ulabs", label: "Commande groupée U-Labs", active: true,
    palier_qty: 12, palier_remise: 33, min_refs: 12,
    conditions: [
      { label: "Parogencyl", match_regex: "parogencyl.*dentifrice", count: 3 },
      { label: "Regenerate",  match_regex: "regenerate.*dentifrice", count: 1 },
    ],
    groupes: [
      { key:"bbouche",  label:"🧴 Bains de bouche",          color:"#1e3a5f", accent:"#3b82f6", match_regex:"bain de bouche",                               step:6, min_qty:6, multiple:6, gratuite_type:"aucune", gratuite_condition:"", desc:"" },
      { key:"fluoc250", label:"💧 Fluocaril 250mg",           color:"#0c4a6e", accent:"#0ea5e9", match_regex:"fluocaril.*250",                                step:6, min_qty:6, multiple:6, gratuite_type:"aucune", gratuite_condition:"", desc:"" },
      { key:"fluoc145", label:"🦷 Fluocaril 145mg",           color:"#065f46", accent:"#10b981", match_regex:"fluocaril.*145",                                step:6, min_qty:6, multiple:6, gratuite_type:"6+2",    gratuite_condition:"", desc:"🎁 6 achetées = 2 offertes" },
      { key:"parorege", label:"⚠️ Parogencyl & Regenerate",  color:"#7c2d12", accent:"#f97316", match_regex:"parogencyl.*dentifrice|regenerate.*dentifrice", step:6, min_qty:6, multiple:6, gratuite_type:"6+2",    gratuite_condition:"", desc:"🎁 6 achetées = 2 offertes" },
      { key:"brosses",  label:"🪥 Brosses à dents",           color:"#4c1d95", accent:"#8b5cf6", match_regex:"brosse",                                        step:3, min_qty:3, multiple:3, gratuite_type:"3+1",    gratuite_condition:"bain de bouche", desc:"🎁 3 achetées = 1 offerte (avec bain de bouche)" },
      { key:"junior",   label:"👶 Junior & Kids",             color:"#831843", accent:"#ec4899", match_regex:"junior|kids",                                   step:6, min_qty:6, multiple:6, gratuite_type:"aucune", gratuite_condition:"", desc:"" },
    ],
  };

  // Helper : retourne la config de campagne pour un tab donné (ou null)
  const getCampaign = (tabKey) => {
    const fromDB = campaigns.find(c => c.id === tabKey && c.active);
    if (fromDB) return fromDB;
    if (tabKey === "ulabs") return ULABS_FALLBACK;
    return null;
  };

  // Produits chargés depuis Supabase (source unique de vérité)
  const [dbProducts, setDbProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await fetch("/.netlify/functions/products-get");
      const data = await res.json();
      if (data.products) setDbProducts(data.products);
    } catch(e) { console.warn("[products] fetch error:", e.message); }
    finally { setProductsLoading(false); }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Persiste le panier (session : localStorage ; saisie Elixir : panier de la pharmacie servie, onglet)
  useEffect(() => {
    try { cartStore(actingFor).setItem(cartKeys(actingFor)[0], JSON.stringify(quantities)); } catch {}
  }, [quantities, actingFor]);
  useEffect(() => {
    try { cartStore(actingFor).setItem(cartKeys(actingFor)[1], JSON.stringify(specialItems)); } catch {}
  }, [specialItems, actingFor]);
  useEffect(() => {
    try { cartStore(actingFor).setItem(cartKeys(actingFor)[2], JSON.stringify(justifInfo)); } catch {}
  }, [justifInfo, actingFor]);
  const [promoSections, setPromoSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_promos") || "[]"); } catch { return []; }
  });
  const [promoPopupOpen, setPromoPopupOpen] = useState(false);

  // ── Charger la config partagée depuis Supabase (source de vérité) ────
  const [configLoaded, setConfigLoaded] = useState(false);
  // Connexion par code par défaut : l'ancien mode (sans code) ne sert que si config-get le déclare explicitement
  const [authMode, setAuthMode] = useState("otp"); // 'legacy' | 'otp' — flag serveur pharmacy_auth_mode
  useEffect(() => {
    (async () => {
      try {
        const [dcRes, promoRes, amRes] = await Promise.all([
          fetch("/.netlify/functions/config-get?key=display_config"),
          fetch("/.netlify/functions/config-get?key=admin_promos"),
          fetch("/.netlify/functions/config-get?key=pharmacy_auth_mode"),
        ]);
        const dcJson = await dcRes.json();
        const promoJson = await promoRes.json();
        try { const amJson = await amRes.json(); if (amJson.value) setAuthMode(amJson.value === "legacy" ? "legacy" : "otp"); } catch {}   // comme pharmacy-lookup : seul « legacy » exact ouvre l'ancien mode
        if (dcJson.value) {
          localStorage.setItem("display_config", JSON.stringify(dcJson.value));
        }
        if (promoJson.value) {
          localStorage.setItem("admin_promos", JSON.stringify(promoJson.value));
          setPromoSections(promoJson.value);
        }
      } catch (e) { console.warn("[config] Supabase fetch error:", e.message); }
      setConfigLoaded(true);
    })();
  }, []);
  // Session pharmacie longue durée : au démarrage, on échange le refresh token
  // contre un access token frais (session valide tant que le refresh l'est).
  useEffect(() => {
    const rt = localStorage.getItem("pharmacy_refresh_token");
    if (!rt) return;
    (async () => {
      try {
        const rf = await fetch("/.netlify/functions/admin-refresh", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt }),
        });
        const rj = await rf.json();
        if (rj.success && rj.token) {
          localStorage.setItem("pharmacy_token", rj.token);
          if (rj.refresh_token) localStorage.setItem("pharmacy_refresh_token", rj.refresh_token);
        }
      } catch {}
    })();
  }, []);
  const [stockData, setStockData] = useState({}); // { [cip]: { dispo, stock } }
  const [stockUpdatedAt, setStockUpdatedAt] = useState(null);

  // Stock : chargement et actualisation manuelle
  const [stockLoading, setStockLoading] = useState(false);
  const [stockRefreshing, setStockRefreshing] = useState(false); // true = refresh Odoo en cours
  // Charger commandes groupées U-Labs : vos lignes, et celles des autres pharmacies sans leur identité (repère anonyme)
  const fetchGroupOrders = useCallback(async () => {
    try {
      const res = await appelAuthentifie("/.netlify/functions/group-order?fournisseur=ulabs");
      const rows = res.ok ? await res.json() : [];
      setGroupOrders(Array.isArray(rows) ? rows : []);
    } catch(e) { console.error(e); }
  }, [appelAuthentifie]);
  useEffect(() => {
    if (activeTab === "ulabs") fetchGroupOrders();
    const _camp = getCampaign(activeTab);
    if (_camp && pharmacyCip) {
      appelAuthentifie(`/.netlify/functions/order-list?source=${encodeURIComponent(activeTab)}`)
        .then(r => r.ok ? r.json() : { orders: [] })
        .then(orders => {
          // Commandes validées de la campagne : les vôtres (l'admin en saisie : toutes) ; les autres pharmacies comptent via group-order
          const campOrders = (Array.isArray(orders) ? orders : orders.orders || [])
            .filter(o => o.source === activeTab);
          const cipArr = [];
          campOrders.forEach(o => { (o.items||[]).forEach(it => { if(it.cip && !cipArr.includes(it.cip)) cipArr.push(it.cip); }); });
          setValidatedCampOrders(prev => ({...prev, [activeTab]: cipArr}));
        }).catch(() => {});
    }
  }, [activeTab, fetchGroupOrders, appelAuthentifie]);

  const [isMobile, setIsMobile] = React.useState(() => window.innerWidth < 768);
  // Hauteur de l'en-tête pétrole collant : la barre A–Z se colle juste dessous (et le bloc de marque de la barre latérale s'y aligne)
  const [hauteurEntete, setHauteurEntete] = useState(64);
  const obsEntete = useRef(null);
  const refEntete = useCallback((el) => {
    obsEntete.current?.disconnect();
    if (!el) return;
    const maj = () => setHauteurEntete(el.offsetHeight || 64);
    maj();
    if (window.ResizeObserver) { obsEntete.current = new ResizeObserver(maj); obsEntete.current.observe(el); }
  }, []);
  // isDesktop ≥ 1024 → sidebar fixe persistante ; sinon (mobile + tablette) → tiroir
  const [isDesktop, setIsDesktop] = React.useState(() => window.innerWidth >= 1024);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  React.useEffect(() => {
    const h = () => { setIsMobile(window.innerWidth < 768); setIsDesktop(window.innerWidth >= 1024); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  // Ferme le tiroir dès qu'on repasse en desktop
  React.useEffect(() => { if (isDesktop) setSidebarOpen(false); }, [isDesktop]);

  // Lit les stocks depuis Supabase (rapide)
  const fetchStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await fetch("/.netlify/functions/stock-get", { ...delai(20000) });
      const data = await res.json();
      if (data.error) console.warn("[stock] Erreur Odoo:", data.error);
      if (data.stocks) {
        const count = Object.values(data.stocks).filter(s => s.dispo === 0 || s.dispo === false).length;
        console.log(`[stock] ${Object.keys(data.stocks).length} produits, ${count} rupture(s)`);
        setStockData(data.stocks);
        setStockUpdatedAt(data.updatedAt || new Date().toISOString());
      }
    } catch(e) { console.warn("[stock] fetch error:", e.message); }
    finally { setStockLoading(false); }
  }, []);

  // Déclenche la mise à jour Odoo → Supabase (background, ~35s), puis relit depuis Supabase
  const handleRefresh = useCallback(async () => {
    if (stockRefreshing) return;
    setStockRefreshing(true);
    try {
      await fetchStock();
    } catch(e) {
      console.warn("[stock] refresh error:", e.message);
    } finally {
      setStockRefreshing(false);
    }
  }, [stockRefreshing, fetchStock]);

  useEffect(() => {
    fetchStock();
    let interval = setInterval(fetchStock, 5 * 60 * 1000);
    const onVisibility = () => {
      if (document.hidden) { clearInterval(interval); interval = null; }
      else { fetchStock(); interval = setInterval(fetchStock, 5 * 60 * 1000); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [fetchStock]);

  // ── Pharmacy session state — MUST be before CATALOG_WITH_ADMIN useMemo ──
  const CATALOG_WITH_ADMIN = useMemo(() => {
    const merged = {};
    // Construit chaque section depuis les produits Supabase
    Object.entries(SECTION_META).forEach(([k, meta]) => {
      const sectionProducts = dbProducts
        .filter(p => p.section === k)
        .map(p => ({
          cip: p.cip,
          name: p.name,
          pv: p.pv,
          pct: p.pct,
          pn: p.pn,
          remise_eur: p.remise_eur,
          colis: p.colis,
          carton: p.carton,
          note: p.note,
          source: p.source,
          image_url: p.image_url || null,
          price_tiers: p.price_tiers || null,
          labo: p.labo || null,
          _dbId: p.cip,
        }));
      merged[k] = { ...meta, products: sectionProducts };
    });
    // Inject active campaigns as dynamic tabs (with access restriction)
    campaigns.filter(camp => camp.active).forEach(camp => {
      const restricted = camp.restricted_to || [];
      const hasAccess = restricted.length === 0 || restricted.includes(pharmacyEmail);
      if (!hasAccess) return;
      // Only inject if not already defined in SECTION_META
      if (!SECTION_META[camp.id]) {
        const campProducts = dbProducts
          .filter(p => p.section === camp.id)
          .map(p => ({ cip:p.cip, name:p.name, pv:p.pv, pct:p.pct, pn:p.pn, remise_eur:p.remise_eur, colis:p.colis, carton:p.carton, note:p.note, source:p.source, image_url:p.image_url||null, price_tiers:p.price_tiers||null, _dbId:p.cip }));
        merged[camp.id] = {
          label: camp.label, subtitle: camp.subtitle||"", color: camp.color||"#0d4f3c",
          accent: camp.accent||"#059669", icon: camp.icon||"🤝", columns: [], isCampaign: true,
          products: campProducts,
        };
      } else {
        // Merge campaign meta over existing section meta
        merged[camp.id] = { ...merged[camp.id],
          label: camp.label||merged[camp.id].label,
          subtitle: camp.subtitle||merged[camp.id].subtitle,
          color: camp.color||merged[camp.id].color,
          accent: camp.accent||merged[camp.id].accent,
          icon: camp.icon||merged[camp.id].icon,
        };
      }
    });
    // Inject active promo sections as dynamic tabs
    promoSections.filter(ps => ps.active).forEach(ps => {
      merged[`promo_${ps.id}`] = {
        label: ps.name,
        icon: ps.icon || "🏷️",
        subtitle: ps.description || "",
        color: ps.color || "#7c3aed",
        accent: ps.accentColor || "#a855f7",
        columns: ["CIP", "Désignation", "Prix", "Remise", "Prix net"],
        products: (ps.products || []),
        // grille avec visuels (image_url de chaque produit) ; sans aucune photo, le tableau habituel
        withPhotos: !!ps.withPhotos && (ps.products || []).some(pr => pr.image_url),
        // menu sans mention de stock (précommande) : ni filtre « En stock / Ruptures » ni badge rupture
        sansStock: !!ps.sansStock,
        isPromo: true,
        promoId: ps.id,
      };
    });
    // Apply display config overrides (subtitles, icons, labels)
    const dc = getDisplayConfig();
    if (dc.subtitles) {
      Object.entries(dc.subtitles).forEach(([k, sub]) => {
        if (merged[k] && sub != null) merged[k] = { ...merged[k], subtitle: sub };
      });
    }
    if (dc.icons) {
      Object.entries(dc.icons).forEach(([k, icon]) => {
        if (merged[k] && icon) merged[k] = { ...merged[k], icon };
      });
    }
    if (dc.labels) {
      Object.entries(dc.labels).forEach(([k, label]) => {
        if (merged[k] && label) merged[k] = { ...merged[k], label };
      });
    }
    // Inject custom sections from display config
    if (dc.customSections) {
      dc.customSections.forEach(cs => {
        if (!cs.key || merged[cs.key]) return; // skip if key missing or already exists
        const sectionProducts = dbProducts.filter(p => p.section === cs.key).map(p => ({
          cip: p.cip, name: p.name, pv: p.pv, pct: p.pct, pn: p.pn, remise_eur: p.remise_eur,
          colis: p.colis, carton: p.carton, note: p.note, source: p.source, image_url: p.image_url || null, price_tiers: p.price_tiers || null, _dbId: p.cip,
        }));
        merged[cs.key] = {
          label: cs.label || cs.key, subtitle: cs.subtitle || "", color: cs.color || "#333",
          accent: cs.accent || "#666", icon: cs.icon || "📁",
          columns: ["CIP", "Désignation", "PV", "Remise %", "Remise €", "PN"],
          products: sectionProducts, isCustom: true,
        };
      });
    }
    // Commandes groupées : onglet visible uniquement des pharmacies autorisées ; session sans jeton valide : onglet qui
    // invite à se reconnecter (l'accès ne se vérifie qu'avec un jeton)
    if (gpAllowed) {
      merged.groupees = { label: "Commandes groupées", subtitle: gpAllowed === "reconnexion" ? "Reconnectez-vous pour y accéder" : "Achats groupés et précommandes aux conditions négociées",
        color: "#0f2d3d", accent: "#2d9cbc", icon: "🤝", columns: [], specialView: "groupPurchases", products: [] };
    }
    // Page d'accueil (?menu=accueil) : vue spéciale sans produits (rien n'y est rangé par addItemToCart) ; absente si
    // l'admin la masque (display_config.accueil.masque : interrupteur d'urgence). Hors de SECTION_META : l'admin ne la
    // propose pas comme rayon. Sans icône : la barre latérale prend la maison au trait (ICONES_RAYON)
    if (!dc.accueil?.masque) {
      merged.accueil = { label: "Accueil", accent: "#2d9cbc", columns: [], products: [], specialView: "accueil" };
    }
    return merged;
  }, [dbProducts, promoSections, campaigns, pharmacyEmail, configLoaded, gpAllowed]);

  // Onboarding
  const [onboardingDone, setOnboardingDone] = useState(() => !!localStorage.getItem("session_email"));
  // Reconnexion par code demandée depuis la session (demanderReconnexion) : l'écran de connexion le dit et permet de
  // revenir au catalogue ; une fois le code validé, nouveau jeton et lectures authentifiées refaites
  const [reconnexion, setReconnexion] = useState(false);
  // Session sans aucun jeton (ouverte avant la connexion par code, ou par l'ancien mode sans code) : order-save refusera
  // la commande ; le panier l'annonce dès son ouverture, avant tout envoi, avec « Se connecter par code »
  const [sansJeton, setSansJeton] = useState(false);
  useEffect(() => {
    if (!onboardingDone) return;
    setSansJeton(!localStorage.getItem("pharmacy_token") && !localStorage.getItem("pharmacy_refresh_token"));
    if (reconnexion) { setReconnexion(false); setJetonVersion(v => v + 1); }
  }, [onboardingDone]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Onboarding flow: "email" | "confirm" | "new_client"
  const [obStep, setObStep] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [foundPharmacy, setFoundPharmacy] = useState(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("session_name");
    localStorage.removeItem("session_email");
    localStorage.removeItem("session_cip");
    localStorage.removeItem("pharmacy_token");
    localStorage.removeItem("pharmacy_refresh_token");
    setPharmacyName("");
    setPharmacyEmail("");
    setPharmacyCip("");
    setOnboardingDone(false);
    // Repartir de l'écran e-mail (sinon on retombe sur la saisie du code OTP)
    setObStep("email");
    setEmailInput("");
    setOtpInput("");
    setOnboardingError("");
    setQuantities({});
    setSpecialItems([]);
    setJustifInfo({});
    setCartOpen(false);
  };

  // ── Envoi d'une commande : session vérifiée AVANT tout envoi (correctif de sécurité du 19/10/2026) ──
  // order-save n'enregistre plus de commande sans jeton. Avant l'e-mail à Elixir, l'enregistrement et le relais PharmaML,
  // le serveur confirme la session (order-save { verifier: true } : rien n'est écrit). Jeton expiré : renouvelé par
  // appelAuthentifie. Renouvellement impossible — session ouverte avant la connexion par code (aucun jeton), ou trop
  // ancienne — : rien ne part, le panier reste intact, et la pharmacie se reconnecte par code (demanderReconnexion).
  // Saisie Elixir : la session doit être celle d'un admin (sinon commande sans mention ni trace admin).
  const [envoiBloque, setEnvoiBloque] = useState(null);   // null | "reconnexion" | "fiche" | "admin" | "erreur" (MESSAGE_ENVOI_BLOQUE)
  useEffect(() => { setEnvoiBloque(null); }, [pharmacyEmail, actingFor]);   // autre pharmacie, saisie Elixir, déconnexion
  const sessionPourEnvoi = async () => {
    setEnvoiBloque(null);
    let res = null, j = {};
    try {
      res = await appelAuthentifie("/.netlify/functions/order-save", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifier: true }), ...delai(15000) });
      j = await res.json().catch(() => ({}));
    } catch { res = null; }
    if (res?.ok && j.success && (!actingFor || j.admin === true)) return true;
    const motif = actingFor ? (res && (res.ok || res.status === 401 || res.status === 403) ? "admin" : "erreur")
      : res?.status === 401 ? "reconnexion" : res?.status === 403 ? "fiche" : "erreur";
    setEnvoiBloque(motif);
    flash(`⚠ ${MESSAGE_ENVOI_BLOQUE[motif]}`, 8000);
    return false;
  };
  // Reconnexion par code sans quitter la session : panier, menu ouvert et saisie restent en place (le panier se
  // retrouve tel quel après le code). Toujours par code, même si l'ancien mode sans code est déclaré.
  const demanderReconnexion = () => {
    // l'écran de connexion démonte « Commandes groupées » : une saisie non confirmée serait perdue sans avertissement
    if (gpDirty && !window.confirm("Vos quantités de commande groupée ne sont pas confirmées : elles seront perdues. Vous reconnecter quand même ?")) return;
    setGpDirty(false);
    setReconnexion(true);
    setShowMyOrders(false); setEnvoiBloque(null);
    setAuthMode("otp"); setEmailInput(pharmacyEmail); setOtpInput(""); setOnboardingError("");
    setObStep("email"); setOnboardingDone(false);
  };
  // « Revenir au catalogue » depuis l'écran de reconnexion : session et panier inchangés (l'envoi redemandera le code)
  const annulerReconnexion = () => {
    setReconnexion(false); setOnboardingError(""); setObStep("email"); setOnboardingDone(true);
  };
  // ── Commandes groupées U-Labs / campagnes : quantités envoyées au groupement à chaque changement ──
  // jeton (pharmacie, ou admin en saisie) : le serveur prend le CIP du jeton pour une pharmacie. Refus faute de session
  // (401) : invitation à se reconnecter, et après la reconnexion (jetonVersion) les quantités sont renvoyées — avant, le
  // refus passait inaperçu (quantités absentes du groupement, compteur de pharmacies et palier faux pour toutes).
  const groupeARenvoyer = useRef(new Map());   // `${menu}|${cip}` → { menu, cip } : quantités refusées (401)
  const groupeAResynchroniser = useRef(false);   // un refus 401 (groupement ou confirmation U-Labs) : tout renvoyer
  const syncGroupe = (menu, cip, qty) => {
    if (!getCampaign(menu) || !cip) return Promise.resolve();
    return appelAuthentifie("/.netlify/functions/group-order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fournisseur: menu, cip, pharmacy_cip: pharmacyCip, pharmacy_name: pharmacyName, qty }),
    }).then(r => {
      if (r.status === 401) {
        groupeARenvoyer.current.set(`${menu}|${cip}`, { menu, cip }); groupeAResynchroniser.current = true;
        if (!actingFor) setEnvoiBloque("reconnexion");
        const msg = actingFor ? MESSAGE_ENVOI_BLOQUE.admin
          : "Quantités non comptées dans la commande groupée : session expirée. Reconnectez-vous avec le code reçu par e-mail, elles seront renvoyées.";
        flash(`⚠ ${msg}`, 8000);
        if (menu === "ulabs") setUlabsError(`⚠️ Quantités non comptées dans la commande groupée\n${actingFor ? MESSAGE_ENVOI_BLOQUE.admin : "Reconnectez-vous avec le code reçu par e-mail : vos quantités sont conservées et seront renvoyées."}`);
        return;
      }
      groupeARenvoyer.current.delete(`${menu}|${cip}`);
      if (r.ok && menu === "ulabs") setUlabsError(e => (e?.startsWith("⚠️ Quantités non comptées") ? null : e));
      fetchGroupOrders();
    }).catch(() => {});
  };
  // Après une reconnexion par code : quantités refusées (y compris les remises à zéro) et toutes celles du panier dans
  // les menus campagne (une page rechargée entre-temps a oublié les refus), renvoyées au groupement
  const renvoyerGroupe = () => {
    if (!groupeAResynchroniser.current) return Promise.resolve();
    groupeAResynchroniser.current = false;
    const aEnvoyer = new Map(groupeARenvoyer.current);
    groupeARenvoyer.current.clear();
    const qte = {};   // `${menu}|${cip}` → quantité du panier
    for (const [k, q] of Object.entries(quantities)) {
      const i = k.lastIndexOf("-"), menu = k.slice(0, i), p = CATALOG_WITH_ADMIN[menu]?.products?.[Number(k.slice(i + 1))];
      if (!p?.cip || !getCampaign(menu)) continue;
      qte[`${menu}|${p.cip}`] = (qte[`${menu}|${p.cip}`] || 0) + (Number(q) || 0);
      if (Number(q) > 0) aEnvoyer.set(`${menu}|${p.cip}`, { menu, cip: p.cip });
    }
    return Promise.all([...aEnvoyer].map(([k, { menu, cip }]) => syncGroupe(menu, cip, qte[k] || 0)));
  };
  useEffect(() => { if (jetonVersion) renvoyerGroupe(); }, [jetonVersion]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [isClient, setIsClient] = useState(() => actingFor ? true : null);
  const startActing = (ph) => {
    // chaque pharmacie servie a son propre panier ; celui de votre session reste de côté, intact
    if (actingFor && actingFor.odoo_id !== ph.odoo_id && (cartItems || []).length
      && !window.confirm(`Le panier préparé pour ${actingFor.name} (${cartItems.length} ligne(s)) reste de côté dans cet onglet. Passer à ${ph.name} ?`)) return;
    // identité : adresse de COMPTE de cette pharmacie seulement (jamais l'e-mail Odoo, qui peut être partagé)
    const a = { odoo_id: ph.odoo_id, name: ph.name, cip: ph.cip || "", email: ph.has_account ? ((ph.emails || [])[0] || "") : "", city: ph.city || "" };
    try { sessionStorage.setItem("acting_for", JSON.stringify(a)); } catch {}
    const [q, sp, lj] = readCart(a);
    setActingFor(a); setQuantities(q); setSpecialItems(sp); setJustifInfo(lj);
    setPharmacyName(a.name); setPharmacyEmail(a.email); setPharmacyCip(a.cip); setIsClient(true);
    setShowPharmacyPicker(false); setShowAdmin(false); if (window.location.hash === "#admin") history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const stopActing = () => {
    if ((cartItems || []).length && !window.confirm(`Le panier préparé pour ${actingFor?.name} (${cartItems.length} ligne(s)) sera abandonné. Revenir à votre session ?`)) return;
    try { const [kq, ks, kj] = cartKeys(actingFor); sessionStorage.removeItem(kq); sessionStorage.removeItem(ks); sessionStorage.removeItem(kj); sessionStorage.removeItem("acting_for"); } catch {}
    const [q, sp, lj] = readCart(null);   // panier de votre session, tel que vous l'aviez laissé
    setActingFor(null); setQuantities(q); setSpecialItems(sp); setJustifInfo(lj);
    setPharmacyName(localStorage.getItem("session_name") || ""); setPharmacyEmail(localStorage.getItem("session_email") || ""); setPharmacyCip(localStorage.getItem("session_cip") || "");
    setIsClient(null);
  };
  // ── Assistant Elixir (docs/assistant-conception.md § 1) : bouton affiché seulement si le serveur le dit disponible pour
  // cette identité (action « etat », lue une fois par identité) ; tiroir exclusif avec le panier ──
  const identiteAssistant = actingFor ? `a${actingFor.odoo_id}` : (onboardingDone && pharmacyEmail ? `p${pharmacyEmail}` : "");
  // assistant : réponse de « etat » ({ disponible, mode, raison, infos }) ; infos (téléphone, horaires des réglages) : ligne de
  // contact de la barre latérale, mise à jour à l'ouverture du panneau
  const [assistant, setAssistant] = useState(null);
  const [assistantOuvert, setAssistantOuvert] = useState(false);
  const [assistantContexte, setAssistantContexte] = useState(null);   // { commande_site_id, date } depuis Mes commandes
  useEffect(() => {
    setAssistant(null); setAssistantOuvert(false); setAssistantContexte(null);
    if (!identiteAssistant) return;
    let annule = false;
    const lire = () => etatAssistant(authAssistant(actingFor), identiteAssistant).then(e => { if (!annule) setAssistant(a => (a?.disponible ? a : e)); });
    lire();
    // indisponible pour une raison passagère (serveur ou Odoo injoignable, réseau) : relu au retour sur l'onglet et toutes
    // les 15 min (un état franc est gardé par etatAssistant, sans nouvel appel)
    const auRetour = () => { if (document.visibilityState === "visible") lire(); };
    document.addEventListener("visibilitychange", auRetour);
    const t = setInterval(auRetour, 15 * 60e3);
    return () => { annule = true; document.removeEventListener("visibilitychange", auRetour); clearInterval(t); };
  }, [identiteAssistant]);   // eslint-disable-line react-hooks/exhaustive-deps -- actingFor est dans l'identité
  useEffect(() => { if (cartOpen) setAssistantOuvert(false); }, [cartOpen]);
  // session sans jeton valide (ancien mode, renouvellement impossible) alors que l'assistant est ouvert à toutes les
  // pharmacies (« ouvert ») : le bouton s'affiche, le panneau propose « Me reconnecter » (pendant le pilote : masqué)
  const assistantDispo = !!assistant?.disponible || (!actingFor && assistant?.raison === "reconnexion" && !!assistant?.ouvert);
  const ouvrirAssistant = (contexte = null) => { setCartOpen(false); setSidebarOpen(false); setShowMyOrders(false); setAssistantContexte(contexte); setAssistantOuvert(true); };
  const [ribFile, setRibFile] = useState(null);
  const [ribBase64, setRibBase64] = useState(null);
  const [onboardingError, setOnboardingError] = useState("");
  // New client form
  const [ncName, setNcName] = useState("");
  const [ncTel, setNcTel] = useState("");
  const [ncVille, setNcVille] = useState("");
  const [ncSending, setNcSending] = useState(false);
  const [ncSent, setNcSent] = useState(false);

  const getStepMin = (catKey, p) => {
    if (catKey === "stratege") return { step: p.colis||1, min: p.colis||1, multiple: p.colis||1 };
    if (catKey === "master")   return { step: p.palier||1, min: p.palier||1, multiple: p.palier||1 };
    if (catKey === "blanche")  return { step: p.colis||1, min: p.colis||1, multiple: p.colis||1 };
    const camp = getCampaign(catKey);
    if (camp) {
      const groupes = buildGroupes(camp);
      const g = campGetGroupe(p, groupes);
      const step     = g?.step     || 1;
      const min_qty  = g?.min_qty  || 0;
      const multiple = g?.multiple || step;
      return { step, min: min_qty || multiple, multiple };
    }
    return { step: 1, min: 0, multiple: 1 };
  };

  const getStep = (catKey, p) => getStepMin(catKey, p).step;

  const setQty = (key, val, step = 1, min = 0, multiple = 1) => {
    const raw = Math.max(0, parseInt(val) || 0);
    const m = multiple > 1 ? multiple : (step > 1 ? step : 1);
    const snapped = m > 1 ? Math.round(raw / m) * m : raw;
    const final = snapped > 0 && min > 0 ? Math.max(min, snapped) : snapped;
    setQuantities(prev => ({ ...prev, [key]: final }));
  };

  // Modifie la quantité d'un article du panier, qu'il vienne du catalogue (quantities)
  // ou soit hors-catalogue (specialItems). newQty <= 0 → suppression de l'article.
  const setItemQty = (item, newQty) => {
    // ligne retirée : attestation et ordonnances valent pour UNE commande, jamais réutilisées
    if ((parseInt(newQty) || 0) <= 0 && item.cip) setJustifInfo(prev => { if (!prev[item.cip]) return prev; const n = { ...prev }; delete n[item.cip]; return n; });
    if (item.isSpecial) {
      const q = Math.max(0, parseInt(newQty) || 0);
      const id = item.cip || item.name;
      setSpecialItems(prev => q <= 0
        ? prev.filter(s => (s.cip || s.name) !== id)
        : prev.map(s => (s.cip || s.name) === id ? { ...s, qty: q } : s));
    } else {
      setQty(item.key, newQty, item.step);
    }
  };

  // Ajoute un produit au panier depuis la Saisie de commande / Péremption courte.
  // S'il est dans le catalogue curaté → quantities (logique campagnes/UG) ; sinon → specialItems.
  const addItemToCart = (item, { ouvrirPanier = true } = {}) => {
    // article regroupant plusieurs références (même code fournisseur) : ligne hors catalogue, une seule
    let added = false;
    Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, c]) => {
      if (added || item.supplier_code) return;   // plusieurs références : toujours une ligne hors catalogue
      const idx = (c.products || []).findIndex(p => p.cip === item.cip);
      if (idx >= 0) {
        setQuantities(prev => ({ ...prev, [`${catKey}-${idx}`]: (parseInt(prev[`${catKey}-${idx}`]) || 0) + item.qty }));
        added = true;
      }
    });
    if (!added) {
      const id = item.cip || item.name;
      setSpecialItems(prev => {
        const byCode = item.supplier_code ? prev.findIndex(s => s.supplier_code === item.supplier_code) : -1;
        const i = byCode >= 0 ? byCode : prev.findIndex(s => (s.cip || s.name) === id);
        if (i >= 0) {
          const n = [...prev];
          n[i] = { ...n[i], qty: n[i].qty + item.qty, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}) };
          return n;
        }
        return [...prev, { cip: item.cip || null, name: item.name, qty: item.qty, pn: item.pn ?? null, pv: item.pv ?? null, tiers: item.tiers ?? null, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}) }];
      });
    }
    flash(`✓ ${item.qty}× ${item.name} ajouté au panier`);
    if (ouvrirPanier) setCartOpen(true);   // lot E2 : la Saisie de commande n'ouvre plus le panier
  };

  const cartItems = useMemo(() => {
    const items = [];
    Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, cat]) => {
      const camp = getCampaign(catKey);
      const groupes = camp ? buildGroupes(camp) : [];
      (cat.products || []).forEach((p, idx) => {
        const key = `${catKey}-${idx}`;
        const qty = quantities[key] || 0;
        if (qty > 0 && p.pn != null) {
          const remisePct = camp ? (camp.palier_remise ?? 33) : 0;
          const pnNet = remisePct > 0 ? Math.round(p.pv * (1 - remisePct/100) * 100) / 100 : p.pn;
          let grat = { livrées: 0 };
          if (camp && groupes.length > 0) {
            grat = campGratuite(p, qty, cat.products, quantities, catKey, groupes);
          } else if (camp && groupes.length === 0) {
            // Fallback ulabs : 6+2 si nom contient "dentifrice" (parogencyl/regenerate/145)
            // 3+1 si brosse à dents hors junior/kids
            const nm = p.name?.toLowerCase() || "";
            if (/brosse/.test(nm) && !/junior|kids/.test(nm) && qty >= 3)
              grat = { livrées: Math.floor(qty/3), type: "3+1" };
            else if ((/parogencyl|regenerate|145/.test(nm)) && /dentifrice/.test(nm) && qty >= 6)
              grat = { livrées: Math.floor(qty/6)*2, type: "6+2" };
            else if (/fluocaril/.test(nm) && /145/.test(nm) && !/junior|kids/.test(nm) && qty >= 6)
              grat = { livrées: Math.floor(qty/6)*2, type: "6+2" };
          }
          const qtyUG = grat.livrées || 0;
          // Paliers de quantité Odoo (hors campagnes, qui ont leur propre logique)
          const basePn = pnNet ?? p.pn;
          const tiered = camp ? { pn: basePn, tier: null, next: null } : applyTiers(basePn, p.price_tiers, qty);
          items.push({
            key,
            cat: cat.label,
            catKey,
            name: p.name,
            cip: p.cip || null,
            pn: tiered.pn,
            basePn,
            tier: tiered.tier,
            nextTier: tiered.next,
            qty,
            qtyUG,
            total: tiered.pn * qty,
            color: cat.accent,
            step: getStep(catKey, p),
            isCampaign: !!camp,
          });
        }
      });
    });
    // Produits hors catalogue curaté (Saisie de commande / Péremption courte)
    specialItems.forEach((s, i) => {
      if (!(s.qty > 0)) return;
      const tiered = applyTiers(s.pn ?? null, s.tiers, s.qty);
      const pn = tiered.pn;
      items.push({
        key: `special-${s.cip || i}`,
        cat: "Hors catalogue",
        catKey: "special",
        name: s.name,
        cip: s.cip || null,
        pn,
        basePn: s.pn ?? null,
        tier: tiered.tier,
        nextTier: tiered.next,
        qty: s.qty,
        qtyUG: 0,
        total: (pn || 0) * s.qty,
        color: "#2d9cbc",
        step: 1,
        isCampaign: false,
        isSpecial: true,
        supplierCode: s.supplier_code || null,
      });
    });
    return items;
  }, [quantities, CATALOG_WITH_ADMIN, specialItems]);

  const cartTotal = cartItems.reduce((s, i) => s + i.total, 0);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  // ── Contingentement : reste autorisé par produit, rechargé à l'ouverture du panier ──
  const [quota, setQuota] = useState(null);
  const loadQuota = useCallback(async () => {
    if (!pharmacyEmail && !actingFor) return null;
    try {
      // jeton pharmacie (saisie Elixir : jeton admin), renouvelé s'il a expiré (quota-status exige un jeton)
      const r = await appelAuthentifie("/.netlify/functions/quota-status", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cip: pharmacyCip, email: pharmacyEmail, ...(actingFor ? { odoo_id: actingFor.odoo_id } : {}) }), ...delai(12000) });
      if (!r.ok) { setQuota(null); return null; }
      const j = await r.json();
      setQuota(j);
      return j;
    } catch { setQuota(null); return null; }   // Odoo indisponible : on ne bloque pas la commande (Odoo contrôle aussi)
  }, [pharmacyEmail, pharmacyCip, actingFor, appelAuthentifie]);
  useEffect(() => { setQuota(null); }, [pharmacyEmail, pharmacyCip, actingFor]);   // autre pharmacie / déconnexion
  useEffect(() => { if (cartOpen) loadQuota(); }, [cartOpen, loadQuota]);
  const quotaCheck = useMemo(() => quotaOver(quota, cartItems), [quota, cartItems]);
  const justifCheck = useMemo(() => justifIssues(cartItems, justifProducts, justifInfo), [cartItems, justifProducts, justifInfo]);
  const cartTotalsByCip = useMemo(() => qtyByCip(cartItems), [cartItems]);

  // ── Panier : invalidation si la STRUCTURE du catalogue a changé ──────────
  // Le panier est indexé par position (catKey-idx). Si l'admin ajoute / retire /
  // réordonne un produit entre deux sessions, ces index pointent alors sur
  // d'autres produits → commande faussée silencieusement. On détecte le
  // changement via une signature (liste ordonnée des CIP par section) et on
  // réinitialise le panier plutôt que d'envoyer une commande erronée. Un simple
  // changement de prix ne modifie pas les CIP → aucune invalidation.
  const catalogSig = useMemo(
    () => Object.keys(CATALOG_WITH_ADMIN).sort().map(
      k => k + ":" + (CATALOG_WITH_ADMIN[k].products || []).map(p => p.cip || "").join("|")
    ).join(";"),
    [CATALOG_WITH_ADMIN]
  );
  const sigCheckedRef = useRef(false);
  useEffect(() => {
    if (productsLoading || sigCheckedRef.current) return; // attendre le vrai catalogue chargé
    sigCheckedRef.current = true;
    try {
      const stored = localStorage.getItem("cart_catalog_sig");
      // vidage seulement si une section utilisée par le panier a changé (un nouvel onglet ne vide rien)
      const parseSig = (x) => Object.fromEntries((x || "").split(";").filter(Boolean).map(y => { const j = y.indexOf(":"); return [y.slice(0, j), y.slice(j + 1)]; }));
      const prev = parseSig(stored), cur = parseSig(catalogSig);
      const used = new Set(Object.keys(quantities).filter(k => parseInt(quantities[k]) > 0).map(k => k.slice(0, k.lastIndexOf("-"))));
      if (stored && stored !== catalogSig && [...used].some(k => prev[k] !== cur[k])) {
        setQuantities({});
        try { localStorage.removeItem("cart_quantities"); } catch {}
        flash("⚠ Catalogue mis à jour — panier réinitialisé par sécurité");
      }
      localStorage.setItem("cart_catalog_sig", catalogSig);
    } catch {}
  }, [productsLoading, catalogSig, quantities]);
  // Tient la signature à jour si le catalogue évolue en cours de session (sans re-vider)
  useEffect(() => {
    if (!productsLoading && sigCheckedRef.current) {
      try { localStorage.setItem("cart_catalog_sig", catalogSig); } catch {}
    }
  }, [catalogSig, productsLoading]);

  // Menu ouvrable : présent au catalogue ET visible (pas masqué par l'admin dans « Affichage global »).
  // Exceptions : l'admin connecté voit tout ; les outils historiques des liens ?outil= / ?cip= restent ouvrables.
  const menuOuvrable = (m) => !!CATALOG_WITH_ADMIN?.[m] && (hasAdminToken || OUTILS_LIEN.includes(m) || getOrderedTabs(CATALOG_WITH_ADMIN).includes(m));
  const menuOuvrableRef = useRef(menuOuvrable); menuOuvrableRef.current = menuOuvrable;
  // Garde-fou : si l'onglet actif n'existe plus (ex. defaultTab supprimé côté admin),
  // rebasculer sur le premier onglet valide au lieu de crasher au render.
  useEffect(() => {
    if (activeTab === "groupees" && gpAllowed === null) return; // accès en cours de vérification
    if (activeTab && CATALOG_WITH_ADMIN && !menuOuvrable(activeTab)) {
      const first = getOrderedTabs(CATALOG_WITH_ADMIN)[0];
      if (first && first !== activeTab) setActiveTab(first);
    }
  }, [activeTab, CATALOG_WITH_ADMIN, gpAllowed, configLoaded]);

  // Menu demandé par l'adresse (?menu=) : ouvert dès qu'il existe et est visible — menus promo et sections
  // perso après la config, « Commandes groupées » après la connexion, campagnes après leur chargement.
  // Oublié dès que l'utilisateur choisit lui-même un menu.
  useEffect(() => {
    const m = menuDemande.current;
    if (!m) return;
    if (menuOuvrable(m)) { menuDemande.current = ""; if (activeTab !== m) setActiveTab(m); }
  }, [configLoaded, CATALOG_WITH_ADMIN, gpAllowed]);

  // Adresse ↔ menu : l'adresse affiche toujours le menu ouvert (lien partageable, rechargement sur le même menu) ;
  // Retour / Avancer du navigateur changent de menu.
  const gpDirtyRef = useRef(gpDirty); gpDirtyRef.current = gpDirty;
  const activeTabRef = useRef(activeTab); activeTabRef.current = activeTab;
  useEffect(() => {
    if (!activeTab) return;
    let u; try { u = new URL(window.location.href); } catch { return; }
    const clic = navParClic.current; navParClic.current = false;
    if (u.searchParams.get("menu") === activeTab) return;
    u.searchParams.delete("outil"); u.searchParams.delete("tab");
    if (activeTab !== "saisie") { u.searchParams.delete("cip"); u.searchParams.delete("produit"); }
    u.searchParams.set("menu", activeTab);
    const url = u.pathname + u.search + u.hash;
    try { if (clic) window.history.pushState(null, "", url); else window.history.replaceState(null, "", url); } catch {}
  }, [activeTab]);
  useEffect(() => {
    const onPop = () => {
      const m = new URLSearchParams(window.location.search).get("menu");
      const prev = activeTabRef.current;
      if (m === prev) return;
      if (!m || !menuOuvrableRef.current(m)) {   // menu masqué ou disparu : l'adresse reste sur le menu affiché
        try { const u = new URL(window.location.href); u.searchParams.set("menu", prev); window.history.replaceState(null, "", u.pathname + u.search + u.hash); } catch {}
        return;
      }
      if (gpDirtyRef.current && !window.confirm("Vos quantités de commande groupée ne sont pas confirmées. Quitter quand même ?")) {
        try { const u = new URL(window.location.href); u.searchParams.set("menu", prev); window.history.pushState(null, "", u.pathname + u.search + u.hash); } catch {}
        return;
      }
      setGpDirty(false);
      menuDemande.current = "";
      setSearch(""); setSidebarOpen(false);
      setActiveTab(m);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Saisie de commande (lot E2) : l'ajout n'ouvre plus le panier, un message le confirme ──
  // Le contingentement, que rechargeait l'ouverture du panier, est rechargé ici à chaque ajout : un dépassement
  // est signalé aussitôt (le panier l'affiche toujours et l'envoi le contrôle encore avec les chiffres du moment).
  // Saisie de commande : une référence d'un catalogue à règle de quantité (colis Stratège / gamme blanche, palier Master,
  // campagne) suit la même règle et le même arrondi que son tableau (setQty) — sinon 4 boîtes d'un colis de 160 partaient
  // au prix carton. Même recherche que addItemToCart : premier catalogue qui contient le CIP.
  const regleSaisie = (cip) => {
    for (const [catKey, c] of Object.entries(CATALOG_WITH_ADMIN)) {
      const p = (c.products || []).find(x => x.cip === cip);
      if (!p) continue;
      const r = getStepMin(catKey, p);
      const multiple = r.multiple > 1 ? r.multiple : (r.step > 1 ? r.step : 1);
      return multiple > 1 || r.min > 1 ? { step: r.step, min: r.min, multiple, rayon: c.label || SECTION_META[catKey]?.label || catKey } : null;
    }
    return null;
  };
  const arrondiSaisie = (qty, r) => {
    const arrondi = Math.round(qty / r.multiple) * r.multiple;
    return arrondi > 0 && r.min > 0 ? Math.max(r.min, arrondi) : arrondi;
  };

  const ajouterDepuisSaisie = (saisie) => {
    let item = saisie;
    const regle = item.supplier_code ? null : regleSaisie(item.cip);
    if (regle) {
      const q = arrondiSaisie(item.qty, regle);
      if (q <= 0) { flash(`⚠ ${item.name} se commande par ${regle.multiple} (${regle.rayon}) : saisissez ${Math.max(regle.min, regle.multiple)} ou plus`, 6000); return; }
      if (q !== item.qty) item = { ...item, qty: q };
    }
    addItemToCart(item, { ouvrirPanier: false });
    if (regle && item.qty !== saisie.qty) flash(`✓ ${item.qty}× ${item.name} ajouté au panier · arrondi au colis de ${regle.multiple}`);
    const apres = [...cartItems, { cip: item.cip, qty: item.qty }];   // panier avec cet ajout (même CIP additionné)
    if (needsJustif(item, justifProducts, qtyByCip(apres))) flash(`✓ ${item.qty}× ${item.name} ajouté au panier · justificatif à joindre dans le panier`);
    loadQuota().then(q => {
      const o = quotaOver(q, apres).over.find(x => x.cip === item.cip);
      if (o) flash(`⚠ Contingentement dépassé : ${o.name || item.name} (${o.qty} au panier, reste ${o.remaining} pour cette période)`, 6000);
    });
  };

  // ── Page d'accueil (docs/accueil.md) : mêmes règles que le reste du site, rien de réécrit (le chunk reçoit le
  // catalogue, regleSaisie, ajouterDepuisSaisie et ces deux helpers) ──
  // « − » du sélecteur de l'accueil : ligne du panier de ce CIP (celle qu'addItemToCart remplit), quantité par setItemQty
  // (fonction du panier ; 0 retire la ligne)
  const modifierQte = (cip, n) => {
    const ligne = cartItems.find(i => i.cip === cip);   // lignes des menus d'abord (ordre d'addItemToCart), puis hors catalogue
    if (ligne) setItemQty(ligne, n);
  };
  // Changement de menu par l'utilisateur (barre latérale, logo, accueil) : même enchaînement que le clic d'un menu —
  // confirmation d'une commande groupée non confirmée, entrée d'historique, recherche du menu (terme), tiroir fermé.
  // cip : « Voir dans la Saisie de commande » de l'accueil pré-remplit la Saisie ; tout autre changement de menu la
  // rend vide (le CIP ne reste plus d'un passage à l'autre ; un clic sur le menu déjà ouvert ne la vide pas)
  const naviguerVers = (key, { terme = "", cip = "" } = {}) => {
    if (gpDirty && key !== activeTab && !window.confirm("Vos quantités de commande groupée ne sont pas confirmées. Quitter quand même ?")) return false;
    if (cip || key !== activeTab) setInitialProductQuery(cip);
    setGpDirty(false); navParClic.current = true; menuDemande.current = ""; setActiveTab(key); setSearch(terme || ""); setSidebarOpen(false);
    return true;
  };
  const allerAccueil = () => { if (CATALOG_WITH_ADMIN.accueil) naviguerVers("accueil"); };
  // « Offres du moment » : la fenêtre ne s'ouvre pas par-dessus l'accueil (bandeau sur grand écran et rangée sous la
  // vitrine) ; ouverte à la connexion alors que l'accueil est affiché, elle attend le premier menu ouvert (condition
  // d'affichage activeTab !== "accueil") : les menus promo gardent leur exposition à la connexion.
  // Campagne (UG, prix palier du panier) : écartée de la vitrine, comme côté serveur
  const estCampagne = (k) => !!getCampaign(k) || !!CATALOG_WITH_ADMIN[k]?.isCampaign;
  // Préchargement : sur l'accueil, GET des offres dès l'identité connue, en parallèle de products-get et du chunk (que
  // React.lazy charge au premier rendu) : pas de cascade chunk → données
  const identiteAccueil = actingFor ? `a${actingFor.odoo_id}` : (onboardingDone && pharmacyEmail ? `p${pharmacyEmail}:${jetonVersion}` : "");
  useEffect(() => { if (identiteAccueil && activeTab === "accueil") lireOffres(appelAuthentifie, identiteAccueil); }, [identiteAccueil, activeTab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cat = CATALOG_WITH_ADMIN[activeTab];
  // Si une campagne active existe pour ce tab, on surcharge label/subtitle/couleurs
  const activeCampMeta = getCampaign(activeTab);
  const catEffective = cat && activeCampMeta ? {
    ...cat,
    label:    activeCampMeta.label    || cat.label,
    subtitle: activeCampMeta.subtitle || cat.subtitle,
    color:    activeCampMeta.color    || cat.color,
    accent:   activeCampMeta.accent   || cat.accent,
    icon:     activeCampMeta.icon     || cat.icon,
  } : cat;

  // ── Laboratoires du menu (Centrale OTC) : options du filtre, ordre des groupes du tri par laboratoire ──
  // cleDe : produit → clé de son laboratoire ; labosMenu : { cle, nom, n } triés par nom (nom = l'orthographe la plus
  // fréquente du menu) ; nomDe : clé → nom. Vide sans colonne labo (avant la migration SQL) ou sans laboratoire
  // renseigné : les commandes de tri et de filtre ne s'affichent pas.
  const laboActif = LABO_SECTIONS.includes(activeTab);
  const [cleDe, labosMenu, nomDe] = useMemo(() => {
    const cles = new Map(), parCle = new Map();
    if (laboActif) for (const p of cat?.products || []) {
      const k = cleLabo(p.labo);
      cles.set(p, k);
      if (!k) continue;
      const e = parCle.get(k) || { cle: k, noms: {}, n: 0 };
      const nom = p.labo.replace(/\s+/g, " ").trim();
      e.n++; e.noms[nom] = (e.noms[nom] || 0) + 1;
      parCle.set(k, e);
    }
    const liste = [...parCle.values()].map(e => ({ cle: e.cle, n: e.n, nom: Object.keys(e.noms).sort((a, b) => e.noms[b] - e.noms[a])[0] }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
    return [cles, liste, new Map(liste.map(l => [l.cle, l.nom]))];
  }, [laboActif, cat?.products]);
  const laboChoisi = labosMenu.find(l => l.cle === cleLabo(filtreLabo)) || null;
  const modeLabo = triLabo && labosMenu.length > 0;   // tri par laboratoire (sinon A–Z)

  const filteredProducts = useMemo(() => {
    let filtered = (cat?.products || []).filter(p =>
      search === "" || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.cip && p.cip.includes(search))
    );
    if (showFavOnly) filtered = filtered.filter(p => p.cip && favorites.has(p.cip));
    if (filterStock === "instock" && !cat?.sansStock) filtered = filtered.filter(p => !p.cip || !stockData[p.cip] || stockData[p.cip]?.dispo > 0);
    if (filterStock === "rupture" && !cat?.sansStock) filtered = filtered.filter(p => p.cip && stockData[p.cip]?.dispo === 0);
    if (filterRemise) filtered = filtered.filter(p => p.pct > 0 || p.remise_eur > 0);
    if (laboChoisi) filtered = filtered.filter(p => cleDe.get(p) === laboChoisi.cle);
    if (activeTab === "otc" || activeTab === "nr") {
      // tri par laboratoire : groupes dans l'ordre des noms, produits par nom dans chaque groupe, « non renseigné » à la fin.
      // Mêmes objets que cat.products (realIdx = cat.products.indexOf(p) : clés du panier inchangées)
      if (modeLabo) {
        const rangs = new Map(labosMenu.map((l, i) => [l.cle, i]));
        const rang = (p) => rangs.get(cleDe.get(p)) ?? labosMenu.length;
        return [...filtered].sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, "fr"));
      }
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    if (activeTab === "ulabs") {
      const camp = getCampaign("ulabs");
      const groupes = buildGroupes(camp);
      return [...filtered].sort((a, b) => {
        const ai = groupes.findIndex(g => g.match(a));
        const bi = groupes.findIndex(g => g.match(b));
        const anorm = ai < 0 ? 9999 : ai;
        const bnorm = bi < 0 ? 9999 : bi;
        return anorm - bnorm || a.name.localeCompare(b.name, "fr");
      });
    }
    return filtered;
  }, [cat?.products, search, activeTab, showFavOnly, favorites, filterStock, filterRemise, stockData, laboChoisi, modeLabo, labosMenu, cleDe]);

  // Laboratoire de l'adresse inconnu du menu une fois les produits chargés (lien périmé, faute de frappe) : oublié
  useEffect(() => { if (filtreLabo && labosMenu.length && !laboChoisi) setFiltreLabo(""); }, [filtreLabo, labosMenu, laboChoisi]);
  // Adresse : &tri=labo et &labo=<laboratoire> tant que la Centrale OTC est ouverte, retirés ailleurs. replaceState :
  // Retour / Avancer changent toujours de menu (zone « adresse ↔ menu », déclarée plus haut, donc exécutée avant).
  // (aucun laboratoire connu une fois les produits chargés, colonne labo absente comprise : paramètres retirés)
  const laboConnu = laboActif && (labosMenu.length > 0 || productsLoading);
  const laboAdresse = laboConnu ? (laboChoisi?.nom || filtreLabo) : "";
  const triAdresse = laboConnu && triLabo;
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (laboAdresse) u.searchParams.set("labo", laboAdresse); else u.searchParams.delete("labo");
      if (triAdresse) u.searchParams.set("tri", "labo"); else u.searchParams.delete("tri");
      const url = u.pathname + u.search + u.hash;
      if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", url);
    } catch {}
  }, [activeTab, laboAdresse, triAdresse]);
  // Retour / Avancer vers la Centrale OTC : tri et laboratoire de cette entrée d'historique
  useEffect(() => {
    const onPop = () => {
      try { if (!LABO_SECTIONS.includes(new URLSearchParams(window.location.search).get("menu"))) return; } catch { return; }
      setFiltreLabo(paramLabo("labo")); setTriLabo(paramLabo("tri") === "labo");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Split grille/tableau
  const isGridSection = GRID_SECTIONS.includes(activeTab) || !!(cat?.withPhotos);
  const gridWithPhoto = isGridSection ? filteredProducts : [];
  const gridWithoutPhoto = isGridSection ? [] : filteredProducts;

  // Barre A–Z des menus classés par ordre alphabétique : un clic amène au premier produit de la lettre
  const lettreDe = (nom) => { const c = String(nom || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };
  const avecAlphabet = ALPHA_SECTIONS.includes(activeTab) && gridWithPhoto.length > 0;
  // tri par laboratoire : la barre A–Z suit l'initiale du laboratoire (« non renseigné » n'a pas de lettre) et la
  // lettre-X est posée sur l'en-tête du premier groupe de cette lettre, plus sur une carte
  const premierParLettre = {}, nParLabo = new Map();
  if (avecAlphabet) for (const p of gridWithPhoto) {
    const k = cleDe.get(p);
    if (modeLabo) nParLabo.set(k, (nParLabo.get(k) || 0) + 1);
    const l = modeLabo ? (k && lettreDe(nomDe.get(k))) : lettreDe(p.name);
    if (l && !premierParLettre[l]) premierParLettre[l] = p;
  }
  const allerLettre = (l) => {
    const el = document.getElementById(`lettre-${l}`);
    if (!el) return;
    const barre = document.getElementById("barre-alphabet");
    const y = el.getBoundingClientRect().top + window.scrollY - hauteurEntete - (barre?.offsetHeight || 0) - 10;
    window.scrollTo({ top: Math.max(0, y), behavior: Math.abs(y - window.scrollY) > 4000 ? "auto" : "smooth" }); // longue liste : saut direct
    // la carte visée clignote un instant (dans une grille, sa rangée contient aussi d'autres lettres)
    try { el.animate([{ outline: `3px solid ${cat?.accent || "#ef4444"}`, outlineOffset: "2px" }, { outline: "3px solid transparent", outlineOffset: "2px" }], { duration: 1600, easing: "ease-out" }); } catch {}
  };

  const handlePrint = () => {
    window.print();
  };

  const [copyStatus, setCopyStatus] = useState("");
  const handleCopy = () => {
    if (cartItems.length === 0) return;
    const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const lines = [
      `BON DE COMMANDE — ELIXIR PHARMA`,
      `Date : ${date}`,
      `Pharmacie : ${pharmacyName}`,
      ``,
      `${"─".repeat(70)}`,
      `CIP/Réf           Désignation                            Qté  P.Net    Total`,
      `${"─".repeat(70)}`,
      ...cartItems.map(i => {
        const cip = (i.cip || "—").substring(0, 16).padEnd(18);
        const nm  = i.name.substring(0, 36).padEnd(38);
        const qty = String(i.qty).padStart(4);
        const pn  = (i.pn != null ? i.pn.toFixed(2)+"€" : "—").padStart(9);
        const tot = (i.pn != null ? (i.pn*i.qty).toFixed(2)+"€" : "—").padStart(9);
        return `${cip}${nm}${qty}${pn}${tot}`;
      }),
      `${"─".repeat(70)}`,
      `TOTAL : ${cartItems.reduce((s,i)=>s+(i.pn||0)*i.qty,0).toFixed(2)} €`,
    ].join("\n");
    navigator.clipboard.writeText(lines).then(() => {
      setCopyStatus("✓ Copié !");
      setTimeout(() => setCopyStatus(""), 2500);
    }).catch(() => setCopyStatus("Erreur copie"));
  };

  const handleRibUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRibFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setRibBase64(ev.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const handleEmailLookup = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) { setOnboardingError("Veuillez saisir une adresse e-mail valide."); return; }
    setOnboardingError("");
    setObStep("loading");
    // Mode OTP : envoi d'un code à 6 chiffres (email vérifié) au lieu du simple lookup.
    if (authMode === "otp") {
      try {
        const res = await fetch("/.netlify/functions/pharmacy-otp-send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const json = await res.json();
        if (json.success) { setOtpInput(""); setObStep("otp"); }
        else if (json.unknown) { setObStep("new_client"); }
        else { setOnboardingError(json.error || "Envoi du code impossible."); setObStep("email"); }
      } catch (err) {
        setOnboardingError("Erreur de connexion. Veuillez réessayer."); setObStep("email");
      }
      return;
    }
    try {
      const res = await fetch("/.netlify/functions/pharmacy-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.found && json.pharmacy) {
        setFoundPharmacy(json.pharmacy);
        setObStep("confirm");
      } else {
        setObStep("new_client");
      }
    } catch (err) {
      setOnboardingError("Erreur de connexion. Veuillez réessayer.");
      setObStep("email");
    }
  };

  const handleConfirmPharmacy = () => {
    setPharmacyName(foundPharmacy.name);
    setPharmacyEmail(foundPharmacy.email);
    localStorage.setItem("session_name", foundPharmacy.name);
    localStorage.setItem("session_email", foundPharmacy.email);
    localStorage.setItem("session_cip", foundPharmacy.cip || "");
    setPharmacyCip(foundPharmacy.cip || "");
    setIsClient(true);
    setOnboardingDone(true);
    // Show promo popup if active promos exist
    try {
      const promos = JSON.parse(localStorage.getItem("admin_promos") || "[]");
      if (promos.some(p => p.active) && !menuViaLien.current) setPromoPopupOpen(true);
    } catch {}
  };

  const handleVerifyOtp = async () => {
    const email = emailInput.trim().toLowerCase();
    const code = otpInput.trim();
    if (code.length < 6) { setOnboardingError("Saisissez le code à 6 chiffres reçu par e-mail."); return; }
    setOnboardingError(""); setOtpBusy(true);
    try {
      const res = await fetch("/.netlify/functions/pharmacy-otp-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token: code }),
      });
      const json = await res.json();
      if (!json.success) { setOnboardingError(json.error || "Code invalide ou expiré."); setOtpBusy(false); return; }
      localStorage.setItem("pharmacy_token", json.token || "");
      if (json.refresh_token) localStorage.setItem("pharmacy_refresh_token", json.refresh_token);
      const ph = json.pharmacy || {};
      const name = ph.name || email;
      const cip = ph.cip || "";
      localStorage.setItem("session_name", name);
      localStorage.setItem("session_email", email);
      localStorage.setItem("session_cip", cip);
      setPharmacyName(name); setPharmacyEmail(email); setPharmacyCip(cip);
      setOnboardingDone(true);
      // reconnexion demandée depuis la session (envoi du panier…) : retour direct au panier, sans « Offres du moment »
      if (!reconnexion && promoSections.some(p => p.active) && !menuViaLien.current) setPromoPopupOpen(true);
    } catch (err) {
      setOnboardingError("Erreur de connexion. Veuillez réessayer.");
    } finally { setOtpBusy(false); }
  };

  const handleNewClientSubmit = async () => {
    if (!ncName.trim()) { setOnboardingError("Veuillez saisir le nom de la pharmacie."); return; }
    setOnboardingError("");
    setNcSending(true);
    // Notifie Elixir Pharma du nouveau prospect Elixir Pharma of new prospect
    try {
      await fetch("/.netlify/functions/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_params: {
          to_email: DEFAULT_RECIPIENT,
          pharmacy_name: ncName,
          pharmacy_email: emailInput.trim().toLowerCase(),
          is_client: "Non – NOUVEAU PROSPECT",
          order_date: new Date().toLocaleDateString("fr-FR"),
          order_lines: `Demande d'accès nouvelle pharmacie:\n  Nom : ${ncName}\n  Email : ${emailInput.trim()}\n  Tél : ${ncTel}\n  Ville : ${ncVille}`,
          total_ht: "—",
          nb_lignes: 0,
          nb_unites: 0,
        }}),
      });
    } catch(e) { console.error(e); }
    setNcSending(false);
    setNcSent(true);
  };

  const handleOnboarding = () => {
    // legacy fallback — not used anymore
    setOnboardingDone(true);
  };

  const expandSupplierGroups = async (items) => {
    // lignes concernées : code fournisseur connu (menu fauteuils, Saisie), ou CIP d'un groupe (panier d'une
    // version précédente, ligne du catalogue, recherche sans regroupement)
    const known = codeOfCip(await loadGroups());
    if (!items.some(i => i.supplierCode || i.isSpecial || known[i.cip])) return items;
    const data = await loadGroups({ fresh: true });   // stock du moment
    const codeOf = codeOfCip(data);
    const codeFor = (i) => i.isCampaign ? null : (i.supplierCode || codeOf[i.cip] || null);   // campagne (UG) : ligne laissée telle quelle
    // plusieurs lignes d'un même article (ancien panier : une ligne par CIP ; catalogue + menu…) : quantités
    // additionnées par prix et réparties une fois, avec le stock déjà pris par les lignes précédentes du panier
    // décompté, pour ne jamais compter deux fois le stock de la plus ancienne référence
    const used = {};   // CIP → unités déjà prises dans ce panier
    for (const i of items) if (i.isCampaign && i.cip) used[i.cip] = (used[i.cip] || 0) + i.qty;
    const keyOf = (i, c) => `${c}|${i.pn}`;
    const qtyBy = {};
    for (const i of items) { const c = codeFor(i); if (c && data?.refs?.[c]?.length) qtyBy[keyOf(i, c)] = (qtyBy[keyOf(i, c)] || 0) + i.qty; }
    const done = new Set();
    return items.flatMap(i => {
      const code = codeFor(i);
      if (!code) return [i];
      i = { ...i, supplierCode: code };
      const refs = data?.refs?.[code] || [];
      if (!refs.length) return [i];   // service indisponible : la ligne part sur sa référence
      const k = keyOf(i, code);
      if (done.has(k)) return [];   // déjà réparti avec la première ligne de l'article à ce prix
      done.add(k);
      const qty = qtyBy[k];
      const left = refs.map(r => r.available == null ? r : { ...r, available: Math.max(0, (Number(r.available) || 0) - (used[r.cip] || 0)) });
      const { lines, missing } = allocate(left, qty);
      if (!lines.length) return [{ ...i, qty, total: i.pn * qty, group: code }];
      if (missing > 0) lines[lines.length - 1].qty += missing;   // stock insuffisant : reliquat sur la dernière référence servie
      for (const l of lines) used[l.ref.cip] = (used[l.ref.cip] || 0) + l.qty;
      return lines.map(l => ({ ...i, cip: l.ref.cip, qty: l.qty, total: i.pn * l.qty, group: code }));
    });
  };

  // un seul envoi à la fois, y compris pendant l'écran « Commande envoyée » (sinon commande et demande labo en double)
  const sendingRef = useRef(false);
  // numéro de chaque commande (clé : identité, source, lignes) tant qu'elle n'est pas enregistrée : un nouvel essai garde
  // le même, order-save reconnaît alors une commande déjà enregistrée dont la réponse s'est perdue (pas de doublon)
  const idsEnvoi = useRef({});
  const handleSend = async () => {
    if (sendingRef.current || cartItems.length === 0) return;
    sendingRef.current = true;
    let sent = false;
    try { sent = await sendOrder(); }
    catch (e) { console.error("[envoi commande]", e); setSendStatus("error"); }   // une exception ne laisse jamais le bouton bloqué sur « Envoi en cours »
    finally { if (sent) setTimeout(() => { sendingRef.current = false; }, 3500); else sendingRef.current = false; }
  };
  const sendOrder = async () => {
    // Lignes « sur justificatif labo » : attestation / ordonnance / quantité maximale
    const jIssues = justifIssues(cartItems, justifProducts, justifInfo);
    if (jIssues.length) { flash(`⚠ ${jIssues[0].name} : ${jIssues[0].msg}`); return false; }
    setSendStatus("sending");
    // Session valide AVANT tout envoi (e-mail, enregistrement, PharmaML) : jeton pharmacie renouvelé si besoin, sinon
    // reconnexion par code, panier intact ; saisie Elixir : session admin (sinon commande sans mention ni trace admin)
    if (!(await sessionPourEnvoi())) { setSendStatus(null); return false; }
    // Stock d'Elixir du moment : il décide quelles lignes passent par le labo (justificatif)
    const jp = (await loadJustifProducts({ fresh: true })) || justifProducts;
    if (jp !== justifProducts) setJustifProducts(jp);
    const jIssues2 = justifIssues(cartItems, jp, justifInfo);
    if (jIssues2.length) { setSendStatus(null); setCartOpen(true); flash(`⚠ ${jIssues2[0].name} : ${jIssues2[0].msg} (stock mis à jour)`); return false; }
    // Articles à plusieurs références (même code fournisseur, ex. fauteuils livrés sous un nouveau CIP) :
    // le pharmacien a UNE ligne ; la commande est répartie par CIP, la plus ancienne référence d'abord
    // (premier entré, premier sorti), avec le stock à jour, au prix vu par le pharmacien.
    const sendItems = await expandSupplierGroups(cartItems).catch(() => cartItems);
    // Contingentement : vérification avec les quantités à jour juste avant l'envoi, sur les CIP réellement envoyés
    const freshQuota = await loadQuota();
    const blocked = quotaOver(freshQuota, sendItems).over;   // chiffres à jour ; sans réponse d'Odoo, pas de blocage
    if (blocked.length) {
      setSendStatus(null);
      flash(`⚠ Contingentement dépassé : ${blocked.map(b => `${b.name} (reste ${b.remaining})`).join(", ")}`);
      return false;
    }

    const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const totalsSend = qtyByCip(sendItems);
    const isJustif = (i) => needsJustif(i, jp, totalsSend);
    const lignesMail = (arr) => arr.map(i =>
      `• ${i.name}${i.group ? ` (CIP ${i.cip})` : ""}${isJustif(i) ? " — SUR JUSTIFICATIF LABO (" + jp[i.cip].labNom + ")" : ""}\n  Qté : ${i.qty}  |  PU : ${i.pn.toFixed(2).replace(".", ",")} €  |  Total : ${i.total.toFixed(2).replace(".", ",")} €`
    ).join("\n\n");

    // Build CSV and save order to localStorage for admin
    // Build catalog CIP lookup for fallback
    const cipLookup = {};
    Object.values(CATALOG_WITH_ADMIN).forEach(section => {
      (section.products || []).forEach(p => {
        if (p.cip && p.name) cipLookup[p.name.trim().toLowerCase()] = p.cip;
      });
    });
    const csvLines = [];
    sendItems.forEach(i => {
      let cip = i.cip || cipLookup[i.name?.trim().toLowerCase()] || "—";
      csvLines.push(`${cip.replace(/;/g,"")};${i.qty}`);
    });
    const csvContent = csvLines.join("\n");

    // E-mail de commande : lignes enregistrées seulement (lignes « justificatif » refusées : laissées au panier, hors e-mail)
    const paramsMail = (arr, total, unites) => ({
      to_email:      DEFAULT_RECIPIENT,
      pharmacy_name: actingFor ? `${pharmacyName} — saisie par Elixir` : pharmacyName,
      pharmacy_email: pharmacyEmail || "—",
      is_client:     isClient ? "Oui" : "Non (nouveau client – RIB joint)",
      order_date:    date,
      order_lines:   lignesMail(arr),
      total_ht:      total.toFixed(2).replace(".", ",") + " €",
      nb_lignes:     arr.length,
      nb_unites:     unites,
    });

    // ── 1. Enregistrement AVANT l'e-mail et le relais (correctif de sécurité du 19/10/2026) ──
    // Avant, un enregistrement refusé APRÈS l'e-mail (session expirée, panne) perdait la commande — ni admin, ni
    // PharmaML — alors que le site affichait « Commande envoyée ». Désormais : enregistrement refusé → rien ne part,
    // panier intact, motif affiché ; nouvel essai sans risque. Numéro de commande stable d'un essai à l'autre pour les
    // mêmes lignes (idsEnvoi) : si un enregistrement réussi n'a pas reçu sa réponse, order-save reconnaît le nouvel
    // essai ({ deja }) au lieu de créer un doublon. Lignes « sur justificatif labo » : commande à part (source
    // « justificatif »), jamais transmise automatiquement à PharmaML (Elixir commande au labo, puis synchronise à réception).
    const normalItems = sendItems.filter(i => !isJustif(i));
    const justifLines = sendItems.filter(isJustif);
    const toItems = (arr) => arr.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total, ...(i.group ? { group: i.group } : {}) }));
    const csvOf = (arr) => arr.map(i => `${String(i.cip || cipLookup[i.name?.trim().toLowerCase()] || "—").replace(/;/g, "")};${i.qty}`).join("\n");
    const enregistrer = async (o) => {   // → { ok: true, id } | { ok: false, status, error }
      const cle = JSON.stringify([actingFor?.odoo_id ?? null, pharmacyEmail, o.source, o.items]);
      idsEnvoi.current[cle] ??= o.id;
      for (let essai = 0; essai < 2; essai++) {
        const corps = { ...o, id: idsEnvoi.current[cle] };
        let res = null, j = {};
        try {
          res = await appelAuthentifie("/.netlify/functions/order-save", {   // jeton pharmacie, ou admin en saisie
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(actingFor ? { ...corps, enteredByAdmin: true } : corps),
            ...delai(20000),
          });
          j = await res.json().catch(() => ({}));
        } catch { res = null; }
        if (res?.ok && j.success) { delete idsEnvoi.current[cle]; return { ok: true, id: j.id || corps.id }; }
        if (res?.status === 409 && j.error === "numero") { idsEnvoi.current[cle] = Date.now() + 2; continue; }   // numéro pris par une autre commande
        console.warn("[order-save] ✗", res?.status, j.error);
        return { ok: false, status: res?.status || 0, error: j.message || j.error || "serveur injoignable" };
      }
      return { ok: false, status: 409, error: "numéro de commande déjà pris" };
    };
    // enregistrement refusé : rien n'est parti, le panier reste tel quel
    const bloquer = (r) => {
      setSendStatus(null);
      if (r.status === 400) { flash(`⚠ Commande non enregistrée : ${r.error}. Rien n'est parti, votre panier est conservé.`, 8000); return false; }
      const motif = r.status === 401 ? (actingFor ? "admin" : "reconnexion") : r.status === 403 ? (actingFor ? "admin" : "fiche") : "erreur";
      setEnvoiBloque(motif); flash(`⚠ ${MESSAGE_ENVOI_BLOQUE[motif]}`, 8000);
      return false;
    };

    const baseId = Date.now();
    let order = null, saveNormal = null;
    if (normalItems.length) {
      order = {
        id: baseId,
        date: new Date().toISOString(),
        pharmacyName,
        pharmacyEmail,
        pharmacyCip: (pharmacyCip && pharmacyCip !== "0") ? pharmacyCip : null,
        isClient,
        items: toItems(normalItems),
        totalHt: justifLines.length ? normalItems.reduce((t, i) => t + (i.total || 0), 0) : cartTotal,
        nbLignes: normalItems.length,
        csv: justifLines.length ? csvOf(normalItems) : csvContent,
        processed: false,
        source: "catalogue",
      };
      saveNormal = await enregistrer(order);
      if (!saveNormal.ok) return bloquer(saveNormal);
      console.log("[order-save] ✓ Commande sauvegardée dans Supabase");
    }
    // Commande « sur justificatif » APRÈS la commande normale (celle-ci part sans attendre le labo)
    let jSave = null;
    let keepJustif = null;   // lignes non enregistrées : laissées au panier pour être renvoyées
    if (justifLines.length) {
      const jOrder = {
        id: normalItems.length ? baseId + 1 : baseId,
        date: new Date().toISOString(),
        pharmacyName, pharmacyEmail,
        pharmacyCip: (pharmacyCip && pharmacyCip !== "0") ? pharmacyCip : null,
        isClient,
        // justificatif gardé dans la ligne : une reprise par l'admin le retrouve si la transmission échoue
        items: justifLines.map(i => ({ ...toItems([i])[0], justif: { attestation: !!justifInfo[i.cip]?.attestation,
          renouvellement: !!justifInfo[i.cip]?.renouvellement, rx: (justifInfo[i.cip]?.rx || []).map(x => x.id).filter(Boolean) } })),
        totalHt: justifLines.reduce((t, i) => t + (i.total || 0), 0),
        nbLignes: justifLines.length,
        csv: csvOf(justifLines),
        processed: false,
        source: "justificatif",
      };
      jSave = await enregistrer(jOrder);
      if (!jSave.ok) {
        if (!saveNormal) return bloquer(jSave);   // rien d'enregistré : rien ne part
        keepJustif = new Set(justifLines.map(i => i.cip));
        flash(`⚠ Lignes sur justificatif labo NON enregistrées (${jSave.error}) : elles restent dans votre panier, renvoyez-les`);
      }
    }

    // ── 2. E-mail à Elixir : la commande est enregistrée, un e-mail refusé ou perdu ne la perd plus ──
    try {
      // jeton joint (send-email : adresse de la pharmacie vérifiée)
      const mail = await appelAuthentifie("/.netlify/functions/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_params: keepJustif
          ? paramsMail(normalItems, normalItems.reduce((t, i) => t + (i.total || 0), 0), normalItems.reduce((n, i) => n + (i.qty || 0), 0))
          : paramsMail(sendItems, cartTotal, cartCount) }),
      });
      if (!mail.ok) console.warn("[send-email] e-mail non envoyé (commande enregistrée) :", mail.status);
    } catch (err) { console.warn("[send-email] e-mail non envoyé (commande enregistrée) :", err.message); }
    setSendStatus("success");

    // ── 3. Envoi automatique vers PharmaML (relais), commande normale enregistrée seulement ──
    // Le serveur relit la commande enregistrée, vérifie la pharmacie (jeton) et met les lignes EN STOCK dans
    // la file du relais, que l'agent du Mac du bureau envoie à PharmaML ; le reste attend la synchro manuelle.
    if (saveNormal?.ok) (async () => {
      if (actingFor && !(pharmacyCip && pharmacyCip !== "0")) return;   // saisie Elixir sans CIP : synchro manuelle depuis l'admin
      try {
        const ptok = actingFor ? localStorage.getItem("admin_token") : await freshPharmacyToken();
        const res = await fetch("/.netlify/functions/submit-order", {
          method: "POST",
          headers: ptok ? { "Content-Type": "application/json", "Authorization": `Bearer ${ptok}` } : { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: saveNormal.id, pharmacyName, via: "auto" }),
          ...delai(20000),
        });
        const json = await res.json().catch(() => ({}));
        if (json.queued) console.log(`[PharmaML] ✓ ${json.lignes} ligne(s) en file d'envoi (réf. ${json.reference})${json.retenues ? `, ${json.retenues} à synchroniser par Elixir` : ""}`);
        else console.log("[PharmaML] synchro par Elixir :", json.error || res.status);
      } catch (err) { console.warn("[PharmaML] envoi automatique non demandé :", err.message); }
    })();

    // ── 4. Lignes « justificatif » enregistrées : demandes au laboratoire ──
    if (jSave?.ok) {
      try {
        const auth = actingFor ? { token: localStorage.getItem("admin_token"), odooId: actingFor.odoo_id } : { getToken: freshPharmacyToken };
        await submitJustif(jSave.id, justifLines.map(i => ({ cip: i.cip, attestation: !!justifInfo[i.cip]?.attestation,
          renouvellement: !!justifInfo[i.cip]?.renouvellement, rx: (justifInfo[i.cip]?.rx || []).map(x => x.id).filter(Boolean) })), auth);
      } catch (e) {
        console.warn("[justificatif labo]", e.message);
        flash(`⚠ Commande enregistrée ; sa transmission au laboratoire sera faite par Elixir (${e.message})`);
      }
    }
    setTimeout(() => {
      setSendStatus(null);
      if (keepJustif) {
        // garder seulement les lignes « justificatif » non enregistrées (la commande normale est partie)
        setQuantities(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => {
          const i = k.lastIndexOf("-"); const p = CATALOG_WITH_ADMIN[k.slice(0, i)]?.products?.[Number(k.slice(i + 1))];
          return p && keepJustif.has(p.cip);
        })));
        setSpecialItems(prev => prev.filter(x => keepJustif.has(x.cip)));
        setJustifInfo(prev => Object.fromEntries(Object.entries(prev).filter(([c]) => keepJustif.has(c))));
      } else {
        setQuantities({});
        setSpecialItems([]);
        setJustifInfo({});
        setCartOpen(false);
      }
    }, 3000);
    return true;
  };

  // ── ONBOARDING SCREEN ──────────────────────────────────────────────
  // Refonte charte, lot 3 : fond --deep à plat, croix Elixir en filigrane (SVG statique, aria-hidden), carte paper au
  // rayon 28. Habillage seulement : étapes obStep, touche Entrée, autoFocus, appels pharmacy-* et lien Asana inchangés.
  const obBg = { position:"relative", isolation:"isolate", minHeight:"100vh", background:T.deep, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit", padding: isMobile ? "24px 12px" : 24 };
  // 24 px de padding sur mobile : à 375 px, plus de 300 px utiles pour les champs
  const obCard = { position:"relative", background:T.paper, color:T.ink, borderRadius:R.l, padding: isMobile ? 24 : 40, maxWidth:480, width:"100%", boxShadow:T.shadow3 };
  // 16 px sur mobile : Safari iOS ne zoome plus sur le champ à la saisie
  const obInput = { width:"100%", height:44, border:`1px solid ${T.lineField}`, borderRadius:R.s, padding:"0 14px", fontSize: isMobile ? 16 : 14, background:T.surface, color:T.ink, outline:"none", boxSizing:"border-box" };
  // fond pétrole et survol portés par la classe .ex-btn-petrole (un fond inline empêcherait le survol)
  const obBtn = { width:"100%", height:48, display:"flex", alignItems:"center", justifyContent:"center", gap:8, color:T.paper, border:"none", borderRadius:R.pill, padding:"0 22px", fontWeight:700, fontSize:15, whiteSpace:"nowrap", cursor:"pointer" };
  const obLabel = ui.label;
  const obTitre = { margin:"0 0 6px", fontWeight:640, fontSize:22, lineHeight:1.2, letterSpacing:"-0.02em", color:T.petrol };
  const obTexte = { fontSize:14, lineHeight:1.5, color:T.inkSoft };
  const obLien = { display:"block", width:"100%", minHeight:40, background:"none", border:"none", cursor:"pointer", fontSize:13, color:T.inkSoft, textDecoration:"underline", textUnderlineOffset:3 };
  const tonErreur = tone("danger");
  const obErreur = onboardingError && (
    <div role="alert" style={{ display:"flex", alignItems:"flex-start", gap:8, background:tonErreur.bg, border:`1px solid ${tonErreur.border}`, borderRadius:R.s, padding:"10px 14px", fontSize:13, lineHeight:1.45, color:tonErreur.fg, marginBottom:16 }}>
      <Icone nom="alerte" taille={16} style={{ marginTop:1 }} />
      <span>{onboardingError}</span>
    </div>
  );
  // marque comme la vitrine (croix sarcelle + ELIXIR / PHARMA) ; jamais d'or sur fond clair
  const obLogo = (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:28 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, color:T.teal }}>
        <CroixElixir taille={34} epaisseur={71} />
        <div style={{ display:"flex", flexDirection:"column", fontWeight:600, lineHeight:1 }}>
          <span style={{ fontSize:15, letterSpacing:"0.32em" }}>ELIXIR</span>
          <span style={{ fontSize:11, letterSpacing:"0.38em", marginTop:4 }}>PHARMA</span>
        </div>
      </div>
      <span style={{ background:T.mint, color:T.teal, borderRadius:R.pill, padding:"5px 12px", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>Bon de commande</span>
    </div>
  );
  const obFooter = (
    <>
      <div style={{ fontSize:12, lineHeight:1.5, color:T.inkMute, textAlign:"center", marginTop:20, paddingTop:16, borderTop:`1px solid ${T.lineSoft}` }}>Elixir Pharma · pharmacien@elixirpharma.fr · <span style={{ whiteSpace:"nowrap" }}>01 86 04 39 95</span></div>
    </>
  );

  if (!onboardingDone && !showAdmin && !actingFor) return (
    <div style={obBg}>
      {/* filigrane : croix de la marque, statique et décorative. Rognée par son propre calque : un overflow:hidden
          sur le fond en ferait un conteneur défilant (le focus ou un scrollIntoView y décaleraient la carte) */}
      <div aria-hidden="true" style={{ position:"absolute", inset:0, zIndex:-1, overflow:"hidden", pointerEvents:"none" }}>
        <CroixElixir style={{ position:"absolute", right: isMobile ? "-34vw" : "-6vw", bottom: isMobile ? "-10vh" : "-22vh", width: isMobile ? "120vw" : "min(62vw, 720px)", height: isMobile ? "120vw" : "min(62vw, 720px)", color:T.mint2, opacity:0.11 }} />
      </div>

      {/* ── STEP LOADING ── */}
      {obStep === "loading" && (
        <div style={obCard}>
          {obLogo}
          <div role="status" style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ width:56, height:56, borderRadius:R.pill, background:T.mint, color:T.teal, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
              <Icone nom="horloge" taille={28} />
            </div>
            <div style={{ fontWeight:640, fontSize:16, color:T.petrol }}>Recherche en cours…</div>
            <div style={{ fontSize:13, color:T.inkMute, marginTop:6 }}>Vérification dans notre système</div>
          </div>
        </div>
      )}

      {/* ── STEP 1 : EMAIL ── */}
      {obStep === "email" && (
        <div style={obCard}>
          {obLogo}
          {/* reconnexion demandée depuis la session (envoi, Mes commandes) : panier conservé, retour possible */}
          <h1 style={obTitre}>{reconnexion ? "Reconnexion" : "Bienvenue"}</h1>
          <div style={{ ...obTexte, marginBottom:28 }}>{reconnexion
            ? "Votre session doit être confirmée : saisissez votre adresse e-mail pour recevoir un code à 6 chiffres. Votre panier est conservé."
            : "Saisissez votre adresse e-mail pour accéder au catalogue"}</div>
          <label htmlFor="ident-email" style={obLabel}>Adresse e-mail</label>
          <input
            id="ident-email" type="email" autoComplete="email" value={emailInput}
            onChange={e => { setEmailInput(e.target.value); setOnboardingError(""); }}
            onKeyDown={e => e.key==="Enter" && handleEmailLookup()}
            placeholder="pharmacie@exemple.fr"
            style={{ ...obInput, marginBottom:16 }}
            autoFocus
          />
          {obErreur}
          <button className="ex-btn-petrole" onClick={handleEmailLookup} style={obBtn}>Continuer →</button>
          {reconnexion && <button onClick={annulerReconnexion} style={{ ...obLien, marginTop:8 }}>← Revenir au catalogue sans me reconnecter</button>}
          {obFooter}
        </div>
      )}

      {/* ── STEP 2 : CONFIRM ── */}
      {obStep === "confirm" && foundPharmacy && (
        <div style={obCard}>
          {obLogo}
          <h1 style={{ ...obTitre, display:"flex", alignItems:"center", gap:10 }}>
            Pharmacie reconnue
            <span style={{ width:26, height:26, borderRadius:R.pill, background:T.okBg, color:T.ok, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Icone nom="coche" taille={16} epaisseur={2.5} /></span>
          </h1>
          <div style={{ ...obTexte, marginBottom:20 }}>Nous avons trouvé un compte associé à cet e-mail :</div>
          <div style={{ background:T.surface, border:`1px solid ${T.line}`, borderRadius:R.m, padding:"16px 18px", marginBottom:24 }}>
            <div style={{ fontWeight:600, fontSize:16, color:T.ink, marginBottom:4, overflowWrap:"anywhere" }}>{foundPharmacy.name}</div>
            {foundPharmacy.street && <div style={{ fontSize:13, color:T.inkSoft }}>{foundPharmacy.street}</div>}
            <div style={{ fontSize:13, color:T.inkSoft }}>{foundPharmacy.cp} {foundPharmacy.ville}</div>
            {foundPharmacy.tel && <div className="num" style={{ fontSize:12, color:T.inkMute, marginTop:6 }}>Tél. {foundPharmacy.tel}</div>}
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:T.ink, marginBottom:14, textAlign:"center" }}>
            Êtes-vous bien cette pharmacie ?
          </div>
          {/* côte à côte dès 312 px utiles, sinon l'un sous l'autre */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:12 }}>
            <button className="ex-btn-petrole" onClick={handleConfirmPharmacy} style={{ ...obBtn, flex:"1 1 150px", width:"auto" }}><Icone nom="coche" taille={18} epaisseur={2.5} />Oui, c'est moi</button>
            <button className="ex-btn-ligne" onClick={() => { setObStep("email"); setFoundPharmacy(null); setEmailInput(""); }} style={{ flex:"1 1 150px", height:48, color:T.ink, border:"none", boxShadow:`inset 0 0 0 1.5px ${T.line}`, borderRadius:R.pill, padding:"0 22px", fontWeight:700, fontSize:14, whiteSpace:"nowrap", cursor:"pointer" }}>
              ← Retour
            </button>
          </div>
          {obFooter}
        </div>
      )}

      {/* ── STEP OTP : SAISIE DU CODE ── */}
      {obStep === "otp" && (
        <div style={obCard}>
          {obLogo}
          <h1 style={obTitre}>Vérification</h1>
          <div style={{ ...obTexte, marginBottom:24 }}>
            Un code à 6 chiffres a été envoyé à<br /><strong style={{ color:T.ink, fontWeight:600, overflowWrap:"anywhere" }}>{emailInput.trim().toLowerCase()}</strong>
          </div>
          <label htmlFor="ident-code" style={obLabel}>Code reçu par e-mail</label>
          <input
            id="ident-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpInput}
            onChange={e => { setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6)); setOnboardingError(""); }}
            onKeyDown={e => e.key === "Enter" && handleVerifyOtp()}
            placeholder="123456"
            style={{ ...obInput, marginBottom:16, padding:"0 14px 0 20px", letterSpacing:6, textAlign:"center", fontSize:22, fontWeight:700, fontVariantNumeric:"tabular-nums" }}
            autoFocus
          />
          {obErreur}
          <button className="ex-btn-petrole" onClick={handleVerifyOtp} disabled={otpBusy} style={{ ...obBtn, opacity: otpBusy ? 0.6 : 1 }}>{otpBusy ? "Vérification…" : "Se connecter →"}</button>
          <button onClick={() => { setObStep("email"); setOtpInput(""); setOnboardingError(""); }}
            style={{ ...obLien, marginTop:8 }}>
            ← Changer d'e-mail
          </button>
          {obFooter}
        </div>
      )}

      {/* ── STEP 3 : NEW CLIENT ── */}
      {obStep === "new_client" && (
        <div style={obCard}>
          {obLogo}
          <h1 style={obTitre}>Pharmacie non reconnue</h1>
          <div style={{ ...obTexte, marginBottom:24 }}>
            L'adresse <strong style={{ color:T.ink, fontWeight:600, overflowWrap:"anywhere" }}>{emailInput}</strong> n'est pas encore dans notre base clients.
          </div>
          <div style={{ background:T.mint, borderRadius:R.m, padding:"22px 20px", marginBottom:16, textAlign:"center" }}>
            <div style={{ width:52, height:52, borderRadius:R.pill, background:T.paper, color:T.teal, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
              <Icone nom="document" taille={26} />
            </div>
            <div style={{ fontWeight:640, fontSize:16, letterSpacing:"-0.01em", color:T.teal, marginBottom:8 }}>Devenez client Elixir Pharma</div>
            <div style={{ fontSize:13, lineHeight:1.5, color:T.inkSoft, marginBottom:18 }}>Remplissez notre formulaire de demande d'accès — notre équipe vous contactera sous 24h ouvrées.</div>
            <a
              href="https://form.asana.com/?k=9APiLAEcOh9v6OrT8il4mg&d=1208646355437005"
              target="_blank"
              rel="noopener noreferrer"
              className="ex-btn-petrole"
              style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", height:48, color:T.paper, borderRadius:R.pill, padding:"0 26px", fontWeight:700, fontSize:15, textDecoration:"none" }}
            >
              Accéder au formulaire →
            </a>
          </div>
          <button onClick={() => { setObStep("email"); setOnboardingError(""); }} style={obLien}>← Retour</button>
          {obFooter}
        </div>
      )}
    </div>
  );

  // Recherche globale de l'en-tête : pastille sur pétrole (même champ sur ordinateur et, sous la barre, sur mobile).
  // Lot 9 : 16 px de police sous 768 px (règle des champs de tokens.css : Safari iOS ne zoome plus à la saisie) ;
  // les petits boutons ronds de l'en-tête ont une zone de toucher de 44 px sur écran tactile (classe ex-cible)
  const rechercheGlobale = (mobile) => (
    <div style={mobile ? { position: "relative" } : { position: "relative", flex: "1 1 300px", minWidth: 150, maxWidth: 420, marginLeft: "auto" }}>
      <Icone nom="recherche" taille={16} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: T.paperMute, pointerEvents: "none" }} />
      <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Rechercher CIP ou nom…" aria-label="Rechercher un produit par CIP ou nom"
        style={{ width: "100%", height: mobile ? 40 : 36, background: T.petrolField, border: "none", borderRadius: R.pill, color: T.paper, padding: "0 36px 0 38px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
      {globalSearch && <button className="ex-icone-entete ex-icone-pastille ex-cible" onClick={() => setGlobalSearch("")} aria-label="Effacer la recherche" style={{ ...btnEntete, width: 28, height: 28, position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }}><Icone nom="fermer" taille={14} /></button>}
    </div>
  );
  // panier flottant affiché (panier fermé et non vide) : main réserve sa place en bas. Jamais sur l'accueil : il recouvrait
  // le « + » du sélecteur de la vitrine (toujours près du bas de l'écran sur téléphone) ; le compteur or de l'en-tête
  // collant reste, et c'est la cible du vol vers le panier
  const panierFlottant = !cartOpen && cartCount > 0 && activeTab !== "accueil";
  // message flash : un « ⚠ » en tête décide du ton (avertissement), sinon confirmation
  const tonFlash = tone(flashMsg.startsWith("⚠") ? "warn" : "ok");

  // Suggestions de recommande (ML) — lot 7 : carte paper à filet (plus de dégradé violet), vignettes blanches. En tête de
  // chaque vue ; sur l'accueil, rendues sous la vitrine (elles repoussaient « Ajouter » sous la ligne de flottaison)
  const blocSuggestions = showReorder && reorderSuggestions.length > 0 && (
    <section aria-labelledby="suggestions-titre" style={{ background:T.paper, borderRadius:R.m, padding:"14px 18px", marginBottom:20, border:`1px solid ${T.line}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:10 }}>
        {/* paragraphe (plus un h2) : le bloc est rendu avant le h1 des autres vues ; il reste une région nommée (section) */}
        <p id="suggestions-titre" className="num" style={{ margin:0, fontWeight:700, fontSize:14, color:T.ink, display:"flex", alignItems:"center", gap:8 }}>
          <Icone nom="ampoule" taille={18} style={{ color:T.teal }} />
          Suggestions de recommande — {reorderSuggestions.length} produit(s) à recommander
        </p>
        <button className="ex-btn-discret ex-cible" onClick={() => setShowReorder(false)} aria-label="Masquer les suggestions de recommande" title="Masquer"
          style={ui.rond(30)}><Icone nom="fermer" taille={14} epaisseur={2.4} /></button>
      </div>
      <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:6 }}>
        {reorderSuggestions.map(s => (
          <div key={s.cip} className="ex-carte" style={{
            background:T.surface, borderRadius:R.s, padding:"10px 14px", minWidth:180, flexShrink:0,
            cursor:"pointer",
          }} onClick={() => {
            // Cherche le produit dans le catalogue et ajoute 1
            let added = false;
            Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, c]) => {
              if (added) return;
              const idx = (c.products || []).findIndex(p => p.cip === s.cip);
              if (idx >= 0) {
                setQuantities(prev => ({ ...prev, [`${catKey}-${idx}`]: s.suggested_qty || 1 }));
                added = true;
              }
            });
            if (added) flash(`✓ ${s.suggested_qty || 1}x ${s.name} ajouté`);
          }}>
            <div style={{ fontWeight:600, fontSize:12, color:T.ink, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
            <div style={{ fontSize:11, color:T.inkMute, fontFamily:T.mono }}>CIP {s.cip}</div>
            <div className="num" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
              <span style={{ fontSize:12, color:T.ink, fontWeight:700 }}>×{s.suggested_qty}</span>
              <span style={{ fontSize:11, color:T.warn, fontWeight:600 }}>il y a {s.days_since_last} j</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="ex-app" style={{ fontFamily: "inherit", minHeight: "100vh", background: T.cream, color: T.ink, display: "flex", flexDirection: "column", paddingLeft: isDesktop ? 248 : 0, transition: "padding-left 0.2s ease" }}>

      {/* ── SIDEBAR (navigation colonne gauche) ── */}
      {!isDesktop && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 140 }} />
      )}
      <aside style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: 248, background: T.paper,
        borderRight: `1px solid ${T.line}`, zIndex: 150, display: "flex", flexDirection: "column",
        transform: (isDesktop || sidebarOpen) ? "translateX(0)" : "translateX(-100%)",
        // revue (§ 20) : tiroir fermé (mobile, tablette) masqué une fois sorti de l'écran — ses boutons ne prennent plus
        // le focus à la tabulation (focus invisible) ; ouvert, visible tout de suite. Impression : tokens.css le rétablit
        visibility: (isDesktop || sidebarOpen) ? "visible" : "hidden",
        transition: `transform 0.25s ease, visibility 0s linear ${(isDesktop || sidebarOpen) ? "0s" : "0.25s"}`, overflowY: "auto"
      }}>
        {/* Marque : bloc pétrole à la hauteur de l'en-tête (sur ordinateur, ils forment une seule bande) */}
        <div className="ex-marque ex-on-dark" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexShrink: 0,
          height: isDesktop ? hauteurEntete : undefined, padding: isDesktop ? "0 20px" : "12px 12px 12px 20px",
          background: T.petrol, color: T.paper,
        }}>
          {/* logo : bouton « Accueil » (convention du logo) */}
          <button className="acc-logo ex-icone-entete" onClick={allerAccueil} aria-label="Accueil">
            <CroixElixir taille={26} style={{ color: T.orClair }} />
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.28em", lineHeight: 1 }}>ELIXIR</span>
          </button>
          {!isDesktop && (
            <button className="ex-icone-entete ex-cible" onClick={() => setSidebarOpen(false)} aria-label="Fermer le menu" style={btnEntete}><Icone nom="fermer" /></button>
          )}
        </div>
        <nav aria-label="Menus" style={{ padding: "8px 0 16px" }}>
        {/* « Accueil » : première entrée, hors des groupes (groupe sans titre) */}
        {[
          { title: "", keys: CATALOG_WITH_ADMIN.accueil ? ["accueil"] : [] },
          { title: "CATALOGUES", keys: getOrderedTabs(CATALOG_WITH_ADMIN).filter(k => !["saisie", "peremption", "fauteuil", "transfert", "justificatif", "ulabs", "groupees", "accueil"].includes(k)) },
          { title: "OUTILS", keys: getOrderedTabs(CATALOG_WITH_ADMIN).filter(k => ["saisie", "peremption", "fauteuil", "transfert", "justificatif", "ulabs", "groupees"].includes(k)) },
        ].map(group => group.keys.length === 0 ? null : (
          <div key={group.title} style={{ marginBottom: 6 }}>
            {group.title && <div style={{ padding: "12px 22px 6px", fontSize: 11, letterSpacing: "0.14em", color: T.inkMute, fontWeight: 700 }}>{group.title}</div>}
            {group.keys.map(key => {
              const c = CATALOG_WITH_ADMIN[key];
              if (!c) return null;
              const active = activeTab === key;
              // tiroir (mobile, tablette, lot 9) : entrées de 44 px au doigt ; libellé long sur deux lignes au plus (plus de
              // « Commande labo sur justif… »), barre fixe d'ordinateur comprise depuis la revue (§ 20)
              return (
                <button key={key} className="ex-menu" aria-current={active ? "page" : undefined} title={c.label} onClick={() => naviguerVers(key)} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 20px)", margin: "1px 10px", textAlign: "left",
                  background: active ? T.mint : undefined, border: "none", borderRadius: isDesktop ? R.pill : 22,
                  color: active ? T.teal : T.inkSoft, padding: isDesktop ? "8px 12px" : "10px 12px", minHeight: isDesktop ? undefined : 44, cursor: "pointer",
                  fontSize: isDesktop ? 13 : 14, fontWeight: active ? 600 : 500, fontFamily: "inherit", lineHeight: 1.3,
                }}>
                  <span aria-hidden="true" style={{ fontSize: 15, width: 20, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{iconeMenu(key, c)}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflowWrap: "anywhere" }}>{c.label}</span>
                </button>
              );
            })}
          </div>
        ))}
        {/* Assistant Elixir : groupe « AIDE » sous « OUTILS » (ouvre le panneau, ce n'est pas un onglet du catalogue) */}
        {assistantDispo && <GroupeAide isDesktop={isDesktop} infos={assistant.infos} onOuvrir={() => ouvrirAssistant()} />}
        </nav>
      </aside>

      {/* ── PROMO POPUP « Offres du moment » (lot 7) : fenêtre paper de rayon 28 sur voile --scrim, sans flou ; la couleur
          de chaque menu promo (saisie dans l'admin) n'est plus qu'un filet et une pastille d'icône, textes aux jetons ── */}
      {promoPopupOpen && activeTab !== "accueil" && promoSections.some(p => p.active) && (
        <div role="dialog" aria-modal="true" aria-labelledby="offres-titre" style={{ ...ui.overlay, zIndex:2000 }}>
          <div style={{ ...ui.modal, maxHeight:"calc(100vh - 32px)", overflowY:"auto", padding: isMobile ? "22px 18px" : "28px 32px" }}>
            <FocusFenetre />{/* revue (§ 20) : focus sur « Fermer » à l'ouverture, rendu à la fermeture */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:20 }}>
              <div>
                <h2 id="offres-titre" style={ui.titreModal}><Icone nom="cadeau" taille={22} style={{ color:T.teal }} />Offres du moment</h2>
                <div style={{ fontSize:13, color:T.inkSoft, marginTop:6 }}>Des promotions exclusives sont disponibles cette semaine !</div>
              </div>
              <button className="ex-btn-discret ex-cible" data-focus-initial onClick={() => setPromoPopupOpen(false)} aria-label="Fermer" title="Fermer" style={ui.rond(36)}><Icone nom="fermer" taille={18} /></button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {promoSections.filter(p => p.active).map(ps => {
                // pastille d'icône : teinte à 14 % d'une couleur hex de l'admin, menthe sinon (comme EnteteVue)
                const teinte = alpha(ps.color, 0.14);
                return (
                <button key={ps.id} className="ex-carte" onClick={() => { navParClic.current = true; menuDemande.current = ""; setActiveTab(`promo_${ps.id}`); setPromoPopupOpen(false); }} style={{
                  display:"flex", alignItems:"center", gap:14, background:T.surface, color:T.ink,
                  borderLeft:`3px solid ${ps.color || T.line}`, borderRadius:R.m, padding:"14px 16px", cursor:"pointer", textAlign:"left", width:"100%", fontFamily:"inherit"
                }}>
                  <span aria-hidden="true" style={{ width:44, height:44, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
                    background: typeof teinte === "string" && teinte.startsWith("rgba(") ? teinte : T.mint, color:T.petrol }}>{ps.icon || <Icone nom="etiquette" taille={22} />}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:15, color:T.ink }}>{ps.name}</div>
                    {ps.description && <div style={{ fontSize:12, color:T.inkSoft, marginTop:2 }}>{ps.description}</div>}
                    {ps.endDate && <div className="num" style={{ fontSize:12, color:T.warn, marginTop:4, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}><Icone nom="horloge" taille={13} />Jusqu’au {dateFin(ps.endDate)}</div>}
                    <div className="num" style={{ fontSize:12, color:T.teal, fontWeight:700, marginTop:4 }}>{(ps.products||[]).length} référence(s) · Voir les offres</div>
                  </div>
                  <Icone nom="suivant" taille={20} style={{ color:T.inkMute }} />
                </button>
                );
              })}
            </div>
            <button className="ex-btn-ligne" onClick={() => setPromoPopupOpen(false)} style={{ ...ui.btn("ligne", "l"), background:undefined, width:"100%", height:44, fontSize:14, marginTop:20, boxShadow:`inset 0 0 0 1.5px ${T.lineField}` }}>
              Continuer vers le catalogue
            </button>
          </div>
        </div>
      )}

      {/* ── EN-TÊTE (pétrole, collant) ── */}
      <header ref={refEntete} className="ex-on-dark" style={{
        background: T.petrol, color: T.paper, position: "sticky", top: 0, zIndex: 90,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14, padding: isMobile ? "10px 12px" : "12px 22px", minHeight: isMobile ? undefined : 64 }}>
          {/* titre : jamais plus de 30 % de la barre (libellé long → points de suspension) ; la recherche prend le reste.
              Revue (§ 20) : 22 % entre 1 024 et 1 279 px, « Bon de commande » masqué (classe ex-titre-vue, tokens.css) —
              la recherche garde ~240 px à 1 024 px (180 avant, texte d'aide tronqué) */}
          <div className={isDesktop ? "ex-titre-vue" : undefined} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "0 0 auto" }}>
            {!isDesktop && (
              <button className="ex-icone-entete ex-cible" onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu" aria-expanded={sidebarOpen} style={btnEntete}><Icone nom="menu" /></button>
            )}
            {!isDesktop && (
              <button className="acc-logo ex-icone-entete" onClick={allerAccueil} aria-label="Accueil">
                <CroixElixir taille={24} style={{ color: T.orClair }} />
                <span className="ex-mot-elixir" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.28em", lineHeight: 1 }}>ELIXIR</span>
              </button>
            )}
            {isDesktop && (
              <div style={{ minWidth: 0 }}>
                <div title={CATALOG_WITH_ADMIN[activeTab]?.label || undefined} style={{ fontSize: 16, fontWeight: 640, letterSpacing: "-0.01em", color: T.paper, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {CATALOG_WITH_ADMIN[activeTab]?.label || "Catalogue"}
                </div>
                <div style={{ fontSize: 11, color: T.paperMute, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                  <span className="ex-titre-vue__bdc">Bon de commande</span>
                  {stockUpdatedAt && (
                    <span className="num"><span className="ex-titre-vue__bdc" style={{ marginLeft: 6 }}>· </span>stocks {new Date(stockUpdatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                  <button onClick={handleRefresh} disabled={stockRefreshing || stockLoading} aria-label="Actualiser les stocks"
                    title={stockRefreshing ? "Actualisation Odoo en cours (~40s)…" : "Forcer la mise à jour depuis Odoo"}
                    style={{ marginLeft: 4, background: "none", border: "none", borderRadius: R.pill, cursor: (stockRefreshing || stockLoading) ? "default" : "pointer", padding: 3, opacity: (stockRefreshing || stockLoading) ? 0.4 : 0.8, color: "inherit", display: "inline-flex" }}
                  ><Icone nom={stockRefreshing ? "horloge" : "actualiser"} taille={13} /></button>
                </div>
              </div>
            )}
          </div>
          {!isMobile && rechercheGlobale(false)}
          {/* mobile (lot 9) : le groupe de droite peut céder de la place — le nom de la pharmacie se raccourcit (jusqu'à
              140 px, au lieu de 80 qui n'affichaient que « PHARMACIE … ») plutôt que de pousser la page en largeur
              quand le compteur du panier grandit ; les boutons, eux, gardent leur taille */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: isMobile ? 1 : 0, minWidth: 0, marginLeft: isMobile ? "auto" : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, height: 36, minWidth: 0, background: T.petrolField, borderRadius: R.pill, padding: "0 4px 0 12px" }}>
              {/* or orangé clair (saisie Elixir pour une pharmacie) : 8,5:1 sur pétrole. Largeur du nom (revue, § 20) : 140 px sur
                  mobile ; ailleurs classe ex-nom-pharmacie, clamp(110px, 10vw, 150px), jusqu'à 220 px dès 1 280 px.
                  Crayon au trait au lieu de l'emoji 🛠 (comme le bandeau de saisie et l'admin, lots 7 et 10) */}
              <span title={pharmacyName} className={isMobile ? undefined : "ex-nom-pharmacie"} style={{ fontSize: isMobile ? 11 : 12, fontWeight: 600, color: actingFor ? "#fdba74" : T.paper, maxWidth: isMobile ? 140 : undefined, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", marginRight: 4 }}>{actingFor && <Icone nom="crayon" taille={12} epaisseur={2.4} style={{ marginRight: 4 }} />}{pharmacyName}</span>
              {!actingFor && hasAdminToken && <button className="ex-icone-entete ex-icone-pastille" onClick={() => setShowPharmacyPicker(true)} title="Commander à la place d'une pharmacie (saisie Elixir)" aria-label="Commander pour une pharmacie" style={{ ...btnEntete, width: 28, height: 28 }}><Icone nom="crayon" taille={15} /></button>}
              {/* zone de toucher élargie (ex-cible) seulement sans le bouton crayon voisin (2 px d'écart : elle le chevaucherait) */}
              {!actingFor && <button className={hasAdminToken ? "ex-icone-entete ex-icone-pastille" : "ex-icone-entete ex-icone-pastille ex-cible"} onClick={handleLogout} title="Se déconnecter" aria-label="Se déconnecter" style={{ ...btnEntete, width: 28, height: 28 }}><Icone nom="deconnexion" taille={16} /></button>}
            </div>
            {!isMobile && <button className="ex-icone-entete" onClick={handlePrint} title="Imprimer" aria-label="Imprimer" style={btnEntete}><Icone nom="imprimer" /></button>}
            {/* Assistant Elixir : avant « Mes commandes » ; data-assistant-ouvrir : le focus y revient à la fermeture du panneau */}
            {assistantDispo && (
              <button className="ex-icone-entete ex-cible" data-assistant-ouvrir onClick={() => (assistantOuvert ? setAssistantOuvert(false) : ouvrirAssistant())}
                title="Assistant Elixir" aria-label="Assistant Elixir" aria-expanded={assistantOuvert} style={btnEntete}><Icone nom="bulle" /></button>
            )}
            {pharmacyCip && pharmacyCip !== "0" && (
              <button className="ex-icone-entete ex-cible" onClick={() => { setShowMyOrders(true); fetchMyOrders(); }} title="Mes commandes" aria-label="Mes commandes" style={btnEntete}><Icone nom="commandes" /></button>
            )}
            {/* panier rempli : pastille or + encre avec le compteur (seul rôle de l'or dans l'en-tête) */}
            <button data-cible-panier className={cartCount > 0 ? "ex-cible" : "ex-icone-entete ex-cible"} onClick={() => setCartOpen(!cartOpen)} aria-expanded={cartOpen}
              aria-label={cartCount > 0 ? `Panier : ${cartCount} unité${cartCount > 1 ? "s" : ""}` : "Panier (vide)"} title="Panier"
              style={cartCount > 0
                ? { ...btnEntete, width: "auto", gap: 6, padding: "0 13px 0 10px", background: T.or, color: T.ink, fontSize: 13, fontWeight: 700 }
                : btnEntete}>
              <Icone nom="panier" />
              {cartCount > 0 && <span className="num">{cartCount}</span>}
            </button>
          </div>
        </div>

        {/* Recherche (mobile : sous la barre) */}
        {isMobile && (
          <div style={{ padding: "0 12px 10px" }}>
            {rechercheGlobale(true)}
          </div>
        )}
      </header>

      <div style={{ display: "flex", flex: 1, position: "relative" }}>
        {/* Main content */}
        {/* bas réservé aux boutons flottants : panier (96 px), lanceur de l'Assistant Elixir (+72 px, posé au-dessus du panier) */}
        <main style={{ flex: 1, padding: isMobile ? `12px 10px ${(panierFlottant ? 96 : 12) + (assistantDispo ? 72 : 0)}px` : `20px 24px ${(panierFlottant ? 96 : 20) + (assistantDispo ? 72 : 0)}px`, minWidth: 0 }}>

          {/* Flash toast — région annoncée toujours présente (le message y apparaît) ; « ⚠ » en tête = ton avertissement.
              Sous l'en-tête collant : sur mobile (lot 9), pour ne plus cacher le compteur du panier qui vient de changer ;
              sur ordinateur aussi depuis la revue (§ 20), il ne couvre plus la recherche de l'en-tête */}
          <div role="status" aria-live="polite" style={{ position:"fixed", top: hauteurEntete + 8, left:"50%", transform:"translateX(-50%)", zIndex:9999,
            width:"max-content", maxWidth:"calc(100vw - 32px)", pointerEvents:"none" }}>
            {flashMsg && (
              <div style={{
                background: tonFlash.bg, color: tonFlash.fg, border: `1px solid ${tonFlash.border}`,
                padding:"10px 20px", borderRadius:R.m, fontSize:13, fontWeight:600, lineHeight:1.4, boxShadow:T.shadow2,
                animation:"fadeIn 0.2s" }}>
                {flashMsg}
              </div>
            )}
          </div>

          {/* Saisie par Elixir pour une pharmacie : orange conservé (décision de la cliente : ne pas confondre avec une promo or),
              ton « acting » de theme.js (6,88:1), boutons en pastilles */}
          {actingFor && (
            <div role="status" style={{ background: tone("acting").bg, border: `1.5px solid ${tone("acting").fg}`, borderRadius: R.m, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {/* outil interne Elixir (ni catalogue ni prix) : CIP et e-mail de la pharmacie servie restent sélectionnables
                  malgré l'anti-copie (ex-selectionnable, revue § 20) */}
              <div className="ex-selectionnable" style={{ flex: 1, minWidth: 220, fontSize: 13, color: T.acting, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Icone nom="crayon" taille={18} style={{ marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <b>Commande saisie par Elixir pour {actingFor.name}</b>{actingFor.city ? ` (${actingFor.city})` : ""}
                  <div className="num" style={{ fontSize: 12, marginTop: 2 }}>{actingFor.cip ? `CIP ${actingFor.cip}` : <><Icone nom="alerte" taille={12} style={{ marginRight: 4 }} />pas de CIP dans Odoo : la commande sera enregistrée mais ne partira pas seule à PharmaML</>}{actingFor.email ? ` · ${actingFor.email}` : " · sans compte sur le site"} — le panier est envoyé au nom de cette pharmacie.</div>
                </div>
              </div>
              <button onClick={() => setShowPharmacyPicker(true)} style={{ ...ui.btn("ligne", "s"), background: T.surface, color: T.acting, boxShadow: `inset 0 0 0 1px ${tone("acting").border}` }}>Changer de pharmacie</button>
              <button onClick={stopActing} style={{ ...ui.btn("primaire", "s"), background: T.acting, color: "#fff" }}>Terminer</button>
            </div>
          )}

          {/* Suggestions de recommande (ML) : en tête de chaque vue ; sur l'accueil, sous la vitrine et les offres (Accueil.jsx) */}
          {activeTab !== "accueil" && blocSuggestions}

          {/* ── GLOBAL SEARCH RESULTS (Odoo) ── */}
          {globalSearch.trim().length >= 2 && (
            <div style={{ marginBottom: 24 }}>
              {/* titre posé sur le fond de page (cream) : encre ; était #f0f0f0, pensé pour l'ancien fond noir */}
              <div style={{ fontWeight: 700, fontSize: 16, color: T.ink, marginBottom: 12, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <Icone nom="recherche" taille={18} style={{ color: T.teal }} /> Résultats pour « {globalSearch} »
                {globalSearching && <span style={{ fontSize:12, color:T.inkSoft, fontWeight:500, display:"inline-flex", alignItems:"center", gap:8 }}><span className="ex-roue" aria-hidden="true" />Recherche…</span>}
                {!globalSearching && <span className="num" style={{ ...ui.badge("neutral"), fontSize:12, fontWeight:500, padding:"2px 10px" }}>
                  {globalResults.length} produit{globalResults.length > 1 ? "s" : ""} · stock Odoo temps réel
                </span>}
              </div>
              {/* lot 8 : première recherche en cours → lignes squelettes (plus de carte vide) ; aucun résultat → état vide */}
              {globalSearching && globalResults.length === 0 ? (
                <SqueletteCatalogue mobile={isMobile} lignes={4} entete={false} texte="Recherche en cours…" />
              ) : !globalSearching && globalResults.length === 0 ? (
                <EtatVide cadre compact icone="recherche" titre={<>Aucun produit trouvé pour « {globalSearch} »</>}
                  texte="Vérifiez l’orthographe ou cherchez par code CIP / EAN." />
              ) : (
                /* Résultats (lot 5) : carte blanche, lignes .ex-tr (zébrure, survol, rupture) disposées par .ex-resultat
                   (sous 768 px : nom sur toute la largeur, puis prix et « + Panier ») ; statut toujours écrit */
                <div style={{ background:T.surface, border:`1px solid ${T.line}`, borderRadius:R.m, overflow:"hidden", boxShadow:T.shadow1 }}>
                  {globalResults.map((p, i) => {
                    const jr = !p.in_stock ? justifProducts[p.cip] : null;   // sur commande labo (justificatif) : commandable
                    return (
                    <div key={p.cip || i} className="ex-tr ex-resultat" data-rupture={p.in_stock || jr ? undefined : ""}>
                      {/* Info : nom, statut, CIP */}
                      <div className="ex-resultat-info">
                        <div className="ex-resultat-nom" title={p.name} style={{ fontWeight:600, fontSize:13, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                        <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"3px 10px", marginTop:4 }}>
                          <BadgeStatut statut={p.in_stock ? "stock" : jr ? "commande" : "rupture"}
                            title={jr ? `Commandé au laboratoire ${jr.labNom} sur justificatif de votre commande` : undefined} />
                          {/* CIP avec bouton de copie (CipCell : le CIP n'est plus sélectionnable, anti-copie § 19 ; revue § 20) */}
                          <span style={{ fontSize:12, color:T.inkMute, display:"inline-flex", alignItems:"center", gap:4 }}>CIP <CipCell cip={p.cip} />{p.available > 0 ? ` · ${p.available} dispo` : ""}</span>
                        </div>
                      </div>

                      {/* Prix HT : barré --ink-mute, remise en badge or + encre, prix net encre 700 (affichage français) */}
                      <div className="ex-resultat-prix">
                        {p.discounted_price && p.discount_pct > 0 ? (<>
                          <div style={{ fontSize:11, lineHeight:1.6 }}>
                            <span className="num" style={{ color:T.inkMute, textDecoration:"line-through" }}>{fmtEur(parseFloat(p.list_price))}</span>{" "}
                            <span className="num" style={{ ...ui.badge("promo"), padding:"0 6px" }}>{fmtPctFr(p.discount_pct)}</span>
                          </div>
                          <div className="num" style={{ fontSize:15, fontWeight:700, color:T.ink }}>{fmtEur(parseFloat(p.discounted_price))}</div>
                        </>) : (
                          <div className="num" style={{ fontSize:15, fontWeight:700, color:T.ink }}>{p.list_price ? fmtEur(parseFloat(p.list_price)) : "—"}</div>
                        )}
                      </div>

                      {/* Add to cart : pastille pétrole (survol sarcelle, classe ex-btn-petrole ; 44 px sous 768 px,
                          ex-tactile) ; gestionnaire inchangé */}
                      <button className="ex-btn-petrole ex-resultat-action ex-tactile" aria-label={`Ajouter ${p.name} au panier`} onClick={() => {
                        const pn = p.discounted_price || p.list_price;
                        if (!pn) return;
                        // Cherche dans le catalogue existant
                        let added = false;
                        Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, c]) => {
                          if (added) return;
                          const idx = (c.products || []).findIndex(cp => cp.cip === p.cip);
                          if (idx >= 0) {
                            setQuantities(prev => ({ ...prev, [`${catKey}-${idx}`]: (parseInt(prev[`${catKey}-${idx}`]) || 0) + 1 }));
                            added = true;
                          }
                        });
                        if (!added && justifProducts[p.cip]) {   // sur commande labo (justificatif) : ligne hors catalogue
                          addItemToCart({ cip: p.cip, name: p.name, qty: 1, pn, pv: p.list_price, tiers: p.price_tiers || null });
                          trackSearch(globalSearch.trim(), globalResults.length, p.cip, true);
                        } else if (added) {
                          flash(`✓ ${p.name} ajouté au panier`);
                          trackSearch(globalSearch.trim(), globalResults.length, p.cip, true);
                        } else {
                          flash(`⚠ ${p.name} n'est pas dans le catalogue. Utilisez la Saisie de commande.`);
                          trackSearch(globalSearch.trim(), globalResults.length, p.cip, false);
                        }
                      }} style={{ ...ui.btn("primaire", "s"), background: undefined, color: undefined, gap: 4, padding: "0 14px", flexShrink: 0 }}>
                        <Icone nom="plus" taille={14} epaisseur={2.6} />Panier
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── PAGE D'ACCUEIL « La Tête de gondole » (docs/accueil.md) : chunk à la demande, squelette en attendant.
              L'ajout passe par ajouterDepuisSaisie (règle du catalogue, justificatif, contingentement), « − » par setItemQty ── */}
          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "accueil" && (
            <React.Suspense fallback={<SqueletteAccueil mobile={isMobile} />}>
              <Accueil
                identite={identiteAccueil}
                lireOffres={() => lireOffres(appelAuthentifie, identiteAccueil)}
                catalogue={CATALOG_WITH_ADMIN}
                catalogueCharge={!productsLoading}
                ordre={getOrderedTabs(CATALOG_WITH_ADMIN)}
                iconeMenu={iconeMenu}
                regleSaisie={regleSaisie}
                menuOuvrable={menuOuvrable}
                estCampagne={estCampagne}
                justifProducts={justifProducts}
                stockData={stockData}
                qteAuPanier={cartTotalsByCip}
                onAjouter={ajouterDepuisSaisie}
                onModifier={modifierQte}
                onOuvrirPanier={() => setCartOpen(true)}
                naviguer={naviguerVers}
                voirDansSaisie={(cip) => naviguerVers("saisie", { cip })}
                reglages={getDisplayConfig().accueil || {}}
                pauseExterne={cartOpen || showMyOrders || assistantOuvert}
                promos={promoSections}
                ouvrirMesCommandes={pharmacyCip && pharmacyCip !== "0" ? () => { setShowMyOrders(true); fetchMyOrders(); } : null}
                dateFin={dateFin}
                suggestions={blocSuggestions}
              />
            </React.Suspense>
          )}

          {/* ── SPECIAL VIEWS : Saisie de commande & Péremption courte ── */}
          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "orderEntry" && (
            <OrderEntry
              key={initialProductQuery}
              justifProducts={justifProducts}
              pharmacyCip={pharmacyCip}
              pharmacyName={pharmacyName}
              pharmacyEmail={pharmacyEmail}
              onAddToCart={ajouterDepuisSaisie}
              regleQuantite={regleSaisie}
              fetchAuth={appelAuthentifie}
              initialQuery={initialProductQuery}
              icone={iconeMenu(activeTab, CATALOG_WITH_ADMIN[activeTab], 24)}
              couleur={CATALOG_WITH_ADMIN[activeTab].accent}
            />
          )}

          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "groupPurchases" && (
            actingFor
              ? <div style={{ ...ui.card, fontSize: 14, color: T.inkSoft }}>En saisie pour une pharmacie, les commandes groupées se passent depuis l'admin : opération → « 🛒 Saisir une commande ».</div>
              : gpAllowed === "reconnexion"
              ? <EtatVide cadre icone="cadenas" titre="Commandes groupées : reconnectez-vous"
                  texte="Votre session doit être confirmée avec le code reçu par e-mail. Si votre pharmacie participe à une commande groupée, vous la retrouverez ici après la reconnexion."
                  actions={<ActionEtat principal icone="cadenas" onClick={demanderReconnexion}>Se reconnecter</ActionEtat>} />
              : <GroupOrders pharmacyCip={pharmacyCip} pharmacyEmail={pharmacyEmail} onDirtyChange={setGpDirty} fetchAuth={appelAuthentifie}
                  icone={iconeMenu(activeTab, CATALOG_WITH_ADMIN[activeTab], 24)} couleur={CATALOG_WITH_ADMIN[activeTab].accent} />
          )}

          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "wheelchair" && (
            <WheelchairOrder onAddToCart={addItemToCart}
              icone={iconeMenu(activeTab, CATALOG_WITH_ADMIN[activeTab], 24)} couleur={CATALOG_WITH_ADMIN[activeTab].accent} />
          )}
          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "transferChair" && (
            <WheelchairOrder key="transfert" lineKey="transfert" onAddToCart={addItemToCart}
              icone={iconeMenu(activeTab, CATALOG_WITH_ADMIN[activeTab], 24)} couleur={CATALOG_WITH_ADMIN[activeTab].accent} />
          )}
          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "labJustif" && (
            <LabJustifOrder key={actingFor ? `a${actingFor.odoo_id}` : `p${pharmacyCip}`}
              identite={actingFor ? `a${actingFor.odoo_id}` : `p${pharmacyCip}`}
              auth={actingFor ? { token: localStorage.getItem("admin_token"), odooId: actingFor.odoo_id } : { getToken: freshPharmacyToken }}
              onAddToCart={addItemToCart} onOrdered={fetchMyOrders}
              icone={iconeMenu(activeTab, CATALOG_WITH_ADMIN[activeTab], 24)} couleur={CATALOG_WITH_ADMIN[activeTab].accent} />
          )}

          {CATALOG_WITH_ADMIN[activeTab]?.specialView === "shortExpiry" && (
            <ShortExpiry
              isAdmin={showAdmin}
              pharmacyCip={pharmacyCip}
              onAddToCart={addItemToCart}
              icone={iconeMenu(activeTab, CATALOG_WITH_ADMIN[activeTab], 24)}
              couleur={CATALOG_WITH_ADMIN[activeTab].accent}
            />
          )}

          {/* ── CATALOG NORMAL (masqué si vue spéciale active ou onglet inexistant) ── */}
          {CATALOG_WITH_ADMIN[activeTab] && !CATALOG_WITH_ADMIN[activeTab]?.specialView && (<>

          {/* ── ML: Réapprovisionnement suggéré ── */}
          {pharmacyCip && (
            <ReorderSuggestion
              pharmacyCip={pharmacyCip}
              fetchAuth={appelAuthentifie}
              onApply={(cart) => {
                // Cherche l'index de chaque CIP dans le catalogue et pré-remplit
                Object.entries(cart).forEach(([cip, qty]) => {
                  Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, c]) => {
                    const idx = (c.products || []).findIndex(p => p.cip === cip);
                    if (idx >= 0) setQuantities(prev => ({ ...prev, [`${catKey}-${idx}`]: qty }));
                  });
                });
              }}
            />
          )}

          {/* Category header : en-tête de vue (refonte charte, lot 4) — la couleur du rayon n'est plus qu'un filet
              et une pastille d'icône ; titres, compteurs et filtres aux jetons */}
          <EnteteVue
            icone={iconeMenu(activeTab, catEffective, 24)}
            couleur={catEffective.accent}
            titre={catEffective.label}
            sousTitre={catEffective.subtitle}
            actions={hasAdminToken && <LienMenu menu={activeTab} />}
            aside={activeTab === "ulabs"
              ? <CompteurVue valeur={new Set(groupOrders.map(r => r.pharmacy_cip)).size} libelle="Pharmacies participantes" />
              : <CompteurVue valeur={(cat.products||[]).length} libelle={(cat.products||[]).length > 1 || productsLoading ? "références" : "référence"}
                  chargement={productsLoading && !(cat.products||[]).length}
                  detail={filteredProducts.length !== (cat.products||[]).length ? `${filteredProducts.length} affichée${filteredProducts.length > 1 ? "s" : ""}` : null} />}
          >
            {/* Bloc groupement U-Labs */}
            {activeTab === "ulabs" && (() => {
              // Nb de références distinctes (locales + autres pharmacies)
              const activeCamp = getCampaign(activeTab);
              const PALIER_EXPERT = activeCamp?.palier_qty ?? 12;
              const PALIER_REMISE = activeCamp?.palier_remise ?? 33;
              // Mes refs locales en cours + déjà validées
              const myLocalCips = new Set(
                (cat?.products || []).filter((p, idx) => (parseInt(quantities[`${activeTab}-${idx}`]) || 0) > 0).map(p => p.cip)
              );
              const myValidatedCips = validatedCampOrders[activeTab] || [];
              // Toutes les refs Supabase group_orders (TOUTES pharmacies, y compris la courante)
              const allGroupCips = new Set(
                groupOrders.filter(r => (parseInt(r.qty)||0) > 0).map(r => r.cip)
              );
              const allCips = new Set([...myLocalCips, ...myValidatedCips, ...allGroupCips]);
              const totalUnites = allCips.size; // nb de refs distinctes
              const nbPharm = new Set([
                ...groupOrders.filter(r=>(parseInt(r.qty)||0)>0).map(r => r.pharmacy_cip),
                ...(myLocalCips.size > 0 ? [pharmacyCip] : [])
              ]).size;
              const pctExpert = Math.min(100, Math.round(totalUnites / PALIER_EXPERT * 100));
              const palierAtteint = totalUnites >= PALIER_EXPERT;
              return (
                <div style={{ marginTop: 16 }}>
                  {/* Countdown + stats */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    {/* Compteurs refs commandées */}
                    {(() => {
                      const campHdr = getCampaign(activeTab);
                      const prodsHdr = cat?.products || [];
                      // Refs locales en cours + group_orders sauvegardés pour cette pharmacie
                      const myGroupCips = new Set(groupOrders.filter(r => r.pharmacy_cip === pharmacyCip && (parseInt(r.qty)||0) > 0).map(r => r.cip));
                      const cmdRefsHdr = prodsHdr.filter((p, idx) =>
                        (parseInt(quantities[`${activeTab}-${idx}`]) || 0) > 0 || myGroupCips.has(p.cip)
                      );
                      const minRefsHdr = campHdr?.min_refs ?? 0;
                      const condStats = (campHdr?.conditions || []).map(cond => {
                        try {
                          const rx = new RegExp(cond.match_regex, "i");
                          const nb = cmdRefsHdr.filter(p => rx.test(p.name)).length;
                          return { val: nb, total: cond.count, label: cond.label, ok: nb >= cond.count };
                        } catch(e) { return null; }
                      }).filter(Boolean);
                      const allStats = [
                        ...(minRefsHdr > 0 ? [{ val: cmdRefsHdr.length, total: minRefsHdr, label: "réf. min", ok: cmdRefsHdr.length >= minRefsHdr }] : []),
                        ...condStats,
                      ];
                      // condition remplie : ton ok ; à compléter : ton danger (libellé et ✓, jamais la couleur seule)
                      return allStats.length === 0 ? null : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          {allStats.map(s => { const ton = tone(s.ok ? "ok" : "danger"); return (
                            <div key={s.label} style={{ background: ton.bg, borderRadius: R.pill, padding: "4px 12px", border: `1px solid ${ton.border}`, display: "inline-flex", alignItems: "baseline", gap: 1 }}>
                              <span className="num" style={{ fontWeight: 700, color: T.ink, fontSize: 16 }}>{s.val}</span>
                              <span style={{ color: ton.fg, fontSize: 11, fontWeight: 600 }}>/{s.total} {s.label} {s.ok ? "✓" : ""}</span>
                            </div>
                          ); })}
                        </div>
                      );
                    })()}
                    <div style={{ background: T.surface2, borderRadius: R.s, padding: "6px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <Icone nom="horloge" taille={18} style={{ color: T.teal }} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMute, textTransform: "uppercase", letterSpacing: "0.06em" }}>Fermeture dimanche 23h59</div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: T.ink, fontVariantNumeric: "tabular-nums" }}><CompteARebours /></div>
                      </div>
                    </div>
                  </div>
                  {/* Barre de progression — nb de références distinctes tous clients (piste sable, sarcelle puis or au palier) */}
                  <div style={{ marginTop: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span className="num" style={{ fontSize: 13, color: T.ink, fontWeight: 700 }}>
                        {totalUnites} <span style={{ fontWeight: 400, fontSize: 12, color: T.inkSoft }}>/ {PALIER_EXPERT} références différentes</span>
                      </span>
                      {palierAtteint
                        ? <span style={{ ...ui.badge("tier"), border: `1px solid ${T.or}`, fontSize: 12 }}>⭐ −{PALIER_REMISE}% atteint !</span>
                        : <span style={{ fontSize: 12, color: T.inkSoft }}>encore {PALIER_EXPERT - totalUnites} réf. pour −{PALIER_REMISE}%</span>
                      }
                    </div>
                    <div style={{ position: "relative", background: T.sand, borderRadius: R.pill, height: 12 }}>
                      <div style={{
                        width: `${pctExpert}%`, height: "100%", borderRadius: R.pill, transition: "width 0.6s var(--ease)",
                        background: palierAtteint ? T.or : T.teal2
                      }}/>
                      {!palierAtteint && totalUnites > 0 && (
                        <div style={{ position: "absolute", top: "50%", left: `${pctExpert}%`, transform: "translateY(-50%) translateX(-50%)", background: T.petrol, borderRadius: R.pill, width: 8, height: 8 }}/>
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, gap: 8 }}>
                      <span style={{ fontSize: 11, color: T.inkMute }}>
                        {nbPharm > 0 ? `${nbPharm} pharmacie${nbPharm>1?"s":""} participante${nbPharm>1?"s":""}` : "Soyez le premier !"}
                      </span>
                      <span style={{ fontSize: 11, color: T.inkMute }}>dont commandes validées incluses</span>
                    </div>
                  </div>
                  {/* Prix */}
                  <div style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: T.inkMute }}>· Prix affichés avec remise −33% sur facture incluse</span>
                  </div>
                </div>
              );
            })()}
            {/* Search : pastille blanche, loupe au trait (16 px de police sur mobile : Safari iOS ne zoome plus à la saisie) */}
            <div style={{ marginTop: 16 }}>
              <div style={{ position: "relative" }}>
                <Icone nom="recherche" taille={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: T.inkMute, pointerEvents: "none" }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher par nom ou CIP…"
                  aria-label={`Rechercher dans ${catEffective.label}`}
                  style={{
                    width: "100%", height: 40, background: T.surface, border: `1px solid ${T.lineField}`,
                    borderRadius: R.pill, color: T.ink, padding: "0 16px 0 40px", fontSize: isMobile ? 16 : 14,
                    outline: "none", boxSizing: "border-box"
                  }}
                />
              </div>
              {/* Filters : pastilles de 32 px, état porté par aria-pressed (sable / encre : classe ex-filtre) */}
              <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                <button className="ex-filtre" aria-pressed={showFavOnly} onClick={() => setShowFavOnly(!showFavOnly)} style={filtreStyle}>
                  <Icone nom="favori" taille={14} plein={showFavOnly} />Favoris <span className="num">({favorites.size})</span>
                </button>

                {!cat?.sansStock && <>
                {/* coche seulement quand le filtre est actif (revue, § 20) ; inactif, l'icône neutre du stock (carton) */}
                <button className="ex-filtre" aria-pressed={filterStock === "instock"} onClick={() => setFilterStock(filterStock === "instock" ? "all" : "instock")} style={filtreStyle}>
                  <Icone nom={filterStock === "instock" ? "coche" : "carton"} taille={14} />En stock
                </button>

                <button className="ex-filtre" aria-pressed={filterStock === "rupture"} onClick={() => setFilterStock(filterStock === "rupture" ? "all" : "rupture")} style={filtreStyle}>
                  <Icone nom="alerte" taille={14} />Ruptures
                </button>
                </>}

                <button className="ex-filtre" aria-pressed={filterRemise} onClick={() => setFilterRemise(!filterRemise)} style={filtreStyle}>
                  <Icone nom="etiquette" taille={14} />Avec remise
                </button>
              </div>
              {/* Centrale OTC : tri (sélecteur segmenté, aria-pressed) et filtre par laboratoire (liste native : clavier,
                  lecteurs d'écran, sélecteur du téléphone), au gabarit des filtres ; affichés dès qu'un laboratoire est connu */}
              {labosMenu.length > 0 && (
                <div style={{ display: "flex", gap: "8px 16px", marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span id="tri-labo" style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft }}>Trier par</span>
                    <div role="group" aria-labelledby="tri-labo" className="ex-segment">
                      {[[false, "A–Z"], [true, "Laboratoire"]].map(([v, t]) => (
                        <button key={t} aria-pressed={modeLabo === v} onClick={() => setTriLabo(v)}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
                    <label htmlFor="filtre-labo" style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft }}>Laboratoire</label>
                    <span style={{ position: "relative", display: "flex", minWidth: 0, color: laboChoisi ? T.paper : T.ink }}>
                      <select id="filtre-labo" className="ex-filtre ex-liste" data-actif={laboChoisi ? "" : undefined} value={laboChoisi?.nom || ""}
                        onChange={e => setFiltreLabo(e.target.value)} style={{ ...filtreStyle, maxWidth: "100%", padding: "0 32px 0 14px", appearance: "none", WebkitAppearance: "none", textOverflow: "ellipsis" }}>
                        <option value="">Tous les laboratoires</option>
                        {labosMenu.map(l => <option key={l.cle} value={l.nom}>{l.nom} ({l.n})</option>)}
                      </select>
                      <Icone nom="suivant" taille={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%) rotate(90deg)", pointerEvents: "none" }} />
                    </span>
                  </div>
                </div>
              )}
            </div>
          </EnteteVue>

          {/* Products grid (photos) + table */}
          <>
{avecAlphabet && (
                <div id="barre-alphabet" style={{ position: "sticky", top: hauteurEntete, zIndex: 80, background: T.cream, padding: isMobile ? "4px 0 8px" : "6px 0 10px", marginBottom: 4 }}>
                  {/* rail blanc en pastille ; ordinateur : 27 colonnes, une seule rangée dès 720 px de large ;
                      mobile (lot 9) : lettres de 36 px au doigt (28 sur ordinateur), marges resserrées pour que la
                      bande collée ne prenne guère plus de hauteur */}
                  <div className={isMobile ? "ex-sans-barre" : undefined} style={isMobile
                    ? { display: "flex", overflowX: "auto", scrollbarWidth: "none", gap: 4, background: T.surface, borderRadius: R.pill, padding: "4px 6px", boxShadow: T.shadow1, border: `1px solid ${T.lineSoft}` }
                    : { display: "grid", gridTemplateColumns: "repeat(27, minmax(0, 1fr))", gap: 3, justifyItems: "center", background: T.surface, borderRadius: R.pill, padding: "5px 8px", boxShadow: T.shadow1, border: `1px solid ${T.lineSoft}` }}>
                    {["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(l => {
                      const dispo = !!premierParLettre[l];
                      return (
                        <button key={l} onClick={() => allerLettre(l)} disabled={!dispo} aria-label={`${modeLabo ? "Laboratoires" : "Produits"} commençant par ${l === "#" ? "un chiffre" : l}`} style={{
                          flex: isMobile ? "0 0 auto" : undefined, minWidth: isMobile ? 36 : undefined, width: isMobile ? undefined : "100%", maxWidth: isMobile ? undefined : 32,
                          height: isMobile ? 36 : 28, padding: 0, borderRadius: R.pill, border: "none", fontFamily: "inherit",
                          background: dispo ? T.mint : "transparent", color: dispo ? T.inkSoft : T.inkFaint,
                          fontWeight: 700, fontSize: isMobile ? 14 : 13, cursor: dispo ? "pointer" : "default",
                        }}>{l}</button>
                      );
                    })}
                  </div>
                </div>
              )}
{gridWithPhoto.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(220px, 1fr))", gap: isMobile ? 10 : 14, marginBottom: 24, alignItems: "stretch" }}>
                  {gridWithPhoto.map((p, mapIdx) => {
                    const realIdx = cat.products.indexOf(p);
                    const key = `${activeTab}-${realIdx}`;
                    const prevP = mapIdx > 0 ? gridWithPhoto[mapIdx - 1] : null;
                    const _campActive = activeTab === "ulabs" ? getCampaign("ulabs") : null;
                    const _groupes = buildGroupes(_campActive);
                    const currentGroupe = activeTab === "ulabs" ? campGetGroupe(p, _groupes) : null;
                    const prevGroupe = activeTab === "ulabs" && prevP ? campGetGroupe(prevP, _groupes) : null;
                    const showGroupHeader = activeTab === "ulabs" && currentGroupe?.key !== prevGroupe?.key;
                    const qty = quantities[key] || 0;
                    const { step, min: stepMin, multiple } = getStepMin(activeTab, p);
                    const isRupture = !cat?.sansStock && p.cip && (stockData[p.cip]?.dispo === 0 || stockData[p.cip]?.dispo === false);
                    const groupTotal = activeTab === "ulabs" ? groupOrders.filter(r => r.cip === p.cip).reduce((s,r) => s + (parseInt(r.qty)||0), 0) : 0;
                    const groupPharm = activeTab === "ulabs" ? new Set(groupOrders.filter(r => r.cip === p.cip).map(r => r.pharmacy_cip)).size : 0;
                    const remisePct = (() => { const _cr = getCampaign(activeTab); return _cr ? (_cr.palier_remise ?? 33) : 0; })();
                    const pnAffiche = remisePct > 0 ? Math.round(p.pv * (1 - remisePct/100) * 100) / 100 : p.pn;
                    const ulabsGInfo = currentGroupe;
                    const ulabsGrat = activeTab === "ulabs" ? campGratuite(p, qty, cat?.products, quantities, activeTab, _groupes) : { livrées: 0, type: null };
                    const has6plus2 = !!ulabsGInfo?.gratuite;
                    const livrées6plus2 = ulabsGrat.livrées || 0;
                    const qtyLivrée = qty + livrées6plus2;
                    const pnEffectif = livrées6plus2 > 0
                      ? Math.round((pnAffiche ?? p.pn) * qty / qtyLivrée * 100) / 100
                      : (pnAffiche ?? p.pn);
                    return (
                      <React.Fragment key={key}>
                      {showGroupHeader && currentGroupe && (() => {
                        const gInfo = currentGroupe;
                        // Compter les refs commandées dans ce groupe
                        const groupProds = gridWithPhoto.filter(gp => campGetGroupe(gp, _groupes)?.key === currentGroupe?.key);
                        const groupQty = groupProds.reduce((s, gp) => {
                          const gi = cat.products.indexOf(gp);
                          return s + (parseInt(quantities[`ulabs-${gi}`]) || 0);
                        }, 0);
                        const groupRefsCmd = groupProds.filter(gp => {
                          const gi = cat.products.indexOf(gp);
                          return (parseInt(quantities[`ulabs-${gi}`]) || 0) > 0;
                        }).length;
                        return (
                          <div style={{ gridColumn: "1 / -1", marginTop: mapIdx > 0 ? 20 : 0, marginBottom: 4, borderRadius: R.m, overflow: "hidden", background: T.paper, border: `1px solid ${T.line}`, borderLeft: `3px solid ${gInfo.accent || T.line}` }}>
                            {/* Titre groupe (la couleur du groupe n'est plus qu'un filet, comme l'en-tête de vue) */}
                            <div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 640, fontSize: 17, letterSpacing: "-0.01em", color: T.petrol }}>{gInfo.label}</div>
                                <div className="num" style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>{groupProds.length} référence{groupProds.length>1?"s":""}</div>
                              </div>
                              {groupRefsCmd > 0 && (
                                <div style={{ background: T.mint, borderRadius: R.s, padding: "6px 14px", textAlign: "center", flexShrink: 0 }}>
                                  <div className="num" style={{ fontWeight: 700, fontSize: 18, color: T.teal }}>{groupRefsCmd}</div>
                                  <div style={{ fontSize: 11, color: T.teal }}>réf. sélectionnées</div>
                                </div>
                              )}
                            </div>
                            {/* Conditions depuis la config campagne (tons de COND_COLORS) */}
                            {(()=>{
                              const rows = [];
                              if (gInfo?.desc) {
                                const ton = !gInfo.gratuite ? COND_COLORS.aucune : gInfo.gratuite?.type==="6+2" ? COND_COLORS["6+2"] : COND_COLORS["3+1"];
                                rows.push([gInfo.label, gInfo.desc, ton.bg, ton.fg]);
                              }
                              return rows;
                            })().map(([titre, detail, bg, color], ci) => (
                              <div key={ci} style={{ padding: "10px 18px", background: bg, borderTop: `1px solid ${T.lineSoft}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 13, color }}>{titre}</div>
                                  <div style={{ fontSize: 12, color, marginTop: 2 }}>{detail}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      {/* tri par laboratoire : en-tête de groupe sur toute la largeur de la grille (cible de la barre A–Z) */}
                      {/* nom accessible « Bayer, 38 références » : sans aria-label, nom et compteur (éléments flex) sont lus accolés */}
                      {modeLabo && (!prevP || cleDe.get(prevP) !== cleDe.get(p)) && (() => {
                        const k = cleDe.get(p), lettre = k && lettreDe(nomDe.get(k)), n = nParLabo.get(k);
                        const nom = k ? nomDe.get(k) : "Laboratoire non renseigné", refs = `${n} référence${n > 1 ? "s" : ""}`;
                        return (
                          <h2 id={k && premierParLettre[lettre] === p ? `lettre-${lettre}` : undefined} aria-label={`${nom}, ${refs}`} style={{ gridColumn: "1 / -1", margin: prevP ? "12px 0 0" : 0,
                            padding: "0 2px 8px", borderBottom: `1px solid ${T.line}`, display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 10px",
                            fontSize: 17, fontWeight: 640, letterSpacing: "-0.01em", color: T.petrol }}>
                            {nom}
                            <span className="num" style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: T.inkMute }}>{refs}</span>
                          </h2>
                        );
                      })()}
                      <div id={avecAlphabet && !modeLabo && premierParLettre[lettreDe(p.name)] === p ? `lettre-${lettreDe(p.name)}` : undefined}
                        className="ex-carte" data-choisi={qty > 0 ? "" : undefined} style={{
                        background: T.surface, borderRadius: R.m,
                        display: "flex", flexDirection: "column", gap: 0, minWidth: 0,
                        overflow: "hidden"
                      }}>
                        {/* Photo : puits blanc (photos Medipim sur fond blanc) ; sans photo, puits sable et icône du rayon */}
                        <div style={{ width: "100%", height: isMobile ? 120 : 160, background: p.image_url ? T.surface : T.surface2, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${T.lineSoft}`, boxSizing: "border-box" }}>
                          {p.image_url
                            ? <img src={p.image_url} alt={p.name} loading="lazy" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 10, boxSizing: "border-box" }}/>
                            : (() => { const ic = iconeMenu(activeTab, cat, 40); return <span aria-hidden="true" style={typeof ic === "string" ? { fontSize: 34, opacity: 0.2 } : { display: "flex", color: T.inkFaint }}>{ic}</span>; })()
                          }
                          {isRupture && (
                            <div style={{ position: "absolute", top: 8, left: 8, ...ui.badge("danger", true) }}><Icone nom="alerte" taille={12} />Rupture</div>
                          )}
                        </div>
                        {/* Info centrale */}
                        <div style={{ flex: 1, padding: isMobile ? "10px 10px 4px" : "12px 14px 6px", minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: isMobile ? 12.5 : 13.5, color: T.ink, lineHeight: 1.35, marginBottom: 4, overflowWrap: "anywhere" }}>{p.name}</div>
                          {p.cip && <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 4 }}>EAN : <CipCell cip={p.cip}/></div>}
                          {p.note && <span style={{ ...ui.badge("warn"), whiteSpace: "normal" }}>{p.note}</span>}
                          {activeTab && (() => {
                            const _campBadge = getCampaign(activeTab);
                            const _conds = _campBadge?.conditions || [];
                            const isOblig = _conds.some(cond => {
                              try { return new RegExp(cond.match_regex,"i").test(p.name); } catch(e){ return false; }
                            });
                            return isOblig ? <span style={{ ...ui.badge("labo"), marginLeft: 4 }}><Icone nom="alerte" taille={11} />Obligatoire</span> : null;
                          })()}
                          {has6plus2 && ulabsGInfo?.note && (
                            <span style={{ ...ui.badge("ok"), whiteSpace: "normal", marginLeft: 4, border: `1px solid ${COND_COLORS["6+2"].border}` }}>{ulabsGInfo.note}</span>
                          )}
                          {has6plus2 && ulabsGrat.hint && qty === 0 && (
                            <div style={{ fontSize: 11, color: T.warn, marginTop: 3 }}>💡 {ulabsGrat.hint}</div>
                          )}
                          {p.colis && p.colis > 1 && <div className="num" style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>Conditionnement : ×{p.colis}</div>}
                          {activeTab === "ulabs" && groupTotal > 0 && (
                            <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, background: T.okBg, borderRadius: R.pill, padding: "3px 10px", flexWrap: "wrap" }}>
                              <span className="num" style={{ fontSize: 11, fontWeight: 700, color: T.ok }}>🤝 {groupTotal} réf. groupées</span>
                              <span className="num" style={{ fontSize: 11, color: T.ok }}>· {groupPharm} pharm.</span>
                            </div>
                          )}
                        </div>
                        {/* Prix + remise + qté */}
                        <div style={{ padding: isMobile ? "8px 8px 10px" : "10px 14px 14px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, borderTop: `1px solid ${T.lineSoft}` }}>
                          {/* prix barré --ink-mute, remise en badge or + encre, prix net 20/700 encre */}
                          {(p.pv && p.pct || remisePct > 0) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span className="num" style={{ fontSize: 12, color: T.inkMute, textDecoration: "line-through" }}>{fmt(p.pv)}</span>
                              <span className="num" style={{ ...ui.badge("promo"), padding: "1px 7px", lineHeight: 1.25 }}>
                                {remisePct > 0 ? fmtPct(remisePct) : fmtPct(p.pct)}
                              </span>
                            </div>
                          )}
                          <div className="num" style={{ fontSize: 20, fontWeight: 700, color: T.ink, letterSpacing: "-0.01em" }}>{pnAffiche != null ? fmt(pnAffiche) : "–"}</div>
                          {has6plus2 && qty >= 6 ? (
                            <div style={{ background: T.okBg, border: `1px solid ${COND_COLORS["6+2"].border}`, borderRadius: R.s, padding: "5px 10px", textAlign: "center", marginTop: 2 }}>
                              <div style={{ fontSize: 11, color: T.ok, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>prix effectif avec UG</div>
                              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: T.ok }}>{fmt(pnEffectif)}<span style={{ fontSize: 11, fontWeight: 500 }}>/u livrée</span></div>
                            </div>
                          ) : has6plus2 ? (
                            <div style={{ ...ui.badge("ok"), border: `1px solid ${COND_COLORS["6+2"].border}` }}><Icone nom="cadeau" taille={12} />dès 6 u. : prix réduit</div>
                          ) : null}
                          {(() => {
                            const m = multiple > 1 ? multiple : 1;
                            const syncGroup = (nq) => syncGroupe(activeTab, p.cip, nq);
                            const applyQty = (raw) => {
                              const final = m > 1 ? Math.round(raw/m)*m : raw;
                              const finalWithMin = final > 0 && stepMin > 0 ? Math.max(stepMin, final) : final;
                              setQuantities(prev => ({...prev, [key]: finalWithMin}));
                              syncGroup(finalWithMin);
                            };
                            const handleMinus = () => applyQty(qty - step <= 0 ? 0 : qty - step);
                            const handlePlus  = () => applyQty(qty === 0 ? (stepMin > 0 ? stepMin : (m > 1 ? m : step)) : qty + (m > 1 ? m : step));
                            const handleBlur  = (raw) => {
                              const v = parseInt(raw) || 0;
                              if (v === 0) { setQuantities(prev=>({...prev,[key]:0})); syncGroup(0); return; }
                              const badMin = stepMin > 0 && v < stepMin;
                              const badMul = m > 1 && v % m !== 0;
                              if (badMin || badMul) {
                                const msg = badMin && badMul
                                  ? `Minimum ${stepMin} u. et multiple de ${m} requis.\nQuantité remise à 0.`
                                  : badMin ? `Minimum ${stepMin} unités pour cette référence.\nQuantité remise à 0.`
                                  : `La quantité doit être un multiple de ${m}.\nQuantité remise à 0.`;
                                alert(msg);
                                setQuantities(prev=>({...prev,[key]:0})); syncGroup(0); return;
                              }
                              setQuantities(prev=>({...prev,[key]:v})); syncGroup(v);
                            };
                            return (<>
                              {/* « − » sable, « + » pétrole, champ à filet --line-field puis 2 px sarcelle dès qu'il y a une quantité ;
                                  sous 768 px (lot 9) : 40 px au doigt (classes ex-qte-* / ex-qte-champ), écart de 4 px pour
                                  tenir dans une carte de 172 px (deux colonnes à 375 px). Revue (§ 20) : « − » / « + » dessinés
                                  en CSS (ex-ico, aucun nœud SVG sur les 675 cartes OTC) et nommés avec le produit */}
                              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 6, maxWidth: "100%" }}>
                                <button className="ex-qte-moins ex-ico ex-ico-moins" onClick={handleMinus} aria-label={`Diminuer la quantité de ${p.name}`} style={qtyBtnStyle("moins", 32)} />
                                <input
                                  type="number"
                                  min={stepMin || 0}
                                  step={m > 1 ? m : step}
                                  value={quantities[key] ?? ""}
                                  onChange={e => setQuantities(prev=>({...prev,[key]: e.target.value === "" ? 0 : parseInt(e.target.value)||0}))}
                                  onBlur={e => handleBlur(e.target.value)}
                                  placeholder="0"
                                  aria-label={`Quantité ${p.name}`}
                                  className="ex-qte-champ"
                                  style={{ ...ui.qtyInput(qty > 0), height: 32, fontSize: 14 }}/>
                                <button className="ex-qte-plus ex-ico ex-ico-plus" onClick={handlePlus} aria-label={`Augmenter la quantité de ${p.name}`} style={qtyBtnStyle("plus", 32)} />
                              </div>
                              {(stepMin > 0 || m > 1) && (
                                <div className="num" style={{ fontSize: 11, color: qty > 0 ? T.teal : T.inkMute, marginTop: 2 }}>
                                  {stepMin > 0 && `min ${stepMin}`}{stepMin > 0 && m > 1 && " · "}{m > 1 && `×${m}`}
                                </div>
                              )}
                              {qty > 0 && p.pn != null && (
                                <div className="num" style={{ fontSize: 12, fontWeight: 700, color: T.ink, background: T.surface2, borderRadius: R.s, padding: "2px 10px" }}>
                                  = {fmt((pnAffiche ?? p.pn) * qty)}
                                  {livrées6plus2 > 0 && <span style={{ color: T.ok, fontWeight: 700, marginLeft: 6 }}> → {qty} u. + {livrées6plus2} UG livrées ({fmt(pnEffectif)}/u)</span>}
                                </div>
                              )}
                              {qty > 0 && (
                                <button className="ex-btn-discret ex-cible" onClick={() => { setQuantities(prev=>({...prev,[key]:0})); syncGroup(0); }}
                                  style={{ width: 24, height: 24, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                  title="Remettre à zéro" aria-label={`Remettre à zéro la quantité de ${p.name}`}><Icone nom="fermer" taille={12} epaisseur={2.4} /></button>
                              )}
                            </>);
                          })()}
                        </div>
                      </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
              {gridWithoutPhoto.length > 0 && (
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, overflow: "hidden", boxShadow: T.shadow1 }}>
            {isMobile ? (
              /* ── VUE MOBILE : liste simplifiée nom + PN + quantité (en-tête neutre ; zébrure et rupture : classe ex-tr) ── */
              <div>
                <div style={{ ...ui.th, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>DÉSIGNATION</span>
                  <span>PN · QTÉ</span>
                </div>
                <div>
                {gridWithoutPhoto.map((p, idx) => {
                  const realIdx = cat.products.indexOf(p);
                  const key = `${activeTab}-${realIdx}`;
                  const qty = quantities[key] || 0;
                  const isRupture = !cat?.sansStock && p.cip && (stockData[p.cip]?.dispo === 0 || stockData[p.cip]?.dispo === false);
                  const step = getStep(activeTab, p);
                  return (
                    <div key={key} className="ex-tr" data-rupture={isRupture ? "" : undefined} style={{
                      padding: "10px 14px", borderBottom: `1px solid ${T.lineSoft}`,
                      display: "flex", alignItems: "center", gap: 10
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: T.ink, lineHeight: 1.3 }}>
                          {p.name}
                          {p.note && <span style={{ ...ui.badge("warn"), marginLeft: 5, whiteSpace: "normal" }}>{p.note}</span>}
                          {isRupture && <span style={{ ...ui.badge("danger"), marginLeft: 5 }}><Icone nom="alerte" taille={11} />Rupture</span>}
                        </div>
                        <div className="num" style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginTop: 3 }}>{fmt(p.pn)} {p.pct ? <span style={ui.badge("promo")}>{fmtPct(p.pct)}</span> : null}<TierBadge tiers={p.price_tiers} pn={p.pn} compact /></div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <button className="ex-qte-moins" aria-label={`Diminuer la quantité de ${p.name}`} onClick={() => setQuantities(q => ({ ...q, [key]: Math.max(0, (q[key]||0) - step) }))}
                          style={qtyBtnStyle("moins", 30)}><Icone nom="moins" taille={15} epaisseur={2.4} /></button>
                        <span className="num" style={{ width: 28, textAlign: "center", fontWeight: 700, fontSize: 15, color: qty > 0 ? T.ink : T.inkMute }}>{qty}</span>
                        <button className="ex-qte-plus" aria-label={`Augmenter la quantité de ${p.name}`} onClick={() => setQuantities(q => ({ ...q, [key]: (q[key]||0) + step }))}
                          style={qtyBtnStyle("plus", 30)}><Icone nom="plus" taille={15} epaisseur={2.4} /></button>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            ) : (
            <div style={{ overflowX: "auto" }}>
              {/* chiffres tabulaires dans tout le tableau : les colonnes de prix s'alignent */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  {/* en-tête neutre (sable clair + eyebrow --ink-mute), plus à la couleur du rayon ; libellés sur deux
                      lignes au besoin (comme avant) : la largeur va à la désignation */}
                  <tr>
                    <th style={{ ...thStyle, padding: "10px 4px 10px 10px", width: 28 }}><Icone nom="favori" taille={13} titre="Favori" /></th>
                    {cat.columns.map(col => (
                      <th key={col} style={{ ...thStyle, textAlign: alignCol(col) }}>{col.toUpperCase()}</th>
                    ))}
                    {/* Qté collée au bord droit quand le tableau défile en largeur (768-1 279 px : ex-col-qte, revue § 20) */}
                    <th className="ex-col-qte" style={{ ...thStyle, textAlign: "center" }}>QTÉ</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>SOUS-TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {gridWithoutPhoto.map((p, idx) => {
                    const realIdx = cat.products.indexOf(p);
                    const key = `${activeTab}-${realIdx}`;
                    const qty = quantities[key] || 0;
                    const subtotal = p.pn != null ? p.pn * qty : null;

                    const isRupture = !cat?.sansStock && p.cip && (stockData[p.cip]?.dispo === 0 || stockData[p.cip]?.dispo === false);
                    const ruptureBadge = isRupture ? <span style={{ ...ui.badge("danger"), marginLeft: 6, verticalAlign: "middle" }}><Icone nom="alerte" taille={11} />Rupture</span> : null;
                    // zébrure, survol et fond rupture : classe ex-tr + data-rupture (tokens.css) — le survol ne l'efface plus
                    return (
                      <tr key={key} className="ex-tr" data-rupture={isRupture ? "" : undefined} style={{
                        borderBottom: `1px solid ${T.lineSoft}`
                      }}>
                        {/* Favori (reste un td cliquable : pas d'arrêt de tabulation en plus) */}
                        <td style={{ ...tdStyle, width:28, padding:"6px 2px 6px 10px", cursor:"pointer" }}
                          onClick={() => p.cip && toggleFav(p.cip)} title={favorites.has(p.cip) ? "Retirer des favoris" : "Ajouter aux favoris"}>
                          <Icone nom="favori" taille={16} plein={favorites.has(p.cip)} style={{ color: favorites.has(p.cip) ? T.teal2 : T.lineField }} />
                        </td>
                        {/* Render cells based on category (désignation sans largeur maximale : en 13 px, la limite renvoyait
                            nom et badges sur deux lignes ; la colonne prend la place libre, les lignes restent basses) */}
                        {activeTab === "expert" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            {p.name}
                            {p.note && <span style={{ ...ui.badge("warn"), marginLeft: 6, whiteSpace: "normal" }}>{p.note}</span>}
                            {ruptureBadge}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pv)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: T.inkSoft, fontWeight: 600 }}>
                            {p.remise_eur ? fmt(p.remise_eur) : fmt(30)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(p.pn)}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "stratege" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "center", color: T.inkSoft }}>{p.colis}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.prix)}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", color: T.inkSoft, fontWeight: 600 }}>
                            {p.remise_eur ? fmt(p.remise_eur) : (p.pv && p.pct ? fmt(parseFloat(p.pv)*parseFloat(p.pct)/100) : "—")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(p.pn)}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                          <td style={{ ...tdStyle, textAlign: "right", color: T.inkSoft }}>{fmt(p.carton)}</td>
                        </>}
                        {activeTab === "master" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}{ruptureBadge}</td>
                          {/* colonnes Palier et PV retirées (jamais transmises par products-get) : 5 cellules sous 5 en-têtes */}
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", color: T.inkSoft, fontWeight: 600 }}>
                            {p.remise_eur ? fmt(p.remise_eur) : (p.pb && p.pct ? fmt(parseFloat(p.pb)*parseFloat(p.pct)/100) : "—")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(p.pn)}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "obeso" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            {p.groupe && (
                              <div style={{ fontSize: 11, color: T.teal, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 2 }}>{p.groupe.toUpperCase()}</div>
                            )}
                            {p.name}
                            {p.note && <span style={{ ...ui.badge("warn"), marginLeft: 6, whiteSpace: "normal" }}>{p.note}</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{p.pn != null ? fmt(p.pn) : "–"}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "nr" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            {p.name}
                            {p.note && <span style={{ ...ui.badge("warn"), marginLeft: 6, whiteSpace: "normal" }}>{p.note}</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{p.pn != null ? fmt(p.pn) : "–"}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "molnlycke" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pv)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(p.pn)}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "blanche" && <>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}</td>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, textAlign: "center", color: T.inkSoft }}>{p.colis}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{p.pn != null ? fmt(p.pn) : "–"}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "covid" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{p.pn != null ? fmt(p.pn) : "–"}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {activeTab === "otc" && <>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}{ruptureBadge}</td>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{p.pn != null ? fmt(p.pn) : "–"}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}
                        {cat.isPromo && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            {p.name}
                            {p.note && <span style={{ ...ui.badge("warn"), marginLeft: 6, whiteSpace: "normal" }}>{p.note}</span>}
                            {ruptureBadge}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}><BadgeRemise pct={p.pct} /></td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{p.pn != null ? fmt(p.pn) : "–"}<TierBadge tiers={p.price_tiers} pn={p.pn} compact bloc /></td>
                        </>}

                        {/* Qty input : « − » sable, « + » pétrole (24 px), champ à filet --line-field puis 2 px sarcelle ;
                            colonne collée au bord droit quand le tableau défile en largeur (ex-col-qte, revue § 20) */}
                        <td className="ex-col-qte" style={{ ...tdStyle, textAlign: "center" }}>
                          {(() => {
                            const { step, min: stepMin, multiple } = getStepMin(activeTab, p);
                            return (
                              <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "center", flexDirection: "column" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <button className="ex-qte-moins" aria-label={`Diminuer la quantité de ${p.name}`} onClick={() => setQty(key, (quantities[key] || 0) - step, step)} style={qtyBtnStyle("moins")}><Icone nom="moins" taille={14} epaisseur={2.4} /></button>
                                  <ChampQteColis
                                    min="0" step={step} valeur={quantities[key]}
                                    onValider={v => setQty(key, v, step)}
                                    placeholder="0"
                                    aria-label={`Quantité ${p.name}`}
                                    style={{ ...ui.qtyInput(qty > 0), height: 26 }}
                                  />
                                  <button className="ex-qte-plus" aria-label={`Augmenter la quantité de ${p.name}`} onClick={() => setQty(key, (quantities[key] || 0) + step, step)} style={qtyBtnStyle("plus")}><Icone nom="plus" taille={14} epaisseur={2.4} /></button>
                                </div>
                                {step > 1 && <span style={{ fontSize: 11, lineHeight: 1.1, color: T.inkMute }}>par {step}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        {/* Subtotal */}
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                          {qty > 0 && subtotal != null
                            ? <span style={{ color: T.ink }}>{fmt(subtotal)}</span>
                            : <span style={{ color: T.inkMute }}>–</span>   /* « rien » : --ink-mute (4,8:1), plus --ink-faint (revue) */
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            ) /* fin ternaire desktop */}
          </div>
              )}

          {/* ── États du catalogue (lot 8) : rien à afficher dans la grille ou le tableau ──
              chargement du menu : squelettes aux dimensions des cartes / lignes (pas de saut à l'arrivée des produits) ;
              catalogue non chargé (aucun produit reçu) : erreur + « Réessayer » (même chargement qu'à l'ouverture) ;
              menu vide ; filtres ou recherche trop restrictifs : « Effacer les filtres » (états d'affichage seulement) */}
          {filteredProducts.length === 0 && (
            productsLoading && !(cat.products || []).length
              ? <SqueletteCatalogue grille={isGridSection} mobile={isMobile} lignes={isGridSection ? 8 : 10} alphabet={ALPHA_SECTIONS.includes(activeTab)} />
            : !dbProducts.length && !(cat.products || []).length
              ? <EtatVide cadre erreur icone="alerte" titre="Le catalogue n’a pas pu être chargé"
                  texte="Vérifiez votre connexion internet, puis réessayez."
                  actions={<ActionEtat principal icone="actualiser" onClick={fetchProducts}>Réessayer</ActionEtat>} />
            : !(cat.products || []).length
              ? <EtatVide cadre icone="carton" titre="Aucun produit dans ce menu pour le moment"
                  texte="Les références de ce menu seront affichées ici dès leur mise en ligne." />
              : <EtatVide cadre icone={showFavOnly ? "favori" : "recherche"} titre="Aucun produit ne correspond"
                  texte={(() => {
                    const actifs = [
                      search && `recherche « ${search} »`,
                      showFavOnly && "favoris",
                      filterStock === "instock" && !cat?.sansStock && "en stock",
                      filterStock === "rupture" && !cat?.sansStock && "ruptures",
                      filterRemise && "avec remise",
                      laboChoisi && `laboratoire « ${laboChoisi.nom} »`,
                    ].filter(Boolean);
                    return actifs.length ? `Filtres actifs : ${actifs.join(" · ")}` : null;
                  })()}
                  actions={<ActionEtat icone="fermer" onClick={() => { setSearch(""); setShowFavOnly(false); setFilterStock("all"); setFilterRemise(false); setFiltreLabo(""); }}>Effacer les filtres</ActionEtat>} />
          )}

          {/* Bouton confirmation commande groupée U-Labs */}
          {activeTab === "ulabs" && (() => {
            const myItems = (cat?.products || [])
              .map((p, idx) => ({ p, qty: quantities[`ulabs-${idx}`] || 0, idx }))
              .filter(({ qty }) => qty > 0);
            if (myItems.length === 0) return null;
            const myTotal = myItems.reduce((s, { p, qty }) => {
              const pn = p.pv ? Math.round(p.pv * 0.67 * 100) / 100 : p.pn;
              return s + (pn || 0) * qty;
            }, 0);
            const confirmOrder = async () => {
              if (ulabsConfirming || ulabsConfirmed) return;
              // Vérifier les conditions depuis la config campagne
              const activeCampConf = getCampaign("ulabs");
              const prods = cat?.products || [];
              const cmdRefs = prods.filter((p, idx) => (parseInt(quantities[`ulabs-${idx}`]) || 0) > 0);
              const errors = [];
              const minRefs = activeCampConf?.min_refs ?? 12;
              if (cmdRefs.length < minRefs) errors.push(`• Minimum ${minRefs} références (${cmdRefs.length} actuellement)`);
              for (const cond of (activeCampConf?.conditions || [])) {
                try {
                  const rx = new RegExp(cond.match_regex, "i");
                  const nb = cmdRefs.filter(p => rx.test(p.name)).length;
                  if (nb < cond.count) errors.push(`• ${cond.count} ${cond.label} minimum (${nb} actuellement)`);
                } catch(e) {}
              }
              if (errors.length > 0) {
                setUlabsError("⚠️ Conditions non remplies :\n" + errors.join("\n"));
                setTimeout(() => setUlabsError(null), 8000);
                return;
              }
              setUlabsError(null);
              setUlabsConfirming(true);
              const orderId = Date.now();
              const items = myItems.map(({ p, qty }) => {
                const pn = p.pv ? Math.round(p.pv * 0.67 * 100) / 100 : p.pn;
                return { cip: p.cip, name: p.name, qty, pn, total: Math.round((pn||0) * qty * 100) / 100 };
              });
              const csv = ["CIP;Désignation;Qté;Prix net HT;Total HT",
                ...items.map(i => `${i.cip};${i.name};${i.qty};${(i.pn||0).toFixed(2)};${(i.total||0).toFixed(2)}`)
              ].join("\n");
              try {
                // jeton pharmacie, ou admin en saisie Elixir pour une pharmacie ; confirmée seulement si enregistrée
                const res = await appelAuthentifie("/.netlify/functions/order-save", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: orderId, pharmacyName, pharmacyEmail, pharmacyCip,
                    isClient: true, items, totalHt: myTotal, nbLignes: items.length, csv,
                    source: "ulabs", ...(actingFor ? { enteredByAdmin: true } : {})
                  })
                });
                if (res.ok) setUlabsConfirmed(true);
                else {
                  if (res.status === 401 && !actingFor) { setEnvoiBloque("reconnexion"); groupeAResynchroniser.current = true; }   // quantités renvoyées au groupement après la reconnexion
                  setUlabsError(res.status === 401 ? `⚠️ Commande non enregistrée : session expirée\n${actingFor ? MESSAGE_ENVOI_BLOQUE.admin : "Reconnectez-vous avec le code reçu par e-mail, puis confirmez à nouveau : vos quantités sont conservées."}`
                    : res.status === 403 ? `⚠️ Commande non enregistrée\n${actingFor ? MESSAGE_ENVOI_BLOQUE.admin : MESSAGE_ENVOI_BLOQUE.fiche}`
                    : "⚠️ Commande non enregistrée\nRéessayez dans un instant : vos quantités sont conservées.");
                }
              } catch(e) { console.error(e); setUlabsError("⚠️ Commande non enregistrée\nRéessayez dans un instant : vos quantités sont conservées."); }
              setUlabsConfirming(false);
            };
            // Barre collante de confirmation (lot 9, habillage seulement : calculs, confirmOrder, onClick et disabled
            // inchangés). Pétrole comme l'en-tête (plus de verts #0d4f3c / #059669), « Confirmer ma commande » en or + encre
            // (l'envoi de la commande groupée, comme « Envoyer la commande »), confirmée en ok + blanc. Sur mobile, elle
            // laisse à droite la place du panier flottant (60 px à 24 px du bord), qui la recouvrait.
            const placePanier = isMobile && panierFlottant;
            return (
              <div style={{ position: "sticky", bottom: isMobile ? 24 : 20, display: "flex", flexDirection: "column", alignItems: "center", zIndex: 50, marginTop: 16,
                paddingRight: placePanier ? 80 : 0 }}>
                {/* conditions non remplies (lot 8) : encart danger annoncé (role="alert"), texte inchangé, ⚠️ remplacé par l'icône */}
                {ulabsError && (
                  <div role="alert" style={{ ...ui.encart("danger"), boxShadow: T.shadow2, padding: "10px 18px", marginBottom: 8, maxWidth: 480, textAlign: "left", display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <Icone nom="alerte" taille={16} style={{ marginTop: 1 }} />
                    <div>{ulabsError.replace(/^⚠️\s*/, "").split("\n").map((line, i) => <div key={i} style={{ fontSize: i === 0 ? 13 : 12, fontWeight: i === 0 ? 700 : 500, lineHeight: 1.45 }}>{line}</div>)}
                      {/* commande non enregistrée faute de session (correctif de sécurité du 19/10/2026) : reconnexion par code, quantités gardées */}
                      {envoiBloque === "reconnexion" && !actingFor && <ActionEtat principal icone="cadenas" onClick={() => { setUlabsError(null); demanderReconnexion(); }} style={{ marginTop: 8 }}>Se reconnecter</ActionEtat>}
                    </div>
                  </div>
                )}
                <div className="ex-on-dark" style={{ background: T.petrol, color: T.paper, borderRadius: R.m, boxShadow: T.shadow3, display: "flex", alignItems: "center",
                  gap: isMobile ? 12 : 20, padding: isMobile ? "10px 10px 10px 14px" : "14px 16px 14px 24px", width: isMobile ? "100%" : undefined, maxWidth: 560 }}>
                  <div style={{ minWidth: 0, flex: isMobile ? "1 1 auto" : undefined }}>
                    <div className="num" style={{ color: T.paperMute, fontSize: 11 }}>{myItems.length} référence(s) · {myItems.reduce((s,{qty})=>s+qty,0)} unités</div>
                    <div className="num" style={{ fontWeight: 700, fontSize: isMobile ? 16 : 18, lineHeight: 1.3 }}>{fmt(myTotal)} HT <span style={{ fontSize: 11, color: T.orClair, fontWeight: 600, whiteSpace: "nowrap" }}>remise −33% incluse</span></div>
                  </div>
                  <button className={ulabsConfirmed || ulabsConfirming ? undefined : "ex-btn-or"} onClick={confirmOrder} disabled={ulabsConfirming || ulabsConfirmed} style={{
                    ...ui.btn("or", "l"), flexShrink: 0, gap: 8, fontSize: 14,
                    ...(isMobile ? { height: "auto", minHeight: 44, padding: "6px 14px", whiteSpace: "normal", lineHeight: 1.2, maxWidth: 150, textAlign: "left" } : {}),
                    ...(ulabsConfirmed ? { background: T.ok, color: "#fff", cursor: "default" }
                      : ulabsConfirming ? { cursor: "progress" }
                      : { background: undefined, color: undefined }),
                  }}>
                    {ulabsConfirmed ? <><Icone nom="coche" taille={18} epaisseur={2.4} />Commande confirmée !</>
                      : ulabsConfirming ? <><Icone nom="horloge" taille={18} />Envoi…</>
                      : <><Icone nom="envoyer" taille={18} />Confirmer ma commande</>}
                  </button>
                </div>
              </div>
            );
          })()}
          </>
          </>)}
        </main>

        {/* ── Mes commandes — overlay ── */}
        {showMyOrders && (
          <MyOrdersPanel
            orders={myOrders}
            loading={myOrdersLoading}
            erreur={myOrdersErreur}
            onReconnecter={actingFor ? null : demanderReconnexion}
            pharmacyName={pharmacyName}
            onClose={() => setShowMyOrders(false)}
            // Assistant Elixir : « Une question sur cette commande ? » — seule la référence du site part (revérifiée par le serveur)
            onQuestion={assistantDispo ? (order) => ouvrirAssistant({ commande_site_id: String(order.id), date: order.date }) : undefined}
            onReorder={async (items) => {
              // article à plusieurs références : une ligne au prix du jour (référence servie en premier),
              // répartie par CIP à l'envoi ; quantité remplacée comme pour les lignes du catalogue
              const groups = items.some(it => it.group) ? await loadGroups() : null;
              items.forEach(it => {
                if (!it.cip || !it.qty) return;
                if (it.group) {
                  const refs = groups?.refs?.[it.group] || [];
                  const head = allocate(refs, 1).lines[0]?.ref || refs[0];
                  const pn = head ? (head.discounted_price && head.discount_pct > 0 ? head.discounted_price : head.list_price) : it.pn;
                  const line = { cip: head?.cip || it.cip, name: head?.name || it.name, qty: parseInt(it.qty) || 0, pn, pv: head?.list_price ?? pn,
                    tiers: head?.price_tiers || null, supplier_code: it.group };
                  setSpecialItems(prev => {
                    const j = prev.findIndex(x => x.supplier_code === it.group);
                    return j >= 0 ? prev.map((x, n) => n === j ? { ...x, ...line } : x) : [...prev, line];
                  });
                  return;
                }
                Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, c]) => {
                  const idx = (c.products || []).findIndex(p => p.cip === it.cip);
                  if (idx >= 0) setQuantities(prev => ({ ...prev, [`${catKey}-${idx}`]: parseInt(it.qty) || 0 }));
                });
              });
              setShowMyOrders(false);
              flash(`✓ ${items.length} produit(s) ajoutés au panier`);
            }}
          />
        )}

        {/* Panier — tiroir fixe (refonte charte, lot 6 : habillage seulement). Inchangés : handleSend, condition
            disabled du bouton d'envoi, setItemQty, calculs du contingentement, balise <aside>, z-index 300 / 301 */}
        {cartOpen && (
          <div style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 300 }}
            onClick={() => setCartOpen(false)} />
        )}
        <aside aria-label="Panier" style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 301,
          width: isMobile ? "100%" : 380,
          background: T.surface, color: T.ink,
          display: "flex", flexDirection: "column",
          boxShadow: cartOpen ? "-16px 0 48px -20px rgba(10,29,34,.5)" : "none",   // fermé : pas d'ombre au bord de l'écran
          transform: cartOpen ? "translateX(0)" : "translateX(100%)",
          // revue (§ 20) : fermé, masqué une fois sorti de l'écran — ses boutons ne prennent plus le focus à la tabulation
          // (focus invisible hors de l'écran) et son titre n'est plus lu ; ouvert, visible tout de suite. Impression : tokens.css
          visibility: cartOpen ? "visible" : "hidden",
          transition: `transform .3s var(--ease), visibility 0s linear ${cartOpen ? "0s" : ".3s"}`,
          pointerEvents: cartOpen ? "auto" : "none",
        }}>
              <div style={{ padding: isMobile ? "16px 16px 0" : "20px 20px 0", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 640, letterSpacing: "-0.02em", color: T.petrol }}>
                    <Icone nom="panier" taille={22} />Panier
                  </h2>
                  <button className="ex-btn-ligne ex-cible" onClick={() => setCartOpen(false)} aria-label="Fermer le panier" title="Fermer"
                    style={{ ...btnEntete, color: T.ink }}><Icone nom="fermer" /></button>
                </div>
                {pharmacyName && (
                  <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2, marginBottom: 12 }}>{pharmacyName}</div>
                )}
                {/* tuiles neutres : la couleur ne distingue plus les deux chiffres, le libellé suffit */}
                <div style={{ display: "flex", gap: 10, paddingBottom: 16 }}>
                  {[["Lignes", cartItems.length], ["Unités", cartCount]].map(([libelle, valeur]) => (
                    <div key={libelle} style={{ flex: 1, background: T.surface2, borderRadius: R.s, padding: "8px 14px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkMute }}>{libelle}</div>
                      <div className="num" style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.25, color: T.ink }}>{valeur}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ overflowY: "auto", padding: isMobile ? "0 16px 16px" : "0 20px 20px" }}>
                {cartItems.length === 0 ? (
                  <EtatVide icone="panier" titre="Votre panier est vide" style={{ padding: "48px 12px" }}
                    texte="Ajoutez des produits depuis les menus du catalogue ou la Saisie de commande." />
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {cartItems.map((item, n) => (
                    <li key={item.key} style={{ padding: "14px 0", borderTop: n ? `1px solid ${T.lineSoft}` : "none" }}>
                      {/* Rayon (eyebrow ; sa couleur n'est plus qu'une pastille de repère) + suppression */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: T.inkMute }}>
                          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: R.pill, background: item.color, flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.cat.toUpperCase()}</span>
                        </div>
                        <button className="ex-btn-discret ex-cible" onClick={() => setItemQty(item, 0)} title="Supprimer" aria-label={`Supprimer ${item.name} du panier`}
                          style={{ ...pasPanier, width: isMobile ? 32 : 28, height: isMobile ? 32 : 28 }}><Icone nom="fermer" taille={14} epaisseur={2.4} /></button>
                      </div>
                      {/* Nom du produit */}
                      <div style={{ fontWeight: 600, fontSize: 13, color: T.ink, lineHeight: 1.35, margin: "2px 0 10px" }}>{item.name}</div>
                      {/* Unités gratuites des campagnes */}
                      {item.qtyUG > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <span style={{ ...ui.badge("ok"), whiteSpace: "normal", padding: "3px 10px 3px 8px" }}>
                            <Icone nom="cadeau" taille={13} epaisseur={2.2} />+ {item.qtyUG} unité{item.qtyUG>1?"s":""} offerte{item.qtyUG>1?"s":""} → {item.qty + item.qtyUG} livrées au total
                          </span>
                        </div>
                      )}
                      {/* Quantité (« − » sable, « + » pétrole, au pas du colis ; 40 px sous 768 px, classes ex-qte-*) + sous-total */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
                          <button className="ex-qte-moins" onClick={() => setItemQty(item, item.qty - item.step)} aria-label={`Diminuer la quantité de ${item.name}`}
                            style={pasPanier}><Icone nom="moins" taille={14} epaisseur={2.4} /></button>
                          <span className="num" style={{ fontWeight: 700, fontSize: 14, minWidth: 28, textAlign: "center", color: T.ink }}>{item.qty}</span>
                          <button className="ex-qte-plus" onClick={() => setItemQty(item, item.qty + item.step)} aria-label={`Augmenter la quantité de ${item.name}`}
                            style={pasPanier}><Icone nom="plus" taille={14} epaisseur={2.4} /></button>
                          <span className="num" style={{ fontSize: 12, color: T.inkMute, marginLeft: 4, whiteSpace: "nowrap" }}>× {fmt(item.pn)}</span>
                          {item.step > 1 && <span className="num" style={{ fontSize: 11, color: T.inkMute, whiteSpace: "nowrap" }}>· par {item.step}</span>}
                        </div>
                        <span className="num" style={{ fontWeight: 700, color: T.ink, fontSize: 14, whiteSpace: "nowrap" }}>{fmt(item.total)}</span>
                      </div>
                      {/* Palier de quantité : appliqué (ton palier), ou à viser (ton avertissement) */}
                      {(item.tier || item.nextTier) && (
                        <div style={encart(item.tier ? "tier" : "warn")}>
                          {item.tier && (<div style={ligneEncart}><Icone nom="coche" taille={14} epaisseur={2.4} style={iconeEncart} />
                            <span>Prix palier <strong>{fmt(item.pn)}</strong> appliqué dès {item.tier.min_qty} unités{item.basePn != null && item.basePn > item.pn ? ` (au lieu de ${fmt(item.basePn)})` : ""}</span></div>)}
                          {item.nextTier && (<div style={{ ...ligneEncart, marginTop: item.tier ? 2 : 0 }}><Icone nom="cible" taille={14} style={iconeEncart} />
                            <span>Encore <strong>{item.nextTier.min_qty - item.qty}</strong> unité{item.nextTier.min_qty - item.qty > 1 ? "s" : ""} pour passer à <strong>{fmt(item.nextTier.price)}</strong></span></div>)}
                        </div>
                      )}
                      {/* Contingentement : quota de la période, déjà commandé, reste */}
                      {item.cip && quotaCheck.P[item.cip] && (() => {
                        const q = quotaCheck.P[item.cip];
                        const over = quotaCheck.inCart[item.cip] > q.remaining;
                        const room = Math.max(0, q.remaining - (quotaCheck.inCart[item.cip] - item.qty));   // reste pour CETTE ligne
                        const max = item.step > 1 ? Math.floor(room / item.step) * item.step : room;
                        return (
                          <div style={encart(over ? "danger" : "info")}>
                            <div style={ligneEncart}>
                              <Icone nom="cadenas" taille={14} style={iconeEncart} />
                              <span>Contingenté : <strong>{q.label}</strong>{q.used > 0 ? ` · déjà commandé ${q.used}` : ""} · reste <strong>{q.remaining}</strong>
                                {q.end && <span style={{ color: over ? T.danger : T.inkSoft }}> (nouveau quota le {quotaDay(q.end)})</span>}</span>
                            </div>
                            {over && (
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 6, paddingLeft: 20, fontWeight: 700 }}>
                                {q.remaining === 0 ? "Quota atteint pour cette période" : `Maximum ${q.remaining} pour cette période`}
                                <button className="ex-btn-danger-ligne" onClick={() => setItemQty(item, max)} style={{ ...ui.btn("ligne", "s"), background: undefined, color: undefined, boxShadow: undefined,
                                  height: 28, padding: "0 12px", fontSize: 12 }}>{max > 0 ? `Ramener à ${max}` : "Retirer"}</button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Sur justificatif labo : attestation, renouvellement, ordonnance anonymisée */}
                      {needsJustif(item, justifProducts, cartTotalsByCip) && (
                        <JustifCartBlock rule={justifProducts[item.cip]} info={justifInfo[item.cip]} onChange={(patch) => updateJustif(item.cip, patch)}
                          auth={actingFor ? { token: localStorage.getItem("admin_token"), odooId: actingFor.odoo_id } : { getToken: freshPharmacyToken }} />
                      )}
                      {/* Avertissement rupture */}
                      {item.cip && !needsJustif(item, justifProducts, cartTotalsByCip) && (stockData[item.cip]?.dispo === 0 || stockData[item.cip]?.dispo === false) && (
                        <div style={{ ...encart("danger"), ...ligneEncart }}>
                          <Icone nom="alerte" taille={14} style={iconeEncart} />
                          <span><strong>Rupture de stock</strong> — ce produit peut ne pas être disponible à la livraison</span>
                        </div>
                      )}
                    </li>
                  ))}
                  </ul>
                )}

                {/* ── ML: Recommandations cross-sell dans le panier ── */}
                {cartItems.length > 0 && (
                  <CrossSellBanner
                    cartCips={cartItems.map(i => i.cip).filter(Boolean)}
                    onAdd={(cip, qty) => {
                      Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, c]) => {
                        const idx = (c.products || []).findIndex(p => p.cip === cip);
                        if (idx >= 0) setQuantities(prev => ({ ...prev, [`${catKey}-${idx}`]: (parseInt(prev[`${catKey}-${idx}`]) || 0) + qty }));
                      });
                    }}
                  />
                )}

                {cartItems.length > 0 && (
                <div style={{ paddingTop: 16, marginTop: 16, borderTop: `1px solid ${T.line}` }}>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 2 }}>
                    <span style={{ color: T.inkSoft, fontSize: 13 }}>Total HT estimé</span>
                    <span className="num" style={{ fontWeight: 700, fontSize: 20, color: T.ink, whiteSpace: "nowrap" }}>{fmt(cartTotal)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 12 }}>
                    * Prix nets remisés – Hors conditions spéciales
                  </div>
                  <div style={{ ...encart("ok"), marginTop: 0, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <Icone nom="camion" taille={18} />
                    <span>Livraison estimée : <strong>{nextBusinessDay()}</strong></span>
                  </div>

                  {/* Récapitulatif de la pharmacie */}
                  <div style={{ background: T.surface2, borderRadius: R.s, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: T.ink }}>{pharmacyName}</div>
                    <div style={{ color: T.inkSoft, marginTop: 2, overflowWrap: "anywhere" }}>{pharmacyEmail}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, color: isClient ? T.ok : T.warn, marginTop: 4, fontSize: 11, fontWeight: 700 }}>
                      <Icone nom={isClient ? "coche" : "document"} taille={12} epaisseur={2.4} />{isClient ? "Client existant" : "Nouveau client – RIB joint"}
                    </div>
                  </div>

                  {quotaCheck.over.length > 0 && (
                    <div role="alert" style={{ ...encart("danger"), ...ligneEncart, gap: 8, marginTop: 0, marginBottom: 10, fontWeight: 600 }}>
                      <Icone nom="cadenas" taille={16} style={{ marginTop: 1 }} />
                      <span>Contingentement dépassé : {quotaCheck.over.map(o => `${o.name} (${o.qty} demandés, reste ${o.remaining})`).join(" ; ")}. Ajustez ces lignes pour envoyer la commande.</span>
                    </div>
                  )}
                  {justifCheck.length > 0 && (
                    <div role="alert" style={{ ...encart("labo"), ...ligneEncart, gap: 8, marginTop: 0, marginBottom: 10, fontWeight: 600 }}>
                      <Icone nom="document" taille={16} style={{ marginTop: 1 }} />
                      <span>Commande sur justificatif labo : {justifCheck.map(o => `${o.name} — ${o.msg}`).join(" ; ")}.</span>
                    </div>
                  )}
                  {/* envoi refusé avant tout envoi (session à refaire, compte sans pharmacie, serveur injoignable) : rien n'est
                      parti, le panier reste tel quel ; « Se reconnecter » ouvre la connexion par code sans vider le panier.
                      Session sans aucun jeton (avant la connexion par code) : annoncé dès l'ouverture du panier, avant l'envoi */}
                  {(() => {
                    const motif = envoiBloque || (!actingFor && sansJeton ? "sansJeton" : null);
                    if (!motif) return null;
                    const reconnecter = !actingFor && (motif === "reconnexion" || motif === "sansJeton");
                    return (
                      <div role={motif === "sansJeton" ? "status" : "alert"} style={{ ...encart(motif === "sansJeton" ? "info" : motif === "erreur" ? "warn" : "danger"), ...ligneEncart, gap: 8, marginTop: 0, marginBottom: 10 }}>
                        <Icone nom={reconnecter ? "cadenas" : "alerte"} taille={16} style={{ marginTop: 1 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{MESSAGE_ENVOI_BLOQUE[motif]}</div>
                          {reconnecter && (
                            <ActionEtat principal icone="cadenas" onClick={demanderReconnexion} style={{ marginTop: 8 }}>{motif === "sansJeton" ? "Se connecter par code" : "Se reconnecter"}</ActionEtat>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Envoi : pastille or + encre (5,82:1, au lieu de blanc sur bleu à 2,77:1) ; succès ok + blanc (7,68:1),
                      erreur danger + blanc ; bloqué (contingentement, justificatif) : sable. onClick et disabled inchangés */}
                  <button
                    className="ex-btn-or"
                    onClick={handleSend}
                    disabled={sendStatus === "sending" || sendStatus === "success" || quotaCheck.over.length > 0 || justifCheck.length > 0}
                    style={{
                      ...ui.btn("or", "l"), width: "100%", gap: 10,
                      ...(sendStatus === "success" ? { background: T.ok, color: "#fff" }
                        : sendStatus === "error" ? { background: T.danger, color: "#fff" }
                        : quotaCheck.over.length > 0 || justifCheck.length > 0 ? { background: T.sand, color: T.inkSoft, cursor: "not-allowed" }
                        : { background: undefined, color: undefined, cursor: sendStatus === "sending" ? "progress" : "pointer" }),
                    }}>
                    {sendStatus === "sending" ? <><Icone nom="horloge" />Envoi en cours…</> :
                     sendStatus === "success" ? <><Icone nom="coche" epaisseur={2.4} />Commande envoyée&nbsp;!</> :
                     sendStatus === "error" ? <><Icone nom="alerte" />Erreur – Réessayez</> :
                     <><Icone nom="envoyer" />Envoyer la commande</>}
                  </button>

                  {/* secondaires à filet, côte à côte */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                    <button className="ex-btn-ligne" onClick={handlePrint} title="Imprimer le bon de commande" aria-label="Imprimer le bon de commande" style={btnSecondaire}>
                      <Icone nom="imprimer" taille={18} />Imprimer
                    </button>
                    <button className={copyStatus ? undefined : "ex-btn-ligne"} onClick={handleCopy} title="Copier le bon de commande"
                      aria-label={copyStatus ? undefined : "Copier le bon de commande"}
                      style={{ ...btnSecondaire, ...(copyStatus ? (() => { const t = tone(copyStatus.startsWith("✓") ? "ok" : "danger"); return { background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1.5px ${t.border}` }; })() : {}) }}>
                      {copyStatus
                        ? <><Icone nom={copyStatus.startsWith("✓") ? "coche" : "alerte"} taille={18} />{copyStatus.replace(/^✓\s*/, "")}</>
                        : <><Icone nom="copier" taille={18} />Copier</>}
                    </button>
                  </div>
                  <button className="ex-lien-danger" onClick={() => { setQuantities({}); setSpecialItems([]); setJustifInfo({}); }} style={{
                    ...ui.btn("lien"), display: "flex", gap: 6, margin: "12px auto 0", padding: "8px 12px", fontSize: 13, fontWeight: 600
                  }}><Icone nom="corbeille" taille={16} />Vider le panier</button>
                </div>
                )}
              </div>
        </aside>
      </div>

      {/* ── Assistant Elixir : tiroir au niveau du panier (301), exclusif avec lui ; panneau chargé à la demande ── */}
      {assistantOuvert && assistantDispo && (
        <PanneauAssistant key={identiteAssistant} identite={identiteAssistant} auth={authAssistant(actingFor)} mobile={isMobile}
          pharmacyName={pharmacyName} acting={actingFor} contexte={assistantContexte}
          onClose={() => setAssistantOuvert(false)} onInfos={(infos) => setAssistant(a => ({ ...a, infos }))}
          // reconnexion par code sans quitter la session (panier gardé) ; le panneau se ferme avec l'identité (identiteAssistant)
          onReconnecter={demanderReconnexion} />
      )}
      {/* Assistant Elixir : lanceur flottant (au-dessus du panier flottant) et fenêtre de présentation, une fois le catalogue
          affiché, aux pharmacies seulement (jamais en saisie Elixir, ni à l'arrivée par le lien d'un menu promo, comme
          « Offres du moment ») ; chargés à la demande (Aide.jsx, Presentation.jsx). Lanceur masqué aussi tant que la barre
          collante de confirmation U-Labs est affichée (quantités U-Labs saisies) : il recouvrait son encart « Conditions
          non remplies » entre 768 et 1 300 px ; la bulle de l'en-tête reste. */}
      {assistantDispo && (
        <CoucheAssistant identite={identiteAssistant} mobile={isMobile} presenter={!actingFor && assistant.mode === "complet" && !menuViaLien.current} pret={!productsLoading}
          ouvert={assistantOuvert} pile={panierFlottant} onOuvrir={ouvrirAssistant} differer={activeTab === "accueil"}
          cache={cartOpen || showAdmin || (sidebarOpen && !isDesktop)
            || (activeTab === "ulabs" && Object.keys(quantities).some(k => k.startsWith("ulabs-") && (parseInt(quantities[k]) || 0) > 0))} />
      )}

      {/* Floating cart button when closed — masqué pendant que le tiroir de menu (mobile, tablette) est ouvert : son
          zIndex (290) le laissait seul au-dessus du voile du menu (140) (lot 9) ; masqué aussi pendant que l'assistant est ouvert */}
      {panierFlottant && !(sidebarOpen && !isDesktop) && !assistantOuvert && (
        <button data-cible-panier className="ex-panier-flottant" onClick={() => setCartOpen(true)} aria-label={`Ouvrir le panier : ${cartCount} unité${cartCount > 1 ? "s" : ""}`} style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 290,   // sous le voile du panier (300)
          color: T.paper, border: "none", borderRadius: R.pill, width: 60, height: 60,   // fond pétrole : classe (survol)
          cursor: "pointer", boxShadow: T.shadow2, padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <Icone nom="panier" taille={24} />
          {/* compteur or + encre, comme le compteur du panier de l'en-tête */}
          <span className="num" style={{ position: "absolute", top: -4, right: -4, minWidth: 24, height: 24, padding: "0 6px", boxSizing: "border-box",
            borderRadius: R.pill, background: T.or, color: T.ink, fontSize: 12, fontWeight: 700, lineHeight: "24px", textAlign: "center",
            boxShadow: `0 0 0 2px ${T.cream}` }}>{cartCount}</span>
        </button>
      )}

      {/* Admin Panel */}
      {showAdmin && (
        /* erreur de l'admin (lot 8) : même dessin que les autres erreurs, textes et bouton (même onClick) inchangés */
        <ErrorBoundary fallback={<div style={{position:"fixed",inset:0,zIndex:9999,background:T.cream,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <EtatVide erreur icone="alerte" titre="Erreur Admin Panel" texte="Une erreur s'est produite. Essayez de vider le cache du navigateur."
            style={{ ...ui.modal, maxWidth: 500, border: `1px solid ${T.line}`, padding: "40px 32px" }}
            actions={<button className="ex-btn-petrole" onClick={() => { localStorage.removeItem("admin_token"); window.location.hash = ""; window.location.reload(); }}
              style={{ ...ui.btn("primaire", "l"), background: undefined, color: undefined }}>
              Réinitialiser et recharger
            </button>} />
        </div>}>
          <React.Suspense fallback={<div className="ex-admin" style={{position:"fixed",inset:0,zIndex:1000,background:T.cream,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Chargement texte="Chargement de l'admin…" />
          </div>}>
          <AdminPanel
            sectionMeta={SECTION_META}
            onOrderForPharmacy={() => setShowPharmacyPicker(true)}
            onClose={() => {
              window.location.hash = "";
              fetchProducts();
              try { setPromoSections(JSON.parse(localStorage.getItem("admin_promos") || "[]")); } catch {}
            }}
          />
          </React.Suspense>
        </ErrorBoundary>
      )}
      {showPharmacyPicker && <PharmacyPicker onPick={startActing} onClose={() => setShowPharmacyPicker(false)} />}
    </div>
  );
}

// ── Admin impossible à charger (import de AdminPanel en échec) : recharger, sans retirer le jeton admin ──
function AdminIndisponible() {
  return (
    <div className="ex-admin" style={{position:"fixed",inset:0,zIndex:1000,background:T.cream,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <EtatVide erreur icone="alerte" titre="Admin indisponible" texte="L'admin n'a pas pu se charger (connexion, ou nouvelle version du site mise en ligne) : rechargez la page."
        style={{ ...ui.modal, maxWidth: 500, border: `1px solid ${T.line}`, padding: "40px 32px" }}
        actions={<button className="ex-btn-petrole" onClick={() => window.location.reload()}
          style={{ ...ui.btn("primaire", "l"), background: undefined, color: undefined }}>
          Recharger la page
        </button>} />
    </div>
  );
}

// ── Admin : choisir la pharmacie pour laquelle on passe commande (clients Elixir d'Odoo, avec ou sans compte) ──
function PharmacyPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/.netlify/functions/admin-pharmacy-find?q=${encodeURIComponent(q.trim())}`, { headers: { Authorization: `Bearer ${localStorage.getItem("admin_token") || ""}` } });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) throw new Error("Session admin expirée : ouvrez l'admin (#admin) pour vous reconnecter, puis recommencez.");
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setRes(j.pharmacies || []);
    } catch (e) { setErr(e.message); setRes(null); }
    setBusy(false);
  };
  return (
    // Refonte charte (lot 7) : fenêtre paper de rayon 28 sur voile --scrim ; recherche, choix et zIndex 10000 inchangés.
    // Outil interne Elixir rendu dans .ex-app (même ouvert depuis l'admin) : nom, ville, CIP, téléphone restent
    // sélectionnables malgré l'anti-copie (ex-selectionnable, revue § 20)
    <div role="dialog" aria-modal="true" aria-labelledby="choix-pharmacie-titre" onClick={onClose}
      style={{ ...ui.overlay, zIndex: 10000, alignItems: "flex-start", padding: "60px 16px", overflowY: "auto" }}>
      <div className="ex-selectionnable" onClick={e => e.stopPropagation()} style={{ ...ui.modal, padding: "24px 24px 22px", maxWidth: 620 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <h2 id="choix-pharmacie-titre" style={{ ...ui.titreModal, fontSize: 18 }}><Icone nom="crayon" taille={20} style={{ color: T.acting }} />Commander pour une pharmacie</h2>
          <button className="ex-btn-discret ex-cible" onClick={onClose} aria-label="Fermer" title="Fermer" style={ui.rond(36)}><Icone nom="fermer" taille={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 14, lineHeight: 1.5 }}>Clients Elixir dans Odoo, avec ou sans compte sur le site. Le panier sera envoyé au nom de la pharmacie choisie (CIP, PharmaML, contingentement), avec la mention « saisie par Elixir ».</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Nom, ville, CIP ou e-mail" aria-label="Rechercher une pharmacie"
            style={{ ...ui.input, flex: 1, height: 44, borderRadius: R.pill, padding: "0 16px" }} />
          <button className={busy || q.trim().length < 2 ? undefined : "ex-btn-petrole"} onClick={search} disabled={busy || q.trim().length < 2}
            style={{ ...ui.btn("primaire", "m"), height: 44, background: busy || q.trim().length < 2 ? T.sand : undefined, color: busy || q.trim().length < 2 ? T.inkSoft : undefined, cursor: busy || q.trim().length < 2 ? "not-allowed" : "pointer" }}>{busy ? "…" : "Rechercher"}</button>
        </div>
        {err && <div role="alert" style={{ ...ui.encart("danger"), marginTop: 12, display: "flex", alignItems: "flex-start", gap: 6 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} /><span>{err}</span></div>}
        {res && !res.length && <div style={{ marginTop: 12, color: T.inkSoft, fontSize: 13 }}>Aucune pharmacie cliente d'Elixir ne correspond.</div>}
        {res && res.length > 0 && (
          <div style={{ marginTop: 12, maxHeight: 380, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: R.m, background: T.surface }}>
            {res.map(p => (
              <button key={p.odoo_id} className="ex-tr" onClick={() => onPick(p)} style={{ display: "flex", width: "100%", textAlign: "left", gap: 10, alignItems: "center", border: "none", borderBottom: `1px solid ${T.lineSoft}`, padding: "10px 14px", cursor: "pointer", fontFamily: "inherit", color: T.ink }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: T.ink, fontSize: 14 }}>{p.name}</div>
                  <div className="num" style={{ fontSize: 12, color: T.inkSoft }}>{[p.zip && p.city ? `${p.zip} ${p.city}` : p.city, p.cip ? `CIP ${p.cip}` : "sans CIP", p.phone].filter(Boolean).join(" · ")}</div>
                </div>
                <span style={ui.badge(p.has_account ? "ok" : "neutral")}>{p.has_account ? "compte site" : "sans compte"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Cellule de tableau (refonte charte, lot 4) : gabarit conservé (10 × 14 px, lignes de 44 à 60 px), 13 px encre
const tdStyle = ui.td;
// En-tête de colonne : eyebrow neutre ; retour à la ligne permis (« SOUS-TOTAL », « PRIX CARTON »…) pour laisser
// la largeur à la désignation, comme avant la refonte
const thStyle = { ...ui.th, whiteSpace: "normal", letterSpacing: "0.04em", lineHeight: 1.25, verticalAlign: "bottom" };

// Boutons de quantité : « − » sable, « + » pétrole. Fond et couleur posés par les classes ex-qte-moins / ex-qte-plus
// (survol) ; 24 px dans le tableau d'ordinateur, 30 en liste mobile, 32 en grille. Plus de couleur du rayon.
const qtyBtnStyle = (kind, taille = 24) => ({ ...ui.qtyBtn(kind), background: undefined, color: undefined, width: taille, height: taille });
