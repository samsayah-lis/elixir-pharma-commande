// ── Accueil « La Tête de gondole » : règle de sélection des offres (docs/accueil.md) ──
// Produits qui font l'objet du plus grand nombre de commandes SERVIES sur les 15 derniers jours (société Elixir),
// vendables sur le site. Règle partagée par accueil-offres-refresh.js (classement planifié) et accueil-offres.js (GET
// des pharmacies). JS pur, sans réseau : les lectures Odoo et Supabase sont faites par _accueil-donnees.js.
//
// Format interne (cache kv « accueil:offres ») : diapositives avec tous leurs membres (dosages) et les comptes exacts
// (_cmd, _rythme) ; ces champs « _ » ne quittent jamais le serveur (publique() les retire). Le GET relit prix et
// stock au moment de l'appel (offreDynamique) : la vitrine ne contredit jamais un menu ni le panier.

export const VERSION = 1;
export const NB_SLIDES = 12;
export const NB_RESERVES = 8;
export const SEUILS = { commandes: 10, pharmacies: 5 };
export const PERIME_MS = 36 * 3600e3;          // cache de plus de 36 h : périmé (vitrine masquée)
export const TOP_ODOO = 150;                   // produits lus dans le classement Odoo

// Ordre des catalogues d'App.jsx (SECTION_META, puis menus promo) : addItemToCart et regleSaisie rangent un CIP dans
// le PREMIER menu qui le contient, même masqué
export const ORDRE_MENUS = ["expert", "stratege", "master", "obeso", "nr", "molnlycke", "blanche", "covid", "otc", "ulabs"];
export const LIBELLES_MENUS = {
  expert: "Sélection Expert", stratege: "Sélection Stratège", master: "Sélection Master", obeso: "Mounjaro / Wegovy",
  nr: "Autres NR", molnlycke: "Offre Mölnlycke", blanche: "Gamme Blanche", covid: "Diagnostic & Covid",
  otc: "Centrale OTC / Para", ulabs: "Commande groupée U-Labs", saisie: "Saisie de commande",
};

// ── Dates (heure de Paris) ──
export const jourParis = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const ajouteJours = (jour, n) => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// écart (ms) entre l'heure de Paris et UTC à l'instant t
const decalageParis = (t) => {
  const s = Math.floor(t / 1000) * 1000;
  return Date.parse(new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace(" ", "T") + "Z") - s;
};
// minuit (heure de Paris) du jour AAAA-MM-JJ, en ms UTC
export function minuitParis(jour) {
  const base = Date.parse(`${jour}T00:00:00Z`);
  return base - decalageParis(base - decalageParis(base));
}
// Fenêtre de 15 jours calendaires, aujourd'hui compris (le dernier jour est en cours) ; période précédente de MÊME durée
// exacte (J−14 00:00 → maintenant, puis la même durée juste avant) : la tendance ne compare plus 14,3 jours à 15 jours
// pleins (biais de −4,8 % au passage de 6 h 40, face au seuil « En hausse » de 15 %)
export function fenetre(maintenant = Date.now()) {
  const aujourdhui = jourParis(maintenant);
  const jours = Array.from({ length: 15 }, (_, i) => ajouteJours(aujourdhui, i - 14));
  const depuis = minuitParis(jours[0]);
  return { aujourdhui, jours, depuis, avant: depuis - Math.max(0, maintenant - depuis) };
}
export const dateOdoo = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");   // date_order Odoo (UTC)
export const depuisOdoo = (s) => Date.parse(String(s).replace(" ", "T") + "Z");

