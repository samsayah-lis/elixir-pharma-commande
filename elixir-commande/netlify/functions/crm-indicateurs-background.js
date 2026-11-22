import { creerCacheCrm, initialiserCacheCrm } from "./_crm-cache.js";
// Synchronisation nocturne, lecture Odoo seule. Aucun appel lors de l'import du module.
import { odoo } from "./_odoo-rpc.js";
import { isCronAuthorized } from "./auth.js";
import { creerStockCrm, erreurCrm } from "./_crm-stock.js";
import { departement } from "./_crm-regles.js";
import { calculerIndicateurs, decalerJour, arrondir } from "./_crm-indicateurs.js";
export const jourParis = d => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export async function lancerIndicateurs(deps = {}) {
  const secret = deps.cronSecret ?? process.env.CRON_SECRET;
  const base = (deps.siteUrl ?? process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? "").replace(/\/$/, "");
  if (!secret || !/^https:\/\//.test(base)) throw erreurCrm(503, "Déclenchement CRM non configuré.");
  try {
    const r = await (deps.fetch || fetch)(`${base}/.netlify/functions/crm-indicateurs-background`, { method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secret }, body: "{}", signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error("déclenchement refusé");
    return { lance: true };
  } catch { throw erreurCrm(503, "Déclenchement CRM indisponible."); }
}

// Mêmes domaines, champs et tailles de pages que lire_odoo.mjs ; adresse et téléphone
// ajoutés à la fiche partenaire pour la synchronisation des comptes du CRM.
export async function lireDonneesOdoo({ date, ex = odoo, verifierDelai = () => {}, maintenant = () => new Date() }) {
  const W0 = decalerJour(date, -29), V0 = decalerJour(date, -59);
  const lectures = new Set(["search", "read", "read_group", "search_read"]);
  const lire = async (modele, methode, args, kwargs = {}) => {
    verifierDelai();
    if (!lectures.has(methode)) throw new Error("Méthode Odoo non autorisée");
    const r = await ex(modele, methode, args, { ...kwargs, context: { lang: "fr_FR", allowed_company_ids: [2], ...kwargs.context } }, { timeoutMs: 20000 });
    if (!Array.isArray(r)) throw new Error("Réponse Odoo invalide");
    verifierDelai(); return r;
  };
  const pages = async (modele, ids, champs, kwargs = {}, taille = 8000) => {
    const resultats = [];
    for (let i = 0; i < ids.length; i += taille * 4) {
      const lots = [];
      for (let j = i; j < Math.min(ids.length, i + taille * 4); j += taille) lots.push(lire(modele, "read", [ids.slice(j, j + taille), champs], kwargs));
      for (const lot of await Promise.all(lots)) resultats.push(...lot);
    }
    return resultats;
  };
  const un = v => v ? v[0] : null;
  const domFactures = [["company_id", "=", 2], ["parent_state", "=", "posted"], ["move_id.move_type", "in", ["out_invoice", "out_refund"]],
    ["display_type", "=", "product"], ["date", ">=", V0], ["date", "<=", date]];
  const facturees = await pages("account.move.line", await lire("account.move.line", "search", [domFactures], { order: "id" }),
    ["date", "partner_id", "product_id", "quantity", "price_subtotal", "purchase_price", "move_type", "move_id"]);
  const domCommandes = [["company_id", "=", 2], ["state", "in", ["sale", "done"]], ["order_id.date_order", ">=", `${W0} 00:00:00`],
    ["order_id.date_order", "<", `${decalerJour(date, 1)} 00:00:00`], ["display_type", "=", false], ["pharmaml_ordered_qty", ">", 0]];
  const commandees = await pages("sale.order.line", await lire("sale.order.line", "search", [domCommandes], { order: "id" }),
    ["order_partner_id", "product_id", "product_uom_qty", "pharmaml_ordered_qty", "qty_delivered", "price_unit", "discount", "price_subtotal", "order_id"]);
  const bons = await pages("sale.order", [...new Set(commandees.map(l => l.order_id[0]))], ["date_order", "partner_id", "origin", "client_order_ref"], {}, 5000);
  const groupes = await lire("account.move", "read_group", [[["company_id", "=", 2], ["state", "=", "posted"], ["move_type", "in", ["out_invoice", "out_refund"]],
    ["invoice_date", ">=", "2025-01-01"], ["invoice_date", "<=", date]], ["amount_untaxed_signed:sum"], ["partner_id", "invoice_date:month"]], { lazy: false });
  const idsClients = new Set([...facturees.map(l => un(l.partner_id)), ...commandees.map(l => un(l.order_partner_id)), ...bons.map(l => un(l.partner_id)), ...groupes.map(l => un(l.partner_id))].filter(Boolean));
  const champsClient = ["name", "cip", "ref", "zip", "city", "country_id", "active", "commercial_partner_id", "street", "street2", "phone"];
  const partners = await pages("res.partner", [...idsClients], champsClient, { context: { active_test: false } }, 800);
  const manquantes = [...new Set(partners.map(p => un(p.commercial_partner_id)).filter(id => id && !idsClients.has(id)))];
  partners.push(...await pages("res.partner", manquantes, champsClient, { context: { active_test: false } }, 800));
  const idsProduits = new Set([...facturees.map(l => un(l.product_id)), ...commandees.map(l => un(l.product_id))].filter(Boolean));
  const produits = await pages("product.product", [...idsProduits], ["name", "default_code", "barcode", "categ_id", "medicine_type", "is_refundable", "public_price", "list_price", "manufacturer_id",
    "quota", "quota_period", "purchase_quota", "restricted_product", "stup", "taxes_id", "generic_group"], { context: { active_test: false } }, 1500);
  const taxes = await lire("account.tax", "search_read", [[["type_tax_use", "=", "sale"]], ["name", "amount", "company_id"]], { context: { active_test: false } });
  return {
    lignes: facturees.map(l => [l.date, un(l.partner_id), un(l.product_id), l.product_id ? l.product_id[1] : null, l.quantity, l.price_subtotal, l.purchase_price, l.move_type, un(l.move_id)]),
    sol: commandees.map(l => [un(l.order_partner_id), un(l.product_id), l.product_id ? l.product_id[1] : null, l.product_uom_qty, l.pharmaml_ordered_qty, l.qty_delivered, l.price_unit, l.discount, l.price_subtotal, l.order_id[0]]),
    so: bons.map(o => [o.id, o.date_order, un(o.partner_id), o.origin, o.client_order_ref]),
    mois: groupes.map(g => [un(g.partner_id), g["invoice_date:month"], g.amount_untaxed_signed, g.__count, g.__range?.["invoice_date:month"]?.from || null]),
    partners, produits, taxes, meta: { date, lu_le: maintenant().toISOString() },
  };
}

export function creerHandlerIndicateurs(deps = {}) {
  const maintenant = deps.maintenant || (() => new Date()), horloge = deps.horloge || (() => Date.now());
  const stock = deps.stock || creerStockCrm({ ...deps, invalidationCache:false });
  return async event => {
    initialiserCacheCrm(event);
    const reponse = (statusCode, data) => ({ statusCode, headers: { "Cache-Control": "no-store" }, body: JSON.stringify(data) });
    if (!(deps.autoriser || isCronAuthorized)(event)) return reponse(403, { error: "Secret de synchronisation requis." });
    if (event.httpMethod !== "POST") return reponse(405, { error: "Méthode POST requise." });
    const date = decalerJour(jourParis(maintenant()), -1), debut = horloge();
    const verifierDelai = () => { if (horloge() - debut > (deps.budgetMs ?? 13 * 60e3)) throw new Error("Délai du calcul dépassé"); };
    let passage;
    const compteurs = { crees: 0, modifies: 0, ignores: 0, inchanges: 0, instantanes: 0 };
    try {
      passage = await stock.commencerSynchro(date);
      if (!passage) return reponse(200, { en_cours: true });
      const reglages = (await stock.lister("reglages", { limite: 1 })).lignes[0];
      if (!reglages?.cibles_indicateurs) throw new Error("Cibles indicateurs absentes");
      const d = await lireDonneesOdoo({ date, ex: deps.odoo || odoo, verifierDelai, maintenant });
      const r = calculerIndicateurs(d, { date, cibles: reglages.cibles_indicateurs, territoire: reglages.territoire_indicateurs });
      const partenaires = new Map(d.partners.map(p => [p.id, p]));
      const pharmacies = new Map([...r.pharmacies, ...r.pharmacies_historiques].map(p => [p.id, p]));
      const instantanes = [];
      for (const p of pharmacies.values()) {
        verifierDelai();
        const partenaire = partenaires.get(p.id) || {};
        const cp = /^\d{5}$/.test(p.zip) ? p.zip : null;
        const resultat = await stock.synchroniserCompte({ odoo_id: p.id, nom: p.nom, cip: p.cip || null,
          adresse: [partenaire.street, partenaire.street2].filter(Boolean).join("\n") || null,
          code_postal: cp, ville: p.ville, departement: departement(cp), telephone: partenaire.phone || null,
          statut: p.ca > 0 ? "client" : "ancien_client" });
        compteurs[resultat]++;
        // hors_cible : ni fiche ni instantané du compte réécrit ; le global reste celui du plan.
        if (resultat !== "ignores") instantanes.push({ odoo_id: p.id, donnees: p });
      }
      const { pharmacies: lignes, pharmacies_historiques: historiques, ...global } = r;
      // Les anciennes clientes sont stockées individuellement ; le global reste celui du plan.
      void historiques;
      global.marge = arrondir(lignes.reduce((n, p) => n + p.marge, 0), 2);
      global.ca_avec_cout = arrondir(lignes.reduce((n, p) => n + p.ca_avec_cout, 0), 2);
      global.marge_taux = global.ca_avec_cout ? global.marge / global.ca_avec_cout : null;
      instantanes.push({ odoo_id: 0, donnees: global }); compteurs.instantanes = instantanes.length;
      verifierDelai();
      await stock.publierIndicateurs(passage.id, instantanes, compteurs);
      return reponse(200, { termine: true, compteurs });
    } catch {
      if (passage) await stock.echouerSynchro(passage.id, compteurs).catch(() => {});
      // Ne jamais renvoyer ni journaliser les erreurs Odoo brutes (données métier possibles).
      return reponse(503, { error: "Synchronisation indisponible ; consulter l’état du passage." });
    } finally { if (passage) await creerCacheCrm(deps).invalider(); }
  };
}
export const handler = creerHandlerIndicateurs();
