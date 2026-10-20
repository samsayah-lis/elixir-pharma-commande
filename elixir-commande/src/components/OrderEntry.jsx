import React, { useState, useEffect, useRef } from "react";

import { applyTiers, TierBadge } from "../tiers.jsx";
import { loadGroups, collapseGroups } from "../product-groups.js";
import { T, R, ui, tone, fmtEur, fmtPct as fmtPctFr } from "../theme.js";
import { Icone } from "../icons.jsx";
import EnteteVue, { CompteurVue } from "./ui/EnteteVue.jsx";
import BadgeStatut from "./ui/BadgeStatut.jsx";
import CipCell from "./ui/CipCell.jsx";
import EtatVide, { ActionEtat, Squelette } from "./ui/EtatVide.jsx";

// Affichage seulement (refonte charte, lot 5) : format français de src/theme.js — « 1 234,50 € », « −14,7 % ».
// Rien de ce qui part (panier, search-track, restock-alert) ne passe par ces deux fonctions.
const fmt = (n) => n != null ? fmtEur(parseFloat(n)) : "–";
const fmtPct = (n) => n > 0 ? fmtPctFr(n, { vide: "" }) : "";

// ── Refonte charte, lot 5 (docs/refonte-charte.md § 3) ──
// En-tête de vue commun (EnteteVue), recherche en pastille de 48 px, résultats en lignes blanches de rayon 16
// (comme la maquette de la vitrine), statut toujours écrit (BadgeStatut : jamais la couleur seule), « Ajouter » en
// pastille pétrole dont la place est réservée (la ligne ne saute plus quand il apparaît). Disposition par classes
// (src/styles/tokens.css, « Saisie de commande ») : sous 768 px, la ligne passe en pile par @media — le composant
// ne reçoit pas isMobile. Atomes en bas de fichier.

