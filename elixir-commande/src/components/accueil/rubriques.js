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
// Typographie : un nombre ne quitte jamais son unité (« 17 présentations », « dès 0,44 € HT ») : espace insécable ; les
// segments d'une méta (« · ») passent à la ligne entiers (SegmentsMeta d'outils.js, dans Cinema.jsx et Bento.jsx)
const FINE = "\u202f", NBSP = "\u00a0";
const avecUnite = (n, unite) => `${entier(n)}${NBSP}${unite}`;
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
// du justificatif est remplacé par la sarcelle dans vedettes.js), textes par défaut, bouton de la vitrine (cta, et
// ctaCourt quand il ne tient pas sur une ligne), pied de tuile (ctaCourt ; ctaMini : petite tuile sur téléphone, contenu
// dans ctaCourt pour le nom accessible), composition automatique, chiffres exigés (sans eux, la carte reste cachée).
// Titres : espaces insécables (« à la », « Transit Lite ») contre les mots seuls en fin de ligne ──
export const OUTILS = {
  saisie: {
    libelle: "Saisie de commande", icone: "crayon", accent: "#2d9cbc", composition: "plaque", chiffresRequis: false,
    titre: "Commandez par CIP, EAN ou nom",
    accroche: () => "Tout le catalogue Elixir dans un seul champ : quelques lettres du nom, le CIP ou le code EAN, et la boîte part au panier.",
    badge: "Tout le catalogue", cta: () => "Ouvrir la Saisie de commande", ctaCourt: "Ouvrir la Saisie", ctaMini: "Ouvrir",
    sansPhoto: "plaque de l'outil et chiffres du catalogue",
  },
  // lot 0 de « Odoo facture la remise » (20/10/2026, docs/peremption.md) : aucune remise péremption n'est facturée, la page
  // affiche le prix habituel ; ni « petits prix » ni remise annoncés (le serveur ne donne ni « dès » ni « jusqu'à »)
  peremption: {
    libelle: "Péremption courte", icone: "horloge", accent: "#ea580c", composition: "plaque", chiffresRequis: true,
    titre: `Lots à date courte, en${NBSP}stock`,
    accroche: () => `Produits en stock à péremption entre J+30 et 4${NBSP}mois, à leur prix habituel, avec la date de chaque lot.`,
    badge: "Date courte", cta: (ch) => (ch?.nb === 1 ? "Voir le produit" : ch?.nb > 1 ? `Voir les ${ch.nb} produits` : "Voir les produits"), ctaCourt: "Voir les produits", ctaMini: "Voir",
    sansPhoto: "plaque de l'outil et chiffres du moment",
  },
  fauteuil: {
    libelle: "Fauteuil roulant", icone: "fauteuil", accent: "#3b82f6", composition: "photos", chiffresRequis: true,
    titre: `Le bon fauteuil, à${NBSP}la bonne${NBSP}largeur`,
    accroche: () => `${modeleLong("fauteuil")} : la largeur d'assise se déduit d'une mesure ou du poids, puis le bon modèle s'affiche avec son prix.`,
    badge: "Aide au choix", cta: () => "Choisir la largeur", ctaCourt: "Choisir la largeur", ctaMini: "Choisir",
    sansPhoto: "éventail des photos du fabricant",
  },
  transfert: {
    libelle: "Fauteuil de transfert", icone: "chaise", accent: "#3b82f6", composition: "photos", chiffresRequis: true,
    titre: `Fauteuil de transfert ${modeleCourt("transfert").replace(/ /g, NBSP)}`,
    accroche: () => `${modeleLong("transfert")}, en ${taillesLINES("transfert")} : la largeur d'assise se déduit d'une mesure ou du poids.`,
    badge: "Aide au choix", cta: () => "Choisir la largeur", ctaCourt: "Choisir la largeur", ctaMini: "Choisir",
    sansPhoto: "éventail des photos du fabricant",
  },
  justificatif: {
    libelle: "Commande labo sur justificatif", icone: "document", accent: "#7c3aed", composition: "plaque", chiffresRequis: true,
    titre: "Commande labo sur justificatif",
    accroche: accrocheJustif,
    badge: "Suivi pas à pas", cta: () => "Commander sur justificatif", ctaCourt: "Commander", ctaMini: "Commander",
    sansPhoto: "plaque de l'outil et laboratoires du moment",
  },
  groupees: {
    libelle: "Commandes groupées", icone: "groupe", accent: "#2d9cbc", composition: "plaque", chiffresRequis: false,
    titre: "Vos commandes groupées",
    accroche: () => "Achats groupés et précommandes aux conditions négociées : saisissez vos quantités avant la clôture.",
    badge: "Conditions négociées", cta: () => "Voir les opérations", ctaCourt: "Voir les opérations", ctaMini: "Voir",
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

// ── Textes des chiffres : { meta (ligne sous le titre ; court : petite tuile), meta2 (seconde ligne, vitrine), lu (lecture) } ──
// Saisie : « réf. en stock » (un nombre de références, jamais une quantité en stock) ; fauteuils : l'étendue des largeurs
// en seconde ligne (la méta reste courte : « 4 largeurs en stock · 210,08 € HT »)
const VIDE = { meta: "", meta2: "", lu: "" };
export function chiffresTexte(cle, ch, { court = false } = {}) {
  if (cle === "groupees") {
    if (ch?.ouvertes === null || ch?.ouvertes === undefined) return { meta: "Vos opérations ouvertes", meta2: "", lu: "vos opérations ouvertes" };
    const n = Number(ch.ouvertes) || 0;
    if (n <= 0) return VIDE;
    const t = avecUnite(n, pluriel(n, "opération ouverte", "opérations ouvertes"));
    return { meta: t, meta2: "", lu: t };
  }
  if (!ch || typeof ch !== "object") return VIDE;
  if (cle === "saisie") {
    if (!(ch.references > 0)) return VIDE;
    const maj = heureMaj(ch.maj);
    return { meta: `${avecUnite(ch.references, court ? "réf." : pluriel(ch.references, "référence", "références"))} · ${avecUnite(ch.en_stock, `réf.${NBSP}en${NBSP}stock`)}`,
      meta2: maj ? `Stock mis à jour ${maj}` : "",
      lu: [avecUnite(ch.references, pluriel(ch.references, "référence", "références")), `${avecUnite(ch.en_stock, pluriel(ch.en_stock, "référence", "références"))} en stock`,
        maj ? `stock mis à jour ${maj}` : ""].filter(Boolean).join(", ") };
  }
  if (cle === "peremption") {
    if (!(ch.nb > 0)) return VIDE;
    const refs = pluriel(ch.nb, "référence", "références");
    const [m0, m1] = Array.isArray(ch.mois) ? ch.mois : [];
    const meta2 = m0 && m1 && m0 !== m1 ? `Péremptions de ${moisTexte(m0)} à ${moisTexte(m1)}` : m0 ? `Péremption en ${moisTexte(m0)}` : "";
    return { meta: [avecUnite(ch.nb, court ? "réf." : refs), ch.des > 0 ? `dès${NBSP}${eurHT(ch.des)}` : ""].filter(Boolean).join(" · "), meta2,
      lu: [avecUnite(ch.nb, refs), ch.des > 0 ? `dès ${eurLu(ch.des)}` : "", ch.jusqua >= 1 ? `jusqu'à −${virgule(ch.jusqua)} %` : ""].filter(Boolean).join(", ") };
  }
  if (cle === "fauteuil" || cle === "transfert") {
    const t = Array.isArray(ch.tailles) ? ch.tailles : [];
    if (!t.length || !(ch.des > 0)) return VIDE;
    const egal = !(ch.a > ch.des);
    const ins = (x) => String(x).replace(/ /g, NBSP);   // « 45,5 cm » insécable
    const prix = egal ? eurHT(ch.des) : `dès${NBSP}${eurHT(ch.des)}`, prixLu = egal ? eurLu(ch.des) : `dès ${eurLu(ch.des)}`;
    if (t.length === 1) return { meta: `${court ? "" : "Largeur "}${ins(t[0])} en stock · ${prix}`, meta2: "", lu: `largeur ${t[0]} en stock, ${prixLu}` };
    const sansCm = (x) => String(x).replace(/\s*cm$/, "");
    const etendue = t.length >= 3 ? `de ${sansCm(t[0])} à ${ins(t.at(-1))}` : `${t.slice(0, -1).map(sansCm).join(", ")} et ${ins(t.at(-1))}`;
    return { meta: `${avecUnite(t.length, "largeurs")} en stock · ${prix}`, meta2: `Largeurs d'assise : ${etendue}`,
      lu: `${t.length} largeurs en stock, ${t.length >= 3 ? `de ${sansCm(t[0])} à ${t.at(-1)}` : `${t.slice(0, -1).map(sansCm).join(", ")} et ${t.at(-1)}`}, ${prixLu}` };
  }
  if (cle === "justificatif") {
    if (!(ch.presentations > 0)) return VIDE;
    const m = avecUnite(ch.medicaments, pluriel(ch.medicaments, "médicament", "médicaments")), p = avecUnite(ch.presentations, pluriel(ch.presentations, "présentation", "présentations"));
    return { meta: `${m} · ${p}`, meta2: "", lu: `${m}, ${p}` };
  }
  return VIDE;
}

// ── Cartes de la composition automatique (Eventail.jsx) ──
// Fauteuils : 3 photos du fabricant (fond blanc) ; aucune ne s'affiche (jeton du fabricant changé…) : la composition des
// autres outils, plaque et chiffres (largeurs en stock, prix), plutôt qu'une carte blanche presque vide. Autres outils :
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
    if (photos.length) return photos;
    const t = Array.isArray(ch?.tailles) ? ch.tailles : [];
    return [{ type: "plaque", icone: def.icone },
      ...(t.length ? [{ chiffre: String(t.length), legende: pluriel(t.length, "largeur en stock", "largeurs en stock") }] : []),
      ...(ch?.des > 0 ? [{ chiffre: fmtEur(ch.des), legende: ch.a > ch.des ? "HT, le plus bas" : "HT", ...(fmtEur(ch.des).length > 6 ? { mot: true } : {}) }] : [])];
  }
  const cartes = [{ type: "plaque", icone: def.icone, champ: cle === "saisie" }];
  // chiffre long (« 175,70 € ») : en plus petit, comme un nom de laboratoire (sinon son début passe sous la plaque)
  if (cle === "saisie" && ch?.references > 0) cartes.push({ chiffre: entier(ch.references), legende: pluriel(ch.references, "référence", "références") }, { chiffre: entier(ch.en_stock), legende: "réf. en stock" });
  if (cle === "peremption" && ch?.nb > 0) {
    cartes.push({ chiffre: entier(ch.nb), legende: pluriel(ch.nb, "référence", "références") });
    if (ch.des > 0) cartes.push({ chiffre: fmtEur(ch.des), legende: "HT, le plus bas" });
  }
  if (cle === "justificatif" && Array.isArray(ch?.labos)) {
    ch.labos.slice(0, 2).forEach(l => cartes.push({ chiffre: String(l.nom || ""), legende: `${entier(l.medicaments)} ${pluriel(l.medicaments, "médicament", "médicaments")}`, mot: true }));
    if (ch.labos.length > 2) cartes.push({ chiffre: `+${ch.labos.length - 2}`, legende: pluriel(ch.labos.length - 2, "laboratoire", "laboratoires") });
  }
  if (cle === "groupees" && ch?.ouvertes > 0) cartes.push({ chiffre: entier(ch.ouvertes), legende: pluriel(ch.ouvertes, "opération ouverte", "opérations ouvertes") });
  return cartes.map(c => (c.chiffre != null && !c.mot && String(c.chiffre).length > 6 ? { ...c, mot: true } : c));
}
