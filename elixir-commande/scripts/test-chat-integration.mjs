// Test d'intégration de l'Assistant Elixir : node scripts/test-chat-integration.mjs
// Les VRAIS modules sont branchés entre eux — chat.js → chat-tour-background.js → _chat-moteur.js → _chat-outils.js →
// _chat-perimetre.js / _chat-releve.js, _chat-demandes.js (brouillon, recontrôle revaliderRetour, envoi), _chat-stock.js,
// chat-fichier.js, chat-admin.js — ; seules les extrémités sont des doublures : faux Odoo et faux Supabase de lecture de
// test-chat-perimetre.mjs, faux PostgREST en mémoire (tables chat_*), faux client Anthropic scripté, fetch global
// intercepté (Resend capturé ; toute autre adresse lève une erreur : aucun appel réseau, aucun e-mail réel).
//  • duplicata : outil réel → autorisation de fichier → chat-fichier rend le PDF d'origine, refusé à une autre pharmacie ;
//  • retour : outil réel → brouillon (30 min) → carte → « Confirmer » → recontrôle Odoo réel → un seul envoi (simulation) ;
//  • l'événement « demande enregistrée » est dit au modèle après le message suivant ; transmission qualité urgente ;
//  • saisie Elixir (admin + pour_odoo_id) en mode « email », case « Prévenir la pharmacie » décochée ; pharmacie en mode
//    « email » : récapitulatif aux seules adresses du compte ;
//  • admin : demandes, conversation (outils appelés, jamais de réflexion) ; chaque lecture Odoo porte société 2 et fiche.
import crypto from "node:crypto";
import { creerFauxOdoo, jeuOdoo, creerFauxSb, fauxJetons, MAINTENANT, controlerAppels, CHAMPS_INTERDITS } from "./test-chat-perimetre.mjs";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
process.env.CRON_SECRET = "secret-cron-test";
process.env.ADMIN_EMAIL = "equipe@elixir.test";
process.env.ODOO_URL = "https://odoo.test";
process.env.RESEND_API_KEY = "re_test_integration";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CHATBOT_ANTHROPIC_API_KEY;
delete process.env.CHATBOT_INTAKE_SECRET;

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };
// journaux JSON de l'assistant (une ligne par outil) : masqués
const log = console.log;
console.log = (...a) => { if (typeof a[0] === "string" && a[0].startsWith('{"app":"assistant"')) return; log(...a); };

let T = MAINTENANT().getTime();
const maintenant = () => new Date(T);

