// ── Commandes groupées : analyse IA d'un fichier (fonction d'arrière-plan) ─
// Lancée par gp-upload ; lit le fichier dans kv_store (gp_file:<job>) et écrit
// le résultat dans gp_import:<job>. Deux usages :
//  - « offre » : offre d'un laboratoire → produits, prix, remises, UG, RFA, coopération…
//  - « lgo »   : bon de commande exporté du logiciel de la pharmacie → quantités par produit
// Netlify coupe une fonction d'arrière-plan à 15 min : l'appel à l'IA est interrompu
// à 13 min pour avoir le temps d'écrire l'erreur. gp_file:<job> est toujours supprimé.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { isCronAuthorized } from "./auth.js";
import { sb, productInfo } from "./_gp.js";
import { medipimProduct } from "./_medipim.js";
import { kvGet, kvSet, kvDel } from "./_kv.js";

const MODEL = "claude-opus-5-5";
const DEADLINE_MS = 13 * 60 * 1000;
const SETTINGS = {
  offre: { effort: "medium", max_tokens: 64000 },
  lgo:   { effort: "low",    max_tokens: 16000 },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Offer = z.object({
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
    extra_discounts: z.array(z.object({
      mode: z.enum(["aucune", "unitaire", "paliers"]),
      pct: z.number().nullable().describe("Taux en % si la remise ne dépend pas de la quantité"),
      tiers: z.array(z.object({ min_qty: z.number(), pct: z.number() })).describe("Paliers : à partir de min_qty unités, pct %"),
      combine: z.enum(["cascade", "additionnelle"]).describe("cascade = appliquée sur le prix déjà remisé ; additionnelle = taux ajouté au cumul"),
    })).describe("Remises sur facture 2 et 3, dans l'ordre (au plus 2 ; liste vide s'il n'y en a pas)"),
    ug_tiers: z.array(z.object({ min_qty: z.number(), free_qty: z.number() })).describe("Unités gratuites : free_qty offertes pour min_qty facturées"),
    pack_size: z.number().nullable().describe("Colisage : nombre d'unités par colis / carton / PCB si l'offre l'indique, sinon null"),
    pack_rule: z.enum(["aucune", "minimum", "multiple"]).describe("multiple = commandes par colis entiers imposées ; minimum = au moins un colis imposé ; aucune = colisage seulement indicatif ou absent"),
    notes: z.string().nullable(),
  })),
  warnings: z.array(z.string()).describe("Ambiguïtés à vérifier par l'utilisateur"),
});

// « line » : numéro court (1..N) du produit de l'opération, jamais son identifiant en base
export const Lgo = z.object({
  rows: z.array(z.object({
    cip: z.string().nullable().describe("Code du produit tel qu'imprimé (CIP13, CIP7, EAN ou ACL), chiffres uniquement, ou null"),
    name: z.string().describe("Désignation telle qu'écrite dans le document"),
    qty: z.number().describe("Quantité commandée (facturée) en unités"),
    free_qty: z.number().nullable().describe("Unités gratuites (colonne UG) de la ligne si indiquées, sinon null"),
    delivery_date: z.string().nullable().describe("Date de livraison de la ligne si le document en donne une (AAAA-MM-JJ), sinon null"),
    line: z.number().nullable().describe("Numéro du produit de l'opération correspondant (1 à N), ou null si aucun"),
  })),
  warnings: z.array(z.string()),
});

