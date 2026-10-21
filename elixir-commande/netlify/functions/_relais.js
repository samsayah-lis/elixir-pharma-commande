// ── Relais PharmaML : seul l'agent du Mac du bureau peut envoyer à PharmaML ──
// InfoSoft n'accepte commandes.php que depuis l'adresse du bureau : depuis Netlify, tout envoi reçoit
// 403 « Forbidden » (constaté le 14/10/2026, mêmes identifiants : 200 depuis le Mac). Le site met donc
// chaque envoi en file (une tâche par référence PharmaML) ; l'agent du Mac interroge le site, réserve
// une tâche, l'envoie depuis le bureau, puis rend la réponse BRUTE ; le classement se fait ici.
//
// Anti-doublon (une commande envoyée deux fois = marchandise livrée deux fois) :
//   - une tâche par référence (pmlr:tache:<réf>, création seule) ; une ligne d'une commande du site
//     n'appartient qu'à une tâche (pmlr:ligne:<commande>:<index>, création seule, gardée après l'envoi) ;
//   - transitions par écriture conditionnelle (updated_at) : à_envoyer → prise (agent) OU expirée /
//     annulée (site), une seule gagne ; une tâche prise ne redevient JAMAIS « à envoyer » ;
//   - issue incertaine (pas de compte rendu, délai, 5xx, réponse illisible) : vérification humaine,
//     jamais de renvoi automatique ; l'agent tient aussi son propre journal et ne renvoie jamais une
//     référence déjà tentée (sauf refus certain, ou reprise confirmée).
// Décisions de Zineb (14/10/2026) : envoi automatique des commandes du site (pharmacies et saisies Elixir ;
// pas U-Labs ni justificatifs), seulement les lignes en stock, sans contrôle de prix.
//
// kv_store : pmlr:tache:<réf>, pmlr:file:<réf> (tâches à envoyer), pmlr:ligne:<commande>:<i>,
// pmlr:agent (dernier contact), pmlr:config, pmlr:pause, pmlr:empreinte:<cip>:<hash>, pmlr:alerte:<type>,
// pmlr:averifier:<réf> (envois à l'issue inconnue), pmlr:avis:<commande> (envoi automatique écarté : doublon…).
import { createHash, createPublicKey, randomUUID, verify as verifierSignature } from "node:crypto";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { sb, kvGet, kvGetBrut, kvSet, kvDel, kvCreate, kvList, fichePharmacie, esc, MAIL_DE } from "./_lab-justif.js";

// Agents autorisés : clé publique Ed25519 (SPKI, base64). La clé privée ne quitte jamais le Mac
// (~/Downloads/elixir-local-agent/relais-cle.pem) ; rien de secret ici.
export const AGENTS = { "mac-bureau": "MCowBQYDK2VwAyEAXoyi5FDUDtsrMCGcEwJbewAVdl8AY/f63MDf/DSzEz0=" };
export const VERSION_MIN_AGENT = 3;
const HORLOGE_MS = 120e3;                       // écart d'horloge toléré pour une requête signée
export const REF_RELAIS = /^[0-9A-Za-z-]{3,40}$/;
const CLE_T = (ref) => `pmlr:tache:${ref}`;
const CLE_F = (ref) => `pmlr:file:${ref}`;
const CLE_L = (id, i) => `pmlr:ligne:${id}:${i}`;
export const PRISE_SITE_MS = 2 * 3600e3;        // commande du site : envoyée dans les 2 h, sinon à la main
export const PRISE_ADMIN_MS = 30 * 60e3;        // synchro demandée dans l'admin
export const ACTIVES = new Set(["a_envoyer", "prise"]);
const LIBERES = new Set(["refusee", "expiree", "annulee", "non_envoyee"]);   // rien n'est parti : lignes rendues
const AUTO_AGE_MAX_MS = 30 * 60e3;              // envoi automatique : commande de moins de 30 min seulement
const ORPHELINE_MS = 5 * 60e3;                  // réservation de ligne sans tâche depuis 5 min : requête morte, réservation libérée
const SANS_CR_MS = 15 * 60e3;                   // tâche prise sans compte rendu depuis 15 min : « à vérifier »
const CLE_V = (ref) => `pmlr:averifier:${ref}`; // index des envois à l'issue inconnue (bandeau de l'admin)
const DOUBLE_MS = 2 * 3600e3;                   // même pharmacie, mêmes lignes en moins de 2 h = à vérifier
export const CONFIG_DEFAUT = { autoSite: false, depuis: null, alertes: "pharmacien@elixirpharma.fr" };
const ALERTE_H = 2;

const maintenant = () => new Date().toISOString();
export const empreinte = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const lineDone = (it) => !!(it?.synced_at || it?.handled_at);
const histo = (t, etat, motif, par) => { t.historique = [...(t.historique || []), { at: maintenant(), etat, ...(motif ? { motif } : {}), ...(par ? { par } : {}) }].slice(-20); };
const items = (o) => { let it = o?.items; if (typeof it === "string") { try { it = JSON.parse(it); } catch { it = []; } } return Array.isArray(it) ? it : []; };

// écriture conditionnelle : n'aboutit que si la clé n'a pas changé depuis la lecture ; horodatage toujours
// différent de la version lue → nouvelle version, ou null
async function majSi(cle, valeur, maj) {
  if (!maj) return null;
  let t = Date.now();
  if (new Date(t).toISOString() === new Date(maj).toISOString()) t += 1;
  const nouv = new Date(t).toISOString();
  const res = await sb(`kv_store?key=eq.${encodeURIComponent(cle)}&updated_at=eq.${encodeURIComponent(maj)}`,
    { method: "PATCH", prefer: "return=representation", body: { value: JSON.stringify(valeur), updated_at: nouv } });
  return Array.isArray(res) && res.length === 1 ? (res[0].updated_at || nouv) : null;
}
export const lireTache = async (ref) => (await kvGetBrut(CLE_T(ref)))?.value || null;
// suppression seulement si la clé n'a pas changé depuis la lecture
async function supprimerSi(cle, maj) {
  if (!maj) return false;
  const res = await sb(`kv_store?key=eq.${encodeURIComponent(cle)}&updated_at=eq.${encodeURIComponent(maj)}`, { method: "DELETE", prefer: "return=representation" });
  return Array.isArray(res) && res.length === 1;
}

