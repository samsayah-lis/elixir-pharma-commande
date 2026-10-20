// ── Page d'accueil : les outils du site qu'une mise en avant peut montrer (type « outil », docs/accueil.md § 7.8) — JS pur ──
// Registre des 6 outils sélectionnables (liste fermée, OUTILS_MEA = celle du serveur, netlify/functions/_accueil-outils.js,
// et incluse dans OUTILS_LIEN d'App.jsx : chaque outil mis en avant reste ouvrable même masqué dans la barre latérale ;
// scripts/test-accueil-outils.mjs le vérifie), textes par défaut (titre et accroche pris au rendu quand Zineb les laisse
// vides, badge pré-rempli à l'ajout), textes des chiffres du moment (calculés par le serveur ; ici seulement formatés) et
// cartes de la composition automatique (éventail des photos du fabricant pour les fauteuils ; sinon « plaque » pétrole et
// or avec l'icône de l'outil, et cartes-chiffres). Jamais « temps réel », jamais de quantité en stock, jamais de nom ni
// de photo de médicament (Péremption, Justificatif : chiffres d'ensemble et noms de laboratoires seulement), jamais de
// compte à rebours. Importé par vedettes.js (page), vedettes-regles.js et l'éditeur de l'admin. LINES et MEDIA sont déjà
// dans le bundle des pharmacies (WheelchairOrder) : aucun octet dupliqué. Le nom outils.js est pris (utilitaires du chunk).
import { LINES } from "../../wheelchair-logic.js";
import { MEDIA } from "../../wheelchair-media.js";
import { fmtEur } from "../../theme.js";

export const OUTILS_MEA = ["saisie", "peremption", "fauteuil", "transfert", "justificatif", "groupees"];
// rubriques exclues des « Accès rapides » de l'accueil (outils, campagne U-Labs, accueil lui-même)
export const RUBRIQUES_HORS_CATALOGUE = ["accueil", "saisie", "peremption", "fauteuil", "transfert", "justificatif", "ulabs", "groupees"];

