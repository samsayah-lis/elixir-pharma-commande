// ── API des pharmacies, P9 : avis par e-mail des clés et alertes d'usage ──
// Conception § 3.3 (6) et § 3.6 ; prérequis P9 de l'ouverture des commandes réelles (docs/api/mise-en-service.md § 2).
//  • avisCle : e-mail à la pharmacie (adresses de compte du site ENCORE sur la fiche Odoo : identifier() de l'Assistant, ou
//    comptesEmailDeFiche) à chaque clé créée, remplacée ou révoquée — depuis son compte, depuis l'admin, ou automatiquement.
//    Copie à Elixir (GP_ADMIN_MAIL, à défaut pharmacien@elixirpharma.fr) pour une clé de PRODUCTION ou une révocation
//    automatique. Fiche sans aucune adresse de compte (lecture réussie, liste vide) : Elixir seul, avec la mention ; adresses
//    ILLISIBLES (lecture en échec) : rien n'est envoyé, c'est un échec repris plus tard. L'e-mail ne contient JAMAIS la clé :
//    seulement son début (prefixe), son nom, ses droits et l'environnement. Envoi par mail.mail d'Odoo (comme les
//    justificatifs et les alertes du relais), avec un Message-ID propre à (clé, avis) : une reprise retrouve le message déjà
//    créé et ne l'envoie jamais deux fois.
//    Dans une requête (api-compte, api-admin), la 1re tentative est bornée à AVIS.budget_requete_ms : la réponse qui porte le
//    secret d'une clé part toujours avant le délai des fonctions Netlify. Une marque « avis_en_attente » est posée AVANT
//    l'envoi ; un échec (« avis_echec ») ou une marque restée seule (fonction coupée) est repris par api-cron, espacé
//    (AVIS.espacements_min), AVIS.tentatives_max tentatives en tout ; la dernière échouée est signalée à Elixir.
//  • surveiller (api-cron, toutes les 15 min) : reprise des avis, clé inutilisée (signalée à ALERTES.inactive_jours,
//    révoquée à ALERTES.revocation_jours), nouveau réseau, réseau refusé, taux d'erreurs, volume inhabituel. Chaque alerte :
//    un événement « alerte_* » (role « systeme », détail SANS adresse IP complète ni e-mail), une notification et un e-mail à
//    Elixir — jamais deux fois pour le même fait (dédoublonnage par les événements eux-mêmes). Aucun envoi n'est commencé
//    au-delà de l'échéance du passage (ALERTES.echeance_ms) : le reste attend le passage suivant.
// Dépôt public : textes neutres, aucune donnée réelle ici ; les tests (scripts/test-api-avis.mjs) utilisent un faux Odoo.
import { odoo as odooRpc } from "./_odoo-rpc.js";
import { esc, MAIL_DE } from "./_lab-justif.js";
import { ALERTES, AVIS, NOMS_PORTEES, jourParis } from "./_api-config.js";
import { clePublique, etatCle } from "./_api-cles.js";

export const MAIL_ELIXIR = (env = process.env) => String(env.GP_ADMIN_MAIL || "pharmacien@elixirpharma.fr").trim();
export const DOC_URL = "https://elixir-commande.expepharma.com/api/";
const ENV_TXT = { live: "production", test: "test" };
const QUOI = { cle_creee: "créée", cle_remplacee: "remplacée", cle_revoquee: "révoquée" };
export const TYPES_AVIS = Object.keys(QUOI);
export const TYPES_ALERTE = ["alerte_cle_inactive", "alerte_nouveau_reseau", "alerte_reseau_refuse", "alerte_erreurs", "alerte_volume"];
export const LIBELLES_ALERTE = { alerte_cle_inactive: "clé inutilisée", alerte_nouveau_reseau: "nouveau réseau", alerte_reseau_refuse: "réseau refusé",
  alerte_erreurs: "trop d'erreurs", alerte_volume: "volume inhabituel" };
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const adresses = (liste) => [...new Set((Array.isArray(liste) ? liste : []).map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL.test(e)))];
const jours = (ms) => Math.floor(ms / 86400e3);
// Message-ID d'un avis : un par (clé, avis) — une clé n'est créée, remplacée (nouvelle clé) ou révoquée qu'une fois
export const messageIdAvis = (cleId, type) => `<api-avis-${String(cleId).replace(/[^0-9a-f-]/gi, "")}-${type}@elixirpharma.fr>`;
// promesse bornée : valeur, ou `defaut` si elle échoue ou dépasse ms (l'appel sous-jacent n'est pas interrompu)
export function borne(promesse, ms, defaut = null) {
  let minuteur;
  return Promise.race([Promise.resolve(promesse).catch(() => defaut), new Promise((r) => { minuteur = setTimeout(() => r(defaut), Math.max(0, ms)); })])
    .finally(() => clearTimeout(minuteur));
}