// ── Corps PharmaML (même format que le site et l'agent depuis toujours) ──
export const corpsSite = (cip, ref, lignes) => [{ identifiantPML: String(cip), referenceCommande: ref,
  lignes: lignes.map(i => ({ CIP: String(i.cip || ""), libelle: String(i.name || "").substring(0, 50), quantiteCommandee: parseInt(i.qty) || 0,
    quantiteLivree: parseInt(i.qty) || 0, prix: i.pn != null && Number.isFinite(parseFloat(i.pn)) ? Math.round(parseFloat(i.pn) * 100) / 100 : 0 })) }];

// ── Classement de la réponse brute de PharmaML (rendue par l'agent) ──
// succès : 2xx + objet JSON, status ≠ error, sans erreurs, au moins une commande créée (sauf essai à vide) ;
// refus : 4xx ou status error (rien n'est créé) ; tout le reste : incertain (vérification humaine)
export function classer({ http, texte, erreur, nonEnvoye, dejaTente }, { vide = false } = {}) {
  if (nonEnvoye) return { issue: "non_envoye", message: String(nonEnvoye).slice(0, 300) };
  if (dejaTente) return { issue: "incertain", message: `l'agent avait déjà tenté cette référence (${dejaTente}) : pas de nouvel envoi, vérifiez PharmaML` };
  if (erreur || !http) return { issue: "incertain", message: String(erreur || "pas de réponse de PharmaML").slice(0, 300) };
  let j = null; try { j = JSON.parse(texte); } catch { /* non JSON */ }
  const obj = !!j && typeof j === "object" && !Array.isArray(j);
  const msg = obj ? String(j.message || j.detail || j.errors?.[0]?.message || j.title || "") : String(texte || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const avec = (m) => `HTTP ${http}${m ? ` : ${m}` : ""}`.slice(0, 300);
  // un refus n'est cru que si rien n'indique une commande créée
  const creees = obj ? Number(j.commandes) : NaN;
  if ((http >= 400 && http < 500) || (obj && String(j.status).toLowerCase() === "error")) {
    if (creees >= 1) return { issue: "incertain", message: avec(`refus annoncé mais ${creees} commande(s) créée(s) : ${msg}`) };
    return { issue: "refus", message: avec(msg || "status error") };
  }
  if (http >= 200 && http < 300 && obj) {
    const errs = Array.isArray(j.errors) ? j.errors.filter(Boolean) : [];
    if (errs.length) return { issue: "incertain", message: `réponse avec erreurs : ${JSON.stringify(errs).slice(0, 250)}` };
    const n = Number(j.commandes);
    if (!vide && !(n >= 1)) return { issue: "incertain", message: `PharmaML répond « ${j.status || "?"} » mais ${Number.isFinite(n) ? `${n} commande créée` : "sans nombre de commandes"}` };
    return { issue: "succes", message: msg, commandes: Number.isFinite(n) ? n : null };
  }
  return { issue: "incertain", message: avec(msg) };
}

// ── Réglages ────────────────────────────────────────────────────────────
export async function lireConfig() { return { ...CONFIG_DEFAUT, ...((await kvGet("pmlr:config").catch(() => null)) || {}) }; }
export async function ecrireConfig(c, par) {
  const cur = await lireConfig();
  const autoSite = !!c.autoSite;
  const alertes = String(c.alertes ?? cur.alertes).trim();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}([\s,;]+[^@\s,;]+@[^@\s,;]+\.[a-z]{2,})*$/i.test(alertes)) throw Object.assign(new Error("adresse(s) d'alerte invalide(s)"), { status: 400 });
  // activation : seules les commandes passées APRÈS sont envoyées automatiquement (jamais l'arriéré)
  const v = { autoSite, depuis: autoSite ? (cur.autoSite && cur.depuis ? cur.depuis : maintenant()) : null, alertes, majPar: par, majA: maintenant() };
  await kvSet("pmlr:config", v);
  return v;
}

// ── Création d'une tâche ────────────────────────────────────────────────
// t : { ref, source: site|sanofi|test, corps, cip, pharmacie?, orderId?, idx?, cips?, creePar, priseMs, forcer? }
// Une référence déjà connue n'est réarmée que si rien n'est parti (refusée, expirée, annulée, vérifiée
// absente), ou sur reprise confirmée (forcer). → { ok, tache } | { ok:false, existe, tache }
export async function mettreEnFile(t) {
  if (!REF_RELAIS.test(String(t.ref || ""))) throw Object.assign(new Error(`référence PharmaML invalide (${t.ref})`), { status: 400 });
  if (!Array.isArray(t.corps) || (t.source !== "test" && !t.corps.length)) throw Object.assign(new Error("corps PharmaML vide"), { status: 400 });
  if (t.corps.some(c => c.referenceCommande !== t.ref)) throw Object.assign(new Error("référence du corps différente de la tâche"), { status: 400 });
  const tache = { ref: t.ref, source: t.source, corps: t.corps, empreinte: empreinte(t.corps), cip: t.cip ? String(t.cip) : null, pharmacie: t.pharmacie || null,
    ...(t.orderId ? { orderId: String(t.orderId), idx: t.idx, cips: t.cips } : {}), creePar: t.creePar, creeA: maintenant(),
    priseAvant: new Date(Date.now() + (t.priseMs || PRISE_ADMIN_MS)).toISOString(), etat: "a_envoyer", tentative: 1, ...(t.forcer ? { forcer: true } : {}) };
  histo(tache, "a_envoyer", null, t.creePar);
  if (await kvCreate(CLE_T(t.ref), tache)) {
    await kvSet(CLE_F(t.ref), { ref: t.ref, creeA: tache.creeA }).catch(() => {});   // l'expiration répare un index manquant
    return { ok: true, tache };
  }
  const b = await kvGetBrut(CLE_T(t.ref));
  const cur = b?.value;
  if (!cur) return { ok: false, existe: true, tache: null };
  // réarmée seulement si rien n'est parti, ou issue inconnue vérifiée par un humain (forcer) ; jamais une tâche envoyée
  const rearmable = LIBERES.has(cur.etat) || (t.forcer && cur.etat === "incertaine");
  if (!rearmable || cur.empreinte !== tache.empreinte && t.source === "site") return { ok: false, existe: true, tache: cur };
  const nouv = { ...cur, ...tache, tentative: (cur.tentative || 1) + 1, historique: cur.historique, precedent: { etat: cur.etat, message: cur.message || null, renduA: cur.renduA || null } };
  delete nouv.jeton; delete nouv.priseA; delete nouv.resultat; delete nouv.renduA; delete nouv.message;
  histo(nouv, "a_envoyer", `nouvel essai (était : ${cur.etat})${t.forcer ? " — reprise confirmée" : ""}`, t.creePar);
  if (!await majSi(CLE_T(t.ref), nouv, b.maj)) return { ok: false, existe: true, tache: cur };
  await kvSet(CLE_F(t.ref), { ref: t.ref, creeA: nouv.creeA }).catch(() => {});
  await kvDel(CLE_V(t.ref)).catch(() => {});
  return { ok: true, tache: nouv };
}

