// ── Refonte charte : jetons et atomes de style pour les objets style inline (docs/refonte-charte.md § 2.3) ──
// JS pur, sans dépendance. Les couleurs renvoient aux variables CSS de src/styles/tokens.css : T.ink s'écrit
// tel quel dans un style inline. Rien d'ici ne doit être importé par src/gp-pricing.js (importé par les
// fonctions Netlify, qui doit rester du JS pur).

// ── Jetons ──
export const T = {
  // fonds
  cream: "var(--cream)", paper: "var(--paper)", surface: "var(--surface)", surface2: "var(--surface-2)", sand: "var(--sand)",
  // textes
  ink: "var(--ink)", inkSoft: "var(--ink-soft)", inkMute: "var(--ink-mute)", inkFaint: "var(--ink-faint)",
  // marque
  teal: "var(--teal)", teal2: "var(--teal-2)", petrol: "var(--petrol)", petrolField: "var(--petrol-field)", deep: "var(--deep)",
  paperMute: "var(--paper-mute)",   // texte secondaire sur pétrole
  mint: "var(--mint)", mint2: "var(--mint-2)", or: "var(--or)", orClair: "var(--or-clair)",
  // filets
  line: "var(--line)", lineSoft: "var(--line-soft)", lineField: "var(--line-field)",
  // statuts
  ok: "var(--ok)", okBg: "var(--ok-bg)", danger: "var(--danger)", dangerBg: "var(--danger-bg)",
  warn: "var(--warn)", warnBg: "var(--warn-bg)", tierBg: "var(--tier-bg)", acting: "var(--orange-acting)",
  // effets
  scrim: "var(--scrim)", shadow1: "var(--shadow-1)", shadow2: "var(--shadow-2)", shadow3: "var(--shadow-3)",
  sans: "var(--sans)", mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', ease: "var(--ease)",
};
// Rayons (px) : 6 champ de quantité de tableau · 10 champs · 16 cartes, panier · 28 fenêtres, identification · 999 pastilles
export const R = { xs: 6, s: 10, m: 16, l: 28, pill: 999 };

