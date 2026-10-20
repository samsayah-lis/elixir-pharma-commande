// Tests des alertes « M'avertir du retour » : node scripts/test-alertes-retour.mjs
// Hors ligne : Supabase simulé en mémoire (petit PostgREST : filtres eq/in/lt/gte/is/like, PATCH conditionnel atomique,
// upsert, colonnes absentes → 400 comme en production), e-mails capturés (aucun envoi), Supabase Auth simulé.
//  • détection : en stock ET prix net > 0 (règle de la Saisie), prix remisé, rupture et prix manquant écartés ;
//  • regroupement : un e-mail par pharmacie (plusieurs produits), une seule fois par demande ;
//  • idempotence : second passage sans e-mail ; deux passages simultanés (répétés, délais aléatoires) : chaque demande
//    avertie exactement une fois, en mode complet comme en mode réduit (sans colonnes de suivi) ;
//  • refus propre à la demande : réservation rendue, essais comptés (table ou kv_store), clôture « echec » au 3e ;
//    panne générale de Resend (401, 403, quota) : rien de compté ni de clos, passage arrêté ; limite de débit ;
//    issue incertaine (exception, délai, 5xx) : jamais de second e-mail, « interrompu » ; 409 d'idempotence ;
//    envoyerResend (en-têtes, clé d'idempotence, délai, classement) ; motifs sans adresse ;
//  • mise en service : envois automatiques suspendus tant que l'admin ne les active pas ; demandes déjà vieilles de plus
//    de 60 jours à la mise en service closes sans e-mail, les autres valables jusqu'au retour du produit ;
//  • plafonds : un e-mail par adresse sur 24 h (réinsertion d'une demande), 150 par jour ; demande datée dans le futur ;
//  • destinataire : adresse encore compte de CE CIP, sinon close ; CIP de pharmacie enregistré avec des espaces ;
//  • clôtures dans le budget de temps ; articles sous plusieurs CIP (groupe en stock par une autre référence) ;
//  • fenêtre 7 h – 21 h (planifié) et « Envoyer maintenant » (admin) ; budget de temps (done=false, reprise) ;
//  • envoi interrompu repéré, jamais renvoyé d'office, « Relancer » ; RESEND_API_KEY absent : rien de réservé ;
//  • e-mail : échappement HTML, lien ?cip=, prix, mention de désinscription ;
//  • restock-alert : « retour » (14 jours, en stock), sans adresse ; nouvelle demande : suivi remis à zéro, repli sans colonnes ;
//  • restock-notify : admin (aperçu sans adresse, envoyer, relancer), secret de la GitHub Action (chiffres seulement), refus ;
//  • restock-notify-cron : passage et ménage du journal ;
//  • notification « Retour en stock » (docs/notifications.md § 9.1) : après un e-mail réellement parti seulement, une par
//    pharmacie et par appel (deux adresses : produits réunis, gardée seulement si l'autre adresse peut encore partir dans
//    l'appel), jamais attendue par les e-mails suivants, attente de fin bornée (1 s laissée au journal avant la limite),
//    jamais relancée, bilan figé une fois rendu ; étiquette à clé, jamais le CIP (en-tête Topic lu en clair par le service
//    push) ; exception, rejet, clés refusées, tables absentes, ouverture fermée, aucun appareil : rien, sans erreur ; clés
//    VAPID absentes : comportement d'avant, _push.js jamais sollicité.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ADMIN_EMAIL = "admin@elixir.test";
process.env.CRON_SECRET = "secret-cron-de-test";
process.env.RESEND_API_KEY = "re_test";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, cond, detail = "") => { if (cond) ok++; else { ko++; console.log("✗", label, detail); } };

// ── Supabase simulé ──
const BASE = ["pharmacy_cip", "cip", "pharmacy_email", "product_name", "created_at", "notified", "notified_at"];
const SUIVI = ["attempts", "outcome"];
let db, colonnes, delaiMax = 0, appels = [], resend = null;   // resend : (requête) → Response (envoyerResend)
const JETONS = {
  "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } },
  "jeton-a": { id: "u-a", email: "compte@pharmacie-a.test" },
};
const reponse = (corps, status = 200) => new Response(status === 204 ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
const echappeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function listeIn(arg) {   // ("a","b\"c") ou (a,b)
  const t = arg.replace(/^\(/, "").replace(/\)$/, "");
  const out = []; let cur = "", q = false, esc = false, guillemets = false;
  for (const c of t) {
    if (esc) { cur += c; esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { q = !q; guillemets = true; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur || guillemets || t) out.push(cur);
  return out;
}
const compare = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && /\d{4}-\d\d-\d\d/.test(String(a)) ? x - y : String(a).localeCompare(String(b)); };
function correspond(row, col, expr) {
  const i = expr.indexOf("."), op = expr.slice(0, i), arg = expr.slice(i + 1), v = row[col];
  switch (op) {
    case "eq": return v != null && String(v) === arg;
    case "lt": return v != null && compare(v, arg) < 0;
    case "gte": return v != null && compare(v, arg) >= 0;
    case "is": return arg === "null" ? v == null : String(v) === arg;
    case "in": return listeIn(arg).includes(String(v));
    case "like": return new RegExp(`^${echappeRe(arg).replace(/\\\*/g, ".*")}$`).test(String(v));
    default: throw new Error(`opérateur non simulé : ${op}`);
  }
}
const RESERVES = new Set(["select", "order", "limit", "on_conflict"]);
function colonnesDe(table) { return table === "restock_alerts" ? colonnes : null; }
const absente = (table, col) => ({ code: "42703", message: `column ${table}.${col} does not exist` });
const absenteEcriture = (table, col) => ({ code: "PGRST204", message: `Could not find the '${col}' column of '${table}' in the schema cache` });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const methode = opts.method || "GET";
  appels.push({ url, methode, corps: opts.body || null });
  if (delaiMax) await new Promise(r => setTimeout(r, Math.random() * delaiMax));
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? reponse(JETONS[t]) : reponse({ msg: "jeton invalide" }, 401);
  }
  if (url === "https://api.resend.com/emails" && resend) return resend({ url, ...opts });
  if (!url.startsWith("https://supabase.test/rest/v1/")) throw new Error(`appel réseau inattendu : ${methode} ${url}`);
  const u = new URL(url);
  const table = u.pathname.replace("/rest/v1/", "");
  if (!db[table]) throw new Error(`table non simulée : ${table}`);
  const cols = colonnesDe(table);
  const filtres = [...u.searchParams.entries()].filter(([k]) => !RESERVES.has(k));
  for (const [k] of filtres) if (cols && !cols.has(k)) return reponse(absente(table, k), 400);
  const choisies = () => db[table].filter(r => filtres.every(([k, v]) => correspond(r, k, v)));
  const prefer = String(opts.headers?.Prefer || "");
  if (methode === "GET") {
    let rows = choisies().map(r => ({ ...r }));
    const ordre = u.searchParams.get("order");
    if (ordre) { const [c, sens] = ordre.split("."); rows.sort((a, b) => (sens === "desc" ? -1 : 1) * compare(a[c] ?? "", b[c] ?? "")); }
    const range = opts.headers?.Range;
    if (range) { const [de, a] = range.split("-").map(Number); rows = rows.slice(de, a + 1); }
    if (u.searchParams.get("limit")) rows = rows.slice(0, Number(u.searchParams.get("limit")));
    const sel = u.searchParams.get("select");
    if (sel && sel !== "*") {
      const liste = sel.split(",");
      for (const c of liste) if (cols && !cols.has(c)) return reponse(absente(table, c), 400);
      rows = rows.map(r => Object.fromEntries(liste.map(c => [c, r[c] ?? null])));
    }
    return reponse(rows);
  }
  const corps = opts.body ? JSON.parse(opts.body) : null;
  if (methode === "PATCH") {
    for (const k of Object.keys(corps)) if (cols && !cols.has(k)) return reponse(absenteEcriture(table, k), 400);
    const rows = choisies();
    for (const r of rows) Object.assign(r, corps, table === "kv_store" ? { updated_at: new Date().toISOString() } : {});
    return prefer.includes("return=representation") ? reponse(rows.map(r => ({ ...r }))) : reponse(null, 204);
  }
  if (methode === "DELETE") { const sup = new Set(choisies()); db[table] = db[table].filter(r => !sup.has(r)); return reponse(null, 204); }
  if (methode === "POST") {
    const lignes = Array.isArray(corps) ? corps : [corps];
    for (const l of lignes) for (const k of Object.keys(l)) if (cols && !cols.has(k)) return reponse(absenteEcriture(table, k), 400);
    const cle = table === "kv_store" ? ["key"] : table === "restock_alerts" ? ["pharmacy_cip", "cip"] : null;
    for (const l of lignes) {
      const deja = cle && db[table].find(r => cle.every(c => String(r[c]) === String(l[c])));
      if (deja) Object.assign(deja, l, table === "kv_store" ? { updated_at: new Date().toISOString() } : {});
      else db[table].push({ ...(table === "restock_alerts" ? Object.fromEntries([...cols].map(c => [c, c === "attempts" ? 0 : c === "notified" ? false : null])) : {}),
        ...l, ...(table === "kv_store" ? { updated_at: new Date().toISOString() } : {}) });
    }
    return reponse(null, 201);
  }
  throw new Error(`méthode non simulée : ${methode}`);
};

// ── Données ──
const T0 = Date.parse("2026-10-20T08:30:00Z");   // 10 h 30 à Paris
const H = 3600e3, J = 86400e3;
const iso = (ms) => new Date(ms).toISOString();
const P1 = "3400930000001", P2 = "3400930000002", P3 = "3400930000003", P4 = "3400930000004", P5 = "3400930000005";
const CATALOGUE = [
  { cip: P1, name: "DOLIPRANE 1000MG CPR B/8", in_stock: true, list_price: 10, discounted_price: 10, discount_pct: 0 },
  { cip: P2, name: "VENTOLINE 100µG SUSP INH", in_stock: true, list_price: 20, discounted_price: 18, discount_pct: 10 },
  { cip: P3, name: "OZEMPIC 1MG", in_stock: false, list_price: 90, discounted_price: 90, discount_pct: 0 },
  { cip: P4, name: "PRODUIT SANS PRIX", in_stock: true, list_price: 0, discounted_price: null, discount_pct: 0 },
  { cip: P5, name: "PRODUIT <b>\"échappé\"</b> & Cie", in_stock: true, list_price: 5.5, discounted_price: 5.5, discount_pct: 0 },
];
const COMPTES = [
  { email: "compte@pharmacie-a.test", cip: "2000001", name: "Pharmacie A" },
  { email: "compte@pharmacie-b.test", cip: "2000002", name: "Pharmacie B" },
  { email: "ancien@pharmacie-c.test", cip: "2000099", name: "Autre officine" },   // adresse passée à une autre pharmacie
  { email: "compte@pharmacie-d.test", cip: "2000004", name: "Pharmacie D" },
  { email: "compte@pharmacie-g.test", cip: "2000007", name: "L'Officine <b>G</b>" },
];
const alerte = (pharmacy_cip, cip, email, ageMs, extra = {}) => ({ pharmacy_cip, cip, pharmacy_email: email, product_name: CATALOGUE.find(p => p.cip === cip)?.name || null,
  created_at: iso(T0 - ageMs), notified: false, notified_at: null, ...extra });
