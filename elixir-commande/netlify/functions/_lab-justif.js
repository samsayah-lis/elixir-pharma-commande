// ── Commandes sur justificatif labo ──────────────────────────────────────
// Certains laboratoires ne livrent Elixir que sur justificatif de commandes de pharmacies
// (patients en France) : Takeda (Ninlaro, Alunbrig, Livtencity, Elaprase), Pfizer (Lorviqua,
// Resitune, Somavert). Décisions de Zineb (09/10/2026) : envoi automatique, ordonnance
// anonymisée acceptée, Takeda via « TAKEDA - CSP » ; Vyndaqel reste dans elixir-reappro.
//
// Une demande = une commande de pharmacie × un laboratoire, venue :
//   - du site (lignes « sur justificatif », hors envoi PharmaML automatique), ou
//   - du logiciel de la pharmacie (commande PharmaML repérée sur le portail, lecture seule).
// Envoi : bon d'achat Odoo (société Elixir, fournisseur du labo, pharmacie en référence
// fournisseur) confirmé, PDF rendu par Odoo, mail Odoo au labo avec le PDF (+ ordonnances),
// note dans le fil du bon. Même mécanique que l'onglet Vyndaqel → Pfizer d'elixir-reappro.
//
// Stockage : kv_store (JSON texte) — lj:config, lj:req:<id>, lj:rx:<id> (ordonnances), lj:lock.
// Anti-doublon : verrou (lj:lock, écriture conditionnelle), origine du bon [LJ-<id>] (clé
// d'unicité dans Odoo), identifiant du mail enregistré AVANT l'envoi.
import crypto from "node:crypto";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { pickCip, validCip } from "./_pharmacies.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORTAIL = (process.env.PHARMAML_URL || "https://pharmaml.elixirpharma.fr").replace(/\/$/, "");
export const MAIL_DE = process.env.LJ_MAIL_FROM || "pharmacien@elixirpharma.fr";
const MODELE_PDF = 16;           // « Purchase: Purchase Order » : sert seulement à générer le PDF du bon
const DELAI_MIN = 10;            // âge minimum d'une commande du portail avant traitement (minutes)
const AGE_MAX_AUTO = 45;         // au-delà (passage manqué, rattrapage), le stock du moment ne dit plus rien : à vérifier
export const ESSAIS_MAX = 3;
export const RX_JOURS = 90;      // ordonnances effacées 90 jours après la demande
const ctx = { allowed_company_ids: [COMPANY_ID], company_id: COMPANY_ID, lang: "fr_FR" };

// ── Configuration par défaut (modifiable dans l'admin, onglet « Justificatifs labos ») ──
// court = nom dans l'objet du mail et terme de recherche sur le portail (libellé PharmaML)
const P = (cip, odooId, nom, court, extra = {}) => ({ cip, odooId, nom, court, maxCommande: null, maxJour: null, detection: true, ...extra });
const PF = { maxCommande: 1, maxJour: 1 };   // Pfizer : 1 unité par commande, par pharmacie et par jour (10/04/2026)
export const CONFIG_DEFAUT = {
  labs: {
    takeda: {
      key: "takeda", nom: "Takeda", fournisseurId: 2726, fournisseurNom: "TAKEDA - CSP",
      // adresses du fil « votre commande P40922 » (déblocage obtenu en donnant la pharmacie) ;
      // jamais commande_adv@movianto.com (réservée aux commandes EDI)
      a: "France.ServiceClient@takeda.com, sabrina.lemesnager@takeda.com", cc: "pharmacien@elixirpharma.fr",
      sujet: "Commande {bon} - {produit} - {pharmacie} - CIP {cip}",
      intro: "Bonjour,\n\nNotre commande {bon} (compte Elixir Pharma 516709), transmise par EDI, répond à la commande de la pharmacie ci-dessous. Vous trouverez ci-joint le bon de commande et le détail de la commande de la pharmacie.",
      ordonnance: "facultative", renouvellement: false, detection: true, site: true, antiRelanceJours: 7,
      delai: "selon disponibilité du laboratoire (justificatif transmis à Takeda)",
      actif: false, depuis: null,
      produits: [
        P("3400930077696", 39909, "NINLARO 2,3 mg B/3", "Ninlaro"),
        P("3400930077719", 39910, "NINLARO 3 mg B/3", "Ninlaro"),
        P("3400930077726", 39911, "NINLARO 4 mg B/3", "Ninlaro"),
        P("3400930162712", 41500, "ALUNBRIG 90 mg B/28", "Alunbrig"),
        P("3400930162736", 41501, "ALUNBRIG 180 mg B/28", "Alunbrig"),
        P("3400930171936", 41732, "ALUNBRIG 30 mg B/28", "Alunbrig"),
        P("3400930171950", 41733, "ALUNBRIG kit d'initiation 90+180 mg", "Alunbrig"),
        P("3400930236536", 43230, "ELAPRASE 2 mg/ml 3 ml", "Elaprase"),
        P("3400930262498", 43740, "LIVTENCITY 200 mg B/28", "Livtencity"),
      ],
    },
    pfizer: {
      key: "pfizer", nom: "Pfizer", fournisseurId: 493, fournisseurNom: "PFIZER non EDI",
      a: "pfizercommandesgrossiste@pfizer.com", cc: "pharmacien@elixirpharma.fr",
      sujet: "Commande {produit} - {pharmacie} - CIP {cip}",
      intro: "Bonjour,\n\nVeuillez trouver ci-joint le bon de commande, faisant suite à la demande de la pharmacie mentionnée ci-dessous.",
      ordonnance: "facultative", renouvellement: true, detection: true, site: true, antiRelanceJours: 7,
      delai: "dépannage Pfizer : 1 boîte par commande, par pharmacie et par jour",
      actif: false, depuis: null,
      // Fournisseur « PFIZER non EDI » (493) : surtout pas « PFIZER PHARMA » (494, EDI, rarement servi).
      // Resitune : pas de repérage PharmaML — les logiciels des pharmacies le recommandent en boucle
      // (20 000 lignes en 90 jours) ; seules les commandes passées sur le site partent.
      produits: [
        P("3400930177006", 41864, "LORVIQUA 100 mg B/30", "Lorviqua 100 mg", PF),
        P("3400930189641", 42142, "LORVIQUA 25 mg B/90", "Lorviqua 25 mg", PF),
        P("3400930013953", 39005, "RESITUNE 75 mg B/30", "Resitune 75 mg", { ...PF, detection: false }),
        P("3400930013984", 39006, "RESITUNE 75 mg B/90", "Resitune 75 mg", { ...PF, detection: false }),
        P("3400930014035", 39007, "RESITUNE 100 mg B/30", "Resitune 100 mg", { ...PF, detection: false }),
        P("3400930014066", 39008, "RESITUNE 100 mg B/90", "Resitune 100 mg", { ...PF, detection: false }),
        P("3400936078376", 47238, "SOMAVERT 10 mg B/30", "Somavert 10 mg", PF),
        P("3400936078437", 47239, "SOMAVERT 15 mg B/30", "Somavert 15 mg", PF),
        P("3400936118102", 47309, "SOMAVERT 20 mg B/30", "Somavert 20 mg", PF),
        P("3400936225060", 47441, "SOMAVERT 20 mg B/1", "Somavert 20 mg", PF),
        P("3400930023860", 39149, "SOMAVERT 25 mg B/30", "Somavert 25 mg", PF),
        P("3400930023877", 39150, "SOMAVERT 30 mg B/30", "Somavert 30 mg", PF),
      ],
    },
  },
};

