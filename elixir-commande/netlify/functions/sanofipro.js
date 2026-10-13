// ── Commandes Sanofi Pro : API admin (onglet « Sanofi Pro ») ──────────────
// POST (jeton admin) { action } :
//   etat                          → réglages, dernier passage, commandes suivies (300 plus récentes)
//   config_save { config }        → réglages (mode arret | simulation | auto, seuils, adresses d'alerte)
//   run                           → passage immédiat (fonction d'arrière-plan)
//   test_pharmaml                 → essai d'envoi PharmaML SANS commande (liste vide) depuis Netlify
//   ignorer { ref }               → plus de traitement ni d'alerte automatique pour cette commande
//   reprendre { ref, confirme }   → réexamen au prochain passage, même ancienne ; après une issue incertaine
//                                   (même ignorée depuis) : confirme requis ; jamais une commande déjà traitée
// ignorer / reprendre prennent le verrou des passages (sp:lock) : un passage en cours ne peut pas
// écraser la décision (409 « réessayez » si un passage tourne).
// Logique et règles : _sanofipro.js
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { kvGet, kvSet, kvGetBrut, kvSetSi, kvList, avecVerrou } from "./_lab-justif.js";
import { lireConfig, validerConfig, CLE, PORTAIL_SP, VERROU, REF_OK, PharmaML } from "./_sanofipro.js";

const SITE_HOSTS = ["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"];
const siteBase = (event) => { const h = String(event?.headers?.host || "").toLowerCase();
  return `https://${SITE_HOSTS.includes(h) || /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/.test(h) ? h : SITE_HOSTS[0]}`; };
const IGNORABLES = new Set(["en_attente", "nouvelle", "a_traiter_main", "erreur", "incertaine", "absente_odoo", "a_repondre", "doublon_pml", "annulee_sanofi"]);
const REPRENABLES = new Set(["en_attente", "a_traiter_main", "ignoree", "erreur", "incertaine"]);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

export const handler = async (event) => {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Méthode non autorisée" });
  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }
  const qui = auth.admin?.email || "admin";
  try {
    if (b.action === "etat") {
      const [config, dernier, lst] = await Promise.all([lireConfig(), kvGet("sp:dernier_passage"), kvList("sp:ord:", 300)]);
      return json(200, { config, dernier, portail: PORTAIL_SP, identifiants: !!(process.env.SANOFIPRO_EMAIL && process.env.SANOFIPRO_PASSWORD),
        commandes: lst.map(r => ({ ...r.value, updated_at: r.updated_at })) });
    }
    if (b.action === "config_save") {
      const config = validerConfig(b.config);
      await kvSet("sp:config", { ...config, majPar: qui, majA: new Date().toISOString() });
      return json(200, { config: await lireConfig() });
    }
    if (b.action === "test_pharmaml") {
      const r = await new PharmaML().essai();
      return json(200, { http: r.status, ok: r.ok, refus: r.refus, message: r.message, commandes: r.commandes });
    }
    if (b.action === "run") {
      if (!process.env.CRON_SECRET) return json(200, { lance: false });
      const r = await fetch(`${siteBase(event)}/.netlify/functions/sanofipro-background`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET }, body: "{}",
      }).catch(() => null);
      return json(200, { lance: !!r && (r.ok || r.status === 202) });
    }
    if (b.action === "ignorer" || b.action === "reprendre") {
      const ref = String(b.ref || "");
      if (!REF_OK.test(ref)) throw bad("référence invalide");
      const res = await avecVerrou(() => decider(b, ref, qui), 60e3, VERROU);
      if (res.occupe) throw bad("un passage est en cours : réessayez dans quelques secondes", 409);
      return json(200, { commande: res.resultat });
    }
    return json(400, { error: "action inconnue" });
  } catch (e) {
    if (!e.status) console.error("sanofipro", e);
    return json(e.status || 500, { error: String(e.message || e).slice(0, 300) });
  }
};

// ignorer / reprendre une commande (sous le verrou des passages)
async function decider(b, ref, qui) {
  const brut = await kvGetBrut(CLE(ref));
  if (!brut?.value) throw bad("commande inconnue", 404);
  const st = brut.value;
  const histo = (etat, motif) => { st.historique = [...(st.historique || []), { at: new Date().toISOString(), etat, motif }].slice(-20); };
  if (b.action === "ignorer") {
    if (!IGNORABLES.has(st.etat)) throw bad(`commande « ${st.etat} » : rien à ignorer`);
    histo("ignoree", `par ${qui} (était : ${st.etat})`);
    st.etat = "ignoree";
  } else {
    if (!REPRENABLES.has(st.etat)) throw bad(`commande « ${st.etat} » : reprise impossible`);
    if (st.traiteeA) throw bad("commande déjà traitée automatiquement : une reprise ferait un doublon");
    // un envoi a pu avoir lieu (issue inconnue, refus, traitée sur le portail, document en double) :
    // PharmaML a pu recevoir la commande
    const douteuse = ["incertaine", "erreur"].includes(st.etat) || !!st.issueInconnue || !!st.envoiPortail || !!st.plusieursDocs || !!st.pml?.envoyeA
      || (st.historique || []).some(h => ["incertaine", "erreur", "portail"].includes(h.etat));
    if (douteuse && b.confirme !== true) throw bad("un envoi a pu avoir lieu (issue inconnue, refus, traitée sur le portail ou document en double) : confirmez avoir vérifié qu'aucun envoi n'existe sur le portail ni dans PharmaML");
    histo("nouvelle", `reprise${douteuse ? " CONFIRMÉE (envoi vérifié absent)" : ""} par ${qui} (était : ${st.etat})`);
    st.etat = "nouvelle"; st.forcer = true; delete st.alerteCle;
  }
  delete st.alerteDue;
  st.maj = new Date().toISOString();
  if (!(await kvSetSi(CLE(ref), st, brut.maj))) throw bad("commande modifiée entre-temps : rechargez", 409);
  return st;
}