// ── Schéma envoyé à l'API ────────────────────────────────────────────────
// betaZodOutputFormat() convertit le schéma Zod pour les sorties structurées mais
// relègue les « enum » dans la description : le modèle ne serait alors pas contraint.
// On remet chaque enum à sa place (et on retire l'annotation devenue inutile).
function stripTag(node, tag) {
  if (typeof node.description !== "string") return;
  const d = node.description.replace(tag, "").trim();
  if (d) node.description = d; else delete node.description;
}
function restoreEnums(src, dst) {
  if (!src || !dst || typeof src !== "object" || typeof dst !== "object") return;
  if (Array.isArray(src.enum) && !Array.isArray(dst.enum)) {
    dst.enum = src.enum;
    stripTag(dst, `{enum: ${JSON.stringify(src.enum)}}`);
  }
  for (const k of ["properties", "$defs"]) {
    if (src[k] && dst[k]) for (const name of Object.keys(src[k])) restoreEnums(src[k][name], dst[k][name]);
  }
  if (src.items && dst.items) restoreEnums(src.items, dst.items);
  const variants = src.anyOf || src.oneOf;
  if (Array.isArray(variants) && Array.isArray(dst.anyOf)) variants.forEach((v, i) => restoreEnums(v, dst.anyOf[i]));
  if (Array.isArray(src.allOf) && Array.isArray(dst.allOf)) src.allOf.forEach((v, i) => restoreEnums(v, dst.allOf[i]));
}
// Les sorties structurées n'acceptent pas les tableaux de types (« type: ["number","null"] ») : anyOf
function noTypeArrays(n) {
  if (!n || typeof n !== "object") return n;
  if (Array.isArray(n)) return n.map(noTypeArrays);
  const o = {};
  for (const [k, v] of Object.entries(n)) o[k] = k === "type" || k === "enum" ? v : noTypeArrays(v);
  if (Array.isArray(o.type)) { const types = o.type; delete o.type; o.anyOf = types.map(t => ({ type: t })); }
  return o;
}
export function outputSchema(schema) {
  const fmt = betaZodOutputFormat(schema);
  const out = JSON.parse(JSON.stringify(fmt.schema));
  const src = z.toJSONSchema(schema, { reused: "ref" });
  restoreEnums(src, out);
  if (src.$schema) stripTag(out, `{$schema: ${JSON.stringify(src.$schema)}}`);
  return noTypeArrays(out);
}
export const SCHEMAS = { offre: outputSchema(Offer), lgo: outputSchema(Lgo) };

// ── Prompts ──────────────────────────────────────────────────────────────
const OFFER_PROMPT = `Voici une offre commerciale d'un laboratoire pharmaceutique destinée à une commande groupée de pharmacies françaises.
Extrais-en toutes les lignes de produits et les conditions commerciales. Ces données pré-remplissent un formulaire qu'un pharmacien relira : une valeur absente doit rester null plutôt qu'être devinée, et toute ambiguïté doit figurer dans « warnings ».

Repères :
- CIP13 : 13 chiffres commençant généralement par 34009 ; conserve le code tel qu'imprimé (sans espaces).
- Prix brut = prix unitaire HT avant toute remise.
- Remise « sur facture » : jusqu'à 3 remises successives par produit. La 1re va dans discount_* (un seul taux → « unitaire » ; taux dépendant de la quantité → « paliers », un palier par seuil). Les 2e et 3e vont dans extra_discounts, dans l'ordre, chacune avec combine « cascade » (appliquée sur le prix déjà remisé : « 30 % puis 10 % », « remise supplémentaire sur le net ») ou « additionnelle » (taux ajouté au précédent : « 30 % + 10 % = 40 % »). Si le document ne précise pas, mets « cascade » et signale-le dans warnings.
- Unités gratuites : « 12 + 2 », « 2 UG pour 12 achetées », « 14 pour le prix de 12 » s'écrivent tous min_qty 12 / free_qty 2. Si l'offre donne un pourcentage d'UG, convertis-le en paliers seulement s'il est explicite, sinon signale-le.
- Colisage : relève le nombre d'unités par colis (colonne « colisage », « PCB », « carton », « UV », « par 6 »…) dans pack_size. pack_rule = « multiple » si l'offre impose de commander par colis entiers (« par colis de 6 », « multiples de 12 »), « minimum » si elle impose seulement un colis minimum, sinon « aucune ».
- Une remise de fin d'année (RFA) ou une ristourne différée n'est PAS une remise sur facture : mets-la dans rfa_pct.
- Un contrat de coopération commerciale (mise en avant, vitrine, animation contre un montant en €) va dans coop_*.
- Dates au format AAAA-MM-JJ ; si l'année manque, déduis-la du contexte du document et signale-le.`;

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const lgoPrompt = (lines, slots = []) => `Voici un bon de commande exporté du logiciel de gestion (LGO) d'une pharmacie.
Relève chaque ligne de produit commandé : le code tel qu'imprimé (CIP13, CIP7, EAN ou ACL, chiffres uniquement ; null s'il n'y en a pas), la désignation, la quantité commandée, les unités gratuites (colonne « UG » ou « Qté Ug », null si vide ou « - ») et la date de livraison de la ligne.
Un bon peut être échelonné : le même produit apparaît alors plusieurs fois, une fois par date de livraison. Relève chaque ligne séparément avec sa propre date, sans additionner. Les dates du document sont au format français (JJ/MM/AA ou JJ/MM/AAAA) : écris-les en AAAA-MM-JJ. Ignore les lignes de sous-total et de total.${slots.length ? `
Dates de livraison prévues par l'opération : ${slots.map(s => s.date).join(", ")}.` : ""}
Indique dans « line » le numéro du produit de l'opération ci-dessous qui correspond (même code, ou même produit si le code diffère), ou null si le produit ne fait pas partie de l'opération : la pharmacie verra la liste des produits non reconnus.
La quantité est un nombre d'unités (boîtes) : si le document indique des colis ou des lots, convertis-les seulement si le conditionnement est écrit, sinon signale-le dans « warnings ».