// ── Petits outils ───────────────────────────────────────────────────────
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function offsetParisMin(date) {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" }).format(date);
  const m = s.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
export function parisVersDate(s) {          // "2026-09-17 10:48:27" (heure de Paris) → Date
  const approx = new Date(String(s).replace(" ", "T").slice(0, 19) + "Z");
  return new Date(approx.getTime() - offsetParisMin(approx) * 60000);
}
const partiesParis = (d) => Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
}).formatToParts(d).map(p => [p.type, p.value]));
const jourPortail = (d) => { const p = partiesParis(d); return `${p.day}/${p.month}/${p.year}`; };
export const jourParis = (d) => { const p = partiesParis(d); return `${p.year}-${p.month}-${p.day}`; };
export const dateLongue = (d) => {
  const jour = d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const heure = d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  return `${jour} à ${heure}`;
};

// ── kv_store (valeur = JSON texte) ──────────────────────────────────────
async function sb(path, { method = "GET", body, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`Supabase ${method} ${path.split("?")[0]} : ${text.slice(0, 300)}`); e.httpStatus = res.status; e.body = text; throw e; }
  return text ? JSON.parse(text) : null;
}
export { sb };
const enc = encodeURIComponent;
const parse = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return null; } };
export async function kvGet(key) {
  const [row] = (await sb(`kv_store?key=eq.${enc(key)}&select=value&limit=1`)) || [];
  return row ? parse(row.value) : null;
}
export const kvSet = (key, value) => sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
  body: { key, value: JSON.stringify(value), updated_at: new Date().toISOString() } });
export const kvDel = (key) => sb(`kv_store?key=eq.${enc(key)}`, { method: "DELETE" });
export async function kvGetBrut(key) {
  const [row] = (await sb(`kv_store?key=eq.${enc(key)}&select=value,updated_at&limit=1`)) || [];
  return row ? { value: parse(row.value), maj: row.updated_at } : null;
}
// n'aboutit que si personne n'a modifié la clé depuis la lecture (maj = updated_at lu)
export async function kvSetSi(key, value, maj) {
  if (!maj) return false;   // version inconnue : jamais « updated_at=eq.null »
  const res = await sb(`kv_store?key=eq.${enc(key)}&updated_at=eq.${enc(maj)}`, { method: "PATCH", prefer: "return=representation",
    body: { value: JSON.stringify(value), updated_at: new Date().toISOString() } });
  return Array.isArray(res) && res.length === 1;
}
// valeurs dont la clé commence par `prefix` (les plus récentes d'abord)
export async function kvList(prefix, limit = 2000) {
  const rows = (await sb(`kv_store?key=like.${enc(prefix)}*&select=key,value,updated_at&order=updated_at.desc&limit=${limit}`)) || [];
  return rows.map(r => ({ key: r.key, updated_at: r.updated_at, value: parse(r.value) })).filter(r => r.value);
}
// Création seulement si la clé n'existe pas (false si elle existe déjà)
export async function kvCreate(key, value) {
  try {
    await sb("kv_store", { method: "POST", prefer: "return=minimal", body: { key, value: JSON.stringify(value), updated_at: new Date().toISOString() } });
    return true;
  } catch (e) { if (e.httpStatus === 409 || /duplicate key|23505/.test(e.body || "")) return false; throw e; }
}

