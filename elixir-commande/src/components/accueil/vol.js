// ── Le geste d'achat : la miniature du produit vole jusqu'au compteur du panier, qui rebondit ──
// Copie réduite à 56 px (photo « thumbnail » ou mini-boîte), calque fixe au-dessus de l'en-tête et du panier flottant
// (z-index 295, sous le voile du panier). Enveloppe externe : trajet horizontal linéaire ; interne : vertical en cloche
// (monte puis plonge), échelle 1 → 0,35. Jamais en mouvement réduit (l'appelant ne l'appelle pas).
import { RESSORT, anime } from "./outils.js";

// compteur visible : celui de l'en-tête (collant), sinon le panier flottant
function cible() {
  const liste = [...document.querySelectorAll("[data-cible-panier]")];
  return liste.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; }) || null;
}

export function voler(source, { image, marque, dosage, teinte }) {
  const arrivee = cible();
  if (!source || !arrivee) return;
  const a = source.getBoundingClientRect(), b = arrivee.getBoundingClientRect();
  if (!a.width) return;
  const x = document.createElement("div"), y = document.createElement("div");
  x.className = "acc-vol"; y.className = "acc-vol-y";
  if (image) {
    const img = document.createElement("img");
    img.src = image; img.alt = ""; img.draggable = false;
    y.appendChild(img);
  } else {
    const boite = document.createElement("div");
    boite.className = "acc-vol-boite";
    if (teinte) boite.style.setProperty("--acc-teinte", teinte);
    boite.textContent = marque || "";
    if (dosage) { const d = document.createElement("b"); d.textContent = dosage; boite.appendChild(d); }
    y.appendChild(boite);
  }
  x.appendChild(y);
  const x0 = a.left + a.width / 2 - 28, y0 = a.top + a.height / 2 - 28;
  x.style.left = `${x0}px`; x.style.top = `${y0}px`;
  document.body.appendChild(x);
  const dx = b.left + b.width / 2 - 28 - x0, dy = b.top + b.height / 2 - 28 - y0;
  const duree = 550;
  const ax = anime(x, [{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], { duration: duree, easing: "linear", fill: "forwards" });
  anime(y, [{ transform: "translateY(0) scale(1)", opacity: 1 }, { transform: `translateY(${dy}px) scale(.35)`, opacity: 0.7 }],
    { duration: duree, easing: "cubic-bezier(.2,-0.6,.6,1)", fill: "forwards" });
  const fin = () => x.remove();
  if (ax) ax.onfinish = fin; else fin();
  setTimeout(fin, duree + 200);   // filet de sécurité (onglet caché : l'animation peut ne pas finir)
}

// rebond du compteur or (après la mise à jour du panier : le bouton devient or s'il était vide)
export function rebondPanier() {
  const el = document.querySelector("header [data-cible-panier]") || cible();
  anime(el, [{ transform: "scale(1)" }, { transform: "scale(1.18)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 300, easing: RESSORT });
}