Produits de l'opération (numéro | CIP | désignation) :
${lines.map((l, i) => `${i + 1} | ${oneLine(l.cip)} | ${oneLine(l.name)}`).join("\n")}`;

// ── Lecture de la réponse du modèle ─────────────────────────────────────
// stop_reason d'abord (un refus ou une coupure laisse un JSON partiel), puis les
// blocs texte seulement (les blocs thinking / fallback ne portent pas la réponse ;
// après un relais « fallback » en cours de réponse, le texte se poursuit bout à bout).
export function readModelOutput(msg, schema) {
  const stop = msg?.stop_reason;
  if (stop === "refusal") throw new Error("L'IA a refusé d'analyser ce document");
  if (stop === "max_tokens" || stop === "model_context_window_exceeded") throw new Error("Document trop long : découpez-le");
  const text = (msg?.content || []).filter(b => b.type === "text").map(b => b.text || "").join("");
  if (!text.trim()) throw new Error("L'IA n'a renvoyé aucun résultat : réessayez");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Réponse de l'IA illisible : réessayez"); }
  const r = schema.safeParse(data);
  if (!r.success) {
    console.error("gp-extract : réponse non conforme", JSON.stringify(r.error.issues).slice(0, 2000));
    throw new Error("Réponse de l'IA incomplète ou non conforme : réessayez");
  }
  return r.data;
}

// ── Bon LGO : rattachement des lignes aux produits de l'opération ───────
// Déterministe d'abord : CIP13 exact, puis CIP7 (CIP13 34009… → chiffres 6 à 12),
// puis EAN/ACL écrit sur une autre longueur (GTIN-14, UPC-12). Le numéro proposé
// par l'IA ne sert qu'en dernier recours ; s'il contredit un code reconnu, le code gagne.
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const normCode = (s) => { const d = digits(s); return d.length === 14 && d[0] === "0" ? d.slice(1) : d; };
const cip7Of = (d) => (d.length === 13 && d.startsWith("34009") ? d.slice(5, 12) : d.length === 7 ? d : null);
const eanVariants = (d) => (d.length === 12 ? ["0" + d] : d.length === 13 && d[0] === "0" ? [d.slice(1)] : []);

// slots : dates de livraison de l'opération [{ id, date }] ; chaque ligne va sur la date identique,
// sinon la plus proche (avec avertissement) ; sans date dans le document : « _auto » (l'écran choisit).
export function matchLgo(out, lines, slots = []) {
  const L = lines || [];
  const exact = new Map(), byCip7 = new Map(), byEan = new Map();
  const add = (m, k, i) => { if (!k) return; const a = m.get(k); if (a) { if (!a.includes(i)) a.push(i); } else m.set(k, [i]); };
  L.forEach((l, i) => {
    const d = normCode(l.cip);
    if (d.length < 7) return;
    add(exact, d, i);
    add(byCip7, cip7Of(d), i);
    for (const v of eanVariants(d)) add(byEan, v, i);
  });
  const byCode = (d) => {
    if (d.length < 7) return null;
    if (d.length === 13 && exact.has(d)) return exact.get(d);   // CIP13 / EAN13 / ACL13 identiques
    const c7 = cip7Of(d);
    if (c7 && byCip7.has(c7)) return byCip7.get(c7);            // CIP7 ↔ CIP13
    if (exact.has(d)) return exact.get(d);                      // autre code identique (EAN-8…)
    for (const v of eanVariants(d)) if (exact.has(v)) return exact.get(v);
    return byEan.get(d) || null;                                // EAN/ACL sur une autre longueur
  };

  const qty = {}, grid = {}, seen = {}, unmatchedBy = new Map(), warnings = [...(out?.warnings || [])];
  const S = (slots || []).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)));
  const dayMs = (d) => Date.parse(d + "T12:00:00Z");
  const slotFor = (date, name) => {
    if (!S.length) return "_auto";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : null;
    if (!d) return "_auto";
    const same = S.find(s => s.date === d);
    if (same) return same.id;
    const near = [...S].sort((a, b) => Math.abs(dayMs(a.date) - dayMs(d)) - Math.abs(dayMs(b.date) - dayMs(d)))[0];
    warnings.push(`« ${name} » : livraison demandée le ${d.split("-").reverse().join("/")}, date non prévue par l'opération ; placée sur la livraison du ${near.date.split("-").reverse().join("/")}, à vérifier.`);
    return near.id;
  };
  let freeTotal = 0;
  for (const r of out?.rows || []) {
    const billed = Number.isFinite(r.qty) ? Math.max(0, Math.round(r.qty)) : 0;
    const free = Number.isFinite(r.free_qty) ? Math.max(0, Math.round(r.free_qty)) : 0;
    const q = billed;          // quantités de l'opération = unités facturées ; le site calcule lui-même les UG de l'offre
    freeTotal += free;
    const d = normCode(r.cip);
    const name = oneLine(r.name) || (d ? `code ${d}` : "produit sans nom");
    const k = Number.isInteger(r.line) && r.line >= 1 && r.line <= L.length ? r.line - 1 : null;
    const cands = byCode(d);
    let i = null;
    if (cands) {
      i = k != null && cands.includes(k) ? k : cands[0];
      if (cands.length > 1 && !(k != null && cands.includes(k))) warnings.push(`« ${name} » : plusieurs produits de l'opération portent le code ${d} ; rattaché à « ${L[i].name} », à vérifier.`);
      if (k != null && !cands.includes(k)) warnings.push(`« ${name} » (code ${d}) : l'IA proposait « ${L[k].name} », mais le code correspond à « ${L[i].name} » : rattaché d'après le code, à vérifier.`);
    } else if (k != null) {
      i = k;
      if (d.length >= 7) warnings.push(`« ${name} » : le code ${d} ne figure pas dans l'opération ; rattaché par l'IA à « ${L[k].name} » (CIP ${L[k].cip}), à vérifier.`);
    }
    if (i != null) {
      const id = L[i].id;
      qty[id] = (qty[id] || 0) + q;
      seen[id] = (seen[id] || 0) + 1;
      const slot = slotFor(r.delivery_date, name);
      (grid[id] ||= {})[slot] = (grid[id][slot] || 0) + q;
    } else {
      const key = d || name.toLowerCase();
      const u = unmatchedBy.get(key);
      if (u) u.qty += q; else unmatchedBy.set(key, { cip: d || null, name, qty: q });
    }
  }
  for (const l of L) if (seen[l.id] > 1 && Object.keys(grid[l.id] || {}).length < seen[l.id]) warnings.push(`« ${l.name} » apparaît ${seen[l.id]} fois pour une même date de livraison : quantités additionnées.`);
  if (freeTotal > 0) warnings.push(`${freeTotal} unité(s) gratuite(s) indiquée(s) sur le bon non reprise(s) : le site ajoute automatiquement les gratuités prévues par l'offre.`);
  return { qty, grid, unmatched: [...unmatchedBy.values()], warnings };
}