// ── Dates (heure de Paris) ──
export const dateParis = (d) => {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(t).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} à ${p.hour} h ${p.minute}`;
};
// minuit du jour de Paris qui contient d (début de la fenêtre « aujourd'hui » des alertes de volume et de réseau)
export function debutJourParis(d = new Date()) {
  const jour = jourParis(d);
  for (const off of ["+01:00", "+02:00"]) {
    const m = Date.parse(`${jour}T00:00:00${off}`);
    if (jourParis(new Date(m)) === jour && jourParis(new Date(m - 1000)) !== jour) return new Date(m);
  }
  return new Date(Date.parse(`${jour}T00:00:00+01:00`));
}

// ── Textes ──
const gabarit = (paragraphes, pied) => `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45"><p>Bonjour,</p>${paragraphes.map(p => `<p>${p}</p>`).join("")}
<p style="color:#64748b;font-size:9pt">${pied}</p></div>`;
const PIED = `Elixir Pharma — API des pharmacies. Documentation : <a href="${DOC_URL}">${DOC_URL}</a>. Cet e-mail est envoyé automatiquement à chaque clé créée, remplacée ou révoquée.`;
const droits = (cle) => (cle.portees || []).map(p => NOMS_PORTEES[p] || p).join(" + ") || "–";

// E-mail d'avis d'une clé → { sujet, html }. cle : clePublique (jamais le secret) ; par : compte de la pharmacie ou e-mail de
// l'admin ; role : pharmacie | admin | systeme ; quand : date ; motif : révocation ; expire : rotation (ancienne clé) ;
// sansCompte : la fiche n'a aucune adresse de compte (e-mail à Elixir seul)
export function texteAvisCle({ type, cle, acces, par, role, quand, motif = null, expire = null, sansCompte = false }) {
  const env = ENV_TXT[cle.environnement] || cle.environnement;
  const quoi = QUOI[type] || type;
  const nom = acces?.nom || `fiche n° ${acces?.odoo_id ?? cle.odoo_id ?? "?"}`;
  const origine = role === "pharmacie" ? `depuis le compte du site de votre pharmacie (${esc(par)})`
    : role === "admin" ? "par Elixir Pharma, dans son administration" : `automatiquement${motif ? ` : ${esc(motif)}` : ""}`;
  const paragraphes = [
    `La clé d'API de <b>${env}</b> « ${esc(cle.libelle)} » (début : <code>${esc(cle.prefixe)}</code> ; droits : ${esc(droits(cle))}) de la pharmacie <b>${esc(nom)}</b> a été <b>${quoi}</b> le ${dateParis(quand)}, ${origine}.`,
  ];
  if (type === "cle_remplacee") paragraphes.push(`L'ancienne clé reste valide${expire ? ` jusqu'au ${dateParis(expire)}` : " 7 jours"}, le temps de mettre votre outil à jour ; elle s'arrêtera ensuite seule.`);
  if (type === "cle_revoquee") paragraphes.push(`Elle ne fonctionne plus${role !== "systeme" && motif ? ` (motif : ${esc(motif)})` : ""}. Si votre outil l'utilisait encore, créez une nouvelle clé depuis votre compte (« Mes commandes » → « Accès API »).`);
  if (cle.environnement === "test") paragraphes.push("Une clé de test ne passe aucune commande réelle, mais elle lit les données de votre pharmacie (catalogue à vos prix, commandes, documents selon ses droits).");
  paragraphes.push(type === "cle_revoquee" && role === "systeme"
    ? "Cette révocation est automatique (clé inutilisée depuis longtemps) : il n'y a rien à faire si vous n'utilisez plus cet outil."
    : `<b>Si vous n'êtes pas à l'origine de cette opération</b>, révoquez vos clés sans délai depuis votre compte (« Mes commandes » → « Accès API ») et prévenez Elixir Pharma (${esc(MAIL_ELIXIR())}).`);
  paragraphes.push("La clé elle-même ne figure jamais dans un e-mail : seul son début est rappelé ici.");
  if (sansCompte) paragraphes.push("<i>Elixir : cette fiche n'a aucune adresse de compte du site encore présente sur sa fiche Odoo ; la pharmacie n'a pas reçu cet avis. Prévenez-la.</i>");
  return { sujet: `Elixir Pharma — clé d'API ${quoi} (${env}) : « ${String(cle.libelle || "").slice(0, 60)} »`, html: gabarit(paragraphes, PIED) };
}

