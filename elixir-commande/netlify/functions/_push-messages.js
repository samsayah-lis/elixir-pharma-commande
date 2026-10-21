// ── Notifications de l'appli Elixir : messages typés de l'admin, e-mail de secours, programmation, API de l'outil entrepôt ──
// (docs/notifications.md § 4 à 6). Utilisé par push-admin.js, push-envoi-background.js, push-programmes.js et
// push-evenement.js ; s'appuie sur _push.js (stockage, envoi, destinataires), jamais l'inverse.
//  • E-mail de secours (message unitaire, case cochée par l'admin) : quand la pharmacie n'a été jointe sur AUCUN appareil.
//    Destinataires : adresses de COMPTE de la pharmacie (lignes de elixir_pharmacies portant son CIP), jamais l'e-mail de
//    la fiche Odoo (il peut être celui d'une autre officine du même titulaire) ni une adresse venue du navigateur. Un e-mail
//    par adresse (5 au plus), expéditeur pharmacien@elixirpharma.fr (comme sendMail), clé d'idempotence Resend par
//    message et par adresse (une reprise ne renvoie jamais), charte de l'e-mail « De retour en stock » (Inter, pétrole, or).
//  • Programmation : push-programmes.js (toutes les 5 minutes) passe les messages dus de « programmée » à « en file » (une
//    seule fois), lance l'envoi ; un message dû depuis plus de 3 h n'est jamais envoyé (erreur expliquée) ; un message
//    resté « en file » (lancement perdu, autre diffusion plafonnée en cours) est relancé pendant 24 h.
//  • API de l'outil entrepôt (push-evenement.js) : signature HMAC-SHA256 comme l'API « chatbot-intake »
//    (docs/assistant-contrat.md : X-Elixir-Horodatage, X-Elixir-Signature: sha256=…, Idempotency-Key), textes par défaut
//    selon le type et le statut, jamais de montant.
// Code compatible Node 18. Journaux : JSON une ligne, jamais d'adresse e-mail, de texte de message ni de secret.
import crypto from "node:crypto";
import {
  LIMITES, PROGRAMME_RETARD_MAX_MS, lienValide, texteNet, longueur, cipPropre, contientMontant, raisonOuverture,
} from "../../src/notifications/regles.js";
import { creerStockPush, lancerEnvoi, siteBaseEnv, ECHECS_EN_ALERTE, estUuid } from "./_push.js";

export const SITE_PHARMACIES = "https://elixir-commande.expepharma.com";
const FROM_DEFAUT = "Elixir Pharma <pharmacien@elixirpharma.fr>";
const REPONSE = "pharmacien@elixirpharma.fr";
export const DELAI_EMAIL_MS = 6000;
export const ADRESSES_MAX = 5;
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// « pharmacie@exemple.fr » → « ph…@…fr » (affichage de l'admin : jamais l'adresse complète)
export function masquerEmail(e) {
  const [local, domaine] = String(e || "").split("@");
  if (!local || !domaine) return null;
  return `${local.slice(0, 2)}…@…${domaine.split(".").pop()}`;
}

// ── E-mail de secours (charte de l'e-mail « De retour en stock », _restock.js : Inter, pétrole et or, une colonne) ──
const POLICE = "font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif";
const BANDEAUX = { reclamation: "Suivi de votre réclamation", commande: "Suivi de votre commande", communication: "Information Elixir", promotion: "Offre Elixir" };
const libelleBouton = (url) => url === "/?commandes=1" ? "Voir mes commandes" : /^\/\?cip=/.test(url) ? "Voir le produit" : /^\/\?menu=/.test(url) ? "Voir le menu"
  : /^\/\?outil=/.test(url) ? "Ouvrir l'outil" : "Ouvrir mon espace Elixir";
