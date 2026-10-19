// ── Assistant Elixir : relevé de facturation (calcul et fichiers) ───────
// Liste des factures et avoirs ÉMIS sur une période, totaux HT / TVA / TTC et ventilation de la TVA par taux.
// Ne vaut pas état des règlements : aucun solde, aucun statut de paiement (les règlements ne sont pas dans Odoo).
// Calcul (étude Odoo § 4, vérifié sur la fiche 595 en septembre 2026 : HT 89 041,89 · TVA 2 488,65 · TTC 91 530,54) :
//   base HT par taux = −Σ balance des lignes « product » regroupées par tax_ids ; TVA = −Σ balance des lignes « tax » ;
//   jamais tax_base_amount (non signé : un avoir gonflerait la base). Sommes en centimes entiers.
// Fichiers générés à la volée par chat-fichier.js (rien n'est stocké) : Excel (xlsx, déjà installé) et PDF (pdf-lib,
// Helvetica : Inter demanderait d'embarquer la police dans le paquet de la fonction).
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { jourFr, produitDe } from "./_chat-perimetre.js";

export const MENTION_RELEVE = "Liste des documents émis ; ne reflète pas les règlements.";
export const TITRE_RELEVE = "Relevé des factures et avoirs émis – ne vaut pas état des règlements";
const cents = (x) => Math.round((Number(x) || 0) * 100);
const euros = (c) => Math.round(c) / 100;