// E-mail d'alerte à Elixir → { sujet, html }. alerte : { type, acces: { nom, cip }, cle: { prefixe, libelle, environnement }, detail }
export function texteAlerte({ type, acces, cle, detail = {} }) {
  const nom = acces?.nom || `fiche n° ${acces?.odoo_id ?? "?"}`;
  const quelle = cle ? `la clé « ${esc(cle.libelle)} » (<code>${esc(cle.prefixe)}</code>, ${ENV_TXT[cle.environnement] || cle.environnement})` : "une clé";
  const liste = (xs) => (xs || []).map(esc).join(", ");
  const textes = {
    alerte_cle_inactive: [`Clé inutilisée : ${quelle} de ${esc(nom)} n'a servi à aucun appel depuis ${detail.jours_inactive} jours${detail.jamais_utilisee ? " (jamais utilisée depuis sa création)" : ""}.`,
      `Sans utilisation, elle sera révoquée automatiquement à ${ALERTES.revocation_jours} jours. Vous pouvez la révoquer dès maintenant (onglet 🔌 API) si l'outil n'est plus utilisé.`],
    alerte_nouveau_reseau: [`Nouveau réseau : ${quelle} de ${esc(nom)} vient d'appeler depuis ${(detail.reseaux || []).length > 1 ? "les réseaux" : "le réseau"} <code>${liste(detail.reseaux)}</code>, jamais vu${(detail.reseaux || []).length > 1 ? "s" : ""} pour cette clé (${detail.appels} appel(s) sur ${ALERTES.reseau_fenetre_min} min).`,
      "Un changement d'outil ou de connexion de la pharmacie est l'explication la plus courante. En cas de doute : révoquez la clé (onglet 🔌 API) et appelez la pharmacie. Une seule alerte de ce type par clé et par jour."],
    alerte_reseau_refuse: [`Réseau refusé : ${detail.appels} appel(s) de ${quelle} de ${esc(nom)} refusés dans la dernière heure (réseau non autorisé${detail.reseaux?.length ? ` : ${liste(detail.reseaux)}` : ""}).`,
      "Soit la pharmacie a changé de réseau (mettez à jour ses réseaux autorisés), soit la clé est utilisée ailleurs (révoquez-la et appelez-la). Une seule alerte de ce type par clé et par jour."],
    alerte_erreurs: [`Erreurs : ${quelle} de ${esc(nom)} a reçu ${detail.erreurs} réponses 4xx sur ${detail.requetes} appels dans la dernière heure (${detail.part} %).`,
      "L'outil de la pharmacie est probablement mal paramétré (clé, droits, format des requêtes) : le journal des appels de l'onglet 🔌 API donne les codes d'erreur."],
    alerte_volume: [`Volume inhabituel : ${quelle} de ${esc(nom)} a fait ${detail.appels_jour} appels aujourd'hui, contre ${detail.moyenne_jour} par jour en moyenne sur les ${ALERTES.volume_historique_jours} jours précédents.`,
      "Une synchronisation en boucle est l'explication la plus courante. Les débits par clé bornent la charge ; en cas de doute, suspendez l'accès ou révoquez la clé."],
  };
  const [p1, p2] = textes[type] || [`Alerte ${esc(type)} pour ${quelle} de ${esc(nom)}.`, ""];
  const pied = "Elixir Pharma — API des pharmacies : alerte automatique du passage planifié (onglet 🔌 API de l'admin, section « Alertes »).";
  return { sujet: `API des pharmacies : ${LIBELLES_ALERTE[type] || type} — ${String(nom).slice(0, 80)}`, html: gabarit([p1, p2].filter(Boolean), pied) };
}

