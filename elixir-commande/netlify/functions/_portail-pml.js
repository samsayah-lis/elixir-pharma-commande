// Client du portail maison. Aucun identifiant ne sort de ce module.
// Le login n'est masqué que s'il est long : un login court (« elixir ») défigurerait les adresses et les messages.
const secrets = () => [String(process.env.PML_INJECTION_U || "").length >= 12 ? process.env.PML_INJECTION_U : "", process.env.PML_INJECTION_P, process.env.PML_CLE_LECTURE].filter(Boolean);
export function masquer(v) {
  let s = String(v ?? "");
  for (const secret of secrets().sort((a, b) => b.length - a.length)) {
    for (const forme of new Set([secret, encodeURIComponent(secret), new URLSearchParams({ v: secret }).toString().slice(2), JSON.stringify(secret).slice(1, -1)])) s = s.split(forme).join("***");
  }
  return s;
}
const nettoyer = v => JSON.parse(masquer(JSON.stringify(v)));
const base = () => (process.env.PML_PORTAIL_URL || "https://pml.elixirpharma.fr").replace(/\/+$/, "");
export const configurationPortail = () => ({ url: masquer(base()), injection: !!(process.env.PML_INJECTION_U && process.env.PML_INJECTION_P), lecture: !!process.env.PML_CLE_LECTURE, manquantes: ["PML_INJECTION_U", "PML_INJECTION_P", "PML_CLE_LECTURE"].filter(k => !process.env[k]) });
export async function injecter(corps, { timeoutMs = 15000 } = {}) {
  const debut = Date.now(), envoyeA = new Date().toISOString();
  let http = 0, texte = "", json = null, erreur = null;
  try {
    if (!configurationPortail().injection) throw new Error("identifiants d'injection absents");
    const url = new URL(`${base()}/commandes.php`);
    url.searchParams.set("U", process.env.PML_INJECTION_U); url.searchParams.set("P", process.env.PML_INJECTION_P);
    const r = await fetch(url, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))) });
    http = r.status;
    const brut = await r.text();
    texte = masquer(brut).slice(0, 4000);
    try { json = nettoyer(JSON.parse(brut)); } catch { /* réponse illisible */ }
  } catch (e) { erreur = masquer(e.message || e).slice(0, 500); }
  return { http, texte, json, erreur, ms: Date.now() - debut, envoyeA };
}
async function lire(path, timeoutMs, absent = false) {
  try {
    if (!configurationPortail().lecture) throw new Error("clé de lecture absente");
    const r = await fetch(`${base()}${path}`, { redirect: "manual", headers: { Authorization: `Bearer ${process.env.PML_CLE_LECTURE}` }, signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))) });
    if (absent && r.status === 404) return null;
    if (r.status !== 200) throw new Error(`lecture portail : HTTP ${r.status}`);
    return nettoyer(await r.json());
  } catch (e) { throw new Error(masquer(e.message || e)); }
}
export async function lireOfficine(idOfficine, { timeoutMs = 5000 } = {}) {
  const j = await lire(`/api/v1/officines?id_officine=${encodeURIComponent(idOfficine)}`, timeoutMs);
  if (!Array.isArray(j.officines)) throw new Error("réponse officines invalide");
  const officine = j.officines.find(o => String(o.id_officine) === String(idOfficine));
  return officine ? { trouvee: true, officine } : { trouvee: false };
}
export async function lireCommandes({ officines, produits, depuis, jusquA, statut = "recue,repondue", statutErp = "tous", limite = 500, maxPages = 20, timeoutMs = 8000 } = {}) {
  const p = new URLSearchParams({ statut, statut_erp: statutErp, limite: String(limite) });
  if (officines) p.set("officine", [].concat(officines).join(","));
  if (produits) p.set("produit", [].concat(produits).join(","));
  for (const [k, v] of [["depuis", depuis], ["jusqu_a", jusquA]]) if (v != null) p.set(k, new Date(v).toISOString());
  const commandes = [], fin = Date.now() + timeoutMs;
  for (let i = 0; i < maxPages; i++) {
    if (Date.now() >= fin) throw new Error("délai de lecture portail dépassé");
    const j = await lire(`/api/v1/commandes?${p}`, fin - Date.now());
    if (!Array.isArray(j.commandes)) throw new Error("réponse commandes invalide");
    commandes.push(...j.commandes);
    if (!j.curseur_suivant) return { commandes, complet: true };
    p.set("curseur", j.curseur_suivant);
  }
  return { commandes, complet: false };
}
export const lireCommande = (id, { timeoutMs = 8000 } = {}) => lire(`/api/v1/commandes/${encodeURIComponent(id)}`, timeoutMs, true);
export function memeContenu(p, c) {
  if (!p || !c || p.ref_cde_client !== c.referenceCommande || !Array.isArray(p.lignes) || !Array.isArray(c.lignes)) return false;
  if (p.lignes.some(l => !l || typeof l.code_produit !== "string" || !Number.isInteger(l.quantite) || l.quantite < 0)
    || c.lignes.some(l => !l || typeof l.CIP !== "string" || !Number.isInteger(l.quantiteCommandee) || l.quantiteCommandee < 0)) return false;
  const signature = (ls, code, q) => ls.map(l => JSON.stringify([String(l[code]), Number(l[q])])).sort();
  return JSON.stringify(signature(p.lignes, "code_produit", "quantite")) === JSON.stringify(signature(c.lignes, "CIP", "quantiteCommandee"));
}
export async function testerPortail() {
  const r = await injecter([]);
  const bon = r.http === 400 && /Format invalide/i.test(r.json?.message || "");
  const injection = { http: r.http, message: bon ? "identifiants et hôte valides" : r.http === 401 ? "identifiants refusés" : r.http === 404 ? "hôte inconnu du portail" : r.erreur || r.json?.message || "réponse inattendue" };
  let lecture;
  try { await lireCommandes({ depuis: new Date(Date.now() - 60000), limite: 1 }); lecture = { ok: true, message: "clé de lecture valide" }; }
  catch (e) { lecture = { ok: false, message: masquer(e.message) }; }
  return { ok: bon && lecture.ok, voie: "portail", injection, lecture };
}

export function sources() {
  const liste = process.env.PML_SOURCES === undefined
    ? ["infosoft", ...(configurationPortail().lecture ? ["portail"] : [])]
    : process.env.PML_SOURCES.split(",").map(s => s.trim()).filter(s => ["infosoft", "portail"].includes(s));
  return liste.length ? [...new Set(liste)] : ["infosoft"];
}
export function parisTexte(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export function lignesFormatInfosoft(c) {
  return c.lignes.map(l => ({ DateCommande: parisTexte(c.recue_le), Identifiant: c.officine.id_officine,
    RaisonSociale: c.officine.raison_sociale, ReferenceCommande: c.ref_cde_client,
    CodeProduit: l.cip13_reconnu ?? l.code_produit, Libelle: l.designation ?? "",
    QuantiteCommandee: l.quantite, QuantiteLivree: l.quantite_livree ?? 0,
    ID_Adherent: `pml:${c.officine.id_officine}`, source: "portail", idCommandePortail: c.id, canal: c.canal, statut: c.statut }));
}
