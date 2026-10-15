import './styles/tokens.css'   // jetons de la charte, Inter locale, focus, règles globales (en premier)
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { Icone, CroixElixir } from './icons.jsx'

// Erreur de rendu à la racine (refonte charte, lot 8 : docs/refonte-charte.md § 3) : message en français et
// « Recharger la page » ; le détail technique (message, pile, composant) va dans la console, plus à l'écran.
// Dessin autonome (jetons de tokens.css, déjà chargés) : rien ici ne dépend de l'App qui vient d'échouer.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(error, info) { console.error("[Erreur de rendu]", error, info?.componentStack || ""); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "var(--cream)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 12px", boxSizing: "border-box" }}>
          <div role="alert" style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 28, boxShadow: "var(--shadow-2)",
            padding: "36px 28px", maxWidth: 460, width: "100%", textAlign: "center", color: "var(--ink)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--teal)", marginBottom: 24 }}>
              <CroixElixir taille={24} />
              <span style={{ fontWeight: 600, letterSpacing: "0.28em", fontSize: 14, color: "var(--petrol)" }}>ELIXIR</span>
            </div>
            <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 999, background: "var(--danger-bg)", color: "var(--danger)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><Icone nom="alerte" taille={26} /></span>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--petrol)" }}>Une erreur est survenue</h1>
            <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.5, color: "var(--ink-soft)" }}>
              La page n’a pas pu s’afficher. Rechargez-la pour reprendre votre commande.
            </p>
            <button type="button" className="ex-btn-petrole" onClick={() => window.location.reload()} style={{ marginTop: 22, height: 48, padding: "0 26px",
              border: "none", borderRadius: 999, fontSize: 15, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icone nom="actualiser" taille={18} />Recharger la page
            </button>
            <p style={{ margin: "24px 0 0", paddingTop: 16, borderTop: "1px solid var(--line-soft)", fontSize: 12, lineHeight: 1.5, color: "var(--ink-mute)" }}>
              Si le problème persiste : Elixir Pharma · pharmacien@elixirpharma.fr · <span style={{ whiteSpace: "nowrap" }}>01 86 04 39 95</span>
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const demarre = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

// Aperçus Netlify (netlify.toml, contextes deploy-preview / branch-deploy) : mode « essai à blanc »,
// aucun envoi réel. Condition fausse dans le build de production : le module n'y est pas inclus.
// Si le garde-fou ne s'installe pas, l'aperçu ne démarre pas (sinon une commande partirait vraiment).
if (import.meta.env.VITE_ESSAI_A_BLANC === "1") {
  import('./dev/essai-a-blanc.js')
    .then((m) => { m.installe(); demarre(); })
    .catch((e) => {
      console.error("[essai à blanc]", e);
      document.getElementById('root').textContent = "Aperçu indisponible : le mode essai à blanc n'a pas pu s'installer. Rechargez la page.";
    });
} else {
  demarre();
}
