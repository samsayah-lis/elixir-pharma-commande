import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { MEDIPIM_BASE, MEDIPIM_HEADERS as H } from "./_medipim.js";
// Fiche Medipim (nom, marque, photo, laboratoire) d'un produit par code, pour l'admin.
// 404 = produit absent de Medipim (ou sans photo, sauf sansPhoto=1) ; 429/503 = base saturée ou indisponible
// (jamais confondu avec « non trouvé » : la clé est partagée, 100 appels/min).
// Mode lot (POST { action: "labos", codes: [...] }, 150 codes au plus) : laboratoire de chaque code en UNE
// recherche Medipim (quelques pages au plus) → { labos: { code: { labo, autres } }, introuvables, sans_labo }.
// Réservé à l'admin comme le reste ; l'appelant enchaîne les lots un par un (bouton « Renseigner les
// laboratoires manquants » de l'admin, docs/labo-otc.md).
// TODO sécurité : la clé Medipim a un repli écrit en dur dans _medipim.js (fichier versionné) ; ne garder que les
// variables d'environnement MEDIPIM_USER / MEDIPIM_KEY (déjà lues en priorité), puis changer la clé.

// Erreur Medipim autre que « pas trouvé » : remontée telle quelle à l'appelant
class Indisponible extends Error { constructor(status) { super(status === 429 ? "Base photos saturée" : `Base photos indisponible (${status})`); this.status = status; } }

async function requete(filter) {
  const res = await fetch(`${MEDIPIM_BASE}/products/query`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ filter: { and: [{ status: "active" }, filter] }, page: { no: 0, size: 10 } }),
  });
  if (res.status === 429 || res.status >= 500) throw new Indisponible(res.status);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.results || [];
}

// Recherche par code-barres (EAN, CIP13 ou ACL13) en un appel, comme l'outil étiquettes : trouve aussi la
// parapharmacie que /products/find (cip13) manque.
async function parCode(code) {
  if (!/^\d{8,14}$/.test(code || "")) return null;
  const q = code.length === 12 ? "0" + code : code;
  const liste = (await requete({ search: { type: "refcode", query: q, locale: "fr" } }))
    .filter(p => [p.cip13, p.acl13, ...(p.ean || [])].includes(q));
  return meilleur(liste);
}

// CIP7 / ACL7 explicite (le paramètre cip7 de /products/find n'existe pas : 422)
async function parCip7(c7) {
  if (!/^\d{7}$/.test(c7 || "")) return null;
  return meilleur(await requete({ cipOrAcl7: c7 }));
}

// Repli pour les médicaments (CIP13 34009…) que la recherche par code ne renverrait pas
async function parCip13(cip) {
  const res = await fetch(`${MEDIPIM_BASE}/products/find?cip13=${encodeURIComponent(cip)}`, { headers: H });
  if (res.status === 429 || res.status >= 500) throw new Indisponible(res.status);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.product ? extractProduct(data) : null;
}

