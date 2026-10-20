// ── Notifications de l'appli Elixir : carte de l'accueil, panneau « Notifications », guide iPhone (docs/notifications.md) ──
// Chargé à la demande (entree.jsx) : rien de ce fichier n'est dans le bundle des pharmacies.
// La demande d'autorisation n'apparaît que sur un clic (« Activer les notifications »). Saisie « Commander pour une
// pharmacie » : lecture seule (appareils de la pharmacie servie), jamais d'abonnement de l'appareil d'Elixir.
// Textes : vouvoiement, français ; jamais de promesse que l'e-mail ne tient plus (« les informations importantes
// continuent d'arriver par e-mail »).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T, R, ui, tone } from "../theme.js";
import { Icone } from "../icons.jsx";
import FocusFenetre from "../components/ui/FocusFenetre.jsx";
import { Chargement } from "../components/ui/EtatVide.jsx";
import * as C from "./client.js";
import { analyser, parcours as parcoursDe, versionIosTexte, libelleAppareil } from "./plateforme.js";
import { categoriesAffichees, PLAFOND_DEFAUT } from "./regles.js";
import { masquer } from "./memo.js";

const dateLongue = (s) => (s ? new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
const lienActivation = () => `${C.navigateur().origine()}/?notifications=1`;
const MESSAGES = {
  reconnexion: "Votre session a expiré : reconnectez-vous avec le code reçu par e-mail pour gérer vos notifications.",
  indisponible: "Service momentanément indisponible : réessayez dans un instant.",
  echec: "L'activation n'a pas abouti sur cet appareil. Réessayez ; si cela persiste, vérifiez que les notifications sont autorisées pour ce site.",
  brave: "Brave bloque les notifications des sites : Réglages → Confidentialité et sécurité → activez « Utiliser les services Google pour la messagerie push », puis réessayez.",
  sans_reponse: "Vous n'avez pas encore répondu : touchez à nouveau « Activer les notifications » puis « Autoriser ». Si rien ne s'affiche, touchez la cloche barrée dans la barre d'adresse.",
  trop_d_appareils: "10 appareils reçoivent déjà les notifications de votre pharmacie : retirez-en un ci-dessous, puis réessayez.",
  fermee: "Les notifications ne sont pas encore ouvertes à votre pharmacie.",
  hors_pilote: "Les notifications ne sont pas encore ouvertes à votre pharmacie.",
  admin: "Connexion Elixir : les notifications s'activent depuis l'admin (🔔 Notifications).",
  fiche: "Aucune pharmacie n'est rattachée à ce compte : contactez Elixir Pharma au 01 86 04 39 95.",
  expire: "Cet appareil n'est plus joignable : touchez « Réactiver ».",
  quota: "Trois notifications de test en 10 minutes au plus : réessayez un peu plus tard.",
  erreur: "Une erreur est survenue : réessayez dans un instant.",
};
const TEST_ENVOYE = "Notification envoyée : elle arrive en général en quelques secondes. Rien reçu ? Vérifiez que le mode Ne pas déranger ou Concentration est coupé.";
const messageDe = (r) => (r.etat === "echec" && r.brave ? MESSAGES.brave : MESSAGES[r.etat] || MESSAGES.erreur);
const PIED = "Les informations importantes (confirmations de commande, factures) continuent d'arriver par e-mail.";

// ── Petits éléments ──
const btnPrincipal = { ...ui.btn("primaire", "m"), background: undefined, color: undefined, height: 44, padding: "0 20px", fontSize: 14 };
const btnLigne = { ...ui.btn("ligne", "m"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, height: 44, padding: "0 18px", fontSize: 14 };
function Bouton({ principal = false, icone, children, style, ...reste }) {
  return (
    <button type="button" className={principal ? "ex-btn-petrole" : "ex-btn-ligne"} style={{ ...(principal ? btnPrincipal : btnLigne), ...style }} {...reste}>
      {icone && <Icone nom={icone} taille={17} />}{children}
    </button>
  );
}
function Message({ ton = "info", children, role }) {
  return <div role={role || (ton === "danger" ? "alert" : "status")} style={{ ...ui.encart(ton), marginTop: 12 }}>{children}</div>;
}
const Pastille = ({ taille = 40 }) => (
  <span aria-hidden="true" style={{ width: taille, height: taille, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    background: T.mint, color: T.teal }}><Icone nom="cloche" taille={Math.round(taille / 2)} /></span>
);
// Interrupteur accessible (role="switch") : appliqué aussitôt, retour arrière si le serveur refuse
export function Interrupteur({ actif, onChange, libelle, aide, desactive = false, id }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderTop: `1px solid ${T.lineSoft}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div id={`${id}-l`} style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{libelle}</div>
        {aide && <div id={`${id}-a`} style={{ fontSize: 12.5, lineHeight: 1.45, color: T.inkSoft, marginTop: 2 }}>{aide}</div>}
      </div>
      <button type="button" role="switch" aria-checked={actif} aria-labelledby={`${id}-l`} aria-describedby={aide ? `${id}-a` : undefined} disabled={desactive}
        onClick={() => onChange(!actif)} className="ex-cible" style={{ position: "relative", width: 46, height: 28, flexShrink: 0, border: "none", borderRadius: R.pill,
          padding: 0, cursor: desactive ? "default" : "pointer", background: actif ? T.teal : T.lineField, opacity: desactive ? 0.6 : 1,
          transition: "background-color .15s var(--ease)" }}>
        <span aria-hidden="true" style={{ position: "absolute", top: 3, left: actif ? 21 : 3, width: 22, height: 22, borderRadius: R.pill, background: "#fff",
          boxShadow: "0 1px 3px rgba(10,29,34,.3)", transition: "left .15s var(--ease)" }} />
      </button>
    </div>
  );
}

// Pictogrammes iOS (guide « Sur l'écran d'accueil ») : dessin local, au trait
const PictoPartager = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ display: "inline-block", verticalAlign: "-3px", color: "#0a84ff" }}><path d="M8 9.5H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 20.5h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" /><path d="M12 14V3.5M8.5 7 12 3.5 15.5 7" /></svg>
);
const PictoAjouter = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"
    style={{ display: "inline-block", verticalAlign: "-3px" }}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></svg>
);
const IconeElixir = () => <img src="/icones/elixir-192.png" alt="" width="20" height="20" style={{ display: "inline-block", verticalAlign: "-4px", borderRadius: 5 }} />;

export function GuideIphone({ appareil = "iPhone" }) {
  const etapes = [
    <>Touchez <strong>Partager</strong> <PictoPartager /> (le carré avec une flèche vers le haut), en bas de l'écran — sur iOS 26, dans le menu « ••• ». Dans Chrome, il est en haut, dans la barre d'adresse.</>,
    <>Choisissez <strong>Sur l'écran d'accueil</strong> <PictoAjouter /> (faites défiler si besoin).</>,
    <>Laissez <strong>Ouvrir comme app web</strong> activé, puis touchez <strong>Ajouter</strong>.</>,
    <>Ouvrez l'icône <strong>Elixir</strong> <IconeElixir /> de votre écran d'accueil et <strong>reconnectez-vous</strong> avec le code reçu par e-mail (une seule fois : l'application a sa propre session).</>,
    <>Ouvrez <strong>Notifications</strong> dans le menu ☰ et touchez <strong>Activer les notifications</strong>, puis <strong>Autoriser</strong>.</>,
  ];
  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: T.ink }}>
        Sur {appareil}, les alertes arrivent par l'<strong>application Elixir</strong> : ajoutez-la à votre écran d'accueil, c'est gratuit et cela prend 30 secondes.
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {etapes.map((e, i) => (
          <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14, lineHeight: 1.5, color: T.ink }}>
            <span aria-hidden="true" className="num" style={{ width: 26, height: 26, flexShrink: 0, borderRadius: R.pill, background: T.petrol, color: T.paper,
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ minWidth: 0 }}><span className="ex-lecteur" style={srOnly}>Étape {i + 1} : </span>{e}</span>
          </li>
        ))}
      </ol>
      <p style={{ margin: "14px 0 0", fontSize: 12.5, color: T.inkSoft }}>Votre {appareil} doit avoir <strong>iOS 16.4 ou plus récent</strong> (Réglages → Général → Informations).</p>
    </div>
  );
}
const srOnly = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 };

function CopierLien({ libelle = "Copier le lien" }) {
  const [copie, setCopie] = useState(false);
  const lien = lienActivation();
  const copier = () => {
    navigator.clipboard?.writeText(lien).then(() => { setCopie(true); setTimeout(() => setCopie(false), 2000); }).catch(() => window.prompt("Lien à ouvrir dans Safari :", lien));
  };
  return <Bouton icone={copie ? "coche" : "copier"} onClick={copier}>{copie ? "Lien copié" : libelle}</Bouton>;
}

// ── Carte de l'accueil « Recevez nos alertes sur votre téléphone » ──
// etat : réponse de demarrage.js ({ parcours, statut }) ; onOuvrir : ouvre le panneau ; onEtat : met à jour l'état d'App
// mobile (< 768 px) : pastille dans la ligne du titre, texte et boutons sur toute la largeur
export function CarteNotifications({ appel, identite, etat, mobile = false, onOuvrir, onEtat }) {
  const api = useMemo(() => C.apiPharmacie(appel), [appel]);
  const env = C.navigateur().env();
  const a = analyser(env);
  const p = etat?.parcours || "activer";
  const plafond = etat?.statut?.plafond_offres_7j ?? PLAFOND_DEFAUT;
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);   // { ton, texte }
  const [active, setActive] = useState(false);
  const [test, setTest] = useState(null);
  // préparation (service worker, clé publique) dès l'affichage : le clic n'attend plus le réseau avant la demande
  useEffect(() => { if (p === "activer") C.preparer().catch(() => {}); }, [p]);
  // boutons : en ligne sur ordinateur, l'un sous l'autre et sur toute la largeur sur mobile
  const ligneBoutons = mobile ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 14 } : { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 };
  const surCet = a.ios ? (a.ipad ? "cet iPad" : "cet iPhone") : a.mobile ? "ce téléphone" : "cet ordinateur";
  const plusTard = () => { masquer(identite); onEtat?.((e) => (e ? { ...e, carte: false } : e)); };
  const activer = async () => {
    setOccupe(true); setMessage(null);
    const r = await C.activer({ api });
    setOccupe(false);
    if (r.etat === "abonne") { setActive(true); onEtat?.((e) => (e ? { ...e, parcours: "abonne" } : e)); return; }
    if (["autre_identite", "trop_d_appareils", "refuse"].includes(r.etat)) { onOuvrir(); return; }
    setMessage({ ton: r.etat === "sans_reponse" ? "warn" : "danger", texte: messageDe(r) });
  };
  const essayer = async () => {
    setTest({ occupe: true });
    const r = await C.envoyerTest({ api });
    setTest({ ton: r.etat === "ok" ? "ok" : "danger", texte: r.etat === "ok" ? (r.apercu ? "Aperçu : aucune notification n'est envoyée." : TEST_ENVOYE) : messageDe(r) });
  };
  const titre = a.ios ? `Recevez nos alertes sur votre ${a.ipad ? "iPad" : "iPhone"}` : "Recevez nos alertes sur votre téléphone";
  const texte = p === "installer_ios" ? `Sur ${a.ipad ? "iPad" : "iPhone"}, les alertes arrivent par l'application Elixir : ajoutez-la à votre écran d'accueil, c'est gratuit et cela prend 30 secondes.`
    : p === "ouvrir_safari" ? "Cette page est ouverte dans une autre application. Ouvrez-la dans Safari pour installer l'application Elixir."
    : a.mobile ? "Un produit que vous attendez revient en stock, une offre à ne pas manquer : vous êtes prévenu tout de suite, même site fermé."
    : "Sur votre téléphone, ouvrez elixir-commande.expepharma.com et touchez « Activer les notifications ». Vous pouvez aussi les recevoir sur cet ordinateur.";
  return (
    <section className="acc-section" aria-labelledby="acc-notif-titre">
      <div className="ex-carte" style={{ background: T.surface, borderRadius: R.m, borderLeft: `3px solid ${T.teal}`, padding: mobile ? "14px 14px 16px" : "16px 18px",
        display: "flex", gap: 14, alignItems: "flex-start" }}>
        {!mobile && <Pastille />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="acc-notif-titre" style={{ margin: 0, fontSize: 16, fontWeight: 640, letterSpacing: "-0.01em", lineHeight: 1.3, color: T.ink, display: "flex", alignItems: "center", gap: 10 }}>
            {mobile && <Pastille taille={34} />}<span>{active ? `Notifications activées sur ${surCet}` : titre}</span>
          </h2>
          {active ? (
            <>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: T.inkSoft, display: "flex", gap: 6, alignItems: "center" }}>
                <Icone nom="coche" taille={16} style={{ color: T.ok }} />Vous recevrez nos alertes, même site fermé.
              </p>
              <div style={ligneBoutons}>
                <Bouton principal icone="envoyer" onClick={essayer} disabled={test?.occupe}>{test?.occupe ? "Envoi…" : "Envoyer une notification de test"}</Bouton>
                <Bouton onClick={onOuvrir}>Choisir mes alertes</Bouton>
              </div>
              {test?.texte && <Message ton={test.ton}>{test.texte}</Message>}
            </>
          ) : (
            <>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: T.inkSoft }}>{texte}</p>
              <div style={ligneBoutons}>
                {p === "activer" && <Bouton principal icone="cloche" onClick={activer} disabled={occupe}>{occupe ? "Activation…" : a.mobile ? "Activer les notifications" : "Activer sur cet ordinateur"}</Bouton>}
                {p === "installer_ios" && <Bouton principal onClick={onOuvrir}>Voir comment faire</Bouton>}
                {p === "ouvrir_safari" && <CopierLien />}
                <Bouton onClick={plusTard}>Plus tard</Bouton>
              </div>
              {message && <Message ton={message.ton}>{message.texte}</Message>}
              <p style={{ margin: "10px 0 0", fontSize: 12, color: T.inkMute }}>
                Vous choisissez ce que vous recevez.{plafond > 0 ? ` Offres : ${plafond} par semaine au plus.` : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Panneau « Notifications » (fenêtre comme « Mes commandes ») ──
export function PanneauNotifications({ appel, acting = null, pharmacyName, mobile, onClose, onReconnecter = null, onEtat }) {
  const api = useMemo(() => C.apiPharmacie(appel), [appel]);
  const env = C.navigateur().env();
  const a = analyser(env);
  const [vue, setVue] = useState({ chargement: true });
  const [message, setMessage] = useState(null);   // { ton, texte } sous la zone d'action
  const [occupe, setOccupe] = useState(false);
  const [deDe, setDe] = useState(null);           // « de » d'un 409 autre_identite (Elixir (admin), une autre pharmacie)
  const vivant = useRef(true);
  useEffect(() => () => { vivant.current = false; }, []);

  const charger = useCallback(async () => {
    setVue((v) => ({ ...v, chargement: true }));
    if (acting) {
      if (!acting.cip) { setVue({ acting: true, sansCip: true }); return; }
      try {
        const r = await appel(C.API_ADMIN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pharmacie", cip: acting.cip }) });
        const j = await r.json().catch(() => ({}));
        if (vivant.current) setVue(r.ok ? { acting: true, appareils: j.appareils || [], raison: j.raison || null } : { acting: true, erreur: r.status === 401 || r.status === 403 ? "admin" : "indisponible" });
      } catch { if (vivant.current) setVue({ acting: true, erreur: "indisponible" }); }
      return;
    }
    try {
      const { sub } = await C.abonnementLocal();
      const r = await api.appeler("statut", sub ? { endpoint: sub.endpoint } : {});
      if (!vivant.current) return;
      if (r.statut === 401) { setVue({ erreur: "reconnexion" }); return; }
      if (r.statut !== 200) { setVue({ erreur: r.statut === 403 ? r.corps.error || "erreur" : "indisponible" }); return; }
      const s = r.corps;
      const p = parcoursDe(C.navigateur().env(), !!s.appareil);
      const aReactiver = p === "activer" && !!sub && C.navigateur().permission() === "granted" && !s.autre_identite;
      setVue({ statut: s, parcours: p, aReactiver, autreIdentite: !s.appareil && !!s.autre_identite });
      if (p === "activer") C.preparer().catch(() => {});
    } catch { if (vivant.current) setVue({ erreur: "indisponible" }); }
  }, [acting, api, appel]);
  useEffect(() => { charger(); }, [charger]);

  const apresActivation = (r) => {
    if (r.etat === "abonne") { setMessage(null); onEtat?.((e) => (e ? { ...e, carte: false, parcours: "abonne" } : e)); charger(); return; }
    if (r.etat === "autre_identite") { setDe(r.de || null); setVue((v) => ({ ...v, autreIdentite: true })); return; }
    if (r.etat === "refuse") { setVue((v) => ({ ...v, parcours: "refuse" })); return; }
    if (r.etat === "reconnexion") { setVue({ erreur: "reconnexion" }); return; }
    setMessage({ ton: r.etat === "sans_reponse" ? "warn" : "danger", texte: messageDe(r) });
  };
  const agir = (fn) => async () => { setOccupe(true); setMessage(null); try { await fn(); } finally { if (vivant.current) setOccupe(false); } };
  const activer = agir(async () => apresActivation(await C.activer({ api })));
  const reactiver = agir(async () => apresActivation(await C.reactiver({ api })));
  const remplacer = agir(async () => { setDe(null); apresActivation(await C.reactiver({ api, remplacer: true })); });
  const essayer = agir(async () => {
    const r = await C.envoyerTest({ api });
    if (r.etat === "expire") await charger();   // abonnement retiré par le serveur : « Réactiver »
    setMessage({ ton: r.etat === "ok" ? "ok" : r.etat === "quota" ? "warn" : "danger",
      texte: r.etat === "ok" ? (r.apercu ? "Aperçu : aucune notification n'est envoyée." : TEST_ENVOYE) : r.etat === "envoi" ? `La notification n'a pas pu partir${r.detail ? ` (${r.detail})` : ""} : réessayez dans un instant.` : messageDe(r) });
  });
  const desactiver = agir(async () => {
    const r = await C.desactiver({ api });
    if (r.etat === "reconnexion") { setVue({ erreur: "reconnexion" }); return; }
    onEtat?.((e) => (e ? { ...e, parcours: "activer" } : e));
    await charger();
    setMessage({ ton: "info", texte: "Notifications désactivées sur cet appareil." });
  });
  const retirer = (id) => agir(async () => { const r = await C.retirerAppareil({ api, id }); if (!r.ok) setMessage({ ton: "danger", texte: MESSAGES.indisponible }); await charger(); })();
  const changer = async (cat, actif) => {
    const avant = vue.statut.appareil.categories;
    const apres = actif ? [...new Set([...avant, cat])] : avant.filter((c) => c !== cat);
    setVue((v) => ({ ...v, statut: { ...v.statut, appareil: { ...v.statut.appareil, categories: apres } } }));
    const r = await C.changerCategories({ api, categories: apres });
    if (!vivant.current) return;
    if (!r.ok) {
      setVue((v) => ({ ...v, statut: { ...v.statut, appareil: { ...v.statut.appareil, categories: avant } } }));
      setMessage({ ton: "danger", texte: MESSAGES[r.etat] || MESSAGES.indisponible });
    }
  };

  const libelle = a.ipad ? "iPad" : "iPhone";   // guide et messages iOS
  const sousTitre = acting ? `Saisie pour ${pharmacyName}` : [pharmacyName, `cet appareil : ${libelleAppareil(env)}`].filter(Boolean).join(" · ");
  const plafond = vue.statut?.plafond_offres_7j ?? PLAFOND_DEFAUT;
  const categories = vue.statut?.categories_disponibles || categoriesAffichees(plafond);
  const pleinEcran = mobile;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="notif-titre" style={{ ...ui.overlay, zIndex: 400, padding: pleinEcran ? 0 : 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.paper, color: T.ink, borderRadius: pleinEcran ? 0 : R.l, width: "100%", maxWidth: pleinEcran ? "none" : 600,
        height: pleinEcran ? "100%" : undefined, maxHeight: pleinEcran ? "none" : "88vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: T.shadow3 }}>
        <FocusFenetre />
        <div style={{ padding: "18px 18px 14px 22px", borderBottom: `1px solid ${T.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="notif-titre" style={ui.titreModal}><Icone nom="cloche" taille={22} style={{ color: T.teal }} />Notifications</h2>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, overflowWrap: "anywhere" }}>{sousTitre}</div>
          </div>
          <button type="button" className="ex-btn-discret ex-cible" data-focus-initial onClick={onClose} aria-label="Fermer" title="Fermer" style={ui.rond(36)}><Icone nom="fermer" taille={18} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 22px", background: T.cream }}>
          {vue.chargement ? <Chargement texte="Lecture de vos notifications…" />
            : vue.acting ? <VueSaisie vue={vue} pharmacyName={pharmacyName} />
            : vue.erreur ? (
              <Carte>
                <Message ton={vue.erreur === "reconnexion" ? "warn" : "danger"}>{MESSAGES[vue.erreur] || MESSAGES.indisponible}</Message>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {vue.erreur === "reconnexion" && onReconnecter && <Bouton principal onClick={() => { onClose(); onReconnecter(); }}>Se reconnecter</Bouton>}
                  {vue.erreur !== "reconnexion" && <Bouton onClick={charger} icone="actualiser">Réessayer</Bouton>}
                </div>
              </Carte>
            ) : !vue.statut?.disponible ? (
              <Carte><Message ton="info">{MESSAGES[vue.statut?.raison] || MESSAGES.fermee}</Message></Carte>
            ) : (
              <>
                {vue.autreIdentite ? (
                  <Carte titre="Cet appareil est déjà utilisé">
                    <p style={texteP}>Cet appareil recevait les notifications {deDe ? `d'${deDe.startsWith("une") ? deDe : `« ${deDe} »`}` : "d'un autre compte"}. Les recevoir désormais pour {pharmacyName || "votre pharmacie"} ?</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      <Bouton principal onClick={remplacer} disabled={occupe}>Oui, pour {pharmacyName || "ma pharmacie"}</Bouton>
                      <Bouton onClick={onClose}>Annuler</Bouton>
                    </div>
                  </Carte>
                ) : vue.parcours === "abonne" ? (
                  <Carte>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600, color: T.ok }}>
                      <Icone nom="coche" taille={18} />Notifications activées sur cet appareil ({vue.statut.appareil.appareil})
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {categories.map((c) => (
                        <Interrupteur key={c.id} id={`notif-cat-${c.id}`} libelle={c.libelle} aide={c.aide} actif={vue.statut.appareil.categories.includes(c.id)}
                          onChange={(v) => changer(c.id, v)} />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      <Bouton principal icone="envoyer" onClick={essayer} disabled={occupe}>Envoyer une notification de test</Bouton>
                    </div>
                  </Carte>
                ) : vue.aReactiver ? (
                  <Carte titre="À réactiver">
                    <p style={texteP}>Les notifications de cet appareil sont à réactiver.</p>
                    <Bouton principal icone="actualiser" onClick={reactiver} disabled={occupe} style={{ marginTop: 12 }}>{occupe ? "Réactivation…" : "Réactiver"}</Bouton>
                  </Carte>
                ) : vue.parcours === "activer" ? (
                  <Carte titre={a.mobile ? "Recevez nos alertes sur ce téléphone" : "Recevez nos alertes sur cet ordinateur"}>
                    <p style={texteP}>Recevez sur cet appareil :</p>
                    <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                      {categories.map((c) => (
                        <li key={c.id} style={{ display: "flex", gap: 8, fontSize: 13.5, lineHeight: 1.45 }}>
                          <Icone nom="coche" taille={16} style={{ color: T.teal, marginTop: 2, flexShrink: 0 }} />
                          <span><strong>{c.libelle}</strong> — {c.aide}</span>
                        </li>
                      ))}
                    </ul>
                    <Bouton principal icone="cloche" onClick={activer} disabled={occupe} style={{ marginTop: 14 }}>{occupe ? "Activation…" : "Activer les notifications"}</Bouton>
                    {!a.mobile && <p style={{ ...texteP, fontSize: 12.5, color: T.inkMute, marginTop: 10 }}>Sur votre téléphone : ouvrez elixir-commande.expepharma.com, connectez-vous, puis « Notifications ».</p>}
                  </Carte>
                ) : vue.parcours === "installer_ios" ? (
                  <Carte titre={`Installer l'application Elixir sur votre ${libelle}`}><GuideIphone appareil={libelle} /></Carte>
                ) : vue.parcours === "ouvrir_safari" ? (
                  <Carte titre="Ouvrez cette page dans Safari">
                    <p style={texteP}>Cette page est ouverte dans une autre application. Touchez « ••• » ou l'icône de partage de l'application, puis « Ouvrir dans Safari ». Vous pouvez aussi copier le lien et le coller dans Safari.</p>
                    <div style={{ marginTop: 12 }}><CopierLien /></div>
                  </Carte>
                ) : vue.parcours === "maj_ios" ? (
                  <Carte titre={`Mettez à jour votre ${libelle || "iPhone"}`}>
                    <p style={texteP}>{versionIosTexte(env) ? `Votre ${libelle || "iPhone"} utilise iOS ${versionIosTexte(env)}. ` : ""}Les notifications demandent iOS 16.4 ou plus récent : Réglages → Général → Mise à jour logicielle. En attendant, nos informations vous parviennent par e-mail.</p>
                  </Carte>
                ) : vue.parcours === "refuse" ? (
                  <Carte titre="Notifications bloquées">
                    <p style={texteP}>Les notifications sont bloquées pour ce site sur cet appareil. Pour les autoriser :</p>
                    <p style={{ ...texteP, marginTop: 8, fontWeight: 600 }}>{a.ios ? "Réglages → Notifications → Elixir → Autoriser les notifications."
                      : a.android ? "Touchez le cadenas à côté de l'adresse → Autorisations → Notifications → Autoriser. Application installée : appui long sur l'icône Elixir → Infos sur l'appli → Notifications."
                      : "Cliquez sur le cadenas (ou l'icône de réglages) à gauche de l'adresse → Notifications → Autoriser, puis rechargez la page."}</p>
                    <Bouton onClick={charger} icone="actualiser" style={{ marginTop: 12 }}>J'ai changé le réglage</Bouton>
                  </Carte>
                ) : (
                  <Carte titre="Navigateur non compatible">
                    <p style={texteP}>Ce navigateur ne permet pas les notifications. Sur Android, utilisez Chrome ; sur ordinateur, Chrome, Edge, Firefox ou Safari.</p>
                  </Carte>
                )}
                {message && <Message ton={message.ton}>{message.texte}</Message>}
                <Appareils appareils={vue.statut?.appareils || []} onRetirer={retirer} onDesactiver={vue.parcours === "abonne" ? desactiver : null} occupe={occupe} />
              </>
            )}
          {!vue.chargement && !vue.acting && <p style={{ margin: "16px 4px 0", fontSize: 12.5, lineHeight: 1.5, color: T.inkSoft }}>{PIED}</p>}
        </div>
      </div>
    </div>
  );
}
const texteP = { margin: 0, fontSize: 14, lineHeight: 1.5, color: T.ink };

function Carte({ titre, children }) {
  return (
    <section style={{ ...ui.card, padding: "16px 18px", marginBottom: 12 }}>
      {titre && <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 640, color: T.petrol }}>{titre}</h3>}
      {children}
    </section>
  );
}

// pictogrammes au trait (téléphone, ordinateur), comme les icônes de la charte
const PictoAppareil = ({ plateforme }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flexShrink: 0, color: T.teal }}>
    {plateforme === "ordinateur" ? <><rect x="3" y="4.5" width="18" height="12" rx="1.8" /><path d="M8.5 20h7M12 16.5V20" /></>
      : <><rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" /><path d="M10.5 18h3" /></>}
  </svg>
);
function Appareils({ appareils, onRetirer, onDesactiver, occupe, lectureSeule = false }) {
  if (!appareils.length && !onDesactiver) return null;
  return (
    <Carte titre={lectureSeule ? "Appareils de cette pharmacie" : "Vos appareils"}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {appareils.map((d) => (
          <li key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${T.lineSoft}` }}>
            <PictoAppareil plateforme={d.plateforme} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {d.appareil}{d.actuel && <span style={ui.badge("info")}>Cet appareil</span>}
              </div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                depuis le {dateLongue(d.created_at)}{d.en_echec ? "" : d.last_success_at ? ` · dernière notification le ${dateLongue(d.last_success_at)}` : ""}
                {d.en_echec && <span style={{ color: tone("warn").fg, fontWeight: 600 }}> · ⚠ ne répond plus</span>}
              </div>
            </div>
            {!lectureSeule && !d.actuel && <button type="button" className="ex-btn-ligne" onClick={() => onRetirer(d.id)} disabled={occupe}
              style={{ ...ui.btn("ligne", "s"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}` }}>Retirer</button>}
          </li>
        ))}
      </ul>
      {onDesactiver && <button type="button" className="ex-lien-danger" onClick={onDesactiver} disabled={occupe}
        style={{ ...ui.btn("lien"), marginTop: 12, fontSize: 13, fontWeight: 600 }}>Désactiver sur cet appareil</button>}
    </Carte>
  );
}

