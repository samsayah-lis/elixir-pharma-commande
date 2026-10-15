// ── Refonte charte : icônes au trait (docs/refonte-charte.md § 1.5) ──
// SVG 24 × 24, trait de 2 px arrondi, couleur du texte (currentColor), comme les icônes de la vitrine
// (site/digital.html). Décoratives par défaut (aria-hidden) : le bouton qui les porte garde son aria-label ;
// avec « titre », l'icône est lue (role="img").
// <Icone nom="panier" />  ·  <Icone nom="favori" plein taille={16} />  ·  <CroixElixir taille={28} />

const TRACES = {
  recherche: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  panier: <><path d="M3 4h2l2.2 11h10.6L20 7.5H6.2" /><circle cx="9" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></>,
  favori: <path d="M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.9z" />,
  imprimer: <><path d="M7 9V4h10v5" /><rect x="3.5" y="9" width="17" height="7.5" rx="2" /><path d="M7 14h10v6H7z" /></>,
  commandes: <><path d="M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="3" rx="1" /><path d="M9 11h6M9 15h4" /></>,
  deconnexion: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="m15 8 4 4-4 4" /><path d="M19 12H9" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  fermer: <path d="M6 6l12 12M18 6 6 18" />,
  actualiser: <><path d="M19.5 10A8 8 0 0 0 5.6 7.2L4 9" /><path d="M4 4.5V9h4.5" /><path d="M4.5 14a8 8 0 0 0 13.9 2.8L20 15" /><path d="M20 19.5V15h-4.5" /></>,
  alerte: <><path d="M10.3 4.6 2.7 17.8a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z" /><path d="M12 10v4" /><path d="M12 17.4h.01" /></>,
  coche: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cadenas: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  camion: <><path d="M14 16.5V6H3v10.5h2" /><path d="M14 9h4l3 3.5v4h-1.5" /><path d="M9 16.5h6" /><circle cx="7" cy="17" r="2" /><circle cx="17.5" cy="17" r="2" /></>,
  document: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></>,
  cadeau: <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7" /><path d="M12 8v12.5" /><path d="M12 8S10.5 3.6 8 4.3C6 4.9 6.6 8 9 8" /><path d="M12 8s1.5-4.4 4-3.7c2 .6 1.4 3.7-1 3.7" /></>,
  cible: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  lien: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  copier: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  horloge: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  cloche: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></>,   // alerte de retour en stock (lot 5)
  plus: <path d="M12 5v14M5 12h14" />,
  moins: <path d="M5 12h14" />,
  // ── rayons (barre latérale ; lot 2) ──
  gelule: <><path d="M10.6 19.9a4.9 4.9 0 0 1-6.9-6.9l6.4-6.4a4.9 4.9 0 0 1 6.9 6.9z" /><path d="m7.4 9.8 6.8 6.8" /></>,
  carton: <><path d="M3.5 7.5 12 3.2l8.5 4.3v9L12 20.8l-8.5-4.3z" /><path d="M3.5 7.5 12 11.8l8.5-4.3" /><path d="M12 11.8v9" /></>,
  feuille: <><path d="M19.5 4.5C11 4.5 4.5 8.6 4.5 15.2c0 1.6.3 3 .8 4 1 .5 2.4.8 4 .8 6.6 0 10.2-6.5 10.2-15.5z" /><path d="M5 19.5c2.6-4.6 6-8 10-10" /></>,
  balance: <><path d="M12 4v16M8 20h8M5 7h14" /><path d="M2.5 13.5 5 7l2.5 6.5M16.5 13.5 19 7l2.5 6.5" /><path d="M2.5 13.5a2.5 2.5 0 0 0 5 0zM16.5 13.5a2.5 2.5 0 0 0 5 0z" /></>,
  flacon: <><path d="M8.5 3.5h7V8h-7z" /><rect x="6" y="8" width="12" height="13" rx="2.5" /><path d="M9.5 14.5h5M12 12v5" /></>,
  pansement: <><rect x="1.8" y="8" width="20.4" height="8" rx="4" transform="rotate(-45 12 12)" /><path d="M10.6 10.6h.01M13.4 13.4h.01M10.6 13.4h.01M13.4 10.6h.01" /></>,
  etiquette: <><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a2 2 0 0 1 1.4.6l7.3 7.3a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0l-7.4-7.2a2 2 0 0 1-.6-1.4z" /><circle cx="8" cy="8" r="1.3" /></>,
  tube: <><path d="M8 3.5h8" /><path d="M14.5 3.5V17a2.5 2.5 0 0 1-5 0V3.5" /><path d="M9.5 11.5h5" /></>,
  sac: <><path d="M5 8h14l-1.1 12.5H6.1z" /><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" /></>,
  groupe: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" /><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4" /><path d="M18 14.4c1.8.7 3 2.6 3 5.6" /></>,
  crayon: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  fauteuil: <><circle cx="9" cy="4" r="1.6" /><path d="M9 7.5V13h6l2.5 6" /><path d="M9 10.5h5" /><path d="M6 10.6a5.5 5.5 0 1 0 8 6.4" /></>,
  chaise: <><path d="M7 3.5V13h10v6" /><path d="M7 13v6M7 8.5h7" /><circle cx="7" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></>,
};
export const NOMS_ICONES = Object.keys(TRACES);

