// ── Commandes sur justificatif labo : API (site + admin) ─────────────────
// GET  ?action=products                         → produits concernés (public : badge et règles au panier)
// POST { action: "rx_upload", name, mime, data_base64[, odoo_id] }      (pharmacie, ou admin en saisie)
// POST { action: "submit", order_id, lignes: [{ cip, attestation, renouvellement, rx: [id] }][, odoo_id] }
// POST { action: <admin> … }  (jeton admin) : config_get, config_save, list, send, ignore, reset,
//      preview, rx_get, test_mail, test_portail, run, product_lookup
// Logique et règles : _lab-justif.js
import { getCors } from "./cors.js";
import { verifyAdmin, verifyTokenAsync } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import {
  sb, kvGet, kvSet, kvList, lireConfig, ecrireConfig, indexProduits, fichePharmacie, construireMail,
  enregistrerOrdonnance, RX_MIMES, RX_MAX_B64, envoyerTest, testPortail, CONFIG_DEFAUT,
} from "./_lab-justif.js";

const SITE_HOSTS = ["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"];
const siteBase = (event) => { const h = String(event?.headers?.host || "").toLowerCase();
  return `https://${SITE_HOSTS.includes(h) || /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/.test(h) ? h : SITE_HOSTS[0]}`; };
// Envoi en arrière-plan (fonction de 15 min) ; à défaut, le passage planifié (10 min) s'en charge
export async function lancerEnvois(event, { detecter = false } = {}) {
  if (!process.env.CRON_SECRET) return false;
  const r = await fetch(`${siteBase(event)}/.netlify/functions/lab-justif-background`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET }, body: JSON.stringify({ detecter }),
  }).catch(() => null);
  return !!r && (r.ok || r.status === 202);
}

// erreur de saisie ou d'état (400), distincte d'une panne (500)
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const ADMIN_ACTIONS = new Set(["config_get", "config_save", "list", "send", "ignore", "preview", "rx_get", "test_mail", "test_portail", "run", "product_lookup"]);
const sansRx = (r) => ({ ...r, rx: (r.rx || []).map(x => ({ id: x.id, name: x.name })) });

// Qui commande : pharmacie connectée (jeton vérifié), ou admin en saisie pour une fiche Odoo
async function demandeur(event, b) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  const u = tok ? await verifyTokenAsync(tok) : null;
  if (!u) return null;
  if (u.isAdmin) return { odooId: /^\d+$/.test(String(b.odoo_id || "")) ? String(b.odoo_id) : null, admin: u.email || "admin", emails: null };
  const mail = String(u.email || "").toLowerCase();
  const [p] = (await sb(`elixir_pharmacies?email=eq.${encodeURIComponent(mail)}&select=odoo_id,cip&limit=1`)) || [];
  if (!p) return null;
  let oid = p.odoo_id ? String(p.odoo_id) : null;
  if (!oid && p.cip) { const f = await fichePharmacie({ cip: p.cip }).catch(() => null); if (f) oid = String(f.odooId); }   // compte non relié à sa fiche
  if (!oid) return { odooId: null, admin: null, emails: [mail], sansFiche: true };
  const comptes = (await sb(`elixir_pharmacies?odoo_id=eq.${Number(oid)}&select=email`)) || [];
  return { odooId: oid, admin: null, emails: [...new Set([mail, ...comptes.map(c => String(c.email || "").toLowerCase())])] };
}

