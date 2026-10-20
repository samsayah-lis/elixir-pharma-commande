import React from "react";
import { JUSTIF_STATUTS } from "../lab-justif-client.js";
import { estPeremption, notePeremption } from "../peremption-panier.js";
import { T, R, ui, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";
import EtatVide, { ActionEtat, Chargement } from "./ui/EtatVide.jsx";
import FocusFenetre from "./ui/FocusFenetre.jsx";

// ── Mes commandes (refonte charte, lot 7 : docs/refonte-charte.md § 3) ──
// Fenêtre paper de rayon 28 sur voile --scrim (sans flou) ; une carte blanche par commande, comme la maquette de la
// vitrine (site/src/styles/digital.css, .commandes) : statut écrit (« Traitée » menthe + sarcelle, « En attente »,
// « Commande labo » sarcelle), montants au format français (affichage seulement), « Recommander » en pastille à filet.
// Regroupement des lignes multi-CIP, suivi des justificatifs et onReorder inchangés.
const STATUT = {
  traitee: { ton: "info", icone: "coche", libelle: "Traitée" },
  attente: { ton: "warn", icone: "horloge", libelle: "En attente" },
  labo:    { ton: "labo", icone: "document", libelle: "Commande labo" },
};
const dateLongue = (d) => new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"long" });
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
// pastille à filet des actions d'une commande (« Recommander », « Une question sur cette commande ? »)
const btnFilet = { ...ui.btn("ligne", "m"), background:undefined, color:T.petrol, boxShadow:`inset 0 0 0 1.5px ${T.lineField}` };

