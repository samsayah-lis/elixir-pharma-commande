// ── Admin, onglet ✏️ Modifier : ajouter et retirer des produits d'une section existante ──
// JS pur (aucun React) : partagé par AdminSections.jsx / AdminEdit.jsx, par products-upsert.js (contrôle serveur des
// actions section_*) et testé par scripts/test-admin-sections.mjs.
// Règles :
//  • un CIP = une ligne elixir_products = une section (la clé de la table est le CIP) : un produit déjà dans une autre
//    section n'est jamais dupliqué, il est DÉPLACÉ, sur choix explicite (« Déplacer ici ») ;
//  • retirer = active à false (réversible) : la ligne, sa photo et son historique restent, « Remettre » la rallume, après
//    confirmation, seulement si Odoo a encore un prix de vente (sinon le site afficherait le prix enregistré, figé) ;
//  • ajout d'un CIP absent du site : nom et prix d'Odoo (odoo_catalog : nom fr_FR, prix de vente et liste n° 5), source
//    « admin » ; les prix enregistrés ne servent que de repli, products-get affiche toujours ceux d'Odoo quand il les a ;
//  • règles propres à une section (REGLES_SECTION) : Sélection Stratège vendue au colis (quantité minimale = multiple =
//    colis, colonne « Prix carton »), Sélection Expert qui affiche la remise en euros (30 € par défaut si elle est nulle) ;
//  • chaque changement = un appel products-upsert (jeton admin) qui n'écrit que les colonnes envoyées de CETTE ligne et
//    ajoute une entrée d'historique (action, date, auteur, avant / après) ; jamais d'écriture de la configuration
//    (ec_config : menus promo, affichage) ;
//  • sections exclues : menus promo (produits rangés dans le menu lui-même, onglet 🎯 Promos), campagnes (U-Labs : groupes
//    de gratuité reconnus au nom, quantités engagées par CIP) et outils du site (Péremption courte, fauteuils…) ; tant que
//    les campagnes actives ne sont pas lues (campagnes = null), toute section est exclue.

export const AUTEUR = "admin";
export const ACTIONS = { ajouter: "section_ajout", deplacer: "section_deplacement", remettre: "section_remise", retirer: "section_retrait" };
export const PHOTOS_MAX = 10;   // photos Medipim cherchées après un ajout (clé partagée : 100 appels/min ; ~1 par seconde)
const CODE = /^[\w.-]{1,40}$/;
export const CLE_SECTION = /^[a-z0-9_]{1,60}$/;   // clés des sections (perso : AdminDisplay, [a-z0-9_])

// Outils du site (vues spéciales d'App.jsx, sans liste de produits du catalogue)
export const OUTILS = {
  saisie: "la Saisie de commande", peremption: "la Péremption courte (produits lus dans Odoo)", fauteuil: "l'outil Fauteuil roulant",
  transfert: "l'outil Fauteuil de transfert", justificatif: "la Commande labo sur justificatif", accueil: "la page d'accueil",
  groupees: "les Commandes groupées",
};

// Règles de quantité et d'affichage propres à une section (App.jsx : getStepMin, colonnes des tableaux)
//  • stratege : min = multiple = colis (sans colis : commandable à l'unité) ; colonnes Colis et Prix carton (= colis × prix net)
//  • expert : colonne « Remise € » (une remise nulle s'affiche 30,00 €)
export const REGLES_SECTION = {
  stratege: { colis: "requis", carton: true },
  expert: { remise: "requise" },
};
const regle = (section) => REGLES_SECTION[String(section ?? "")] || {};
export const colisRequis = (section) => regle(section).colis === "requis";

// Nom entre guillemets français, espaces insécables (jamais « ou » seul en bout de ligne)
export const guillemets = (t) => `« ${t} »`;

