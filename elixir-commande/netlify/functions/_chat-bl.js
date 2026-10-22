// ── Assistant Elixir : duplicata de bon de livraison (PDF généré à la volée, rien n'est stocké) ──
// Odoo ne garde pas le PDF d'un bon de livraison (BL) : il le recalcule à chaque impression, et ce calcul est interdit par
// l'API (enquête du 22/10/2026). chat-fichier.js sert donc, pour TOUS les BL, ce DUPLICATA établi avec les données lues
// par donneesLivraisons (_chat-perimetre.js, domaines de la fiche) : une seule présentation, aucune pièce jointe servie. Mêmes rubriques que le BL imprimé par l'entrepôt (rapport standard d'Odoo
// « Bon de livraison ») : n°, commande, date d'expédition, référence client, adresse de livraison, produits [CIP], lot, date
// d'expiration, quantité livrée, quantités restant à livrer, mentions légales. Écarts assumés : mise en page et police
// (Helvetica, comme le relevé), libellé « Bon de livraison », bandeau « DUPLICATA » et date d'édition, pas de téléphone
// (jamais lu), date d'expiration sans heure, nom du fichier. Le duplicata reflète les données d'Odoo À LA DATE D'ÉDITION
// (lots, péremptions et quantités restantes sont relus à ce moment) : il n'affirme aucune identité avec un papier remis à
// la livraison. Plusieurs BL : chacun commence sur une nouvelle page, numérotée « Page x / y » dans son BL.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { texteWinAnsi, eur } from "./_chat-releve.js";
import { jourFr, dateOdoo } from "./_chat-perimetre.js";

// Société 2 : en-tête et pied de page du BL d'Odoo (res.company 2, report_footer), relevés le 22/10/2026
export const SOCIETE = Object.freeze({
  nom: "Elixir Pharma", adresse: ["53 rue Fontenelles", "78920 Ecquevilly", "France"],
  pied: ["SAS - Société par actions simplifiée au capital de 30 000 € - N°TVA : FR68925224172 - NAF : 4646Z - RCS: Versailles",
    "B 925 224 172 - Tél: 01 86 04 39 95 - Email: pharmacien@elixirpharma.fr"],
});
export const MENTION_BL = "Duplicata établi par Elixir Pharma à partir des données de livraison enregistrées à la date d'édition : produits, lots, péremptions et quantités livrées.";
export const LIBELLE_BL = "Bon de livraison";
export const TITRE_DUPLICATA = "DUPLICATA";

const PETROLE = rgb(0x0f / 255, 0x2d / 255, 0x3d / 255), ENCRE = rgb(0x20 / 255, 0x19 / 255, 0x17 / 255), GRIS = rgb(0x6f / 255, 0x68 / 255, 0x63 / 255);
const OR = rgb(0xb5 / 255, 0x90 / 255, 0x4a / 255), FILET = rgb(0.85, 0.83, 0.79), FOND = rgb(0.95, 0.935, 0.91);

