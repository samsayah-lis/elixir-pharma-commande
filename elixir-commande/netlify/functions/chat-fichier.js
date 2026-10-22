// ── Assistant Elixir : remise d'un fichier (duplicata de facture, relevé, bons de livraison) ──
// GET ?id=<hex32> (+ n=<rang> pour un seul des bons de livraison autorisés ; + pour_odoo_id pour l'admin « pour une
// pharmacie ») ; Authorization: Bearer (jeton pharmacie, ou admin_token). Contrat : docs/assistant-contrat.md (« API HTTP ») ;
// conception § 2.7.
//   1. identité revérifiée (identifier : jeton, e-mail confirmé, fiche contrôlée dans Odoo) ;
//   2. autorisation LUE d'abord sans être consommée (chat_fichiers, liée à LA fiche ; sinon 404, même réponse) : rang d'un
//      bon hors bornes → 404 sans brûler d'usage ; premier téléchargement d'une liste de bons → quota de fichiers sur 24 h
//      contrôlé ici (429), car la liste elle-même ne le consomme pas ; puis usage consommé (15 min, 3 usages — bons de
//      livraison : 3 par bon de la page et 3 pour l'ensemble, 60 au plus) ;
//   3. propriété REVÉRIFIÉE dans Odoo (domaine factures, ou livraisons, de la fiche) avant toute lecture ;
//   4. facture / avoir : PDF d'origine d'Odoo TEL QUEL (pièce jointe invoice_pdf_report_id), sans tampon
//      (décision du 16/10/2026) ; relevé : généré à la volée (PDF ou Excel), rien n'est stocké ;
//   5. bon de livraison : TOUS les bons de l'autorisation sont relus avec le domaine de la fiche (un seul manquant → 404),
//      puis ceux à servir le sont encore à la lecture ; « Duplicata de bon de livraison » généré à la volée (_chat-bl.js),
//      pour un bon (?n=<rang>) ou pour tous ceux de l'autorisation en un seul PDF (60 au plus). Odoo ne garde pas le PDF
//      d'un BL et son calcul est interdit par l'API : une seule présentation pour tous les BL, aucune pièce jointe lue
//      (décision par défaut du 22/10/2026, révisable par Zineb : voir la conception § 2.12).
// Réponse : attachment, no-store, nosniff, corps en base64. Aperçus Netlify : aucun fichier (404).
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { identifier, pdfPiece, donneesReleve, jourValide, donneesLivraisons, livraisonsDeLaFiche, BL_MAX_FICHIER } from "./_chat-perimetre.js";
import { calculerReleve, releveXlsx, relevePdf, nomFichierReleve } from "./_chat-releve.js";
import { blPdf, nomFichierBl } from "./_chat-bl.js";
import { journalJson, fusionnerReglages, lireReglages, REGLAGES_DEFAUT } from "./_chat-config.js";

const APERCU = /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/;
const HEX32 = /^[0-9a-f]{32}$/;
const MIME = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

// Bons de livraison : quota de fichiers sur 24 h glissantes au premier téléchargement d'une autorisation (même règle et même
// message que _chat-outils.js, quotaFichiers) → message, ou null
async function quotaBons(ctx, deps) {
  if (!deps.stock?.compter?.fichiers) return null;
  const R = deps.reglages ? fusionnerReglages(deps.reglages) : deps.stock?.reglages?.lire ? await lireReglages(deps).catch(() => fusionnerReglages(null))
    : fusionnerReglages(REGLAGES_DEFAUT);
  const max = Number(R.quotas?.fichiers_jour);
  if (!Number.isFinite(max)) return null;
  const maintenant = deps.maintenant ? deps.maintenant() : new Date();
  const n = await deps.stock.compter.fichiers(ctx.odooId, new Date(maintenant.getTime() - 86400e3).toISOString());
  const deja = Array.isArray(n) ? n.length : Number(n) || 0;
  return deja + 1 > max ? `Limite de ${max} fichiers par 24 heures atteinte. Réessayez plus tard ou appelez Elixir au ${R.telephone}.` : null;
}
const idsAutorises = (params) => {
  const ids = Array.isArray(params?.picking_ids) ? params.picking_ids.map(Number) : [];
  return !ids.length || ids.length > BL_MAX_FICHIER || ids.some(x => !Number.isInteger(x) || x <= 0) ? null : ids;
};

