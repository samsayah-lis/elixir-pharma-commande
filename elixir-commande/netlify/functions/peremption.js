// ── Péremption courte, « Odoo facture la remise » (V1) : point d'entrée HTTP (docs/peremption-odoo.md) ──
// GET  ?action=page                 public : page « Péremption courte » et carte de l'accueil (etatPublic : ni coût ni marge)
// GET  ?action=admin|journal|droits|ecarts|retrait_apercu    admin (verifyAdmin) ; droits, écarts et aperçu d'un retrait :
//                                   lectures seulement (retrait_apercu&cips=… : décisions, règles vivantes, commandes en cours)
// GET  ?step=nuit&offset=N          chaîne de nuit (GitHub Action, en-tête x-cron-secret) : faits, plan, exécution
// POST { action, … }                admin : apercu, appliquer, etape, retirer, tout_retirer, reessayer, mode, reglages,
//                                   reconcilier, faits. appliquer, retirer, tout_retirer et reessayer enregistrent le passage
//                                   et rendent la main ; le navigateur le fait avancer par « etape » (chaque appel sous 10 s).
// Toute écriture Odoo passe par _peremption.js (deux verrous : PEREMPTION_ODOO_ECRITURE=1 et mode « Actif »).
// creerHandler(deps) : peremption, verifyAdmin et isCronAuthorized injectables (scripts/test-peremption-odoo.mjs,
// scripts/test-securite-2.mjs).
import { getCors } from "./cors.js";
import { verifyAdmin, isCronAuthorized } from "./auth.js";
import { creerPeremption, MODES } from "./_peremption.js";

const CIP = /^\d{7,14}$/;
const court = (e) => String(e?.message || e || "").replace(/\s+/g, " ").slice(0, 300);
const cipsDe = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : []).filter(c => CIP.test(c));
const entier = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };

export function creerHandler(deps = {}) {
  let P = deps.peremption || null;
  const module = () => (P ||= creerPeremption(deps));
  const verifier = deps.verifyAdmin || verifyAdmin;
  const cron = deps.isCronAuthorized || isCronAuthorized;
  return async (event) => {
    const cors = { ...getCors(event), "Cache-Control": "no-store" };
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
    const rep = (statusCode, corps) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(corps) });
    const q = event.queryStringParameters || {};
    try {
      if (event.httpMethod === "GET" && q.action === "page") return rep(200, await module().etatPublic());
      if (event.httpMethod === "GET" && q.step === "nuit") {
        if (!cron(event)) return rep(403, { error: "réservé à la chaîne de nuit (x-cron-secret)" });
        try { return rep(200, await module().passageNuit({ offset: Math.max(0, entier(q.offset) ?? 0) })); }
        catch (e) {
          // pas encore installé (sql/peremption.sql, clé service_role) : la chaîne de nuit continue sans échec
          if (e?.code === "configuration" || e?.pg === "42P01") return rep(200, { done: true, ignore: `péremption non installée : ${court(e)}` });
          throw e;
        }
      }
      const auth = await verifier(event);
      if (auth.error) return { ...auth.error, headers: { ...(auth.error.headers || {}), ...cors } };
      const acteur = String(auth.admin?.email || "admin").toLowerCase();
      const M = module();
      if (event.httpMethod === "GET") {
        switch (q.action) {
          case "admin": return rep(200, await M.etatAdmin());
          case "journal": return rep(200, { lignes: await M.journalDe({ cip: CIP.test(String(q.cip || "")) ? q.cip : null, limit: q.limit }) });
          case "droits": return rep(200, await M.droits({ acteur }));
          case "ecarts": return rep(200, await M.ecarts({ depuis: /^\d{4}-\d{2}-\d{2}$/.test(String(q.depuis || "")) ? q.depuis : undefined, offset: Math.max(0, entier(q.offset) ?? 0) }));
          case "retrait_apercu": {
            const cips = q.cips ? cipsDe(String(q.cips).split(",")) : null;
            return rep(200, await M.apercuRetrait({ cips: cips?.length ? cips : null }));
          }
          default: return rep(400, { error: "action inconnue" });
        }
      }
      if (event.httpMethod !== "POST") return rep(405, { error: "GET ou POST" });
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch { return rep(400, { error: "corps illisible" }); }
      if (!b || typeof b !== "object") return rep(400, { error: "corps illisible" });
      const remise = entier(b.remise_pct);
      const parCip = (o, f) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([c]) => CIP.test(c)).map(([c, v]) => [c, f(v)]));
      switch (b.action) {
        case "apercu": {
          const cips = cipsDe(b.cips);
          if (!cips.length || cips.length > 200) return rep(400, { error: "cips : 1 à 200 CIP" });
          if (remise == null || remise < 1 || remise > 90) return rep(400, { error: "remise_pct : entier de 1 à 90 (0 : utiliser « Retirer »)" });
          return rep(200, await M.apercu({ cips, remise, force: parCip(b.force_lot_long, v => (v === false || v == null ? null : Number(v))), sousCout: parCip(b.sous_cout_confirme, v => v === true) }));
        }
        case "appliquer": {
          const cips = cipsDe(b.cips);
          if (!cips.length) return rep(400, { error: "cips : au moins un CIP" });
          if (remise == null || remise < 1 || remise > 90) return rep(400, { error: "remise_pct : entier de 1 à 90 (0 : utiliser « Retirer »)" });
          return rep(200, await M.appliquer({ cips, remise, acteur, force: parCip(b.force_lot_long, v => (v === false || v == null ? null : Number(v))),
            sousCout: parCip(b.sous_cout_confirme, v => v === true), apercus: parCip(b.apercus, v => String(v || "")), confirmationRegles: entier(b.confirmation_regles) }));
        }
        case "etape": {
          if (!/^[0-9a-f-]{36}$/i.test(String(b.passage_id || ""))) return rep(400, { error: "passage_id" });
          return rep(200, await M.etape({ passageId: b.passage_id, acteur }));
        }
        case "retirer": {
          const cips = cipsDe(b.cips);
          if (!cips.length) return rep(400, { error: "cips : au moins un CIP" });
          return rep(200, await M.retirer({ cips, toutDeSuite: b.tout_de_suite === true, acteur }));
        }
        case "tout_retirer": {
          if (b.confirmation !== "RETIRER") return rep(400, { error: "confirmation : saisir RETIRER" });
          return rep(200, await M.retirer({ tout: true, acteur }));
        }
        case "reessayer": {
          if (!CIP.test(String(b.cip || ""))) return rep(400, { error: "cip" });
          return rep(200, await M.reessayer({ cip: String(b.cip), acteur }));
        }
        case "mode": {
          if (!MODES.includes(b.mode)) return rep(400, { error: `mode : ${MODES.join(", ")}` });
          if (b.confirmation !== true) return rep(400, { error: "confirmation requise" });
          return rep(200, await M.changerMode({ mode: b.mode, acteur }));
        }
        case "reglages": return rep(200, await M.changerReglages({ valeurs: b.valeurs, acteur }));
        case "reconcilier": return rep(200, await M.reconcilier({ acteur, etendue: "admin", budgetMs: 7000 }));
        case "faits": {
          // « Actualiser depuis Odoo » : faits frais de la fenêtre et des décisions ouvertes, 25 CIP par appel
          const etat = await M.etatAdmin();
          const cips = etat.produits.map(p => p.cip);
          const de = Math.max(0, entier(b.offset) ?? 0);
          const paquet = cips.slice(de, de + 25);
          const R = etat.reglages;
          const lu = await M.lireFaits(paquet, { listes: R.listes });
          await M.enregistrerFaits(lu.faits);
          const suivant = de + paquet.length;
          return rep(200, { lus: suivant, total: cips.length, next_offset: suivant < cips.length ? suivant : null, absents: lu.absents, douteux: lu.douteux });
        }
        default: return rep(400, { error: "action inconnue" });
      }
    } catch (e) {
      console.error("[peremption]", court(e));
      if (e?.code === "configuration" || e?.pg === "42P01") return rep(503, { error: "non_installe", message: `${court(e)} : la mise en service n'est pas faite (tables Supabase et clé serveur)` });
      return rep(500, { error: court(e) });
    }
  };
}

export const handler = creerHandler();