// type, titre, corps, url (chemin du site, lienValide) ; pharmacie : nom (facultatif) → { subject, html }
export function emailSecours({ type = "communication", titre, corps, url = "/", pharmacie = null, site = SITE_PHARMACIES }) {
  const t = texteNet(titre) || "Message d'Elixir Pharma", c = texteNet(corps);
  const chemin = lienValide(url) || "/";
  const lien = `${site}${chemin === "/" ? "/" : chemin}`;
  const subject = t.replace(/[\r\n]+/g, " ").slice(0, 120);
  const bandeau = BANDEAUX[type] || BANDEAUX.communication;
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4efe4;${POLICE};color:#201917;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4efe4;">${esc(c.slice(0, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4efe4;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#fbf8f2;border-radius:16px;border-collapse:separate;overflow:hidden;">
      <tr><td style="background:#0f2d3d;padding:20px 28px;${POLICE};">
        <span style="font-size:17px;line-height:24px;font-weight:700;letter-spacing:-0.02em;color:#fbf8f2;">Elixir Pharma</span>
        <span style="font-size:12px;line-height:24px;font-weight:600;color:#d7bb7f;padding-left:10px;">${esc(bandeau)}</span>
      </td></tr>
      <tr><td style="padding:30px 28px 6px 28px;${POLICE};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="32" height="3" bgcolor="#b5904a" style="width:32px;height:3px;background:#b5904a;font-size:0;line-height:0;">&nbsp;</td></tr></table>
        <h1 style="margin:14px 0 16px 0;font-size:23px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:#0f2d3d;">${esc(t)}</h1>
        <p style="margin:0 0 10px 0;font-size:15px;line-height:23px;color:#201917;">Bonjour,</p>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:23px;color:#201917;">${esc(c)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr>
          <td bgcolor="#0f2d3d" style="border-radius:999px;background:#0f2d3d;">
            <a href="${esc(lien)}" style="display:inline-block;padding:10px 20px;border:1px solid #0f2d3d;border-radius:999px;color:#fbf8f2;background:#0f2d3d;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;${POLICE};">${esc(libelleBouton(chemin))}</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 28px 26px 28px;${POLICE};font-size:14px;line-height:22px;color:#4b4440;">
        <p style="margin:0;">L’équipe Elixir Pharma${pharmacie ? ` · pour <b>${esc(pharmacie)}</b>` : ""}</p>
      </td></tr>
      <tr><td style="padding:18px 28px 24px 28px;border-top:1px solid #e3ddd2;${POLICE};font-size:12px;line-height:19px;color:#6f6863;">
        <p style="margin:0 0 8px 0;">Vous recevez cet e-mail parce que ce message n’a pu s’afficher sur aucun téléphone ni ordinateur de votre pharmacie (notifications de l’application Elixir non activées ou injoignables).</p>
        <p style="margin:0 0 8px 0;">Pour le recevoir directement sur votre téléphone, activez les notifications&nbsp;: <a href="${esc(`${site}/?notifications=1`)}" style="color:#0f2d3d;">${esc(`${site.replace(/^https:\/\//, "")}/?notifications=1`)}</a>.</p>
        <p style="margin:0;">Elixir Pharma · pharmacien@elixirpharma.fr · 01&nbsp;86&nbsp;04&nbsp;39&nbsp;95</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return { subject, html };
}

// Envoi par Resend (même expéditeur et même adresse de réponse que sendMail de _gp-mail.js), délai borné, clé d'idempotence
// → { sent: true } | { sent: false, reason }
export async function envoyerEmailResend({ to, subject, html, idempotence }, { env = process.env, http = (...a) => fetch(...a), delaiMs = DELAI_EMAIL_MS } = {}) {
  const cle = env.RESEND_API_KEY;
  if (!cle) return { sent: false, reason: "RESEND_API_KEY absent des variables Netlify" };
  try {
    const res = await http("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(delaiMs),
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json", ...(idempotence ? { "Idempotency-Key": idempotence } : {}) },
      body: JSON.stringify({ from: env.GP_MAIL_FROM || FROM_DEFAUT, to: [to], subject, html, reply_to: env.GP_ADMIN_MAIL || REPONSE }),
    });
    const corps = await res.json().catch(() => ({}));
    // 409 « invalid_idempotent_request » : déjà envoyé avec cette clé (reprise) → compté comme envoyé
    if (res.ok || (res.status === 409 && corps?.name === "invalid_idempotent_request")) return { sent: true };
    return { sent: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e?.name === "TimeoutError" || e?.name === "AbortError" ? "délai dépassé" : "injoignable" };
  }
}

