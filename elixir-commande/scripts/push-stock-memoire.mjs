// Stock en mémoire des notifications (même interface que creerStockPush de netlify/functions/_push.js), pour les tests :
// scripts/test-push-serveur.mjs et scripts/test-push-messages.mjs. Aucun accès réseau.
// Reproduit les règles de la base qui comptent pour le code : index unique « un seul message PLAFONNÉ en cours »
// (push_annonces_une_en_cours, sql/push-messages.sql), clé d'idempotence unique des messages, clé et empreinte uniques des
// événements de l'outil entrepôt, nom de modèle unique (sans casse), passages conditionnels (programmée → en file, annulée).
// Options :
//   reglages, lignes (abonnements), envois, annonces ;
//   comptes : Map(e-mail → CIP actuel dans elixir_pharmacies) ; absent : chaque e-mail d'abonnement rattaché à son CIP ;
//   pharmacies : lignes de elixir_pharmacies [{ email, name, cip, ville }] (adresses de compte, recherche de l'admin) ;
//     absent : déduites des abonnements (compte_email, pharmacie_nom) ;
//   horloge : () => Date (dates d'écriture : messages, envois, événements ; l'heure réelle par défaut).
import crypto from "node:crypto";
import * as R from "../src/notifications/regles.js";

const PLAFONNEES = ["offres", "infos"];
const plafonnee = (a) => PLAFONNEES.includes(a.categorie || "offres");