// à_envoyer → expirée / annulée (une seule transition gagne contre la prise par l'agent)
async function retirer(ref, etat, motif, par) {
  for (let i = 0; i < 3; i++) {
    const b = await kvGetBrut(CLE_T(ref));
    if (!b?.value) { await kvDel(CLE_F(ref)).catch(() => {}); return { ok: true, absente: true }; }
    const t = b.value;
    if (t.etat !== "a_envoyer") return { ok: false, tache: t };
    const nouv = { ...t, etat }; histo(nouv, etat, motif, par);
    if (await majSi(CLE_T(ref), nouv, b.maj)) { await kvDel(CLE_F(ref)).catch(() => {}); await libererLignes(nouv); return { ok: true, tache: nouv }; }
  }
  return { ok: false, tache: await lireTache(ref) };
}
export const annulerSiEnAttente = (ref, motif, par) => retirer(ref, "annulee", motif, par);
export const expirer = (ref) => retirer(ref, "expiree", "non prise par l'agent du Mac avant l'échéance : rien envoyé");

// lignes d'une commande du site rendues (rien n'est parti) : la synchro manuelle peut les reprendre
async function libererLignes(t) {
  if (!t.orderId || !Array.isArray(t.idx)) return;
  for (const i of t.idx) {
    const b = await kvGetBrut(CLE_L(t.orderId, i)).catch(() => null);
    if (b?.value?.ref === t.ref) await supprimerSi(CLE_L(t.orderId, i), b.maj).catch(() => {});
  }
}