// ── Textes ──
const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const MOTS_DOUBLES = new Set(["ACIDE", "CHLORURE", "SULFATE", "PROPIONATE", "CHLORHYDRATE", "KIT", "VACCIN", "SERINGUE", "AIGUILLES", "SOLUTION", "SERUM"]);
const mots = (nom) => String(nom ?? "").trim().split(/\s+/).filter(Boolean);
const doubleMot = (premier) => MOTS_DOUBLES.has(sansAccents(premier).toUpperCase().replace(/[^A-Z]/g, ""));
// Clé de famille (un produit par marque) : premier mot du nom (deux pour ACIDE, CHLORURE…) + laboratoire Odoo
export function cleFamille(nom, laboId) {
  const w = sansAccents(nom).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const k = MOTS_DOUBLES.has(w[0]) ? w.slice(0, 2).join(" ") : (w[0] || "");
  return `${k}|${laboId || 0}`;
}
// Marque affichée (« MOUNJARO », « ACIDE ACÉTYLSALICYLIQUE ») : premier mot du nom, accents gardés
export function marque(nom) {
  const w = mots(nom).map(x => x.replace(/[(),;]+$/g, ""));
  return (doubleMot(w[0]) ? w.slice(0, 2) : w.slice(0, 1)).join(" ").toUpperCase();
}
// Nom court : nom curaté (court) sinon nom Odoo sans parenthèses ni ce qui suit la première virgule
export function nomCourt(nomCure, nomOdoo) {
  if (nomCure && String(nomCure).length <= 60) return String(nomCure).trim();
  return String(nomOdoo ?? nomCure ?? "").replace(/\s*\([^)]*\)/g, "").split(", ")[0].replace(/\s+/g, " ").trim();
}
// Popularité en tranches, jamais de compte exact
export const tranche = (n) => n >= 200 ? "Plus de 200 pharmacies" : n >= 100 ? "Plus de 100 pharmacies" : n >= 50 ? "Plus de 50 pharmacies"
  : n >= 20 ? "Plus de 20 pharmacies" : n >= 10 ? "Plus de 10 pharmacies" : "Plus de 5 pharmacies";

// Laboratoire, nom court (« Eli Lilly and Company » → « Lilly », « IBSA PHARMA SAS » → « IBSA », « SIFI France » → « SIFI »)
const ALIAS_LABOS = { "ELI LILLY": "Lilly", "GLAXOSMITHKLINE": "GSK", "LABORATOIRES THEA": "Théa", "THEA": "Théa" };
const MOTS_LABO = /\b(sas|sasu|sa|sarl|s\.a\.s\.?|s\.a\.?|gmbh|ltd|limited|inc|llc|plc|bv|nv|ag|spa|and company|& co|company|france|pharma|pharmaceuticals?|pharmaceutique|laboratoires?|labo|lab|industries?|industrie|healthcare|sante|santé|groupe|winthrop|holding|international)\b\.?/gi;
export function laboCourt(nom) {
  const brut = String(nom ?? "").replace(/\s+/g, " ").trim();
  if (!brut) return null;
  const alias = ALIAS_LABOS[sansAccents(brut).toUpperCase()] || ALIAS_LABOS[sansAccents(brut).toUpperCase().replace(MOTS_LABO, "").replace(/\s+/g, " ").trim()];
  if (alias) return alias;
  let n = brut.replace(MOTS_LABO, "").replace(/[,.]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^eli lilly/i.test(n)) return "Lilly";
  if (!n) n = brut;
  // tout en capitales : mots de plus de 4 lettres en casse de titre (sigles gardés : GSK, IBSA, SIFI)
  if (n === n.toUpperCase()) n = n.split(" ").map(w => w.length > 4 ? w.charAt(0) + w.slice(1).toLowerCase() : w).join(" ");
  return n.length > 22 ? n.slice(0, 22).trim() : n;
}