// ── Messages d'erreur ────────────────────────────────────────────────────
const TOO_LONG = "Analyse trop longue : découpez le document ou réessayez plus tard";
function explain(e) {
  if (e instanceof Anthropic.APIUserAbortError) return TOO_LONG;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Accès au service d'IA refusé : vérifiez la clé ANTHROPIC_API_KEY";
  if (e instanceof Anthropic.RateLimitError) return "Service d'IA saturé : réessayez dans quelques minutes";
  if (e instanceof Anthropic.APIConnectionError) return "Service d'IA injoignable : réessayez dans quelques minutes";
  if (e instanceof Anthropic.BadRequestError) return `Document refusé par le service d'IA (format, taille ou nombre de pages) : ${String(e.error?.error?.message || e.message).slice(0, 200)}`;
  if (e instanceof Anthropic.APIError && (!e.status || e.status >= 500)) return "Service d'IA momentanément indisponible : réessayez dans quelques minutes";
  return e?.message || String(e);
}

// ── Kv_store ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (!isCronAuthorized(event)) return { statusCode: 403, body: "" };
  let job = null;
  try { job = JSON.parse(event.body || "{}").job; } catch { /* corps illisible */ }
  if (!job || !UUID.test(String(job))) return { statusCode: 400, body: "" };
  const importKey = `gp_import:${job}`, fileKey = `gp_file:${job}`;
  const ac = new AbortController();
  let timer = null, base = null;
  try {
    base = await kvGet(importKey);
    // introuvable, déjà terminée ou marquée interrompue : ne rien réécrire
    if (!base || base.status !== "en_cours") return { statusCode: 200, body: "" };
    const f = await kvGet(fileKey);
    if (!f) throw new Error("Fichier introuvable : relancez l'analyse");
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Clé ANTHROPIC_API_KEY absente des variables Netlify");
    const kind = f.kind === "lgo" ? "lgo" : "offre";

    const content = [];
    if (f.data_base64 && f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data_base64 } });
    else if (f.data_base64) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data_base64 } });
    else content.push({ type: "text", text: `<document nom="${oneLine(f.file_name).replace(/["<>]/g, "")}">\n${f.text || ""}\n</document>` });
    content.push({ type: "text", text: kind === "lgo" ? lgoPrompt(f.lines || [], f.slots || []) : OFFER_PROMPT });

    const { effort, max_tokens } = SETTINGS[kind];
    const client = new Anthropic();
    timer = setTimeout(() => ac.abort(), DEADLINE_MS);
    const msg = await client.beta.messages.stream({
      model: MODEL,
      max_tokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema: SCHEMAS[kind] } },
      messages: [{ role: "user", content }],
    }, { signal: ac.signal }).finalMessage();
    clearTimeout(timer);
    timer = null;
    const out = readModelOutput(msg, kind === "lgo" ? Lgo : Offer);

    if (kind === "lgo") {
      await kvSet(importKey, { ...base, status: "termine", result: matchLgo(out, f.lines || [], f.slots || []), finished_at: new Date().toISOString() });
    } else {
      const lines = out.lines.map(l => ({ ...l, cip: digits(l.cip) })).filter(l => l.cip || l.name);
      const products = await productInfo(lines.map(l => l.cip)).catch(() => ({}));
      // produits absents d'Odoo : nom, TVA et prix public pris dans Medipim (la fiche Odoo sera créée à l'enregistrement)
      for (const l of lines.slice(0, 150)) {
        if (!l.cip || products[l.cip]?.odoo_product_id) continue;
        const m = await medipimProduct(l.cip).catch(() => null);
        if (m) products[l.cip] = { ...(products[l.cip] || {}), medipim: m };
      }
      await kvSet(importKey, { ...base, status: "termine", result: { ...out, lines }, products, finished_at: new Date().toISOString() });
    }
  } catch (e) {
    const error = ac.signal.aborted ? TOO_LONG : explain(e);   // seul le minuteur de 13 min peut interrompre
    console.error("gp-extract", job, e);
    try {
      if (!base) base = await kvGet(importKey);
      if (base) await kvSet(importKey, { ...base, status: "erreur", error, finished_at: new Date().toISOString() });
    } catch (e2) { console.error("gp-extract : statut non enregistré", job, e2); }
  } finally {
    if (timer) clearTimeout(timer);
    await kvDel(fileKey).catch(() => {});
  }
  return { statusCode: 200, body: "" };
};
