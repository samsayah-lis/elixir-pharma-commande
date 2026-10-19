import React, { useCallback, useEffect, useRef, useState } from "react";
import { T, R, tone, ui, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";

// ── Admin : Assistant Elixir (service client des pharmacies) ─────────────
// Demandes (retours confirmés par la pharmacie, transmissions à un conseiller), conversations en lecture seule,
// coûts par jour et réglages. API : netlify/functions/chat-admin.js (verifyAdmin) ; formes : docs/assistant-contrat.md.
// Tout texte venu d'une conversation (pharmacie ou modèle) est rendu en texte brut, échappé par React : jamais de
// HTML, jamais de lien cliquable (une URL écrite dans un message reste du texte).
const API = "/.netlify/functions/chat-admin";

const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
// "2026-10-03" → "03/10/2026" (dates des cartes et des brouillons : AAAA-MM-JJ, heure de Paris, sans décalage)
const jourFr = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10).split("-").reverse().join("/") : (s ? String(s) : "–");
// "2026-10-16" → "jeu. 16/10"
const jourCourt = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? new Date(`${s}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }) : String(s || "");
const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());   // AAAA-MM-JJ, Paris
// pharmacie : nom seul (liste) ou { nom, ville } selon la réponse
const nomPharmacie = (p) => !p ? "" : typeof p === "object" ? [p.nom, p.ville].filter(Boolean).join(" · ") : String(p);
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");

// ── Libellés (codes de l'application de réclamation, conception § 2.5) ──
const MOTIFS = {
  produit_manquant: "Produit manquant", reliquat: "Reliquat", erreur_produit: "Erreur de produit", quantite_incorrecte: "Quantité incorrecte",
  produit_casse: "Produit cassé", caisse_manquante: "Caisse manquante", mauvaise_caisse: "Mauvaise caisse", commande_non_recue: "Commande non reçue",
  mauvaise_commande_recue: "Mauvaise commande reçue", retour_erreur_pharmacie: "Erreur de commande de la pharmacie", dlu_courte: "Péremption courte",
  ecart_facture: "Écart de facturation", autre: "Autre",
};
const SOUHAITS = {
  renvoi: "Renvoi du produit", avoir: "Avoir", garde: "Garde le produit", reprise: "Reprise", remise: "Remise",
  recevoir_reliquat: "Recevoir le reliquat", annule_reliquat: "Annuler le reliquat", non_precise: "Non précisé",
};
const CATEGORIES = {
  documents: "Documents", commande: "Commande", livraison: "Livraison", qualite: "Qualité pharmaceutique", reglement: "Règlement",
  compte: "Compte", tarifs: "Tarifs", disponibilite: "Disponibilité", referencement: "Référencement", autre: "Autre",
};
const RAPPELS = { email: "par e-mail", telephone: "par téléphone", indifferent: "indifférent" };
// statut d'une demande → [libellé, ton] ; le libellé reste toujours affiché (jamais la couleur seule)
const STATUTS = {
  confirmee: ["Confirmée", "info"], transmise: ["Transmise", "labo"], echec: ["Échec d'envoi", "danger"],
  traitee: ["Traitée", "ok"], rejetee: ["Rejetée", "warn"], brouillon: ["Brouillon non confirmé", "neutral"],
  expiree: ["Expirée", "neutral"], annulee: ["Annulée", "neutral"],
};
const A_TRAITER = new Set(["confirmee", "transmise", "echec"]);
// changements de statut posés par l'équipe (chat-admin : demande_statut)
const ACTIONS = [
  { statut: "traitee", libelle: "Traitée", depuis: A_TRAITER, kind: "primaire",
    question: (n) => `Marquer la demande ${n} comme traitée ?` },
  { statut: "transmise", libelle: "Transmise", depuis: new Set(["confirmee", "echec"]), kind: "ligne",
    question: (n) => `Marquer la demande ${n} comme transmise (saisie dans l'outil entrepôt ou transmise à la main) ?` },
  { statut: "rejetee", libelle: "Rejeter", depuis: A_TRAITER, kind: "ligne",
    question: (n) => `Rejeter la demande ${n} ?\n\nSon statut passe à « rejetée ».` },
];
const numeroDe = (d) => d.numero || `n° ${String(d.id || "").slice(0, 8)}`;

// ── Réglages (REGLAGES_DEFAUT de _chat-config.js, docs/assistant-contrat.md) ──
// modèles acceptés par le serveur (MODELES de _chat-config.js) : pas Haiku 5.5, sans messages système en cours de
// conversation ni repli serveur en cas de refus
const MODELES = [["claude-opus-5-5", "Opus 5.5 (recommandé)"], ["claude-sonnet-5-5", "Sonnet 5.5 (environ −45 %)"]];
const EFFORTS = [["low", "Bas (recommandé)"], ["medium", "Moyen"], ["high", "Élevé"], ["xhigh", "Très élevé (coûteux)"], ["max", "Maximal (coûteux)"]];
// libellé court (bandeau) : « Opus 5.5 », « effort bas »
const libelleDe = (liste, k) => (liste.find(([x]) => x === k)?.[1] || k || "").replace(/\s*\(.*\)$/, "");
const MODES_DEMANDES = [["simulation", "Simulation (pilote)"], ["email", "E-mail à l'équipe"], ["entrepot", "Outil entrepôt"]];
const QUOTAS = [["messages_heure", "Messages par heure"], ["messages_jour", "Messages par 24 h"], ["fichiers_jour", "Fichiers par 24 h"],
  ["retours_jour", "Demandes de retour par 24 h"], ["transmissions_jour", "Transmissions par 24 h"], ["admin_messages_jour", "Messages par jour (saisie Elixir)"]];
const PROFONDEURS = [["factures_mois", "Factures consultables (mois)"], ["releve_mois", "Période d'un relevé (mois au plus)"], ["commandes_mois", "Commandes consultables (mois)"]];
// valeur saisie → valeur enregistrée (les champs numériques sont des chaînes pendant la saisie)
const num = (v) => v === "" || v == null ? NaN : Number(String(v).replace(",", "."));
function normaliser(f) {
  if (!f) return f;
  const parCle = (o, cles) => ({ ...(o || {}), ...Object.fromEntries(cles.map(([k]) => [k, num(o?.[k])])) });
  return {
    ...f,
    pilote: [...new Set((Array.isArray(f.pilote) ? f.pilote : []).map(Number).filter(n => Number.isInteger(n) && n > 0))],
    budget_jour_eur: num(f.budget_jour_eur), conservation_jours: num(f.conservation_jours),
    quotas: parCle(f.quotas, QUOTAS), profondeur: parCle(f.profondeur, PROFONDEURS),
    entrepot_url: String(f.entrepot_url || "").trim(), email_equipe: String(f.email_equipe || "").trim(), email_qualite: String(f.email_qualite || "").trim(),
  };
}
// JSON à clés triées : « 15 » saisi = 15 enregistré, ordre des clés indifférent
const stable = (v) => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);
const empreinte = (f) => stable(normaliser(f));
const RE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;
function erreursReglages(v) {
  const e = [];
  const entier = (x, min) => Number.isInteger(x) && x >= min;
  if (!(Number.isFinite(v.budget_jour_eur) && v.budget_jour_eur >= 0)) e.push("Budget du jour : montant positif attendu.");
  if (!entier(v.conservation_jours, 1)) e.push("Conservation : nombre de jours entier (1 au moins).");
  for (const [k, l] of QUOTAS) if (!entier(v.quotas[k], 0)) e.push(`Quota « ${l} » : nombre entier attendu.`);
  for (const [k, l] of PROFONDEURS) if (!entier(v.profondeur[k], 1)) e.push(`« ${l} » : nombre entier (1 au moins).`);
  if (!RE_EMAIL.test(v.email_equipe)) e.push("E-mail de l'équipe invalide.");
  if (!RE_EMAIL.test(v.email_qualite)) e.push("E-mail qualité invalide.");
  if (v.entrepot_url && !/^https:\/\/[^\s]+$/i.test(v.entrepot_url)) e.push("Adresse de l'outil entrepôt : https://… attendu.");
  if (v.demandes === "entrepot" && !v.entrepot_url) e.push("Mode « Outil entrepôt » : renseignez d'abord l'adresse de son API.");
  if (!String(v.delai_annonce || "").trim()) e.push("Délai annoncé : texte vide.");
  if (!String(v.telephone || "").trim()) e.push("Téléphone : texte vide.");
  if (!String(v.horaires || "").trim()) e.push("Horaires : texte vide.");
  return e;
}

