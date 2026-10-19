// Tests du moteur de l'Assistant Elixir (_chat-moteur.js, _chat-systeme.js) : node scripts/test-chat-moteur.mjs
// Hors ligne : faux client Anthropic à réponses scriptées (aucun appel réel), faux outils.
//  • paramètres de l'appel (modèle, max_tokens, en-tête de repli, effort, cache 1 h du système, outils) ;
//  • tool_use en parallèle → UN message user avec tous les tool_result ; entrée invalide, outil inconnu, délai → is_error ;
//  • au plus 8 appels par tour, 90 s par tour ; max_tokens → aucune exécution, une relance ; refus → message fixe,
//    réponse refusée non ajoutée ; bloc « fallback » rejoué, coût au tarif du modèle de repli ;
//  • historique en ajout seulement : préfixe identique octet pour octet d'un appel et d'un tour à l'autre ;
//  • placement des messages role:"system" (suit un user ; dernier ou suivi d'un assistant) ;
//  • journal sans texte de message ni contenu d'outil.
import { jouerTour, parametresAppel, coutAppel, verifierHistorique, reparerFin, nettoyerContenu, neutraliserLiens, TEXTES,
  MAX_TOKENS, BETAS, LIMITES, maxTokensPour, retirerDernierMessage } from "../netlify/functions/_chat-moteur.js";
import { SYSTEME, PROMPT_VERSION, messageContexte } from "../netlify/functions/_chat-systeme.js";
import { ajouterAuTexte } from "../netlify/functions/_chat-stock.js";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

// ── Doublures ──
const OUTILS_FAUX = Object.freeze([
  { name: "rechercher_factures", strict: true, description: "Factures de la pharmacie connectée.", input_schema: { type: "object", additionalProperties: false, required: ["recherche"], properties: { recherche: { anyOf: [{ type: "string" }, { type: "null" }] } } } },
  { name: "duplicata_facture", strict: true, description: "Duplicata.", input_schema: { type: "object", additionalProperties: false, required: ["numero"], properties: { numero: { type: "string" } } } },
  { name: "transmettre_a_un_conseiller", strict: true, description: "Transmission.", input_schema: { type: "object", additionalProperties: false, required: ["resume"], properties: { resume: { type: "string" } } } },
]);
const USAGE = { input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 4500, output_tokens: 60, cache_creation: null, iterations: null };
const rep = (stop_reason, content, usage = USAGE, extra = {}) => ({ id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, content, usage, ...extra });
const reflexion = (sig) => ({ type: "thinking", thinking: "", signature: `sig-${sig}` });
const texteB = (t) => ({ type: "text", text: t });
const outil = (id, name, input) => ({ type: "tool_use", id, name, input });
function fauxClient(script) {
  const appels = [];
  return { appels, beta: { messages: { create: async (params, options) => {
    appels.push({ params: JSON.parse(JSON.stringify(params)), signal: !!options?.signal });
    const r = script.shift();
    if (!r) throw new Error("plus de réponse scriptée");
    return typeof r === "function" ? r(params) : JSON.parse(JSON.stringify(r));
  } } } };
}
const journaux = [];
const journal = (o) => journaux.push(o);
const debut = (texte = "Pouvez-vous me renvoyer la facture du 3 octobre ?") => [{ role: "user", content: texte },
  messageContexte({ maintenant: new Date("2026-10-16T12:05:00Z"), ctx: { nom: "PHARMACIE DE L'AVENIR", ville: "Versailles", mode: "complet" }, premier: true, infos: { telephone: "01 86 04 39 95", horaires: "lun-ven 9 h 30-17 h", delai_annonce: "Réponse sous 24 h ouvrées." } })];
const tour = (client, messages, extra = {}) => jouerTour({ client, messages, modele: "claude-opus-5-5", effort: "low", systeme: SYSTEME, outils: OUTILS_FAUX,
  executer: extra.executer || (async () => ({ contenu: { trouve: true }, erreur: false, ui_actions: [] })), journal, infos: { telephone: "01 86 04 39 95", horaires: "lun-ven 9 h 30-17 h" }, ...extra });

