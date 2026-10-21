// ── Notifications de l'appli Elixir : API de l'onglet admin « 📲 Notifications » (verifyAdmin sur toutes les routes) ──
// POST { action, … } :
//   etat          { endpoint? }  → { service (coches, sans aucune valeur de clé), disponible, sujet_affiche, cle_publique, reglages,
//                                    stats, pharmacies (500 au plus), mes_appareils (appareils admin de CET admin), hotes_refuses,
//                                    appareil_inconnu (endpoint donné et inconnu de TOUTE identité : abonnement local à désinscrire) }
//   reglages      { reglages: { ouverture, pilote_cips, plafond_offres_7j, plafond_infos_7j, plafond_commandes_jour } } → { reglages }
//                 · 400 { erreurs }
//   abonner_admin { abonnement, appareil, remplacer? } → { success, appareil } (rôle admin : tests et aperçus seulement)
//   retirer_admin { id } | { endpoint } → { success } (ses propres appareils seulement)
//   test          → { envoyes, echecs, retires } (appareils admin de cet admin)
//   apercu        { message: { type, titre, corps, url } } (ou { annonce }) → idem, le message composé (pas de plafond, rien
//                 dans push_envois)
//   estimer       { type, audience: une | liste | toutes, cips? } → { categorie, visees, plafonnees, recevront, appareils, fermee,
//                 plafond, sans_appareil, alerte_coupee, hors_ouverture, email? (une : { adresses, masquees, permis, raison,
//                 telephone } — même règle que l'envoi : repliPermis, plafond compris) }
//   envoyer       { message: { type, titre, corps, url, audience, cips?, repli_email?, programme_pour? }, idem } (ou
//                 { annonce } : promotion, comme avant les types) → 202 { annonce } (envoi par push-envoi-background)
//                 · 200 { annonce, programmee: true } · même idem et même contenu → le message déjà créé (200, deja)
//                 · 409 idem_reutilise (même idem, autre contenu : rien n'est créé) · 400 { erreurs }
//                 · 409 en_cours | fermee | configuration | trop_de_programmes · 502 lancement (« Relancer »)
//   relancer      { id } → 202 (message resté « en file » depuis 2 min au moins, heure prévue passée de moins de 3 h) · 409
//                 en_cours (un autre message plafonné est en cours de diffusion) | trop_tot | trop_ancienne | statut
//   annuler       { id } → { annonce } (message « programmé » ou « en file ») · 409 statut
//   message       { id } → { annonce } (suivi d'un envoi)
//   historique    { limite? } → { annonces } · { cip } → { cip, nom, envois (90 jours), appareils } (historique d'une pharmacie)
//   evenements    { limite? } → { evenements } (outil entrepôt, push-evenement.js ; nom de la pharmacie joint)
//   chercher      { q } | { cips } → { pharmacies: [{ cip, nom, ville, appareils, plateformes, categories, derniere_visite,
//                 derniere_notification, en_echec, adresses, adresses_masquees, raison }] } (20 au plus ; jamais d'adresse complète)
//   modeles       → { modeles } (enregistrés par l'admin ; les modèles Elixir sont dans src/notifications/modeles.js)
//   modele_enregistrer { modele: { nom, type, titre, corps, url }, remplacer? } → { modele, remplace? } · 400 { erreurs }
//                 · 409 doublon (même nom : renvoyer avec remplacer: true) | trop
//   modele_supprimer { id } → { success }
//   pharmacie     { cip } → { appareils, raison } (saisie « Commander pour une pharmacie » : lecture seule)
//   retirer_pharmacie { cip, id?, effacer_historique? } → { success, retires, historique_efface? } (demande d'effacement,
//                 appareil perdu : un appareil ou tous ceux de la pharmacie ; effacer_historique : ses envois, ses événements
//                 de l'outil entrepôt, et son CIP et son nom retirés des messages terminés ; journal sans contenu)
// Jamais de 401/403 pour une raison métier (adminFetch déconnecterait l'admin) : 400 / 409. Aucune réponse ne contient endpoint,
// p256dh, auth, la clé privée ni une adresse e-mail complète. Hôte d'aperçu (fonctions branchées sur la production) : réponses
// fictives, rien n'est envoyé.
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import {
  configPush, creerStockPush, validerAbonnement, envoyerAAppareils, charge, appareilPublic, libelleNet, plateformeNette,
  statistiques, destinataires, estApercu, siteBase, json, estUuid, lancerEnvoi, TTL, URGENCE, MAX_APPAREILS, CATEGORIES_PLAFONNEES,
  lignesDesComptesActuels, repliPermis, cipAuPlafond, heurePrevue, empreinte, PLATEFORMES_TELEPHONE,
} from "./_push.js";
import { joignabilite, resumeAppareils, masquerEmail, ADRESSES_MAX } from "./_push-messages.js";
import {
  verifierMessage, verifierReglages, verifierProgrammation, raisonOuverture, categorieDuType, estTransactionnel, REGLAGES_DEFAUT, RE_CIP,
  TYPES_MESSAGE, AUDIENCES, MAX_LISTE, PROGRAMME_RETARD_MAX_MS,
} from "../../src/notifications/regles.js";
import { verifierModele, MODELES_MAX } from "../../src/notifications/modeles.js";

