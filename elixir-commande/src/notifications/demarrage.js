// ── Notifications de l'appli Elixir : démarrage, une fois par identité (docs/notifications.md) ──
// Chargé à la demande par App (entree.jsx) dès qu'une pharmacie est connectée. Ne demande rien à l'utilisateur.
//  1. configuration publique (GET, gardée 60 s) : clés absentes ou tables non créées → rien n'est affiché ;
//  2. saisie « Commander pour une pharmacie » : entrée du menu seulement (panneau en lecture seule), aucun abonnement ;
//  3. ouverture « fermée » (admins seulement) → rien ; sinon statut de la pharmacie (jeton) : 401, 403, 503 ou réseau → rien ;
//  4. abonnement local inconnu du serveur (mort, retiré ailleurs) : désinscrit localement, la prochaine activation en prend
//     un nouveau (nettoyerSiInconnu) ;
//  5. carte de l'accueil si cet appareil n'est pas abonné, que le parcours s'y prête, que « Plus tard » date de 30 jours, et
//     que la pharmacie n'est pas déjà joignable sur un téléphone (carteUtile) ;
//  6. appareil déjà autorisé : service worker mis à jour, abonnement renouvelé si les clés VAPID ont changé, messages du
//     service worker écoutés (clic sur une notification quand Safari ne peut pas changer l'adresse de la fenêtre).
// → { visible, carte, parcours, statut, acting }
import { lireConfig, apiPharmacie, abonnementLocal, navigateur, installerNavigateur, memeCle, renouvelerCle, ecouterNavigation, nettoyerSiInconnu } from "./client.js";
import { parcours, PARCOURS_CARTE, carteUtile } from "./plateforme.js";
import { masquee } from "./memo.js";

// Banc d'essai local (npm run dev) : clé « BANC-FICTIVE » → navigateur simulé (?banc_push=<scénario>), aucun vrai abonnement.
// Condition fausse dans le build de production : le module banc.js n'y est pas inclus.
async function banc() {
  if (!import.meta.env.DEV) return;
  const conf = await lireConfig();
  if (conf.cle_publique !== "BANC-FICTIVE") return;
  const { navigateurBanc } = await import("./banc.js");
  installerNavigateur(navigateurBanc(new URLSearchParams(window.location.search).get("banc_push") || "auto"));
}

export async function demarrer({ appel, identite, acting = false } = {}) {
  try {
    await banc();
    const conf = await lireConfig();
    if (!conf.disponible) return { visible: false };
    if (acting) return { visible: true, acting: true, carte: false };
    if (conf.ouverture === "fermee") return { visible: false };
    const n = navigateur();
    const local = await abonnementLocal();
    const reg = local.reg;
    let r;
    try { r = await apiPharmacie(appel).appeler("statut", local.sub ? { endpoint: local.sub.endpoint } : {}); } catch { return { visible: false }; }
    if (r.statut !== 200 || !r.corps?.disponible) return { visible: false };
    const statut = r.corps;
    const { sub } = await nettoyerSiInconnu({ sub: local.sub, statut });
    const p = parcours(n.env(), !!statut.appareil);
    const carte = !statut.appareil && PARCOURS_CARTE.includes(p) && !masquee(identite) && carteUtile(p, n.env(), statut);
    if (reg && n.permission() === "granted") {
      try { reg.update?.()?.catch?.(() => {}); } catch { /* mise à jour au prochain passage */ }
      if (sub && statut.cle_publique && !memeCle(sub, statut.cle_publique)) renouvelerCle({ sub, reg, cle: statut.cle_publique }).catch(() => {});
      ecouterNavigation();
    }
    return { visible: true, carte, parcours: p, statut };
  } catch {
    return { visible: false };
  }
}
