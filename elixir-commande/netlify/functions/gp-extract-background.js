// ── Commandes groupées : analyse IA d'un fichier (fonction d'arrière-plan) ─
// Lancée par gp-upload ; lit le fichier dans kv_store (gp_file:<job>) et écrit
// le résultat dans gp_import:<job>. Deux usages :
//  - « offre » : offre d'un laboratoire → produits, prix, remises, UG, RFA, coopération…
//  - « lgo »   : bon de commande exporté du logiciel de la pharmacie → quantités par produit
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { isCronAuthorized } from "./auth.js";
import { sb, productInfo } from "./_gp.js";

const MODEL = "claude-opus-5-5";

const Offer = z.object({
  operation_name: z.string().nullable().describe("Intitulé court de l'offre, ex. « Opération hiver Pfizer 2026 »"),
  supplier_name: z.string().nullable().describe("Laboratoire ou fournisseur émetteur de l'offre"),
  start_date: z.string().nullable().describe("Début de validité, AAAA-MM-JJ"),
  end_date: z.string().nullable().describe("Fin de validité / date limite de commande, AAAA-MM-JJ"),
  delivery_dates: z.array(z.string()).describe("Dates de livraison prévues (cadencement), AAAA-MM-JJ"),
  rfa_pct: z.number().nullable().describe("Remise de fin d'année en %"),
  coop_mode: z.enum(["aucune", "par_pharmacie", "total"]).describe("Contrat de coopération commerciale : montant par pharmacie, montant global, ou aucun"),
  coop_amount: z.number().nullable().describe("Montant de la coopération commerciale en €"),
  coop_label: z.string().nullable().describe("Contrepartie de la coopération, ex. « mise en avant en vitrine »"),
  objective_type: z.enum(["aucun", "unites", "montant_brut", "montant_net"]).describe("Objectif global à atteindre s'il y en a un"),
  objective_value: z.number().nullable(),
  conditions_text: z.string().nullable().describe("Résumé en français des conditions commerciales, franco, minimum de commande…"),
  lines: z.array(z.object({
    cip: z.string().describe("Code CIP13 (ou CIP7/EAN) tel qu'imprimé, chiffres uniquement"),
    name: z.string().describe("Désignation du produit"),
    price_gross: z.number().nullable().describe("Prix unitaire HT brut avant remise (PFHT / prix catalogue)"),
    discount_mode: z.enum(["aucune", "unitaire", "paliers"]),
    discount_pct: z.number().nullable().describe("Remise sur facture en % si elle ne dépend pas de la quantité"),
    discount_tiers: z.array(z.object({ min_qty: z.number(), pct: z.number() })).describe("Paliers de remise : à partir de min_qty unités, pct %"),
    ug_tiers: z.array(z.object({ min_qty: z.number(), free_qty: z.number() })).describe("Unités gratuites : free_qty offertes pour min_qty facturées"),
    notes: z.string().nullable(),
  })),
  warnings: z.array(z.string()).describe("Ambiguïtés à vérifier par l'utilisateur"),
});

const Lgo = z.object({
  rows: z.array(z.object({
    cip: z.string().nullable().describe("Code CIP/EAN du document, chiffres uniquement"),
    name: z.string().describe("Désignation telle qu'écrite dans le document"),
    qty: z.number().describe("Quantité commandée en unités"),
    line_id: z.string().nullable().describe("id du produit de l'opération correspondant, ou null si aucun"),
  })),
  warnings: z.array(z.string()),
});

const OFFER_PROMPT = `Voici une offre commerciale d'un laboratoire pharmaceutique destinée à une commande groupée de pharmacies françaises.
Extrais-en toutes les lignes de produits et les conditions commerciales. Ces données pré-remplissent un formulaire qu'un pharmacien relira : une valeur absente doit rester null plutôt qu'être devinée, et toute ambiguïté doit figurer dans « warnings ».

Repères :
- CIP13 : 13 chiffres commençant généralement par 34009 ; conserve le code tel qu'imprimé (sans espaces).
- Prix brut = prix unitaire HT avant toute remise.
- Remise « sur facture » : un seul taux → discount_mode « unitaire » ; taux dépendant de la quantité → « paliers » avec un palier par seuil.
- Unités gratuites : « 12 + 2 », « 2 UG pour 12 achetées », « 14 pour le prix de 12 » s'écrivent tous min_qty 12 / free_qty 2. Si l'offre donne un pourcentage d'UG, convertis-le en paliers seulement s'il est explicite, sinon signale-le.
- Une remise de fin d'année (RFA) ou une ristourne différée n'est PAS une remise sur facture : mets-la dans rfa_pct.
- Un contrat de coopération commerciale (mise en avant, vitrine, animation contre un montant en €) va dans coop_*.
- Dates au format AAAA-MM-JJ ; si l'année manque, déduis-la du contexte du document et signale-le.`;

