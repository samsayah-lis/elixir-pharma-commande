import React, { useCallback, useEffect, useState } from "react";
import { T, R, tone, ui, fmtEur } from "../theme.js";

// Alertes « M'avertir du retour » (docs/alertes-retour.md) : envois automatiques (activer / suspendre), produits les plus
// attendus, e-mails prêts à partir, demandes traitées, envois à vérifier, journal des passages, « Envoyer maintenant »,
// « Relancer » et « Retirer ». Données : restock-notify (admin) — nom et CIP des pharmacies ; une adresse e-mail n'apparaît
// que pour un envoi à vérifier (recherche dans Resend). Logique : netlify/functions/_restock.js
const API = "/.netlify/functions/restock-notify";
const RESEND = "https://resend.com/emails";
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const heure = (s) => s ? new Date(s).toLocaleString("fr-FR", { weekday: "long", hour: "numeric", minute: "2-digit" }).replace(":", " h ") : "—";
const jour = (s) => s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const ilYa = (s) => { const j = Math.floor((Date.now() - Date.parse(s)) / 86400e3); return !Number.isFinite(j) ? "" : j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`; };
const NOM_INCONNU = "Nom inconnu (CIP absent des comptes)";
// issue → [libellé, ton, explication (survol)]
const ISSUES = {
  envoye: ["✓ e-mail envoyé", "ok", "La pharmacie a reçu l'e-mail (une seule fois pour cette demande)"],
  ancienne: ["close : trop ancienne", "neutral", "Demande déjà vieille de plus de 60 jours à la mise en service : close sans e-mail"],
  destinataire: ["close : adresse non rattachée au CIP", "warn", "L'adresse de la demande n'est plus un compte de cette pharmacie : close sans e-mail (la pharmacie voit quand même « De retour en stock » dans sa Saisie)"],
  echec: ["échec : 3 refus", "danger", "Resend a refusé l'e-mail 3 fois pour cette demande : close (« Relancer » possible)"],
  interrompu: ["à vérifier : envoi incertain", "acting", "Pas de réponse claire de Resend : l'e-mail est peut-être parti. Vérifier dans Resend, puis « Relancer » s'il n'est pas parti"],
};
const SOURCES = { planifie: "passage planifié", synchro: "après la synchro du stock", admin: "« Envoyer maintenant »" };
const Pastille = ({ ton, title, court, children }) => <span title={title} style={{ ...ui.badge(ton), whiteSpace: court ? "nowrap" : "normal" }}>{children}</span>;
const RECENTS_VISIBLES = 30;
const somme = (c) => Object.values(c || {}).reduce((s, n) => s + (Number(n) || 0), 0);
const pl = (n, mot, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;
const resumePassage = (p) => [
  `${pl(p.envoyes || 0, "e-mail")}${p.produits ? ` (${pl(p.produits, "produit")})` : ""}`,
  p.closes?.ancienne ? `${p.closes.ancienne} trop ancienne(s)` : "",
  p.closes?.destinataire ? `${p.closes.destinataire} adresse(s) non rattachée(s)` : "",
  p.closes?.echec ? `${p.closes.echec} en échec` : "",
  p.closes?.interrompu ? `${p.closes.interrompu} à vérifier` : "",
  p.echecs ? `${p.echecs} envoi(s) refusé(s), réessayé(s) plus tard` : "",
  p.reportes ? `${p.reportes} reporté(s) : adresse déjà avertie depuis moins de 24 h` : "",
  p.restants ? `${p.restants} en attente${p.suspendu ? " (envois automatiques suspendus)" : p.hors_fenetre ? " (hors 7 h – 21 h)" : p.plafond ? " (plafond du jour)" : ""}` : "",
].filter(Boolean).join(" · ");

export default function AdminAlertesRetour({ adminFetch, flash }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [envoi, setEnvoi] = useState("");
  const [ouvert, setOuvert] = useState(null);   // CIP du produit dont la liste des pharmacies est dépliée
  const [tousRecents, setTousRecents] = useState(false);
  const [filtre, setFiltre] = useState("tous");   // demandes traitées : tous | envoye | closes
  const [occupe, setOccupe] = useState(false);
  const charger = useCallback(async () => {
    try {
      const r = await adminFetch(API);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setD(j); setErr("");
    } catch (e) { setErr(e.message); }
  }, [adminFetch]);
  useEffect(() => { charger(); }, [charger]);

  const t = d?.totaux || {};
  const previsions = () => [
    t.emails_prets ? `• jusqu'à ${pl(t.emails_prets, "e-mail")} pour ${pl(t.produits_prets, "produit")} revenu(s) en stock (une seule fois par demande)` : "• aucun e-mail prêt à partir pour l'instant",
    t.closes_destinataire ? `• ${t.closes_destinataire} demande(s) close(s) SANS e-mail : l'adresse n'est plus un compte de la pharmacie` : "",
    t.emails_reportes ? `• ${pl(t.emails_reportes, "e-mail")} reporté(s) : adresse déjà avertie depuis moins de 24 h` : "",
    t.anciennes ? `• ${t.anciennes} demande(s) déjà vieille(s) de plus de ${d.regles.age_max_jours} jours close(s) SANS e-mail (trop anciennes)` : "",
    t.emails_prets > d.regles.plafond_jour - (d.envoyes_jour || 0) ? `• plafond : ${d.regles.plafond_jour} e-mails par jour, la suite partira demain` : "",
  ].filter(Boolean).join("\n");
  const envoyer = async () => {
    const lignes = [previsions(),
      d?.regles && !d.regles.dans_fenetre ? `• hors des heures d'envoi automatique (${d.regles.fenetre.de} h – ${d.regles.fenetre.a} h) : les e-mails partent quand même` : "",
      !d?.reglages?.actif ? "• envois automatiques suspendus : « Envoyer maintenant » envoie quand même" : "",
    ].filter(Boolean).join("\n");
    if (!window.confirm(`Envoyer maintenant les alertes retour ?\n\n${lignes}`)) return;
    const total = { envoyes: 0, produits: 0, closes: 0, echecs: 0, reportes: 0, erreurs: [] };
    setEnvoi("Envoi en cours…");
    try {
      for (let i = 0; i < 30; i++) {   // 4 s de travail par appel : rappelé tant qu'il en reste
        const r = await adminFetch(API, { method: "POST", body: JSON.stringify({ action: "envoyer" }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        total.envoyes += j.envoyes || 0; total.produits += j.produits || 0; total.closes += somme(j.closes); total.echecs += j.echecs || 0;
        total.reportes = j.reportes || total.reportes;
        total.erreurs.push(...(j.erreurs || []));
        setEnvoi(`Envoi en cours… ${pl(total.envoyes, "e-mail")}`);
        if (j.done !== false) break;
      }
      const msg = `✓ ${pl(total.envoyes, "e-mail")} envoyé(s) (${pl(total.produits, "produit")}), ${total.closes} demande(s) close(s)${total.echecs ? `, ${total.echecs} refusé(s)` : ""}${total.reportes ? `, ${total.reportes} reporté(s) à 24 h` : ""}`;
      setEnvoi(total.erreurs.length ? `${msg} — ${[...new Set(total.erreurs)].slice(0, 3).join(" ; ")}` : msg);
      flash?.(msg);
    } catch (e) { setEnvoi(`⚠ ${e.message}`); }
    await charger();
  };
  const basculer = async () => {
    const actif = !d?.reglages?.actif;
    if (actif && !window.confirm(`Activer les envois automatiques ?\n\nAprès chaque synchro du stock (toutes les 3 h) et au passage planifié, entre ${d.regles.fenetre.de} h et ${d.regles.fenetre.a} h :\n${previsions()}`)) return;
    setOccupe(true);
    try {
      const r = await adminFetch(API, { method: "POST", body: JSON.stringify({ action: "activer", actif }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash?.(actif ? "✓ Envois automatiques activés" : "Envois automatiques suspendus");
      await charger();
    } catch (e) { flash?.(`⚠ ${e.message}`); }
    setOccupe(false);
  };
  const relancer = async (x) => {
    const quoi = x.issue === "echec" ? "Envoi refusé 3 fois par Resend" : "Envoi incertain (pas de réponse claire de Resend)";
    if (!window.confirm(`${quoi} pour ${x.pharmacie || `CIP ${x.pharmacy_cip}`} (${x.produit || x.cip}), adresse ${x.email || "inconnue"}, ${dt(x.at)}.\n\n`
      + `${x.issue === "echec" ? "Avez-vous corrigé la cause du refus (adresse…) ?" : "Avez-vous vérifié dans Resend que l'e-mail n'est PAS parti ?"}\n\nLa demande repartira au prochain passage${x.issue === "echec" ? " (un essai de plus)" : ""}.`)) return;
    try {
      const r = await adminFetch(API, { method: "POST", body: JSON.stringify({ action: "relancer", pharmacy_cip: x.pharmacy_cip, cip: x.cip }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash?.("✓ Demande remise en attente"); await charger();
    } catch (e) { flash?.(`⚠ ${e.message}`); }
  };
  const retirer = async (p, x) => {
    if (!window.confirm(`Retirer l'alerte de ${x.nom || `la pharmacie CIP ${x.cip}`} pour « ${p.nom} » ?\n\nAucun e-mail ne lui sera envoyé pour ce produit (demande d'une pharmacie qui ne veut plus être avertie, par exemple).`)) return;
    try {
      const r = await adminFetch(`/.netlify/functions/restock-alert?pharmacy_cip=${encodeURIComponent(x.pharmacy_cip ?? x.cip)}&cip=${encodeURIComponent(p.cip)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash?.("✓ Alerte retirée"); await charger();
    } catch (e) { flash?.(`⚠ ${e.message}`); }
  };

  if (!d) return err ? <div role="alert" style={{ ...ui.encart("danger") }}>⚠ Alertes retour : {err}</div>
    : <div style={{ fontSize: 13, color: T.inkMute }}>Chargement des alertes retour…</div>;
  const recentsTous = d.recents || [];
  const envoyes = recentsTous.filter(x => x.issue === "envoye");
  const closes = recentsTous.filter(x => x.issue !== "envoye");
  // e-mails envoyés d'abord, puis le plus récent d'abord
  const recentsFiltres = (filtre === "envoye" ? envoyes : filtre === "closes" ? closes : [...envoyes, ...closes]);
  const recents = tousRecents ? recentsFiltres : recentsFiltres.slice(0, RECENTS_VISIBLES);
  const actif = d.reglages?.actif === true;
  const carte = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, padding: "14px 16px" };
  const titre = { ...ui.h2, margin: "26px 0 10px" };
  const seuil = d.reglages?.seuil_anciennes;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: T.petrol }}>🔔 Alertes retour en stock</div>
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.55, maxWidth: 760 }}>
            Bouton « M’avertir du retour » de la Saisie de commande. Après chaque mise à jour du stock, chaque pharmacie qui attendait un produit
            revenu reçoit <b>un</b> e-mail (plusieurs produits regroupés), une seule fois par demande, entre {d.regles.fenetre.de} h et {d.regles.fenetre.a} h.
            Une demande reste valable jusqu’au retour du produit ; seules celles déjà vieilles de plus de {d.regles.age_max_jours} jours à la mise en service
            sont closes sans e-mail{seuil ? <> (enregistrées avant le {jour(seuil)})</> : null}. Plafonds : un e-mail par adresse sur {d.regles.adresse_heures} h,
            {" "}{d.regles.plafond_jour} e-mails par jour. La pharmacie voit aussi « De retour en stock » dans sa Saisie pendant {d.regles.recent_jours} jours.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={charger} style={{ ...ui.btn("doux", "m") }}>Actualiser</button>
          <button onClick={envoyer} disabled={!!envoi && envoi.startsWith("Envoi en cours")} style={{ ...ui.btn("primaire", "m") }}>Envoyer maintenant</button>
        </div>
      </div>

      <div role="status" style={{ ...ui.encart(actif ? "ok" : "warn"), marginBottom: 12, display: "flex", alignItems: "center", gap: "8px 14px", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 320px" }}>
          <b>Envois automatiques : {actif ? "actifs" : "suspendus"}</b>
          {actif ? <> depuis la mise en service du {jour(d.reglages.mise_en_service)}. Prochain passage planifié : {heure(d.prochain_passage)}, et après chaque synchro du stock.</>
            : <> — les passages automatiques ne font que les clôtures, aucun e-mail ne part. {d.reglages?.lisibles === false ? "Réglages illisibles (kv_store) : réessayez. " : ""}« Envoyer maintenant » envoie quand même.</>}
          {" "}Aujourd’hui : {d.envoyes_jour || 0} / {d.regles.plafond_jour} e-mails.
        </span>
        <button onClick={basculer} disabled={occupe || d.reglages?.lisibles === false} style={{ ...ui.btn(actif ? "ligne" : "primaire", "s") }}>
          {actif ? "Suspendre les envois automatiques" : "Activer les envois automatiques"}
        </button>
      </div>

      {d.mode === "reduit" && (
        <div role="note" style={{ ...ui.encart("warn"), marginBottom: 12 }}>
          <b>Base en mode réduit</b> : passez <code>sql/restock-notify.sql</code> dans Supabase (colonnes attempts et outcome). Les e-mails partent déjà,
          une seule fois par demande ; sans ces colonnes, un envoi incertain reste de côté et ne peut pas être relancé d’ici.
        </div>
      )}
      {!d.deja_envoye && (
        <div role="note" style={{ ...ui.encart("info"), marginBottom: 12 }}>
          <b>Mise en service</b> : les demandes déjà enregistrées sont prises en compte. Au premier passage{actif ? <> ({heure(d.prochain_passage)}, ou après la prochaine synchro du stock)</> : <> après activation (ou « Envoyer maintenant »)</>} :
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>{t.emails_prets > 0 ? <>jusqu’à <b>{pl(t.emails_prets, "e-mail")}</b> partiront ({pl(t.produits_prets, "produit")} revenu(s) en stock)</> : "aucun e-mail ne partira pour l’instant"}{t.emails_prets > d.regles.plafond_jour ? <> — {d.regles.plafond_jour} le premier jour, la suite le lendemain</> : null} ;</li>
            {t.closes_destinataire > 0 && <li><b>{t.closes_destinataire} demande(s)</b> seront closes sans e-mail : l’adresse n’est plus un compte de la pharmacie ;</li>}
            {t.emails_reportes > 0 && <li>{pl(t.emails_reportes, "e-mail")} attendront : adresse déjà avertie depuis moins de 24 h ;</li>}
            {t.anciennes > 0 && <li><b>{t.anciennes} demande(s) déjà vieille(s) de plus de {d.regles.age_max_jours} jours</b> seront closes sans e-mail (trop anciennes).</li>}
          </ul>
        </div>
      )}
      {envoi && <div role="status" style={{ ...ui.encart(envoi.startsWith("⚠") ? "danger" : envoi.startsWith("✓") ? "ok" : "neutral"), marginBottom: 12 }}>{envoi}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {[
          ["En attente", t.en_attente, `${pl(t.pharmacies_en_attente || 0, "pharmacie")}`],
          ["Prêts à partir", t.emails_prets, `e-mail(s) · ${pl(t.produits_prets || 0, "produit")} revenu(s)${t.emails_reportes ? ` · ${t.emails_reportes} reporté(s)` : ""}`],
          ["E-mails envoyés", envoyes.length, "demandes averties, sur 30 jours"],
          ["Closes sans e-mail", closes.length, "demandes, sur 30 jours"],
        ].map(([l, v, s]) => (
          <div key={l} style={carte}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft }}>{l}</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 700, color: T.petrol, lineHeight: 1.2, marginTop: 4 }}>{(v || 0).toLocaleString("fr-FR")}</div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 10 }}>
        Dernier passage : {d.dernier ? <>{dt(d.dernier.at)} ({SOURCES[d.dernier.source] || d.dernier.source}) — {resumePassage(d.dernier)}
          {d.dernier.panne ? <span style={{ color: T.danger }}> · Resend refuse les envois : {d.dernier.panne}</span> : null}
          {d.dernier.erreur ? <span style={{ color: T.danger }}> · erreur : {d.dernier.erreur}</span> : null}
          {(d.dernier.erreurs || []).length ? <span style={{ color: tone("warn").fg }}> · {d.dernier.erreurs.slice(0, 2).join(" ; ")}</span> : null}</> : "aucun pour l'instant"}
      </div>

      {(d.a_verifier || []).length > 0 && (
        <div role="alert" style={{ ...ui.encart("acting"), marginTop: 14 }}>
          <b>Envois à vérifier</b> : envoi incertain (pas de réponse claire de Resend) ou refusé 3 fois. Jamais renvoyé d’office.
          Cherchez l’adresse dans <a href={RESEND} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", fontWeight: 700 }}>Resend (Ouvrir Resend)</a> à l’heure indiquée,
          puis « Relancer » si l’e-mail n’est pas parti.
          {d.a_verifier.map(x => {
            const [lib, ton] = ISSUES[x.issue] || [x.issue, "neutral"];
            return (
              <div key={`${x.pharmacy_cip}-${x.cip}`} style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Pastille court ton={ton}>{lib}</Pastille>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{dt(x.at)} · {x.pharmacie || `CIP ${x.pharmacy_cip}`} · {x.produit || x.cip} · envoyé à <b>{x.email || "adresse inconnue"}</b></span>
                <button onClick={() => relancer(x)} style={{ ...ui.btn("ligne", "s"), height: 26 }}>Relancer</button>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={titre}>Produits les plus attendus</h3>
      {!(d.produits || []).length ? <div style={{ fontSize: 13, color: T.inkMute }}>Aucune demande en attente.</div> : (
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.m, background: T.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr>
              <th style={ui.th}>Produit</th><th style={{ ...ui.th, textAlign: "right" }}>Pharmacies</th>
              <th style={ui.th}>Plus ancienne demande</th><th style={ui.th}>Stock</th>
            </tr></thead>
            <tbody>
              {d.produits.map(p => (
                <React.Fragment key={p.cip}>
                  <tr style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={ui.td}>
                      <div style={{ fontWeight: 600 }}>{p.nom}</div>
                      <div className="num" style={{ fontSize: 11, color: T.inkMute }}>CIP {p.cip}{p.cip_servi ? ` · servi sous le CIP ${p.cip_servi}` : ""}</div>
                    </td>
                    <td style={{ ...ui.td, textAlign: "right" }}>
                      <button onClick={() => setOuvert(ouvert === p.cip ? null : p.cip)} aria-expanded={ouvert === p.cip}
                        title="Voir les pharmacies qui attendent ce produit" style={{ ...ui.btn("doux", "s"), height: 28, padding: "0 10px" }}>
                        <span className="num">{p.attente}</span> {ouvert === p.cip ? "▴" : "▾"}
                      </button>
                    </td>
                    <td style={ui.td}>{jour(p.plus_ancienne)} <span style={{ fontSize: 11, color: T.inkMute }}>({ilYa(p.plus_ancienne)})</span></td>
                    <td style={ui.td}>
                      {p.pret ? <Pastille ton="ok">En stock · {fmtEur(p.prix)} HT : part au prochain passage</Pastille>
                        : p.en_stock ? <Pastille ton="warn">En stock, prix manquant : attend un prix</Pastille>
                        : p.connu ? <Pastille ton="danger">Rupture</Pastille>
                        : <Pastille ton="neutral">Absent du catalogue Odoo</Pastille>}
                    </td>
                  </tr>
                  {ouvert === p.cip && (
                    <tr><td colSpan={4} style={{ ...ui.td, background: T.paper, fontSize: 12, color: T.inkSoft }}>
                      {p.pharmacies.map(x => (
                        <div key={x.cip} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "3px 0" }}>
                          <span>{x.nom || NOM_INCONNU} <span className="num" style={{ color: T.inkMute }}>· CIP {x.cip} · depuis le {jour(x.depuis)}</span></span>
                          <button onClick={() => retirer(p, x)} aria-label={`Retirer l'alerte de ${x.nom || `CIP ${x.cip}`} pour ${p.nom}`}
                            style={{ ...ui.btn("ligne", "s"), height: 24, padding: "0 10px", fontSize: 12 }}>Retirer</button>
                        </div>
                      ))}
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={titre}>Demandes traitées (30 jours)</h3>
      {!recentsTous.length ? <div style={{ fontSize: 13, color: T.inkMute }}>Aucun e-mail ni clôture depuis 30 jours.</div> : (<>
        <div role="group" aria-label="Filtrer les demandes traitées" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {[["tous", `Toutes (${recentsTous.length})`], ["envoye", `E-mails envoyés (${envoyes.length})`], ["closes", `Closes sans e-mail (${closes.length})`]].map(([k, l]) => (
            <button key={k} className="ex-filtre" aria-pressed={filtre === k} onClick={() => setFiltre(k)} style={{ ...ui.pill(filtre === k), background: undefined, color: undefined }}>{l}</button>
          ))}
        </div>
        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: R.m, background: T.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr><th style={ui.th}>Date</th><th style={ui.th}>Pharmacie</th><th style={ui.th}>Produit</th><th style={ui.th}>Issue</th></tr></thead>
            <tbody>
              {recents.map((x, i) => {
                const [lib, ton, aide] = ISSUES[x.issue] || [x.issue, "neutral", ""];
                return (
                  <tr key={`${x.at}-${x.pharmacy_cip}-${x.cip}-${i}`} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{dt(x.at)}</td>
                    <td style={ui.td}>{x.pharmacie || NOM_INCONNU}<div className="num" style={{ fontSize: 11, color: T.inkMute }}>CIP {x.pharmacy_cip}</div></td>
                    <td style={ui.td}>{x.produit || x.cip}<div className="num" style={{ fontSize: 11, color: T.inkMute }}>CIP {x.cip}{x.prix ? ` · ${fmtEur(x.prix)} HT` : ""}</div></td>
                    <td style={{ ...ui.td, whiteSpace: "nowrap" }}><Pastille court ton={ton} title={aide}>{lib}</Pastille></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {recentsFiltres.length > RECENTS_VISIBLES && (
          <button onClick={() => setTousRecents(!tousRecents)} style={{ ...ui.btn("doux", "s"), marginTop: 8 }}>
            {tousRecents ? "Réduire la liste" : `Afficher les ${recentsFiltres.length - RECENTS_VISIBLES} autres`}
          </button>
        )}
      </>)}

      <h3 style={titre}>Journal des passages</h3>
      {!(d.passages || []).length ? <div style={{ fontSize: 13, color: T.inkMute }}>Aucun passage avec envoi ou clôture depuis 30 jours.</div> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, color: T.inkSoft, display: "grid", gap: 4 }}>
          {d.passages.map((p, i) => (
            <li key={`${p.at}-${p.source}-${i}`}>
              <span className="num">{dt(p.at)}</span> · {SOURCES[p.source] || p.source} — {resumePassage(p)}
              {p.panne ? <span style={{ color: T.danger }}> · Resend refuse les envois : {p.panne}</span> : null}
              {p.erreur ? <span style={{ color: T.danger }}> · erreur : {p.erreur}</span> : null}
              {(p.erreurs || []).length ? <span style={{ color: tone("warn").fg }}> · {p.erreurs.slice(0, 2).join(" ; ")}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