// E-mail de secours d'un message unitaire (deps.repli de diffuserAnnonce) → async ({ annonce, cip }) → { statut, nb }
// statut : « envoye » (au moins une adresse) | « echec » | « aucune_adresse » (aucun compte du site pour ce CIP)
export function creerRepli({ stock, envoyer = envoyerEmailResend, journal = () => {}, site = SITE_PHARMACIES } = {}) {
  return async ({ annonce, cip }) => {
    const comptes = (await stock.comptesDuCip(cip)).slice(0, ADRESSES_MAX);
    if (!comptes.length) { journal({ evt: "push_repli", annonce: String(annonce.id).slice(0, 8), code: "aucune_adresse" }); return { statut: "aucune_adresse", nb: 0 }; }
    const m = emailSecours({ type: annonce.type, titre: annonce.titre, corps: annonce.corps, url: annonce.url, pharmacie: comptes.find((c) => c.name)?.name || null, site });
    let nb = 0;
    for (const c of comptes) {
      const r = await envoyer({ to: c.email, subject: m.subject, html: m.html, idempotence: `push-msg-${String(annonce.id).slice(0, 36)}-${sha(c.email).slice(0, 16)}` })
        .catch(() => ({ sent: false }));
      if (r?.sent) nb++;
    }
    journal({ evt: "push_repli", annonce: String(annonce.id).slice(0, 8), code: nb ? "envoye" : "echec", adresses: comptes.length, envoyes: nb });
    return { statut: nb ? "envoye" : "echec", nb };
  };
}

// ── Joignabilité d'une pharmacie (recherche de l'admin, choix des destinataires) ──
// lignes : appareils (rôle pharmacie) d'un CIP → { appareils, plateformes, categories (au moins un appareil), derniere_visite,
// derniere_notification, en_echec }
export function resumeAppareils(lignes = []) {
  const max = (k) => lignes.map((l) => l[k]).filter(Boolean).sort().pop() || null;
  const cats = new Set(lignes.flatMap((l) => (Array.isArray(l.categories) ? l.categories : [])));
  return { appareils: lignes.length, plateformes: [...new Set(lignes.map((l) => l.plateforme || "autre"))], categories: ["stock", "commandes", "infos", "offres"].filter((c) => cats.has(c)),
    derniere_visite: max("last_seen_at"), derniere_notification: max("last_success_at"), en_echec: lignes.filter((l) => (l.failures || 0) >= ECHECS_EN_ALERTE).length };
}
// comptes : lignes de elixir_pharmacies ({ email, name, ville, cip }) → pharmacies (une par CIP) avec appareils et adresses masquées
export async function joignabilite(stock, comptes, { limite = 20 } = {}) {
  const parCip = new Map();
  for (const r of comptes) {
    const cip = cipPropre(r.cip);
    if (!cip) continue;
    if (!parCip.has(cip)) parCip.set(cip, { cip, nom: r.name || null, ville: r.ville || null, emails: new Set() });
    const p = parCip.get(cip);
    if (!p.nom && r.name) p.nom = r.name;
    if (!p.ville && r.ville) p.ville = r.ville;
    if (r.email) p.emails.add(String(r.email).toLowerCase());
  }
  const choisies = [...parCip.values()].slice(0, limite);
  if (!choisies.length) return [];
  const [lignes, reglages] = await Promise.all([stock.abonnements.deCips(choisies.map((p) => p.cip)), stock.reglages.lire()]);
  return choisies.map((p) => {
    const emails = [...p.emails].slice(0, ADRESSES_MAX);
    return { cip: p.cip, nom: p.nom, ville: p.ville, ...resumeAppareils(lignes.filter((l) => l.pharmacy_cip === p.cip)),
      adresses: emails.length, adresses_masquees: emails.map(masquerEmail).filter(Boolean), raison: raisonOuverture(reglages, p.cip) };
  });
}

