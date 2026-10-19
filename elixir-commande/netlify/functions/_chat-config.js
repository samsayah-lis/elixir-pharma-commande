// ── Assistant Elixir : réglages et petites aides communes (docs/assistant-contrat.md, « Réglages ») ──
// Réglages : table chat_reglages (une ligne id = 1, JSON en texte, RLS sans policy), lue avec la clé serveur
// par _chat-stock.js. Modifiables depuis l'admin sans redéploiement (chat-admin.js). Les textes affichés
// (délai, téléphone, horaires) vivent ici, jamais en dur dans les messages.
export const REGLAGES_DEFAUT = {
  actif: false,                 // interrupteur général
  ouvert_a_tous: false,         // false = seulement `pilote` (+ admins en mode « pour une pharmacie »)
  pilote: [],                   // odoo_id (nombres)
  modele: "claude-opus-5-5",
  effort: "low",
  budget_jour_eur: 8,
  demandes: "simulation",       // "simulation" | "email" | "entrepot"
  entrepot_url: "",             // URL de l'API chatbot-intake de l'outil entrepôt (vide = non branché)
  email_equipe: "pharmacien@elixirpharma.fr",
  email_qualite: "pharmacien@elixirpharma.fr",
  delai_annonce: "Réponse sous 24 h ouvrées (du lundi au vendredi).",
  telephone: "01 86 04 39 95",
  horaires: "lun-ven 9 h 30-17 h, sam 9 h 30-14 h",
  conservation_jours: 90,
  quotas: { messages_heure: 15, messages_jour: 40, fichiers_jour: 20, retours_jour: 5, transmissions_jour: 3, admin_messages_jour: 60 },
  profondeur: { factures_mois: 24, releve_mois: 12, commandes_mois: 6 },
};