const kvLigne = (key, value) => ({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
function initialiser({ complet = true, alertes, reglages = { actif: true, mise_en_service: iso(T0), maj: iso(T0) } } = {}) {
  colonnes = new Set(complet ? [...BASE, ...SUIVI] : BASE);
  const rows = alertes || [
    alerte("2000001", P1, "compte@pharmacie-a.test", 2 * J),
    alerte("2000001", P2, "compte@pharmacie-a.test", 5 * J),
    alerte("2000001", P3, "compte@pharmacie-a.test", 1 * J),     // rupture : reste en attente
    alerte("2000002", P1, "compte@pharmacie-b.test", 3 * J),
    alerte("2000002", P4, "compte@pharmacie-b.test", 3 * J),     // en stock sans prix : reste en attente
    alerte("2000003", P1, "ancien@pharmacie-c.test", 4 * J),     // adresse rattachée à un autre CIP : close
    alerte("2000006", P1, null, 4 * J),                          // sans adresse : close
    alerte("2000004", P1, "compte@pharmacie-d.test", 75 * J),    // plus de 60 jours : close sans e-mail
    alerte("2000005", P3, "compte@pharmacie-e.test", 61 * J),    // plus de 60 jours, en rupture : close aussi
  ];
  db = {
    restock_alerts: rows.map(r => Object.fromEntries(Object.entries({ ...r, ...(complet ? { attempts: r.attempts ?? 0, outcome: r.outcome ?? null } : {}) }).filter(([k]) => colonnes.has(k)))),
    odoo_catalog: CATALOGUE.map(p => ({ ...p })),
    elixir_pharmacies: COMPTES.map(c => ({ ...c })),
    kv_store: reglages ? [kvLigne("restock_notify:reglages", reglages)] : [],
  };
  appels = [];
}
const ligneDe = (pc, cip) => db.restock_alerts.find(r => r.pharmacy_cip === pc && r.cip === cip);
let mails = [];
const envoiOk = async (m) => { mails.push(m); return { sent: true, id: `mail-${mails.length}` }; };
const sansPause = async () => {};
const R = await import("../netlify/functions/_restock.js");
const lance = (o = {}) => R.passage({ maintenant: () => T0, envoyer: envoiOk, attendre: sansPause, ...o });

// ════════ 1. détection, regroupement, clôtures ════════
initialiser();
mails = [];
let b = await lance({ source: "planifie" });
eq("mode complet détecté", b.mode, "complet");
eq("2 e-mails : pharmacie A (2 produits regroupés) et B", mails.map(m => m.to).sort(), ["compte@pharmacie-a.test", "compte@pharmacie-b.test"]);
eq("bilan : 2 e-mails, 2 pharmacies, 3 produits", [b.envoyes, b.pharmacies, b.produits], [2, 2, 3]);
eq("clôtures : 2 trop anciennes, 2 sans destinataire valable", b.closes, { ancienne: 2, destinataire: 2, echec: 0, interrompu: 0 });
eq("terminé", [b.done, b.restants, b.erreurs, b.suspendu, b.reportes], [true, 0, [], false, 0]);
const mailA = mails.find(m => m.to === "compte@pharmacie-a.test");
eq("A : objet au pluriel", mailA.subject, "2 produits que vous attendiez sont de retour en stock");
vrai("A : les deux produits et leurs CIP", [P1, P2, "DOLIPRANE 1000MG CPR B/8", "VENTOLINE 100µG SUSP INH"].every(x => mailA.html.includes(x)));
vrai("A : prix net de la Saisie (remisé 18,00, barré 20,00, −10 %)", mailA.html.includes("18,00&nbsp;€") && mailA.html.includes("line-through;\">20,00&nbsp;€") && mailA.html.includes("−10&nbsp;%") && mailA.html.includes("10,00&nbsp;€"));
vrai("A : lien qui ouvre le produit dans le site", mailA.html.includes(`href="https://elixir-commande.expepharma.com/?cip=${P1}"`) && mailA.html.includes(`?cip=${P2}"`));
vrai("A : nom de la pharmacie, vouvoiement, mention de désinscription",
  mailA.html.includes("Pharmacie A") && mailA.html.includes("Vous nous aviez demandé") && mailA.html.includes("Vous recevez cet e-mail parce que vous avez demandé à être averti du retour de ces produits")
  && mailA.html.includes("Cet e-mail ne sera pas renvoyé pour cette demande") && mailA.html.includes("Pour retirer une autre alerte en attente") && mailA.html.includes("nous la retirerons pour vous"));
vrai("A : charte (Inter chargée, pétrole, or en filet) et date du stock à l'heure de Paris", mailA.html.includes("'Inter'") && mailA.html.includes("fonts.googleapis.com/css2?family=Inter")
  && mailA.html.includes("#0f2d3d") && mailA.html.includes('bgcolor="#b5904a"') && mailA.html.includes("20&nbsp;octobre à 10&nbsp;h&nbsp;30"));
vrai("A : or jamais en texte sur fond clair (pas de surtitre « color:#b5904a »)", !mailA.html.includes("color:#b5904a"));
vrai("A : bouton à l'épreuve d'Outlook (cellule bgcolor pétrole), graisse 700", mailA.html.includes('<td bgcolor="#0f2d3d"') && !mailA.html.includes("font-weight:650"));
vrai("A : typographie (espaces insécables, apostrophes courbes, heure sans zéro)", mailA.html.includes("«&nbsp;M’avertir du retour&nbsp;»") && mailA.html.includes("«&nbsp;Alerte activée&nbsp;»")
  && mailA.html.includes("Elixir&nbsp;: indiquez") && mailA.html.includes("L’équipe") && !/L'équipe|n'est|qu'une/.test(mailA.html));
vrai("A : une seule colonne (prix sous le nom, CIP insécable)", !mailA.html.includes('align="right"') && mailA.html.includes("white-space:nowrap;\">CIP&nbsp;3400930000001"));
eq("date à 7 h 05 : heure sans zéro", R.emailRetour({ produits: [{ cip: P1, nom: "X", prix: 1 }], constate: Date.parse("2026-10-21T05:05:00Z") }).html.includes("21&nbsp;octobre à 7&nbsp;h&nbsp;05"), true);
const mailB = mails.find(m => m.to === "compte@pharmacie-b.test");
eq("B : objet au singulier, produit nommé", mailB.subject, "De retour en stock\u00a0: DOLIPRANE 1000MG CPR B/8");
eq("clés d'idempotence : une par envoi, stable (même demande → même clé)", [new Set(mails.map(m => m.idempotence)).size, R.cleIdempotence("2000001", [ligneDe("2000001", P2), ligneDe("2000001", P1)]) === mails.find(m => m.to === "compte@pharmacie-a.test").idempotence], [2, true]);
vrai("B : produit sans prix absent de l'e-mail", !mailB.html.includes(P4));
eq("A : P1 et P2 avertis (envoye), P3 en rupture toujours en attente",
  [ligneDe("2000001", P1).outcome, ligneDe("2000001", P2).outcome, ligneDe("2000001", P3).notified, ligneDe("2000001", P3).outcome], ["envoye", "envoye", false, null]);
eq("A : date d'avertissement notée", ligneDe("2000001", P1).notified_at, iso(T0));
eq("B : P4 (prix manquant) toujours en attente", [ligneDe("2000002", P4).notified, ligneDe("2000002", P1).outcome], [false, "envoye"]);
eq("C (adresse d'un autre CIP) et F (sans adresse) : closes sans e-mail", [ligneDe("2000003", P1).outcome, ligneDe("2000003", P1).notified, ligneDe("2000006", P1).outcome], ["destinataire", true, "destinataire"]);
eq("D et E (plus de 60 jours) : closes sans e-mail, même en rupture", [ligneDe("2000004", P1).outcome, ligneDe("2000005", P3).outcome, ligneDe("2000005", P3).notified], ["ancienne", "ancienne", true]);
vrai("aucun e-mail aux pharmacies C, D, E, F", !mails.some(m => /pharmacie-[cdef]/.test(m.to)));
const passages = db.kv_store.filter(k => k.key.startsWith(R.PREFIXE_PASSAGE));
eq("journal : un passage noté, 7 lignes", [passages.length, JSON.parse(passages[0]?.value || "{}").lignes?.length], [1, 7]);
vrai("journal et dernier passage : aucune adresse e-mail", !db.kv_store.some(k => String(k.value).includes("@")));
eq("journal : noms des pharmacies (pas d'adresse)", JSON.parse(passages[0].value).lignes.filter(l => l.issue === "envoye").map(l => l.pharmacie).sort(), ["Pharmacie A", "Pharmacie A", "Pharmacie B"]);
eq("dernier passage : chiffres", (() => { const d = JSON.parse(db.kv_store.find(k => k.key === R.CLE_DERNIER).value); return [d.envoyes, d.lignes, d.source]; })(), [2, 7, "planifie"]);

// ════════ 2. idempotence ════════
mails = [];
b = await lance();
eq("second passage : aucun e-mail, rien de clos", [mails.length, b.envoyes, R.chiffres(b).closes], [0, 0, { ancienne: 0, destinataire: 0, echec: 0, interrompu: 0 }]);
eq("second passage : rien noté au journal (rien fait)", db.kv_store.filter(k => k.key.startsWith(R.PREFIXE_PASSAGE)).length, 1);

// ════════ 3. deux passages simultanés (répétés) ════════
for (const complet of [true, false]) {
  let doublons = 0, manquants = 0, total = 0;
  for (let essai = 0; essai < 25; essai++) {
    initialiser({ complet });
    mails = [];
    delaiMax = 4;
    const lents = async (m) => { await new Promise(r => setTimeout(r, Math.random() * 4)); return envoiOk(m); };
    const [x, y] = await Promise.all([lance({ envoyer: lents, source: "planifie" }), lance({ envoyer: lents, source: "admin", horsFenetre: true })]);
    delaiMax = 0;
    const parAlerte = {};
    for (const m of mails) for (const cip of [P1, P2, P3, P4, P5]) if (m.html.includes(`?cip=${cip}"`)) parAlerte[`${m.to}|${cip}`] = (parAlerte[`${m.to}|${cip}`] || 0) + 1;
    doublons += Object.values(parAlerte).filter(n => n > 1).length;
    const attendues = ["compte@pharmacie-a.test|" + P1, "compte@pharmacie-a.test|" + P2, "compte@pharmacie-b.test|" + P1];
    manquants += attendues.filter(k => !parAlerte[k]).length;
    total += x.produits + y.produits;
    if (Object.keys(parAlerte).length !== 3) manquants += 100;
  }
  eq(`simultanés (${complet ? "complet" : "réduit"}), 25 fois : jamais deux e-mails pour une demande`, doublons, 0);
  eq(`simultanés (${complet ? "complet" : "réduit"}) : chaque demande avertie (3 par essai)`, [manquants, total], [0, 75]);
}

// ════════ 4. échec, nouvel essai, clôture « echec » ════════
initialiser();
mails = [];
const refuseB = async (m) => m.to.includes("pharmacie-b") ? { sent: false, status: 422, name: "validation_error", reason: "Invalid `to` field: compte@pharmacie-b.test" } : envoiOk(m);
b = await lance({ envoyer: refuseB });
eq("échec : A part, B refusé", [b.envoyes, b.echecs, mails.map(m => m.to)], [1, 1, ["compte@pharmacie-a.test"]]);
eq("échec : réservation rendue (en attente), 1 essai noté", [ligneDe("2000002", P1).notified, ligneDe("2000002", P1).attempts, ligneDe("2000002", P1).outcome, ligneDe("2000002", P1).notified_at], [false, 1, null, null]);
vrai("échec : motif sans adresse e-mail", b.erreurs.length === 1 && !b.erreurs[0].includes("@") && b.erreurs[0].includes("‹adresse›"), JSON.stringify(b.erreurs));
b = await lance({ envoyer: refuseB });
eq("2e refus : 2 essais, toujours en attente", [ligneDe("2000002", P1).attempts, ligneDe("2000002", P1).notified], [2, false]);
b = await lance({ envoyer: refuseB });
eq("3e refus : close « echec » (plus jamais retentée)", [ligneDe("2000002", P1).attempts, ligneDe("2000002", P1).notified, ligneDe("2000002", P1).outcome, b.closes.echec], [3, true, "echec", 1]);
mails = [];
b = await lance();
eq("après « echec » : aucun nouvel e-mail pour B", mails.length, 0);
// issue incertaine : l'envoi lève une exception APRÈS que Resend a reçu l'e-mail → jamais de second e-mail
for (const complet of [true, false]) {
  initialiser({ complet });
  mails = [];
  const coupe = async (m) => { mails.push(m); if (m.to.includes("pharmacie-a")) throw new Error("socket hang up"); return { sent: true, id: "x" }; };
  b = await lance({ envoyer: coupe });
  const mode = complet ? "complet" : "réduit";
  eq(`incertain (${mode}) : rien de rendu ni compté, passage arrêté`, [b.echecs, b.closes.interrompu, b.envoyes, b.restants, ligneDe("2000001", P1).notified, ligneDe("2000001", P1).attempts ?? 0],
    [0, 2, 0, 1, true, 0]);
  if (complet) eq("incertain (complet) : « interrompu », à vérifier", [ligneDe("2000001", P1).outcome, ligneDe("2000001", P2).outcome], ["interrompu", "interrompu"]);
  vrai(`incertain (${mode}) : erreur visible (vérifier dans Resend)`, b.erreurs.some(e => /incertain/.test(e) && /Resend/.test(e)), JSON.stringify(b.erreurs));
  for (let k = 1; k <= 3; k++) await lance({ envoyer: coupe, maintenant: () => T0 + k * 3 * H });
  eq(`incertain (${mode}), 3 passages de plus : un seul e-mail remis pour A, B averti`, [mails.filter(m => m.to.includes("pharmacie-a")).length, mails.filter(m => m.to.includes("pharmacie-b")).length], [1, 1]);
}
// 5xx et délai dépassé : incertains aussi ; 409 « invalid_idempotent_request » : Resend avait déjà l'envoi → noté envoyé
eq("classement : 500, 503, sans statut, délai → incertain", [R.classer({ sent: false, status: 500 }), R.classer({ sent: false, status: 503, name: "service_unavailable" }), R.classer({ sent: false, reason: "x" }), R.classer({ sent: false, ambigu: true })], ["ambigu", "ambigu", "ambigu", "ambigu"]);
eq("classement : 409", [R.classer({ sent: false, status: 409, name: "invalid_idempotent_request" }), R.classer({ sent: false, status: 409, name: "concurrent_idempotent_requests" })], ["deja", "ambigu"]);
eq("classement : pannes générales", ["missing_api_key", "restricted_api_key", "validation_error"].map(n => R.classer({ sent: false, status: 401, name: n }))
  .concat([R.classer({ sent: false, status: 403, name: "validation_error" }), R.classer({ sent: false, status: 429, name: "daily_quota_exceeded" }), R.classer({ sent: false, status: 429, name: "monthly_quota_exceeded" }),
    R.classer({ sent: false, status: 422, name: "invalid_from_address" }), R.classer({ sent: false, status: 400, name: "invalid_idempotency_key" })]), Array(8).fill("panne"));
eq("classement : débit, refus propres à la demande", [R.classer({ sent: false, status: 429, name: "rate_limit_exceeded" }), R.classer({ sent: false, status: 422, name: "validation_error" }), R.classer({ sent: false, status: 400, name: "validation_error" })], ["debit", "demande", "demande"]);
initialiser();
mails = [];
b = await lance({ envoyer: async (m) => { mails.push(m); return { sent: false, status: 409, name: "invalid_idempotent_request", reason: "Same idempotency key used with a different request payload" }; } });
eq("409 d'idempotence : noté envoyé, aucun nouvel essai", [b.envoyes, ligneDe("2000001", P1).outcome, b.erreurs.filter(e => /idempotence/.test(e)).length], [2, "envoye", 2]);
// panne générale de Resend : 5 passages, rien de clos, aucun essai compté, passage arrêté au premier refus
for (const [statut, nom, msg] of [[401, "validation_error", "API key is invalid"], [403, "validation_error", "The elixirpharma.fr domain is not verified"],
  [429, "daily_quota_exceeded", "You have reached your daily email sending quota."]]) {
  initialiser();
  let tentatives = 0;
  const panne = async () => { tentatives++; return { sent: false, status: statut, name: nom, reason: msg }; };
  for (let k = 0; k < 5; k++) b = await lance({ envoyer: panne, source: "planifie", maintenant: () => T0 + k * H });
  eq(`panne ${statut} ${nom}, 5 passages : rien de clos, aucun essai compté, en attente`,
    [[P1, P2].map(c => [ligneDe("2000001", c).notified, ligneDe("2000001", c).attempts, ligneDe("2000001", c).outcome]), ligneDe("2000002", P1).notified, tentatives],
    [[[false, 0, null], [false, 0, null]], false, 5]);
  eq(`panne ${statut} : signalée, reste annoncé, appel terminé`, [!!b.panne, b.restants, b.done, b.echecs], [true, 2, true, 0]);
}
// limite de débit : rendue SANS compter, passage interrompu
initialiser();
mails = [];
b = await lance({ envoyer: async () => ({ sent: false, status: 429, name: "rate_limit_exceeded", reason: "Too many requests. You can only make 2 requests per second." }) });
eq("limite de débit : rien compté, reprise annoncée (done=false)", [b.echecs, b.done, b.restants, ligneDe("2000001", P1).attempts, ligneDe("2000001", P1).notified], [0, false, 2, 0, false]);
b = await lance();
eq("limite de débit : le passage suivant envoie", [b.envoyes, b.done], [2, true]);
// « Relancer » une demande close « echec » : un essai de plus
initialiser();
for (let k = 0; k < 3; k++) await lance({ envoyer: refuseB });
eq("relancer un « echec » : remise en attente", [ligneDe("2000002", P1).outcome, (await R.relancer({ pharmacy_cip: "2000002", cip: P1 })).ok, ligneDe("2000002", P1).notified], ["echec", true, false]);
mails = [];
await lance();
eq("relancer un « echec » : envoyé au passage suivant", [mails.map(m => m.to), ligneDe("2000002", P1).outcome], [["compte@pharmacie-b.test"], "envoye"]);

// mode réduit : essais dans kv_store
initialiser({ complet: false });
const refuseTout = async () => ({ sent: false, status: 422, name: "validation_error", reason: "Invalid `to` field" });
for (let i = 0; i < 2; i++) await lance({ envoyer: refuseTout });
eq("réduit : 2 refus → en attente, essais dans kv_store", [ligneDe("2000001", P1).notified, JSON.parse(db.kv_store.find(k => k.key === "restock_notify:essais:2000001:" + P1)?.value || "{}").n], [false, 2]);
b = await lance({ envoyer: refuseTout });
eq("réduit : 3e refus → close (notified=true), comptée « echec »", [ligneDe("2000001", P1).notified, b.closes.echec, b.mode], [true, 3, "reduit"]);
mails = [];
await lance();
eq("réduit : plus d'envoi après clôture", mails.length, 0);

// ════════ 5. fenêtre d'envoi, budget de temps ════════
initialiser();
mails = [];
const NUIT = Date.parse("2026-10-20T21:30:00Z");   // 23 h 30 à Paris
b = await R.passage({ maintenant: () => NUIT, envoyer: envoiOk, attendre: sansPause, source: "planifie" });
eq("23 h 30 (planifié) : aucun e-mail, clôtures faites, 2 en attente du matin", [mails.length, b.hors_fenetre, b.restants, b.closes.ancienne + b.closes.destinataire, b.done], [0, true, 2, 4, true]);
eq("23 h 30 : rien de réservé", ligneDe("2000001", P1).notified, false);
b = await R.passage({ maintenant: () => NUIT, envoyer: envoiOk, attendre: sansPause, source: "admin", horsFenetre: true });
eq("« Envoyer maintenant » (admin) : à toute heure", b.envoyes, 2);
initialiser();
mails = [];
let horloge = T0;
b = await R.passage({ maintenant: () => (horloge += 400), envoyer: envoiOk, attendre: sansPause, budgetMs: 1000 });
vrai("budget dépassé : done=false, reste annoncé (clôtures d'abord, puis envois)", b.done === false && b.restants >= 1, JSON.stringify(R.chiffres(b)));
b = await lance();
eq("budget : l'appel suivant termine", [b.done, ligneDe("2000001", P1).outcome, ligneDe("2000002", P1).outcome], [true, "envoye", "envoye"]);

// ════════ 6. envoi interrompu, « Relancer » ════════
initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 2 * J, { notified: true, notified_at: iso(T0 - 20 * 60e3), outcome: "envoi" }),
  alerte("2000002", P1, "compte@pharmacie-b.test", 2 * J, { notified: true, notified_at: iso(T0 - 2 * 60e3), outcome: "envoi" })] });