// ── Programmation (push-programmes.js) ──
const dateParis = (t) => new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
// deps : { stock, lancer(id) → null | raison, maintenant, journal } → bilan { dus, lances, abandonnes, relances, echecs }
export async function traiterProgrammes(deps = {}) {
  const stock = deps.stock || creerStockPush();
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || (() => {});
  const lancer = deps.lancer || ((id) => lancerEnvoi(siteBaseEnv(), id));
  const t = maintenant().getTime();
  const bilan = { dus: 0, lances: 0, abandonnes: 0, relances: 0, echecs: 0 };
  // 1. messages dus : trop en retard → jamais envoyés ; sinon « en file » (une seule fois) puis lancés
  const aLancer = [];
  for (const a of await stock.annonces.dus(new Date(t).toISOString())) {
    bilan.dus++;
    const prevu = Date.parse(a.programme_pour);
    if (t - prevu > PROGRAMME_RETARD_MAX_MS) {
      if (await stock.annonces.abandonner(a.id, `Non envoyé : prévu le ${dateParis(prevu)}, le service n'a pas pu l'envoyer à temps (plus de 3 h de retard). Recomposez-le si besoin.`)) bilan.abandonnes++;
      continue;
    }
    const pris = await stock.annonces.passerEnFile(a.id);   // annulé entre-temps ou pris par un autre passage : null
    if (pris) aLancer.push(pris.id);
  }
  // 2. messages restés « en file » depuis 2 minutes à 24 heures (lancement perdu, autre diffusion plafonnée en cours)
  const relances = (await stock.annonces.enFile(new Date(t - 24 * 3600e3).toISOString(), new Date(t - 2 * 60e3).toISOString()))
    .map((a) => a.id).filter((id) => estUuid(id) && !aLancer.includes(id));
  const resultats = await Promise.all([...aLancer, ...relances].map(async (id) => [id, await lancer(id).catch(() => "injoignable")]));
  for (const [id, echec] of resultats) {
    if (echec) bilan.echecs++;
    else if (aLancer.includes(id)) bilan.lances++;
    else bilan.relances++;
  }
  journal({ evt: "push_programmes", ...bilan });
  return bilan;
}

// ── API de l'outil entrepôt (push-evenement.js) ──
// Signature : HMAC-SHA256(secret, `${horodatage}.${corps brut}`) en hexadécimal, en-tête « sha256=<hex> » ; horodatage en
// secondes, ±5 minutes. → { ok } | { ok: false, raison: "horodatage" | "signature" }
export const TOLERANCE_S = 300;
export function signer(secret, horodatage, corps) {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex")}`;
}
export function verifierSignature({ corps, horodatage, signature, secret, maintenant = Date.now(), toleranceS = TOLERANCE_S }) {
  const h = String(horodatage ?? "");
  if (!/^\d{9,11}$/.test(h) || Math.abs(maintenant / 1000 - Number(h)) > toleranceS) return { ok: false, raison: "horodatage" };
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(signature ?? "").trim());
  if (!m || !secret) return { ok: false, raison: "signature" };
  const attendu = crypto.createHmac("sha256", secret).update(`${h}.${corps}`).digest();
  const recu = Buffer.from(m[1], "hex");
  return recu.length === attendu.length && crypto.timingSafeEqual(attendu, recu) ? { ok: true } : { ok: false, raison: "signature" };
}

export const TYPES_EVENEMENT = { reclamation: "Réclamation", ticket: "Demande", commande: "Commande" };
// textes par défaut (titre ≤ 60, texte ≤ 160 avec une référence de 40 caractères), jamais de montant
const TEXTES_EVENEMENT = {
  reclamation: {
    recue: ["Réclamation reçue", (r) => `Nous avons bien reçu votre réclamation ${r}. Réponse sous 24 h ouvrées (du lundi au vendredi).`],
    en_cours: ["Réclamation en cours", (r) => `Votre réclamation ${r} est en cours de traitement par l'équipe Elixir.`],
    acceptee: ["Réclamation acceptée", (r) => `Votre réclamation ${r} est acceptée.`],
    refusee: ["Réponse à votre réclamation", (r) => `Votre réclamation ${r} a reçu une réponse de l'équipe Elixir.`],
    traitee: ["Réclamation traitée", (r) => `Votre réclamation ${r} est traitée.`],
    avoir_emis: ["Avoir émis", (r) => `Un avoir est émis pour votre réclamation ${r}.`],
    cloturee: ["Réclamation clôturée", (r) => `Votre réclamation ${r} est clôturée.`],
  },
  ticket: {
    recu: ["Demande reçue", (r) => `Nous avons bien reçu votre demande ${r}. Réponse sous 24 h ouvrées (du lundi au vendredi).`],
    en_cours: ["Demande en cours", (r) => `Votre demande ${r} est en cours de traitement par l'équipe Elixir.`],
    resolu: ["Demande traitée", (r) => `Votre demande ${r} est traitée.`],
    clos: ["Demande clôturée", (r) => `Votre demande ${r} est clôturée.`],
  },
  commande: {
    expediee: ["Commande expédiée", (r) => `Votre commande ${r} est sortie de l'entrepôt.`],
    reliquat: ["Reliquat sur votre commande", (r) => `Une partie de votre commande ${r} est en reliquat : elle partira dès réception du stock.`],
    annulee: ["Commande annulée", (r) => `Votre commande ${r} est annulée. Une question : 01 86 04 39 95.`],
  },
};
export const STATUTS_EVENEMENT = Object.fromEntries(Object.entries(TEXTES_EVENEMENT).map(([t, s]) => [t, Object.keys(s)]));
export const RE_CLE_IDEMPOTENCE = /^[A-Za-z0-9_.:-]{8,128}$/;
const RE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9/_. -]{0,39}$/;