// Saisie « Commander pour une pharmacie » : lecture seule, jamais d'abonnement de l'appareil d'Elixir
function VueSaisie({ vue, pharmacyName }) {
  return (
    <>
      <Carte>
        <Message ton="acting" role="note">Saisie pour {pharmacyName} : les notifications s'activent sur le téléphone ou l'ordinateur de la pharmacie, jamais sur le vôtre.</Message>
        {vue.sansCip && <Message ton="warn">Pas de CIP dans Odoo : notifications impossibles pour cette fiche.</Message>}
        {vue.erreur && <Message ton="danger">{vue.erreur === "admin" ? "Session admin expirée : ouvrez l'admin (#admin) pour vous reconnecter." : MESSAGES.indisponible}</Message>}
        {vue.raison && <Message ton="info">Cette pharmacie n'est pas encore dans l'ouverture des notifications ({vue.raison === "hors_pilote" ? "hors pilote" : "ouverture fermée"}).</Message>}
        {vue.appareils && !vue.appareils.length && (
          <>
            <p style={{ ...texteP, marginTop: 12 }}>Aucun appareil : la pharmacie ne reçoit pas encore nos notifications.</p>
            <p style={{ ...texteP, fontSize: 13, color: T.inkSoft, marginTop: 8 }}>Lien à lui envoyer : <span className="ex-selectionnable" style={{ fontWeight: 600 }}>{lienActivation()}</span></p>
            <div style={{ marginTop: 10 }}><CopierLien libelle="Copier le lien" /></div>
          </>
        )}
      </Carte>
      {!!vue.appareils?.length && <Appareils appareils={vue.appareils} lectureSeule />}
    </>
  );
}