// ── Petits éléments ──
const card = { ...ui.card, padding: "16px 20px" };
const titre = { fontSize: 15, fontWeight: 700, color: T.petrol };
const sourdine = { fontSize: 12, color: T.inkMute, lineHeight: 1.5 };
// tableaux de listes (demandes, conversations) : marges internes resserrées pour tenir sans défiler à 1 024 px
const thS = { ...ui.th, padding: "9px 10px" };
const tdS = { ...ui.td, fontSize: 12, padding: "9px 10px" };
const eyebrow = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkMute };
const Badge = ({ ton = "neutral", children, titre: t }) => <span title={t} style={ui.badge(ton)}>{children}</span>;
const Statut = ({ statut }) => { const [l, t] = STATUTS[statut] || [statut || "?", "neutral"]; return <Badge ton={t}>{l}</Badge>; };
const Erreur = ({ texte }) => texte ? <div role="alert" style={{ ...ui.encart("danger"), display: "flex", gap: 6, alignItems: "flex-start" }}><Icone nom="alerte" taille={14} style={{ marginTop: 2, flexShrink: 0 }} /><span>{texte}</span></div> : null;
const Chargement = () => <div role="status" style={{ padding: 20, color: T.inkMute, fontSize: 13 }}>Chargement…</div>;
const BoutonActualiser = ({ onClick, busy }) => (
  <button onClick={onClick} disabled={busy} className="ex-btn-ligne" style={{ ...ui.btn("ligne", "s"), cursor: busy ? "wait" : "pointer" }}>
    <Icone nom="actualiser" taille={14} />Actualiser
  </button>
);
// texte libre (pharmacie ou modèle) : brut, retours à la ligne conservés, auteur toujours indiqué
const TexteLibre = ({ texte, auteur }) => (
  <div>
    <div style={eyebrow}>{auteur === "assistant" ? "rédigé par l'assistant" : "écrit par la pharmacie"}</div>
    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13, color: T.ink, lineHeight: 1.5, marginTop: 2 }}>{String(texte ?? "")}</div>
  </div>
);
// sélecteur segmenté : défile dans son cadre plutôt que de déborder (admin sur téléphone)
const Segment = ({ options, valeur, onChange, etiquette }) => (
  <div className="ex-segment ex-sans-barre" role="group" aria-label={etiquette} style={{ maxWidth: "100%", overflowX: "auto", scrollbarWidth: "none", alignSelf: "flex-start" }}>
    {options.map(([k, l]) => <button key={k} type="button" aria-pressed={valeur === k} onClick={() => onChange(k)} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{l}</button>)}
  </div>
);

// ── Demandes : retours et transmissions ──
// brouillon : objet (contrat) ; texte JSON accepté par prudence, illisible → objet vide
function brouillonDe(d) {
  let b = d?.brouillon;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}
function resumeDemande(d) {
  const b = brouillonDe(d);
  if (d.type === "transmission") return [CATEGORIES[b.categorie] || b.categorie || "Transmission", b.reference].filter(Boolean).join(" · ");
  const n = Array.isArray(b.lignes) ? b.lignes.length : 0;
  return [b.document?.numero || b.reference_document || d.cible_ref, n ? `${n} produit${n > 1 ? "s" : ""}` : null, MOTIFS[b.motif] || b.motif].filter(Boolean).join(" · ");
}
const urgente = (d) => d.type === "transmission" && (brouillonDe(d).urgence === "urgente" || brouillonDe(d).categorie === "qualite");