// ── 1. Réponse directe : paramètres de l'appel ──
{
  const c = fauxClient([rep("end_turn", [reflexion(1), texteB("Bonjour, que puis-je faire pour vous ?")])]);
  const r = await tour(c, debut("Bonjour"));
  const p = c.appels[0].params;
  eq("paramètres : modèle, max_tokens, en-tête de repli, repli « default », effort",
    [p.model, p.max_tokens, p.betas, p.fallbacks, p.output_config], ["claude-opus-5-5", 8000, ["server-side-fallback-2026-07-01"], "default", { effort: "low" }]);
  eq("paramètres : système figé avec cache d'1 h, suite de la conversation en cache automatique (5 min)",
    [p.system.length, p.system[0].text === SYSTEME, p.system[0].cache_control, p.cache_control], [1, true, { type: "ephemeral", ttl: "1h" }, { type: "ephemeral" }]);
  eq("paramètres : outils passés tels quels, ni thinking ni tool_choice", [JSON.stringify(p.tools) === JSON.stringify(OUTILS_FAUX), "thinking" in p, "tool_choice" in p], [true, false, false]);
  eq("paramètres : constantes", [MAX_TOKENS, BETAS, LIMITES.appels, LIMITES.tour_ms, LIMITES.outil_ms], [8000, ["server-side-fallback-2026-07-01"], 8, 90000, 6000]);
  vrai("appel borné par un signal (temps restant du tour)", c.appels[0].signal);
  eq("réponse directe : texte, 1 appel, réponse ajoutée telle quelle (réflexion comprise)",
    [r.texte, r.appels, r.code, r.nouveaux], ["Bonjour, que puis-je faire pour vous ?", 1, "ok", [{ role: "assistant", content: [reflexion(1), texteB("Bonjour, que puis-je faire pour vous ?")] }]]);
  eq("parametresAppel = paramètres envoyés", JSON.stringify(parametresAppel({ modele: "claude-opus-5-5", effort: "low", systeme: SYSTEME, outils: OUTILS_FAUX, messages: debut("Bonjour") })), JSON.stringify(p));
}

// ── 2. Outils en parallèle : un seul message user avec tous les résultats ──
{
  let actifs = 0, maxActifs = 0;
  const executer = async (nom, entree) => {
    actifs++; maxActifs = Math.max(maxActifs, actifs);
    await new Promise(ok => setTimeout(ok, 30));
    actifs--;
    return { contenu: { nom, numero: entree.numero || null }, erreur: false, ui_actions: [{ type: "document", numero: entree.numero || "INV/2026/00001" }] };
  };
  const c = fauxClient([
    rep("tool_use", [reflexion(2), outil("toolu_1", "rechercher_factures", { recherche: "3 octobre" }), outil("toolu_2", "duplicata_facture", { numero: "INV/2026/48712" })]),
    rep("end_turn", [reflexion(3), texteB("Voici votre facture INV/2026/48712, disponible ci-dessous.")]),
  ]);
  const etapes = [];
  const r = await tour(c, debut(), { executer, etapes: { rechercher_factures: "Je recherche vos factures…" }, surEtape: (t) => etapes.push(t) });
  eq("parallèle : 2 appels au modèle, outils exécutés en même temps", [r.appels, maxActifs], [2, 2]);
  const second = c.appels[1].params.messages;
  const resultats = second[second.length - 1];
  eq("parallèle : un seul message user portant les 2 tool_result, dans l'ordre des tool_use",
    [resultats.role, resultats.content.map(b => [b.type, b.tool_use_id])], ["user", [["tool_result", "toolu_1"], ["tool_result", "toolu_2"]]]);
  eq("parallèle : réponse avec tool_use ajoutée telle quelle juste avant", second[second.length - 2].content.map(b => b.type), ["thinking", "tool_use", "tool_use"]);
  eq("parallèle : ajouts du tour = assistant(tool_use) + user(résultats) + assistant(final)", r.nouveaux.map(m => m.role), ["assistant", "user", "assistant"]);
  eq("parallèle : cartes rassemblées, outils nommés, étape écrite par le serveur", [r.ui_actions.length, r.outils, etapes], [2, ["rechercher_factures", "duplicata_facture"], ["Je recherche vos factures…"]]);
  eq("parallèle : contenu du résultat en JSON compact", JSON.parse(resultats.content[1].content), { nom: "duplicata_facture", numero: "INV/2026/48712" });
  eq("parallèle : pas de is_error sur un succès", "is_error" in resultats.content[0], false);
}