// ── Verrou : un seul traitement à la fois (cron, fonction d'arrière-plan, actions admin) ──
// `cle` : lj:lock (justificatifs labos) ; sp:lock (commandes Sanofi Pro)
export async function avecVerrou(fn, dureeMs = 14 * 60e3, cle = "lj:lock") {
  const moi = crypto.randomUUID();
  const val = JSON.stringify({ moi, jusqua: Date.now() + dureeMs });
  let pris = await kvCreate(cle, { moi, jusqua: Date.now() + dureeMs });
  if (!pris) {
    const [row] = (await sb(`kv_store?key=eq.${enc(cle)}&select=value&limit=1`)) || [];
    const cur = parse(row?.value);
    if (row && (!cur || !(cur.jusqua > Date.now()))) {
      // verrou expiré : reprise conditionnelle (échoue si quelqu'un l'a repris entre-temps)
      const upd = await sb(`kv_store?key=eq.${enc(cle)}&value=eq.${enc(row.value)}`, { method: "PATCH", prefer: "return=representation",
        body: { value: val, updated_at: new Date().toISOString() } });
      pris = Array.isArray(upd) && upd.length === 1;
    } else if (!row) pris = await kvCreate(cle, { moi, jusqua: Date.now() + dureeMs });
  }
  if (!pris) return { occupe: true };
  try { return { resultat: await fn() }; }
  finally {
    const [row] = (await sb(`kv_store?key=eq.${enc(cle)}&select=value&limit=1`).catch(() => [])) || [];
    if (parse(row?.value)?.moi === moi) await sb(`kv_store?key=eq.${enc(cle)}&value=eq.${enc(row.value)}`, { method: "DELETE" }).catch(() => {});
  }
}

// ── Configuration ───────────────────────────────────────────────────────
export async function lireConfig() {
  const c = await kvGet("lj:config");
  const labs = {};
  for (const [k, def] of Object.entries(CONFIG_DEFAUT.labs)) labs[k] = { ...def, ...(c?.labs?.[k] || {}), key: k };
  for (const [k, v] of Object.entries(c?.labs || {})) if (!labs[k]) labs[k] = { ...v, key: k };
  return { labs };
}
export const ecrireConfig = (cfg) => kvSet("lj:config", { labs: cfg.labs, updated_at: new Date().toISOString() });
// CIP → { lab, produit }
export function indexProduits(cfg) {
  const out = {};
  for (const lab of Object.values(cfg.labs)) for (const p of lab.produits || []) if (p.cip) out[p.cip] = { lab, produit: p };
  return out;
}

// ── Pharmacie (fiche client Odoo) ───────────────────────────────────────
export async function fichePharmacie({ odooId, cip }) {
  const fields = ["id", "name", "cip", "ref", "street", "street2", "zip", "city", "active"];
  let p = null;
  if (odooId) [p] = await odoo("res.partner", "read", [[Number(odooId)]], { fields, context: { active_test: false } });
  else if (cip) {
    // fiche d'Elixir (société 2), sinon fiche partagée qui commande chez Elixir (même règle que la
    // connexion au site, _pharmacies.js) ; jamais celle d'une autre société du groupe
    const cands = await odoo("res.partner", "search_read", [[["cip", "=", String(cip)], ["parent_id", "=", false], ["company_id", "in", [COMPANY_ID, false]]]],
      { fields: [...fields, "company_id", "customer_rank"], limit: 10, context: { allowed_company_ids: [COMPANY_ID] } });
    p = cands.find(c => c.company_id?.[0] === COMPANY_ID) || null;
    for (const c of p ? [] : cands.filter(c => !c.company_id && (c.customer_rank || 0) > 0)) {
      const ventes = await odoo("sale.order", "search_count", [[["company_id", "=", COMPANY_ID], ["state", "in", ["sale", "done"]], ["partner_id", "child_of", [c.id]]]]);
      if (ventes > 0) { p = c; break; }
    }
  }
  if (!p) return null;
  return { odooId: p.id, nom: String(p.name || "").replace(/\s+/g, " ").trim(), cip: pickCip(p) || (cip ? String(cip) : ""),
    adresse: [p.street, p.street2].filter(Boolean).join(", "), cp: p.zip || "", ville: p.city || "",
    // règle Elixir : fiche sans CIP (champ CIP) = client bloqué (impayé) ; fiche archivée idem
    bloque: p.active === false || !validCip(p.cip) };
}