// ── Laboratoire (« Fabricant » de Medipim) : organizations[] de la fiche ──
// Même règle que l'onglet SRA d'elixir-reappro : les dépositaires logistiques (Alloga, CSP, Eurodep…) ne sont
// jamais le laboratoire s'il y a une autre organisation (Lamisilate : Alloga France → Karo Healthcare), puis id
// Medipim croissant (l'ordre renvoyé dépend des autres produits de la réponse ; l'id ne dépend pas du lot).
// Les répartiteurs (grossistes) ne le sont jamais, même seuls : Medipim rattache Kelo-Cote, Jonctum et Oxyplastine
// (Alliance Pharma) à « SAS Alliance Healthcare Group France » ; seuls, pas de laboratoire (à saisir à la main), et
// ils restent dans « autres ». « ALLIANCE PHARMA » (laboratoire) n'est pas concerné.
const DEPOSITAIRES = /\b(ALLOGA|CSP|EURODEP|DEPOLABO|MOVIANTO|ARVATO)\b/i;
const REPARTITEURS = /\b(ALLIANCE\s+HEALTHCARE|OCP|CERP|PHOENIX\s+PHARMA|ASTERA|SOGIPHAR)\b/i;
const nomOrg = (o) => String((typeof o?.name === "string" ? o.name : (o?.name?.fr || o?.name?.en)) || "").replace(/\s+/g, " ").trim();
function laboDe(p) {
  const id = (o) => { const n = Number(o?.id); return Number.isFinite(n) ? n : 1e12; };
  const rang = (o) => (REPARTITEURS.test(nomOrg(o)) ? 2 : DEPOSITAIRES.test(nomOrg(o)) ? 1 : 0);
  const orgs = (Array.isArray(p?.organizations) ? p.organizations : []).filter(nomOrg)
    .sort((a, b) => rang(a) - rang(b) || id(a) - id(b) || nomOrg(a).localeCompare(nomOrg(b), "fr"));
  if (!orgs.length || rang(orgs[0]) === 2) return null;
  const labo = nomOrg(orgs[0]);
  return { labo, autres: [...new Set(orgs.slice(1).map(nomOrg))].filter(n => n !== labo) };
}

// Lot de codes (CIP13, ACL13, EAN, CIP7/ACL7) → laboratoire de chacun. Une recherche Medipim, pages de 250
// (4 au plus : un EAN peut désigner plusieurs fiches). Rapprochement sur le code sans zéros de tête (Medipim
// renvoie « 3574660115390 » pour « 03574660115390 ») ; une fiche active l'emporte sur une fiche retirée.
// Le CIP7/ACL7 d'une fiche est dans cipOrAcl7 (pas de champ cip7 ni acl7 : vérifié sur une fiche réelle).
// Page illisible (délai de 8 s dépassé pendant la lecture, corps non JSON ou sans results) : erreur, jamais
// « introuvables » (504 ou 502 : l'admin relance le lot).
const LOT_MAX = 150, TAILLE_PAGE = 250, PAGES_MAX = 4;
const cleCode = (c) => String(c ?? "").replace(/\D/g, "").replace(/^0+/, "");
async function labosParLot(codes) {
  const filtres = [
    { cip13: codes.filter(c => c.length === 13 && c.startsWith("34009")) },
    { acl13: codes.filter(c => c.length === 13 && c.startsWith("3401")) },
    { cipOrAcl7: codes.filter(c => c.length === 7) },
    { ean: codes.filter(c => c.length >= 8) },
  ].filter(f => Object.values(f)[0].length);
  const signal = AbortSignal.timeout(8000);   // sous le délai d'une fonction Netlify (10 s)
  const index = new Map();
  for (let no = 0; no < PAGES_MAX; no++) {
    const res = await fetch(`${MEDIPIM_BASE}/products/query`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ filter: { or: filtres }, page: { no, size: TAILLE_PAGE } }),
    });
    if (res.status === 429 || res.status >= 500) throw new Indisponible(res.status);
    if (!res.ok) throw new Error(`Recherche Medipim refusée (HTTP ${res.status})`);
    let data;
    try { data = await res.json(); }
    catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") throw e;
      throw new Error("Réponse Medipim illisible : lot non traité, réessayez");
    }
    if (!Array.isArray(data?.results)) throw new Error("Réponse Medipim inattendue : lot non traité, réessayez");
    for (const m of data.results) {
      for (const k of new Set([m.cip13, m.acl13, m.cipOrAcl7, m.cip7, m.acl7, ...(m.ean || [])].filter(Boolean).map(cleCode))) {
        const deja = index.get(k);
        if (!deja || (m.status === "active" && deja.status !== "active")) index.set(k, m);
      }
    }
    if ((no + 1) * TAILLE_PAGE >= (Number(data.meta?.total) || 0)) break;
  }
  const labos = {}, introuvables = [], sans_labo = [];
  for (const c of codes) {
    const m = index.get(cleCode(c));
    const l = m && laboDe(m);
    if (l) labos[c] = l; else (m ? sans_labo : introuvables).push(c);
  }
  return { labos, introuvables, sans_labo };
}

