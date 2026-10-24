// Tests de la documentation de l'API des pharmacies (phase 4) : node scripts/test-api-openapi.mjs
// Hors ligne, aucune donnée réelle. Confronte docs/api/openapi.yaml (servie à /api/openapi.yaml) et la page publique
// public/api/index.html (servie à /api/) au CODE et aux réponses RÉELLES du routeur :
//  1. OpenAPI : version 3.1, références toutes résolues, exemples conformes à leurs schémas, données fictives seulement,
//     aucune clé complète, aucun mot de la plomberie interne ;
//  2. routes : mêmes méthodes et chemins que ROUTES (api-v1.js), mêmes droits (x-droit) et classes de débit
//     (x-classe-debit) ; limites, plafonds par défaut, codes d'erreur (statut compris), tailles de page, périodes,
//     contraintes de la demande de commande (champs admis, lignes, quantités, Idempotency-Key, X-Elixir-Simulation)
//     identiques au code ;
//  3. réponses RÉELLES : test-api-fondations, test-api-lecture et test-api-commandes relancés avec API_CAPTURE
//     (scripts/api-capture.mjs) ; chaque réponse du routeur est rapportée à son opération : statut documenté, type de
//     contenu, corps conforme au schéma (champs non documentés refusés : additionalProperties false), code d'erreur
//     permis pour ce statut, en-têtes obligatoires présents et aucun en-tête non documenté ; chaque opération doit avoir
//     au moins une réponse de succès vérifiée ;
//  4. page /api/ : une ancre par code d'erreur (« type » des problem+json) avec le bon statut, chaque route citée,
//     tableau des débits = LIMITES, valeurs par défaut du texte = ACCES_DEFAUT, mention des prix, contact, lien vers
//     openapi.yaml, aucune ressource externe ;
//  5. fichiers : _redirects (/api/v1/* puis /api/docs avant « /* »), netlify.toml (type de openapi.yaml), plugin Vite
//     (dist/api/ identique aux sources après « npm run build »), lien « Documentation » de « Accès API »,
//     docs/api/mise-en-service.md (prérequis P1–P8, projet de CGU identique au texte affiché aux pharmacies).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
process.env.CRON_SECRET = "secret-cron-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.ODOO_APIKEY = "cle-odoo-test";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => readFileSync(join(APP, f), "utf8");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got)?.slice(0, 400), "attendu", JSON.stringify(exp)?.slice(0, 400)); } };
const vrai = (label, v) => eq(label, !!v, true);

let yaml;
try { yaml = (await import("js-yaml")).default; }
catch { console.log("✗ js-yaml introuvable (dépendance d'eslint) : lancer npm install"); process.exit(1); }

const { ROUTES } = await import("../netlify/functions/api-v1.js");
const conf = await import("../netlify/functions/_api-config.js");
const { CODES, siteBase } = await import("../netlify/functions/_api-http.js");
const { lireDemande, simulationDe } = await import("../netlify/functions/_api-commande.js");
const { FICHIERS_DOC } = await import("./api-doc-plugin.mjs");

const TEXTE = lire("docs/api/openapi.yaml");
const DOC = yaml.load(TEXTE);
const METHODES = ["get", "post", "put", "patch", "delete"];

// ═══ Validation JSON Schema (sous-ensemble utilisé par le fichier) ═══
function resoudre(ref) {
  if (!ref.startsWith("#/")) throw new Error(`référence externe : ${ref}`);
  let x = DOC;
  for (const p of ref.slice(2).split("/")) { x = x?.[p.replace(/~1/g, "/").replace(/~0/g, "~")]; if (x === undefined) throw new Error(`référence introuvable : ${ref}`); }
  return x;
}
const deref = (x) => (x?.$ref ? deref(resoudre(x.$ref)) : x);
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FORMATS = {
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  uri: /^https?:\/\/\S+$/,
};
const estType = (t, v) => t === "null" ? v === null : t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v)
  : t === "array" ? Array.isArray(v) : t === "object" ? !!v && typeof v === "object" && !Array.isArray(v) : typeof v === t;
