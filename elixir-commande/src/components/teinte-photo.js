// ── Admin : teinte dominante d'une photo (mises en avant de l'accueil, docs/accueil.md § 7) ──
// Calculée UNE fois dans l'admin, à l'ajout ou au changement de photo, et écrite dans la mise en avant (couleur_auto) :
// la page des pharmacies ne lit jamais un pixel. Seulement si l'hébergeur autorise la lecture (en-tête CORS : Shopify,
// Open Beauty Facts…) ; la banque d'images Medipim ne l'autorise pas → pas de couleur automatique (message dans l'éditeur).
// teinteDePixels est pure (testée hors ligne par scripts/test-vedettes.mjs).
const hex = (r, g, b) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// pixels RVBA (24 × 24) → « #rrggbb » ou null : pixels transparents, presque blancs, presque noirs ou gris ignorés ;
// histogramme de teinte en 12 classes pondéré par la saturation ; moyenne RVB de la classe dominante
export function teinteDePixels(data) {
  const classes = Array.from({ length: 12 }, () => ({ poids: 0, r: 0, g: 0, b: 0, n: 0 }));
  let retenus = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2, d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (l > 0.92 || l < 0.08 || s < 0.15) continue;
    const R = r / 255, G = g / 255, B = b / 255;
    const h = (max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4) * 60;
    const c = classes[Math.min(11, Math.floor(h / 30))];
    c.poids += s; c.r += r; c.g += g; c.b += b; c.n++; retenus++;
  }
  if (retenus < 20) return null;
  const top = classes.reduce((a, c) => (c.poids > a.poids ? c : a));
  return hex(top.r / top.n, top.g / top.n, top.b / top.n);
}

// adresse → Promise<{ hex } | { hex: null } (photo sans couleur) | { erreur: "lecture" | "delai" }>
export function teinteDominante(url) {
  return new Promise((ok) => {
    if (!url || typeof Image === "undefined") { ok({ erreur: "lecture" }); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const t = setTimeout(() => ok({ erreur: "delai" }), 2000);
    img.onload = () => {
      clearTimeout(t);
      try {
        const c = document.createElement("canvas"); c.width = 24; c.height = 24;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 24);
        ok({ hex: teinteDePixels(x.getImageData(0, 0, 24, 24).data) });
      } catch { ok({ erreur: "lecture" }); }   // canvas « souillé » : l'hébergeur n'autorise pas la lecture
    };
    img.onerror = () => { clearTimeout(t); ok({ erreur: "lecture" }); };
    img.src = String(url).replace(/\/media\/(medium|large)\//, "/media/thumbnail/");
  });
}
