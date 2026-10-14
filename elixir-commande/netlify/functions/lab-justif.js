// ── Commandes sur justificatif labo : API (site + admin) ─────────────────
// GET  ?action=products                         → produits concernés (public : badge et règles au panier)
// POST { action: "rx_upload", name, mime, data_base64[, odoo_id] }      (pharmacie, ou admin en saisie)
// POST { action: "submit", order_id, lignes: [{ cip, attestation, renouvellement, rx: [id] }][, odoo_id] }
// POST { action: "commander", order_id (13 chiffres, fourni par le site), lignes: [{ cip, qte, attestation, renouvellement, rx }][, odoo_id] }
//      → page « Commande labo sur justificatif » : commande enregistrée (source « justificatif ») + demandes au labo
// POST { action: "mes_demandes"[, odoo_id] } → demandes de la pharmacie (statuts, sans les ordonnances)
// POST { action: <admin> … }  (jeton admin) : config_get, config_save, list, send, ignore, reset,
//      preview, rx_get, test_mail, test_portail, run, product_lookup
// Logique et règles : _lab-justif.js
import { getCors } from "./cors.js";
import { verifyAdmin, verifyTokenAsync } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import {
  kvGetBrut, kvSetSi, kvCreate, frise, etatCommandeDemande, SUIVI_ETAPES, SUIVI_MANUELLES, MAIL_DE, esc,
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

// Suivi (kv lj:suivi:<id>) et commandes du site (lignes de chaque demande envoyées à PharmaML ?) pour des demandes
async function suivisEtCommandes(reqs) {
  const suivis = new Map((await kvList("lj:suivi:", 5000).catch(() => [])).map(r => [r.key.slice("lj:suivi:".length), r.value]));
  const ids = [...new Set(reqs.filter(r => r.source === "site" && /^\d+$/.test(String(r.orderId || ""))).map(r => String(r.orderId)))];
  const orders = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await sb(`elixir_orders?id=in.(${ids.slice(i, i + 100).join(",")})&select=id,processed,items`).catch(() => []);
    for (const o of rows || []) orders.set(String(o.id), o);
  }
  // état propre à chaque demande (ses lignes seulement)
  const commandes = new Map(reqs.map(r => [r.id, r.source === "site" ? etatCommandeDemande(r, orders.get(String(r.orderId))) : null]));
  return { suivis, commandes };
}
// champs de suivi d'une demande pour la liste admin
const enrichir = (r, suivis, commandes) => ({ suivi: frise(r, suivis.get(r.id), commandes.get(r.id)), suiviBrut: suivis.get(r.id)?.etapes || [],
  commande: commandes.get(r.id) || null });
