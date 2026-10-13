import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import JustifCartBlock from "./JustifCartBlock";
import { loadJustifProducts, justifIssues, commanderJustif, mesDemandesJustif, JUSTIF_STATUTS, rxFrais } from "../lab-justif-client.js";

// ── Page « Commande labo sur justificatif » ─────────────────────────────
// Produits que certains laboratoires (Takeda, Pfizer…) ne livrent à Elixir que sur justificatif d'une
// commande de pharmacie : la pharmacie choisit ses produits, atteste « patient en France », joint
// l'ordonnance anonymisée si elle le souhaite (ou si le labo l'exige) et transmet. Elixir commande au
// laboratoire avec ce justificatif et livre à réception. Un produit en stock chez Elixir se commande
// normalement (panier). Réglages des labos et des produits : admin, onglet « Justificatifs labos ».
const fmt = (n) => n != null ? Number(n).toFixed(2).replace(".", ",") + " €" : "–";
const card = { background: "white", borderRadius: 14, padding: "18px 22px", border: "1px solid #e8ecf0" };
const h2 = { fontSize: 13, fontWeight: 800, color: "#0f2d3d", letterSpacing: 0.3, textTransform: "uppercase", margin: "0 0 12px" };
const btn = (bg, color = "white") => ({ background: bg, color, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const qteInput = { width: 56, border: "1.5px solid #d6dde3", borderRadius: 8, padding: "6px 8px", fontSize: 14, fontWeight: 700, textAlign: "center", fontFamily: "inherit" };
const nouvelId = () => String(Date.now());   // 13 chiffres
// demande gardée pour l'onglet ; un dépôt d'ordonnance interrompu ou trop ancien (36 h) est retiré
const relire = (cle) => {
  try {
    const d = JSON.parse(sessionStorage.getItem(cle) || "null");
    if (!d?.id || typeof d.lignes !== "object") return null;
    for (const c of Object.keys(d.info || {})) d.info[c] = { ...d.info[c], rx: (Array.isArray(d.info[c]?.rx) ? d.info[c].rx : []).filter(rxFrais) };
    return { lignes: d.lignes || {}, info: d.info || {}, id: d.id, verrou: d.verrou || null };
  } catch { return null; }
};
const dateFr = (s) => s ? new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

export default function LabJustifOrder({ auth, identite, onAddToCart, onOrdered }) {
  const [products, setProducts] = useState(null);       // { cip: règle + nom, prix, dispo }
  const [erreurProduits, setErreurProduits] = useState("");
  // demande en cours, gardée pour l'onglet (une ordonnance déposée n'est pas perdue en changeant de page)
  const cleDemande = `justif_demande_${identite || "anonyme"}`;
  // verrou : envoi au résultat inconnu (coupure, panne) → contenu figé tant qu'on n'a pas renvoyé ou vérifié
  const [demande, setDemande] = useState(() => relire(cleDemande) || { lignes: {}, info: {}, id: nouvelId(), verrou: null });
  const [envoi, setEnvoi] = useState({ busy: false, erreur: "", ok: null });
  const [sansFiche, setSansFiche] = useState("");
  const [brouillon, setBrouillon] = useState({});   // quantité en cours de saisie (champ vide permis)
  const [demandes, setDemandes] = useState(null);
  const [ajoute, setAjoute] = useState("");
  const authRef = useRef(auth); authRef.current = auth;

  useEffect(() => { try { sessionStorage.setItem(cleDemande, JSON.stringify(demande)); } catch {} }, [demande, cleDemande]);
  useEffect(() => {
    let fini = false;
    loadJustifProducts({ fresh: true }).then(p => { if (fini) return; if (p) setProducts(p); else { setProducts({}); setErreurProduits("Liste des produits indisponible pour le moment : réessayez dans quelques minutes."); } });
    return () => { fini = true; };
  }, []);
  const chargerDemandes = useCallback(() => {
    mesDemandesJustif(authRef.current).then(setDemandes).catch(e => { if (e.sansFiche) setSansFiche(e.message); setDemandes({ erreur: e.message }); });
  }, []);
  useEffect(() => { chargerDemandes(); }, [chargerDemandes, identite]);

  // produits par laboratoire
  const parLab = useMemo(() => {
    const g = {};
    for (const [cip, p] of Object.entries(products || {})) (g[p.labNom] ||= []).push({ cip, ...p });
    for (const l of Object.values(g)) l.sort((a, b) => String(a.nom).localeCompare(String(b.nom)));
    return g;
  }, [products]);

  const lignes = Object.entries(demande.lignes).filter(([cip]) => products?.[cip]);
  const items = lignes.map(([cip, qte]) => ({ cip, name: products[cip].nom, qty: qte }));
  // contrôles du panier (attestation, ordonnance obligatoire ou trop ancienne, maximum par commande), appliqués à
  // toutes les lignes de la page (le stock ne les dispense pas), + prix connu et produit toujours en rupture
  const sansStock = useMemo(() => Object.fromEntries(Object.entries(products || {}).map(([c, p]) => [c, { ...p, dispo: 0 }])), [products]);
  const manques = products ? [
    ...justifIssues(items, sansStock, demande.info),
    ...items.filter(i => products[i.cip].prix == null).map(i => ({ cip: i.cip, name: i.name, msg: "prix à confirmer : contactez Elixir" })),
    ...items.filter(i => products[i.cip].dispo >= i.qty).map(i => ({ cip: i.cip, name: i.name, msg: "désormais en stock chez Elixir : retirez-le et ajoutez-le au panier (commande normale)" })),
  ] : [];
  const verrou = !!demande.verrou;
  const total = lignes.reduce((t, [cip, q]) => t + (products[cip].prix || 0) * q, 0);

  const majLigne = (cip, qte) => setDemande(d => {
    if (d.verrou) return d;
    const l = { ...d.lignes };
    if (qte > 0) l[cip] = qte; else delete l[cip];
    const info = { ...d.info }; if (!(qte > 0)) delete info[cip];
    return { ...d, lignes: l, info };
  });
  const majInfo = (cip) => (patch) => setDemande(d => {
    if (d.verrou) return d;
    const prev = d.info[cip] || {};
    const p = typeof patch === "function" ? patch(prev) : patch;
    return { ...d, info: { ...d.info, [cip]: { ...prev, ...p } } };
  });
  const maxDe = (p) => p.maxCommande || 20;

  const reussite = (r) => {
    setEnvoi({ busy: false, erreur: "", ok: { orderId: r.order_id, demandes: r.demandes || [], lignes: r.items || items, deja: !!r.deja } });
    setDemande({ lignes: {}, info: {}, id: nouvelId(), verrou: null });   // nouvelle demande, nouveau numéro
    setBrouillon({});
    chargerDemandes();
    onOrdered?.();
  };
  const transmettre = async () => {
    if (envoi.busy || !lignes.length || manques.length) return;
    setEnvoi({ busy: true, erreur: "", ok: null });
    try {
      reussite(await commanderJustif(demande.id, lignes.map(([cip, qte]) => ({ cip, qte,
        attestation: !!demande.info[cip]?.attestation, renouvellement: !!demande.info[cip]?.renouvellement,
        rx: (demande.info[cip]?.rx || []).map(x => x.id).filter(Boolean) })), auth));
    } catch (e) {
      if (e.sansFiche) { setSansFiche(e.message); setEnvoi({ busy: false, erreur: "", ok: null }); return; }
      if (e.code === "contenu") {
        // ce numéro est déjà enregistré (envoi précédent) avec un autre contenu : il est fait ; la demande en
        // cours repart sous un nouveau numéro si la pharmacie la renvoie
        setDemande(d => ({ ...d, id: nouvelId(), verrou: null }));
        setEnvoi({ busy: false, erreur: `${e.message}. Cette commande-là est bien enregistrée (voir « Mes demandes ») ; si votre demande ci-dessous est en plus, renvoyez-la.`, ok: null });
        chargerDemandes();
        return;
      }
      if (e.code === "numero") { setDemande(d => ({ ...d, id: nouvelId(), verrou: null })); setEnvoi({ busy: false, erreur: "Numéro de demande indisponible : renvoyez-la.", ok: null }); return; }
      // refus explicite (400) : rien n'est enregistré, on peut corriger ; panne ou coupure : résultat inconnu →
      // contenu figé, même numéro au renvoi (jamais une 2e commande)
      const inconnu = !(e.status >= 400 && e.status < 500);
      if (inconnu) setDemande(d => ({ ...d, verrou: { at: Date.now() } }));
      setEnvoi({ busy: false, erreur: inconnu ? `${e.message} — résultat inconnu : renvoyez la demande telle quelle (elle ne sera jamais enregistrée deux fois)` : e.message, ok: null });
    }
  };
  // abandon après un envoi au résultat inconnu : vérifier d'abord si la demande est arrivée
  const abandonner = async () => {
    setEnvoi(v => ({ ...v, busy: true }));
    try {
      const ds = await mesDemandesJustif(authRef.current);
      setDemandes(ds);
      if (ds.some(d => String(d.orderId) === String(demande.id))) {
        reussite({ order_id: demande.id, deja: true, demandes: ds.filter(d => String(d.orderId) === String(demande.id)), items });
        return;
      }
      setDemande(d => ({ ...d, id: nouvelId(), verrou: null }));
      setEnvoi({ busy: false, erreur: "", ok: null });
    } catch (e) { setEnvoi({ busy: false, erreur: `Vérification impossible (${e.message}) : réessayez`, ok: null }); }
  };
  const champQte = (cip, p, choisi) => (
    <input type="number" inputMode="numeric" min="1" max={maxDe(p)} value={brouillon[cip] ?? choisi} disabled={verrou} aria-label={`Quantité ${p.nom}`} style={qteInput}
      onChange={e => { const v = e.target.value; setBrouillon(b => ({ ...b, [cip]: v })); const n = parseInt(v); if (n >= 1) majLigne(cip, Math.min(maxDe(p), n)); }}
      onBlur={() => { const n = parseInt(brouillon[cip]); if (brouillon[cip] !== undefined) majLigne(cip, Math.max(1, Math.min(maxDe(p), n >= 1 ? n : choisi))); setBrouillon(b => { const { [cip]: _, ...r } = b; return r; }); }} />
  );

  const ajouterPanier = (p, qte) => {
    if (p.prix == null) return;   // jamais de ligne de panier sans prix
    onAddToCart?.({ cip: p.cip, name: p.nom, qty: qte, pn: p.prix, pv: p.prix });
    setAjoute(p.cip); setTimeout(() => setAjoute(a => (a === p.cip ? "" : a)), 2500);
  };

  // compte non relié à une fiche client Elixir : rien ne peut être enregistré, pas de formulaire
  if (sansFiche) return (
    <div style={{ maxWidth: 980 }}>
      <div role="alert" style={{ ...card, background: "#fff7ed", borderColor: "#fed7aa", color: "#9a3412", fontSize: 14 }}>📑 Commande laboratoire sur justificatif — ⚠ {sansFiche}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      <div style={{ ...card, background: "linear-gradient(135deg,#2e1065,#5b21b6)", color: "white", border: "none" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>📑 Commande laboratoire sur justificatif</div>
        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6, lineHeight: 1.55 }}>
          Certains laboratoires ne livrent Elixir que sur justificatif d'une commande de pharmacie, pour un patient en France.
          Choisissez vos produits, cochez l'attestation et joignez, si vous le souhaitez, l'ordonnance <b>anonymisée</b> :
          Elixir transmet votre commande au laboratoire comme justificatif et vous livre dès réception.
        </div>
      </div>

      {envoi.ok && (
        <div role="status" style={{ ...card, background: "#ecfdf5", borderColor: "#a7f3d0" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#065f46" }}>✓ Demande {envoi.ok.deja ? "bien enregistrée" : "transmise à Elixir"} (commande n° {envoi.ok.orderId})</div>
          <div style={{ fontSize: 13, color: "#065f46", marginTop: 6 }}>{envoi.ok.lignes.map(i => `${i.qty} × ${i.name}`).join(" · ")}</div>
          {envoi.ok.demandes.map(d => (
            <div key={d.id} style={{ fontSize: 12, color: "#047857", marginTop: 4 }}>📑 {JUSTIF_STATUTS[d.statut] || "Enregistrée"}</div>
          ))}
          <div style={{ fontSize: 12, color: "#047857", marginTop: 6 }}>Suivi ci-dessous, rubrique « Mes demandes », et dans « Mes commandes ».</div>
        </div>
      )}

      <div style={card}>
        <h2 style={h2}>Produits concernés</h2>
        {!products ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
          : erreurProduits ? <div style={{ color: "#b91c1c", fontSize: 13 }}>⚠ {erreurProduits}</div>
          : !Object.keys(parLab).length ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Aucun produit sur justificatif pour le moment.</div>
          : Object.entries(parLab).map(([lab, ps]) => (
            <div key={lab} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#5b21b6", margin: "6px 0 2px" }}>{lab}</div>
              {ps[0]?.delai && <div style={{ fontSize: 11.5, color: "#6d28d9", marginBottom: 6 }}>{ps[0].delai}</div>}
              {ps.map(p => {
                const enStock = p.dispo > 0;
                const choisi = demande.lignes[p.cip];
                return (
                  <div key={p.cip} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>{p.nom}</div>
                      <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>{p.cip}{p.maxCommande ? <span style={{ fontFamily: "inherit" }}> · {p.maxCommande} au plus par commande</span> : null}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f2d3d", minWidth: 90, textAlign: "right" }}>{fmt(p.prix)}<div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>prix net HT</div></div>
                    {choisi ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {champQte(p.cip, p, choisi)}
                        <button onClick={() => majLigne(p.cip, 0)} disabled={verrou} style={{ ...btn("#f1f5f9", "#475569"), opacity: verrou ? 0.5 : 1 }}>Retirer</button>
                      </div>
                    ) : p.prix == null ? (
                      <span style={{ fontSize: 11.5, color: "#92400e" }}>Prix à confirmer : contactez Elixir</span>
                    ) : enStock ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "#065f46", background: "#d1fae5", borderRadius: 8, padding: "3px 8px" }}>En stock chez Elixir</span>
                        <button onClick={() => ajouterPanier(p, 1)} style={btn(ajoute === p.cip ? "#059669" : "#0f2d3d")}>{ajoute === p.cip ? "✓ Ajouté" : "+ Panier"}</button>
                      </div>
                    ) : (
                      <button onClick={() => majLigne(p.cip, 1)} disabled={verrou} style={{ ...btn("#5b21b6"), opacity: verrou ? 0.5 : 1 }}>Ajouter à ma demande</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      <div style={card}>
        <h2 style={h2}>Ma demande</h2>
        {!lignes.length ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Ajoutez un ou plusieurs produits ci-dessus.</div> : (
          <>
            {lignes.map(([cip, qte]) => {
              const p = products[cip];
              return (
                <div key={cip} style={{ padding: "10px 0", borderTop: "1px solid #f1f5f9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {champQte(cip, p, qte)}
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>× {p.nom} <span style={{ color: "#64748b", fontWeight: 500 }}>({p.labNom})</span></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.prix != null ? p.prix * qte : null)}</div>
                      <button onClick={() => majLigne(cip, 0)} disabled={verrou} title="Retirer de la demande" style={{ ...btn("#f1f5f9", "#475569"), padding: "5px 9px", opacity: verrou ? 0.5 : 1 }}>✕</button>
                    </div>
                  </div>
                  <div style={verrou ? { pointerEvents: "none", opacity: 0.6 } : undefined}>
                    <JustifCartBlock rule={p} info={demande.info[cip] || {}} onChange={majInfo(cip)} auth={auth} />
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e2e8f0" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f2d3d" }}>Total net HT : {fmt(total)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {verrou && <button onClick={abandonner} disabled={envoi.busy} style={{ ...btn("#f1f5f9", "#475569"), opacity: envoi.busy ? 0.55 : 1 }}>Vérifier / modifier la demande</button>}
                <button onClick={transmettre} disabled={envoi.busy || !!manques.length}
                  style={{ ...btn("#5b21b6"), padding: "10px 18px", fontSize: 14, opacity: envoi.busy || manques.length ? 0.55 : 1, cursor: envoi.busy || manques.length ? "not-allowed" : "pointer" }}>
                  {envoi.busy ? "Transmission…" : verrou ? "↻ Renvoyer la demande" : "📑 Transmettre ma demande"}
                </button>
              </div>
            </div>
            {manques.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#b45309" }}>
                {manques.map((m, i) => <li key={i}>{m.name} : {m.msg}</li>)}
              </ul>
            )}
            {envoi.erreur && <div role="alert" style={{ fontSize: 13, color: "#b91c1c", marginTop: 8 }}>⚠ {envoi.erreur}</div>}
            {verrou && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Demande figée tant que son envoi n'est pas confirmé : « Renvoyer » (sans risque de doublon) ou « Vérifier / modifier » (contrôle dans « Mes demandes », puis modification possible).</div>}
          </>
        )}
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ ...h2, margin: 0 }}>Mes demandes</h2>
          <button onClick={chargerDemandes} style={{ ...btn("#f1f5f9", "#0f2d3d"), padding: "5px 10px", fontSize: 12 }}>↻ Actualiser</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {demandes === null ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
            : demandes.erreur ? <div style={{ color: "#b91c1c", fontSize: 13 }}>⚠ {demandes.erreur}</div>
            : !demandes.length ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Aucune demande pour le moment.</div>
            : demandes.map(d => (
              <div key={d.id} style={{ padding: "8px 0", borderTop: "1px solid #f1f5f9", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div><b>{dateFr(d.date)}</b> · {d.labNom} · {d.lignes.map(l => `${l.qte} × ${l.produit}`).join(", ")}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>n° {d.orderId}{d.rx ? ` · 📎 ${d.rx} ordonnance(s)` : ""}</div>
                </div>
                <div style={{ fontSize: 12, color: d.statut === "envoye" ? "#065f46" : "#6d28d9", marginTop: 2 }}>
                  📑 {JUSTIF_STATUTS[d.statut] || "Enregistrée"}{d.statut === "envoye" && d.envoyeLe ? ` le ${dateFr(d.envoyeLe)}` : ""}
                  {d.aCompleter === "ordonnance" ? " — ordonnance anonymisée manquante : contactez Elixir pour la transmettre" : ""}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