const lgoPrompt = (lines) => `Voici un bon de commande exporté du logiciel de gestion (LGO) d'une pharmacie.
Relève chaque produit commandé avec sa quantité, puis rattache-le au produit correspondant de l'opération ci-dessous (même CIP, ou même produit si le code diffère : CIP7 ↔ CIP13, EAN). Laisse line_id à null si le produit ne fait pas partie de l'opération : la pharmacie verra la liste des produits non reconnus.
La quantité est un nombre d'unités (boîtes) : si le document indique des colis ou des lots, convertis-les seulement si le conditionnement est écrit, sinon signale-le dans « warnings ».

Produits de l'opération :
${lines.map(l => `- id ${l.id} | CIP ${l.cip} | ${l.name}`).join("\n")}`;

const kvSet = (key, value) => sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates", body: { key, value } });
const digits = (s) => String(s || "").replace(/\D/g, "");

export const handler = async (event) => {
  if (!isCronAuthorized(event)) return { statusCode: 403, body: "" };
  const { job } = JSON.parse(event.body || "{}");
  if (!job) return { statusCode: 400, body: "" };
  const [statusRow] = await sb(`kv_store?key=eq.${encodeURIComponent("gp_import:" + job)}&select=value`);
  const base = statusRow?.value || {};
  const done = (v) => kvSet(`gp_import:${job}`, { ...base, ...v, finished_at: new Date().toISOString() });
  try {
    const [fileRow] = await sb(`kv_store?key=eq.${encodeURIComponent("gp_file:" + job)}&select=value`);
    if (!fileRow) throw new Error("Fichier introuvable");
    const f = fileRow.value;
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Clé ANTHROPIC_API_KEY absente des variables Netlify");

    const content = [];
    if (f.data_base64 && f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data_base64 } });
    else if (f.data_base64) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data_base64 } });
    else content.push({ type: "text", text: `<document nom="${f.file_name}">\n${f.text}\n</document>` });
    content.push({ type: "text", text: f.kind === "lgo" ? lgoPrompt(f.lines || []) : OFFER_PROMPT });

    const client = new Anthropic();
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(f.kind === "lgo" ? Lgo : Offer) },
      messages: [{ role: "user", content }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("L'analyse a été refusée par le modèle");
    if (msg.stop_reason === "max_tokens") throw new Error("Document trop long pour être analysé en une fois : découpez-le");
    const out = msg.parsed_output;
    if (!out) throw new Error("Réponse de l'IA illisible");

    if (f.kind === "lgo") {
      const ids = new Set((f.lines || []).map(l => l.id));
      const byCip = Object.fromEntries((f.lines || []).map(l => [digits(l.cip), l.id]));
      const qty = {}, unmatched = [];
      for (const r of out.rows) {
        const id = ids.has(r.line_id) ? r.line_id : byCip[digits(r.cip)] || null;
        const q = Math.max(0, Math.round(r.qty || 0));
        if (id) qty[id] = (qty[id] || 0) + q; else unmatched.push({ cip: r.cip, name: r.name, qty: q });
      }
      await done({ status: "termine", result: { qty, unmatched, warnings: out.warnings } });
    } else {
      const lines = out.lines.map(l => ({ ...l, cip: digits(l.cip) })).filter(l => l.cip || l.name);
      const products = await productInfo(lines.map(l => l.cip)).catch(() => ({}));
      await done({ status: "termine", result: { ...out, lines }, products });
    }
  } catch (e) {
    console.error("gp-extract", e);
    await done({ status: "erreur", error: e.message || String(e) });
  } finally {
    await sb(`kv_store?key=eq.${encodeURIComponent("gp_file:" + job)}`, { method: "DELETE" }).catch(() => {});
  }
  return { statusCode: 200, body: "" };
};
