// Lectures limitées à l'identité du compte CRM relu par le serveur, jamais au corps client.
import { odoo } from "./_odoo-rpc.js";
import { erreurCrm } from "./_crm-stock.js";
export function creerDocumentsCrm(deps = {}) {
  const maintenant = deps.maintenant || (() => new Date());
  return {
    async commandes(compte) {
      if (!compte.cip) return [];
      const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.cle ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !cle) throw erreurCrm(503, "Commandes indisponibles.");
      try {
        const p = new URLSearchParams({ pharmacy_cip: `eq.${compte.cip}`, select: "id,date,total_ht,nb_lignes,processed,source", order: "date.desc,id.desc", limit: "50" });
        const res = await (deps.fetch || fetch)(`${url}/rest/v1/elixir_orders?${p}`, {
          headers: { apikey: cle, Authorization: `Bearer ${cle}` }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error("lecture refusée");
        const rows = await res.json(); if (!Array.isArray(rows)) throw new Error("réponse illisible");
        return rows.slice(0, 50).map(r => ({ id: r.id, date: r.date, montant_ht: r.total_ht, lignes: r.nb_lignes, traite: r.processed, source: r.source }));
      } catch { throw erreurCrm(503, "Commandes momentanément indisponibles."); }
    },
    async factures(compte) {
      if (!compte.odoo_id) return [];
      const fin = maintenant().toISOString().slice(0, 10), debut = new Date(`${fin.slice(0, 7)}-01T00:00:00Z`);
      debut.setUTCFullYear(debut.getUTCFullYear() - 1);
      const dernierJour = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + 1, 0)).getUTCDate();
      debut.setUTCDate(Math.min(Number(fin.slice(8)), dernierJour));
      const domaine = [["company_id", "=", 2], ["state", "=", "posted"], ["move_type", "in", ["out_invoice", "out_refund"]],
        ["partner_id.commercial_partner_id", "=", compte.odoo_id], ["invoice_date", ">=", debut.toISOString().slice(0, 10)], ["invoice_date", "<=", fin]];
      const champs = ["name", "invoice_date", "move_type", "amount_untaxed", "is_move_sent"], resultats = [];
      try {
        for (let offset = 0; ; offset += 500) {
          const rows = await (deps.odoo || odoo)("account.move", "search_read", [domaine], {
            fields: champs, order: "invoice_date desc,id desc", offset, limit: 500, context: { allowed_company_ids: [2] },
          }, { timeoutMs: 6000 });
          if (!Array.isArray(rows)) throw new Error("réponse illisible");
          resultats.push(...rows.map(r => ({ id: r.id, numero: r.name, date: r.invoice_date, type: r.move_type,
            montant_ht: (r.move_type === "out_refund" ? -1 : 1) * Math.abs(Number(r.amount_untaxed)), envoye: r.is_move_sent === true })));
          if (rows.length < 500) return resultats;
        }
      } catch { throw erreurCrm(503, "Factures momentanément indisponibles."); }
    },
  };
}