function meilleur(liste) {
  if (!liste.length) return null;
  const produits = liste.map(p => extractProduct({ product: p }));
  return produits.find(p => p.image_url) || produits[0];
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;

  // Mode lot : laboratoires d'une liste de codes
  if (event.httpMethod === "POST") {
    let corps;
    try { corps = JSON.parse(event.body || "{}"); }
    catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }
    if (corps?.action !== "labos") return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "action inconnue (attendu : labos)" }) };
    const codes = [...new Set((Array.isArray(corps.codes) ? corps.codes : []).map(c => String(c ?? "").replace(/\D/g, "")).filter(c => c.length >= 7 && c.length <= 14))];
    if (!codes.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "codes requis" }) };
    if (codes.length > LOT_MAX) return { statusCode: 413, headers: cors, body: JSON.stringify({ error: `${LOT_MAX} codes au plus par appel` }) };
    try {
      return { statusCode: 200, headers: cors, body: JSON.stringify(await labosParLot(codes)) };
    } catch (e) {
      if (e instanceof Indisponible) {
        const code = e.status === 429 ? 429 : 503;
        return { statusCode: code, headers: { ...cors, "Retry-After": "30" }, body: JSON.stringify({ error: e.message }) };
      }
      if (e?.name === "TimeoutError" || e?.name === "AbortError") return { statusCode: 504, headers: cors, body: JSON.stringify({ error: "Medipim ne répond pas (8 s) : réessayez" }) };
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e?.message || e).slice(0, 200) }) };
    }
  }

  // sansPhoto=1 : renvoie aussi une fiche trouvée sans photo (nom seul) au lieu d'un 404
  const { cip, cip7, sansPhoto } = event.queryStringParameters || {};
  if (!cip && !cip7) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip requis" }) };

  try {
    // Ordre : CIP7/ACL7 explicite → code-barres exact → CIP13 (médicaments). Plus d'heuristique « 7 derniers
    // chiffres d'un EAN » : elle pouvait tomber sur l'ACL7 d'un autre produit (mauvaise photo).
    let trouve = cip7 ? await parCip7(cip7) : null;
    if (!trouve?.image_url && cip) {
      const r = await parCode(cip);
      if (r && (!trouve || r.image_url)) trouve = r;
    }
    if (!trouve && cip && /^34\d{11}$/.test(cip)) trouve = await parCip13(cip);
    if (trouve && (trouve.image_url || sansPhoto === "1")) return { statusCode: 200, headers: cors, body: JSON.stringify(trouve) };
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "Produit non trouvé" }) };
  } catch (e) {
    if (e instanceof Indisponible) {
      const code = e.status === 429 ? 429 : 503;
      return { statusCode: code, headers: { ...cors, "Retry-After": "30" }, body: JSON.stringify({ error: e.message }) };
    }
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};

function extractProduct(data) {
  const p = data.product || data;
  const name = p.name?.fr || p.name?.en || null;
  // nom lisible « Marque - Nom » (le nom officiel est souvent abrégé en majuscules)
  const seo_name = p.seoName?.fr || p.seoName?.en || null;
  const brand = p.brands?.[0]?.name || null;
  let image_url = null;
  const mainPhoto = (p.frontals || [])[0] || (p.photos || [])[0];
  if (mainPhoto?.formats) {
    image_url = mainPhoto.formats.mediumWebp || mainPhoto.formats.medium || mainPhoto.formats.mediumJpeg || mainPhoto.formats.large || null;
  }
  // codes-barres connus de la fiche (un EAN-8 peut avoir un EAN-13 rattaché)
  const codes = [...new Set([p.cip13, p.acl13, ...(p.ean || [])].filter(Boolean).map(String))];
  // laboratoire (fabricant) : champ Laboratoire de l'admin
  const l = laboDe(p);
  return { name, seo_name, brand, image_url, medipim_id: p.id || null, codes, labo: l?.labo || null, labo_autres: l?.autres || [] };
}
