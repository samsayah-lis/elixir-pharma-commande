// ── Assistant Elixir : demandes de retour et transmissions à un conseiller (conception § 1.5, 2.8, 2.9) ──
// Retour : l'outil preparer_demande_retour (lot 1, _chat-outils.js) enregistre un BROUILLON valable 30 min ; rien ne
// part sans le clic « Confirmer la demande » (chat.js, action « confirmer », sans le modèle). À la confirmation :
// identité revérifiée par chat.js, brouillon relu au filtre de la fiche, expiration, recontrôle Odoo (revaliderRetour),
// passage brouillon → confirmée conditionnel (deux clics = une seule demande), puis un seul envoi selon les réglages :
//  - « simulation » (pilote) : e-mail à l'équipe préfixé [SIMULATION], rien vers l'outil entrepôt ni vers la pharmacie ;
//  - « email » : e-mail à l'équipe + récapitulatif aux adresses du compte de la pharmacie ;
//  - « entrepot » : POST signé HMAC-SHA256 vers entrepot_url (clé d'idempotence = id de la demande) ; adresse vide,
//    secret absent ou échec → e-mail à l'équipe (rien ne se perd), demande en « échec » visible dans l'admin.
// Envoi borné (outil entrepôt 4 s, e-mails 4 s, et au plus jusqu'à l'échéance de la requête) : une fonction coupée
// entre « confirmée » et l'envoi laisse une demande confirmée sans cible, reprise au clic suivant (après 20 s) ou par
// relancerEnvois (après chaque tour et chaque nuit, après 5 min) ; la clé d'idempotence reste l'id de la demande.
// Transmission : demandée explicitement par la pharmacie, donc sans carte de confirmation, mais bornée : une
// transmission ouverte par conversation ET par catégorie (une alerte qualité n'est jamais rattachée à une demande d'une
// autre catégorie) ; une nouvelle précision de même catégorie part en « complément » (e-mail « Complément à T-… ») ;
// un nombre de transmissions par 24 h et par fiche.
// Destinataires : adresses du compte de la fiche (ctx.comptes) et adresses des réglages, JAMAIS une adresse écrite
// dans la conversation. Tout texte libre est échappé, et ses adresses web neutralisées. Journal sans contenu.
import crypto from "node:crypto";
import { sendMail, ADMIN_MAIL } from "./_gp-mail.js";
import { lireReglages, emailValide, erreurPublique, journalJson, jourParis, dateFrParis, neutraliserLiens } from "./_chat-config.js";

export const BROUILLON_MIN = 30;
export const MOTIFS = {
  produit_manquant: "Produit manquant", reliquat: "Reliquat", erreur_produit: "Erreur de produit", quantite_incorrecte: "Quantité incorrecte",
  produit_casse: "Produit cassé", caisse_manquante: "Caisse manquante", mauvaise_caisse: "Mauvaise caisse", commande_non_recue: "Commande non reçue",
  mauvaise_commande_recue: "Mauvaise commande reçue", retour_erreur_pharmacie: "Erreur de commande de la pharmacie", dlu_courte: "Péremption courte",
  ecart_facture: "Écart de facturation", autre: "Autre",
};
export const SOUHAITS = {
  renvoi: "Renvoi du produit", avoir: "Avoir", garde: "Garde le produit", reprise: "Reprise", remise: "Remise",
  recevoir_reliquat: "Recevoir le reliquat", annule_reliquat: "Annuler le reliquat", non_precise: "Non précisé",
};
export const CATEGORIES = {
  documents: "Documents", commande: "Commande", livraison: "Livraison", qualite: "Qualité pharmaceutique", reglement: "Règlement",
  compte: "Compte", tarifs: "Tarifs", disponibilite: "Disponibilité", referencement: "Référencement", autre: "Autre",
};
export const RAPPELS = { email: "par e-mail", telephone: "par téléphone", indifferent: "indifférent" };
const ENREGISTREES = new Set(["confirmee", "transmise", "echec", "traitee", "rejetee"]);
const OUVERTES = ["confirmee", "transmise", "echec"];
const MAX_COMPLEMENTS = 5;                    // compléments par transmission (chacun envoie un e-mail)
const REPRISE_CLIC_MS = 20_000, REPRISE_AUTO_MS = 5 * 60e3;   // envoi interrompu : repris au clic, ou automatiquement
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_URL = "https://elixir-commande.expepharma.com/#admin";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const texte = (v, max) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, max) || null);
const jourFr = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || "")) ? String(d).slice(0, 10).split("-").reverse().join("/") : (d ? String(d) : "–");
// « pharmacie@exemple.fr » → « ph…@…fr »
export function masquerEmail(e) {
  const [local, domaine] = String(e || "").split("@");
  if (!local || !domaine) return null;
  return `${local.slice(0, 2)}…@…${domaine.split(".").pop()}`;
}
// adresses de compte de la fiche, seules destinataires côté pharmacie
const comptesDe = (ctx) => [...new Set((Array.isArray(ctx?.comptes) ? ctx.comptes : []).map(e => String(e || "").trim().toLowerCase()).filter(emailValide))].slice(0, 5);

