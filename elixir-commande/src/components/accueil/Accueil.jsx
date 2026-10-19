// ── Page d'accueil « La Tête de gondole » (docs/accueil.md) : chunk chargé à la demande ──
// Données : GET accueil-offres (classement des 15 derniers jours, préchargé par App, relu toutes les 5 min), résolues avec
// le catalogue du site (§ 8.3) : prix, paliers, menu et règle de quantité sont ceux du menu où l'ajout rangera la ligne —
// la vitrine ne contredit jamais un menu ni le panier. Retirés : justificatif labo, campagne, exclusions de l'admin (toute
// la famille), rupture d'un produit de menu, menu non ouvrable. 10 produits au plus (diapositives, puis réserves).
// Sous la vitrine : mise à jour du classement, « Offres du moment » (menus promo actifs et pas échus ; aussi en bandeau
// dans l'en-tête de la vitrine sur grand écran), suggestions de recommande, « Accès rapides » (rien n'est accessible
// uniquement par le carrousel). Pas de vitrine (session sans jeton, erreur, classement périmé) : la page commence par ces
// rangées, sans message d'erreur. Résolution des offres : resolution.js (testée hors ligne).
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./accueil.css";
import { Icone } from "../../icons.jsx";
import SqueletteAccueil from "./Squelette.jsx";
import Vitrine, { SceneCarte } from "./Vitrine.jsx";
import Etiquette from "./Etiquette.jsx";
import { construireDiapos, promosEnCours, jourParis } from "./resolution.js";
import { POINTEUR_FIN, REDUIT, majTexte, sansEmoji, useMedia } from "./outils.js";

const OUTILS = ["accueil", "saisie", "peremption", "fauteuil", "transfert", "justificatif", "ulabs", "groupees"];
const RAFRAICHIR_MS = 5 * 60e3;   // prix et stock des produits hors menu : relus comme le stock des menus (5 min)
const vitrineValide = (d) => !!(d && !d.perime && Array.isArray(d.slides) && d.slides.length > 0);

export default function Accueil({ identite, lireOffres, catalogue = {}, catalogueCharge: chargementFini, ordre = [], iconeMenu, regleSaisie, menuOuvrable,
  estCampagne, justifProducts = {}, stockData = {}, qteAuPanier = {}, onAjouter, onModifier, onOuvrirPanier, naviguer, voirDansSaisie, reglages = {},
  pauseExterne, promos: menusPromo = [], ouvrirMesCommandes, dateFin, suggestions = null }) {
  // menus promo actifs et pas encore échus (une offre « jusqu'au 25 sept. » n'est plus mise en avant le 19 oct.)
  const promos = promosEnCours(menusPromo, jourParis());
  const teinteDe = (k) => catalogue[k]?.accent || catalogue.saisie?.accent || "#2d9cbc";
  // accès rapides : Saisie de commande, Mes commandes, puis les 4 premiers menus du catalogue (ordre de l'admin)
  const saisie = catalogue.saisie ? { icone: iconeMenu("saisie", catalogue.saisie, 22), label: catalogue.saisie.label } : null;
  const menus = ordre.filter(k => catalogue[k] && !OUTILS.includes(k) && !k.startsWith("promo_")).slice(0, 4)
    .map(k => ({ key: k, label: catalogue[k].label, sousTitre: catalogue[k].subtitle, icone: iconeMenu(k, catalogue[k], 22), couleur: catalogue[k].accent }));
  const reduit = useMedia(REDUIT), finPointer = useMedia(POINTEUR_FIN), isMobile = useMedia("(max-width: 767px)");   // mêmes seuils qu'App
  // catalogue chargé (products-get) : sans lui, un produit d'un menu partirait au mauvais prix → ajout désactivé
  const catalogueCharge = chargementFini && Object.values(catalogue).some(c => c.products?.length);
  const [donnees, setDonnees] = useState(undefined);   // undefined : chargement ; null : pas de vitrine
  const signature = useRef("");
  useEffect(() => {
    let annule = false;
    signature.current = "";
    if (!identite) { setDonnees(null); return undefined; }
    lireOffres().then(d => {
      if (annule) return;
      const ok = vitrineValide(d);
      if (!ok && import.meta.env.DEV) console.info("[accueil] pas de vitrine :", d ? (d.perime ? "classement périmé" : "aucun produit") : "réponse refusée ou absente");
      signature.current = ok ? JSON.stringify(d) : "";
      setDonnees(ok ? d : null);
    });
    // page laissée ouverte : prix et stock relus toutes les 5 min et au retour sur l'onglet (au plus une lecture par
    // minute : lireOffres garde la réponse 60 s) ; réponse invalide ou identique → rien ne change
    const relire = () => {
      if (document.hidden) return;
      lireOffres().then(d => {
        if (annule || !vitrineValide(d)) return;
        const sig = JSON.stringify(d);
        if (sig !== signature.current) { signature.current = sig; setDonnees(d); }
      });
    };
    const minuteur = setInterval(relire, RAFRAICHIR_MS);
    document.addEventListener("visibilitychange", relire);
    return () => { annule = true; clearInterval(minuteur); document.removeEventListener("visibilitychange", relire); };
  }, [identite]);   // eslint-disable-line react-hooks/exhaustive-deps

  const exclus = (reglages.exclus || []).join(",");
  // photos choisies dans l'admin (display_config.accueil.photos : CIP → adresse) pour les produits sans photo au catalogue ;
  // réglages relus à chaque rendu d'App : clé texte, pour ne recalculer qu'à un vrai changement
  const photos = JSON.stringify(reglages.photos || {});
  const slides = useMemo(() => construireDiapos(donnees, {
    catalogue, catalogueCharge, stockData, justifProducts, menuOuvrable, regleSaisie, estCampagne, photos: JSON.parse(photos), teinte: teinteDe,
    exclus: new Set(exclus ? exclus.split(",") : []),
  }), [donnees, catalogueCharge, catalogue, stockData, justifProducts, exclus, photos]);   // eslint-disable-line react-hooks/exhaustive-deps

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
          qteAuPanier={qteAuPanier} pret={catalogueCharge} onAjouter={onAjouter} onModifier={onModifier} onOuvrirPanier={onOuvrirPanier} onVoir={voir}
          offres={promos} onOffre={(ps) => aller(naviguer(`promo_${ps.id}`))} />
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

      {/* suggestions de recommande (App) : sous la vitrine et les offres, plus au-dessus de la vitrine */}
      {suggestions}

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
