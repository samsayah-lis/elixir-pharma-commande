// ── Page d'accueil : outils communs du chunk (mouvement, photos, formats, préférences de l'appareil) ──
import React, { useEffect, useState } from "react";
import { fmtEur } from "../../theme.js";
import { abonnerIllisibles, estIllisible, versionIllisibles } from "./illisibles.js";

// Photos notées illisibles (illisibles.js) : le composant se redessine dès qu'une adresse l'est → numéro de version
// (dépendance des useMemo qui construisent les vitrines)
export function useIllisibles() {
  const [v, setV] = useState(versionIllisibles);
  useEffect(() => { setV(versionIllisibles()); return abonnerIllisibles(setV); }, []);
  return v;
}

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

// Rangée à défilement horizontal : côtés qui débordent ("", "g", "d", "gd"), suivis au défilement et au redimensionnement
// (posé en data-debord : fondu CSS du côté qui déborde, aucun élément coupé net)
export function useDebord(ref, cle) {
  const [debord, setDebord] = useState("");
  useEffect(() => {
    const l = ref.current;
    if (!l) return undefined;
    const maj = () => setDebord((l.scrollLeft > 1 ? "g" : "") + (l.scrollLeft + l.clientWidth < l.scrollWidth - 1 ? "d" : ""));
    maj();
    l.addEventListener("scroll", maj, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(maj) : null;
    ro?.observe(l);
    return () => { l.removeEventListener("scroll", maj); ro?.disconnect(); };
  }, [ref, cle]);
  return debord;
}
export const POINTEUR_FIN = "(hover: hover) and (pointer: fine)";

// Photos en taille réduite, chez les hébergeurs qui en servent une (sinon l'original : 2000 px et 1,3 Mo pour une carte
// de 100 px) : banque d'images (taille dans l'adresse : /media/thumbnail|medium|large/), Shopify (paramètre width,
// cdn.shopify.com et les boutiques /cdn/shop/), Open Beauty Facts (.200.jpg, .400.jpg, .full.jpg) ; autre adresse : telle quelle
const RE_TAILLE = /\/media\/(thumbnail|medium|large)\//;
const RE_SHOPIFY = /^https:\/\/(cdn\.shopify\.com\/s\/files\/|[^/?#]+\/cdn\/shop\/)/;
const RE_OBF = /^(https:\/\/images\.openbeautyfacts\.org\/images\/products\/[^?#]+\.\d+\.)(full|100|200|400)(\.jpg)$/;
const LARGEUR_SHOPIFY = { thumbnail: 200, medium: 480, large: 960 };
const TAILLE_OBF = { thumbnail: "200", medium: "400", large: "full" };
// Miniature décorative (halo flou de la salle, d'une tuile, de la gondole) : en erreur, simplement retirée ici (jamais
// d'icône d'image cassée), sans noter l'adresse : une miniature décorative ratée ne retire pas la photo du produit
export function PhotoDecor({ url, ...props }) {
  const [ko, setKo] = useState(null);
  if (!url || ko === url || estIllisible(url)) return null;
  return React.createElement("img", { ...props, src: photo(url, "thumbnail"), alt: "", draggable: false, decoding: "async", onError: () => setKo(url) });
}
export const photoReconnue = (url) => !!url && (RE_TAILLE.test(url) || RE_SHOPIFY.test(url) || RE_OBF.test(url));
export function photo(url, taille) {
  if (!url) return null;
  if (RE_TAILLE.test(url)) return url.replace(RE_TAILLE, `/media/${taille}/`);
  if (RE_SHOPIFY.test(url)) {
    try { const u = new URL(url); u.searchParams.set("width", String(LARGEUR_SHOPIFY[taille] || 480)); return u.href; } catch { return url; }
  }
  const m = RE_OBF.exec(url);
  return m ? `${m[1]}${TAILLE_OBF[taille] || "400"}${m[3]}` : url;
}

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
