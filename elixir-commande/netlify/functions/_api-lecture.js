// ── API des pharmacies, phase 2 : routes de LECTURE (droit « lecture ») ──
// Ajoutées à ROUTES par api-v1.js, qui fait tous les contrôles avant (clé, accès, fiche, droit, débit par clé) et le
// journal après. Toutes les lectures portent sur LA fiche de la clé (acces.odoo_id) : aucun identifiant de pharmacie venu
// de la requête n'est lu. Documents et commandes : domaines de _chat-perimetre.js (société 2, fiche commerciale et ses
// contacts, allowed_company_ids = [2], coupure à 6 s) ; une référence d'une autre pharmacie donne 404, comme une inconnue.
//
//   GET /v1/catalogue?page=&par_page=        catalogue (odoo_catalog) au prix de la liste de la fiche (api_prix, calculé par
//                                            Odoo, paliers de cette liste), niveau de disponibilité, produit contingenté
//   GET /v1/catalogue/{cip}                  un produit
//   GET /v1/disponibilites?cips=a,b          niveaux en_stock / stock_faible / rupture, stock libre lu en direct (200 CIP)
//   GET /v1/contingents                      reste à commander par produit contingenté (même calcul que le panier)
//   GET /v1/commandes?debut=&fin=&page=      commandes du site et de l'API (≤ 92 jours), état et numéros de nos commandes
//   GET /v1/commandes/{id}                   détail : état, quantités demandées, acceptées, servies, non servies, facturées
//   GET /v1/factures?debut=&fin=&type=       factures et avoirs (≤ 366 jours)        GET /v1/factures/{id}/pdf : PDF d'origine
//   GET /v1/livraisons?debut=&fin=           bons de livraison (≤ 366 jours)          GET /v1/livraisons/{id}/pdf : duplicata
//
// Charge d'Odoo : chaque route qui lit vraiment Odoo (cache manqué) est comptée par fiche (30/min, toutes clés) et pour
// toutes les pharmacies (240/min) en plus du débit par clé ; caches par instance : liste de prix de la fiche et produits
// contingentés 10 min, disponibilités 60 s par CIP, contingents 60 s par fiche. Le catalogue ne lit que la base (prix
// calculés la nuit) : ETag + If-None-Match → 304.
import crypto from "node:crypto";
import { odoo as odooReel, COMPANY_ID } from "./_odoo-rpc.js";
import { DELAI_ODOO_MS, listerPieces, pdfPiece, listerLivraisons, livraisonsDeLaFiche, donneesLivraisons, jourValide, jourParis, heureParis, jourPlus,
  minuitParisIso } from "./_chat-perimetre.js";
import { blPdf, nomFichierBl } from "./_chat-bl.js";
import { lireConfig as lireConfigJustif, indexProduits } from "./_lab-justif.js";
import { CLE_OUTILS, FAUTEUILS, cipsFauteuils } from "./_accueil-outils.js";
import { validCip } from "./_pharmacies.js";
import { resteContingents, cipsContingentes, formerContingents } from "./_api-contingent.js";
import { listerCommandesApi, detailCommandeApi, ORDRE_SITE, ORDRE_TEST } from "./_api-suivi.js";
import { noterParcours } from "./_api-parcours.js";
import { lecteurOdoo, listesDesFiches } from "./_api-prix.js";
import { LIMITES, PAGES, PRIX, MENTION_PRIX_DETAIL, MENTION_DISPONIBILITE, niveauStock } from "./_api-config.js";
import { erreurApi, reponseJson, reponseFichier, isoParis } from "./_api-http.js";

const LISTE_MS = 10 * 60e3, QUOTA_MS = 10 * 60e3, DISPO_MS = 60e3, CONTINGENTS_MS = 60e3;
const CIP13 = /^\d{13}$/;
const r2 = (x) => Math.round(Number(x) * 100) / 100;