// Modèles acceptés. Haiku 5.5 n'est pas proposé : le contexte serveur (date, pharmacie, événements vérifiés)
// passe par des messages role:"system" en cours de conversation, que la documentation ne donne pas pour Haiku 5.5,
// et Haiku n'a pas de repli serveur en cas de refus.
export const MODELES = ["claude-opus-5-5", "claude-sonnet-5-5"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const MODES_DEMANDES = ["simulation", "email", "entrepot"];
const RE_EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i;
export const emailValide = (e) => RE_EMAIL.test(String(e || ""));

const clone = (v) => JSON.parse(JSON.stringify(v));
const entier = (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v);

// Lecture tolérante : défauts fusionnés, toute valeur illisible remplacée par son défaut
export function fusionnerReglages(v) {
  const d = clone(REGLAGES_DEFAUT);
  const s = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const out = { ...d };
  if (typeof s.actif === "boolean") out.actif = s.actif;
  if (typeof s.ouvert_a_tous === "boolean") out.ouvert_a_tous = s.ouvert_a_tous;
  if (Array.isArray(s.pilote)) out.pilote = [...new Set(s.pilote.map(entier).filter(n => Number.isInteger(n) && n > 0))];
  if (MODELES.includes(s.modele)) out.modele = s.modele;
  if (EFFORTS.includes(s.effort)) out.effort = s.effort;
  const budget = entier(s.budget_jour_eur);
  if (Number.isFinite(budget) && budget >= 0) out.budget_jour_eur = budget;
  if (MODES_DEMANDES.includes(s.demandes)) out.demandes = s.demandes;
  if (typeof s.entrepot_url === "string" && (s.entrepot_url === "" || /^https:\/\/\S+$/i.test(s.entrepot_url.trim()))) out.entrepot_url = s.entrepot_url.trim();
  for (const k of ["email_equipe", "email_qualite"]) if (emailValide(String(s[k] || "").trim())) out[k] = String(s[k]).trim();
  for (const k of ["delai_annonce", "telephone", "horaires"]) if (typeof s[k] === "string" && s[k].trim()) out[k] = s[k].trim().slice(0, 200);
  const cons = entier(s.conservation_jours);
  if (Number.isInteger(cons) && cons >= 1) out.conservation_jours = cons;
  for (const [groupe, min] of [["quotas", 0], ["profondeur", 1]]) {
    const src = s[groupe] && typeof s[groupe] === "object" ? s[groupe] : {};
    for (const k of Object.keys(d[groupe])) { const n = entier(src[k]); if (Number.isInteger(n) && n >= min) out[groupe][k] = n; }
  }
  return out;
}

// Écriture stricte (admin) : { valeur (fusionnée), erreurs: [texte] } ; rien n'est enregistré s'il y a une erreur
export function verifierReglages(v) {
  const erreurs = [];
  if (!v || typeof v !== "object" || Array.isArray(v)) return { valeur: null, erreurs: ["Réglages illisibles."] };
  const valeur = fusionnerReglages(v);
  const pareil = (k) => v[k] === undefined || JSON.stringify(entier(v[k])) === JSON.stringify(valeur[k]);
  if (v.modele !== undefined && !MODELES.includes(v.modele)) erreurs.push(`Modèle non pris en charge : ${MODELES.join(" ou ")}.`);
  if (v.effort !== undefined && !EFFORTS.includes(v.effort)) erreurs.push("Effort inconnu.");
  if (v.demandes !== undefined && !MODES_DEMANDES.includes(v.demandes)) erreurs.push("Destination des demandes inconnue.");
  if (!pareil("budget_jour_eur")) erreurs.push("Budget du jour : montant positif attendu.");
  if (!pareil("conservation_jours")) erreurs.push("Conservation : nombre de jours entier (1 au moins).");
  if (v.entrepot_url !== undefined && String(v.entrepot_url).trim() !== valeur.entrepot_url) erreurs.push("Adresse de l'outil entrepôt : https://… attendu.");
  if (valeur.demandes === "entrepot" && !valeur.entrepot_url) erreurs.push("Mode « Outil entrepôt » : renseignez d'abord l'adresse de son API.");
  for (const k of ["email_equipe", "email_qualite"]) if (v[k] !== undefined && String(v[k]).trim() !== valeur[k]) erreurs.push(`${k === "email_equipe" ? "E-mail de l'équipe" : "E-mail qualité"} invalide.`);
  for (const k of ["delai_annonce", "telephone", "horaires"]) if (v[k] !== undefined && !String(v[k]).trim()) erreurs.push(`« ${k} » : texte vide.`);
  for (const [groupe, min] of [["quotas", 0], ["profondeur", 1]]) {
    for (const k of Object.keys(REGLAGES_DEFAUT[groupe])) {
      const brut = v[groupe]?.[k];
      if (brut !== undefined && !(Number.isInteger(entier(brut)) && entier(brut) >= min)) erreurs.push(`« ${groupe}.${k} » : nombre entier attendu (${min} au moins).`);
    }
  }
  if (v.pilote !== undefined && !Array.isArray(v.pilote)) erreurs.push("Pilote : liste de fiches Odoo attendue.");
  return { valeur, erreurs };
}

// Lecture avec cache de 60 s, propre à chaque stock (les doublures des tests ne se mélangent pas)
const CACHE_MS = 60_000;
const caches = new WeakMap();
export async function lireReglages(deps = {}) {
  const stock = deps.stock;
  if (!stock?.reglages?.lire) throw new Error("lireReglages : stock manquant");
  const maintenant = deps.maintenant || (() => new Date());
  const t = maintenant().getTime();
  const c = caches.get(stock);
  if (c && t - c.lu < CACHE_MS && !deps.sansCache) return c.valeur;
  const { valeur } = await stock.reglages.lire();
  const fusion = fusionnerReglages(valeur);
  caches.set(stock, { valeur: fusion, lu: t });
  return fusion;
}
export const oublierReglages = (stock) => { if (stock) caches.delete(stock); };

// L'assistant est-il ouvert à cette identité ? → null (oui) ou raison ("inactif" | "hors_pilote")
export function raisonFermeture(ctx, r) {
  if (!r.actif) return "inactif";
  if (ctx.admin || r.ouvert_a_tous || r.pilote.includes(Number(ctx.odooId))) return null;
  return "hors_pilote";
}

// Erreur dont le message (français) peut être relayé à la pharmacie ou au modèle tel quel
export const erreurPublique = (message, code = "refus") => Object.assign(new Error(message), { public: true, code });

// Journal : une ligne JSON par événement, jamais de texte de message, montant, e-mail ni secret
export const journalJson = (o) => console.log(JSON.stringify({ app: "assistant", at: new Date().toISOString(), ...o }));

// ── Dates à l'heure de Paris ────────────────────────────────────────────
export const jourParis = (d = new Date()) => new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const heureParis = (t) => new Date(t).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false });
// 00:00 à Paris du jour « AAAA-MM-JJ », en ISO UTC (UTC+1 l'hiver, UTC+2 l'été, jour du changement d'heure compris)
export function debutJourParisIso(jour) {
  for (const h of [2, 1]) {
    const t = Date.parse(`${jour}T00:00:00Z`) - h * 3600e3;
    if (jourParis(t) === jour && heureParis(t) === "00:00") return new Date(t).toISOString();
  }
  return new Date(Date.parse(`${jour}T00:00:00Z`) - 3600e3).toISOString();
}
export const jourSuivant = (jour) => new Date(Date.parse(`${jour}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
// « jeudi 16/10/2026, 14:05 »
export function dateHeureParis(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}`;
}
// « 16/10/2026 à 14 h 05 »
export function dateFrParis(d = new Date()) {
  const [a, m, j] = jourParis(d).split("-");
  const [h, mi] = heureParis(d).split(":");
  return `${j}/${m}/${a} à ${Number(h)} h ${mi}`;
}
