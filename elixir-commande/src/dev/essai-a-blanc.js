// ── Mode « essai à blanc » des aperçus Netlify (deploy previews, branch deploys) ──
// Chargé par main.jsx seulement si VITE_ESSAI_A_BLANC === "1" (netlify.toml, contextes d'aperçu) :
// absent du build de production. Les fonctions d'un aperçu tournent avec les variables de PRODUCTION :
// sans ce garde-fou, une commande passée sur un aperçu partirait réellement (e-mail, Supabase, relais PharmaML).
// Toute requête autre que GET/HEAD vers /.netlify/functions/ reçoit une fausse réponse 200 (rien ne part) ;
// les lectures (GET) restent réelles pour montrer le vrai catalogue. Bandeau fixe en bas à gauche.
import { reponseFictive } from "./reponses-fictives.js";

const FONCTIONS = "/.netlify/functions/";
export const TEXTE_BANDEAU = "Aperçu : aucune commande ne part";

// Requête vers une fonction Netlify (quel que soit le domaine) qui n'est pas une simple lecture
const aNeutraliser = (url, methode) => url.pathname.startsWith(FONCTIONS) && methode !== "GET" && methode !== "HEAD";

const lireCorps = (corps) => {
  if (typeof corps !== "string") return corps ?? null;   // FormData, Blob… : rien à décoder
  try { return JSON.parse(corps); } catch { return corps; }
};

export function installe() {
  if (window.__essaiABlanc) return;
  window.__essaiABlanc = true;
  const fetchReel = window.fetch.bind(window);
  window.fetch = async (entree, options = {}) => {
    const req = typeof Request !== "undefined" && entree instanceof Request ? entree : null;
    let url;
    try { url = new URL(req ? req.url : String(entree), window.location.href); } catch { return fetchReel(entree, options); }
    const methode = String(options.method || req?.method || "GET").toUpperCase();
    if (!aNeutraliser(url, methode)) return fetchReel(entree, options);
    const fn = url.pathname.slice(FONCTIONS.length).split("/")[0];
    const corps = lireCorps(options.body !== undefined ? options.body : (req ? await req.clone().text() : null));
    const reponse = reponseFictive({ fn, methode, corps });
    console.info(`[essai à blanc] ${methode} ${fn} : rien n'est parti`, corps);
    return new Response(JSON.stringify(reponse), { status: 200, headers: { "Content-Type": "application/json", "X-Essai-A-Blanc": "1" } });
  };
  // navigator.sendBeacon n'est pas utilisé aujourd'hui : neutralisé quand même vers les fonctions
  if (navigator.sendBeacon) {
    const beaconReel = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (cible, donnees) => {
      try { if (aNeutraliser(new URL(String(cible), window.location.href), "POST")) { console.info("[essai à blanc] sendBeacon neutralisé", cible); return true; } } catch { /* adresse illisible : envoi normal */ }
      return beaconReel(cible, donnees);
    };
  }
  afficheBandeau();
}

function afficheBandeau() {
  const style = document.createElement("style");
  style.textContent = "@media print{.essai-a-blanc{display:none!important}}";
  document.head.appendChild(style);
  const b = document.createElement("div");
  b.className = "essai-a-blanc";
  b.setAttribute("role", "status");
  b.textContent = TEXTE_BANDEAU;
  // en bas à gauche, au-dessus de tout, sans bloquer les clics (panier flottant à droite, barre U-Labs au centre)
  Object.assign(b.style, {
    position: "fixed", left: "12px", bottom: "12px", zIndex: "2147483000", pointerEvents: "none",
    background: "#92400e", color: "#fff", borderRadius: "999px", padding: "6px 14px",
    font: "700 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif", boxShadow: "0 4px 14px -6px rgba(15,45,61,.45)",
  });
  document.body.appendChild(b);
}