// ── Services (un jeu par instance du routeur) ──
// deps : stock (_api-stock.js), odoo (_odoo-rpc.js, doublure des tests), horloge (ms), maintenant, log, quota (doublure de
// _api-contingent.js pour le banc d'essai : { cipsContingentes, resteContingents } — _quota.js lit Odoo sans injection)
export function creerServicesLecture({ stock, odoo, horloge = () => Date.now(), maintenant = () => new Date(), log = () => {}, quota = {}, justificatifs = null }) {
  odoo ||= odooReel;
  const lireContingentes = quota.cipsContingentes || cipsContingentes, calculerContingents = quota.resteContingents || resteContingents;
  const caches = { listes: new Map(), dispo: new Map(), contingents: new Map(), quota: null, justif: null, horsApi: null };
  const borner = (m) => { if (m.size > 20000) m.clear(); };
  const resteFenetre = (s) => s - (Math.floor(horloge() / 1000) % s);
  // lectures directes de l'API (disponibilités, liste de prix) : société 2 imposée, méthodes d'écriture refusées, 6 s
  const lire = lecteurOdoo(odoo, DELAI_ODOO_MS);
  // dépendances des lectures de _chat-perimetre.js et du contingentement : Supabase par la clé serveur, en lecture seule
  const deps = { odoo, sb: stock.sbLecture, maintenant };

  // Charge d'Odoo (durable, toutes instances) : à appeler juste avant une lecture Odoo réelle
  async function chargerOdoo(odooId) {
    const [nFiche, nTout] = await Promise.all([stock.compteurs.compter(`odoo:fiche:${odooId}`, 60), stock.compteurs.compter("odoo:global", 60)]);
    if (nTout > LIMITES.odoo.global_par_minute) throw erreurApi("indisponible", { retry: 30, detail: "Notre système est très sollicité : réessayez dans un instant." });
    if (nFiche > LIMITES.odoo.fiche_par_minute) throw erreurApi("debit", { retry: resteFenetre(60), detail: "Trop de lectures de suivi pour votre pharmacie en une minute (toutes clés confondues) : réessayez après le délai indiqué." });
  }

  // Liste de prix de la fiche : relue dans Odoo au plus toutes les 10 min ; Odoo muet ou charge atteinte → liste enregistrée
  // sur l'accès. Une liste changée est notée sur l'accès et demandée au calcul (sauf sur un aperçu : rien n'y est écrit).
  async function listeDeFiche(acces, { apercu = false } = {}) {
    const c = caches.listes.get(acces.odoo_id), t = horloge();
    if (c && t - c.at < LISTE_MS) return c.v;
    let v = Number(acces.liste_prix_id) || null;
    try {
      await chargerOdoo(acces.odoo_id);
      const l = (await listesDesFiches(lire, [acces.odoo_id])).get(acces.odoo_id) || null;
      if (l) {
        if (l !== v && !apercu) {
          await stock.acces.modifier(acces.odoo_id, { liste_prix_id: l, liste_prix_lue_le: maintenant().toISOString() });
          await stock.prixListes.demander(l);
        }
        v = l;
      }
    } catch (e) { log({ code: "liste_fiche", odoo_id: acces.odoo_id, erreur: String(e?.message || e).slice(0, 80) }); }
    borner(caches.listes);
    caches.listes.set(acces.odoo_id, { at: t, v });
    return v;
  }

  // Produits contingentés (règles seules, communes à toutes les pharmacies) → Set, ou null si Odoo ne répond pas
  async function contingentes(odooId) {
    const t = horloge();
    if (caches.quota && t - caches.quota.at < QUOTA_MS) return caches.quota.v;
    let v = null;
    try { await chargerOdoo(odooId); v = await lireContingentes(); }
    catch (e) { log({ code: "contingentes", erreur: String(e?.message || e).slice(0, 80) }); if (caches.quota) return caches.quota.v; return null; }
    caches.quota = { at: t, v };
    return v;
  }

  // Stock libre en direct (société 2) → Map(cip → niveau | null si inconnu) ; cache 60 s par CIP
  async function disponibilites(odooId, cips) {
    const t = horloge(), out = new Map(), manquants = [];
    for (const c of cips) { const x = caches.dispo.get(c); if (x && t - x.at < DISPO_MS) out.set(c, x.v); else manquants.push(c); }
    if (manquants.length) {
      await chargerOdoo(odooId);
      const rows = (await lire("product.product", "search_read", [["&", ["company_id", "in", [COMPANY_ID, false]], "|", ["default_code", "in", manquants], ["barcode", "in", manquants]]],
        { fields: ["default_code", "barcode", "free_qty"], order: "id asc", limit: manquants.length * 3 })) || [];
      const parCode = new Map(), parBarre = new Map();
      for (const r of rows) {
        if (r.default_code && !parCode.has(r.default_code)) parCode.set(r.default_code, r);
        if (r.barcode && !parBarre.has(r.barcode)) parBarre.set(r.barcode, r);
      }
      borner(caches.dispo);
      for (const c of manquants) {
        const r = parCode.get(c) || parBarre.get(c);
        const v = r ? niveauStock(r.free_qty) : null;
        caches.dispo.set(c, { at: t, v });
        out.set(c, v);
      }
    }
    return out;
  }

  // Contingents de la fiche (même calcul que le panier) ; cache 60 s par fiche
  async function contingents(ctx) {
    const c = caches.contingents.get(ctx.odooId), t = horloge();
    if (c && t - c.at < CONTINGENTS_MS) return c.v;
    await chargerOdoo(ctx.odooId);
    const v = formerContingents(await calculerContingents({ odooId: ctx.odooId, cip: ctx.cip },
      { sb: stock.sbLecture, odoo: (m, me, a, k) => odoo(m, me, a, k, { timeoutMs: DELAI_ODOO_MS }), maintenant }));
    borner(caches.contingents);
    caches.contingents.set(ctx.odooId, { at: t, v });
    return v;
  }

  // ── Phase 3 (commandes) : lectures FRAÎCHES (jamais de cache pour accepter une commande) ──
  // Contingents bruts de la fiche (forme de quota-status) ; le cache de /v1/contingents est vidé (commande acceptée)
  async function contingentsBruts(ctx) {
    caches.contingents.delete(ctx.odooId);
    return calculerContingents({ odooId: ctx.odooId, cip: ctx.cip }, { sb: stock.sbLecture, odoo: (m, me, a, k) => odoo(m, me, a, k, { timeoutMs: DELAI_ODOO_MS }), maintenant });
  }
  const oublierContingents = (odooId) => caches.contingents.delete(odooId);
  // Produits sur justificatif laboratoire (page dédiée du site) → index CIP → { lab, produit } ; cache 10 min ; illisible → lève
  async function produitsJustificatif() {
    const t = horloge();
    if (caches.justif && t - caches.justif.at < QUOTA_MS) return caches.justif.v;
    const v = justificatifs ? await justificatifs() : indexProduits(await lireConfigJustif());
    caches.justif = { at: t, v };
    return v;
  }
  // Produits que le site seul sait commander (hors API en V1) → Map(CIP → « multi_cip » | « campagne ») ; cache 10 min ;
  // illisible → lève (jamais « commandable » par défaut) :
  //  • articles livrés sous plusieurs CIP (fauteuils : le site répartit la quantité entre les CIP, le plus ancien d'abord) —
  //    correspondance de la fonction planifiée de l'accueil (kv « accueil:outils »), plus les CIP de repli ;
  //  • produits des campagnes (section U-Labs et sections des campagnes actives : gratuités et quantités engagées propres
  //    à la campagne). Mêmes sources que les exclusions de la péremption (_peremption.js, exclusionsSite).
  async function produitsHorsApi() {
    const t = horloge();
    if (caches.horsApi && t - caches.horsApi.at < QUOTA_MS) return caches.horsApi.v;
    const lireJson = (x, d) => { if (x && typeof x === "object") return x; try { return JSON.parse(x); } catch { return d; } };
    const [plan, campagnes] = await Promise.all([
      stock.sbLecture(`kv_store?key=eq.${encodeURIComponent(CLE_OUTILS)}&select=value&limit=1`).then(r => lireJson(r?.[0]?.value, null)),
      stock.sbLecture("elixir_campaigns?active=eq.true&select=id&limit=200"),
    ]);
    const sections = [...new Set(["ulabs", ...(Array.isArray(campagnes) ? campagnes : []).map(c => String(c?.id ?? ""))])].filter(s => /^[\w.-]{1,60}$/.test(s));
    const enCampagne = (await stock.sbLecture(`elixir_products?section=in.${encodeURIComponent(`(${sections.map(s => `"${s}"`).join(",")})`)}&select=cip&limit=5000`)) || [];
    const v = new Map();
    for (const c of cipsFauteuils(Object.keys(FAUTEUILS), plan)) v.set(String(c), "multi_cip");
    for (const p of enCampagne) if (p?.cip && !v.has(String(p.cip))) v.set(String(p.cip), "campagne");
    caches.horsApi = { at: t, v };
    return v;
  }
  // Produits Odoo (société 2) par CIP ou code-barres → Map(code → { id, free_qty }) ; lecture directe
  async function produitsOdoo(codes) {
    const xs = [...new Set(codes)].filter(c => CIP13.test(c));
    const out = new Map();
    if (!xs.length) return out;
    const rows = (await lire("product.product", "search_read", [["&", ["company_id", "in", [COMPANY_ID, false]], "|", ["default_code", "in", xs], ["barcode", "in", xs]]],
      { fields: ["id", "default_code", "barcode", "free_qty"], order: "id asc", limit: xs.length * 3 })) || [];
    for (const r of rows) for (const c of [r.default_code, r.barcode]) if (c && xs.includes(c) && !out.has(c)) out.set(c, { id: r.id, free_qty: Number(r.free_qty) || 0 });
    return out;
  }
  // Lignes de commande Odoo de la fiche (toutes origines, non annulées) sur ces produits depuis une date Odoo (« AAAA-MM-JJ hh:mm:ss ») :
  // historique (quantité mensuelle habituelle) et commandes reçues dans les dernières minutes (quasi-doublons du logiciel)
  async function lignesOdoo(odooId, codes, depuisOdoo) {
    const xs = [...new Set(codes)].filter(c => CIP13.test(c));
    if (!xs.length) return [];
    return (await lire("sale.order.line", "search_read", [[["company_id", "=", COMPANY_ID], ["order_partner_id", "child_of", Number(odooId)], ["state", "!=", "cancel"],
      "|", ["product_id.default_code", "in", xs], ["product_id.barcode", "in", xs], ["order_id.date_order", ">=", depuisOdoo]]],
      { fields: ["product_id", "product_uom_qty", "order_id", "create_date"], limit: 5000 })) || [];
  }

  return { deps, chargerOdoo, listeDeFiche, contingentes, disponibilites, contingents, contingentsBruts, oublierContingents, produitsJustificatif, produitsHorsApi,
    produitsOdoo, lignesOdoo };
}