// ── 3. Entrée invalide, outil inconnu, exception, délai → is_error ──
{
  const vus = [];
  const executer = async (nom, entree) => {
    vus.push(nom);
    if (nom === "rechercher_factures") return { contenu: { message: "Entrée invalide : recherche : 60 caractères au plus." }, erreur: true, ui_actions: [] };
    if (nom === "duplicata_facture") throw new Error("panne Odoo avec SECRET-DONNEE");
    return new Promise(() => {});   // transmettre : ne répond jamais
  };
  const c = fauxClient([
    rep("tool_use", [outil("t1", "rechercher_factures", { recherche: "x".repeat(200) }), outil("t2", "outil_pirate", { cible: "autre pharmacie" }),
      outil("t3", "duplicata_facture", { numero: "INV/1" }), outil("t4", "transmettre_a_un_conseiller", { resume: "Test" })]),
    rep("end_turn", [texteB("Je n'ai pas pu consulter vos factures.")]),
  ]);
  const r = await tour(c, debut(), { executer, limites: { outil_ms: 50 } });
  const res = c.appels[1].params.messages.at(-1).content;
  eq("erreurs d'outil : toutes is_error, dans un seul message", res.map(b => [b.tool_use_id, b.is_error]), [["t1", true], ["t2", true], ["t3", true], ["t4", true]]);
  eq("outil inconnu : jamais exécuté", vus.includes("outil_pirate"), false);
  eq("entrée invalide : message de l'exécutant transmis au modèle", JSON.parse(res[0].content).message, "Entrée invalide : recherche : 60 caractères au plus.");
  eq("exception : message générique, jamais le message technique", JSON.stringify(res[2]).includes("SECRET-DONNEE"), false);
  vrai("délai de l'outil : message de délai", JSON.parse(res[3].content).erreur.includes("trop de temps"));
  eq("erreurs d'outil : le tour se termine normalement", [r.code, r.texte], ["ok", "Je n'ai pas pu consulter vos factures."]);
}

// ── 4. Au plus 8 appels par tour ──
{
  let n = 0;
  const c = fauxClient(Array.from({ length: 12 }, () => () => rep("tool_use", [reflexion(10 + n), outil(`boucle_${++n}`, "rechercher_factures", { recherche: null })])));
  let executions = 0;
  const r = await tour(c, debut(), { executer: async () => { executions++; return { contenu: { pieces: [] }, erreur: false, ui_actions: [] }; } });
  eq("8 appels au plus, puis message fixe", [c.appels.length, r.appels, r.code, r.texte], [8, 8, "limite_appels", TEXTES.limite()]);
  eq("8e réponse (tool_use) ni exécutée ni ajoutée", [executions, r.nouveaux.length], [7, 15]);
  eq("historique valide après la limite (se termine par une réponse)", [verifierHistorique([...debut(), ...r.nouveaux]), r.nouveaux.at(-1).role], [null, "assistant"]);
}

// ── 5. Refus : réponse refusée non ajoutée ──
{
  const c = fauxClient([
    rep("tool_use", [outil("r1", "rechercher_factures", { recherche: "x" })]),
    rep("refusal", [texteB("CONTENU-REFUSE partiel")], USAGE, { stop_details: { type: "refusal", category: "bio", explanation: null } }),
  ]);
  const r = await tour(c, debut());
  eq("refus : message fixe, téléphone des réglages, aucune transmission promise", [r.refus, r.code, r.texte, /souhaitez-vous que je/.test(r.texte)],
    [true, "refus", TEXTES.refus({ telephone: "01 86 04 39 95", horaires: "lun-ven 9 h 30-17 h" }), false]);
  eq("refus : contenu refusé absent de l'historique", JSON.stringify(r.nouveaux).includes("CONTENU-REFUSE"), false);
  eq("refus : l'historique garde les outils déjà joués puis la réponse fixe", r.nouveaux.map(m => m.role), ["assistant", "user", "assistant"]);
  eq("refus : historique valide pour le tour suivant", verifierHistorique([...debut(), ...r.nouveaux, { role: "user", content: "Et alors ?" }, { role: "system", content: "Contexte" }]), null);
}