// Brouillon de retour (forme du contrat), champs bornés
export function nettoyerBrouillon(b = {}) {
  const doc = b.document && typeof b.document === "object" ? b.document : {};
  return {
    reference_document: texte(b.reference_document, 60),
    document: { numero: texte(doc.numero, 60), date_sortie: texte(doc.date_sortie, 10), picking_id: Number.isInteger(doc.picking_id) ? doc.picking_id : null,
      picking_ids: (Array.isArray(doc.picking_ids) ? doc.picking_ids : []).filter(Number.isInteger).slice(0, 20),
      facture_ids: (Array.isArray(doc.facture_ids) ? doc.facture_ids : []).filter(Number.isInteger).slice(0, 10) },
    lignes: (Array.isArray(b.lignes) ? b.lignes : []).slice(0, 30).map(l => ({
      produit: texte(l?.produit, 120), cip: texte(l?.cip, 20), product_id: Number.isInteger(l?.product_id) ? l.product_id : null,
      lot: texte(l?.lot, 40), lot_id: Number.isInteger(l?.lot_id) ? l.lot_id : null, peremption: texte(l?.peremption, 10),
      quantite: Number.isInteger(l?.quantite) ? l.quantite : 0, quantite_max: Number.isInteger(l?.quantite_max) ? l.quantite_max : null,
    })),
    motif: MOTIFS[b.motif] ? b.motif : "autre",
    souhait: SOUHAITS[b.souhait] ? b.souhait : "non_precise",
    commentaire: b.commentaire == null ? null : neutraliserLiens(String(b.commentaire).trim().slice(0, 1000)) || null,
    hors_delai: !!b.hors_delai,
    limite_retour: texte(b.limite_retour, 10),
  };
}

// ── E-mails (HTML échappé) ──
const STYLE = "font-family:Arial,Helvetica,sans-serif;color:#1c2b33;max-width:720px";
const TH = "text-align:left;padding:6px 8px;border-bottom:2px solid #cfd8dc;font-size:12px;color:#455a64";
const TD = "padding:6px 8px;border-bottom:1px solid #eceff1;font-size:13px";
const tableLignes = (lignes) => `<table style="border-collapse:collapse;width:100%;margin:10px 0">
<thead><tr><th style="${TH}">Produit</th><th style="${TH}">CIP13</th><th style="${TH}">Lot</th><th style="${TH}">Péremption</th><th style="${TH};text-align:right">Quantité</th></tr></thead>
<tbody>${lignes.map(l => `<tr><td style="${TD}">${esc(l.produit)}</td><td style="${TD}">${esc(l.cip || "–")}</td><td style="${TD}">${esc(l.lot || "–")}</td><td style="${TD}">${esc(jourFr(l.peremption))}</td><td style="${TD};text-align:right">${esc(l.quantite)}</td></tr>`).join("")}</tbody></table>`;
const fiche = (ctx) => `${esc(ctx.nom || "Pharmacie")} (fiche Odoo n° ${esc(ctx.odooId)}${ctx.cip ? `, CIP ${esc(ctx.cip)}` : ""})`;
const coordonnees = (r) => `${esc(r.telephone)} (${esc(r.horaires)})`;

// Envoi à l'outil entrepôt en échec. Délai dépassé : la fiche a pu être créée sans que la réponse arrive — l'équipe vérifie
// d'abord dans l'outil entrepôt (un renvoi avec la même clé d'idempotence ne crée jamais de doublon côté entrepôt).
const avisEchec = (echec, action) => !echec ? "" : /délai dépassé/.test(echec)
  ? `<p><b>L'outil entrepôt n'a pas répondu à temps</b> : la demande y est peut-être déjà enregistrée. Vérifiez d'abord dans Réclamations ou Tickets (fiche « Assistant Elixir » de cette pharmacie) avant de ${action === "saisir" ? "la saisir à la main" : "la prendre en charge à partir de cet e-mail"}.</p>`
  : `<p><b>Envoi à l'outil entrepôt impossible</b> (${esc(echec)}) : ${action === "saisir" ? "saisissez cette demande à la main" : "prenez cette demande en charge à partir de cet e-mail"}.</p>`;