mails = [];
b = await lance();
eq("réservé depuis 20 min sans compte rendu : « interrompu », pas renvoyé ; réservé depuis 2 min : intact", [b.closes.interrompu, mails.length, ligneDe("2000001", P1).outcome, ligneDe("2000002", P1).outcome], [1, 0, "interrompu", "envoi"]);
let ap = await R.apercu({ maintenant: T0 });
eq("aperçu : envoi interrompu à vérifier (nom, adresse pour Resend, heure de réservation)", ap.a_verifier.map(x => [x.pharmacie, x.cip, x.issue, x.email, x.at]),
  [["Pharmacie A", P1, "interrompu", "compte@pharmacie-a.test", iso(T0 - 20 * 60e3)]]);
eq("relancer : demande remise en attente", [(await R.relancer({ pharmacy_cip: "2000001", cip: P1 })).ok, ligneDe("2000001", P1).notified, ligneDe("2000001", P1).outcome], [true, false, null]);
eq("relancer deux fois : 404", (await R.relancer({ pharmacy_cip: "2000001", cip: P1 })).statut, 404);
b = await lance();
eq("après relance : envoyé au passage suivant", [mails.length, ligneDe("2000001", P1).outcome], [1, "envoye"]);

// ════════ 7. RESEND_API_KEY absent : rien de réservé ════════
initialiser();
delete process.env.RESEND_API_KEY;
b = await R.passage({ maintenant: () => T0, attendre: sansPause });
eq("sans RESEND_API_KEY : aucune réservation, motif clair, clôtures faites", [ligneDe("2000001", P1).notified, b.restants, b.erreurs[0], b.closes.ancienne],
  [false, 2, "RESEND_API_KEY absent des variables Netlify : aucun e-mail envoyé", 2]);
