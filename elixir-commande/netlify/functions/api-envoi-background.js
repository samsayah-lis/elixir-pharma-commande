// ── API des pharmacies : envoi d'UNE commande réelle, son délai d'annulation écoulé (fonction d'arrière-plan, 15 min) ──
// Lancée par api-commandes-cron.js (toutes les 2 min) avec x-cron-secret, comme api-prix-background. POST { id } (api_commandes).
//   1. prise par une transition conditionnelle « recue » → « envoi_demande » (un seul envoi même si deux passages se croisent ;
//      une annulation de la pharmacie, conditionnelle elle aussi, ne peut pas passer en même temps) ;
//   2. revérifications : API en service, « Commandes par API » ouvertes, accès actif et non bloqué — sinon gardée
//      « à vérifier » (envoi_suspendu), rien ne part ; commande déjà prise en main par Elixir pendant le délai (« Sync » de
//      l'onglet Commandes : ligne envoyée ou tâche du relais en cours) → rien n'est touché, l'état suit le relais ;
//   2 bis. intégrité (défense en profondeur) : la commande du site doit porter exactement les lignes acceptées par l'API
//      (CIP, quantité, rang) et le CIP de la fiche Odoo de l'accès — sinon gardée « à vérifier » (commande_modifiee), rien
//      ne part ;
//   3. si_rupture « retirer » (défaut) : lignes sans stock libre suffisant (Odoo, société 2, moins ce qui part déjà par le
//      relais) marquées « rupture : retirée » (handled_at + api_motif) AVANT l'envoi — aucune écriture de lignes après la mise
//      en file (le relais y pose ses marques d'envoi) ; « garder » : elles restent en attente, pour Elixir ;
//   4. envoiAuto (_relais.js, le relais existant, seul chemin vers PharmaML) : lignes en stock, empreinte anti-doublon de 2 h,
//      fiche cliente non bloquée, commande de moins de 30 min ; tout le reste (doublon, envoi automatique coupé, retard)
//      → « à vérifier » avec un motif, et une notification à Elixir ;
//   5. stock affiché du site décrémenté pour les lignes mises en file (decrement_stock, comme order-save).
// Erreur passagère AVANT toute mise en file (Odoo ou base muets) : nouvel essai 3 min plus tard (la commande redevient
// « recue », le passage planifié la reprend), tant qu'elle a moins de 22 min ; ensuite « à vérifier » (envoi_manque).
// Exception APRÈS la mise en file (réponse perdue) : la file du relais fait foi (tâche active → « envoyee »).
// Jamais d'appel à PharmaML ici : le relais reste le seul chemin.
import { cronAutorise } from "./_api-http.js";
import { odoo as odooReel } from "./_odoo-rpc.js";
import { envoiAuto as envoiAutoReel, enVolRelais as enVolRelaisReel } from "./_relais.js";
import { ficheVerifiee } from "./_chat-perimetre.js";
import { creerStockApi, estUuid } from "./_api-stock.js";
import { lecteurOdoo } from "./_api-prix.js";
import { commandesLiveOuvertes, fusionnerReglages } from "./_api-config.js";
import { TACHES_LIBEREES, marquerLignes, stockLibreLots } from "./_api-commande.js";

const lireJson = (t, d) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return d; } };
const fait = (it) => !!(it?.synced_at || it?.handled_at);
// issue d'envoiAuto → motif de la mise « à vérifier »
export const MOTIF_ENVOI = { double: "doublon_recent", inactif: "envoi_manuel", ancienne: "envoi_manque", avant: "envoi_manuel" };
export const LIBELLES_ENVOI = { envoi_suspendu: "envoi suspendu (API, commandes par API ou accès coupés)", doublon_recent: "commande identique à une autre de moins de 2 h",
  commande_modifiee: "lignes ou pharmacie de la commande différentes de celles acceptées par l'API : rien envoyé",
  rupture_envoi: "lignes sans stock au moment de l'envoi (si_rupture « retirer ») : à retirer avec « Traiter sans envoi »",
  envoi_manuel: "envoi automatique du relais désactivé : synchro manuelle", envoi_manque: "envoi automatique manqué (plus de 30 min) : synchro manuelle",
  precommande: "lignes en rupture gardées (si_rupture « garder »)", erreur_transmission: "envoi impossible : à vérifier" };