// Dosage lisible (« 5 mg », « 114,3 mg/ml », « 100 µg/dose », « 500 mg/25 mg », « 10 000 UI ») ou null
const UNITES = { mg: "mg", g: "g", ml: "ml", "µg": "µg", "μg": "µg", mcg: "µg", microgramme: "µg", microgrammes: "µg", ui: "UI", u: "UI", "%": "%" };
const nombre = (s) => {
  const v = String(s).replace(",", ".");
  const [ent, dec] = v.split(".");
  const e = ent.length > 4 ? ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : ent;
  return dec ? `${e},${dec}` : e;
};
const RE_DOSE = /(\d+(?:[.,]\d+)?)\s*(microgrammes?|mcg|µg|μg|mg|ml|ui|u|g|%)(?![a-z])(?:\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*(mg|µg|μg|mcg|g|ml)|(ml|dose|g)))?/i;
export function dosage(...noms) {
  for (const nom of noms) {
    const m = String(nom ?? "").match(RE_DOSE);
    if (!m) continue;
    const u = UNITES[m[2].toLowerCase()] || m[2].toLowerCase();
    const suite = m[3] ? `/${nombre(m[3])} ${UNITES[m[4].toLowerCase()] || m[4].toLowerCase()}` : m[5] ? `/${m[5].toLowerCase()}` : "";
    return `${nombre(m[1])} ${u}${suite}`;
  }
  return null;
}
// Forme (« KwikPen », « Stylo prérempli », « Collyre »…), lue dans le nom Odoo complet puis dans le nom court
const FORMES = [
  [/kwikpen/, "KwikPen"], [/stylo/, "Stylo prérempli"], [/seringue/, "Seringue préremplie"], [/inhal/, "Inhalation"],
  [/lavage ophtalm|lav ocul/, "Lavage oculaire"], [/collyre|\bcolly\b|sol ocul|oculaire/, "Collyre"], [/lyoc|lyophilisat/, "Lyophilisat"],
  [/comprim|\bcpr\b|\bcp\b/, "Comprimés"], [/gelule|\bgel\b.*caps|\bcaps\b/, "Gélules"], [/\bgel\b/, "Gel"], [/creme/, "Crème"], [/pommade/, "Pommade"],
  [/sirop/, "Sirop"], [/sachet|\bsach\b/, "Sachets"], [/suspension buvable|susp buv/, "Suspension buvable"], [/gouttes|\bgtt\b/, "Gouttes"],
  [/pulv|spray/, "Pulvérisation"], [/injectable|\binj\b/, "Injectable"], [/capsule/, "Capsules"], [/solution|\bsol\b/, "Solution"],
];
export function forme(...noms) {
  for (const nom of noms) {
    const t = sansAccents(nom).toLowerCase();
    const f = FORMES.find(([re]) => re.test(t));
    if (f) return f[1];
  }
  return null;
}
// Textes de la boîte générée (produit sans photo) : calculés ici, jamais dans le navigateur
export const boite = ({ nom_court, nom, labo }) => ({
  marque: marque(nom_court || nom), dosage: dosage(nom_court, nom), forme: forme(nom, nom_court), labo: laboCourt(labo),
});
const doseNum = (d) => { const m = String(d ?? "").match(/(\d+(?:[\s ]\d{3})*(?:,\d+)?)/); return m ? parseFloat(m[1].replace(/[\s ]/g, "").replace(",", ".")) : Infinity; };

