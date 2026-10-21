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
import { analyser, parcours as parcoursDe, versionIosTexte, libelleAppareil, joignables } from "./plateforme.js";
import { categoriesAffichees, PLAFOND_DEFAUT, PLAFOND_INFOS_DEFAUT } from "./regles.js";
import { masquer } from "./memo.js";

const dateLongue = (s) => (s ? new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
const lienActivation = () => `${C.navigateur().origine()}/?notifications=1`;
// « touchez » sur téléphone, « cliquez sur » sur ordinateur (messages fonctions de `mobile`)
const geste = (mobile) => (mobile ? "touchez" : "cliquez sur");
const TELEPHONE_ELIXIR = "01\u00a086\u00a004\u00a039\u00a095";   // jamais coupé en fin de ligne
const MESSAGES = {
  reconnexion: "Votre session a expiré\u00a0: reconnectez-vous avec le code reçu par e-mail pour gérer vos notifications.",
  indisponible: "Service momentanément indisponible\u00a0: réessayez dans un instant.",
  echec: "L'activation n'a pas abouti sur cet appareil. Réessayez\u00a0; si cela persiste, vérifiez que les notifications sont autorisées pour ce site.",
  brave: "Brave bloque les notifications des sites\u00a0: Réglages → Confidentialité et sécurité → activez «\u00a0Utiliser les services Google pour la messagerie push\u00a0», puis réessayez.",
  sans_reponse: (m) => `Vous n'avez pas encore répondu\u00a0: ${geste(m)} à nouveau «\u00a0Activer les notifications\u00a0» puis «\u00a0Autoriser\u00a0». Si rien ne s'affiche, ${geste(m)} la cloche barrée dans la barre d'adresse.`,
  trop_d_appareils: "10 appareils reçoivent déjà les notifications de votre pharmacie\u00a0: retirez-en un ci-dessous, puis réessayez.",
  fermee: "Les notifications ne sont pas encore ouvertes à votre pharmacie.",
  hors_pilote: "Les notifications ne sont pas encore ouvertes à votre pharmacie.",
  admin: "Connexion Elixir\u00a0: les notifications s'activent depuis l'admin (📲 Notifications).",
  fiche: `Aucune pharmacie n'est rattachée à ce compte\u00a0: contactez Elixir Pharma au ${TELEPHONE_ELIXIR}.`,
  expire: (m) => `Cet appareil n'était plus joignable\u00a0: ${geste(m)} «\u00a0Activer les notifications\u00a0» pour le réactiver.`,
  quota: "Trois notifications de test en 10 minutes au plus\u00a0: réessayez un peu plus tard.",
  erreur: "Une erreur est survenue\u00a0: réessayez dans un instant.",
};
// Test parti : le plus souvent, rien ne s'affiche parce que le SYSTÈME bloque le navigateur (autorisation du site accordée)
function testEnvoye(a) {
  const debut = "Notification envoyée\u00a0: elle arrive en général en quelques secondes. Rien reçu\u00a0? Vérifiez que le mode Ne pas déranger ou Concentration est coupé, ";
  if (a.ios) return `${debut}et que les notifications d'Elixir sont autorisées (Réglages → Notifications → Elixir).`;
  if (a.mobile) return `${debut}et que l'application ${a.installe ? "Elixir" : a.navigateur === "navigateur" ? "de votre navigateur" : a.navigateur} a le droit d'afficher des notifications dans les réglages du téléphone (Réglages → Applications → ${a.installe ? "Elixir" : a.navigateur === "navigateur" ? "votre navigateur" : a.navigateur} → Notifications).`;
  const nav = a.navigateur === "navigateur" ? "votre navigateur" : a.navigateur;
  return `${debut}et que les notifications de ${nav} sont autorisées par l'ordinateur (Mac\u00a0: Réglages Système → Notifications → ${nav}\u00a0; Windows\u00a0: Paramètres → Système → Notifications). Le navigateur doit rester ouvert.`;
}
const messageDe = (r, mobile = true) => {
  const m = r.etat === "echec" && r.brave ? MESSAGES.brave : MESSAGES[r.etat] || MESSAGES.erreur;
  return typeof m === "function" ? m(mobile) : m;
};
const PIED = "Les informations importantes (confirmations de commande, factures) continuent d'arriver par e-mail.";
const CONTACT = "pharmacien@elixirpharma.fr";

// ── Petits éléments ──
const btnPrincipal = { ...ui.btn("primaire", "m"), background: undefined, color: undefined, height: 44, padding: "0 20px", fontSize: 14 };
const btnLigne = { ...ui.btn("ligne", "m"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, height: 44, padding: "0 18px", fontSize: 14 };
// téléphone (< 768 px) : boutons sur toute la largeur, libellé sur deux lignes au besoin (grande police, 320 px)
const pleineLargeur = { width: "100%", whiteSpace: "normal", height: "auto", minHeight: 44, padding: "10px 18px", justifyContent: "center", textAlign: "center" };
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
const IOS_26 = 2600;   // iOS 26 : Partager dans « ••• », interrupteur « Ouvrir en tant qu'app web » (libellé à vérifier sur un iPhone)

// a : analyser(env) — iPad (Partager en haut à droite), iOS 26, Chrome sur iPhone
export function GuideIphone({ appareil = "iPhone", a = {} }) {
  const ios26 = (a.versionIos || 0) >= IOS_26;
  const partager = a.navigateur === "Chrome"
    ? <>Touchez <strong>Partager</strong> <PictoPartager /> en haut, dans la barre d'adresse.</>
    : a.ipad ? <>Touchez <strong>Partager</strong> <PictoPartager /> (le carré avec une flèche vers le haut), en haut à droite de l'écran.</>
    : ios26 ? <>Touchez <strong>«&nbsp;•••&nbsp;»</strong> en bas à droite, puis <strong>Partager</strong> <PictoPartager />.</>
    : <>Touchez <strong>Partager</strong> <PictoPartager /> (le carré avec une flèche vers le haut), en bas de l'écran.</>;
  const etapes = [
    partager,
    <>Choisissez <strong>Sur l'écran d'accueil</strong> <PictoAjouter /> (faites défiler si besoin).</>,
    ios26 ? <>Laissez <strong>«&nbsp;Ouvrir en tant qu'app web&nbsp;»</strong> activé, puis touchez <strong>Ajouter</strong>.</>
      : <>Touchez <strong>Ajouter</strong>, en haut à droite.</>,
    <>Ouvrez l'icône <strong>Elixir</strong> <IconeElixir /> de votre écran d'accueil et <strong>reconnectez-vous</strong> avec le code reçu par e-mail (une seule fois&nbsp;: l'application a sa propre session).</>,
    <>Ouvrez <strong>Notifications</strong> dans le menu ☰ et touchez <strong>Activer les notifications</strong>, puis <strong>Autoriser</strong>.</>,
  ];
  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: T.ink }}>
        Sur {appareil}, les alertes arrivent par l'<strong>application Elixir</strong>&nbsp;: ajoutez-la à votre écran d'accueil, c'est gratuit et cela prend 30 secondes.
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {etapes.map((e, i) => (
          <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14, lineHeight: 1.5, color: T.ink }}>
            <span aria-hidden="true" className="num" style={{ width: 26, height: 26, flexShrink: 0, borderRadius: R.pill, background: T.petrol, color: T.paper,
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ minWidth: 0 }}><span className="ex-lecteur" style={srOnly}>Étape {i + 1}&nbsp;: </span>{e}</span>
          </li>
        ))}
      </ol>
      <p style={{ margin: "14px 0 0", fontSize: 12.5, lineHeight: 1.5, color: T.inkSoft }}>
        Une icône Elixir est déjà sur votre écran d'accueil et elle ouvre Safari (barre d'adresse visible)&nbsp;? Supprimez-la, puis ajoutez-la de nouveau depuis Safari&nbsp;: seule la nouvelle reçoit les notifications.
      </p>
      <p style={{ margin: "8px 0 0", fontSize: 12.5, color: T.inkSoft }}>Votre {appareil} doit avoir <strong>iOS 16.4 ou plus récent</strong> (Réglages → Général → Informations).</p>
    </div>
  );
}
const srOnly = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 };

