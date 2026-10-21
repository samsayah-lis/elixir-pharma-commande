import React, { useState, useEffect, useCallback, useMemo } from "react";
import { T, R, ui, tone, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";

// ── Onglet « Péremptions » de l'admin : « Odoo facture la remise » (V1, docs/peremption-odoo.md, conception § 7) ──
// Chargé à la demande par AdminPanel (React.lazy) : hors du bundle des pharmacies. Tous les appels passent par adminFetch
// (jeton admin renouvelé) vers netlify/functions/peremption.js. Rien ne s'écrit dans Odoo depuis ce navigateur : le serveur
// applique les deux verrous (variable Netlify PEREMPTION_ODOO_ECRITURE=1 ET mode « Actif ») ; en simulation, chaque bouton
// calcule et journalise le plan, sans écriture Odoo.
// Bandeau (mode, verrous, droits Odoo, dernier passage, filet en échec, actualiser, réconcilier, tout retirer), alertes,
// compteurs, filtres, tableau par produit (faits frais : court / long / autre, prix, coût, marge, économie, ventes LGO,
// état), aperçu exact des changements dans Odoo (création ou modification, 6 listes, économie, ce que dira la facture),
// confirmation sous le coût et forçage du lot long, application en lot (40 au plus, saisie du nombre de règles), retrait
// (2 h ou tout de suite, commandes en cours affichées), journal lisible par produit, réglages, contrôle des écarts.
// Les actions longues avancent pas à pas (« etape », chaque appel sous 10 s) ; un 502 ou un 504 est réessayé.

const API = "/.netlify/functions/peremption";
const ODOO_WEB = "https://odoo.elixir-pharma.fr";
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (n == null ? "–" : fmtEur(n));
const pct = (n) => (n == null ? "–" : `${String(Number(Number(n).toFixed(1))).replace(".", ",")} %`);
const pctBrut = (n) => String(Number(Number(n).toFixed(2))).replace(".", ",");
// dates et heures à Paris (entre minuit et 2 h, l'UTC donnerait la veille)
const dateFr = (d) => {
  const s = String(d || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return `${m[3]}/${m[2]}/${m[1]}`; }
  const t = Date.parse(s.replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$|^\d{4}-\d{2}-\d{2}$/.test(s) ? "" : "Z"));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }) : "–";
};
const heureFr = (d) => { const t = Date.parse(d || ""); return Number.isFinite(t) ? new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–"; };
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

// Remise saisie : entier de 0 à 90 (0 = aucune remise : « Retirer ») ; toute autre saisie → null (refusée)
export const remiseSaisie = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 90 ? n : null;
};
// Prix habituel liste 5 d'un produit : figé à la décision s'il y en a une (les faits relus portent alors NOTRE remise),
// sinon celui des faits frais
export function habituelDe(p) {
  const fige = p?.decision?.prix_habituel;
  const v = Number(fige?.["5"] ?? fige?.[5] ?? p?.faits?.prix_listes?.["5"] ?? p?.faits?.prix_listes?.[5]);
  return Number.isFinite(v) && v > 0 ? v : null;
}
// Prix visé par une remise (aperçu du tableau ; l'aperçu du serveur fait foi) : % du prix de base, ou du prix habituel
// (habituel : figé à la décision s'il y en a une)
export function prixVise(f, remise, base = "prix_base", habituel = null) {
  const lp = Number(f?.list_price), l5 = Number(habituel ?? f?.prix_listes?.["5"] ?? f?.prix_listes?.[5]);
  if (!(remise > 0)) return null;
  if (base === "prix_liste5") return l5 > 0 ? r2(l5 * (1 - remise / 100)) : null;
  return lp > 0 ? r2(lp * (1 - remise / 100)) : null;
}
// Économie pour la pharmacie par rapport à son prix habituel (liste 5), en % (arrondi au dixième)
export const economie = (prix, habituel) => (prix > 0 && habituel > 0 ? Math.round((1 - prix / habituel) * 1000) / 10 : null);

export const ETATS = {
  facture: ["Facturé par Odoo", "ok"], en_cours: ["En cours", "info"], simule: ["Simulé", "neutral"], a_remiser: ["À remiser", "warn"],
  non_facture: ["Non facturé", "neutral"], exclu: ["Non remisable", "neutral"], court_epuise: ["Court épuisé", "neutral"], sortie_date: ["Sortie par la date", "neutral"],
  faits_absents: ["Faits à lire", "neutral"], retrait: ["Retrait en attente", "warn"], partiel: ["Partiel", "danger"], erreur: ["Erreur", "danger"], modifie_odoo: ["Modifié dans Odoo", "danger"],
  facture_site: ["Facturé, page à mettre à jour", "info"], baisse: ["Baisse en attente", "warn"],
};
const MODES = { simulation: "Simulation", actif: "Actif", creations_suspendues: "Créations suspendues" };
// ordre du tableau : ce qui demande une action d'abord
const ORDRE = ["erreur", "partiel", "modifie_odoo", "retrait", "baisse", "en_cours", "facture_site", "facture", "simule", "a_remiser", "non_facture", "exclu", "sortie_date", "court_epuise", "faits_absents"];
const RAISONS = { remise_retiree: "remise retirée", sortie_date: "sortie par la date", court_epuise: "stock court épuisé", lot_long_recu: "lot long reçu", exclu: "produit exclu",
  tout_retirer: "« Tout retirer »", refus: "refusée", fin_simulation: "fin de la simulation", regle_supprimee_odoo: "règle supprimée dans Odoo", regle_orpheline: "règle retrouvée sous une décision close" };

// ── Journal lisible (libellés, résultats, détail en phrases ; le JSON reste dans « détail technique ») ──
export const ACTIONS_JOURNAL = { creer: "Création de la règle", controler: "Contrôle du prix facturé", prix_site: "Prix du site", cacher: "Remise retirée de la page",
  retirer: "Suppression dans Odoo", adopter: "Règle retrouvée après coupure", plan: "Plan du passage", decision: "Décision", modifier: "Modification de la règle",
  relire: "Relecture de la règle", refus: "Refusé", alerte: "Alerte", resume: "Résumé de la nuit", mode: "Changement de mode", reglages: "Réglages", droits: "Droits Odoo",
  verrou: "Passage déjà en cours", essai_t1: "Essai T1 (dates)", completer: "Création à compléter", baisser: "Baisse de la remise", reverifier: "Contrôle du prix facturé", fin: "Date de fin" };
export const RESULTATS_JOURNAL = { ok: "fait", simule: "simulé", echec: "échec", reporte: "reporté", ignore: "rien fait", en_cours: "demandé", incertain: "incertain" };
export const MODES_JOURNAL = { simulation: "simulation", actif: "actif", creations_suspendues: "créations suspendues" };
export function detailJournal(l) {
  const a = l?.apres || {};
  if (l?.message) return l.message;
  if (l?.action === "controler" && a.prix_facture !== undefined) return `Liste n° ${l.pricelist_id} : facturé ${fmt(a.prix_facture)}, attendu ${fmt(a.prix_attendu)}`;
  if (a.compute_price === "percentage" && a.percent_price != null) return `Liste n° ${a.pricelist_id ?? l.pricelist_id} : remise ${pctBrut(a.percent_price)} % sur le prix de base, du ${dateFr(a.date_start)} au ${dateFr(a.date_end)}`;
  if (a.discounted_price !== undefined) return `Prix du site : ${fmt(a.discounted_price)}`;
  return "";
}

// ── Contrôle des écarts : traduction et export ──
export const FACTURATION = { invoiced: "facturée", "to invoice": "à facturer", no: "rien à facturer", upselling: "à facturer (supplément)" };
const csvCellule = (v) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function csvEcarts(lignes) {
  const tete = ["Date", "Pharmacie", "Réf. site", "Commande Odoo", "Liste", "CIP", "Produit", "Qté", "PU site", "Net Odoo", "Écart", "Pér.", "Page péremption probable", "Facturation"];
  const num = (n) => (n == null ? "" : String(n).replace(".", ","));
  return [tete, ...(lignes || []).map(l => [dateFr(l.date), l.pharmacie, l.commande, l.odoo, l.liste_nom || l.liste, l.cip, l.nom, l.qte, num(l.pn), num(l.net), num(l.ecart),
    l.peremption ? dateFr(l.peremption) : "", l.page_peremption ? "oui" : "non", FACTURATION[l.facturation] || l.facturation || ""])].map(r => r.map(csvCellule).join(";")).join("\r\n");
}

// Message de fin d'une application : noms, règles vérifiées, refus et raisons
export function texteFinLot(r, nomDe = (c) => c) {
  const res = r?.resultats || [];
  const facturees = res.filter(x => x.statut === "facturee").map(x => nomDe(x.item?.cip));
  const simulees = res.filter(x => x.simule).map(x => nomDe(x.item?.cip));
  const baisses = res.filter(x => x.baisse).map(x => nomDe(x.item?.cip));
  const partielles = res.filter(x => ["partielle", "erreur"].includes(x.statut)).map(x => nomDe(x.item?.cip));
  const erreurs = [...(r?.erreurs || [])].map(e => `${nomDe(e.cip)} (${e.erreur})`);
  const refus = (r?.refus || []).map(x => `${nomDe(x.cip)} (${x.raisons.map(y => y.texte).join(", ")})`);
  return [facturees.length ? `${facturees.join(", ")} : facturé${facturees.length > 1 ? "s" : ""} par Odoo` : "",
    simulees.length ? `${simulees.join(", ")} : simulé${simulees.length > 1 ? "s" : ""}, rien écrit dans Odoo` : "",
    baisses.length ? `${baisses.join(", ")} : baisse enregistrée, écrite dans Odoo après le délai` : "",
    partielles.length ? `${partielles.join(", ")} : partiel ou en erreur (voir le journal)` : "",
    erreurs.length ? `erreur : ${erreurs.join(" ; ")}` : "", refus.length ? `refusé : ${refus.join(" ; ")}` : ""].filter(Boolean).join(" · ");
}

