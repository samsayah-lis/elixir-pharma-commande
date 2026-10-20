// ── Elixir Pharma : service worker des notifications (docs/notifications.md) ──
// RÈGLE : aucun gestionnaire « fetch », aucun cache (Cache Storage). Les pages, scripts et données ne passent JAMAIS par ce
// fichier : les pharmacies ne peuvent pas rester bloquées sur une ancienne version du site. Il ne sert qu'à afficher les
// notifications (push), à ouvrir le site au toucher (notificationclick) et à renouveler un abonnement expiré
// (pushsubscriptionchange). Servi « no-cache » (netlify.toml) : une nouvelle version est prise à la visite suivante.
// Enregistré seulement quand une pharmacie active les notifications (ou les a déjà activées).
// Arrêt d'urgence : docs/notifications.md, « En cas de problème ».
"use strict";

const VERSION = "2026-10-20.2";   // changer la valeur suffit à publier une nouvelle version
const ICONE = "/icones/elixir-192.png";
const BADGE = "/icones/badge-96.png";
const TITRE_DEFAUT = "Elixir Pharma";
const TEXTE_DEFAUT = "Nouvelle information dans votre espace Elixir.";

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

// Lien d'une notification : page du site seulement (même origine), sinon l'accueil
function lien(u) {
  const accueil = self.location.origin + "/";
  if (typeof u !== "string" || !u) return accueil;
  try {
    const x = new URL(u, self.location.origin);
    return x.origin === self.location.origin && (x.protocol === "https:" || x.protocol === "http:") ? x.href : accueil;
  } catch (e) {
    return accueil;
  }
}
const texte = (v, defaut, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : defaut);

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  if (!d || typeof d !== "object") d = {};
  // iOS : chaque message DOIT afficher une notification (sinon l'abonnement peut être retiré) → texte générique au besoin
  const options = {
    body: texte(d.corps, TEXTE_DEFAUT, 240),
    icon: ICONE,
    badge: BADGE,
    lang: "fr",
    dir: "ltr",
    timestamp: Number(d.ts) || Date.now(),
    data: { url: lien(d.url), categorie: typeof d.categorie === "string" ? d.categorie : null, id: typeof d.id === "string" ? d.id : null, v: VERSION },
  };
  if (typeof d.tag === "string" && d.tag) { options.tag = d.tag.slice(0, 64); options.renotify = true; }
  event.waitUntil(self.registration.showNotification(texte(d.titre, TITRE_DEFAUT, 80), options));
});

// Toucher une notification : fenêtre du site au premier plan (ou visible) de préférence, jamais rechargée sans raison :
//  • test (pharmacie ou admin) : la fenêtre est seulement mise au premier plan (saisies en cours gardées) ;
//  • aperçu d'une annonce, ou fenêtre ouverte sur l'admin (#admin) : le lien s'ouvre dans une NOUVELLE fenêtre (l'annonce en
//    cours de rédaction n'est jamais perdue) ;
//  • fenêtre déjà sur la bonne adresse : premier plan seulement ;
//  • sinon : premier plan puis navigation ; navigation impossible (Safari) → message à la page ; aucune fenêtre → nouvelle.
const surAdmin = (c) => { try { return /^#admin/.test(new URL(c.url).hash); } catch (e) { return false; } };
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = lien(data.url);
  const etiquette = String(event.notification.tag || "");
  event.waitUntil((async () => {
    const fenetres = (await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .filter((c) => { try { return new URL(c.url).origin === self.location.origin; } catch (e) { return false; } });
    const fen = fenetres.find((c) => c.focused) || fenetres.find((c) => c.visibilityState === "visible") || fenetres[0];
    if (!fen) return self.clients.openWindow(url);
    const auPremierPlan = async () => { try { await fen.focus(); } catch (e) { /* fenêtre déjà au premier plan */ } };
    if (data.categorie === "test" || fen.url === url) return auPremierPlan();
    if (etiquette === "apercu" || surAdmin(fen)) return self.clients.openWindow(url);
    await auPremierPlan();
    if (typeof fen.navigate === "function") {
      try { await fen.navigate(url); return undefined; } catch (e) { /* fenêtre non contrôlée : message à la page */ }
    }
    fen.postMessage({ type: "elixir-notification", url });
    return undefined;
  })());
});

// Abonnement remplacé par le navigateur (expiration, clés du service push changées) : la ligne du serveur suit, prouvée par
// l'ancien abonnement (endpoint + secret auth, connus du navigateur et du serveur seulement). Sans ancien abonnement :
// rien (le panneau « Notifications » proposera « Réactiver »).
self.addEventListener("pushsubscriptionchange", (event) => { event.waitUntil(renouveler(event)); });

async function renouveler(event) {
  try {
    const ancien = event.oldSubscription ? event.oldSubscription.toJSON() : null;
    if (!ancien || !ancien.endpoint || !ancien.keys || !ancien.keys.auth) return;
    let nouveau = event.newSubscription || null;
    if (!nouveau) {
      const conf = await fetch("/.netlify/functions/push-abonnement", { credentials: "omit", cache: "no-store" }).then((r) => r.json());
      if (!conf || !conf.disponible || !conf.cle_publique) return;
      nouveau = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBinaire(conf.cle_publique) });
    }
    await fetch("/.netlify/functions/push-abonnement", {
      method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "renouveler", ancien: { endpoint: ancien.endpoint, auth: ancien.keys.auth }, abonnement: nouveau.toJSON() }),
    });
  } catch (e) { /* réseau, service indisponible : « Réactiver » au prochain passage dans le panneau */ }
}

// clé publique VAPID (base64url) → octets
function cleBinaire(b64u) {
  const b64 = (b64u + "===".slice((b64u.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const brut = self.atob(b64);
  const out = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) out[i] = brut.charCodeAt(i);
  return out;
}
