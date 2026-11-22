// Dépendances injectées : aucune navigation ni suppression hors des deux jetons admin.
export function deconnecterAdmin({ localStorage, verifierModifications, confirmer, quitterCommande = () => true, afficherConnexion }) {
  if (!verifierModifications()) return false;
  if (!confirmer("Se déconnecter de l'administration ?")) return false;
  if (!quitterCommande()) return false;
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_refresh_token");
  afficherConnexion();
  return true;
}
