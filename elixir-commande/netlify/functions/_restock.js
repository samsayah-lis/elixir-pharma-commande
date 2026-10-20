// ── Alertes « M'avertir du retour » : retours en stock, e-mails aux pharmacies, tableau de bord de l'admin ──
// Demande de Zineb (20/10/2026, docs/alertes-retour.md). Le bouton « M'avertir du retour » de la Saisie de commande
// (src/components/OrderEntry.jsx → restock-alert.js) range une ligne dans restock_alerts (pharmacy_cip, cip,
// pharmacy_email, product_name, created_at, notified=false ; clé primaire pharmacy_cip + cip). Ce module :
//  • passage() — après chaque mise à jour du stock (run-sync.mjs → restock-notify) et toutes les 3 h
//    (restock-notify-cron) : produits revenus en stock (règle de la Saisie : in_stock et prix net > 0) attendus par une
//    pharmacie → UN e-mail par adresse (celle de la demande, encore compte de ce CIP dans elixir_pharmacies), plusieurs
//    produits regroupés, puis demande marquée avertie. Demandes de plus de 60 jours : closes sans e-mail. Envois entre
//    7 h et 21 h, heure de Paris (« Envoyer maintenant » de l'admin : à toute heure) ;
//  • apercu() — admin : produits les plus attendus, prêts à partir, avertis récemment, journal des passages ;
//  • marquerRetours() — restock-alert (GET d'une pharmacie) : mention « De retour en stock » de la Saisie.
// Jamais deux e-mails pour une même demande : réservation par PATCH conditionnel (notified=eq.false → true) AVANT
// l'envoi, compte rendu après ; envoi refusé → réservation rendue (nouvel essai au passage suivant, ESSAIS_MAX au plus) ;
// fonction coupée entre réservation et compte rendu → « interrompu » au passage suivant, jamais renvoyé d'office (bouton
// « Relancer » de l'admin, après vérification dans Resend).
// Base : colonnes attempts, outcome et notified_at (sql/restock-notify.sql). Sans elles (« mode réduit »), tout
// fonctionne : réservation sur notified seul, essais comptés dans kv_store, issues lues dans le journal ; seuls les
// envois interrompus ne sont pas repérés. Aucune adresse e-mail dans le journal, l'aperçu ni les réponses.
import { sendMail } from "./_gp-mail.js";
import { kvGet, kvSet, kvParse, kvDeleteOlder } from "./_kv.js";

export const AGE_MAX_JOURS = 60;        // demande plus ancienne : close sans e-mail (trop ancienne pour être utile)
export const RECENT_JOURS = 14;         // « De retour en stock » dans la Saisie pendant 14 jours après l'avertissement
export const ESSAIS_MAX = 3;            // envois refusés avant clôture « echec »
export const HISTORIQUE_JOURS = 30;     // admin : avertis récemment
const JOURNAL_JOURS = 60;               // journal des passages (kv_store) gardé 60 jours
export const FENETRE = { de: 7, a: 21 };   // heures d'envoi, heure de Paris (passages automatiques)
export const SITE_PHARMACIES = "https://elixir-commande.expepharma.com";   // adresse des pharmacies (liens ?cip= du catalogue)
export const ESPACEMENT_MS = 600;       // Resend : 2 envois par seconde au plus
export const RECLAMATION_PERIMEE_MS = 15 * 60e3;
export const CLE_DERNIER = "restock_notify:dernier";
export const PREFIXE_PASSAGE = "restock_notify:passage:";
const PREFIXE_ESSAIS = "restock_notify:essais:";
const JOUR = 86400e3;
const COLONNES_SUIVI = ["attempts", "outcome", "notified_at"];

// ── Supabase (PostgREST), clé du site (SUPABASE_KEY) lue à l'appel ──
async function sb(chemin, { method = "GET", body, prefer, range } = {}) {
  const cle = process.env.SUPABASE_KEY;
  const headers = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  if (range) headers.Range = range;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${chemin}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data, text };
}
const enc = encodeURIComponent;
const guillemets = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const dans = (col, vals) => `${col}=in.${enc(`(${vals.map(guillemets).join(",")})`)}`;
const egal = (col, v) => `${col}=eq.${enc(v)}`;
const lots = (liste, n) => { const out = []; for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n)); return out; };
export const colonneManquante = (t) => /PGRST204|42703|schema cache|does not exist/i.test(String(t || ""));
// motif d'erreur montrable (journal, admin, journaux GitHub) : jamais d'adresse e-mail
export const sansAdresse = (t) => String(t ?? "").replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "‹adresse›").slice(0, 240);