// children : boutons de changement de statut (posés sous le détail, après lecture)
function DetailDemande({ d, ouvrirConversation, children }) {
  const b = brouillonDe(d);
  const lignes = Array.isArray(b.lignes) ? b.lignes : [];
  const resume = d.resume || b.resume;
  const info = (l, v) => v ? <div><span style={{ color: T.inkMute }}>{l} : </span><b style={{ fontWeight: 600 }}>{v}</b></div> : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: T.paper, borderRadius: R.s, border: `1px solid ${T.lineSoft}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "4px 16px", fontSize: 12 }}>
        {d.type === "transmission" ? (<>
          {info("Catégorie", CATEGORIES[b.categorie] || b.categorie)}
          {info("Urgence", b.urgence === "urgente" ? "urgente" : b.urgence ? "normale" : null)}
          {info("Rappel souhaité", RAPPELS[b.rappel] || b.rappel)}
          {info("Référence citée", b.reference)}
        </>) : (<>
          {info("Document", b.document?.numero || b.reference_document)}
          {info("Sortie d'entrepôt", b.document?.date_sortie ? jourFr(b.document.date_sortie) : null)}
          {info("Motif", MOTIFS[b.motif] || b.motif)}
          {info("Souhait", SOUHAITS[b.souhait] || b.souhait)}
        </>)}
        {info("Fiche Odoo", d.odoo_id ? `n° ${d.odoo_id}` : null)}
        {info("Référence cible", d.cible_ref)}
        {info("Confirmée le", dt(d.confirmee_at))}
        {info("Transmise le", dt(d.transmise_at))}
      </div>
      {lignes.length > 0 && (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr><th style={ui.th}>Produit</th><th style={ui.th}>CIP13</th><th style={ui.th}>Lot</th><th style={ui.th}>Péremption</th><th style={{ ...ui.th, textAlign: "right" }}>Quantité</th></tr></thead>
            <tbody>{lignes.map((l, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td style={{ ...ui.td, fontSize: 12 }}>{String(l.produit ?? "")}</td>
                <td style={{ ...ui.td, fontSize: 12, fontFamily: T.mono }}>{String(l.cip ?? "")}</td>
                <td style={{ ...ui.td, fontSize: 12, fontFamily: T.mono }}>{l.lot ? String(l.lot) : "–"}</td>
                <td style={{ ...ui.td, fontSize: 12 }}>{l.peremption ? jourFr(l.peremption) : "–"}</td>
                <td style={{ ...ui.td, fontSize: 12, textAlign: "right", fontWeight: 700 }}>{String(l.quantite ?? "")}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {resume && <TexteLibre texte={resume} auteur="assistant" />}
      {b.commentaire && <TexteLibre texte={b.commentaire} auteur="assistant" />}
      {d.erreur && <div style={{ ...ui.encart("danger"), fontSize: 12 }}><b>Erreur d'envoi : </b>{String(d.erreur)}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {children}
        {d.conversation_id && <button onClick={() => ouvrirConversation(d.conversation_id)} className="ex-btn-ligne" style={ui.btn("ligne", "s")}><Icone nom="bulle" taille={14} />Voir la conversation</button>}
        <details style={{ fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: T.teal, fontWeight: 600 }}>Données enregistrées</summary>
          <pre style={{ margin: "6px 0 0", padding: 10, background: T.surface2, borderRadius: R.s, fontSize: 11, fontFamily: T.mono, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 280, overflowY: "auto" }}>{JSON.stringify(b, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

function VueDemandes({ lire, ecrire, flash, ouvrirConversation, noter }) {
  const [filtre, setFiltre] = useState("a_traiter");   // a_traiter | toutes | un statut (filtré par le serveur)
  const [type, setType] = useState("tous");
  const [liste, setListe] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [ouverte, setOuverte] = useState(null);
  const seq = useRef(0);
  const charger = useCallback(async () => {
    const n = ++seq.current;
    setBusy("liste");
    try {
      const j = await lire({ vue: "demandes", ...(STATUTS[filtre] ? { statut: filtre } : {}) });
      if (n !== seq.current) return;
      const ds = Array.isArray(j.demandes) ? j.demandes : [];
      setListe(ds); setErr(""); noter(ds);
    } catch (e) { if (n === seq.current) { setErr(e.message); setListe(l => l || []); } }
    finally { if (n === seq.current) setBusy(""); }
  }, [lire, filtre, noter]);
  useEffect(() => { charger(); }, [charger]);

  const changer = async (d, a) => {
    if (!window.confirm(a.question(numeroDe(d)))) return;
    setBusy(d.id);
    try {
      const { r, j } = await ecrire({ action: "demande_statut", id: d.id, statut: a.statut });
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash?.(`✓ Demande ${numeroDe(d)} : ${STATUTS[a.statut][0].toLowerCase()}`);
      await charger();
    } catch (e) { flash?.(`⚠ ${e.message}`); }
    finally { setBusy(""); }
  };

  const visibles = (liste || []).filter(d => (filtre !== "a_traiter" || A_TRAITER.has(d.statut)) && (type === "tous" || d.type === type))
    .slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={titre}>Demandes</div>
        <Segment etiquette="Type de demande" valeur={type} onChange={setType} options={[["tous", "Toutes"], ["retour", "Retours"], ["transmission", "Transmissions"]]} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft }}>Statut
          <select value={filtre} onChange={e => { setFiltre(e.target.value); setOuverte(null); }} style={{ ...ui.input, minHeight: 32, width: "auto", padding: "4px 8px", fontSize: 13 }}>
            <option value="a_traiter">À traiter</option>
            {Object.entries(STATUTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            <option value="toutes">Tous les statuts</option>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <BoutonActualiser onClick={charger} busy={!!busy} />
      </div>
      <Erreur texte={err && `Demandes illisibles : ${err}`} />
      {!liste ? <Chargement /> : !visibles.length ? <div style={{ ...sourdine, padding: 10 }}>{filtre === "a_traiter" ? "Aucune demande à traiter." : "Aucune demande."}</div> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr><th style={thS}>Demande</th><th style={thS}>Pharmacie</th><th style={thS}>Objet</th><th style={thS}>Statut</th><th style={thS} /></tr></thead>
            <tbody>{visibles.map(d => {
              const deplie = ouverte === d.id;
              const actions = ACTIONS.filter(a => a.depuis.has(d.statut));
              return (
                <React.Fragment key={d.id}>
                  <tr style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                    <td style={tdS}>
                      <div style={{ fontFamily: T.mono, fontWeight: 700, whiteSpace: "nowrap" }}>{numeroDe(d)}</div>
                      <div style={{ fontSize: 11, color: T.inkMute, whiteSpace: "nowrap" }}>{dt(d.created_at)}</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                        <Badge ton={d.type === "transmission" ? "labo" : "neutral"}>{d.type === "transmission" ? "Transmission" : "Retour"}</Badge>
                        {urgente(d) && <Badge ton="danger"><Icone nom="alerte" taille={11} />Urgent</Badge>}
                      </div>
                    </td>
                    <td style={{ ...tdS, minWidth: 120 }}>{nomPharmacie(d.pharmacie) || "–"}<div style={{ fontSize: 11, color: T.inkMute }}>fiche n° {d.odoo_id ?? "?"}</div></td>
                    <td style={{ ...tdS, minWidth: 140, maxWidth: 320 }}>{resumeDemande(d) || "–"}</td>
                    <td style={tdS}><Statut statut={d.statut} />{d.erreur && <div style={{ fontSize: 11, color: T.danger, marginTop: 3 }}>erreur d'envoi</div>}</td>
                    <td style={{ ...tdS, textAlign: "right" }}>
                      <button onClick={() => setOuverte(deplie ? null : d.id)} aria-expanded={deplie} className="ex-btn-ligne" style={ui.btn("ligne", "s")}>
                        {deplie ? "Masquer" : actions.length ? "Traiter" : "Détail"}<Icone nom={deplie ? "precedent" : "suivant"} taille={13} style={{ transform: "rotate(90deg)" }} />
                      </button>
                    </td>
                  </tr>
                  {deplie && <tr><td colSpan={5} style={{ padding: "0 14px 14px" }}>
                    <DetailDemande d={d} ouvrirConversation={ouvrirConversation}>
                      {actions.map(a => (
                        <button key={a.statut} disabled={!!busy} onClick={() => changer(d, a)} className={a.kind === "primaire" ? "ex-btn-petrole" : "ex-btn-ligne"}
                          style={{ ...ui.btn(a.kind, "s"), opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>{busy === d.id ? "…" : a.libelle}</button>
                      ))}
                    </DetailDemande>
                  </td></tr>}
                </React.Fragment>);
            })}</tbody>
          </table>
        </div>
      )}
      <div style={{ ...sourdine, marginTop: 10 }}>
        Les retours sont préparés par l'assistant puis confirmés par la pharmacie (bouton) ; les transmissions partent à sa demande explicite.
        « Traiter » ouvre le détail ; « Traitée », « Transmise » et « Rejeter » y changent seulement le statut de la demande.
      </div>
    </div>
  );
}

// ── Conversations : liste puis lecture seule ──
function resumeCarte(a) {
  if (!a || typeof a !== "object") return "";
  switch (a.type) {
    case "document": return `Document : ${a.piece === "avoir" ? "avoir" : "facture"} ${a.numero || "?"} du ${jourFr(a.date)} · ${fmtEur(a.montant_ttc)} TTC · ${a.pdf_disponible ? "PDF disponible" : "sans PDF"}`;
    case "documents": return `Choix entre documents : ${(a.items || []).map(i => i?.numero).filter(Boolean).join(", ") || "aucun"}`;
    case "releve": return `Relevé du ${jourFr(a.debut)} au ${jourFr(a.fin)} · ${a.nb_factures ?? 0} facture(s), ${a.nb_avoirs ?? 0} avoir(s) · ${fmtEur(a.total_ttc)} TTC`;
    case "commande": return `Commande ${a.reference || "?"} du ${jourFr(a.date)} · ${(a.lignes || []).length} ligne(s)`;
    case "recap_retour": return `Récapitulatif de retour : document ${a.document?.numero || "?"} · ${(a.lignes || []).length} ligne(s) · ${MOTIFS[a.motif] || a.motif || ""}`;
    case "demande_enregistree": return `Demande enregistrée ${a.numero || ""}${a.simulation ? " (simulation)" : ""}`;
    case "transmission": return `Transmission ${a.numero || ""}`;
    case "erreur": return `Message d'erreur : ${a.texte || ""}`;
    default: return `Carte ${a.type || "inconnue"}`;
  }
}
// outils appelés pendant le tour (noms, chat-admin : champ « outils » de chaque message de l'assistant)
const outilsDe = (m) => (Array.isArray(m?.outils) ? m.outils : Array.isArray(m?.outils_appeles) ? m.outils_appeles : [])
  .map(o => typeof o === "string" ? o : o?.nom || o?.name).filter(Boolean).map(String);

