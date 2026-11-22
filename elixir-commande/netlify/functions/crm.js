import { creerCacheCrm, initialiserCacheCrm } from "./_crm-cache.js";
import { jourParis } from "./_crm-synthese.js";
import { creerReclamationsCrm, urlEntrepot } from './_crm-reclamations.js';
import { creerStockAnnuaire } from "./_crm-annuaire-stock.js";
import { lancerAnnuaire } from "./crm-annuaire-background.js";
// API POST : { action, id?, version?, donnees?, filtres? }. Pas d'écran dans ce lot.
import { z } from "zod";
import { creerDocumentsCrm } from "./_crm-documents.js";
import { lancerIndicateurs } from "./crm-indicateurs-background.js";
import { rateLimit } from "./rate-limit.js";
import { verifierCrm, reponseCrm } from "./_crm-acces.js";
import { creerStockCrm, erreurCrm } from "./_crm-stock.js";
import { peut, droits, masquer, schemasCreation, schemasModification, valider, uuid, version, email, CHAMPS_CRM_COMPTE } from "./_crm-regles.js";
const actions = ["tableau.synthese", "accueil.synthese","import_suivi.apercu", "import_suivi.appliquer", "rapprochements.defaire","comptes.reclamations", "annuaire.etat", "annuaire.relancer", "rapprochements.lister", "rapprochements.valider", "rapprochements.rejeter", "moi", "comptes.commandes", "comptes.factures", "indicateurs.compte", "indicateurs.global", "indicateurs.relancer", "indicateurs.etat", ...["lister", "lire", "creer", "modifier", "attribuer", "archiver"].map(a => `comptes.${a}`),
  ...["lister", "creer", "modifier"].flatMap(a => [`contacts.${a}`, `activites.${a}`, `opportunites.${a}`]),
  "activites.terminer", "equipe.chercher", "equipe.lister", "equipe.enregistrer", "reglages.lire", "reglages.enregistrer", "journal.lister"];
const enveloppe = z.strictObject({ action: z.enum(actions), id: uuid.optional(), version: version.optional(),
  donnees: z.record(z.string(), z.unknown()).optional(), filtres: z.record(z.string(), z.unknown()).optional() });
