import './styles/tokens.css'   // jetons de la charte, Inter locale, focus, règles globales (en premier)
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:40,fontFamily:"monospace",background:"#fff0f0",minHeight:"100vh"}}>
          <h2 style={{color:"#c00"}}>Erreur de rendu</h2>
          <pre style={{whiteSpace:"pre-wrap",fontSize:13}}>{this.state.error?.message}\n\n{this.state.error?.stack}</pre>
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