export default function PeremptionsAdmin({ adminFetch }) {
  const [etat, setEtat] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);           // { ton, texte }
  const [occupe, setOccupe] = useState(null);             // texte de l'opération en cours
  const [remises, setRemises] = useState({});             // cip → saisie
  const [selection, setSelection] = useState(() => new Set());
  const [filtre, setFiltre] = useState({ etat: "", long: false, sousCout: false, exclu: false, lgo: false, texte: "" });
  const [apercu, setApercu] = useState(null);             // fenêtre d'aperçu : { donnees, cips, remise, force, sousCout, lot, confirmation, modifs }
  const [retrait, setRetrait] = useState(null);           // fenêtre de retrait : { cips, nom, toutDeSuite, lecture }
  const [toutRetirer, setToutRetirer] = useState(null);   // { saisie, lecture }
  const [journal, setJournal] = useState(null);           // { cip, lignes }
  const [panneau, setPanneau] = useState(null);           // "reglages" | "ecarts" | "alertes" | null

  const appel = useCallback(async (url, options) => {
    const res = await adminFetch(url, options);
    const corps = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(corps?.message || corps?.error || `HTTP ${res.status}`), { status: res.status });
    return corps;
  }, [adminFetch]);
  const poste = useCallback((corps) => appel(API, { method: "POST", body: JSON.stringify(corps) }), [appel]);

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null);
    try { setEtat(await appel(`${API}?action=admin`)); }
    catch (e) { setErreur(e.message); }
    finally { setChargement(false); }
  }, [appel]);
  useEffect(() => { charger(); }, [charger]);

  // passage pas à pas (chaque appel sous 10 s), jusqu'à la fin ; un 502 ou un 504 (fonction coupée) est réessayé
  const suivre = useCallback(async (r, libelle) => {
    let n = 0, cur = r, essais = 0;
    const tous = { resultats: [...(r?.resultats || [])], erreurs: [...(r?.erreurs || [])] };
    while (cur && !cur.fini && cur.passage_id !== undefined && n++ < 400) {
      setOccupe(`${libelle} : ${cur.curseur ?? 0} / ${cur.total ?? "?"}${cur.attente ? ` (${cur.attente})` : ""}${essais ? " (nouvel essai)" : ""}`);
      if (cur.attente) await attendre(3000);
      try {
        const suite = await poste({ action: "etape", passage_id: r.passage_id });
        essais = 0;
        tous.resultats.push(...(suite.resultats || [])); tous.erreurs.push(...(suite.erreurs || []));
        cur = { ...suite, passage_id: r.passage_id };
      } catch (e) {
        if (![502, 503, 504].includes(e.status) || ++essais > 5) throw e;
        await attendre(2000 * essais);
      }
    }
    return { ...cur, ...tous };
  }, [poste]);
  const nomDe = useCallback((cip) => etat?.produits?.find(p => p.cip === cip)?.nom || cip, [etat]);
  const action = async (libelle, fn) => {
    setOccupe(libelle); setMessage(null);
    try {
      const r = await fn();
      if (r?.erreur) setMessage({ ton: "danger", texte: r.erreur });
      else { const t = texteFinLot(r, nomDe); setMessage({ ton: (r?.erreurs || []).length ? "warn" : "ok", texte: `${libelle} : terminé${t ? ` · ${t}` : ""}${r?.corrections?.length ? ` · ${r.corrections.map(c => `${c.libelle} : ${JSON.stringify(c.saisi)} hors limites, gardé à ${JSON.stringify(c.garde)}`).join(" ; ")}` : ""}` }); }
    }
    catch (e) { setMessage({ ton: "danger", texte: `${libelle} : ${e.message}` }); }
    finally { setOccupe(null); await charger(); }
  };

  // « Actualiser depuis Odoo » : synchro des péremptions (odoo-expiry-sync), puis faits frais de la page
  const actualiser = () => action("Actualiser depuis Odoo", async () => {
    let offset = 0, garde = 0;
    while (garde++ < 400) {
      const res = await adminFetch(`/.netlify/functions/odoo-expiry-sync?offset=${offset}`);
      if (!res.ok) break;
      const d = await res.json();
      setOccupe(`Péremptions : ${offset + (d.batch_size || 0)} / ${d.total_in_stock || "?"}`);
      if (d.error || d.done || !d.next_offset) break;
      offset = d.next_offset;
    }
    let off = 0; garde = 0;
    while (off != null && garde++ < 100) { const f = await poste({ action: "faits", offset: off }); setOccupe(`Faits frais : ${f.lus} / ${f.total}`); off = f.next_offset; }
    return {};
  });
  const reconcilier = () => action("Réconcilier maintenant", async () => { const r = await poste({ action: "reconcilier" }); return r.fini ? r : suivre(r, "Réconciliation"); });
  const controlerDroits = () => action("Droits Odoo", async () => { const d = await appel(`${API}?action=droits`); return d.ok ? {} : { erreur: `Droits Odoo incomplets : ${texteDroits(d)}` }; });
  const changerMode = (mode) => {
    const n = etat?.compteurs?.facturees || 0, s = etat?.compteurs?.simulees || 0;
    const textes = {
      actif: `Passer en mode « Actif » : les décisions créeront, modifieront et supprimeront des règles dans Odoo.${s ? `\n\nLes ${s} décision(s) simulée(s) seront closes (rien n'a été écrit dans Odoo) : il faudra les réappliquer une par une ou en lot, avec un nouvel aperçu. Notez la liste des produits « Simulé » avant de continuer.` : ""}\n\nContinuer ?`,
      simulation: `Repasser en simulation : plus aucune écriture dans Odoo, pas même les suppressions.${n ? `\n\nLes ${n} remise(s) facturée(s) restent annoncées sur la page et facturées par Odoo ; leur retrait dans Odoo ne se fera plus avant leur date de fin (si Odoo respecte les dates : essai T1 à prouver). Pour arrêter la facturation : « Retirer toutes les règles du site » AVANT de repasser en simulation.` : ""}\n\nContinuer ?`,
      creations_suspendues: "Suspendre les créations : plus aucune création ni hausse de remise ; les retraits et les baisses continuent. Continuer ?" };
    if (!window.confirm(textes[mode])) return;
    action(`Mode « ${MODES[mode]} »`, () => poste({ action: "mode", mode, confirmation: true }));
  };
  const ouvrirApercu = async (cips, remise, { force = {}, sousCout = {}, lot = false } = {}) => {
    setOccupe("Aperçu : lecture d'Odoo"); setMessage(null);
    try {
      const d = await poste({ action: "apercu", cips, remise_pct: remise, force_lot_long: force, sous_cout_confirme: sousCout });
      setApercu({ donnees: d, cips, remise, force, sousCout, lot, confirmation: "", modifs: false });
    } catch (e) { setMessage({ ton: "danger", texte: `Aperçu : ${e.message}` }); }
    finally { setOccupe(null); }
  };
  const appliquer = async () => {
    const a = apercu;
    const ok = a.donnees.produits.filter(p => applicable(p, a));
    if (!ok.length) return;
    setApercu(null);
    if (a.lot) setSelection(new Set());
    await action(a.lot ? "Application en lot" : ok[0]?.type === "modifier" ? "Modifier la remise" : "Appliquer dans Odoo", async () => {
      const r = await poste({ action: "appliquer", cips: ok.map(p => p.cip), remise_pct: a.remise, apercus: Object.fromEntries(ok.map(p => [p.cip, p.apercu_id])),
        sous_cout_confirme: Object.fromEntries(ok.filter(p => a.sousCout[p.cip]).map(p => [p.cip, true])),
        force_lot_long: Object.fromEntries(ok.filter(p => a.force[p.cip] != null).map(p => [p.cip, a.force[p.cip]])),
        ...(ok.length > 1 ? { confirmation_regles: Number(a.confirmation) } : {}) });
      if (r.erreur) return r;
      return { ...(await suivre(r, "Application")), refus: r.refus };
    });
  };
  const lireRetrait = useCallback(async (cips) => appel(`${API}?action=retrait_apercu${cips ? `&cips=${cips.join(",")}` : ""}`).catch(e => ({ erreur: e.message })), [appel]);
  const ouvrirRetrait = async (cips, nom, toutDeSuite = false) => { setRetrait({ cips, nom, toutDeSuite, lecture: null }); const lecture = await lireRetrait(cips); setRetrait(x => (x ? { ...x, lecture } : x)); };
  const ouvrirToutRetirer = async () => { setToutRetirer({ saisie: "", lecture: null }); const lecture = await lireRetrait(null); setToutRetirer(x => (x ? { ...x, lecture } : x)); };
  const retirer = async () => {
    const r0 = retrait; setRetrait(null);
    if (r0.cips.length > 1) setSelection(new Set());
    await action("Retirer", async () => { const r = await poste({ action: "retirer", cips: r0.cips, tout_de_suite: !!r0.toutDeSuite }); return suivre(r, "Retrait"); });
  };
  const reessayer = (cip) => action("Réessayer", async () => { const r = await poste({ action: "reessayer", cip }); return r.erreur ? r : suivre(r, "Réessai"); });
  const confirmerToutRetirer = async () => {
    const c = toutRetirer?.saisie; setToutRetirer(null);
    await action("Retirer toutes les règles du site", async () => { const r = await poste({ action: "tout_retirer", confirmation: c }); return suivre(r, "Suppressions dans Odoo"); });
  };
  const voirJournal = async (cip) => {
    if (journal?.cip === cip) { setJournal(null); return; }
    try { setJournal({ cip, lignes: (await appel(`${API}?action=journal${cip ? `&cip=${cip}` : ""}&limit=100`)).lignes }); }
    catch (e) { setMessage({ ton: "danger", texte: `Journal : ${e.message}` }); }
  };

  const R0 = etat?.reglages;
  const produits = useMemo(() => {
    if (!etat) return [];
    const t = filtre.texte.trim().toLowerCase();
    return etat.produits.filter(p => {
      const f = p.faits;
      const r = remiseSaisie(remises[p.cip] ?? p.decision?.remise_pct ?? "");
      const pv = r ? prixVise(f, r, p.decision?.apercu?.base || R0?.base_remise, habituelDe(p)) : null;
      if (filtre.etat && p.etat !== filtre.etat) return false;
      if (filtre.long && !((f?.long_qte || 0) + (f?.autre_qte || 0) > 0)) return false;
      if (filtre.sousCout && !(pv != null && Number(f?.cout) > 0 && pv < Number(f.cout))) return false;
      if (filtre.exclu && !(f?.exclusions || []).length) return false;
      if (filtre.lgo && !(f?.ventes_30j?.lgo > 0)) return false;
      if (t && !String(p.nom).toLowerCase().includes(t) && !p.cip.includes(t)) return false;
      return true;
    }).sort((a, b) => (ORDRE.indexOf(a.etat) - ORDRE.indexOf(b.etat)) || String(a.faits?.court_fin || a.catalogue?.earliest_expiry || "9").localeCompare(String(b.faits?.court_fin || b.catalogue?.earliest_expiry || "9")));
  }, [etat, filtre, remises, R0]);
  // « Tout sélectionner » : seulement les produits sans décision ouverte et remisables (pas une modification d'office)
  const selectionnables = useMemo(() => produits.filter(p => !p.decision && !(p.faits?.exclusions || []).length), [produits]);

  if (chargement && !etat) return <div style={{ ...ui.card, padding: 40, textAlign: "center", color: T.inkMute }}>Chargement de l'onglet Péremptions…</div>;
  if (erreur && !etat) {
    return (
      <div style={{ ...ui.card }}>
        <div role="alert" style={{ ...encart("danger") }}><Icone nom="alerte" taille={16} /><span>Onglet Péremptions indisponible : {erreur}.
          {/non_install|SERVICE_ROLE|peremption_reglages|mise en service/i.test(erreur) ? " La mise en service n'est pas faite : tables Supabase et clé serveur (procédure de mise en service, étapes 1 et 2)." : ""}</span></div>
        <button onClick={charger} className="ex-btn-ligne" style={{ ...ui.btn("ligne", "s"), marginTop: 12 }}><Icone nom="actualiser" taille={14} />Réessayer</button>
      </div>
    );
  }
  const v = etat.verrous, c = etat.compteurs, dernier = etat.passages?.[0];
  const droitsOk = R0?.droits?.ok;
  const actifSansEffet = R0.mode === "actif" && !v.variable;
  const surPrixHabituel = R0.base_remise === "prix_liste5";

  return (
    <div className="ex-peremptions-admin">
      {/* ── Bandeau ── */}
      <div style={{ ...ui.card, marginBottom: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>Péremption courte · Odoo facture la remise</div>
            <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>Fenêtre de la page : du {dateFr(etat.fenetre?.min)} au {dateFr(etat.fenetre?.max)} · état lu à {heureFr(etat.maj)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ex-btn-ligne" disabled={!!occupe} onClick={actualiser} style={btnL}><Icone nom="actualiser" taille={14} />Actualiser depuis Odoo</button>
            <button className="ex-btn-ligne" disabled={!!occupe} onClick={reconcilier} style={btnL}><Icone nom="balance" taille={14} />Réconcilier maintenant</button>
            <button disabled={!!occupe} onClick={ouvrirToutRetirer} style={{ ...ui.btn("danger", "s") }}><Icone nom="corbeille" taille={14} />Retirer toutes les règles du site</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          <Tuile titre="Mode" ton={actifSansEffet ? "warn" : R0.mode === "actif" ? "ok" : R0.mode === "simulation" ? "neutral" : "warn"}>
            <div style={{ fontWeight: 800 }}>{actifSansEffet ? "Actif, sans effet" : MODES[R0.mode]}</div>
            {actifSansEffet && <div style={{ fontSize: 11, marginTop: 2 }}>variable Netlify absente : rien ne s'écrit dans Odoo</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {Object.keys(MODES).filter(m => m !== R0.mode).map(m => (
                <button key={m} disabled={!!occupe || (m === "actif" && !v.variable)} onClick={() => changerMode(m)} title={m === "actif" && !v.variable ? "Variable Netlify PEREMPTION_ODOO_ECRITURE=1 absente" : undefined}
                  style={{ ...ui.btn("ligne", "s"), height: 26, fontSize: 11, opacity: m === "actif" && !v.variable ? 0.5 : 1 }}>{MODES[m]}</button>
              ))}
            </div>
          </Tuile>
          <Tuile titre="Écriture Odoo" ton={v.creation ? "ok" : v.retrait ? "warn" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{v.creation ? "Créations et retraits" : v.retrait ? "Retraits seulement" : "Aucune"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Variable Netlify : {v.variable ? "présente" : v.contexte ? `ignorée (déploiement « ${v.contexte} »)` : "absente"} · mode : {MODES[R0.mode]}</div>
          </Tuile>
          <Tuile titre="Droits Odoo" ton={droitsOk ? "ok" : R0.droits ? "danger" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{R0.droits ? (droitsOk ? "OK" : "KO") : "Pas encore contrôlés"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{R0.droits?.compte ? `Compte du site : ${R0.droits.compte.login}` : "Compte du site : ?"}{R0.droits?.at ? ` · ${heureFr(R0.droits.at)}` : ""}</div>
            <button disabled={!!occupe} onClick={controlerDroits} style={{ ...ui.btn("ligne", "s"), height: 26, fontSize: 11, marginTop: 6 }}>Contrôler (lecture seule)</button>
          </Tuile>
          <Tuile titre="Filet Odoo (dates)" ton={R0.filet_dates_odoo === "oui" ? "ok" : R0.filet_dates_odoo === "non" ? "danger" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{{ oui: "Oui (essai T1)", non: "Non : filet horaire seul", a_prouver: "À prouver (essai T1)" }[R0.filet_dates_odoo]}</div>
          </Tuile>
          <Tuile titre="Dernier passage" ton={dernier?.statut === "fini" ? "ok" : dernier?.statut === "erreur" ? "danger" : dernier?.statut === "verrou" ? "warn" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{dernier ? `${heureFr(dernier.debut)} · ${ACTEURS[dernier.acteur] || dernier.acteur}` : "Aucun"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{dernier ? `${STATUTS_PASSAGE[dernier.statut] || dernier.statut || "en cours"}${dernier.resume?.disjoncteur ? ` · disjoncteur : ${dernier.resume.disjoncteur}` : ""}` : ""}</div>
            {etat.resume_nuit && <div style={{ fontSize: 11, marginTop: 4 }} title={etat.resume_nuit.apres?.texte}>{etat.resume_nuit.message} ({heureFr(etat.resume_nuit.at)})</div>}
            <button onClick={() => voirJournal(null)} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal, marginTop: 6 }}>Journal complet</button>
          </Tuile>
        </div>
        {(!v.creation) && (
          <div role="note" style={encart(c.facturees ? "warn" : "info")}><Icone nom="horloge" taille={16} /><span>
            <strong>Aucune écriture dans Odoo</strong> ({actifSansEffet ? "mode Actif, mais variable Netlify absente" : v.retrait ? "créations suspendues : seuls les retraits et les baisses s'écrivent" : `mode ${MODES[R0.mode]}${v.variable ? "" : ", variable Netlify absente"}`}). Les boutons
            calculent et journalisent les changements exacts{v.retrait ? "" : " ; les suppressions sont simulées"}.
            {c.facturees ? ` ${c.facturees} remise(s) déjà posée(s) restent facturées par Odoo et annoncées sur la page jusqu'à leur retrait ou leur date de fin.` : " La page des pharmacies n'annonce aucune remise."}</span></div>
        )}
        {etat.filet?.echec_depuis && <div role="alert" style={encart("danger")}><Icone nom="alerte" taille={16} /><span><strong>Filet horaire en échec depuis {heureFr(etat.filet.echec_depuis)}</strong> : {etat.filet.erreur || "voir le journal"}. Les retraits automatiques (date, stock) ne se font pas tant que l'erreur dure.</span></div>}
        {etat.verrou && <div role="status" style={encart("warn")}><Icone nom="cadenas" taille={16} /><span>Un passage est en cours ({ACTEURS[etat.verrou.acteur] || etat.verrou.acteur}) : les actions attendent qu'il finisse.</span></div>}
        {occupe && <div role="status" style={encart("info")}><Icone nom="horloge" taille={16} /><span>{occupe}…</span></div>}
        {message && <div role={message.ton === "danger" ? "alert" : "status"} style={encart(message.ton)}><Icone nom={message.ton === "danger" ? "alerte" : "coche"} taille={16} /><span>{message.texte}</span></div>}
      </div>

      {/* ── Alertes (7 jours ; le résumé de la nuit est dans la tuile « Dernier passage ») ── */}
      {etat.alertes?.length > 0 && (
        <div style={{ ...ui.card, marginBottom: 14, borderColor: tone("warn").border }}>
          <button onClick={() => setPanneau(panneau === "alertes" ? null : "alertes")} style={{ ...ui.btn("lien"), color: T.warn, fontWeight: 700 }}>
            {etat.alertes.length} alerte{etat.alertes.length > 1 ? "s" : ""} sur 7 jours {panneau === "alertes" ? "▴" : "▾"}</button>
          {panneau === "alertes" && <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, color: T.inkSoft, display: "grid", gap: 6 }}>
            {etat.alertes.map((a, i) => <li key={i}><strong>{heureFr(a.at)}</strong> · {a.message}{a.resultat === "simule" ? " (e-mail non envoyé : verrous fermés)" : ""}<div style={{ color: T.inkMute }}>{a.apres?.texte}</div></li>)}
          </ul>}
        </div>
      )}

      {/* ── Compteurs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Compteur libelle="Produits sur la page" valeur={c.visibles ?? c.page} detail={c.masques ? `${c.masques} sans boîte courte masqué${c.masques > 1 ? "s" : ""}` : undefined} />
        <Compteur libelle="Facturés par Odoo" valeur={c.facturees} ton="ok" onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "facture" ? "" : "facture" }))} actif={filtre.etat === "facture"} />
        <Compteur libelle="Non facturés" valeur={c.non_facturees} detail={`dont ${c.a_remiser} à remiser`} />
        <Compteur libelle="À remiser (proposés)" valeur={c.a_remiser} ton="warn" onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "a_remiser" ? "" : "a_remiser" }))} actif={filtre.etat === "a_remiser"} />
        <Compteur libelle="En cours" valeur={c.en_cours ?? 0} ton={c.en_cours ? "info" : undefined} />
        <Compteur libelle="En retrait" valeur={c.en_retrait} onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "retrait" ? "" : "retrait" }))} actif={filtre.etat === "retrait"} />
        <Compteur libelle="En erreur" valeur={c.en_erreur} ton={c.en_erreur ? "danger" : undefined} />
        {c.simulees > 0 && <Compteur libelle="Simulés" valeur={c.simulees} onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "simule" ? "" : "simule" }))} actif={filtre.etat === "simule"} />}
        <Compteur libelle="Perte prévue (stock court facturé, faits du jour)" valeur={fmt(c.perte_prevue)} detail={`valeur au coût : ${fmt(c.valeur_court_cout)}`} ton={c.perte_prevue > 0 ? "danger" : undefined} />
      </div>

      {/* ── Filtres et application en lot ── */}
      <div style={{ ...ui.card, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filtre.texte} onChange={e => setFiltre(f => ({ ...f, texte: e.target.value }))} placeholder="Nom ou CIP…" aria-label="Filtrer par nom ou CIP" style={{ ...ui.input, width: 200, minHeight: 34, padding: "6px 10px", fontSize: 13 }} />
        <select value={filtre.etat} onChange={e => setFiltre(f => ({ ...f, etat: e.target.value }))} aria-label="Filtrer par état" style={{ ...ui.input, width: 200, minHeight: 34, padding: "6px 10px", fontSize: 13 }}>
          <option value="">Tous les états</option>
          {Object.entries(ETATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {[["long", "Lot long"], ["sousCout", "Sous le coût"], ["exclu", "Exclu"], ["lgo", "Vendu par LGO"]].map(([k, l]) => (
          <label key={k} style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={filtre[k]} onChange={e => setFiltre(f => ({ ...f, [k]: e.target.checked }))} />{l}</label>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.inkMute }}>{produits.length} produit{produits.length > 1 ? "s" : ""} affiché{produits.length > 1 ? "s" : ""}</span>
        {selection.size > 0 && <LotBar n={selection.size} max={R0.plafond_produits_par_lot} occupe={!!occupe} mode={R0.mode} creation={v.creation}
          onAppliquer={(r) => ouvrirApercu([...selection], r, { lot: true })} onRetirer={() => ouvrirRetrait([...selection], `${selection.size} produits`)} onVider={() => setSelection(new Set())} />}
      </div>

      {/* ── Tableau par produit ── */}
      <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, overflowX: "auto", boxShadow: T.shadow1 }}>
        <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: T.ink }}>
          <thead><tr>
            <th style={th}><input type="checkbox" aria-label="Tout sélectionner (produits sans décision)" title="Produits sans décision ouverte seulement (une modification se fait produit par produit)"
              checked={selectionnables.length > 0 && selectionnables.every(p => selection.has(p.cip))}
              onChange={e => setSelection(e.target.checked ? new Set(selectionnables.slice(0, R0.plafond_produits_par_lot).map(p => p.cip)) : new Set())} /></th>
            {["Produit (CIP)", "Lot court · fin de page", "Court / long / autre", "Prix de base · habituel L5 · coût", surPrixHabituel ? "Remise % (sur prix habituel L5)" : "Remise % (sur prix de base, comme la facture)", "Prix péremption L5 · économie · marge", "Ventes 30 j (LGO)", "État", "Action"].map(h =>
              <th key={h} style={{ ...th, textAlign: h.startsWith("Prix") ? "right" : "left", whiteSpace: "normal" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {produits.map(p => <Ligne key={p.cip} p={p} R0={R0} v={v} occupe={!!occupe} selection={selection} setSelection={setSelection} remise={remises[p.cip]}
              setRemise={(x) => setRemises(m => ({ ...m, [p.cip]: x }))} onApercu={(r) => ouvrirApercu([p.cip], r)} onRetirer={() => ouvrirRetrait([p.cip], p.nom, p.decision?.statut === "retrait_demande")}
              onReessayer={() => reessayer(p.cip)} onJournal={() => voirJournal(p.cip)} journal={journal?.cip === p.cip ? journal.lignes : null} />)}
            {!produits.length && <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: T.inkMute }}>Aucun produit pour ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>
      {journal && journal.cip === null && <Journal lignes={journal.lignes} titre="Journal complet (100 dernières lignes)" onFermer={() => setJournal(null)} />}

      {/* ── Réglages et contrôle des écarts ── */}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button className="ex-btn-ligne" onClick={() => setPanneau(panneau === "reglages" ? null : "reglages")} style={btnL}><Icone nom="regle" taille={14} />Réglages {panneau === "reglages" ? "▴" : "▾"}</button>
        <button className="ex-btn-ligne" onClick={() => setPanneau(panneau === "ecarts" ? null : "ecarts")} style={btnL}><Icone nom="document" taille={14} />Contrôle des écarts (factures passées) {panneau === "ecarts" ? "▴" : "▾"}</button>
      </div>
      {panneau === "reglages" && <Reglages key={R0.updated_at || "r"} R0={R0} occupe={!!occupe} onEnregistrer={(valeurs) => action("Réglages", () => poste({ action: "reglages", valeurs }))} />}
      {panneau === "ecarts" && <Ecarts appel={appel} />}

      {apercu && <Apercu a={apercu} setA={setApercu} R0={R0} v={v} occupe={!!occupe} onAppliquer={appliquer}
        onForcer={(cip, n) => ouvrirApercu(apercu.cips, apercu.remise, { force: { ...apercu.force, [cip]: n }, sousCout: apercu.sousCout, lot: apercu.lot })} />}
      {retrait && (
        <Fenetre titre={`Retirer la remise : ${retrait.nom}`} onFermer={() => setRetrait(null)}>
          <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 10px" }}>La page cesse aussitôt d'annoncer la remise et le site reprend le prix habituel. La règle est supprimée dans
            Odoo au premier passage après {R0.delai_retrait_min} min (passage toutes les heures à h:25), ou plus tard si des commandes en cours d'import contiennent ce produit.</p>
          {!v.retrait && <VerrousFermes />}
          <LectureRetrait lecture={retrait.lecture} />
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}><input type="checkbox" checked={!!retrait.toutDeSuite} onChange={e => setRetrait(x => ({ ...x, toutDeSuite: e.target.checked }))} />
            <span>Tout de suite : supprimer dans Odoo sans attendre. Les commandes du site ci-dessus, pas encore importées, seront facturées au prix habituel (l'équipe reçoit la liste).</span></label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button onClick={() => setRetrait(null)} style={ui.btn("ligne", "s")}>Annuler</button>
            <button onClick={retirer} style={ui.btn("danger", "s")}>Retirer</button>
          </div>
        </Fenetre>
      )}
      {toutRetirer != null && (
        <Fenetre titre="Retirer toutes les règles du site" onFermer={() => setToutRetirer(null)} garder={!!toutRetirer.saisie}>
          {!toutRetirer.lecture ? <p style={{ fontSize: 13, color: T.inkMute }}>Lecture des décisions et des commandes en cours…</p> : toutRetirer.lecture.erreur ? <div style={encart("danger")}><Icone nom="alerte" taille={14} /><span>{toutRetirer.lecture.erreur}</span></div> : (
            <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 10px" }}><strong>{toutRetirer.lecture.decisions}</strong> décision(s) ouverte(s) ({Object.entries(toutRetirer.lecture.par_statut || {}).map(([k, n]) => `${n} ${STATUTS_DECISION[k] || k}`).join(", ") || "aucune"}),
              <strong> {toutRetirer.lecture.regles}</strong> règle(s) dans Odoo sur {toutRetirer.lecture.produits_avec_regles} produit(s){toutRetirer.lecture.reservees ? ` (+ ${toutRetirer.lecture.reservees} réservée(s) sans identifiant)` : ""}.
              La page n'annonce plus aucune remise dès la confirmation ; puis les règles posées par le site (et seulement elles) sont supprimées dans Odoo, sans délai ni attente des commandes, produit par produit (si cette page se ferme, le filet termine dans le quart d'heure).</p>
          )}
          {!v.retrait && <VerrousFermes />}
          <LectureRetrait lecture={toutRetirer.lecture} />
          <label style={{ ...ui.label, marginTop: 10 }}>Saisir RETIRER pour confirmer</label>
          <input value={toutRetirer.saisie} onChange={e => setToutRetirer(x => ({ ...x, saisie: e.target.value }))} aria-label="Confirmation RETIRER" style={{ ...ui.input, width: 220 }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button onClick={() => setToutRetirer(null)} style={ui.btn("ligne", "s")}>Annuler</button>
            <button disabled={toutRetirer.saisie !== "RETIRER"} onClick={confirmerToutRetirer} style={{ ...ui.btn("danger", "s"), opacity: toutRetirer.saisie === "RETIRER" ? 1 : 0.5 }}>Tout retirer</button>
          </div>
        </Fenetre>
      )}
    </div>
  );
}
const ACTEURS = { filet: "filet horaire", nuit: "nuit", automatique: "remise automatique" };
const STATUTS_PASSAGE = { fini: "fini", en_cours: "en cours", erreur: "en échec", verrou: "rien fait (autre passage en cours)" };
const STATUTS_DECISION = { voulue: "en cours", partielle: "partielle(s)", facturee: "facturée(s)", retrait_demande: "en retrait", erreur: "en erreur", modifiee_odoo: "modifiée(s) dans Odoo", simulee: "simulée(s)" };
const ETATS_COMMANDE = { a_envoyer: "à envoyer", prise: "en cours d'envoi", incertaine: "envoi à vérifier", import_en_attente: "envoyée, pas encore importée", commande_non_envoyee: "pas encore envoyée" };

function VerrousFermes() {
  return <div role="alert" style={{ ...encart("danger"), marginBottom: 10 }}><Icone nom="alerte" taille={16} /><span><strong>Verrous fermés</strong> (mode Simulation ou variable Netlify absente) : la page cesse
    d'annoncer, mais les règles RESTENT dans Odoo et continuent d'être facturées. Rouvrir la variable (puis redéployer) avant de retirer, ou supprimer les règles à la main dans Odoo.</span></div>;
}
function LectureRetrait({ lecture }) {
  if (!lecture || lecture.erreur) return null;
  if (lecture.commandes_erreur) return <div style={{ ...encart("warn"), marginBottom: 6 }}><Icone nom="alerte" taille={14} /><span>Commandes en cours illisibles ({lecture.commandes_erreur}) : sans « Tout de suite », la suppression attend.</span></div>;
  if (!lecture.commandes?.length) return <div style={{ fontSize: 12, color: T.inkMute }}>Aucune commande du site en cours d'import avec ces produits.</div>;
  return (
    <div style={{ fontSize: 12, color: T.inkSoft }}><strong>Commandes du site en cours d'import avec ces produits</strong> ({lecture.commandes.length}) :
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{lecture.commandes.slice(0, 12).map(cm => <li key={cm.ref}>{cm.ref}{cm.pharmacie ? ` · ${cm.pharmacie}` : ""} · {ETATS_COMMANDE[cm.etat] || cm.etat} · CIP {cm.cips.join(", ")}</li>)}</ul></div>
  );
}

// Un produit de l'aperçu est-il applicable (raisons restantes levées par les cases cochées) ?
function applicable(p, a) {
  if (!p.apercu_id || !["creer", "modifier"].includes(p.type || "creer")) return false;
  if (p.eligibilite?.ok) return true;
  return (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout" && a.sousCout[p.cip]);
}
function texteDroits(d) {
  const ko = [...Object.entries(d.modele || {}).filter(([, x]) => x !== true).map(([k]) => `règles de prix : ${k}`), ...Object.entries(d.regle || {}).filter(([, x]) => x !== true).map(([k, x]) => `${k} (${x})`)];
  if (!d.compte?.societe_elixir) ko.push("société Elixir non autorisée pour le compte du site");
  return ko.join(", ") || "inconnu";
}

// ── Ligne du tableau ──
function Ligne({ p, R0, v, occupe, selection, setSelection, remise, setRemise, onApercu, onRetirer, onReessayer, onJournal, journal }) {
  const f = p.faits, d = p.decision;
  const saisie = remise ?? (d ? String(d.modification?.baisse ? d.modification.remise : d.remise_pct) : "");
  const r = remiseSaisie(saisie);
  const habituel = habituelDe(p);
  const base = d?.apercu?.base || R0.base_remise;
  // remise appliquée : prix attendu de la décision (baisse en attente : celui de la nouvelle remise) ; saisie : prix visé
  const attendu = d?.modification?.baisse ? d.modification.prix_attendu : d?.prix_attendu;
  const prixPer = d && remise == null && attendu ? Number(attendu["5"] ?? attendu[5]) : r ? prixVise(f, r, base, habituel) : null;
  const cout = Number(f?.cout) > 0 ? Number(f.cout) : null;
  const marge = prixPer && cout ? ((prixPer - cout) / prixPer) * 100 : null;
  const eco = economie(prixPer, habituel);
  // « sans effet » : seulement pour une saisie pas encore appliquée (une remise facturée a déjà été contrôlée)
  const sansEffet = remise != null && prixPer != null && habituel > 0 && prixPer > r2(habituel * (1 - R0.seuil_annonce_pct / 100)) + 0.0001;
  const [libelle, ton] = ETATS[p.etat] || [p.etat, "neutral"];
  const modifiable = d && ["facturee", "partielle", "voulue"].includes(d.statut);
  const coche = selection.has(p.cip);
  const t = tone(ton);
  const suspendu = v.mode === "creations_suspendues";
  return (
    <>
      <tr className="ex-tr" style={{ borderBottom: `1px solid ${T.lineSoft}`, background: coche ? T.surface2 : undefined }}>
        <td style={td}><input type="checkbox" aria-label={`Sélectionner ${p.nom}`} checked={coche} onChange={e => setSelection(s => { const n = new Set(s); if (e.target.checked) n.add(p.cip); else n.delete(p.cip); return n; })} /></td>
        <td style={{ ...td, maxWidth: 220, minWidth: 160 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{p.nom}</div><div style={{ fontFamily: T.mono, color: T.inkMute, fontSize: 11 }}>{p.cip}</div>
          {(f?.exclusions || []).length > 0 && <div style={{ color: T.inkMute, fontSize: 11 }}>Non remisable : {f.exclusions.join(", ").replace(/_/g, " ")}</div>}</td>
        <td style={td}>{f?.court_fin ? dateFr(f.court_fin) : dateFr(p.catalogue?.earliest_expiry)}<div style={{ color: T.inkMute, fontSize: 11 }}>{d?.date_fin_regle ? `règle jusqu'au ${dateFr(d.date_fin_regle)}` : f?.court_fin ? `page jusqu'au ${dateFr(finPage(f.court_fin))}` : ""}</div></td>
        <td style={td}>{f ? <span style={{ whiteSpace: "nowrap" }}>{f.court_qte} / <span style={{ color: f.long_qte ? T.warn : undefined, fontWeight: f.long_qte ? 700 : 400 }}>{f.long_qte}</span> / {f.autre_qte}</span> : "–"}
          <div style={{ color: T.inkMute, fontSize: 11 }}>{f?.lu_at ? `lu ${heureFr(f.lu_at)}` : "faits à lire"}</div></td>
        <td style={tdD}><div>{fmt(f?.list_price ?? p.catalogue?.list_price)}</div><div style={{ fontWeight: 700 }} title={d ? "prix habituel figé à la décision" : undefined}>{fmt(habituel)}</div>
          <div style={{ color: T.inkMute }}>{cout != null ? `coût ${fmt(cout)}` : <span title="standard_price non renseigné dans Odoo">coût ?</span>}</div></td>
        <td style={td}><input value={saisie} onChange={e => setRemise(e.target.value)} inputMode="numeric" aria-label={`Remise ${p.nom}`} placeholder="%"
          style={{ ...ui.input, width: 56, minHeight: 28, padding: "3px 6px", fontSize: 12, borderColor: saisie && r == null ? T.danger : undefined }} /></td>
        <td style={tdD}><div style={{ fontWeight: 700 }}>{fmt(prixPer)}</div>
          {eco != null && <div style={{ color: sansEffet ? T.inkMute : T.inkSoft, fontSize: 11 }}>économie pour la pharmacie : {eco > 0 ? `−${pct(eco)}` : "aucune"} sur l'habituel</div>}
          {sansEffet && <div style={{ color: T.inkMute, fontSize: 11 }}>sans effet (seuil : {pct(R0.seuil_annonce_pct)} d'économie)</div>}
          <div style={{ color: marge != null && marge < 0 ? T.danger : T.inkMute, fontWeight: marge != null && marge < 0 ? 700 : 400 }}>{marge == null ? "" : `marge ${pct(marge)}`}</div></td>
        <td style={td}>{f?.ventes_30j ? `${(f.ventes_30j.lgo || 0) + (f.ventes_30j.site || 0) + (f.ventes_30j.autre || 0)} (${f.ventes_30j.lgo || 0})` : "–"}</td>
        <td style={td}><span style={{ ...ui.badge(ton), background: ton === "warn" && p.etat === "a_remiser" ? "#fff7ed" : t.bg }}>{libelle}</span>
          {d && <div style={{ color: T.inkMute, fontSize: 11, marginTop: 3, maxWidth: 200 }}>{texteDecision(d, R0)}</div>}</td>
        <td style={{ ...td, minWidth: 120 }}>
          <div style={{ display: "flex", gap: 4, flexDirection: "column", alignItems: "flex-start" }}>
            {(!d || modifiable) && !(f?.exclusions || []).length && r > 0 && (!d || r !== Number(d.modification?.baisse ? d.modification.remise : d.remise_pct)) && (
              suspendu ? <button disabled title="Mode « Créations suspendues » : ni création ni hausse de remise" style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11, opacity: 0.6 }}>Créations suspendues</button>
                : <button disabled={occupe} onClick={() => onApercu(r)} className="ex-btn-petrole" style={{ ...ui.btn("primaire", "s"), height: 28, fontSize: 11, background: undefined }}>
                  {d ? (v.creation ? "Modifier (aperçu)" : "Simuler la modification") : v.creation ? "Appliquer dans Odoo" : "Simuler"}</button>)}
            {d && ["partielle", "erreur", "modifiee_odoo"].includes(d.statut) && v.creation && <button disabled={occupe} onClick={onReessayer} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11 }}>Réessayer</button>}
            {d && d.statut !== "retiree" && <button disabled={occupe} onClick={onRetirer} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11, color: T.danger }}>{d.statut === "retrait_demande" ? "Supprimer tout de suite" : "Retirer"}</button>}
            <button onClick={onJournal} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>{journal ? "Fermer" : "Journal"}</button>
          </div>
        </td>
      </tr>
      {journal && <tr><td colSpan={10} style={{ padding: 0 }}><Journal lignes={journal} titre={`Journal · ${p.nom}`} decision={d} /></td></tr>}
    </>
  );
}
const finPage = (courtFin) => { const d = new Date(`${courtFin}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };
export function texteDecision(d, R0) {
  const regles = d.regles || [];
  const actives = regles.filter(r => r.statut === "active"), verifiees = actives.filter(r => r.verifiee_at);
  if (d.simulee) return `${d.remise_pct} % · simulé : aucune règle dans Odoo, rien à supprimer`;
  if (d.statut === "retrait_demande") {
    const fin = Date.parse(d.cachee_at || "") + R0.delai_retrait_min * 60e3;
    return `${RAISONS[d.raison_fin] || d.raison_fin || ""} · caché sur le site ; suppression dans Odoo ${d.retrait_immediat ? "immédiate (en cours)" : `au premier passage après ${heureFr(new Date(fin).toISOString())} (ou une fois les commandes importées)`}`;
  }
  if (d.statut === "voulue" && d.modification?.baisse) {
    const fin = Date.parse(d.modification.demandee_at || "") + R0.delai_retrait_min * 60e3;
    return `baisse ${d.remise_pct} % → ${d.modification.remise} % : page sans remise, prix habituel ; écrite dans Odoo au premier passage après ${heureFr(new Date(fin).toISOString())} (ou une fois les commandes importées)`;
  }
  return [`${d.remise_pct} %`, regles.length ? `${verifiees.length}/${R0.listes.length} règles vérifiées` : "", d.erreur || ""].filter(Boolean).join(" · ");
}

// ── Aperçu (un produit ou un lot) ──
function Apercu({ a, setA, R0, v, occupe, onAppliquer, onForcer }) {
  const d = a.donnees;
  const ok = d.produits.filter(p => applicable(p, a));
  const creations = ok.filter(p => p.type !== "modifier"), modifications = ok.filter(p => p.type === "modifier");
  const nbRegles = ok.length * R0.listes.length;
  const confirme = (!a.lot || ok.length <= 1 || Number(a.confirmation) === nbRegles) && (!a.lot || !modifications.length || a.modifs);
  const utiles = d.produits.filter(p => ["creer", "modifier"].includes(p.type || "creer") && p.apercu_id);
  // prévus : pas écartés (au plus la case « sous le coût » à cocher)
  const prevus = utiles.filter(p => (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout"));
  const modifsPrevues = prevus.filter(p => p.type === "modifier");
  const enAttenteCase = prevus.filter(p => !applicable(p, a)).length;
  const sousCout = utiles.filter(p => p.pertes?.sous_cout && (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout"));
  const ecartes = d.produits.filter(p => !["creer", "modifier"].includes(p.type || "creer") || !(p.eligibilite?.ok || (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout")));
  const perteCochee = r2(ok.reduce((s, p) => s + (p.pertes?.perte_totale || 0), 0));
  const pertePossible = r2(utiles.reduce((s, p) => s + (p.pertes?.perte_totale || 0), 0));
  const lgoCoche = r2(ok.reduce((s, p) => s + (p.pertes?.effet_lgo_mois || 0), 0));
  const seul = d.produits.length === 1 ? d.produits[0] : null;
  const verbe = !v.creation ? "Simuler"
    : seul ? (seul.type === "modifier" ? `Modifier les ${R0.listes.length} règles` : `Créer les ${R0.listes.length} règles`)
    : [creations.length ? `créer ${creations.length * R0.listes.length} règles` : "", modifications.length ? `modifier ${modifications.length * R0.listes.length} règles` : ""].filter(Boolean).join(", ").replace(/^./, x => x.toUpperCase())
      || (enAttenteCase ? "Cocher « sous le coût » d'abord" : "Rien à faire");
  const titre = a.lot ? `Appliquer une remise de ${a.remise} % à ${a.cips.length} produits`
    : seul?.type === "modifier" ? `Modifier la remise : ${seul.nom} de −${seul.remise_actuelle} % à −${a.remise} %` : `Appliquer dans Odoo : ${seul?.nom || a.cips[0]} à −${a.remise} %`;
  return (
    <Fenetre titre={titre} onFermer={() => setA(null)} large garder={Object.values(a.sousCout || {}).some(Boolean) || Object.keys(a.force || {}).length > 0 || !!a.confirmation}>
      {!v.creation && <div style={{ ...encart("info"), marginBottom: 10 }}><Icone nom="horloge" taille={16} /><span>Mode « {MODES[R0.mode]} »{!v.variable ? ", variable Netlify absente" : ""} : le plan est calculé et journalisé, rien n'est écrit dans Odoo.</span></div>}
      {a.lot && (
        <div style={{ fontSize: 13, color: T.inkSoft, display: "grid", gap: 6, marginBottom: 12 }}>
          <div><strong>{prevus.length - modifsPrevues.length}</strong> création(s), <strong>{modifsPrevues.length}</strong> modification(s){modifsPrevues.length ? ` (${modifsPrevues.map(p => `${p.nom} ${p.remise_actuelle} % → ${a.remise} %`).join(", ")})` : ""} · <strong>{nbRegles}</strong> règle(s) à écrire ({R0.listes.length} par produit){enAttenteCase ? ` ; ${enAttenteCase} produit(s) attendent la case « sous le coût »` : ""} · effet sur les logiciels (produits cochés) : environ {fmt(lgoCoche)} de moins par mois</div>
          {sousCout.length > 0 && <div><strong>Sous le coût</strong> (cocher chaque produit) : perte des produits cochés {fmt(perteCochee)} (sur {fmt(pertePossible)} possibles)</div>}
          {ecartes.length > 0 && <div><strong>Écartés</strong> (aucun changement dans Odoo) : {ecartes.map(p => `${p.nom || p.cip} (${(p.eligibilite?.raisons || []).filter(r => r.code !== "sous_cout").map(r => r.texte).join(", ")})`).join(" ; ")}</div>}
        </div>
      )}
      {d.produits.map(p => {
        const estUtile = ["creer", "modifier"].includes(p.type || "creer") && p.apercu_id;
        const bloquants = (p.eligibilite?.raisons || []).filter(r => r.code !== "sous_cout");
        const ecarte = !estUtile || bloquants.length > 0;
        const attendCase = !ecarte && p.pertes?.sous_cout && !a.sousCout[p.cip];
        if (a.lot && ecarte) return null;   // écartés : listés dans l'en-tête du lot
        return (
          <div key={p.cip} style={{ borderTop: a.lot ? `1px solid ${T.line}` : "none", paddingTop: a.lot ? 10 : 0, marginTop: a.lot ? 10 : 0 }}>
            {a.lot && <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{p.nom} <span style={{ fontFamily: T.mono, color: T.inkMute, fontWeight: 400 }}>{p.cip}</span>{p.type === "modifier" ? ` · modification ${p.remise_actuelle} % → ${a.remise} %` : ""}</div>}
            {ecarte && (
              <div style={{ ...encart(bloquants.some(r => r.code === "lot_long") ? "warn" : "danger"), marginBottom: 6 }}><Icone nom="alerte" taille={14} />
                <span><strong>Écarté : aucun changement dans Odoo.</strong> {bloquants.map(r => r.texte).join(" ; ")}</span></div>
            )}
            {attendCase && <div style={{ ...encart("warn"), marginBottom: 6 }}><Icone nom="alerte" taille={14} /><span>Ne sera {p.type === "modifier" ? "modifié" : "créé"} qu'une fois la case « sous le coût » cochée.</span></div>}
            {!ecarte && p.listes && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 8 }}>
                <thead><tr>{["Liste", "Prix aujourd'hui", "Prix après", "Économie", "Changement dans Odoo"].map(h => <th key={h} style={{ ...th, padding: "6px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>{p.listes.map(l => (
                  <tr key={l.liste} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                    <td style={{ ...td, padding: "6px 8px" }}>{l.nom}</td>
                    <td style={{ ...tdD, padding: "6px 8px" }}>{fmt(l.prix_aujourdhui)}{p.type === "modifier" && l.prix_habituel != null && Math.abs(l.prix_habituel - (l.prix_aujourdhui ?? 0)) >= 0.005 ? <div style={{ color: T.inkMute, fontSize: 11 }}>habituel {fmt(l.prix_habituel)}</div> : null}</td>
                    <td style={{ ...tdD, padding: "6px 8px", fontWeight: 700 }}>{fmt(l.prix_apres)}</td>
                    <td style={{ ...tdD, padding: "6px 8px" }}>{l.economie_pct > 0 ? `−${pct(l.economie_pct)}` : "–"}</td>
                    <td style={{ ...td, padding: "6px 8px", color: T.inkSoft }}>{l.changement || "–"}{l.sans_effet && <div style={{ color: T.inkMute }}>sans effet sur cette liste : prix habituel déjà plus bas (la règle est quand même posée, pour un retrait simple)</div>}</td>
                  </tr>))}</tbody>
              </table>
            )}
            {!ecarte && p.facture && <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 6 }}><strong>La facture affichera</strong> : PU {fmt(p.facture.pu)} · Remise {pctBrut(p.facture.remise_pct)} %{surHabituel(d, p) ? ` (vous avez saisi ${a.remise} % du prix habituel : la facture montre la remise équivalente sur le prix de base)` : ""}</div>}
            {p.stock && !ecarte && (
              <div style={{ fontSize: 12, color: T.inkSoft, display: "grid", gap: 4 }}>
                <div><strong>Stock touché</strong> : {p.stock.court} boîte(s) courte(s) (lot au {dateFr(p.stock.court_fin)}){p.stock.long + p.stock.autre > 0 ? ` ; ${p.stock.long} boîte(s) à date longue${p.stock.long_debut ? ` (lot au ${dateFr(p.stock.long_debut)})` : ""}${p.stock.autre ? ` et ${p.stock.autre} sans date` : ""}` : ""} · faits lus à {heureFr(p.lu_at)}</div>
                {p.pertes && (
                  <div><strong>Marge et pertes</strong> : marge {p.pertes.marge_pct == null ? "inconnue (coût non renseigné)" : pct(p.pertes.marge_pct)} · coût {fmt(p.pertes.cout)}
                    {p.pertes.perte_boite > 0 ? ` · perte ${fmt(p.pertes.perte_boite)} par boîte, ${fmt(p.pertes.perte_totale)} sur ${p.pertes.qte} boîtes` : ""}
                    {p.pertes.destruction != null ? ` · repère destruction : ${fmt(p.pertes.destruction)}` : ""}
                    {p.pertes.remise_max_sans_perte != null ? ` · remise maximale sans perte : ${p.pertes.remise_max_sans_perte} %` : ""}</div>)}
                {p.pertes?.sous_cout && (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: T.danger, fontWeight: 600 }}>
                    <input type="checkbox" checked={!!a.sousCout[p.cip]} onChange={e => setA(x => ({ ...x, sousCout: { ...x.sousCout, [p.cip]: e.target.checked } }))} />
                    <span>{p.pertes.cout_inconnu ? "Coût non renseigné dans Odoo : je confirme ce prix sans connaître la perte" : `Je vends sous le coût : perte ${fmt(p.pertes.perte_boite)} par boîte, ${fmt(p.pertes.perte_totale)} sur les ${p.pertes.qte} boîtes`}</span></label>)}
                {p.pertes && <div><strong>Effet sur les logiciels</strong> : ce prix vaudra aussi pour les commandes passées par les logiciels des pharmacies : {p.pertes.ventes_lgo_30j} boîte(s) le mois dernier, environ {fmt(p.pertes.effet_lgo_mois)} de moins par mois.</div>}
                {p.fin_regle && <div><strong>Fin automatique</strong> au plus tard le {dateFr(p.fin_regle)}, quand le lot passe sous 30 jours.</div>}
              </div>
            )}
            {p.stock && (p.stock.long + p.stock.autre > 0) && bloquants.every(r => r.code === "lot_long") && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: T.inkSoft, marginTop: 4 }}><input type="checkbox" checked={a.force[p.cip] != null} disabled={occupe}
                onChange={e => onForcer(p.cip, e.target.checked ? p.stock.long + p.stock.autre : null)} />
                <span>Forcer : {[p.stock.long ? `ces ${p.stock.long} boîte(s) à date longue${p.stock.long_debut ? ` (lot au ${dateFr(p.stock.long_debut)})` : ""}` : "", p.stock.autre ? `${p.stock.autre} boîte(s) sans date` : ""].filter(Boolean).join(" et ")} seront aussi vendues à ce prix</span></label>)}
          </div>
        );
      })}
      {a.lot && modifsPrevues.length > 0 && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 12, color: T.warn, fontWeight: 600 }}>
          <input type="checkbox" checked={!!a.modifs} onChange={e => setA(x => ({ ...x, modifs: e.target.checked }))} />
          <span>Je modifie aussi la remise de {modifsPrevues.length} produit(s) déjà remisé(s) : {modifsPrevues.map(p => `${p.nom} ${p.remise_actuelle} % → ${a.remise} %`).join(", ")}</span></label>
      )}
      {a.lot && ok.length > 1 && (
        <div style={{ marginTop: 12 }}><label style={ui.label}>Confirmer en saisissant le nombre de règles ({nbRegles})</label>
          <input value={a.confirmation} onChange={e => setA(x => ({ ...x, confirmation: e.target.value }))} inputMode="numeric" aria-label="Nombre de règles" style={{ ...ui.input, width: 140 }} /></div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={() => setA(null)} style={ui.btn("ligne", "s")}>Annuler</button>
        <button disabled={!ok.length || !confirme || occupe} onClick={onAppliquer} className="ex-btn-petrole" style={{ ...ui.btn("primaire", "s"), background: undefined, opacity: ok.length && confirme ? 1 : 0.5 }}>{verbe}</button>
      </div>
    </Fenetre>
  );
}
const surHabituel = (d, p) => d.base_remise === "prix_liste5" && p.facture && Math.abs(Number(p.facture.remise_pct) - Number(p.remise)) > 0.001;

function LotBar({ n, max, occupe, mode, creation, onAppliquer, onRetirer, onVider }) {
  const [r, setR] = useState("");
  const remise = remiseSaisie(r);
  const suspendu = mode === "creations_suspendues";
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "4px 8px", borderRadius: R.s, background: T.surface2 }}>
      <strong style={{ fontSize: 12 }}>{n} sélectionné{n > 1 ? "s" : ""}{n > max ? ` (au plus ${max})` : ""}</strong>
      {suspendu ? <span style={{ fontSize: 12, color: T.inkMute }}>Créations suspendues</span> : <>
        <span style={{ fontSize: 12 }}>Appliquer une remise de</span>
        <input value={r} onChange={e => setR(e.target.value)} inputMode="numeric" aria-label="Remise de la sélection" style={{ ...ui.input, width: 52, minHeight: 28, padding: "3px 6px", fontSize: 12 }} />
        <span style={{ fontSize: 12 }}>%</span>
        <button disabled={occupe || !(remise > 0) || n > max} onClick={() => onAppliquer(remise)} style={{ ...ui.btn("primaire", "s"), height: 28, fontSize: 11 }}>{creation ? "Aperçu" : "Simuler (aperçu)"}</button>
      </>}
      <button disabled={occupe} onClick={onRetirer} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11, color: T.danger }}>Retirer</button>
      <button onClick={onVider} style={{ ...ui.btn("lien"), fontSize: 11, color: T.inkMute }}>Vider</button>
    </span>
  );
}

function Journal({ lignes, titre, decision, onFermer }) {
  const liste = decision?.regles?.find(r => r.liste)?.liste || 5;
  return (
    <div style={{ ...ui.panel, margin: 8, maxWidth: 1000, boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{titre}</strong>
        <span style={{ display: "flex", gap: 10 }}>
          <a href={`${ODOO_WEB}/web#model=product.pricelist&id=${liste}&view_type=form&cids=2`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.teal }}>Voir dans Odoo, société Elixir (Ventes → Configuration → Listes de prix)</a>
          {onFermer && <button onClick={onFermer} style={{ ...ui.btn("lien"), fontSize: 12, color: T.inkMute }}>Fermer</button>}
        </span>
      </div>
      {!lignes?.length ? <div style={{ fontSize: 12, color: T.inkMute }}>Aucune ligne.</div> : (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr>{["Quand", "Qui", "Mode", "Action", "Liste", "Règle", "Résultat", "Détail"].map(h => <th key={h} style={{ ...th, padding: "4px 6px", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{lignes.map(l => (
              <tr key={l.id} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                <td style={tdJ}>{heureFr(l.at)}</td><td style={tdJ}>{ACTEURS[l.acteur] || l.acteur}</td><td style={tdJ}>{MODES_JOURNAL[l.mode] || l.mode}</td><td style={tdJ}>{ACTIONS_JOURNAL[l.action] || l.action}</td>
                <td style={tdJ}>{l.pricelist_id ? `n° ${l.pricelist_id}` : ""}</td><td style={tdJ}>{l.odoo_item_id ?? ""}</td>
                <td style={{ ...tdJ, color: ["echec", "incertain"].includes(l.resultat) ? T.danger : l.resultat === "simule" || l.resultat === "ignore" ? T.inkMute : l.resultat === "reporte" || l.resultat === "en_cours" ? T.warn : T.ok, fontWeight: 700 }}>{RESULTATS_JOURNAL[l.resultat] || l.resultat}</td>
                <td style={{ ...tdJ, color: T.inkSoft, maxWidth: 380, wordBreak: "break-word" }}>{detailJournal(l)}
                  {(l.avant || l.apres) && <details style={{ marginTop: 2 }}><summary style={{ cursor: "pointer", color: T.inkMute }}>détail technique</summary>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 10, color: T.inkMute }}>{JSON.stringify({ avant: l.avant ?? undefined, apres: l.apres ?? undefined }, null, 1)}</pre></details>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Réglages (propositions de la conception, § 16.3 : modifiables sans code) ──
const CHAMPS = [
  ["listes", "Listes de prix couvertes (jamais la 4)", "texte"], ["base_remise", "Base de la remise", ["prix_base", "% du prix de base (comme la facture)"], ["prix_liste5", "% du prix habituel (liste 5) : la facture affichera une autre remise (ex. 15,53 % pour 10 %)"]],
  ["remise_auto_pct", "Remise automatique (vide : aucune, seulement les remises saisies)", "nombre"], ["remise_max_pct", "Remise maximale (%)", "nombre"],
  ["sous_cout", "Vente sous le coût", ["confirmation", "confirmation explicite par produit"], ["interdit", "interdite"]], ["perte_max_produit", "Perte maximale par produit (€, vide : aucune)", "nombre"],
  ["budget_perte_mensuel", "Budget mensuel de perte (€, vide : aucun)", "nombre"], ["lot_long_recu", "Lot long reçu pendant la remise", ["retrait", "retrait automatique et alerte"], ["maintien", "maintien jusqu'à décision, alerte"]],
  ["ventes_lgo_max", "Boîtes vendues par LGO sur 30 j au plus (vide : pas de limite)", "nombre"], ["delai_retrait_min", "Délai avant suppression d'une règle ou baisse d'une remise (min)", "nombre"],
  ["seuil_annonce_pct", "Seuil d'annonce (% d'économie sur le prix habituel)", "nombre"], ["plafond_produits_par_lot", "Produits par application en lot", "nombre"],
  ["plafond_produits_factures", "Produits remisés en même temps", "nombre"], ["plafond_regles_par_passage", "Règles complétées par passage automatique", "nombre"],
  ["disjoncteur_sortie_pct", "Disjoncteur : sorties pour cause de stock (%)", "nombre"], ["filet_dates_odoo", "Odoo respecte les dates (essai T1)", ["a_prouver", "à prouver"], ["oui", "oui"], ["non", "non"]],
];
function Reglages({ R0, occupe, onEnregistrer }) {
  const [v, setV] = useState(() => Object.fromEntries(CHAMPS.map(([k]) => [k, k === "listes" ? (R0.listes || []).join(", ") : R0[k] ?? ""])));
  const valeurs = () => Object.fromEntries(CHAMPS.map(([k, , type]) => {
    const x = v[k];
    if (k === "listes") return [k, String(x).split(/[\s,;]+/).filter(Boolean).map(Number)];
    if (type === "nombre") return [k, String(x).trim() === "" ? null : Number(String(x).replace(",", "."))];
    return [k, x];
  }));
  return (
    <div style={{ ...ui.card, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10 }}>Valeurs proposées en attendant vos décisions (questions ouvertes de la conception). Chaque changement est journalisé ; une valeur hors limites est ramenée dans les bornes et signalée.
        {R0.updated_at ? ` Dernière modification : ${heureFr(R0.updated_at)}${R0.updated_by ? ` par ${R0.updated_by}` : ""}.` : ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {CHAMPS.map(([k, l, type, ...options]) => (
          <label key={k} style={{ fontSize: 12 }}><span style={ui.label}>{l}</span>
            {Array.isArray(type) ? (
              <select value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} style={{ ...ui.input, minHeight: 34, fontSize: 13, padding: "6px 10px" }}>
                {[type, ...options].map(([val, txt]) => <option key={val} value={val}>{txt}</option>)}</select>
            ) : <input value={v[k] ?? ""} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} style={{ ...ui.input, minHeight: 34, fontSize: 13, padding: "6px 10px" }} />}
          </label>
        ))}
      </div>
      <button disabled={occupe} onClick={() => onEnregistrer(valeurs())} style={{ ...ui.btn("primaire", "s"), marginTop: 12 }}>Enregistrer les réglages</button>
    </div>
  );
}

// ── Contrôle des écarts (§ 16.1) : PU du site (pn) contre net facturé par Odoo, lecture seule ──
function Ecarts({ appel }) {
  const [depuis, setDepuis] = useState("2026-03-14");
  const [res, setRes] = useState(null);
  const [cours, setCours] = useState(null);
  const [tout, setTout] = useState(false);
  const lancer = async () => {
    const lignes = []; let offset = 0, commandes = 0, garde = 0;
    setRes(null);
    try {
      while (offset != null && garde++ < 300) {
        setCours(`${commandes} commandes relues…`);
        const r = await appel(`${API}?action=ecarts&depuis=${depuis}&offset=${offset}`);
        lignes.push(...r.lignes); commandes += r.commandes; offset = r.suivant;
      }
      setRes({ lignes, commandes });
    } catch (e) { setRes({ erreur: e.message, lignes, commandes }); }
    finally { setCours(null); }
  };
  const somme = (xs) => r2(xs.reduce((s, x) => s + x.ecart, 0));
  const per = res ? res.lignes.filter(l => l.page_peremption) : [];
  const vues = res ? (tout ? res.lignes : per) : [];
  const exporter = () => {
    const blob = new Blob(["﻿" + csvEcarts(res.lignes)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ecarts-peremption-depuis-${depuis}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div style={{ ...ui.card, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10 }}>Lignes des commandes du site facturées par Odoo au-dessus du prix du panier (« PU HT » enregistré). « Page péremption probable » : PU du panier = prix de base × 0,5 (× 0,8 dès 500 €, l'ancienne page), ou ligne marquée « Pér. ». Les autres écarts (pharmacie d'une autre liste que la 5, prix changé entre le panier et l'import) sont à part. Lecture seule, à confirmer ligne à ligne avant tout remboursement ; contrôle de cohérence : 9 pharmacies, 172,56 € d'écart relevés le 20/10 (conception § 16.1).</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Depuis le <input type="date" value={depuis} onChange={e => setDepuis(e.target.value)} style={{ ...ui.input, width: 160, minHeight: 32, padding: "4px 8px", display: "inline-block" }} /></label>
        <button disabled={!!cours} onClick={lancer} style={ui.btn("primaire", "s")}>Lancer le contrôle</button>
        {res?.lignes?.length > 0 && <button onClick={exporter} style={ui.btn("ligne", "s")}>Exporter (CSV)</button>}
        {res && <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={tout} onChange={e => setTout(e.target.checked)} />Afficher aussi les autres écarts</label>}
        {cours && <span style={{ fontSize: 12, color: T.inkMute }}>{cours}</span>}
      </div>
      {res && (
        <div style={{ marginTop: 10 }}>
          {res.erreur && <div style={encart("danger")}><Icone nom="alerte" taille={14} /><span>{res.erreur}</span></div>}
          <div style={{ fontSize: 13, margin: "6px 0" }}>{res.commandes} commandes relues · dont page péremption probable : <strong>{per.length}</strong> ligne(s), <strong>{fmt(somme(per))}</strong> · autres écarts (liste ≠ 5, prix changé) : {res.lignes.length - per.length} ligne(s), {fmt(somme(res.lignes.filter(l => !l.page_peremption)))}</div>
          {vues.length > 0 && (
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead><tr>{["Date", "Pharmacie", "Réf. site", "Odoo", "Liste", "Produit", "Qté", "PU site", "Net Odoo", "Écart", "Pér.", "Facturation"].map(h => <th key={h} style={{ ...th, padding: "4px 6px", fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>{vues.map((l, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.lineSoft}`, background: l.page_peremption ? undefined : T.surface2 }}>
                    <td style={tdJ}>{dateFr(l.date)}</td><td style={tdJ}>{l.pharmacie}</td><td style={tdJ}>{l.commande}</td><td style={tdJ}>{l.odoo}</td><td style={tdJ}>{l.liste ? `n° ${l.liste}` : ""}</td><td style={tdJ}>{l.nom || l.cip}</td>
                    <td style={tdJ}>{l.qte}</td><td style={tdJ}>{fmt(l.pn)}</td><td style={tdJ}>{fmt(l.net)}</td><td style={{ ...tdJ, fontWeight: 700 }}>{fmt(l.ecart)}</td>
                    <td style={tdJ}>{l.peremption ? dateFr(l.peremption) : l.page_peremption ? "probable" : ""}</td><td style={tdJ}>{FACTURATION[l.facturation] || l.facturation}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Atomes ──
// garder : un clic sur le fond ne ferme pas la fenêtre (cases cochées, saisie en cours) ; Échap et la croix ferment toujours
function Fenetre({ titre, onFermer, children, large = false, garder = false }) {
  useEffect(() => { const f = (e) => { if (e.key === "Escape") onFermer(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onFermer]);
  return (
    <div role="dialog" aria-modal="true" aria-label={titre} onClick={garder ? undefined : onFermer} style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 1200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ ...ui.card, width: "100%", maxWidth: large ? 980 : 560, boxShadow: T.shadow3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <strong style={{ fontSize: 16, color: T.ink }}>{titre}</strong>
          <button onClick={onFermer} aria-label="Fermer" className="ex-btn-discret" style={{ ...ui.rond(32), fontSize: 16 }}><Icone nom="fermer" taille={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Tuile({ titre, ton = "neutral", children }) {
  const t = tone(ton);
  return (
    <div style={{ flex: "1 1 170px", minWidth: 160, padding: "10px 12px", borderRadius: R.s, background: t.bg, color: t.fg, border: `1px solid ${t.border}`, fontSize: 13 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.85, marginBottom: 4 }}>{titre}</div>
      {children}
    </div>
  );
}
function Compteur({ libelle, valeur, detail, ton, onClick, actif }) {
  const t = ton ? tone(ton) : null;
  const corps = <><div style={{ fontSize: 20, fontWeight: 800, color: t ? t.fg : T.ink }}>{valeur}</div><div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{libelle}</div>
    {detail && <div style={{ fontSize: 11, color: T.inkMute }}>{detail}</div>}</>;
  const style = { ...ui.card, padding: "10px 12px", textAlign: "left", boxShadow: actif ? `inset 0 0 0 2px ${T.teal}` : T.shadow1, fontFamily: "inherit" };
  return onClick ? <button onClick={onClick} aria-pressed={!!actif} style={{ ...style, cursor: "pointer" }}>{corps}</button> : <div style={style}>{corps}</div>;
}
const th = { ...ui.th, padding: "8px 8px", fontSize: 10 };
const td = { padding: "8px 8px", verticalAlign: "top", fontSize: 12 };
const tdD = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const tdJ = { padding: "4px 6px", verticalAlign: "top" };
const btnL = { ...ui.btn("ligne", "s"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, fontSize: 12 };
const encart = (ton) => { const t = tone(ton); return { display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: R.s, fontSize: 13, lineHeight: 1.5, background: t.bg, color: t.fg, border: `1px solid ${t.border}` }; };
