// ── Admin, onglet ✏️ Modifier : ajouter et retirer des produits d'une section existante ──
// JS pur (aucun React) : partagé par AdminSections.jsx / AdminEdit.jsx et testé par scripts/test-admin-sections.mjs.
// Règles :
//  • un CIP = une ligne elixir_products = une section (la clé de la table est le CIP) : un produit déjà dans une autre
//    section n'est jamais dupliqué, il est DÉPLACÉ, sur choix explicite (« Déplacer ici ») ;
//  • retirer = active à false (réversible) : la ligne, sa photo et son historique restent, « Remettre » la rallume ;
//  • ajout d'un CIP absent du site : nom et prix d'Odoo (odoo_catalog : nom fr_FR, prix de vente et liste n° 5), source
//    « admin » ; les prix enregistrés ne servent que de repli, products-get affiche toujours ceux d'Odoo quand il les a ;
//  • chaque changement = un appel products-upsert (jeton admin) qui n'écrit que les colonnes envoyées de CETTE ligne et
//    ajoute une entrée d'historique (action, date, auteur, avant / après) ; jamais d'écriture de la configuration
//    (ec_config : menus promo, affichage) ;
//  • sections exclues : menus promo (produits rangés dans le menu lui-même, onglet 🎯 Promos), campagnes (U-Labs : groupes
//    de gratuité reconnus au nom, quantités engagées par CIP) et outils du site (Péremption courte, fauteuils…).

export const AUTEUR = "admin";
export const ACTIONS = { ajouter: "section_ajout", deplacer: "section_deplacement", remettre: "section_remise", retirer: "section_retrait" };
export const PHOTOS_MAX = 10;   // photos Medipim cherchées après un ajout (clé partagée : 100 appels/min ; ~1 par seconde)
const CODE = /^[\w.-]{1,40}$/;

// Outils du site (vues spéciales d'App.jsx, sans liste de produits du catalogue)
const OUTILS = {
  saisie: "la Saisie de commande", peremption: "la Péremption courte (produits lus dans Odoo)", fauteuil: "l'outil Fauteuil roulant",
  transfert: "l'outil Fauteuil de transfert", justificatif: "la Commande labo sur justificatif", accueil: "la page d'accueil",
  groupees: "les Commandes groupées",
};

// Nom entre guillemets français, espaces insécables (jamais « ou » seul en bout de ligne)
export const guillemets = (t) => `«\u00a0${t}\u00a0»`;