function Transcription({ id, lire, noter, retour }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const charger = useCallback(async () => {
    try {
      const j = await lire({ vue: "conversation", id });
      setData(j); setErr("");
      if (j.conversation) noter([j.conversation]);
    } catch (e) { setErr(e.message); }
  }, [lire, id, noter]);
  useEffect(() => { setData(null); charger(); }, [charger]);
  const c = data?.conversation || {};
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={retour} className="ex-btn-ligne" style={ui.btn("ligne", "s")}><Icone nom="retour" taille={14} />Conversations</button>
        <div style={titre}>{nomPharmacie(c.pharmacie) || "Conversation"}</div>
        {c.statut && <Badge ton={c.statut === "ouverte" ? "info" : "neutral"}>{c.statut === "ouverte" ? "ouverte" : "close"}</Badge>}
        {c.admin_email && <Badge ton="acting">saisie Elixir</Badge>}
        <div style={{ flex: 1 }} />
        <BoutonActualiser onClick={charger} />
      </div>
      <Erreur texte={err && `Conversation illisible : ${err}`} />
      {!data && !err ? <Chargement /> : data && (<>
        <div style={{ ...sourdine, marginBottom: 12 }}>
          Fiche n° {c.odoo_id ?? "?"} · ouverte le {dt(c.created_at)}{c.modele ? ` · modèle ${libelleDe(MODELES, c.modele)}` : ""}{c.admin_email ? ` · menée par ${c.admin_email} pour la pharmacie` : ""}.
          Lecture seule : textes affichés tels qu'écrits, sans mise en forme.
        </div>
        {!messages.length ? <div style={{ ...sourdine, padding: 10 }}>Aucun message.</div> : (
          <ol aria-label="Messages de la conversation" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m, i) => {
              const assistant = m.role === "assistant";
              const outils = assistant ? outilsDe(m) : [];
              const cartes = Array.isArray(m.ui_actions) ? m.ui_actions : [];
              return (
                <li key={m.id || i} style={{ alignSelf: assistant ? "flex-start" : "flex-end", maxWidth: "min(720px, 100%)", width: "fit-content",
                  background: assistant ? T.surface : T.mint, border: `1px solid ${assistant ? T.line : T.mint2}`, borderRadius: R.m, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ ...eyebrow, color: assistant ? T.petrol : T.teal }}>{assistant ? "rédigé par l'assistant" : "écrit par la pharmacie"}{!assistant && c.admin_email ? " (saisie Elixir)" : ""}</span>
                    <span style={{ fontSize: 11, color: T.inkMute }}>{dt(m.at)}</span>
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13, color: T.ink, lineHeight: 1.5 }}>{String(m.texte ?? "")}</div>
                  {cartes.length > 0 && (
                    <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                      {cartes.map((a, k) => <li key={k} style={{ fontSize: 12, color: T.inkSoft, display: "flex", gap: 6, alignItems: "flex-start" }}><Icone nom="document" taille={13} style={{ marginTop: 2, flexShrink: 0 }} /><span>{resumeCarte(a)}</span></li>)}
                    </ul>
                  )}
                  {assistant && (
                    <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <span>Outils appelés :</span>
                      {outils.length ? outils.map((o, k) => <code key={k} style={{ fontFamily: T.mono, background: T.surface2, borderRadius: R.xs, padding: "1px 6px", color: T.inkSoft }}>{o}</code>) : <span>aucun</span>}
                    </div>
                  )}
                </li>);
            })}
          </ol>
        )}
      </>)}
    </div>
  );
}