// ── Règle de la Saisie de commande (OrderEntry : prix remisé s'il y a remise, sinon prix catalogue) ──
export function prixNet(p) {
  if (!p) return null;
  const remise = !!p.discounted_price && Number(p.discount_pct) > 0;
  const v = Number(remise ? p.discounted_price : p.list_price);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}
export const enStock = (p) => !!p && p.in_stock === true && prixNet(p) != null;

const heureParis = (ms) => Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" })
  .formatToParts(new Date(ms)).find(x => x.type === "hour")?.value);
export const dansFenetre = (ms) => { const h = heureParis(ms); return h >= FENETRE.de && h < FENETRE.a; };

// Demande avertie récemment et pas close pour ancienneté : « De retour en stock » dans la Saisie (si le produit l'est)
export function retourRecent(r, maintenant = Date.now()) {
  if (r?.notified !== true || r.outcome === "ancienne") return false;
  const cree = Date.parse(r.created_at), avise = Date.parse(r.notified_at);
  // avertie moins de 60 jours après la demande (sinon : close pour ancienneté, même sans colonne outcome)
  if (Number.isFinite(avise)) return maintenant - avise <= RECENT_JOURS * JOUR && (!Number.isFinite(cree) || avise - cree <= AGE_MAX_JOURS * JOUR);
  return Number.isFinite(cree) && maintenant - cree <= AGE_MAX_JOURS * JOUR;   // sans notified_at : la demande elle-même
}