const exiger = condition => { if (!condition) throw erreurCrm(403, "Droit refusé."); };
export function creerHandlerCrm(deps = {}) {
  const stock = creerStockCrm(deps), cache = creerCacheCrm(deps);
  const annuaire = creerStockAnnuaire(deps);
  const reclamations = creerReclamationsCrm(deps);
  const documents = creerDocumentsCrm(deps);
  const maintenant = deps.maintenant || (() => new Date());
  async function utilisateurAuth(id, method = "GET", data) {
    const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.cle ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) throw erreurCrm(503, "Administration Auth indisponible.");
    try {
      const res = await (deps.fetch || fetch)(`${url}/auth/v1/admin/users/${id}`, { method,
        headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(6000) });
      if (res.status === 404) throw erreurCrm(404, "Utilisateur Auth introuvable.");
      if (!res.ok) throw erreurCrm(503, "Administration Auth indisponible.");
      const user = await res.json();
      if (user?.id !== id) throw erreurCrm(503, "Réponse Auth illisible.");
      return user;
    } catch (e) { throw erreurCrm(e.status === 404 ? 404 : 503, "Administration Auth indisponible."); }
  }
  async function chercherUtilisateur(courriel) {
    const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.cle ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) throw erreurCrm(503, "Administration Auth indisponible.");
    try {
      for (let page = 1; ; page++) {
        const res = await (deps.fetch || fetch)(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, {
          headers: { apikey: cle, Authorization: `Bearer ${cle}` }, signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error("Auth indisponible");
        const d = await res.json();
        if (!Array.isArray(d.users)) throw new Error("Réponse Auth illisible");
        const user = d.users.find(v => v.email?.toLowerCase() === courriel);
        // La liste et les métadonnées Auth ne quittent jamais le serveur.
        if (user) return { utilisateur_id: valider(uuid, user.id), email: courriel };
        if (!d.users.length || (d.last_page != null ? page >= Number(d.last_page) : d.next_page != null ? Number(d.next_page) <= page : d.users.length < 1000)) return null;
      }
    } catch { throw erreurCrm(503, "Recherche Auth momentanément indisponible."); }
  }
  return async event => {
    initialiserCacheCrm(event);
    const rep = (s, d) => reponseCrm(event, s, d);
    if (event.httpMethod === "OPTIONS") return rep(200);
    if (event.httpMethod !== "POST") return rep(405, { error: "Méthode POST requise." });
    const rl = (deps.rateLimit || rateLimit)(event, 120, 60);
    if (rl) return { ...rl, headers: { ...rep(200).headers, ...rl.headers } };
    const acces = await verifierCrm(event, deps);
    if (acces.error) return acces.error;
    const u = acces.utilisateur;
    try {
      if (typeof event.body!=="string" || event.body.length>7100000) throw erreurCrm(400,"Le fichier dépasse la limite de 5 Mo.");
      let brut;
      try { brut = JSON.parse(event.body); } catch { throw erreurCrm(400, "JSON invalide."); }
      const b = valider(enveloppe, brut);
      if (b.action === "moi") return rep(200, { utilisateur: u, droits: droits(u), entrepot_url: urlEntrepot(deps) });
      const [r, a] = b.action.split(".");
      if (["tableau", "accueil"].includes(r)) {
        exiger(peut(u, a, r));
        const jour=jourParis(maintenant());
        const data=r==="tableau" ? await cache.lire("tableau",{jour},()=>stock.synthese(r,u.email)) :
          await Promise.all([cache.lire("alertes",{jour,email:u.email},async()=>(await stock.synthese(r,u.email)).alertes),stock.taches(u.email)])
            .then(([alertes,taches])=>({alertes,taches}));
        return rep(200, { donnees: masquer(u, data) });
      }
      if (r === "import_suivi") {
        exiger(peut(u,a,r));
        const d=valider(z.strictObject({nom_fichier:z.string().min(1).max(200),fichier:z.string().max(6990508)}),b.donnees);
        const {decoderSuivi,preparerSuivi}=await import('./_crm-import-suivi.js');
        const octets=decoderSuivi(d.fichier),base=await stock.donneesImport();
        const apercu=preparerSuivi(octets,{...base,nomFichier:d.nom_fichier,aujourdhui:maintenant().toISOString().slice(0,10),auteur:u.email});
        if(a==='apercu')return rep(200,{donnees:apercu});
        const creees=await stock.importerSuivi(apercu.a_creer.map(l=>({cip:l.cip,...l.activite})),u);
        if (!Number.isInteger(creees) || creees<0 || creees>apercu.a_creer.length) throw erreurCrm(503,'Import non confirmé : relancez l’aperçu avant de réessayer.');
        return rep(200,{donnees:{...apercu,creees,deja_importees:apercu.a_creer.length-creees}});
      }
      if (r === "annuaire") {
        exiger(peut(u, a, r));
        return a === "relancer" ? rep(202, await lancerAnnuaire(deps)) : rep(200, { donnees: await annuaire.etat() });
      }
      if (r === "rapprochements") {
        exiger(peut(u, a, r));
        if (a === "lister") {
          const f = valider(z.strictObject({ page:z.number().int().min(1).default(1), limite:z.number().int().min(1).max(100).default(25), automatique:z.boolean().optional(), statut:z.enum(["a_valider","valide","rejete"]).default("a_valider") }), b.filtres || {});
          return rep(200, { donnees: await annuaire.rapprochements(f) });
        }
        const d = valider(z.strictObject(["valider","defaire"].includes(a) ? { version_compte:version } : {}), b.donnees || {});
        const decision=await annuaire.decider(valider(uuid,b.id), valider(version,b.version), a, d.version_compte, u);
        await cache.invalider();return rep(200, { donnees:decision });
      }
      if (r === "equipe" && a === "chercher") {
        exiger(peut(u, a, r));
        const entree = valider(z.strictObject({ email }), b.donnees);
        const membre = await chercherUtilisateur(entree.email);
        if (!membre) throw erreurCrm(404, "Aucun compte Auth ne correspond à cet e-mail exact.");
        return rep(200, { donnees: membre });
      }
      if (r === "comptes" && ["commandes", "factures", "reclamations"].includes(a)) {
        exiger(peut(u, "lire", "comptes"));
        const compte = await stock.lire("comptes", valider(uuid, b.id));
        if (!compte) throw erreurCrm(404, "Compte introuvable.");
        return rep(200, { donnees: await (a === "reclamations" ? reclamations(compte) : documents[a](compte)) });
      }
      if (r === "indicateurs") {
        exiger(peut(u, a, r));
        if (a === "relancer") return rep(202, await lancerIndicateurs(deps));
        if (a === "etat") return rep(200, { donnees: await stock.etatSynchro() });
        let odooId = 0;
        if (a === "compte") {
          const compte = await stock.lire("comptes", valider(uuid, b.id));
          if (!compte) throw erreurCrm(404, "Compte introuvable.");
          if (!compte.odoo_id) return rep(200, { donnees: { dernier: null, historique: [] } });
          odooId = compte.odoo_id;
        }
        const instantanes = await stock.instantanes(odooId);
        if (a === "global") {
          const reglage = (await stock.lister("reglages", { limite: 1 })).lignes[0];
          instantanes.objectif_mensuel_global = reglage?.objectif_mensuel_global ?? null;
        }
        return rep(200, { donnees: masquer(u, instantanes) });
      }
      if (["lister", "lire"].includes(a)) {
        exiger(peut(u, a, r));
        let data;
        if (a === "lister") data = await stock.lister(r, r === "journal" ? { tri: "created_at", ...b.filtres } : b.filtres);
        else if (r === "reglages") data = (await stock.lister(r, { limite: 1 })).lignes[0] || null;
        else { data = await stock.lire(r, valider(uuid, b.id)); if (!data) throw erreurCrm(404, "Enregistrement introuvable."); }
        return rep(200, { donnees: masquer(u, data) });
      }
      const creation = a === "creer" || (a === "enregistrer" && !b.id);
      // Contrôle global avant la lecture des objets réservés à l'administration.
      if (["equipe", "reglages"].includes(r)) exiger(peut(u, a, r));
      let avant = null;
      if (!creation) {
        valider(uuid, b.id); valider(version, b.version);
        avant = await stock.lire(r, b.id);
        if (!avant) throw erreurCrm(404, "Enregistrement introuvable.");
        exiger(peut(u, a, r, avant));
        if (avant.version !== b.version) throw erreurCrm(409, "Conflit de version : rechargez l’enregistrement.");
      } else if (b.version !== undefined) throw erreurCrm(400, "Version interdite à la création.");
      let data;
      if (a === "attribuer") data = valider(z.strictObject({ commercial_email: email.nullable() }), b.donnees);
      else if (a === "archiver") data = valider(z.strictObject({ archive: z.boolean() }), b.donnees);
      else if (a === "terminer") {
        data = { ...valider(z.strictObject({ resultat: z.string().trim().max(20000).optional() }), b.donnees || {}),
          statut: "fait", realise_at: maintenant().toISOString() };
      } else {
        const entree = { ...b.donnees };
        if (creation && r === "activites") {
          if (entree.auteur_email && entree.auteur_email.toLowerCase() !== u.email) exiger(u.role === "admin");
          entree.auteur_email ??= u.email;
        }
        if (creation && r === "opportunites") entree.proprietaire_email ??= u.email;
        data = valider((creation ? schemasCreation : schemasModification)[r], entree);
      }
      const apres = { ...avant, ...data };
      exiger(peut(u, a, r, apres));
      if (r === "opportunites" && apres.etape === "perdue" && !apres.motif_perte?.trim())
        throw erreurCrm(400, "Un motif est obligatoire pour une opportunité perdue.");
      // Attributions et archivage passent exclusivement par leurs actions dédiées.
      if (r === "comptes" && !["attribuer", "archiver"].includes(a)) {
        if (["commercial_email", "archive"].some(k => Object.hasOwn(b.donnees || {}, k)))
          throw erreurCrm(403, "Utilisez l’action d’attribution ou d’archivage réservée à l’admin.");
        if (Object.hasOwn(data, "odoo_id") || data.source === "odoo")
          throw erreurCrm(403, "Le rattachement à Odoo est réservé à la synchronisation.");
        if (avant?.odoo_id && Object.keys(data).some(k => !CHAMPS_CRM_COMPTE.includes(k)))
          throw erreurCrm(403, "Les champs tenus par Odoo sont en lecture seule.");
        if (!avant?.odoo_id && u.role === "commercial" && data.statut !== undefined && data.statut !== "prospect")
          throw erreurCrm(403, "Seul l’admin peut changer le statut d’un prospect.");
      }
      if (!creation && ["contacts", "activites", "opportunites"].includes(r) && data.compte_id && data.compte_id !== avant.compte_id)
        throw erreurCrm(400, "Le compte de rattachement ne peut pas changer.");
      if (!creation && r === "contacts" && avant.source === "annuaire" && Object.hasOwn(data,"rpps") && data.rpps !== avant.rpps)
        throw erreurCrm(403, "Le RPPS d’un contact de l’annuaire est en lecture seule.");
      if (!creation && r === "activites" && data.auteur_email && data.auteur_email !== avant.auteur_email) exiger(u.role === "admin");
      if (["contacts", "activites", "opportunites"].includes(r)) {
        if (!await stock.lire("comptes", apres.compte_id)) throw erreurCrm(400, "Compte de rattachement introuvable.");
        if (r === "activites") for (const [k, cible] of [["contact_id", "contacts"], ["opportunite_id", "opportunites"]]) {
          if (apres[k] && (await stock.lire(cible, apres[k]))?.compte_id !== apres.compte_id) throw erreurCrm(400, "Référence appartenant à un autre compte ou introuvable.");
        }
      }
      let authAvant;
      if (r === "equipe") {
        if (!creation && (apres.utilisateur_id !== avant.utilisateur_id || apres.email !== avant.email)) throw erreurCrm(400, "L’identité du membre ne peut pas changer.");
        authAvant = await utilisateurAuth(apres.utilisateur_id);
        if (authAvant.email?.toLowerCase() !== apres.email) throw erreurCrm(400, "L’e-mail ne correspond pas au compte Auth.");
        // Auth et Postgres n'ont pas de transaction commune. Compensation si l'écriture SQL échoue.
        // actif=false est informatif dans ce lot ; seule app_metadata.role fait foi pour l'accès.
        await utilisateurAuth(apres.utilisateur_id, "PUT", { app_metadata: { ...authAvant.app_metadata, role: apres.role } });
      }
      let resultat;
      try {
        resultat = creation ? await stock.creer(r, data, u, b.action) : await stock.modifier(r, b.id, b.version, data, u, b.action);
      } catch (e) {
        if (authAvant) {
          try {
            // Une écriture concurrente peut avoir gagné : rétablir son rôle, pas l'ancien.
            const courant = b.id ? await stock.lire("equipe", b.id) :
              (await stock.lister("equipe", { utilisateur_id: apres.utilisateur_id, limite: 1 })).lignes[0];
            await utilisateurAuth(apres.utilisateur_id, "PUT", { app_metadata: {
              ...authAvant.app_metadata, role: courant?.role ?? authAvant.app_metadata?.role ?? null,
            } });
          }
          catch { throw erreurCrm(503, "Équipe non enregistrée ; rôle Auth à vérifier par l’administratrice."); }
        }
        throw e;
      }
      return rep(200, { donnees: masquer(u, resultat) });
    } catch (e) { return rep([400, 403, 404, 409, 503].includes(e.status) ? e.status : 503,
      { error: e.status ? e.message : "Service CRM indisponible." }); }
  };
}
export const handler = creerHandlerCrm();