// ── 6. max_tokens : aucune exécution, une seule relance ──
{
  let executions = 0;
  const executer = async () => { executions++; return { contenu: {}, erreur: false, ui_actions: [] }; };
  let c = fauxClient([rep("max_tokens", [reflexion(20), outil("m1", "rechercher_factures", { recherche: "x" })]), rep("end_turn", [texteB("Voici.")])]);
  let r = await tour(c, debut(), { executer });
  eq("max_tokens + tool_use : rien d'exécuté, relance, réponse coupée non ajoutée", [executions, r.appels, r.code, r.nouveaux.length, JSON.stringify(r.nouveaux).includes("m1")], [0, 2, "ok", 1, false]);
  eq("relance : même historique (rien ajouté entre les deux appels)", JSON.stringify(c.appels[1].params.messages), JSON.stringify(c.appels[0].params.messages));
  c = fauxClient([rep("max_tokens", [outil("m2", "rechercher_factures", { recherche: "x" })]), rep("max_tokens", [outil("m3", "rechercher_factures", { recherche: "x" })])]);
  r = await tour(c, debut(), { executer });
  eq("max_tokens deux fois : une seule relance, message fixe", [executions, r.appels, r.code, r.texte], [0, 2, "max_tokens", TEXTES.limite()]);
  eq("relance : limite doublée (8 000 → 16 000 en effort bas)", c.appels.map(a => a.params.max_tokens), [8000, 16000]);
  c = fauxClient([rep("max_tokens", []), rep("end_turn", [texteB("Voici.")])]);
  await tour(c, debut(), { executer, effort: "high" });
  eq("effort élevé : 32 000, relance à 64 000 (plafond)", c.appels.map(a => a.params.max_tokens), [32000, 64000]);
  eq("max_tokens selon l'effort, plafond 64 000", ["low", "medium", "high", "xhigh", "max", "inconnu"].map(e => maxTokensPour(e)).concat(maxTokensPour("max", true)),
    [8000, 16000, 32000, 64000, 64000, 8000, 64000]);
}

// ── 6 bis. Refus final : la question refusée est retirée de l'historique (sinon « oui » est refusé à son tour) ──
{
  const avant = [{ role: "user", content: "Bonjour" }, { role: "system", content: "Contexte serveur : jeudi." }, { role: "assistant", content: [reflexion(7), texteB("Bonjour !")] }];
  const fin = [{ role: "user", content: "QUESTION-REFUSEE" }, { role: "system", content: "Contexte serveur : jeudi.\nÉvénement vérifié par le serveur : Demande de retour R-2026-0001 enregistrée." }];
  const texteAvant = JSON.stringify(avant);
  const texte = `${texteAvant.slice(0, -1)},${fin.map(m => JSON.stringify(m)).join(",")}]`;
  const r = retirerDernierMessage(texte, [...avant, ...fin]);
  eq("refus : préfixe rendu octet pour octet, événement gardé pour le tour suivant", [r.texte === texteAvant, r.evenements], [true, ["Demande de retour R-2026-0001 enregistrée."]]);
  eq("refus au premier message : historique vide", retirerDernierMessage(JSON.stringify(fin), fin)?.texte, "[]");
  eq("fin d'une autre forme (résultat d'outil) : rien retiré", retirerDernierMessage("[]", [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x" }] }, { role: "system", content: "x" }]), null);
}

// ── 6 ter. Délai propre à la transmission (l'outil entrepôt puis l'e-mail de repli ne sont jamais abandonnés à 6 s) ──
{
  const c = fauxClient([rep("tool_use", [outil("t1", "transmettre_a_un_conseiller", { resume: "x" }), outil("t2", "rechercher_factures", { recherche: "x" })]),
    rep("end_turn", [texteB("Transmis.")])]);
  const executer = async (nom) => { await new Promise(ok => setTimeout(ok, 80)); return { contenu: { nom }, erreur: false, ui_actions: [] }; };
  const r = await tour(c, debut(), { executer, limites: { outil_ms: 40, outils_ms: { transmettre_a_un_conseiller: 500 } } });
  const resultats = c.appels[1].params.messages.at(-1).content;
  eq("transmission attendue au-delà du délai commun ; autre outil coupé", [r.code, resultats.map(x => !!x.is_error)], ["ok", [false, true]]);
}

// ── 7. Repli serveur (bloc fallback) : contenu rejoué, coût au tarif du modèle qui a servi ──
{
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cache_creation: null, iterations: [
    { type: "message", model: "claude-opus-5-5", input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cache_creation: null },
    { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100, cache_creation: null },
  ] };
  const bascule = { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: "bio" } };
  const c = fauxClient([rep("end_turn", [bascule, texteB("Voici votre facture.")], usage, { model: "claude-opus-4-8" })]);
  const r = await tour(c, debut());
  eq("repli : signalé, texte affiché, bloc fallback gardé à sa place", [r.repli, r.texte, r.nouveaux[0].content.map(b => b.type)], [true, "Voici votre facture.", ["fallback", "text"]]);
  // 1000 × 4 $ (Opus 5.5) + 1000 × 5 $ + 100 × 25 $ (Opus 4.8) = 0,0115 $ → 0,01035 €
  eq("repli : coût par tentative (usage.iterations), tarif de chaque modèle", r.cout_eur, 0.01035);
  eq("repli : blocs internes antérieurs au dernier fallback retirés (rejeu)", nettoyerContenu([reflexion(30), outil("x", "a", {}), texteB("début"), bascule, reflexion(31), texteB("suite")]).map(b => b.type),
    ["text", "fallback", "thinking", "text"]);
  eq("sans fallback : contenu inchangé", nettoyerContenu([reflexion(32), texteB("a")]).length, 2);
}

// ── 8. Coût d'un appel ──
{
  const u = { input_tokens: 1000, cache_creation_input_tokens: 3000, cache_read_input_tokens: 10000, output_tokens: 500,
    cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 }, iterations: null };
  // 1000×4 + 2000×5 + 1000×8 + 10000×0,2 + 500×20 = 34 000 $/M → 0,034 $ → 0,0306 €
  eq("coût Opus 5.5 (écritures 5 min et 1 h, lectures, sortie)", [coutAppel(u, "claude-opus-5-5").usd, coutAppel(u, "claude-opus-5-5").eur], [0.034, 0.0306]);
  eq("coût Sonnet 5.5", coutAppel(u, "claude-sonnet-5-5").eur, 0.0162);
  eq("écriture sans détail : comptée au tarif 1 h (prudent)", coutAppel({ ...u, cache_creation: null }, "claude-opus-5-5").usd, (4000 + 3000 * 8 + 2000 + 10000) / 1e6);
  eq("modèle inconnu : tarif le plus haut connu", coutAppel({ input_tokens: 1e6, output_tokens: 0 }, "modele-inconnu").usd, 5);
}