// ── Faux PostgREST (tables chat_*, clé serveur exigée) ──
function fauxPostgrest() {
  const tables = { chat_reglages: [], chat_conversations: [], chat_tours: [], chat_demandes: [], chat_fichiers: [], chat_alertes: [] };
  let seq = 0;
  const iso = () => new Date(T).toISOString();
  const SCHEMA = {
    chat_reglages: { defauts: () => ({ valeur: "{}", updated_at: iso() }), uniques: [r => String(r.id)] },
    chat_conversations: { defauts: () => ({ id: crypto.randomUUID(), cip: null, pharmacie: null, compte_email: null, admin_email: null, statut: "ouverte", messages: "[]",
      affichage: "[]", evenements_en_attente: "[]", nb_messages: 0, version: 0, created_at: iso(), updated_at: iso() }),
      uniques: [r => r.statut === "ouverte" ? `${r.odoo_id}|${r.admin_email || ""}` : null] },
    chat_tours: { defauts: () => ({ id: crypto.randomUUID(), admin_email: null, ctx: "{}", statut: "en_attente", etape: null, texte: null, ui_actions: "[]", outils: "[]",
      usage: null, cout_eur: 0, appels: 0, repli: false, refus: false, code: null, duree_ms: null, created_at: iso(), started_at: null, finished_at: null }),
      uniques: [r => ["en_attente", "en_cours"].includes(r.statut) ? r.conversation_id : null] },
    chat_demandes: { defauts: () => ({ id: crypto.randomUUID(), seq: ++seq, numero: null, conversation_id: null, pharmacie: null, admin_email: null, brouillon: "{}",
      resume: null, cible_ref: null, expire_at: null, created_at: iso(), confirmee_at: null, transmise_at: null, updated_at: iso(), erreur: null }),
      uniques: [r => r.type === "transmission" && r.conversation_id && ["confirmee", "transmise", "echec"].includes(r.statut) ? r.conversation_id : null, r => r.numero] },
    chat_fichiers: { defauts: () => ({ usages: 0, usages_max: 3, created_at: iso() }), uniques: [r => r.id] },
    chat_alertes: { defauts: () => ({ created_at: iso() }), uniques: [r => `${r.jour}|${r.type}`] },
  };
  const cmp = (a, b) => {
    if (a === null || a === undefined) return NaN;
    if (typeof a === "number") return a - Number(b);
    if (typeof a === "boolean") return String(a) === b ? 0 : 1;
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(a)) && !Number.isNaN(Date.parse(b))) return Date.parse(a) - Date.parse(b);
    return String(a) < b ? -1 : String(a) > b ? 1 : 0;
  };
  const SPECIAUX = new Set(["select", "order", "limit", "offset", "on_conflict"]);
  const correspond = (r, params) => [...params].every(([k, v]) => {
    if (SPECIAUX.has(k)) return true;
    const [op, ...reste] = v.split("."); const val = reste.join(".");
    if (op === "eq") return cmp(r[k], val) === 0;
    if (op === "gte") return cmp(r[k], val) >= 0;
    if (op === "lt") return cmp(r[k], val) < 0;
    if (op === "is") return val === "null" ? r[k] === null || r[k] === undefined : String(r[k]) === val;
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").some(x => cmp(r[k], x) === 0);
    throw new Error(`filtre non pris en charge : ${k}=${v}`);
  });
  const projeter = (r, select) => select ? Object.fromEntries(select.split(",").map(c => [c, r[c] ?? null])) : { ...r };
  const doublon = (table, r) => (SCHEMA[table].uniques || []).some(f => { const k = f(r); return k != null && tables[table].some(x => x !== r && f(x) === k); });
  const reponse = (corps, status = 200, entetes = {}) => new Response(corps === null ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json", ...entetes } });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const methode = opts.method || "GET";
    const prefer = String(opts.headers?.Prefer || "");
    if (opts.headers?.apikey !== "cle-service-test" || opts.headers?.Authorization !== "Bearer cle-service-test") return reponse({ message: "clé refusée" }, 401);
    if (!tables[table]) return reponse({ message: "table inconnue" }, 404);
    const p = u.searchParams, select = p.get("select");
    const rep = prefer.includes("return=representation");
    if (methode === "GET") {
      let rows = tables[table].filter(r => correspond(r, p));
      const total = rows.length;
      const o = p.get("order");
      if (o) { const [c, sens] = o.split("."); rows = [...rows].sort((a, b) => (cmp(a[c], String(b[c])) || 0) * (sens === "desc" ? -1 : 1)); }
      rows = rows.slice(Number(p.get("offset") || 0), p.get("limit") ? Number(p.get("offset") || 0) + Number(p.get("limit")) : undefined);
      if (prefer.includes("count=exact")) return reponse(rows.slice(0, 1).map(r => projeter(r, select)), 200, { "Content-Range": total ? `0-0/${total}` : "*/0" });
      return reponse(rows.map(r => projeter(r, select)));
    }
    if (methode === "POST") {
      const ajoutees = [];
      for (const l of [JSON.parse(opts.body)].flat()) {
        const r = { ...SCHEMA[table].defauts(), ...l };
        tables[table].push(r);
        if (doublon(table, r)) {
          tables[table].splice(tables[table].indexOf(r), 1);
          if (prefer.includes("resolution=ignore-duplicates")) continue;
          return reponse({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        }
        ajoutees.push(r);
      }
      return rep ? reponse(ajoutees.map(r => projeter(r, select)), 201) : reponse(null, 201);
    }
    if (methode === "PATCH") {
      const champs = JSON.parse(opts.body);
      const cibles = tables[table].filter(r => correspond(r, p));
      for (const r of cibles) {
        const avant = { ...r };
        Object.assign(r, champs);
        if (doublon(table, r)) { Object.assign(r, avant); return reponse({ code: "23505", message: "duplicate key" }, 409); }
      }
      return rep ? reponse(cibles.map(r => projeter(r, select))) : reponse(null, 204);
    }
    return reponse({ message: "méthode" }, 405);
  }
  return { tables, fetch };
}
const db = fauxPostgrest();

// ── fetch global : Resend capturé, tout le reste refusé (aucun appel réseau réel) ──
const mails = [];
const refuses = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails") {
    mails.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: `mail-${mails.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  refuses.push(u.replace(/\?.*$/, ""));
  throw new Error(`réseau interdit pendant le test : ${u.slice(0, 80)}`);
};

// ── Modules réels (importés après les variables d'environnement) ──
const { creerStock } = await import("../netlify/functions/_chat-stock.js");
const { oublierReglages, REGLAGES_DEFAUT } = await import("../netlify/functions/_chat-config.js");
const { SYSTEME } = await import("../netlify/functions/_chat-systeme.js");
const { OUTILS } = await import("../netlify/functions/_chat-outils.js");
const { creerHandler: creerChat } = await import("../netlify/functions/chat.js");
const { creerHandler: creerTour } = await import("../netlify/functions/chat-tour-background.js");
const { creerHandler: creerAdmin } = await import("../netlify/functions/chat-admin.js");
const { traiter: fichier } = await import("../netlify/functions/chat-fichier.js");

const faux = creerFauxOdoo(jeuOdoo());
const fsb = creerFauxSb();
const PERIM = { odoo: faux.odoo, sb: fsb.sb, ...fauxJetons, maintenant: MAINTENANT };
const stock = creerStock({ fetch: db.fetch, url: "https://supabase.test", cle: "cle-service-test", maintenant });
const silence = () => {};
const reglages = (v) => {
  db.tables.chat_reglages = [{ id: 1, valeur: JSON.stringify({ ...v }), updated_at: new Date(T).toISOString() }];
  oublierReglages(stock);
};

// ── Faux client Anthropic : réponses scriptées (fonctions des paramètres reçus) ──
const script = [];
const appelsModele = [];
const client = { beta: { messages: { create: async (params) => {
  appelsModele.push(JSON.parse(JSON.stringify(params)));
  const r = script.shift();
  if (!r) throw Object.assign(new Error("plus de réponse scriptée"), { status: 500 });
  return r(params);
} } } };
const USAGE = { input_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 5200, output_tokens: 90, cache_creation: null, iterations: null };
const rep = (stop_reason, content) => ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, content, usage: USAGE });
const reflexion = (n) => ({ type: "thinking", thinking: "", signature: `sig-${n}` });
const texteB = (t) => ({ type: "text", text: t });
let nTool = 0;
const appelOutil = (name, input) => () => rep("tool_use", [reflexion(++nTool), { type: "tool_use", id: `toolu_${nTool}`, name, input }]);
const resultatOutil = (params) => { const b = params.messages.at(-1).content.find(x => x.type === "tool_result"); return { ...b, contenu: JSON.parse(b.content) }; };
let dernierResultat = null;
const reponseFinale = (texte) => (params) => { dernierResultat = resultatOutil(params); return rep("end_turn", [reflexion(++nTool), texteB(texte)]); };

// ── Fonctions branchées ──
const lancements = [];
const chat = creerChat({ stock, maintenant, attendre: async (ms) => { T += ms; }, limiteIp: () => null, journal: silence, perimetre: PERIM,
  lancer: async (event, id) => { lancements.push(id); return null; } });
const tourBg = creerTour({ stock, client, maintenant, journal: silence, perimetre: PERIM });
const admin = creerAdmin({ stock, maintenant, journal: silence, verifierAdmin: async () => ({ admin: { email: "equipe@elixir.test" }, error: null }),
  nomsFiches: async (ids) => ids.map(id => ({ odoo_id: id, nom: `Fiche ${id}`, ville: null })) });
const ev = (methode, { jeton, q, corps } = {}) => ({ httpMethod: methode, headers: { host: "elixir-commande.expepharma.com", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
  queryStringParameters: q || {}, body: corps ? JSON.stringify(corps) : null });
const lit = (r) => { let corps = null; try { corps = r.body ? JSON.parse(r.body) : null; } catch { corps = r.body; } return { statut: r.statusCode, corps, entetes: r.headers || {} }; };
const post = async (jeton, corps) => lit(await chat(ev("POST", { jeton, corps })));
// un message : 202, tour joué par la fonction d'arrière-plan (lancée « à la main »), puis attente côté navigateur
async function echange(jeton, conversation_id, texte, extra = {}) {
  const r = await post(jeton, { action: "message", conversation_id, texte, ...extra });
  if (r.statut !== 202) return { envoi: r };
  const tour = lancements.at(-1);
  await tourBg({ httpMethod: "POST", headers: { "x-cron-secret": "secret-cron-test" }, body: JSON.stringify({ tour }) });
  const q = { tour: r.corps.tour_id, conversation_id, ...(extra.pour_odoo_id ? { pour_odoo_id: String(extra.pour_odoo_id) } : {}) };
  const a = lit(await chat(ev("GET", { jeton, q })));
  return { envoi: r, attente: a, message: a.corps?.message };
}
const champsInterdits = (o) => CHAMPS_INTERDITS.filter(k => JSON.stringify(o).includes(`"${k}"`));

// ════════ 1. Pharmacie A (fiche 100) au pilote, demandes en simulation ════════
reglages({ actif: true, pilote: [100], demandes: "simulation" });
let r = await post("jeton-a", { action: "etat" });
eq("etat : disponible, mode complet, coordonnées des réglages", [r.statut, r.corps.disponible, r.corps.mode, r.corps.infos?.telephone], [200, true, "complet", REGLAGES_DEFAUT.telephone]);
r = await post("jeton-b", { action: "etat" });
eq("pharmacie B (hors pilote) : indisponible", [r.corps.disponible, r.corps.raison], [false, "hors_pilote"]);
r = await post("jeton-a", { action: "ouvrir" });
const conv = r.corps.conversation_id;
eq("ouvrir : fiche vérifiée dans Odoo (nom, ville), conversation vide", [r.statut, r.corps.pharmacie, r.corps.messages, r.corps.tour_en_cours], [200, { nom: "PHARMACIE A", ville: "Ville 100" }, [], null]);

// ── Duplicata : outil réel, autorisation, chat-fichier ──
script.push(
  (params) => {
    const n = params.messages.length;
    eq("modèle : outils réels, système figé, message de la pharmacie puis contexte du serveur",
      [JSON.stringify(params.tools) === JSON.stringify(OUTILS), params.system[0].text === SYSTEME, params.messages[n - 2].role, params.messages[n - 1].role,
        params.messages[n - 1].content.includes("Pharmacie connectée : PHARMACIE A, Ville 100.")], [true, true, "user", "system", true]);
    return appelOutil("duplicata_facture", { numero: "INV/2026/40001", date: null, envoi: "telechargement" })();
  },
  reponseFinale("Voici votre facture INV/2026/40001 : elle est disponible ci-dessous."),
);
let e = await echange("jeton-a", conv, "Pouvez-vous me renvoyer la facture INV/2026/40001 ?");
eq("message : 202 puis réponse terminée", [e.envoi.statut, e.attente.statut, e.attente.corps.statut], [202, 200, "termine"]);
eq("résultat d'outil vu par le modèle : document trouvé, sans champ interdit", [dernierResultat.is_error ?? false, dernierResultat.contenu.trouve, dernierResultat.contenu.document?.numero, champsInterdits(dernierResultat.contenu)],
  [false, true, "INV/2026/40001", []]);
const carteDoc = e.message.ui_actions[0];
eq("carte document construite par le serveur", { ...carteDoc, fichier_id: /^[0-9a-f]{32}$/.test(carteDoc.fichier_id) },
  { type: "document", piece: "facture", numero: "INV/2026/40001", date: "2026-09-03", montant_ttc: 162.1, pdf_disponible: true, fichier_id: true });
eq("texte de la réponse", e.message.texte, "Voici votre facture INV/2026/40001 : elle est disponible ci-dessous.");
let f = await fichier(ev("GET", { jeton: "jeton-a", q: { id: carteDoc.fichier_id } }), { stock, ...PERIM });
eq("chat-fichier : PDF d'origine tel quel, en pièce jointe, no-store, nosniff",
  [f.statusCode, Buffer.from(f.body, "base64").toString().startsWith("%PDF-1.4 facture 40001"), f.headers["Content-Type"], /attachment; filename="Duplicata_INV_2026_40001\.pdf"/.test(f.headers["Content-Disposition"]),
    f.headers["Cache-Control"], f.headers["X-Content-Type-Options"]], [200, true, "application/pdf", true, "no-store", "nosniff"]);
f = await fichier(ev("GET", { jeton: "jeton-b", q: { id: carteDoc.fichier_id } }), { stock, ...PERIM });
eq("chat-fichier : autorisation de A présentée par B → 404", [f.statusCode, JSON.parse(f.body).error], [404, "introuvable"]);
await fichier(ev("GET", { jeton: "jeton-a", q: { id: carteDoc.fichier_id } }), { stock, ...PERIM });
await fichier(ev("GET", { jeton: "jeton-a", q: { id: carteDoc.fichier_id } }), { stock, ...PERIM });
f = await fichier(ev("GET", { jeton: "jeton-a", q: { id: carteDoc.fichier_id } }), { stock, ...PERIM });
eq("chat-fichier : 3 usages au plus, puis 404", f.statusCode, 404);

// ── Relevé : outil réel → deux autorisations, Excel servi par chat-fichier ──
script.push(appelOutil("releve_facturation", { date_debut: "2026-09-01", date_fin: "2026-09-30", detail: "par_document" }), reponseFinale("Votre relevé de septembre est prêt ci-dessous."));
e = await echange("jeton-a", conv, "Je voudrais mon relevé de septembre.");
const carteRel = e.message.ui_actions[0];
eq("carte relevé : totaux du serveur, deux fichiers", [carteRel.type, carteRel.nb_factures, carteRel.nb_avoirs, carteRel.total_ht, carteRel.total_tva, carteRel.total_ttc,
  /^[0-9a-f]{32}$/.test(carteRel.fichiers.pdf), /^[0-9a-f]{32}$/.test(carteRel.fichiers.xlsx)], ["releve", 3, 1, 370, 27.68, 397.68, true, true]);
f = await fichier(ev("GET", { jeton: "jeton-a", q: { id: carteRel.fichiers.xlsx } }), { stock, ...PERIM });
eq("chat-fichier : relevé Excel généré à la volée", [f.statusCode, f.headers["Content-Type"], Buffer.from(f.body, "base64").subarray(0, 2).toString()],
  [200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"]);

// ── Retour : outil réel → brouillon → carte → confirmation (recontrôle Odoo réel) ──
script.push(appelOutil("preparer_demande_retour", { reference_document: "S300003", motif: "retour_erreur_pharmacie", souhait: "avoir", commentaire: null,
  lignes: [{ produit: "3400930000028", quantite: 1, lot: null }] }), reponseFinale("Voici le récapitulatif : confirmez-le ci-dessous."));
e = await echange("jeton-a", conv, "Je voudrais retourner 1 Spasfon de la commande S300003, commandé par erreur.");
const recap = e.message.ui_actions[0];
eq("carte récapitulatif : document, lot unique retenu, libellés, délai (information seulement)",
  [recap.type, recap.document, recap.lignes, recap.motif, recap.souhait, /plus de 10 jours/.test(recap.info_delai)],
  ["recap_retour", { numero: "S300003", date_sortie: "2026-09-14" }, [{ produit: "SPASFON LYOC 80 mg B/10", cip: "3400930000028", lot: "SP456", peremption: "2028-04-30", quantite: 1 }],
    "Produit commandé par erreur", "Un avoir", true]);
const dem = db.tables.chat_demandes.find(d => d.id === recap.demande_id);
eq("brouillon enregistré : conversation, fiche, 30 min, numéro dès le brouillon", [dem.statut, dem.conversation_id, dem.odoo_id, Date.parse(dem.expire_at) - T, dem.numero],
  ["brouillon", conv, 100, 30 * 60e3, "R-2026-0001"]);
eq("rien n'est envoyé avant le clic", mails.length, 0);
const appelsAvant = faux.appels.length;
reglages({ actif: true, pilote: [100, 200], demandes: "simulation" });   // B au pilote : seule la propriété la refuse
r = await post("jeton-b", { action: "confirmer", conversation_id: conv, demande_id: recap.demande_id, decision: "confirmer" });
eq("confirmation par une autre pharmacie (au pilote) → 404, rien d'envoyé", [r.statut, mails.length, dem.statut], [404, 0, "brouillon"]);
r = await post("jeton-a", { action: "confirmer", conversation_id: conv, demande_id: recap.demande_id, decision: "confirmer" });
const enreg = r.corps.message?.ui_actions?.[0];
eq("confirmer : demande enregistrée (simulation), sans e-mail à la pharmacie", [r.statut, r.corps.message.id, enreg?.type, enreg?.numero, enreg?.simulation, enreg?.email_masque],
  [200, `d-${recap.demande_id}`, "demande_enregistree", "R-2026-0001", true, null]);
vrai("confirmer : recontrôle dans Odoo (livraisons et lots relus)", faux.appels.slice(appelsAvant).some(a => a.model === "stock.move.line"));
eq("un seul e-mail, à l'équipe, préfixé [SIMULATION]", [mails.length, mails[0]?.to, /^\[SIMULATION\] Demande de retour R-2026-0001/.test(mails[0]?.subject)], [1, [REGLAGES_DEFAUT.email_equipe], true]);
r = await post("jeton-a", { action: "confirmer", conversation_id: conv, demande_id: recap.demande_id, decision: "confirmer" });
eq("double clic : même demande, aucun nouvel envoi", [r.statut, r.corps.message.ui_actions[0]?.numero, mails.length], [200, "R-2026-0001", 1]);

// ── Message suivant : l'événement est dit au modèle ; transmission qualité (urgente) ──
script.push(
  (params) => {
    const sys = params.messages.at(-1);
    eq("événement vérifié transmis après le message suivant", [sys.role, sys.content.includes("Demande de retour R-2026-0001 enregistrée")], ["system", true]);
    return appelOutil("transmettre_a_un_conseiller", { categorie: "qualite", resume: "La pharmacie signale un emballage descellé sur un SPASFON du lot SP456.",
      reference: "S300003", urgence: "normale", rappel: "telephone" })();
  },
  reponseFinale("Votre signalement est transmis en urgence à l'équipe qualité."),
);
e = await echange("jeton-a", conv, "Autre chose : une boîte de Spasfon était descellée.");
eq("transmission : carte du serveur, numéro, téléphone des réglages", [e.message.ui_actions[0]?.type, e.message.ui_actions[0]?.numero, e.message.ui_actions[0]?.telephone],
  ["transmission", "T-2026-0002", REGLAGES_DEFAUT.telephone]);
eq("transmission qualité : forcée en urgente, adresse qualité", [mails.length, mails[1]?.to, /URGENT – Qualité/.test(mails[1]?.subject), /^\[SIMULATION\]/.test(mails[1]?.subject)],
  [2, [REGLAGES_DEFAUT.email_qualite], true, true]);
r = await post("jeton-a", { action: "ouvrir", conversation_id: conv });
eq("réouverture : historique affiché (textes visibles, cartes, confirmation d-<id>)",
  [r.corps.messages.length, r.corps.messages.some(m => m.id === `d-${recap.demande_id}`), /"(thinking|tool_use|tool_result|signature)"/.test(JSON.stringify(r.corps.messages))], [9, true, false]);

// ════════ 2. Mode « email » : saisie Elixir sans prévenir la pharmacie, puis pharmacie prévenue ════════
T += 61e3;
reglages({ actif: true, pilote: [100], demandes: "email" });
r = await post("jeton-admin", { action: "etat", pour_odoo_id: 100 });
eq("admin pour la fiche 100 : disponible", r.corps.disponible, true);
r = await post("jeton-admin", { action: "ouvrir", pour_odoo_id: 100 });
const convAdmin = r.corps.conversation_id;
eq("admin : conversation distincte de celle de la pharmacie", [r.corps.admin, convAdmin !== conv], ["equipe@elixir.test", true]);
script.push(appelOutil("preparer_demande_retour", { reference_document: "EP/OUT/1008", motif: "erreur_produit", souhait: "garde", commentaire: "Appel de la pharmacie.",
  lignes: [{ produit: "DAFALGAN", quantite: 2, lot: null }] }), reponseFinale("Récapitulatif prêt."));
e = await echange("jeton-admin", convAdmin, "Retour de 2 Dafalgan reçus par erreur (livraison EP/OUT/1008).", { pour_odoo_id: 100 });
const recapAdmin = e.message?.ui_actions?.[0];
eq("admin : récapitulatif (deux lots livrés, motif sans lot obligatoire)", [recapAdmin?.type, recapAdmin?.document?.numero, recapAdmin?.lignes?.[0]?.lot], ["recap_retour", "EP/OUT/1008", null]);
r = await post("jeton-admin", { action: "confirmer", pour_odoo_id: 100, conversation_id: convAdmin, demande_id: recapAdmin.demande_id, decision: "confirmer", prevenir_pharmacie: false });
eq("admin, « Prévenir la pharmacie » décoché : e-mail à l'équipe seulement", [r.statut, r.corps.message.ui_actions[0]?.simulation, r.corps.message.ui_actions[0]?.email_masque, mails.length,
  mails[2]?.to, /^\[SIMULATION\]/.test(mails[2]?.subject), /saisie Elixir par equipe@elixir\.test/.test(mails[2]?.html)], [200, false, null, 3, [REGLAGES_DEFAUT.email_equipe], false, true]);
script.push(appelOutil("preparer_demande_retour", { reference_document: "S300001", motif: "dlu_courte", souhait: "avoir", commentaire: null,
  lignes: [{ produit: "3400930000011", quantite: 1, lot: "LOTA1" }] }), reponseFinale("Récapitulatif prêt."));
e = await echange("jeton-a", conv, "Un Doliprane de la commande S300001 a une péremption trop courte.");
const recap2 = e.message.ui_actions[0];
r = await post("jeton-a", { action: "confirmer", conversation_id: conv, demande_id: recap2.demande_id, decision: "confirmer" });
eq("pharmacie en mode email : équipe, puis récapitulatif aux seules adresses du compte", [r.statut, mails.length, mails[3]?.to, mails[4]?.to, r.corps.message.ui_actions[0]?.email_masque],
  [200, 5, [REGLAGES_DEFAUT.email_equipe], ["a@pharma-a.test", "a2@pharma-a.test", "nonconf@pharma-a.test"], "a…@…test"]);

// ════════ 3. Admin : demandes et conversation ════════
let a = lit(await admin(ev("GET", { jeton: "jeton-admin", q: { vue: "demandes" } })));
eq("admin demandes : 3 retours confirmés et 1 transmission, brouillons en objet", [a.statut, a.corps.demandes.filter(d => d.type === "retour" && d.statut === "confirmee").length,
  a.corps.demandes.filter(d => d.type === "transmission").length, typeof a.corps.demandes[0].brouillon], [200, 3, 1, "object"]);
a = lit(await admin(ev("GET", { jeton: "jeton-admin", q: { vue: "conversation", id: conv } })));
eq("admin conversation : outils appelés par réponse, jamais de réflexion ni d'appel d'outil",
  [a.corps.messages.filter(m => m.role === "assistant" && m.outils?.length).map(m => m.outils[0]), /"(thinking|tool_use|tool_result|signature)"/.test(JSON.stringify(a.corps))],
  [["duplicata_facture", "releve_facturation", "preparer_demande_retour", "transmettre_a_un_conseiller", "preparer_demande_retour"], false]);
a = lit(await admin(ev("GET", { jeton: "jeton-admin", q: { vue: "reglages" } })));
eq("admin réglages : modèles acceptés, noms du pilote", [a.corps.modeles, a.corps.pilote_fiches], [["claude-opus-5-5"], [{ odoo_id: 100, nom: "Fiche 100", ville: null }]]);
a = lit(await admin(ev("GET", { jeton: "jeton-admin", q: { vue: "couts", jours: "1" } })));
eq("admin coûts du jour : tours comptés, coût > 0", [a.corps.jours[0].tours, a.corps.jours[0].cout_eur > 0], [db.tables.chat_tours.length, true]);

// ════════ 4. Garde-fous transverses ════════
eq("tous les tours terminés, aucun en erreur", db.tables.chat_tours.map(t => t.statut).filter(s => s !== "termine"), []);
eq("lectures Odoo : société 2, fiche 100, délai, aucun champ interdit", controlerAppels(faux.appels, [100]), []);
eq("aucun appel réseau hors doublures", refuses, []);
eq("aucun e-mail hors des adresses du compte et des réglages", [...new Set(mails.flatMap(m => m.to))].sort(),
  [REGLAGES_DEFAUT.email_equipe, "a2@pharma-a.test", "a@pharma-a.test", "nonconf@pharma-a.test"].sort());
eq("modèle appelé 12 fois (2 par échange)", appelsModele.length, 12);

console.log = log;
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