const REPRISE = "<p><b>Envoi repris automatiquement</b> après une interruption : la pharmacie n'a peut-être pas reçu de récapitulatif par e-mail.</p>";
function mailEquipeRetour({ d, b, ctx, simulation, echec, maintenant, reprise = false }) {
  return {
    subject: `${simulation ? "[SIMULATION] " : ""}Demande de retour ${d.numero} — ${String(ctx.nom || "pharmacie").slice(0, 80)}`,
    html: `<div style="${STYLE}">
${reprise ? REPRISE : ""}
${simulation ? "<p><b>Mode simulation (pilote)</b> : rien n'a été créé dans l'outil entrepôt. Traitez cette demande à la main.</p>" : ""}
${avisEchec(echec, "saisir")}
<p>Demande de retour <b>${esc(d.numero)}</b> confirmée par la pharmacie le ${esc(dateFrParis(maintenant))} dans l'Assistant Elixir${ctx.admin ? ` (saisie Elixir par ${esc(ctx.admin)})` : ""}.</p>
<p>Pharmacie : ${fiche(ctx)}<br>
Document : ${esc(b.document.numero || b.reference_document || "–")}${b.document.date_sortie ? `, sorti de l'entrepôt le ${esc(jourFr(b.document.date_sortie))}` : ""}<br>
Motif : ${esc(MOTIFS[b.motif])}<br>Souhait : ${esc(SOUHAITS[b.souhait])}${b.hors_delai ? "<br><b>Au-delà de 10 jours après la livraison</b> : décision du Pharmacien Responsable." : ""}</p>
${tableLignes(b.lignes)}
${b.commentaire ? `<p>Commentaire (rédigé par l'assistant à partir des messages de la pharmacie) :<br>${esc(b.commentaire).replace(/\n/g, "<br>")}</p>` : ""}
<p style="font-size:12px;color:#546e7a">Demande et conversation : admin du site de commande, onglet « Assistant » (${esc(ADMIN_URL)}).</p></div>`,
  };
}
function mailPharmacieRetour({ d, b, r, maintenant }) {
  return {
    subject: `Votre demande de retour ${d.numero} est enregistrée`,
    html: `<div style="${STYLE}"><p>Bonjour,</p>
<p>Votre demande de retour <b>${esc(d.numero)}</b> a bien été enregistrée le ${esc(dateFrParis(maintenant))}. ${esc(r.delai_annonce)}</p>
<p>Merci d'attendre l'accord d'Elixir Pharma avant tout renvoi de produit. Les retours sont acceptés sans abattement après accord du Pharmacien Responsable.</p>
<p>Document : ${esc(b.document.numero || b.reference_document || "–")} · Motif : ${esc(MOTIFS[b.motif])} · Souhait : ${esc(SOUHAITS[b.souhait])}</p>
${tableLignes(b.lignes)}
<p>Pour toute question : ${coordonnees(r)}.</p><p>L'équipe Elixir Pharma</p></div>`,
  };
}
const prefixeTransmission = (t) => (t.categorie === "qualite" ? "URGENT – Qualité – " : t.urgence === "urgente" ? "URGENT – " : "");
function mailEquipeTransmission({ d, t, ctx, simulation, echec, maintenant, reprise = false }) {
  return {
    subject: `${simulation ? "[SIMULATION] " : ""}${prefixeTransmission(t)}${t.categorie === "reglement" ? "[Règlement] " : ""}Transmission ${d.numero} — ${CATEGORIES[t.categorie] || CATEGORIES.autre} — ${String(ctx.nom || "pharmacie").slice(0, 80)}`,
    html: `<div style="${STYLE}">
${reprise ? REPRISE : ""}
${avisEchec(echec, "prendre")}
<p>Demande transmise par l'Assistant Elixir le ${esc(dateFrParis(maintenant))}${ctx.admin ? ` (saisie Elixir par ${esc(ctx.admin)})` : ""} : n° <b>${esc(d.numero)}</b>.</p>
<p>Pharmacie : ${fiche(ctx)}<br>Catégorie : ${esc(CATEGORIES[t.categorie] || CATEGORIES.autre)}<br>Urgence : ${t.urgence === "urgente" ? "<b>urgente</b>" : "normale"}<br>
Référence citée : ${esc(t.reference || "–")}<br>Préférence de réponse : ${esc(RAPPELS[t.rappel])}</p>
<p>Résumé (rédigé par l'assistant) :<br>${esc(t.resume || "–").replace(/\n/g, "<br>")}</p>
<p style="font-size:12px;color:#546e7a">Conversation complète : admin du site de commande, onglet « Assistant » (${esc(ADMIN_URL)}). Coordonnées de la pharmacie : fiche Odoo.</p></div>`,
  };
}
// nouvelle précision de la pharmacie sur une transmission déjà ouverte (même conversation, même catégorie)
function mailEquipeComplement({ d, t, ctx, simulation, maintenant, entrepot }) {
  return {
    subject: `${simulation ? "[SIMULATION] " : ""}${prefixeTransmission(t)}Complément à la transmission ${d.numero} — ${CATEGORIES[t.categorie] || CATEGORIES.autre} — ${String(ctx.nom || "pharmacie").slice(0, 80)}`,
    html: `<div style="${STYLE}">
<p>Nouvelle précision de la pharmacie le ${esc(dateFrParis(maintenant))}${ctx.admin ? ` (saisie Elixir par ${esc(ctx.admin)})` : ""}, à joindre à la demande n° <b>${esc(d.numero)}</b>${entrepot ? ` (outil entrepôt : ${esc(entrepot)})` : ""}.</p>
<p>Pharmacie : ${fiche(ctx)}<br>Urgence : ${t.urgence === "urgente" ? "<b>urgente</b>" : "normale"}<br>Référence citée : ${esc(t.reference || "–")}</p>
<p>Complément (rédigé par l'assistant) :<br>${esc(t.resume || "–").replace(/\n/g, "<br>")}</p>
<p style="font-size:12px;color:#546e7a">Conversation complète : admin du site de commande, onglet « Assistant » (${esc(ADMIN_URL)}).</p></div>`,
  };
}
function mailPharmacieTransmission({ d, t, r }) {
  return {
    subject: `Votre demande est transmise à l'équipe Elixir (n° ${d.numero})`,
    html: `<div style="${STYLE}"><p>Bonjour,</p>
<p>Votre demande a été transmise à l'équipe Elixir Pharma sous le n° <b>${esc(d.numero)}</b>. ${esc(r.delai_annonce)}</p>
<p>Résumé transmis :<br>${esc(t.resume || "–").replace(/\n/g, "<br>")}</p>
<p>Pour une urgence : ${coordonnees(r)}.</p><p>L'équipe Elixir Pharma</p></div>`,
  };
}