// « 2026-03-21 13:15:51 » (UTC, Odoo) → « 21/03/2026 14:15:51 » (heure de Paris)
export function dateHeureBl(s) {
  const dt = dateOdoo(s);
  if (!dt || Number.isNaN(dt.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(dt).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
const editionParis = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} à ${p.hour}:${p.minute}`;
};
const quantite = (q, unite) => `${eur(q)}${unite ? ` ${unite}` : ""}`;
const nomSur = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Nom du fichier : un bon → Duplicata_BL_EP_OUT_01001.pdf ; plusieurs → Duplicatas_BL_<premier jour>[_<dernier jour>].pdf
// (jours de sortie de l'entrepôt, heure de Paris)
export function nomFichierBl(bons) {
  if (bons.length === 1) return `Duplicata_BL_${nomSur(bons[0].numero)}.pdf`;
  const jours = bons.map(b => (b.date_done ? dateOdoo(b.date_done).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) : null)).filter(Boolean).sort();
  return `Duplicatas_BL${jours.length ? `_${jours[0]}${jours.at(-1) !== jours[0] ? `_${jours.at(-1)}` : ""}` : ""}.pdf`;
}

// bons : sortie de donneesLivraisons ; edite : Date d'édition → Buffer (PDF)
export async function blPdf(bons, { edite = new Date() } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(texteWinAnsi(bons.length === 1 ? `Duplicata du bon de livraison ${bons[0].numero}` : `Duplicatas de ${bons.length} bons de livraison`));
  doc.setAuthor("Elixir Pharma"); doc.setProducer("Elixir Pharma"); doc.setCreator("Assistant Elixir");
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 595.28, H = 841.89, M = 40, BAS = 78;
  const edition = editionParis(edite);
  let page = null, y = 0;
  const largeur = (t, taille, gras) => (gras ? fb : f).widthOfTextAtSize(t, taille);
  const ecrire = (txt, x, yy, { taille = 9, gras = false, couleur = ENCRE, droite = false, centre = false, max = null } = {}) => {
    let t = texteWinAnsi(txt);
    if (max) while (t.length > 1 && largeur(t, taille, gras) > max) t = t.slice(0, -2) + "…";
    const w = largeur(t, taille, gras);
    page.drawText(t, { x: droite ? x - w : centre ? x - w / 2 : x, y: yy, size: taille, font: gras ? fb : f, color: couleur });
  };
  // découpe en lignes d'au plus « max » points (mot trop long : coupé)
  const lignesDe = (txt, max, taille, gras = false) => {
    const mots = texteWinAnsi(txt).split(/\s+/).filter(Boolean);
    const out = [];
    let cour = "";
    for (let m of mots) {
      while (largeur(m, taille, gras) > max) {
        let i = m.length;
        while (i > 1 && largeur(m.slice(0, i), taille, gras) > max) i--;
        if (cour) { out.push(cour); cour = ""; }
        out.push(m.slice(0, i)); m = m.slice(i);
      }
      const essai = cour ? `${cour} ${m}` : m;
      if (largeur(essai, taille, gras) <= max) cour = essai; else { if (cour) out.push(cour); cour = m; }
    }
    if (cour) out.push(cour);
    return out.length ? out : [""];
  };
  const croix = (x, yy, t) => {   // croix d'Elixir (pétrole), coin bas gauche en (x, yy), côté t
    const e = t * 0.32;
    page.drawRectangle({ x: x + (t - e) / 2, y: yy, width: e, height: t, color: PETROLE });
    page.drawRectangle({ x, y: yy + (t - e) / 2, width: t, height: e, color: PETROLE });
  };
  const tampon = (x, yy, petit = false) => {   // bandeau « DUPLICATA » et date d'édition, aligné à droite sur x
    const taille = petit ? 10 : 13, w = largeur(TITRE_DUPLICATA, taille, true) + 22, h = petit ? 17 : 22;
    page.drawRectangle({ x: x - w, y: yy, width: w, height: h, borderColor: OR, borderWidth: 1.4, color: rgb(1, 1, 1) });
    ecrire(TITRE_DUPLICATA, x - w / 2, yy + (petit ? 5 : 6.5), { taille, gras: true, couleur: PETROLE, centre: true });
    if (!petit) ecrire(`Édité le ${edition}`, x, yy - 11, { taille: 7.5, couleur: GRIS, droite: true });
  };

  const C = { produit: M, lot: M + 292, exp: M + 377, livre: L - M };
  const LP = 284, LL = 80;
  const enteteTableau = () => {
    page.drawRectangle({ x: M - 4, y: y - 6, width: L - 2 * M + 8, height: 18, color: FOND });
    ecrire("Produit", C.produit, y, { taille: 8.5, gras: true });
    ecrire("Lot", C.lot, y, { taille: 8.5, gras: true });
    ecrire("Date d'expiration", C.exp, y, { taille: 8.5, gras: true });
    ecrire("Livré", C.livre, y, { taille: 8.5, gras: true, droite: true });
    y -= 20;
  };
  const enteteReste = () => {
    page.drawRectangle({ x: M - 4, y: y - 6, width: L - 2 * M + 8, height: 18, color: FOND });
    ecrire("Produit", C.produit, y, { taille: 8.5, gras: true });
    ecrire("Quantité", C.livre, y, { taille: 8.5, gras: true, droite: true });
    y -= 20;
  };

  for (const b of bons) {
    const premiere = doc.getPageCount();
    // ── première page du BL ──
    page = doc.addPage([L, H]);
    croix(M, H - 62, 20);
    ecrire("ELIXIR PHARMA", M + 28, H - 56, { taille: 14, gras: true, couleur: PETROLE });
    page.drawRectangle({ x: M + 28, y: H - 61, width: 106, height: 1.6, color: OR });
    tampon(L - M, H - 64);
    y = H - 84;
    ecrire(SOCIETE.nom, M, y, { taille: 9, gras: true }); y -= 11.5;
    for (const l of SOCIETE.adresse) { ecrire(l, M, y, { taille: 9 }); y -= 11.5; }
    // adresse de livraison (colonne de droite), sans téléphone
    let yd = H - 130;
    const xd = M + 300;
    ecrire("Adresse de livraison :", xd, yd, { taille: 9, gras: true }); yd -= 12.5;
    const a = b.adresse || {};
    const ad = [a.nom, a.rue, a.rue2, [a.cp, a.ville].filter(Boolean).join(" "), a.pays].filter(Boolean);
    for (const l of ad) for (const s of lignesDe(l, L - M - xd, 9.5)) { ecrire(s, xd, yd, { taille: 9.5 }); yd -= 12; }
    y = Math.min(y, yd) - 22;
    ecrire(LIBELLE_BL.toUpperCase(), M, y, { taille: 9, gras: true, couleur: GRIS }); y -= 22;
    ecrire(b.numero, M, y, { taille: 21, couleur: PETROLE }); y -= 28;
    // commande, date d'expédition, référence client
    const infos = [["Commande :", b.origine || b.commande || ""], ["Date d'expédition :", dateHeureBl(b.date_done)],
      ...(b.reference_client ? [["Référence client :", b.reference_client]] : [])];
    infos.forEach(([lib, val], i) => {
      const x = M + i * 172;
      ecrire(lib, x, y, { taille: 8.5, gras: true });
      ecrire(val, x, y - 12.5, { taille: 9.5, max: 165 });
    });
    y -= 40;

    // ── lignes : produit [CIP], lot, date d'expiration, quantité livrée ──
    enteteTableau();
    const suite = () => {
      page = doc.addPage([L, H]);
      croix(M, H - 52, 14);
      ecrire("ELIXIR PHARMA", M + 21, H - 48, { taille: 10.5, gras: true, couleur: PETROLE });
      tampon(L - M, H - 56, true);
      ecrire(`${LIBELLE_BL} ${b.numero} (suite)`, M, H - 82, { taille: 12, couleur: PETROLE });
      y = H - 108;
    };
    const lignes = b.lignes || [];
    if (!lignes.length) { ecrire("Aucune ligne validée sur ce transfert.", M, y, { taille: 9, couleur: GRIS }); y -= 16; }
    for (const l of lignes) {
      const texte = lignesDe(l.produit || "", LP, 8.5);
      const lot = lignesDe(l.lot || "", LL, 8.5).slice(0, 2);
      const h = Math.max(texte.length, lot.length, 1) * 11 + 7;
      if (y - h < BAS) { suite(); enteteTableau(); }
      texte.forEach((s, k) => ecrire(s, C.produit, y - k * 11, { taille: 8.5 }));
      lot.forEach((s, k) => ecrire(s, C.lot, y - k * 11, { taille: 8.5 }));
      ecrire(l.peremption ? jourFr(l.peremption) : "", C.exp, y, { taille: 8.5 });
      ecrire(quantite(l.quantite, l.unite), C.livre, y, { taille: 8.5, droite: true });
      y -= h;
      page.drawLine({ start: { x: M - 4, y: y + 8 }, end: { x: L - M + 4, y: y + 8 }, thickness: 0.5, color: FILET });
    }

    // ── quantités restant à livrer (reliquats encore ouverts) ──
    const restes = b.restes || [];
    if (restes.length) {
      y -= 14;
      if (y - 50 < BAS) suite();
      ecrire("Quantités restantes non encore livrées :", M, y, { taille: 9.5 }); y -= 20;
      enteteReste();
      for (const r of restes) {
        const texte = lignesDe(r.produit || "", 400, 8.5);
        const h = texte.length * 11 + 7;
        if (y - h < BAS) { suite(); enteteReste(); }
        texte.forEach((s, k) => ecrire(s, C.produit, y - k * 11, { taille: 8.5 }));
        ecrire(quantite(r.quantite, r.unite), C.livre, y, { taille: 8.5, droite: true });
        y -= h;
        page.drawLine({ start: { x: M - 4, y: y + 8 }, end: { x: L - M + 4, y: y + 8 }, thickness: 0.5, color: FILET });
      }
    }

    // ── mention du duplicata ──
    const mention = [`Duplicata de bon de livraison édité le ${edition} par l'Assistant Elixir, à partir des données de livraison enregistrées par Elixir Pharma à cette date.`,
      ...(b.renvoi ? ["Renvoi : nouvelle livraison faite après un retour."] : []),
      ...(restes.length ? ["Quantités restant à livrer : situation à la date d'édition."] : [])];
    y -= 16;
    if (y - mention.length * 11 < BAS) suite();
    for (const s of mention.flatMap(t => lignesDe(t, L - 2 * M, 8))) { ecrire(s, M, y, { taille: 8, couleur: GRIS }); y -= 11; }

    // ── pied de page de chaque page de ce BL : mentions légales, « Page x / y » ──
    const pages = doc.getPages().slice(premiere);
    pages.forEach((pg, i) => {
      page = pg;
      page.drawLine({ start: { x: M, y: 58 }, end: { x: L - M, y: 58 }, thickness: 0.6, color: FILET });
      SOCIETE.pied.forEach((t, k) => ecrire(t, L / 2, 46 - k * 10, { taille: 7.2, couleur: GRIS, centre: true, max: L - 2 * M }));
      ecrire(`Page : ${i + 1} / ${pages.length}`, L / 2, 18, { taille: 7.5, couleur: GRIS, centre: true });
    });
  }
  return Buffer.from(await doc.save());
}
