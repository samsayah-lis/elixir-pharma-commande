// ── Commandes Sanofi Pro : API admin (onglet « Sanofi Pro ») ──────────────
// POST (jeton admin) { action } :
//   etat                          → réglages, dernier passage, commandes suivies (300 plus récentes)
//   config_save { config }        → réglages (mode arret | simulation | auto, seuils, adresses d'alerte)
//   run                           → passage immédiat (fonction d'arrière-plan)
//   test_pharmaml                 → essai SANS commande (liste vide) envoyé par l'agent du Mac (relais) → { ref }
//   diag_pml { pPass }            → diagnostic du refus PharmaML (lecture seule + essai à liste vide) : identifiants
//                                   comparés à ceux de l'agent local par une empreinte courte (jamais renvoyés),
//                                   réponse brute, IP de sortie Netlify, journal des envois du site (pml:*)
//   ignorer { ref }               → plus de traitement ni d'alerte automatique pour cette commande
//   reprendre { ref, confirme }   → réexamen au prochain passage, même ancienne ; après une issue incertaine
//                                   (même ignorée depuis) : confirme requis ; jamais une commande déjà traitée
// ignorer / reprendre prennent le verrou des passages (sp:lock) : un passage en cours ne peut pas
// écraser la décision (409 « réessayez » si un passage tourne).
// Logique et règles : _sanofipro.js
import { createHash } from "node:crypto";
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { kvGet, kvSet, kvGetBrut, kvSetSi, kvList, avecVerrou } from "./_lab-justif.js";
import { lireConfig, validerConfig, CLE, PORTAIL_SP, VERROU, REF_OK } from "./_sanofipro.js";
import { mettreEnFile } from "./_relais.js";

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
      // essai par le relais : l'agent du Mac envoie une liste vide (PharmaML refuse Netlify, 403) ; suivi par pml-relais « etat »
      const ref = `TEST-${Date.now()}`;
      const r = await mettreEnFile({ ref, source: "test", corps: [], creePar: `admin:${qui}`, priseMs: 90e3 });
      return json(200, { ok: r.ok, ref });
    }
    if (b.action === "diag_pml") {
      const url = (process.env.PHARMAML_URL || "https://pharmaml.elixirpharma.fr").replace(/\/$/, "");
      const user = process.env.PHARMAML_USER || "admin";
      const pass = process.env.PHARMAML_PASS || "";
      // empreinte courte (4 caractères hexa) : suffit à comparer, ne permet pas de retrouver le mot de passe
      const e4 = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 4);
      const masque = (t) => { let x = String(t || ""); for (const v of [pass, encodeURIComponent(pass)]) if (v) x = x.split(v).join("***"); return x; };
      const texte = (t) => masque(t).replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
      const essai = async (avecIdentifiants) => {
        const t0 = Date.now();
        try {
          const r = await fetch(`${url}/commandes.php${avecIdentifiants ? `?U=${encodeURIComponent(user)}&P=${encodeURIComponent(pass)}` : ""}`, { method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "[]", redirect: "manual", signal: AbortSignal.timeout(20000) });
          const corps = await r.text();
          const entetes = {}; for (const k of ["server", "content-type", "x-powered-by", "www-authenticate", "location", "set-cookie", "x-frame-options", "via"]) if (r.headers.get(k)) entetes[k] = masque(r.headers.get(k)).slice(0, 200);
          return { http: r.status, ms: Date.now() - t0, entetes, corps: texte(corps) };
        } catch (e) { return { erreur: masque(e.message || e).slice(0, 200), ms: Date.now() - t0 }; }
      };
      const [avec, sans, ip] = await Promise.all([essai(true), essai(false),
        fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(j => j.ip).catch(() => null)]);
      const journal = (await kvList("pml:", 2000).catch(() => [])).map(r => r.value).filter(Boolean);
      const groupes = {};
      for (const e of journal) { const k = `${e.via || "?"} · ${e.outcome || "?"} · HTTP ${e.http ?? "-"}`; const g = (groupes[k] ||= { n: 0, premier: e.ts, dernier: e.ts });
        g.n++; if (String(e.ts) < String(g.premier)) g.premier = e.ts; if (String(e.ts) > String(g.dernier)) g.dernier = e.ts; }
      return json(200, {
        identifiants: { url, urlDefinie: !!process.env.PHARMAML_URL, user, userDefini: !!process.env.PHARMAML_USER, passDefini: !!pass,
          passEmpreinte: b.pPass ? (e4(pass) === String(b.pPass) ? "identique" : e4(pass.trim()) === String(b.pPass) ? "identique sans les espaces" : "différent") : null,
          passEspaces: pass !== pass.trim(), passGuillemets: /^(["']).*\1$/.test(pass) },
        ipNetlify: ip, essaiAvecIdentifiants: avec, essaiSansIdentifiants: sans,
        journal: { total: journal.length, groupes, derniers: journal.slice(0, 15).map(e => ({ ts: e.ts, via: e.via, orderId: e.orderId, outcome: e.outcome, http: e.http, ms: e.ms,
          detail: texte(e.erreur || e.motif || (typeof e.brut === "string" ? e.brut : "") || JSON.stringify(e.pharmaml || "")).slice(0, 200),
          ...(e.jeton ? { jeton: e.jeton, versionPage: e.versionPage } : {}) })) },
      });
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
