// ── API des pharmacies : passage planifié (netlify.toml, toutes les 15 min) ──
//  1. liste de prix des accès ouverts relue dans Odoo une fois par jour (property_product_pricelist, société 2 : une
//     lecture pour 200 fiches) ; une liste changée est enregistrée sur l'accès et demandée au calcul ;
//  2. calcul des prix : UNE liste au plus par passage (charge d'Odoo bornée), lancée en arrière-plan (api-prix-background,
//     x-cron-secret) — demandée (nouvel accès, liste changée, bouton de l'admin) : au premier passage ; calcul coupé : repris
//     après 20 min ; en erreur : nouvel essai après 1 h ; à jour : recalculée la nuit (1 h – 6 h, heure de Paris) quand son
//     dernier calcul a plus de 20 h ;
//  3. ménage : compteurs de débit de plus de 2 jours ; journal des appels de plus de 13 mois (une fois par nuit).
// Rien n'est écrit hors des tables privées api_* ; aucune lecture Odoo quand aucun accès n'est ouvert.
import { creerStockApi } from "./_api-stock.js";
import { lecteurOdoo, listesDesFiches } from "./_api-prix.js";
import { PRIX } from "./_api-config.js";
import { lancerCalculPrix, siteBaseEnv } from "./_api-http.js";

export const heureParis = (d) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" })
  .formatToParts(d).find(x => x.type === "hour")?.value);
const age = (iso, now) => (iso ? now.getTime() - Date.parse(iso) : Infinity);

// liste due au calcul ? → priorité (plus petit = plus urgent) ou null
export function priorite(l, now, { nuit }) {
  if (!l) return 0;
  if (l.etat === "a_calculer") return 1;
  if (l.etat === "en_cours") return age(l.debut_le, now) > 20 * 60e3 ? 2 : null;
  if (l.etat === "erreur") return age(l.fin_le, now) > 3600e3 ? 3 : null;
  return nuit && age(l.fin_le, now) > PRIX.age_max_h * 3600e3 ? 4 : null;
}

// deps (doublures des tests) : stock, odoo, maintenant, lancer(listeId), journal
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-cron", ...o })));
  const maintenant = deps.maintenant || (() => new Date());
  return async () => {
    const stock = deps.stock || creerStockApi();
    const now = maintenant();
    const nuit = heureParis(now) >= 1 && heureParis(now) < 6;
    const bilan = { listes_relues: 0, listes_changees: 0, lancee: null };
    try {
      const acces = (await stock.acces.lister()).filter(a => a.actif);
      // 1. listes de prix des fiches, relues une fois par jour
      const aRelire = acces.filter(a => age(a.liste_prix_lue_le, now) > 20 * 3600e3);
      if (aRelire.length) {
        try {
          const lues = await listesDesFiches(lecteurOdoo(deps.odoo, 10000), aRelire.map(a => a.odoo_id));
          for (const a of aRelire) {
            const l = lues.get(a.odoo_id) || null;
            if (!l) continue;
            await stock.acces.modifier(a.odoo_id, { liste_prix_id: l, liste_prix_lue_le: now.toISOString() });
            bilan.listes_relues++;
            if (l !== a.liste_prix_id) { bilan.listes_changees++; a.liste_prix_id = l; }
          }
        } catch (e) { journal({ code: "listes_odoo", erreur: String(e?.message || e).slice(0, 120) }); }
      }
      // 2. une liste au plus par passage
      const ids = [...new Set(acces.map(a => a.liste_prix_id).filter(n => Number.isInteger(n) && n > 0))];
      if (ids.length) {
        const etats = new Map((await stock.prixListes.toutes()).map(l => [l.liste_id, l]));
        const dues = ids.map(id => ({ id, p: priorite(etats.get(id), now, { nuit }) })).filter(x => x.p != null)
          .sort((a, b) => a.p - b.p || age(etats.get(b.id)?.fin_le, now) - age(etats.get(a.id)?.fin_le, now));
        if (dues.length) {
          const id = dues[0].id;
          if (!etats.has(id)) await stock.prixListes.demander(id);
          const raison = await (deps.lancer ? deps.lancer(id) : lancerCalculPrix(siteBaseEnv(), id));
          bilan.lancee = { liste: id, ...(raison ? { echec: raison } : {}) };
        }
      }
      // 3. ménage
      await stock.compteurs.purger().catch(() => {});
      if (heureParis(now) === 3 && now.getUTCMinutes() < 15) {
        const avant = new Date(now.getTime() - 396 * 86400e3).toISOString();   // 13 mois
        await stock.journal.purger(avant).catch((e) => journal({ code: "purge_journal", erreur: String(e?.message || e).slice(0, 80) }));
      }
      journal({ code: "ok", ...bilan });
    } catch (e) {
      journal({ code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 160) });
    }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