// ── Côté agent : prendre / rendre ───────────────────────────────────────
export function verifierAgent(event, corpsBrut) {
  const h = (k) => event.headers?.[k] ?? event.headers?.[k.toLowerCase()];
  const agent = String(h("x-relais-agent") || ""), ts = Number(h("x-relais-ts")), sig = String(h("x-relais-sig") || "");
  const pub = AGENTS[agent];
  if (!pub || !sig || !Number.isFinite(ts)) return { ok: false, motif: "agent inconnu ou requête non signée" };
  if (Math.abs(Date.now() - ts) > HORLOGE_MS) return { ok: false, motif: "horloge du Mac décalée de plus de 2 min (ou requête rejouée)" };
  const msg = `${ts}\nPOST /relais\n${createHash("sha256").update(corpsBrut || "").digest("hex")}`;
  let ok = false;
  try { ok = verifierSignature(null, Buffer.from(msg), createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" }), Buffer.from(sig, "base64")); } catch { ok = false; }
  return ok ? { ok: true, agent } : { ok: false, motif: "signature invalide" };
}

export async function prendre({ agent, instance, version, max = 3 }) {
  await kvSet("pmlr:agent", { vuA: maintenant(), agent, instance: String(instance || "").slice(0, 40), version: Number(version) || 0 }).catch(() => {});
  if (!(Number(version) >= VERSION_MIN_AGENT)) return { taches: [], arret: `version de l'agent trop ancienne (${version}) : installez la v${VERSION_MIN_AGENT}` };
  // pause (403) : plus aucun envoi, sauf les essais à vide (pour vérifier que l'adresse du bureau est de nouveau autorisée)
  const pause = await kvGet("pmlr:pause").catch(() => null);
  const file = (await kvList("pmlr:file:", 200)).sort((a, b) => String(a.value?.creeA).localeCompare(String(b.value?.creeA)));
  const out = [];
  for (const f of file) {
    if (out.length >= Math.min(Number(max) || 1, 5)) break;
    const ref = f.key.slice("pmlr:file:".length);
    try {
      const b = await kvGetBrut(CLE_T(ref));
      const t = b?.value;
      if (!t || t.etat !== "a_envoyer") { await kvDel(CLE_F(ref)).catch(() => {}); continue; }
      if (pause?.at && t.source !== "test") continue;
      if (Date.now() > Date.parse(t.priseAvant)) { await expirer(ref); continue; }
      const nouv = { ...t, etat: "prise", priseA: maintenant(), jeton: randomUUID(), agent: `${agent}/${String(instance || "").slice(0, 12)} v${version}` };
      histo(nouv, "prise", null, nouv.agent);
      if (!await majSi(CLE_T(ref), nouv, b.maj)) continue;     // retirée ou prise entre-temps
      await kvDel(CLE_F(ref)).catch(() => {});
      out.push({ ref, jeton: nouv.jeton, corps: t.corps, empreinte: t.empreinte, forcer: !!t.forcer, source: t.source });
    } catch (e) { console.error("relais : prendre", ref, e.message); break; }   // les tâches déjà prises sont quand même données à l'agent
  }
  return { taches: out, ...(pause?.at ? { pause: pause.motif } : {}) };
}

// r : { ref, jeton, http, texte, erreur, ms, envoyeA, empreinte, nonEnvoye, dejaTente }
export async function rendre(r) {
  for (let essai = 0; essai < 4; essai++) {
    const b = await kvGetBrut(CLE_T(r.ref));
    const t = b?.value;
    if (!t) return { ok: false, code: "inconnue" };
    if (t.jeton !== r.jeton) return { ok: false, code: "jeton" };
    const tardif = t.etat === "incertaine" && t.sansCompteRendu;              // passée « à vérifier » faute de compte rendu
    if (t.etat !== "prise" && !tardif) {
      // déjà rendue : idempotent ; marques d'envoi rejouées (un échec précédent ne laisse pas la commande « non envoyée »)
      if (t.etat === "envoyee" && t.source === "site") { try { await marquerCommande(t); } catch { return { ok: false, code: "reessayer" }; } }
      // compte rendu qui contredit une décision humaine (« pas dans PharmaML » alors que l'agent a bien envoyé) : DOUBLON probable
      const c0 = classer(r, { vide: t.source === "test" });
      if (t.verifieePar && t.etat === "non_envoyee" && (c0.issue === "succes" || (c0.issue === "incertain" && r.http))) {
        await kvSet(`pmlr:contredit:${t.ref}`, { ref: t.ref, at: maintenant(), http: r.http || null, message: c0.message }).catch(() => {});
        await alerter(`contredit:${t.ref}`, `⚠ Relais PharmaML : DOUBLON probable ${t.ref}`,
          `L'envoi ${t.ref}${t.pharmacie ? ` (${t.pharmacie})` : ""} avait été déclaré « pas dans PharmaML » par ${t.verifieePar}, mais l'agent du Mac l'a envoyé ensuite (PharmaML : ${c0.message || `HTTP ${r.http}`}). Si ses lignes ont été renvoyées depuis (référence ${t.ref}P…), il y a DEUX commandes dans PharmaML : annulez-en une AVANT expédition.`, 24 * 365).catch(() => {});
      }
      return { ok: true, deja: true, etat: t.etat };
    }
    let c = classer(r, { vide: t.source === "test" });
    if (c.issue !== "non_envoye" && r.empreinte && r.empreinte !== t.empreinte) c = { issue: "incertain", message: "corps envoyé différent de la tâche (empreinte)" };
    const etat = { succes: "envoyee", refus: "refusee", non_envoye: "non_envoyee", incertain: "incertaine" }[c.issue];
    const nouv = { ...t, etat, renduA: maintenant(), message: c.message || null, commandes: c.commandes ?? null, sansCompteRendu: false,
      resultat: { http: r.http || null, ms: r.ms || null, texte: String(r.texte || "").slice(0, 500), erreur: r.erreur || null, envoyeA: r.envoyeA || null } };
    histo(nouv, etat, c.message);
    if (!await majSi(CLE_T(r.ref), nouv, b.maj)) continue;
    const err = await apresRendu(nouv).then(() => null, e => e);
    if (err) {
      console.error("relais : suite du compte rendu", r.ref, err.message);
      // marques non posées sur la commande : l'agent garde son compte rendu et le rejoue (branche « déjà rendue »)
      if (etat === "envoyee" && nouv.source === "site") return { ok: false, code: "reessayer" };
    }
    return { ok: true, etat };
  }
  return { ok: false, code: "reessayer" };
}

async function apresRendu(t) {
  if (t.source === "site") {
    if (t.etat === "envoyee") await marquerCommande(t);
    else if (LIBERES.has(t.etat)) await libererLignes(t);
    // incertaine : lignes gardées (bloquées) jusqu'à la vérification humaine
    await journalPml(t);
  }
  // 403 = l'adresse du bureau n'est plus autorisée (changement chez le fournisseur d'accès ?) : tous les
  // envois échoueraient ; pause générale + alerte plutôt que N refus à reprendre à la main
  if (t.etat === "refusee" && Number(t.resultat?.http) === 403) {
    await kvSet("pmlr:pause", { at: maintenant(), motif: `PharmaML refuse les envois du bureau (HTTP 403, réf. ${t.ref}) : adresse IP du bureau changée ?` }).catch(() => {});
    await alerter("pause", "Relais PharmaML en pause : envois refusés (403)",
      `PharmaML a refusé un envoi venant du Mac du bureau (HTTP 403, référence ${t.ref}). Tous les envois sont suspendus : vérifiez l'adresse IP du bureau auprès d'InfoSoft, puis « Reprendre les envois » dans l'admin (onglet Commandes). Les commandes en attente restent à synchroniser.`).catch(() => {});
  }
  if (t.etat === "incertaine") await kvSet(CLE_V(t.ref), { ref: t.ref, source: t.source, at: maintenant() }).catch(() => {});
  else await kvDel(CLE_V(t.ref)).catch(() => {});
  // Sanofi Pro alerte et décide lui-même (onglet Sanofi Pro) ; ici, les commandes du site
  if (t.source === "site" && t.etat === "incertaine") await alerteIncertaine(t).catch(() => {});
  if (t.source === "site" && t.etat === "refusee" && Number(t.resultat?.http) !== 403) await alerter(`refus:${t.ref}`, `Relais PharmaML : envoi ${t.ref} refusé`,
    `PharmaML a refusé l'envoi ${t.ref}${t.pharmacie ? ` (${t.pharmacie})` : ""} : ${t.message}. Rien n'a été créé ; les lignes sont de nouveau à synchroniser (admin, onglet Commandes).`, 24 * 365).catch(() => {});
}
const alerteIncertaine = (t) => alerter(`incertaine:${t.ref}`, `Relais PharmaML : envoi ${t.ref} à vérifier`,
  `L'envoi ${t.ref}${t.pharmacie ? ` (${t.pharmacie})` : ""} a une issue inconnue : ${t.message}. Vérifiez sur le portail PharmaML (référence ${t.ref}) s'il est arrivé AVANT toute nouvelle saisie. Admin, onglet Commandes : « vérifié : pas dans PharmaML » rend les lignes à la synchro, « vérifié : arrivé dans PharmaML » les marque envoyées.`, 24 * 365);

async function journalPml(t) {
  const outcome = { envoyee: "transmise", refusee: "refusee", non_envoyee: "non_envoyee", incertaine: "incertaine" }[t.etat] || t.etat;
  await sb("kv_store", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key: `pml:${t.orderId}:${Date.now()}`, updated_at: maintenant(),
    value: JSON.stringify({ ts: maintenant(), via: `relais-${String(t.creePar || "").startsWith("auto") ? "auto" : "admin"}`, orderId: t.orderId, reference: t.ref, pharmacy: t.pharmacie, cip: t.cip,
      lignes: (t.idx || []).length, outcome, http: t.resultat?.http ?? null, ms: t.resultat?.ms ?? null, pharmaml: t.message || null }) } }).catch(() => {});
}

// lignes envoyées marquées sur la commande du site (même format que la synchro admin : synced_at, synced_ref)
async function marquerCommande(t) {
  for (let essai = 0; essai < 3; essai++) {
    const [o] = (await sb(`elixir_orders?id=eq.${encodeURIComponent(t.orderId)}&select=id,items,processed`)) || [];
    if (!o) return;
    const its = items(o);
    let change = false;
    t.idx.forEach((i, k) => {
      const it = its[i];
      if (!it || String(it.cip || "") !== String(t.cips?.[k] ?? it.cip ?? "")) return;     // ligne déplacée : pas touchée
      if (it.synced_at && it.synced_ref === t.ref) return;
      its[i] = { ...it, synced_at: t.renduA, synced_ref: t.ref }; change = true;
    });
    if (!change) return;
    const processed = !!o.processed || its.every(lineDone);    // jamais de « traitée » → « en attente »
    await sb(`elixir_orders?id=eq.${encodeURIComponent(t.orderId)}`, { method: "PATCH", prefer: "return=minimal", body: { items: its, processed } });
    const [v] = (await sb(`elixir_orders?id=eq.${encodeURIComponent(t.orderId)}&select=items`)) || [];
    if (t.idx.every(i => items(v)[i]?.synced_ref === t.ref || !items(v)[i])) return;
  }
  throw new Error(`marques d'envoi non enregistrées sur la commande ${t.orderId}`);
}

