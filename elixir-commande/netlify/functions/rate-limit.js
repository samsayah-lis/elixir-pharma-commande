// ── Rate limiter — protection DoS basique ──────────────────────────────
// Limites par IP : 60 requêtes/minute pour les endpoints publics
// Les fonctions Netlify sont stateless, donc ce rate limiter
// ne fonctionne que par instance (reset à chaque cold start).
// Limite durable (kv_store, commune à toutes les instances) : limiteDurable, plus bas.
import { createHmac, randomUUID } from "node:crypto";
import { kvSet, kvDel, kvByPrefix, kvDeleteOlder } from "./_kv.js";

const store = new Map(); // IP → { count, resetAt }

const DEFAULT_LIMIT = 60;   // requêtes max
const DEFAULT_WINDOW = 60;  // secondes

// IP du client : en-tête posé par Netlify (non falsifiable par le navigateur) en priorité ;
// x-forwarded-for peut être prérempli par le client, il ne sert qu'en repli.
export function clientIp(event) {
  const h = event.headers || {};
  return String(h["x-nf-client-connection-ip"] || "").trim()
      || String(h["x-forwarded-for"] || "").split(",")[0].trim()
      || String(h["client-ip"] || "").trim()
      || "unknown";
}
// Clé des limites par connexion : IPv4 entière ; IPv6 réduite à son préfixe /64 (4 premiers groupes). Un abonné ou un
// serveur dispose d'un /64 entier (des milliards d'adresses) : compter l'adresse IPv6 complète ne limitait rien
// (correctif de sécurité du 19/10/2026). « ::ffff:1.2.3.4 » (IPv4 notée en IPv6) → 1.2.3.4.
export function prefixeIp(ip) {
  const s = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  if (!s.includes(":")) return s || "unknown";
  const moities = s.split("::");
  if (moities.length > 2) return s;   // adresse mal formée : gardée telle quelle
  const groupes = (x) => (x ? x.split(":") : []).flatMap(g => g.includes(".") ? ["0", "0"] : [g]);   // IPv4 finale = 2 groupes
  const tete = groupes(moities[0]), queue = moities.length === 2 ? groupes(moities[1]) : [];
  const tous = moities.length === 2 ? [...tete, ...Array(Math.max(0, 8 - tete.length - queue.length)).fill("0"), ...queue] : tete;
  return tous.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(":") + "::/64";
}
export const cleIp = (event) => prefixeIp(clientIp(event));

export function rateLimit(event, limit = DEFAULT_LIMIT, windowSec = DEFAULT_WINDOW) {
  const ip = cleIp(event);

  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowSec * 1000 });
    return null; // OK
  }

  entry.count++;

  if (entry.count > limit) {
    return {
      statusCode: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
      },
      body: JSON.stringify({ error: "Trop de requêtes — réessayez dans quelques secondes" }),
    };
  }

  return null; // OK
}

// Cleanup : supprime les entrées expirées toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store) {
    if (now > entry.resetAt) store.delete(ip);
  }
}, 5 * 60 * 1000);

// ── Limite durable (correctif de sécurité du 19/10/2026) ────────────────
// kv_store, partagé par toutes les instances et conservé aux redémarrages (la limite ci-dessus repart de zéro à chaque
// instance). compteurs : [{ nom, valeur, max }] — au plus `max` passages ACCEPTÉS par `fenetreSec` pour chaque compteur.
// Une clé par passage : rl:<nom>:<empreinte HMAC de la valeur>:<horodatage ISO>:<aléa> (ni IP ni adresse en clair).
// Le passage est écrit PUIS compté (rang parmi les passages de la fenêtre) : des requêtes simultanées ne passent pas
// toutes ; un passage refusé est effacé (il ne prolonge pas le blocage). Noms de compteurs sans « _ » ni « % » (LIKE).
// → { refus: null | { compteur, retryAfter (s) }, liberer } ; liberer() efface le passage accepté, quand ce qu'il
// protège n'a pas eu lieu (ex. code non envoyé par Supabase : il ne compte pas) ; kv_store injoignable : exception.
const SECRET_LIMITE = process.env.GP_KEY_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_KEY || "rl";
const empreinte = (v) => createHmac("sha256", SECRET_LIMITE).update(String(v)).digest("hex").slice(0, 24);
export async function limiteDurable(compteurs, fenetreSec) {
  const maintenant = Date.now();
  const depuis = new Date(maintenant - fenetreSec * 1000).toISOString();
  const marque = `${new Date(maintenant).toISOString()}:${randomUUID().slice(0, 8)}`;
  const prefixes = compteurs.map(c => `rl:${c.nom}:${empreinte(c.valeur)}:`);
  const cles = prefixes.map(p => p + marque);
  const effacer = (liste) => Promise.all(liste.map(k => kvDel(k).catch(() => {})));
  await Promise.all(cles.map(k => kvSet(k, 1)));
  let refus = null;
  try {
    for (let i = 0; i < compteurs.length && !refus; i++) {
      const lignes = (await kvByPrefix(prefixes[i], 1000)).map(l => l.key).filter(k => k.startsWith(prefixes[i]));
      const marques = lignes.map(k => k.slice(prefixes[i].length));
      const dansFenetre = marques.filter(m => m.slice(0, 24) > depuis).sort();
      // ménage : passages sortis de la fenêtre (au plus quelques-uns par compteur)
      await effacer(lignes.filter((k, j) => !(marques[j].slice(0, 24) > depuis)));
      const rang = dansFenetre.filter(m => m <= marque).length;
      if (rang > compteurs[i].max) {
        const libre = Date.parse(dansFenetre[0].slice(0, 24)) + fenetreSec * 1000;   // le plus ancien passage sort de la fenêtre
        refus = { compteur: compteurs[i].nom, retryAfter: Math.max(1, Math.ceil((libre - maintenant) / 1000)) };
      }
    }
  } catch (e) { await effacer(cles); throw e; }
  if (refus) { await effacer(cles); return { refus, liberer: async () => {} }; }
  // ménage général de temps en temps : passages de plus d'un jour (adresses ou IP jamais revues)
  if (Math.random() < 0.05) await kvDeleteOlder("rl:", new Date(maintenant - 86400e3).toISOString()).catch(() => {});
  return { refus: null, liberer: () => effacer(cles) };
}
// Efface tous les passages d'un compteur pour une valeur (ex. essais de code d'une adresse, après l'envoi d'un nouveau code)
export async function effacerCompteur(nom, valeur) {
  const prefixe = `rl:${nom}:${empreinte(valeur)}:`;
  const lignes = (await kvByPrefix(prefixe, 1000)).map(l => l.key).filter(k => k.startsWith(prefixe));
  await Promise.all(lignes.map(k => kvDel(k).catch(() => {})));
}
