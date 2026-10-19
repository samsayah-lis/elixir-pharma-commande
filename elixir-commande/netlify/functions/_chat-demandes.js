// ── Assistant Elixir : demandes de retour et transmissions à un conseiller (conception § 1.5, 2.8, 2.9) ──
// Retour : l'outil preparer_demande_retour (lot 1, _chat-outils.js) enregistre un BROUILLON valable 30 min ; rien ne
// part sans le clic « Confirmer la demande » (chat.js, action « confirmer », sans le modèle). À la confirmation :
// identité revérifiée par chat.js, brouillon relu au filtre de la fiche, expiration, recontrôle Odoo (revaliderRetour),
// passage brouillon → confirmée conditionnel (deux clics = une seule demande), puis un seul envoi selon les réglages :
//  - « simulation » (pilote) : e-mail à l'équipe préfixé [SIMULATION], rien vers l'outil entrepôt ni vers la pharmacie ;
//  - « email » : e-mail à l'équipe + récapitulatif aux adresses du compte de la pharmacie ;
//  - « entrepot » : POST signé HMAC-SHA256 vers entrepot_url (clé d'idempotence = id de la demande) ; adresse vide,
//    secret absent ou échec → e-mail à l'équipe (rien ne se perd), demande en « échec » visible dans l'admin.
// Transmission : demandée explicitement par la pharmacie, donc sans carte de confirmation, mais bornée : une
// transmission ouverte par conversation (la même est renvoyée), un nombre par 24 h et par fiche.
// Destinataires : adresses du compte de la fiche (ctx.comptes) et adresses des réglages, JAMAIS une adresse écrite
// dans la conversation. Tout texte libre est échappé. Journal sans contenu.
import crypto from "node:crypto";
import { sendMail, ADMIN_MAIL } from "./_gp-mail.js";
import { lireReglages, emailValide, erreurPublique, journalJson, jourParis, dateFrParis } from "./_chat-config.js";

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
    commentaire: b.commentaire == null ? null : String(b.commentaire).trim().slice(0, 1000) || null,
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