vrai("sans RESEND_API_KEY : aucun appel à Resend", !appels.some(a => a.url.includes("resend")));
process.env.RESEND_API_KEY = "re_test";

// ════════ 8. e-mail : échappement HTML ════════
initialiser({ alertes: [alerte("2000007", P5, "compte@pharmacie-g.test", J, { product_name: "<script>alert('x')</script> & Co \"spécial\"" })] });
mails = [];
await lance();
const h = mails[0]?.html || "";
vrai("nom du catalogue, jamais celui envoyé par le navigateur", !h.includes("script") && h.includes("PRODUIT &lt;b&gt;&quot;échappé&quot;&lt;/b&gt; &amp; Cie"), h.slice(0, 200));
vrai("échappement : nom de pharmacie échappé", h.includes("L&#39;Officine &lt;b&gt;G&lt;/b&gt;") && !h.includes("<b>G</b>"));
eq("objet : nom du catalogue, texte brut", mails[0]?.subject, "De retour en stock\u00a0: PRODUIT <b>\"échappé\"</b> & Cie");
const subj = R.emailRetour({ produits: [{ cip: P1, nom: "A\r\nBcc: x", prix: 1 }] }).subject;
eq("objet : sans saut de ligne", subj, "De retour en stock\u00a0: A Bcc: x");
const ex = R.emailRetour({ produits: [{ cip: "34\"><img src=x>", nom: "A", prix: 1 }] });
vrai("échappement : CIP dans le lien et le texte", !ex.html.includes("<img") && ex.html.includes("?cip=34%22%3E%3Cimg%20src%3Dx%3E"));

// ════════ 9. aperçu de l'admin ════════
initialiser();
ap = await R.apercu({ maintenant: T0 });
eq("aperçu : mode, totaux (en attente, anciennes, prêts : seuls les destinataires valables comptent)", [ap.mode, ap.totaux], ["complet",
  { en_attente: 7, pharmacies_en_attente: 4, anciennes: 2, futures: 0, alertes_pretes: 5, emails_prets: 2, emails_reportes: 0, closes_destinataire: 2, produits_prets: 2 }]);
eq("aperçu : réglages, prochain passage planifié (h:50 UTC, heures d'envoi), première mise en service", [ap.reglages.actif, ap.reglages.seuil_anciennes, ap.prochain_passage, ap.deja_envoye, ap.envoyes_jour],
  [true, iso(T0 - 60 * J), "2026-10-20T09:50:00.000Z", false, 0]);
eq("aperçu : les plus attendus d'abord, puis la demande la plus ancienne", ap.produits.map(p => [p.cip, p.attente, p.pret]), [[P1, 4, true], [P2, 1, true], [P4, 1, false], [P3, 1, false]]);
eq("aperçu : plus ancienne demande et prix", [ap.produits[0].plus_ancienne, ap.produits[0].prix, ap.produits[1].prix], [iso(T0 - 4 * J), 10, 18]);
eq("aperçu : pharmacies par nom et CIP, la plus ancienne demande d'abord", ap.produits[0].pharmacies.map(x => [x.nom, x.cip]),
  [[null, "2000003"], [null, "2000006"], ["Pharmacie B", "2000002"], ["Pharmacie A", "2000001"]]);
vrai("aperçu : aucune adresse e-mail", !JSON.stringify(ap).includes("@"));
await lance();
ap = await R.apercu({ maintenant: T0 });
eq("aperçu après passage : avertis récemment avec leur issue", ap.recents.map(x => x.issue).sort(), ["ancienne", "ancienne", "destinataire", "destinataire", "envoye", "envoye", "envoye"]);
eq("aperçu après passage : journal et dernier passage", [ap.passages.length, ap.passages[0].envoyes, ap.passages[0].lignes, ap.dernier?.envoyes], [1, 2, 7, 2]);
eq("aperçu après passage : mise en service faite, e-mails du jour comptés", [ap.deja_envoye, ap.envoyes_jour], [true, 2]);
vrai("aperçu après passage : toujours aucune adresse", !JSON.stringify(ap).includes("@"));
initialiser({ complet: false });
ap = await R.apercu({ maintenant: T0 });
eq("aperçu en mode réduit", [ap.mode, ap.a_verifier], ["reduit", []]);
initialiser({ alertes: [] });
eq("aperçu table vide", [(await R.apercu({ maintenant: T0 })).mode, (await lance()).mode], ["vide", "vide"]);

// ════════ 10. restock-alert : « retour » et nouvelle demande ════════
const { handler: alerteHttp } = await import("../netlify/functions/restock-alert.js");
const ev = (methode, { jeton, q, corps, entetes } = {}) => ({ httpMethod: methode, headers: { origin: "https://elixir-commande.expepharma.com", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(entetes || {}) },
  queryStringParameters: q || {}, body: corps === undefined ? null : JSON.stringify(corps) });
const lit = (r) => { let c; try { c = JSON.parse(r.body); } catch { c = r.body; } return { statut: r.statusCode, corps: c }; };
const MAINTENANT = Date.now();
initialiser({ alertes: [
  alerte("2000001", P1, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 10 * J), notified: true, notified_at: iso(MAINTENANT - 2 * J), outcome: "envoye" }),
  alerte("2000001", P2, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 40 * J), notified: true, notified_at: iso(MAINTENANT - 20 * J), outcome: "envoye" }),   // avertie il y a 20 j
  alerte("2000001", P3, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 3 * J), notified: true, notified_at: iso(MAINTENANT - J), outcome: "envoye" }),        // repartie en rupture
  alerte("2000001", P5, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 90 * J), notified: true, notified_at: iso(MAINTENANT - J), outcome: "ancienne" }),
  alerte("2000001", P4, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - J) }),
] });
let r = lit(await alerteHttp(ev("GET", { jeton: "jeton-a" })));
const parCip = Object.fromEntries((r.corps || []).map(a => [a.cip, a]));
eq("GET pharmacie : retour seulement si avertie < 14 j et en stock", [P1, P2, P3, P5, P4].map(c => parCip[c]?.retour), [true, false, false, false, false]);
eq("GET pharmacie : notified pour distinguer alerte active et avertie", [parCip[P1].notified, parCip[P4].notified], [true, false]);
eq("GET pharmacie : CIP de la ligne à marquer (retour_cip)", [parCip[P1].retour_cip, "retour_cip" in parCip[P2]], [P1, false]);
vrai("GET pharmacie : aucune adresse e-mail ni suivi interne", !JSON.stringify(r.corps).includes("@") && !("outcome" in parCip[P1]) && !("attempts" in parCip[P1]));
initialiser({ complet: false, alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 10 * J), notified: true, notified_at: iso(MAINTENANT - 2 * J) }),
  alerte("2000001", P2, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 80 * J), notified: true, notified_at: iso(MAINTENANT - J) })] });
r = lit(await alerteHttp(ev("GET", { jeton: "jeton-a" })));
eq("GET mode réduit : avertie récemment = retour ; close pour ancienneté (80 j) = non", (r.corps || []).map(a => [a.cip, a.retour]), [[P1, true], [P2, false]]);
// nouvelle demande après avertissement : suivi remis à zéro
initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 0, { created_at: iso(MAINTENANT - 10 * J), notified: true, notified_at: iso(MAINTENANT - 2 * J), outcome: "echec", attempts: 3 })] });
r = lit(await alerteHttp(ev("POST", { jeton: "jeton-a", corps: { cip: P1, product_name: "DOLIPRANE" } })));
eq("POST : demande refaite, suivi remis à zéro", [r.statut, ligneDe("2000001", P1).notified, ligneDe("2000001", P1).attempts, ligneDe("2000001", P1).outcome, ligneDe("2000001", P1).notified_at], [200, false, 0, null, null]);
initialiser({ complet: false, alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 0, { notified: true, notified_at: iso(MAINTENANT - J) })] });
appels = [];
r = lit(await alerteHttp(ev("POST", { jeton: "jeton-a", corps: { cip: P1, product_name: "DOLIPRANE" } })));
eq("POST mode réduit : repli sans colonnes de suivi (2 écritures), demande active", [r.statut, appels.filter(a => a.methode === "POST" && a.url.includes("restock_alerts")).length, ligneDe("2000001", P1).notified], [200, 2, false]);
initialiser();
// POST : CIP en chiffres, nom coupé à 200 caractères, CIP de pharmacie de l'admin sans espaces
initialiser({ alertes: [] });
r = lit(await alerteHttp(ev("POST", { jeton: "jeton-a", corps: { cip: "<b>x</b>", product_name: "x" } })));
eq("POST : CIP invalide refusé", [r.statut, db.restock_alerts.length], [400, 0]);
r = lit(await alerteHttp(ev("POST", { jeton: "jeton-a", corps: { cip: ` ${P1} `, product_name: "N".repeat(300) } })));
eq("POST : CIP nettoyé, nom coupé à 200", [r.statut, ligneDe("2000001", P1)?.product_name.length], [200, 200]);
r = lit(await alerteHttp(ev("POST", { jeton: "jeton-admin", corps: { pharmacy_cip: " 2000002 ", pharmacy_email: " compte@pharmacie-b.test ", cip: P2, product_name: "V" } })));
eq("POST admin : CIP de pharmacie et adresse sans espaces", [r.statut, !!ligneDe("2000002", P2), ligneDe("2000002", P2)?.pharmacy_email], [200, true, "compte@pharmacie-b.test"]);
initialiser();
r = lit(await alerteHttp(ev("DELETE", { jeton: "jeton-a", q: { cip: P1 } })));
eq("DELETE (masquer « De retour en stock ») : demande retirée", [r.statut, !!ligneDe("2000001", P1)], [200, false]);
r = lit(await alerteHttp(ev("DELETE", { jeton: "jeton-admin", q: { pharmacy_cip: "2000002", cip: P1 } })));
eq("DELETE admin (« Retirer » de l'onglet) : demande de la pharmacie retirée", [r.statut, !!ligneDe("2000002", P1)], [200, false]);

