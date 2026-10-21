// ── Notifications de l'appli Elixir : API signée de l'outil entrepôt (Réclamations / Tickets, docs/notifications.md § 6) ──
// POST, de serveur à serveur (aucun navigateur) ; même contrat de signature que l'API « chatbot-intake » de l'Assistant
// (docs/assistant-contrat.md, _chat-demandes.js versEntrepot) :
//   X-Elixir-Horodatage : secondes depuis 1970 (±5 minutes)
//   X-Elixir-Signature  : sha256=<HMAC-SHA256 hexadécimal de « <horodatage>.<corps brut> » avec PUSH_EVENEMENT_SECRET>
//   Idempotency-Key     : 8 à 128 caractères (lettres, chiffres, _ . : -), une par événement
// Corps : { cip, type: "reclamation" | "ticket" | "commande", statut, reference, titre?, corps?, url? } (4 Ko au plus) ;
// titre et corps libres seulement pour un statut sans texte par défaut (jamais le texte d'un ticket ni un nom de patient)
// → 200 { ok, resultat: "envoye" | "aucun_appareil" | "fermee" | "hors_pilote" | "plafond" | "differe", envoyes, echecs }
//     (« differe » : reçu avant 8 h, après 20 h ou le dimanche, heure de Paris → envoyé au prochain matin 8 h, envoi_prevu)
//   · 200 { ok, deja: true, resultat } (même clé, ou même statut de la même référence reçu dans les 10 dernières minutes :
//     rien n'est renvoyé)
//   · 400 requete | json | idempotency_key · 401 horodatage | signature · 409 idempotency_key_reutilisee · 413 trop_long
//   · 429 quota (Retry-After) · 503 configuration (secret absent) | indisponible (Retry-After : base injoignable, clés VAPID
//     refusées, appareils de la pharmacie tous en échec) → à rejouer avec la MÊME clé, la réservation est retirée
// Une réservation orpheline (fonction coupée après la réservation, sans résultat depuis 60 s) est reprise par le rejeu de
// la même clé. La pharmacie reçoit la notification dans « Mes commandes et réclamations » (catégorie « commandes » :
// ouverture, alerte choisie et plafond de sécurité par 24 h respectés, comptes revérifiés). Journal sans contenu (ni texte,
// ni référence, ni secret). Hôte d'aperçu Netlify : signature vérifiée, rien n'est enregistré ni envoyé.
// Débit : par adresse IP AVANT la signature (une rafale non signée ne bloque que son adresse), global APRÈS la signature.
import { configPush, creerStockPush, creerLimiteur, estApercu, notifierPharmacie } from "./_push.js";
import {
  verifierSignature, verifierEvenement, etiquetteEvenement, empreinteEvenement, typeMessageDeEvenement, RE_CLE_IDEMPOTENCE, FENETRE_DOUBLON_MS,
  trancheDoublon, echecPassager, resultatEvenement,
} from "./_push-messages.js";
import { horsHeures, prochainMatin } from "../../src/notifications/regles.js";

export const CORPS_MAX = 4096;
const DEBIT_IP = [120, 60];       // requêtes par minute et par adresse IP (par instance) : avant la signature
const DEBIT = [120, 60];          // requêtes SIGNÉES par minute (par instance)
const DEBIT_CIP = [30, 3600];     // événements par pharmacie et par heure (par instance) ; le plafond de sécurité par 24 h, lui, est durable
export const SECRET_MIN = 32;     // caractères (openssl rand -hex 32 : 64)
export const ORPHELINE_MS = 60e3; // réservation sans résultat depuis 60 s : fonction coupée, reprise par le rejeu de la même clé
const REJOUER_S = 120;            // Retry-After d'un échec passager

