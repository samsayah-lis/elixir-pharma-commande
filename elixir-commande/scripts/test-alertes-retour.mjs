// Tests des alertes « M'avertir du retour » : node scripts/test-alertes-retour.mjs
// Hors ligne : Supabase simulé en mémoire (petit PostgREST : filtres eq/in/lt/gte/is/like, PATCH conditionnel atomique,
// upsert, colonnes absentes → 400 comme en production), e-mails capturés (aucun envoi), Supabase Auth simulé.
//  • détection : en stock ET prix net > 0 (règle de la Saisie), prix remisé, rupture et prix manquant écartés ;
//  • regroupement : un e-mail par pharmacie (plusieurs produits), une seule fois par demande ;
//  • idempotence : second passage sans e-mail ; deux passages simultanés (répétés, délais aléatoires) : chaque demande
//    avertie exactement une fois, en mode complet comme en mode réduit (sans colonnes de suivi) ;
//  • échec : réservation rendue, essais comptés (table ou kv_store), clôture « echec » au 3e ; limite de débit non comptée ;
//    exception de l'envoi ; motifs sans adresse ;
//  • demandes de plus de 60 jours closes sans e-mail ; destinataire : adresse encore compte de CE CIP, sinon close ;
//  • fenêtre 7 h – 21 h (planifié) et « Envoyer maintenant » (admin) ; budget de temps (done=false, reprise) ;
//  • envoi interrompu repéré, jamais renvoyé d'office, « Relancer » ; RESEND_API_KEY absent : rien de réservé ;
//  • e-mail : échappement HTML, lien ?cip=, prix, mention de désinscription ;
//  • restock-alert : « retour » (14 jours, en stock), sans adresse ; nouvelle demande : suivi remis à zéro, repli sans colonnes ;
//  • restock-notify : admin (aperçu sans adresse, envoyer, relancer), secret de la GitHub Action (chiffres seulement), refus ;
//  • restock-notify-cron : passage et ménage du journal.
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
let db, colonnes, delaiMax = 0, appels = [];
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
function initialiser({ complet = true, alertes } = {}) {
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
    kv_store: [],
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
eq("terminé", [b.done, b.restants, b.erreurs], [true, 0, []]);
const mailA = mails.find(m => m.to === "compte@pharmacie-a.test");
eq("A : objet au pluriel", mailA.subject, "2 produits que vous attendiez sont de retour en stock");
vrai("A : les deux produits et leurs CIP", [P1, P2, "DOLIPRANE 1000MG CPR B/8", "VENTOLINE 100µG SUSP INH"].every(x => mailA.html.includes(x)));
vrai("A : prix net de la Saisie (remisé 18,00, barré 20,00, −10 %)", mailA.html.includes("18,00&nbsp;€") && mailA.html.includes("line-through;\">20,00&nbsp;€") && mailA.html.includes("−10&nbsp;%") && mailA.html.includes("10,00&nbsp;€"));
vrai("A : lien qui ouvre le produit dans le site", mailA.html.includes(`href="https://elixir-commande.expepharma.com/?cip=${P1}"`) && mailA.html.includes(`?cip=${P2}"`));
vrai("A : nom de la pharmacie, vouvoiement, mention de désinscription",
  mailA.html.includes("Pharmacie A") && mailA.html.includes("Vous nous aviez demandé") && mailA.html.includes("Vous recevez cet e-mail parce que vous avez demandé à être averti du retour de ces produits")
  && mailA.html.includes("Pour ne plus en recevoir"));
vrai("A : charte (Inter, pétrole, or) et date du stock à l'heure de Paris", mailA.html.includes("'Inter'") && mailA.html.includes("#0f2d3d") && mailA.html.includes("#b5904a") && mailA.html.includes("20 octobre à 10&nbsp;h&nbsp;30"));
const mailB = mails.find(m => m.to === "compte@pharmacie-b.test");
eq("B : objet au singulier, produit nommé", mailB.subject, "De retour en stock : DOLIPRANE 1000MG CPR B/8");
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
const refuseB = async (m) => m.to.includes("pharmacie-b") ? { sent: false, reason: "Invalid `to` field: compte@pharmacie-b.test" } : envoiOk(m);
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
// exception levée par l'envoi
initialiser();
b = await lance({ envoyer: async (m) => { if (m.to.includes("pharmacie-a")) throw new Error("socket hang up"); return envoiOk(m); } });
eq("exception de l'envoi : traitée comme un refus (rendue, 1 essai)", [b.echecs, ligneDe("2000001", P1).notified, ligneDe("2000001", P1).attempts, ligneDe("2000001", P2).attempts], [1, false, 1, 1]);
// limite de débit : rendue SANS compter, passage interrompu
initialiser();
mails = [];
b = await lance({ envoyer: async () => ({ sent: false, reason: "Too many requests. You can only make 2 requests per second." }) });
eq("limite de débit : rien compté, reprise annoncée (done=false)", [b.echecs, b.done, b.restants, ligneDe("2000001", P1).attempts, ligneDe("2000001", P1).notified], [0, false, 2, 0, false]);
b = await lance();
eq("limite de débit : le passage suivant envoie", [b.envoyes, b.done], [2, true]);

// mode réduit : essais dans kv_store
initialiser({ complet: false });
const refuseTout = async () => ({ sent: false, reason: "HTTP 500" });
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
vrai("budget dépassé : done=false, reste annoncé", b.done === false && b.restants >= 1 && b.envoyes + b.restants === 2, JSON.stringify(R.chiffres(b)));
b = await lance();
eq("budget : l'appel suivant termine", [b.done, ligneDe("2000001", P1).outcome, ligneDe("2000002", P1).outcome], [true, "envoye", "envoye"]);

// ════════ 6. envoi interrompu, « Relancer » ════════
initialiser({ alertes: [alerte("2000001", P1, "compte@pharmacie-a.test", 2 * J, { notified: true, notified_at: iso(T0 - 20 * 60e3), outcome: "envoi" }),
  alerte("2000002", P1, "compte@pharmacie-b.test", 2 * J, { notified: true, notified_at: iso(T0 - 2 * 60e3), outcome: "envoi" })] });
mails = [];
b = await lance();
eq("réservé depuis 20 min sans compte rendu : « interrompu », pas renvoyé ; réservé depuis 2 min : intact", [b.closes.interrompu, mails.length, ligneDe("2000001", P1).outcome, ligneDe("2000002", P1).outcome], [1, 0, "interrompu", "envoi"]);
let ap = await R.apercu({ maintenant: T0 });
eq("aperçu : envoi interrompu listé (nom, sans adresse)", ap.interrompus.map(x => [x.pharmacie, x.cip]), [["Pharmacie A", P1]]);
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
vrai("échappement : nom de produit sans balise active", !h.includes("<script>") && h.includes("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; Co &quot;spécial&quot;"), h.slice(0, 200));
vrai("échappement : nom de pharmacie échappé", h.includes("L&#39;Officine &lt;b&gt;G&lt;/b&gt;") && !h.includes("<b>G</b>"));
eq("objet : texte brut sans saut de ligne", mails[0]?.subject, "De retour en stock : <script>alert('x')</script> & Co \"spécial\"");
const ex = R.emailRetour({ produits: [{ cip: "34\"><img src=x>", nom: "A", prix: 1 }] });
vrai("échappement : CIP dans le lien et le texte", !ex.html.includes("<img") && ex.html.includes("?cip=34%22%3E%3Cimg%20src%3Dx%3E"));

// ════════ 9. aperçu de l'admin ════════
initialiser();
ap = await R.apercu({ maintenant: T0 });
eq("aperçu : mode, totaux (en attente, anciennes, prêts)", [ap.mode, ap.totaux], ["complet",
  { en_attente: 7, pharmacies_en_attente: 4, anciennes: 2, alertes_pretes: 5, emails_prets: 4, produits_prets: 2 }]);
eq("aperçu : les plus attendus d'abord, puis la demande la plus ancienne", ap.produits.map(p => [p.cip, p.attente, p.pret]), [[P1, 4, true], [P2, 1, true], [P4, 1, false], [P3, 1, false]]);
eq("aperçu : plus ancienne demande et prix", [ap.produits[0].plus_ancienne, ap.produits[0].prix, ap.produits[1].prix], [iso(T0 - 4 * J), 10, 18]);
eq("aperçu : pharmacies par nom et CIP, la plus ancienne demande d'abord", ap.produits[0].pharmacies.map(x => [x.nom, x.cip]),
  [[null, "2000003"], [null, "2000006"], ["Pharmacie B", "2000002"], ["Pharmacie A", "2000001"]]);
vrai("aperçu : aucune adresse e-mail", !JSON.stringify(ap).includes("@"));
await lance();
ap = await R.apercu({ maintenant: T0 });
eq("aperçu après passage : avertis récemment avec leur issue", ap.recents.map(x => x.issue).sort(), ["ancienne", "ancienne", "destinataire", "destinataire", "envoye", "envoye", "envoye"]);
eq("aperçu après passage : journal et dernier passage", [ap.passages.length, ap.passages[0].envoyes, ap.passages[0].lignes, ap.dernier?.envoyes], [1, 2, 7, 2]);
vrai("aperçu après passage : toujours aucune adresse", !JSON.stringify(ap).includes("@"));
initialiser({ complet: false });
ap = await R.apercu({ maintenant: T0 });
eq("aperçu en mode réduit", [ap.mode, ap.interrompus], ["reduit", []]);
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
r = lit(await alerteHttp(ev("DELETE", { jeton: "jeton-a", q: { cip: P1 } })));
eq("DELETE (masquer « De retour en stock ») : demande retirée", [r.statut, !!ligneDe("2000001", P1)], [200, false]);

// ════════ 11. restock-notify (HTTP) ════════
const { creerHandler } = await import("../netlify/functions/restock-notify.js");
const notify = creerHandler({ maintenant: () => T0, envoyer: envoiOk, attendre: sansPause });
initialiser();
r = lit(await notify(ev("GET")));
eq("restock-notify GET sans jeton : 403, rien lu", [r.statut, appels.filter(a => a.url.includes("restock_alerts")).length], [403, 0]);
r = lit(await notify(ev("GET", { jeton: "jeton-a" })));
eq("restock-notify GET par une pharmacie : 403", r.statut, 403);
r = lit(await notify(ev("GET", { jeton: "jeton-admin" })));
eq("restock-notify GET admin : aperçu, sans adresse", [r.statut, r.corps.totaux?.emails_prets, JSON.stringify(r.corps).includes("@")], [200, 4, false]);
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
r = lit(await notify(ev("POST", { jeton: "jeton-admin", corps: { action: "inconnue" } })));
eq("restock-notify action inconnue : 400", r.statut, 400);
r = lit(await notify({ ...ev("POST", { jeton: "jeton-admin" }), body: "{pas du json" }));
eq("restock-notify JSON invalide : 400", r.statut, 400);

// ════════ 12. restock-notify-cron ════════
const { creerHandler: creerCron } = await import("../netlify/functions/restock-notify-cron.js");
initialiser();
db.kv_store.push({ key: `${R.PREFIXE_PASSAGE}2026-07-01T00:00:00.000Z:abcd`, value: "{}", updated_at: "2026-07-01T00:00:00.000Z" });
mails = [];
r = await creerCron({ maintenant: () => T0, envoyer: envoiOk, attendre: sansPause })();
eq("cron : passage planifié, e-mails envoyés", [r.statusCode, JSON.parse(r.body).envoyes, mails.length], [200, 2, 2]);
eq("cron : journal de plus de 60 jours effacé", db.kv_store.some(k => k.key.includes("2026-07-01")), false);

// ════════ 13. règles ════════
eq("prix net : remise, catalogue, invalides", [R.prixNet({ list_price: 20, discounted_price: 18, discount_pct: 10 }), R.prixNet({ list_price: 9.32, discounted_price: 9.32, discount_pct: 0 }),
  R.prixNet({ list_price: 0 }), R.prixNet({ list_price: null }), R.prixNet(null)], [18, 9.32, null, null, null]);
eq("fenêtre 7 h – 21 h heure de Paris (été, hiver)", [R.dansFenetre(Date.parse("2026-10-20T04:59:00Z")), R.dansFenetre(Date.parse("2026-10-20T05:00:00Z")),
  R.dansFenetre(Date.parse("2026-10-20T18:59:00Z")), R.dansFenetre(Date.parse("2026-10-20T19:00:00Z")), R.dansFenetre(Date.parse("2026-12-01T06:00:00Z"))], [false, true, true, false, true]);
eq("motif sans adresse", R.sansAdresse("Invalid to: <a.b+c@x.fr>, d@y.com"), "Invalid to: <‹adresse›>, ‹adresse›");

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