// ── Prix (mêmes règles que le site) ──
const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => { const v = typeof x === "string" ? parseFloat(x.replace(",", ".").replace(/[^0-9.-]/g, "")) : Number(x); return Number.isFinite(v) ? v : null; };
const paliers = (t) => (Array.isArray(t) && t.length ? t : null);
// Fusion de products-get.js : prix curaté remplacé par le prix Odoo n° 5 (odoo_catalog) quand pn > 0 et pv > 0
export function fusionPrix(cure, cat) {
  const pv = cat ? parseFloat(cat.list_price) : NaN, pn = cat ? parseFloat(cat.discounted_price) : NaN;
  if (cat && pn > 0 && pv > 0) return { pv, pn, pct: cat.discount_pct != null ? parseFloat(cat.discount_pct) : num(cure.pct), remise_eur: r2(pv - pn), price_tiers: paliers(cat.price_tiers) };
  const cpv = num(cure.pv), cpn = num(cure.pn);
  return { pv: cpv, pn: cpn, pct: num(cure.pct) ?? 0, remise_eur: cure.remise_eur != null ? num(cure.remise_eur) : (cpv != null && cpn != null ? r2(cpv - cpn) : null), price_tiers: paliers(cure.price_tiers) };
}
// Règle de la Saisie de commande (OrderEntry.handleAdd) : pn = prix remisé si remise, sinon prix catalogue
export function prixSaisie(cat) {
  if (!cat) return { pv: null, pn: null, pct: 0, remise_eur: null, price_tiers: null };
  const pv = num(cat.list_price), remise = num(cat.discounted_price) > 0 && num(cat.discount_pct) > 0;
  const pn = remise ? num(cat.discounted_price) : pv;
  return { pv, pn, pct: remise ? num(cat.discount_pct) : 0, remise_eur: pv != null && pn != null ? r2(pv - pn) : null, price_tiers: paliers(cat.price_tiers) };
}
// Produit d'un menu promo (admin_promos) : prix saisis par l'admin (pct en « -50% »)
export function prixPromo(p) {
  const pv = num(p.pv), pn = num(p.pn), pct = Math.abs(num(p.pct) ?? 0);
  return { pv, pn, pct, remise_eur: pv != null && pn != null ? r2(pv - pn) : null, price_tiers: null };
}
// applyTiers de src/tiers.jsx (copie : les fonctions n'importent pas React)
export function applyTiers(basePn, tiers, qty) {
  const list = Array.isArray(tiers) ? tiers.filter(t => t && t.min_qty >= 2 && t.price > 0) : [];
  if (!list.length || basePn == null) return basePn;
  const reached = list.filter(t => qty >= t.min_qty && t.price < basePn).sort((a, b) => b.min_qty - a.min_qty)[0];
  return reached ? reached.price : basePn;
}
// Règle de quantité : getStepMin d'App.jsx puis regleSaisie (colis Stratège et Gamme blanche ; Master : p.palier, absent
// des produits d'App, donc 1 ; campagnes écartées de la vitrine)
export function regleQte(menuKey, p) {
  const colis = Number(p?.colis) || 1;
  const r = menuKey === "stratege" || menuKey === "blanche" ? { step: colis, min: colis, multiple: colis } : { step: 1, min: 0, multiple: 1 };
  const m = r.multiple > 1 ? r.multiple : (r.step > 1 ? r.step : 1);
  return { step: m, min: Math.max(1, r.min, m), multiple: m, libelle: m > 1 ? `Se commande par ${m}${menuKey === "stratege" ? " (carton)" : ""}` : null };
}
// Niveau de stock (jamais de quantité) : dernières boîtes sous max(lot, 10) ; limité sous 5 jours au rythme servi
export function niveauStock(cat, rythme, lot) {
  const dispo = num(cat?.available);
  if (dispo != null && dispo < Math.max(lot || 1, 10)) return "dernieres";
  if (dispo != null && rythme > 0 && dispo / rythme < 5) return "limite";
  return "ok";
}