export const handler = async (event) => {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  try {
    if (event.httpMethod === "GET") {
      if ((event.queryStringParameters || {}).action !== "products") return json(400, { error: "action inconnue" });
      const cfg = await lireConfig();
      const products = {};
      for (const lab of Object.values(cfg.labs)) {
        if (lab.site === false) continue;
        for (const p of lab.produits || []) products[p.cip] = { lab: lab.key, labNom: lab.nom, delai: lab.delai || "", ordonnance: lab.ordonnance || "non",
          renouvellement: !!lab.renouvellement, maxCommande: Number(p.maxCommande) || null, dispo: 0 };
      }
      // stock d'Elixir : une ligne servie sur le stock ne passe pas par le labo
      const cips = Object.keys(products);
      for (let i = 0; i < cips.length; i += 100) {
        const rows = await sb(`odoo_catalog?cip=in.(${cips.slice(i, i + 100).join(",")})&select=cip,in_stock,available`).catch(() => []);
        for (const r of rows || []) if (products[r.cip]) products[r.cip].dispo = r.available != null ? Math.max(0, Math.floor(Number(r.available) || 0)) : (r.in_stock ? 9999 : 0);
      }
      // boîtes reçues pour une commande « justificatif » pas encore synchronisée (30 j) : déjà promises
      const depuisJ = new Date(Date.now() - 30 * 86400e3).toISOString();
      const jo = await sb(`elixir_orders?source=eq.justificatif&processed=eq.false&date=gte.${encodeURIComponent(depuisJ)}&select=items`).catch(() => []);
      for (const o of jo || []) {
        let it = o.items; if (typeof it === "string") { try { it = JSON.parse(it); } catch { it = []; } }
        for (const l of Array.isArray(it) ? it : [])
          if (products[l.cip] && !l.synced_at && !l.handled_at) products[l.cip].dispo = Math.max(0, products[l.cip].dispo - (parseInt(l.qty) || 0));
      }
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" }, body: JSON.stringify({ products }) };
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Méthode non autorisée" });
    const b = JSON.parse(event.body || "{}");

    // ── Admin ──
    if (ADMIN_ACTIONS.has(b.action)) {
      const auth = await verifyAdmin(event);
      if (auth.error) return auth.error;
      return json(200, await admin(b, event, auth.admin));
    }

    // ── Pharmacie (ou admin en saisie) ──
    const limited = rateLimit(event, 20, 60);
    if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
    const qui = await demandeur(event, b);
    if (!qui) return json(401, { error: "Session expirée : reconnectez-vous pour joindre une ordonnance ou transmettre la commande au laboratoire" });

    if (qui.sansFiche) return json(403, { error: "Votre compte n'est pas encore relié à votre fiche client Elixir : la commande sera transmise au laboratoire par Elixir" });
    if (b.action === "rx_upload") {
      if (!qui.odooId) return json(400, { error: "pharmacie non précisée" });
      const mime = String(b.mime || "");
      if (!RX_MIMES[mime]) return json(400, { error: "Format non accepté : PDF, JPEG ou PNG" });
      const data = String(b.data_base64 || "");
      if (!data || data.length > RX_MAX_B64) return json(413, { error: "Fichier trop lourd (3 Mo au plus) : photographiez ou numérisez en qualité normale" });
      if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return json(400, { error: "Fichier mal encodé : réessayez" });
      const id = await enregistrerOrdonnance({ owner: qui.odooId, name: b.name, mime, data_base64: data });
      return json(200, { id });
    }

    if (b.action === "submit") {
      const orderId = String(b.order_id || "");
      if (!/^\d{6,16}$/.test(orderId)) return json(400, { error: "commande invalide" });
      // select=* : la colonne facultative entered_by peut ne pas exister (sql/orders-entered-by.sql)
      const [o] = (await sb(`elixir_orders?id=eq.${orderId}&select=*&limit=1`)) || [];
      if (!o) return json(404, { error: "commande introuvable" });
      // la commande doit être celle de la pharmacie connectée ; l'admin : commande saisie par Elixir, ou
      // commande « justificatif » restée sans demande (reprise depuis l'admin)
      // saisie par Elixir pour une pharmacie (jeton admin + fiche choisie) : dite comme telle au labo
      const saisieAdmin = !!(qui.admin && qui.odooId);
      if (qui.admin) {
        if (!(o.entered_by || o.source === "justificatif")) return json(403, { error: "commande d'une autre pharmacie" });
        if (!qui.odooId) {   // reprise depuis l'admin : pharmacie retrouvée par son compte, sinon par son CIP
          const mail = String(o.pharmacy_email || "").toLowerCase();
          const [p] = mail ? (await sb(`elixir_pharmacies?email=eq.${encodeURIComponent(mail)}&select=odoo_id&limit=1`)) || [] : [];
          if (p?.odoo_id) qui.odooId = String(p.odoo_id);
          else if (o.pharmacy_cip) { const f = await fichePharmacie({ cip: o.pharmacy_cip }).catch(() => null); if (f) qui.odooId = String(f.odooId); }
          if (!qui.odooId) return json(400, { error: "pharmacie de la commande introuvable (ni compte du site ni CIP connu)" });
        }
      } else if (!qui.emails.includes(String(o.pharmacy_email || "").toLowerCase())) return json(403, { error: "commande d'une autre pharmacie" });
      const cfg = await lireConfig();
      const idx = indexProduits(cfg);
      let items = o.items;
      if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
      const infos = Object.fromEntries((Array.isArray(b.lignes) ? b.lignes : []).map(l => [String(l.cip), l]));
      const parLab = {};
      for (const it of Array.isArray(items) ? items : []) {
        const hit = idx[String(it.cip || "")];
        const qte = parseInt(it.qty) || 0;
        if (!hit || qte <= 0) continue;
        // attestation / ordonnances : envoyées par le site, sinon gardées dans la ligne de la commande (reprise admin)
        const info = infos[String(it.cip)] || (it.justif && typeof it.justif === "object" ? it.justif : {});
        const arr = (parLab[hit.lab.key] ||= []);
        const ex = arr.find(x => x.hit.produit.cip === hit.produit.cip);   // même CIP sur deux lignes : une seule ligne
        if (ex) ex.qte += qte; else arr.push({ it, hit, qte, info });
      }
      if (!Object.keys(parLab).length) return json(200, { demandes: [] });
      const ph = await fichePharmacie({ odooId: qui.odooId });
      const demandes = [], nouvelles = [];
      for (const [labKey, lignes] of Object.entries(parLab)) {
        const lab = cfg.labs[labKey];
        const id = `s-${orderId}-${labKey}`;
        if (await kvGet(`lj:req:${id}`)) { demandes.push({ id, deja: true }); continue; }
        // ordonnances : seulement celles déposées par cette pharmacie
        const rx = [];
        let rxPerdues = 0;
        for (const l of lignes) for (const rid of (Array.isArray(l.info.rx) ? l.info.rx : []).slice(0, 5)) {
          if (!/^[0-9a-f-]{36}$/i.test(String(rid)) || rx.some(x => x.id === rid)) continue;
          const f = await kvGet(`lj:rx:${rid}`);
          if (!f) rxPerdues++;                                             // effacée (dépôt de plus de 2 jours)
          else if (String(f.owner) === qui.odooId) rx.push({ id: rid, name: f.name });   // celle d'une autre pharmacie : écartée
        }
        const req = {
          id, lab: labKey, source: "site", orderId, reference: orderId, dateCommande: new Date(o.date || Date.now()).toISOString(),
          pharmacie: ph || { odooId: qui.odooId, nom: o.pharmacy_name || "", cip: o.pharmacy_cip || "" },
          email: o.pharmacy_email || null, saisiPar: o.entered_by || (saisieAdmin ? qui.admin : null),
          lignes: lignes.map(({ it, hit, qte, info }) => ({ cip: hit.produit.cip, odooId: hit.produit.odooId, produit: hit.produit.nom || it.name, court: hit.produit.court, qte,
            renouvellement: lab.renouvellement ? info.renouvellement === true : null })),
          attestation: lignes.every(l => l.info.attestation === true),
          renouvellement: lab.renouvellement ? lignes.every(l => l.info.renouvellement === true) : null,
          rx, statut: lab.actif ? "a_envoyer" : "en_attente", essais: 0, creeLe: new Date().toISOString(),
        };
        // contrôles : sinon la demande attend l'admin (rien ne part au labo)
        const motifs = [];
        if (!ph) motifs.push("fiche client Odoo introuvable");
        else if (!ph.cip) motifs.push("CIP absent de la fiche client Odoo");
        if (!req.attestation) motifs.push("attestation « patient en France » non cochée");
        if (lab.ordonnance === "obligatoire" && !rx.length) motifs.push("ordonnance anonymisée manquante");
        if (rxPerdues) motifs.push(`${rxPerdues} ordonnance(s) déposée(s) introuvable(s) (effacée après 2 jours sans commande) : à redemander à la pharmacie`);
        if (ph?.bloque) { req.statut = "bloquee"; req.motif = ["Client bloqué dans Odoo (champ CIP vide ou fiche archivée)", ...motifs].join(" ; "); }
        else if (motifs.length) { req.statut = "a_verifier"; req.motif = motifs.join(" ; "); }
        nouvelles.push(req);
        demandes.push({ id, statut: req.statut });
      }
      // toutes les demandes de la commande en une écriture : jamais une seule des deux (Takeda + Pfizer)
      if (nouvelles.length) await sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
        body: nouvelles.map(r => ({ key: `lj:req:${r.id}`, value: JSON.stringify(r), updated_at: new Date().toISOString() })) });
      if (demandes.some(d => d.statut === "a_envoyer")) await lancerEnvois(event);
      return json(200, { demandes });
    }
    return json(400, { error: "action inconnue" });
  } catch (e) {
    if (!e.status) console.error("lab-justif", e);
    return json(e.status || 500, { error: String(e.message || e).slice(0, 300) });
  }
};

