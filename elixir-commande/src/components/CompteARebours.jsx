import { useState, useEffect } from "react";

// Compte à rebours de la commande groupée U-Labs (fermeture dimanche 23:59:59).
// Composant à part : seul ce texte se redessine chaque seconde, plus toute l'application
// (avant, l'état vivait dans App et redessinait OTC et ses 675 cartes chaque seconde).
// Renvoie le texte seul : la mise en forme reste chez l'appelant.
const resteAvantFermeture = () => {
  // Fin dimanche 23:59:59
  const now = new Date();
  const end = new Date(now);
  const day = now.getDay(); // 0=dim
  const daysUntilSun = day === 0 ? 7 : 7 - day;
  end.setDate(now.getDate() + daysUntilSun);
  end.setHours(23, 59, 59, 0);
  const diff = end - now;
  if (diff <= 0) return "Terminé";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${d}j ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
};

export default function CompteARebours() {
  // valeur calculée dès le premier rendu : pas d'instant vide à l'ouverture de l'onglet
  const [countdown, setCountdown] = useState(resteAvantFermeture);
  useEffect(() => {
    const tick = () => setCountdown(resteAvantFermeture());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return countdown;
}
