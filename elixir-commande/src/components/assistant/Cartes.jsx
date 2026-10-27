// ── Assistant Elixir : cartes construites par le serveur (ui_actions, docs/assistant-contrat.md « Cartes UiAction ») ──
// Les chiffres qui font foi sont ceux des cartes (lus par le serveur), jamais ceux du texte du modèle. Montants en
// euros (nombres, signés pour les avoirs), dates AAAA-MM-JJ. Aucun lien, sauf « Appeler » (tel: posé à partir du
// numéro de la carte de transmission). L'or reste réservé à « Envoyer la commande » : « Confirmer » est pétrole.
// outils = { telecharger(id, nom, rang), envoyer(texte), preremplir(texte), decider(demandeId, decision, { prevenir }),
//            etatDemande(demandeId), occupe, apercuFichiers, saisieElixir }
import React, { useState } from "react";
import { T, R, ui, fmtEur } from "../../theme.js";
import { Icone } from "../../icons.jsx";
import CipCell from "../ui/CipCell.jsx";       // CIP copié d'un clic (docs/cip-copie.md), non sélectionnable (anti-copie § 19)
import CopieCips from "../ui/CopieCips.jsx";   // « Copier les CIP » d'une commande, quantités servies (données de la pharmacie)
import { dateFr, dateHeureFr, heureFr, peremptionFr, qteFr, tauxFr, pluriel, libelle, MOTIFS, SOUHAITS, ORIGINES, PIECES, lienTel } from "./format.js";

const titreCarte = { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: T.petrol, lineHeight: 1.3 };
const meta = { fontSize: 12, color: T.inkSoft, marginTop: 2 };
const encartCarte = (ton) => ({ ...ui.encart(ton), marginTop: 8, display: "flex", alignItems: "flex-start", gap: 8 });
const nomPiece = (piece, numero) => `${libelle(PIECES, piece) || "Document"} ${numero || ""}`.trim();
const nomTelechargement = (base) => `${String(base || "document").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "")}`;

// Téléchargements d'une carte : un seul à la fois, erreur affichée sous les boutons. rang : un seul des bons de livraison
// d'une même autorisation (sinon tous, en un seul PDF)
const cleFichier = (id, rang) => (rang == null ? id : `${id}:${rang}`);
function useTelechargement(outils) {
  const [enCours, setEnCours] = useState(null);
  const [erreur, setErreur] = useState("");
  const lance = async (id, nom, rang = null) => {
    if (enCours) return;
    setErreur("");
    if (outils.apercuFichiers) { setErreur("Aperçu : aucun fichier n'est produit ici."); return; }
    setEnCours(cleFichier(id, rang));
    try { await outils.telecharger(id, nom, rang); }
    catch (e) { setErreur(e.message || "Téléchargement impossible : réessayez."); }
    setEnCours(null);
  };
  return { enCours, erreur, lance };
}
function BoutonFichier({ t, id, rang = null, nom, children, principal = false, aria, petit = false }) {
  const occupe = t.enCours === cleFichier(id, rang);
  return (
    <button type="button" className={`${principal ? "ex-btn-petrole" : "ex-btn-ligne"} ex-assistant__btn${principal ? " ex-assistant__btn--fort" : ""}${petit ? " ex-assistant__btn--petit" : ""}`}
      onClick={() => t.lance(id, nom, rang)} disabled={!id || (t.enCours && !occupe)} aria-busy={occupe || undefined} aria-label={aria}>
      {occupe ? <span className="ex-roue" aria-hidden="true" /> : <Icone nom="document" taille={16} />}
      {occupe ? "Préparation…" : children}
    </button>
  );
}
const ErreurFichier = ({ t }) => t.erreur ? <div role="alert" style={encartCarte("warn")}><Icone nom="alerte" taille={16} style={{ marginTop: 1 }} /><span>{t.erreur}</span></div> : null;