// ── Commandes du site ───────────────────────────────────────────────────
const lireCommande = async (id) => (await sb(`elixir_orders?id=eq.${encodeURIComponent(id)}&select=id,date,items,processed,pharmacy_cip,pharmacy_email,pharmacy_name,source,entered_by`))?.[0] || null;

// tâche d'envoi pour des lignes d'une commande du site (synchro admin, ou envoi automatique)
// → { ok:true, ref, lignes } | { ok:false, code, error, ... }
export async function envoyerCommande({ orderId, idx = null, par, auto = false, cipVerifie = null }) {
  if (!/^\d{6,20}$/.test(String(orderId || ""))) return { ok: false, code: "id", error: "numéro de commande invalide" };
  const o = await lireCommande(orderId);
  if (!o) return { ok: false, code: "introuvable", error: "commande introuvable" };
  const its = items(o);
  let cand = (Array.isArray(idx) ? idx.map(Number) : its.map((_, i) => i)).filter(i => Number.isInteger(i) && i >= 0 && i < its.length && !lineDone(its[i]));
  cand = [...new Set(cand)];
  if (!cand.length) return { ok: false, code: "rien", error: "aucune ligne à envoyer (déjà envoyées ou traitées)" };
  // lignes déjà réservées (tâche en cours, envoyée, à vérifier, ou en cours de création) : écartées.
  // Une erreur de lecture arrête tout (jamais « libre » par défaut) ; une réservation n'est libérée que si sa
  // tâche est finie sans envoi, ou si elle est orpheline depuis 5 min (requête morte), et seulement si elle
  // n'a pas changé depuis la lecture.
  const prises = [];
  for (const i of cand) {
    const bl = await kvGetBrut(CLE_L(o.id, i));
    const c = bl?.value;
    if (!c) continue;
    const t = await lireTache(c.ref);
    // réservation dont la tâche ne contient pas cette ligne (synchro concurrente perdante) : orpheline elle aussi
    const etrangere = !t || t.orderId !== String(o.id) || !(t.idx || []).map(Number).includes(i);
    const liberable = (t && !etrangere && LIBERES.has(t.etat)) || (etrangere && Date.now() - Date.parse(c.at || 0) > ORPHELINE_MS);
    if (liberable && await supprimerSi(CLE_L(o.id, i), bl.maj)) continue;
    prises.push({ i, ref: c.ref, etat: t ? t.etat : "mise en file en cours" });
  }
  cand = cand.filter(i => !prises.some(p => p.i === i));
  if (!cand.length) return { ok: false, code: "deja", error: `lignes déjà en cours d'envoi ou envoyées (réf. ${[...new Set(prises.map(p => p.ref))].join(", ")} : ${[...new Set(prises.map(p => p.etat))].join(", ")})`, prises };
  // CIP de la pharmacie : celui de la commande (vérifié par le jeton pour un envoi automatique)
  let cip = String(o.pharmacy_cip || "").trim();
  if (cipVerifie && cip !== String(cipVerifie)) return { ok: false, code: "identite", error: "CIP de la commande différent de celui de la pharmacie connectée" };
  if (!/^\d{7}$/.test(cip)) {
    if (auto) return { ok: false, code: "cip", error: "commande sans CIP de pharmacie" };
    // synchro admin (décision humaine) : comme avant, CIP retrouvé par l'adresse e-mail de la commande
    const em = String(o.pharmacy_email || "").trim().toLowerCase();
    const [p] = em ? ((await sb(`elixir_pharmacies?email=eq.${encodeURIComponent(em)}&select=cip&limit=1`).catch(() => [])) || []) : [];
    cip = String(p?.cip || "").trim();
    if (!/^\d{7}$/.test(cip)) return { ok: false, code: "cip", error: `CIP introuvable pour ${em || "cette commande"} : à saisir à la main` };
    await sb(`elixir_orders?id=eq.${encodeURIComponent(o.id)}`, { method: "PATCH", prefer: "return=minimal", body: { pharmacy_cip: cip } }).catch(() => {});
  }
  // référence : id au premier envoi, puis idP<n> (n = nombre de références déjà utilisées + 1)
  const dejaRefs = new Set([...its.map(it => it?.synced_ref).filter(Boolean), ...(await kvList(`pmlr:tache:${o.id}`, 200).catch(() => [])).map(r => r.key.slice("pmlr:tache:".length))]);
  const moi = randomUUID();          // réservations de CET appel (jamais celles d'une autre synchro, même réf.)
  for (let essai = 0; essai < 4; essai++) {
    const n = dejaRefs.size;
    const ref = n === 0 ? String(o.id) : `${o.id}P${n + 1}`;
    if (dejaRefs.has(ref)) { dejaRefs.add(`${ref}#`); continue; }
    // réservation des lignes (création seule) ; une ligne réservée ailleurs entre-temps → tout est rendu
    const prisesIci = [];
    let conflit = null;
    for (const i of cand) {
      if (await kvCreate(CLE_L(o.id, i), { ref, moi, cip: String(its[i]?.cip || ""), at: maintenant() })) prisesIci.push(i);
      else { conflit = i; break; }
    }
    const rendreLignes = async () => { for (const i of prisesIci) { const b = await kvGetBrut(CLE_L(o.id, i)).catch(() => null); if (b?.value?.ref === ref && b.value.moi === moi) await supprimerSi(CLE_L(o.id, i), b.maj).catch(() => {}); } };
    if (conflit !== null) { await rendreLignes(); return { ok: false, code: "deja", error: "une ligne vient d'être mise en envoi par ailleurs : actualisez" }; }
    const sel = cand.map(i => its[i]);
    const corps = corpsSite(cip, ref, sel);
    let r;
    try {
      r = await mettreEnFile({ ref, source: "site", corps, cip, pharmacie: o.pharmacy_name || null, orderId: String(o.id), idx: cand,
        cips: sel.map(it => String(it?.cip || "")), creePar: par, priseMs: auto ? PRISE_SITE_MS : PRISE_ADMIN_MS });
    } catch (e) {
      // création peut-être enregistrée malgré l'erreur (réponse perdue) : relue avant de rendre les lignes
      // jamais de lignes rendues ici : l'insertion peut encore aboutir après cette relecture ; sans tâche au bout
      // de 5 min, les réservations deviennent orphelines et sont libérées
      const t = await lireTache(ref).catch(() => undefined);
      if (t && t.orderId === String(o.id) && t.empreinte === empreinte(corps)) {
        if (t.etat === "a_envoyer") await kvSet(CLE_F(ref), { ref, creeA: t.creeA }).catch(() => {});
        return { ok: true, ref, lignes: cand.length, idx: cand, ecartees: prises };
      }
      if (t) await rendreLignes();   // une autre tâche porte cette référence (création seule) : la nôtre n'existe pas
      throw e;
    }
    if (r.ok) return { ok: true, ref, lignes: cand.length, idx: cand, ecartees: prises };
    await rendreLignes();
    dejaRefs.add(ref);
  }
  return { ok: false, code: "reference", error: "aucune référence PharmaML libre pour cette commande" };
}