// Rayons connus → icône (barre latérale). Une icône saisie dans l'admin (dc.icons, campagne) prime : elle reste
// affichée telle quelle (décision de la cliente, docs/refonte-charte.md § 6).
export const ICONES_RAYON = {
  expert: "gelule", stratege: "carton", master: "feuille", obeso: "balance", nr: "flacon", molnlycke: "pansement",
  blanche: "etiquette", covid: "tube", otc: "sac", ulabs: "groupe", saisie: "crayon", peremption: "horloge",
  fauteuil: "fauteuil", transfert: "chaise", justificatif: "document", groupees: "groupe",
};

export function Icone({ nom, taille = 20, epaisseur = 2, plein = false, titre, style, ...reste }) {
  const trace = TRACES[nom];
  if (!trace) return null;
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} fill={plein ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round" focusable="false"
      aria-hidden={titre ? undefined : true} role={titre ? "img" : undefined} aria-label={titre || undefined}
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "-0.125em", ...style }} {...reste}>
      {trace}
    </svg>
  );
}

// ── Croix Elixir (motif de marque, tracé de site/public/favicon.svg ; viewBox 505 28 951 951, le trait
// déborde de quelques unités à gauche : overflow visible) ──
// En-tête pétrole : couleur var(--or-clair) ; jamais d'or sur fond clair (sarcelle --teal à la place).
export const CROIX_ELIXIR = "M1155.5 220V148A84.5 84.5 0 0 0 1071 63.5H890.5A84.5 84.5 0 0 0 806 148V244.5A84.5 84.5 0 0 1 721.5 329H625.5A84.5 84.5 0 0 0 541 413.5V594.5A84.5 84.5 0 0 0 625.5 679H896.5A84.5 84.5 0 0 0 981 594.5V413.5A84.5 84.5 0 0 1 1065.5 329H1336.5A84.5 84.5 0 0 1 1421 413.5V594.5A84.5 84.5 0 0 1 1336.5 679H1240.5A84.5 84.5 0 0 0 1156 763.5V859.5A84.5 84.5 0 0 1 1071.5 944H890.5A84.5 84.5 0 0 1 806 859.5V787";

export function CroixElixir({ taille = 28, epaisseur = 80, titre, style, ...reste }) {
  return (
    <svg viewBox="505 28 951 951" width={taille} height={taille} fill="none" stroke="currentColor" strokeWidth={epaisseur}
      focusable="false" aria-hidden={titre ? undefined : true} role={titre ? "img" : undefined} aria-label={titre || undefined}
      style={{ display: "block", flexShrink: 0, overflow: "visible", ...style }} {...reste}>
      <path d={CROIX_ELIXIR} />
    </svg>
  );
}