// deps : { stock, reglages?, conversationId?, envoyerMail?, fetch?, secret?, maintenant?, journal?, revaliderRetour?, perimetre?,
//   delaiEntrepotMs? (4 000), delaiMailMs? (4 000), echeance? (heure réelle, en ms, à ne pas dépasser : requête synchrone) }
// conversationId : conversation du tour en cours (la demande y est rattachée) ; perimetre : deps passées à revaliderRetour
export function creerDemandes(deps = {}) {
  const stock = deps.stock;
  if (!stock) throw new Error("creerDemandes : stock manquant");
  const maintenant = deps.maintenant || (() => new Date());
  // délai d'un appel extérieur : son défaut, et jamais au-delà de l'échéance de la requête (plafond de 10 s d'une fonction)
  const delai = (defaut) => Math.max(1000, Math.min(defaut, deps.echeance ? deps.echeance - Date.now() - 300 : defaut));
  const envoi = deps.envoyerMail || sendMail;
  // e-mail borné : passé le délai, compté comme non envoyé (l'erreur est notée sur la demande, visible dans l'admin)
  const envoyerMail = (m) => new Promise((ok) => {
    const t = setTimeout(() => ok({ sent: false, reason: "délai dépassé" }), delai(deps.delaiMailMs ?? 4000));
    Promise.resolve().then(() => envoi(m)).then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); ok({ sent: false, reason: String(e?.message || e).slice(0, 80) }); });
  });
  const http = deps.fetch || ((...a) => fetch(...a));
  const secret = deps.secret !== undefined ? deps.secret : process.env.CHATBOT_INTAKE_SECRET;
  const journal = deps.journal || journalJson;
  const reglages = () => deps.reglages ? Promise.resolve(deps.reglages) : lireReglages({ stock, maintenant });
  const iso = () => maintenant().toISOString();
  const il24h = () => new Date(maintenant().getTime() - 86400e3).toISOString();
  const revalider = async (ctx, brouillon) => {
    const f = deps.revaliderRetour || (await import("./_chat-perimetre.js")).revaliderRetour;
    return f(ctx, brouillon, deps.perimetre || {});
  };

  // POST signé vers l'API « chatbot-intake » de l'outil entrepôt → { ok, reference } | { ok: false, raison }
  async function versEntrepot(r, charge, cle) {
    if (!r.entrepot_url) return { ok: false, raison: "adresse de l'outil entrepôt non renseignée" };
    if (!secret) return { ok: false, raison: "CHATBOT_INTAKE_SECRET absent des variables Netlify" };
    const corps = JSON.stringify(charge);
    const horodatage = String(Math.floor(maintenant().getTime() / 1000));
    const signature = crypto.createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex");
    try {
      const res = await http(r.entrepot_url, {
        method: "POST", body: corps, signal: AbortSignal.timeout(delai(deps.delaiEntrepotMs ?? 4000)),
        headers: { "Content-Type": "application/json", "X-Elixir-Horodatage": horodatage, "X-Elixir-Signature": `sha256=${signature}`, "Idempotency-Key": cle },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, raison: `outil entrepôt : HTTP ${res.status}` };
      // une fonction absente de l'outil entrepôt répond 200 avec la page du site (HTML) : seule une vraie référence
      // EN-601-… (réclamation) ou TK-… (ticket) vaut réception
      const reference = String(j?.reference || "");
      if (!/^(EN-601|TK)-\d{4}-\d+$/.test(reference)) return { ok: false, raison: "outil entrepôt : réponse inattendue (aucune référence EN-601 ou TK)" };
      return { ok: true, reference };
    } catch (e) {
      return { ok: false, raison: e?.name === "TimeoutError" ? "outil entrepôt : délai dépassé" : "outil entrepôt injoignable" };
    }
  }
  const charge = (type, d, ctx, contenu) => ({
    source: "chatbot", type, demande_id: d.id, numero: d.numero, partner_id: Number(ctx.odooId), cip: ctx.cip || null, pharmacie: ctx.nom || null,
    saisie_elixir: ctx.admin || null, conversation_id: d.conversation_id || null, cree_le: d.created_at || iso(), [type]: contenu,
  });

  // Envoi d'une demande déjà passée en « confirmée » (une seule fois) → { statut, cible_ref, erreur, destinataires }
  async function envoyer(type, d, ctx, r, { mailEquipe, mailPharmacie, prevenir, contenu, reprise = false }) {
    const simulation = r.demandes === "simulation";
    let statut = "confirmee", cible_ref = null, erreur = null;
    if (r.demandes === "entrepot") {
      const e = await versEntrepot(r, charge(type, d, ctx, contenu), d.id);
      if (e.ok) { statut = "transmise"; cible_ref = e.reference; } else { statut = "echec"; erreur = e.raison; }
    }
    if (r.demandes !== "entrepot" || statut === "echec") {
      const m = mailEquipe({ simulation, echec: r.demandes === "entrepot" ? erreur : null });
      const s = await envoyerMail({ to: m.to, subject: m.subject, html: m.html });
      if (!s?.sent) erreur = [erreur, `e-mail à l'équipe non envoyé (${String(s?.reason || "raison inconnue").slice(0, 120)})`].filter(Boolean).join(" ; ");
      cible_ref = cible_ref || (simulation ? "simulation" : "email");
    }
    let destinataires = [];
    if (!simulation && prevenir && mailPharmacie) {
      destinataires = comptesDe(ctx);
      if (destinataires.length) {
        const m = mailPharmacie();
        const s = await envoyerMail({ to: destinataires, subject: m.subject, html: m.html, replyTo: r.email_equipe });
        if (!s?.sent) { erreur = [erreur, "récapitulatif à la pharmacie non envoyé"].filter(Boolean).join(" ; "); destinataires = []; }
      }
    }
    await stock.demandes.passer(d.id, "confirmee", statut, { cible_ref, erreur, ...(statut === "transmise" ? { transmise_at: iso() } : {}) });
    journal({ evt: "demande", type, code: statut, mode: r.demandes, demande: d.id, ...(reprise ? { reprise: true } : {}) });
    return { statut, cible_ref, erreur, destinataires };
  }

  // Événement pour le modèle (dit après le prochain message de la pharmacie) + carte gardée dans l'affichage
  async function noter(d, ctx, evenement, message) {
    if (!d.conversation_id) return;
    await stock.conversations.modifier(d.conversation_id, ctx.odooId, (c) => ({
      ...(evenement ? { evenements_en_attente: JSON.stringify([...(Array.isArray(c.evenements) ? c.evenements : []), evenement].slice(-10)) } : {}),
      ...(message ? { affichage: JSON.stringify([...c.affichage, message]) } : {}),
    })).catch(e => journal({ evt: "demande", code: "conversation_non_notee", demande: d.id, erreur: String(e?.message || e).slice(0, 80) }));
  }
  const messageAffiche = (id, texteMsg, ui_actions = []) => ({ id, role: "assistant", texte: texteMsg, ui_actions, at: iso() });
  // envoyes : adresses qui viennent de recevoir le récapitulatif ; à la relecture (double clic), l'adresse n'est indiquée que
  // si l'envoi a eu lieu (cible connue) sans échec du récapitulatif, et jamais en saisie Elixir (case « Prévenir » inconnue)
  const carteEnregistree = (d, r, ctx, envoyes = null) => {
    const simulation = d.cible_ref === "simulation";
    const recu = envoyes ? envoyes[0] : !ctx.admin && d.cible_ref && !simulation && !/récapitulatif/.test(String(d.erreur || "")) ? comptesDe(ctx)[0] : null;
    return { type: "demande_enregistree", numero: d.numero, date: jourParis(d.confirmee_at || maintenant()), delai: r.delai_annonce,
      email_masque: recu ? masquerEmail(recu) : null, simulation };
  };
  // envoi interrompu : confirmée sans cible depuis un moment (la fonction a été coupée avant la fin de l'envoi)
  const interrompu = (d, ms) => d.statut === "confirmee" && !d.cible_ref && Date.parse(d.updated_at || d.confirmee_at) < maintenant().getTime() - ms;
  const texteEnregistre = (d) => `Votre demande de retour ${d.numero} est enregistrée. Merci d'attendre l'accord d'Elixir avant tout renvoi de produit.`;

  // ── Brouillon (appelé par l'outil preparer_demande_retour) ──
  async function creerBrouillon(ctx, brouillon) {
    const conversationId = deps.conversationId;
    if (!UUID.test(String(conversationId || ""))) throw new Error("brouillon de retour hors conversation");
    const r = await reglages();
    if (await stock.compter.demandes(ctx.odooId, "retour", il24h()) >= Math.max(1, r.quotas.retours_jour) * 3) {
      throw erreurPublique("Beaucoup de demandes de retour ont été préparées aujourd'hui pour cette pharmacie : proposez la transmission à un conseiller.", "quota");
    }
    // un seul récapitulatif à confirmer par conversation : le précédent est remplacé (son bouton ne fait plus rien)
    for (const p of await stock.demandes.lister({ conversation_id: conversationId, type: "retour", statut: "brouillon", limite: 20 })) {
      if (Number(p.odoo_id) === Number(ctx.odooId)) await stock.demandes.passer(p.id, "brouillon", "annulee", { erreur: "remplacé par un nouveau récapitulatif" });
    }
    const expire_at = new Date(maintenant().getTime() + BROUILLON_MIN * 60e3).toISOString();
    const d = await stock.demandes.creer({ type: "retour", statut: "brouillon", conversation_id: conversationId, odoo_id: ctx.odooId,
      pharmacie: ctx.nom, admin_email: ctx.admin || null, brouillon: nettoyerBrouillon(brouillon), expire_at });
    journal({ evt: "demande", type: "retour", code: "brouillon", demande: d.id });
    return { demande_id: d.id, expire_at, numero: d.numero };
  }

  // ── Confirmation ou annulation par la pharmacie (clic, sans le modèle) ──
  // → { http: 200, message } | { http: 404|410|429|503, error, message? }
  async function confirmer(ctx, { demande_id, decision, conversation_id = null, prevenir = true } = {}) {
    if (decision !== "confirmer" && decision !== "annuler") return { http: 400, error: "decision" };
    const d = await stock.demandes.lire(demande_id, ctx.odooId);   // filtre de la fiche : une autre pharmacie = introuvable
    if (!d || d.type !== "retour" || (conversation_id && d.conversation_id !== conversation_id)) return { http: 404, error: "introuvable" };
    const r = await reglages();

    if (decision === "annuler") {
      if (d.statut === "brouillon") {
        const a = await stock.demandes.passer(d.id, "brouillon", "annulee", { erreur: "annulée par la pharmacie" });
        if (a) {
          const message = messageAffiche(`d-${d.id}`, "Demande annulée : rien n'a été envoyé.");
          await noter(d, ctx, "La pharmacie a annulé le récapitulatif de retour : aucune demande n'a été envoyée.", message);
          return { http: 200, message };
        }
      }
      const d2 = await stock.demandes.lire(d.id, ctx.odooId);
      if (d2 && ENREGISTREES.has(d2.statut)) return { http: 200, message: messageAffiche(`d-${d.id}`, `Cette demande est déjà enregistrée (${d2.numero}) : pour la modifier, demandez une transmission à un conseiller.`, [carteEnregistree(d2, r, ctx)]) };
      return { http: 200, message: messageAffiche(`d-${d.id}`, "Demande annulée : rien n'a été envoyé.") };
    }

    // double clic, onglet rejoué : même réponse, aucun nouvel envoi ; envoi interrompu (fonction coupée) : repris ici
    if (ENREGISTREES.has(d.statut)) {
      if (interrompu(d, REPRISE_CLIC_MS)) {
        const c = await stock.demandes.reprendre(d.id, d.updated_at);
        if (c) return envoyerRetour(c, nettoyerBrouillon(c.brouillon), ctx, r, prevenir, true);
      }
      return { http: 200, message: messageAffiche(`d-${d.id}`, texteEnregistre(d), [carteEnregistree(d, r, ctx)]) };
    }
    if (d.statut !== "brouillon") return { http: 410, error: "expiree" };
    if (!(Date.parse(d.expire_at) > maintenant().getTime())) {
      await stock.demandes.passer(d.id, "brouillon", "expiree");
      return { http: 410, error: "expiree" };
    }
    const confirmees = await stock.compter.demandes(ctx.odooId, "retour", il24h(), [...ENREGISTREES]);
    if (confirmees >= r.quotas.retours_jour) {
      return { http: 429, error: "quota", message: `Vous avez déjà confirmé ${confirmees} demandes de retour en 24 heures. Pour une autre demande, appelez le service client au ${r.telephone} (${r.horaires}).` };
    }
    // recontrôle dans Odoo : document de la fiche, lots, quantité ≤ livrée − déjà retournée
    let v;
    try { v = await revalider(ctx, d.brouillon); } catch (e) {
      journal({ evt: "demande", type: "retour", code: "revalidation_impossible", demande: d.id, erreur: String(e?.message || e).slice(0, 80) });
      return { http: 503, error: "indisponible", message: "La vérification de votre demande est impossible pour le moment : réessayez dans quelques minutes." };
    }
    if (!v?.ok && v?.temporaire) {   // Odoo injoignable : rien n'est refusé, la pharmacie réessaiera
      return { http: 503, error: "indisponible", message: String(v.raison || "La vérification de votre demande est impossible pour le moment : réessayez dans quelques minutes.").slice(0, 300) };
    }
    if (!v?.ok) {
      const raison = String(v?.raison || "Cette demande ne correspond plus à votre livraison.").slice(0, 300);
      if (await stock.demandes.passer(d.id, "brouillon", "annulee", { erreur: raison })) {
        // la raison (libellés d'Odoo compris) reste dans la carte ; l'événement dit au modèle n'est fait que de texte fixe
        const message = messageAffiche(`d-${d.id}`, "Demande non enregistrée : rien n'a été envoyé.", [{ type: "erreur", texte: raison }]);
        await noter(d, ctx, `La demande de retour ${d.numero} n'a pas été enregistrée après recontrôle (quantité, lot ou document modifié). Rien n'a été envoyé.`, message);
        return { http: 200, message };
      }
      return { http: 410, error: "expiree" };
    }
    const b = nettoyerBrouillon(v.brouillon || d.brouillon);
    const conf = await stock.demandes.passer(d.id, "brouillon", "confirmee", { brouillon: b, confirmee_at: iso() });
    if (!conf) {   // clic simultané (déjà confirmée) ou expiration entre-temps
      const d2 = await stock.demandes.lire(d.id, ctx.odooId);
      if (d2 && ENREGISTREES.has(d2.statut)) return { http: 200, message: messageAffiche(`d-${d.id}`, texteEnregistre(d2), [carteEnregistree(d2, r, ctx)]) };
      return { http: 410, error: "expiree" };
    }
    return envoyerRetour(conf, b, ctx, r, prevenir);
  }
  // envoi d'un retour passé en « confirmée » (ou repris), puis carte « Demande enregistrée » et événement pour le modèle
  async function envoyerRetour(conf, b, ctx, r, prevenir, reprise = false) {
    const prevenirPharmacie = !ctx.admin || prevenir !== false;
    const t = maintenant();
    const envoi = await envoyer("retour", conf, ctx, r, {
      prevenir: prevenirPharmacie, contenu: b, reprise,
      mailEquipe: ({ simulation, echec }) => ({ to: [r.email_equipe], ...mailEquipeRetour({ d: conf, b, ctx, simulation, echec, maintenant: t }) }),
      mailPharmacie: () => mailPharmacieRetour({ d: conf, b, r, maintenant: t }),
    });
    const fin = { ...conf, cible_ref: envoi.cible_ref, statut: envoi.statut };
    const message = messageAffiche(`d-${conf.id}`, texteEnregistre(fin), [carteEnregistree(fin, r, ctx, envoi.destinataires)]);
    await noter(conf, ctx, `Demande de retour ${conf.numero} enregistrée le ${dateFrParis(t)} après confirmation de la pharmacie. Délai annoncé : ${r.delai_annonce}`, message);
    return { http: 200, message };
  }

  // ── Transmission à un conseiller (outil transmettre_a_un_conseiller) → { numero, delai, telephone, horaires,
  //    deja_transmise?, complement?, complement_envoye? } ──
  const categorieDe = (d) => d.categorie || d.brouillon?.categorie || "autre";
  const pareil = (a, b) => String(a || "").replace(/\s+/g, " ").trim().toLowerCase() === String(b || "").replace(/\s+/g, " ").trim().toLowerCase();
  async function transmettre(ctx, entree = {}) {
    const r = await reglages();
    const conversationId = UUID.test(String(deps.conversationId || "")) ? deps.conversationId : (UUID.test(String(entree.conversation_id || "")) ? entree.conversation_id : null);
    const categorie = CATEGORIES[entree.categorie] ? entree.categorie : "autre";
    // textes rédigés par le modèle à partir des messages de la pharmacie : adresses web neutralisées (e-mails, entrepôt)
    const t = {
      categorie, urgence: entree.urgence === "urgente" || categorie === "qualite" ? "urgente" : "normale",
      rappel: RAPPELS[entree.rappel] ? entree.rappel : "indifferent", reference: texte(neutraliserLiens(entree.reference), 80),
      resume: neutraliserLiens(String(entree.resume || "").trim().slice(0, 1500)) || null,
    };
    const reponse = (d, extra = {}) => ({ numero: d.numero, delai: r.delai_annonce, telephone: r.telephone, horaires: r.horaires, ...extra });
    // transmission ouverte de la MÊME catégorie dans cette conversation (une demande qualité n'est jamais rattachée à une autre)
    const ouverte = async () => conversationId
      ? (await stock.demandes.lister({ conversation_id: conversationId, type: "transmission", statut: OUVERTES, limite: 20 }))
        .find(x => Number(x.odoo_id) === Number(ctx.odooId) && categorieDe(x) === categorie)
      : null;
    const deja = await ouverte();
    if (deja) { const c = await completer(deja, t, ctx, r); if (c) return reponse(deja, c); }
    // quota par 24 h ; la qualité pharmaceutique garde une marge (jamais bloquée par les autres demandes du jour)
    const faites = await stock.compter.demandes(ctx.odooId, "transmission", il24h());
    if (faites >= r.quotas.transmissions_jour + (categorie === "qualite" ? 3 : 0)) {
      throw erreurPublique(`Plusieurs demandes ont déjà été transmises aujourd'hui pour cette pharmacie. Pour une urgence : ${r.telephone} (${r.horaires}).`, "quota");
    }
    const d = await stock.demandes.creer({ type: "transmission", statut: "confirmee", categorie, conversation_id: conversationId, odoo_id: ctx.odooId,
      pharmacie: ctx.nom, admin_email: ctx.admin || null, brouillon: t, resume: t.resume, confirmee_at: iso() });
    if (d.doublon) {   // même catégorie créée en même temps (deux appels du même tour) : complément, ou rien de nouveau
      const autre = await ouverte();
      if (autre) return reponse(autre, (await completer(autre, t, ctx, r)) || { deja_transmise: true, complement: false });
      throw new Error("transmission en double");
    }
    await envoyerTransmission(d, t, ctx, r, { prevenir: t.rappel === "email" && (!ctx.admin || entree.prevenir !== false) });
    return reponse(d);
  }
  async function envoyerTransmission(d, t, ctx, r, { prevenir = false, reprise = false } = {}) {
    const now = maintenant();
    return envoyer("transmission", d, ctx, r, {
      prevenir, contenu: t, reprise,
      mailEquipe: ({ simulation, echec }) => ({ to: [t.categorie === "qualite" ? r.email_qualite : r.email_equipe], ...mailEquipeTransmission({ d, t, ctx, simulation, echec, maintenant: now, reprise }) }),
      mailPharmacie: () => mailPharmacieTransmission({ d, t, r }),
    });
  }
  // Nouvelle précision sur une transmission ouverte de même catégorie : ajoutée à la demande et envoyée à l'équipe
  // (« Complément à T-… » ; qualité : adresse qualité, « URGENT ») ; même texte qu'avant : rien n'est renvoyé.
  // → { deja_transmise, complement, complement_envoye? }, ou null si la demande vient d'être close (une nouvelle part)
  async function completer(d, t, ctx, r) {
    const b = d.brouillon && typeof d.brouillon === "object" ? d.brouillon : {};
    const complements = Array.isArray(b.complements) ? b.complements : [];
    if (!t.resume || [b.resume, d.resume, ...complements.map(c => c?.resume)].some(x => pareil(x, t.resume))) return { deja_transmise: true, complement: false };
    if (complements.length >= MAX_COMPLEMENTS) {
      throw erreurPublique(`Plusieurs précisions ont déjà été ajoutées à la demande n° ${d.numero}. Pour la suite : ${r.telephone} (${r.horaires}).`, "quota");
    }
    const urgence = t.urgence === "urgente" || b.urgence === "urgente" ? "urgente" : "normale";
    const now = maintenant();
    const maj = await stock.demandes.passer(d.id, d.statut, d.statut, {
      brouillon: { ...b, urgence, complements: [...complements, { at: iso(), resume: t.resume, reference: t.reference, urgence: t.urgence, rappel: t.rappel }] },
      resume: `${d.resume || b.resume || ""}\n\nComplément du ${dateFrParis(now)} : ${t.resume}`.slice(0, 2000),
    });
    if (!maj) return null;
    const tc = { ...t, categorie: categorieDe(d), urgence };
    const m = mailEquipeComplement({ d, t: tc, ctx, simulation: r.demandes === "simulation", maintenant: now, entrepot: r.demandes === "entrepot" ? d.cible_ref : null });
    const s = await envoyerMail({ to: [tc.categorie === "qualite" ? r.email_qualite : r.email_equipe], subject: m.subject, html: m.html });
    if (!s?.sent) {
      await stock.demandes.passer(d.id, maj.statut, maj.statut, { erreur: [maj.erreur, `complément non envoyé par e-mail (${String(s?.reason || "raison inconnue").slice(0, 80)})`].filter(Boolean).join(" ; ").slice(0, 500) }).catch(() => {});
    }
    journal({ evt: "demande", type: "transmission", code: "complement", envoye: !!s?.sent, demande: d.id });
    return { deja_transmise: true, complement: true, complement_envoye: !!s?.sent };
  }

  // ── Envois interrompus (fonction coupée entre « confirmée » et l'envoi) : repris après REPRISE_AUTO_MS, un seul
  // repreneur par demande. Identité relue de la demande (fiche, nom, admin) : l'équipe est prévenue, la pharmacie non
  // (ses adresses ne sont pas gardées avec la demande). → nombre de demandes reprises ──
  async function relancerEnvois({ limite = 10 } = {}) {
    const r = await reglages();
    const avant = new Date(maintenant().getTime() - REPRISE_AUTO_MS).toISOString();
    let n = 0;
    for (const d of await stock.demandes.lister({ statut: "confirmee", sans_cible: true, confirmee_avant: avant, limite })) {
      if (!interrompu(d, REPRISE_AUTO_MS)) continue;
      const c = await stock.demandes.reprendre(d.id, d.updated_at);
      if (!c) continue;
      const ctx = { odooId: c.odoo_id, nom: c.pharmacie, cip: null, comptes: [], admin: c.admin_email || null, mode: "complet" };
      const b = c.brouillon && typeof c.brouillon === "object" ? c.brouillon : {};
      if (c.type === "retour") {
        const br = nettoyerBrouillon(b), t = maintenant();
        await envoyer("retour", c, ctx, r, { prevenir: false, contenu: br, reprise: true,
          mailEquipe: ({ simulation, echec }) => ({ to: [r.email_equipe], ...mailEquipeRetour({ d: c, b: br, ctx, simulation, echec, maintenant: t, reprise: true }) }) });
      } else {
        await envoyerTransmission(c, { ...b, categorie: categorieDe(c) }, ctx, r, { reprise: true });
      }
      n++;
    }
    return n;
  }

  return { creerBrouillon, confirmer, transmettre, relancerEnvois };
}