// Quantités par CIP qui partent déjà par le relais sans être encore réservées dans Odoo : tâches en cours ou à
// vérifier, et envoyées depuis moins de 20 min (le connecteur les importe en ~4 min). sauf : source ignorée
// (Sanofi Pro compte déjà ses propres envois).
export async function enVolRelais({ sauf = null } = {}) {
  const m = new Map();
  for (const t of (await kvList("pmlr:tache:", 400).catch(() => [])).map(r => r.value)) {
    if (!t || t.source === "test" || t.source === sauf || !(Date.now() - Date.parse(t.creeA) < 3 * 3600e3)) continue;
    if (!(["a_envoyer", "prise", "incertaine"].includes(t.etat) || (t.etat === "envoyee" && Date.now() - Date.parse(t.renduA) < 20 * 60e3))) continue;
    for (const l of t.corps?.[0]?.lignes || []) m.set(String(l.CIP), (m.get(String(l.CIP)) || 0) + (Number(l.quantiteCommandee) || 0));
  }
  return m;
}
// Stock libre Odoo (société d'Elixir) par CIP, moins ce qui part déjà par le relais (site et Sanofi Pro)
async function stockLibre(cips) {
  const out = new Map();
  for (const cip of cips) {
    const champs = ["id", "free_qty", "qty_available"];
    const ctx = { allowed_company_ids: [COMPANY_ID], company_id: COMPANY_ID };
    let [p] = await odoo("product.product", "search_read", [[["barcode", "=", cip]]], { fields: champs, limit: 1, context: ctx });
    if (!p) [p] = await odoo("product.product", "search_read", [[["default_code", "=", cip]]], { fields: champs, limit: 1, context: ctx });
    out.set(cip, p ? Number(p.free_qty ?? p.qty_available ?? 0) : 0);
  }
  for (const [cip, q] of await enVolRelais()) if (out.has(cip)) out.set(cip, out.get(cip) - q);
  return out;
}

// Envoi automatique d'une commande du site juste après son enregistrement (appelé par submit-order avec
// le jeton de la pharmacie, ou le jeton admin pour une saisie Elixir). Lignes en stock seulement ; tout
// le reste (et toute commande qui ne remplit pas les conditions) reste à la synchro manuelle.
export async function envoiAuto({ orderId, user }) {
  const cfg = await lireConfig();
  if (!cfg.autoSite) return { ok: false, code: "inactif", error: "envoi automatique désactivé : synchro manuelle" };
  const o = await lireCommande(orderId);
  if (!o) return { ok: false, code: "introuvable", error: "commande introuvable" };
  if ((o.source || "catalogue") !== "catalogue") return { ok: false, code: "source", error: `commande « ${o.source} » : synchro manuelle` };
  if (o.processed) return { ok: false, code: "traitee", error: "commande déjà traitée" };
  const creee = Date.parse(o.date);
  if (!(creee >= Date.parse(cfg.depuis || 0))) return { ok: false, code: "avant", error: "commande antérieure à l'activation de l'envoi automatique" };
  if (!(Date.now() - creee < AUTO_AGE_MAX_MS)) return { ok: false, code: "ancienne", error: "commande de plus de 30 min : synchro manuelle" };
  const cip = String(o.pharmacy_cip || "").trim();
  if (!/^\d{7}$/.test(cip)) return { ok: false, code: "cip", error: "commande sans CIP de pharmacie" };
  // Identité : connexion valide (jeton) ; à défaut (connexion expirée, page ancienne), la fiche, comme la synchro
  // manuelle (décision de Zineb, 15/10/2026) : saisie Elixir (entered_by n'est posé par order-save qu'après
  // vérification de la session admin), ou e-mail de la commande associé à ce CIP dans la liste des pharmacies.
  let identite;
  if (user?.isAdmin) {
    if (!o.entered_by) return { ok: false, code: "identite", error: "commande non saisie par Elixir" };
    identite = "jeton admin";
  } else if (user?.cip) {
    if (String(user.cip) !== cip) return { ok: false, code: "identite", error: "commande d'une autre pharmacie que celle connectée" };
    identite = "jeton";
  } else if (o.entered_by) identite = "saisie Elixir";
  else {
    const em = String(o.pharmacy_email || "").trim();
    const lire = async (e) => (await sb(`elixir_pharmacies?email=eq.${encodeURIComponent(e)}&select=cip`).catch(() => null)) || [];
    const fiches = [...await lire(em.toLowerCase()), ...(em !== em.toLowerCase() ? await lire(em) : [])];
    if (!em || !fiches.some(f => String(f.cip || "").trim() === cip)) return { ok: false, code: "identite", error: "pharmacie non identifiée (connexion expirée et e-mail de la commande non associé à ce CIP) : synchro manuelle" };
    identite = "fiche";
  }
  const fiche = await fichePharmacie({ cip });
  if (!fiche || fiche.bloque) return { ok: false, code: "client", error: fiche ? "client bloqué dans Odoo" : "pas de fiche client Elixir pour ce CIP" };
  const its = items(o);
  // même pharmacie, mêmes lignes en moins de 2 h (double clic, deux onglets, deux domaines) : à vérifier. Ligne « péremption
  // courte » marquée (:per) : sa commande à part (site, separerPeremption) n'est pas le double de la commande qui porte le même
  // produit à la même quantité au prix du menu ; un vrai double de l'une ou de l'autre garde la même empreinte qu'elle
  const sig = createHash("sha256").update(its.map(i => `${i?.cip}x${parseInt(i?.qty) || 0}${i?.peremption ? ":per" : ""}`).sort().join("+")).digest("hex").slice(0, 24);
  const cleE = `pmlr:empreinte:${cip}:${sig}`;
  const double = async (error, doubleDe) => { await kvSet(`pmlr:avis:${o.id}`, { code: "double", error, doubleDe, at: maintenant() }).catch(() => {}); return { ok: false, code: "double", error }; };
  if (!await kvCreate(cleE, { orderId: String(o.id), at: maintenant() })) {
    const prev = await kvGetBrut(cleE);
    if (prev?.value?.orderId !== String(o.id)) {
      if (Date.now() - Date.parse(prev?.value?.at || 0) < DOUBLE_MS)
        return double(`commande identique à la n° ${prev.value.orderId} passée ${Math.round((Date.now() - Date.parse(prev.value.at)) / 60e3)} min plus tôt : à vérifier, synchro manuelle`, prev.value.orderId);
      // panier identique à une commande ancienne : la marque est reprise par une écriture conditionnelle (deux envois simultanés : un seul passe)
      if (!await majSi(cleE, { orderId: String(o.id), at: maintenant() }, prev.maj)) return double("commande identique passée au même moment : à vérifier, synchro manuelle", null);
    }
  }
  // lignes en stock (stock libre Odoo, cumulé si un même CIP apparaît deux fois) ; les autres restent à la main
  const valides = its.map((it, i) => ({ it, i })).filter(({ it }) => !lineDone(it) && /^\d{13}$/.test(String(it?.cip || "")) && (parseInt(it?.qty) || 0) >= 1);
  const libre = await stockLibre([...new Set(valides.map(v => String(v.it.cip)))]);
  const enStock = [];
  for (const { it, i } of valides) {
    const q = parseInt(it.qty);
    const l = libre.get(String(it.cip)) ?? 0;
    if (l >= q) { enStock.push(i); libre.set(String(it.cip), l - q); }
  }
  if (!enStock.length) return { ok: false, code: "precommande", error: "aucune ligne en stock : synchro manuelle" };
  const r = await envoyerCommande({ orderId: o.id, idx: enStock, par: user?.isAdmin ? `auto-saisie:${user.email || "admin"}` : o.entered_by ? `auto-saisie:${o.entered_by}` : "auto", auto: true, cipVerifie: cip });
  return r.ok ? { ...r, retenues: its.length - enStock.length, identite } : { ...r, identite };
}