// données lues par donneesReleve (_chat-perimetre.js) → relevé
export function calculerReleve({ pieces = [], lignes = [], taxes = [] }) {
  const taux = new Map(taxes.map(t => [t.id, t.amount_type === "percent" || !t.amount_type ? Number(t.amount) || 0 : null]));
  const tauxDe = (ids) => { let s = 0; for (const i of ids || []) { const v = taux.get(i); if (v == null) return null; s += v; } return Math.round(s * 1000) / 1000; };
  const parTaux = new Map();   // taux → { base, montant } en centimes
  const ajouter = (t, base, montant) => { const k = t == null ? "?" : String(t); const v = parTaux.get(k) || { base: 0, montant: 0 }; v.base += base; v.montant += montant; parTaux.set(k, v); };
  const produits = new Map();
  const avoirs = new Set(pieces.filter(p => p.move_type === "out_refund").map(p => p.id));
  for (const l of lignes) {
    if (l.display_type === "product") {
      ajouter(tauxDe(l.tax_ids), -cents(l.balance), 0);
      if (l.product_id) {
        const { cip, produit } = produitDe(l.product_id);
        const k = l.product_id[0];
        const v = produits.get(k) || { cip, produit, quantite: 0, ht: 0 };
        v.quantite += (avoirs.has(l.move_id?.[0]) ? -1 : 1) * (Number(l.quantity) || 0);
        v.ht += -cents(l.balance);
        produits.set(k, v);
      }
    } else if (l.display_type === "tax") ajouter(tauxDe(l.tax_line_id ? [l.tax_line_id[0]] : []), 0, -cents(l.balance));
  }
  const documents = pieces.map(p => ({
    piece: p.move_type === "out_refund" ? "avoir" : "facture", numero: p.name, date: p.invoice_date || null, echeance: p.invoice_date_due || null,
    commandes: String(p.invoice_origin || "").split(",").map(x => x.trim()).filter(x => /^S\d+$/.test(x)).length,
    ht: euros(cents(p.amount_untaxed_signed)), tva: euros(cents(p.amount_tax_signed)), ttc: euros(cents(p.amount_total_signed)),
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.numero).localeCompare(String(b.numero)));
  const somme = (k) => pieces.reduce((s, p) => s + cents(p[k]), 0);
  return {
    documents,
    nb_factures: documents.filter(x => x.piece === "facture").length,
    nb_avoirs: documents.filter(x => x.piece === "avoir").length,
    total_ht: euros(somme("amount_untaxed_signed")), total_tva: euros(somme("amount_tax_signed")), total_ttc: euros(somme("amount_total_signed")),
    tva: [...parTaux.entries()].filter(([, v]) => v.base || v.montant)
      .map(([k, v]) => ({ taux: k === "?" ? null : Number(k), base: euros(v.base), montant: euros(v.montant) }))
      .sort((a, b) => (a.taux ?? 999) - (b.taux ?? 999)),
    produits: [...produits.values()].filter(p => p.quantite || p.ht).map(p => ({ ...p, ht: euros(p.ht) }))
      .sort((a, b) => String(a.produit).localeCompare(String(b.produit), "fr")),
  };
}

// ── Mise en forme française, sans dépendre de l'ICU (espaces fines ingérables en PDF) ──
export function eur(n) {
  const c = Math.round((Number(n) || 0) * 100), neg = c < 0, a = Math.abs(c);
  const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "−" : ""}${ent},${String(a % 100).padStart(2, "0")}`;
}
const tauxTexte = (t) => (t == null ? "Autre" : `${String(t).replace(".", ",")} %`);
const libellePiece = (p) => (p === "avoir" ? "Avoir" : "Facture");
export const nomFichierReleve = (debut, fin, ext) => `Releve_Elixir_${debut}_${fin}.${ext}`;

// ── Excel ───────────────────────────────────────────────────────────────
// pharmacie = { nom, cip, ville } ; edite = Date
export function releveXlsx(rel, { debut, fin, pharmacie, edite = new Date(), detail = "par_document" }) {
  const fmt = "#,##0.00";
  const entete = [
    ["Elixir Pharma"], [TITRE_RELEVE], [],
    ["Pharmacie", pharmacie?.nom || ""], ["CIP", pharmacie?.cip || ""], ["Période", `du ${jourFr(debut)} au ${jourFr(fin)}`],
    ["Édité le", jourFr(edite.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }))], [MENTION_RELEVE], [],
  ];
  const t0 = entete.length;
  const lignes = [
    ["Date", "Type", "Numéro", "Commandes", "Échéance", "Montant HT", "TVA", "Montant TTC"],
    ...rel.documents.map(x => [jourFr(x.date), libellePiece(x.piece), x.numero, x.commandes, jourFr(x.echeance), x.ht, x.tva, x.ttc]),
    [],
    ["Total", `${rel.nb_factures} facture(s), ${rel.nb_avoirs} avoir(s)`, "", "", "", rel.total_ht, rel.total_tva, rel.total_ttc],
    [], ["Ventilation de la TVA"], ["Taux", "Base HT", "TVA"],
    ...rel.tva.map(v => [tauxTexte(v.taux), v.base, v.montant]),
  ];
  const ws = XLSX.utils.aoa_to_sheet([...entete, ...lignes]);
  // montants au format nombre (2 décimales) : colonnes F-H du tableau, B-C de la ventilation
  for (const [adr, cell] of Object.entries(ws)) {
    if (adr.startsWith("!") || typeof cell.v !== "number") continue;
    const { c, r } = XLSX.utils.decode_cell(adr);
    if (r > t0 && (c >= 5 || (c >= 1 && c <= 2 && r > t0 + rel.documents.length + 4))) cell.z = fmt;
  }
  ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relevé");
  if (detail === "par_produit") {
    const wp = XLSX.utils.aoa_to_sheet([["CIP", "Produit", "Quantité nette", "Montant HT"], ...rel.produits.map(p => [p.cip || "", p.produit, p.quantite, p.ht])]);
    for (const [adr, cell] of Object.entries(wp)) if (!adr.startsWith("!") && typeof cell.v === "number" && XLSX.utils.decode_cell(adr).c === 3) cell.z = fmt;
    wp["!cols"] = [{ wch: 15 }, { wch: 50 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wp, "Par produit");
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── PDF (A4, aux couleurs Elixir) ───────────────────────────────────────
const PETROLE = rgb(0x0f / 255, 0x2d / 255, 0x3d / 255), PAPIER = rgb(0xfb / 255, 0xf8 / 255, 0xf2 / 255), ENCRE = rgb(0x20 / 255, 0x19 / 255, 0x17 / 255);
const GRIS = rgb(0x6f / 255, 0x68 / 255, 0x63 / 255), OR = rgb(0xb5 / 255, 0x90 / 255, 0x4a / 255), ZEBRE = rgb(0.975, 0.965, 0.945);
// Helvetica (WinAnsi) : caractères hors jeu remplacés (espaces fines, signe moins typographique…)
const WINANSI = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"].map(c => c.codePointAt(0)));
export function texteWinAnsi(s) {
  return [...String(s ?? "").replace(/[\u202f\u00a0\u2009]/g, " ").replace(/\u2212/g, "-")]
    .map(c => { const n = c.codePointAt(0); return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WINANSI.has(n) ? c : n === 0x0a ? " " : "?"; }).join("");
}

export async function relevePdf(rel, { debut, fin, pharmacie, edite = new Date(), detail = "par_document" }) {
  const doc = await PDFDocument.create();
  doc.setTitle(texteWinAnsi(`Relevé Elixir Pharma du ${jourFr(debut)} au ${jourFr(fin)}`));
  doc.setProducer("Elixir Pharma"); doc.setCreator("Assistant Elixir");
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 595.28, H = 841.89, M = 40;
  let page = null, y = 0;
  const ecrire = (txt, x, yy, { taille = 9, gras = false, couleur = ENCRE, droite = false, max = null } = {}) => {
    const police = gras ? fb : f;
    let t = texteWinAnsi(txt);
    if (max) while (t.length > 1 && police.widthOfTextAtSize(t, taille) > max) t = t.slice(0, -2) + "…";
    page.drawText(t, { x: droite ? x - police.widthOfTextAtSize(t, taille) : x, y: yy, size: taille, font: police, color: couleur });
  };
  const edition = jourFr(edite.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));
  const nouvellePage = () => {
    page = doc.addPage([L, H]);
    page.drawRectangle({ x: 0, y: H - 64, width: L, height: 64, color: PETROLE });
    page.drawRectangle({ x: 0, y: H - 67, width: L, height: 3, color: OR });
    ecrire("ELIXIR PHARMA", M, H - 30, { taille: 15, gras: true, couleur: PAPIER });
    ecrire("Relevé de facturation", M, H - 47, { taille: 9.5, couleur: PAPIER });
    ecrire(`Édité le ${edition}`, L - M, H - 30, { taille: 9, couleur: PAPIER, droite: true });
    y = H - 92;
  };
  const COLS = [{ t: "Date", x: M }, { t: "Type", x: M + 58 }, { t: "Numéro", x: M + 102 }, { t: "Cdes", x: M + 222, d: true },
    { t: "Échéance", x: M + 232 }, { t: "HT", x: M + 372, d: true }, { t: "TVA", x: M + 436, d: true }, { t: "TTC", x: L - M, d: true }];
  const enteteTableau = () => {
    page.drawRectangle({ x: M - 4, y: y - 5, width: L - 2 * M + 8, height: 17, color: rgb(0.93, 0.91, 0.87) });
    for (const c of COLS) ecrire(c.t, c.x, y, { taille: 8.5, gras: true, droite: !!c.d });
    y -= 17;
  };
  const place = (h) => { if (y - h < 50) { nouvellePage(); return true; } return false; };

  nouvellePage();
  ecrire(TITRE_RELEVE, M, y, { taille: 11.5, gras: true, max: L - 2 * M }); y -= 22;
  ecrire(`${pharmacie?.nom || ""}${pharmacie?.ville ? ` – ${pharmacie.ville}` : ""}`, M, y, { taille: 10, gras: true, max: L - 2 * M }); y -= 14;
  if (pharmacie?.cip) { ecrire(`CIP ${pharmacie.cip}`, M, y, { taille: 9, couleur: GRIS }); y -= 13; }
  ecrire(`Période : du ${jourFr(debut)} au ${jourFr(fin)} · ${rel.nb_factures} facture(s), ${rel.nb_avoirs} avoir(s)`, M, y, { taille: 9, couleur: GRIS }); y -= 22;

  enteteTableau();
  rel.documents.forEach((x, i) => {
    if (place(14)) enteteTableau();
    if (i % 2) page.drawRectangle({ x: M - 4, y: y - 4, width: L - 2 * M + 8, height: 14, color: ZEBRE });
    const v = [jourFr(x.date), libellePiece(x.piece), x.numero, String(x.commandes || ""), jourFr(x.echeance), eur(x.ht), eur(x.tva), eur(x.ttc)];
    COLS.forEach((c, k) => ecrire(v[k], c.x, y, { taille: 8.5, droite: !!c.d, max: k === 2 ? 115 : null }));
    y -= 14;
  });
  place(70);
  page.drawLine({ start: { x: M - 4, y: y + 8 }, end: { x: L - M + 4, y: y + 8 }, thickness: 0.8, color: PETROLE });
  y -= 6;
  ecrire("Total net", M, y, { taille: 10, gras: true });
  ecrire(eur(rel.total_ht), COLS[5].x, y, { taille: 10, gras: true, droite: true });
  ecrire(eur(rel.total_tva), COLS[6].x, y, { taille: 10, gras: true, droite: true });
  ecrire(`${eur(rel.total_ttc)} €`, COLS[7].x, y, { taille: 10, gras: true, droite: true });
  y -= 30;

  place(40 + 14 * rel.tva.length);
  ecrire("Ventilation de la TVA", M, y, { taille: 10, gras: true }); y -= 16;
  ecrire("Taux", M, y, { taille: 8.5, gras: true }); ecrire("Base HT", M + 160, y, { taille: 8.5, gras: true, droite: true }); ecrire("TVA", M + 250, y, { taille: 8.5, gras: true, droite: true }); y -= 14;
  for (const v of rel.tva) { ecrire(tauxTexte(v.taux), M, y, { taille: 8.5 }); ecrire(eur(v.base), M + 160, y, { taille: 8.5, droite: true }); ecrire(eur(v.montant), M + 250, y, { taille: 8.5, droite: true }); y -= 14; }
  y -= 10;

  if (detail === "par_produit" && rel.produits.length) {
    place(60);
    ecrire("Détail par produit (quantités nettes des avoirs)", M, y, { taille: 10, gras: true }); y -= 16;
    const tete = () => { ecrire("CIP", M, y, { taille: 8.5, gras: true }); ecrire("Produit", M + 80, y, { taille: 8.5, gras: true });
      ecrire("Qté", M + 400, y, { taille: 8.5, gras: true, droite: true }); ecrire("HT", L - M, y, { taille: 8.5, gras: true, droite: true }); y -= 14; };
    tete();
    for (const p of rel.produits) {
      if (place(14)) tete();
      ecrire(p.cip || "", M, y, { taille: 8.5 }); ecrire(p.produit, M + 80, y, { taille: 8.5, max: 280 });
      ecrire(String(p.quantite), M + 400, y, { taille: 8.5, droite: true }); ecrire(eur(p.ht), L - M, y, { taille: 8.5, droite: true }); y -= 14;
    }
  }
  // pied de page : mention et numérotation
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    page = pg;
    ecrire(MENTION_RELEVE, M, 26, { taille: 7.5, couleur: GRIS });
    ecrire(`Page ${i + 1} / ${pages.length}`, L - M, 26, { taille: 7.5, couleur: GRIS, droite: true });
  });
  return Buffer.from(await doc.save());
}