const ACTIONS = new Set(["etat", "reglages", "abonner_admin", "retirer_admin", "test", "apercu", "estimer", "envoyer", "relancer", "historique", "pharmacie",
  "retirer_pharmacie", "annuler", "message", "evenements", "chercher", "modeles", "modele_enregistrer", "modele_supprimer"]);
const MINUTE = 60e3;
const PROGRAMMES_MAX = 50;  // messages programmés en attente au plus
// empreinte du contenu d'un message (clé idem réutilisée avec un autre contenu : refusée, jamais l'ancien envoyé à sa place)
const empreinteMessage = (m) => empreinte(JSON.stringify([m.type, m.titre, m.corps, m.url, m.audience, m.cips, m.repli_email, m.programme_pour || null]));

// message de l'historique : liste de CIP abrégée au-delà de 20 (complète : suivi d'un message, « Annuler et modifier »)
const resumeAnnonce = (a, complet = false) => a && ({ ...a, type: a.type || "promotion", categorie: a.categorie || "offres",
  cips: Array.isArray(a.cips) ? (complet ? a.cips : a.cips.slice(0, 20)) : null, nb_cips: Array.isArray(a.cips) ? a.cips.length : 0 });
// ligne d'envoi de l'historique d'une pharmacie
const envoiPublic = (e, titres) => ({ id: e.id, categorie: e.categorie, type: e.type || titres.get(e.annonce_id)?.type || null,
  titre: e.titre || titres.get(e.annonce_id)?.titre || null, source: e.source || (e.annonce_id ? "message" : e.categorie), message: !!e.annonce_id,
  nb_appareils: e.nb_appareils, nb_reussis: e.nb_reussis, email: e.email || null, created_at: e.created_at });