// ── Envoi ──
// deps (doublures des tests) : odoo(model, method, args, kwargs, opts), journal(o), elixir (adresse), de (expéditeur),
// horloge() → millisecondes (budgets et échéances ; par défaut l'horloge réelle)
export function creerAvis(deps = {}) {
  const odoo = deps.odoo || odooRpc;
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-avis", ...o })));
  const elixir = () => deps.elixir || MAIL_ELIXIR();
  const de = deps.de || MAIL_DE;
  const horloge = deps.horloge || (() => Date.now());

  // → { ok: true, id, deja? } ; lève si Odoo refuse, ne répond pas, ou si le budget est épuisé.
  // messageId : Message-ID du message (idempotence) ; rechercher : une reprise cherche d'abord le message déjà créé par une
  // tentative précédente (envoyé : rien à faire ; en file ou en échec d'envoi : renvoyé, jamais recréé).
  async function envoyer({ a = [], cc = null, sujet, html, messageId = null, rechercher = false, budgetMs = AVIS.budget_requete_ms }) {
    const to = adresses(a), copie = adresses([cc]);
    if (!to.length && !copie.length) throw new Error("aucun destinataire");
    const fin = horloge() + budgetMs;
    const reste = () => {
      const r = fin - horloge();
      if (r < 150) throw new Error("délai dépassé");
      return { timeoutMs: Math.min(AVIS.delai_odoo_ms, r) };
    };
    const verifier = async (id) => {
      const [m] = await odoo("mail.mail", "read", [[id], ["state", "failure_reason"]], {}, reste());
      if (m?.state === "exception") throw new Error("envoi refusé par la messagerie");
      return { ok: true, id };
    };
    if (messageId && rechercher) {
      const [deja] = await odoo("mail.mail", "search_read", [[["message_id", "=", messageId]]], { fields: ["id", "state"], limit: 1 }, reste());
      if (deja) {
        if (["sent", "received", "cancel"].includes(deja.state)) return { ok: true, id: deja.id, deja: true };   // envoyé (ou annulé à la main dans Odoo)
        if (deja.state === "exception") await odoo("mail.mail", "mark_outgoing", [[deja.id]], {}, reste());
        await odoo("mail.mail", "send", [[deja.id]], {}, reste());
        return { ...(await verifier(deja.id)), deja: true };
      }
    }
    const corps = { subject: String(sujet).slice(0, 200), body_html: html, email_from: de, email_to: (to.length ? to : copie).join(", "),
      email_cc: to.length && copie.length ? copie.join(", ") : false, auto_delete: false, ...(messageId ? { message_id: messageId } : {}) };
    const id = await odoo("mail.mail", "create", [corps], {}, reste());
    await odoo("mail.mail", "send", [[id]], {}, reste());
    return verifier(id);
  }

  // Avis d'une clé → true (envoyé) | false (échec tracé, jamais levé)
  // { type, cle (clePublique), acces, par, role, comptes (adresses de compte ; null = lecture en échec), quand, motif, expire,
  //   tentative (1 : dans la requête ; ≥ 2 : reprise), budgetMs }
  async function avisCle(stock, { type, cle, acces, par, role, comptes = [], quand, motif = null, expire = null, tentative = 1, budgetMs = AVIS.budget_requete_ms }) {
    const lisibles = Array.isArray(comptes);
    const a = lisibles ? adresses(comptes) : [];
    const automatique = role === "systeme";
    const cc = cle.environnement === "live" || automatique ? elixir() : null;
    const odooId = acces?.odoo_id ?? cle.odoo_id ?? null;
    const detail = { avis: type, destinataires: a.length, copie_elixir: !!cc, ...(lisibles && !a.length ? { sans_compte: true } : {}), par: par || null, role, motif, expire,
      quand: quand ? new Date(quand).toISOString() : null };
    const trace = (evt, extra) => stock.evenements.ajouter({ type: evt, odoo_id: odooId, cle_id: cle.id || null, par: "api-avis", role: "systeme", detail: { ...detail, ...extra } })
      .catch((e) => journal({ code: "evenement", type: evt, erreur: String(e?.message || e).slice(0, 80) }));
    // marque posée AVANT l'envoi : si la fonction est coupée pendant l'envoi, api-cron la reprend (attente_min)
    if (tentative === 1) await trace("avis_en_attente", { tentative: 0 });
    const echec = async (erreur) => {
      const abandon = tentative >= AVIS.tentatives_max;
      journal({ code: "avis_echec", type, tentative, abandon, erreur: String(erreur).slice(0, 120) });
      await trace("avis_echec", { tentative, erreur: String(erreur).slice(0, 160), ...(abandon ? { abandon: true } : {}) });
      if (abandon) await stock.site.notifier({ type: "new_order", title: `⚠ E-mail d'avis de clé API non envoyé — ${acces?.nom || `fiche n° ${odooId ?? "?"}`}`,
        body: `Avis « clé ${QUOI[type] || type} » (${cle.prefixe}) : ${tentative} tentatives sans succès (${String(erreur).slice(0, 80)}). Prévenez la pharmacie vous-même.`,
        data: { source: "api", motif: "avis_abandon", odoo_id: odooId, prefixe: cle.prefixe } }).catch((e) => journal({ code: "notification", erreur: String(e?.message || e).slice(0, 80) }));
      return false;
    };
    if (!lisibles) return echec("adresses de compte illisibles");
    try {
      const { sujet, html } = texteAvisCle({ type, cle, acces, par, role, quand: quand || new Date(), motif, expire, sansCompte: !a.length });
      await envoyer({ a, cc: a.length ? cc : elixir(), sujet, html, messageId: cle.id ? messageIdAvis(cle.id, type) : null, rechercher: tentative > 1, budgetMs });
      await trace("avis_envoye", { tentative });
      return true;
    } catch (e) {
      return echec(e?.message || e);
    }
  }

  // Avis à reprendre (api-cron) : pour chaque (clé, avis), le DERNIER événement décide —
  //  • avis_en_attente seul depuis plus de attente_min minutes (fonction coupée pendant l'envoi) → tentative 2 ;
  //  • avis_echec, tentative t < tentatives_max, plus vieux que espacements_min[t - 1] minutes → tentative t + 1 ;
  //  • avis_envoye, ou abandon → rien.
  // → [{ evenement, tentative }], les plus anciens d'abord
  async function avisDus(stock, now) {
    const depuis = new Date(now.getTime() - AVIS.reprise_h * 3600e3).toISOString();
    // les plus récents d'abord (date, puis identifiant : deux événements écrits dans la même seconde gardent leur ordre)
    const evts = (await stock.evenements.avis(depuis, 1000)).sort((x, y) => (Date.parse(y.at) - Date.parse(x.at)) || ((Number(y.id) || 0) - (Number(x.id) || 0)));
    const vus = new Set(), dus = [];
    for (const e of evts) {
      const d = e.detail || {};
      const k = `${e.cle_id}|${d.avis}`;
      if (!e.cle_id || !d.avis || vus.has(k)) continue;
      vus.add(k);
      const age = now.getTime() - Date.parse(e.at);
      if (e.type === "avis_en_attente" && age >= AVIS.attente_min * 60e3) dus.push({ evenement: e, tentative: 2 });
      else if (e.type === "avis_echec" && !d.abandon && (d.tentative || 1) < AVIS.tentatives_max
        && age >= (AVIS.espacements_min[(d.tentative || 1) - 1] ?? AVIS.espacements_min.at(-1)) * 60e3) dus.push({ evenement: e, tentative: (d.tentative || 1) + 1 });
    }
    return dus.reverse();
  }

  // Reprise (api-cron) : AVIS.reprises_par_passage au plus, jamais au-delà de l'échéance. → nombre de reprises tentées
  async function reprendreAvis(stock, { now = new Date(), comptes = async () => [], echeance = horloge() + ALERTES.echeance_ms } = {}) {
    let reprises = 0;
    for (const { evenement: e, tentative } of await avisDus(stock, now)) {
      if (reprises >= AVIS.reprises_par_passage || echeance - horloge() < AVIS.budget_requete_ms + AVIS.delai_odoo_ms) break;
      const d = e.detail || {};
      const cle = await stock.cles.lireAdmin(e.cle_id).catch(() => null);
      if (!cle) continue;
      const acces = await stock.acces.lire(cle.odoo_id).catch(() => null);
      const dest = await borne(comptes(cle.odoo_id), AVIS.delai_odoo_ms, null);   // null : illisibles, échec compté
      reprises++;
      await avisCle(stock, { type: d.avis, cle: clePublique(cle, now), acces, par: d.par, role: d.role || "systeme", comptes: dest, quand: d.quand || e.at, motif: d.motif,
        expire: d.expire, tentative, budgetMs: Math.min(AVIS.budget_requete_ms, echeance - horloge() - 300) });
    }
    return reprises;
  }

  // Alerte à Elixir : événement (mémoire du dédoublonnage), notification, e-mail tenté une fois (jamais levé). → true si
  // enregistrée
  async function alerter(stock, { type, acces, cle, detail, budgetMs = AVIS.budget_requete_ms }) {
    const resume = { ...detail, prefixe: cle?.prefixe || null, libelle: cle?.libelle || null, environnement: cle?.environnement || null, pharmacie: acces?.nom || null };
    try { await stock.evenements.ajouter({ type, odoo_id: acces?.odoo_id ?? cle?.odoo_id ?? null, cle_id: cle?.id || null, par: "api-cron", role: "systeme", detail: resume }); }
    catch (e) { journal({ code: "evenement", type, erreur: String(e?.message || e).slice(0, 80) }); return false; }
    const { sujet, html } = texteAlerte({ type, acces, cle, detail });
    await stock.site.notifier({ type: "new_order", title: `⚠ API : ${LIBELLES_ALERTE[type] || type} — ${acces?.nom || `fiche n° ${acces?.odoo_id ?? "?"}`}`,
      body: sujet.replace(/^API des pharmacies : /, ""), data: { source: "api", motif: type, odoo_id: acces?.odoo_id ?? null, prefixe: cle?.prefixe || null } })
      .catch((e) => journal({ code: "notification", type, erreur: String(e?.message || e).slice(0, 80) }));
    try { await envoyer({ a: [elixir()], sujet, html, budgetMs }); }
    catch (e) { journal({ code: "alerte_email", type, erreur: String(e?.message || e).slice(0, 120) }); }
    return true;
  }

  // ── Surveillance (api-cron) ──
  // options : { now, comptes(odooId), inactives (contrôle des clés inutilisées), volumes (contrôle des volumes du jour),
  // echeance (horloge : aucun envoi commencé au-delà) }
  // → bilan { avis_repris, alertes, revoquees, journal_tronque, coupe, erreur? } ; ne lève jamais
  async function surveiller(stock, { now = new Date(), comptes = async () => [], inactives = false, volumes = false, echeance = horloge() + ALERTES.echeance_ms } = {}) {
    const bilan = { avis_repris: 0, alertes: 0, revoquees: 0, journal_tronque: false, coupe: false };
    const reste = () => echeance - horloge();
    // un envoi ne commence que s'il peut finir avant l'échéance (sinon : passage suivant)
    const tempsPourEnvoyer = (lecture = 0) => { if (reste() >= AVIS.budget_requete_ms + lecture + 500) return true; bilan.coupe = true; return false; };
    const budget = () => Math.min(AVIS.budget_requete_ms, reste() - 300);
    let envoyees = 0;
    const alerte = async (a) => {
      if (envoyees >= ALERTES.par_passage_max || !tempsPourEnvoyer()) return false;
      envoyees++;
      if (await alerter(stock, { ...a, budgetMs: budget() })) bilan.alertes++;
      return true;
    };
    const accesCache = new Map();
    const accesDe = async (id) => { if (!accesCache.has(id)) accesCache.set(id, await stock.acces.lire(id).catch(() => null)); return accesCache.get(id); };
    try { bilan.avis_repris = await reprendreAvis(stock, { now, comptes, echeance }); } catch (e) { journal({ code: "reprise_avis", erreur: String(e?.message || e).slice(0, 120) }); }

    let cles = [];
    try { cles = await stock.cles.toutes(); } catch (e) { journal({ code: "cles", erreur: String(e?.message || e).slice(0, 120) }); return { ...bilan, erreur: "cles" }; }
    const parId = new Map(cles.map(c => [c.id, c]));
    const t = now.getTime();

    // 1. clés inutilisées (une fois par jour) ; révocations bornées par passage, le reste au passage suivant
    if (inactives) try {
      const depuis = new Date(t - (ALERTES.revocation_jours + 30) * 86400e3).toISOString();
      const signalees = await stock.evenements.deType("alerte_cle_inactive", depuis, 1000);
      for (const c of cles) {
        if (etatCle(c, now) !== "active") continue;
        const dernier = c.derniere_utilisation || c.created_at;
        const age = jours(t - Date.parse(dernier));
        if (age >= ALERTES.revocation_jours) {
          if (bilan.revoquees >= ALERTES.revocations_par_passage || !tempsPourEnvoyer(AVIS.delai_odoo_ms)) continue;   // adresses à lire, puis e-mail
          const motif = `inutilisée depuis ${age} jours : révoquée automatiquement`;
          const r = await stock.cles.revoquer(c.id, c.odoo_id, { par: "systeme", motif });
          if (!r) continue;
          bilan.revoquees++;
          const acces = await accesDe(c.odoo_id);
          await stock.evenements.ajouter({ type: "cle_revoquee", odoo_id: c.odoo_id, cle_id: c.id, par: "api-cron", role: "systeme", detail: { motif, prefixe: r.prefixe, automatique: true, jours_inactive: age } })
            .catch((e) => journal({ code: "evenement", type: "cle_revoquee", erreur: String(e?.message || e).slice(0, 80) }));
          // l'avis pose sa marque « en attente » avant d'envoyer : une coupure est reprise au passage suivant
          await avisCle(stock, { type: "cle_revoquee", cle: clePublique(r, now), acces, par: "api-cron", role: "systeme",
            comptes: await borne(comptes(c.odoo_id), AVIS.delai_odoo_ms, null), quand: now, motif, budgetMs: budget() });
          await stock.site.notifier({ type: "new_order", title: `🔑 Clé API révoquée automatiquement — ${acces?.nom || `fiche n° ${c.odoo_id}`}`,
            body: `« ${r.libelle} » (${r.prefixe}, ${ENV_TXT[r.environnement] || r.environnement}) : ${motif}.`, data: { source: "api", motif: "cle_revoquee_auto", odoo_id: c.odoo_id, prefixe: r.prefixe } })
            .catch((e) => journal({ code: "notification", type: "cle_revoquee", erreur: String(e?.message || e).slice(0, 80) }));
        } else if (age >= ALERTES.inactive_jours) {
          // déjà signalée depuis sa dernière utilisation ? (une clé réutilisée puis oubliée de nouveau est signalée de nouveau)
          if (signalees.some(e => e.cle_id === c.id && Date.parse(e.at) > Date.parse(dernier))) continue;
          await alerte({ type: "alerte_cle_inactive", acces: await accesDe(c.odoo_id), cle: c, detail: { jours_inactive: age, jamais_utilisee: !c.derniere_utilisation } });
        }
      }
    } catch (e) { journal({ code: "inactives", erreur: String(e?.message || e).slice(0, 120) }); }

    // 2. journal de la dernière heure : erreurs, réseaux refusés, nouveaux réseaux
    try {
      const heure = new Date(t - ALERTES.erreurs_fenetre_min * 60e3).toISOString();
      const fenetre = new Date(t - ALERTES.reseau_fenetre_min * 60e3).toISOString();
      const toutes = await stock.journal.lister({ depuisIso: heure, limite: ALERTES.journal_max });
      if (toutes.length >= ALERTES.journal_max) { bilan.journal_tronque = true; journal({ code: "journal_tronque", lignes: toutes.length }); }
      const lignes = toutes.filter(l => l.cle_id && l.environnement !== "apercu");
      const tFenetre = Date.parse(fenetre);
      const parCle = new Map();
      for (const l of lignes) {
        const s = parCle.get(l.cle_id) || parCle.set(l.cle_id, { n: 0, e4: 0, refus: new Map(), reseaux: new Map() }).get(l.cle_id);
        if (l.code === "ip_non_autorisee") { if (l.reseau) s.refus.set(l.reseau, (s.refus.get(l.reseau) || 0) + 1); continue; }   // « réseau refusé », pas « erreurs »
        s.n++;
        if (l.statut >= 400 && l.statut < 500) s.e4++;
        if (l.reseau && l.statut < 400 && Date.parse(l.at) >= tFenetre) s.reseaux.set(l.reseau, (s.reseaux.get(l.reseau) || 0) + 1);
      }
      if (parCle.size) {
        const minuit = debutJourParis(now).toISOString();
        const [dejaErreurs, dejaRefus, dejaReseaux] = await Promise.all([stock.evenements.deType("alerte_erreurs", heure, 1000),
          stock.evenements.deType("alerte_reseau_refuse", minuit, 1000), stock.evenements.deType("alerte_nouveau_reseau", minuit, 1000)]);
        for (const [cleId, s] of parCle) {
          const cle = parId.get(cleId);
          if (!cle) continue;
          if (reste() < 1000) { bilan.coupe = true; break; }
          const acces = await accesDe(cle.odoo_id);
          // erreurs : une alerte par clé et par heure
          if (s.n >= ALERTES.erreurs_min && s.e4 / s.n >= ALERTES.erreurs_part && !dejaErreurs.some(e => e.cle_id === cleId))
            await alerte({ type: "alerte_erreurs", acces, cle, detail: { requetes: s.n, erreurs: s.e4, part: Math.round(100 * s.e4 / s.n) } });
          // réseau refusé : une alerte par clé et par jour
          if (s.refus.size && !dejaRefus.some(e => e.cle_id === cleId))
            await alerte({ type: "alerte_reseau_refuse", acces, cle, detail: { appels: [...s.refus.values()].reduce((x, y) => x + y, 0), reseaux: [...s.refus.keys()].slice(0, ALERTES.reseaux_max) } });
          // nouveau réseau : clé déjà utilisée avant la fenêtre, réseau jamais vu pour elle ; une alerte par clé et par jour
          // (5 réseaux nommés au plus) ; sans objet avec des réseaux autorisés
          if (s.reseaux.size && !acces?.ip_autorisees?.length && !dejaReseaux.some(e => e.cle_id === cleId) && await stock.journal.existe({ cleId, avantIso: fenetre })) {
            const nouveaux = [];
            for (const [reseau, appels] of s.reseaux) {
              if (nouveaux.length >= ALERTES.reseaux_max) break;
              if (!(await stock.journal.existe({ cleId, avantIso: fenetre, reseau }))) nouveaux.push([reseau, appels]);
            }
            if (nouveaux.length) await alerte({ type: "alerte_nouveau_reseau", acces, cle, detail: { reseaux: nouveaux.map(x => x[0]), appels: nouveaux.reduce((x, y) => x + y[1], 0) } });
          }
        }
      }
    } catch (e) { journal({ code: "journal", erreur: String(e?.message || e).slice(0, 120) }); }

    // 3. volume du jour (première passe de chaque heure) : clés utilisées aujourd'hui
    if (volumes) try {
      const minuit = debutJourParis(now);
      const dejaVolume = await stock.evenements.deType("alerte_volume", minuit.toISOString(), 1000);
      for (const c of cles) {
        if (!c.derniere_utilisation || Date.parse(c.derniere_utilisation) < minuit.getTime() || dejaVolume.some(e => e.cle_id === c.id)) continue;
        if (reste() < 1000) { bilan.coupe = true; break; }
        const jour = await stock.journal.compter({ cleId: c.id, depuisIso: minuit.toISOString() });
        if (jour < ALERTES.volume_min) continue;
        const avant = new Date(minuit.getTime() - ALERTES.volume_historique_jours * 86400e3).toISOString();
        const histo = await stock.journal.compter({ cleId: c.id, depuisIso: avant, avantIso: minuit.toISOString() });
        const moyenne = histo / ALERTES.volume_historique_jours;
        if (jour > ALERTES.volume_facteur * moyenne)
          await alerte({ type: "alerte_volume", acces: await accesDe(c.odoo_id), cle: c, detail: { appels_jour: jour, moyenne_jour: Math.round(moyenne) } });
      }
    } catch (e) { journal({ code: "volumes", erreur: String(e?.message || e).slice(0, 120) }); }

    if (bilan.coupe) journal({ code: "echeance", detail: "passage arrêté avant l'échéance : la suite au passage suivant" });
    return bilan;
  }

  return { envoyer, avisCle, avisDus, reprendreAvis, alerter, surveiller };
}