// ── Document (duplicata) ──
function CarteDocument({ a, outils }) {
  const t = useTelechargement(outils);
  const nom = `Duplicata_${nomTelechargement(a.numero)}.pdf`;   // proposé si le serveur ne nomme pas le fichier
  return (
    <div className="ex-assistant__carte">
      <div style={titreCarte}><Icone nom="document" taille={18} style={{ color: T.teal }} />{nomPiece(a.piece, a.numero)}</div>
      <div className="num" style={meta}>{dateFr(a.date)} · {fmtEur(a.montant_ttc)} TTC</div>
      {a.pdf_disponible && a.fichier_id
        ? <div className="ex-assistant__actions"><BoutonFichier t={t} id={a.fichier_id} nom={nom} principal aria={`Télécharger le PDF : ${nomPiece(a.piece, a.numero)}`}>Télécharger le PDF</BoutonFichier></div>
        : <div style={{ ...meta, marginTop: 8, color: T.inkMute }}>Ce document n'a pas été émis au format PDF.</div>}
      <ErreurFichier t={t} />
    </div>
  );
}

// ── Choix entre plusieurs documents : un clic envoie « Le document <numéro> » ──
function CarteDocuments({ a, outils }) {
  const items = Array.isArray(a.items) ? a.items : [];
  return (
    <div className="ex-assistant__carte">
      <div style={titreCarte}><Icone nom="document" taille={18} style={{ color: T.teal }} />{items.length > 1 ? "Quel document voulez-vous ?" : "Document trouvé"}</div>
      <div role="list">
        {items.map((d, i) => (
          <div role="listitem" key={`${d.numero}-${i}`}>
            <button type="button" className="ex-assistant__choix" disabled={outils.occupe} onClick={() => outils.envoyer(`Le document ${d.numero}`)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 650 }}>{nomPiece(d.piece, d.numero)}</b>
                <span className="num" style={{ display: "block", fontSize: 12, color: T.inkSoft }}>{dateFr(d.date)} · {fmtEur(d.montant_ttc)} TTC{d.pdf_disponible === false ? " · PDF non émis" : ""}</span>
              </span>
              <Icone nom="suivant" taille={18} style={{ color: T.inkMute }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Relevé de facturation ──
function CarteReleve({ a, outils }) {
  const t = useTelechargement(outils);
  const base = `Releve_${String(a.debut || "").replace(/-/g, "")}_${String(a.fin || "").replace(/-/g, "")}`;
  const tva = Array.isArray(a.tva) ? a.tva : [];
  const total = (lib, v, fort) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", fontWeight: fort ? 700 : 500, color: fort ? T.ink : T.inkSoft }}>
      <span>{lib}</span><span className="num">{fmtEur(v)}</span>
    </div>
  );
  return (
    <div className="ex-assistant__carte">
      <div style={titreCarte}><Icone nom="calendrier" taille={18} style={{ color: T.teal }} />Relevé du {dateFr(a.debut)} au {dateFr(a.fin)}</div>
      <div className="num" style={meta}>{pluriel(a.nb_factures ?? 0, "facture")}, {pluriel(a.nb_avoirs ?? 0, "avoir")}</div>
      <div style={{ marginTop: 10, borderTop: `1px solid ${T.lineSoft}`, paddingTop: 6 }}>
        {total("Total HT", a.total_ht)}
        {total("TVA", a.total_tva)}
        {total("Net TTC", a.total_ttc, true)}
      </div>
      {tva.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary>Détail de la TVA par taux</summary>
          <table className="ex-assistant__table">
            <thead><tr><th scope="col">Taux</th><th scope="col">Base HT</th><th scope="col">TVA</th></tr></thead>
            <tbody>{tva.map((l, i) => <tr key={i}><td className="num">{tauxFr(l.taux)}</td><td className="num">{fmtEur(l.base)}</td><td className="num">{fmtEur(l.montant)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
      <div className="ex-assistant__actions">
        <BoutonFichier t={t} id={a.fichiers?.pdf} nom={`${base}.pdf`} principal aria="Télécharger le relevé en PDF">PDF</BoutonFichier>
        <BoutonFichier t={t} id={a.fichiers?.xlsx} nom={`${base}.xlsx`} aria="Télécharger le relevé au format Excel">Excel</BoutonFichier>
      </div>
      <ErreurFichier t={t} />
      <div style={{ fontSize: 12, color: T.inkMute, marginTop: 10 }}>{a.mention || "Liste des documents émis ; ne reflète pas les règlements."}</div>
    </div>
  );
}

// ── Commande : frise, lignes, lots, factures ──
function CarteCommande({ a, outils }) {
  const etapes = Array.isArray(a.etapes) ? a.etapes : [];
  const lignes = Array.isArray(a.lignes) ? a.lignes : [];
  const lots = Array.isArray(a.lots) ? a.lots : [];
  const factures = Array.isArray(a.factures) ? a.factures : [];
  const livraisons = (Array.isArray(a.livraisons) ? a.livraisons : []).filter((l) => l && typeof l.numero === "string").slice(0, 5);
  return (
    <div className="ex-assistant__carte">
      <div style={{ ...titreCarte, justifyContent: "space-between", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icone nom="commandes" taille={18} style={{ color: T.teal }} />Commande {a.reference}</span>
        {a.origine && <span style={ui.badge("neutral")}>{libelle(ORIGINES, a.origine)}</span>}
      </div>
      <div className="num" style={meta}>Passée le {dateFr(a.date)}</div>
      {etapes.length > 0 && (
        <ol aria-label="Suivi de la commande" style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {etapes.map((e, i) => (
            <li key={e.cle || i} style={{ display: "flex", alignItems: "flex-start", gap: 10, position: "relative", paddingBottom: i < etapes.length - 1 ? 10 : 0 }}>
              {i < etapes.length - 1 && <span aria-hidden="true" style={{ position: "absolute", left: 9, top: 20, bottom: 0, width: 2, background: e.fait && etapes[i + 1]?.fait ? T.teal2 : T.line }} />}
              <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: R.pill, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: e.fait ? T.teal : T.surface, color: T.paper, boxShadow: e.fait ? "none" : `inset 0 0 0 2px ${T.lineField}` }}>
                {e.fait && <Icone nom="coche" taille={12} epaisseur={3} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: e.fait ? T.ink : T.inkMute, fontWeight: e.fait ? 600 : 500 }}>
                {e.libelle}<span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{e.fait ? " : fait" : " : à venir"}</span>
              </span>
              {e.date && <span className="num" style={{ fontSize: 12, color: T.inkSoft, flexShrink: 0 }}>{dateHeureFr(e.date)}</span>}
            </li>
          ))}
        </ol>
      )}
      {lignes.length > 0 && (
        <table className="ex-assistant__table" style={{ marginTop: 12 }}>
          <thead><tr><th scope="col">Produit</th><th scope="col" title="Commandé">Cdé</th><th scope="col">Servi</th><th scope="col" title="Non servi">Non servi</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}>
                <td style={{ color: T.ink }}>{l.produit}{l.cip && <span style={{ display: "block", fontSize: 11, color: T.inkMute, marginTop: 2 }}><CipCell cip={l.cip} /></span>}</td>
                <td className="num">{qteFr(l.commande)}</td>
                <td className="num">{qteFr(l.servi)}</td>
                <td className="num" style={{ color: Number(l.non_servi) > 0 ? T.warn : undefined, fontWeight: Number(l.non_servi) > 0 ? 700 : undefined }}>
                  {qteFr(l.non_servi)}
                  {Number(l.a_livrer) > 0 && <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.teal, whiteSpace: "nowrap" }}>+ {qteFr(l.a_livrer)} à livrer</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* CIP de la commande, quantités servies : données de la pharmacie (docs/cip-copie.md) ; libellé court, la précision
          « quantités servies » est portée par title / aria-label et une ligne d'aide sous le bouton (à 375 px, le libellé long débordait) */}
      {lignes.some((l) => l.cip) && <div className="ex-assistant__actions"><CopieCips lignes={lignes} libelle="Copier les CIP" aide="quantités servies" compact /></div>}
      {lots.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>Lots et péremptions ({lots.length})</summary>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {lots.map((l, i) => (
              <li key={i} style={{ padding: "5px 0", borderTop: i ? `1px solid ${T.lineSoft}` : "none" }}>
                <span style={{ color: T.ink }}>{l.produit}</span>
                <span className="num" style={{ display: "block", fontSize: 12, color: T.inkSoft }}>Lot {l.lot} · péremption {peremptionFr(l.peremption)} · {pluriel(l.quantite ?? 0, "unité")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {factures.length > 0 && <div className="num" style={{ ...meta, marginTop: 10 }}>Facturée : {factures.join(", ")}</div>}
      <div className="ex-assistant__actions">
        {/* bon de livraison : demandé à l'assistant (carte « Bons de livraison », même téléchargement sécurisé) */}
        {livraisons.map((l) => (
          <button key={l.numero} type="button" className="ex-btn-ligne ex-assistant__btn" disabled={outils.occupe}
            onClick={() => outils.envoyer(`Je voudrais le bon de livraison ${l.numero}.`)}
            aria-label={`Bon de livraison ${l.numero}${l.date ? `, expédié le ${dateFr(l.date)}` : ""}`}>
            <Icone nom="camion" taille={16} />{livraisons.length > 1 ? `Bon de livraison ${l.numero}` : "Bon de livraison"}
          </button>
        ))}
        <button type="button" className="ex-btn-ligne ex-assistant__btn" disabled={outils.occupe}
          onClick={() => outils.preremplir(`Je signale un problème sur la commande ${a.reference} : `)}>
          <Icone nom="alerte" taille={16} />Signaler un problème sur cette commande
        </button>
      </div>
    </div>
  );
}

// ── Bons de livraison : un bouton par bon (rang dans l'autorisation, ?n=<rang>), et plusieurs bons en un seul PDF : toute
// la période si elle en compte 60 au plus (« ensemble_periode »), sinon ceux de la page. Un seul bon : bouton principal.
// La date est celle de la sortie de l'entrepôt (« expédié le … à … »), jamais une date de réception chez la pharmacie.
const HEURE = /^\d{2}:\d{2}$/;
function CarteBonsLivraison({ a, outils }) {
  const t = useTelechargement(outils);
  const items = (Array.isArray(a.items) ? a.items : []).filter((b) => b && typeof b.numero === "string");
  const id = typeof a.fichier_id === "string" ? a.fichier_id : null;
  const periode = a.periode?.debut && a.periode?.fin
    ? (a.periode.debut === a.periode.fin ? `Sortie de l'entrepôt le ${dateFr(a.periode.debut)}` : `Sorties de l'entrepôt du ${dateFr(a.periode.debut)} au ${dateFr(a.periode.fin)}`) : null;
  const total = Number(a.total) || items.length, page = Number(a.page) || 1, pages = Number(a.pages) || 1;
  const rangDe = (b, i) => (Number.isInteger(b.rang) && b.rang >= 0 ? b.rang : i);
  const ensemble = Number.isInteger(a.ensemble) && a.ensemble > 0 ? a.ensemble : items.length;
  const seul = items.length === 1 && ensemble <= 1;
  const jours = [...new Set(items.map((b) => b.date).filter(Boolean))].sort();
  const nomTous = `Duplicatas_BL${jours.length ? `_${jours[0]}${jours.at(-1) !== jours[0] ? `_${jours.at(-1)}` : ""}` : ""}.pdf`;
  const nomUn = (b) => `Duplicata_BL_${nomTelechargement(b.numero)}.pdf`;
  return (
    <div className="ex-assistant__carte">
      <div style={titreCarte}><Icone nom="camion" taille={18} style={{ color: T.teal }} />{items.length > 1 ? "Bons de livraison" : "Bon de livraison"}</div>
      <div className="num" style={meta}>
        {[periode, pages > 1 ? `${pluriel(total, "bon")} · page ${page} sur ${pages}` : items.length > 1 ? pluriel(total, "bon") : null].filter(Boolean).join(" · ")}
      </div>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {items.map((b, i) => {
          const produits = Array.isArray(b.produits) ? b.produits.filter(Boolean) : [];
          const autres = Math.max(0, (Number(b.nb_produits) || produits.length) - produits.length);
          const expedie = b.date ? `Expédié le ${dateFr(b.date)}${HEURE.test(b.heure || "") ? ` à ${b.heure}` : ""}` : null;
          return (
            <li key={`${b.numero}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.lineSoft}` }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <b className="num" style={{ fontWeight: 650, color: T.ink }}>{b.numero}</b>
                  {b.renvoi && <span style={ui.badge("info")}>Renvoi après retour</span>}
                  {b.reste_a_livrer && <span style={ui.badge("warn")}>Reste à livrer</span>}
                </span>
                <span className="num" style={{ display: "block", fontSize: 12, color: T.inkSoft }}>
                  {[expedie, b.commande && `commande ${b.commande}`, b.nb_produits != null && pluriel(b.nb_produits, "produit")].filter(Boolean).join(" · ")}
                </span>
                {produits.length > 0 && (
                  <span style={{ display: "block", fontSize: 12, color: T.inkMute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {produits.join(", ")}{autres ? `, + ${autres}` : ""}
                  </span>
                )}
              </span>
              {!seul && (
                <BoutonFichier t={t} id={id} rang={rangDe(b, i)} nom={nomUn(b)} petit aria={`Télécharger le bon de livraison ${b.numero} en PDF`}>PDF</BoutonFichier>
              )}
            </li>
          );
        })}
      </ul>
      {id && seul && (
        <div className="ex-assistant__actions">
          <BoutonFichier t={t} id={id} rang={rangDe(items[0], 0)} nom={nomUn(items[0])} principal aria={`Télécharger le bon de livraison ${items[0].numero} en PDF`}>
            Télécharger le bon de livraison (PDF)
          </BoutonFichier>
        </div>
      )}
      {id && ensemble > 1 && (
        <div className="ex-assistant__actions">
          <BoutonFichier t={t} id={id} nom={nomTous} principal aria={`Télécharger ${a.ensemble_periode ? `les ${ensemble} bons de livraison de la période` : `les ${ensemble} bons de livraison`} en un seul PDF`}>
            {a.ensemble_periode ? `Les ${ensemble} bons de la période en un seul PDF` : `Les ${ensemble} bons en un seul PDF`}
          </BoutonFichier>
        </div>
      )}
      {!id && <div style={{ ...meta, marginTop: 8, color: T.inkMute }}>Téléchargement indisponible pour le moment : voir la réponse ci-dessus.</div>}
      {pages > 1 && page < pages && (
        <div className="ex-assistant__actions" style={{ marginTop: 8 }}>
          <button type="button" className="ex-btn-ligne ex-assistant__btn" disabled={outils.occupe}
            onClick={() => outils.envoyer(`Montrez-moi les bons de livraison suivants (page ${page + 1}).`)}>
            <Icone nom="suivant" taille={16} />Bons suivants
          </button>
        </div>
      )}
      <ErreurFichier t={t} />
      <div style={{ fontSize: 12, color: T.inkMute, marginTop: 10 }}>{a.mention || "Duplicata établi par Elixir Pharma à partir des données de livraison enregistrées."}</div>
    </div>
  );
}

// ── Récapitulatif d'une demande de retour : rien ne part sans « Confirmer la demande » ──
// état (outils.etatDemande, d'après la réponse du serveur) : envoi | confirmee | non_enregistree | annulee | expiree | remplacee
const TEXTE_ETAT = {
  confirmee: "Demande confirmée : voir ci-dessous.", non_enregistree: "Demande non enregistrée : voir ci-dessous.",
  annulee: "Demande annulée : rien n'a été envoyé.", expiree: "Ce récapitulatif a expiré : demandez à l'assistant de le préparer à nouveau.",
  remplacee: "Remplacé par le récapitulatif plus récent ci-dessous.",
};
const ICONE_ETAT = { confirmee: "coche", non_enregistree: "alerte", expiree: "horloge", remplacee: "actualiser" };
function CarteRecap({ a, outils }) {
  const lignes = Array.isArray(a.lignes) ? a.lignes : [];
  const expireeLocale = a.expire_at && Date.parse(a.expire_at) < Date.now();
  const etat = outils.etatDemande(a.demande_id) || (a.statut && a.statut !== "brouillon" ? a.statut : null) || (expireeLocale ? "expiree" : null);
  const envoi = etat === "envoi";
  const [prevenir, setPrevenir] = useState(true);   // saisie Elixir : e-mail de confirmation à la pharmacie (§ 3.6)
  return (
    <div className="ex-assistant__carte" style={{ borderColor: T.teal2 }}>
      <div style={titreCarte}><Icone nom="document" taille={18} style={{ color: T.teal }} />Demande de retour à confirmer</div>
      {a.document && <div className="num" style={meta}>Document {a.document.numero}{a.document.date_sortie ? ` · sorti de l'entrepôt le ${dateFr(a.document.date_sortie)}` : ""}</div>}
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
        {lignes.map((l, i) => (
          <li key={i} style={{ padding: "6px 0", borderTop: `1px solid ${T.lineSoft}` }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <b style={{ fontWeight: 650, color: T.ink }}>{l.produit}</b>
              <span className="num" style={{ flexShrink: 0, fontWeight: 700 }}>× {qteFr(l.quantite)}</span>
            </span>
            <span className="num" style={{ display: "block", fontSize: 12, color: T.inkSoft }}>
              {l.cip && <>CIP <CipCell cip={l.cip} />{(l.lot || l.peremption) ? " · " : ""}</>}
              {[l.lot && `lot ${l.lot}`, l.peremption && `péremption ${peremptionFr(l.peremption)}`].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "2px 10px", fontSize: 13 }}>
        <dt style={{ color: T.inkMute }}>Motif</dt><dd style={{ margin: 0 }}>{libelle(MOTIFS, a.motif)}</dd>
        <dt style={{ color: T.inkMute }}>Souhait</dt><dd style={{ margin: 0 }}>{libelle(SOUHAITS, a.souhait)}</dd>
      </dl>
      {a.info_delai && <div style={{ ...meta, marginTop: 8 }}>{a.info_delai}</div>}
      <div style={encartCarte("info")}><Icone nom="cadenas" taille={16} style={{ marginTop: 1 }} /><span>Envoyé seulement si vous confirmez. Décision du Pharmacien Responsable.</span></div>
      {!etat || envoi ? (
        <>
          {a.expire_at && <div className="num" style={{ ...meta, marginTop: 8 }}>Récapitulatif valable jusqu'à {heureFr(a.expire_at)}.</div>}
          {outils.saisieElixir && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, marginTop: 4, fontSize: 13, color: T.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={prevenir} disabled={envoi} onChange={(e) => setPrevenir(e.target.checked)} style={{ width: 18, height: 18, margin: 0, accentColor: T.petrol }} />
              Prévenir la pharmacie par e-mail
            </label>
          )}
          <div className="ex-assistant__actions">
            <button type="button" className="ex-btn-petrole ex-assistant__btn ex-assistant__btn--fort" disabled={envoi || outils.occupe} aria-busy={envoi || undefined}
              onClick={() => outils.decider(a.demande_id, "confirmer", { prevenir })}>
              {envoi ? <span className="ex-roue" aria-hidden="true" /> : <Icone nom="coche" taille={18} />}{envoi ? "Envoi…" : "Confirmer la demande"}
            </button>
            <button type="button" className="ex-btn-ligne ex-assistant__btn" disabled={envoi || outils.occupe}
              onClick={() => outils.preremplir("Je voudrais modifier la demande de retour : ")}>
              <Icone nom="crayon" taille={16} />Modifier
            </button>
            <button type="button" className="ex-btn-ligne ex-assistant__btn" disabled={envoi || outils.occupe}
              onClick={() => outils.decider(a.demande_id, "annuler")}>
              <Icone nom="fermer" taille={16} />Annuler
            </button>
          </div>
        </>
      ) : (
        <div style={encartCarte(etat === "expiree" || etat === "non_enregistree" ? "warn" : "neutral")}>
          <Icone nom={ICONE_ETAT[etat] || "fermer"} taille={16} style={{ marginTop: 1 }} />
          <span>{TEXTE_ETAT[etat] || TEXTE_ETAT.annulee}</span>
        </div>
      )}
    </div>
  );
}

// ── Demande enregistrée (texte fixe du serveur) ──
function CarteEnregistree({ a }) {
  return (
    <div style={{ ...encartCarte("ok"), padding: "12px 14px", borderRadius: R.m }}>
      <Icone nom="coche" taille={18} style={{ marginTop: 1 }} />
      <div className="num">
        <b>Demande {a.numero} enregistrée{a.date ? ` le ${dateHeureFr(a.date)}` : ""}.</b>
        {a.delai && <div>{a.delai}</div>}
        {a.email_masque && <div>Récapitulatif envoyé à {a.email_masque}.</div>}
        {a.simulation && <div style={{ marginTop: 4, color: T.inkSoft }}>Phase pilote : votre demande est transmise à l'équipe Elixir par e-mail.</div>}
      </div>
    </div>
  );
}

// ── Transmission à un conseiller ──
function CarteTransmission({ a }) {
  const tel = lienTel(a.telephone);
  return (
    <div className="ex-assistant__carte">
      <div style={titreCarte}><Icone nom="bulle" taille={18} style={{ color: T.teal }} />Transmis à l'équipe Elixir</div>
      <div className="num" style={meta}>N° {a.numero}{a.delai ? ` · ${a.delai}` : ""}</div>
      {(a.telephone || a.horaires) && (
        <div className="num" style={{ ...meta, marginTop: 6 }}>Urgent : {a.telephone}{a.horaires ? ` (${a.horaires})` : ""}</div>
      )}
      {tel && <div className="ex-assistant__actions"><a className="ex-btn-ligne ex-assistant__btn" href={tel}><Icone nom="bulle" taille={16} />Appeler</a></div>}
    </div>
  );
}

const CarteErreur = ({ a }) => (
  <div role="alert" style={{ ...encartCarte("danger"), borderRadius: R.m }}>
    <Icone nom="alerte" taille={16} style={{ marginTop: 1 }} /><span>{a.texte || "Une erreur est survenue."}</span>
  </div>
);

const CARTES = {
  document: CarteDocument, documents: CarteDocuments, releve: CarteReleve, commande: CarteCommande, bons_livraison: CarteBonsLivraison,
  recap_retour: CarteRecap, demande_enregistree: CarteEnregistree, transmission: CarteTransmission, erreur: CarteErreur,
};
export const TYPES_CARTES = Object.keys(CARTES);

// type inconnu (version plus récente du serveur) : rien n'est affiché
export default function Carte({ action, outils }) {
  const C = action && CARTES[action.type];
  return C ? <C a={action} outils={outils} /> : null;
}