// ── Paramètres ──
const parametres = (event) => {
  const p = { ...(event.queryStringParameters || {}) };
  for (const [k, v] of Object.entries(event.multiValueQueryStringParameters || {})) p[k] = [].concat(v).join(",");
  return p;
};
const invalide = (erreurs) => erreurApi("requete_invalide", { detail: erreurs.map(e => e.message).join(" "), extra: { erreurs } });
function pagination(q, conf) {
  const erreurs = [];
  const page = q.page == null || q.page === "" ? 1 : Number(q.page);
  const parPage = q.par_page == null || q.par_page === "" ? conf.defaut : Number(q.par_page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) erreurs.push({ champ: "page", message: "page : nombre entier à partir de 1." });
  if (!Number.isInteger(parPage) || parPage < 1 || parPage > conf.max) erreurs.push({ champ: "par_page", message: `par_page : nombre entier de 1 à ${conf.max}.` });
  if (erreurs.length) throw invalide(erreurs);
  return { page, parPage, offset: (page - 1) * parPage };
}
// date « AAAA-MM-JJ » réelle (jourValide lève sur un mois 13 : on vérifie d'abord que la date se lit)
const jourOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && jourValide(s);
// période en jours (heure de Paris), bornes comprises : défaut = les N derniers jours ; au plus conf.periode_max jours
function periode(q, conf, now) {
  const fin = q.fin || jourParis(now);
  const debut = q.debut || (jourOk(fin) ? jourPlus(fin, -(conf.periode_defaut - 1)) : "");
  const erreurs = [];
  if (!jourOk(debut)) erreurs.push({ champ: "debut", message: "debut : date AAAA-MM-JJ." });
  if (!jourOk(fin)) erreurs.push({ champ: "fin", message: "fin : date AAAA-MM-JJ." });
  if (!erreurs.length && debut > fin) erreurs.push({ champ: "debut", message: "debut doit précéder fin." });
  if (!erreurs.length && (Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / 86400e3 + 1 > conf.periode_max)
    erreurs.push({ champ: "fin", message: `Période de ${conf.periode_max} jours au plus.` });
  if (erreurs.length) throw invalide(erreurs);
  return { debut, fin };
}
const suivante = (route, q, page, parPage, encore) => {
  if (!encore) return null;
  const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([k]) => !["page", "par_page"].includes(k) && typeof q[k] === "string")), page: String(page + 1), par_page: String(parPage) });
  return `/api/v1/${route}?${p}`;
};
// fiche de la clé pour les lectures de _chat-perimetre.js (CIP relu dans Odoo, sinon celui de l'accès)
const ficheDe = (acces, fiche) => ({ odooId: acces.odoo_id, cip: validCip(fiche?.cip) ? String(fiche.cip).trim() : validCip(acces.cip) ? String(acces.cip).trim() : null,
  nom: fiche?.name || acces.nom || null, ville: fiche?.city || acces.ville || null, mode: "complet" });

