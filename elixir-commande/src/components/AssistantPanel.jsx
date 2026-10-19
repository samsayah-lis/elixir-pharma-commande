// ── Assistant Elixir : panneau de conversation (docs/assistant-conception.md § 1, docs/assistant-contrat.md) ──
// Chargé à la demande (React.lazy, src/components/assistant/Aide.jsx) : rien de ce fichier n'entre dans le bundle des
// pharmacies. Tiroir à droite (420 px sur ordinateur, 400 px sur tablette, <aside> sans voile) ; feuille plein écran
// sous 768 px (role="dialog", focus gardé dans la feuille, Retour du navigateur = fermer, clavier iOS suivi par
// visualViewport). Exclusif avec le panier (App). Le texte du modèle passe par l'afficheur sûr (TexteSur) ; chiffres
// et fichiers arrivent par les cartes du serveur (Cartes.jsx). Une demande de retour ne part que sur « Confirmer la
// demande » (action « confirmer », sans passer par le modèle).
// Props : identite (clé de la conversation gardée pour l'onglet), auth (assistant-client.js), mobile, pharmacyName,
// acting (actingFor d'App, { name, … }, en mode « Commander pour une pharmacie »), contexte ({ commande_site_id, date }
// depuis Mes commandes : pastille « Commande du 14 octobre, 10 h 32 »), onClose, onReconnecter (reconnexion par code
// reçu par e-mail sans quitter la session, panier gardé : demanderReconnexion d'App), onInfos(infos).
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { T, ui } from "../theme.js";
import { Icone, CroixElixir } from "../icons.jsx";
import EtatVide, { Chargement } from "./ui/EtatVide.jsx";
import TexteSur from "./assistant/TexteSur.jsx";
import Carte from "./assistant/Cartes.jsx";
import { CSS } from "./assistant/styles.js";
import { ouvrir, nouvelle, envoyer, decider, attendreReponse, telecharger, litMemoire, ecritMemoire } from "./assistant/api.js";
import { heureFr, nomFichier, libelleCommande } from "./assistant/format.js";

const LONGUEUR_MAX = 2000, SEUIL_COMPTEUR = 1800;
// pastilles d'accueil : libellé affiché → phrase envoyée
const PASTILLES = [
  ["Duplicata d'une facture", "Je voudrais le duplicata d'une facture."],
  ["Relevé de facturation", "Je voudrais un relevé de facturation."],
  ["Où en est ma commande ?", "Où en est ma commande ?"],
  ["Demande de retour ou réclamation", "Je voudrais faire une demande de retour ou une réclamation."],
];
const CONSEILLER = ["Parler à un conseiller", "Je voudrais parler à un conseiller."];
const TEXTE_RECONNEXION = "Pour protéger vos documents, l'assistant demande une connexion par code reçu par e-mail.";
const masque = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
const pastille = { ...ui.pill(false), background: undefined, color: undefined };   // fond et survol : classe ex-filtre
const pastilleLigne = { ...ui.btn("ligne", "s"), background: undefined, height: 36, fontSize: 13, fontWeight: 600, boxShadow: `inset 0 0 0 1.5px ${T.lineField}` };
const FOCUSABLES = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// élément encore affiché (le tiroir de menu fermé est masqué par visibility) : là où le focus peut revenir
const visible = (el) => !!el && el.isConnected && el !== document.body && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

// Clavier de l'iPhone : la feuille suit la partie visible de l'écran (visualViewport) pour garder la saisie au-dessus
function useEcranVisible(actif) {
  const [vv, setVv] = useState(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!actif || !v) return;
    const maj = () => setVv({ hauteur: Math.round(v.height), haut: Math.round(v.offsetTop), clavier: v.height < window.innerHeight - 120 });
    maj();
    v.addEventListener("resize", maj);
    v.addEventListener("scroll", maj);
    return () => { v.removeEventListener("resize", maj); v.removeEventListener("scroll", maj); };
  }, [actif]);
  return actif ? vv : null;
}