// ── Couleurs saisies dans l'admin ──
// alpha("#2d7d9a", .14) → "rgba(45,125,154,0.14)" : remplace les concaténations « couleur + suffixe alpha »
// (cat.accent + "18", `${accent}08`…). Hex à 3 ou 6 chiffres seulement ; toute autre valeur est rendue telle
// quelle. Jamais sur un jeton T.x (une variable CSS ne se décompose pas).
export function alpha(couleur, a) {
  if (typeof couleur !== "string") return couleur;
  const m = couleur.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return couleur;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Tons de statut : { bg, fg, border } ──
// Toujours accompagnés d'un libellé ou d'une icône (jamais la couleur seule). Contrastes texte/fond ≥ 4,5:1.
const TONS = {
  neutral: { bg: T.surface2, fg: T.inkSoft, border: T.line },
  ok:      { bg: T.okBg, fg: T.ok, border: "rgba(6,95,70,.28)" },             // 6,16:1
  danger:  { bg: T.dangerBg, fg: T.danger, border: "rgba(185,28,28,.28)" },   // 5,29:1
  warn:    { bg: T.warnBg, fg: T.warn, border: "rgba(146,64,14,.28)" },       // 5,85:1 (palier à viser, note produit, péremption proche)
  info:    { bg: T.mint, fg: T.teal, border: T.mint2 },                       // 6,39:1 (contingentement en cours)
  promo:   { bg: T.or, fg: T.ink, border: T.or },                             // 5,82:1 (or + encre : promos et remises)
  tier:    { bg: T.tierBg, fg: T.ink, border: T.or },                         // palier atteint
  labo:    { bg: "#e4ecee", fg: T.teal, border: T.teal2 },                    // 6,94:1 (justificatif, précommande : sarcelle)
  acting:  { bg: "#fff7ed", fg: T.acting, border: "rgba(154,52,18,.3)" },     // 6,88:1 (« Commander pour une pharmacie »)
};
export const tone = (nom) => TONS[nom] || TONS.neutral;

// ── Atomes de style (remplacent les copies locales card, h2, btn, IS, LS, MO… des composants) ──
// Objets à étaler puis compléter : style={{ ...ui.card, marginBottom: 12 }}. Les z-index restent chez l'appelant.
const HAUTEUR_BTN = { s: 32, m: 36, l: 48 };   // listes : 32-36 px ; actions principales et tactile : 48 px
const BTN = {
  primaire: { background: T.petrol, color: T.paper },                                  // « + », « Ajouter », « + Panier »
  or:       { background: T.or, color: T.ink },                                         // « Envoyer la commande » seulement
  ligne:    { background: "transparent", color: T.ink, boxShadow: `inset 0 0 0 1.5px ${T.line}` },
  doux:     { background: T.sand, color: T.ink },
  danger:   { background: T.danger, color: "#fff" },
  lien:     { background: "none", color: T.danger, padding: 0, height: "auto", textDecoration: "underline", textUnderlineOffset: 3 },
};
export const ui = {
  card: { background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, boxShadow: T.shadow1, padding: "18px 22px" },
  panel: { background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.m, padding: "18px 22px" },
  h2: { fontSize: 13, fontWeight: 700, color: T.petrol, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 12px" },
  label: { fontSize: 12, fontWeight: 600, color: T.inkSoft, display: "block", marginBottom: 6 },
  input: { width: "100%", minHeight: 40, border: `1px solid ${T.lineField}`, borderRadius: R.s, padding: "9px 12px", fontSize: 14,
    background: T.surface, color: T.ink, fontFamily: "inherit", boxSizing: "border-box" },
  btn: (kind = "primaire", size = "m") => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: HAUTEUR_BTN[size] || HAUTEUR_BTN.m,
    padding: `0 ${size === "l" ? 22 : size === "s" ? 12 : 16}px`, border: "none", borderRadius: R.pill,
    fontSize: size === "l" ? 15 : 13, fontWeight: 700, fontFamily: "inherit", lineHeight: 1, whiteSpace: "nowrap", cursor: "pointer",
    transition: "background-color .15s var(--ease), color .15s var(--ease), box-shadow .15s var(--ease)",
    ...(BTN[kind] || BTN.primaire),
  }),
  // filtres : sable + encre inactifs, encre + paper actifs (à poser avec aria-pressed)
  pill: (on) => ({
    display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 14px", border: "none", borderRadius: R.pill,
    fontSize: 13, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer",
    background: on ? T.ink : T.sand, color: on ? T.paper : T.ink,
  }),
  // badge en teinte ; plein = fond de la couleur du ton (rupture : danger + blanc)
  badge: (nom = "neutral", plein = false) => {
    const t = tone(nom);
    const pleinFond = plein && nom !== "promo" && nom !== "tier";
    return {
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: R.pill, fontSize: 11, fontWeight: 700,
      lineHeight: 1.4, letterSpacing: "0.02em", whiteSpace: "nowrap",
      background: pleinFond ? t.fg : t.bg, color: pleinFond ? "#fff" : t.fg,
    };
  },
  th: { padding: "10px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkMute,
    background: T.surface2, textAlign: "left", whiteSpace: "nowrap", borderBottom: `1px solid ${T.line}` },
  td: { padding: "10px 14px", fontSize: 13, color: T.ink, verticalAlign: "middle" },
  // quantité de tableau (bureau : 24 px) — « − » sable, « + » pétrole
  qtyBtn: (kind = "plus") => ({
    width: 24, height: 24, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, fontFamily: "inherit", lineHeight: 1,
    ...(kind === "moins" ? { background: T.sand, color: T.ink } : { background: T.petrol, color: T.paper }),
  }),
  // champ de quantité : filet --line-field, puis 2 px sarcelle dès que la quantité est > 0 (hauteur fixe : pas de saut)
  qtyInput: (active) => ({
    width: 50, height: 28, boxSizing: "border-box", padding: "0 4px", borderRadius: R.xs, textAlign: "center",
    border: active ? `2px solid ${T.teal}` : `1px solid ${T.lineField}`, background: T.surface, color: T.ink,
    fontSize: 13, fontWeight: active ? 700 : 500, fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
  }),
  overlay: { position: "fixed", inset: 0, background: T.scrim, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: T.paper, color: T.ink, borderRadius: R.l, padding: "28px 32px", maxWidth: 480, width: "100%", boxShadow: T.shadow3 },
  // titre de fenêtre (20/640 pétrole), à relier par aria-labelledby
  titreModal: { margin: 0, fontSize: 20, fontWeight: 640, letterSpacing: "-0.02em", lineHeight: 1.2, color: T.petrol, display: "flex", alignItems: "center", gap: 10 },
  // encart de statut (message, avertissement, erreur…) : ton de tone(), texte 13 px ; à compléter d'une icône ou d'un libellé
  encart: (nom = "neutral") => {
    const t = tone(nom);
    return { background: t.bg, color: t.fg, border: `1px solid ${t.border}`, borderRadius: R.s, padding: "10px 14px", fontSize: 13, lineHeight: 1.45 };
  },
  // bouton rond à icône (fermer, masquer, retirer) : fond et survol par la classe ex-btn-discret
  rond: (taille = 36) => ({ width: taille, height: taille, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center" }),
};

// ── Admin (lot 10) : atomes du back-office ──
// Remplacent LS / IS / PB / CB d'AdminPanel et leurs copies (AdminAdd, AdminEdit, AdminCampaigns, AdminGroupPurchases).
// Densité de l'admin conservée : champs en 13 px sans hauteur minimale (les surcharges locales de marge interne et
// de taille restent valables), bouton principal de 13 px de marge interne ; filet --line-field (3,13:1) au lieu de
// #e2e8f0 (1,2:1). Le focus vient de l'anneau global (tokens.css), malgré outline: none.
export const adm = {
  label: { fontSize: 12, fontWeight: 700, color: T.inkSoft, display: "block", marginBottom: 6 },
  input: { width: "100%", border: `1px solid ${T.lineField}`, borderRadius: R.s, padding: "9px 12px", fontSize: 13, outline: "none",
    boxSizing: "border-box", fontFamily: "inherit", background: T.surface, color: T.ink },
  // bouton principal : pétrole à plat (fini le dégradé), en pastille comme les boutons du site
  btn: { width: "100%", background: T.petrol, color: T.paper, border: "none", borderRadius: R.pill, padding: "13px", fontWeight: 700,
    fontSize: 14, cursor: "pointer" },
  // bouton rond « fermer » (fond et survol par la classe ex-btn-discret)
  fermer: { ...ui.rond(32), fontSize: 16 },
};

// ── Formats d'affichage (français) ──
// Affichage seulement : les données envoyées (e-mail, texte copié, relais) gardent leurs toFixed() d'origine.
// Espace fine insécable entre milliers, espace insécable avant € et %, vrai signe moins (−).
const ESP = " ", FINE = " ";
const milliers = (ent) => ent.replace(/\B(?=(\d{3})+(?!\d))/g, FINE);

// fmtEur(1234.5) → "1 234,50 €" ; null, "" ou non numérique → vide ("–" par défaut, comme fmt d'App)
export function fmtEur(n, { vide = "–", decimales = 2 } = {}) {
  if (n == null || n === "") return vide;
  const v = Number(n);
  if (!Number.isFinite(v)) return vide;
  const [ent, dec] = Math.abs(v).toFixed(decimales).split(".");
  const negatif = v < 0 && Number(ent + "." + (dec || 0)) !== 0;
  return `${negatif ? "−" : ""}${milliers(ent)}${dec ? "," + dec : ""}${ESP}€`;
}

// fmtPct(30) ou fmtPct("-30%") → "−30 %" (remise, toujours négative, comme fmtPct d'App) ; 4.5 → "−4,5 %" ;
// 0, vide ou non numérique → vide
export function fmtPct(pct, { vide = "–" } = {}) {
  if (pct == null || pct === "" || pct === "–") return vide;
  const n = Math.abs(parseFloat(String(pct).replace(",", ".").replace(/[^0-9.-]/g, "")));
  if (!Number.isFinite(n) || n === 0) return vide;
  return `−${String(Number(n.toFixed(2))).replace(".", ",")}${ESP}%`;
}