// ── Contenu du mail ─────────────────────────────────────────────────────
const remplir = (tpl, v) => String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
const nomsProduits = (req) => [...new Set(req.lignes.map(l => l.court || l.produit))].join(" / ");
export function variables(req, bon) {
  return { bon: bon || "(bon)", produit: nomsProduits(req), pharmacie: req.pharmacie?.nom || "", cip: req.pharmacie?.cip || "",
    ville: [req.pharmacie?.cp, req.pharmacie?.ville].filter(Boolean).join(" "), reference: req.reference || "",
    date: req.dateCommande ? dateLongue(new Date(req.dateCommande)) : "" };
}
export function construireMail(lab, req, bon, { test = false } = {}) {
  const v = variables(req, bon);
  const sujet = (test ? "[TEST] " : "") + remplir(lab.sujet, v);
  const p = (t) => `<p style="margin:0">${t}</p>`;
  const intro = esc(remplir(lab.intro, v)).replace(/\n/g, "<br>");
  const ph = req.pharmacie || {};
  const origine = req.source !== "site" ? "Commande de l'officine reçue sur PharmaML"
    : req.saisiPar ? "Commande de la pharmacie, saisie pour elle par Elixir Pharma sur son site de commande"
    : "Commande passée par la pharmacie sur le site de commande Elixir Pharma";
  const renouv = (l) => (l.renouvellement ?? req.renouvellement) === true;
  const lignes = req.lignes.map(l => `${l.qte} x ${esc(l.cip)} ${esc(l.produit)}${renouv(l) ? " (renouvellement)" : ""}`).join("<br>");
  const mentions = [];
  if (req.attestation) mentions.push(req.saisiPar ? "La pharmacie a confirmé à Elixir Pharma que cette commande répond au besoin d'un patient en France."
    : "La pharmacie atteste que cette commande répond au besoin d'un patient en France.");
  if (req.lignes.some(renouv)) mentions.push("La pharmacie précise que les lignes marquées « renouvellement » concernent un patient déjà traité (nouvelle commande).");
  const nRx = req.rxJointes ?? (req.rx || []).length;
  if (nRx) mentions.push(`Ordonnance anonymisée jointe (${nRx} fichier${nRx > 1 ? "s" : ""}).`);
  const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:12pt;color:#000">
  ${test ? `<div style="background:#fff3cd;border:1px solid #f0c36d;padding:8px 10px;margin-bottom:12px;font-size:11pt">MAIL DE TEST — n'a pas été envoyé au laboratoire, aucun bon de commande n'a été créé.</div>` : ""}
  ${p(intro)}<br>
  ${p("Je vous remercie,")}<br>${p("Cordialement,")}<br>${p("<b>Elixir Pharma</b>")}${p("53 rue des Fontenelles<br>78920 Ecquevilly")}${p("Tél : 01 86 04 33 02")}<br>
  <hr style="display:inline-block;width:98%">
  ${p(`<b>${esc(origine)}</b>`)}
  ${p(`<b>Date :</b> ${esc(v.date)}`)}
  <br>
  <div style="font-family:Consolas,'Courier New',monospace;font-size:11pt">
    Raison sociale&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${esc(ph.nom)}<br>
    CIP officine&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${esc(ph.cip)}<br>
    Adresse&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${esc([ph.adresse, [ph.cp, ph.ville].filter(Boolean).join(" ")].filter(Boolean).join(", "))}<br>
    Référence commande : ${esc(req.reference)}<br><br>
    QtCmd x Réf Designation<br><br>
    ${lignes}
  </div>
  ${mentions.length ? `<br>${mentions.map(m => p(esc(m))).join("")}` : ""}
</div>`;
  return { sujet, corps };
}

// ── Ordonnances (kv lj:rx:<id>) ─────────────────────────────────────────
export const RX_MIMES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
export const RX_MAX_B64 = 4_500_000;   // ~3,3 Mo de fichier (corps de requête Netlify : 6 Mo)
export async function enregistrerOrdonnance({ owner, name, mime, data_base64 }) {
  const id = crypto.randomUUID();
  await kvSet(`lj:rx:${id}`, { owner: String(owner), name: String(name || "ordonnance").slice(0, 120), mime, data_base64, at: new Date().toISOString() });
  return id;
}

// ── Envoi d'une demande : bon Odoo + PDF + mail + note ──────────────────
// L'état est enregistré après chaque étape : une reprise ne crée jamais de doublon.
async function sauver(req) { req.majLe = new Date().toISOString(); await kvSet(`lj:req:${req.id}`, req); }

async function envoyer(cfg, req) {
  const lab = cfg.labs[req.lab];
  if (!lab) throw new Error(`laboratoire inconnu : ${req.lab}`);
  const a = String(lab.a || "").trim();
  if (!a.includes("@")) throw new Error("adresse du laboratoire manquante (réglages)");

  if (req.mailId) return finirMail(lab, req);   // mail déjà créé : ne jamais en recréer, seulement finir l'envoi

  // 1. Bon d'achat (origine = clé d'unicité dans Odoo, non imprimée sur le PDF)
  const origine = `Justificatif ${lab.nom} ${req.reference} (${req.pharmacie.nom}) [LJ-${req.id}]`.slice(0, 250);
  let [po] = await odoo("purchase.order", "search_read",
    [[["origin", "=", origine], ["company_id", "=", COMPANY_ID], ["state", "!=", "cancel"]]], { fields: ["id", "name", "state"], context: ctx });
  if (!po) {
    const lignes = req.lignes.map(l => {
      if (!l.odooId) throw new Error(`produit sans fiche Odoo : ${l.cip}`);
      return [0, 0, { product_id: Number(l.odooId), product_qty: Number(l.qte) }];
    });
    const id = await odoo("purchase.order", "create", [{
      partner_id: Number(lab.fournisseurId), company_id: COMPANY_ID, partner_ref: req.pharmacie.nom.slice(0, 120),
      origin: origine, order_line: lignes,
    }], { context: ctx });
    [po] = await odoo("purchase.order", "read", [[id], ["id", "name", "state"]], { context: ctx });
  }
  req.poId = po.id; req.poNom = po.name;
  await sauver(req);
  if (po.state === "draft" || po.state === "sent") await odoo("purchase.order", "button_confirm", [[po.id]], { context: ctx });

  // 2. PDF du bon, rendu par Odoo (assistant d'e-mail transitoire : il n'envoie rien)
  const compId = await odoo("mail.compose.message", "create", [{}], {
    context: { ...ctx, default_model: "purchase.order", default_res_ids: [po.id], default_template_id: MODELE_PDF, default_composition_mode: "comment" },
  });
  const [comp] = await odoo("mail.compose.message", "read", [[compId], ["attachment_ids"]]);
  if (!comp?.attachment_ids?.length) throw new Error("Odoo n'a pas généré le PDF du bon de commande");
  const [pdf] = await odoo("ir.attachment", "read", [[comp.attachment_ids[0]], ["name", "datas"]]);
  const pjs = [await odoo("ir.attachment", "create", [{ name: pdf.name, datas: pdf.datas, mimetype: "application/pdf", res_model: "purchase.order", res_id: po.id }])];

  // 3. Ordonnances anonymisées jointes (le mail n'annonce que celles réellement jointes)
  req.rxJointes = 0;
  for (const [i, rx] of (req.rx || []).entries()) {
    const f = await kvGet(`lj:rx:${rx.id}`);
    if (!f?.data_base64) continue;
    const ext = RX_MIMES[f.mime] || "bin";
    pjs.push(await odoo("ir.attachment", "create", [{ name: `Ordonnance anonymisée ${i + 1} - ${req.pharmacie.nom}.${ext}`.slice(0, 200),
      datas: f.data_base64, mimetype: f.mime, res_model: "purchase.order", res_id: po.id }]));
    req.rxJointes++;
  }

  // 4. Mail : retrouvé par son Message-ID s'il a déjà été créé (coupure entre la création et
  // l'enregistrement de son identifiant), sinon créé ; identifiant enregistré avant l'envoi
  const { sujet, corps } = construireMail(lab, req, po.name);
  req.sujet = sujet;
  const msgId = `<lj-${req.id}@elixirpharma.fr>`;
  const [deja] = await odoo("mail.mail", "search_read", [[["message_id", "=", msgId]]], { fields: ["id"], limit: 1 });
  req.mailId = deja?.id || await odoo("mail.mail", "create", [{
    message_id: msgId, subject: sujet, body_html: corps, email_from: MAIL_DE, email_to: a, email_cc: String(lab.cc || "").trim() || false,
    attachment_ids: [[6, 0, pjs]], model: "purchase.order", res_id: po.id, auto_delete: false,
  }]);
  req.destinataires = { a, cc: lab.cc || "" };
  await sauver(req);
  return finirMail(lab, req, pjs);
}

// Envoie le mail s'il n'est pas parti (« exception » : remis en file d'abord), exige l'état « sent »,
// puis note dans le fil du bon (une seule fois)
async function finirMail(lab, req, pjs = null) {
  const lire = async () => (await odoo("mail.mail", "search_read", [[["id", "=", req.mailId]]], { fields: ["state", "failure_reason", "attachment_ids"] }))[0];
  let m = await lire();
  if (!m) throw new Error("mail introuvable dans Odoo (supprimé ?) : vérifiez puis renvoyez à la main");
  if (m.state === "cancel") throw new Error("mail annulé dans Odoo");
  if (m.state !== "sent") {
    if (m.state === "exception") await odoo("mail.mail", "mark_outgoing", [[req.mailId]]);
    await odoo("mail.mail", "send", [[req.mailId]]);
    m = await lire();
  }
  if (m?.state !== "sent") throw new Error(`serveur mail : ${m?.failure_reason || m?.state || "échec"}`);
  if (!req.noteOk && req.poId) {
    const a = req.destinataires?.a || lab.a, cc = req.destinataires?.cc ?? lab.cc;
    await odoo("purchase.order", "message_post", [[req.poId]], {
      body: `Justificatif envoyé automatiquement à ${esc(a)}${cc ? ` (copie ${esc(cc)})` : ""} — ${esc(req.pharmacie.nom)} (CIP ${esc(req.pharmacie.cip)}), `
        + `${req.source === "site" ? "commande site" : "commande PharmaML"} ${esc(req.reference)} du ${esc(dateLongue(new Date(req.dateCommande)))}.`,
      message_type: "comment", subtype_xmlid: "mail.mt_note", attachment_ids: pjs || m.attachment_ids || [],
    });
    req.noteOk = true;
  }
  return terminer(req);
}
function terminer(req) {
  req.statut = "envoye"; req.envoyeLe = new Date().toISOString(); req.erreur = null; req.forcer = false; req.manuel = false;
  return sauver(req);
}

// Règles du labo vérifiées avant l'envoi automatique : quantité par commande et par jour
// (ex. Pfizer : 1 boîte par commande, par pharmacie et par jour). Renvoie le motif ou null.
export function controleRegles(lab, req, autres) {
  const tot = {};   // un même CIP sur plusieurs lignes compte pour la somme
  for (const l of req.lignes) tot[l.cip] = (tot[l.cip] || 0) + Number(l.qte || 0);
  for (const l of req.lignes.filter((x, i, a) => a.findIndex(y => y.cip === x.cip) === i)) {
    const q = tot[l.cip];
    const prod = (lab.produits || []).find(p => p.cip === l.cip);
    const maxC = Number(prod?.maxCommande) || 0, maxJ = Number(prod?.maxJour) || 0;
    if (maxC && q > maxC) return `${q} × ${l.court || l.produit} : au-delà de ${maxC} par commande (règle ${lab.nom})`;
    if (maxJ) {
      const jour = jourParis(new Date(req.dateCommande));
      const deja = autres.filter(o => o.id !== req.id && o.lab === req.lab && (o.statut === "envoye" || o.statut === "en_cours" || o.mailId)
        && String(o.pharmacie?.odooId) === String(req.pharmacie?.odooId) && jourParis(new Date(o.dateCommande)) === jour)
        .reduce((n, o) => n + o.lignes.filter(x => x.cip === l.cip).reduce((s, x) => s + x.qte, 0), 0);
      if (deja + q > maxJ) return `${l.court || l.produit} : ${deja} déjà envoyé(s) aujourd'hui pour cette pharmacie, au plus ${maxJ} par jour (règle ${lab.nom})`;
    }
  }
  return null;
}