// réponse JSON avec ETag faible (corps entier) ; If-None-Match identique → 304 sans corps
function avecEtag(event, corps, requestId) {
  const texte = JSON.stringify(corps);
  const etag = `W/"${crypto.createHash("sha256").update(texte).digest("base64url").slice(0, 27)}"`;
  const demande = String(event.headers?.["if-none-match"] || event.headers?.["If-None-Match"] || "");
  const entetes = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (demande && demande.split(",").map(s => s.trim()).some(x => x === etag || x === "*")) {
    return { statusCode: 304, headers: { "X-Request-Id": requestId, "X-Content-Type-Options": "nosniff", ...entetes }, body: "" };
  }
  return reponseJson(200, corps, requestId, entetes);
}

// ── Catalogue ──
const niveauCatalogue = (r) => (!r.in_stock ? "rupture" : r.available == null ? "en_stock" : Number(r.available) > 0 ? niveauStock(r.available) : "en_stock");
function produit(r, p, contingentes) {
  return { cip: r.cip, nom: String(r.name || "").replace(/\s+/g, " ").trim() || null, prix_ht: p?.prix_ht ?? null,
    paliers: (p?.paliers || []).filter(x => Number.isInteger(x?.a_partir_de) && x.prix_ht > 0).map(x => ({ a_partir_de: x.a_partir_de, prix_ht: r2(x.prix_ht) })),
    disponibilite: niveauCatalogue(r), contingente: contingentes ? contingentes.has(r.cip) || (!!r.barcode && contingentes.has(r.barcode)) : null };
}
// état des prix rendus : a_jour, ancien (plus de 48 h), en_calcul (liste pas encore calculée), indisponible (liste illisible)
function etatPrix(liste, etatListe, prix, now) {
  if (!liste) return { base: "liste_pharmacie", etat: "indisponible", calcule_le: null };
  const dates = prix.map(p => p.calcule_le).filter(Boolean).sort();
  if (!dates.length) return { base: "liste_pharmacie", etat: etatListe?.etat === "pret" ? "a_jour" : "en_calcul", calcule_le: isoParis(etatListe?.fin_le) };
  const plusAncien = dates[0];
  return { base: "liste_pharmacie", etat: now.getTime() - Date.parse(plusAncien) > PRIX.age_perime_h * 3600e3 ? "ancien" : "a_jour", calcule_le: isoParis(plusAncien) };
}
const AVERT_PRIX = {
  indisponible: "Votre liste de prix n'a pas pu être lue : prix absents. Réessayez plus tard ou contactez Elixir Pharma.",
  en_calcul: "Vos prix sont en cours de calcul (moins d'une heure) : prix absents pour l'instant.",
  ancien: "Vos prix n'ont pas pu être recalculés récemment : ils datent de plus de 48 heures.",
};

