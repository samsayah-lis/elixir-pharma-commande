import React, { useState, useEffect, useCallback } from "react";
import { T, R, ui, tone, fmtEur, fmtPct } from "../theme.js";
import { Icone } from "../icons.jsx";
import EnteteVue, { CompteurVue } from "./ui/EnteteVue.jsx";
import EtatVide, { ActionEtat, Chargement } from "./ui/EtatVide.jsx";
import { prixPage, offrePeremption } from "../peremption-panier.js";
import { TierBadge } from "../tiers.jsx";

// Affichage seulement (refonte charte, lot 7) : format français de src/theme.js.
// Lot 0 de « Odoo facture la remise » (20/10/2026, docs/peremption.md) : la page affiche le prix habituel, celui de la
// Saisie de commande (prixPage : prix remisé de la liste n° 5, sinon prix catalogue ; paliers d'Odoo), sans remise
// péremption ni prix barré — avant, −50 % (−20 % dès 500 €) ou la remise de l'admin, qu'Odoo ne facturait jamais. C'est le
// prix de la liste n° 5, comme partout sur le site : les clients des listes 15, 1110 et 25 peuvent être facturés plus cher.
// Produit rangé dans un menu : prix que prendra le panier (prixPanier, celui du menu ou de la campagne). Le panier reçoit
// l'ajout par les règles de la Saisie (colis, contingentement) avec la date du lot (offrePeremption : mention « Pér. <date> »
// jusqu'à la commande, ligne hors catalogue seulement). Sans prix : pas d'ajout.
const fmt = (n) => n != null ? fmtEur(parseFloat(n)) : "–";

