// ── Page d'accueil « La Tête de gondole » (docs/accueil.md) : chunk chargé à la demande ──
// Données : GET accueil-offres (classement des 15 derniers jours, préchargé par App), résolues ici avec le catalogue du
// site (§ 8.3) : prix, paliers, menu et règle de quantité sont ceux du menu où l'ajout rangera la ligne — la vitrine ne
// contredit jamais un menu ni le panier. Retirés : justificatif labo, exclusions de l'admin, rupture d'un produit de
// menu, menu non ouvrable. 10 produits au plus (diapositives, puis réserves).
// Sous la vitrine : mise à jour du classement, « Offres du moment » (menus promo actifs), « Accès rapides » (rien
// n'est accessible uniquement par le carrousel). Pas de vitrine (session sans jeton, erreur, classement périmé) : la
// page commence par ces deux rangées, sans message d'erreur.
import React, { useEffect, useMemo, useState } from "react";
import "./accueil.css";
import { Icone } from "../../icons.jsx";
import { applyTiers } from "../../tiers.jsx";
import SqueletteAccueil from "./Squelette.jsx";
import Vitrine, { SceneCarte } from "./Vitrine.jsx";
import Etiquette from "./Etiquette.jsx";
import { POINTEUR_FIN, REDUIT, majTexte, sansEmoji, useMedia } from "./outils.js";

const NB = 10;
const nombreTranche = (t) => parseInt(String(t || "").replace(/\D/g, ""), 10) || 0;
const OUTILS = ["accueil", "saisie", "peremption", "fauteuil", "transfert", "justificatif", "ulabs", "groupees"];
// Produit du catalogue : PREMIER menu qui contient le CIP, dans l'ordre d'addItemToCart (c'est là que l'ajout range la
// ligne, au prix de ce menu) → { catKey, p, label, accent } | null (produit hors menu : ligne « spéciale » de la Saisie)
function produitDuCatalogue(catalogue, cip) {
  for (const [catKey, c] of Object.entries(catalogue)) {
    const p = (c.products || []).find(x => x.cip === cip);
    if (p) return { catKey, p, label: c.label || catKey, accent: c.accent };
  }
  return null;
}