// nouvel essai après une erreur passagère : 3 min plus tard, tant que la commande a moins de 22 min (envoiAuto refuse au-delà
// de 30 min)
export const REESSAI = { apres_ms: 3 * 60e3, age_max_ms: 22 * 60e3 };
const heureParis = (d) => new Date(d).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

// deps (doublures des tests) : autoriser, stock, odoo, envoiAuto, enVolRelais, verifierFiche(odooId), maintenant, journal
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-envoi-background", ...o })));
  const maintenant = deps.maintenant || (() => new Date());
  const envoiAuto = deps.envoiAuto || envoiAutoReel;
  const enVolRelais = deps.enVolRelais || enVolRelaisReel;
  const verifierFiche = deps.verifierFiche || ((id) => ficheVerifiee(id, { odoo: deps.odoo || odooReel }));
  return async (event) => {
    if (!(deps.autoriser || ((e) => cronAutorise(e)))(event)) return { statusCode: 403, body: "" };
    const id = lireJson(event.body || "{}", {})?.id;
    if (!estUuid(id)) return { statusCode: 400, body: "" };
    const stock = deps.stock || creerStockApi();
    const now = maintenant();
    const row = await stock.commandes.parId(id).catch(() => null);
    if (!row || row.test || row.etat !== "recue" || !row.order_id || !(Date.parse(row.envoi_apres) <= now.getTime())) { journal({ code: "rien", id }); return { statusCode: 200, body: "" }; }
    const pris = await stock.commandes.ecrire(row, { etat: "envoi_demande", envoi_resultat: null }).catch(() => null);
    if (!pris) { journal({ code: "deja_pris", id }); return { statusCode: 200, body: "" }; }
    let courant = pris;
    const finir = async (champs) => { const r = await stock.commandes.ecrire(courant, champs); if (r) courant = r; return r; };
    const avis = (motif) => stock.site.notifier({ type: "new_order", title: `⚠ Commande API à vérifier (n° ${row.order_id})`, body: LIBELLES_ENVOI[motif] || motif,
      data: { order_id: Number(row.order_id), source: "api", motif } }).catch(() => {});
    const aVerifier = async (motif, resultat) => {
      await finir({ etat: "a_verifier", motif, envoi_resultat: String(resultat || motif).slice(0, 300) });
      await avis(motif);
      journal({ code: "a_verifier", id, motif });
    };
    // erreur passagère, rien en file : nouvel essai dans 3 min (la commande redevient « recue ») tant qu'elle est récente
    const essais = Number(/^nouvel essai n° (\d+)/.exec(String(row.envoi_resultat || ""))?.[1] || 0);
    const reessayer = async (raison) => {
      const recu = Date.parse(row.recu_le);
      if (!(now.getTime() - recu < REESSAI.age_max_ms)) return false;
      const quand = new Date(now.getTime() + REESSAI.apres_ms);
      const r = await finir({ etat: "recue", envoi_apres: quand.toISOString(), envoi_resultat: `nouvel essai n° ${essais + 1} à ${heureParis(quand)} : ${String(raison).slice(0, 200)}` });
      if (r) journal({ code: "nouvel_essai", id, essai: essais + 1 });
      return !!r;
    };
    // la file du relais fait foi après une réponse perdue : une tâche active → la commande est partie
    const dejaEnFile = async () => {
      const t = await stock.relais.taches(row.order_id).catch(() => null);
      return t == null ? null : t.some(x => !TACHES_LIBEREES.has(x.etat));
    };
    try {
      const [acces, lu] = await Promise.all([stock.acces.lire(row.odoo_id), stock.reglages.lire()]);
      const reglages = fusionnerReglages(lu.valeur);
      if (!reglages.actif || !commandesLiveOuvertes(reglages, now) || !acces?.actif || acces.mode !== "auto") { await aVerifier("envoi_suspendu"); return { statusCode: 200, body: "" }; }
      const o = await stock.site.lire(row.order_id);
      if (!o || o.source !== "api") { await aVerifier("erreur_transmission", "commande introuvable dans les commandes du site"); return { statusCode: 200, body: "" }; }
      // déjà prise en main par Elixir pendant le délai (synchro manuelle) : aucune ligne n'est retirée ni renvoyée ici
      const taches = await stock.relais.taches(row.order_id);
      if (o.items.some(it => it?.synced_at) || taches.some(t => !TACHES_LIBEREES.has(t.etat))) {
        await finir({ etat: "envoyee", envoi_resultat: "déjà prise en main par Elixir pendant le délai (synchro manuelle) : l'état suit le relais" });
        journal({ code: "deja_traitee", id, issue: "synchro_manuelle" });
        return { statusCode: 200, body: "" };
      }
      // intégrité : lignes acceptées par l'API (réponse enregistrée) et CIP de la fiche (Odoo ; muet → CIP noté sur l'accès)
      const rep = lireJson(row.reponse, null);
      const cle = (ligne, cip, q) => `${ligne}:${cip}x${q}`;
      const attendues = (rep?.lignes || []).filter(l => l.etat === "acceptee" && l.quantite > 0).map(l => cle(l.ligne, l.cip, l.quantite)).sort().join(",");
      const presentes = o.items.map(it => cle(it?.ligne_api, it?.cip, parseInt(it?.qty) || 0)).sort().join(",");
      const fiche = await verifierFiche(row.odoo_id).catch(() => undefined);
      const cipFiche = String((fiche === undefined ? acces.cip : fiche?.cip) || "").trim();
      if (!attendues || attendues !== presentes || !cipFiche || String(o.pharmacy_cip || "").trim() !== cipFiche) {
        await aVerifier("commande_modifiee", !fiche && fiche !== undefined ? "fiche Odoo de la pharmacie introuvable" : "lignes ou CIP de la commande différents de ceux acceptés par l'API");
        return { statusCode: 200, body: "" };
      }
      const siRupture = lireJson(row.demande, {})?.si_rupture === "garder" ? "garder" : "retirer";
      let retirees = 0;
      // lignes encore à envoyer (mêmes conditions qu'envoiAuto)
      const valides = o.items.map((it, i) => ({ it, i })).filter(({ it }) => !fait(it) && /^\d{13}$/.test(String(it?.cip || "")) && (parseInt(it?.qty) || 0) >= 1);
      if (siRupture === "retirer") {
        // stock libre moins ce qui part déjà par le relais ; même répartition qu'envoiAuto (ligne entière, CIP cumulés)
        const libre = await stockLibreLots(lecteurOdoo(deps.odoo || odooReel, 10000), valides.map(v => String(v.it.cip)));
        for (const [cip, q] of await enVolRelais()) if (libre.has(cip)) libre.set(cip, libre.get(cip) - q);
        const sans = [];
        for (const { it, i } of valides) {
          const q = parseInt(it.qty), l = libre.get(String(it.cip)) ?? 0;
          if (l >= q) libre.set(String(it.cip), l - q); else sans.push(i);
        }
        if (sans.length) retirees = await marquerLignes(stock, row.order_id, sans, "rupture", now);
        if (retirees && retirees >= valides.length) {
          await finir({ etat: "non_servie", motif: "rupture", envoi_resultat: `rupture : ${retirees} ligne(s) retirée(s), rien envoyé` });
          journal({ code: "rupture", id, retirees });
          return { statusCode: 200, body: "" };
        }
      }
      let r;
      try { r = await envoiAuto({ orderId: row.order_id, user: { api: true, cip: String(o.pharmacy_cip || "") } }); }
      catch (e) {
        const erreur = String(e?.message || e).slice(0, 200);
        const enFile = await dejaEnFile();
        if (enFile) {
          await finir({ etat: "envoyee", envoi_resultat: `mis en file, réponse perdue (${erreur}) : l'état suit le relais`.slice(0, 300) });
          journal({ code: "en_file_reponse_perdue", id });
          return { statusCode: 200, body: "" };
        }
        if (enFile === false && await reessayer(`envoi interrompu (${erreur})`)) return { statusCode: 200, body: "" };
        r = { ok: false, code: "exception", error: erreur };
      }
      if (r.ok) {
        // lignes que le relais n'a pas envoyées faute de stock (stock tombé entre la vérification et l'envoi, ou « garder ») :
        // jamais réécrites ici après la mise en file (le relais pose ses marques sur les mêmes lignes) → Elixir les traite
        const nonEnvoyees = Math.max(0, valides.length - retirees - (Array.isArray(r.idx) ? r.idx.length : Number(r.lignes) || 0));
        const garde = nonEnvoyees > 0;
        await finir({ etat: garde ? "a_verifier" : "envoyee", motif: garde ? (siRupture === "garder" ? "precommande" : "rupture_envoi") : null,
          envoi_resultat: `en file (réf. ${r.ref}, ${r.lignes} ligne(s))${retirees ? ` · ${retirees} retirée(s) en rupture` : ""}${nonEnvoyees ? ` · ${nonEnvoyees} non envoyée(s), sans stock` : ""}`.slice(0, 300) });
        if (garde) await avis(siRupture === "garder" ? "precommande" : "rupture_envoi");
        // stock affiché du site (comme order-save) : lignes mises en file
        const envoyes = (r.idx || []).map(i => o.items[i]).filter(Boolean);
        for (let k = 0; k < envoyes.length; k += 5) {
          await Promise.all(envoyes.slice(k, k + 5).map(it => stock.site.decrementer(it.cip, parseInt(it.qty) || 0).catch(() => {})));
        }
        journal({ code: "en_file", id, ref: r.ref, lignes: r.lignes, retenues: r.retenues || 0, retirees });
      } else if (["traitee", "rien", "deja"].includes(r.code)) {
        // Elixir l'a déjà prise en main (synchro manuelle, traitée) : l'état suit le site et le relais
        await finir({ etat: "envoyee", envoi_resultat: `déjà prise en main : ${r.error || r.code}`.slice(0, 300) });
        journal({ code: "deja_traitee", id, issue: r.code });
      } else if (r.code === "precommande") {
        if (siRupture === "retirer") {
          const n = await marquerLignes(stock, row.order_id, null, "rupture", now);
          await finir({ etat: "non_servie", motif: "rupture", envoi_resultat: `rupture : ${retirees + n} ligne(s) retirée(s), rien envoyé` });
          journal({ code: "rupture", id, retirees: retirees + n });
        } else await aVerifier("precommande", r.error);
      } else await aVerifier(MOTIF_ENVOI[r.code] || "erreur_transmission", `${r.code} : ${r.error || ""}`);
    } catch (e) {
      const erreur = String(e?.message || e).slice(0, 200);
      journal({ code: "erreur", id, erreur: erreur.slice(0, 160) });
      try {
        // la commande est-elle déjà dans la file du relais ? (une erreur après la mise en file ne la renvoie jamais)
        const enFile = await dejaEnFile();
        if (enFile) await finir({ etat: "envoyee", envoi_resultat: `mis en file, suite interrompue (${erreur}) : l'état suit le relais`.slice(0, 300) });
        else if (!(enFile === false && await reessayer(erreur))) await aVerifier(enFile === false ? "envoi_manque" : "erreur_transmission", `erreur : ${erreur}`);
      } catch { /* base muette : le passage planifié la reprend (envoi_demande de plus de 20 min → à vérifier) */ }
    }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
