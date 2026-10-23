// ── API des pharmacies : clés d'accès (format, empreinte, cycle de vie) et réseaux ──
// Format : « elx_live_ » ou « elx_test_ », 40 caractères base62 aléatoires (≈ 238 bits), « _ », 6 caractères de somme de
// contrôle (CRC32 du début, en base62 : modèle des jetons GitHub). La somme de contrôle rejette sans lecture en base une
// clé mal recopiée et permet de repérer une fuite dans un dépôt (scripts/verifie-zones.mjs).
// Stockage : empreinte SHA-256 (hex) et préfixe d'affichage « elx_live_Ab3d…k9Qz » ; la clé elle-même n'est montrée
// qu'UNE fois, à sa création. Un hachage lent n'apporte rien pour une clé de cette entropie.
import crypto from "node:crypto";
import { prefixeIp } from "./rate-limit.js";
import { CGU, CLES_ACTIVES_MAX, ENVIRONNEMENTS, PORTEES, ROTATION_JOURS } from "./_api-config.js";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PREFIXES = { live: "elx_live_", test: "elx_test_" };
export const RE_CLE = /^elx_(live|test)_([0-9A-Za-z]{40})_([0-9A-Za-z]{6})$/;

// base62 sans biais : octets ≥ 248 (= 4 × 62) écartés
function aleatoireB62(n, octets) {
  let s = "";
  while (s.length < n) for (const b of octets(n * 2)) { if (b < 248) s += B62[b % 62]; if (s.length === n) break; }
  return s;
}
const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
export function crc32(texte) {
  let c = 0xffffffff;
  for (const b of Buffer.from(String(texte), "utf8")) c = TABLE_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function base62(n, longueur) {
  let s = "";
  do { s = B62[n % 62] + s; n = Math.floor(n / 62); } while (n > 0);
  return s.padStart(longueur, "0");
}
export const sommeControle = (corps) => base62(crc32(corps), 6);

// octets(n) → Buffer de n octets aléatoires (injectable pour les tests)
export function genererCle(environnement, octets = crypto.randomBytes) {
  if (!PREFIXES[environnement]) throw new Error("environnement inconnu");
  const corps = PREFIXES[environnement] + aleatoireB62(40, octets);
  return `${corps}_${sommeControle(corps)}`;
}
// → { environnement } si le format et la somme de contrôle sont bons, sinon null (aucune lecture en base)
export function analyserCle(cle) {
  const m = RE_CLE.exec(String(cle || ""));
  if (!m || sommeControle(`elx_${m[1]}_${m[2]}`) !== m[3]) return null;
  return { environnement: m[1] };
}
export const empreinteCle = (cle) => crypto.createHash("sha256").update(String(cle)).digest("hex");
export function prefixeCle(cle) {
  const m = RE_CLE.exec(String(cle || ""));
  return m ? `elx_${m[1]}_${m[2].slice(0, 4)}…${m[3].slice(-4)}` : null;
}
// Clé transmise en Bearer → texte (ou "" si absente)
export const cleDeRequete = (event) => {
  const h = event?.headers || {};
  const brut = String(h.authorization || h.Authorization || "").trim();
  const m = /^Bearer\s+(\S+)$/i.exec(brut);
  return m ? m[1] : brut ? "\u0000" : "";   // en-tête présent mais pas « Bearer <clé> » : clé invalide
};

// ── Réseaux ──
// réseau journalisé : IPv4 → /24, IPv6 → /64 (jamais l'adresse complète)
export function reseauDe(ip) {
  const s = String(ip || "").trim().toLowerCase();
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!s.includes(":")) return null;
  return prefixeIp(s);
}
// adresse → { v: 4 | 6, n: BigInt } ou null
function ipEnNombre(ip) {
  const s = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some(x => x > 255)) return null;
    return { v: 4, n: o.reduce((n, x) => (n << 8n) + BigInt(x), 0n) };
  }
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  const moities = s.split("::");
  if (moities.length > 2) return null;
  const groupes = (x) => {
    if (!x) return [];
    const g = x.split(":");
    const fin = g[g.length - 1];
    if (fin.includes(".")) {
      const q = ipEnNombre(fin);
      if (!q || q.v !== 4) return null;
      g.splice(g.length - 1, 1, ((q.n >> 16n) & 0xffffn).toString(16), (q.n & 0xffffn).toString(16));
    }
    return g;
  };
  const tete = groupes(moities[0]), queue = moities.length === 2 ? groupes(moities[1]) : [];
  if (!tete || !queue) return null;
  const manque = 8 - tete.length - queue.length;
  if ((moities.length === 2 && manque < 1) || (moities.length === 1 && manque !== 0)) return null;
  const tous = [...tete, ...Array(Math.max(0, manque)).fill("0"), ...queue];
  if (tous.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return { v: 6, n: tous.reduce((n, g) => (n << 16n) + BigInt(parseInt(g, 16)), 0n) };
}
// « 203.0.113.0/24 », « 2001:db8::/32 » ou adresse seule → forme normalisée, ou null si illisible
export function cidrValide(texte) {
  const [adr, l, reste] = String(texte || "").trim().split("/");
  if (reste !== undefined) return null;
  const ip = ipEnNombre(adr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const long = l === undefined ? max : /^\d{1,3}$/.test(l) ? Number(l) : -1;
  if (long < (ip.v === 4 ? 8 : 16) || long > max) return null;
  return `${adr.trim().toLowerCase()}/${long}`;
}
export function ipDansListe(ip, liste) {
  const a = ipEnNombre(ip);
  if (!a) return false;
  return (liste || []).some((c) => {
    const [adr, l] = String(c).split("/");
    const b = ipEnNombre(adr);
    if (!b || b.v !== a.v) return false;
    const max = a.v === 4 ? 32 : 128, long = Number(l ?? max);
    const decal = BigInt(max - long);
    return (a.n >> decal) === (b.n >> decal);
  });
}

// ── Cycle de vie ──
// État d'une clé : active | remplacee (valide jusqu'à expire_le) | expiree | revoquee
export function etatCle(cle, maintenant = new Date()) {
  if (cle?.revoquee_le) return "revoquee";
  if (cle?.expire_le && Date.parse(cle.expire_le) <= maintenant.getTime()) return "expiree";
  if (cle?.expire_le) return "remplacee";
  return "active";
}
export const cleUtilisable = (cle, maintenant = new Date()) => ["active", "remplacee"].includes(etatCle(cle, maintenant));

// Ce que voit la pharmacie (admin : + creee_par, revoquee_par)
export function clePublique(c, maintenant = new Date(), { admin = false } = {}) {
  return {
    id: c.id, environnement: c.environnement, prefixe: c.prefixe, libelle: c.libelle, portees: c.portees || [],
    etat: etatCle(c, maintenant), creee_par_role: c.creee_par_role, created_at: c.created_at, expire_le: c.expire_le || null,
    revoquee_le: c.revoquee_le || null, motif_revocation: c.motif_revocation || null, remplace: c.remplace || null,
    derniere_utilisation: c.derniere_utilisation || null, dernier_reseau: c.dernier_reseau || null,
    ...(admin ? { creee_par: c.creee_par, revoquee_par: c.revoquee_par || null } : {}),
  };
}

// Création possible ? → null, ou { code, message } (codes repris par api-compte et api-admin)
// cles : clés de la fiche ; remplace : clé remplacée (rotation : elle ne compte plus parmi les actives)
export function refusCreation({ acces, cles = [], environnement, libelle, portees, remplace = null, maintenant = new Date() }) {
  if (!acces || !acces.actif) return { code: "acces_ferme", message: "L'accès API de cette pharmacie n'est pas ouvert (ou il est suspendu)." };
  if (!ENVIRONNEMENTS.includes(environnement)) return { code: "environnement", message: "Environnement inconnu : « test » ou « live »." };
  if (acces.cgu_version !== CGU.version) return { code: "cgu_a_accepter", message: "Les conditions d'utilisation de l'API doivent d'abord être acceptées." };
  if (environnement === "live" && !acces.test_valide_le) return { code: "test_requis", message: "Une clé de production s'obtient une fois le mode test validé." };
  const lib = String(libelle ?? "").replace(/\s+/g, " ").trim();
  if (!lib || lib.length > 60) return { code: "libelle", message: "Donnez un nom à la clé (l'outil qui l'utilise), 60 caractères au plus." };
  if (!Array.isArray(portees) || !portees.length || portees.some(p => !PORTEES.includes(p))) return { code: "portees", message: "Droits inconnus." };
  if (portees.some(p => !(acces.portees || []).includes(p))) return { code: "portees", message: "Ces droits ne sont pas ouverts pour cette pharmacie." };
  const actives = cles.filter(c => c.environnement === environnement && etatCle(c, maintenant) === "active" && c.id !== remplace).length;
  if (actives >= CLES_ACTIVES_MAX) return { code: "trop_de_cles", message: `${CLES_ACTIVES_MAX} clés actives au plus par environnement : révoquez-en une d'abord.` };
  return null;
}

// Crée la clé (stock.cles.creer) → { secret, cle } ; le secret n'est rendu qu'ici, jamais stocké ni journalisé.
// par : compte de la pharmacie ou e-mail de l'admin ; role : « pharmacie » | « admin »
export async function creerCle(stock, { acces, environnement, libelle, portees, par, role, remplace = null, maintenant = new Date(), octets }) {
  const secret = genererCle(environnement, octets);
  const ligne = await stock.cles.creer({
    odoo_id: acces.odoo_id, environnement, empreinte: empreinteCle(secret), prefixe: prefixeCle(secret),
    libelle: String(libelle).replace(/\s+/g, " ").trim().slice(0, 60), portees: PORTEES.filter(p => portees.includes(p)),
    creee_par: String(par || "inconnu").slice(0, 200), creee_par_role: role, remplace,
  });
  return { secret, cle: clePublique(ligne, maintenant, { admin: role === "admin" }) };
}
// Rotation : nouvelle clé (mêmes environnement, libellé et droits) ; l'ancienne expire dans 7 jours (ou avant, si déjà prévu)
export async function remplacerCle(stock, { acces, ancienne, par, role, maintenant = new Date(), octets }) {
  const res = await creerCle(stock, { acces, environnement: ancienne.environnement, libelle: ancienne.libelle,
    portees: (ancienne.portees || []).filter(p => (acces.portees || []).includes(p)), par, role, remplace: ancienne.id, maintenant, octets });
  const fin = new Date(maintenant.getTime() + ROTATION_JOURS * 86400e3).toISOString();
  const expire = ancienne.expire_le && Date.parse(ancienne.expire_le) < Date.parse(fin) ? ancienne.expire_le : fin;
  await stock.cles.expirer(ancienne.id, ancienne.odoo_id, expire);
  return { ...res, ancienne_expire_le: expire };
}