async function routeCatalogue({ event, acces, stock, services, apercu, requestId, maintenant }) {
  const q = parametres(event);
  const { page, parPage, offset } = pagination(q, PAGES.catalogue);
  const [liste, cat] = await Promise.all([services.listeDeFiche(acces, { apercu }), stock.catalogue.page({ offset, limite: parPage })]);
  const rows = cat.rows || [];
  const [prix, etatListe, contingentes] = await Promise.all([
    liste && rows.length ? stock.prix.plage(liste, rows[0].cip, rows.at(-1).cip) : [],
    liste ? stock.prixListes.lire(liste) : null,
    services.contingentes(acces.odoo_id)]);
  if (liste && !etatListe && !apercu) await stock.prixListes.demander(liste).catch(() => null);
  const parCip = new Map(prix.map(p => [p.cip, p]));
  const p = etatPrix(liste, etatListe, prix, maintenant);
  const maj = rows.map(r => r.updated_at).filter(Boolean).sort().pop() || null;
  const corps = {
    donnees: rows.map(r => produit(r, parCip.get(r.cip), contingentes)), page, par_page: parPage, total: cat.total,
    suivante: suivante("catalogue", q, page, parPage, cat.total != null ? offset + rows.length < cat.total : rows.length === parPage),
    prix: p, disponibilite_maj: isoParis(maj), mention: MENTION_PRIX_DETAIL,
    avertissements: [AVERT_PRIX[p.etat], contingentes ? null : "Produits contingentés momentanément inconnus (contingente : null)."].filter(Boolean),
  };
  return avecEtag(event, corps, requestId);
}

