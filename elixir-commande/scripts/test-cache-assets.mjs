// Tests du cache des fichiers du site (docs/cache.md, scripts/cache-assets-plugin.mjs) : node scripts/test-cache-assets.mjs
// Hors ligne ; un vrai build Vite dans un dossier temporaire (dist/ n'est pas touché) :
//  • dist/_headers : une règle « gardé un an » (immutable) par fichier de dist/assets, tous à empreinte, rien d'autre
//    (index.html et fichiers de public/ : défaut de Netlify, revérifiés ; service worker et manifestes : leurs règles de
//    netlify.toml) ;
//  • fichiersAEmpreinte et enTetes : nom fixé à la main (même de la forme d'une empreinte), hors /assets, ou motifs de noms
//    de Vite sans [hash] : écartés ; ordre stable ;
//  • garde-fous : aucune règle « /assets/* » ni cache long dans les deux netlify.toml, ni public/_headers ni public/assets
//    (Vite les copierait tels quels : règles en double, fichiers sans empreinte), plugin branché dans vite.config.js.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { CACHE_LONG, EMPREINTE, enTetes, fichiersAEmpreinte } from "./cache-assets-plugin.mjs";

const RACINE = new URL("..", import.meta.url).pathname;
const lire = (f) => readFileSync(join(RACINE, f), "utf8");
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const regles = (texte) => [...texte.matchAll(/^(\/\S+)\n {2}Cache-Control: (.+)$/gm)].map(m => [m[1], m[2]]);

// ── 1. fichiersAEmpreinte et enTetes ──
{
  const VITE = { entryFileNames: "assets/[name]-[hash].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash].[ext]" };
  const morceau = (fileName) => [fileName, { type: "chunk", fileName }];
  const fichier = (fileName, names = []) => [fileName, { type: "asset", fileName, names }];
  const bundle = Object.fromEntries([morceau("assets/memo-DzuYBoSN.js"), morceau("assets/index-Ck0KzExp.js"),
    fichier("assets/Accueil-B04YIua9.css", ["Accueil.css"]), fichier("assets/inter-latin-wght-normal-Dx4kXJAl.woff2", ["inter-latin-wght-normal.woff2"]),
    fichier("assets/logo-officine.svg"), fichier("assets/vieux-1234.js", ["vieux.js"]), fichier("index.html"), fichier("api/openapi.yaml"), fichier("_headers")]);
  eq("fichiersAEmpreinte : morceaux et fichiers nommés par Vite sous /assets, triés", fichiersAEmpreinte(VITE, bundle),
    ["assets/Accueil-B04YIua9.css", "assets/index-Ck0KzExp.js", "assets/inter-latin-wght-normal-Dx4kXJAl.woff2", "assets/memo-DzuYBoSN.js"]);
  eq("nom fixé à la main de la forme d'une empreinte (logo-officine.svg) : écarté", EMPREINTE.test("assets/logo-officine.svg") && !fichiersAEmpreinte(VITE, bundle).includes("assets/logo-officine.svg"), true);
  eq("motifs de Vite sans [hash] (un seul suffit) : aucun fichier, null", [
    fichiersAEmpreinte({ ...VITE, assetFileNames: "assets/[name][extname]" }, bundle), fichiersAEmpreinte({ ...VITE, chunkFileNames: () => "x.js" }, bundle)], [null, null]);
  const t = enTetes(fichiersAEmpreinte(VITE, bundle));
  eq("enTetes : une règle par fichier, gardé un an", regles(t), [["/assets/Accueil-B04YIua9.css", CACHE_LONG], ["/assets/index-Ck0KzExp.js", CACHE_LONG],
    ["/assets/inter-latin-wght-normal-Dx4kXJAl.woff2", CACHE_LONG], ["/assets/memo-DzuYBoSN.js", CACHE_LONG]]);
  eq("enTetes : une ligne de commentaire, puis rien que des règles", t.split("\n").filter(l => l && !/^(#|\/assets\/|  Cache-Control: )/.test(l)), []);
  eq("cache long : un an, immutable", CACHE_LONG, "public, max-age=31536000, immutable");
  eq("enTetes sans fichier : commentaire seul", regles(enTetes([])), []);
}

// ── 2. Vrai build : dist/_headers contre dist/assets ──
{
  const sortie = mkdtempSync(join(tmpdir(), "cache-assets-"));
  try {
    await build({ root: RACINE, configFile: join(RACINE, "vite.config.js"), logLevel: "silent", build: { outDir: sortie, emptyOutDir: true } });
    const assets = readdirSync(join(sortie, "assets")).sort();
    const r = regles(readFileSync(join(sortie, "_headers"), "utf8"));
    eq("build : au moins le bundle des pharmacies (index JS et CSS) et la police Inter", ["js", "css", "woff2"].map(x => assets.some(f => f.startsWith(x === "woff2" ? "inter-" : "index-") && f.endsWith("." + x))), [true, true, true]);
    eq("build : tous les fichiers de dist/assets portent une empreinte", assets.filter(f => !EMPREINTE.test(f)), []);
    eq("build : une règle par fichier de dist/assets, et rien d'autre", r.map(([c]) => c), assets.map(f => `/assets/${f}`));
    eq("build : toutes gardées un an (immutable)", [...new Set(r.map(([, v]) => v))], [CACHE_LONG]);
    eq("build : index.html, service worker et manifestes hors des règles (relus à chaque visite)",
      ["index.html", "sw.js", "manifest.webmanifest", "admin.webmanifest"].map(f => [existsSync(join(sortie, f)), r.some(([c]) => c === `/${f}`)]),
      [[true, false], [true, false], [true, false], [true, false]]);
  } finally { rmSync(sortie, { recursive: true, force: true }); }
}

// ── 3. Garde-fous ──
{
  for (const f of ["netlify.toml", "../netlify.toml"]) {
    const toml = lire(f), blocs = toml.split("[[headers]]").slice(1);
    eq(`${f} : aucune règle d'en-têtes sur /assets (le fichier absent serait gardé un an)`, blocs.filter(b => /for\s*=\s*["']\/assets/.test(b)).length, 0);
    eq(`${f} : aucun cache long (max-age non nul) sur une règle générale`, blocs.filter(b => /max-age=[1-9]/.test(b)).map(b => b.match(/for = "([^"]+)"/)?.[1]), []);
  }
  eq("public/_headers et public/assets absents (copiés tels quels par Vite)", [existsSync(join(RACINE, "public/_headers")), existsSync(join(RACINE, "public/assets"))], [false, false]);
  eq("vite.config.js : plugin branché", /import cacheAssets from '\.\/scripts\/cache-assets-plugin\.mjs'/.test(lire("vite.config.js")) && /plugins: \[[^\]]*cacheAssets\(\)/.test(lire("vite.config.js")), true);
}

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
