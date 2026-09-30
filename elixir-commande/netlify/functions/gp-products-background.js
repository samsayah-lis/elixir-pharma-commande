// ── Commandes groupées : création des fiches produits manquantes (arrière-plan) ─
// Lancée par gp-admin après l'enregistrement d'une opération. Odoo met ~9 s à créer une
// fiche partagée (taxes par défaut ajoutées pour chaque société du groupe) : impossible dans
// une requête de 10 s. Pour chaque produit sans fiche : Medipim (TVA, CIP7, prix public),
// création si absente (sinon rattachement à la fiche existante), puis lien dans gp_lines.
// Avancement dans kv_store (gp_products:<opération>) ; relance automatique après 13 min.
import { isCronAuthorized } from "./auth.js";
import { sb, eq, loadOperation } from "./_gp.js";
import { kvGet, kvSet } from "./_kv.js";
import { medipimProduct } from "./_medipim.js";
import { ensureOdooProduct } from "./_odoo-products.js";

const BUDGET_MS = 13 * 60e3;
const SITE_HOSTS = ["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"];

export const handler = async (event) => {
  if (!isCronAuthorized(event)) return { statusCode: 403, body: "" };
  const { id } = JSON.parse(event.body || "{}");
  if (!id) return { statusCode: 400, body: "" };
  const key = `gp_products:${id}`;
  const t0 = Date.now();
  const prev = (await kvGet(key).catch(() => null)) || {};
  const report = { status: "en_cours", started_at: prev.started_at || new Date().toISOString(), total: prev.total || 0, done: prev.done || 0,
    created: prev.created || [], linked: prev.linked || [], warnings: prev.warnings || [] };
  const save = () => kvSet(key, { ...report, heartbeat: new Date().toISOString() });
  let remaining = false;
  try {
    // Plusieurs tours : un produit ajouté par un nouvel enregistrement pendant la création est pris aussi
    const tried = new Set();
    for (let round = 0; round < 20 && !remaining; round++) {
      const data = await loadOperation(id);
      if (!data) throw new Error("Opération introuvable");
      // sans prix brut ou sans TVA : pas de fiche (l'enregistrement l'a déjà signalé)
      const todo = data.lines.filter(l => !l.odoo_product_id && !tried.has(l.id) && Number(l.price_gross) > 0 && l.vat_rate != null);
      if (!todo.length) break;
      report.total = report.done + todo.length;
      await save();
      for (const l of todo) {
        if (Date.now() - t0 > BUDGET_MS) { remaining = true; break; }
        tried.add(l.id);
        const label = `${l.name} (${l.cip})`;
        try {
          const m = await medipimProduct(l.cip).catch(() => null);
          const r = await ensureOdooProduct({ cip: l.cip, name: l.name || m?.name, vat: l.vat_rate, list_price: Number(l.price_gross), supplier_id: data.op.supplier_odoo_id || null,
            supplier_price: Number(l.price_gross), cip7: m?.cip7 || (/^34009\d{8}$/.test(l.cip) ? l.cip.slice(5, 12) : null), public_price: m?.public_price || null });
          // la ligne a pu changer de produit entre-temps : on ne relie que si le CIP est toujours le même
          await sb(`gp_lines?id=eq.${l.id}&cip=${eq(l.cip)}&odoo_product_id=is.null`, { method: "PATCH", body: { odoo_product_id: r.id } });
          (r.created ? report.created : report.linked).push({ cip: l.cip, name: l.name, id: r.id });
          if (r.archived) report.warnings.push(`${label} : la fiche Odoo existante est archivée`);
        } catch (e) {
          report.warnings.push(`${label} : création Odoo impossible (${e.message})`);
        }
        report.done++;
        await save();
      }
    }
    report.status = remaining ? "en_cours" : "termine";
  } catch (e) {
    console.error("gp-products", e);
    report.status = "erreur";
    report.error = e.message || String(e);
  }
  report.finished_at = remaining ? null : new Date().toISOString();
  await save().catch(() => {});
  // budget épuisé : relance pour la suite (les fiches déjà créées sont retrouvées, pas de doublon)
  if (remaining) {
    const h = String(event.headers?.host || "").toLowerCase();
    const base = `https://${SITE_HOSTS.includes(h) || /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/.test(h) ? h : SITE_HOSTS[0]}`;
    await fetch(`${base}/.netlify/functions/gp-products-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  return { statusCode: 200, body: "" };
};