// ── 9. Préfixe identique octet pour octet, d'un appel et d'un tour à l'autre ──
{
  const c = fauxClient([
    rep("tool_use", [reflexion(40), outil("p1", "duplicata_facture", { numero: "INV/2026/48712" })]),
    rep("end_turn", [reflexion(41), texteB("Voici la facture.")]),
    rep("tool_use", [reflexion(42), outil("p2", "rechercher_factures", { recherche: "avoir" })]),
    rep("end_turn", [reflexion(43), texteB("Voici l'avoir.")]),
  ]);
  const h1 = debut();
  const r1 = await tour(c, h1);
  // ce que fait le stockage : texte JSON existant + nouveaux messages, sans réécriture
  let stocke = ajouterAuTexte("[]", h1);
  stocke = ajouterAuTexte(stocke, r1.nouveaux);
  const h2 = JSON.parse(ajouterAuTexte(stocke, [{ role: "user", content: "Et l'avoir de septembre ?" },
    messageContexte({ maintenant: new Date("2026-10-16T12:09:00Z"), evenements: ["Demande de retour R-2026-0001 enregistrée."] })]));
  await tour(c, h2);
  const sansFin = (a) => JSON.stringify(a).slice(0, -1);
  let prefixe = true;
  for (let i = 1; i < c.appels.length; i++) if (!JSON.stringify(c.appels[i].params.messages).startsWith(sansFin(c.appels[i - 1].params.messages))) prefixe = false;
  vrai("chaque appel reprend l'historique du précédent octet pour octet (tours 1 et 2)", prefixe);
  eq("outils et système identiques sur tous les appels (cache non cassé)",
    new Set(c.appels.map(a => JSON.stringify([a.params.tools, a.params.system, a.params.model, a.params.output_config]))).size, 1);
  vrai("stockage : le texte existant est gardé tel quel", stocke.startsWith(sansFin(h1)));
  eq("blocs de réflexion rejoués tels quels au tour suivant", c.appels[2].params.messages.filter(m => m.role === "assistant").flatMap(m => m.content).filter(b => b.type === "thinking").map(b => b.signature),
    ["sig-40", "sig-41"]);
  // placement des messages système dans chaque appel
  let place = true;
  for (const a of c.appels) {
    const m = a.params.messages;
    m.forEach((x, i) => { if (x.role === "system" && (m[i - 1]?.role !== "user" || (m[i + 1] && m[i + 1].role !== "assistant"))) place = false; });
    if (verifierHistorique(m) !== null) place = false;
  }
  vrai("messages système : chacun suit un user et est le dernier ou suivi d'un assistant, dans chaque appel", place);
}