// Nom affiché d'une section (libellé de l'admin sans son icône de tête)
export function nomSection(key, sections = []) {
  const s = (sections || []).find(x => x.key === key);
  const l = s ? String(s.label || "") : String(key ?? "");
  return l.replace(/^[^\p{L}\p{N}«(]+/u, "").trim() || String(key ?? "");
}

// Section où l'admin n'ajoute ni ne retire de produits ici → { raison, texte } ; null : section ordinaire.
// campagnes : identifiants des campagnes actives (campaign-get) ; U-Labs l'est toujours (campagne de secours du site).
export function sectionBloquee(key, { campagnes = [], sections = [] } = {}) {
  const k = String(key ?? "");
  if (!k || k === "all") return null;
  const nom = nomSection(k, sections);
  if (k.startsWith("promo_")) return { raison: "promo", texte: `${guillemets(nom)} est un menu promo : ses produits sont rangés dans le menu lui-même, pas dans le catalogue des sections. Ajoutez-les ou retirez-les depuis l'onglet 🎯 Promos.` };
  if (k === "ulabs" || campagnes.includes(k)) return { raison: "campagne", texte: `${guillemets(nom)} est gérée par une campagne : ses groupes et gratuités (6+2, 3+1) se reconnaissent au nom des produits et les quantités déjà engagées par les pharmacies sont rattachées à ces produits. Ajout et retrait désactivés ici pour ne pas fausser la campagne.` };
  if (OUTILS[k]) return { raison: "outil", texte: `${guillemets(nom)} est ${OUTILS[k]} : un outil du site, pas une liste de produits du catalogue.` };
  return null;
}

const arrondi = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
// Prix d'un produit Odoo (ligne odoo_catalog : list_price, discounted_price = liste n° 5, discount_pct) → { pv, pn, pct,
// remise_eur } comme les enregistre l'onglet ➕ Ajouter ; null sans prix de vente positif
export function prixOdoo(o) {
  const pv = num(o?.list_price), d = num(o?.discounted_price);
  if (!(pv > 0)) return null;
  const pn = d > 0 ? d : pv;
  const pct = num(o?.discount_pct) ?? (pn < pv ? arrondi((pv - pn) / pv * 100) : 0);
  return { pv, pn, pct, remise_eur: arrondi(pv - pn) };
}
// Nom absent ou provisoire dans Odoo (« Nom à préciser : <CIP> », fiche jamais renommée en français)
export const nomProvisoire = (n) => !String(n ?? "").trim() || /^nom\s+à\s+préciser/i.test(String(n).trim());

// État d'un CIP sur le site, d'après products-sections?cips= (produits : cip → { active, section, name })
export function etatCip(cip, section, produits = {}) {
  const p = produits?.[cip];
  if (!p) return { type: "nouveau" };
  if (p.active === false) return { type: "retire", section: p.section ?? null, name: p.name ?? null };
  if (p.section === section) return { type: "ici", name: p.name ?? null };
  return { type: "ailleurs", section: p.section ?? null, name: p.name ?? null };
}

// Ce que l'admin peut faire d'un résultat de recherche dans cette section → { type: "ajouter" | "deplacer" | "remettre" }
// ou { type: null, raison } (affichée telle quelle)
export function verdictAjout({ ligne, etat, section, campagnes = [], sections = [] }) {
  const cip = String(ligne?.cip ?? "");
  if (!CODE.test(cip)) return { type: null, raison: "Code produit inutilisable" };
  if (!etat) return { type: null, raison: "État sur le site inconnu : relancez la recherche" };
  if (etat.type === "ici") return { type: null, raison: "Déjà dans cette section" };
  if (etat.type === "ailleurs") {
    const b = sectionBloquee(etat.section, { campagnes, sections });
    if (b) return { type: null, raison: `Dans ${guillemets(nomSection(etat.section, sections))} (${b.raison === "campagne" ? "section de campagne" : b.raison === "promo" ? "menu promo" : "outil du site"}) : déplacement désactivé ici` };
    return { type: "deplacer" };
  }
  if (etat.type === "retire") return { type: "remettre" };
  if (nomProvisoire(ligne.name)) return { type: null, raison: "Nom provisoire dans Odoo (« Nom à préciser ») : renommez la fiche dans Odoo d'abord" };
  if (!prixOdoo(ligne)) return { type: null, raison: "Pas de prix de vente dans Odoo : ajout impossible depuis ici" };
  return { type: "ajouter" };
}

// Opération → { type, cip, nom, section, depuis, corps } ; corps = corps de products-upsert ({ product, action, author }).
// Seules les colonnes qui changent sont envoyées (products-upsert n'écrit que celles-là) ; _changes = avant / après,
// rangé tel quel dans l'historique du produit.
export function operation(type, { cip, section, ligne = null, etat = null, produit = null, auteur = AUTEUR }) {
  const c = String(cip);
  let product, depuis = null, nom = ligne?.name ?? produit?.name ?? etat?.name ?? c;
  if (type === "ajouter") {
    const prix = prixOdoo(ligne);
    nom = String(ligne.name).trim();
    product = { cip: c, name: nom, section, ...prix, source: "admin", active: true,
      _changes: { section: { avant: null, apres: section }, active: { avant: null, apres: true }, origine: "odoo_catalog", prix: { pv: prix.pv, pn: prix.pn } } };
  } else if (type === "deplacer") {
    depuis = etat.section;
    product = { cip: c, section, _changes: { section: { avant: depuis, apres: section } } };
  } else if (type === "remettre") {
    depuis = etat?.section ?? produit?.section ?? section;
    const change = depuis !== section;
    product = { cip: c, active: true, ...(change ? { section } : {}),
      _changes: { active: { avant: false, apres: true }, ...(change ? { section: { avant: depuis, apres: section } } : { section }) } };
  } else if (type === "retirer") {
    product = { cip: c, active: false, _changes: { active: { avant: true, apres: false }, section } };
  } else throw new Error(`opération inconnue : ${type}`);
  return { type, cip: c, nom, section, depuis, corps: { product, action: ACTIONS[type], author: auteur } };
}

// Plan encore valable juste avant l'écriture ? (relu par products-sections?cips= : un autre poste a pu changer un produit
// entre-temps) → { valides, perimes: [{ op, raison }] }
export function verifierPlan(ops, produits = {}, sections = []) {
  const valides = [], perimes = [];
  for (const op of ops) {
    const p = produits?.[op.cip];
    const dans = (k) => guillemets(nomSection(k, sections));
    const raison =
      op.type === "ajouter" ? (p ? `est désormais sur le site${p.active === false ? " (retiré)" : ` (${dans(p.section)})`}` : null)
      : op.type === "deplacer" ? (!p ? "n'est plus sur le site" : p.active === false ? "a été retiré entre-temps" : p.section !== op.depuis ? (p.section === op.section ? "est déjà dans cette section" : `est passé dans ${dans(p.section)}`) : null)
      : op.type === "remettre" ? (!p ? "n'est plus sur le site" : p.active !== false ? "a déjà été remis" : null)
      : op.type === "retirer" ? (!p ? "n'est plus sur le site" : p.active === false ? "est déjà retiré" : p.section !== op.section ? `est passé dans ${dans(p.section)}` : null)
      : "opération inconnue";
    if (raison) perimes.push({ op, raison }); else valides.push(op);
  }
  return { valides, perimes };
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

// ── Textes ──
export const euros = (n) => (n == null || isNaN(Number(n)) ? "—" : Number(n).toFixed(2).replace(".", ",") + " €");
export const pluriel = (n, un, plusieurs = un + "s") => `${n} ${n > 1 ? plusieurs : un}`;
export function dateCourte(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
// Bilan d'une série d'opérations, en une phrase
export function bilanTexte({ faits = [], echecs = [], nonTraites = [], perimes = [] }, section, sections = []) {
  const n = (t) => faits.filter(o => o.type === t).length;
  const morceaux = [
    n("ajouter") && `${pluriel(n("ajouter"), "ajouté")}`,
    n("deplacer") && `${pluriel(n("deplacer"), "déplacé")} ici`,
    n("remettre") && `${pluriel(n("remettre"), "remis", "remis")}`,
    n("retirer") && `${pluriel(n("retirer"), "retiré")}`,
  ].filter(Boolean);
  const pb = echecs.length + nonTraites.length + perimes.length;
  const ou = section && section !== "all" ? guillemets(nomSection(section, sections)) : "Sections";
  return `${pb && !faits.length ? "⚠ " : "✅ "}${ou} : ${morceaux.join(", ") || "aucun changement"}`
    + (pb ? ` · ${pluriel(pb, "non fait")}` : "");
}
