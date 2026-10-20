// ── Icônes de l'appli installable (docs/notifications.md) : node scripts/genere-icones.mjs ──
// Lancé une fois (les PNG sont commités dans public/) ; à relancer seulement si le dessin change. Sur le Mac du bureau :
// Google Chrome sans interface dessine chaque SVG de scripts/icones/ à la taille voulue, puis sips (macOS) contrôle la taille.
//  • public/icones/elixir-192.png, elixir-512.png    : favicon agrandi (carré pétrole arrondi, croix or clair) — « any »
//  • public/icones/elixir-maskable-512.png           : fond plein, croix dans la zone sûre — « maskable » (Android)
//  • public/apple-touch-icon.png (180)               : carré plein (iOS arrondit lui-même)
//  • public/icones/badge-96.png                      : croix blanche sur transparent (barre d'état Android)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ICONES = [
  { source: "elixir-icone.svg", taille: 192, sortie: "public/icones/elixir-192.png" },
  { source: "elixir-icone.svg", taille: 512, sortie: "public/icones/elixir-512.png" },
  { source: "elixir-maskable.svg", taille: 512, sortie: "public/icones/elixir-maskable-512.png" },
  { source: "elixir-apple.svg", taille: 180, sortie: "public/apple-touch-icon.png" },
  { source: "elixir-badge.svg", taille: 96, sortie: "public/icones/badge-96.png" },
];

if (!existsSync(CHROME)) { console.error(`Chrome introuvable (${CHROME}) : variable CHROME=<chemin> pour en donner un autre.`); process.exit(2); }
const dossier = mkdtempSync(join(tmpdir(), "elixir-icones-"));
let erreurs = 0;
try {
  for (const i of ICONES) {
    const svg = readFileSync(join(APP, "scripts/icones", i.source));
    const page = join(dossier, `${i.taille}-${i.source}.html`);
    writeFileSync(page, `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block}</style></head>`
      + `<body><img width="${i.taille}" height="${i.taille}" src="data:image/svg+xml;base64,${svg.toString("base64")}"></body></html>`);
    const sortie = join(APP, i.sortie);
    mkdirSync(dirname(sortie), { recursive: true });
    execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dossier, "profil")}`,
      "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000", `--window-size=${i.taille},${i.taille}`,
      `--screenshot=${sortie}`, pathToFileURL(page).href], { stdio: "ignore", timeout: 60_000 });
    const info = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", sortie], { encoding: "utf8" });
    const l = Number(/pixelWidth: (\d+)/.exec(info)?.[1]), h = Number(/pixelHeight: (\d+)/.exec(info)?.[1]);
    const ok = l === i.taille && h === i.taille;
    if (!ok) erreurs++;
    console.log(`${ok ? "✓" : "✗"} ${i.sortie} : ${l}×${h}${ok ? "" : ` (attendu ${i.taille}×${i.taille})`}`);
  }
} finally { rmSync(dossier, { recursive: true, force: true }); }
process.exit(erreurs ? 1 : 0);
