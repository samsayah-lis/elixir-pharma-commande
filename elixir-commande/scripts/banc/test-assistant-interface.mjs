// Tests de l'interface de l'Assistant Elixir (lot 4) : node scripts/banc/test-assistant-interface.mjs
// Aucun appel réseau : fetch, localStorage et sessionStorage sont des doublures. Couvre :
//  1. l'afficheur sûr (texte-sur.js) : gras, retours à la ligne, listes « - » ; balises, liens et images restent du texte ;
//  2. les formats français des cartes (format.js) ;
//  3. la conversation fictive des aperçus (cas « chat » de src/dev/reponses-fictives.js) : formes du contrat ;
//  4. les appels au serveur (assistant-client.js, assistant/api.js) : jeton, pour_odoo_id, 401 rejoué, erreurs, attente ;
//  5. le rendu des cartes et du panneau (React côté serveur, via esbuild) : aucun lien hors tel:, aucune image, a11y ;
//  6. la fenêtre de présentation et le lanceur flottant (presentation.js, Presentation.jsx, CoucheAssistant d'Aide.jsx) :
//     règles d'affichage par compte et par session, clavier, rendu, absence du bundle des pharmacies.
import { build } from "esbuild";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseTexte, segments } from "../../src/components/assistant/texte-sur.js";
import { dateFr, peremptionFr, heureFr, dateHeureFr, libelleCommande, tauxFr, pluriel, lienTel, nomFichier, qteFr } from "../../src/components/assistant/format.js";
import { reponseFictive, reponseChatFictive, FICHIERS_FICTIFS, idBonFictif } from "../../src/dev/reponses-fictives.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };

// ── 1. afficheur sûr ──
eq("gras", segments("a **b** c"), [{ texte: "a ", gras: false }, { texte: "b", gras: true }, { texte: " c", gras: false }]);
eq("« ** » sans fermeture : texte", segments("prix **net"), [{ texte: "prix **net", gras: false }]);
eq("paragraphes et liste", analyseTexte("Bonjour\nligne 2\n\n- un\n- **deux**\nfin").map(b => b.type), ["para", "liste", "para"]);
eq("retours à la ligne gardés", analyseTexte("a\nb")[0].lignes.length, 2);
{
  const piege = '<a href="javascript:alert(1)">x</a> <img src=x onerror=alert(1)> https://exemple.fr ![i](http://x/y.png) [lien](http://x)';
  const b = analyseTexte(piege);
  eq("balises, liens et images : un seul segment de texte brut", b, [{ type: "para", lignes: [[{ texte: piege, gras: false }]] }]);
}
eq("titre Markdown : texte", analyseTexte("# Titre")[0].lignes[0][0].texte, "# Titre");
eq("texte nul", analyseTexte(null), []);
vrai("texte trop long coupé", analyseTexte("x".repeat(9000))[0].lignes[0][0].texte.length <= 8001);

// ── 2. formats ──
eq("date", dateFr("2026-10-03"), "03/10/2026");
eq("péremption", peremptionFr("2028-04-30"), "04/2028");
eq("heure de Paris (été)", heureFr("2026-10-16T12:05:00Z"), "14\u00a0h\u00a005");
eq("heure de Paris (hiver)", heureFr("2026-12-01T08:30:00Z"), "09\u00a0h\u00a030");
eq("date seule", dateHeureFr("2026-10-16"), "16/10/2026");
eq("date et heure", dateHeureFr("2026-10-16T12:05:00Z"), "16/10/2026 à 14\u00a0h\u00a005");
eq("pastille de contexte", libelleCommande("2026-10-14T08:32:00Z"), "Commande du 14 octobre, 10\u00a0h\u00a032");
eq("pastille sans date", libelleCommande(undefined), "Commande");
eq("taux de TVA", [tauxFr(2.1), tauxFr(20), tauxFr(5.5)], ["2,1\u00a0%", "20\u00a0%", "5,5\u00a0%"]);
eq("taux de TVA inconnu (relevé : taxe hors pourcentage)", [tauxFr(null), tauxFr(0)], ["Autre", "0\u00a0%"]);
eq("pluriel", [pluriel(1, "facture"), pluriel(41, "facture"), pluriel(0, "avoir")], ["1 facture", "41 factures", "0 avoir"]);
eq("quantité", qteFr(1500), (1500).toLocaleString("fr-FR"));
eq("lien tel:", lienTel("01 86 04 39 95"), "tel:0186043995");
eq("lien tel: refusé", [lienTel("javascript:alert(1)"), lienTel(""), lienTel("12")], [null, null, null]);
eq("nom de fichier (filename*)", nomFichier("attachment; filename*=UTF-8''Relev%C3%A9_09.pdf", "x.pdf"), "Relevé_09.pdf");
eq("nom de fichier (filename)", nomFichier('attachment; filename="Duplicata_INV_2026_51300.pdf"', "x.pdf"), "Duplicata_INV_2026_51300.pdf");
eq("nom de fichier nettoyé", nomFichier('attachment; filename="../../etc/passwd"', "x.pdf"), ".._.._etc_passwd");
eq("nom de fichier absent", nomFichier(null, "Duplicata.pdf"), "Duplicata.pdf");

// ── 3. conversation fictive ──
const TYPES = ["document", "documents", "releve", "commande", "bons_livraison", "recap_retour", "demande_enregistree", "transmission", "erreur"];
const formeMessage = (m) => m && typeof m.id === "string" && m.role === "assistant" && typeof m.texte === "string"
  && Array.isArray(m.ui_actions) && !Number.isNaN(Date.parse(m.at)) && m.ui_actions.every(a => TYPES.includes(a.type));