function mailEquipeRetour({ d, b, ctx, simulation, echec, maintenant }) {
  return {
    subject: `${simulation ? "[SIMULATION] " : ""}Demande de retour ${d.numero} — ${String(ctx.nom || "pharmacie").slice(0, 80)}`,
    html: `<div style="${STYLE}">
${simulation ? "<p><b>Mode simulation (pilote)</b> : rien n'a été créé dans l'outil entrepôt. Traitez cette demande à la main.</p>" : ""}
${echec ? `<p><b>Envoi à l'outil entrepôt impossible</b> (${esc(echec)}) : saisissez cette demande à la main.</p>` : ""}
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
function mailEquipeTransmission({ d, t, ctx, simulation, echec, maintenant }) {
  const prefixe = t.categorie === "qualite" ? "URGENT – Qualité – " : t.urgence === "urgente" ? "URGENT – " : "";
  return {
    subject: `${simulation ? "[SIMULATION] " : ""}${prefixe}${t.categorie === "reglement" ? "[Règlement] " : ""}Transmission ${d.numero} — ${CATEGORIES[t.categorie]} — ${String(ctx.nom || "pharmacie").slice(0, 80)}`,
    html: `<div style="${STYLE}">
${echec ? `<p><b>Envoi à l'outil entrepôt impossible</b> (${esc(echec)}) : prenez cette demande en charge à partir de cet e-mail.</p>` : ""}
<p>Demande transmise par l'Assistant Elixir le ${esc(dateFrParis(maintenant))}${ctx.admin ? ` (saisie Elixir par ${esc(ctx.admin)})` : ""} : n° <b>${esc(d.numero)}</b>.</p>
<p>Pharmacie : ${fiche(ctx)}<br>Catégorie : ${esc(CATEGORIES[t.categorie])}<br>Urgence : ${t.urgence === "urgente" ? "<b>urgente</b>" : "normale"}<br>
Référence citée : ${esc(t.reference || "–")}<br>Préférence de réponse : ${esc(RAPPELS[t.rappel])}</p>
<p>Résumé (rédigé par l'assistant) :<br>${esc(t.resume || "–").replace(/\n/g, "<br>")}</p>
<p style="font-size:12px;color:#546e7a">Conversation complète : admin du site de commande, onglet « Assistant » (${esc(ADMIN_URL)}). Coordonnées de la pharmacie : fiche Odoo.</p></div>`,
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

// deps : { stock, reglages?, conversationId?, envoyerMail?, fetch?, secret?, maintenant?, journal?, revaliderRetour?, perimetre? }
// conversationId : conversation du tour en cours (la demande y est rattachée) ; perimetre : deps passées à revaliderRetour
export function creerDemandes(deps = {}) {
  const stock = deps.stock;
  if (!stock) throw new Error("creerDemandes : stock manquant");
  const maintenant = deps.maintenant || (() => new Date());
  const envoyerMail = deps.envoyerMail || sendMail;
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
        method: "POST", body: corps, signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json", "X-Elixir-Horodatage": horodatage, "X-Elixir-Signature": `sha256=${signature}`, "Idempotency-Key": cle },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, raison: `outil entrepôt : HTTP ${res.status}` };
      return { ok: true, reference: String(j?.reference || j?.numero_qualite || j?.ticket || "").slice(0, 60) || "entrepot" };
    } catch (e) {
      return { ok: false, raison: e?.name === "TimeoutError" ? "outil entrepôt : délai dépassé" : "outil entrepôt injoignable" };
    }
  }
  const charge = (type, d, ctx, contenu) => ({
    source: "chatbot", type, demande_id: d.id, numero: d.numero, partner_id: Number(ctx.odooId), cip: ctx.cip || null, pharmacie: ctx.nom || null,
    saisie_elixir: ctx.admin || null, conversation_id: d.conversation_id || null, cree_le: d.created_at || iso(), [type]: contenu,
  });

  // Envoi d'une demande déjà passée en « confirmée » (une seule fois) → { statut, cible_ref, erreur, destinataires }
  async function envoyer(type, d, ctx, r, { mailEquipe, mailPharmacie, prevenir, contenu }) {
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
    journal({ evt: "demande", type, code: statut, mode: r.demandes, demande: d.id });
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
  const carteEnregistree = (d, r, ctx) => {
    const simulation = d.cible_ref === "simulation";
    const comptes = comptesDe(ctx);
    return { type: "demande_enregistree", numero: d.numero, date: jourParis(d.confirmee_at || maintenant()), delai: r.delai_annonce,
      email_masque: !simulation && comptes.length && !(ctx.admin && d.prevenu === false) ? masquerEmail(comptes[0]) : null, simulation };
  };
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

    // double clic, onglet rejoué : même réponse, aucun nouvel envoi
    if (ENREGISTREES.has(d.statut)) return { http: 200, message: messageAffiche(`d-${d.id}`, texteEnregistre(d), [carteEnregistree(d, r, ctx)]) };
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
        const message = messageAffiche(`d-${d.id}`, `${raison} Rien n'a été envoyé.`, [{ type: "erreur", texte: raison }]);
        await noter(d, ctx, `La demande de retour n'a pas été enregistrée après recontrôle : ${raison}`, message);
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
    const prevenirPharmacie = !ctx.admin || prevenir !== false;
    const t = maintenant();
    const envoi = await envoyer("retour", conf, ctx, r, {
      prevenir: prevenirPharmacie, contenu: b,
      mailEquipe: ({ simulation, echec }) => ({ to: [r.email_equipe], ...mailEquipeRetour({ d: conf, b, ctx, simulation, echec, maintenant: t }) }),
      mailPharmacie: () => mailPharmacieRetour({ d: conf, b, r, maintenant: t }),
    });
    const fin = { ...conf, cible_ref: envoi.cible_ref, statut: envoi.statut, prevenu: envoi.destinataires.length > 0 };
    const carte = { ...carteEnregistree(fin, r, ctx), email_masque: envoi.destinataires.length ? masquerEmail(envoi.destinataires[0]) : null };
    const message = messageAffiche(`d-${d.id}`, texteEnregistre(fin), [carte]);
    await noter(d, ctx, `Demande de retour ${conf.numero} enregistrée le ${dateFrParis(t)} après confirmation de la pharmacie. Délai annoncé : ${r.delai_annonce}`, message);
    return { http: 200, message };
  }

  // ── Transmission à un conseiller (outil transmettre_a_un_conseiller) → { numero, delai, telephone, horaires } ──
  async function transmettre(ctx, entree = {}) {
    const r = await reglages();
    const conversationId = UUID.test(String(deps.conversationId || "")) ? deps.conversationId : (UUID.test(String(entree.conversation_id || "")) ? entree.conversation_id : null);
    const categorie = CATEGORIES[entree.categorie] ? entree.categorie : "autre";
    const t = {
      categorie, urgence: entree.urgence === "urgente" || categorie === "qualite" ? "urgente" : "normale",
      rappel: RAPPELS[entree.rappel] ? entree.rappel : "indifferent", reference: texte(entree.reference, 80),
      resume: String(entree.resume || "").trim().slice(0, 1500) || null,
    };
    const reponse = (d, deja = false) => ({ numero: d.numero, delai: r.delai_annonce, telephone: r.telephone, horaires: r.horaires, ...(deja ? { deja_transmise: true } : {}) });
    const ouverte = async () => conversationId
      ? (await stock.demandes.lister({ conversation_id: conversationId, type: "transmission", statut: OUVERTES, limite: 5 })).find(x => Number(x.odoo_id) === Number(ctx.odooId))
      : null;
    // dédoublonnage : une transmission ouverte par conversation
    const deja = await ouverte();
    if (deja) return reponse(deja, true);
    // quota par 24 h ; la qualité pharmaceutique garde une marge (jamais bloquée par les autres demandes du jour)
    const faites = await stock.compter.demandes(ctx.odooId, "transmission", il24h());
    if (faites >= r.quotas.transmissions_jour + (categorie === "qualite" ? 3 : 0)) {
      throw erreurPublique(`Plusieurs demandes ont déjà été transmises aujourd'hui pour cette pharmacie. Pour une urgence : ${r.telephone} (${r.horaires}).`, "quota");
    }
    const d = await stock.demandes.creer({ type: "transmission", statut: "confirmee", conversation_id: conversationId, odoo_id: ctx.odooId,
      pharmacie: ctx.nom, admin_email: ctx.admin || null, brouillon: t, resume: t.resume, confirmee_at: iso() });
    if (d.doublon) { const autre = await ouverte(); if (autre) return reponse(autre, true); throw new Error("transmission en double"); }
    const now = maintenant();
    await envoyer("transmission", d, ctx, r, {
      prevenir: t.rappel === "email" && (!ctx.admin || entree.prevenir !== false), contenu: t,
      mailEquipe: ({ simulation, echec }) => ({ to: [categorie === "qualite" ? r.email_qualite : r.email_equipe], ...mailEquipeTransmission({ d, t, ctx, simulation, echec, maintenant: now }) }),
      mailPharmacie: () => mailPharmacieTransmission({ d, t, r }),
    });
    return reponse(d);
  }

  return { creerBrouillon, confirmer, transmettre };
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
