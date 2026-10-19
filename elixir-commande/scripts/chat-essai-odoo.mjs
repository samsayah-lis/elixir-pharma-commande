// Essai des outils de l'Assistant Elixir sur le VRAI Odoo, en LECTURE SEULE : node scripts/chat-essai-odoo.mjs [595 5007]
// Odoo lu par ~/Downloads/pharmaml-audit/odoo.mjs (identifiants lus sur le Mac, jamais recopiés), derrière une enveloppe
// qui refuse toute méthode autre que search_read, read, search, search_count, fields_get. Supabase, stock des fichiers
// et demandes : doublures (aucune écriture, aucun e-mail, aucun appel au modèle). Identité : mode admin « pour une
// pharmacie » (pour_odoo_id revalidé dans le vrai Odoo).
// N'imprime que des identifiants, des nombres et des totaux (ni nom, ni e-mail, ni téléphone).
// Contrôle de non-régression : relevé de la fiche 595 du 01/09/2026 au 30/09/2026 = HT 89 041,89 · TVA 2 488,65 · TTC 91 530,54.
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { controlerAppels } from "./test-chat-perimetre.mjs";
import { identifier, revaliderRetour } from "../netlify/functions/_chat-perimetre.js";
import { executerOutil } from "../netlify/functions/_chat-outils.js";
import { traiter } from "../netlify/functions/chat-fichier.js";

// journaux JSON de l'assistant : masqués (ils ne contiennent ni texte ni montant, seulement du bruit ici)
const log = console.log;
console.log = (...a) => { if (typeof a[0] === "string" && a[0].startsWith('{"app":"assistant"')) return; log(...a); };
const SOURCE = process.env.CHAT_ESSAI_ODOO_MJS || path.join(os.homedir(), "Downloads/pharmaml-audit/odoo.mjs");
const { ex } = await import(pathToFileURL(SOURCE).href);
const LECTURE = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const appels = [];
async function odoo(model, method, args, kwargs = {}, opts = {}) {
  if (!LECTURE.has(method)) throw new Error(`méthode interdite (lecture seule) : ${method}`);
  appels.push({ model, method, domaine: ["search_read", "search_count", "search"].includes(method) ? structuredClone(args[0]) : null, kwargs: structuredClone(kwargs), opts });
  const kw = { ...kwargs, context: { lang: "fr_FR", ...(kwargs.context || {}) } };
  return ex(model, method, args, kw);
}
// doublures : aucune écriture
const sb = async () => [];
function creerFauxStock() {
  const f = new Map();
  return { fichiers: {
    async creer(o) { const id = randomBytes(16).toString("hex"); f.set(id, { ...o, usages: 0 }); return id; },
    async consommer(id, odooId) { const x = f.get(id); if (!x || x.odoo_id !== Number(odooId) || x.usages >= x.usages_max) return null; x.usages++; return { id, odoo_id: x.odoo_id, type: x.type, params: x.params }; },
  }, compter: { fichiers: async () => 0 } };
}
const demandes = { brouillons: [], creerBrouillon: async (ctx, b) => { demandes.brouillons.push(b); return { demande_id: "essai", expire_at: new Date(Date.now() + 30 * 60e3).toISOString() }; },
  transmettre: async () => ({ numero: "T-ESSAI", delai: null }) };
const jetons = { verifierJeton: async () => ({ id: "essai", email: "essai@elixir.local", isAdmin: true }),
  utilisateur: async () => ({ id: "essai", email: "essai@elixir.local", email_confirmed_at: "2026-10-01T00:00:00Z" }) };
const ms = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };
const kb = (b64) => Buffer.from(String(b64 || ""), "base64").length;

let echecs = 0;
const verifier = (label, cond) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) echecs++; };