// Hôte d'aperçu : réponses d'exemple, rien n'est lu, écrit ni envoyé
function apercu(cors, action) {
  const maintenant = new Date().toISOString();
  switch (action) {
    case "etat": return json(cors, 200, { apercu: true, disponible: true, service: { vapid_publique: true, vapid_privee: true, vapid_paire: true, sujet: true,
      sujet_defaut: false, cle_serveur: true, cron_secret: true, tables: true, tables_messages: true, defauts: [] }, sujet_affiche: "mailto:pharmacien@elixirpharma.fr", cle_publique: null,
      reglages: REGLAGES_DEFAUT, stats: { pharmacies: 0, appareils: 0, par_categorie: { stock: 0, commandes: 0, infos: 0, offres: 0 },
        par_plateforme: { ios: 0, android: 0, ordinateur: 0, autre: 0 }, installes: 0, en_echec: 0, vus_30j: 0 }, pharmacies: [], mes_appareils: [] });
    case "estimer": return json(cors, 200, { apercu: true, categorie: "offres", visees: 0, plafonnees: 0, recevront: 0, appareils: 0, fermee: false, plafond: null,
      sans_appareil: 0, alerte_coupee: 0, hors_ouverture: 0 });
    case "envoyer": return json(cors, 202, { apercu: true, annonce: { id: "apercu", statut: "envoyee", created_at: maintenant } });
    case "historique": return json(cors, 200, { apercu: true, annonces: [], envois: [] });
    case "evenements": return json(cors, 200, { apercu: true, evenements: [] });
    case "chercher": return json(cors, 200, { apercu: true, pharmacies: [] });
    case "modeles": return json(cors, 200, { apercu: true, modeles: [] });
    case "pharmacie": return json(cors, 200, { apercu: true, appareils: [], raison: null });
    case "retirer_pharmacie": return json(cors, 200, { apercu: true, success: true, retires: 0 });
    case "test": case "apercu": return json(cors, 200, { apercu: true, envoyes: 0, echecs: 0, retires: 0 });
    default: return json(cors, 200, { apercu: true, success: true });
  }
}

// corps « envoyer » / « apercu » : { message } (types) ou { annonce } (promotion, forme d'avant les types)
const messageDu = (body) => (body.message && typeof body.message === "object" ? body.message
  : body.annonce && typeof body.annonce === "object" ? { ...body.annonce, type: "promotion" } : {});

