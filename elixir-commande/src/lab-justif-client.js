// ── Commandes sur justificatif labo : côté site ─────────────────────────
// Produits que certains labos ne livrent que sur justificatif de commande de pharmacie
// (réglés dans l'admin, onglet « Justificatifs labos »). Ces lignes sont commandables même
// sans stock ; elles partent dans une commande à part (source « justificatif »), jamais
// transmise automatiquement à PharmaML : Elixir commande au labo avec le justificatif, puis
// synchronise la commande de la pharmacie à réception.
let cache = null;
// fresh : lecture directe (stock du moment, juste avant l'envoi) ; null si le service ne répond pas
export function loadJustifProducts({ fresh = false } = {}) {
  if (fresh) return fetch(`/.netlify/functions/lab-justif?action=products&t=${Date.now()}`, { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null)).then(j => j?.products || null).catch(() => null);
  if (!cache || Date.now() - cache.at > 5 * 60e3) {
    const p = Promise.resolve()
      .then(() => fetch("/.netlify/functions/lab-justif?action=products"))
      .then(r => (r.ok ? r.json() : null)).then(j => j?.products || {}).catch(() => ({}));
    const entry = { at: Date.now(), p };
    cache = entry;
    p.then(x => { if (!Object.keys(x).length && cache === entry) cache = null; });
  }
  return cache.p;
}

// Ligne à commander au labo sur justificatif : produit concerné ET stock d'Elixir insuffisant
// (servie sur le stock, elle part comme une commande normale)
// totals = quantités additionnées par CIP (un même produit sur deux lignes du panier)
export const needsJustif = (item, products, totals) => {
  const r = item?.cip && products[item.cip];
  return !!r && !(Number(r.dispo) >= Number(totals?.[item.cip] ?? item.qty));
};
export const qtyByCip = (items) => { const t = {}; for (const i of items) if (i.cip) t[i.cip] = (t[i.cip] || 0) + (Number(i.qty) || 0); return t; };
// ordonnance déposée il y a plus de 36 h : effacée côté serveur après 2 jours sans commande → à redéposer
export const RX_FRAIS_MS = 36 * 3600e3;
export const rxFrais = (x) => !!x?.id && Date.now() - (Number(x.at) || 0) < RX_FRAIS_MS;

// Ce qui manque avant l'envoi, ligne par ligne → [{ cip, name, msg }]
export function justifIssues(items, products, info) {
  const out = [];
  const totals = qtyByCip(items), vus = new Set();
  for (const i of items) {
    if (!needsJustif(i, products, totals) || vus.has(i.cip)) continue;
    vus.add(i.cip);
    const r = products[i.cip];
    const inf = info[i.cip] || {};
    if (!inf.attestation) out.push({ cip: i.cip, name: i.name, msg: "cochez l'attestation « patient en France »" });
    if ((inf.rx || []).some(x => x.id && !rxFrais(x))) out.push({ cip: i.cip, name: i.name, msg: "ordonnance déposée il y a plus de 36 h : retirez-la et joignez-la à nouveau" });
    else if (r.ordonnance === "obligatoire" && !(inf.rx || []).length) out.push({ cip: i.cip, name: i.name, msg: "joignez l'ordonnance anonymisée" });
    if (r.maxCommande && totals[i.cip] > r.maxCommande) out.push({ cip: i.cip, name: i.name, msg: `${r.maxCommande} au plus par commande (règle ${r.labNom})` });
    if ((inf.rx || []).some(x => x.uploading)) out.push({ cip: i.cip, name: i.name, msg: "envoi de l'ordonnance en cours" });
  }
  return out;
}

// Photo → JPEG ≤ 1800 px (une ordonnance photographiée pèse souvent 4-8 Mo)
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image illisible")); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.82));
    return { blob, mime: "image/jpeg", name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } finally { URL.revokeObjectURL(url); }
}
const toBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = () => rej(new Error("lecture du fichier impossible"));
  r.readAsDataURL(blob);
});

