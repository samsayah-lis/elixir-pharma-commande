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
  plus: <path d="M12 5v14M5 12h14" />,
  moins: <path d="M5 12h14" />,
};
export const NOMS_ICONES = Object.keys(TRACES);

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
