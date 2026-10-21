// ── Essai T1 de « Odoo facture la remise » (docs/peremption-odoo.md, conception § 12.3) : Odoo respecte-t-il les dates ? ──
// Sur la liste 2 « Liste de prix EUR » (société 2 : aucune commande depuis le 12/03/2026, aucun client actif), pour Zinnat 125
// (modèle 44966) : une règle à −10 % avec une date de fin passée, puis une date de fin future, puis une date de début future,
// puis sa suppression. Le rapport des listes d'Odoo doit donner le prix normal, puis −10 %, puis le prix normal, puis le prix
// normal (règle supprimée, search_count = 0).
//
// ÉCRIT DANS ODOO (4 écritures, toutes défaites : la règle est supprimée à la fin, même si un contrôle échoue) : à lancer
// SEULEMENT avec l'accord explicite de Zineb. Les écritures passent par la porte unique de _peremption.js (ecrireOdoo :
// JSON-RPC de _odoo-rpc.js, jamais odoo.js ; verrou PEREMPTION_ODOO_ECRITURE=1 ; ligne d'intention puis de résultat dans
// peremption_journal, journal en panne → aucune écriture). Exception documentée : le mode de l'admin n'est pas lu (l'essai
// précède le mode « Actif ») ; les réglages sont fixés ici { mode: "actif", listes: [2] } et la liste 2 seule est touchée.
// Sans --ecrire, sans PEREMPTION_ODOO_ECRITURE=1 ou sans « --confirmer ZINNAT-LISTE-2 », le script n'appelle pas Odoo et
// affiche le plan.
//   node scripts/essai-dates-peremption.mjs                         → plan seul, aucun appel
//   (dans elixir-commande, clés saisies sans les écrire dans la commande ni l'historique :)
//   read -s ODOO_APIKEY && read -s SUPABASE_SERVICE_ROLE_KEY && export ODOO_APIKEY SUPABASE_SERVICE_ROLE_KEY \
//     && SUPABASE_URL=<adresse Supabase du site> PEREMPTION_ODOO_ECRITURE=1 node scripts/essai-dates-peremption.mjs --ecrire --confirmer ZINNAT-LISTE-2
// (ODOO_URL, ODOO_DB, ODOO_USER : valeurs par défaut de _odoo-rpc.js, compte pharmacien@elixirpharma.fr)
// Résultat à reporter dans l'admin (onglet Péremptions → Réglages → « Odoo respecte les dates » : oui / non).
import { pathToFileURL } from "node:url";
import { valeursRegle, lireRapport, round2, versOdoo, creerPeremption } from "../netlify/functions/_peremption.js";

const H = 3600e3;
const CTX = { allowed_company_ids: [2], company_id: 2, lang: "fr_FR" };
export const CONFIRMATION = "ZINNAT-LISTE-2";
const REGLAGES_T1 = { mode: "actif", listes: [2] };