// deps = { stock (fichiers.lire, fichiers.consommer, compter.fichiers), odoo, sb, verifierJeton, utilisateur, maintenant,
// reglages } — injectables pour les tests
export async function traiter(event, deps = {}) {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  const introuvable = () => json(404, { error: "introuvable" });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Méthode non autorisée" });
  const t0 = Date.now();
  if (APERCU.test(String(event.headers?.host || "").toLowerCase())) return introuvable();
  const limite = rateLimit(event, 30, 60);
  if (limite) return { ...limite, headers: { ...cors, ...limite.headers, "Cache-Control": "no-store" } };
  const q = event.queryStringParameters || {};
  const id = String(q.id || "").toLowerCase();
  if (!HEX32.test(id)) return introuvable();
  // rang d'un bon de livraison parmi ceux de l'autorisation (absent : tous les bons, en un seul PDF)
  const rang = q.n === undefined || q.n === null || q.n === "" ? null : String(q.n);
  if (rang !== null && !/^\d{1,2}$/.test(rang)) return introuvable();

  let ctx;
  try { ctx = await identifier(event, { pour_odoo_id: q.pour_odoo_id }, deps); }
  catch (e) {
    if (e?.identite) return json(e.status, { error: e.code === "admin_fiche" ? "fiche" : e.code });
    journalJson({ evt: "fichier", code: "identite_erreur", type: String(e?.name || "Error").slice(0, 40) });
    return json(503, { error: "indisponible" });
  }
  if (ctx.mode !== "complet") return introuvable();

  try {
    // lecture sans consommer : rang hors bornes et quota des bons refusés avant de compter l'usage
    if (deps.stock.fichiers.lire) {
      const lu = await deps.stock.fichiers.lire(id, ctx.odooId);
      if (!lu || Number(lu.odoo_id) !== Number(ctx.odooId)) return introuvable();
      if (lu.type === "bl") {
        const ids = idsAutorises(typeof lu.params === "string" ? JSON.parse(lu.params || "{}") : lu.params);
        if (!ids || (rang !== null && Number(rang) >= ids.length)) return introuvable();
        if (!(Number(lu.usages) > 0)) {
          const quota = await quotaBons(ctx, deps);
          if (quota) return json(429, { error: "quota", message: quota });
        }
      }
    }
    const auto = await deps.stock.fichiers.consommer(id, ctx.odooId);
    if (!auto || Number(auto.odoo_id) !== Number(ctx.odooId)) return introuvable();
    const params = typeof auto.params === "string" ? JSON.parse(auto.params || "{}") : auto.params || {};
    let nom, mime, base64;
    if (auto.type === "facture") {
      const f = await pdfPiece(ctx, params.move_id, deps);
      if (!f) return introuvable();
      nom = `Duplicata_${f.numero.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`;
      mime = MIME.pdf; base64 = f.base64;
    } else if (auto.type === "releve") {
      const format = params.format === "xlsx" ? "xlsx" : "pdf";
      if (!jourValide(params.debut) || !jourValide(params.fin) || params.debut > params.fin) return introuvable();
      const detail = params.detail === "par_produit" ? "par_produit" : "par_document";
      const rel = calculerReleve(await donneesReleve(ctx, params.debut, params.fin, { parProduit: detail === "par_produit" }, deps));
      const opts = { debut: params.debut, fin: params.fin, detail, pharmacie: { nom: ctx.nom, cip: ctx.cip, ville: ctx.ville },
        edite: deps.maintenant ? deps.maintenant() : new Date() };
      const contenu = format === "xlsx" ? releveXlsx(rel, opts) : await relevePdf(rel, opts);
      nom = nomFichierReleve(params.debut, params.fin, format);
      mime = MIME[format]; base64 = Buffer.from(contenu).toString("base64");
    } else if (auto.type === "bl") {
      const ids = idsAutorises(params);
      if (!ids || (rang !== null && Number(rang) >= ids.length)) return introuvable();
      if (!(await livraisonsDeLaFiche(ctx, ids, deps))) return introuvable();   // toute l'autorisation, même pour un seul bon
      const bons = await donneesLivraisons(ctx, rang === null ? ids : [ids[Number(rang)]], deps);   // relus encore une fois
      if (!bons) return introuvable();
      nom = nomFichierBl(bons);
      mime = MIME.pdf;
      base64 = Buffer.from(await blPdf(bons, { edite: deps.maintenant ? deps.maintenant() : new Date() })).toString("base64");
    } else return introuvable();
    journalJson({ evt: "fichier", type: auto.type, code: "ok", admin: !!ctx.admin, duree_ms: Date.now() - t0, ...(auto.type === "bl" ? { bons: rang === null ? "tous" : "un" } : {}) });
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": mime, "Content-Disposition": `attachment; filename="${nom}"`, "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Access-Control-Expose-Headers": "Content-Disposition" },
      body: base64, isBase64Encoded: true,
    };
  } catch (e) {
    journalJson({ evt: "fichier", code: "erreur", type: String(e?.name || "Error").slice(0, 40), duree_ms: Date.now() - t0 });
    return json(502, { error: "indisponible" });
  }
}

export const handler = async (event) => {
  const { creerStock } = await import("./_chat-stock.js");
  return traiter(event, { stock: creerStock() });
};