// Envoie une demande (compte un essai ; erreur enregistrée sans exception)
export async function traiter(cfg, req, { forcer = false, autres = [], maj = null } = {}) {
  const lab = cfg.labs[req.lab];
  // première écriture conditionnelle (maj = date lue) : si l'admin a ignoré ou modifié la demande
  // entre la lecture et ici, rien ne part
  const prendre = async () => {
    if (!maj) { await sauver(req); return true; }
    req.majLe = new Date().toISOString();
    return kvSetSi(`lj:req:${req.id}`, req, maj);
  };
  // règles du labo (quantités) : vérifiées tant que le mail n'existe pas ; « forcer » (admin) ne passe
  // outre que le motif qu'il a déjà vu affiché
  if (lab && !req.mailId) {
    const motif = controleRegles(lab, req, autres);
    if (motif && !(forcer && req.motif === motif)) {
      Object.assign(req, { statut: "a_verifier", motif, forcer: false, manuel: false });
      return (await prendre()) ? motif : "demande modifiée entre-temps : rien n'est parti";
    }
  }
  req.essais = (req.essais || 0) + 1;
  req.statut = "en_cours";
  if (!(await prendre())) return "demande modifiée entre-temps : rien n'est parti";
  try { await envoyer(cfg, req); return null; }
  catch (e) {
    req.statut = "erreur"; req.erreur = String(e.message || e).split("\n")[0].slice(0, 300); req.forcer = false; req.manuel = false;
    await sauver(req);
    return req.erreur;
  }
}