// ── Menus du site ──
const ACTIFS = (promos) => (Array.isArray(promos) ? promos : []).filter(p => p && p.active);
// Contexte des menus : libellés (display_config.labels), menus masqués, menus promo actifs, campagnes actives
export function contexteMenus({ displayConfig, promos, campagnes } = {}) {
  const dc = displayConfig && typeof displayConfig === "object" ? displayConfig : {};
  const libelle = (k) => String((dc.labels || {})[k] || LIBELLES_MENUS[k] || k).replace(/[\p{Extended_Pictographic}️‍]/gu, "").trim();
  return {
    libelle,
    caches: new Set(dc.hiddenTabs || []),
    promos: ACTIFS(promos).map(ps => ({ key: `promo_${ps.id}`, label: String(ps.name || "Offre"), sansStock: !!ps.sansStock, produits: ps.products || [] })),
    campagnes: new Set((Array.isArray(campagnes) ? campagnes : []).filter(c => c && c.active).map(c => String(c.id))),
  };
}
// Premier menu contenant le CIP (ordre d'App) : menu curaté, sinon campagne active à identifiant propre (onglet ajouté par
// App après les menus : prix palier et UG du panier → écartée), sinon menu promo actif, sinon Saisie de commande
export function premierMenu(cip, curees, menus) {
  for (const key of ORDRE_MENUS) {
    const p = (curees || []).find(r => r.cip === cip && r.section === key);
    if (p) return { key, label: menus.libelle(key), p, source: "cure", cache: menus.caches.has(key), campagne: menus.campagnes.has(key) };
  }
  const camp = (curees || []).find(r => r.cip === cip && menus.campagnes.has(String(r.section)));
  if (camp) return { key: String(camp.section), label: menus.libelle(String(camp.section)), p: camp, source: "cure", cache: menus.caches.has(String(camp.section)), campagne: true };
  for (const ps of menus.promos) {
    const p = ps.produits.find(x => String(x?.cip || "") === cip);
    if (p) return { key: ps.key, label: ps.label, p, source: "promo", cache: menus.caches.has(ps.key), sansStock: ps.sansStock };
  }
  return { key: "saisie", label: LIBELLES_MENUS.saisie, p: null, source: "saisie" };
}

// ── Offre au moment présent : prix, lot, stock, menu (relus à chaque GET) ──
// statique : { cip, nom, nom_court?, labo, _rythme } ; cat : ligne odoo_catalog ; curees : lignes elixir_products actives
// → { offre, raisons } (raisons vide = proposable)
export function offreDynamique(statique, { cat, curees, menus }) {
  const { cip } = statique;
  const m = premierMenu(cip, curees, menus);
  const prix = m.source === "cure" ? fusionPrix(m.p, cat) : m.source === "promo" ? prixPromo(m.p) : prixSaisie(cat);
  const regle = regleQte(m.key, m.p);
  const pu = prix.pn != null ? applyTiers(prix.pn, prix.price_tiers, regle.min) : null;
  const raisons = [];
  if (!cat) raisons.push("hors catalogue du site");
  else if (!cat.in_stock) raisons.push("rupture");
  if (!(prix.pn > 0 && prix.pv > 0)) raisons.push("sans prix");
  else if (prix.pct >= 80 || prix.pn < 0.05 || prix.pn > prix.pv) raisons.push("prix anormal");
  if (m.cache) raisons.push("menu masqué");
  if (m.sansStock) raisons.push("précommande");
  if (m.campagne) raisons.push("campagne");
  const nc = nomCourt(m.p?.name, statique.nom);
  const offre = {
    cip, nom_court: nc,
    nom_panier: String(m.p?.name || cat?.name || statique.nom || nc),   // nom que le panier affichera (menu, sinon odoo_catalog comme la Saisie)
    nom: statique.nom || nc,
    image_url: (m.source === "cure" && m.p?.image_url) || (curees || []).find(r => r.cip === cip && r.image_url)?.image_url || (m.source === "promo" && m.p?.image_url) || null,
    boite: boite({ nom_court: nc, nom: statique.nom, labo: statique.labo }),
    pv: prix.pv, pn: prix.pn, pct: prix.pct || 0, remise_eur: prix.remise_eur, price_tiers: prix.price_tiers,
    regle_qte: regle,
    lot: pu != null ? { qte: regle.min, pu, total: r2(pu * regle.min) } : null,
    stock: { en_stock: true, niveau: niveauStock(cat, statique._rythme, regle.min) },
    menu: { key: m.key, label: m.label },
    popularite: statique.popularite || tranche(0),
  };
  return { offre, raisons };
}