function valider(s, v, ch = "$", errs = []) {
  if (s == null || s === true) return errs;
  if (s.$ref) {
    valider(resoudre(s.$ref), v, ch, errs);
    const { $ref: _r, description: _d, summary: _s, ...reste } = s;
    if (Object.keys(reste).length) valider(reste, v, ch, errs);
    return errs;
  }
  for (const x of s.allOf || []) valider(x, v, ch, errs);
  if (s.oneOf) { const n = s.oneOf.filter(x => !valider(x, v, ch).length).length; if (n !== 1) errs.push(`${ch} : ${n} branche(s) oneOf valides`); }
  if (s.anyOf && !s.anyOf.some(x => !valider(x, v, ch).length)) errs.push(`${ch} : aucune branche anyOf`);
  if ("const" in s && !egal(v, s.const)) errs.push(`${ch} : ${JSON.stringify(v)} ≠ ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some(e => egal(e, v))) errs.push(`${ch} : ${JSON.stringify(v)} hors de [${s.enum.join(", ")}]`);
  if (s.type && ![].concat(s.type).some(t => estType(t, v))) { errs.push(`${ch} : ${JSON.stringify(v)?.slice(0, 60)} n'est pas ${[].concat(s.type).join("|")}`); return errs; }
  if (typeof v === "string") {
    if (s.minLength != null && v.length < s.minLength) errs.push(`${ch} : moins de ${s.minLength} caractères`);
    if (s.maxLength != null && v.length > s.maxLength) errs.push(`${ch} : plus de ${s.maxLength} caractères`);
    if (s.pattern && !new RegExp(s.pattern, "u").test(v)) errs.push(`${ch} : « ${v.slice(0, 40)} » ne suit pas ${s.pattern}`);
    if (s.format && FORMATS[s.format] && !FORMATS[s.format].test(v)) errs.push(`${ch} : « ${v.slice(0, 40)} » n'est pas au format ${s.format}`);
  }
  if (typeof v === "number") {
    if (s.minimum != null && v < s.minimum) errs.push(`${ch} : ${v} < ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) errs.push(`${ch} : ${v} > ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errs.push(`${ch} : moins de ${s.minItems} éléments`);
    if (s.maxItems != null && v.length > s.maxItems) errs.push(`${ch} : plus de ${s.maxItems} éléments`);
    if (s.items) v.forEach((x, i) => valider(s.items, x, `${ch}[${i}]`, errs));
  }
  if (estType("object", v)) {
    for (const k of s.required || []) if (!(k in v)) errs.push(`${ch} : « ${k} » absent`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) valider(s.properties[k], x, `${ch}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${ch} : champ « ${k} » non documenté`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") valider(s.additionalProperties, x, `${ch}.${k}`, errs);
    }
  }
  return errs;
}

// ═══ 1. Le fichier OpenAPI ═══
{
  eq("openapi 3.1.0", DOC.openapi, "3.1.0");
  eq("version de l'API = VERSION_API", DOC.info.version, conf.VERSION_API);
  eq("dernière modification = DERNIERE_MODIFICATION", DOC.info["x-derniere-modification"], conf.DERNIERE_MODIFICATION);
  eq("serveur : site de commande + /api (chemins en /v1/…)", DOC.servers.map(s => s.url), [`${siteBase({ headers: {} })}/api`]);
  eq("sécurité : clé Bearer partout", [DOC.security, DOC.components.securitySchemes.cle.type, DOC.components.securitySchemes.cle.scheme], [[{ cle: [] }], "http", "bearer"]);
  vrai("contact du support", DOC.info.contact?.email === "pharmacien@elixirpharma.fr");
  // toutes les références se résolvent
  const refs = [];
  (function marcher(x) { if (Array.isArray(x)) x.forEach(marcher); else if (x && typeof x === "object") { if (typeof x.$ref === "string") refs.push(x.$ref); Object.values(x).forEach(marcher); } })(DOC);
  const cassees = refs.filter(r => { try { resoudre(r); return false; } catch { return true; } });
  eq(`références résolues (${refs.length})`, cassees, []);
  // composants inutilisés (signe d'une route oubliée ou renommée)
  const utilises = new Set(refs.map(r => r.split("/").slice(0, 4).join("/")));
  const inutiles = ["schemas", "responses", "parameters", "headers"].flatMap(t => Object.keys(DOC.components[t]).map(k => `#/components/${t}/${k}`)).filter(r => !utilises.has(r));
  eq("aucun composant inutilisé", inutiles, []);
  // exemples : conformes à leur schéma
  let nEx = 0;
  const exemples = (lieu, schema, porteur) => {
    if (!schema) return;
    if ("example" in porteur) { nEx++; eq(`exemple : ${lieu}`, valider(schema, porteur.example), []); }
    for (const [nom, e] of Object.entries(porteur.examples || {})) { nEx++; eq(`exemple : ${lieu} « ${nom} »`, valider(schema, deref(e).value), []); }
  };
  const contenus = (lieu, c) => { for (const [type, m] of Object.entries(c || {})) exemples(`${lieu} ${type}`, m.schema, m); };
  for (const [p, item] of Object.entries(DOC.paths)) for (const m of METHODES) {
    const op = item[m];
    if (!op) continue;
    for (const prm of op.parameters || []) { const x = deref(prm); exemples(`${m.toUpperCase()} ${p} paramètre ${x.name}`, x.schema, x); }
    if (op.requestBody) contenus(`${m.toUpperCase()} ${p} corps`, deref(op.requestBody).content);
    for (const [st, r] of Object.entries(op.responses)) contenus(`${m.toUpperCase()} ${p} ${st}`, deref(r).content);
  }
  for (const [nom, r] of Object.entries(DOC.components.responses)) contenus(`réponse ${nom}`, r.content);
  vrai(`exemples vérifiés (${nEx})`, nEx >= 25);
  // données fictives, aucune clé, aucune plomberie interne (dépôt public, fichier servi aux pharmacies)
  const nombres = [...new Set(TEXTE.match(/\d{13}/g) || [])];
  eq("13 chiffres : CIP fictifs 34000000000xx ou commandes 179000000000x", nombres.filter(n => !/^(34000000000\d\d|179000000000\d)$/.test(n)), []);
  eq("adresses e-mail : le contact d'Elixir seulement", [...new Set(TEXTE.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [])], ["pharmacien@elixirpharma.fr"]);
  vrai("aucune clé d'API complète", !/elx_(live|test)_[0-9A-Za-z]{40}/.test(TEXTE));
  eq("aucun mot de la plomberie interne", TEXTE.match(/\b(odoo|supabase|relais|infosoft|netlify|pharmaml|kv_store|elixir_orders|api_commandes|agent)\b|\bMac\b/gi), null);
}

// ═══ 2. Routes et règles : identiques au code ═══
const OPERATIONS = [];
for (const [p, item] of Object.entries(DOC.paths)) for (const m of METHODES) if (item[m]) OPERATIONS.push({ methode: m.toUpperCase(), chemin: p, op: item[m] });
{
  const cle = (m, c) => `${m} ${c}`;
  eq("opérations = ROUTES de api-v1.js", OPERATIONS.map(o => cle(o.methode, o.chemin)).sort(), ROUTES.map(r => cle(r.methode, r.gabarit)).sort());
  eq("operationId uniques", new Set(OPERATIONS.map(o => o.op.operationId)).size, OPERATIONS.length);
  for (const r of ROUTES) {
    const o = OPERATIONS.find(x => x.methode === r.methode && x.chemin === r.gabarit);
    if (!o) continue;
    const nom = cle(r.methode, r.gabarit);
    eq(`${nom} : droit`, o.op["x-droit"], r.portee);
    eq(`${nom} : classe de débit`, o.op["x-classe-debit"], r.classe);
    vrai(`${nom} : résumé, description, étiquette`, o.op.summary && o.op.description && o.op.tags?.length === 1);
    vrai(`${nom} : une réponse de succès`, Object.keys(o.op.responses).some(s => /^2/.test(s)));
    const params = [...r.gabarit.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
    eq(`${nom} : paramètres du chemin`, (o.op.parameters || []).map(deref).filter(x => x.in === "path").map(x => x.name), params);
    // toute réponse d'erreur : ses codes ont bien ce statut dans CODES
    for (const [st, rep] of Object.entries(o.op.responses)) {
      if (Number(st) < 400) continue;
      const codes = deref(rep).content?.["application/problem+json"]?.schema?.allOf?.[1]?.properties?.code?.enum;
      vrai(`${nom} ${st} : codes d'erreur listés`, codes?.length);
      eq(`${nom} ${st} : codes de ce statut`, (codes || []).filter(c => CODES[c]?.[0] !== Number(st)), []);
    }
    // 401 et 429 sur toute route ; 403 avec portee_insuffisante dès qu'un droit est exigé ; 503 api_suspendue sauf /v1/etat
    const codesDe = (st) => deref(o.op.responses[st] || {}).content?.["application/problem+json"]?.schema?.allOf?.[1]?.properties?.code?.enum || [];
    eq(`${nom} : 401 complet`, codesDe("401"), ["cle_absente", "cle_invalide", "cle_revoquee", "cle_expiree"]);
    vrai(`${nom} : 429 debit et plafond_journalier`, ["debit", "plafond_journalier"].every(c => codesDe("429").includes(c)));
    eq(`${nom} : 403 portee_insuffisante si un droit est exigé`, codesDe("403").includes("portee_insuffisante"), !!r.portee);
    eq(`${nom} : 503 api_suspendue sauf route toujours servie`, codesDe("503").includes("api_suspendue"), !r.toujours);
    vrai(`${nom} : 400 cle_dans_url`, codesDe("400").includes("cle_dans_url"));
  }
  // codes d'erreur
  eq("CodeErreur = codes de _api-http.js", [...DOC.components.schemas.CodeErreur.enum].sort(), Object.keys(CODES).sort());
  eq("x-codes-erreur : statut de chaque code", DOC.info["x-codes-erreur"], Object.fromEntries(Object.entries(CODES).map(([c, [s]]) => [c, s])));
  eq("erreurs globales : codes connus", DOC.info["x-erreurs-globales"].filter(c => !CODES[c]), []);
  // limites et plafonds
  const L = conf.LIMITES;
  eq("x-limites = LIMITES", DOC.info["x-limites"], { ip: L.ip, refus_cle: L.refus_cle, lecture: L.lecture, disponibilites: L.disponibilites, documents: L.documents,
    commande: L.commande, simulation: L.simulation, suivi_par_pharmacie_par_minute: L.odoo.fiche_par_minute });
  eq("x-plafonds-defaut = ACCES_DEFAUT", DOC.info["x-plafonds-defaut"], Object.fromEntries(Object.keys(DOC.info["x-plafonds-defaut"]).map(k => [k, conf.ACCES_DEFAUT[k]])));
  eq("x-plafonds-defaut : tous les réglages numériques", Object.keys(DOC.info["x-plafonds-defaut"]).sort(), Object.keys(conf.BORNES).sort());
  // pages et périodes
  const P = DOC.components.parameters, Pg = conf.PAGES;
  eq("par_page du catalogue", [P.ParPageCatalogue.schema.maximum, P.ParPageCatalogue.schema.default], [Pg.catalogue.max, Pg.catalogue.defaut]);
  for (const k of ["commandes", "factures", "livraisons"]) eq(`par_page des listes (${k})`, [P.ParPageListe.schema.maximum, P.ParPageListe.schema.default], [Pg[k].max, Pg[k].defaut]);
  for (const [k, nom] of [["commandes", "DebutCommandes"], ["factures", "DebutFactures"], ["livraisons", "DebutLivraisons"]])
    vrai(`période par défaut et maximale (${k})`, P[nom].description.includes(`${Pg[k].periode_defaut} jours`) && P[nom].description.includes(`${Pg[k].periode_max} jours`));
  const dispo = DOC.paths["/v1/disponibilites"].get.parameters[0];
  vrai("disponibilités : nombre de CIP par appel", dispo.description.includes(`${Pg.disponibilites.max_cips} au plus`));
  // demande de commande : champs admis (message du code), bornes, Idempotency-Key, X-Elixir-Simulation
  const S = DOC.components.schemas;
  let admis = null;
  try { lireDemande({ body: JSON.stringify({ lignes: [{ cip: "3400000000011", quantite: 1 }], inconnu: 1 }) }); } catch (e) { admis = e.extra?.erreurs?.[0]?.message?.match(/champs admis : ([^)]+)/)?.[1]?.split(", "); }
  eq("CommandeDemande : champs admis par le code", Object.keys(S.CommandeDemande.properties), admis);
  let admisLigne = null;
  try { lireDemande({ body: JSON.stringify({ lignes: [{ cip: "3400000000011", quantite: 1, prix: 1 }] }) }); } catch (e) { admisLigne = e.extra?.erreurs?.[0]?.message?.match(/champ inconnu \(([^)]+)\)/)?.[1]?.split(", "); }
  eq("LigneDemande : champs admis par le code (aucun prix)", Object.keys(S.LigneDemande.properties), admisLigne);
  eq("CommandeDemande : champs inconnus refusés", [S.CommandeDemande.additionalProperties, S.LigneDemande.additionalProperties], [false, false]);
  eq("lignes : 1 à COMMANDE.lignes_max", [S.CommandeDemande.properties.lignes.minItems, S.CommandeDemande.properties.lignes.maxItems], [1, conf.COMMANDE.lignes_max]);
  eq("quantité : 1 à COMMANDE.quantite_max", [S.LigneDemande.properties.quantite.minimum, S.LigneDemande.properties.quantite.maximum], [1, conf.COMMANDE.quantite_max]);
  eq("commentaire : COMMANDE.commentaire_max", S.CommandeDemande.properties.commentaire.maxLength, conf.COMMANDE.commentaire_max);
  vrai("reference_client : COMMANDE.reference_max", S.CommandeDemande.properties.reference_client.pattern.endsWith(`{1,${conf.COMMANDE.reference_max}}$`));
  eq("Idempotency-Key : même motif que le code", P.IdempotencyKey.schema.pattern, conf.COMMANDE.idempotence.source);
  let simulations = null;
  try { simulationDe({ headers: { "x-elixir-simulation": "inconnue" } }); } catch (e) { simulations = e.extra?.erreurs?.[0]?.message?.replace(/^X-Elixir-Simulation : /, "").replace(/\.$/, "").split(", "); }
  eq("X-Elixir-Simulation : valeurs du code", P.XElixirSimulation.schema.enum, simulations);
  // la demande documentée est acceptée telle quelle par le code
  const ex = DOC.paths["/v1/commandes"].post.requestBody.content["application/json"].examples.reassort.value;
  eq("exemple de commande lu par le code", lireDemande({ body: JSON.stringify(ex) }).lignes, ex.lignes);
  vrai("délai d'annulation maximal cité", DOC.info["x-plafonds-defaut"].delai_annulation_min <= conf.COMMANDE.delai_envoi_max_min);
}

// ═══ 3. Réponses réelles du routeur ═══
const literal = (p) => !p.includes("{");
const reChemin = (p) => new RegExp(`^${p.replace(/\{\w+\}/g, "[^/]+")}$`);
const CHEMINS = Object.keys(DOC.paths).sort((a, b) => literal(b) - literal(a));
// chemin reçu par le routeur → /v1/… (réécriture de public/_redirects, ou appel direct de la fonction)
function cheminV1(path) {
  let p = String(path).split("?")[0].replace(/^\/\.netlify\/functions\/api-v1(?=\/|$)/, "").replace(/^\/api(?=\/v1(\/|$))/, "");
  if (!/^\/v1(\/|$)/.test(p)) p = `/v1${p.startsWith("/") ? p : `/${p}`}`;
  return p.replace(/\/+$/, "") || "/v1";
}
function operationDe(methode, path) {
  const p = cheminV1(path);
  for (const c of CHEMINS) if (reChemin(c).test(p) && DOC.paths[c][methode.toLowerCase()]) return { chemin: c, op: DOC.paths[c][methode.toLowerCase()] };
  return null;
}
const STANDARD = new Set(["content-type", "cache-control", "x-content-type-options"]);
const GLOBALES = new Set(DOC.info["x-erreurs-globales"]);
const entete = (h, nom) => { const k = Object.keys(h).find(x => x.toLowerCase() === nom.toLowerCase()); return k == null ? undefined : h[k]; };
function validerEntete(nom, schema, valeur) {
  const s = deref(schema) || {};
  if (s.type === "integer") return /^\d+$/.test(String(valeur)) && (s.minimum == null || Number(valeur) >= s.minimum) ? [] : [`${nom} : « ${valeur} » n'est pas un entier ≥ ${s.minimum}`];
  return valider(s, String(valeur), nom);
}
{
  const dossier = mkdtempSync(join(tmpdir(), "api-openapi-"));
  const reponses = [];
  for (const t of ["test-api-fondations", "test-api-lecture", "test-api-commandes"]) {
    const fichier = join(dossier, `${t}.json`);
    const r = spawnSync(process.execPath, [join(APP, "scripts", `${t}.mjs`)], { cwd: APP, env: { ...process.env, API_CAPTURE: fichier }, encoding: "utf8", timeout: 180_000 });
    const fin = String(r.stdout || "").trim().split("\n").at(-1) || "";
    vrai(`${t} relancé avec la capture : 0 échec (${fin})`, r.status === 0 && / 0 échec/.test(fin));
    if (existsSync(fichier)) reponses.push(...JSON.parse(readFileSync(fichier, "utf8")).map(x => ({ ...x, test: t })));
  }
  rmSync(dossier, { recursive: true, force: true });
  vrai(`réponses capturées (${reponses.length})`, reponses.length > 600);

  const vus = new Map();   // « MÉTHODE chemin » → statuts vérifiés
  const fautes = [];
  const faute = (r, msg) => { if (fautes.length < 40) fautes.push(`${r.test} · ${r.methode} ${r.path} ${r.statut} : ${msg}`); };
  let nVerifiees = 0;
  for (const r of reponses) {
    if (/^\/v1\/essai-/.test(cheminV1(r.path))) continue;   // routes d'essai de test-api-fondations (hors API)
    const type = String(entete(r.entetes, "content-type") || "").split(";")[0].trim();
    const corps = r.corps ? (() => { try { return JSON.parse(r.corps); } catch { return undefined; } })() : null;
    const id = entete(r.entetes, "x-request-id");
    if (!id || !FORMATS.uuid.test(id)) faute(r, "X-Request-Id absent ou mal formé");
    if (Object.keys(r.entetes).some(k => /^access-control-/i.test(k))) faute(r, "en-tête CORS");
    if (r.statut >= 400) {
      if (type !== "application/problem+json") faute(r, `type ${type} pour une erreur`);
      else {
        if (corps?.status !== r.statut) faute(r, `status ${corps?.status} ≠ ${r.statut}`);
        if (!String(corps?.type || "").endsWith(`/api/#erreur-${corps?.code}`)) faute(r, `type ${corps?.type}`);
        // réponse rejouée (Idempotency-Key) : corps d'origine, donc l'instance de la première requête
        if (corps?.instance !== `urn:uuid:${id}` && !(entete(r.entetes, "idempotent-replayed") === "true" && FORMATS.uuid.test(String(corps?.instance).replace(/^urn:uuid:/, ""))))
          faute(r, "instance ≠ X-Request-Id");
        if (CODES[corps?.code]?.[0] !== r.statut) faute(r, `code ${corps?.code} hors de son statut`);
      }
    }
    const trouve = operationDe(r.methode, r.path);
    if (!trouve) {
      // adresse inconnue ou méthode non prévue : erreurs globales seulement
      if (r.statut < 400 || !GLOBALES.has(corps?.code)) faute(r, `réponse hors de toute opération (${corps?.code || r.statut})`);
      else { const e = valider(DOC.components.schemas.Probleme, corps); if (e.length) faute(r, e.join(" ; ")); }
      if (r.statut === 405 && !entete(r.entetes, "allow")) faute(r, "405 sans Allow");
      nVerifiees++;
      continue;
    }
    const nom = `${r.methode} ${trouve.chemin}`;
    const rep = trouve.op.responses[String(r.statut)];
    if (!rep) { faute(r, `statut non documenté pour ${nom}${corps?.code ? ` (${corps.code})` : ""}`); continue; }
    const R = deref(rep);
    if (!vus.has(nom)) vus.set(nom, new Set());
    vus.get(nom).add(r.statut);
    // contenu
    if (!R.content) { if (r.corps || r.base64) faute(r, "corps présent, aucun documenté"); }
    else if (!R.content[type]) faute(r, `type ${type || "(aucun)"} non documenté (${Object.keys(R.content).join(", ")})`);
    else if (type === "application/pdf") { if (!r.base64) faute(r, "PDF vide"); }
    else if (corps === undefined) faute(r, "corps JSON illisible");
    else { const e = valider(R.content[type].schema, corps); if (e.length) faute(r, e.slice(0, 4).join(" ; ")); }
    // en-têtes : obligatoires présents, valeurs conformes, aucun non documenté
    const doc = Object.fromEntries(Object.entries(R.headers || {}).map(([k, v]) => [k.toLowerCase(), deref(v)]));
    for (const [k, h] of Object.entries(doc)) if (h.required && entete(r.entetes, k) === undefined) faute(r, `en-tête ${k} absent`);
    for (const [k, v] of Object.entries(r.entetes)) {
      const lk = k.toLowerCase();
      if (STANDARD.has(lk)) continue;
      if (!doc[lk]) { faute(r, `en-tête ${k} non documenté`); continue; }
      const e = validerEntete(k, doc[lk].schema, v);
      if (e.length) faute(r, e.join(" ; "));
    }
    nVerifiees++;
  }
  eq("réponses réelles conformes à l'OpenAPI", fautes, []);
  vrai(`réponses vérifiées (${nVerifiees})`, nVerifiees > 600);
  // chaque opération : au moins une réponse de succès vérifiée
  const sansSucces = OPERATIONS.map(o => `${o.methode} ${o.chemin}`).filter(n => ![...(vus.get(n) || [])].some(s => s >= 200 && s < 300));
  eq("chaque opération : un succès réel vérifié", sansSucces, []);
  const statutsVus = [...vus.values()].reduce((n, s) => n + s.size, 0);
  const statutsDocs = OPERATIONS.reduce((n, o) => n + Object.keys(o.op.responses).length, 0);
  console.log(`  (statuts documentés observés dans les tests : ${statutsVus} sur ${statutsDocs})`);
}

// ═══ 4. Page publique /api/ ═══
const PAGE = lire("public/api/index.html");
const texteDe = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|[  ]/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const TEXTE_PAGE = texteDe(PAGE);
const fr = (n) => Number(n).toLocaleString("fr-FR").replace(/[  ]/g, " ");
{
  vrai("page : français, titre, viewport", /<html lang="fr"/.test(PAGE) && /<title>[^<]+<\/title>/.test(PAGE) && /name="viewport"/.test(PAGE));
  vrai("page : ancre « erreurs »", /id="erreurs"/.test(PAGE));
  for (const [code, [statut]] of Object.entries(CODES)) {
    const m = PAGE.match(new RegExp(`<[^>]*\\bid="erreur-${code}"[^>]*>`));
    vrai(`page : ancre #erreur-${code} (type des problem+json)`, m);
    if (m) eq(`page : statut de ${code}`, m[0].match(/data-statut="(\d+)"/)?.[1], String(statut));
  }
  eq("page : chaque route citée (data-route)", ROUTES.map(r => `${r.methode} ${r.gabarit}`).filter(n => !PAGE.includes(`data-route="${n}"`)), []);
  eq("page : aucune route inexistante", [...PAGE.matchAll(/data-route="([^"]+)"/g)].map(m => m[1]).filter(n => !ROUTES.some(r => `${r.methode} ${r.gabarit}` === n)), []);
  for (const k of ["lecture", "disponibilites", "documents", "commande", "simulation"]) {
    const m = PAGE.match(new RegExp(`data-classe="${k}"[^>]*`));
    eq(`page : débits ${k}`, m ? [m[0].match(/data-par-minute="(\d+)"/)?.[1], m[0].match(/data-par-jour="(\d+)"/)?.[1]] : null,
      [String(conf.LIMITES[k].par_minute), String(conf.LIMITES[k].par_jour)]);
  }
  const D = conf.ACCES_DEFAUT;
  for (const attendu of [`${D.delai_annulation_min} minutes`, `${fr(D.plafond_lignes)} lignes`, `${fr(D.plafond_boites)} boîtes`, `${fr(D.plafond_montant_ht)} € HT`,
    `${D.plafond_commandes_jour} commandes par jour`, `${D.anomalie_facteur} fois`, `${D.anomalie_doublon_min} minutes`, `${fr(conf.COMMANDE.lignes_max)} lignes`,
    `${conf.COMMANDE.quantite_max}`, `${conf.ROTATION_JOURS} jours`, `${conf.CLES_ACTIVES_MAX} clés`, `${conf.LIMITES.ip.par_minute} requêtes par minute`])
    vrai(`page : « ${attendu} »`, TEXTE_PAGE.includes(attendu));
  vrai("page : mention des prix (code)", TEXTE_PAGE.includes(conf.MENTION_PRIX));
  vrai("page : contact du support", TEXTE_PAGE.includes("pharmacien@elixirpharma.fr") && TEXTE_PAGE.includes("01 86 04 39 95"));
  vrai("page : lien vers /api/openapi.yaml", /href="\/api\/openapi\.yaml"/.test(PAGE));
  vrai("page : Idempotency-Key, X-Request-Id, X-Elixir-Simulation", ["Idempotency-Key", "X-Request-Id", "X-Elixir-Simulation", "Idempotent-Replayed", "Retry-After"].every(x => TEXTE_PAGE.includes(x)));
  vrai("page : états d'une commande", DOC.components.schemas.EtatCommande.enum.every(e => PAGE.includes(`<code>${e}</code>`)));
  vrai("page : motifs d'anomalie", ["anomalie_quantite", "quasi_doublon"].every(e => PAGE.includes(`<code>${e}</code>`)));
  vrai("page : parcours de test (six étapes)", (PAGE.match(/data-etape="/g) || []).length === 6);
  vrai("page : version", TEXTE_PAGE.includes(`version ${conf.VERSION_API}`));
  eq("page : aucune ressource externe (polices, scripts, styles)", PAGE.match(/<(script|link|img|iframe)\b[^>]*(src|href)="(https?:)?\/\/[^"]*"/gi), null);
  eq("page : aucun script", /<script\b/i.test(PAGE), false);
  const nombres = [...new Set(PAGE.match(/\d{13}/g) || [])];
  eq("page : 13 chiffres fictifs seulement", nombres.filter(n => !/^(34000000000\d\d|179000000000\d)$/.test(n)), []);
  eq("page : adresses e-mail", [...new Set(PAGE.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [])], ["pharmacien@elixirpharma.fr"]);
  vrai("page : aucune clé complète", !/elx_(live|test)_[0-9A-Za-z]{40}/.test(PAGE));
  eq("page : aucun mot de la plomberie interne", TEXTE_PAGE.match(/\b(odoo|supabase|relais|infosoft|netlify|kv_store|elixir_orders|api_commandes)\b|\bMac\b/gi), null);
}

// ═══ 5. Fichiers ═══
{
  const regles = lire("public/_redirects").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split(/\s+/));
  eq("_redirects : /api/v1/* (fonction), /api/docs → /api/, puis /*", regles,
    [["/api/v1/*", "/.netlify/functions/api-v1/:splat", "200!"], ["/api/docs", "/api/", "301"], ["/*", "/index.html", "200"]]);
  const toml = lire("netlify.toml");
  vrai("netlify.toml : openapi.yaml servi en application/yaml", /\[\[headers\]\]\s+for = "\/api\/openapi\.yaml"\s+\[headers\.values\][^[]*Content-Type = "application\/yaml; charset=utf-8"/.test(toml));
  vrai("vite.config.js : plugin de la documentation", /import apiDoc from ['"]\.\/scripts\/api-doc-plugin\.mjs['"]/.test(lire("vite.config.js")) && /apiDoc\(\)/.test(lire("vite.config.js")));
  eq("plugin : fichiers servis à côté de la page", Object.keys(FICHIERS_DOC).sort(), ["api/inter.woff2", "api/openapi.yaml"]);
  eq("plugin : openapi.yaml = docs/api/openapi.yaml", FICHIERS_DOC["api/openapi.yaml"], "docs/api/openapi.yaml");
  vrai("plugin : police Inter présente", existsSync(join(APP, FICHIERS_DOC["api/inter.woff2"])));
  vrai("page : police servie par le plugin", PAGE.includes('url("/api/inter.woff2")'));
  if (existsSync(join(APP, "dist", "index.html"))) {
    const memes = (a, b) => existsSync(join(APP, a)) && readFileSync(join(APP, a)).equals(readFileSync(join(APP, b)));
    vrai("dist/api/openapi.yaml = docs/api/openapi.yaml (relancer npm run build sinon)", memes("dist/api/openapi.yaml", "docs/api/openapi.yaml"));
    vrai("dist/api/index.html = public/api/index.html", memes("dist/api/index.html", "public/api/index.html"));
    vrai("dist/api/inter.woff2", memes("dist/api/inter.woff2", FICHIERS_DOC["api/inter.woff2"]));
  } else console.log("  · dist/ absent : lancer npm run build pour contrôler dist/api/");
  vrai("« Accès API » : lien vers la documentation /api/", /documentation: "\/api\/"/.test(lire("netlify/functions/api-compte.js")));
  // mise en service (Zineb) : prérequis, SQL, interrupteurs, projet de CGU identique au texte affiché
  const mes = lire("docs/api/mise-en-service.md");
  eq("mise en service : prérequis P1 à P8", ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"].filter(p => !mes.includes(`**${p}**`)), []);
  vrai("mise en service : prérequis de l'interrupteur (code)", conf.PREREQUIS.every(p => mes.includes(p.libelle)));
  vrai("mise en service : SQL, interrupteurs", ["sql/api-schema.sql", "Tout couper", "Fermer les commandes par API", "Suspendre l'accès", "Révoquer"].every(x => mes.includes(x)));
  vrai("mise en service : version des CGU", mes.includes(conf.CGU.version));
  eq("mise en service : articles du projet de CGU identiques au code", conf.CGU.articles.filter(([t, x]) => !mes.includes(`**${t}.** ${x}`)).map(([t]) => t), []);
  eq("mise en service : 13 chiffres fictifs seulement", [...new Set(mes.match(/\d{13}/g) || [])].filter(n => !/^(34000000000\d\d|179000000000\d)$/.test(n)), []);
  vrai("mise en service : aucune clé complète", !/elx_(live|test)_[0-9A-Za-z]{40}/.test(mes));
}

console.log(`API des pharmacies (documentation) : ${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
