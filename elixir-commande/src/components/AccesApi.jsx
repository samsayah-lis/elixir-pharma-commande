import React, { useEffect, useRef, useState } from "react";
import { T, R, ui, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";
import FocusFenetre from "./ui/FocusFenetre.jsx";

// ── « Accès API » de la pharmacie (API Elixir, /api/v1) — chargé à la demande, depuis « Mes commandes » ──
// Accès ouvert par Elixir ; la pharmacie accepte les conditions d'utilisation (projet, preuve enregistrée par le serveur),
// crée ses clés (test d'abord, production une fois le test validé), les remplace ou les révoque, et voit ses derniers
// appels. Une clé n'est montrée qu'UNE fois, à sa création : le serveur n'en garde que l'empreinte.
// API : netlify/functions/api-compte.js. Saisie Elixir « pour une pharmacie », adresse plus sur la fiche, aperçu :
// lecture seule (le serveur refuse aussi).
const URL_API = "/.netlify/functions/api-compte";
const dt = (s) => s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
const ETATS = { active: ["Active", "ok"], remplacee: ["Remplacée, valide jusqu'au", "warn"], expiree: ["Expirée", "neutral"], revoquee: ["Révoquée", "danger"] };
const LECTURE_SEULE = {
  admin: "Saisie pour une pharmacie : lecture seule. Les clés se créent depuis le compte de la pharmacie (ou dans l'admin, onglet 🔌 API, pour une pharmacie sans compte).",
  adresse: "Votre adresse e-mail n'est plus sur la fiche de votre pharmacie : demandez à Elixir Pharma de la mettre à jour pour gérer vos clés.",
  apercu: "Aperçu : lecture seule, aucune modification n'est enregistrée ici.",
};
const ERREURS = { reconnexion: "Session expirée : reconnectez-vous avec le code reçu par e-mail.", verification: "Vérification du compte impossible pour l'instant : réessayez dans un instant.",
  debit: "Trop de requêtes : réessayez dans quelques secondes." };
const titreSection = { ...ui.h2, marginTop: 22 };
const off = (desactive) => (desactive ? { opacity: 0.45, cursor: "not-allowed" } : null);   // bouton désactivé visible
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");
const NOMS_DROITS = { lecture: "Lecture", commande: "Commande", documents: "Documents" };
const droits = (ps) => (ps || []).map(p => NOMS_DROITS[p] || p).join(" + ");

export default function AccesApi({ appel, pour, etatInitial, onClose, onEtat }) {
  const [etat, setEtat] = useState(etatInitial);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);   // { ton, texte }
  const [secret, setSecret] = useState(null);     // { cle, info } : montrée une fois
  const [copie, setCopie] = useState(false);
  const [lu, setLu] = useState(false);
  // droit « documents » (factures, bons de livraison) : ouvert sur l'accès, mais à cocher à la création d'une clé
  const [nouvelle, setNouvelle] = useState({ environnement: "test", libelle: "", portees: (etatInitial?.acces?.portees || []).filter(p => p !== "documents") });
  const [appels, setAppels] = useState(null);
  const encartSecret = useRef(null), codeSecret = useRef(null);
  // la clé ne s'affiche qu'une fois : l'encart est amené à l'écran (le panneau peut être défilé plus bas)
  useEffect(() => { if (secret) encartSecret.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [secret]);

  const poster = async (corps) => {
    const r = await appel(URL_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...corps, ...(pour ? { pour_odoo_id: pour } : {}) }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || ERREURS[d.error] || "Opération impossible pour l'instant : réessayez dans un instant.");
    return d;
  };
  const agir = async (corps, apres) => {
    setOccupe(true); setMessage(null);
    try {
      const d = await poster(corps);
      apres?.(d);
      const e = await poster({ action: "etat" });
      setEtat(e); onEtat?.(e);
    } catch (e) { setMessage({ ton: "danger", texte: e.message }); }
    finally { setOccupe(false); }
  };
  const lireAppels = async () => {
    setAppels("…");
    try { setAppels((await poster({ action: "journal" })).appels); } catch (e) { setAppels(null); setMessage({ ton: "danger", texte: e.message }); }
  };

  // la nouvelle clé n'est montrée qu'une fois : fermer sans avoir confirmé la copie demande confirmation
  const fermer = () => {
    if (secret && !window.confirm("Vous n'avez pas confirmé avoir copié la clé : elle ne sera plus affichée (elle reste active, et compte parmi vos 3 clés).\n\nFermer quand même ?")) return;
    onClose();
  };
  const copier = () => {
    const p = navigator.clipboard?.writeText(secret.cle);
    if (p) { p.then(() => setCopie(true), () => setCopie(false)); return; }
    // pas de presse-papiers (navigateur ancien, page non sécurisée) : la clé est sélectionnée, à copier à la main
    const r = document.createRange(); r.selectNodeContents(codeSecret.current); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    setMessage({ ton: "info", texte: "Copie automatique impossible ici : la clé est sélectionnée, copiez-la (Ctrl+C ou ⌘C)." });
  };
  const doc = etat?.documentation || null;
  const a = etat?.acces, cgu = etat?.cgu;
  const ecriture = !etat?.lecture_seule && etat?.actif;
  const cles = etat?.cles || [];
  const visibles = cles.filter(c => c.etat !== "expiree");
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="acces-api-titre" style={{ ...ui.overlay, zIndex: 450 }} onClick={() => { if (!secret) onClose(); }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.paper, color: T.ink, borderRadius: R.l, width: "100%", maxWidth: 720, maxHeight: "88vh",
        overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: T.shadow3 }}>
        <FocusFenetre />
        <div style={{ padding: "20px 20px 16px 24px", borderBottom: `1px solid ${T.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="acces-api-titre" style={ui.titreModal}><Icone nom="cadenas" taille={22} style={{ color: T.teal }} />Accès API</h2>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>{etat?.pharmacie ? `${etat.pharmacie} · ` : ""}pour automatiser vos commandes depuis un outil
              {doc && <> · <a href={doc} target="_blank" rel="noopener noreferrer" style={{ color: T.petrol, fontWeight: 600 }}>Documentation de l'API</a></>}</div>
          </div>
          <button className="ex-btn-discret ex-cible" data-focus-initial onClick={fermer} aria-label="Fermer" title="Fermer" style={ui.rond(36)}><Icone nom="fermer" taille={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 24px", background: T.cream, fontSize: 14, lineHeight: 1.5 }}>
          {message && <div role="alert" style={{ ...ui.encart(message.ton), marginBottom: 12 }}>{message.texte}</div>}
          {etat?.lecture_seule && <div style={{ ...ui.encart("info"), marginBottom: 12 }}>{LECTURE_SEULE[etat.lecture_seule]}</div>}
          {a && !etat?.actif && <div style={{ ...ui.encart("warn"), marginBottom: 12 }}>L'accès API de votre pharmacie est suspendu : contactez Elixir Pharma.</div>}

          {secret && (
            <div ref={encartSecret} role="alert" style={{ ...ui.encart("warn"), marginBottom: 16, scrollMarginTop: 8 }}>
              <b>Votre nouvelle clé « {secret.info.libelle} » ({secret.info.environnement === "live" ? "production" : "test"}) : copiez-la maintenant.</b>
              <p style={{ margin: "6px 0" }}>Elle ne sera plus jamais affichée. Gardez-la côté serveur ou dans votre outil, jamais dans une page web, un tableur partagé ou un message.</p>
              <code ref={codeSecret} style={{ display: "block", wordBreak: "break-all", background: T.surface, color: T.ink, padding: "10px 12px", borderRadius: R.s, fontFamily: T.mono, fontSize: 13, userSelect: "all" }}>{secret.cle}</code>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={ui.btn("primaire", "s")} onClick={copier}>{copie ? "Copiée ✓" : "Copier la clé"}</button>
                <button style={ui.btn("ligne", "s")} onClick={() => { setSecret(null); setCopie(false); }}>J'ai copié ma clé</button>
              </div>
              {doc && <p style={{ margin: "10px 0 0" }}>Étape suivante : le <a href={`${doc}#demarrage`} target="_blank" rel="noopener noreferrer">démarrage rapide de la documentation</a>{secret.info.environnement === "test" ? " (six appels pour valider le mode test)" : ""}.</p>}
            </div>
          )}

          {a && (
            <section aria-labelledby="acces-api-droits">
              <h3 id="acces-api-droits" style={ui.h2}>Votre accès</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {a.portees.map(p => <li key={p}>{a.libelles_portees?.[p] || p}</li>)}
                <li>{a.mode === "auto"
                  ? `Commandes envoyées automatiquement après un délai d'annulation de ${a.delai_annulation_min} min (une commande anormale est gardée pour vérification).`
                  : "Commandes par API suspendues pour votre pharmacie."}</li>
                <li>Plafonds : {nombre(a.plafonds.lignes_par_commande)} lignes, {nombre(a.plafonds.boites_par_commande)} boîtes et {fmtEur(a.plafonds.montant_ht_par_commande)} HT par commande ; {nombre(a.plafonds.commandes_par_jour)} commandes par jour.</li>
                <li>{a.mention_prix}.</li>
                {a.reseaux_limites && <li>Clés utilisables seulement depuis les réseaux déclarés à Elixir.</li>}
              </ul>
              {etat.commandes_production !== "ouvertes" && <p style={{ ...ui.encart("neutral"), marginTop: 10 }}>Les commandes réelles par l'API ne sont pas encore ouvertes. Le mode test (clé elx_test_) permet de préparer votre outil dès maintenant : rien n'y est commandé.</p>}
            </section>
          )}

          {cgu && (
            <section aria-labelledby="acces-api-cgu">
              <h3 id="acces-api-cgu" style={titreSection}>Conditions d'utilisation</h3>
              {cgu.acceptee ? <p style={{ margin: 0 }}>Acceptées le {dt(cgu.acceptee_le)} (version {cgu.version}).</p> : (
                <>
                  <p style={{ margin: "0 0 8px" }}><b>{cgu.titre}</b> — {cgu.avertissement}</p>
                  <ol style={{ maxHeight: 220, overflowY: "auto", background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.s, padding: "10px 14px 10px 32px", margin: 0, fontSize: 13 }}>
                    {cgu.articles.map(([titre, texte]) => <li key={titre} style={{ marginBottom: 6 }}><b>{titre}.</b> {texte}</li>)}
                  </ol>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 13 }}>
                    <input type="checkbox" checked={lu} disabled={!ecriture} onChange={e => setLu(e.target.checked)} />
                    J'ai lu et j'accepte ces conditions d'utilisation de l'API au nom de ma pharmacie.
                  </label>
                  <button style={{ ...ui.btn("primaire", "s"), marginTop: 8, ...off(!lu || !ecriture || occupe) }} disabled={!lu || !ecriture || occupe} onClick={() => agir({ action: "cgu", version: cgu.version })}>Accepter</button>
                </>
              )}
            </section>
          )}

          {etat?.lecture_seule === "adresse" && !a ? null : (<>
          <section aria-labelledby="acces-api-cles">
            <h3 id="acces-api-cles" style={titreSection}>Vos clés</h3>
            {visibles.length === 0 && <p style={{ margin: 0, color: T.inkSoft }}>Aucune clé pour l'instant.</p>}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {visibles.map(c => (
                <li key={c.id} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div><b>{c.libelle}</b> <span style={ui.badge(c.environnement === "live" ? "labo" : "info")}>{c.environnement === "live" ? "Production" : "Test"}</span>{" "}
                      <span style={ui.badge(ETATS[c.etat][1])}>{ETATS[c.etat][0]}{c.etat === "remplacee" ? ` ${dt(c.expire_le)}` : ""}</span></div>
                    <div style={{ fontSize: 12, color: T.inkSoft }}>Droits : {droits(c.portees)}</div>
                    <div style={{ fontSize: 12, color: T.inkSoft }}><code style={{ fontFamily: T.mono }}>{c.prefixe}</code> · créée le {dt(c.created_at)}{c.creee_par_role === "admin" ? " par Elixir" : ""} · dernière utilisation : {dt(c.derniere_utilisation)}</div>
                    {c.motif_revocation && <div style={{ fontSize: 12, color: T.inkMute }}>Motif : {c.motif_revocation}</div>}
                  </div>
                  {ecriture && c.etat === "active" && <button style={{ ...ui.btn("ligne", "s"), ...off(occupe) }} disabled={occupe}
                    onClick={() => window.confirm(`Remplacer la clé « ${c.libelle} » ?\n\nUne nouvelle clé est créée ; l'ancienne reste valide 7 jours, le temps de mettre votre outil à jour.`)
                      && agir({ action: "remplacer_cle", id: c.id }, (d) => setSecret({ cle: d.cle, info: d.info }))}>Remplacer</button>}
                  {ecriture && ["active", "remplacee"].includes(c.etat) && <button style={{ ...ui.btn("ligne", "s"), color: T.danger, ...off(occupe) }} disabled={occupe}
                    onClick={() => window.confirm(`Révoquer la clé « ${c.libelle} » ?\n\nElle cessera de fonctionner immédiatement (ou presque : moins d'une minute).`)
                      && agir({ action: "revoquer_cle", id: c.id })}>Révoquer</button>}
                </li>
              ))}
            </ul>

            {ecriture && cgu?.acceptee && (
              <div style={{ ...ui.panel, marginTop: 12 }}>
                <b>Créer une clé</b>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "8px 0", fontSize: 13 }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="acces-api-env" checked={nouvelle.environnement === "test"} onChange={() => setNouvelle({ ...nouvelle, environnement: "test" })} />Test (rien n'est commandé)</label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", color: etat.test_valide ? T.ink : T.inkMute }}><input type="radio" name="acces-api-env" disabled={!etat.test_valide} checked={nouvelle.environnement === "live"} onChange={() => setNouvelle({ ...nouvelle, environnement: "live" })} />Production{etat.test_valide ? "" : " (après validation du mode test)"}</label>
                </div>
                {!etat.test_valide && Array.isArray(etat.test_parcours) && (
                  <div style={{ fontSize: 12, color: T.inkSoft, margin: "4px 0 10px" }}>
                    Mode test : la création d'une clé de production devient possible dès que votre outil a réussi, avec une clé de test, ces six étapes :
                    <ol style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                      {etat.test_parcours.map(e => <li key={e.etape} style={{ color: e.faite ? T.ok : T.inkSoft }}>{e.faite ? "✓ " : ""}{e.libelle}</li>)}
                    </ol>
                  </div>
                )}
                <label style={ui.label} htmlFor="acces-api-libelle">Nom de la clé (l'outil qui l'utilise)</label>
                <input id="acces-api-libelle" style={{ ...ui.input, maxWidth: 360 }} maxLength={60} value={nouvelle.libelle} placeholder="ex. Tableur de réassort" onChange={e => setNouvelle({ ...nouvelle, libelle: e.target.value })} />
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "10px 0", fontSize: 13 }}>
                  {a.portees.map(p => (
                    <label key={p} style={{ display: "flex", gap: 6, alignItems: "center" }} title={a.libelles_portees?.[p] || ""}>
                      <input type="checkbox" checked={nouvelle.portees.includes(p)} onChange={e => setNouvelle({ ...nouvelle, portees: e.target.checked ? [...new Set([...nouvelle.portees, p])] : nouvelle.portees.filter(x => x !== p) })} />
                      {a.libelles_portees?.[p] || NOMS_DROITS[p] || p}
                    </label>
                  ))}
                </div>
                <button style={{ ...ui.btn("primaire", "s"), ...off(occupe || !nouvelle.libelle.trim() || !nouvelle.portees.length) }} disabled={occupe || !nouvelle.libelle.trim() || !nouvelle.portees.length}
                  onClick={() => agir({ action: "creer_cle", ...nouvelle }, (d) => { setSecret({ cle: d.cle, info: d.info }); setNouvelle({ ...nouvelle, libelle: "" }); })}>Créer la clé</button>
              </div>
            )}
          </section>

          <section aria-labelledby="acces-api-appels">
            <h3 id="acces-api-appels" style={titreSection}>Derniers appels</h3>
            {appels === null && <button style={ui.btn("ligne", "s")} onClick={lireAppels}>Voir mes 50 derniers appels</button>}
            {appels === "…" && <p style={{ margin: 0, color: T.inkMute }}>Chargement…</p>}
            {Array.isArray(appels) && (appels.length === 0 ? <p style={{ margin: 0, color: T.inkSoft }}>Aucun appel pour l'instant.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>{["Date", "Clé", "Requête", "Résultat", "Durée", "Identifiant (support)"].map(h => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
                  <tbody>{appels.map((l, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                      <td style={ui.td}>{dt(l.at)}</td><td style={{ ...ui.td, fontFamily: T.mono }}>{l.cle || "–"}{l.environnement === "apercu" ? " (aperçu)" : ""}</td>
                      <td style={ui.td}>{l.methode} {l.route}</td>
                      <td style={{ ...ui.td, color: l.statut >= 400 ? T.danger : T.ok }}>{l.statut}{l.code ? ` · ${l.code}` : ""}</td>
                      <td style={ui.td}>{l.duree_ms} ms</td>
                      <td style={{ ...ui.td, fontFamily: T.mono, fontSize: 11, userSelect: "all", whiteSpace: "nowrap" }} title="X-Request-Id : à donner au support d'Elixir Pharma">{l.request_id || "–"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </section>
          </>)}

          <p style={{ fontSize: 12, color: T.inkMute, marginTop: 20 }}>
            Le réassort courant reste plus simple depuis votre logiciel d'officine : l'API sert aux outils qui ne passent pas par lui.
          </p>
        </div>
      </div>
    </div>
  );
}
