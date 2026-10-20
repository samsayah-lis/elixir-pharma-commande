// ── Page d'accueil « La Tête de gondole » (docs/accueil.md) : chunk chargé à la demande ──
// Données : GET accueil-offres (classement des 15 derniers jours, préchargé par App, relu toutes les 5 min), résolues avec
// le catalogue du site (§ 8.3) : prix, paliers, menu et règle de quantité sont ceux du menu où l'ajout rangera la ligne —
// la vitrine ne contredit jamais un menu ni le panier. Retirés : justificatif labo, campagne, exclusions de l'admin (toute
// la famille), rupture d'un produit de menu, menu non ouvrable. 10 produits au plus (diapositives, puis réserves).
// Sous la vitrine : mise à jour du classement, « Offres du moment » (menus promo actifs et pas échus ; aussi en bandeau
// dans l'en-tête de la vitrine sur grand écran), suggestions de recommande, « Accès rapides » (rien n'est accessible
// uniquement par le carrousel). Pas de vitrine (session sans jeton, erreur, classement périmé) : la page commence par ces
// rangées, sans message d'erreur. Résolution des offres : resolution.js (testée hors ligne).
// Au-dessus des plus commandés, les mises en avant de Zineb (docs/accueil.md § 7) : la vitrine cinéma « Offre du moment »
// puis la grille « À la une » (vedettes du même GET, recalées sur le catalogue par vedettes.js ; sans mise en avant
// visible, ou GET absent ou plus lent que 4 s : repli automatique sur les menus promo actifs, la page n'est jamais nue).
// Une seule rotation à la fois : la vitrine cinéma qui défile à l'écran met en pause celle des plus commandés.
// Mises en avant d'outils (§ 7.8) : gp = accès de la pharmacie aux Commandes groupées et opérations ouvertes (appel
// « access » déjà fait par App ; attente : réponse pas encore reçue) ; le bouton d'un outil ouvre sa rubrique et remonte
// en haut, comme un menu promo. Commandes groupées mises en avant et accès pas encore connu : le squelette reste au plus
// 1,5 s de plus (sinon la vitrine commencerait sans elles, puis les insérerait en cours de lecture).
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./accueil.css";
import "./mea.css";
import { Icone } from "../../icons.jsx";
import SqueletteAccueil, { noterSalle, salleProbable } from "./Squelette.jsx";
import Vitrine, { SceneCarte } from "./Vitrine.jsx";
import Etiquette from "./Etiquette.jsx";
import Cinema from "./Cinema.jsx";
import Bento from "./Bento.jsx";
import { construireDiapos, promosEnCours, jourParis } from "./resolution.js";
import { construireMisesEnAvant } from "./vedettes.js";
import { RUBRIQUES_HORS_CATALOGUE } from "./rubriques.js";
import { POINTEUR_FIN, REDUIT, RESSORT, anime, majTexte, photo, sansEmoji, useIllisibles, useMedia } from "./outils.js";
import { illisibles } from "./illisibles.js";
import { voler, rebondPanier } from "./vol.js";

// pour l'aperçu de l'admin (ApercuMea.jsx, chargé à part) : les vitrines viennent de ce chunk
export { Cinema, Bento };

const RAFRAICHIR_MS = 5 * 60e3;   // prix et stock des produits hors menu : relus comme le stock des menus (5 min)
const DELAI_MAX_MS = 4000;        // GET plus lent : la page s'affiche (repli des mises en avant), la réponse tardive suit
const ATTENTE_GP_MS = 1500;       // accès aux Commandes groupées pas encore connu (mise en avant des groupées) : attente au plus
const avecGroupees = (d) => (Array.isArray(d?.vedettes?.items) ? d.vedettes.items : []).some(i => i?.type === "outil" && i.outil === "groupees");
const vitrineValide = (d) => !!(d && !d.perime && Array.isArray(d.slides) && d.slides.length > 0);
const reponseValide = (d) => !!(d && typeof d === "object" && (vitrineValide(d) || d.vedettes));

