// ── Assistant Elixir : formats d'affichage et libellés des cartes (docs/assistant-contrat.md, « Cartes UiAction ») ──
// JS pur, sans dépendance (testé par scripts/banc/test-assistant-interface.mjs). Affichage seulement : les cartes
// arrivent du serveur avec des montants en nombre (euros) et des dates AAAA-MM-JJ (heure de Paris).

const ESP = " ";   // espace insécable (avant « % », dans « 14 h 05 »)
const PARIS = "Europe/Paris";

// "2026-10-03" → "03/10/2026" (lu tel quel, sans fuseau : la date est déjà celle de Paris) ; autre chose → texte brut
export function dateFr(d) {
  const m = String(d ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d ?? "");
}
// péremption "2028-04-30" → "04/2028"
export function peremptionFr(d) {
  const m = String(d ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : String(d ?? "");
}
const instant = (iso) => { const t = new Date(iso); return Number.isFinite(t.getTime()) ? t : null; };
// "2026-10-16T12:05:00Z" → "14 h 05" (Paris)
export function heureFr(iso) {
  const t = instant(iso);
  if (!t) return "";
  const [h, m] = t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: PARIS }).split(":");
  return `${h}${ESP}h${ESP}${m}`;
}
// date seule (AAAA-MM-JJ) ou instant ISO → "16/10/2026" ou "16/10/2026 à 14 h 05"
export function dateHeureFr(v) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""))) return dateFr(v);
  const t = instant(v);
  if (!t) return String(v ?? "");
  return `${t.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: PARIS })} à ${heureFr(v)}`;
}
// pastille de contexte : « Commande du 14 octobre, 10 h 32 »
export function libelleCommande(iso) {
  const t = instant(iso);
  if (!t) return "Commande";
  return `Commande du ${t.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: PARIS })}, ${heureFr(iso)}`;
}
// quantités et taux : séparateur de milliers français ; 2.1 → "2,1 %" (taux en pourcentage, comme dans Odoo)
export const qteFr = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("fr-FR") : String(n ?? ""));
// taux inconnu (null : taxe hors pourcentage, comme « Autre » du relevé PDF) → « Autre »
export const tauxFr = (t) => (t == null || t === "" ? "Autre" : Number.isFinite(Number(t)) ? `${String(Number(Number(t).toFixed(2))).replace(".", ",")}${ESP}%` : String(t));
export const pluriel = (n, mot, pl = `${mot}s`) => `${qteFr(n)} ${Number(n) > 1 ? pl : mot}`;

// codes de l'application de réclamation (enum de preparer_demande_retour, conception § 2.5) ; un libellé déjà rédigé
// par le serveur passe tel quel
export const MOTIFS = {
  produit_manquant: "Produit manquant", reliquat: "Reliquat", erreur_produit: "Erreur de produit",
  quantite_incorrecte: "Quantité incorrecte", produit_casse: "Produit cassé", caisse_manquante: "Caisse manquante",
  mauvaise_caisse: "Mauvaise caisse", commande_non_recue: "Commande non reçue", mauvaise_commande_recue: "Mauvaise commande reçue",
  retour_erreur_pharmacie: "Erreur de commande de la pharmacie", dlu_courte: "Péremption trop courte",
  ecart_facture: "Écart de facturation", autre: "Autre motif",
};
export const SOUHAITS = {
  renvoi: "Renvoi du produit", avoir: "Avoir", garde: "Garder le produit", reprise: "Reprise du produit",
  remise: "Remise", recevoir_reliquat: "Recevoir le reliquat", annule_reliquat: "Annuler le reliquat", non_precise: "Non précisé",
};
export const ORIGINES = { site: "Site Elixir", logiciel: "Logiciel de l'officine", saisie: "Saisie Elixir" };
export const PIECES = { facture: "Facture", avoir: "Avoir" };
export const libelle = (table, code) => table[code] || String(code ?? "");

// « Appeler » : seul lien de l'assistant, posé à partir du numéro fourni par le serveur (chiffres et « + » seulement)
export function lienTel(telephone) {
  const n = String(telephone ?? "").replace(/[^\d+]/g, "");
  return /^\+?\d{6,15}$/.test(n) ? `tel:${n}` : null;
}

// nom du fichier : en-tête Content-Disposition (filename*= UTF-8 ou filename=), sinon le nom proposé
export function nomFichier(disposition, defaut) {
  const d = String(disposition ?? "");
  const etoile = d.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  let nom = "";
  if (etoile) { try { nom = decodeURIComponent(etoile[1].trim()); } catch { nom = ""; } }
  if (!nom) { const m = d.match(/filename\s*=\s*"?([^";]+)"?/i); nom = m ? m[1].trim() : ""; }
  nom = nom.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120);
  return nom || defaut;
}