for (const fiche of (process.argv.slice(2).length ? process.argv.slice(2) : ["595", "5007"]).map(Number)) {
  console.log(`\n── Fiche ${fiche} ──`);
  const stock = creerFauxStock();
  const deps = { odoo, sb, stock, demandes, ...jetons, maintenant: () => new Date() };
  const evt = (q = {}) => ({ httpMethod: "GET", headers: { authorization: "Bearer essai", host: "localhost" }, queryStringParameters: q });
  const [ctx, tId] = await ms(() => identifier(evt(), { pour_odoo_id: fiche }, deps));
  console.log(`identité : fiche ${ctx.odooId}, CIP ${ctx.cip ? "présent" : "absent"}, mode ${ctx.mode} (${tId} ms)`);
  const outil = (nom, e) => executerOutil(nom, e, ctx, deps);

  // factures (90 jours) puis duplicata par une vraie date
  const [f, tF] = await ms(() => outil("rechercher_factures", { date_debut: null, date_fin: null, type_document: "tous", recherche: null, page: 1 }));
  console.log(`factures 90 j : ${f.contenu.total} pièces, ${f.contenu.documents?.length} sur la page, ${f.contenu.documents?.filter(d => d.pdf_disponible).length} avec PDF (${tF} ms)`);
  const jour = f.contenu.documents?.[0]?.date;
  if (jour) {
    const [d, tD] = await ms(() => outil("duplicata_facture", { numero: null, date: jour, envoi: "telechargement" }));
    const c = d.ui_actions[0];
    console.log(`duplicata du ${jour} : carte ${c?.type}, ${c?.type === "documents" ? `${c.items.length} candidats` : `PDF ${c?.pdf_disponible ? "oui" : "non"}`} (${tD} ms)`);
    const id = c?.type === "document" ? c.fichier_id : null;
    if (id) {
      const [r, tR] = await ms(() => traiter(evt({ id, pour_odoo_id: String(fiche) }), deps));
      verifier(`pièce jointe lue (ir.attachment.datas) : ${kb(r.body)} octets, ${r.headers["Content-Type"]}, début %PDF (${tR} ms)`,
        r.statusCode === 200 && Buffer.from(r.body, "base64").subarray(0, 4).toString() === "%PDF");
    }
  }

  // relevé de septembre 2026
  const [rel, tRel] = await ms(() => outil("releve_facturation", { date_debut: "2026-09-01", date_fin: "2026-09-30", detail: "par_document" }));
  const rc = rel.contenu;
  console.log(`relevé 09/2026 : ${rc.nb_factures} factures, ${rc.nb_avoirs} avoirs · HT ${rc.total_ht} · TVA ${rc.total_tva} · TTC ${rc.total_ttc} (${tRel} ms)`);
  console.log(`  TVA : ${(rc.tva || []).map(v => `${v.taux} % → base ${v.base}, TVA ${v.montant}`).join(" ; ")}`);
  const sommeBase = Math.round((rc.tva || []).reduce((s, v) => s + v.base, 0) * 100) / 100, sommeTva = Math.round((rc.tva || []).reduce((s, v) => s + v.montant, 0) * 100) / 100;
  verifier(`ventilation cohérente : Σ bases ${sommeBase} = HT, Σ TVA ${sommeTva} = TVA`, sommeBase === rc.total_ht && sommeTva === rc.total_tva);
  if (fiche === 595) verifier("non-régression 595 : HT 89 041,89 · TVA 2 488,65 · TTC 91 530,54",
    rc.total_ht === 89041.89 && rc.total_tva === 2488.65 && rc.total_ttc === 91530.54 && rc.nb_factures === 41 && rc.nb_avoirs === 5);
  for (const fmt of ["pdf", "xlsx"]) {
    const id = rel.ui_actions[0]?.fichiers?.[fmt];
    if (!id) continue;
    const [r, t] = await ms(() => traiter(evt({ id, pour_odoo_id: String(fiche) }), deps));
    verifier(`relevé ${fmt.toUpperCase()} généré : ${kb(r.body)} octets (${t} ms)`, r.statusCode === 200 && kb(r.body) > 1000);
  }
  // durée d'un relevé de 12 mois (outil borné à 6 s par le moteur)
  const [r12, t12] = await ms(() => outil("releve_facturation", { date_debut: "2025-10-01", date_fin: "2026-09-30", detail: "par_document" }));
  console.log(`relevé 12 mois : ${r12.contenu.nb_factures} factures, ${r12.contenu.nb_avoirs} avoirs, ${r12.erreur ? "erreur" : "ok"} (${t12} ms)`);

  // commandes récentes et détail
  const [cm, tC] = await ms(() => outil("rechercher_commandes", { date_debut: null, date_fin: null, etat: "toutes", recherche: null, page: 1 }));
  const etats = {};
  for (const c of cm.contenu.commandes || []) { const k = c.etat.replace(/ le \d{2}\/\d{2}\/\d{4}.*$/, " le …").replace(/\(INV.*\)/, "(…)"); etats[k] = (etats[k] || 0) + 1; }
  console.log(`commandes 14 j : ${cm.contenu.total} (${tC} ms) · origines ${JSON.stringify((cm.contenu.commandes || []).reduce((m, c) => ({ ...m, [c.origine]: (m[c.origine] || 0) + 1 }), {}))}`);
  console.log(`  états : ${JSON.stringify(etats)}`);
  const sortie = (cm.contenu.commandes || []).find(c => /^Sortie/.test(c.etat) && c.lignes_non_servies < c.lignes);
  if (sortie) {
    const [dc, tDc] = await ms(() => outil("detail_commande", { reference: sortie.reference }));
    const carte = dc.ui_actions[0];
    console.log(`détail d'une commande sortie : ${carte?.lignes.length} lignes, ${carte?.lots.length} lots, ${carte?.factures.length} facture(s), étapes faites ${carte?.etapes.filter(e => e.fait).map(e => e.cle).join(">")} (${tDc} ms)`);
    // brouillon de retour : 1 boîte du premier lot livré
    const lot = carte?.lots.find(l => l.cip);
    if (lot) {
      const [r, tRt] = await ms(() => outil("preparer_demande_retour", { reference_document: sortie.reference, motif: "retour_erreur_pharmacie", souhait: "avoir",
        lignes: [{ produit: lot.cip, quantite: 1, lot: lot.lot }], commentaire: null }));
      verifier(`brouillon de retour résolu : ${r.erreur ? "refus" : r.ui_actions[0]?.type}, hors délai ${r.contenu.hors_delai}, ${demandes.brouillons.at(-1)?.lignes?.length ?? 0} ligne(s), max ${demandes.brouillons.at(-1)?.lignes?.[0]?.quantite_max ?? "?"} (${tRt} ms)`,
        !r.erreur && r.ui_actions[0]?.type === "recap_retour");
      const b = demandes.brouillons.at(-1);
      if (b && !r.erreur) {
        const v = await revaliderRetour(ctx, b, deps);
        verifier(`revaliderRetour : ${v.ok ? "valide" : "refus"}`, v.ok === true);
        const trop = await revaliderRetour(ctx, { ...b, lignes: b.lignes.map(l => ({ ...l, quantite: l.quantite_max + 1 })) }, deps);
        verifier("revaliderRetour : quantité > livrée − retournée → refus", trop.ok === false && !trop.temporaire);
      }
    }
  }
  // recherche par CIP (code du produit) dans les factures et les commandes ; numéro cité sans zéros de tête ni année
  const cipVu = (await outil("detail_commande", { reference: (cm.contenu.commandes || []).find(c => c.lignes > 0)?.reference || "S000001" })).ui_actions[0]?.lignes?.find(l => l.cip)?.cip;
  if (cipVu) {
    const [fc, tFc] = await ms(() => outil("rechercher_factures", { date_debut: null, date_fin: null, type_document: "tous", recherche: cipVu, page: 1 }));
    const [cc, tCc] = await ms(() => outil("rechercher_commandes", { date_debut: null, date_fin: null, etat: "toutes", recherche: cipVu, page: 1 }));
    verifier(`recherche par CIP13 : ${fc.contenu.total} pièce(s) (${tFc} ms), ${cc.contenu.total} commande(s) (${tCc} ms)`, cc.contenu.total > 0);
    const [c7] = await ms(() => outil("rechercher_commandes", { date_debut: null, date_fin: null, etat: "toutes", recherche: cipVu.slice(5, 12), page: 1 }));
    verifier(`recherche par CIP7 : ${c7.contenu.total} commande(s)`, c7.contenu.total >= cc.contenu.total);
  }
  const [av] = await ms(() => outil("rechercher_factures", { date_debut: "2024-10-20", date_fin: null, type_document: "avoirs", recherche: null, page: 1 }));
  const dernierAvoir = av.contenu.documents?.[0]?.numero;
  if (dernierAvoir) {
    const court = dernierAvoir.replace(/\/(\d{4})\/0+(\d)/, "/$1/$2"), sansAnnee = dernierAvoir.replace(/^(R?INV)\/\d{4}\/0*/, "$1 ");
    for (const cite of [court, sansAnnee]) {
      const [dv] = await ms(() => outil("duplicata_facture", { numero: cite, date: null, envoi: "telechargement" }));
      verifier(`avoir cité « ${cite.replace(/\d/g, "9")} » : retrouvé`, dv.contenu.trouve === true || (dv.contenu.candidats || []).some(x => x.numero === dernierAvoir));
    }
  }
  const [fa, tFa] = await ms(() => outil("rechercher_commandes", { date_debut: null, date_fin: null, etat: "facturees", recherche: null, page: 1 }));
  verifier(`commandes « facturées » : ${fa.contenu.total}, toutes avec une facture (${tFa} ms)`, (fa.contenu.commandes || []).every(c => c.factures.length > 0));
  const [ps, tPs] = await ms(() => outil("rechercher_commandes", { date_debut: null, date_fin: null, etat: "partiellement_servies", recherche: null, page: 1 }));
  verifier(`commandes partiellement servies : ${ps.contenu.total} (${tPs} ms), aucune entièrement non servie`, (ps.contenu.commandes || []).every(c => !/^Non servie/.test(c.etat)));

  // référence d'une autre pharmacie = inconnue (même sortie)
  const inconnu = await outil("detail_commande", { reference: "S000001" });
  verifier("référence inexistante : réponse « aucune commande »", inconnu.contenu.trouve === false);
}

// garde : tous les appels enregistrés portent société 2 + filtre de la fiche, aucun champ interdit
const fautes = controlerAppels(appels, process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [595, 5007]);
verifier(`${appels.length} appels Odoo (lecture seule) : domaines et champs conformes${fautes.length ? ` — ${fautes.slice(0, 3).join(" | ")}` : ""}`, fautes.length === 0);
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est conforme.");
process.exit(echecs ? 1 : 0);