// Jeton pharmacie à jour (il expire après une heure ; le site ne le renouvelle qu'à l'ouverture)
export async function freshPharmacyToken() {
  const rt = localStorage.getItem("pharmacy_refresh_token");
  if (rt) {
    try {
      const r = await fetch("/.netlify/functions/admin-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) });
      const j = await r.json();
      if (j.success && j.token) {
        localStorage.setItem("pharmacy_token", j.token);
        if (j.refresh_token) localStorage.setItem("pharmacy_refresh_token", j.refresh_token);
      }
    } catch { /* jeton actuel */ }
  }
  return localStorage.getItem("pharmacy_token");
}
// auth = { token } ou { getToken: async () => jeton, odooId }
const jeton = async (auth) => (auth?.getToken ? await auth.getToken() : auth?.token) || "";

// Dépôt d'une ordonnance → { id, name } (erreur explicite sinon)
export async function uploadPrescription(file, auth = {}) {
  const { odooId } = auth;
  let f = { blob: file, mime: file.type, name: file.name };
  if (/^image\//.test(file.type)) f = await compressImage(file);
  else if (file.type !== "application/pdf") throw new Error("Format non accepté : PDF, JPEG ou PNG");
  if (f.blob.size > 3.3e6) throw new Error("Fichier trop lourd (3 Mo au plus)");
  const data_base64 = await toBase64(f.blob);
  const token = await jeton(auth);
  const res = await fetch("/.netlify/functions/lab-justif", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action: "rx_upload", name: f.name, mime: f.mime, data_base64, ...(odooId ? { odoo_id: odooId } : {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id) throw new Error(j.error || `Dépôt impossible (HTTP ${res.status})`);
  return { id: j.id, name: f.name };
}

// Transmission des lignes « sur justificatif » d'une commande enregistrée
export async function submitJustif(orderId, lignes, auth = {}) {
  const envoi = async (token) => fetch("/.netlify/functions/lab-justif", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action: "submit", order_id: orderId, lignes, ...(auth.odooId ? { odoo_id: auth.odooId } : {}) }),
  });
  let res = await envoi(await jeton(auth));
  if (res.status === 401 && !auth.odooId) res = await envoi(await freshPharmacyToken());   // jeton expiré : un renouvellement
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

// Appel pharmacie (ou admin en saisie) au module ; un jeton expiré est renouvelé une fois
async function appel(body, auth = {}) {
  const envoi = async (token) => fetch("/.netlify/functions/lab-justif", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...body, ...(auth.odooId ? { odoo_id: auth.odooId } : {}) }),
  });
  let res = await envoi(await jeton(auth));
  if (res.status === 401 && !auth.odooId) res = await envoi(await freshPharmacyToken());
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status, code: j.code || null, sansFiche: !!j.sansFiche, items: j.items || null, cip: j.cip || null });
  return j;
}
// Page « Commande labo sur justificatif » : commande + demandes au labo en un seul appel.
// orderId fourni par le site (13 chiffres) : un renvoi après coupure ne crée jamais une 2e commande.
// Erreur : { status (0 = réseau), code (« contenu », « numero », « stock »), sansFiche, items (contenu déjà enregistré) }
export const commanderJustif = (orderId, lignes, auth) => appel({ action: "commander", order_id: String(orderId), lignes }, auth)
  .catch(e => { if (e.status === undefined) e.status = 0; throw e; });
export const mesDemandesJustif = (auth) => appel({ action: "mes_demandes" }, auth).then(j => j.demandes || []);

export const JUSTIF_STATUTS = {
  en_attente: "Enregistrée — transmission au laboratoire par Elixir",
  a_envoyer: "Transmission au laboratoire en cours",
  en_cours: "Transmission au laboratoire en cours",
  a_verifier: "Enregistrée — vérification par Elixir avant transmission",
  bloquee: "Enregistrée — Elixir vous contactera",
  erreur: "Transmission au laboratoire en cours",
  envoye: "Justificatif transmis au laboratoire",
  ignoree: "Non transmise au laboratoire",
};