async function routeProduit({ event, acces, stock, services, apercu, requestId, maintenant, params }) {
  const cip = params[0];
  if (!CIP13.test(cip)) throw invalide([{ champ: "cip", message: "cip : 13 chiffres." }]);
  const r = await stock.catalogue.parCip(cip);
  if (!r) throw erreurApi("introuvable", { detail: "Ce produit n'est pas au catalogue." });
  const liste = await services.listeDeFiche(acces, { apercu });
  const [prix, etatListe, contingentes] = await Promise.all([liste ? stock.prix.deCips(liste, [r.cip]) : [], liste ? stock.prixListes.lire(liste) : null,
    services.contingentes(acces.odoo_id)]);
  const p = etatPrix(liste, etatListe, prix, maintenant);
  return avecEtag(event, { ...produit(r, prix[0], contingentes), prix: p, disponibilite_maj: isoParis(r.updated_at), mention: MENTION_PRIX_DETAIL,
    avertissements: [AVERT_PRIX[p.etat]].filter(Boolean) }, requestId);
}

async function routeDisponibilites({ event, acces, services, maintenant }) {
  const brut = String(parametres(event).cips || "");
  const cips = [...new Set(brut.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
  const erreurs = [];
  if (!cips.length) erreurs.push({ champ: "cips", message: "cips : liste de CIP13 séparés par des virgules." });
  if (cips.length > PAGES.disponibilites.max_cips) erreurs.push({ champ: "cips", message: `cips : ${PAGES.disponibilites.max_cips} au plus par appel.` });
  const faux = cips.filter(c => !CIP13.test(c));
  if (faux.length) erreurs.push({ champ: "cips", message: `CIP13 invalide(s) : ${faux.slice(0, 5).map(c => c.slice(0, 20)).join(", ")}.` });
  if (erreurs.length) throw invalide(erreurs);
  const niveaux = await services.disponibilites(acces.odoo_id, cips);
  return { donnees: cips.map(c => (niveaux.get(c) ? { cip: c, disponibilite: niveaux.get(c) } : { cip: c, disponibilite: null, inconnu: true })),
    lu_le: isoParis(maintenant), mention: MENTION_DISPONIBILITE };
}

async function routeContingents({ acces, fiche, services }) {
  const ctx = ficheDe(acces, fiche);
  return services.contingents(ctx);
}

// ── Commandes ──
async function routeCommandes({ event, acces, fiche, stock, services, environnement, maintenant }) {
  const q = parametres(event);
  const { debut, fin } = periode(q, PAGES.commandes, maintenant);
  const { page, parPage } = pagination(q, PAGES.commandes);
  const ctx = ficheDe(acces, fiche);
  await services.chargerOdoo(acces.odoo_id);
  const r = await listerCommandesApi(ctx, { debutIso: minuitParisIso(debut), finIso: minuitParisIso(jourPlus(fin, 1)), page, parPage, environnement, now: maintenant },
    stock, services.deps);
  return { donnees: r.donnees, page, par_page: parPage, suivante: suivante("commandes", q, page, parPage, r.suivante), periode: { debut, fin } };
}
async function routeCommande(arg) {
  const { acces, fiche, stock, services, environnement, maintenant, params } = arg;
  const id = params[0];
  if (!ORDRE_SITE.test(id) && !ORDRE_TEST.test(id)) throw erreurApi("introuvable");
  await services.chargerOdoo(acces.odoo_id);
  const c = await detailCommandeApi(ficheDe(acces, fiche), id, { environnement, now: maintenant }, stock, services.deps);
  if (!c) throw erreurApi("introuvable");
  if (ORDRE_TEST.test(id)) await noterParcours(arg, "relecture");   // parcours de test (phase 3)
  return c;
}

// ── Factures et avoirs ──
const TYPES = { tous: "tous", factures: "factures", avoirs: "avoirs" };
async function routeFactures({ event, acces, fiche, services, maintenant }) {
  const q = parametres(event);
  const { debut, fin } = periode(q, PAGES.factures, maintenant);
  const { page, parPage, offset } = pagination(q, PAGES.factures);
  const type = q.type == null || q.type === "" ? "tous" : TYPES[q.type];
  if (!type) throw invalide([{ champ: "type", message: "type : tous, factures ou avoirs." }]);
  await services.chargerOdoo(acces.odoo_id);
  const r = await listerPieces(ficheDe(acces, fiche), { debut, fin, type, page, parPage }, services.deps);
  return {
    donnees: r.pieces.map(x => ({ id: x.id, type: x.piece, numero: x.numero, date: x.date, montant_ht: x.montant_ht, montant_tva: x.montant_tva, montant_ttc: x.montant_ttc,
      commandes_elixir: x.commandes, pdf_disponible: x.pdf_disponible, ...(x.piece === "avoir" ? { avoir_de: x.avoir_de || null, motif: x.motif || null } : {}) })),
    page, par_page: parPage, total: r.total, suivante: suivante("factures", q, page, parPage, offset + r.pieces.length < r.total), periode: { debut, fin },
  };
}
async function routeFacturePdf({ acces, fiche, services, requestId, params }) {
  const id = Number(params[0]);
  if (!Number.isInteger(id) || id <= 0 || id > 2e9) throw erreurApi("introuvable");
  await services.chargerOdoo(acces.odoo_id);
  const f = await pdfPiece(ficheDe(acces, fiche), id, services.deps);
  if (!f) throw erreurApi("introuvable", { detail: "Pièce introuvable pour votre pharmacie, ou PDF pas encore disponible (pdf_disponible : false)." });
  return reponseFichier(f.base64, `${f.piece === "avoir" ? "Avoir" : "Facture"}_${f.numero}.pdf`, "application/pdf", requestId);
}

// ── Bons de livraison ──
async function routeLivraisons({ event, acces, fiche, services, maintenant }) {
  const q = parametres(event);
  const { debut, fin } = periode(q, PAGES.livraisons, maintenant);
  const { page, parPage, offset } = pagination(q, PAGES.livraisons);
  await services.chargerOdoo(acces.odoo_id);
  const r = await listerLivraisons(ficheDe(acces, fiche), { debut, fin, page, parPage }, services.deps);
  return {
    donnees: r.bons.map(b => ({ id: b.id, numero: b.numero, sortie_le: depuisParis(b.date, b.heure),
      commande_elixir: b.commande, renvoi: b.renvoi, reste_a_livrer: b.reste_a_livrer, produits: b.produits.map(p => ({ cip: p.cip, nom: p.produit })) })),
    page, par_page: parPage, total: r.total, suivante: suivante("livraisons", q, page, parPage, offset + r.bons.length < r.total), periode: { debut, fin },
  };
}
// jour et heure de Paris (« 2026-09-02 », « 21:30 », forme des bons de livraison) → date ISO avec son décalage
function depuisParis(jour, heure) {
  if (!jour) return null;
  const h = /^\d{2}:\d{2}$/.test(String(heure || "")) ? heure : "00:00";
  for (const off of ["+01:00", "+02:00"]) {
    const d = new Date(`${jour}T${h}:00${off}`);
    if (jourParis(d) === jour && heureParis(d) === h) return isoParis(d);
  }
  return isoParis(new Date(`${jour}T${h}:00+01:00`));
}
async function routeLivraisonPdf({ acces, fiche, services, requestId, maintenant, params }) {
  const id = Number(params[0]);
  if (!Number.isInteger(id) || id <= 0 || id > 2e9) throw erreurApi("introuvable");
  await services.chargerOdoo(acces.odoo_id);
  const ctx = ficheDe(acces, fiche);
  if (!(await livraisonsDeLaFiche(ctx, [id], services.deps))) throw erreurApi("introuvable");
  const bons = await donneesLivraisons(ctx, [id], services.deps);
  if (!bons) throw erreurApi("introuvable");
  return reponseFichier(Buffer.from(await blPdf(bons, { edite: maintenant })).toString("base64"), nomFichierBl(bons), "application/pdf", requestId);
}

// Routes (gabarit journalisé ; classe de débit ; params : groupes capturés du chemin)
export const ROUTES_LECTURE = [
  { methode: "GET", gabarit: "/v1/catalogue", re: /^\/v1\/catalogue$/, portee: "lecture", classe: "lecture", traiter: routeCatalogue },
  { methode: "GET", gabarit: "/v1/catalogue/{cip}", re: /^\/v1\/catalogue\/([^/]+)$/, portee: "lecture", classe: "lecture", traiter: routeProduit },
  { methode: "GET", gabarit: "/v1/disponibilites", re: /^\/v1\/disponibilites$/, portee: "lecture", classe: "disponibilites", traiter: routeDisponibilites },
  { methode: "GET", gabarit: "/v1/contingents", re: /^\/v1\/contingents$/, portee: "lecture", classe: "lecture", traiter: routeContingents },
  { methode: "GET", gabarit: "/v1/commandes", re: /^\/v1\/commandes$/, portee: "lecture", classe: "lecture", traiter: routeCommandes },
  { methode: "GET", gabarit: "/v1/commandes/{id}", re: /^\/v1\/commandes\/([^/]+)$/, portee: "lecture", classe: "lecture", traiter: routeCommande },
  { methode: "GET", gabarit: "/v1/factures", re: /^\/v1\/factures$/, portee: "lecture", classe: "lecture", traiter: routeFactures },
  { methode: "GET", gabarit: "/v1/factures/{id}/pdf", re: /^\/v1\/factures\/([^/]+)\/pdf$/, portee: "lecture", classe: "documents", traiter: routeFacturePdf },
  { methode: "GET", gabarit: "/v1/livraisons", re: /^\/v1\/livraisons$/, portee: "lecture", classe: "lecture", traiter: routeLivraisons },
  { methode: "GET", gabarit: "/v1/livraisons/{id}/pdf", re: /^\/v1\/livraisons\/([^/]+)\/pdf$/, portee: "lecture", classe: "documents", traiter: routeLivraisonPdf },
];