export default function Accueil({ identite, lireOffres, catalogue = {}, catalogueCharge: chargementFini, ordre = [], iconeMenu, regleSaisie, menuOuvrable,
  estCampagne, justifProducts = {}, stockData = {}, qteAuPanier = {}, onAjouter, onModifier, onOuvrirPanier, naviguer, voirDansSaisie, reglages = {},
  pauseExterne, promos: menusPromo = [], ouvrirMesCommandes, dateFin, suggestions = null, gp = null }) {
  // menus promo actifs et pas encore échus (une offre « jusqu'au 25 sept. » n'est plus mise en avant le 19 oct.)
  const promos = promosEnCours(menusPromo, jourParis());
  const teinteDe = (k) => catalogue[k]?.accent || catalogue.saisie?.accent || "#2d9cbc";
  // accès rapides : Saisie de commande, Mes commandes, puis les 4 premiers menus du catalogue (ordre de l'admin)
  const saisie = catalogue.saisie ? { icone: iconeMenu("saisie", catalogue.saisie, 22), label: catalogue.saisie.label } : null;
  const menus = ordre.filter(k => catalogue[k] && !RUBRIQUES_HORS_CATALOGUE.includes(k) && !k.startsWith("promo_")).slice(0, 4)
    .map(k => ({ key: k, label: catalogue[k].label, sousTitre: catalogue[k].subtitle, icone: iconeMenu(k, catalogue[k], 22), couleur: catalogue[k].accent }));
  const reduit = useMedia(REDUIT), finPointer = useMedia(POINTEUR_FIN), isMobile = useMedia("(max-width: 767px)");   // mêmes seuils qu'App
  const large = useMedia("(min-width: 1280px)");
  const format = isMobile ? "s" : large ? "l" : "m";
  // catalogue chargé (products-get) : sans lui, un produit d'un menu partirait au mauvais prix → ajout désactivé
  const catalogueCharge = chargementFini && Object.values(catalogue).some(c => c.products?.length);
  // undefined : chargement ; null : ni classement ni mises en avant (repli automatique des mises en avant)
  const [donnees, setDonnees] = useState(undefined);
  const signature = useRef("");
  // l'utilisateur a-t-il déjà agi sur la page (appui, touche, molette, glissé) ? une réponse tardive ne remplace alors plus
  // les mises en avant qu'il a sous les yeux
  const aAgi = useRef(false);
  useEffect(() => {
    const agir = () => { aAgi.current = true; };
    const evs = ["pointerdown", "keydown", "wheel", "touchmove"];
    evs.forEach(n => window.addEventListener(n, agir, { passive: true, capture: true }));
    return () => evs.forEach(n => window.removeEventListener(n, agir, { capture: true }));
  }, []);
  useEffect(() => {
    let annule = false, tardif = false;
    signature.current = "";
    if (!identite) { setDonnees(null); return undefined; }
    // plus de 4 s : la page s'affiche avec le repli automatique. Réponse tardive : ses mises en avant tout de suite si
    // l'utilisateur n'a encore rien fait (le repli n'était qu'une attente) ; sinon elles attendent le prochain
    // rafraîchissement (5 min, retour sur l'onglet), mais le repli coupé par Zineb (repli: false) est respecté
    const minuteur = setTimeout(() => { tardif = true; setDonnees(d => (d === undefined ? null : d)); }, DELAI_MAX_MS);
    lireOffres().then(d => {
      clearTimeout(minuteur);
      if (annule) return;
      const ok = reponseValide(d);
      if (!vitrineValide(d) && import.meta.env.DEV) console.info("[accueil] pas de vitrine :", d ? (d.perime ? "classement périmé" : "aucun produit") : "réponse refusée ou absente");
      const attendre = ok && tardif && aAgi.current;
      signature.current = ok && !attendre ? JSON.stringify(d) : "";
      setDonnees(!ok ? null : attendre ? { ...d, vedettes: { repli: d.vedettes?.repli !== false, defilement: d.vedettes?.defilement !== false, items: [] } } : d);
    });
    // page laissée ouverte : prix et stock relus toutes les 5 min et au retour sur l'onglet (au plus une lecture par
    // minute : lireOffres garde la réponse 60 s) ; réponse invalide ou identique → rien ne change
    const relire = () => {
      if (document.hidden) return;
      lireOffres().then(d => {
        if (annule || !reponseValide(d)) return;
        const sig = JSON.stringify(d);
        if (sig !== signature.current) { signature.current = sig; setDonnees(d); }
      });
    };
    const relecture = setInterval(relire, RAFRAICHIR_MS);
    document.addEventListener("visibilitychange", relire);
    return () => { annule = true; clearTimeout(minuteur); clearInterval(relecture); document.removeEventListener("visibilitychange", relire); };
  }, [identite]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Commandes groupées mises en avant, accès de la pharmacie pas encore connu : données tenues en attente (squelette)
  // jusqu'à la réponse d'App, 1,5 s au plus
  const [patienceGp, setPatienceGp] = useState(true);
  const attendGp = patienceGp && gp?.attente === true && donnees !== undefined && avecGroupees(donnees);
  useEffect(() => {
    if (!attendGp) return undefined;
    const t = setTimeout(() => setPatienceGp(false), ATTENTE_GP_MS);
    return () => clearTimeout(t);
  }, [attendGp]);
  const vues = attendGp ? undefined : donnees;
  // visibilité des mises en avant refiltrée chaque minute (fin d'offre) tant que l'onglet est affiché, et à la fin d'un
  // compte à rebours
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setMinute(m => m + 1); }, 60e3);
    return () => clearInterval(t);
  }, []);

  const exclus = (reglages.exclus || []).join(",");
  // photos choisies dans l'admin (display_config.accueil.photos : CIP → adresse) pour les produits sans photo au catalogue ;
  // réglages relus à chaque rendu d'App : clé texte, pour ne recalculer qu'à un vrai changement
  const photos = JSON.stringify(reglages.photos || {});
  // photo en erreur (stockage pas public, photo retirée…) : notée par le composant qui la montrait, vitrines reconstruites
  // sans elle, comme si elle n'existait pas (illisibles.js)
  const nIllisibles = useIllisibles();
  const classement = vitrineValide(vues) ? vues : null;
  const slides = useMemo(() => construireDiapos(classement, {
    catalogue, catalogueCharge, stockData, justifProducts, menuOuvrable, regleSaisie, estCampagne, photos: JSON.parse(photos), teinte: teinteDe,
    exclus: new Set(exclus ? exclus.split(",") : []), illisibles: illisibles(),
  }), [classement, catalogueCharge, catalogue, stockData, justifProducts, exclus, photos, nIllisibles]);   // eslint-disable-line react-hooks/exhaustive-deps
  // mises en avant (chargement : rien ; réponse sans vedettes, refusée ou tardive : repli automatique)
  const vedettes = vues?.vedettes ?? null;
  const mea = useMemo(() => (vues === undefined ? { vitrine: [], grille: [], defilement: false } : construireMisesEnAvant(vedettes, {
    catalogue, catalogueCharge, stockData, justifProducts, menuOuvrable, regleSaisie, estCampagne, photos: JSON.parse(photos), teinte: teinteDe,
    promos: menusPromo, aujourdhui: jourParis(), illisibles: illisibles(), gp: { autorise: gp?.autorise === true, ouvertes: gp?.ouvertes ?? null },
  })), [vues === undefined, vedettes, catalogueCharge, catalogue, stockData, justifProducts, photos, menusPromo, minute, nIllisibles, gp?.autorise, gp?.ouvertes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const montreMea = mea.vitrine.length > 0 || mea.grille.length > 0;
  const menusMontres = new Set([...mea.vitrine, ...mea.grille].filter(x => x.menu).map(x => x.menu.id));
  const offresRestantes = promos.filter(ps => !menusMontres.has(String(ps.id)));
  const [cinemaDefile, setCinemaDefile] = useState(false);
  // hauteur de la salle notée pour le squelette de la prochaine visite (0 : pas de vitrine), une fois les données là
  const page = useRef(null);
  const avecSalle = mea.vitrine.length > 0;
  useEffect(() => {
    if (vues === undefined) return undefined;
    const salle = page.current?.querySelector(":scope > .mea-cinema");
    if (!salle) { noterSalle(0); return undefined; }
    let t = 0;
    const noter = () => { clearTimeout(t); t = setTimeout(() => noterSalle(salle.offsetHeight), 500); };
    noter();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(noter) : null;
    ro?.observe(salle);
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [vues === undefined, avecSalle]);   // eslint-disable-line react-hooks/exhaustive-deps

  // « Voir dans… », offres, accès rapides : changement de menu, puis haut de page (la vue suivante commence en haut)
  const aller = (ok) => { if (ok) window.scrollTo({ top: 0 }); };
  const voir = (offre, slide) => aller(offre.menu?.key && offre.menu.key !== "saisie" ? naviguer(offre.menu.key, { terme: slide.famille }) : voirDansSaisie(offre.cip));
  const maj = classement?.genere_le ? majTexte(classement.genere_le) : "";
  // mises en avant : ajout (mêmes règles que la Saisie : ajouterDepuisSaisie), petit bond, vol vers le panier ; « Voir »
  const ajouterVedette = (x, qty, source) => {
    const o = x.offre;
    onAjouter({ cip: o.cip, name: o.nom_panier, qty, pn: o.pn, pv: o.pv, discount: o.pct > 0 ? o.pct : 0, tiers: o.price_tiers || null });
    if (reduit || !source) return;
    anime(source, [{ translate: "0 0" }, { translate: "0 -10px", offset: 0.4 }, { translate: "0 0" }], { duration: 280, easing: RESSORT });
    voler(source, { image: o.image_url ? photo(o.image_url, "thumbnail") : null, marque: o.boite?.marque || x.titre, dosage: o.boite?.dosage, teinte: x.couleur });
    setTimeout(rebondPanier, 520);
    try { if (window.matchMedia?.("(pointer: coarse)").matches) navigator.vibrate?.(8); } catch { /* sans vibreur */ }
  };
  const voirVedette = (x) => {
    // outil : même chemin qu'un menu promo ; false (commande groupée non confirmée, l'utilisateur reste) → pas de remontée
    if (x.outil) return aller(naviguer(x.outil.cle));
    if (x.menu) return aller(naviguer(x.menu.key));
    const o = x.offre, k = o.menu?.key;
    return aller(k && k !== "saisie" ? naviguer(k, { terme: k.startsWith("promo_") ? "" : (o.boite?.marque || "") }) : voirDansSaisie(o.cip));
  };
  const proprietesMea = { format, reduit, finPointer, qteAuPanier, pret: catalogueCharge, onAjouter: ajouterVedette, onModifier, onOuvrirPanier,
    onVoir: voirVedette, onExpire: () => setMinute(m => m + 1) };

  return (
    <div ref={page} className="acc-page">
      {vues === undefined && <SqueletteAccueil mobile={isMobile} vedettes={salleProbable(menusPromo, menuOuvrable)} />}
      {vues !== undefined && (montreMea || slides.length === 0) && <h1 className="acc-vh">Accueil</h1>}
      {mea.vitrine.length > 0 && <Cinema items={mea.vitrine} defilement={mea.defilement} pauseExterne={pauseExterne} onDefile={setCinemaDefile} {...proprietesMea} />}
      {mea.grille.length > 0 && <Bento items={mea.grille} depart={mea.vitrine.length ? 1000 : 200} {...proprietesMea} />}
      {slides.length >= 3 && (
        <Vitrine slides={slides} periode={classement.periode} isMobile={isMobile} reduit={reduit} finPointer={finPointer} reglages={reglages} pauseExterne={pauseExterne || cinemaDefile}
          qteAuPanier={qteAuPanier} pret={catalogueCharge} onAjouter={onAjouter} onModifier={onModifier} onOuvrirPanier={onOuvrirPanier} onVoir={voir}
          offres={montreMea ? [] : promos} onOffre={(ps) => aller(naviguer(`promo_${ps.id}`))} niveauTitre={montreMea ? "h2" : "h1"} />
      )}
      {slides.length > 0 && slides.length < 3 && (
        <section className="acc-duo" aria-labelledby="acc-titre">
          {React.createElement(montreMea ? "h2" : "h1", { id: "acc-titre", className: "acc-h1" }, "Les plus commandés par vos confrères")}
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
        <p className="acc-maj">Classement des produits commandés et servis par Elixir ces 15 derniers jours{maj ? ` · mis à jour ${maj}` : ""}{classement.apercu ? " · aperçu : classement d'exemple" : ""}</p>
      )}

      {/* « Offres du moment » : seulement les menus promo absents de la vitrine cinéma et de la grille */}
      {offresRestantes.length > 0 && (
        <section className="acc-section" aria-labelledby="acc-offres-titre">
          <h2 id="acc-offres-titre" className="acc-h2">Offres du moment</h2>
          <div className="acc-offres">
            {offresRestantes.map(ps => (
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
          {saisie && <Tuile icone={saisie.icone} titre={saisie.label} texte="Par CIP, EAN ou nom" onClick={() => aller(naviguer("saisie"))} />}
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