// ── Lecture pour l'admin ────────────────────────────────────────────────
export const resumeTache = (t) => t && ({ ref: t.ref, source: t.source, etat: t.etat, orderId: t.orderId || null, idx: t.idx || null, pharmacie: t.pharmacie || null,
  creeA: t.creeA, creePar: t.creePar, priseAvant: t.priseAvant, priseA: t.priseA || null, renduA: t.renduA || null, message: t.message || null,
  http: t.resultat?.http ?? null, commandes: t.commandes ?? null, tentative: t.tentative || 1, agent: t.agent || null });
export async function tachesDeCommandes(ids) {
  const out = {};
  for (const id of ids) {
    const ts = (await kvList(`pmlr:tache:${id}`, 50).catch(() => [])).map(r => r.value).filter(t => t?.orderId === String(id));
    if (ts.length) out[id] = ts.sort((a, b) => String(a.creeA).localeCompare(String(b.creeA))).map(resumeTache);
  }
  return out;
}
export async function statut() {
  const [agent, pause, cfg, file] = await Promise.all([kvGet("pmlr:agent").catch(() => null), kvGet("pmlr:pause").catch(() => null), lireConfig(), kvList("pmlr:file:", 200).catch(() => [])]);
  const recentes = (await kvList("pmlr:tache:", 60).catch(() => [])).map(r => r.value).filter(Boolean);
  const aVerifier = [];
  for (const v of await kvList("pmlr:averifier:", 200).catch(() => [])) {
    const t = await lireTache(v.value?.ref).catch(() => null);
    if (t?.etat === "incertaine" && t.source === "site") aVerifier.push(resumeTache(t));
  }
  return { agent, pause, config: cfg, enFile: file.length, aVerifier, recentes: recentes.slice(0, 30).map(resumeTache) };
}
// vérification humaine faite (référence absente du portail PharmaML) : lignes rendues à la synchro manuelle
export async function libererApresVerification(ref, par) {
  const b = await kvGetBrut(CLE_T(ref));
  const t = b?.value;
  if (!t) return { ok: false, error: "tâche introuvable" };
  if (t.etat !== "incertaine") return { ok: false, error: `tâche « ${t.etat} » : rien à libérer` };
  if (t.sansCompteRendu) {
    // l'agent ne reprend une tâche qu'après avoir fini la précédente : un contact postérieur à la prise prouve que
    // cet envoi est terminé (sinon le Mac, en veille par exemple, peut encore l'envoyer à son réveil)
    const ag = await kvGet("pmlr:agent").catch(() => null);
    if (!(Date.parse(ag?.vuA) > Date.parse(t.priseA))) return { ok: false, error: "l'agent du Mac n'a plus contacté le site depuis qu'il a pris cet envoi : il peut encore l'envoyer à son réveil. Réveillez le Mac, attendez quelques minutes, puis revérifiez." };
  } else {
    // délai ou erreur du serveur PharmaML : la commande peut encore être créée quelques minutes après
    const depuis = Date.now() - Date.parse(t.resultat?.envoyeA || t.priseA || t.renduA);
    if (depuis < 10 * 60e3) return { ok: false, error: `trop tôt : PharmaML peut encore créer ${ref}. Revérifiez le portail après ${new Date(Date.parse(t.resultat?.envoyeA || t.priseA || t.renduA) + 10 * 60e3).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}.` };
  }
  const nouv = { ...t, etat: "non_envoyee", verifieePar: par, verifieeA: maintenant() };
  histo(nouv, "non_envoyee", "vérifiée absente de PharmaML", par);
  if (!await majSi(CLE_T(ref), nouv, b.maj)) return { ok: false, error: "modifiée entre-temps : actualisez" };
  await kvDel(CLE_V(ref)).catch(() => {});
  await libererLignes(nouv);
  return { ok: true, tache: resumeTache(nouv) };
}

// vérification humaine faite (référence PRÉSENTE sur le portail PharmaML) : envoi constaté, lignes marquées envoyées
export async function confirmerApresVerification(ref, par) {
  const b = await kvGetBrut(CLE_T(ref));
  const t = b?.value;
  if (!t) return { ok: false, error: "tâche introuvable" };
  if (t.etat === "envoyee" && t.source === "site") { await marquerCommande(t); return { ok: true, tache: resumeTache(t) }; }   // marques rejouées
  if (t.etat !== "incertaine") return { ok: false, error: `tâche « ${t.etat} » : rien à confirmer` };
  const nouv = { ...t, etat: "envoyee", renduA: maintenant(), verifieePar: par, verifieeA: maintenant(), message: "vérifiée présente dans PharmaML", sansCompteRendu: false };
  histo(nouv, "envoyee", "vérifiée présente dans PharmaML", par);
  if (!await majSi(CLE_T(ref), nouv, b.maj)) return { ok: false, error: "modifiée entre-temps : actualisez" };
  await kvDel(CLE_V(ref)).catch(() => {});
  if (nouv.source === "site") { await marquerCommande(nouv); await journalPml(nouv); }
  return { ok: true, tache: resumeTache(nouv) };
}

