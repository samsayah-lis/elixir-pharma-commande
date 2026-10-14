// ── Relais PharmaML : API (agent du Mac + admin) ─────────────────────────
// Agent (requête signée Ed25519, en-têtes x-relais-agent / x-relais-ts / x-relais-sig) :
//   POST { action: "prendre", instance, version, max }      → { taches: [{ ref, jeton, corps, empreinte, forcer }] }
//   POST { action: "rendre", ref, jeton, http, texte, erreur, ms, envoyeA, empreinte, nonEnvoye, dejaTente }
// Admin (jeton admin) :
//   envoyer { orderId, idx? }       → tâche d'envoi des lignes (synchro manuelle) : { ref, lignes }
//   etat { refs?, orderIds? }       → état des tâches
//   annuler { ref }                 → retire une tâche pas encore prise par l'agent
//   liberer { ref, confirme }       → issue inconnue vérifiée ABSENTE de PharmaML : lignes rendues à la synchro
//   confirmer { ref, confirme }     → issue inconnue vérifiée PRÉSENTE dans PharmaML : lignes marquées envoyées
//   statut                          → agent (dernier contact), pause, réglages, file, envois à vérifier
//   config_save { autoSite, alertes } ; reprendre_envois (lève la pause après un 403) ;
//   test                            → essai sans commande (liste vide) envoyé par l'agent du Mac
// Logique et garde-fous : _relais.js
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { kvDel, kvGet } from "./_lab-justif.js";
import * as R from "./_relais.js";

export const handler = async (event) => {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Méthode non autorisée" });
  const brut = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  let b;
  try { b = JSON.parse(brut || "{}"); } catch { return json(400, { error: "JSON invalide" }); }

  try {
    // ── agent du Mac ──
    if (b.action === "prendre" || b.action === "rendre") {
      const v = R.verifierAgent(event, brut);
      if (!v.ok) return json(401, { error: v.motif });
      if (b.action === "prendre") return json(200, await R.prendre({ agent: v.agent, instance: b.instance, version: b.version, max: b.max }));
      if (!R.REF_RELAIS.test(String(b.ref || "")) || !b.jeton) return json(400, { error: "ref ou jeton manquant" });
      const r = await R.rendre({ ref: String(b.ref), jeton: String(b.jeton), http: Number(b.http) || 0, texte: String(b.texte || "").slice(0, 4000),
        erreur: b.erreur ? String(b.erreur).slice(0, 500) : null, ms: Number(b.ms) || null, envoyeA: b.envoyeA || null, empreinte: b.empreinte || null,
        nonEnvoye: b.nonEnvoye ? String(b.nonEnvoye).slice(0, 300) : null, dejaTente: b.dejaTente ? String(b.dejaTente).slice(0, 60) : null });
      return json(r.ok ? 200 : r.code === "jeton" ? 409 : r.code === "inconnue" ? 404 : 503, r);
    }

    // ── admin ──
    const auth = await verifyAdmin(event);
    if (auth.error) return auth.error;
    const qui = auth.admin?.email || "admin";
    switch (b.action) {
      case "envoyer": {
        const r = await R.envoyerCommande({ orderId: b.orderId, idx: Array.isArray(b.idx) ? b.idx : null, par: `admin:${qui}` });
        return json(r.ok ? 200 : 409, r);
      }
      case "etat": {
        const refs = (Array.isArray(b.refs) ? b.refs : []).map(String).filter(r => R.REF_RELAIS.test(r)).slice(0, 100);
        const taches = {};
        for (const ref of refs) {
          let t = await R.lireTache(ref);
          // échéance dépassée sans prise : expirée tout de suite (l'affichage ne reste pas « en file »)
          if (t?.etat === "a_envoyer" && Date.now() > Date.parse(t.priseAvant)) { await R.expirer(ref).catch(() => {}); t = await R.lireTache(ref); }
          taches[ref] = R.resumeTache(t);
        }
        const commandes = Array.isArray(b.orderIds) ? await R.tachesDeCommandes(b.orderIds.map(String).filter(x => /^\d{6,20}$/.test(x)).slice(0, 100)) : {};
        const pause = await kvGet("pmlr:pause").catch(() => null);
        return json(200, { taches, commandes, pause: pause?.at ? pause : null });
      }
      case "annuler": {
        const r = await R.annulerSiEnAttente(String(b.ref || ""), "annulée dans l'admin", qui);
        return json(r.ok ? 200 : 409, r.ok ? { ok: true } : { ok: false, error: `déjà ${r.tache?.etat === "prise" ? "prise par l'agent (envoi en cours)" : `« ${r.tache?.etat || "?"} »`} : ne peut plus être annulée` });
      }
      case "liberer": {
        if (b.confirme !== true) return json(400, { error: "confirmation requise (référence vérifiée absente du portail PharmaML)" });
        const r = await R.libererApresVerification(String(b.ref || ""), qui);
        return json(r.ok ? 200 : 409, r);
      }
      case "confirmer": {
        if (b.confirme !== true) return json(400, { error: "confirmation requise (référence vérifiée présente sur le portail PharmaML)" });
        const r = await R.confirmerApresVerification(String(b.ref || ""), qui);
        return json(r.ok ? 200 : 409, r);
      }
      case "statut": return json(200, await R.statut());
      case "config_save": return json(200, { config: await R.ecrireConfig(b, qui) });
      case "reprendre_envois": await kvDel("pmlr:pause"); return json(200, { ok: true });
      case "test": {
        const ref = `TEST-${Date.now()}`;
        const r = await R.mettreEnFile({ ref, source: "test", corps: [], creePar: `admin:${qui}`, priseMs: 90e3 });
        return json(r.ok ? 200 : 409, { ok: r.ok, ref });
      }
      default: return json(400, { error: "action inconnue" });
    }
  } catch (e) {
    if (!e.status) console.error("pml-relais", e);
    return json(e.status || 500, { error: String(e.message || e).slice(0, 300) });
  }
};
