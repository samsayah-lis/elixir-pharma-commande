import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import JustifCartBlock from "./JustifCartBlock";
import { loadJustifProducts, justifIssues, commanderJustif, mesDemandesJustif, JUSTIF_STATUTS, SUIVI_ORDRE, rxFrais } from "../lab-justif-client.js";
import { T, R, ui, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";
import EnteteVue from "./ui/EnteteVue.jsx";

// ── Page « Commande labo sur justificatif » ─────────────────────────────
// Produits que certains laboratoires (Takeda, Pfizer…) ne livrent à Elixir que sur justificatif d'une
// commande de pharmacie : la pharmacie choisit ses produits, atteste « patient en France », joint
// l'ordonnance anonymisée si elle le souhaite (ou si le labo l'exige) et transmet. Elixir commande au
// laboratoire avec ce justificatif et livre à réception. Un produit en stock chez Elixir se commande
// normalement (panier). Réglages des labos et des produits : admin, onglet « Justificatifs labos ».
// Refonte charte (lot 7) : en-tête de vue commun, atomes de theme.js, ton « labo » sarcelle (décision de la cliente :
// justificatif et précommande en sarcelle, plus de violet), montants au format français (affichage seulement : la demande
// envoyée garde ses quantités, rien ne passe par fmt). Demande, verrou, envoi et sessionStorage inchangés.
const fmt = (n) => n != null ? fmtEur(Number(n)) : "–";
const card = ui.card;
const h2 = ui.h2;
// boutons pastille : pétrole (action), à filet (secondaire) ; fond et survol par les classes ex-btn-petrole / ex-btn-ligne
const btnPetrole = { ...ui.btn("primaire", "m"), background: undefined, color: undefined };
const btnLigne = { ...ui.btn("ligne", "m"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}` };
const btnInactif = { background: T.sand, color: T.inkSoft, boxShadow: "none", cursor: "not-allowed" };
const qteInput = { ...ui.qtyInput(true), width: 56, height: 34, fontSize: 14 };
const ligneIcone = { display: "flex", alignItems: "flex-start", gap: 6 };   // icône calée sur la première ligne du texte
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

// icone, couleur : icône et couleur du menu (App), comme l'en-tête du catalogue
export default function LabJustifOrder({ auth, identite, onAddToCart, onOrdered, icone, couleur }) {
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
      <div role="alert" style={{ ...ui.encart("warn"), ...ligneIcone, fontSize: 14, padding: "14px 18px" }}><Icone nom="alerte" taille={16} style={{ marginTop: 2 }} /><span>Commande laboratoire sur justificatif — {sansFiche}</span></div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      {/* En-tête de vue commun (lot 7) au lieu du bandeau violet ; consigne d'anonymisation en encart sarcelle */}
      <EnteteVue
        icone={icone || <Icone nom="document" taille={24} />}
        couleur={couleur}
        titre="Commande laboratoire sur justificatif"
        sousTitre={<>
          Certains laboratoires ne livrent Elixir que sur justificatif d'une commande de pharmacie, pour un patient en France.
          Le justificatif, c'est votre commande accompagnée de l'<b>ordonnance anonymisée</b> du patient.
          Choisissez vos produits, cochez l'attestation et joignez l'ordonnance anonymisée (photo ou PDF) :
          Elixir la transmet au laboratoire avec votre commande et vous livre dès réception.
        </>}
        style={{ marginBottom: 0 }}
      >
        <div style={{ ...ui.encart("labo"), ...ligneIcone, fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          <Icone nom="cadenas" taille={14} style={{ marginTop: 2 }} />
          <span><b>Ordonnance anonymisée</b> : masquez le nom, le prénom, la date de naissance et le n° de sécurité sociale du patient
          (au feutre avant la photo, ou en cachant la zone sur le PDF). Gardez visibles le médicament, la posologie, la date et le prescripteur.</span>
        </div>
      </EnteteVue>

      {envoi.ok && (
        <div role="status" style={{ ...ui.encart("ok"), padding: "16px 20px", borderRadius: R.m }}>
          <div className="num" style={{ ...ligneIcone, fontSize: 15, fontWeight: 700 }}><Icone nom="coche" taille={18} epaisseur={2.4} style={{ marginTop: 1 }} />Demande {envoi.ok.deja ? "bien enregistrée" : "transmise à Elixir"} (commande n° {envoi.ok.orderId})</div>
          <div className="num" style={{ fontSize: 13, marginTop: 6 }}>{envoi.ok.lignes.map(i => `${i.qty} × ${i.name}`).join(" · ")}</div>
          {envoi.ok.demandes.map(d => (
            <div key={d.id} style={{ ...ligneIcone, fontSize: 12, marginTop: 4 }}><Icone nom="document" taille={13} style={{ marginTop: 2 }} />{JUSTIF_STATUTS[d.statut] || "Enregistrée"}</div>
          ))}
          <div style={{ fontSize: 12, marginTop: 6 }}>Suivi ci-dessous, rubrique « Mes demandes », et dans « Mes commandes ».</div>
        </div>
      )}

      <div style={card}>
        <h2 style={h2}>Produits concernés</h2>
        {!products ? <div role="status" style={{ color: T.inkMute, fontSize: 13 }}>Chargement…</div>
          : erreurProduits ? <div style={{ ...ligneIcone, color: T.danger, fontSize: 13 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} />{erreurProduits}</div>
          : !Object.keys(parLab).length ? <div style={{ color: T.inkSoft, fontSize: 13 }}>Aucun produit sur justificatif pour le moment.</div>
          : Object.entries(parLab).map(([lab, ps]) => (
            <div key={lab} style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 640, color: T.teal, margin: "6px 0 2px" }}>{lab}</h3>
              {ps[0]?.delai && <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 6 }}>{ps[0].delai}</div>}
              {ps.map(p => {
                const enStock = p.dispo > 0;
                const choisi = demande.lignes[p.cip];
                return (
                  <div key={p.cip} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${T.lineSoft}` }}>
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{p.nom}</div>
                      <div className="num" style={{ fontSize: 12, color: T.inkMute, fontFamily: T.mono }}>{p.cip}{p.maxCommande ? <span style={{ fontFamily: "inherit" }}> · {p.maxCommande} au plus par commande</span> : null}</div>
                    </div>
                    <div className="num" style={{ fontSize: 14, fontWeight: 700, color: T.ink, minWidth: 100, textAlign: "right" }}>{fmt(p.prix)}<div style={{ fontSize: 11, color: T.inkMute, fontWeight: 500 }}>prix net HT</div></div>
                    {choisi ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {champQte(p.cip, p, choisi)}
                        <button className={verrou ? undefined : "ex-btn-ligne"} onClick={() => majLigne(p.cip, 0)} disabled={verrou} style={{ ...btnLigne, ...(verrou ? btnInactif : {}) }}>Retirer</button>
                      </div>
                    ) : p.prix == null ? (
                      <span style={{ fontSize: 12, color: T.warn }}>Prix à confirmer : contactez Elixir</span>
                    ) : enStock ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ ...ui.badge("ok"), padding: "2px 8px 2px 6px" }}><Icone nom="coche" taille={12} epaisseur={2.4} />En stock chez Elixir</span>
                        {ajoute === p.cip
                          ? <button onClick={() => ajouterPanier(p, 1)} style={{ ...ui.btn("primaire", "m"), background: T.ok, color: "#fff" }}><Icone nom="coche" taille={14} epaisseur={2.4} />Ajouté</button>
                          : <button className="ex-btn-petrole" onClick={() => ajouterPanier(p, 1)} aria-label={`Ajouter ${p.nom} au panier`} style={btnPetrole}><Icone nom="plus" taille={14} epaisseur={2.4} />Panier</button>}
                      </div>
                    ) : (
                      <button className={verrou ? undefined : "ex-btn-petrole"} onClick={() => majLigne(p.cip, 1)} disabled={verrou} style={{ ...btnPetrole, ...(verrou ? btnInactif : {}) }}>Ajouter à ma demande</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      <div style={card}>
        <h2 style={h2}>Ma demande</h2>
        {!lignes.length ? <div style={{ color: T.inkSoft, fontSize: 13 }}>Ajoutez un ou plusieurs produits ci-dessus.</div> : (
          <>
            {lignes.map(([cip, qte]) => {
              const p = products[cip];
              return (
                <div key={cip} style={{ padding: "12px 0", borderTop: `1px solid ${T.lineSoft}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {champQte(cip, p, qte)}
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>× {p.nom} <span style={{ color: T.inkSoft, fontWeight: 400 }}>({p.labNom})</span></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="num" style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{fmt(p.prix != null ? p.prix * qte : null)}</div>
                      <button className="ex-btn-discret" onClick={() => majLigne(cip, 0)} disabled={verrou} title="Retirer de la demande" aria-label={`Retirer ${p.nom} de la demande`}
                        style={{ ...ui.rond(32), opacity: verrou ? 0.5 : 1, cursor: verrou ? "not-allowed" : "pointer" }}><Icone nom="fermer" taille={14} epaisseur={2.4} /></button>
                    </div>
                  </div>
                  <div style={verrou ? { pointerEvents: "none", opacity: 0.6 } : undefined}>
                    <JustifCartBlock rule={p} info={demande.info[cip] || {}} onChange={majInfo(cip)} auth={auth} />
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
              <div className="num" style={{ fontSize: 13, color: T.inkSoft }}>Total net HT : <b style={{ fontSize: 20, fontWeight: 700, color: T.ink, marginLeft: 4 }}>{fmt(total)}</b></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {verrou && <button className={envoi.busy ? undefined : "ex-btn-ligne"} onClick={abandonner} disabled={envoi.busy} style={{ ...btnLigne, height: 48, ...(envoi.busy ? btnInactif : {}) }}>Vérifier / modifier la demande</button>}
                {/* action principale de la page : pastille pétrole de 48 px ; bloquée (pièce manquante, envoi) : sable + encre adoucie */}
                <button className={envoi.busy || manques.length ? undefined : "ex-btn-petrole"} onClick={transmettre} disabled={envoi.busy || !!manques.length}
                  style={{ ...ui.btn("primaire", "l"), background: undefined, color: undefined, ...(envoi.busy || manques.length ? btnInactif : {}), ...(envoi.busy ? { cursor: "wait" } : {}) }}>
                  <Icone nom={envoi.busy ? "horloge" : verrou ? "actualiser" : "envoyer"} taille={18} />
                  {envoi.busy ? "Transmission…" : verrou ? "Renvoyer la demande" : "Transmettre ma demande"}
                </button>
              </div>
            </div>
            {manques.length > 0 && (
              <ul style={{ ...ui.encart("warn"), margin: "10px 0 0", paddingLeft: 30, fontSize: 12 }}>
                {manques.map((m, i) => <li key={i}>{m.name} : {m.msg}</li>)}
              </ul>
            )}
            {envoi.erreur && <div role="alert" style={{ ...ui.encart("danger"), ...ligneIcone, marginTop: 10 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} /><span>{envoi.erreur}</span></div>}
            {verrou && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 6 }}>Demande figée tant que son envoi n'est pas confirmé : « Renvoyer » (sans risque de doublon) ou « Vérifier / modifier » (contrôle dans « Mes demandes », puis modification possible).</div>}
          </>
        )}
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 style={{ ...h2, margin: 0 }}>Mes demandes</h2>
          <button className="ex-btn-ligne" onClick={chargerDemandes} style={{ ...btnLigne, ...ui.btn("ligne", "s"), background: undefined, boxShadow: btnLigne.boxShadow, fontSize: 12 }}><Icone nom="actualiser" taille={14} />Actualiser</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {demandes === null ? <div role="status" style={{ color: T.inkMute, fontSize: 13 }}>Chargement…</div>
            : demandes.erreur ? <div style={{ ...ligneIcone, color: T.danger, fontSize: 13 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} />{demandes.erreur}</div>
            : !demandes.length ? <div style={{ color: T.inkSoft, fontSize: 13 }}>Aucune demande pour le moment.</div>
            : demandes.map(d => (
              <div key={d.id} style={{ padding: "10px 0", borderTop: `1px solid ${T.lineSoft}`, fontSize: 13, color: T.ink }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div className="num"><b style={{ fontWeight: 700 }}>{dateFr(d.date)}</b> · {d.labNom} · {d.lignes.map(l => `${l.qte} × ${l.produit}`).join(", ")}</div>
                  <div className="num" style={{ fontSize: 12, color: T.inkMute, display: "inline-flex", alignItems: "center", gap: 4 }}>n° {d.orderId}{d.rx ? <> · <Icone nom="trombone" taille={12} />{d.rx} ordonnance(s)</> : ""}</div>
                </div>
                {d.suivi && d.suivi.etape !== "recue" ? <SuiviDemande suivi={d.suivi} /> : (
                  <div style={{ ...ligneIcone, fontSize: 12, color: d.statut === "envoye" ? T.ok : T.teal, marginTop: 4 }}>
                    <Icone nom="document" taille={13} style={{ marginTop: 1 }} /><span>{JUSTIF_STATUTS[d.statut] || "Enregistrée"}{d.statut === "envoye" && d.envoyeLe ? ` le ${dateFr(d.envoyeLe)}` : ""}</span>
                  </div>
                )}
                {d.aCompleter === "ordonnance" && <div style={{ ...ligneIcone, fontSize: 12, color: T.warn, marginTop: 4 }}><Icone nom="alerte" taille={13} style={{ marginTop: 1 }} />Ordonnance anonymisée manquante : contactez Elixir pour la transmettre.</div>}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// Frise de suivi d'une demande : reçue → transmise → acceptée → reçue chez Elixir → expédiée (ou refusée / annulée)
// Lot 7 : étapes atteintes en sarcelle (l'étape en cours plus foncée), à venir en filet ; refus en ton danger
function SuiviDemande({ suivi }) {
  const atteintes = new Map((suivi.frise || []).map(e => [e.etape, e]));
  const fin = ["refusee", "annulee"].includes(suivi.etape);
  const rang = Math.max(-1, ...SUIVI_ORDRE.map(([k], i) => atteintes.has(k) ? i : -1));
  const dateCourte = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
  return (
    <div style={{ marginTop: 6 }}>
      {fin ? (
        <div style={{ ...ligneIcone, fontSize: 12, fontWeight: 700, color: T.danger }}><Icone nom="fermer" taille={13} epaisseur={2.6} style={{ marginTop: 1 }} />{suivi.libelle}{suivi.date ? ` le ${dateCourte(suivi.date)}` : ""}</div>
      ) : (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SUIVI_ORDRE.map(([k, t], i) => {
            const fait = i <= rang, courant = i === rang;
            return (
              <div key={k} style={{ flex: "1 1 90px", minWidth: 90, borderTop: `3px solid ${fait ? (courant ? T.teal : T.mint2) : T.line}`, paddingTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: courant ? 700 : 600, color: fait ? T.teal : T.inkMute }}>{fait && <Icone nom="coche" taille={11} epaisseur={2.8} />}{t}</div>
                {fait && atteintes.get(k)?.date && <div className="num" style={{ fontSize: 11, color: T.inkMute }}>{dateCourte(atteintes.get(k).date)}</div>}
              </div>
            );
          })}
        </div>
      )}
      {suivi.datePrevue && !fin && suivi.etape !== "expediee" && (
        <div style={{ ...ligneIcone, fontSize: 12, fontWeight: 600, color: T.teal, marginTop: 6 }}><Icone nom="calendrier" taille={13} style={{ marginTop: 1 }} />Livraison prévue le {new Date(suivi.datePrevue).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
      )}
      {suivi.commentaire && <div style={{ ...ligneIcone, fontSize: 12, color: T.inkSoft, marginTop: 6, background: T.surface2, borderRadius: R.s, padding: "6px 10px" }}><Icone nom="bulle" taille={13} style={{ marginTop: 1 }} /><span>Elixir : {suivi.commentaire}</span></div>}
    </div>
  );
}