// ── Actions admin ───────────────────────────────────────────────────────
async function admin(b, event, user) {
  const cfg = await lireConfig();
  const lire = async (id) => (await lireBrut(id)).value;
  // lecture brute (texte stocké) : l'écriture qui suit n'aboutit que si personne n'a modifié la demande entre-temps
  async function lireBrut(id) {
    if (!/^[\w.-]{3,120}$/.test(String(id || ""))) throw bad("demande invalide");
    const [row] = (await sb(`kv_store?key=eq.${encodeURIComponent(`lj:req:${id}`)}&select=key,value,updated_at&limit=1`)) || [];
    if (!row) throw bad("demande introuvable");
    return { key: row.key, maj: row.updated_at, value: typeof row.value === "string" ? JSON.parse(row.value) : row.value };
  }
  async function ecrireSi(raw, req) {
    const res = await sb(`kv_store?key=eq.${encodeURIComponent(raw.key)}&updated_at=eq.${encodeURIComponent(raw.maj)}`, { method: "PATCH", prefer: "return=representation",
      body: { value: JSON.stringify(req), updated_at: new Date().toISOString() } });
    if (!Array.isArray(res) || res.length !== 1) throw bad("la demande vient de changer : actualisez la liste");
  }
  switch (b.action) {
    case "config_get": return { config: cfg, defaut: CONFIG_DEFAUT };
    case "config_save": {
      const labs = b.config?.labs;
      if (!labs || typeof labs !== "object") throw bad("réglages invalides");
      const out = {};
      for (const [k, l] of Object.entries(labs)) {
        if (!/^[a-z0-9_-]{2,30}$/.test(k)) throw bad(`clé de laboratoire invalide : ${k}`);
        const avant = cfg.labs[k] || {};
        const produits = (Array.isArray(l.produits) ? l.produits : []).map(p => ({
          cip: String(p.cip || "").trim(), odooId: Number(p.odooId) || null, nom: String(p.nom || "").slice(0, 120),
          court: String(p.court || "").slice(0, 40), maxCommande: Number(p.maxCommande) || null, maxJour: Number(p.maxJour) || null,
          detection: p.detection !== false,
        })).filter(p => /^\d{7,13}$/.test(p.cip));
        // repérage PharmaML : un produit ajouté ou nouvellement suivi ne reprend que ses commandes postérieures
        // (sans toucher à la fenêtre des autres) ; la date du labo ne bouge que quand son repérage s'allume
        const avantP = Object.fromEntries((avant.produits || []).map(p => [p.cip, p]));
        const maintenantIso = new Date().toISOString();
        const labDejaSuivi = !!avant.detection && !!l.detection;
        for (const p of produits) {
          const a = avantP[p.cip];
          p.suiviDepuis = !p.detection || !labDejaSuivi ? null : (a && a.detection !== false ? (a.suiviDepuis || null) : maintenantIso);
        }
        if (new Set(produits.map(p => p.cip)).size !== produits.length) throw bad(`${l.nom || k} : un CIP apparaît deux fois`);
        const actif = !!l.actif;
        if (actif) {
          if (!String(l.a || "").includes("@")) throw bad(`${l.nom || k} : adresse du laboratoire manquante`);
          if (!Number(l.fournisseurId)) throw bad(`${l.nom || k} : fournisseur Odoo manquant`);
          const sansFiche = produits.filter(p => !p.odooId);
          if (sansFiche.length) throw bad(`${l.nom || k} : fiche Odoo manquante pour ${sansFiche.map(p => p.cip).join(", ")}`);
        }
        out[k] = {
          key: k, nom: String(l.nom || k).slice(0, 60), fournisseurId: Number(l.fournisseurId) || null, fournisseurNom: String(l.fournisseurNom || "").slice(0, 120),
          a: String(l.a || "").trim().slice(0, 300), cc: String(l.cc || "").trim().slice(0, 300),
          sujet: String(l.sujet || "").slice(0, 250), intro: String(l.intro || "").slice(0, 3000),
          ordonnance: ["non", "facultative", "obligatoire"].includes(l.ordonnance) ? l.ordonnance : "facultative",
          renouvellement: !!l.renouvellement, detection: !!l.detection, site: l.site !== false, delai: String(l.delai || "").slice(0, 200),
          antiRelanceJours: Math.max(0, Math.min(60, parseInt(l.antiRelanceJours ?? 7) || 0)),
          actif, depuis: actif ? (avant.actif && avant.depuis ? avant.depuis : new Date().toISOString()) : null,
          detectionDepuis: !l.detection ? null : !avant.detection ? maintenantIso : (avant.detectionDepuis || null),
          produits,
        };
      }
      // un même CIP ne peut dépendre que d'un labo
      const vus = {};
      for (const l of Object.values(out)) for (const p of l.produits) { if (vus[p.cip]) throw bad(`CIP ${p.cip} présent chez ${vus[p.cip]} et ${l.nom}`); vus[p.cip] = l.nom; }
      await ecrireConfig({ labs: out });
      return { config: await lireConfig() };
    }
    case "list": {
      const rows = (await kvList("lj:req:")).map(r => sansRx(r.value));
      rows.sort((a, c) => String(c.dateCommande).localeCompare(String(a.dateCommande)));
      return { demandes: rows.slice(0, 500), total: rows.length };
    }
    case "send": {
      // envoi demandé à la main : fait par la fonction d'arrière-plan (bon + PDF + mail dépassent les 10 s
      // d'une requête) ; « forcer » ne passe outre que le motif affiché à l'admin
      const raw = await lireBrut(b.id);
      const req = raw.value;
      if (req.statut === "envoye") throw bad("déjà envoyée");
      if (req.statut === "en_cours" && Date.now() - Date.parse(req.majLe || 0) < 15 * 60e3) throw bad("envoi en cours : actualisez dans une minute");
      if (req.mailId) {
        const [m] = await odoo("mail.mail", "search_read", [[["id", "=", req.mailId]]], { fields: ["state"] });
        if (m?.state === "cancel") await odoo("mail.mail", "write", [[req.mailId], { state: "exception" }]);
      }
      Object.assign(req, { statut: "a_envoyer", manuel: true, forcer: !!b.forcer, essais: 0, erreur: null, majLe: new Date().toISOString() });
      await ecrireSi(raw, req);
      const lance = await lancerEnvois(event);
      return { demande: sansRx(req), lance };
    }
    case "ignore": {
      const raw = await lireBrut(b.id);
      const req = raw.value;
      if (req.statut === "envoye") throw bad("déjà envoyée");
      if (req.statut === "en_cours" && Date.now() - Date.parse(req.majLe || 0) < 15 * 60e3) throw bad("envoi en cours : actualisez dans une minute");
      if (req.mailId) {   // mail créé mais pas parti : annulé dans Odoo (sinon la file d'Odoo pourrait l'envoyer)
        const [m] = await odoo("mail.mail", "search_read", [[["id", "=", req.mailId]]], { fields: ["state"] });
        if (m?.state === "sent") throw bad("le mail est déjà parti chez le laboratoire");
        if (m && m.state !== "cancel") await odoo("mail.mail", "write", [[req.mailId], { state: "cancel" }]);
      }
      Object.assign(req, { statut: "ignoree", motif: String(b.motif || "ignorée par l'admin").slice(0, 200), manuel: false, forcer: false, majLe: new Date().toISOString() });
      await ecrireSi(raw, req);
      return { demande: sansRx(req) };
    }
    case "preview": {
      const req = await lire(b.id);
      const lab = cfg.labs[req.lab];
      if (!lab) throw bad("laboratoire inconnu");
      const { sujet, corps } = construireMail(lab, req, req.poNom || "(n° du bon créé à l'envoi)");
      return { sujet: req.sujet || sujet, corps, a: req.destinataires?.a || lab.a, cc: req.destinataires?.cc ?? lab.cc };
    }
    case "rx_get": {
      if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ""))) throw bad("ordonnance invalide");
      const f = await kvGet(`lj:rx:${b.id}`);
      if (!f) throw bad("ordonnance introuvable (effacée après 90 jours)");
      return { name: f.name, mime: f.mime, data_base64: f.data_base64 };
    }
    case "test_mail": return await envoyerTest(cfg, b.lab, b.adresse || user?.email);
    case "test_portail": return { commandesDuJour: await testPortail() };
    case "run": {
      const lance = await lancerEnvois(event, { detecter: true });
      return { journal: [lance ? "Contrôle lancé en arrière-plan : actualisez la liste dans une minute" : "Lancement impossible : le passage planifié (10 min) s'en chargera"] };
    }
    case "product_lookup": {
      const cip = String(b.cip || "").trim();
      if (!/^\d{7,13}$/.test(cip)) throw bad("CIP invalide");
      const [p] = await odoo("product.product", "search_read", [["|", ["default_code", "=", cip], ["barcode", "=", cip]]],
        { fields: ["id", "name"], limit: 1, context: { allowed_company_ids: [COMPANY_ID] } });
      return p ? { odooId: p.id, nom: p.name } : { odooId: null };
    }
  }
  throw bad("action inconnue");
}
