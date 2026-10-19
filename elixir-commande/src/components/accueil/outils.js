// ── Page d'accueil : outils communs du chunk (mouvement, photos, formats, préférences de l'appareil) ──
import { useEffect, useState } from "react";
import { fmtEur } from "../../theme.js";

// Jetons de mouvement (docs/accueil.md § 5.1) : linear() quand le navigateur le connaît (rebond), sinon cubic-bezier (Safari 15)
const lineaireConnu = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("transition-timing-function", "linear(0, 1)");
export const RESSORT = lineaireConnu ? "linear(0, .25 7%, 1.05 30%, 1.08 38%, 1 55%, .99 70%, 1)" : "cubic-bezier(.34,1.56,.64,1)";
export const EASE = "cubic-bezier(.22,1,.36,1)";
export const SORTIE = "cubic-bezier(.55,0,1,.45)";

// Web Animations : jamais d'erreur (navigateur ancien, élément absent) ; « backwards » posé d'office (pas de flash)
export function anime(el, images, options) {
  if (!el || typeof el.animate !== "function") return null;
  try { return el.animate(images, { fill: "backwards", ...options }); } catch { return null; }
}

// Préférence de l'appareil, suivie en direct (mouvement réduit, pointeur fin…)
export function useMedia(requete) {
  const lire = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(requete).matches;
  const [v, setV] = useState(lire);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const m = window.matchMedia(requete);
    const f = () => setV(m.matches);
    f();
    if (m.addEventListener) { m.addEventListener("change", f); return () => m.removeEventListener("change", f); }
    m.addListener(f); return () => m.removeListener(f);
  }, [requete]);
  return v;
}
export const REDUIT = "(prefers-reduced-motion: reduce)";
export const POINTEUR_FIN = "(hover: hover) and (pointer: fine)";

// Photos de la banque d'images (taille dans l'adresse : /media/thumbnail|medium|large/) ; autre adresse : telle quelle
const RE_TAILLE = /\/media\/(thumbnail|medium|large)\//;
export const photoReconnue = (url) => RE_TAILLE.test(url || "");
export const photo = (url, taille) => (url && RE_TAILLE.test(url) ? url.replace(RE_TAILLE, `/media/${taille}/`) : url || null);

// Textes
export const sansEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").trim();
export const prixHT = (n) => `${fmtEur(n)} HT`;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// « du 5 au 19 octobre » ; « du 28 septembre au 12 octobre » ; court : « 5 → 19 oct. »
export function periodeTexte(periode, court = false) {
  const [d, a] = [periode?.du, periode?.au].map(x => /^(\d{4})-(\d{2})-(\d{2})$/.exec(x || ""));
  if (!d || !a) return "";
  const j = (m) => Number(m[3]), mo = (m) => Number(m[2]) - 1;
  if (court) return `${j(d)}${mo(d) !== mo(a) ? ` ${MOIS_COURT[mo(d)]}` : ""} → ${j(a)} ${MOIS_COURT[mo(a)]}`;
  return `du ${j(d)}${mo(d) !== mo(a) ? ` ${MOIS[mo(d)]}` : ""} au ${j(a)} ${MOIS[mo(a)]}`;
}
// « le 19 oct. à 22 h 16 » (heure de Paris)
export function majTexte(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return `le ${Number(p.day)} ${MOIS_COURT[Number(p.month) - 1]} à ${Number(p.hour)} h ${p.minute}`;
}
// Libellé du lot : « carton de 120 » (Stratège), « lot de 12 », « 1 boîte »
export const libelleLot = (qte, menuKey) => (qte > 1 ? `${menuKey === "stratege" ? "carton" : "lot"} de ${qte}` : `${qte} boîte`);