// ── Lectures ──
// Colonnes de restock_alerts (ligne témoin) ; null : table vide
async function lireColonnes() {
  const r = await sb("restock_alerts?select=*&limit=1");
  if (!r.ok) throw new Error(`alertes illisibles (HTTP ${r.status})`);
  return Array.isArray(r.data) && r.data[0] ? new Set(Object.keys(r.data[0])) : null;
}
async function lireAttente() {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const r = await sb("restock_alerts?notified=eq.false&select=*&order=created_at.asc", { range: `${de}-${de + 999}` });
    if (!r.ok) throw new Error(`alertes illisibles (HTTP ${r.status})`);
    const rows = Array.isArray(r.data) ? r.data : [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
// CIP → ligne odoo_catalog (stock et prix de la Saisie)
export async function lireCatalogue(cips) {
  const out = {};
  const uniques = [...new Set((cips || []).map(c => String(c ?? "").trim()).filter(Boolean))];
  for (const lot of lots(uniques, 100)) {
    const r = await sb(`odoo_catalog?${dans("cip", lot)}&select=cip,name,in_stock,list_price,discounted_price,discount_pct`);
    if (!r.ok) throw new Error(`catalogue illisible (HTTP ${r.status})`);
    for (const p of Array.isArray(r.data) ? r.data : []) out[p.cip] = p;
  }
  return out;
}
// adresse (minuscules) → comptes elixir_pharmacies [{ cip, name }]
async function lireComptes(adresses) {
  const out = new Map();
  for (const lot of lots(adresses, 50)) {
    const r = await sb(`elixir_pharmacies?${dans("email", lot)}&select=email,cip,name`);
    if (!r.ok) throw new Error(`comptes des pharmacies illisibles (HTTP ${r.status})`);
    for (const c of Array.isArray(r.data) ? r.data : []) {
      const e = String(c.email || "").trim().toLowerCase();
      out.set(e, [...(out.get(e) || []), c]);
    }
  }
  return out;
}
// CIP de pharmacie → nom (journal et admin : jamais d'adresse)
async function lireNoms(cips) {
  const out = new Map();
  const uniques = [...new Set(cips.map(c => String(c ?? "").trim()).filter(Boolean))];
  for (const lot of lots(uniques, 100)) {
    const r = await sb(`elixir_pharmacies?${dans("cip", lot)}&select=cip,name`);
    if (!r.ok) continue;
    for (const c of Array.isArray(r.data) ? r.data : []) if (c.name && !out.has(String(c.cip).trim())) out.set(String(c.cip).trim(), c.name);
  }
  return out;
}
async function lirePassages(depuisMs) {
  const r = await sb(`kv_store?key=like.${enc(PREFIXE_PASSAGE)}*&select=key,value&order=key.desc&limit=200`);
  if (!r.ok) return [];
  return (Array.isArray(r.data) ? r.data : []).map(x => kvParse(x.value)).filter(p => p && Date.parse(p.at) >= depuisMs);
}

// ── Mention « De retour en stock » (restock-alert, GET d'une pharmacie ou de l'admin en saisie) ──
// Lignes renvoyées au navigateur : sans adresse e-mail ni suivi interne ; retour = avertie récemment ET en stock.
export async function marquerRetours(rows, { maintenant = Date.now(), catalogue = lireCatalogue } = {}) {
  const liste = Array.isArray(rows) ? rows : [];
  const candidats = liste.filter(r => retourRecent(r, maintenant));
  let cat = {};
  if (candidats.length) { try { cat = await catalogue(candidats.map(r => r.cip)); } catch { cat = {}; } }
  const retours = new Set(candidats.filter(r => enStock(cat[r.cip])).map(r => r.cip));
  return liste.map(r => ({ pharmacy_cip: r.pharmacy_cip, cip: r.cip, product_name: r.product_name ?? null, created_at: r.created_at ?? null,
    notified: r.notified === true, notified_at: r.notified_at ?? null, retour: r.notified === true && retours.has(r.cip) }));
}

// ── E-mail à la pharmacie (charte Elixir : Inter, pétrole et or ; textes échappés) ──
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&nbsp;€`;
const pct = (n) => `−${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}&nbsp;%`;
const couper = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const lienProduit = (cip, site = SITE_PHARMACIES) => `${site}/?cip=${enc(String(cip ?? "").trim())}`;
const dateParis = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.day} ${p.month} à ${p.hour}&nbsp;h&nbsp;${p.minute}`;
};
const POLICE = "font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif";

// produits : [{ cip, nom, prix, prixCatalogue?, remisePct? }] ; pharmacie : nom (facultatif) ; constate : date du stock (ms)
export function emailRetour({ produits, pharmacie = null, constate = Date.now(), site = SITE_PHARMACIES }) {
  const un = produits.length === 1;
  const subject = (un ? `De retour en stock : ${couper(produits[0].nom, 90)}` : `${produits.length} produits que vous attendiez sont de retour en stock`).replace(/[\r\n]+/g, " ");
  const cartes = produits.map(p => `
          <tr><td style="padding:0 0 12px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e3ddd2;border-radius:14px;border-collapse:separate;">
              <tr>
                <td style="padding:16px 18px 6px 18px;${POLICE};">
                  <div style="font-size:15px;line-height:21px;font-weight:600;color:#201917;">${esc(p.nom)}</div>
                  <div style="font-size:12px;line-height:18px;color:#6f6863;margin-top:4px;">CIP ${esc(p.cip)}</div>
                </td>
                <td align="right" valign="top" style="padding:16px 18px 6px 8px;white-space:nowrap;${POLICE};">
                  ${p.remisePct > 0 && p.prixCatalogue ? `<div style="font-size:12px;line-height:18px;color:#6f6863;"><span style="text-decoration:line-through;">${eur(p.prixCatalogue)}</span> <span style="background:#b5904a;color:#201917;font-weight:700;border-radius:999px;padding:1px 6px;">${pct(p.remisePct)}</span></div>` : ""}
                  <div style="font-size:19px;line-height:25px;font-weight:700;color:#201917;">${eur(p.prix)}</div>
                  <div style="font-size:11px;line-height:16px;color:#6f6863;">Prix net HT</div>
                </td>
              </tr>
              <tr><td colspan="2" style="padding:8px 18px 16px 18px;${POLICE};">
                <a href="${esc(lienProduit(p.cip, site))}" style="display:inline-block;background:#0f2d3d;color:#fbf8f2;text-decoration:none;font-size:14px;line-height:20px;font-weight:700;padding:10px 20px;border-radius:999px;">Commander ce produit</a>
              </td></tr>
            </table>
          </td></tr>`).join("");
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4efe4;${POLICE};color:#201917;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4efe4;">${esc(un ? `${couper(produits[0].nom, 80)} est de nouveau disponible chez Elixir Pharma.` : `${produits.length} produits que vous attendiez sont de nouveau disponibles chez Elixir Pharma.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4efe4;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#fbf8f2;border-radius:16px;border-collapse:separate;overflow:hidden;">
      <tr><td style="background:#0f2d3d;padding:20px 28px;${POLICE};">
        <span style="font-size:17px;line-height:24px;font-weight:650;letter-spacing:-0.02em;color:#fbf8f2;">Elixir Pharma</span>
        <span style="font-size:12px;line-height:24px;font-weight:600;color:#d7bb7f;padding-left:10px;">Alerte retour en stock</span>
      </td></tr>
      <tr><td style="padding:30px 28px 6px 28px;${POLICE};">
        <div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#b5904a;">De retour en stock</div>
        <h1 style="margin:8px 0 16px 0;font-size:23px;line-height:30px;font-weight:650;letter-spacing:-0.02em;color:#0f2d3d;">${un ? "Le produit que vous attendiez est disponible" : "Les produits que vous attendiez sont disponibles"}</h1>
        <p style="margin:0 0 10px 0;font-size:15px;line-height:23px;color:#201917;">Bonjour,</p>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:23px;color:#201917;">Vous nous aviez demandé de vous avertir du retour ${un ? "de ce produit" : "de ces produits"}${pharmacie ? ` pour <b>${esc(pharmacie)}</b>` : ""} : ${un ? "il est" : "ils sont"} de nouveau en stock chez Elixir Pharma.</p>
      </td></tr>
      <tr><td style="padding:0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cartes}
        </table>
      </td></tr>
      <tr><td style="padding:8px 28px 26px 28px;${POLICE};font-size:14px;line-height:22px;color:#4b4440;">
        <p style="margin:0 0 10px 0;">Le stock peut partir vite : il a été constaté le ${dateParis(constate)}. Le bouton ouvre le produit dans votre espace de commande Elixir : indiquez la quantité, puis ajoutez-le à votre panier.</p>
        <p style="margin:0;">L'équipe Elixir Pharma</p>
      </td></tr>
      <tr><td style="padding:18px 28px 24px 28px;border-top:1px solid #e3ddd2;${POLICE};font-size:12px;line-height:19px;color:#6f6863;">
        <p style="margin:0 0 8px 0;">Vous recevez cet e-mail parce que vous avez demandé à être averti du retour de ce${un ? "" : "s"} produit${un ? "" : "s"} (bouton « M’avertir du retour » de la Saisie de commande). Cet avertissement n'est envoyé qu'une seule fois par demande.</p>
        <p style="margin:0 0 8px 0;">Pour ne plus en recevoir : retirez vos alertes en cours dans la Saisie de commande (bouton « Alerte activée »), ou répondez simplement à cet e-mail.</p>
        <p style="margin:0;">Elixir Pharma · pharmacien@elixirpharma.fr · 01 86 04 39 95</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return { subject, html };
}

// ── Passage : détection, clôtures, envois ──
// source : "planifie" | "synchro" (GitHub Action) | "admin" ; budgetMs : durée de travail avant de rendre la main
// (fonction HTTP : 10 s au plus ; planifiée : 30 s) ; horsFenetre : envoyer même hors 7 h – 21 h (admin).
// → bilan { envoyes, pharmacies, produits, closes, echecs, restants, done, erreurs, lignes… } (lignes : noms, jamais d'adresse)
export async function passage({ source = "admin", budgetMs = 5000, horsFenetre = false, maintenant = () => Date.now(), envoyer = sendMail,
  attendre = (ms) => new Promise(r => setTimeout(r, ms)), journaliser = true } = {}) {
  const debut = maintenant();
  const iso = new Date(debut).toISOString();
  const b = { at: iso, source, mode: null, envoyes: 0, pharmacies: 0, produits: 0, closes: { ancienne: 0, destinataire: 0, echec: 0, interrompu: 0 },
    echecs: 0, deja_pris: 0, restants: 0, hors_fenetre: false, done: true, erreur: null, erreurs: [], lignes: [] };
  const noms = new Map();
  const ligne = (r, issue, extra = {}) => b.lignes.push({ pharmacy_cip: String(r.pharmacy_cip ?? "").trim(), cip: r.cip, produit: r.product_name || null, issue, ...extra });
  const destinataires = new Set();
  try {
    const cols = await lireColonnes();
    if (!cols) { b.mode = "vide"; return await fin(); }
    const complet = COLONNES_SUIVI.every(c => cols.has(c));
    b.mode = complet ? "complet" : "reduit";
    const garder = (patch) => Object.fromEntries(Object.entries(patch).filter(([k]) => cols.has(k)));
    const maintenantIso = () => new Date(maintenant()).toISOString();

    // 1. envois interrompus (réservés depuis plus de 15 min sans compte rendu) : jamais renvoyés d'office
    if (complet) {
      const r = await sb(`restock_alerts?outcome=eq.envoi&notified_at=lt.${enc(new Date(debut - RECLAMATION_PERIMEE_MS).toISOString())}`,
        { method: "PATCH", body: { outcome: "interrompu" }, prefer: "return=representation" });
      if (r.ok) for (const x of r.data || []) { b.closes.interrompu++; ligne(x, "interrompu"); }
      else b.erreurs.push(`envois interrompus non repérés (HTTP ${r.status})`);
    }

    // 2. demandes de plus de 60 jours : closes sans e-mail (une requête, conditionnelle : notified=eq.false)
    const limite = new Date(debut - AGE_MAX_JOURS * JOUR).toISOString();
    const rv = await sb(`restock_alerts?notified=eq.false&created_at=lt.${enc(limite)}`,
      { method: "PATCH", body: garder({ notified: true, notified_at: iso, outcome: "ancienne" }), prefer: "return=representation" });
    if (rv.ok) for (const x of rv.data || []) { b.closes.ancienne++; ligne(x, "ancienne"); }
    else b.erreurs.push(`demandes anciennes non closes (HTTP ${rv.status}) : écartées de l'envoi`);

    // 3. demandes en attente (60 jours au plus) dont le produit est de retour (règle de la Saisie)
    const attente = (await lireAttente()).filter(r => Date.parse(r.created_at) >= Date.parse(limite));
    if (!attente.length) return await fin();
    const cat = await lireCatalogue(attente.map(r => r.cip));
    const pretes = attente.filter(r => enStock(cat[String(r.cip).trim()]));
    if (!pretes.length) return await fin();

    // 4. un groupe par pharmacie et adresse (un e-mail), la demande la plus ancienne d'abord
    const groupes = new Map();
    for (const r of pretes) {
      const g = `${String(r.pharmacy_cip).trim()}|${String(r.pharmacy_email ?? "").trim()}`;
      // brut : valeur enregistrée (filtre des écritures) ; email : adresse d'envoi
      if (!groupes.has(g)) groupes.set(g, { pharmacy_cip: String(r.pharmacy_cip).trim(), brut: r.pharmacy_email ?? null, email: String(r.pharmacy_email ?? "").trim(), rows: [] });
      groupes.get(g).rows.push(r);
    }
    const tous = [...groupes.values()];

    // 5. destinataire : l'adresse de la demande, seulement si c'est encore un compte de CE CIP (elixir_pharmacies)
    const comptes = await lireComptes([...new Set(tous.map(g => g.email.toLowerCase()).filter(e => e.includes("@")))]);
    for (const g of tous) {
      const c = (comptes.get(g.email.toLowerCase()) || []).find(x => String(x.cip ?? "").trim() === g.pharmacy_cip);
      if (c) { g.valide = true; g.nom = c.name || null; if (c.name) noms.set(g.pharmacy_cip, c.name); }
    }
    // filtre d'écriture d'un groupe : même pharmacie, même adresse enregistrée (une demande refaite entre-temps depuis un
    // autre compte n'est pas prise) ; sans adresse, le CIP suffit (une seule demande par pharmacie et produit : clé primaire)
    const filtreGroupe = (g, cips) => `restock_alerts?${egal("pharmacy_cip", g.pharmacy_cip)}${g.brut ? `&${egal("pharmacy_email", g.brut)}` : ""}&${dans("cip", cips)}`;
    for (const g of tous.filter(x => !x.valide)) {
      const r = await sb(`${filtreGroupe(g, g.rows.map(x => x.cip))}&notified=eq.false`,
        { method: "PATCH", body: garder({ notified: true, notified_at: maintenantIso(), outcome: "destinataire" }), prefer: "return=representation" });
      if (r.ok) for (const x of r.data || []) { b.closes.destinataire++; ligne(x, "destinataire"); }
      else b.erreurs.push(`clôture « destinataire » impossible (HTTP ${r.status})`);
    }
    const valides = tous.filter(g => g.valide)
      .sort((x, y) => Math.min(...x.rows.map(r => Date.parse(r.created_at))) - Math.min(...y.rows.map(r => Date.parse(r.created_at))));
    if (!valides.length) return await fin();
    if (envoyer === sendMail && !process.env.RESEND_API_KEY) {
      b.restants = valides.length; b.erreurs.push("RESEND_API_KEY absent des variables Netlify : aucun e-mail envoyé");
      return await fin();
    }
    if (!horsFenetre && !dansFenetre(debut)) { b.hors_fenetre = true; b.restants = valides.length; return await fin(); }

    // 6. envois : réservation conditionnelle, e-mail, compte rendu
    let dernierEnvoi = -Infinity;
    const rendre = async (rows, compter) => {
      for (const r of rows) {
        let n = complet ? Number(r.attempts) || 0 : 0;
        const cleEssais = `${PREFIXE_ESSAIS}${String(r.pharmacy_cip).trim()}:${r.cip}`;
        if (compter) {
          if (complet) n += 1;
          else {
            const v = await kvGet(cleEssais).catch(() => null);
            n = (v && v.created_at === r.created_at ? Number(v.n) || 0 : 0) + 1;
          }
        }
        const cible = `restock_alerts?${egal("pharmacy_cip", r.pharmacy_cip)}&${egal("cip", r.cip)}&${complet ? "outcome=eq.envoi" : "notified=eq.true"}`;
        if (compter && n >= ESSAIS_MAX) {   // close : la réservation reste (notified=true), issue « echec »
          if (complet) await sb(cible, { method: "PATCH", body: { outcome: "echec", attempts: n } });
          b.closes.echec++; ligne(r, "echec");
          continue;
        }
        if (!complet && compter) await kvSet(cleEssais, { n, created_at: r.created_at }).catch(() => {});
        const rr = await sb(cible, { method: "PATCH", body: garder({ notified: false, notified_at: null, outcome: null, ...(complet ? { attempts: n } : {}) }) });
        if (!rr.ok) b.erreurs.push(`réservation non rendue (HTTP ${rr.status}) : demande gardée avertie`);
      }
    };
    for (let i = 0; i < valides.length; i++) {
      const g = valides[i];
      if (maintenant() - debut > budgetMs) { b.restants = valides.length - i; b.done = false; break; }
      const rc = await sb(`${filtreGroupe(g, g.rows.map(x => x.cip))}&notified=eq.false`,
        { method: "PATCH", body: garder({ notified: true, notified_at: maintenantIso(), outcome: "envoi" }), prefer: "return=representation" });
      if (!rc.ok) { b.erreurs.push(`réservation impossible (HTTP ${rc.status})`); b.restants++; continue; }
      const pris = (Array.isArray(rc.data) ? rc.data : []).filter(r => enStock(cat[String(r.cip).trim()]));
      if (!pris.length) { b.deja_pris++; continue; }   // un autre passage s'en occupe
      const pause = dernierEnvoi + ESPACEMENT_MS - maintenant();
      if (pause > 0) await attendre(pause);
      const produits = pris.map(r => {
        const p = cat[String(r.cip).trim()];
        const remise = !!p.discounted_price && Number(p.discount_pct) > 0;
        return { cip: String(r.cip).trim(), nom: r.product_name || p.name || String(r.cip), prix: prixNet(p),
          ...(remise ? { prixCatalogue: Number(p.list_price) || null, remisePct: Number(p.discount_pct) } : {}) };
      });
      const mail = emailRetour({ produits, pharmacie: g.nom, constate: debut });
      let res;
      try { res = await envoyer({ to: g.email, subject: mail.subject, html: mail.html }); }
      catch (e) { res = { sent: false, reason: e?.message || String(e) }; }
      dernierEnvoi = maintenant();
      if (res?.sent) {
        if (complet) {
          const rf = await sb(`${filtreGroupe(g, pris.map(r => r.cip))}&outcome=eq.envoi`, { method: "PATCH", body: { outcome: "envoye" } });
          if (!rf.ok) b.erreurs.push(`e-mail parti, issue non notée (HTTP ${rf.status})`);
        }
        b.envoyes++; b.produits += pris.length; destinataires.add(g.pharmacy_cip);
        produits.forEach((p, k) => ligne(pris[k], "envoye", { prix: p.prix }));
        continue;
      }
      const motif = sansAdresse(res?.reason || "envoi refusé");
      if (/429|too many|rate.?limit/i.test(motif)) {   // limite de débit : rien n'est compté, reprise au passage suivant
        await rendre(pris, false);
        b.restants += valides.length - i; b.done = false;
        b.erreurs.push(`Resend : limite de débit (${motif}), reprise au passage suivant`);
        break;
      }
      b.echecs++; b.erreurs.push(`envoi refusé (${motif})`);
      await rendre(pris, true);
    }
  } catch (e) {
    b.erreur = sansAdresse(e?.message || e); b.done = true;
  }
  return await fin();

  async function fin() {
    b.pharmacies = destinataires.size;
    const manquants = [...new Set(b.lignes.map(l => l.pharmacy_cip).filter(c => !noms.has(c)))];
    if (manquants.length) { try { for (const [k, v] of await lireNoms(manquants)) noms.set(k, v); } catch { /* noms facultatifs */ } }
    for (const l of b.lignes) l.pharmacie = noms.get(l.pharmacy_cip) || null;
    b.duree_ms = maintenant() - debut;
    const { lignes, ...resume } = b;
    console.log(`[restock-notify] ${source} (${b.mode}) : ${b.envoyes} e-mail(s), ${b.produits} produit(s), closes ${JSON.stringify(b.closes)}, ` +
      `${b.echecs} échec(s), ${b.restants} restant(s)${b.hors_fenetre ? " (hors 7 h – 21 h)" : ""}${b.erreur ? `, erreur : ${b.erreur}` : ""}`);
    if (journaliser) {
      if (lignes.length || b.erreurs.length || b.erreur) {
        await kvSet(`${PREFIXE_PASSAGE}${iso}:${Math.random().toString(36).slice(2, 6)}`, b).catch(e => console.error("[restock-notify] journal", e.message));
      }
      await kvSet(CLE_DERNIER, { ...resume, lignes: lignes.length }).catch(() => {});
    }
    return b;
  }
}

// Chiffres seulement (réponse à la GitHub Action et à l'admin) : ni nom, ni adresse, ni ligne
export const chiffres = (b) => ({ done: b.done, mode: b.mode, envoyes: b.envoyes, pharmacies: b.pharmacies, produits: b.produits, closes: b.closes,
  echecs: b.echecs, deja_pris: b.deja_pris, restants: b.restants, hors_fenetre: b.hors_fenetre, erreurs: b.erreurs, ...(b.erreur ? { error: b.erreur } : {}) });

// Journal de plus de 60 jours, essais du mode réduit de plus de 90 jours (passage planifié)
export async function menageJournal(maintenant = Date.now()) {
  await kvDeleteOlder(PREFIXE_PASSAGE, new Date(maintenant - JOURNAL_JOURS * JOUR).toISOString());
  await kvDeleteOlder(PREFIXE_ESSAIS, new Date(maintenant - 90 * JOUR).toISOString());
}

// ── Admin : tableau de bord (aucune adresse e-mail) ──
export async function apercu({ maintenant = Date.now() } = {}) {
  const cols = await lireColonnes();
  const complet = cols ? COLONNES_SUIVI.every(c => cols.has(c)) : null;
  const toutes = cols ? await lireAttente() : [];
  const limite = maintenant - AGE_MAX_JOURS * JOUR;
  const actives = toutes.filter(r => Date.parse(r.created_at) >= limite);
  const cat = actives.length ? await lireCatalogue(actives.map(r => r.cip)) : {};
  let interrompus = [];
  if (complet) {
    const r = await sb("restock_alerts?outcome=eq.interrompu&notified=eq.true&select=pharmacy_cip,cip,product_name,notified_at&order=notified_at.desc&limit=100");
    if (r.ok && Array.isArray(r.data)) interrompus = r.data;
  }
  const noms = await lireNoms([...actives, ...interrompus].map(r => r.pharmacy_cip)).catch(() => new Map());
  const produits = new Map();
  const emails = new Set();
  let alertesPretes = 0;
  for (const r of actives) {
    const cip = String(r.cip).trim();
    const p = cat[cip];
    if (!produits.has(cip)) produits.set(cip, { cip, nom: r.product_name || p?.name || cip, connu: !!p, en_stock: p?.in_stock === true,
      prix: prixNet(p), pret: enStock(p), plus_ancienne: r.created_at, pharmacies: [] });
    const e = produits.get(cip);
    e.pharmacies.push({ nom: noms.get(String(r.pharmacy_cip).trim()) || null, cip: String(r.pharmacy_cip).trim(), depuis: r.created_at });
    if (Date.parse(r.created_at) < Date.parse(e.plus_ancienne)) e.plus_ancienne = r.created_at;
    if (e.pret) { alertesPretes++; emails.add(`${String(r.pharmacy_cip).trim()}|${String(r.pharmacy_email ?? "").trim().toLowerCase()}`); }
  }
  const liste = [...produits.values()].map(e => ({ ...e, attente: e.pharmacies.length }))
    .sort((a, b) => b.attente - a.attente || Date.parse(a.plus_ancienne) - Date.parse(b.plus_ancienne));
  const passages = await lirePassages(maintenant - HISTORIQUE_JOURS * JOUR);
  const recents = passages.flatMap(p => (p.lignes || []).map(l => ({ at: p.at, source: p.source, pharmacie: l.pharmacie || null,
    pharmacy_cip: l.pharmacy_cip, cip: l.cip, produit: l.produit, issue: l.issue, prix: l.prix ?? null }))).slice(0, 300);
  return {
    mode: cols ? (complet ? "complet" : "reduit") : "vide",
    regles: { age_max_jours: AGE_MAX_JOURS, recent_jours: RECENT_JOURS, essais_max: ESSAIS_MAX, fenetre: FENETRE, dans_fenetre: dansFenetre(maintenant) },
    totaux: { en_attente: actives.length, pharmacies_en_attente: new Set(actives.map(r => String(r.pharmacy_cip).trim())).size,
      anciennes: toutes.length - actives.length, alertes_pretes: alertesPretes, emails_prets: emails.size, produits_prets: liste.filter(p => p.pret).length },
    produits: liste.slice(0, 200),
    recents,
    passages: passages.slice(0, 15).map(({ lignes, ...p }) => ({ ...p, lignes: Array.isArray(lignes) ? lignes.length : 0 })),
    dernier: await kvGet(CLE_DERNIER).catch(() => null),
    interrompus: interrompus.map(r => ({ pharmacy_cip: r.pharmacy_cip, pharmacie: noms.get(String(r.pharmacy_cip).trim()) || null, cip: r.cip, produit: r.product_name, at: r.notified_at })),
  };
}

// Admin : envoi interrompu vérifié non reçu (Resend) → la demande repart au prochain passage
export async function relancer({ pharmacy_cip, cip }) {
  if (!pharmacy_cip || !cip) return { ok: false, statut: 400, error: "pharmacy_cip et cip requis" };
  const r = await sb(`restock_alerts?${egal("pharmacy_cip", pharmacy_cip)}&${egal("cip", cip)}&outcome=eq.interrompu`,
    { method: "PATCH", body: { notified: false, notified_at: null, outcome: null }, prefer: "return=representation" });
  if (!r.ok) return { ok: false, statut: colonneManquante(r.text) ? 409 : 502, error: colonneManquante(r.text) ? "Colonnes de suivi absentes (sql/restock-notify.sql)" : `HTTP ${r.status}` };
  return (r.data || []).length ? { ok: true } : { ok: false, statut: 404, error: "Aucun envoi interrompu pour cette demande" };
}
