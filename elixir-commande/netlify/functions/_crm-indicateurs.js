// Portage des règles de prep_listes.py, sans réseau ni horloge implicite.
// Les seuils et libellés sont des règles métier ; aucune cible commerciale par défaut.
const TERRITOIRE = ["75", "78", "91", "92", "93", "94", "95"];
const GL = /\b(BIOGARAN|VIATRIS|MYLAN|TEVA|ARROW|EG|ZENTIVA|SANDOZ|CRISTERS|ZYDUS|ACCORD|ALMUS|KRKA|SUN|CIPLA|BGR|EVOLUGEN|RANBAXY|ALTER|QUALIMED|RATIOPHARM|WINTHROP|ACTAVIS|PANPHARMA|SUBSTIPHARM|BIPHAR|ISOMED|NIALEX|MEDIPHA|VENIPHARM|REDDY|AUROBINDO|LUPIN|GLENMARK|TORRENT|HCS|STRAGEN|FRESENIUS|KABI|HIKMA|ZF)\b/;
const LAB_MAP = {
  "ACCORD HEALTHCARE FRANCE SAS": "ACCORD HEALTHCARE", "ACCORD HEALTHCARE LIMITED": "ACCORD HEALTHCARE",
  "BAYER HEALTHCARE": "BAYER", "BAYER HEALTHCARE SAS": "BAYER", "BAYER SANTE": "BAYER",
  "BOEHRINGER INGELHEIM FRANCE": "BOEHRINGER INGELHEIM", "BOEHRINGER INGELHEIM INTERNATIONAL GMBH": "BOEHRINGER INGELHEIM",
  "GALDERMA INTERNATIONAL": "GALDERMA", "GRIMBERG SA": "GRIMBERG", "H.A.C. PHARMA": "HAC PHARMA",
  "KRKA D.D": "KRKA", "KRKA FRANCE": "KRKA", LEO: "LEO PHARMA", "MEDAC SAS": "MEDAC",
  "NOVO NORDISK PHARMACEUTIQUE SAS": "NOVO NORDISK", "SANOFI AVENTIS FRANCE": "SANOFI",
  "SANOFI WINTHROP INDUSTRIE": "SANOFI", "TAKEDA FRANCE SAS": "TAKEDA",
};
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mediane = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 : 0; };
const obtenir = (map, k, init) => { if (!map.has(k)) map.set(k, init()); return map.get(k); };
const compter = xs => { const m = {}; for (const x of xs) m[x] = (m[x] || 0) + 1; return m; };
const propre = n => (n || "").replace(/^\[[^\]]*\]\s*/, "").trim();
export const decalerJour = (jour, n) => { const d = new Date(`${jour}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// round Python : arrondi au pair sur la valeur binaire exacte (2.675 -> 2.67).
export function arrondir(x, decimales = 0) {
  if (!Number.isFinite(x)) throw new Error("Nombre non fini dans les données");
  if (!x) return 0;
  const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, Math.abs(x));
  const bits = b.getBigUint64(0), exp = Number((bits >> 52n) & 2047n);
  let num = (bits & ((1n << 52n) - 1n)) + (exp ? 1n << 52n : 0n);
  const puissance = (exp || 1) - 1023 - 52;
  let den = 1n;
  if (puissance >= 0) num <<= BigInt(puissance); else den <<= BigInt(-puissance);
  num *= 10n ** BigInt(decimales);
  let q = num / den; const reste = num % den;
  if (reste * 2n > den || (reste * 2n === den && q % 2n)) q++;
  return (x < 0 ? -1 : 1) * Number(q) / 10 ** decimales;
}
export function calculerIndicateurs(donnees, { date, cibles, territoire = TERRITOIRE }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || decalerJour(date, 0) !== date) throw new Error("Date invalide");
  for (const k of ["fond_de_rayon", "specialites_cheres", "glp1", "seuil_demande_isolee"]) {
    if (!Number.isFinite(cibles?.[k]) || cibles[k] < 0) throw new Error("Cibles à renseigner dans les réglages CRM");
  }
  const { lignes: L, partners, produits: catalogue, taxes, sol: SOL, so, mois: MOIS } = donnees;
  const P = new Map(partners.map(p => [p.id, p])), PR = new Map(catalogue.map(p => [p.id, p]));
  const TX = new Map(taxes.map(t => [t.id, t])), SO = new Map(so.map(o => [o[0], o]));
  const W0 = decalerJour(date, -29), V0 = decalerJour(date, -59), V1 = decalerJour(date, -30);
  const moisRecent = decalerJour(`${date.slice(0, 7)}-01`, -1).slice(0, 7), terrs = new Set(territoire);
  const cip1 = p => [p?.cip, p?.ref].map(x => String(x || "").trim()).find(x => /^2\d{6}$/.test(x)) || null;
  const cp = pid => P.get(pid)?.commercial_partner_id?.[0] || pid;
  const tva = prod => (PR.get(prod)?.taxes_id || []).map(id => TX.get(id)).find(t => t?.company_id?.[0] === 2)?.amount ?? null;
  const famille = (prod, nm, pu) => {
    const n = (nm || "").toUpperCase(), t = tva(prod), head = propre(nm).toUpperCase().split(",")[0];
    if (n.includes("MOUNJARO")) return ["Mounjaro et GLP-1", "Mounjaro"];
    if (["WEGOVY", "OZEMPIC", "SAXENDA"].some(s => n.includes(s))) return ["Mounjaro et GLP-1", "Autres GLP-1"];
    if (t === 2.1 && pu >= 150) return ["Spécialités chères", "Remboursable, 150 € et plus"];
    if (t === 2.1) return ["Fond de rayon", GL.test(head) && !head.includes("(") ? "Générique" : "Remboursable, moins de 150 €"];
    return ["Fond de rayon", ({ 10: "Non remboursé (TVA 10 %)", 5.5: "TVA 5,5 %", 20: "Parapharmacie et dispositifs (TVA 20 %)" })[t] || "Autre"];
  };
  const labo = prod => { const m = PR.get(prod)?.manufacturer_id; if (!m?.[1]) return "(laboratoire non renseigné dans Odoo)"; const n = String(m[1]).replace(/[*?~]/g, " ").trim(); return LAB_MAP[n] || n; };
  const code = (prod, nm) => String(PR.get(prod)?.default_code || PR.get(prod)?.barcode || (nm || "").match(/^\[([^\]]+)\]/)?.[1] || "");
  // Département du plan, volontairement identique (la fiche CRM utilise la normalisation Corse/DOM).
  const dept = p => { const z = String(p?.zip || "").trim(); return /^\d{2}/.test(z) ? z.slice(0, 2) : String(p?.city || "").toUpperCase().startsWith("PARIS") ? "75" : ""; };
  const ca = new Map(), prev = new Map(), refs = new Map(), jours = new Map(), cips = new Map(), marges = new Map();
  for (const [d, pid, prod, pn, q, sub, cout, mt] of L) {
    const c = cip1(P.get(pid)); if (!c) continue;
    const k = cp(pid), signe = mt === "out_refund" ? -1 : 1, v = signe * sub;
    const cs = obtenir(cips, k, () => new Map()); cs.set(c, (cs.get(c) || 0) + Math.abs(v));
    if (W0 <= d && d <= date) {
      const [fam, sous] = famille(prod, pn, q ? Math.abs(sub / q) : 0);
      const key = sous === "Mounjaro" ? "mj" : sous === "Autres GLP-1" ? "glp" : fam === "Spécialités chères" ? "cher" : "fond";
      const a = obtenir(ca, k, () => ({ tot: 0, cher: 0, mj: 0, glp: 0, fond: 0 })); a[key] += v; a.tot += v;
      if (mt === "out_invoice") { obtenir(refs, k, () => new Set()).add(prod); obtenir(jours, k, () => new Set()).add(d); }
      if (cout) { const m = obtenir(marges, k, () => ({ marge: 0, ca_avec_cout: 0 })); m.marge += signe * (sub - q * cout); m.ca_avec_cout += v; }
    } else if (V0 <= d && d <= V1) prev.set(k, (prev.get(k) || 0) + v);
  }
  const premier = new Map(), parMois = new Map();
  for (const [pid, , amt, , frm] of MOIS) {
    if (!pid || !cip1(P.get(pid)) || !frm) continue;
    const k = cp(pid), m = frm.slice(0, 7);
    const mois = obtenir(parMois, k, () => new Map()); mois.set(m, (mois.get(m) || 0) + amt);
    if (amt > 0 && (!premier.has(k) || m < premier.get(k))) premier.set(k, m);
  }
  const prixObs = new Map(), nomProd = new Map(), day = new Map();
  for (const l of SOL) {
    if (!cip1(P.get(l[0])) || !l[1]) continue;
    const prod = l[1], pl = (l[6] || 0) * (1 - (l[7] || 0) / 100); nomProd.set(prod, l[2]);
    if (pl > 0) obtenir(prixObs, prod, () => []).push(pl);
    const d = SO.get(l[9])[1].slice(0, 10), k = cp(l[0]);
    const a = obtenir(day, JSON.stringify([k, prod, d]), () => ({ k, prod, mq: 0, srv: 0 }));
    a.mq = Math.max(a.mq, Math.max(0, Math.min(l[4], 200) - l[3])); a.srv += l[3];
  }
  const prix = new Map([...nomProd.keys()].map(prod => [prod, arrondir(prixObs.has(prod) ? mediane(prixObs.get(prod)) : PR.get(prod)?.list_price || 0, 2)]));
  const pp = new Map();
  for (const { k, prod, mq, srv } of day.values()) {
    const a = obtenir(pp, JSON.stringify([k, prod]), () => ({ k, prod, mq: 0, srv: 0, n: 0, ok: 0 }));
    a.mq = Math.max(a.mq, mq); a.srv += srv; a.n++; if (!mq) a.ok++;
  }
  const prodstat = new Map(), nsOff = new Map(), labOff = new Map(), nonServis = new Map();
  for (const { k, prod, mq, srv, n, ok } of pp.values()) {
    const s = obtenir(prodstat, prod, () => ({ dem: new Set(), ns: new Set(), q_ns: 0, q_srv: 0, n: 0, ok: 0 }));
    s.dem.add(k); s.q_srv += srv; s.n += n; s.ok += ok;
    if (mq > 0) {
      s.ns.add(k); s.q_ns += mq;
      const [fam] = famille(prod, nomProd.get(prod), prix.get(prod)), valeur = mq * prix.get(prod);
      const ns = obtenir(nsOff, k, () => ({})); ns[fam] = (ns[fam] || 0) + valeur;
      obtenir(labOff, labo(prod), () => new Set()).add(k);
      obtenir(nonServis, k, () => []).push({ produit_id: prod, code: code(prod, nomProd.get(prod)), nom: propre(nomProd.get(prod)), quantite: mq, prix: prix.get(prod), valeur: arrondir(valeur, 2) });
    }
  }
  const produits = [];
  for (const [prod, s] of prodstat) {
    const p = PR.get(prod) || {}, [fam, sous] = famille(prod, nomProd.get(prod), prix.get(prod));
    const conting = (p.quota || 0) > 0 && String(p.quota_period || "0") !== "0";
    const statut = !s.q_ns ? "Toujours servi" : conting ? "Contingenté par Elixir" : !s.q_srv ? "Jamais servi sur 30 jours" : "Servi par moments";
    const action = statut === "Toujours servi" ? "Maintenir le stock" : statut === "Contingenté par Elixir" ? "Demander plus d'allocation au laboratoire" :
      statut === "Jamais servi sur 30 jours" ? fam === "Spécialités chères" && s.ns.size <= 3 ? "À la commande, livraison à J+1" : "Référencer ou commander" : "Relever le stock de sécurité";
    produits.push({ code: code(prod, nomProd.get(prod)), nom: propre(nomProd.get(prod)), labo: labo(prod), famille: fam, sous,
      statut, action, prix: prix.get(prod), n_dem: s.dem.size, n_ns: s.ns.size, q_ns: s.q_ns, q_srv: s.q_srv, demandes: s.n, ok: s.ok, coeur: s.dem.size >= 20 });
  }
  const tous = new Set([...ca].filter(([, a]) => a.tot > 0).map(([k]) => k).concat([...prev].filter(([, v]) => v > 0).map(([k]) => k)));
  const mois13 = Array.from({ length: 13 }, (_, i) => { const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 12 + i); return d.toISOString().slice(0, 7); });
  const fichePharmacie = k => {
    const p = P.get(k) || {}, c = cip1(p) || [...(cips.get(k) || [])].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const a = ca.get(k) || {}, tot = a.tot || 0, actif = tot > 0, cher = a.cher || 0, mj = a.mj || 0, glp = a.glp || 0;
    const nref = refs.get(k)?.size || 0, nj = jours.get(k)?.size || 0, dp = dept(p), terr = terrs.has(dp), pr = prev.get(k) || 0;
    const profil = !actif ? "E – Sans achat depuis 30 jours" : tot < 2500 ? "D – Occasionnelle" : nref >= 100 ? "A – Panier large" : (cher + mj + glp) / tot >= 0.8 ? "B – Spécialités seules" : "C – Intermédiaire";
    const prem = premier.get(k) || "";
    const action = !terr ? "7 – Hors territoire : à décider" : !actif ? "1 – Rappeler : aucun achat depuis 30 jours" :
      pr >= 5000 && tot < 0.5 * pr ? "1 – Rappeler : achats en baisse de plus de moitié" : prem >= moisRecent ? "2 – Accueil : cliente depuis moins de deux mois" :
        profil.startsWith("B") ? "3 – Élargir le panier (spécialités seules)" : profil.startsWith("C") ? "4 – Élargir le panier et les spécialités" :
          profil.startsWith("D") ? "5 – Réveiller (moins de 2 500 € par mois)" : "6 – Entretenir et servir les demandes non servies";
    const ns = nsOff.get(k) || {}, m = marges.get(k) || { marge: 0, ca_avec_cout: 0 };
    return { id: k, nom: (p.name || "").trim(), cip: c, zip: String(p.zip || "").trim(), ville: String(p.city || "").trim().toUpperCase(),
      dept: dp, territoire: terr ? "Oui" : "Non", logiciel: "Non relevé", depuis: prem === "2025-01" ? "2025-01 ou avant" : prem, profil, action,
      ca: actif ? arrondir(tot, 2) : 0, cher: actif ? arrondir(cher, 2) : 0, mj: actif ? arrondir(mj, 2) : 0, glp: actif ? arrondir(glp, 2) : 0,
      refs: nref, jours: nj, prev: arrondir(pr, 2), ns_fond: arrondir(ns["Fond de rayon"] || 0, 2), ns_cher: arrondir(ns["Spécialités chères"] || 0, 2), ns_glp: arrondir(ns["Mounjaro et GLP-1"] || 0, 2),
      marge: arrondir(m.marge, 2), ca_avec_cout: arrondir(m.ca_avec_cout, 2), marge_taux: m.ca_avec_cout ? m.marge / m.ca_avec_cout : null,
      ca_mois: mois13.map(mois => ({ mois, ca: arrondir(parMois.get(k)?.get(mois) || 0, 2) })),
      non_servis: (nonServis.get(k) || []).sort((a, b) => b.valeur - a.valeur || a.produit_id - b.produit_id).slice(0, 30) };
  };
  const pharmacies = [...tous].map(fichePharmacie);
  // Hors des listes du plan (aucun achat sur les deux fenêtres), mais nécessaires
  // au CRM : mêmes calculs, sans modifier les totaux de référence du plan.
  const pharmacies_historiques = [...premier.keys()].filter(k => !tous.has(k)).map(fichePharmacie);
  const act = pharmacies.filter(x => x.ca > 0), params = { cible_fond: cibles.fond_de_rayon, cible_cher: cibles.specialites_cheres, cible_glp: cibles.glp1, seuil_isolee: cibles.seuil_demande_isolee, origine: cibles.origine };
  const labs = new Map();
  for (const x of produits) if (x.q_ns > 0) { const s = obtenir(labs, x.labo, () => ({ v: 0, tops: [] })); s.v += x.q_ns * x.prix; s.tops.push([x.q_ns * x.prix, x.nom]); }
  const laboratoires = [...labs].map(([nom, s]) => {
    const courts = [];
    for (const [, n] of s.tops.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))) {
      const c = n.split(/\s*\(|,\s/)[0].trim(); if (c && !courts.includes(c)) courts.push(c); if (courts.length === 3) break;
    }
    return { nom, v: arrondir(s.v, 2), n_off: labOff.get(nom).size, tops: courts.join(" ; ") };
  });
  const controle = { n_actives: act.length, ca: arrondir(sum(act.map(x => x.ca)), 2), n_sans_achat: pharmacies.length - act.length,
    profils: compter(pharmacies.map(x => x.profil)), actions: compter(pharmacies.map(x => x.action)),
    ns_total: arrondir(sum(produits.map(x => x.q_ns * x.prix)), 2), ns_oxlumo: arrondir(sum(produits.filter(x => x.nom.toUpperCase().includes("OXLUMO")).map(x => x.q_ns * x.prix)), 2),
    n_prod_ns: produits.filter(x => x.q_ns > 0).length, n_coeur: produits.filter(x => x.coeur).length,
    coeur_dem: sum(produits.filter(x => x.coeur).map(x => x.demandes)), coeur_ok: sum(produits.filter(x => x.coeur).map(x => x.ok)),
    demandes: sum(produits.map(x => x.demandes)), ok: sum(produits.map(x => x.ok)),
    pot_fond: arrondir(sum(act.map(x => Math.max(0, params.cible_fond - (x.ca - x.cher - x.mj - x.glp))))),
    pot_cher: arrondir(sum(act.map(x => Math.max(0, params.cible_cher - x.cher)))), pot_glp: arrondir(sum(act.map(x => Math.max(0, params.cible_glp - x.mj - x.glp)))),
    ns_statut: Object.fromEntries([...new Set(produits.map(x => x.statut))].map(s => [s, arrondir(sum(produits.filter(x => x.statut === s).map(x => x.q_ns * x.prix)))])),
    ns_famille: Object.fromEntries([...new Set(produits.map(x => x.famille))].map(f => [f, arrondir(sum(produits.filter(x => x.famille === f).map(x => x.q_ns * x.prix)))])),
    n_labs: laboratoires.length, params: { cible_fond: params.cible_fond, cible_cher: params.cible_cher, cible_glp: params.cible_glp } };
  let caOuvre = 0; const joursOuvres = new Set();
  for (const [d, pid, , , , sub, , mt] of L) {
    const j = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (cip1(P.get(pid)) && tous.has(cp(pid)) && W0 <= d && d <= date && j !== 0 && j !== 6) { caOuvre += (mt === "out_refund" ? -1 : 1) * sub; if (mt === "out_invoice") joursOuvres.add(d); }
  }
  const indicateurs = { date, pharmacies_actives: act.length, ca: controle.ca, ca_moyen: act.length ? controle.ca / act.length : 0,
    fond_moyen: act.length ? sum(act.map(x => x.ca - x.cher - x.mj - x.glp)) / act.length : 0, references_mediane: mediane(act.map(x => x.refs)),
    ca_jour_ouvre: joursOuvres.size ? caOuvre / joursOuvres.size : 0, part_servie: controle.demandes ? controle.ok / controle.demandes : 0,
    part_servie_coeur: controle.coeur_dem ? controle.coeur_ok / controle.coeur_dem : 0, non_servi: controle.ns_total,
    demandes_isolees: arrondir(sum(produits.filter(x => x.n_dem === 1 && x.q_ns * x.prix >= params.seuil_isolee).map(x => x.q_ns * x.prix)), 2) };
  return { pharmacies, pharmacies_historiques, produits, laboratoires, controle, indicateurs, params, periode: [W0, date], precedente: [V0, V1],
    lu_le: donnees.meta?.lu_le || date, releve_logiciels: null, codes_postaux_a_corriger: pharmacies.filter(x => !/^\d{5}$/.test(x.zip)).map(x => x.nom) };
}