eq("etat", reponseFictive({ fn: "chat", corps: { action: "etat" } }).disponible, true);
{
  const o = reponseFictive({ fn: "chat", corps: { action: "ouvrir" } });
  vrai("ouvrir : forme du contrat", typeof o.conversation_id === "string" && o.apercu === true && Array.isArray(o.messages) && o.infos?.telephone && o.mode === "complet");
  eq("ouvrir pour une pharmacie : nom laissé au panneau", reponseChatFictive({ action: "ouvrir", pour_odoo_id: 595 }).pharmacie.nom, "");
}
const question = (texte, contexte) => reponseChatFictive({ action: "message", conversation_id: "c", texte, ...(contexte ? { contexte } : {}) });
const premiereCarte = (texte, contexte) => question(texte, contexte).message.ui_actions[0]?.type ?? null;
eq("pastilles d'accueil → cartes", [
  premiereCarte("Je voudrais le duplicata d'une facture."), premiereCarte("Je voudrais un relevé de facturation."),
  premiereCarte("Où en est ma commande ?"), premiereCarte("Je voudrais un bon de livraison."), premiereCarte("Je voudrais faire une demande de retour ou une réclamation."),
  premiereCarte("Je voudrais parler à un conseiller."), premiereCarte("Bonjour"),
], ["documents", "releve", "commande", "bons_livraison", "recap_retour", "transmission", null]);
{
  const un = question("Je voudrais le bon de livraison EP/OUT/190087.").message.ui_actions[0];
  eq("bon de livraison cité (bouton de la carte commande) : ce bon seul, son autorisation", [un.type, un.items.map(i => i.numero), un.fichier_id],
    ["bons_livraison", ["EP/OUT/190087"], idBonFictif(1)]);
  const tous = question("Je voudrais un bon de livraison.").message.ui_actions[0];
  eq("bons de livraison : trois bons, une autorisation pour tous", [tous.items.length, tous.fichier_id, tous.items.map(i => [i.renvoi, i.reste_a_livrer])],
    [3, FICHIERS_FICTIFS.bl, [[false, true], [false, false], [true, false]]]);
}
eq("choix d'un document → duplicata", premiereCarte("Le document INV/2026/90388"), "document");
eq("avoir sans PDF", question("Le document RINV/2026/09021").message.ui_actions[0].fichier_id, null);
eq("question sur une commande du site", question("Une question", { commande_site_id: "1700000000003" }).message.ui_actions[0].commande_site_id, "1700000000003");
{
  const r = question("toutes les cartes");
  vrai("message : tour_id + message", typeof r.tour_id === "string" && formeMessage(r.message));
  eq("toutes les cartes (sauf « demande enregistrée », qui suit une confirmation)", [...new Set(r.message.ui_actions.map(a => a.type))].sort(),
    TYPES.filter(t => t !== "demande_enregistree").sort());
  const releve = r.message.ui_actions.find(a => a.type === "releve");
  eq("relevé : HT + TVA = TTC", Math.round((releve.total_ht + releve.total_tva) * 100) / 100, releve.total_ttc);
  eq("relevé : TVA par taux = TVA", Math.round(releve.tva.reduce((s, l) => s + l.montant, 0) * 100) / 100, releve.total_tva);
  eq("relevé : fichiers", releve.fichiers, { pdf: FICHIERS_FICTIFS.releve_pdf, xlsx: FICHIERS_FICTIFS.releve_xlsx });
  const recap = r.message.ui_actions.find(a => a.type === "recap_retour");
  vrai("récapitulatif : demande_id et expiration", recap.demande_id && Date.parse(recap.expire_at) > Date.now());
}
{
  const c = reponseChatFictive({ action: "confirmer", demande_id: "d", decision: "confirmer" }).message;
  vrai("confirmer → demande enregistrée (simulation)", formeMessage(c) && c.ui_actions[0].type === "demande_enregistree" && c.ui_actions[0].simulation === true);
  eq("annuler → texte", reponseChatFictive({ action: "confirmer", demande_id: "d", decision: "annuler" }).message.texte, "Demande annulée : rien n'a été envoyé.");
}
vrai("chaque réponse a la forme MessageAffiche", ["duplicata", "relevé", "commande", "retour", "conseiller", "toutes les cartes", "x"].every(t => formeMessage(question(t).message)));

// ── 4. appels au serveur (doublures) ──
const stockage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
for (const nom of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, nom, { value: stockage(), configurable: true, writable: true });
let appels = [], repondre = () => new Response("{}", { status: 200 });
globalThis.fetch = async (url, options = {}) => {
  const a = { url: String(url), methode: options.method || "GET", entetes: options.headers || {}, corps: options.body ? JSON.parse(options.body) : null };
  appels.push(a);
  return repondre(a, appels.length);
};
const json = (statut, corps) => new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });
const { etatAssistant, authAssistant } = await import("../../src/assistant-client.js");
const api = await import("../../src/components/assistant/api.js");
const { requeteAssistant } = api;
const reinit = () => { appels = []; globalThis.localStorage.clear(); globalThis.sessionStorage.clear(); };

reinit(); globalThis.localStorage.setItem("pharmacy_token", "jeton-pharmacie"); globalThis.localStorage.setItem("admin_token", "jeton-admin");
repondre = () => json(200, { disponible: true, mode: "complet", raison: null });
await requeteAssistant("chat", { corps: { action: "etat" }, auth: authAssistant(null) });
eq("pharmacie : jeton pharmacie, pas de pour_odoo_id", [appels[0].entetes.Authorization, appels[0].corps], ["Bearer jeton-pharmacie", { action: "etat" }]);
appels = [];
await requeteAssistant("chat", { corps: { action: "etat" }, auth: authAssistant({ odoo_id: 595, name: "X" }) });
eq("saisie Elixir : jeton admin + pour_odoo_id", [appels[0].entetes.Authorization, appels[0].corps], ["Bearer jeton-admin", { action: "etat", pour_odoo_id: 595 }]);
appels = [];
await requeteAssistant("chat-fichier", { query: { id: "ab" }, auth: authAssistant({ odoo_id: 595 }), brut: true });
vrai("saisie Elixir, GET : pour_odoo_id dans la requête", /chat-fichier\?id=ab&pour_odoo_id=595$/.test(appels[0].url), appels[0].url);

// 401 : un renouvellement du jeton, puis l'appel rejoué une fois
reinit(); globalThis.localStorage.setItem("pharmacy_token", "vieux"); globalThis.localStorage.setItem("pharmacy_refresh_token", "rt");
repondre = (a) => a.url.includes("admin-refresh") ? json(200, { success: true, token: "neuf", refresh_token: "rt2" })
  : a.entetes.Authorization === "Bearer neuf" ? json(200, { conversation_id: "c1", messages: [] }) : json(401, { error: "reconnexion" });
const o = await api.ouvrir(authAssistant(null), null);
eq("401 → jeton renouvelé, appel rejoué", [o.conversation_id, appels.map(a => a.url.replace("/.netlify/functions/", ""))], ["c1", ["chat", "admin-refresh", "chat"]]);
reinit(); globalThis.localStorage.setItem("pharmacy_token", "vieux");
repondre = () => json(401, { error: "reconnexion" });
let e = await api.ouvrir(authAssistant(null), null).catch(x => x);
eq("401 sans jeton de renouvellement (ancien mode) → reconnexion, sans rejeu", [e.code, appels.length], ["reconnexion", 1]);

