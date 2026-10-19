// Tests de l'interface de l'Assistant Elixir (lot 4) : node scripts/banc/test-assistant-interface.mjs
// Aucun appel réseau : fetch, localStorage et sessionStorage sont des doublures. Couvre :
//  1. l'afficheur sûr (texte-sur.js) : gras, retours à la ligne, listes « - » ; balises, liens et images restent du texte ;
//  2. les formats français des cartes (format.js) ;
//  3. la conversation fictive des aperçus (cas « chat » de src/dev/reponses-fictives.js) : formes du contrat ;
//  4. les appels au serveur (assistant-client.js, assistant/api.js) : jeton, pour_odoo_id, 401 rejoué, erreurs, attente ;
//  5. le rendu des cartes et du panneau (React côté serveur, via esbuild) : aucun lien hors tel:, aucune image, a11y.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseTexte, segments } from "../../src/components/assistant/texte-sur.js";
import { dateFr, peremptionFr, heureFr, dateHeureFr, libelleCommande, tauxFr, pluriel, lienTel, nomFichier, qteFr } from "../../src/components/assistant/format.js";
import { reponseFictive, reponseChatFictive, FICHIERS_FICTIFS } from "../../src/dev/reponses-fictives.js";

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
const TYPES = ["document", "documents", "releve", "commande", "recap_retour", "demande_enregistree", "transmission", "erreur"];
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
  premiereCarte("Où en est ma commande ?"), premiereCarte("Je voudrais faire une demande de retour ou une réclamation."),
  premiereCarte("Je voudrais parler à un conseiller."), premiereCarte("Bonjour"),
], ["documents", "releve", "commande", "recap_retour", "transmission", null]);
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
export const texte = (t) => renderToStaticMarkup(React.createElement("div", null, React.createElement(TexteSur, { texte: t })));
export const carte = (a, outils) => renderToStaticMarkup(React.createElement(Carte, { action: a, outils }));
export const panneau = (props) => renderToStaticMarkup(React.createElement(AssistantPanel, props));
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
vrai("transmission : « Appeler » en tel:", /href="tel:0186043995"/.test(html("transmission")));
vrai("demande enregistrée : mention de la phase pilote", html("demande_enregistree").includes("Phase pilote"));
vrai("commande : frise et lots", html("commande").includes("Suivi de la commande") && html("commande").includes("Lots et péremptions"));
eq("type de carte inconnu : rien", rendu.carte({ type: "lien", url: "https://x" }, outils), "");

const proprietes = { identite: "p-x", auth: { admin: false }, pharmacyName: "PHARMACIE D'ESSAI", acting: null, contexte: null, onClose() {}, onReconnecter() {}, onInfos() {} };
const bureau = rendu.panneau({ ...proprietes, mobile: false });
vrai("bureau : <aside aria-label>", /^<aside[^>]*aria-label="Assistant Elixir"/.test(bureau), bureau.slice(0, 200));
vrai("fil : role=log aria-live=polite", /role="log"[^>]*aria-live="polite"/.test(bureau));
vrai("en-tête : titre, sous-titre, nouvelle conversation, fermer", ["Assistant Elixir", "Factures · relevés · commandes · retours", 'aria-label="Nouvelle conversation"', 'aria-label="Fermer l&#x27;assistant"'].every(t => bureau.includes(t)), bureau);
vrai("saisie : 2 000 caractères au plus", /<textarea[^>]*maxLength="2000"/i.test(bureau) || /<textarea[^>]*maxlength="2000"/i.test(bureau));
const mobile = rendu.panneau({ ...proprietes, mobile: true, acting: { name: "PHARMACIE SERVIE" } });
vrai("mobile : dialog modal", /^<div[^>]*role="dialog"[^>]*aria-modal="true"/.test(mobile), mobile.slice(0, 200));
vrai("mobile : bouton Retour", mobile.includes("Retour : fermer l&#x27;assistant"));
vrai("saisie Elixir : bandeau", mobile.includes("Vous agissez pour <b>PHARMACIE SERVIE</b>"));
vrai("messages sélectionnables malgré l'anti-copie", /ex-assistant__fil ex-selectionnable/.test(bureau));

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
