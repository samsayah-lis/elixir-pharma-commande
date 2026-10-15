// ── Réponses fictives aux appels qui écrivent (POST, PUT, DELETE…) vers /.netlify/functions/ ──
// Partagé par le mode « essai à blanc » des aperçus Netlify (src/dev/essai-a-blanc.js, chargé à la
// demande, jamais dans le build de production) et par le banc local (scripts/banc/plugin.mjs).
// Rien n'est envoyé ni enregistré : la réponse imite celle du serveur juste assez pour que l'écran
// suive son cours normal (succès). JS pur, sans dépendance.

export const PHARMACIE_FICTIVE = { name: "PHARMACIE D'ESSAI", cip: "", email: "" };

// fn : nom de la fonction Netlify ; corps : données envoyées (objet JSON ou texte) ;
// pharmacie : identité renvoyée à l'identification ; admin : connexion admin acceptée (banc) ou non (aperçu)
export function reponseFictive({ fn, methode = "POST", corps = null, pharmacie = PHARMACIE_FICTIVE, admin = false }) {
  const b = corps && typeof corps === "object" ? corps : {};
  const email = String(b.email || pharmacie.email || "").trim().toLowerCase();
  const ph = { ...pharmacie, email };
  // une adresse contenant « inconnu » essaie le parcours « pharmacie inconnue » (formulaire de demande d'accès)
  const inconnu = /inconnu/.test(email);
  if (methode === "DELETE") return { success: true };
  switch (fn) {
    // identification de la pharmacie (mode historique, puis mode code à 6 chiffres)
    case "pharmacy-lookup":     return inconnu ? { found: false } : { found: true, pharmacy: ph };
    case "pharmacy-otp-send":   return inconnu ? { success: false, unknown: true } : { success: true };
    case "pharmacy-otp-verify": return String(b.token) === "000000"   // code « 000000 » : essai du message d'erreur
      ? { success: false, error: "Code invalide ou expiré." }
      : { success: true, token: "essai-jeton", refresh_token: "essai-renouvellement", pharmacy: ph };
    case "admin-refresh":       return { success: true, token: "essai-jeton", refresh_token: "essai-renouvellement" };
    case "admin-login":         return admin
      ? { success: true, token: "essai-jeton-admin", refresh_token: "essai-renouvellement-admin" }
      : { success: false, error: "Aperçu : l'administration est désactivée ici (rien ne doit y être modifié)." };
    // lectures faites en POST : réponses neutres
    case "quota-status":        return { exempt: false, products: {} };
    case "gp-pharmacy":         return b.action === "access" ? { allowed: true } : b.action === "list" ? { operations: [] } : { success: true };
    // envoi d'une commande : e-mail, enregistrement, relais PharmaML
    case "send-email":          return { success: true };
    case "order-save":          return { success: true, id: b.id ?? Date.now() };
    case "submit-order":        return { queued: false, error: "essai à blanc : rien n'est transmis à PharmaML" };
    case "search-track":        return { ok: true };
    case "lab-justif":
      if (b.action === "rx_upload")   return { id: `essai-${Date.now()}`, name: b.name || "ordonnance" };
      if (b.action === "commander")   return { order_id: b.order_id, demandes: [] };
      if (b.action === "submit")      return { demandes: [] };
      if (b.action === "mes_demandes") return { demandes: [] };
      return { success: true };
    default:                    return { success: true, ok: true };
  }
}
