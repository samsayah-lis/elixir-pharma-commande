// ── Assistant Elixir : remise d'un fichier (duplicata de facture, relevé) ──
// GET ?id=<hex32> (+ pour_odoo_id pour l'admin « pour une pharmacie ») ; Authorization: Bearer (jeton pharmacie,
// ou admin_token). Contrat : docs/assistant-contrat.md (« API HTTP ») ; conception § 2.7.
//   1. identité revérifiée (identifier : jeton, e-mail confirmé, fiche contrôlée dans Odoo) ;
//   2. autorisation consommée (chat_fichiers : 15 min, 3 usages, liée à LA fiche ; sinon 404, même réponse) ;
//   3. propriété REVÉRIFIÉE dans Odoo (domaine factures de la fiche) avant toute lecture ;
//   4. facture / avoir : PDF d'origine d'Odoo TEL QUEL (pièce jointe invoice_pdf_report_id), sans tampon
//      (décision du 16/10/2026) ; relevé : généré à la volée (PDF ou Excel), rien n'est stocké.
// Réponse : attachment, no-store, nosniff, corps en base64. Aperçus Netlify : aucun fichier (404).
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { identifier, pdfPiece, donneesReleve, jourValide } from "./_chat-perimetre.js";
import { calculerReleve, releveXlsx, relevePdf, nomFichierReleve } from "./_chat-releve.js";
import { journalJson } from "./_chat-config.js";

const APERCU = /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/;
const HEX32 = /^[0-9a-f]{32}$/;
const MIME = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

// deps = { stock (fichiers.consommer), odoo, sb, verifierJeton, utilisateur, maintenant } — injectables pour les tests
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

  let ctx;
  try { ctx = await identifier(event, { pour_odoo_id: q.pour_odoo_id }, deps); }
  catch (e) {
    if (e?.identite) return json(e.status, { error: e.code === "admin_fiche" ? "fiche" : e.code });
    journalJson({ evt: "fichier", code: "identite_erreur", type: String(e?.name || "Error").slice(0, 40) });
    return json(503, { error: "indisponible" });
  }
  if (ctx.mode !== "complet") return introuvable();

  try {
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
    } else return introuvable();
    journalJson({ evt: "fichier", type: auto.type, code: "ok", admin: !!ctx.admin, duree_ms: Date.now() - t0 });
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
