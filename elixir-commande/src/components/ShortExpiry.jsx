import React, { useState, useEffect, useCallback } from "react";
import { T, R, ui, tone, fmtEur, fmtPct } from "../theme.js";
import { Icone } from "../icons.jsx";
import EnteteVue, { CompteurVue } from "./ui/EnteteVue.jsx";
import EtatVide, { ActionEtat, Chargement } from "./ui/EtatVide.jsx";

// Affichage seulement (refonte charte, lot 7) : format français de src/theme.js ; le panier reçoit les prix calculés
// par getDiscountedPrice, inchangés.
const fmt = (n) => n != null ? fmtEur(parseFloat(n)) : "–";

// En-têtes d'authentification admin (sync péremptions + remises = endpoints protégés)
const adminAuthHeaders = () => {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem("admin_token")) || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Péremption courte : vue pharmacie (menu) et onglet « Péremptions » de l'admin (isAdmin : remises modifiables, synchro Odoo).
// icone, couleur : icône et couleur du menu (App) ; absentes dans l'admin → horloge et orange d'origine (filet et pastille).
export default function ShortExpiry({ isAdmin, onAddToCart, pharmacyCip, icone, couleur = "#ea580c" }) {
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [quantities, setQuantities] = useState({});
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [discountInput, setDiscountInput] = useState("");
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [sortBy, setSortBy] = useState("expiry");

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null); // { current, total }

  const triggerExpirySync = async () => {
    setSyncing(true);
    setSyncProgress(null);
    try {
      let offset = 0;
      let totalUpdated = 0;
      while (true) {
        const res = await fetch(`/.netlify/functions/odoo-expiry-sync?offset=${offset}`, { headers: adminAuthHeaders() });
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

  // ── Chargement : tous les produits en stock < 4 mois de péremption ────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, discRes] = await Promise.all([
        fetch("/.netlify/functions/odoo-catalog?expiry_months=4"),
        fetch("/.netlify/functions/restock-alert?action=expiry_discounts"),
      ]);
      if (!prodRes.ok) throw new Error(`Erreur catalogue: HTTP ${prodRes.status}`);
      const prodData = await prodRes.json();
      if (prodData.error) throw new Error(prodData.error);
      setProducts(Array.isArray(prodData.products) ? prodData.products : []);

      const discData = await discRes.json();
      const map = {};
      (Array.isArray(discData) ? discData : []).forEach(d => { map[d.cip] = d.discount_pct; });
      setDiscounts(map);
    } catch (e) {
      console.error("[short-expiry]", e.message);
      setError(e.message);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Remise admin ──────────────────────────────────────────────────────
  const saveDiscount = async (cip, productName) => {
    const pct = parseFloat(discountInput) || 0;
    setSavingDiscount(true);
    try {
      await fetch("/.netlify/functions/restock-alert", {
        method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ action: "set_expiry_discount", cip, discount_pct: pct, product_name: productName }),
      });
      setDiscounts(prev => ({ ...prev, [cip]: pct }));
      setEditingDiscount(null);
    } catch (e) { console.warn("[discount]", e.message); }
    finally { setSavingDiscount(false); }
  };

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

  // ── Remise applicable : admin override > défaut (50% < 500€, 20% >= 500€) ──
  const getDiscount = (p) => {
    // Si l'admin a défini une remise spécifique, elle prime
    if (discounts[p.cip] != null && discounts[p.cip] !== 0) return discounts[p.cip];
    // Sinon, remise par défaut selon le prix
    const price = parseFloat(p.list_price) || 0;
    return price >= 500 ? 20 : 50;
  };

  const getDiscountedPrice = (p) => {
    const disc = getDiscount(p);
    return Math.round((parseFloat(p.list_price) || 0) * (1 - disc / 100) * 100) / 100;
  };

  const handleAdd = (p) => {
    const qty = parseInt(quantities[p.cip]) || 0;
    if (qty <= 0) return;
    const disc = getDiscount(p);
    const price = getDiscountedPrice(p);
    onAddToCart?.({ cip: p.cip, name: p.name, qty, pn: price, pv: p.list_price, discount: disc, note: `Pér. ${p.earliest_expiry?.slice(0,10)}` });
    setQuantities(prev => ({ ...prev, [p.cip]: 0 }));
  };

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
          horizontal dans le cadre sur petit écran (le tableau ne déborde plus de la page) */}
      {!loading && sorted.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, overflowX: "auto", boxShadow: T.shadow1 }}>
          <table className="num" style={{ width: "100%", borderCollapse: "collapse", color: T.ink }}>
            <thead>
              <tr>
                {["CIP", "Désignation", "Stock", "Péremption", "Lots", "Prix de base", isAdmin ? "Remise admin" : "Remise", "Prix remisé", "Qté"].map(h => (
                  <th key={h} style={{ ...ui.th, padding: "10px 10px", textAlign: ["Stock", "Qté"].includes(h) ? "center" : ["Prix de base", "Prix remisé"].includes(h) ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const days = daysUntil(p.earliest_expiry);
                const disc = getDiscount(p);
                const discPrice = getDiscountedPrice(p);
                const hasAdminOverride = discounts[p.cip] != null && discounts[p.cip] !== 0;
                const qty = quantities[p.cip] || 0;

                return (
                  <tr key={p.cip} className="ex-tr" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                    <td style={{ padding: "10px 10px", fontSize: 12, fontFamily: T.mono, color: T.inkMute }}>{p.cip}</td>
                    <td style={{ padding: "10px 10px", fontWeight: 600, fontSize: 13, color: T.ink, maxWidth: 260 }}>{p.name}</td>
                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: p.available > 10 ? T.ok : p.available > 0 ? T.warn : T.danger }}>
                        {p.available}
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px" }}>
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
                    <td style={{ padding: "10px 10px", fontSize: 11, color: T.inkSoft }}>
                      {(p.lots || []).slice(0, 3).map((l, j) => (
                        <div key={j} style={{ whiteSpace: "nowrap" }}>
                          {l.lot_name} ({l.qty}) {l.expiry ? `· ${new Date(l.expiry).toLocaleDateString("fr-FR")}` : ""}
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 13, color: T.inkMute, textDecoration: "line-through", fontWeight: 400, whiteSpace: "nowrap" }}>
                      {fmt(p.list_price)}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "left" }}>
                      {isAdmin ? (
                        editingDiscount === p.cip ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="number" min="0" max="99" step="1" value={discountInput}
                              onChange={e => setDiscountInput(e.target.value)}
                              onKeyDown={e => e.key === "Enter" && saveDiscount(p.cip, p.name)}
                              autoFocus aria-label={`Remise sur ${p.name} (%)`}
                              style={{ ...ui.qtyInput(true), width: 48 }} />
                            <span style={{ fontSize: 12 }}>%</span>
                            <button onClick={() => saveDiscount(p.cip, p.name)} disabled={savingDiscount} aria-label="Enregistrer la remise" title="Enregistrer"
                              style={{ ...ui.rond(26), background: T.ok, color: "#fff" }}><Icone nom="coche" taille={13} epaisseur={2.6} /></button>
                            <button className="ex-btn-discret" onClick={() => { setEditingDiscount(null); setDiscountInput(""); }} aria-label="Annuler" title="Annuler"
                              style={ui.rond(26)}><Icone nom="fermer" taille={12} epaisseur={2.4} /></button>
                          </div>
                        ) : (
                          // remise modifiable (admin) : ton info si une remise propre au produit est posée, sinon remise par défaut en or + encre
                          <button onClick={() => { setEditingDiscount(p.cip); setDiscountInput(String(disc)); }} title="Modifier la remise"
                            style={{
                              ...ui.badge(hasAdminOverride ? "info" : "promo"), fontSize: 12, padding: "3px 10px", border: `1px solid ${hasAdminOverride ? tone("info").border : "transparent"}`,
                              cursor: "pointer", fontFamily: "inherit",
                            }}>
                            {fmtPct(disc)}{hasAdminOverride && <Icone nom="crayon" taille={12} />}
                          </button>
                        )
                      ) : (
                        <span style={{ ...ui.badge("promo"), fontSize: 12 }}>{fmtPct(disc)}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>
                        {fmt(discPrice)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                        <button className="ex-qte-moins" onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: Math.max(0, (parseInt(prev[p.cip]) || 0) - 1) }))}
                          aria-label={`Diminuer la quantité de ${p.name}`} style={pas}><Icone nom="moins" taille={12} epaisseur={2.6} /></button>
                        <input type="number" min="0" value={quantities[p.cip] || ""}
                          onChange={e => setQuantities(prev => ({ ...prev, [p.cip]: parseInt(e.target.value) || 0 }))}
                          placeholder="0" aria-label={`Quantité ${p.name}`}
                          style={{ ...ui.qtyInput(qty > 0), width: 44 }} />
                        <button className="ex-qte-plus" onClick={() => setQuantities(prev => ({ ...prev, [p.cip]: (parseInt(prev[p.cip]) || 0) + 1 }))}
                          aria-label={`Augmenter la quantité de ${p.name}`} style={pas}><Icone nom="plus" taille={12} epaisseur={2.6} /></button>
                      </div>
                      {qty > 0 && (
                        <button className="ex-btn-petrole" onClick={() => handleAdd(p)}
                          style={{ ...ui.btn("primaire", "s"), background: undefined, color: undefined, height: 26, padding: "0 12px", fontSize: 12, marginTop: 6 }}>
                          Ajouter
                        </button>
                      )}
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
