// ── Banc d'essai : donnée figée de la page d'accueil (GET accueil-offres) ──
// node scripts/banc/fixture-accueil.mjs <top15j.json> [--config <display_config.json>] [--noms <fiches Odoo.json>] [--fictif]
// Lit la fixture produit de l'étude des données (top 15 jours, prix et stock figés, aucune donnée client) et écrit
// dev-fixtures/accueil-offres.json (hors git) au format EXACT de la réponse du GET : la conversion passe par la
// règle du serveur (netlify/functions/_accueil-selection.js : diapoPublique), avec le catalogue reconstitué depuis la
// fixture. Retirés : comptes exacts (nb_*), candidats, identifiants Odoo, froid, prescription.
// --fictif : affiche en plus la version compacte (6 diapositives variées, une par ligne) recopiée dans
//            src/dev/reponses-fictives.js (aperçus Netlify, où le jeton d'essai ne peut pas lire le vrai classement).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOSSIER_FIXTURES } from "./commun.mjs";
import { contexteMenus, diapoPublique, normaliser, NB_SLIDES, NB_RESERVES, VERSION, laboCourt } from "../../netlify/functions/_accueil-selection.js";

const args = process.argv.slice(2);
const source = args.find((a, i) => !a.startsWith("--") && !["--config", "--noms"].includes(args[i - 1]));
if (!source) { console.error("Usage : node scripts/banc/fixture-accueil.mjs <top15j.json> [--config <display_config.json>] [--fictif]"); process.exit(2); }
const F = JSON.parse(readFileSync(source, "utf8"));
const conf = args.includes("--config") ? JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8")) : null;
const displayConfig = conf ? (typeof conf.value === "string" ? JSON.parse(conf.value) : conf.value || conf) : {};
// noms Odoo complets (français) par CIP, pour la forme des dosages absents du top 30 (fiches produit lues en lecture seule)
const fichesOdoo = args.includes("--noms") ? JSON.parse(readFileSync(args[args.indexOf("--noms") + 1], "utf8")) : [];
const nomOdoo = Object.fromEntries((Array.isArray(fichesOdoo) ? fichesOdoo : Object.values(fichesOdoo)).map(p => [p.default_code || p.cip, p.name]));

// catalogue et produits curatés reconstitués : prix, paliers, colis, photo, niveau de stock de la fixture
const RYTHME = 10;   // boîtes par jour (fictif) : la disponibilité ci-dessous redonne le niveau de la fixture
const dispoPour = (niveau) => niveau === "dernieres" ? 5 : niveau === "limite" ? 30 : 100000;
const catalogue = {}, curees = [];
const candidat = Object.fromEntries((F.candidats || []).map(c => [c.cip, c]));
const ajoute = (o) => {
  if (!o?.cip || catalogue[o.cip]) return;
  catalogue[o.cip] = { cip: o.cip, name: o.nom_panier, list_price: o.pv, discounted_price: o.pn, discount_pct: o.pct, price_tiers: o.price_tiers || null,
    in_stock: o.stock?.en_stock !== false, available: dispoPour(o.stock?.niveau) };
  if (o.menu?.key && o.menu.key !== "saisie") curees.push({ cip: o.cip, section: o.menu.key, name: o.nom_panier, pv: o.pv, pn: o.pn, pct: o.pct,
    remise_eur: o.remise_eur, colis: o.regle_qte?.multiple > 1 ? o.regle_qte.multiple : null, image_url: o.image_url || null, price_tiers: o.price_tiers || null });
};
const membre = (o, labo) => ({ cip: o.cip, nom: o.nom || candidat[o.cip]?.nom || nomOdoo[o.cip] || o.nom_court, labo, _rythme: RYTHME,
  popularite: o.popularite || candidat[o.cip]?.popularite || tranchePh(o.nb_pharmacies ?? candidat[o.cip]?.nb_pharmacies), _cmd: o.nb_commandes ?? candidat[o.cip]?.nb_commandes ?? 0 });