function VueConversations({ lire, noter, ouvrirId, setOuvrirId }) {
  const [jours, setJours] = useState("30");
  const [q, setQ] = useState("");
  const [liste, setListe] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const charger = useCallback(async () => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const j = await lire({ vue: "conversations", jours });
      if (n !== seq.current) return;
      const cs = Array.isArray(j.conversations) ? j.conversations : [];
      setListe(cs); setErr(""); noter(cs);
    } catch (e) { if (n === seq.current) { setErr(e.message); setListe(l => l || []); } }
    finally { if (n === seq.current) setBusy(false); }
  }, [lire, jours, noter]);
  useEffect(() => { if (!ouvrirId) charger(); }, [charger, ouvrirId]);
  if (ouvrirId) return <Transcription id={ouvrirId} lire={lire} noter={noter} retour={() => setOuvrirId(null)} />;
  const t = q.trim().toLowerCase();
  const visibles = (liste || []).filter(c => !t || nomPharmacie(c.pharmacie).toLowerCase().includes(t) || String(c.odoo_id ?? "") === t)
    .slice().sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={titre}>Conversations</div>
        <Segment etiquette="Période" valeur={jours} onChange={setJours} options={[["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"]]} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Pharmacie ou n° de fiche" aria-label="Filtrer les conversations"
          style={{ ...ui.input, minHeight: 32, width: 220, padding: "5px 12px", borderRadius: R.pill, fontSize: 13 }} />
        <div style={{ flex: 1 }} />
        <BoutonActualiser onClick={charger} busy={busy} />
      </div>
      <Erreur texte={err && `Conversations illisibles : ${err}`} />
      {!liste ? <Chargement /> : !visibles.length ? <div style={{ ...sourdine, padding: 10 }}>{liste.length ? "Aucune conversation ne correspond." : "Aucune conversation sur la période."}</div> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr><th style={thS}>Dernier message</th><th style={thS}>Pharmacie</th><th style={{ ...thS, textAlign: "right" }}>Messages</th><th style={thS}>Statut</th><th style={thS} /></tr></thead>
            <tbody>{visibles.map(c => (
              <tr key={c.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td style={{ ...tdS, whiteSpace: "nowrap" }}>{dt(c.updated_at || c.created_at)}<div style={{ fontSize: 11, color: T.inkMute }}>ouverte le {dt(c.created_at)}</div></td>
                <td style={tdS}>{nomPharmacie(c.pharmacie) || "–"}<div style={{ fontSize: 11, color: T.inkMute }}>fiche n° {c.odoo_id ?? "?"}{c.admin_email ? " · saisie Elixir" : ""}</div></td>
                <td style={{ ...tdS, textAlign: "right" }}>{nombre(c.nb_messages)}</td>
                <td style={tdS}><Badge ton={c.statut === "ouverte" ? "info" : "neutral"}>{c.statut === "ouverte" ? "ouverte" : "close"}</Badge></td>
                <td style={{ ...tdS, textAlign: "right" }}><button onClick={() => setOuvrirId(c.id)} className="ex-btn-ligne" style={ui.btn("ligne", "s")}>Lire<Icone nom="suivant" taille={14} /></button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <div style={{ ...sourdine, marginTop: 10 }}>Conversations conservées selon le réglage « Conservation » ; accès réservé à l'administration.</div>
    </div>
  );
}

// ── Coûts par jour ──
function VueCouts({ lire }) {
  const [jours, setJours] = useState("30");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const charger = useCallback(async () => {
    const n = ++seq.current;
    setBusy(true);
    try { const j = await lire({ vue: "couts", jours }); if (n === seq.current) { setData(j); setErr(""); } }
    catch (e) { if (n === seq.current) setErr(e.message); }
    finally { if (n === seq.current) setBusy(false); }
  }, [lire, jours]);
  useEffect(() => { charger(); }, [charger]);
  const budget = Number(data?.budget_jour_eur) || 0;
  const lignes = (Array.isArray(data?.jours) ? data.jours : []).slice().sort((a, b) => String(b.jour).localeCompare(String(a.jour)));
  const total = lignes.reduce((s, j) => ({ tours: s.tours + (Number(j.tours) || 0), cout: s.cout + (Number(j.cout_eur) || 0), replis: s.replis + (Number(j.replis) || 0),
    erreurs: s.erreurs + (Number(j.erreurs) || 0), refus: s.refus + (Number(j.refus) || 0) }), { tours: 0, cout: 0, replis: 0, erreurs: 0, refus: 0 });
  const auj = lignes.find(j => j.jour === aujourdhui());
  // échelle des barres : 125 % du budget (repère du budget à 80 % de la piste) ; au-delà, barre pleine
  const echelle = budget * 1.25;
  const niveau = (c) => !budget ? null : c > budget ? "danger" : c >= budget * 0.8 ? "warn" : null;
  const tuile = (l, v, aide) => (
    <div style={{ background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.s, padding: "10px 14px", minWidth: 0 }}>
      <div style={eyebrow}>{l}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, color: T.ink, marginTop: 2 }}>{v}</div>
      {aide && <div style={{ fontSize: 11, color: T.inkMute }}>{aide}</div>}
    </div>
  );
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={titre}>Coûts</div>
        <Segment etiquette="Période" valeur={jours} onChange={setJours} options={[["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"]]} />
        <div style={{ flex: 1 }} />
        <BoutonActualiser onClick={charger} busy={busy} />
      </div>
      <Erreur texte={err && `Coûts illisibles : ${err}`} />
      {!data ? (!err && <Chargement />) : (<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginBottom: 12 }}>
          {tuile("Aujourd'hui", fmtEur(Number(auj?.cout_eur) || 0), budget ? `budget ${fmtEur(budget)} par jour` : "aucun budget")}
          {tuile(`Sur ${jours} jours`, fmtEur(total.cout))}
          {tuile("Tours", nombre(total.tours), total.tours ? `${fmtEur(total.cout / total.tours, { decimales: 3 })} par tour` : null)}
          {tuile("Replis", nombre(total.replis), "réponses du modèle de repli")}
          {tuile("Erreurs", nombre(total.erreurs))}
          {tuile("Refus", nombre(total.refus))}
        </div>
        {!lignes.length ? <div style={{ ...sourdine, padding: 10 }}>Aucun tour sur la période.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <caption style={{ ...sourdine, textAlign: "left", captionSide: "bottom", paddingTop: 8 }}>
                Barre : coût du jour rapporté au budget ({budget ? fmtEur(budget) : "non défini"}), repère vertical = budget. Au-delà, l'assistant se met en pause jusqu'au lendemain.
              </caption>
              <thead><tr><th style={ui.th}>Jour</th><th style={{ ...ui.th, textAlign: "right" }}>Tours</th><th style={{ ...ui.th, textAlign: "right" }}>Coût</th><th style={{ ...ui.th, minWidth: 160 }}>Budget du jour</th>
                <th style={{ ...ui.th, textAlign: "right" }}>Replis</th><th style={{ ...ui.th, textAlign: "right" }}>Erreurs</th><th style={{ ...ui.th, textAlign: "right" }}>Refus</th></tr></thead>
              <tbody>{lignes.map(j => {
                const c = Number(j.cout_eur) || 0, n = niveau(c), pct = budget ? Math.round(c / budget * 100) : null;
                return (
                  <tr key={j.jour} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={{ ...ui.td, fontSize: 12, whiteSpace: "nowrap" }}>{jourCourt(j.jour)}</td>
                    <td style={{ ...ui.td, fontSize: 12, textAlign: "right" }}>{nombre(j.tours)}</td>
                    <td style={{ ...ui.td, fontSize: 12, textAlign: "right", fontWeight: 700 }}>{fmtEur(c)}</td>
                    <td style={{ ...ui.td, fontSize: 12 }}>
                      {budget ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`${fmtEur(c)} sur ${fmtEur(budget)} (${pct} %)`}>
                          <div style={{ position: "relative", flex: 1, minWidth: 80, height: 8, background: T.surface2, borderRadius: 4 }}>
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(c / echelle, 1) * 100}%`, borderRadius: 4, background: n ? tone(n).fg : T.teal }} />
                            <div aria-hidden="true" style={{ position: "absolute", left: "80%", top: -3, bottom: -3, width: 2, background: T.inkSoft }} />
                          </div>
                          <span className="num" style={{ fontSize: 11, color: n ? tone(n).fg : T.inkMute, fontWeight: n ? 700 : 500, whiteSpace: "nowrap", minWidth: 64 }}>
                            {n === "danger" ? "dépassé" : `${pct} %`}{n === "warn" ? " ⚠" : ""}
                          </span>
                        </div>
                      ) : "–"}
                    </td>
                    <td style={{ ...ui.td, fontSize: 12, textAlign: "right" }}>{nombre(j.replis)}</td>
                    <td style={{ ...ui.td, fontSize: 12, textAlign: "right", color: Number(j.erreurs) ? T.danger : undefined }}>{nombre(j.erreurs)}</td>
                    <td style={{ ...ui.td, fontSize: 12, textAlign: "right" }}>{nombre(j.refus)}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}

// ── Réglages ──
// Choix d'une pharmacie du pilote : admin-pharmacy-find (clientes d'Elixir dans Odoo, même règle que la connexion)
function ChoixPharmacie({ adminFetch, deja, onAjout }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const chercher = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setErr("");
    try {
      const r = await adminFetch(`/.netlify/functions/admin-pharmacy-find?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRes(Array.isArray(j.pharmacies) ? j.pharmacies : []);
    } catch (e) { setErr(e.message); setRes(null); }
    finally { setBusy(false); }
  };
  const inactif = busy || q.trim().length < 2;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); chercher(); } }}
          placeholder="Nom, ville, CIP ou e-mail" aria-label="Rechercher une pharmacie à ajouter au pilote"
          style={{ ...ui.input, minHeight: 36, flex: "1 1 220px", padding: "6px 14px", borderRadius: R.pill, fontSize: 13 }} />
        <button type="button" onClick={chercher} disabled={inactif} className={inactif ? undefined : "ex-btn-petrole"}
          style={{ ...ui.btn("primaire", "m"), background: inactif ? T.sand : undefined, color: inactif ? T.inkSoft : undefined, cursor: inactif ? "not-allowed" : "pointer" }}>
          <Icone nom="recherche" taille={14} />{busy ? "Recherche…" : "Rechercher"}
        </button>
      </div>
      {err && <div style={{ marginTop: 8 }}><Erreur texte={err} /></div>}
      {res && !res.length && <div style={{ ...sourdine, marginTop: 8 }}>Aucune pharmacie cliente d'Elixir ne correspond.</div>}
      {res && res.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: R.s }}>
          {res.map(p => {
            const present = deja.includes(p.odoo_id);
            return (
              <div key={p.odoo_id} className="ex-tr" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div className="num" style={{ fontSize: 11, color: T.inkSoft }}>{[p.zip && p.city ? `${p.zip} ${p.city}` : p.city, `fiche n° ${p.odoo_id}`, p.cip ? `CIP ${p.cip}` : null].filter(Boolean).join(" · ")}</div>
                </div>
                {!p.cip && <Badge ton="warn" titre="Fiche sans CIP : l'assistant ne propose que la transmission à un conseiller">sans CIP</Badge>}
                <Badge ton={p.has_account ? "ok" : "neutral"} titre={p.has_account ? "" : "Sans compte sur le site : la pharmacie ne peut pas ouvrir l'assistant"}>{p.has_account ? "compte site" : "sans compte"}</Badge>
                <button type="button" disabled={present} onClick={() => onAjout(p)} className={present ? undefined : "ex-btn-ligne"}
                  style={{ ...ui.btn("ligne", "s"), opacity: present ? 0.55 : 1, cursor: present ? "default" : "pointer" }}>{present ? "Au pilote" : <><Icone nom="plus" taille={13} />Ajouter</>}</button>
              </div>);
          })}
        </div>
      )}
    </div>
  );
}

