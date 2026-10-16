import React, { useRef, useState } from "react";
import { T, R, ui, adm } from "../theme.js";
import { Icone } from "../icons.jsx";

// ── Admin : laboratoires de la Centrale OTC renseignés depuis Medipim (« Fabricant », docs/labo-otc.md) ──
// 1. Recherche : lots de 150 codes (medipim-lookup, mode lot : une recherche Medipim par lot, ~1 s), un lot à la fois,
//    1,5 s entre deux (clé Medipim partagée : 100 appels/min) ; saturation (429) ou panne (5xx) : pause puis 2 essais.
// 2. Enregistrement : un appel products-upsert par produit, avec le seul champ labo (prix, nom… jamais renvoyés),
//    3 à la fois ; seulement quand Medipim donne un laboratoire différent.
// Un laboratoire déjà renseigné (saisi à la main ou venu de Medipim) n'est jamais remplacé, sauf case cochée.
const LOT = 150;
const pause = (ms) => new Promise(r => setTimeout(r, ms));
const laboDe = (p) => String(p.labo || "").replace(/\s+/g, " ").trim();

export default function AdminLabos({ products, adminFetch, flash, fetchProducts }) {
  const [remplacer, setRemplacer] = useState(false);
  const [etat, setEtat] = useState(null);   // en cours : { etape, fait, total } ; terminé : { bilan }
  const arret = useRef(false);
  const otc = products.filter(p => p.section === "otc" && p.cip);
  const sansLabo = otc.filter(p => !laboDe(p));
  // colonne labo présente : products-get (select=*) la renvoie sur chaque produit, même vide
  const colonne = products.some(p => Object.prototype.hasOwnProperty.call(p, "labo"));
  const enCours = !!etat && !etat.bilan;

  const lancer = async () => {
    const cibles = remplacer ? otc : sansLabo;
    if (!cibles.length) return;
    if (!window.confirm(`Chercher dans Medipim le laboratoire de ${cibles.length} produit${cibles.length > 1 ? "s" : ""} de la Centrale OTC et l'enregistrer ?`
      + (remplacer ? "\n\nLes laboratoires déjà renseignés, y compris ceux saisis à la main, seront remplacés par celui de Medipim." : ""))) return;
    arret.current = false;
    // introuvables : sans laboratoire Medipim, fiche absente ou trouvée sans fabricant (sansFabricant : aucune
    // organisation, ou un répartiteur seul, docs/labo-otc.md) ; dans les deux cas, à saisir à la main
    const trouves = [], introuvables = [], sansFabricant = new Set();
    let erreur = null;
    for (let i = 0; i < cibles.length && !arret.current; i += LOT) {
      const lot = cibles.slice(i, i + LOT);
      setEtat({ etape: "Recherche dans Medipim", fait: i, total: cibles.length });
      let r = null, j = {};
      try {
        for (let essai = 0; essai < 3; essai++) {
          r = await adminFetch("/.netlify/functions/medipim-lookup", { method: "POST", body: JSON.stringify({ action: "labos", codes: lot.map(p => p.cip) }) });
          j = await r.json().catch(() => ({}));
          if (r.status !== 429 && r.status < 500) break;
          if (essai < 2) await pause((parseInt(r.headers.get("Retry-After")) || 20) * 1000);
        }
      } catch (e) { erreur = `Medipim injoignable : ${e.message}`; break; }
      if (!r.ok) { erreur = j.error || `Medipim : erreur ${r.status}`; break; }
      for (const c of Array.isArray(j.sans_labo) ? j.sans_labo : []) sansFabricant.add(c);
      for (const p of lot) { const l = j.labos?.[p.cip]?.labo; if (l) trouves.push([p, l]); else introuvables.push(p); }
      if (i + LOT < cibles.length) await pause(1500);
    }
    const aEcrire = trouves.filter(([p, l]) => l !== laboDe(p));
    let ok = 0, ko = 0, n = 0;
    const ecrire = async (seul) => {
      while (n < aEcrire.length && !arret.current) {
        const [p, l] = aEcrire[n++];
        try {
          const r = await adminFetch("/.netlify/functions/products-upsert", { method: "POST", body: JSON.stringify({
            product: { cip: p.cip, labo: l, _changes: { labo: { avant: laboDe(p) || null, apres: l, source: "medipim" } } }, action: "update", author: "medipim" }) });
          const j = await r.json().catch(() => ({}));
          if (j.success) ok++;
          else { ko++; if (j.code === "labo_colonne_absente") { erreur = j.error; arret.current = true; } }
        } catch { ko++; }
        setEtat({ etape: "Enregistrement", fait: ok + ko, total: aEcrire.length });
        if (seul) return;
      }
    };
    // le premier seul (colonne labo et jeton vérifiés une fois), puis 3 à la fois
    if (!erreur && aEcrire.length) { await ecrire(true); await Promise.all([ecrire(), ecrire(), ecrire()]); }
    const identiques = trouves.length - aEcrire.length;
    if (ok) await fetchProducts();
    setEtat({ bilan: { ok, ko, identiques, introuvables, sansFabricant, erreur, arrete: arret.current && !erreur,
      nonTraites: cibles.length - ok - ko - identiques - introuvables.length } });
    flash(`${erreur ? "⚠ " : "✅ "}Laboratoires : ${ok} enregistré${ok > 1 ? "s" : ""}${introuvables.length ? `, ${introuvables.length} sans laboratoire dans Medipim` : ""}${erreur ? " — " + erreur : ""}`);
  };

  const b = etat?.bilan;
  return (
    <div style={{ ...ui.panel, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: T.petrol }}>
        <Icone nom="etiquette" taille={16} />Laboratoires — Centrale OTC / Para
      </div>
      <div className="num" style={{ fontSize: 12, color: T.inkSoft, margin: "4px 0 10px" }}>
        {otc.length - sansLabo.length} / {otc.length} produits renseignés · {sansLabo.length} sans laboratoire. Tri et filtre par laboratoire du site : affichés dès qu'un laboratoire est connu.
      </div>
      {!colonne ? (
        <div role="alert" style={{ ...ui.encart("warn"), fontSize: 12 }}>
          Colonne « labo » absente de Supabase : à exécuter une fois dans l'éditeur SQL, puis recharger l'admin :
          <code style={{ display: "block", marginTop: 6, fontFamily: T.mono, userSelect: "all" }}>ALTER TABLE public.elixir_products ADD COLUMN IF NOT EXISTS labo TEXT;</code>
        </div>
      ) : <>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <button onClick={lancer} disabled={enCours || !(remplacer ? otc : sansLabo).length}
            style={{ ...adm.btn, width: "auto", padding: "8px 16px", fontSize: 12, ...(enCours || !(remplacer ? otc : sansLabo).length ? { background: T.sand, color: T.inkSoft, cursor: "default" } : {}) }}>
            {remplacer ? "Mettre à jour tous les laboratoires (Medipim)" : "Renseigner les laboratoires manquants (Medipim)"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, cursor: "pointer" }}>
            <input type="checkbox" checked={remplacer} disabled={enCours} onChange={e => setRemplacer(e.target.checked)} />
            Remplacer aussi les laboratoires déjà renseignés (même saisis à la main)
          </label>
        </div>
        {enCours && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div role="status" className="num" style={{ fontSize: 12, color: T.inkSoft }}>{etat.etape}… {etat.fait} / {etat.total}</div>
            <progress value={etat.fait} max={etat.total || 1} style={{ flex: "1 1 160px", accentColor: "var(--teal)" }} />
            <button onClick={() => { arret.current = true; }} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 12 }}>Arrêter</button>
          </div>
        )}
        {b && (
          <div role="status" style={{ ...ui.encart(b.erreur ? "danger" : b.ko ? "warn" : "ok"), fontSize: 12, marginTop: 10 }}>
            {b.erreur && <div style={{ fontWeight: 700, marginBottom: 4 }}>{b.erreur}</div>}
            <span className="num">{b.ok} laboratoire{b.ok > 1 ? "s" : ""} enregistré{b.ok > 1 ? "s" : ""}
              {b.identiques ? ` · ${b.identiques} déjà à jour` : ""}{b.ko ? ` · ${b.ko} en erreur (relancer)` : ""}
              {b.introuvables.length ? ` · ${b.introuvables.length} sans laboratoire dans Medipim (à saisir à la main)` : ""}
              {b.nonTraites > 0 ? ` · ${b.nonTraites} non traité${b.nonTraites > 1 ? "s" : ""}${b.arrete ? " (arrêté)" : ""}` : ""}.</span>
            {b.introuvables.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Voir les produits sans laboratoire</summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: T.ink }}>
                  {b.introuvables.map(p => <li key={p.cip}>{p.name} <span style={{ fontFamily: T.mono, color: T.inkMute }}>{p.cip}</span>
                    <span style={{ color: T.inkMute }}>{b.sansFabricant.has(p.cip) ? " — fiche Medipim sans fabricant (ou répartiteur seul)" : " — absent de Medipim"}</span></li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </>}
    </div>
  );
}