function tranchePh(n) { return n >= 200 ? "Plus de 200 pharmacies" : n >= 100 ? "Plus de 100 pharmacies" : n >= 50 ? "Plus de 50 pharmacies" : n >= 20 ? "Plus de 20 pharmacies" : "Plus de 10 pharmacies"; }

// diapositives (12) puis réserves : candidats éligibles des familles suivantes, dans l'ordre du classement
const diapos = [];
for (const s of F.slides || []) {
  ajoute(s); (s.variantes || []).forEach(ajoute);
  const membres = (s.variantes?.length ? s.variantes : [s]).map(v => membre({ ...candidat[v.cip], ...v, popularite: v.cip === s.cip ? s.popularite : undefined }, s.labo));
  diapos.push({ famille: s.famille, labo: laboCourt(s.labo), principal: s.cip, tendance_pct: s.tendance_pct ?? null, nouveau: false, serie_15j: normaliser(s.serie_15j), membres });
}
const dejaVus = new Set((F.slides || []).flatMap(s => [s.cip, ...(s.variantes || []).map(v => v.cip)]));
const marquesVues = new Set((F.slides || []).map(s => s.famille));
for (const c of F.candidats || []) {
  if (!c.eligible || dejaVus.has(c.cip)) continue;
  const fam = String(c.nom_court).split(/\s+/)[0].toUpperCase();
  if (marquesVues.has(fam)) continue;
  marquesVues.add(fam);
  ajoute(c);
  diapos.push({ famille: fam, labo: laboCourt(c.labo), principal: c.cip, tendance_pct: c.tendance_pct ?? null, nouveau: false, serie_15j: normaliser(c.serie_15j),
    membres: [membre({ ...c, popularite: tranchePh(c.nb_pharmacies) }, c.labo)] });
}
const ctx = { catalogue, curees, menus: contexteMenus({ displayConfig }) };
const pub = diapos.map(d => diapoPublique(d, ctx)).filter(Boolean);
const slides = pub.slice(0, NB_SLIDES).map((s, i) => ({ ...s, rang: i + 1 }));
const reserves = pub.slice(NB_SLIDES, NB_SLIDES + NB_RESERVES).map((s, i) => ({ ...s, rang: NB_SLIDES + i + 1 }));
const reponse = { version: VERSION, genere_le: F.genere_le, periode: { du: F.periode.jours[0], au: F.periode.jours[14], jours: F.periode.jours }, slides, reserves, perime: false };

const fuite = JSON.stringify(reponse).match(/"(nb_commandes|nb_pharmacies|odoo_product_id|famille_total|_cmd|_rythme|_pid|available)"/);
if (fuite) { console.error(`Champ interdit dans la réponse : ${fuite[1]}`); process.exit(1); }
mkdirSync(DOSSIER_FIXTURES, { recursive: true });
const cible = resolve(DOSSIER_FIXTURES, "accueil-offres.json");
writeFileSync(cible, JSON.stringify(reponse, null, 1));
console.log(`✓ ${cible} : ${slides.length} diapositives, ${reserves.length} réserves (${Math.round(JSON.stringify(reponse).length / 1024)} Ko)`);
for (const s of [...slides, ...reserves]) console.log(`  ${String(s.rang).padStart(2)} ${s.famille.padEnd(12)} ${s.menu.key.padEnd(9)} ${String(s.lot?.qte).padStart(4)} × ${s.lot?.pu} = ${s.lot?.total} € · ${s.stock.niveau} · ${s.image_url ? "photo" : "boîte " + [s.boite.dosage, s.boite.forme].filter(Boolean).join(" · ")}${s.variantes.length ? ` · ${s.variantes.map(v => v.libelle).join(" | ")}` : ""}`);
if (args.includes("--fictif")) {
  // aperçus Netlify : 6 diapositives variées (dosages, carton, palier, photo, boîte), dates recalculées à l'appel
  const choix = ["MOUNJARO", "VENTOLINE", "EYLEA", "SPASFON", "IZALGI", "FLECTOR"];
  console.log("\n" + choix.map(f => slides.find(s => s.famille === f)).filter(Boolean).map(s => `  ${JSON.stringify({ ...s, rang: undefined })},`).join("\n"));
}