// ── Portail PharmaML (lecture seule) ────────────────────────────────────
// ⚠️ Jamais commandes.php?U=&P= (canal de l'ERP, acquitterait les commandes), jamais /commandes/api/*.
let cookie = null;
async function login() {
  if (!process.env.PHARMAML_PASS) throw new Error("PHARMAML_PASS non configuré sur Netlify");
  const r = await fetch(`${PORTAIL}/connexion`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login: process.env.PHARMAML_USER || "admin", password: process.env.PHARMAML_PASS }).toString(),
    redirect: "manual",
  });
  const set = r.headers.getSetCookie?.() || (r.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
  if (!set.length) throw new Error(`Connexion au portail PharmaML refusée (HTTP ${r.status})`);
  cookie = set.map(c => c.split(";")[0].trim()).join("; ");
}
async function portail(chemin, html = false) {
  for (let essai = 0; essai < 2; essai++) {
    if (!cookie) await login();
    const r = await fetch(PORTAIL + chemin, { headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest", Accept: "*/*" }, redirect: "manual" });
    const body = await r.text();
    const perdue = r.status >= 300 || (html ? /name="password"/i.test(body) : /^\s*</.test(body));
    if (!perdue) return body;
    cookie = null;
  }
  throw new Error(`Portail PharmaML : session refusée sur ${chemin}`);
}
async function commandesDuJour(d) {
  const u = new URLSearchParams({ draw: "1", start: "0", length: "5000", "search[value]": "", "order[0][column]": "1", "order[0][dir]": "asc",
    "columns[1][data]": "DateCommande", "columns[1][orderable]": "true", etat: "0", dateDebut: jourPortail(d), dateFin: jourPortail(d) });
  return JSON.parse(await portail("/liste/commandes/0?" + u)).data || [];
}
export async function testPortail() { return (await commandesDuJour(new Date())).length; }
// Lignes commandées (écran « Produits commandés › Par clients »), filtrées sur le libellé :
// le filtre ne marche pas sur le CIP, on le revérifie ensuite.
async function lignesProduit(terme, du, au) {
  const cols = ["DateCommande", "Identifiant", "RaisonSociale", "CodeProduit", "Libelle", "QuantiteCommandee", "QuantiteLivree"];
  const out = [];
  for (let start = 0; ; ) {
    const u = new URLSearchParams({ draw: "1", start: String(start), length: "500", "search[value]": terme,
      dateDebut: jourPortail(du), dateFin: jourPortail(au), "order[0][column]": "0", "order[0][dir]": "asc" });
    cols.forEach((c, k) => { u.set(`columns[${k}][data]`, c); u.set(`columns[${k}][searchable]`, "true"); u.set(`columns[${k}][orderable]`, "true"); });
    const j = JSON.parse(await portail("/liste/articles/commandesParClients?" + u));
    out.push(...(j.data || []));
    start += (j.data || []).length;
    if (!(j.data || []).length || start >= j.recordsFiltered) break;
  }
  return out;
}

// Commandes passées depuis le logiciel des pharmacies (PharmaML) pour les produits suivis des labos
// actifs : une demande par (commande, labo). Les commandes du site, transmises plus tard à PharmaML
// avec leur numéro (13 chiffres) en référence, ne sont jamais reprises.
// Envoi automatique seulement si la commande a été acceptée (quantité livrée = commandée) ET
// qu'Elixir n'a plus de stock du produit ; sinon « à vérifier » (servie sur le stock ? manquant ?).
// NB : la colonne « Disponible » du portail est un code de réponse PharmaML, pas un stock.
const cleDemande = (lab, g) => `p-${g.ID_Adherent}-${String(g.ReferenceCommande || "")}-${String(g.DateCommande).replace(/\D/g, "")}-${lab.key}`.replace(/[^\w.-]/g, "_").slice(0, 110);
export async function detecter(cfg, { budgetMs = 20000 } = {}) {
  const t0 = Date.now();
  const journal = [];
  const maintenant = new Date();
  const labs = Object.values(cfg.labs).filter(l => l.actif && l.detection && (l.produits || []).some(p => p.detection !== false));
  // ordre tournant : chaque labo dispose régulièrement de tout le budget
  const rot = labs.length ? Math.floor(Date.now() / 600e3) % labs.length : 0;
  let recentes = null;
  for (const lab of [...labs.slice(rot), ...labs.slice(0, rot)]) {
    if (Date.now() - t0 > budgetMs) { journal.push(`Détection interrompue avant ${lab.nom} : reprise au prochain passage`); break; }
    // depuis l'activation de l'envoi / du repérage, sur 2 jours au plus (rattrapage d'un passage manqué)
    const depuis = new Date(Math.max(Date.parse(lab.depuis || 0) || 0, Date.parse(lab.detectionDepuis || 0) || 0, maintenant.getTime() - 2 * 86400e3));
    const suivis = lab.produits.filter(p => p.detection !== false);
    // produit ajouté / suivi plus tard : ses commandes antérieures ne sont pas reprises (les autres produits gardent leur fenêtre)
    const debutProduit = (cip) => Math.max(depuis.getTime(), Date.parse(suivis.find(p => p.cip === cip)?.suiviDepuis || 0) || 0);
    const parCip = Object.fromEntries(suivis.map(p => [p.cip, p]));
    const termes = [...new Set(suivis.map(p => String(p.court || p.nom).split(" ")[0].toUpperCase()).filter(t => t.length >= 4))];
    const lignes = [];
    let complet = true;
    for (const t of termes) {
      if (Date.now() - t0 > budgetMs) { complet = false; break; }
      lignes.push(...(await lignesProduit(t, depuis, maintenant)).filter(l => parCip[l.CodeProduit] && Number(l.QuantiteCommandee) > 0
        && parisVersDate(l.DateCommande).getTime() >= debutProduit(l.CodeProduit)));
    }
    // lignes partielles d'un labo : abandonnées (une commande à plusieurs produits serait incomplète)
    if (!complet) { journal.push(`Détection ${lab.nom} interrompue (temps écoulé) : reprise au prochain passage`); break; }
    const groupes = new Map();       // une commande officine = (adhérent, référence, date)
    const vues = new Set();
    for (const l of lignes) {
      const k = `${l.ID_Adherent}|${l.ReferenceCommande}|${l.DateCommande}`;
      const kl = `${k}|${l.CodeProduit}|${l.QuantiteCommandee}|${l.QuantiteLivree}|${l.Libelle}`;
      if (vues.has(kl)) continue;    // même ligne trouvée par deux termes
      vues.add(kl);
      const g = groupes.get(k) || { ...l, lignes: [] };
      const prod = parCip[l.CodeProduit];
      const ex = g.lignes.find(x => x.cip === l.CodeProduit);
      if (ex) { ex.qte += Number(l.QuantiteCommandee); ex.livre += Number(l.QuantiteLivree) || 0; }
      else g.lignes.push({ cip: l.CodeProduit, odooId: prod.odooId, produit: prod.nom || l.Libelle, court: prod.court, qte: Number(l.QuantiteCommandee), livre: Number(l.QuantiteLivree) || 0 });
      groupes.set(k, g);
    }
    let stock = null;                // stock physique d'Elixir par produit (lu une fois par labo)
    for (const g of [...groupes.values()].sort((x, y) => String(x.DateCommande).localeCompare(String(y.DateCommande)))) {
      const date = parisVersDate(g.DateCommande);
      if (maintenant - date < DELAI_MIN * 60e3 || date < depuis) continue;
      const ref = String(g.ReferenceCommande || "");
      const site = ref.match(/^(\d{13})/);
      if (site && ((await sb(`elixir_orders?id=eq.${site[1]}&select=id&limit=1`)) || []).length) continue;   // commande du site
      const id = cleDemande(lab, g);
      if (await kvGet(`lj:req:${id}`)) continue;
      const ph = await fichePharmacie({ cip: String(g.Identifiant) });
      const req = {
        id, lab: lab.key, source: "pharmaml", reference: ref, adherent: String(g.ID_Adherent), dateCommande: date.toISOString(),
        pharmacie: ph || { nom: String(g.RaisonSociale || "").trim(), cip: String(g.Identifiant || "") },
        lignes: g.lignes.map(({ livre, ...l }) => l), attestation: false, renouvellement: null, rx: [],
        statut: "a_envoyer", essais: 0, creeLe: new Date().toISOString(),
      };
      const motifs = [];
      if (!ph) { req.statut = "bloquee"; req.motif = "Pharmacie absente des clients Odoo d'Elixir (CIP inconnu ou client bloqué)"; }
      else if (ph.bloque) { req.statut = "bloquee"; req.motif = "Client bloqué dans Odoo (champ CIP vide ou fiche archivée)"; }
      else {
        if (maintenant - date > AGE_MAX_AUTO * 60e3) motifs.push(`commande repérée ${Math.round((maintenant - date) / 60e3)} min après son passage : stock d'Elixir au moment de la commande inconnu (servie sur le stock ?)`);
        const manquant = g.lignes.filter(l => l.livre < l.qte);
        if (manquant.length) motifs.push(`ligne non acceptée par Elixir (manquant : ${manquant.map(l => `${l.livre}/${l.qte} ${l.court || l.produit}`).join(", ")})`);
        if (!stock) {
          const ids = [...new Set(suivis.map(p => Number(p.odooId)).filter(Boolean))];
          const rows = ids.length ? await odoo("product.product", "read", [ids, ["qty_available"]], { context: { allowed_company_ids: [COMPANY_ID] } }) : [];
          stock = Object.fromEntries(rows.map(r => [r.id, Number(r.qty_available) || 0]));
        }
        const enStock = g.lignes.filter(l => (stock[Number(l.odooId)] || 0) > 0);
        if (enStock.length) motifs.push(`Elixir a du stock (${enStock.map(l => `${stock[Number(l.odooId)]} ${l.court || l.produit}`).join(", ")}) : commande servie sur le stock ?`);
        // Relance automatique probable : le logiciel d'une pharmacie renvoie une ligne non servie avec une
        // nouvelle référence. Même pharmacie + même produit dans les N derniers jours (demande ignorée comprise).
        const jours = Number(lab.antiRelanceJours ?? 7);
        if (jours > 0) {
          recentes ??= (await kvList("lj:req:")).map(r => r.value);
          const proche = recentes.find(o => o.lab === lab.key && String(o.pharmacie?.odooId) === String(ph.odooId)
            && Math.abs(new Date(o.dateCommande) - date) < jours * 86400e3 && o.lignes.some(x => req.lignes.some(y => y.cip === x.cip)));
          if (proche) motifs.push(`commande proche du ${dateLongue(new Date(proche.dateCommande))} (même pharmacie, même produit) : relance automatique du logiciel ?`);
        }
        if (motifs.length) { req.statut = "a_verifier"; req.motif = motifs.join(" ; "); }
      }
      if (await kvCreate(`lj:req:${id}`, req)) {
        recentes?.push(req);
        journal.push(`Détecté : ${req.pharmacie.nom}, ${req.lignes.map(l => `${l.qte} × ${l.court || l.produit}`).join(", ")} (réf ${ref})${req.statut === "bloquee" ? " — client bloqué" : req.statut === "a_verifier" ? " — à vérifier" : ""}`);
      }
    }
  }
  return journal;
}

// Envoi des demandes dues : labos actifs, et envois demandés à la main dans l'admin (« manuel »).
// Chaque demande est relue juste avant l'envoi (ignorée ou labo arrêté entre-temps : rien ne part).
export async function envoisDus(cfg0, { budgetMs = 600000 } = {}) {
  const t0 = Date.now();
  const journal = [];
  // « en_cours » depuis plus de 15 min : traitement interrompu (coupure), à reprendre (le bon et le
  // mail déjà créés sont retrouvés, jamais recréés)
  const bloque = (r) => r.statut === "en_cours" && Date.now() - Date.parse(r.majLe || 0) > 15 * 60e3;
  // envoi auto : demandes de l'activation en cours seulement (un labo réactivé ne vide pas sa vieille
  // file), sauf bon/mail déjà créés (à terminer) ; envoi demandé à la main : toujours
  const due = (r, cfg) => {
    const lab = cfg.labs[r.lab];
    const auto = lab?.actif && (r.poId || r.mailId || Date.parse(r.creeLe || r.dateCommande || 0) >= Date.parse(lab.depuis || 0) - 60e3);
    return (auto || r.manuel) && (r.statut === "a_envoyer" || bloque(r) || (r.statut === "erreur" && (r.essais || 0) < ESSAIS_MAX));
  };
  const toutes = (await kvList("lj:req:")).map(r => r.value);
  const dues = toutes.filter(r => due(r, cfg0)).sort((a, b) => String(a.dateCommande).localeCompare(String(b.dateCommande)));
  for (const r0 of dues) {
    if (Date.now() - t0 > budgetMs) { journal.push("Temps écoulé : suite au prochain passage"); break; }
    const cfg = await lireConfig();
    const lu = await kvGetBrut(`lj:req:${r0.id}`);
    const req = lu?.value;
    if (!req || !due(req, cfg)) continue;
    const autres = toutes.map(o => (o.id === req.id ? req : o));
    const err = await traiter(cfg, req, { autres, forcer: !!req.forcer, maj: lu.maj });
    const i = toutes.findIndex(o => o.id === req.id); if (i >= 0) toutes[i] = req;
    journal.push(err ? `${req.pharmacie?.nom} : ${req.statut === "a_verifier" ? "à vérifier — " : "erreur — "}${err}` : `Envoyé : ${req.pharmacie?.nom} (${req.poNom})`);
  }
  return journal;
}

// Ordonnances : effacées 90 jours après leur dépôt ; dépôts jamais rattachés à une demande : 2 jours
export async function menageOrdonnances() {
  const limite = new Date(Date.now() - RX_JOURS * 86400e3).toISOString();
  await sb(`kv_store?key=like.lj:rx:*&updated_at=lt.${enc(limite)}`, { method: "DELETE" });
  const orphelins = new Date(Date.now() - 2 * 86400e3).toISOString();
  const vieux = (await sb(`kv_store?key=like.lj:rx:*&updated_at=lt.${enc(orphelins)}&select=key&limit=500`)) || [];
  if (!vieux.length) return;
  const utilisees = new Set((await kvList("lj:req:")).flatMap(r => (r.value.rx || []).map(x => `lj:rx:${x.id}`)));
  for (const { key } of vieux) if (!utilisees.has(key)) await kvDel(key).catch(() => {});
}

// Mail de test : envoyé à une adresse interne, sans bon de commande
export async function envoyerTest(cfg, labKey, adresse, exemple) {
  const lab = cfg.labs[labKey];
  if (!lab) throw Object.assign(new Error("laboratoire inconnu"), { status: 400 });
  const to = String(adresse || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) throw Object.assign(new Error("adresse de test invalide"), { status: 400 });
  const domainesLab = (String(lab.a || "").toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/g) || []).map(d => d.slice(1));
  if (domainesLab.some(d => to.endsWith("@" + d))) throw Object.assign(new Error("le mail de test ne peut pas partir vers le laboratoire"), { status: 400 });
  const p0 = (lab.produits || [])[0] || { cip: "3400900000000", nom: "PRODUIT EXEMPLE", court: "Produit" };
  const req = exemple || {
    id: "test", lab: labKey, source: "site", reference: "1790000000000", dateCommande: new Date().toISOString(),
    pharmacie: { nom: "PHARMACIE EXEMPLE", cip: "1234567", adresse: "1 rue de l'Exemple", cp: "75000", ville: "PARIS" },
    lignes: [{ cip: p0.cip, produit: p0.nom, court: p0.court, qte: 1 }], attestation: true, renouvellement: lab.renouvellement ? true : null, rx: [],
  };
  const { sujet, corps } = construireMail(lab, req, "P00000", { test: true });
  const id = await odoo("mail.mail", "create", [{ subject: sujet, body_html: corps, email_from: MAIL_DE, email_to: to, auto_delete: false }]);
  await odoo("mail.mail", "send", [[id]]);
  const [m] = await odoo("mail.mail", "read", [[id], ["state", "failure_reason"]]);
  if (m?.state === "exception") throw new Error(`serveur mail : ${m.failure_reason || "échec"}`);
  return { sujet, a: to };
}
