// ── Assistant Elixir : règles CSS du panneau (docs/assistant-conception.md § 1.2 et § 1.7) ──
// Posées par le panneau lui-même (<style>), donc chargées avec lui, hors du bundle des pharmacies : gabarit selon la
// largeur, survols, zone de sécurité de l'iPhone, impression. Le reste du dessin est en style inline (src/theme.js).
// Pile des z-index : 301, le niveau du panier (src/styles/tokens.css) ; les deux tiroirs sont exclusifs.
export const CSS = `
.ex-assistant { position: fixed; top: 0; right: 0; bottom: 0; z-index: 301; width: 420px; max-width: 100vw; display: flex;
  flex-direction: column; background: var(--paper); color: var(--ink); border-left: 1px solid var(--line); box-shadow: var(--shadow-3);
  font-size: 14px; line-height: 1.5; }
@media (max-width: 1023px) { .ex-assistant { width: 400px; } }
@media (max-width: 767px) {
  .ex-assistant { left: 0; width: 100%; bottom: auto; height: 100vh; height: 100dvh; border-left: 0; box-shadow: none; }
}
@media print { .ex-assistant { display: none !important; } }

.ex-assistant__entete { flex-shrink: 0; display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 10px 12px 10px 18px;
  background: var(--petrol); color: var(--paper); }
@media (max-width: 767px) { .ex-assistant__entete { min-height: 56px; padding: max(6px, env(safe-area-inset-top)) 6px 6px; gap: 6px; } }
.ex-assistant__rond { width: 36px; height: 36px; padding: 0; border: none; border-radius: 999px; color: var(--paper); cursor: pointer;
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent;
  transition: background-color .15s var(--ease); }
.ex-assistant__rond:hover:not(:disabled) { background: var(--petrol-field); }
.ex-assistant__rond:disabled { opacity: .45; cursor: default; }
@media (max-width: 767px) { .ex-assistant__rond { width: 44px; height: 44px; } }

.ex-assistant__fil { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  position: relative; padding: 16px 16px 8px; background: var(--paper); }
.ex-assistant__msg { display: flex; flex-direction: column; margin-bottom: 14px; }
.ex-assistant__msg--pharmacie { align-items: flex-end; }
.ex-assistant__msg--assistant { align-items: stretch; }
.ex-assistant__bulle { max-width: 88%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums; }
.ex-assistant__msg--pharmacie .ex-assistant__bulle { background: var(--petrol); color: var(--paper); border-bottom-right-radius: 4px; }
.ex-assistant__msg--assistant .ex-assistant__bulle { align-self: flex-start; background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-bottom-left-radius: 4px; }
.ex-assistant__heure { font-size: 11px; color: var(--ink-mute); margin-top: 3px; padding: 0 4px; }

.ex-assistant__carte { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow-1);
  padding: 14px 16px; margin-top: 8px; font-size: 13px; line-height: 1.45; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ex-assistant__carte summary { cursor: pointer; font-weight: 600; color: var(--teal); padding: 6px 0; min-height: 32px; }
/* cibles de 44 px sous 768 px (conception § 1.7) : volets repliables des cartes (le marqueur ▸ est gardé), « Vos données » */
@media (max-width: 767px) {
  .ex-assistant__carte summary { min-height: 44px; box-sizing: border-box; padding: 12px 0; }
  .ex-assistant__lien { min-height: 44px; }
}
.ex-app .ex-assistant table.ex-assistant__table { width: 100%; border-collapse: collapse; font-size: 12px !important; }
.ex-app .ex-assistant .ex-assistant__table th, .ex-app .ex-assistant .ex-assistant__table td { padding: 5px 4px !important; text-align: right;
  border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.ex-app .ex-assistant .ex-assistant__table th { font-size: 11px; font-weight: 700; color: var(--ink-mute); letter-spacing: .04em; text-transform: uppercase;
  white-space: nowrap; overflow-wrap: normal; }
/* colonnes de chiffres : jamais coupées (la carte coupe les mots longs, overflow-wrap: anywhere) ; le produit prend le reste */
.ex-app .ex-assistant .ex-assistant__table td.num { white-space: nowrap; overflow-wrap: normal; }
.ex-app .ex-assistant .ex-assistant__table th:first-child, .ex-app .ex-assistant .ex-assistant__table td:first-child { text-align: left; }

.ex-assistant__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.ex-assistant__btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 16px;
  border: none; border-radius: 999px; font-size: 13px; font-weight: 700; font-family: inherit; line-height: 1.2; cursor: pointer;
  text-decoration: none; }
.ex-assistant__btn.ex-btn-ligne { color: var(--petrol); box-shadow: inset 0 0 0 1.5px var(--line-field); }
.ex-assistant__btn:disabled { opacity: .55; cursor: default; }
.ex-assistant__btn--fort { min-height: 48px; font-size: 14px; padding: 0 22px; }
@media (max-width: 767px) {
  .ex-assistant__actions { flex-direction: column; align-items: stretch; }
  .ex-assistant__actions > .ex-assistant__btn { width: 100%; min-height: 48px; }
}

.ex-assistant__choix { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 8px 12px; margin-top: 6px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); font: inherit; font-size: 13px; text-align: left;
  cursor: pointer; transition: background-color .15s var(--ease), border-color .15s var(--ease); }
.ex-assistant__choix:disabled { cursor: default; opacity: .6; }
@media (hover: hover) { .ex-assistant__choix:hover:not(:disabled) { background: var(--surface-2); border-color: var(--teal-2); } }

.ex-assistant__pastilles { display: flex; flex-wrap: wrap; gap: 8px; }
.ex-assistant__pastilles > button { min-height: 36px; }
@media (max-width: 767px) {
  .ex-assistant__pastilles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ex-assistant__pastilles > button { min-height: 44px; height: auto !important; white-space: normal !important; text-align: left;
    justify-content: flex-start !important; line-height: 1.25 !important; padding: 8px 12px !important; }
}

.ex-assistant__saisie { flex-shrink: 0; border-top: 1px solid var(--line); background: var(--surface); padding: 10px 12px;
  padding-bottom: max(10px, env(safe-area-inset-bottom)); }
.ex-assistant[data-clavier] .ex-assistant__saisie { padding-bottom: 10px; }
.ex-assistant__zone { flex: 1; min-width: 0; resize: none; border: 1px solid var(--line-field); border-radius: 20px; padding: 9px 14px;
  font: inherit; font-size: 14px; line-height: 1.4; color: var(--ink); background: var(--surface); max-height: 132px; overflow-y: auto; }
.ex-assistant__zone[readonly] { background: var(--surface-2); color: var(--ink-soft); }
.ex-assistant__envoyer { width: 40px; height: 40px; flex-shrink: 0; border: none; border-radius: 999px; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; }
.ex-assistant__envoyer:disabled { background: var(--sand); color: var(--ink-mute); cursor: default; }
@media (max-width: 767px) { .ex-assistant__envoyer { width: 44px; height: 44px; } }
`;