export function stockMemoire({ reglages = { ouverture: "toutes" }, lignes = [], envois = [], annonces = [], comptes = null, pharmacies = null, horloge = () => new Date() } = {}) {
  const db = { ab: lignes.map((l) => ({ failures: 0, created_at: new Date().toISOString(), categories: ["stock", "commandes", "offres"], ...l })), reglages: R.fusionnerReglages(reglages),
    annonces: annonces.map((a) => ({ type: "promotion", categorie: "offres", source: "admin", repli_email: false, ...a })), envois: envois.map((e, i) => ({ id: i + 1, ...e })),
    appels: [], comptes, pharmacies, hotes: new Map(), supprimes: [], modeles: [], evenements: [], emails: [] };
  const copie = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
  const trace = (n) => db.appels.push(n);
  const maintenant = () => horloge().toISOString();
  const lignesPharmacies = () => db.pharmacies || [...new Map(db.ab.filter((l) => l.role === "pharmacie" && l.compte_email)
    .map((l) => [String(l.compte_email).toLowerCase(), { email: String(l.compte_email).toLowerCase(), name: l.pharmacie_nom || null, cip: l.pharmacy_cip, ville: null }])).values()];
  const stock = {
    db,
    abonnements: {
      async parEndpoint(e) { trace("parEndpoint"); return copie(db.ab.find((l) => l.endpoint === e)) || null; },
      async deIdentite(i) { trace("deIdentite"); return copie(db.ab.filter((l) => (i.role === "admin" ? l.role === "admin" && l.compte_email === i.email : l.role === "pharmacie" && l.pharmacy_cip === i.cip))); },
      async enregistrer(ligne) {
        trace("enregistrer");
        const ex = db.ab.find((l) => l.endpoint === ligne.endpoint);
        if (ex) { Object.assign(ex, ligne); return copie(ex); }
        const n = { id: crypto.randomUUID(), failures: 0, created_at: new Date().toISOString(), last_success_at: null, ...ligne };
        db.ab.push(n); return copie(n);
      },
      async modifier(id, champs) { trace("modifier"); const l = db.ab.find((x) => x.id === id); if (l) Object.assign(l, champs); return copie(l) || null; },
      async supprimerIds(ids) { trace("supprimerIds"); db.supprimes.push(...ids); db.ab = db.ab.filter((l) => !ids.includes(l.id)); },
      async purgerInactifs(avant) { trace("purgerInactifs"); db.ab = db.ab.filter((l) => l.role !== "pharmacie" || (l.last_seen_at || l.created_at) >= avant); },
      async succes(ids, quand) { trace("succes"); for (const l of db.ab) if (ids.includes(l.id)) Object.assign(l, { last_success_at: quand, failures: 0, last_error: null }); },
      async echec(id, failures, quand, erreur) { trace("echec"); const l = db.ab.find((x) => x.id === id); if (l) Object.assign(l, { failures, last_failure_at: quand, last_error: erreur }); },
      async dePharmacie(cip) { return copie(db.ab.filter((l) => l.role === "pharmacie" && l.pharmacy_cip === cip)); },
      async pourAnnonce({ cips = null, categorie = "offres" } = {}) {
        return copie(db.ab.filter((l) => l.role === "pharmacie" && (l.categories || []).includes(categorie) && (!cips || cips.includes(l.pharmacy_cip))));
      },
      async deCips(cips) { return copie(db.ab.filter((l) => l.role === "pharmacie" && cips.includes(l.pharmacy_cip))); },
      async tous() { return copie(db.ab); },
    },
    reglages: { async lire() { return copie(db.reglages); }, async ecrire(v) { db.reglages = R.fusionnerReglages(v); return copie(db.reglages); } },
    annonces: {
      async creer(l) {
        if (l.idem && db.annonces.some((a) => a.idem === l.idem)) return { annonce: copie(db.annonces.find((a) => a.idem === l.idem)), existante: true };
        const a = { id: crypto.randomUUID(), created_at: maintenant(), type: "promotion", categorie: "offres", source: "admin", repli_email: false, ...l };
        db.annonces.push(a); return { annonce: copie(a), existante: false };
      },
      async parIdem(idem) { return copie(db.annonces.find((a) => a.idem === idem)) || null; },
      async lire(id) { return copie(db.annonces.find((a) => a.id === id)) || null; },
      async parIds(ids) { return copie(db.annonces.filter((a) => ids.includes(a.id)).map(({ id, titre, type, categorie }) => ({ id, titre, type, categorie }))); },
      async enCours(depuis) { return copie(db.annonces.filter((a) => ["en_file", "en_cours"].includes(a.statut) && plafonnee(a) && a.created_at >= depuis)); },
      // index unique push_annonces_une_en_cours : un seul message plafonné « en_cours » ; les transactionnels jamais bloqués
      async reclamer(id) {
        const a = db.annonces.find((x) => x.id === id && x.statut === "en_file");
        if (!a || (plafonnee(a) && db.annonces.some((x) => x.statut === "en_cours" && plafonnee(x)))) return null;
        a.statut = "en_cours"; a.started_at = maintenant(); return copie(a);
      },
      async diffusionEnCours() { return copie(db.annonces.filter((a) => a.statut === "en_cours" && plafonnee(a))); },
      async liberer(avant) { for (const a of db.annonces) if (a.statut === "en_cours" && a.started_at < avant) Object.assign(a, { statut: "erreur", erreur: "Envoi interrompu" }); },
      async terminer(id, champs) { Object.assign(db.annonces.find((a) => a.id === id), champs, { finished_at: maintenant() }); },
      async dus(avant) { return copie(db.annonces.filter((a) => a.statut === "programmee" && a.programme_pour <= avant).sort((x, y) => x.programme_pour.localeCompare(y.programme_pour)).slice(0, 20)); },
      async passerEnFile(id) { const a = db.annonces.find((x) => x.id === id && x.statut === "programmee"); if (!a) return null; Object.assign(a, { statut: "en_file", created_at: maintenant() }); return copie(a); },
      async annuler(id, admin) {
        const a = db.annonces.find((x) => x.id === id && x.statut === "programmee");
        if (!a) return null;
        Object.assign(a, { statut: "annulee", annule_at: maintenant(), annule_par: admin || null, finished_at: maintenant() }); return copie(a);
      },
      async abandonner(id, texte) { const a = db.annonces.find((x) => x.id === id && x.statut === "programmee"); if (!a) return null; Object.assign(a, { statut: "erreur", erreur: texte, finished_at: maintenant() }); return { id }; },
      async enFile(depuis, avant) { return copie(db.annonces.filter((a) => a.statut === "en_file" && a.created_at >= depuis && a.created_at < avant)); },
      async programmees(limite = 50) { return copie(db.annonces.filter((a) => a.statut === "programmee").sort((x, y) => x.programme_pour.localeCompare(y.programme_pour)).slice(0, limite)); },
      async lister(limite = 50) {
        const prog = db.annonces.filter((a) => a.statut === "programmee").sort((x, y) => x.programme_pour.localeCompare(y.programme_pour));
        return copie([...prog, ...db.annonces.filter((a) => a.statut !== "programmee").slice().reverse().slice(0, limite)]);
      },
    },
    envois: {
      async ajouter(l) { for (const e of l) db.envois.push({ id: db.envois.length + 1, created_at: maintenant(), ...e }); },
      async noterEmail(annonceId, cip, statut) { for (const e of db.envois) if (e.annonce_id === annonceId && e.pharmacy_cip === cip) e.email = statut; },
      async corriger(annonceId, reussis) { for (const e of db.envois) if (e.annonce_id === annonceId && reussis.has(e.pharmacy_cip)) e.nb_reussis = reussis.get(e.pharmacy_cip); },
      async plafond(depuis, categorie = "offres") {
        const n = new Map();
        for (const e of db.envois) if (e.categorie === categorie && e.nb_reussis > 0 && e.created_at >= depuis) n.set(e.pharmacy_cip, (n.get(e.pharmacy_cip) || 0) + 1);
        return n;
      },
      async tentatives(depuis, categorie = "commandes", cips = null) {
        const n = new Map();
        for (const e of db.envois) if (e.categorie === categorie && e.nb_appareils > 0 && e.created_at >= depuis && (!cips || cips.includes(e.pharmacy_cip)))
          n.set(e.pharmacy_cip, (n.get(e.pharmacy_cip) || 0) + 1);
        return n;
      },
      async dejaEnvoye(cip, tag) { return db.envois.some((e) => e.pharmacy_cip === cip && e.tag === tag && e.nb_reussis > 0); },
      async dePharmacie(cip, limite = 50) { return copie(db.envois.filter((e) => e.pharmacy_cip === cip).slice().reverse().slice(0, limite)); },
      async purger(avant) { db.envois = db.envois.filter((e) => e.created_at >= avant); },
    },
    async nomPharmacie() { return "PHARMACIE DU TEST"; },
    async comptes(emails) {
      trace("comptes");
      const m = new Map();
      for (const e of emails) {
        if (db.comptes) { if (db.comptes.has(e)) m.set(e, db.comptes.get(e)); }
        else { const l = db.ab.find((x) => x.role === "pharmacie" && String(x.compte_email || "").toLowerCase() === e); if (l) m.set(e, l.pharmacy_cip); }
      }
      return m;
    },
    async comptesDuCip(cip) { trace("comptesDuCip"); return copie(lignesPharmacies().filter((p) => p.cip === cip)); },
    async comptesDesCips(cips) { return copie(lignesPharmacies().filter((p) => cips.includes(p.cip))); },
    async chercherPharmacies(q) {
      const t = String(q || "").toLowerCase(), chiffres = String(q || "").replace(/\D/g, "");
      return copie(lignesPharmacies().filter((p) => String(p.name || "").toLowerCase().includes(t) || String(p.ville || "").toLowerCase().includes(t)
        || (chiffres.length >= 3 && String(p.cip || "").startsWith(chiffres))).slice(0, 60));
    },
    async cipsClientes() { return new Set(lignesPharmacies().map((p) => R.cipPropre(p.cip)).filter(Boolean)); },
    modeles: {
      async lister(limite = 100) { return copie(db.modeles.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr")).slice(0, limite)); },
      async creer(m) {
        if (db.modeles.some((x) => x.nom.toLowerCase() === String(m.nom).toLowerCase())) return { modele: null, doublon: true };
        const n = { id: crypto.randomUUID(), created_at: maintenant(), updated_at: maintenant(), ...m }; db.modeles.push(n); return { modele: copie(n), doublon: false };
      },
      async supprimer(id) { db.modeles = db.modeles.filter((x) => x.id !== id); },
    },
    evenements: {
      async reserver(ligne) {
        const ex = db.evenements.find((e) => e.cle === ligne.cle || e.empreinte === ligne.empreinte);
        if (ex) return { nouveau: false, ligne: copie(ex) };
        const n = { recu_le: maintenant(), traite_le: null, resultat: null, nb_appareils: null, nb_reussis: null, ...ligne };
        db.evenements.push(n); return { nouveau: true, ligne: copie(n) };
      },
      async terminer(cle, champs) { const e = db.evenements.find((x) => x.cle === cle); if (e) Object.assign(e, champs, { traite_le: maintenant() }); },
      async lister(limite = 50) { return copie(db.evenements.slice().reverse().slice(0, limite)); },
      async purger(avant) { db.evenements = db.evenements.filter((e) => e.recu_le >= avant); },
    },
    hotes: {
      async noter(h) { db.hotes.set(h, new Date().toISOString()); },
      async lister() { return [...db.hotes].map(([hote, vu_le]) => ({ hote, vu_le })); },
      async purger(avant) { for (const [h, d] of db.hotes) if (d < avant) db.hotes.delete(h); },
    },
  };
  return stock;
}
