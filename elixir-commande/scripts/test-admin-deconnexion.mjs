import assert from "node:assert/strict";
import { deconnecterAdmin } from "../src/admin-session.js";

let ok = 0;
// Valeurs inventées ; le panier pharmacie et la configuration ne doivent jamais être effacés.
const initial = { admin_token: "jeton-fictif", admin_refresh_token: "renouvellement-fictif",
  pharmacy_token: "pharmacie-fictive", admin_tab: "sync", admin_config: "configuration-fictive",
  cart: '{"produit-fictif":2}', session_email: "pharmacie@exemple.test" };
for (const refus of ["modifications", "confirmation", "commande", null]) {
  const valeurs = new Map(Object.entries(initial)), appels = [];
  const resultat = deconnecterAdmin({
    localStorage: { removeItem: cle => { appels.push(cle); valeurs.delete(cle); } },
    verifierModifications: () => { appels.push("modifications"); return refus !== "modifications"; },
    confirmer: message => { assert.equal(message, "Se déconnecter de l'administration ?"); appels.push("confirmation"); return refus !== "confirmation"; },
    quitterCommande: () => { appels.push("commande"); return refus !== "commande"; },
    afficherConnexion: () => appels.push("connexion"),
  });
  assert.equal(resultat, refus === null);
  if (refus) {
    assert.deepEqual(Object.fromEntries(valeurs), initial);
    assert.deepEqual(appels, ["modifications", "confirmation", "commande"].slice(0, ["modifications", "confirmation", "commande"].indexOf(refus) + 1));
  } else {
    assert.deepEqual(appels, ["modifications", "confirmation", "commande", "admin_token", "admin_refresh_token", "connexion"]);
    assert.deepEqual(Object.fromEntries(valeurs), Object.fromEntries(Object.entries(initial).filter(([cle]) => !["admin_token", "admin_refresh_token"].includes(cle))));
  }
  ok++;
}
// Hors mode de commande, aucune sortie ni manipulation de panier n’est nécessaire.
assert.equal(deconnecterAdmin({ localStorage: { removeItem: () => {} }, verifierModifications: () => true,
  confirmer: () => true, afficherConnexion: () => {} }), true);
console.log(`Déconnexion admin : ${ok + 1} tests réussis`);