// deps (doublures des tests) : stock, config(), verifierAdmin, transport, hotesEssai, lancer, maintenant, journal
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockPush());
  const config = () => (deps.config ? deps.config() : configPush());
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  const lancer = deps.lancer || ((event, id) => lancerEnvoi(siteBase(event), id));

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    const { admin, error } = await (deps.verifierAdmin || verifyAdmin)(event);
    if (error) return { ...error, headers: { ...cors, ...(error.headers || {}), "Cache-Control": "no-store" } };
    if (event.httpMethod !== "POST") return json(cors, 405, { error: "methode" });
    let body;
    try { body = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "requete" }); }
    if (typeof body !== "object" || Array.isArray(body)) return json(cors, 400, { error: "requete" });
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return json(cors, 400, { error: "action" });
    if (estApercu(event)) return apercu(cors, action);

    const email = String(admin?.email || "").toLowerCase();
    const conf = config();
    const stock = stockDe();
    const iso = () => maintenant().toISOString();
    const opts = (categorie, sujet) => ({ cles: conf.cles, ttl: TTL[categorie], urgence: URGENCE[categorie], sujet, delaiMs: 5000 });
    const dep = { stock, transport: deps.transport, hotesEssai: deps.hotesEssai, maintenant, journal };
    const mesAppareils = () => stock.abonnements.deIdentite({ role: "admin", email });
    const bilan = (r) => ({ envoyes: r.envoyes, echecs: r.echecs, retires: r.retires });
    const cipDe = (v) => { const c = String(v || "").trim(); return RE_CIP.test(c) ? c : null; };
    try {
      switch (action) {
        case "etat": {
          let tables = false, absentes = false, reglages = REGLAGES_DEFAUT, lignes = [], hotesRefuses = [], tablesMessages = false;
          if (conf.service.cle_serveur) {
            try { reglages = await stock.reglages.lire({ frais: true }); tables = true; lignes = await stock.abonnements.tous(); }
            catch (e) { absentes = e?.code === "schema"; journal({ evt: "push_admin", action, code: e?.code || "erreur" }); }
            if (tables) {
              hotesRefuses = await stock.hotes.lister(10).catch(() => []);
              tablesMessages = await Promise.resolve().then(() => stock.modeles.lister(1)).then(() => true, () => false);
            }
          }
          const { stats, pharmacies } = statistiques(lignes, maintenant());
          const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
          const appareilInconnu = tables && endpoint && endpoint.length <= 1024 ? !(await stock.abonnements.parEndpoint(endpoint).catch(() => true)) : null;
          const defauts = [...conf.defauts,
            ...(conf.service.cle_serveur && !tables ? [absentes ? "Tables absentes : exécutez sql/push-schema.sql dans Supabase" : "Tables illisibles (Supabase injoignable ?)"] : []),
            ...(tables && !tablesMessages ? ["Tables des messages absentes : exécutez sql/push-messages.sql dans Supabase"] : []),
            ...(conf.service.cron_secret ? [] : ["CRON_SECRET absent : les messages ne peuvent pas partir"])];
          return json(cors, 200, { disponible: conf.ok && tables, service: { ...conf.service, tables, tables_messages: tablesMessages, defauts }, sujet_affiche: conf.sujet_affiche,
            cle_publique: conf.cle_publique, reglages, stats, pharmacies, hotes_refuses: hotesRefuses,
            mes_appareils: lignes.filter((l) => l.role === "admin" && l.compte_email === email).map((l) => appareilPublic(l, endpoint)), appareil_inconnu: appareilInconnu });
        }
        case "reglages": {
          const v = verifierReglages(body.reglages || {});
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const reglages = await stock.reglages.ecrire(v.reglages);
          journal({ evt: "push_admin", action, ouverture: reglages.ouverture, pilote: reglages.pilote_cips.length, plafond: reglages.plafond_offres_7j,
            infos: reglages.plafond_infos_7j, commandes: reglages.plafond_commandes_jour });
          return json(cors, 200, { reglages });
        }
        case "abonner_admin": {
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const v = validerAbonnement(body.abonnement, { hotesEssai: deps.hotesEssai });
          if (!v.ok) {
            if (v.hote) { journal({ evt: "push_admin", action, code: "hote_refuse", hote: v.hote }); await stock.hotes.noter(v.hote).catch(() => {}); }
            return json(cors, 400, { error: "abonnement", message: v.erreur });
          }
          const ex = await stock.abonnements.parEndpoint(v.endpoint);
          const meme = !!ex && ex.role === "admin" && ex.compte_email === email;
          if (ex && !meme && body.remplacer !== true)
            return json(cors, 409, { error: "autre_identite", de: ex.role === "admin" ? "un autre compte admin" : (ex.pharmacie_nom || `la pharmacie ${ex.pharmacy_cip}`) });
          if (!meme && (await mesAppareils()).length >= MAX_APPAREILS) return json(cors, 409, { error: "trop_d_appareils" });
          const ap = body.appareil && typeof body.appareil === "object" ? body.appareil : {};
          const r = await stock.abonnements.enregistrer({ endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth, role: "admin", pharmacy_cip: null,
            pharmacie_nom: null, compte_email: email, categories: [], appareil: libelleNet(ap.libelle), plateforme: plateformeNette(ap.plateforme),
            installe: ap.installe === true, failures: 0, last_error: null, last_seen_at: iso(),
            ...(meme ? {} : { created_at: iso(), last_success_at: null, last_failure_at: null }) });
          journal({ evt: "push_admin", action, code: meme ? "mis_a_jour" : ex ? "repris" : "nouveau" });
          return json(cors, 200, { success: true, appareil: r ? appareilPublic(r) : null });
        }
        case "retirer_admin": {
          const miens = await mesAppareils();
          const ids = miens.filter((l) => (typeof body.id === "string" && l.id === body.id) || (typeof body.endpoint === "string" && l.endpoint === body.endpoint)).map((l) => l.id);
          if (ids.length) await stock.abonnements.supprimerIds(ids);
          return json(cors, 200, { success: true });
        }
        case "test": {
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const miens = await mesAppareils();
          if (!miens.length) return json(cors, 200, { envoyes: 0, echecs: 0, retires: 0, aucun: true });
          const r = await envoyerAAppareils(miens, charge({ categorie: "test", titre: "Elixir Admin : notification de test",
            corps: "Les notifications arrivent bien sur cet appareil.", url: "/", tag: "test-admin" }, maintenant().getTime()), opts("test", "test-admin"), dep);
          return json(cors, 200, bilan(r));
        }
        case "apercu": {
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const m = messageDu(body);
          // destinataires sans objet pour un aperçu : seule la forme du message est contrôlée
          const v = verifierMessage({ ...m, audience: estTransactionnel(m.type) ? "une" : "toutes", cips: ["0000000"], repli_email: false, programme_pour: null });
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const miens = await mesAppareils();
          if (!miens.length) return json(cors, 200, { envoyes: 0, echecs: 0, retires: 0, aucun: true });
          const r = await envoyerAAppareils(miens, charge({ categorie: v.message.categorie, titre: v.message.titre, corps: v.message.corps, url: v.message.url, tag: "apercu" },
            maintenant().getTime()), opts("test", "apercu"), dep);
          return json(cors, 200, bilan(r));
        }
        case "estimer": {
          const type = TYPES_MESSAGE[body.type] ? body.type : "promotion";
          const categorie = categorieDuType(type);
          const audience = AUDIENCES.includes(body.audience) ? body.audience : "toutes";
          if (audience === "toutes" && estTransactionnel(type)) return json(cors, 400, { error: "audience" });
          const cips = audience === "toutes" ? null
            : [...new Set((Array.isArray(body.cips) ? body.cips : []).map(cipDe).filter(Boolean))].slice(0, audience === "une" ? 1 : MAX_LISTE);
          const d = await destinataires(stock, { audience, cips, categorie }, { maintenant });
          const out = { categorie, visees: d.visees, plafonnees: d.plafonnees, recevront: d.recevront, appareils: d.appareils, fermee: d.fermee,
            plafond: d.plafond ? { max: d.plafond.max, fenetre: d.plafond.libelle } : null, plafond_offres_7j: d.reglages.plafond_offres_7j,
            sans_appareil: 0, alerte_coupee: 0, hors_ouverture: 0 };
          // appareils dont le compte n'est plus rattaché à la pharmacie : écartés (supprimés à l'envoi), comme destinataires()
          const actuels = async (lignes) => lignesDesComptesActuels(stock, lignes.filter((l) => l.role === "pharmacie" && l.pharmacy_cip), { supprimer: false });
          if (cips) {
            // pharmacies choisies non joignables : hors pilote, pas d'appareil, alerte coupée
            const lignes = d.injoignables.length ? await actuels(await stock.abonnements.deCips(d.injoignables)) : [];
            for (const c of d.injoignables) {
              if (!d.fermee && raisonOuverture(d.reglages, c)) out.hors_ouverture++;
              else if (!lignes.some((l) => l.pharmacy_cip === c)) out.sans_appareil++;
              else out.alerte_coupee++;
            }
            if (audience === "une" && cips.length) {
              // e-mail de secours : même règle que l'envoi (repliPermis, plafond compris) ; « jointe » ne se sait qu'à l'envoi
              const cip = cips[0];
              const comptes = (await stock.comptesDuCip(cip).catch(() => [])).slice(0, ADRESSES_MAX);
              const secours = { adresses: comptes.length, masquees: comptes.map((c) => masquerEmail(c.email)).filter(Boolean), permis: false, raison: null,
                telephone: (d.parCip.get(cip) || []).some((l) => PLATEFORMES_TELEPHONE.includes(l.plateforme)) };
              if (type === "promotion") secours.raison = "type";
              else {
                const plafonnee = d.cipsPlafonnes.includes(cip) || (!d.parCip.has(cip) && await cipAuPlafond(stock, categorie, d.reglages, cip, maintenant));
                const p = repliPermis({ categorie, jointe: false, plafonnee, appareilsPharmacie: await actuels(await stock.abonnements.dePharmacie(cip)) });
                secours.permis = p.ok && comptes.length > 0;
                secours.raison = !p.ok ? p.raison : comptes.length ? null : "aucune_adresse";
              }
              out.email = secours;
            }
          } else {
            // toutes : hors pilote ; pharmacies dont aucun appareil ne reçoit cette alerte ; pharmacies clientes sans aucun appareil
            const tous = await actuels(await stock.abonnements.tous());
            const avecAppareil = new Set(tous.map((l) => l.pharmacy_cip));
            const avecAlerte = new Set(tous.filter((l) => (l.categories || []).includes(categorie)).map((l) => l.pharmacy_cip));
            const horsOuverture = d.fermee ? new Set() : new Set([...avecAppareil].filter((c) => raisonOuverture(d.reglages, c)));
            out.hors_ouverture = horsOuverture.size;
            out.alerte_coupee = [...avecAppareil].filter((c) => !avecAlerte.has(c) && !horsOuverture.has(c)).length;
            const clientes = await Promise.resolve().then(() => stock.cipsClientes()).catch(() => null);
            out.sans_appareil = clientes ? [...clientes].filter((c) => !avecAppareil.has(c)).length : null;
          }
          return json(cors, 200, out);
        }
        case "envoyer": {
          const v = verifierMessage(messageDu(body));
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const m = v.message;
          const idem = typeof body.idem === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.idem) ? body.idem : null;
          if (!idem) return json(cors, 400, { error: "idem" });
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const emp = empreinteMessage(m);
          // même clé : le message déjà créé (double clic, réponse perdue), seulement s'il a le même contenu
          const memeCle = (a) => (a.idem_empreinte && a.idem_empreinte !== emp ? json(cors, 409, { error: "idem_reutilise" }) : json(cors, 200, { annonce: resumeAnnonce(a), deja: true }));
          const deja = await stock.annonces.parIdem(idem);
          if (deja) return memeCle(deja);
          let programme = null;
          if (m.programme_pour) {
            const p = verifierProgrammation(m.programme_pour, maintenant().getTime());
            if (!p.ok) return json(cors, 400, { erreurs: p.erreurs });
            programme = p.iso;
            if ((await stock.annonces.programmees(PROGRAMMES_MAX + 1)).length >= PROGRAMMES_MAX) return json(cors, 409, { error: "trop_de_programmes" });
          } else {
            // une seule diffusion PLAFONNÉE à la fois (offres, informations) ; les messages transactionnels ne sont jamais bloqués
            if (CATEGORIES_PLAFONNEES.includes(m.categorie) && ((await stock.annonces.enCours(new Date(maintenant().getTime() - 15 * MINUTE).toISOString())).length
              || (await stock.annonces.diffusionEnCours()).length)) return json(cors, 409, { error: "en_cours" });
            // ouverture fermée : rien ne peut joindre un téléphone ; seul un message unitaire avec e-mail de secours a un sens
            if ((await stock.reglages.lire({ frais: true })).ouverture === "fermee" && !(m.audience === "une" && m.repli_email)) return json(cors, 409, { error: "fermee" });
          }
          const nom = m.audience === "une" ? (await stock.comptesDuCip(m.cips[0]).catch(() => [])).find((c) => c.name)?.name || null : null;
          const { annonce, existante } = await stock.annonces.creer({ idem, idem_empreinte: emp, type: m.type, categorie: m.categorie, titre: m.titre, corps: m.corps, url: m.url,
            audience: m.audience, cips: m.cips, repli_email: m.repli_email, destinataire_nom: nom, admin_email: email, source: "admin",
            statut: programme ? "programmee" : "en_file", programme_pour: programme, en_file_le: programme ? null : iso() });
          if (existante) return memeCle(annonce);
          if (programme) {
            journal({ evt: "push_admin", action, annonce: String(annonce.id).slice(0, 8), code: "programmee", type: m.type, audience: m.audience });
            return json(cors, 200, { annonce: resumeAnnonce(annonce), programmee: true });
          }
          const echec = await lancer(event, annonce.id);
          journal({ evt: "push_admin", action, annonce: String(annonce.id).slice(0, 8), code: echec ? "lancement_impossible" : "lancee", type: m.type, audience: m.audience,
            repli: m.repli_email || undefined });
          if (echec) return json(cors, 502, { error: "lancement", detail: echec, annonce: resumeAnnonce(annonce) });
          return json(cors, 202, { annonce: resumeAnnonce(annonce) });
        }
        case "relancer": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          const a = await stock.annonces.lire(body.id);
          if (!a || a.statut !== "en_file") return json(cors, 409, { error: "statut" });
          const t = maintenant().getTime();
          if (t - Date.parse(a.en_file_le || a.created_at) < 2 * MINUTE) return json(cors, 409, { error: "trop_tot" });
          // heure prévue (ou de composition) passée de plus de 3 h : jamais envoyé en retard (push-programmes le passe en erreur)
          if (!(t - heurePrevue(a) <= PROGRAMME_RETARD_MAX_MS)) return json(cors, 409, { error: "trop_ancienne" });
          // une seule diffusion plafonnée à la fois : jamais pendant qu'un autre message plafonné part
          if (CATEGORIES_PLAFONNEES.includes(a.categorie || "offres") && (await stock.annonces.diffusionEnCours()).some((x) => x.id !== a.id))
            return json(cors, 409, { error: "en_cours" });
          const echec = await lancer(event, a.id);
          if (echec) return json(cors, 502, { error: "lancement", detail: echec, annonce: resumeAnnonce(a) });
          return json(cors, 202, { annonce: resumeAnnonce(a) });
        }
        case "annuler": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          const a = await stock.annonces.annuler(body.id, email);
          if (!a) return json(cors, 409, { error: "statut" });
          journal({ evt: "push_admin", action, annonce: String(a.id).slice(0, 8), code: "annulee" });
          return json(cors, 200, { annonce: resumeAnnonce(a, true) });
        }
        case "message": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          const a = await stock.annonces.lire(body.id);
          return a ? json(cors, 200, { annonce: resumeAnnonce(a, true) }) : json(cors, 404, { error: "inconnu" });
        }
        case "historique": {
          if (body.cip != null) {
            const cip = cipDe(body.cip);
            if (!cip) return json(cors, 400, { error: "cip" });
            const [envois, lignes, comptes] = await Promise.all([stock.envois.dePharmacie(cip, 100), stock.abonnements.deIdentite({ role: "pharmacie", cip }),
              stock.comptesDuCip(cip).catch(() => [])]);
            const sansTitre = envois.filter((e) => !e.titre && e.annonce_id).map((e) => e.annonce_id);
            const titres = new Map(sansTitre.length ? (await stock.annonces.parIds(sansTitre).catch(() => [])).map((a) => [a.id, a]) : []);
            return json(cors, 200, { cip, nom: comptes.find((c) => c.name)?.name || lignes.find((l) => l.pharmacie_nom)?.pharmacie_nom || null,
              envois: envois.map((e) => envoiPublic(e, titres)), appareils: resumeAppareils(lignes), adresses: Math.min(comptes.length, ADRESSES_MAX) });
          }
          const annonces = await stock.annonces.lister(Math.max(1, Math.min(200, parseInt(body.limite, 10) || 50)));
          return json(cors, 200, { annonces: annonces.map(resumeAnnonce) });
        }
        case "evenements": {
          const evenements = await stock.evenements.lister(Math.max(1, Math.min(200, parseInt(body.limite, 10) || 50)));
          // nom de la pharmacie (comptes du site) : jamais d'adresse e-mail dans la réponse
          const noms = new Map((await stock.comptesDesCips([...new Set(evenements.map((e) => e.pharmacy_cip))].slice(0, 200)).catch(() => []))
            .filter((r) => r.name).map((r) => [r.cip, r.name]));
          return json(cors, 200, { evenements: evenements.map((e) => ({ ...e, pharmacie_nom: noms.get(e.pharmacy_cip) || null })) });
        }
        case "chercher": {
          let comptes;
          if (Array.isArray(body.cips)) comptes = await stock.comptesDesCips(body.cips.map(cipDe).filter(Boolean).slice(0, 20));
          else {
            const q = String(body.q || "").trim();
            if (q.length < 2) return json(cors, 200, { pharmacies: [] });
            comptes = await stock.chercherPharmacies(q);
          }
          return json(cors, 200, { pharmacies: await joignabilite(stock, comptes, { limite: 20 }) });
        }
        case "modeles": return json(cors, 200, { modeles: await stock.modeles.lister(MODELES_MAX) });
        case "modele_enregistrer": {
          const v = verifierModele(body.modele || {});
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const existants = await stock.modeles.lister(MODELES_MAX + 1);
          // même nom (sans casse) : remplacé seulement si l'admin le confirme
          const meme = existants.find((x) => String(x.nom).toLowerCase() === v.modele.nom.toLowerCase());
          if (meme) {
            if (body.remplacer !== true) return json(cors, 409, { error: "doublon" });
            const r = await stock.modeles.remplacer(meme.id, { ...v.modele, admin_email: email });
            journal({ evt: "push_admin", action, type: v.modele.type, code: "remplace" });
            return json(cors, 200, { modele: r, remplace: true });
          }
          if (existants.length >= MODELES_MAX) return json(cors, 409, { error: "trop" });
          const r = await stock.modeles.creer({ ...v.modele, admin_email: email });
          if (r.doublon) return json(cors, 409, { error: "doublon" });
          journal({ evt: "push_admin", action, type: v.modele.type });
          return json(cors, 200, { modele: r.modele });
        }
        case "modele_supprimer": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          await stock.modeles.supprimer(body.id);
          return json(cors, 200, { success: true });
        }
        case "pharmacie": {
          const cip = cipDe(body.cip);
          if (!cip) return json(cors, 400, { error: "cip" });
          const [lignes, reglages] = await Promise.all([stock.abonnements.deIdentite({ role: "pharmacie", cip }), stock.reglages.lire()]);
          return json(cors, 200, { appareils: lignes.map((l) => appareilPublic(l)), raison: raisonOuverture(reglages, cip), disponible: conf.ok });
        }
        case "retirer_pharmacie": {
          const cip = cipDe(body.cip);
          if (!cip) return json(cors, 400, { error: "cip" });
          const lignes = await stock.abonnements.deIdentite({ role: "pharmacie", cip });
          const ids = (typeof body.id === "string" ? lignes.filter((l) => l.id === body.id) : lignes).map((l) => l.id);
          if (ids.length) await stock.abonnements.supprimerIds(ids);
          // demande d'effacement : historique de la pharmacie aussi (envois, événements, CIP et nom dans les messages terminés)
          const effacer = body.effacer_historique === true;
          if (effacer) await Promise.all([stock.envois.purgerCip(cip), stock.evenements.purgerCip(cip), stock.annonces.effacerCip(cip)]);
          journal({ evt: "push_admin", action, n: ids.length, tous: typeof body.id !== "string", effacer });
          return json(cors, 200, { success: true, retires: ids.length, ...(effacer ? { historique_efface: true } : {}) });
        }
      }
      return json(cors, 400, { error: "action" });
    } catch (e) {
      journal({ evt: "push_admin", action, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      return json(cors, e?.code === "schema" ? 409 : 500, { error: e?.code === "schema" ? "schema" : "erreur",
        message: e?.code === "schema" ? "Tables absentes ou à compléter : exécutez sql/push-schema.sql puis sql/push-messages.sql dans Supabase." : "Erreur technique : réessayez dans un instant." });
    }
  };
}

export const handler = creerHandler();