export default function Accueil({ identite, lireOffres, catalogue = {}, catalogueCharge: chargementFini, ordre = [], iconeMenu, regleSaisie, menuOuvrable,
  justifProducts = {}, stockData = {}, qteAuPanier = {}, onAjouter, onModifier, onOuvrirPanier, naviguer, voirDansSaisie, reglages = {}, pauseExterne,
  promos: menusPromo = [], ouvrirMesCommandes, dateFin }) {
  const promos = menusPromo.filter(p => p.active);
  const teinteDe = (k) => catalogue[k]?.accent || catalogue.saisie?.accent || "#2d9cbc";
  // accès rapides : Saisie de commande, Mes commandes, puis les 4 premiers menus du catalogue (ordre de l'admin)
  const saisie = catalogue.saisie ? { icone: iconeMenu("saisie", catalogue.saisie, 22), label: catalogue.saisie.label } : null;
  const menus = ordre.filter(k => catalogue[k] && !OUTILS.includes(k) && !k.startsWith("promo_")).slice(0, 4)
    .map(k => ({ key: k, label: catalogue[k].label, sousTitre: catalogue[k].subtitle, icone: iconeMenu(k, catalogue[k], 22), couleur: catalogue[k].accent }));
  const reduit = useMedia(REDUIT), finPointer = useMedia(POINTEUR_FIN), isMobile = useMedia("(max-width: 767px)");   // mêmes seuils qu'App
  // catalogue chargé (products-get) : sans lui, un produit d'un menu partirait au mauvais prix → ajout désactivé
  const catalogueCharge = chargementFini && Object.values(catalogue).some(c => c.products?.length);
  const [donnees, setDonnees] = useState(undefined);   // undefined : chargement ; null : pas de vitrine
  useEffect(() => {
    let annule = false;
    if (!identite) { setDonnees(null); return undefined; }
    lireOffres().then(d => {
      if (annule) return;
      const ok = d && !d.perime && Array.isArray(d.slides) && d.slides.length > 0;
      if (!ok && import.meta.env.DEV) console.info("[accueil] pas de vitrine :", d ? (d.perime ? "classement périmé" : "aucun produit") : "réponse refusée ou absente");
      setDonnees(ok ? d : null);
    });
    return () => { annule = true; };
  }, [identite]);   // eslint-disable-line react-hooks/exhaustive-deps

  const exclus = (reglages.exclus || []).join(",");
  const slides = useMemo(() => {
    if (!donnees) return [];
    const sansAdmin = new Set(exclus ? exclus.split(",") : []);
    const resoudre = (o) => {
      if (!o?.cip || justifProducts[o.cip] || sansAdmin.has(o.cip)) return null;
      let r = { ...o };
      if (catalogueCharge) {
        const t = produitDuCatalogue(catalogue, o.cip);
        if (t) {
          if (!menuOuvrable(t.catKey)) return null;
          const st = stockData[o.cip];
          if (st && (st.dispo === 0 || st.dispo === false)) return null;
          const p = t.p;
          if (!(Number(p.pn) > 0)) return null;
          r = { ...r, pv: p.pv, pn: p.pn, pct: Number(p.pct) || 0, remise_eur: p.remise_eur ?? Math.round((p.pv - p.pn) * 100) / 100,
            price_tiers: p.price_tiers || null, nom_panier: p.name, image_url: p.image_url || o.image_url || null, menu: { key: t.catKey, label: sansEmoji(t.label) }, teinte: t.accent };
        } else r = { ...r, menu: { key: "saisie", label: "Saisie de commande" }, teinte: teinteDe("saisie") };
        // règle de quantité de la Saisie (colis, minimum) ; lot = max(minimum, multiple, 1), montant = ce que le panier facture
        const g = regleSaisie(o.cip);
        r.regle = g ? { step: g.step, min: g.min, multiple: g.multiple } : { step: 1, min: 1, multiple: 1 };
        const qte = Math.max(r.regle.min || 0, r.regle.multiple || 1, 1);
        const pu = applyTiers(r.pn, r.price_tiers, qte).pn;
        r.lot = { qte, pu, total: Math.round(pu * qte * 100) / 100 };
      } else {
        // catalogue pas encore chargé : prix du GET, ajout désactivé (« Chargement des prix… »)
        r = { ...r, regle: o.regle_qte || { step: 1, min: 1, multiple: 1 }, teinte: teinteDe(o.menu?.key) || teinteDe("saisie") };
      }
      return r;
    };
    const out = [];
    for (const s of [...donnees.slides, ...(donnees.reserves || [])]) {
      if (out.length >= NB) break;
      const vars = (s.variantes || []).map(v => { const r = resoudre(v); return r && { ...r, libelle: v.libelle, principal: !!v.principal }; }).filter(Boolean);
      // dosage principal retiré : le plus commandé de ceux qui restent devient principal
      const principal = resoudre(s) || [...vars].sort((a, b) => nombreTranche(b.popularite) - nombreTranche(a.popularite))[0];
      if (!principal) continue;
      out.push({ famille: s.famille, labo: s.labo, tendance_pct: s.tendance_pct, nouveau: !!s.nouveau, serie_15j: s.serie_15j || [],
        principal, variantes: vars.length > 1 ? vars.map(v => ({ ...v, principal: v.cip === principal.cip })) : [], teinte: principal.teinte });
    }
    return out;
  }, [donnees, catalogueCharge, catalogue, stockData, justifProducts, exclus]);   // eslint-disable-line react-hooks/exhaustive-deps

  // « Voir dans… », offres, accès rapides : changement de menu, puis haut de page (la vue suivante commence en haut)
  const aller = (ok) => { if (ok) window.scrollTo({ top: 0 }); };
  const voir = (offre, slide) => aller(offre.menu?.key && offre.menu.key !== "saisie" ? naviguer(offre.menu.key, { terme: slide.famille }) : voirDansSaisie(offre.cip));
  const maj = donnees?.genere_le ? majTexte(donnees.genere_le) : "";

  return (
    <div className="acc-page">
      {donnees === undefined && <SqueletteAccueil mobile={isMobile} />}
      {donnees !== undefined && slides.length === 0 && <h1 className="acc-vh">Accueil</h1>}
      {slides.length >= 3 && (
        <Vitrine slides={slides} periode={donnees.periode} isMobile={isMobile} reduit={reduit} finPointer={finPointer} reglages={reglages} pauseExterne={pauseExterne}
          qteAuPanier={qteAuPanier} pret={catalogueCharge} onAjouter={onAjouter} onModifier={onModifier} onOuvrirPanier={onOuvrirPanier} onVoir={voir} />
      )}
      {slides.length > 0 && slides.length < 3 && (
        <section className="acc-duo" aria-labelledby="acc-titre">
          <h1 id="acc-titre" className="acc-h1">Les plus commandés par vos confrères</h1>
          <div className="acc-duo-cartes">
            {slides.map((s, i) => (
              <article key={s.famille} className="acc-carte" aria-label={`${i + 1} : ${s.famille}`}>
                <SceneCarte slide={s} offre={s.principal} position={i + 1} reduit={reduit} />
                <Etiquette slide={s} offre={s.principal} position={i + 1} variantes={[]} teinte={s.teinte} qte={qteAuPanier[s.principal.cip] || 0} pret={catalogueCharge} mobile
                  onAjouter={(q) => { const o = s.principal; onAjouter({ cip: o.cip, name: o.nom_panier, qty: q, pn: o.pn, pv: o.pv, discount: o.pct > 0 ? o.pct : 0, tiers: o.price_tiers || null }); }}
                  onModifier={(q) => onModifier(s.principal.cip, q)} onOuvrirPanier={onOuvrirPanier} onVoir={() => voir(s.principal, s)} />
              </article>
            ))}
          </div>
        </section>
      )}
      {slides.length > 0 && (
        <p className="acc-maj">Classement des produits commandés et servis par Elixir ces 15 derniers jours{maj ? ` · mis à jour ${maj}` : ""}{donnees.apercu ? " · aperçu : classement d'exemple" : ""}</p>
      )}

      {promos.length > 0 && (
        <section className="acc-section" aria-labelledby="acc-offres-titre">
          <h2 id="acc-offres-titre" className="acc-h2">Offres du moment</h2>
          <div className="acc-offres">
            {promos.map(ps => (
              <button key={ps.id} type="button" className="ex-carte acc-offre" style={{ borderLeftColor: ps.color || undefined }} onClick={() => aller(naviguer(`promo_${ps.id}`))}>
                <span className="acc-offre-icone" aria-hidden="true">{ps.icon || <Icone nom="etiquette" taille={20} />}</span>
                <span className="acc-offre-textes">
                  <span className="acc-offre-nom">{ps.name}</span>
                  {ps.endDate && <span className="acc-offre-fin num"><Icone nom="horloge" taille={12} />Jusqu’au {dateFin(ps.endDate)}</span>}
                  <span className="acc-offre-nb num">{(ps.products || []).length} référence{(ps.products || []).length > 1 ? "s" : ""}</span>
                </span>
                <Icone nom="suivant" taille={18} style={{ color: "var(--ink-mute)", flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="acc-section" aria-labelledby="acc-acces-titre">
        <h2 id="acc-acces-titre" className="acc-h2">Accès rapides</h2>
        <div className="acc-acces">
          {saisie && <Tuile icone={saisie.icone} titre={saisie.label} texte="Par CIP ou par nom, stock en temps réel" onClick={() => aller(naviguer("saisie"))} />}
          {ouvrirMesCommandes && <Tuile icone={<Icone nom="commandes" taille={22} />} titre="Mes commandes" texte="Suivre et recommander" onClick={ouvrirMesCommandes} />}
          {menus.map(m => <Tuile key={m.key} icone={m.icone} titre={sansEmoji(m.label)} texte={m.sousTitre} couleur={m.couleur} onClick={() => aller(naviguer(m.key))} />)}
        </div>
      </section>
    </div>
  );
}

function Tuile({ icone, titre, texte, couleur, onClick }) {
  return (
    <button type="button" className="ex-carte acc-tuile" onClick={onClick} style={couleur ? { "--acc-teinte": couleur } : undefined}>
      <span className="acc-tuile-icone" aria-hidden="true">{icone}</span>
      <span className="acc-tuile-textes"><span className="acc-tuile-titre">{titre}</span>{texte && <span className="acc-tuile-texte">{texte}</span>}</span>
    </button>
  );
}