// erreurs → codes et messages
const essaiErreur = async (statut, corps) => { reinit(); repondre = () => json(statut, corps); return api.envoyer(authAssistant(null), "c", "t").catch(x => x); };
e = await essaiErreur(429, { error: "quota", message: "Trop de messages : réessayez dans une heure." });
eq("429 : message du serveur", [e.code, e.message], ["quota", "Trop de messages : réessayez dans une heure."]);
e = await essaiErreur(503, { error: "indisponible" });
eq("503 sans message : texte par défaut", [e.code, /indisponible/.test(e.message)], ["indisponible", true]);
e = await essaiErreur(409, { error: "tour_en_cours", message: "<b>texte du serveur ignoré</b>" });
eq("409", [e.code, /patientez/.test(e.message)], ["tour_en_cours", true]);
e = await essaiErreur(403, { error: "fiche" });
eq("403", e.code, "fiche");
e = await essaiErreur(409, { error: "tour_en_cours", tour_id: "t-en-cours" });
eq("409 : tour en cours transmis (le panneau le suit)", [e.code, e.tourId], ["tour_en_cours", "t-en-cours"]);
e = await essaiErreur(410, { error: "conversation_fermee", message: "texte du serveur" });
eq("410 conversation fermée (autre poste, mise à jour) : code propre, texte du panneau (pas celui des liens expirés)",
  [e.code, /fermée/.test(e.message), /téléchargement/.test(e.message)], ["conversation", true, false]);
// saisie Elixir : jeton admin expiré renouvelé (admin-refresh), puis l'appel rejoué
reinit(); globalThis.localStorage.setItem("admin_token", "vieux-admin"); globalThis.localStorage.setItem("admin_refresh_token", "rta");
repondre = (a) => a.url.includes("admin-refresh") ? json(200, { success: true, token: "neuf-admin", refresh_token: "rta2" })
  : a.entetes.Authorization === "Bearer neuf-admin" ? json(200, { conversation_id: "c2", messages: [] }) : json(401, { error: "reconnexion" });
const oa = await api.ouvrir(authAssistant({ odoo_id: 595 }), null);
eq("saisie Elixir, 401 → jeton admin renouvelé (et gardé), appel rejoué", [oa.conversation_id, appels[1].corps, globalThis.localStorage.getItem("admin_token"), globalThis.localStorage.getItem("admin_refresh_token")],
  ["c2", { refresh_token: "rta" }, "neuf-admin", "rta2"]);
reinit(); repondre = () => json(410, { error: "expiree" });
e = await api.decider(authAssistant(null), "c", "d", "confirmer").catch(x => x);
eq("410 : récapitulatif expiré", e.code, "expiree");
reinit(); repondre = () => json(404, { error: "introuvable" });
e = await api.decider(authAssistant(null), "c", "d", "confirmer").catch(x => x);
eq("confirmer : conversation fermée (404) → récapitulatif expiré", e.code, "expiree");
reinit(); repondre = () => json(200, { message: null });
await api.decider(authAssistant({ odoo_id: 9 }), "c", "d", "confirmer", { prevenir: false });
await api.decider(authAssistant({ odoo_id: 9 }), "c", "d", "confirmer");
await api.decider(authAssistant(null), "c", "d", "confirmer", { prevenir: false });
eq("« Prévenir la pharmacie » décochée : saisie Elixir seulement", appels.map(a => a.corps.prevenir_pharmacie ?? null), [false, null, null]);
reinit(); repondre = () => { throw new TypeError("Failed to fetch"); };
e = await api.envoyer(authAssistant(null), "c", "t").catch(x => x);
eq("coupure réseau", e.code, "reseau");
reinit(); repondre = () => json(202, { tour_id: "t1" });
eq("message → 202 { tour_id } + contexte", [(await api.envoyer(authAssistant(null), "c", "Bonjour", { commande_site_id: "17" })).tour_id, appels[0].corps],
  ["t1", { action: "message", conversation_id: "c", texte: "Bonjour", contexte: { commande_site_id: "17" } }]);

// attente de la réponse : étapes, puis réponse ; arrêt sur abandon
reinit();
const message = { id: "m1", role: "assistant", texte: "Voici.", ui_actions: [], at: new Date().toISOString() };
repondre = (a, n) => n === 1 ? json(200, { statut: "en_attente", etape: null, message: null })
  : n === 2 ? json(200, { statut: "en_cours", etape: "Je recherche vos factures…", message: null }) : json(200, { statut: "termine", etape: null, message });
const etapes = [];
const r = await api.attendreReponse({ auth: authAssistant(null), tourId: "t1", conversationId: "c", surEtape: (x) => etapes.push(x) });
eq("attente : étapes puis réponse", [etapes, r.message.id, r.erreur], [[null, "Je recherche vos factures…"], "m1", false]);
vrai("attente : GET ?tour=&conversation_id=", appels.every(a => a.methode === "GET" && /chat\?tour=t1&conversation_id=c$/.test(a.url)), appels[0]?.url);
reinit(); repondre = () => json(200, { statut: "erreur", etape: null, message: null });
eq("tour en erreur", await api.attendreReponse({ auth: authAssistant(null), tourId: "t", conversationId: "c" }), { message: null, erreur: true });
reinit(); repondre = (a, n) => n === 1 ? json(503, { error: "indisponible" }) : json(200, { statut: "termine", etape: null, message });
eq("attente : 503 passager (Odoo ou Supabase lent), nouvel essai, réponse reçue", (await api.attendreReponse({ auth: authAssistant(null), tourId: "t", conversationId: "c" })).message?.id, "m1");
reinit(); repondre = () => json(401, { error: "reconnexion" });
e = await api.attendreReponse({ auth: authAssistant(null), tourId: "t", conversationId: "c" }).catch(x => x);
eq("attente : 401 → reconnexion", e.code, "reconnexion");
{
  reinit();
  const ac = new AbortController();
  repondre = () => { ac.abort(); return json(200, { statut: "en_cours", etape: null, message: null }); };
  eq("attente arrêtée (panneau fermé)", await api.attendreReponse({ auth: authAssistant(null), tourId: "t", conversationId: "c", signal: ac.signal }), null);
  eq("attente arrêtée : plus aucune requête", appels.length, 1);
}

// état du bouton : lu une fois par identité ; « reconnexion » n'est pas gardé
reinit(); globalThis.localStorage.setItem("pharmacy_token", "j");
repondre = () => json(200, { disponible: true, mode: "complet", raison: null });
await etatAssistant(authAssistant(null), "p-test-1"); await etatAssistant(authAssistant(null), "p-test-1");
eq("état gardé pour la session", appels.length, 1);
reinit(); repondre = () => json(200, { disponible: false, mode: null, raison: "reconnexion" });
await etatAssistant(authAssistant(null), "p-test-2"); await new Promise(ok => setTimeout(ok, 0)); await etatAssistant(authAssistant(null), "p-test-2");
eq("« reconnexion » relu au prochain appel", appels.length, 2);
reinit(); repondre = () => json(404, { error: "absent" });
eq("fonction absente → bouton masqué", (await etatAssistant(authAssistant(null), "p-test-3")).disponible, false);
reinit(); globalThis.localStorage.setItem("admin_token", "ja");
repondre = () => json(200, { disponible: true, mode: "complet", raison: null });
await etatAssistant(authAssistant({ odoo_id: 7 }), "a7");
eq("état en saisie Elixir : jeton admin + pour_odoo_id", [appels[0].entetes.Authorization, appels[0].corps], ["Bearer ja", { action: "etat", pour_odoo_id: 7 }]);
reinit(); globalThis.localStorage.setItem("pharmacy_token", "vieux"); globalThis.localStorage.setItem("pharmacy_refresh_token", "rt");
repondre = (a) => a.url.includes("admin-refresh") ? json(200, { success: true, token: "neuf" })
  : json(200, a.entetes.Authorization === "Bearer neuf" ? { disponible: true, mode: "complet", raison: null } : { disponible: false, mode: null, raison: "reconnexion" });