// Issue d'un récapitulatif d'après la réponse du serveur à « Confirmer » ou « Annuler » (message « d-<demande_id> »,
// chat.js, _chat-demandes.js) : carte « Demande enregistrée » = confirmée ; carte d'erreur = non enregistrée (refusée au
// recontrôle) ; sinon annulée. Jamais d'après le bouton cliqué : le serveur peut refuser une confirmation.
const issue = (m) => ((m?.ui_actions || []).some((a) => a?.type === "demande_enregistree") ? "confirmee"
  : (m?.ui_actions || []).some((a) => a?.type === "erreur") ? "non_enregistree" : "annulee");
// Récapitulatifs déjà traités dans l'historique rejoué (rouverture), et récapitulatifs remplacés par un plus récent (le
// serveur annule le précédent quand l'assistant en prépare un nouveau : ses boutons ne feraient plus rien)
function demandesFermees(messages) {
  const fermees = {};
  let dernier = null;
  for (const m of messages) {
    const id = /^d-(.+)$/.exec(String(m?.id || ""))?.[1];
    if (id) fermees[id] = issue(m);
    for (const a of m?.ui_actions || []) if (a?.type === "recap_retour" && a.demande_id) { if (dernier && !fermees[dernier]) fermees[dernier] = "remplacee"; dernier = a.demande_id; }
  }
  return fermees;
}