// Nom affiché d'une section (libellé de l'admin sans son icône de tête)
export function nomSection(key, sections = []) {
  const s = (sections || []).find(x => x.key === key);
  const l = s ? String(s.label || "") : String(key ?? "");
  return l.replace(/^[^\p{L}\p{N}«(]+/u, "").trim() || String(key ?? "");
}

// Section où l'admin n'ajoute ni ne retire de produits ici → { raison, texte } ; null : section ordinaire.
// campagnes : identifiants des campagnes actives (campaign-get) ; U-Labs l'est toujours (campagne de secours du site) ;
// null = pas (encore) lues : rien n'est permis, une campagne active pourrait porter n'importe quelle clé de section.
export function sectionBloquee(key, { campagnes = [], sections = [] } = {}) {
  const k = String(key ?? "");
  if (!k || k === "all") return null;
  const nom = nomSection(k, sections);
  if (campagnes == null) return { raison: "campagnes", texte: "Les campagnes actives n'ont pas pu être lues : ajout et retrait sont suspendus, pour ne pas toucher une section de campagne sans le savoir." };
  if (k.startsWith("promo_")) return { raison: "promo", texte: `${guillemets(nom)} est un menu promo : ses produits sont rangés dans le menu lui-même, pas dans le catalogue des sections. Ajoutez-les ou retirez-les depuis l'onglet 🎯 Promos.` };
  if (k === "ulabs" || campagnes.includes(k)) return { raison: "campagne", texte: `${guillemets(nom)} est une campagne : ses produits ne s'ajoutent ni ne se retirent ici, pour ne pas fausser les gratuités et les quantités déjà engagées. Vous pouvez toujours modifier un produit avec ✏️ Modifier.` };
  if (OUTILS[k]) return { raison: "outil", texte: `${guillemets(nom)} est ${OUTILS[k]} : un outil du site, pas une liste de produits du catalogue.` };
  return null;
}
const genre = (b) => (b.raison === "campagne" ? "section de campagne" : b.raison === "promo" ? "menu promo" : b.raison === "outil" ? "outil du site" : "campagnes non lues");

const arrondi = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
export const entierPositif = (v) => { const s = String(v ?? "").trim(); return /^\d{1,6}$/.test(s) && Number(s) > 0 ? Number(s) : null; };
// Prix d'un produit Odoo (ligne odoo_catalog : list_price, discounted_price = liste n° 5, discount_pct) → { pv, pn, pct,
// remise_eur } comme les enregistre l'onglet ➕ Ajouter ; null sans prix de vente positif
export function prixOdoo(o) {
  const pv = num(o?.list_price), d = num(o?.discounted_price);
  if (!(pv > 0)) return null;
  const pn = d > 0 ? d : pv;
  const pct = num(o?.discount_pct) ?? (pn < pv ? arrondi((pv - pn) / pv * 100) : 0);
  return { pv, pn, pct, remise_eur: arrondi(pv - pn) };
}
// Prix que montrera le site (même règle que products-get) : Odoo quand il a un prix de vente ET un prix liste n° 5,
// sinon le prix enregistré du produit (repli figé) → { pv, pn, remise_eur, source: "odoo" | "enregistre" } ou null
export function prixAffiche(odoo, stocke) {
  const pv = num(odoo?.list_price), pn = num(odoo?.discounted_price);
  if (pv > 0 && pn > 0) return { pv, pn, remise_eur: arrondi(pv - pn), source: "odoo" };
  if (stocke && num(stocke.pn) != null) {
    const spv = num(stocke.pv), spn = num(stocke.pn);
    return { pv: spv, pn: spn, remise_eur: num(stocke.remise_eur) ?? (spv != null ? arrondi(spv - spn) : null), source: "enregistre" };
  }
  return null;
}
// Nom absent ou provisoire dans Odoo (« Nom à préciser : <CIP> », fiche jamais renommée en français)
export const nomProvisoire = (n) => !String(n ?? "").trim() || /^nom\s+à\s+préciser/i.test(String(n).trim());

// Prix incompatible avec la section d'arrivée → raison, sinon null (Sélection Expert : remise en euros affichée)
export function refusPrixSection(section, prix, sections = []) {
  if (regle(section).remise === "requise" && !(num(prix?.remise_eur) > 0))
    return `${guillemets(nomSection(section, sections))} affiche la remise en euros : ce produit n'en a pas (liste n°\u00a05 = prix de vente), le site afficherait 30 € de remise. Mettez la remise dans Odoo d'abord.`;
  return null;
}
// Remise en ligne d'un produit retiré possible ? (odoo : sa ligne odoo_catalog ; nom : nom enregistré, celui du site)
export function refusRemise({ odoo, nom, section, stocke = null, sections = [] }) {
  if (!odoo || !prixOdoo(odoo)) return "Plus dans Odoo (ou sans prix) : remise impossible ici, le site afficherait le prix enregistré, figé";
  if (nomProvisoire(nom)) return "Nom provisoire (« Nom à préciser ») : renommez le produit d'abord (✏️ Modifier)";
  return refusPrixSection(section, prixAffiche(odoo, stocke), sections);
}
// Retiré par cette fonction (« Retirer ») ou désactivé autrement (🗑️ de l'onglet ➕ Ajouter, alignements, scripts) :
// un produit désactivé à la main ne revient qu'avec une confirmation de plus
export const desactiveAlaMain = (derniere) => derniere?.action !== ACTIONS.retirer;

// État d'un CIP sur le site, d'après products-sections?cips= (produits : cip → { active, section, name, pv, pn,
// remise_eur, colis, carton, derniere })
export function etatCip(cip, section, produits = {}) {
  const p = produits?.[cip];
  if (!p) return { type: "nouveau" };
  const stocke = { pv: num(p.pv), pn: num(p.pn), remise_eur: num(p.remise_eur), colis: num(p.colis), carton: num(p.carton) };
  const base = { section: p.section ?? null, name: p.name ?? null, stocke, derniere: p.derniere ?? null };
  if (p.active === false) return { type: "retire", ...base };
  if (p.section === section) return { type: "ici", ...base };
  return { type: "ailleurs", ...base };
}

// Ce que l'admin peut faire d'un résultat de recherche (ligne odoo_catalog) dans cette section → { type: "ajouter" |
// "deplacer" | "remettre" } ou { type: null, raison } (affichée telle quelle)
export function verdictAjout({ ligne, etat, section, campagnes = [], sections = [] }) {
  const cip = String(ligne?.cip ?? "");
  if (!CODE.test(cip)) return { type: null, raison: "Code produit inutilisable" };
  if (!etat) return { type: null, raison: "État sur le site inconnu : relancez la recherche" };
  if (etat.type === "ici") return { type: null, raison: "Déjà dans cette section" };
  const origine = (verbe) => {
    if (!etat.section || etat.section === section) return null;
    const b = sectionBloquee(etat.section, { campagnes, sections });
    return b ? `${verbe} ${guillemets(nomSection(etat.section, sections))} (${genre(b)}) : ${etat.type === "retire" ? "remise ailleurs" : "déplacement"} désactivé${etat.type === "retire" ? "e" : ""} ici` : null;
  };
  if (etat.type === "ailleurs") {
    const r = origine("Dans") || refusPrixSection(section, prixAffiche(ligne, etat.stocke), sections);
    return r ? { type: null, raison: r } : { type: "deplacer" };
  }
  if (etat.type === "retire") {
    const r = origine("Retiré de") || refusRemise({ odoo: ligne, nom: etat.name, section, stocke: etat.stocke, sections });
    return r ? { type: null, raison: r } : { type: "remettre" };
  }
  if (nomProvisoire(ligne.name)) return { type: null, raison: "Nom provisoire dans Odoo (« Nom à préciser ») : renommez la fiche dans Odoo d'abord" };
  const prix = prixOdoo(ligne);
  if (!prix) return { type: null, raison: "Pas de prix de vente dans Odoo : ajout impossible depuis ici" };
  const r = refusPrixSection(section, prix, sections);
  return r ? { type: null, raison: r } : { type: "ajouter" };
}

// Opération → { type, cip, nom, section, depuis, prix, incomplet, desactive, corps } ; corps = corps de products-upsert
// ({ product, action, author }). Seules les colonnes qui changent sont envoyées (products-upsert n'écrit que celles-là) ;
// _changes = avant / après, rangé tel quel dans l'historique du produit.
//  ligne : résultat de recherche (odoo_catalog) ; etat : etatCip ; produit : ligne de la liste des retirés (products-sections,
//  avec odoo) ou carte de l'onglet ; colis : saisi dans la confirmation (Stratège) ; annulation : « Annuler » d'un retrait
//  (remise telle qu'avant, sans autre changement).
export function operation(type, { cip, section, ligne = null, etat = null, produit = null, auteur = AUTEUR, colis = undefined, annulation = false }) {
  const c = String(cip);
  let product, depuis = null, nom = (type === "ajouter" ? null : (etat?.name ?? produit?.name)) ?? ligne?.name ?? c;
  const stocke = etat?.stocke ?? (produit ? { pv: num(produit.pv), pn: num(produit.pn), remise_eur: num(produit.remise_eur), colis: num(produit.colis), carton: num(produit.carton) } : null);
  const odoo = ligne ?? produit?.odoo ?? null;
  let prix = null, incomplet = null;
  if (type === "ajouter") {
    const p = prixOdoo(ligne);
    nom = String(ligne.name).trim();
    prix = { ...p, source: "odoo" };
    product = { cip: c, name: nom, section, pv: p.pv, pn: p.pn, pct: p.pct, remise_eur: p.remise_eur, source: "admin", active: true,
      _changes: { section: { avant: null, apres: section }, active: { avant: null, apres: true }, origine: "odoo_catalog", prix: { pv: p.pv, pn: p.pn } } };
  } else if (type === "deplacer") {
    depuis = etat.section;
    prix = prixAffiche(odoo, stocke);
    product = { cip: c, section, _changes: { section: { avant: depuis, apres: section } } };
  } else if (type === "remettre") {
    depuis = etat?.section ?? produit?.section ?? section;
    prix = prixAffiche(odoo, stocke);
    const change = depuis !== section;
    product = { cip: c, active: true, ...(change ? { section } : {}),
      _changes: { active: { avant: false, apres: true }, ...(change ? { section: { avant: depuis, apres: section } } : { section }), ...(annulation ? { annulation: true } : {}) } };
  } else if (type === "retirer") {
    product = { cip: c, active: false, _changes: { active: { avant: true, apres: false }, section } };
  } else throw new Error(`opération inconnue : ${type}`);
  // Stratège (vendue au colis) : quantité minimale obligatoire, prix carton recalculé (colis × prix net affiché)
  if (type !== "retirer" && !annulation && colisRequis(section)) {
    const q = entierPositif(colis === undefined ? stocke?.colis : colis);
    if (!q) incomplet = "colis";
    else {
      const carton = num(prix?.pn) != null ? arrondi(q * prix.pn) : null;
      product.colis = q;
      product.carton = carton;
      product._changes.colis = { avant: stocke?.colis ?? null, apres: q };
      product._changes.carton = { avant: stocke?.carton ?? null, apres: carton };
    }
  }
  const desactive = type === "remettre" && !annulation && desactiveAlaMain(etat?.derniere ?? produit?.retrait ?? produit?.derniere);
  return { type, cip: c, nom, section, depuis, prix, incomplet, desactive, corps: { product, action: ACTIONS[type], author: auteur } };
}

// Plan encore valable juste avant l'écriture ? (relu par products-sections?cips= : un autre poste a pu changer un produit
// entre-temps) → { valides, perimes: [{ op, raison }] }
export function verifierPlan(ops, produits = {}, sections = []) {
  const valides = [], perimes = [];
  for (const op of ops) {
    const p = produits?.[op.cip];
    const dans = (k) => guillemets(nomSection(k, sections));
    const raison = op.incomplet ? "quantité minimale (colis) manquante"
      : op.type === "ajouter" ? (p ? `est désormais sur le site${p.active === false ? " (retiré)" : ` (${dans(p.section)})`}` : null)
      : op.type === "deplacer" ? (!p ? "n'est plus sur le site" : p.active === false ? "a été retiré entre-temps" : p.section !== op.depuis ? (p.section === op.section ? "est déjà dans cette section" : `est passé dans ${dans(p.section)}`) : null)
      : op.type === "remettre" ? (!p ? "n'est plus sur le site" : p.active !== false ? "a déjà été remis" : p.section !== op.depuis ? `est passé dans ${dans(p.section)} entre-temps` : null)
      : op.type === "retirer" ? (!p ? "n'est plus sur le site" : p.active === false ? "est déjà retiré" : p.section !== op.section ? `est passé dans ${dans(p.section)}` : null)
      : "opération inconnue";
    if (raison) perimes.push({ op, raison }); else valides.push(op);
  }
  return { valides, perimes };
}

// Contrôle SERVEUR d'une action section_* (products-upsert, jeton admin déjà vérifié) : mêmes garde-fous que l'admin,
// pour une page restée ouverte (campagne activée depuis) ou un appel direct.
//  actuelle : ligne elixir_products du CIP ({ section, active }) ou null ; campagnes : identifiants des campagnes actives.
// → null (permis) ou { statut, error }
export function refusActionSection({ action, product, actuelle, campagnes = [] }) {
  const type = Object.keys(ACTIONS).find(k => ACTIONS[k] === action);
  if (!type) return { statut: 400, error: `action inconnue : ${action}` };
  if (product.old_cip !== undefined) return { statut: 400, error: "changement de CIP : passez par ✏️ Modifier" };
  const bloque = (k) => sectionBloquee(k, { campagnes });
  const cible = product.section !== undefined ? product.section : actuelle?.section;
  if (type !== "retirer") {
    // clé écrite (ajout, déplacement, remise ailleurs) : format des clés de section ; clé déjà en place : telle quelle
    if (typeof cible !== "string" || (product.section !== undefined && !CLE_SECTION.test(cible))) return { statut: 400, error: `section invalide : ${String(cible).slice(0, 80)}` };
    const b = bloque(cible);
    if (b) return { statut: 400, error: `Section « ${cible} » exclue (${genre(b)}) : rien n'a été modifié` };
  }
  if (type === "ajouter") {
    if (actuelle) return { statut: 409, error: `Le CIP ${product.cip} est déjà sur le site (section « ${actuelle.section} »${actuelle.active === false ? ", retiré" : ""}) : rien n'a été modifié` };
    if (product.active !== true) return { statut: 400, error: "ajout : active doit valoir true" };
  } else {
    if (!actuelle) return { statut: 404, error: `produit ${product.cip} introuvable` };
    if (type === "deplacer" && actuelle.active === false) return { statut: 409, error: "produit retiré : utilisez « Remettre »" };
    if (type === "remettre" && actuelle.active !== false) return { statut: 409, error: "produit déjà en ligne" };
    if (type === "remettre" && product.active !== true) return { statut: 400, error: "remise : active doit valoir true" };
    if (type === "retirer" && (product.active !== false || product.section !== undefined)) return { statut: 400, error: "retrait : seul active=false est permis" };
    const b = (type === "retirer" || actuelle.section !== cible) && bloque(actuelle.section);
    if (b) return { statut: 400, error: `Section d'origine « ${actuelle.section} » exclue (${genre(b)}) : rien n'a été modifié` };
  }
  // Stratège : un produit qui y arrive (ajout, déplacement, remise depuis une autre section) a un colis
  if (type !== "retirer" && colisRequis(cible) && (type === "ajouter" || actuelle?.section !== cible) && !entierPositif(product.colis))
    return { statut: 400, error: `Section « ${cible} » vendue au colis : colis (quantité minimale) requis` };
  return null;
}

// Écrit les opérations une par une (products-upsert, jeton admin) → { faits, echecs: [{ op, erreur }], nonTraites }.
// Un jeton refusé (401/403) arrête tout : le reste n'est pas tenté.
export async function appliquer(ops, { adminFetch, surProgres = () => {} }) {
  const faits = [], echecs = [];
  let i = 0;
  for (; i < ops.length; i++) {
    const op = ops[i];
    surProgres(i, ops.length, op);
    let r, j = {};
    try {
      r = await adminFetch("/.netlify/functions/products-upsert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.corps) });
      j = await r.json().catch(() => ({}));
    } catch (e) { echecs.push({ op, erreur: `réseau : ${e.message}` }); continue; }
    if (r.status === 401 || r.status === 403) { echecs.push({ op, erreur: "session admin expirée : reconnectez-vous" }); i++; break; }
    if (r.ok && j.success) faits.push(op);
    else echecs.push({ op, erreur: j.error || `erreur ${r.status}` });
  }
  surProgres(ops.length, ops.length, null);
  return { faits, echecs, nonTraites: ops.slice(i) };
}

// Photos Medipim des produits ajoutés (comme « 🔄 Importer photos Medipim… » de l'onglet) : un produit à la fois, ~1 par
// seconde, PHOTOS_MAX au plus ; saturation (429) ou panne : arrêt, le reste se fait plus tard avec le bouton de l'onglet
export async function photosMedipim(cips, { adminFetch, pause = (ms) => new Promise(r => setTimeout(r, ms)), max = PHOTOS_MAX }) {
  const bilan = { trouvees: 0, introuvables: 0, nonTraitees: Math.max(0, cips.length - max), arret: null };
  const liste = cips.slice(0, max);
  for (let i = 0; i < liste.length; i++) {
    const cip = liste[i];
    try {
      const r = await adminFetch(`/.netlify/functions/medipim-lookup?cip=${encodeURIComponent(cip)}`);
      if (r.status === 429 || r.status >= 500) { bilan.arret = r.status === 429 ? "base photos saturée" : "base photos indisponible"; bilan.nonTraitees += liste.length - i; break; }
      const d = r.ok ? await r.json().catch(() => ({})) : {};
      if (d.image_url) {
        const up = await adminFetch("/.netlify/functions/product-upload-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cip, image_url: d.image_url }) });
        const uj = await up.json().catch(() => ({}));
        if (uj.success) bilan.trouvees++; else bilan.introuvables++;
      } else bilan.introuvables++;
    } catch { bilan.introuvables++; }
    if (i < liste.length - 1) await pause(1000);
  }
  return bilan;
}

// ── Recherche dans le catalogue Odoo (odoo-catalog, inchangé : il cherche la requête entière comme UNE sous-chaîne du
// nom, accents et ordre des mots compris) ──
// Plusieurs mots ou un accent : le mot le plus long est cherché tel quel et sans accents (200 résultats chacun), puis
// seules les lignes dont le nom contient TOUS les mots (minuscules, sans accents) restent, en stock d'abord.
export const normaliser = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export function planRecherche(q) {
  const t = String(q ?? "").trim();
  const mots = t.split(/\s+/).filter(Boolean);
  if (/^\d+$/.test(t) || (mots.length <= 1 && normaliser(t) === t.toLowerCase())) return { simple: true, requetes: t ? [t] : [], mots: mots.map(normaliser) };
  const long = mots.reduce((a, b) => (b.length > a.length ? b : a), "");
  return { simple: false, requetes: [...new Set([long, long.normalize("NFD").replace(/\p{M}/gu, "")])], mots: mots.map(normaliser) };
}
// lire(adresse) → tableau de produits odoo-catalog (lève en cas d'erreur) → { lignes, plusieursMots }
export async function rechercheOdoo(q, { lire, stockSeul = false, limite = 30 }) {
  const plan = planRecherche(q);
  const lots = await Promise.all(plan.requetes.map(r => lire(`/.netlify/functions/odoo-catalog?q=${encodeURIComponent(r)}&limit=${plan.simple ? limite : 200}${stockSeul ? "&stock_only=1" : ""}`)));
  const parCip = new Map();   // un CIP une fois (codes-barres en double dans Odoo, deux requêtes)
  for (const lot of lots) for (const p of Array.isArray(lot) ? lot : []) if (p && p.cip && !parCip.has(p.cip)) parCip.set(p.cip, p);
  let lignes = [...parCip.values()];
  if (!plan.simple) {
    lignes = lignes.filter(p => { const n = normaliser(p.name); return plan.mots.every(m => n.includes(m)); })
      .sort((a, b) => (b.in_stock === true) - (a.in_stock === true) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr"));
  }
  return { lignes: lignes.slice(0, limite), plusieursMots: plan.mots.length > 1 };
}

// ── Textes ──
export const euros = (n) => (n == null || isNaN(Number(n)) ? "—" : Number(n).toFixed(2).replace(".", ",") + " €");
export const pluriel = (n, un, plusieurs = un + "s") => `${n} ${n > 1 ? plusieurs : un}`;
export function dateCourte(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
// Avertissement panier : toutes les sections que les opérations changent (d'arrivée et d'origine)
export function sectionsTouchees(ops) {
  const s = [];
  for (const o of ops) for (const k of [o.section, o.type === "deplacer" || o.type === "remettre" ? o.depuis : null]) if (k && !s.includes(k)) s.push(k);
  return s;
}
export function panierTexte(cles, sections = []) {
  const noms = cles.map(k => guillemets(nomSection(k, sections)));
  const de = noms.length ? noms.map(n => `de ${n}`).join(" ou ") : "de cette section";
  return `Une pharmacie qui avait déjà des produits ${de} dans son panier le retrouvera vidé à ce moment-là : c'est la protection habituelle du site quand une section change.`;
}
const VERBE = { ajouter: "ajouté à", deplacer: "déplacé dans", remettre: "remis dans", retirer: "retiré de" };
// Bilan d'une série d'opérations, en une phrase : une opération → produit et section nommés ; sinon regroupé par section
export function bilanTexte({ faits = [], echecs = [], nonTraites = [], perimes = [] }, section, sections = []) {
  const pb = echecs.length + nonTraites.length + perimes.length;
  const tete = pb ? "⚠ " : "✅ ";
  const suite = pb ? ` · ${pluriel(pb, "non fait")}` : "";
  if (faits.length === 1 && !pb) {
    const o = faits[0];
    return `✅ ${guillemets(o.nom)} ${VERBE[o.type]} ${guillemets(nomSection(o.section, sections))}`;
  }
  const parSection = new Map();
  for (const o of faits) { if (!parSection.has(o.section)) parSection.set(o.section, []); parSection.get(o.section).push(o); }
  const groupes = [...parSection.entries()].map(([k, ops]) => {
    const n = (t) => ops.filter(o => o.type === t).length;
    const m = [
      n("ajouter") && pluriel(n("ajouter"), "ajouté"),
      n("deplacer") && `${pluriel(n("deplacer"), "déplacé")} ici`,
      n("remettre") && pluriel(n("remettre"), "remis", "remis"),
      n("retirer") && pluriel(n("retirer"), "retiré"),
    ].filter(Boolean).join(", ");
    return `${guillemets(nomSection(k, sections))} : ${m}`;
  });
  if (!groupes.length) return `${tete}${section && section !== "all" ? guillemets(nomSection(section, sections)) : "Sections"} : aucun changement${suite}`;
  return `${tete}${groupes.join(" · ")}${suite}`;
}