// ════════ 11. restock-notify (HTTP) ════════
const { creerHandler } = await import("../netlify/functions/restock-notify.js");
const notify = creerHandler({ maintenant: () => T0, envoyer: envoiOk, attendre: sansPause });
initialiser();
r = lit(await notify(ev("GET")));
eq("restock-notify GET sans jeton : 403, rien lu", [r.statut, appels.filter(a => a.url.includes("restock_alerts")).length], [403, 0]);
r = lit(await notify(ev("GET", { jeton: "jeton-a" })));
eq("restock-notify GET par une pharmacie : 403", r.statut, 403);
r = lit(await notify(ev("GET", { jeton: "jeton-admin" })));
eq("restock-notify GET admin : aperçu, sans adresse", [r.statut, r.corps.totaux?.emails_prets, JSON.stringify(r.corps).includes("@")], [200, 2, false]);
r = lit(await notify(ev("POST", { jeton: "jeton-a", corps: { action: "envoyer" } })));
eq("restock-notify envoyer par une pharmacie : 403, rien envoyé", [r.statut, ligneDe("2000001", P1).notified], [403, false]);
r = lit(await notify(ev("GET", { q: { action: "envoyer" }, entetes: { "x-cron-secret": "mauvais" } })));
eq("restock-notify mauvais secret : 403", r.statut, 403);
r = lit(await notify(ev("GET", { entetes: { "x-cron-secret": "secret-cron-de-test" } })));
eq("restock-notify secret sans action : 400", r.statut, 400);
mails = [];
r = lit(await notify(ev("GET", { q: { action: "envoyer" }, entetes: { "x-cron-secret": "secret-cron-de-test" } })));
eq("restock-notify GitHub Action : passage, chiffres", [r.statut, r.corps.envoyes, r.corps.done, mails.length], [200, 2, true, 2]);
vrai("restock-notify GitHub Action : ni nom, ni adresse, ni ligne", !/@|Pharmacie|lignes/.test(JSON.stringify(r.corps)), JSON.stringify(r.corps));
eq("restock-notify : source « synchro » notée", JSON.parse(db.kv_store.find(k => k.key === R.CLE_DERNIER).value).source, "synchro");
initialiser();
r = lit(await notify(ev("POST", { jeton: "jeton-admin", corps: { action: "envoyer" } })));
eq("restock-notify admin « Envoyer maintenant »", [r.statut, r.corps.envoyes, JSON.parse(db.kv_store.find(k => k.key === R.CLE_DERNIER).value).source], [200, 2, "admin"]);
r = lit(await notify(ev("POST", { jeton: "jeton-admin", corps: { action: "relancer", pharmacy_cip: "2000001", cip: P1 } })));
eq("restock-notify relancer sans envoi interrompu : 404", r.statut, 404);
initialiser({ reglages: null });
r = lit(await notify(ev("POST", { jeton: "jeton-a", corps: { action: "activer", actif: true } })));
eq("activer par une pharmacie : 403", [r.statut, db.kv_store.length], [403, 0]);
r = lit(await notify(ev("POST", { jeton: "jeton-admin", corps: { action: "activer", actif: "oui" } })));
eq("activer sans booléen : 400", r.statut, 400);
r = lit(await notify(ev("POST", { jeton: "jeton-admin", corps: { action: "activer", actif: true } })));
eq("activer : envois automatiques actifs, mise en service datée", [r.statut, r.corps.actif, r.corps.mise_en_service], [200, true, iso(T0)]);
const notifyPlus = creerHandler({ maintenant: () => T0 + 5 * J, envoyer: envoiOk, attendre: sansPause });
r = lit(await notifyPlus(ev("POST", { jeton: "jeton-admin", corps: { action: "activer", actif: false } })));
r = lit(await notifyPlus(ev("POST", { jeton: "jeton-admin", corps: { action: "activer", actif: true } })));
eq("suspendre puis réactiver : date de mise en service inchangée", [r.corps.actif, r.corps.mise_en_service], [true, iso(T0)]);
r = lit(await notify(ev("POST", { jeton: "jeton-admin", corps: { action: "inconnue" } })));
eq("restock-notify action inconnue : 400", r.statut, 400);
r = lit(await notify({ ...ev("POST", { jeton: "jeton-admin" }), body: "{pas du json" }));
eq("restock-notify JSON invalide : 400", r.statut, 400);

// ════════ 12. restock-notify-cron ════════
const { creerHandler: creerCron } = await import("../netlify/functions/restock-notify-cron.js");
initialiser();
db.kv_store.push({ key: `${R.PREFIXE_PASSAGE}2026-07-01T00:00:00.000Z:abcd`, value: "{}", updated_at: "2026-07-01T00:00:00.000Z" });
mails = [];
let chargements = 0;
const chargerGroupes = async () => { chargements++; return { BR1: ["3400930000098", "3400930000099"] }; };
r = await creerCron({ maintenant: () => T0, envoyer: envoiOk, attendre: sansPause, chargerGroupes })();
eq("cron : passage planifié, e-mails envoyés", [r.statusCode, JSON.parse(r.body).envoyes, mails.length], [200, 2, 2]);
eq("cron : journal de plus de 60 jours effacé", db.kv_store.some(k => k.key.includes("2026-07-01")), false);
eq("cron : groupes d'articles copiés dans kv_store (une fois par jour)", [chargements, JSON.parse(db.kv_store.find(k => k.key === R.CLE_GROUPES)?.value || "{}").groupes], [1, { BR1: ["3400930000098", "3400930000099"] }]);
await creerCron({ maintenant: () => T0 + H, envoyer: envoiOk, attendre: sansPause, chargerGroupes })();
eq("cron : groupes frais gardés (pas de nouvel appel à Odoo)", chargements, 1);
r = await creerCron({ maintenant: () => T0 + 2 * J, envoyer: envoiOk, attendre: sansPause, chargerGroupes: async () => { throw new Error("Odoo indisponible"); } })();
eq("cron : Odoo indisponible → passage quand même, ancienne copie gardée", [r.statusCode, !!db.kv_store.find(k => k.key === R.CLE_GROUPES)], [200, true]);

// ════════ 14. mise en service : envois automatiques suspendus par défaut, demandes anciennes ════════
initialiser({ reglages: null });
mails = [];
b = await lance({ source: "planifie" });
eq("jamais activés : passage planifié sans e-mail, clôtures faites, suspendu annoncé", [mails.length, b.suspendu, b.restants, b.closes.ancienne, b.closes.destinataire, ligneDe("2000001", P1).notified],
  [0, true, 2, 2, 2, false]);
b = await lance({ source: "synchro" });
eq("jamais activés : passage après la synchro sans e-mail non plus", [mails.length, b.suspendu], [0, true]);
b = await lance({ source: "admin", horsFenetre: true });
eq("« Envoyer maintenant » (admin) : envoie même suspendu", [mails.length, b.suspendu], [2, false]);
initialiser({ reglages: { actif: false, mise_en_service: iso(T0 - 30 * J) } });
mails = [];
b = await lance({ source: "planifie" });
eq("suspendus après mise en service : aucun e-mail automatique", [mails.length, b.suspendu], [0, true]);
// seuil figé à la mise en service : 60 jours AVANT elle ; ensuite une demande attend le retour du produit sans limite
const MES = T0 - 30 * J;
initialiser({ reglages: { actif: true, mise_en_service: iso(MES) }, alertes: [
  alerte("2000001", P1, "compte@pharmacie-a.test", 95 * J),   // 65 j avant la mise en service : close
  alerte("2000002", P1, "compte@pharmacie-b.test", 85 * J),   // 55 j avant la mise en service (85 j aujourd'hui) : valable
  alerte("2000004", P3, "compte@pharmacie-d.test", 89 * J),   // en rupture, 59 j avant : reste en attente
] });
mails = [];
b = await lance({ source: "planifie" });
eq("seuil figé : close si déjà vieille de plus de 60 j à la mise en service, sinon avertie même après 85 j d'attente",
  [ligneDe("2000001", P1).outcome, ligneDe("2000002", P1).outcome, ligneDe("2000004", P3).notified, mails.map(m => m.to)], ["ancienne", "envoye", false, ["compte@pharmacie-b.test"]]);
ap = await R.apercu({ maintenant: T0 });
eq("aperçu : seuil des demandes anciennes (60 j avant la mise en service)", [ap.reglages.seuil_anciennes, ap.totaux.en_attente, ap.totaux.anciennes], [iso(MES - 60 * J), 1, 0]);
eq("règle : seuil avant mise en service = 60 j glissants", [R.seuilAnciennes({}, T0), R.seuilAnciennes({ mise_en_service: iso(T0 + J) }, T0)], [T0 - 60 * J, T0 - 60 * J]);
// réglages illisibles (kv_store en panne) : aucun envoi, aucune clôture
initialiser();
const avantKv = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).includes("kv_store") && (o?.method || "GET") === "GET" ? new Response("panne", { status: 503 }) : avantKv(u, o);
mails = [];
b = await lance({ source: "planifie", journaliser: false });
globalThis.fetch = avantKv;
eq("kv_store illisible : aucun e-mail, aucune clôture, erreur signalée", [mails.length, b.closes.ancienne, /réglages illisibles/.test(b.erreur || "")], [0, 0, true]);

// ════════ 15. plafonds : un e-mail par adresse sur 24 h, plafond du jour ; demande datée dans le futur ════════
initialiser();
mails = [];
await lance();
// tiers avec la clé publique (plan RLS pas encore appliqué) : réinsère la demande déjà avertie
Object.assign(ligneDe("2000001", P1), { notified: false, outcome: null, attempts: 0, notified_at: null, created_at: iso(T0 + H) });
b = await lance({ source: "planifie", maintenant: () => T0 + 3 * H });
eq("réinsertion d'une demande avertie : pas de second e-mail dans les 24 h, la demande attend", [mails.length, b.reportes, ligneDe("2000001", P1).notified], [2, 1, false]);
b = await lance({ source: "planifie", maintenant: () => T0 + 25 * H });
eq("plus de 24 h après : l'adresse peut de nouveau recevoir un e-mail", [mails.length, b.envoyes], [3, 1]);
vrai("plafond par adresse : empreintes seulement dans kv_store (aucune adresse)", db.kv_store.filter(k => k.key.startsWith(R.PREFIXE_DEST)).every(k => !k.key.includes("@") && !k.value.includes("@")));
// deux CIP de pharmacie, même adresse : un seul e-mail par 24 h
initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 2 * J), alerte("2000009", P2, "compte@pharmacie-a.test", 3 * J)] });
db.elixir_pharmacies.push({ email: "compte@pharmacie-a.test", cip: "2000009", name: "Pharmacie A bis" });
mails = [];
b = await lance();
eq("même adresse pour deux pharmacies : un e-mail, l'autre reporté", [mails.length, b.envoyes, b.reportes], [1, 1, 1]);
// plafond du jour
const nombreux = Array.from({ length: R.PLAFOND_JOUR + 5 }, (_, i) => ({ email: `c${i}@officine.test`, cip: String(3000000 + i), name: `Officine ${i}` }));
initialiser({ alertes: nombreux.map((c, i) => alerte(c.cip, P1, c.email, J + i * 1000)) });
db.elixir_pharmacies.push(...nombreux);
mails = [];
b = await lance({ source: "admin", budgetMs: 1e9, limiteMs: 1e9 });
eq("plafond du jour : 150 e-mails, arrêt annoncé, le reste attend demain", [mails.length, b.plafond, b.restants, b.done, b.erreurs.some(e => /plafond du jour/.test(e))], [R.PLAFOND_JOUR, true, 5, true, true]);
b = await lance({ source: "admin", budgetMs: 1e9, limiteMs: 1e9 });
eq("plafond du jour : un second passage du même jour n'envoie rien", [mails.length, b.plafond], [R.PLAFOND_JOUR, true]);
b = await lance({ source: "admin", budgetMs: 1e9, limiteMs: 1e9, maintenant: () => T0 + J });
eq("plafond du jour : le lendemain, le reste part", [mails.length, b.envoyes], [R.PLAFOND_JOUR + 5, 5]);
// demande datée dans le futur (écrite avec la clé publique) : écartée
initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", -2 * J)] });
mails = [];
b = await lance();
eq("demande datée dans le futur : écartée, signalée", [mails.length, b.ecartees, ligneDe("2000001", P1).notified], [0, 1, false]);

