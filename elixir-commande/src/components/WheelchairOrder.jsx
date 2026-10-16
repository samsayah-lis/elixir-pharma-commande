import React, { useState, useEffect, useMemo } from "react";
import { recommend, SIZES, LINES, sizeLabel, refsFor, fitToLine, totalStock, allocate, MEASURE_BANDS, WEIGHT_BANDS } from "../wheelchair-logic.js";
import { loadGroups } from "../product-groups.js";
import { TierBadge, applyTiers } from "../tiers.jsx";
import ProductMedia, { Lightbox } from "./ProductMedia.jsx";
import { MEDIA } from "../wheelchair-media.js";
import { T, R, ui, tone, fmtEur, fmtPct as fmtPctFr } from "../theme.js";
import { Icone } from "../icons.jsx";
import EnteteVue from "./ui/EnteteVue.jsx";
import BadgeStatut from "./ui/BadgeStatut.jsx";
import { Chargement } from "./ui/EtatVide.jsx";

// Affichage seulement (refonte charte, lot 7) : format français de src/theme.js. Le panier reçoit les prix bruts.
const fmt = (n) => n != null ? fmtEur(parseFloat(n)) : "–";
const fmtPct = (n) => n > 0 ? fmtPctFr(n, { vide: "" }) : "";

// ── Refonte charte, lot 7 : atomes communs (theme.js) au lieu des copies locales ; guide de mesure passé sur les jetons ──
const card = ui.card;
const h2 = ui.h2;
const input = { ...ui.input, width: 120, minHeight: 44, fontSize: 16, fontWeight: 700 };
const label = ui.label;
const TON_OK = tone("ok"), TON_WARN = tone("warn");

