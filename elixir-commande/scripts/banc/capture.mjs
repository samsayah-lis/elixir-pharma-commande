// ── Banc d'essai : capture des données figées (npm run banc:capture) ──
// Une seule fois (ou pour rafraîchir) : des GET en lecture seule vers la production, rien d'autre.
// Aucun POST, aucun jeton, aucune clé : seules les lectures publiques dont le site client a besoin.
// Résultat dans dev-fixtures/get/ (hors git), anonymisé (ni nom, ni e-mail, ni CIP de pharmacie).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DOSSIER_GET, INDEX_CAPTURE, nomFixture, creeAnonymiseur } from "./commun.mjs";
import { ALL_GROUP_CODES, ALL_FALLBACK_CIPS } from "../../src/wheelchair-logic.js";

const SOURCE = "https://elixir-commande.expepharma.com/.netlify/functions/";

// Lectures du site client (docs/refonte-charte.md, lot 0) ; les recherches nourrissent la recherche locale du banc
const RECHERCHES = ["doliprane", "dafalgan", "eylea", "vaseline", "invacare", "ninlaro", "mounjaro", "wegovy",
  "somavert", "lorviqua", "seringue", "pansement", "test", "creme", "gel", "spray", "sirop", "3400"];
const DEMANDES = [
  "products-get",
  "stock-get",
  "config-get?key=display_config",
  "config-get?key=admin_promos",
  "config-get?key=pharmacy_auth_mode",
  "campaign-get",
  "lab-justif?action=products",
  `supplier-code-refs?codes=${ALL_GROUP_CODES.join(",")}&cips=${ALL_FALLBACK_CIPS.join(",")}`,
  "odoo-catalog?count=1",
  "odoo-catalog?expiry_months=4",
  "restock-alert?action=expiry_discounts",
  "group-order?fournisseur=ulabs",
  "order-list?source=ulabs",
  ...RECHERCHES.map(q => `odoo-catalog?q=${encodeURIComponent(q)}&limit=200`),
];

const anonymise = creeAnonymiseur();
const pause = (ms) => new Promise(r => setTimeout(r, ms));

async function lit(chemin) {
  const url = SOURCE + chemin;
  const debut = Date.now();
  const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(90000) });
  const texte = await r.text();
  let corps; try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, ms: Date.now() - debut };
}

async function main() {
  mkdirSync(DOSSIER_GET, { recursive: true });
  const index = existsSync(INDEX_CAPTURE) ? JSON.parse(readFileSync(INDEX_CAPTURE, "utf8")) : { entrees: {} };
  const demandes = [...DEMANDES];
  let echecs = 0;
  for (let i = 0; i < demandes.length; i++) {
    const chemin = demandes[i];
    try {
      const { statut, corps, ms } = await lit(chemin);
      const fichier = nomFixture(chemin);
      const propre = anonymise(corps);
      writeFileSync(resolve(DOSSIER_GET, fichier), JSON.stringify(propre));
      index.entrees[chemin] = { fichier, statut, octets: JSON.stringify(propre).length, capture: new Date().toISOString() };
      console.log(`${statut === 200 ? "✓" : "⚠"} ${statut} ${chemin.slice(0, 90)} → ${fichier} (${ms} ms)`);
      if (statut !== 200) echecs++;
      // campagnes actives : leurs commandes validées (CIP et quantités agrégés, sans données de pharmacie)
      if (chemin === "campaign-get" && Array.isArray(corps))
        for (const c of corps) if (c?.active && c.id && c.id !== "ulabs") demandes.push(`order-list?source=${encodeURIComponent(c.id)}`);
    } catch (e) {
      echecs++;
      console.log(`✗ ${chemin.slice(0, 90)} : ${e.message}`);
    }
    await pause(150);   // en douceur
  }
  index.source = SOURCE;
  index.maj = new Date().toISOString();
  writeFileSync(INDEX_CAPTURE, JSON.stringify(index, null, 2));
  console.log(`\nDonnées figées : ${DOSSIER_GET}${echecs ? `\n⚠ ${echecs} lecture(s) en échec` : ""}`);
  process.exitCode = echecs ? 1 : 0;
}

main();
