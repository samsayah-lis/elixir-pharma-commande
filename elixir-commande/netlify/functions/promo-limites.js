// ── Limites de quantité des menus promo et des précommandes (26/10/2026, docs/limites-promo.md) ──
// POST + jeton, lecture seule :
//  • pharmacie : {} → { limites: { <CIP>: { reste, motif, deja, parPharmacie } } } — ce qu'elle peut encore commander (compte de
//    l'e-mail VÉRIFIÉ du jeton : CIP de la fiche et adresse ; cip et email du corps ignorés) ; deja : ce qu'elle a déjà commandé ;
//    parPharmacie : le max de la règle qui bloque ;
//  • admin en saisie pour une pharmacie : { cip, email } → idem pour cette pharmacie ;
//  • admin, onglet Promos : { admin: true } → { limites: { <CIP>: { nom, menu, parPharmacie, total, dejaTotal, parMenu } } }
//    (parMenu : déjà commandé selon chaque menu actif où le CIP est limité, clé « <id du menu>:<id du produit> », compté depuis
//    l'ajout du produit à ce menu).
// { frais: true } (site : juste après un envoi ou un refus d'order-save) : commandes relues sans le cache. { sauf: [numéros] } :
// commandes du site pas encore confirmées (réponse perdue : le renvoi du même numéro ne doit pas être bloqué par elles) — les
// seules de la pharmacie, 20 au plus.
// Produits limités des menus actifs seulement ; aucun : { limites: {} } sans autre lecture. Commandes de toutes les pharmacies
// gardées 60 s par instance (max total) ; celles de la pharmacie toujours relues. Sans jeton valide : 401 ; compte sans pharmacie : 403 ; Supabase Auth en panne : 503 ;
// autre panne : 502 (le panier contrôle alors avec les limites seules, order-save avec les chiffres du moment).
import { getCors } from "./cors.js";
import { json, sb, eq, jetonVerifie } from "./_gp.js";
import { reponseIndisponible } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { lireLimites, etatLimites, pharmacie } from "./_promo-limites.js";

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
  const limited = rateLimit(event, 30, 60);
  if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
  try {
    let b = {};
    try { b = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "JSON invalide" }); }
    // identité : jeton vérifié, avant toute lecture
    const user = await jetonVerifie(event);
    if (!user) return json(cors, 401, { error: "reconnexion", message: "Session expirée : reconnectez-vous avec le code reçu par e-mail." });
    if (b.admin === true && !user.isAdmin) return json(cors, 403, { error: "Accès admin requis" });
    let ph = null;
    if (user.isAdmin && b.admin !== true) ph = pharmacie(b.cip, b.email);   // saisie Elixir : pharmacie servie
    else if (!user.isAdmin) {
      const mail = String(user.email || "").trim().toLowerCase();
      const [compte] = mail ? await sb(`elixir_pharmacies?email=${eq(mail)}&select=cip&limit=1`) : [];
      if (!compte) return json(cors, 403, { error: "fiche", message: "Aucune pharmacie n'est rattachée à ce compte." });
      ph = pharmacie(compte.cip, mail);
    }
    const limites = await lireLimites(sb);
    if (!Object.keys(limites).length) return json(cors, 200, { limites: {} });
    const sauf = ph && Array.isArray(b.sauf) ? b.sauf.map(String).filter(x => /^\d{1,20}$/.test(x)).slice(0, 20) : null;
    const etat = await etatLimites({ sb, limites, ph, sauf, cacheMs: b.frais === true ? 0 : 60e3 });
    const out = {};
    for (const [cip, e] of Object.entries(etat)) {
      const l = limites[cip];
      out[cip] = ph ? { reste: e.reste, motif: e.motif, deja: e.deja, parPharmacie: e.parPharmacie }
        : { nom: l.nom, menu: l.menu, parPharmacie: l.parPharmacie, total: l.total, dejaTotal: e.dejaTotal, parMenu: e.parMenu };
    }
    return json(cors, 200, { limites: out });
  } catch (e) {
    if (e?.indisponible) return reponseIndisponible(cors);   // Supabase Auth en panne : jamais 401
    console.error("promo-limites", e);
    return json(cors, 502, { error: e.message || String(e) });
  }
};