// ── Formats (affichage : espaces insécables comme theme.js ; texte lu : comme prixLu de vedettes.js) ──
const FINE = "\u202f", NBSP = "\u00a0";
export const entier = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, FINE);
const eurHT = (n) => `${fmtEur(n)}${NBSP}HT`;
const eurLu = (n) => `${Number(n).toFixed(2).replace(".", ",")} € HT`;
const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);
const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisTexte = (am, long = false) => { const m = /^(\d{4})-(\d{2})/.exec(String(am || "")); return m ? `${(long ? MOIS : MOIS_COURT)[Number(m[2]) - 1]} ${m[1]}` : ""; };
// « le 20 oct. à 8 h 38 » (heure de Paris ; même format que majTexte d'outils.js, sans React)
export function heureMaj(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return `le ${Number(p.day)} ${MOIS_COURT[Number(p.month) - 1]} à ${Number(p.hour)} h ${p.minute}`;
}
const sansEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
const enumeration = (l, et = "et") => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} ${et} ${l.at(-1)}`);
const virgule = (s) => String(s).replace(".", ",");

// ── Fauteuils : modèle et tailles repris de LINES (configurateur) ──
const modeleLong = (cle) => (cle === "transfert" ? LINES.transfert.model.replace(/\s*Action 2NG$/, "") : LINES[cle].model);   // « Invacare Transit Lite »
export const modeleCourt = (cle) => modeleLong(cle).replace(/^Invacare\s+/, "");                                         // « Action 2NG », « Transit Lite »
const taillesLINES = (cle) => `${enumeration(LINES[cle].sizes.map(virgule), "ou")} cm`;

// ── Justificatif : noms des laboratoires du moment (« A et B », « A, B et C », au-delà « A, B et N autres laboratoires ») ──
const QUE_FAIT_JUSTIF = "votre commande part au laboratoire avec votre justificatif, et vous suivez chaque étape.";
// sans laboratoire connu, ou noms trop longs pour 140 caractères : la phrase seule
function accrocheJustif(ch) {
  const noms = (ch?.labos || []).map(l => String(l.nom || "").trim()).filter(Boolean);
  const qui = noms.length > 3 ? `${noms.slice(0, 2).join(", ")} et ${noms.length - 2} autres laboratoires` : enumeration(noms);
  const t = qui ? `${qui} : ${QUE_FAIT_JUSTIF}` : "";
  return t && t.length <= 140 ? t : `${QUE_FAIT_JUSTIF.charAt(0).toUpperCase()}${QUE_FAIT_JUSTIF.slice(1)}`;
}

// ── Registre : libellé (barre latérale), icône au trait (ICONES_RAYON), teinte (accent du menu ; le violet par défaut
// du justificatif est remplacé par la sarcelle dans vedettes.js), textes par défaut, bouton de la vitrine (cta) et pied de
// tuile (ctaCourt), composition automatique, chiffres exigés (sans eux, la carte reste cachée) ──
export const OUTILS = {
  saisie: {
    libelle: "Saisie de commande", icone: "crayon", accent: "#2d9cbc", composition: "plaque", chiffresRequis: false,
    titre: "Commandez par CIP, EAN ou nom",
    accroche: () => "Tout le catalogue Elixir dans un seul champ : quelques lettres du nom, le CIP ou le code EAN, et la boîte part au panier.",
    badge: "Tout le catalogue", cta: () => "Ouvrir la Saisie de commande", ctaCourt: "Ouvrir la Saisie",
    sansPhoto: "plaque de l'outil et chiffres du catalogue",
  },
  peremption: {
    libelle: "Péremption courte", icone: "horloge", accent: "#ea580c", composition: "plaque", chiffresRequis: true,
    titre: "Péremption courte, petits prix",
    accroche: () => "Produits en stock à péremption entre J+30 et 4 mois : la remise est déjà dans le prix affiché.",
    badge: "Petits prix", cta: (ch) => (ch?.nb === 1 ? "Voir le produit" : ch?.nb > 1 ? `Voir les ${ch.nb} produits` : "Voir les produits"), ctaCourt: "Voir les produits",
    sansPhoto: "plaque de l'outil et chiffres du moment",
  },
  fauteuil: {
    libelle: "Fauteuil roulant", icone: "fauteuil", accent: "#3b82f6", composition: "photos", chiffresRequis: true,
    titre: "Le bon fauteuil, à la bonne largeur",
    accroche: () => `${modeleLong("fauteuil")} : la largeur d'assise se déduit d'une mesure ou du poids, puis le bon modèle s'affiche avec son prix.`,
    badge: "Aide au choix", cta: () => "Choisir la largeur", ctaCourt: "Choisir la largeur",
    sansPhoto: "éventail des photos du fabricant",
  },
  transfert: {
    libelle: "Fauteuil de transfert", icone: "chaise", accent: "#3b82f6", composition: "photos", chiffresRequis: true,
    titre: `Fauteuil de transfert ${modeleCourt("transfert")}`,
    accroche: () => `${modeleLong("transfert")}, en ${taillesLINES("transfert")} : la largeur d'assise se déduit d'une mesure ou du poids.`,
    badge: "Aide au choix", cta: () => "Choisir la largeur", ctaCourt: "Choisir la largeur",
    sansPhoto: "éventail des photos du fabricant",
  },
  justificatif: {
    libelle: "Commande labo sur justificatif", icone: "document", accent: "#7c3aed", composition: "plaque", chiffresRequis: true,
    titre: "Commande labo sur justificatif",
    accroche: accrocheJustif,
    badge: "Suivi pas à pas", cta: () => "Commander sur justificatif", ctaCourt: "Commander",
    sansPhoto: "plaque de l'outil et laboratoires du moment",
  },
  groupees: {
    libelle: "Commandes groupées", icone: "groupe", accent: "#2d9cbc", composition: "plaque", chiffresRequis: false,
    titre: "Vos commandes groupées",
    accroche: () => "Achats groupés et précommandes aux conditions négociées : saisissez vos quantités avant la clôture.",
    badge: "Conditions négociées", cta: () => "Voir les opérations", ctaCourt: "Voir les opérations",
    sansPhoto: "plaque de l'outil et opérations ouvertes",
  },
};