// Parcours guidé : largeur d'assise → fauteuil de la gamme (stock + prix Odoo).
// lineKey : « fauteuil » (fauteuil roulant, 4 tailles) ou « transfert » (fauteuil de transfert, 2 tailles).
// icone, couleur : icône et couleur du menu (App), comme l'en-tête du catalogue
export default function WheelchairOrder({ onAddToCart, lineKey = "fauteuil", icone, couleur }) {
  const line = LINES[lineKey] || LINES.fauteuil;
  const sizes = line.sizes;
  const [method, setMethod] = useState("mesure");
  const [measure, setMeasure] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [manualIdx, setManualIdx] = useState(null);
  const [qty, setQty] = useState(1);
  const [data, setData] = useState(null);   // { refs: { code fournisseur: [références] }, byCip }
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(null);   // { photos, index } : photo agrandie
  const media = MEDIA[line.key] || null;
  const mainPhoto = media?.photos?.[0] || null;

  // Stock et prix de chaque taille : toutes les références (CIP) de chaque code fournisseur
  // (une nouvelle livraison peut arriver sous un autre CIP), depuis le catalogue synchronisé.
  useEffect(() => {
    let cancelled = false;
    loadGroups().then(j => { if (!cancelled) { setData(j); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // recommandation sur les 4 largeurs standard, ramenée aux tailles de la gamme (taille au-dessus)
  const result = useMemo(() => fitToLine(recommend({ method, measure, weight, height }), line), [method, measure, weight, height, line]);
  const selectedIdx = manualIdx ?? (result && result.lineIdx != null ? result.lineIdx : null);
  const sizeAt = (i) => sizes[i];
  const codeAt = (i) => line.codes[String(sizes[i])];
  const refs = selectedIdx != null ? refsFor(line, sizeAt(selectedIdx), data) : [];
  const stock = totalStock(refs);
  const plan = allocate(refs, qty);
  // le pharmacien voit UN fauteuil : la référence servie en premier (la plus ancienne en stock)
  const product = plan.lines[0]?.ref || refs.find(r => (Number(r.available) || 0) > 0 || r.in_stock) || refs[0] || null;
  const priceOf = (p) => p.discounted_price && p.discount_pct > 0 ? p.discounted_price : p.list_price;
  const unitPrice = product ? priceOf(product) : null;
  const tiered = product ? applyTiers(unitPrice, product.price_tiers, qty) : null;
  const canAdd = !!product && stock > 0 && qty >= 1 && plan.missing === 0;

  // une seule ligne de panier ; la répartition entre références (premier entré, premier sorti) est
  // faite à l'envoi de la commande, avec le stock à jour (voir expandSupplierGroups dans App.jsx)
  const add = () => {
    if (!canAdd) return;
    onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: unitPrice, pv: product.list_price,
                    discount: product.discount_pct || 0, tiers: product.price_tiers || null, supplier_code: codeAt(selectedIdx) });
  };
  const reset = () => { setMeasure(""); setWeight(""); setHeight(""); setManualIdx(null); setQty(1); };

  // choix de la méthode : sélecteur segmenté en pastille (sable, segment actif pétrole), état annoncé par aria-pressed
  const seg = (key, text) => (
    <button onClick={() => { setMethod(key); setManualIdx(null); }} aria-pressed={method === key} style={{
      flex: 1, border: "none", borderRadius: R.pill, padding: "9px 14px", minHeight: 40, cursor: "pointer", fontWeight: 600, fontSize: 13, lineHeight: 1.25,
      background: method === key ? T.petrol : "transparent", color: method === key ? T.paper : T.ink, transition: "background-color .15s var(--ease), color .15s var(--ease)" }}>{text}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* En-tête de vue commun (lot 7) au lieu du bandeau en dégradé : la couleur du menu n'est plus qu'un filet et une pastille */}
      <EnteteVue
        icone={icone || line.icon}
        couleur={couleur}
        titre={line.title}
        sousTitre={`Déterminez la largeur d'assise (${sizes.length} tailles : ${sizes.map(x => String(x).replace(".", ",")).join(" · ")} cm), le bon fauteuil ${line.model} s'affiche avec son stock et son prix.`}
        style={{ marginBottom: 0 }}
      />

      {/* 1 · Informations */}
      <div style={card}>
        <h2 style={h2}>1 · Informations disponibles</h2>
        <div style={{ display: "flex", background: T.sand, borderRadius: R.pill, padding: 4, gap: 4, marginBottom: 14, maxWidth: 520 }}>
          {seg("mesure", "Mesure disponible (recommandé)")}
          {seg("poids", "Pas de mesure → poids")}
        </div>
        {method === "mesure" ? (
          <div>
            <label style={label}>Largeur mesurée aux hanches / cuisses, patient assis (cm)</label>
            <input type="number" step="0.5" min="20" max="80" value={measure} onChange={e => { setMeasure(e.target.value); setManualIdx(null); }} placeholder="ex. 42" style={input} />
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 6 }}>Largeur d'assise = mesure + 2,5 à 5 cm de jeu. Voir « Comment prendre la mesure » ci-dessous.</div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <label style={label}>Poids (kg)</label>
              <input type="number" step="0.5" min="20" max="250" value={weight} onChange={e => { setWeight(e.target.value); setManualIdx(null); }} placeholder="ex. 68" style={input} />
            </div>
            <div>
              <label style={label}>Taille (cm) <span style={{ fontWeight: 400, color: T.inkMute }}>— optionnel, affine via l'IMC</span></label>
              <input type="number" step="1" min="100" max="230" value={height} onChange={e => { setHeight(e.target.value); setManualIdx(null); }} placeholder="ex. 170" style={input} />
            </div>
          </div>
        )}
      </div>

      {/* 2 · Résultat */}
      {/* résultat : ton ok (recommandation) ou warn (hors gamme), toujours écrit */}
      <div style={{ ...card, background: result ? (result.outOfRange ? TON_WARN.bg : TON_OK.bg) : T.surface,
                    border: `1px solid ${result ? (result.outOfRange ? TON_WARN.border : TON_OK.border) : T.line}` }}>
        <h2 style={h2}>2 · Largeur d'assise recommandée</h2>
        {!result ? (
          <div style={{ color: T.inkSoft, fontSize: 13 }}>Renseignez {method === "mesure" ? "la mesure" : "le poids"} pour obtenir la recommandation.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <div className="num" style={{ fontSize: result.outOfRange ? 20 : 34, fontWeight: 700, letterSpacing: "-0.02em", color: result.outOfRange ? T.warn : T.ok, lineHeight: 1.1 }}>{result.label}</div>
            <div style={{ flex: 1, minWidth: 220, fontSize: 13, color: T.ink }}>
              {result.reason}
              {result.outOfRange && (
                <div style={{ marginTop: 6, fontWeight: 700, color: T.warn, display: "flex", alignItems: "flex-start", gap: 6 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} /><span>
                  {result.outOfRange === "bariatrique" ? "Au-delà de 100 kg : matériel bariatrique nécessaire. Orienter vers un prestataire de matériel médical pour un essayage."
                    : result.outOfRange === "gamme" ? (lineKey === "transfert" ? "Assise trop étroite pour ce fauteuil de transfert : voir le menu « Fauteuil roulant » (jusqu'à 48 cm)." : "Taille non proposée dans cette gamme : orienter vers un prestataire de matériel médical.")
                    : "Au-delà de 45,5 cm mesurés : modèle large ou sur mesure. Orienter vers un prestataire de matériel médical pour un essayage."}
                </span></div>
              )}
            </div>
          </div>
        )}
        {/* Choix manuel / vue des tailles de la gamme avec stock */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.inkSoft, marginRight: 4 }}>Tailles disponibles :</span>
          {sizes.map((s, i) => {
            const rs = refsFor(line, s, data), st = totalStock(rs);
            const active = selectedIdx === i;
            const etat = !rs.length ? "" : st > 0 ? (Number.isFinite(st) ? `En stock : ${st}` : "En stock") : "Rupture";
            // pastille de taille : pétrole si choisie ; point de stock (ok / rupture) doublé du libellé lu (aria-label) ;
            // 44 px sous 768 px (ex-tactile, lot 9)
            return (
              <button key={s} className="ex-tactile" onClick={() => setManualIdx(i)} title={etat} aria-pressed={active} aria-label={etat ? `${sizeLabel(s)} — ${etat}` : undefined} style={{
                border: `1px solid ${active ? T.petrol : T.lineField}`, background: active ? T.petrol : T.surface, color: active ? T.paper : T.ink,
                borderRadius: R.pill, padding: "0 14px", height: 34, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontVariantNumeric: "tabular-nums" }}>
                {sizeLabel(s)}
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: !rs.length ? T.inkFaint : st > 0 ? (active ? T.mint2 : T.ok) : (active ? "#f2a7a7" : T.danger) }} />
              </button>
            );
          })}
          {manualIdx != null && result && result.lineIdx != null && manualIdx !== result.lineIdx && (
            <button onClick={() => setManualIdx(null)} style={{ border: "none", background: "none", color: T.teal, fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, padding: "6px 2px" }}>
              revenir à la recommandation ({result.label})
            </button>
          )}
        </div>
      </div>

      {/* 3 · Produit */}
      <div style={card}>
        <h2 style={h2}>3 · Fauteuil correspondant</h2>
        {loading ? (
          <Chargement compact texte="Chargement du stock et des prix…" />
        ) : selectedIdx == null ? (
          <div style={{ color: T.inkSoft, fontSize: 13 }}>Le produit s'affichera dès qu'une taille est déterminée (ou choisie ci-dessus).</div>
        ) : !product ? (
          <div style={{ ...ui.encart("danger"), display: "flex", alignItems: "flex-start", gap: 6 }}><Icone nom="alerte" taille={14} style={{ marginTop: 2 }} /><span>Aucune référence trouvée pour cette taille (code fournisseur {codeAt(selectedIdx)}) — utilisez la Saisie de commande.</span></div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            {mainPhoto && (
              <button onClick={() => setZoom({ photos: media.photos, index: 0 })} aria-label="Agrandir la photo du fauteuil"
                style={{ flexShrink: 0, width: 96, height: 66, borderRadius: R.s, overflow: "hidden", border: `1px solid ${T.line}`, padding: 0, background: T.surface, cursor: "zoom-in" }}>
                <img src={mainPhoto.src} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </button>
            )}
            <div style={{ flexShrink: 0 }}>
              <BadgeStatut statut={stock > 0 ? "stock" : "rupture"} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: T.ink }}>{product.name}</div>
              <div className="num" style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>
                CIP : <span style={{ fontFamily: T.mono }}>{product.cip}</span> · largeur d'assise {sizeLabel(sizeAt(selectedIdx))}
                {Number.isFinite(stock) && stock > 0 && <> · <b style={{ color: T.ok }}>stock {stock}</b></>}
              </div>
              {manualIdx != null && result && result.lineIdx != null && manualIdx !== result.lineIdx && (
                <div style={{ fontSize: 12, color: T.warn, marginTop: 4, display: "flex", alignItems: "flex-start", gap: 5 }}><Icone nom="alerte" taille={13} style={{ marginTop: 2 }} />Taille choisie manuellement, différente de la recommandation ({result.label}).</div>
              )}
            </div>
            <div className="num" style={{ textAlign: "right", minWidth: 120 }}>
              {product.discounted_price && product.discount_pct > 0 ? (<>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 12, color: T.inkMute, textDecoration: "line-through" }}>{fmt(product.list_price)}</span>
                  <span style={ui.badge("promo")}>{fmtPct(product.discount_pct)}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: T.ink }}>{fmt(product.discounted_price)}</div>
              </>) : (
                <div style={{ fontSize: 20, fontWeight: 700, color: T.ink }}>{fmt(product.list_price)}</div>
              )}
              <div style={{ fontSize: 11, color: T.inkMute }}>Prix HT</div>
              <TierBadge tiers={product.price_tiers} pn={unitPrice} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button className="ex-qte-moins" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label={`Diminuer la quantité de ${product.name}`} style={pas}><Icone nom="moins" taille={14} epaisseur={2.4} /></button>
                <input type="number" min="1" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} aria-label={`Quantité ${product.name}`}
                  className="ex-qte-champ" style={{ ...ui.qtyInput(true), width: 52, height: 32, fontSize: 14 }} />
                <button className="ex-qte-plus" onClick={() => setQty(q => q + 1)} aria-label={`Augmenter la quantité de ${product.name}`} style={pas}><Icone nom="plus" taille={14} epaisseur={2.4} /></button>
              </div>
              {/* « Ajouter au panier » en pastille pétrole ; indisponible : sable + encre adoucie, curseur interdit ;
                  44 px sous 768 px (ex-tactile, lot 9) */}
              <button className={canAdd ? "ex-btn-petrole ex-tactile" : "ex-tactile"} onClick={add} disabled={!canAdd} style={{
                ...ui.btn("primaire", "m"), background: canAdd ? undefined : T.sand, color: canAdd ? undefined : T.inkSoft,
                cursor: canAdd ? "pointer" : "not-allowed", fontVariantNumeric: "tabular-nums" }}>
                {stock <= 0 ? "Indisponible" : plan.missing > 0 ? `Stock disponible : ${stock}` : `Ajouter au panier · ${fmt((tiered ? tiered.pn : unitPrice) * qty)}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Photos, vidéo et points forts du modèle */}
      <ProductMedia media={media} title={line.model} onZoom={(photos, index) => setZoom({ photos, index })} />
      {zoom && <Lightbox photos={zoom.photos} index={zoom.index} onClose={() => setZoom(null)} onIndex={(index) => setZoom(z => ({ ...z, index }))} />}

      {/* Tuto — infographie de prise de mesure (reprise du guide de référence) */}
      {/* Guide de mesure : palette privée passée sur les jetons (encre, sarcelle, menthe, ton warn) */}
      <details open={method === "mesure"} style={card}>
        <summary style={{ ...h2, cursor: "pointer", margin: 0 }}><Icone nom="regle" taille={16} style={{ color: T.teal, marginRight: 8 }} />Comment prendre la mesure — guide illustré</summary>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14, color: T.ink, fontSize: 14 }}>
          <div style={{ fontSize: 13, color: T.inkSoft }}>Une mesure fiable des hanches, prise en position assise, donne le résultat le plus précis. Voici comment la prendre correctement.</div>

          {[
            ["1", "Matériel", <p style={{ margin: 0 }}>Un simple mètre ruban souple (mètre de couturière) suffit — aucun équipement spécialisé n'est nécessaire.</p>],
            ["2", "Installer le patient", (
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
                <li>Faire asseoir la personne bien au fond d'une chaise ou d'un fauteuil, dos droit contre le dossier.</li>
                <li>Cuisses posées à plat, genoux fléchis à 90°, pieds à plat au sol.</li>
                <li>Toujours mesurer <strong>assis</strong>, jamais debout : la répartition des tissus change en position assise.</li>
              </ul>
            )],
            ["3", "Repérer et mesurer", (
              <div>
                <p style={{ margin: "0 0 10px" }}>Faire passer le mètre à l'horizontale, au point le plus large entre les deux hanches (ou le haut des cuisses si celles-ci dépassent davantage).</p>
                <figure style={{ margin: 0 }}>
                  <svg viewBox="0 0 300 260" role="img" aria-label="Schéma d'une personne assise de face : la largeur se mesure à l'horizontale, au point le plus large entre les deux hanches."
                       style={{ width: "100%", maxWidth: 340, display: "block", margin: "0 auto", color: T.ink }}>
                    <rect x="90" y="30" width="120" height="8" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                    <line x1="95" y1="38" x2="95" y2="230" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                    <line x1="205" y1="38" x2="205" y2="230" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                    <rect x="90" y="150" width="120" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                    <circle cx="150" cy="55" r="18" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M128,80 C122,100 120,120 124,150 L176,150 C180,120 178,100 172,80 Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M126,150 L118,225" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M174,150 L182,225" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <defs>
                      <marker id="wcArrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M0,0 L10,5 L0,10 z" style={{ fill: T.teal }} />
                      </marker>
                    </defs>
                    <line x1="118" y1="145" x2="182" y2="145" strokeWidth="2" strokeDasharray="4 3" markerStart="url(#wcArrow)" markerEnd="url(#wcArrow)" style={{ stroke: T.teal }} />
                    <text x="150" y="132" textAnchor="middle" fontSize="12.5" fontWeight="600" style={{ fill: T.teal, fontFamily: "inherit", paintOrder: "stroke", stroke: T.paper, strokeWidth: 4, strokeLinejoin: "round" }}>largeur mesurée ici</text>
                  </svg>
                  <figcaption style={{ textAlign: "center", fontSize: 13, color: T.inkSoft, marginTop: 10 }}>Vue de face, patient assis : la mesure se prend au point le plus large des hanches ou des cuisses.</figcaption>
                </figure>
              </div>
            )],
            ["4", "Bonnes pratiques", (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", lineHeight: 1.55 }}>
                {["Mesurer avec les vêtements habituels du quotidien (ni gros manteau, ni sous-vêtements).",
                  "Laisser le mètre à plat contre le corps sans comprimer les tissus mous.",
                  "Prendre la mesure deux fois ; en cas d'écart, garder la moyenne.",
                  "Noter la valeur immédiatement et la reporter dans le champ « Mesure » ci-dessus, puis ajouter 2,5 à 5 cm de jeu (le calcul le fait pour vous)."
                ].map(t => <li key={t} style={{ position: "relative", paddingLeft: 26, marginBottom: 6 }}><Icone nom="coche" taille={16} epaisseur={2.4} style={{ position: "absolute", left: 0, top: 3, color: T.teal }} />{t}</li>)}
              </ul>
            )],
          ].map(([n, title, body]) => (
            <section key={n} style={{ background: T.paper, border: `1px solid ${T.line}`, borderRadius: R.m, padding: "18px 20px" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 640, color: T.ink, display: "flex", alignItems: "center", gap: 10 }}>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: T.teal, background: T.mint, borderRadius: R.pill, minWidth: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>{title}
              </h3>
              {body}
            </section>
          ))}

          <div style={{ ...ui.encart("warn"), padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}><Icone nom="alerte" taille={14} />Erreurs fréquentes</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.5 }}>
              <li>Mesurer la personne debout au lieu d'assise.</li>
              <li>Mesurer par-dessus un manteau épais ou plusieurs couches de vêtements.</li>
              <li>Serrer le mètre comme un tour de taille — cela sous-estime la largeur réelle.</li>
            </ul>
          </div>
          <div style={{ fontSize: 12.5, color: T.inkSoft, textAlign: "center" }}>Sans possibilité de mesurer directement, l'estimation par le poids (et la taille, en option) reste disponible ci-dessus — la mesure directe est toujours préférable.</div>
        </div>
      </details>

      {/* Tables de référence */}
      <details style={card}>
        <summary style={{ ...h2, cursor: "pointer", margin: 0 }}><Icone nom="document" taille={16} style={{ color: T.teal, marginRight: 8 }} />Tables de référence</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 12 }}>
          {[["Mesure (hanches/cuisses)", MEASURE_BANDS, method === "mesure"], ["Poids (sans mesure)", WEIGHT_BANDS, method === "poids"]].map(([title, bands, isActive]) => (
            <table key={title} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ ...thRef, textAlign: "left" }}>{title}</th><th style={{ ...thRef, textAlign: "right" }}>Largeur</th></tr></thead>
              <tbody>
                {bands.map(b => {
                  const hit = isActive && result && result.band === b;
                  return (
                    <tr key={b.label} style={{ background: hit ? TON_OK.bg : "transparent", fontWeight: hit ? 700 : 400, color: b.idx == null ? T.warn : T.ink }}>
                      <td style={{ padding: "7px 6px", borderBottom: `1px solid ${T.lineSoft}` }}>{b.label}</td>
                      <td className="num" style={{ padding: "7px 6px", borderBottom: `1px solid ${T.lineSoft}`, textAlign: "right", fontWeight: 700 }}>{b.idx == null ? "hors gamme" : (fitToLine({ idx: b.idx, reason: "" }, line).label || "hors gamme")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 10 }}>
          Ajustement IMC (si la taille est connue) : IMC &lt; 18,5 et poids en haut de tranche → taille inférieure ; IMC &gt; 30 et poids en bas de tranche → taille supérieure.
        </div>
      </details>

      <div style={{ textAlign: "right" }}>
        <button className="ex-btn-ligne" onClick={reset} style={{ ...ui.btn("ligne", "s"), background: undefined, color: T.inkSoft, boxShadow: `inset 0 0 0 1px ${T.lineField}`, fontWeight: 600 }}>
          <Icone nom="actualiser" taille={14} />Réinitialiser
        </button>
      </div>
    </div>
  );
}

// boutons « − » / « + » de 32 px (40 sous 768 px, lot 9) : fond, survol et taille mobile par les classes ex-qte-moins / ex-qte-plus
const pas = { width: 32, height: 32, padding: 0, border: "none", borderRadius: R.pill, cursor: "pointer", flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center" };
// en-tête des tables de référence : eyebrow --ink-mute 11 px
const thRef = { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkMute, padding: "0 6px 6px", borderBottom: `1px solid ${T.line}` };