// e-mail à la pharmacie quand Elixir met à jour le suivi (depuis pharmacien@, comme les autres e-mails)
async function mailSuivi(req, etape, commentaire, datePrevue) {
  const to = String(req.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) throw new Error("pas d'adresse e-mail pour cette pharmacie");
  const produits = (req.lignes || []).map(l => `${l.qte} × ${l.produit}`).join(", ");
  const dateFr = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:12pt;color:#000">
<p>Bonjour,</p>
<p>Votre commande sur justificatif laboratoire n° ${esc(req.orderId || req.reference)} (${esc(produits)}) : <b>${esc(SUIVI_ETAPES[etape])}</b>${datePrevue ? `, livraison prévue le ${esc(dateFr(datePrevue))}` : ""}.</p>
${commentaire ? `<p>${esc(commentaire).replace(/\n/g, "<br>")}</p>` : ""}
<p>Suivi de vos demandes : <a href="https://elixir-commande.expepharma.com/?outil=justificatif">site de commande Elixir, « Commande labo sur justificatif »</a>.</p>
<p>Cordialement,<br><b>Elixir Pharma</b><br>01 86 04 33 02</p></div>`;
  const id = await odoo("mail.mail", "create", [{ subject: `Elixir Pharma — votre commande n° ${req.orderId || req.reference} : ${SUIVI_ETAPES[etape]}`, body_html: corps,
    email_from: MAIL_DE, email_to: to, auto_delete: false }]);
  await odoo("mail.mail", "send", [[id]]);
  const [m] = await odoo("mail.mail", "read", [[id], ["state", "failure_reason"]]);
  if (m?.state !== "sent") throw new Error(`e-mail non parti : ${m?.failure_reason || m?.state || "état inconnu"}`);
  return to;
}
// prix net du site : prix remisé (liste n°5) s'il existe, sinon prix catalogue (comme la recherche et la saisie)
const prixNet = (r) => { const d = Number(r?.discounted_price), l = Number(r?.list_price);
  const v = Number.isFinite(d) && d > 0 ? d : Number.isFinite(l) && l > 0 ? l : null; return v != null ? Math.round(v * 100) / 100 : null; };
const quantites = (items) => { const m = {}; for (const i of items || []) if (i?.cip) m[i.cip] = (m[i.cip] || 0) + (parseInt(i.qty ?? i.qte) || 0); return m; };
const memeContenu = (a, b) => { const x = quantites(a), y = quantites(b); return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => x[k] === y[k]); };
// erreur de saisie ou d'état (400), distincte d'une panne (500)
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const ADMIN_ACTIONS = new Set(["config_get", "config_save", "list", "send", "ignore", "preview", "rx_get", "test_mail", "test_portail", "run", "product_lookup", "suivi"]);
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
          renouvellement: !!lab.renouvellement, maxCommande: Number(p.maxCommande) || null, maxJour: Number(p.maxJour) || null, dispo: 0,
          nom: p.nom || "", court: p.court || "", prix: null };
      }
      // stock d'Elixir : une ligne servie sur le stock ne passe pas par le labo
      const cips = Object.keys(products);
      for (let i = 0; i < cips.length; i += 100) {
        const rows = await sb(`odoo_catalog?cip=in.(${cips.slice(i, i + 100).join(",")})&select=cip,in_stock,available,discounted_price,list_price`).catch(() => []);
        for (const r of rows || []) if (products[r.cip]) {
          products[r.cip].dispo = r.available != null ? Math.max(0, Math.floor(Number(r.available) || 0)) : (r.in_stock ? 9999 : 0);
          products[r.cip].prix = prixNet(r);
        }
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

    // compte sans fiche Odoo : depuis le panier, la commande est déjà enregistrée (Elixir la transmettra) ;
    // depuis la page dédiée, rien n'est enregistré : le dire tel quel
    if (qui.sansFiche) return json(403, { sansFiche: true, error: b.action === "submit"
      ? "Votre compte n'est pas encore relié à votre fiche client Elixir : la commande sera transmise au laboratoire par Elixir"
      : "Votre compte n'est pas encore relié à votre fiche client Elixir : rien n'a été enregistré. Contactez Elixir pour commander ces produits." });
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
      return json(200, { demandes: await creerDemandes(o, b.lignes, qui, saisieAdmin, event) });
    }

    if (b.action === "commander") {
      const orderId = String(b.order_id || "");
      if (!/^\d{13}$/.test(orderId)) return json(400, { error: "commande invalide" });
      if (!qui.odooId) return json(400, { error: "pharmacie non précisée" });
      const cfg = await lireConfig();
      const idx = indexProduits(cfg);
      // lignes : produits « commandables sur le site », quantité entière, une ligne par produit
      const lignes = [];
      for (const l of Array.isArray(b.lignes) ? b.lignes.slice(0, 30) : []) {
        const cip = String(l?.cip || "");
        const hit = idx[cip];
        if (!hit || hit.lab.site === false) return json(400, { error: `produit non commandable sur justificatif : ${cip || "?"}` });
        const qte = Number(l.qte);
        const max = Number(hit.produit.maxCommande) || 20;
        if (!Number.isInteger(qte) || qte < 1 || qte > max) return json(400, { error: `${hit.produit.nom} : quantité entre 1 et ${max}` });
        if (lignes.some(x => x.cip === cip)) return json(400, { error: `${hit.produit.nom} : une seule ligne par produit` });
        lignes.push({ cip, qte, hit, attestation: l.attestation === true, renouvellement: l.renouvellement === true,
          rx: (Array.isArray(l.rx) ? l.rx : []).map(String).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5) });
      }
      if (!lignes.length) return json(400, { error: "aucun produit" });
      // renvoi après une coupure : la commande existe déjà → mêmes demandes (jamais une 2e commande)
      const [deja] = (await sb(`elixir_orders?id=eq.${orderId}&select=*&limit=1`)) || [];
      const ph = await fichePharmacie({ odooId: qui.odooId });
      if (!ph) return json(400, { error: "fiche client Elixir introuvable : contactez Elixir" });
      let email = qui.admin ? null : (qui.emails || [])[0] || null;
      if (qui.admin) { const [c] = (await sb(`elixir_pharmacies?odoo_id=eq.${Number(qui.odooId)}&select=email&limit=1`)) || []; email = c?.email || null; }
      if (deja) {
        const sienne = deja.source === "justificatif" && (qui.admin ? String(deja.pharmacy_cip || "") === String(ph.cip || "") : (qui.emails || []).includes(String(deja.pharmacy_email || "").toLowerCase()));
        if (!sienne) return json(409, { code: "numero", error: "numéro de commande déjà utilisé : réessayez" });
        let itemsDeja = deja.items; if (typeof itemsDeja === "string") { try { itemsDeja = JSON.parse(itemsDeja); } catch { itemsDeja = []; } }
        const enregistres = (Array.isArray(itemsDeja) ? itemsDeja : []).map(i => ({ cip: i.cip, name: i.name, qty: i.qty }));
        // renvoi après une coupure : seulement le même contenu (sinon les changements seraient perdus en silence)
        // demandes au labo de la commande enregistrée : créées si un envoi précédent a été interrompu (sans doublon)
        if (!memeContenu(enregistres, lignes)) await creerDemandes(deja, null, qui, !!qui.admin, event).catch(e => console.error("lab-justif réparation", e.message));
        if (!memeContenu(enregistres, lignes)) return json(409, { code: "contenu", items: enregistres,
          error: `Cette demande (n° ${orderId}) est déjà enregistrée avec un autre contenu : ${enregistres.map(i => `${i.qty} × ${i.name}`).join(", ")}` });
        return json(200, { order_id: orderId, deja: true, items: enregistres, demandes: await creerDemandes(deja, null, qui, !!qui.admin, event) });   // justificatif lu dans la commande enregistrée
      }
      // prix net et stock du catalogue (liste de prix Odoo n°5), comme le reste du site ; lecture en échec = erreur
      // (le site renvoie le même numéro : nouvel essai sans doublon)
      const prix = {}, stock = {};
      const rows = await sb(`odoo_catalog?cip=in.(${lignes.map(l => l.cip).join(",")})&select=cip,discounted_price,list_price,available`);
      for (const r of rows || []) { prix[r.cip] = prixNet(r); stock[r.cip] = Number(r.available) || 0; }
      for (const l of lignes) {
        if (prix[l.cip] == null) return json(400, { error: `${l.hit.produit.nom} : prix net introuvable, contactez Elixir` });
        if (stock[l.cip] >= l.qte) return json(400, { code: "stock", cip: l.cip, error: `${l.hit.produit.nom} est désormais en stock chez Elixir : retirez-le de la demande et commandez-le normalement (panier)` });
      }
      const items = lignes.map(l => {
        const pn = prix[l.cip] ?? null;
        return { cip: l.cip, name: l.hit.produit.nom, qty: l.qte, pn, total: pn != null ? Math.round(pn * l.qte * 100) / 100 : null,
          justif: { attestation: l.attestation, renouvellement: l.renouvellement, rx: l.rx } };
      });
      const row = { id: Number(orderId), date: new Date().toISOString(), pharmacy_name: ph.nom, pharmacy_email: email, pharmacy_cip: ph.cip || null,
        is_client: true, items, total_ht: Math.round(items.reduce((t, i) => t + (i.total || 0), 0) * 100) / 100, nb_lignes: items.length, csv: null,
        processed: false, source: "justificatif", ...(qui.admin ? { entered_by: qui.admin } : {}) };
      const inserer = async (r) => {
        try { await sb("elixir_orders", { method: "POST", prefer: "return=minimal", body: r }); return true; }
        catch (e) {
          if (/duplicate key|23505/.test(e.body || "")) return false;
          if (r.entered_by && /entered_by/.test(e.body || "")) { const { entered_by, ...rest } = r; return inserer(rest); }   // colonne pas encore créée
          throw e;
        }
      };
      if (!(await inserer(row))) return json(409, { error: "commande déjà enregistrée : rechargez la page" });
      const demandes = await creerDemandes(row, lignes, qui, !!qui.admin, event);
      // notification dans l'admin (comme une commande du site)
      sb("ec_notifications", { method: "POST", prefer: "return=minimal", body: { type: "new_order", title: `Commande labo sur justificatif de ${ph.nom}`,
        body: items.map(i => `${i.qty} × ${i.name}`).join(", ").slice(0, 200), data: { order_id: Number(orderId), pharmacy: ph.nom, total: row.total_ht }, read: false } }).catch(() => {});
      return json(200, { order_id: orderId, items: items.map(i => ({ cip: i.cip, name: i.name, qty: i.qty })), demandes });
    }

    if (b.action === "mes_demandes") {
      if (!qui.odooId) return json(400, { error: "pharmacie non précisée" });
      const labs = (await lireConfig()).labs;
      const reqs = (await kvList("lj:req:", 2000)).map(r => r.value).filter(r => String(r.pharmacie?.odooId || "") === String(qui.odooId) && r.source === "site");
      reqs.sort((a, c) => String(c.creeLe || c.dateCommande).localeCompare(String(a.creeLe || a.dateCommande)));
      const { suivis, commandes } = await suivisEtCommandes(reqs.slice(0, 100));
      return json(200, { demandes: reqs.slice(0, 100).map(r => ({ id: r.id, orderId: r.orderId, labNom: labs[r.lab]?.nom || r.lab, date: r.dateCommande, statut: r.statut,
        suivi: frise(r, suivis.get(r.id), commandes.get(r.id)),
        envoyeLe: r.envoyeLe || null, lignes: (r.lignes || []).map(l => ({ produit: l.produit, qte: l.qte })), rx: (r.rx || []).length,
        aCompleter: r.statut === "a_verifier" && /ordonnance/i.test(r.motif || "") ? "ordonnance" : null })) });
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
      const page = rows.slice(0, 500);
      const { suivis, commandes } = await suivisEtCommandes(page);
      return { demandes: page.map(r => ({ ...r, ...enrichir(r, suivis, commandes) })), total: rows.length };
    }
    case "suivi": {
      // mise à jour du suivi par Elixir (étape, message pour la pharmacie, date de livraison prévue, e-mail)
      const req = await lire(b.id);
      if (req.source !== "site") throw bad("suivi réservé aux commandes passées sur le site");
      const etape = String(b.etape || "");
      if (!SUIVI_MANUELLES.includes(etape)) throw bad("étape inconnue");
      const commentaire = String(b.commentaire || "").trim().slice(0, 600);
      const datePrevue = b.datePrevue ? String(b.datePrevue) : null;
      if (datePrevue && !(/^\d{4}-\d{2}-\d{2}$/.test(datePrevue) && Number.isFinite(Date.parse(datePrevue + "T00:00:00Z")) && new Date(datePrevue + "T00:00:00Z").toISOString().slice(0, 10) === datePrevue)) throw bad("date prévue invalide");
      const cle = `lj:suivi:${req.id}`;
      const ajout = { etape, at: new Date().toISOString(), par: user?.email || "admin", ...(commentaire ? { commentaire } : {}), ...(datePrevue ? { datePrevue } : {}) };
      const brut = await kvGetBrut(cle);
      const suivi = { etapes: [...(brut?.value?.etapes || []), ajout].slice(-30) };
      const ok = brut ? await kvSetSi(cle, suivi, brut.maj) : await kvCreate(cle, suivi);
      if (!ok) throw bad("le suivi vient d'être modifié : actualisez la liste");
      let mail = null;
      if (b.prevenir) { try { mail = { a: await mailSuivi(req, etape, commentaire, datePrevue) }; } catch (e) { mail = { erreur: e.message }; } }
      const [o] = /^\d+$/.test(String(req.orderId || "")) ? (await sb(`elixir_orders?id=eq.${req.orderId}&select=id,processed,items`).catch(() => null)) || [] : [];
      const commande = etatCommandeDemande(req, o);
      return { suivi: frise(req, suivi, commande), suiviBrut: suivi.etapes, commande, mail };
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

// ── Demandes au labo pour une commande enregistrée (lignes « sur justificatif ») ──
// Partagée par « submit » (panier du site) et « commander » (page dédiée). Une demande par (commande, labo),
// jamais recréée si elle existe ; toutes les nouvelles demandes écrites en une fois.
async function creerDemandes(o, lignesInfo, qui, saisieAdmin, event) {
  const orderId = String(o.id);
  const cfg = await lireConfig();
  const idx = indexProduits(cfg);
  let items = o.items;
  if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
  const infos = Object.fromEntries((Array.isArray(lignesInfo) ? lignesInfo : []).map(l => [String(l.cip), l]));
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
  if (!Object.keys(parLab).length) return [];
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
  return demandes;
}