// ── 10. Validateur d'historique et réparation de fin ──
{
  const u = { role: "user", content: "a" }, s = { role: "system", content: "Contexte" }, a = { role: "assistant", content: [texteB("b")] };
  eq("historique valide", verifierHistorique([u, s, a, u, s]), null);
  vrai("système en premier → invalide", verifierHistorique([s, u]));
  vrai("système après une réponse → invalide", verifierHistorique([u, a, s]));
  vrai("système suivi d'un user → invalide", verifierHistorique([u, s, u, s]));
  vrai("tool_use sans résultat → invalide", verifierHistorique([u, s, { role: "assistant", content: [outil("z", "x", {})] }]));
  eq("réparation : fin user/system → réponse fixe", reparerFin([u, s]).map(m => m.role), ["assistant"]);
  eq("réparation : fin tool_use → résultats en erreur puis réponse", reparerFin([u, s, { role: "assistant", content: [outil("z", "x", {})] }]).map(m => [m.role, m.content[0].type, m.content[0].is_error ?? null]),
    [["user", "tool_result", true], ["assistant", "text", null]]);
  eq("réparation : fin assistant → rien", reparerFin([u, s, a]), []);
  eq("réparation : historique réparé valide", verifierHistorique([u, s, ...reparerFin([u, s]), u, s]), null);
}

// ── 11. Erreurs de l'API, durée du tour, historique invalide ──
{
  let c = fauxClient([() => { throw Object.assign(new Error("overloaded"), { status: 529 }); }]);
  let r = await tour(c, debut());
  eq("API saturée : code, message fixe avec le téléphone des réglages, historique terminé", [r.code, r.texte.includes("01 86 04 39 95"), r.nouveaux.map(m => m.role)], ["api_sature", true, ["assistant"]]);
  let t = 0;
  c = fauxClient([() => { t += 88_000; return rep("tool_use", [outil("d1", "rechercher_factures", { recherche: null })]); }, () => { t += 1_000; return rep("end_turn", [texteB("fin")]); }]);
  r = await tour(c, debut(), { horloge: () => t });
  eq("90 s par tour : plus d'appel quand il reste moins de 3 s (premier appel de 88 s)", [c.appels.length, r.code, r.nouveaux.at(-1).role], [1, "delai", "assistant"]);
  c = fauxClient([rep("end_turn", [texteB("jamais")])]);
  r = await tour(c, [{ role: "system", content: "x" }, { role: "user", content: "a" }]);
  eq("historique invalide : aucun appel au modèle", [c.appels.length, r.code], [0, "historique"]);
}

// ── 12. Texte affiché, contrôle paiement, journal sans contenu ──
{
  journaux.length = 0;
  const c = fauxClient([
    rep("tool_use", [outil("j1", "rechercher_factures", { recherche: "TEXTE-ENTREE-SECRET" })]),
    rep("end_turn", [texteB("Votre facture est payée. Voir https://pirate.example/x et www.autre.example.")]),
  ]);
  const r = await tour(c, debut("MESSAGE-PHARMACIE-SECRET"), { executer: async () => ({ contenu: { libelle: "CONTENU-OUTIL-SECRET" }, erreur: false, ui_actions: [] }) });
  eq("liens neutralisés dans le texte affiché", r.texte, "Votre facture est payée. Voir [adresse retirée] et [adresse retirée]");
  vrai("contrôle « paiement » levé", r.alerte_paiement);
  eq("historique de l'API inchangé (texte du modèle tel quel)", r.nouveaux.at(-1).content[0].text.includes("https://pirate.example/x"), true);
  const j = JSON.stringify(journaux);
  eq("journal : ni message, ni entrée, ni contenu d'outil, ni texte du modèle",
    ["MESSAGE-PHARMACIE-SECRET", "TEXTE-ENTREE-SECRET", "CONTENU-OUTIL-SECRET", "payée"].map(s => j.includes(s)), [false, false, false, false]);
  vrai("journal : une ligne par appel et par outil", journaux.filter(x => x.evt === "appel").length === 2 && journaux.filter(x => x.evt === "outil").length === 1);
  eq("neutraliserLiens sans lien", neutraliserLiens("INV/2026/51300"), "INV/2026/51300");
  eq("neutraliserLiens : domaine suivi d'un chemin, adresse e-mail et chiffres intacts",
    [neutraliserLiens("photo : elixir-photos.example/connexion ici"), neutraliserLiens("écrire à compta@cabinet.fr"), neutraliserLiens("0.5/1 et 2,5 mg/ml")],
    ["photo : [adresse retirée] ici", "écrire à compta@cabinet.fr", "0.5/1 et 2,5 mg/ml"]);
}