// ════════ 16. CIP de pharmacie enregistré avec des espaces ════════
initialiser({ alertes: [alerte("2000001 ", P1, "compte@pharmacie-a.test", 2 * J), alerte(" 2000003", P2, "ancien@pharmacie-c.test", 2 * J)] });
mails = [];
for (let k = 0; k < 2; k++) b = await lance({ maintenant: () => T0 + k * 3 * H });
eq("valeur brute : réservée, envoyée une fois, issue notée ; clôture « destinataire » aussi", [mails.length, ligneDe("2000001 ", P1).outcome, ligneDe(" 2000003", P2).outcome], [1, "envoye", "destinataire"]);

// ════════ 17. clôtures dans le budget de temps (fonction HTTP : 10 s) ════════
initialiser({ alertes: [...Array.from({ length: 80 }, (_, i) => alerte(String(4000000 + i), P1, `parti${i}@ancienne.test`, 2 * J)), alerte("2000001", P1, "compte@pharmacie-a.test", 2 * J)] });
mails = [];
horloge = T0;
const rapide = globalThis.fetch;
globalThis.fetch = async (u, o) => { horloge += 150; return rapide(u, o); };   // 150 ms par requête
const appelsHttp = [];
for (let k = 0; k < 10; k++) {
  const x = await R.passage({ source: "synchro", budgetMs: 4000, limiteMs: 9000, maintenant: () => horloge, envoyer: envoiOk, attendre: sansPause });
  appelsHttp.push(x);
  if (x.done !== false) break;
}
globalThis.fetch = rapide;
vrai("clôtures : chaque appel sous 9 s, au moins une clôture par appel", appelsHttp.every(x => x.duree_ms < 9000 && x.closes.destinataire > 0 || x.envoyes > 0), JSON.stringify(appelsHttp.map(x => [x.duree_ms, x.closes.destinataire, x.envoyes])));
eq("clôtures : toutes faites en plusieurs appels, puis l'e-mail part", [appelsHttp.reduce((n, x) => n + x.closes.destinataire, 0), mails.length, appelsHttp.length > 1], [80, 1, true]);
vrai("clôtures : chaque appel inscrit au journal", db.kv_store.filter(k => k.key.startsWith(R.PREFIXE_PASSAGE)).length === appelsHttp.length);

// ════════ 18. articles sous plusieurs CIP (groupe : en stock par une autre référence que celle de la demande) ════════
const ANCIEN = "3662050045614", NOUVEAU = "3662050099999";
initialiser({ alertes: [alerte("2000001", ANCIEN, "compte@pharmacie-a.test", 3 * J, { product_name: "FAUTEUIL (ancien CIP)" })] });
db.odoo_catalog.push({ cip: ANCIEN, name: "ACTION 2NG 40,5 CM (ancien)", in_stock: false, available: 0, list_price: 600, discounted_price: 600, discount_pct: 0 },
  { cip: NOUVEAU, name: "ACTION 2NG 40,5 CM", in_stock: true, available: 2, list_price: 620, discounted_price: 558, discount_pct: 10 });
db.kv_store.push(kvLigne(R.CLE_GROUPES, { at: iso(T0), groupes: { BR1538205: [ANCIEN, NOUVEAU] } }));
ap = await R.apercu({ maintenant: T0 });
eq("groupe : prêt à partir dans l'admin (référence servie en premier)", [ap.produits[0].pret, ap.produits[0].cip_servi, ap.produits[0].prix], [true, NOUVEAU, 558]);
mails = [];
await lance();
eq("groupe : e-mail au nom, CIP, prix et lien de la référence en stock", [mails.length, mails[0]?.html.includes(`?cip=${NOUVEAU}"`), mails[0]?.html.includes("558,00&nbsp;€"), mails[0]?.html.includes("ACTION 2NG 40,5 CM")], [1, true, true, true]);
const mq = await R.marquerRetours([{ ...ligneDe("2000001", ANCIEN) }], { maintenant: T0 + H });
eq("groupe : « De retour en stock » sur la ligne de la Saisie (CIP servi)", [mq[0].retour, mq[0].retour_cip], [true, NOUVEAU]);
eq("groupe : sans copie des groupes, règle du CIP seul (pas en stock)", (await R.marquerRetours([{ ...ligneDe("2000001", ANCIEN) }], { maintenant: T0 + H, groupes: async () => ({}) }))[0].retour, false);

// ════════ 19. envoyerResend : en-têtes, délai, classement ════════
let requete = null;
resend = async (q) => { requete = q; return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); };
let rr = await R.envoyerResend({ to: "x@y.fr", subject: "S", html: "<p>h</p>", idempotence: "restock-abc" });
const corpsResend = JSON.parse(requete.body);
eq("envoyerResend : envoyé, clé d'idempotence, délai, expéditeur et réponse", [rr.sent, rr.id, requete.headers["Idempotency-Key"], requete.signal instanceof AbortSignal, corpsResend.from, corpsResend.reply_to, corpsResend.to],
  [true, "re_1", "restock-abc", true, "Elixir Pharma <pharmacien@elixirpharma.fr>", "pharmacien@elixirpharma.fr", ["x@y.fr"]]);