// odoo(model, method, args, kwargs) injectable (scripts/test-peremption-odoo.mjs : faux Odoo qui respecte, ou non, les dates) ;
// porte : porte d'écriture du module (creerPeremption(...).ecrireOdoo), injectable avec un faux Supabase pour le journal
export async function essaiDates({ odoo, porte = null, ecrire = false, maintenant = () => Date.now(), liste = 2, tmpl = 44966, pid = 44966, pct = 10, journal = console.log } = {}) {
  const t = Math.floor(maintenant() / 1000) * 1000;
  const etapes = [
    { nom: "1. date de fin passée (hier)", vals: { debut: t - 2 * 24 * H, fin: t - 24 * H }, attendu: "normal" },
    { nom: "2. date de fin future (demain)", ecrit: { date_end: t + 24 * H }, attendu: "remise" },
    { nom: "3. date de début future (demain)", ecrit: { date_start: t + 24 * H, date_end: t + 3 * 24 * H }, attendu: "normal" },
  ];
  if (!ecrire) {
    journal(`Plan (aucun appel à Odoo) : liste ${liste}, modèle ${tmpl}, remise ${pct} %`);
    for (const e of etapes) journal(`  ${e.nom} → prix attendu : ${e.attendu === "normal" ? "prix normal" : `−${pct} %`}`);
    journal("  4. suppression → search_count = 0 et prix normal");
    return { plan: true };
  }
  if (!porte) throw new Error("porte d'écriture absente (creerPeremption(...).ecrireOdoo)");
  const ctx = (k = {}) => ({ ...k, context: { ...CTX, ...(k.context || {}) } });
  const trace = (message) => ({ acteur: "essai T1", cip: "3400933121549", pricelist_id: liste, action: "essai_t1", message });
  const ecrit = (pour, method, args, message) => porte(REGLAGES_T1, pour, "product.pricelist.item", method, args, {}, trace(message));
  const prix = async () => lireRapport(await odoo("report.product.report_pricelist", "get_html", [{ active_model: "product.product", active_ids: [pid], pricelist_id: liste, quantities: [1], is_visible_title: false }], ctx()))[pid] ?? null;
  const dateesDuProduit = () => odoo("product.pricelist.item", "search_count", [[["pricelist_id", "=", liste], ["product_tmpl_id", "=", tmpl], ["date_start", "!=", false]]], ctx());
  if (await dateesDuProduit()) throw new Error(`une règle datée existe déjà pour ce produit sur la liste ${liste} : essai arrêté, rien écrit`);
  const [p] = await odoo("product.product", "read", [[pid], ["list_price"]], ctx());
  const normal = await prix();
  const remise = normal == null ? null : Math.min(normal, round2(Number(p.list_price) * (1 - pct / 100)));
  journal(`Prix normal liste ${liste} : ${normal} € ; avec la règle : ${remise} €`);
  const resultats = [];
  let id = null, supprimee = false;
  const v = valeursRegle({ liste, tmpl, percent: pct, debut: etapes[0].vals.debut, fin: etapes[0].vals.fin });
  try {
    [id] = await ecrit("creation", "create", [[v]], `essai T1 : création d'une règle −${pct} % datée (fin hier) sur la liste ${liste}`);
    journal(`  règle créée : n° ${id}`);
    for (const e of etapes) {
      if (e.ecrit) await ecrit("creation", "write", [[id], Object.fromEntries(Object.entries(e.ecrit).map(([k, x]) => [k, versOdoo(x)]))], `essai T1 : ${e.nom}`);
      const lu = await prix();
      const ok = lu === (e.attendu === "normal" ? normal : remise);
      resultats.push({ etape: e.nom, prix: lu, attendu: e.attendu === "normal" ? normal : remise, ok });
      journal(`  ${e.nom} : ${lu} € (attendu ${e.attendu === "normal" ? normal : remise} €) ${ok ? "OK" : "ÉCART"}`);
    }
  } finally {
    // réponse du create perdue : la règle est retrouvée par son repère (liste, modèle, date_start posé), puis supprimée
    if (!id) {
      const [r] = (await odoo("product.pricelist.item", "search_read", [[["pricelist_id", "=", liste], ["product_tmpl_id", "=", tmpl], ["date_start", "=", v.date_start]]], ctx({ fields: ["id"] })).catch(() => [])) || [];
      if (r?.id) { id = r.id; journal(`  réponse de la création perdue : règle retrouvée n° ${id}`); }
    }
    if (id) {
      await ecrit("retrait", "unlink", [[id]], "essai T1 : suppression de la règle d'essai");
      const reste = await odoo("product.pricelist.item", "search_count", [[["id", "=", id]]], ctx());
      supprimee = Number(reste) === 0;
      const lu = await prix();
      resultats.push({ etape: "4. suppression", prix: lu, attendu: normal, ok: supprimee && lu === normal });
      journal(`  4. suppression : search_count = ${reste}, prix ${lu} € ${supprimee && lu === normal ? "OK" : "ÉCART"}`);
    }
    // contrôle final : plus aucune règle datée pour ce produit sur la liste d'essai
    const restantes = await dateesDuProduit();
    if (Number(restantes) !== 0) throw new Error(`${restantes} règle(s) datée(s) restent pour ce produit sur la liste ${liste} : à supprimer à la main dans Odoo`);
  }
  const dates_respectees = resultats.length === 4 && resultats.every(r => r.ok);
  journal(dates_respectees ? "Odoo respecte date_start et date_end : filet Odoo = oui" : "Odoo NE respecte PAS les dates : filet Odoo = non (le filet horaire du site fait seul le travail)");
  return { resultats, dates_respectees, supprimee };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const i = process.argv.indexOf("--confirmer");
  const confirme = i > 0 && process.argv[i + 1] === CONFIRMATION;
  const ecrire = process.argv.includes("--ecrire") && process.env.PEREMPTION_ODOO_ECRITURE === "1" && confirme;
  if (process.argv.includes("--ecrire") && !ecrire) console.log(`--ecrire ignoré : il faut PEREMPTION_ODOO_ECRITURE=1 et « --confirmer ${CONFIRMATION} » (accord de Zineb requis)`);
  const { odoo } = ecrire ? await import("../netlify/functions/_odoo-rpc.js") : { odoo: null };
  const porte = ecrire ? creerPeremption({ env: { ...process.env, CONTEXT: undefined } }).ecrireOdoo : null;
  essaiDates({ odoo, porte, ecrire }).then(r => process.exit(r.plan || r.dates_respectees ? 0 : 1)).catch(e => { console.error("Essai arrêté :", e.message); process.exit(2); });
}