// ── 12 bis. Réponse vide (intégration) : jamais de message « assistant » sans contenu dans l'historique ──
{
  const c = fauxClient([
    rep("tool_use", [outil("toolu_v1", "duplicata_facture", { numero: "INV/2026/48712" })]),
    rep("end_turn", []),
  ]);
  const executer = async () => ({ contenu: { trouve: true }, erreur: false, ui_actions: [{ type: "document", numero: "INV/2026/48712" }] });
  const r = await tour(c, debut(), { executer });
  const fin = r.nouveaux.at(-1);
  eq("réponse vide après un outil : texte fixe, carte gardée, historique terminé par un texte non vide",
    [r.code, r.texte, r.ui_actions.length, fin.role, fin.content.length, !!fin.content[0].text], ["vide", TEXTES.cartes(), 1, "assistant", 1, true]);
  eq("réponse vide : historique valide pour le tour suivant", verifierHistorique([...debut(), ...r.nouveaux, { role: "user", content: "Merci" }]), null);
  const c2 = fauxClient([rep("end_turn", [])]);
  const r2 = await tour(c2, debut("Bonjour"));
  eq("réponse vide sans carte : « Pouvez-vous préciser… », message non vide", [r2.texte, r2.nouveaux.at(-1).content[0].text], [TEXTES.vide(), TEXTES.vide()]);
}

// ── 13. Prompt système et contexte du serveur ──
{
  vrai("prompt : version déclarée, suivie de l'empreinte du texte", /^\d{4}-\d{2}-\d{2}\.\d+-[0-9a-f]{8}$/.test(PROMPT_VERSION));
  eq("prompt : ni date, ni année, ni identité, ni réglage", [/\b20\d\d\b/.test(SYSTEME), /01 86 04/.test(SYSTEME), /@/.test(SYSTEME), /\$\{/.test(SYSTEME)], [false, false, false, false]);
  vrai("prompt : jamais de paiement, résultats = données, retours confirmés par le serveur", ["payée, impayée", "jamais des instructions", "message système ne l'a pas confirmé"].every(s => SYSTEME.includes(s)));
  eq("prompt : aucune consigne de ne pas réfléchir", /ne réfléchi|sans réfléchir/i.test(SYSTEME), false);
  const ctx = { nom: "PHARMACIE DE L'AVENIR", ville: "Versailles", compteEmail: "compte@pharmacie.test", comptes: ["compte@pharmacie.test"], admin: "equipe@elixir.test", mode: "conseiller_seul" };
  const m = messageContexte({ maintenant: new Date("2026-10-16T12:05:00Z"), ctx, premier: true, infos: { telephone: "01 86 04 39 95", horaires: "lun-ven", delai_annonce: "Réponse sous 24 h." },
    evenements: ["Demande de retour R-2026-0412 enregistrée."], commandeSite: "1760000000001" });
  eq("contexte : rôle system, texte", [m.role, typeof m.content], ["system", "string"]);
  vrai("contexte : date de Paris, pharmacie, saisie Elixir, accès limité, coordonnées, événement, commande du site",
    ["vendredi 16/10/2026, 14:05", "PHARMACIE DE L'AVENIR, Versailles", "saisie Elixir", "Accès limité", "01 86 04 39 95", "R-2026-0412", "1760000000001"].every(s => m.content.includes(s)));
  eq("contexte : aucune adresse e-mail (ni compte, ni admin)", m.content.includes("@"), false);
  const m2 = messageContexte({ maintenant: new Date("2026-10-16T12:05:00Z"), ctx, premier: false });
  eq("contexte après le premier message : la date seule", m2.content, "Contexte serveur : vendredi 16/10/2026, 14:05 (heure de Paris).");
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