const e4 = await etatAssistant(authAssistant(null), "p-test-4");
eq("état : jeton expiré renouvelé, puis relu", [e4.disponible, appels.map(a => a.url.replace("/.netlify/functions/", ""))], [true, ["chat", "admin-refresh", "chat"]]);
reinit(); repondre = () => { throw new TypeError("Failed to fetch"); };
eq("état : coupure réseau → bouton masqué", (await etatAssistant(authAssistant(null), "p-test-5")).disponible, false);
reinit(); globalThis.localStorage.setItem("pharmacy_token", "j");
repondre = (a, n) => json(200, n === 1 ? { disponible: false, mode: null, raison: null } : { disponible: true, mode: "complet", raison: null });
await etatAssistant(authAssistant(null), "p-test-6"); await new Promise(ok => setTimeout(ok, 0));
eq("état : échec passager du serveur (raison vide) non gardé, relu ensuite", (await etatAssistant(authAssistant(null), "p-test-6")).disponible, true);

// conversation gardée pour l'onglet, par identité
reinit();
api.ecritMemoire("p-a", { conversation_id: "c1", tour_id: "t1" });
eq("mémoire de l'onglet", [api.litMemoire("p-a"), api.litMemoire("p-b")], [{ conversation_id: "c1", tour_id: "t1" }, {}]);
api.ecritMemoire("p-a", {});
eq("mémoire effacée", api.litMemoire("p-a"), {});