const Champ = ({ label, aide, children, large }) => (
  <label style={{ display: "block", gridColumn: large ? "1/-1" : undefined, minWidth: 0 }}>
    <span style={{ ...ui.label, fontSize: 12 }}>{label}</span>
    {children}
    {aide && <span style={{ display: "block", fontSize: 11, color: T.inkMute, marginTop: 4, lineHeight: 1.45 }}>{aide}</span>}
  </label>
);
const Interrupteur = ({ checked, onChange, children, aide }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
    <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: T.teal, flexShrink: 0 }} />
    <span><span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{children}</span>{aide && <span style={{ display: "block", fontSize: 11, color: T.inkMute, lineHeight: 1.45 }}>{aide}</span>}</span>
  </label>
);
const champ = { ...ui.input, minHeight: 36, padding: "7px 10px", fontSize: 13 };
const grille = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 };

function VueReglages({ adminFetch, form, setForm, lu, dirty, busy, enregistrer, annuler, conflit, reprendre, ecraser, err, noms, noterFiche, recharger }) {
  if (err && !form) return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <Erreur texte={`Réglages illisibles : ${err}`} />
      <BoutonActualiser onClick={recharger} />
    </div>
  );
  if (!form) return <div style={card}><Chargement /></div>;
  const maj = (patch) => setForm(f => ({ ...f, ...patch }));
  const majDans = (cle, k, v) => setForm(f => ({ ...f, [cle]: { ...(f[cle] || {}), [k]: v } }));
  const pilote = (Array.isArray(form.pilote) ? form.pilote : []).map(Number);
  const options = (liste, v) => [...liste, ...(v && !liste.some(([k]) => k === v) ? [[v, `${v} (valeur actuelle)`]] : [])];
  // modèles acceptés par le serveur, s'il les indique (chat-admin, vue « reglages », champ facultatif « modeles »)
  const acceptes = Array.isArray(lu?.modeles) && lu.modeles.length ? lu.modeles : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {conflit && (
        <div role="alert" style={{ ...ui.encart("warn"), display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 360px" }}><b>Réglages modifiés depuis un autre poste{conflit.updated_at ? ` (le ${dt(conflit.updated_at)})` : ""}.</b> Rien n'a été enregistré : choisissez la version à garder.</div>
          <button onClick={reprendre} className="ex-btn-ligne" style={ui.btn("ligne", "s")}>Reprendre la version en ligne</button>
          <button onClick={ecraser} disabled={busy} className="ex-btn-petrole" style={ui.btn("primaire", "s")}>Enregistrer ma version quand même</button>
        </div>
      )}

      <section style={card} aria-labelledby="reg-service">
        <h3 id="reg-service" style={{ ...ui.h2, marginBottom: 12 }}>Mise en service</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Interrupteur checked={form.actif} onChange={v => maj({ actif: v })} aide="Interrupteur général, lu à chaque message. Arrêté : l'assistant est indisponible pour tous.">Assistant actif</Interrupteur>
          <Interrupteur checked={form.ouvert_a_tous} onChange={v => maj({ ouvert_a_tous: v })} aide="Sinon : seulement les pharmacies du pilote ci-dessous (et Elixir en « Commander pour une pharmacie »). Les pharmacies doivent être connectées par code reçu par e-mail.">Ouvert à toutes les pharmacies</Interrupteur>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ ...ui.label, fontSize: 12 }}>Pharmacies du pilote ({pilote.length})</div>
          {!pilote.length ? <div style={sourdine}>Aucune pharmacie au pilote.</div> : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pilote.map(id => (
                <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.mint, color: T.teal, borderRadius: R.pill, padding: "3px 4px 3px 12px", fontSize: 12, fontWeight: 600 }}>
                  {noms[id] ? `${noms[id]} · ` : ""}n° {id}
                  <button type="button" onClick={() => maj({ pilote: pilote.filter(x => x !== id) })} aria-label={`Retirer la fiche n° ${id} du pilote`} title="Retirer du pilote"
                    className="ex-btn-discret" style={{ ...ui.rond(22), background: "transparent" }}><Icone nom="fermer" taille={12} /></button>
                </span>))}
            </div>
          )}
          <ChoixPharmacie adminFetch={adminFetch} deja={pilote} onAjout={(p) => { noterFiche(p.odoo_id, p.name); maj({ pilote: [...pilote, p.odoo_id] }); }} />
        </div>
      </section>

      <section style={card} aria-labelledby="reg-moteur">
        <h3 id="reg-moteur" style={{ ...ui.h2, marginBottom: 12 }}>Moteur et budget</h3>
        <div style={grille}>
          <Champ label="Modèle" aide="S'applique aux nouvelles conversations seulement (une conversation garde son modèle).">
            <select style={champ} value={form.modele || ""} onChange={e => maj({ modele: e.target.value })}>
              {options(MODELES, form.modele).map(([k, l]) => {
                const refuse = !!acceptes && !acceptes.includes(k) && k !== form.modele;
                return <option key={k} value={k} disabled={refuse}>{refuse ? `${l} — non accepté par le serveur` : l}</option>;
              })}
            </select>
          </Champ>
          <Champ label="Effort de réflexion">
            <select style={champ} value={form.effort || ""} onChange={e => maj({ effort: e.target.value })}>{options(EFFORTS, form.effort).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Budget par jour (€)" aide="Coût cumulé des tours du jour ; au-delà, l'assistant est indisponible jusqu'au lendemain. Alerte à 80 %. 0 : sans plafond.">
            <input type="number" min="0" step="0.5" inputMode="decimal" style={champ} value={form.budget_jour_eur ?? ""} onChange={e => maj({ budget_jour_eur: e.target.value })} />
          </Champ>
        </div>
      </section>

      <section style={card} aria-labelledby="reg-demandes">
        <h3 id="reg-demandes" style={{ ...ui.h2, marginBottom: 12 }}>Demandes (retours, transmissions)</h3>
        <div style={grille}>
          <Champ label="Acheminement" aide={form.demandes === "simulation" ? "Enregistrées ici ; e-mail à l'équipe préfixé « [SIMULATION] » ; rien vers l'outil entrepôt." : form.demandes === "entrepot" ? "Envoyées à l'outil entrepôt (API signée), avec e-mail à l'équipe." : "E-mail à l'équipe et liste ici ; rien vers l'outil entrepôt."}>
            <select style={champ} value={form.demandes || ""} onChange={e => maj({ demandes: e.target.value })}>{options(MODES_DEMANDES, form.demandes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Adresse de l'API de l'outil entrepôt" aide="Vide : non branché.">
            <input type="url" style={champ} value={form.entrepot_url || ""} onChange={e => maj({ entrepot_url: e.target.value })} placeholder="https://…" spellCheck={false} />
          </Champ>
          <Champ label="E-mail de l'équipe" aide="Reçoit les demandes et les transmissions.">
            <input type="email" style={champ} value={form.email_equipe || ""} onChange={e => maj({ email_equipe: e.target.value })} spellCheck={false} />
          </Champ>
          <Champ label="E-mail qualité (Pharmacien Responsable)" aide="Transmissions « qualité », objet « URGENT – Qualité ».">
            <input type="email" style={champ} value={form.email_qualite || ""} onChange={e => maj({ email_qualite: e.target.value })} spellCheck={false} />
          </Champ>
        </div>
      </section>

      <section style={card} aria-labelledby="reg-textes">
        <h3 id="reg-textes" style={{ ...ui.h2, marginBottom: 12 }}>Textes affichés aux pharmacies</h3>
        <div style={grille}>
          <Champ label="Délai annoncé" large aide="Affiché après une demande ou une transmission, tel quel.">
            <input style={champ} value={form.delai_annonce || ""} onChange={e => maj({ delai_annonce: e.target.value })} maxLength={200} />
          </Champ>
          <Champ label="Téléphone">
            <input type="tel" style={champ} value={form.telephone || ""} onChange={e => maj({ telephone: e.target.value })} maxLength={40} />
          </Champ>
          <Champ label="Horaires">
            <input style={champ} value={form.horaires || ""} onChange={e => maj({ horaires: e.target.value })} maxLength={120} />
          </Champ>
        </div>
      </section>

      <section style={card} aria-labelledby="reg-quotas">
        <h3 id="reg-quotas" style={{ ...ui.h2, marginBottom: 6 }}>Quotas, profondeur et conservation</h3>
        <div style={{ ...sourdine, marginBottom: 12 }}>Quotas par pharmacie, comptés sur les enregistrements (durables) ; le dernier vaut pour Elixir en « Commander pour une pharmacie ».</div>
        <div style={grille}>
          {QUOTAS.map(([k, l]) => (
            <Champ key={k} label={l}><input type="number" min="0" step="1" inputMode="numeric" style={champ} value={form.quotas?.[k] ?? ""} onChange={e => majDans("quotas", k, e.target.value)} /></Champ>
          ))}
          {PROFONDEURS.map(([k, l]) => (
            <Champ key={k} label={l}><input type="number" min="1" step="1" inputMode="numeric" style={champ} value={form.profondeur?.[k] ?? ""} onChange={e => majDans("profondeur", k, e.target.value)} /></Champ>
          ))}
          <Champ label="Conservation des conversations (jours)" aide="Purge quotidienne ; les demandes sont conservées (dossier qualité).">
            <input type="number" min="1" step="1" inputMode="numeric" style={champ} value={form.conservation_jours ?? ""} onChange={e => maj({ conservation_jours: e.target.value })} />
          </Champ>
        </div>
      </section>

      <div style={{ ...card, position: "sticky", bottom: 0, zIndex: 1, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={enregistrer} disabled={!dirty || busy} className={!dirty || busy ? undefined : "ex-btn-petrole"}
          style={{ ...ui.btn("primaire", "m"), background: !dirty || busy ? T.sand : undefined, color: !dirty || busy ? T.inkSoft : undefined, cursor: !dirty || busy ? "not-allowed" : "pointer" }}>
          <Icone nom="coche" taille={15} />{busy ? "Enregistrement…" : "Enregistrer les réglages"}
        </button>
        {dirty && <button onClick={annuler} disabled={busy} className="ex-btn-ligne" style={ui.btn("ligne", "m")}>Annuler les modifications</button>}
        <span role="status" style={{ fontSize: 12, color: dirty ? T.warn : T.inkMute, fontWeight: dirty ? 700 : 500 }}>
          {dirty ? "Réglages modifiés non enregistrés" : lu?.updated_at ? `Enregistrés le ${dt(lu.updated_at)}` : "Valeurs par défaut (jamais enregistrées)"}
        </span>
      </div>
      {err && <Erreur texte={err} />}
    </div>
  );
}

// ── Onglet ──
const VUES = [["demandes", "Demandes"], ["conversations", "Conversations"], ["couts", "Coûts"], ["reglages", "Réglages"]];
// onDirtyChange : réglages modifiés non enregistrés (AdminPanel demande confirmation avant de quitter l'onglet)
export default function AdminAssistant({ adminFetch, flash, onDirtyChange }) {
  const [vue, setVue] = useState("demandes");
  const [convId, setConvId] = useState(null);
  const [noms, setNoms] = useState({});   // odoo_id → nom de la pharmacie (affichage du pilote seulement)
  const flashRef = useRef(flash); flashRef.current = flash;
  const vivant = useRef(true);
  useEffect(() => { vivant.current = true; return () => { vivant.current = false; }; }, []);

  const lire = useCallback(async (params) => {
    const r = await adminFetch(`${API}?${new URLSearchParams(params)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }, [adminFetch]);
  const ecrire = useCallback(async (body) => {
    const r = await adminFetch(API, { method: "POST", body: JSON.stringify(body) });
    return { r, j: await r.json().catch(() => ({})) };
  }, [adminFetch]);
  const noter = useCallback((liste) => setNoms(n => {
    const m = { ...n };
    for (const x of liste || []) { const nom = nomPharmacie(x?.pharmacie); if (x?.odoo_id && nom) m[x.odoo_id] = nom; }
    return m;
  }), []);
  const noterFiche = useCallback((id, nom) => setNoms(n => ({ ...n, [id]: nom })), []);
  const ouvrirConversation = useCallback((id) => { setConvId(id); setVue("conversations"); }, []);

  // réglages : gardés ici pour survivre au changement de sous-onglet ; écriture avec la version lue (base), 409 sinon
  const [lu, setLu] = useState(null);         // { valeur, updated_at } en ligne
  const [form, setForm] = useState(null);
  const [regErr, setRegErr] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  const [conflit, setConflit] = useState(null);
  const appliquer = useCallback((j) => {
    const valeur = j?.valeur && typeof j.valeur === "object" ? j.valeur : {};
    setLu({ valeur, updated_at: j?.updated_at ?? null, modeles: Array.isArray(j?.modeles) ? j.modeles.map(String) : null });
    setForm(valeur);
    // noms des fiches du pilote, si le serveur les joint (facultatif)
    if (Array.isArray(j?.pilote_fiches)) setNoms(n => ({ ...n, ...Object.fromEntries(j.pilote_fiches.filter(f => f?.odoo_id && f?.nom).map(f => [f.odoo_id, f.nom])) }));
  }, []);
  const chargerReglages = useCallback(async () => {
    try { const j = await lire({ vue: "reglages" }); if (vivant.current) { appliquer(j); setRegErr(""); } }
    catch (e) { if (vivant.current) setRegErr(e.message); }
  }, [lire, appliquer]);
  useEffect(() => { chargerReglages(); }, [chargerReglages]);
  const dirty = !!(form && lu && empreinte(form) !== empreinte(lu.valeur));
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return;
    const garde = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", garde);
    return () => window.removeEventListener("beforeunload", garde);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const envoyerReglages = async (base) => {
    const valeur = normaliser(form);
    setRegBusy(true); setRegErr("");
    try {
      const { r, j } = await ecrire({ action: "reglages", valeur, base });
      if (j.conflit) { setConflit({ valeur: j.valeur, updated_at: j.updated_at ?? null }); return; }
      if (!r.ok || !j.ok) throw new Error((Array.isArray(j.erreurs) && j.erreurs.length ? j.erreurs.join(" ") : j.error) || `HTTP ${r.status}`);
      setConflit(null);
      setLu(l => ({ ...l, valeur, updated_at: j.updated_at ?? null })); setForm(valeur);
      flashRef.current?.("✓ Réglages de l'assistant enregistrés");
    } catch (e) { setRegErr(`Enregistrement impossible : ${e.message}`); }
    finally { setRegBusy(false); }
  };
  const enregistrer = () => {
    const v = normaliser(form), avant = normaliser(lu.valeur);
    const fautes = erreursReglages(v);
    if (fautes.length) { setRegErr(fautes.join(" ")); return; }
    const ouverture = v.actif && (!avant.actif || (v.ouvert_a_tous && !avant.ouvert_a_tous));
    // sans pilote ni ouverture : réservé à Elixir (« Commander pour une pharmacie »), pour essayer avant le pilote
    if (ouverture && !window.confirm(`${v.ouvert_a_tous ? "Ouvrir l'Assistant Elixir à TOUTES les pharmacies connectées par code ?"
      : v.pilote.length ? `Activer l'Assistant Elixir pour les ${v.pilote.length} pharmacie(s) du pilote ?`
      : "Activer l'Assistant Elixir pour Elixir seulement (« Commander pour une pharmacie ») ? Aucune pharmacie n'est au pilote."}\n\nChaque message appelle le modèle (coût compté dans le budget du jour).`)) return;
    if (v.demandes !== avant.demandes && v.demandes !== "simulation" && !window.confirm(`Passer les demandes en mode « ${MODES_DEMANDES.find(([k]) => k === v.demandes)?.[1] || v.demandes} » ?\n\nLes prochaines demandes confirmées par les pharmacies seront envoyées pour de vrai (plus de préfixe « [SIMULATION] »).`)) return;
    envoyerReglages(lu.updated_at);
  };
  // version en ligne relue par GET (fusionnée avec les défauts), pas celle jointe au refus
  const reprendre = () => { setConflit(null); setRegErr(""); chargerReglages(); };
  const ecraser = () => {
    if (!conflit || !window.confirm("Remplacer la version enregistrée depuis l'autre poste par la vôtre ?")) return;
    setLu(l => ({ ...l, updated_at: conflit.updated_at }));
    envoyerReglages(conflit.updated_at);
  };

  const enLigne = lu?.valeur || null;
  const pilotes = Array.isArray(enLigne?.pilote) ? enLigne.pilote.length : 0;
  const etat = !enLigne ? null : !enLigne.actif ? ["Arrêté", "neutral"] : enLigne.ouvert_a_tous ? ["Actif : toutes les pharmacies", "ok"]
    : pilotes ? [`Actif : pilote (${pilotes} pharmacie${pilotes > 1 ? "s" : ""})`, "ok"] : ["Actif : Elixir seulement", "info"];
  const modeDemandes = MODES_DEMANDES.find(([k]) => k === enLigne?.demandes)?.[1];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ex-on-dark" style={{ ...card, background: T.petrol, color: T.paper, border: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><Icone nom="bulle" taille={20} style={{ color: T.orClair }} />Assistant Elixir</div>
          {etat && <span style={ui.badge(etat[1])}>{etat[0]}</span>}
          {modeDemandes && <span style={ui.badge(enLigne.demandes === "simulation" ? "warn" : "info")}>Demandes : {modeDemandes.toLowerCase()}</span>}
          {enLigne?.modele && <span style={{ fontSize: 12, color: T.paperMute }}>{libelleDe(MODELES, enLigne.modele)}{enLigne.effort ? ` · effort ${libelleDe(EFFORTS, enLigne.effort).toLowerCase()}` : ""}</span>}
        </div>
        <div style={{ fontSize: 12, color: T.paperMute, marginTop: 6, lineHeight: 1.5 }}>
          Assistant automatique des pharmacies : duplicatas de factures, relevés de facturation, suivi des commandes, demandes de retour et transmission à un conseiller,
          avec les seules données Odoo de la pharmacie connectée. Il prépare les retours ; la pharmacie les confirme par un bouton avant tout envoi.
        </div>
      </div>

      <Segment etiquette="Rubriques de l'assistant" valeur={vue} onChange={(k) => { setVue(k); setConvId(null); }}
        options={VUES.map(([k, l]) => [k, k === "reglages" && dirty ? `${l} (modifiés)` : l])} />

      {vue === "demandes" && <VueDemandes lire={lire} ecrire={ecrire} flash={flash} ouvrirConversation={ouvrirConversation} noter={noter} />}
      {vue === "conversations" && <VueConversations lire={lire} noter={noter} ouvrirId={convId} setOuvrirId={setConvId} />}
      {vue === "couts" && <VueCouts lire={lire} />}
      {vue === "reglages" && (
        <VueReglages adminFetch={adminFetch} form={form} setForm={setForm} lu={lu} dirty={dirty} busy={regBusy} enregistrer={enregistrer}
          annuler={() => { setForm(lu.valeur); setRegErr(""); }} conflit={conflit} reprendre={reprendre} ecraser={ecraser} err={regErr} noms={noms} noterFiche={noterFiche}
          recharger={() => { setRegErr(""); chargerReglages(); }} />
      )}
    </div>
  );
}