// onQuestion(order) (facultatif) : « Une question sur cette commande ? » ouvre l'Assistant Elixir sur cette commande
// (App ne le passe que si l'assistant est disponible pour la pharmacie)
export default function MyOrdersPanel({ orders, loading, pharmacyName, onClose, onReorder, onQuestion, erreur = null, onReconnecter = null }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="mes-commandes-titre" style={{ ...ui.overlay, zIndex:400, padding:16 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background:T.paper, color:T.ink, borderRadius:R.l, width:"100%", maxWidth:720, maxHeight:"85vh", overflow:"hidden",
        display:"flex", flexDirection:"column", boxShadow:T.shadow3,
      }}>
        <FocusFenetre />{/* revue (§ 20) : focus sur « Fermer » à l'ouverture, rendu au bouton « Mes commandes » à la fermeture */}
        {/* En-tête */}
        <div style={{ padding:"20px 20px 16px 24px", borderBottom:`1px solid ${T.line}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
          <div style={{ minWidth:0 }}>
            <h2 id="mes-commandes-titre" style={ui.titreModal}><Icone nom="commandes" taille={22} style={{ color:T.teal }} />Mes commandes</h2>
            <div className="num" style={{ fontSize:12, color:T.inkSoft, marginTop:4 }}>{pharmacyName}{loading || erreur ? "" : ` · ${pluriel(orders.length, "commande")}`}</div>
          </div>
          <button className="ex-btn-discret ex-cible" data-focus-initial onClick={onClose} aria-label="Fermer" title="Fermer" style={ui.rond(36)}><Icone nom="fermer" taille={18} /></button>
        </div>

        {/* Contenu */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 20px", background:T.cream }}>
          {/* chargement, aucune commande : composants communs (lot 8) ; « 0 commande » n'est plus annoncé pendant la lecture */}
          {loading && <Chargement texte="Chargement de vos commandes…" />}
          {/* lecture refusée (jeton absent ou expiré, compte sans pharmacie) ou en échec : jamais « Aucune commande » */}
          {!loading && erreur && (
            <EtatVide icone="commandes" erreur
              titre={erreur === "reconnexion" ? "Reconnectez-vous" : erreur === "fiche" ? "Pharmacie introuvable" : "Lecture impossible"}
              texte={erreur === "reconnexion" ? (onReconnecter ? "Pour afficher vos commandes, reconnectez-vous avec le code reçu par e-mail." : "Session admin expirée : reconnectez-vous à l'admin, puis reprenez la saisie pour cette pharmacie.")
                : erreur === "fiche" ? "Aucune pharmacie n'est rattachée à ce compte : contactez Elixir Pharma."
                : "Vos commandes n'ont pas pu être lues. Réessayez dans un instant."}
              actions={erreur === "reconnexion" && onReconnecter ? <ActionEtat principal onClick={onReconnecter}>Se reconnecter</ActionEtat> : null} />
          )}
          {!loading && !erreur && orders.length === 0 && (
            <EtatVide icone="commandes" titre="Aucune commande trouvée"
              texte="Vos commandes envoyées depuis le site apparaîtront ici, prêtes à être recommandées." />
          )}
          {/* colonne minmax(0, 1fr) : les noms de produits (une ligne, points de suspension ; deux lignes sous 768 px, classe
              ex-commande-nom, revue § 20) ne font pas déborder la carte sur mobile */}
          <ul style={{ listStyle:"none", margin:0, padding:0, display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:10 }}>
          {orders.map(order => {
            const date = new Date(order.date);
            // lignes d'un même article livré sous plusieurs CIP (même code fournisseur) : une seule ligne
            const items = (Array.isArray(order.items) ? order.items : []).reduce((acc, it) => {
              const g = it.group && acc.find(x => x.group === it.group);
              if (g) { g.qty = (Number(g.qty) || 0) + (Number(it.qty) || 0); g.total = (Number(g.total) || 0) + (Number(it.total) || 0); }
              else acc.push({ ...it });
              return acc;
            }, []);
            const statut = STATUT[order.processed ? "traitee" : order.source === "justificatif" ? "labo" : "attente"];
            return (
              <li key={order.id} style={{ background:T.surface, borderRadius:R.m, padding:"14px 16px 14px 18px", border:`1px solid ${T.line}`, boxShadow:T.shadow1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:10 }}>
                  <div style={{ minWidth:0 }}>
                    <div className="num" style={{ fontWeight:700, fontSize:14, color:T.ink }}>
                      {date.toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" })}
                      <span style={{ fontSize:12, fontWeight:500, color:T.inkMute, marginLeft:8 }}>{date.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}</span>
                    </div>
                    <div className="num" style={{ fontSize:12, color:T.inkSoft, marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                      {pluriel(items.length, "ligne")} · {items.length} réf.
                      {order.source === "justificatif" && <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:T.teal }}>· <Icone nom="document" taille={12} />sur commande laboratoire</span>}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div className="num" style={{ fontWeight:700, fontSize:16, color:T.ink }}>{order.totalHt ? fmtEur(parseFloat(order.totalHt)) : "—"}</div>
                    <span style={{ ...ui.badge(statut.ton), marginTop:4, padding:"2px 8px 2px 6px" }}>
                      <Icone nom={statut.icone} taille={12} epaisseur={2.4} />{statut.libelle}
                    </span>
                  </div>
                </div>
                {/* Lignes */}
                <div style={{ borderTop:`1px solid ${T.lineSoft}`, paddingTop:8 }}>
                  {items.slice(0, 5).map((it, j) => (
                    <div key={j} className="num" style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"3px 0", color:T.inkSoft }}>
                      <span className="ex-commande-nom" title={it.name} style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:T.ink }}>{it.name}</span>
                      {/* péremption courte : mention gardée dans la ligne enregistrée (src/peremption-panier.js) */}
                      {estPeremption(it) && <span style={{ flexShrink:0, marginLeft:8, fontWeight:600, color:T.warn }}>{notePeremption(it.peremption)}</span>}
                      <span style={{ flexShrink:0, marginLeft:12, fontWeight:600 }}>×{it.qty}</span>
                      <span style={{ flexShrink:0, marginLeft:12, fontWeight:600, minWidth:72, textAlign:"right" }}>{it.pn ? fmtEur(parseFloat(it.pn * it.qty)) : ""}</span>
                    </div>
                  ))}
                </div>
                {/* Sur justificatif labo : transmission au laboratoire */}
                {order.source === "justificatif" && (!order.processed || (order.justif || []).some(j => j.suivi && !["recue", "transmise"].includes(j.suivi.etape))) && (
                  <div style={{ ...ui.encart("labo"), marginTop:8, fontSize:12, padding:"8px 12px" }}>
                    {(order.justif || []).length
                      ? order.justif.map((j, k) => j.suivi && j.suivi.etape !== "recue"
                        ? <div key={k}>
                            <b style={{ display:"inline-flex", alignItems:"center", gap:4, color: ["refusee", "annulee"].includes(j.suivi.etape) ? T.danger : T.teal }}><Icone nom="document" taille={12} />{j.suivi.libelle}</b>{j.suivi.date ? ` le ${dateLongue(j.suivi.date)}` : ""}.
                            {j.suivi.datePrevue && !["expediee", "refusee", "annulee"].includes(j.suivi.etape) ? ` Livraison prévue le ${dateLongue(j.suivi.datePrevue)}.` : ""}
                            {j.suivi.commentaire ? <div style={{ display:"flex", alignItems:"flex-start", gap:4, color:T.inkSoft }}><Icone nom="bulle" taille={12} style={{ marginTop:2 }} />{j.suivi.commentaire}</div> : null}
                          </div>
                        : <div key={k} style={{ display:"flex", alignItems:"flex-start", gap:4 }}><Icone nom="document" taille={12} style={{ marginTop:2 }} /><span>{JUSTIF_STATUTS[j.statut] || "Enregistrée"}{j.statut === "envoye" && j.envoyeLe ? ` le ${dateLongue(j.envoyeLe)}` : ""}.</span></div>)
                      : <div style={{ display:"flex", alignItems:"flex-start", gap:4 }}><Icone nom="document" taille={12} style={{ marginTop:2 }} /><span>Commande enregistrée : Elixir la prend en charge auprès du laboratoire.</span></div>}
                    {!order.processed && !(order.justif || []).some(j => j.suivi?.datePrevue || ["refusee", "annulee"].includes(j.suivi?.etape)) && <div style={{ color:T.inkSoft, marginTop:2 }}>Livraison dès réception de la marchandise du laboratoire.</div>}
                  </div>
                )}
                {/* Recommander (pastille à filet, comme la maquette de la vitrine ; 44 px sous 768 px, ex-tactile, lot 9) */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginTop:10, flexWrap:"wrap" }}>
                  <span className="num" style={{ fontSize:12, color:T.inkMute }}>{items.length > 5 ? `+ ${items.length - 5} autre${items.length - 5 > 1 ? "s" : ""}…` : ""}</span>
                  <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"flex-end", gap:8, marginLeft:"auto", minWidth:0 }}>
                    {/* Assistant Elixir : bouton à filet ; libellé sur deux lignes si la carte est étroite (375 px) */}
                    {onQuestion && (
                      <button className="ex-btn-ligne ex-tactile" onClick={() => onQuestion(order)}
                        style={{ ...btnFilet, height:"auto", minHeight:36, whiteSpace:"normal", lineHeight:1.25, padding:"6px 16px", textAlign:"left" }}>
                        <Icone nom="bulle" taille={16} epaisseur={2.2} />Une question sur cette commande ?
                      </button>
                    )}
                    <button className="ex-btn-ligne ex-tactile" onClick={() => onReorder(items)} style={btnFilet}>
                      <Icone nom="recommander" taille={16} epaisseur={2.4} />Recommander cette commande
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          </ul>
        </div>
      </div>
    </div>
  );
}