// En-têtes d'authentification admin (sync péremptions + remises = endpoints protégés), quand l'admin ne passe pas adminFetch
const adminAuthHeaders = () => {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem("admin_token")) || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Péremption courte : vue pharmacie (menu) et onglet « Péremptions » de l'admin (isAdmin : remises notées en lecture seule,
// synchro Odoo ; adminFetch : appels authentifiés de l'admin, jeton renouvelé ; admin : encart et cellule « Remise notée » de
// src/components/PeremptionsAdmin.jsx, passés par AdminPanel — chargés avec l'admin, hors du bundle des pharmacies).
// icone, couleur : icône et couleur du menu (App) ; absentes dans l'admin → horloge et orange d'origine (filet et pastille).
// prixPanier(cip) : prix du menu qui contient le CIP (prixDuMenu d'App.jsx), null hors menu ; vue pharmacie seulement.
export default function ShortExpiry({ isAdmin, onAddToCart, icone, couleur = "#ea580c", adminFetch, admin = null, prixPanier }) {
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [quantities, setQuantities] = useState({});
  const [sortBy, setSortBy] = useState("expiry");

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null); // { current, total }

  const appelAdmin = (url, options = {}) => (adminFetch ? adminFetch(url, options)
    : fetch(url, { ...options, headers: { ...(options.headers || {}), ...adminAuthHeaders() } }));

  const triggerExpirySync = async () => {
    setSyncing(true);
    setSyncProgress(null);
    try {
      let offset = 0;
      let totalUpdated = 0;
      while (true) {
        const res = await appelAdmin(`/.netlify/functions/odoo-expiry-sync?offset=${offset}`);
        if (!res.ok) { console.error("[sync] échec HTTP", res.status, "— êtes-vous connecté en admin ?"); break; }
        const data = await res.json();
        if (data.error) { console.error("[sync]", data.error); break; }
        totalUpdated += data.updated || 0;
        setSyncProgress({ current: offset + (data.batch_size || 0), total: data.total_in_stock || 0, updated: totalUpdated });
        if (data.done || !data.next_offset) break;
        offset = data.next_offset;
      }
      // Recharger les produits
      await fetchData();
    } catch (e) { console.warn("[sync]", e.message); }
    finally { setSyncing(false); setSyncProgress(null); }
  };

  // ── Chargement : tous les produits en stock < 4 mois de péremption ; remises notées : admin seulement ────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, discRes] = await Promise.all([
        fetch("/.netlify/functions/odoo-catalog?expiry_months=4"),
        isAdmin ? fetch("/.netlify/functions/restock-alert?action=expiry_discounts") : null,
      ]);
      if (!prodRes.ok) throw new Error(`Erreur catalogue: HTTP ${prodRes.status}`);
      const prodData = await prodRes.json();
      if (prodData.error) throw new Error(prodData.error);
      setProducts(Array.isArray(prodData.products) ? prodData.products : []);

      const discData = discRes ? await discRes.json().catch(() => []) : [];
      const map = {};
      (Array.isArray(discData) ? discData : []).forEach(d => { map[d.cip] = d.discount_pct; });
      setDiscounts(map);
    } catch (e) {
      console.error("[short-expiry]", e.message);
      setError(e.message);
    }
    finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtrage et tri ───────────────────────────────────────────────────
  const filtered = products.filter(p =>
    search.length < 2 ||
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.cip?.includes(search)
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "expiry") return (a.earliest_expiry || "9999").localeCompare(b.earliest_expiry || "9999");
    if (sortBy === "name") return (a.name || "").localeCompare(b.name || "", "fr");
    if (sortBy === "stock") return (b.available || 0) - (a.available || 0);
    return 0;
  });

  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date()) / 86400000);
  };

  // péremption proche : ton warn ; un mois ou moins : danger (toujours avec la date et « N j restants » écrits)
  const expiryColor = (days) => {
    if (days === null) return T.inkMute;
    if (days <= 30) return T.danger;
    return T.warn;
  };

  // prix affiché : pharmacie, celui que prendra le panier (menu ou campagne : prixPanier ; sinon prix de la Saisie) ;
  // admin, prix de la liste n° 5
  const prixAffiche = (p) => (!isAdmin && prixPanier?.(p.cip)) || prixPage(p);

  const handleAdd = (p) => {
    const qty = parseInt(quantities[p.cip]) || 0;
    if (qty <= 0 || !(prixAffiche(p).pn > 0)) return;   // sans prix : pas d'ajout (l'envoi planterait sur un prix vide)
    // prix de la Saisie et date du lot → mention « Pér. <date> » au panier (src/peremption-panier.js)
    onAddToCart?.(offrePeremption(p, qty));
    setQuantities(prev => ({ ...prev, [p.cip]: 0 }));
  };

  // colonnes : pharmacie (7, classes ex-per-* : cartes sous 768 px, src/styles/tokens.css) ; admin (9 : prix de base et
  // remise notée en plus)
  const colonnes = isAdmin
    ? ["CIP", "Désignation", "Stock", "Péremption", "Lots", "Prix de base", "Prix liste 5", "Remise notée", "Qté"]
    : ["CIP", "Désignation", "Stock", "Péremption", "Lots", "Prix HT", "Qté"];
  const aDroite = ["Prix de base", "Prix liste 5", "Prix HT"];

  return (
    <div>
      {/* En-tête de vue commun (lot 7) au lieu du bandeau en dégradé orange : l'orange ne reste que dans le filet et la pastille */}
      <EnteteVue
        icone={icone || <Icone nom="horloge" taille={24} />}
        couleur={couleur}
        titre="Péremption courte"
        sousTitre="Produits en stock avec péremption entre J+30 et 4 mois"
        actions={isAdmin && (
          <button className={syncing ? undefined : "ex-btn-ligne"} onClick={triggerExpirySync} disabled={syncing}
            style={{ ...btnLigne, marginTop: 10, ...(syncing ? { cursor: "default", opacity: 0.6 } : {}) }}>
            <Icone nom={syncing ? "horloge" : "actualiser"} taille={14} />
            {syncing && syncProgress ? `${syncProgress.current}/${syncProgress.total} (${syncProgress.updated} màj)` : syncing ? "Démarrage…" : "Actualiser depuis Odoo"}
          </button>
        )}
        aside={<CompteurVue chargement={loading} valeur={products.length.toLocaleString("fr-FR")} libelle={loading || products.length > 1 ? "références" : "référence"} />}
      />

      {/* Ce que dit la page : pharmacie, prix habituel sans remise ; admin, remises non facturées, plus aucune saisie */}
      {isAdmin ? (admin?.Encart && <admin.Encart style={{ ...encart("warn"), marginBottom: 16 }} />) : (
        <div role="note" style={{ ...encart("info"), marginBottom: 16 }}>
          <Icone nom="horloge" taille={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Prix habituels, comme dans le reste du catalogue : aucune remise péremption pour l'instant. La date est celle du lot le
            plus court en stock ; les lots sont détaillés sur chaque ligne.</span>
        </div>
      )}

      {/* Recherche en pastille blanche + tri (comme la recherche de section du catalogue) */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", position: "relative" }}>
          <Icone nom="recherche" taille={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: T.inkMute, pointerEvents: "none" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filtrer par nom ou CIP…" aria-label="Filtrer par nom ou CIP" className="ex-saisie-recherche"
            style={{ width: "100%", height: 40, padding: "0 16px 0 40px", fontSize: 14, color: T.ink, background: T.surface, border: `1px solid ${T.lineField}`, borderRadius: R.pill, outline: "none", boxSizing: "border-box" }} />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Trier les produits"
          style={{ height: 40, padding: "0 14px", border: `1px solid ${T.lineField}`, borderRadius: R.pill, fontSize: 13, color: T.ink, background: T.surface, cursor: "pointer" }}>
          <option value="expiry">Trier : péremption proche</option>
          <option value="name">Trier : A → Z</option>
          <option value="stock">Trier : stock décroissant</option>
        </select>
      </div>

      {/* Chargement, erreur, liste vide, filtre sans résultat : composants communs (lot 8) */}
      {loading && <Chargement texte="Chargement des produits à péremption courte…" style={{ ...ui.card, padding: "40px 20px" }} />}

      {/* Erreur : même message, « Réessayer » relance le même chargement (fetchData) */}
      {!loading && error && (
        <EtatVide cadre erreur icone="alerte" titre="Les produits n’ont pas pu être chargés" texte={error}
          actions={<ActionEtat principal icone="actualiser" onClick={fetchData}>Réessayer</ActionEtat>} />
      )}

      {/* Liste vide : bouton de synchronisation inchangé (même onClick, même état) */}
      {!loading && !error && products.length === 0 && (
        <EtatVide cadre icone="horloge"
          titre={syncing ? "Synchronisation des péremptions en cours…" : "Aucune donnée de péremption"}
          texte="Les dates de péremption doivent être synchronisées depuis Odoo."
          actions={
            <button className={syncing ? undefined : "ex-btn-petrole"} onClick={triggerExpirySync} disabled={syncing}
              style={{ ...ui.btn("primaire", "l"), background: syncing ? T.sand : undefined, color: syncing ? T.inkSoft : undefined, cursor: syncing ? "default" : "pointer" }}>
              <Icone nom={syncing ? "horloge" : "actualiser"} taille={18} />
              {syncing ? "Synchronisation en cours…" : "Synchroniser les péremptions Odoo"}
            </button>
          } />
      )}

      {/* Filtre sans résultat (était : rien d'affiché) */}
      {!loading && !error && products.length > 0 && sorted.length === 0 && (
        <EtatVide cadre icone="recherche" titre="Aucun produit ne correspond" texte={`Filtre actif : « ${search} »`}
          actions={<ActionEtat icone="fermer" onClick={() => setSearch("")}>Effacer le filtre</ActionEtat>} />
      )}

      {/* Table : carte blanche, en-tête neutre (eyebrow --ink-mute), lignes .ex-tr (zébrure, survol) ; défilement
          horizontal dans le cadre sur tablette ; sous 768 px, une carte par produit (classe ex-peremption et cellules
          ex-per-*, lot 9 : disposition seulement, mêmes cellules, mêmes gestionnaires) */}
      {!loading && sorted.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, overflowX: "auto", boxShadow: T.shadow1 }}>
          <table className="num ex-peremption" style={{ width: "100%", borderCollapse: "collapse", color: T.ink }}>
            <thead>
              <tr>
                {colonnes.map(h => (
                  <th key={h} style={{ ...ui.th, padding: "10px 10px", textAlign: ["Stock", "Qté"].includes(h) ? "center" : aDroite.includes(h) ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const days = daysUntil(p.earliest_expiry);
                const prix = prixAffiche(p);
                const menu = prix.rayon && Math.abs((prix.pn ?? 0) - (prixPage(p).pn ?? 0)) >= 0.005 ? prix.rayon : null;   // prix du menu ≠ prix de la Saisie
                const sansPrix = !(prix.pn > 0);
                const notee = discounts[p.cip] != null && Number(discounts[p.cip]) !== 0 ? Number(discounts[p.cip]) : null;
                const qty = quantities[p.cip] || 0;

                return (
                  <tr key={p.cip} className="ex-tr" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                    <td className="ex-per-cip" style={{ padding: "10px 10px", fontSize: 12, fontFamily: T.mono, color: T.inkMute }}>{p.cip}</td>
                    <td className="ex-per-nom" style={{ padding: "10px 10px", fontWeight: 600, fontSize: 13, color: T.ink, maxWidth: 260 }}>{p.name}</td>
                    <td className="ex-per-stock" style={{ padding: "10px 10px", textAlign: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: p.available > 10 ? T.ok : p.available > 0 ? T.warn : T.danger }}>
                        {p.available}
                      </span>
                    </td>
                    <td className="ex-per-date" style={{ padding: "10px 10px" }}>
                      {p.earliest_expiry && (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: expiryColor(days) }}>
                            {new Date(p.earliest_expiry).toLocaleDateString("fr-FR")}
                          </div>
                          <div style={{ fontSize: 11, color: expiryColor(days), fontWeight: 600 }}>
                            {days != null && (days <= 0 ? "EXPIRÉ" : `${days} j restants`)}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="ex-per-lots" style={{ padding: "10px 10px", fontSize: 11, color: T.inkSoft }}>
                      {(p.lots || []).slice(0, 3).map((l, j) => (
                        <div key={j} style={{ whiteSpace: "nowrap" }}>
                          {l.lot_name} ({l.qty}) {l.expiry ? `· ${new Date(l.expiry).toLocaleDateString("fr-FR")}` : ""}
                        </div>
                      ))}
                    </td>
                    {isAdmin && (
                      <td className="ex-per-base" style={{ padding: "10px 10px", textAlign: "right", fontSize: 13, color: T.inkMute, whiteSpace: "nowrap" }}>
                        {fmt(p.list_price)}
                      </td>
                    )}
                    {/* prix habituel : celui de la Saisie (liste n° 5) ou du menu, ni prix barré ni remise péremption ; paliers d'Odoo */}
                    <td className="ex-per-prix" style={{ padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>{fmt(prix.pn)}</span>
                      {!isAdmin && !sansPrix && <span style={{ fontSize: 11, color: T.inkMute, marginLeft: 4 }}>HT</span>}
                      <TierBadge tiers={prix.tiers} pn={prix.pn} bloc />
                      {menu && <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>prix du menu « {menu} »</div>}
                      {!isAdmin && sansPrix && <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>prix à confirmer</div>}
                    </td>
                    {isAdmin && (
                      <td className="ex-per-remise" style={{ padding: "10px 10px", textAlign: "left" }}>
                        {admin?.CelluleRemise
                          ? <admin.CelluleRemise p={p} notee={notee} />
                          : <span style={{ fontSize: 12, color: T.inkSoft }}>{notee != null ? `${fmtPct(notee)} · notée, non reprise` : "—"}</span>}
                      </td>
                    )}
                    <td className="ex-per-qte" style={{ padding: "10px 10px", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                        <button className="ex-qte-moins" onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: Math.max(0, (parseInt(prev[p.cip]) || 0) - 1) }))}
                          aria-label={`Diminuer la quantité de ${p.name}`} style={pas}><Icone nom="moins" taille={12} epaisseur={2.6} /></button>
                        <input type="number" min="0" value={quantities[p.cip] || ""}
                          onChange={e => setQuantities(prev => ({ ...prev, [p.cip]: parseInt(e.target.value) || 0 }))}
                          placeholder="0" aria-label={`Quantité ${p.name}`} className="ex-qte-champ"
                          style={{ ...ui.qtyInput(qty > 0), width: 44 }} />
                        <button className="ex-qte-plus" onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: (parseInt(prev[p.cip]) || 0) + 1 }))}
                          aria-label={`Augmenter la quantité de ${p.name}`} style={pas}><Icone nom="plus" taille={12} epaisseur={2.6} /></button>
                      </div>
                      {qty > 0 && (sansPrix ? (
                        <button className="ex-peremption-ajouter" disabled title="Prix à confirmer : contactez Elixir"
                          style={{ ...ui.btn("primaire", "s"), height: 26, padding: "0 12px", fontSize: 12, marginTop: 6, opacity: 0.5, cursor: "not-allowed" }}>
                          Ajouter
                        </button>
                      ) : (
                        <button className="ex-btn-petrole ex-peremption-ajouter" onClick={() => handleAdd(p)}
                          style={{ ...ui.btn("primaire", "s"), background: undefined, color: undefined, height: 26, padding: "0 12px", fontSize: 12, marginTop: 6 }}>
                          Ajouter
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Atomes (refonte charte, lot 7) ──
// bouton secondaire à filet (synchro admin) : survol par la classe ex-btn-ligne
const btnLigne = { ...ui.btn("ligne", "s"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, fontSize: 12 };
// « − » / « + » de 24 px du tableau : fond et survol par les classes ex-qte-moins / ex-qte-plus
const pas = { width: 24, height: 24, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center" };
// encart d'explication en tête de page (ton de theme.js, texte 13 px, icône calée sur la première ligne)
const encart = (ton) => {
  const t = tone(ton);
  return { display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: R.s, fontSize: 13, lineHeight: 1.5,
    background: t.bg, color: t.fg, border: `1px solid ${t.border}` };
};
