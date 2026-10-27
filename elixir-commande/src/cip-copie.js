// ── Copie des CIP (27/10/2026, docs/cip-copie.md) ──
// Demande de Zineb : « que les pharmacies puissent copier coller les codes CIP facilement ». Un seul module pour tout ce qui
// écrit dans le presse-papiers côté pharmacie : le CIP d'une ligne (CipCell), les CIP d'un lot de lignes (CopieCips : panier,
// Mes commandes, carte commande de l'assistant) et le bon de commande du panier (handleCopy, App). La règle anti-copie du
// catalogue (docs/refonte-charte.md § 19) n'est pas touchée : le CIP reste non sélectionnable, on le copie par un bouton ;
// la copie en lot ne porte que sur les données de la pharmacie (ses lignes, ses commandes), jamais sur un menu.
// JS pur, sans dépendance : importé par le site et par scripts/test-cip-copie.mjs.

// Écrit dans le presse-papiers : navigator.clipboard (contexte sécurisé, permission), sinon repli par un <textarea> hors écran
// et execCommand("copy") — le textarea est un champ, l'anti-copie laisse passer l'événement copy (src/anticopie.js, CHAMPS).
// Le repli rend le focus à l'élément qui l'avait (clavier dans Mes commandes, enchaînement quantité de la Saisie) ; presse-papiers
// absent (navigateur embarqué) : repli tout de suite, dans le geste de l'utilisateur (execCommand l'exige, WebKit ne garde pas
// l'activation au-delà d'une promesse). Ne lève jamais : → Promise<boolean>. doc / nav : injectés par les tests seulement.
export function copierTexte(texte, { doc = globalThis.document, nav = globalThis.navigator } = {}) {
  const t = String(texte ?? "");
  const repli = () => {
    if (!doc?.body || typeof doc.execCommand !== "function") return false;
    const actif = doc.activeElement;
    const ta = doc.createElement("textarea");
    ta.value = t; ta.setAttribute("readonly", ""); ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    doc.body.appendChild(ta);
    let ok = false;
    try { ta.focus(); ta.select(); try { ta.setSelectionRange(0, t.length); } catch { /* iOS : select() a suffi */ } ok = doc.execCommand("copy") === true; } catch { ok = false; }
    ta.remove();
    try { actif?.focus?.({ preventScroll: true }); } catch { /* focus non rendu */ }
    return ok;
  };
  if (!nav?.clipboard?.writeText) return Promise.resolve(repli());
  let p;
  try { p = nav.clipboard.writeText(t); } catch (e) { p = Promise.reject(e); }
  return p.then(() => true, () => repli());
}

// Confirmation visible partout (petit message en bas de l'écran, ToastCopie dans CipCell.jsx) : un événement sur window,
// pour que CipCell et CopieCips n'aient besoin d'aucun contexte React. detail = { message, ton } ; ton « ok » (copié) ou
// « danger » (copie impossible : la pharmacie est guidée vers la copie à la main, surtout sur mobile où rien d'autre ne le dit)
export const EVENEMENT_COPIE = "ex-copie";
export function signalerCopie(message, ton = "ok") {
  try { if (typeof globalThis.dispatchEvent === "function") globalThis.dispatchEvent(new CustomEvent(EVENEMENT_COPIE, { detail: { message: String(message), ton } })); } catch { /* sans message */ }
}

// Un CIP : copié tel quel, puis « CIP 3400… copié » signalé ; refusé : message en ton danger (CipCell rend ce CIP sélectionnable)
export const copierCip = (cip) => copierTexte(cip).then((ok) => {
  if (ok) signalerCopie(`CIP ${cip} copié`); else signalerCopie("Copie impossible : sélectionnez le numéro pour le copier", "danger");
  return ok;
});

// ── Lot de lignes : formats de collage (logiciel de la pharmacie, tableur) ──
// Quantité d'une ligne : la quantité servie quand elle est connue (servi : carte commande de l'assistant), sinon la quantité
// commandée (qty du panier et des commandes du site, quantite / commande des cartes)
export const quantiteLigne = (l) => {
  const s = l?.servi;
  if (s != null && s !== "" && Number.isFinite(Number(s))) return Math.max(0, Number(s));
  return Math.max(0, Number(l?.qty ?? l?.quantite ?? l?.commande) || 0);
};
// lignes avec un CIP seulement (une ligne hors catalogue sans CIP n'a rien à coller) ; CIP en texte, « – » = aucun.
// Un même CIP sur deux lignes (ligne normale + ligne « péremption courte » à part dans le panier, deux lignes Odoo d'une même
// commande) : une seule ligne, quantités additionnées, à la place de la première — un logiciel d'officine ou un tableur
// refuserait le doublon ou l'importerait deux fois (docs/cip-copie.md, « Limites »)
export const lignesCip = (lignes) => {
  const parCip = new Map();
  for (const l of Array.isArray(lignes) ? lignes : []) {
    if (!l?.cip || l.cip === "–") continue;
    const cip = String(l.cip).trim(), qty = quantiteLigne(l);
    if (parCip.has(cip)) parCip.get(cip).qty += qty; else parCip.set(cip, { cip, qty });
  }
  return [...parCip.values()];
};
export const FORMATS_CIP = [
  { id: "lignes", libelle: "Un CIP par ligne", exemple: "3400…", rendu: (l) => l.cip },
  { id: "pv", libelle: "CIP ; quantité", exemple: "3400…;6", rendu: (l) => `${l.cip};${l.qty}` },
  { id: "tab", libelle: "CIP, tabulation, quantité", exemple: "3400… ⇥ 6", rendu: (l) => `${l.cip}\t${l.qty}` },
];
export const formatCip = (id) => FORMATS_CIP.find((f) => f.id === id) || FORMATS_CIP[0];
// texte à coller, une ligne par CIP (format inconnu : un CIP par ligne)
export const texteCips = (lignes, id) => lignesCip(lignes).map(formatCip(id).rendu).join("\n");

// Dernier format choisi, gardé sur l'appareil (clé déclarée dans scripts/verifie-zones.mjs, CLES_AUTORISEES.cipCopie) ;
// stockage absent ou refusé (navigation privée) : aucun format mémorisé, le menu s'ouvre à chaque fois
const CLE_FORMAT = "cip_copie_format";
export function formatMemorise() {
  try { const v = localStorage.getItem(CLE_FORMAT); return FORMATS_CIP.some((f) => f.id === v) ? v : null; } catch { return null; }
}
export function memoriserFormat(id) {
  try { if (FORMATS_CIP.some((f) => f.id === id)) localStorage.setItem(CLE_FORMAT, id); } catch { /* non mémorisé */ }
}
