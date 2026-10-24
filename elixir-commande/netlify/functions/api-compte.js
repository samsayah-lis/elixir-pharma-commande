// ── API des pharmacies : panneau « Accès API » du compte de la pharmacie (src/components/AccesApi.jsx) ──
// POST { action: "etat" }                                → { ouvert: false } | { ouvert: true, actif, lecture_seule, raison,
//                                                           pharmacie, acces, cgu, test_valide, commandes_production, cles }
// POST { action: "cgu", version }                        → { ok, cgu } (preuve : version, empreinte du texte, compte, date, réseau)
// POST { action: "creer_cle", environnement, libelle, portees } → 201 { cle (secret, montré UNE fois), info }
// POST { action: "remplacer_cle", id }                   → 201 { cle, info, ancienne_expire_le } (l'ancienne reste valide 7 jours)
// POST { action: "revoquer_cle", id, motif? }            → { ok, info }
// POST { action: "journal" }                             → { appels: 50 derniers (date, méthode, route, statut, code, durée, clé,
//                                                           request_id : à donner au support d'Elixir) }
// Compte dont l'adresse n'est plus sur la fiche Odoo, ou fiche sans CIP (mode « conseiller_seul ») : « etat » ne dit que
// { ouvert, lecture_seule: "adresse" } (ni plafonds, ni clés, ni parcours), « journal » est refusé (403 lecture_seule).
// Avis à Elixir (notification de l'admin) à chaque clé de PRODUCTION créée, remplacée ou révoquée (en attendant l'e-mail
// d'avis à la pharmacie, prérequis P9).
// Identité : celle de l'Assistant (identifier() de _chat-perimetre.js) — jeton du code reçu par e-mail, adresse ENCORE
// sur la fiche Odoo (mode « complet ») pour toute écriture ; admin « Commander pour une pharmacie » (admin_token +
// pour_odoo_id revalidé dans Odoo) : lecture seule (les clés d'une pharmacie sans compte se créent dans l'admin, tracé).
// Aucun autre identifiant venu du navigateur n'est lu. Hôte d'aperçu : lecture seule. Le secret d'une clé n'est jamais
// stocké, journalisé ni renvoyé une seconde fois.
import { getCors } from "./cors.js";
import { cleIp } from "./rate-limit.js";
import { identifier } from "./_chat-perimetre.js";
import { creerStockApi, estUuid } from "./_api-stock.js";
import { clePublique, creerCle, remplacerCle, refusCreation, reseauDe } from "./_api-cles.js";
import { CGU, LIBELLES_PORTEES, LIMITES, MENTION_PRIX, commandesLiveOuvertes, empreinteCgu, fusionnerReglages } from "./_api-config.js";
import { estApercu, ipClient, isoParis } from "./_api-http.js";
import { parcoursPublic } from "./_api-parcours.js";

const ACTIONS = new Set(["etat", "cgu", "creer_cle", "remplacer_cle", "revoquer_cle", "journal"]);
const DEBIT = [30, 60];   // requêtes par minute et par IP, par instance
const json = (cors, statusCode, corps) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(corps) });

// Vue de l'accès pour la pharmacie (ni note interne, ni auteur de l'ouverture, ni preuve brute)
function vueAcces(a) {
  return {
    portees: a.portees, libelles_portees: LIBELLES_PORTEES, mode: a.mode, delai_annulation_min: a.delai_annulation_min,
    plafonds: { lignes_par_commande: a.plafond_lignes, boites_par_commande: a.plafond_boites, montant_ht_par_commande: a.plafond_montant_ht,
      commandes_par_jour: a.plafond_commandes_jour },
    reseaux_limites: !!a.ip_autorisees?.length, mention_prix: MENTION_PRIX, limites: { lecture: LIMITES.lecture, commande: LIMITES.commande },
  };
}