function CopierLien({ libelle = "Copier le lien", principal = false, apres = null, style }) {
  const [copie, setCopie] = useState(false);
  const lien = lienActivation();
  const copier = () => {
    navigator.clipboard?.writeText(lien).then(() => { setCopie(true); setTimeout(() => setCopie(false), apres ? 8000 : 2000); }).catch(() => window.prompt("Lien à ouvrir dans Safari\u00a0:", lien));
  };
  return (
    <>
      <Bouton principal={principal} icone={copie ? "coche" : "copier"} onClick={copier} style={style}>{copie ? "Lien copié" : libelle}</Bouton>
      {copie && apres && <Message ton="ok">{apres}</Message>}
    </>
  );
}

// Code QR du lien d'activation (ordinateur → téléphone) : bibliothèque chargée à la demande (chunk séparé), dessin SVG
function CodeQR({ texte, taille = 168 }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    let fini = false;
    import("qrcode-generator").then((m) => {
      const q = (m.default || m.qrcode)(0, "M");
      q.addData(texte); q.make();
      if (!fini) setQr(q);
    }).catch(() => {});
    return () => { fini = true; };
  }, [texte]);
  if (!qr) return <div aria-hidden="true" style={{ width: taille, height: taille, borderRadius: 10, background: T.paper, flexShrink: 0 }} />;
  const n = qr.getModuleCount(), marge = 4, cote = n + 2 * marge;   // zone de silence standard (4 modules)
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + marge} ${r + marge}h1v1h-1z`;
  return (
    <svg role="img" aria-label={`Code QR\u00a0: ${texte}`} viewBox={`0 0 ${cote} ${cote}`} width={taille} height={taille} shapeRendering="crispEdges"
      style={{ background: "#fff", borderRadius: 10, flexShrink: 0, boxShadow: `inset 0 0 0 1px ${T.lineSoft}` }}><path d={d} fill="#0a1d22" /></svg>
  );
}
const PictoTelephone = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" /><path d="M10.5 18h3" /></svg>
);

// « Sur votre téléphone » (ordinateur) : code QR à scanner avec l'appareil photo, ou adresse à taper
function SurTelephone({ titreRef }) {
  const lien = lienActivation();
  return (
    <Carte titre="Sur votre téléphone" titreRef={titreRef}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <CodeQR texte={lien} />
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <p style={texteP}>Visez ce code avec l'appareil photo de votre téléphone, touchez le lien qui apparaît, connectez-vous avec le code reçu par e-mail, puis touchez «&nbsp;Activer les notifications&nbsp;».</p>
          <p style={{ ...texteP, fontSize: 13, color: T.inkSoft, marginTop: 8 }}>Ou tapez l'adresse&nbsp;: <span className="ex-selectionnable" style={{ fontWeight: 600, overflowWrap: "anywhere" }}>elixir-commande.expepharma.com</span></p>
          <p style={{ ...texteP, fontSize: 12.5, color: T.inkSoft, marginTop: 8 }}>iPhone&nbsp;: le lien s'ouvre dans Safari, qui vous guidera pour ajouter l'application Elixir à l'écran d'accueil.</p>
        </div>
      </div>
    </Carte>
  );
}

// ── Carte de l'accueil « Recevez nos alertes sur votre téléphone » ──
// etat : réponse de demarrage.js ({ parcours, statut }) ; onOuvrir(section?) : ouvre le panneau (« telephone » : code QR en
// tête) ; onEtat : met à jour l'état d'App ; mobile (< 768 px) : pastille dans la ligne du titre, boutons sur toute la largeur
export function CarteNotifications({ appel, identite, etat, mobile = false, onOuvrir, onEtat }) {
  const api = useMemo(() => C.apiPharmacie(appel), [appel]);
  const env = C.navigateur().env();
  const a = analyser(env);
  const p = etat?.parcours || "activer";
  const plafond = etat?.statut?.plafond_offres_7j ?? PLAFOND_DEFAUT;
  const plafondInfos = etat?.statut?.plafond_infos_7j ?? PLAFOND_INFOS_DEFAUT;
  const dejaJoints = joignables(etat?.statut).total;
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);   // { ton, texte }
  const [active, setActive] = useState(false);
  const [test, setTest] = useState(null);
  const [reporte, setReporte] = useState(false);  // « Plus tard » : message à la place de la carte, focus dessus
  const noteRef = useRef(null);
  // préparation (service worker, clé publique) dès l'affichage : le clic n'attend plus le réseau avant la demande
  useEffect(() => { if (p === "activer") C.preparer().catch(() => {}); }, [p]);
  useEffect(() => { if (reporte) noteRef.current?.focus(); }, [reporte]);
  // boutons : en ligne sur ordinateur, l'un sous l'autre et sur toute la largeur sur mobile
  const ligneBoutons = mobile ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 14 } : { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 };
  const styleBouton = mobile ? pleineLargeur : undefined;
  const surCet = a.ios ? (a.ipad ? "cet iPad" : "cet iPhone") : a.mobile ? "ce téléphone" : "cet ordinateur";
  const plusTard = () => { masquer(identite); setReporte(true); };
  const activer = async () => {
    setOccupe(true); setMessage(null);
    const r = await C.activer({ api });
    setOccupe(false);
    if (r.etat === "abonne") { setActive(true); onEtat?.((e) => (e ? { ...e, parcours: "abonne" } : e)); return; }
    if (["autre_identite", "trop_d_appareils", "refuse"].includes(r.etat)) { onOuvrir(); return; }
    setMessage({ ton: r.etat === "sans_reponse" ? "warn" : "danger", texte: messageDe(r, a.mobile) });
  };
  const essayer = async () => {
    setTest({ occupe: true });
    const r = await C.envoyerTest({ api });
    setTest({ ton: r.etat === "ok" ? "ok" : "danger", texte: r.etat === "ok" ? (r.apercu ? "Aperçu\u00a0: aucune notification n'est envoyée." : testEnvoye(a)) : messageDe(r, a.mobile) });
  };
  if (reporte) {
    return (
      <section className="acc-section" aria-label="Alertes sur votre téléphone">
        <p ref={noteRef} tabIndex={-1} role="status" style={{ margin: 0, padding: "10px 14px", borderRadius: R.m, background: T.surface, fontSize: 13.5, lineHeight: 1.5, color: T.inkSoft, outline: "none" }}>
          D'accord. Vous pourrez activer les alertes à tout moment&nbsp;: {a.mobile ? "menu ☰" : "menu de gauche"}, rubrique MON COMPTE, «&nbsp;Notifications&nbsp;».
        </p>
      </section>
    );
  }
  const titre = a.ios ? `Recevez nos alertes sur votre ${a.ipad ? "iPad" : "iPhone"}` : a.mobile ? "Recevez nos alertes sur votre téléphone" : "Recevez nos alertes sur votre téléphone ou sur cet ordinateur";
  const texte = p === "installer_ios" ? `Sur ${a.ipad ? "iPad" : "iPhone"}, les alertes arrivent par l'application Elixir\u00a0: ajoutez-la à votre écran d'accueil, c'est gratuit et cela prend 30 secondes.`
    : p === "ouvrir_safari" ? "Cette page est ouverte dans une autre application. Copiez le lien, puis ouvrez Safari, touchez la barre d'adresse et collez-le\u00a0: vous pourrez y installer l'application Elixir."
    : a.mobile ? (dejaJoints ? `${dejaJoints > 1 ? `${dejaJoints} appareils de votre pharmacie reçoivent` : "Un appareil de votre pharmacie reçoit"} déjà nos alertes\u00a0: les recevoir aussi sur ce téléphone\u00a0?`
      : "Vos produits attendus dès leur retour en stock, le suivi de vos commandes et réclamations, nos informations et nos offres\u00a0: vous êtes prévenu sur votre téléphone, même quand le site est fermé.")
    : "Le plus pratique\u00a0: sur votre téléphone, en visant un code avec l'appareil photo. Vous pouvez aussi les recevoir sur cet ordinateur, tant que le navigateur est ouvert.";
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
                <Icone nom="coche" taille={16} style={{ color: T.ok, flexShrink: 0 }} />{a.mobile ? "Vous recevrez nos alertes, même quand le site est fermé." : "Vous recevrez nos alertes, même onglet fermé, tant que le navigateur est ouvert."}
              </p>
              <div style={ligneBoutons}>
                <Bouton principal icone="envoyer" onClick={essayer} disabled={test?.occupe} style={styleBouton}>{test?.occupe ? "Envoi…" : "Envoyer une notification de test"}</Bouton>
                <Bouton onClick={() => onOuvrir()} style={styleBouton}>Choisir mes alertes</Bouton>
              </div>
              {test?.texte && <Message ton={test.ton}>{test.texte}</Message>}
            </>
          ) : (
            <>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: T.inkSoft }}>{texte}</p>
              <div style={ligneBoutons}>
                {p === "activer" && a.mobile && <Bouton principal icone="cloche" onClick={activer} disabled={occupe} style={styleBouton}>{occupe ? "Activation…" : "Activer les notifications"}</Bouton>}
                {p === "activer" && !a.mobile && <>
                  <Bouton principal onClick={() => onOuvrir("telephone")} style={styleBouton}><PictoTelephone />Sur mon téléphone</Bouton>
                  <Bouton icone="cloche" onClick={activer} disabled={occupe} style={styleBouton}>{occupe ? "Activation…" : "Activer sur cet ordinateur"}</Bouton>
                </>}
                {p === "installer_ios" && <Bouton principal onClick={() => onOuvrir()} style={styleBouton}>Voir comment faire</Bouton>}
                {p === "ouvrir_safari" && <CopierLien principal style={styleBouton} apres="Lien copié&nbsp;: ouvrez Safari, touchez la barre d'adresse, collez le lien et ouvrez-le." />}
                <Bouton onClick={plusTard} style={styleBouton}>Plus tard</Bouton>
              </div>
              {message && <Message ton={message.ton}>{message.texte}</Message>}
              <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.5, color: T.inkMute }}>
                {plafond > 0 || plafondInfos > 0 ? `Vous choisissez ce que vous recevez. L'activation inclut nos informations et nos offres (${Math.max(plafond, plafondInfos)} par semaine au plus chacune), désactivables à tout moment dans «\u00a0Notifications\u00a0».`
                  : "Vous choisissez ce que vous recevez, à tout moment dans «\u00a0Notifications\u00a0»."}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Panneau « Notifications » (fenêtre comme « Mes commandes ») ──
