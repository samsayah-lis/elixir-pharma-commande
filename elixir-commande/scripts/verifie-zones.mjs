// ── Refonte charte : garde-fou des zones protégées (docs/refonte-charte.md, § 4) ──
// node scripts/verifie-zones.mjs [--ref master]   (ou : npm run zones)
// Compare, entre la référence (master par défaut) et l'arbre de travail, octet pour octet :
//  • les zones de logique protégées, retrouvées par leur contenu (noms de fonctions), jamais par numéro de ligne ;
//  • les fichiers intouchables (lab-justif-client, gp-pricing, product-groups, netlify/functions/**) ;
//  • les clés de stockage (appels localStorage / sessionStorage get/set/removeItem, liste triée).
// Sortie 0 : tout est identique ; 1 : au moins un écart ; 2 : erreur (zone introuvable dans la référence…).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const REF = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "master";

// ── Zones protégées ──
// de : première ligne de la zone ; puis (facultatif) : repère situé dans la zone, après « de » ;
// fin : "bloc" = fin du bloc ouvert par la ligne « puis » (ou « de ») — première ligne suivante à la même
// indentation qui commence par } ou ) — sinon expression de la dernière ligne (première trouvée après le repère).
const ZONES = [
  { fichier: "src/App.jsx", nom: "panier persistant et contingentement (cartKeys … quotaDay)",
    de: /^\/\/ Panier persisté :/, puis: /^const quotaDay = /, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "quantités et ajout au panier (getStepMin, setQty, setItemQty, addItemToCart)",
    de: /^  const getStepMin = \(catKey, p\) => \{$/, puis: /^  const addItemToCart = \(item\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu",
    de: /^  const cartItems = useMemo\(\(\) => \{$/, puis: /^    window\.addEventListener\("popstate", onPop\);$/, fin: /^  \}, \[\]\);$/ },
  { fichier: "src/App.jsx", nom: "copie du bon de commande (handleCopy)",
    de: /^  const handleCopy = \(\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "identification de la pharmacie (handleEmailLookup … handleOnboarding)",
    de: /^  const handleEmailLookup = async \(\) => \{$/, puis: /^  const handleOnboarding = \(\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "envoi de la commande (expandSupplierGroups, handleSend, sendOrder)",
    de: /^  const expandSupplierGroups = async \(items\) => \{$/, puis: /^  const sendOrder = async \(\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "confirmation de la commande groupée U-Labs (calculs et confirmOrder)",
    de: /\{\/\* Bouton confirmation commande groupée U-Labs \*\/\}/, puis: /^\s*const confirmOrder = async \(\) => \{$/, fin: "bloc" },
  { fichier: "src/tiers.jsx", nom: "paliers de quantité (applyTiers)",
    de: /^import React from "react";$/, puis: /^export function applyTiers\(/, fin: "bloc" },
];

// Fichiers et dossiers dont aucune ligne ne doit changer
const FICHIERS = ["src/lab-justif-client.js", "src/gp-pricing.js", "src/product-groups.js"];
const DOSSIERS = ["netlify/functions"];

// Écarts autorisés explicitement par un lot (docs/refonte-charte.md) : remplacement exact appliqué au texte
// de la référence avant comparaison ; tout autre écart reste signalé. Une entrée par changement validé :
// { zone: "<début du nom de la zone>", avant: "…", apres: "…", lot: "E2", motif: "…" }
const ECARTS_AUTORISES = [
  { zone: "copie du bon de commande", lot: "1", motif: "décision de la cliente (§ 6) : aucune mention de publication du catalogue, texte copié compris",
    avant: "      `BON DE COMMANDE — ELIXIR PHARMA`,\n      `Publication 6 — Février 2026`,\n",
    apres: "      `BON DE COMMANDE — ELIXIR PHARMA`,\n" },
];

// ── lecture ──
const git = (...a) => execFileSync("git", a, { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const enRef = (chemin) => { try { return git("show", `${REF}:./${chemin}`); } catch { return null; } };
const enCours = (chemin) => existsSync(join(APP, chemin)) ? readFileSync(join(APP, chemin), "utf8") : null;
const empreinte = (t) => createHash("sha256").update(t).digest("hex").slice(0, 12);

const indentation = (l) => l.match(/^\s*/)[0].length;
const finDeBloc = (lignes, i) => {
  if (!/[{([]\s*(\/\/.*)?$/.test(lignes[i])) return i;   // ligne seule (pas de bloc ouvert)
  const n = indentation(lignes[i]);
  for (let j = i + 1; j < lignes.length; j++) if (lignes[j].trim() && indentation(lignes[j]) === n && /^\s*[)}\]]/.test(lignes[j])) return j;
  return -1;
};
const trouveUne = (lignes, re, depuis = 0) => {
  const idx = []; for (let i = depuis; i < lignes.length; i++) if (re.test(lignes[i])) idx.push(i);
  return idx;
};
// → { debut, fin, texte } ou { erreur }
function extrait(texte, z) {
  const lignes = texte.split("\n");
  const d = trouveUne(lignes, z.de);
  if (d.length !== 1) return { erreur: d.length ? `début ambigu (${d.length} occurrences)` : "début introuvable" };
  let repere = d[0];
  if (z.puis) { const p = trouveUne(lignes, z.puis, d[0]); if (!p.length) return { erreur: "repère introuvable" }; repere = p[0]; }
  const f = z.fin === "bloc" ? finDeBloc(lignes, repere) : trouveUne(lignes, z.fin, repere)[0] ?? -1;
  if (f < 0) return { erreur: "fin introuvable" };
  return { debut: d[0] + 1, fin: f + 1, texte: lignes.slice(d[0], f + 1).join("\n") };
}
const premiereDifference = (a, b) => {
  const la = a.split("\n"), lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return { i, a: la[i], b: lb[i] };
  return null;
};

let ecarts = 0, erreurs = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const ko = (m) => { ecarts++; console.log(`  ✗ ${m}`); };

try { git("rev-parse", "--verify", `${REF}^{commit}`); }
catch { console.error(`Référence « ${REF} » inconnue de git.`); process.exit(2); }
console.log(`Zones protégées : ${REF} ↔ arbre de travail (${relative(process.cwd(), APP) || "."})\n`);

// 1. zones
console.log("Zones de logique");
for (const z of ZONES) {
  const tr = enRef(z.fichier), tc = enCours(z.fichier);
  const zr = tr == null ? { erreur: "fichier absent" } : extrait(tr, z);
  const zc = tc == null ? { erreur: "fichier absent" } : extrait(tc, z);
  const titre = `${z.fichier} · ${z.nom}`;
  if (zr.erreur) { erreurs++; console.log(`  ! ${titre} : ${zr.erreur} dans ${REF} (définition de zone à revoir)`); continue; }
  if (zc.erreur) { ko(`${titre} : ${zc.erreur} dans l'arbre de travail`); continue; }
  let attendu = zr.texte;
  for (const e of ECARTS_AUTORISES.filter(e => z.nom.startsWith(e.zone))) {
    if (!attendu.includes(e.avant)) { erreurs++; console.log(`  ! écart autorisé (lot ${e.lot}) introuvable dans la zone « ${z.nom} »`); continue; }
    attendu = attendu.replace(e.avant, e.apres);
  }
  if (attendu === zc.texte) ok(`${titre} — ${zc.fin - zc.debut + 1} lignes (l. ${zc.debut}-${zc.fin}), ${empreinte(zc.texte)}`);
  else {
    const d = premiereDifference(attendu, zc.texte);
    ko(`${titre} : ${empreinte(attendu)} ≠ ${empreinte(zc.texte)}, 1re différence ligne ${zc.debut + d.i} (${REF} : ${zr.debut + d.i})`);
    console.log(`      ${REF} : ${(d.a ?? "‹fin de zone›").trim().slice(0, 160)}\n      après  : ${(d.b ?? "‹fin de zone›").trim().slice(0, 160)}`);
  }
}

// 2. fichiers et dossiers intouchables
console.log("\nFichiers intouchables");
const fichiersDe = (dossier) => {
  const enRefListe = (() => { try { return git("ls-tree", "-r", "--name-only", REF, "--", dossier).split("\n").filter(Boolean); } catch { return []; } })();
  const parcours = (d) => !existsSync(join(APP, d)) ? [] : readdirSync(join(APP, d)).filter(n => !n.startsWith("."))
    .flatMap(n => statSync(join(APP, d, n)).isDirectory() ? parcours(join(d, n)) : [join(d, n)]);
  return [...new Set([...enRefListe, ...parcours(dossier)])].sort();
};
const verifieFichier = (chemin, silencieux) => {
  const a = enRef(chemin), b = enCours(chemin);
  if (a == null && b == null) return true;
  if (a == null) { ko(`${chemin} : ajouté`); return false; }
  if (b == null) { ko(`${chemin} : supprimé`); return false; }
  if (a !== b) { const d = premiereDifference(a, b); ko(`${chemin} : modifié, ligne ${d.i + 1}`); return false; }
  if (!silencieux) ok(chemin);
  return true;
};
for (const f of FICHIERS) verifieFichier(f, false);
for (const d of DOSSIERS) {
  const liste = fichiersDe(d);
  const bons = liste.filter(f => verifieFichier(f, true)).length;
  if (bons === liste.length) ok(`${d}/** — ${liste.length} fichiers identiques`);
}

// 3. clés de stockage
console.log("\nClés de stockage (localStorage / sessionStorage)");
const RE_STOCKAGE = /(local|session)Storage\.(get|set|remove)Item\([^)]*/g;
const sources = (liste) => liste.filter(f => /\.(jsx?|mjs)$/.test(f));
const appelsRef = sources(git("ls-tree", "-r", "--name-only", REF, "--", "src").split("\n").filter(Boolean))
  .flatMap(f => (enRef(f) || "").match(RE_STOCKAGE) || []).sort();
const appelsCours = sources(fichiersDe("src")).flatMap(f => (enCours(f) || "").match(RE_STOCKAGE) || []).sort();
if (JSON.stringify(appelsRef) === JSON.stringify(appelsCours)) ok(`${appelsCours.length} appels identiques`);
else {
  const compte = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cr = compte(appelsRef), cc = compte(appelsCours);
  for (const k of new Set([...cr.keys(), ...cc.keys()])) if ((cr.get(k) || 0) !== (cc.get(k) || 0)) ko(`${k}) : ${cr.get(k) || 0} → ${cc.get(k) || 0}`);
}

console.log(`\nRésultat : ${erreurs ? `${erreurs} erreur(s) de définition, ` : ""}${ecarts ? `${ecarts} écart(s)` : "aucun écart"}`);
process.exit(erreurs ? 2 : ecarts ? 1 : 0);