// deps (doublures des tests) : stock, identifier(event, body), maintenant, journal, octets
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockApi());
  const maintenant = deps.maintenant || (() => new Date());
  const identifie = deps.identifier || ((event, body) => identifier(event, body));
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-compte", ...o })));
  const compteurs = new Map();
  function limite(event) {
    const k = cleIp(event), t = maintenant().getTime();
    let e = compteurs.get(k);
    if (!e || t > e.fin) { if (compteurs.size > 5000) compteurs.clear(); e = { n: 0, fin: t + DEBIT[1] * 1000 }; compteurs.set(k, e); }
    return ++e.n > DEBIT[0] ? Math.ceil((e.fin - t) / 1000) : 0;
  }

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    if (event.httpMethod !== "POST") return json(cors, 405, { error: "methode" });
    const attente = limite(event);
    if (attente) return { ...json(cors, 429, { error: "debit", message: "Trop de requêtes : réessayez dans quelques secondes." }), headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(attente) } };
    let body;
    try { body = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "json" }); }
    if (!ACTIONS.has(body.action)) return json(cors, 400, { error: "action" });

    let ctx;
    try { ctx = await identifie(event, body); }
    catch (e) {
      if (e?.identite) return json(cors, e.status || 403, { error: e.code });
      if (e?.status === 503 || e?.code === "verification") return json(cors, 503, { error: "verification", message: "Vérification du compte impossible pour l'instant : réessayez dans un instant." });
      journal({ code: "identite", erreur: String(e?.message || e).slice(0, 120) });
      return json(cors, 503, { error: "indisponible" });
    }
    const stock = stockDe();
    const now = maintenant();
    const apercu = estApercu(event);
    // écriture permise : pharmacie connectée, adresse encore sur la fiche, hors aperçu
    const lectureSeule = ctx.admin ? "admin" : ctx.mode !== "complet" ? "adresse" : apercu ? "apercu" : null;
    const evenement = (type, detail, cleId = null) => stock.evenements.ajouter({ type, odoo_id: ctx.odooId, cle_id: cleId, par: ctx.compteEmail, role: "pharmacie", detail })
      .catch((e) => journal({ code: "evenement", type, erreur: String(e?.message || e).slice(0, 80) }));
    // clé de production créée, remplacée ou révoquée par la pharmacie : Elixir est prévenu (notification de l'admin)
    const QUOI = { cle_creee: "créée", cle_remplacee: "remplacée", cle_revoquee: "révoquée" };
    const prevenir = (type, info) => (info?.environnement === "live" ? stock.site.notifier({ type: "new_order", title: `🔑 Clé API de production ${QUOI[type]} — ${ctx.nom || `fiche n° ${ctx.odooId}`}`,
      body: `« ${info.libelle} » (${info.prefixe}), ${QUOI[type]} depuis le compte de la pharmacie. Si ce n'est pas attendu : révoquez-la (onglet 🔌 API) et appelez la pharmacie.`,
      data: { source: "api", motif: type, odoo_id: ctx.odooId, prefixe: info.prefixe } }).catch((e) => journal({ code: "avis_cle", erreur: String(e?.message || e).slice(0, 80) })) : null);

    try {
      const acces = await stock.acces.lire(ctx.odooId);
      // compte détaché de la fiche (adresse retirée d'Odoo, client bloqué) : rien de plus que « l'accès existe »
      const detache = !ctx.admin && ctx.mode !== "complet";
      if (body.action === "etat") {
        if (!acces) return json(cors, 200, { ouvert: false });
        if (detache) return json(cors, 200, { ouvert: true, lecture_seule: "adresse" });
        const [cles, reglages] = await Promise.all([stock.cles.deFiche(ctx.odooId), stock.reglages.lire()]);
        return json(cors, 200, {
          ouvert: true, actif: !!acces.actif, lecture_seule: lectureSeule, pharmacie: ctx.nom,
          acces: vueAcces(acces),
          cgu: { version: CGU.version, titre: CGU.titre, avertissement: CGU.avertissement, articles: CGU.articles,
            acceptee: acces.cgu_version === CGU.version, acceptee_le: acces.cgu_version === CGU.version ? isoParis(acces.cgu_acceptees_le) : null,
            version_acceptee: acces.cgu_version || null },
          test_valide: !!acces.test_valide_le,
          // phase 3 : étapes du parcours de test (validé seul quand les six sont faites avec une clé de test)
          test_parcours: acces.test_valide_le ? null : await parcoursPublic(stock, ctx.odooId),
          commandes_production: commandesLiveOuvertes(fusionnerReglages(reglages.valeur), now) ? "ouvertes" : "fermees",
          cles: cles.map(c => clePublique(c, now)),
          documentation: "/api/",   // page publique (public/api/index.html) ; description OpenAPI : /api/openapi.yaml
        });
      }
      if (body.action === "journal") {
        if (!acces) return json(cors, 404, { error: "acces" });
        if (detache) return json(cors, 403, { error: "lecture_seule", raison: "adresse", message: "Demandez à Elixir Pharma de mettre à jour l'adresse e-mail de votre fiche." });
        const [lignes, cles] = await Promise.all([stock.journal.lister({ odooId: ctx.odooId, limite: 50 }), stock.cles.deFiche(ctx.odooId)]);
        const prefixe = new Map(cles.map(c => [c.id, c.prefixe]));
        return json(cors, 200, { appels: lignes.map(l => ({ at: l.at, request_id: l.request_id, methode: l.methode, route: l.route, statut: l.statut, code: l.code,
          duree_ms: l.duree_ms, environnement: l.environnement, cle: prefixe.get(l.cle_id) || null })) });
      }

      // ── écritures ──
      if (lectureSeule) return json(cors, 403, { error: "lecture_seule", raison: lectureSeule, message: lectureSeule === "admin"
        ? "Saisie pour une pharmacie : lecture seule. Les clés se créent depuis le compte de la pharmacie, ou dans l'admin (onglet 🔌 API) pour une pharmacie sans compte."
        : lectureSeule === "adresse" ? "Demandez à Elixir Pharma de mettre à jour l'adresse e-mail de votre fiche pour gérer vos clés."
        : "Aperçu : aucune modification n'est enregistrée ici." });
      if (!acces || !acces.actif) return json(cors, 409, { error: "acces_ferme", message: "L'accès API de votre pharmacie n'est pas ouvert (ou il est suspendu) : contactez Elixir Pharma." });

      switch (body.action) {
        case "cgu": {
          if (body.version !== CGU.version) return json(cors, 409, { error: "cgu_version", message: "Les conditions ont changé : relisez la version affichée." });
          const preuve = { mode: "en_ligne", empreinte_texte: empreinteCgu(), reseau: reseauDe(ipClient(event)), le: now.toISOString() };
          const a = await stock.acces.modifier(ctx.odooId, { cgu_version: CGU.version, cgu_acceptees_le: now.toISOString(),
            cgu_acceptees_par: ctx.compteEmail, cgu_preuve: JSON.stringify(preuve) });
          await evenement("cgu_acceptees", { version: CGU.version, empreinte_texte: preuve.empreinte_texte, reseau: preuve.reseau });
          return json(cors, 200, { ok: true, cgu: { version: CGU.version, acceptee: true, acceptee_le: isoParis(a?.cgu_acceptees_le || now) } });
        }
        case "creer_cle": {
          const environnement = body.environnement === "live" ? "live" : body.environnement === "test" ? "test" : null;
          const portees = Array.isArray(body.portees) ? [...new Set(body.portees.map(String))] : [];
          const cles = await stock.cles.deFiche(ctx.odooId);
          const refus = refusCreation({ acces, cles, environnement, libelle: body.libelle, portees, maintenant: now });
          if (refus) return json(cors, 409, { error: refus.code, message: refus.message });
          const res = await creerCle(stock, { acces, environnement, libelle: body.libelle, portees, par: ctx.compteEmail, role: "pharmacie", maintenant: now, octets: deps.octets });
          await evenement("cle_creee", { environnement, libelle: res.cle.libelle, portees: res.cle.portees, prefixe: res.cle.prefixe }, res.cle.id);
          await prevenir("cle_creee", res.cle);
          return json(cors, 201, { cle: res.secret, info: res.cle });
        }
        case "remplacer_cle": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          const [ancienne, cles] = await Promise.all([stock.cles.lire(body.id, ctx.odooId), stock.cles.deFiche(ctx.odooId)]);
          if (!ancienne) return json(cors, 404, { error: "cle" });
          if (clePublique(ancienne, now).etat !== "active") return json(cors, 409, { error: "cle_inactive", message: "Seule une clé active peut être remplacée." });
          const portees = (ancienne.portees || []).filter(p => (acces.portees || []).includes(p));
          const refus = refusCreation({ acces, cles, environnement: ancienne.environnement, libelle: ancienne.libelle, portees, remplace: ancienne.id, maintenant: now });
          if (refus) return json(cors, 409, { error: refus.code, message: refus.message });
          const res = await remplacerCle(stock, { acces, ancienne, par: ctx.compteEmail, role: "pharmacie", maintenant: now, octets: deps.octets });
          await evenement("cle_remplacee", { ancienne: ancienne.id, prefixe: res.cle.prefixe, ancienne_expire_le: res.ancienne_expire_le }, res.cle.id);
          await prevenir("cle_remplacee", res.cle);
          return json(cors, 201, { cle: res.secret, info: res.cle, ancienne_expire_le: isoParis(res.ancienne_expire_le) });
        }
        case "revoquer_cle": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          const motif = String(body.motif || "révoquée par la pharmacie").replace(/\s+/g, " ").trim().slice(0, 300);
          const r = await stock.cles.revoquer(body.id, ctx.odooId, { par: ctx.compteEmail, motif });
          if (!r) {
            const c = await stock.cles.lire(body.id, ctx.odooId);
            return c ? json(cors, 200, { ok: true, info: clePublique(c, now), deja: true }) : json(cors, 404, { error: "cle" });
          }
          await evenement("cle_revoquee", { motif, prefixe: r.prefixe }, r.id);
          await prevenir("cle_revoquee", r);
          return json(cors, 200, { ok: true, info: clePublique(r, now) });
        }
        default: return json(cors, 400, { error: "action" });
      }
    } catch (e) {
      journal({ code: e?.code || "erreur", action: body.action, erreur: String(e?.message || e).slice(0, 120) });
      return json(cors, 503, { error: e?.code === "schema" ? "schema" : "indisponible", message: "Service momentanément indisponible : réessayez dans un instant." });
    }
  };
}

export const handler = creerHandler();