// ── Surveillance (après chaque tour et chaque jour) : budget du jour à 80 % et 100 %, pannes répétées ──
// Une alerte par jour et par type (table chat_alertes), à GP_ADMIN_MAIL, sans aucun contenu de conversation.
export async function surveiller({ stock, reglages = null, envoyerMail = sendMail, maintenant = () => new Date(), journal = journalJson } = {}) {
  const r = reglages || await lireReglages({ stock, maintenant });
  const jour = jourParis(maintenant());
  const envoyees = [];
  const alerter = async (type, subject, html) => {
    if (!await stock.alertes.marquer(jour, type)) return;
    const s = await envoyerMail({ to: [ADMIN_MAIL], subject, html: `<div style="${STYLE}">${html}<p style="font-size:12px;color:#546e7a">Réglages et coûts : admin du site de commande, onglet « Assistant ».</p></div>` });
    if (s?.sent) { envoyees.push(type); journal({ evt: "alerte", type }); } else await stock.alertes.oublier(jour, type).catch(() => {});
  };
  if (r.budget_jour_eur > 0) {
    const cout = await stock.compter.coutJour(jour);
    const eur = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (cout >= r.budget_jour_eur) await alerter("budget_100", "Assistant Elixir : budget du jour atteint", `<p>Le coût du jour (${eur(cout)} €) atteint le budget de ${eur(r.budget_jour_eur)} € : l'assistant affiche « momentanément indisponible » jusqu'à demain.</p>`);
    else if (cout >= 0.8 * r.budget_jour_eur) await alerter("budget_80", "Assistant Elixir : 80 % du budget du jour", `<p>Le coût du jour atteint ${eur(cout)} €, soit au moins 80 % du budget de ${eur(r.budget_jour_eur)} €.</p>`);
  }
  const erreurs = await stock.compter.erreurs(new Date(maintenant().getTime() - 3600e3).toISOString());
  if (erreurs >= 5) await alerter("pannes", "Assistant Elixir : réponses en erreur", `<p>${erreurs} réponses en erreur sur la dernière heure (service d'IA, Odoo ou stockage). Journal des fonctions Netlify : chat-tour-background.</p>`);
  return envoyees;
}