// ── Sélection (fonction planifiée, ou premier appel sans cache) ──
// classement : [{ pid, cmd, ph, qte }] (commandes servies, pharmacies servies, quantité servie, 15 jours)
// precedent : { pid: cmd } (15 jours précédents) ; series : { pid: [15 nombres] } (commandes servies par jour)
// fiches : { pid: { cip, nom, labo, laboId, stup, active, sale_ok } } ; catalogue : { cip: ligne odoo_catalog }
// curees : lignes elixir_products actives ; menus : contexteMenus() ; quotas : Set(pid ou CIP) ; justifs : Set(CIP)
// → { slides, reserves, journal } au format interne
export function selectionner({ classement, precedent = {}, series = {}, fiches = {}, catalogue = {}, curees = [], menus, quotas = new Set(), justifs = new Set() }) {
  const journal = [];
  // départages : commandes, puis pharmacies, puis quantité servie, puis CIP
  const tries = [...classement].sort((a, b) => b.cmd - a.cmd || b.ph - a.ph || b.qte - a.qte || String(fiches[a.pid]?.cip || "").localeCompare(String(fiches[b.pid]?.cip || "")));
  const candidats = [];
  for (const c of tries) {
    const f = fiches[c.pid];
    const cip = f?.cip || null;
    const raisons = [];
    if (!f || !cip) raisons.push("sans CIP");
    const statique = { cip, nom: f?.nom || "", labo: f?.labo || null, _rythme: (c.qte || 0) / 15, popularite: tranche(c.ph) };
    const dyn = cip ? offreDynamique(statique, { cat: catalogue[cip], curees, menus }) : { offre: null, raisons: [] };
    raisons.push(...dyn.raisons);
    if (cip && justifs.has(cip)) raisons.push("sur justificatif labo");
    if (f?.stup) raisons.push("stupéfiant");
    if (quotas.has(c.pid) || (cip && quotas.has(cip))) raisons.push("contingenté");
    if (c.cmd < SEUILS.commandes || c.ph < SEUILS.pharmacies) raisons.push("seuil");
    if (f && (!f.active || f.sale_ok === false)) raisons.push("fiche inactive");
    if (raisons.length) { if (journal.length < 60) journal.push(`${cip || c.pid} : ${raisons.join(", ")}`); continue; }
    candidats.push({ ...c, f, statique, famille: cleFamille(dyn.offre.nom_court || f.nom, f.laboId) });
  }
  // un produit par marque : le premier dosage crée la diapositive, les autres en deviennent les variantes
  const parFamille = new Map();
  for (const c of candidats) { if (!parFamille.has(c.famille)) parFamille.set(c.famille, []); parFamille.get(c.famille).push(c); }
  const diapos = [];
  for (const [, membres] of parFamille) {
    if (diapos.length >= NB_SLIDES + NB_RESERVES) break;
    const tete = membres[0];
    const prec = membres.reduce((s, m) => s + (precedent[m.pid] || 0), 0);
    const tetePrec = precedent[tete.pid] || 0;
    diapos.push({
      famille: marque(nomCourt(null, tete.f.nom)) || marque(tete.f.nom),
      labo: laboCourt(tete.f.labo),
      principal: tete.statique.cip,
      _pid: tete.pid,
      tendance_pct: tetePrec > 0 ? Math.round((tete.cmd - tetePrec) / tetePrec * 100) : null,
      nouveau: prec === 0,
      serie_15j: normaliser(series[tete.pid]),
      membres: membres.map(m => ({ ...m.statique, _cmd: m.cmd, _pid: m.pid })),
    });
  }
  // marque affichée : celle du nom court curaté quand il existe (« MOUNJARO » plutôt que le nom Odoo)
  for (const d of diapos) {
    const tete = d.membres[0];
    const nc = nomCourt((curees || []).find(r => r.cip === tete.cip)?.name, tete.nom);
    d.famille = marque(nc) || d.famille;
  }
  return { slides: diapos.slice(0, NB_SLIDES), reserves: diapos.slice(NB_SLIDES, NB_SLIDES + NB_RESERVES), journal };
}
// Courbe normalisée 0–1 (2 décimales) : la forme, jamais les chiffres
export function normaliser(serie) {
  const s = Array.isArray(serie) ? serie.map(x => Number(x) || 0) : [];
  const max = Math.max(0, ...s);
  return s.map(x => (max > 0 ? Math.round(x / max * 100) / 100 : 0));
}