// section : « telephone » (bouton « Sur mon téléphone » de la carte, ordinateur) → code QR en tête, titre focalisé
export function PanneauNotifications({ appel, acting = null, pharmacyName, mobile, section = null, onClose, onReconnecter = null, onEtat }) {
  const api = useMemo(() => C.apiPharmacie(appel), [appel]);
  const env = C.navigateur().env();
  const a = analyser(env);
  const [vue, setVue] = useState({ chargement: true });
  const [message, setMessage] = useState(null);   // { ton, texte } sous la zone d'action
  const [occupe, setOccupe] = useState(false);
  const [deDe, setDe] = useState(null);           // « de » d'un 409 autre_identite (Elixir (admin), une autre pharmacie)
  const vivant = useRef(true);
  const titreTelephone = useRef(null);
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
      // abonnement local inconnu du serveur (mort, retiré ailleurs) : désinscrit, « Activer » en prendra un nouveau
      if (s.disponible) await C.nettoyerSiInconnu({ sub, statut: s });
      const p = parcoursDe(C.navigateur().env(), !!s.appareil);
      setVue({ statut: s, parcours: p, autreIdentite: !s.appareil && !!s.autre_identite });
      if (p === "activer") C.preparer().catch(() => {});
    } catch { if (vivant.current) setVue({ erreur: "indisponible" }); }
  }, [acting, api, appel]);
  useEffect(() => { charger(); }, [charger]);
  const enTete = section === "telephone" && !a.mobile;
  useEffect(() => { if (enTete && !vue.chargement) titreTelephone.current?.focus(); }, [enTete, vue.chargement]);

  const apresActivation = (r) => {
    if (r.etat === "abonne") { setMessage(null); onEtat?.((e) => (e ? { ...e, carte: false, parcours: "abonne" } : e)); charger(); return; }
    if (r.etat === "autre_identite") { setDe(r.de || null); setVue((v) => ({ ...v, autreIdentite: true })); return; }
    if (r.etat === "refuse") { setVue((v) => ({ ...v, parcours: "refuse" })); return; }
    if (r.etat === "reconnexion") { setVue({ erreur: "reconnexion" }); return; }
    setMessage({ ton: r.etat === "sans_reponse" ? "warn" : "danger", texte: messageDe(r, a.mobile) });
  };
  const agir = (fn) => async () => { setOccupe(true); setMessage(null); try { await fn(); } finally { if (vivant.current) setOccupe(false); } };
  const activer = agir(async () => apresActivation(await C.activer({ api })));
  const remplacer = agir(async () => { setDe(null); apresActivation(await C.reactiver({ api, remplacer: true })); });
  const essayer = agir(async () => {
    const r = await C.envoyerTest({ api });
    if (r.etat === "expire") await charger();   // abonnement retiré et désinscrit : « Activer » en prendra un nouveau
    setMessage({ ton: r.etat === "ok" ? "ok" : r.etat === "quota" ? "warn" : "danger",
      texte: r.etat === "ok" ? (r.apercu ? "Aperçu\u00a0: aucune notification n'est envoyée." : testEnvoye(a)) : r.etat === "envoi" ? `La notification n'a pas pu partir${r.detail ? ` (${r.detail})` : ""}\u00a0: réessayez dans un instant.` : messageDe(r, a.mobile) });
  });
  const desactiver = agir(async () => {
    const r = await C.desactiver({ api });
    if (r.etat === "reconnexion") { setVue({ erreur: "reconnexion" }); return; }
    onEtat?.((e) => (e ? { ...e, parcours: "activer" } : e));
    await charger();
    setMessage({ ton: "info", texte: "Notifications désactivées sur cet appareil." });
  });
  const retirer = (d) => {
    if (!window.confirm(`Retirer «\u00a0${d.appareil}\u00a0»\u00a0? Il ne recevra plus les notifications de la pharmacie (il pourra les réactiver).`)) return;
    agir(async () => { const r = await C.retirerAppareil({ api, id: d.id }); if (!r.ok) setMessage({ ton: "danger", texte: MESSAGES.indisponible }); await charger(); })();
  };
  const changer = async (cat, actif) => {
    const avant = vue.statut.appareil.categories;
    const apres = actif ? [...new Set([...avant, cat])] : avant.filter((c) => c !== cat);
    setVue((v) => ({ ...v, statut: { ...v.statut, appareil: { ...v.statut.appareil, categories: apres } } }));
    const r = await C.changerCategories({ api, categories: apres });
    if (!vivant.current) return;
    if (!r.ok) {
      setVue((v) => ({ ...v, statut: { ...v.statut, appareil: { ...v.statut.appareil, categories: avant } } }));
      setMessage({ ton: "danger", texte: messageDe({ etat: r.etat || "indisponible" }, a.mobile) });
    }
  };

  const libelle = a.ipad ? "iPad" : "iPhone";   // guide et messages iOS
  const sousTitre = acting ? `Saisie pour ${pharmacyName}` : [pharmacyName, `cet appareil\u00a0: ${libelleAppareil(env)}`].filter(Boolean).join(" · ");
  const plafond = vue.statut?.plafond_offres_7j ?? PLAFOND_DEFAUT;
  const categories = vue.statut?.categories_disponibles || categoriesAffichees(plafond, vue.statut?.plafond_infos_7j ?? PLAFOND_INFOS_DEFAUT);
  const pleinEcran = mobile;
  const sb = mobile ? pleineLargeur : undefined;   // boutons du panneau sur téléphone
  const ligne = { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, ...(mobile ? { flexDirection: "column" } : {}) };
  const telephone = !a.mobile && vue.statut?.disponible ? <SurTelephone titreRef={titreTelephone} /> : null;
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
                <Message ton={vue.erreur === "reconnexion" ? "warn" : "danger"}>{messageDe({ etat: vue.erreur in MESSAGES ? vue.erreur : "indisponible" }, a.mobile)}</Message>
                <div style={ligne}>
                  {vue.erreur === "reconnexion" && onReconnecter && <Bouton principal onClick={() => { onClose(); onReconnecter(); }} style={sb}>Se reconnecter</Bouton>}
                  {vue.erreur !== "reconnexion" && <Bouton onClick={charger} icone="actualiser" style={sb}>Réessayer</Bouton>}
                </div>
              </Carte>
            ) : !vue.statut?.disponible ? (
              <Carte><Message ton="info">{MESSAGES[vue.statut?.raison] || MESSAGES.fermee}</Message></Carte>
            ) : (
              <>
                {enTete && telephone}
                {vue.autreIdentite ? (
                  <Carte titre="Cet appareil est déjà utilisé">
                    <p style={texteP}>Cet appareil reçoit les notifications {deDe ? (deDe.startsWith("une ") ? `d'${deDe}` : `de «\u00a0${deDe}\u00a0»`) : "d'un autre compte"}. Les recevoir désormais pour {pharmacyName || "votre pharmacie"}&nbsp;?</p>
                    <div style={ligne}>
                      <Bouton principal onClick={remplacer} disabled={occupe} style={sb}>Oui, pour {pharmacyName || "ma pharmacie"}</Bouton>
                      <Bouton onClick={onClose} style={sb}>Annuler</Bouton>
                    </div>
                  </Carte>
                ) : vue.parcours === "abonne" ? (
                  <Carte>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600, color: T.ok }}>
                      <Icone nom="coche" taille={18} style={{ flexShrink: 0 }} />Notifications activées sur cet appareil ({vue.statut.appareil.appareil})
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {categories.map((c) => (
                        <Interrupteur key={c.id} id={`notif-cat-${c.id}`} libelle={c.libelle} aide={c.aide} actif={vue.statut.appareil.categories.includes(c.id)}
                          onChange={(v) => changer(c.id, v)} />
                      ))}
                    </div>
                    <div style={ligne}>
                      <Bouton principal icone="envoyer" onClick={essayer} disabled={occupe} style={sb}>Envoyer une notification de test</Bouton>
                    </div>
                  </Carte>
                ) : vue.parcours === "activer" ? (
                  <Carte titre={a.mobile ? "Recevez nos alertes sur ce téléphone" : "Recevez nos alertes sur cet ordinateur"}>
                    <p style={texteP}>Vous recevrez&nbsp;:</p>
                    <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                      {categories.map((c) => (
                        <li key={c.id} style={{ display: "flex", gap: 8, fontSize: 13.5, lineHeight: 1.45 }}>
                          <Icone nom="coche" taille={16} style={{ color: T.teal, marginTop: 2, flexShrink: 0 }} />
                          <span><strong>{c.libelle}</strong> — {c.aide}</span>
                        </li>
                      ))}
                    </ul>
                    <Bouton principal icone="cloche" onClick={activer} disabled={occupe} style={{ marginTop: 14, ...sb }}>{occupe ? "Activation…" : a.mobile ? "Activer les notifications" : "Activer sur cet ordinateur"}</Bouton>
                    {!a.mobile && <p style={{ ...texteP, fontSize: 12.5, color: T.inkMute, marginTop: 10 }}>Sur ordinateur, le navigateur doit rester ouvert pour les recevoir (la fenêtre du site peut être fermée).</p>}
                  </Carte>
                ) : vue.parcours === "installer_ios" ? (
                  <Carte titre={`Installer l'application Elixir sur votre ${libelle}`}><GuideIphone appareil={libelle} a={a} /></Carte>
                ) : vue.parcours === "ouvrir_safari" ? (
                  <Carte titre="Ouvrez cette page dans Safari">
                    <p style={texteP}>Cette page est ouverte dans une autre application. Touchez «&nbsp;•••&nbsp;» ou l'icône de partage de l'application, puis «&nbsp;Ouvrir dans Safari&nbsp;». Ou copiez le lien, ouvrez Safari, touchez la barre d'adresse et collez-le.</p>
                    <div style={ligne}><CopierLien principal style={sb} apres="Lien copié&nbsp;: ouvrez Safari, touchez la barre d'adresse, collez le lien et ouvrez-le." /></div>
                  </Carte>
                ) : vue.parcours === "maj_ios" ? (
                  <Carte titre={`Mettez à jour votre ${libelle || "iPhone"}`}>
                    <p style={texteP}>{versionIosTexte(env) ? `Votre ${libelle || "iPhone"} utilise iOS ${versionIosTexte(env)}. ` : ""}Les notifications demandent iOS 16.4 ou plus récent&nbsp;: Réglages → Général → Mise à jour logicielle. En attendant, nos informations vous parviennent par e-mail.</p>
                  </Carte>
                ) : vue.parcours === "refuse" ? (
                  <Carte titre="Notifications bloquées">
                    <p style={texteP}>Les notifications sont bloquées pour ce site sur cet appareil. Pour les autoriser&nbsp;:</p>
                    <p style={{ ...texteP, marginTop: 8, fontWeight: 600 }}>{a.ios ? "Réglages → Notifications → Elixir → Autoriser les notifications."
                      : a.android ? "Touchez l'icône à gauche de l'adresse (cadenas ou réglages) → Autorisations → Notifications → Autoriser. Application installée\u00a0: appui long sur l'icône Elixir → Infos sur l'appli → Notifications."
                      : "Cliquez sur l'icône à gauche de l'adresse (cadenas ou réglages) → Notifications → Autoriser, puis rechargez la page."}</p>
                    <Bouton onClick={charger} icone="actualiser" style={{ marginTop: 12, ...sb }}>J'ai changé le réglage</Bouton>
                  </Carte>
                ) : (
                  <Carte titre="Navigateur non compatible">
                    <p style={texteP}>Ce navigateur ne permet pas les notifications. Sur Android, utilisez Chrome&nbsp;; sur ordinateur, Chrome, Edge, Firefox ou Safari.</p>
                  </Carte>
                )}
                {message && <Message ton={message.ton}>{message.texte}</Message>}
                {!enTete && telephone}
                <Appareils appareils={vue.statut?.appareils || []} onRetirer={retirer} onDesactiver={vue.parcours === "abonne" ? desactiver : null} occupe={occupe} />
              </>
            )}
          {!vue.chargement && !vue.acting && (
            <>
              <p style={{ margin: "16px 4px 0", fontSize: 12.5, lineHeight: 1.5, color: T.inkSoft }}>{PIED}</p>
              <VosDonnees />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
const texteP = { margin: 0, fontSize: 14, lineHeight: 1.5, color: T.ink };

// Information sur les données (RGPD, art. 13) : ce qui est enregistré, pourquoi, combien de temps, à qui écrire
function VosDonnees() {
  return (
    <details style={{ margin: "10px 4px 0", fontSize: 12.5, lineHeight: 1.5, color: T.inkSoft }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, color: T.ink, minHeight: 32, display: "flex", alignItems: "center" }}>Vos données</summary>
      <p style={{ margin: "6px 0 0" }}>
        Pour chaque appareil activé, Elixir Pharma enregistre&nbsp;: l'adresse technique et les clés de chiffrement fournies par le navigateur (Google, Apple, Mozilla ou Microsoft),
        l'e-mail de votre compte et le CIP de la pharmacie, le type d'appareil (par exemple «&nbsp;iPhone · application&nbsp;»), les alertes choisies et les dates d'activation,
        de dernière visite et de dernier envoi. Elles servent uniquement à vous envoyer ces notifications et ne sont jamais transmises à d'autres fins.
      </p>
      <p style={{ margin: "6px 0 0" }}>
        Elles sont supprimées quand vous désactivez les notifications, vous déconnectez ou retirez l'appareil, et automatiquement après 12 mois sans visite du site
        sur cet appareil. Pour toute question ou demande (accès, effacement)&nbsp;: <span className="ex-selectionnable">{CONTACT}</span>.
      </p>
    </details>
  );
}

function Carte({ titre, titreRef, children }) {
  return (
    <section style={{ ...ui.card, padding: "16px 18px", marginBottom: 12 }}>
      {titre && <h3 ref={titreRef} tabIndex={titreRef ? -1 : undefined} style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 640, color: T.petrol, outline: "none" }}>{titre}</h3>}
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
            {!lectureSeule && !d.actuel && <button type="button" className="ex-btn-ligne" onClick={() => onRetirer(d)} disabled={occupe} aria-label={`Retirer ${d.appareil}`}
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
        <Message ton="acting" role="note">Saisie pour {pharmacyName}&nbsp;: les notifications s'activent sur le téléphone ou l'ordinateur de la pharmacie, jamais sur le vôtre.</Message>
        {vue.sansCip && <Message ton="warn">Pas de CIP dans Odoo&nbsp;: notifications impossibles pour cette fiche.</Message>}
        {vue.erreur && <Message ton="danger">{vue.erreur === "admin" ? "Session admin expirée\u00a0: ouvrez l'admin (#admin) pour vous reconnecter." : MESSAGES.indisponible}</Message>}
        {vue.raison && <Message ton="info">Cette pharmacie n'est pas encore dans l'ouverture des notifications ({vue.raison === "hors_pilote" ? "hors pilote" : "ouverture fermée"}).</Message>}
        {vue.appareils && !vue.appareils.length && (
          <>
            <p style={{ ...texteP, marginTop: 12 }}>Aucun appareil&nbsp;: la pharmacie ne reçoit pas encore nos notifications.</p>
            <p style={{ ...texteP, fontSize: 13, color: T.inkSoft, marginTop: 8 }}>Lien à lui envoyer&nbsp;: <span className="ex-selectionnable" style={{ fontWeight: 600 }}>{lienActivation()}</span></p>
            <div style={{ marginTop: 10 }}><CopierLien libelle="Copier le lien" /></div>
          </>
        )}
      </Carte>
      {!!vue.appareils?.length && <Appareils appareils={vue.appareils} lectureSeule />}
    </>
  );
}