// ── Surveillance (fonction planifiée) ───────────────────────────────────
async function alerter(cle, sujet, texte, heures = ALERTE_H) {
  const k = `pmlr:alerte:${cle}`;
  const der = await kvGet(k).catch(() => null);
  if (der?.at && Date.now() - Date.parse(der.at) < heures * 3600e3) return false;
  const cfg = await lireConfig();
  const to = String(cfg.alertes || "").split(/[\s,;]+/).filter(Boolean).join(", ");
  const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt"><p>Bonjour,</p><p>${esc(texte)}</p>
<p style="color:#64748b;font-size:9pt">Relais PharmaML (agent du Mac du bureau) — admin du site de commande, onglet « Commandes ».</p></div>`;
  const id = await odoo("mail.mail", "create", [{ subject: sujet, body_html: corps, email_from: MAIL_DE, email_to: to, auto_delete: false }]);
  await odoo("mail.mail", "send", [[id]]);
  await kvSet(k, { at: maintenant() });
  return true;
}
const heureParis = (d = new Date()) => Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(d));
const jourSemaine = (d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short" }).format(d);
export async function surveiller() {
  const journal = [];
  // 1. tâches non prises à l'échéance : expirées (rien n'est parti ; lignes rendues à la synchro manuelle)
  for (const f of await kvList("pmlr:file:", 500).catch(() => [])) {
    const ref = f.key.slice("pmlr:file:".length);
    const t = await lireTache(ref).catch(() => null);
    if (t?.etat === "a_envoyer" && Date.now() > Date.parse(t.priseAvant)) { const r = await expirer(ref); if (r.ok) journal.push(`${ref} expirée (agent injoignable)`); }
    else if (t && t.etat !== "a_envoyer") await kvDel(f.key).catch(() => {});
  }
  // index de file manquant (écriture perdue) : réparé
  const recentes = (await kvList("pmlr:tache:", 300).catch(() => [])).map(r => r.value).filter(Boolean);
  for (const t of recentes.filter(t => t.etat === "a_envoyer")) {
    if (Date.now() > Date.parse(t.priseAvant)) { await expirer(t.ref); continue; }
    if (await kvGet(CLE_F(t.ref)).catch(() => null)) continue;
    // tâche sans index (écriture perdue) : remise en file seulement si ses lignes lui sont toujours réservées
    let siennes = true;
    if (t.source === "site") for (const i of t.idx || []) { const c = await kvGet(CLE_L(t.orderId, i)).catch(() => undefined); if (c?.ref !== t.ref) { siennes = false; break; } }
    if (siennes) await kvSet(CLE_F(t.ref), { ref: t.ref, creeA: t.creeA }).catch(() => {});
    else { await expirer(t.ref); journal.push(`${t.ref} : lignes réservées ailleurs, tâche retirée`); }
  }
  // marques d'envoi des commandes du site rejouées (échec passager lors du compte rendu)
  for (const t of recentes.filter(t => t.etat === "envoyee" && t.source === "site" && Date.now() - Date.parse(t.renduA) < 24 * 3600e3)) await marquerCommande(t).catch(() => {});
  // 2. agent muet (tâches en attente, ou heures ouvrées) / tâches qui attendent / prises sans compte rendu
  const agent = await kvGet("pmlr:agent").catch(() => null);
  const silenceMin = agent?.vuA ? (Date.now() - Date.parse(agent.vuA)) / 60e3 : Infinity;
  const enAttente = recentes.filter(t => t.etat === "a_envoyer");
  const ouvre = jourSemaine() !== "Sun" && heureParis() >= 7 && heureParis() < 20;
  if (silenceMin > 10 && (enAttente.length || ouvre)) {
    const ok = await alerter("agent", "Relais PharmaML : l'agent du Mac ne répond plus",
      `L'agent PharmaML du Mac du bureau n'a pas contacté le site depuis ${Number.isFinite(silenceMin) ? `${Math.round(silenceMin)} min` : "son installation"}${enAttente.length ? ` ; ${enAttente.length} envoi(s) attendent` : ""}. Vérifiez que le Mac est allumé et connecté. Sans agent, aucune commande ne part vers PharmaML ; les envois non pris dans les délais reviennent à la synchro manuelle.`).catch(() => false);
    if (ok) journal.push("alerte : agent muet");
  }
  // prise sans compte rendu (réponse perdue, agent arrêté au milieu d'un envoi) : issue inconnue, vérification humaine
  // (lignes gardées bloquées ; un compte rendu tardif de l'agent reste accepté)
  for (const t0 of recentes.filter(t => t.etat === "prise" && Date.now() - Date.parse(t.priseA) > SANS_CR_MS)) {
    const b = await kvGetBrut(CLE_T(t0.ref)).catch(() => null);
    const t = b?.value;
    if (t?.etat !== "prise") continue;
    const nouv = { ...t, etat: "incertaine", sansCompteRendu: true, renduA: maintenant(), message: "prise par l'agent du Mac sans compte rendu (réponse perdue ou agent interrompu) : vérifiez PharmaML" };
    histo(nouv, "incertaine", nouv.message);
    if (await majSi(CLE_T(t.ref), nouv, b.maj)) { await apresRendu(nouv).catch(() => {}); journal.push(`${t.ref} : sans compte rendu → à vérifier`); }
  }
  // alertes non parties (Odoo injoignable…) : réessayées (une seule fois réussie par envoi ; pause : rappel toutes les 2 h)
  for (const v of await kvList("pmlr:averifier:", 200).catch(() => [])) {
    const t = await lireTache(v.value?.ref).catch(() => null);
    if (t?.etat === "incertaine" && t.source === "site") await alerteIncertaine(t).catch(() => {});
  }
  const pause = await kvGet("pmlr:pause").catch(() => null);
  if (pause?.at) await alerter("pause", "Relais PharmaML en pause : envois refusés (403)",
    `${pause.motif}. Tous les envois sont suspendus depuis le ${new Date(pause.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} : vérifiez l'adresse IP du bureau auprès d'InfoSoft (« 🔌 Tester » dans l'admin), puis « Reprendre les envois » (onglet Commandes).`).catch(() => {});
  return { journal, agent, enFile: enAttente.length };
}