export default function OrderEntry({ pharmacyCip, pharmacyName, pharmacyEmail, onAddToCart, regleQuantite, fetchAuth = fetch, initialQuery, justifProducts = {}, icone, couleur }) {
  const [query, setQuery] = useState(initialQuery || "");
  const [results, setResults] = useState([]);
  // lot 8 : ouverture par ?cip= / ?produit= → « Recherche… » dès le premier affichage (et non « 0 résultat »)
  const [searching, setSearching] = useState(() => (initialQuery || "").trim().length >= 2);
  const [catalogInfo, setCatalogInfo] = useState(null);
  const [infoLue, setInfoLue] = useState(false);   // lot 8 : compte du catalogue reçu (ou en échec) — affichage seulement
  const [quantities, setQuantities] = useState({});
  const [alerts, setAlerts] = useState({});
  const [alertSaving, setAlertSaving] = useState({});
  const [alertErreur, setAlertErreur] = useState({});   // CIP → message quand le serveur refuse l'alerte (jeton absent ou expiré…)
  // Alertes retour (20/10/2026, docs/alertes-retour.md) : demandes déjà averties (e-mail parti) dont le produit est de
  // nouveau en stock depuis moins de 14 jours (« retour », calculé par restock-alert) → mention « De retour en stock ».
  // cipAffiche : CIP de la ligne de la Saisie (article sous plusieurs CIP : la référence servie en premier, retour_cip)
  const [retours, setRetours] = useState([]);   // [{ cip, cipAffiche, nom }]
  const [retourErreur, setRetourErreur] = useState("");   // masquage refusé par le serveur
  const [stockOnly, setStockOnly] = useState(false);
  const debounceRef = useRef(null);

  // ── Chargement initial : count + alerts ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const countRes = await fetch("/.netlify/functions/odoo-catalog?count=1");
        if (countRes.ok && !cancelled) setCatalogInfo(await countRes.json());
        if (!cancelled) setInfoLue(true);
        if (pharmacyCip) {
          try {
            // ?pharmacy_cip ne sert qu'à l'admin : pour une pharmacie, le serveur prend le CIP de son jeton
            const alertRes = await fetchAuth(`/.netlify/functions/restock-alert?pharmacy_cip=${encodeURIComponent(pharmacyCip)}`);
            const alertData = await alertRes.json();
            // alerte active = pas encore avertie ; avertie et produit revenu = « De retour en stock »
            const map = {}, rev = [];
            (Array.isArray(alertData) ? alertData : []).forEach(a => {
              if (a.retour) rev.push({ cip: a.cip, cipAffiche: a.retour_cip || a.cip, nom: a.product_name || a.cip });
              else if (!a.notified) map[a.cip] = true;
            });
            if (!cancelled) { setAlerts(map); setRetours(rev); }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { console.warn("[init]", e.message); if (!cancelled) setInfoLue(true); }
    })();
    return () => { cancelled = true; };
  }, [pharmacyCip]);

  // ── Recherche côté serveur (prix remisés inclus dans la réponse) ──────
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearching(true);   // lot 8 : « Recherche… » dès la frappe, plus de « 0 résultat » pendant le délai de 350 ms
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `/.netlify/functions/odoo-catalog?q=${encodeURIComponent(query.trim())}&limit=100${stockOnly ? "&stock_only=1" : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // articles sous plusieurs CIP (même code fournisseur) : une seule ligne, la référence servie en premier
        setResults(collapseGroups(Array.isArray(data.products) ? data.products : [], await loadGroups()));
        // Track search (fire-and-forget)
        const r = Array.isArray(data.products) ? data.products : [];
        fetch("/.netlify/functions/search-track", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), pharmacy_cip: pharmacyCip || null, results_count: r.length }),
        }).catch(() => {});
      } catch (e) { setResults([]); }
      finally { setSearching(false); }
    }, 350);
  }, [query, stockOnly]);

  // ── Alerte retour en stock ────────────────────────────────────────────
  const toggleAlert = async (product) => {
    const cip = product.cip;
    setAlertSaving(prev => ({ ...prev, [cip]: true }));
    setAlertErreur(prev => { const n = { ...prev }; delete n[cip]; return n; });
    const activer = !alerts[cip];   // action réellement envoyée (la lecture initiale des alertes peut arriver pendant l'envoi)
    try {
      const res = !activer
        ? await fetchAuth(`/.netlify/functions/restock-alert?pharmacy_cip=${encodeURIComponent(pharmacyCip)}&cip=${encodeURIComponent(cip)}`, { method: "DELETE" })
        : await fetchAuth("/.netlify/functions/restock-alert", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pharmacy_cip: pharmacyCip, pharmacy_email: pharmacyEmail, cip, product_name: product.name }),
          });
      // l'alerte ne change d'état que si le serveur l'a enregistrée
      if (res.ok) setAlerts(prev => { const n = { ...prev }; if (activer) n[cip] = true; else delete n[cip]; return n; });
      else setAlertErreur(prev => ({ ...prev, [cip]: res.status === 401 ? "Reconnectez-vous pour gérer vos alertes" : "Alerte non enregistrée, réessayez" }));
    } catch { setAlertErreur(prev => ({ ...prev, [cip]: "Alerte non enregistrée, réessayez" })); }
    setAlertSaving(prev => ({ ...prev, [cip]: false }));
  };

  // Masquer « De retour en stock » = retirer la demande déjà avertie (même DELETE que « Alerte activée ») ; refus : remise
  // et message (sauf masquage automatique après l'ajout au panier : la mention reviendra simplement au prochain affichage)
  const masquerRetour = async (r, { silencieux = false } = {}) => {
    setRetours(prev => prev.filter(x => x.cip !== r.cip));
    setRetourErreur("");
    let ok = false;
    try {
      ok = (await fetchAuth(`/.netlify/functions/restock-alert?pharmacy_cip=${encodeURIComponent(pharmacyCip)}&cip=${encodeURIComponent(r.cip)}`, { method: "DELETE" })).ok;
    } catch { ok = false; }
    if (!ok) {
      setRetours(prev => prev.some(x => x.cip === r.cip) ? prev : [...prev, r]);
      if (!silencieux) setRetourErreur(`Mention « De retour en stock » non retirée pour ${r.nom}, réessayez.`);
    }
  };
  const retourDe = (cip) => retours.find(r => r.cip === cip || r.cipAffiche === cip);
  // recherche en cours (lien ?cip= de l'e-mail compris) : le bandeau ne répète pas les produits affichés (leur ligne porte
  // déjà la mention) et passe SOUS les résultats — sur téléphone, le produit ouvert par l'e-mail reste en haut de l'écran
  const enRecherche = query.length >= 2;
  const retoursBandeau = enRecherche ? retours.filter(r => !results.some(p => p.cip === r.cip || p.cip === r.cipAffiche)) : retours;

  // Bandeau « De retour en stock » (ton info, suite de « Alerte activée » ; nom → recherche du CIP ; croix → mention retirée)
  const bandeauRetours = retoursBandeau.length > 0 && (
    <section aria-label="Produits de retour en stock" style={{ ...ui.encart("info"), display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", marginBottom: 14 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}><Icone nom="cloche" taille={15} />De retour en stock</span>
      <span style={{ color: T.inkSoft }}>{retoursBandeau.length > 1 ? "Les produits que vous attendiez sont disponibles :" : "Le produit que vous attendiez est disponible :"}</span>
      {retoursBandeau.map(r => (
        <span key={r.cip} style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%", background: T.surface, borderRadius: R.pill, boxShadow: `inset 0 0 0 1px ${tone("info").border}` }}>
          <button onClick={() => setQuery(r.cipAffiche)} aria-label={`Afficher ${r.nom} dans la recherche`} title={`Afficher ${r.nom}`}
            style={{ ...retourStyle, display: "block", lineHeight: "28px", padding: "0 4px 0 12px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{r.nom}</button>
          <button onClick={() => masquerRetour(r)} aria-label={`Masquer « De retour en stock » pour ${r.nom}`} title="Masquer"
            style={{ ...retourStyle, width: 28, justifyContent: "center", flexShrink: 0, color: T.inkMute }}><Icone nom="fermer" taille={12} /></button>
        </span>
      ))}
    </section>
  );

  const handleAdd = (product) => {
    const qty = parseInt(quantities[product.cip]) || 0;
    if (qty <= 0) return;
    // produit attendu ajouté au panier : la pharmacie a donné suite, la mention « De retour en stock » se retire
    const attendu = retourDe(product.cip);
    if (attendu) masquerRetour(attendu, { silencieux: true });
    const hasDiscount = product.discounted_price && product.discount_pct > 0;
    const price = hasDiscount ? product.discounted_price : product.list_price;
    onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: price, pv: product.list_price, discount: hasDiscount ? product.discount_pct : 0, tiers: product.price_tiers || null,
      ...(product.supplier_code ? { supplier_code: product.supplier_code } : {}) });
    setQuantities(prev => ({ ...prev, [product.cip]: 0 }));
    // Track add-to-cart
    fetch("/.netlify/functions/search-track", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim(), pharmacy_cip: pharmacyCip || null, results_count: results.length, clicked_cip: product.cip, added_to_cart: true }),
    }).catch(() => {});
  };

  const hasProducts = catalogInfo && catalogInfo.total > 0;

  const majCatalogue = catalogInfo?.updated_at
    ? new Date(catalogInfo.updated_at).toLocaleString("fr-FR", {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : null;

  return (
    <div>
      {/* En-tête de vue (lot 5) au lieu du bandeau en dégradé ; à droite, l'étendue du catalogue Odoo synchronisé
          (références et boîtes en stock lues par odoo-catalog?count=1 ; décision de Zineb, 16/10 : les boîtes plutôt que les références en stock) */}
      <EnteteVue
        icone={icone || <Icone nom="crayon" taille={24} />}
        couleur={couleur}
        titre="Saisie de commande"
        sousTitre={<>Recherchez par code CIP ou nom de produit{majCatalogue && <span className="num"> · Màj : {majCatalogue}</span>}</>}
        aside={!infoLue ? <CompteurVue chargement libelle="références" />
          : hasProducts && <CompteurVue valeur={Number(catalogInfo.total).toLocaleString("fr-FR")} libelle="références"
          detail={catalogInfo.in_stock_boxes != null ? `${Number(catalogInfo.in_stock_boxes).toLocaleString("fr-FR")} boîtes en stock` : null} />}
      />

      {/* Recherche en pastille de 48 px : anneau de focus global (tokens.css), plus de bordure recolorée en JS ;
          autoFocus et pré-remplissage ?cip= / ?produit= (initialQuery) inchangés */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <Icone nom="recherche" taille={20} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: T.inkMute, pointerEvents: "none" }} />
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Saisissez un code CIP (ex : 3400930…) ou un nom de produit…" autoFocus
          aria-label="Rechercher un produit par code CIP, EAN ou nom" className="ex-saisie-recherche"
          style={{ width: "100%", height: 48, padding: `0 ${query ? 52 : 20}px 0 50px`, fontSize: 15, color: T.ink, background: T.surface,
            border: `1px solid ${T.lineField}`, borderRadius: R.pill, boxShadow: T.shadow1, boxSizing: "border-box", fontFamily: "inherit" }} />
        {query && <button className="ex-btn-discret ex-cible" onClick={() => setQuery("")} aria-label="Effacer la recherche" title="Effacer la recherche"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, padding: 0, border: "none",
            borderRadius: R.pill, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icone nom="fermer" taille={16} /></button>}
      </div>

      {/* Filtre en pastille (comme les filtres du catalogue : aria-pressed, classe ex-filtre) et nombre de résultats */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", marginBottom: 14 }}>
        {/* coche seulement quand le filtre est actif (revue, § 20) ; inactif, l'icône neutre du stock (carton) */}
        <button className="ex-filtre" aria-pressed={stockOnly} onClick={() => setStockOnly(!stockOnly)} style={filtreStyle}>
          <Icone nom={stockOnly ? "coche" : "carton"} taille={14} />En stock seulement
        </button>
        {query.length >= 2 && (
          <div className="num" role="status" style={{ fontSize: 13, color: T.inkMute, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {searching ? <><span className="ex-roue" aria-hidden="true" />Recherche…</> : `${results.length} résultat${results.length > 1 ? "s" : ""} pour « ${query} »`}
          </div>
        )}
      </div>

      {/* Alertes retour : produits attendus de nouveau en stock (nom → recherche du CIP ; croix → mention retirée). Ton
          info (sarcelle sur menthe), suite de « Alerte activée » : l'or reste aux remises et aux paliers (charte § 1.4) */}
      {retourErreur && <div role="alert" style={{ ...ui.encart("danger"), marginBottom: 10 }}>{retourErreur}</div>}
      {!enRecherche && bandeauRetours}

      {/* États vides (lot 8 : composant commun EtatVide). « Catalogue non synchronisé » seulement une fois le compte lu :
          pendant sa lecture, la consigne de recherche (avant le lot, le message s'affichait le temps de la réponse) */}
      {infoLue && !hasProducts && (
        <EtatVide cadre icone="carton" titre="Catalogue non synchronisé"
          texte="Un administrateur doit lancer la synchronisation depuis le panneau admin." />
      )}

      {(!infoLue || hasProducts) && query.length < 2 && (
        <EtatVide icone="recherche" titre="Saisissez au moins 2 caractères" texte="Code CIP, EAN, ou début de nom" />
      )}

      {/* Results : lignes blanches de rayon 16 (classe ex-saisie-ligne) ; en rupture, ligne à plat sur paper ;
          quantité saisie, anneau sarcelle (data-choisi) */}
      {query.length >= 2 && (
        <div>
          {/* première recherche en cours (lot 8) : trois lignes squelettes aux dimensions des résultats ; la ligne d'état
              au-dessus (role="status") annonce « Recherche… » */}
          {searching && results.length === 0 && (
            <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["64%", "48%", "72%"].map(l => (
                <div key={l} className="ex-saisie-ligne">
                  <div className="ex-saisie-info" style={{ display: "grid", gap: 8 }}><Squelette hauteur={13} largeur={l} /><Squelette hauteur={18} largeur={170} rayon={R.pill} /></div>
                  <div className="ex-saisie-prix" style={{ display: "grid", justifyItems: "end", gap: 6 }}><Squelette hauteur={18} largeur={84} /><Squelette hauteur={10} largeur={44} /></div>
                  <div className="ex-saisie-actions"><Squelette hauteur={30} largeur={128} rayon={R.pill} /></div>
                </div>
              ))}
            </div>
          )}
          {!searching && results.length === 0 && (
            <EtatVide cadre compact icone="recherche" titre={<>Aucun produit trouvé pour « {query} »</>}
              texte={stockOnly ? "Le filtre « En stock seulement » est actif : les produits en rupture ne sont pas affichés." : "Vérifiez l’orthographe ou cherchez par code CIP / EAN."}
              actions={stockOnly && <ActionEtat icone="fermer" onClick={() => setStockOnly(false)}>Afficher aussi les ruptures</ActionEtat>} />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map(p => {
              const qty = quantities[p.cip] || 0;
              const isAlert = alerts[p.cip];
              const hasDiscount = p.discounted_price && p.discount_pct > 0;
              const displayPrice = hasDiscount ? p.discounted_price : p.list_price;
              const tiered = applyTiers(displayPrice, p.price_tiers, qty); // prix effectif selon la quantité saisie
              // produit livré par le labo sur justificatif de commande : commandable même en rupture
              const jr = !p.in_stock ? justifProducts[p.cip] : null;
              const orderable = p.in_stock || !!jr;
              // règle de quantité du catalogue (colis, palier, campagne) : boutons au pas du colis, arrondi à l'ajout (App)
              const regle = p.supplier_code ? null : regleQuantite?.(p.cip);
              const pas = regle?.multiple || 1;

              return (
                <div key={p.cip} className="ex-saisie-ligne" data-rupture={orderable ? undefined : ""} data-choisi={qty > 0 ? "" : undefined}>
                  {/* Produit : nom, statut écrit, CIP ; sur justificatif, conditions du laboratoire */}
                  <div className="ex-saisie-info">
                    <div style={{ fontWeight: 600, fontSize: 14, color: T.ink, lineHeight: 1.35, overflowWrap: "anywhere" }}>{p.name}</div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", marginTop: 5 }}>
                      <BadgeStatut statut={p.in_stock ? "stock" : jr ? "commande" : "rupture"}
                        title={jr ? `Commandé au laboratoire ${jr.labNom} sur justificatif de votre commande` : undefined} />
                      {p.in_stock && retourDe(p.cip) && (
                        <span title="Vous aviez demandé à être averti de son retour" style={{ ...ui.badge("info"), padding: "2px 8px 2px 6px" }}>
                          <Icone nom="cloche" taille={12} epaisseur={2.4} />De retour en stock
                        </span>
                      )}
                      {/* CIP avec bouton de copie (anti-copie § 19 : le CIP n'est plus sélectionnable ; revue § 20), hors de la
                          tabulation pour garder l'enchaînement « − », quantité, « + » au clavier (lots 5 et E3) */}
                      <span style={{ fontSize: 12, color: T.inkMute, display: "inline-flex", alignItems: "center", gap: 4 }}>CIP <CipCell cip={p.cip} tabulable={false} /></span>
                    </div>
                    {jr && (
                      <div style={{ fontSize: 12, color: T.teal, marginTop: 6, lineHeight: 1.45 }}>
                        Commandé au laboratoire {jr.labNom} avec votre commande comme justificatif{jr.delai ? ` (${jr.delai})` : ""}.
                        {jr.maxCommande ? ` ${jr.maxCommande} au plus par commande.` : ""}
                      </div>
                    )}
                  </div>

                  {/* Prix HT : barré --ink-mute et remise en badge or + encre, prix net encre 700, palier dessous */}
                  <div className="ex-saisie-prix">
                    {hasDiscount && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span className="num" style={{ fontSize: 12, color: T.inkMute, textDecoration: "line-through" }}>{fmt(p.list_price)}</span>
                        <span className="num" style={{ ...ui.badge("promo"), padding: "1px 6px" }}>{fmtPct(p.discount_pct)}</span>
                      </div>
                    )}
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, color: T.ink, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{fmt(displayPrice)}</div>
                    <div style={{ fontSize: 11, color: T.inkMute }}>Prix HT</div>
                    <TierBadge tiers={p.price_tiers} pn={displayPrice} bloc />
                    {regle && <div className="num" style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>Se commande par {regle.multiple} · {regle.rayon}</div>}
                  </div>

                  {/* Actions : « − » sable, « + » pétrole, quantité (Entrée = Ajouter, lot E3) ; « Ajouter » toujours
                      en place, invisible à 0 (ni focus ni lecture d'écran) : la ligne ne bouge plus quand il apparaît */}
                  <div className="ex-saisie-actions">
                    {orderable ? (<>
                      <div className="ex-saisie-stepper" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button className="ex-qte-moins ex-saisie-pas" aria-label={`Diminuer la quantité de ${p.name}`} onClick={() => setQuantities(prev => { const n = (parseInt(prev[p.cip]) || 0) - pas; return { ...prev, [p.cip]: regle && n < regle.min ? 0 : Math.max(0, n) }; })}
                          style={pasStyle}><Icone nom="moins" taille={16} epaisseur={2.4} /></button>
                        <input type="number" min="0" value={quantities[p.cip] || ""} onChange={e => setQuantities(prev => ({ ...prev, [p.cip]: Math.min(jr?.maxCommande || Infinity, parseInt(e.target.value) || 0) }))}
                          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && qty > 0) { e.preventDefault(); handleAdd(p); } }}   // lot E3 : Entrée = Ajouter
                          placeholder="0" aria-label={`Quantité ${p.name}`} className="ex-saisie-qte" style={{ ...ui.qtyInput(qty > 0), width: undefined, height: undefined, fontSize: 14 }} />
                        <button className="ex-qte-plus ex-saisie-pas" aria-label={`Augmenter la quantité de ${p.name}`} onClick={() => setQuantities(prev => { const c = parseInt(prev[p.cip]) || 0; return { ...prev, [p.cip]: Math.min(jr?.maxCommande || Infinity, regle && c < regle.min ? regle.min : c + pas) }; })}
                          style={pasStyle}><Icone nom="plus" taille={16} epaisseur={2.4} /></button>
                      </div>
                      <button className="ex-btn-petrole ex-saisie-ajouter" onClick={() => handleAdd(p)}
                        style={{ ...ajouterStyle, visibility: qty > 0 ? "visible" : "hidden" }}>
                        <Icone nom="panier" taille={15} />Ajouter {fmt(tiered.pn * qty)}{tiered.tier ? " ★" : ""}
                      </button>
                    </>) : (
                      <button className={isAlert ? "ex-saisie-alerte" : "ex-btn-ligne ex-saisie-alerte"} onClick={() => toggleAlert(p)} disabled={alertSaving[p.cip]}
                        title={isAlert ? "Un e-mail vous sera envoyé à son retour en stock. Cliquez pour retirer l’alerte." : "Recevoir un e-mail, une seule fois, dès son retour en stock"}
                        style={{ ...alerteStyle, ...(isAlert ? alerteActive : {}), opacity: alertSaving[p.cip] ? 0.5 : 1 }}>
                        <Icone nom={isAlert ? "coche" : "cloche"} taille={15} />{alertErreur[p.cip] || (isAlert ? "Alerte activée" : "M’avertir du retour")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {bandeauRetours && <div style={{ marginTop: 14 }}>{bandeauRetours}</div>}
        </div>
      )}
    </div>
  );
}

// ── Atomes de la Saisie (lot 5) : fond, couleur et taille portés par les classes (survol, mobile) ──
// filtre : sable + encre, actif encre + paper (ex-filtre selon aria-pressed)
const filtreStyle = { ...ui.pill(false), background: undefined, color: undefined };
// « − » / « + » : 30 px, 40 px sur mobile (ex-saisie-pas, lot 9) ; fond par ex-qte-moins / ex-qte-plus
const pasStyle = { ...ui.qtyBtn("plus"), background: undefined, color: undefined, width: undefined, height: undefined };
// « Ajouter » : pastille pétrole (ex-btn-petrole, survol sarcelle), largeur réservée (ex-saisie-ajouter)
const ajouterStyle = { ...ui.btn("primaire", "s"), background: undefined, color: undefined, height: undefined, gap: 6, padding: "0 14px", fontVariantNumeric: "tabular-nums" };
// alerte de retour en stock : bouton à filet, puis ton info (menthe + sarcelle) une fois activée
const alerteStyle = { ...ui.btn("ligne", "s"), background: undefined, height: undefined, gap: 6, padding: "0 14px", boxShadow: `inset 0 0 0 1.5px ${T.lineField}` };
const alerteActive = { background: tone("info").bg, color: tone("info").fg, boxShadow: `inset 0 0 0 1px ${tone("info").border}` };
// « De retour en stock » : nom du produit (recherche) et croix (masquer), dans une pastille blanche à filet menthe
const retourStyle = { height: 28, border: "none", borderRadius: R.pill, background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
  color: T.ink, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" };