// ── Réponse du GET : prix et stock relus, ruptures remplacées par les réserves, champs internes retirés ──
const libelleVariante = (o, toutes) => {
  const d = o.boite.dosage, f = o.boite.forme;
  if (toutes.some(x => !x.boite.dosage)) return [f, d].filter(Boolean).join(" · ") || o.nom_court;
  const n = toutes.filter(x => x.boite.dosage === d).length;
  return n > 1 && f ? `${d} · ${f.split(" ")[0].toLowerCase()}` : d;   // « 300 mg · stylo », « 300 mg · seringue »
};
// diapositive publique : chaque membre relu avec SA ligne odoo_catalog ; null si plus aucun dosage n'est proposable
// ctx : { catalogue: { cip: ligne odoo_catalog }, curees, menus }
export function diapoPublique(d, ctx) {
  const vivants = [];
  for (const m of d.membres || []) {
    const { offre, raisons } = offreDynamique(m, { cat: (ctx.catalogue || {})[m.cip], curees: ctx.curees, menus: ctx.menus });
    if (!raisons.length) vivants.push({ ...offre, _cmd: m._cmd || 0 });
  }
  if (!vivants.length) return null;
  // principal : le dosage d'origine s'il est encore proposable, sinon le plus commandé de ceux qui restent
  const principal = vivants.find(v => v.cip === d.principal) || [...vivants].sort((a, b) => b._cmd - a._cmd)[0];
  const sans = ({ _cmd, ...o }) => o;   // eslint-disable-line no-unused-vars
  const variantes = vivants.length > 1
    ? vivants.map(v => ({ ...sans(v), libelle: libelleVariante(v, vivants), principal: v.cip === principal.cip, _dose: doseNum(v.boite.dosage), _n: v._cmd }))
      .sort((a, b) => a._dose - b._dose || b._n - a._n).map(({ _dose, _n, ...v }) => v)   // eslint-disable-line no-unused-vars
    : [];
  return { ...sans(principal), rang: 0, famille: d.famille, labo: d.labo ?? null, tendance_pct: d.tendance_pct ?? null, nouveau: !!d.nouveau,
    serie_15j: d.serie_15j || [], variantes };
}
// cache : { version, genere_le, periode, slides, reserves } (format interne) ; ctx : { catalogue, curees, menus }
// Une diapositive dont plus aucun dosage n'est proposable (rupture…) est remplacée par la première réserve.
export function publique(cache, ctx, maintenant = Date.now()) {
  const vide = (genere_le = null, periode = null) => ({ version: VERSION, genere_le, periode, slides: [], reserves: [], perime: true });
  if (!cache || !Array.isArray(cache.slides) || !cache.genere_le) return vide();
  if (maintenant - Date.parse(cache.genere_le) > PERIME_MS) return vide(cache.genere_le, cache.periode);
  const slides = [], reserves = [];
  for (const d of [...cache.slides, ...(cache.reserves || [])]) {
    if (slides.length >= NB_SLIDES && reserves.length >= NB_RESERVES) break;
    const p = diapoPublique(d, ctx);
    if (!p) continue;
    if (slides.length < NB_SLIDES) slides.push(p); else reserves.push(p);
  }
  slides.forEach((s, i) => { s.rang = i + 1; });
  reserves.forEach((s, i) => { s.rang = NB_SLIDES + i + 1; });
  return { version: VERSION, genere_le: cache.genere_le, periode: cache.periode, slides, reserves, perime: false };
}
// CIP à relire au GET (diapositives, réserves et tous leurs dosages)
export const cipsDuCache = (cache) => [...new Set([...(cache?.slides || []), ...(cache?.reserves || [])].flatMap(d => (d.membres || []).map(m => m.cip)).filter(Boolean))];