// ── 5. rendu (React côté serveur) ──
const entree = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import TexteSur from "./components/assistant/TexteSur.jsx";
import Carte from "./components/assistant/Cartes.jsx";
import AssistantPanel from "./components/AssistantPanel.jsx";
import Presentation from "./components/assistant/Presentation.jsx";
import { CoucheAssistant } from "./components/assistant/Aide.jsx";
export const texte = (t) => renderToStaticMarkup(React.createElement("div", null, React.createElement(TexteSur, { texte: t })));
export const carte = (a, outils) => renderToStaticMarkup(React.createElement(Carte, { action: a, outils }));
export const panneau = (props) => renderToStaticMarkup(React.createElement(AssistantPanel, props));
export const presentation = (props) => renderToStaticMarkup(React.createElement(Presentation, props));
export const couche = (props) => renderToStaticMarkup(React.createElement(CoucheAssistant, props));
`;
const lot = await build({ stdin: { contents: entree, resolveDir: SRC, loader: "jsx" }, bundle: true, write: false, format: "esm", platform: "browser",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, logLevel: "silent" });
const rendu = await import(`data:text/javascript;base64,${Buffer.from(lot.outputFiles[0].text).toString("base64")}`);

const piege = 'Voir <a href="javascript:alert(1)">ici</a> <img src=x onerror=alert(1)> https://exemple.fr\n- **un**\n- deux';
const h = rendu.texte(piege);
vrai("afficheur : aucune balise du texte rendue", !/<a[\s>]|<img|<script/i.test(h), h);
vrai("afficheur : balises échappées et visibles", h.includes("&lt;a href=&quot;javascript:alert(1)&quot;&gt;") && h.includes("&lt;img src=x"), h);
vrai("afficheur : adresse web en texte", h.includes("https://exemple.fr") && !h.includes('href="https'), h);
vrai("afficheur : gras et liste", h.includes("<strong") && /<ul[^>]*><li[^>]*><strong[^>]*>un<\/strong><\/li><li[^>]*>deux<\/li><\/ul>/.test(h), h);

const outils = { telecharger: async () => {}, envoyer: () => {}, preremplir: () => {}, decider: () => {}, etatDemande: () => null, occupe: false, apercuFichiers: false };
const toutes = [...question("toutes les cartes").message.ui_actions, ...reponseChatFictive({ action: "confirmer", decision: "confirmer" }).message.ui_actions];
for (const a of toutes) {
  let html = "";
  try { html = rendu.carte(a, outils); } catch (x) { html = ""; vrai(`carte ${a.type} : rendu sans erreur`, false, x.message); continue; }
  vrai(`carte ${a.type} : rendue`, html.length > 40, html);
  const liens = [...html.matchAll(/<a\b[^>]*>/g)].map(m => m[0]);
  vrai(`carte ${a.type} : aucun lien hors tel:`, liens.every(l => /href="tel:\+?\d+"/.test(l)), liens.join(" "));
  vrai(`carte ${a.type} : aucune image`, !/<img/i.test(html));
}
const html = (type, opts = outils) => rendu.carte(toutes.find(a => a.type === type), opts);
vrai("document : « Télécharger le PDF »", html("document").includes("Télécharger le PDF"));
vrai("avoir sans PDF : pas de bouton", rendu.carte(toutes.find(a => a.type === "document" && !a.fichier_id), outils).includes("pas été émis au format PDF"));
vrai("relevé : PDF, Excel, total TTC au format français", /PDF/.test(html("releve")) && /Excel/.test(html("releve")) && /91\s049,40\s€/u.test(html("releve")), html("releve"));
vrai("relevé : mention sur les règlements", html("releve").includes("ne reflète pas les règlements"));
vrai("récapitulatif : Confirmer, Modifier, Annuler", ["Confirmer la demande", "Modifier", "Annuler"].every(t => html("recap_retour").includes(t)));
vrai("récapitulatif : case « Prévenir la pharmacie » en saisie Elixir seulement", html("recap_retour", { ...outils, saisieElixir: true }).includes("Prévenir la pharmacie")
  && !html("recap_retour").includes("Prévenir la pharmacie"));
vrai("récapitulatif confirmé : plus de bouton", !html("recap_retour", { ...outils, etatDemande: () => "confirmee" }).includes("Confirmer la demande"));
vrai("récapitulatif expiré", html("recap_retour", { ...outils, etatDemande: () => "expiree" }).includes("a expiré"));
{
  const remplace = html("recap_retour", { ...outils, etatDemande: () => "remplacee" });
  vrai("récapitulatif remplacé par un plus récent : plus de bouton, encart neutre", !remplace.includes("Confirmer la demande") && remplace.includes("Remplacé par le récapitulatif plus récent"), remplace);
  const refuse = html("recap_retour", { ...outils, etatDemande: () => "non_enregistree" });
  vrai("récapitulatif refusé au recontrôle : « non enregistrée », jamais « confirmée »", refuse.includes("Demande non enregistrée") && !refuse.includes("Demande confirmée"), refuse);
}
vrai("transmission : « Appeler » en tel:", /href="tel:0186043995"/.test(html("transmission")));
vrai("demande enregistrée : mention de la phase pilote", html("demande_enregistree").includes("Phase pilote"));
vrai("commande : frise et lots", html("commande").includes("Suivi de la commande") && html("commande").includes("Lots et péremptions"));
vrai("commande : bouton « Bon de livraison » (sortie validée)", html("commande").includes(">Bon de livraison<") && html("commande").includes("Bon de livraison EP/OUT/190123"), html("commande"));
vrai("commande : reliquat ouvert affiché « + 4 à livrer », non servi 0 (comme le bon de la commande)", html("commande").includes("+ 4 à livrer"), html("commande"));
{
  const b = html("bons_livraison");
  vrai("bons de livraison : un bouton PDF par bon et tous en un seul PDF", (b.match(/>PDF</g) || []).length === 3 && b.includes("Les 3 bons en un seul PDF"), b);
  vrai("bons de livraison : expédié le, commande, renvoi, reste à livrer, mention du duplicata",
    ["Expédié le", "commande S900123", "Renvoi après retour", "Reste à livrer", "Duplicata établi par Elixir Pharma à partir des données de livraison enregistrées"].every(t => b.includes(t)), b);
  vrai("bons de livraison : heure de sortie (« Expédié le … à 19:42 »), aucune identité affirmée avec un papier", /Expédié le \d{2}\/\d{2}\/\d{4} à 19:42/.test(b) && !/mêmes produits|bon remis/.test(b), b);
  vrai("bons de livraison : boutons nommés pour les lecteurs d'écran", b.includes('aria-label="Télécharger le bon de livraison EP/OUT/190123 en PDF"'));
  const sansId = rendu.carte({ ...toutes.find(a => a.type === "bons_livraison"), fichier_id: null }, outils);
  vrai("bons de livraison sans autorisation (quota) : boutons inactifs, pas de « tous en un seul PDF »", !sansId.includes("un seul PDF") && sansId.includes("Téléchargement indisponible"), sansId);
  const pages = rendu.carte({ ...toutes.find(a => a.type === "bons_livraison"), total: 25, pages: 2, ensemble: 25, ensemble_periode: true }, outils);
  vrai("bons de livraison sur plusieurs pages : « Bons suivants », fichier unique de la période", pages.includes("Bons suivants") && pages.includes("page 1 sur 2")
    && pages.includes("Les 25 bons de la période en un seul PDF"), pages);
  // un seul bon (bouton « Bon de livraison » d'une commande) : bouton principal, comme le duplicata d'une facture ; pas de période
  const un = rendu.carte(question("Je voudrais le bon de livraison EP/OUT/190087.").message.ui_actions[0], outils);
  vrai("un seul bon : bouton principal « Télécharger le bon de livraison (PDF) », pas de petit bouton, pas de période",
    un.includes("Télécharger le bon de livraison (PDF)") && !/>PDF</.test(un) && !un.includes("un seul PDF") && !un.includes("Sortie de l&#x27;entrepôt le"), un);
  // téléchargement d'un seul bon : ?n=<rang> ; sans rang : tous
  const urls = [];
  const sauve = { fetch: globalThis.fetch, document: globalThis.document, URL: globalThis.URL };
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response("%PDF", { status: 200, headers: { "Content-Disposition": 'attachment; filename="x.pdf"' } }); };
  globalThis.document = { createElement: () => ({ click() {}, remove() {}, style: {} }), body: { appendChild() {} } };
  globalThis.URL = Object.assign(function (...a) { return new sauve.URL(...a); }, { createObjectURL: () => "blob:x", revokeObjectURL() {} });
  await api.telecharger({ admin: false }, FICHIERS_FICTIFS.bl, "x.pdf", nomFichier, 2);
  await api.telecharger({ admin: false }, FICHIERS_FICTIFS.bl, "x.pdf", nomFichier);
  await api.telecharger({ admin: false }, FICHIERS_FICTIFS.bl, "x.pdf", nomFichier, -1);
  // quota de fichiers atteint au premier téléchargement d'une liste de bons : message du serveur affiché tel quel
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "quota", message: "Limite de 20 fichiers par 24 heures atteinte. Réessayez plus tard." }), { status: 429 });
  const refus = await api.telecharger({ admin: false }, FICHIERS_FICTIFS.bl, "x.pdf", nomFichier, 0).then(() => null, (e) => e);
  Object.assign(globalThis, sauve);
  eq("téléchargement refusé (429 quota) : message du serveur", [refus?.code, refus?.message], ["quota", "Limite de 20 fichiers par 24 heures atteinte. Réessayez plus tard."]);
  eq("téléchargement : rang d'un bon (?n=2), sinon tous ; rang invalide ignoré", urls.map(u => u.replace(/^.*\?/, "")),
    [`id=${FICHIERS_FICTIFS.bl}&n=2`, `id=${FICHIERS_FICTIFS.bl}`, `id=${FICHIERS_FICTIFS.bl}`]);
}
eq("type de carte inconnu : rien", rendu.carte({ type: "lien", url: "https://x" }, outils), "");

const proprietes = { identite: "p-x", auth: { admin: false }, pharmacyName: "PHARMACIE D'ESSAI", acting: null, contexte: null, onClose() {}, onReconnecter() {}, onInfos() {} };
const bureau = rendu.panneau({ ...proprietes, mobile: false });
vrai("bureau : <aside aria-label>", /^<aside[^>]*aria-label="Assistant Elixir"/.test(bureau), bureau.slice(0, 200));
vrai("fil : role=log aria-live=polite", /role="log"[^>]*aria-live="polite"/.test(bureau));
vrai("en-tête : titre, sous-titre, nouvelle conversation, fermer", ["Assistant Elixir", "Factures · relevés · commandes · BL · retours", 'aria-label="Nouvelle conversation"', 'aria-label="Fermer l&#x27;assistant"'].every(t => bureau.includes(t)), bureau);
vrai("saisie : 2 000 caractères au plus", /<textarea[^>]*maxLength="2000"/i.test(bureau) || /<textarea[^>]*maxlength="2000"/i.test(bureau));
const mobile = rendu.panneau({ ...proprietes, mobile: true, acting: { name: "PHARMACIE SERVIE" } });
vrai("mobile : dialog modal", /^<div[^>]*role="dialog"[^>]*aria-modal="true"/.test(mobile), mobile.slice(0, 200));
vrai("mobile : bouton Retour", mobile.includes("Retour : fermer l&#x27;assistant"));
vrai("saisie Elixir : bandeau", mobile.includes("Vous agissez pour <b>PHARMACIE SERVIE</b>"));
vrai("messages sélectionnables malgré l'anti-copie", /ex-assistant__fil ex-selectionnable/.test(bureau));

// ── 6. fenêtre de présentation et lanceur flottant ──
const pres = await import("../../src/components/assistant/presentation.js");
const compte = "ppharmacie-1@banc.test", cleCompte = `assistant_presentation_${compte}`;
const nouvelleSession = () => globalThis.sessionStorage.clear();
const T0 = Date.parse("2026-10-20T08:00:00Z"), H = 3600e3;
reinit();
vrai("nouveau compte : fenêtre à présenter", pres.aPresenter(compte, T0));
pres.noterVue(compte, T0);
eq("affichée : plus rien jusqu'à la fin de la session (« Plus tard »)", pres.aPresenter(compte, T0), false);
eq("mémoire par compte : localStorage { vues, fini, derniere } et sessionStorage, clé avec l'identité",
  [globalThis.localStorage.getItem(cleCompte), globalThis.sessionStorage.getItem(cleCompte)], [`{"vues":1,"fini":false,"derniere":${T0}}`, "1"]);
vrai("autre compte du même poste : pas touché", pres.aPresenter("pautre@banc.test", T0));
// liens des mailings : chaque lien ouvre un nouvel onglet (nouvelle session du navigateur) ; la fenêtre n'y revient pas
nouvelleSession(); eq("deux onglets en quelques minutes : un seul affichage", pres.aPresenter(compte, T0 + 5 * 60e3), false);
nouvelleSession(); eq("… ni 19 h plus tard", pres.aPresenter(compte, T0 + 19 * H), false);
nouvelleSession(); vrai("session suivante, 20 h plus tard : revient (1er retour)", pres.aPresenter(compte, T0 + 20 * H)); pres.noterVue(compte, T0 + 20 * H);
nouvelleSession(); eq("… puis plus avant 20 h de plus", pres.aPresenter(compte, T0 + 30 * H), false);
nouvelleSession(); vrai("session suivante, un jour après : revient (2e et dernier retour)", pres.aPresenter(compte, T0 + 44 * H)); pres.noterVue(compte, T0 + 44 * H);
nouvelleSession(); eq("après 3 affichages : plus jamais", [pres.aPresenter(compte, T0 + 30 * 24 * H), pres.VUES_MAX], [false, 3]);
reinit(); pres.noterVue(compte, T0); nouvelleSession();
vrai("horloge du poste reculée : la fenêtre n'est pas bloquée pour autant", pres.aPresenter(compte, T0 - 48 * H));
reinit(); globalThis.localStorage.setItem(cleCompte, '{"vues":1,"fini":false}'); nouvelleSession();
vrai("mémoire sans heure (premier format) : comptée comme ancienne", pres.aPresenter(compte, T0));
reinit(); pres.noterFini(compte);
eq("assistant ouvert ou « Ne plus afficher » : plus jamais", pres.aPresenter(compte, T0), false);
nouvelleSession(); eq("… même à une autre session, des jours après", pres.aPresenter(compte, T0 + 30 * 24 * H), false);
reinit(); pres.noterVue(compte, T0); pres.noterFini(compte);
eq("fini garde le nombre d'affichages et l'heure", JSON.parse(globalThis.localStorage.getItem(cleCompte)), { vues: 1, fini: true, derniere: T0 });
eq("sans identité (session sans compte) : rien", [pres.aPresenter(""), pres.aPresenter(null)], [false, false]);
reinit(); globalThis.localStorage.setItem(cleCompte, "{pas du json");
eq("valeur illisible : pas de fenêtre (elle reviendrait à chaque page)", pres.aPresenter(compte), false);
{
  const bloque = { getItem() { throw new Error("bloqué"); }, setItem() { throw new Error("bloqué"); }, removeItem() {}, clear() {} };
  const avant = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: bloque, configurable: true, writable: true });
  let leve = false;
  try { pres.noterVue(compte); pres.noterFini(compte); } catch { leve = true; }
  eq("stockage bloqué : pas de fenêtre, aucune erreur", [pres.aPresenter(compte), leve], [false, false]);
  Object.defineProperty(globalThis, "localStorage", { value: avant, configurable: true, writable: true });
}
vrai("délai de calme : quelques secondes", pres.DELAI_PRESENTATION >= 2000 && pres.DELAI_PRESENTATION <= 4000);
vrai("écart entre deux affichages : 20 h", pres.ECART_RETOUR === 20 * H);
eq("champs qui ouvrent le clavier (lanceur masqué)", [{ tagName: "INPUT", type: "text" }, { tagName: "INPUT", type: "number" }, { tagName: "INPUT", type: "search" },
  { tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }].map(pres.champSaisie), [true, true, true, true, true, true, true]);
eq("pas de clavier : boutons, cases, rien", [{ tagName: "BUTTON" }, { tagName: "INPUT", type: "checkbox" }, { tagName: "INPUT", type: "button" }, { tagName: "A" }, null]
  .map(pres.champSaisie), [false, false, false, false, false]);
eq("champ rempli en cours de saisie : la fenêtre attend (vide, liste, case : non)",
  [{ tagName: "INPUT", type: "text", value: "dolip" }, { tagName: "TEXTAREA", value: "x" }, { tagName: "DIV", isContentEditable: true, textContent: "a" },
    { tagName: "INPUT", type: "search", value: "" }, { tagName: "SELECT", value: "otc" }, { tagName: "INPUT", type: "checkbox", value: "on" }, null].map(pres.champRempli),
  [true, true, true, false, false, false, false]);
{
  // boucle d'attente : calme d'affilée, morceau chargé, échec du chargement (lanceur gardé, rien de compté)
  const P = pres.PAS_ATTENTE, D = pres.DELAI_PRESENTATION;
  let etat = { calme: 0 }, suites = [];
  for (let i = 0; i < D / P; i++) { etat = pres.pasAttente({ calme: etat.calme, occupe: false, charge: true, echec: false }); suites.push(etat.suite); }
  eq("attente : calme d'affilée puis affichage", suites, [...Array(D / P - 1).fill("attendre"), "afficher"]);
  eq("attente : activité, autre fenêtre ou champ rempli → le calme repart de zéro", pres.pasAttente({ calme: D - P, occupe: true, charge: true, echec: false }), { calme: 0, suite: "attendre" });
  eq("attente : calme atteint mais morceau pas encore chargé → attendre", pres.pasAttente({ calme: D, occupe: false, charge: false, echec: false }).suite, "attendre");
  eq("attente : morceau introuvable (nouvelle version en ligne) → abandon", pres.pasAttente({ calme: D, occupe: false, charge: false, echec: true }), { calme: 0, suite: "abandonner" });
}
{
  const [a, b, c] = ["a", "b", "c"].map((n) => ({ n }));
  eq("Tab sur le dernier bouton → premier", pres.focusSuivant([a, b, c], c, false), a);
  eq("Maj+Tab sur le premier → dernier", pres.focusSuivant([a, b, c], a, true), c);
  eq("Tab au milieu : suit son cours", [pres.focusSuivant([a, b, c], b, false), pres.focusSuivant([a, b, c], b, true)], [null, null]);
  eq("focus hors de la fenêtre (<body> après un clic sur le voile) : premier, ou dernier avec Maj", [pres.focusSuivant([a, b, c], {}, false), pres.focusSuivant([a, b, c], {}, true)], [a, c]);
  eq("aucun bouton", pres.focusSuivant([], a, false), null);
}
{
  // place du lanceur au repos : sonde sous le lanceur (doublure d'elementsFromPoint : une page à zones)
  const lanceurEl = { nom: "lanceur" }, panierEl = { nom: "panier" }, plus = { nom: "+", controle: true }, texte = { nom: "texte" }, fond = { nom: "fond" };
  // page : un « + » occupe x 900-940, y 760-800 ; le panier x 1350-1410, y 816-876 ; ailleurs du texte
  const page = (x, y) => {
    const sous = x >= 900 && x <= 940 && y >= 760 && y <= 800 ? [plus, fond] : [texte, fond];
    return x >= 1350 && x <= 1410 && y >= 816 && y <= 876 ? [panierEl, ...sous] : sous;
  };
  const sonde = (r, avecLanceur = true) => pres.recouvre(r, { aPoint: (x, y) => (avecLanceur && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [lanceurEl, ...page(x, y)] : page(x, y)),
    ignorer: (e) => e === lanceurEl || e === panierEl, estControle: (e) => !!e.controle });
  const pastille = { left: 880, top: 752, right: 1406, bottom: 804 }, bulle = { left: 1354, top: 752, right: 1406, bottom: 804 };
  eq("sonde : la pastille couvrirait le « + », la bulle non", [sonde(pastille), sonde(bulle)], [true, false]);
  vrai("sonde : le lanceur et le panier flottant sont ignorés", !sonde({ left: 1350, top: 816, right: 1410, bottom: 876 }));
  vrai("sonde : marge de 4 px autour du lanceur (contrôle juste à côté)", sonde({ left: 944, top: 760, right: 990, bottom: 800 }) && !sonde({ left: 946, top: 760, right: 990, bottom: 800 }));
  const pts = pres.pointsSonde({ left: 0, top: 0, right: 52, bottom: 52 }, 4, 8);
  vrai("sonde : grille de points, bords compris", pts.some(([x, y]) => x === -4 && y === -4) && pts.some(([x, y]) => x === 56 && y === 56) && pts.length === 81, String(pts.length));
  const place = (pastilleVoulue, libres, garde = false) => pres.placeLanceur({ pastilleVoulue, libre: (f) => libres.includes(f), garde });
  eq("place : pastille en haut de page si sa place est libre", place(true, ["pastille", "bulle"]), "pastille");
  eq("place : pastille qui couvrirait un contrôle → bulle", place(true, ["bulle"]), "bulle");
  eq("place : page défilée (ou mobile) → bulle", place(false, ["pastille", "bulle"]), "bulle");
  eq("place : même la bulle couvrirait un contrôle → masqué", [place(true, []), place(false, [])], ["masque", "masque"]);
  eq("place : focus clavier ou pointeur sur le lanceur → jamais masqué", place(false, [], true), "bulle");
}

const appels6 = { essayer: 0, plusTard: 0, jamais: 0 };
const fenetre = (mobile) => rendu.presentation({ mobile, onEssayer: () => appels6.essayer++, onPlusTard: () => appels6.plusTard++, onNePlusAfficher: () => appels6.jamais++ });
const fb = fenetre(false), fm = fenetre(true);
const NB = " ";
vrai("fenêtre : role=dialog aria-modal", /^<div[^>]*role="dialog"[^>]*aria-modal="true"/.test(fb), fb.slice(0, 240));
{
  const titre = /aria-labelledby="([^"]+)"/.exec(fb)?.[1], texteId = /aria-describedby="([^"]+)"/.exec(fb)?.[1];
  vrai("fenêtre : titre et texte reliés", !!titre && fb.includes(`<h2 id="${titre}"`) && !!texteId && fb.includes(`id="${texteId}"`), `${titre} ${texteId}`);
}
vrai("fenêtre : titre « Nouveau : votre Assistant Elixir » (espace insécable avant « : »)", fb.includes(`Nouveau${NB}: votre Assistant Elixir`));
vrai("fenêtre : ce que c'est (factures et commandes Elixir, jamais les règlements), sans promettre une réponse immédiate",
  fb.includes("assistant automatique") && fb.includes("vos factures et vos commandes Elixir") && fb.includes("Il ne voit jamais vos règlements")
  && /vous répond\s+directement/.test(fb) && !fb.includes("tout de suite"));
vrai("fenêtre : les 4 exemples", ["Duplicata d&#x27;une facture", "Relevé de facturation", `Où en est ma commande${NB}?`, "Demande de retour ou réclamation"]
  .every((t) => fb.includes(t)) && (fb.match(/<li\b/g) || []).length === 4, fb);
{
  // texte visible de la fenêtre (sans CSS ni balises) : jamais d'espace sécable avant « ? », « : », « » » ni après « « »
  const texte = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
  const fautes = [fb, fm].flatMap((h) => texte(h).match(/.{0,20}(?: [?:»]|« ).{0,10}/g) || []);
  vrai("fenêtre : typographie (insécables avant « ? » et « : », dans « »)", fb.includes(`par exemple${NB}:`) && fb.includes(`«${NB}Aide${NB}»`) && !fautes.length, JSON.stringify(fautes));
}
vrai("fenêtre : 4 icônes d'exemple décoratives", (fb.match(/<span aria-hidden="true"[^>]*><svg/g) || []).length === 4);
vrai("fenêtre : transmission à l'équipe Elixir", fb.includes("il transmet votre demande à l&#x27;équipe Elixir"));
vrai("fenêtre : « Essayer maintenant », « Plus tard », « Ne plus afficher » (vrais boutons)",
  [">Essayer maintenant<", ">Plus tard<", ">Ne plus afficher<"].every((t) => fb.includes(t)) && !/<button(?![^>]*type="button")/.test(fb));
vrai("fenêtre : focus initial sur « Fermer » (FocusFenetre)", /<button[^>]*data-focus-initial="true"[^>]*aria-label="Fermer"/.test(fb));
vrai("fenêtre : en-tête pétrole, croix or clair, bouton principal pétrole, aucun or",
  fb.includes("background:var(--petrol)") && fb.includes("color:var(--or-clair)") && /class="ex-btn-petrole"[^>]*>.*Essayer maintenant/.test(fb) && !/var\(--or\)/.test(fb));
vrai("fenêtre : aucun lien ni image", !/<a\b|<img/i.test(fb + fm));
vrai("fenêtre : où retrouver l'assistant (la bulle, commune au lanceur et à l'en-tête)", [fb, fm].every((h) => h.includes("avec la bulle de discussion, en haut de l&#x27;écran ou en bas à droite")));
vrai("fenêtre : écran bas (375 × 667) — exemples resserrés, ligne « Vous le retrouverez… » retirée",
  fb.includes("@media (max-width: 767px) and (max-height: 700px)") && /\.ex-presentation__retrouver \{ display: none/.test(fb) && fb.includes('class="ex-presentation__retrouver"'));
eq("fenêtre : rendue sans action", [appels6.essayer, appels6.plusTard, appels6.jamais], [0, 0, 0]);
{
  // clavier écouté sur le document (capture), pas sur la fenêtre : Tab et Échap marchent même après un clic sur le voile
  const src = readFileSync(resolve(SRC, "components/assistant/Presentation.jsx"), "utf8");
  vrai("fenêtre : Tab et Échap écoutés sur le document, en capture", src.includes('document.addEventListener("keydown", auClavier, true)') && !src.includes("onKeyDown={auClavier}"));
  vrai("fenêtre : un clic sur le voile ne retire pas le focus des boutons", /onMouseDown=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) e\.preventDefault\(\); \}\}/.test(src));
  const app = readFileSync(resolve(SRC, "App.jsx"), "utf8");
  vrai("App : pas de fenêtre à l'arrivée par le lien d'un menu promo (comme « Offres du moment »)", /presenter=\{!actingFor && assistant\.mode === "complet" && !menuViaLien\.current\}/.test(app));
  vrai("App : lanceur masqué pendant la barre de confirmation U-Labs", /activeTab === "ulabs" && Object\.keys\(quantities\)\.some\(k => k\.startsWith\("ulabs-"\)/.test(app));
  const aide = readFileSync(resolve(SRC, "components/assistant/Aide.jsx"), "utf8");
  vrai("couche : défilement (molette, doigt, barre) compté comme activité", ['"wheel"', '"touchmove"', '"scroll"'].every((t) => aide.includes(t)));
  vrai("couche : fenêtre affichée et comptée seulement une fois son morceau chargé", aide.includes("pasAttente({ calme, occupe, charge, echec })") && /if \(pas\.suite === "afficher"\) \{ noterVue\(identite\); setAffiche\(true\); \}/.test(aide));
  vrai("couche : focus rendu au lanceur (ou à la bulle de l'en-tête) quand rien ne l'a repris", aide.includes('document.querySelector("[data-assistant-ouvrir]")'));
}

const lanceur = (props) => rendu.couche({ identite: compte, mobile: false, presenter: true, pret: true, ouvert: false, cache: false, pile: false, onOuvrir() {}, ...props });
const lb = lanceur(), lm = lanceur({ mobile: true });
vrai("lanceur : vrai bouton avec aria-label", new RegExp(`<button type="button" class="ex-lanceur"[^>]*aria-label="Une question${NB}\\? Assistant Elixir"`).test(lb), lb.slice(0, 400));
vrai("lanceur (ordinateur) : pastille « Une question ? Assistant Elixir » avec la bulle", lb.includes(`Une question${NB}?</span> Assistant Elixir`) && lb.includes("<svg"));
vrai("lanceur (mobile) : bulle seule, nommée par aria-label", !lm.includes(`Une question${NB}?</span>`) && new RegExp(`aria-label="Une question${NB}\\? Assistant Elixir"`).test(lm));
vrai("lanceur : affiché par défaut, au coin quand il n'y a pas de panier", !/<button[^>]*hidden/.test(lb) && !/<button[^>]*data-pile/.test(lb) && !/<button[^>]*data-masque/.test(lb));
vrai("lanceur : pastille au premier rendu sur ordinateur, bulle sur mobile", !/<button[^>]*data-forme/.test(lb) && /<button[^>]*data-forme="bulle"/.test(lm));
vrai("lanceur : au-dessus du panier flottant quand il est affiché", /<button[^>]*data-pile=""/.test(lanceur({ pile: true })));
vrai("lanceur : masqué pendant que le panneau est ouvert", /<button[^>]*hidden=""/.test(lanceur({ ouvert: true })));
vrai("lanceur : masqué pendant que le panier (ou l'admin, le tiroir de menu, la barre U-Labs) est ouvert", /<button[^>]*hidden=""/.test(lanceur({ cache: true })));
vrai("lanceur : zIndex du panier flottant, zone de sécurité, mouvement réduit, impression",
  ["z-index: 290", "env(safe-area-inset-bottom", "prefers-reduced-motion: reduce", ".ex-lanceur--appel { animation: none; }", "@media print"].every((t) => lb.includes(t)));
vrai("lanceur : bulle de 52 px sur l'axe du panier (bord droit 28 px), libellé au survol (souris) et au focus clavier",
  ['.ex-lanceur[data-forme="bulle"] { width: 52px;', "right: 28px", '.ex-lanceur[data-forme="bulle"]:focus-visible', "@media (hover: hover)", '.ex-lanceur[data-forme="bulle"]:hover']
    .every((t) => lb.replace(/&quot;/g, '"').includes(t)));
vrai("lanceur : masqué sans disparaître de la mise en page (sondes), ni clic ni focus possibles",
  /\.ex-lanceur\[data-masque\] \{ visibility: hidden; opacity: 0; pointer-events: none; \}/.test(lb));
vrai("lanceur : pas de fenêtre au premier rendu (elle attend le catalogue et le calme)", !lb.includes("role=\"dialog\""));

// bundle des pharmacies (après npm run build) : la fenêtre et le lanceur sont dans des morceaux chargés à la demande
{
  const dist = resolve(SRC, "../dist/assets");
  const index = existsSync(dist) ? readdirSync(dist).filter((n) => /^index-.*\.js$/.test(n)) : [];
  if (!index.length) console.log("  · dist/ absent : lancer npm run build pour contrôler le bundle des pharmacies");
  else {
    const js = index.map((n) => readFileSync(resolve(dist, n), "utf8")).join("\n");
    vrai("bundle des pharmacies : ni la fenêtre de présentation ni le lanceur", !js.includes("votre Assistant Elixir") && !js.includes("Demandez-lui par exemple") && !js.includes("ex-lanceur"));
    vrai("morceaux à la demande : Aide (lanceur) et Presentation (fenêtre)", readdirSync(dist).some((n) => /^Aide-.*\.js$/.test(n)) && readdirSync(dist).some((n) => /^Presentation-.*\.js$/.test(n)));
  }
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