// deps (doublures des tests) : stock, config(), secret, limite, transport, hotesEssai, maintenant, journal
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockPush());
  const limite = deps.limite || creerLimiteur();
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  const secretDe = () => String((deps.secret !== undefined ? deps.secret : process.env.PUSH_EVENEMENT_SECRET) || "");
  const rep = (statusCode, corps, extra = {}) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }, body: JSON.stringify(corps) });
  const quota = (s) => rep(429, { error: "quota", message: "Trop d'événements en peu de temps : réessayez plus tard." }, { "Retry-After": String(s) });
  const indisponible = (message = "Réessayez dans un instant avec la même Idempotency-Key.") => rep(503, { error: "indisponible", message }, { "Retry-After": String(REJOUER_S) });

  return async (event) => {
    if (event.httpMethod !== "POST") return rep(405, { error: "methode" });
    const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [String(k).toLowerCase(), String(v ?? "")]));
    const corps = event.isBase64Encoded ? Buffer.from(String(event.body || ""), "base64").toString("utf8") : String(event.body || "");
    if (Buffer.byteLength(corps) > CORPS_MAX) return rep(413, { error: "trop_long" });
    const secret = secretDe();
    if (secret.length < SECRET_MIN) {
      journal({ evt: "push_evenement", code: "configuration" });
      return rep(503, { error: "configuration", message: "PUSH_EVENEMENT_SECRET absent (ou trop court) des variables Netlify." });
    }
    // avant la signature : par adresse (des requêtes non signées n'entament jamais le débit de l'outil entrepôt)
    const ip = (h["x-nf-client-connection-ip"] || h["client-ip"] || h["x-forwarded-for"] || "?").split(",")[0].trim().slice(0, 64);
    const attenteIp = limite(`ip|${ip}`, DEBIT_IP[0], DEBIT_IP[1]);
    if (attenteIp) return quota(attenteIp);
    const sig = verifierSignature({ corps, horodatage: h["x-elixir-horodatage"], signature: h["x-elixir-signature"], secret, maintenant: maintenant().getTime() });
    if (!sig.ok) { journal({ evt: "push_evenement", code: sig.raison }); return rep(401, { error: sig.raison }); }
    const attente = limite("global", DEBIT[0], DEBIT[1]);
    if (attente) return quota(attente);
    const cle = h["idempotency-key"] || "";
    if (!RE_CLE_IDEMPOTENCE.test(cle)) return rep(400, { error: "idempotency_key", message: "En-tête Idempotency-Key : 8 à 128 caractères (lettres, chiffres, _ . : -)." });
    let b;
    try { b = JSON.parse(corps); } catch { return rep(400, { error: "json" }); }
    const v = verifierEvenement(b);
    if (!v.ok) return rep(400, { error: "requete", erreurs: v.erreurs });
    const e = v.evenement;
    if (estApercu(event)) return rep(200, { apercu: true, ok: true, resultat: "apercu", envoyes: 0, echecs: 0 });
    const attenteCip = limite(`cip|${e.cip}`, DEBIT_CIP[0], DEBIT_CIP[1]);
    if (attenteCip) { journal({ evt: "push_evenement", type: e.type, code: "quota" }); return quota(attenteCip); }

    const stock = stockDe();
    const t = maintenant().getTime();
    const tranche = trancheDoublon(t);
    const etiquette = etiquetteEvenement(e.type, e.reference, secret);
    let reserve;
    try {
      reserve = await stock.evenements.reserver({ cle, empreinte: empreinteEvenement(e, tranche), pharmacy_cip: e.cip, type: e.type, statut: e.statut, reference: e.reference, titre: e.titre },
        { precedente: empreinteEvenement(e, tranche - 1), depuis: new Date(t - FENETRE_DOUBLON_MS).toISOString() });
    } catch (err) {
      journal({ evt: "push_evenement", code: err?.code || "erreur", erreur: String(err?.message || err).slice(0, 120) });
      return indisponible(err?.code === "schema" ? "Tables absentes : exécutez sql/push-messages.sql." : undefined);
    }
    if (!reserve.nouveau) {
      const l = reserve.ligne;
      // même clé pour un AUTRE événement : erreur de l'outil entrepôt (jamais deux événements sous une clé)
      if (l && l.cle === cle && (l.pharmacy_cip !== e.cip || l.type !== e.type || l.statut !== e.statut || l.reference !== e.reference)) {
        journal({ evt: "push_evenement", type: e.type, code: "cle_reutilisee" });
        return rep(409, { error: "idempotency_key_reutilisee" });
      }
      // réservation orpheline de CETTE clé (fonction coupée avant la fin) : reprise une seule fois, puis envoi
      const orpheline = l && l.cle === cle && l.resultat == null && Date.parse(l.recu_le) < t - ORPHELINE_MS;
      const repris = orpheline ? await stock.evenements.reprendre(cle, new Date(t - ORPHELINE_MS).toISOString()).catch(() => null) : null;
      if (!repris) {
        journal({ evt: "push_evenement", type: e.type, statut: e.statut, code: "deja" });
        return rep(200, { ok: true, deja: true, resultat: l?.resultat ?? null, envoyes: l?.nb_reussis ?? null });
      }
      journal({ evt: "push_evenement", type: e.type, statut: e.statut, code: "repris" });
    }
    // avant 8 h, après 20 h ou le dimanche (heure de Paris) : différé au prochain matin 8 h (push-programmes), jamais la nuit
    if (horsHeures(t)) {
      const quand = prochainMatin(t);
      try { await stock.evenements.differer(cle, { corps: e.corps, url: e.url, etiquette, a_envoyer_le: quand }); }
      catch (err) {
        await stock.evenements.liberer(cle).catch(() => {});
        journal({ evt: "push_evenement", code: err?.code || "erreur", erreur: String(err?.message || err).slice(0, 120) });
        return indisponible();
      }
      journal({ evt: "push_evenement", type: e.type, statut: e.statut, code: "differe" });
      return rep(200, { ok: true, resultat: "differe", envoi_prevu: quand, envoyes: 0, echecs: 0 });
    }
    const r = await notifierPharmacie(e.cip, "commandes", { titre: e.titre, corps: e.corps, url: e.url, tag: etiquette },
      { type: typeMessageDeEvenement(e.type), source: "entrepot", stock, config: deps.config ? deps.config() : configPush(), transport: deps.transport,
        hotesEssai: deps.hotesEssai, maintenant, journal, delaiMs: 4000 });
    // échec passager : réservation retirée, l'outil entrepôt rejoue la même clé plus tard (rien de perdu)
    if (echecPassager(r)) {
      await stock.evenements.liberer(cle).catch(() => {});
      journal({ evt: "push_evenement", type: e.type, statut: e.statut, code: "a_rejouer", raison: r.raison || "appareils_en_echec", echecs: r.echecs });
      return indisponible();
    }
    const resultat = resultatEvenement(r);
    await stock.evenements.terminer(cle, { resultat, nb_appareils: r.envoyes + r.echecs + r.retires, nb_reussis: r.envoyes }).catch(() => {});
    journal({ evt: "push_evenement", type: e.type, statut: e.statut, code: resultat, envoyes: r.envoyes, echecs: r.echecs });
    return rep(200, { ok: true, resultat, envoyes: r.envoyes, echecs: r.echecs });
  };
}

export const handler = creerHandler();