// Corps reçu → { ok, erreurs, evenement: { cip, type, statut, reference, titre, corps, url } }
export function verifierEvenement(b = {}) {
  const erreurs = [];
  if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, erreurs: ["corps JSON attendu"], evenement: null };
  const cip = cipPropre(b.cip);
  if (!cip) erreurs.push("cip : 7 à 14 chiffres");
  const type = TYPES_EVENEMENT[b.type] ? b.type : null;
  if (!type) erreurs.push("type : reclamation, ticket ou commande");
  const statut = /^[a-z_]{1,30}$/.test(String(b.statut ?? "")) ? String(b.statut) : null;
  if (!statut) erreurs.push("statut : minuscules et _ (30 caractères au plus)");
  const reference = RE_REFERENCE.test(String(b.reference ?? "").trim()) ? String(b.reference).trim() : null;
  if (!reference) erreurs.push("reference : 1 à 40 caractères (lettres, chiffres, - _ / . espace)");
  const defaut = type && statut ? TEXTES_EVENEMENT[type][statut] : null;
  const titre = b.titre == null || b.titre === "" ? (defaut ? defaut[0] : null) : texteNet(b.titre);
  const corps = b.corps == null || b.corps === "" ? (defaut && reference ? defaut[1](reference) : null) : texteNet(b.corps);
  if (!titre || !corps) { if (type && statut && !defaut) erreurs.push(`statut « ${statut} » sans texte par défaut : fournir titre et corps (statuts connus : ${STATUTS_EVENEMENT[type].join(", ")})`); }
  else {
    if (longueur(titre) > LIMITES.titre) erreurs.push(`titre : ${LIMITES.titre} caractères au plus`);
    if (longueur(corps) > LIMITES.corps) erreurs.push(`corps : ${LIMITES.corps} caractères au plus`);
    if (contientMontant(`${titre} ${corps}`)) erreurs.push("aucun montant (écran verrouillé)");
  }
  const url = b.url == null || b.url === "" ? "/?commandes=1" : lienValide(b.url);
  if (!url) erreurs.push("url : chemin du site (/, /?commandes=1, /?cip=…, /?menu=…, /?outil=…)");
  return { ok: !erreurs.length, erreurs, evenement: { cip, type, statut, reference, titre, corps, url } };
}
// une même référence garde la même étiquette (le nouveau statut remplace l'ancien sur l'appareil) ; empreinte à clé : la
// référence n'est jamais lisible par le service push (en-tête Topic en clair)
export const etiquetteEvenement = (type, reference, cle) => `evt-${crypto.createHmac("sha256", String(cle || "elixir")).update(`${type}|${reference}`).digest("base64url").slice(0, 16)}`;
// un même statut d'une même référence pour une même pharmacie n'est notifié qu'une fois (clé d'idempotence différente comprise)
export const empreinteEvenement = (e) => sha(`${e.cip}|${e.type}|${e.reference}|${e.statut}`);
export const typeMessageDeEvenement = (type) => (type === "commande" ? "commande" : "reclamation");