function Conversation({ identite, auth, mobile, pharmacyName, acting, contexte, onClose, onReconnecter, onInfos }) {
  const [phase, setPhase] = useState("ouverture");   // ouverture | pret | reconnexion | fiche | erreur
  const [conv, setConv] = useState(null);            // { id, pharmacie, mode, infos, apercu }
  const [messages, setMessages] = useState([]);
  const [attente, setAttente] = useState(null);       // { tourId, etape } : réponse en préparation
  const [envoi, setEnvoi] = useState(false);          // message en cours d'envoi
  const [avis, setAvis] = useState(null);             // { ton, texte, reprendre? }
  const [texte, setTexte] = useState("");
  const [ctx, setCtx] = useState(contexte || null);
  const [demandes, setDemandes] = useState({});       // demande_id → envoi | confirmee | annulee | expiree
  const [voirDonnees, setVoirDonnees] = useState(false);

  const monte = useRef(true);
  const suivi = useRef(null);          // AbortController de l'attente en cours
  const enVol = useRef(new Set());     // décisions en cours d'envoi (double clic)
  const racine = useRef(null), fil = useRef(null), zone = useRef(null), retour = useRef(null), dernier = useRef(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const [historique] = useState(() => mobile);   // entrée d'historique posée à l'ouverture (mobile), décidée une fois
  const vv = useEcranVisible(mobile);

  const occupe = envoi || !!attente || phase !== "pret";
  const infos = conv?.infos || null;
  const etatDemande = useMemo(() => {
    const f = demandesFermees(messages);
    return (id) => demandes[id] || f[id] || null;
  }, [messages, demandes]);

  // nouvelle question depuis « Mes commandes » pendant que le panneau est ouvert
  useEffect(() => { if (contexte) setCtx(contexte); }, [contexte]);

  // ── erreurs : identité (vue dédiée) ou avis au-dessus de la saisie ; téléphone ajouté seulement s'il n'y est pas déjà
  // (plusieurs messages du serveur le donnent) ──
  const urgence = (texte) => (infos?.telephone && !String(texte).includes(infos.telephone)
    ? ` Pour une demande urgente : ${infos.telephone}${infos.horaires ? ` (${infos.horaires})` : ""}.` : "");
  const echec = (e, ouverture = false) => {
    if (!monte.current) return;
    if (e?.code === "reconnexion") { suivi.current?.abort(); setAttente(null); setPhase("reconnexion"); return; }
    if (e?.code === "fiche") { setPhase("fiche"); return; }
    if (ouverture) { setPhase("erreur"); setAvis({ ton: "danger", texte: e?.message || "L'assistant n'a pas pu s'ouvrir." }); return; }
    const texteErreur = e?.message || "Une erreur est survenue.";
    setAvis({ ton: "warn", texte: `${texteErreur}${["quota", "indisponible"].includes(e?.code) ? urgence(texteErreur) : ""}` });
  };

  const ajoute = (m) => { if (m && m.id) setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m])); };

  const applique = (r) => {
    setConv({ id: r.conversation_id, pharmacie: r.pharmacie || null, mode: r.mode || "complet", infos: r.infos || null, apercu: !!r.apercu });
    setMessages(Array.isArray(r.messages) ? r.messages : []);
    setDemandes({});
    setPhase("pret");
    ecritMemoire(identite, { conversation_id: r.conversation_id });
    if (r.infos) onInfos?.(r.infos);
  };

  // ── attente de la réponse d'un tour (long-poll), arrêtée à la fermeture du panneau ──
  const suivreTour = async (tourId, convId) => {
    suivi.current?.abort();
    const ac = new AbortController();
    suivi.current = ac;
    setAvis(null);
    setAttente({ tourId, etape: null });
    ecritMemoire(identite, { conversation_id: convId, tour_id: tourId });
    try {
      const r = await attendreReponse({ auth, tourId, conversationId: convId, signal: ac.signal,
        surEtape: (etape) => { if (monte.current) setAttente((a) => (a && a.tourId === tourId ? { ...a, etape } : a)); } });
      if (ac.signal.aborted || !r || !monte.current) return;
      setAttente(null);
      ecritMemoire(identite, { conversation_id: convId });
      if (r.message) ajoute(r.message);
      if (r.erreur && !r.message) setAvis({ ton: "warn", texte: "L'assistant n'a pas pu répondre. Reformulez votre question ou demandez à parler à un conseiller." });
    } catch (e) {
      if (ac.signal.aborted || !monte.current) return;
      setAttente(null);
      if (e.code === "delai" || e.code === "reseau") setAvis({ ton: "warn", texte: e.message, reprendre: { tourId, convId } });
      else { ecritMemoire(identite, { conversation_id: convId }); echec(e); }
    }
  };

  // ── ouverture : reprend la conversation de l'onglet (et la réponse attendue), sinon celle que le serveur garde ──
  const demarre = async (signal) => {
    setPhase("ouverture"); setAvis(null);
    const memoire = litMemoire(identite);
    try {
      const r = await ouvrir(auth, memoire.conversation_id, signal);
      if (signal?.aborted || !monte.current) return;
      applique(r);
      // réponse en préparation : celle que le serveur signale (autre onglet, page rechargée), sinon celle de l'onglet
      const tour = r.tour_en_cours || (memoire.tour_id && memoire.conversation_id === r.conversation_id ? memoire.tour_id : null);
      if (tour) suivreTour(tour, r.conversation_id);
    } catch (e) { if (!signal?.aborted) echec(e, true); }
  };
  useEffect(() => {
    monte.current = true;
    const ac = new AbortController();
    demarre(ac.signal);
    return () => { monte.current = false; ac.abort(); suivi.current?.abort(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- identité fixe : App remonte le panneau (key) si elle change

  // ── resynchronisation sur le serveur (réponse abandonnée, 409, envoi dont la réponse s'est perdue, conversation fermée
  // ailleurs) : affichage relu, réponse en cours suivie. sansId : la conversation ouverte (ou une nouvelle) plutôt que
  // celle-ci. → true si le message `texteEnvoye` a bien été enregistré (un message de la pharmacie de plus qu'avant,
  // le dernier étant ce texte), sinon false ──
  const resynchroniser = async (texteEnvoye = null, sansId = false) => {
    const avant = messages.filter((m) => m.role === "pharmacie" && !String(m.id).startsWith("local-")).length;
    let r;
    try { r = await ouvrir(auth, sansId ? null : conv?.id); } catch (e) { echec(e); return false; }
    if (!monte.current) return false;
    applique(r);
    if (r.tour_en_cours) suivreTour(r.tour_en_cours, r.conversation_id);
    const siennes = (r.messages || []).filter((m) => m.role === "pharmacie");
    return !!texteEnvoye && r.conversation_id === conv?.id && siennes.length > avant && siennes.at(-1)?.texte === texteEnvoye;
  };

  // ── envoi d'un message ──
  const envoyerTexte = async (brut) => {
    const t = String(brut ?? "").trim();
    if (!t || occupe || !conv) return;
    if (t.length > LONGUEUR_MAX) { setAvis({ ton: "warn", texte: `Votre message dépasse ${LONGUEUR_MAX.toLocaleString("fr-FR")} caractères : raccourcissez-le.` }); return; }
    // réponse précédente abandonnée (coupure) : elle a pu arriver entre-temps ; on relit d'abord, le texte reste à envoyer
    if (avis?.reprendre) {
      setAvis(null); setTexte(t); setEnvoi(true);
      await resynchroniser();
      if (!monte.current) return;
      setEnvoi(false);
      setAvis({ ton: "info", texte: "La conversation a été mise à jour ci-dessus. Votre message n'est pas encore parti : renvoyez-le." });
      return;
    }
    setAvis(null);
    const local = { id: `local-${Date.now()}`, role: "pharmacie", texte: t, ui_actions: [], at: new Date().toISOString() };
    setMessages((ms) => [...ms, local]);
    setTexte("");
    setEnvoi(true);
    try {
      const r = await envoyer(auth, conv.id, t, ctx ? { commande_site_id: String(ctx.commande_site_id) } : null);
      if (!monte.current) return;
      setCtx(null);
      if (r.message) ajoute(r.message);                 // aperçus : réponse fictive immédiate
      else if (r.tour_id) suivreTour(r.tour_id, conv.id);
    } catch (e) {
      if (!monte.current) return;
      setMessages((ms) => ms.filter((m) => m.id !== local.id));
      if (e.code === "conversation") {   // fermée ailleurs ou assistant mis à jour : nouvelle conversation, texte gardé
        setTexte((cur) => cur || t);
        await resynchroniser(null, true);
        if (monte.current) setAvis({ ton: "info", texte: e.message });
      } else if (e.code === "tour_en_cours") {
        // réponse en préparation (autre onglet, envoi précédent) : elle est affichée et suivie ; ce message n'est pas parti
        setTexte((cur) => cur || t);
        await resynchroniser();
      } else if (e.code === "reseau" || e.code === "http") {
        // réponse perdue : le serveur a pu enregistrer le message ; l'affichage est relu et la réponse en cours suivie, le
        // texte n'est rendu à la saisie que s'il n'a pas été enregistré
        const enregistre = await resynchroniser(t);
        if (!monte.current) return;
        if (!enregistre) { setTexte((cur) => cur || t); echec(e); }
      } else {
        setTexte((cur) => cur || t);   // message refusé (quota, indisponible) : rendu à la saisie
        echec(e);
      }
    } finally { if (monte.current) setEnvoi(false); }
  };

  const preremplir = (t) => {
    setTexte(t);
    requestAnimationFrame(() => { const z = zone.current; if (z) { z.focus(); z.setSelectionRange(z.value.length, z.value.length); } });
  };

  // ── « Confirmer la demande » / « Annuler » : sans passer par le modèle ; un seul envoi par récapitulatif ──
  const deciderDemande = async (demandeId, decision, options) => {
    if (!conv || !demandeId || enVol.current.has(demandeId)) return;
    enVol.current.add(demandeId);
    setAvis(null);
    setDemandes((d) => ({ ...d, [demandeId]: "envoi" }));
    try {
      const r = await decider(auth, conv.id, demandeId, decision, options);
      if (!monte.current) return;
      setDemandes((d) => ({ ...d, [demandeId]: issue(r.message) }));   // d'après la réponse du serveur, pas du bouton
      if (r.message) ajoute(r.message);
    } catch (e) {
      if (!monte.current) return;
      if (e.code === "expiree") setDemandes((d) => ({ ...d, [demandeId]: "expiree" }));
      else { setDemandes((d) => { const n = { ...d }; delete n[demandeId]; return n; }); echec(e); }
    } finally { enVol.current.delete(demandeId); }
  };

  const recommencer = async () => {
    if (envoi || phase === "ouverture") return;
    suivi.current?.abort();
    setAttente(null); setAvis(null); setPhase("ouverture");
    try { const r = await nouvelle(auth, conv?.id); if (monte.current) applique(r); }
    catch (e) { echec(e, true); }
  };

  const outils = {
    telecharger: (id, nom) => telecharger(auth, id, nom, nomFichier),
    envoyer: envoyerTexte, preremplir, decider: deciderDemande, etatDemande, occupe, saisieElixir: !!auth.admin,
    // aperçu Netlify : aucun fichier n'existe (le banc local, lui, en sert un fictif)
    apercuFichiers: !!conv?.apercu && !import.meta.env.DEV,
  };

  // ── défilement : une nouvelle réponse est montrée depuis son début, un message envoyé en bas du fil ──
  useEffect(() => {
    const f = fil.current;
    if (!f) return;
    const d = messages[messages.length - 1];
    if (d && d.role === "assistant" && dernier.current) f.scrollTop = Math.max(0, dernier.current.offsetTop - 12);
    else f.scrollTop = f.scrollHeight;
  }, [messages.length, phase]);

  // zone de saisie de 1 à 4 lignes (texte saisi ou texte d'aide)
  useLayoutEffect(() => {
    const z = zone.current;
    if (!z) return;
    z.style.height = "auto";
    z.style.height = `${Math.min(z.scrollHeight + 2, 132)}px`;
    // barre de défilement (fine, tokens.css) seulement au-delà de 4 lignes : sinon Chrome la montre à vide
    z.style.overflowY = z.scrollHeight + 2 > 132 ? "auto" : "hidden";
  }, [texte, ctx]);   // ctx : le texte d'aide change (« Votre question sur cette commande… », plus long)

  // ── focus : à l'ouverture (saisie sur ordinateur, « Retour » sur mobile), rendu à la fermeture ──
  useEffect(() => {
    const avant = document.activeElement;
    (mobile ? retour.current : zone.current)?.focus?.({ preventScroll: true });
    return () => {
      const cible = visible(avant) ? avant : document.querySelector("[data-assistant-ouvrir]");
      cible?.focus?.({ preventScroll: true });
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- une fois, à l'ouverture

  // ── mobile : page figée derrière la feuille ; Retour du navigateur = fermer (entrée posée à l'ouverture) ──
  useEffect(() => {
    if (!mobile) return;
    const html = document.documentElement, avant = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = avant; };
  }, [mobile]);
  useEffect(() => {
    if (!historique) return;
    let parRetour = false;
    try { window.history.pushState({ ...(window.history.state || {}), exAssistant: true }, ""); } catch { /* historique indisponible */ }
    const onPop = () => { if (!window.history.state?.exAssistant) { parRetour = true; onCloseRef.current(); } };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!parRetour && window.history.state?.exAssistant) { try { window.history.back(); } catch { /* rien */ } }
    };
  }, [historique]);

  // Échap ferme ; sur mobile (fenêtre modale), Tab reste dans la feuille
  const auClavier = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !mobile) return;
    const els = [...(racine.current?.querySelectorAll(FOCUSABLES) || [])].filter(visible);
    if (!els.length) return;
    const premier = els[0], fin = els[els.length - 1];
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); fin.focus(); }
    else if (!e.shiftKey && document.activeElement === fin) { e.preventDefault(); premier.focus(); }
  };
  const auClavierSaisie = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); envoyerTexte(texte); }
  };

  const nomPharmacie = conv?.pharmacie?.nom || acting?.name || pharmacyName || "";
  const conseillerSeul = conv?.mode === "conseiller_seul";
  const dernierAssistant = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return messages[i].id; return null; })();

  const Conteneur = mobile ? "div" : "aside";
  const attributs = mobile
    ? { role: "dialog", "aria-modal": "true", "aria-labelledby": "assistant-titre" }
    : { "aria-label": "Assistant Elixir" };
  const styleMobile = mobile && vv ? { top: vv.haut, height: vv.hauteur } : undefined;

  const boutonNouvelle = (
    <button type="button" className="ex-assistant__rond" onClick={recommencer} disabled={envoi || phase === "ouverture" || phase === "reconnexion" || phase === "fiche"}
      aria-label="Nouvelle conversation" title="Nouvelle conversation"><Icone nom="actualiser" taille={20} /></button>
  );

  return (
    <Conteneur ref={racine} className="ex-assistant" data-clavier={vv?.clavier ? "" : undefined} style={styleMobile} onKeyDown={auClavier} {...attributs}>
      <style>{CSS}</style>

      {/* En-tête pétrole : croix or clair, titre, nouvelle conversation, fermer (mobile : « Retour » à gauche) */}
      <div className="ex-assistant__entete ex-on-dark">
        {mobile && <button type="button" ref={retour} className="ex-assistant__rond" onClick={onClose} aria-label="Retour : fermer l'assistant" title="Retour"><Icone nom="retour" taille={22} /></button>}
        <CroixElixir taille={mobile ? 22 : 26} style={{ color: T.orClair }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="assistant-titre" style={{ margin: 0, fontSize: 16, fontWeight: 640, letterSpacing: "-0.01em", lineHeight: 1.25, color: T.paper }}>Assistant Elixir</h2>
          <div style={{ fontSize: 12, color: T.paperMute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Factures · relevés · commandes · retours</div>
        </div>
        {boutonNouvelle}
        {!mobile && <button type="button" className="ex-assistant__rond" onClick={onClose} aria-label="Fermer l'assistant" title="Fermer"><Icone nom="fermer" taille={20} /></button>}
      </div>

      {acting && (
        <div className="ex-selectionnable" style={{ ...ui.encart("acting"), borderRadius: 0, borderWidth: "0 0 1px", display: "flex", alignItems: "flex-start", gap: 8, flexShrink: 0 }}>
          <Icone nom="crayon" taille={16} style={{ marginTop: 2 }} />
          <span>Vous agissez pour <b>{acting.name}</b> (saisie Elixir).</span>
        </div>
      )}
      {conv?.apercu && (
        <div role="note" style={{ ...ui.encart("warn"), borderRadius: 0, borderWidth: "0 0 1px", fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <Icone nom="alerte" taille={16} />Aperçu : réponses fictives
        </div>
      )}

      {/* Fil de la conversation : copiable malgré l'anti-copie (n° de facture, de commande) */}
      <div ref={fil} className="ex-assistant__fil ex-selectionnable" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation avec l'assistant">
        {phase === "ouverture" && <Chargement texte="Ouverture de la conversation…" />}

        {phase === "reconnexion" && (
          <div style={{ padding: "8px 0" }}>
            <div role="alert" style={{ ...ui.encart("warn"), display: "flex", alignItems: "flex-start", gap: 8 }}>
              <Icone nom="cadenas" taille={16} style={{ marginTop: 2 }} />
              <span>{auth.admin ? "Votre session d'administration a expiré : reconnectez-vous depuis l'admin pour continuer." : TEXTE_RECONNEXION}</span>
            </div>
            {!auth.admin && (
              <div className="ex-assistant__actions">
                <button type="button" className="ex-btn-petrole ex-assistant__btn ex-assistant__btn--fort" onClick={onReconnecter}>
                  <Icone nom="cadenas" taille={18} />Me reconnecter
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "fiche" && (
          <div role="alert" style={{ ...ui.encart("warn"), display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Icone nom="alerte" taille={16} style={{ marginTop: 2 }} />
            <span>Votre compte n'est relié à aucune fiche client Elixir : l'assistant n'est pas disponible pour ce compte. Votre interlocuteur Elixir peut faire le lien.</span>
          </div>
        )}

        {phase === "erreur" && (
          <div style={{ padding: "8px 0" }}>
            <div role="alert" style={{ ...ui.encart("danger"), display: "flex", alignItems: "flex-start", gap: 8 }}>
              <Icone nom="alerte" taille={16} style={{ marginTop: 2 }} /><span>{avis?.texte || "L'assistant n'a pas pu s'ouvrir."}</span>
            </div>
            <div className="ex-assistant__actions">
              <button type="button" className="ex-btn-petrole ex-assistant__btn" onClick={() => demarre()}><Icone nom="actualiser" taille={16} />Réessayer</button>
            </div>
          </div>
        )}

        {phase === "pret" && messages.length === 0 && (
          <div style={{ paddingBottom: 8 }}>
            <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: T.ink }}>
              Bonjour{nomPharmacie ? `, ${nomPharmacie}` : ""}. {conseillerSeul ? "Je peux transmettre votre demande à l'équipe Elixir." : "Je peux vous aider pour :"}
            </p>
            <div className="ex-assistant__pastilles">
              {!conseillerSeul && PASTILLES.map(([lib, phrase]) => (
                <button key={lib} type="button" className="ex-filtre" style={pastille} disabled={occupe} onClick={() => envoyerTexte(phrase)}>{lib}</button>
              ))}
              <button type="button" className="ex-btn-ligne" style={pastilleLigne} disabled={occupe} onClick={() => envoyerTexte(CONSEILLER[1])}>
                <Icone nom="bulle" taille={15} />{CONSEILLER[0]}
              </button>
            </div>
            <div style={{ ...ui.encart("neutral"), fontSize: 12, marginTop: 16 }}>
              Assistant automatique. Il consulte vos factures et commandes Elixir ; il ne voit pas vos règlements. Aucune demande n'est envoyée sans votre confirmation.{" "}
              <button type="button" className="ex-assistant__lien" onClick={() => setVoirDonnees((v) => !v)} aria-expanded={voirDonnees}
                style={{ background: "none", border: "none", padding: "4px 0", font: "inherit", fontWeight: 600, color: T.teal, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
                Vos données
              </button>
              {voirDonnees && (
                <div style={{ marginTop: 6 }}>
                  Vos échanges avec l'assistant sont enregistrés pour le suivi de vos demandes et peuvent être consultés par l'équipe Elixir.
                  Les réponses sont rédigées par un service d'intelligence artificielle (Anthropic, sous-traitant d'Elixir Pharma) à partir
                  de vos documents Elixir ; vos règlements ne sont jamais consultés.
                  {Number(infos?.conservation_jours) > 0 ? ` Les conversations sont conservées ${infos.conservation_jours} jours.` : ""}
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "pret" && messages.map((m) => {
          const pharmacie = m.role === "pharmacie";
          const actions = !pharmacie && Array.isArray(m.ui_actions) ? m.ui_actions : [];
          return (
            <div key={m.id} ref={m.id === dernierAssistant ? dernier : undefined} className={`ex-assistant__msg ex-assistant__msg--${pharmacie ? "pharmacie" : "assistant"}`}>
              <span style={masque}>{pharmacie ? "Vous :" : "Assistant :"}</span>
              {String(m.texte || "").trim() && <div className="ex-assistant__bulle"><TexteSur texte={m.texte} /></div>}
              {actions.map((a, i) => <Carte key={i} action={a} outils={outils} />)}
              {m.at && <span className="ex-assistant__heure num">{heureFr(m.at)}</span>}
            </div>
          );
        })}
      </div>

      {/* Ligne d'état : texte du serveur (outil en cours), jamais du modèle ; zone annoncée toujours présente (une zone
          insérée déjà remplie n'est pas lue par les lecteurs d'écran), masquée quand elle est vide */}
      <div role="status" aria-live="polite" style={attente ? { flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", fontSize: 13,
        color: T.inkSoft, borderTop: `1px solid ${T.lineSoft}`, background: T.paper } : masque}>
        {attente && <Icone nom="horloge" taille={16} style={{ color: T.teal }} />}{attente ? attente.etape || "Je prépare la réponse…" : ""}
      </div>
      {avis && phase !== "erreur" && (
        <div role="alert" style={{ ...ui.encart(avis.ton), borderRadius: 0, borderWidth: "1px 0 0", display: "flex", alignItems: "flex-start", gap: 8, flexShrink: 0 }}>
          <Icone nom="alerte" taille={16} style={{ marginTop: 2 }} />
          <span style={{ flex: 1, minWidth: 0 }}>{avis.texte}</span>
          {avis.reprendre && (
            <button type="button" className="ex-btn-ligne ex-assistant__btn" style={{ minHeight: 32, padding: "0 12px", flexShrink: 0 }}
              onClick={() => suivreTour(avis.reprendre.tourId, avis.reprendre.convId)}>Réessayer</button>
          )}
          {!avis.reprendre && (
            <button type="button" className="ex-btn-discret" onClick={() => setAvis(null)} aria-label="Masquer ce message" title="Masquer"
              style={{ ...ui.rond(28), flexShrink: 0 }}><Icone nom="fermer" taille={14} /></button>
          )}
        </div>
      )}

      {/* Saisie : Entrée envoie, Maj+Entrée va à la ligne ; en lecture seule pendant une réponse */}
      {phase !== "reconnexion" && phase !== "fiche" && (
        <form className="ex-assistant__saisie" onSubmit={(e) => { e.preventDefault(); envoyerTexte(texte); }}>
          {ctx && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span className="num" style={{ ...ui.badge("info"), fontSize: 12, padding: "4px 6px 4px 10px", gap: 6, maxWidth: "100%", overflow: "hidden" }}>
                <Icone nom="commandes" taille={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ctx.libelle || libelleCommande(ctx.date)}</span>
                <button type="button" onClick={() => setCtx(null)} aria-label="Retirer la commande de la question" title="Retirer"
                  style={{ ...ui.rond(22), background: "transparent", color: "inherit" }}><Icone nom="fermer" taille={12} epaisseur={2.6} /></button>
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <label htmlFor="assistant-saisie" style={masque}>Votre question à l'assistant</label>
            <textarea id="assistant-saisie" ref={zone} className="ex-assistant__zone" rows={1} value={texte} maxLength={LONGUEUR_MAX}
              placeholder={ctx ? "Votre question sur cette commande…" : "Écrivez votre question…"} readOnly={occupe} aria-disabled={occupe || undefined}
              onChange={(e) => setTexte(e.target.value)} onKeyDown={auClavierSaisie} />
            <button type="submit" className="ex-btn-petrole ex-assistant__envoyer" disabled={occupe || !texte.trim()} aria-label="Envoyer" title="Envoyer">
              <Icone nom="envoyer" taille={18} />
            </button>
          </div>
          {texte.length >= SEUIL_COMPTEUR && (
            <div className="num" aria-live="polite" style={{ fontSize: 11, color: texte.length >= LONGUEUR_MAX ? T.danger : T.inkMute, textAlign: "right", marginTop: 4 }}>
              {texte.length.toLocaleString("fr-FR")} / {LONGUEUR_MAX.toLocaleString("fr-FR")} caractères
            </div>
          )}
        </form>
      )}
    </Conteneur>
  );
}

// ── Garde d'erreur (dans ce morceau, hors du bundle des pharmacies) : une erreur du panneau ne fait pas tomber le site
// de commande ; le cadre de secours est en style inline (les règles CSS du panneau sont posées par la partie tombée) ──
class Garde extends React.Component {
  constructor(props) { super(props); this.state = { erreur: false }; }
  static getDerivedStateFromError() { return { erreur: true }; }
  componentDidCatch(e, info) { console.error("[Assistant Elixir]", e, info?.componentStack || ""); }
  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <aside aria-label="Assistant Elixir" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 301, width: "min(420px, 100%)",
        background: T.paper, borderLeft: `1px solid ${T.line}`, boxShadow: T.shadow3, display: "flex", flexDirection: "column" }}>
        <div className="ex-on-dark" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 56, padding: "6px 8px 6px 18px", background: T.petrol, color: T.paper }}>
          <span style={{ fontSize: 16, fontWeight: 640 }}>Assistant Elixir</span>
          <button type="button" className="ex-icone-entete ex-cible" onClick={this.props.onClose} aria-label="Fermer l'assistant"
            style={{ ...ui.rond(36), color: T.paper }}><Icone nom="fermer" /></button>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <EtatVide erreur compact icone="alerte" titre="Assistant indisponible"
            texte="Une erreur s'est produite dans l'assistant : fermez-le, ou rechargez la page."
            actions={<button type="button" className="ex-btn-petrole" onClick={() => window.location.reload()}
              style={{ ...ui.btn("primaire", "m"), background: undefined, color: undefined }}>Recharger la page</button>} />
        </div>
      </aside>
    );
  }
}

export default function AssistantPanel(props) {
  return <Garde onClose={props.onClose}><Conversation {...props} /></Garde>;
}