resend = async () => new Response(JSON.stringify({ statusCode: 429, name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }), { status: 429 });
rr = await R.envoyerResend({ to: "x@y.fr", subject: "S", html: "h" });
eq("envoyerResend : statut et nom gardés (quota du jour → panne)", [rr.sent, rr.status, rr.name, R.classer(rr)], [false, 429, "daily_quota_exceeded", "panne"]);
resend = async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); };
rr = await R.envoyerResend({ to: "x@y.fr", subject: "S", html: "h" });
eq("envoyerResend : délai dépassé → incertain", [rr.sent, rr.ambigu, R.classer(rr), /4 s/.test(rr.reason)], [false, true, "ambigu", true]);
resend = null;
// de bout en bout : délai dépassé pendant un passage → aucun second e-mail
initialiser();
let remis = 0;
resend = async () => { remis++; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
for (let k = 0; k < 3; k++) await R.passage({ source: "planifie", maintenant: () => T0 + k * 3 * H, attendre: sansPause });
resend = null;
eq("délai dépassé de bout en bout : une seule tentative par demande, « interrompu »", [remis, ligneDe("2000001", P1).outcome, ligneDe("2000002", P1).outcome], [2, "interrompu", "interrompu"]);

// ════════ 20. notification « Retour en stock » sur le téléphone (docs/notifications.md § 9.1) ════════
// Doublure notifier(cip de la pharmacie, contenu) → { envoyes, echecs, retires, raison } ; aucune notification réelle.
{
  const pousse = (rep = { envoyes: 1, echecs: 0, retires: 0, raison: null }) => {
    const appelsPush = [];
    const f = async (cip, contenu) => { appelsPush.push({ cip, contenu, mails: mails.length }); return typeof rep === "function" ? rep(cip, contenu) : rep; };
    return { f, appelsPush };
  };
  const pushDb = () => appels.filter(a => a.url.includes("/rest/v1/push_"));

  // a. clés VAPID absentes (comme aujourd'hui) : comportement inchangé, _push.js jamais sollicité
  vrai("notification : clés VAPID absentes dans les tests existants", !R.pushDisponible());
  initialiser();
  mails = [];
  b = await lance();
  eq("sans clés VAPID : e-mails comme avant, aucune notification, aucune table push lue", [mails.length, b.envoyes, "notifications" in b, pushDb().length, "notifications" in R.chiffres(b)], [2, 2, false, 0, false]);

  // b. après chaque e-mail parti : une notification par pharmacie, produits regroupés comme l'e-mail
  initialiser();
  mails = [];
  let n = pousse({ envoyes: 2, echecs: 0, retires: 0, raison: null });
  b = await lance({ notifier: n.f });
  eq("notification : une par pharmacie servie (A puis B)", n.appelsPush.map(x => x.cip), ["2000001", "2000002"]);
  const pa = n.appelsPush[0]?.contenu, pb = n.appelsPush[1]?.contenu;
  eq("A (2 produits) : titre, texte, lien vers la Saisie, étiquette stable", [pa?.titre, pa?.corps, pa?.url, /^stock-lot-[0-9a-f]{16}$/.test(pa?.tag || "")],
    ["2 produits de retour en stock", "DOLIPRANE 1000MG CPR B/8 et VENTOLINE 100µG SUSP INH sont de nouveau disponibles chez Elixir.", "/?outil=saisie", true]);
  eq("B (1 produit) : titre, texte, lien vers le produit, étiquette à clé du produit", [pb?.titre, pb?.corps, pb?.url, /^stock-[0-9a-f]{16}$/.test(pb?.tag || "")],
    ["De retour en stock", "DOLIPRANE 1000MG CPR B/8 est de nouveau disponible chez Elixir.", `/?cip=${P1}`, true]);
  // l'étiquette sert aussi d'en-tête Topic, lu en clair par Google, Apple, Mozilla, Microsoft : jamais le CIP, ni une
  // empreinte simple (retrouvable en essayant les CIP du catalogue)
  const { createHash: hache } = await import("node:crypto");
  vrai("étiquettes : aucun CIP, aucune empreinte simple d'un CIP", [pa?.tag, pb?.tag].every(t => !t.includes(P1) && !t.includes(P2)
    && !t.includes(hache("sha256").update(P1).digest("hex").slice(0, 16)) && !t.includes(hache("sha256").update(`${P1},${P2}`).digest("hex").slice(0, 16))), `${pa?.tag} ${pb?.tag}`);
  {
    const avantCle = process.env.VAPID_PRIVATE_KEY;
    const tagAvec = (cle) => { process.env.VAPID_PRIVATE_KEY = cle; return R.contenuRetour([{ cip: P1, nom: "A" }]).tag; };
    const t1 = tagAvec("cle-privee-1"), t1bis = tagAvec("cle-privee-1"), t2 = tagAvec("cle-privee-2");
    if (avantCle === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = avantCle;
    eq("étiquette à clé : stable avec la même clé, différente avec une autre", [t1 === t1bis, t1 !== t2], [true, true]);
  }
  eq("notification lancée juste après l'e-mail de la pharmacie (avant celui de la suivante)", n.appelsPush.map(x => x.mails), [1, 2]);
  eq("bilan des notifications (nombres seulement)", b.notifications, { pharmacies: 2, servies: 2, appareils: 4, sans_appareil: 0, ecartees: 0, echecs: 0, indisponible: 0, en_retard: 0, abandonnees: 0 });
  eq("chiffres (GitHub Action, admin) : notifications comprises, ni nom ni adresse", [R.chiffres(b).notifications?.servies, /@|Pharmacie|VENTOLINE/.test(JSON.stringify(R.chiffres(b)))], [2, false]);
  vrai("journal : notifications notées, aucune adresse", (() => { const d = JSON.parse(db.kv_store.find(k => k.key === R.CLE_DERNIER).value); return d.notifications?.pharmacies === 2 && !JSON.stringify(d).includes("@"); })());
  const libres = [];
  for (const contenu of [pa, pb]) libres.push(!/€|prix|\d+,\d\d/.test(`${contenu.titre} ${contenu.corps}`));
  eq("notification : jamais de prix sur l'écran verrouillé", libres, [true, true]);
  // second passage : rien de neuf, aucune notification (jamais de doublon)
  b = await lance({ notifier: n.f });
  eq("second passage : aucune nouvelle notification", [n.appelsPush.length, "notifications" in b], [2, false]);

  // c. « deja » (Resend avait déjà l'envoi), refus, panne, débit, issue incertaine : aucune notification
  for (const [nom, envoyer] of [
    ["409 d'idempotence (« deja »)", async (m) => { mails.push(m); return { sent: false, status: 409, name: "invalid_idempotent_request", reason: "x" }; }],
    ["refus propre à la demande (422)", async () => ({ sent: false, status: 422, name: "validation_error", reason: "Invalid `to` field" })],
    ["panne générale (401)", async () => ({ sent: false, status: 401, name: "validation_error", reason: "API key is invalid" })],
    ["limite de débit (429)", async () => ({ sent: false, status: 429, name: "rate_limit_exceeded", reason: "Too many requests" })],
    ["issue incertaine (exception)", async () => { throw new Error("socket hang up"); }],
  ]) {
    initialiser();
    mails = [];
    n = pousse();
    b = await lance({ envoyer, notifier: n.f });
    eq(`${nom} : aucune notification`, [n.appelsPush.length, "notifications" in b], [0, false]);
  }

  // d. notification lente ou bloquée : les e-mails ne l'attendent jamais ; fin du passage : attente bornée
  initialiser();
  mails = [];
  const bloque = pousse(() => new Promise(() => {}));
  let t0 = Date.now();
  b = await lance({ notifier: bloque.f });
  let duree = Date.now() - t0;
  eq("notification bloquée : tous les e-mails partent, passage terminé normalement", [mails.length, b.envoyes, b.done, b.erreur, bloque.appelsPush.length], [2, 2, true, null, 2]);
  vrai(`notification bloquée : attente bornée à ${R.PUSH_ATTENTE_MS} ms (${duree} ms)`, duree >= R.PUSH_ATTENTE_MS - 50 && duree < R.PUSH_ATTENTE_MS + 1500, String(duree));
  eq("notification bloquée : comptée « en retard », jamais relancée", [b.notifications.en_retard, b.notifications.servies], [2, 0]);
  // limite de la fonction déjà atteinte (horloge du passage) : aucune attente
  initialiser();
  mails = [];
  let h = T0;
  const tardive = pousse((cip) => { if (cip === "2000002") h = T0 + 9000; return new Promise(() => {}); });
  t0 = Date.now();
  b = await R.passage({ maintenant: () => h, envoyer: envoiOk, attendre: sansPause, notifier: tardive.f, limiteMs: 9000 });
  duree = Date.now() - t0;
  vrai(`limite atteinte : aucune attente des notifications (${duree} ms)`, duree < 1000 && b.envoyes === 2 && b.notifications.en_retard === 2, `${duree} ${JSON.stringify(b.notifications)}`);
  // marge de fin : l'attente s'arrête PUSH_MARGE_FIN_MS avant la limite (fin() lit les noms et écrit le journal ensuite)
  vrai("marge de fin : 1 s", R.PUSH_MARGE_FIN_MS === 1000);
  initialiser();
  mails = [];
  h = T0;
  const presque = pousse((cip) => { if (cip === "2000002") h = T0 + 9000 - 800; return new Promise(() => {}); });
  t0 = Date.now();
  b = await R.passage({ maintenant: () => h, envoyer: envoiOk, attendre: sansPause, notifier: presque.f, limiteMs: 9000 });
  duree = Date.now() - t0;
  vrai(`limite à 800 ms : aucune attente (marge de fin), notifications comptées en retard (${duree} ms)`, duree < 500 && b.envoyes === 2 && b.notifications.en_retard === 2 && b.notifications.abandonnees === 0, `${duree} ${JSON.stringify(b.notifications)}`);
  initialiser();
  mails = [];
  h = T0;
  const milieu = pousse((cip) => { if (cip === "2000002") h = T0 + 6500; return new Promise(() => {}); });
  t0 = Date.now();
  b = await R.passage({ maintenant: () => h, envoyer: envoiOk, attendre: sansPause, notifier: milieu.f, limiteMs: 9000 });
  duree = Date.now() - t0;
  vrai(`limite à 2,5 s : attente de 1,5 s seulement (9 s − 1 s de marge − 6,5 s) (${duree} ms)`, duree >= 1450 && duree < 2300 && b.notifications.en_retard === 2, `${duree} ${JSON.stringify(b.notifications)}`);
  // bilan figé une fois rendu : une notification qui finit après la fin du passage ne change plus les chiffres
  initialiser();
  mails = [];
  h = T0;
  const finirApres = [];
  const tardives = pousse((cip) => { if (cip === "2000002") h = T0 + 9000; return new Promise(r => finirApres.push(() => r({ envoyes: 1, echecs: 0, retires: 0, raison: null }))); });
  b = await R.passage({ maintenant: () => h, envoyer: envoiOk, attendre: sansPause, notifier: tardives.f, limiteMs: 9000 });
  const figes = JSON.stringify(b.notifications), chiffresFiges = JSON.stringify(R.chiffres(b).notifications);
  finirApres.forEach(f => f());
  await new Promise(r => setTimeout(r, 20));
  eq("bilan rendu : inchangé quand les notifications en retard finissent ensuite", [JSON.stringify(b.notifications) === figes, JSON.stringify(R.chiffres(b).notifications) === chiffresFiges, b.notifications.servies, b.notifications.en_retard], [true, true, 0, 2]);
  // lente (300 ms) : l'e-mail suivant part sans l'attendre, la notification finit dans l'attente de fin
  initialiser();
  mails = [];
  const ordre = [];
  const envoiNote = async (m) => { ordre.push(`mail ${m.to.includes("pharmacie-a") ? "A" : "B"}`); return envoiOk(m); };
  const lente = pousse(async (cip) => { await new Promise(r => setTimeout(r, 300)); ordre.push(`notif ${cip === "2000001" ? "A" : "B"}`); return { envoyes: 1, echecs: 0, retires: 0, raison: null }; });
  b = await lance({ envoyer: envoiNote, notifier: lente.f });
  eq("notification lente : l'e-mail de B part avant la fin de la notification de A", ordre, ["mail A", "mail B", "notif A", "notif B"]);
  eq("notification lente : terminée pendant l'attente de fin", [b.notifications.servies, b.notifications.en_retard], [2, 0]);

  // e. notification en erreur (exception synchrone, rejet) : jamais une erreur du passage ni des e-mails
  for (const [nom, f] of [["exception synchrone", () => { throw new Error("boum"); }], ["rejet", async () => { throw new Error("module absent"); }]]) {
    initialiser();
    mails = [];
    let essais = 0;
    b = await lance({ notifier: (...a) => { essais++; return f(...a); } });
    eq(`notification en ${nom} : e-mails partis, passage sans erreur, plus d'essai ensuite`, [mails.length, b.envoyes, b.erreur, b.erreurs, essais, b.notifications.indisponible], [2, 2, null, [], 1, 1]);
  }
  // clés refusées ou tables absentes (réponse de notifierPharmacie) : plus aucun essai dans ce passage
  for (const raison of ["configuration", "schema"]) {
    initialiser();
    mails = [];
    n = pousse({ envoyes: 0, echecs: 0, retires: 0, raison });
    b = await lance({ notifier: n.f });
    eq(`notifierPharmacie « ${raison} » : une seule tentative, e-mails partis`, [n.appelsPush.length, mails.length, b.notifications.indisponible, b.erreurs], [1, 2, 1, []]);
  }
  // raisons ordinaires : comptées, sans effet sur les autres pharmacies
  initialiser();
  mails = [];
  n = pousse((cip) => ({ envoyes: 0, echecs: cip === "2000001" ? 0 : 1, retires: 0, raison: cip === "2000001" ? "fermee" : null }));
  b = await lance({ notifier: n.f });
  eq("ouverture fermée (A), échec des appareils (B) : comptés à part", [n.appelsPush.length, b.notifications.ecartees, b.notifications.echecs, b.notifications.servies], [2, 1, 1, 0]);

  // f. pharmacie à deux adresses (deux comptes, deux e-mails) : UNE notification avec tous les produits
  initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 2 * J), alerte("2000001", P2, "adjoint@pharmacie-a.test", 3 * J),
    alerte("2000002", P1, "compte@pharmacie-b.test", 3 * J)] });
  db.elixir_pharmacies.push({ email: "adjoint@pharmacie-a.test", cip: "2000001", name: "Pharmacie A" });
  mails = [];
  n = pousse();
  b = await lance({ notifier: n.f });
  // ordre des e-mails : A (adjoint, 3 j), B (3 j), A (compte, 2 j) → B notifiée tout de suite, A après son second e-mail
  eq("deux adresses pour A : trois e-mails, une notification pour B, puis une pour A (2 produits)", [mails.length, n.appelsPush.map(x => [x.cip, x.contenu.titre, x.mails])],
    [3, [["2000002", "De retour en stock", 2], ["2000001", "2 produits de retour en stock", 3]]]);
  eq("deux adresses : une seule notification pour A", n.appelsPush.filter(x => x.cip === "2000001").length, 1);
  // la seconde adresse de A attend (avertie depuis moins de 24 h) : notification de A avec le seul produit parti, en fin de passage
  initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 3 * J), alerte("2000001", P2, "adjoint@pharmacie-a.test", 2 * J)] });
  db.elixir_pharmacies.push({ email: "adjoint@pharmacie-a.test", cip: "2000001", name: "Pharmacie A" });
  db.kv_store.push(kvLigne(`${R.PREFIXE_DEST}${R.empreinteAdresse("adjoint@pharmacie-a.test")}`, { at: iso(T0 - H) }));
  mails = [];
  n = pousse();
  b = await lance({ notifier: n.f });
  eq("seconde adresse reportée : un e-mail, une notification (produit parti seulement)", [mails.length, b.reportes, n.appelsPush.length, n.appelsPush[0]?.contenu.url], [1, 1, 1, `/?cip=${P1}`]);
  eq("seconde adresse reportée : notification lancée juste après l'e-mail (jamais gardée pour une adresse qui attend)", n.appelsPush.map(x => x.mails), [1]);
  // seconde adresse reportée et limite proche : la notification n'a pas été gardée, donc jamais abandonnée
  initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 3 * J), alerte("2000001", P2, "adjoint@pharmacie-a.test", 2 * J)] });
  db.elixir_pharmacies.push({ email: "adjoint@pharmacie-a.test", cip: "2000001", name: "Pharmacie A" });
  db.kv_store.push(kvLigne(`${R.PREFIXE_DEST}${R.empreinteAdresse("adjoint@pharmacie-a.test")}`, { at: iso(T0 - H) }));
  mails = [];
  n = pousse();
  h = T0;
  const avance = async (m) => { const r = await envoiOk(m); h = T0 + 8000; return r; };   // l'e-mail laisse 1 s avant la limite
  b = await R.passage({ maintenant: () => h, envoyer: avance, attendre: sansPause, notifier: n.f, limiteMs: 9000 });
  eq("seconde adresse reportée, limite proche : notification lancée tout de suite, rien d'abandonné", [mails.length, n.appelsPush.length, n.appelsPush[0]?.mails, b.notifications?.abandonnees], [1, 1, 1, 0]);
  // seconde adresse en attente d'envoi, mais l'e-mail de la première finit après le budget de l'appel : la seconde partira
  // à l'appel suivant → notification lancée tout de suite (avant : gardée, puis abandonnée faute de temps)
  initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 3 * J), alerte("2000001", P2, "adjoint@pharmacie-a.test", 2 * J)] });
  db.elixir_pharmacies.push({ email: "adjoint@pharmacie-a.test", cip: "2000001", name: "Pharmacie A" });
  mails = [];
  n = pousse();
  h = T0;
  const lent = async (m) => { const r = await envoiOk(m); h = T0 + 7000; return r; };
  b = await R.passage({ maintenant: () => h, envoyer: lent, attendre: sansPause, notifier: n.f, budgetMs: 4000, limiteMs: 9000 });
  eq("e-mail fini après le budget : seconde adresse à l'appel suivant, notification de la première lancée tout de suite",
    [mails.length, b.done, b.restants, n.appelsPush.map(x => [x.mails, x.contenu.url]), b.notifications?.abandonnees], [1, false, 1, [[1, `/?cip=${P1}`]], 0]);
  // appel suivant : e-mail de la seconde adresse, seconde notification (une par pharmacie et par appel, documenté)
  h = T0;
  b = await R.passage({ maintenant: () => h, envoyer: envoiOk, attendre: sansPause, notifier: n.f, budgetMs: 4000, limiteMs: 9000 });
  eq("appel suivant : seconde adresse servie, seconde notification (produit de cet e-mail seulement)", [mails.length, n.appelsPush.length, n.appelsPush[1]?.contenu.url], [2, 2, `/?cip=${P2}`]);
  // notification gardée (seconde adresse encore possible dans l'appel), puis e-mail suivant refusé ET lent : limite trop
  // proche, la notification gardée est abandonnée (l'e-mail est parti, il reste la trace), jamais lancée plus tard
  initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 3 * J), alerte("2000001", P2, "adjoint@pharmacie-a.test", 2 * J)] });
  db.elixir_pharmacies.push({ email: "adjoint@pharmacie-a.test", cip: "2000001", name: "Pharmacie A" });
  mails = [];
  n = pousse();
  h = T0;
  const refusLent = async (m) => { if (m.to.startsWith("adjoint@")) { h = T0 + 8000; return { sent: false, status: 422, name: "validation_error", reason: "Invalid `to` field" }; } return envoiOk(m); };
  b = await R.passage({ maintenant: () => h, envoyer: refusLent, attendre: sansPause, notifier: n.f, limiteMs: 9000 });
  eq("gardée puis limite trop proche : notification abandonnée, e-mail de la première adresse parti", [mails.length, b.echecs, n.appelsPush.length, b.notifications?.abandonnees], [1, 1, 0, 1]);

  // g. vraie fonction (notifierPharmacie) avec des clés VAPID d'essai générées en mémoire : tables absentes, ouverture fermée,
  // aucun appareil — rien n'est envoyé à Google, Apple ni Mozilla, aucune erreur
  const webpush = (await import("web-push")).default;
  const cles = webpush.generateVAPIDKeys();
  const env0 = { ...process.env };
  Object.assign(process.env, { VAPID_PUBLIC_KEY: cles.publicKey, VAPID_PRIVATE_KEY: cles.privateKey, VAPID_SUBJECT: "mailto:pharmacien@elixirpharma.fr", SUPABASE_SERVICE_ROLE_KEY: "cle-serveur-de-test" });
  const fetchBase = globalThis.fetch;
  let tablesPush = null;   // null : tables absentes (404 PGRST205) ; sinon { push_reglages: [...], push_abonnements: [...] }
  const horsSupabase = [];
  globalThis.fetch = async (url, o = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/push_")) {
      appels.push({ url: u, methode: o.method || "GET", corps: o.body || null });
      const table = new URL(u).pathname.replace("/rest/v1/", "");
      if (!tablesPush) return reponse({ code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` }, 404);
      return reponse(tablesPush[table] ?? []);
    }
    if (!u.startsWith("https://supabase.test/") && u !== "https://api.resend.com/emails") horsSupabase.push(u);
    return fetchBase(url, o);
  };
  try {
    vrai("clés VAPID d'essai : notification possible", R.pushDisponible());
    initialiser();
    mails = [];
    b = await lance();
    // la première notification charge _push.js (web-push) : celle de B peut partir avant la réponse « tables absentes »
    eq("tables push absentes : e-mails partis, aucune erreur, notifications « indisponibles »", [mails.length, b.erreurs, b.erreur, b.notifications?.indisponible === b.notifications?.pharmacies, b.notifications?.servies], [2, [], null, true, 0]);
    vrai("tables push absentes : une lecture des réglages par notification lancée, rien d'autre", pushDb().length === b.notifications?.pharmacies && pushDb().every(a => a.url.includes("push_reglages")), JSON.stringify(pushDb().map(a => a.url)));
    initialiser();
    mails = [];
    b = await lance();
    eq("tables push absentes (module déjà chargé) : une seule tentative dans le passage", [mails.length, pushDb().length, b.notifications?.indisponible], [2, 1, 1]);
    tablesPush = { push_reglages: [] };   // aucune ligne : ouverture « fermée » par défaut
    initialiser();
    mails = [];
    b = await lance();
    eq("ouverture fermée : écartées, aucun appareil lu", [mails.length, b.notifications?.ecartees, pushDb().filter(a => a.url.includes("push_abonnements")).length], [2, 2, 0]);
    tablesPush = { push_reglages: [{ valeur: JSON.stringify({ ouverture: "toutes", pilote_cips: [], plafond_offres_7j: 2 }) }], push_abonnements: [] };
    initialiser();
    mails = [];
    b = await lance();
    eq("ouverte, aucun appareil : rien envoyé, comptées « sans appareil »", [mails.length, b.notifications?.sans_appareil, b.notifications?.servies], [2, 2, 0]);
    vrai("appareils de la pharmacie lus par son CIP (catégorie « stock » ensuite)", pushDb().some(a => a.url.includes("push_abonnements?role=eq.pharmacie&pharmacy_cip=eq.2000001")));
    eq("aucun appel hors Supabase et Resend simulés", horsSupabase, []);
  } finally {
    globalThis.fetch = fetchBase;
    for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "SUPABASE_SERVICE_ROLE_KEY"]) { if (k in env0) process.env[k] = env0[k]; else delete process.env[k]; }
  }

  // h. contenu : noms coupés, trois produits et plus, CIP illisible
  const c3 = R.contenuRetour([{ cip: P1, nom: "A" }, { cip: P2, nom: "B" }, { cip: P5, nom: "C" }, { cip: P3, nom: "D" }]);
  eq("4 produits : deux nommés et « 2 autres »", [c3.titre, c3.corps], ["4 produits de retour en stock", "A, B et 2 autres sont de nouveau disponibles chez Elixir."]);
  eq("3 produits : « 1 autre »", R.contenuRetour([{ cip: P1, nom: "A" }, { cip: P2, nom: "B" }, { cip: P5, nom: "C" }]).corps, "A, B et 1 autre sont de nouveau disponibles chez Elixir.");
  eq("étiquette d'un lot : même produits → même étiquette, quel que soit l'ordre", R.contenuRetour([{ cip: P2, nom: "B" }, { cip: P1, nom: "A" }]).tag, R.contenuRetour([{ cip: P1, nom: "A" }, { cip: P2, nom: "B" }]).tag);
  eq("nom long coupé (80 caractères)", [...R.contenuRetour([{ cip: P1, nom: "X".repeat(300) }]).corps].length, 80 + " est de nouveau disponible chez Elixir.".length);
  eq("CIP illisible : lien vers la Saisie", R.contenuRetour([{ cip: "ABC", nom: "Produit" }]).url, "/?outil=saisie");
  const { lienValide } = await import("../src/notifications/regles.js");
  eq("liens toujours admis par les règles des notifications", [lienValide(R.contenuRetour([{ cip: P1, nom: "A" }]).url), lienValide(c3.url)], [`/?cip=${P1}`, "/?outil=saisie"]);

  // i. restock-notify (GitHub Action) : notification passée par la fonction, chiffres seulement
  const { creerHandler: creerNotify } = await import("../netlify/functions/restock-notify.js");
  initialiser();
  mails = [];
  n = pousse();
  const rn = await creerNotify({ maintenant: () => T0, envoyer: envoiOk, attendre: sansPause, notifier: n.f })({ httpMethod: "GET", headers: { "x-cron-secret": "secret-cron-de-test" }, queryStringParameters: { action: "envoyer" } });
  const cn = JSON.parse(rn.body);
  eq("restock-notify : notifications dans les chiffres, ni nom ni adresse", [rn.statusCode, cn.envoyes, cn.notifications?.servies, /@|Pharmacie|DOLIPRANE/.test(rn.body)], [200, 2, 2, false]);
}

// ════════ 13. règles ════════
eq("prix net : remise, catalogue, invalides", [R.prixNet({ list_price: 20, discounted_price: 18, discount_pct: 10 }), R.prixNet({ list_price: 9.32, discounted_price: 9.32, discount_pct: 0 }),
  R.prixNet({ list_price: 0 }), R.prixNet({ list_price: null }), R.prixNet(null)], [18, 9.32, null, null, null]);
eq("fenêtre 7 h – 21 h heure de Paris (été, hiver)", [R.dansFenetre(Date.parse("2026-10-20T04:59:00Z")), R.dansFenetre(Date.parse("2026-10-20T05:00:00Z")),
  R.dansFenetre(Date.parse("2026-10-20T18:59:00Z")), R.dansFenetre(Date.parse("2026-10-20T19:00:00Z")), R.dansFenetre(Date.parse("2026-12-01T06:00:00Z"))], [false, true, true, false, true]);
eq("motif sans adresse", R.sansAdresse("Invalid to: <a.b+c@x.fr>, d@y.com"), "Invalid to: <‹adresse›>, ‹adresse›");

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