// Rubrique (sur-titre et texte lu) : le libellé du menu, qui garde un renommage de l'admin ; à défaut, celui du registre
export const rayonOutil = (cle, catalogue) => sansEmoji(catalogue?.[cle]?.label) || OUTILS[cle]?.libelle || "";

// Médicament d'un laboratoire sur justificatif : sa marque (premier mot du nom court, comme la détection de _lab-justif.js :
// « Somavert 10 mg » et « Somavert 15 mg » sont un même médicament en deux présentations)
export const marqueJustif = (s) => String(s || "").trim().split(/\s+/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Chiffres du justificatif recalculés depuis justifProducts (GET lab-justif?action=products, chargé par App) : mêmes règles
// que le serveur (labosDeConfig) → { labos: [{ nom, medicaments }], medicaments, presentations } | null (liste vide : pas
// encore chargée, rien n'est écarté pour autant)
export function chiffresJustif(justifProducts) {
  const parLab = new Map();
  for (const [cip, p] of Object.entries(justifProducts && typeof justifProducts === "object" ? justifProducts : {})) {
    if (!p || typeof p !== "object") continue;
    const nom = String(p.labNom || p.lab || "").trim() || "Laboratoire";
    const l = parLab.get(nom) || { nom, marques: new Set(), cips: new Set() };
    l.cips.add(cip); l.marques.add(marqueJustif(p.court || p.nom || cip));
    parLab.set(nom, l);
  }
  const labos = [...parLab.values()].map(l => ({ nom: l.nom, medicaments: l.marques.size, presentations: l.cips.size }));
  const presentations = labos.reduce((s, l) => s + l.presentations, 0);
  if (!presentations) return null;
  return { labos: labos.map(({ nom, medicaments }) => ({ nom, medicaments })), medicaments: labos.reduce((s, l) => s + l.medicaments, 0), presentations };
}

// ── Textes des chiffres : { meta (ligne sous le titre ; court : petite tuile), meta2 (seconde ligne), lu (lecture) } ──
const VIDE = { meta: "", meta2: "", lu: "" };
export function chiffresTexte(cle, ch, { court = false } = {}) {
  if (cle === "groupees") {
    if (ch?.ouvertes === null || ch?.ouvertes === undefined) return { meta: "Vos opérations ouvertes", meta2: "", lu: "vos opérations ouvertes" };
    const n = Number(ch.ouvertes) || 0;
    if (n <= 0) return VIDE;
    const t = `${entier(n)} ${pluriel(n, "opération ouverte", "opérations ouvertes")}`;
    return { meta: t, meta2: "", lu: t };
  }
  if (!ch || typeof ch !== "object") return VIDE;
  if (cle === "saisie") {
    if (!(ch.references > 0)) return VIDE;
    const r = entier(ch.references), s = entier(ch.en_stock);
    const maj = heureMaj(ch.maj);
    return { meta: `${r} ${court ? "réf." : pluriel(ch.references, "référence", "références")} · ${s} en stock`, meta2: maj ? `Stock mis à jour ${maj}` : "",
      lu: [`${r} ${pluriel(ch.references, "référence", "références")}`, `${s} en stock`, maj ? `stock mis à jour ${maj}` : ""].filter(Boolean).join(", ") };
  }
  if (cle === "peremption") {
    if (!(ch.nb > 0)) return VIDE;
    const n = entier(ch.nb), refs = pluriel(ch.nb, "référence", "références");
    const [m0, m1] = Array.isArray(ch.mois) ? ch.mois : [];
    const meta2 = m0 && m1 && m0 !== m1 ? `Péremptions de ${moisTexte(m0)} à ${moisTexte(m1)}` : m0 ? `Péremption en ${moisTexte(m0)}` : "";
    return { meta: [`${n} ${court ? "réf." : refs}`, ch.des > 0 ? `dès ${eurHT(ch.des)}` : ""].filter(Boolean).join(" · "), meta2,
      lu: [`${n} ${refs}`, ch.des > 0 ? `dès ${eurLu(ch.des)}` : "", ch.jusqua >= 1 ? `jusqu'à −${virgule(ch.jusqua)} %` : ""].filter(Boolean).join(", ") };
  }
  if (cle === "fauteuil" || cle === "transfert") {
    const t = Array.isArray(ch.tailles) ? ch.tailles : [];
    if (!t.length || !(ch.des > 0)) return VIDE;
    const egal = !(ch.a > ch.des);
    const prix = egal ? eurHT(ch.des) : `dès ${eurHT(ch.des)}`, prixLu = egal ? eurLu(ch.des) : `dès ${eurLu(ch.des)}`;
    if (t.length === 1) return { meta: `${court ? "" : "Largeur "}${t[0]} en stock · ${prix}`, meta2: "", lu: `largeur ${t[0]} en stock, ${prixLu}` };
    const etendue = egal && !court ? `, de ${t[0].replace(/\s*cm$/, "")} à ${t.at(-1)}` : "";
    return { meta: `${t.length} largeurs en stock${etendue} · ${prix}`, meta2: "", lu: `${t.length} largeurs en stock${egal ? `, de ${t[0].replace(/\s*cm$/, "")} à ${t.at(-1)}` : ""}, ${prixLu}` };
  }
  if (cle === "justificatif") {
    if (!(ch.presentations > 0)) return VIDE;
    const m = `${entier(ch.medicaments)} ${pluriel(ch.medicaments, "médicament", "médicaments")}`, p = `${entier(ch.presentations)} ${pluriel(ch.presentations, "présentation", "présentations")}`;
    return { meta: `${m} · ${p}`, meta2: "", lu: `${m}, ${p}` };
  }
  return VIDE;
}

// ── Cartes de la composition automatique (Eventail.jsx) ──
// Fauteuils : 3 photos du fabricant (fond blanc, carte texte « Action 2NG » quand aucune ne s'affiche) ; autres outils :
// plaque (carte 0, devant, au centre) puis cartes-chiffres { chiffre, legende, mot } (aucun nom ni photo de produit).
// illisibles : adresses en erreur sur la page (illisibles.js), retirées comme une photo absente.
export function cartesOutil(cle, ch, { illisibles } = {}) {
  const def = OUTILS[cle];
  if (!def) return [];
  if (def.composition === "photos") {
    // 3 photos (de face, puis deux angles) : une 4e ou 5e carte sortait de l'écran de la vitrine (1 440 px) et de la grande
    // tuile ; les photos suivantes du Transit Lite sont des photos d'ambiance (personnes, fond non blanc)
    const photos = (MEDIA[cle]?.photos || []).filter(p => p?.src && !p.thumb).slice(0, 3).filter(p => !illisibles?.has?.(p.src))
      .map(p => ({ url: p.src, nom: modeleCourt(cle), pn: null, ouvert: true }));
    return photos.length ? photos : [{ url: null, nom: modeleCourt(cle), pn: ch?.des > 0 ? ch.des : null, ouvert: true }];
  }
  const cartes = [{ type: "plaque", icone: def.icone, champ: cle === "saisie" }];
  if (cle === "saisie" && ch?.references > 0) cartes.push({ chiffre: entier(ch.references), legende: pluriel(ch.references, "référence", "références") }, { chiffre: entier(ch.en_stock), legende: "en stock" });
  if (cle === "peremption" && ch?.nb > 0) {
    cartes.push({ chiffre: entier(ch.nb), legende: pluriel(ch.nb, "référence", "références") });
    if (ch.des > 0) cartes.push({ chiffre: fmtEur(ch.des), legende: "HT, le plus bas" });
  }
  if (cle === "justificatif" && Array.isArray(ch?.labos)) {
    ch.labos.slice(0, 2).forEach(l => cartes.push({ chiffre: String(l.nom || ""), legende: `${entier(l.medicaments)} ${pluriel(l.medicaments, "médicament", "médicaments")}`, mot: true }));
    if (ch.labos.length > 2) cartes.push({ chiffre: `+${ch.labos.length - 2}`, legende: pluriel(ch.labos.length - 2, "laboratoire", "laboratoires") });
  }
  if (cle === "groupees" && ch?.ouvertes > 0) cartes.push({ chiffre: entier(ch.ouvertes), legende: pluriel(ch.ouvertes, "opération ouverte", "opérations ouvertes") });
  return cartes;
}
