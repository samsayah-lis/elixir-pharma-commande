// ── Banc d'essai : outils communs à la capture et au serveur de développement ──
// Données figées dans dev-fixtures/ (hors git : données réelles de production).
// Nom de fichier d'une donnée figée = fonction + paramètres de la requête (triés, sans anti-cache).
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE_APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DOSSIER_FIXTURES = resolve(RACINE_APP, "dev-fixtures");
export const DOSSIER_GET = resolve(DOSSIER_FIXTURES, "get");
export const DOSSIER_POST = resolve(DOSSIER_FIXTURES, "post");        // réponses POST personnalisées (facultatif)
export const DOSSIER_ENVOIS = resolve(DOSSIER_FIXTURES, "_envois");   // journal des POST reçus par le banc
export const INDEX_CAPTURE = resolve(DOSSIER_FIXTURES, "_capture.json");

// Paramètres anti-cache, ignorés pour retrouver une donnée figée
const ANTI_CACHE = new Set(["t", "_"]);

// "/products-get?b=2&a=1" (ou URL complète) → { fn, params } ; params triés, sans anti-cache
export function decoupe(url) {
  const u = new URL(url, "http://banc.local/");
  const chemin = u.pathname.replace(/^.*\/\.netlify\/functions\//, "").replace(/^\/+/, "");
  const fn = chemin.split("/")[0];
  const params = [...u.searchParams.entries()].filter(([k]) => !ANTI_CACHE.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return { fn, params, query: Object.fromEntries(params) };
}

// Nom du fichier de la donnée figée : lisible quand c'est court, empreinte sinon
export function nomFixture(url) {
  const { fn, params } = decoupe(url);
  if (!params.length) return `${fn}.json`;
  const q = params.map(([k, v]) => `${k}=${v}`).join("&");
  const lisible = /^[A-Za-z0-9=&_.,-]{1,80}$/.test(q);
  return `${fn}__${lisible ? q : createHash("sha1").update(q).digest("hex").slice(0, 12)}.json`;
}

// ── Anonymisation des données capturées (aucun nom, e-mail ni CIP de pharmacie en clair) ──
// Clés retirées ou remplacées, et toute valeur ressemblant à un e-mail.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function creeAnonymiseur() {
  const pseudos = new Map();
  const pseudo = (genre, v) => {
    const k = `${genre}:${v}`;
    if (!pseudos.has(k)) {
      const n = [...pseudos.keys()].filter(x => x.startsWith(genre + ":")).length + 1;
      pseudos.set(k, genre === "email" ? `pharmacie-${n}@banc.test`
        : genre === "cip" ? String(9000000 + n)
        : `PHARMACIE ANONYME ${n}`);
    }
    return pseudos.get(k);
  };
  const anonymise = (x, cle = "") => {
    if (Array.isArray(x)) return x.map(v => anonymise(v, cle));
    if (x && typeof x === "object") {
      const out = {};
      for (const [k, v] of Object.entries(x)) {
        if (/^(phone|tel|telephone|street|street2|adresse|address|zip|cp|city|ville|rib)$/i.test(k)) continue;
        out[k] = anonymise(v, k);
      }
      return out;
    }
    if (typeof x === "number" && /^pharmacy_?cip$/i.test(cle)) return pseudo("cip", String(x));
    if (typeof x !== "string" || !x) return x;
    if (EMAIL.test(x)) return pseudo("email", x.toLowerCase());
    if (/^pharmacy_?cip$/i.test(cle)) return pseudo("cip", x);
    if (/^pharmacy_?name$/i.test(cle)) return pseudo("nom", x);
    return x;
  };
  return anonymise;
}
